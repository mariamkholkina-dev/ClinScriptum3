import { prisma } from "@clinscriptum/db";
import { logger } from "./logger.js";

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export async function recoverStaleRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleRuns = await prisma.processingRun.findMany({
    where: {
      status: "running",
      updatedAt: { lt: cutoff },
    },
    select: { id: true, updatedAt: true },
  });

  if (staleRuns.length === 0) return 0;

  logger.warn(`Found ${staleRuns.length} stale running pipelines, marking as failed`, {
    runIds: staleRuns.map((r) => r.id),
  });

  await prisma.processingRun.updateMany({
    where: {
      id: { in: staleRuns.map((r) => r.id) },
      status: "running",
    },
    data: {
      status: "failed",
      lastError: "Recovered on worker restart: pipeline was stale",
    },
  });

  await prisma.processingStep.updateMany({
    where: {
      processingRunId: { in: staleRuns.map((r) => r.id) },
      status: "running",
    },
    data: {
      status: "failed",
      completedAt: new Date(),
    },
  });

  return staleRuns.length;
}
