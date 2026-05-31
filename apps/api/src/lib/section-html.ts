/**
 * Сборка HTML-представления раздела из его content-блоков. Нужна, чтобы в UI
 * ревьюера были видны таблицы и переносы строк: при склейке plain-text'а
 * ячейки/строки сливаются и ложно выглядят как «отсутствие пробела».
 *
 * Берём `rawHtml` блока (mammoth → HTML: <p>, <table>, <br> и т.п.); если его
 * нет — оборачиваем экранированный текст в <p>.
 */
type BlockLike = { content: string; rawHtml: string | null };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSectionHtml(blocks: BlockLike[]): string {
  return blocks
    .map((b) =>
      b.rawHtml && b.rawHtml.trim() ? b.rawHtml : `<p>${escapeHtml(b.content ?? "")}</p>`,
    )
    .join("\n");
}
