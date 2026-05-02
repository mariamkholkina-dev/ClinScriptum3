/**
 * Shared fact extraction core logic.
 * Used by both the API in-process pipeline and the BullMQ worker pipeline.
 *
 * Three levels:
 *   1. Deterministic — regex rules from rules-engine
 *   2. LLM Check    — per-section discovery extraction
 *   3. LLM QA       — arbitration for low-confidence and disagreements
 */

import { prisma, loadRulesForType, snapshotRules, getEffectiveLlmConfig, toConfigSnapshot, getInputBudgetChars } from "@clinscriptum/db";
import { RulesEngine, detectContradictions, toFactExtractionRules, extractRawFromTable, aggregateByCanonical, canonicalize } from "@clinscriptum/rules-engine";
import type { ExtractedFact, AggregatedFact, TableAst } from "@clinscriptum/rules-engine";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { parseLlmJson, findJsonSpan, TargetedFactSchema } from "./utils/llm-json.js";

export const EXCLUDED_SECTION_PREFIXES = ["overview", "admin", "ip.preclinical_clinical_data"];
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
const LLM_CONCURRENCY = 3;
const MAX_RETRIES = 2;

export interface FactExtractionContext {
  docVersionId: string;
  tenantId: string;
  bundleId: string | null;
  llmThinkingEnabled?: boolean;
  excludedSectionPrefixes?: string[];
}

export interface FactExtractionResult {
  data: Record<string, unknown>;
  llmConfigSnapshot?: Record<string, unknown>;
  ruleSnapshot?: Record<string, unknown>;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface FactVariant {
  value: string;
  confidence: number;
  level: "deterministic" | "llm_check" | "llm_qa";
  sourceText: string;
  sectionTitle: string;
  sectionId?: string;
}

interface SectionForExtraction {
  id: string;
  title: string;
  standardSection: string | null;
  level: number;
  text: string;
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

/**
 * Serialise content blocks back to plain text while preserving cues
 * the regex/LLM extractors care about:
 *   - `list` blocks get a "- " bullet prefix so multi-line list rules
 *     (criteria/endpoints) can recognise the boundary;
 *   - `table` blocks get a blank-line separator from surrounding
 *     paragraphs.
 */
export function serializeContentBlocks(
  blocks: Array<{ content: string; type?: string | null }>,
): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const c = b.content ?? "";
    if (!c) continue;
    if (b.type === "list") {
      parts.push(`- ${c}`);
    } else if (b.type === "table") {
      parts.push(`\n${c}\n`);
    } else {
      parts.push(c);
    }
  }
  return parts.join("\n");
}

function buildExtractableSections(
  sections: Array<{ id: string; title: string; standardSection: string | null; level: number; contentBlocks: Array<{ content: string; type?: string | null }> }>,
  prefixes: string[] = EXCLUDED_SECTION_PREFIXES,
): SectionForExtraction[] {
  return sections
    .filter((s) => !s.standardSection || !prefixes.some((p) => s.standardSection!.startsWith(p)))
    .map((s) => ({
      id: s.id,
      title: s.title,
      standardSection: s.standardSection,
      level: s.level,
      text: serializeContentBlocks(s.contentBlocks),
    }))
    .filter((s) => s.text.length > 30);
}

function groupRelatedSections(
  sections: SectionForExtraction[],
  budget: number,
): SectionForExtraction[][] {
  const groups: SectionForExtraction[][] = [];
  let i = 0;
  while (i < sections.length) {
    const parent = sections[i];
    const group = [parent];
    let groupLen = parent.text.length;
    let j = i + 1;
    while (j < sections.length && sections[j].level > parent.level) {
      const child = sections[j];
      if (groupLen + child.text.length > budget) break;
      group.push(child);
      groupLen += child.text.length;
      j++;
    }
    groups.push(group);
    i = j;
  }
  return groups;
}

function parseLlmJsonArray(raw: string): unknown[] | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (/не могу обсуждать|давайте поговорим|не могу помочь с этим/i.test(cleaned)) return null;
  // Phase 4: balanced bracket scan (instead of greedy regex) handles
  // nested JSON inside source_text properly.
  const span = findJsonSpan(cleaned);
  if (!span) return null;
  try {
    const parsed = JSON.parse(span);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.facts)) return obj.facts;
      if (Array.isArray(obj.new_facts)) return obj.new_facts;
      if (Array.isArray(obj.results)) return obj.results;
      if (obj.fact_key) return [obj];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Phase 2: load `fact_section_priors` rules. Each rule.config is
 * `{ factKey, expectedSections: string[] }`. The map is `factKey →
 * Set<standardSection>`. If not configured, returns null and callers
 * skip filtering.
 */
async function loadFactSectionPriors(
  bundleId: string | null,
): Promise<Map<string, Set<string>> | null> {
  const resolved = await loadRulesForType(bundleId, "fact_section_priors");
  if (!resolved || resolved.rules.length === 0) return null;
  const map = new Map<string, Set<string>>();
  for (const r of resolved.rules) {
    const cfg = (r.config ?? {}) as { factKey?: string; expectedSections?: string[] };
    if (!cfg.factKey || !Array.isArray(cfg.expectedSections)) continue;
    map.set(cfg.factKey, new Set(cfg.expectedSections));
  }
  return map.size > 0 ? map : null;
}

function factMatchesSectionPriors(
  fact: ExtractedFact,
  priors: Map<string, Set<string>>,
  titleToStandard: Map<string, string>,
): boolean {
  const allowed = priors.get(fact.factKey);
  if (!allowed) return true; // no prior → don't restrict
  const title = fact.source.sectionTitle ?? "";
  const std = titleToStandard.get(title);
  if (!std) return true; // unclassified section → allow (don't punish missing classification)
  for (const expected of allowed) {
    if (std === expected || std.startsWith(`${expected}.`)) return true;
  }
  return false;
}

/* ═══════════════ Level 1: Deterministic ═══════════════ */

export async function runDeterministic(
  ctx: FactExtractionContext,
): Promise<FactExtractionResult> {
  const sections = await prisma.section.findMany({
    where: { docVersionId: ctx.docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  const resolved = await loadRulesForType(ctx.bundleId, "fact_extraction");
  const engine = resolved
    ? new RulesEngine({ factExtractions: toFactExtractionRules(resolved.rules) })
    : new RulesEngine();
  const extractor = engine.getFactExtractor();

  const prefixes = ctx.excludedSectionPrefixes ?? EXCLUDED_SECTION_PREFIXES;
  const eligibleSections = sections.filter(
    (s) => !s.standardSection || !prefixes.some((p) => s.standardSection!.startsWith(p)),
  );
  const titleToStandard = new Map<string, string>();
  for (const s of eligibleSections) {
    if (s.standardSection) titleToStandard.set(s.title, s.standardSection);
  }
  const sectionData = eligibleSections.map((s) => ({
    title: s.title,
    content: serializeContentBlocks(s.contentBlocks),
    isSynopsis: s.standardSection === "synopsis",
  }));

  // Phase 1+2: collect raw matches from regex AND from any persisted
  // table AST, then aggregate them through the same canonical-voting
  // pipeline so synopsis/body/table mentions of the same fact get
  // their confidence stacked.
  const rawCombined: ExtractedFact[] = [];
  const synopsisSection = sectionData.find((s) => s.isSynopsis);
  if (synopsisSection) {
    rawCombined.push(...extractor.extractRaw(synopsisSection.content, synopsisSection.title));
  }
  for (const s of sectionData) {
    if (s.isSynopsis) continue;
    rawCombined.push(...extractor.extractRaw(s.content, s.title));
  }
  for (const s of eligibleSections) {
    for (const cb of s.contentBlocks) {
      const ast = (cb as { tableAst?: unknown }).tableAst as TableAst | null | undefined;
      if (!ast || !Array.isArray(ast.rows)) continue;
      rawCombined.push(...extractRawFromTable(ast, s.title));
    }
  }
  const sectionPriors = await loadFactSectionPriors(ctx.bundleId);
  const filtered = sectionPriors
    ? rawCombined.filter((f) => factMatchesSectionPriors(f, sectionPriors, titleToStandard))
    : rawCombined;
  const extracted: AggregatedFact[] = aggregateByCanonical(filtered);
  const contradictions = detectContradictions(extracted);

  const groupedByKey = new Map<string, typeof extracted>();
  for (const fact of extracted) {
    const arr = groupedByKey.get(fact.factKey) ?? [];
    arr.push(fact);
    groupedByKey.set(fact.factKey, arr);
  }

  for (const [factKey, facts] of groupedByKey) {
    const hasContradiction = contradictions.some((c) => c.factKey === factKey);
    const best = facts.reduce((a, b) => (b.confidence > a.confidence ? b : a), facts[0]);
    const totalSourceCount = facts.reduce((sum, f) => sum + f.sourceCount, 0);
    const variants: FactVariant[] = facts.flatMap((f) =>
      f.sources.map((src) => ({
        value: f.value,
        confidence: f.confidence,
        level: "deterministic" as const,
        sourceText: src.textSnippet ?? "",
        sectionTitle: src.sectionTitle ?? "",
      })),
    );
    const sources = facts.flatMap((f) => f.sources);
    const standardSectionCode = best.source.sectionTitle
      ? titleToStandard.get(best.source.sectionTitle) ?? null
      : null;
    await prisma.fact.create({
      data: {
        docVersionId: ctx.docVersionId,
        factKey,
        factCategory: "general",
        value: best.value,
        canonicalValue: best.canonical,
        standardSectionCode,
        sourceCount: totalSourceCount,
        confidence: best.confidence,
        factClass: best.factClass,
        sources: sources as any,
        hasContradiction,
        status: "extracted",
        deterministicValue: best.value,
        deterministicConfidence: best.confidence,
        variants: variants as any,
      },
    });
  }

  return {
    data: {
      totalExtracted: extracted.length,
      uniqueFactKeys: groupedByKey.size,
      contradictions: contradictions.length,
      factKeys: [...groupedByKey.keys()],
    },
    ruleSnapshot: snapshotRules(resolved?.rules, {
      ruleSetVersionId: resolved?.ruleSetVersionId,
      ruleSetType: "fact_extraction",
    }),
  };
}

/* ═══════════════ Level 2: LLM Check (per-section discovery) ═══════════════ */

/**
 * Phase 3 fact-extraction roadmap: targeted LLM extraction.
 *
 * Instead of the broad per-section discovery prompt used by
 * `runLlmCheck`, this pass iterates the fact registry and for each
 * factKey finds the most relevant sections via BM25 (using
 * `fact_anchors` RuleSet keywords as the query). For each top
 * section, it issues a narrow "extract {factKey} or null" prompt.
 *
 * After the first pass, a gap-fill pass retries any factKey that
 * came back empty, with a slightly higher temperature and a
 * stricter "if not present, return null" instruction.
 *
 * Toggle via env `LLM_CHECK_MODE=targeted|broad` (broad = legacy).
 */
export async function runLlmCheckTargeted(
  ctx: FactExtractionContext,
  log: Logger,
): Promise<FactExtractionResult> {
  const llmConfig = await getEffectiveLlmConfig("fact_extraction_targeted", ctx.tenantId);
  if (!llmConfig.apiKey) {
    return { data: { message: "LLM API key not configured" } };
  }

  const sections = await prisma.section.findMany({
    where: { docVersionId: ctx.docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  const extractable = buildExtractableSections(
    sections,
    ctx.excludedSectionPrefixes ?? EXCLUDED_SECTION_PREFIXES,
  );
  if (extractable.length === 0) {
    return { data: { message: "No extractable sections", extracted: 0 } };
  }

  const resolved = await loadRulesForType(ctx.bundleId, "fact_extraction");
  const registryRules = (resolved?.rules ?? []).filter(
    (r) => r.pattern !== "system_prompt",
  );
  if (registryRules.length === 0) {
    return { data: { message: "No fact registry configured", extracted: 0 } };
  }

  const anchorsResolved = await loadRulesForType(ctx.bundleId, "fact_anchors");
  const anchorByFactKey = new Map<string, { ru: string[]; en: string[] }>();
  for (const r of anchorsResolved?.rules ?? []) {
    const cfg = (r.config ?? {}) as { factKey?: string; keywords?: { ru?: string[]; en?: string[] } };
    if (!cfg.factKey || !cfg.keywords) continue;
    anchorByFactKey.set(cfg.factKey, {
      ru: cfg.keywords.ru ?? [],
      en: cfg.keywords.en ?? [],
    });
  }

  const { Bm25Index } = await import("@clinscriptum/rules-engine");
  const bm25 = new Bm25Index();
  for (const s of extractable) bm25.add(s.id, `${s.title}\n${s.text}`);

  const gateway = new LLMGateway({
    provider: llmConfig.provider as LLMProvider,
    model: llmConfig.model,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl || undefined,
    temperature: llmConfig.temperature,
    thinkingEnabled: ctx.llmThinkingEnabled,
    reasoningMode: llmConfig.reasoningMode,
    timeoutMs: llmConfig.timeoutMs,
  });

  let totalTokens = 0;
  let parseErrors = 0;
  const recovered: string[] = [];
  const allRaw: ExtractedFact[] = [];
  const sectionById = new Map<string, SectionForExtraction>();
  for (const s of extractable) sectionById.set(s.id, s);

  const askForFact = async (
    factKey: string,
    section: SectionForExtraction,
    temperature: number,
  ): Promise<{ value: string | null; confidence: number; sourceText: string }> => {
    const sys = `Ты — эксперт по клиническим протоколам. Извлеки одно значение по запросу.

ПРАВИЛА:
1. Если в тексте нет искомого факта, верни {"value": null, "confidence": 0, "source_text": ""}.
2. value — конкретное значение, не пересказ.
3. source_text — точная цитата (до 200 символов).
4. confidence: 0.0–1.0.

ФОРМАТ ОТВЕТА — только JSON: {"value":"...","confidence":0.9,"source_text":"..."}`;
    const user = `НАЙДИ ФАКТ: ${factKey}

РАЗДЕЛ: ${section.title}

${section.text}`;
    try {
      const response = await gateway.generate({
        system: sys,
        messages: [{ role: "user", content: user }],
        maxTokens: llmConfig.maxTokens,
        responseFormat: "json",
        temperature,
      });
      totalTokens += response.usage.totalTokens;
      const result = parseLlmJson(response.content, TargetedFactSchema);
      if (!result.ok) {
        parseErrors++;
        log.warn("[facts:targeted] Parse error", {
          factKey,
          sectionId: section.id,
          error: result.error,
        });
        return { value: null, confidence: 0, sourceText: "" };
      }
      const data = result.data;
      if (!data.value || !data.value.trim()) {
        return { value: null, confidence: 0, sourceText: "" };
      }
      return {
        value: data.value.trim().slice(0, 240),
        confidence: data.confidence ?? 0,
        sourceText: (data.source_text ?? "").slice(0, 240),
      };
    } catch (err) {
      parseErrors++;
      log.warn("[facts:targeted] LLM error", {
        factKey,
        sectionId: section.id,
        error: (err as Error).message,
      });
      return { value: null, confidence: 0, sourceText: "" };
    }
  };

  const CRITICAL_KEYS = new Set(
    (process.env.LLM_FACT_CRITICAL_KEYS ?? "study_drug,sample_size,primary_endpoint,study_phase")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
  const SELF_CONSISTENCY_THRESHOLD = 0.7;

  /** Self-consistency: 3 calls at T=0.3, majority vote by canonical form. */
  const askForFactWithConsistency = async (
    factKey: string,
    section: SectionForExtraction,
  ): Promise<ReturnType<typeof askForFact>> => {
    const single = await askForFact(factKey, section, llmConfig.temperature);
    if (!single.value || single.confidence >= SELF_CONSISTENCY_THRESHOLD) return single;
    if (!CRITICAL_KEYS.has(factKey)) return single;
    const samples = [single];
    for (let i = 0; i < 2; i++) {
      const s = await askForFact(factKey, section, 0.3);
      if (s.value) samples.push(s);
    }
    if (samples.length < 2) return single;
    const counts = new Map<string, { sample: typeof single; count: number }>();
    for (const s of samples) {
      if (!s.value) continue;
      const { canonical } = canonicalize(factKey, s.value);
      const entry = counts.get(canonical) ?? { sample: s, count: 0 };
      entry.count++;
      counts.set(canonical, entry);
    }
    let bestCanonical: string | null = null;
    let bestCount = 0;
    for (const [c, e] of counts) {
      if (e.count > bestCount) {
        bestCount = e.count;
        bestCanonical = c;
      }
    }
    if (!bestCanonical) return single;
    const winner = counts.get(bestCanonical)!.sample;
    const boost = Math.min(0.95, winner.confidence + 0.1 * (bestCount - 1));
    return { ...winner, confidence: boost };
  };

  // First pass: BM25 → top-3 sections per factKey, single targeted call each.
  for (const rule of registryRules) {
    const factKey = rule.pattern;
    const cfg = (rule.config ?? {}) as { category?: string };
    const category = cfg.category ?? "general";
    const factClass: ExtractedFact["factClass"] =
      category === "phase_specific" ? "phase_specific" : "general";

    const anchors = anchorByFactKey.get(factKey);
    const queryTerms = anchors
      ? [...anchors.ru, ...anchors.en].join(" ")
      : factKey.replace(/_/g, " ");
    const hits = bm25.topK(queryTerms, 3);
    for (const hit of hits) {
      const section = sectionById.get(hit.docId);
      if (!section) continue;
      const out = await askForFactWithConsistency(factKey, section);
      if (!out.value) continue;
      allRaw.push({
        factKey,
        value: out.value,
        factClass,
        source: {
          sectionTitle: section.title,
          textSnippet: out.sourceText || section.text.slice(0, 240),
          method: "llm",
        },
      });
    }
  }

  // Gap-fill: any factKey not yet found, retry with T=0.3 against top-1
  // section. The narrower temperature signals to the model that the
  // answer is either present verbatim or absent.
  const foundKeys = new Set(allRaw.map((f) => f.factKey));
  for (const rule of registryRules) {
    const factKey = rule.pattern;
    if (foundKeys.has(factKey)) continue;
    const anchors = anchorByFactKey.get(factKey);
    const queryTerms = anchors
      ? [...anchors.ru, ...anchors.en].join(" ")
      : factKey.replace(/_/g, " ");
    const hits = bm25.topK(queryTerms, 1);
    if (hits.length === 0) continue;
    const section = sectionById.get(hits[0].docId);
    if (!section) continue;
    const out = await askForFact(factKey, section, 0.3);
    if (!out.value) continue;
    const cfg = (rule.config ?? {}) as { category?: string };
    const factClass: ExtractedFact["factClass"] =
      cfg.category === "phase_specific" ? "phase_specific" : "general";
    allRaw.push({
      factKey,
      value: out.value,
      factClass,
      source: {
        sectionTitle: section.title,
        textSnippet: out.sourceText || section.text.slice(0, 240),
        method: "llm",
      },
    });
    recovered.push(factKey);
  }

  const aggregated = aggregateByCanonical(allRaw);

  // Persist as Fact rows; merge with existing deterministic rows by factKey.
  const existingFacts = await prisma.fact.findMany({ where: { docVersionId: ctx.docVersionId } });
  const existingByKey = new Map<string, typeof existingFacts[0]>();
  for (const f of existingFacts) existingByKey.set(f.factKey, f);

  const groupedByKey = new Map<string, AggregatedFact[]>();
  for (const a of aggregated) {
    const arr = groupedByKey.get(a.factKey) ?? [];
    arr.push(a);
    groupedByKey.set(a.factKey, arr);
  }

  let updatedCount = 0;
  let newCount = 0;
  for (const [factKey, facts] of groupedByKey) {
    const best = facts.reduce((a, b) => (b.confidence > a.confidence ? b : a), facts[0]);
    const variants: FactVariant[] = facts.flatMap((f) =>
      f.sources.map((src) => ({
        value: f.value,
        confidence: f.confidence,
        level: "llm_check" as const,
        sourceText: src.textSnippet ?? "",
        sectionTitle: src.sectionTitle ?? "",
      })),
    );
    const existing = existingByKey.get(factKey);
    if (existing) {
      const existingVariants = Array.isArray(existing.variants)
        ? (existing.variants as unknown as FactVariant[])
        : [];
      await prisma.fact.update({
        where: { id: existing.id },
        data: {
          llmValue: best.value,
          llmConfidence: best.confidence,
          value: best.value,
          confidence: best.confidence,
          variants: [...existingVariants, ...variants] as any,
        },
      });
      updatedCount++;
    } else {
      await prisma.fact.create({
        data: {
          docVersionId: ctx.docVersionId,
          factKey,
          factCategory: "general",
          value: best.value,
          canonicalValue: best.canonical,
          sourceCount: facts.reduce((sum, f) => sum + f.sourceCount, 0),
          confidence: best.confidence,
          factClass: best.factClass,
          sources: facts.flatMap((f) => f.sources) as any,
          hasContradiction: false,
          status: "extracted",
          llmValue: best.value,
          llmConfidence: best.confidence,
          variants: variants as any,
        },
      });
      newCount++;
    }
  }

  log.info("[facts:targeted] Complete", {
    factKeys: registryRules.length,
    extracted: allRaw.length,
    updated: updatedCount,
    new: newCount,
    gapFilled: recovered.length,
    parseErrors,
    tokens: totalTokens,
  });

  return {
    data: {
      mode: "targeted",
      factKeys: registryRules.length,
      extracted: allRaw.length,
      updated: updatedCount,
      newFacts: newCount,
      gapFilled: recovered.length,
      gapFilledKeys: recovered,
      parseErrors,
      totalTokens,
    },
    llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
  };
}

export async function runLlmCheck(
  ctx: FactExtractionContext,
  log: Logger,
): Promise<FactExtractionResult> {
  if ((process.env.LLM_CHECK_MODE ?? "broad").toLowerCase() === "targeted") {
    return runLlmCheckTargeted(ctx, log);
  }
  const llmConfig = await getEffectiveLlmConfig("fact_extraction", ctx.tenantId);
  if (!llmConfig.apiKey) {
    return { data: { message: "LLM API key not configured" } };
  }

  const sections = await prisma.section.findMany({
    where: { docVersionId: ctx.docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  const extractable = buildExtractableSections(sections, ctx.excludedSectionPrefixes ?? EXCLUDED_SECTION_PREFIXES);
  if (extractable.length === 0) {
    return { data: { message: "No extractable sections", extracted: 0 } };
  }

  const resolved = await loadRulesForType(ctx.bundleId, "fact_extraction");
  const registryRules = resolved?.rules ?? [];
  const registryList = registryRules
    .filter((r) => r.pattern !== "system_prompt")
    .map((r) => {
      const cfg = (r.config ?? {}) as Record<string, unknown>;
      const desc = (cfg.description as string) ?? r.name;
      const valueType = (cfg.valueType as string) ?? "string";
      const labels = Array.isArray(cfg.labelsRu) ? (cfg.labelsRu as string[]).join(", ") : "";
      const category = (cfg.category as string) ?? "general";
      return `- ${category}.${r.pattern}: ${desc} (тип: ${valueType}${labels ? `, метки: ${labels}` : ""})`;
    })
    .join("\n");

  const systemPrompt = `Ты — эксперт по клиническим протоколам. Извлеки факты из раздела документа.

Тебе дан реестр известных фактов и текст одного раздела документа.
Найди значения фактов из реестра, присутствующие в этом разделе.
Также найди другие важные факты, которых нет в реестре.

РЕЕСТР ФАКТОВ:
${registryList}

ПРАВИЛА:
1. Извлекай только факты, ЯВНО присутствующие в тексте раздела
2. Значение факта — конкретное значение (имя, число, дата, описание), НЕ пересказ контекста
3. source_text — точная цитата из текста (до 200 символов), откуда извлечено значение
4. Если в разделе нет фактов из реестра — верни пустой массив []
5. confidence: 0.0–1.0

ФОРМАТ ОТВЕТА — только JSON-массив (без markdown):
[{"fact_key":"category.key","value":"значение","confidence":0.9,"source_text":"цитата"}]`;

  const inputBudget = getInputBudgetChars(llmConfig);
  const contentBudget = inputBudget - systemPrompt.length - 200;
  const sectionGroups = groupRelatedSections(extractable, contentBudget);

  const gateway = new LLMGateway({
    provider: llmConfig.provider as LLMProvider,
    model: llmConfig.model,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl || undefined,
    temperature: llmConfig.temperature,
    thinkingEnabled: ctx.llmThinkingEnabled,
    reasoningMode: llmConfig.reasoningMode,
    timeoutMs: llmConfig.timeoutMs,
  });

  const existingFacts = await prisma.fact.findMany({ where: { docVersionId: ctx.docVersionId } });
  const factByKey = new Map<string, typeof existingFacts[0]>();
  for (const f of existingFacts) factByKey.set(f.factKey, f);

  interface RawExtracted {
    factKey: string;
    category: string;
    value: string;
    confidence: number;
    sourceText: string;
    sectionTitle: string;
    sectionId: string;
  }

  let totalTokens = 0;
  let parseErrors = 0;
  let skippedSections = 0;
  let retries = 0;
  const allExtracted: RawExtracted[] = [];

  const extractFromGroup = async (group: SectionForExtraction[]): Promise<void> => {
    const sectionText = group
      .map((s) => `[РАЗДЕЛ: ${s.title}]\n${s.text}`)
      .join("\n\n");

    const userMessage = `РАЗДЕЛ ДОКУМЕНТА: ${group.map((s) => s.title).join(" → ")}

${sectionText}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          retries++;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }

        const response = await gateway.generate({
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
          maxTokens: llmConfig.maxTokens,
          responseFormat: "json",
        });

        totalTokens += response.usage.totalTokens;

        const parsed = parseLlmJsonArray(response.content);
        if (!parsed) {
          if (attempt === MAX_RETRIES) {
            parseErrors++;
            log.warn("[facts:llm_check] Parse error", {
              section: group[0].title,
              preview: response.content.slice(0, 200),
            });
          }
          continue;
        }

        if (parsed.length === 0) {
          skippedSections++;
          return;
        }

        for (const raw of parsed) {
          const item = raw as Record<string, unknown>;
          const fullKey = String(item.fact_key ?? item.factKey ?? "");
          if (!fullKey) continue;
          const dotIdx = fullKey.indexOf(".");
          const factKey = dotIdx > -1 ? fullKey.slice(dotIdx + 1) : fullKey;
          const category = dotIdx > -1 ? fullKey.slice(0, dotIdx) : "general";
          const value = String(item.value ?? "").trim();
          if (!value || value.length < 2) continue;

          const conf = typeof item.confidence === "number"
            ? Math.min(Math.max(item.confidence, 0), 1)
            : 0.5;

          allExtracted.push({
            factKey,
            category,
            value,
            confidence: conf,
            sourceText: String(item.source_text ?? item.sourceText ?? "").slice(0, 500),
            sectionTitle: group[0].title,
            sectionId: group[0].id,
          });
        }
        return;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          parseErrors++;
          log.warn("[facts:llm_check] Section error", {
            section: group[0].title, error: String(err),
          });
        }
      }
    }
  };

  await runWithConcurrency(
    sectionGroups.map((g) => () => extractFromGroup(g)),
    LLM_CONCURRENCY,
  );

  const grouped = new Map<string, RawExtracted[]>();
  for (const ex of allExtracted) {
    const arr = grouped.get(ex.factKey) ?? [];
    arr.push(ex);
    grouped.set(ex.factKey, arr);
  }

  let updatedCount = 0;
  let newCount = 0;
  let contradictionCount = 0;

  for (const [factKey, extractions] of grouped) {
    const best = extractions.reduce((a, b) => a.confidence >= b.confidence ? a : b);
    const uniqueValues = [...new Set(extractions.map((e) => e.value))];
    const hasContradiction = uniqueValues.length > 1;
    if (hasContradiction) contradictionCount++;

    const variants: FactVariant[] = extractions.map((e) => ({
      value: e.value,
      confidence: e.confidence,
      level: "llm_check" as const,
      sourceText: e.sourceText,
      sectionTitle: e.sectionTitle,
      sectionId: e.sectionId,
    }));

    const existing = factByKey.get(factKey);
    if (existing) {
      const existingVariants = Array.isArray(existing.variants) ? (existing.variants as unknown as FactVariant[]) : [];
      await prisma.fact.update({
        where: { id: existing.id },
        data: {
          llmValue: best.value,
          llmConfidence: best.confidence,
          value: best.value,
          confidence: best.confidence,
          hasContradiction: existing.hasContradiction || hasContradiction,
          variants: [...existingVariants, ...variants] as any,
        },
      });
      updatedCount++;
    } else {
      await prisma.fact.create({
        data: {
          docVersionId: ctx.docVersionId,
          factKey,
          factCategory: best.category,
          value: best.value,
          confidence: best.confidence,
          factClass: "general",
          sources: extractions.map((e) => ({
            sectionTitle: e.sectionTitle,
            text: e.sourceText,
            isSynopsis: false,
          })) as any,
          hasContradiction,
          status: "extracted",
          llmValue: best.value,
          llmConfidence: best.confidence,
          variants: variants as any,
        },
      });
      newCount++;
    }
  }

  log.info("[facts:llm_check] Complete", {
    sections: sectionGroups.length, totalExtracted: allExtracted.length,
    updated: updatedCount, new: newCount, tokens: totalTokens,
  });

  return {
    data: {
      sections: sectionGroups.length,
      totalExtracted: allExtracted.length,
      updated: updatedCount,
      newFacts: newCount,
      contradictions: contradictionCount,
      skippedSections,
      parseErrors,
      retries,
      totalTokens,
    },
    llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
  };
}

/* ═══════════════ Level 3: LLM QA ═══════════════ */

export async function runLlmQa(
  ctx: FactExtractionContext,
  log: Logger,
): Promise<FactExtractionResult> {
  const facts = await prisma.fact.findMany({ where: { docVersionId: ctx.docVersionId } });

  const lowConfidence = facts.filter((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && f.confidence > 0);
  const disagreements = facts.filter(
    (f) => f.deterministicValue && f.llmValue && f.deterministicValue !== f.llmValue,
  );
  const toCheck = [
    ...lowConfidence,
    ...disagreements.filter((d) => !lowConfidence.some((l) => l.id === d.id)),
  ];

  if (toCheck.length === 0) {
    return { data: { message: "No facts require QA", checked: 0 } };
  }

  const llmConfig = await getEffectiveLlmConfig("fact_extraction_qa", ctx.tenantId);
  if (!llmConfig.apiKey) {
    return { data: { message: "QA LLM API key not configured" } };
  }

  const sections = await prisma.section.findMany({
    where: { docVersionId: ctx.docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  const qaInputBudget = getInputBudgetChars(llmConfig);

  // Phase 4: scope context to only sections that produced one of the
  // facts under review. Falls back to the legacy whole-doc snippet if
  // no variant carries a sectionId (older facts).
  const referencedSectionIds = new Set<string>();
  for (const f of toCheck) {
    const variants = Array.isArray(f.variants) ? (f.variants as unknown as FactVariant[]) : [];
    for (const v of variants) {
      if (v.sectionId) referencedSectionIds.add(v.sectionId);
    }
  }

  const qaPrefixes = ctx.excludedSectionPrefixes ?? EXCLUDED_SECTION_PREFIXES;
  const filteredSections = sections.filter(
    (s) => !s.standardSection || !qaPrefixes.some((p) => s.standardSection!.startsWith(p)),
  );
  const scopedSections =
    referencedSectionIds.size > 0
      ? filteredSections.filter((s) => referencedSectionIds.has(s.id))
      : filteredSections;
  const docSnippet = scopedSections
    .map((s) => `[${s.title}]\n${s.contentBlocks.map((b) => b.content).join("\n")}`)
    .join("\n")
    .slice(0, qaInputBudget);

  const factsSummary = toCheck
    .map((f) => {
      const src = (f.sources as any[])?.map((s: any) => `"${s.text ?? s.textSnippet ?? ""}"`).join("; ") ?? "";
      const algoVal = f.deterministicValue ? `алго="${f.deterministicValue}"` : "";
      const llmVal = f.llmValue ? `LLM="${f.llmValue}"` : "";
      return `- ${f.factCategory}.${f.factKey}: значение="${f.value}", уверенность=${f.confidence}, ${algoVal} ${llmVal}, источники: ${src}`;
    })
    .join("\n");

  const systemPrompt = `Ты — QA-аудитор извлечения фактов из клинического протокола.
Тебе даны факты с низкой уверенностью или расхождением между алгоритмом и LLM.
Для каждого факта:
1. Проверь правильность значения по тексту документа.
2. Если алгоритм и LLM дали разные значения — выбери правильное или предложи своё.
3. Укажи итоговую уверенность.

Верни СТРОГО JSON массив (без markdown):
[
  { "fact_key": "category.key", "correct": true, "corrected_value": "значение если correct=false", "new_confidence": 0.9, "reason": "обоснование" }
]`;

  const gateway = new LLMGateway({
    provider: llmConfig.provider as LLMProvider,
    model: llmConfig.model,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl || undefined,
    temperature: llmConfig.temperature,
    thinkingEnabled: ctx.llmThinkingEnabled,
    reasoningMode: llmConfig.reasoningMode,
    timeoutMs: llmConfig.timeoutMs,
  });

  let correctedCount = 0;
  let confirmedCount = 0;

  try {
    const response = await gateway.generate({
      system: systemPrompt,
      messages: [{ role: "user", content: `ФАКТЫ ДЛЯ ПРОВЕРКИ:\n${factsSummary}\n\nКОНТЕКСТ ДОКУМЕНТА:\n${docSnippet}` }],
      maxTokens: llmConfig.maxTokens,
      responseFormat: "json",
    });

    try {
      const cleaned = response.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const corrections = JSON.parse(jsonMatch[0]) as any[];

        for (const correction of corrections) {
          const fullKey = correction.fact_key as string;
          const dotIdx = fullKey.indexOf(".");
          const factKey = dotIdx > -1 ? fullKey.slice(dotIdx + 1) : fullKey;
          const category = dotIdx > -1 ? fullKey.slice(0, dotIdx) : "";

          const fact = toCheck.find(
            (f) => f.factKey === factKey && (!category || f.factCategory === category),
          );
          if (!fact) continue;

          const qaConf = typeof correction.new_confidence === "number"
            ? Math.min(Math.max(correction.new_confidence, 0), 1)
            : fact.confidence;

          const existingVariants = Array.isArray(fact.variants) ? (fact.variants as unknown as FactVariant[]) : [];

          if (correction.correct === false && correction.corrected_value) {
            const correctedVal = String(correction.corrected_value);
            const qaVariant: FactVariant = {
              value: correctedVal,
              confidence: qaConf,
              level: "llm_qa",
              sourceText: String(correction.reason ?? ""),
              sectionTitle: "",
            };
            await prisma.fact.update({
              where: { id: fact.id },
              data: {
                qaValue: correctedVal, qaConfidence: qaConf,
                value: correctedVal, confidence: qaConf,
                variants: [...existingVariants, qaVariant] as any,
              },
            });
            correctedCount++;
          } else {
            const qaVariant: FactVariant = {
              value: fact.value,
              confidence: qaConf,
              level: "llm_qa",
              sourceText: String(correction.reason ?? ""),
              sectionTitle: "",
            };
            await prisma.fact.update({
              where: { id: fact.id },
              data: {
                qaValue: fact.value, qaConfidence: qaConf, confidence: qaConf,
                variants: [...existingVariants, qaVariant] as any,
              },
            });
            confirmedCount++;
          }
        }
      }
    } catch (err) {
      log.warn("[facts:llm_qa] Failed to parse QA response", { error: String(err) });
    }

    return {
      data: { checked: toCheck.length, corrected: correctedCount, confirmed: confirmedCount, tokensUsed: response.usage.totalTokens },
      llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
    };
  } catch (llmErr) {
    log.warn("[facts:llm_qa] LLM QA unavailable, continuing without QA", { error: String(llmErr) });
    return {
      data: { message: "LLM QA unavailable, skipped", checked: toCheck.length, corrected: 0, confirmed: 0 },
      llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
    };
  }
}
