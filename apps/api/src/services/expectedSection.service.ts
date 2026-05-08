import { createHash } from "node:crypto";
import { prisma } from "@clinscriptum/db";
import type { Prisma, GoldenStageStatus } from "@prisma/client";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

/**
 * Relational expected_sections service. Replaces JSON `expected_results.sections`
 * on `golden_sample_stage_statuses` with a normalized tree, where each row has
 * a hybrid anchor for surviving re-parses + an auto-relink to a real `Section`.
 *
 * Lifecycle:
 *  1. Annotator builds the expected tree (create/update/delete/reorder).
 *  2. `pin(expectedId, realSectionId)` snapshots the anchor from the live
 *     section so future re-parses can find this expected row.
 *  3. After every document re-parse, worker calls `relinkAfterReparse(versionId)`
 *     which re-runs a 4-level fallback match (paragraphIndex → digest → snippet →
 *     title+occurrenceIndex). Orphaned rows get `realSectionId=null` and the
 *     UI surfaces them so the annotator can re-pin manually.
 *
 * The deprecated JSON `expected_results` column is intentionally not removed —
 * UI clients migrate gradually; cleanup PR will drop it later.
 */

export interface ExpectedAnchor {
  /** Primary anchor: index of the heading paragraph in the source DOCX. */
  paragraphIndex?: number;
  /** Free-form heading text snippet, used as substring search fallback. */
  textSnippet?: string;
  /**
   * Tie-breaker when the same `title` repeats in the document (TOC + body,
   * шкалы и т.п.). 0-based: the N-th occurrence of this title in
   * document order.
   */
  occurrenceIndex?: number;
  /**
   * sha256 hex of the first 200 chars of the section's content (concat of
   * `contentBlocks[*].content`). Stable across paragraph-index drift —
   * the strongest signal for digest-level match.
   */
  contentBlockDigest?: string;
}

export type MatchMethod =
  | "paragraph"
  | "digest"
  | "snippet"
  | "title_occurrence";

interface CreateInput {
  stageStatusId: string;
  parentId?: string | null;
  title: string;
  level: number;
  anchor: ExpectedAnchor;
  standardSection?: string | null;
  order: number;
}

interface UpdateInput {
  title?: string;
  level?: number;
  anchor?: ExpectedAnchor;
  standardSection?: string | null;
  order?: number;
}

interface ReorderInput {
  parentId: string | null;
  order: number;
}

const DIGEST_PREFIX_LENGTH = 200;

/**
 * Compute a sha256 hex digest of the first 200 chars of concatenated
 * `contentBlocks[*].content`. Returns `""` (not the empty-string digest)
 * when the section has no contentBlocks — caller should treat empty as
 * "no digest available" so we don't false-match all empty sections.
 */
export function computeContentDigest(section: {
  contentBlocks?: Array<{ content: string; order?: number }> | null;
}): string {
  const blocks = section.contentBlocks ?? [];
  if (blocks.length === 0) return "";
  const sorted = [...blocks].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const joined = sorted
    .map((b) => b.content ?? "")
    .join("\n")
    .slice(0, DIGEST_PREFIX_LENGTH);
  if (!joined.trim()) return "";
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

/**
 * Compute the 0-based occurrence index of `targetSectionId` among sections
 * with the same (case-insensitive, trimmed) title in the given list.
 * Returns 0 if not found / unique title.
 */
export function computeOccurrenceIndex(
  title: string,
  allSections: Array<{ id: string; title: string }>,
  targetSectionId: string,
): number {
  const norm = (t: string) => t.trim().toLowerCase();
  const target = norm(title);
  let idx = 0;
  for (const s of allSections) {
    if (norm(s.title) !== target) continue;
    if (s.id === targetSectionId) return idx;
    idx += 1;
  }
  return 0;
}

async function loadExpectedOrThrow(id: string, tenantId: string) {
  const expected = await prisma.expectedSection.findUnique({
    where: { id },
    include: {
      goldenSampleStageStatus: {
        select: {
          id: true,
          goldenSampleId: true,
          goldenSample: { select: { tenantId: true } },
        },
      },
    },
  });
  if (!expected) {
    throw new DomainError("NOT_FOUND", "Expected section not found");
  }
  if (expected.goldenSampleStageStatus.goldenSample.tenantId !== tenantId) {
    throw new DomainError("NOT_FOUND", "Expected section not found");
  }
  return expected;
}

async function assertStageBelongsToTenant(stageStatusId: string, tenantId: string) {
  const stage = await prisma.goldenSampleStageStatus.findUnique({
    where: { id: stageStatusId },
    select: { id: true, goldenSample: { select: { tenantId: true } } },
  });
  if (!stage) {
    throw new DomainError("NOT_FOUND", "Stage status not found");
  }
  if (stage.goldenSample.tenantId !== tenantId) {
    throw new DomainError("NOT_FOUND", "Stage status not found");
  }
  return stage;
}

export const expectedSectionService = {
  /**
   * Get the full tree of expected sections for one (sample, stage). Returns
   * roots only (children are nested via `children`).
   */
  async list(tenantId: string, goldenSampleId: string, stage: string) {
    const sample = await prisma.goldenSample.findUnique({
      where: { id: goldenSampleId },
      select: { id: true, tenantId: true },
    });
    if (!sample || sample.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }
    const stageStatus = await prisma.goldenSampleStageStatus.findUnique({
      where: { goldenSampleId_stage: { goldenSampleId, stage } },
      select: { id: true },
    });
    if (!stageStatus) {
      return [];
    }
    const all = await prisma.expectedSection.findMany({
      where: { goldenSampleStageStatusId: stageStatus.id },
      orderBy: [{ parentId: "asc" }, { order: "asc" }],
    });
    // Build a tree client-side.
    type Node = (typeof all)[number] & { children: Node[] };
    const map = new Map<string, Node>();
    for (const row of all) {
      map.set(row.id, { ...row, children: [] });
    }
    const roots: Node[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  },

  async create(tenantId: string, userId: string, input: CreateInput) {
    if (!input.title.trim()) {
      throw new DomainError("BAD_REQUEST", "Title is required");
    }
    if (!Number.isInteger(input.level) || input.level < 1) {
      throw new DomainError("BAD_REQUEST", "Level must be a positive integer");
    }
    await assertStageBelongsToTenant(input.stageStatusId, tenantId);
    if (input.parentId) {
      const parent = await prisma.expectedSection.findUnique({
        where: { id: input.parentId },
        select: { goldenSampleStageStatusId: true },
      });
      if (!parent || parent.goldenSampleStageStatusId !== input.stageStatusId) {
        throw new DomainError(
          "BAD_REQUEST",
          "Parent must belong to the same stage status",
        );
      }
    }
    return prisma.expectedSection.create({
      data: {
        goldenSampleStageStatusId: input.stageStatusId,
        parentId: input.parentId ?? null,
        title: input.title.trim(),
        level: input.level,
        anchor: input.anchor as unknown as Prisma.InputJsonValue,
        standardSection: input.standardSection?.trim() || null,
        order: input.order,
        createdById: userId,
        updatedById: userId,
      },
    });
  },

  async update(
    tenantId: string,
    userId: string,
    id: string,
    patch: UpdateInput,
  ) {
    await loadExpectedOrThrow(id, tenantId);
    const data: Prisma.ExpectedSectionUpdateInput = { updatedBy: { connect: { id: userId } } };
    if (patch.title !== undefined) {
      if (!patch.title.trim()) {
        throw new DomainError("BAD_REQUEST", "Title is required");
      }
      data.title = patch.title.trim();
    }
    if (patch.level !== undefined) {
      if (!Number.isInteger(patch.level) || patch.level < 1) {
        throw new DomainError("BAD_REQUEST", "Level must be a positive integer");
      }
      data.level = patch.level;
    }
    if (patch.anchor !== undefined) {
      data.anchor = patch.anchor as unknown as Prisma.InputJsonValue;
    }
    if (patch.standardSection !== undefined) {
      data.standardSection = patch.standardSection?.trim() || null;
    }
    if (patch.order !== undefined) {
      data.order = patch.order;
    }
    return prisma.expectedSection.update({ where: { id }, data });
  },

  async delete(tenantId: string, id: string) {
    await loadExpectedOrThrow(id, tenantId);
    // FK ON DELETE CASCADE on parent_id removes children automatically.
    await prisma.expectedSection.delete({ where: { id } });
    return { deleted: true };
  },

  /**
   * Pin an expected section to a real one — snapshots the anchor from the
   * live `Section` so future re-parses can re-match. `matchMethod="paragraph"`
   * because at pin-time the user explicitly chose it.
   */
  async pin(tenantId: string, expectedId: string, realSectionId: string) {
    const expected = await loadExpectedOrThrow(expectedId, tenantId);

    const real = await prisma.section.findUnique({
      where: { id: realSectionId },
      include: {
        contentBlocks: { orderBy: { order: "asc" } },
        docVersion: {
          select: {
            id: true,
            document: { select: { study: { select: { tenantId: true } } } },
          },
        },
      },
    });
    if (!real) {
      throw new DomainError("NOT_FOUND", "Section not found");
    }
    if (real.docVersion.document.study.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Section not found");
    }

    const sourceAnchor = (real.sourceAnchor ?? {}) as {
      paragraphIndex?: number;
      textSnippet?: string;
    };
    const allSiblingTitles = await prisma.section.findMany({
      where: { docVersionId: real.docVersionId },
      select: { id: true, title: true },
      orderBy: { order: "asc" },
    });
    const occurrenceIndex = computeOccurrenceIndex(
      real.title,
      allSiblingTitles,
      real.id,
    );
    const digest = computeContentDigest(real);
    const anchor: ExpectedAnchor = {
      paragraphIndex:
        typeof sourceAnchor.paragraphIndex === "number"
          ? sourceAnchor.paragraphIndex
          : undefined,
      textSnippet: sourceAnchor.textSnippet || real.title,
      occurrenceIndex,
      contentBlockDigest: digest || undefined,
    };

    return prisma.expectedSection.update({
      where: { id: expected.id },
      data: {
        anchor: anchor as unknown as Prisma.InputJsonValue,
        realSectionId: real.id,
        matchMethod: "paragraph",
        matchedAt: new Date(),
      },
    });
  },

  async unpin(tenantId: string, id: string) {
    await loadExpectedOrThrow(id, tenantId);
    return prisma.expectedSection.update({
      where: { id },
      data: {
        realSectionId: null,
        matchMethod: null,
        matchedAt: null,
      },
    });
  },

  /**
   * Move an expected section in the tree: change parent and/or order. Both
   * old and new parent (if any) must belong to the same stage status.
   */
  async reorder(
    tenantId: string,
    id: string,
    input: ReorderInput,
  ) {
    const expected = await loadExpectedOrThrow(id, tenantId);
    if (input.parentId) {
      const newParent = await prisma.expectedSection.findUnique({
        where: { id: input.parentId },
        select: { goldenSampleStageStatusId: true, id: true },
      });
      if (
        !newParent ||
        newParent.goldenSampleStageStatusId !==
          expected.goldenSampleStageStatusId
      ) {
        throw new DomainError(
          "BAD_REQUEST",
          "Parent must belong to the same stage status",
        );
      }
      if (newParent.id === id) {
        throw new DomainError("BAD_REQUEST", "Cannot parent a section to itself");
      }
    }
    return prisma.expectedSection.update({
      where: { id },
      data: { parentId: input.parentId ?? null, order: input.order },
    });
  },

  computeContentDigest,
  computeOccurrenceIndex,

  /**
   * Re-link expected sections with real after a re-parse of `docVersionId`.
   *
   * Sequential matching algorithm (per expected row):
   *  1. paragraphIndex — exact match against `Section.sourceAnchor.paragraphIndex`
   *  2. contentBlockDigest — sha256 of first 200 chars of section content
   *  3. textSnippet — substring search (filtered by level)
   *  4. title + occurrenceIndex — N-th section with this title
   * If nothing matches → `realSectionId=null, matchMethod=null` (orphaned).
   *
   * Returns counts per outcome for observability.
   */
  async relinkAfterReparse(docVersionId: string) {
    return relinkExpectedSections(prisma, docVersionId);
  },
};

/**
 * Standalone re-link routine used by both:
 *  • `expectedSectionService.relinkAfterReparse` (api / tests)
 *  • workers/parse-document handler (re-export below in worker file)
 *
 * Implemented as a top-level fn so workers can import the service from
 * the api package without dragging in router-only deps.
 */
export async function relinkExpectedSections(
  client: Prisma.TransactionClient | typeof prisma,
  docVersionId: string,
): Promise<{ matched: number; orphaned: number; byMethod: Record<MatchMethod, number> }> {
  const realSections = await client.section.findMany({
    where: { docVersionId },
    include: { contentBlocks: { orderBy: { order: "asc" } } },
    orderBy: { order: "asc" },
  });

  // Find expected sections that *could* relate to this docVersion. Path:
  // ExpectedSection → GoldenSampleStageStatus → GoldenSample → GoldenSampleDocument(s).
  // We only re-link expected rows whose sample has a doc with this versionId.
  const candidateStageStatuses = await client.goldenSampleStageStatus.findMany({
    where: {
      goldenSample: {
        documents: { some: { documentVersionId: docVersionId } },
      },
    },
    select: { id: true },
  });
  const stageStatusIds = candidateStageStatuses.map((s) => s.id);
  if (stageStatusIds.length === 0) {
    return { matched: 0, orphaned: 0, byMethod: emptyByMethod() };
  }

  const expectedRows = await client.expectedSection.findMany({
    where: { goldenSampleStageStatusId: { in: stageStatusIds } },
  });
  if (expectedRows.length === 0) {
    return { matched: 0, orphaned: 0, byMethod: emptyByMethod() };
  }

  // Pre-compute lookup tables.
  const byParagraph = new Map<number, typeof realSections[number]>();
  for (const s of realSections) {
    const pi = (s.sourceAnchor as { paragraphIndex?: number } | null)?.paragraphIndex;
    if (typeof pi === "number") byParagraph.set(pi, s);
  }
  const digestToSection = new Map<string, typeof realSections[number]>();
  for (const s of realSections) {
    const d = computeContentDigest(s);
    if (d) digestToSection.set(d, s);
  }
  // For occurrenceIndex matching: title (lowercased+trimmed) → ordered sections.
  const titleToSections = new Map<string, typeof realSections>();
  for (const s of realSections) {
    const key = s.title.trim().toLowerCase();
    const arr = titleToSections.get(key) ?? [];
    arr.push(s);
    titleToSections.set(key, arr);
  }

  const byMethod: Record<MatchMethod, number> = emptyByMethod();
  let matched = 0;
  let orphaned = 0;

  for (const exp of expectedRows) {
    const anchor = (exp.anchor ?? {}) as ExpectedAnchor;
    let match: { id: string; method: MatchMethod } | null = null;

    // (1) paragraphIndex
    if (typeof anchor.paragraphIndex === "number") {
      const hit = byParagraph.get(anchor.paragraphIndex);
      if (hit) match = { id: hit.id, method: "paragraph" };
    }
    // (2) digest
    if (!match && anchor.contentBlockDigest) {
      const hit = digestToSection.get(anchor.contentBlockDigest);
      if (hit) match = { id: hit.id, method: "digest" };
    }
    // (3) snippet (substring, filtered by level if available)
    if (!match && anchor.textSnippet) {
      const needle = anchor.textSnippet.trim().toLowerCase();
      if (needle.length > 0) {
        const hit = realSections.find((s) => {
          if (s.level !== exp.level) return false;
          return s.title.toLowerCase().includes(needle);
        });
        if (hit) match = { id: hit.id, method: "snippet" };
      }
    }
    // (4) title + occurrenceIndex
    if (!match) {
      const titleKey = exp.title.trim().toLowerCase();
      const arr = titleToSections.get(titleKey);
      if (arr && arr.length > 0) {
        const idx = anchor.occurrenceIndex ?? 0;
        const hit = arr[idx] ?? arr[0];
        if (hit) match = { id: hit.id, method: "title_occurrence" };
      }
    }

    if (match) {
      matched += 1;
      byMethod[match.method] += 1;
      await client.expectedSection.update({
        where: { id: exp.id },
        data: {
          realSectionId: match.id,
          matchMethod: match.method,
          matchedAt: new Date(),
        },
      });
    } else {
      orphaned += 1;
      // Reset to null so UI can flag as orphaned.
      if (exp.realSectionId !== null) {
        await client.expectedSection.update({
          where: { id: exp.id },
          data: { realSectionId: null, matchMethod: null, matchedAt: null },
        });
      }
    }
  }

  logger.info("expected_sections_relinked", {
    docVersionId,
    total: expectedRows.length,
    matched,
    orphaned,
    byMethod,
  });

  return { matched, orphaned, byMethod };
}

function emptyByMethod(): Record<MatchMethod, number> {
  return { paragraph: 0, digest: 0, snippet: 0, title_occurrence: 0 };
}

// Re-export types so consumers don't need to hit Prisma client types.
export type { GoldenStageStatus };
