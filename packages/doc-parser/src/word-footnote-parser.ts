/**
 * Parser for `word/footnotes.xml` — Word's native footnote-storage file.
 *
 * Word stores footnote bodies separately from the main document. Inside
 * a paragraph or table cell, a footnote ref is `<w:footnoteReference w:id="N">`;
 * the body text lives in `word/footnotes.xml` under `<w:footnote w:id="N">`.
 *
 * Mammoth converts these refs into `<sup>` tags only when the body is
 * short enough — for longer bodies it loses them entirely. Sprint 6
 * commit 5 closes that gap by reading the XML directly and merging the
 * recovered footnote bodies into the SoA detection pipeline.
 *
 * Two reserved IDs are skipped:
 *   - `id="-1"` — separator (the horizontal rule above footnotes)
 *   - `id="0"`  — continuation separator (when footnotes spill across pages)
 * `<w:footnote w:type="separator">` and `w:type="continuationSeparator"`
 * are also skipped regardless of id, defensively.
 */

import { XMLParser } from "fast-xml-parser";

interface XmlNode {
  [key: string]: unknown;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Recursively gather all `<w:t>` text from a node subtree, joining with
 * spaces. fast-xml-parser flattens `<w:t>` to either a string (single
 * occurrence) or an array (multiple). After `removeNSPrefix`, `<w:t>`
 * appears as the key `t`.
 */
function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) return node.map(collectText).filter(Boolean).join(" ");
  if (typeof node !== "object") return "";

  const obj = node as XmlNode;
  const parts: string[] = [];

  // Direct <w:t> children — preserve insertion order via collectText recursion.
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_")) continue;
    if (key === "#text") {
      parts.push(String(obj[key] ?? ""));
      continue;
    }
    parts.push(collectText(obj[key]));
  }

  return parts.filter(Boolean).join(" ");
}

/**
 * Parse `word/footnotes.xml` and return a map `{ id → plain-text body }`.
 * Returns an empty map on parse error or when the file is malformed —
 * never throws.
 */
export function extractWordFootnotes(xmlText: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!xmlText || xmlText.trim().length === 0) return out;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    preserveOrder: false,
    allowBooleanAttributes: true,
    removeNSPrefix: true,
  });

  let parsed: XmlNode;
  try {
    parsed = parser.parse(xmlText) as XmlNode;
  } catch {
    return out;
  }

  const footnotesRoot = (parsed.footnotes ?? parsed["w:footnotes"]) as XmlNode | undefined;
  if (!footnotesRoot) return out;

  const footnoteList = asArray(
    (footnotesRoot.footnote ?? footnotesRoot["w:footnote"]) as XmlNode | XmlNode[] | undefined,
  );

  for (const fn of footnoteList) {
    const id = String(fn["@_w:id"] ?? fn["@_id"] ?? "");
    if (!id) continue;
    if (id === "-1" || id === "0") continue;

    const type = String(fn["@_w:type"] ?? fn["@_type"] ?? "");
    if (type === "separator" || type === "continuationSeparator") continue;

    const text = collectText(fn).replace(/\s+/g, " ").trim();
    if (text) out.set(id, text);
  }

  return out;
}
