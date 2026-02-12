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
```

No test framework is configured yet.

## Environment Setup

Copy `frontend/.env.example` to `frontend/.env.local` and fill in ArcSight credentials:

| Variable | Purpose |
|----------|---------|
| `ARCSIGHT_API_BASE_URL` | ESM DETECT API base (e.g. `https://host:port/detect-api/rest`) |
| `ARCSIGHT_LOGIN_URL` | Login endpoint for auto-authentication |
| `ARCSIGHT_USERNAME` / `ARCSIGHT_PASSWORD` | Auto-login credentials |
| `ARCSIGHT_API_TOKEN` | Optional static token (skips auto-login when set) |

## Architecture

### Three-Layer Data Flow

```
ArcSight ESM API ←→ Server-side client ←→ Next.js API routes ←→ React hooks ←→ UI
```

1. **`src/lib/arcsight-client.ts`** — Server-only ArcSight client. Uses `"server-only"` import guard, undici `Agent` with TLS skip, connection pool (6 connections), AbortController timeouts (15s default, 45s for `/connectors/devices`). Handles token management with auto-login and 401 retry.

2. **`src/app/api/arcsight/`** — Next.js Route Handlers that proxy to the server-side client. All responses set `Cache-Control: no-store`. Thin wrappers with try/catch → JSON error responses.

3. **`src/hooks/use-arcsight.ts`** — Client-side React hooks wrapping `fetch()` to the API routes. Generic `useArcsightQuery<T>` with auto-polling support. Only shows loading spinner on initial fetch, not on polls.

### Customer → Connector Resolution (critical path)

ArcSight has no direct "connectors for customer" API. The code bridges via a 4-step group hierarchy traversal in `getConnectorsForCustomer()`:

1. `customers/{id}/allPathsToRoot` → get parent group IDs
2. `groups/{groupId}/children` → get child resource IDs (mixed types)
3. `connectors/ids?ids=...` → fetch as connectors (non-connectors silently ignored)
4. `connectors/devices` → global device map, slowest call (45s timeout)

Steps 3 and 4 run in parallel via `Promise.all`. A debug endpoint at `/api/arcsight/customers/[id]/debug` runs each step individually with timing data.

### Dashboard Layout

- **`src/app/dashboard/layout.tsx`** — Shared layout with sidebar + header. Client component with collapsible sidebar (`w-64`/`w-16`), path-based active nav highlighting.
- **`src/app/dashboard/page.tsx`** — Main overview with stats, alerts table, activity feed. Alert data is currently hardcoded.
- **`src/app/dashboard/customers/page.tsx`** — Customer list with search (300ms debounce), connector health stats.
- **`src/app/dashboard/customers/[id]/page.tsx`** — Customer detail with connector table, link/unlink connector sheet.

### Routes

| Route | Purpose |
|-------|---------|
| `/` | Login page |
| `/dashboard` | Main SOC overview |
| `/dashboard/customers` | ArcSight customer list |
| `/dashboard/customers/[id]` | Customer detail + connectors |

### API Routes

| Endpoint | Methods | Client function |
|----------|---------|-----------------|
| `/api/arcsight/customers` | GET | `getAllCustomers()` |
| `/api/arcsight/customers/[id]` | GET | `getCustomerById()` |
| `/api/arcsight/customers/[id]/connectors` | GET, POST, DELETE | `getConnectorsForCustomer()`, `link/unlinkConnectorsToCustomer()` |
| `/api/arcsight/customers/[id]/debug` | GET | Step-by-step diagnostic report |
| `/api/arcsight/connectors` | GET | `getAllConnectors()` |
| `/api/arcsight/connectors/health` | GET | `getConnectorHealth()` |
| `/api/arcsight/connectors/devices` | GET | `getConnectorDevices()` — graceful degradation on failure |

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
