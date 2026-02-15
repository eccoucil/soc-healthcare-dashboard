import "server-only";
import { Agent } from "undici";
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
const DEFAULT_RESOURCE_ID =
  process.env.ARCSIGHT_DEFAULT_CHANNEL_GROUP_ID ?? "0ZCtb5pkBABCADD06t8MaJw==";

const PHOENIX_TIMEOUT_MS = 20_000;

// GWT module base — shared across all Phoenix GWT-RPC services
const MODULE_BASE =
  "https://ecccdesmt01:48443/www/ui-phoenix/com.arcsight.phoenix.PhoenixLauncher/";

// Separate connection pool for Phoenix (GWT-RPC endpoint)
const phoenixDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
  connections: 4,
  pipelining: 1,
  connectTimeout: 15_000,
});

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
        "X-GWT-Permutation": LOGIN_STRONG_NAME,
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
        "X-GWT-Permutation": DATAMONITOR_STRONG_NAME,
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
