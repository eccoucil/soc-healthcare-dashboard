import { getAllActiveChannels, debugGetRootGroups, debugGetChannelsForGroup } from "@/lib/arcsight-channel-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "true";
  const debugGroup = searchParams.get("debugGroup");

  try {
    if (debug) {
      const raw = await debugGetRootGroups();
      return Response.json(raw, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (debugGroup) {
      const raw = await debugGetChannelsForGroup(debugGroup);
      return Response.json(raw, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const result = await getAllActiveChannels();
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/list]", message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : 500;
    return Response.json({ error: message }, { status });
  }
}
