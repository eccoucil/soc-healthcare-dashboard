# Chore: Device Scan Performance — Last Manager Receipt Time Bottleneck

## Chore Description
Investigate why fetching "Last Manager Receipt Time" for 69 devices from both clients is taking too long and spiking the ESM server CPU utilization to ~80%, despite prior optimizations.

## Agent Reports

### 🔍 Scope Analysis

**What exactly is being asked?**
Diagnose the root cause of the performance degradation in the `scanAllChannelEventsWithSubscription()` function (5,521-line `arcsight-channel-client.ts`, line 3429) that scans 69 active channels across 2 clients to extract `latestManagerReceiptTime` for each device. The scan is causing ESM server CPU to spike to ~80%.

**What is NOT being asked?**
- Not adding new features to the device page
- Not changing the UI rendering logic
- Not restructuring the overall architecture
- Not modifying the channel tree discovery (`getAllActiveChannels`)

**Assumptions:**
1. 69 channels ≈ 69 devices across both clients (SAMEE + TEST under FORTRESS)
2. The ESM server (`ecccdesmt01:48443`) has limited resources (test server)
3. CPU spike is on the **ESM server side**, not the Node.js dashboard
4. The `scanAllChannelEventsWithSubscription` (v2) is the active scan path

**Critical findings — Root causes identified:**

#### Root Cause 1: Massive Per-Channel GWT-RPC Overhead (N+1 Problem)
The scan opens each of 69 channels **individually** via `callGetChannelInfo()` — a full GWT-RPC round-trip per channel. For channels needing Phase 2 (cold-start), this doubles to **2 round-trips per channel**. With 69 channels:
- **Phase 1**: 69 `getChannelInfo` calls (open channel + initial data)
- **Phase 2**: Up to 69 more `getChannelInfo` calls (for channels needing warming)
- **Stop**: 69 `stopViewChannel` calls (close channels)
- **Total**: Up to **207 GWT-RPC calls** just for the scan windows

Each `callGetChannelInfo` also calls `getFieldSetId()` internally (line 553), which on first invocation runs a FieldSet discovery (another GWT-RPC call). After that it's cached, but the first window still pays this cost.

#### Root Cause 2: Session Churn — Fresh Phoenix Login Per Window
At line 3498, for EACH window (of 10 channels), the scan does `freshPhoenixLogin()`. With 69 channels in windows of 10 = **7 windows = 7 fresh Phoenix logins**. Each login:
- Creates a new ESM session on the server
- Allocates server-side resources (memory, thread pool slot)
- The previous session's channels DON'T get cleaned up (comment at line 3496 says "stopViewChannel is broken on this ESM")

**HOWEVER**: Looking at the route handler (scan/route.ts line 37), `freshPhoenixLogin` is NOT being passed to the function — it's called as `scanAllChannelEventsWithSubscription(auth)` without the second parameter. So `freshPhoenixLogin` is `undefined`, meaning the scan reuses the same session. This means all 69 channels compete for **10 server-side channel slots** on a single session, causing MaxChannelExceededException errors.

#### Root Cause 3: Adaptive Wait Delays (Up to 8s Per Window)
Phase 2 uses a 3-stage adaptive wait (`WAIT_STAGES = [3000, 3000, 2000]` = 8s max per window). With 7 windows, worst case = **56 seconds of just waiting**, plus GWT-RPC call time.

#### Root Cause 4: Heavy Post-Scan Enrichment Pipeline
After all windows complete, the scan runs a multi-stage enrichment:
1. `resolveResourceIds()` — GWT-RPC call to resolve Base64 IDs to names (line 3815)
2. `getConnectorDevices()` — REST call with 45s timeout (pre-fetched in parallel, but awaited at line 3866)
3. `getConnectorsByIds()` — REST call for connector names (line 3888)
4. `getAllConnectorNamesViaManager()` — Fallback Manager Service call (line 3895)
5. Three-pass device matching loop (`O(channels × devices × connectors)`)
6. Channel-name-based device inference (another loop)

The enrichment phase adds connector metadata lookups that weren't part of the original v1 scan.

#### Root Cause 5: No Parallelism Across Windows (Sequential)
Windows are processed **sequentially** (line 3494: `for (let w = 0; ...)`) — window 2 doesn't start until window 1 finishes all phases + close. With 7 windows, this serialization is the primary time bottleneck.

#### Root Cause 6: ESM Server Load — 69 Concurrent Channel Subscriptions
Even with windowing (10 at a time), the ESM must:
- Parse filter expressions for each channel
- Execute real-time queries against the event database
- Maintain channel subscription state
- Buffer events for polling
- Serialize results in GWT-RPC format

With 10 channels per window and 8 concurrent batch calls (line 3479: `BATCH_CONCURRENCY = 8`), the ESM server handles 8 simultaneous getChannelInfo requests. This is the **direct cause of the CPU spike** — 8 concurrent event queries hitting the ESM correlator/database.

**Edge cases:**
- If stopViewChannel is truly broken, leftover channels from previous scans accumulate server-side, worsening the slot pressure
- Cold-start channels (no events buffered yet) always trigger Phase 2, adding delay
- Filter-expression-only channels get re-polled in Phase 2 even if they had events
- MaxChannelExceededException retries add more windows (and more logins if `freshPhoenixLogin` were passed)

**Acceptance criteria:**
1. Scan time for 69 channels reduced to under 60s (from current ~135s)
2. ESM server CPU utilization during scan stays below 50%
3. All 69 devices still get correct `latestManagerReceiptTime` values
4. No regression in health status accuracy on the devices page

---

### 🏗️ Architecture Decision

**Analysis — Why the current approach is expensive:**

| Phase | What happens | # of GWT-RPC calls | Time cost |
|-------|-------------|-------------------|-----------|
| Discovery | `getAllActiveChannels` tree walk | ~10-15 calls | ~3-5s |
| Window 1 (10ch) | Phase 1 open + Phase 2 poll + close | 10 + ≤10 + 10 = 30 | ~15-20s |
| Window 2-7 (59ch) | Same × 6 more windows | ~180 more | ~90-120s |
| Enrichment | resolveResourceIds + connectorDevices + matching | 3-5 REST/GWT calls | ~5-15s |
| **Total** | | **~230 GWT-RPC calls** | **~120-160s** |

**The fundamental problem**: The scan opens/polls/closes channels one window at a time, with built-in waits for cold-start buffering. This is inherently slow for 69 channels.

**Recommended approach: Reduce scan scope + smarten the timing**

Instead of a full re-architecture, apply targeted optimizations:

1. **Skip channels that already have cached MRT** — If a previous scan result exists and the MRT is recent (< 10 min old), skip re-scanning that channel. Only scan channels with stale or missing data. This could reduce 69 channels → ~20-30 on repeat scans.

2. **Increase window size when no live-polled channels exist** — Currently `WINDOW_SIZE = 10` when `liveCount === 0`. Since `freshPhoenixLogin` isn't being passed, we're staying on one session. We should pass it (each window gets a fresh session with 10 clean slots), OR increase WINDOW_SIZE to reduce total windows.

3. **Reduce Phase 2 wait stages** — 8s max is excessive. Most active channels buffer events within 2s. Change `WAIT_STAGES` from `[3000, 3000, 2000]` to `[2000, 2000]` (4s max). Channels that don't respond in 4s are likely truly inactive.

4. **Parallelize enrichment with scan** — `getConnectorDevices` is already pre-fetched. But `resolveResourceIds` and `getConnectorsByIds` run after all windows. Move connector name resolution to the pre-fetch parallel block.

5. **Reduce BATCH_CONCURRENCY** — Currently 8 concurrent GWT-RPC calls per batch. This directly causes the CPU spike. Reduce to 4 or 5 to give the ESM breathing room.

6. **Skip enrichment for channels with existing event data** — If Phase 1 already returns `deviceVendor`, `deviceProduct`, and `managerReceiptTime`, skip the entire enrichment pipeline for that channel.

**Files affected:**
- `frontend/src/lib/arcsight-channel-client.ts` — Core scan function (lines 3429-4137)
- `frontend/src/app/api/arcsight/channels/scan/route.ts` — Cache TTL and fresh flag handling

---

### 📋 Plan Review

**Verdict: APPROVED WITH CHANGES**

The analysis correctly identifies the root causes. Changes to the plan:

1. **Do NOT change window size without testing** — Increasing beyond 10 risks MaxChannelExceededException
2. **Do NOT wire freshPhoenixLogin yet** — Session churn has its own costs; the current approach of reusing one session is fine if we reduce concurrency
3. **Priority order**: Reduce BATCH_CONCURRENCY first (immediate CPU relief), then reduce wait stages, then add incremental scan (skip cached channels)
4. The enrichment parallelization is nice-to-have but not critical — the enrichment phase is only ~5-15s of the total ~135s

**Critical risk**: Reducing concurrency and wait times will help CPU but might miss events on slow channels. Mitigation: keep the 600s cache TTL so stale data is only ~10 min old.

---

### 🔒 Security Review

**Verdict: CLEAR**

No security implications identified:
- No new user input handling
- No new authentication flows
- No data exposure changes
- No new dependencies
- Session token handling remains unchanged

---

### 🧪 Test Plan

**Existing tests that could break:** None — the scan function has zero test coverage.

**New tests needed:** None for this analysis phase — this is a research/investigation chore.

**Validation approach:**
1. Run the scan with timing logs before changes: `curl http://localhost:3000/api/arcsight/channels/scan?fresh=true`
2. Monitor ESM server CPU during scan
3. After changes, compare scan time and CPU utilization
4. Verify all 69 devices still show correct health status on the devices page

---

## Root Cause Summary

The performance issue has **6 contributing factors** (ordered by impact):

| # | Root Cause | Impact | Fix Difficulty |
|---|-----------|--------|---------------|
| 1 | **69 individual channel GWT-RPC calls** (N+1 pattern) | HIGH — 207+ GWT-RPC round-trips | Medium (incremental scan) |
| 2 | **8 concurrent batch calls** spike ESM CPU | HIGH — direct cause of 80% CPU | Easy (reduce to 4-5) |
| 3 | **8s adaptive wait per window** (56s total worst case) | HIGH — adds ~40-56s of pure delay | Easy (reduce to 4s) |
| 4 | **Sequential window processing** | MEDIUM — windows can't overlap | Hard (requires fresh sessions) |
| 5 | **Heavy post-scan enrichment** (connector/device matching) | LOW-MEDIUM — ~5-15s extra | Medium (pre-fetch + skip) |
| 6 | **No incremental scan** (rescans all 69 even when cached) | MEDIUM — wasted work on repeat | Medium (delta scan logic) |

**The single biggest lever**: Reduce `BATCH_CONCURRENCY` from 8 → 4. This cuts concurrent ESM load in half, directly addressing the 80% CPU spike, at the cost of slightly longer scan time (~10-15% increase from serialization but massive CPU relief).

**Second biggest lever**: Reduce `WAIT_STAGES` from `[3000, 3000, 2000]` → `[2000, 2000]`. Saves ~4s per window × 7 windows = ~28s total.

**Third biggest lever**: Incremental scan — skip channels with valid cached MRT (< 10 min old). On repeat scans, this could reduce 69 → 20-30 channels.

## Relevant Files

- `frontend/src/lib/arcsight-channel-client.ts` (line 3429-4137) — Core `scanAllChannelEventsWithSubscription()` function, the main bottleneck
- `frontend/src/lib/arcsight-channel-client.ts` (line 526-645) — `callGetChannelInfo()` — each invocation is one GWT-RPC round-trip
- `frontend/src/lib/arcsight-channel-client.ts` (line 1661-1692) — `extractLatestManagerReceiptTime()` — the MRT extraction logic (not a bottleneck)
- `frontend/src/lib/arcsight-channel-client.ts` (line 5478-5521) — `resolveResourceIds()` — post-scan enrichment
- `frontend/src/lib/arcsight-client.ts` (line 238-248) — `getConnectorDevices()` — 45s timeout REST call
- `frontend/src/app/api/arcsight/channels/scan/route.ts` — Route handler with cache config
- `frontend/src/app/dashboard/devices/page.tsx` — Frontend consumer (not a bottleneck)
- `frontend/src/hooks/use-arcsight.ts` (line 286-328) — `useChannelScan` hook — 600s refetch interval

## Step by Step Optimization Tasks (If Approved)

### Step 1: Reduce BATCH_CONCURRENCY from 8 to 4
- **File**: `arcsight-channel-client.ts` line 3479
- **Why**: Direct CPU relief — halves concurrent ESM load
- **Risk**: Scan takes ~10-15% longer but CPU drops proportionally
- **Agent**: Architect

### Step 2: Reduce WAIT_STAGES from [3000, 3000, 2000] to [2000, 2000]
- **File**: `arcsight-channel-client.ts` line 3558
- **Why**: Saves ~28s total across 7 windows
- **Risk**: Very slow channels might miss events (mitigated by 600s cache + next scan cycle)
- **Agent**: Architect

### Step 3: Add incremental scan (skip channels with cached MRT < 10 min)
- **File**: `arcsight-channel-client.ts` in `scanAllChannelEventsWithSubscription()`
- **Why**: Reduces repeat scans from 69 → 20-30 channels
- **Risk**: Stale data for channels that stopped receiving events (mitigated by full scan every 3rd cycle)
- **Agent**: Architect + Test Engineer

### Step 4: Pre-fetch connector names alongside connector devices
- **File**: `arcsight-channel-client.ts` lines 3459-3465
- **Why**: Removes sequential connector name fetch from enrichment phase
- **Risk**: Minimal — already a parallel pre-fetch pattern in place
- **Agent**: Architect

## Validation Commands

```bash
cd frontend && npm run build    # TypeScript check
cd frontend && npm test          # Unit tests
# Manual: curl http://localhost:3000/api/arcsight/channels/scan?fresh=true (time the response)
# Manual: Monitor ESM server CPU during scan
```

## Notes

- The `freshPhoenixLogin` parameter is NOT being passed from the route handler, meaning all windows reuse one session. This is actually OK for reducing session churn but means channels from previous windows may not be fully closed (stopViewChannel is broken on this ESM).
- The 600s (10-minute) cache TTL is a good safeguard — even if we make scans faster, we don't scan more often than every 10 minutes.
- The scan auto-polls every 600s from the frontend (`refetchInterval: 600_000` in devices page).
- The `getFieldSetId` call in `callGetChannelInfo` is cached after first invocation — not a repeat cost.
- v1 scan (`scanAllChannelEvents`) uses window size 8 and batch size 4, which is actually more conservative than v2's window 10 / batch 8.
