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
  if (numMatch) {
    const dots = numMatch[1].split(".").length;
    const trimmed = text.trim();

    // Bold numbered → всегда heading.
    if (isBold) {
      return { text: trimmed, level: dots, method: "numbered", paragraphIndex };
    }

    // Sprint 4.1: numbered headings БЕЗ bold. Реальные документы клин.
    // исследований часто имеют numbered headings без жирного шрифта (стиль
    // Heading 1-9 не привязан к bold). Раньше такие секции пропускались
    // — документ становился "плоским" без иерархии.
    //
    // NUMBERED_SECTION_RE требует пробел после номера ("1 Title"), а не
    // точку ("1. Apple"), поэтому большинство list-items уже отфильтрованы
    // на уровне regex. Дополнительно проверяем:
    //   - не оканчивается на запятую/точку с запятой/двоеточие (это list item)
    //   - для dots < 2 — длина ≤ 80 chars (single-level одиночные пункты
    //     длинных списков отсекаются)
    const lastChar = trimmed.charAt(trimmed.length - 1);
    if (lastChar === "," || lastChar === ";" || lastChar === ":") return null;

    if (dots < 2 && trimmed.length > 80) return null;

    return { text: trimmed, level: dots, method: "numbered", paragraphIndex };
  }

  return null;
}
