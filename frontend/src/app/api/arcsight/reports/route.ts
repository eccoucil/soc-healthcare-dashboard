import { getAllReports } from "@/lib/arcsight-channel-client";
import { createServerCache } from "@/lib/server-cache";
import { withAuthRetry, AuthError } from "@/lib/session";

// 300s (5 min) TTL — report definitions are semi-static
const reportsCache = createServerCache(300_000);

export async function GET() {
  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      return reportsCache.getOrFetch(() => getAllReports(auth));
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
    console.error("[api/reports]", message);
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
