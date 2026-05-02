/**
 * Extract facts from a parsed table AST.
 *
 * Handles two common shapes:
 *   1. Two-column key/value tables ("Sponsor | Acme") — one row → one fact.
 *   2. Header-row tables ("Field | Value | …") — first column is the
 *      header pointer, second column carries the value.
 *
 * The 2D matrix shape (Schedule of Assessments) is not handled here —
 * SoA is parsed by `packages/shared/src/soa-detection-core.ts`.
 */

import type { ExtractedFact } from "./fact-extractor.js";
import { factKeyForHeader } from "./dictionaries/tableHeaderSynonyms.js";
import { canonicalize } from "./canonicalize.js";
import type { AggregatedFact } from "./canonicalize.js";
import { aggregateByCanonical } from "./canonicalize.js";

export interface TableAst {
  headers: string[];
  rows: string[][];
  footnotes?: string[];
}

const MAX_VALUE_LENGTH = 240;

function cleanCell(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_VALUE_LENGTH);
}

function isMeaninglessHeader(headers: string[]): boolean {
  if (headers.length === 0) return true;
  const blanks = headers.filter((h) => !h.trim()).length;
  return blanks >= headers.length;
}

/** Phase-specific keys belong to the phase_specific class. */
const PHASE_SPECIFIC = new Set([
  "primary_endpoint",
  "secondary_endpoint",
  "inclusion_criteria",
  "exclusion_criteria",
]);

function classifyFact(factKey: string): ExtractedFact["factClass"] {
  return PHASE_SPECIFIC.has(factKey) ? "phase_specific" : "general";
}

/**
 * Walk a table and emit raw facts. The caller is expected to feed the
 * result through `aggregateByCanonical`, exactly like regex output.
 */
export function extractRawFromTable(
  table: TableAst,
  sectionTitle?: string,
): ExtractedFact[] {
  const out: ExtractedFact[] = [];
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) return out;

  const useHeaderRow = !isMeaninglessHeader(table.headers ?? []);

  if (useHeaderRow && table.headers.length >= 2) {
    const headerFactKeys = table.headers.map((h) => factKeyForHeader(h));
    const allHeadersAreKeys = headerFactKeys.every((k) => k !== null);
    if (allHeadersAreKeys && table.rows.length > 0) {
      // Field-per-column layout: each row is one record, each column maps
      // to a different factKey. Skip — too speculative without context.
    }
  }

  // Two-column key/value layout: try both (col0=header, col1=value)
  // and (col1=header, col0=value) per row, in case the table is flipped.
  for (const row of table.rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const left = cleanCell(row[0] ?? "");
    const right = cleanCell(row[1] ?? "");
    if (!left || !right) continue;

    const fkLeft = factKeyForHeader(left);
    const fkRight = factKeyForHeader(right);
    let factKey: string | null = null;
    let value: string | null = null;
    if (fkLeft && !fkRight) {
      factKey = fkLeft;
      value = right;
    } else if (fkRight && !fkLeft) {
      factKey = fkRight;
      value = left;
    } else if (fkLeft && fkRight) {
      factKey = fkLeft;
      value = right;
    }

    if (!factKey || !value) continue;

    out.push({
      factKey,
      value,
      factClass: classifyFact(factKey),
      source: {
        sectionTitle,
        textSnippet: `${left} | ${value}`.slice(0, 240),
        method: "regex",
      },
    });
  }

  // Header-row layout: first column header maps to factKey, value cells
  // sit in subsequent columns of the same row.
  if (useHeaderRow && table.headers.length >= 2) {
    const headerKey = factKeyForHeader(table.headers[0]);
    if (headerKey) {
      for (const row of table.rows) {
        const value = cleanCell(row?.[1] ?? "");
        if (!value) continue;
        out.push({
          factKey: headerKey,
          value,
          factClass: classifyFact(headerKey),
          source: {
            sectionTitle,
            textSnippet: `${table.headers[0]} | ${value}`.slice(0, 240),
            method: "regex",
          },
        });
      }
    }
  }

  return out;
}

/** Convenience: aggregate raw output through `canonicalize` voting. */
export function extractFromTable(
  table: TableAst,
  sectionTitle?: string,
): AggregatedFact[] {
  return aggregateByCanonical(extractRawFromTable(table, sectionTitle));
}

/** Public re-export so consumers can canonicalise table-derived values. */
export { canonicalize };
