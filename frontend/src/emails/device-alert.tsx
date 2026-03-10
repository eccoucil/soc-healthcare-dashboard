import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
  Preview,
} from "@react-email/components";

export interface AlertChannel {
  channelName: string;
  groupName: string;
  deviceVendor?: string;
  deviceProduct?: string;
  lastEventTime: string; // ISO string
  silenceDuration: string; // human-readable e.g. "12 minutes"
}

interface DeviceAlertEmailProps {
  type: "down" | "recovery";
  channels: AlertChannel[];
  dashboardUrl?: string;
}

export function DeviceAlertEmail({
  type,
  channels,
  dashboardUrl = "https://localhost:3000/dashboard/devices",
}: DeviceAlertEmailProps) {
  const isDown = type === "down";
  const accent = isDown ? "#dc2626" : "#16a34a";
  const title = isDown
    ? channels.length === 1
      ? `Device Silent: ${channels[0].channelName}`
      : `${channels.length} Devices Silent`
    : channels.length === 1
      ? `Device Recovered: ${channels[0].channelName}`
      : `${channels.length} Devices Recovered`;

  const previewText = isDown
    ? `${channels.length} device(s) stopped sending logs`
    : `${channels.length} device(s) resumed sending logs`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Header */}
          <Section style={{ ...header, borderBottom: `3px solid ${accent}` }}>
            <Text style={headerBrand}>ECC-SOC 24/7</Text>
            <Text style={{ ...headerTitle, color: accent }}>
              {isDown ? "Device Alert" : "Device Recovered"}
            </Text>
          </Section>

          {/* Summary */}
          <Section style={summarySection}>
            <Text style={summaryText}>{title}</Text>
            <Text style={timestampText}>
              {new Date().toUTCString()}
            </Text>
          </Section>

          {/* Channel cards */}
          {channels.map((ch, i) => (
            <Section key={i} style={card}>
              <Text style={channelName}>{ch.channelName}</Text>
              <table style={detailTable}>
                <tbody>
                  <tr>
                    <td style={labelCell}>Group</td>
                    <td style={valueCell}>{ch.groupName}</td>
                  </tr>
                  {ch.deviceVendor && (
                    <tr>
                      <td style={labelCell}>Vendor</td>
                      <td style={valueCell}>{ch.deviceVendor}</td>
                    </tr>
                  )}
                  {ch.deviceProduct && (
                    <tr>
                      <td style={labelCell}>Product</td>
                      <td style={valueCell}>{ch.deviceProduct}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={labelCell}>Last Event</td>
                    <td style={valueCell}>{ch.lastEventTime}</td>
                  </tr>
                  <tr>
                    <td style={labelCell}>
                      {isDown ? "Silent For" : "Was Silent For"}
                    </td>
                    <td style={{ ...valueCell, color: accent, fontWeight: 600 }}>
                      {ch.silenceDuration}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>
          ))}

          {/* CTA */}
          <Section style={{ textAlign: "center" as const, padding: "24px 0" }}>
            <Link href={dashboardUrl} style={{ ...ctaButton, backgroundColor: accent }}>
              Open Dashboard
            </Link>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              Automated alert from ECC-SOC 24/7 Device Monitor
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// --- Inline styles (emails don't support Tailwind) ---

const body: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  fontFamily:
    "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  backgroundColor: "#12121a",
  borderRadius: "8px",
  overflow: "hidden",
};

const header: React.CSSProperties = {
  padding: "24px 32px 16px",
  backgroundColor: "#0a0a0f",
};

const headerBrand: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "12px",
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  margin: "0 0 4px",
};

const headerTitle: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  margin: 0,
};

const summarySection: React.CSSProperties = {
  padding: "20px 32px",
};

const summaryText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "18px",
  fontWeight: 600,
  margin: "0 0 4px",
};

const timestampText: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  margin: 0,
};

const card: React.CSSProperties = {
  margin: "0 24px 12px",
  padding: "16px 20px",
  backgroundColor: "#1a1a26",
  borderRadius: "6px",
  border: "1px solid rgba(255,255,255,0.1)",
};

const channelName: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  margin: "0 0 12px",
};

const detailTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const labelCell: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  padding: "3px 12px 3px 0",
  verticalAlign: "top",
  width: "90px",
};

const valueCell: React.CSSProperties = {
  color: "#d1d5db",
  fontSize: "13px",
  padding: "3px 0",
  verticalAlign: "top",
};

const ctaButton: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 28px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
  borderRadius: "6px",
};

const divider: React.CSSProperties = {
  borderColor: "rgba(255,255,255,0.1)",
  margin: "0 32px",
};

const footer: React.CSSProperties = {
  padding: "16px 32px 24px",
};

const footerText: React.CSSProperties = {
  color: "#4b5563",
  fontSize: "12px",
  margin: 0,
  textAlign: "center" as const,
};

export default DeviceAlertEmail;
