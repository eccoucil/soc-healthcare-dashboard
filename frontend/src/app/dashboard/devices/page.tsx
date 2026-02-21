"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  Activity,
  ChevronRight,
  FolderOpen,
  MonitorSmartphone,
  Radio,
  X,
  Loader2,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientTree, useChannelEventsOnDemand } from "@/hooks/use-arcsight";

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

// --- Helpers ---

function isDeviceActive(lastUpdate: string | null): boolean {
  if (!lastUpdate) return false;
  const age = Date.now() - new Date(lastUpdate).getTime();
  return !isNaN(age) && age <= 7 * 24 * 60 * 60 * 1000; // 7 days
}

// Column ordering: preferred columns first (matching ArcSight's event viewer), then remaining alphabetically
const PREFERRED_COLUMNS = [
  "managerReceiptTime",
  "name",
  "attackerAddress",
  "targetAddress",
  "priority",
  "deviceVendor",
  "deviceProduct",
];

function orderFields(fieldNames: string[]): string[] {
  return [
    ...PREFERRED_COLUMNS.filter((f) => fieldNames.includes(f)),
    ...fieldNames.filter((f) => !PREFERRED_COLUMNS.includes(f)).sort(),
  ];
}

function formatFieldName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCellValue(value: string | number | null): string {
  if (value == null) return "\u2014";
  if (typeof value === "number" && value > 1_000_000_000_000)
    return new Date(value).toLocaleString();
  return String(value);
}

// Format epoch ms or ISO string → "21 Feb 2026, Sat 11:52"
function formatEventTimestamp(val: string | number | null): string {
  if (val == null) return "\u2014";
  const d = typeof val === "number" ? new Date(val) : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ArcSight priority is numeric (1-10) — map to severity colors
function getPriorityColor(val: string | number | null): string {
  const n = typeof val === "number" ? val : parseInt(String(val));
  if (isNaN(n)) return "text-gray-400";
  if (n >= 8) return "text-red-400"; // Critical
  if (n >= 6) return "text-orange-400"; // High
  if (n >= 4) return "text-yellow-400"; // Medium
  return "text-blue-400"; // Low
}

// --- Device Circle ---

function DeviceCircle({
  device,
  onClick,
}: {
  device: DeviceEntry;
  onClick: () => void;
}) {
  const active = isDeviceActive(device.lastUpdateTime);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative group">
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }}
          className="w-20 h-20 rounded-full bg-[#1a1a28] ring-2 ring-white/10 flex items-center justify-center cursor-pointer transition-all group-hover:ring-white/30 group-hover:bg-[#1e1e30] focus-visible:outline-none focus-visible:ring-white/50"
        >
          <MonitorSmartphone className="w-7 h-7 text-gray-400" />
        </div>
        {/* Activity dot */}
        <div
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-[#0a0a0f] ${
            active ? "bg-green-500" : "bg-red-500"
          }`}
          title={active ? "Active (updated within 7 days)" : "Inactive"}
        />
      </div>
      <span
        className={`text-[10px] font-medium ${
          active ? "text-green-400" : "text-red-400"
        }`}
      >
        {active ? "Active" : "Inactive"}
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
  onSelectDevice,
}: {
  group: DeviceGroup;
  onSelectDevice: (d: DeviceEntry) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const active = group.devices.filter((d) =>
    isDeviceActive(d.lastUpdateTime)
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
                onClick={() => onSelectDevice(d)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Device Event Sheet ---

function renderCellValue(
  fieldName: string,
  value: string | number | null
): React.ReactNode {
  if (fieldName === "managerReceiptTime") return formatEventTimestamp(value);
  if (fieldName === "priority") {
    return (
      <span className={`font-medium ${getPriorityColor(value)}`}>
        {value == null ? "\u2014" : String(value)}
      </span>
    );
  }
  return formatCellValue(value);
}

function DeviceEventSheet({
  device,
  clientName,
  onClose,
}: {
  device: DeviceEntry | null;
  clientName: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useChannelEventsOnDemand(
    device?.resourceId ?? null
  );

  const orderedFields = useMemo(
    () => (data ? orderFields(data.fieldNames) : []),
    [data]
  );

  return (
    <Sheet open={!!device} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[900px] sm:max-w-[900px] bg-[#0a0a0f] border-white/10 flex flex-col overflow-hidden p-0"
      >
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MonitorSmartphone className="w-5 h-5 text-gray-400" />
              <SheetTitle className="text-white text-lg font-semibold">
                {device?.displayName ?? "Device"}
              </SheetTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-gray-400 hover:text-white -mr-2"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <SheetDescription className="sr-only">
            Live events from device {device?.displayName}
          </SheetDescription>

          {device && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Badge
                variant="outline"
                className="bg-purple-500/15 text-purple-400 border-purple-500/20 text-xs"
              >
                {device.groupName}
              </Badge>
              {device.subType && (
                <Badge
                  variant="outline"
                  className="text-xs text-gray-400 border-white/10"
                >
                  {device.subType}
                </Badge>
              )}

              {/* Status indicator */}
              {isLoading ? (
                <Badge
                  variant="outline"
                  className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 text-xs"
                >
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Loading...
                </Badge>
              ) : data ? (
                <Badge
                  variant="outline"
                  className="bg-green-500/10 text-green-400 border-green-500/20 text-xs"
                >
                  <Radio className="w-3 h-3 mr-1" />
                  Channel Loaded
                </Badge>
              ) : null}

              {data && (
                <Badge
                  variant="outline"
                  className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-xs ml-auto"
                >
                  Total Events = {data.totalCount}
                </Badge>
              )}
            </div>
          )}

          {data && (
            <p className="text-[11px] text-gray-600 mt-2">
              Auto-refreshes every 10 seconds
            </p>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto flex flex-col px-6 py-4 min-h-0">
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 mb-4 shrink-0">
              <Activity className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Metadata detail card — always visible */}
          {device && (
            <div className="shrink-0 rounded-lg border border-white/10 bg-[#12121a] mb-4">
              <div className="grid grid-cols-2 gap-px bg-white/5">
                {(() => {
                  const firstEvent = data?.events?.[0];
                  const field = (key: string) => {
                    const v = firstEvent?.fields?.[key];
                    return v != null ? String(v) : "\u2014";
                  };
                  const rows = [
                    ["Client Name", clientName ?? "\u2014"],
                    ["Active Channel Name", device.displayName],
                    ["Agent Name", field("agentName")],
                    ["Agent Address", field("agentAddress")],
                    ["Agent Host Name", field("agentHostName")],
                    ["Device Vendor", field("deviceVendor")],
                    ["Device Product", field("deviceProduct")],
                    [
                      "Last Log Received",
                      device.lastUpdateTime
                        ? formatEventTimestamp(device.lastUpdateTime)
                        : "\u2014",
                    ],
                  ];
                  return rows.map(([label, value]) => (
                    <div
                      key={label}
                      className="bg-[#12121a] px-4 py-2.5 flex flex-col gap-0.5"
                    >
                      <span className="text-[11px] text-gray-500 uppercase tracking-wider">
                        {label}
                      </span>
                      <span className="text-sm text-gray-200 truncate">
                        {value}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full bg-white/10" />
              ))}
            </div>
          ) : data && data.events.length > 0 ? (
            <>
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 shrink-0">
                Event List ({data.totalCount})
              </h3>
              <div className="flex-1 rounded-lg border border-white/10 overflow-auto min-h-0">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-[#0e0e18]">
                    <TableRow className="border-white/10 hover:bg-transparent">
                      {orderedFields.map((name) => (
                        <TableHead
                          key={name}
                          className="text-gray-400 text-xs font-medium whitespace-nowrap bg-[#0e0e18]"
                        >
                          {formatFieldName(name)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.events.map((event, idx) => (
                      <TableRow
                        key={idx}
                        className="border-white/10 hover:bg-white/5"
                      >
                        {orderedFields.map((name) => (
                          <TableCell
                            key={name}
                            className="text-gray-300 text-xs whitespace-nowrap py-2"
                          >
                            {renderCellValue(name, event.fields[name])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : !error && !isLoading ? (
            <p className="text-center text-sm text-gray-600 py-4">
              No events in this channel
            </p>
          ) : null}

          {data && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-600 mt-3 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              Auto-refreshes every 10 seconds
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- Main Page ---

export default function DevicesPage() {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<DeviceEntry | null>(
    null
  );
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration guard for Radix useId()
  useEffect(() => setMounted(true), []);

  const { data: tree, isLoading: treeLoading } = useClientTree("FORTRESS");

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

  const totalDevices = deviceGroups.reduce(
    (sum, g) => sum + g.devices.length,
    0
  );

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
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Client selector */}
        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-400 shrink-0">Client</label>
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
            {deviceGroups.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                No devices found for this client
              </div>
            ) : (
              deviceGroups.map((group) => (
                <DeviceGroupSection
                  key={group.name}
                  group={group}
                  onSelectDevice={setSelectedDevice}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Event sheet */}
      <DeviceEventSheet
        device={selectedDevice}
        clientName={selectedName}
        onClose={() => setSelectedDevice(null)}
      />
    </div>
  );
}
