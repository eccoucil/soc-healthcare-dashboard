import { getAllClients } from "@/lib/arcsight-client";
import { getClientTree } from "@/lib/arcsight-channel-client";
import { withAuthRetry, AuthError } from "@/lib/session";

/**
 * Diagnostic endpoint: compare REST API customers vs channel tree folders.
 * GET /api/arcsight/clients/compare
 */
export async function GET() {
  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      const [restClients, treeRoot] = await Promise.all([
        getAllClients(auth).catch((err) => {
          return { error: err.message, clients: [] as { name: string; resourceId: string }[] };
        }),
        getClientTree(auth, "FORTRESS").catch((err) => {
          return { error: err.message };
        }),
      ]);

      // Extract REST client names
      const restNames = Array.isArray(restClients)
        ? restClients.map((c) => ({ name: c.name, resourceId: c.resourceId }))
        : restClients.clients;
      const restError = !Array.isArray(restClients) ? restClients.error : undefined;

      // Extract tree client names (depth 2: FORTRESS → Device Monitoring → CLIENT)
      const treeNames: { name: string; resourceId: string }[] = [];
      let treeError: string | undefined;
      if ("error" in treeRoot && typeof treeRoot.error === "string") {
        treeError = treeRoot.error;
      } else if ("children" in treeRoot) {
        for (const child of treeRoot.children) {
          for (const clientNode of child.children) {
            treeNames.push({ name: clientNode.name, resourceId: clientNode.resourceId });
          }
        }
      }

      // Compute sets
      const restSet = new Set(restNames.map((c) => c.name.toLowerCase()));
      const treeSet = new Set(treeNames.map((c) => c.name.toLowerCase()));

      return {
        rest: { clients: restNames, count: restNames.length, error: restError },
        tree: { clients: treeNames, count: treeNames.length, error: treeError },
        restOnly: restNames.filter((c) => !treeSet.has(c.name.toLowerCase())),
        treeOnly: treeNames.filter((c) => !restSet.has(c.name.toLowerCase())),
        matched: restNames.filter((c) => treeSet.has(c.name.toLowerCase())),
      };
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
