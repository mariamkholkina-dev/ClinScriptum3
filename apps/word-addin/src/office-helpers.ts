declare const Word: any;

/**
 * URS-044: Navigate to a specific text in the Word document.
 */
export async function navigateToText(textSnippet: string): Promise<boolean> {
  return Word.run(async (context: any) => {
    const body = context.document.body;
    const searchResults = body.search(textSnippet, { matchCase: false, matchWholeWord: false });
    searchResults.load("items");
    await context.sync();

    if (searchResults.items.length > 0) {
      const range = searchResults.items[0];
      range.select();
      await context.sync();
      return true;
    }
    return false;
  });
}

/**
 * URS-044: Apply a text replacement (fix) in the document.
 */
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

/**
 * URS-046: Get the current document content for upload.
 */
export async function getDocumentContent(): Promise<string> {
  return Word.run(async (context: any) => {
    const body = context.document.body;
    body.load("text");
    await context.sync();
    return body.text;
  });
}

/**
 * URS-047: Get document as base64 for upload, ignoring tracked changes.
 */
export async function getDocumentAsBase64(): Promise<string> {
  return new Promise((resolve, reject) => {
    (Office as any).context.document.getFileAsync(
      (Office as any).FileType.Compressed,
      { sliceSize: 65536 },
      (result: any) => {
        if (result.status !== (Office as any).AsyncResultStatus.Succeeded) {
          reject(new Error("Failed to get file"));
          return;
        }

        const file = result.value;
        const sliceCount = file.sliceCount;
        const chunks: Uint8Array[] = [];
        let slicesReceived = 0;

        const getSlice = (index: number) => {
          file.getSliceAsync(index, (sliceResult: any) => {
            if (sliceResult.status === (Office as any).AsyncResultStatus.Succeeded) {
              chunks.push(new Uint8Array(sliceResult.value.data));
              slicesReceived++;
              if (slicesReceived === sliceCount) {
                file.closeAsync();
                const combined = new Uint8Array(
                  chunks.reduce((sum, c) => sum + c.length, 0)
                );
                let offset = 0;
                for (const chunk of chunks) {
                  combined.set(chunk, offset);
                  offset += chunk.length;
                }
                const base64 = btoa(
                  String.fromCharCode(...combined)
                );
                resolve(base64);
              } else {
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

/**
 * Highlight text range in the document.
 */
export async function highlightText(
  textSnippet: string,
  color: string = "Yellow"
): Promise<void> {
  return Word.run(async (context: any) => {
    const searchResults = context.document.body.search(textSnippet, { matchCase: false });
    searchResults.load("items");
    await context.sync();

    for (const item of searchResults.items) {
      item.font.highlightColor = color;
    }
    await context.sync();
  });
}
