import { describe, it, expect } from "vitest";
import {
  applyCalibration,
  brierScore,
  DEFAULT_CALIBRATION,
} from "../canonicalize.js";

describe("applyCalibration", () => {
  it("returns ~0.5 for raw 0.5 with default coefficients", () => {
    const out = applyCalibration(0.5, "sponsor", "synopsis", 1);
    expect(out).toBeGreaterThan(0.45);
    expect(out).toBeLessThan(0.55);
  });

  it("monotonically increases with raw confidence", () => {
    const a = applyCalibration(0.3, "sponsor", null, 1);
    const b = applyCalibration(0.7, "sponsor", null, 1);
    expect(b).toBeGreaterThan(a);
  });

  it("monotonically increases with nSources", () => {
    const a = applyCalibration(0.7, "sponsor", null, 1);
    const b = applyCalibration(0.7, "sponsor", null, 5);
    expect(b).toBeGreaterThan(a);
  });

  it("uses prior when provided", () => {
    const coefs = {
      ...DEFAULT_CALIBRATION,
      prior: { sponsor: { synopsis: 1.0 } },
    };
    const withPrior = applyCalibration(0.5, "sponsor", "synopsis", 1, coefs);
    const noPrior = applyCalibration(0.5, "sponsor", "body", 1, coefs);
    expect(withPrior).toBeGreaterThan(noPrior);
  });

  it("output always in [0, 1]", () => {
    const samples = [
      applyCalibration(0, "x", null, 0),
      applyCalibration(1, "x", null, 100),
      applyCalibration(0.5, "x", null, 1),
    ];
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("brierScore", () => {
  it("perfect prediction has Brier score 0", () => {
    expect(brierScore(1, 1)).toBe(0);
    expect(brierScore(0, 0)).toBe(0);
  });

  it("worst prediction has Brier score 1", () => {
    expect(brierScore(1, 0)).toBe(1);
    expect(brierScore(0, 1)).toBe(1);
  });

  it("uncertain prediction has Brier score 0.25", () => {
    expect(brierScore(0.5, 0)).toBeCloseTo(0.25);
    expect(brierScore(0.5, 1)).toBeCloseTo(0.25);
  });
});
