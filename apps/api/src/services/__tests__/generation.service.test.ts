import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: { findUnique: vi.fn() },
    docTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    generatedDoc: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    generatedDocSection: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../lib/doc-generation.js", () => ({
  runDocGeneration: vi.fn().mockResolvedValue(undefined),
  getDefaultTemplate: vi.fn().mockReturnValue([
    { title: "Section A", standardSection: "purpose", order: 1 },
  ]),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { prisma } from "@clinscriptum/db";
import { generationService } from "../generation.service.js";
import { DomainError } from "../errors.js";

const mockVersion = prisma.documentVersion as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const mockTemplate = prisma.docTemplate as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
const mockGeneratedDoc = prisma.generatedDoc as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};
const mockGeneratedDocSection = prisma.generatedDocSection as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const TENANT_A = "tenant-aaa";
const TENANT_B = "tenant-bbb";
const PROTOCOL_VERSION_ID = "pv-1";
const STUDY_ID = "study-001";

function makeProtocolVersion(tenantId = TENANT_A, type = "protocol") {
  return {
    id: PROTOCOL_VERSION_ID,
    documentId: "doc-1",
    versionNumber: 1,
    versionLabel: "v1",
    document: {
      id: "doc-1",
      type,
      title: "Protocol Title",
      study: { id: STUDY_ID, tenantId, title: "Study X" },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generationService.listTemplates", () => {
  it("filters by tenantId and docType", async () => {
    mockTemplate.findMany.mockResolvedValueOnce([
      { id: "t1", name: "ICF tmpl", docType: "icf", sections: [], createdAt: new Date() },
    ]);

    const result = await generationService.listTemplates(TENANT_A, "icf");

    expect(mockTemplate.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_A, docType: "icf" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toHaveLength(1);
  });
});

describe("generationService.createTemplate", () => {
  it("creates template scoped to tenantId", async () => {
    mockTemplate.create.mockResolvedValueOnce({ id: "new-tmpl" });

    const result = await generationService.createTemplate(TENANT_A, {
      name: "Test ICF",
      docType: "icf",
      sections: [{ title: "Purpose", standardSection: "purpose", order: 1 }],
    });

    expect(result.id).toBe("new-tmpl");
    const created = mockTemplate.create.mock.calls[0][0].data;
    expect(created.tenantId).toBe(TENANT_A);
    expect(created.name).toBe("Test ICF");
  });
});

describe("generationService.deleteTemplate", () => {
  it("deletes when template belongs to tenant", async () => {
    mockTemplate.findUnique.mockResolvedValueOnce({ id: "t1", tenantId: TENANT_A });
    mockTemplate.delete.mockResolvedValueOnce({});

    const result = await generationService.deleteTemplate(TENANT_A, "t1");
    expect(result).toEqual({ success: true });
  });

  it("rejects deletion when template belongs to another tenant", async () => {
    mockTemplate.findUnique.mockResolvedValueOnce({ id: "t1", tenantId: TENANT_B });

    await expect(
      generationService.deleteTemplate(TENANT_A, "t1"),
    ).rejects.toThrow(DomainError);
    expect(mockTemplate.delete).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when template doesn't exist", async () => {
    mockTemplate.findUnique.mockResolvedValueOnce(null);

    await expect(
      generationService.deleteTemplate(TENANT_A, "missing"),
    ).rejects.toThrow(DomainError);
  });
});

describe("generationService.startGeneration", () => {
  it("starts ICF generation with default template when no templateId provided", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion());
    mockGeneratedDoc.create.mockResolvedValueOnce({ id: "gd-1" });

    const result = await generationService.startGeneration(TENANT_A, {
      protocolVersionId: PROTOCOL_VERSION_ID,
      docType: "icf",
    });

    expect(result.generatedDocId).toBe("gd-1");
    expect(mockGeneratedDoc.create).toHaveBeenCalledTimes(1);
  });

  it("rejects when source is not a protocol document", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion(TENANT_A, "icf"));

    await expect(
      generationService.startGeneration(TENANT_A, {
        protocolVersionId: PROTOCOL_VERSION_ID,
        docType: "csr",
      }),
    ).rejects.toThrow(/Source must be a protocol/);
  });

  it("rejects when source belongs to another tenant", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion(TENANT_B));

    await expect(
      generationService.startGeneration(TENANT_A, {
        protocolVersionId: PROTOCOL_VERSION_ID,
        docType: "icf",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("uses custom template when templateId matches docType and tenant", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion());
    mockTemplate.findUnique.mockResolvedValueOnce({
      id: "tmpl-1",
      tenantId: TENANT_A,
      docType: "icf",
      sections: [{ title: "Custom", standardSection: "purpose", order: 1 }],
    });
    mockGeneratedDoc.create.mockResolvedValueOnce({ id: "gd-1" });

    const result = await generationService.startGeneration(TENANT_A, {
      protocolVersionId: PROTOCOL_VERSION_ID,
      docType: "icf",
      templateId: "tmpl-1",
    });

    expect(result.generatedDocId).toBe("gd-1");
  });

  it("rejects when template belongs to another tenant", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion());
    mockTemplate.findUnique.mockResolvedValueOnce({
      id: "tmpl-1",
      tenantId: TENANT_B,
      docType: "icf",
      sections: [],
    });

    await expect(
      generationService.startGeneration(TENANT_A, {
        protocolVersionId: PROTOCOL_VERSION_ID,
        docType: "icf",
        templateId: "tmpl-1",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects when template docType doesn't match request", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion());
    mockTemplate.findUnique.mockResolvedValueOnce({
      id: "tmpl-1",
      tenantId: TENANT_A,
      docType: "csr",
      sections: [],
    });

    await expect(
      generationService.startGeneration(TENANT_A, {
        protocolVersionId: PROTOCOL_VERSION_ID,
        docType: "icf",
        templateId: "tmpl-1",
      }),
    ).rejects.toThrow(/Template type mismatch/);
  });
});

describe("generationService.getGeneratedDoc", () => {
  function makeDoc(tenantId = TENANT_A) {
    return {
      id: "gd-1",
      docType: "icf",
      status: "completed",
      createdAt: new Date(),
      sections: [
        { id: "s1", title: "Purpose", standardSection: "purpose", order: 1, content: "abc", status: "completed", qaFindings: [] },
      ],
      protocolVersion: {
        versionNumber: 1,
        versionLabel: "v1",
        document: {
          title: "Protocol",
          study: { tenantId, title: "Study X" },
        },
      },
    };
  }

  it("returns doc when tenant matches", async () => {
    mockGeneratedDoc.findUnique.mockResolvedValueOnce(makeDoc());

    const result = await generationService.getGeneratedDoc(TENANT_A, "gd-1");
    expect(result.id).toBe("gd-1");
    expect(result.sections).toHaveLength(1);
  });

  it("rejects cross-tenant access", async () => {
    mockGeneratedDoc.findUnique.mockResolvedValueOnce(makeDoc(TENANT_B));

    await expect(
      generationService.getGeneratedDoc(TENANT_A, "gd-1"),
    ).rejects.toThrow(DomainError);
  });
});

describe("generationService.updateSectionContent", () => {
  function makeSection(tenantId = TENANT_A) {
    return {
      id: "s1",
      generatedDoc: {
        protocolVersion: {
          document: { study: { tenantId } },
        },
      },
    };
  }

  it("updates content for section in same tenant", async () => {
    mockGeneratedDocSection.findUnique.mockResolvedValueOnce(makeSection());
    mockGeneratedDocSection.update.mockResolvedValueOnce({});

    const result = await generationService.updateSectionContent(TENANT_A, "s1", "new content");
    expect(result).toEqual({ success: true });
  });

  it("rejects update for cross-tenant section", async () => {
    mockGeneratedDocSection.findUnique.mockResolvedValueOnce(makeSection(TENANT_B));

    await expect(
      generationService.updateSectionContent(TENANT_A, "s1", "hack"),
    ).rejects.toThrow(DomainError);
    expect(mockGeneratedDocSection.update).not.toHaveBeenCalled();
  });
});

describe("generationService.listGeneratedDocs", () => {
  it("returns docs with completion stats for valid protocol version", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion());
    mockGeneratedDoc.findMany.mockResolvedValueOnce([
      {
        id: "gd-1",
        docType: "icf",
        status: "completed",
        createdAt: new Date(),
        sections: [
          { id: "s1", status: "completed" },
          { id: "s2", status: "completed" },
          { id: "s3", status: "pending" },
        ],
      },
    ]);

    const result = await generationService.listGeneratedDocs(TENANT_A, PROTOCOL_VERSION_ID);

    expect(result[0].totalSections).toBe(3);
    expect(result[0].completedSections).toBe(2);
  });

  it("rejects when protocol version belongs to another tenant", async () => {
    mockVersion.findUnique.mockResolvedValueOnce(makeProtocolVersion(TENANT_B));

    await expect(
      generationService.listGeneratedDocs(TENANT_A, PROTOCOL_VERSION_ID),
    ).rejects.toThrow(DomainError);
  });
});
