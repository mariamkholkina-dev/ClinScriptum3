/**
 * Render a parsed table as a Markdown pipe table. LLMs handle the
 * "| h1 | h2 |" form noticeably better than the CSV-collapsed
 * "h1 | h2\nv1 | v2" string we previously fed them.
 */
export interface TableAstLike {
  headers: string[];
  rows: string[][];
  footnotes?: string[];
}

export function renderTableMarkdown(ast: TableAstLike): string {
  const headers = ast.headers.map((h) => h.trim() || " ");
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = ast.rows.map(
    (r) => `| ${r.map((c) => (c ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || " ").join(" | ")} |`,
  );
  const lines = [headerLine, separatorLine, ...rowLines];
  if (ast.footnotes && ast.footnotes.length > 0) {
    lines.push("");
    for (const fn of ast.footnotes) lines.push(`> ${fn}`);
  }
  return lines.join("\n");
}
