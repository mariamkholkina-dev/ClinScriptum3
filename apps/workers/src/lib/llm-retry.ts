import { logger } from "./logger.js";

/**
 * Признаки временной (transient) ошибки LLM-вызова, которую имеет смысл
 * повторить: сетевые сбои (`fetch failed`), таймауты, разрывы соединения,
 * 429/5xx, перегрузка провайдера. Аутентификация/невалидный запрос/превышение
 * лимита токенов сюда НЕ попадают — их повтор бессмыслен.
 */
const TRANSIENT_PATTERNS = [
  "fetch failed",
  "network",
  "timeout",
  "timed out",
  "econnreset",
  "econnrefused",
  "etimedout",
  "enotfound",
  "socket hang up",
  "socket",
  "502",
  "503",
  "504",
  "429",
  "rate limit",
  "overloaded",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
];

export function isTransientLLMError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => m.includes(p));
}

/**
 * Выполняет LLM-вызов с повтором при временной ошибке (экспоненциальный
 * backoff). Постоянные ошибки пробрасываются сразу — повтор не поможет.
 * После исчерпания попыток бросает последнюю ошибку (вызывающий код решает,
 * что делать — например, записать промт в failedCalls).
 *
 * Назначение: один упавший по `fetch failed` промт intra-audit должен сначала
 * несколько раз повториться, прежде чем считаться упавшим (см. #159/#160 —
 * там промт сразу попадал в failedCalls без повтора).
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: { label: string; attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 5000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isTransientLLMError(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.warn("[llm-retry] transient LLM error — retrying later", {
        label: opts.label,
        attempt,
        maxAttempts: attempts,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
