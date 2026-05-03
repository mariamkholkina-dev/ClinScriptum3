import { describe, it, expect } from "vitest";
import { __test__ } from "../soa-llm-verification.js";

const { parseLlmResponse, buildUserMessage } = __test__;

describe("parseLlmResponse", () => {
  it("parses a clean JSON response", () => {
    const out = parseLlmResponse(
      '{"is_soa": true, "confidence": 0.92, "reasoning": "Visits in columns, procedures in rows"}',
    );
    expect(out).toEqual({
      isSoa: true,
      confidence: 0.92,
      reasoning: "Visits in columns, procedures in rows",
    });
  });

  it("parses a code-fenced response", () => {
    const out = parseLlmResponse(
      '```json\n{"is_soa": false, "confidence": 0.4}\n```',
    );
    expect(out).toEqual({ isSoa: false, confidence: 0.4 });
  });

  it("returns null for non-JSON content", () => {
    expect(parseLlmResponse("the answer is yes")).toBeNull();
  });

  it("returns null when fields are missing", () => {
    expect(parseLlmResponse('{"is_soa": true}')).toBeNull();
    expect(parseLlmResponse('{"confidence": 0.5}')).toBeNull();
  });

  it("clamps confidence into [0, 1]", () => {
    const high = parseLlmResponse('{"is_soa": true, "confidence": 1.5}');
    expect(high?.confidence).toBe(1);
    const low = parseLlmResponse('{"is_soa": false, "confidence": -0.1}');
    expect(low?.confidence).toBe(0);
  });

  it("returns null for malformed JSON", () => {
    expect(parseLlmResponse('{"is_soa": true, confidence: 0.5}')).toBeNull();
  });
});

describe("buildUserMessage", () => {
  it("includes title, score, visit and procedure counts", () => {
    const msg = buildUserMessage({
      title: "Schedule of Activities",
      visits: ["Visit 1", "Visit 2", "Visit 3"],
      procedures: ["Vital signs", "ECG", "Blood test"],
      sampleRows: [
        ["Vital signs", "X", "X", ""],
        ["ECG", "X", "", "X"],
      ],
      soaScore: 12.5,
    });
    expect(msg).toContain("Schedule of Activities");
    expect(msg).toContain("12.5");
    expect(msg).toContain("Visits (3)");
    expect(msg).toContain("Procedures (3)");
    expect(msg).toContain("Visit 1 | Visit 2 | Visit 3");
    expect(msg).toContain("Is this a SoA?");
  });

  it("truncates long visit and procedure lists", () => {
    const visits = Array.from({ length: 20 }, (_, i) => `V${i + 1}`);
    const procedures = Array.from({ length: 30 }, (_, i) => `P${i + 1}`);
    const msg = buildUserMessage({
      title: "T",
      visits,
      procedures,
      sampleRows: [],
      soaScore: 5,
    });
    expect(msg).toContain("V1 | V2");
    expect(msg).toContain("V12");
    expect(msg).not.toContain("V13"); // first 12 only
    expect(msg).toContain("P1, P2");
    expect(msg).not.toContain("P16"); // first 15 only
  });
});
