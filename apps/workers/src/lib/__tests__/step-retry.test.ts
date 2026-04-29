import { describe, it, expect, vi } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { executeStepWithRetry, makeIdempotencyKey, getStepRetryConfig } from "../step-retry.js";

describe("makeIdempotencyKey", () => {
  it("includes processingRunId, level and attempt", () => {
    expect(makeIdempotencyKey("run-1", "llm_check", 2)).toBe("run-1:llm_check:2");
  });

  it("two different attempts produce different keys", () => {
    const a = makeIdempotencyKey("run-1", "llm_check", 1);
    const b = makeIdempotencyKey("run-1", "llm_check", 2);
    expect(a).not.toBe(b);
  });
});

describe("getStepRetryConfig", () => {
  it("deterministic / operator_review / user_validation: maxAttempts=1 (no retry)", () => {
    expect(getStepRetryConfig("deterministic").maxAttempts).toBe(1);
    expect(getStepRetryConfig("operator_review").maxAttempts).toBe(1);
    expect(getStepRetryConfig("user_validation").maxAttempts).toBe(1);
  });

  it("llm_check / llm_qa: maxAttempts>1 with positive baseDelayMs (exponential backoff)", () => {
    expect(getStepRetryConfig("llm_check").maxAttempts).toBeGreaterThan(1);
    expect(getStepRetryConfig("llm_check").baseDelayMs).toBeGreaterThan(0);
    expect(getStepRetryConfig("llm_qa").maxAttempts).toBeGreaterThan(1);
  });
});

describe("executeStepWithRetry", () => {
  it("returns immediately on first success without delaying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await executeStepWithRetry("llm_check", fn);

    expect(result).toEqual({ value: "ok", finalAttempt: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it("retries on failure and succeeds on later attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValueOnce("ok");

    const result = await executeStepWithRetry(
      "llm_check",
      fn,
      // override config: zero delay so test runs fast
      { maxAttempts: 3, baseDelayMs: 0 },
    );

    expect(result).toEqual({ value: "ok", finalAttempt: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
  });

  it("throws the LAST error after maxAttempts exhausted", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("err1"))
      .mockRejectedValueOnce(new Error("err2"))
      .mockRejectedValueOnce(new Error("err3"));

    await expect(
      executeStepWithRetry("llm_check", fn, { maxAttempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow("err3");

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry when maxAttempts=1 (deterministic-style)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));

    await expect(
      executeStepWithRetry("deterministic", fn),
    ).rejects.toThrow("nope");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff: delay = baseDelay * 2^(attempt-1)", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValueOnce("ok");

    const promise = executeStepWithRetry(
      "llm_check",
      fn,
      { maxAttempts: 3, baseDelayMs: 1000 },
    );

    // Attempt 1 fails sync; promise pending on first delay (1000ms)
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance 1000ms → attempt 2 fires
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Now in delay before attempt 3 (2000ms). Advance 1999ms — still pending.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(2);

    // Advance final 1ms → attempt 3 fires and succeeds
    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result).toEqual({ value: "ok", finalAttempt: 3 });

    vi.useRealTimers();
  });
});
