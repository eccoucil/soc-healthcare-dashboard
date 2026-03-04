import { buildClearSessionCookie } from "@/lib/session";

export async function POST() {
  const cookie = buildClearSessionCookie();

  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${cookie.name}=${cookie.value}; HttpOnly; Path=${cookie.path}; Max-Age=${cookie.maxAge}; SameSite=${cookie.sameSite}${cookie.secure ? "; Secure" : ""}`,
        "Cache-Control": "no-store",
      },
    }
  );
}
