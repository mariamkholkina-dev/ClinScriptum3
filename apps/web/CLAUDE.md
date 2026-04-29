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
