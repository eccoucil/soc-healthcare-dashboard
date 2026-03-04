import { getAllConnectors } from "@/lib/arcsight-client";
import { withAuthRetry, AuthError } from "@/lib/session";

export async function GET() {
  try {
    const { data: connectors, cookieHeader } = await withAuthRetry(async (auth) => {
      return getAllConnectors(auth);
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(connectors, { headers });
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
