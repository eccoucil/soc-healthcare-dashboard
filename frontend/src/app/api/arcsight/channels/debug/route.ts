import {
  getChannelDebugResponse,
  probeBucketPolling,
} from "@/lib/arcsight-channel-client";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resourceId = searchParams.get("resourceId") ?? undefined;
  const probe = searchParams.get("probe") === "true";

  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      if (probe) {
        return probeBucketPolling(auth, resourceId);
      }
      return getChannelDebugResponse(auth, resourceId);
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
