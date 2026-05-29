/**
 * Re-export anchor-хелперов из @clinscriptum/shared.
 *
 * Логика перенесена в packages/shared/src/prompt-builders/intra-audit.ts
 * (single source of truth — её же использует preview-сервис выгрузки промтов).
 * Этот файл сохранён для обратной совместимости импортов внутри workers.
 */
export {
  buildSectionAnchor,
  parseSectionAnchor,
  type AnchorableSection,
} from "@clinscriptum/shared";
