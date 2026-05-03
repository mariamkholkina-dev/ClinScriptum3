import { prisma } from "@clinscriptum/db";
import type { RecommendationType } from "@prisma/client";
import { logger } from "../lib/logger.js";

const MIN_FREQUENCY_THRESHOLD = 3;

export async function handleAnalyzeCorrections(data: { tenantId: string }) {
  const tenantId = data.tenantId;

  logger.info("Starting correction analysis", { tenantId });

  const corrections = await prisma.correctionRecord.findMany({
    where: {
      tenantId,
      isProcessed: false,
    },
    orderBy: { createdAt: "asc" },
  });

  if (corrections.length === 0) {
    logger.info("No unprocessed corrections found", { tenantId });
    return { success: true, processed: 0, recommendations: 0 };
  }

  // Group by (stage, entityType, patternKey)
  const groups = new Map<
    string,
    {
      stage: string;
      entityType: string;
      patternKey: string;
      correctionIds: string[];
      suggestedChange: string;
      recommendationType: RecommendationType;
      suggestedChangeData: Record<string, unknown>;
    }
  >();

  for (const correction of corrections) {
    const patternKey = derivePatternKey(
      correction.originalValue as Record<string, unknown>,
      correction.correctedValue as Record<string, unknown>,
    );
    const groupKey = `${correction.stage}:${correction.entityType}:${patternKey}`;

    const existing = groups.get(groupKey);
    if (existing) {
      existing.correctionIds.push(correction.id);
    } else {
      const classification = classifyRecommendation(
        correction.stage,
        correction.entityType,
        correction.originalValue as Record<string, unknown>,
        correction.correctedValue as Record<string, unknown>,
      );
      groups.set(groupKey, {
        stage: correction.stage,
        entityType: correction.entityType,
        patternKey,
        correctionIds: [correction.id],
        suggestedChange: describeSuggestedChange(
          correction.originalValue as Record<string, unknown>,
          correction.correctedValue as Record<string, unknown>,
        ),
        recommendationType: classification.type,
        suggestedChangeData: classification.data,
      });
    }
  }

  let recommendationsCreated = 0;

  for (const [, group] of groups) {
    if (group.correctionIds.length >= MIN_FREQUENCY_THRESHOLD) {
      // Check if a pending recommendation with same pattern already exists
      const existingRec = await prisma.correctionRecommendation.findFirst({
        where: {
          tenantId,
          stage: group.stage,
          pattern: group.patternKey,
          status: "pending",
        },
      });

      if (existingRec) {
        // Update frequency on existing recommendation
        await prisma.correctionRecommendation.update({
          where: { id: existingRec.id },
          data: {
            frequency: existingRec.frequency + group.correctionIds.length,
          },
        });

        // Link corrections to existing recommendation
        await prisma.correctionRecord.updateMany({
          where: { id: { in: group.correctionIds } },
          data: {
            isProcessed: true,
            recommendationId: existingRec.id,
          },
        });
      } else {
        const recommendation = await prisma.correctionRecommendation.create({
          data: {
            tenantId,
            stage: group.stage,
            pattern: group.patternKey,
            frequency: group.correctionIds.length,
            suggestedChange: group.suggestedChange,
            recommendationType: group.recommendationType,
            suggestedChangeData: group.suggestedChangeData as any,
            status: "pending",
          },
        });

        await prisma.correctionRecord.updateMany({
          where: { id: { in: group.correctionIds } },
          data: {
            isProcessed: true,
            recommendationId: recommendation.id,
          },
        });

        recommendationsCreated++;
      }
    } else {
      // Below threshold — still mark as processed so we don't reprocess
      await prisma.correctionRecord.updateMany({
        where: { id: { in: group.correctionIds } },
        data: { isProcessed: true },
      });
    }
  }

  logger.info("Correction analysis completed", {
    tenantId,
    totalProcessed: corrections.length,
    groups: groups.size,
    recommendationsCreated,
  });

  return {
    success: true,
    processed: corrections.length,
    recommendations: recommendationsCreated,
  };
}

/**
 * Derives a pattern key from original → corrected value pair.
 * Groups corrections that represent the same kind of change.
 */
function derivePatternKey(
  original: Record<string, unknown>,
  corrected: Record<string, unknown>,
): string {
  const changedFields: string[] = [];
  const allKeys = new Set([...Object.keys(original), ...Object.keys(corrected)]);

  for (const key of allKeys) {
    const origVal = original[key];
    const corrVal = corrected[key];
    if (JSON.stringify(origVal) !== JSON.stringify(corrVal)) {
      changedFields.push(key);
    }
  }

  changedFields.sort();

  if (changedFields.length === 0) {
    return "no_change";
  }

  // Build pattern: field names that changed + a normalized representation of the change type
  const parts = changedFields.map((field) => {
    const origVal = original[field];
    const corrVal = corrected[field];
    const origType = origVal == null ? "null" : typeof origVal;
    const corrType = corrVal == null ? "null" : typeof corrVal;
    return `${field}:${origType}->${corrType}`;
  });

  return parts.join("|");
}

/**
 * Phase 5 fact-extraction roadmap: classify a correction so the rule-admin
 * UI can offer a typed apply-button. Heuristics:
 *   - extraction stage + value-only change with the new value containing a
 *     keyword absent from `fact_anchors` for that factKey → `anchor_keyword`
 *   - extraction stage + same factKey but different normalised value
 *     → `synonym` (suggests adding a canonicalize alias)
 *   - extraction stage + change of `standardSection` or section assignment
 *     → `section_prior`
 *   - any LLM-stage change → `prompt_template`
 *   - everything else → `other`
 *
 * All branches return `data` containing the structured fields needed to
 * apply the change (e.g. { factKey, keyword } for anchor_keyword), which
 * the UI consumes verbatim. We avoid hitting the DB here to keep this
 * handler hot-loop fast — anchor lookup, etc., happens at apply-time.
 */
function classifyRecommendation(
  stage: string,
  entityType: string,
  original: Record<string, unknown>,
  corrected: Record<string, unknown>,
): { type: RecommendationType; data: Record<string, unknown> } {
  const isExtraction = stage === "fact_extraction" || stage === "extraction";
  const factKey =
    typeof corrected.factKey === "string"
      ? (corrected.factKey as string)
      : typeof original.factKey === "string"
        ? (original.factKey as string)
        : undefined;

  if (isExtraction && factKey) {
    const origVal = typeof original.value === "string" ? original.value : "";
    const corrVal = typeof corrected.value === "string" ? corrected.value : "";
    const origSection = original.standardSection ?? original.sectionStandardCode;
    const corrSection = corrected.standardSection ?? corrected.sectionStandardCode;

    if (origSection !== corrSection && corrSection) {
      return {
        type: "section_prior",
        data: { factKey, expectedSections: [String(corrSection)] },
      };
    }
    if (origVal && corrVal && origVal.toLowerCase() === corrVal.toLowerCase()) {
      return { type: "other", data: { factKey } };
    }
    if (corrVal && !origVal) {
      const tokens = corrVal
        .toLowerCase()
        .split(/[\s,;:.()/-]+/)
        .filter((t) => t.length >= 4);
      return {
        type: "anchor_keyword",
        data: { factKey, suggestedKeywords: tokens.slice(0, 5) },
      };
    }
    if (origVal && corrVal) {
      return {
        type: "synonym",
        data: { factKey, from: origVal, to: corrVal },
      };
    }
  }

  if (stage.includes("llm") || entityType === "prompt") {
    return { type: "prompt_template", data: { stage, entityType } };
  }

  return { type: "other", data: {} };
}

/**
 * Creates a human-readable description of the suggested change.
 */
function describeSuggestedChange(
  original: Record<string, unknown>,
  corrected: Record<string, unknown>,
): string {
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(original), ...Object.keys(corrected)]);

  for (const key of allKeys) {
    const origVal = original[key];
    const corrVal = corrected[key];
    if (JSON.stringify(origVal) !== JSON.stringify(corrVal)) {
      changes.push(
        `Change "${key}" from ${JSON.stringify(origVal)} to ${JSON.stringify(corrVal)}`,
      );
    }
  }

  return changes.length > 0
    ? changes.join("; ")
    : "No changes detected";
}
