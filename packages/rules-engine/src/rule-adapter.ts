import type { SectionMappingRule, FactExtractionRule } from "./types.js";

export interface DbRule {
  name: string;
  pattern: string;
  config: unknown;
  documentType?: string | null;
  promptTemplate?: string | null;
  isEnabled?: boolean;
  order?: number;
}

export function toSectionMappingRules(dbRules: DbRule[]): SectionMappingRule[] {
  return dbRules
    .filter((r) => r.pattern !== "system_prompt")
    .map((r) => {
      const cfg = (r.config ?? {}) as Record<string, unknown>;
      const patterns = Array.isArray(cfg.patterns)
        ? (cfg.patterns as string[])
        : [r.pattern];
      return {
        standardSection: r.pattern,
        patterns,
        level: typeof cfg.level === "number" ? cfg.level : undefined,
        isRequired: cfg.isRequired === true,
        category: (cfg.category as "protocol" | "administrative" | "appendix") ?? "protocol",
      };
    });
}

export function toFactExtractionRules(dbRules: DbRule[]): FactExtractionRule[] {
  return dbRules
    .filter((r) => {
      if (r.pattern === "system_prompt") return false;
      const cfg = (r.config ?? {}) as Record<string, unknown>;
      return Array.isArray(cfg.patterns) && cfg.patterns.length > 0;
    })
    .map((r) => {
      const cfg = (r.config ?? {}) as Record<string, unknown>;
      return {
        factKey: r.pattern,
        patterns: cfg.patterns as string[],
        factClass: (cfg.factClass as "general" | "phase_specific") ?? "general",
        sourcePriority: Array.isArray(cfg.sourcePriority)
          ? (cfg.sourcePriority as ("synopsis" | "body" | "soa")[])
          : ["body"],
        multipleValues: cfg.multipleValues === true,
      };
    });
}

export function toAuditPrompt(dbRules: DbRule[]): string | null {
  const systemRule = dbRules.find((r) => r.pattern === "system_prompt");
  return systemRule?.promptTemplate ?? null;
}

export function toGenerationPrompts(
  dbRules: DbRule[],
): { systemPrompt: string | null; sectionPrompts: Map<string, string> } {
  let systemPrompt: string | null = null;
  const sectionPrompts = new Map<string, string>();

  for (const rule of dbRules) {
    if (!rule.promptTemplate) continue;
    if (rule.pattern === "system_prompt") {
      systemPrompt = rule.promptTemplate;
    } else {
      sectionPrompts.set(rule.pattern, rule.promptTemplate);
    }
  }

  return { systemPrompt, sectionPrompts };
}
