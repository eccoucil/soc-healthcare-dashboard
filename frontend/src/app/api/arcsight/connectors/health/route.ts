import { getConnectorHealth } from "@/lib/arcsight-client";
import { createServerCache } from "@/lib/server-cache";
import { withAuthRetry, AuthError } from "@/lib/session";

// 30s TTL — health is time-sensitive but 30s staleness is acceptable; halves ESM call rate
const healthCache = createServerCache(30_000);

export async function GET() {
  try {
    const { data: health, cookieHeader } = await withAuthRetry(async (auth) => {
      return healthCache.getOrFetch(() => getConnectorHealth(auth));
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(health, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
