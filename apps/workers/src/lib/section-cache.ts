import { prisma } from "@clinscriptum/db";
import type { PipelineContext } from "../pipeline/orchestrator.js";

export interface CachedSection {
  id: string;
  title: string;
  standardSection: string | null;
  confidence: number | null;
  classifiedBy: string | null;
  algoSection: string | null;
  algoConfidence: number | null;
  llmSection: string | null;
  llmConfidence: number | null;
  level: number | null;
  order: number | null;
  contentBlocks: Array<{ id: string; type: string | null; content: string; rawHtml: string | null; order: number | null }>;
}

const CACHE_KEY = "sections_with_blocks";

export async function loadSections(ctx: PipelineContext): Promise<CachedSection[]> {
  const cached = ctx.sectionsCache.get(CACHE_KEY);
  if (cached) return cached as CachedSection[];

  const sections = await prisma.section.findMany({
    where: { docVersionId: ctx.docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  ctx.sectionsCache.set(CACHE_KEY, sections);
  return sections as CachedSection[];
}

export function invalidateSectionsCache(ctx: PipelineContext): void {
  ctx.sectionsCache.delete(CACHE_KEY);
}
