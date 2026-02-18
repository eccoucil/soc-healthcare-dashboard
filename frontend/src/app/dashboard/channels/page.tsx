"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, Radio, X, Loader2 } from "lucide-react";
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

function getChannelHealth(lastUpdateTime: string | null): HealthStatus {
  if (!lastUpdateTime) return "unhealthy";
  const age = Date.now() - new Date(lastUpdateTime).getTime();
  return isNaN(age) || age > 10 * 60_000 ? "unhealthy" : "healthy";
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

function ChannelCircle({
  channel,
  onClick,
}: {
  channel: ChannelCircleData;
  onClick: () => void;
}) {
  const colors = SUBTYPE_COLORS[channel.subType] ?? DEFAULT_SUBTYPE_COLOR;
  const health = getChannelHealth(channel.lastUpdateTime);

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
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-[#0a0a0f] ${
            health === "healthy" ? "bg-green-500" : "bg-red-500"
          }`}
          title={health === "healthy" ? "Active" : "Inactive"}
        />
      </div>
      <span
        className={`text-[10px] font-medium ${
          health === "healthy" ? "text-green-400" : "text-red-400"
        }`}
      >
        {health === "healthy" ? "Active" : "Inactive"}
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

function ChannelCanvasView() {
  const { data, isLoading, error, refetch } = useChannelList();
  const [selectedChannel, setSelectedChannel] = useState<ChannelCircleData | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");

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

  const filteredChannels = useMemo(() => {
    if (filter === "all") return allChannels;
    return allChannels.filter((ch) => {
      const health = getChannelHealth(ch.lastUpdateTime);
      return filter === "active" ? health === "healthy" : health === "unhealthy";
    });
  }, [allChannels, filter]);

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

  const totalGroups = data?.groups.length ?? 0;

  const activeCount = allChannels.filter(
    (ch) => getChannelHealth(ch.lastUpdateTime) === "healthy"
  ).length;
  const inactiveCount = allChannels.length - activeCount;

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
            size="icon"
            onClick={refetch}
            className="text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <Activity className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
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
      ) : allChannels.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-6 justify-items-center py-4">
          {displayChannels.map((ch) => (
            <ChannelCircle
              key={ch.resourceId}
              channel={ch}
              onClick={() => setSelectedChannel(ch)}
            />
          ))}
        </div>
      ) : !error ? (
        <div className="text-center py-12">
          <Radio className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500">No channels found</p>
        </div>
      ) : null}

      <p className="text-xs text-gray-600 text-center">
        Auto-refreshes every 60 seconds via GroupService + ChannelService
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
