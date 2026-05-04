# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ClinScriptum — intelligent assistant for clinical trial documentation. Analyzes, verifies, compares, and generates documents: Protocol, ICF (Informed Consent Form), IB (Investigator's Brochure), CSR (Clinical Study Report).

## Commands

```bash
# Prerequisites: docker compose up -d (starts PostgreSQL 16, Redis 7, MinIO)

# Install & setup
npm ci
npm run db:generate          # prisma generate
npm run db:migrate           # prisma migrate dev
npm run db:seed              # seed demo data

# Development (starts all apps via turbo)
npm run dev                  # api :4000, web :3000, word-addin :3001

# Build, lint & typecheck
npm run build                # turbo build (all workspaces)
npm run lint                 # turbo lint (ESLint flat config, all workspaces)
npm run typecheck            # turbo typecheck (tsc --noEmit, all workspaces)
npm run test                 # turbo test (vitest, packages with tests)

# Single workspace
npm run dev --workspace=@clinscriptum/api
npm run build --workspace=@clinscriptum/web

# Database
npm run db:migrate           # run migrations (dev)
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma  # prod deploy
```

## Architecture

Turbo monorepo with npm workspaces. All TypeScript, ESM modules (`"type": "module"`).

### Apps

| App | Port | Purpose |
|-----|------|---------|
| `apps/api` | 4000 | Express + tRPC v11 server (SuperJSON transformer). JWT auth, tenant isolation |
| `apps/web` | 3000 | Next.js 14 + React 18 frontend. tRPC React Query hooks, Zustand state, Tailwind |
| `apps/rule-admin` | 3002 | Next.js admin UI for rule management, golden datasets, evaluation runs |
| `apps/workers` | — | BullMQ job processors. Connects to Redis for queue, PostgreSQL for data |
| `apps/word-addin` | 3001 | Office.js Word add-in (Vite + Fluent UI) |

### Packages

| Package | Role |
|---------|------|
| `packages/db` | Prisma 6 schema, migrations, seed. Re-exports `PrismaClient` and generated types |
| `packages/shared` | Shared TypeScript types + `AsyncLocalStorage` request context (`asyncContext`, `getRequestContext`) |
| `packages/llm-gateway` | Multi-provider LLM abstraction via Vercel AI SDK (OpenAI, Anthropic, Azure OpenAI, Qwen/NVIDIA NIM) |
| `packages/doc-parser` | DOCX parsing (mammoth → HTML → structured AST). Section detection, table extraction, SOA identification |
| `packages/rules-engine` | Deterministic classification rules — section classifier, fact extractor, contradiction detector |
| `packages/diff-engine` | Version comparison (section diffs, fact diffs) and cross-document impact analysis (Protocol→ICF/IB) |

### Key Data Flow

```
Upload DOCX → doc-parser → sections + content blocks → rules-engine (deterministic)
  → llm-gateway (LLM verification) → llm-gateway (LLM QA on disagreements)
  → optional operator review → user validation → findings
```

### Service Layer (`apps/api/src/services/`)

Business logic extracted into service classes: `documentService`, `processingService`, `auditService`, `tuningService`, `studyService`, `generationService`, `comparisonService`, `findingReviewService`. Shared patterns:
- `DomainError` (`NOT_FOUND | FORBIDDEN | BAD_REQUEST | CONFLICT | PRECONDITION_FAILED`) → auto-mapped to `TRPCError` via `withDomainErrors` middleware
- `requireTenantResource()` — reusable tenant isolation guard

### tRPC Router (`apps/api/src/routers/`)

11 thin sub-routers delegating to service layer: `auth`, `study`, `document`, `processing`, `audit`, `comparison`, `generation`, `tuning`, `wordAddin`, `findingReview`. Plus REST endpoints for Word sessions and report downloads.

Frontend type-safety: `apps/web/src/lib/trpc.ts` imports `AppRouter` type directly from API package.

### Processing Pipeline (5-level)

Every extraction/classification step can go through up to 5 levels:
1. **Deterministic** — regex/keyword rules (rules-engine)
2. **LLM Check** — LLM verifies deterministic results (llm-gateway)
3. **LLM QA** — arbitration when levels 1 and 2 disagree
4. **Operator Review** — optional manual step
5. **User Validation** — final confirmation

Pipeline jobs: `parse_document`, `classify_sections`, `extract_facts`, `intra_doc_audit`, `generate_icf`, `generate_csr`. Orchestrated via `apps/workers/src/pipeline/orchestrator.ts`.

Workers features:
- **Job-level retry**: BullMQ exponential backoff via `lib/retry-config.ts` (parse/classify/extract: 3 attempts, audit: 2, generation: 2)
- **Step-level retry**: Inside one handler invocation, `llm_check` and `llm_qa` steps retry with exponential backoff via `lib/step-retry.ts` (3 attempts, baseDelayMs=5000). `deterministic`/`operator_review`/`user_validation` do not retry (maxAttempts=1)
- **Idempotency**: Each `ProcessingStep` gets `idempotencyKey = ${runId}:${level}:${attempt}` plus `attemptNumber` updated per retry. Orchestrator skips already completed steps and deletes failed ones before re-execution
- **DLQ**: Dead-letter queue (`processing-dlq`) for exhausted retries (`dlq.ts`)
- **Startup recovery**: Marks stale `running` pipelines (>5min) as `failed` on worker restart (`lib/startup-recovery.ts`)
- **Metrics**: Step-level timing, attempt count and pipeline completion metrics (`lib/metrics.ts`)

### Document Version Status Flow

```
uploading → parsing → classifying_sections → extracting_facts → detecting_soa
  → ready → intra_audit → inter_audit → impact_assessment → parsed | error
```

### Multi-Tenancy & Auth

- Tenant isolation via `tenantId` foreign key on all data models
- JWT access tokens (15min) + refresh tokens (30 days)
- 6 roles: `writer`, `qc_operator`, `findings_reviewer`, `rule_admin`, `rule_approver`, `tenant_admin`
- tRPC middleware `verifyAccessToken` on protected procedures
- `requireTenantResource()` guard replaces inline fetch-check-throw patterns
- **Global-vs-tenant resources** (e.g. `RuleSet`): when a model has nullable `tenantId`, queries must use `where: { OR: [{ tenantId }, { tenantId: null }] }` with `orderBy: { tenantId: { sort: "desc", nulls: "last" } }` to prefer tenant-specific over global
- **Inter-document audit**: any endpoint that takes a `(protocolVersionId, checkedVersionId)` pair must validate the pair via `validateInterAuditPair()` — checks both belong to the tenant, the protocol is actually `type='protocol'`, and both belong to the same study

### LLM Configuration

Per-task LLM settings via environment variables (`LLM_*_PROVIDER`, `LLM_*_MODEL`, `LLM_*_TEMPERATURE`). Gateway normalizes provider differences behind `LLMGateway.generate()`.

## Environment

Copy `.env.example` to `.env`. Key variables: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `STORAGE_TYPE` (local|s3), `NEXT_PUBLIC_API_URL`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`.

### Observability

- Structured JSON logging via `logger` (auto-enriches `correlationId`, `tenantId`, `userId` from `AsyncLocalStorage` context)
- API: `requestLogger()` middleware wraps each request in `asyncContext.run()`
- Workers: each job wrapped in `asyncContext.run()` with correlationId from job data
- No `console.*` calls — all output via `logger`

### Testing

- **Framework**: Vitest with workspace mode (`vitest.workspace.ts`)
- **Coverage**:
  - `packages/rules-engine` — section-classifier, fact-extractor, contradiction-detector (130+ tests)
  - `packages/doc-parser` — heading-detector, table-parser, footnote-extractor
  - `apps/api/src/services/__tests__` — service-layer tests for `study`, `document`, `audit`, `processing`, `evaluation` (+90 tests)
  - `apps/api/src/__tests__/integration` — integration tests on real DB: `auth`, `document-upload`, `tenant-isolation`
  - `apps/workers/src/handlers/__tests__` — all 10 handlers covered (parse, classify, extract, intra/inter audit, generate-icf/csr, run-evaluation, run-batch-evaluation, analyze-corrections, run-pipeline) (90+ tests)
  - `apps/workers/src/pipeline/__tests__/orchestrator.test.ts` + `lib/__tests__/step-retry.test.ts`
- **Run**: `npm test` or `npx turbo test`. CI runs `--coverage --coverage.reporter=text`. Turbo-passed env vars for tests: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NODE_ENV` (configured in `turbo.json` `test.env`)
- **E2E**: Playwright in `apps/web/e2e/` and `apps/rule-admin/e2e/` (auth flow, navigation, golden-dataset, visual regression). Run: `npm run e2e --workspace=@clinscriptum/web`

### Linting

- **ESLint**: Flat config (`eslint.config.mjs`) with `typescript-eslint`. `no-console: warn`.
- **Run**: `npm run lint` or `npx turbo lint`

### Security

- Never log JWT tokens, API keys, passwords, or patient/clinical data
- All new tRPC procedures must use `verifyAccessToken` middleware (see `apps/api/src/trpc/trpc.ts`)
- Every DB query on tenant data must filter by `tenantId` — use `requireTenantResource()` guard
- All tRPC inputs validated via Zod schemas — never trust raw input
- No `eval()`, no dynamic `require()`, no SQL string concatenation
- File uploads: validate MIME type, enforce size limits, sanitize filenames

### Common gotchas

- After editing `packages/db/prisma/schema.prisma`: run `npm run db:generate` before typecheck
- After adding a new tRPC router: register it in `apps/api/src/routers/index.ts` (import + add to `router({})`)
- ESM: imports in `apps/api` and `apps/workers` require `.js` extension (`import { x } from './file.js'`)
- After adding new service: export from `apps/api/src/services/index.ts`
- Prisma migrations: when schema changes, **always** create a migration via `npx prisma migrate dev --name <descriptive_name>` — do NOT use `prisma db push` (it creates schema drift between dev DB and the migrations folder, which breaks `prisma migrate deploy` in CI). The `20260430100000_consolidate_schema_drift` migration was needed to recover from past `db push` usage; avoid recreating that situation.
- Prisma enums: after adding enum value, create migration `npx prisma migrate dev --name add_enum_value`
- New large list-returning queries (findings, sections, etc.) should support cursor-based pagination — see `audit.service.getAuditFindings` pattern: optional `take`/`cursor` in input, `take + 1` query, return `nextCursor`
- `.gitignore` includes `*.sql` for dumps but **whitelists** Prisma migrations via `!packages/db/prisma/migrations/**/*.sql` — don't accidentally re-block them
- Cross-platform lockfile: `package-lock.json` may resolve differently on Windows (npm 11) vs Linux/CI (npm 10), causing `npm ci` to fail on optional native binaries (rollup, swc). CI handles this via `npm ci || npm install --no-audit` fallback + explicit installs of `@rollup/rollup-linux-x64-gnu`, `@next/swc-linux-x64-gnu`, `@emnapi/core`, `@emnapi/runtime`
- Frontend env vars must be prefixed `NEXT_PUBLIC_` to be available in browser
- Fresh worktree (see Parallel Claude Code Sessions): always `npm ci && npm run db:generate` in the new directory before first run — `node_modules` and the generated Prisma client live in the working tree, not in shared `.git`

## Git Workflow

- Never push directly to `master`
- Create feature branch: `git checkout -b feat/short-description`
- Naming: `feat/...`, `fix/...`, `refactor/...`, `docs/...`
- Commit with Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Before committing: run `npm run typecheck && npm run lint && npm test`
- Create PR via `gh pr create`, run `/review` before merging
- Squash merge to master

### Commit message format

```
<type>: <description>

[optional body]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Types: `feat` (new feature), `fix` (bug fix), `refactor` (no behavior change),
`test` (adding tests), `docs` (documentation), `chore` (tooling, deps)

## Parallel Claude Code Sessions

Several Claude Code sessions running in the **same** working directory routinely break each other: a `git checkout` in one rolls back files the other is editing, a `git stash` sweeps up unrelated changes, a `commit` may land on whatever branch the parallel session just switched to. The fix is **one git worktree per concurrent session**.

### Existing worktrees

The repo is set up with worktrees alongside the main checkout. Run `git worktree list` from any worktree to see the current state. Standard layout:

| Directory | Branch |
|---|---|
| `C:\Users\0\Clinscriptum3` | active feature branch (the original checkout) |
| `C:\Users\0\ClinScriptum3-master` | `master` — for hotfixes, review, branching off |
| `C:\Users\0\ClinScriptum3-scratch` | `feat/scratch` — disposable branch for ad-hoc tasks |
| `C:\Users\0\ClinScriptum3-<branch>` | one per active feature branch |

### Workflow

- **Each parallel Claude Code session runs from its own worktree directory.** Never start two sessions in the same directory.
- **Pick the right worktree before starting a task:** if it lines up with an existing branch, `cd` there; otherwise create one.
- **New branch:** `git -C C:/Users/0/Clinscriptum3 worktree add -b feat/<name> ../ClinScriptum3-<name> master`. Branches off master, working tree in a fresh directory.
- **Branching off another branch** (e.g. continuation of in-flight work): replace the trailing `master` with the source branch.
- **First-time setup in a fresh worktree:** `npm ci && npm run db:generate` — `node_modules` and the generated Prisma client are per working tree, not in shared `.git`. Skipping this breaks typecheck/dev.
- **Cleanup after merge:** `git worktree remove ../ClinScriptum3-<name>`. The branch itself stays in the repo until manually deleted with `git branch -D`.
- **If a worktree directory was deleted manually** (e.g. `rm -rf`): `git worktree prune` clears the stale entry under `.git/worktrees/`.

### Constraints to remember

- **One branch can be checked out in only one worktree at a time.** Git locks it; the second `worktree add` for the same branch fails.
- **Dev servers share global ports** (`:3000` web, `:3001` word-addin, `:3002` rule-admin, `:4000` api). Run `npm run dev` in **one** worktree at a time, or override ports via env.
- **Postgres / Redis / MinIO from `docker compose` are shared across worktrees.** That is fine — tenant isolation is enforced in the DB. But destructive migrations or `prisma migrate reset` in one worktree affect all of them.
- **Documentation/process changes (this file, README, etc.) should land via a small branch off master** (e.g. `docs/...`), not piggybacked on a long-running feature branch — otherwise other worktrees see the new rules only after their next rebase from master.

## Before committing

Always run before creating a commit:
1. `npm run typecheck` — must pass with zero errors
2. `npm run lint` — must pass (warnings OK, errors not)
3. `npm test` — all tests must pass
4. Update `changelog.md` with description of changes (Russian, grouped by date)

## Development Process (Plan & Act)

For tasks touching >3 files or spanning multiple layers (DB → API → UI):

0. **Pick the worktree** — make sure the session is running in the right directory (existing worktree for the branch, or create a new one — see [Parallel Claude Code Sessions](#parallel-claude-code-sessions))
1. **Plan** — enter `/plan` mode, describe the task, agree on approach
2. **Research** — explore affected files, check existing patterns
3. **Decompose** — break into atomic steps (migration → service → router → UI → tests)
4. **Execute** — implement each step, commit after each with passing checks
5. **Review** — run `/review` on the branch before creating PR
6. **Simplify** — run `/simplify` to check for duplication and quality

For small tasks (<3 files, single layer): skip steps 1-3, go directly to execute (but step 0 still applies).

### Task decomposition template

When implementing a feature, follow this order:

1. **Schema** — Prisma model changes + migration + `db:generate`
2. **Service** — business logic in `apps/api/src/services/`
3. **Router** — tRPC endpoints in `apps/api/src/routers/`
4. **Workers** — if async processing needed, add handler + orchestrator step
5. **Frontend** — UI in `apps/web/src/app/(app)/`
6. **Tests** — unit for service, integration for router, component for UI
7. **Docs** — update CLAUDE.md if patterns changed

Each step = separate commit. Each commit must pass typecheck + lint.

## CI

GitHub Actions on push/PR to `main` or `master`. Three jobs:

- **build**: `npm ci || npm install --no-audit` → install Linux-only optional deps (rollup/swc/emnapi) → `prisma generate` → `prisma migrate deploy` → `turbo build` → `turbo typecheck` → `turbo lint` → `turbo test --coverage --coverage.reporter=text`. Runs against PostgreSQL 16 and Redis 7 service containers.
- **e2e** (depends on build): runs Playwright for both `apps/web` and `apps/rule-admin` with `continue-on-error: true`
- **security**: `npm audit --audit-level=critical --omit=dev` (blocking) + grep for hardcoded passwords/api-keys (warning). High-severity audit findings surface in build job non-blocking.
