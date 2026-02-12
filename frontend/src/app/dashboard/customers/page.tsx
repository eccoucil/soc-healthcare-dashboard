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
import { mockCustomers } from "@/lib/mock-customers";
import type { Customer } from "@/types/arcsight";

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

function getLocationString(c: Customer): string {
  return formatLocation(c);
}

function getSortValue(customer: Customer, key: SortKey): string {
  switch (key) {
    case "name":
      return customer.name;
    case "alias":
      return customer.alias ?? "";
    case "location":
      return getLocationString(customer);
    case "externalID":
      return customer.externalID ?? "";
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

export default function CustomersPage() {
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

  // Reset to page 1 when search or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, sortKey, sortDir]);

  // API calls disabled — using mock data only
  const isLoading = false;
  const refetch = () => {};
  const health = null as { live: string[] } | null;

  const usingMockData = false;
  const displayData: Customer[] = mockCustomers;

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
  }, [displayData, debouncedSearch, usingMockData]);

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

  const customersWithLocation = displayData.filter(
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
          <h2 className="text-2xl font-bold">Customers</h2>
          <p className="text-gray-500">ArcSight ESM customer management</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              placeholder="Search customers..."
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

      {/* Mock data banner */}
      {usingMockData && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <TriangleAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">
            Showing sample data — API unavailable
          </p>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#12121a] border-white/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Customers
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
                {customersWithLocation}
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

      {/* Customer Directory */}
      <Card className="bg-[#12121a] border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Customer Directory</CardTitle>
          <CardDescription className="text-gray-500">
            Click a customer to view connectors and devices
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && !usingMockData ? (
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
                  {paginated.map((customer) => (
                    <TableRow
                      key={customer.resourceId}
                      className="border-white/10 hover:bg-white/5"
                    >
                      <TableCell>
                        <Link
                          href={`/dashboard/customers/${encodeURIComponent(customer.resourceId)}`}
                          className="text-white font-medium hover:text-red-400 transition-colors"
                        >
                          {customer.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-gray-400">
                        {customer.alias || "—"}
                      </TableCell>
                      <TableCell className="text-gray-400">
                        {formatLocation(customer)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-500">
                        {customer.externalID || "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/customers/${encodeURIComponent(customer.resourceId)}`}
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
                ? `No customers matching "${debouncedSearch}"`
                : "No customers found"}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
