import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    {
      authenticated: true,
      username: session.username,
      loginTimestamp: session.loginTimestamp,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
