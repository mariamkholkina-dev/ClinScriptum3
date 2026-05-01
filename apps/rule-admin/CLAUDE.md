# Rule Admin Frontend

Next.js 14 App Router admin UI for rule management, golden datasets, and evaluation runs. Port 3002.

Separate from `apps/web` because the audience is internal admins / domain experts (not study writers).

## Adding a new page

1. Create `src/app/(app)/{route}/page.tsx`
2. Use `"use client"` for interactive pages
3. Data fetching: `trpc.{router}.{procedure}.useQuery()` / `.useMutation()`
4. Use only `adminProcedure`-protected endpoints (role `rule_admin` or higher)

## Patterns

- tRPC client: `import { trpc } from '@/lib/trpc'`
- Icons: `lucide-react`
- Styling: Tailwind utility classes
- Long lists with toggle/collapse: use `if (set.has(id)) set.delete(id); else set.add(id)` pattern (NOT a `?:` ternary as a statement — eslint `no-unused-expressions` blocks)

## Lint

`npm run lint` runs `eslint src/` (NOT `next lint` — it's interactive and blocks CI).

## E2E (Playwright)

- Specs in `e2e/`: `auth`, `dashboard`, `navigation`, `rules`, `golden-dataset`, `visual`
- Visual regression configured the same as `apps/web` (1280×720, animations disabled)
- Run: `npm run e2e --workspace=@clinscriptum/rule-admin`
