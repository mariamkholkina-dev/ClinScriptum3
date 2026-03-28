import { SectionClassifier, DEFAULT_PROTOCOL_SECTIONS } from "./section-classifier.js";
import { FactExtractor, DEFAULT_FACT_RULES } from "./fact-extractor.js";
import { detectContradictions } from "./contradiction-detector.js";
import type { RuleSetConfig, SectionMappingRule, FactExtractionRule } from "./types.js";

export class RulesEngine {
  private sectionClassifier: SectionClassifier;
  private factExtractor: FactExtractor;

  constructor(config?: Partial<RuleSetConfig>) {
    this.sectionClassifier = new SectionClassifier(
      config?.sectionMappings ?? DEFAULT_PROTOCOL_SECTIONS
    );
    this.factExtractor = new FactExtractor(
      config?.factExtractions ?? DEFAULT_FACT_RULES
    );
  }

  getSectionClassifier() {
    return this.sectionClassifier;
  }

  getFactExtractor() {
    return this.factExtractor;
  }

  getContradictionDetector() {
    return detectContradictions;
  }
}
