import {
  getActiveChannelEvents,
  getActiveChannelEventsWithSubscription,
  getActiveChannelEventsRaw,
  probeBucketPolling,
  dumpResponseStructure,
} from "@/lib/arcsight-channel-client";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("raw") === "true";
  const probe = searchParams.get("probe") === "true";
  const dump = searchParams.get("dump") === "true";
  const channelId = searchParams.get("channelId") ?? undefined;
  // Use v2 subscription-aware flow by default, opt out with ?v1=true
  const useV1 = searchParams.get("v1") === "true";

  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      if (probe) {
        const probeResult = await probeBucketPolling(auth, channelId);
        const phase1Dump = dumpResponseStructure(probeResult.phase1.raw);
        const phase2Dump = "error" in probeResult.phase2
          ? null
          : dumpResponseStructure(probeResult.phase2.raw);
        return { ...probeResult, phase1Dump, phase2Dump };
      }
      if (dump) {
        const decoded = await getActiveChannelEventsRaw(auth, channelId);
        const structure = dumpResponseStructure(decoded);
        return { decoded, structure };
      }
      if (raw) {
        return getActiveChannelEventsRaw(auth, channelId);
      }

      // Default: subscription-aware flow (v2) with fallback to v1
      return !useV1 && channelId
        ? getActiveChannelEventsWithSubscription(auth, channelId)
        : getActiveChannelEvents(auth, channelId);
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/active]", message);
    const status = message.includes("fetch failed") || message.includes("abort") ? 503 : 500;
    const userMessage = message.includes("fetch failed")
      ? "Phoenix service unavailable — the ArcSight GWT-RPC endpoint is not responding. Check if the Phoenix UI application is running on the ESM server."
      : message;
    return Response.json({ error: userMessage }, { status });
  }
}
