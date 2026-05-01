# Workers

BullMQ job processors. No HTTP server.

## Handlers (10 total)

| Handler | Purpose |
|---|---|
| `parse-document` | DOCX → Section + ContentBlock |
| `classify-sections` | Section → standardSection (deterministic + LLM check + LLM QA) |
| `extract-facts` | Section content → Fact (regex + LLM extraction + QA) |
| `intra-doc-audit` | Findings within one document (editorial + semantic) |
| `generate-icf` | Protocol → ICF sections (LLM generation) |
| `generate-csr` | Protocol → CSR sections (LLM generation, URS-082 priority sections) |
| `run-pipeline` | Full document pipeline (parse → classify → extract → detect_soa → intra_audit) |
| `run-evaluation` | Per-sample evaluation against goldenSamples (precision/recall/f1) |
| `run-batch-evaluation` | Aggregate confidence/agreement across all DocumentVersions in tenant |
| `analyze-corrections` | Group user corrections by pattern, create CorrectionRecommendation |

## Adding a new handler

1. Create `src/handlers/{job-name}.ts`
2. Export async function: `export async function handle{JobName}(data: {...})`
3. Register in `src/index.ts` — add to worker's process switch
4. Add retry config in `src/lib/retry-config.ts`
5. Add to orchestrator if part of pipeline: `src/pipeline/orchestrator.ts`
6. Add tests in `src/handlers/__tests__/{job-name}.test.ts` (cover happy path + LLM error + edge cases)

## Patterns

- Each handler wraps work in `asyncContext.run()` with `correlationId` from job data
- Use `logger` (not console) — auto-enriches with job context
- LLM calls: use `@clinscriptum/llm-gateway` — never call OpenAI/Anthropic directly
- Storage: `src/api-shared/storage.ts` — shared with API, uses same MinIO/local config

## Step-level retry (orchestrator)

Inside `runPipeline`, each step is wrapped in `executeStepWithRetry(level, fn)` from `lib/step-retry.ts`:
- `deterministic`/`operator_review`/`user_validation`: maxAttempts=1 (no retry)
- `llm_check`/`llm_qa`: maxAttempts=3, baseDelayMs=5000, exponential backoff

Each attempt updates `ProcessingStep.attemptNumber` and `ProcessingStep.idempotencyKey = ${runId}:${level}:${attempt}` in the DB. Use that key for downstream LLM dedup if needed.

## Pipeline order (run-pipeline handler)

parse_document → classify_sections → extract_facts (protocol only) → detect_soa (protocol only) → intra_doc_audit
