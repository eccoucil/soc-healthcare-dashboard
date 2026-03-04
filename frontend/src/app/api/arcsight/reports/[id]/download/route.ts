import { downloadReport } from "@/lib/arcsight-channel-client";
import { NextRequest } from "next/server";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: archiveId } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") ?? "PDF";

    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      return downloadReport(auth, archiveId);
    });

    // For non-text formats, return as a download
    if (format === "PDF") {
      const headers: Record<string, string> = {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report-${archiveId.slice(0, 8)}.pdf"`,
        "Cache-Control": "no-store",
      };
      if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
      return new Response(result.content, { headers });
    }

    if (format === "CSV") {
      const headers: Record<string, string> = {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="report-${archiveId.slice(0, 8)}.csv"`,
        "Cache-Control": "no-store",
      };
      if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
      return new Response(result.content, { headers });
    }

    // HTML and other text formats
    const headers: Record<string, string> = {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
    };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return new Response(result.content, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[api/reports/download]`, message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : message.includes("strong name not configured")
          ? 501
          : 500;
    return Response.json({ error: message }, { status });
  }
}
