import { describe, it, expect } from "vitest";
import { SectionClassifier, DEFAULT_PROTOCOL_SECTIONS } from "../section-classifier.js";

describe("SectionClassifier", () => {
  const classifier = new SectionClassifier(DEFAULT_PROTOCOL_SECTIONS);

  describe("exact title matching", () => {
    it("classifies 'Synopsis' as synopsis with high confidence", () => {
      const result = classifier.classify("Synopsis");
      expect(result.standardSection).toBe("synopsis");
      expect(result.confidence).toBe(0.95);
      expect(result.method).toBe("exact");
    });

    it("classifies 'Protocol Synopsis' as synopsis", () => {
      const result = classifier.classify("Protocol Synopsis");
      expect(result.standardSection).toBe("synopsis");
      expect(result.confidence).toBe(0.95);
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
      expect(result.confidence).toBe(0.95);
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
        "The study objectives include evaluating the efficacy..."
      );
      expect(result.standardSection).toBe("study_objectives");
      expect(result.confidence).toBe(0.7);
      expect(result.method).toBe("content");
    });

    it("prefers title match over content match", () => {
      const result = classifier.classify(
        "Synopsis",
        "The study design includes a randomized..."
      );
      expect(result.standardSection).toBe("synopsis");
      expect(result.confidence).toBe(0.95);
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
});
