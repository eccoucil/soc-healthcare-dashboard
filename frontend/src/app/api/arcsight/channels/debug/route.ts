import { getChannelDebugResponse } from "@/lib/arcsight-channel-client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resourceId = searchParams.get("resourceId") ?? undefined;

  try {
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
