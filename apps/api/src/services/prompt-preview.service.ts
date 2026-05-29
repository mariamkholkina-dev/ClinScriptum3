/**
 * Реконструкция реальных промтов, уходящих в LLM, для документа эталонного
 * набора — для выгрузки в .txt (дебаг/тюнинг).
 *
 * Промты собираются ТЕМИ ЖЕ builders из @clinscriptum/shared, что использует
 * worker-handler → выгруженный .txt идентичен уходящему в LLM. Тексты системных
 * промтов берутся из активного bundle (loadRulesForType), как в проде.
 *
 * PR1: только intra_audit (llm_check: self/cross/editorial или single).
 * Последующие PR расширяют на classification / extraction / soa / inter / impact / generation.
 */

import {
  prisma,
  loadRulesForType,
  resolveActiveBundle,
  getEffectiveLlmConfig,
  getInputBudgetChars,
} from "@clinscriptum/db";
import { toAuditPromptMap } from "@clinscriptum/rules-engine";
import { buildIntraAuditCheckCalls, type PromptCall, type AnchorableSectionInput } from "@clinscriptum/shared";
import { DomainError } from "./errors.js";

export interface PromptPreviewResult {
  docVersionId: string;
  documentTitle: string;
  manifest: Record<string, unknown>;
  calls: PromptCall[];
}

const MISSING = (key: string) =>
  `(промт "${key}" отсутствует в активном ruleset — handler использует встроенную fallback-константу, здесь не воспроизводится)`;

async function loadSectionsForDoc(docVersionId: string): Promise<AnchorableSectionInput[]> {
  const sections = await prisma.section.findMany({
    where: { docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });
  return sections.map((s) => ({
    title: s.title,
    standardSection: s.standardSection,
    headingNumber: s.headingNumber,
    order: s.order,
    contentBlocks: s.contentBlocks.map((b) => ({ content: b.content })),
  }));
}

/**
 * Собирает промты intra_audit (llm_check) для одного документа.
 */
async function buildIntraAuditPreview(opts: {
  docVersionId: string;
  tenantId: string;
  bundleId: string | null;
  auditMode: string;
  crossCheckPairs: [string, string][] | null;
}): Promise<{ calls: PromptCall[]; manifest: Record<string, unknown> }> {
  const { docVersionId, tenantId, bundleId, auditMode, crossCheckPairs } = opts;

  const sections = await loadSectionsForDoc(docVersionId);
  const llmConfig = await getEffectiveLlmConfig("intra_audit", tenantId);
  const inputBudget = getInputBudgetChars(llmConfig);

  const auditRules = await loadRulesForType(bundleId, "intra_audit");
  const promptMap = auditRules ? toAuditPromptMap(auditRules.rules) : new Map<string, string>();

  const plan = buildIntraAuditCheckCalls({
    sections,
    prompts: {
      fullDocSelfCheck: promptMap.get("full_doc_self_check_prompt") || MISSING("full_doc_self_check_prompt"),
      fullDocCrossCheck: promptMap.get("full_doc_cross_check_prompt") || MISSING("full_doc_cross_check_prompt"),
      fullDocEditorial: promptMap.get("full_doc_editorial_prompt") || MISSING("full_doc_editorial_prompt"),
      selfCheck: promptMap.get("self_check_prompt") || MISSING("self_check_prompt"),
      crossCheck: promptMap.get("cross_check_prompt") || MISSING("cross_check_prompt"),
      editorial: promptMap.get("editorial_prompt") || MISSING("editorial_prompt"),
    },
    inputBudget,
    auditMode,
    crossCheckPairs,
  });

  const manifest = {
    stage: "intra_audit",
    level: "llm_check",
    provider: llmConfig.provider,
    model: llmConfig.model,
    maxTokens: llmConfig.maxTokens,
    inputBudget,
    auditMode,
    variant: plan.variant,
    callCount: plan.calls.length,
    ruleSetVersionId: auditRules?.ruleSetVersionId ?? null,
    sectionsCount: sections.length,
  };

  return { calls: plan.calls, manifest };
}

export const promptPreviewService = {
  /**
   * Возвращает все реконструированные LLM-вызовы для primary-документа эталона.
   * Tenant-guard: golden sample должен принадлежать tenantId.
   */
  async getForGoldenSample(tenantId: string, goldenSampleId: string): Promise<PromptPreviewResult> {
    const sample = await prisma.goldenSample.findUnique({
      where: { id: goldenSampleId },
      include: {
        documents: {
          orderBy: { order: "asc" },
          include: {
            documentVersion: { include: { document: { include: { study: true } } } },
          },
        },
      },
    });
    if (!sample || sample.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }

    // primary-документ (первый по order, role=primary либо просто первый)
    const primary =
      sample.documents.find((d) => d.role === "primary") ?? sample.documents[0];
    if (!primary) {
      throw new DomainError("BAD_REQUEST", "Golden sample has no documents");
    }

    const dv = primary.documentVersion;
    const study = dv.document.study;
    const bundleId = await resolveActiveBundle(tenantId);

    const intra = await buildIntraAuditPreview({
      docVersionId: dv.id,
      tenantId,
      bundleId,
      auditMode: study.auditMode ?? "auto",
      crossCheckPairs: (study.crossCheckPairs as [string, string][] | null) ?? null,
    });

    return {
      docVersionId: dv.id,
      documentTitle: dv.document.title,
      manifest: {
        goldenSampleId,
        documentTitle: dv.document.title,
        docVersionId: dv.id,
        bundleId,
        generatedStages: ["intra_audit"],
        ...intra.manifest,
      },
      calls: intra.calls,
    };
  },
};
