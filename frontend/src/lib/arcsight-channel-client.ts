import "server-only";
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

// --- Configuration ---

const PHOENIX_URL = process.env.ARCSIGHT_PHOENIX_URL;
const USERNAME = process.env.ARCSIGHT_USERNAME;
const PASSWORD = process.env.ARCSIGHT_PASSWORD;

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

// GroupService config (for listing active channel groups)
const GROUP_STRONG_NAME =
  process.env.ARCSIGHT_GROUP_STRONG_NAME ?? "1B071B5D44F7515FFE5935DBF4E7ECC9";

// Module permutation hash — the X-GWT-Permutation header must use this for ALL
// services. The per-service strong names go only in the request body (position 2).
const PHOENIX_PERMUTATION =
  process.env.ARCSIGHT_PHOENIX_PERMUTATION ?? "CB3DBC2F5104708621DAEEEBF767F03B";

const PHOENIX_TIMEOUT_MS = 20_000;

/** Bucket tokens from the last ChannelService response — used for the next poll */
let lastBucketTokens: string[] = [];

// GWT module base — shared across all Phoenix GWT-RPC services
const MODULE_BASE =
  "https://ecccdesmt01:48443/www/ui-phoenix/com.arcsight.phoenix.PhoenixLauncher/";

// Separate connection pool for Phoenix (GWT-RPC endpoint) — routes through proxy if configured.
const phoenixDispatcher = createArcsightDispatcher({
  connections: 4,
  pipelining: 1,
  connectTimeout: 15_000,
});
console.log(`[arcsight-channel] Proxy: ${getProxyInfo()}`);

// --- Phoenix GWT-RPC token management ---

let phoenixToken: string | null = null;

/**
 * Authenticate via Phoenix GWT-RPC LoginService.
 *
 * This is a separate auth session from the REST API. The GWT-RPC login
 * returns a different token format that must be used for all subsequent
 * GWT-RPC calls (DataMonitorV2Service, etc.).
 */
async function phoenixLogin(): Promise<string> {
  if (!PHOENIX_URL || !USERNAME || !PASSWORD) {
    throw new Error(
      "Phoenix login not configured. Set ARCSIGHT_PHOENIX_URL, ARCSIGHT_USERNAME, and ARCSIGHT_PASSWORD in .env.local"
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
    { kind: "string", value: USERNAME },
    { kind: "string", value: PASSWORD },
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
  phoenixToken = token;
  return token;
}

async function getPhoenixToken(): Promise<string> {
  if (phoenixToken) return phoenixToken;
  return phoenixLogin();
}

function clearPhoenixToken(): void {
  phoenixToken = null;
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

// --- Public API ---

/**
 * Fetch viewable data for a data monitor resource.
 *
 * Authenticates via Phoenix GWT-RPC login (separate from REST API).
 * Handles 401 by clearing the Phoenix token and retrying once.
 */
export async function getViewableData(
  resourceId?: string,
  _isRetry = false
): Promise<GwtRpcDecodedResponse> {
  const id = resourceId ?? DEFAULT_RESOURCE_ID;
  const token = await getPhoenixToken();

  try {
    return await callGetViewableData(token, id);
  } catch (error) {
    // If the error message suggests auth failure, retry once with fresh token
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[phoenix] Auth error, re-authenticating...");
      clearPhoenixToken();
      const freshToken = await getPhoenixToken();
      return callGetViewableData(freshToken, id);
    }
    throw error;
  }
}

/**
 * Get the raw decoded GWT-RPC response for debugging.
 * Returns both the login step result and the getViewableData result.
 */
export async function getChannelDebugResponse(
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

  // Step 1: Login
  clearPhoenixToken();
  const token = await phoenixLogin();

  // Step 2: Build the request body (for debugging)
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
        {
          kind: "object",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
          fields: [
            { kind: "string", value: resolvedChannelId },
            { kind: "string", value: null },
            {
              kind: "enum",
              typeDescriptor:
                "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
              ordinal: 33, // ActiveChannel
            },
            { kind: "string", value: null },
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
            // Pass null for both resourceId and alias — server resolves default fieldset
            {
              kind: "object",
              typeDescriptor:
                "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
              fields: [
                { kind: "string", value: null },
                { kind: "string", value: null },
                {
                  kind: "enum",
                  typeDescriptor:
                    "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
                  ordinal: 37, // FieldSet
                },
                { kind: "string", value: null },
              ],
            },
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
    }`
  );

  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ChannelService`;

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
      `GWT-RPC getChannelInfo failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    );
  }

  const rawText = await res.text();
  const decoded = decodeGwtRpcResponse(rawText);
  // Attach request body for debugging
  (decoded as GwtRpcDecodedResponse & { _requestBody?: string })._requestBody = requestBody;
  return decoded;
}

/** Set to false when the server returns IncompatibleRemoteServiceException for nav methods */
let navigationMethodsSupported = true;

/**
 * Call a ChannelService navigation method (first / next / previous / last).
 *
 * These methods share the same signature as getChannelInfo:
 *   methodName(String token, ChannelRequest request)
 *
 * - `first`:    Navigate to the first page of events (initial fetch after subscribe)
 * - `next`:     Navigate forward from current bucket position (polling)
 * - `previous`: Navigate backward
 * - `last`:     Navigate to the last page
 *
 * Reuses the same ChannelRequest structure and bucket token protocol
 * as callGetChannelInfo, but sends a different method name in the GWT-RPC
 * payload. Uses the shared phoenixRpc() helper to avoid duplicating fetch logic.
 *
 * Returns null immediately if navigation methods are known to be unsupported.
 */
async function callChannelNavigate(
  method: "first" | "next" | "previous" | "last",
  token: string,
  bucketTokens: string[] = [],
  channelId?: string
): Promise<GwtRpcDecodedResponse | null> {
  if (!navigationMethodsSupported) return null;

  if (!PHOENIX_URL) {
    throw new Error(
      "Phoenix not configured. Set ARCSIGHT_PHOENIX_URL in .env.local"
    );
  }

  const resolvedChannelId = channelId ?? CHANNEL_RESOURCE_ID;
  if (!resolvedChannelId) return null;

  const config: GwtRpcServiceConfig = {
    serviceInterface:
      "com.arcsight.product.esmclient.service.v1.client.gwt.api.ChannelService",
    method,
    moduleBaseUrl: MODULE_BASE,
    strongName: CHANNEL_STRONG_NAME,
  };

  // Same ChannelRequest structure as getChannelInfo
  const params: GwtRpcParam[] = [
    { kind: "string", value: token },
    {
      kind: "object",
      typeDescriptor:
        "com.arcsight.product.esmclient.service.v1.model.channel.ChannelRequest/1272271556",
      fields: [
        {
          kind: "object",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
          fields: [
            { kind: "string", value: resolvedChannelId },
            { kind: "string", value: null },
            {
              kind: "enum",
              typeDescriptor:
                "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
              ordinal: 33,
            },
            { kind: "string", value: null },
          ],
        },
        {
          kind: "object",
          typeDescriptor:
            "com.arcsight.product.esmclient.service.v1.model.channel.ChannelCriteria/285692488",
          fields: [
            { kind: "string", value: null },
            { kind: "string", value: null },
            {
              kind: "object",
              typeDescriptor:
                "com.arcsight.product.esmclient.service.v1.model.resource.ResourceReference/2894737980",
              fields: [
                { kind: "string", value: null },
                { kind: "string", value: null },
                {
                  kind: "enum",
                  typeDescriptor:
                    "com.arcsight.product.esmclient.service.v1.model.resource.ResourceType/2290386171",
                  ordinal: 37,
                },
                { kind: "string", value: null },
              ],
            },
            { kind: "string", value: null },
          ],
        },
        {
          kind: "list",
          typeDescriptor: "java.util.ArrayList/4159755760",
          items: buildBucketItems(bucketTokens),
        },
        { kind: "int", value: 0 },
        { kind: "int", value: 200 },
        { kind: "int", value: 0 },
      ],
    },
  ];

  const requestBody = buildGwtRpcRequest(config, params);
  console.log(
    `[channel-service] ${method}: ${bucketTokens.length} bucket token(s)${
      bucketTokens.length > 0 ? ` [${bucketTokens[0].slice(0, 8)}...]` : ""
    } channel=${resolvedChannelId.slice(0, 12)}`
  );

  const serviceUrl = `${PHOENIX_URL}/www/esmclient-service/gwt/ChannelService`;
  try {
    return await phoenixRpc(serviceUrl, requestBody);
  } catch (err) {
    if (err instanceof Error && err.message.includes("IncompatibleRemoteServiceException")) {
      console.warn(
        `[channel-service] Navigation method "${method}" not supported — falling back to getChannelInfo polling.`
      );
      navigationMethodsSupported = false;
      return null;
    }
    throw err;
  }
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

  if (values.length === 0) {
    return { events: [], totalCount: 0, fieldNames: [] };
  }

  // Step 1: Classify string table entries as type descriptors vs data strings.
  // Type descriptors match: "com.something.ClassName/1234567890"
  const typeDescriptorPattern = /^[\w.$]+\/\d+$/;
  const isTypeDescriptor = stringTable.map((s) => typeDescriptorPattern.test(s));

  // Step 2: Extract field names from the string table.
  // FieldInfo objects embed displayName + fieldName in adjacent positions.
  // Find camelCase strings preceded by their Title Case display name.
  const fieldNames: string[] = [];
  for (let i = 0; i < stringTable.length; i++) {
    if (isTypeDescriptor[i]) continue;
    const s = stringTable[i];
    // Match identifiers: start lowercase, 4+ chars, only letters
    if (!/^[a-z][a-zA-Z]{3,}$/.test(s)) continue;
    // Convert camelCase → Title Case for display name matching
    const titleCase = s
      .replace(/([A-Z])/g, " $1")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    // Check if display name exists within 3 preceding entries
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (!isTypeDescriptor[j] && stringTable[j] === titleCase) {
        fieldNames.push(s);
        break;
      }
    }
  }

  // Step 3: Walk values, identify type markers and split into objects
  function isTypeRef(val: unknown): boolean {
    if (typeof val !== "number" || val <= 0 || val > stringTable.length) return false;
    return isTypeDescriptor[val - 1];
  }

  function resolveValue(val: unknown): string | number | null {
    if (typeof val === "string") return val;
    if (typeof val !== "number") return null;
    if (val === 0) return null;
    if (val > 0 && val <= stringTable.length && !isTypeDescriptor[val - 1]) {
      return stringTable[val - 1];
    }
    return val;
  }

  // Known GWT-RPC infrastructure / ChannelResult metadata types — never event rows
  const METADATA_TYPES = new Set([
    "ChannelResult", "ArrayList", "ResourceReference", "ResourceType",
    "Long", "PagingListResult", "FieldInfo", "FieldType",
    "FieldType$DataType", "FieldType$SemanticType",
    "SortInfo", "SortOrder",
  ]);

  const objects: { type: string; shortType: string; fields: (string | number | null)[] }[] = [];
  let currentType: string | null = null;
  let currentShortType = "";
  let currentFields: (string | number | null)[] = [];

  for (const val of values) {
    if (isTypeRef(val)) {
      if (currentType !== null) {
        objects.push({ type: currentType, shortType: currentShortType, fields: currentFields });
      }
      currentType = stringTable[(val as number) - 1];
      currentShortType = currentType.split(".").pop()?.split("/")[0] ?? currentType;
      currentFields = [];
    } else {
      currentFields.push(resolveValue(val));
    }
  }
  if (currentType !== null) {
    objects.push({ type: currentType, shortType: currentShortType, fields: currentFields });
  }

  // Step 4: Find event rows — the most repeated non-metadata type
  const typeCounts = new Map<string, number>();
  for (const obj of objects) {
    if (!METADATA_TYPES.has(obj.shortType)) {
      typeCounts.set(obj.type, (typeCounts.get(obj.type) ?? 0) + 1);
    }
  }

  let eventType = "";
  let maxCount = 0;
  for (const [type, count] of typeCounts) {
    if (count > maxCount) {
      maxCount = count;
      eventType = type;
    }
  }

  const eventObjects = objects.filter((o) => o.type === eventType);

  // No event rows — channel is empty, return field definitions only
  if (eventObjects.length === 0) {
    return { events: [], totalCount: 0, fieldNames };
  }

  // Step 5: Map event fields to the extracted field names
  const fieldCount = eventObjects[0].fields.length;
  const mappedFieldNames = Array.from({ length: fieldCount }, (_, i) =>
    i < fieldNames.length ? fieldNames[i] : `field_${i}`
  );

  const events: ChannelEvent[] = eventObjects.map((obj) => {
    const fields: Record<string, string | number | null> = {};
    for (let i = 0; i < obj.fields.length; i++) {
      fields[mappedFieldNames[i]] = obj.fields[i];
    }
    return { fields };
  });

  return {
    events,
    totalCount: events.length,
    fieldNames: mappedFieldNames,
  };
}

/**
 * Fetch active channel events via ChannelService.getChannelInfo.
 *
 * Authenticates via Phoenix GWT-RPC login (same token as DataMonitorV2Service).
 * Handles 401 by clearing the Phoenix token and retrying once.
 */
export async function getActiveChannelEvents(
  channelId?: string,
  _isRetry = false
): Promise<ChannelResult> {
  const token = await getPhoenixToken();

  try {
    // Call with current bucket tokens (empty on first call → metadata only)
    const decoded = await callGetChannelInfo(token, lastBucketTokens, channelId);

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

    const result = parseChannelResult(decoded);

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
      const decoded2 = await callGetChannelInfo(token, lastBucketTokens, channelId);
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAuthError = msg.includes("401") || (msg.includes("//EX") && !msg.includes("IncompatibleRemoteServiceException"));
    if (isAuthError && !_isRetry) {
      console.log("[channel-service] Auth error, re-authenticating...");
      clearPhoenixToken();
      lastBucketTokens = []; // Reset buckets on auth error
      const freshToken = await getPhoenixToken();
      const decoded = await callGetChannelInfo(freshToken, [], channelId);
      if (!decoded) {
        return { events: [], totalCount: 0, fieldNames: [] };
      }
      const newTokens = extractBucketTokens(decoded);
      if (newTokens.length > 0) lastBucketTokens = newTokens;
      return parseChannelResult(decoded);
    }
    throw error;
  }
}

/**
 * Fetch the raw decoded GWT-RPC response from ChannelService.getChannelInfo.
 * Returns { values, stringTable } for inspection via ?raw=true.
 */
export async function getActiveChannelEventsRaw(
  channelId?: string,
  _isRetry = false
): Promise<GwtRpcDecodedResponse> {
  const emptyResponse: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };
  const token = await getPhoenixToken();
  try {
    return (await callGetChannelInfo(token, lastBucketTokens, channelId)) ?? emptyResponse;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAuthError = msg.includes("401") || (msg.includes("//EX") && !msg.includes("IncompatibleRemoteServiceException"));
    if (isAuthError && !_isRetry) {
      clearPhoenixToken();
      lastBucketTokens = [];
      const freshToken = await getPhoenixToken();
      return (await callGetChannelInfo(freshToken, [], channelId)) ?? emptyResponse;
    }
    throw error;
  }
}

/**
 * Diagnostic: Run the two-phase bucket polling protocol and return results.
 * Phase 1: Empty buckets → metadata + bucket tokens
 * Phase 2: With bucket tokens → actual events
 */
export async function probeBucketPolling(channelId?: string): Promise<{
  phase1: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string };
  phase2: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
  phase3?: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
}> {
  const emptyDecoded: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };
  const token = await getPhoenixToken();

  // Phase 1: empty buckets
  const decoded1 = (await callGetChannelInfo(token, [], channelId)) ?? emptyDecoded;
  const tokens1 = extractBucketTokens(decoded1);
  const parsed1 = parseChannelResult(decoded1);
  const reqBody1 = (decoded1 as { _requestBody?: string })._requestBody ?? "";
  const hasBucket1 = decoded1.stringTable.some((s) => s.includes("ChannelBucket/"));

  // Phase 2: with bucket tokens from phase 1
  let phase2: { tokens: string[]; eventCount: number; hasBucketType: boolean; fieldNames: string[]; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
  try {
    const decoded2 = (await callGetChannelInfo(token, tokens1, channelId)) ?? emptyDecoded;
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
      const decoded3 = (await callGetChannelInfo(token, tokensForP3, channelId)) ?? emptyDecoded;
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
  error?: string;
}

/** Phase 1 result per channel: metadata + bucket tokens for Phase 2 */
interface Phase1Result {
  channelId: string;
  tokens: string[];
  fieldNames: string[];
  eventCount: number;
  hasBucketType: boolean;
}

/**
 * Scan all active channels to determine which ones contain events.
 *
 * Uses a **batched two-pass** approach to handle the GWT-RPC bucket polling
 * protocol correctly:
 *
 * Pass 1 (Open): Send getChannelInfo with empty buckets to every channel.
 *   This "opens" the channel on the server, returning metadata + bucket tokens.
 *   Concurrency: 4 (single call per channel, fits the 4-conn pool).
 *
 * Wait: 3 seconds for the server to buffer events for opened channels.
 *
 * Pass 2 (Poll): Send getChannelInfo again with the bucket tokens from Pass 1.
 *   The server should now return actual events. Concurrency: 4.
 *
 * Channels that returned events in Pass 1 skip Pass 2.
 * Channels that errored in Pass 1 are reported with their error.
 */
export async function scanAllChannelEvents(
  _isRetry = false
): Promise<{ results: ChannelScanResult[]; scannedAt: string }> {
  const token = await getPhoenixToken();
  const emptyDecoded: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };

  try {
    // Step 1: Discover all channels
    console.log("[channel-scan] Discovering channels...");
    const { groups } = await getAllActiveChannels();

    // Flatten to a unique channel list
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

    console.log(`[channel-scan] Pass 1: Opening ${channels.length} channel(s) in batches of 4...`);

    // --- Pass 1: Open all channels (single call each, 4 concurrent) ---
    const phase1Map = new Map<string, Phase1Result>();
    const errorMap = new Map<string, string>();

    for (let i = 0; i < channels.length; i += 4) {
      const batch = channels.slice(i, i + 4);
      const batchResults = await Promise.allSettled(
        batch.map(async (ch): Promise<Phase1Result> => {
          const decoded = (await callGetChannelInfo(token, [], ch.channelId)) ?? emptyDecoded;
          const tokens = extractBucketTokens(decoded);
          const parsed = parseChannelResult(decoded);
          const hasBucketType = decoded.stringTable.some((s) => s.includes("ChannelBucket/"));
          return {
            channelId: ch.channelId,
            tokens,
            fieldNames: parsed.fieldNames,
            eventCount: parsed.events.length,
            hasBucketType,
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

    // Diagnostic: summarize Phase 1 results
    const withTokens = [...phase1Map.values()].filter((p) => p.tokens.length > 0).length;
    const withEvents = [...phase1Map.values()].filter((p) => p.eventCount > 0).length;
    const withBucketType = [...phase1Map.values()].filter((p) => p.hasBucketType).length;
    console.log(
      `[channel-scan] Pass 1 done: ${phase1Map.size} OK, ${errorMap.size} errors. ` +
      `Bucket tokens: ${withTokens}, immediate events: ${withEvents}, ` +
      `ChannelBucket in stringTable: ${withBucketType}`
    );

    // --- Pass 2: Poll channels that didn't return events yet ---
    const needsPhase2 = channels.filter((ch) => {
      const p1 = phase1Map.get(ch.channelId);
      return p1 && p1.eventCount === 0;
    });

    const phase2Map = new Map<string, { eventCount: number; fieldNames: string[] }>();

    if (needsPhase2.length > 0) {
      // Wait for server to buffer events in the opened channels
      console.log(`[channel-scan] Waiting 3s for server to buffer events...`);
      await new Promise((r) => setTimeout(r, 3000));

      console.log(`[channel-scan] Pass 2: Polling ${needsPhase2.length} channel(s) in batches of 4...`);

      for (let i = 0; i < needsPhase2.length; i += 4) {
        const batch = needsPhase2.slice(i, i + 4);
        const batchResults = await Promise.allSettled(
          batch.map(async (ch) => {
            const p1 = phase1Map.get(ch.channelId)!;
            // Use bucket tokens from Phase 1 if available, otherwise empty
            const decoded = (await callGetChannelInfo(token, p1.tokens, ch.channelId)) ?? emptyDecoded;
            const parsed = parseChannelResult(decoded);
            return {
              channelId: ch.channelId,
              eventCount: parsed.events.length,
              fieldNames: parsed.fieldNames.length > 0 ? parsed.fieldNames : p1.fieldNames,
            };
          })
        );

        for (let j = 0; j < batchResults.length; j++) {
          const r = batchResults[j];
          const ch = batch[j];
          if (r.status === "fulfilled") {
            phase2Map.set(ch.channelId, r.value);
          } else {
            // Phase 2 error — keep Phase 1 results, don't overwrite
            const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            if (!errorMap.has(ch.channelId)) {
              errorMap.set(ch.channelId, `Phase 2: ${errMsg}`);
            }
          }
        }
      }

      const phase2Events = [...phase2Map.values()].filter((p) => p.eventCount > 0).length;
      console.log(`[channel-scan] Pass 2 done: ${phase2Events} channel(s) returned events`);
    }

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
          error: err,
        };
      }

      const p2 = phase2Map.get(ch.channelId);
      const p1 = phase1Map.get(ch.channelId);

      // Prefer Phase 2 results (more likely to have events), fall back to Phase 1
      const eventCount = p2?.eventCount ?? p1?.eventCount ?? 0;
      const fieldNames = (p2?.fieldNames?.length ? p2.fieldNames : p1?.fieldNames) ?? [];

      return {
        channelId: ch.channelId,
        channelName: ch.displayName,
        groupName: ch.groupName,
        subType: ch.subType,
        hasEvents: eventCount > 0,
        eventCount,
        fieldNames,
      };
    });

    const totalWithEvents = results.filter((r) => r.hasEvents).length;
    console.log(
      `[channel-scan] Done: ${totalWithEvents}/${results.length} channels have events`
    );
    return { results, scannedAt: new Date().toISOString() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[channel-scan] Auth error, re-authenticating...");
      clearPhoenixToken();
      return scanAllChannelEvents(true);
    }
    throw error;
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
  requestBody: string
): Promise<GwtRpcDecodedResponse> {
  for (let attempt = 0; attempt < 2; attempt++) {
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
  token: string
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
  return phoenixRpc(serviceUrl, requestBody);
}

/** Debug: expose raw getRootGroupsForResourceType response for inspection */
export async function debugGetRootGroups(): Promise<{
  raw: GwtRpcDecodedResponse;
  parsed: ChannelGroup[];
}> {
  const token = await getPhoenixToken();
  const raw = await callGetRootGroups(token);
  const parsed = parseGroupResponse(raw);
  return { raw, parsed };
}

/** Debug: test channel listing for a specific group name */
export async function debugGetChannelsForGroup(groupName: string): Promise<{
  rootGroups: ChannelGroup[];
  subGroups: ChannelGroup[];
  targetGroup: ChannelGroup | null;
  channelRaw: GwtRpcDecodedResponse | null;
  channels: ActiveChannel[];
}> {
  const token = await getPhoenixToken();

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
  groupPath: string
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
  return phoenixRpc(serviceUrl, requestBody);
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
  groupPath: string
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
  return phoenixRpc(serviceUrl, requestBody);
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
      const epochMs = epochStr ? parseInt(epochStr, 10) : NaN;
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
    callGetChannelGroupChildren(token, group.resourceId, group.path)
      .then((decoded) => parseChannelListResponse(decoded, group.name, group.path)),
    // 2. Try to get sub-groups under this group
    callGetGroupChildren(token, group.resourceId, group.path)
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
    results.push({ ...group, channels });
  }

  // Recurse into sub-groups
  const subGroups =
    subGroupResult.status === "fulfilled" ? subGroupResult.value : [];
  if (subGroups.length > 0) {
    console.log(`${indent}[channel-list] "${group.name}": ${subGroups.length} sub-group(s)`);
    for (const subGroup of subGroups) {
      const subResults = await fetchGroupTreeRecursive(
        token,
        subGroup,
        depth + 1,
        maxDepth
      );
      results.push(...subResults);
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
  _isRetry = false
): Promise<{ groups: ChannelGroupWithChannels[] }> {
  const token = await getPhoenixToken();

  try {
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
    const groups = await fetchGroupTreeRecursive(token, root, 0, 5);

    const totalChannels = groups.reduce(
      (sum, g) => sum + g.channels.length,
      0
    );
    console.log(
      `[channel-list] Done: ${totalChannels} total channels across ${groups.length} group(s)`
    );

    return { groups };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[channel-list] Auth error, re-authenticating...");
      clearPhoenixToken();
      return getAllActiveChannels(true);
    }
    throw error;
  }
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
  rootFilter?: string
): Promise<ClientNode> {
  const { groups } = await getAllActiveChannels();
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
export async function discoverChannelServiceMethods(): Promise<DiscoverResult> {
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

/**
 * Open/subscribe to a channel and fetch the first page of events.
 *
 * ArcSight's ChannelService has a two-step protocol:
 *   1. `getChannelInfo` — opens the channel, returns metadata + bucket tokens
 *   2. `first` — navigates to the first page of events using those tokens
 *
 * Without the `first` call, only metadata is returned (0 events).
 * Returns the result of the `first` call so the caller can use it immediately.
 */
async function ensureChannelSubscribed(
  token: string,
  channelId: string
): Promise<{ tokens: string[]; result: ChannelResult }> {
  const empty: ChannelResult = { events: [], totalCount: 0, fieldNames: [] };

  console.log(`[channel-service] Opening channel ${channelId.slice(0, 12)}...`);

  // Step 1: getChannelInfo — opens the channel, returns metadata + bucket tokens
  const metaDecoded = await callGetChannelInfo(token, [], channelId);
  const metaTokens = metaDecoded ? extractBucketTokens(metaDecoded) : [];

  // Step 2: Try navigation, fall back to getChannelInfo re-poll
  const firstDecoded = await callChannelNavigate("first", token, metaTokens, channelId);

  let resultDecoded: GwtRpcDecodedResponse | null;
  if (firstDecoded) {
    resultDecoded = firstDecoded;
  } else if (metaTokens.length > 0) {
    // Navigation unavailable — re-poll with bucket tokens (v1 fallback)
    resultDecoded = await callGetChannelInfo(token, metaTokens, channelId);
  } else {
    resultDecoded = metaDecoded;
  }

  const resultTokens = resultDecoded ? extractBucketTokens(resultDecoded) : metaTokens;
  const result = resultDecoded ? parseChannelResult(resultDecoded) : empty;

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
 * Clear subscription state (used on auth errors).
 */
function clearSubscriptions(): void {
  subscribedChannels.clear();
  channelBucketTokens.clear();
  lastBucketTokens = [];
}

/**
 * Fetch active channel events with navigation-aware flow.
 *
 * First call:  getChannelInfo → first → returns initial events
 * Subsequent:  next (with stored bucket tokens) → returns new events
 *
 * No more sleep-and-retry — the `first` / `next` navigation methods
 * return events directly.
 */
export async function getActiveChannelEventsWithSubscription(
  channelId: string,
  _isRetry = false
): Promise<ChannelResult> {
  const token = await getPhoenixToken();
  const empty: ChannelResult = { events: [], totalCount: 0, fieldNames: [] };

  try {
    // First call: open + first (returns initial events immediately)
    if (!subscribedChannels.has(channelId)) {
      const { result } = await ensureChannelSubscribed(token, channelId);
      return result;
    }

    // Subsequent polls: try "next", fall back to getChannelInfo
    const bucketTokens = channelBucketTokens.get(channelId) ?? lastBucketTokens;
    const decoded = await callChannelNavigate("next", token, bucketTokens, channelId)
      ?? await callGetChannelInfo(token, bucketTokens, channelId);

    if (!decoded) return empty;

    // Update bucket tokens for next poll
    const newTokens = extractBucketTokens(decoded);
    if (newTokens.length > 0) {
      channelBucketTokens.set(channelId, newTokens);
      lastBucketTokens = newTokens;
    }

    return parseChannelResult(decoded);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAuthError = msg.includes("401") || (msg.includes("//EX") && !msg.includes("IncompatibleRemoteServiceException"));
    if (isAuthError && !_isRetry) {
      console.log("[channel-service] Auth error, re-authenticating...");
      clearPhoenixToken();
      clearSubscriptions();
      return getActiveChannelEventsWithSubscription(channelId, true);
    }
    throw error;
  }
}

/**
 * Scan all channels using navigation methods.
 *
 * Pass 1: getChannelInfo per channel → metadata + bucket tokens (opens the channel)
 * Pass 2: first per channel → actual events (no sleep needed)
 *
 * The `first` navigation method returns events directly — the old 3s
 * "server buffering wait" was a workaround for only using getChannelInfo.
 */
export async function scanAllChannelEventsWithSubscription(
  _isRetry = false
): Promise<{ results: ChannelScanResult[]; scannedAt: string }> {
  const token = await getPhoenixToken();
  const emptyDecoded: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };

  try {
    console.log("[channel-scan-v2] Discovering channels...");
    const { groups } = await getAllActiveChannels();

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

    // --- Pass 1: getChannelInfo (open) all channels → metadata + bucket tokens ---
    console.log(`[channel-scan-v2] Pass 1: Opening ${channels.length} channel(s)...`);

    const phase1Map = new Map<string, Phase1Result>();
    const errorMap = new Map<string, string>();

    for (let i = 0; i < channels.length; i += 4) {
      const batch = channels.slice(i, i + 4);
      const batchResults = await Promise.allSettled(
        batch.map(async (ch): Promise<Phase1Result> => {
          const decoded = (await callGetChannelInfo(token, [], ch.channelId)) ?? emptyDecoded;
          const tokens = extractBucketTokens(decoded);
          const parsed = parseChannelResult(decoded);
          const hasBucketType = decoded.stringTable.some((s) => s.includes("ChannelBucket/"));

          subscribedChannels.add(ch.channelId);
          if (tokens.length > 0) {
            channelBucketTokens.set(ch.channelId, tokens);
          }

          return {
            channelId: ch.channelId,
            tokens,
            fieldNames: parsed.fieldNames,
            eventCount: parsed.events.length,
            hasBucketType,
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

    const withTokens = [...phase1Map.values()].filter((p) => p.tokens.length > 0).length;
    console.log(
      `[channel-scan-v2] Pass 1: ${phase1Map.size} OK, ${errorMap.size} errors. ` +
      `Bucket tokens: ${withTokens}`
    );

    // --- Pass 2: "first" navigation → actual events (no sleep needed) ---
    const needsPhase2 = channels.filter((ch) => {
      const p1 = phase1Map.get(ch.channelId);
      return p1 && p1.eventCount === 0;
    });

    const phase2Map = new Map<string, { eventCount: number; fieldNames: string[] }>();

    if (needsPhase2.length > 0) {
      if (!navigationMethodsSupported) {
        console.log(`[channel-scan-v2] Navigation unavailable — waiting 3s for server to buffer events...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      console.log(`[channel-scan-v2] Pass 2: Fetching events on ${needsPhase2.length} channel(s)...`);

      for (let i = 0; i < needsPhase2.length; i += 4) {
        const batch = needsPhase2.slice(i, i + 4);
        const batchResults = await Promise.allSettled(
          batch.map(async (ch) => {
            const p1 = phase1Map.get(ch.channelId)!;
            const tokens = channelBucketTokens.get(ch.channelId) ?? p1.tokens;
            const decoded = (await callChannelNavigate("first", token, tokens, ch.channelId))
              ?? (await callGetChannelInfo(token, tokens, ch.channelId))
              ?? emptyDecoded;
            const parsed = parseChannelResult(decoded);

            const newTokens = extractBucketTokens(decoded);
            if (newTokens.length > 0) {
              channelBucketTokens.set(ch.channelId, newTokens);
            }

            return {
              channelId: ch.channelId,
              eventCount: parsed.events.length,
              fieldNames: parsed.fieldNames.length > 0 ? parsed.fieldNames : p1.fieldNames,
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

      const phase2Events = [...phase2Map.values()].filter((p) => p.eventCount > 0).length;
      console.log(`[channel-scan-v2] Pass 2: ${phase2Events} channel(s) returned events`);
    }

    // --- Build results ---
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
          error: err,
        };
      }

      const p2 = phase2Map.get(ch.channelId);
      const p1 = phase1Map.get(ch.channelId);
      const eventCount = p2?.eventCount ?? p1?.eventCount ?? 0;
      const fieldNames = (p2?.fieldNames?.length ? p2.fieldNames : p1?.fieldNames) ?? [];

      return {
        channelId: ch.channelId,
        channelName: ch.displayName,
        groupName: ch.groupName,
        subType: ch.subType,
        hasEvents: eventCount > 0,
        eventCount,
        fieldNames,
      };
    });

    const totalWithEvents = results.filter((r) => r.hasEvents).length;
    console.log(
      `[channel-scan-v2] Done: ${totalWithEvents}/${results.length} channels have events`
    );
    return { results, scannedAt: new Date().toISOString() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAuthError = msg.includes("401") || (msg.includes("//EX") && !msg.includes("IncompatibleRemoteServiceException"));
    if (isAuthError && !_isRetry) {
      console.log("[channel-scan-v2] Auth error, re-authenticating...");
      clearPhoenixToken();
      clearSubscriptions();
      return scanAllChannelEventsWithSubscription(true);
    }
    throw error;
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
export async function discoverReportService(): Promise<ReportDiscoverResult> {
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
  token: string
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
  return phoenixRpc(serviceUrl, requestBody);
}

/**
 * Call GroupService.getGroupChildrenResourcesWithRequest for report groups.
 */
async function callGetReportGroupChildren(
  token: string,
  groupResourceId: string,
  groupPath: string
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
  return phoenixRpc(serviceUrl, requestBody);
}

async function callGetReportById(
  token: string,
  reportId: string
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
  return phoenixRpc(serviceUrl, requestBody);
}

async function callFindAllReportIds(
  token: string
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
  return phoenixRpc(serviceUrl, requestBody);
}

async function callRunReport(
  token: string,
  reportId: string
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
  return phoenixRpc(serviceUrl, requestBody);
}

async function callGetArchivedReports(
  token: string,
  reportId: string
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
  return phoenixRpc(serviceUrl, requestBody);
}

async function callDownloadReport(
  token: string,
  archiveId: string
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
  return phoenixRpc(serviceUrl, requestBody);
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
  group: ReportGroup,
  depth: number,
  maxDepth: number
): Promise<ReportTreeGroup[]> {
  if (depth >= maxDepth) return [];

  const decoded = await callGetReportGroupChildren(token, group.resourceId, group.path);
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
    const children = await fetchReportGroupTree(token, sg, depth + 1, maxDepth);
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
  _isRetry = false
): Promise<string[]> {
  const token = await getPhoenixToken();

  try {
    const decoded = await callFindAllReportIds(token);
    // findAllIds returns IDs in the string table (excluding type descriptors)
    const typeDescPattern = /^[\w.$]+\/\d+$/;
    return decoded.stringTable.filter((s) => !typeDescPattern.test(s) && s.length > 5);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[report-service] Auth error, re-authenticating...");
      clearPhoenixToken();
      return findAllReportIds(true);
    }
    throw error;
  }
}

export async function getAllReports(
  _isRetry = false
): Promise<{ groups: ReportTreeGroup[] }> {
  const token = await getPhoenixToken();

  try {
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
    const groups = await fetchReportGroupTree(token, root, 0, 5);

    const totalReports = groups.reduce((sum, g) => sum + g.reports.length, 0);
    console.log(
      `[report-list] Done: ${totalReports} total reports across ${groups.length} group(s)`
    );

    return { groups };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[report-list] Auth error, re-authenticating...");
      clearPhoenixToken();
      return getAllReports(true);
    }
    throw error;
  }
}

export async function getReportById(
  reportId: string,
  _isRetry = false
): Promise<ReportDefinition | null> {
  const token = await getPhoenixToken();

  try {
    const decoded = await callGetReportById(token, reportId);
    return parseReportDetail(decoded);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[report-service] Auth error, re-authenticating...");
      clearPhoenixToken();
      return getReportById(reportId, true);
    }
    throw error;
  }
}

export async function runReport(
  reportId: string,
  _isRetry = false
): Promise<{ triggered: boolean; raw: unknown }> {
  const token = await getPhoenixToken();

  try {
    const decoded = await callRunReport(token, reportId);
    return { triggered: decoded.ok, raw: decoded };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[report-service] Auth error, re-authenticating...");
      clearPhoenixToken();
      return runReport(reportId, true);
    }
    throw error;
  }
}

export async function getArchivedReports(
  reportId: string,
  _isRetry = false
): Promise<ArchivedReport[]> {
  const token = await getPhoenixToken();

  try {
    const decoded = await callGetArchivedReports(token, reportId);
    return parseArchivedReports(decoded);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[report-service] Auth error, re-authenticating...");
      clearPhoenixToken();
      return getArchivedReports(reportId, true);
    }
    throw error;
  }
}

export async function downloadReport(
  archiveId: string,
  _isRetry = false
): Promise<{ content: string; raw: unknown }> {
  const token = await getPhoenixToken();

  try {
    const decoded = await callDownloadReport(token, archiveId);
    const typeDescPattern = /^[\w.$]+\/\d+$/;
    const content = decoded.stringTable.find(
      (s) => !typeDescPattern.test(s) && s.length > 20
    ) ?? "";
    return { content, raw: decoded };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
      console.log("[report-service] Auth error, re-authenticating...");
      clearPhoenixToken();
      return downloadReport(archiveId, true);
    }
    throw error;
  }
}
