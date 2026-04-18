import { prisma } from "@clinscriptum/db";
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
      groups.set(groupKey, {
        stage: correction.stage,
        entityType: correction.entityType,
        patternKey,
        correctionIds: [correction.id],
        suggestedChange: describeSuggestedChange(
          correction.originalValue as Record<string, unknown>,
          correction.correctedValue as Record<string, unknown>,
        ),
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
