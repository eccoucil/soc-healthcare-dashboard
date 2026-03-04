import { NextResponse } from "next/server";
import {
  getFullConnectorViaManager,
  getAllConnectorMetadataViaManager,
} from "@/lib/arcsight-query-client";
import {
  getAllConnectorIds,
  getConnectorsByIds,
  getConnectorDevices,
} from "@/lib/arcsight-client";
import { withAuthRetry, AuthError } from "@/lib/session";

/**
 * GET /api/arcsight/connectors/agent-fields
 *
 * Diagnostic endpoint: fetches full connector metadata from both APIs
 * to identify which fields are available (hostName, address, etc.).
 *
 * Query params:
 *   ?limit=N  — max connectors to fetch full details for (default 5)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "5"), 20);

  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      // Parallel: DETECT API connector list + Manager Service metadata + device map
      const [detectIds, managerMetadata, deviceMap] = await Promise.all([
        getAllConnectorIds(auth).catch((err) => {
          console.warn("[agent-fields] DETECT API getAllConnectorIds failed:", err instanceof Error ? err.message : err);
          return [] as string[];
        }),
        getAllConnectorMetadataViaManager(auth).catch((err) => {
          console.warn("[agent-fields] Manager metadata failed:", err instanceof Error ? err.message : err);
          return new Map<string, { name: string; hostName?: string; address?: string }>();
        }),
        getConnectorDevices(auth).catch((err) => {
          console.warn("[agent-fields] Device map failed:", err instanceof Error ? err.message : err);
          return {} as Record<string, { deviceVendor: string; deviceProduct: string }[]>;
        }),
      ]);

      // Fetch DETECT API connector details (limited)
      const detectConnectors = detectIds.length > 0
        ? await getConnectorsByIds(auth, detectIds.slice(0, limit)).catch(() => [])
        : [];

      // Fetch full Manager Service resource for a few connectors (for field discovery)
      const managerIds = [...managerMetadata.keys()].slice(0, limit);
      const fullManagerResources = await Promise.all(
        managerIds.map(async (id) => {
          const resource = await getFullConnectorViaManager(auth, id).catch(() => null);
          return { id, resource };
        })
      );

      // Build summary
      const managerSummary = [...managerMetadata.entries()].map(([id, meta]) => ({
        resourceId: id,
        name: meta.name,
        hostName: meta.hostName ?? null,
        address: meta.address ?? null,
        devices: deviceMap[id]?.map(d => `${d.deviceVendor}/${d.deviceProduct}`) ?? [],
      }));

      return {
        detectApi: {
          totalConnectorIds: detectIds.length,
          sampleConnectors: detectConnectors.map((c) => ({
            resourceId: c.resourceId,
            name: c.name,
            hostName: c.hostName ?? null,
            address: c.address ?? null,
            networks: c.networks ?? [],
            operationalStatus: c.operationalStatus,
            alive: c.alive,
          })),
        },
        managerService: {
          totalConnectors: managerMetadata.size,
          summary: managerSummary,
          fullResources: fullManagerResources
            .filter((r) => r.resource)
            .map((r) => ({
              resourceId: r.id,
              allFields: Object.keys(r.resource!),
              resource: r.resource,
            })),
        },
        deviceMap: {
          totalConnectorsWithDevices: Object.keys(deviceMap).length,
          totalDevices: Object.values(deviceMap).reduce((sum, d) => sum + d.length, 0),
        },
      };
    });

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[agent-fields] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
