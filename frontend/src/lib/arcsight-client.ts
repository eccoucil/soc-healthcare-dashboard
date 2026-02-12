import "server-only";
import { Agent } from "undici";
import type {
  Customer,
  Connector,
  ConnectorDeviceMap,
  ConnectorWithDevices,
  ConnectorHealth,
} from "@/types/arcsight";

const BASE_URL = process.env.ARCSIGHT_API_BASE_URL;
const LOGIN_URL = process.env.ARCSIGHT_LOGIN_URL;
const USERNAME = process.env.ARCSIGHT_USERNAME;
const PASSWORD = process.env.ARCSIGHT_PASSWORD;
const STATIC_TOKEN = process.env.ARCSIGHT_API_TOKEN;

// --- Token management ---

let cachedToken: string | null = null;

async function login(): Promise<string> {
  if (!LOGIN_URL || !USERNAME || !PASSWORD) {
    throw new Error(
      "ArcSight login not configured. Set ARCSIGHT_LOGIN_URL, ARCSIGHT_USERNAME, and ARCSIGHT_PASSWORD in .env.local"
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
      body: `login=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`,
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
  cachedToken = token;
  return token;
}

async function getToken(): Promise<string> {
  // Static token takes priority (manual override)
  if (STATIC_TOKEN) return STATIC_TOKEN;
  // Return cached token if available
  if (cachedToken) return cachedToken;
  // Otherwise login
  return login();
}

function clearCachedToken(): void {
  cachedToken = null;
}

// undici Agent controls the actual connection pool used by Node.js fetch.
// Limits concurrent connections to avoid saturating the ESM server.
const dispatcher = new Agent({
  connect: { rejectUnauthorized: false },
  connections: 6,
  pipelining: 1,
  connectTimeout: 15_000,
});

// --- Generic fetch wrapper ---

const DEFAULT_TIMEOUT_MS = 15_000;

async function arcsightFetch<T>(
  path: string,
  revalidate = 30,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  _isRetry = false
): Promise<T> {
  if (!BASE_URL) {
    throw new Error(
      "ArcSight API not configured. Set ARCSIGHT_API_BASE_URL in .env.local"
    );
  }

  const token = await getToken();
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

    if (res.status === 401 && !_isRetry) {
      clearTimeout(timer);
      console.log(`[arcsight] 401 on ${path} — re-authenticating`);
      clearCachedToken();
      return arcsightFetch<T>(path, revalidate, timeoutMs, true);
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
  path: string,
  body: unknown,
  _isRetry = false
): Promise<void> {
  if (!BASE_URL) {
    throw new Error(
      "ArcSight API not configured. Set ARCSIGHT_API_BASE_URL in .env.local"
    );
  }

  const token = await getToken();
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

    if (res.status === 401 && !_isRetry) {
      clearTimeout(timer);
      console.log(`[arcsight] 401 on POST ${path} — re-authenticating`);
      clearCachedToken();
      return arcsightPost(path, body, true);
    }

    if (!res.ok) {
      throw new Error(`ArcSight API error: ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// --- Customer methods ---

export async function getAllCustomerIds(): Promise<string[]> {
  return arcsightFetch<string[]>("/v1/customers/allIds", 60);
}

export async function getCustomersByIds(ids: string[]): Promise<Customer[]> {
  const params = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
  return arcsightFetch<Customer[]>(`/v1/customers/ids?${params}`, 60);
}

export async function getCustomerById(id: string): Promise<Customer> {
  return arcsightFetch<Customer>(`/v1/customers/${encodeURIComponent(id)}`);
}

export async function getCustomerPathsToRoot(id: string): Promise<string[]> {
  return arcsightFetch<string[]>(
    `/v1/customers/${encodeURIComponent(id)}/allPathsToRoot`
  );
}

// --- Connector methods ---

export async function getConnectorDevices(
  timeoutMs = 45_000
): Promise<ConnectorDeviceMap> {
  return arcsightFetch<ConnectorDeviceMap>(
    "/v1/connectors/devices",
    30,
    timeoutMs
  );
}

export async function getConnectorsByIds(ids: string[]): Promise<Connector[]> {
  const params = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
  return arcsightFetch<Connector[]>(`/v1/connectors/ids?${params}`);
}

export async function getLiveConnectorIds(): Promise<string[]> {
  return arcsightFetch<string[]>("/v1/connectors/live", 10);
}

export async function getDeadConnectorIds(): Promise<string[]> {
  return arcsightFetch<string[]>("/v1/connectors/dead", 10);
}

// --- Group methods ---

export async function getGroupChildren(groupId: string): Promise<string[]> {
  return arcsightFetch<string[]>(
    `/v1/groups/${encodeURIComponent(groupId)}/children`
  );
}

// --- Connector listing methods ---

export async function getAllConnectorIds(): Promise<string[]> {
  return arcsightFetch<string[]>("/v1/connectors/allIds", 60);
}

export async function getAllConnectors(): Promise<Connector[]> {
  const ids = await getAllConnectorIds();
  if (ids.length === 0) return [];

  const batchSize = 50;
  const all: Connector[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await getConnectorsByIds(ids.slice(i, i + batchSize));
    all.push(...batch);
  }
  return all;
}

// --- Connector-customer linking methods ---

async function getCustomerParentGroupId(customerId: string): Promise<string> {
  const paths = await getCustomerPathsToRoot(customerId);
  if (paths.length === 0) {
    throw new Error("Customer has no parent group");
  }
  return paths[0];
}

export async function linkConnectorsToCustomer(
  customerId: string,
  connectorIds: string[]
): Promise<void> {
  const groupId = await getCustomerParentGroupId(customerId);
  await arcsightPost(
    `/v1/groups/${encodeURIComponent(groupId)}/children`,
    connectorIds
  );
}

export async function unlinkConnectorsFromCustomer(
  customerId: string,
  connectorIds: string[]
): Promise<void> {
  const groupId = await getCustomerParentGroupId(customerId);
  await arcsightPost(
    `/v1/groups/${encodeURIComponent(groupId)}/removeChildren`,
    connectorIds
  );
}

// --- Composite methods ---

/**
 * Get connectors (with devices) associated with a customer.
 *
 * ArcSight has no direct "devices per customer" endpoint. We bridge this
 * by traversing the group hierarchy:
 *   1. Get group paths for the customer
 *   2. Get children of the immediate parent group
 *   3. Fetch those children as connectors
 *   4. Attach device details from the connector-devices map
 */
export async function getConnectorsForCustomer(
  customerId: string
): Promise<ConnectorWithDevices[]> {
  const tag = `[getConnectorsForCustomer ${customerId}]`;

  const paths = await getCustomerPathsToRoot(customerId);
  console.log(`${tag} Step 1 — allPathsToRoot: ${JSON.stringify(paths)}`);

  if (paths.length === 0) {
    console.log(`${tag} No parent group found — returning []`);
    return [];
  }

  // The first path entry is the immediate parent group
  const parentGroupId = paths[0];
  const childIds = await getGroupChildren(parentGroupId);
  console.log(
    `${tag} Step 2 — group ${parentGroupId} children (${childIds.length}): ${JSON.stringify(childIds.slice(0, 10))}${childIds.length > 10 ? "…" : ""}`
  );

  if (childIds.length === 0) {
    console.log(`${tag} Group has no children — returning []`);
    return [];
  }

  // Fetch connector details and device map in parallel
  const [connectors, deviceMap] = await Promise.all([
    getConnectorsByIds(childIds).catch((err) => {
      console.error(`${tag} Step 3 — getConnectorsByIds FAILED:`, err);
      return [] as Connector[];
    }),
    getConnectorDevices().catch((err) => {
      console.error(`${tag} Step 4 — getConnectorDevices FAILED:`, err);
      return {} as ConnectorDeviceMap;
    }),
  ]);

  console.log(
    `${tag} Step 3 — connectors returned: ${connectors.length}`,
    `| Step 4 — deviceMap keys: ${Object.keys(deviceMap).length}`
  );

  // Filter to only valid connectors (getConnectorsByIds may skip non-connector IDs)
  // and attach device info
  return connectors.map((connector) => ({
    ...connector,
    devices: deviceMap[connector.resourceId] ?? [],
  }));
}

/** Aggregated connector health status */
export async function getConnectorHealth(): Promise<ConnectorHealth> {
  const [live, dead] = await Promise.all([
    getLiveConnectorIds(),
    getDeadConnectorIds(),
  ]);

  return {
    live,
    dead,
    total: live.length + dead.length,
  };
}

/** Get all customers, optionally filtered by search term */
export async function getAllCustomers(search?: string): Promise<Customer[]> {
  const ids = await getAllCustomerIds();

  if (ids.length === 0) {
    return [];
  }

  // Batch fetch sequentially to avoid saturating the ESM connection pool
  const batchSize = 50;
  let customers: Customer[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = await getCustomersByIds(ids.slice(i, i + batchSize));
    customers.push(...batch);
  }

  if (search) {
    const term = search.toLowerCase();
    customers = customers.filter(
      (c) =>
        c.name?.toLowerCase().includes(term) ||
        c.alias?.toLowerCase().includes(term) ||
        c.externalID?.toLowerCase().includes(term) ||
        c.city?.toLowerCase().includes(term) ||
        c.country?.toLowerCase().includes(term)
    );
  }

  return customers;
}
