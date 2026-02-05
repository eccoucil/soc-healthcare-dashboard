# CLAUDE.md - Project Instructions for AI Assistants

## Project Overview

This is a Security Operations Center (SOC) dashboard for healthcare environments. The frontend is a Next.js application with a dark-themed UI optimized for security monitoring.

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

The app runs at http://localhost:3000

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/app/dashboard/page.tsx` | Main dashboard page with all components |
| `frontend/src/app/globals.css` | Global styles and CSS variables |
| `frontend/src/app/page.tsx` | Authentication/login page |
| `frontend/src/components/ui/` | shadcn/ui component library |

## Architecture Decisions

### Layout Structure
- **Container**: `h-screen overflow-hidden` - constrains to viewport, prevents page scroll
- **Sidebar**: Fixed width (`w-64` expanded, `w-16` collapsed), full height
- **Header**: `h-16 flex-shrink-0` - fixed height, won't compress
- **Main Content**: `flex-1 overflow-auto` - fills remaining space, scrolls internally

### Styling Conventions
- Dark theme base: `bg-[#0a0a0f]` (near-black), `bg-[#12121a]` (elevated surfaces)
- Accent color: `red-600` for primary actions and active states
- Borders: `border-white/10` for subtle dividers
- Text: `text-white` for primary, `text-gray-400`/`text-gray-500` for secondary

### Component Patterns
- Cards use `bg-[#12121a] border-white/10`
- Badges use severity-based colors (critical=red, high=orange, medium=yellow, low=blue)
- Buttons follow shadcn/ui patterns with custom dark theme overrides

## Common Tasks

### Adding a new nav item
Edit `navItems` array in `dashboard/page.tsx`:
```tsx
const navItems = [
  { icon: IconComponent, label: "Label", badge: optionalCount },
  // ...
];
```

### Adding a new stat card
Copy existing Card pattern in the stats grid section, update icon, title, and values.

### Modifying the color scheme
Update CSS variables in `globals.css` under `:root` and `.dark` selectors.

## Testing Changes

After making UI changes:
1. Check the browser at http://localhost:3000/dashboard
2. Verify sticky layout by scrolling main content
3. Test sidebar collapse functionality
4. Check responsive behavior at different viewport sizes

## Code Style

- Use TypeScript for all new code
- Follow existing Tailwind class ordering (layout → spacing → colors → effects)
- Keep components in the dashboard page unless they need reuse
- Use Lucide icons for consistency
