import { describe, it, expect } from "vitest";
import {
  parseExpectedSoa,
  computeSoaMetrics,
  type ActualSoaTable,
} from "../soa-metrics.js";

describe("parseExpectedSoa", () => {
  it("returns null when input is empty/wrong shape", () => {
    expect(parseExpectedSoa(null)).toBeNull();
    expect(parseExpectedSoa(undefined)).toBeNull();
    expect(parseExpectedSoa({})).toBeNull();
    expect(parseExpectedSoa({ soaTables: "not-an-array" })).toBeNull();
    expect(parseExpectedSoa({ soaTables: [] })).toBeNull();
  });

  it("parses a minimal SoA with visits and procedures", () => {
    const out = parseExpectedSoa({
      soaTables: [{ visits: ["V1", "V2"], procedures: ["P1"] }],
    });
    expect(out).not.toBeNull();
    expect(out!.soaTables).toHaveLength(1);
    expect(out!.soaTables[0].visits).toEqual(["V1", "V2"]);
    expect(out!.soaTables[0].procedures).toEqual(["P1"]);
  });

  it("filters out malformed cells/anchors", () => {
    const out = parseExpectedSoa({
      soaTables: [
        {
          visits: ["V1"],
          procedures: ["P1"],
          cells: [
            { procedure: "P1", visit: "V1", value: "X" },
            { procedure: "no-visit-key" }, // malformed → dropped
          ],
          footnoteAnchors: [
            { procedure: "P1", visit: "V1", marker: "1" },
            { procedure: 5 }, // malformed → dropped
          ],
        },
      ],
    });
    expect(out!.soaTables[0].cells).toHaveLength(1);
    expect(out!.soaTables[0].footnoteAnchors).toHaveLength(1);
  });
});

describe("computeSoaMetrics", () => {
  it("returns null metrics when expected is null", () => {
    const m = computeSoaMetrics(null, []);
    expect(m.detectionAgreement).toBeNull();
    expect(m.visit).toBeNull();
    expect(m.cell).toBeNull();
  });

  it("perfect match → all F1 = 1.0 and detectionAgreement=1", () => {
    const expected = parseExpectedSoa({
      soaTables: [
        {
          visits: ["V1", "V2"],
          procedures: ["P1", "P2"],
          cells: [
            { procedure: "P1", visit: "V1", value: "X" },
            { procedure: "P2", visit: "V2", value: "X" },
          ],
        },
      ],
    });
    const actual: ActualSoaTable[] = [
      {
        cells: [
          { procedureName: "P1", visitName: "V1", rawValue: "X", normalizedValue: "X", manualValue: null },
          { procedureName: "P2", visitName: "V2", rawValue: "X", normalizedValue: "X", manualValue: null },
        ],
        footnoteAnchors: [],
      },
    ];
    const m = computeSoaMetrics(expected, actual);
    expect(m.detectionAgreement).toBe(1);
    expect(m.visit!.f1).toBeCloseTo(1, 5);
    expect(m.procedure!.f1).toBeCloseTo(1, 5);
    expect(m.cell!.f1).toBeCloseTo(1, 5);
  });

  it("partial cell match — 1 hit out of 2 expected and 2 actual gives F1=0.5", () => {
    const expected = parseExpectedSoa({
      soaTables: [
        {
          visits: ["V1", "V2"],
          procedures: ["P1"],
          cells: [
            { procedure: "P1", visit: "V1", value: "X" },
            { procedure: "P1", visit: "V2", value: "X" },
          ],
        },
      ],
    });
    const actual: ActualSoaTable[] = [
      {
        cells: [
          { procedureName: "P1", visitName: "V1", rawValue: "X", normalizedValue: "X", manualValue: null },
          { procedureName: "P1", visitName: "V2", rawValue: "", normalizedValue: "", manualValue: null }, // empty (does not contribute)
        ],
        footnoteAnchors: [],
      },
    ];
    const m = computeSoaMetrics(expected, actual);
    expect(m.cell!.precision).toBeCloseTo(1, 5); // actual has 1 cell → tp=1
    expect(m.cell!.recall).toBeCloseTo(0.5, 5);  // 1 of 2 expected matched
  });

  it("missed detection: expected has SoA but actual is empty → detectionAgreement=0", () => {
    const expected = parseExpectedSoa({
      soaTables: [{ visits: ["V1"], procedures: ["P1"] }],
    });
    const m = computeSoaMetrics(expected, []);
    expect(m.detectionAgreement).toBe(0);
    expect(m.visit!.precision).toBe(0); // no actual visits
    expect(m.visit!.recall).toBe(0);
  });

  it("footnoteLink null when neither side has anchors; otherwise computed", () => {
    const expected = parseExpectedSoa({
      soaTables: [
        {
          visits: ["V1"],
          procedures: ["P1"],
          footnoteAnchors: [{ procedure: "P1", visit: "V1", marker: "1" }],
        },
      ],
    });
    const noAnchors = computeSoaMetrics(expected, [
      { cells: [{ procedureName: "P1", visitName: "V1", rawValue: "X", normalizedValue: "X", manualValue: null }], footnoteAnchors: [] },
    ]);
    expect(noAnchors.footnoteLink).not.toBeNull();
    expect(noAnchors.footnoteLink!.recall).toBe(0); // expected has 1, actual 0
    expect(noAnchors.footnoteLink!.precision).toBe(0);

    const expected2 = parseExpectedSoa({ soaTables: [{ visits: ["V1"], procedures: ["P1"] }] });
    const both = computeSoaMetrics(expected2, [
      { cells: [], footnoteAnchors: [] },
    ]);
    expect(both.footnoteLink).toBeNull();
  });
});
