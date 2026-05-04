import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  parseLlmJson,
  parseLlmJsonWithRetry,
  findJsonSpan,
  FactExtractionItemSchema,
  FactExtractionArraySchema,
  TargetedFactSchema,
} from "@clinscriptum/shared";

describe("findJsonSpan", () => {
  it("returns null for empty input", () => {
    expect(findJsonSpan("")).toBeNull();
  });

  it("returns null for refusal text", () => {
    expect(findJsonSpan("Не могу обсуждать эту тему.")).toBeNull();
  });

  it("strips <think> blocks", () => {
    const out = findJsonSpan("<think>reasoning</think>[1,2,3]");
    expect(out).toBe("[1,2,3]");
  });

  it("finds balanced array span", () => {
    const out = findJsonSpan("intro [{\"a\":1}] outro");
    expect(out).toBe("[{\"a\":1}]");
  });

  it("finds nested object span", () => {
    const out = findJsonSpan("answer: {\"a\":{\"b\":1}}");
    expect(out).toBe("{\"a\":{\"b\":1}}");
  });

  it("handles strings with escaped brackets", () => {
    const out = findJsonSpan(`{"text": "string with ] inside"}`);
    expect(out).toBe(`{"text": "string with ] inside"}`);
  });

  it("prefers array when both present", () => {
    const out = findJsonSpan(`[1,2,3] {"a":1}`);
    expect(out).toBe("[1,2,3]");
  });
});

describe("parseLlmJson", () => {
  it("validates a fact-extraction array", () => {
    const raw = `[{"fact_key":"sponsor","value":"Acme","confidence":0.9,"source_text":"Sponsor: Acme"}]`;
    const r = parseLlmJson(raw, FactExtractionArraySchema);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].value).toBe("Acme");
    }
  });

  it("rejects payload missing required field", () => {
    const raw = `[{"fact_key":"sponsor"}]`;
    const r = parseLlmJson(raw, FactExtractionArraySchema);
    expect(r.ok).toBe(false);
  });

  it("returns parsed targeted fact with null value", () => {
    const r = parseLlmJson(`{"value": null}`, TargetedFactSchema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.value).toBeNull();
  });

  it("clamps confidence to [0,1] range", () => {
    const r = parseLlmJson(`{"value":"x","confidence":1.5}`, TargetedFactSchema);
    expect(r.ok).toBe(false);
  });

  it("works with custom Zod schema", () => {
    const r = parseLlmJson(`{"a":1,"b":"two"}`, z.object({ a: z.number(), b: z.string() }));
    expect(r.ok).toBe(true);
  });

  it("returns error for malformed JSON", () => {
    const r = parseLlmJson(`{"a": 1, b: 2}`, z.object({ a: z.number() }));
    expect(r.ok).toBe(false);
  });

  it("strips think blocks before parsing", () => {
    const r = parseLlmJson(
      `<think>thinking aloud...</think>[{"fact_key":"x","value":"y"}]`,
      FactExtractionArraySchema,
    );
    expect(r.ok).toBe(true);
  });
});

describe("FactExtractionItemSchema defaults", () => {
  it("supplies default confidence and source_text", () => {
    const r = FactExtractionItemSchema.parse({ fact_key: "x", value: "y" });
    expect(r.confidence).toBe(0.7);
    expect(r.source_text).toBe("");
  });
});

describe("parseLlmJsonWithRetry", () => {
  it("returns first parse if valid", async () => {
    const retry = vi.fn();
    const r = await parseLlmJsonWithRetry(
      `[{"fact_key":"x","value":"y"}]`,
      FactExtractionArraySchema,
      retry,
    );
    expect(r.ok).toBe(true);
    expect(retry).not.toHaveBeenCalled();
  });

  it("invokes retryFn with hint and returns retry result on success", async () => {
    const retry = vi.fn().mockResolvedValue(`[{"fact_key":"x","value":"y"}]`);
    const r = await parseLlmJsonWithRetry(
      `garbage`,
      FactExtractionArraySchema,
      retry,
    );
    expect(retry).toHaveBeenCalledOnce();
    const hint = retry.mock.calls[0]![0] as string;
    expect(hint).toContain("не прошёл валидацию");
    expect(r.ok).toBe(true);
  });

  it("returns failure when retry also invalid", async () => {
    const retry = vi.fn().mockResolvedValue(`also garbage`);
    const r = await parseLlmJsonWithRetry(
      `garbage`,
      FactExtractionArraySchema,
      retry,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/retry also failed/);
  });

  it("returns failure when retry call throws", async () => {
    const retry = vi.fn().mockRejectedValue(new Error("network"));
    const r = await parseLlmJsonWithRetry(
      `garbage`,
      FactExtractionArraySchema,
      retry,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/retry call failed: network/);
  });
});
