import "server-only";
import {
  createArcsightDispatcher,
  getProxyInfo,
} from "@/lib/arcsight-dispatcher";
import type { SessionAuth } from "@/lib/session";
import type {
  Client,
  Connector,
  ConnectorDeviceMap,
  ConnectorWithDevices,
  ConnectorHealth,
  ConnectorHealthDetail,
  ConnectorHealthEnriched,
} from "@/types/arcsight";

const BASE_URL = process.env.ARCSIGHT_API_BASE_URL;
const LOGIN_URL = process.env.ARCSIGHT_LOGIN_URL;

// Connection pool for ArcSight REST API — routes through proxy if configured.
const dispatcher = createArcsightDispatcher({
  connections: 6,
  pipelining: 1,
  connectTimeout: 15_000,
});
console.log(`[arcsight-client] Proxy: ${getProxyInfo()}`);

// --- Login (called by auth login route) ---

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Authenticate with ArcSight ESM REST API.
 * Returns a REST token usable across core-service and manager-service.
 */
export async function loginToArcsight(
  username: string,
  password: string
): Promise<string> {
  if (!LOGIN_URL) {
    throw new Error(
      "ArcSight login not configured. Set ARCSIGHT_LOGIN_URL in .env.local"
    );
  }

  console.log("[arcsight-login] Authenticating...");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `login=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(
      `ArcSight login failed: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();
  const token = data?.["log.loginResponse"]?.["log.return"];

  if (!token || typeof token !== "string") {
    throw new Error(
      "ArcSight login response missing token. Got: " +
        JSON.stringify(data).slice(0, 200)
    );
  }

  console.log("[arcsight-login] Authenticated successfully");
  return token;
}

// --- Generic fetch wrapper ---

async function arcsightFetch<T>(
  token: string,
  path: string,
  revalidate = 30,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  if (!BASE_URL) {
    throw new Error(
      "ArcSight API not configured. Set ARCSIGHT_API_BASE_URL in .env.local"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      next: { revalidate },
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher,
    });

    if (res.status === 401) {
      throw new Error(`ArcSight API error: 401 Unauthorized`);
    }

    if (!res.ok) {
      throw new Error(`ArcSight API error: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

async function arcsightPost(
  token: string,
  path: string,
  body: unknown
): Promise<void> {
  if (!BASE_URL) {
    throw new Error(
      "ArcSight API not configured. Set ARCSIGHT_API_BASE_URL in .env.local"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher,
    });

    if (res.status === 401) {
      throw new Error(`ArcSight API error: 401 Unauthorized`);
    }

    if (!res.ok) {
      throw new Error(`ArcSight API error: ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function arcsightPostJson<T>(
  token: string,
  path: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  if (!BASE_URL) {
    throw new Error(
      "ArcSight API not configured. Set ARCSIGHT_API_BASE_URL in .env.local"
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher,
    });

    if (res.status === 401) {
      throw new Error(`ArcSight API error: 401 Unauthorized`);
    }

    if (!res.ok) {
      throw new Error(`ArcSight API error: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// --- Client methods (ArcSight "Customer" resources) ---

export async function getAllClientIds(auth: SessionAuth): Promise<string[]> {
  return arcsightFetch<string[]>(auth.restToken, "/v1/customers/allIds", 60);
}

export async function getClientsByIds(auth: SessionAuth, ids: string[]): Promise<Client[]> {
  const params = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
  return arcsightFetch<Client[]>(auth.restToken, `/v1/customers/ids?${params}`, 60);
}

export async function getClientById(auth: SessionAuth, id: string): Promise<Client> {
  return arcsightFetch<Client>(auth.restToken, `/v1/customers/${encodeURIComponent(id)}`);
}

export async function getClientPathsToRoot(auth: SessionAuth, id: string): Promise<string[]> {
  return arcsightFetch<string[]>(
    auth.restToken,
    `/v1/customers/${encodeURIComponent(id)}/allPathsToRoot`
  );
}

// --- Connector methods ---

export async function getConnectorDevices(
  auth: SessionAuth,
  timeoutMs = 45_000
): Promise<ConnectorDeviceMap> {
  return arcsightFetch<ConnectorDeviceMap>(
    auth.restToken,
    "/v1/connectors/devices",
    30,
    timeoutMs
  );
}

export async function getConnectorsByIds(auth: SessionAuth, ids: string[]): Promise<Connector[]> {
  const params = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
  return arcsightFetch<Connector[]>(auth.restToken, `/v1/connectors/ids?${params}`);
}

export async function getLiveConnectorIds(auth: SessionAuth): Promise<string[]> {
  return arcsightFetch<string[]>(auth.restToken, "/v1/connectors/live", 10);
}

export async function getDeadConnectorIds(auth: SessionAuth): Promise<string[]> {
  return arcsightFetch<string[]>(auth.restToken, "/v1/connectors/dead", 10);
}

// --- Group methods ---

export async function getGroupChildren(auth: SessionAuth, groupId: string): Promise<string[]> {
  return arcsightFetch<string[]>(
    auth.restToken,
    `/v1/groups/${encodeURIComponent(groupId)}/children`
  );
}

// --- Connector listing methods ---

export async function getAllConnectorIds(auth: SessionAuth): Promise<string[]> {
  return arcsightFetch<string[]>(auth.restToken, "/v1/connectors/allIds", 60);
}

export async function getAllConnectors(auth: SessionAuth): Promise<Connector[]> {
  const ids = await getAllConnectorIds(auth);
  if (ids.length === 0) return [];

  const batchSize = 50;
  const all: Connector[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await getConnectorsByIds(auth, ids.slice(i, i + batchSize));
    all.push(...batch);
  }
  return all;
}

// --- Connector-client linking methods ---

async function getClientParentGroupId(auth: SessionAuth, clientId: string): Promise<string> {
  const paths = await getClientPathsToRoot(auth, clientId);
  if (paths.length === 0) {
    throw new Error("Client has no parent group");
  }
  return paths[0];
}

export async function linkConnectorsToClient(
  auth: SessionAuth,
  clientId: string,
  connectorIds: string[]
): Promise<void> {
  const groupId = await getClientParentGroupId(auth, clientId);
  await arcsightPost(
    auth.restToken,
    `/v1/groups/${encodeURIComponent(groupId)}/children`,
    connectorIds
  );
}

export async function unlinkConnectorsFromClient(
  auth: SessionAuth,
  clientId: string,
  connectorIds: string[]
): Promise<void> {
  const groupId = await getClientParentGroupId(auth, clientId);
  await arcsightPost(
    auth.restToken,
    `/v1/groups/${encodeURIComponent(groupId)}/removeChildren`,
    connectorIds
  );
}

// --- Composite methods ---

/**
 * Get connectors (with devices) associated with a client.
 *
 * ArcSight has no direct "devices per client" endpoint. We bridge this
 * by traversing the group hierarchy:
 *   1. Get group paths for the client
 *   2. Get children of the immediate parent group
 *   3. Fetch those children as connectors
 *   4. Attach device details from the connector-devices map
 */
export async function getConnectorsForClient(
  auth: SessionAuth,
  clientId: string
): Promise<ConnectorWithDevices[]> {
  const tag = `[getConnectorsForClient ${clientId}]`;

  const paths = await getClientPathsToRoot(auth, clientId);
  console.log(`${tag} Step 1 — allPathsToRoot: ${JSON.stringify(paths)}`);

  if (paths.length === 0) {
    console.log(`${tag} No parent group found — returning []`);
    return [];
  }

  // paths[0] is slash-delimited: "root/.../parentGroup/client"
  const segments = paths[0].split("/");
  if (segments.length < 2) {
    console.log(`${tag} Client is at root level — no parent group`);
    return [];
  }
  const parentGroupId = segments[segments.length - 2];
  const childIds = await getGroupChildren(auth, parentGroupId);
  console.log(
    `${tag} Step 2 — group ${parentGroupId} children (${childIds.length}): ${JSON.stringify(childIds.slice(0, 10))}${childIds.length > 10 ? "…" : ""}`
  );

  if (childIds.length === 0) {
    console.log(`${tag} Group has no children — returning []`);
    return [];
  }

  // Fetch connector details and device map in parallel
  const [connectors, deviceMap] = await Promise.all([
    getConnectorsByIds(auth, childIds).catch((err) => {
      console.error(`${tag} Step 3 — getConnectorsByIds FAILED:`, err);
      return [] as Connector[];
    }),
    getConnectorDevices(auth).catch((err) => {
      console.error(`${tag} Step 4 — getConnectorDevices FAILED:`, err);
      return {} as ConnectorDeviceMap;
    }),
  ]);

  console.log(
    `${tag} Step 3 — connectors returned: ${connectors.length}`,
    `| Step 4 — deviceMap keys: ${Object.keys(deviceMap).length}`
  );

  return connectors.map((connector) => ({
    ...connector,
    devices: deviceMap[connector.resourceId] ?? [],
  }));
}

/** Aggregated connector health status */
export async function getConnectorHealth(auth: SessionAuth): Promise<ConnectorHealth> {
  const [live, dead] = await Promise.all([
    getLiveConnectorIds(auth),
    getDeadConnectorIds(auth),
  ]);

  return {
    live,
    dead,
    total: live.length + dead.length,
  };
}

/** Enriched connector health: full details tagged with live/dead status */
export async function getConnectorHealthDetailed(auth: SessionAuth): Promise<ConnectorHealthEnriched> {
  const [health, connectors] = await Promise.all([
    getConnectorHealth(auth),
    getAllConnectors(auth),
  ]);

  const liveSet = new Set(health.live);

  const detailed: ConnectorHealthDetail[] = connectors.map((c) => ({
    resourceId: c.resourceId,
    name: c.name,
    status: liveSet.has(c.resourceId) ? ("live" as const) : ("dead" as const),
    operationalStatus: c.operationalStatus,
    alive: c.alive,
    disabled: c.disabled,
    disabledReason: c.disabledReason,
    inactive: c.inactive,
    inactiveReason: c.inactiveReason,
    owningServer: c.owningServer,
  }));

  return {
    connectors: detailed,
    summary: { live: health.live.length, dead: health.dead.length, total: health.total },
  };
}

/** Get all clients, optionally filtered by search term */
export async function getAllClients(auth: SessionAuth, search?: string): Promise<Client[]> {
  const ids = await getAllClientIds(auth);

  if (ids.length === 0) {
    return [];
  }

  // Batch fetch sequentially to avoid saturating the ESM connection pool
  const batchSize = 50;
  let clients: Client[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await getClientsByIds(auth, ids.slice(i, i + batchSize));
    clients.push(...batch);
  }

  if (search) {
    const term = search.toLowerCase();
    clients = clients.filter(
      (c) =>
        c.name?.toLowerCase().includes(term) ||
        c.alias?.toLowerCase().includes(term) ||
        c.externalID?.toLowerCase().includes(term) ||
        c.city?.toLowerCase().includes(term) ||
        c.country?.toLowerCase().includes(term)
    );
  }

  return clients;
}

/**
 * Hybrid client discovery: merge REST API customers with GWT-RPC channel tree folders.
 *
 * The REST API only returns first-class "Customer" resources, but operators often create
 * client folders in the channel tree that aren't registered as Customers. This function
 * discovers both and merges them — REST data is primary when a name match exists.
 */
export async function getHybridClients(auth: SessionAuth, search?: string): Promise<Client[]> {
  // Lazy import to avoid circular dependency (channel-client imports from client)
  const { getClientTree } = await import("@/lib/arcsight-channel-client");

  // Fetch both sources in parallel
  const [restClients, treeRoot] = await Promise.all([
    getAllClients(auth).catch((err) => {
      console.warn("[hybrid-clients] REST API failed, falling back to tree-only:", err.message);
      return [] as Client[];
    }),
    getClientTree(auth, "FORTRESS").catch((err) => {
      console.warn("[hybrid-clients] Tree fetch failed, falling back to REST-only:", err.message);
      return null;
    }),
  ]);

  // Tag REST clients
  const taggedRest = restClients.map((c) => ({ ...c, _source: "rest" as const }));

  if (!treeRoot) {
    return applySearch(taggedRest, search);
  }

  // Extract client-level nodes from the tree.
  // Tree structure: FORTRESS → Device Monitoring → <CLIENT_NAME>
  // So client nodes are at depth 2 (children of "Device Monitoring" which is child of FORTRESS).
  const treeClients: { name: string; resourceId: string }[] = [];
  for (const child of treeRoot.children) {
    // child = "Device Monitoring" or similar top-level group
    for (const clientNode of child.children) {
      treeClients.push({ name: clientNode.name, resourceId: clientNode.resourceId });
    }
  }

  // Build a lookup of REST clients by lowercase name for matching
  const restByName = new Map<string, Client>();
  for (const c of taggedRest) {
    restByName.set(c.name.toLowerCase(), c);
  }

  // Merge: REST data preferred, tree-only clients get a minimal Client object
  const merged = new Map<string, Client>();

  // Add all REST clients first (they have full metadata)
  for (const c of taggedRest) {
    merged.set(c.name.toLowerCase(), c);
  }

  // Add tree-only clients (those not matched to a REST customer)
  for (const tc of treeClients) {
    const key = tc.name.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, {
        resourceId: tc.resourceId || `tree:${tc.name}`,
        name: tc.name,
        _source: "tree",
      });
    }
  }

  return applySearch(Array.from(merged.values()), search);
}

function applySearch(clients: Client[], search?: string): Client[] {
  if (!search) return clients;
  const term = search.toLowerCase();
  return clients.filter(
    (c) =>
      c.name?.toLowerCase().includes(term) ||
      c.alias?.toLowerCase().includes(term) ||
      c.externalID?.toLowerCase().includes(term) ||
      c.city?.toLowerCase().includes(term) ||
      c.country?.toLowerCase().includes(term)
  );
}

// --- Events methods ---

export interface SecurityEventsRequest {
  ids: number[];
  startTime: number;
  endTime: number;
}

export interface SecurityEvent {
  [key: string]: unknown;
}

export interface EventCountResponse {
  count?: number;
  [key: string]: unknown;
}

/**
 * Retrieve events by IDs and time range.
 * POST /v1/events/retrieve
 */
export async function retrieveEvents(
  auth: SessionAuth,
  request: SecurityEventsRequest
): Promise<SecurityEvent[]> {
  return arcsightPostJson<SecurityEvent[]>(
    auth.restToken,
    "/v1/events/retrieve",
    request,
    30_000 // Events can be slow
  );
}

/**
 * Count events in a time range.
 * GET /v1/events/count?startTime=...&endTime=...
 */
export async function getEventCount(
  auth: SessionAuth,
  startTime: number,
  endTime: number
): Promise<EventCountResponse> {
  return arcsightFetch<EventCountResponse>(
    auth.restToken,
    `/v1/events/count?startTime=${startTime}&endTime=${endTime}`,
    0 // No revalidation cache
  );
}

/**
 * Get event field info map (metadata about all possible event fields).
 * GET /v1/events/getEventFieldInfoMap
 */
export async function getEventFieldInfoMap(auth: SessionAuth): Promise<Record<string, unknown>> {
  return arcsightFetch<Record<string, unknown>>(
    auth.restToken,
    "/v1/events/getEventFieldInfoMap",
    300 // Cache for 5 minutes
  );
}
