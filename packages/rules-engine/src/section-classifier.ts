import type { SectionMappingRule } from "./types.js";

export interface ClassificationResult {
  sectionTitle: string;
  standardSection: string | null;
  confidence: number;
  method: "exact" | "pattern" | "content";
}

export class SectionClassifier {
  private rules: SectionMappingRule[];

  constructor(rules: SectionMappingRule[]) {
    this.rules = rules;
  }

  classify(title: string, contentSnippet?: string): ClassificationResult {
    const normalizedTitle = title.toLowerCase().trim();

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        const re = new RegExp(pattern, "i");

        if (re.test(normalizedTitle)) {
          return {
            sectionTitle: title,
            standardSection: rule.standardSection,
            confidence: 0.95,
            method: "exact",
          };
        }

        // URS-072: Also check initial content text when title alone is ambiguous
        if (contentSnippet && re.test(contentSnippet)) {
          return {
            sectionTitle: title,
            standardSection: rule.standardSection,
            confidence: 0.7,
            method: "content",
          };
        }
      }
    }

    return {
      sectionTitle: title,
      standardSection: null,
      confidence: 0,
      method: "pattern",
    };
  }

  classifyAll(
    sections: Array<{ title: string; content?: string }>
  ): ClassificationResult[] {
    return sections.map((s) => this.classify(s.title, s.content));
  }
}

export const DEFAULT_PROTOCOL_SECTIONS: SectionMappingRule[] = [
  {
    standardSection: "synopsis",
    patterns: ["^synopsis", "protocol\\s+synopsis"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "introduction",
    patterns: ["^introduction", "^1\\.?\\s+introduction"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "study_objectives",
    patterns: ["objectives?", "study\\s+objectives?", "^2\\.?\\s+objectives?"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "study_design",
    patterns: ["study\\s+design", "investigational\\s+plan", "^3\\.?\\s+study\\s+design"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "study_population",
    patterns: ["study\\s+population", "selection\\s+of\\s+(study\\s+)?subjects?", "eligibility"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "treatments",
    patterns: ["treatments?", "study\\s+treatments?", "investigational\\s+product"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "efficacy_assessments",
    patterns: ["efficacy", "efficacy\\s+assessments?", "efficacy\\s+endpoints?"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "safety_assessments",
    patterns: ["safety", "safety\\s+assessments?", "adverse\\s+events?"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "statistics",
    patterns: ["statistic", "statistical\\s+(analysis|methods?)", "sample\\s+size"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "ethics",
    patterns: ["ethic", "ethical\\s+considerations?", "informed\\s+consent"],
    isRequired: false,
    category: "protocol",
  },
  {
    standardSection: "schedule_of_assessments",
    patterns: ["schedule\\s+of\\s+(assessments?|activities?|procedures?)", "\\bSOA\\b"],
    isRequired: true,
    category: "protocol",
  },
  {
    standardSection: "references",
    patterns: ["^references?$", "bibliography"],
    isRequired: false,
    category: "administrative",
  },
  {
    standardSection: "abbreviations",
    patterns: ["abbreviations?", "glossary", "definitions?\\s+and\\s+abbreviations?"],
    isRequired: false,
    category: "administrative",
  },
  {
    standardSection: "appendices",
    patterns: ["^appendix", "^appendices"],
    isRequired: false,
    category: "appendix",
  },
  {
    standardSection: "table_of_contents",
    patterns: ["table\\s+of\\s+contents", "^contents$"],
    isRequired: false,
    category: "administrative",
  },
];
