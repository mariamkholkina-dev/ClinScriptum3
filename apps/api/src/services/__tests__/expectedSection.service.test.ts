import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    goldenSample: { findUnique: vi.fn() },
    goldenSampleStageStatus: { findUnique: vi.fn(), findMany: vi.fn() },
    expectedSection: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    section: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@clinscriptum/db";
import {
  expectedSectionService,
  computeContentDigest,
  computeOccurrenceIndex,
  relinkExpectedSections,
} from "../expectedSection.service.js";
import { DomainError } from "../errors.js";

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<A, R>>
    : T[K] extends Record<string, unknown>
      ? Mocked<T[K]>
      : T[K];
};

const m = prisma as unknown as Mocked<{
  goldenSample: { findUnique: ReturnType<typeof vi.fn> };
  goldenSampleStageStatus: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  expectedSection: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  section: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
}>;

const TENANT = "t1";
const USER = "user-1";
const SAMPLE = "sample-aaa";
const STAGE = "classification";
const STAGE_STATUS = "stagestatus-1";
const DOC_VERSION = "doc-v-1";

describe("computeContentDigest", () => {
  it("returns sha256 hex of first 200 chars", () => {
    const d = computeContentDigest({
      contentBlocks: [
        { content: "Hello, world!", order: 0 },
        { content: "Second block", order: 1 },
      ],
    });
    expect(d).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns empty string for sections with no content blocks", () => {
    expect(computeContentDigest({ contentBlocks: [] })).toBe("");
    expect(computeContentDigest({ contentBlocks: null })).toBe("");
  });

  it("returns empty string for blocks containing only whitespace", () => {
    expect(
      computeContentDigest({
        contentBlocks: [{ content: "   \n  ", order: 0 }],
      }),
    ).toBe("");
  });

  it("is order-independent re. block.order field (sorts by order)", () => {
    const a = computeContentDigest({
      contentBlocks: [
        { content: "First", order: 0 },
        { content: "Second", order: 1 },
      ],
    });
    const b = computeContentDigest({
      contentBlocks: [
        { content: "Second", order: 1 },
        { content: "First", order: 0 },
      ],
    });
    expect(a).toBe(b);
  });
});

describe("computeOccurrenceIndex", () => {
  it("returns 0 for unique titles", () => {
    const idx = computeOccurrenceIndex(
      "Введение",
      [
        { id: "a", title: "Введение" },
        { id: "b", title: "Цели" },
      ],
      "a",
    );
    expect(idx).toBe(0);
  });

  it("returns N-th occurrence (0-based) for repeated titles", () => {
    const list = [
      { id: "toc", title: "Шкала ECOG" },
      { id: "body", title: "Шкала ECOG" },
      { id: "appendix", title: "Шкала ECOG" },
    ];
    expect(computeOccurrenceIndex("Шкала ECOG", list, "toc")).toBe(0);
    expect(computeOccurrenceIndex("Шкала ECOG", list, "body")).toBe(1);
    expect(computeOccurrenceIndex("Шкала ECOG", list, "appendix")).toBe(2);
  });

  it("ignores case + trim differences", () => {
    const list = [
      { id: "a", title: "  Введение  " },
      { id: "b", title: "введение" },
    ];
    expect(computeOccurrenceIndex("Введение", list, "b")).toBe(1);
  });
});

describe("expectedSectionService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.goldenSampleStageStatus.findUnique.mockResolvedValue({
      id: STAGE_STATUS,
      goldenSample: { tenantId: TENANT },
    });
    m.expectedSection.create.mockResolvedValue({ id: "exp-1" });
  });

  it("creates a root expected section", async () => {
    const result = await expectedSectionService.create(TENANT, USER, {
      stageStatusId: STAGE_STATUS,
      title: "Введение",
      level: 1,
      anchor: { paragraphIndex: 5, textSnippet: "Введение" },
      standardSection: "overview",
      order: 0,
    });
    expect(result.id).toBe("exp-1");
    const args = m.expectedSection.create.mock.calls[0][0];
    expect(args.data.title).toBe("Введение");
    expect(args.data.level).toBe(1);
    expect(args.data.standardSection).toBe("overview");
    expect(args.data.createdById).toBe(USER);
    expect(args.data.updatedById).toBe(USER);
    expect(args.data.parentId).toBeNull();
  });

  it("rejects empty title", async () => {
    await expect(
      expectedSectionService.create(TENANT, USER, {
        stageStatusId: STAGE_STATUS,
        title: "   ",
        level: 1,
        anchor: {},
        order: 0,
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects when stageStatus belongs to a different tenant", async () => {
    m.goldenSampleStageStatus.findUnique.mockResolvedValue({
      id: STAGE_STATUS,
      goldenSample: { tenantId: "other-tenant" },
    });
    await expect(
      expectedSectionService.create(TENANT, USER, {
        stageStatusId: STAGE_STATUS,
        title: "Введение",
        level: 1,
        anchor: {},
        order: 0,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("expectedSectionService.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a tree with nested children", async () => {
    m.goldenSample.findUnique.mockResolvedValue({ id: SAMPLE, tenantId: TENANT });
    m.goldenSampleStageStatus.findUnique.mockResolvedValue({ id: STAGE_STATUS });
    m.expectedSection.findMany.mockResolvedValue([
      { id: "root", parentId: null, title: "Введение", order: 0 },
      { id: "child1", parentId: "root", title: "Подраздел A", order: 0 },
      { id: "child2", parentId: "root", title: "Подраздел B", order: 1 },
      { id: "root2", parentId: null, title: "Цели", order: 1 },
    ]);

    const tree = await expectedSectionService.list(TENANT, SAMPLE, STAGE);
    expect(tree).toHaveLength(2);
    const root = tree[0] as { id: string; children: Array<{ id: string }> };
    expect(root.id).toBe("root");
    expect(root.children.map((c) => c.id)).toEqual(["child1", "child2"]);
  });

  it("returns [] when stage status does not yet exist", async () => {
    m.goldenSample.findUnique.mockResolvedValue({ id: SAMPLE, tenantId: TENANT });
    m.goldenSampleStageStatus.findUnique.mockResolvedValue(null);
    const tree = await expectedSectionService.list(TENANT, SAMPLE, STAGE);
    expect(tree).toEqual([]);
  });

  it("rejects when sample belongs to different tenant", async () => {
    m.goldenSample.findUnique.mockResolvedValue({ id: SAMPLE, tenantId: "other" });
    await expect(
      expectedSectionService.list(TENANT, SAMPLE, STAGE),
    ).rejects.toThrow(/not found/i);
  });
});

describe("expectedSectionService.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.expectedSection.findUnique.mockResolvedValue({
      id: "exp-1",
      goldenSampleStageStatus: {
        id: STAGE_STATUS,
        goldenSampleId: SAMPLE,
        goldenSample: { tenantId: TENANT },
      },
    });
    m.expectedSection.delete.mockResolvedValue({});
  });

  it("delegates to prisma.delete (children cascade via FK)", async () => {
    const result = await expectedSectionService.delete(TENANT, "exp-1");
    expect(result).toEqual({ deleted: true });
    expect(m.expectedSection.delete).toHaveBeenCalledWith({ where: { id: "exp-1" } });
  });

  it("rejects when expected section belongs to different tenant", async () => {
    m.expectedSection.findUnique.mockResolvedValue({
      id: "exp-1",
      goldenSampleStageStatus: {
        id: STAGE_STATUS,
        goldenSampleId: SAMPLE,
        goldenSample: { tenantId: "other" },
      },
    });
    await expect(
      expectedSectionService.delete(TENANT, "exp-1"),
    ).rejects.toThrow(/not found/i);
  });
});

describe("expectedSectionService.pin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.expectedSection.findUnique.mockResolvedValue({
      id: "exp-1",
      goldenSampleStageStatus: {
        id: STAGE_STATUS,
        goldenSampleId: SAMPLE,
        goldenSample: { tenantId: TENANT },
      },
    });
    m.section.findUnique.mockResolvedValue({
      id: "sec-1",
      title: "Введение",
      docVersionId: DOC_VERSION,
      sourceAnchor: { paragraphIndex: 7, textSnippet: "Введение" },
      contentBlocks: [{ content: "Hello content", order: 0 }],
      docVersion: { id: DOC_VERSION, document: { study: { tenantId: TENANT } } },
    });
    m.section.findMany.mockResolvedValue([
      { id: "sec-x", title: "Введение" },
      { id: "sec-1", title: "Введение" },
    ]);
    m.expectedSection.update.mockResolvedValue({});
  });

  it("snapshots anchor (paragraphIndex + digest + occurrenceIndex) from real section", async () => {
    await expectedSectionService.pin(TENANT, "exp-1", "sec-1");
    const args = m.expectedSection.update.mock.calls[0][0];
    expect(args.where.id).toBe("exp-1");
    expect(args.data.realSectionId).toBe("sec-1");
    expect(args.data.matchMethod).toBe("paragraph");
    expect(args.data.matchedAt).toBeInstanceOf(Date);
    const anchor = args.data.anchor as Record<string, unknown>;
    expect(anchor.paragraphIndex).toBe(7);
    expect(anchor.textSnippet).toBe("Введение");
    expect(anchor.occurrenceIndex).toBe(1); // sec-1 is the 2nd "Введение"
    expect(anchor.contentBlockDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects when section is from a different tenant", async () => {
    m.section.findUnique.mockResolvedValue({
      id: "sec-1",
      title: "X",
      docVersionId: DOC_VERSION,
      sourceAnchor: {},
      contentBlocks: [],
      docVersion: { id: DOC_VERSION, document: { study: { tenantId: "other" } } },
    });
    await expect(
      expectedSectionService.pin(TENANT, "exp-1", "sec-1"),
    ).rejects.toThrow(/not found/i);
  });
});

describe("relinkExpectedSections — sequential matching algorithm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupRealSections(
    sections: Array<{
      id: string;
      title: string;
      level: number;
      paragraphIndex?: number;
      content?: string;
    }>,
  ) {
    m.section.findMany.mockResolvedValue(
      sections.map((s) => ({
        id: s.id,
        title: s.title,
        level: s.level,
        order: 0,
        sourceAnchor:
          s.paragraphIndex !== undefined
            ? { paragraphIndex: s.paragraphIndex }
            : {},
        contentBlocks: s.content ? [{ content: s.content, order: 0 }] : [],
      })),
    );
  }

  function setupExpected(rows: Array<Record<string, unknown>>) {
    m.goldenSampleStageStatus.findMany.mockResolvedValue([{ id: STAGE_STATUS }]);
    m.expectedSection.findMany.mockResolvedValue(rows);
  }

  it("matches by paragraphIndex when stable across re-parse", async () => {
    setupExpected([
      {
        id: "exp-1",
        goldenSampleStageStatusId: STAGE_STATUS,
        title: "Введение",
        level: 1,
        anchor: { paragraphIndex: 5, textSnippet: "Введение" },
        realSectionId: null,
      },
    ]);
    setupRealSections([
      { id: "sec-A", title: "Введение", level: 1, paragraphIndex: 5 },
    ]);
    m.expectedSection.update.mockResolvedValue({});

    const result = await relinkExpectedSections(prisma, DOC_VERSION);
    expect(result.matched).toBe(1);
    expect(result.orphaned).toBe(0);
    expect(result.byMethod.paragraph).toBe(1);
    const updateArgs = m.expectedSection.update.mock.calls[0][0];
    expect(updateArgs.data.matchMethod).toBe("paragraph");
    expect(updateArgs.data.realSectionId).toBe("sec-A");
  });

  it("falls back to digest when paragraphIndex shifted", async () => {
    // Compute digest of "Hello content"
    const digest = computeContentDigest({
      contentBlocks: [{ content: "Hello content", order: 0 }],
    });
    setupExpected([
      {
        id: "exp-1",
        goldenSampleStageStatusId: STAGE_STATUS,
        title: "Введение",
        level: 1,
        anchor: { paragraphIndex: 5, contentBlockDigest: digest, textSnippet: "Введение" },
        realSectionId: null,
      },
    ]);
    // Real section moved to a different paragraphIndex (now 12) but content unchanged.
    setupRealSections([
      {
        id: "sec-A",
        title: "Введение",
        level: 1,
        paragraphIndex: 12,
        content: "Hello content",
      },
    ]);
    m.expectedSection.update.mockResolvedValue({});

    const result = await relinkExpectedSections(prisma, DOC_VERSION);
    expect(result.matched).toBe(1);
    expect(result.byMethod.digest).toBe(1);
    const updateArgs = m.expectedSection.update.mock.calls[0][0];
    expect(updateArgs.data.matchMethod).toBe("digest");
  });

  it("falls back to title+occurrenceIndex when digest+paragraph miss", async () => {
    setupExpected([
      {
        id: "exp-1",
        goldenSampleStageStatusId: STAGE_STATUS,
        title: "Шкала ECOG",
        level: 2,
        anchor: { occurrenceIndex: 1 },
        realSectionId: null,
      },
    ]);
    setupRealSections([
      { id: "toc", title: "Шкала ECOG", level: 2 },
      { id: "body", title: "Шкала ECOG", level: 2 },
    ]);
    m.expectedSection.update.mockResolvedValue({});

    const result = await relinkExpectedSections(prisma, DOC_VERSION);
    expect(result.matched).toBe(1);
    expect(result.byMethod.title_occurrence).toBe(1);
    const updateArgs = m.expectedSection.update.mock.calls[0][0];
    expect(updateArgs.data.realSectionId).toBe("body"); // 2nd occurrence
  });

  it("marks expected as orphaned when no match found", async () => {
    setupExpected([
      {
        id: "exp-orphan",
        goldenSampleStageStatusId: STAGE_STATUS,
        title: "Никогда не встречался",
        level: 1,
        anchor: { paragraphIndex: 999 },
        realSectionId: "old-stale-id", // had a previous match
      },
    ]);
    setupRealSections([{ id: "sec-A", title: "Other", level: 1, paragraphIndex: 0 }]);
    m.expectedSection.update.mockResolvedValue({});

    const result = await relinkExpectedSections(prisma, DOC_VERSION);
    expect(result.orphaned).toBe(1);
    expect(result.matched).toBe(0);
    const updateArgs = m.expectedSection.update.mock.calls[0][0];
    expect(updateArgs.data.realSectionId).toBeNull();
    expect(updateArgs.data.matchMethod).toBeNull();
  });

  it("returns zero counts when no sample references this docVersion", async () => {
    m.goldenSampleStageStatus.findMany.mockResolvedValue([]);
    const result = await relinkExpectedSections(prisma, DOC_VERSION);
    expect(result.matched).toBe(0);
    expect(result.orphaned).toBe(0);
  });
});
