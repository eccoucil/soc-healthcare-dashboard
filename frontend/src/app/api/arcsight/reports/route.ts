import { getAllReports } from "@/lib/arcsight-channel-client";

export async function GET() {
  try {
    const result = await getAllReports();
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
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
