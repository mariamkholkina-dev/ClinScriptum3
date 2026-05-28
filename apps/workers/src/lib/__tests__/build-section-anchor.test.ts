import { describe, expect, it } from "vitest";
import { buildSectionAnchor, parseSectionAnchor } from "../build-section-anchor.js";

describe("buildSectionAnchor", () => {
  it("builds [S<path>:<type>] for section with headingNumber and standardSection", () => {
    expect(
      buildSectionAnchor({
        id: "x",
        title: "Первичная цель",
        headingNumber: "2.1",
        standardSection: "objectives",
        order: 7,
      }),
    ).toBe("[S2.1:objectives]");
  });

  it("builds [S<path>] when standardSection is null", () => {
    expect(
      buildSectionAnchor({
        id: "x",
        title: "Раздел",
        headingNumber: "1.2.3",
        standardSection: null,
        order: 5,
      }),
    ).toBe("[S1.2.3]");
  });

  it("falls back to [S#<order>:<type>] when headingNumber is null", () => {
    expect(
      buildSectionAnchor({
        id: "x",
        title: "Без номера",
        headingNumber: null,
        standardSection: "synopsis",
        order: 0,
      }),
    ).toBe("[S#0:synopsis]");
  });

  it("falls back to [S#<order>] when both headingNumber and standardSection are null", () => {
    expect(
      buildSectionAnchor({
        id: "x",
        title: "Bold-only heading",
        headingNumber: null,
        standardSection: null,
        order: 42,
      }),
    ).toBe("[S#42]");
  });

  it("returns [S?] when no positional information at all", () => {
    expect(
      buildSectionAnchor({
        id: "x",
        title: "ghost",
        headingNumber: null,
        standardSection: null,
      }),
    ).toBe("[S?]");
  });

  it("ignores standardSection that does not match snake_case", () => {
    expect(
      buildSectionAnchor({
        id: "x",
        title: "weird",
        headingNumber: "3",
        standardSection: "Has Spaces!",
        order: 1,
      }),
    ).toBe("[S3]");
  });

  it("trims whitespace in headingNumber", () => {
    expect(
      buildSectionAnchor({
        id: "x",
        title: "trim",
        headingNumber: "  4.5  ",
        standardSection: "design",
        order: 1,
      }),
    ).toBe("[S4.5:design]");
  });
});

describe("parseSectionAnchor", () => {
  it("parses [S<path>:<type>]", () => {
    expect(parseSectionAnchor("[S2.1:objectives]")).toEqual({
      path: "2.1",
      type: "objectives",
      isOrderFallback: false,
    });
  });

  it("parses S<path>:<type> without brackets", () => {
    expect(parseSectionAnchor("S1.2.3:design")).toEqual({
      path: "1.2.3",
      type: "design",
      isOrderFallback: false,
    });
  });

  it("parses without type suffix", () => {
    expect(parseSectionAnchor("[S5]")).toEqual({
      path: "5",
      type: null,
      isOrderFallback: false,
    });
  });

  it("parses #-prefixed order fallback", () => {
    expect(parseSectionAnchor("[S#42:safety]")).toEqual({
      path: "42",
      type: "safety",
      isOrderFallback: true,
    });
  });

  it("accepts raw path without S prefix", () => {
    expect(parseSectionAnchor("1.2:population")).toEqual({
      path: "1.2",
      type: "population",
      isOrderFallback: false,
    });
  });

  it("returns null for non-numeric path", () => {
    expect(parseSectionAnchor("[Sabc]")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseSectionAnchor("")).toBeNull();
    expect(parseSectionAnchor(null)).toBeNull();
    expect(parseSectionAnchor(undefined)).toBeNull();
  });

  it("ignores malformed type suffix", () => {
    expect(parseSectionAnchor("[S2.1:Has Space]")).toEqual({
      path: "2.1",
      type: null,
      isOrderFallback: false,
    });
  });
});
