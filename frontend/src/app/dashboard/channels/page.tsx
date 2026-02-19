"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, Radio, X, Loader2, Scan, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
  useChannelList,
  useChannelEventsOnDemand,
  useChannelScan,
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
  // Primary: scan results (actual event flow)
  if (scanInfo !== undefined) {
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

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function ChannelEventSheet({
  channel,
  onClose,
}: {
  channel: ChannelCircleData | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useChannelEventsOnDemand(
    channel?.resourceId ?? null
  );

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
                  {data.events.map((event, idx) => (
                    <TableRow
                      key={idx}
                      className="border-white/10 hover:bg-white/5"
                    >
                      {data.fieldNames.map((name) => (
                        <TableCell
                          key={name}
                          className="text-gray-300 text-xs whitespace-nowrap py-2"
                        >
                          {formatCellValue(event.fields[name])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
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
              Auto-refreshes every 10 seconds
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ScanResultsTable({
  results,
  scannedAt,
}: {
  results: {
    channelId: string;
    channelName: string;
    groupName: string;
    subType: string;
    hasEvents: boolean;
    eventCount: number;
    fieldNames: string[];
    error?: string;
  }[];
  scannedAt: string;
}) {
  const withEvents = results.filter((r) => r.hasEvents);
  const withErrors = results.filter((r) => r.error);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">Scan Results</h3>
          <Badge
            variant="outline"
            className="bg-green-500/15 text-green-400 border-green-500/20 text-xs"
          >
            {withEvents.length} with data
          </Badge>
          <Badge
            variant="outline"
            className="bg-gray-500/15 text-gray-400 border-gray-500/20 text-xs"
          >
            {results.length - withEvents.length - withErrors.length} empty
          </Badge>
          {withErrors.length > 0 && (
            <Badge
              variant="outline"
              className="bg-red-500/15 text-red-400 border-red-500/20 text-xs"
            >
              {withErrors.length} error(s)
            </Badge>
          )}
        </div>
        <span className="text-xs text-gray-500">
          Scanned {new Date(scannedAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="rounded-lg border border-white/10 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="text-gray-400 text-xs">Channel</TableHead>
              <TableHead className="text-gray-400 text-xs">Group</TableHead>
              <TableHead className="text-gray-400 text-xs">Type</TableHead>
              <TableHead className="text-gray-400 text-xs text-right">Events</TableHead>
              <TableHead className="text-gray-400 text-xs">Fields</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow
                key={r.channelId}
                className="border-white/10 hover:bg-white/5"
              >
                <TableCell className="text-xs py-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        r.error
                          ? "bg-red-500"
                          : r.hasEvents
                            ? "bg-green-500"
                            : "bg-gray-600"
                      }`}
                    />
                    <span className="text-gray-200">{r.channelName}</span>
                  </div>
                </TableCell>
                <TableCell className="text-gray-400 text-xs py-2">{r.groupName}</TableCell>
                <TableCell className="text-gray-400 text-xs py-2">{r.subType}</TableCell>
                <TableCell className="text-right py-2">
                  {r.error ? (
                    <span className="text-red-400 text-xs" title={r.error}>error</span>
                  ) : (
                    <span
                      className={`text-xs font-mono ${
                        r.hasEvents ? "text-green-400" : "text-gray-600"
                      }`}
                    >
                      {r.eventCount}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-gray-500 text-xs py-2 max-w-[200px] truncate">
                  {r.fieldNames.length > 0 ? r.fieldNames.join(", ") : "\u2014"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ChannelCanvasView() {
  const { data, isLoading, error, refetch } = useChannelList();
  const [selectedChannel, setSelectedChannel] = useState<ChannelCircleData | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [scanEnabled, setScanEnabled] = useState(false);
  const {
    data: scanData,
    isLoading: scanLoading,
    error: scanError,
    refetch: rescan,
  } = useChannelScan(scanEnabled);

  const allChannels = useMemo(() => {
    if (!data?.groups) return [];
    const seen = new Set<string>();
    const out: ChannelCircleData[] = [];
    for (const g of data.groups) {
      for (const ch of g.channels) {
        if (seen.has(ch.resourceId)) continue;
        seen.add(ch.resourceId);
        out.push({
          displayName: ch.displayName,
          resourceId: ch.resourceId,
          subType: ch.subType,
          groupName: g.name,
          lastUpdateTime: ch.lastUpdateTime,
        });
      }
    }
    return out;
  }, [data]);

  // Build lookup from scan results → per-channel event info
  const scanMap = useMemo(() => {
    if (!scanData?.results) return new Map<string, ScanInfo>();
    const map = new Map<string, ScanInfo>();
    for (const r of scanData.results) {
      map.set(r.channelId, { hasEvents: r.hasEvents, eventCount: r.eventCount });
    }
    return map;
  }, [scanData]);

  const filteredChannels = useMemo(() => {
    if (filter === "all") return allChannels;
    return allChannels.filter((ch) => {
      const { status } = getChannelHealth(ch.lastUpdateTime, scanMap.get(ch.resourceId));
      return filter === "active" ? status === "healthy" : status === "unhealthy";
    });
  }, [allChannels, filter, scanMap]);

  const [displayChannels, setDisplayChannels] = useState(filteredChannels);

  // Sync when underlying data or filter changes
  useEffect(() => {
    setDisplayChannels(shuffleArray(filteredChannels));
  }, [filteredChannels]);

  // Rotate positions every 60 seconds for SOC TV display
  useEffect(() => {
    if (filteredChannels.length === 0) return;
    const timer = setInterval(() => {
      setDisplayChannels(shuffleArray(filteredChannels));
    }, 60_000);
    return () => clearInterval(timer);
  }, [filteredChannels]);

  const { active: activeCount, inactive: inactiveCount } = useMemo(() => {
    let active = 0;
    for (const ch of allChannels) {
      if (getChannelHealth(ch.lastUpdateTime, scanMap.get(ch.resourceId)).status === "healthy") {
        active++;
      }
    }
    return { active, inactive: allChannels.length - active };
  }, [allChannels, scanMap]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Channels</h2>
          {data && (
            <Badge
              variant="outline"
              className="bg-blue-500/15 text-blue-400 border-blue-500/20"
            >
              {filteredChannels.length} of {allChannels.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#12121a] rounded-lg border border-white/10">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { if (!scanEnabled) setScanEnabled(true); else rescan(); }}
            disabled={scanLoading}
            className="text-gray-400 hover:text-white gap-1.5"
            title="Re-probe each channel for events"
          >
            {scanLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Scan className="w-4 h-4" />
            )}
            {scanLoading ? "Scanning..." : scanEnabled ? "Rescan" : "Scan Events"}
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
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 px-4 py-6 rounded-lg bg-red-500/10 border border-red-500/20">
          <Activity className="w-6 h-6 text-red-400" />
          <p className="text-sm text-red-300 text-center max-w-md">{error}</p>
          {error.toLowerCase().includes("phoenix") || error.includes("fetch failed") ? (
            <p className="text-xs text-gray-500 text-center max-w-md">
              The REST API is working but the Phoenix GWT-RPC service is not responding.
              Channels require the Phoenix UI application to be running on the ESM server.
            </p>
          ) : null}
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

      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-6 justify-items-center py-4">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="w-20 h-20 rounded-full bg-white/10" />
              <Skeleton className="h-3 w-16 bg-white/10" />
            </div>
          ))}
        </div>
      ) : displayChannels.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-6 justify-items-center py-4">
          {displayChannels.map((ch) => (
            <ChannelCircle
              key={ch.resourceId}
              channel={ch}
              onClick={() => setSelectedChannel(ch)}
              scanInfo={scanMap.get(ch.resourceId)}
            />
          ))}
        </div>
      ) : allChannels.length > 0 && filter !== "all" ? (
        <div className="text-center py-12">
          <Radio className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">
            No {filter} channels — try switching to &quot;All&quot;
          </p>
          <p className="text-xs text-gray-600 mt-1">
            {allChannels.length} total channel{allChannels.length !== 1 ? "s" : ""} across all statuses
          </p>
        </div>
      ) : !error ? (
        <div className="text-center py-12">
          <Radio className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No channels found</p>
        </div>
      ) : null}

      {scanError && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <Database className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">Scan failed: {scanError}</p>
        </div>
      )}

      {scanLoading && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span className="text-sm text-gray-400">
            Opening all channels, waiting for server to buffer, then polling for events...
          </span>
        </div>
      )}

      {scanData && !scanLoading && (
        <ScanResultsTable
          results={scanData.results}
          scannedAt={scanData.scannedAt}
        />
      )}

      <p className="text-xs text-gray-600 text-center">
        Channel list refreshes every 60s &middot; Event scan every 3 min
        {scanData?.scannedAt && (
          <> &middot; Last scan: {new Date(scanData.scannedAt).toLocaleTimeString()}</>
        )}
        {!scanData && !scanLoading && " &middot; * = estimated (scan pending)"}
      </p>

      <ChannelEventSheet
        channel={selectedChannel}
        onClose={() => setSelectedChannel(null)}
      />
    </>
  );
}

export default function ChannelsPage() {
  return <ChannelCanvasView />;
}
