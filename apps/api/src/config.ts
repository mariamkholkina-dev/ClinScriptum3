export type LlmTask =
  | "section_classify"
  | "fact_extraction"
  | "fact_extraction_qa"
  | "intra_audit"
  | "intra_audit_qa"
  | "inter_audit"
  | "inter_audit_qa"
  | "generation"
  | "generation_qa"
  | "impact_analysis";

export interface LlmTaskConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

const DEFAULT_MAX_TOKENS: Record<string, number> = {
  fact_extraction: 16384,
  fact_extraction_qa: 4096,
  intra_audit: 4096,
  intra_audit_qa: 2048,
  inter_audit: 8192,
  inter_audit_qa: 4096,
  generation: 8192,
  generation_qa: 4096,
};

const GLOBAL_DEFAULT_MAX_TOKENS = 2048;

function llmTaskConfig(task: string): LlmTaskConfig {
  const prefix = `LLM_${task.toUpperCase()}_`;
  const defaultMax = DEFAULT_MAX_TOKENS[task] ?? GLOBAL_DEFAULT_MAX_TOKENS;
  return {
    provider: process.env[`${prefix}PROVIDER`] || process.env.LLM_PROVIDER || "yandexgpt",
    baseUrl: process.env[`${prefix}BASE_URL`] || process.env.LLM_BASE_URL || "",
    apiKey: process.env[`${prefix}API_KEY`] || process.env.LLM_API_KEY || "",
    model: process.env[`${prefix}MODEL`] || process.env.LLM_MODEL || "",
    temperature: parseFloat(process.env[`${prefix}TEMPERATURE`] || "0.1"),
    maxTokens: parseInt(process.env[`${prefix}MAX_TOKENS`] || String(defaultMax), 10),
  };
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  refreshTokenExpiresInDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS ?? "30", 10),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",

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
