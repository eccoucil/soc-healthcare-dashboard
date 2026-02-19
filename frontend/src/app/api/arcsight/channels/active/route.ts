import {
  getActiveChannelEvents,
  getActiveChannelEventsWithSubscription,
  getActiveChannelEventsRaw,
  probeBucketPolling,
  dumpResponseStructure,
} from "@/lib/arcsight-channel-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("raw") === "true";
  const probe = searchParams.get("probe") === "true";
  const dump = searchParams.get("dump") === "true";
  const channelId = searchParams.get("channelId") ?? undefined;
  // Use v2 subscription-aware flow by default, opt out with ?v1=true
  const useV1 = searchParams.get("v1") === "true";

  try {
    if (probe) {
      const result = await probeBucketPolling(channelId);
      const phase1Dump = dumpResponseStructure(result.phase1.raw);
      const phase2Dump = "error" in result.phase2
        ? null
        : dumpResponseStructure(result.phase2.raw);
      return Response.json({ ...result, phase1Dump, phase2Dump }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (dump) {
      const decoded = await getActiveChannelEventsRaw(channelId);
      const structure = dumpResponseStructure(decoded);
      return Response.json({ decoded, structure }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (raw) {
      const decoded = await getActiveChannelEventsRaw(channelId);
      return Response.json(decoded, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // Default: subscription-aware flow (v2) with fallback to v1
    const result = !useV1 && channelId
      ? await getActiveChannelEventsWithSubscription(channelId)
      : await getActiveChannelEvents(channelId);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
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
