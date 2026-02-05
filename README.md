# SOC Healthcare Dashboard

A Security Operations Center (SOC) dashboard designed for healthcare environments. Built with Next.js and Tailwind CSS, featuring real-time threat monitoring, alert management, and security analytics.

## Features

- **Real-time Threat Monitoring** - Live dashboard with active threat counts and system health
- **Alert Management** - View, filter, and manage security alerts by severity and status
- **Endpoint Protection** - Monitor protected endpoints across the healthcare network
- **Activity Feed** - Track team member actions and system events
- **Global Threat Map** - Visualize attack origins and blocked threats (placeholder)

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS 4, shadcn/ui components
- **Icons**: Lucide React

## Project Structure

```
├── frontend/          # Next.js web application
│   ├── src/
│   │   ├── app/       # App router pages
│   │   ├── components/# React components
│   │   └── lib/       # Utilities
├── backend/           # API services (planned)
├── docs/              # Documentation
└── infra/             # Infrastructure as Code
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Available Routes

- `/` - Authentication page
- `/dashboard` - Main SOC dashboard

## Dashboard Layout

The dashboard features a sticky layout design:
- **Header** - Fixed at top with search, system status, and user profile
- **Sidebar** - Fixed navigation with collapsible menu
- **Main Content** - Scrollable area with stats, alerts table, and activity feed

## Design System

- Dark theme optimized for SOC environments
- Red accent color for critical alerts and actions
- Color-coded severity badges (critical, high, medium, low)
- Status indicators (open, investigating, resolved)

## License

Private - All rights reserved
