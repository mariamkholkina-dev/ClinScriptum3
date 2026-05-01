export interface RuleDefinition {
  name: string;
  pattern: string;
  config: Record<string, unknown>;
}

export interface SectionMappingRule {
  standardSection: string;
  patterns: string[];
  /**
   * Hard gate: rule applies only if at least one requirePatterns matches title+content.
   * Если массив пустой / undefined — гейт отключён.
   */
  requirePatterns?: string[];
  /**
   * Negative-signal patterns: совпадение даёт штраф −0.4 к финальной confidence.
   */
  notKeywords?: string[];
  /**
   * Иерархия: zone — top-level, subzone — child of parentZone.
   */
  type?: "zone" | "subzone";
  parentZone?: string;
  level?: number;
  isRequired: boolean;
  category: "protocol" | "administrative" | "appendix";
}

export interface FactExtractionRule {
  factKey: string;
  patterns: string[];
  factClass: "general" | "phase_specific";
  sourcePriority: ("synopsis" | "body" | "soa")[];
  multipleValues: boolean;
}

export interface RuleSetConfig {
  sectionMappings: SectionMappingRule[];
  factExtractions: FactExtractionRule[];
}
