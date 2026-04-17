import { describe, it, expect } from "vitest";
import { parseHtmlTable, isSOATable } from "../table-parser.js";

describe("parseHtmlTable", () => {
  it("parses table with headers and rows", () => {
    const html = `
      <table>
        <tr><th>Visit</th><th>Day 1</th><th>Day 7</th></tr>
        <tr><td>Physical Exam</td><td>X</td><td>X</td></tr>
        <tr><td>Blood Draw</td><td>X</td><td></td></tr>
      </table>
    `;
    const result = parseHtmlTable(html, 0);
    expect(result.headers).toEqual(["Visit", "Day 1", "Day 7"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(["Physical Exam", "X", "X"]);
    expect(result.rows[1][0]).toBe("Blood Draw");
  });

  it("promotes first row to headers when no th elements exist", () => {
    const html = `
      <table>
        <tr><td>Header A</td><td>Header B</td></tr>
        <tr><td>Cell 1</td><td>Cell 2</td></tr>
      </table>
    `;
    const result = parseHtmlTable(html, 5);
    expect(result.headers).toEqual(["Header A", "Header B"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(["Cell 1", "Cell 2"]);
  });

  it("strips HTML tags from cell content", () => {
    const html = `
      <table>
        <tr><th><strong>Bold Header</strong></th></tr>
        <tr><td><em>Italic cell</em></td></tr>
      </table>
    `;
    const result = parseHtmlTable(html, 0);
    expect(result.headers[0]).toBe("Bold Header");
    expect(result.rows[0][0]).toBe("Italic cell");
  });

  it("creates sourceAnchor with paragraphIndex and header snippet", () => {
    const html = `
      <table>
        <tr><th>Col A</th><th>Col B</th><th>Col C</th><th>Col D</th></tr>
        <tr><td>1</td><td>2</td><td>3</td><td>4</td></tr>
      </table>
    `;
    const result = parseHtmlTable(html, 7);
    expect(result.sourceAnchor.paragraphIndex).toBe(7);
    expect(result.sourceAnchor.textSnippet).toContain("Col A");
  });

  it("handles empty table", () => {
    const html = "<table></table>";
    const result = parseHtmlTable(html, 0);
    expect(result.headers).toHaveLength(0);
    expect(result.rows).toHaveLength(0);
  });

  it("extracts table footnotes", () => {
    const html = `
      <table>
        <tr><th>Visit</th></tr>
        <tr><td>1. This is a footnote text explaining something important</td></tr>
      </table>
    `;
    const result = parseHtmlTable(html, 0);
    expect(result.footnotes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("isSOATable", () => {
  it("returns true for 'Schedule of Assessments' text", () => {
    expect(isSOATable("Table 1: Schedule of Assessments", [])).toBe(true);
  });

  it("returns true for 'Schedule of Activities' text", () => {
    expect(isSOATable("Schedule of Activities", [])).toBe(true);
  });

  it("returns true for 'Schedule of Procedures' text", () => {
    expect(isSOATable("Schedule of Procedures", [])).toBe(true);
  });

  it("returns true for 'SOA' in headers", () => {
    expect(isSOATable("", ["SOA", "Visit 1", "Visit 2"])).toBe(true);
  });

  it("returns false for unrelated text", () => {
    expect(isSOATable("Summary of Adverse Events", ["Event", "Count"])).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isSOATable("", [])).toBe(false);
  });
});
