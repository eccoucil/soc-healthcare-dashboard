"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  Activity,
  ChevronRight,
  FolderOpen,
  MonitorSmartphone,
  RefreshCw,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  useClientTree,
  useChannelScan,
  useEventDetailsForChannel,
} from "@/hooks/use-arcsight";

// --- Types ---

interface DeviceEntry {
  displayName: string;
  resourceId: string;
  subType: string;
  lastUpdateTime: string | null;
  groupName: string;
}

interface DeviceGroup {
  name: string;
  devices: DeviceEntry[];
}

interface ScanInfo {
  hasEvents: boolean;
  eventCount: number;
  latestManagerReceiptTime: number | null;
  firstEventId?: number;
  eventFields?: Record<string, string | number | null>;
}

// --- Helpers ---

type HealthStatus = "healthy" | "unhealthy";
type HealthSource = "scan" | "estimated";

interface HealthResult {
  status: HealthStatus;
  source: HealthSource;
}

const HEALTH_THRESHOLD_MS = 10 * 60_000; // 10 minutes

function getDeviceHealth(
  lastUpdateTime: string | null,
  scanInfo?: ScanInfo,
  scanInProgress?: boolean
): HealthResult {
  // Primary: scan results with managerReceiptTime (actual event flow)
  if (scanInfo !== undefined) {
    if (scanInfo.latestManagerReceiptTime !== null) {
      const age = Date.now() - scanInfo.latestManagerReceiptTime;
      return {
        status: age <= HEALTH_THRESHOLD_MS ? "healthy" : "unhealthy",
        source: "scan",
      };
    }
    // Scan found events but couldn't extract a timestamp — assume active
    if (scanInfo.hasEvents) {
      return { status: "healthy", source: "scan" };
    }
    // Inconclusive: scan got 0 events and no MRT. The subscription may not
    // have warmed up in time (cold-start issue for slow channels). Don't
    // claim "confirmed inactive" — fall through to tree metadata estimate.
  }
  // While scan is in-flight and no cached data exists yet, show neutral
  // "estimated healthy" instead of stale metadata check that would mark all red
  if (scanInProgress) {
    return { status: "healthy", source: "estimated" };
  }
  // Fallback: metadata timestamp (pre-scan estimate)
  if (!lastUpdateTime) return { status: "unhealthy", source: "estimated" };
  const age = Date.now() - new Date(lastUpdateTime).getTime();
  return {
    status: isNaN(age) || age > HEALTH_THRESHOLD_MS ? "unhealthy" : "healthy",
    source: "estimated",
  };
}

// --- Helpers ---

function formatTimestamp(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const ms = typeof value === "number" ? value : Number(value);
  if (!isNaN(ms) && ms > 0) return new Date(ms).toLocaleString();
  const parsed = new Date(String(value));
  return isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2.5 border-b border-white/5 last:border-b-0">
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 mb-0.5">
        {label}
      </p>
      <p className="text-sm text-gray-200 break-words">{value}</p>
    </div>
  );
}

// --- Device Detail Panel ---

function DeviceDetailPanel({
  device,
  clientName,
  onClose,
  scanInfo,
}: {
  device: DeviceEntry | null;
  clientName: string | null;
  onClose: () => void;
  scanInfo?: ScanInfo;
}) {
  const { channelData, eventDetails, isLoading, isLoadingDetails, error, detailsError } =
    useEventDetailsForChannel(device?.resourceId ?? null, scanInfo?.firstEventId);

  const loading = isLoading || isLoadingDetails;
  const isFilterOnly = channelData?.isFilterExpressionOnly ?? false;
  
  // Field resolution: eventDetails → channelData → fallback
  const ev = eventDetails?.events?.[0];
  const ch = channelData?.events?.[0];

  const hasScanData = scanInfo?.eventFields != null && Object.keys(scanInfo.eventFields).length > 0;
  const hasInferredData = (ev != null || ch != null) && isFilterOnly && !hasScanData;
  const hasEventData = ev != null || ch != null || hasScanData;

  // Debug: log data sources available for field resolution
  if (device && !loading) {
    console.log(
      `[device-panel] Data sources: ev=${ev ? Object.keys(ev.fields || {}).length + " fields" : "null"}, ` +
      `ch=${ch ? Object.keys(ch.fields || {}).length + " fields" : "null"}, ` +
      `scanInfo=${scanInfo?.eventFields ? Object.keys(scanInfo.eventFields).length + " fields" : "null"}`
    );
  }

  function field(key: string | string[]): string {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      const value = ev?.fields?.[k]?.value ?? ch?.fields?.[k] ?? scanInfo?.eventFields?.[k] ?? null;
      if (value !== null && value !== undefined && value !== "") {
        return String(value);
      }
    }
    return "—";
  }

  // Last Log Received — prefer scan's server-decoded latestManagerReceiptTime,
  // then check live channel data, then metadata fallback.
  const { lastLog, lastLogSource } = (() => {
    // Priority 1: Scan result — most reliable because the server-side
    // extractLatestManagerReceiptTime() handles all GWT encoding formats
    // (number, numeric string, base-64 Long).
    if (scanInfo?.latestManagerReceiptTime != null)
      return { lastLog: formatTimestamp(scanInfo.latestManagerReceiptTime), lastLogSource: "scan" as const };

    // Priority 2: Live channel/event data (may contain GWT-encoded values
    // that toMs can't parse, so only use when scan data is unavailable)
    let latestMs = 0;

    const toMs = (v: string | number | null | undefined) => {
      // Explicit null/undefined check
      if (v === null || v === undefined || v === "null" || v === "undefined") return 0;

      if (typeof v === "number") return v > 0 ? v : 0;

      if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed === "" || trimmed === "null" || trimmed === "undefined") return 0;
        const n = Number(trimmed);
        return isNaN(n) || n <= 0 ? 0 : n;
      }

      return 0;
    };

    channelData?.events.forEach(e => {
      const ts = toMs(e.fields["managerReceiptTime"]);
      if (ts > latestMs) latestMs = ts;
    });

    eventDetails?.events.forEach(e => {
      const ts = toMs(e.fields["managerReceiptTime"]?.value);
      if (ts > latestMs) latestMs = ts;
    });

    if (latestMs > 0) return { lastLog: formatTimestamp(latestMs), lastLogSource: "live" as const };

    // No reliable timestamp available
    return { lastLog: "—", lastLogSource: "none" as const };
  })();

  // Debug: log all intermediate values for the selected device
  if (device) {
    console.log(`[device-panel] "${device.displayName}" lastLog sources:`, {
      scanMrt: scanInfo?.latestManagerReceiptTime ?? "null",
      scanHasEvents: scanInfo?.hasEvents,
      scanEventCount: scanInfo?.eventCount,
      liveEventCount: channelData?.events?.length ?? 0,
      liveFirstMrt: channelData?.events?.[0]?.fields?.["managerReceiptTime"] ?? "null",
      detailMrt: eventDetails?.events?.[0]?.fields?.["managerReceiptTime"]?.value ?? "null",
      // Removed: metadataLastUpdate (no longer used)
      selectedSource: lastLogSource,
      displayedValue: lastLog,
      reason: lastLogSource === "none" ? "No scan/live data available" : "Got timestamp"
    });
  }

  // Channel subscription cold-start: data returned but 0 events yet
  const channelWarming = !isLoading && channelData != null && channelData.events.length === 0 && !error;

  return (
    <Sheet open={device !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="bg-[#0a0a0f] border-white/10 w-[400px] sm:max-w-[400px] p-0 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#12121a] shrink-0">
          <div className="min-w-0">
            <SheetTitle className="text-sm font-semibold text-white truncate">
              {device?.displayName ?? "Device"}
            </SheetTitle>
            <SheetDescription className="text-xs text-gray-500 mt-0.5 truncate">
              {device?.groupName ?? ""}
            </SheetDescription>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 ml-3 p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 relative overflow-y-auto">
          {/* Loading Modal Overlay */}
          {loading && !hasEventData && !channelWarming && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-[#0a0a0f]/95 backdrop-blur-sm">
              <div className="bg-[#12121a] border border-white/10 rounded-xl p-8 shadow-2xl flex flex-col items-center max-w-[280px] w-full animate-in fade-in zoom-in duration-300">
                <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-6" />
                <p className="text-sm text-gray-200 font-medium text-center leading-relaxed">
                  Fetching the information from the event log
                </p>
                <p className="text-[11px] text-gray-500 mt-2 text-center">
                  Connecting to ArcSight ESM server...
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="mt-6 text-gray-500 hover:text-white"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="py-2">
            {(error || detailsError) && (
              <div className="mx-4 my-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {error && <p>{error}</p>}
                {detailsError && !error && (
                   <p className="text-[10px] opacity-70 mt-1">
                     Full details unavailable. Showing live stream fields only.
                   </p>
                )}
              </div>
            )}

            {hasInferredData && (
              <div className="mx-3 my-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-center gap-2">
                <Activity className="w-4 h-4 shrink-0 text-amber-500" />
                <p>Device is currently inactive. Showing inferred configuration data.</p>
              </div>
            )}

            {channelWarming && !hasEventData && (
            <div className="px-4 py-8 text-center">
              <Loader2 className="w-8 h-8 text-gray-500 mx-auto mb-2 animate-spin" />
              <p className="text-sm text-gray-400">Channel loading&hellip;</p>
              <p className="text-xs text-gray-600 mt-1">
                Subscription warming up — events will appear shortly
              </p>
            </div>
          )}

          {!loading && !channelWarming && !hasEventData && !error && (
            <div className="px-4 py-8 text-center">
              <MonitorSmartphone className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No event data available</p>
              <p className="text-xs text-gray-600 mt-1">
                This channel has no recent events to display
              </p>
            </div>
          )}

          {hasEventData && (
            <div className="bg-[#12121a] rounded-lg mx-3 my-2 border border-white/5">
              <MetadataRow label="Customer Name" value={field("customerName") !== "Waiting for events..." && field("customerName") !== "—" ? field("customerName") : (clientName ?? "—")} />
              <MetadataRow
                label="Active Channel Name"
                value={device?.displayName ?? "—"}
              />
              <MetadataRow
                label="Device Vendor"
                value={field(["deviceVendor", "agentType"])}
              />
              <MetadataRow
                label="Device Product"
                value={field(["deviceProduct", "name", "message"])}
              />
              <MetadataRow
                label={
                  lastLogSource === "none"
                    ? "LAST LOG RECEIVED (NO DATA)"
                    : lastLogSource === "live"
                    ? "LAST LOG RECEIVED (LIVE)"
                    : "LAST LOG RECEIVED"
                }
                value={lastLog}
              />

              {/* Scan status indicators */}
              {!scanInfo && !hasEventData && (
                <div className="text-xs text-blue-500/70 mt-2 px-3 flex items-center gap-2">
                  <RefreshCw className="h-3 w-3" />
                  <span>Waiting for scan data... Try the Refresh Scan button.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SheetContent>
  </Sheet>
  );
}

// --- Device Circle ---

function DeviceCircle({
  device,
  scanInfo,
  scanInProgress,
  onClick,
}: {
  device: DeviceEntry;
  scanInfo?: ScanInfo;
  scanInProgress?: boolean;
  onClick?: () => void;
}) {
  const { status: health, source } = getDeviceHealth(device.lastUpdateTime, scanInfo, scanInProgress);
  const isEstimated = source === "estimated";

  return (
    <div className="flex flex-col items-center gap-2 group">
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick?.();
            }
          }}
          className="w-20 h-20 rounded-full bg-[#1a1a28] ring-2 ring-white/10 flex items-center justify-center cursor-pointer group-hover:ring-white/30 group-hover:bg-[#1e1e30] focus-visible:ring-white/50 focus-visible:outline-none transition-all"
        >
          <MonitorSmartphone className="w-7 h-7 text-gray-400" />
        </div>
        {/* Activity dot */}
        <div
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-[#0a0a0f] transition-opacity ${
            health === "healthy" ? "bg-green-500" : "bg-red-500"
          } ${isEstimated ? "opacity-50" : ""}`}
          title={
            health === "healthy"
              ? `Active (${isEstimated ? "estimated" : "confirmed"})`
              : `Inactive (${isEstimated ? "estimated" : "confirmed"})`
          }
        />
      </div>
      <span
        className={`text-[10px] font-medium transition-opacity ${
          health === "healthy" ? "text-green-400" : "text-red-400"
        } ${isEstimated ? "opacity-60" : ""}`}
      >
        {health === "healthy" ? "Active" : "Inactive"}
        {isEstimated ? "*" : ""}
      </span>
      <span className="text-xs text-gray-300 max-w-[100px] text-center line-clamp-2">
        {device.displayName}
      </span>
      <span className="text-[10px] text-gray-500 max-w-[100px] text-center truncate">
        {device.groupName}
      </span>
    </div>
  );
}

// --- Device Group Section (collapsible) ---

function DeviceGroupSection({
  group,
  scanMap,
  scanInProgress,
  onSelectDevice,
}: {
  group: DeviceGroup;
  scanMap?: Map<string, ScanInfo>;
  scanInProgress?: boolean;
  onSelectDevice?: (d: DeviceEntry) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const active = group.devices.filter(
    (d) => getDeviceHealth(d.lastUpdateTime, scanMap?.get(d.resourceId), scanInProgress).status === "healthy"
  ).length;
  const inactive = group.devices.length - active;

  return (
    <div className="rounded-lg border border-white/5 bg-[#0e0e18]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={`w-3.5 h-3.5 text-gray-500 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <span className="text-sm text-gray-300">{group.name}</span>
          <span className="text-[11px] text-gray-600">
            {group.devices.length} device
            {group.devices.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-[11px] text-gray-500">{active}</span>
          {inactive > 0 && (
            <>
              <span className="w-2 h-2 rounded-full bg-red-500 ml-1" />
              <span className="text-[11px] text-gray-500">{inactive}</span>
            </>
          )}
        </div>
      </button>
      {expanded && group.devices.length > 0 && (
        <div className="px-4 pb-3 pt-1">
          <div className="flex flex-wrap gap-5">
            {group.devices.map((d) => (
              <DeviceCircle
                key={d.resourceId}
                device={d}
                scanInfo={scanMap?.get(d.resourceId)}
                scanInProgress={scanInProgress}
                onClick={() => onSelectDevice?.(d)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Page ---

type ActivityFilter = "all" | "active" | "inactive";

export default function DevicesPage() {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [mounted, setMounted] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DeviceEntry | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration guard for Radix useId()
  useEffect(() => setMounted(true), []);

  const { data: tree, isLoading: treeLoading } = useClientTree("FORTRESS");

  // Auto-poll scan every 10 minutes (aligned with server-side 600s cache TTL)
  const { data: scanData, isLoading: scanLoading, freshRescan: rescan } = useChannelScan(true, { refetchInterval: 600_000 });

  // Build scan lookup map
  const scanMap = useMemo(() => {
    if (!scanData?.results) return new Map<string, ScanInfo>();
    const map = new Map<string, ScanInfo>();
    for (const r of scanData.results) {
      map.set(r.channelId, {
        hasEvents: r.hasEvents,
        eventCount: r.eventCount,
        latestManagerReceiptTime: r.latestManagerReceiptTime ?? null,
        firstEventId: r.eventIds?.[0],
        eventFields: r.eventFields,
      });
    }

    // Diagnostic: log scan map state
    if (scanData?.results) {
      console.log(`[devices-page] scanMap built with ${map.size} entries from ${scanData.results.length} scan results`);
      if (map.size > 0) {
        const sampleKeys = Array.from(map.keys()).slice(0, 3);
        console.log(`[devices-page] Sample scanMap keys:`, sampleKeys);
      }
    }

    return map;
  }, [scanData]);

  // Diagnostic: Log device selection and scanMap lookup
  useEffect(() => {
    if (selectedDevice && scanMap.size > 0) {
      const scanInfo = scanMap.get(selectedDevice.resourceId);
      console.log(`[devices-page] Selected device "${selectedDevice.displayName}" (${selectedDevice.resourceId}): scanInfo=${scanInfo ? 'FOUND' : 'NOT FOUND'}`);
      if (!scanInfo && scanMap.size > 0) {
        console.warn(`[devices-page] Device resourceId not found in scanMap. Device ID: ${selectedDevice.resourceId.slice(0, 20)}...`);
        console.warn(`[devices-page] scanMap has ${scanMap.size} entries but selected device ID doesn't match any`);
      }
    }
  }, [selectedDevice, scanMap]);

  // Extract client-level nodes from tree categories (2 levels deep):
  // FORTRESS → categories (Device Monitoring, Incident Monitoring) → clients (SAMEE, TEST)
  const treeClients = useMemo(() => {
    if (!tree) return [];
    return tree.children.flatMap((category) => category.children);
  }, [tree]);

  // Find the selected client node from the tree
  const selectedClient = useMemo(() => {
    if (!selectedName) return null;
    return treeClients.find((c) => c.name === selectedName) ?? null;
  }, [treeClients, selectedName]);

  // Collect device groups (sub-groups like Network Devices, Servers, Oracle)
  // and direct channels (channels at the client level, e.g. Sophos Central)
  const deviceGroups = useMemo((): DeviceGroup[] => {
    if (!selectedClient) return [];
    const groups: DeviceGroup[] = [];

    // Sub-groups become device category sections
    for (const child of selectedClient.children) {
      if (child.channels.length > 0) {
        groups.push({
          name: child.name,
          devices: child.channels.map((ch) => ({
            displayName: ch.displayName,
            resourceId: ch.resourceId,
            subType: ch.subType,
            lastUpdateTime: ch.lastUpdateTime,
            groupName: child.name,
          })),
        });
      }
    }

    // Direct channels on the client itself (not in a sub-group)
    if (selectedClient.channels.length > 0) {
      groups.push({
        name: "General",
        devices: selectedClient.channels.map((ch) => ({
          displayName: ch.displayName,
          resourceId: ch.resourceId,
          subType: ch.subType,
          lastUpdateTime: ch.lastUpdateTime,
          groupName: "General",
        })),
      });
    }

    return groups;
  }, [selectedClient]);

  // Flatten all devices for counting
  const allDevices = useMemo(() => {
    return deviceGroups.flatMap((g) => g.devices);
  }, [deviceGroups]);

  // While scan is in-flight and no cached data exists, treat devices as
  // "estimated healthy" instead of falling through to stale metadata
  const scanInProgress = scanLoading && !scanData;

  // Filtered groups based on activity filter
  const filteredGroups = useMemo(() => {
    if (filter === "all") return deviceGroups;
    return deviceGroups
      .map((g) => ({
        ...g,
        devices: g.devices.filter((d) => {
          const { status } = getDeviceHealth(d.lastUpdateTime, scanMap.get(d.resourceId), scanInProgress);
          return filter === "active" ? status === "healthy" : status === "unhealthy";
        }),
      }))
      .filter((g) => g.devices.length > 0);
  }, [deviceGroups, filter, scanMap, scanInProgress]);

  const { active: activeCount, inactive: inactiveCount } = useMemo(() => {
    let active = 0;
    for (const d of allDevices) {
      if (getDeviceHealth(d.lastUpdateTime, scanMap.get(d.resourceId), scanInProgress).status === "healthy") active++;
    }
    return { active, inactive: allDevices.length - active };
  }, [allDevices, scanMap, scanInProgress]);

  const totalDevices = allDevices.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 h-16 px-6 border-b border-white/10 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Devices</h1>
          <p className="text-xs text-gray-500">
            Monitored devices from the channel tree for each client
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scanLoading && (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-xs">
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
              Scanning...
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={rescan}
            disabled={scanLoading}
            className="text-gray-400 hover:text-white gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${scanLoading ? "animate-spin" : ""}`} />
            Rescan
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Client selector + filter controls */}
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm text-gray-400 shrink-0">Client</label>
          <div className="flex items-center gap-3">
            {mounted ? (
              <Select
                value={selectedName ?? ""}
                onValueChange={(v) => setSelectedName(v || null)}
              >
                <SelectTrigger className="w-72 bg-[#12121a] border-white/10 text-white">
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent className="bg-[#12121a] border-white/10 text-white">
                  {treeLoading ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      Loading clients...
                    </div>
                  ) : (
                    treeClients.map((client) => (
                      <SelectItem key={client.resourceId} value={client.name}>
                        {client.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 w-72 rounded-md bg-[#12121a] border border-white/10" />
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => rescan()}
              disabled={scanLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${scanLoading ? 'animate-spin' : ''}`} />
              {scanLoading ? 'Scanning...' : 'Refresh Scan'}
            </Button>
          </div>

          {selectedClient && (
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <span className="flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5" />
                {deviceGroups.length} group{deviceGroups.length !== 1 && "s"}
              </span>
              <span className="flex items-center gap-1.5">
                <MonitorSmartphone className="w-3.5 h-3.5" />
                {totalDevices} device{totalDevices !== 1 && "s"}
              </span>
            </div>
          )}

          {/* Activity filter — shown when client is selected */}
          {selectedClient && (
            <div className="flex items-center gap-1 p-1 bg-[#12121a] rounded-lg border border-white/10 ml-auto">
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  filter === "all"
                    ? "bg-white/10 text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter("active")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  filter === "active"
                    ? "bg-green-500/20 text-green-400"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Active ({activeCount})
              </button>
              <button
                onClick={() => setFilter("inactive")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  filter === "inactive"
                    ? "bg-red-500/20 text-red-400"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Inactive ({inactiveCount})
              </button>
            </div>
          )}
        </div>

        {/* Empty state: no client selected */}
        {!selectedName && !treeLoading && (
          <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
            <Activity className="w-12 h-12 text-gray-600 mb-4" />
            <p className="text-gray-400 text-lg">
              Select a client to view its devices
            </p>
            <p className="text-gray-600 text-sm mt-1">
              Devices are discovered from the Phoenix channel tree
            </p>
          </div>
        )}

        {/* Loading skeletons */}
        {treeLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-white/5 bg-[#0e0e18] p-4"
              >
                <div className="flex items-center gap-2 mb-4">
                  <Skeleton className="h-4 w-4 bg-white/10" />
                  <Skeleton className="h-4 w-32 bg-white/10" />
                </div>
                <div className="flex gap-5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className="flex flex-col items-center gap-2">
                      <Skeleton className="w-20 h-20 rounded-full bg-white/10" />
                      <Skeleton className="h-3 w-16 bg-white/10" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Device group sections */}
        {selectedClient && !treeLoading && (
          <div className="space-y-3">
            {filteredGroups.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                {filter !== "all"
                  ? `No ${filter} devices \u2014 try switching to "All"`
                  : "No devices found for this client"}
              </div>
            ) : (
              filteredGroups.map((group) => (
                <DeviceGroupSection
                  key={group.name}
                  group={group}
                  scanMap={scanMap}
                  scanInProgress={scanInProgress}
                  onSelectDevice={setSelectedDevice}
                />
              ))
            )}
          </div>
        )}

        {/* Footer status */}
        <p className="text-xs text-gray-600 text-center">
          Client tree refreshes every 5 min &middot; Event scan every 10 min
          {scanLoading && " (scanning...)"}
          {scanData?.scannedAt && !scanLoading && (
            <> &middot; Last scan: {new Date(scanData.scannedAt).toLocaleTimeString()}</>
          )}
          {!scanData && !scanLoading && " &middot; * = estimated (scan pending)"}
        </p>
      </main>

      <DeviceDetailPanel
        device={selectedDevice}
        clientName={selectedName}
        onClose={() => setSelectedDevice(null)}
        scanInfo={selectedDevice ? scanMap.get(selectedDevice.resourceId) : undefined}
      />
    </div>
  );
}
