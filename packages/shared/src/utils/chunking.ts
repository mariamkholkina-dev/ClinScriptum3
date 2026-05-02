/**
 * Sliding-window chunking with overlap.
 *
 * Used by Phase 3 of fact-extraction roadmap to chunk a single
 * over-budget section while preserving context across chunk
 * boundaries (so a fact spanning the boundary still has at least
 * one chunk that contains it whole).
 *
 * The algorithm:
 *   - Each chunk is at most `size` characters.
 *   - Each next chunk starts `size - overlap` characters after the
 *     previous one.
 *   - We try to break on whitespace within the last 10% of `size`
 *     to avoid mid-word cuts.
 */

export interface ChunkOptions {
  size: number;
  overlap: number;
}

export function chunkWithOverlap(
  text: string,
  opts: ChunkOptions = { size: 8000, overlap: 1000 },
): string[] {
  const { size, overlap } = opts;
  if (size <= 0) throw new Error("chunk size must be positive");
  if (overlap < 0 || overlap >= size) throw new Error("overlap must be >= 0 and < size");
  if (text.length <= size) return text.length === 0 ? [] : [text];

  const chunks: string[] = [];
  const step = size - overlap;
  let start = 0;
  const breakWindow = Math.max(1, Math.floor(size * 0.1));

  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      // Prefer breaking on whitespace within the last 10% to avoid
      // splitting a token in half.
      const slice = text.slice(end - breakWindow, end);
      const m = /\s[^\s]*$/.exec(slice);
      if (m && m.index > 0) {
        end = end - breakWindow + m.index + 1;
      }
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
    // Guard: if step would not advance, force progress.
    if (start <= chunks.length * step - step && step > 0) {
      start = Math.max(start, chunks.length * step);
    }
  }

  return chunks;
}
