/**
 * Detects headings from OOXML elements using multiple strategies (URS-013):
 * - Word built-in heading styles (Heading 1, Heading 2, etc.)
 * - Outline level
 * - Visual formatting (bold + larger font size)
 * - Numbered section patterns (e.g., "1.", "1.1", "1.1.1")
 */

export interface DetectedHeading {
  text: string;
  level: number;
  method: "style" | "outline" | "visual" | "numbered";
  paragraphIndex: number;
}

const HEADING_STYLE_RE = /^heading\s*(\d+)$/i;
const NUMBERED_SECTION_RE = /^(\d+(?:\.\d+)*)\s+/;

export function detectHeading(
  text: string,
  paragraphIndex: number,
  style?: string,
  outlineLevel?: number,
  isBold?: boolean,
  fontSize?: number,
  baseFontSize?: number
): DetectedHeading | null {
  if (!text.trim()) return null;

  if (style) {
    const match = style.match(HEADING_STYLE_RE);
    if (match) {
      return {
        text: text.trim(),
        level: parseInt(match[1], 10),
        method: "style",
        paragraphIndex,
      };
    }
  }

  if (outlineLevel !== undefined && outlineLevel >= 0 && outlineLevel < 9) {
    return {
      text: text.trim(),
      level: outlineLevel + 1,
      method: "outline",
      paragraphIndex,
    };
  }

  if (isBold && fontSize && baseFontSize && fontSize > baseFontSize) {
    const sizeRatio = fontSize / baseFontSize;
    let level = 3;
    if (sizeRatio >= 1.6) level = 1;
    else if (sizeRatio >= 1.3) level = 2;
    return {
      text: text.trim(),
      level,
      method: "visual",
      paragraphIndex,
    };
  }

  const numMatch = text.match(NUMBERED_SECTION_RE);
  if (numMatch && isBold) {
    const dots = numMatch[1].split(".").length;
    return {
      text: text.trim(),
      level: dots,
      method: "numbered",
      paragraphIndex,
    };
  }

  return null;
}
