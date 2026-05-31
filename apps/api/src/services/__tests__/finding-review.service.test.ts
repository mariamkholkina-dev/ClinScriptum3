import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    findingReview: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    finding: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    findingReviewLog: {
      create: vi.fn(),
    },
    section: {
      findMany: vi.fn(),
    },
    goldenSample: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@clinscriptum/db";
import { findingReviewService } from "../finding-review.service.js";
import { DomainError } from "../errors.js";

const mockReview = prisma.findingReview as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const mockFinding = prisma.finding as unknown as {
  count: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const mockLog = (prisma as any).findingReviewLog as { create: ReturnType<typeof vi.fn> };
const mockSection = (prisma as any).section as { findMany: ReturnType<typeof vi.fn> };
const mockGolden = (prisma as any).goldenSample as { findMany: ReturnType<typeof vi.fn> };

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const REVIEW_ID = "rev-1";
const FINDING_ID = "find-1";
const USER_ID = "user-1";
const DOC_VERSION_ID = "dv-1";

function makeReview(tenantId = TENANT_A, status = "pending") {
  return {
    id: REVIEW_ID,
    tenantId,
    docVersionId: DOC_VERSION_ID,
    auditType: "intra_audit",
    protocolVersionId: null,
    status,
    createdAt: new Date(),
    publishedAt: null,
    reviewerId: null,
    docVersion: {
      versionNumber: 1,
      versionLabel: "v1",
      document: {
        type: "protocol",
        title: "Doc Title",
        study: { tenantId, title: "Study X" },
      },
    },
    reviewer: null,
  };
}

function makeFinding(tenantId = TENANT_A) {
  return {
    id: FINDING_ID,
    docVersionId: DOC_VERSION_ID,
    severity: "medium",
    hiddenByReviewer: false,
    reviewerNote: null,
    docVersion: {
      document: { study: { tenantId } },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLog.create.mockResolvedValue({});
});

describe("findingReviewService.dashboard", () => {
  it("returns reviews scoped to tenantId with findings count per review", async () => {
    mockReview.findMany.mockResolvedValueOnce([makeReview()]);
    mockFinding.count.mockResolvedValueOnce(7);

    const result = await findingReviewService.dashboard(TENANT_A);

    expect(mockReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_A, status: { in: ["pending", "in_review"] } },
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].findingsCount).toBe(7);
  });

  it("excludes false_positive findings from count", async () => {
    mockReview.findMany.mockResolvedValueOnce([makeReview()]);
    mockFinding.count.mockResolvedValueOnce(3);

    await findingReviewService.dashboard(TENANT_A);

    expect(mockFinding.count).toHaveBeenCalledWith({
      where: {
        docVersionId: DOC_VERSION_ID,
        type: { in: ["intra_audit", "editorial", "semantic"] },
        status: { not: "false_positive" },
      },
    });
  });
});

describe("findingReviewService.getReview", () => {
  it("returns review + findings + sections when tenant matches", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findMany.mockResolvedValueOnce([{ id: "f1", severity: "high" }]);
    mockSection.findMany.mockResolvedValueOnce([
      { id: "s1", title: "Раздел", standardSection: "5", order: 0, contentBlocks: [{ content: "текст" }] },
    ]);

    const result = await findingReviewService.getReview(TENANT_A, REVIEW_ID);

    expect(result.review.id).toBe(REVIEW_ID);
    expect(result.findings).toHaveLength(1);
    expect(result.sections).toEqual([
      { id: "s1", title: "Раздел", standardSection: "5", content: "текст" },
    ]);
  });

  it("rejects cross-tenant access", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview(TENANT_B));

    await expect(
      findingReviewService.getReview(TENANT_A, REVIEW_ID),
    ).rejects.toThrow(DomainError);
  });

  it("includes ALL findings regardless of status (вкл. false_positive)", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findMany.mockResolvedValueOnce([]);
    mockSection.findMany.mockResolvedValueOnce([]);

    await findingReviewService.getReview(TENANT_A, REVIEW_ID);

    expect(mockFinding.findMany).toHaveBeenCalledWith({
      where: {
        docVersionId: DOC_VERSION_ID,
        type: { in: ["intra_audit", "editorial", "semantic"] },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });
  });
});

describe("findingReviewService.startReview", () => {
  it("transitions pending → in_review and assigns reviewer", async () => {
    mockReview.findUnique.mockResolvedValueOnce({ ...makeReview(), status: "pending" });
    mockReview.update.mockResolvedValueOnce({});

    await findingReviewService.startReview(TENANT_A, REVIEW_ID, USER_ID);

    expect(mockReview.update).toHaveBeenCalledWith({
      where: { id: REVIEW_ID },
      data: { status: "in_review", reviewerId: USER_ID },
    });
  });

  it("allows continuing when already in_review", async () => {
    mockReview.findUnique.mockResolvedValueOnce({ ...makeReview(), status: "in_review" });
    mockReview.update.mockResolvedValueOnce({});

    await expect(
      findingReviewService.startReview(TENANT_A, REVIEW_ID, USER_ID),
    ).resolves.toBeDefined();
  });

  it("rejects when review is already published", async () => {
    mockReview.findUnique.mockResolvedValueOnce({ ...makeReview(), status: "published" });

    await expect(
      findingReviewService.startReview(TENANT_A, REVIEW_ID, USER_ID),
    ).rejects.toThrow(/already published/);
  });

  it("rejects cross-tenant", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview(TENANT_B));

    await expect(
      findingReviewService.startReview(TENANT_A, REVIEW_ID, USER_ID),
    ).rejects.toThrow(DomainError);
  });
});

describe("findingReviewService.toggleHidden", () => {
  it("toggles hiddenByReviewer false → true and writes audit log", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findUnique.mockResolvedValueOnce(makeFinding());
    mockFinding.update.mockResolvedValueOnce({});

    await findingReviewService.toggleHidden(TENANT_A, REVIEW_ID, FINDING_ID, USER_ID);

    expect(mockLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewId: REVIEW_ID,
        findingId: FINDING_ID,
        action: "hide",
        previousValue: "false",
        newValue: "true",
      }),
    });
    expect(mockFinding.update).toHaveBeenCalledWith({
      where: { id: FINDING_ID },
      data: { hiddenByReviewer: true },
    });
  });

  it("toggles true → false and logs unhide", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findUnique.mockResolvedValueOnce({
      ...makeFinding(),
      hiddenByReviewer: true,
    });
    mockFinding.update.mockResolvedValueOnce({});

    await findingReviewService.toggleHidden(TENANT_A, REVIEW_ID, FINDING_ID, USER_ID);

    expect(mockLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "unhide" }),
    });
  });

  it("rejects when finding belongs to another tenant", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findUnique.mockResolvedValueOnce(makeFinding(TENANT_B));

    await expect(
      findingReviewService.toggleHidden(TENANT_A, REVIEW_ID, FINDING_ID, USER_ID),
    ).rejects.toThrow(DomainError);
  });
});

describe("findingReviewService.changeSeverity", () => {
  it("updates severity and logs previous/new values", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findUnique.mockResolvedValueOnce({ ...makeFinding(), severity: "low" });
    mockFinding.update.mockResolvedValueOnce({});

    await findingReviewService.changeSeverity(TENANT_A, REVIEW_ID, FINDING_ID, "critical", USER_ID);

    expect(mockLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "change_severity",
        previousValue: "low",
        newValue: "critical",
      }),
    });
    // Пишем И колонку, И extraAttributes.severity (чтобы правка отразилась на
    // экранах, читающих extraAttributes), И originalSeverity для индикатора.
    expect(mockFinding.update).toHaveBeenCalledWith({
      where: { id: FINDING_ID },
      data: expect.objectContaining({
        severity: "critical",
        extraAttributes: expect.objectContaining({ severity: "critical" }),
        originalSeverity: "low",
      }),
    });
  });

  it("logs 'info' when previous severity was null", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findUnique.mockResolvedValueOnce({ ...makeFinding(), severity: null });
    mockFinding.update.mockResolvedValueOnce({});

    await findingReviewService.changeSeverity(TENANT_A, REVIEW_ID, FINDING_ID, "high", USER_ID);

    expect(mockLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ previousValue: "info" }),
    });
  });
});

describe("findingReviewService.addNote", () => {
  it("writes note and audit log", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findUnique.mockResolvedValueOnce({ ...makeFinding(), reviewerNote: null });
    mockFinding.update.mockResolvedValueOnce({});

    await findingReviewService.addNote(TENANT_A, REVIEW_ID, FINDING_ID, "important note", USER_ID);

    expect(mockLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "add_note",
        previousValue: null,
        newValue: "important note",
      }),
    });
    expect(mockFinding.update).toHaveBeenCalledWith({
      where: { id: FINDING_ID },
      data: { reviewerNote: "important note" },
    });
  });

  it("preserves previous note text in log when overwriting", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findUnique.mockResolvedValueOnce({ ...makeFinding(), reviewerNote: "old note" });
    mockFinding.update.mockResolvedValueOnce({});

    await findingReviewService.addNote(TENANT_A, REVIEW_ID, FINDING_ID, "new note", USER_ID);

    expect(mockLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousValue: "old note",
        newValue: "new note",
      }),
    });
  });
});

describe("findingReviewService.publish", () => {
  it("marks review as published with publishedAt set", async () => {
    mockReview.findUnique.mockResolvedValueOnce({ ...makeReview(), status: "in_review", reviewerId: USER_ID });
    mockReview.update.mockResolvedValueOnce({});

    await findingReviewService.publish(TENANT_A, REVIEW_ID, USER_ID);

    const updateCall = mockReview.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("published");
    expect(updateCall.data.publishedAt).toBeInstanceOf(Date);
  });

  it("rejects double publish", async () => {
    mockReview.findUnique.mockResolvedValueOnce({ ...makeReview(), status: "published" });

    await expect(
      findingReviewService.publish(TENANT_A, REVIEW_ID, USER_ID),
    ).rejects.toThrow(/already published/);
  });

  it("preserves existing reviewerId; falls back to current userId only if null", async () => {
    mockReview.findUnique.mockResolvedValueOnce({ ...makeReview(), status: "in_review", reviewerId: "original-reviewer" });
    mockReview.update.mockResolvedValueOnce({});

    await findingReviewService.publish(TENANT_A, REVIEW_ID, USER_ID);

    expect(mockReview.update.mock.calls[0][0].data.reviewerId).toBe("original-reviewer");
  });
});

describe("findingReviewService.getReviewStatus", () => {
  it("returns review status when found", async () => {
    mockReview.findUnique.mockResolvedValueOnce({
      id: "rev-1",
      status: "published",
      publishedAt: new Date(),
    });

    const result = await findingReviewService.getReviewStatus(DOC_VERSION_ID, "intra_audit");
    expect(result?.status).toBe("published");
  });

  it("returns null when review doesn't exist", async () => {
    mockReview.findUnique.mockResolvedValueOnce(null);

    const result = await findingReviewService.getReviewStatus(DOC_VERSION_ID, "inter_audit");
    expect(result).toBeNull();
  });
});

describe("findingReviewService.listGoldenSamples", () => {
  it("returns tenant-scoped minimal sample list", async () => {
    mockGolden.findMany.mockResolvedValueOnce([
      { id: "g1", name: "Sample 1", sampleType: "protocol" },
    ]);

    const result = await findingReviewService.listGoldenSamples(TENANT_A);

    expect(result).toHaveLength(1);
    expect(mockGolden.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A },
      select: { id: true, name: true, sampleType: true },
      orderBy: { createdAt: "desc" },
    });
  });
});

describe("findingReviewService.bulkSetHidden", () => {
  it("hides only findings whose state changes and logs each", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findMany.mockResolvedValueOnce([
      { id: "f1", docVersionId: DOC_VERSION_ID, hiddenByReviewer: false },
      { id: "f2", docVersionId: DOC_VERSION_ID, hiddenByReviewer: true }, // already hidden → skip
    ]);
    mockFinding.update.mockResolvedValue({});

    const result = await findingReviewService.bulkSetHidden(
      TENANT_A, REVIEW_ID, ["f1", "f2"], true, USER_ID,
    );

    expect(result.updated).toBe(1);
    expect(mockFinding.update).toHaveBeenCalledTimes(1);
    expect(mockFinding.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { hiddenByReviewer: true },
    });
  });

  it("rejects cross-tenant review", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview(TENANT_B));
    await expect(
      findingReviewService.bulkSetHidden(TENANT_A, REVIEW_ID, ["f1"], true, USER_ID),
    ).rejects.toThrow(DomainError);
  });
});

describe("findingReviewService.bulkChangeSeverity", () => {
  it("writes column + extraAttributes + originalSeverity per finding", async () => {
    mockReview.findUnique.mockResolvedValueOnce(makeReview());
    mockFinding.findMany.mockResolvedValueOnce([
      { id: "f1", docVersionId: DOC_VERSION_ID, severity: null, extraAttributes: { severity: "low" }, originalSeverity: null },
    ]);
    mockFinding.update.mockResolvedValue({});

    const result = await findingReviewService.bulkChangeSeverity(
      TENANT_A, REVIEW_ID, ["f1"], "high", USER_ID,
    );

    expect(result.updated).toBe(1);
    expect(mockFinding.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: expect.objectContaining({
        severity: "high",
        extraAttributes: expect.objectContaining({ severity: "high" }),
        originalSeverity: "low",
      }),
    });
  });
});
