import { NextRequest } from "next/server";
import { getAllClients } from "@/lib/arcsight-client";

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get("search") ?? undefined;
    const clients = await getAllClients(search);
    return Response.json(clients, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
