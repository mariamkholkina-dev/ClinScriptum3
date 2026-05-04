/**
 * Robust JSON extractor + Zod validator for LLM responses.
 *
 * Phase 4 fact-extraction roadmap. Replaces the greedy `[\s\S]*]`
 * regex with a stack-based balanced bracket scanner, and adds
 * Zod validation so callers learn about shape mismatches instead
 * of getting silent type-cast results.
 *
 * Usage:
 *   const result = parseLlmJson(raw, MyZodSchema);
 *   if (result.ok) use(result.data);
 *   else logger.warn("invalid llm payload", { error: result.error });
 */

import { z, type ZodSchema, type ZodError } from "zod";

export type ParseResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: string; raw?: string };

const REFUSAL_PATTERNS = /не\s+могу\s+(обсуждать|помочь)|давайте\s+поговорим/i;

function stripThinking(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Find a balanced JSON array or object span in text. Returns the
 * first balanced span (prefers arrays, falls back to objects).
 */
export function findJsonSpan(text: string): string | null {
  const cleaned = stripThinking(text);
  if (REFUSAL_PATTERNS.test(cleaned)) return null;

  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ]) {
    const start = cleaned.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return cleaned.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Parse and validate an LLM JSON payload against a Zod schema.
 * Returns a discriminated union so callers can branch on success.
 */
export function parseLlmJson<T>(raw: string, schema: ZodSchema<T>): ParseResult<T> {
  const span = findJsonSpan(raw);
  if (!span) return { ok: false, error: "no balanced JSON span found" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(span);
  } catch (e) {
    return { ok: false, error: `JSON.parse failed: ${(e as Error).message}`, raw: span };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = (result.error as ZodError).issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `schema validation failed: ${issues}`, raw: span };
  }
  return { ok: true, data: result.data, raw: span };
}

/**
 * Like `parseLlmJson`, but on validation failure invokes `retryFn` once
 * with a hint string built from the Zod error and re-validates the
 * second response. Use when the cost of a malformed payload is high
 * (e.g. losing a whole fact-extraction call).
 *
 * The retry hint is passed to `retryFn` so the caller can prepend or
 * append it to its prompt as it sees fit.
 */
export async function parseLlmJsonWithRetry<T>(
  raw: string,
  schema: ZodSchema<T>,
  retryFn: (hint: string) => Promise<string>,
): Promise<ParseResult<T>> {
  const first = parseLlmJson(raw, schema);
  if (first.ok) return first;
  const hint = `Твой предыдущий ответ не прошёл валидацию схемы: ${first.error}. Повтори ответ строго в указанном JSON-формате, без пояснений.`;
  let retryRaw: string;
  try {
    retryRaw = await retryFn(hint);
  } catch (e) {
    return { ok: false, error: `retry call failed: ${(e as Error).message}` };
  }
  const second = parseLlmJson(retryRaw, schema);
  if (second.ok) return second;
  return { ok: false, error: `retry also failed: ${second.error}`, raw: second.raw ?? first.raw };
}

/**
 * Common schemas used by fact-extraction prompts. Re-exported so
 * callers don't have to redefine them in every handler.
 */
export const FactExtractionItemSchema = z.object({
  fact_key: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1).optional().default(0.7),
  source_text: z.string().optional().default(""),
});
export const FactExtractionArraySchema = z.array(FactExtractionItemSchema);

export const TargetedFactSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1).optional().default(0),
  source_text: z.string().optional().default(""),
});

export type FactExtractionItem = z.infer<typeof FactExtractionItemSchema>;
export type TargetedFact = z.infer<typeof TargetedFactSchema>;
