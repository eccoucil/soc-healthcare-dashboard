import { downloadReport } from "@/lib/arcsight-channel-client";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: archiveId } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "PDF";

  try {
    const result = await downloadReport(archiveId);

    // For non-text formats, return as a download
    if (format === "PDF") {
      return new Response(result.content, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="report-${archiveId.slice(0, 8)}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "CSV") {
      return new Response(result.content, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="report-${archiveId.slice(0, 8)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // HTML and other text formats
    return new Response(result.content, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[api/reports/${archiveId}/download]`, message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : message.includes("strong name not configured")
          ? 501
          : 500;
    return Response.json({ error: message }, { status });
  }
}
