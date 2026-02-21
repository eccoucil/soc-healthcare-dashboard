// ArcSight ESM DETECT API v1.1.2 - TypeScript interfaces

/** Shared fields across all ArcSight resources */
export interface ResourceBase {
  resourceId: string;
  name: string;
  alias?: string;
  description?: string;
  createdTimestamp?: number;
  modifiedTimestamp?: number;
}

/** ArcSight Client resource (mapped from ArcSight "Customer") */
export interface Client extends ResourceBase {
  address?: string;
  city?: string;
  addressState?: string;
  postalCode?: string;
  country?: string;
  externalID?: string;
}

/** ArcSight Connector resource */
export interface Connector extends ResourceBase {
  operationalStatus?: string;
  owningServer?: string;
  alive?: boolean;
  networks?: string[];
  // Health flags
  disabled?: boolean;
  disabledReason?: string;
  inactive?: boolean;
  inactiveReason?: string;
}

/** Device detail reported by a connector */
export interface DeviceDetail {
  deviceVendor: string;
  deviceProduct: string;
  deviceVersion?: string;
}

/** Map of connector IDs to their device details */
export type ConnectorDeviceMap = Record<string, DeviceDetail[]>;

/** Connector with its associated devices (joined for UI display) */
export interface ConnectorWithDevices extends Connector {
  devices: DeviceDetail[];
}

/** Aggregated connector health */
export interface ConnectorHealth {
  live: string[];
  dead: string[];
  total: number;
}

/** Per-connector health detail with live/dead classification */
export interface ConnectorHealthDetail {
  resourceId: string;
  name: string;
  status: "live" | "dead";
  operationalStatus?: string;
  alive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  inactive?: boolean;
  inactiveReason?: string;
  owningServer?: string;
}

/** Enriched health response: full details + summary counts */
export interface ConnectorHealthEnriched {
  connectors: ConnectorHealthDetail[];
  summary: { live: number; dead: number; total: number };
}

/** Request body for linking/unlinking connectors to a client */
export interface LinkConnectorsRequest {
  connectorIds: string[];
}

// --- Active Channel types (Phoenix GWT-RPC) ---

/** Channel subtype: Base, Group, View, Other */
export type ChannelSubtype = "B" | "G" | "V" | "O";

/** A single filter condition on a channel */
export interface ChannelFilterCondition {
  field: string;
  displayName: string;
  operator: string;
  value: string;
}

/** ArcSight Active Channel resource */
export interface Channel extends ResourceBase {
  uri: string;
  channelType: ChannelSubtype;
  filters: ChannelFilterCondition[];
  timeRange?: { start: string; end: string };
  parentGroupId: string;
  creatorName?: string;
}

/** Paginated channel result from GWT-RPC */
export interface ChannelPageResult {
  channels: Channel[];
  totalCount: number;
}
