export { RulesEngine } from "./engine.js";
export { SectionClassifier, DEFAULT_PROTOCOL_SECTIONS } from "./section-classifier.js";
export { FactExtractor, DEFAULT_FACT_RULES } from "./fact-extractor.js";
export { detectContradictions } from "./contradiction-detector.js";
export type { RuleSetConfig, SectionMappingRule, FactExtractionRule } from "./types.js";
export type { ClassificationResult } from "./section-classifier.js";
export type { ExtractedFact } from "./fact-extractor.js";
export type { Contradiction } from "./contradiction-detector.js";
export { toSectionMappingRules, toFactExtractionRules, toAuditPrompt, toAuditPromptMap, toGenerationPrompts } from "./rule-adapter.js";
export type { DbRule } from "./rule-adapter.js";
export {
  stem,
  tokenize,
  stemPhrase,
  expandCyrillicEndings,
  stemEquals,
} from "./morphology.js";
export type { Lang } from "./morphology.js";
