/**
 * In-process sliding-window limiter for the endpoints an attacker would hammer:
 * login, password-reset requests, invite acceptance. One process holds all the
 * state, which is correct for this app's single-server deploy; a multi-instance
 * deploy would need this moved to shared storage.
 */

const g = globalThis as unknown as { __bantaiRate?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__bantaiRate ??= new Map());

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterMs: windowMs - (now - recent[0]) };
  }
  recent.push(now);
  hits.set(key, recent);
  // Keep the map from growing without bound on a long-lived server.
  if (hits.size > 10_000) {
    for (const [k, times] of hits) {
      if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  }
  return { ok: true, retryAfterMs: 0 };
}
