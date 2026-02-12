"use client";

import React, { useState, useMemo } from "react";
import { use } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CircleAlert,
  CircleCheck,
  CircleX,
  Link2,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  Server,
  Unlink,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectorWithDevices } from "@/types/arcsight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { mockCustomers } from "@/lib/mock-customers";
import {
  mockConnectorsWithDevices,
  mockAllConnectors,
} from "@/lib/mock-connectors";

function getStatusBadge(status?: string) {
  switch (status?.toUpperCase()) {
    case "RUNNING":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "STOPPED":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "PAUSED":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function formatTimestamp(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getHealthScore(c: ConnectorWithDevices): {
  label: string;
  color: string;
  dotColor: string;
  Icon: typeof CircleCheck;
} {
  const isCritical =
    c.alive === false ||
    c.operationalStatus === "STOPPED" ||
    (c.disabled && c.inactive);

  if (isCritical) {
    return {
      label: "Critical",
      color: "bg-red-500/20 text-red-400 border-red-500/30",
      dotColor: "bg-red-500",
      Icon: CircleX,
    };
  }

  const isWarning =
    c.disabled ||
    c.inactive ||
    c.operationalStatus === "PAUSED" ||
    c.operationalStatus === "UNKNOWN";

  if (isWarning) {
    return {
      label: "Warning",
      color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      dotColor: "bg-yellow-500",
      Icon: CircleAlert,
    };
  }

  return {
    label: "Healthy",
    color: "bg-green-500/20 text-green-400 border-green-500/30",
    dotColor: "bg-green-500",
    Icon: CircleCheck,
  };
}

function getGlowColor(label: string) {
  switch (label) {
    case "Critical":
      return {
        ring: "ring-red-500/60",
        ringHover: "hover:ring-red-400/80",
        ringSelected: "ring-red-500/80",
        glowVar: "rgba(239,68,68,0.35)",
        pingColor: "bg-red-500/40",
      };
    case "Warning":
      return {
        ring: "ring-yellow-500/60",
        ringHover: "hover:ring-yellow-400/80",
        ringSelected: "ring-yellow-500/80",
        glowVar: "rgba(234,179,8,0.35)",
        pingColor: "bg-yellow-500/40",
      };
    default:
      return {
        ring: "ring-green-500/60",
        ringHover: "hover:ring-green-400/80",
        ringSelected: "ring-green-500/80",
        glowVar: "rgba(34,197,94,0.35)",
        pingColor: "bg-green-500/40",
      };
  }
}

function ConnectorNode({
  connector,
  isSelected,
  onClick,
}: {
  connector: ConnectorWithDevices;
  isSelected: boolean;
  onClick: () => void;
}) {
  const health = getHealthScore(connector);
  const glow = getGlowColor(health.label);
  const HealthIcon = health.Icon;

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 group focus:outline-none"
    >
      {/* Circle container */}
      <div className="relative">
        {/* Alive pulse ring */}
        {connector.alive && (
          <div
            className={cn(
              "absolute inset-0 rounded-full animate-alive-ping",
              glow.pingColor
            )}
          />
        )}

        {/* Main circle */}
        <div
          className={cn(
            "relative w-20 h-20 rounded-full bg-[#1a1a28] flex flex-col items-center justify-center transition-all duration-200 ring-2",
            glow.ring,
            glow.ringHover,
            isSelected && [
              "ring-4 scale-110 animate-glow-throb",
              glow.ringSelected,
            ],
            !isSelected && "group-hover:scale-105 group-hover:ring-3"
          )}
          style={
            isSelected
              ? ({ "--glow-color": glow.glowVar } as React.CSSProperties)
              : undefined
          }
        >
          <Server className="w-5 h-5 text-gray-400 mb-0.5" />
          {connector.alive ? (
            <Wifi className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-red-400" />
          )}
        </div>

        {/* Health badge (top-right) */}
        <div
          className={cn(
            "absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border border-[#0a0a0f]",
            health.label === "Healthy" && "bg-green-500",
            health.label === "Warning" && "bg-yellow-500",
            health.label === "Critical" && "bg-red-500"
          )}
        >
          <HealthIcon className="w-3 h-3 text-white" />
        </div>
      </div>

      {/* Name */}
      <span className="text-xs text-gray-300 text-center max-w-[100px] line-clamp-2 leading-tight group-hover:text-white transition-colors">
        {connector.name}
      </span>

      {/* Status badge */}
      <Badge
        variant="outline"
        className={cn(
          "text-[10px] px-1.5 py-0",
          getStatusBadge(connector.operationalStatus)
        )}
      >
        {connector.operationalStatus ?? "UNKNOWN"}
      </Badge>
    </button>
  );
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [connectorSearch, setConnectorSearch] = useState("");
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(
    null
  );

  // API disabled — using mock data
  const customer = mockCustomers.find((c) => c.resourceId === id) ?? null;
  const customerLoading = false;
  const customerError = customer ? null : "Customer not found";
  const connectors = mockConnectorsWithDevices;
  const connectorsLoading = false;
  const connectorsError = null as string | null;
  const refetchConnectors = () => {};
  const allConnectors = mockAllConnectors;
  const linkConnector = {
    mutate: async (_ids: string[]) => {},
    isLoading: false,
    error: null as string | null,
  };
  const unlinkConnector = {
    mutate: async (_ids: string[]) => {},
    isLoading: false,
    error: null as string | null,
  };

  // Filter out already-linked connectors from the selection list
  const linkedIds = useMemo(
    () => new Set(connectors?.map((c) => c.resourceId) ?? []),
    [connectors]
  );

  const availableConnectors = useMemo(() => {
    if (!allConnectors) return [];
    const filtered = allConnectors.filter((c) => !linkedIds.has(c.resourceId));
    if (!connectorSearch) return filtered;
    const term = connectorSearch.toLowerCase();
    return filtered.filter(
      (c) =>
        c.name?.toLowerCase().includes(term) ||
        c.alias?.toLowerCase().includes(term)
    );
  }, [allConnectors, linkedIds, connectorSearch]);

  const selectedConnector = connectors?.find(
    (c) => c.resourceId === selectedConnectorId
  );

  function toggleSelection(resourceId: string) {
    setSelectedConnectorId((prev) => (prev === resourceId ? null : resourceId));
  }

  async function handleUnlink(connectorId: string) {
    try {
      await unlinkConnector.mutate([connectorId]);
      setSelectedConnectorId(null);
    } catch {
      // error state is in the hook
    }
  }

  return (
    <>
      {/* Back Navigation */}
      <Link
        href="/dashboard/customers"
        className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Customers
      </Link>

      {/* Customer Info Card */}
      {customerError ? (
        <Card className="bg-[#12121a] border-white/10">
          <CardContent className="py-12 text-center">
            <p className="text-red-400">{customerError}</p>
          </CardContent>
        </Card>
      ) : customerLoading ? (
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader>
            <Skeleton className="h-8 w-64 bg-white/10" />
            <Skeleton className="h-4 w-48 bg-white/10" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-5 w-full bg-white/10" />
              <Skeleton className="h-5 w-full bg-white/10" />
              <Skeleton className="h-5 w-full bg-white/10" />
              <Skeleton className="h-5 w-full bg-white/10" />
            </div>
          </CardContent>
        </Card>
      ) : customer ? (
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-white text-xl">
                  {customer.name}
                </CardTitle>
                <CardDescription className="text-gray-500">
                  {[
                    customer.alias && `Alias: ${customer.alias}`,
                    customer.externalID && `External ID: ${customer.externalID}`,
                  ]
                    .filter(Boolean)
                    .join(" | ") || "No additional identifiers"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {(customer.address ||
                customer.city ||
                customer.addressState ||
                customer.postalCode ||
                customer.country) && (
                <div className="flex items-start gap-2 text-gray-400">
                  <MapPin className="w-4 h-4 mt-0.5 text-gray-500 flex-shrink-0" />
                  <span>
                    {[
                      customer.address,
                      customer.city,
                      customer.addressState,
                      customer.postalCode,
                      customer.country,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-gray-400">
                <Calendar className="w-4 h-4 text-gray-500" />
                <span>
                  Created: {formatTimestamp(customer.createdTimestamp)} |
                  Modified: {formatTimestamp(customer.modifiedTimestamp)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Connectors & Devices */}
      <Card className="bg-[#12121a] border-white/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">
                Connectors &amp; Devices
              </CardTitle>
              <CardDescription className="text-gray-500">
                Infrastructure agents and their monitored devices
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => setSheetOpen(true)}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                <Link2 className="w-4 h-4 mr-2" />
                Link Connector
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={refetchConnectors}
                className="text-gray-400 hover:text-white"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {unlinkConnector.error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              Unlink failed: {unlinkConnector.error}
            </div>
          )}
          {connectorsError ? (
            <div className="text-center py-12">
              <p className="text-red-400 mb-3">{connectorsError}</p>
              <Button
                variant="outline"
                onClick={refetchConnectors}
                className="border-white/10 text-gray-300 hover:bg-white/5"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          ) : connectorsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full bg-white/10" />
              ))}
            </div>
          ) : connectors && connectors.length > 0 ? (
            <div className="space-y-6">
              {/* Circular Node Grid */}
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-6 justify-items-center py-4">
                {connectors.map((connector) => (
                  <ConnectorNode
                    key={connector.resourceId}
                    connector={connector}
                    isSelected={selectedConnectorId === connector.resourceId}
                    onClick={() => toggleSelection(connector.resourceId)}
                  />
                ))}
              </div>

              {/* Inline Detail Panel */}
              <AnimatePresence mode="wait">
                {selectedConnector && (
                  <motion.div
                    key={selectedConnectorId}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
                      {/* Header: Name + Unlink */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Server className="w-5 h-5 text-gray-400" />
                          <div>
                            <h3 className="text-white font-medium">
                              {selectedConnector.name}
                            </h3>
                            {selectedConnector.alias && (
                              <p className="text-xs text-gray-500">
                                {selectedConnector.alias}
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-500 hover:text-red-400"
                          disabled={unlinkConnector.isLoading}
                          onClick={() =>
                            handleUnlink(selectedConnector.resourceId)
                          }
                        >
                          <Unlink className="w-3.5 h-3.5 mr-1.5" />
                          Unlink
                        </Button>
                      </div>

                      {/* 2-column detail grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Left: Health Status */}
                        <div className="space-y-3">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Health Status
                          </p>
                          {(() => {
                            const health = getHealthScore(selectedConnector);
                            const HealthIcon = health.Icon;
                            return (
                              <div className="space-y-2.5">
                                <Badge
                                  variant="outline"
                                  className={`${health.color} gap-1.5`}
                                >
                                  <HealthIcon className="w-3.5 h-3.5" />
                                  {health.label}
                                </Badge>
                                <div className="text-sm space-y-1">
                                  {selectedConnector.owningServer && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-gray-500 w-16">
                                        Server
                                      </span>
                                      <span className="text-gray-300 font-mono text-xs">
                                        {selectedConnector.owningServer}
                                      </span>
                                    </div>
                                  )}
                                  {selectedConnector.networks &&
                                    selectedConnector.networks.length > 0 && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-500 w-16">
                                          Networks
                                        </span>
                                        <span className="text-gray-300 text-xs">
                                          {selectedConnector.networks.join(
                                            ", "
                                          )}
                                        </span>
                                      </div>
                                    )}
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-500 w-16">
                                      Disabled
                                    </span>
                                    {selectedConnector.disabled ? (
                                      <span className="text-amber-400">
                                        Yes —{" "}
                                        {selectedConnector.disabledReason ??
                                          "No reason provided"}
                                      </span>
                                    ) : (
                                      <span className="text-gray-600">No</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-500 w-16">
                                      Inactive
                                    </span>
                                    {selectedConnector.inactive ? (
                                      <span className="text-amber-400">
                                        Yes —{" "}
                                        {selectedConnector.inactiveReason ??
                                          "No reason provided"}
                                      </span>
                                    ) : (
                                      <span className="text-gray-600">No</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Right: Reported Devices */}
                        <div className="space-y-3">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Reported Devices
                          </p>
                          {selectedConnector.devices.length > 0 ? (
                            <div className="space-y-1.5">
                              {selectedConnector.devices.map((device, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-3 text-sm"
                                >
                                  <span className="text-white font-medium">
                                    {device.deviceVendor}
                                  </span>
                                  <span className="text-gray-500">/</span>
                                  <span className="text-gray-300">
                                    {device.deviceProduct}
                                  </span>
                                  {device.deviceVersion && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs bg-white/5 text-gray-400 border-white/10"
                                    >
                                      v{device.deviceVersion}
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-600">
                              No devices reported
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Server className="w-8 h-8 mx-auto mb-3 text-gray-600" />
              <p>No connectors linked to this customer</p>
              <p className="text-sm mt-1">
                Use &quot;Link Connector&quot; to associate infrastructure
                agents
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Link Connector Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="bg-[#12121a] border-white/10 w-[420px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="text-white">Link Connector</SheetTitle>
            <SheetDescription className="text-gray-500">
              Select a connector to associate with{" "}
              {customer?.name ?? "this customer"}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                placeholder="Search connectors..."
                value={connectorSearch}
                onChange={(e) => setConnectorSearch(e.target.value)}
                className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-500"
              />
            </div>

            {/* Error */}
            {linkConnector.error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {linkConnector.error}
              </div>
            )}

            {/* Connector List */}
            <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
              {!allConnectors ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full bg-white/10" />
                  ))}
                </div>
              ) : availableConnectors.length > 0 ? (
                availableConnectors.map((connector) => (
                  <button
                    key={connector.resourceId}
                    className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors text-left group"
                    disabled={linkConnector.isLoading}
                    onClick={async () => {
                      try {
                        await linkConnector.mutate([connector.resourceId]);
                      } catch {
                        // error shown inline
                      }
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Server className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">
                          {connector.name}
                        </p>
                        {connector.alias && (
                          <p className="text-xs text-gray-500 truncate">
                            {connector.alias}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {connector.alive ? (
                        <Wifi className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <WifiOff className="w-3.5 h-3.5 text-red-400" />
                      )}
                      {linkConnector.isLoading ? (
                        <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                      ) : (
                        <Link2 className="w-4 h-4 text-gray-600 group-hover:text-white transition-colors" />
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500 text-sm">
                  {connectorSearch
                    ? `No connectors matching "${connectorSearch}"`
                    : "All connectors are already linked"}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
