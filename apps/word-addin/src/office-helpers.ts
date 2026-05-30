declare const Word: any;
declare const Office: any;

const CLINSCRIPTUM_NS = "urn:clinscriptum:word-session";

/**
 * Лучшая цитата для поиска места находки в документе. У intra-audit находок
 * текст лежит в разных полях sourceRef в зависимости от направления проверки
 * (self/cross/editorial), поэтому перебираем все известные варианты, а не
 * только textSnippet — иначе подсветка/переход для части находок не работают.
 */
export function bestSnippet(sourceRef: any): string | undefined {
  const r = sourceRef ?? {};
  const candidate =
    r.textSnippet || r.checkedDocQuote || r.anchorQuote || r.targetQuote || r.referenceQuote;
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

/**
 * Нормализует цитату под Word.search: схлопывает переводы строк и повторные
 * пробелы (иначе поиск не находит фрагмент, пересекающий границы абзацев/
 * прогонов) и ограничивает длину (Word.search не принимает строки > 255).
 */
function normalizeForSearch(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function navigateToText(textSnippet: string): Promise<boolean> {
  const normalized = normalizeForSearch(textSnippet);
  if (!normalized) return false;
  // Кандидаты от наиболее специфичного к менее: полная нормализованная цитата,
  // затем первые ~120 и ~60 символов (длиннее = меньше ложных совпадений).
  const candidates = [normalized];
  if (normalized.length > 120) candidates.push(normalized.slice(0, 120));
  if (normalized.length > 60) candidates.push(normalized.slice(0, 60));

  return Word.run(async (context: any) => {
    const body = context.document.body;
    for (const term of candidates) {
      const results = body.search(term, { matchCase: false, matchWholeWord: false });
      results.load("items");
      await context.sync();
      if (results.items.length > 0) {
        results.items[0].select();
        // scrollIntoView гарантирует прокрутку к выделению (select не всегда
        // прокручивает, если место уже «технически» в области просмотра).
        if (typeof results.items[0].scrollIntoView === "function") {
          results.items[0].scrollIntoView();
        }
        await context.sync();
        return true;
      }
    }
    return false;
  });
}

export async function navigateToSection(sectionTitle: string): Promise<boolean> {
  return Word.run(async (context: any) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    paragraphs.load("items");
    await context.sync();

    for (const para of paragraphs.items) {
      para.load("text,style");
    }
    await context.sync();

    for (const para of paragraphs.items) {
      const style = (para.style || "").toLowerCase();
      const isHeading = style.includes("heading") || style.includes("заголовок");
      if (isHeading && para.text.toLowerCase().includes(sectionTitle.toLowerCase())) {
        para.select();
        await context.sync();
        return true;
      }
    }

    const search = body.search(sectionTitle, { matchCase: false });
    search.load("items");
    await context.sync();
    if (search.items.length > 0) {
      search.items[0].select();
      await context.sync();
      return true;
    }
    return false;
  });
}

export async function applyTextReplacement(
  oldText: string,
  newText: string
): Promise<boolean> {
  return Word.run(async (context: any) => {
    const body = context.document.body;
    const searchResults = body.search(oldText, { matchCase: true });
    searchResults.load("items");
    await context.sync();

    if (searchResults.items.length > 0) {
      searchResults.items[0].insertText(newText, "Replace");
      await context.sync();
      return true;
    }
    return false;
  });
}

export async function highlightFindingLocations(
  snippets: string[],
  color: string = "Yellow"
): Promise<number> {
  return Word.run(async (context: any) => {
    let count = 0;
    for (const snippet of snippets) {
      if (!snippet || snippet.length < 5) continue;
      const clean = normalizeForSearch(snippet);
      const searchText = clean.length > 60 ? clean.slice(0, 60) : clean;
      if (!searchText) continue;
      const results = context.document.body.search(searchText, { matchCase: false });
      results.load("items");
      await context.sync();
      for (const item of results.items) {
        item.font.highlightColor = color;
        count++;
      }
    }
    await context.sync();
    return count;
  });
}

export async function clearHighlights(): Promise<void> {
  return Word.run(async (context: any) => {
    const body = context.document.body;
    // Office.js API: для снятия highlight нужно ставить null,
    // строка "None" игнорируется (невалидный color).
    body.font.highlightColor = null;
    await context.sync();
  });
}

/**
 * Combined-операция: за один Word.run + один ctx.sync делает:
 *   1) сброс предыдущей жёлтой подсветки (body.font.highlightColor = null);
 *   2) поиск нужного места (heading-aware → textSnippet → paragraphIndex
 *      → plain title fallback);
 *   3) select + highlight найденного range.
 *
 * Раньше было два отдельных Word.run (clearHighlights + jumpToHeading),
 * каждый со своим sync — на больших протоколах это давало ощутимую задержку
 * (~1сек) от клика до отклика. Один sync даёт ~2x ускорение.
 *
 * Returns true если нашли и выделили, false если ни одна стратегия не сработала.
 */
export async function selectSection(opts: {
  title: string;
  textSnippet?: string;
  paragraphIndex?: number;
  fallbackText?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Word.run(async (ctx: any) => {
      const body = ctx.document.body;
      // 1) Сброс старой подсветки — выполнится в этом же sync с jump'ом.
      body.font.highlightColor = null;

      // TOC-стиль title'ы из доков часто содержат trailing номер страницы:
      // "5.4 Заслепление 45", "8.2.5 Последующее наблюдение День 7 58".
      // body.search(полный title) тогда находит первое совпадение с цифрой
      // (e.g. "стр. 1" в адресе) — выделяет не туда. Стрипаем trailing number
      // и пунктуацию перед использованием в search-стратегиях.
      const cleanTitle = (s: string) =>
        s.replace(/\s+\d+\.?\s*$/, "").replace(/\s+\.+\s*$/, "").trim();

      const cleanedTitle = cleanTitle(opts.title);
      const needle = cleanedTitle.toLowerCase();
      const snippet = opts.textSnippet?.slice(0, 80);
      const fallback = cleanTitle(opts.fallbackText ?? opts.title).slice(0, 80);

      // Загружаем параграфы и search ranges параллельно (одним sync'ом).
      const paragraphs = body.paragraphs;
      paragraphs.load("items/text,items/style");

      const snippetSearch = snippet ? body.search(snippet, { matchCase: false, matchWholeWord: false }) : null;
      if (snippetSearch) snippetSearch.load("items");

      const fallbackSearch = fallback ? body.search(fallback, { matchCase: false, matchWholeWord: false }) : null;
      if (fallbackSearch) fallbackSearch.load("items");

      await ctx.sync();

      const items = paragraphs.items as Array<{
        text: string;
        style: string;
        select: () => void;
        font: { highlightColor: string | null };
      }>;

      const applyHighlight = async (target: any) => {
        target.select();
        target.font.highlightColor = "yellow";
        // scrollIntoView нужен потому что target.select() позиционирует cursor,
        // но Word не всегда scroll'ит к видимой области — особенно когда heading
        // находится первой строкой таблицы на page boundary. Без явного scroll
        // юзер видит «ничего не произошло» хотя selection переехал.
        if (typeof target.scrollIntoView === "function") {
          target.scrollIntoView();
        }
        await ctx.sync();
      };

      // Стратегия 1: heading-aware точное совпадение.
      if (needle.length > 0) {
        for (const p of items) {
          const style = (p.style ?? "").toLowerCase();
          if (!(style.includes("heading") || style.includes("заголовок"))) continue;
          const pText = (p.text ?? "").trim().toLowerCase();
          if (pText === needle) {
            await applyHighlight(p);
            resolve(true);
            return;
          }
        }
        // Стратегия 1b: heading-aware substring.
        for (const p of items) {
          const style = (p.style ?? "").toLowerCase();
          if (!(style.includes("heading") || style.includes("заголовок"))) continue;
          const pText = (p.text ?? "").trim().toLowerCase();
          if (pText.includes(needle)) {
            await applyHighlight(p);
            resolve(true);
            return;
          }
        }
      }

      // Стратегия 2: search по textSnippet.
      if (snippetSearch && snippetSearch.items.length > 0) {
        await applyHighlight(snippetSearch.items[0]);
        resolve(true);
        return;
      }

      // Стратегия 3: paragraphIndex как last resort.
      if (typeof opts.paragraphIndex === "number" && opts.paragraphIndex >= 0 && opts.paragraphIndex < items.length) {
        await applyHighlight(items[opts.paragraphIndex]);
        resolve(true);
        return;
      }

      // Стратегия 4: fallbackText (обычно title) plain search.
      if (fallbackSearch && fallbackSearch.items.length > 0) {
        await applyHighlight(fallbackSearch.items[0]);
        resolve(true);
        return;
      }

      // Ничего не нашлось — но clear-highlight уже сработал, sync нужен.
      await ctx.sync();
      resolve(false);
    }).catch(() => resolve(false));
  });
}

/**
 * Прыгнуть на текст в Word по фрагменту (первые 80 символов) — выделить
 * найденное место и подсветить жёлтым. Используется при клике на секцию
 * в дереве ParsingPanel: annotator видит, какой кусок документа соответствует
 * текущему заголовку.
 *
 * Возвращает true если совпадение найдено, false если нет.
 */
export async function jumpToTextInWord(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    Word.run(async (ctx: any) => {
      const ranges = ctx.document.body.search(text.slice(0, 80), {
        matchCase: false,
        matchWholeWord: false,
      });
      ranges.load("items");
      await ctx.sync();
      if (ranges.items.length === 0) {
        resolve(false);
        return;
      }
      ranges.items[0].select();
      ranges.items[0].font.highlightColor = "yellow";
      await ctx.sync();
      resolve(true);
    }).catch(() => resolve(false));
  });
}

/**
 * Поиск параграфа со стилем Heading X, текст которого совпадает с
 * заголовком раздела. Это надёжнее чем body.search(text) — учитывает что
 * тот же текст может встречаться в обычных параграфах. И надёжнее
 * paragraphIndex — Word и mammoth по-разному считают параграфы.
 *
 * При первой попытке требуем точное совпадение текста (case-insensitive
 * после trim). Если не нашлось — повторяем без heading-фильтра.
 *
 * Возвращает true если найдено и выделено.
 */
export async function jumpToHeading(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    Word.run(async (ctx: any) => {
      const needle = title.trim().toLowerCase();
      if (needle.length === 0) {
        resolve(false);
        return;
      }
      const paragraphs = ctx.document.body.paragraphs;
      paragraphs.load("items/text,items/style");
      await ctx.sync();
      const items = paragraphs.items as Array<{ text: string; style: string; select: () => void; font: { highlightColor: string | null } }>;

      // Pass 1: heading style + точное совпадение текста
      for (const p of items) {
        const style = (p.style ?? "").toLowerCase();
        const isHeading = style.includes("heading") || style.includes("заголовок");
        const pText = (p.text ?? "").trim().toLowerCase();
        if (isHeading && pText === needle) {
          p.select();
          p.font.highlightColor = "yellow";
          await ctx.sync();
          resolve(true);
          return;
        }
      }

      // Pass 2: heading style + содержит подстроку (для случаев с номером
      // раздела внутри текста параграфа, e.g. "5.4 Заключение")
      for (const p of items) {
        const style = (p.style ?? "").toLowerCase();
        const isHeading = style.includes("heading") || style.includes("заголовок");
        const pText = (p.text ?? "").trim().toLowerCase();
        if (isHeading && pText.includes(needle)) {
          p.select();
          p.font.highlightColor = "yellow";
          await ctx.sync();
          resolve(true);
          return;
        }
      }

      resolve(false);
    }).catch(() => resolve(false));
  });
}

/**
 * Anchor-based навигация: переход к параграфу по индексу (как индексирует
 * doc-parser при разборе DOCX). Это надёжнее чем body.search(textSnippet),
 * который может найти несколько вхождений или не найти вовсе при изменении
 * пунктуации/пробелов.
 *
 * Если paragraphIndex выходит за границы — возвращаем false; вызывающий код
 * должен fallback'нуть на jumpToTextInWord по textSnippet.
 *
 * Возвращает true если параграф найден и выделен.
 */
export async function jumpToParagraphByIndex(paragraphIndex: number): Promise<boolean> {
  return new Promise((resolve) => {
    Word.run(async (ctx: any) => {
      const paragraphs = ctx.document.body.paragraphs;
      paragraphs.load("items");
      await ctx.sync();
      const items = paragraphs.items;
      if (paragraphIndex < 0 || paragraphIndex >= items.length) {
        resolve(false);
        return;
      }
      const target = items[paragraphIndex];
      target.select();
      target.font.highlightColor = "yellow";
      await ctx.sync();
      resolve(true);
    }).catch(() => resolve(false));
  });
}

/**
 * Возвращает текст текущего выделения + paragraphIndex (примерный — позиция
 * параграфа, в котором находится начало выделения, среди всех параграфов body).
 *
 * Если ничего не выделено или выделение пустое — возвращает null.
 *
 * paragraphIndex рассчитывается как индекс первого параграфа, чей текст совпадает
 * с первой строкой выделения, в `body.paragraphs`. Это совместимо с тем, как
 * doc-parser индексирует параграфы при разборе DOCX (см. `paragraph-walker`).
 */
export async function getSelectionContext(): Promise<{
  text: string;
  paragraphIndex: number;
} | null> {
  return new Promise((resolve) => {
    Word.run(async (ctx: any) => {
      const selection = ctx.document.getSelection();
      selection.load("text");
      const allParagraphs = ctx.document.body.paragraphs;
      allParagraphs.load("items/text");
      await ctx.sync();

      const selectedText: string = (selection.text ?? "").toString();
      if (!selectedText || selectedText.trim().length === 0) {
        resolve(null);
        return;
      }

      // Берём первую непустую строку выделения и ищем её в полном списке
      // параграфов. Это даёт стабильный paragraphIndex даже если выделение
      // охватывает несколько параграфов.
      const firstLine = selectedText.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? selectedText.trim();
      const needle = firstLine.slice(0, 80);

      let paragraphIndex = 0;
      const items = allParagraphs.items as Array<{ text: string }>;
      for (let i = 0; i < items.length; i++) {
        const paraText = (items[i].text ?? "").trim();
        if (paraText.length > 0 && paraText.includes(needle)) {
          paragraphIndex = i;
          break;
        }
      }

      resolve({ text: selectedText, paragraphIndex });
    }).catch(() => resolve(null));
  });
}

export async function insertTextAtCursor(text: string): Promise<void> {
  return Word.run(async (context: any) => {
    const selection = context.document.getSelection();
    selection.insertText(text, "Replace");
    await context.sync();
  });
}

export async function insertHtmlAtCursor(html: string): Promise<void> {
  return Word.run(async (context: any) => {
    const selection = context.document.getSelection();
    selection.insertHtml(html, "Replace");
    await context.sync();
  });
}

export async function getDocumentContent(): Promise<string> {
  return Word.run(async (context: any) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    return body.text;
  });
}

export async function getDocumentAsBase64(): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: 65536 },
      (result: any) => {
        if (result.status !== Office.AsyncResultStatus.Succeeded) {
          reject(new Error("Failed to get file"));
          return;
        }
        const file = result.value;
        const sliceCount = file.sliceCount;
        const chunks: Uint8Array[] = [];
        let slicesReceived = 0;

        const getSlice = (index: number) => {
          file.getSliceAsync(index, (sliceResult: any) => {
            if (sliceResult.status === Office.AsyncResultStatus.Succeeded) {
              chunks[index] = new Uint8Array(sliceResult.value.data);
              slicesReceived++;
              if (slicesReceived === sliceCount) {
                file.closeAsync();
                const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
                const combined = new Uint8Array(totalLen);
                let offset = 0;
                for (const chunk of chunks) {
                  combined.set(chunk, offset);
                  offset += chunk.length;
                }
                const binaryChunks: string[] = [];
                const CHUNK_SIZE = 8192;
                for (let i = 0; i < combined.length; i += CHUNK_SIZE) {
                  binaryChunks.push(
                    String.fromCharCode(...combined.slice(i, i + CHUNK_SIZE))
                  );
                }
                resolve(btoa(binaryChunks.join("")));
              } else if (index + 1 < sliceCount) {
                getSlice(index + 1);
              }
            } else {
              file.closeAsync();
              reject(new Error("Failed to get slice"));
            }
          });
        };
        getSlice(0);
      }
    );
  });
}

export async function readCustomXmlPart(): Promise<string | null> {
  return new Promise((resolve) => {
    Office.context.document.customXmlParts.getByNamespaceAsync(
      CLINSCRIPTUM_NS,
      (result: any) => {
        if (
          result.status !== Office.AsyncResultStatus.Succeeded ||
          result.value.length === 0
        ) {
          resolve(null);
          return;
        }
        const part = result.value[0];
        part.getXmlAsync((xmlResult: any) => {
          if (xmlResult.status !== Office.AsyncResultStatus.Succeeded) {
            resolve(null);
            return;
          }
          const xml = xmlResult.value as string;
          const match = xml.match(/<SessionId>([^<]+)<\/SessionId>/);
          resolve(match ? match[1] : null);
        });
      }
    );
  });
}

export async function removeCustomXmlPart(): Promise<void> {
  return new Promise((resolve) => {
    Office.context.document.customXmlParts.getByNamespaceAsync(
      CLINSCRIPTUM_NS,
      (result: any) => {
        if (
          result.status !== Office.AsyncResultStatus.Succeeded ||
          result.value.length === 0
        ) {
          resolve();
          return;
        }
        let remaining = result.value.length;
        for (const part of result.value) {
          part.deleteAsync(() => {
            remaining--;
            if (remaining === 0) resolve();
          });
        }
      }
    );
  });
}
