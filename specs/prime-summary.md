# Prime Summary: ECC-SOC 24/7

> Generated on: 2026-03-04
> Analyzer: Claude Code — Prime Command

---

## 1. Project Overview

- **Name**: ECC-SOC 24/7
- **Description**: 24/7 Security Operations Center dashboard for the EC-Council SOC Team. Provides real-time threat monitoring, alert management, and deep ArcSight ESM integration via dual protocols (DETECT REST API + Phoenix GWT-RPC). Dark-themed UI optimized for SOC operators.
- **Type**: Web app (full-stack Next.js)
- **Language**: TypeScript 5
- **Framework**: Next.js 16.1.6 + React 19.2.3
- **License**: Private — All rights reserved

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 18+ |
| Framework | Next.js (App Router) | 16.1.6 |
| Frontend | React | 19.2.3 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (new-york) | 4.x |
| Icons | Lucide React | 0.563.0 |
| Charts | Recharts | 2.15.4 |
| Animations | Motion | 12.31.0 |
| Toasts | Sonner | 2.0.7 |
| HTTP Client | undici (connection pools) | 7.20.0 |
| Proxy | socks (SOCKS5/SOCKS5h) | 2.8.0 |
| Auth | AES-256-GCM encrypted session cookie | custom |
| Testing | Jest (jsdom, v8 coverage) | 30.2.0 |
| 3D Background | Three.js | 0.183.1 |

## 3. Architecture

**Pattern**: Modular monolith (Next.js 16 with server + client concerns cleanly separated)
**Style**: Layered — Route handlers → Service clients → External APIs

### Request Lifecycle

1. **Middleware** (`middleware.ts`): Cookie-presence check guards `/dashboard/*`, redirects unauthenticated users to `/`, redirects logged-in users from `/` to `/dashboard`.
2. **Route Handler** (`app/api/arcsight/*/route.ts`): Uses `withAuthRetry()` wrapper — decrypts session cookie, calls service layer with auth tokens, retries once on 401 with fresh tokens, returns JSON. Server-side cache (15-120s TTL) via `createServerCache`.
3. **Service Layer** (two parallel paths):
   - `arcsight-client.ts` — REST client for DETECT API. 6-connection pool, AbortController timeouts (15s default, 45s for devices).
   - `arcsight-channel-client.ts` — GWT-RPC client for Phoenix services (Channel, Group, Report, Event). 4-connection pool. Encodes/decodes GWT wire format via `gwt-rpc-codec.ts`.
   - Both share a dispatcher from `arcsight-dispatcher.ts` for optional proxy routing.
4. **Client Hooks** (`hooks/use-arcsight.ts`): `useArcsightQuery<T>()` generic hook with auto-polling (10-60s intervals), page visibility tracking (pauses when tab hidden), loading state management.
5. **UI**: Dashboard pages consume hooks, render with shadcn/ui components, dark theme with Three.js matrix background.

### Key Decisions

- Two parallel protocols: REST (DETECT API) + GWT-RPC (Phoenix) with shared proxy dispatcher
- `"server-only"` import guards prevent credential leaks to client bundles
- Page visibility tracking pauses all polling when tab is hidden
- 4-step group hierarchy traversal bridges the missing "connectors per client" API
- Three-layer device enrichment: filter expression → connector metadata → channel-name inference
- AES-256-GCM encrypted HttpOnly session cookie stores dual tokens + credentials for auto-refresh
- `withAuthRetry()` at route level provides transparent 401 retry with thundering-herd dedup

## 4. Directory Structure

```
soc-healthcare-dashboard/
├── frontend/                              # Next.js 16 application (ALL code lives here)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/arcsight/             # 30 API routes (REST/GWT-RPC proxies)
│   │   │   │   ├── channels/             # 11 routes — channel listing, tree, scan, live, events
│   │   │   │   ├── clients/              # 4 routes — CRUD + connector linking
│   │   │   │   ├── connectors/           # 5 routes — health, devices, agent fields
│   │   │   │   ├── reports/              # 6 routes — tree, run, archives, download
│   │   │   │   ├── events/               # 3 routes — listing, search, details
│   │   │   │   └── proxy-status/         # 1 route — diagnostics
│   │   │   ├── api/auth/                 # 3 routes — login, logout, session
│   │   │   ├── dashboard/                # 7 pages — overview, clients, devices, channels, reports
│   │   │   ├── layout.tsx                # Root layout (fonts, toaster)
│   │   │   ├── page.tsx                  # Login page
│   │   │   └── globals.css               # Tailwind 4 theme + custom animations
│   │   ├── components/
│   │   │   ├── ui/                       # 17 shadcn/ui components
│   │   │   ├── auth-page.tsx             # Login UI
│   │   │   └── matrix-background.tsx     # Three.js animated background
│   │   ├── hooks/
│   │   │   ├── use-arcsight.ts           # 16 query + 3 mutation hooks (613 lines)
│   │   │   └── use-mobile.ts
│   │   ├── lib/
│   │   │   ├── arcsight-channel-client.ts  # GWT-RPC client (5,521 lines — largest file)
│   │   │   ├── arcsight-query-client.ts    # Query/search layer (814 lines)
│   │   │   ├── arcsight-client.ts          # REST client (525 lines)
│   │   │   ├── gwt-rpc-codec.ts            # GWT wire format encoder/decoder (393 lines)
│   │   │   ├── session.ts                  # Session encryption, auth retry (220 lines)
│   │   │   ├── arcsight-dispatcher.ts      # Proxy/connection pool factory (123 lines)
│   │   │   ├── server-cache.ts             # TTL cache with inflight dedup (38 lines)
│   │   │   ├── password-validation.ts      # Sanitization + strength scoring
│   │   │   └── utils.ts                    # cn() utility
│   │   ├── types/arcsight.ts             # 14 TypeScript interfaces (112 lines)
│   │   └── middleware.ts                 # Auth guard (19 lines)
│   ├── scripts/warm-up-routes.mjs        # Pre-warms API routes on dev start
│   ├── package.json
│   ├── jest.config.ts
│   └── .env.example
├── specs/                                # Plans & research
├── .claude/                              # 13 specialist agents + agent memory
│   ├── agents/                           # auth, groups, events, reports, frontend, etc.
│   └── commands/                         # implement, research, bug, chore, prime, feature
├── CLAUDE.md                             # Project instructions (~400 lines)
└── README.md
```

## 5. Entry Points

- **Main**: `frontend/src/app/layout.tsx` — Root layout (Space Grotesk + JetBrains Mono fonts, Toaster)
- **Dev**: `cd frontend && npm run dev` (runs Next.js dev server + warm-up script)
- **Build**: `cd frontend && npm run build` (production build, catches TypeScript errors)
- **Test**: `cd frontend && npm test`
- **Lint**: `cd frontend && npm run lint`

## 6. API Surface

### Auth Routes (3)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Dual auth (REST + Phoenix), encrypted session cookie |
| POST | `/api/auth/logout` | Clear session cookie |
| GET | `/api/auth/session` | Session metadata |

### ArcSight Proxy Routes (30)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/arcsight/clients` | All clients |
| GET | `/api/arcsight/clients/[id]` | Single client |
| GET,POST,DELETE | `/api/arcsight/clients/[id]/connectors` | Client connectors + link/unlink |
| GET | `/api/arcsight/clients/[id]/debug` | Connector resolution diagnostic |
| GET | `/api/arcsight/connectors` | All connectors |
| GET | `/api/arcsight/connectors/health` | Live/dead health |
| GET | `/api/arcsight/connectors/health/detailed` | Enriched health with names |
| GET | `/api/arcsight/connectors/devices` | Connector device map |
| GET | `/api/arcsight/connectors/agent-fields` | Agent field metadata |
| GET | `/api/arcsight/channels` | Data Monitor viewable data |
| GET | `/api/arcsight/channels/[groupId]` | Channel group data |
| GET | `/api/arcsight/channels/list` | All active channel groups + channels |
| GET | `/api/arcsight/channels/tree` | Client hierarchy tree |
| GET | `/api/arcsight/channels/scan` | Full channel scan |
| GET | `/api/arcsight/channels/active` | Active channels |
| GET | `/api/arcsight/channels/live` | Live channel events |
| GET | `/api/arcsight/channels/discover` | GWT-RPC discovery |
| GET | `/api/arcsight/channels/fieldset-discover` | FieldSet discovery |
| POST | `/api/arcsight/channels/fieldset-update` | FieldSet updates |
| GET | `/api/arcsight/channels/debug` | GWT-RPC diagnostic info |
| GET | `/api/arcsight/reports` | Report tree (GWT-RPC) |
| GET | `/api/arcsight/reports/[id]` | Report definition |
| POST | `/api/arcsight/reports/[id]/run` | Ad-hoc report execution |
| GET | `/api/arcsight/reports/[id]/archives` | Archived results |
| GET | `/api/arcsight/reports/[id]/download` | Download report file |
| GET | `/api/arcsight/reports/discover` | ReportService discovery |
| GET | `/api/arcsight/events` | Event listing |
| GET | `/api/arcsight/events/search` | Event search (channelName/channelId/filter) |
| GET | `/api/arcsight/events/details` | Full event details (~450 CEF fields) |
| GET | `/api/arcsight/proxy-status` | Proxy configuration status |

**Total endpoints**: 33 (30 ArcSight + 3 auth)

## 7. Data Models

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
| `ESMSession` | `lib/session.ts` | Encrypted session data |
| `SessionAuth` | `lib/session.ts` | Auth tokens (REST + Phoenix + cookies) |

**Total models**: 16

## 8. Auth & Security

- **Method**: AES-256-GCM encrypted HttpOnly session cookie (`esm_session`)
- **Dual tokens**: REST API token + Phoenix GWT-RPC token (separate login endpoints)
- **Session TTL**: 24h cookie / 23h server-side TTL
- **Auto-refresh**: `withAuthRetry()` detects 401 errors, re-authenticates with stored credentials, retries the request, propagates updated cookie
- **Thundering herd**: Module-level `refreshPromise` dedup prevents concurrent refresh storms
- **Middleware**: Cookie presence check only — real validation in `requireAuth()`
- **Password handling**: Sanitization, XSS/SQL injection detection, strength scoring
- **Key files**: `session.ts`, `middleware.ts`, `auth-page.tsx`, `password-validation.ts`

## 9. Configuration

### Environment Variables (18 detected)

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | AES-256-GCM encryption key (min 32 chars) |
| `ARCSIGHT_API_BASE_URL` | DETECT REST API base URL |
| `ARCSIGHT_LOGIN_URL` | REST login endpoint |
| `ARCSIGHT_PHOENIX_URL` | Phoenix GWT-RPC base URL |
| `ARCSIGHT_PHOENIX_PERMUTATION` | GWT module permutation hash |
| `ARCSIGHT_PHOENIX_LOGIN_STRONG_NAME` | LoginService serialization policy |
| `ARCSIGHT_PHOENIX_DATAMONITOR_STRONG_NAME` | DataMonitorV2Service policy |
| `ARCSIGHT_CHANNEL_STRONG_NAME` | ChannelService policy |
| `ARCSIGHT_GROUP_STRONG_NAME` | GroupService policy |
| `ARCSIGHT_REPORT_STRONG_NAME` | ReportService policy (auto-discovered if blank) |
| `ARCSIGHT_EVENT_STRONG_NAME` | EventService policy |
| `ARCSIGHT_CHANNEL_RESOURCE_ID` | Active channel resource reference |
| `ARCSIGHT_DEFAULT_CHANNEL_GROUP_ID` | Default data monitor resource ID |
| `ARCSIGHT_FIELD_SET_ID` | FieldSet resource ID for event data |
| `ARCSIGHT_FIELD_SET_PATH` | FieldSet path for auto-discovery |
| `ARCSIGHT_MANAGER_URL` | Manager Service URL (auto-discovered) |
| `ARCSIGHT_PROXY_URL` | Optional proxy (socks5h://, http://, etc.) |
| `ARCSIGHT_SCAN_DEBUG` | Debug flag for scan operations |

### Key Config Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies & scripts |
| `tsconfig.json` | TypeScript config (path alias `@/*`) |
| `next.config.ts` | Next.js config (minimal) |
| `eslint.config.mjs` | ESLint 9+ flat config |
| `jest.config.ts` | Jest config (jsdom, v8 coverage) |
| `postcss.config.mjs` | Tailwind CSS 4 PostCSS |
| `components.json` | shadcn/ui registry (new-york style) |
| `.env.example` | Env var template |

## 10. Dependencies (Top 15)

| Package | Purpose |
|---------|---------|
| `next` 16.1.6 | React framework (App Router) |
| `react` 19.2.3 | UI library |
| `undici` 7.20.0 | HTTP client + connection pooling for ArcSight calls |
| `socks` 2.8.0 | SOCKS5 proxy support |
| `tailwindcss` 4 | Utility-first CSS |
| `radix-ui` 1.4.3 | Headless UI primitives (via shadcn/ui) |
| `recharts` 2.15.4 | Charting |
| `motion` 12.31.0 | Animations |
| `sonner` 2.0.7 | Toast notifications |
| `lucide-react` 0.563.0 | Icon library |
| `three` 0.183.1 | 3D matrix background animation |
| `next-themes` 0.4.6 | Theme management |
| `server-only` 0.0.1 | Import guard for server-only modules |
| `class-variance-authority` 0.7.1 | Component variants |
| `tailwind-merge` 3.4.0 | Tailwind class merging |

## 11. Scripts / Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server + route warm-up |
| `npm run build` | Production build (TypeScript check) |
| `npm start` | Production server |
| `npm run lint` | ESLint |
| `npm test` | Jest unit tests |

## 12. Testing

- **Framework**: Jest 30.2.0 with jsdom environment
- **Coverage**: v8 provider (configured, no CI threshold)
- **Test location**: `src/lib/__tests__/`
- **Test count**: 1 file (`password-validation.test.ts`)
- **React Testing Library**: Not installed
- **API mocking**: Not set up
- **E2E**: Playwright installed as dependency (used for ArcSight ACC UI interception research, not app E2E tests)

## 13. Deployment

- **Platform**: Not detected (no Vercel/Netlify/Docker config)
- **CI/CD**: Not detected (no `.github/workflows/`)
- **Docker**: Not present
- **Production env**: `.env.production` exists (different ArcSight server)

## 14. Patterns & Conventions

- **Naming**: Files kebab-case, functions camelCase, interfaces PascalCase
- **Error handling**: `withAuthRetry()` wraps all routes, try-finally + AbortController, graceful degradation via `Promise.allSettled`
- **Imports**: `"use client"` / `"server-only"` guards first, then React/Next, then `@/` aliases
- **Components**: shadcn/ui (new-york style) with `cn()` utility (clsx + twMerge)
- **Styling**: Dark theme — `bg-[#050505]` base, `bg-black/40` surfaces, `text-red-600` accents, `border-white/5` borders
- **API routes**: All return `Cache-Control: no-store`, use `withAuthRetry()`, propagate `Set-Cookie` on token refresh
- **Polling**: `useArcsightQuery<T>()` with configurable intervals — connector health 15s, clients 30s, channels 60s, events 10s
- **Batch size**: 50 IDs per bulk ArcSight API call

## 15. Tech Debt & Issues

- **TODOs/FIXMEs**: 0
- **Test coverage**: Only 1 test file — no route handler, hook, or component tests
- **No CI/CD pipeline**: No automated build/lint/test on push
- **Largest file**: `arcsight-channel-client.ts` at 5,521 lines — handles 5 different GWT-RPC services, could be split
- **3 lint warnings**: 2 intentionally unused `_auth` params in discovery functions, 1 unused import in query client
- **No database**: All state is in ArcSight ESM — no local persistence layer
- **No E2E tests**: Playwright installed but only used for ArcSight ACC UI reverse-engineering research

## 16. Quick Reference

| Task | Command |
|------|---------|
| Start dev | `cd frontend && npm run dev` |
| Run tests | `cd frontend && npm test` |
| Build | `cd frontend && npm run build` |
| Lint | `cd frontend && npm run lint` |
| Add shadcn component | `cd frontend && npx shadcn@latest add <name>` |

## 17. Codebase Metrics

| Metric | Count |
|--------|-------|
| Source files (.ts/.tsx) | 75 |
| API routes | 33 (30 ArcSight + 3 auth) |
| Dashboard pages | 7 |
| React hooks | 19 (16 query + 3 mutation) |
| UI components (shadcn) | 17 |
| Data models | 16 |
| Test files | 1 |
| Total lines (key files) | 8,378 |
| Environment variables | 18 |
| Claude agents | 13 |

---

*Generated by Prime Command. Re-run `/prime` to update.*
