import { getClientTree } from "@/lib/arcsight-channel-client";
import { createServerCache } from "@/lib/server-cache";
import { withAuthRetry, AuthError } from "@/lib/session";

// 300s TTL — tree structure changes rarely (admin-only operations)
const cacheByRoot = new Map<string, ReturnType<typeof createServerCache>>();

function getCacheForRoot(root: string) {
  let cache = cacheByRoot.get(root);
  if (!cache) {
    // Evict all entries when map grows beyond normal usage (1-2 roots)
    if (cacheByRoot.size >= 10) cacheByRoot.clear();
    cache = createServerCache(300_000);
    cacheByRoot.set(root, cache);
  }
  return cache;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const root = searchParams.get("root") ?? undefined;

  try {
    const cache = getCacheForRoot(root ?? "");
    const { data: tree, cookieHeader } = await withAuthRetry(async (auth) => {
      return cache.getOrFetch(() => getClientTree(auth, root));
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(tree, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/tree]", message);
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
