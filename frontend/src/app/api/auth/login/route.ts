import { loginToArcsight } from "@/lib/arcsight-client";
import { loginToPhoenix } from "@/lib/arcsight-channel-client";
import { buildSessionCookie, type ESMSession } from "@/lib/session";
import { containsDangerousPatterns, sanitizePassword } from "@/lib/password-validation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body as { username?: string; password?: string };

    if (!username || !password) {
      return Response.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    if (containsDangerousPatterns(password)) {
      return Response.json(
        { error: "Password contains invalid characters" },
        { status: 400 }
      );
    }

    const sanitized = sanitizePassword(password);

    // Authenticate with both REST and Phoenix in parallel
    const [restToken, phoenixResult] = await Promise.all([
      loginToArcsight(username, sanitized),
      loginToPhoenix(username, sanitized),
    ]);

    const session: ESMSession = {
      username,
      password: sanitized,
      restToken,
      phoenixToken: phoenixResult.token,
      phoenixCookies: phoenixResult.cookies,
      loginTimestamp: Date.now(),
    };

    const cookie = buildSessionCookie(session);

    return Response.json(
      { ok: true, username },
      {
        status: 200,
        headers: {
          "Set-Cookie": `${cookie.name}=${cookie.value}; HttpOnly; Path=${cookie.path}; Max-Age=${cookie.maxAge}; SameSite=${cookie.sameSite}${cookie.secure ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    console.error("[auth/login]", message);

    const status = message.includes("401") || message.includes("login failed")
      ? 401
      : 500;

    return Response.json(
      { error: status === 401 ? "Invalid credentials" : "Authentication service error" },
      { status }
    );
  }
}
