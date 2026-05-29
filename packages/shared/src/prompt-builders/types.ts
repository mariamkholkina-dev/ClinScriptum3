/**
 * Общий тип для «реального» LLM-вызова, реконструированного для выгрузки в .txt.
 * Используется и в worker-handler'ах (через builders), и в preview-сервисе API,
 * чтобы выгруженный промт был идентичен уходящему в LLM (single source of truth).
 */
export interface PromptCall {
  /** Этап пайплайна: "intra_audit" | "classification" | ... */
  stage: string;
  /** Уровень: "llm_check" | "llm_qa" */
  level: string;
  /** Человекочитаемая метка конкретного вызова: "self_check", "cross_check:synopsis→statistics", ... */
  label: string;
  /** Полный system prompt, уходящий в gateway.generate({system}). */
  system: string;
  /** Полный user message (messages[0].content). */
  user: string;
  /** Доп. метаданные для handler'а (kind/zone) — preview игнорирует. */
  meta?: Record<string, unknown>;
}

/** Секция документа в виде, достаточном для сборки промтов аудита. */
export interface AnchorableSectionInput {
  title: string;
  standardSection?: string | null;
  headingNumber?: string | null;
  order?: number | null;
  contentBlocks: Array<{ content: string }>;
}
