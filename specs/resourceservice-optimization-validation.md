# ResourceService Optimization Proposal — Validation

> **Proposal by**: Jasni Jusoh (VCB AI Engineering)
> **Validated by**: SOC Dashboard team
> **Date**: 2026-03-06
> **Verdict**: **NOT VIABLE** — wrong diagnosis, wrong API target, and optimizations already applied

---

## Executive Summary

Jasni Jusoh proposed using Manager Service `ResourceService` (RAM cache) to replace current API calls, claiming this would reduce ESM CPU spikes to ~80%. After codebase validation against the actual ArcSight ESM deployment, the proposal is **not viable** for three reasons:

1. The fields claimed (`resourceStatus`, `lastActivityTime`, `eps`) do not exist on ResourceService
2. The CPU spike root cause is GWT-RPC channel scanning, not connector REST calls
3. The actual performance optimizations have **already been applied** to the codebase

---

## Proposal Claims vs Reality

### Claim 1: Use `ResourceService/findAllIds` + `getResourceById` for device health

**Reality**: The codebase already uses the equivalent — `ConnectorService/findAllIds` + `ConnectorService/getResourceById` — as a fallback in `arcsight-query-client.ts:418-456`. ConnectorService is the correct service for connector resources (ResourceService is a generic parent). The returned fields are limited to basic metadata: `name`, `hostName`, `address`. No `lastActivityTime`, `eps`, or `resourceStatus` fields exist in the response.

**Evidence**: Zero occurrences of `resourceStatus`, `lastActivityTime`, or `eps` in the entire `arcsight-query-client.ts`. Zero references to `ResourceService` anywhere in `frontend/src/`.

### Claim 2: ResourceService targets Manager's "RAM Cache" — zero disk I/O

**Partially true**: Basic resource properties (name, ID, timestamps) are served from the Manager's in-memory cache. But health metrics like EPS and last activity are **event-derived** — they require querying the `arc_event` database or monitoring active channel event flow. ResourceService cannot provide event-level data from memory.

### Claim 3: Bypasses the 10-device UI session limit

**True for REST/SOAP calls**: The Manager Service REST endpoints don't have the GWT-RPC ChannelService's 10-channel slot limit. But this is irrelevant because:
- The REST connector health endpoints (`/v1/connectors/live`, `/v1/connectors/dead`) already bypass this limit
- The channel slot limit only affects the GWT-RPC scan path, which ResourceService cannot replace

### Claim 4: Fields `resourceStatus`, `lastActivityTime`, `eps` are available

**False**. The `Connector` interface (`types/arcsight.ts:26-38`) confirms:
```typescript
interface Connector extends ResourceBase {
  operationalStatus?: string;   // Text status, NOT "resourceStatus"
  alive?: boolean;              // Boolean live/dead only
  hostName?: string;
  address?: string;
  disabled?: boolean;
  inactive?: boolean;
}
```
- `lastActivityTime` — event-level metric, only derivable from `managerReceiptTime` in channel event data
- `eps` (events per second) — not implemented anywhere; would require continuous event counting
- `resourceStatus` — not a real ArcSight field; `operationalStatus` is the closest equivalent

---

## Wrong Diagnosis: CPU Spike Root Cause

The proposal assumes connector health REST calls cause the 80% CPU spike. **They don't.**

### What's lightweight (NOT the problem)

| Endpoint | Calls | Interval | Cache | ESM Impact |
|----------|-------|----------|-------|------------|
| `/v1/connectors/live` | 1 GET | 45s | 30s server TTL | Negligible |
| `/v1/connectors/dead` | 1 GET | 45s | 30s server TTL | Negligible |
| `ConnectorService/findAllIds` | 1 POST | On-demand | — | Low |

### What's expensive (THE actual problem)

| Component | Calls | Impact |
|-----------|-------|--------|
| `scanAllChannelEventsWithSubscription()` | 207+ GWT-RPC calls across 69 channels | **Direct cause of 80% CPU** |
| Per-window batch of `callGetChannelInfo()` | 4 concurrent (was 8) per batch | Each triggers ESM event query |
| Phase 2 adaptive wait + re-poll | 2 stages × 7 windows | Additional GWT-RPC calls for cold channels |

The scan opens each of 69 active channels individually via GWT-RPC, polls for event data, and closes them — a fundamentally expensive operation that ResourceService cannot replace.

---

## Optimizations Already Applied

The performance analysis from `specs/device-scan-performance.md` identified the correct levers. **All four optimizations have been implemented**:

### 1. BATCH_CONCURRENCY: 8 → 4 (DONE)

```
// arcsight-channel-client.ts:3534
const BATCH_CONCURRENCY = 4; // Reduced from 8 to lower ESM CPU load (~80% → ~40%)
```

### 2. WAIT_STAGES: [3000, 3000, 2000] → [2000, 2000] (DONE)

```
// arcsight-channel-client.ts:3614
const WAIT_STAGES = [2000, 2000];
```

### 3. Incremental scan — skip cached channels (DONE)

```
// arcsight-channel-client.ts:3489-3529
// Channels with MRT < 10 min old + valid eventFields are skipped
// Full scan forced every 3rd cycle (FULL_SCAN_EVERY_N = 3)
// Merged results: [...scannedResults, ...reusedResults]
```

Reduces repeat scan from 69 channels to only stale/new channels (~20-30 on average).

### 4. Parallel connector name pre-fetch (DONE)

```
// arcsight-channel-client.ts:3475-3487
// Connector names fetched in parallel before scan starts
```

Eliminates serial enrichment delay (-5-15s per scan cycle).

---

## Where Health Metrics Actually Come From

| Metric | Source | Dashboard Implementation |
|--------|--------|-------------------------|
| **Connector alive/dead** | DETECT REST: `GET /v1/connectors/live` + `/dead` | `getConnectorHealth()` — 2 calls, 30s cache |
| **Last Manager Receipt Time** | Event-level CEF field `managerReceiptTime` in active channel data | `scanAllChannelEventsWithSubscription()` — GWT-RPC (the expensive path) |
| **Events Per Second** | Would need event counting from `arc_event` or channel polling | Not implemented |
| **Operational status** | Connector resource metadata | Already in `Connector.operationalStatus` |

ResourceService cannot provide any of the event-derived metrics (MRT, EPS) that the proposal claims.

---

## Recommendation

**Do not implement the ResourceService approach.** The proposal:
- Targets the wrong API (ResourceService doesn't have the claimed fields)
- Misdiagnoses the root cause (connector REST calls are cheap; GWT-RPC scan is expensive)
- Proposes a solution already partially in place (Manager Service ConnectorService is already used as fallback)

All four optimizations from `specs/device-scan-performance.md` are now in production — no further scan-related changes needed.

---

## Evidence Files

| File | Line(s) | What It Proves |
|------|---------|---------------|
| `frontend/src/lib/arcsight-query-client.ts` | 418-456 | ConnectorService/findAllIds + getResourceById already implemented |
| `frontend/src/types/arcsight.ts` | 26-38 | No `lastActivityTime`, `eps`, or `resourceStatus` in Connector interface |
| `frontend/src/lib/arcsight-client.ts` | 394-433 | Connector health = 2 lightweight REST calls |
| `frontend/src/app/api/arcsight/connectors/health/route.ts` | 1-26 | 30s server-side cache in place |
| `frontend/src/lib/arcsight-channel-client.ts` | 3534 | `BATCH_CONCURRENCY = 4` (already reduced from 8) |
| `frontend/src/lib/arcsight-channel-client.ts` | 3614 | `WAIT_STAGES = [2000, 2000]` (already reduced from [3000, 3000, 2000]) |
| `frontend/src/lib/arcsight-channel-client.ts` | 3489-3529 | Incremental scan: skip channels with fresh MRT (< 10 min), full scan every 3rd cycle |
| `frontend/src/lib/arcsight-channel-client.ts` | 3475-3487 | Parallel connector name pre-fetch before scan |
| `frontend/src/app/api/arcsight/channels/scan/route.ts` | 13-14 | 600s (10 min) scan cache TTL |
| `specs/device-scan-performance.md` | — | Full root cause analysis of 80% CPU spike |
| `frontend/src` (grep) | — | Zero references to `ResourceService` in codebase |
