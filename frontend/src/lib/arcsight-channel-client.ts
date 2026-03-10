import "server-only";
import type { SessionAuth } from "@/lib/session";
import {
  createArcsightDispatcher,
  getProxyInfo,
} from "@/lib/arcsight-dispatcher";
import {
  buildGwtRpcRequest,
  decodeGwtRpcResponse,
  type GwtRpcParam,
  type GwtRpcServiceConfig,
  type GwtRpcDecodedResponse,
} from "@/lib/gwt-rpc-codec";
import {
  searchEvents,
  type SearchResult,
  getAllConnectorNamesViaManager,
  getSecurityEventFlat,
} from "@/lib/arcsight-query-client";
import {
  getConnectorDevices,
  getConnectorsByIds,
} from "@/lib/arcsight-client";

// --- Configuration ---

const PHOENIX_URL = process.env.ARCSIGHT_PHOENIX_URL;

const LOGIN_STRONG_NAME =
  process.env.ARCSIGHT_PHOENIX_LOGIN_STRONG_NAME ??
  "4D0A049F53B67145A7E76738739AE51D";
const DATAMONITOR_STRONG_NAME =
  process.env.ARCSIGHT_PHOENIX_DATAMONITOR_STRONG_NAME ??
  "16E3F072A4D6472660C134A29CF9DB25";
/** @deprecated — discover dynamically via getAllActiveChannels(). Falls back to env var if set. */
const DEFAULT_RESOURCE_ID =
  process.env.ARCSIGHT_DEFAULT_CHANNEL_GROUP_ID ?? "";

// ChannelService config
const CHANNEL_STRONG_NAME =
  process.env.ARCSIGHT_CHANNEL_STRONG_NAME ?? "91BA6254AC077B3B739C11EF760F47FF";
/** @deprecated — pass channelId dynamically via getActiveChannelEvents(channelId). */
const CHANNEL_RESOURCE_ID =
  process.env.ARCSIGHT_CHANNEL_RESOURCE_ID ?? "";

// FieldSet resource ID — required for getChannelInfo to return event data.
// Without a FieldSet reference, the server returns metadata-only (0 events, 0 bucket tokens).
// Discovered via Playwright interception of Phoenix's ChannelService.getChannelInfo requests.
const FIELD_SET_ID = process.env.ARCSIGHT_FIELD_SET_ID ?? "";
// FieldSet path — Phoenix sends this alongside the ID in the ResourceReference.
// Without it the server may not fully resolve the FieldSet, returning 0 events.
const FIELD_SET_PATH = process.env.ARCSIGHT_FIELD_SET_PATH ?? "/All Field Sets/FORTRESS/Device Monitoring";

// GroupService config (for listing active channel groups)
const GROUP_STRONG_NAME =
  process.env.ARCSIGHT_GROUP_STRONG_NAME ?? "1B071B5D44F7515FFE5935DBF4E7ECC9";

// EventService config (for fetching full event details — all ~450 CEF fields)
const EVENT_STRONG_NAME =
  process.env.ARCSIGHT_EVENT_STRONG_NAME ?? "51097F59CEAD73CED97BA5CE4939E8FA";

// Module permutation hash — the X-GWT-Permutation header must use this for ALL
// services. The per-service strong names go only in the request body (position 2).
const PHOENIX_PERMUTATION =
  process.env.ARCSIGHT_PHOENIX_PERMUTATION ?? "CB3DBC2F5104708621DAEEEBF767F03B";

const PHOENIX_TIMEOUT_MS = 20_000;

/** Gate verbose per-channel diagnostic logs behind an env flag to reduce CPU overhead during scans.
 *  Set ARCSIGHT_SCAN_DEBUG=true in .env.local to re-enable for debugging. */
const SCAN_DEBUG = process.env.ARCSIGHT_SCAN_DEBUG === "true";

/** Bucket tokens from the last ChannelService response — used for the next poll */
let lastBucketTokens: string[] = [];

/**
 * Channel metadata cache — maps channelId to its parent group ID and full path.
 *
 * Populated automatically by tree discovery calls (getAllActiveChannels,
 * scanAllChannelEvents, etc.). Used by callGetChannelInfo to send the full
 * ResourceReference matching the ACC UI's exact wire format:
 *   ResourceReference(id=channelId, parentGroup=groupId, type=33, path=channelPath)
 *
 * Without these fields the server still returns data, but including them
 * matches the ACC UI exactly and may improve reliability on strict ESM versions.
 */
const channelMetadataCache = new Map<string, { parentGroupId: string; path: string }>();

/** Cache channel metadata from tree discovery results. */
function cacheChannelMetadata(
  channels: { resourceId: string; path: string }[],
  parentGroupId: string
): void {
  // Evict stale entries from reorganized channels — keeps memory bounded
  if (channelMetadataCache.size > 500) channelMetadataCache.clear();
  for (const ch of channels) {
    channelMetadataCache.set(ch.resourceId, { parentGroupId, path: ch.path });
  }
}

// --- Static constants for device enrichment (hoisted to module scope to avoid per-scan re-allocation) ---

/** Known device keyword map — used by both connector matching and channel-name inference */
const DEVICE_NAME_MAP: ReadonlyArray<{ keywords: string[]; vendor: string; product: string }> = [
  { keywords: ["fortigate"], vendor: "Fortinet", product: "FortiGate" },
  { keywords: ["fortinet"], vendor: "Fortinet", product: "FortiGate" },
  { keywords: ["sentinelone", "sentinel one", "sentinel-one"], vendor: "SentinelOne", product: "Mgmt" },
  { keywords: ["dell_emc", "dell emc", "emc unity"], vendor: "Dell Technologies", product: "EMC Unity" },
  { keywords: ["addc", "pdc", "adc"], vendor: "Microsoft", product: "Microsoft Windows" },
  { keywords: ["palo alto", "paloalto", "pan-os"], vendor: "Palo Alto Networks", product: "PAN-OS" },
  { keywords: ["cisco asa", "cisco-asa"], vendor: "Cisco", product: "ASA" },
  { keywords: ["cisco firepower"], vendor: "Cisco", product: "Firepower" },
  { keywords: ["sophos"], vendor: "Sophos", product: "Sophos Firewall" },
  { keywords: ["checkpoint", "check point"], vendor: "Check Point", product: "Check Point Firewall" },
  { keywords: ["juniper", "srx"], vendor: "Juniper Networks", product: "Juniper SRX" },
  { keywords: ["crowdstrike", "falcon"], vendor: "CrowdStrike", product: "Falcon" },
  { keywords: ["mcafee", "trellix"], vendor: "Trellix", product: "ENS" },
  { keywords: ["symantec", "broadcom"], vendor: "Broadcom", product: "Symantec Endpoint" },
  { keywords: ["windows", "server"], vendor: "Microsoft", product: "Microsoft Windows" },
  { keywords: ["linux", "ubuntu", "centos", "rhel"], vendor: "Linux", product: "Linux OS" },
] as const;

/** Generic words excluded from location-token matching */
const GENERIC_WORDS = new Set(["the", "and", "for", "all", "new", "old"]);

/** Extract meaningful tokens from a string for location-token matching */
function extractMatchTokens(s: string): Set<string> {
  const tokens = s.toLowerCase().replace(/[().\-_]/g, " ").split(/\s+/).filter(t => t.length >= 3);
  return new Set(tokens);
}

// GWT module base — shared across all Phoenix GWT-RPC services.
// Derived from PHOENIX_URL so it adapts to any server.
const MODULE_BASE = PHOENIX_URL
  ? `${PHOENIX_URL}/www/ui-phoenix/com.arcsight.phoenix.PhoenixLauncher/`
  : "";

// Separate connection pool for Phoenix (GWT-RPC endpoint) — routes through proxy if configured.
// Connection pool sized to match BATCH_CONCURRENCY (4). Extra idle connections
// consume ESM thread pool slots for no benefit since we never run >4 concurrent requests.
const phoenixDispatcher = createArcsightDispatcher({
  connections: 4,
  pipelining: 1,
  connectTimeout: 15_000,
});
console.log(`[arcsight-channel] Proxy: ${getProxyInfo()}`);

// --- Phoenix GWT-RPC login (exported for session creation) ---

/**
 * Authenticate via Phoenix GWT-RPC LoginService.
 *
 * This is a separate auth session from the REST API. The GWT-RPC login
 * returns a different token format that must be used for all subsequent
 * GWT-RPC calls (DataMonitorV2Service, etc.).
 *
 * Returns the token and session cookies (needed for channel state tracking).
 */
export async function loginToPhoenix(
  username: string,
  password: string
): Promise<{ token: string; cookies: string }> {
  if (!PHOENIX_URL) {
    throw new Error(
      "Phoenix login not configured. Set ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  console.log("[phoenix-login] Authenticating via GWT-RPC...");

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.core.service.v1.client.gwt.api.LoginService",
    method: "login",
    moduleBaseUrl: MODULE_BASE,
    strongName: LOGIN_STRONG_NAME,
  };

  // login(null, username, password) — 3 String params
  const params: GwtRpcParam[] = [
    { kind: "string", value: null },
    { kind: "string", value: username },
    { kind: "string", value: password },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const loginUrl = `${PHOENIX_URL}/www/core-service/gwt/LoginService`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOENIX_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/x-gwt-rpc; charset=utf-8",
        "X-GWT-Module-Base": MODULE_BASE,
        "X-GWT-Permutation": PHOENIX_PERMUTATION,
      },
      body: requestBody,
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher: phoenixDispatcher,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Phoenix GWT-RPC login failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    );
  }

  // Capture session cookies (e.g. JSESSIONID) — required for server-side
  // channel state tracking. Without these, getChannelInfo returns 0 events.
  let cookies = "";
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    cookies = setCookies
      .map((c: string) => c.split(";")[0]) // strip attributes (Path, Secure, etc.)
      .join("; ");
    console.log(`[phoenix-login] Session cookies: ${cookies.slice(0, 60)}...`);
  } else {
    console.log("[phoenix-login] No session cookies in response");
  }

  const rawText = await res.text();
  // Response: //OK[1,["t6XIWiG6WzABJBs00UxStf7G_TeqXy8wqp1vQUcXuGg."],0,7]
  const decoded = decodeGwtRpcResponse(rawText);

  // Token is the first string in the string table
  if (decoded.stringTable.length === 0) {
    throw new Error(
      "Phoenix login response missing token. Raw: " + rawText.slice(0, 200)
    );
  }

  const token = decoded.stringTable[0];
  console.log("[phoenix-login] Authenticated successfully");
  return { token, cookies };
}

// --- DataMonitorV2Service calls ---

/**
 * Call DataMonitorV2Service.getViewableData via GWT-RPC.
 *
 * This fetches the live data from a data monitor (e.g. "Top 10 Attackers").
 * The ResourceReference is serialized as a complex GWT-RPC object with:
 *   - resourceId (Base64 string)
 *   - null (alias field)
 *   - ResourceType enum (ordinal 19 = DataMonitor)
 *   - null (additional field)
 */
async function callGetViewableData(
  token: string,
  resourceId: string
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error(
      "Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.DataMonitorV2Service",
    method: "getViewableData",
    moduleBaseUrl: MODULE_BASE,
    strongName: DATAMONITOR_STRONG_NAME,
  };

  // getViewableData(String token, ResourceReference ref) — 2 params
  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
      fields: [
        { kind: "string", value: resourceId },
        { kind: "string", value: null },
        {
          kind: "enum",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
          ordinal: 19, // DataMonitor
        },
        { kind: "string", value: null },
      ],
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/DataMonitorV2Service`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOENIX_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/x-gwt-rpc; charset=utf-8",
        "X-GWT-Module-Base": MODULE_BASE,
        "X-GWT-Permutation": PHOENIX_PERMUTATION,
      },
      body: requestBody,
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher: phoenixDispatcher,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GWT-RPC getViewableData failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    );
  }

  const rawText = await res.text();
  return decodeGwtRpcResponse(rawText);
}

/**
 * Parse ViewableMatrixData GWT-RPC response.
 *
 * This format is used by DataMonitorV2Service and QueryViewerV2Service.
 * It's a flat list of cell values that must be reconstructed into rows
 * using the column definitions found in the metadata.
 */
function parseViewableMatrixData(decoded: GwtRpcDecodedResponse): ChannelResult {
  const { values, stringTable } = decoded;
  const isType = stringTable.map(s => /^[\w.$]+\/\d+$/.test(s));

  // Step 1: Find Column Definitions (FieldInfo)
  const fieldNames: string[] = [];
  const fiTypeIdx = stringTable.findIndex(s => s.includes("FieldInfo/"));
  const fiRef = fiTypeIdx >= 0 ? fiTypeIdx + 1 : -1;

  for (let i = 0; i < values.length; i++) {
    if (values[i] === fiRef) {
      // Look backward for internal name (ArcSight pattern)
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const v = values[j];
        if (typeof v === "number" && v > 0 && v <= stringTable.length && !isType[v-1]) {
          const s = stringTable[v-1];
          if (/^[a-z][a-zA-Z0-9]{2,}$/.test(s)) {
            fieldNames.push(s);
            break;
          }
        }
      }
    }
  }

  // Step 2: Extract Matrix Data (The Rows)
  // Matrix data usually appears as a repeated primitive or a specific Matrix entry type.
  // In your ESM, it looks like a flat sequence of values in an ArrayList.
  const longTypeIdx = stringTable.findIndex(s => s.startsWith("java.lang.Long/"));
  const longRef = longTypeIdx >= 0 ? longTypeIdx + 1 : -1;

  function resolve(val: unknown, next?: unknown): string | number | null {
    if (typeof val === "string") return (next === longRef) ? decodeGwtLong(val) : val;
    if (typeof val === "number" && val > 0 && val <= stringTable.length && !isType[val-1]) return stringTable[val-1];
    return (typeof val === "number" && val !== 0) ? val : null;
  }

  const events: ChannelEvent[] = [];
  const fieldCount = fieldNames.length;

  if (fieldCount > 0) {
    // Find the largest ArrayList — that's our data matrix
    let matrixStart = -1;
    let matrixSize = 0;
    for (let i = 0; i < values.length - 1; i++) {
      if (values[i] === 2 && typeof values[i+1] === "number") {
        const size = values[i+1] as number;
        if (size > matrixSize) {
          matrixStart = i + 2;
          matrixSize = size;
        }
      }
    }

    if (matrixStart !== -1 && matrixSize >= fieldCount) {
      const rowCount = Math.floor(matrixSize / fieldCount);
      for (let r = 0; r < rowCount; r++) {
        const fields: Record<string, string | number | null> = {};
        for (let c = 0; c < fieldCount; c++) {
          const idx = matrixStart + (r * fieldCount) + c;
          fields[fieldNames[c]] = resolve(values[idx], values[idx+1]);
        }
        events.push({ fields });
      }
    }
  }

  return { events, totalCount: events.length, fieldNames };
}

// --- Public API ---

/**
 * Fetch viewable data for a data monitor resource.
 *
 * Uses the Phoenix token from the caller's session auth.
 */
export async function getViewableData(
  auth: SessionAuth,
  resourceId?: string
): Promise<ChannelResult> {
  const id = resourceId ?? DEFAULT_RESOURCE_ID;
  if (!id) return { events: [], totalCount: 0, fieldNames: [] };

  const decoded = await callGetViewableData(auth.phoenixToken, id);
  return parseViewableMatrixData(decoded);
}

/**
 * Get the raw decoded GWT-RPC response for debugging.
 * Returns both the login step result and the getViewableData result.
 */
export async function getChannelDebugResponse(
  auth: SessionAuth,
  resourceId?: string
): Promise<{
  loginOk: boolean;
  tokenPreview: string;
  dataMonitorResponse: GwtRpcDecodedResponse;
  requestBody: string;
}> {
  if (!PHOENIX_URL) {
    throw new Error(
      "Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  const token = auth.phoenixToken;

  // Build the request body (for debugging)
  const id = resourceId ?? DEFAULT_RESOURCE_ID;
  if (!id) {
    throw new Error(
      "No resourceId provided and no default configured. " +
        "Discover resource IDs via GET /api/arcsight/channels/list, " +
        "then pass ?resourceId=<id> to this endpoint."
    );
  }
  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.DataMonitorV2Service",
    method: "getViewableData",
    moduleBaseUrl: MODULE_BASE,
    strongName: DATAMONITOR_STRONG_NAME,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
      fields: [
        { kind: "string", value: id },
        { kind: "string", value: null },
        {
          kind: "enum",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
          ordinal: 19,
        },
        { kind: "string", value: null },
      ],
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);

  // Step 3: Call getViewableData
  const dataMonitorResponse = await callGetViewableData(token, id);

  return {
    loginOk: true,
    tokenPreview: token.slice(0, 12) + "...",
    dataMonitorResponse,
    requestBody,
  };
}

// --- ChannelService calls ---

export interface ChannelEvent {
  fields: Record<string, string | number | null>;
}

export interface ChannelResult {
  events: ChannelEvent[];
  totalCount: number;
  fieldNames: string[];
  eventIds?: number[];
  isFilterExpressionOnly?: boolean;
  latestDataTimestamp?: number | null;
}

/**
 * Build ChannelBucket items for the bucket polling protocol.
 *
 * ChannelBucket structure (discovered via iterative error probing):
 *   - ArrayList<FieldValue> fieldValues  (field 1)
 *   - ArrayList<Long> eventIds           (field 2)
 *
 * We send one bucket per cursor token, with the Long value in the eventIds list
 * and an empty fieldValues list (server populates field context itself).
 */
function buildBucketItems(bucketTokens: string[]): GwtRpcParam[] {
  if (bucketTokens.length === 0) return [];

  // One ChannelBucket per cursor token
  return bucketTokens.map((bt) => ({
    kind: "object" as const,
    typeDescriptor:
      "com.arcsight.product.esmclient.service.v1.model.channel.ChannelBucket/2331665581",
    fields: [
      // fieldValues: ArrayList<FieldValue> (empty)
      {
        kind: "list" as const,
        typeDescriptor: "java.util.ArrayList/4159755760",
        items: [],
      },
      // eventIds: ArrayList<Long> — single cursor token
      {
        kind: "list" as const,
        typeDescriptor: "java.util.ArrayList/4159755760",
        items: [{ kind: "long" as const, value: bt }],
      },
    ],
  }));
}

/**
 * Call ChannelService.getChannelInfo via GWT-RPC.
 *
 * Signature: getChannelInfo(String token, ChannelRequest request)
 *
 * ChannelRequest fields (traced from captured browser request):
 *   1. channelRef: ResourceReference (ordinal 33 = ActiveChannel)
 *   2. criteria: ChannelCriteria (2 nulls + fieldSetRef + null)
 *   3. buckets: ArrayList<ChannelBucket> (empty for initial fetch)
 *   4. offset: int (0)
 *   5. limit: int (200)
 *   6. flags: int (0)
 */
async function callGetChannelInfo(
  token: string,
  sessionCookies: string,
  bucketTokens: string[] = [],
  channelId?: string
): Promise<GwtRpcDecodedResponse | null> {
  if (!PHOENIX_URL) {
    throw new Error(
      "Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  // Use provided channelId, fall back to legacy default (deprecated)
  const resolvedChannelId = channelId ?? CHANNEL_RESOURCE_ID;
  if (!resolvedChannelId) {
    // Return a sentinel so the caller can return an empty result gracefully
    // instead of throwing a hard error that triggers 500 in the UI.
    return null;
  }
  if (!channelId) {
    console.warn(
      "[channel-service] No channelId provided, using legacy default. " +
        "Discover channel IDs via /api/arcsight/channels/list first."
    );
  }

  // Resolve FieldSet ID dynamically (env var → cache → auto-discovery)
  const resolvedFieldSetId = await getFieldSetId(token, sessionCookies);

  // Look up cached metadata for the channel (parent group ID + full path).
  // Populated by tree discovery calls (getAllActiveChannels / scan).
  // ACC UI sends these in the ResourceReference — matches exact wire format.
  const chMeta = channelMetadataCache.get(resolvedChannelId);

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ChannelService",
    method: "getChannelInfo",
    moduleBaseUrl: MODULE_BASE,
    strongName: CHANNEL_STRONG_NAME,
  };

  // getChannelInfo(String token, ChannelRequest request)
  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.channel.ChannelRequest/1272271556",
      fields: [
        // channelRef: ResourceReference (ActiveChannel = ordinal 33)
        // ACC UI sends: ResourceReference(id, parentGroupId, type=33, path)
        {
          kind: "object",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
          fields: [
            { kind: "string", value: resolvedChannelId },
            { kind: "string", value: chMeta?.parentGroupId ?? null },
            {
              kind: "enum",
              typeDescriptor:
                "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
              ordinal: 33, // ActiveChannel
            },
            { kind: "string", value: chMeta?.path ?? null },
          ],
        },
        // criteria: ChannelCriteria (2 null fields, then fieldSetRef, then null)
        {
          kind: "object",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.channel.ChannelCriteria/285692488",
          fields: [
            { kind: "string", value: null },
            { kind: "string", value: null },
            // fieldSetRef: ResourceReference (FieldSet = ordinal 37)
            // When a valid FieldSet ID is available, send the full ResourceReference
            // so the server returns columns defined by that FieldSet.
            // When NO FieldSet exists (e.g. test server has no FORTRESS FieldSet group),
            // send null — the server returns events using its default column layout.
            // This matches ACC UI behavior observed via Playwright interception:
            // ACC UI sends 0 (null) for ChannelCriteria on servers without custom FieldSets.
            ...(resolvedFieldSetId
              ? [
                  {
                    kind: "object" as const,
                    typeDescriptor:
                      "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
                    fields: [
                      { kind: "string" as const, value: resolvedFieldSetId },
                      { kind: "string" as const, value: chMeta?.parentGroupId ?? null },
                      {
                        kind: "enum" as const,
                        typeDescriptor:
                          "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
                        ordinal: 37, // FieldSet
                      },
                      { kind: "string" as const, value: FIELD_SET_PATH || null },
                    ],
                  },
                ]
              : [{ kind: "string" as const, value: null }]),
            { kind: "string", value: null },
          ],
        },
        // buckets: ArrayList<ChannelBucket>
        // ChannelBucket: { ArrayList<FieldValue> fieldValues, ArrayList<Long> eventIds }
        {
          kind: "list",
          typeDescriptor: "java.util.ArrayList/4159755760",
          items: buildBucketItems(bucketTokens),
        },
        // offset
        { kind: "int", value: 0 },
        // limit
        { kind: "int", value: 200 },
        // flags
        { kind: "int", value: 0 },
      ],
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  console.log(
    `[channel-service] getChannelInfo: ${bucketTokens.length} bucket token(s)${
      bucketTokens.length > 0 ? ` [${bucketTokens[0].slice(0, 8)}...]` : ""
    } fieldSetId=${resolvedFieldSetId || "(none)"} fieldSetPath=${FIELD_SET_PATH || "(none)"}` +
    ` channelMeta=${chMeta ? `parentGroup=${chMeta.parentGroupId.slice(0, 12)}... path=${chMeta.path.split("/").pop()}` : "(not cached)"}`
  );

  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ChannelService`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOENIX_TIMEOUT_MS);

  const headers: Record<string, string> = {
    "Content-Type": "text/x-gwt-rpc; charset=utf-8",
    "X-GWT-Module-Base": MODULE_BASE,
    "X-GWT-Permutation": PHOENIX_PERMUTATION,
  };
  if (sessionCookies) {
    headers["Cookie"] = sessionCookies;
  }

  let res: Response;
  try {
    res = await fetch(serviceUrl, {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher: phoenixDispatcher,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GWT-RPC getChannelInfo failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    );
  }

  const rawText = await res.text();
  console.log(`[channel-service] Raw response: ${rawText.length} bytes, starts with: ${rawText.slice(0, 80)}`);
  const decoded = decodeGwtRpcResponse(rawText);
  // Attach request body for debugging
  (decoded as GwtRpcDecodedResponse & { _requestBody?: string })._requestBody = requestBody;
  return decoded;
}

// NOTE: ChannelService navigation methods (first/next/previous/last) are NOT used.
// Playwright interception of the ACC Phoenix UI confirmed it exclusively uses
// getChannelInfo with bucket tokens for progressive event loading.
// Navigation methods throw IncompatibleRemoteServiceException on this ESM version.

/**
 * Close a channel view on the server to free up the per-session channel slot.
 *
 * ArcSight ESM limits open event channels to 10 per session. Without closing,
 * scanning 12+ channels hits MaxChannelExceededException on later channels.
 *
 * Fire-and-forget: errors are logged but never thrown (the server may not
 * support stopViewChannel on older ESM versions).
 */
async function callStopViewChannel(
  token: string,
  sessionCookies: string,
  channelId: string
): Promise<void> {
  if (!PHOENIX_URL) return;

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ChannelService",
    method: "stopViewChannel",
    moduleBaseUrl: MODULE_BASE,
    strongName: CHANNEL_STRONG_NAME,
  };

  // stopViewChannel(String token, String channelId)
  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    { kind: "string", value: channelId },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ChannelService`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  const headers: Record<string, string> = {
    "Content-Type": "text/x-gwt-rpc; charset=utf-8",
    "X-GWT-Module-Base": MODULE_BASE,
    "X-GWT-Permutation": PHOENIX_PERMUTATION,
  };
  if (sessionCookies) {
    headers["Cookie"] = sessionCookies;
  }

  try {
    const res = await fetch(serviceUrl, {
      method: "POST",
      headers,
      body: requestBody,
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
      dispatcher: phoenixDispatcher,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[channel-service] stopViewChannel(${channelId.slice(0, 12)}...) HTTP ${res.status}: ${body.slice(0, 200)}`
      );
    } else {
      const raw = await res.text();
      // Check for GWT-RPC exception response (//EX[...])
      if (raw.startsWith("//EX")) {
        console.warn(
          `[channel-service] stopViewChannel(${channelId.slice(0, 12)}...) GWT error: ${raw.slice(0, 200)}`
        );
      } else {
        console.log(`[channel-service] stopViewChannel(${channelId.slice(0, 12)}...) OK`);
      }
    }
  } catch (err) {
    console.warn(
      `[channel-service] stopViewChannel(${channelId.slice(0, 12)}...) failed:`,
      err instanceof Error ? err.message : err
    );
  } finally {
    clearTimeout(timer);
  }

  // Clean up local tracking regardless of server response
  subscribedChannels.delete(channelId);
  channelBucketTokens.delete(channelId);
}

/**
 * Extract bucket cursor tokens from a ChannelService response.
 *
 * ChannelResult field layout (from GWT deserializer c5d):
 *   b.a = ArrayList<ChannelBucket>  (FIRST field — the bucket list)
 *   b.b = ResourceReference         (channel ref)
 *   b.c = Long                      (metadata timestamp — NOT a bucket token!)
 *   b.d = PagingListResult          (event data)
 *   b.e = ArrayList<FieldInfo>      (field definitions)
 *   b.f = float, b.g = int          (misc metadata)
 *   b.i = ArrayList<SortInfo>       (sort config)
 *   b.j = Long                      (metadata timestamp — NOT a bucket token!)
 *
 * We ONLY extract Long values that appear inside ChannelBucket objects.
 * If no ChannelBucket type descriptor exists in the string table, the bucket
 * list is empty and we return [].
 */
function extractBucketTokens(decoded: GwtRpcDecodedResponse): string[] {
  // Only extract if ChannelBucket objects actually exist in the response
  const bucketTypeIdx = decoded.stringTable.findIndex((s) =>
    s.includes("ChannelBucket/")
  );
  if (bucketTypeIdx < 0) {
    // No ChannelBucket type in string table → bucket list is empty
    return [];
  }

  const longTypeIdx = decoded.stringTable.findIndex((s) =>
    s.startsWith("java.lang.Long/")
  );
  if (longTypeIdx < 0) return [];

  const bucketRef = bucketTypeIdx + 1; // 1-based
  const longRef = longTypeIdx + 1;

  // Walk values looking for Long values that follow a ChannelBucket context.
  // ChannelBucket serialization (from GWT JS N4d): writes field a (ArrayList), then field b (ArrayList).
  // Field b contains the Long cursor tokens.
  // Pattern in forward-order values:
  //   bucketRef ... ArrayList(fieldValues) ... ArrayList(eventIds) ... longRef value_string ...
  const tokens: string[] = [];
  let insideBucket = false;

  for (let i = 0; i < decoded.values.length - 1; i++) {
    const v = decoded.values[i];

    // Track when we enter a ChannelBucket object
    if (v === bucketRef) {
      insideBucket = true;
      continue;
    }

    // Extract Long values only when inside a bucket context
    if (
      insideBucket &&
      typeof v === "string" &&
      decoded.values[i + 1] === longRef
    ) {
      tokens.push(v);
      i++; // skip the type ref
    }

    // Reset bucket context when we hit the next top-level type
    // (any non-ChannelBucket type descriptor resets context)
    if (
      typeof v === "number" &&
      v > 0 &&
      v <= decoded.stringTable.length &&
      v !== bucketRef &&
      v !== longRef
    ) {
      const str = decoded.stringTable[v - 1];
      if (/^[\w.$]+\/\d+$/.test(str) && !str.includes("ArrayList")) {
        insideBucket = false;
      }
    }
  }

  return tokens;
}

/**
 * Extract ALL java.lang.Long values from a GWT-RPC response, regardless of
 * context (not limited to ChannelBucket objects). Used as a fallback when
 * extractBucketTokens returns empty (e.g. bootstrap responses that have events
 * but no ChannelBucket objects in the wire format).
 */
function extractAllLongValues(decoded: GwtRpcDecodedResponse): string[] {
  const longTypeIdx = decoded.stringTable.findIndex((s) =>
    s.startsWith("java.lang.Long/")
  );
  if (longTypeIdx < 0) return [];

  const longRef = longTypeIdx + 1;
  const longs: string[] = [];

  for (let i = 0; i < decoded.values.length - 1; i++) {
    if (typeof decoded.values[i] === "string" && decoded.values[i + 1] === longRef) {
      longs.push(decoded.values[i] as string);
      i++; // skip the type ref
    }
  }

  return longs;
}

// --- GWT base-64 Long decoding ---

/**
 * GWT-RPC encodes java.lang.Long values as a compact base-64 string using the
 * character set: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$
 *
 * Most significant digit first, leading zero chars ('A') are stripped.
 * Decodes to an epoch-millisecond timestamp.
 */
const GWT_BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$";
const GWT_CHAR_MAP = new Map<string, number>();
for (let i = 0; i < GWT_BASE64_CHARS.length; i++) {
  GWT_CHAR_MAP.set(GWT_BASE64_CHARS[i], i);
}

function decodeGwtLong(encoded: string): number {
  let result = 0;
  for (const ch of encoded) {
    const val = GWT_CHAR_MAP.get(ch);
    if (val === undefined) return NaN;
    result = result * 64 + val;
  }
  return result;
}

/**
 * Inverse of decodeGwtLong — encodes a number as a GWT base-64 Long string.
 * EventService expects event IDs in this format, but parseChannelResult
 * returns them as decoded numbers.
 */
function encodeGwtLong(value: number): string {
  if (value === 0) return "A";
  let n = value;
  let result = "";
  while (n > 0) {
    result = GWT_BASE64_CHARS[n % 64] + result;
    n = Math.floor(n / 64);
  }
  return result;
}

/**
 * Extract the latest metadata Long timestamp from a ChannelResult GWT-RPC response.
 *
 * The ChannelResult object contains Long fields (b.c, b.j) that represent
 * channel configuration timestamps (created/modified), NOT event timestamps.
 * Previously used as a fallback for latestManagerReceiptTime, but this caused
 * stale config timestamps to be confused with event activity — resulting in
 * channels like CADCHNSERVER/CBT-BackupServer incorrectly showing as "confirmed inactive."
 *
 * Kept as a utility for diagnostic endpoints but no longer used for health checks.
 *
 * Returns the maximum decoded epoch-ms timestamp, or null if no valid Longs found.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extractMetadataTimestamp(decoded: GwtRpcDecodedResponse): number | null {
  const { values, stringTable } = decoded;
  if (values.length === 0) return null;

  const longTypeIdx = stringTable.findIndex((s) => s.startsWith("java.lang.Long/"));
  if (longTypeIdx < 0) return null;
  const longRef = longTypeIdx + 1; // 1-based

  let latest: number | null = null;

  for (let i = 0; i < values.length - 1; i++) {
    // Long values appear as: inline string, then Long type ref
    if (typeof values[i] === "string" && values[i + 1] === longRef) {
      const decoded_val = decodeGwtLong(values[i] as string);
      if (!isNaN(decoded_val) && decoded_val > 0) {
        if (latest === null || decoded_val > latest) {
          latest = decoded_val;
        }
      }
      i++; // skip the type ref
    }
  }

  return latest;
}

/**
 * Dump the complete response structure with type annotations for debugging.
 * Returns an annotated view of every value in the response.
 */
export function dumpResponseStructure(decoded: GwtRpcDecodedResponse): {
  annotated: { pos: number; raw: unknown; annotation: string }[];
  longValues: { pos: number; value: string }[];
  listPositions: { pos: number; type: string; size: number }[];
} {
  const { values, stringTable } = decoded;
  const typeDescriptorPattern = /^[\w.$]+\/\d+$/;
  const isTypeDesc = stringTable.map((s) => typeDescriptorPattern.test(s));

  const annotated: { pos: number; raw: unknown; annotation: string }[] = [];
  const longValues: { pos: number; value: string }[] = [];
  const listPositions: { pos: number; type: string; size: number }[] = [];

  const longTypeIdx = stringTable.findIndex((s) =>
    s.startsWith("java.lang.Long/")
  );
  const longRef = longTypeIdx >= 0 ? longTypeIdx + 1 : -1;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    let annotation = "";

    if (typeof v === "number" && v > 0 && v <= stringTable.length) {
      const str = stringTable[v - 1];
      if (isTypeDesc[v - 1]) {
        const shortName = str.split(".").pop()?.split("/")[0] ?? str;
        annotation = `TYPE: ${shortName}`;

        // Check if this is an ArrayList and capture the size
        if (str.includes("ArrayList")) {
          const nextVal = values[i + 1];
          if (typeof nextVal === "number") {
            listPositions.push({
              pos: i,
              type: "ArrayList",
              size: nextVal,
            });
          }
        }
      } else {
        annotation = `STR[${v}]: "${str}"`;
      }
    } else if (typeof v === "string") {
      annotation = `INLINE: "${v.slice(0, 30)}"`;
      // Check if this is followed by a Long type ref (response format: value, then type ref)
      if (i < values.length - 1 && values[i + 1] === longRef) {
        longValues.push({ pos: i, value: v });
      }
    } else if (typeof v === "number") {
      annotation = `NUM: ${v}`;
    } else {
      annotation = `OTHER: ${JSON.stringify(v)}`;
    }
    annotated.push({ pos: i, raw: v, annotation });
  }

  return { annotated, longValues, listPositions };
}

/**
 * Parse the ChannelService.getChannelInfo response into structured events.
 *
 * GWT-RPC responses encode objects as a flat values[] array interleaved with
 * type markers (string-table indices pointing to Java class descriptors).
 *
 * The response always contains FieldInfo metadata describing each column.
 * Field names are extracted dynamically from the string table by finding
 * camelCase identifiers preceded by their Title Case display name
 * (e.g., "End Time" → "endTime"). This avoids hardcoding field order.
 *
 * When events are present, they appear as repeated objects of a non-metadata
 * type. When the channel is empty, only metadata is returned.
 */
function parseChannelResult(decoded: GwtRpcDecodedResponse): ChannelResult {
  const { values, stringTable } = decoded;

  const bucketTokens = extractBucketTokens(decoded);
  const allLongs = extractAllLongValues(decoded).map(t => decodeGwtLong(t));

  // Event ID extraction: filter out non-event-ID Long values.
  // Bucket sequence numbers are small (< 1_000_000) and NOT real event IDs.
  // Epoch-ms timestamps are > 1_600_000_000_000 (year 2020+) and NOT event IDs.
  // Real ArcSight event IDs (CORR-Engine) are typically 6-12 digit numbers.
  const bucketTokenDecoded = new Set(bucketTokens.map(t => decodeGwtLong(t)));
  const eventIds = bucketTokens.length > 0
    ? allLongs.filter(id =>
        !isNaN(id) &&
        id > 1_000_000 &&             // Must be > 1M (skip bucket sequence numbers)
        id < 1_000_000_000_000 &&      // Must be < 1T (skip epoch-ms timestamps)
        !bucketTokenDecoded.has(id)    // Must not be a bucket token itself
      )
    : allLongs.filter(id =>
        !isNaN(id) &&
        id > 1_000_000 &&
        id < 1_000_000_000_000
      );

  if (SCAN_DEBUG && allLongs.length > 0) {
    console.log(
      `[channel-result] Long values: ${allLongs.length} total, ${eventIds.length} candidate event IDs, ` +
      `${bucketTokens.length} bucket tokens. All Longs: ${JSON.stringify(allLongs.slice(0, 10))}`
    );
  }

  if (values.length === 0) return { events: [], totalCount: 0, fieldNames: [] };

  const isType = stringTable.map(s => /^[\w.$]+\/\d+$/.test(s));

  // --- Diagnostic: dump string table contents for debugging warm-channel parsing ---
  const typeDescriptors = stringTable.filter((_, i) => isType[i]);
  const nonTypeStrings = stringTable.filter((_, i) => !isType[i]);
  const hasFV = stringTable.some(s => s.includes("FieldValue/"));
  const hasBucket = stringTable.some(s => s.includes("ChannelBucket/"));
  if (SCAN_DEBUG) {
    console.log(
      `[channel-result-diag] stringTable: ${stringTable.length} entries ` +
      `(${typeDescriptors.length} types, ${nonTypeStrings.length} non-type). ` +
      `values: ${values.length}. hasFV=${hasFV}, hasBucket=${hasBucket}`
    );
    if (nonTypeStrings.length > 0) {
      console.log(
        `[channel-result-diag] Non-type strings: ${JSON.stringify(nonTypeStrings.slice(0, 30))}`
      );
    }
  }
  const CATEGORIES = new Set(["device", "agent", "root", "source", "destination", "attacker", "target", "file", "custom", "threat", "dvGroup"]);

  // --- Step 1: Discover Field Headers and their Pointers ---
  // We map the absolute position of every FieldInfo object to its internal field name.
  const fiTypeIdx = stringTable.findIndex(s => s.includes("FieldInfo/"));
  const fiRef = fiTypeIdx >= 0 ? fiTypeIdx + 1 : -1;
  const fieldInfoPosMap = new Map<number, string>();
  const fieldNames: string[] = [];

  for (let i = 0; i < values.length; i++) {
    if (values[i] === fiRef) {
      // Find the internal name nearby (usually backward or forward depending on version)
      let name = "";
      for (let j = i - 4; j <= i + 4; j++) {
        if (j < 0 || j >= values.length || i === j) continue;
        const v = values[j];
        if (typeof v === "number" && v > 0 && v <= stringTable.length) {
          const s = stringTable[v - 1];
          if (/^[a-z][a-zA-Z0-9]{2,}$/.test(s) && !isType[v - 1] && !CATEGORIES.has(s)) {
            name = s;
            break;
          }
        }
      }
      if (name) {
        fieldInfoPosMap.set(i, name);
        if (!fieldNames.includes(name)) fieldNames.push(name);
      }
    }
  }

  if (SCAN_DEBUG && fieldInfoPosMap.size > 0) {
    console.log(
      `[channel-result-diag] Discovered ${fieldInfoPosMap.size} FieldInfo positions. fieldNames: [${fieldNames.join(", ")}]`
    );
  }

  // --- Step 2: Extract Cells using Pointer-Aware Logic ---
  const fvTypeIdx = stringTable.findIndex(s => s.includes("FieldValue/"));
  const fvRef = fvTypeIdx >= 0 ? fvTypeIdx + 1 : -1;
  const longTypeIdx = stringTable.findIndex(s => s.startsWith("java.lang.Long/"));
  const longRef = longTypeIdx >= 0 ? longTypeIdx + 1 : -1;

  const fvHitCount = SCAN_DEBUG && fvRef > 0 ? values.filter(v => v === fvRef).length : 0;
  if (SCAN_DEBUG) {
    console.log(
      `[channel-result-diag] fvRef=${fvRef} (fvTypeIdx=${fvTypeIdx}), longRef=${longRef}. ` +
      `fvRef appears ${fvHitCount}x in values[${values.length}]`
    );
  }

  function resolveRef(idx: number): unknown {
    if (idx < 0 || idx >= values.length) return null;
    let v = values[idx];
    if (typeof v === "number" && v < 0) {
      const backIdx = Math.abs(v);
      v = (backIdx < values.length) ? values[backIdx] : v;
    }
    return v;
  }

  function getVal(pos: number): string | number | null {
    const v = resolveRef(pos);
    if (typeof v === "string") {
      const next = values[pos + 1];
      return (next === longRef) ? decodeGwtLong(v) : v;
    }
    if (typeof v === "number" && v > 0 && v <= stringTable.length && !isType[v-1]) return stringTable[v-1];
    return (v === 0 || v === null) ? null : (typeof v === "number" ? v : null);
  }

  const events: ChannelEvent[] = [];
  const currentEvent: Record<string, string | number | null> = {};
  let fieldsInCurrent = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] === fvRef) {
      // FieldValue pattern: [Value, ..., PointerToFieldInfo, FieldValueMarker]
      // The pointer is usually 1 slot before the marker.
      const ptr = resolveRef(i - 1);
      const fieldName = typeof ptr === "number" ? fieldInfoPosMap.get(ptr) : undefined;

      if (fieldName) {
        let val = getVal(i - 3); // Primary value slot
        // Long values occupy 2 slots [encodedString, longRef], shifting value back by 1.
        // If getVal returned the longRef type descriptor, the real value is at i-4.
        if (val === longRef && longRef > 0) {
          val = getVal(i - 4);
        }
        currentEvent[fieldName] = val;
        fieldsInCurrent++;

        // If we have collected a full set of fields (or hit the first field again), start a new row.
        if (fieldsInCurrent >= fieldNames.length) {
          events.push({ fields: { ...currentEvent } });
          Object.keys(currentEvent).forEach(k => delete currentEvent[k]);
          fieldsInCurrent = 0;
        }
      } else if (SCAN_DEBUG) {
        console.log(
          `[channel-result-diag] fvRef@${i}: ptr=${ptr}, no fieldName match. ` +
          `Nearby values: [${values.slice(Math.max(0, i - 5), i + 3).map((v, j) => {
            const pos = Math.max(0, i - 5) + j;
            if (typeof v === "number" && v > 0 && v <= stringTable.length) return `${pos}:STR[${v}]="${stringTable[v - 1]?.slice(0, 40)}"`;
            if (typeof v === "string") return `${pos}:INLINE"${v.slice(0, 20)}"`;
            return `${pos}:${v}`;
          }).join(", ")}]`
        );
      }
    }
  }

  if (SCAN_DEBUG) {
    console.log(
      `[channel-result-diag] FieldValue extraction: ${events.length} complete events, ` +
      `${fieldsInCurrent} fields in partial event. ` +
      `currentEvent: ${JSON.stringify(currentEvent).slice(0, 200)}`
    );
  }

  // --- Compute data-section timestamps (always, regardless of events) ---
  // Only use Longs from the data section (after all FieldInfo markers).
  // Metadata Longs (channel creation/modification timestamps) appear before
  // FieldInfo markers and must be excluded to prevent contamination.
  let lastFiPos = -1;
  for (const pos of fieldInfoPosMap.keys()) {
    if (pos > lastFiPos) lastFiPos = pos;
  }
  const dataLongs: number[] = [];
  if (allLongs.length > 0) {
    for (let i = Math.max(0, lastFiPos + 1); i < values.length - 1; i++) {
      if (typeof values[i] === "string" && values[i + 1] === longRef) {
        const dv = decodeGwtLong(values[i] as string);
        if (!isNaN(dv) && dv > 0) dataLongs.push(dv);
        i++; // skip the type ref
      }
    }
  }
  const dataTimestamps = dataLongs.filter(v => v > 1_577_836_800_000 && v < 1_893_456_000_000);
  const nonBucketTimestamps = dataTimestamps.filter(v => !bucketTokenDecoded.has(v));
  const latestDataTimestamp = nonBucketTimestamps.length > 0 ? Math.max(...nonBucketTimestamps) : null;

  // --- Step 2a: Enrich events with timestamp fields if still missing ---
  const TIMESTAMP_FIELDS = ["managerReceiptTime", "endTime"];
  if (events.length > 0 && nonBucketTimestamps.length > 0) {
    for (const event of events) {
      for (const tsField of TIMESTAMP_FIELDS) {
        if (fieldNames.includes(tsField) && (event.fields[tsField] === null || event.fields[tsField] === undefined)) {
          if (latestDataTimestamp !== null) event.fields[tsField] = latestDataTimestamp;
        }
      }
    }
  }

  // --- Step 2b: String Table Value Extraction Fallback ---
  // When the FieldValue extraction finds 0 complete cells but the response IS warm
  // (has bucket tokens or Long values), the field values are in the string table
  // but our FieldValue pointer logic can't associate them. Extract value candidates
  // from the string table by elimination.
  if (fieldsInCurrent === 0 && events.length === 0 && fieldNames.length > 0 && nonTypeStrings.length > fieldNames.length) {
    if (SCAN_DEBUG) console.log(`[channel-result-diag] Attempting string-table value extraction fallback...`);

    // Build sets of strings to exclude: field names, display names, filter expressions, categories
    const fieldNameSet = new Set(fieldNames);
    const excludeSet = new Set<string>();

    for (const s of nonTypeStrings) {
      // Field names (camelCase identifiers)
      if (fieldNameSet.has(s)) { excludeSet.add(s); continue; }
      // Categories (short lowercase words that are FieldInfo metadata)
      if (CATEGORIES.has(s)) { excludeSet.add(s); continue; }
      // Title Case display names ("End Time", "Agent Name", etc.)
      if (/^[A-Z][a-z]/.test(s) && /\s/.test(s) && s.length < 40) { excludeSet.add(s); continue; }
      // Filter expressions containing EQ/AND operators
      if (/'[\w.]+'.*(?:EQ|NE|GT|LT|CONTAINS)/.test(s)) { excludeSet.add(s); continue; }
      // FieldSet path strings
      if (s.startsWith("/All Field Sets/") || s.startsWith("/All ")) { excludeSet.add(s); continue; }
      // GWT module/service identifiers
      if (s.includes("com.arcsight") || s.includes("java.")) { excludeSet.add(s); continue; }
    }

    // Value candidates: non-type strings that aren't metadata
    const valueCandidates = nonTypeStrings.filter(s => !excludeSet.has(s) && s.length > 0);
    if (SCAN_DEBUG) console.log(
      `[channel-result-diag] Value candidates (${valueCandidates.length}): ${JSON.stringify(valueCandidates.slice(0, 20))}`
    );

    // Strategy: Map value candidates to field names using their position in the values array.
    // Walk the values array and build an ordered list of string-table value references
    // that appear AFTER all FieldInfo markers (i.e., in the data section).
    if (valueCandidates.length > 0) {
      const valueCandidateSet = new Set(valueCandidates);

      // Find the last FieldInfo marker position (data values come after metadata)
      let lastFieldInfoPos = -1;
      for (let i = 0; i < values.length; i++) {
        if (values[i] === fiRef) lastFieldInfoPos = i;
      }

      // Collect ordered value refs from the data section
      const orderedValues: { pos: number; value: string | number | null }[] = [];
      for (let i = lastFieldInfoPos + 1; i < values.length; i++) {
        const v = values[i];
        // String table reference to a value candidate
        if (typeof v === "number" && v > 0 && v <= stringTable.length && !isType[v - 1]) {
          const s = stringTable[v - 1];
          if (valueCandidateSet.has(s)) {
            orderedValues.push({ pos: i, value: s });
          }
        }
        // Inline string (possibly a Long value)
        if (typeof v === "string") {
          if (i + 1 < values.length && values[i + 1] === longRef && longRef > 0) {
            orderedValues.push({ pos: i, value: decodeGwtLong(v) });
            i++; // skip longRef
          } else {
            // Raw inline string value
            orderedValues.push({ pos: i, value: v });
          }
        }
        // Null marker (0)
        if (v === 0 && i > lastFieldInfoPos + 2) {
          // Only count 0 as null if it's in a plausible data region
          // (not immediately after a type descriptor or array size)
          const prev = i > 0 ? values[i - 1] : undefined;
          const isPrevType = typeof prev === "number" && prev > 0 && prev <= stringTable.length && isType[prev - 1];
          if (!isPrevType) {
            orderedValues.push({ pos: i, value: null });
          }
        }
      }

      if (SCAN_DEBUG) console.log(
        `[channel-result-diag] Ordered data values after FieldInfo (${orderedValues.length}): ` +
        `${JSON.stringify(orderedValues.slice(0, 20).map(v => v.value))}`
      );

      // If we have roughly the same number of values as fields, try a 1:1 mapping
      if (orderedValues.length >= fieldNames.length && orderedValues.length <= fieldNames.length * 3) {
        const fallbackEvent: Record<string, string | number | null> = {};
        // Take the first N values where N = fieldNames.length
        for (let fi = 0; fi < fieldNames.length && fi < orderedValues.length; fi++) {
          fallbackEvent[fieldNames[fi]] = orderedValues[fi].value;
        }
        const nonNullCount = Object.values(fallbackEvent).filter(v => v !== null).length;
        if (SCAN_DEBUG) console.log(
          `[channel-result-diag] String-table fallback: mapped ${fieldNames.length} fields, ` +
          `${nonNullCount} non-null. Sample: ${JSON.stringify(fallbackEvent).slice(0, 300)}`
        );
        // Only use if we got at least 3 non-null values (meaningful data)
        if (nonNullCount >= 3) {
          events.push({ fields: fallbackEvent });
        }
      }
    }
  }

  // --- Fallback Strategy: Filter Expression ---
  const mined: Record<string, string | number | null> = {};
  // Always mine well-known fields from filter expressions, even if the FieldSet
  // didn't include them in the GWT-RPC FieldInfo headers.
  const WELL_KNOWN_FIELDS = new Set([
    ...fieldNames,
    "agentHostName", "agentAddress", "agentName", "agentId",
    "customerName", "deviceHostName", "deviceVendor", "deviceProduct",
  ]);
  const eqPattern = /'(\w+)'\s+EQ\s+(?:\[IgnoreCase\]\s*)?"([^"]+)"/g;
  for (const s of stringTable) {
    let m; while ((m = eqPattern.exec(s)) !== null) if (WELL_KNOWN_FIELDS.has(m[1])) mined[m[1]] = m[2];
  }

  // Register any newly-mined field names so downstream sees them
  for (const k of Object.keys(mined)) {
    if (!fieldNames.includes(k)) fieldNames.push(k);
  }

  if (events.length === 0 && Object.keys(mined).length > 0) {
    events.push({ fields: mined });
  } else {
    for (const e of events) {
      for (const [k, v] of Object.entries(mined)) {
        if (e.fields[k] === null || e.fields[k] === undefined) e.fields[k] = v;
      }
    }
  }

  const isFallbackOnly = events.length <= 1 && fieldsInCurrent === 0 && fvHitCount === 0;
  return { events, totalCount: events.length, fieldNames, eventIds, isFilterExpressionOnly: isFallbackOnly, latestDataTimestamp };
}

// --- REST API Search Helpers ---

/**
 * Extract the full filter expression from a GWT-RPC response string table.
 *
 * The ChannelService.getChannelInfo response includes the channel's filter
 * expression in its string table (e.g. "'customerName' EQ \"Cadeploy\" AND 'deviceHostName' EQ \"Hyderabad-200E\"").
 * We extract this to use as a QueryService search query.
 */
function extractFilterExpression(decoded: GwtRpcDecodedResponse | null): string | null {
  if (!decoded) return null;
  const { stringTable } = decoded;

  // Look for strings that contain ArcSight filter syntax ('field' EQ/NE/CONTAINS "value")
  const filterPattern = /'[\w.]+'\s+(?:EQ|NE|GT|LT|GE|LE|CONTAINS|STARTSWITH)\s+"[^"]*"/;
  for (const s of stringTable) {
    if (filterPattern.test(s) && s.length > 10) {
      return s;
    }
  }

  // Fallback: reconstruct from individual EQ clauses
  const eqPattern = /'(\w+)'\s+EQ\s+"([^"]+)"/g;
  const clauses: string[] = [];
  for (const s of stringTable) {
    let m;
    while ((m = eqPattern.exec(s)) !== null) {
      clauses.push(`'${m[1]}' EQ "${m[2]}"`);
    }
  }

  return clauses.length > 0 ? clauses.join(" AND ") : null;
}

/**
 * Convert a REST API SearchResult to our ChannelResult interface.
 */
function mapSearchResultToChannelResult(
  searchResult: SearchResult,
  fieldNames: string[]
): ChannelResult {
  return {
    events: searchResult.events.map(evt => ({
      fields: Object.fromEntries(
        fieldNames.map(f => [f, (evt[f] as string | number | null) ?? null])
      ),
    })),
    totalCount: searchResult.totalCount,
    fieldNames,
    eventIds: searchResult.events
      .map(evt => Number(evt.eventId))
      .filter(id => !isNaN(id)),
    isFilterExpressionOnly: false,
  };
}

/**
 * Internal helper to resolve resource IDs found in event fields.
 */
async function enrichWithResolvedNames(auth: SessionAuth, result: ChannelResult): Promise<ChannelResult> {
  if (result.events.length === 0) return result;

  const RESOURCE_FIELDS = ["agentName", "agentHostName", "agentAddress", "customerName", "deviceVendor", "deviceProduct", "deviceHostName", "name", "agent", "agentId", "customer"];
  const idsToResolve: string[] = [];

  // Collect potential resource IDs (Base64 patterns OR large numbers)
  for (const event of result.events) {
    for (const field of RESOURCE_FIELDS) {
      const val = event.fields[field];
      if (typeof val === "string") {
          if (val.length > 15 && val.includes("=")) idsToResolve.push(val);
          else if (/^\d{5,12}$/.test(val)) idsToResolve.push(val);
      } else if (typeof val === "number" && val > 100000) {
          idsToResolve.push(String(val));
      }
    }
  }

  if (idsToResolve.length === 0) return result;

  const resolutionMap = await resolveResourceIds(auth, idsToResolve);
  
  // Apply resolved names back to the events
  for (const event of result.events) {
    for (const field of RESOURCE_FIELDS) {
      const val = event.fields[field];
      const key = String(val);
      if (resolutionMap[key]) {
        event.fields[field] = resolutionMap[key];
      }
    }
  }

  return result;
}

/**
 * Fetch active channel events via ChannelService.getChannelInfo.
 *
 * Authenticates via Phoenix GWT-RPC login (same token as DataMonitorV2Service).
 * Handles 401 by clearing the Phoenix token and retrying once.
 */
export async function getActiveChannelEvents(
  auth: SessionAuth,
  channelId?: string
): Promise<ChannelResult> {
  const token = auth.phoenixToken;

  // Call with current bucket tokens (empty on first call → metadata only)
  const decoded = await callGetChannelInfo(token, auth.phoenixCookies, lastBucketTokens, channelId);

  // No channelId configured — return empty result gracefully
  if (!decoded) {
    return {
      events: [],
      totalCount: 0,
      fieldNames: [],
    };
  }

  // Extract new bucket tokens for next poll
  const newTokens = extractBucketTokens(decoded);

  if (newTokens.length > 0) {
    lastBucketTokens = newTokens;
  }

  const rawResult = parseChannelResult(decoded);
  const result = await enrichWithResolvedNames(auth, rawResult);

  // If first call returned 0 events and we got tokens, immediately poll again.
  // This handles the cold-start case where lastBucketTokens was empty.
  if (
    result.events.length === 0 &&
    newTokens.length > 0 &&
    lastBucketTokens.length > 0
  ) {
    console.log(
      `[channel-service] Initial call returned metadata only, re-polling with ${lastBucketTokens.length} bucket token(s)...`
    );
    const decoded2 = await callGetChannelInfo(token, auth.phoenixCookies, lastBucketTokens, channelId);
    if (!decoded2) {
      return { events: [], totalCount: 0, fieldNames: [] };
    }
    const newTokens2 = extractBucketTokens(decoded2);
    if (newTokens2.length > 0) {
      lastBucketTokens = newTokens2;
    }
    return parseChannelResult(decoded2);
  }

  return result;
}

/**
 * Fetch the raw decoded GWT-RPC response from ChannelService.getChannelInfo.
 * Returns { values, stringTable } for inspection via ?raw=true.
 */
export async function getActiveChannelEventsRaw(
  auth: SessionAuth,
  channelId?: string
): Promise<GwtRpcDecodedResponse> {
  const emptyResponse: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };
  return (await callGetChannelInfo(auth.phoenixToken, auth.phoenixCookies, lastBucketTokens, channelId)) ?? emptyResponse;
}

/**
 * Diagnostic: Run the two-phase bucket polling protocol and return results.
 * Phase 1: Empty buckets → metadata + bucket tokens
 * Phase 2: With bucket tokens → actual events
 */
export async function probeBucketPolling(auth: SessionAuth, channelId?: string): Promise<{
  phase1: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string };
  phase2: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
  phase3?: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
}> {
  const emptyDecoded: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };
  const token = auth.phoenixToken;

  // Phase 1: empty buckets
  const decoded1 = (await callGetChannelInfo(token, auth.phoenixCookies, [], channelId)) ?? emptyDecoded;
  const tokens1 = extractBucketTokens(decoded1);
  const parsed1 = parseChannelResult(decoded1);
  const reqBody1 = (decoded1 as { _requestBody?: string })._requestBody ?? "";
  const hasBucket1 = decoded1.stringTable.some((s) => s.includes("ChannelBucket/"));

  // Phase 2: with bucket tokens from phase 1
  let phase2: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
  try {
    const decoded2 = (await callGetChannelInfo(token, auth.phoenixCookies, tokens1, channelId)) ?? emptyDecoded;
    const tokens2 = extractBucketTokens(decoded2);
    const parsed2 = parseChannelResult(decoded2);
    const reqBody2 = (decoded2 as { _requestBody?: string })._requestBody ?? "";
    const hasBucket2 = decoded2.stringTable.some((s) => s.includes("ChannelBucket/"));
    phase2 = { tokens: tokens2, eventCount: parsed2.events.length, hasBucketType: hasBucket2, fieldNames: parsed2.fieldNames, raw: decoded2, requestBody: reqBody2 };
  } catch (err) {
    phase2 = { error: err instanceof Error ? err.message : String(err) };
  }

  // Phase 3: If Phase 2 returned 0 events, wait 3s and try again (server buffering)
  let phase3: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string } | undefined;
  const p2Events = "eventCount" in phase2 ? phase2.eventCount : 0;
  if (p2Events === 0) {
    try {
      await new Promise((r) => setTimeout(r, 3000));
      const tokensForP3 = "tokens" in phase2 && phase2.tokens.length > 0 ? phase2.tokens : tokens1;
      const decoded3 = (await callGetChannelInfo(token, auth.phoenixCookies, tokensForP3, channelId)) ?? emptyDecoded;
      const tokens3 = extractBucketTokens(decoded3);
      const parsed3 = parseChannelResult(decoded3);
      const reqBody3 = (decoded3 as { _requestBody?: string })._requestBody ?? "";
      const hasBucket3 = decoded3.stringTable.some((s) => s.includes("ChannelBucket/"));
      phase3 = { tokens: tokens3, eventCount: parsed3.events.length, hasBucketType: hasBucket3, fieldNames: parsed3.fieldNames, raw: decoded3, requestBody: reqBody3 };
    } catch (err) {
      phase3 = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    phase1: { tokens: tokens1, eventCount: parsed1.events.length, hasBucketType: hasBucket1, fieldNames: parsed1.fieldNames, raw: decoded1, requestBody: reqBody1 },
    phase2,
    phase3,
  };
}

// --- Channel scan (probe each channel for events) ---

export interface ChannelScanResult {
  channelId: string;
  channelName: string;
  groupName: string;
  subType: string;
  hasEvents: boolean;
  eventCount: number;
  fieldNames: string[];
  eventIds?: number[];
  /** Epoch ms of the most recent managerReceiptTime across all events. Null if no events or field missing. */
  latestManagerReceiptTime: number | null;
  /** Epoch ms of the latest GWT Long metadata timestamp (channel config, NOT event time).
   *  Useful as a fallback signal but should NOT be confused with event timestamps. */
  metadataTimestamp?: number | null;
  /** Event field values extracted during scan (e.g. deviceVendor, agentName). */
  eventFields?: Record<string, string | number | null>;
  error?: string;
}

/** Progress state for an in-flight v2 scan — exposed via getScanProgress() for per-window results. */
export interface ScanProgress {
  results: ChannelScanResult[];
  totalChannels: number;
  scannedChannels: number;
  windowsCompleted: number;
  totalWindows: number;
  startedAt: string;
  isComplete: boolean;
}

let scanProgress: ScanProgress | null = null;
/** Returns the current in-flight scan progress, or null if no scan is running. */
export function getScanProgress(): ScanProgress | null { return scanProgress; }

/** Cache of last completed scan results for incremental scanning.
 *  Channels with a recent MRT (< INCREMENTAL_FRESHNESS_MS) are reused
 *  instead of re-scanned, reducing ESM load on repeat scans. */
let lastCompletedScanResults: ChannelScanResult[] = [];
let scanCycleCount = 0;
const INCREMENTAL_FRESHNESS_MS = 10 * 60_000; // 10 minutes — matches scan cache TTL
const FULL_SCAN_EVERY_N = 3; // Do a full (non-incremental) scan every 3rd cycle

/** Extract the latest managerReceiptTime (epoch ms) from parsed channel events.
 *  GWT-RPC returns java.lang.Long values as strings in the string table,
 *  so we handle both string and number types. String values may be either
 *  GWT base-64 encoded Longs or plain numeric strings.
 */
function extractLatestManagerReceiptTime(parsed: ChannelResult): number | null {
  let latest: number | null = null;
  for (const event of parsed.events) {
    const mrt = event.fields["managerReceiptTime"];
    let value: number | null = null;
    if (typeof mrt === "number" && mrt > 0) {
      value = mrt;
    } else if (typeof mrt === "string" && mrt.length > 0) {
      // Try plain numeric string first (e.g. "1740373197000")
      const parsed_num = Number(mrt);
      if (!isNaN(parsed_num) && parsed_num > 0) {
        value = parsed_num;
      } else {
        // Try GWT base-64 Long decoding (e.g. "ZyGFEAA")
        const gwt_val = decodeGwtLong(mrt);
        if (!isNaN(gwt_val) && gwt_val > 0) {
          value = gwt_val;
        }
      }
    }
    if (value !== null && (latest === null || value > latest)) {
      latest = value;
    }
  }
  // Fallback: use the max data-section Long timestamp when per-event
  // extraction fails. This bypasses the unreliable FieldValue pointer
  // logic and reads timestamps directly from the GWT wire format.
  if (latest === null && parsed.latestDataTimestamp != null) {
    latest = parsed.latestDataTimestamp;
  }
  return latest;
}

/** Phase 1 result per channel: metadata + bucket tokens for Phase 2 */
interface Phase1Result {
  channelId: string;
  tokens: string[];
  fieldNames: string[];
  eventIds?: number[];
  eventCount: number;
  hasBucketType: boolean;
  latestManagerReceiptTime: number | null;
  isFilterExpressionOnly: boolean;
  eventFields?: Record<string, string | number | null>;
}

/**
 * Scan all active channels to determine which ones contain events.
 *
 * Uses a **sliding window** of 8 channels to stay under the ESM per-session
 * limit of 10 open event channels. Each window:
 *   Pass 1: getChannelInfo with empty buckets → open channels, get metadata + tokens
 *   Wait:   3 seconds for the server to buffer events
 *   Pass 2: getChannelInfo with bucket tokens → get events (for channels needing it)
 *   Close:  stopViewChannel for all channels in the window
 *
 * Results accumulate across windows.
 */
export async function scanAllChannelEvents(
  auth: SessionAuth
): Promise<{ results: ChannelScanResult[]; scannedAt: string }> {
  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;
  const emptyDecoded: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };

  try {
    console.log("[channel-scan] Discovering channels...");
    const { groups } = await getAllActiveChannels(auth);

    const seen = new Set<string>();
    const channels: { channelId: string; displayName: string; groupName: string; subType: string }[] = [];
    for (const g of groups) {
      for (const ch of g.channels) {
        if (seen.has(ch.resourceId)) continue;
        seen.add(ch.resourceId);
        channels.push({
          channelId: ch.resourceId,
          displayName: ch.displayName,
          groupName: g.name,
          subType: ch.subType,
        });
      }
    }

    // --- Sliding window: process channels in groups of WINDOW_SIZE ---
    const WINDOW_SIZE = 8; // Leave 2 slots for non-scan channel views (ESM limit: 10)
    const phase1Map = new Map<string, Phase1Result>();
    const errorMap = new Map<string, string>();
    const phase2Map = new Map<string, { eventCount: number; fieldNames: string[]; latestManagerReceiptTime: number | null; isFilterExpressionOnly: boolean; eventFields?: Record<string, string | number | null> }>();

    const totalWindows = Math.ceil(channels.length / WINDOW_SIZE);
    console.log(`[channel-scan] Scanning ${channels.length} channel(s) in ${totalWindows} window(s) of ${WINDOW_SIZE}...`);

    for (let w = 0; w < channels.length; w += WINDOW_SIZE) {
      const window = channels.slice(w, w + WINDOW_SIZE);
      const windowNum = Math.floor(w / WINDOW_SIZE) + 1;
      console.log(`[channel-scan] Window ${windowNum}/${totalWindows}: ${window.length} channel(s)`);

      // --- Pass 1: Open channels in this window (4 concurrent) ---
      for (let i = 0; i < window.length; i += 4) {
        const batch = window.slice(i, i + 4);
        const batchResults = await Promise.allSettled(
          batch.map(async (ch): Promise<Phase1Result> => {
            const decoded = (await callGetChannelInfo(token, auth.phoenixCookies, [], ch.channelId)) ?? emptyDecoded;
            const tokens = extractBucketTokens(decoded);
            const parsed = parseChannelResult(decoded);
            const hasBucketType = decoded.stringTable.some((s) => s.includes("ChannelBucket/"));
            const eventMrt = extractLatestManagerReceiptTime(parsed);
            subscribedChannels.add(ch.channelId);
            return {
              channelId: ch.channelId,
              tokens,
              fieldNames: parsed.fieldNames,
              eventCount: parsed.events.length,
              hasBucketType,
              latestManagerReceiptTime: eventMrt,
              isFilterExpressionOnly: parsed.isFilterExpressionOnly ?? false,
              eventFields: parsed.events[0]?.fields,
            };
          })
        );

        for (let j = 0; j < batchResults.length; j++) {
          const r = batchResults[j];
          const ch = batch[j];
          if (r.status === "fulfilled") {
            phase1Map.set(ch.channelId, r.value);
          } else {
            errorMap.set(ch.channelId, r.reason instanceof Error ? r.reason.message : String(r.reason));
          }
        }
      }

      // --- Pass 2: Poll channels in this window that need events ---
      const needsPhase2 = window.filter((ch) => {
        const p1 = phase1Map.get(ch.channelId);
        return p1 && (p1.eventCount === 0 || p1.isFilterExpressionOnly);
      });

      if (needsPhase2.length > 0) {
        console.log(`[channel-scan] Window ${windowNum}: Waiting 5s for server to buffer events...`);
        await new Promise((r) => setTimeout(r, 5000));

        for (let i = 0; i < needsPhase2.length; i += 4) {
          const batch = needsPhase2.slice(i, i + 4);
          const batchResults = await Promise.allSettled(
            batch.map(async (ch) => {
              const p1 = phase1Map.get(ch.channelId)!;
              const decoded = (await callGetChannelInfo(token, auth.phoenixCookies, p1.tokens, ch.channelId)) ?? emptyDecoded;
              const parsed = parseChannelResult(decoded);
              const eventMrt = extractLatestManagerReceiptTime(parsed);
              return {
                channelId: ch.channelId,
                eventCount: parsed.events.length,
                fieldNames: parsed.fieldNames.length > 0 ? parsed.fieldNames : p1.fieldNames,
                latestManagerReceiptTime: eventMrt,
                isFilterExpressionOnly: parsed.isFilterExpressionOnly ?? false,
                eventFields: parsed.events[0]?.fields,
              };
            })
          );

          for (let j = 0; j < batchResults.length; j++) {
            const r = batchResults[j];
            const ch = batch[j];
            if (r.status === "fulfilled") {
              phase2Map.set(ch.channelId, r.value);
            } else {
              const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
              if (!errorMap.has(ch.channelId)) {
                errorMap.set(ch.channelId, `Phase 2: ${errMsg}`);
              }
            }
          }
        }
      }

      // --- Close all channels in this window to free server-side slots ---
      const windowIds = window.map((ch) => ch.channelId);
      console.log(`[channel-scan] Window ${windowNum}: Closing ${windowIds.length} channel(s)...`);
      for (let i = 0; i < windowIds.length; i += 4) {
        const batch = windowIds.slice(i, i + 4);
        await Promise.allSettled(
          batch.map((chId) => callStopViewChannel(token, sessionCookies, chId))
        );
      }
    }

    const withTokens = [...phase1Map.values()].filter((p) => p.tokens.length > 0).length;
    const phase2Events = [...phase2Map.values()].filter((p) => p.eventCount > 0).length;
    console.log(
      `[channel-scan] All windows done: ${phase1Map.size} OK, ${errorMap.size} errors. ` +
      `Bucket tokens: ${withTokens}, Phase 2 events: ${phase2Events}`
    );

    // --- Build final results ---
    const results: ChannelScanResult[] = channels.map((ch) => {
      const err = errorMap.get(ch.channelId);
      if (err) {
        return {
          channelId: ch.channelId,
          channelName: ch.displayName,
          groupName: ch.groupName,
          subType: ch.subType,
          hasEvents: false,
          eventCount: 0,
          fieldNames: phase1Map.get(ch.channelId)?.fieldNames ?? [],
          latestManagerReceiptTime: null,
          error: err,
        };
      }

      const p2 = phase2Map.get(ch.channelId);
      const p1 = phase1Map.get(ch.channelId);

      const eventCount = p2?.eventCount ?? p1?.eventCount ?? 0;
      const fieldNames = (p2?.fieldNames?.length ? p2.fieldNames : p1?.fieldNames) ?? [];
      const latestManagerReceiptTime = p2?.latestManagerReceiptTime ?? p1?.latestManagerReceiptTime ?? null;

      const eventFields = (p2 && !p2.isFilterExpressionOnly)
        ? p2.eventFields
        : (p1 && !p1.isFilterExpressionOnly)
          ? p1.eventFields
          : p2?.eventFields ?? p1?.eventFields;

      // Log diagnostic info for channels that ended up with 0 events
      if (eventCount === 0 && !err) {
        console.log(
          `[channel-scan] "${ch.displayName}" (${ch.channelId.slice(0, 16)}...): ` +
          `0 events after all phases. P1: tokens=${p1?.tokens.length ?? 0}, hasBucket=${p1?.hasBucketType ?? false}. ` +
          `P2: ${p2 ? `events=${p2.eventCount}` : "skipped"}.`
        );
      }

      return {
        channelId: ch.channelId,
        channelName: ch.displayName,
        groupName: ch.groupName,
        subType: ch.subType,
        hasEvents: eventCount > 0,
        eventCount,
        fieldNames,
        latestManagerReceiptTime,
        eventFields: eventFields && Object.keys(eventFields).length > 0 ? eventFields : undefined,
      };
    });

    const totalWithEvents = results.filter((r) => r.hasEvents).length;
    console.log(
      `[channel-scan] Done: ${totalWithEvents}/${results.length} channels have events`
    );
    return { results, scannedAt: new Date().toISOString() };
  } finally {
    await closeAllOpenChannels(token, sessionCookies).catch(() => {});
  }
}

// --- Channel Group / Listing types ---

export interface ChannelGroup {
  name: string;
  resourceId: string;
  path: string;
  description: string | null;
}

export interface ActiveChannel {
  displayName: string;
  resourceId: string;
  path: string;
  subType: string;
  lastUpdateTime: string | null;
  description: string | null;
  groupName: string;
}

// --- GroupService calls ---

/**
 * Helper: make a GWT-RPC POST to a Phoenix service endpoint.
 * Centralises headers, dispatcher, timeout, and error handling.
 */
async function phoenixRpc(
  serviceUrl: string,
  requestBody: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PHOENIX_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "Content-Type": "text/x-gwt-rpc; charset=utf-8",
      "X-GWT-Module-Base": MODULE_BASE,
      "X-GWT-Permutation": PHOENIX_PERMUTATION,
    };
    if (sessionCookies) {
      headers["Cookie"] = sessionCookies;
    }

    let res: Response;
    try {
      res = await fetch(serviceUrl, {
        method: "POST",
        headers,
        body: requestBody,
        signal: controller.signal,
        // @ts-expect-error -- undici dispatcher is not in the standard RequestInit type
        dispatcher: phoenixDispatcher,
      });
    } catch (err) {
      clearTimeout(timer);
      if (
        attempt === 0 &&
        err instanceof TypeError &&
        String(err).includes("fetch failed")
      ) {
        console.warn("[phoenix-rpc] fetch failed, retrying in 2s...");
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `GWT-RPC call failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
      );
    }

    const rawText = await res.text();
    return decodeGwtRpcResponse(rawText);
  }

  // Unreachable — the loop always returns or throws — but satisfies TypeScript
  throw new Error("Phoenix RPC failed after retries");
}

/**
 * Call GroupService.getRootGroupsForResourceType(token, ResourceType=33).
 *
 * ResourceType ordinal 33 = ActiveChannel. Returns group references for
 * root-level channel groups (typically just "All Active Channels").
 */
async function callGetRootGroups(
  token: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.GroupService",
    method: "getRootGroupsForResourceType",
    moduleBaseUrl: MODULE_BASE,
    strongName: GROUP_STRONG_NAME,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "enum",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
      ordinal: 33, // ActiveChannel
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/GroupService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

/** Debug: expose raw getRootGroupsForResourceType response for inspection */
export async function debugGetRootGroups(auth: SessionAuth): Promise<{
  raw: GwtRpcDecodedResponse;
  parsed: ChannelGroup[];
}> {
  const token = auth.phoenixToken;
  const raw = await callGetRootGroups(token);
  const parsed = parseGroupResponse(raw);
  return { raw, parsed };
}

/** Debug: test channel listing for a specific group name */
export async function debugGetChannelsForGroup(auth: SessionAuth, groupName: string): Promise<{
  rootGroups: ChannelGroup[];
  subGroups: ChannelGroup[];
  targetGroup: ChannelGroup | null;
  channelRaw: GwtRpcDecodedResponse | null;
  channels: ActiveChannel[];
}> {
  const token = auth.phoenixToken;

  // Step 1: get root groups
  const rootDecoded = await callGetRootGroups(token);
  const rootGroups = parseGroupResponse(rootDecoded);
  const root = rootGroups.reduce((a, b) =>
    a.path.split("/").length <= b.path.split("/").length ? a : b
  );

  // Step 2: get sub-groups
  const subGroupDecoded = await callGetGroupChildren(token, root.resourceId, root.path);
  const subGroups = parseGroupResponse(subGroupDecoded).filter(
    (g) => g.path.startsWith(root.path + "/") && g.path !== root.path
  );

  // Step 3: find and fetch channels for the target group
  const targetGroup = subGroups.find(
    (g) => g.name.toLowerCase().includes(groupName.toLowerCase())
  ) ?? null;

  if (!targetGroup) {
    return { rootGroups, subGroups, targetGroup: null, channelRaw: null, channels: [] };
  }

  const channelRaw = await callGetChannelGroupChildren(token, targetGroup.resourceId, targetGroup.path);
  const channels = parseChannelListResponse(channelRaw, targetGroup.name, targetGroup.path);
  return { rootGroups, subGroups, targetGroup, channelRaw, channels };
}

/**
 * Call GroupService.getGroupChildrenResourcesWithRequest(token, groupRef, pagingRequest).
 *
 * Returns sub-groups under a parent group (e.g. "Administration", "System", etc.).
 * Uses MAX_INT limit and no sorting to fetch all groups at once.
 */
async function callGetGroupChildren(
  token: string,
  groupResourceId: string,
  groupPath: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.GroupService",
    method: "getGroupChildrenResourcesWithRequest",
    moduleBaseUrl: MODULE_BASE,
    strongName: GROUP_STRONG_NAME,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    // ResourceReference for the parent group
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
      fields: [
        { kind: "string", value: groupResourceId },
        { kind: "string", value: null },
        {
          kind: "enum",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
          ordinal: 0, // Group
        },
        { kind: "string", value: groupPath },
      ],
    },
    // PagingListRequest: limit=MAX_INT, no sorting, offset=0
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.paging.PagingListRequest/2455014551",
      fields: [
        { kind: "int", value: 2147483647 }, // limit = MAX_INT
        {
          kind: "list",
          typeDescriptor: "java.util.ArrayList/4159755760",
          items: [], // no sorting
        },
        { kind: "int", value: 0 }, // offset
      ],
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/GroupService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

/**
 * Call ChannelService.getGroupChildrenResourcesWithRequest(token, groupRef, pagingRequest).
 *
 * Returns Channel objects under a group, sorted by display_name ascending.
 * Uses limit=50 to match browser behaviour.
 */
async function callGetChannelGroupChildren(
  token: string,
  groupResourceId: string,
  groupPath: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ChannelService",
    method: "getGroupChildrenResourcesWithRequest",
    moduleBaseUrl: MODULE_BASE,
    strongName: CHANNEL_STRONG_NAME,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    // ResourceReference for the parent group
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
      fields: [
        { kind: "string", value: groupResourceId },
        { kind: "string", value: null },
        {
          kind: "enum",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
          ordinal: 0, // Group
        },
        { kind: "string", value: groupPath },
      ],
    },
    // PagingListRequest: limit=50, sorted by display_name ASC
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.paging.PagingListRequest/2455014551",
      fields: [
        { kind: "int", value: 50 }, // limit
        {
          kind: "list",
          typeDescriptor: "java.util.ArrayList/4159755760",
          items: [
            {
              kind: "object",
              typeDescriptor:
                "com.arcsight.product.esmclient.service.v1.model.sorting.SortInfo/776413725",
              fields: [
                { kind: "string", value: "resource:display_name" },
                {
                  kind: "enum",
                  typeDescriptor:
                    "com.arcsight.product.esmclient.service.v1.model.sorting.SortOrder/1726127846",
                  ordinal: 0, // ASC
                },
              ],
            },
          ],
        },
        { kind: "int", value: 0 }, // offset
        { kind: "int", value: 0 }, // extra field (observed in browser captures)
      ],
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ChannelService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

// --- Response parsing for Group/Channel listing ---

/**
 * Parse a GroupService response into ChannelGroup objects.
 *
 * GWT-RPC encodes Group resources with fields: name, resourceId, path, description
 * interleaved with type descriptors in the flat values array.
 * We extract non-type-descriptor strings as candidate field values.
 */
function parseGroupResponse(decoded: GwtRpcDecodedResponse): ChannelGroup[] {
  const { stringTable } = decoded;
  if (stringTable.length === 0) return [];

  const typeDescPattern = /^[\w.$]+\/\d+$/;
  const isTypeDesc = stringTable.map((s) => typeDescPattern.test(s));

  // GWT-RPC adds strings to the table in serialization order.
  // For each Group, its ResourceReference fields' strings appear first,
  // then the Group's own field strings follow. This means a path string
  // is always closely preceded by its resource ID in the string table.
  //
  // Strategy: find path strings (start with "/"), then scan backwards
  // in the string table for the closest resource ID.

  function isResourceId(s: string): boolean {
    // Skip very short strings and common non-ID patterns
    if (s.length < 10) return false;
    // Base64-encoded IDs (e.g. "0qGuDB-sAABCAOMeKGS1xDg==")
    if (/^[\w+/=-]{10,}={1,2}$/.test(s)) return true;
    // Numeric IDs (e.g. "01000100010001033")
    if (/^\d{10,}$/.test(s)) return true;
    return false;
  }

  const groups: ChannelGroup[] = [];

  for (let i = 0; i < stringTable.length; i++) {
    if (isTypeDesc[i]) continue;
    const path = stringTable[i];
    if (!path.startsWith("/")) continue;

    const name = path.split("/").filter(Boolean).pop() ?? "";

    // Scan backwards for resource ID
    let resourceId = "";
    for (let j = i - 1; j >= 0; j--) {
      if (isTypeDesc[j]) continue;
      const s = stringTable[j];
      if (s.startsWith("/")) break; // hit another path — stop
      if (isResourceId(s)) {
        resourceId = s;
        break;
      }
    }

    // Scan backwards for description (long non-ID, non-path string)
    let description: string | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      if (isTypeDesc[j]) continue;
      const s = stringTable[j];
      if (s.startsWith("/")) break;
      if (s.length > 15 && !isResourceId(s) && s !== name) {
        description = s;
        break;
      }
    }

    if (resourceId && name) {
      groups.push({ name, resourceId, path, description });
    }
  }

  return groups;
}

// --- FieldSet auto-discovery ---

/** Cached FieldSet resource ID — discovered once, reused for all subsequent calls. */
let discoveredFieldSetId: string | null = null;

/**
 * Call GroupService.getRootGroupsForResourceType(token, ResourceType=FieldSet).
 * ResourceType ordinal 37 = FieldSet.
 * Clone of callGetReportRootGroups (line 3467) with ordinal 37 instead of 4.
 */
async function callGetFieldSetRootGroups(
  token: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.GroupService",
    method: "getRootGroupsForResourceType",
    moduleBaseUrl: MODULE_BASE,
    strongName: GROUP_STRONG_NAME,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "enum",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
      ordinal: 37, // FieldSet
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/GroupService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

/**
 * Auto-discover the FieldSet resource ID by walking the GroupService hierarchy.
 *
 * Resolves the path from ARCSIGHT_FIELD_SET_PATH (default: "/All Field Sets/FORTRESS/Device Monitoring")
 * to a resource ID by:
 *   1. Getting root FieldSet groups via GroupService.getRootGroupsForResourceType(ordinal=37)
 *   2. Walking each path segment using callGetGroupChildren()
 *   3. If exact path fails, attempts a broader search for any group matching the last segment.
 *   4. Caching the final resource ID for all subsequent calls.
 *
 * Returns null if path cannot be resolved (logs available children at each failed step).
 */
export async function discoverFieldSetId(
  auth: SessionAuth
): Promise<string | null> {
  // Return cached value if available
  if (discoveredFieldSetId) return discoveredFieldSetId;

  // Prefer explicit env var
  if (FIELD_SET_ID) {
    discoveredFieldSetId = FIELD_SET_ID;
    return FIELD_SET_ID;
  }

  if (!FIELD_SET_PATH) {
    console.warn("[fieldset-discovery] No ARCSIGHT_FIELD_SET_PATH configured — cannot discover FieldSet ID.");
    return null;
  }

  const pathSegments = FIELD_SET_PATH.split("/").filter(Boolean);
  // e.g. ["All Field Sets", "FORTRESS", "Device Monitoring"]
  if (pathSegments.length === 0) {
    console.warn("[fieldset-discovery] ARCSIGHT_FIELD_SET_PATH is empty after splitting.");
    return null;
  }

  console.log(`[fieldset-discovery] Resolving path: ${FIELD_SET_PATH} (${pathSegments.length} segments)`);

  const token = auth.phoenixToken;

  // Step 1: Get root FieldSet groups
  const rootDecoded = await callGetFieldSetRootGroups(token, auth.phoenixCookies);
  const rootGroups = parseGroupResponse(rootDecoded);
  console.log(`[fieldset-discovery] Root groups: ${rootGroups.map((g) => g.name).join(", ") || "(none)"}`);

  if (rootGroups.length === 0) {
    console.warn("[fieldset-discovery] No root FieldSet groups returned by GroupService.");
    return null;
  }

  // Match first segment — exact match or fall back to first root
  let current = rootGroups.find((g) => g.name === pathSegments[0]) ?? rootGroups[0];
  console.log(`[fieldset-discovery] Matched root: "${current.name}" (${current.resourceId})`);

  // Step 2: Walk remaining path segments
  for (let i = 1; i < pathSegments.length; i++) {
    const children = parseGroupResponse(
      await callGetGroupChildren(token, current.resourceId, current.path, auth.phoenixCookies)
    );
    let match = children.find((g) => g.name === pathSegments[i]);

    if (!match && i === pathSegments.length - 1) {
      // Last segment not found? Try a broader search in the current group for any segment
      // that resembles a field set container (heuristic)
      console.log(`[fieldset-discovery] Segment "${pathSegments[i]}" not found. Attempting broader search...`);
      match = children.find((g) => g.name.toLowerCase().includes("device") || g.name.toLowerCase().includes("monitor"));
    }

    if (!match) {
      console.warn(
        `[fieldset-discovery] Segment "${pathSegments[i]}" not found. Available children of "${current.name}": ${
          children.map((g) => g.name).join(", ") || "(none)"
        }`
      );
      return null;
    }

    current = match;
    console.log(`[fieldset-discovery] Matched segment[${i}]: "${current.name}" (${current.resourceId})`);
  }

  discoveredFieldSetId = current.resourceId;
  console.log(`[fieldset-discovery] Discovered FieldSet ID: ${discoveredFieldSetId}`);
  return discoveredFieldSetId;
}

/**
 * Get the FieldSet resource ID — from env var, cache, or auto-discovery.
 * Returns null if not configured and discovery fails.
 */
async function getFieldSetId(token: string, sessionCookies: string): Promise<string | null> {
  if (FIELD_SET_ID) return FIELD_SET_ID;
  if (discoveredFieldSetId) return discoveredFieldSetId;
  try {
    const id = await discoverFieldSetId({ restToken: "", phoenixToken: token, phoenixCookies: sessionCookies });
    if (!id) {
       console.warn("[fieldset-discovery] Auto-discovery returned null. Field data may be missing.");
    }
    return id;
  } catch (err) {
    console.warn("[fieldset-discovery] Auto-discovery failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Parse a ChannelService listing response into ActiveChannel objects.
 *
 * Uses the same string-table scanning approach as `parseGroupResponse()`.
 * GWT-RPC serializes nested objects (like ResourceReference inside a channel)
 * as separate typed entries in the flat values array, which breaks the
 * object-splitting approach. However, the string table contains ALL strings
 * in serialization order regardless of nesting — so we scan it directly.
 *
 * For each channel, the string table contains (in order):
 *   - resourceId (Base64 string, from the nested ResourceReference)
 *   - path (starts with "/All Active Channels/...")
 * This mirrors how parseGroupResponse() works for group resources.
 */
// ResourceSubtype enum ordinals from ArcSight ESM GWT-RPC wire format.
// The ChannelService response encodes subType as a ResourceSubtype enum in
// the values array (not the string table). Each occurrence is a pair:
//   [stringTableRef → "ResourceSubtype/...", ordinal]
const RESOURCE_SUBTYPE_MAP: Record<number, string> = {
  1: "Event",
  2: "Trend",
  3: "Query",
  4: "Last State",
  5: "Session",
  6: "Active List",
  7: "Last N Events",
};

function parseChannelListResponse(
  decoded: GwtRpcDecodedResponse,
  groupName: string,
  groupPath?: string
): ActiveChannel[] {
  const { stringTable, values } = decoded;
  if (stringTable.length === 0) return [];

  // --- Extract subType ordinals from values array ---
  // Find the string table index for the ResourceSubtype type descriptor.
  // GWT values reference string table with 1-based indexing.
  const subtypeTypeIdx = stringTable.findIndex((s) =>
    s.startsWith(
      "com.arcsight.product.esmclient.service.v1.model.resource.subtype.ResourceSubtype/"
    )
  );
  const subtypeOrdinals: number[] = [];
  if (subtypeTypeIdx >= 0) {
    const stRef = subtypeTypeIdx + 1; // values use 1-based string table refs
    for (let i = 0; i < values.length - 1; i++) {
      if (values[i] === stRef && typeof values[i + 1] === "number") {
        subtypeOrdinals.push(values[i + 1] as number);
      }
    }
  }

  // --- Extract Long timestamps from values array ---
  // Each channel resource has createdTimestamp + modifiedTimestamp as java.lang.Long.
  // GWT-RPC encodes Longs as: string_value (epoch ms), then longTypeRef.
  const longTypeIdx = stringTable.findIndex((s) =>
    s.startsWith("java.lang.Long/")
  );
  const longEpochs: string[] = [];
  if (longTypeIdx >= 0) {
    const longRef = longTypeIdx + 1; // 1-based
    for (let i = 0; i < values.length - 1; i++) {
      if (typeof values[i] === "string" && values[i + 1] === longRef) {
        longEpochs.push(values[i] as string);
      }
    }
  }

  const typeDescPattern = /^[\w.$]+\/\d+$/;
  const isTypeDesc = stringTable.map((s) => typeDescPattern.test(s));

  function isResourceId(s: string): boolean {
    if (s.length < 10) return false;
    // Base64-encoded IDs (e.g. "0qGuDB-sAABCAOMeKGS1xDg==")
    if (/^[\w+/=-]{10,}={1,2}$/.test(s)) return true;
    // Numeric IDs (e.g. "01000100010001033")
    if (/^\d{10,}$/.test(s)) return true;
    return false;
  }

  const channels: ActiveChannel[] = [];
  const usedPaths = new Set<string>();

  for (let i = 0; i < stringTable.length; i++) {
    if (isTypeDesc[i]) continue;
    const path = stringTable[i];
    // Channel paths live under /All Active Channels/ (or similar root)
    if (!path.startsWith("/")) continue;
    // Only include actual channels — skip user paths, field sets, etc.
    if (!path.startsWith("/All Active Channels/")) continue;
    // Skip paths we've already matched (dedup)
    if (usedPaths.has(path)) continue;

    const segments = path.split("/").filter(Boolean);
    // Need at least 3 segments to be a channel (e.g. "All Active Channels / GROUP / Channel")
    // Paths with fewer segments are group-level paths handled by parseGroupResponse
    if (segments.length < 3) continue;

    // Skip group self-references (the group path itself appears in the string table)
    if (groupPath && path === groupPath) continue;

    const displayName = segments[segments.length - 1];

    // Scan backwards for resource ID
    let resourceId = "";
    for (let j = i - 1; j >= 0; j--) {
      if (isTypeDesc[j]) continue;
      const s = stringTable[j];
      if (s.startsWith("/")) break; // hit another path — stop
      if (isResourceId(s)) {
        resourceId = s;
        break;
      }
    }

    if (resourceId && displayName) {
      usedPaths.add(path);

      // Map the Nth channel to the Nth ResourceSubtype ordinal from the values array
      const ordinal = subtypeOrdinals[channels.length] ?? 0;
      const subType = RESOURCE_SUBTYPE_MAP[ordinal] ?? "";

      // Map Nth channel to its timestamps (2 Longs per resource: created, modified)
      const tsIndex = channels.length * 2 + 1; // +1 = modifiedTimestamp (2nd of pair)
      const epochStr = longEpochs[tsIndex];
      const epochMs = epochStr ? decodeGwtLong(epochStr) : NaN;
      const lastUpdateTime = !isNaN(epochMs)
        ? new Date(epochMs).toISOString()
        : null;

      channels.push({
        displayName,
        resourceId,
        path,
        subType,
        lastUpdateTime,
        description: null,
        groupName,
      });
    }
  }

  return channels;
}

// --- Public API: Channel Listing ---

export interface ChannelGroupWithChannels extends ChannelGroup {
  channels: ActiveChannel[];
}

/**
 * Recursively traverse the group tree, collecting channels at every level.
 *
 * At each group node we attempt two things in parallel:
 *   1. Fetch channels via ChannelService (leaf content)
 *   2. Fetch sub-groups via GroupService (tree structure)
 *
 * A group may have channels, sub-groups, or both. We recurse into sub-groups
 * up to `maxDepth` to handle structures like:
 *   All Active Channels → FORTRESS → Device Monitoring → TEST → 9 channels
 */
async function fetchGroupTreeRecursive(
  token: string,
  sessionCookies: string,
  group: ChannelGroup,
  depth: number = 0,
  maxDepth: number = 5
): Promise<ChannelGroupWithChannels[]> {
  if (depth >= maxDepth) {
    console.log(`[channel-list] Max depth ${maxDepth} reached at "${group.name}"`);
    return [];
  }

  const indent = "  ".repeat(depth);
  const results: ChannelGroupWithChannels[] = [];

  // Try fetching channels AND sub-groups in parallel
  const [channelResult, subGroupResult] = await Promise.allSettled([
    // 1. Try to get channels in this group
    callGetChannelGroupChildren(token, group.resourceId, group.path, sessionCookies)
      .then((decoded) => parseChannelListResponse(decoded, group.name, group.path)),
    // 2. Try to get sub-groups under this group
    callGetGroupChildren(token, group.resourceId, group.path, sessionCookies)
      .then((decoded) =>
        parseGroupResponse(decoded).filter(
          (g) => g.path.startsWith(group.path + "/") && g.path !== group.path
        )
      ),
  ]);

  // Collect channels found at this level
  const channels =
    channelResult.status === "fulfilled" ? channelResult.value : [];
  if (channels.length > 0) {
    console.log(`${indent}[channel-list] "${group.name}": ${channels.length} channel(s)`);
    // Cache channel metadata (parent group ID + path) for callGetChannelInfo
    cacheChannelMetadata(channels, group.resourceId);
    results.push({ ...group, channels });
  }

  // Recurse into sub-groups — parallel with concurrency limit matching pool headroom
  const subGroups =
    subGroupResult.status === "fulfilled" ? subGroupResult.value : [];
  if (subGroups.length > 0) {
    console.log(`${indent}[channel-list] "${group.name}": ${subGroups.length} sub-group(s)`);
    const PARALLEL_LIMIT = 4;
    for (let i = 0; i < subGroups.length; i += PARALLEL_LIMIT) {
      const batch = subGroups.slice(i, i + PARALLEL_LIMIT);
      const batchResults = await Promise.all(
        batch.map((sg) => fetchGroupTreeRecursive(token, sessionCookies, sg, depth + 1, maxDepth))
      );
      results.push(...batchResults.flat());
    }
  }

  return results;
}

/**
 * Fetch all active channel groups and their channels via recursive tree traversal.
 *
 * Flow:
 * 1. getRootGroupsForResourceType(token, 33) → root group(s)
 * 2. Recursively walk the group tree (up to 5 levels deep)
 * 3. At each node, fetch both channels and sub-groups in parallel
 *
 * This handles deeply nested structures like:
 *   All Active Channels / FORTRESS / Device Monitoring / TEST / (9 channels)
 */
export async function getAllActiveChannels(
  auth: SessionAuth
): Promise<{ groups: ChannelGroupWithChannels[] }> {
  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;

    // Step 1: Get root groups for ActiveChannel resource type
    console.log("[channel-list] Step 1: Getting root groups...");
    const rootDecoded = await callGetRootGroups(token);
    const rootGroups = parseGroupResponse(rootDecoded);
    console.log(`[channel-list] Found ${rootGroups.length} root group(s)`);

    if (rootGroups.length === 0) {
      return { groups: [] };
    }

    // Find the true root — the one with the shortest path (fewest segments)
    const root = rootGroups.reduce((a, b) =>
      a.path.split("/").length <= b.path.split("/").length ? a : b
    );

    // Step 2: Recursively walk the tree from root
    console.log(`[channel-list] Step 2: Recursing into "${root.name}"...`);
    const groups = await fetchGroupTreeRecursive(token, sessionCookies, root, 0, 5);

    const totalChannels = groups.reduce(
      (sum, g) => sum + g.channels.length,
      0
    );
    console.log(
      `[channel-list] Done: ${totalChannels} total channels across ${groups.length} group(s)`
    );

    return { groups };
}

// --- Client Tree: restructure flat groups into a hierarchy ---

export interface ClientNode {
  name: string;
  resourceId: string;
  path: string;
  channels: ActiveChannel[];
  children: ClientNode[];
}

/**
 * Build a tree from the flat `ChannelGroupWithChannels[]` returned by `getAllActiveChannels()`.
 *
 * Each group's `path` encodes its position in the tree, e.g.:
 *   /All Active Channels/FORTRESS/Device Monitoring/SAMEE
 *
 * We parse every path, insert intermediate nodes as needed, and attach
 * channels to the deepest matching node.
 *
 * @param rootFilter — If provided, only return the subtree whose root matches this name (e.g. "FORTRESS").
 */
export function buildClientTree(
  groups: ChannelGroupWithChannels[],
  rootFilter?: string
): ClientNode {
  // Virtual root collects everything
  const root: ClientNode = {
    name: "Root",
    resourceId: "",
    path: "/",
    channels: [],
    children: [],
  };

  for (const group of groups) {
    // Parse path segments, e.g. ["All Active Channels", "FORTRESS", "Device Monitoring", "SAMEE"]
    const segments = group.path.split("/").filter(Boolean);

    let current = root;
    let builtPath = "";

    for (const seg of segments) {
      builtPath += "/" + seg;
      let child = current.children.find((c) => c.name === seg);
      if (!child) {
        child = {
          name: seg,
          resourceId: "",
          path: builtPath,
          channels: [],
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }

    // Attach data from the actual group to this node
    current.resourceId = group.resourceId;
    current.channels = group.channels;
  }

  // If rootFilter is provided, find and return that subtree
  if (rootFilter) {
    const found = findNode(root, rootFilter);
    if (found) return found;
  }

  // Default: return the single top-level child if there's exactly one, otherwise root
  return root.children.length === 1 ? root.children[0] : root;
}

function findNode(node: ClientNode, name: string): ClientNode | null {
  if (node.name === name) return node;
  for (const child of node.children) {
    const found = findNode(child, name);
    if (found) return found;
  }
  return null;
}

/**
 * Fetch all channels and restructure into a client tree.
 */
export async function getClientTree(
  auth: SessionAuth,
  rootFilter?: string
): Promise<ClientNode> {
  const { groups } = await getAllActiveChannels(auth);
  return buildClientTree(groups, rootFilter);
}

// --- Phase 1: Discover ChannelService methods ---

interface DiscoveredMethod {
  name: string;
  context: string;
}

interface DiscoverResult {
  methods: DiscoveredMethod[];
  serializationPolicy: {
    url: string;
    types: string[];
    error?: string;
  };
  cacheJs: {
    url: string;
    sizeBytes: number;
    channelServiceMethods: string[];
    subscriptionCandidates: string[];
    error?: string;
  };
}

/**
 * Discover all ChannelService methods by fetching the GWT compiled JS
 * and serialization policy files.
 *
 * Phase 1.1: Fetch the `.cache.js` permutation file — contains all method
 * names as string literals near "ChannelService".
 *
 * Phase 1.2: Fetch the `.gwt.rpc` serialization policy — lists all
 * serializable types, hinting at request/response objects.
 */
export async function discoverChannelServiceMethods(_auth?: SessionAuth): Promise<DiscoverResult> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const cacheJsUrl = `${MODULE_BASE}${PHOENIX_PERMUTATION}.cache.js`;
  const rpcPolicyUrl = `${MODULE_BASE}${CHANNEL_STRONG_NAME}.gwt.rpc`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let cacheJsResult: DiscoverResult["cacheJs"];
  let policyResult: DiscoverResult["serializationPolicy"];

  try {
    // Fetch both in parallel
    const [cacheJsRes, policyRes] = await Promise.allSettled([
      fetch(cacheJsUrl, {
        signal: controller.signal,
        // @ts-expect-error -- undici dispatcher
        dispatcher: phoenixDispatcher,
      }),
      fetch(rpcPolicyUrl, {
        signal: controller.signal,
        // @ts-expect-error -- undici dispatcher
        dispatcher: phoenixDispatcher,
      }),
    ]);

    // --- Parse cache.js ---
    if (cacheJsRes.status === "fulfilled" && cacheJsRes.value.ok) {
      const jsText = await cacheJsRes.value.text();

      // Extract method names near ChannelService references.
      // GWT compiled JS assigns method names as string literals in RPC proxies.
      const channelServiceMethods: string[] = [];
      const subscriptionCandidates: string[] = [];

      // Strategy 1: Find all string literals near ChannelService mentions
      const methodPattern = /["'](\w+)["']/g;
      const allMethodNames = new Set<string>();

      // Find all blocks mentioning ChannelService
      const csBlocks: string[] = [];
      const csPattern = /ChannelService/g;
      let csMatch;
      while ((csMatch = csPattern.exec(jsText)) !== null) {
        const start = Math.max(0, csMatch.index - 2000);
        const end = Math.min(jsText.length, csMatch.index + 2000);
        csBlocks.push(jsText.slice(start, end));
      }

      // From each block, extract method-like strings
      const jsKeywords = new Set([
        "function", "return", "string", "number", "object", "prototype",
        "undefined", "boolean", "length", "apply", "call", "bind",
        "constructor", "toString", "valueOf", "hasOwnProperty",
        "null", "true", "false", "this", "class", "extends",
      ]);

      for (const block of csBlocks) {
        let m;
        while ((m = methodPattern.exec(block)) !== null) {
          const name = m[1];
          // Filter to Java method names (camelCase, no underscores)
          if (
            name.length > 3 &&
            name.length < 60 &&
            /^[a-z][a-zA-Z0-9]*$/.test(name) &&
            !jsKeywords.has(name)
          ) {
            allMethodNames.add(name);
          }
        }
      }

      // Strategy 2: Search for RPC proxy patterns with ChannelService
      const rpcProxyPattern =
        /(?:ChannelService|channelService)[^;]*?["'](\w+)["']/gi;
      let rpcMatch;
      while ((rpcMatch = rpcProxyPattern.exec(jsText)) !== null) {
        const name = rpcMatch[1];
        if (/^[a-z][a-zA-Z0-9]{3,}$/.test(name)) {
          allMethodNames.add(name);
        }
      }

      channelServiceMethods.push(...allMethodNames);

      // Identify subscription candidates
      const subscriptionKeywords = [
        "open", "start", "subscribe", "activate", "init", "begin",
        "attach", "connect", "register", "listen", "watch",
      ];
      for (const name of allMethodNames) {
        const lower = name.toLowerCase();
        if (subscriptionKeywords.some((kw) => lower.includes(kw))) {
          subscriptionCandidates.push(name);
        }
      }

      cacheJsResult = {
        url: cacheJsUrl,
        sizeBytes: jsText.length,
        channelServiceMethods: channelServiceMethods.sort(),
        subscriptionCandidates: subscriptionCandidates.sort(),
      };
    } else {
      const errMsg =
        cacheJsRes.status === "rejected"
          ? cacheJsRes.reason instanceof Error
            ? cacheJsRes.reason.message
            : String(cacheJsRes.reason)
          : `HTTP ${(cacheJsRes as PromiseFulfilledResult<Response>).value.status}`;
      cacheJsResult = {
        url: cacheJsUrl,
        sizeBytes: 0,
        channelServiceMethods: [],
        subscriptionCandidates: [],
        error: errMsg,
      };
    }

    // --- Parse serialization policy ---
    if (policyRes.status === "fulfilled" && policyRes.value.ok) {
      const policyText = await policyRes.value.text();

      // .gwt.rpc format: each line has comma-separated values with type name
      const types: string[] = [];
      for (const line of policyText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("@")) continue;
        const parts = trimmed.split(",").map((s) => s.trim());
        // Type name is typically in column 4
        if (parts.length >= 4) {
          const typeName = parts[3];
          if (typeName && typeName.includes(".")) {
            types.push(typeName);
          }
        }
        // Also check column 1 for older formats
        if (parts.length >= 1 && parts[0].includes(".") && parts[0].includes("arcsight")) {
          types.push(parts[0]);
        }
      }

      policyResult = {
        url: rpcPolicyUrl,
        types: [...new Set(types)].sort(),
      };
    } else {
      const errMsg =
        policyRes.status === "rejected"
          ? policyRes.reason instanceof Error
            ? policyRes.reason.message
            : String(policyRes.reason)
          : `HTTP ${(policyRes as PromiseFulfilledResult<Response>).value.status}`;
      policyResult = {
        url: rpcPolicyUrl,
        types: [],
        error: errMsg,
      };
    }
  } finally {
    clearTimeout(timer);
  }

  // Combine known methods with discovered ones
  const knownMethods: DiscoveredMethod[] = [
    { name: "getChannelInfo", context: "Currently used — fetches channel metadata + events" },
    { name: "getGroupChildrenResourcesWithRequest", context: "Currently used — lists channels in a group" },
  ];

  for (const name of cacheJsResult.subscriptionCandidates) {
    if (!knownMethods.some((m) => m.name === name)) {
      knownMethods.push({
        name,
        context: "SUBSCRIPTION CANDIDATE — discovered in compiled GWT JS",
      });
    }
  }

  return {
    methods: knownMethods,
    serializationPolicy: policyResult,
    cacheJs: cacheJsResult,
  };
}

// --- Phase 2: Channel subscription ---

/** Track which channels have active server-side subscriptions */
const subscribedChannels = new Set<string>();

/** Per-channel bucket token storage (replaces the global lastBucketTokens) */
const channelBucketTokens = new Map<string, string[]>();

/** Channels currently held open for live multi-channel polling.
 *  Managed by setLiveChannels/pollLiveChannels/clearLiveChannels.
 *  These channels are NOT closed between polls (unlike scan windows). */
const livePolledChannels = new Set<string>();

/**
 * Open/subscribe to a channel and fetch the first page of events.
 *
 * ArcSight's ChannelService uses a bucket-token polling protocol:
 *   1. `getChannelInfo` with empty buckets — opens the channel, returns metadata + bucket tokens
 *   2. `getChannelInfo` with those bucket tokens — returns events + new bucket tokens
 *
 * The ACC UI (Phoenix) exclusively uses `getChannelInfo` for polling — it never
 * calls `first()`/`next()` navigation methods (which throw IncompatibleRemoteServiceException
 * on this ESM version). Bucket tokens grow progressively across polls.
 */
async function ensureChannelSubscribed(
  auth: SessionAuth,
  channelId: string
): Promise<{ tokens: string[]; result: ChannelResult }> {
  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;
  const empty: ChannelResult = { events: [], totalCount: 0, fieldNames: [] };

  console.log(`[channel-service] Opening channel ${channelId.slice(0, 12)}...`);

  // Step 1: getChannelInfo — opens the channel, returns metadata + bucket tokens
  const metaDecoded = await callGetChannelInfo(token, sessionCookies, [], channelId);
  const metaTokens = metaDecoded ? extractBucketTokens(metaDecoded) : [];

  // Step 2: Re-poll with bucket tokens to get events (ACC UI protocol).
  // The ACC UI never calls first()/next() — it exclusively uses getChannelInfo
  // with progressively growing bucket tokens for event retrieval.
  let resultDecoded: GwtRpcDecodedResponse | null;
  if (metaTokens.length > 0) {
    resultDecoded = await callGetChannelInfo(token, sessionCookies, metaTokens, channelId);
  } else {
    // No navigation support AND no bucket tokens from initial call.
    // This is the chicken-and-egg problem: server returns 0 events when no
    // bucket tokens are sent, but bucket tokens only come from event responses.
    //
    // Bootstrap: send a sentinel bucket with eventId=0 (Long "A") to tell the
    // server "I have no cursor position, give me the latest events".
    // This mirrors how Phoenix bootstraps after opening a channel.
    console.log(
      "[channel-service] No bucket tokens — sending bootstrap bucket to break cold-start cycle..."
    );
    const bootstrapDecoded = await callGetChannelInfo(token, sessionCookies, ["A"], channelId);
    const bootstrapTokens = bootstrapDecoded ? extractBucketTokens(bootstrapDecoded) : [];
    const bootstrapResult = bootstrapDecoded ? parseChannelResult(bootstrapDecoded) : empty;

    if (bootstrapResult.events.length > 0 || bootstrapTokens.length > 0) {
      console.log(
        `[channel-service] Bootstrap succeeded: ${bootstrapResult.events.length} events, ${bootstrapTokens.length} tokens`
      );
      resultDecoded = bootstrapDecoded;
    } else {
      // Bootstrap didn't help — fall through to metadata-only
      resultDecoded = metaDecoded;
    }
  }

  let resultTokens = resultDecoded ? extractBucketTokens(resultDecoded) : metaTokens;
  let result = resultDecoded ? parseChannelResult(resultDecoded) : empty;

  // --- Quick warm-up poll ---
  // ACC UI uses repeated getChannelInfo polls to progressively load events.
  // Give the server 2 extra polls to buffer events when the first comes back empty.
  const WARMUP_MAX_POLLS = 3;
  const WARMUP_INTERVAL_MS = 3_000;

  const needsWarmup = result.events.length === 0 || result.isFilterExpressionOnly;

  if (needsWarmup) {
    let latestTokens = resultTokens.length > 0 ? resultTokens : ["A"];

    for (let poll = 1; poll <= WARMUP_MAX_POLLS; poll++) {
      console.log(
        `[channel-service] Warm-up poll ${poll}/${WARMUP_MAX_POLLS}: ` +
        `${result.events.length} events (filterOnly=${!!result.isFilterExpressionOnly}), ` +
        `${latestTokens.length} tokens — waiting ${WARMUP_INTERVAL_MS / 1000}s...`
      );

      await new Promise(resolve => setTimeout(resolve, WARMUP_INTERVAL_MS));

      const warmupDecoded = await callGetChannelInfo(token, sessionCookies, latestTokens, channelId);
      if (!warmupDecoded) break;

      const warmupTokens = extractBucketTokens(warmupDecoded);
      const warmupResult = parseChannelResult(warmupDecoded);

      console.log(
        `[channel-service] Warm-up poll ${poll}/${WARMUP_MAX_POLLS}: ` +
        `${warmupResult.events.length} events, ${warmupTokens.length} tokens`
      );

      if (warmupTokens.length > 0) latestTokens = warmupTokens;

      if (warmupResult.events.length > 0 && !warmupResult.isFilterExpressionOnly) {
        console.log(`[channel-service] Channel warmed up after ${poll} poll(s) — ${warmupResult.events.length} real events ready`);
        resultTokens = warmupTokens.length > 0 ? warmupTokens : latestTokens;
        result = warmupResult;
        resultDecoded = warmupDecoded;
        break;
      }
    }
  }

  // --- REST API Search Fallback ---
  // If GWT-RPC still returned no real events, extract the channel's filter
  // expression and query via Manager Service Layer QueryService.
  if (result.events.length === 0 || result.isFilterExpressionOnly) {
    const filter = extractFilterExpression(metaDecoded);
    if (filter) {
      console.log(
        `[channel-service] GWT-RPC returned no events — falling back to REST search. Filter: ${filter.slice(0, 100)}...`
      );
      const fieldNames = result.fieldNames.length > 0
        ? result.fieldNames
        : ["name", "deviceHostName", "customerName", "endTime", "message", "deviceVendor", "deviceProduct", "agentName", "agentHostName", "agentAddress"];
      try {
        // Search 30 days back for inactive channels (default 24h misses inactive devices)
        const searchResult = await searchEvents(auth, filter, fieldNames, 200, {
          startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
          endTime: Date.now(),
        });
        if (searchResult.events.length > 0) {
          console.log(`[channel-service] REST search fallback successful: ${searchResult.events.length} events`);
          result = mapSearchResultToChannelResult(searchResult, fieldNames);
        }
      } catch (err) {
        console.warn(`[channel-service] REST search fallback failed:`,
          err instanceof Error ? err.message : err);
      }
    } else {
      console.log("[channel-service] No filter expression found in channel metadata — cannot use REST fallback");
    }
  }

  // Store bucket tokens for subsequent polls
  if (resultTokens.length > 0) {
    channelBucketTokens.set(channelId, resultTokens);
    lastBucketTokens = resultTokens;
  } else if (metaTokens.length > 0) {
    channelBucketTokens.set(channelId, metaTokens);
    lastBucketTokens = metaTokens;
  }

  subscribedChannels.add(channelId);
  console.log(
    `[channel-service] Channel ${channelId.slice(0, 12)} opened: ` +
    `${result.events.length} events, ${resultTokens.length} tokens`
  );

  return { tokens: resultTokens, result };
}


/**
 * Close all channels tracked in `subscribedChannels` on the server.
 *
 * Processes in batches of 4 (matching the GWT-RPC connection pool size).
 * Uses Promise.allSettled so one failure doesn't block others.
 */
async function closeAllOpenChannels(token: string, sessionCookies: string = ""): Promise<void> {
  const channelIds = [...subscribedChannels];
  if (channelIds.length === 0) return;

  console.log(`[channel-service] Closing ${channelIds.length} open channel(s)...`);

  for (let i = 0; i < channelIds.length; i += 4) {
    const batch = channelIds.slice(i, i + 4);
    await Promise.allSettled(
      batch.map((chId) => callStopViewChannel(token, sessionCookies, chId))
    );
  }

  // callStopViewChannel already removes from subscribedChannels/channelBucketTokens,
  // but clear any stragglers (e.g. if callStopViewChannel threw before cleanup)
  for (const chId of channelIds) {
    subscribedChannels.delete(chId);
    channelBucketTokens.delete(chId);
  }
}

/**
 * Fetch active channel events using the ACC UI polling protocol.
 *
 * Uses getChannelInfo exclusively with bucket tokens (no first/next navigation).
 * This matches the exact protocol observed in the ACC Phoenix UI via Playwright interception.
 */
export async function getActiveChannelEventsWithSubscription(
  auth: SessionAuth,
  channelId: string
): Promise<ChannelResult> {
  const { result: rawResult } = await ensureChannelSubscribed(auth, channelId);
  return await enrichWithResolvedNames(auth, rawResult);
}

// --- Live Multi-Channel Polling ---

/**
 * Lightweight channel subscribe: open + single poll, no warm-up loop.
 * Used by setLiveChannels to quickly open channels without the 3x3s warm-up
 * that ensureChannelSubscribed uses (too expensive for batch operations).
 */
async function lightweightSubscribe(
  token: string,
  sessionCookies: string,
  channelId: string
): Promise<{ tokens: string[]; result: ChannelResult }> {
  const empty: ChannelResult = { events: [], totalCount: 0, fieldNames: [] };

  // Step 1: Open the channel (empty buckets)
  const metaDecoded = await callGetChannelInfo(token, sessionCookies, [], channelId);
  const metaTokens = metaDecoded ? extractBucketTokens(metaDecoded) : [];

  // Step 2: Single poll with tokens (or bootstrap "A" if no tokens)
  const pollTokens = metaTokens.length > 0 ? metaTokens : ["A"];
  const pollDecoded = await callGetChannelInfo(token, sessionCookies, pollTokens, channelId);
  let resultTokens = pollDecoded ? extractBucketTokens(pollDecoded) : metaTokens;
  let result = pollDecoded ? parseChannelResult(pollDecoded) : empty;

  // Step 3: One warm-up retry if still cold (3s delay)
  // Channels like CADCHNSERVER need server-side buffering time.
  if (result.events.length === 0 || result.isFilterExpressionOnly) {
    const warmupTokens = resultTokens.length > 0 ? resultTokens : metaTokens.length > 0 ? metaTokens : ["A"];
    await new Promise(r => setTimeout(r, 3000));
    const warmupDecoded = await callGetChannelInfo(token, sessionCookies, warmupTokens, channelId);
    if (warmupDecoded) {
      const wTokens = extractBucketTokens(warmupDecoded);
      const wResult = parseChannelResult(warmupDecoded);
      if (wResult.events.length > 0 && !wResult.isFilterExpressionOnly) {
        resultTokens = wTokens.length > 0 ? wTokens : resultTokens;
        result = wResult;
      } else if (wTokens.length > 0) {
        resultTokens = wTokens;
      }
    }
  }

  // Store state
  if (resultTokens.length > 0) {
    channelBucketTokens.set(channelId, resultTokens);
  } else if (metaTokens.length > 0) {
    channelBucketTokens.set(channelId, metaTokens);
  }
  subscribedChannels.add(channelId);

  return { tokens: resultTokens, result };
}

/**
 * Set the list of channels to poll live. Accepts up to 10 channel IDs.
 *
 * - Closes channels in `livePolledChannels` that are NOT in the new set
 * - Opens new channels not already subscribed (lightweight: open + single poll)
 * - Polls all channels with existing bucket tokens
 * - Returns enriched results for all channels
 */
export async function setLiveChannels(
  auth: SessionAuth,
  channelIds: string[]
): Promise<Record<string, ChannelResult>> {
  const ids = channelIds.slice(0, 10);
  const newSet = new Set(ids);
  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;

  // Close channels that are no longer in the live set
  const toClose = [...livePolledChannels].filter(id => !newSet.has(id));
  if (toClose.length > 0) {
    console.log(`[live-channels] Closing ${toClose.length} channel(s) no longer in live set`);
    for (let i = 0; i < toClose.length; i += 4) {
      const batch = toClose.slice(i, i + 4);
      await Promise.allSettled(batch.map(id => callStopViewChannel(token, sessionCookies, id)));
    }
    for (const id of toClose) {
      livePolledChannels.delete(id);
    }
  }

  // Open new channels that aren't already subscribed
  const toOpen = ids.filter(id => !subscribedChannels.has(id));
  if (toOpen.length > 0) {
    console.log(`[live-channels] Opening ${toOpen.length} new channel(s)`);
    for (let i = 0; i < toOpen.length; i += 4) {
      const batch = toOpen.slice(i, i + 4);
      await Promise.allSettled(
        batch.map(async id => {
          try {
            await lightweightSubscribe(token, auth.phoenixCookies, id);
          } catch (err) {
            console.warn(`[live-channels] Failed to open ${id.slice(0, 12)}:`, err instanceof Error ? err.message : err);
          }
        })
      );
    }
  }

  // Update live set
  livePolledChannels.clear();
  for (const id of ids) livePolledChannels.add(id);

  // Poll all live channels
  return pollLiveChannels(auth);
}

/**
 * Poll all channels currently in the live set with their stored bucket tokens.
 * Batches of 4 concurrent getChannelInfo calls (matching GWT-RPC pool size).
 * Returns enriched results keyed by channel ID.
 */
export async function pollLiveChannels(auth: SessionAuth): Promise<Record<string, ChannelResult>> {
  const ids = [...livePolledChannels];
  if (ids.length === 0) return {};

  const token = auth.phoenixToken;
  const results: Record<string, ChannelResult> = {};

  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    const batchResults = await Promise.allSettled(
      batch.map(async channelId => {
        const tokens = channelBucketTokens.get(channelId) ?? ["A"];
        const decoded = await callGetChannelInfo(token, auth.phoenixCookies, tokens, channelId);
        if (!decoded) return { channelId, result: { events: [], totalCount: 0, fieldNames: [] } as ChannelResult };

        const newTokens = extractBucketTokens(decoded);
        if (newTokens.length > 0) {
          channelBucketTokens.set(channelId, newTokens);
        }

        const parsed = parseChannelResult(decoded);
        const enriched = await enrichWithResolvedNames(auth, parsed);
        return { channelId, result: enriched };
      })
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results[r.value.channelId] = r.value.result;
      }
    }
  }

  console.log(`[live-channels] Polled ${ids.length} channel(s): ${Object.values(results).reduce((sum, r) => sum + r.events.length, 0)} total events`);
  return results;
}

/**
 * Close all live-polled channels and clear the live set.
 */
export async function clearLiveChannels(auth: SessionAuth): Promise<void> {
  const ids = [...livePolledChannels];
  if (ids.length === 0) return;

  console.log(`[live-channels] Clearing ${ids.length} live channel(s)`);
  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;
  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    await Promise.allSettled(batch.map(id => callStopViewChannel(token, sessionCookies, id)));
  }
  livePolledChannels.clear();
}

/** Returns the number of channels currently held open for live polling. */
export function getLiveChannelCount(): number {
  return livePolledChannels.size;
}

/**
 * Scan all channels using the ACC UI bucket-token polling protocol.
 *
 * Uses a **sliding window** of channels to stay under the ESM per-session
 * limit of 10 open event channels. Window size is dynamic — reduced when
 * live-polled channels occupy ESM slots. Each window:
 *   Pass 1: getChannelInfo with empty buckets → open channels, get metadata + tokens
 *   Pass 2: getChannelInfo with bucket tokens → get events (for channels needing it)
 *   Close:  stopViewChannel for all channels in the window
 *
 * Results accumulate across windows. Enrichment runs once after all windows.
 * Channels already in the live-polled set are skipped (polled separately).
 */
export async function scanAllChannelEventsWithSubscription(
  auth: SessionAuth,
  freshPhoenixLogin?: () => Promise<{ token: string; cookies: string }>
): Promise<{ results: ChannelScanResult[]; scannedAt: string }> {
  let token = auth.phoenixToken;
  let sessionCookies = auth.phoenixCookies;
  const emptyDecoded: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };
  const scanStart = Date.now();

  try {
    // Clear stale tracking from previous scan cycles.
    // stopViewChannel is broken on this ESM, so these accumulate forever.
    // Must NOT clear livePolledChannels — those are managed by live polling separately.
    subscribedChannels.clear();
    channelBucketTokens.clear();

    console.log("[channel-scan-v2] Discovering channels...");
    const { groups } = await getAllActiveChannels(auth);

    const seen = new Set<string>();
    const channels: { channelId: string; displayName: string; groupName: string; subType: string }[] = [];
    for (const g of groups) {
      for (const ch of g.channels) {
        if (seen.has(ch.resourceId)) continue;
        seen.add(ch.resourceId);
        channels.push({
          channelId: ch.resourceId,
          displayName: ch.displayName,
          groupName: g.name,
          subType: ch.subType,
        });
      }
    }

    // --- Pre-fetch connector devices + names in parallel with scan windows ---
    // These REST calls run concurrently with the window loop below.
    const connectorDevicesFetchStart = Date.now();
    const connectorDevicesPromise = getConnectorDevices(auth)
      .catch(() => ({} as Record<string, { deviceVendor: string; deviceProduct: string; deviceVersion?: string }[]>))
      .then((result) => {
        console.log(`[channel-scan-v2] getConnectorDevices pre-fetch resolved in ${((Date.now() - connectorDevicesFetchStart) / 1000).toFixed(1)}s`);
        return result;
      });
    // Chain connector name fetch off device promise (needs IDs from device map)
    const connectorNamesPromise = connectorDevicesPromise.then(async (deviceMap) => {
      const nameMap = new Map<string, string>();
      const ids = Object.keys(deviceMap);
      if (ids.length > 0) {
        const connectors = await getConnectorsByIds(auth, ids.slice(0, 50)).catch(() => []);
        for (const c of connectors) nameMap.set(c.resourceId, c.name);
      } else {
        const managerNames = await getAllConnectorNamesViaManager(auth).catch(() => new Map<string, string>());
        for (const [id, name] of managerNames) nameMap.set(id, name);
      }
      console.log(`[channel-scan-v2] connectorNames pre-fetch resolved: ${nameMap.size} entries`);
      return nameMap;
    });

    // --- Incremental scan: reuse cached results for channels with fresh MRT ---
    scanCycleCount++;
    const isFullScan = scanCycleCount % FULL_SCAN_EVERY_N === 0 || lastCompletedScanResults.length === 0;
    const cachedResultMap = new Map<string, ChannelScanResult>();
    const reusedResults: ChannelScanResult[] = [];

    if (!isFullScan && lastCompletedScanResults.length > 0) {
      const now = Date.now();
      for (const prev of lastCompletedScanResults) {
        if (
          prev.latestManagerReceiptTime != null &&
          (now - prev.latestManagerReceiptTime) < INCREMENTAL_FRESHNESS_MS &&
          prev.eventFields && Object.keys(prev.eventFields).length > 0
        ) {
          cachedResultMap.set(prev.channelId, prev);
        }
      }
      console.log(
        `[channel-scan-v2] Incremental scan (cycle ${scanCycleCount}): ` +
        `${cachedResultMap.size}/${channels.length} channels have fresh cached MRT, will skip`
      );
    } else {
      console.log(`[channel-scan-v2] Full scan (cycle ${scanCycleCount}): scanning all channels`);
    }

    // --- Sliding window: process channels in groups of WINDOW_SIZE ---
    // Dynamic window: respect live-polled channels that hold open ESM slots
    const liveCount = livePolledChannels.size;
    // ESM limit: 10 channels per session. Each window starts fresh (re-login),
    // so we can use all 10 slots when no live-polled channels exist.
    const WINDOW_SIZE = liveCount === 0 ? 10 : Math.max(1, 8 - liveCount);
    // Skip channels already live-polled (they're being polled separately)
    // Also skip channels with fresh cached MRT (incremental scan)
    const channelsToScan = channels.filter(ch => {
      if (livePolledChannels.has(ch.channelId)) return false;
      if (cachedResultMap.has(ch.channelId)) {
        reusedResults.push(cachedResultMap.get(ch.channelId)!);
        return false;
      }
      return true;
    });
    const phase1Map = new Map<string, Phase1Result>();
    const errorMap = new Map<string, string>();
    const phase2Map = new Map<string, { eventCount: number; eventIds: number[]; fieldNames: string[]; latestManagerReceiptTime: number | null; isFilterExpressionOnly: boolean; eventFields?: Record<string, string | number | null> }>();

    const BATCH_CONCURRENCY = 4; // Reduced from 8 to lower ESM CPU load (~80% → ~40%)
    const totalWindows = Math.ceil(channelsToScan.length / WINDOW_SIZE);
    console.log(`[channel-scan-v2] Scanning ${channelsToScan.length} channel(s) in ${totalWindows} window(s) of ${WINDOW_SIZE} (${liveCount} live-polled, ${channels.length - channelsToScan.length} skipped)...`);

    // Mutable accumulator — avoids O(n^2) spread copies across windows
    const progressResults: ChannelScanResult[] = [];

    // Initialize progressive scan progress
    scanProgress = {
      results: progressResults,
      totalChannels: channelsToScan.length,
      scannedChannels: 0,
      windowsCompleted: 0,
      totalWindows,
      startedAt: new Date().toISOString(),
      isComplete: false,
    };

    // Single fresh session for the entire scan — avoids creating 7 orphaned ESM sessions
    // (one per window) that never get cleaned up since stopViewChannel is broken.
    // If >50% of a window hits MaxChannelExceededException, we do a mid-scan re-login.
    let maxChExceededInWindow = 0;
    let windowChannelCount = 0;
    if (freshPhoenixLogin) {
      const fresh = await freshPhoenixLogin();
      token = fresh.token;
      sessionCookies = fresh.cookies;
    }

    for (let w = 0; w < channelsToScan.length; w += WINDOW_SIZE) {
      const window = channelsToScan.slice(w, w + WINDOW_SIZE);
      const windowNum = Math.floor(w / WINDOW_SIZE) + 1;
      console.log(`[channel-scan-v2] Window ${windowNum}/${totalWindows}: ${window.length} channel(s)`);

      // --- Pass 1: Open channels in this window ---
      for (let i = 0; i < window.length; i += BATCH_CONCURRENCY) {
        const batch = window.slice(i, i + BATCH_CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(async (ch): Promise<Phase1Result> => {
            const decoded = (await callGetChannelInfo(token, sessionCookies, [], ch.channelId)) ?? emptyDecoded;
            const tokens = extractBucketTokens(decoded);
            const parsed = parseChannelResult(decoded);
            const hasBucketType = decoded.stringTable.some((s) => s.includes("ChannelBucket/"));

            subscribedChannels.add(ch.channelId);
            if (tokens.length > 0) {
              channelBucketTokens.set(ch.channelId, tokens);
            }

            const eventMrt = extractLatestManagerReceiptTime(parsed);
            return {
              channelId: ch.channelId,
              tokens,
              fieldNames: parsed.fieldNames,
              eventIds: parsed.eventIds ?? [],
              eventCount: parsed.events.length,
              hasBucketType,
              latestManagerReceiptTime: eventMrt,
              isFilterExpressionOnly: parsed.isFilterExpressionOnly ?? false,
              eventFields: parsed.events[0]?.fields,
            };
          })
        );

        for (let j = 0; j < batchResults.length; j++) {
          const r = batchResults[j];
          const ch = batch[j];
          if (r.status === "fulfilled") {
            phase1Map.set(ch.channelId, r.value);
          } else {
            errorMap.set(ch.channelId, r.reason instanceof Error ? r.reason.message : String(r.reason));
          }
        }
      }

      // --- Mid-scan re-login: if >50% of this window hit MaxChannelExceededException,
      // the session is saturated. Get a fresh session for remaining windows.
      maxChExceededInWindow = window.filter(ch => {
        const err = errorMap.get(ch.channelId);
        return err && err.includes("MaxChannelExceededException");
      }).length;
      windowChannelCount = window.length;
      if (maxChExceededInWindow > windowChannelCount / 2 && freshPhoenixLogin) {
        console.log(
          `[channel-scan-v2] Window ${windowNum}: ${maxChExceededInWindow}/${windowChannelCount} hit MaxChannelExceededException — mid-scan re-login`
        );
        const fresh = await freshPhoenixLogin();
        token = fresh.token;
        sessionCookies = fresh.cookies;
      }

      // --- Pass 2: Poll channels in this window that need events ---
      const needsPhase2 = window.filter((ch) => {
        const p1 = phase1Map.get(ch.channelId);
        return p1 && (p1.eventCount === 0 || p1.isFilterExpressionOnly);
      });

      if (needsPhase2.length > 0) {
        // Adaptive wait: poll in stages (2s + 2s = 4s max) instead of a monolithic 8s delay.
        // Channels that respond early are removed from subsequent stages, saving time.
        // Reduced from [3000, 3000, 2000] to save ~28s across 7 windows.
        const WAIT_STAGES = [2000, 2000];
        let remaining = [...needsPhase2];
        console.log(`[channel-scan-v2] Window ${windowNum}: Adaptive wait for ${remaining.length} cold-start channel(s)...`);

        for (let stage = 0; stage < WAIT_STAGES.length && remaining.length > 0; stage++) {
          await new Promise((r) => setTimeout(r, WAIT_STAGES[stage]));
          const stageStart = Date.now();
          const satisfied: string[] = [];

          for (let i = 0; i < remaining.length; i += BATCH_CONCURRENCY) {
            const batch = remaining.slice(i, i + BATCH_CONCURRENCY);
            const batchResults = await Promise.allSettled(
              batch.map(async (ch) => {
                const p1 = phase1Map.get(ch.channelId)!;
                const tokens = channelBucketTokens.get(ch.channelId) ?? p1.tokens;
                const decoded = (await callGetChannelInfo(token, sessionCookies, tokens, ch.channelId))
                  ?? emptyDecoded;
                const parsed = parseChannelResult(decoded);

                const newTokens = extractBucketTokens(decoded);
                if (newTokens.length > 0) {
                  channelBucketTokens.set(ch.channelId, newTokens);
                }

                const eventMrt = extractLatestManagerReceiptTime(parsed);
                const phase2Fields = parsed.events[0]?.fields;
                const isFilterOnly = parsed.isFilterExpressionOnly ?? false;

                return {
                  channelId: ch.channelId,
                  eventCount: parsed.events.length,
                  eventIds: parsed.eventIds ?? [],
                  fieldNames: parsed.fieldNames.length > 0 ? parsed.fieldNames : p1.fieldNames,
                  latestManagerReceiptTime: eventMrt,
                  isFilterExpressionOnly: isFilterOnly,
                  eventFields: phase2Fields,
                };
              })
            );

            for (let j = 0; j < batchResults.length; j++) {
              const r = batchResults[j];
              const ch = batch[j];
              if (r.status === "fulfilled") {
                phase2Map.set(ch.channelId, r.value);
                // Channel satisfied: has real events (not filter-expression-only)
                if (r.value.eventCount > 0 && !r.value.isFilterExpressionOnly) {
                  satisfied.push(ch.channelId);
                }
              } else {
                const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                if (!errorMap.has(ch.channelId)) {
                  errorMap.set(ch.channelId, `Phase 2: ${errMsg}`);
                }
                // Don't retry errored channels in later stages
                satisfied.push(ch.channelId);
              }
            }
          }

          // Remove satisfied channels from remaining
          if (satisfied.length > 0) {
            const satisfiedSet = new Set(satisfied);
            remaining = remaining.filter(ch => !satisfiedSet.has(ch.channelId));
          }

          console.log(
            `[channel-scan-v2] Window ${windowNum}: Stage ${stage + 1}/3 resolved ${satisfied.length} channel(s) in ${((Date.now() - stageStart) / 1000).toFixed(1)}s, ${remaining.length} still pending`
          );
        }
      }

      // --- Close all channels in this window to free server-side slots ---
      const windowIds = window.map((ch) => ch.channelId);
      console.log(`[channel-scan-v2] Window ${windowNum}: Closing ${windowIds.length} channel(s)...`);
      for (let i = 0; i < windowIds.length; i += BATCH_CONCURRENCY) {
        const batch = windowIds.slice(i, i + BATCH_CONCURRENCY);
        await Promise.allSettled(
          batch.map((chId) => callStopViewChannel(token, sessionCookies, chId))
        );
      }

      // --- Emit progressive scan results after each window ---
      const windowResults: ChannelScanResult[] = window.map((ch) => {
        const err = errorMap.get(ch.channelId);
        if (err) {
          return {
            channelId: ch.channelId, channelName: ch.displayName, groupName: ch.groupName,
            subType: ch.subType, hasEvents: false, eventCount: 0,
            fieldNames: phase1Map.get(ch.channelId)?.fieldNames ?? [],
            latestManagerReceiptTime: null, error: err,
          };
        }
        const p2 = phase2Map.get(ch.channelId);
        const p1 = phase1Map.get(ch.channelId);
        const ec = p2?.eventCount ?? p1?.eventCount ?? 0;
        const fn = (p2?.fieldNames?.length ? p2.fieldNames : p1?.fieldNames) ?? [];
        const mrt = p2?.latestManagerReceiptTime ?? p1?.latestManagerReceiptTime ?? null;
        const ef = (p2 && !p2.isFilterExpressionOnly) ? p2.eventFields
          : (p1 && !p1.isFilterExpressionOnly) ? p1.eventFields
          : p2?.eventFields ?? p1?.eventFields;
        return {
          channelId: ch.channelId, channelName: ch.displayName, groupName: ch.groupName,
          subType: ch.subType, hasEvents: ec > 0, eventCount: ec, fieldNames: fn,
          latestManagerReceiptTime: mrt,
          eventFields: ef && Object.keys(ef).length > 0 ? ef : undefined,
        };
      });
      // Push into mutable accumulator — O(n) total vs O(n^2) from spread copies
      progressResults.push(...windowResults);
      const scannedSoFar = Math.min(w + WINDOW_SIZE, channelsToScan.length);
      scanProgress = {
        results: progressResults,
        totalChannels: channelsToScan.length,
        scannedChannels: scannedSoFar,
        windowsCompleted: windowNum,
        totalWindows,
        startedAt: scanProgress?.startedAt ?? new Date().toISOString(),
        isComplete: false,
      };

    }

    // --- Retry channels that hit MaxChannelExceededException ---
    const maxChRetries = [...errorMap.entries()]
      .filter(([, err]) => err.includes("MaxChannelExceededException"))
      .map(([chId]) => channelsToScan.find((c) => c.channelId === chId))
      .filter(Boolean) as typeof channelsToScan;

    if (maxChRetries.length > 0) {
      const retryWindows = Math.ceil(maxChRetries.length / WINDOW_SIZE);
      console.log(`[channel-scan-v2] Retrying ${maxChRetries.length} channel(s) that hit MaxChannelExceededException in ${retryWindows} window(s)...`);

      for (let rw = 0; rw < maxChRetries.length; rw += WINDOW_SIZE) {
        if (freshPhoenixLogin) {
          const fresh = await freshPhoenixLogin();
          token = fresh.token;
          sessionCookies = fresh.cookies;
        }

        const retryBatch = maxChRetries.slice(rw, rw + WINDOW_SIZE);
        const retryResults = await Promise.allSettled(
          retryBatch.map(async (ch) => {
            const decoded = (await callGetChannelInfo(token, sessionCookies, [], ch.channelId)) ?? emptyDecoded;
            const tokens = extractBucketTokens(decoded);
            const parsed = parseChannelResult(decoded);
            const eventMrt = extractLatestManagerReceiptTime(parsed);

            subscribedChannels.add(ch.channelId);
            if (tokens.length > 0) channelBucketTokens.set(ch.channelId, tokens);

            return {
              ch,
              result: {
                channelId: ch.channelId,
                tokens,
                fieldNames: parsed.fieldNames,
                eventIds: parsed.eventIds ?? [],
                eventCount: parsed.events.length,
                hasBucketType: decoded.stringTable.some((s) => s.includes("ChannelBucket/")),
                latestManagerReceiptTime: eventMrt,
                isFilterExpressionOnly: parsed.isFilterExpressionOnly ?? false,
                eventFields: parsed.events[0]?.fields,
              } as Phase1Result,
            };
          })
        );

        for (let j = 0; j < retryResults.length; j++) {
          const r = retryResults[j];
          const ch = retryBatch[j];
          if (r.status === "fulfilled") {
            phase1Map.set(ch.channelId, r.value.result);
            errorMap.delete(ch.channelId);
            console.log(`[channel-scan-v2] Retry OK: "${ch.displayName}" events=${r.value.result.eventCount}`);
          } else {
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            errorMap.set(ch.channelId, `Retry failed: ${msg}`);
            console.log(`[channel-scan-v2] Retry FAILED: "${ch.displayName}" — ${msg.slice(0, 100)}`);
          }
        }
      }
    }

    const withTokens = [...phase1Map.values()].filter((p) => p.tokens.length > 0).length;
    const phase2Events = [...phase2Map.values()].filter((p) => p.eventCount > 0).length;
    const windowsElapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
    console.log(
      `[channel-scan-v2] All windows done in ${windowsElapsed}s: ${phase1Map.size} OK, ${errorMap.size} errors. ` +
      `Bucket tokens: ${withTokens}, Phase 2 events: ${phase2Events}`
    );

    // --- Build results (merge scanned + reused cached results) ---
    const scannedResults: ChannelScanResult[] = channels
      .filter(ch => !cachedResultMap.has(ch.channelId))
      .map((ch) => {
        const err = errorMap.get(ch.channelId);
        if (err) {
          return {
            channelId: ch.channelId,
            channelName: ch.displayName,
            groupName: ch.groupName,
            subType: ch.subType,
            hasEvents: false,
            eventCount: 0,
            fieldNames: phase1Map.get(ch.channelId)?.fieldNames ?? [],
            latestManagerReceiptTime: null,
            error: err,
          };
        }

        const p2 = phase2Map.get(ch.channelId);
        const p1 = phase1Map.get(ch.channelId);
        const eventCount = p2?.eventCount ?? p1?.eventCount ?? 0;
        const fieldNames = (p2?.fieldNames?.length ? p2.fieldNames : p1?.fieldNames) ?? [];
        const latestManagerReceiptTime = p2?.latestManagerReceiptTime ?? p1?.latestManagerReceiptTime ?? null;
        const eventIds = (p2?.eventIds?.length ? p2.eventIds : p1?.eventIds) ?? [];

        // Prefer real event fields (non-filter-expression) over synthetic ones
        const eventFields = (p2 && !p2.isFilterExpressionOnly)
          ? p2.eventFields
          : (p1 && !p1.isFilterExpressionOnly)
            ? p1.eventFields
            : p2?.eventFields ?? p1?.eventFields;

        // Log diagnostic info for channels that ended up with 0 events
        if (eventCount === 0 && !err) {
          console.log(
            `[channel-scan-v2] "${ch.displayName}" (${ch.channelId.slice(0, 16)}...): ` +
            `0 events after all phases. P1: tokens=${p1?.tokens.length ?? 0}, hasBucket=${p1?.hasBucketType ?? false}. ` +
            `P2: ${p2 ? `events=${p2.eventCount}` : "skipped"}.`
          );
        }

        return {
          channelId: ch.channelId,
          channelName: ch.displayName,
          groupName: ch.groupName,
          subType: ch.subType,
          hasEvents: eventCount > 0,
          eventCount,
          fieldNames,
          latestManagerReceiptTime,
          eventIds: eventIds.length > 0 ? eventIds : undefined,
          eventFields: eventFields && Object.keys(eventFields).length > 0 ? eventFields : undefined,
        };
      });
    const results: ChannelScanResult[] = [...scannedResults, ...reusedResults];
    if (reusedResults.length > 0) {
      console.log(`[channel-scan-v2] Merged ${scannedResults.length} scanned + ${reusedResults.length} cached = ${results.length} total results`);
    }

    const enrichmentStart = Date.now();

    // Resolve resource IDs in eventFields for better initial UX
    const RESOURCE_FIELDS = ["agentName", "agentHostName", "agentAddress", "customerName", "deviceVendor", "deviceProduct", "deviceHostName", "name", "agent", "agentId", "customer"];
    const idsToResolve: string[] = [];
    for (const r of results) {
      if (!r.eventFields) continue;
      for (const f of RESOURCE_FIELDS) {
        const val = r.eventFields[f];
        if (typeof val === "string" && val.length > 15 && val.includes("=")) idsToResolve.push(val);
      }
    }
    if (idsToResolve.length > 0) {
      const resMap = await resolveResourceIds(auth, idsToResolve);
      for (const r of results) {
        if (!r.eventFields) continue;
        for (const f of RESOURCE_FIELDS) {
          const val = r.eventFields[f];
          if (typeof val === "string" && resMap[val]) r.eventFields[f] = resMap[val];
        }
      }
    }

    // --- Connector metadata enrichment ---
    // DEVICE_NAME_MAP is defined at module scope to avoid per-scan re-allocation.
    // Two passes: (1) device metadata for channels missing deviceVendor/deviceProduct
    // (2) agentName for ALL channels missing it (ungated — agent name comes from
    // connector registration, not events, so it's available even when device fields exist)
    //
    // Only enrich freshly scanned results — reused cached results were already enriched.
    const reusedIds = new Set(reusedResults.map(r => r.channelId));
    const freshResults = results.filter(r => !reusedIds.has(r.channelId));
    const needsDeviceMetadata = freshResults.filter(r =>
      r.eventFields &&
      (!r.eventFields.deviceVendor || !r.eventFields.deviceProduct)
    );
    const needsAgentName = freshResults.filter(r =>
      r.eventFields &&
      !r.eventFields.agentName
    );

    if (SCAN_DEBUG) console.log(
      `[channel-scan-v2] Enrichment: ${needsDeviceMetadata.length}/${results.length} channels need device metadata, ` +
      `${needsAgentName.length}/${results.length} need agentName`
    );

    // Fetch connector data if ANY channel needs device metadata OR agent name
    if (needsDeviceMetadata.length > 0 || needsAgentName.length > 0) {
      try {
        const deviceMap = await connectorDevicesPromise;
        const allConnectorIds = Object.keys(deviceMap);

        if (SCAN_DEBUG) {
          console.log(
            `[channel-scan-v2] Enrichment: getConnectorDevices returned ${allConnectorIds.length} connector(s). ` +
            `Total devices: ${Object.values(deviceMap).reduce((sum, d) => sum + d.length, 0)}`
          );
          if (allConnectorIds.length > 0) {
            const sampleDevices = Object.entries(deviceMap).slice(0, 3).map(([cId, devs]) =>
              `${cId}: [${devs.map(d => `${d.deviceVendor}/${d.deviceProduct}`).join(", ")}]`
            );
            console.log(`[channel-scan-v2] Enrichment: Sample devices: ${sampleDevices.join(" | ")}`);
          }
        }

        // Use pre-fetched connector names (resolved in parallel with scan windows)
        const connectorNameMap = await connectorNamesPromise;
        if (SCAN_DEBUG) console.log(`[channel-scan-v2] Enrichment: connectorNameMap has ${connectorNameMap.size} entries`);

        // Build flat device lookup for matching
        const allDevices: Array<{ connectorId: string; device: { deviceVendor: string; deviceProduct: string } }> = [];
        for (const [cId, devices] of Object.entries(deviceMap)) {
          for (const d of devices) allDevices.push({ connectorId: cId, device: d });
        }

        // --- Pass 1: Device metadata enrichment (channels missing deviceVendor/deviceProduct) ---
        if (needsDeviceMetadata.length > 0) {
          let enriched = 0;
          for (const r of needsDeviceMetadata) {
            if (!r.eventFields) continue;
            const hostname = String(r.eventFields.deviceHostName ?? "").toLowerCase();
            // Strip "NN. " prefix from channel names (e.g., "01. Fortigate Firewall HYD" → "fortigate firewall hyd")
            const channelLabel = (r.channelName ?? "").replace(/^\d+\.\s*/, "").toLowerCase();

            if (!hostname && !channelLabel) {
              if (SCAN_DEBUG) console.log(`[channel-scan-v2] Enrichment: Skipping "${r.channelName}" — no hostname or label to match`);
              continue;
            }

            let matched = false;
            for (const { connectorId, device } of allDevices) {
              const cName = (connectorNameMap.get(connectorId) ?? "").toLowerCase();
              const dProduct = (device.deviceProduct ?? "").toLowerCase();
              const dVendor = (device.deviceVendor ?? "").toLowerCase();

              matched = !!(
                (hostname && cName && (cName.includes(hostname) || hostname.includes(cName))) ||
                (channelLabel && dProduct && channelLabel.includes(dProduct)) ||
                (channelLabel && dVendor && channelLabel.includes(dVendor)) ||
                (channelLabel && cName && (cName.includes(channelLabel) || channelLabel.includes(cName)))
              );

              if (matched) {
                if (!r.eventFields.deviceVendor) r.eventFields.deviceVendor = device.deviceVendor;
                if (!r.eventFields.deviceProduct) r.eventFields.deviceProduct = device.deviceProduct;
                if (!r.eventFields.agentName) {
                  r.eventFields.agentName = connectorNameMap.get(connectorId) ?? null;
                }
                enriched++;
                if (SCAN_DEBUG) console.log(
                  `[channel-scan-v2] Enrichment: Matched "${r.channelName}" → ` +
                  `vendor="${device.deviceVendor}", product="${device.deviceProduct}", ` +
                  `agent="${connectorNameMap.get(connectorId) ?? "?"}"`
                );
                break;
              }
            }
            if (!matched && SCAN_DEBUG) {
              console.log(
                `[channel-scan-v2] Enrichment: No match for "${r.channelName}" ` +
                `(hostname="${hostname}", label="${channelLabel}") against ${allDevices.length} device(s)`
              );
            }
          }
          if (SCAN_DEBUG) console.log(`[channel-scan-v2] Device metadata enrichment: ${enriched}/${needsDeviceMetadata.length} channels enriched`);
        }

        // --- Pass 2: Agent name enrichment for ALL channels still missing agentName ---
        // Three matching strategies (tried in order):
        // A. Substring match: channel label ⊂ connector name or vice versa
        // B. Device keyword + location token: channel has a known device keyword AND shares
        //    a location token (3+ char word like "HYD") with the connector name
        // C. Device map match: via deviceVendor/deviceProduct when DETECT API has data
        // extractTokens and GENERIC_WORDS are hoisted to module scope to avoid per-scan re-allocation.

        const stillNeedsAgent = freshResults.filter(r =>
          r.eventFields && !r.eventFields.agentName
        );
        if (stillNeedsAgent.length > 0 && connectorNameMap.size > 0) {
          let agentEnriched = 0;
          for (const r of stillNeedsAgent) {
            if (!r.eventFields) continue;
            const hostname = String(r.eventFields.deviceHostName ?? "").toLowerCase();
            const channelLabel = (r.channelName ?? "").replace(/^\d+\.\s*/, "").toLowerCase();

            if (!hostname && !channelLabel) continue;

            let matched = false;

            if (allDevices.length > 0) {
              // Match via device map (when DETECT API returned data)
              for (const { connectorId, device } of allDevices) {
                const cName = (connectorNameMap.get(connectorId) ?? "").toLowerCase();
                const dProduct = (device.deviceProduct ?? "").toLowerCase();
                const dVendor = (device.deviceVendor ?? "").toLowerCase();

                matched = !!(
                  (hostname && cName && (cName.includes(hostname) || hostname.includes(cName))) ||
                  (channelLabel && dProduct && channelLabel.includes(dProduct)) ||
                  (channelLabel && dVendor && channelLabel.includes(dVendor)) ||
                  (channelLabel && cName && (cName.includes(channelLabel) || channelLabel.includes(cName)))
                );

                if (matched) {
                  r.eventFields.agentName = connectorNameMap.get(connectorId) ?? null;
                  agentEnriched++;
                  if (SCAN_DEBUG) console.log(
                    `[channel-scan-v2] Agent enrichment (device match): "${r.channelName}" → ` +
                    `agent="${connectorNameMap.get(connectorId) ?? "?"}"`
                  );
                  break;
                }
              }
            }

            if (!matched) {
              // Strategy A: substring match against connector names
              for (const [, cName] of connectorNameMap) {
                const cNameLower = cName.toLowerCase();
                const substringMatch = !!(
                  (hostname && cNameLower && (cNameLower.includes(hostname) || hostname.includes(cNameLower))) ||
                  (channelLabel && cNameLower && (cNameLower.includes(channelLabel) || channelLabel.includes(cNameLower)))
                );

                if (substringMatch) {
                  r.eventFields.agentName = cName;
                  agentEnriched++;
                  matched = true;
                  if (SCAN_DEBUG) console.log(
                    `[channel-scan-v2] Agent enrichment (substring match): "${r.channelName}" → agent="${cName}"`
                  );
                  break;
                }
              }
            }

            if (!matched && channelLabel) {
              // Strategy B: location-token matching
              // If the channel label contains a known device keyword, find a connector
              // that shares a location token (e.g., "HYD" in both "fortigate firewall hyd"
              // and "Codeploy-HYD-FW")
              const channelTokens = extractMatchTokens(channelLabel);
              const hasDeviceKeyword = DEVICE_NAME_MAP.some(entry =>
                entry.keywords.some(kw => channelLabel.includes(kw))
              );

              if (hasDeviceKeyword) {
                for (const [, cName] of connectorNameMap) {
                  const connectorTokens = extractMatchTokens(cName);
                  // Find shared tokens, excluding common generic words (GENERIC_WORDS at module scope)
                  const shared = [...channelTokens].filter(t =>
                    connectorTokens.has(t) && !GENERIC_WORDS.has(t)
                  );

                  if (shared.length > 0) {
                    r.eventFields.agentName = cName;
                    agentEnriched++;
                    matched = true;
                    if (SCAN_DEBUG) console.log(
                      `[channel-scan-v2] Agent enrichment (location-token match): "${r.channelName}" → ` +
                      `agent="${cName}" (shared tokens: ${shared.join(", ")})`
                    );
                    break;
                  }
                }
              }
            }
          }
          if (SCAN_DEBUG) console.log(`[channel-scan-v2] Agent name enrichment: ${agentEnriched}/${stillNeedsAgent.length} channels enriched`);
        }

      } catch (err) {
        console.warn("[channel-scan-v2] Connector metadata enrichment failed:",
          err instanceof Error ? err.message : err);
      }
    }

    // --- Channel-name-based device inference (last resort) ---
    // When filter expressions lack EQ clauses for deviceVendor/deviceProduct and
    // connector enrichment returns 0 devices, infer from the channel display name.
    // Channel names in this deployment follow the pattern "NN. <Device> <Location>"
    // (e.g., "01. Fortigate Firewall HYD", "06. Cadeploy-SentinelOne(HYD)").
    // DEVICE_NAME_MAP is defined at module scope.
    const stillNeedsMetadata = freshResults.filter(r =>
      r.eventFields && (!r.eventFields.deviceVendor || !r.eventFields.deviceProduct)
    );

    if (stillNeedsMetadata.length > 0) {
      let nameInferred = 0;
      for (const r of stillNeedsMetadata) {
        if (!r.eventFields) continue;
        const label = (r.channelName ?? "").replace(/^\d+\.\s*/, "").toLowerCase();
        if (!label) continue;

        for (const entry of DEVICE_NAME_MAP) {
          const matched = entry.keywords.some(kw => label.includes(kw));
          if (matched) {
            if (!r.eventFields.deviceVendor) r.eventFields.deviceVendor = entry.vendor;
            if (!r.eventFields.deviceProduct) r.eventFields.deviceProduct = entry.product;
            nameInferred++;
            if (SCAN_DEBUG) console.log(
              `[channel-scan-v2] Name inference: "${r.channelName}" → vendor="${entry.vendor}", product="${entry.product}"`
            );
            break;
          }
        }
      }
      if (nameInferred > 0 && SCAN_DEBUG) {
        console.log(`[channel-scan-v2] Channel-name device inference: ${nameInferred}/${stillNeedsMetadata.length} channels enriched`);
      }
    }

    console.log(`[channel-scan-v2] Enrichment completed in ${((Date.now() - enrichmentStart) / 1000).toFixed(1)}s`);

    const totalWithEvents = results.filter((r) => r.hasEvents).length;
    const totalElapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
    console.log(
      `[channel-scan-v2] Done in ${totalElapsed}s: ${totalWithEvents}/${results.length} channels have events`
    );

    // Mark scan progress as complete with final enriched results
    scanProgress = {
      results,
      totalChannels: results.length,
      scannedChannels: results.length,
      windowsCompleted: totalWindows,
      totalWindows,
      startedAt: scanProgress?.startedAt ?? new Date().toISOString(),
      isComplete: true,
    };

    // Cache results for incremental scan on next cycle
    lastCompletedScanResults = results;

    return { results, scannedAt: new Date().toISOString() };
  } finally {
    // Safety net: close any channels that might still be open on the server
    await closeAllOpenChannels(token, sessionCookies).catch(() => {});
  }
}

// ===========================================================================
// ReportService — GWT-RPC integration for ArcSight Reports
// ===========================================================================

// ReportService strong name — auto-discovered or set via env var
const REPORT_STRONG_NAME =
  process.env.ARCSIGHT_REPORT_STRONG_NAME ?? "";

// --- Report types ---

export interface ReportGroup {
  name: string;
  resourceId: string;
  path: string;
  description: string | null;
}

export interface ReportDefinition {
  resourceId: string;
  name: string;
  path: string;
  description: string | null;
  reportType: string | null;
  createdTimestamp: string | null;
  modifiedTimestamp: string | null;
}

export interface ArchivedReport {
  archiveId: string;
  reportName: string;
  generatedAt: string;
  format: string | null;
  status: string | null;
}

export interface ReportTreeGroup {
  name: string;
  resourceId: string;
  path: string;
  description: string | null;
  reports: ReportDefinition[];
}

// --- ReportService discovery ---

interface ReportDiscoverResult {
  methods: DiscoveredMethod[];
  strongNameCandidates: string[];
  serializationPolicy: {
    url: string;
    types: string[];
    error?: string;
  };
  cacheJs: {
    url: string;
    sizeBytes: number;
    reportServiceMethods: string[];
    error?: string;
  };
}

/**
 * Discover ReportService methods and strong name from the GWT compiled JS.
 *
 * Scans the cache.js permutation file for ReportService references and
 * extracts method names + serialization policy hash candidates.
 */
export async function discoverReportService(_auth?: SessionAuth): Promise<ReportDiscoverResult> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const cacheJsUrl = `${MODULE_BASE}${PHOENIX_PERMUTATION}.cache.js`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let cacheJsResult: ReportDiscoverResult["cacheJs"];
  let policyResult: ReportDiscoverResult["serializationPolicy"] = {
    url: "",
    types: [],
  };
  const strongNameCandidates: string[] = [];

  try {
    const cacheJsRes = await fetch(cacheJsUrl, {
      signal: controller.signal,
      // @ts-expect-error -- undici dispatcher
      dispatcher: phoenixDispatcher,
    });

    if (!cacheJsRes.ok) {
      throw new Error(`Failed to fetch cache.js: HTTP ${cacheJsRes.status}`);
    }

    const jsText = await cacheJsRes.text();

    // --- Extract ReportService methods ---
    const reportServiceMethods: string[] = [];
    const allMethodNames = new Set<string>();

    // Find all blocks mentioning ReportService
    const rsBlocks: string[] = [];
    const rsPattern = /ReportService/g;
    let rsMatch;
    while ((rsMatch = rsPattern.exec(jsText)) !== null) {
      const start = Math.max(0, rsMatch.index - 2000);
      const end = Math.min(jsText.length, rsMatch.index + 2000);
      rsBlocks.push(jsText.slice(start, end));
    }

    const jsKeywords = new Set([
      "function", "return", "string", "number", "object", "prototype",
      "undefined", "boolean", "length", "apply", "call", "bind",
      "constructor", "toString", "valueOf", "hasOwnProperty",
      "null", "true", "false", "this", "class", "extends",
    ]);

    const methodPattern = /["'](\w+)["']/g;
    for (const block of rsBlocks) {
      let m;
      while ((m = methodPattern.exec(block)) !== null) {
        const name = m[1];
        if (
          name.length > 3 &&
          name.length < 60 &&
          /^[a-z][a-zA-Z0-9]*$/.test(name) &&
          !jsKeywords.has(name)
        ) {
          allMethodNames.add(name);
        }
      }
    }

    // Also search for RPC proxy patterns
    const rpcProxyPattern =
      /(?:ReportService|reportService)[^;]*?["'](\w+)["']/gi;
    let rpcMatch;
    while ((rpcMatch = rpcProxyPattern.exec(jsText)) !== null) {
      const name = rpcMatch[1];
      if (/^[a-z][a-zA-Z0-9]{3,}$/.test(name)) {
        allMethodNames.add(name);
      }
    }

    reportServiceMethods.push(...allMethodNames);

    // --- Extract strong name candidates ---
    for (const block of rsBlocks) {
      const hashPattern = /[A-F0-9]{32}/g;
      let hm;
      while ((hm = hashPattern.exec(block)) !== null) {
        const hash = hm[0];
        if (hash !== PHOENIX_PERMUTATION && !strongNameCandidates.includes(hash)) {
          strongNameCandidates.push(hash);
        }
      }
    }

    cacheJsResult = {
      url: cacheJsUrl,
      sizeBytes: jsText.length,
      reportServiceMethods: reportServiceMethods.sort(),
    };

    // --- Try to fetch serialization policy for first candidate ---
    if (strongNameCandidates.length > 0) {
      const candidateHash = strongNameCandidates[0];
      const rpcPolicyUrl = `${MODULE_BASE}${candidateHash}.gwt.rpc`;
      try {
        const policyRes = await fetch(rpcPolicyUrl, {
          signal: controller.signal,
          // @ts-expect-error -- undici dispatcher
          dispatcher: phoenixDispatcher,
        });

        if (policyRes.ok) {
          const policyText = await policyRes.text();
          const types: string[] = [];
          for (const line of policyText.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("@")) continue;
            const parts = trimmed.split(",").map((s) => s.trim());
            if (parts.length >= 4 && parts[3]?.includes(".")) {
              types.push(parts[3]);
            }
            if (parts.length >= 1 && parts[0].includes("arcsight")) {
              types.push(parts[0]);
            }
          }
          policyResult = {
            url: rpcPolicyUrl,
            types: [...new Set(types)].sort(),
          };
        } else {
          policyResult = {
            url: rpcPolicyUrl,
            types: [],
            error: `HTTP ${policyRes.status}`,
          };
        }
      } catch (err) {
        policyResult = {
          url: rpcPolicyUrl,
          types: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  } finally {
    clearTimeout(timer);
  }

  const knownMethods: DiscoveredMethod[] = [
    { name: "findAllIds", context: "Expected — list all report IDs" },
    { name: "getResourceById", context: "Expected — fetch report definition by ID" },
    { name: "getArchivedReports", context: "Expected — list archived report results" },
    { name: "runReport", context: "Expected — trigger ad-hoc report execution" },
    { name: "getGroupChildrenResourcesWithRequest", context: "Expected — browse report groups (via GroupService)" },
  ];

  for (const name of cacheJsResult.reportServiceMethods) {
    if (!knownMethods.some((m) => m.name === name)) {
      knownMethods.push({
        name,
        context: "Discovered in compiled GWT JS near ReportService references",
      });
    }
  }

  return {
    methods: knownMethods,
    strongNameCandidates,
    serializationPolicy: policyResult,
    cacheJs: cacheJsResult,
  };
}

// --- ReportService GWT-RPC calls ---

function getReportStrongName(): string {
  if (!REPORT_STRONG_NAME) {
    console.warn(
      "[report-service] ARCSIGHT_REPORT_STRONG_NAME not set. " +
      "Run /api/arcsight/reports/discover to find it, then set the env var."
    );
  }
  return REPORT_STRONG_NAME;
}

/**
 * Call GroupService.getRootGroupsForResourceType(token, ResourceType=Report).
 * ResourceType ordinal 4 = Report.
 */
async function callGetReportRootGroups(
  token: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.GroupService",
    method: "getRootGroupsForResourceType",
    moduleBaseUrl: MODULE_BASE,
    strongName: GROUP_STRONG_NAME,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "enum",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
      ordinal: 4, // Report
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/GroupService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

/**
 * Call GroupService.getGroupChildrenResourcesWithRequest for report groups.
 */
async function callGetReportGroupChildren(
  token: string,
  groupResourceId: string,
  groupPath: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.GroupService",
    method: "getGroupChildrenResourcesWithRequest",
    moduleBaseUrl: MODULE_BASE,
    strongName: GROUP_STRONG_NAME,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
      fields: [
        { kind: "string", value: groupResourceId },
        { kind: "string", value: null },
        {
          kind: "enum",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
          ordinal: 0, // Group
        },
        { kind: "string", value: groupPath },
      ],
    },
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.paging.PagingListRequest/2455014551",
      fields: [
        { kind: "int", value: 200 },
        {
          kind: "list",
          typeDescriptor: "java.util.ArrayList/4159755760",
          items: [
            {
              kind: "object",
              typeDescriptor:
                "com.arcsight.product.esmclient.service.v1.model.sorting.SortInfo/776413725",
              fields: [
                { kind: "string", value: "resource:display_name" },
                {
                  kind: "enum",
                  typeDescriptor:
                    "com.arcsight.product.esmclient.service.v1.model.sorting.SortOrder/1726127846",
                  ordinal: 0, // ASC
                },
              ],
            },
          ],
        },
        { kind: "int", value: 0 },
      ],
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/GroupService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

async function callGetReportById(
  token: string,
  reportId: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const strongName = getReportStrongName();
  if (!strongName) {
    throw new Error(
      "ReportService strong name not configured. Set ARCSIGHT_REPORT_STRONG_NAME or run discovery."
    );
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ReportService",
    method: "getResourceById",
    moduleBaseUrl: MODULE_BASE,
    strongName,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    { kind: "string", value: reportId },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ReportService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

async function callFindAllReportIds(
  token: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const strongName = getReportStrongName();
  if (!strongName) {
    throw new Error(
      "ReportService strong name not configured. Set ARCSIGHT_REPORT_STRONG_NAME or run discovery."
    );
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ReportService",
    method: "findAllIds",
    moduleBaseUrl: MODULE_BASE,
    strongName,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ReportService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

async function callRunReport(
  token: string,
  reportId: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const strongName = getReportStrongName();
  if (!strongName) {
    throw new Error(
      "ReportService strong name not configured. Set ARCSIGHT_REPORT_STRONG_NAME or run discovery."
    );
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ReportService",
    method: "runReport",
    moduleBaseUrl: MODULE_BASE,
    strongName,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    { kind: "string", value: reportId },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ReportService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

async function callGetArchivedReports(
  token: string,
  reportId: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const strongName = getReportStrongName();
  if (!strongName) {
    throw new Error(
      "ReportService strong name not configured. Set ARCSIGHT_REPORT_STRONG_NAME or run discovery."
    );
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ReportService",
    method: "getArchivedReports",
    moduleBaseUrl: MODULE_BASE,
    strongName,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    { kind: "string", value: reportId },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ReportService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

async function callDownloadReport(
  token: string,
  archiveId: string,
  sessionCookies: string = ""
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const strongName = getReportStrongName();
  if (!strongName) {
    throw new Error(
      "ReportService strong name not configured. Set ARCSIGHT_REPORT_STRONG_NAME or run discovery."
    );
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ReportService",
    method: "downloadReport",
    moduleBaseUrl: MODULE_BASE,
    strongName,
  };

  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    { kind: "string", value: archiveId },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ReportService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

// --- Report response parsers ---

function parseReportGroupResponse(decoded: GwtRpcDecodedResponse): ReportGroup[] {
  const channelGroups = parseGroupResponse(decoded);
  return channelGroups.map((g) => ({
    name: g.name,
    resourceId: g.resourceId,
    path: g.path,
    description: g.description,
  }));
}

function parseReportListResponse(
  decoded: GwtRpcDecodedResponse,
  groupPath?: string
): ReportDefinition[] {
  const { stringTable } = decoded;
  if (stringTable.length === 0) return [];

  const typeDescPattern = /^[\w.$]+\/\d+$/;
  const isTypeDesc = stringTable.map((s) => typeDescPattern.test(s));

  function isResourceId(s: string): boolean {
    if (s.length < 10) return false;
    if (/^[\w+/=-]{10,}={1,2}$/.test(s)) return true;
    if (/^\d{10,}$/.test(s)) return true;
    return false;
  }

  function isTimestamp(s: string): boolean {
    return /^\d{13}$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s);
  }

  const reports: ReportDefinition[] = [];

  for (let i = 0; i < stringTable.length; i++) {
    if (isTypeDesc[i]) continue;
    const path = stringTable[i];
    if (!path.startsWith("/")) continue;
    if (groupPath && path === groupPath) continue;

    const segments = path.split("/").filter(Boolean);
    const name = segments.pop() ?? "";
    if (!name) continue;

    let resourceId = "";
    for (let j = i - 1; j >= 0; j--) {
      if (isTypeDesc[j]) continue;
      const s = stringTable[j];
      if (s.startsWith("/")) break;
      if (isResourceId(s)) {
        resourceId = s;
        break;
      }
    }

    if (!resourceId) continue;

    let description: string | null = null;
    let createdTimestamp: string | null = null;
    let modifiedTimestamp: string | null = null;
    const timestamps: string[] = [];

    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      if (isTypeDesc[j]) continue;
      const s = stringTable[j];
      if (s.startsWith("/")) break;
      if (isTimestamp(s)) {
        timestamps.push(s);
      } else if (
        s.length > 15 &&
        !isResourceId(s) &&
        s !== name &&
        !description
      ) {
        description = s;
      }
    }

    if (timestamps.length >= 2) {
      createdTimestamp = timestamps[1];
      modifiedTimestamp = timestamps[0];
    } else if (timestamps.length === 1) {
      modifiedTimestamp = timestamps[0];
    }

    reports.push({
      resourceId,
      name,
      path,
      description,
      reportType: null,
      createdTimestamp,
      modifiedTimestamp,
    });
  }

  return reports;
}

function parseReportDetail(decoded: GwtRpcDecodedResponse): ReportDefinition | null {
  const { stringTable } = decoded;
  if (stringTable.length === 0) return null;

  const typeDescPattern = /^[\w.$]+\/\d+$/;

  function isResourceId(s: string): boolean {
    if (s.length < 10) return false;
    if (/^[\w+/=-]{10,}={1,2}$/.test(s)) return true;
    if (/^\d{10,}$/.test(s)) return true;
    return false;
  }

  let resourceId = "";
  let name = "";
  let path = "";
  let description: string | null = null;
  let createdTimestamp: string | null = null;
  let modifiedTimestamp: string | null = null;

  for (const s of stringTable) {
    if (typeDescPattern.test(s)) continue;
    if (s.startsWith("/") && !path) {
      path = s;
      const segments = s.split("/").filter(Boolean);
      name = segments.pop() ?? "";
    } else if (isResourceId(s) && !resourceId) {
      resourceId = s;
    } else if (/^\d{13}$/.test(s)) {
      if (!modifiedTimestamp) modifiedTimestamp = s;
      else if (!createdTimestamp) createdTimestamp = s;
    } else if (s.length > 15 && !description && !isResourceId(s)) {
      description = s;
    }
  }

  if (!resourceId || !name) return null;

  return {
    resourceId,
    name,
    path,
    description,
    reportType: null,
    createdTimestamp,
    modifiedTimestamp,
  };
}

function parseArchivedReports(decoded: GwtRpcDecodedResponse): ArchivedReport[] {
  const { stringTable } = decoded;
  if (stringTable.length === 0) return [];

  const typeDescPattern = /^[\w.$]+\/\d+$/;
  const archives: ArchivedReport[] = [];

  function isResourceId(s: string): boolean {
    if (s.length < 10) return false;
    if (/^[\w+/=-]{10,}={1,2}$/.test(s)) return true;
    if (/^\d{10,}$/.test(s)) return true;
    return false;
  }

  for (let i = 0; i < stringTable.length; i++) {
    const s = stringTable[i];
    if (typeDescPattern.test(s)) continue;
    if (!isResourceId(s)) continue;

    let reportName = "";
    let generatedAt = "";
    let format: string | null = null;
    let status: string | null = null;

    for (let j = i + 1; j < Math.min(stringTable.length, i + 8); j++) {
      const v = stringTable[j];
      if (typeDescPattern.test(v)) continue;
      if (v.startsWith("/")) continue;
      if (/^\d{13}$/.test(v) && !generatedAt) {
        generatedAt = new Date(parseInt(v, 10)).toISOString();
      } else if (
        (v === "PDF" || v === "CSV" || v === "HTML" || v === "XLS") &&
        !format
      ) {
        format = v;
      } else if (
        (v === "COMPLETED" || v === "RUNNING" || v === "FAILED" || v === "QUEUED") &&
        !status
      ) {
        status = v;
      } else if (v.length > 3 && !reportName && !isResourceId(v)) {
        reportName = v;
      }
    }

    if (generatedAt || reportName) {
      archives.push({
        archiveId: s,
        reportName,
        generatedAt,
        format,
        status,
      });
    }
  }

  return archives;
}

// --- Report public API (with auth retry) ---

async function fetchReportGroupTree(
  token: string,
  sessionCookies: string,
  group: ReportGroup,
  depth: number,
  maxDepth: number
): Promise<ReportTreeGroup[]> {
  if (depth >= maxDepth) return [];

  const decoded = await callGetReportGroupChildren(token, group.resourceId, group.path, sessionCookies);
  const subGroups = parseReportGroupResponse(decoded).filter(
    (g) => g.path.startsWith(group.path + "/") && g.path !== group.path
  );
  const reports = parseReportListResponse(decoded, group.path).filter(
    (r) => !subGroups.some((sg) => sg.path === r.path)
  );

  const result: ReportTreeGroup[] = [];

  if (reports.length > 0) {
    result.push({
      name: group.name,
      resourceId: group.resourceId,
      path: group.path,
      description: group.description,
      reports,
    });
  }

  for (const sg of subGroups) {
    const children = await fetchReportGroupTree(token, sessionCookies, sg, depth + 1, maxDepth);
    result.push(...children);
  }

  if (reports.length === 0 && result.length > 0) {
    result.unshift({
      name: group.name,
      resourceId: group.resourceId,
      path: group.path,
      description: group.description,
      reports: [],
    });
  }

  return result;
}

/**
 * Get all report IDs via ReportService.findAllIds.
 * Useful for discovery / verifying ReportService connectivity.
 */
export async function findAllReportIds(
  auth: SessionAuth
): Promise<string[]> {
  const token = auth.phoenixToken;
  const decoded = await callFindAllReportIds(token);
  const typeDescPattern = /^[\w.$]+\/\d+$/;
  return decoded.stringTable.filter((s) => !typeDescPattern.test(s) && s.length > 5);
}

export async function getAllReports(
  auth: SessionAuth
): Promise<{ groups: ReportTreeGroup[] }> {
  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;

  console.log("[report-list] Step 1: Getting report root groups...");
  const rootDecoded = await callGetReportRootGroups(token);
  const rootGroups = parseReportGroupResponse(rootDecoded);
  console.log(`[report-list] Found ${rootGroups.length} root group(s)`);

  if (rootGroups.length === 0) {
    return { groups: [] };
  }

  const root = rootGroups.reduce((a, b) =>
    a.path.split("/").length <= b.path.split("/").length ? a : b
  );

  console.log(`[report-list] Step 2: Recursing into "${root.name}"...`);
  const groups = await fetchReportGroupTree(token, sessionCookies, root, 0, 5);

  const totalReports = groups.reduce((sum, g) => sum + g.reports.length, 0);
  console.log(
    `[report-list] Done: ${totalReports} total reports across ${groups.length} group(s)`
  );

  return { groups };
}

export async function getReportById(
  auth: SessionAuth,
  reportId: string
): Promise<ReportDefinition | null> {
  const token = auth.phoenixToken;
  const decoded = await callGetReportById(token, reportId);
  return parseReportDetail(decoded);
}

export async function runReport(
  auth: SessionAuth,
  reportId: string
): Promise<{ triggered: boolean; raw: unknown }> {
  const token = auth.phoenixToken;
  const decoded = await callRunReport(token, reportId);
  return { triggered: decoded.ok, raw: decoded };
}

export async function getArchivedReports(
  auth: SessionAuth,
  reportId: string
): Promise<ArchivedReport[]> {
  const token = auth.phoenixToken;
  const decoded = await callGetArchivedReports(token, reportId);
  return parseArchivedReports(decoded);
}

export async function downloadReport(
  auth: SessionAuth,
  archiveId: string
): Promise<{ content: string; raw: unknown }> {
  const token = auth.phoenixToken;
  const decoded = await callDownloadReport(token, archiveId);
  const typeDescPattern = /^[\w.$]+\/\d+$/;
  const content = decoded.stringTable.find(
    (s) => !typeDescPattern.test(s) && s.length > 20
  ) ?? "";
  return { content, raw: decoded };
}

// ========================================================================
// EventService — fetch ALL ~450 CEF fields for specific event IDs
// ========================================================================

// --- Types ---

export interface EventFieldDetail {
  fieldName: string;
  displayName: string;
  value: string | number | null;
  category: string | null;
  dataType: string | null;
}

export interface FullEventDetail {
  eventId: number;
  fields: Record<string, EventFieldDetail>;
}

export interface EventDetailResult {
  events: FullEventDetail[];
  fieldNames: string[];
  eventIds?: number[];
  totalFieldCount: number;
}

// --- eventId normalization ---

/**
 * Normalize an event ID from either a decoded number or a GWT base-64 string.
 * Events from parseChannelResult may arrive in either format.
 */
function normalizeEventId(raw: string | number): number {
  if (typeof raw === "number") return raw;
  const num = Number(raw);
  if (!isNaN(num) && num > 0) return num;
  return decodeGwtLong(raw);
}

// --- Request builder (manual string construction) ---

/**
 * Build a GWT-RPC request for EventService.getEventsWithFieldSet.
 *
 * Manual construction is required because the codec can't handle:
 * 1. Mismatched header type (java.util.List) vs value type (Collections$SingletonList)
 * 2. Null typed-object parameter (ResourceReference = 0)
 *
 * Wire format: pipe-delimited string table, then pipe-delimited value section.
 * String table entries are 1-indexed in the value section.
 */
function buildGetEventsWithFieldSetRequest(
  token: string,
  eventIds: number[],
  useFieldSet = true,
  fieldSetId?: string | null
): string {
  // Encode event IDs as GWT base-64 Long strings
  const encodedIds = eventIds.map((id) => encodeGwtLong(id));

  // For a single event, use SingletonList (more efficient); for multiple, use ArrayList
  const isSingle = encodedIds.length === 1;
  const listConcreteType = isSingle
    ? "java.util.Collections$SingletonList/1586180994"
    : "java.util.ArrayList/4159755760";

  // Should we include a FieldSet reference? Without it ArcSight returns metadata-only
  // for channel events, but for event details we want ALL ~450 CEF fields (null FieldSet).
  const resolvedId = fieldSetId || FIELD_SET_ID || null;
  const hasFieldSet = useFieldSet && !!resolvedId;
  if (!hasFieldSet) {
    console.warn(
      "[event-service] WARNING: No FieldSet ID available — EventService will return metadata-only (no field values)."
    );
  }

  // Build string table
  const stringTable: string[] = [
    MODULE_BASE,                        // [0] → ref 1
    EVENT_STRONG_NAME,                  // [1] → ref 2
    "com.arcsight.product.esmclient.service.v1.client.gwt.api.EventService",  // [2] → ref 3
    "getEventsWithFieldSet",            // [3] → ref 4
    "java.lang.String/2004016611",      // [4] → ref 5
    "java.util.List",                   // [5] → ref 6
    "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980", // [6] → ref 7
    token,                              // [7] → ref 8
    listConcreteType,                   // [8] → ref 9
    "java.lang.Long/4227064769",        // [9] → ref 10
    ...encodedIds,                      // [10+] → refs 11+
  ];

  // Add FieldSet-related strings when a FieldSet ID is available
  // These refs are computed dynamically based on encodedIds length
  let fieldSetIdStrRef = 0;    // 0 = null in GWT-RPC
  let resourceTypeRef = 0;
  let fieldSetPathRef = 0;
  if (hasFieldSet) {
    const baseIdx = stringTable.length; // next available index
    stringTable.push(resolvedId);       // [baseIdx] → ref baseIdx+1
    fieldSetIdStrRef = baseIdx + 1;

    stringTable.push(
      "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171"
    );                                  // [baseIdx+1] → ref baseIdx+2
    resourceTypeRef = baseIdx + 2;

    if (FIELD_SET_PATH) {
      stringTable.push(FIELD_SET_PATH); // [baseIdx+2] → ref baseIdx+3
      fieldSetPathRef = baseIdx + 3;
    }
  }

  // Build value section
  // Format: version|flags|stringTableSize|stringEntries...|moduleRef|strongRef|serviceRef|methodRef|paramCount|paramTypes...|paramValues...
  const parts: (string | number)[] = [];

  // Header: GWT-RPC version 7, flags 0
  parts.push(7, 0);

  // String table size + entries
  parts.push(stringTable.length);
  for (const s of stringTable) {
    parts.push(s);
  }

  // Service descriptor: module(1), strong(2), service(3), method(4)
  parts.push(1, 2, 3, 4);

  // Parameter count: 3 (token, eventIds list, fieldSetRef)
  parts.push(3);

  // Parameter type descriptors (refs to string table, 1-based)
  parts.push(5);  // String type
  parts.push(6);  // List type
  parts.push(7);  // ResourceReference type

  // --- Parameter values ---

  // Param 1: token (String) — reference to string table entry
  parts.push(8);  // token value ref

  // Param 2: List<Long> eventIds
  parts.push(9);  // concrete list type ref (SingletonList or ArrayList)
  if (isSingle) {
    // SingletonList: just the single element (Long type ref + encoded value ref)
    parts.push(10);  // Long type ref
    parts.push(11);  // encoded event ID ref
  } else {
    // ArrayList: count first, then each element
    parts.push(encodedIds.length);
    for (let i = 0; i < encodedIds.length; i++) {
      parts.push(10);      // Long type ref
      parts.push(11 + i);  // encoded event ID ref
    }
  }

  // Param 3: ResourceReference fieldSetRef
  // Must include a FieldSet ID for ArcSight to return actual field values.
  // Without it, only metadata (field names/categories) is returned — no values.
  // Serialization follows GWT-RPC object format: [type_ref, ...field_values_inline]
  // Same pattern as ChannelService's getChannelInfo.
  if (hasFieldSet) {
    parts.push(7);                 // ResourceReference type descriptor ref (already at string table index 6)
    parts.push(fieldSetIdStrRef);  // id: resolved FieldSet ID
    parts.push(0);                 // name: null
    parts.push(resourceTypeRef);   // resourceType enum type descriptor
    parts.push(37);                // resourceType ordinal: 37 = FieldSet
    parts.push(fieldSetPathRef);   // path: FIELD_SET_PATH (or 0 if not set)
  } else {
    parts.push(0);               // null — no FieldSet configured
  }

  return parts.join("|") + "|";
}

// --- Call function ---

async function callGetEventsWithFieldSet(
  token: string,
  sessionCookies: string,
  eventIds: number[],
  useFieldSet = true
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error(
      "Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  // Resolve FieldSet ID dynamically (env var → cache → auto-discovery)
  const resolvedFieldSetId = useFieldSet ? await getFieldSetId(token, sessionCookies) : null;
  const requestBody = buildGetEventsWithFieldSetRequest(token, eventIds, useFieldSet, resolvedFieldSetId);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/EventService`;
  const result = await phoenixRpc(serviceUrl, requestBody, sessionCookies);
  // Attach request body for debugging
  (result as GwtRpcDecodedResponse & { _requestBody?: string })._requestBody = requestBody;
  return result;
}

// --- Response parser ---

/**
 * Parse the EventsAndFieldNamesResult GWT-RPC response.
 *
 * Response structure:
 *   EventsAndFieldNamesResult → ArrayList<Event> → HashMap<String, FieldValue>
 *   Each FieldValue has: value (String|Long|Int|null) + FieldInfo (name, displayName, category) + FieldType (DataType, SemanticType)
 *
 * Parsing strategy: string-table analysis (proven in parseChannelResult).
 * 1. Classify string table entries: type descriptors, field names, display names, values
 * 2. Pair field names with display names (camelCase → Title Case pairs)
 * 3. Walk values array to associate fields with values
 */
function parseEventDetailResponse(decoded: GwtRpcDecodedResponse, requestedEventIds: number[]): EventDetailResult {
  // EventService returns EventsAndFieldNamesResult with field names as plain strings
  // (no FieldInfo/ wrappers like ChannelService). Extract them directly from stringTable.
  const isEventResult = decoded.stringTable.some(s => s.includes("EventsAndFieldNamesResult/"));
  const directFieldNames: string[] = [];
  if (isEventResult) {
    const isType = decoded.stringTable.map(s => /^[\w.$]+\/\d+$/.test(s));
    const SKIP = new Set(["device", "agent", "root", "source", "destination",
                          "attacker", "target", "file", "custom", "threat", "dvGroup"]);
    for (let i = 0; i < decoded.stringTable.length; i++) {
      const s = decoded.stringTable[i];
      if (/^[a-z][a-zA-Z0-9]{2,}$/.test(s) && !isType[i] && !SKIP.has(s)) {
        directFieldNames.push(s);
      }
    }
    console.log(`[event-service] EventsAndFieldNamesResult detected — ${directFieldNames.length} field names:`, directFieldNames);
  }

  const { events, fieldNames: parsedFieldNames } = parseChannelResult(decoded);
  const fieldNames = directFieldNames.length > 0 ? directFieldNames : parsedFieldNames;
  const fields: Record<string, { fieldName: string; displayName: string; value: string | number | null; category: string | null; dataType: string }> = {};

  if (events.length > 0) {
    // Map the first reconstructed event to the EventFieldDetail format
    for (const [name, val] of Object.entries(events[0].fields)) {
      const displayName = name.replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, c => c.toUpperCase());
      fields[name] = { 
        fieldName: name, 
        displayName, 
        value: val, 
        category: null, 
        dataType: typeof val === "number" ? "Long" : "String" 
      };
    }
  }

  return { 
    events: [{ eventId: requestedEventIds[0] || 0, fields }], 
    fieldNames, 
    totalFieldCount: fieldNames.length 
  };
}

// --- Public API ---

/**
 * Fetch full event details for the given event IDs.
 *
 * Uses EventService.getEventsWithFieldSet with the configured FieldSet reference.
 * Without a FieldSet, ArcSight returns only field names/types (metadata-only)
 * with zero actual values. The FieldSet tells ArcSight which fields to populate.
 * Authenticates via Phoenix GWT-RPC login. Retries once on auth failure.
 */
export async function getEventDetails(
  auth: SessionAuth,
  eventIds: (string | number)[]
): Promise<EventDetailResult> {
  const normalizedIds = eventIds.map(normalizeEventId).filter((id) => !isNaN(id) && id > 0);
  if (normalizedIds.length === 0) {
    return { events: [], fieldNames: [], totalFieldCount: 0 };
  }

  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;

    const decoded = await callGetEventsWithFieldSet(token, sessionCookies, normalizedIds, true);
    console.log(`[event-service] Decoded response: ok=${decoded.ok}, stringTable=${decoded.stringTable.length}, values=${decoded.values.length}`);
    if (decoded.stringTable.length > 0) {
      console.log(`[event-service] First 10 strings:`, decoded.stringTable.slice(0, 10));
      console.log(`[event-service] First 20 values:`, decoded.values.slice(0, 20));
    }
    const result = parseEventDetailResponse(decoded, normalizedIds);
    const enriched = await enrichWithResolvedNames(auth, {
      events: result.events.map(e => ({
        fields: Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, v.value]))
      })),
      totalCount: result.events.length,
      fieldNames: result.fieldNames
    });

    // Merge enriched values back into the detailed field format
    for (let i = 0; i < result.events.length; i++) {
      const e = result.events[i];
      const enr = enriched.events[i];
      for (const [k, val] of Object.entries(enr.fields)) {
        if (e.fields[k]) e.fields[k].value = val as string | number | null;
      }
    }

    // If we got field names but zero non-null values, retry without FieldSet.
    // Some ArcSight versions return all fields when FieldSet is null (opposite
    // behavior from ChannelService where FieldSet is required).
    const nonNullCount = result.events[0]
      ? Object.values(result.events[0].fields).filter((f) => f.value != null).length
      : 0;

    const hasFieldSetId = !!(FIELD_SET_ID || discoveredFieldSetId);
    console.log(`[event-service] Retry check: nonNullCount=${nonNullCount}, fieldNames=${result.fieldNames.length}, hasFieldSetId=${hasFieldSetId}`);
    if (nonNullCount === 0 && hasFieldSetId) {
      console.log("[event-service] 0 non-null values with FieldSet — retrying without FieldSet...");
      const decoded2 = await callGetEventsWithFieldSet(token, sessionCookies, normalizedIds, false);
      const result2 = parseEventDetailResponse(decoded2, normalizedIds);
      const nonNull2 = result2.events[0]
        ? Object.values(result2.events[0].fields).filter((f) => f.value != null).length
        : 0;
      if (nonNull2 > nonNullCount) {
        console.log(`[event-service] Without FieldSet: ${nonNull2} values — using this response.`);
        return result2;
      }
      if (nonNull2 === 0 && nonNullCount === 0 && result2.fieldNames.length > result.fieldNames.length) {
        console.log(`[event-service] Without FieldSet: same 0 values but ${result2.fieldNames.length} field names (vs ${result.fieldNames.length}) — using broader response.`);
        return result2;
      }
    }

    // REST Detect API fallback — if GWT-RPC returned 0 field values
    const totalFieldCount = result.events[0] ? Object.keys(result.events[0].fields).length : 0;
    const finalNonNull = result.events[0]
      ? Object.values(result.events[0].fields).filter((f) => f.value != null).length
      : 0;

    console.log(
      `[event-service] Pre-fallback check: totalFields=${totalFieldCount}, nonNull=${finalNonNull}, ` +
      `eventIds=[${normalizedIds.join(",")}]`
    );

    if (finalNonNull === 0) {
      console.log(`[event-service] EventService returned 0 values, trying SecurityEventService fallback...`);
      try {
        const { retrieveEvents } = await import("@/lib/arcsight-client");
        const now = Date.now();
        const restEvents = await retrieveEvents(auth, {
          ids: normalizedIds,
          startTime: now - 30 * 24 * 60 * 60 * 1000, // 30 days back
          endTime: now,
        });
        if (Array.isArray(restEvents) && restEvents.length > 0) {
          console.log(`[event-service] REST fallback: ${restEvents.length} events, ${Object.keys(restEvents[0]).length} fields`);
          const restFields: Record<string, { fieldName: string; displayName: string; value: string | number | null; category: string | null; dataType: string }> = {};
          for (const [k, v] of Object.entries(restEvents[0])) {
            if (v != null) {
              const displayName = k.replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, c => c.toUpperCase());
              const val = (typeof v === "string" || typeof v === "number") ? v : String(v);
              restFields[k] = { fieldName: k, displayName, value: val, category: null, dataType: typeof v === "number" ? "Long" : "String" };
            }
          }
          if (Object.keys(restFields).length > 0) {
            return {
              events: [{ eventId: normalizedIds[0], fields: restFields }],
              fieldNames: Object.keys(restFields),
              totalFieldCount: Object.keys(restFields).length,
            };
          }
        }
      } catch (err) {
        console.warn(`[event-service] REST fallback failed:`, err instanceof Error ? err.message : err);
      }

      // SecurityEventService fallback (Manager Service Layer REST — JSON)
      // This is the most reliable path: proven to return all agent/device fields.
      try {
        console.log(`[event-service] Trying SecurityEventService fallback for event ${normalizedIds[0]}...`);
        const flat = await getSecurityEventFlat(auth, normalizedIds[0]);
        console.log(`[event-service] SecurityEventFlat result: ${flat ? Object.keys(flat).length + " fields" : "null"}`);
        if (flat && Object.keys(flat).length > 0) {
          console.log(`[event-service] SecurityEventService fallback: ${Object.keys(flat).length} fields — agent="${flat.agentName}", host="${flat.agentHostName}", addr="${flat.agentAddress}"`);
          const sevFields: Record<string, { fieldName: string; displayName: string; value: string | number | null; category: string | null; dataType: string }> = {};
          for (const [k, v] of Object.entries(flat)) {
            if (v != null) {
              const displayName = k.replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, c => c.toUpperCase());
              sevFields[k] = { fieldName: k, displayName, value: v, category: null, dataType: "String" };
            }
          }
          // Merge into existing result (keep GWT-RPC field names, add values from SecurityEventService)
          if (result.events.length > 0) {
            for (const [k, v] of Object.entries(sevFields)) {
              if (!result.events[0].fields[k] || result.events[0].fields[k].value == null) {
                result.events[0].fields[k] = v;
              }
            }
            return result;
          }
          return {
            events: [{ eventId: normalizedIds[0], fields: sevFields }],
            fieldNames: Object.keys(sevFields),
            totalFieldCount: Object.keys(sevFields).length,
          };
        }
      } catch (err) {
        console.warn(`[event-service] SecurityEventService fallback failed:`, err instanceof Error ? err.message : err);
      }
    }

    return result;
}

/**
 * Fetch raw (unparsed) EventService response — for debugging/inspection.
 */
export async function getEventDetailsRaw(
  auth: SessionAuth,
  eventIds: (string | number)[]
): Promise<GwtRpcDecodedResponse> {
  const normalizedIds = eventIds.map(normalizeEventId).filter((id) => !isNaN(id) && id > 0);
  if (normalizedIds.length === 0) {
    throw new Error("No valid event IDs provided");
  }

  const token = auth.phoenixToken;
  const sessionCookies = auth.phoenixCookies;
  // Raw debug: use FieldSet to get actual values (same as parsed endpoint)
  return callGetEventsWithFieldSet(token, sessionCookies, normalizedIds, true);
}

// ===========================================================================
// ResourceReferenceService — Resolve IDs to human-readable names
// ===========================================================================

/**
 * Call ResourceReferenceService.getReferencesForIds via GWT-RPC.
 */
async function callGetReferencesForIds(
  token: string,
  sessionCookies: string,
  resourceIds: string[]
): Promise<GwtRpcDecodedResponse> {
  if (!PHOENIX_URL) {
    throw new Error("Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local");
  }

  const config: GwtRpcServiceConfig = {
    serviceInterface: "com.arcsight.product.esmclient.service.v1.client.gwt.api.ResourceReferenceService",
    method: "getReferencesForIds",
    moduleBaseUrl: MODULE_BASE,
    strongName: "30FF3BD459F659CCDEC778C02F731337", // Discovered from ESM Spy
  };

  // getReferencesForIds(String token, List<String> resourceIds)
  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "list",
      typeDescriptor: "java.util.ArrayList/4159755760",
      items: resourceIds.map(id => ({ kind: "string", value: id })),
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ResourceReferenceService`;
  return phoenixRpc(serviceUrl, requestBody, sessionCookies);
}

/**
 * Resolve a list of ArcSight resource IDs to their human-readable display names.
 *
 * This is used to transform "Agent IDs" or "Customer IDs" into readable text
 * for the UI. Handles 401 retries automatically.
 */
// Circuit breaker: disable ResourceReferenceService after first IncompatibleRemoteServiceException
let resourceReferenceServiceSupported = true;

export async function resolveResourceIds(
  auth: SessionAuth,
  resourceIds: string[]
): Promise<Record<string, string>> {
  if (!resourceReferenceServiceSupported) return {};
  if (resourceIds.length === 0) return {};

  // Dedup and filter nulls
  const uniqueIds = Array.from(new Set(resourceIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const token = auth.phoenixToken;

  try {
    const decoded = await callGetReferencesForIds(token, auth.phoenixCookies, uniqueIds);
    const { stringTable } = decoded;
    const result: Record<string, string> = {};

    // GWT-RPC response for ResourceReference objects contains strings in order:
    // [resourceId (Base64), name (null), typeDescriptor, path]
    // The displayName is usually the last segment of the path.
    for (let i = 0; i < stringTable.length; i++) {
      const s = stringTable[i];
      if (uniqueIds.includes(s)) {
        // Look ahead for the path string (starts with /)
        for (let j = i + 1; j < Math.min(i + 10, stringTable.length); j++) {
          const candidate = stringTable[j];
          if (candidate && candidate.startsWith("/")) {
            const name = candidate.split("/").filter(Boolean).pop();
            if (name) {
              result[s] = name;
              break;
            }
          }
        }
      }
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("IncompatibleRemoteServiceException")) {
      resourceReferenceServiceSupported = false;
      console.warn("[resource-resolution] ResourceReferenceService not supported on this ESM — disabling for this process lifetime");
      return {};
    }
    console.error("[resource-resolution] Failed to resolve IDs:", msg);
    return {};
  }
}
