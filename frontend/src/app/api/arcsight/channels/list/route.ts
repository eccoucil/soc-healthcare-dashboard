import { getAllActiveChannels, debugGetRootGroups, debugGetChannelsForGroup } from "@/lib/arcsight-channel-client";
import { createServerCache } from "@/lib/server-cache";
import { withAuthRetry, AuthError } from "@/lib/session";

// 300s TTL — matches tree route since they call the same underlying walk
const listCache = createServerCache(300_000);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get("debug") === "true";
  const debugGroup = searchParams.get("debugGroup");

  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      // Debug endpoints bypass cache
      if (debug) {
        return debugGetRootGroups(auth);
      }
      if (debugGroup) {
        return debugGetChannelsForGroup(auth, debugGroup);
      }
      return listCache.getOrFetch(() => getAllActiveChannels(auth));
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
    console.error("[api/channels/list]", message);
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
