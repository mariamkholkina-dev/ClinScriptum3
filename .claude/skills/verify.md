---
name: verify
description: Run full verification pipeline (typecheck, lint, test)
---

Run the following checks in order and report results:

1. `npm run typecheck` — TypeScript compilation check
2. `npm run lint` — ESLint check
3. `npm test` — Vitest test suite

Report: for each step, whether it passed or failed.
If any step fails, show the first 20 lines of errors.
