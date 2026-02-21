import { getClientTree } from "@/lib/arcsight-channel-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const root = searchParams.get("root") ?? undefined;

  try {
    const tree = await getClientTree(root);
    return Response.json(tree, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
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
