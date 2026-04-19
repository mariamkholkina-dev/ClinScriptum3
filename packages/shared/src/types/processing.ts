export interface ProcessingRun {
  id: string;
  studyId: string;
  docVersionId: string;
  type: ProcessingRunType;
  status: ProcessingRunStatus;
  ruleSetVersionId: string | null;
  ruleSetBundleId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ProcessingRunType =
  | "section_classification"
  | "fact_extraction"
  | "soa_detection"
  | "intra_doc_audit"
  | "inter_doc_audit"
  | "icf_generation"
  | "csr_generation"
  | "version_comparison";

export type ProcessingRunStatus = "queued" | "running" | "completed" | "failed";

export interface ProcessingStep {
  id: string;
  processingRunId: string;
  level: PipelineLevel;
  status: ProcessingStepStatus;
  result: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export type PipelineLevel =
  | "deterministic"
  | "llm_check"
  | "llm_qa"
  | "operator_review"
  | "user_validation";

export type ProcessingStepStatus = "pending" | "running" | "completed" | "skipped" | "failed";
