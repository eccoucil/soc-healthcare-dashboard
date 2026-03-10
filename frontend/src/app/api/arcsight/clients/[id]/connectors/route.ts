import {
  getConnectorsForClient,
  linkConnectorsToClient,
  unlinkConnectorsFromClient,
} from "@/lib/arcsight-client";
import type { LinkConnectorsRequest } from "@/types/arcsight";
import { createServerCache } from "@/lib/server-cache";
import { withAuthRetry, AuthError } from "@/lib/session";

// 60s TTL per client — the 4-step hierarchy traversal is expensive (includes 45s-timeout device call)
const cacheById = new Map<string, ReturnType<typeof createServerCache>>();

function getCacheForClient(id: string) {
  let cache = cacheById.get(id);
  if (!cache) {
    // Evict all entries when map grows beyond normal usage (2-3 clients)
    if (cacheById.size >= 50) cacheById.clear();
    cache = createServerCache(60_000);
    cacheById.set(id, cache);
  }
  return cache;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: connectors, cookieHeader } = await withAuthRetry(async (auth) => {
      return getCacheForClient(id).getOrFetch(() =>
        getConnectorsForClient(auth, id)
      );
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as LinkConnectorsRequest;

    if (!Array.isArray(body.connectorIds) || body.connectorIds.length === 0) {
      return Response.json(
        { error: "connectorIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const { cookieHeader } = await withAuthRetry(async (auth) => {
      await linkConnectorsToClient(auth, id, body.connectorIds);
      return null;
    });
    const headers: Record<string, string> = {};
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return new Response(null, { status: 204, headers });
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as LinkConnectorsRequest;

    if (!Array.isArray(body.connectorIds) || body.connectorIds.length === 0) {
      return Response.json(
        { error: "connectorIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const { cookieHeader } = await withAuthRetry(async (auth) => {
      await unlinkConnectorsFromClient(auth, id, body.connectorIds);
      return null;
    });
    const headers: Record<string, string> = {};
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return new Response(null, { status: 204, headers });
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
