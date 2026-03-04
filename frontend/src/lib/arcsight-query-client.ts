import "server-only";
import type { SessionAuth } from "@/lib/session";
import {
  createArcsightDispatcher,
  getProxyInfo,
} from "@/lib/arcsight-dispatcher";

// --- Configuration ---

const PHOENIX_URL = process.env.ARCSIGHT_PHOENIX_URL;
const EXPLICIT_MANAGER_URL = process.env.ARCSIGHT_MANAGER_URL?.trim() || "";
const LOGIN_URL = process.env.ARCSIGHT_LOGIN_URL?.trim() || "";

const QUERY_TIMEOUT_MS = 30_000;

// Connection pool for Manager Service Layer — routes through proxy if configured.
const dispatcher = createArcsightDispatcher({
  connections: 4,
  pipelining: 1,
  connectTimeout: 15_000,
});
console.log(`[query-service] Proxy: ${getProxyInfo()}`);

// --- URL discovery ---

let resolvedManagerUrl: string | null = null;
let resolvedLoginUrl: string | null = null;

/**
 * Discover the core-service LoginService URL.
 *
 * Priority:
 * 1. Explicit ARCSIGHT_LOGIN_URL env var
 * 2. Same host:port as PHOENIX_URL with /www/core-service/rest/LoginService/login path
 */
function discoverLoginUrl(): string {
  if (resolvedLoginUrl) return resolvedLoginUrl;

  if (LOGIN_URL) {
    resolvedLoginUrl = LOGIN_URL;
    return resolvedLoginUrl;
  }

  if (!PHOENIX_URL) {
    throw new Error(
      "Cannot discover Login URL. Set ARCSIGHT_LOGIN_URL or ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  const parsed = new URL(PHOENIX_URL);
  resolvedLoginUrl = `${parsed.protocol}//${parsed.host}/www/core-service/rest/LoginService/login`;
  return resolvedLoginUrl;
}

/**
 * Discover the Manager Service Layer base URL.
 *
 * Priority:
 * 1. Explicit ARCSIGHT_MANAGER_URL env var
 * 2. Same host:port as PHOENIX_URL with /www/manager-service/rest path
 */
function discoverManagerUrl(): string {
  if (resolvedManagerUrl) return resolvedManagerUrl;

  if (EXPLICIT_MANAGER_URL) {
    resolvedManagerUrl = EXPLICIT_MANAGER_URL.replace(/\/+$/, "");
    console.log(`[query-service] Using explicit Manager URL: ${resolvedManagerUrl}`);
    return resolvedManagerUrl;
  }

  if (!PHOENIX_URL) {
    throw new Error(
      "Cannot discover Manager URL. Set ARCSIGHT_MANAGER_URL or ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  const parsed = new URL(PHOENIX_URL);
  resolvedManagerUrl = `${parsed.protocol}//${parsed.host}/www/manager-service/rest`;
  console.log(`[query-service] Discovered Manager URL: ${resolvedManagerUrl}`);
  return resolvedManagerUrl;
}

// --- Generic Manager Service fetch (form-encoded) ---

async function managerFormFetch(
  token: string,
  url: string,
  params: Record<string, string>,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = new URLSearchParams({ authToken: token, ...params }).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher not in standard RequestInit
      dispatcher,
    });

    if (res.status === 401) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `Manager API auth error: 401 Unauthorized — ${errBody.slice(0, 300)}`
      );
    }

    return res;
  } finally {
    clearTimeout(timer);
  }
}

// --- Generic Manager Service fetch (JSON) ---

async function managerFetch<T>(
  token: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<T> {
  const baseUrl = discoverManagerUrl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher not in standard RequestInit
      dispatcher,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `Manager API error: ${res.status} ${res.statusText} — ${errBody.slice(0, 300)}`
      );
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// --- Detect API helpers ---

/**
 * Get event count from the Detect API for a time window.
 */
export async function getEventCount(
  auth: SessionAuth,
  startTime: number,
  endTime: number
): Promise<{ events: number; correlationEvents: number }> {
  const token = auth.restToken;

  if (!PHOENIX_URL) {
    throw new Error("ARCSIGHT_PHOENIX_URL not configured");
  }

  const parsed = new URL(PHOENIX_URL);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const url = `${baseUrl}/detect-api/rest/v1/events/count?startTime=${startTime}&endTime=${endTime}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher not in standard RequestInit
      dispatcher,
    });

    if (!res.ok) {
      throw new Error(`Event count failed: ${res.status}`);
    }

    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retrieve events by IDs from the Detect API.
 */
export async function retrieveEventsByIds(
  auth: SessionAuth,
  ids: number[],
  startTime: number,
  endTime: number
): Promise<unknown[]> {
  const token = auth.restToken;

  if (!PHOENIX_URL) {
    throw new Error("ARCSIGHT_PHOENIX_URL not configured");
  }

  const parsed = new URL(PHOENIX_URL);
  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const url = `${baseUrl}/detect-api/rest/v1/events/retrieve`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids, startTime, endTime }),
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher not in standard RequestInit
      dispatcher,
    });

    if (!res.ok) {
      throw new Error(`Event retrieve failed: ${res.status}`);
    }

    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- SecurityEventService (Manager Service Layer REST — JSON) ---

interface SecurityEventResponse {
  "sev.getSecurityEventsResponse"?: {
    "sev.return"?: unknown | unknown[];
  };
  [key: string]: unknown;
}

/**
 * Retrieve full event details from SecurityEventService by IDs.
 * Uses the Manager Service Layer REST API (JSON content type).
 */
export async function getSecurityEventsByIds(
  auth: SessionAuth,
  ids: number[],
  startMillis: number,
  endMillis: number
): Promise<unknown[]> {
  const data = await managerFetch<SecurityEventResponse>(
    auth.restToken,
    "/SecurityEventService/getSecurityEvents",
    {
      "sev.getSecurityEvents": {
        "sev.authToken": auth.restToken,
        "sev.ids": ids,
        "sev.startMillis": startMillis,
        "sev.endMillis": endMillis,
      },
    }
  );

  const ret = data?.["sev.getSecurityEventsResponse"]?.["sev.return"];

  console.log(
    `[query-service] getSecurityEventsByIds: ids=[${ids.join(",")}], ` +
    `hasResponse=${!!ret}, type=${ret ? (Array.isArray(ret) ? "array(" + ret.length + ")" : typeof ret) : "null"}`
  );

  if (!ret) return [];
  return Array.isArray(ret) ? ret : [ret];
}

// --- Flattened agent/device fields from SecurityEventService ---

function numericIpToString(n: unknown): string | null {
  if (typeof n !== "number" || n < 0 || n > 4294967295) return null;
  return `${(n >>> 24) & 0xFF}.${(n >>> 16) & 0xFF}.${(n >>> 8) & 0xFF}.${n & 0xFF}`;
}

export interface FlatEventFields {
  agentName?: string;
  agentHostName?: string;
  agentAddress?: string;
  agentType?: string;
  agentVersion?: string;
  agentId?: string;
  deviceVendor?: string;
  deviceProduct?: string;
  deviceHostName?: string;
  customerName?: string;
  name?: string;
  [key: string]: string | undefined;
}

/**
 * Fetch flattened agent/device fields for a single event via SecurityEventService.
 * Converts nested SecurityEvent structure to flat CEF field names.
 */
export async function getSecurityEventFlat(
  auth: SessionAuth,
  eventId: number,
  startMillis?: number,
  endMillis?: number,
): Promise<FlatEventFields | null> {
  const now = Date.now();
  const start = startMillis ?? now - 30 * 24 * 60 * 60 * 1000;
  const end = endMillis ?? now;

  const events = await getSecurityEventsByIds(auth, [eventId], start, end);
  if (events.length === 0) return null;

  const evt = events[0] as Record<string, unknown>;
  const agent = evt?.agent as Record<string, unknown> | undefined;
  const device = evt?.concentratorDevices as Record<string, unknown> | undefined;
  const customer = evt?.customer as Record<string, unknown> | undefined;

  console.log(
    `[query-service] SecurityEventFlat: eventId=${eventId}, totalKeys=${Object.keys(evt).length}, ` +
    `event keys=[${Object.keys(evt).slice(0, 20).join(",")}], ` +
    `agent=${agent ? JSON.stringify(Object.fromEntries(Object.entries(agent).slice(0, 8))) : "null"}`
  );

  const flat: FlatEventFields = {};

  // Agent name
  if (agent?.name) flat.agentName = String(agent.name);

  // Agent host name — handle case variations (hostName vs hostname)
  if (agent?.hostName) flat.agentHostName = String(agent.hostName);
  else if (agent?.hostname) flat.agentHostName = String(agent.hostname);

  // Agent address — handle string IPs ("172.18.23.5") and numeric IPs
  if (agent?.address != null) {
    if (typeof agent.address === "string" && agent.address.includes(".")) {
      flat.agentAddress = agent.address;
    } else {
      const ip = numericIpToString(agent.address);
      if (ip) flat.agentAddress = ip;
    }
  }
  // Also check hostAddress as an alternate key
  if (!flat.agentAddress && agent?.hostAddress != null) {
    if (typeof agent.hostAddress === "string" && agent.hostAddress.includes(".")) {
      flat.agentAddress = agent.hostAddress;
    } else {
      const ip = numericIpToString(agent.hostAddress);
      if (ip) flat.agentAddress = ip;
    }
  }

  if (agent?.type) flat.agentType = String(agent.type);
  if (agent?.version) flat.agentVersion = String(agent.version);
  if (agent?.id) flat.agentId = String(agent.id);
  if (device?.vendor) flat.deviceVendor = String(device.vendor);
  if (device?.product) flat.deviceProduct = String(device.product);
  if (device?.hostName) flat.deviceHostName = String(device.hostName);
  if (customer?.uri) {
    const parts = String(customer.uri).split("/");
    flat.customerName = parts[parts.length - 1] || undefined;
  }
  if (evt?.name) flat.name = String(evt.name);

  // Fallback: some ESM versions return flat CEF field names directly on the event
  if (!flat.agentHostName && evt.agentHostName) flat.agentHostName = String(evt.agentHostName);
  if (!flat.agentAddress && evt.agentAddress) flat.agentAddress = String(evt.agentAddress);
  if (!flat.agentName && evt.agentName) flat.agentName = String(evt.agentName);
  if (!flat.agentType && evt.agentType) flat.agentType = String(evt.agentType);
  if (!flat.agentId && evt.agentId) flat.agentId = String(evt.agentId);
  if (!flat.deviceVendor && evt.deviceVendor) flat.deviceVendor = String(evt.deviceVendor);
  if (!flat.deviceProduct && evt.deviceProduct) flat.deviceProduct = String(evt.deviceProduct);
  if (!flat.deviceHostName && evt.deviceHostName) flat.deviceHostName = String(evt.deviceHostName);

  return flat;
}

// --- ConnectorService (Manager Service Layer REST) ---

interface FindAllIdsResponse {
  "con.findAllIdsResponse"?: { "con.return"?: string[] };
  [key: string]: unknown;
}

interface GetResourceByIdResponse {
  "con.getResourceByIdResponse"?: {
    "con.return"?: { name?: string; type?: number; [key: string]: unknown };
  };
  [key: string]: unknown;
}

/**
 * Fetch all connector names via Manager Service Layer ConnectorService.
 * Fallback for when the DETECT API /v1/connectors/devices returns empty.
 * Returns Map<connectorResourceId, connectorName>.
 */
export async function getAllConnectorNamesViaManager(auth: SessionAuth): Promise<Map<string, string>> {
  const idsData = await managerFetch<FindAllIdsResponse>(
    auth.restToken,
    "/ConnectorService/findAllIds",
    { "con.findAllIds": { "con.authToken": auth.restToken } },
  );

  const ids = idsData?.["con.findAllIdsResponse"]?.["con.return"] ?? [];
  if (!Array.isArray(ids) || ids.length === 0) return new Map();

  console.log(`[query-service] ConnectorService: ${ids.length} connector IDs`);

  const nameMap = new Map<string, string>();

  // Fetch names in parallel (batches of 5 to avoid overwhelming the server)
  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const data = await managerFetch<GetResourceByIdResponse>(
          auth.restToken,
          "/ConnectorService/getResourceById",
          { "con.getResourceById": { "con.authToken": auth.restToken, "con.resourceId": id } },
        );
        const resource = data?.["con.getResourceByIdResponse"]?.["con.return"];
        if (resource?.name) nameMap.set(id, resource.name);
      })
    );
    // Log failures
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn(`[query-service] ConnectorService getResourceById failed:`, r.reason);
      }
    }
  }

  console.log(`[query-service] ConnectorService: resolved ${nameMap.size}/${ids.length} connector names`);
  return nameMap;
}

/** Connector metadata from Manager Service ConnectorService (name + agent fields). */
export interface ConnectorMetadata {
  name: string;
  hostName?: string;
  address?: string;
}

/**
 * Fetch all connector metadata (name, hostName, address) via Manager Service ConnectorService.
 * Returns Map<connectorResourceId, ConnectorMetadata>.
 */
export async function getAllConnectorMetadataViaManager(auth: SessionAuth): Promise<Map<string, ConnectorMetadata>> {
  const idsData = await managerFetch<FindAllIdsResponse>(
    auth.restToken,
    "/ConnectorService/findAllIds",
    { "con.findAllIds": { "con.authToken": auth.restToken } },
  );

  const ids = idsData?.["con.findAllIdsResponse"]?.["con.return"] ?? [];
  if (!Array.isArray(ids) || ids.length === 0) return new Map();

  console.log(`[query-service] ConnectorService metadata: ${ids.length} connector IDs`);

  const metadataMap = new Map<string, ConnectorMetadata>();

  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const data = await managerFetch<GetResourceByIdResponse>(
          auth.restToken,
          "/ConnectorService/getResourceById",
          { "con.getResourceById": { "con.authToken": auth.restToken, "con.resourceId": id } },
        );
        const resource = data?.["con.getResourceByIdResponse"]?.["con.return"];
        if (resource?.name) {
          metadataMap.set(id, {
            name: resource.name,
            hostName: resource.hostName as string | undefined,
            address: resource.address as string | undefined,
          });
        }
      })
    );
    for (const r of results) {
      if (r.status === "rejected") {
        console.warn(`[query-service] ConnectorService getResourceById failed:`, r.reason);
      }
    }
  }

  console.log(`[query-service] ConnectorService metadata: resolved ${metadataMap.size}/${ids.length} connectors`);
  return metadataMap;
}

/**
 * Fetch full connector resource by ID via Manager Service ConnectorService.
 * Returns the raw resource object for diagnostics.
 */
export async function getFullConnectorViaManager(auth: SessionAuth, connectorId: string): Promise<Record<string, unknown> | null> {
  const data = await managerFetch<GetResourceByIdResponse>(
    auth.restToken,
    "/ConnectorService/getResourceById",
    { "con.getResourceById": { "con.authToken": auth.restToken, "con.resourceId": connectorId } },
  );
  return (data?.["con.getResourceByIdResponse"]?.["con.return"] as Record<string, unknown>) ?? null;
}

// --- Search operations ---

export interface SearchResult {
  events: Array<Record<string, unknown>>;
  totalCount: number;
  searchSessionId: string;
}

/**
 * Search for events using the Manager Service Layer.
 *
 * This ESM version does NOT have QueryService/executeSearch.
 * Instead, we use ManagerSearchService/search (resource search) as a best-effort
 * approach, and return an empty result if no matching events are found.
 *
 * For reliable event data, use the GWT-RPC Active Channel path.
 *
 * @param filter - ArcSight filter expression (e.g. "'customerName' EQ \"Cadeploy\"")
 * @param fieldNames - Columns to return in results
 * @param limit - Max events to return (default 200)
 * @param timeRange - Optional time range filter (defaults to last 24h)
 */
export async function searchEvents(
  auth: SessionAuth,
  filter: string,
  fieldNames: string[],
  limit = 200,
  timeRange?: { startTime: number; endTime: number }
): Promise<SearchResult> {
  const empty: SearchResult = { events: [], totalCount: 0, searchSessionId: "" };

  try {
    const now = Date.now();
    const range = timeRange ?? {
      startTime: now - 24 * 60 * 60 * 1000,
      endTime: now,
    };

    // Try QueryService/executeSearch first (works on some ESM versions)
    try {
      const searchResponse = await managerFetch<ExecuteSearchResponse>(
        auth.restToken,
        "/QueryService/executeSearch",
        {
          "qvs.executeSearch": {
            "qvs.query": filter,
            "qvs.startTime": range.startTime,
            "qvs.endTime": range.endTime,
            "qvs.fieldNames": fieldNames,
            "qvs.limit": limit,
          },
        }
      );

      let searchSessionId =
        searchResponse?.["qvs.executeSearchResponse"]?.["qvs.return"] ?? "";

      if (!searchSessionId) {
        const alt = Object.values(searchResponse).find(
          (v): v is Record<string, unknown> =>
            typeof v === "object" && v !== null && "return" in v
        );
        if (alt && typeof alt["return"] === "string") {
          searchSessionId = alt["return"];
        }
      }

      if (searchSessionId) {
        console.log(`[query-service] Search session: ${searchSessionId.slice(0, 20)}...`);

        const resultsResponse = await managerFetch<GetResultsResponse>(
          auth.restToken,
          "/QueryService/getResults",
          {
            "qvs.getResults": {
              "qvs.searchSessionId": searchSessionId,
              "qvs.offset": 0,
              "qvs.count": limit,
            },
          }
        );

        const resultPayload =
          resultsResponse?.["qvs.getResultsResponse"]?.["qvs.return"];
        const events = resultPayload?.results ?? [];
        const totalCount = resultPayload?.totalCount ?? events.length;

        console.log(
          `[query-service] Search completed: ${events.length} events (total: ${totalCount})`
        );

        // Best-effort session cleanup
        closeSearchSession(auth.restToken, searchSessionId).catch(() => {});
        return { events, totalCount, searchSessionId };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 404 means QueryService/executeSearch doesn't exist on this ESM
      if (msg.includes("404")) {
        console.log("[query-service] QueryService/executeSearch not available on this ESM");
      } else {
        console.warn(`[query-service] QueryService/executeSearch failed: ${msg}`);
      }
    }

    // Fallback: return event count as context (no ad-hoc search on this ESM)
    const countResult = await getEventCount(auth, range.startTime, range.endTime);
    console.log(
      `[query-service] No search endpoint available. Event count in range: ${countResult.events}`
    );

    return empty;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[query-service] Search failed: ${msg}`);
    return empty;
  }
}

// --- Internal types ---

interface ExecuteSearchResponse {
  "qvs.executeSearchResponse"?: {
    "qvs.return"?: string;
  };
  [key: string]: unknown;
}

interface GetResultsResponse {
  "qvs.getResultsResponse"?: {
    "qvs.return"?: {
      results?: Array<Record<string, unknown>>;
      totalCount?: number;
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
}

async function closeSearchSession(token: string, searchSessionId: string): Promise<void> {
  try {
    await managerFetch<unknown>(
      token,
      "/QueryService/closeSession",
      {
        "qvs.closeSession": {
          "qvs.searchSessionId": searchSessionId,
        },
      },
      5_000
    );
  } catch {
    // Best-effort
  }
}

// --- FieldSetService (Manager Service Layer REST) ---

interface FieldSetGetResponse {
  "fie.getResourceByIdResponse"?: {
    "fie.return"?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

/**
 * Fetch a FieldSet resource by ID via Manager Service FieldSetService.
 * Returns the full resource object including its columns/fields.
 */
export async function getFieldSetResource(
  auth: SessionAuth,
  fieldSetId: string
): Promise<Record<string, unknown> | null> {
  // Try JSON first
  try {
    const data = await managerFetch<FieldSetGetResponse>(
      auth.restToken,
      "/FieldSetService/getResourceById",
      {
        "fie.getResourceById": {
          "fie.authToken": auth.restToken,
          "fie.resourceId": fieldSetId,
        },
      }
    );
    const resource = data?.["fie.getResourceByIdResponse"]?.["fie.return"];
    if (resource) return resource as Record<string, unknown>;
  } catch (jsonErr) {
    console.log(
      `[query-service] FieldSetService JSON failed: ${jsonErr instanceof Error ? jsonErr.message : jsonErr}`
    );
  }

  // Fallback: form-encoded
  try {
    const baseUrl = discoverManagerUrl();
    const res = await managerFormFetch(
      auth.restToken,
      `${baseUrl}/FieldSetService/getResourceById`,
      { "fie.getResourceById": fieldSetId }
    );
    if (res.ok) {
      const data = await res.json();
      const resource =
        data?.["fie.getResourceByIdResponse"]?.["fie.return"] ?? data;
      return resource as Record<string, unknown>;
    }
    const errBody = await res.text().catch(() => "");
    console.log(
      `[query-service] FieldSetService form-encoded: ${res.status} — ${errBody.slice(0, 200)}`
    );
  } catch (formErr) {
    console.log(
      `[query-service] FieldSetService form-encoded failed: ${formErr instanceof Error ? formErr.message : formErr}`
    );
  }

  return null;
}

/**
 * Update a FieldSet resource via Manager Service FieldSetService.
 * Tries JSON, then form-encoded content types.
 */
export async function updateFieldSetResource(
  auth: SessionAuth,
  fieldSetResource: Record<string, unknown>
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const baseUrl = discoverManagerUrl();
  const token = auth.restToken;

  // Strategy 1: JSON body with nested wrapper
  try {
    const data = await managerFetch<Record<string, unknown>>(
      token,
      "/FieldSetService/update",
      {
        "fie.update": {
          "fie.authToken": token,
          "fie.fieldSet": fieldSetResource,
        },
      }
    );
    return { success: true, data };
  } catch (jsonErr) {
    console.log(
      `[query-service] FieldSetService update (JSON nested) failed: ${jsonErr instanceof Error ? jsonErr.message : jsonErr}`
    );
  }

  // Strategy 2: JSON body with flat wrapper
  try {
    const data = await managerFetch<Record<string, unknown>>(
      token,
      "/FieldSetService/update",
      {
        "fie.update": fieldSetResource,
      }
    );
    return { success: true, data };
  } catch (jsonErr2) {
    console.log(
      `[query-service] FieldSetService update (JSON flat) failed: ${jsonErr2 instanceof Error ? jsonErr2.message : jsonErr2}`
    );
  }

  // Strategy 3: form-encoded
  try {
    const res = await managerFormFetch(
      token,
      `${baseUrl}/FieldSetService/update`,
      { "fie.update": JSON.stringify(fieldSetResource) }
    );
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: true, data };
    }
    const errBody = await res.text().catch(() => "");
    return {
      success: false,
      error: `Form-encoded: ${res.status} ${res.statusText} — ${errBody.slice(0, 300)}`,
    };
  } catch (formErr) {
    return {
      success: false,
      error: `All strategies failed. Last: ${formErr instanceof Error ? formErr.message : String(formErr)}`,
    };
  }
}
