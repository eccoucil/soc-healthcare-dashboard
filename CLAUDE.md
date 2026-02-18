# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SOC (Security Operations Center) dashboard for healthcare environments. Next.js 16 frontend with ArcSight ESM integration for real-time connector/customer monitoring. Dark-themed UI optimized for security operations.

## Commands

```bash
cd frontend
npm install          # Install dependencies
npm run dev          # Dev server at http://localhost:3000
npm run build        # Production build (catches TypeScript errors)
npm run lint         # ESLint
npm test             # Jest (unit tests)
npm test -- --testPathPattern="some-file"  # Run a single test file
```

## Environment Setup

Copy `frontend/.env.example` to `frontend/.env.local` and fill in ArcSight credentials:

| Variable | Purpose |
|----------|---------|
| `ARCSIGHT_API_BASE_URL` | ESM DETECT API base (e.g. `https://host:port/detect-api/rest`) |
| `ARCSIGHT_LOGIN_URL` | Login endpoint for auto-authentication |
| `ARCSIGHT_USERNAME` / `ARCSIGHT_PASSWORD` | Auto-login credentials |
| `ARCSIGHT_API_TOKEN` | Optional static token (skips auto-login when set) |
| `ARCSIGHT_PHOENIX_URL` | Phoenix GWT-RPC base URL (for Data Monitors) |
| `ARCSIGHT_PHOENIX_PERMUTATION` | GWT module permutation hash (same for all services) |
| `ARCSIGHT_PHOENIX_LOGIN_STRONG_NAME` | Serialization policy hash for LoginService |
| `ARCSIGHT_PHOENIX_DATAMONITOR_STRONG_NAME` | Serialization policy hash for DataMonitorV2Service |
| `ARCSIGHT_CHANNEL_STRONG_NAME` | Serialization policy hash for ChannelService |
| `ARCSIGHT_GROUP_STRONG_NAME` | Serialization policy hash for GroupService |
| `ARCSIGHT_DEFAULT_CHANNEL_GROUP_ID` | Default data monitor resource ID |
| `ARCSIGHT_PROXY_URL` | Optional proxy for split tunneling (`socks5h://`, `http://`, etc.) |

## Architecture

### Data Flow (Two Parallel Paths)

```
ArcSight DETECT REST API ←→ arcsight-client.ts    ←→ /api/arcsight/*     ←→ React hooks ←→ UI
ArcSight Phoenix GWT-RPC ←→ arcsight-channel-client.ts ←→ /api/arcsight/channels/* ←→ React hooks ←→ UI
                               ↑
                         arcsight-dispatcher.ts (shared connection pool / proxy routing)
                               ↑
                         gwt-rpc-codec.ts (encode/decode GWT-RPC wire format)
```

### Server-Side Clients

Both clients use `"server-only"` import guard and share a dispatcher from `arcsight-dispatcher.ts` that routes through an optional proxy (`ARCSIGHT_PROXY_URL`).

1. **`src/lib/arcsight-client.ts`** — REST client for the DETECT API. Connection pool (6 connections), AbortController timeouts (15s default, 45s for `/connectors/devices`). Token management with auto-login and 401 retry.

2. **`src/lib/arcsight-channel-client.ts`** — GWT-RPC client for Phoenix services (DataMonitorV2Service, ChannelService, GroupService). Separate connection pool (4 connections). Has its own token (Phoenix login returns a different token than REST API). Calls the GWT-RPC codec to build/decode pipe-delimited wire format. The `X-GWT-Permutation` header uses the module permutation hash (`ARCSIGHT_PHOENIX_PERMUTATION`), while per-service serialization policy hashes go in the request body.

3. **`src/lib/arcsight-dispatcher.ts`** — Shared dispatcher factory. Creates an undici `Agent` (direct), `ProxyAgent` (HTTP CONNECT tunnel), or SOCKS5-aware `Agent` based on `ARCSIGHT_PROXY_URL`. Both clients import from here.

4. **`src/lib/gwt-rpc-codec.ts`** — Pure encoder/decoder for GWT-RPC wire protocol. Builds pipe-delimited request payloads and parses `//OK[...]` response arrays. No network calls.

### Customer → Connector Resolution (critical path)

ArcSight has no direct "connectors for customer" API. The code bridges via a 4-step group hierarchy traversal in `getConnectorsForCustomer()`:

1. `customers/{id}/allPathsToRoot` → get parent group IDs
2. `groups/{groupId}/children` → get child resource IDs (mixed types)
3. `connectors/ids?ids=...` → fetch as connectors (non-connectors silently ignored)
4. `connectors/devices` → global device map, slowest call (45s timeout)

Steps 3 and 4 run in parallel via `Promise.all`. A debug endpoint at `/api/arcsight/customers/[id]/debug` runs each step individually with timing data.

### Proxy / Split Tunneling

When `ARCSIGHT_PROXY_URL` is set, only ArcSight traffic routes through the proxy — all other traffic flows normally. Supported schemes:

| Scheme | Strategy |
|--------|----------|
| *(empty)* | Direct connection (default) |
| `http://` / `https://` | undici `ProxyAgent` (HTTP CONNECT tunnel) |
| `socks5://` | SOCKS5 via `socks` package, DNS resolved locally |
| `socks5h://` | SOCKS5 with remote DNS resolution (use when ArcSight hostname only resolves on corporate network) |

Diagnostic endpoint: `GET /api/arcsight/proxy-status`

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Login page |
| `/dashboard` | Main SOC overview (stats, alerts, activity feed) |
| `/dashboard/customers` | ArcSight customer list with search |
| `/dashboard/customers/[id]` | Customer detail + connector management |
| `/dashboard/channels` | Data Monitor (Phoenix GWT-RPC debug view) |

### API Routes

| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/arcsight/customers` | GET | All customers |
| `/api/arcsight/customers/[id]` | GET | Single customer |
| `/api/arcsight/customers/[id]/connectors` | GET, POST, DELETE | Customer's connectors + link/unlink |
| `/api/arcsight/customers/[id]/debug` | GET | Step-by-step connector resolution diagnostic |
| `/api/arcsight/connectors` | GET | All connectors |
| `/api/arcsight/connectors/health` | GET | Live/dead connector health |
| `/api/arcsight/connectors/devices` | GET | Connector device map (graceful degradation) |
| `/api/arcsight/channels` | GET | Data Monitor viewable data (GWT-RPC) |
| `/api/arcsight/channels/[groupId]` | GET | Channel group data |
| `/api/arcsight/channels/list` | GET | All active channel groups + channels (GWT-RPC) |
| `/api/arcsight/channels/debug` | GET | GWT-RPC diagnostic info |
| `/api/arcsight/proxy-status` | GET | Current proxy mode and config |

## Styling Conventions

- Dark theme: `bg-[#0a0a0f]` (base), `bg-[#12121a]` (elevated surfaces)
- Accent: `red-600` for primary actions and active states
- Borders: `border-white/10`
- Text: `text-white` primary, `text-gray-400`/`text-gray-500` secondary
- Cards: `bg-[#12121a] border-white/10`
- Severity badges: critical=red, high=orange, medium=yellow, low=blue
- Layout: `h-screen overflow-hidden` container, sidebar + header fixed, main content scrolls internally

## Code Patterns

- shadcn/ui (new-york style) with `@/components/ui/` — add new components via `npx shadcn@latest add <component>`
- Path alias: `@/*` maps to `./src/*`
- Lucide icons throughout
- Tailwind CSS 4 (PostCSS plugin, not `tailwind.config.js`)
- Batch size of 50 IDs per bulk ArcSight API call
- React hooks auto-poll: customers at 30s, connector health at 15s
- All API route responses set `Cache-Control: no-store`
- undici dispatcher passed via `// @ts-expect-error` on `fetch()` calls (not in standard RequestInit type)
