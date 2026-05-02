import { describe, it, expect } from "vitest";
import { Bm25Index } from "../retrieval/bm25.js";

describe("Bm25Index", () => {
  it("returns empty top-k for empty index", () => {
    const idx = new Bm25Index();
    expect(idx.topK("query", 5)).toEqual([]);
  });

  it("returns empty top-k for empty query", () => {
    const idx = new Bm25Index();
    idx.add("doc1", "some content");
    expect(idx.topK("", 5)).toEqual([]);
  });

  it("ranks docs by query overlap", () => {
    const idx = new Bm25Index();
    idx.add("doc1", "the quick brown fox jumps over the lazy dog");
    idx.add("doc2", "a clever red fox leaps gracefully through the forest");
    idx.add("doc3", "completely unrelated content about trains and tracks");
    const hits = idx.topK("brown fox", 3);
    expect(hits[0].docId).toBe("doc1");
  });

  it("returns at most k results", () => {
    const idx = new Bm25Index();
    for (let i = 0; i < 10; i++) idx.add(`doc${i}`, "endpoint primary outcome");
    const hits = idx.topK("primary", 3);
    expect(hits).toHaveLength(3);
  });

  it("scores diminish with document length (b parameter)", () => {
    const idx = new Bm25Index();
    idx.add("short", "endpoint");
    idx.add("long", "endpoint " + "filler ".repeat(100));
    const hits = idx.topK("endpoint", 2);
    expect(hits[0].docId).toBe("short");
  });

  it("ignores docs that don't match any query term", () => {
    const idx = new Bm25Index();
    idx.add("yes", "primary endpoint change in HbA1c");
    idx.add("no", "completely unrelated text about dogs and cats");
    const hits = idx.topK("primary endpoint", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].docId).toBe("yes");
  });

  it("collapses Russian morphology (stemming)", () => {
    const idx = new Bm25Index();
    idx.add("doc1", "критерии включения для пациентов с диабетом");
    idx.add("doc2", "обзор адверс-ивентов в терапии");
    const hits = idx.topK("критерий включения", 2);
    expect(hits[0].docId).toBe("doc1");
  });

  it("rejects duplicate docId silently", () => {
    const idx = new Bm25Index();
    idx.add("doc1", "primary endpoint");
    idx.add("doc1", "completely different text");
    expect(idx.size()).toBe(1);
  });
});
