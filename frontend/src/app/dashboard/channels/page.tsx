"use client";

import { Activity, RefreshCw } from "lucide-react";
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
import { useChannelDebug } from "@/hooks/use-arcsight";

export default function ChannelsPage() {
  const { data, isLoading, error, refetch } = useChannelDebug();

  return (
    <>
      {/* Page Header */}
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

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <Activity className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Auth Status */}
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

      {/* Request Body */}
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

      {/* Raw Response */}
      <Card className="bg-[#12121a] border-white/10">
        <CardHeader>
          <CardTitle className="text-white text-base">
            Raw Response
          </CardTitle>
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
                  {JSON.stringify(data.dataMonitorResponse.stringTable, null, 2)}
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
