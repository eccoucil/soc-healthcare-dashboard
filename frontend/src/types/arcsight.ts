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

/** ArcSight Customer resource */
export interface Customer extends ResourceBase {
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

/** Request body for linking/unlinking connectors to a customer */
export interface LinkConnectorsRequest {
  connectorIds: string[];
}
