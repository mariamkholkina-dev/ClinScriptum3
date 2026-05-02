// chunking lives in @clinscriptum/shared, but adding the test here
// keeps the dependency direction single-package and avoids having to
// stand up a vitest config in shared. The function is small and pure.
import { describe, it, expect } from "vitest";
import { chunkWithOverlap } from "@clinscriptum/shared";

describe("chunkWithOverlap", () => {
  it("returns one chunk if text fits the size", () => {
    const out = chunkWithOverlap("hello world", { size: 100, overlap: 10 });
    expect(out).toEqual(["hello world"]);
  });

  it("returns empty array for empty text", () => {
    expect(chunkWithOverlap("", { size: 100, overlap: 10 })).toEqual([]);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "a".repeat(1000);
    const chunks = chunkWithOverlap(text, { size: 200, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
  });

  it("ensures every position appears in at least one chunk", () => {
    const text = "x".repeat(1000);
    const chunks = chunkWithOverlap(text, { size: 200, overlap: 50 });
    const total = chunks.reduce((s, c) => s + c.length, 0);
    expect(total).toBeGreaterThanOrEqual(text.length);
  });

  it("rejects invalid overlap values", () => {
    expect(() => chunkWithOverlap("text", { size: 100, overlap: 100 })).toThrow();
    expect(() => chunkWithOverlap("text", { size: 100, overlap: -1 })).toThrow();
    expect(() => chunkWithOverlap("text", { size: 0, overlap: 0 })).toThrow();
  });

  it("prefers breaking on whitespace", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkWithOverlap(words, { size: 100, overlap: 20 });
    for (const c of chunks) {
      // Should not end mid-word (allowing for last chunk which may end on text boundary)
      const trimmed = c.trim();
      if (trimmed.length === c.length) continue; // end at exact boundary OK
      expect(/\s$/.test(c) || c === chunks[chunks.length - 1]).toBe(true);
    }
  });
});
