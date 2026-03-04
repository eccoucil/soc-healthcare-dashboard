import "server-only";

/**
 * Server-side in-memory cache with TTL and in-flight request deduplication.
 * Prevents redundant ArcSight API calls when multiple frontend polls overlap.
 */
export function createServerCache<T>(ttlMs: number) {
  let cached: { data: T; timestamp: number } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    get(): T | null {
      if (cached && Date.now() - cached.timestamp < ttlMs) {
        return cached.data;
      }
      return null;
    },

    set(data: T): void {
      cached = { data, timestamp: Date.now() };
    },

    async getOrFetch(fetcher: () => Promise<T>): Promise<T> {
      const hit = this.get();
      if (hit !== null) return hit;

      // Deduplicate concurrent in-flight requests
      if (!inflight) {
        inflight = fetcher().finally(() => {
          inflight = null;
        });
      }
      const result = await inflight;
      this.set(result);
      return result;
    },
  };
}
