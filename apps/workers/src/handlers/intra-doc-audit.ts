import { prisma, getEffectiveLlmConfig, toConfigSnapshot, loadRulesForType, snapshotRules, getInputBudgetChars } from "@clinscriptum/db";
import { toAuditPromptMap } from "@clinscriptum/rules-engine";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";
import { logger } from "../lib/logger.js";
import { runWithConcurrency } from "../lib/concurrency.js";
import { loadSections, invalidateSectionsCache } from "../lib/section-cache.js";

interface AuditFinding {
  type: "editorial" | "semantic";
  description: string;
  suggestion: string | null;
  sourceText: string;
  sectionTitle?: string;
  severity: "low" | "medium" | "high" | "info";
  issueType?: string;
  block?: string;
  field?: string;
  referenceQuote?: string;
  confidence?: string;
  contextStatus?: string;
  editorialFix?: string;
}

interface ZoneText {
  zone: string;
  titles: string[];
  text: string;
}

/* ═══════════════ Cross-check pair detection ═══════════════ */

const ZONE_AFFINITY_MAP: [string, string][] = [
  // Synopsis → detail sections (synopsis is a summary, must match all key sections)
  ["synopsis", "study_design"],
  ["synopsis", "study_objectives"],
  ["synopsis", "study_population"],
  ["synopsis", "treatments"],
  ["synopsis", "efficacy_assessments"],
  ["synopsis", "safety_assessments"],
  ["synopsis", "statistics"],
  ["synopsis", "schedule_of_assessments"],
  // Objectives ↔ endpoints / statistics
  ["study_objectives", "efficacy_assessments"],
  ["study_objectives", "statistics"],
  // Endpoints ↔ statistics / SoA
  ["efficacy_assessments", "statistics"],
  ["efficacy_assessments", "schedule_of_assessments"],
  // Design ↔ SoA / population
  ["study_design", "schedule_of_assessments"],
  ["study_design", "study_population"],
  ["study_design", "appendices"],
  // Safety ↔ treatments / SoA / population / ethics
  ["safety_assessments", "treatments"],
  ["safety_assessments", "schedule_of_assessments"],
  ["safety_assessments", "study_population"],
  ["safety_assessments", "ethics"],
  // Population ↔ statistics
  ["study_population", "statistics"],
  // Treatments ↔ SoA
  ["treatments", "schedule_of_assessments"],
];

function detectCrossCheckPairs(
  availableZones: Set<string>,
): [string, string][] {
  return ZONE_AFFINITY_MAP.filter(
    ([a, b]) => availableZones.has(a) && availableZones.has(b),
  );
}

function resolveCrossCheckPairs(
  configuredPairs: [string, string][] | null | undefined,
  availableZones: Set<string>,
): [string, string][] {
  if (configuredPairs && configuredPairs.length > 0) {
    return configuredPairs.filter(
      ([a, b]) => availableZones.has(a) && availableZones.has(b),
    );
  }
  return detectCrossCheckPairs(availableZones);
}

const LLM_CONCURRENCY = 3;

/* ═══════════════ Deduplication ═══════════════ */

function deduplicateFindings<T extends { id: string; type: string; description: string; sourceRef: unknown; extraAttributes: unknown }>(
  findings: T[],
): T[] {
  const kept: T[] = [];
  for (const f of findings) {
    const isDupe = kept.some((k) => {
      const descSim = normalizeText(k.description) === normalizeText(f.description);
      if (descSim) return true;
      const refA = (k.sourceRef as Record<string, unknown> | null)?.textSnippet as string | undefined;
      const refB = (f.sourceRef as Record<string, unknown> | null)?.textSnippet as string | undefined;
      if (refA && refB && refA.length > 20 && refB.length > 20) {
        return k.type === f.type && overlapRatio(refA, refB) > 0.7;
      }
      return false;
    });
    if (!isDupe) kept.push(f);
  }
  return kept;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function overlapRatio(a: string, b: string): number {
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  const window = Math.min(shorter.length, 60);
  const sample = shorter.slice(0, window);
  return longer.includes(sample) ? 1 : 0;
}

/* ═══════════════ Zone builder ═══════════════ */

function buildZoneTexts(
  sections: Array<{ title: string; standardSection: string | null; contentBlocks: Array<{ content: string }> }>,
): ZoneText[] {
  const zoneMap = new Map<string, { titles: string[]; parts: string[] }>();

  for (const s of sections) {
    const zone = s.standardSection ?? "__unclassified__";
    const rootZone = zone.split(".")[0];
    if (!zoneMap.has(rootZone)) {
      zoneMap.set(rootZone, { titles: [], parts: [] });
    }
    const entry = zoneMap.get(rootZone)!;
    entry.titles.push(s.title);
    entry.parts.push(`## ${s.title}\n${s.contentBlocks.map((b) => b.content).join("\n")}`);
  }

  return Array.from(zoneMap.entries()).map(([zone, data]) => ({
    zone,
    titles: data.titles,
    text: data.parts.join("\n\n"),
  }));
}

function buildFullDocumentText(
  sections: Array<{ title: string; contentBlocks: Array<{ content: string }> }>,
): string {
  const parts: string[] = [];
  for (const section of sections) {
    parts.push(`\n## ${section.title}\n`);
    for (const block of section.contentBlocks) {
      parts.push(block.content);
    }
  }
  return parts.join("\n");
}

/* ═══════════════ Handler ═══════════════ */

export async function handleIntraDocAudit(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
  restoreStatusOnComplete?: boolean;
}) {
  /* ───── Level 1: Deterministic ───── */

  const deterministicHandler: PipelineStepHandler = {
    level: "deterministic",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const sections = await loadSections(ctx);

      const findings: AuditFinding[] = [];

      for (const section of sections) {
        for (const block of section.contentBlocks) {
          const editorialIssues = runEditorialChecks(block.content, section.title);
          findings.push(...editorialIssues);
        }
      }

      for (const finding of findings) {
        await prisma.finding.create({
          data: {
            docVersionId: ctx.docVersionId,
            type: finding.type,
            description: finding.description,
            suggestion: finding.suggestion,
            sourceRef: {
              sectionTitle: finding.sectionTitle,
              textSnippet: finding.sourceText.slice(0, 200),
            },
            status: "pending",
            extraAttributes: { severity: finding.severity, method: "deterministic" },
          },
        });
      }

      return {
        data: { deterministicFindings: findings.length },
        needsNextStep: true,
      };
    },
  };

  /* ───── Level 2: LLM Check — two variants ───── */

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const sections = await loadSections(ctx);

      const llmConfig = await getEffectiveLlmConfig("intra_audit", ctx.tenantId);
      if (!llmConfig.apiKey) {
        return { data: { message: "LLM API key not configured, skipping LLM audit" }, needsNextStep: true };
      }

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

      const auditRules = await loadRulesForType(ctx.bundleId, "intra_audit");
      const promptMap = auditRules ? toAuditPromptMap(auditRules.rules) : new Map<string, string>();
      const auditSystemPrompt = promptMap.get("system_prompt") || AUDIT_SYSTEM_PROMPT;
      const selfCheckPrompt = promptMap.get("self_check_prompt") || SELF_CHECK_SYSTEM_PROMPT;
      const crossCheckPrompt = promptMap.get("cross_check_prompt") || CROSS_CHECK_SYSTEM_PROMPT;
      const editorialPrompt = promptMap.get("editorial_prompt") || EDITORIAL_SYSTEM_PROMPT;

      const inputBudget = getInputBudgetChars(llmConfig);
      const fullDocText = buildFullDocumentText(sections);
      const totalPromptSize = auditSystemPrompt.length + fullDocText.length + 200;
      const fitsInContext = totalPromptSize <= inputBudget;

      const auditMode = ctx.auditMode ?? "auto";
      const useVariant1 =
        auditMode === "single_call" ? fitsInContext :
        auditMode === "zone_based" ? false :
        fitsInContext; // "auto" — original behavior

      let totalFindings = 0;
      let totalTokens = 0;

      try {
        if (useVariant1) {
          /* ─── Variant 1: full document in single call ─── */
          logger.info("[audit:llm_check] Variant 1: full document in single call", {
            docChars: fullDocText.length, budget: inputBudget, auditMode,
          });

          const response = await gateway.generate({
            system: auditSystemPrompt,
            messages: [{ role: "user", content: `Проанализируй следующий клинический протокол на внутренние несоответствия:\n\n${fullDocText}` }],
            maxTokens: llmConfig.maxTokens,
            responseFormat: "json",
          });

          totalTokens = response.usage.totalTokens;
          const llmFindings = parseLLMFindings(response.content);
          totalFindings = llmFindings.length;

          for (const finding of llmFindings) {
            await prisma.finding.create({
              data: {
                docVersionId: ctx.docVersionId,
                type: finding.type,
                description: finding.description,
                suggestion: finding.suggestion,
                sourceRef: { textSnippet: finding.sourceText, referenceQuote: finding.referenceQuote },
                status: finding.contextStatus === "insufficient_context" ? "false_positive" : "pending",
                extraAttributes: {
                  severity: finding.severity, method: "llm",
                  issueType: finding.issueType, block: finding.block, field: finding.field,
                  confidence: finding.confidence, contextStatus: finding.contextStatus,
                  editorialFix: finding.editorialFix,
                },
              },
            });
          }
        } else {
          /* ─── Variant 2: zone-based chunking with parallel execution ─── */
          const zones = buildZoneTexts(sections);
          const zoneMap = new Map(zones.map((z) => [z.zone, z]));
          const availableZones = new Set(zones.map((z) => z.zone));
          const crossPairs = resolveCrossCheckPairs(ctx.crossCheckPairs, availableZones);

          logger.info("[audit:llm_check] Variant 2: zone-based chunking", {
            zones: zones.length, docChars: fullDocText.length, budget: inputBudget,
            auditMode, crossPairsCount: crossPairs.length,
            crossPairsSource: ctx.crossCheckPairs?.length ? "manual" : "auto",
          });

          interface AuditTask {
            kind: "self_check" | "cross_check" | "self_editorial";
            targetZone: string;
            anchorZone?: string;
            systemPrompt: string;
            userContent: string;
          }

          const tasks: AuditTask[] = [];
          const contentBudget = inputBudget - auditSystemPrompt.length - 500;

          for (const zone of zones) {
            const zoneText = zone.text.slice(0, contentBudget);

            tasks.push({
              kind: "self_check",
              targetZone: zone.zone,
              systemPrompt: selfCheckPrompt,
              userContent: `ЗОНА: ${zone.zone} (секции: ${zone.titles.join(", ")})\n\n${zoneText}`,
            });

            tasks.push({
              kind: "self_editorial",
              targetZone: zone.zone,
              systemPrompt: editorialPrompt,
              userContent: `ЗОНА: ${zone.zone}\n\n${zoneText}`,
            });
          }

          for (const [anchorKey, targetKey] of crossPairs) {
            const anchor = zoneMap.get(anchorKey);
            const target = zoneMap.get(targetKey);
            if (!anchor || !target) continue;

            const halfBudget = Math.floor(contentBudget / 2);
            const anchorText = anchor.text.slice(0, halfBudget);
            const targetText = target.text.slice(0, halfBudget);

            tasks.push({
              kind: "cross_check",
              targetZone: targetKey,
              anchorZone: anchorKey,
              systemPrompt: crossCheckPrompt,
              userContent: `РЕФЕРЕНСНАЯ ЗОНА (${anchorKey}):\n${anchorText}\n\n---\n\nПРОВЕРЯЕМАЯ ЗОНА (${targetKey}):\n${targetText}`,
            });
          }

          logger.info("[audit:llm_check] Generated audit tasks", {
            selfCheck: tasks.filter((t) => t.kind === "self_check").length,
            crossCheck: tasks.filter((t) => t.kind === "cross_check").length,
            editorial: tasks.filter((t) => t.kind === "self_editorial").length,
          });

          const taskResults = await runWithConcurrency(
            tasks.map((task, i) => async () => {
              logger.info(`[audit:llm_check] Task ${i + 1}/${tasks.length}: ${task.kind}`, {
                target: task.targetZone,
                anchor: task.anchorZone,
              });

              const response = await gateway.generate({
                system: task.systemPrompt,
                messages: [{ role: "user", content: task.userContent }],
                maxTokens: llmConfig.maxTokens,
                responseFormat: "json",
              });

              return { task, response };
            }),
            LLM_CONCURRENCY,
          );

          for (const { task, response } of taskResults) {
            totalTokens += response.usage.totalTokens;
            const llmFindings = parseLLMFindings(response.content);
            totalFindings += llmFindings.length;

            for (const finding of llmFindings) {
              await prisma.finding.create({
                data: {
                  docVersionId: ctx.docVersionId,
                  type: finding.type,
                  description: finding.description,
                  suggestion: finding.suggestion,
                  sourceRef: {
                    textSnippet: finding.sourceText,
                    referenceQuote: finding.referenceQuote,
                    zone: task.targetZone,
                    anchorZone: task.anchorZone,
                    taskKind: task.kind,
                  },
                  status: finding.contextStatus === "insufficient_context" ? "false_positive" : "pending",
                  extraAttributes: {
                    severity: finding.severity, method: "llm", taskKind: task.kind,
                    issueType: finding.issueType, block: finding.block, field: finding.field,
                    confidence: finding.confidence, contextStatus: finding.contextStatus,
                    editorialFix: finding.editorialFix,
                  },
                },
              });
            }
          }
        }

        invalidateSectionsCache(ctx);

        return {
          data: { llmFindings: totalFindings, tokensUsed: totalTokens, auditMode, variant: useVariant1 ? 1 : 2 },
          needsNextStep: true,
          llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
          ruleSnapshot: snapshotRules(auditRules?.rules, {
            ruleSetVersionId: auditRules?.ruleSetVersionId,
            ruleSetType: "intra_audit",
          }),
        };
      } catch (llmErr) {
        const errorMessage = llmErr instanceof Error ? llmErr.message : String(llmErr);
        logger.error("LLM audit failed, continuing with deterministic findings only", {
          error: errorMessage,
          provider: llmConfig.provider,
          model: llmConfig.model,
        });
        return {
          data: { message: "LLM unavailable, skipped", llmFindings: totalFindings, llmError: errorMessage },
          needsNextStep: true,
          llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
        };
      }
    },
  };

  /* ───── Level 3: LLM QA — verify findings with adaptive context ───── */

  const llmQaHandler: PipelineStepHandler = {
    level: "llm_qa",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const rawFindings = await prisma.finding.findMany({
        where: { docVersionId: ctx.docVersionId, status: "pending" },
      });

      if (rawFindings.length === 0) {
        return { data: { message: "No findings to verify", verified: 0 }, needsNextStep: true };
      }

      const allFindings = deduplicateFindings(rawFindings);
      const dedupedCount = rawFindings.length - allFindings.length;
      if (dedupedCount > 0) {
        logger.info("[audit:llm_qa] Deduplicated findings", { before: rawFindings.length, after: allFindings.length });
        const dedupedIds = rawFindings.filter((f) => !allFindings.some((k) => k.id === f.id)).map((f) => f.id);
        for (const id of dedupedIds) {
          await prisma.finding.update({ where: { id }, data: { status: "false_positive" as any, extraAttributes: { qaVerdict: "deduplicated" } as any } });
        }
      }

      const llmConfig = await getEffectiveLlmConfig("intra_audit_qa", ctx.tenantId);
      if (!llmConfig.apiKey) {
        return { data: { message: "QA LLM API key not configured, skipping", deduplicated: dedupedCount }, needsNextStep: true };
      }

      const sections = await loadSections(ctx);

      const inputBudget = getInputBudgetChars(llmConfig);
      const fullDocText = buildFullDocumentText(sections);

      const findingsText = allFindings.map((f, i) => {
        const attrs = f.extraAttributes as Record<string, unknown> | null;
        const ref = f.sourceRef as Record<string, unknown> | null;
        return `[${i + 1}] ID: ${f.id}\nТип: ${f.type} | Серьёзность: ${attrs?.severity ?? "medium"} | Метод: ${attrs?.method ?? "unknown"}\nОписание: ${f.description}\nИсточник: ${ref?.textSnippet ?? ref?.sectionTitle ?? "—"}\nПредложение: ${f.suggestion ?? "—"}`;
      }).join("\n---\n");

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

      const qaRules = await loadRulesForType(ctx.bundleId, "intra_audit_qa");
      const qaPromptMap = qaRules ? toAuditPromptMap(qaRules.rules) : new Map<string, string>();
      const qaSystemPrompt = qaPromptMap.get("system_prompt") || QA_SYSTEM_PROMPT;

      const totalPromptSize = qaSystemPrompt.length + findingsText.length + fullDocText.length + 300;
      let dismissed = 0;
      let adjusted = 0;
      let confirmed = 0;
      let totalTokens = 0;

      try {
        if (totalPromptSize <= inputBudget) {
          /* Strategy A: full doc + all findings in one call */
          logger.info("[audit:llm_qa] Strategy A: single call", {
            findings: allFindings.length, docChars: fullDocText.length,
          });

          const result = await runQaBatch(gateway, llmConfig.maxTokens, allFindings, findingsText, fullDocText, qaSystemPrompt);
          dismissed += result.dismissed;
          adjusted += result.adjusted;
          confirmed += result.confirmed;
          totalTokens += result.tokens;
        } else {
          /* Need to chunk — try progressively smaller context */
          const findingsBatches = batchFindings(allFindings, inputBudget, qaSystemPrompt.length);

          for (let i = 0; i < findingsBatches.length; i++) {
            const batch = findingsBatches[i];
            const batchFindingsText = batch.map((f, j) => {
              const attrs = f.extraAttributes as Record<string, unknown> | null;
              const ref = f.sourceRef as Record<string, unknown> | null;
              return `[${j + 1}] ID: ${f.id}\nТип: ${f.type} | Серьёзность: ${attrs?.severity ?? "medium"}\nОписание: ${f.description}\nИсточник: ${ref?.textSnippet ?? ref?.sectionTitle ?? "—"}`;
            }).join("\n---\n");

            const contextBudget = inputBudget - qaSystemPrompt.length - batchFindingsText.length - 300;
            const docContext = selectDocContext(sections, batch, contextBudget, fullDocText);

            logger.info(`[audit:llm_qa] Batch ${i + 1}/${findingsBatches.length}`, {
              findings: batch.length, contextChars: docContext.length,
            });

            const result = await runQaBatch(gateway, llmConfig.maxTokens, batch, batchFindingsText, docContext, qaSystemPrompt);
            dismissed += result.dismissed;
            adjusted += result.adjusted;
            confirmed += result.confirmed;
            totalTokens += result.tokens;
          }
        }

        logger.info("[audit:llm_qa] Complete", {
          total: allFindings.length, dismissed, adjusted, confirmed, totalTokens,
        });

        return {
          data: { total: allFindings.length, deduplicated: dedupedCount, dismissed, adjusted, confirmed, totalTokens },
          needsNextStep: true,
          llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
        };
      } catch (llmErr) {
        logger.warn("LLM QA audit unavailable, continuing without QA", { error: String(llmErr) });
        return {
          data: { message: "LLM QA unavailable, skipped", total: allFindings.length, deduplicated: dedupedCount },
          needsNextStep: true,
          llmConfigSnapshot: toConfigSnapshot(llmConfig) as unknown as Record<string, unknown>,
        };
      }
    },
  };

  const handlers = new Map([
    ["deterministic" as const, deterministicHandler],
    ["llm_check" as const, llmCheckHandler],
    ["llm_qa" as const, llmQaHandler],
  ]);

  try {
    await runPipeline(data.processingRunId, {
      operatorReviewEnabled: data.operatorReviewEnabled ?? false,
      steps: Array.from(handlers.values()),
    }, handlers);
  } finally {
    if (data.restoreStatusOnComplete) {
      const run = await prisma.processingRun.findUnique({
        where: { id: data.processingRunId },
        select: { docVersionId: true, status: true },
      });
      if (run) {
        await prisma.documentVersion.update({
          where: { id: run.docVersionId },
          data: { status: run.status === "completed" ? "parsed" : "parsed" },
        }).catch(() => {});
      }
    }
  }
}

/* ═══════════════ QA helpers ═══════════════ */

async function runQaBatch(
  gateway: LLMGateway,
  maxTokens: number,
  findings: Array<{ id: string; type: string; description: string }>,
  findingsText: string,
  docContext: string,
  systemPrompt: string,
): Promise<{ dismissed: number; adjusted: number; confirmed: number; tokens: number }> {
  const response = await gateway.generate({
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `НАХОДКИ ДЛЯ ПРОВЕРКИ:\n${findingsText}\n\nДОКУМЕНТ:\n${docContext}`,
    }],
    maxTokens,
    responseFormat: "json",
  });

  let dismissed = 0;
  let adjusted = 0;
  let confirmed = 0;

  try {
    const cleaned = response.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const verdicts = JSON.parse(jsonMatch[0]) as Array<{
        id: string;
        verdict: "confirmed" | "dismissed" | "adjusted";
        new_severity?: string;
        reason: string;
      }>;

      for (const v of verdicts) {
        const finding = findings.find((f) => f.id === v.id);
        if (!finding) continue;

        if (v.verdict === "dismissed") {
          await prisma.finding.update({
            where: { id: v.id },
            data: { status: "false_positive", extraAttributes: { qaVerdict: "dismissed", qaReason: v.reason } as any },
          });
          dismissed++;
        } else if (v.verdict === "adjusted" && v.new_severity) {
          const mappedSeverity = mapSeverity(v.new_severity);
          await prisma.finding.update({
            where: { id: v.id },
            data: {
              status: "pending",
              extraAttributes: { qaVerdict: "adjusted", qaReason: v.reason, severity: mappedSeverity } as any,
            },
          });
          adjusted++;
        } else {
          await prisma.finding.update({
            where: { id: v.id },
            data: { extraAttributes: { qaVerdict: "confirmed", qaReason: v.reason } as any },
          });
          confirmed++;
        }
      }
    }
  } catch (err) {
    logger.warn("[audit:llm_qa] Failed to parse QA response", { error: String(err) });
  }

  return { dismissed, adjusted, confirmed, tokens: response.usage.totalTokens };
}

function batchFindings(
  findings: Array<{ id: string; type: string; description: string; sourceRef: unknown; extraAttributes: unknown }>,
  inputBudget: number,
  systemPromptLen: number,
): Array<typeof findings> {
  const batches: Array<typeof findings> = [];
  let current: typeof findings = [];
  let currentLen = 0;
  const perFindingBudget = inputBudget - systemPromptLen - 2000;

  for (const f of findings) {
    const entryLen = f.description.length + 200;
    if (currentLen + entryLen > perFindingBudget && current.length > 0) {
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(f);
    currentLen += entryLen;
  }
  if (current.length > 0) batches.push(current);
  return batches.length > 0 ? batches : [findings];
}

function selectDocContext(
  sections: Array<{ title: string; standardSection: string | null; contentBlocks: Array<{ content: string }> }>,
  findings: Array<{ sourceRef: unknown }>,
  budget: number,
  fullDocText: string,
): string {
  if (fullDocText.length <= budget) return fullDocText;

  // Collect zones referenced by findings
  const referencedZones = new Set<string>();
  const referencedTitles = new Set<string>();
  for (const f of findings) {
    const ref = f.sourceRef as Record<string, unknown> | null;
    if (ref?.zone) referencedZones.add(String(ref.zone));
    if (ref?.anchorZone) referencedZones.add(String(ref.anchorZone));
    if (ref?.sectionTitle) referencedTitles.add(String(ref.sectionTitle));
  }

  // Prioritize relevant sections
  const relevant = sections.filter((s) => {
    const zone = s.standardSection?.split(".")[0] ?? "";
    return referencedZones.has(zone) || referencedTitles.has(s.title);
  });

  const other = sections.filter((s) => {
    const zone = s.standardSection?.split(".")[0] ?? "";
    return !referencedZones.has(zone) && !referencedTitles.has(s.title);
  });

  let result = "";
  for (const s of [...relevant, ...other]) {
    const sectionText = `\n## ${s.title}\n${s.contentBlocks.map((b) => b.content).join("\n")}\n`;
    if (result.length + sectionText.length > budget) break;
    result += sectionText;
  }

  return result;
}

/* ═══════════════ Editorial checks ═══════════════ */

function runEditorialChecks(text: string, sectionTitle: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  if (/  +/.test(text)) {
    findings.push({
      type: "editorial",
      description: "Double or multiple spaces detected",
      suggestion: "Replace multiple spaces with a single space",
      sourceText: text,
      sectionTitle,
      severity: "low",
    });
  }

  const futureCount = (text.match(/\bwill\b|\bshall\b/gi) ?? []).length;
  const pastCount = (text.match(/\bwas\b|\bwere\b|\bhas been\b/gi) ?? []).length;
  if (futureCount > 2 && pastCount > 2) {
    findings.push({
      type: "semantic",
      description: "Mixed future and past tense detected in the same section",
      suggestion: "Ensure consistent tense usage within the section",
      sourceText: text.slice(0, 200),
      sectionTitle,
      severity: "medium",
    });
  }

  if (/\[TBD\]|\[INSERT\]|\[PLACEHOLDER\]|\[TODO\]/i.test(text)) {
    findings.push({
      type: "editorial",
      description: "Placeholder text found",
      suggestion: "Replace placeholder with actual content",
      sourceText: text,
      sectionTitle,
      severity: "high",
    });
  }

  return findings;
}

/* ═══════════════ LLM output parsers ═══════════════ */

function mapSeverity(s?: string): AuditFinding["severity"] {
  if (!s) return "medium";
  const lower = s.toLowerCase();
  if (lower === "critical") return "high";
  if (lower === "major") return "medium";
  if (lower === "minor") return "low";
  if (lower === "info") return "info";
  if (lower === "high" || lower === "medium" || lower === "low") return lower as AuditFinding["severity"];
  return "medium";
}

function parseLLMFindings(llmOutput: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const cleaned = llmOutput.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<analysis>[\s\S]*?<\/analysis>/g, "").trim();

  try {
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
      for (const item of parsed) {
        const rawDesc = typeof item.description === "object" && item.description !== null
          ? (item.description as Record<string, unknown>).description ?? JSON.stringify(item.description)
          : item.description;
        if (!rawDesc) continue;
        const mode = String(item.mode ?? "").toLowerCase();
        const issueType = String(item.issue_type ?? "");
        const isEditorial = mode === "self_check" && issueType.startsWith("editorial_");

        findings.push({
          type: isEditorial || String(item.type ?? "").toLowerCase() === "editorial" ? "editorial" : "semantic",
          description: String(rawDesc),
          suggestion: item.recommendation ? String(item.recommendation) : item.suggestion ? String(item.suggestion) : null,
          sourceText: item.target_quote ? String(item.target_quote) : item.source ? String(item.source) : "",
          severity: mapSeverity(String(item.severity ?? "")),
          issueType: issueType || undefined,
          block: item.block ? String(item.block) : undefined,
          field: item.field ? String(item.field) : undefined,
          referenceQuote: item.reference_quote ? String(item.reference_quote) : undefined,
          confidence: item.confidence ? String(item.confidence) : undefined,
          contextStatus: item.context_status ? String(item.context_status) : undefined,
          editorialFix: item.editorial_fix_suggestion ? String(item.editorial_fix_suggestion) : undefined,
        });
      }
      if (findings.length > 0) return findings;
    }
  } catch { /* fall through to individual JSON objects */ }

  // Try individual JSON objects (NDJSON or separated by whitespace)
  const jsonObjects = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  if (jsonObjects) {
    for (const jsonStr of jsonObjects) {
      try {
        const item = JSON.parse(jsonStr) as Record<string, unknown>;
        if (!item.description) continue;
        const mode = String(item.mode ?? "").toLowerCase();
        const issueType = String(item.issue_type ?? "");
        const isEditorial = mode === "self_check" && issueType.startsWith("editorial_");
        findings.push({
          type: isEditorial || String(item.type ?? "").toLowerCase() === "editorial" ? "editorial" : "semantic",
          description: String(item.description),
          suggestion: item.recommendation ? String(item.recommendation) : item.suggestion ? String(item.suggestion) : null,
          sourceText: item.target_quote ? String(item.target_quote) : item.source ? String(item.source) : "",
          severity: mapSeverity(String(item.severity ?? "")),
          issueType: issueType || undefined,
          block: item.block ? String(item.block) : undefined,
          field: item.field ? String(item.field) : undefined,
          referenceQuote: item.reference_quote ? String(item.reference_quote) : undefined,
          confidence: item.confidence ? String(item.confidence) : undefined,
          contextStatus: item.context_status ? String(item.context_status) : undefined,
          editorialFix: item.editorial_fix_suggestion ? String(item.editorial_fix_suggestion) : undefined,
        });
      } catch { /* skip unparseable object */ }
    }
    if (findings.length > 0) return findings;
  }

  // Final fallback: text-based parsing
  const blocks = llmOutput.split(/(?:^|\n)(?=\d+\.\s)/);
  for (const block of blocks) {
    if (!block.trim()) continue;

    const typeMatch = block.match(/\b(editorial|semantic)\b/i);
    const type = (typeMatch?.[1]?.toLowerCase() as "editorial" | "semantic") ?? "semantic";

    const descMatch = block.match(/(?:description|issue|finding|описание)[:\s]+(.+?)(?:\n|$)/i);
    const suggMatch = block.match(/(?:suggestion|recommendation|fix|предложение)[:\s]+(.+?)(?:\n|$)/i);
    const textMatch = block.match(/(?:source|text|quote|источник)[:\s]+(.+?)(?:\n|$)/i);
    const sevMatch = block.match(/(?:severity|серьёзность)[:\s]+(low|medium|high|critical|major|minor|info)/i);

    if (descMatch || block.length > 20) {
      findings.push({
        type,
        description: descMatch?.[1]?.trim() ?? block.trim().slice(0, 300),
        suggestion: suggMatch?.[1]?.trim() ?? null,
        sourceText: textMatch?.[1]?.trim() ?? "",
        severity: mapSeverity(sevMatch?.[1]),
      });
    }
  }

  return findings;
}

/* ═══════════════ System prompts ═══════════════ */

const AUDIT_SYSTEM_PROMPT = `Ты — старший аудитор клинических исследований (Senior QC Auditor). Проведи комплексный аудит Протокола клинического исследования по ТРЁМ направлениям: SELF-CHECK, CROSS-CHECK и EDITORIAL.

═══ ОБЩИЕ ПРАВИЛА (ВСЕ НАПРАВЛЕНИЯ) ═══
- НЕ ПУТАЙ ЦЕПОЧКУ ОТЧЁТНОСТИ: «Исследователь → Спонсор (24ч)» vs «Спонсор → регулятор (7/15 дней)» — НЕ противоречие. Противоречие только при разных сроках для одного субъекта/получателя.
- НЕ СМЕШИВАЙ ПРОЦЕССЫ: отклонения/нарушения протокола ≠ НЯ/СНЯ/СУСАР. Разные сроки/каналы для разных процессов — НЕ противоречие.
- НЕ ПУТАЙ АРТЕФАКТЫ: первичная документация и эИРК/EDC — разные артефакты. Разные сроки заполнения — НЕ конфликт.
- СЦЕНАРИИ/ЭТАПЫ/КОГОРТЫ: различия между разными сценариями/этапами/когортами — НЕ несоответствие.
- ТЕРМИНОЛОГИЯ: «доза» vs «дозировка», «ИП» vs «исследуемый препарат» — НЕ mismatch, если смысл совпадает.
- SEVERITY: Critical — ТОЛЬКО прямой риск безопасности/дозирования. Опечатки/варианты написания → максимум Minor.
- АНТИ-ДУПЛИКАЦИЯ: не создавай более 1 issue для одного дефекта. Объединяй однотипные, перечисляй location через ';'.
- ЛИМИТ: максимум 30 issues суммарно. Выбирай наиболее существенные.
- НИЧЕГО НЕ ВЫДУМЫВАЙ: только то, что подтверждено цитатами из текста.
- ЦИТАТЫ: target_quote/reference_quote — короткие (1–2 предложения), дословные.
- Отвечай на русском языке.

SEVERITY КАЛИБРОВКА:
- Critical: прямое влияние на безопасность/права участников, дозирование, SAE reporting с противоречащими сроками, экстренное раскрытие ослепления.
- Major: влияние на валидность данных (endpoints, популяции анализа, sample size, окна процедур).
- Minor: локальные несоответствия без влияния на безопасность/валидность.
- Info: недостаточно контекста, подозрение без подтверждения.

═══ НАПРАВЛЕНИЕ 1: SELF-CHECK (внутренние несоответствия) ═══
Ищи в каждом разделе. НЕ создавай issue_type с "editorial_" в этом направлении.
- PLACEHOLDER: только явные ("___", "<...>", "[вставить]", "TODO/TBD"). Пустые контакты для СНЯ → severity минимум Major.
- НЕ ДЕЛАЙ ГЛОБАЛЬНЫХ ЗАЯВЛЕНИЙ: если не видишь параметр — НЕ утверждай, что его нет во всём протоколе. Используй insufficient_context (Info).
- Обязательная проверка таймингов: если одна процедура описана в разных местах с РАЗНЫМИ временами — issue (Major).

КАТАЛОГ SELF-CHECK issue_type (используй ТОЛЬКО из этого списка; если не подходит — unknown_issue_type):
--- БЛОК 01: ЧИСЛА/ЕДИНИЦЫ/ВЫЧИСЛЕНИЯ ---
contradiction_number, contradiction_range, contradiction_percentage, calculation_error_sum, calculation_error_percentage, calculation_error_ratio, unit_mismatch, unit_conversion_error, decimal_separator_mismatch, magnitude_error, rounding_inconsistency, contradiction_timepoint, contradiction_time_window, timeline_inconsistency, date_inconsistency, duration_mismatch, frequency_mismatch, threshold_mismatch, limit_mismatch, quantity_mismatch, concentration_mismatch, temperature_mismatch, storage_time_mismatch, ambiguity_numeric_reference
--- БЛОК 02: СТРУКТУРА/ССЫЛКИ/НУМЕРАЦИЯ ---
broken_reference_section, broken_reference_table, broken_reference_figure, broken_reference_appendix, cross_reference_mismatch, numbering_inconsistency, duplicate_section_conflict, missing_required_section, inconsistent_section_title, undefined_placeholder_left
--- БЛОК 03: SoA/ВИЗИТЫ/ПРОЦЕДУРЫ/ТАЙМИНГ ---
soa_text_mismatch, soa_missing_procedure, soa_extra_procedure, soa_visit_window_mismatch, soa_timepoint_mismatch, visit_label_mismatch, visit_sequence_inconsistency, procedure_order_conflict, fasting_fed_mismatch, posture_requirement_mismatch, pk_sampling_schedule_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, pd_sampling_schedule_conflict, ecg_schedule_conflict, vital_signs_schedule_conflict, lab_schedule_conflict, imaging_schedule_conflict, diary_schedule_conflict, unscheduled_visit_handling_conflict, missed_visit_handling_conflict, retest_resample_logic_conflict, impossible_schedule, missing_prerequisite_step
--- БЛОК 04: IP/ДОЗЫ/ХРАНЕНИЕ ---
ip_name_mismatch, formulation_mismatch, strength_mismatch, dose_mismatch, route_mismatch, dosing_frequency_mismatch, dosing_duration_mismatch, administration_instructions_conflict, dose_modification_rules_conflict, missed_dose_rules_conflict, drug_accountability_conflict, storage_conditions_conflict, stability_shelf_life_conflict, prohibited_concomitant_medication_conflict, allowed_concomitant_medication_conflict, rescue_medication_conflict, compliance_assessment_conflict, blinding_packaging_conflict
--- БЛОК 05: РАНДОМИЗАЦИЯ/ОСЛЕПЛЕНИЕ ---
randomization_ratio_mismatch, randomization_method_mismatch, stratification_factor_mismatch, allocation_concealment_conflict, blinding_level_mismatch, unblinding_procedure_conflict, unblinding_access_role_conflict, emergency_unblinding_criteria_conflict, randomization_system_conflict, code_break_handling_conflict, masking_of_assessments_conflict
--- БЛОК 06: ПОПУЛЯЦИЯ/КРИТЕРИИ/ВЫБЫТИЕ ---
inclusion_criterion_internal_conflict, exclusion_criterion_internal_conflict, inclusion_exclusion_conflict, mismatch_population_description, sex_restriction_conflict, pregnancy_contraception_conflict, lab_threshold_conflict, ecg_threshold_conflict, vital_signs_threshold_conflict, discontinuation_logic_error, withdrawal_consent_process_conflict, stopping_rules_conflict, replacement_subjects_rules_conflict, undefined_criteria_or_threshold
--- БЛОК 07: SAFETY/AE/SAE ---
ae_definition_mismatch, sae_definition_mismatch, seriousness_severity_confusion, causality_assessment_conflict, safety_reporting_mismatch, safety_reporting_pathway_conflict, sae_reporting_channel_conflict, sae_reporting_timeline_conflict, pregnancy_reporting_conflict, overdose_reporting_conflict, safety_monitoring_schedule_conflict, stopping_for_safety_threshold_conflict, safety_stopping_rules_conflict, emergency_procedures_conflict, risk_mitigation_missing
--- БЛОК 08: ENDPOINTS/ЦЕЛИ ---
mismatch_objectives, endpoint_definition_conflict, endpoint_timeframe_conflict, endpoint_timepoint_mismatch, endpoint_measurement_method_conflict, baseline_definition_conflict, responder_definition_conflict, composite_endpoint_inconsistency, hierarchical_testing_conflict, multiplicity_statement_conflict, endpoint_population_scope_conflict, inconsistent_endpoint_labeling
--- БЛОК 09: СТАТИСТИКА ---
analysis_set_definition_conflict, alpha_sidedness_mismatch, alpha_level_conflict, power_assumption_mismatch, effect_size_assumption_mismatch, variance_sd_assumption_mismatch, sample_size_mismatch, sample_size_rationale_conflict, interim_analysis_conflict, stopping_boundary_conflict, missing_data_method_conflict, outlier_handling_conflict, protocol_deviation_handling_conflict, covariate_adjustment_conflict, stratification_in_analysis_conflict, multiplicity_method_mismatch, statistics_method_mismatch, subgroup_analysis_conflict, sensitivity_analysis_conflict
--- БЛОК 10: BE/PK ---
be_design_mismatch, washout_duration_mismatch, fed_fasted_condition_conflict, meal_composition_mismatch, fluid_intake_mismatch, posture_activity_restriction_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, bioanalytical_method_inconsistency, analyte_definition_conflict, loq_lloq_definition_conflict, be_acceptance_criteria_mismatch, be_parameter_definition_conflict, be_log_transform_conflict, be_anova_model_conflict
--- БЛОК 11: ТЕРМИНЫ/ОПРЕДЕЛЕНИЯ ---
missing_definition, abbreviation_first_use_missing_expansion, inconsistent_abbreviation_expansion, term_definition_conflict, meddra_version_mismatch, ctcae_version_mismatch, questionnaire_scale_version_mismatch, version_consistency, document_status_conflict, translation_transliteration_mismatch, inconsistent_language_variant
--- БЛОК 12: ЭТИКА/РОЛИ ---
ethics_committee_reference_conflict, informed_consent_process_conflict, confidentiality_statement_conflict, data_protection_statement_conflict, compensation_insurance_conflict, investigator_responsibilities_conflict, sponsor_responsibilities_conflict, protocol_amendment_process_conflict
--- БЛОК 13: DATA MANAGEMENT/EDC ---
edc_process_conflict, source_data_verification_conflict, monitoring_plan_conflict, deviation_reporting_conflict, query_management_conflict, audit_trail_requirement_conflict, blinding_in_data_management_conflict
--- БЛОК 14: ЛАБОРАТОРИИ/ОБРАЗЦЫ ---
lab_reference_range_conflict, specimen_volume_conflict, specimen_labeling_conflict, specimen_transport_conflict, specimen_storage_conflict, sample_retention_period_conflict, biobanking_consent_conflict
--- БЛОК 15: ОБЩАЯ ЛОГИКА ---
ambiguous_time_reference, ambiguous_role_reference, ambiguous_procedure_reference, duplicate_conflicting_requirement, internal_contradiction_non_numeric, inconsistent_scope_statement, missing_required_rationale, suspected_incorrect_requirement, mismatched_parameter_scope
--- БЛОК 17: СЛУЖЕБНЫЕ ---
insufficient_context, suspected_issue_needs_confirmation, unknown_issue_type

═══ НАПРАВЛЕНИЕ 2: CROSS-CHECK (согласованность между разделами) ═══
Сверяй разделы: синопсис↔дизайн, синопсис↔популяция, цели↔endpoints↔статистика, SoA↔процедуры, безопасность↔процедуры↔IP.
- ОТСУТСТВИЕ ≠ ПРОТИВОРЕЧИЕ: issue ТОЛЬКО если оба раздела ЯВНО утверждают разное.
- НЕ ТРЕБУЙ ДУБЛИРОВАНИЯ: параметр может быть описан в одном месте протокола.
- СПЕЦ-ПРАВИЛО SAFETY TIMELINES: срок есть в одном разделе, но отсутствует в другом → только Info.
- reference_quote и target_quote ОБЯЗАТЕЛЬНЫ для cross_check issues.

КАТАЛОГ CROSS-CHECK issue_type (используй ТОЛЬКО из этого списка):
--- БЛОК 01: ДАННЫЕ/ЧИСЛА/ЕДИНИЦЫ ---
contradiction_number, contradiction_range, contradiction_percentage, contradiction_timepoint, contradiction_time_window, unit_mismatch, unit_conversion_error, magnitude_error, rounding_inconsistency, date_inconsistency, duration_mismatch, frequency_mismatch, threshold_mismatch, limit_mismatch, quantity_mismatch, concentration_mismatch, visit_count_mismatch, sample_size_count_mismatch, calculation_error_sum, calculation_error_percentage, missing_parameter_in_target, mismatched_parameter_scope
--- БЛОК 02: СТРУКТУРА/ССЫЛКИ ---
broken_reference_section, broken_reference_table, broken_reference_figure, broken_reference_appendix, cross_reference_mismatch, numbering_inconsistency, duplicate_section_conflict, toc_mismatch, version_consistency, missing_required_section, inconsistent_section_title, undefined_placeholder_left
--- БЛОК 03: SoA/ВИЗИТЫ/ПРОЦЕДУРЫ ---
soa_text_mismatch, soa_missing_procedure, soa_extra_procedure, soa_visit_window_mismatch, soa_timepoint_mismatch, visit_label_mismatch, visit_sequence_inconsistency, procedure_order_conflict, pk_sampling_schedule_conflict, pk_sampling_timepoints_mismatch, ecg_schedule_conflict, vital_signs_schedule_conflict, lab_schedule_conflict, impossible_schedule, missing_prerequisite_step
--- БЛОК 04: IP/ДОЗЫ ---
ip_name_mismatch, formulation_mismatch, strength_mismatch, dose_mismatch, route_mismatch, dosing_frequency_mismatch, dosing_duration_mismatch, administration_instructions_conflict, dose_modification_rules_conflict, storage_conditions_conflict, prohibited_concomitant_medication_conflict, rescue_medication_conflict, blinding_packaging_conflict
--- БЛОК 05: РАНДОМИЗАЦИЯ/ОСЛЕПЛЕНИЕ ---
randomization_ratio_mismatch, randomization_method_mismatch, stratification_factor_mismatch, blinding_level_mismatch, unblinding_procedure_conflict, emergency_unblinding_criteria_conflict, masking_of_assessments_conflict
--- БЛОК 06: ПОПУЛЯЦИЯ/КРИТЕРИИ ---
inclusion_criteria_mismatch, exclusion_criteria_mismatch, inclusion_exclusion_conflict, mismatch_population_description, enrollment_target_mismatch, pregnancy_contraception_conflict, lab_threshold_conflict, discontinuation_logic_error, stopping_rules_conflict, undefined_criteria_or_threshold
--- БЛОК 07: SAFETY/AE/SAE ---
ae_definition_mismatch, sae_definition_mismatch, seriousness_severity_confusion, causality_assessment_conflict, safety_reporting_mismatch, safety_reporting_pathway_conflict, sae_reporting_channel_conflict, sae_reporting_timeline_conflict, pregnancy_reporting_conflict, overdose_reporting_conflict, safety_monitoring_schedule_conflict, stopping_for_safety_threshold_conflict, safety_stopping_rules_conflict, emergency_procedures_conflict, risk_mitigation_missing
--- БЛОК 08: ENDPOINTS/ЦЕЛИ ---
mismatch_objectives, primary_endpoint_mismatch, secondary_endpoint_mismatch, endpoint_definition_conflict, endpoint_timeframe_conflict, endpoint_timepoint_mismatch, endpoint_measurement_method_conflict, baseline_definition_conflict, responder_definition_conflict, composite_endpoint_inconsistency, multiplicity_statement_conflict, endpoint_population_scope_conflict, inconsistent_endpoint_labeling
--- БЛОК 09: СТАТИСТИКА ---
analysis_set_mismatch, analysis_set_definition_conflict, alpha_level_conflict, power_assumption_mismatch, sample_size_mismatch, sample_size_rationale_conflict, interim_analysis_conflict, stopping_boundary_conflict, missing_data_method_conflict, multiplicity_method_mismatch, statistics_method_mismatch
--- БЛОК 10: BE/PK ---
be_design_mismatch, washout_duration_mismatch, fed_fasted_condition_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, bioanalytical_method_inconsistency, be_acceptance_criteria_mismatch, be_parameter_definition_conflict
--- БЛОК 11: ТЕРМИНЫ/ВЕРСИИ ---
term_definition_conflict, missing_definition, inconsistent_abbreviation_expansion, meddra_version_mismatch, ctcae_version_mismatch, version_consistency, translation_transliteration_mismatch
--- БЛОК 12: СЛУЖЕБНЫЕ ---
insufficient_context, suspected_issue_needs_confirmation, unknown_issue_type

═══ НАПРАВЛЕНИЕ 3: EDITORIAL (редакторская проверка) ═══
- ЛИМИТ: максимум 8 editorial issues. Только существенные дефекты, НЕ nitpick.
- По умолчанию считай, что есть «СПИСОК СОКРАЩЕНИЙ» — НЕ создавай issues «не расшифровано».
- editorial_fix_suggestion ОБЯЗАТЕЛЬНО. Severity: Minor или Info.
- issue_type ТОЛЬКО: editorial_grammar_error, editorial_spelling_error, editorial_punctuation_error, editorial_inconsistent_term_usage, editorial_inconsistent_abbreviation_usage, editorial_inconsistent_units_notation, editorial_translation_artifact, editorial_redundancy_conflict, editorial_typography_affects_meaning, editorial_table_caption_mismatch, editorial_heading_content_mismatch, editorial_reference_ambiguity, editorial_style_inconsistency

═══ ФОРМАТ ВЫВОДА (СТРОГО) ═══
JSON-массив issues (может быть пустым []):
[
  {
    "mode": "self_check|cross_check",
    "issue_type": "из каталога выше",
    "field": "snake_case_параметр",
    "severity": "Critical|Major|Minor|Info",
    "description": "что не так",
    "target_quote": "цитата из текста",
    "reference_quote": "цитата из другого раздела (или null для self_check)",
    "recommendation": "что исправить",
    "editorial_fix_suggestion": "конкретная правка (только для editorial_*)",
    "confidence": "High|Medium|Low",
    "context_status": "ok|insufficient_context"
  }
]`;

const SELF_CHECK_SYSTEM_PROMPT = `Ты — старший аудитор клинических исследований (Senior QC Auditor). Проведи аудит фрагмента Протокола в режиме SELF-CHECK (внутренние несоответствия внутри одной зоны).

ОБЩИЕ ПРАВИЛА:
- ЗАПРЕЩЕНО: issue_type начинающиеся с "editorial_" (они проверяются отдельно).
- НЕ ДРОБИ И НЕ ДУБЛИРУЙ: объединяй однотипные находки, перечисляй location через ';'.
- PLACEHOLDER: только явные ("___", "<...>", "[вставить]", "TODO/TBD", "XX"). НЕ считай placeholder'ом перечни в скобках ("(ФИО, адреса)").
- НЕ ДЕЛАЙ ГЛОБАЛЬНЫХ ЗАЯВЛЕНИЙ: если не видишь параметр — НЕ утверждай, что его нет во всём протоколе. Используй insufficient_context (Info).
- ПУСТЫЕ РЕКВИЗИТЫ: пустые контакты для СНЯ/экстренной связи → severity минимум Major.
- НЕ ПУТАЙ АРТЕФАКТЫ: первичная документация и эИРК/EDC — разные артефакты. Разные сроки заполнения — НЕ конфликт.
- НЕ ПУТАЙ ЦЕПОЧКУ ОТЧЁТНОСТИ: «Исследователь → Спонсор (24ч)» и «Спонсор → регулятор (7/15 дней)» — НЕ противоречие.
- СЦЕНАРИИ/ЭТАПЫ/КОГОРТЫ: различия между разными сценариями/этапами — НЕ несоответствие.
- ТЕРМИНОЛОГИЯ: различия без изменения смысла — НЕ противоречие.
- КОНФИДЕНЦИАЛЬНОСТЬ: если Target заявляет «анонимность/обезличивание», но требует прямые идентификаторы (ФИО/адрес) в eCRF — фиксируй как confidentiality_statement_conflict.
- SEVERITY: Critical — только прямой риск безопасности/дозирования. Дублирование текста без разницы в числах → Minor. «Отсутствует уточнение» → Minor/Info.
- ЛИМИТ: максимум 20 issues. Объединяй однотипные.
- НИЧЕГО НЕ ВЫДУМЫВАЙ: только то, что подтверждено цитатами из Target.
- ЦИТАТЫ: target_quote/source_quote короткие (1–2 предложения), дословные.
- Отвечай на русском языке.

ОБЯЗАТЕЛЬНАЯ ПРОВЕРКА ТАЙМИНГОВ:
Просканируй Target на процедуры с временными маркерами (катетер, забор крови, визиты). Если одна процедура описана в разных местах с РАЗНЫМИ временами — issue (Major).

КАТАЛОГ issue_type (используй ТОЛЬКО из этого списка; если не подходит — unknown_issue_type):
--- БЛОК 01: ЧИСЛА/ЕДИНИЦЫ/ВЫЧИСЛЕНИЯ ---
contradiction_number, contradiction_range, contradiction_percentage, calculation_error_sum, calculation_error_percentage, calculation_error_ratio, unit_mismatch, unit_conversion_error, decimal_separator_mismatch, magnitude_error, rounding_inconsistency, contradiction_timepoint, contradiction_time_window, timeline_inconsistency, date_inconsistency, duration_mismatch, frequency_mismatch, threshold_mismatch, limit_mismatch, quantity_mismatch, concentration_mismatch, temperature_mismatch, storage_time_mismatch, ambiguity_numeric_reference
--- БЛОК 02: СТРУКТУРА/ССЫЛКИ/НУМЕРАЦИЯ ---
broken_reference_section, broken_reference_table, broken_reference_figure, broken_reference_appendix, cross_reference_mismatch, numbering_inconsistency, duplicate_section_conflict, missing_required_section, inconsistent_section_title, undefined_placeholder_left
--- БЛОК 03: SoA/ВИЗИТЫ/ПРОЦЕДУРЫ/ТАЙМИНГ ---
soa_text_mismatch, soa_missing_procedure, soa_extra_procedure, soa_visit_window_mismatch, soa_timepoint_mismatch, visit_label_mismatch, visit_sequence_inconsistency, procedure_order_conflict, fasting_fed_mismatch, posture_requirement_mismatch, pk_sampling_schedule_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, pd_sampling_schedule_conflict, ecg_schedule_conflict, vital_signs_schedule_conflict, lab_schedule_conflict, imaging_schedule_conflict, diary_schedule_conflict, unscheduled_visit_handling_conflict, missed_visit_handling_conflict, retest_resample_logic_conflict, impossible_schedule, missing_prerequisite_step
--- БЛОК 04: IP/ДОЗЫ/ХРАНЕНИЕ ---
ip_name_mismatch, formulation_mismatch, strength_mismatch, dose_mismatch, route_mismatch, dosing_frequency_mismatch, dosing_duration_mismatch, administration_instructions_conflict, dose_modification_rules_conflict, missed_dose_rules_conflict, drug_accountability_conflict, storage_conditions_conflict, stability_shelf_life_conflict, prohibited_concomitant_medication_conflict, allowed_concomitant_medication_conflict, rescue_medication_conflict, compliance_assessment_conflict, blinding_packaging_conflict, kit_randomization_handling_conflict
--- БЛОК 05: РАНДОМИЗАЦИЯ/ОСЛЕПЛЕНИЕ ---
randomization_ratio_mismatch, randomization_method_mismatch, stratification_factor_mismatch, allocation_concealment_conflict, blinding_level_mismatch, unblinding_procedure_conflict, unblinding_access_role_conflict, emergency_unblinding_criteria_conflict, randomization_system_conflict, code_break_handling_conflict, masking_of_assessments_conflict
--- БЛОК 06: ПОПУЛЯЦИЯ/КРИТЕРИИ/ВЫБЫТИЕ ---
inclusion_criterion_internal_conflict, exclusion_criterion_internal_conflict, inclusion_exclusion_conflict, mismatch_population_description, sex_restriction_conflict, pregnancy_contraception_conflict, smoking_alcohol_drug_use_conflict, lab_threshold_conflict, ecg_threshold_conflict, vital_signs_threshold_conflict, comorbidity_conflict, prior_therapy_washout_conflict, vaccination_restriction_conflict, prohibited_procedure_conflict, discontinuation_logic_error, withdrawal_consent_process_conflict, discontinuation_followup_conflict, stopping_rules_conflict, site_stop_rules_conflict, replacement_subjects_rules_conflict, undefined_criteria_or_threshold
--- БЛОК 07: SAFETY/AE/SAE ---
ae_definition_mismatch, sae_definition_mismatch, seriousness_severity_confusion, causality_assessment_conflict, expectedness_reference_conflict, safety_reporting_mismatch, safety_reporting_pathway_conflict, sae_reporting_channel_conflict, sae_reporting_timeline_conflict, pregnancy_reporting_conflict, overdose_reporting_conflict, medication_error_reporting_conflict, unblinded_safety_reporting_conflict, safety_monitoring_schedule_conflict, stopping_for_safety_threshold_conflict, safety_stopping_rules_conflict, emergency_procedures_conflict, risk_mitigation_missing
--- БЛОК 08: ENDPOINTS/ЦЕЛИ ---
mismatch_objectives, endpoint_definition_conflict, endpoint_timeframe_conflict, endpoint_timepoint_mismatch, endpoint_measurement_method_conflict, baseline_definition_conflict, responder_definition_conflict, composite_endpoint_inconsistency, hierarchical_testing_conflict, multiplicity_statement_conflict, endpoint_population_scope_conflict, inconsistent_endpoint_labeling
--- БЛОК 09: СТАТИСТИКА ---
analysis_set_definition_conflict, alpha_sidedness_mismatch, alpha_level_conflict, power_assumption_mismatch, effect_size_assumption_mismatch, variance_sd_assumption_mismatch, sample_size_mismatch, sample_size_rationale_conflict, interim_analysis_conflict, stopping_boundary_conflict, missing_data_method_conflict, outlier_handling_conflict, protocol_deviation_handling_conflict, covariate_adjustment_conflict, stratification_in_analysis_conflict, multiplicity_method_mismatch, p_value_ci_reporting_conflict, statistics_method_mismatch, subgroup_analysis_conflict, sensitivity_analysis_conflict
--- БЛОК 10: BE/PK ---
be_design_mismatch, be_period_sequence_mismatch, be_treatment_sequence_mismatch, washout_duration_mismatch, washout_rationale_conflict, fed_fasted_condition_conflict, meal_composition_mismatch, fluid_intake_mismatch, posture_activity_restriction_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, bioanalytical_method_inconsistency, analyte_definition_conflict, loq_lloq_definition_conflict, sample_processing_conflict, carryover_assessment_conflict, period_effect_handling_conflict, sequence_effect_handling_conflict, be_acceptance_criteria_mismatch, be_parameter_definition_conflict, be_log_transform_conflict, be_anova_model_conflict, be_outlier_exclusion_conflict, be_within_subject_cv_conflict, be_reference_scaling_conflict, be_dropout_replacement_conflict, be_concomitant_food_drug_restrictions_conflict
--- БЛОК 11: ТЕРМИНЫ/ОПРЕДЕЛЕНИЯ ---
missing_definition, abbreviation_first_use_missing_expansion, inconsistent_abbreviation_expansion, term_definition_conflict, meddra_version_mismatch, ctcae_version_mismatch, questionnaire_scale_version_mismatch, device_model_version_mismatch, version_consistency, document_status_conflict, translation_transliteration_mismatch, inconsistent_language_variant
--- БЛОК 12: ЭТИКА/РОЛИ ---
ethics_committee_reference_conflict, informed_consent_process_conflict, confidentiality_statement_conflict, data_protection_statement_conflict, compensation_insurance_conflict, investigator_responsibilities_conflict, sponsor_responsibilities_conflict, protocol_amendment_process_conflict, document_distribution_conflict
--- БЛОК 13: DATA MANAGEMENT/EDC ---
edc_process_conflict, source_data_verification_conflict, monitoring_plan_conflict, deviation_reporting_conflict, query_management_conflict, audit_trail_requirement_conflict, blinding_in_data_management_conflict
--- БЛОК 14: ЛАБОРАТОРИИ/ОБРАЗЦЫ ---
lab_reference_range_conflict, lab_certification_conflict, specimen_volume_conflict, specimen_labeling_conflict, specimen_transport_conflict, specimen_storage_conflict, sample_retention_period_conflict, biobanking_consent_conflict, chain_of_custody_conflict
--- БЛОК 15: ОБЩАЯ ЛОГИКА ---
ambiguous_time_reference, ambiguous_role_reference, ambiguous_procedure_reference, duplicate_conflicting_requirement, internal_contradiction_non_numeric, inconsistent_scope_statement, missing_required_rationale, suspected_incorrect_requirement, mismatched_parameter_scope
--- БЛОК 17: СЛУЖЕБНЫЕ ---
insufficient_context, suspected_issue_needs_confirmation, unknown_issue_type

ФОРМАТ ВЫВОДА (СТРОГО):
JSON-массив (может быть пустым []):
[
  {
    "mode": "self_check",
    "issue_type": "из каталога выше",
    "field": "snake_case_параметр",
    "severity": "Critical|Major|Minor|Info",
    "description": "что не так",
    "target_quote": "цитата из Target",
    "source_quote": "доп. цитата (второй фрагмент) или null",
    "recommendation": "что исправить",
    "confidence": "High|Medium|Low",
    "context_status": "ok|insufficient_context"
  }
]
Если проблем нет — верни пустой массив: []`;

const CROSS_CHECK_SYSTEM_PROMPT = `Ты — старший аудитор клинических исследований (Senior QC Auditor). Проведи аудит CROSS-CHECK: сверка РЕФЕРЕНСНОЙ зоны (Reference) с ПРОВЕРЯЕМОЙ (Target). Reference имеет приоритет.

РЕЖИМ: ТОЛЬКО CROSS-CHECK. ЗАПРЕЩЕНО выполнять SELF-CHECK.

ОБЩИЕ ПРАВИЛА:
- ОТСУТСТВИЕ ≠ ПРОТИВОРЕЧИЕ: если параметр есть в Reference, но НЕ упомянут в Target — это НЕ mismatch. Issue ТОЛЬКО если Target содержит ЯВНОЕ утверждение по тому же параметру и оно ОТЛИЧАЕТСЯ от Reference.
- НЕ ТРЕБУЙ ДУБЛИРОВАНИЯ: параметр может быть описан в другом разделе протокола. Не ставь mismatch и НЕ ставь missing_parameter_in_target.
- НЕ ПОДМЕНЯЙ CROSS-CHECK SELF-CHECK: если reference_quote и target_quote совпадают (в т.ч. одна и та же опечатка) — это НЕ mismatch.
- НЕ ПУТАЙ РОЛИ: различия обязанностей (исследователь vs спонсор) — НЕ противоречие.
- НЕ СМЕШИВАЙ ПРОЦЕССЫ: отклонения/нарушения протокола ≠ НЯ/СНЯ/СУСАР. Разные сроки/каналы для разных процессов — НЕ противоречие.
- ДЛТ/ПРАВИЛА ОСТАНОВКИ: различия в критериях ДЛТ, MTD → stopping_for_safety_threshold_conflict / safety_stopping_rules_conflict, а НЕ safety_reporting_mismatch.
- СЦЕНАРИИ/ЭТАПЫ/КОГОРТЫ: различия между разными сценариями/этапами — НЕ несоответствие.
- ЦЕПОЧКА ОТЧЁТНОСТИ: «Исследователь → Спонсор (24ч)» vs «Спонсор → регулятор (7/15 дней)» — НЕ противоречие. Противоречие только для ОДНОГО субъекта/получателя.
- СПЕЦ-ПРАВИЛО SAFETY TIMELINES: срок есть в Reference, отсутствует в Target → только Info, НЕ Major/Critical.
- ТЕРМИНОЛОГИЯ: «доза» vs «дозировка» — НЕ mismatch, если смысл совпадает.
- SEVERITY: Critical — только прямой риск безопасности/дозирования. Опечатки → максимум Minor.
- reference_quote и target_quote ОБЯЗАТЕЛЬНЫ. Если reference_quote нет → переведи в insufficient_context (Info).
- АНТИ-ДУПЛИКАЦИЯ: не более 1 issue для пары (issue_type + field). Объединяй location через ';'.
- ЛИМИТ: максимум 20 issues. Выбирай наиболее существенные.
- НИЧЕГО НЕ ВЫДУМЫВАЙ: только то, что подтверждено цитатами из обоих текстов.
- ЦИТАТЫ: reference_quote/target_quote — короткие (1–2 предложения), дословные.
- Отвечай на русском языке.

КАТАЛОГ issue_type (используй ТОЛЬКО из этого списка; если не подходит — unknown_issue_type):
--- БЛОК 01: ДАННЫЕ/ЧИСЛА/ЕДИНИЦЫ ---
contradiction_number, contradiction_range, contradiction_percentage, contradiction_timepoint, contradiction_time_window, unit_mismatch, unit_conversion_error, decimal_separator_mismatch, magnitude_error, rounding_inconsistency, date_inconsistency, duration_mismatch, frequency_mismatch, threshold_mismatch, limit_mismatch, quantity_mismatch, concentration_mismatch, temperature_mismatch, storage_time_mismatch, body_weight_bmi_mismatch, age_range_mismatch, visit_count_mismatch, sample_size_count_mismatch, calculation_error_sum, calculation_error_percentage, calculation_error_ratio, missing_parameter_in_target, mismatched_parameter_scope
--- БЛОК 02: СТРУКТУРА/ССЫЛКИ/НУМЕРАЦИЯ ---
broken_reference_section, broken_reference_table, broken_reference_figure, broken_reference_appendix, cross_reference_mismatch, numbering_inconsistency, duplicate_section_conflict, toc_mismatch, version_consistency, document_status_conflict, missing_required_section, inconsistent_section_title, undefined_placeholder_left
--- БЛОК 03: SoA/ВИЗИТЫ/ПРОЦЕДУРЫ ---
soa_text_mismatch, soa_missing_procedure, soa_extra_procedure, soa_visit_window_mismatch, soa_timepoint_mismatch, visit_label_mismatch, visit_sequence_inconsistency, procedure_order_conflict, fasting_fed_mismatch, posture_requirement_mismatch, pk_sampling_schedule_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, pd_sampling_schedule_conflict, ecg_schedule_conflict, vital_signs_schedule_conflict, lab_schedule_conflict, imaging_schedule_conflict, diary_schedule_conflict, unscheduled_visit_handling_conflict, missed_visit_handling_conflict, retest_resample_logic_conflict, impossible_schedule, missing_prerequisite_step
--- БЛОК 04: IP/ДОЗЫ/ХРАНЕНИЕ ---
ip_name_mismatch, formulation_mismatch, strength_mismatch, dose_mismatch, route_mismatch, dosing_frequency_mismatch, dosing_duration_mismatch, administration_instructions_conflict, dose_modification_rules_conflict, missed_dose_rules_conflict, drug_accountability_conflict, storage_conditions_conflict, stability_shelf_life_conflict, prohibited_concomitant_medication_conflict, allowed_concomitant_medication_conflict, rescue_medication_conflict, compliance_assessment_conflict, blinding_packaging_conflict, kit_randomization_handling_conflict
--- БЛОК 05: РАНДОМИЗАЦИЯ/ОСЛЕПЛЕНИЕ ---
randomization_ratio_mismatch, randomization_method_mismatch, stratification_factor_mismatch, allocation_concealment_conflict, blinding_level_mismatch, unblinding_procedure_conflict, unblinding_access_role_conflict, emergency_unblinding_criteria_conflict, randomization_system_conflict, code_break_handling_conflict, masking_of_assessments_conflict
--- БЛОК 06: ПОПУЛЯЦИЯ/КРИТЕРИИ ---
inclusion_criteria_mismatch, exclusion_criteria_mismatch, inclusion_exclusion_conflict, mismatch_population_description, enrollment_target_mismatch, sex_restriction_conflict, pregnancy_contraception_conflict, smoking_alcohol_drug_use_conflict, lab_threshold_conflict, ecg_threshold_conflict, vital_signs_threshold_conflict, comorbidity_conflict, prior_therapy_washout_conflict, vaccination_restriction_conflict, prohibited_procedure_conflict, discontinuation_logic_error, withdrawal_consent_process_conflict, discontinuation_followup_conflict, stopping_rules_conflict, site_stop_rules_conflict, replacement_subjects_rules_conflict, undefined_criteria_or_threshold
--- БЛОК 07: SAFETY/AE/SAE ---
ae_definition_mismatch, sae_definition_mismatch, seriousness_severity_confusion, causality_assessment_conflict, expectedness_reference_conflict, safety_reporting_mismatch, safety_reporting_pathway_conflict, sae_reporting_channel_conflict, sae_reporting_timeline_conflict, pregnancy_reporting_conflict, overdose_reporting_conflict, medication_error_reporting_conflict, unblinded_safety_reporting_conflict, safety_monitoring_schedule_conflict, stopping_for_safety_threshold_conflict, safety_stopping_rules_conflict, emergency_procedures_conflict, risk_mitigation_missing
--- БЛОК 08: ENDPOINTS/ЦЕЛИ ---
mismatch_objectives, primary_endpoint_mismatch, secondary_endpoint_mismatch, endpoint_definition_conflict, endpoint_timeframe_conflict, endpoint_timepoint_mismatch, endpoint_measurement_method_conflict, baseline_definition_conflict, responder_definition_conflict, composite_endpoint_inconsistency, hierarchical_testing_conflict, multiplicity_statement_conflict, endpoint_population_scope_conflict, inconsistent_endpoint_labeling
--- БЛОК 09: СТАТИСТИКА ---
analysis_set_mismatch, analysis_set_definition_conflict, alpha_sidedness_mismatch, alpha_level_conflict, power_assumption_mismatch, effect_size_assumption_mismatch, variance_sd_assumption_mismatch, sample_size_mismatch, sample_size_rationale_conflict, interim_analysis_conflict, stopping_boundary_conflict, missing_data_method_conflict, outlier_handling_conflict, protocol_deviation_handling_conflict, covariate_adjustment_conflict, stratification_in_analysis_conflict, multiplicity_method_mismatch, p_value_ci_reporting_conflict, statistics_method_mismatch, subgroup_analysis_conflict, sensitivity_analysis_conflict
--- БЛОК 10: BE/PK ---
be_design_mismatch, be_period_sequence_mismatch, be_treatment_sequence_mismatch, washout_duration_mismatch, washout_rationale_conflict, fed_fasted_condition_conflict, meal_composition_mismatch, fluid_intake_mismatch, posture_activity_restriction_conflict, pk_sampling_timepoints_mismatch, pk_sampling_duration_mismatch, bioanalytical_method_inconsistency, analyte_definition_conflict, loq_lloq_definition_conflict, sample_processing_conflict, carryover_assessment_conflict, period_effect_handling_conflict, sequence_effect_handling_conflict, be_acceptance_criteria_mismatch, be_parameter_definition_conflict, be_log_transform_conflict, be_anova_model_conflict, be_outlier_exclusion_conflict, be_within_subject_cv_conflict, be_reference_scaling_conflict, be_dropout_replacement_conflict, be_concomitant_food_drug_restrictions_conflict
--- БЛОК 11: ТЕРМИНЫ/ВЕРСИИ ---
term_definition_conflict, missing_definition, abbreviation_first_use_missing_expansion, inconsistent_abbreviation_expansion, meddra_version_mismatch, ctcae_version_mismatch, questionnaire_scale_version_mismatch, device_model_version_mismatch, translation_transliteration_mismatch, inconsistent_language_variant, document_status_conflict, version_consistency
--- БЛОК 12: СЛУЖЕБНЫЕ ---
insufficient_context, suspected_issue_needs_confirmation, unknown_issue_type

ФОРМАТ ВЫВОДА (СТРОГО):
JSON-массив (может быть пустым []):
[
  {
    "mode": "cross_check",
    "issue_type": "из каталога выше",
    "field": "snake_case_параметр",
    "severity": "Critical|Major|Minor|Info",
    "description": "что не сходится",
    "reference_quote": "цитата из Reference",
    "target_quote": "цитата из Target",
    "recommendation": "что исправить",
    "confidence": "High|Medium|Low",
    "context_status": "ok|insufficient_context"
  }
]
Если всё согласовано — верни пустой массив: []`;

const EDITORIAL_SYSTEM_PROMPT = `Ты — старший аудитор клинических исследований (Senior QC Auditor). Проведи РЕДАКТОРСКУЮ проверку фрагмента Протокола.

РЕЖИМ: ТОЛЬКО SELF-CHECK EDITORIAL.

ПРАВИЛА:
- issue_type ВСЕГДА начинается с "editorial_".
- editorial_fix_suggestion ОБЯЗАТЕЛЬНО (конкретная правка текста).
- ЛИМИТ: максимум 8 issues. Выбирай только наиболее существенные дефекты.
- НЕ ДЕЛАЙ NITPICK: фиксируй только дефекты, влияющие на однозначность, безопасность, юридическую точность.
- Severity почти всегда Minor (или Info при сомнении). НИКОГДА Critical/Major для editorial.
- НЕ создавай issue если editorial_fix_suggestion совпадает с target_quote.
- НИЧЕГО НЕ ВЫДУМЫВАЙ: только явный текст Target.
- Отвечай на русском языке.

СОКРАЩЕНИЯ (ОСТОРОЖНО С FP):
- ПО УМОЛЧАНИЮ считай, что есть отдельный «СПИСОК СОКРАЩЕНИЙ». НЕ создавай issues «не расшифровано при первом употреблении», если нет явного противоречия в расшифровках.

ЧИСЛА/ЕДИНИЦЫ:
- Для русскоязычного текста десятичный разделитель запятая допустим. НЕ предлагай замену.

ЧТО ИСКАТЬ:
- Грамматические ошибки, опечатки, влияющие на смысл
- Плейсхолдеры ([TBD], [INSERT], TODO, "___", "<...>")
- Двойные пробелы, пустые обязательные поля в таблицах
- Несогласованность терминов/сокращений в пределах фрагмента
- Ошибки нумерации/ссылок
- Перевод/транслитерация с артефактами

РАЗРЕШЁННЫЕ issue_type:
editorial_grammar_error, editorial_spelling_error, editorial_punctuation_error,
editorial_inconsistent_term_usage, editorial_inconsistent_abbreviation_usage,
editorial_inconsistent_units_notation, editorial_translation_artifact,
editorial_redundancy_conflict, editorial_typography_affects_meaning,
editorial_table_caption_mismatch, editorial_heading_content_mismatch,
editorial_reference_ambiguity, editorial_style_inconsistency

Выведи JSON-массив (может быть пустым []):
[
  {
    "mode": "self_check",
    "issue_type": "editorial_*",
    "field": "snake_case_параметр",
    "severity": "Minor|Info",
    "description": "что не так",
    "target_quote": "цитата из Target",
    "recommendation": "что исправить",
    "editorial_fix_suggestion": "конкретная правка текста",
    "confidence": "High|Medium|Low",
    "context_status": "ok|insufficient_context"
  }
]
Если проблем нет — верни пустой массив: []`;

const QA_SYSTEM_PROMPT = `Ты — старший QA-ревьюер клинических документов (Senior QC Reviewer). Тебе даны находки (замечания) от первичного аудита и текст документа.

Для КАЖДОЙ находки определи вердикт:
1. **confirmed** — находка реальная, серьёзность правильная
2. **dismissed** — ложное срабатывание:
   - Текст корректен в контексте полного документа
   - Разные артефакты (source vs eCRF) путаются с конфликтом
   - Разные уровни цепочки отчётности путаются с конфликтом
   - Разные сценарии/этапы/когорты путаются с конфликтом
   - Отсутствие параметра выдаётся за противоречие
   - Терминологическое различие без изменения смысла
3. **adjusted** — находка реальная, но серьёзность нужно изменить

КАЛИБРОВКА:
- Опечатки/варианты написания → максимум Minor
- «Отсутствует уточнение» → максимум Minor/Info
- Critical — только прямой риск безопасности/дозирования
- Дубли между находками → dismiss все кроме одной

Проверяй каждую находку по контексту ВСЕГО документа, а не только по цитате.

Верни СТРОГО JSON массив:
[
  {
    "id": "<finding_id>",
    "verdict": "confirmed|dismissed|adjusted",
    "new_severity": "Critical|Major|Minor|Info",
    "reason": "краткое обоснование на русском"
  }
]`;
