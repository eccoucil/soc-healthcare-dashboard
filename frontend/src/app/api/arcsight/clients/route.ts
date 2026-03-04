import { NextRequest } from "next/server";
import { getHybridClients } from "@/lib/arcsight-client";
import { createServerCache } from "@/lib/server-cache";
import { withAuthRetry, AuthError } from "@/lib/session";

// 60s TTL — client list changes very rarely (admin-only operations)
const clientsCache = createServerCache(60_000);

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    // Cache only the unfiltered list; search queries are user-initiated and infrequent
    const { data: clients, cookieHeader } = await withAuthRetry(async (auth) => {
      return search
        ? await getHybridClients(auth, search)
        : await clientsCache.getOrFetch(() => getHybridClients(auth));
    });
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(clients, { headers });
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
