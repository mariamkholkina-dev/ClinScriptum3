import type { FactExtractionRule } from "./types.js";

export interface ExtractedFact {
  factKey: string;
  value: string;
  factClass: "general" | "phase_specific";
  source: { sectionTitle?: string; textSnippet: string; method: "regex" | "llm" };
}

export class FactExtractor {
  private rules: FactExtractionRule[];

  constructor(rules: FactExtractionRule[]) {
    this.rules = rules;
  }

  /**
   * URS-073: Use regex as the primary deterministic mechanism
   * before LLM verification or extraction.
   */
  extract(text: string, sectionTitle?: string): ExtractedFact[] {
    const results: ExtractedFact[] = [];

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        const re = new RegExp(pattern, "gi");
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
          const value = match[1] ?? match[0];
          results.push({
            factKey: rule.factKey,
            value: value.trim(),
            factClass: rule.factClass,
            source: {
              sectionTitle,
              textSnippet: text.slice(
                Math.max(0, (match.index ?? 0) - 30),
                Math.min(text.length, (match.index ?? 0) + match[0].length + 30)
              ),
              method: "regex",
            },
          });

          if (!rule.multipleValues) break;
        }
      }
    }

    return deduplicateFacts(results);
  }

  extractFromSections(
    sections: Array<{ title: string; content: string; isSynopsis?: boolean }>
  ): ExtractedFact[] {
    const allFacts: ExtractedFact[] = [];

    const synopsisSection = sections.find((s) => s.isSynopsis);
    if (synopsisSection) {
      allFacts.push(...this.extract(synopsisSection.content, synopsisSection.title));
    }

    for (const section of sections) {
      if (section.isSynopsis) continue;
      allFacts.push(...this.extract(section.content, section.title));
    }

    return deduplicateFacts(allFacts);
  }
}

function deduplicateFacts(facts: ExtractedFact[]): ExtractedFact[] {
  const seen = new Map<string, ExtractedFact>();
  for (const fact of facts) {
    const key = `${fact.factKey}:${fact.value}`;
    if (!seen.has(key)) {
      seen.set(key, fact);
    }
  }
  return Array.from(seen.values());
}

export const DEFAULT_FACT_RULES: FactExtractionRule[] = [
  {
    factKey: "study_title",
    patterns: ["(?:study|protocol)\\s+title[:\\s]+([^\\n]+)"],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "protocol_number",
    patterns: ["protocol\\s+(?:number|no\\.?|#)[:\\s]+([A-Z0-9\\-]+)"],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "sponsor",
    patterns: ["sponsor[:\\s]+([^\\n]+)", "sponsored\\s+by[:\\s]+([^\\n]+)"],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "study_phase",
    patterns: ["phase\\s+(I{1,3}V?(?:\\/I{1,3})?|[1-4])"],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "indication",
    patterns: [
      "indication[:\\s]+([^\\n]+)",
      "therapeutic\\s+area[:\\s]+([^\\n]+)",
      "disease[:\\s]+([^\\n]+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "study_drug",
    patterns: [
      "investigational\\s+(?:product|drug|medicinal\\s+product)[:\\s]+([^\\n]+)",
      "study\\s+drug[:\\s]+([^\\n]+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "sample_size",
    patterns: [
      "(?:approximately|total\\s+of|enroll)\\s+(\\d+)\\s+(?:subjects?|patients?|participants?)",
      "sample\\s+size[:\\s]+(\\d+)",
      "N\\s*=\\s*(\\d+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "study_duration",
    patterns: [
      "(?:study|treatment)\\s+duration[:\\s]+([^\\n]+)",
      "duration\\s+of\\s+(?:study|treatment)[:\\s]+([^\\n]+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "primary_endpoint",
    patterns: [
      "primary\\s+(?:endpoint|outcome|efficacy\\s+endpoint)[:\\s]+([^\\n]+)",
    ],
    factClass: "phase_specific",
    sourcePriority: ["synopsis", "body"],
    multipleValues: true,
  },
  {
    factKey: "secondary_endpoint",
    patterns: [
      "secondary\\s+(?:endpoint|outcome)[:\\s]+([^\\n]+)",
    ],
    factClass: "phase_specific",
    sourcePriority: ["body"],
    multipleValues: true,
  },
  {
    factKey: "inclusion_criteria",
    patterns: ["inclusion\\s+criteria[:\\s]*([^\\n]+)"],
    factClass: "phase_specific",
    sourcePriority: ["body"],
    multipleValues: true,
  },
  {
    factKey: "exclusion_criteria",
    patterns: ["exclusion\\s+criteria[:\\s]*([^\\n]+)"],
    factClass: "phase_specific",
    sourcePriority: ["body"],
    multipleValues: true,
  },
];
