import { describe, it, expect } from "vitest";
import { SectionClassifier, DEFAULT_PROTOCOL_SECTIONS } from "../section-classifier.js";
import type { SectionMappingRule } from "../types.js";

describe("SectionClassifier", () => {
  const classifier = new SectionClassifier(DEFAULT_PROTOCOL_SECTIONS);

  describe("exact title matching", () => {
    it("classifies 'Synopsis' as synopsis with high confidence", () => {
      const result = classifier.classify("Synopsis");
      expect(result.standardSection).toBe("synopsis");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.method).toBe("exact");
    });

    it("classifies 'Protocol Synopsis' as synopsis", () => {
      const result = classifier.classify("Protocol Synopsis");
      expect(result.standardSection).toBe("synopsis");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("classifies 'Introduction' as introduction", () => {
      const result = classifier.classify("Introduction");
      expect(result.standardSection).toBe("introduction");
    });

    it("classifies '1. Introduction' as introduction", () => {
      const result = classifier.classify("1. Introduction");
      expect(result.standardSection).toBe("introduction");
    });

    it("classifies 'Study Objectives' as study_objectives", () => {
      const result = classifier.classify("Study Objectives");
      expect(result.standardSection).toBe("study_objectives");
    });

    it("classifies 'Objectives' as study_objectives", () => {
      const result = classifier.classify("Objectives");
      expect(result.standardSection).toBe("study_objectives");
    });

    it("classifies 'Study Design' as study_design", () => {
      const result = classifier.classify("Study Design");
      expect(result.standardSection).toBe("study_design");
    });

    it("classifies 'Investigational Plan' as study_design", () => {
      const result = classifier.classify("Investigational Plan");
      expect(result.standardSection).toBe("study_design");
    });

    it("classifies 'Study Population' as study_population", () => {
      const result = classifier.classify("Study Population");
      expect(result.standardSection).toBe("study_population");
    });

    it("classifies 'Selection of Subjects' as study_population", () => {
      const result = classifier.classify("Selection of Subjects");
      expect(result.standardSection).toBe("study_population");
    });

    it("classifies 'Treatments' as treatments", () => {
      const result = classifier.classify("Treatments");
      expect(result.standardSection).toBe("treatments");
    });

    it("classifies 'Investigational Product' as treatments", () => {
      const result = classifier.classify("Investigational Product");
      expect(result.standardSection).toBe("treatments");
    });

    it("classifies 'Efficacy Assessments' as efficacy_assessments", () => {
      const result = classifier.classify("Efficacy Assessments");
      expect(result.standardSection).toBe("efficacy_assessments");
    });

    it("classifies 'Safety Assessments' as safety_assessments", () => {
      const result = classifier.classify("Safety Assessments");
      expect(result.standardSection).toBe("safety_assessments");
    });

    it("classifies 'Adverse Events' as safety_assessments", () => {
      const result = classifier.classify("Adverse Events");
      expect(result.standardSection).toBe("safety_assessments");
    });

    it("classifies 'Statistical Analysis' as statistics", () => {
      const result = classifier.classify("Statistical Analysis");
      expect(result.standardSection).toBe("statistics");
    });

    it("classifies 'Sample Size' as statistics", () => {
      const result = classifier.classify("Sample Size");
      expect(result.standardSection).toBe("statistics");
    });

    it("classifies 'Ethical Considerations' as ethics", () => {
      const result = classifier.classify("Ethical Considerations");
      expect(result.standardSection).toBe("ethics");
    });

    it("classifies 'Schedule of Assessments' as schedule_of_assessments", () => {
      const result = classifier.classify("Schedule of Assessments");
      expect(result.standardSection).toBe("schedule_of_assessments");
    });

    it("classifies 'SOA' as schedule_of_assessments", () => {
      const result = classifier.classify("SOA");
      expect(result.standardSection).toBe("schedule_of_assessments");
    });

    it("classifies 'References' as references", () => {
      const result = classifier.classify("References");
      expect(result.standardSection).toBe("references");
    });

    it("classifies 'Abbreviations' as abbreviations", () => {
      const result = classifier.classify("Abbreviations");
      expect(result.standardSection).toBe("abbreviations");
    });

    it("classifies 'Appendix A' as appendices", () => {
      const result = classifier.classify("Appendix A");
      expect(result.standardSection).toBe("appendices");
    });

    it("classifies 'Table of Contents' as table_of_contents", () => {
      const result = classifier.classify("Table of Contents");
      expect(result.standardSection).toBe("table_of_contents");
    });
  });

  describe("case insensitivity", () => {
    it("matches regardless of case", () => {
      const result = classifier.classify("SYNOPSIS");
      expect(result.standardSection).toBe("synopsis");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("matches mixed case", () => {
      const result = classifier.classify("Study DESIGN");
      expect(result.standardSection).toBe("study_design");
    });
  });

  describe("content-based fallback", () => {
    it("classifies by content when title is ambiguous", () => {
      const result = classifier.classify(
        "Section 5",
        "The study objectives include evaluating the efficacy...",
      );
      expect(result.standardSection).toBe("study_objectives");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(0.8);
      expect(result.method).toBe("content");
    });

    it("prefers title match over content match", () => {
      const result = classifier.classify(
        "Synopsis",
        "The study design includes a randomized...",
      );
      expect(result.standardSection).toBe("synopsis");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.method).toBe("exact");
    });
  });

  describe("unrecognized sections", () => {
    it("returns null standardSection for unknown titles", () => {
      const result = classifier.classify("Completely Unrelated Title");
      expect(result.standardSection).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.method).toBe("pattern");
    });

    it("preserves original section title in result", () => {
      const result = classifier.classify("Unknown Heading");
      expect(result.sectionTitle).toBe("Unknown Heading");
    });
  });

  describe("classifyAll", () => {
    it("classifies multiple sections at once", () => {
      const results = classifier.classifyAll([
        { title: "Synopsis" },
        { title: "Introduction" },
        { title: "Unknown Section", content: "Some text about efficacy" },
      ]);
      expect(results).toHaveLength(3);
      expect(results[0].standardSection).toBe("synopsis");
      expect(results[1].standardSection).toBe("introduction");
      expect(results[2].standardSection).toBe("efficacy_assessments");
    });

    it("returns empty array for empty input", () => {
      const results = classifier.classifyAll([]);
      expect(results).toHaveLength(0);
    });
  });

  describe("custom rules", () => {
    it("uses custom rules when provided", () => {
      const custom = new SectionClassifier([
        {
          standardSection: "custom_section",
          patterns: ["^my\\s+custom"],
          isRequired: true,
          category: "protocol",
        },
      ]);
      const result = custom.classify("My Custom Section");
      expect(result.standardSection).toBe("custom_section");
    });
  });

  // ─────────────────── New tests for gates / penalty / scoring (task 1.1) ───────────────────

  describe("requirePatterns gate", () => {
    const synopsisStrict: SectionMappingRule = {
      standardSection: "synopsis",
      patterns: ["(?i)\\bсинопсис\\b", "(?i)\\bsynopsis\\b", "(?i)\\bsummary\\b", "(?i)содержан\\w*"],
      requirePatterns: ["(?i)\\b(синопсис|synopsis|резюме|краткое\\s+содержание)\\b"],
      isRequired: true,
      category: "protocol",
    };
    const fallbackOverview: SectionMappingRule = {
      standardSection: "overview",
      patterns: ["обзор", "summary", "введен"],
      isRequired: false,
      category: "protocol",
    };
    const cls = new SectionClassifier([synopsisStrict, fallbackOverview]);

    it("rejects rule when none of requirePatterns match (gate fail)", () => {
      const result = cls.classify("Brief Summary");
      expect(result.standardSection).not.toBe("synopsis");
      expect(result.standardSection).toBe("overview");
    });

    it("accepts rule when at least one requirePatterns matches (gate pass)", () => {
      const result = cls.classify("Synopsis");
      expect(result.standardSection).toBe("synopsis");
    });

    it("gate evaluates against title + content together (gate matches in content)", () => {
      const result = cls.classify(
        "Раздел 1",
        "Это краткое содержание исследования.",
      );
      expect(result.standardSection).toBe("synopsis");
      expect(result.method).toBe("content");
    });
  });

  describe("notKeywords penalty", () => {
    const safetyRule: SectionMappingRule = {
      standardSection: "safety_assessments",
      patterns: ["(?i)\\bsafety\\b"],
      notKeywords: ["(?i)\\bdetailed\\b", "(?i)\\bobservation\\s+period\\b"],
      isRequired: true,
      category: "protocol",
    };
    const cls = new SectionClassifier([safetyRule]);

    it("applies −0.4 penalty when notKeyword matches in title", () => {
      const plain = cls.classify("Safety Assessments");
      const penalised = cls.classify("Detailed Safety Assessments");
      expect(plain.standardSection).toBe("safety_assessments");
      expect(penalised.standardSection).toBe("safety_assessments");
      expect(plain.confidence - penalised.confidence).toBeGreaterThan(0.3);
    });

    it("competing rule without penalty wins when penalty drops the candidate", () => {
      const competitor: SectionMappingRule = {
        standardSection: "safety_observation_period",
        patterns: ["(?i)\\bobservation\\s+period\\b"],
        isRequired: false,
        category: "protocol",
      };
      const both = new SectionClassifier([safetyRule, competitor]);
      const result = both.classify("Safety Observation Period");
      expect(result.standardSection).toBe("safety_observation_period");
    });
  });

  describe("scoring: longest match wins", () => {
    it("multi-pattern match in same rule increases confidence (multi-match bonus)", () => {
      const single: SectionMappingRule = {
        standardSection: "single",
        patterns: ["safety"],
        isRequired: true,
        category: "protocol",
      };
      const multi: SectionMappingRule = {
        standardSection: "multi",
        patterns: ["safety", "assessments?"],
        isRequired: true,
        category: "protocol",
      };
      const cls = new SectionClassifier([single, multi]);
      const result = cls.classify("Safety Assessments");
      expect(result.standardSection).toBe("multi");
    });

    it("longer matchLen wins for same-length titles", () => {
      const shortRule: SectionMappingRule = {
        standardSection: "short_match",
        patterns: ["of"],
        isRequired: false,
        category: "protocol",
      };
      const longRule: SectionMappingRule = {
        standardSection: "long_match",
        patterns: ["schedule\\s+of\\s+assessments"],
        isRequired: false,
        category: "protocol",
      };
      const cls = new SectionClassifier([shortRule, longRule]);
      const result = cls.classify("Schedule of Assessments");
      expect(result.standardSection).toBe("long_match");
    });

    it("content-only match yields lower confidence than title match", () => {
      const rule: SectionMappingRule = {
        standardSection: "topic",
        patterns: ["randomization"],
        isRequired: false,
        category: "protocol",
      };
      const cls = new SectionClassifier([rule]);
      const titleHit = cls.classify("Randomization");
      const contentHit = cls.classify("Section X", "Subjects undergo randomization at visit 1.");
      expect(titleHit.confidence).toBeGreaterThan(contentHit.confidence);
      expect(contentHit.method).toBe("content");
    });
  });

  describe("Russian patterns + \\b word boundary", () => {
    it("matches Russian patterns through unicode-aware word boundary", () => {
      const rule: SectionMappingRule = {
        standardSection: "ru_synopsis",
        patterns: ["(?i)\\bсинопсис\\b"],
        isRequired: true,
        category: "protocol",
      };
      const cls = new SectionClassifier([rule]);
      const result = cls.classify("Синопсис исследования");
      expect(result.standardSection).toBe("ru_synopsis");
    });

    it("requirePatterns with russian patterns works (gate pass)", () => {
      const rule: SectionMappingRule = {
        standardSection: "ru_definitions",
        patterns: ["(?i)\\bтермин\\w*\\b", "(?i)\\bопределен\\w*\\b"],
        requirePatterns: ["(?i)\\b(термин|сокращен|глоссар|определен)\\w*\\b"],
        notKeywords: ["(?i)\\bнежелат\\w*\\b"],
        isRequired: true,
        category: "protocol",
      };
      const cls = new SectionClassifier([rule]);
      const ok = cls.classify("Термины и определения");
      const blocked = cls.classify("Определение нежелательных явлений");
      expect(ok.standardSection).toBe("ru_definitions");
      expect(blocked.confidence).toBeLessThan(ok.confidence - 0.3);
    });
  });

  describe("calibrated confidence formula", () => {
    it("exact full-title match scores ~0.95", () => {
      const cls = new SectionClassifier([
        {
          standardSection: "x",
          patterns: ["^synopsis$"],
          isRequired: true,
          category: "protocol",
        },
      ]);
      const result = cls.classify("Synopsis");
      expect(result.confidence).toBeGreaterThanOrEqual(0.94);
      expect(result.confidence).toBeLessThanOrEqual(0.99);
    });

    it("partial title match scores below 0.95", () => {
      const cls = new SectionClassifier([
        {
          standardSection: "y",
          patterns: ["^app"],
          isRequired: true,
          category: "protocol",
        },
      ]);
      const result = cls.classify("Appendix A — Detailed Schedule");
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.confidence).toBeLessThan(0.85);
    });

    it("never exceeds MAX_CONFIDENCE 0.99", () => {
      const cls = new SectionClassifier([
        {
          standardSection: "z",
          patterns: ["a", "b", "c", "d", "e"],
          isRequired: true,
          category: "protocol",
        },
      ]);
      const result = cls.classify("abcde");
      expect(result.confidence).toBeLessThanOrEqual(0.99);
    });
  });

  // ─────────────── Hierarchical classification (task 2.1) ───────────────

  describe("hierarchical classification with parentZone", () => {
    const safetyZone: SectionMappingRule = {
      standardSection: "safety",
      patterns: ["(?i)\\bsafety\\b"],
      type: "zone",
      isRequired: true,
      category: "protocol",
    };
    const safetyAdverseEventsSubzone: SectionMappingRule = {
      standardSection: "safety.adverse_events",
      patterns: ["(?i)\\badverse\\s+events?\\b"],
      type: "subzone",
      parentZone: "safety",
      isRequired: false,
      category: "protocol",
    };
    const generalAdverseEventsRule: SectionMappingRule = {
      standardSection: "regulatory.adverse_events",
      patterns: ["(?i)\\badverse\\s+events?\\b"],
      type: "subzone",
      parentZone: "regulatory",
      isRequired: false,
      category: "protocol",
    };

    it("subzone matching parentZone gets +0.05 bonus", () => {
      const cls = new SectionClassifier([safetyAdverseEventsSubzone, generalAdverseEventsRule]);
      const noParent = cls.classify("Adverse Events");
      const withSafetyParent = cls.classify("Adverse Events", undefined, "safety");
      // Bonus should make safety.adverse_events strictly higher confidence
      expect(withSafetyParent.standardSection).toBe("safety.adverse_events");
      expect(withSafetyParent.confidence).toBeGreaterThan(noParent.confidence);
    });

    it("subzone with mismatched parentZone gets −0.1 penalty", () => {
      const cls = new SectionClassifier([safetyAdverseEventsSubzone, generalAdverseEventsRule]);
      // safety.adverse_events should be penalised because parent is 'overview', not 'safety'
      const result = cls.classify("Adverse Events", undefined, "overview");
      // regulatory.adverse_events also subzone but parent='regulatory' != 'overview'
      // → both penalised, but they end up tied by base score; tie-break = first in list
      // Either way, confidence drops vs no-parent
      const noParent = cls.classify("Adverse Events");
      expect(result.confidence).toBeLessThan(noParent.confidence);
    });

    it("top-level zone (type='zone') is not affected by parentZone", () => {
      const cls = new SectionClassifier([safetyZone]);
      const noParent = cls.classify("Safety");
      const withParent = cls.classify("Safety", undefined, "overview");
      expect(withParent.confidence).toBeCloseTo(noParent.confidence, 5);
    });

    it("classifyHierarchical sets parentZone from document structure (stack-based)", () => {
      const introZone: SectionMappingRule = {
        standardSection: "overview",
        patterns: ["(?i)\\boverview\\b|\\bvведение\\b"],
        type: "zone",
        isRequired: true,
        category: "protocol",
      };
      const introSubzone: SectionMappingRule = {
        standardSection: "overview.introduction",
        patterns: ["(?i)\\bintroduction\\b"],
        type: "subzone",
        parentZone: "overview",
        isRequired: false,
        category: "protocol",
      };
      const cls = new SectionClassifier([introZone, introSubzone, safetyAdverseEventsSubzone]);

      const sections = [
        { id: "s1", title: "Overview", level: 1 },
        { id: "s2", title: "Introduction", level: 2 }, // parent: s1 (overview)
        { id: "s3", title: "Adverse Events", level: 2 }, // parent: s1 (overview) — но subzone safety, не overview
      ];
      const results = cls.classifyHierarchical(sections);

      expect(results.get("s1")?.standardSection).toBe("overview");
      expect(results.get("s2")?.standardSection).toBe("overview.introduction");
      // s3: subzone safety, parent в документе = overview → penalty
      // Возможно standardSection всё равно safety.adverse_events (если score>0 после penalty)
      // — но confidence должен быть ниже, чем при правильном parent
      const s3 = results.get("s3");
      expect(s3?.standardSection).toBe("safety.adverse_events");
    });

    it("classifyHierarchical pops stack on level decrease (sibling sections)", () => {
      const overviewZone: SectionMappingRule = {
        standardSection: "overview",
        patterns: ["(?i)\\bobzor\\b|^overview$"],
        type: "zone",
        isRequired: true,
        category: "protocol",
      };
      const safetyZ: SectionMappingRule = {
        ...safetyZone,
      };
      const cls = new SectionClassifier([overviewZone, safetyZ, safetyAdverseEventsSubzone]);

      const sections = [
        { id: "s1", title: "Overview", level: 1 },
        { id: "s2", title: "Safety", level: 1 }, // sibling of s1, не child
        { id: "s3", title: "Adverse Events", level: 2 }, // parent: s2 (safety), не s1 (overview)
      ];
      const results = cls.classifyHierarchical(sections);

      expect(results.get("s2")?.standardSection).toBe("safety");
      // s3: parent в документе = safety → bonus (rule.parentZone === parent)
      expect(results.get("s3")?.standardSection).toBe("safety.adverse_events");
    });

    it("classifyHierarchical handles section without level (treats as level 0)", () => {
      const cls = new SectionClassifier([safetyAdverseEventsSubzone]);
      const sections = [
        { id: "s1", title: "Adverse Events" }, // level undefined → 0
      ];
      const results = cls.classifyHierarchical(sections);
      expect(results.get("s1")?.standardSection).toBe("safety.adverse_events");
    });
  });
});
