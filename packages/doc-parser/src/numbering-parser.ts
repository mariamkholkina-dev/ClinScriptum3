/**
 * Резолв автоматической нумерации заголовков Word.
 *
 * Word рендерит «1.2.3 Заголовок» через два механизма:
 *   1) `word/document.xml` — параграф со ссылкой `<w:numPr><w:numId w:val="N"/>
 *      <w:ilvl w:val="L"/></w:numPr>`
 *   2) `word/numbering.xml` — определение списка `<w:num w:numId="N">` →
 *      `<w:abstractNumId>` → `<w:abstractNum>` со списком уровней
 *      `<w:lvl w:ilvl="0..8">` (start value, format string `"%1.%2"`).
 *
 * Mammoth этого не делает — у нас в `paragraph.text` лежит только «Заголовок»,
 * без номера. Этот модуль читает `numbering.xml`, строит lookup и предоставляет
 * counter-based resolver: для каждого параграфа с numId+ilvl возвращает
 * актуальный rendered номер (например `"1.2.3"`), увеличивая внутренние
 * счётчики ровно как это делает Word.
 *
 * Только heading-style уровни (через w:pStyle Heading X) считаются — но фильтр
 * style → numbering необязательный, потому что non-heading numId'ы тоже
 * нумеруют (bullet-lists, footnote-lists). Caller отвечает за то, чтобы
 * запрашивать счётчик только для тех параграфов, которые реально являются
 * заголовками.
 */

import { XMLParser } from "fast-xml-parser";

interface LevelDef {
  /** Format string, e.g. `"%1.%2.%3."`. Каждый `%N` — placeholder для уровня N-1. */
  format: string;
  start: number;
  numFmt: string;
}

interface AbstractNum {
  id: string;
  levels: Map<number, LevelDef>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  parseTagValue: false,
  trimValues: false,
});

type PreservedNode = Record<string, unknown>;

function tagOf(node: PreservedNode): string | null {
  for (const k of Object.keys(node)) {
    if (k !== ":@") return k;
  }
  return null;
}

function childrenOf(node: PreservedNode, tag: string): PreservedNode[] {
  const v = node[tag];
  return Array.isArray(v) ? (v as PreservedNode[]) : [];
}

function attrsOf(node: PreservedNode): Record<string, unknown> {
  return (node[":@"] as Record<string, unknown> | undefined) ?? {};
}

function attrInt(attrs: Record<string, unknown>, key: string): number | undefined {
  const v = attrs[key];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function attrStr(attrs: Record<string, unknown>, key: string): string | undefined {
  const v = attrs[key];
  return v === undefined ? undefined : String(v);
}

/** Распарсенный numbering.xml: numId → abstractNum (with levels). */
export interface NumberingDefinitions {
  numIdToAbstract: Map<number, AbstractNum>;
}

/**
 * Парсит `word/numbering.xml` в lookup структуру.
 * Если файла нет / он пустой / невалиден — возвращает пустую структуру
 * (resolver просто будет всегда возвращать null).
 */
export function parseNumberingXml(xml: string | null | undefined): NumberingDefinitions {
  const empty: NumberingDefinitions = { numIdToAbstract: new Map() };
  if (!xml) return empty;

  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return empty;
  }

  const root = parsed as PreservedNode[];
  if (!Array.isArray(root)) return empty;

  const abstractNums = new Map<string, AbstractNum>();
  const numIdToAbstractId = new Map<number, string>();

  const visit = (node: PreservedNode) => {
    const tag = tagOf(node);
    if (!tag) return;

    if (tag === "w:abstractNum") {
      const attrs = attrsOf(node);
      const id = attrStr(attrs, "@_w:abstractNumId");
      if (id === undefined) return;
      const abs: AbstractNum = { id, levels: new Map() };
      for (const child of childrenOf(node, "w:abstractNum")) {
        const cTag = tagOf(child);
        if (cTag !== "w:lvl") continue;
        const lvlAttrs = attrsOf(child);
        const ilvl = attrInt(lvlAttrs, "@_w:ilvl");
        if (ilvl === undefined) continue;
        let start = 1;
        let format = `%${ilvl + 1}.`;
        let numFmt = "decimal";
        for (const lvlChild of childrenOf(child, "w:lvl")) {
          const lcTag = tagOf(lvlChild);
          if (lcTag === "w:start") {
            const v = attrInt(attrsOf(lvlChild), "@_w:val");
            if (v !== undefined) start = v;
          } else if (lcTag === "w:lvlText") {
            const v = attrStr(attrsOf(lvlChild), "@_w:val");
            if (v !== undefined) format = v;
          } else if (lcTag === "w:numFmt") {
            const v = attrStr(attrsOf(lvlChild), "@_w:val");
            if (v !== undefined) numFmt = v;
          }
        }
        abs.levels.set(ilvl, { format, start, numFmt });
      }
      abstractNums.set(id, abs);
      return;
    }

    if (tag === "w:num") {
      const attrs = attrsOf(node);
      const numId = attrInt(attrs, "@_w:numId");
      if (numId === undefined) return;
      for (const child of childrenOf(node, "w:num")) {
        if (tagOf(child) !== "w:abstractNumId") continue;
        const refId = attrStr(attrsOf(child), "@_w:val");
        if (refId !== undefined) numIdToAbstractId.set(numId, refId);
      }
      return;
    }

    const children = childrenOf(node, tag);
    for (const c of children) visit(c);
  };

  for (const node of root) visit(node);

  const numIdToAbstract = new Map<number, AbstractNum>();
  for (const [numId, absId] of numIdToAbstractId) {
    const abs = abstractNums.get(absId);
    if (abs) numIdToAbstract.set(numId, abs);
  }

  return { numIdToAbstract };
}

/**
 * Стейт-машина для итерации по параграфам в document order. Caller передаёт
 * `numId` + `ilvl` для каждого нумерованного параграфа, получает rendered
 * номер ("1", "1.1", "2.3.4" и т.п.). Счётчики растут per-abstractNum.
 *
 * Word reset'ит более глубокие уровни когда более высокий ув-ся (например
 * после "2." следующий ilvl=0 даёт "2." → reset ilvl=1,2,... к start-1).
 */
export class NumberingState {
  private counters = new Map<string, Map<number, number>>(); // abstractId → ilvl → current

  constructor(private defs: NumberingDefinitions) {}

  /**
   * Возвращает rendered номер для параграфа с указанным numId+ilvl и
   * увеличивает счётчик. Если не находит — возвращает null.
   */
  next(numId: number, ilvl: number): string | null {
    const abs = this.defs.numIdToAbstract.get(numId);
    if (!abs) return null;
    const lvlDef = abs.levels.get(ilvl);
    if (!lvlDef) return null;

    const map = this.counters.get(abs.id) ?? new Map<number, number>();
    this.counters.set(abs.id, map);

    // Reset deeper levels
    for (const [deeperLvl] of map) {
      if (deeperLvl > ilvl) map.delete(deeperLvl);
    }

    const prev = map.get(ilvl);
    const next = prev === undefined ? lvlDef.start : prev + 1;
    map.set(ilvl, next);

    // Подставляем %1, %2, … в format string значениями счётчиков
    return lvlDef.format.replace(/%(\d+)/g, (_, n: string) => {
      const idx = Number(n) - 1;
      if (idx === ilvl) return String(next);
      const cur = map.get(idx);
      const fallback = abs.levels.get(idx)?.start ?? 1;
      return String(cur ?? fallback);
    });
  }
}

/**
 * Извлекает чистый номер из rendered output'а: убирает trailing символы
 * ", . ): " которые часто бывают в format string'ах (Word любит `"%1.%2."`).
 * Внутренние точки между уровнями оставляем — они часть номера.
 */
export function cleanRenderedNumber(rendered: string): string {
  return rendered.replace(/[.)\]:\s]+$/, "");
}
