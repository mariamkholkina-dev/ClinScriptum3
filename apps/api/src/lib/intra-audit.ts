/**
 * Движок внутридокументного аудита.
 *
 * Этапы:
 *   1. Детерминированные проверки (факты, секции, плейсхолдеры)
 *   2. LLM кросс-проверки (синопсис vs основной текст и т.д.)
 *   3. LLM редакторские проверки (грамматика, стиль)
 *   4. QA-верификация (проверка на false positive)
 */

import { prisma } from "@clinscriptum/db";
import { llmAsk } from "./llm-gateway.js";
import { logger } from "./logger.js";

/* ═══════════════════════ Types ═══════════════════════ */

type Severity = "critical" | "high" | "medium" | "low" | "info";
type AuditCategory = "consistency" | "logic" | "terminology" | "compliance" | "grammar";

interface RawFinding {
  type: "editorial" | "semantic" | "intra_audit";
  description: string;
  suggestion?: string;
  severity: Severity;
  auditCategory: AuditCategory;
  issueType: string;
  issueFamily: string;
  anchorZone?: string;
  targetZone?: string;
  sourceRef: {
    anchorQuote?: string;
    targetQuote?: string;
    sectionTitle?: string;
    textSnippet?: string;
    location?: string;
  };
}

interface SectionData {
  id: string;
  title: string;
  standardSection: string | null;
  level: number;
  order: number;
  content: string;
  rawHtml: string;
}

interface FactData {
  id: string;
  factKey: string;
  factCategory: string;
  value: string;
  sources: any;
}

const REQUIRED_ZONES: Record<string, string[]> = {
  protocol: ["design", "population", "endpoints", "safety", "statistics"],
  csr: ["synopsis", "design", "population", "endpoints", "safety", "statistics"],
  icf: ["overview", "procedures", "safety", "ethics"],
  ib: ["overview", "ip", "safety"],
};

const PLACEHOLDER_PATTERNS: { pattern: RegExp; code: string; label: string }[] = [
  { pattern: /\bTBD\b/g, code: "placeholder_TBD", label: "Обнаружен паттерн TBD (To Be Determined)" },
  { pattern: /\bTBC\b/g, code: "placeholder_TBC", label: "Обнаружен паттерн TBC (To Be Confirmed)" },
  { pattern: /\b[X]{2,3}\b/g, code: "placeholder_XX", label: "Обнаружен паттерн XX/XXX (заполнитель)" },
  { pattern: /\[(?:Insert|Вставить|Вставьте)\]/gi, code: "placeholder_Insert", label: "Обнаружен паттерн [Insert]/[Вставить]" },
  { pattern: /Error!/g, code: "placeholder_Error", label: "Обнаружен паттерн Error! (ошибка формулы/ссылки)" },
  { pattern: /\[(?:TODO|FIXME)\]/gi, code: "placeholder_TODO_FIXME", label: "Обнаружен маркер [TODO]/[FIXME]" },
];

const CROSS_CHECK_STRATEGIES: {
  key: string;
  anchorZone: string;
  targetZones: string[];
  label: string;
}[] = [
  { key: "synopsis_check", anchorZone: "synopsis", targetZones: ["design", "population", "endpoints", "statistics", "safety"], label: "Синопсис vs основной текст" },
  { key: "endpoints_vs_statistics", anchorZone: "endpoints", targetZones: ["statistics"], label: "Конечные точки vs статистика" },
  { key: "design_vs_procedures", anchorZone: "design", targetZones: ["procedures"], label: "Дизайн vs процедуры" },
  { key: "safety_cross", anchorZone: "safety", targetZones: ["design", "procedures", "population"], label: "Безопасность vs смежные разделы" },
  { key: "population_cross", anchorZone: "population", targetZones: ["design", "statistics"], label: "Популяция vs дизайн и статистика" },
];

const EDITORIAL_ZONES = [
  "overview", "appendix", "synopsis", "design", "procedures", "population",
  "ip", "safety", "endpoints", "statistics", "data_management", "ethics",
];

/* ═══════════════════════ Entry point ═══════════════════════ */

export async function runIntraDocAudit(versionId: string): Promise<string> {
  const version = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { document: { include: { study: true } } },
  });

  const run = await prisma.processingRun.create({
    data: {
      studyId: version.document.studyId,
      docVersionId: versionId,
      type: "intra_doc_audit",
      status: "running",
    },
  });

  try {
    await prisma.documentVersion.update({
      where: { id: versionId },
      data: { status: "intra_audit" },
    });

    await prisma.finding.deleteMany({
      where: { docVersionId: versionId, type: "intra_audit" },
    });

    const sections = await loadSections(versionId);
    const facts = await loadFacts(versionId);
    const docType = version.document.type;

    logger.info("[intra-audit] Starting", { versionId, sectionCount: sections.length, factCount: facts.length });

    const allFindings: RawFinding[] = [];

    // 1. Deterministic checks
    allFindings.push(...runPlaceholderChecks(sections));
    allFindings.push(...runConsistencyChecks(facts));
    allFindings.push(...runRequiredSectionsCheck(sections, docType));
    allFindings.push(...runRangeChecks(facts));

    logger.info("[intra-audit] Deterministic findings", { count: allFindings.length });

    // 2. LLM cross-checks
    const llmFindings = await runLlmCrossChecks(sections);
    allFindings.push(...llmFindings);
    logger.info("[intra-audit] LLM cross-check findings", { count: llmFindings.length });

    // 3. LLM editorial checks
    const editorialFindings = await runEditorialChecks(sections);
    allFindings.push(...editorialFindings);
    logger.info("[intra-audit] Editorial findings", { count: editorialFindings.length });

    // 4. Save all findings
    const savedIds = await saveFindings(versionId, allFindings);
    logger.info("[intra-audit] Saved findings", { count: savedIds.length });

    // 5. QA verification
    await runQaVerification(savedIds);
    logger.info("[intra-audit] QA verification complete");

    // 6. Create/reset FindingReview for reviewer workflow
    await prisma.findingReview.upsert({
      where: {
        docVersionId_auditType: {
          docVersionId: versionId,
          auditType: "intra_audit",
        },
      },
      create: {
        tenantId: version.document.study.tenantId,
        docVersionId: versionId,
        auditType: "intra_audit",
        status: "pending",
      },
      update: {
        status: "pending",
        reviewerId: null,
        publishedAt: null,
      },
    });
    logger.info("[intra-audit] FindingReview created/reset", { versionId });

    await prisma.processingRun.update({
      where: { id: run.id },
      data: { status: "completed" },
    });

    await prisma.documentVersion.update({
      where: { id: versionId },
      data: { status: "parsed" },
    });

    logger.info("[intra-audit] Done", { versionId });
    return run.id;
  } catch (err) {
    logger.error("[intra-audit] Error", { error: String(err) });
    await prisma.processingRun.update({
      where: { id: run.id },
      data: { status: "failed" },
    }).catch(() => {});
    await prisma.documentVersion.update({
      where: { id: versionId },
      data: { status: "parsed" },
    }).catch(() => {});
    throw err;
  }
}

/* ═══════════════════════ Data loading ═══════════════════════ */

async function loadSections(versionId: string): Promise<SectionData[]> {
  const sections = await prisma.section.findMany({
    where: { docVersionId: versionId },
    orderBy: { order: "asc" },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
  });

  return sections.map((s) => ({
    id: s.id,
    title: s.title,
    standardSection: s.standardSection,
    level: s.level,
    order: s.order,
    content: s.contentBlocks.map((b) => b.content).join("\n"),
    rawHtml: s.contentBlocks.map((b) => b.rawHtml ?? "").join("\n"),
  }));
}

async function loadFacts(versionId: string): Promise<FactData[]> {
  const facts = await prisma.fact.findMany({
    where: { docVersionId: versionId },
  });
  return facts.map((f) => ({
    id: f.id,
    factKey: f.factKey,
    factCategory: f.factCategory,
    value: f.value,
    sources: f.sources,
  }));
}

/* ═══════════════════════ 1. Deterministic checks ═══════════════════════ */

function runPlaceholderChecks(sections: SectionData[]): RawFinding[] {
  const findings: RawFinding[] = [];

  for (const section of sections) {
    for (const pp of PLACEHOLDER_PATTERNS) {
      const re = new RegExp(pp.pattern.source, pp.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(section.content)) !== null) {
        const start = Math.max(0, match.index - 40);
        const end = Math.min(section.content.length, match.index + match[0].length + 40);
        const snippet = section.content.slice(start, end);

        findings.push({
          type: "intra_audit",
          description: `${pp.label} в разделе «${section.title}»`,
          suggestion: "Заполните или удалите плейсхолдер перед финализацией документа",
          severity: "high",
          auditCategory: "compliance",
          issueType: pp.code,
          issueFamily: "PLACEHOLDER",
          anchorZone: section.standardSection ?? undefined,
          sourceRef: {
            sectionTitle: section.title,
            textSnippet: `...${snippet}...`,
            location: `Позиция ${match.index}`,
          },
        });
      }
    }
  }

  return findings;
}

function runConsistencyChecks(facts: FactData[]): RawFinding[] {
  const findings: RawFinding[] = [];
  const byKey = new Map<string, FactData[]>();

  for (const fact of facts) {
    const existing = byKey.get(fact.factKey) ?? [];
    existing.push(fact);
    byKey.set(fact.factKey, existing);
  }

  for (const [key, group] of byKey) {
    if (group.length < 2) continue;

    const uniqueValues = [...new Set(group.map((f) => f.value.trim().toLowerCase()))];
    if (uniqueValues.length < 2) continue;

    const valueList = group.map((f) => f.value).join(" vs ");
    findings.push({
      type: "intra_audit",
      description: `Противоречие: ${key} — обнаружены разные значения в документе: ${valueList}`,
      suggestion: "Проверьте и приведите значения к единому виду во всех разделах",
      severity: "critical",
      auditCategory: "consistency",
      issueType: "multi_value_same_key",
      issueFamily: "NUMERIC",
      sourceRef: {
        textSnippet: `Факт "${key}": ${valueList}`,
      },
    });
  }

  // C-2: sample size check
  const plannedSample = facts.find((f) => f.factKey === "population.planned_sample_size");
  const statsSample = facts.find((f) => f.factKey === "statistics.sample_size");
  if (plannedSample && statsSample) {
    const v1 = parseFloat(plannedSample.value);
    const v2 = parseFloat(statsSample.value);
    if (!isNaN(v1) && !isNaN(v2) && Math.abs(v1 - v2) / Math.max(v1, v2) > 0.01) {
      findings.push({
        type: "intra_audit",
        description: `Противоречие: planned_n_total — значение в Синопсисе (${v1}) не совпадает со значением в разделе Статистика (${v2})`,
        suggestion: "Приведите значения размера выборки к единому виду в Синопсисе и разделе Статистические методы",
        severity: "critical",
        auditCategory: "consistency",
        issueType: "sample_size_pop_vs_stats",
        issueFamily: "NUMERIC",
        sourceRef: {
          anchorQuote: `Планируемый размер выборки: ${v1}`,
          targetQuote: `Размер выборки в статистике: ${v2}`,
        },
      });
    }
  }

  return findings;
}

function runRequiredSectionsCheck(sections: SectionData[], docType: string): RawFinding[] {
  const required = REQUIRED_ZONES[docType];
  if (!required) return [];

  const findings: RawFinding[] = [];
  const presentZones = new Set(
    sections
      .map((s) => s.standardSection)
      .filter(Boolean)
      .map((ss) => ss!.split(".")[0])
  );

  for (const zone of required) {
    if (!presentZones.has(zone)) {
      findings.push({
        type: "intra_audit",
        description: `Отсутствует обязательный раздел «${zone}» для типа документа ${docType}`,
        suggestion: `Добавьте раздел «${zone}» в документ`,
        severity: "high",
        auditCategory: "compliance",
        issueType: "missing_source_zone",
        issueFamily: "MISSINGNESS",
        sourceRef: {
          textSnippet: `Обязательная зона: ${zone}`,
        },
      });
    }
  }

  return findings;
}

function runRangeChecks(facts: FactData[]): RawFinding[] {
  const findings: RawFinding[] = [];

  for (const fact of facts) {
    try {
      const val = JSON.parse(fact.value);
      if (typeof val === "object" && val !== null) {
        const min = val.min ?? val.lower ?? val.от;
        const max = val.max ?? val.upper ?? val.до;
        if (typeof min === "number" && typeof max === "number" && min > max) {
          findings.push({
            type: "intra_audit",
            description: `Ошибка диапазона в факте «${fact.factKey}»: минимум (${min}) > максимум (${max})`,
            suggestion: "Проверьте границы диапазона",
            severity: "high",
            auditCategory: "consistency",
            issueType: "min_gt_max",
            issueFamily: "RANGE_CONSISTENCY",
            sourceRef: {
              textSnippet: `${fact.factKey}: min=${min}, max=${max}`,
            },
          });
        }
      }
    } catch {
      // value is not JSON, skip
    }
  }

  return findings;
}

/* ═══════════════════════ 2. LLM cross-checks ═══════════════════════ */

async function runLlmCrossChecks(sections: SectionData[]): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  for (const strategy of CROSS_CHECK_STRATEGIES) {
    const anchorSections = sections.filter(
      (s) => s.standardSection?.startsWith(strategy.anchorZone)
    );
    if (anchorSections.length === 0) continue;

    const anchorText = anchorSections.map((s) => s.content).join("\n\n");
    if (anchorText.length < 50) continue;

    const targetSections = sections.filter((s) =>
      strategy.targetZones.some((tz) => s.standardSection?.startsWith(tz))
    );
    if (targetSections.length === 0) continue;

    const targetText = targetSections.map((s) => `[${s.title}]\n${s.content}`).join("\n\n---\n\n");

    try {
      const result = await llmCrossCheck(
        strategy.anchorZone,
        anchorText.slice(0, 8000),
        targetText.slice(0, 8000),
        strategy.targetZones
      );
      for (const r of result) {
        r.anchorZone = strategy.anchorZone;
        r.targetZone = strategy.targetZones.join(",");
      }
      findings.push(...result);
    } catch (err) {
      logger.warn("[intra-audit] LLM cross-check failed", { strategyKey: strategy.key, error: String(err) });
    }
  }

  return findings;
}

async function llmCrossCheck(
  anchorZone: string,
  anchorText: string,
  targetText: string,
  targetZones: string[]
): Promise<RawFinding[]> {
  const systemPrompt = `Ты — эксперт по проверке качества клинической документации. Сравни якорный раздел (anchor) с целевыми разделами (target) и найди все противоречия, несоответствия, пробелы и ошибки.

Для каждой находки верни JSON-объект:
{
  "issue_type": "строка из стандартного списка типов",
  "severity": "critical|high|medium|low|info",
  "category": "consistency|logic|terminology|compliance",
  "family": "NUMERIC|TIMING_SCHEDULE|IP_DOSING|POPULATION_ELIGIBILITY|ENDPOINTS_ANALYSIS|SAFETY_REPORTING|RANDOMIZATION|BLINDING_UNBLINDING|CROSSREF|MISSINGNESS|DUPLICATION_CONFLICT|TEXT_CONTRADICTION",
  "description": "Описание проблемы на русском",
  "anchor_quote": "Точная цитата из якорного раздела (≥40 символов)",
  "target_quote": "Точная цитата из целевого раздела (≥40 символов)",
  "suggestion": "Рекомендация по исправлению на русском"
}

ПРАВИЛА:
- Severity: critical — влияет на безопасность пациентов или валидность; high — значительная ошибка; medium — требует внимания; low — незначительное; info — информационное
- Возвращай ТОЛЬКО JSON-массив. Если проблем нет — верни []
- Каждая находка должна иметь конкретные цитаты из текста
- Не придумывай проблемы, основывайся только на предоставленном тексте`;

  const userPrompt = `ЯКОРНЫЙ РАЗДЕЛ (${anchorZone}):
${anchorText}

---

ЦЕЛЕВЫЕ РАЗДЕЛЫ (${targetZones.join(", ")}):
${targetText}`;

  const raw = await llmAsk("intra_audit", systemPrompt, userPrompt);
  return parseLlmCrossCheckResponse(raw);
}

function parseLlmCrossCheckResponse(raw: string): RawFinding[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const arr = JSON.parse(jsonMatch[0]) as any[];
    return arr
      .filter((item) => item.description && item.issue_type)
      .map((item) => ({
        type: "intra_audit" as const,
        description: item.description,
        suggestion: item.suggestion ?? undefined,
        severity: mapSeverity(item.severity),
        auditCategory: mapCategory(item.category),
        issueType: item.issue_type,
        issueFamily: item.family ?? "TEXT_CONTRADICTION",
        sourceRef: {
          anchorQuote: item.anchor_quote,
          targetQuote: item.target_quote,
        },
      }));
  } catch (err) {
    logger.warn("[intra-audit] Failed to parse LLM cross-check response", { response: (raw ?? "").slice(0, 300) });
    return [];
  }
}

/* ═══════════════════════ 3. LLM editorial checks ═══════════════════════ */

async function runEditorialChecks(sections: SectionData[]): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  for (const zone of EDITORIAL_ZONES) {
    const zoneSections = sections.filter((s) => s.standardSection?.startsWith(zone));
    if (zoneSections.length === 0) continue;

    const text = zoneSections.map((s) => s.content).join("\n\n");
    if (text.length < 100) continue;

    try {
      const result = await llmEditorialCheck(zone, text.slice(0, 6000));
      for (const r of result) {
        r.anchorZone = zone;
      }
      findings.push(...result);
    } catch (err) {
      logger.warn("[intra-audit] Editorial check failed", { zone, error: String(err) });
    }
  }

  return findings;
}

async function llmEditorialCheck(zone: string, text: string): Promise<RawFinding[]> {
  const systemPrompt = `Ты — редактор клинической документации. Проверь текст на грамматические, стилистические и терминологические ошибки.

Для каждой находки верни JSON-объект:
{
  "issue_type": "editorial_grammar_error|editorial_spelling_error|editorial_inconsistent_term_usage|editorial_run_on_sentence|editorial_excessive_vagueness|editorial_punctuation_error|editorial_translation_artifact|editorial_inconsistent_abbreviation_usage|editorial_missing_actor|editorial_ambiguity_due_to_scope",
  "severity": "low|info",
  "description": "Описание на русском",
  "quote": "Цитата из текста (≥40 символов)",
  "suggestion": "Рекомендация на русском"
}

ПРАВИЛА:
- Максимальная серьёзность: low (не выше)
- Возвращай ТОЛЬКО JSON-массив. Если ошибок нет — верни []
- Не больше 10 находок на один раздел
- Цитируй ТОЧНО из предоставленного текста`;

  const userPrompt = `РАЗДЕЛ: ${zone}\n\nТЕКСТ:\n${text}`;

  const raw = await llmAsk("intra_audit", systemPrompt, userPrompt);
  return parseLlmEditorialResponse(raw, zone);
}

function parseLlmEditorialResponse(raw: string, zone: string): RawFinding[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const arr = JSON.parse(jsonMatch[0]) as any[];
    return arr
      .filter((item) => item.description && item.issue_type)
      .slice(0, 10)
      .map((item) => {
        const sev = item.severity === "info" ? "info" : "low";
        return {
          type: "editorial" as const,
          description: item.description,
          suggestion: item.suggestion ?? undefined,
          severity: sev as Severity,
          auditCategory: "grammar" as AuditCategory,
          issueType: item.issue_type,
          issueFamily: "EDITORIAL",
          anchorZone: zone,
          sourceRef: {
            textSnippet: item.quote,
            sectionTitle: zone,
          },
        };
      });
  } catch {
    logger.warn("[intra-audit] Failed to parse editorial response", { response: (raw ?? "").slice(0, 300) });
    return [];
  }
}

/* ═══════════════════════ 4. Save findings ═══════════════════════ */

async function saveFindings(versionId: string, findings: RawFinding[]): Promise<string[]> {
  const ids: string[] = [];

  for (const f of findings) {
    const record = await prisma.finding.create({
      data: {
        docVersionId: versionId,
        type: f.type as any,
        description: f.description,
        suggestion: f.suggestion ?? null,
        severity: f.severity as any,
        originalSeverity: f.severity as any,
        auditCategory: f.auditCategory,
        issueType: f.issueType,
        issueFamily: f.issueFamily,
        anchorZone: f.anchorZone ?? null,
        targetZone: f.targetZone ?? null,
        qaVerified: false,
        sourceRef: f.sourceRef as any,
        status: "pending",
        extraAttributes: {},
      },
    });
    ids.push(record.id);
  }

  return ids;
}

/* ═══════════════════════ 5. QA verification ═══════════════════════ */

async function runQaVerification(findingIds: string[]): Promise<void> {
  const QA_BATCH_SIZE = 5;

  for (let i = 0; i < findingIds.length; i += QA_BATCH_SIZE) {
    const batchIds = findingIds.slice(i, i + QA_BATCH_SIZE);
    const findings = await prisma.finding.findMany({
      where: { id: { in: batchIds } },
    });

    try {
      const results = await llmQaBatch(findings);

      for (const result of results) {
        await prisma.finding.update({
          where: { id: result.findingId },
          data: {
            qaVerified: true,
            status: result.isFalsePositive ? "false_positive" : "pending",
          },
        });
      }
    } catch (err) {
      logger.warn("[intra-audit] QA batch failed", { error: String(err) });
      await prisma.finding.updateMany({
        where: { id: { in: batchIds } },
        data: { qaVerified: true },
      });
    }
  }
}

async function llmQaBatch(
  findings: { id: string; description: string; sourceRef: any; severity: any; issueType: string | null }[]
): Promise<{ findingId: string; isFalsePositive: boolean }[]> {
  const items = findings.map((f, idx) => {
    const ref = f.sourceRef as any;
    const quotes = [ref?.anchorQuote, ref?.targetQuote, ref?.textSnippet]
      .filter(Boolean)
      .join(" | ");
    return `${idx + 1}. [id=${f.id}] Серьёзность: ${f.severity}. Тип: ${f.issueType}. Описание: ${f.description}. Цитаты: ${quotes}`;
  });

  const systemPrompt = `Ты — QA-ревьюер аудита клинической документации.
Для каждой находки определи: это реальная проблема или ложное срабатывание (false positive)?

Ложное срабатывание — когда:
- Описанной проблемы не существует в цитатах
- Цитаты не противоречат друг другу
- Различия объясняются контекстом (например, разные популяции/подгруппы)
- Это допустимое округление или разная форма записи одного значения

Верни JSON-массив: [{"id":"<id>","is_false_positive":true/false}]
Верни ТОЛЬКО JSON.`;

  const userPrompt = `Проверь находки:\n\n${items.join("\n")}`;

  const raw = await llmAsk("intra_audit_qa", systemPrompt, userPrompt);

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return findings.map((f) => ({ findingId: f.id, isFalsePositive: false }));

    const arr = JSON.parse(jsonMatch[0]) as any[];
    return arr.map((item) => ({
      findingId: item.id,
      isFalsePositive: item.is_false_positive === true,
    }));
  } catch {
    return findings.map((f) => ({ findingId: f.id, isFalsePositive: false }));
  }
}

/* ═══════════════════════ Helpers ═══════════════════════ */

function mapSeverity(raw: string | undefined): Severity {
  const s = (raw ?? "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high" || s === "major") return "high";
  if (s === "medium" || s === "minor") return "medium";
  if (s === "low") return "low";
  return "info";
}

function mapCategory(raw: string | undefined): AuditCategory {
  const c = (raw ?? "").toLowerCase();
  if (c === "consistency") return "consistency";
  if (c === "logic") return "logic";
  if (c === "terminology") return "terminology";
  if (c === "compliance") return "compliance";
  if (c === "grammar") return "grammar";
  return "consistency";
}
