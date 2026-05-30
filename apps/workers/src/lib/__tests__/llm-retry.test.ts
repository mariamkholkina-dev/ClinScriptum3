import { describe, it, expect, vi } from "vitest";
import { isTransientLLMError, withTransientRetry } from "../llm-retry.js";

describe("isTransientLLMError", () => {
  it("recognises fetch failed / network / 5xx / 429 as transient", () => {
    expect(isTransientLLMError(new Error("fetch failed"))).toBe(true);
    expect(isTransientLLMError(new Error("socket hang up"))).toBe(true);
    expect(isTransientLLMError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientLLMError(new Error("429 rate limit exceeded"))).toBe(true);
    expect(isTransientLLMError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("treats auth / bad-request / token-limit as non-transient", () => {
    expect(isTransientLLMError(new Error("401 Unauthorized"))).toBe(false);
    expect(isTransientLLMError(new Error("invalid request: maxTokens too large"))).toBe(false);
  });
});

describe("withTransientRetry", () => {
  it("retries a transient failure then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce("ok");

    const result = await withTransientRetry(fn, { label: "t", attempts: 3, baseDelayMs: 0 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting attempts on persistent transient error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fetch failed"));

    await expect(
      withTransientRetry(fn, { label: "t", attempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a non-transient error — fails fast", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      withTransientRetry(fn, { label: "t", attempts: 3, baseDelayMs: 0 }),
    ).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withTransientRetry(fn, { label: "t", baseDelayMs: 0 });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
