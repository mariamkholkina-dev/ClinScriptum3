import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: { findUnique: vi.fn(), update: vi.fn() },
    contentBlock: { deleteMany: vi.fn(), createMany: vi.fn() },
    section: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@clinscriptum/doc-parser", () => ({
  parseDocx: vi.fn(),
}));

vi.mock("../../api-shared/storage.js", () => ({
  createStorageProvider: vi.fn(),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { prisma } from "@clinscriptum/db";
import { parseDocx } from "@clinscriptum/doc-parser";
import { createStorageProvider } from "../../api-shared/storage.js";
import { handleParseDocument } from "../parse-document.js";

// --- Factory helpers ---

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver-1",
    fileUrl: "uploads/test.docx",
    status: "uploading",
    document: {
      id: "doc-1",
      study: { id: "study-1", tenantId: "tenant-1" },
    },
    ...overrides,
  };
}

function makeParsedResult(overrides: Record<string, unknown> = {}) {
  return {
    sections: [
      {
        title: "Introduction",
        level: 1,
        sourceAnchor: {},
        contentBlocks: [
          {
            type: "paragraph",
            content: "Some text",
            rawHtml: "<p>Some text</p>",
            sourceAnchor: {},
          },
        ],
        children: [],
      },
    ],
    metadata: {
      totalSections: 1,
      totalTables: 0,
      totalFootnotes: 0,
    },
    ...overrides,
  };
}

function makeStorageProvider() {
  return {
    upload: vi.fn(),
    download: vi.fn().mockResolvedValue(Buffer.from("fake-docx")),
    delete: vi.fn(),
    getUrl: vi.fn(),
  };
}

// --- Tests ---

describe("handleParseDocument", () => {
  const mockFindUnique = prisma.documentVersion.findUnique as ReturnType<typeof vi.fn>;
  const mockUpdate = prisma.documentVersion.update as ReturnType<typeof vi.fn>;
  const mockDeleteSections = prisma.section.deleteMany as ReturnType<typeof vi.fn>;
  const mockDeleteBlocks = prisma.contentBlock.deleteMany as ReturnType<typeof vi.fn>;
  const mockSectionFindMany = prisma.section.findMany as ReturnType<typeof vi.fn>;
  const mockSectionUpdateMany = prisma.section.updateMany as ReturnType<typeof vi.fn>;
  const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;
  const mockParseDocx = parseDocx as ReturnType<typeof vi.fn>;
  const mockCreateStorage = createStorageProvider as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults for Sprint 7e flag-restoration code path:
    // если тест явно не задаёт previous false-headings — список пуст (no-op).
    mockSectionFindMany.mockResolvedValue([]);
    mockSectionUpdateMany.mockResolvedValue({ count: 0 });

    // Default: $transaction calls the callback with a tx proxy that mirrors prisma
    mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<void>) => {
      const txProxy = {
        section: { create: prisma.section.create as ReturnType<typeof vi.fn> },
        contentBlock: { createMany: prisma.contentBlock.createMany as ReturnType<typeof vi.fn> },
      };
      (txProxy.section.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sec-1" });
      (txProxy.contentBlock.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      return cb(txProxy as unknown as typeof prisma);
    });
  });

  it("successfully parses document and returns metadata", async () => {
    const version = makeVersion();
    const parsed = makeParsedResult();
    const storage = makeStorageProvider();

    mockFindUnique.mockResolvedValue(version);
    mockUpdate.mockResolvedValue(version);
    mockDeleteBlocks.mockResolvedValue({ count: 0 });
    mockDeleteSections.mockResolvedValue({ count: 0 });
    mockCreateStorage.mockReturnValue(storage);
    mockParseDocx.mockResolvedValue(parsed);

    const result = await handleParseDocument({ versionId: "ver-1" });

    expect(result).toEqual({ success: true, metadata: parsed.metadata });
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: "ver-1" },
      include: { document: { include: { study: true } } },
    });
    expect(storage.download).toHaveBeenCalledWith("uploads/test.docx");
    expect(mockParseDocx).toHaveBeenCalledWith(Buffer.from("fake-docx"));
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("throws error when version is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(handleParseDocument({ versionId: "missing-id" })).rejects.toThrow(
      "DocumentVersion missing-id not found",
    );

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sets status to 'error' and re-throws when parsing fails", async () => {
    const version = makeVersion();
    const storage = makeStorageProvider();
    const parseError = new Error("Corrupted DOCX");

    mockFindUnique.mockResolvedValue(version);
    mockUpdate.mockResolvedValue(version);
    mockCreateStorage.mockReturnValue(storage);
    mockParseDocx.mockRejectedValue(parseError);

    await expect(handleParseDocument({ versionId: "ver-1" })).rejects.toThrow("Corrupted DOCX");

    // The last update call should set status to "error"
    const errorUpdateCall = mockUpdate.mock.calls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "error",
    );
    expect(errorUpdateCall).toBeDefined();
    expect(errorUpdateCall![0]).toEqual({
      where: { id: "ver-1" },
      data: { status: "error" },
    });
  });

  it("Sprint 7e: restores isFalseHeading flag after reprocess (match by title+level)", async () => {
    const version = makeVersion();
    const parsed = makeParsedResult({
      sections: [
        { title: "Состав", level: 4, sourceAnchor: {}, contentBlocks: [], children: [] },
        { title: "Описание", level: 4, sourceAnchor: {}, contentBlocks: [], children: [] },
        { title: "Активная секция", level: 2, sourceAnchor: {}, contentBlocks: [], children: [] },
      ],
    });
    const storage = makeStorageProvider();

    mockFindUnique.mockResolvedValue(version);
    mockUpdate.mockResolvedValue(version);
    mockDeleteBlocks.mockResolvedValue({ count: 0 });
    mockDeleteSections.mockResolvedValue({ count: 0 });
    mockCreateStorage.mockReturnValue(storage);
    mockParseDocx.mockResolvedValue(parsed);

    // 1) Перед deleteMany: 2 секции были помечены экспертом как false_heading
    mockSectionFindMany
      .mockResolvedValueOnce([
        { title: "Состав", level: 4 },
        { title: "Описание", level: 4 },
      ])
      // 2) После saveSections: возвращаем новые Section'ы с разными id
      .mockResolvedValueOnce([
        { id: "new-1", title: "Состав", level: 4 },
        { id: "new-2", title: "Описание", level: 4 },
        { id: "new-3", title: "Активная секция", level: 2 },
      ]);

    await handleParseDocument({ versionId: "ver-1" });

    // updateMany должен быть вызван с двумя id (Состав, Описание), но не с id "new-3"
    expect(mockSectionUpdateMany).toHaveBeenCalledTimes(1);
    const updateCall = mockSectionUpdateMany.mock.calls[0][0];
    expect(updateCall.where.id.in).toEqual(expect.arrayContaining(["new-1", "new-2"]));
    expect(updateCall.where.id.in).not.toContain("new-3");
    expect(updateCall.data).toEqual({ isFalseHeading: true });
  });

  it("Sprint 7e: skips updateMany when no previous false-headings", async () => {
    const version = makeVersion();
    const parsed = makeParsedResult();
    const storage = makeStorageProvider();

    mockFindUnique.mockResolvedValue(version);
    mockUpdate.mockResolvedValue(version);
    mockDeleteBlocks.mockResolvedValue({ count: 0 });
    mockDeleteSections.mockResolvedValue({ count: 0 });
    mockCreateStorage.mockReturnValue(storage);
    mockParseDocx.mockResolvedValue(parsed);
    // findMany вернёт пустой список — флагов не было
    mockSectionFindMany.mockResolvedValue([]);

    await handleParseDocument({ versionId: "ver-1" });

    expect(mockSectionUpdateMany).not.toHaveBeenCalled();
  });

  it("sets status to 'parsing' before processing starts", async () => {
    const version = makeVersion();
    const parsed = makeParsedResult();
    const storage = makeStorageProvider();

    mockFindUnique.mockResolvedValue(version);
    mockUpdate.mockResolvedValue(version);
    mockDeleteBlocks.mockResolvedValue({ count: 0 });
    mockDeleteSections.mockResolvedValue({ count: 0 });
    mockCreateStorage.mockReturnValue(storage);
    mockParseDocx.mockResolvedValue(parsed);

    await handleParseDocument({ versionId: "ver-1" });

    // The first update call must set status to "parsing"
    const firstUpdateCall = mockUpdate.mock.calls[0];
    expect(firstUpdateCall[0]).toEqual({
      where: { id: "ver-1" },
      data: { status: "parsing" },
    });

    // Ensure "parsing" status is set before download is attempted
    const parsingCallOrder = mockUpdate.mock.invocationCallOrder[0];
    const downloadCallOrder = storage.download.mock.invocationCallOrder[0];
    expect(parsingCallOrder).toBeLessThan(downloadCallOrder);
  });
});
