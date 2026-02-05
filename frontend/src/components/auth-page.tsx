"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  Shield,
  ArrowRight,
  Activity,
  Server,
  Globe,
  CheckCircle,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  validatePassword,
  passwordsMatch,
  type PasswordStrength,
  type PasswordRequirements,
} from "@/lib/password-validation";

const WHITELISTED_DOMAINS = ["@eccouncil.org"];

export const AuthPage = () => {
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null);
  const [passwordRequirements, setPasswordRequirements] = useState<PasswordRequirements | null>(null);

  // Toggle dark mode class on html/body
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Real-time password validation for registration
  useEffect(() => {
    if (registerPassword) {
      const validation = validatePassword(registerPassword);
      setPasswordStrength(validation.strength);
      setPasswordRequirements(validation.requirements);
    } else {
      setPasswordStrength(null);
      setPasswordRequirements(null);
    }
  }, [registerPassword]);

  const isValidEmailDomain = (email: string): boolean => {
    return WHITELISTED_DOMAINS.some((domain) =>
      email.toLowerCase().endsWith(domain)
    );
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmailDomain(loginEmail)) {
      toast.error("Invalid email domain", {
        description: "Only @eccouncil.org email addresses are allowed.",
      });
      return;
    }

    // Full password validation (same as registration)
    const validation = validatePassword(loginPassword);

    if (validation.hasDangerousPatterns) {
      toast.error("Invalid password", {
        description: "Password contains invalid characters.",
      });
      return;
    }

    if (validation.isCommonPassword) {
      toast.error("Weak password", {
        description: "This password is too common.",
      });
      return;
    }

    if (validation.errors.length > 0) {
      toast.error("Password does not meet requirements", {
        description: validation.errors[0],
      });
      return;
    }

    setIsLoading(true);
    // Simulate API call and redirect to dashboard
    setTimeout(() => {
      setIsLoading(false);
      toast.success("Login successful", {
        description: "Redirecting to dashboard...",
      });
      router.push("/dashboard");
    }, 1500);
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmailDomain(registerEmail)) {
      toast.error("Invalid email domain", {
        description: "Only @eccouncil.org email addresses are allowed.",
      });
      return;
    }

    // Full password validation for registration
    const validation = validatePassword(registerPassword);

    if (validation.hasDangerousPatterns) {
      toast.error("Invalid password", {
        description: "Password contains invalid characters.",
      });
      return;
    }

    if (validation.isCommonPassword) {
      toast.error("Weak password", {
        description: "This password is too common. Please choose a stronger password.",
      });
      return;
    }

    if (validation.errors.length > 0) {
      toast.error("Password does not meet requirements", {
        description: validation.errors[0],
      });
      return;
    }

    if (validation.strength === 'weak') {
      toast.error("Weak password", {
        description: "Please choose a stronger password.",
      });
      return;
    }

    // Check password confirmation
    if (!passwordsMatch(registerPassword, confirmPassword)) {
      toast.error("Passwords do not match", {
        description: "Please ensure both passwords are identical.",
      });
      return;
    }

    setIsLoading(true);
    // Simulate API call and redirect to dashboard
    setTimeout(() => {
      setIsLoading(false);
      toast.success("Account created", {
        description: "Redirecting to dashboard...",
      });
      router.push("/dashboard");
    }, 1500);
  };

  return (
    <div
      className={`relative min-h-screen w-full grid lg:grid-cols-2 transition-colors duration-300 ${isDarkMode ? "text-white" : "text-gray-900"}`}
    >
      {/* Full Screen Background Image */}
      <div className="fixed inset-0 z-0">
        <Image
          src="/soc-auth.png"
          alt="SOC Background"
          fill
          className="object-cover"
          priority
        />
        {/* Dark overlay for better readability */}
        <div className="absolute inset-0 bg-black/60" />
      </div>

      {/* Left Column - Visual/Image Area */}
      <div className="relative z-10 hidden lg:flex flex-col justify-between p-12 overflow-hidden">

        {/* Content Overlay */}
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-red-500 mb-6">
            <Activity className="h-6 w-6 animate-pulse" />
            <span className="font-mono text-sm tracking-widest uppercase">
              System Status: Secure
            </span>
          </div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-5xl font-bold tracking-tighter mb-4 text-white">
              Global Threat <br />
              <span className="text-red-500">Intelligence Center</span>
            </h1>
            <p className="text-gray-400 max-w-md text-lg">
              Advanced telemetry and real-time threat detection for the modern
              enterprise ecosystem.
            </p>
          </motion.div>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-4 mt-auto">
          <div className="p-4 rounded-lg bg-white/5 backdrop-blur border border-white/10">
            <Server className="h-8 w-8 text-red-500 mb-2" />
            <div className="text-2xl font-mono font-bold text-white">99.9%</div>
            <div className="text-xs text-gray-400 uppercase tracking-wider">
              Uptime
            </div>
          </div>
          <div className="p-4 rounded-lg bg-white/5 backdrop-blur border border-white/10">
            <Globe className="h-8 w-8 text-red-500 mb-2" />
            <div className="text-2xl font-mono font-bold text-white">142</div>
            <div className="text-xs text-gray-400 uppercase tracking-wider">
              Nodes Active
            </div>
          </div>
        </div>
      </div>

      {/* Right Column - Forms */}
      <div className="relative z-10 flex items-center justify-center p-4 lg:p-12 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md relative z-10"
        >
          <div className="mb-8 text-center lg:text-left">
            <div
              className={`inline-flex items-center justify-center p-3 rounded-full border-2 mb-4 ${isDarkMode ? "bg-black border-red-500 text-red-500" : "bg-white border-red-600 text-red-600"}`}
            >
              <Shield className="w-8 h-8" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight">Welcome Back</h2>
            <p className="text-muted-foreground mt-2">
              Enter your credentials to access the SOC Dashboard.
            </p>
          </div>

          <Card className={`border-0 shadow-none bg-transparent`}>
            <CardContent className="p-0">
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-8 bg-gray-800/50 p-1">
                  <TabsTrigger
                    value="login"
                    className="data-[state=active]:!bg-red-600 data-[state=active]:!text-white data-[state=inactive]:!bg-transparent data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-white transition-all"
                  >
                    Login
                  </TabsTrigger>
                  <TabsTrigger
                    value="register"
                    className="data-[state=active]:!bg-red-600 data-[state=active]:!text-white data-[state=inactive]:!bg-transparent data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-white transition-all"
                  >
                    Register
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="email"
                          placeholder="analyst@eccouncil.org"
                          type="email"
                          autoComplete="off"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          className={`pl-10 h-11 ${isDarkMode ? "bg-gray-900/50 border-gray-800 focus:border-red-500" : "bg-white border-gray-200 focus:border-red-500"}`}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          autoComplete="off"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className={`pl-10 pr-10 h-11 ${isDarkMode ? "bg-gray-900/50 border-gray-800 focus:border-red-500" : "bg-white border-gray-200 focus:border-red-500"}`}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="remember"
                          className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <label
                          htmlFor="remember"
                          className="text-muted-foreground cursor-pointer"
                        >
                          Remember me
                        </label>
                      </div>
                      <a
                        href="#"
                        className="text-red-500 hover:text-red-400 font-medium transition-colors"
                      >
                        Forgot password?
                      </a>
                    </div>

                    <Button
                      type="submit"
                      className={`w-full h-11 text-base group ${isDarkMode ? "bg-red-600 hover:bg-red-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        "Authenticating..."
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          Access Dashboard{" "}
                          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </span>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register">
                  <form onSubmit={handleRegisterSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First Name</Label>
                        <Input
                          id="firstName"
                          placeholder="John"
                          autoComplete="off"
                          className={`h-11 ${isDarkMode ? "bg-gray-900/50 border-gray-800 focus:border-red-500" : "bg-white border-gray-200 focus:border-red-500"}`}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name</Label>
                        <Input
                          id="lastName"
                          placeholder="Doe"
                          autoComplete="off"
                          className={`h-11 ${isDarkMode ? "bg-gray-900/50 border-gray-800 focus:border-red-500" : "bg-white border-gray-200 focus:border-red-500"}`}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-email">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reg-email"
                          type="email"
                          placeholder="analyst@eccouncil.org"
                          autoComplete="off"
                          value={registerEmail}
                          onChange={(e) => setRegisterEmail(e.target.value)}
                          className={`pl-10 h-11 ${isDarkMode ? "bg-gray-900/50 border-gray-800 focus:border-red-500" : "bg-white border-gray-200 focus:border-red-500"}`}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reg-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="off"
                          value={registerPassword}
                          onChange={(e) => setRegisterPassword(e.target.value)}
                          className={`pl-10 pr-10 h-11 ${isDarkMode ? "bg-gray-900/50 border-gray-800 focus:border-red-500" : "bg-white border-gray-200 focus:border-red-500"}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      {/* Password Strength Indicator */}
                      {registerPassword && (
                        <div className="space-y-2 mt-2">
                          {/* Strength Bar */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  passwordStrength === 'weak' ? 'w-1/3 bg-red-500' :
                                  passwordStrength === 'medium' ? 'w-2/3 bg-yellow-500' :
                                  passwordStrength === 'strong' ? 'w-full bg-green-500' : 'w-0'
                                }`}
                              />
                            </div>
                            <span className={`text-xs font-medium ${
                              passwordStrength === 'weak' ? 'text-red-500' :
                              passwordStrength === 'medium' ? 'text-yellow-500' :
                              passwordStrength === 'strong' ? 'text-green-500' : 'text-gray-500'
                            }`}>
                              {passwordStrength ? passwordStrength.charAt(0).toUpperCase() + passwordStrength.slice(1) : ''}
                            </span>
                          </div>

                          {/* Requirements Checklist */}
                          {passwordRequirements && (
                            <div className="grid grid-cols-2 gap-1 text-xs">
                              <div className={`flex items-center gap-1 ${passwordRequirements.minLength ? 'text-green-500' : 'text-gray-500'}`}>
                                {passwordRequirements.minLength ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                8+ characters
                              </div>
                              <div className={`flex items-center gap-1 ${passwordRequirements.hasUppercase ? 'text-green-500' : 'text-gray-500'}`}>
                                {passwordRequirements.hasUppercase ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                Uppercase (A-Z)
                              </div>
                              <div className={`flex items-center gap-1 ${passwordRequirements.hasLowercase ? 'text-green-500' : 'text-gray-500'}`}>
                                {passwordRequirements.hasLowercase ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                Lowercase (a-z)
                              </div>
                              <div className={`flex items-center gap-1 ${passwordRequirements.hasNumber ? 'text-green-500' : 'text-gray-500'}`}>
                                {passwordRequirements.hasNumber ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                Number (0-9)
                              </div>
                              <div className={`flex items-center gap-1 ${passwordRequirements.hasSpecialChar ? 'text-green-500' : 'text-gray-500'}`}>
                                {passwordRequirements.hasSpecialChar ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                Special char
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Confirm Password Field */}
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">Confirm Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="confirm-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="off"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className={`pl-10 pr-10 h-11 ${isDarkMode ? "bg-gray-900/50 border-gray-800 focus:border-red-500" : "bg-white border-gray-200 focus:border-red-500"}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {/* Password mismatch indicator */}
                      {confirmPassword && registerPassword && !passwordsMatch(registerPassword, confirmPassword) && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <Circle className="h-3 w-3" />
                          Passwords do not match
                        </p>
                      )}
                      {confirmPassword && registerPassword && passwordsMatch(registerPassword, confirmPassword) && (
                        <p className="text-xs text-green-500 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Passwords match
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="role">SOC Role</Label>
                      <select
                        id="role"
                        className={`w-full h-11 px-3 rounded-md text-sm border focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent ${isDarkMode ? "bg-gray-900/50 border-gray-800 text-white" : "bg-white border-gray-200 text-gray-900"}`}
                      >
                        <option value="analyst_l1">L1 SOC Analyst</option>
                        <option value="analyst_l2">L2 SOC Analyst</option>
                        <option value="incident_responder">
                          Incident Responder
                        </option>
                        <option value="threat_hunter">Threat Hunter</option>
                        <option value="soc_manager">SOC Manager</option>
                      </select>
                    </div>

                    <Button
                      type="submit"
                      className={`w-full h-11 text-base group ${isDarkMode ? "bg-red-600 hover:bg-red-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}`}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        "Creating Account..."
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          Register Analyst <User className="w-4 h-4" />
                        </span>
                      )}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
            <CardFooter className="flex flex-col space-y-2 text-center text-xs text-muted-foreground p-0 mt-8">
              <p>ECC SOC Dashboard v2.4.0</p>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </div>
  );
};
