import { getReportById } from "@/lib/arcsight-channel-client";
import { NextRequest } from "next/server";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: report, cookieHeader } = await withAuthRetry(async (auth) => {
      return getReportById(auth, id);
    });
    if (!report) {
      return Response.json({ error: "Report not found" }, { status: 404 });
    }
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(report, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[api/reports]`, message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : message.includes("strong name not configured")
          ? 501
          : 500;
    return Response.json({ error: message }, { status });
  }
}
