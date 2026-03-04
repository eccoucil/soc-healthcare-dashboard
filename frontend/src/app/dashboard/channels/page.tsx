"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, RefreshCw, Radio, X, Loader2, ChevronRight, Expand, FolderOpen, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  useChannelEventsOnDemand,
  useChannelScan,
  useClientTree,
  useEventDetails,
  useMultiChannelLive,
  useMultiChannelCleanup,
} from "@/hooks/use-arcsight";

type ActivityFilter = "all" | "active" | "inactive";

interface ChannelCircleData {
  displayName: string;
  resourceId: string;
  subType: string;
  groupName: string;
  lastUpdateTime: string | null;
}

const SUBTYPE_COLORS: Record<string, { ring: string; dot: string }> = {
  Event: { ring: "ring-green-500/50", dot: "bg-green-500" },
  Trend: { ring: "ring-cyan-500/50", dot: "bg-cyan-500" },
  Query: { ring: "ring-amber-500/50", dot: "bg-amber-500" },
  "Last State": { ring: "ring-purple-500/50", dot: "bg-purple-500" },
  Session: { ring: "ring-blue-500/50", dot: "bg-blue-500" },
  "Active List": { ring: "ring-pink-500/50", dot: "bg-pink-500" },
  "Last N Events": { ring: "ring-indigo-500/50", dot: "bg-indigo-500" },
};

const DEFAULT_SUBTYPE_COLOR = { ring: "ring-gray-500/50", dot: "bg-gray-500" };

type HealthStatus = "healthy" | "unhealthy";
type HealthSource = "scan" | "estimated";

interface HealthResult {
  status: HealthStatus;
  source: HealthSource;
}

function getChannelHealth(
  lastUpdateTime: string | null,
  scanInfo?: ScanInfo
): HealthResult {
  // Primary: scan results with managerReceiptTime (actual event flow)
  if (scanInfo !== undefined) {
    if (scanInfo.latestManagerReceiptTime !== null) {
      const age = Date.now() - scanInfo.latestManagerReceiptTime;
      return {
        status: age <= 10 * 60_000 ? "healthy" : "unhealthy",
        source: "scan",
      };
    }
    // No managerReceiptTime but scan completed — use hasEvents as fallback
    return {
      status: scanInfo.hasEvents ? "healthy" : "unhealthy",
      source: "scan",
    };
  }
  // Fallback: metadata timestamp (pre-scan estimate)
  if (!lastUpdateTime) return { status: "unhealthy", source: "estimated" };
  const age = Date.now() - new Date(lastUpdateTime).getTime();
  return {
    status: isNaN(age) || age > 10 * 60_000 ? "unhealthy" : "healthy",
    source: "estimated",
  };
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

interface ScanInfo {
  hasEvents: boolean;
  eventCount: number;
  latestManagerReceiptTime: number | null;
}

function ChannelCircle({
  channel,
  onClick,
  scanInfo,
}: {
  channel: ChannelCircleData;
  onClick: () => void;
  scanInfo?: ScanInfo;
}) {
  const colors = SUBTYPE_COLORS[channel.subType] ?? DEFAULT_SUBTYPE_COLOR;
  const { status: health, source } = getChannelHealth(channel.lastUpdateTime, scanInfo);
  const isEstimated = source === "estimated";

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
          className={`w-20 h-20 rounded-full bg-[#1a1a28] ring-2 ${colors.ring} flex items-center justify-center cursor-pointer transition-all group-hover:ring-white/30 group-hover:bg-[#1e1e30] focus-visible:outline-none focus-visible:ring-white/50`}
        >
          <Radio className="w-7 h-7 text-gray-400" />
        </div>
        {/* activity dot (bottom-right) */}
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
        {/* scan event count badge (top-right) */}
        {scanInfo && (
          <div
            className={`absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-[#0a0a0f] ${
              scanInfo.hasEvents
                ? "bg-green-600 text-white"
                : "bg-gray-600 text-gray-300"
            }`}
            title={
              scanInfo.hasEvents
                ? `${scanInfo.eventCount} event(s)`
                : "No events"
            }
          >
            {scanInfo.hasEvents ? scanInfo.eventCount : "0"}
          </div>
        )}
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
        {channel.displayName}
      </span>
      <span className="text-[10px] text-gray-500 max-w-[100px] text-center truncate">
        {channel.groupName}
      </span>
    </div>
  );
}

function ChannelFieldSection({
  section,
  entries,
  defaultOpen,
}: {
  section: string;
  entries: [string, string | number | null][];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-white/10 bg-[#12121a]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-white/5 transition-colors rounded-lg"
      >
        <span className="text-xs font-medium text-gray-300 uppercase tracking-wider">
          {section}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600">
            {entries.length} field{entries.length !== 1 ? "s" : ""}
          </span>
          <ChevronRight
            className={`w-3 h-3 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="border-t border-white/5">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[160px_1fr] gap-2 px-4 py-1.5 border-b border-white/5 last:border-b-0"
            >
              <span className="text-[11px] text-gray-500 truncate">
                {key}
              </span>
              <span
                className={`text-[11px] break-all ${
                  value == null || value === ""
                    ? "text-gray-700 italic"
                    : "text-gray-300"
                }`}
              >
                {formatCellValue(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelFullDetailPanel({
  eventId,
  onBack,
}: {
  eventId: number;
  onBack: () => void;
}) {
  const { data, isLoading, error } = useEventDetails(eventId);

  // Count non-null field values for display
  const nonNullCount = useMemo(() => {
    if (!data?.events?.[0]) return 0;
    return Object.values(data.events[0].fields).filter((f) => f.value != null).length;
  }, [data]);

  // Group fields by category
  const sections = useMemo(() => {
    if (!data?.events?.[0]) return [];
    const fields = data.events[0].fields;
    const groups = new Map<string, [string, string | number | null][]>();
    for (const detail of Object.values(fields)) {
      const section = detail.category ?? "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section)!.push([detail.displayName, detail.value]);
    }
    for (const entries of groups.values()) {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return [...groups.entries()]
      .sort(([a], [b]) => {
        if (a === "Other") return 1;
        if (b === "Other") return -1;
        return a.localeCompare(b);
      })
      .map(([section, entries]) => ({ section, entries }));
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-gray-400 hover:text-white -ml-2"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          Back
        </Button>
        <span className="text-xs text-gray-500 ml-auto">
          {data ? `${nonNullCount}/${data.totalFieldCount} fields` : "Loading..."}
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <Activity className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full bg-white/10" />
          ))}
        </div>
      ) : sections.length > 0 ? (
        <div className="space-y-2">
          {sections.map(({ section, entries }, idx) => (
            <ChannelFieldSection
              key={section}
              section={section}
              entries={entries}
              defaultOpen={idx < 5}
            />
          ))}
        </div>
      ) : (
        <p className="text-center text-sm text-gray-600 py-4">
          No field data returned
        </p>
      )}
    </div>
  );
}

interface ChannelResultLike {
  events: { fields: Record<string, string | number | null> }[];
  totalCount: number;
  fieldNames: string[];
  eventIds?: number[];
}

function ChannelEventSheet({
  channel,
  onClose,
  liveResult,
}: {
  channel: ChannelCircleData | null;
  onClose: () => void;
  liveResult?: ChannelResultLike | null;
}) {
  // Skip the on-demand subscription if we already have live data
  const hasLive = !!(liveResult && liveResult.events.length > 0);
  const { data: onDemandData, isLoading: onDemandLoading, error } = useChannelEventsOnDemand(
    hasLive ? null : (channel?.resourceId ?? null)
  );
  const data = hasLive ? liveResult : onDemandData;
  const isLoading = hasLive ? false : onDemandLoading;

  // Reset selection when channel changes by tracking the resource ID
  const currentResourceId = channel?.resourceId ?? null;
  const [selection, setSelection] = useState<{ resourceId: string | null; eventId: number | null }>({
    resourceId: currentResourceId,
    eventId: null,
  });
  const selectedEventId =
    selection.resourceId === currentResourceId ? selection.eventId : null;
  const setSelectedEventId = (id: number | null) =>
    setSelection({ resourceId: currentResourceId, eventId: id });

  return (
    <Sheet open={!!channel} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[600px] sm:max-w-[600px] bg-[#0a0a0f] border-white/10 overflow-y-auto"
      >
        <SheetHeader className="pb-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-white text-lg">
              {channel?.displayName ?? "Channel"}
            </SheetTitle>
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
            Live events from channel {channel?.displayName}
          </SheetDescription>
          {channel && (
            <div className="flex items-center gap-2 pt-1">
              <Badge
                variant="outline"
                className="bg-purple-500/15 text-purple-400 border-purple-500/20 text-xs"
              >
                {channel.groupName}
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs ${
                  (SUBTYPE_COLORS[channel.subType] ?? DEFAULT_SUBTYPE_COLOR).dot
                    .replace("bg-", "text-")
                    .replace("500", "400")
                } border-white/10`}
              >
                {channel.subType || "Unknown"}
              </Badge>
              {data && (
                <Badge
                  variant="outline"
                  className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-xs"
                >
                  {data.totalCount} event{data.totalCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="pt-4 space-y-4">
          {selectedEventId !== null ? (
            <ChannelFullDetailPanel
              eventId={selectedEventId}
              onBack={() => setSelectedEventId(null)}
            />
          ) : (<>
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              <Activity className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full bg-white/10" />
              ))}
            </div>
          ) : data && data.events.length > 0 ? (
            <div className="rounded-lg border border-white/10 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-gray-400 text-xs font-medium whitespace-nowrap w-8" />
                    {data.fieldNames.map((name) => (
                      <TableHead
                        key={name}
                        className="text-gray-400 text-xs font-medium whitespace-nowrap"
                      >
                        {formatFieldName(name)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.events.map((event, idx) => {
                    const eid = event.fields["eventId"];
                    const numericId = typeof eid === "number" ? eid : eid != null ? Number(eid) : null;
                    return (
                      <TableRow
                        key={idx}
                        className="border-white/10 hover:bg-white/5"
                      >
                        <TableCell className="py-2 w-8">
                          {numericId && numericId > 0 ? (
                            <button
                              onClick={() => setSelectedEventId(numericId)}
                              className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
                              title="View full event details (~450 fields)"
                            >
                              <Expand className="w-3 h-3" />
                            </button>
                          ) : null}
                        </TableCell>
                        {data.fieldNames.map((name) => (
                          <TableCell
                            key={name}
                            className="text-gray-300 text-xs whitespace-nowrap py-2"
                          >
                            {formatCellValue(event.fields[name])}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : !error ? (
            <div className="text-center py-12">
              <Radio className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500">No events in this channel</p>
            </div>
          ) : null}

          {data && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-600">
              <Loader2 className="w-3 h-3 animate-spin" />
              Auto-refreshes every 60 seconds
            </div>
          )}
          </>)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- Channel group section (collapsible) ---

interface ChannelGroup {
  name: string;
  channels: ChannelCircleData[];
}

function ChannelGroupSection({
  group,
  onSelectChannel,
  scanMap,
}: {
  group: ChannelGroup;
  onSelectChannel: (ch: ChannelCircleData) => void;
  scanMap?: Map<string, ScanInfo>;
}) {
  const [expanded, setExpanded] = useState(true);
  const active = group.channels.filter(
    (ch) => getChannelHealth(ch.lastUpdateTime, scanMap?.get(ch.resourceId)).status === "healthy"
  ).length;
  const inactive = group.channels.length - active;

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
            {group.channels.length} device{group.channels.length !== 1 ? "s" : ""}
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
      {expanded && group.channels.length > 0 && (
        <div className="px-4 pb-3 pt-1">
          <div className="flex flex-wrap gap-5">
            {group.channels.map((ch) => (
              <ChannelCircle
                key={ch.resourceId}
                channel={ch}
                onClick={() => onSelectChannel(ch)}
                scanInfo={scanMap?.get(ch.resourceId)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Page ---

export default function ChannelsPage() {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelCircleData | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration guard for Radix useId()
  useEffect(() => setMounted(true), []);

  const { data: tree, isLoading: treeLoading, error: treeError, refetch } = useClientTree("FORTRESS");

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
      });
    }
    return map;
  }, [scanData]);

  // Extract client-level nodes from tree categories (2 levels deep):
  // FORTRESS → categories (Device Monitoring, Incident Monitoring) → clients (Cadeploy)
  const treeClients = useMemo(() => {
    if (!tree) return [];
    return tree.children.flatMap((category) => category.children);
  }, [tree]);

  // Auto-select first client when tree loads (if nothing selected yet)
  useEffect(() => {
    if (!selectedName && treeClients.length > 0) {
      /* eslint-disable react-hooks/set-state-in-effect -- auto-select first client on initial load */
      setSelectedName(treeClients[0].name);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [selectedName, treeClients]);

  // Find the selected client node from the tree
  const selectedClient = useMemo(() => {
    if (!selectedName) return null;
    return treeClients.find((c) => c.name === selectedName) ?? null;
  }, [treeClients, selectedName]);

  // Collect channel groups from the selected client
  const channelGroups = useMemo((): ChannelGroup[] => {
    if (!selectedClient) return [];
    const groups: ChannelGroup[] = [];

    // Sub-groups become device category sections
    for (const child of selectedClient.children) {
      if (child.channels.length > 0) {
        groups.push({
          name: child.name,
          channels: child.channels.map((ch) => ({
            ...ch,
            groupName: child.name,
          })),
        });
      }
    }

    // Direct channels on the client itself (not in a sub-group)
    if (selectedClient.channels.length > 0) {
      groups.push({
        name: "General",
        channels: selectedClient.channels.map((ch) => ({
          ...ch,
          groupName: "General",
        })),
      });
    }

    return groups;
  }, [selectedClient]);

  // Flatten all channels for the selected client for counting
  const allChannels = useMemo(() => {
    return channelGroups.flatMap((g) => g.channels);
  }, [channelGroups]);

  // --- Live multi-channel polling (up to 5 channels simultaneously) ---
  const liveChannelIds = useMemo(
    () => allChannels.slice(0, 5).map((ch) => ch.resourceId),
    [allChannels]
  );
  const { data: liveData } = useMultiChannelLive(liveChannelIds);
  useMultiChannelCleanup();

  // Build combined scan+live map — live data only overrides when equal or better
  const combinedScanMap = useMemo(() => {
    const map = new Map<string, ScanInfo>(scanMap);
    if (liveData?.channels) {
      for (const [id, result] of Object.entries(liveData.channels)) {
        let latestMrt: number | null = null;
        for (const evt of result.events) {
          const mrt = evt.fields["managerReceiptTime"];
          const val = typeof mrt === "number" ? mrt : typeof mrt === "string" ? Number(mrt) : null;
          if (val && !isNaN(val) && (latestMrt === null || val > latestMrt)) latestMrt = val;
        }

        const existing = map.get(id);
        const liveHasData = result.events.length > 0;

        // Only override scan data if live data is equal or better.
        // Don't downgrade a channel from "has events" to "no events"
        // when the lightweight subscribe hasn't warmed up yet.
        if (liveHasData || !existing?.hasEvents) {
          map.set(id, {
            hasEvents: liveHasData,
            eventCount: result.totalCount,
            latestManagerReceiptTime: latestMrt,
          });
        } else if (existing && latestMrt !== null) {
          // Live has 0 events but found a newer MRT — update just the timestamp
          map.set(id, {
            ...existing,
            latestManagerReceiptTime: latestMrt,
          });
        }
        // else: keep existing scan data (don't overwrite with worse data)
      }
    }
    return map;
  }, [scanMap, liveData]);

  // Filtered channels per group
  const filteredGroups = useMemo(() => {
    if (filter === "all") return channelGroups;
    return channelGroups
      .map((g) => ({
        ...g,
        channels: g.channels.filter((ch) => {
          const { status } = getChannelHealth(ch.lastUpdateTime, combinedScanMap.get(ch.resourceId));
          return filter === "active" ? status === "healthy" : status === "unhealthy";
        }),
      }))
      .filter((g) => g.channels.length > 0);
  }, [channelGroups, filter, combinedScanMap]);

  const { active: activeCount, inactive: inactiveCount } = useMemo(() => {
    let active = 0;
    for (const ch of allChannels) {
      if (getChannelHealth(ch.lastUpdateTime, combinedScanMap.get(ch.resourceId)).status === "healthy") active++;
    }
    return { active, inactive: allChannels.length - active };
  }, [allChannels, combinedScanMap]);

  const totalDevices = allChannels.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 h-16 px-6 border-b border-white/10 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Channels</h1>
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
          <Button
            variant="ghost"
            size="icon"
            onClick={refetch}
            className="text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Client selector + filter controls */}
        <div className="flex items-center gap-4 flex-wrap">
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
                {channelGroups.length} group{channelGroups.length !== 1 && "s"}
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

        {/* Error state */}
        {treeError && (
          <div className="flex flex-col items-center gap-3 px-4 py-6 rounded-lg bg-red-500/10 border border-red-500/20">
            <Activity className="w-6 h-6 text-red-400" />
            <p className="text-sm text-red-300 text-center max-w-md">{treeError}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={refetch}
              className="text-gray-400 hover:text-white gap-1.5 mt-1"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </Button>
          </div>
        )}

        {/* Empty state: no client selected */}
        {!selectedName && !treeLoading && !treeError && (
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

        {/* Channel group sections for selected client */}
        {selectedClient && !treeLoading && (
          <div className="space-y-3">
            {filteredGroups.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                {filter !== "all"
                  ? `No ${filter} devices — try switching to "All"`
                  : "No devices found for this client"}
              </div>
            ) : (
              filteredGroups.map((group) => (
                <ChannelGroupSection
                  key={group.name}
                  group={group}
                  onSelectChannel={setSelectedChannel}
                  scanMap={combinedScanMap}
                />
              ))
            )}
          </div>
        )}

        {/* Footer status */}
        <p className="text-xs text-gray-600 text-center">
          {liveData?.liveCount
            ? `${liveData.liveCount} channel${liveData.liveCount !== 1 ? "s" : ""} polled live (60s)`
            : ""}
          {liveData?.liveCount ? " · " : ""}
          Scan every 10 min
          {scanLoading && " (scanning...)"}
          {scanData?.scannedAt && !scanLoading && (
            <> &middot; Last scan: {new Date(scanData.scannedAt).toLocaleTimeString()}</>
          )}
          {!scanData && !scanLoading && !liveData && " · * = estimated (scan pending)"}
        </p>
      </main>

      {/* Event sheet — pre-populated with live data if available */}
      <ChannelEventSheet
        channel={selectedChannel}
        onClose={() => setSelectedChannel(null)}
        liveResult={
          selectedChannel && liveData?.channels?.[selectedChannel.resourceId]
            ? liveData.channels[selectedChannel.resourceId]
            : null
        }
      />
    </div>
  );
}
