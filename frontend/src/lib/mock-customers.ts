import type { Customer } from "@/types/arcsight";

/** Dummy healthcare-themed customers used as fallback when ArcSight API is unavailable */
export const mockCustomers: Customer[] = [
  {
    resourceId: "cust-001",
    name: "Memorial General Hospital",
    alias: "MGH",
    city: "Boston",
    addressState: "MA",
    country: "US",
    externalID: "EXT-10042",
    createdTimestamp: 1704067200000,
    modifiedTimestamp: 1706745600000,
  },
  {
    resourceId: "cust-002",
    name: "Lakeside Family Clinic",
    alias: "LFC",
    city: "Chicago",
    addressState: "IL",
    country: "US",
    externalID: "EXT-10078",
    createdTimestamp: 1706832000000,
    modifiedTimestamp: 1709510400000,
  },
  {
    resourceId: "cust-003",
    name: "Pacific Northwest Diagnostics Lab",
    city: "Seattle",
    addressState: "WA",
    country: "US",
    externalID: "EXT-10103",
    createdTimestamp: 1709596800000,
    modifiedTimestamp: 1712188800000,
  },
  {
    resourceId: "cust-004",
    name: "Sunrise Pharmacy Network",
    alias: "SPN",
    city: "Miami",
    addressState: "FL",
    country: "US",
    externalID: "EXT-10150",
    createdTimestamp: 1712275200000,
    modifiedTimestamp: 1714867200000,
  },
  {
    resourceId: "cust-005",
    name: "CityHealth Urgent Care",
    alias: "CHUC",
    // No location — mirrors real-world incomplete data
    externalID: "EXT-10201",
    createdTimestamp: 1714953600000,
    modifiedTimestamp: 1717545600000,
  },
];
