import {
  getActiveChannelEvents,
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

  try {
    if (probe) {
      const result = await probeBucketPolling(channelId);
      // Attach dump annotations to both phases
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
    const result = await getActiveChannelEvents(channelId);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/active]", message);
    // Return 503 for transient errors (network/auth), 500 for others
    const status = message.includes("fetch failed") || message.includes("abort") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
