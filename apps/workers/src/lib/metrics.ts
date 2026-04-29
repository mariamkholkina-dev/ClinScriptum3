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
