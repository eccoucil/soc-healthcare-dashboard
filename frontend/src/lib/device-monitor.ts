import "server-only";
import {
  sendDeviceDownAlert,
  sendDeviceRecoveryAlert,
  type ChannelAlertInfo,
} from "@/lib/alert-email";

const LOG = "[device-monitor]";

// --- Config ---

const POLL_INTERVAL_MS = Number(
  process.env.ALERT_POLL_INTERVAL_MS || 300_000
); // 5 min
const INACTIVITY_THRESHOLD_MS = Number(
  process.env.ALERT_INACTIVITY_THRESHOLD_MS || 300_000
); // 5 min
const TOKEN_REFRESH_MS = 20 * 60 * 60_000; // 20 hours

// --- State ---

interface ChannelAlertState {
  channelId: string;
  channelName: string;
  groupName: string;
  lastEventTime: number;
  alertSentAt: number;
  deviceVendor?: string;
  deviceProduct?: string;
}

/** Channels currently in ALERTED state (silent, email sent). */
const alertedChannels = new Map<string, ChannelAlertState>();

/** Monitor's own auth tokens (independent of user sessions). */
let monitorRestToken: string | null = null;
let monitorPhoenixToken: string | null = null;
let monitorPhoenixCookies: string | null = null;
let tokenObtainedAt = 0;

/** Stats */
let running = false;
let totalCycles = 0;
let alertsSent = 0;
let recoveriesSent = 0;
let emailFailures = 0;
let lastCycleAt: string | null = null;
let lastCycleDurationMs = 0;
let lastCycleError: string | null = null;
let channelsMonitored = 0;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// --- Public API ---

export interface MonitorStatus {
  enabled: boolean;
  running: boolean;
  pollIntervalMs: number;
  inactivityThresholdMs: number;
  lastCycleAt: string | null;
  lastCycleDurationMs: number;
  lastCycleError: string | null;
  tokenStatus: "valid" | "expired" | "none";
  channelsMonitored: number;
  alertedChannels: {
    channelId: string;
    channelName: string;
    silentSince: string;
    alertSentAt: string;
  }[];
  stats: {
    totalCycles: number;
    alertsSent: number;
    recoveriesSent: number;
    emailFailures: number;
  };
}

export function getMonitorStatus(): MonitorStatus {
  const hasApiKey = !!process.env.RESEND_API_KEY;
  const hasCredentials =
    !!process.env.ARCSIGHT_USERNAME && !!process.env.ARCSIGHT_PASSWORD;

  let tokenStatus: "valid" | "expired" | "none" = "none";
  if (monitorRestToken && monitorPhoenixToken) {
    tokenStatus =
      Date.now() - tokenObtainedAt > TOKEN_REFRESH_MS ? "expired" : "valid";
  }

  return {
    enabled: hasApiKey && hasCredentials,
    running,
    pollIntervalMs: POLL_INTERVAL_MS,
    inactivityThresholdMs: INACTIVITY_THRESHOLD_MS,
    lastCycleAt,
    lastCycleDurationMs,
    lastCycleError,
    tokenStatus,
    channelsMonitored,
    alertedChannels: Array.from(alertedChannels.values()).map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      silentSince: new Date(s.lastEventTime).toISOString(),
      alertSentAt: new Date(s.alertSentAt).toISOString(),
    })),
    stats: {
      totalCycles,
      alertsSent,
      recoveriesSent,
      emailFailures,
    },
  };
}

// --- Auth ---

async function ensureTokens(): Promise<boolean> {
  // Proactive refresh if tokens are old
  const needsRefresh =
    !monitorRestToken ||
    !monitorPhoenixToken ||
    Date.now() - tokenObtainedAt > TOKEN_REFRESH_MS;

  if (!needsRefresh) return true;

  const username =
    process.env.ARCSIGHT_MONITOR_USERNAME || process.env.ARCSIGHT_USERNAME;
  const password =
    process.env.ARCSIGHT_MONITOR_PASSWORD || process.env.ARCSIGHT_PASSWORD;

  if (!username || !password) {
    console.error(`${LOG} No ArcSight credentials configured`);
    return false;
  }

  try {
    // Dynamic imports to avoid circular module initialization
    const { loginToArcsight } = await import("@/lib/arcsight-client");
    const { loginToPhoenix } = await import("@/lib/arcsight-channel-client");

    const [restToken, phoenixResult] = await Promise.all([
      loginToArcsight(username, password),
      loginToPhoenix(username, password),
    ]);

    monitorRestToken = restToken;
    monitorPhoenixToken = phoenixResult.token;
    monitorPhoenixCookies = phoenixResult.cookies;
    tokenObtainedAt = Date.now();

    console.log(`${LOG} Tokens acquired successfully`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} Token acquisition failed: ${msg}`);
    // Clear tokens on auth failure so next cycle retries
    monitorRestToken = null;
    monitorPhoenixToken = null;
    monitorPhoenixCookies = null;
    return false;
  }
}

// --- Monitor cycle ---

async function runMonitorCycle(): Promise<void> {
  const cycleStart = Date.now();
  totalCycles++;

  try {
    // 1. Ensure tokens
    const hasTokens = await ensureTokens();
    if (!hasTokens) {
      lastCycleError = "Failed to acquire ArcSight tokens";
      return;
    }

    // 2. Scan channels
    const { scanAllChannelEvents } = await import(
      "@/lib/arcsight-channel-client"
    );

    const auth = {
      restToken: monitorRestToken!,
      phoenixToken: monitorPhoenixToken!,
      phoenixCookies: monitorPhoenixCookies!,
    };

    const { results } = await scanAllChannelEvents(auth);
    channelsMonitored = results.length;

    const now = Date.now();
    const newlyDown: ChannelAlertInfo[] = [];
    const newlyRecovered: ChannelAlertInfo[] = [];

    // 3. Evaluate each channel
    for (const ch of results) {
      // Skip channels that have never had events
      if (ch.latestManagerReceiptTime == null) continue;

      const silenceMs = now - ch.latestManagerReceiptTime;
      const isSilent = silenceMs > INACTIVITY_THRESHOLD_MS;

      if (isSilent && !alertedChannels.has(ch.channelId)) {
        // Transition: ACTIVE → ALERTED
        newlyDown.push({
          channelName: ch.channelName,
          groupName: ch.groupName,
          deviceVendor: ch.eventFields?.deviceVendor as string | undefined,
          deviceProduct: ch.eventFields?.deviceProduct as string | undefined,
          lastEventTime: ch.latestManagerReceiptTime,
          silenceDurationMs: silenceMs,
        });

        alertedChannels.set(ch.channelId, {
          channelId: ch.channelId,
          channelName: ch.channelName,
          groupName: ch.groupName,
          lastEventTime: ch.latestManagerReceiptTime,
          alertSentAt: now,
          deviceVendor: ch.eventFields?.deviceVendor as string | undefined,
          deviceProduct: ch.eventFields?.deviceProduct as string | undefined,
        });
      } else if (!isSilent && alertedChannels.has(ch.channelId)) {
        // Transition: ALERTED → RECOVERED
        const alertState = alertedChannels.get(ch.channelId)!;
        newlyRecovered.push({
          channelName: ch.channelName,
          groupName: ch.groupName,
          deviceVendor: alertState.deviceVendor,
          deviceProduct: alertState.deviceProduct,
          lastEventTime: ch.latestManagerReceiptTime,
          silenceDurationMs: now - alertState.lastEventTime,
        });

        alertedChannels.delete(ch.channelId);
      }
    }

    // 4. Send emails
    if (newlyDown.length > 0) {
      const result = await sendDeviceDownAlert(newlyDown);
      if (result.success) {
        alertsSent++;
      } else {
        emailFailures++;
      }
      console.log(
        `${LOG} ${newlyDown.length} channel(s) went silent — email ${result.success ? "sent" : "failed"}`
      );
    }

    if (newlyRecovered.length > 0) {
      const result = await sendDeviceRecoveryAlert(newlyRecovered);
      if (result.success) {
        recoveriesSent++;
      } else {
        emailFailures++;
      }
      console.log(
        `${LOG} ${newlyRecovered.length} channel(s) recovered — email ${result.success ? "sent" : "failed"}`
      );
    }

    lastCycleError = null;
    console.log(
      `${LOG} Cycle #${totalCycles} complete: ${results.length} channels, ${alertedChannels.size} alerted, ${newlyDown.length} new alerts, ${newlyRecovered.length} recoveries`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastCycleError = msg;
    console.error(`${LOG} Cycle #${totalCycles} failed: ${msg}`);

    // Clear tokens on 401 so next cycle re-authenticates
    if (msg.includes("401") || msg.includes("Unauthorized")) {
      monitorRestToken = null;
      monitorPhoenixToken = null;
      monitorPhoenixCookies = null;
      console.log(`${LOG} Cleared tokens after auth error — will retry next cycle`);
    }
  } finally {
    lastCycleAt = new Date().toISOString();
    lastCycleDurationMs = Date.now() - cycleStart;
  }
}

// --- Startup ---

export function startDeviceMonitor(): void {
  // Prerequisites
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      `${LOG} RESEND_API_KEY not set — device monitor disabled`
    );
    return;
  }

  if (!process.env.ARCSIGHT_USERNAME || !process.env.ARCSIGHT_PASSWORD) {
    console.warn(
      `${LOG} ArcSight credentials not set — device monitor disabled`
    );
    return;
  }

  if (running) {
    console.warn(`${LOG} Already running — skipping duplicate start`);
    return;
  }

  running = true;
  console.log(
    `${LOG} Starting — poll every ${POLL_INTERVAL_MS / 1000}s, inactivity threshold ${INACTIVITY_THRESHOLD_MS / 1000}s`
  );

  // Run first cycle after a short delay (let server finish startup)
  setTimeout(() => {
    runMonitorCycle();
    intervalHandle = setInterval(runMonitorCycle, POLL_INTERVAL_MS);
  }, 10_000);
}

export function stopDeviceMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  running = false;
  console.log(`${LOG} Stopped`);
}
