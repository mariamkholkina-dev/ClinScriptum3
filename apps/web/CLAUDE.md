# Web Frontend

Next.js 14 App Router, React 18, Tailwind CSS, Zustand.

## Adding a new page

1. Create `src/app/(app)/{route}/page.tsx`
2. Use `"use client"` directive for interactive pages
3. Data fetching: `trpc.{router}.{procedure}.useQuery()` / `.useMutation()`
4. State: Zustand stores in `src/stores/`

## Patterns

- tRPC client: `import { trpc } from '@/lib/trpc'`
- UI components: `src/components/` — reusable, `src/app/(app)/{route}/` — page-specific
- Styling: Tailwind utility classes, no CSS modules
- Icons: `lucide-react`
- Modals: `src/components/Modal.tsx` wrapper

## Key files

- `src/lib/trpc.ts` — tRPC React Query setup, imports `AppRouter` from API
- `src/app/(app)/layout.tsx` — authenticated layout with sidebar
- `src/middleware.ts` — auth redirect logic

## E2E (Playwright)

- Specs in `e2e/`: `auth`, `studies`, `document-upload`, `audit`, `smoke`, `visual`
- Visual regression: `visual.spec.ts` uses `toHaveScreenshot()` with `maxDiffPixelRatio: 0.01`, fixed viewport `1280×720`, animations disabled
- Run: `npm run e2e --workspace=@clinscriptum/web`
- Update snapshots: `npm run e2e:update-snapshots --workspace=@clinscriptum/web`

## Notes for tRPC list queries

Endpoints that paginate (e.g. `audit.getAuditFindings`) accept optional `take` and `cursor` and return `nextCursor`. If you don't pass them, the backend returns the full list (back-compat). For long lists (1000+ findings) opt in via `take: 100` and chain through `nextCursor`.
