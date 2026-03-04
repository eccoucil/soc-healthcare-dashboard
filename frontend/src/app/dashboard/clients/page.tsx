"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  FolderTree,
  MapPin,
  RefreshCw,
  Search,
  Server,
  TriangleAlert,
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
import { Skeleton } from "@/components/ui/skeleton";
import { useClients, useConnectorHealth } from "@/hooks/use-arcsight";
import type { Client } from "@/types/arcsight";
import { motion } from "motion/react";

type SortKey = "name" | "alias" | "location" | "externalID";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 5;

function formatLocation(c: {
  city?: string;
  addressState?: string;
  country?: string;
}) {
  const parts = [c.city, c.addressState, c.country].filter(Boolean);
  return parts.join(", ") || "—";
}

function getLocationString(c: Client): string {
  return formatLocation(c);
}

function getSortValue(client: Client, key: SortKey): string {
  switch (key) {
    case "name":
      return client.name;
    case "alias":
      return client.alias ?? "";
    case "location":
      return getLocationString(client);
    case "externalID":
      return client.externalID ?? "";
  }
}

function SortIcon({
  column,
  activeKey,
  activeDir,
}: {
  column: SortKey;
  activeKey: SortKey;
  activeDir: SortDir;
}) {
  if (column !== activeKey) {
    return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
  }
  return activeDir === "asc" ? (
    <ArrowUp className="w-3.5 h-3.5 ml-1 text-red-500" />
  ) : (
    <ArrowDown className="w-3.5 h-3.5 ml-1 text-red-500" />
  );
}

export default function ClientsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [currentPage, setCurrentPage] = useState(1);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset to page 1 when search or sort changes (adjust state during render)
  const pageResetKey = `${debouncedSearch}\0${sortKey}\0${sortDir}`;
  const [prevPageResetKey, setPrevPageResetKey] = useState(pageResetKey);
  if (pageResetKey !== prevPageResetKey) {
    setPrevPageResetKey(pageResetKey);
    setCurrentPage(1);
  }

  const { data: clients, isLoading, error, refetch } = useClients(debouncedSearch);
  const { data: health } = useConnectorHealth();

  const displayData = useMemo<Client[]>(() => clients ?? [], [clients]);

  // Filter → Sort → Paginate pipeline
  const filtered = useMemo(() => {
    if (!debouncedSearch) return displayData;
    const q = debouncedSearch.toLowerCase();
    return displayData.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.alias?.toLowerCase().includes(q) ||
        c.externalID?.toLowerCase().includes(q) ||
        getLocationString(c).toLowerCase().includes(q)
    );
  }, [displayData, debouncedSearch]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      const cmp = aVal.localeCompare(bVal, undefined, {
        sensitivity: "base",
      });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, currentPage]);

  const clientsWithLocation = displayData.filter(
    (c) => c.city || c.country
  ).length;

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="relative">
          <div className="absolute -left-4 top-0 bottom-0 w-1 bg-red-600 rounded-full" />
          <h2 className="text-4xl font-black tracking-tighter uppercase italic text-white">
            Client <span className="text-red-600">Database</span>
          </h2>
          <p className="text-gray-500 font-mono text-[10px] tracking-[0.3em] uppercase mt-2">
            Centralized Entity Management
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-red-500 transition-colors" />
            <Input
              placeholder="SEARCH ENTITIES..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-80 h-11 pl-12 bg-white/5 border-white/5 text-white placeholder:text-gray-600 rounded-xl focus:border-red-500/50 focus:ring-red-500/20 transition-all font-mono text-xs tracking-widest"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refetch}
            className="h-11 w-11 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 px-6 py-4 rounded-2xl bg-red-950/20 border border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
        >
          <TriangleAlert className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-xs font-mono text-red-400 uppercase tracking-widest">
            Critical Access Error: {error}
          </p>
        </motion.div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: "Total Entities", icon: Building2, color: "text-blue-500", value: displayData.length || "—", loading: isLoading },
          { title: "Localized", icon: MapPin, color: "text-green-500", value: clientsWithLocation, loading: isLoading },
          { title: "Active Uplinks", icon: Server, color: "text-red-500", value: health?.live.length || "—", loading: !health }
        ].map((item, idx) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Card className="bg-black/40 backdrop-blur-2xl border-white/5 hover:border-red-500/30 transition-all duration-500 group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <item.icon className="w-20 h-20 -mr-6 -mt-6" />
              </div>
              <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
                <CardTitle className="text-[10px] font-mono font-bold text-gray-500 uppercase tracking-[0.2em]">
                  {item.title}
                </CardTitle>
                <item.icon className={`w-4 h-4 ${item.color} opacity-70`} />
              </CardHeader>
              <CardContent className="relative z-10">
                {item.loading ? (
                  <Skeleton className="h-10 w-24 bg-white/5" />
                ) : (
                  <div className="text-4xl font-black tracking-tighter text-white">
                    {item.value}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Client Directory */}
      <Card className="bg-black/40 backdrop-blur-2xl border-white/5 rounded-3xl overflow-hidden shadow-2xl">
        <CardHeader className="border-b border-white/5 px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-black uppercase italic tracking-tight text-white">Entity Registry</CardTitle>
              <CardDescription className="text-gray-500 font-mono text-[10px] tracking-widest uppercase mt-1">
                Select an entry for granular device telemetry
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full bg-white/5 rounded-xl" />
              ))}
            </div>
          ) : paginated.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent px-8">
                    <TableHead
                      className="text-[10px] font-mono uppercase tracking-widest text-gray-500 cursor-pointer select-none hover:text-white transition-colors pl-8 py-4"
                      onClick={() => handleSort("name")}
                    >
                      <span className="inline-flex items-center">
                        Identifier
                        <SortIcon
                          column="name"
                          activeKey={sortKey}
                          activeDir={sortDir}
                        />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-[10px] font-mono uppercase tracking-widest text-gray-500 cursor-pointer select-none hover:text-white transition-colors py-4"
                      onClick={() => handleSort("alias")}
                    >
                      <span className="inline-flex items-center">
                        Alias
                        <SortIcon
                          column="alias"
                          activeKey={sortKey}
                          activeDir={sortDir}
                        />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-[10px] font-mono uppercase tracking-widest text-gray-500 cursor-pointer select-none hover:text-white transition-colors py-4"
                      onClick={() => handleSort("location")}
                    >
                      <span className="inline-flex items-center">
                        Geospatial
                        <SortIcon
                          column="location"
                          activeKey={sortKey}
                          activeDir={sortDir}
                        />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-[10px] font-mono uppercase tracking-widest text-gray-500 cursor-pointer select-none hover:text-white transition-colors py-4"
                      onClick={() => handleSort("externalID")}
                    >
                      <span className="inline-flex items-center">
                        Secure ID
                        <SortIcon
                          column="externalID"
                          activeKey={sortKey}
                          activeDir={sortDir}
                        />
                      </span>
                    </TableHead>
                    <TableHead className="text-gray-500 w-10 pr-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((client) => (
                    <TableRow
                      key={client.resourceId}
                      className="border-white/5 hover:bg-red-600/5 transition-colors group cursor-pointer"
                    >
                      <TableCell className="pl-8 py-5">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/clients/${encodeURIComponent(client.resourceId)}`}
                            className="text-sm font-bold text-white group-hover:text-red-500 transition-colors uppercase tracking-tight italic"
                          >
                            {client.name}
                          </Link>
                          {client._source === "tree" && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500/70 text-[8px] font-mono font-bold uppercase tracking-widest" title="Discovered from channel tree (not a registered Customer resource)">
                              <FolderTree className="w-2.5 h-2.5" />
                              Tree
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-gray-400 font-mono">
                        {client.alias || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500 font-mono">
                        {formatLocation(client)}
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-gray-600 group-hover:text-gray-400 transition-colors">
                        {client.externalID || "—"}
                      </TableCell>
                      <TableCell className="pr-8 text-right">
                        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white/5 border border-white/5 group-hover:border-red-500/50 group-hover:text-red-500 transition-all">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {sorted.length > PAGE_SIZE && (
                <div className="flex items-center justify-between px-8 py-6 border-t border-white/5 bg-black/20">
                  <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(currentPage * PAGE_SIZE, sorted.length)} of{" "}
                    {sorted.length} RECORDS
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setCurrentPage((p) => Math.max(1, p - 1))
                      }
                      className="h-9 px-4 rounded-xl bg-white/5 border border-white/5 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-white disabled:opacity-20 transition-all"
                    >
                      <ChevronLeft className="w-3 h-3 mr-2" />
                      Prev
                    </Button>
                    <div className="text-[10px] font-mono font-bold text-red-600 px-4 h-9 flex items-center justify-center rounded-xl bg-red-600/5 border border-red-600/10">
                      {currentPage} / {totalPages}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      className="h-9 px-4 rounded-xl bg-white/5 border border-white/5 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-white disabled:opacity-20 transition-all"
                    >
                      Next
                      <ChevronRight className="w-3 h-3 ml-2" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-24 text-gray-600 font-mono text-sm uppercase tracking-widest">
              {debouncedSearch
                ? `Zero Results for Identity Query: "${debouncedSearch}"`
                : "Registry empty"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
