import { NextRequest, NextResponse } from "next/server";
import { searchEvents, getEventCount } from "@/lib/arcsight-query-client";
import {
  scanAllChannelEventsWithSubscription,
  getActiveChannelEventsWithSubscription,
} from "@/lib/arcsight-channel-client";
import { withAuthRetry, AuthError } from "@/lib/session";

const DEFAULT_FIELDS = [
  "name",
  "deviceHostName",
  "customerName",
  "deviceVendor",
  "deviceProduct",
  "agentName",
  "message",
  "endTime",
  "managerReceiptTime",
  "severity",
];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filter = params.get("filter");
  const channelName = params.get("channelName");
  const channelId = params.get("channelId");

  if (!filter && !channelName && !channelId) {
    return NextResponse.json(
      {
        error: "Provide one of: 'filter', 'channelName', or 'channelId'",
        examples: {
          byFilter:
            "/api/arcsight/events/search?filter=%27deviceProduct%27+EQ+%22FortiGate%22&minutes=5",
          byChannelName:
            "/api/arcsight/events/search?channelName=Fortigate+Firewall+HYD",
          byChannelId:
            "/api/arcsight/events/search?channelId=QXODzNoQBABCASlG41bMayQ==",
        },
      },
      { status: 400 }
    );
  }

  const limit = Math.min(
    Math.max(parseInt(params.get("limit") ?? "200", 10) || 200, 1),
    10000
  );
  const minutes = Math.max(
    parseInt(params.get("minutes") ?? "5", 10) || 5,
    1
  );

  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      // --- Path 1: Direct channel ID ---
      if (channelId) {
        const chResult = await getActiveChannelEventsWithSubscription(auth, channelId);
        return { _path: "channelId" as const, result: chResult };
      }

      // --- Path 2: Channel name search ---
      if (channelName) {
        const scan = await scanAllChannelEventsWithSubscription(auth);
        const match = scan.results?.find(
          (ch: { channelName?: string; displayName?: string }) => {
            const name = ch.channelName ?? ch.displayName ?? "";
            return name.toLowerCase().includes(channelName.toLowerCase());
          }
        );

        if (!match) {
          return {
            _path: "notFound" as const,
            error: `No channel matching "${channelName}" found`,
            availableChannels: scan.results?.map(
              (ch: { channelName?: string; channelId?: string }) => ({
                name: ch.channelName,
                id: ch.channelId,
              })
            ),
          };
        }

        const chId = (match as { channelId?: string }).channelId;
        if (chId) {
          const chResult = await getActiveChannelEventsWithSubscription(auth, chId);
          return {
            _path: "channelName" as const,
            result: {
              ...chResult,
              channelName: (match as { channelName?: string }).channelName,
              channelId: chId,
            },
          };
        }

        // channelName matched but no channelId — fall through
        return { _path: "noChannelId" as const };
      }

      // --- Path 3: Filter expression -> QueryService search ---
      if (filter) {
        const now = Date.now();
        const timeRange = {
          startTime: now - minutes * 60 * 1000,
          endTime: now,
        };
        const fields =
          params.get("fields")?.split(",").filter(Boolean) ?? DEFAULT_FIELDS;

        const searchResult = await searchEvents(auth, filter, fields, limit, timeRange);

        // If searchEvents returned empty (QueryService not available),
        // add event count context so caller knows events exist.
        if (searchResult.events.length === 0) {
          const count = await getEventCount(
            auth,
            timeRange.startTime,
            timeRange.endTime
          ).catch(() => null);

          return {
            _path: "filterEmpty" as const,
            result: {
              ...searchResult,
              info:
                "QueryService/executeSearch is not available on this ESM version. " +
                "Use ?channelName= or ?channelId= to get events via Active Channels.",
              eventCountInRange: count?.events ?? null,
            },
          };
        }

        return { _path: "filter" as const, result: searchResult };
      }

      return { _path: "unexpected" as const };
    });

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;

    // Route the response based on the path taken
    if (result._path === "notFound") {
      const { _path, ...rest } = result;
      void _path;
      return NextResponse.json(rest, { status: 404 });
    }
    if (result._path === "unexpected" || result._path === "noChannelId") {
      return NextResponse.json({ error: "Unexpected state" }, { status: 500 });
    }
    return NextResponse.json(result.result, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/events/search]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
