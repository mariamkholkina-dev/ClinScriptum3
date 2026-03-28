import type { ParsedTable, SourceAnchor } from "./types.js";

const SOA_INDICATORS = [
  /schedule\s+of\s+assessments/i,
  /schedule\s+of\s+activities/i,
  /schedule\s+of\s+procedures/i,
  /\bSOA\b/,
];

export function isSOATable(surroundingText: string, headers: string[]): boolean {
  const combined = surroundingText + " " + headers.join(" ");
  return SOA_INDICATORS.some((re) => re.test(combined));
}

export function parseHtmlTable(
  tableHtml: string,
  paragraphIndex: number
): ParsedTable {
  const headerPattern = /<th[^>]*>(.*?)<\/th>/gi;
  const rowPattern = /<tr[^>]*>(.*?)<\/tr>/gis;
  const cellPattern = /<td[^>]*>(.*?)<\/td>/gi;

  const headers: string[] = [];
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headerPattern.exec(tableHtml)) !== null) {
    headers.push(stripHtml(hMatch[1]));
  }

  const rows: string[][] = [];
  let rMatch: RegExpExecArray | null;
  while ((rMatch = rowPattern.exec(tableHtml)) !== null) {
    const rowHtml = rMatch[1];
    const cells: string[] = [];
    let cMatch: RegExpExecArray | null;
    while ((cMatch = cellPattern.exec(rowHtml)) !== null) {
      cells.push(stripHtml(cMatch[1]));
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (headers.length === 0 && rows.length > 0) {
    headers.push(...rows.shift()!);
  }

  const footnotes = extractTableFootnotes(tableHtml);

  const sourceAnchor: SourceAnchor = {
    paragraphIndex,
    textSnippet: headers.slice(0, 3).join(" | "),
  };

  return { headers, rows, sourceAnchor, footnotes };
}

function extractTableFootnotes(html: string): string[] {
  const footnotes: string[] = [];
  const fnPattern = /(?:\*|†|‡|§|¶|\d+)\s*[:.]\s*([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = fnPattern.exec(html)) !== null) {
    footnotes.push(match[1].trim());
  }
  return footnotes;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
