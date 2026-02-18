import { NextResponse } from "next/server";
import { getProxyMode, getProxyInfo } from "@/lib/arcsight-dispatcher";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    mode: getProxyMode(),
    proxy: getProxyInfo(),
    timestamp: new Date().toISOString(),
  });
}
