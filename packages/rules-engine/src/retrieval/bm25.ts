/**
 * Tiny BM25 ranker. Pure JS, no native deps.
 *
 * Used by Phase 3 of the fact-extraction roadmap to point LLM
 * extraction at the most-relevant section for each factKey instead
 * of dumping the whole document.
 *
 * Reference: Okapi BM25 (Robertson et al., 1995).
 *   score(D, Q) = Σ_q IDF(q) · (f(q,D)·(k1+1)) / (f(q,D) + k1·(1 - b + b·|D|/avgdl))
 *
 * Defaults: k1=1.5, b=0.75 (mid-range Okapi). Tuneable per-instance.
 */

import { tokenize, stemPhrase } from "../morphology.js";

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export interface Bm25Hit {
  docId: string;
  score: number;
}

interface DocStats {
  termFreq: Map<string, number>;
  length: number;
}

function preprocess(text: string): string[] {
  // tokenize() applies lower-cased Unicode word splitting; stemPhrase
  // collapses Russian/English inflections so "включения"/"включение"
  // hit the same posting list.
  const stemmed = stemPhrase(text, "auto");
  return tokenize(stemmed);
}

export class Bm25Index {
  private k1: number;
  private b: number;
  private docs = new Map<string, DocStats>();
  private postings = new Map<string, Set<string>>();
  private totalLength = 0;

  constructor(opts: Bm25Options = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
  }

  add(docId: string, text: string): void {
    if (this.docs.has(docId)) return;
    const tokens = preprocess(text);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    this.docs.set(docId, { termFreq: tf, length: tokens.length });
    this.totalLength += tokens.length;
    for (const term of tf.keys()) {
      const set = this.postings.get(term) ?? new Set<string>();
      set.add(docId);
      this.postings.set(term, set);
    }
  }

  size(): number {
    return this.docs.size;
  }

  private avgdl(): number {
    return this.docs.size === 0 ? 0 : this.totalLength / this.docs.size;
  }

  private idf(term: string): number {
    const N = this.docs.size;
    const n = this.postings.get(term)?.size ?? 0;
    if (n === 0) return 0;
    // Robertson-Sparck Jones IDF with +1 smoothing to avoid negatives.
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  score(docId: string, queryTerms: string[]): number {
    const doc = this.docs.get(docId);
    if (!doc) return 0;
    const avgdl = this.avgdl();
    let s = 0;
    for (const term of queryTerms) {
      const tf = doc.termFreq.get(term);
      if (!tf) continue;
      const idf = this.idf(term);
      const denom = tf + this.k1 * (1 - this.b + (this.b * doc.length) / (avgdl || 1));
      s += idf * ((tf * (this.k1 + 1)) / denom);
    }
    return s;
  }

  /** Score every document; return top-K sorted by descending score. */
  topK(query: string, k: number): Bm25Hit[] {
    if (k <= 0 || this.docs.size === 0) return [];
    const queryTerms = preprocess(query);
    if (queryTerms.length === 0) return [];
    const candidates = new Set<string>();
    for (const t of queryTerms) {
      const posting = this.postings.get(t);
      if (posting) for (const docId of posting) candidates.add(docId);
    }
    const hits: Bm25Hit[] = [];
    for (const docId of candidates) {
      const score = this.score(docId, queryTerms);
      if (score > 0) hits.push({ docId, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}
