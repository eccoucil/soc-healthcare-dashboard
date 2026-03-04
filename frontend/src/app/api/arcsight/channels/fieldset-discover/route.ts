import { discoverFieldSetId } from "@/lib/arcsight-channel-client";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET() {
  try {
    const { data: fieldSetId, cookieHeader } = await withAuthRetry(async (auth) => {
      return discoverFieldSetId(auth);
    });
    const envVar = process.env.ARCSIGHT_FIELD_SET_ID || null;
    const path = process.env.ARCSIGHT_FIELD_SET_PATH || "/All Field Sets/FORTRESS/Device Monitoring";

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(
      {
        fieldSetId,
        path,
        envVar,
        source: envVar ? "env" : fieldSetId ? "discovery" : "none",
      },
      { headers }
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/fieldset-discover]", message);
    const status =
      message.includes("fetch failed") || message.includes("abort")
        ? 503
        : 500;
    return Response.json({ error: message }, { status });
  }
}
