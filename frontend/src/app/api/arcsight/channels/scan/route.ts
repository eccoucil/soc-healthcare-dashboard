import {
  scanAllChannelEvents,
  scanAllChannelEventsWithSubscription,
  getScanProgress,
  loginToPhoenix,
} from "@/lib/arcsight-channel-client";
import { createServerCache } from "@/lib/server-cache";
import { withAuthRetry, AuthError, getSession } from "@/lib/session";

// 10-minute cache — prevents rapid re-scanning that accumulates ESM channel slots.
// Scans for 20+ channels can take 70-135s; 600s TTL significantly reduces ESM load
// while scan results (including latestManagerReceiptTime) remain relevant for minutes.
const scanCacheV1 = createServerCache(600_000);
const scanCacheV2 = createServerCache(600_000);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Progressive scan progress: return partial results without blocking
  if (searchParams.get("progress") === "true") {
    const progress = getScanProgress();
    return Response.json(progress ?? { inProgress: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Use v2 subscription-aware scan by default, opt out with ?v1=true
  const useV1 = searchParams.get("v1") === "true";
  // Bypass cache with ?fresh=true — useful for debugging stale-cache issues
  const fresh = searchParams.get("fresh") === "true";

  try {
    // Get stored credentials for fresh Phoenix logins between scan windows.
    // Without this, all windows share one session and hit MaxChannelExceededException
    // after the first window fills all 10 channel slots (stopViewChannel is broken on this ESM).
    const session = await getSession();
    const freshPhoenixLogin = session
      ? () => loginToPhoenix(session.username, session.password)
      : undefined;

    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      if (fresh) {
        console.log("[api/channels/scan] Cache bypass (fresh=true)");
        const freshResult = useV1
          ? await scanAllChannelEvents(auth)
          : await scanAllChannelEventsWithSubscription(auth, freshPhoenixLogin);
        // Update cache with fresh result
        if (useV1) scanCacheV1.set(freshResult);
        else scanCacheV2.set(freshResult);
        return freshResult;
      }
      return useV1
        ? await scanCacheV1.getOrFetch(() => scanAllChannelEvents(auth))
        : await scanCacheV2.getOrFetch(() =>
            scanAllChannelEventsWithSubscription(auth, freshPhoenixLogin)
          );
    });

    // Diagnostic: scan results summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (result as any)?.results;
    if (Array.isArray(results)) {
      console.log(`[api/channels/scan] Scan completed: ${results.length} channels`);
      if (results.length > 0) {
        console.log(`[api/channels/scan] Sample channelIds:`, results.slice(0, 3).map(r => ({
          channelId: r.channelId,
          channelName: r.channelName,
          hasEvents: r.hasEvents,
          eventCount: r.eventCount,
          latestMrt: r.latestManagerReceiptTime
        })));
      } else {
        console.warn(`[api/channels/scan] Scan returned EMPTY results array!`);
      }
      // Log channels with events but no timestamp
      for (const scanResult of results) {
        if (scanResult.hasEvents && scanResult.latestManagerReceiptTime === null) {
          console.warn(
            `[scan] Channel ${scanResult.channelId} has ${scanResult.eventCount} events but null latestManagerReceiptTime. ` +
            `Fields: ${scanResult.fieldNames?.join(", ") || "none"}. ` +
            `FilterOnly: ${scanResult.isFilterExpressionOnly}`
          );
        }
      }
    } else {
      console.error(`[api/channels/scan] Scan returned unexpected result shape:`, typeof result);
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
    console.error("[api/channels/scan]", message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : 500;
    const userMessage = message.includes("fetch failed")
      ? "Phoenix service unavailable — the ArcSight GWT-RPC endpoint is not responding. Check if the Phoenix UI application is running on the ESM server."
      : message;
    return Response.json({ error: userMessage }, { status });
  }
}
