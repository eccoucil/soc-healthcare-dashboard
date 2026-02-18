"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, Bug, Radio, FolderTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useChannelDebug, useChannelList } from "@/hooks/use-arcsight";

type Tab = "channels" | "debug";


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

function ChannelCircle({
  channel,
}: {
  channel: {
    displayName: string;
    resourceId: string;
    subType: string;
    groupName: string;
  };
}) {
  const colors = SUBTYPE_COLORS[channel.subType] ?? DEFAULT_SUBTYPE_COLOR;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <div
          className={`w-20 h-20 rounded-full bg-[#1a1a28] ring-2 ${colors.ring} flex items-center justify-center`}
        >
          <Radio className="w-7 h-7 text-gray-400" />
        </div>
        {/* subType dot badge (top-right) */}
        <div
          className={`absolute top-0 right-0 w-3 h-3 rounded-full ${colors.dot} ring-2 ring-[#0a0a0f]`}
          title={channel.subType || "Unknown"}
        />
      </div>
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

function ChannelCanvasView() {
  const { data, isLoading, error, refetch } = useChannelList();

  const allChannels = useMemo(() => {
    if (!data?.groups) return [];
    const seen = new Set<string>();
    const out: Array<{ displayName: string; resourceId: string; subType: string; groupName: string }> = [];
    for (const g of data.groups) {
      for (const ch of g.channels) {
        if (seen.has(ch.resourceId)) continue;
        seen.add(ch.resourceId);
        out.push({ ...ch, groupName: g.name });
      }
    }
    return out;
  }, [data]);

  const [displayChannels, setDisplayChannels] = useState(allChannels);

  // Sync when underlying data changes (new fetch, added/removed channels)
  useEffect(() => {
    setDisplayChannels(shuffleArray(allChannels));
  }, [allChannels]);

  // Rotate positions every 60 seconds for SOC TV display
  useEffect(() => {
    if (allChannels.length === 0) return;
    const timer = setInterval(() => {
      setDisplayChannels(shuffleArray(allChannels));
    }, 60_000);
    return () => clearInterval(timer);
  }, [allChannels]);

  const totalGroups = data?.groups.length ?? 0;

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">All Active Channels</h2>
          {data && (
            <>
              <Badge
                variant="outline"
                className="bg-purple-500/15 text-purple-400 border-purple-500/20"
              >
                {totalGroups} groups
              </Badge>
              <Badge
                variant="outline"
                className="bg-blue-500/15 text-blue-400 border-blue-500/20"
              >
                {allChannels.length} channels
              </Badge>
            </>
          )}
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
            <ChannelCircle key={ch.resourceId} channel={ch} />
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
    </>
  );
}

function DebugView() {
  const { data, isLoading, error, refetch } = useChannelDebug();

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Data Monitor</h2>
          <p className="text-gray-500">
            Phoenix GWT-RPC response from DataMonitorV2Service
          </p>
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

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <Activity className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {data && (
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">Phoenix Auth</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Badge
              variant="outline"
              className={
                data.loginOk
                  ? "bg-green-500/15 text-green-400 border-green-500/20"
                  : "bg-red-500/15 text-red-400 border-red-500/20"
              }
            >
              {data.loginOk ? "Authenticated" : "Failed"}
            </Badge>
            <span className="text-sm text-gray-400 font-mono">
              Token: {data.tokenPreview}
            </span>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-base">
              GWT-RPC Request
            </CardTitle>
            <CardDescription className="text-gray-500">
              Pipe-delimited request sent to DataMonitorV2Service.getViewableData
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs text-gray-300 bg-[#0a0a0f] rounded-lg p-4 overflow-x-auto border border-white/5 whitespace-pre-wrap break-all">
              {data.requestBody}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card className="bg-[#12121a] border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-base">Raw Response</CardTitle>
          <CardDescription className="text-gray-500">
            Decoded GWT-RPC response (values + string table)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full bg-white/10" />
              ))}
            </div>
          ) : data ? (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">
                  Values ({data.dataMonitorResponse.values.length} entries)
                </h4>
                <pre className="text-xs text-green-300 bg-[#0a0a0f] rounded-lg p-4 overflow-x-auto border border-white/5 max-h-96 overflow-y-auto">
                  {JSON.stringify(data.dataMonitorResponse.values, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">
                  String Table ({data.dataMonitorResponse.stringTable.length}{" "}
                  entries)
                </h4>
                <pre className="text-xs text-blue-300 bg-[#0a0a0f] rounded-lg p-4 overflow-x-auto border border-white/5 max-h-64 overflow-y-auto">
                  {JSON.stringify(
                    data.dataMonitorResponse.stringTable,
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          ) : !error ? (
            <div className="text-center py-12">
              <Activity className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500">No data</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

export default function ChannelsPage() {
  const [tab, setTab] = useState<Tab>("channels");

  return (
    <>
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 p-1 bg-[#12121a] rounded-lg border border-white/10 w-fit">
        <button
          onClick={() => setTab("channels")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
            tab === "channels"
              ? "bg-red-600/20 text-red-400"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" />
          Canvas
        </button>
        <button
          onClick={() => setTab("debug")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
            tab === "debug"
              ? "bg-red-600/20 text-red-400"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Bug className="w-3.5 h-3.5" />
          Debug
        </button>
      </div>

      {tab === "channels" ? <ChannelCanvasView /> : <DebugView />}
    </>
  );
}
