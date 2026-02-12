import { getConnectorDevices } from "@/lib/arcsight-client";

export async function GET() {
  try {
    const devices = await getConnectorDevices();
    return Response.json(devices, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Graceful degradation: return empty map with warning instead of 500
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to fetch connector devices:", message);
    return Response.json(
      { warning: `Devices unavailable: ${message}` },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
