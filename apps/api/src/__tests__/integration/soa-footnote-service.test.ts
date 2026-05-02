import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { soaFootnoteService } from "../../services/soa-footnote.service.js";
import { processingService } from "../../services/processing.service.js";
import { DomainError } from "../../services/errors.js";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

interface TenantContext {
  tenantId: string;
  versionId: string;
  soaTableId: string;
  cellId: string;
}

async function setupTenantWithSoa(emailPrefix: string, orgName: string): Promise<TenantContext> {
  const user = await registerUser(
    `${emailPrefix}@example.com`,
    "password123",
    `${emailPrefix} Tester`,
    orgName,
  );
  const caller = createCaller(verifyAccessToken(user.accessToken));
  const study = await caller.study.create({ title: `${orgName} Study` });
  const doc = await caller.document.create({
    studyId: study.id,
    type: "protocol",
    title: `${orgName} Protocol`,
  });

  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      versionLabel: "v1.0",
      status: "ready",
      fileUrl: `test://${emailPrefix}.docx`,
    },
  });

  const soaTable = await prisma.soaTable.create({
    data: {
      docVersionId: version.id,
      title: "Test SoA",
      soaScore: 10.0,
      status: "detected",
      headerData: { visits: ["Visit 1", "Visit 2"] },
      rawMatrix: [["Procedure", "V1", "V2"]],
      footnotes: [],
    },
  });

  const cell = await prisma.soaCell.create({
    data: {
      soaTableId: soaTable.id,
      rowIndex: 0,
      colIndex: 0,
      procedureName: "Vital signs",
      visitName: "Visit 1",
      rawValue: "X",
      normalizedValue: "X",
      confidence: 1.0,
    },
  });

  const tenantId = (await prisma.tenant.findFirstOrThrow({
    where: { name: orgName },
  })).id;

  return {
    tenantId,
    versionId: version.id,
    soaTableId: soaTable.id,
    cellId: cell.id,
  };
}

describe("soaFootnoteService (integration)", () => {
  let ctxA: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    await cleanupTestData();
    ctxA = await setupTenantWithSoa("soa-fn-svc-a", "SoA FN A");
    ctxB = await setupTenantWithSoa("soa-fn-svc-b", "SoA FN B");
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Each test starts with a clean footnote slate for tenant A.
    await prisma.soaFootnote.deleteMany({ where: { soaTableId: ctxA.soaTableId } });
    await prisma.soaCell.update({
      where: { id: ctxA.cellId },
      data: { footnoteRefs: [] },
    });
  });

  describe("create + listForTable", () => {
    it("creates footnote and lists it back for the owning tenant", async () => {
      const fn = await soaFootnoteService.create(
        ctxA.tenantId,
        ctxA.soaTableId,
        "*",
        "Optional",
      );
      expect(fn.marker).toBe("*");
      expect(fn.markerOrder).toBe(0);
      expect(fn.source).toBe("manual");

      const list = await soaFootnoteService.listForTable(ctxA.tenantId, ctxA.soaTableId);
      expect(list).toHaveLength(1);
      expect(list[0].marker).toBe("*");
    });

    it("listForTable returns NOT_FOUND for a different tenant", async () => {
      await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "First");
      await expect(
        soaFootnoteService.listForTable(ctxB.tenantId, ctxA.soaTableId),
      ).rejects.toThrow(DomainError);
    });

    it("rejects duplicate marker on the same table", async () => {
      await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "First");
      await expect(
        soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "Other"),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("syncs legacy SoaTable.footnotes on create", async () => {
      await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "First");
      await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "*", "Second");
      const t = await prisma.soaTable.findUniqueOrThrow({ where: { id: ctxA.soaTableId } });
      expect(t.footnotes).toEqual(["First", "Second"]);
    });
  });

  describe("linkAnchor", () => {
    it("creates a cell anchor with resolved cellId and source=manual", async () => {
      const fn = await soaFootnoteService.create(
        ctxA.tenantId,
        ctxA.soaTableId,
        "1",
        "Note",
      );
      const anchor = await soaFootnoteService.linkAnchor(ctxA.tenantId, fn.id, {
        type: "cell",
        cellId: ctxA.cellId,
      });
      expect(anchor.targetType).toBe("cell");
      expect(anchor.cellId).toBe(ctxA.cellId);
      expect(anchor.source).toBe("manual");
    });

    it("creates row and col anchors with no cellId", async () => {
      const fn = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "*", "");
      const rowAnchor = await soaFootnoteService.linkAnchor(ctxA.tenantId, fn.id, {
        type: "row",
        rowIndex: 0,
      });
      expect(rowAnchor.targetType).toBe("row");
      expect(rowAnchor.rowIndex).toBe(0);
      expect(rowAnchor.cellId).toBeNull();

      const fn2 = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "†", "");
      const colAnchor = await soaFootnoteService.linkAnchor(ctxA.tenantId, fn2.id, {
        type: "col",
        colIndex: 1,
      });
      expect(colAnchor.targetType).toBe("col");
      expect(colAnchor.colIndex).toBe(1);
      expect(colAnchor.cellId).toBeNull();
    });

    it("rejects cellId from a different SoA table", async () => {
      const fn = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "");
      await expect(
        soaFootnoteService.linkAnchor(ctxA.tenantId, fn.id, {
          type: "cell",
          cellId: ctxB.cellId, // belongs to tenant B's table
        }),
      ).rejects.toThrow(DomainError);
    });

    it("rejects linkAnchor on a footnote owned by a different tenant", async () => {
      const fn = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "");
      await expect(
        soaFootnoteService.linkAnchor(ctxB.tenantId, fn.id, {
          type: "row",
          rowIndex: 0,
        }),
      ).rejects.toThrow(DomainError);
    });

    it("syncs legacy footnoteRefs on the cell when a cell anchor is linked", async () => {
      const fn1 = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "");
      const fn2 = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "2", "");
      await soaFootnoteService.linkAnchor(ctxA.tenantId, fn1.id, {
        type: "cell",
        cellId: ctxA.cellId,
      });
      await soaFootnoteService.linkAnchor(ctxA.tenantId, fn2.id, {
        type: "cell",
        cellId: ctxA.cellId,
      });
      const cell = await prisma.soaCell.findUniqueOrThrow({ where: { id: ctxA.cellId } });
      expect(cell.footnoteRefs).toEqual([0, 1]);
    });
  });

  describe("delete", () => {
    it("cascade-removes anchors when the footnote is deleted", async () => {
      const fn = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "");
      await soaFootnoteService.linkAnchor(ctxA.tenantId, fn.id, {
        type: "cell",
        cellId: ctxA.cellId,
      });
      await soaFootnoteService.delete(ctxA.tenantId, fn.id);

      const remaining = await prisma.soaFootnoteAnchor.count({ where: { footnoteId: fn.id } });
      expect(remaining).toBe(0);
      const cell = await prisma.soaCell.findUniqueOrThrow({ where: { id: ctxA.cellId } });
      expect(cell.footnoteRefs).toEqual([]);
    });
  });

  describe("legacy shim — processingService.updateSoaCellFootnoteRefs", () => {
    it("creates SoaFootnoteAnchor rows for each markerOrder reference", async () => {
      await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "First");
      await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "*", "Optional");

      await processingService.updateSoaCellFootnoteRefs(
        ctxA.tenantId,
        ctxA.cellId,
        [0, 1],
      );

      const anchors = await prisma.soaFootnoteAnchor.findMany({
        where: { cellId: ctxA.cellId, targetType: "cell" },
      });
      expect(anchors).toHaveLength(2);

      const cell = await prisma.soaCell.findUniqueOrThrow({ where: { id: ctxA.cellId } });
      expect(cell.footnoteRefs).toEqual([0, 1]);
    });

    it("removes existing cell anchors before applying new refs", async () => {
      const fn1 = await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "1", "");
      await soaFootnoteService.create(ctxA.tenantId, ctxA.soaTableId, "*", "");
      await soaFootnoteService.linkAnchor(ctxA.tenantId, fn1.id, {
        type: "cell",
        cellId: ctxA.cellId,
      });

      await processingService.updateSoaCellFootnoteRefs(ctxA.tenantId, ctxA.cellId, [1]);

      const anchors = await prisma.soaFootnoteAnchor.findMany({
        where: { cellId: ctxA.cellId, targetType: "cell" },
      });
      expect(anchors).toHaveLength(1);
      const cell = await prisma.soaCell.findUniqueOrThrow({ where: { id: ctxA.cellId } });
      expect(cell.footnoteRefs).toEqual([1]);
    });
  });

  describe("legacy shim — processingService.updateSoaTableFootnotes", () => {
    it("recreates SoaFootnote rows from the string array, source=manual", async () => {
      await processingService.updateSoaTableFootnotes(ctxA.tenantId, ctxA.soaTableId, [
        "First note",
        "Second note",
      ]);
      const fns = await prisma.soaFootnote.findMany({
        where: { soaTableId: ctxA.soaTableId },
        orderBy: { markerOrder: "asc" },
      });
      expect(fns.map((f) => f.marker)).toEqual(["1", "2"]);
      expect(fns.map((f) => f.text)).toEqual(["First note", "Second note"]);
      expect(fns.every((f) => f.source === "manual")).toBe(true);
    });
  });
});
