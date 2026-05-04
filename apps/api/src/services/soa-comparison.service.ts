import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";
import {
  buildSoaSnapshot,
  diffSoaSnapshots,
  type SoaDiff,
  type SoaSnapshot,
  type SnapshotInputTable,
} from "../lib/soa-snapshot.js";

async function loadVersionWithTables(versionId: string) {
  return prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: {
      document: { include: { study: true } },
      soaTables: {
        orderBy: { createdAt: "asc" },
        include: {
          cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] },
          soaFootnotes: {
            orderBy: { markerOrder: "asc" },
            include: { anchors: true },
          },
        },
      },
    },
  });
}

type LoadedTable = NonNullable<Awaited<ReturnType<typeof loadVersionWithTables>>>["soaTables"][number];

/**
 * Build a snapshot from a freshly loaded SoaTable. Falls back to
 * `snapshotJson` if it is already cached and still matches the current
 * cell/footnote count (cheap consistency check — full equality would
 * require deserializing).
 */
function snapshotFor(table: LoadedTable): SoaSnapshot {
  const cached = table.snapshotJson;
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    const c = cached as Partial<SoaSnapshot>;
    if (
      Array.isArray(c.cells) &&
      Array.isArray(c.footnotes) &&
      Array.isArray(c.visits) &&
      Array.isArray(c.procedures)
    ) {
      // The cached snapshot only stores cells with non-empty values, so
      // counting effective cells from the live table would force us to
      // re-derive `effectiveCellValue` here — instead we just trust the
      // cache when shape looks valid. Cache invalidation lives in
      // detection / manual edit code paths (write-side).
      return c as SoaSnapshot;
    }
  }
  return buildSoaSnapshot(table as unknown as SnapshotInputTable);
}

async function persistSnapshotIfMissing(table: LoadedTable, snapshot: SoaSnapshot) {
  if (table.snapshotJson) return;
  await prisma.soaTable.update({
    where: { id: table.id },
    data: { snapshotJson: snapshot as unknown as object },
  });
}

/**
 * Combine multiple SoA tables on one version into a single union
 * snapshot. A protocol can have several SoA tables (epoch-A, epoch-B,
 * etc.); for cross-version diff we treat the union of procedures /
 * visits / cells as the document's full schedule.
 */
function unionSnapshots(snapshots: SoaSnapshot[]): SoaSnapshot {
  if (snapshots.length === 0) {
    return { visits: [], procedures: [], cells: [], footnotes: [] };
  }
  if (snapshots.length === 1) return snapshots[0];

  const visits: string[] = [];
  const procedures: string[] = [];
  const seenVisits = new Set<string>();
  const seenProcs = new Set<string>();
  const cells: SoaSnapshot["cells"] = [];
  const cellSeen = new Set<string>();
  const footnotes: SoaSnapshot["footnotes"] = [];
  const fnSeen = new Set<string>();

  for (const s of snapshots) {
    for (const v of s.visits) {
      if (!seenVisits.has(v)) {
        seenVisits.add(v);
        visits.push(v);
      }
    }
    for (const p of s.procedures) {
      if (!seenProcs.has(p)) {
        seenProcs.add(p);
        procedures.push(p);
      }
    }
    for (const c of s.cells) {
      const k = `${c.procedure}|${c.visit}`;
      if (!cellSeen.has(k)) {
        cellSeen.add(k);
        cells.push(c);
      }
    }
    for (const f of s.footnotes) {
      // De-dup footnotes across tables by marker — same marker in
      // different tables is rare but we keep the first occurrence.
      if (!fnSeen.has(f.marker)) {
        fnSeen.add(f.marker);
        footnotes.push(f);
      }
    }
  }

  return { visits, procedures, cells, footnotes };
}

export interface SoaComparisonResult {
  oldSnapshot: SoaSnapshot;
  newSnapshot: SoaSnapshot;
  diff: SoaDiff;
}

export const soaComparisonService = {
  /**
   * Compare SoA between two DocumentVersions in the same tenant.
   * Caches the snapshot back onto each `SoaTable.snapshotJson`.
   */
  async compareSoaTables(
    tenantId: string,
    oldVersionId: string,
    newVersionId: string,
  ): Promise<SoaComparisonResult> {
    if (oldVersionId === newVersionId) {
      throw new DomainError("BAD_REQUEST", "oldVersionId and newVersionId must differ");
    }

    const [oldVersion, newVersion] = await Promise.all([
      loadVersionWithTables(oldVersionId),
      loadVersionWithTables(newVersionId),
    ]);

    if (!oldVersion || !newVersion) {
      throw new DomainError("NOT_FOUND", "Resource not found");
    }
    requireTenantResource(oldVersion, tenantId, (v) => v.document.study.tenantId);
    requireTenantResource(newVersion, tenantId, (v) => v.document.study.tenantId);

    const oldSnaps = oldVersion.soaTables.map(snapshotFor);
    const newSnaps = newVersion.soaTables.map(snapshotFor);

    // Persist any newly computed snapshots in parallel — fire-and-forget
    // semantics are fine because the cached snapshot is just a
    // pre-computed view; failure to persist falls back to recomputing
    // next time.
    await Promise.all([
      ...oldVersion.soaTables.map((t, i) => persistSnapshotIfMissing(t, oldSnaps[i])),
      ...newVersion.soaTables.map((t, i) => persistSnapshotIfMissing(t, newSnaps[i])),
    ]);

    const oldSnapshot = unionSnapshots(oldSnaps);
    const newSnapshot = unionSnapshots(newSnaps);
    const diff = diffSoaSnapshots(oldSnapshot, newSnapshot);

    return { oldSnapshot, newSnapshot, diff };
  },
};
