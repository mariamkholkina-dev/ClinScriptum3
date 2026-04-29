# Rules Engine

Deterministic classification and extraction rules. No LLM calls.

## Structure

- `src/section-classifier/` — classifies document sections by zone (synopsis, objectives, etc.)
- `src/fact-extractor/` — extracts structured facts from section content
- `src/contradiction-detector/` — finds contradictions between facts
- `src/rule-adapter.ts` — loads rules from DB RuleSet system

## Tests

All rules must have tests. Location: `src/__tests__/`

```bash
npx vitest run                    # run all
npx vitest run section-classifier # run specific
```

## Adding a new rule

1. Add pattern/logic in appropriate module
2. Add test case in `src/__tests__/{module}.test.ts`
3. Run `npx vitest run` — must pass
