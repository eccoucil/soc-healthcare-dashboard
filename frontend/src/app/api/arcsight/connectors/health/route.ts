import { getConnectorHealth } from "@/lib/arcsight-client";

export async function GET() {
  try {
    const health = await getConnectorHealth();
    return Response.json(health, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
