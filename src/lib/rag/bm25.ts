/**
 * Keyword search with no external service: BM25 over the child chunks, fused
 * with the dense ranking by reciprocal rank. It is also the whole retrieval
 * path when no embedding provider is available.
 */

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have how i if in into is it its of on or " +
    "that the their then there these this to was were what when where which who why will with you your " +
    "do does did can could should would about not no so than too very"
  ).split(" "),
);

/** Deliberately light: enough to match "discounts" with "discount", nothing clever. */
export function stem(token: string): string {
  if (token.length <= 4) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = match[0];
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    out.push(stem(token));
  }
  return out;
}

const K1 = 1.5;
const B = 0.75;

export interface Scored {
  id: string;
  score: number;
}

export class Bm25Index {
  private readonly ids: string[];
  private readonly lengths: number[];
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly avgLength: number;

  constructor(docs: { id: string; text: string }[]) {
    this.ids = docs.map((d) => d.id);
    this.lengths = [];
    docs.forEach((doc, index) => {
      const tokens = tokenize(doc.text);
      this.lengths.push(tokens.length);
      const counts = new Map<string, number>();
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
      for (const [token, count] of counts) {
        let posting = this.postings.get(token);
        if (!posting) this.postings.set(token, (posting = new Map()));
        posting.set(index, count);
      }
    });
    const total = this.lengths.reduce((a, b) => a + b, 0);
    this.avgLength = docs.length > 0 ? total / docs.length : 0;
  }

  search(query: string, k: number): Scored[] {
    const n = this.ids.length;
    if (n === 0) return [];
    const scores = new Map<number, number>();
    for (const token of new Set(tokenize(query))) {
      const posting = this.postings.get(token);
      if (!posting) continue;
      const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5));
      for (const [doc, tf] of posting) {
        const norm = 1 - B + B * (this.lengths[doc] / (this.avgLength || 1));
        const weight = (idf * tf * (K1 + 1)) / (tf + K1 * norm);
        scores.set(doc, (scores.get(doc) ?? 0) + weight);
      }
    }
    return [...scores]
      .map(([doc, score]) => ({ id: this.ids[doc], score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, k);
  }
}

/** Reciprocal rank fusion: rewards agreement between rankings without comparing their scores. */
export function fuse(rankings: string[][], k = 60): Scored[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
