import {
  setLiveChannels,
  pollLiveChannels,
  clearLiveChannels,
  getLiveChannelCount,
} from "@/lib/arcsight-channel-client";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");

  try {
    const { data, cookieHeader } = await withAuthRetry(async (auth) => {
      if (!idsParam) {
        // No IDs provided — poll existing live channels (if any)
        const channels = await pollLiveChannels(auth);
        return { channels, liveCount: getLiveChannelCount() };
      }

      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10);

      if (ids.length === 0) {
        return { error: "No valid channel IDs provided", _status: 400 as const };
      }

      // setLiveChannels handles diffing internally — only closes/opens what changed
      const channels = await setLiveChannels(auth, ids);
      return { channels, liveCount: getLiveChannelCount() };
    });

    // Handle validation error returned from inside withAuthRetry
    if (data && typeof data === "object" && "_status" in data) {
      const { _status, ...rest } = data as { _status: number; error: string };
      return Response.json(rest, { status: _status });
    }

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(data, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/live]", message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE() {
  try {
    const { cookieHeader } = await withAuthRetry(async (auth) => {
      await clearLiveChannels(auth);
      return { cleared: true };
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json({ cleared: true }, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/live] DELETE error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
