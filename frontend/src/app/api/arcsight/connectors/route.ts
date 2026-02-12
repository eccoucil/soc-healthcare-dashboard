import { getAllConnectors } from "@/lib/arcsight-client";

export async function GET() {
  try {
    const connectors = await getAllConnectors();
    return Response.json(connectors, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
