import { describe, it, expect } from "vitest";
import { extractRawFromTable, extractFromTable } from "../table-extractor.js";
import { factKeyForHeader, normalizeHeader } from "../dictionaries/tableHeaderSynonyms.js";

describe("tableHeaderSynonyms", () => {
  it("normalises punctuation and case", () => {
    expect(normalizeHeader("Sponsor:")).toBe(normalizeHeader("sponsor"));
  });

  it("maps 'Sponsor' to sponsor factKey", () => {
    expect(factKeyForHeader("Sponsor")).toBe("sponsor");
  });

  it("maps Russian аналог", () => {
    expect(factKeyForHeader("Спонсор")).toBe("sponsor");
  });

  it("maps protocol_number from various phrasings", () => {
    expect(factKeyForHeader("Protocol Number")).toBe("protocol_number");
    expect(factKeyForHeader("Protocol No.")).toBe("protocol_number");
    expect(factKeyForHeader("Номер протокола")).toBe("protocol_number");
  });

  it("returns null for unknown header", () => {
    expect(factKeyForHeader("Random Cell")).toBeNull();
  });
});

describe("extractRawFromTable — two-column key/value", () => {
  it("extracts a sponsor from a 2-column row", () => {
    const facts = extractRawFromTable({
      headers: [],
      rows: [["Sponsor", "Acme Pharmaceuticals"]],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].factKey).toBe("sponsor");
    expect(facts[0].value).toBe("Acme Pharmaceuticals");
    expect(facts[0].source.method).toBe("regex");
  });

  it("handles flipped order (header on right)", () => {
    const facts = extractRawFromTable({
      headers: [],
      rows: [["Acme Pharmaceuticals", "Sponsor"]],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].factKey).toBe("sponsor");
    expect(facts[0].value).toBe("Acme Pharmaceuticals");
  });

  it("ignores rows where neither cell is a known header", () => {
    const facts = extractRawFromTable({
      headers: [],
      rows: [["Random A", "Random B"]],
    });
    expect(facts).toHaveLength(0);
  });

  it("collects multiple key-value rows", () => {
    const facts = extractRawFromTable({
      headers: [],
      rows: [
        ["Sponsor", "Acme"],
        ["Protocol Number", "ABC-001"],
        ["Sample Size", "150"],
      ],
    });
    const keys = facts.map((f) => f.factKey).sort();
    expect(keys).toEqual(["protocol_number", "sample_size", "sponsor"]);
  });

  it("attaches sectionTitle to source", () => {
    const facts = extractRawFromTable(
      { headers: [], rows: [["Sponsor", "Acme"]] },
      "Synopsis",
    );
    expect(facts[0].source.sectionTitle).toBe("Synopsis");
  });
});

describe("extractFromTable — aggregated", () => {
  it("aggregates multiple synonyms of the same fact", () => {
    const aggregated = extractFromTable({
      headers: [],
      rows: [
        ["Sponsor", "Acme"],
        ["Спонсор", "Acme"],
      ],
    });
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].factKey).toBe("sponsor");
    expect(aggregated[0].sourceCount).toBe(2);
    expect(aggregated[0].confidence).toBeGreaterThan(0.6);
  });
});

describe("phase classification", () => {
  it("labels primary_endpoint as phase_specific", () => {
    const facts = extractRawFromTable({
      headers: [],
      rows: [["Primary Endpoint", "Change in HbA1c at week 24"]],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].factClass).toBe("phase_specific");
  });

  it("labels sponsor as general", () => {
    const facts = extractRawFromTable({
      headers: [],
      rows: [["Sponsor", "Acme"]],
    });
    expect(facts[0].factClass).toBe("general");
  });
});
