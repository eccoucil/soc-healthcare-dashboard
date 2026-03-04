"use client";

import { Activity, Monitor, ShieldCheck, Zap } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectorHealth } from "@/hooks/use-arcsight";
import { motion } from "motion/react";

export default function DashboardPage() {
  const { data: health, isLoading: healthLoading } = useConnectorHealth();

  return (
    <div className="space-y-8">
      <div className="relative">
        <div className="absolute -left-4 top-0 bottom-0 w-1 bg-red-600 rounded-full" />
        <h2 className="text-4xl font-black tracking-tighter uppercase italic text-white">
          Security <span className="text-red-600">Overview</span>
        </h2>
        <p className="text-gray-500 font-mono text-[10px] tracking-[0.3em] uppercase mt-2">
          Real-time ArcSight ESM Node Telemetry
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { 
            title: "Total Connectors", 
            icon: Monitor, 
            color: "text-blue-500", 
            value: health?.total.toLocaleString() || "--",
            loading: healthLoading 
          },
          { 
            title: "Active Nodes", 
            icon: ShieldCheck, 
            color: "text-green-500", 
            value: health?.live.length || "--",
            loading: healthLoading,
            valueColor: "text-green-400"
          },
          { 
            title: "Offline Alerts", 
            icon: Activity, 
            color: "text-red-500", 
            value: health?.dead.length || "--",
            loading: healthLoading,
            valueColor: "text-red-400"
          }
        ].map((item, idx) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="bg-black/40 backdrop-blur-2xl border-white/5 hover:border-red-500/30 transition-all duration-500 group overflow-hidden relative">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <item.icon className="w-24 h-24 -mr-8 -mt-8" />
              </div>
              <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
                <CardTitle className="text-[10px] font-mono font-bold text-gray-500 uppercase tracking-[0.2em]">
                  {item.title}
                </CardTitle>
                <item.icon className={`w-5 h-5 ${item.color} shadow-[0_0_10px_currentColor] opacity-70`} />
              </CardHeader>
              <CardContent className="relative z-10">
                {item.loading ? (
                  <Skeleton className="h-10 w-24 bg-white/5" />
                ) : (
                  <div className={`text-4xl font-black tracking-tighter ${item.valueColor || "text-white"}`}>
                    {item.value}
                  </div>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <div className={`h-1 flex-1 rounded-full bg-white/5 overflow-hidden`}>
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      className={`h-full ${item.color.replace('text', 'bg')} opacity-50`}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-gray-600 uppercase tracking-tighter">Syncing...</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Large Featured Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="bg-black/60 backdrop-blur-3xl border-white/5 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-red-600/5 to-transparent" />
          <div className="p-8 relative z-10">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 rounded-2xl bg-red-600/10 border border-red-600/20 shadow-[0_0_15px_rgba(220,38,38,0.1)]">
                <Zap className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-xl font-black uppercase italic tracking-tight text-white">System Status: Tactical Ready</h3>
                <p className="text-xs text-gray-500 font-mono tracking-widest uppercase">All neural nodes synchronized</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em]">Sector 0{i}</div>
                  <div className="h-2 rounded-full bg-white/5 relative overflow-hidden">
                    <motion.div 
                      animate={{ 
                        width: ["20%", "80%", "40%", "90%"][i-1],
                        opacity: [0.5, 0.8, 0.5]
                      }}
                      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                      className="absolute inset-0 bg-red-600 shadow-[0_0_10px_#dc2626]" 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
