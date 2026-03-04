# ECC-SOC 24/7

24/7 Security Operations Center dashboard for the EC-Council SOC Team. Built with Next.js 16 and Tailwind CSS 4, featuring real-time threat monitoring, alert management, ArcSight ESM integration (dual-protocol: DETECT REST API + Phoenix GWT-RPC), and security analytics.

## Features

- **Real-time Threat Monitoring** - Live dashboard with active threat counts and system health
- **Alert Management** - View, filter, and manage security alerts by severity and status
- **Client Management** - ArcSight client list with search, detail views, and connector linking
- **Channel Monitoring** - Client tree view and canvas view for active channels with live event polling
- **Device Browser** - Client dropdown, connector-grouped device tables with three-layer enrichment
- **Report Browser** - Tree view, ad-hoc execution, archive download (PDF/CSV/HTML)
- **Connector Health** - Live/dead connector status with enriched metadata
- **Proxy Support** - Optional split tunneling (HTTP, HTTPS, SOCKS5, SOCKS5h)

## Tech Stack

- **Framework**: Next.js 16.1.6, React 19.2.3, TypeScript 5
- **Styling**: Tailwind CSS 4, shadcn/ui components (17 installed)
- **Auth**: Supabase SSR with `@eccouncil.org` domain whitelist
- **Icons**: Lucide React
- **Charts**: Recharts
- **Animations**: Motion
- **HTTP**: undici (connection pooling) + socks (proxy)
- **Testing**: Jest 30.2.0

## Project Structure

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
│   │   │   └── dashboard/            # 7 pages
│   │   ├── components/               # Auth page, matrix background, 17 shadcn/ui
│   │   ├── hooks/                    # 16 query + 3 mutation hooks
│   │   ├── lib/                      # Service clients, GWT-RPC codec, cache, utils
│   │   ├── types/                    # 14 TypeScript interfaces
│   │   └── docs/                     # Internal documentation
│   ├── package.json
│   └── .env.example
├── specs/                             # Plans & research
└── CLAUDE.md                          # Project instructions
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
cd frontend
npm install
```

### Environment Setup

Copy `frontend/.env.example` to `frontend/.env.local` and fill in:

- **ArcSight credentials**: API base URL, login endpoint, username/password (or static token)
- **ArcSight Phoenix**: GWT-RPC URL, permutation hash, per-service serialization policy hashes
- **Supabase**: Project URL and publishable key

See `CLAUDE.md` for the full environment variable reference.

### Development

```bash
cd frontend
npm run dev          # Dev server at http://localhost:3000
npm run build        # Production build (catches TypeScript errors)
npm run lint         # ESLint
npm test             # Jest unit tests
```

## Available Routes

| Route | Purpose |
|-------|---------|
| `/` | Authentication page |
| `/dashboard` | Main SOC overview (stats, alerts, activity feed) |
| `/dashboard/clients` | ArcSight client list with search |
| `/dashboard/clients/[id]` | Client detail + connector management |
| `/dashboard/channels` | Channel monitoring — Client tree view + Canvas view toggle |
| `/dashboard/devices` | Device browser — client dropdown, connector-grouped device tables |
| `/dashboard/reports` | Report browser — tree view, run, download archives |

## Architecture

- **Pattern**: Modular monolith — Next.js 16 with cleanly separated server/client concerns
- **Two parallel protocols**: REST API (DETECT) + GWT-RPC (Phoenix) with shared dispatcher for proxy routing
- **Server-only guards**: Prevent credential leaks to client bundles
- **Auto-polling**: React hooks with page visibility tracking (pauses when tab hidden)
- **Connection pooling**: 6 connections (REST), 4 connections (GWT-RPC) via undici

See `CLAUDE.md` for the full architecture documentation.

## Design System

- Dark theme optimized for SOC environments (`bg-[#0a0a0f]` base, `bg-[#12121a]` elevated)
- Red accent (`red-600`) for primary actions and active states
- Color-coded severity badges (critical=red, high=orange, medium=yellow, low=blue)
- Fonts: Space Grotesk (sans) + JetBrains Mono (monospace)

## License

Private - All rights reserved
