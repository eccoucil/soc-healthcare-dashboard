import {
  scanAllChannelEvents,
  scanAllChannelEventsWithSubscription,
} from "@/lib/arcsight-channel-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Use v2 subscription-aware scan by default, opt out with ?v1=true
  const useV1 = searchParams.get("v1") === "true";

  try {
    const result = useV1
      ? await scanAllChannelEvents()
      : await scanAllChannelEventsWithSubscription();
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
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
