import {
  getConnectorsForCustomer,
  linkConnectorsToCustomer,
  unlinkConnectorsFromCustomer,
} from "@/lib/arcsight-client";
import type { LinkConnectorsRequest } from "@/types/arcsight";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const connectors = await getConnectorsForCustomer(id);
    return Response.json(connectors, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as LinkConnectorsRequest;

    if (!Array.isArray(body.connectorIds) || body.connectorIds.length === 0) {
      return Response.json(
        { error: "connectorIds must be a non-empty array" },
        { status: 400 }
      );
    }

    await linkConnectorsToCustomer(id, body.connectorIds);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as LinkConnectorsRequest;

    if (!Array.isArray(body.connectorIds) || body.connectorIds.length === 0) {
      return Response.json(
        { error: "connectorIds must be a non-empty array" },
        { status: 400 }
      );
    }

    await unlinkConnectorsFromCustomer(id, body.connectorIds);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
