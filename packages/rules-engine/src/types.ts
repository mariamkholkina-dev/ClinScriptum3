export interface RuleDefinition {
  name: string;
  pattern: string;
  config: Record<string, unknown>;
}

export interface SectionMappingRule {
  standardSection: string;
  patterns: string[];
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
