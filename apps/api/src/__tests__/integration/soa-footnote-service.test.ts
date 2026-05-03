import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { soaFootnoteService } from "../../services/soa-footnote.service.js";
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
    // soa_footnote_anchors cascade with the parent footnote.
    await prisma.soaFootnote.deleteMany({ where: { soaTableId: ctxA.soaTableId } });
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

    it("creates one anchor per linked footnote on the same cell", async () => {
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
      const anchors = await prisma.soaFootnoteAnchor.findMany({
        where: { cellId: ctxA.cellId, targetType: "cell" },
        include: { footnote: true },
      });
      expect(anchors.map((a) => a.footnote.marker).sort()).toEqual(["1", "2"]);
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
      const cellAnchors = await prisma.soaFootnoteAnchor.count({
        where: { cellId: ctxA.cellId, targetType: "cell" },
      });
      expect(cellAnchors).toBe(0);
    });
  });
});
