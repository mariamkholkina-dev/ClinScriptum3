import type { FactExtractionRule } from "./types.js";
import { aggregateByCanonical, type AggregatedFact } from "./canonicalize.js";

const MAX_VALUE_LENGTH = 120;

function cleanExtractedValue(raw: string): string {
  let v = raw.replace(/\s+/g, " ").trim();
  const cutoff = v.search(/[.;]\s/);
  if (cutoff > 0 && cutoff < v.length - 1) {
    v = v.slice(0, cutoff).trim();
  }
  if (v.length > MAX_VALUE_LENGTH) {
    const lastSpace = v.lastIndexOf(" ", MAX_VALUE_LENGTH);
    v = lastSpace > 20 ? v.slice(0, lastSpace).trim() : v.slice(0, MAX_VALUE_LENGTH).trim();
  }
  v = v.replace(/[,;:\s]+$/, "");
  return v;
}

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
   *
   * Returns aggregated facts grouped by canonical value. All raw
   * matches are collected (no early-exit on first hit) so that
   * synopsis + body confirmations boost confidence and contradictions
   * remain visible to downstream callers.
   */
  extract(text: string, sectionTitle?: string): AggregatedFact[] {
    return aggregateByCanonical(this.extractRaw(text, sectionTitle));
  }

  /**
   * Lower-level API: returns every raw match, in order. Use
   * `aggregateByCanonical` to collapse them. Useful for callers
   * that need to combine matches from multiple sections before
   * voting.
   */
  extractRaw(text: string, sectionTitle?: string): ExtractedFact[] {
    const results: ExtractedFact[] = [];

    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        const re = new RegExp(pattern.replace(/\(\?[imsu]+\)/g, ""), "gi");
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
          const raw = (match[1] ?? match[0]).trim();
          const value = cleanExtractedValue(raw);
          if (!value) continue;

          results.push({
            factKey: rule.factKey,
            value,
            factClass: rule.factClass,
            source: {
              sectionTitle,
              textSnippet: text.slice(
                Math.max(0, (match.index ?? 0) - 200),
                Math.min(text.length, (match.index ?? 0) + match[0].length + 200)
              ),
              method: "regex",
            },
          });
        }
      }
    }

    return results;
  }

  extractFromSections(
    sections: Array<{ title: string; content: string; isSynopsis?: boolean }>
  ): AggregatedFact[] {
    const allRaw: ExtractedFact[] = [];

    const synopsisSection = sections.find((s) => s.isSynopsis);
    if (synopsisSection) {
      allRaw.push(...this.extractRaw(synopsisSection.content, synopsisSection.title));
    }

    for (const section of sections) {
      if (section.isSynopsis) continue;
      allRaw.push(...this.extractRaw(section.content, section.title));
    }

    return aggregateByCanonical(allRaw);
  }
}

export const DEFAULT_FACT_RULES: FactExtractionRule[] = [
  {
    factKey: "study_title",
    patterns: [
      "(?:study|protocol)\\s+title[:\\s]+([^\\n]+)",
      "(?:название\\s+исследовани|название\\s+протокол)\\w*[:\\s]+([^\\n]+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "protocol_number",
    patterns: [
      "protocol\\s+(?:number|no\\.?|#)[:\\s]+([A-ZА-Яa-zа-я0-9][A-ZА-Яa-zа-я0-9\\-_./]+)",
      "(?:номер\\s+(?:протокол|исследовани)|код\\s+исследовани)\\w*[:\\s]+([A-ZА-Яa-zа-я0-9][A-ZА-Яa-zа-я0-9\\-_./]+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "sponsor",
    patterns: [
      "sponsor[:\\s]+([^\\n]+)",
      "sponsored\\s+by[:\\s]+([^\\n]+)",
      "(?:спонсор)\\s*[:\\s]+([^\\n]+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "study_phase",
    patterns: [
      "(?:фаз[аыеу]|phase)\\s*(I{1,3}V?(?:\\/I{1,3})?|[1-4](?:\\/[1-4])?)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "indication",
    patterns: [
      "indication[:\\s]+([^\\n]+)",
      "therapeutic\\s+area[:\\s]+([^\\n]+)",
      "(?:терапевтическ\\w+\\s+област|показани[ея]|для\\s+лечения)\\s*[:\\s]+([^\\n]+)",
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
      "(?:исследуемый\\s+препарат|исследуемое\\s+лекарственное\\s+средство|ИП|IMP)\\s*[:\\s—–-]+([^\\n]+)",
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
      "(?:всего|общее\\s+число|величина\\s+выборки|объ[её]м\\s+выборки|размер\\s+выборки)\\s*[:\\s]?\\s*(\\d+)",
      "(?:с\\s+участием|включает|включено)\\s+(\\d+)\\s*(?:доброволь|участни|субъект|пациент)",
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
      "(?:продолжительность\\s+исследовани|длительность\\s+исследовани|сроки\\s+проведения)\\s*[:\\s—–-]+([^\\n]+)",
    ],
    factClass: "general",
    sourcePriority: ["synopsis", "body"],
    multipleValues: false,
  },
  {
    factKey: "primary_endpoint",
    patterns: [
      "primary\\s+(?:endpoint|outcome|efficacy\\s+endpoint)[:\\s]+([^\\n]+)",
      "(?:первичн\\w+\\s+конечн\\w+\\s+точк|основн\\w+\\s+(?:конечн\\w+\\s+точк|критери\\w+\\s+эффективност))\\w*[:\\s—–-]+([^\\n]+)",
    ],
    factClass: "phase_specific",
    sourcePriority: ["synopsis", "body"],
    multipleValues: true,
  },
  {
    factKey: "secondary_endpoint",
    patterns: [
      "secondary\\s+(?:endpoint|outcome)[:\\s]+([^\\n]+)",
      "(?:вторичн\\w+\\s+конечн\\w+\\s+точк|вторичн\\w+\\s+цел)\\w*[:\\s—–-]+([^\\n]+)",
    ],
    factClass: "phase_specific",
    sourcePriority: ["body"],
    multipleValues: true,
  },
  {
    factKey: "inclusion_criteria",
    patterns: [
      "inclusion\\s+criteria[:\\s]*([^\\n]+)",
      "(?:критери\\w+\\s+включени)\\s*[:\\s]*([^\\n]+)",
    ],
    factClass: "phase_specific",
    sourcePriority: ["body"],
    multipleValues: true,
  },
  {
    factKey: "exclusion_criteria",
    patterns: [
      "exclusion\\s+criteria[:\\s]*([^\\n]+)",
      "(?:критери\\w+\\s+(?:не)?включени)\\s*[:\\s]*([^\\n]+)",
    ],
    factClass: "phase_specific",
    sourcePriority: ["body"],
    multipleValues: true,
  },
];
