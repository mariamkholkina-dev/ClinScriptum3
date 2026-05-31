/**
 * Декодирование HTML-сущностей в plain-text. Без этого `&gt;`, `&lt;`, `&amp;`
 * и т.п. попадали в `ContentBlock.content` (текст, который видит LLM и который
 * используется как цитата) → ложные находки «использована HTML-сущность вместо
 * символа» и несовпадение цитаты с текстом документа при переходе в Word.
 *
 * `&amp;` декодируем ПОСЛЕДНИМ, иначе двойное декодирование (`&amp;gt;` → `>`).
 */
function safeFromCodePoint(cp: number): string {
  try {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeFromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}
