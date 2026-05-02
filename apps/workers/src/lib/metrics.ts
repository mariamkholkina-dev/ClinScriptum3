import { logger } from "./logger.js";

export function recordPipelineMetric(event: {
  processingRunId: string;
  pipelineLevel: string;
  status: string;
  durationMs: number;
  attempts?: number;
}) {
  logger.info("pipeline_step_metric", event);
}

export function recordPipelineComplete(event: {
  processingRunId: string;
  totalDurationMs: number;
  stepsCompleted: number;
  status: string;
}) {
  logger.info("pipeline_complete_metric", event);
}

export interface ExtractionMetric {
  processingRunId: string;
  phase: "deterministic" | "llm_check" | "llm_qa";
  factKey?: string;
  sectionId?: string;
  parseError?: boolean;
  tokens?: number;
  durationMs?: number;
  matched?: boolean;
}

export function recordExtractionMetric(event: ExtractionMetric) {
  logger.info("fact_extraction_metric", { ...event });
}
