"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Lock,
  User,
  Shield,
  ArrowRight,
  Activity,
  Server,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MatrixBackground } from "@/components/matrix-background";
import {
  containsDangerousPatterns,
  sanitizePassword,
} from "@/lib/password-validation";

export const AuthPage = () => {
  const router = useRouter();
  const isDarkMode = true;
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Toggle dark mode class on html/body
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error("Username required");
      return;
    }
    if (containsDangerousPatterns(loginPassword)) {
      toast.error("Invalid password", { description: "Password contains invalid characters." });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password: sanitizePassword(loginPassword) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Login failed", { description: data.error ?? "Invalid credentials" });
        return;
      }
      toast.success("Login successful", { description: "Redirecting to dashboard..." });
      router.push("/dashboard");
    } catch {
      toast.error("Login failed", { description: "Network error. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`relative min-h-screen w-full grid lg:grid-cols-2 bg-[#050505] transition-colors duration-300 ${isDarkMode ? "text-white" : "text-gray-900"}`}
    >
      {/* Three.js Matrix Background */}
      <div className="fixed inset-0 z-0">
        <MatrixBackground />
        {/* Gradients for depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black/80" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-black/80" />
      </div>

      {/* Left Column - Visual/Image Area */}
      <div className="relative z-10 hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-white/5">
        {/* Futuristic Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,black_70%,transparent_100%)]" />

        {/* Content Overlay */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-red-500 mb-6 bg-red-500/10 w-fit px-3 py-1 rounded-full border border-red-500/20 backdrop-blur-sm">
            <Activity className="h-4 w-4 animate-pulse" />
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase">
              Neural Link: Established
            </span>
          </div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-6xl font-black tracking-tighter mb-4 text-white uppercase italic">
              ECC-SOC <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-red-400">24/7</span>
            </h1>
            <p className="text-gray-400 max-w-sm text-sm font-mono leading-relaxed border-l-2 border-red-600 pl-4 py-1">
              Decentralized cybersecurity intelligence. Monitor, detect, and neutralize threats in zero-latency environments.
            </p>
          </motion.div>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-4 mt-auto">
          <div className="p-6 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10 group hover:border-red-500/50 transition-all duration-500">
            <Server className="h-6 w-6 text-red-500 mb-4 group-hover:scale-110 transition-transform" />
            <div className="text-3xl font-mono font-bold text-white tracking-tighter">--</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Active Clusters</div>
          </div>
          <div className="p-6 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10 group hover:border-red-500/50 transition-all duration-500">
            <Globe className="h-6 w-6 text-red-500 mb-4 group-hover:scale-110 transition-transform" />
            <div className="text-3xl font-mono font-bold text-white tracking-tighter">--</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">Uplink Nodes</div>
          </div>
        </div>
      </div>

      {/* Right Column - Form */}
      <div className="relative z-10 flex items-center justify-center p-4 lg:p-12 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="w-full max-w-md relative"
        >
          {/* Decorative elements for the form */}
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-red-600/10 blur-[80px] rounded-full" />
          <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-red-600/10 blur-[80px] rounded-full" />

          <div className="mb-8 text-center lg:text-left relative z-10">
            <div
              className={`inline-flex items-center justify-center p-4 rounded-2xl border mb-6 bg-black/40 backdrop-blur-xl border-white/10 shadow-[0_0_20px_rgba(220,38,38,0.1)]`}
            >
              <Shield className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-4xl font-bold tracking-tight text-white mb-2 italic uppercase">System Access</h2>
            <p className="text-gray-400 font-mono text-xs tracking-tight">
              PROCEED WITH AUTHORIZED CREDENTIALS ONLY
            </p>
          </div>

          <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10">
            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-[10px] uppercase tracking-widest text-gray-400 ml-1">Operator ID</Label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500/50" />
                  <Input
                    id="username"
                    placeholder="operator_id"
                    type="text"
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="pl-12 h-12 bg-white/5 border-white/10 focus:border-red-500/50 focus:ring-red-500/20 rounded-xl transition-all font-mono text-sm"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[10px] uppercase tracking-widest text-gray-400 ml-1">Access Cipher</Label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500/50" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="off"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-12 pr-12 h-12 bg-white/5 border-white/10 focus:border-red-500/50 focus:ring-red-500/20 rounded-xl transition-all font-mono text-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] uppercase tracking-tighter">
                <label className="flex items-center gap-2 text-gray-500 cursor-pointer group">
                  <input type="checkbox" className="rounded border-white/10 bg-white/5 text-red-600 focus:ring-red-500/20" />
                  <span className="group-hover:text-gray-300">Maintain Session</span>
                </label>
                <a href="#" className="text-red-500 hover:text-red-400 font-bold transition-colors">Recover Access</a>
              </div>

              <Button
                type="submit"
                className="w-full h-12 bg-red-600 hover:bg-red-500 text-white rounded-xl shadow-[0_0_20px_rgba(220,38,38,0.2)] group relative overflow-hidden transition-all duration-300"
                disabled={isLoading}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                {isLoading ? (
                  <span className="font-mono text-xs uppercase tracking-widest">Decrypting...</span>
                ) : (
                  <span className="flex items-center justify-center gap-2 font-bold uppercase tracking-widest text-xs">
                    Initialize Session <ArrowRight className="w-4 h-4" />
                  </span>
                )}
              </Button>
            </form>
          </div>

          <div className="mt-8 text-center">
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.3em]">
              ECC-SOC 24/7 Dashboard <span className="text-red-900">v4.0.0</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
