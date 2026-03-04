import { getConnectorDevices } from "@/lib/arcsight-client";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET() {
  try {
    const { data: devices, cookieHeader } = await withAuthRetry(async (auth) => {
      return getConnectorDevices(auth);
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(devices, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Graceful degradation: return empty map with warning instead of 500
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to fetch connector devices:", message);
    return Response.json(
      { warning: `Devices unavailable: ${message}` },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
