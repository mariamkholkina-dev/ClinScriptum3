import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";

type AnchorTarget =
  | { type: "cell"; cellId: string }
  | { type: "row"; rowIndex: number }
  | { type: "col"; colIndex: number };

const TENANT_PATH = {
  soaTable: {
    include: {
      docVersion: { include: { document: { include: { study: true } } } },
    },
  },
} as const;

async function loadFootnoteWithTenant(footnoteId: string) {
  return prisma.soaFootnote.findUnique({
    where: { id: footnoteId },
    include: TENANT_PATH,
  });
}

async function loadAnchorWithTenant(anchorId: string) {
  return prisma.soaFootnoteAnchor.findUnique({
    where: { id: anchorId },
    include: TENANT_PATH,
  });
}

async function loadTableWithTenant(soaTableId: string) {
  return prisma.soaTable.findUnique({
    where: { id: soaTableId },
    include: { docVersion: { include: { document: { include: { study: true } } } } },
  });
}

async function loadCellWithTenant(cellId: string) {
  return prisma.soaCell.findUnique({
    where: { id: cellId },
    include: TENANT_PATH,
  });
}

async function nextMarkerOrder(soaTableId: string): Promise<number> {
  const last = await prisma.soaFootnote.findFirst({
    where: { soaTableId },
    orderBy: { markerOrder: "desc" },
    select: { markerOrder: true },
  });
  return last ? last.markerOrder + 1 : 0;
}

export const soaFootnoteService = {
  async listForTable(tenantId: string, soaTableId: string) {
    const table = await loadTableWithTenant(soaTableId);
    requireTenantResource(table, tenantId, (t) => t.docVersion.document.study.tenantId);

    return prisma.soaFootnote.findMany({
      where: { soaTableId },
      orderBy: { markerOrder: "asc" },
      include: { anchors: true },
    });
  },

  async create(
    tenantId: string,
    soaTableId: string,
    marker: string,
    text: string,
  ) {
    const table = await loadTableWithTenant(soaTableId);
    requireTenantResource(table, tenantId, (t) => t.docVersion.document.study.tenantId);

    const trimmed = marker.trim();
    if (!trimmed) {
      throw new DomainError("BAD_REQUEST", "Marker must not be empty");
    }

    const existing = await prisma.soaFootnote.findUnique({
      where: { soaTableId_marker: { soaTableId, marker: trimmed } },
    });
    if (existing) {
      throw new DomainError("CONFLICT", `Footnote with marker '${trimmed}' already exists`);
    }

    const order = await nextMarkerOrder(soaTableId);
    const created = await prisma.soaFootnote.create({
      data: {
        soaTableId,
        marker: trimmed,
        markerOrder: order,
        text,
        source: "manual",
      },
    });

    return created;
  },

  async update(
    tenantId: string,
    footnoteId: string,
    patch: { marker?: string; text?: string },
  ) {
    const footnote = await loadFootnoteWithTenant(footnoteId);
    requireTenantResource(
      footnote,
      tenantId,
      (f) => f.soaTable.docVersion.document.study.tenantId,
    );

    const data: { marker?: string; text?: string } = {};
    if (patch.marker !== undefined) {
      const trimmed = patch.marker.trim();
      if (!trimmed) throw new DomainError("BAD_REQUEST", "Marker must not be empty");
      if (trimmed !== footnote.marker) {
        const conflict = await prisma.soaFootnote.findUnique({
          where: {
            soaTableId_marker: { soaTableId: footnote.soaTableId, marker: trimmed },
          },
        });
        if (conflict) {
          throw new DomainError("CONFLICT", `Footnote with marker '${trimmed}' already exists`);
        }
        data.marker = trimmed;
      }
    }
    if (patch.text !== undefined) data.text = patch.text;

    if (Object.keys(data).length === 0) return footnote;

    const updated = await prisma.soaFootnote.update({
      where: { id: footnoteId },
      data,
    });
    return updated;
  },

  async delete(tenantId: string, footnoteId: string) {
    const footnote = await loadFootnoteWithTenant(footnoteId);
    requireTenantResource(
      footnote,
      tenantId,
      (f) => f.soaTable.docVersion.document.study.tenantId,
    );

    // Anchors cascade with the footnote via the FK in schema.prisma.
    await prisma.soaFootnote.delete({ where: { id: footnoteId } });
    return { ok: true as const };
  },

  async linkAnchor(tenantId: string, footnoteId: string, target: AnchorTarget) {
    const footnote = await loadFootnoteWithTenant(footnoteId);
    requireTenantResource(
      footnote,
      tenantId,
      (f) => f.soaTable.docVersion.document.study.tenantId,
    );

    if (target.type === "cell") {
      const cell = await loadCellWithTenant(target.cellId);
      requireTenantResource(
        cell,
        tenantId,
        (c) => c.soaTable.docVersion.document.study.tenantId,
      );
      if (cell.soaTableId !== footnote.soaTableId) {
        throw new DomainError(
          "BAD_REQUEST",
          "Cell does not belong to the same SoA table as the footnote",
        );
      }
    }

    const anchor = await prisma.soaFootnoteAnchor.create({
      data: {
        footnoteId,
        soaTableId: footnote.soaTableId,
        targetType: target.type,
        cellId: target.type === "cell" ? target.cellId : null,
        rowIndex: target.type === "row" ? target.rowIndex : null,
        colIndex: target.type === "col" ? target.colIndex : null,
        confidence: 1.0,
        source: "manual",
      },
    });
    return anchor;
  },

  async unlinkAnchor(tenantId: string, anchorId: string) {
    const anchor = await loadAnchorWithTenant(anchorId);
    requireTenantResource(
      anchor,
      tenantId,
      (a) => a.soaTable.docVersion.document.study.tenantId,
    );

    await prisma.soaFootnoteAnchor.delete({ where: { id: anchorId } });
    return { ok: true as const };
  },
};
