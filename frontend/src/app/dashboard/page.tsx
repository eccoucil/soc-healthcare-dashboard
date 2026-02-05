"use client";

import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronDown,
  FileText,
  Globe,
  LayoutDashboard,
  LogOut,
  Monitor,
  Search,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: ShieldAlert, label: "Alerts", badge: 12 },
  { icon: Monitor, label: "Endpoints" },
  { icon: Globe, label: "Network" },
  { icon: FileText, label: "Reports" },
  { icon: Users, label: "Users" },
  { icon: Settings, label: "Settings" },
];

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
  { user: "Mike Johnson", action: "escalated incident INC-294", time: "12 min ago" },
  { user: "System", action: "auto-blocked IP 192.168.1.45", time: "18 min ago" },
  { user: "Emily Brown", action: "added new detection rule", time: "25 min ago" },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="h-screen bg-[#0a0a0f] text-white flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? "w-16" : "w-64"
        } bg-[#12121a] border-r border-white/10 flex flex-col transition-all duration-300`}
      >
        {/* Logo */}
        <div className="h-16 px-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-600 flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div>
              <h1 className="font-bold text-lg">ECC SOC</h1>
              <p className="text-xs text-gray-500">Security Operations</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.label}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                item.active
                  ? "bg-red-600 text-white"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          ))}
        </nav>

        {/* Collapse Button */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-gray-400 hover:text-white transition-colors"
          >
            <ChevronDown
              className={`w-5 h-5 transition-transform ${
                sidebarCollapsed ? "rotate-90" : "-rotate-90"
              }`}
            />
            {!sidebarCollapsed && <span className="text-sm">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 flex-shrink-0 bg-[#12121a] border-b border-white/10 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                placeholder="Search alerts, endpoints, users..."
                className="w-80 pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* System Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">All Systems Operational</span>
            </div>

            {/* Notifications */}
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5 text-gray-400" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </Button>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 hover:bg-white/5 rounded-lg px-2 py-1.5 transition-colors">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src="" />
                    <AvatarFallback className="bg-red-600 text-white text-sm">SC</AvatarFallback>
                  </Avatar>
                  <div className="text-left hidden md:block">
                    <p className="text-sm font-medium">Sarah Chen</p>
                    <p className="text-xs text-gray-500">SOC Analyst L2</p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-[#1a1a24] border-white/10">
                <DropdownMenuLabel className="text-gray-400">My Account</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem className="text-gray-300 focus:bg-white/10 focus:text-white">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem className="text-red-400 focus:bg-red-500/10 focus:text-red-400">
                  <LogOut className="w-4 h-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Page Title */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Security Dashboard</h2>
              <p className="text-gray-500">Real-time threat monitoring and analysis</p>
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
                <div className="text-3xl font-bold text-white">1,842</div>
                <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
                  <ShieldCheck className="w-3 h-3" />
                  99.2% healthy
                </p>
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
        </div>
      </main>
    </div>
  );
}
