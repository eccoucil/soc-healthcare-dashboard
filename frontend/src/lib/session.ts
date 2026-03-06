import "server-only";
import { cookies } from "next/headers";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";

// --- Types ---

export interface SessionAuth {
  restToken: string;
  phoenixToken: string;
  phoenixCookies: string;
}

export interface ESMSession extends SessionAuth {
  username: string;
  password: string;
  loginTimestamp: number;
}

export class AuthError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "AuthError";
  }
}

// --- Cookie config ---

const COOKIE_NAME = "esm_session";
const MAX_AGE = 24 * 60 * 60; // 24 hours
const SESSION_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours — refresh before 24h cookie expiry

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters. Set it in .env.local"
    );
  }
  return createHash("sha256").update(secret).digest();
}

// --- Encryption (AES-256-GCM) ---

export function encrypt(session: ESMSession): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(session);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: iv (12) + tag (16) + ciphertext → base64
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(encoded: string): ESMSession | null {
  try {
    const key = getEncryptionKey();
    const buf = Buffer.from(encoded, "base64");
    if (buf.length < 29) return null; // 12 iv + 16 tag + 1 min data
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as ESMSession;
  } catch {
    return null; // Tampered or invalid
  }
}

// --- Cookie helpers ---

export function buildSessionCookie(session: ESMSession) {
  return {
    name: COOKIE_NAME,
    value: encrypt(session),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: MAX_AGE,
    path: "/",
  };
}

export function serializeCookie(cookie: ReturnType<typeof buildSessionCookie>): string {
  return `${cookie.name}=${cookie.value}; HttpOnly; Path=${cookie.path}; Max-Age=${cookie.maxAge}; SameSite=${cookie.sameSite}${cookie.secure ? "; Secure" : ""}`;
}

export function buildClearSessionCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
    path: "/",
  };
}

// --- Session readers ---

export async function getSession(): Promise<ESMSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  return decrypt(cookie.value);
}

export async function requireAuth(): Promise<SessionAuth> {
  const session = await getSession();
  if (!session) throw new AuthError();

  // Check TTL — force re-login if session is older than 23 hours
  if (Date.now() - session.loginTimestamp > SESSION_TTL_MS) {
    throw new AuthError("Session expired");
  }

  return {
    restToken: session.restToken,
    phoenixToken: session.phoenixToken,
    phoenixCookies: session.phoenixCookies,
  };
}

// --- 401 Detection ---

export function isTokenExpiredError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("401") ||
    msg.includes("Unauthorized") ||
    (msg.includes("//EX") && !msg.includes("IncompatibleRemoteServiceException"))
  );
}

// --- Token Refresh ---

// Deduplication: prevent thundering herd when multiple concurrent requests hit 401
let refreshPromise: Promise<{ auth: SessionAuth; cookieHeader: string }> | null = null;

export async function refreshSession(): Promise<{
  auth: SessionAuth;
  cookieHeader: string;
}> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const session = await getSession();
      if (!session?.username || !session?.password) {
        throw new AuthError("Cannot refresh — no stored credentials");
      }

      // Lazy imports to avoid circular dependencies
      const { loginToArcsight } = await import("@/lib/arcsight-client");
      const { loginToPhoenix } = await import("@/lib/arcsight-channel-client");

      const [restToken, phoenixResult] = await Promise.all([
        loginToArcsight(session.username, session.password),
        loginToPhoenix(session.username, session.password),
      ]);

      const newSession: ESMSession = {
        username: session.username,
        password: session.password,
        restToken,
        phoenixToken: phoenixResult.token,
        phoenixCookies: phoenixResult.cookies,
        loginTimestamp: Date.now(),
      };

      const cookie = buildSessionCookie(newSession);
      const cookieHeader = serializeCookie(cookie);

      console.log("[session] Tokens refreshed successfully");

      return {
        auth: {
          restToken: newSession.restToken,
          phoenixToken: newSession.phoenixToken,
          phoenixCookies: newSession.phoenixCookies,
        },
        cookieHeader,
      };
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// --- Auth Retry Wrapper ---

export async function withAuthRetry<T>(
  fn: (auth: SessionAuth) => Promise<T>
): Promise<{ data: T; cookieHeader?: string }> {
  try {
    const auth = await requireAuth();
    const data = await fn(auth);
    return { data };
  } catch (error) {
    // Retry on: session TTL expired (AuthError) OR ArcSight token rejected (401/Unauthorized)
    if (!(error instanceof AuthError) && !isTokenExpiredError(error)) throw error;

    console.log("[session] Auth failed, attempting token refresh...");
    try {
      const { auth: newAuth, cookieHeader } = await refreshSession();
      const data = await fn(newAuth);
      return { data, cookieHeader };
    } catch (refreshError) {
      // Refresh failed — throw AuthError so route returns 401
      if (refreshError instanceof AuthError) throw refreshError;
      throw new AuthError("Token refresh failed");
    }
  }
}
