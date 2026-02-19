import {
  getChannelDebugResponse,
  probeBucketPolling,
} from "@/lib/arcsight-channel-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resourceId = searchParams.get("resourceId") ?? undefined;
  const probe = searchParams.get("probe") === "true";

  try {
    if (probe) {
      const result = await probeBucketPolling(resourceId);
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const result = await getChannelDebugResponse(resourceId);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
