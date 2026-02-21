"use client";

import { useState, useMemo } from "react";
import {
  FileText,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Play,
  Download,
  Clock,
  Search,
  Loader2,
  AlertCircle,
  Archive,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useReports,
  useReport,
  useReportArchives,
  useRunReport,
} from "@/hooks/use-arcsight";

// --- Types ---

interface ReportDefinition {
  resourceId: string;
  name: string;
  path: string;
  description: string | null;
  reportType: string | null;
  createdTimestamp: string | null;
  modifiedTimestamp: string | null;
}

interface ReportTreeGroup {
  name: string;
  resourceId: string;
  path: string;
  description: string | null;
  reports: ReportDefinition[];
}

// --- Tree browser ---

function GroupNode({
  group,
  selectedReportId,
  onSelectReport,
  searchFilter,
  defaultExpanded,
}: {
  group: ReportTreeGroup;
  selectedReportId: string | null;
  onSelectReport: (report: ReportDefinition) => void;
  searchFilter: string;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const filteredReports = useMemo(() => {
    if (!searchFilter) return group.reports;
    const lower = searchFilter.toLowerCase();
    return group.reports.filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.description?.toLowerCase().includes(lower)
    );
  }, [group.reports, searchFilter]);

  // Hide empty groups when filtering
  if (searchFilter && filteredReports.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/5 rounded-lg transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-gray-500" />
        )}
        <FolderOpen className="w-4 h-4 shrink-0 text-amber-500/70" />
        <span className="truncate font-medium">{group.name}</span>
        <Badge
          variant="secondary"
          className="ml-auto text-[10px] bg-white/5 text-gray-500 border-0"
        >
          {filteredReports.length}
        </Badge>
      </button>

      {expanded && (
        <div className="ml-4 border-l border-white/5 pl-2">
          {filteredReports.map((report) => (
            <button
              key={report.resourceId}
              onClick={() => onSelectReport(report)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                selectedReportId === report.resourceId
                  ? "bg-red-600/20 text-red-400"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-300"
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{report.name}</span>
            </button>
          ))}
          {filteredReports.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-600 italic">
              No reports in this group
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// --- Report detail panel ---

function ReportDetail({
  reportId,
  reportName,
}: {
  reportId: string;
  reportName: string;
}) {
  const { data: detail, isLoading: detailLoading } = useReport(reportId);
  const {
    data: archivesData,
    isLoading: archivesLoading,
    refetch: refetchArchives,
  } = useReportArchives(reportId);
  const {
    run: runReport,
    isLoading: runLoading,
    error: runError,
  } = useRunReport(reportId, () => refetchArchives());

  const archives = archivesData?.archives ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">{reportName}</h2>
        {detailLoading ? (
          <Skeleton className="h-4 w-48 mt-2 bg-white/5" />
        ) : detail?.description ? (
          <p className="text-sm text-gray-400 mt-1">{detail.description}</p>
        ) : null}
        {detail?.path && (
          <p className="text-xs text-gray-600 mt-1 font-mono">{detail.path}</p>
        )}
      </div>

      {/* Metadata */}
      {detail && (
        <div className="grid grid-cols-2 gap-4">
          {detail.modifiedTimestamp && (
            <div className="bg-[#12121a] border border-white/10 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Last Modified</p>
              <p className="text-sm text-gray-300">
                {formatTimestamp(detail.modifiedTimestamp)}
              </p>
            </div>
          )}
          {detail.createdTimestamp && (
            <div className="bg-[#12121a] border border-white/10 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Created</p>
              <p className="text-sm text-gray-300">
                {formatTimestamp(detail.createdTimestamp)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => runReport().catch(() => {})}
          disabled={runLoading}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {runLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          Run Now
        </Button>
        <Button
          variant="outline"
          onClick={refetchArchives}
          className="border-white/10 text-gray-300 hover:bg-white/5"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh Archives
        </Button>
      </div>

      {runError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {runError}
        </div>
      )}

      {/* Archives table */}
      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Archive className="w-4 h-4" />
          Archived Reports
        </h3>

        {archivesLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full bg-white/5" />
            ))}
          </div>
        ) : archives.length === 0 ? (
          <div className="bg-[#12121a] border border-white/10 rounded-lg p-8 text-center">
            <Archive className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              No archived reports yet. Click &quot;Run Now&quot; to generate one.
            </p>
          </div>
        ) : (
          <div className="bg-[#12121a] border border-white/10 rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-gray-500">Generated</TableHead>
                  <TableHead className="text-gray-500">Format</TableHead>
                  <TableHead className="text-gray-500">Status</TableHead>
                  <TableHead className="text-gray-500 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {archives.map((archive) => (
                  <TableRow
                    key={archive.archiveId}
                    className="border-white/10 hover:bg-white/5"
                  >
                    <TableCell className="text-sm text-gray-300">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-gray-500" />
                        {archive.generatedAt
                          ? new Date(archive.generatedAt).toLocaleString()
                          : "Unknown"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {archive.format ? (
                        <Badge
                          variant="secondary"
                          className="bg-white/5 text-gray-400 border-0"
                        >
                          {archive.format}
                        </Badge>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={archive.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {(["PDF", "CSV", "HTML"] as const).map((fmt) => (
                          <Button
                            key={fmt}
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-gray-400 hover:text-white hover:bg-white/10"
                            onClick={() =>
                              window.open(
                                `/api/arcsight/reports/${encodeURIComponent(archive.archiveId)}/download?format=${fmt}`,
                                "_blank"
                              )
                            }
                          >
                            <Download className="w-3 h-3 mr-1" />
                            {fmt}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-gray-600">—</span>;

  const styles: Record<string, string> = {
    COMPLETED: "bg-green-500/10 text-green-400 border-green-500/20",
    RUNNING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    QUEUED: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <Badge
      variant="outline"
      className={styles[status] ?? "bg-white/5 text-gray-400 border-white/10"}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

function formatTimestamp(ts: string): string {
  // Handle both ISO strings and epoch millisecond strings
  const date = /^\d{13}$/.test(ts) ? new Date(parseInt(ts, 10)) : new Date(ts);
  if (isNaN(date.getTime())) return ts;
  return date.toLocaleString();
}

// --- Main page ---

export default function ReportsPage() {
  const { data, isLoading, error, refetch } = useReports();
  const [selectedReport, setSelectedReport] = useState<ReportDefinition | null>(
    null
  );
  const [search, setSearch] = useState("");

  const groups = data?.groups ?? [];
  const totalReports = groups.reduce((sum, g) => sum + g.reports.length, 0);

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-red-500" />
            Reports
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isLoading
              ? "Loading report definitions..."
              : `${totalReports} reports across ${groups.length} groups`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          className="border-white/10 text-gray-400 hover:text-white hover:bg-white/10"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — Report tree */}
        <div className="w-80 border-r border-white/10 flex flex-col shrink-0">
          {/* Search */}
          <div className="p-3 border-b border-white/10">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                placeholder="Filter reports..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white/5 border-white/10 text-sm text-gray-300 placeholder:text-gray-600"
              />
            </div>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full bg-white/5" />
                ))}
              </div>
            ) : groups.length === 0 ? (
              <div className="p-6 text-center">
                <FolderOpen className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No report groups found</p>
              </div>
            ) : (
              groups.map((group) => (
                <GroupNode
                  key={group.resourceId}
                  group={group}
                  selectedReportId={selectedReport?.resourceId ?? null}
                  onSelectReport={setSelectedReport}
                  searchFilter={search}
                  defaultExpanded={groups.length <= 5}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel — Report detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedReport ? (
            <ReportDetail
              reportId={selectedReport.resourceId}
              reportName={selectedReport.name}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500">
                  Select a report from the tree to view details
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  Browse groups on the left, then click a report to view, run,
                  or download
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
