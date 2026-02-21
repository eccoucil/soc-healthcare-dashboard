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
    <ArrowUp className="w-3.5 h-3.5 ml-1" />
  ) : (
    <ArrowDown className="w-3.5 h-3.5 ml-1" />
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
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Clients</h2>
          <p className="text-gray-500">ArcSight ESM client management</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              placeholder="Search clients..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-64 pl-10 bg-white/5 border-white/10 text-white placeholder:text-gray-500"
            />
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
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <TriangleAlert className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">
            API error: {error}
          </p>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Clients
            </CardTitle>
            <Building2 className="w-5 h-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-16 bg-white/10" />
            ) : (
              <div className="text-3xl font-bold text-white">
                {displayData.length || "—"}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              With Location
            </CardTitle>
            <MapPin className="w-5 h-5 text-green-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-9 w-16 bg-white/10" />
            ) : (
              <div className="text-3xl font-bold text-white">
                {clientsWithLocation}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Active Connectors
            </CardTitle>
            <Server className="w-5 h-5 text-purple-500" />
          </CardHeader>
          <CardContent>
            {health ? (
              <div className="text-3xl font-bold text-white">
                {health.live.length}
              </div>
            ) : (
              <Skeleton className="h-9 w-16 bg-white/10" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Client Directory */}
      <Card className="bg-[#12121a] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Client Directory</CardTitle>
          <CardDescription className="text-gray-500">
            Click a client to view connectors and devices
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full bg-white/10" />
              ))}
            </div>
          ) : paginated.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead
                      className="text-gray-500 cursor-pointer select-none hover:text-gray-300 transition-colors"
                      onClick={() => handleSort("name")}
                    >
                      <span className="inline-flex items-center">
                        Name
                        <SortIcon
                          column="name"
                          activeKey={sortKey}
                          activeDir={sortDir}
                        />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-gray-500 cursor-pointer select-none hover:text-gray-300 transition-colors"
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
                      className="text-gray-500 cursor-pointer select-none hover:text-gray-300 transition-colors"
                      onClick={() => handleSort("location")}
                    >
                      <span className="inline-flex items-center">
                        Location
                        <SortIcon
                          column="location"
                          activeKey={sortKey}
                          activeDir={sortDir}
                        />
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-gray-500 cursor-pointer select-none hover:text-gray-300 transition-colors"
                      onClick={() => handleSort("externalID")}
                    >
                      <span className="inline-flex items-center">
                        External ID
                        <SortIcon
                          column="externalID"
                          activeKey={sortKey}
                          activeDir={sortDir}
                        />
                      </span>
                    </TableHead>
                    <TableHead className="text-gray-500 w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((client) => (
                    <TableRow
                      key={client.resourceId}
                      className="border-white/10 hover:bg-white/5"
                    >
                      <TableCell>
                        <Link
                          href={`/dashboard/clients/${encodeURIComponent(client.resourceId)}`}
                          className="text-white font-medium hover:text-red-400 transition-colors"
                        >
                          {client.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-gray-400">
                        {client.alias || "—"}
                      </TableCell>
                      <TableCell className="text-gray-400">
                        {formatLocation(client)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-500">
                        {client.externalID || "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/clients/${encodeURIComponent(client.resourceId)}`}
                          className="text-gray-500 hover:text-white transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {sorted.length > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-4 border-t border-white/10 mt-4">
                  <p className="text-sm text-gray-500">
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(currentPage * PAGE_SIZE, sorted.length)} of{" "}
                    {sorted.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setCurrentPage((p) => Math.max(1, p - 1))
                      }
                      className="text-gray-400 hover:text-white disabled:opacity-30"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-500 px-2">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      className="text-gray-400 hover:text-white disabled:opacity-30"
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              {debouncedSearch
                ? `No clients matching "${debouncedSearch}"`
                : "No clients found"}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
