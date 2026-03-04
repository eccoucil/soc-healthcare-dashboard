import { NextRequest } from "next/server";
import {
  retrieveEvents,
  getEventCount,
  getEventFieldInfoMap,
} from "@/lib/arcsight-client";
import { withAuthRetry, AuthError } from "@/lib/session";

/**
 * GET /api/arcsight/events
 *
 * Query params:
 *   - mode: "count" | "fields" | "retrieve" (default: "count")
 *   - startTime: epoch millis (default: 1 hour ago)
 *   - endTime: epoch millis (default: now)
 *   - ids: comma-separated event IDs (required for mode=retrieve)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const mode = searchParams.get("mode") ?? "count";
    const now = Date.now();
    const startTime = parseInt(
      searchParams.get("startTime") ?? String(now - 60 * 60 * 1000),
      10
    );
    const endTime = parseInt(
      searchParams.get("endTime") ?? String(now),
      10
    );

    if (mode === "retrieve") {
      const idsParam = searchParams.get("ids");
      if (!idsParam) {
        return Response.json(
          { error: "ids parameter required for mode=retrieve" },
          { status: 400 }
        );
      }
      const ids = idsParam.split(",").map((s) => parseInt(s.trim(), 10));
      if (ids.some(isNaN)) {
        return Response.json(
          { error: "ids must be comma-separated integers" },
          { status: 400 }
        );
      }

      const { data: events, cookieHeader } = await withAuthRetry(async (auth) => {
        return retrieveEvents(auth, { ids, startTime, endTime });
      });
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
      return Response.json(
        { events, count: events.length, startTime, endTime },
        { headers }
      );
    }

    if (mode === "fields") {
      const { data: fieldMap, cookieHeader } = await withAuthRetry(async (auth) => {
        return getEventFieldInfoMap(auth);
      });
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
      return Response.json(fieldMap, { headers });
    }

    if (mode === "count") {
      const { data: countResult, cookieHeader } = await withAuthRetry(async (auth) => {
        return getEventCount(auth, startTime, endTime);
      });
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
      return Response.json(
        { startTime, endTime, ...countResult },
        { headers }
      );
    }

    return Response.json(
      { error: `Unknown mode: ${mode}. Use count, fields, or retrieve.` },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/events]", message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : 500;
    return Response.json({ error: message }, { status });
  }
}
