"use client";

import { Activity, Monitor, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectorHealth } from "@/hooks/use-arcsight";

export default function DashboardPage() {
  const { data: health, isLoading: healthLoading } = useConnectorHealth();

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold">Security Dashboard</h2>
        <p className="text-gray-500">
          ArcSight ESM connector overview
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Connectors
            </CardTitle>
            <Monitor className="w-5 h-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <Skeleton className="h-9 w-24 bg-white/10" />
            ) : health ? (
              <div className="text-3xl font-bold text-white">
                {health.total.toLocaleString()}
              </div>
            ) : (
              <div className="text-3xl font-bold text-white">--</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Live
            </CardTitle>
            <ShieldCheck className="w-5 h-5 text-green-500" />
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <Skeleton className="h-9 w-24 bg-white/10" />
            ) : health ? (
              <div className="text-3xl font-bold text-green-400">
                {health.live.length}
              </div>
            ) : (
              <div className="text-3xl font-bold text-white">--</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Offline
            </CardTitle>
            <Activity className="w-5 h-5 text-red-500" />
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <Skeleton className="h-9 w-24 bg-white/10" />
            ) : health ? (
              <div className="text-3xl font-bold text-red-400">
                {health.dead.length}
              </div>
            ) : (
              <div className="text-3xl font-bold text-white">--</div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
