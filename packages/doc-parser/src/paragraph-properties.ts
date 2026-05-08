/**
 * Извлечение per-paragraph properties (font size, bold) из OOXML
 * `word/document.xml`.
 *
 * Mammoth по умолчанию НЕ передаёт font info в HTML output — `<w:sz>`
 * и `<w:b>` теряются (кроме случая когда применён explicit `Heading X` style).
 * Для документов которые «выглядят» как заголовки (жирно + крупно) но не
 * имеют heading-стиля парсер не находит структуру.
 *
 * Этот модуль читает raw OOXML и возвращает упорядоченный массив паров
 * `{text, fontSize, isBold}` по позиции paragraphIndex (= индекс
 * `<w:p>` в `<w:body>`). Heading-detector использует эти данные для visual
 * detection вместо хардкоженого `baseFontSize=12`.
 */

import { XMLParser } from "fast-xml-parser";

export interface ParagraphProperties {
  /** Индекс `<w:p>` в порядке их появления в `<w:body>`. 0-based. */
  paragraphIndex: number;
  /** Plain text без форматирования (concat всех `<w:t>` runs). */
  text: string;
  /** Pt-размер шрифта (24 halfpoints в OOXML → 12pt здесь). undefined если не задан. */
  fontSize?: number;
  /** True если paragraph содержит хотя бы один bold run (или весь bold). */
  isBold?: boolean;
}

// preserveOrder=true — даёт нам plain array of children в исходном document-order'е.
// Это критично для walking'а: paragraph'ы и tables перемешаны в `<w:body>`,
// и нам нужен правильный порядок для paragraphIndex (= позиция в документе).
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  parseTagValue: false,
  trimValues: false,
});

/* preserveOrder structure:
 *   parsed = [{ "w:document": [{ "w:body": [{ "w:p": [...] }, { "w:tbl": [...] }] }] }]
 *   each node is `{ <tagname>: <children-array>, ":@": <attrs> }`
 */
type PreservedNode = Record<string, unknown>;

/* ──────── helpers ──────── */

/**
 * preserveOrder='true' нодa выглядит так:
 *   { "w:p": [<children...>], ":@": { "@_attr": "val" } }
 * Возвращаем имя тега (первый ключ который не ":@") и его children.
 */
function tagOf(node: PreservedNode): string | null {
  for (const k of Object.keys(node)) {
    if (k !== ":@") return k;
  }
  return null;
}

function childrenOf(node: PreservedNode, tag: string): PreservedNode[] {
  const v = node[tag];
  if (Array.isArray(v)) return v as PreservedNode[];
  return [];
}

function attrsOf(node: PreservedNode): Record<string, unknown> {
  return (node[":@"] as Record<string, unknown> | undefined) ?? {};
}

/** Проверка булева flag вида `<w:b/>` или `<w:b w:val="0"/>`. */
function readBoolFlag(attrs: Record<string, unknown>): boolean {
  const val = attrs["@_w:val"];
  if (val === undefined) return true;
  const s = String(val).toLowerCase();
  if (s === "0" || s === "false" || s === "off") return false;
  return true;
}

/** Read sz: `<w:sz w:val="24"/>` halfpoints → 12pt. */
function readSize(attrs: Record<string, unknown>): number | undefined {
  const val = attrs["@_w:val"];
  if (val === undefined) return undefined;
  const halfPoints = Number(val);
  if (!Number.isFinite(halfPoints) || halfPoints <= 0) return undefined;
  return halfPoints / 2;
}

/* ──────── extraction ──────── */

/**
 * Достаёт ParagraphProperties для каждого `<w:p>` в `<w:body>`. Включая
 * paragraph'ы внутри таблиц (`<w:tbl>` → `<w:tr>` → `<w:tc>` → `<w:p>`).
 *
 * Порядок paragraphIndex'ей соответствует document-order'у (preserveOrder
 * нужен именно для этого — иначе fast-xml-parser группирует по типу).
 *
 * Note: paragraphIndex может расходиться с mammoth-output index'ом,
 * потому что mammoth merge'ит/skip'ает некоторые paragraph'ы. Поэтому
 * матчинг в `parser.ts` идёт по тексту fingerprint'у, а не по индексу.
 */
export function extractParagraphProperties(documentXml: string): ParagraphProperties[] {
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(documentXml);
  } catch {
    return [];
  }

  const result: ParagraphProperties[] = [];
  const root = parsed as PreservedNode[];
  if (!Array.isArray(root)) return [];

  for (const node of root) {
    walk(node, result);
  }

  // Re-index sequentially — paragraphIndex = position in document order.
  result.forEach((p, i) => (p.paragraphIndex = i));

  return result;
}

/**
 * Recursive walk. Когда встречаем `<w:p>` — извлекаем его properties.
 * Для всех остальных элементов (`<w:document>`, `<w:body>`, `<w:tbl>`,
 * `<w:tr>`, `<w:tc>` и любые потомки) — рекурсивно обходим children.
 */
function walk(node: PreservedNode, out: ParagraphProperties[]) {
  const tag = tagOf(node);
  if (!tag) return;

  if (tag === "w:p") {
    const props = parseParagraph(node);
    if (props !== null) out.push(props);
    return; // не идём внутрь параграфа дальше — runs внутри не интересны
  }

  // Любой контейнерный элемент — рекурсивно по children
  const children = childrenOf(node, tag);
  for (const child of children) {
    walk(child, out);
  }
}

function parseParagraph(p: PreservedNode): ParagraphProperties | null {
  const children = childrenOf(p, "w:p");
  let text = "";
  let maxSize: number | undefined;
  let totalChars = 0;
  let boldChars = 0;

  for (const child of children) {
    const tag = tagOf(child);
    if (tag !== "w:r") continue;

    const runChildren = childrenOf(child, "w:r");
    let runText = "";
    let runIsBold: boolean | undefined;
    let runSize: number | undefined;

    for (const rc of runChildren) {
      const rcTag = tagOf(rc);
      if (rcTag === "w:t") {
        // text — может быть в `#text` или в children как string-node
        const tChildren = childrenOf(rc, "w:t");
        for (const tc of tChildren) {
          const v = (tc as PreservedNode)["#text"];
          if (typeof v === "string") runText += v;
        }
      } else if (rcTag === "w:rPr") {
        const rpChildren = childrenOf(rc, "w:rPr");
        for (const propChild of rpChildren) {
          const propTag = tagOf(propChild);
          if (propTag === "w:b") {
            runIsBold = readBoolFlag(attrsOf(propChild));
          } else if (propTag === "w:sz") {
            runSize = readSize(attrsOf(propChild));
          }
        }
      }
    }

    text += runText;
    const charCount = runText.length;
    totalChars += charCount;
    if (runIsBold === true) boldChars += charCount;
    if (runSize !== undefined && (maxSize === undefined || runSize > maxSize)) {
      maxSize = runSize;
    }
  }

  if (text.trim() === "") return null;

  // isBold = TRUE если ≥80% символов параграфа жирные.
  const isBold = totalChars > 0 && boldChars / totalChars >= 0.8;

  return {
    paragraphIndex: 0, // переопределяется в extractParagraphProperties
    text: text.trim(),
    fontSize: maxSize,
    isBold,
  };
}

/* ──────── statistics ──────── */

/**
 * Медиана font size по всем параграфам с непустым текстом и заданным fontSize.
 * Используется как dynamic baseFontSize вместо хардкоженого 12 — для DOCX где
 * базовый шрифт документа отличается (например 11pt для Calibri-based).
 *
 * Если данных мало (<5 paragraphs с fontSize) — возвращает 12 (default).
 */
export function computeBaseFontSize(props: ParagraphProperties[]): number {
  const sizes = props.map((p) => p.fontSize).filter((s): s is number => s !== undefined);
  if (sizes.length < 5) return 12;
  sizes.sort((a, b) => a - b);
  const mid = Math.floor(sizes.length / 2);
  return sizes.length % 2 === 0 ? (sizes[mid - 1] + sizes[mid]) / 2 : sizes[mid];
}

/**
 * Текстовый fingerprint для матчинга OOXML paragraph ↔ mammoth HTML element.
 * Trim + lowercase + collapse whitespace + первые 80 chars (длинных параграфов
 * хватает) — снимает мелкие расхождения между OOXML run-text и mammoth output.
 */
export function fingerprint(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
}

/**
 * Build map fingerprint → ParagraphProperties для быстрого lookup в parser.ts.
 * При коллизиях (один и тот же текст в нескольких параграфах) — берём первый
 * unconsumed match (поэтому вернётся очередь Map<fp, ParagraphProperties[]>).
 */
export function buildPropsByText(
  props: ParagraphProperties[],
): Map<string, ParagraphProperties[]> {
  const map = new Map<string, ParagraphProperties[]>();
  for (const p of props) {
    const fp = fingerprint(p.text);
    if (!fp) continue;
    const existing = map.get(fp);
    if (existing) existing.push(p);
    else map.set(fp, [p]);
  }
  return map;
}
