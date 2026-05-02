import type { SectionMappingRule } from "./types.js";

export interface ClassificationResult {
  sectionTitle: string;
  standardSection: string | null;
  confidence: number;
  method: "exact" | "pattern" | "content";
}

const WORD_CHAR = "[а-яА-ЯёЁa-zA-Z0-9_]";
const WORD_BOUNDARY = `(?:(?<=${WORD_CHAR})(?!${WORD_CHAR})|(?<!${WORD_CHAR})(?=${WORD_CHAR}))`;

function adaptPatternForUnicode(pattern: string): string {
  return pattern
    .replace(/\\b/g, WORD_BOUNDARY)
    .replace(/\\w/g, WORD_CHAR);
}

const regexCache = new Map<string, RegExp | null>();

function safeRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;
  try {
    let flags = "";
    let clean = pattern;
    if (clean.startsWith("(?i)")) {
      flags = "i";
      clean = clean.slice(4);
    }
    clean = clean.replace(/\(\?[imsu]+\)/g, "");
    clean = adaptPatternForUnicode(clean);
    const re = new RegExp(clean, flags || "i");
    if (regexCache.size >= 500) {
      const firstKey = regexCache.keys().next().value;
      if (firstKey !== undefined) regexCache.delete(firstKey);
    }
    regexCache.set(pattern, re);
    return re;
  } catch {
    regexCache.set(pattern, null);
    return null;
  }
}

interface CandidateScore {
  rule: SectionMappingRule;
  score: number;
  method: "exact" | "content";
}

const TITLE_EXACT_BASE = 0.6;
const TITLE_FRACTION_WEIGHT = 0.3;
const MULTI_MATCH_BONUS = 0.05;
const CONTENT_ONLY_CONFIDENCE = 0.65;
const NOT_KEYWORD_PENALTY = 0.4;
const MAX_CONFIDENCE = 0.99;
const MAX_MULTI_MATCH_BONUS_COUNT = 2;

// Parent-zone иерархический контекст (task 2.1).
// Когда секция имеет document-parent в зоне X (по структуре документа),
// и кандидат-правило — subzone X (parentZone === X) → даём бонус, чтобы
// иерархически правильная subzone выиграла у конкурирующих "общих" правил.
// Если кандидат — subzone ДРУГОЙ зоны (parentZone !== X) → штраф,
// потому что вложенная секция логично должна оставаться в parent-зоне.
const PARENT_ZONE_BONUS = 0.05;
const PARENT_ZONE_PENALTY = 0.1;

// Sprint 4.2: глобальные singleton zones — могут появляться только ОДИН раз
// в документе. Если deterministic classifier выдал ту же singleton zone для
// нескольких секций, оставляем секцию с max confidence (первое появление при
// равенстве), остальным сбрасываем zone=null,confidence=0 — пусть LLM Check
// классифицирует их заново.
//
// Список основан на анализе taxonomy: zones которые семантически уникальны
// в одном протоколе. При расширении taxonomy схемы (поле `unique:true`) —
// заменить на динамический load из rules.
const SINGLETON_ZONES = new Set([
  "synopsis",
  "rationale",
  "introduction",
  "abbreviations",
  "table_of_contents",
  "references",
  "schema",
  "visit_schedule",
]);

export class SectionClassifier {
  private rules: SectionMappingRule[];

  constructor(rules: SectionMappingRule[]) {
    this.rules = rules;
  }

  classify(
    title: string,
    contentSnippet?: string,
    parentZone?: string | null,
  ): ClassificationResult {
    const titleLower = title.toLowerCase();
    const contentLower = (contentSnippet ?? "").toLowerCase();
    const haystack = contentLower ? `${titleLower}\n${contentLower}` : titleLower;

    const candidates: CandidateScore[] = [];

    for (const rule of this.rules) {
      if (rule.requirePatterns?.length) {
        const gateOk = rule.requirePatterns.some((p) => safeRegex(p)?.test(haystack));
        if (!gateOk) continue;
      }

      let titleMatchLen = 0;
      let titleMatchCount = 0;
      let hasContentMatch = false;

      for (const pattern of rule.patterns) {
        const re = safeRegex(pattern);
        if (!re) continue;
        const tm = titleLower.match(re);
        if (tm && tm[0].length > 0) {
          titleMatchLen += tm[0].length;
          titleMatchCount += 1;
          continue;
        }
        if (contentLower && re.test(contentLower)) {
          hasContentMatch = true;
        }
      }

      let score: number;
      let method: "exact" | "content";

      if (titleMatchCount > 0) {
        method = "exact";
        const fraction = Math.min(titleMatchLen / Math.max(titleLower.length, 1), 1);
        const bonusCount = Math.min(titleMatchCount, MAX_MULTI_MATCH_BONUS_COUNT);
        score = Math.min(
          MAX_CONFIDENCE,
          TITLE_EXACT_BASE + TITLE_FRACTION_WEIGHT * fraction + MULTI_MATCH_BONUS * bonusCount,
        );
      } else if (hasContentMatch) {
        method = "content";
        score = CONTENT_ONLY_CONFIDENCE;
      } else {
        continue;
      }

      const negHit = rule.notKeywords?.some((p) => safeRegex(p)?.test(haystack)) ?? false;
      if (negHit) score = Math.max(0, score - NOT_KEYWORD_PENALTY);

      // Hierarchical parent-zone context (task 2.1):
      // влияет только на subzone-кандидатов, top-level zones не трогаем.
      if (parentZone && rule.type === "subzone" && rule.parentZone) {
        if (rule.parentZone === parentZone) {
          score = Math.min(MAX_CONFIDENCE, score + PARENT_ZONE_BONUS);
        } else {
          score = Math.max(0, score - PARENT_ZONE_PENALTY);
        }
      }

      if (score > 0) candidates.push({ rule, score, method });
    }

    if (candidates.length === 0) {
      return {
        sectionTitle: title,
        standardSection: null,
        confidence: 0,
        method: "pattern",
      };
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return {
      sectionTitle: title,
      standardSection: best.rule.standardSection,
      confidence: best.score,
      method: best.method,
    };
  }

  classifyAll(
    sections: Array<{ title: string; content?: string }>,
  ): ClassificationResult[] {
    return sections.map((s) => this.classify(s.title, s.content));
  }

  /**
   * Иерархическая классификация (task 2.1).
   * Итерирует sections в document-order, поддерживая stack `{level, zone}`
   * для определения document-parent-zone каждой секции. Передаёт parent-zone
   * в classify(), который применяет bonus +0.05 если кандидат-subzone matches
   * parent или penalty -0.1 если subzone другой зоны.
   *
   * Sections должны быть в порядке появления в документе (sorted by .order).
   * Возвращает Map id → result.
   */
  classifyHierarchical(
    sections: Array<{ id: string; title: string; level?: number | null; contentSnippet?: string }>,
  ): Map<string, ClassificationResult> {
    const out = new Map<string, ClassificationResult>();
    const ruleByZone = new Map<string, SectionMappingRule>();
    for (const rule of this.rules) {
      ruleByZone.set(rule.standardSection, rule);
    }
    const stack: Array<{ level: number; zone: string | null }> = [];

    for (const s of sections) {
      const level = s.level ?? 0;

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      const documentParentZone = stack.length > 0 ? stack[stack.length - 1].zone : null;

      const result = this.classify(s.title, s.contentSnippet, documentParentZone);
      out.set(s.id, result);

      // Push current section's effective document-zone onto stack — это используется
      // как parent для глубже вложенных секций. Для top-level zone (type='zone')
      // это сам standardSection. Для subzone — берём rule.parentZone (top-level зона
      // логически продолжается вглубь).
      let stackZone: string | null = null;
      if (result.standardSection) {
        const rule = ruleByZone.get(result.standardSection);
        if (rule?.type === "zone") {
          stackZone = result.standardSection;
        } else if (rule?.parentZone) {
          stackZone = rule.parentZone;
        }
      }
      stack.push({ level, zone: stackZone });
    }

    // Sprint 4.2: enforce singleton constraints. Группируем секции по
    // standardSection. Если zone ∈ SINGLETON_ZONES и группа имеет ≥2 секций —
    // оставляем ту что с max confidence, остальные обнуляем (LLM переклассифицирует).
    const byZone = new Map<string, Array<{ id: string; result: ClassificationResult }>>();
    for (const [id, result] of out) {
      if (!result.standardSection) continue;
      if (!SINGLETON_ZONES.has(result.standardSection)) continue;
      const arr = byZone.get(result.standardSection) ?? [];
      arr.push({ id, result });
      byZone.set(result.standardSection, arr);
    }
    for (const [, group] of byZone) {
      if (group.length < 2) continue;
      // Sort desc by confidence, ties → preserve document order (stable).
      group.sort((a, b) => b.result.confidence - a.result.confidence);
      // Все кроме первого — обнуляем.
      for (let i = 1; i < group.length; i++) {
        out.set(group[i].id, {
          sectionTitle: group[i].result.sectionTitle,
          standardSection: null,
          confidence: 0,
          method: group[i].result.method,
        });
      }
    }

    return out;
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
    // PR-12 (2026-04-30): зона merged in design.visit_schedule. Старый ключ
    // schedule_of_assessments оставлен для backward compat в DEFAULT_PROTOCOL_SECTIONS,
    // но canonical теперь visit_schedule.
    standardSection: "visit_schedule",
    patterns: ["schedule\\s+of\\s+(assessments?|activities?|procedures?)", "\\bSOA\\b", "(?i)регламент\\s+клиническ\\w*\\s+исследован\\w*", "(?i)блок-?схем\\w*\\s+исследован\\w*"],
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
