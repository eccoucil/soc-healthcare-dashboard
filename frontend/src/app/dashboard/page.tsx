"use client";

import React, { useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  Globe,
  Monitor,
  Server,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectorHealth } from "@/hooks/use-arcsight";

const recentAlerts = [
  {
    id: "ALT-001",
    severity: "critical",
    title: "Ransomware detected on endpoint",
    source: "WS-MED-042",
    time: "2 min ago",
    status: "open",
  },
  {
    id: "ALT-002",
    severity: "high",
    title: "Unusual outbound traffic pattern",
    source: "SRV-DB-001",
    time: "15 min ago",
    status: "investigating",
  },
  {
    id: "ALT-003",
    severity: "medium",
    title: "Failed login attempts (5+)",
    source: "AUTH-SERVER",
    time: "32 min ago",
    status: "open",
  },
  {
    id: "ALT-004",
    severity: "high",
    title: "Suspicious PowerShell execution",
    source: "WS-ADM-003",
    time: "45 min ago",
    status: "resolved",
  },
  {
    id: "ALT-005",
    severity: "low",
    title: "Certificate expiring soon",
    source: "WEB-PORTAL",
    time: "1 hour ago",
    status: "open",
  },
];

const activityFeed = [
  { user: "Sarah Chen", action: "resolved alert ALT-1842", time: "5 min ago" },
  {
    user: "Mike Johnson",
    action: "escalated incident INC-294",
    time: "12 min ago",
  },
  {
    user: "System",
    action: "auto-blocked IP 192.168.1.45",
    time: "18 min ago",
  },
  {
    user: "Emily Brown",
    action: "added new detection rule",
    time: "25 min ago",
  },
  { user: "System", action: "completed scheduled scan", time: "30 min ago" },
];

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-orange-500 text-white";
    case "medium":
      return "bg-yellow-500 text-black";
    case "low":
      return "bg-blue-500 text-white";
    default:
      return "bg-gray-500 text-white";
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "open":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "investigating":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "resolved":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
};

export default function DashboardPage() {
  const { data: health, isLoading: healthLoading } = useConnectorHealth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Security Dashboard</h2>
          <p className="text-gray-500">
            Real-time threat monitoring and analysis
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Activity className="w-4 h-4 text-green-500" />
          Last updated: Just now
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Active Threats
            </CardTitle>
            <ShieldAlert className="w-5 h-5 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">24</div>
            <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3" />
              +12% from last hour
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Endpoints Protected
            </CardTitle>
            <Monitor className="w-5 h-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <>
                <Skeleton className="h-9 w-24 bg-white/10" />
                <Skeleton className="h-4 w-32 mt-1 bg-white/10" />
              </>
            ) : health ? (
              <>
                <div className="text-3xl font-bold text-white">
                  {health.total.toLocaleString()}
                </div>
                <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
                  <ShieldCheck className="w-3 h-3" />
                  {health.live.length} live &middot; {health.dead.length}{" "}
                  offline
                </p>
              </>
            ) : (
              <>
                <div className="text-3xl font-bold text-white">--</div>
                <p className="text-xs text-gray-500 mt-1">Unavailable</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Events Processed
            </CardTitle>
            <Zap className="w-5 h-5 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">2.4M</div>
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
              <Activity className="w-3 h-3" />
              Last 24 hours
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              MTTR
            </CardTitle>
            <Server className="w-5 h-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">18m</div>
            <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3 rotate-180" />
              -23% improvement
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alerts Table */}
        <Card className="lg:col-span-2 bg-[#12121a] border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white">Recent Alerts</CardTitle>
                <CardDescription className="text-gray-500">
                  Latest security events requiring attention
                </CardDescription>
              </div>
              {mounted ? (
                <Tabs defaultValue="all" className="w-auto">
                  <TabsList className="bg-white/5">
                    <TabsTrigger
                      value="all"
                      className="text-white data-[state=active]:bg-red-600 data-[state=active]:text-white text-xs"
                    >
                      All
                    </TabsTrigger>
                    <TabsTrigger
                      value="critical"
                      className="text-white data-[state=active]:bg-red-600 data-[state=active]:text-white text-xs"
                    >
                      Critical
                    </TabsTrigger>
                    <TabsTrigger
                      value="open"
                      className="text-white data-[state=active]:bg-red-600 data-[state=active]:text-white text-xs"
                    >
                      Open
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              ) : (
                <div className="inline-flex h-9 items-center justify-center rounded-lg bg-white/5 p-[3px]">
                  <span className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium bg-red-600 text-white">All</span>
                  <span className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-white">Critical</span>
                  <span className="inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-white">Open</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-gray-500">ID</TableHead>
                  <TableHead className="text-gray-500">Severity</TableHead>
                  <TableHead className="text-gray-500">Alert</TableHead>
                  <TableHead className="text-gray-500">Source</TableHead>
                  <TableHead className="text-gray-500">Time</TableHead>
                  <TableHead className="text-gray-500">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAlerts.map((alert) => (
                  <TableRow
                    key={alert.id}
                    className="border-white/10 hover:bg-white/5 cursor-pointer"
                  >
                    <TableCell className="font-mono text-sm text-gray-400">
                      {alert.id}
                    </TableCell>
                    <TableCell>
                      <Badge className={getSeverityColor(alert.severity)}>
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-white font-medium">
                      {alert.title}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-gray-400">
                      {alert.source}
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">
                      {alert.time}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={getStatusColor(alert.status)}
                      >
                        {alert.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Activity Feed</CardTitle>
            <CardDescription className="text-gray-500">
              Recent actions by team members
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activityFeed.map((activity, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 pb-4 border-b border-white/5 last:border-0 last:pb-0"
                >
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="bg-white/10 text-white text-xs">
                      {activity.user === "System" ? (
                        <Zap className="w-4 h-4" />
                      ) : (
                        activity.user
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">
                      <span className="font-medium">{activity.user}</span>{" "}
                      <span className="text-gray-400">{activity.action}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {activity.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Threat Map Placeholder */}
      <Card className="bg-[#12121a] border-white/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Global Threat Map</CardTitle>
              <CardDescription className="text-gray-500">
                Real-time attack origin visualization
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-gray-400">Active Attacks</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-gray-400">Blocked</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-gray-400">Protected</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64 rounded-lg bg-[#0a0a0f] border border-white/5 flex items-center justify-center">
            <div className="text-center">
              <Globe className="w-12 h-12 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500">Interactive threat map</p>
              <p className="text-xs text-gray-600">Visualization component</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
