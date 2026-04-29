import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  versionFindUniqueOrThrow,
  versionUpdate,
  runCreate,
  runUpdate,
  resolveBundleMock,
  parseHandler,
  classifyHandler,
  extractHandler,
  intraHandler,
  detectSoaMock,
} = vi.hoisted(() => ({
  versionFindUniqueOrThrow: vi.fn(),
  versionUpdate: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  resolveBundleMock: vi.fn(),
  parseHandler: vi.fn(),
  classifyHandler: vi.fn(),
  extractHandler: vi.fn(),
  intraHandler: vi.fn(),
  detectSoaMock: vi.fn(),
}));

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: {
      findUniqueOrThrow: versionFindUniqueOrThrow,
      update: versionUpdate,
    },
    processingRun: {
      create: runCreate,
      update: runUpdate,
    },
  },
  resolveActiveBundle: resolveBundleMock,
}));

vi.mock("@clinscriptum/shared/soa-detection", () => ({
  detectSoaForVersion: detectSoaMock,
}));

vi.mock("../parse-document.js", () => ({ handleParseDocument: parseHandler }));
vi.mock("../classify-sections.js", () => ({ handleClassifySections: classifyHandler }));
vi.mock("../extract-facts.js", () => ({ handleExtractFacts: extractHandler }));
vi.mock("../intra-doc-audit.js", () => ({ handleIntraDocAudit: intraHandler }));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { handleRunPipeline } from "../run-pipeline.js";

const VERSION_ID = "version-1";
const STUDY_ID = "study-1";
const TENANT_ID = "tenant-1";

function makeVersion(type: "protocol" | "icf" | "csr") {
  return {
    id: VERSION_ID,
    document: {
      type,
      studyId: STUDY_ID,
      study: {
        id: STUDY_ID,
        tenantId: TENANT_ID,
        operatorReviewEnabled: false,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveBundleMock.mockResolvedValue("bundle-1");
  versionUpdate.mockResolvedValue({});
  runCreate.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `${data.type}-run-id`, ...data }),
  );
  runUpdate.mockResolvedValue({});
  parseHandler.mockResolvedValue(undefined);
  classifyHandler.mockResolvedValue(undefined);
  extractHandler.mockResolvedValue(undefined);
  intraHandler.mockResolvedValue(undefined);
  detectSoaMock.mockResolvedValue(undefined);
});

describe("handleRunPipeline", () => {
  describe("protocol document", () => {
    it("runs all 5 stages in order: parse → classify → extract facts → SOA → intra-audit", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("protocol"));

      await handleRunPipeline({ versionId: VERSION_ID });

      expect(parseHandler).toHaveBeenCalledWith({ versionId: VERSION_ID });
      expect(classifyHandler).toHaveBeenCalledTimes(1);
      expect(extractHandler).toHaveBeenCalledTimes(1);
      expect(detectSoaMock).toHaveBeenCalledWith(VERSION_ID, expect.anything());
      expect(intraHandler).toHaveBeenCalledTimes(1);
    });

    it("sets version status at each pipeline stage and finalizes as 'parsed'", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("protocol"));

      await handleRunPipeline({ versionId: VERSION_ID });

      const statusUpdates = versionUpdate.mock.calls.map((c) => c[0].data.status);
      expect(statusUpdates).toEqual([
        "classifying_sections",
        "extracting_facts",
        "detecting_soa",
        "intra_audit",
        "parsed",
      ]);
    });

    it("creates a ProcessingRun for each pipeline stage with the active bundle", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("protocol"));

      await handleRunPipeline({ versionId: VERSION_ID });

      const types = runCreate.mock.calls.map((c) => c[0].data.type);
      expect(types).toEqual([
        "section_classification",
        "fact_extraction",
        "soa_detection",
        "intra_doc_audit",
      ]);
      for (const call of runCreate.mock.calls) {
        expect(call[0].data.ruleSetBundleId).toBe("bundle-1");
        expect(call[0].data.studyId).toBe(STUDY_ID);
      }
    });

    it("when SOA detection throws, marks the SOA run as failed and rethrows (status='error')", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("protocol"));
      detectSoaMock.mockRejectedValueOnce(new Error("soa boom"));

      await expect(handleRunPipeline({ versionId: VERSION_ID })).rejects.toThrow("soa boom");

      const failedSoaCall = runUpdate.mock.calls.find(
        (c) => c[0].where.id === "soa_detection-run-id" && c[0].data.status === "failed",
      );
      expect(failedSoaCall).toBeDefined();
      expect(failedSoaCall![0].data.lastError).toContain("soa boom");

      const finalStatus = versionUpdate.mock.calls.at(-1)![0].data.status;
      expect(finalStatus).toBe("error");
      expect(intraHandler).not.toHaveBeenCalled();
    });
  });

  describe("non-protocol document (icf/csr)", () => {
    it("skips fact extraction and SOA detection for ICF", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("icf"));

      await handleRunPipeline({ versionId: VERSION_ID });

      expect(parseHandler).toHaveBeenCalledTimes(1);
      expect(classifyHandler).toHaveBeenCalledTimes(1);
      expect(extractHandler).not.toHaveBeenCalled();
      expect(detectSoaMock).not.toHaveBeenCalled();
      expect(intraHandler).toHaveBeenCalledTimes(1);
    });

    it("statuses for non-protocol skip 'extracting_facts' and 'detecting_soa'", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("csr"));

      await handleRunPipeline({ versionId: VERSION_ID });

      const statusUpdates = versionUpdate.mock.calls.map((c) => c[0].data.status);
      expect(statusUpdates).toEqual([
        "classifying_sections",
        "intra_audit",
        "parsed",
      ]);
    });
  });

  describe("error handling", () => {
    it("when parse handler throws, sets status to 'error' and rethrows", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("protocol"));
      parseHandler.mockRejectedValueOnce(new Error("parse failed"));

      await expect(handleRunPipeline({ versionId: VERSION_ID })).rejects.toThrow("parse failed");

      const finalStatus = versionUpdate.mock.calls.at(-1)![0].data.status;
      expect(finalStatus).toBe("error");
    });

    it("when classify handler throws, sets status to 'error'", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("protocol"));
      classifyHandler.mockRejectedValueOnce(new Error("classify failed"));

      await expect(handleRunPipeline({ versionId: VERSION_ID })).rejects.toThrow("classify failed");

      const finalStatus = versionUpdate.mock.calls.at(-1)![0].data.status;
      expect(finalStatus).toBe("error");
    });

    it("does not throw when setVersionStatus(error) itself fails", async () => {
      versionFindUniqueOrThrow.mockResolvedValue(makeVersion("protocol"));
      parseHandler.mockRejectedValueOnce(new Error("primary"));
      // First successful update sets status -> classifying_sections; we want the
      // last call (error) to fail silently. parseHandler throws BEFORE any
      // versionUpdate, so the only call is the catch-block 'error' update.
      versionUpdate.mockRejectedValueOnce(new Error("status update failed"));

      await expect(handleRunPipeline({ versionId: VERSION_ID })).rejects.toThrow("primary");
    });
  });
});
