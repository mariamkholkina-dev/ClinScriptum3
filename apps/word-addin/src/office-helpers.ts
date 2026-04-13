declare const Word: any;
declare const Office: any;

const CLINSCRIPTUM_NS = "urn:clinscriptum:word-session";

export async function navigateToText(textSnippet: string): Promise<boolean> {
  return Word.run(async (context: any) => {
    const body = context.document.body;
    const searchResults = body.search(textSnippet, {
      matchCase: false,
      matchWholeWord: false,
    });
    searchResults.load("items");
    await context.sync();

    if (searchResults.items.length > 0) {
      searchResults.items[0].select();
      await context.sync();
      return true;
    }

    if (textSnippet.length > 40) {
      const shorter = textSnippet.slice(0, 40);
      const fallback = body.search(shorter, { matchCase: false });
      fallback.load("items");
      await context.sync();
      if (fallback.items.length > 0) {
        fallback.items[0].select();
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
      const searchText = snippet.length > 60 ? snippet.slice(0, 60) : snippet;
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
    body.font.highlightColor = "None";
    await context.sync();
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
