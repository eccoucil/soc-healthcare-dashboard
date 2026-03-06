"use client";

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import type {
  Client,
  Connector,
  ConnectorWithDevices,
  ConnectorHealth,
  ConnectorHealthEnriched,
} from "@/types/arcsight";

// --- Page Visibility ---
// Pauses all polling when the browser tab is hidden to reduce server load.

function subscribeToVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

function getVisibilitySnapshot() {
  return document.visibilityState === "visible";
}

function getServerSnapshot() {
  return true; // SSR: assume visible
}

function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeToVisibility, getVisibilitySnapshot, getServerSnapshot);
}

interface QueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

interface QueryOptions {
  /** Auto-poll interval in milliseconds. Omit or 0 to disable. */
  refetchInterval?: number;
}

function useArcsightQuery<T>(
  url: string | null,
  options?: QueryOptions
): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const hasFetched = useRef(false);
  const fetchingRef = useRef(false);
  const authFailedRef = useRef(false);
  const isVisible = usePageVisible();

  // Derived loading state to catch the first render of a new URL
  // eslint-disable-next-line react-hooks/refs -- hasFetched ref is intentionally read during render to avoid extra re-renders from state
  const isActuallyLoading = isLoading || (url !== null && !hasFetched.current);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      hasFetched.current = false;
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    // Only show loading spinner on initial fetch, not on polls
    if (!hasFetched.current) {
      setIsLoading(true);
    }
    setError(null);

    fetchingRef.current = true;
    fetch(url)
      .then(async (res) => {
        if (res.status === 401) {
          authFailedRef.current = true;
          // Clear session cookie so middleware won't redirect back to /dashboard
          fetch("/api/auth/logout", { method: "POST" })
            .catch(() => {})
            .finally(() => { window.location.href = "/"; });
          throw new Error("Session expired");
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<T>;
      })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setIsLoading(false);
          hasFetched.current = true;
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setIsLoading(false);
          hasFetched.current = true;
        }
      })
      .finally(() => {
        fetchingRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [url, trigger]);

  // Auto-polling — paused when tab is hidden, skipped when a fetch is in-flight
  useEffect(() => {
    if (!url || !options?.refetchInterval || !isVisible) return;
    const id = setInterval(() => {
      if (!fetchingRef.current && !authFailedRef.current) refetch();
    }, options.refetchInterval);
    return () => clearInterval(id);
  }, [url, options?.refetchInterval, refetch, isVisible]);

  // eslint-disable-next-line react-hooks/refs -- isActuallyLoading is derived from hasFetched ref (see above)
  return { data, isLoading: isActuallyLoading, error, refetch };
}

export function useClients(search?: string): QueryResult<Client[]> {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  return useArcsightQuery<Client[]>(`/api/arcsight/clients${params}`, {
    refetchInterval: 60_000,
  });
}

export function useClient(id: string | null): QueryResult<Client> {
  const url = id ? `/api/arcsight/clients/${id}` : null;
  return useArcsightQuery<Client>(url);
}

export function useClientConnectors(
  clientId: string | null
): QueryResult<ConnectorWithDevices[]> {
  const url = clientId
    ? `/api/arcsight/clients/${clientId}/connectors`
    : null;
  return useArcsightQuery<ConnectorWithDevices[]>(url, {
    refetchInterval: 60_000,
  });
}

export function useConnectorHealth(): QueryResult<ConnectorHealth> {
  return useArcsightQuery<ConnectorHealth>("/api/arcsight/connectors/health", {
    refetchInterval: 45_000,
  });
}

export function useConnectorHealthDetailed(): QueryResult<ConnectorHealthEnriched> {
  return useArcsightQuery<ConnectorHealthEnriched>(
    "/api/arcsight/connectors/health/detailed",
    { refetchInterval: 60_000 }
  );
}

export function useAllConnectors(enabled = true): QueryResult<Connector[]> {
  const url = enabled ? "/api/arcsight/connectors" : null;
  return useArcsightQuery<Connector[]>(url);
}

// --- Channel hooks (Phoenix GWT-RPC) ---

/** Raw GWT-RPC decoded response — will be mapped to proper types after verification */
interface GwtRpcResponse {
  ok: boolean;
  values: unknown[];
  stringTable: string[];
}

export function useChannelDebug(): QueryResult<{
  loginOk: boolean;
  tokenPreview: string;
  dataMonitorResponse: GwtRpcResponse;
  requestBody: string;
}> {
  return useArcsightQuery("/api/arcsight/channels/debug");
}

interface ChannelEvent {
  fields: Record<string, string | number | null>;
}

interface ChannelResult {
  events: ChannelEvent[];
  totalCount: number;
  fieldNames: string[];
  eventIds?: number[];
  isFilterExpressionOnly?: boolean;
}

export function useActiveChannelEvents(channelId?: string): QueryResult<ChannelResult> {
  const url = channelId
    ? `/api/arcsight/channels/active?channelId=${encodeURIComponent(channelId)}`
    : "/api/arcsight/channels/active";
  return useArcsightQuery<ChannelResult>(url, {
    refetchInterval: 60_000,
  });
}

export function useChannelEventsOnDemand(
  channelId: string | null
): QueryResult<ChannelResult> {
  const url = channelId
    ? `/api/arcsight/channels/active?channelId=${encodeURIComponent(channelId)}`
    : null;
  return useArcsightQuery<ChannelResult>(url, { refetchInterval: 60_000 });
}

// --- Channel listing ---

interface ActiveChannelEntry {
  displayName: string;
  resourceId: string;
  path: string;
  subType: string;
  lastUpdateTime: string | null;
  description: string | null;
  groupName: string;
}

interface ChannelGroupWithChannels {
  name: string;
  resourceId: string;
  path: string;
  description: string | null;
  channels: ActiveChannelEntry[];
}

interface ChannelListResult {
  groups: ChannelGroupWithChannels[];
}

export function useChannelList(): QueryResult<ChannelListResult> {
  return useArcsightQuery<ChannelListResult>("/api/arcsight/channels/list", {
    refetchInterval: 300_000,
  });
}

// --- Client tree (hierarchical channel view) ---

interface ClientNode {
  name: string;
  resourceId: string;
  path: string;
  channels: ActiveChannelEntry[];
  children: ClientNode[];
}

export function useClientTree(rootName?: string): QueryResult<ClientNode> {
  const params = rootName ? `?root=${encodeURIComponent(rootName)}` : "";
  return useArcsightQuery<ClientNode>(`/api/arcsight/channels/tree${params}`, {
    refetchInterval: 300_000,
  });
}

// --- Channel scan ---

export interface ChannelScanResult {
  channelId: string;
  channelName: string;
  groupName: string;
  subType: string;
  hasEvents: boolean;
  eventCount: number;
  fieldNames: string[];
  eventIds?: number[];
  latestManagerReceiptTime: number | null;
  eventFields?: Record<string, string | number | null>;
  error?: string;
}

interface ChannelScanResponse {
  results: ChannelScanResult[];
  scannedAt: string;
}

/** Pass enabled=true to start scanning. Optional refetchInterval for auto-rescan.
 *  Returns an extra `freshRescan` that bypasses the server cache (?fresh=true). */
export function useChannelScan(
  enabled: boolean,
  options?: { refetchInterval?: number }
): QueryResult<ChannelScanResponse> & { freshRescan: () => void } {
  const url = enabled ? "/api/arcsight/channels/scan" : null;
  const query = useArcsightQuery<ChannelScanResponse>(url, {
    refetchInterval: options?.refetchInterval,
  });

  // Fresh rescan: bypass server cache, show loading, update data in-place
  const [freshLoading, setFreshLoading] = useState(false);
  const [freshData, setFreshData] = useState<ChannelScanResponse | null>(null);
  const [freshError, setFreshError] = useState<string | null>(null);

  const freshRescan = useCallback(() => {
    if (!enabled || freshLoading) return;
    setFreshLoading(true);
    setFreshError(null);
    fetch("/api/arcsight/channels/scan?fresh=true")
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/";
          throw new Error("Session expired");
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<ChannelScanResponse>;
      })
      .then((result) => setFreshData(result))
      .catch((err) => setFreshError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setFreshLoading(false));
  }, [enabled, freshLoading]);

  return {
    data: freshData ?? query.data,
    isLoading: query.isLoading || freshLoading,
    error: freshError ?? query.error,
    refetch: query.refetch,
    freshRescan,
  };
}

// --- Multi-channel live polling ---

interface MultiChannelLiveResult {
  channels: Record<string, ChannelResult>;
  liveCount: number;
}

/** Poll up to 5 channels simultaneously. Pass empty array to disable. */
export function useMultiChannelLive(
  channelIds: string[]
): QueryResult<MultiChannelLiveResult> {
  const ids = channelIds.slice(0, 5);
  const url =
    ids.length > 0
      ? `/api/arcsight/channels/live?ids=${ids.map(encodeURIComponent).join(",")}`
      : null;
  return useArcsightQuery<MultiChannelLiveResult>(url, {
    refetchInterval: 60_000,
  });
}

/** Cleanup: close all live channels when the component unmounts. */
export function useMultiChannelCleanup() {
  useEffect(() => {
    return () => {
      fetch("/api/arcsight/channels/live", { method: "DELETE" }).catch(() => {});
    };
  }, []);
}

// --- Mutation hooks ---

interface MutationResult {
  mutate: (connectorIds: string[]) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

function useArcsightMutation(
  url: string | null,
  method: "POST" | "DELETE",
  onSuccess?: () => void
): MutationResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (connectorIds: string[]) => {
      if (!url) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectorIds }),
        });
        if (res.status === 401) {
          window.location.href = "/";
          throw new Error("Session expired");
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        onSuccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [url, method, onSuccess]
  );

  return { mutate, isLoading, error };
}

export function useLinkConnector(
  clientId: string | null,
  onSuccess?: () => void
): MutationResult {
  const url = clientId
    ? `/api/arcsight/clients/${clientId}/connectors`
    : null;
  return useArcsightMutation(url, "POST", onSuccess);
}

export function useUnlinkConnector(
  clientId: string | null,
  onSuccess?: () => void
): MutationResult {
  const url = clientId
    ? `/api/arcsight/clients/${clientId}/connectors`
    : null;
  return useArcsightMutation(url, "DELETE", onSuccess);
}

// --- REST Events hooks (Phase 3 fallback) ---

interface EventCountResult {
  startTime: number;
  endTime: number;
  count?: number;
}

export function useEventCount(
  timeRangeMinutes = 60
): QueryResult<EventCountResult> {
  // eslint-disable-next-line react-hooks/purity -- Intentional: timestamp recomputed each poll cycle via refetchInterval
  const now = Date.now();
  const startTime = now - timeRangeMinutes * 60 * 1000;
  return useArcsightQuery<EventCountResult>(
    `/api/arcsight/events?mode=count&startTime=${startTime}&endTime=${now}`,
    { refetchInterval: 60_000 }
  );
}

export function useEventFieldInfo(): QueryResult<Record<string, unknown>> {
  return useArcsightQuery<Record<string, unknown>>(
    "/api/arcsight/events?mode=fields"
  );
}

// --- Event details (EventService — full ~450 CEF fields) ---

interface EventFieldDetail {
  fieldName: string;
  displayName: string;
  value: string | number | null;
  category: string | null;
  dataType: string | null;
}

interface FullEventDetail {
  eventId: number;
  fields: Record<string, EventFieldDetail>;
}

interface EventDetailResult {
  events: FullEventDetail[];
  fieldNames: string[];
  totalFieldCount: number;
}

/** Fetch full event details (all ~450 CEF fields) for a single event. No polling. */
export function useEventDetails(
  eventId: number | null
): QueryResult<EventDetailResult> {
  const url = eventId
    ? `/api/arcsight/events/details?ids=${eventId}`
    : null;
  return useArcsightQuery<EventDetailResult>(url);
}

/** Composite: channel events + full event details for the first event. */
export function useEventDetailsForChannel(
  channelId: string | null,
  fallbackEventId?: number | null,
) {
  const { data: channelData, isLoading, error } = useChannelEventsOnDemand(channelId);
  const firstEventId = channelData?.eventIds?.[0] ?? fallbackEventId ?? null;
  const { data: eventDetails, isLoading: isLoadingDetails, error: detailsError } = useEventDetails(firstEventId);
  return { channelData, eventDetails, isLoading, isLoadingDetails, error, detailsError };
}

// --- Channel discovery ---

interface DiscoverResult {
  methods: { name: string; context: string }[];
  serializationPolicy: { url: string; types: string[]; error?: string };
  cacheJs: {
    url: string;
    sizeBytes: number;
    channelServiceMethods: string[];
    subscriptionCandidates: string[];
    error?: string;
  };
}

export function useChannelDiscover(): QueryResult<DiscoverResult> {
  return useArcsightQuery<DiscoverResult>("/api/arcsight/channels/discover");
}

// --- Report hooks (Phoenix GWT-RPC ReportService) ---

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

interface ReportListResult {
  groups: ReportTreeGroup[];
}

interface ArchivedReport {
  archiveId: string;
  reportName: string;
  generatedAt: string;
  format: string | null;
  status: string | null;
}

interface ArchivesResult {
  archives: ArchivedReport[];
}

export function useReports(): QueryResult<ReportListResult> {
  return useArcsightQuery<ReportListResult>("/api/arcsight/reports", {
    refetchInterval: 120_000,
  });
}

export function useReport(id: string | null): QueryResult<ReportDefinition> {
  const url = id ? `/api/arcsight/reports/${encodeURIComponent(id)}` : null;
  return useArcsightQuery<ReportDefinition>(url);
}

export function useReportArchives(
  reportId: string | null
): QueryResult<ArchivesResult> {
  const url = reportId
    ? `/api/arcsight/reports/${encodeURIComponent(reportId)}/archives`
    : null;
  return useArcsightQuery<ArchivesResult>(url, {
    refetchInterval: 60_000,
  });
}

interface RunReportResult {
  run: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useRunReport(
  reportId: string | null,
  onSuccess?: () => void
): RunReportResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!reportId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/arcsight/reports/${encodeURIComponent(reportId)}/run`,
        { method: "POST" }
      );
      if (res.status === 401) {
        window.location.href = "/";
        throw new Error("Session expired");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [reportId, onSuccess]);

  return { run, isLoading, error };
}
