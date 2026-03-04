# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

- **Name**: ECC-SOC 24/7
- **Description**: 24/7 Security Operations Center dashboard for the EC-Council SOC Team with real-time threat monitoring, alert management, and ArcSight ESM integration. Dark-themed UI optimized for security operations.
- **Type**: Web app (full-stack Next.js)
- **License**: Private — All rights reserved

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 18+ |
| Framework | Next.js | 16.1.6 |
| Frontend | React | 19.2.3 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS 4 + shadcn/ui | — |
| Icons | Lucide React | 0.563.0 |
| Auth | Supabase SSR | 0.8.0 |
| Charts | Recharts | 2.15.4 |
| Animations | Motion | 12.31.0 |
| Toasts | Sonner | 2.0.7 |
| HTTP Client | undici | 7.20.0 |
| Proxy | socks | 2.8.0 |
| Testing | Jest | 30.2.0 |

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
| `ARCSIGHT_FIELD_SET_ID` | FieldSet resource ID for channel events (required for event data — without it, server returns metadata-only) |
| `ARCSIGHT_REPORT_STRONG_NAME` | Serialization policy hash for ReportService (auto-discovered if blank) |
| `ARCSIGHT_EVENT_STRONG_NAME` | Serialization policy hash for EventService (full event details — all ~450 CEF fields) |
| `ARCSIGHT_PROXY_URL` | Optional proxy for split tunneling (`socks5h://`, `http://`, etc.) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Publishable key (modern `sb_publishable_...` format) |

## Auth & Security

- **Method**: Supabase SSR (session-based) + `@eccouncil.org` domain whitelist
- **ArcSight Auth**: Auto-login with username/password, dual tokens (REST + Phoenix), 401 retry
- **Supabase SSR**: browser client (`src/lib/supabase/client.ts`), server client (`src/lib/supabase/server.ts`) via `@supabase/ssr`
- **Middleware** (`src/middleware.ts`): refreshes session every request, guards `/dashboard/*` (redirects to `/` if no session), redirects `/` → `/dashboard` if logged in
- Matcher excludes: `_next/static`, `_next/image`, `favicon.ico`, `api/`, static image files
- **Domain whitelist**: `@eccouncil.org` only — enforced client-side in `src/components/auth-page.tsx`
- **Password validation**: sanitization, XSS/SQL injection detection, strength scoring (`src/lib/password-validation.ts`)
- **Proxy**: Optional split tunneling (HTTP, HTTPS, SOCKS5, SOCKS5h)

## Architecture

**Pattern**: Modular monolith (Next.js 16 with server + client concerns cleanly separated)

### Request Lifecycle

1. **Entry** (`app/layout.tsx`): Root layout — fonts (Space Grotesk + JetBrains Mono), Toaster, CSS
2. **Middleware** (`middleware.ts`): Guards `/dashboard/*`, refreshes Supabase sessions, redirects
3. **Route Handler** (`app/api/arcsight/*/route.ts`): Delegates to service layer, server-side caching (15-120s TTL), returns JSON with `Cache-Control: no-store`
4. **Service Layer** (`lib/arcsight-client.ts` + `lib/arcsight-channel-client.ts`): Server-only, connection pooling (undici), token management with auto-login/retry, AbortController timeouts
5. **Client Hooks** (`hooks/use-arcsight.ts`): `useArcsightQuery<T>()` with auto-polling (10-60s), page visibility tracking (pauses when hidden)
6. **UI**: Dashboard pages consume hooks, render with shadcn/ui, dark theme

### Data Flow (Two Parallel Paths)

```
ArcSight DETECT REST API ←→ arcsight-client.ts    ←→ /api/arcsight/*     ←→ React hooks ←→ UI
ArcSight Phoenix GWT-RPC ←→ arcsight-channel-client.ts ←→ /api/arcsight/channels/* ←→ React hooks ←→ UI
                               ↑
                         arcsight-dispatcher.ts (shared connection pool / proxy routing)
                               ↑
                         gwt-rpc-codec.ts (encode/decode GWT-RPC wire format)
```

### Key Architectural Decisions

- Two parallel protocols: REST API (DETECT) + GWT-RPC (Phoenix) with shared dispatcher for proxy routing
- Server-only import guards prevent credential leaks to client bundles
- Page visibility tracking pauses polling when tab is hidden
- Composite 4-step group hierarchy traversal bridges missing "connectors per client" API
- Graceful degradation via `Promise.all()` + `.catch()` returning empty arrays
- Three-layer device enrichment: (1) filter expression EQ clauses → (2) connector device metadata from REST API → (3) channel-name keyword inference as last-resort fallback

### Server-Side Clients

Both clients use `"server-only"` import guard and share a dispatcher from `arcsight-dispatcher.ts` that routes through an optional proxy (`ARCSIGHT_PROXY_URL`).

1. **`src/lib/arcsight-client.ts`** — REST client for the DETECT API. Connection pool (6 connections), AbortController timeouts (15s default, 45s for `/connectors/devices`). Token management with auto-login and 401 retry.

2. **`src/lib/arcsight-channel-client.ts`** — GWT-RPC client for Phoenix services (DataMonitorV2Service, ChannelService, GroupService, ReportService, EventService). Separate connection pool (4 connections). Has its own token (Phoenix login returns a different token than REST API). Calls the GWT-RPC codec to build/decode pipe-delimited wire format. The `X-GWT-Permutation` header uses the module permutation hash (`ARCSIGHT_PHOENIX_PERMUTATION`), while per-service serialization policy hashes go in the request body. Includes three-layer device enrichment pipeline (filter expression → connector API → channel-name inference).

3. **`src/lib/arcsight-dispatcher.ts`** — Shared dispatcher factory. Creates an undici `Agent` (direct), `ProxyAgent` (HTTP CONNECT tunnel), or SOCKS5-aware `Agent` based on `ARCSIGHT_PROXY_URL`. Both clients import from here.

4. **`src/lib/gwt-rpc-codec.ts`** — Pure encoder/decoder for GWT-RPC wire protocol. Builds pipe-delimited request payloads and parses `//OK[...]` response arrays. No network calls.

### Client → Connector Resolution (critical path)

ArcSight has no direct "connectors for client" API. The code bridges via a 4-step group hierarchy traversal in `getConnectorsForClient()`:

1. `customers/{id}/allPathsToRoot` → get parent group IDs (ArcSight API uses "customers")
2. `groups/{groupId}/children` → get child resource IDs (mixed types)
3. `connectors/ids?ids=...` → fetch as connectors (non-connectors silently ignored)
4. `connectors/devices` → global device map, slowest call (45s timeout)

Steps 3 and 4 run in parallel via `Promise.all`. A debug endpoint at `/api/arcsight/clients/[id]/debug` runs each step individually with timing data.

### Proxy / Split Tunneling

When `ARCSIGHT_PROXY_URL` is set, only ArcSight traffic routes through the proxy — all other traffic flows normally. Supported schemes:

| Scheme | Strategy |
|--------|----------|
| *(empty)* | Direct connection (default) |
| `http://` / `https://` | undici `ProxyAgent` (HTTP CONNECT tunnel) |
| `socks5://` | SOCKS5 via `socks` package, DNS resolved locally |
| `socks5h://` | SOCKS5 with remote DNS resolution (use when ArcSight hostname only resolves on corporate network) |

Diagnostic endpoint: `GET /api/arcsight/proxy-status`

## Directory Structure

```
soc-healthcare-dashboard/
├── frontend/                          # Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/arcsight/         # 30 API routes (REST/GWT-RPC proxies)
│   │   │   │   ├── clients/          # Client management (4 routes)
│   │   │   │   ├── connectors/       # Connector health & devices (5 routes)
│   │   │   │   ├── channels/         # Channel/DataMonitor ops (11 routes)
│   │   │   │   ├── reports/          # Report management (6 routes)
│   │   │   │   ├── events/           # Event details & search (3 routes)
│   │   │   │   └── proxy-status/     # Proxy diagnostics (1 route)
│   │   │   ├── dashboard/            # 7 pages (main, clients, channels, devices, reports)
│   │   │   ├── layout.tsx            # Root layout
│   │   │   ├── page.tsx              # Login page
│   │   │   └── globals.css           # Tailwind 4 theme
│   │   ├── components/
│   │   │   ├── ui/                   # 17 shadcn/ui components
│   │   │   ├── auth-page.tsx         # Login UI + domain whitelist
│   │   │   └── matrix-background.tsx # Background animation
│   │   ├── hooks/
│   │   │   ├── use-arcsight.ts       # 16 query hooks + 3 mutation hooks
│   │   │   └── use-mobile.ts
│   │   ├── lib/
│   │   │   ├── arcsight-client.ts    # REST API client (6-conn pool)
│   │   │   ├── arcsight-channel-client.ts  # GWT-RPC client (4-conn pool)
│   │   │   ├── arcsight-dispatcher.ts      # Shared proxy dispatcher
│   │   │   ├── gwt-rpc-codec.ts      # GWT wire format encoder/decoder
│   │   │   ├── arcsight-query-client.ts    # Query cache layer
│   │   │   ├── server-cache.ts       # Server-side TTL cache
│   │   │   ├── password-validation.ts
│   │   │   ├── supabase/             # Browser + server clients
│   │   │   └── utils.ts              # cn() utility
│   │   ├── types/arcsight.ts         # 14 TypeScript interfaces
│   │   ├── docs/                     # Internal docs
│   │   └── middleware.ts             # Auth middleware
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.ts
│   └── .env.example
├── specs/                             # Plans & research
├── docs/                              # External docs
├── CLAUDE.md                          # Project instructions
└── README.md
```

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Login page |
| `/dashboard` | Main SOC overview (stats, alerts, activity feed) |
| `/dashboard/clients` | ArcSight client list with search |
| `/dashboard/clients/[id]` | Client detail + connector management |
| `/dashboard/channels` | Channel monitoring — Client tree view (default) + Canvas view toggle |
| `/dashboard/devices` | Device browser — client dropdown, connector-grouped device tables |
| `/dashboard/reports` | Report browser — tree view, run, download archives |

## API Routes

| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/arcsight/clients` | GET | All clients |
| `/api/arcsight/clients/[id]` | GET | Single client |
| `/api/arcsight/clients/[id]/connectors` | GET, POST, DELETE | Client's connectors + link/unlink |
| `/api/arcsight/clients/[id]/debug` | GET | Step-by-step connector resolution diagnostic |
| `/api/arcsight/connectors` | GET | All connectors |
| `/api/arcsight/connectors/health` | GET | Live/dead connector health |
| `/api/arcsight/connectors/health/detailed` | GET | Enriched health with names |
| `/api/arcsight/connectors/devices` | GET | Connector device map (graceful degradation) |
| `/api/arcsight/connectors/agent-fields` | GET | Agent field metadata |
| `/api/arcsight/channels` | GET | Data Monitor viewable data (GWT-RPC) |
| `/api/arcsight/channels/[groupId]` | GET | Channel group data |
| `/api/arcsight/channels/list` | GET | All active channel groups + channels (GWT-RPC) |
| `/api/arcsight/channels/tree` | GET | Client hierarchy tree (`?root=FORTRESS` to filter) |
| `/api/arcsight/channels/scan` | GET | Channel scanning |
| `/api/arcsight/channels/active` | GET | Active channels |
| `/api/arcsight/channels/live` | GET | Live channel events |
| `/api/arcsight/channels/discover` | GET | GWT-RPC discovery |
| `/api/arcsight/channels/fieldset-discover` | GET | FieldSet discovery for channel events |
| `/api/arcsight/channels/fieldset-update` | POST | FieldSet updates |
| `/api/arcsight/channels/debug` | GET | GWT-RPC diagnostic info |
| `/api/arcsight/reports` | GET | All reports in tree structure (GWT-RPC) |
| `/api/arcsight/reports/[id]` | GET | Report definition details |
| `/api/arcsight/reports/[id]/run` | POST | Trigger ad-hoc report execution |
| `/api/arcsight/reports/[id]/archives` | GET | List archived report results |
| `/api/arcsight/reports/[id]/download` | GET | Download report file (PDF/CSV/HTML) |
| `/api/arcsight/reports/discover` | GET | ReportService GWT-RPC discovery |
| `/api/arcsight/events` | GET | Event listing |
| `/api/arcsight/events/search` | GET | Event search by channel name/ID/filter. `?channelName=`, `?channelId=`, `?filter=` |
| `/api/arcsight/events/details` | GET | Full event details (~450 CEF fields) via EventService GWT-RPC. `?ids=12345` (max 10). `?raw=true` for debug. |
| `/api/arcsight/proxy-status` | GET | Current proxy mode and config |

**Total endpoints**: 30

## Data Models

| Model | File | Purpose |
|-------|------|---------|
| `ResourceBase` | `types/arcsight.ts` | Base for all ArcSight resources |
| `Client` | `types/arcsight.ts` | ArcSight client/customer |
| `Connector` | `types/arcsight.ts` | Monitoring connector |
| `DeviceDetail` | `types/arcsight.ts` | Device metadata |
| `ConnectorDeviceMap` | `types/arcsight.ts` | Device map by connector |
| `ConnectorWithDevices` | `types/arcsight.ts` | Connector + device list |
| `ConnectorHealth` | `types/arcsight.ts` | Health summary (live/dead) |
| `ConnectorHealthDetail` | `types/arcsight.ts` | Per-connector health |
| `ConnectorHealthEnriched` | `types/arcsight.ts` | Health with metadata |
| `ChannelSubtype` | `types/arcsight.ts` | Channel subtype enum (B/G/V/O) |
| `ChannelFilterCondition` | `types/arcsight.ts` | Parsed filter condition |
| `Channel` | `types/arcsight.ts` | Active channel |
| `ChannelPageResult` | `types/arcsight.ts` | Paginated results |
| `LinkConnectorsRequest` | `types/arcsight.ts` | Connector linking payload |

## Hooks (`src/hooks/use-arcsight.ts`)

Generic `useArcsightQuery<T>(url, options?)` pattern — returns `{ data, isLoading, error, refetch }`. Only shows loading spinner on initial fetch, not polls.

| Hook | Poll Interval | Notes |
|------|--------------|-------|
| `useClients(search?)` | 30s | Optional search param |
| `useClient(id)` | none | Single client |
| `useClientConnectors(clientId)` | 30s | Connectors + devices |
| `useConnectorHealth()` | 15s | Live/dead counts |
| `useConnectorHealthDetailed()` | 30s | Enriched with names |
| `useAllConnectors(enabled?)` | none | Full connector list |
| `useActiveChannelEvents(channelId?)` | 10s | Phoenix channel events |
| `useChannelEventsOnDemand(channelId)` | 10s | Null-safe, on-demand |
| `useChannelList()` | 60s | All groups + channels |
| `useClientTree(rootName?)` | 60s | Client hierarchy tree (default root: FORTRESS) |
| `useChannelDebug()` | none | GWT-RPC diagnostics |
| `useEventDetails(eventId)` | none | Full event details (~450 fields) via EventService. Point-in-time, no polling. |
| `useReports()` | 60s | Report tree listing |
| `useReport(id)` | none | Single report definition |
| `useReportArchives(id)` | 30s | Archived results for a report |
| `useRunReport(id)` | — | Mutation hook (POST) |

Mutation hooks: `useLinkConnector(clientId, onSuccess?)`, `useUnlinkConnector(clientId, onSuccess?)` — both use `useArcsightMutation` (POST/DELETE).

## Styling Conventions

- Dark theme: `bg-[#0a0a0f]` (base), `bg-[#12121a]` (elevated surfaces)
- Accent: `red-600` for primary actions and active states
- Borders: `border-white/10`
- Text: `text-white` primary, `text-gray-400`/`text-gray-500` secondary
- Cards: `bg-[#12121a] border-white/10`
- Severity badges: critical=red, high=orange, medium=yellow, low=blue
- Layout: `h-screen overflow-hidden` container, sidebar + header fixed, main content scrolls internally

## Code Patterns

- **Naming**: Files kebab-case, functions camelCase, interfaces PascalCase
- **Error handling**: Try-finally + AbortController, 401 auto-retry, graceful degradation (parallel `.catch()` returns empty arrays)
- **Imports**: `"use client"` / `"server-only"` guards first, then React/Next, then `@/` aliases
- **shadcn/ui** (new-york style, RSC enabled, neutral base, CSS variables) with `@/components/ui/` — add via `npx shadcn@latest add <component>`. `cn()` utility in `src/lib/utils.ts` (clsx + twMerge). Installed: avatar, badge, button, card, chart, dropdown-menu, input, label, select, separator, sheet, sidebar, skeleton, sonner, table, tabs, tooltip
- Path alias: `@/*` maps to `./src/*`
- Lucide icons throughout
- **Tailwind CSS 4**: PostCSS plugin (`@tailwindcss/postcss`), no `tailwind.config.js`. CSS uses `@import "tailwindcss"` + `@theme inline` in `globals.css`. Custom animations: `animate-alive-ping`, `animate-glow-throb` (connector health). Font: Space Grotesk + JetBrains Mono
- **ESLint 9+** flat config (`eslint.config.mjs`) — extends `next/core-web-vitals` + `next/typescript`
- Batch size of 50 IDs per bulk ArcSight API call
- React hooks auto-poll: clients at 30s, connector health at 15s (see Hooks section above)
- All API route responses set `Cache-Control: no-store`
- undici dispatcher passed via `// @ts-expect-error` on `fetch()` calls (not in standard RequestInit type)

## Key Config Files

| File | Purpose |
|------|---------|
| `frontend/package.json` | Dependencies & scripts |
| `frontend/tsconfig.json` | TypeScript config (path alias `@/*`) |
| `frontend/next.config.ts` | Next.js config |
| `frontend/eslint.config.mjs` | ESLint 9+ flat config |
| `frontend/jest.config.ts` | Jest config (jsdom, v8 coverage) |
| `frontend/postcss.config.mjs` | Tailwind CSS 4 PostCSS |
| `frontend/components.json` | shadcn/ui registry |
| `frontend/.env.example` | Env var template |

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 16.1.6 | React framework with App Router |
| `react` | 19.2.3 | UI library |
| `typescript` | 5 | Static type checking |
| `@supabase/ssr` | 0.8.0 | Server-side session management |
| `@supabase/supabase-js` | — | Supabase client |
| `tailwindcss` | 4 | Utility-first CSS |
| `lucide-react` | 0.563.0 | Icon library |
| `recharts` | 2.15.4 | Charting |
| `sonner` | 2.0.7 | Toast notifications |
| `undici` | 7.20.0 | HTTP client + connection pooling |
| `socks` | 2.8.0 | SOCKS5 proxy |
| `motion` | 12.31.0 | Animations |
| `next-themes` | 0.4.6 | Theme management |
| `jest` | 30.2.0 | Unit testing |
| `eslint` | 9 | Linting |

## Testing

- Jest with jsdom environment (`jest.config.ts` uses `createJestConfig` from `next/jest`)
- Coverage provider: v8
- Minimal test suite: only `src/lib/__tests__/password-validation.test.ts`
- No React Testing Library or API mocking setup currently

## Codebase Metrics

| Metric | Count |
|--------|-------|
| Source files (.ts/.tsx) | 73 |
| API routes | 30 |
| Dashboard pages | 7 |
| React hooks | 19 (16 query + 3 mutation) |
| UI components (shadcn) | 17 |
| Data models | 14 |
| Test files | 1 |

## Performance

| Component | Timeout | Pool | Poll Interval |
|-----------|---------|------|---------------|
| REST client | 15s (45s devices) | 6 conn | — |
| GWT-RPC client | — | 4 conn | — |
| Connector health | — | — | 15s |
| Clients | — | — | 30s |
| Channels | — | — | 60s |
| Channel events | — | — | 10s |
