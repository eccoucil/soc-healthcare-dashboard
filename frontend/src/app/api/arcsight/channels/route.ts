import { getViewableData } from "@/lib/arcsight-channel-client";

export async function GET() {
  try {
    const result = await getViewableData();
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
