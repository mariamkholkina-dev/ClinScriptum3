import type { PipelineLevel } from "@clinscriptum/shared";
import { logger } from "./logger.js";

/**
 * Per-level step retry configuration.
 *
 * Deterministic / operator_review / user_validation are pure logic or human
 * gates — retrying them on transient failure makes no sense, so maxAttempts=1.
 *
 * llm_check / llm_qa call external LLM providers and benefit from
 * exponential backoff against transient 5xx / 429 / network errors. The retry
 * is scoped to a single ProcessingStep — the BullMQ-level retry restarts the
 * entire handler from scratch and was the only safety net previously.
 */
export interface StepRetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: Record<PipelineLevel, StepRetryConfig> = {
  deterministic: { maxAttempts: 1, baseDelayMs: 0 },
  llm_check: { maxAttempts: 3, baseDelayMs: 5000 },
  llm_qa: { maxAttempts: 3, baseDelayMs: 5000 },
  operator_review: { maxAttempts: 1, baseDelayMs: 0 },
  user_validation: { maxAttempts: 1, baseDelayMs: 0 },
};

export function getStepRetryConfig(level: PipelineLevel): StepRetryConfig {
  return DEFAULT_RETRY_CONFIG[level];
}

/**
 * Stable idempotency key for a step attempt. Future consumers can use it to
 * dedupe side-effects (e.g. LLM provider call cost) on a retry.
 */
export function makeIdempotencyKey(
  processingRunId: string,
  level: PipelineLevel,
  attempt: number,
): string {
  return `${processingRunId}:${level}:${attempt}`;
}

/**
 * Run `fn` with per-level retry. Returns the value of the last successful
 * attempt and the attempt number it succeeded on.
 *
 * `fn` is invoked with `(attempt: number)` so callers can sync DB state for
 * each attempt (attemptNumber, idempotencyKey).
 */
export async function executeStepWithRetry<T>(
  level: PipelineLevel,
  fn: (attempt: number) => Promise<T>,
  config: StepRetryConfig = getStepRetryConfig(level),
): Promise<{ value: T; finalAttempt: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const value = await fn(attempt);
      return { value, finalAttempt: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt === config.maxAttempts) break;
      const delay = config.baseDelayMs * 2 ** (attempt - 1);
      logger.warn("Pipeline step retry", {
        pipelineLevel: level,
        attempt,
        maxAttempts: config.maxAttempts,
        delayMs: delay,
        error: (err as Error).message,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
