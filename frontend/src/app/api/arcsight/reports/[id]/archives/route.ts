import { getArchivedReports } from "@/lib/arcsight-channel-client";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const archives = await getArchivedReports(id);
    return Response.json({ archives }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[api/reports/${id}/archives]`, message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : message.includes("strong name not configured")
          ? 501
          : 500;
    return Response.json({ error: message }, { status });
  }
}
