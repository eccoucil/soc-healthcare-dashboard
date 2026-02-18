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
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
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
    if ((msg.includes("401") || msg.includes("//EX")) && !_isRetry) {
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
  phase1: { tokens: string[]; eventCount: number; raw: GwtRpcDecodedResponse; requestBody: string };
  phase2: { tokens: string[]; eventCount: number; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
}> {
  const emptyDecoded: GwtRpcDecodedResponse = { ok: true, values: [], stringTable: [] };
  const token = await getPhoenixToken();

  // Phase 1: empty buckets
  const decoded1 = (await callGetChannelInfo(token, [], channelId)) ?? emptyDecoded;
  const tokens1 = extractBucketTokens(decoded1);
  const parsed1 = parseChannelResult(decoded1);
  const reqBody1 = (decoded1 as { _requestBody?: string })._requestBody ?? "";

  // Phase 2: with bucket tokens from phase 1
  let phase2: { tokens: string[]; eventCount: number; raw: GwtRpcDecodedResponse; requestBody: string } | { error: string };
  try {
    const decoded2 = (await callGetChannelInfo(token, tokens1, channelId)) ?? emptyDecoded;
    const tokens2 = extractBucketTokens(decoded2);
    const parsed2 = parseChannelResult(decoded2);
    const reqBody2 = (decoded2 as { _requestBody?: string })._requestBody ?? "";
    phase2 = { tokens: tokens2, eventCount: parsed2.events.length, raw: decoded2, requestBody: reqBody2 };
  } catch (err) {
    phase2 = { error: err instanceof Error ? err.message : String(err) };
  }

  return {
    phase1: { tokens: tokens1, eventCount: parsed1.events.length, raw: decoded1, requestBody: reqBody1 },
    phase2,
  };
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
      `GWT-RPC call failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    );
  }

  const rawText = await res.text();
  return decodeGwtRpcResponse(rawText);
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

      channels.push({
        displayName,
        resourceId,
        path,
        subType,
        lastUpdateTime: null,
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
