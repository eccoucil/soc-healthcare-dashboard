import { NextRequest } from "next/server";
import {
  retrieveEvents,
  getEventCount,
  getEventFieldInfoMap,
} from "@/lib/arcsight-client";

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

    if (mode === "fields") {
      const fieldMap = await getEventFieldInfoMap();
      return Response.json(fieldMap, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (mode === "count") {
      const countResult = await getEventCount(startTime, endTime);
      return Response.json(
        { startTime, endTime, ...countResult },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

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
      const events = await retrieveEvents({ ids, startTime, endTime });
      return Response.json(
        { events, count: events.length, startTime, endTime },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return Response.json(
      { error: `Unknown mode: ${mode}. Use count, fields, or retrieve.` },
      { status: 400 }
    );
  } catch (error) {
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
