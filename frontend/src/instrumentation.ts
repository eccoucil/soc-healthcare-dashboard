export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDeviceMonitor } = await import("@/lib/device-monitor");
    startDeviceMonitor();
  }
}
