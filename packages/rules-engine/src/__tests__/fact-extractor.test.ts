import { describe, it, expect } from "vitest";
import { FactExtractor, DEFAULT_FACT_RULES } from "../fact-extractor.js";

describe("FactExtractor", () => {
  const extractor = new FactExtractor(DEFAULT_FACT_RULES);

  describe("extract - individual fact rules", () => {
    it("extracts study_title", () => {
      const facts = extractor.extract("Study Title: A Phase III Trial of Drug X");
      const title = facts.find((f) => f.factKey === "study_title");
      expect(title).toBeDefined();
      expect(title!.value).toBe("A Phase III Trial of Drug X");
      expect(title!.source.method).toBe("regex");
    });

    it("extracts protocol_number", () => {
      const facts = extractor.extract("Protocol Number: ABC-123-456");
      const pn = facts.find((f) => f.factKey === "protocol_number");
      expect(pn).toBeDefined();
      expect(pn!.value).toBe("ABC-123-456");
    });

    it("extracts protocol_number with 'No.' format", () => {
      const facts = extractor.extract("Protocol No. XYZ-789");
      const pn = facts.find((f) => f.factKey === "protocol_number");
      expect(pn).toBeDefined();
      expect(pn!.value).toBe("XYZ-789");
    });

    it("extracts sponsor", () => {
      const facts = extractor.extract("Sponsor: Acme Pharmaceuticals Inc.");
      const sponsor = facts.find((f) => f.factKey === "sponsor");
      expect(sponsor).toBeDefined();
      expect(sponsor!.value).toBe("Acme Pharmaceuticals Inc.");
    });

    it("extracts sponsor with 'sponsored by' format", () => {
      const facts = extractor.extract("This study is sponsored by BigPharma Corp.");
      const sponsor = facts.find((f) => f.factKey === "sponsor");
      expect(sponsor).toBeDefined();
      expect(sponsor!.value).toBe("BigPharma Corp.");
    });

    it("extracts study_phase", () => {
      const facts = extractor.extract("This is a Phase III clinical trial.");
      const phase = facts.find((f) => f.factKey === "study_phase");
      expect(phase).toBeDefined();
      expect(phase!.value).toBe("III");
    });

    it("extracts study_phase numeric format", () => {
      const facts = extractor.extract("Phase 2 study");
      const phase = facts.find((f) => f.factKey === "study_phase");
      expect(phase).toBeDefined();
      expect(phase!.value).toBe("2");
    });

    it("extracts indication", () => {
      const facts = extractor.extract("Indication: Type 2 Diabetes Mellitus");
      const indication = facts.find((f) => f.factKey === "indication");
      expect(indication).toBeDefined();
      expect(indication!.value).toBe("Type 2 Diabetes Mellitus");
    });

    it("extracts study_drug", () => {
      const facts = extractor.extract("Investigational Product: Compound XYZ 100mg");
      const drug = facts.find((f) => f.factKey === "study_drug");
      expect(drug).toBeDefined();
      expect(drug!.value).toBe("Compound XYZ 100mg");
    });

    it("extracts sample_size with 'approximately N subjects'", () => {
      const facts = extractor.extract("Approximately 200 subjects will be enrolled.");
      const size = facts.find((f) => f.factKey === "sample_size");
      expect(size).toBeDefined();
      expect(size!.value).toBe("200");
    });

    it("extracts sample_size with 'N=' format", () => {
      const facts = extractor.extract("The total sample size is N=150.");
      const size = facts.find((f) => f.factKey === "sample_size");
      expect(size).toBeDefined();
      expect(size!.value).toBe("150");
    });

    it("extracts study_duration", () => {
      const facts = extractor.extract("Study Duration: 52 weeks");
      const duration = facts.find((f) => f.factKey === "study_duration");
      expect(duration).toBeDefined();
      expect(duration!.value).toBe("52 weeks");
    });

    it("extracts primary_endpoint", () => {
      const facts = extractor.extract(
        "Primary Endpoint: Change from baseline in HbA1c at Week 24"
      );
      const ep = facts.find((f) => f.factKey === "primary_endpoint");
      expect(ep).toBeDefined();
      expect(ep!.value).toBe("Change from baseline in HbA1c at Week 24");
      expect(ep!.factClass).toBe("phase_specific");
    });

    it("extracts secondary_endpoint", () => {
      const facts = extractor.extract(
        "Secondary Endpoint: Proportion of patients achieving HbA1c <7%"
      );
      const ep = facts.find((f) => f.factKey === "secondary_endpoint");
      expect(ep).toBeDefined();
      expect(ep!.factClass).toBe("phase_specific");
    });

    it("extracts inclusion_criteria", () => {
      const facts = extractor.extract(
        "Inclusion Criteria: Male or female patients aged 18-65 years"
      );
      const ic = facts.find((f) => f.factKey === "inclusion_criteria");
      expect(ic).toBeDefined();
    });

    it("extracts exclusion_criteria", () => {
      const facts = extractor.extract(
        "Exclusion Criteria: Patients with known hypersensitivity"
      );
      const ec = facts.find((f) => f.factKey === "exclusion_criteria");
      expect(ec).toBeDefined();
    });

    it("captures multi-line bullet lists for criteria", () => {
      const text =
        "Inclusion Criteria:\n- Age 18-65\n- Confirmed diagnosis\n- Signed informed consent";
      const facts = extractor.extract(text);
      const ic = facts.find((f) => f.factKey === "inclusion_criteria");
      expect(ic).toBeDefined();
      expect(ic!.value).toContain("Age 18-65");
      expect(ic!.value).toContain("Confirmed diagnosis");
      expect(ic!.value).toContain("Signed informed consent");
    });

    it("captures multi-line bullet lists for endpoints", () => {
      const text =
        "Secondary Endpoint: Time to recurrence\n- Quality of life score at Week 12\n- Adverse event frequency";
      const facts = extractor.extract(text);
      const eps = facts.filter((f) => f.factKey === "secondary_endpoint");
      // First match captures the head + sub-bullets as one aggregated value.
      expect(eps.length).toBeGreaterThanOrEqual(1);
      const combined = eps.map((e) => e.value).join(" ");
      expect(combined).toContain("Quality of life");
      expect(combined).toContain("Adverse event");
    });
  });

  describe("aggregation by canonical value", () => {
    it("keeps distinct values for single-value rules as separate aggregated facts", () => {
      // Phase 1.2 semantics: contradicting protocol numbers stay visible
      // so contradiction-detector and downstream LLM QA can arbitrate.
      const text =
        "Protocol Number: AAA-111\nSome text\nProtocol Number: BBB-222";
      const facts = extractor.extract(text);
      const pns = facts.filter((f) => f.factKey === "protocol_number");
      expect(pns).toHaveLength(2);
      const canonicals = pns.map((p) => p.canonical).sort();
      expect(canonicals).toEqual(["AAA-111", "BBB-222"]);
    });

    it("returns multiple matches for multipleValues-style rules", () => {
      const text =
        "Primary Endpoint: Change in HbA1c\nPrimary Endpoint: Weight loss at Week 12";
      const facts = extractor.extract(text);
      const eps = facts.filter((f) => f.factKey === "primary_endpoint");
      expect(eps.length).toBeGreaterThanOrEqual(2);
    });

    it("collapses duplicate canonical values across repeated mentions", () => {
      const text = "Protocol Number: AAA-111\nSome text\nProtocol Number: AAA-111";
      const facts = extractor.extract(text);
      const pns = facts.filter((f) => f.factKey === "protocol_number");
      expect(pns).toHaveLength(1);
      expect(pns[0].sourceCount).toBe(2);
    });

    it("boosts confidence when synopsis and body confirm the same value", () => {
      const facts = extractor.extractFromSections([
        { title: "Synopsis", content: "Sponsor: Acme Corp", isSynopsis: true },
        { title: "Body", content: "Sponsor: Acme Corp", isSynopsis: false },
      ]);
      const sponsor = facts.find((f) => f.factKey === "sponsor");
      expect(sponsor).toBeDefined();
      expect(sponsor!.sourceCount).toBe(2);
      expect(sponsor!.confidence).toBeGreaterThan(0.7);
    });
  });

  describe("deduplication", () => {
    it("collapses identical sponsor mentions to one aggregated fact", () => {
      const text =
        "Sponsor: Acme Corp\nSome text in between.\nSponsor: Acme Corp";
      const facts = extractor.extract(text);
      const sponsors = facts.filter((f) => f.factKey === "sponsor");
      expect(sponsors).toHaveLength(1);
    });
  });

  describe("source tracking", () => {
    it("includes section title in source", () => {
      const facts = extractor.extract("Sponsor: Test Corp", "Synopsis");
      expect(facts[0].source.sectionTitle).toBe("Synopsis");
    });

    it("includes text snippet in source", () => {
      const facts = extractor.extract("Protocol Number: XYZ-001");
      expect(facts[0].source.textSnippet).toContain("Protocol Number");
    });
  });

  describe("extractFromSections", () => {
    it("processes synopsis first", () => {
      const facts = extractor.extractFromSections([
        { title: "Body Section", content: "Sponsor: Body Corp", isSynopsis: false },
        { title: "Synopsis", content: "Sponsor: Synopsis Corp", isSynopsis: true },
      ]);
      const sponsors = facts.filter((f) => f.factKey === "sponsor");
      expect(sponsors).toHaveLength(2);
      expect(sponsors[0].source.sectionTitle).toBe("Synopsis");
    });

    it("skips synopsis in body pass", () => {
      const facts = extractor.extractFromSections([
        { title: "Synopsis", content: "Protocol Number: SYN-001", isSynopsis: true },
      ]);
      const pns = facts.filter((f) => f.factKey === "protocol_number");
      expect(pns).toHaveLength(1);
    });

    it("handles empty sections", () => {
      const facts = extractor.extractFromSections([]);
      expect(facts).toHaveLength(0);
    });
  });

  describe("case insensitivity", () => {
    it("matches patterns case-insensitively", () => {
      const facts = extractor.extract("PROTOCOL NUMBER: TEST-001");
      const pn = facts.find((f) => f.factKey === "protocol_number");
      expect(pn).toBeDefined();
      expect(pn!.value).toBe("TEST-001");
    });
  });
});
