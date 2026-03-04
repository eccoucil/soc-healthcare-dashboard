"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Building2,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";

import { MatrixBackground } from "@/components/matrix-background";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Building2, label: "Clients", href: "/dashboard/clients" },
  { icon: Activity, label: "Devices", href: "/dashboard/devices" },
  { icon: FileText, label: "Reports", href: "/dashboard/reports" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration guard for Radix useId()
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/auth/session")
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) setUsername(data.username);
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort
    }
    router.push("/");
  };

  return (
    <div className="h-screen bg-[#050505] text-white flex overflow-hidden relative">
      {/* Three.js Matrix Background for Dashboard */}
      <div className="fixed inset-0 z-0">
        <MatrixBackground color="#660000" opacity={0.2} />
        <div className="absolute inset-0 bg-black/80" />
      </div>

      {/* Sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? "w-20" : "w-72"
        } bg-black/40 backdrop-blur-3xl border-r border-white/5 flex flex-col transition-all duration-500 relative z-10`}
      >
        {/* Logo */}
        <div className="h-24 px-6 border-b border-white/5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600 to-red-900 flex items-center justify-center shadow-[0_0_20px_rgba(220,38,38,0.3)] border border-white/10">
            <Shield className="w-6 h-6 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="animate-in fade-in slide-in-from-left-4 duration-500">
              <h1 className="font-black text-xl tracking-tighter uppercase italic">ECC-SOC 24/7</h1>
              <p className="text-[10px] text-red-500/70 font-mono tracking-[0.2em] uppercase">Security Operations</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-6 space-y-3">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`w-full group flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 relative overflow-hidden ${
                  isActive
                    ? "bg-red-600 text-white shadow-[0_0_20px_rgba(220,38,38,0.2)]"
                    : "text-gray-500 hover:text-white hover:bg-white/5"
                }`}
              >
                {isActive && (
                   <motion.div 
                    layoutId="active-nav"
                    className="absolute inset-0 bg-gradient-to-r from-red-600 to-red-500 z-0" 
                   />
                )}
                <item.icon className={`w-5 h-5 flex-shrink-0 z-10 transition-transform duration-300 ${isActive ? "scale-110" : "group-hover:scale-110"}`} />
                {!sidebarCollapsed && (
                  <span className="flex-1 text-sm font-bold uppercase tracking-widest z-10">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse Button */}
        <div className="p-6 border-t border-white/5">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full h-12 flex items-center justify-center gap-3 rounded-xl border border-white/5 bg-white/5 text-gray-500 hover:text-white hover:bg-white/10 transition-all duration-300"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-500 ${
                sidebarCollapsed ? "rotate-90" : "-rotate-90"
              }`}
            />
            {!sidebarCollapsed && <span className="text-xs uppercase tracking-[0.2em] font-mono">Retract</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Header */}
        <header className="h-20 flex-shrink-0 bg-black/20 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-8">
          <div className="flex items-center gap-6">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-red-500 transition-colors" />
              <Input
                placeholder="INTEL SEARCH..."
                className="w-96 h-11 pl-12 bg-white/5 border-white/5 text-white placeholder:text-gray-600 rounded-xl focus:border-red-500/50 focus:ring-red-500/20 transition-all font-mono text-xs tracking-widest"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* System Status */}
            <div className="hidden lg:flex items-center gap-3 px-4 py-2 bg-red-500/5 border border-red-500/10 rounded-xl">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              <span className="text-[10px] text-red-500 font-mono tracking-widest uppercase">
                Grid: Active
              </span>
            </div>

            {/* Notifications */}
            <Button variant="ghost" size="icon" className="relative h-11 w-11 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10">
              <Bell className="w-5 h-5 text-gray-400" />
              <span className="absolute top-3 right-3 w-2 h-2 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
            </Button>

            {/* User Menu */}
            {mounted && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-4 bg-white/5 border border-white/5 hover:bg-white/10 rounded-2xl p-1.5 pr-4 transition-all group">
                    <Avatar className="w-10 h-10 rounded-xl border border-white/10 group-hover:border-red-500/50 transition-colors">
                      <AvatarImage src="" />
                      <AvatarFallback className="bg-gradient-to-br from-red-600 to-red-900 text-white font-black text-xs">
                        {username ? username.slice(0, 2).toUpperCase() : "OP"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-left hidden xl:block">
                      <p className="text-xs font-black uppercase tracking-widest">{username ?? "Operator"}</p>
                      <p className="text-[10px] text-gray-500 font-mono tracking-tighter uppercase">ESM Session</p>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-600 group-hover:text-white transition-colors" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56 bg-black/90 backdrop-blur-2xl border-white/10 rounded-2xl p-2"
                >
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.2em] text-gray-500 px-3 py-2">
                    Access Profile
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/5" />
                  <DropdownMenuItem className="rounded-xl py-3 text-gray-300 focus:bg-white/10 focus:text-white cursor-pointer">
                    <Settings className="w-4 h-4 mr-3 text-red-500" />
                    <span className="text-xs font-bold uppercase tracking-widest">Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={handleLogout}
                    className="rounded-xl py-3 text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 mr-3" />
                    <span className="text-xs font-bold uppercase tracking-widest">Terminate Session</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-8 space-y-8 relative">
          {/* Subtle noise texture overlay */}
          <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] z-50" />
          {children}
        </div>
      </main>
    </div>
  );
}
