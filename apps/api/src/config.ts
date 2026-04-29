export type LlmTask =
  | "section_classify"
  | "section_classify_qa"
  | "fact_extraction"
  | "fact_extraction_qa"
  | "soa_detection"
  | "soa_detection_qa"
  | "intra_audit"
  | "intra_audit_qa"
  | "inter_audit"
  | "inter_audit_qa"
  | "fact_audit_intra"
  | "fact_audit_intra_qa"
  | "fact_audit_inter"
  | "fact_audit_inter_qa"
  | "generation"
  | "generation_qa"
  | "impact_analysis"
  | "impact_analysis_qa"
  | "change_classification"
  | "change_classification_qa"
  | "correction_recommend";

export interface LlmTaskConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxInputTokens: number;
}

const CHARS_PER_TOKEN = 3.5;

export function getInputBudgetChars(cfg: LlmTaskConfig): number {
  return Math.floor(cfg.maxInputTokens * CHARS_PER_TOKEN);
}

const DEFAULT_MAX_TOKENS: Record<string, number> = {
  section_classify: 2048,
  section_classify_qa: 2048,
  fact_extraction: 16384,
  fact_extraction_qa: 4096,
  soa_detection: 8192,
  soa_detection_qa: 4096,
  intra_audit: 4096,
  intra_audit_qa: 2048,
  inter_audit: 8192,
  inter_audit_qa: 4096,
  fact_audit_intra: 4096,
  fact_audit_intra_qa: 2048,
  fact_audit_inter: 8192,
  fact_audit_inter_qa: 4096,
  generation: 8192,
  generation_qa: 4096,
  impact_analysis: 8192,
  impact_analysis_qa: 4096,
  change_classification: 4096,
  change_classification_qa: 2048,
  correction_recommend: 8192,
};

const GLOBAL_DEFAULT_MAX_TOKENS = 2048;

const DEFAULT_MAX_INPUT_TOKENS: Record<string, number> = {
  section_classify: 8000,
  section_classify_qa: 8000,
  fact_extraction: 60000,
  fact_extraction_qa: 30000,
  soa_detection: 30000,
  soa_detection_qa: 16000,
  intra_audit: 60000,
  intra_audit_qa: 16000,
  inter_audit: 60000,
  inter_audit_qa: 16000,
  fact_audit_intra: 30000,
  fact_audit_intra_qa: 16000,
  fact_audit_inter: 30000,
  fact_audit_inter_qa: 16000,
  generation: 30000,
  generation_qa: 16000,
  impact_analysis: 30000,
  impact_analysis_qa: 16000,
  change_classification: 16000,
  change_classification_qa: 8000,
  correction_recommend: 30000,
};

const GLOBAL_DEFAULT_MAX_INPUT_TOKENS = 16000;

function llmTaskConfig(task: string): LlmTaskConfig {
  const prefix = `LLM_${task.toUpperCase()}_`;
  const defaultMax = DEFAULT_MAX_TOKENS[task] ?? GLOBAL_DEFAULT_MAX_TOKENS;
  const defaultMaxInput = DEFAULT_MAX_INPUT_TOKENS[task] ?? GLOBAL_DEFAULT_MAX_INPUT_TOKENS;
  return {
    provider: process.env[`${prefix}PROVIDER`] || process.env.LLM_PROVIDER || "yandexgpt",
    baseUrl: process.env[`${prefix}BASE_URL`] || process.env.LLM_BASE_URL || "",
    apiKey: process.env[`${prefix}API_KEY`] || process.env.LLM_API_KEY || "",
    model: process.env[`${prefix}MODEL`] || process.env.LLM_MODEL || "",
    temperature: parseFloat(process.env[`${prefix}TEMPERATURE`] || "0.1"),
    maxTokens: parseInt(process.env[`${prefix}MAX_TOKENS`] || String(defaultMax), 10),
    maxInputTokens: parseInt(process.env[`${prefix}MAX_INPUT_TOKENS`] || String(defaultMaxInput), 10),
  };
}

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required in production");
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  refreshTokenExpiresInDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS ?? "30", 10),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : ["http://localhost:3000", "https://localhost:3001", "http://localhost:3002", "http://127.0.0.1:3000", "http://127.0.0.1:3002"],

  storage: {
    type: (process.env.STORAGE_TYPE ?? "local") as "local" | "s3",
    localPath: process.env.STORAGE_LOCAL_PATH ?? "./uploads",
    s3: {
      bucket: process.env.S3_BUCKET ?? "clinscriptum",
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  },

  llm(task: LlmTask): LlmTaskConfig {
    return llmTaskConfig(task);
  },

  generation: {
    modelWindowChars: parseInt(process.env.LLM_GENERATION_MODEL_WINDOW_CHARS ?? "12000", 10),
    qaWindowChars: parseInt(process.env.LLM_GENERATION_QA_WINDOW_CHARS ?? "12000", 10),
  },
} as const;
