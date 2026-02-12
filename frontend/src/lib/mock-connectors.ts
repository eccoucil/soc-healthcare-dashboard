import type {
  Connector,
  ConnectorWithDevices,
  ConnectorHealth,
} from "@/types/arcsight";

/** Mock connectors with devices — used as fallback when ArcSight API is unavailable */
export const mockConnectorsWithDevices: ConnectorWithDevices[] = [
  {
    resourceId: "conn-001",
    name: "Epic EHR Syslog Collector",
    alias: "epic-syslog",
    operationalStatus: "RUNNING",
    owningServer: "esm-mgr-01.hospital.local",
    alive: true,
    networks: ["10.1.10.0/24"],
    disabled: false,
    inactive: false,
    createdTimestamp: 1704067200000,
    modifiedTimestamp: 1717545600000,
    devices: [
      {
        deviceVendor: "Epic Systems",
        deviceProduct: "EHR Audit Logger",
        deviceVersion: "2024.1",
      },
      {
        deviceVendor: "Epic Systems",
        deviceProduct: "MyChart Access Gateway",
        deviceVersion: "11.3",
      },
    ],
  },
  {
    resourceId: "conn-002",
    name: "Palo Alto Firewall SmartConnector",
    alias: "pa-fw-sc",
    operationalStatus: "RUNNING",
    owningServer: "esm-mgr-01.hospital.local",
    alive: true,
    networks: ["10.1.1.0/24", "10.1.2.0/24"],
    disabled: false,
    inactive: false,
    createdTimestamp: 1706832000000,
    modifiedTimestamp: 1717545600000,
    devices: [
      {
        deviceVendor: "Palo Alto Networks",
        deviceProduct: "PAN-OS",
        deviceVersion: "11.1.2",
      },
    ],
  },
  {
    resourceId: "conn-003",
    name: "CrowdStrike Falcon Connector",
    alias: "cs-falcon",
    operationalStatus: "RUNNING",
    owningServer: "esm-mgr-02.hospital.local",
    alive: true,
    networks: ["10.1.20.0/24"],
    disabled: false,
    inactive: false,
    createdTimestamp: 1709596800000,
    modifiedTimestamp: 1714867200000,
    devices: [
      {
        deviceVendor: "CrowdStrike",
        deviceProduct: "Falcon Endpoint Protection",
        deviceVersion: "7.06",
      },
      {
        deviceVendor: "CrowdStrike",
        deviceProduct: "Falcon Identity Threat Detection",
      },
    ],
  },
  {
    resourceId: "conn-004",
    name: "Windows AD Audit Collector",
    operationalStatus: "STOPPED",
    owningServer: "esm-mgr-02.hospital.local",
    alive: false,
    networks: ["10.1.5.0/24"],
    disabled: false,
    inactive: true,
    inactiveReason: "Scheduled maintenance window",
    createdTimestamp: 1712275200000,
    modifiedTimestamp: 1715472000000,
    devices: [
      {
        deviceVendor: "Microsoft",
        deviceProduct: "Windows Security Event Log",
        deviceVersion: "10.0",
      },
    ],
  },
  {
    resourceId: "conn-005",
    name: "Cisco ISE NAC Connector",
    alias: "ise-nac",
    operationalStatus: "PAUSED",
    owningServer: "esm-mgr-01.hospital.local",
    alive: true,
    networks: ["10.1.30.0/24"],
    disabled: true,
    disabledReason: "Pending firmware upgrade",
    inactive: false,
    createdTimestamp: 1714953600000,
    modifiedTimestamp: 1717545600000,
    devices: [
      {
        deviceVendor: "Cisco",
        deviceProduct: "Identity Services Engine",
        deviceVersion: "3.3",
      },
    ],
  },
  {
    resourceId: "conn-006",
    name: "Imprivata OneSign Connector",
    operationalStatus: "RUNNING",
    owningServer: "esm-mgr-02.hospital.local",
    alive: true,
    disabled: false,
    inactive: false,
    createdTimestamp: 1715558400000,
    modifiedTimestamp: 1717545600000,
    // No devices yet — newly deployed connector
    devices: [],
  },
  {
    resourceId: "conn-007",
    name: "Medigate Clinical IoT Sensor",
    alias: "medigate-iot",
    operationalStatus: "UNKNOWN",
    alive: false,
    disabled: true,
    disabledReason: "License expired",
    inactive: true,
    inactiveReason: "No heartbeat for 72h",
    createdTimestamp: 1716163200000,
    modifiedTimestamp: 1716768000000,
    devices: [
      {
        deviceVendor: "Medigate (Claroty)",
        deviceProduct: "Clinical Device Security",
      },
    ],
  },
];

/** Flat connector list (without devices) for the "Link Connector" sheet */
export const mockAllConnectors: Connector[] =
  mockConnectorsWithDevices.map(({ devices: _, ...rest }) => rest);

/** Aggregated health derived from mock data */
export const mockConnectorHealth: ConnectorHealth = {
  live: mockConnectorsWithDevices
    .filter((c) => c.alive)
    .map((c) => c.resourceId),
  dead: mockConnectorsWithDevices
    .filter((c) => !c.alive)
    .map((c) => c.resourceId),
  total: mockConnectorsWithDevices.length,
};
