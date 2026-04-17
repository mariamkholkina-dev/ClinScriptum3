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
| `apps/workers` | — | BullMQ job processors (5 concurrent). Connects to Redis for queue, PostgreSQL for data |
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
- **Retry**: Per-job-type exponential backoff via `lib/retry-config.ts` (parse/classify/extract: 3 attempts, audit: 2, generation: 2)
- **DLQ**: Dead-letter queue (`processing-dlq`) for exhausted retries (`dlq.ts`)
- **Idempotency**: Orchestrator skips completed steps on retry, cleans up failed steps before re-execution
- **Startup recovery**: Marks stale `running` pipelines (>5min) as `failed` on worker restart (`lib/startup-recovery.ts`)
- **Metrics**: Step-level timing and pipeline completion metrics (`lib/metrics.ts`)

### Document Version Status Flow

```
uploading → parsing → classifying_sections → extracting_facts → detecting_soa
  → ready → intra_audit → inter_audit → impact_assessment → parsed | error
```

### Multi-Tenancy & Auth

- Tenant isolation via `tenantId` foreign key on all data models
- JWT access tokens (15min) + refresh tokens (30 days)
- 5 roles: `writer`, `qc_operator`, `findings_reviewer`, `rule_admin`, `tenant_admin`
- tRPC middleware `verifyAccessToken` on protected procedures
- `requireTenantResource()` guard replaces inline fetch-check-throw patterns

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
- **Tested packages**: `rules-engine` (section-classifier, fact-extractor, contradiction-detector), `doc-parser` (heading-detector, table-parser, footnote-extractor)
- **Run**: `npm test` or `npx turbo test`

### Linting

- **ESLint**: Flat config (`eslint.config.mjs`) with `typescript-eslint`. `no-console: warn`.
- **Run**: `npm run lint` or `npx turbo lint`

## CI

GitHub Actions on push/PR to `main`: `npm ci` → `prisma generate` → `prisma migrate deploy` → `turbo build` → `turbo typecheck` → `turbo lint` → `turbo test`. Runs against PostgreSQL 16 and Redis 7 service containers.
