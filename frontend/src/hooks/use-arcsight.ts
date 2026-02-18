"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  Customer,
  Connector,
  ConnectorWithDevices,
  ConnectorHealth,
  ConnectorHealthEnriched,
} from "@/types/arcsight";

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

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    // Only show loading spinner on initial fetch, not on polls
    if (!hasFetched.current) {
      setIsLoading(true);
    }
    setError(null);

    fetch(url)
      .then(async (res) => {
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
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, trigger]);

  // Auto-polling
  useEffect(() => {
    if (!url || !options?.refetchInterval) return;
    const id = setInterval(refetch, options.refetchInterval);
    return () => clearInterval(id);
  }, [url, options?.refetchInterval, refetch]);

  return { data, isLoading, error, refetch };
}

export function useCustomers(search?: string): QueryResult<Customer[]> {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  return useArcsightQuery<Customer[]>(`/api/arcsight/customers${params}`, {
    refetchInterval: 30_000,
  });
}

export function useCustomer(id: string | null): QueryResult<Customer> {
  const url = id ? `/api/arcsight/customers/${id}` : null;
  return useArcsightQuery<Customer>(url);
}

export function useCustomerConnectors(
  customerId: string | null
): QueryResult<ConnectorWithDevices[]> {
  const url = customerId
    ? `/api/arcsight/customers/${customerId}/connectors`
    : null;
  return useArcsightQuery<ConnectorWithDevices[]>(url, {
    refetchInterval: 30_000,
  });
}

export function useConnectorHealth(): QueryResult<ConnectorHealth> {
  return useArcsightQuery<ConnectorHealth>("/api/arcsight/connectors/health", {
    refetchInterval: 15_000,
  });
}

export function useConnectorHealthDetailed(): QueryResult<ConnectorHealthEnriched> {
  return useArcsightQuery<ConnectorHealthEnriched>(
    "/api/arcsight/connectors/health/detailed",
    { refetchInterval: 30_000 }
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
}

export function useActiveChannelEvents(channelId?: string): QueryResult<ChannelResult> {
  const url = channelId
    ? `/api/arcsight/channels/active?channelId=${encodeURIComponent(channelId)}`
    : "/api/arcsight/channels/active";
  return useArcsightQuery<ChannelResult>(url, {
    refetchInterval: 10_000,
  });
}

export function useChannelEventsOnDemand(
  channelId: string | null
): QueryResult<ChannelResult> {
  const url = channelId
    ? `/api/arcsight/channels/active?channelId=${encodeURIComponent(channelId)}`
    : null;
  return useArcsightQuery<ChannelResult>(url, { refetchInterval: 10_000 });
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
    refetchInterval: 60_000,
  });
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
  customerId: string | null,
  onSuccess?: () => void
): MutationResult {
  const url = customerId
    ? `/api/arcsight/customers/${customerId}/connectors`
    : null;
  return useArcsightMutation(url, "POST", onSuccess);
}

export function useUnlinkConnector(
  customerId: string | null,
  onSuccess?: () => void
): MutationResult {
  const url = customerId
    ? `/api/arcsight/customers/${customerId}/connectors`
    : null;
  return useArcsightMutation(url, "DELETE", onSuccess);
}
