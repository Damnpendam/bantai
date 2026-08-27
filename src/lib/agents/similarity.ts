/**
 * Cheap near-duplicate detection so the reviewer does not have to reason over
 * every pair of cases. Finding candidates is mechanical work; deciding whether a
 * candidate pair is genuinely redundant is the judgement we actually want a model for.
 */

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(text: string): Set<string> {
  const padded = ` ${normalise(text)} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

export function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

export interface CandidatePair<T> {
  a: T;
  b: T;
  score: number;
}

/**
 * Pairs whose titles are similar enough to be worth a second look. Deliberately
 * generous — a missed candidate is a duplicate that survives, and the model still
 * gets the final say on every pair returned.
 */
export function findCandidatePairs<T>(
  items: T[],
  titleOf: (item: T) => string,
  { threshold = 0.4, limit = 80 }: { threshold?: number; limit?: number } = {},
): CandidatePair<T>[] {
  const titles = items.map(titleOf);
  const grams = titles.map(trigrams);
  const pairs: CandidatePair<T>[] = [];

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const left = grams[i];
      const right = grams[j];
      if (left.size === 0 || right.size === 0) continue;
      let shared = 0;
      for (const gram of left) {
        if (right.has(gram)) shared += 1;
      }
      const score = shared / (left.size + right.size - shared);
      if (score >= threshold) pairs.push({ a: items[i], b: items[j], score });
    }
  }

  return pairs.sort((x, y) => y.score - x.score).slice(0, limit);
}
