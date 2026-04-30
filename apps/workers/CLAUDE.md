# Workers

BullMQ job processors. No HTTP server.

## Adding a new handler

1. Create `src/handlers/{job-name}.ts`
2. Export async function: `export async function handle{JobName}(job: Job)`
3. Register in `src/index.ts` — add to worker's process switch
4. Add retry config in `src/lib/retry-config.ts`
5. Add to orchestrator if part of pipeline: `src/pipeline/orchestrator.ts`

## Patterns

- Each handler wraps work in `asyncContext.run()` with `correlationId` from job data
- Use `logger` (not console) — auto-enriches with job context
- Idempotency: check if step already completed before re-executing
- Storage: `src/api-shared/storage.ts` — shared with API, uses same MinIO/local config
- LLM calls: use `@clinscriptum/llm-gateway` — never call OpenAI/Anthropic directly

## Pipeline order

parse_document → classify_sections → extract_facts → detect_soa → intra_doc_audit
