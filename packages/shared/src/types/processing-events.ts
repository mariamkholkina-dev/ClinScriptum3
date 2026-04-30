export type ProcessingEventType =
  | "version_status_changed"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_skipped";

export interface ProcessingEvent {
  type: ProcessingEventType;
  docVersionId: string;
  tenantId: string;
  processingRunId?: string;
  timestamp: string;
  data: {
    status?: string;
    level?: string;
    runType?: string;
    durationMs?: number;
    error?: string;
    stepsCompleted?: number;
  };
}

export const PROCESSING_EVENTS_CHANNEL = "processing:events";
