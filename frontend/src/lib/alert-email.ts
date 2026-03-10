import "server-only";
import { Resend } from "resend";
import { DeviceAlertEmail, type AlertChannel } from "@/emails/device-alert";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const DEFAULT_FROM = "ECC-SOC Alerts <onboarding@resend.dev>";
const LOG_PREFIX = "[alert-email]";

function getFromAddress(): string {
  return process.env.ALERT_EMAIL_FROM || DEFAULT_FROM;
}

function getRecipients(): string[] {
  const raw = process.env.ALERT_EMAIL_RECIPIENTS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

export interface ChannelAlertInfo {
  channelName: string;
  groupName: string;
  deviceVendor?: string;
  deviceProduct?: string;
  lastEventTime: number; // epoch ms
  silenceDurationMs: number;
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""}`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (remainMins === 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
  return `${hours}h ${remainMins}m`;
}

function toAlertChannels(channels: ChannelAlertInfo[]): AlertChannel[] {
  return channels.map((ch) => ({
    channelName: ch.channelName,
    groupName: ch.groupName,
    deviceVendor: ch.deviceVendor,
    deviceProduct: ch.deviceProduct,
    lastEventTime: new Date(ch.lastEventTime).toUTCString(),
    silenceDuration: formatDuration(ch.silenceDurationMs),
  }));
}

export async function sendDeviceDownAlert(
  channels: ChannelAlertInfo[]
): Promise<{ success: boolean; error?: string }> {
  const recipients = getRecipients();
  if (recipients.length === 0) {
    console.warn(`${LOG_PREFIX} No recipients configured — skipping down alert`);
    return { success: false, error: "No recipients configured" };
  }

  const subject =
    channels.length === 1
      ? `[ECC-SOC] Device Alert: ${channels[0].channelName} silent for 5+ min`
      : `[ECC-SOC] ${channels.length} Devices Silent`;

  try {
    const { error } = await getResend().emails.send({
      from: getFromAddress(),
      to: recipients,
      subject,
      react: DeviceAlertEmail({
        type: "down",
        channels: toAlertChannels(channels),
      }),
    });

    if (error) {
      console.error(`${LOG_PREFIX} Resend API error:`, error);
      return { success: false, error: error.message };
    }

    console.log(
      `${LOG_PREFIX} Down alert sent for ${channels.length} channel(s) to ${recipients.join(", ")}`
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Failed to send down alert:`, msg);
    return { success: false, error: msg };
  }
}

export async function sendDeviceRecoveryAlert(
  channels: ChannelAlertInfo[]
): Promise<{ success: boolean; error?: string }> {
  const recipients = getRecipients();
  if (recipients.length === 0) {
    console.warn(
      `${LOG_PREFIX} No recipients configured — skipping recovery alert`
    );
    return { success: false, error: "No recipients configured" };
  }

  const subject =
    channels.length === 1
      ? `[ECC-SOC] Device Recovered: ${channels[0].channelName}`
      : `[ECC-SOC] ${channels.length} Devices Recovered`;

  try {
    const { error } = await getResend().emails.send({
      from: getFromAddress(),
      to: recipients,
      subject,
      react: DeviceAlertEmail({
        type: "recovery",
        channels: toAlertChannels(channels),
      }),
    });

    if (error) {
      console.error(`${LOG_PREFIX} Resend API error:`, error);
      return { success: false, error: error.message };
    }

    console.log(
      `${LOG_PREFIX} Recovery alert sent for ${channels.length} channel(s) to ${recipients.join(", ")}`
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Failed to send recovery alert:`, msg);
    return { success: false, error: msg };
  }
}
