import { getEventDetails, getEventDetailsRaw } from "@/lib/arcsight-channel-client";
import { withAuthRetry, AuthError } from "@/lib/session";

// Per-ID-set cache: keyed by sorted comma-joined IDs, 5-minute TTL
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 300_000;

function getCacheKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(",");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  const raw = searchParams.get("raw") === "true";
  const diag = searchParams.get("diag") === "true";

  if (!idsParam) {
    return Response.json(
      { error: "Missing required 'ids' query parameter" },
      { status: 400 }
    );
  }

  // Parse and validate IDs (max 10 per request)
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) {
    return Response.json(
      { error: "No valid numeric event IDs provided" },
      { status: 400 }
    );
  }

  if (ids.length > 10) {
    return Response.json(
      { error: "Maximum 10 event IDs per request" },
      { status: 400 }
    );
  }

  try {
    // Raw mode: return decoded GWT-RPC for debugging
    if (raw) {
      const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
        return getEventDetailsRaw(auth, ids);
      });
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
      return Response.json(result, { headers });
    }

    // Check cache OUTSIDE withAuthRetry
    const cacheKey = getCacheKey(ids);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return Response.json(cached.data, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      return getEventDetails(auth, ids);
    });

    // Diagnostic mode: return extra debug info, skip cache
    if (diag) {
      const nonNullValueCount = result.events[0]
        ? Object.values(result.events[0].fields).filter((f: { value?: unknown }) => f.value != null).length
        : 0;
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
      return Response.json({
        ...result,
        _diag: {
          fieldNamesFromParser: result.fieldNames,
          nonNullValueCount,
          totalFieldCount: result.totalFieldCount,
          eventIdSent: ids,
        },
      }, { headers });
    }

    // Store in cache
    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Prune stale cache entries (keep cache bounded)
    if (cache.size > 50) {
      const now = Date.now();
      for (const [key, entry] of cache) {
        if (now - entry.timestamp > CACHE_TTL_MS) {
          cache.delete(key);
        }
      }
    }

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/events/details]", message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : 500;
    const userMessage = message.includes("fetch failed")
      ? "Phoenix service unavailable — the ArcSight GWT-RPC endpoint is not responding."
      : message;
    return Response.json({ error: userMessage }, { status });
  }
}
