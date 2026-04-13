/**
 * Автоматический конвейер обработки документа.
 * Запускается после confirmUpload.
 *
 * Этапы:
 *   1. parsing                    — mammoth → HTML → Section + ContentBlock
 *   2. classifying_sections       — трёхшаговая классификация:
 *        2a. Детерминированное сопоставление по таксономии (rule engine)
 *        2b. LLM-классификация для секций с низкой уверенностью
 *        2c. LLM QA — валидация результатов предыдущих шагов
 *   3. extracting_facts           — извлечение фактов из протокола (только для protocol):
 *        3a. LLM-извлечение (Qwen3 на RunPod, fallback → default LLM)
 *        3b. QA-проверка низкоуверенных через Yandex LLM
 *        3c. Сохранение найденных + ненайденных фактов в БД
 *   4. detecting_soa              — поиск и выделение таблицы SOA (только для protocol):
 *        Детерминированный 5-фазный алгоритм скоринга HTML-таблиц
 *
 * Всё выполняется in-process (без Redis/BullMQ) для простоты локальной разработки.
 */

import { prisma } from "@clinscriptum/db";
import { storage } from "./storage.js";
import { llmAsk } from "./llm-gateway.js";
import { extractFactsForVersion } from "./fact-extraction.js";
import { detectSoaForVersion } from "./soa-detection.js";

/* ═══════════════════════ Types ═══════════════════════ */

interface TaxonomyRule {
  name: string;
  pattern: string;
  config: {
    type: "zone" | "subzone";
    key: string;
    parentZone?: string;
    canonicalZone: string;
    titleRu: string;
    patterns: string[];
    requirePatterns: string[];
    notKeywords: string[];
  };
}

interface ParsedSection {
  title: string;
  level: number;
  order: number;
  blocks: { type: string; content: string; rawHtml: string; order: number }[];
}

const LLM_CONFIDENCE_THRESHOLD = 0.7;
const LLM_QA_BATCH_SIZE = 10;

/* ═══════════════════════ Entry point ═══════════════════════ */

export async function runProcessingPipeline(versionId: string) {
  try {
    console.log(`[pipeline] Starting for version ${versionId}`);

    // Stage 1: Parsing
    await setVersionStatus(versionId, "parsing");
    const sections = await parseDocument(versionId);
    console.log(`[pipeline] Parsed ${sections.length} sections`);

    // Stage 2: Section classification (3-step)
    await setVersionStatus(versionId, "classifying_sections");

    // Step 2a: Deterministic rule engine
    const taxonomy = await loadTaxonomy();
    await classifySectionsDeterministic(versionId, taxonomy);
    console.log(`[pipeline] Step 2a (deterministic) complete`);

    // Step 2b: LLM classification for low-confidence / unclassified sections
    await classifySectionsLlm(versionId, taxonomy);
    console.log(`[pipeline] Step 2b (LLM classify) complete`);

    // Step 2c: LLM QA validation
    await classifySectionsLlmQa(versionId, taxonomy);
    console.log(`[pipeline] Step 2c (LLM QA) complete`);

    // Stage 3: Fact extraction (only for protocol documents)
    const versionDoc = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { document: { include: { study: true } } },
    });

    if (versionDoc?.document.type === "protocol") {
      await setVersionStatus(versionId, "extracting_facts");

      const factRun = await prisma.processingRun.create({
        data: {
          studyId: versionDoc.document.studyId,
          docVersionId: versionId,
          type: "fact_extraction",
          status: "running",
        },
      });

      try {
        await extractFactsForVersion(versionId);

        await prisma.processingRun.update({
          where: { id: factRun.id },
          data: { status: "completed" },
        });
        console.log(`[pipeline] Stage 3 (fact extraction) complete`);
      } catch (factErr) {
        console.error(`[pipeline] Stage 3 (fact extraction) failed:`, factErr);
        await prisma.processingRun.update({
          where: { id: factRun.id },
          data: { status: "failed" },
        }).catch(() => {});
      }
    }

    // Stage 4: SOA detection (only for protocol documents)
    if (versionDoc?.document.type === "protocol") {
      await setVersionStatus(versionId, "detecting_soa");

      const soaRun = await prisma.processingRun.create({
        data: {
          studyId: versionDoc.document.studyId,
          docVersionId: versionId,
          type: "soa_detection",
          status: "running",
        },
      });

      try {
        await detectSoaForVersion(versionId);

        await prisma.processingRun.update({
          where: { id: soaRun.id },
          data: { status: "completed" },
        });
        console.log(`[pipeline] Stage 4 (SOA detection) complete`);
      } catch (soaErr) {
        console.error(`[pipeline] Stage 4 (SOA detection) failed:`, soaErr);
        await prisma.processingRun.update({
          where: { id: soaRun.id },
          data: { status: "failed" },
        }).catch(() => {});
      }
    }

    // Mark as ready
    await setVersionStatus(versionId, "parsed");
    console.log(`[pipeline] Done for version ${versionId}`);
  } catch (err) {
    console.error(`[pipeline] Error for version ${versionId}:`, err);
    await setVersionStatus(versionId, "error").catch(() => {});
  }
}

async function setVersionStatus(versionId: string, status: string) {
  await prisma.documentVersion.update({
    where: { id: versionId },
    data: { status: status as any },
  });
}

/* ═══════════════════════ Stage 1: Parse ═══════════════════════ */

async function parseDocument(versionId: string): Promise<ParsedSection[]> {
  const version = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: versionId },
  });

  const buffer = await storage.download(version.fileUrl);
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;

  const sections = splitHtmlIntoSections(html);

  if (sections.length === 0) {
    sections.push({
      title: "Документ",
      level: 1,
      order: 0,
      blocks: [{ type: "paragraph", content: stripHtml(html), rawHtml: html, order: 0 }],
    });
  }

  // Persist sections + content blocks in a transaction
  await prisma.$transaction(async (tx) => {
    // Clean up previous data if re-processing
    await tx.contentBlock.deleteMany({
      where: { section: { docVersionId: versionId } },
    });
    await tx.section.deleteMany({ where: { docVersionId: versionId } });

    for (const sec of sections) {
      const sectionRecord = await tx.section.create({
        data: {
          docVersionId: versionId,
          title: sec.title,
          level: sec.level,
          order: sec.order,
          status: "not_validated",
          confidence: 0,
          sourceAnchor: { heading: sec.title },
        },
      });

      for (const block of sec.blocks) {
        await tx.contentBlock.create({
          data: {
            sectionId: sectionRecord.id,
            type: block.type as any,
            content: block.content,
            rawHtml: block.rawHtml || null,
            order: block.order,
            sourceAnchor: {},
          },
        });
      }
    }
  });

  return sections;
}

/* ─────────────── HTML → Sections ─────────────── */

const HEADING_RE = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;

function splitHtmlIntoSections(html: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const headings: { level: number; title: string; start: number; end: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1], 10),
      title: stripHtml(match[2]).trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (headings.length === 0) return [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const contentStart = h.end;
    const contentEnd = i + 1 < headings.length ? headings[i + 1].start : html.length;
    const bodyHtml = html.slice(contentStart, contentEnd).trim();

    const blocks = splitContentIntoBlocks(bodyHtml);

    sections.push({
      title: h.title,
      level: h.level,
      order: i,
      blocks,
    });
  }

  return sections;
}

/* ─────────────── HTML body → ContentBlocks ─────────────── */

const BLOCK_TAG_RE = /<(p|table|ul|ol|li|div|blockquote|figure|img|pre)[^>]*>[\s\S]*?<\/\1>|<(p|img|br|hr)[^>]*\/?>/gi;

function splitContentIntoBlocks(bodyHtml: string) {
  const blocks: { type: string; content: string; rawHtml: string; order: number }[] = [];
  let order = 0;

  let lastEnd = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(BLOCK_TAG_RE.source, "gi");

  while ((m = re.exec(bodyHtml)) !== null) {
    // Text before this tag
    const between = bodyHtml.slice(lastEnd, m.index).trim();
    if (between) {
      blocks.push({
        type: "paragraph",
        content: stripHtml(between),
        rawHtml: between,
        order: order++,
      });
    }

    const tagName = (m[1] || m[2] || "").toLowerCase();
    const tagHtml = m[0];
    const tagText = stripHtml(tagHtml).trim();

    if (!tagText && !["table", "img", "figure"].includes(tagName)) {
      lastEnd = m.index + tagHtml.length;
      continue;
    }

    let type = "paragraph";
    if (tagName === "table") type = "table";
    else if (["ul", "ol", "li"].includes(tagName)) type = "list";
    else if (tagName === "img" || tagName === "figure") type = "image";
    else if (tagName === "blockquote") type = "footnote";
    else if (tagName === "pre") type = "paragraph";

    blocks.push({ type, content: tagText, rawHtml: tagHtml, order: order++ });
    lastEnd = m.index + tagHtml.length;
  }

  // Trailing text
  const trailing = bodyHtml.slice(lastEnd).trim();
  if (trailing && stripHtml(trailing).trim()) {
    blocks.push({
      type: "paragraph",
      content: stripHtml(trailing),
      rawHtml: trailing,
      order: order++,
    });
  }

  if (blocks.length === 0 && bodyHtml.trim()) {
    blocks.push({
      type: "paragraph",
      content: stripHtml(bodyHtml),
      rawHtml: bodyHtml,
      order: 0,
    });
  }

  return blocks;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
}

/* ═══════════════════════ Stage 2a: Deterministic ═══════════════════════ */

async function classifySectionsDeterministic(versionId: string, taxonomy: TaxonomyRule[]) {
  if (taxonomy.length === 0) {
    console.warn("[pipeline] No taxonomy rules found, skipping deterministic step");
    return;
  }

  const sections = await prisma.section.findMany({
    where: { docVersionId: versionId },
    orderBy: { order: "asc" },
    include: { contentBlocks: { orderBy: { order: "asc" }, take: 3 } },
  });

  for (const section of sections) {
    const preview = section.contentBlocks.map((b) => b.content).join(" ").slice(0, 500);
    const match = classifyHeading(section.title, preview, taxonomy);

    await prisma.section.update({
      where: { id: section.id },
      data: {
        standardSection: match?.pattern ?? null,
        confidence: match?.score ?? 0,
        classifiedBy: match ? "deterministic" : null,
        algoSection: match?.pattern ?? null,
        algoConfidence: match?.score ?? 0,
      },
    });
  }
}

/* ═══════════ Parent heading chain builder ═══════════ */

interface SectionWithLevel {
  id: string;
  title: string;
  level: number;
  order: number;
}

/**
 * Для каждой секции строит цепочку родительских заголовков (от корня к текущей).
 * Секция level=2, вложенная в level=1, получит: ["Title of H1", "Title of H2"].
 */
function buildParentChains(allSections: SectionWithLevel[]): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  const stack: { level: number; title: string }[] = [];

  for (const sec of allSections) {
    while (stack.length > 0 && stack[stack.length - 1].level >= sec.level) {
      stack.pop();
    }
    const parentTitles = stack.map((s) => s.title);
    chains.set(sec.id, parentTitles);
    stack.push({ level: sec.level, title: sec.title });
  }

  return chains;
}

function formatBreadcrumb(parentTitles: string[]): string {
  if (parentTitles.length === 0) return "";
  return parentTitles.join(" → ");
}

/* ═══════════════════════ Stage 2b: LLM Classification ═══════════════════════ */

async function classifySectionsLlm(versionId: string, taxonomy: TaxonomyRule[]) {
  // Load ALL sections to build hierarchy, then filter targets
  const allSections = await prisma.section.findMany({
    where: { docVersionId: versionId },
    orderBy: { order: "asc" },
    include: { contentBlocks: { orderBy: { order: "asc" }, take: 3 } },
  });

  const parentChains = buildParentChains(allSections);

  const targets = allSections.filter(
    (s) => s.confidence < LLM_CONFIDENCE_THRESHOLD || !s.standardSection
  );

  if (targets.length === 0) {
    console.log("[pipeline] No low-confidence sections, skipping LLM classify");
    return;
  }

  console.log(`[pipeline] LLM classify: ${targets.length} sections`);

  const taxonomyCatalog = buildTaxonomyCatalog(taxonomy);
  const validPatterns = taxonomy.map((r) => r.pattern);

  for (const section of targets) {
    try {
      const preview = section.contentBlocks.map((b) => b.content).join(" ").slice(0, 800);
      const breadcrumb = formatBreadcrumb(parentChains.get(section.id) ?? []);
      const result = await llmClassifySection(section.title, preview, breadcrumb, taxonomyCatalog, validPatterns);

      if (result) {
        await prisma.section.update({
          where: { id: section.id },
          data: {
            standardSection: result.section,
            confidence: result.confidence,
            classifiedBy: "llm_check",
            llmSection: result.section,
            llmConfidence: result.confidence,
          },
        });
      }
    } catch (err) {
      console.warn(`[pipeline] LLM classify error for "${section.title}":`, err);
    }
  }
}

function buildTaxonomyCatalog(taxonomy: TaxonomyRule[]): string {
  const lines: string[] = [];
  for (const rule of taxonomy) {
    const cfg = rule.config;
    const prefix = cfg.type === "subzone" ? "  " : "";
    lines.push(`${prefix}${rule.pattern} — ${cfg.titleRu}`);
  }
  return lines.join("\n");
}

async function llmClassifySection(
  title: string,
  preview: string,
  breadcrumb: string,
  taxonomyCatalog: string,
  validPatterns: string[]
): Promise<{ section: string; confidence: number } | null> {
  const validCodesList = validPatterns.join(", ");

  const systemPrompt = `Ты — эксперт по клинической документации. Твоя задача — классифицировать секцию документа клинического исследования (протокол, ICF, IB, CSR) по стандартной таксономии.

Таксономия секций:
${taxonomyCatalog}

Допустимые коды секций (СТРОГО только из этого списка):
${validCodesList}

Правила:
1. Верни РОВНО один JSON объект: {"section": "<код секции>", "confidence": <число от 0.0 до 1.0>}
2. Значение "section" ОБЯЗАТЕЛЬНО должно быть одним из допустимых кодов выше. Любой другой вариант ЗАПРЕЩЁН.
3. Если секция не относится ни к одной из категорий, верни {"section": null, "confidence": 0}
4. confidence отражает твою уверенность в классификации
5. Предпочитай подзоны (subzone) зонам (zone), если подходят обе
6. Учитывай иерархию: цепочка родительских заголовков показывает контекст, в котором находится секция
7. Не добавляй комментарии, верни ТОЛЬКО JSON`;

  const contextLine = breadcrumb
    ? `Путь в документе (родительские заголовки): ${breadcrumb}\n`
    : "";

  const userPrompt = `${contextLine}Заголовок секции: "${title}"
Начало содержимого: "${preview}"`;

  const raw = await llmAsk("section_classify", systemPrompt, userPrompt);
  return parseLlmClassifyResponse(raw, validPatterns);
}

function parseLlmClassifyResponse(
  raw: string,
  validPatterns: string[]
): { section: string; confidence: number } | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;
    const obj = JSON.parse(jsonMatch[0]);
    if (!obj.section || typeof obj.confidence !== "number") return null;
    if (!validPatterns.includes(obj.section)) {
      console.warn(`[pipeline] LLM returned unknown section code "${obj.section}", ignoring`);
      return null;
    }
    return { section: obj.section, confidence: Math.min(Math.max(obj.confidence, 0), 1) };
  } catch {
    console.warn("[pipeline] Failed to parse LLM classify response:", raw.slice(0, 200));
    return null;
  }
}

/* ═══════════════════════ Stage 2c: LLM QA ═══════════════════════ */

async function classifySectionsLlmQa(versionId: string, taxonomy: TaxonomyRule[]) {
  const allSections = await prisma.section.findMany({
    where: { docVersionId: versionId },
    orderBy: { order: "asc" },
    include: { contentBlocks: { orderBy: { order: "asc" }, take: 2 } },
  });

  const parentChains = buildParentChains(allSections);

  const targets = allSections.filter((s) => s.standardSection !== null);

  if (targets.length === 0) return;

  console.log(`[pipeline] LLM QA: ${targets.length} sections in batches of ${LLM_QA_BATCH_SIZE}`);

  const taxonomyMap = new Map(taxonomy.map((r) => [r.pattern, r.config.titleRu]));

  for (let i = 0; i < targets.length; i += LLM_QA_BATCH_SIZE) {
    const batch = targets.slice(i, i + LLM_QA_BATCH_SIZE);

    try {
      const corrections = await llmQaBatch(batch, parentChains, taxonomyMap);

      for (const correction of corrections) {
        const sec = batch.find((s) => s.id === correction.sectionId);
        if (!sec) continue;

        if (correction.correct) {
          const newConf = Math.min((sec.confidence ?? 0) + 0.15, 1.0);
          await prisma.section.update({
            where: { id: sec.id },
            data: {
              confidence: newConf,
              classifiedBy: "llm_qa",
              llmSection: sec.standardSection,
              llmConfidence: newConf,
            },
          });
        } else if (correction.suggestedSection) {
          const qaConf = correction.suggestedConfidence ?? 0.6;
          await prisma.section.update({
            where: { id: sec.id },
            data: {
              standardSection: correction.suggestedSection,
              confidence: qaConf,
              classifiedBy: "llm_qa",
              llmSection: correction.suggestedSection,
              llmConfidence: qaConf,
            },
          });
        }
      }
    } catch (err) {
      console.warn(`[pipeline] LLM QA batch error (batch ${i / LLM_QA_BATCH_SIZE}):`, err);
    }
  }
}

interface QaCorrection {
  sectionId: string;
  correct: boolean;
  suggestedSection?: string;
  suggestedConfidence?: number;
}

async function llmQaBatch(
  sections: { id: string; title: string; standardSection: string | null; contentBlocks: { content: string }[] }[],
  parentChains: Map<string, string[]>,
  taxonomyMap: Map<string, string>
): Promise<QaCorrection[]> {
  const validPatterns = Array.from(taxonomyMap.keys());
  const validCodesList = validPatterns.join(", ");

  const items = sections.map((s, idx) => {
    const preview = s.contentBlocks.map((b) => b.content).join(" ").slice(0, 300);
    const sectionLabel = s.standardSection
      ? `${s.standardSection} (${taxonomyMap.get(s.standardSection) ?? ""})`
      : "не определена";
    const breadcrumb = formatBreadcrumb(parentChains.get(s.id) ?? []);
    const pathLine = breadcrumb ? ` | Путь: ${breadcrumb}` : "";
    return `${idx + 1}. id="${s.id}" | Заголовок: "${s.title}"${pathLine} | Классификация: ${sectionLabel} | Начало: "${preview}"`;
  });

  const systemPrompt = `Ты — QA-ревьюер классификации секций клинической документации.
Тебе дан список секций с текущей классификацией. Проверь каждую.

Допустимые коды секций (СТРОГО только из этого списка):
${validCodesList}

Правила:
1. Для каждой секции оцени, правильно ли она классифицирована
2. Учитывай иерархию документа: поле "Путь" показывает цепочку родительских заголовков, в контексте которых находится секция
3. Если классификация верна, верни correct=true
4. Если неверна — предложи правильный код из допустимого списка выше (suggestedSection) и уверенность (suggestedConfidence)
5. suggestedSection ОБЯЗАТЕЛЬНО должен быть одним из допустимых кодов. Любой другой вариант ЗАПРЕЩЁН.
6. Верни JSON массив: [{"id":"<id секции>","correct":true/false,"suggestedSection":"<код>","suggestedConfidence":0.8}]
7. Верни ТОЛЬКО JSON массив без комментариев`;

  const userPrompt = `Проверь классификацию следующих секций:\n\n${items.join("\n")}`;

  const raw = await llmAsk("section_classify", systemPrompt, userPrompt);
  return parseLlmQaResponse(raw, sections, validPatterns);
}

function parseLlmQaResponse(
  raw: string,
  sections: { id: string }[],
  validPatterns: string[]
): QaCorrection[] {
  try {
    const jsonMatch = raw.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return sections.map((s) => ({ sectionId: s.id, correct: true }));

    const arr = JSON.parse(jsonMatch[0]) as any[];
    return arr.map((item: any) => {
      const suggested = item.suggestedSection ?? undefined;
      if (suggested !== undefined && !validPatterns.includes(suggested)) {
        console.warn(`[pipeline] LLM QA returned unknown section code "${suggested}", ignoring suggestion`);
        return { sectionId: item.id ?? "", correct: true };
      }
      return {
        sectionId: item.id ?? "",
        correct: item.correct !== false,
        suggestedSection: suggested,
        suggestedConfidence: typeof item.suggestedConfidence === "number" ? item.suggestedConfidence : undefined,
      };
    });
  } catch {
    console.warn("[pipeline] Failed to parse LLM QA response:", raw.slice(0, 300));
    return sections.map((s) => ({ sectionId: s.id, correct: true }));
  }
}

async function loadTaxonomy(): Promise<TaxonomyRule[]> {
  const ruleSet = await prisma.ruleSet.findFirst({
    where: { type: "section_classification" },
    include: {
      versions: {
        where: { isActive: true },
        include: { rules: true },
        take: 1,
      },
    },
  });

  if (!ruleSet?.versions[0]) return [];

  return ruleSet.versions[0].rules.map((r) => ({
    name: r.name,
    pattern: r.pattern,
    config: r.config as any,
  }));
}

/* ─────── Deterministic scoring engine ─────── */

function classifyHeading(
  title: string,
  preview: string,
  rules: TaxonomyRule[]
): { pattern: string; score: number; ruleName: string } | null {
  const text = `${title} ${preview}`;
  let best: { pattern: string; score: number; ruleName: string } | null = null;

  for (const rule of rules) {
    const cfg = rule.config;

    // Gate check: if requirePatterns defined, at least one must match
    if (cfg.requirePatterns.length > 0) {
      const gatePass = cfg.requirePatterns.some((p) => safeRegex(p)?.test(text));
      if (!gatePass) continue;
    }

    // Exclusion check
    if (cfg.notKeywords.length > 0) {
      const excluded = cfg.notKeywords.some((p) => safeRegex(p)?.test(text));
      if (excluded) continue;
    }

    // Score: count matching patterns, title matches worth 3x
    let titleMatches = 0;
    let previewMatches = 0;
    for (const p of cfg.patterns) {
      if (safeRegex(p)?.test(title)) {
        titleMatches++;
      } else if (safeRegex(p)?.test(text)) {
        previewMatches++;
      }
    }

    const matchCount = titleMatches * 3 + previewMatches;
    if (matchCount === 0) continue;

    const totalPatterns = cfg.patterns.length;
    const rawScore = matchCount / (totalPatterns * 3);
    let score = Math.min(rawScore, 1.0);

    // Title-only match bonus: if classification is based on heading alone, it's stronger
    if (titleMatches > 0) {
      score = Math.min(score + 0.2, 1.0);
    }

    // Subzones are more specific
    if (cfg.type === "subzone") {
      score = Math.min(score + 0.1, 1.0);
    }

    // Gate match bonus
    if (cfg.requirePatterns.length > 0) {
      const titleGate = cfg.requirePatterns.some((p) => safeRegex(p)?.test(title));
      score = Math.min(score + (titleGate ? 0.2 : 0.1), 1.0);
    }

    if (!best || score > best.score) {
      best = { pattern: rule.pattern, score, ruleName: rule.name };
    }
  }

  return best;
}

const regexCache = new Map<string, RegExp | null>();

const WORD_CHAR = "[а-яА-ЯёЁa-zA-Z0-9_]";
const WORD_BOUNDARY = `(?:(?<=${WORD_CHAR})(?!${WORD_CHAR})|(?<!${WORD_CHAR})(?=${WORD_CHAR}))`;

function adaptPatternForUnicode(pattern: string): string {
  // JS \w and \b don't cover Cyrillic — replace with Unicode-aware equivalents
  return pattern
    .replace(/\\b/g, WORD_BOUNDARY)
    .replace(/\\w/g, WORD_CHAR);
}

function safeRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  try {
    let flags = "";
    let cleanPattern = pattern;
    if (cleanPattern.startsWith("(?i)")) {
      flags = "i";
      cleanPattern = cleanPattern.slice(4);
    }
    cleanPattern = adaptPatternForUnicode(cleanPattern);
    const re = new RegExp(cleanPattern, flags);
    regexCache.set(pattern, re);
    return re;
  } catch {
    regexCache.set(pattern, null);
    return null;
  }
}
