import { prisma } from "./index.js";

export interface LlmTaskConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxInputTokens: number;
  sourceConfigId?: string;
  sourceType: "db_tenant" | "db_global" | "env_task" | "env_global";
}

export interface LlmConfigSnapshot {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxInputTokens: number;
  sourceType: "db_tenant" | "db_global" | "env_task" | "env_global";
  sourceConfigId?: string;
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

const DEFAULT_MAX_INPUT_TOKENS: Record<string, number> = {
  fact_extraction: 60000,
  fact_extraction_qa: 30000,
  intra_audit: 60000,
  intra_audit_qa: 16000,
  inter_audit: 60000,
  inter_audit_qa: 16000,
  generation: 30000,
  generation_qa: 16000,
};

const GLOBAL_DEFAULT_MAX_INPUT_TOKENS = 16000;

export async function getEffectiveLlmConfig(
  taskId: string,
  tenantId?: string,
): Promise<LlmTaskConfig> {
  const defaultMaxInput = DEFAULT_MAX_INPUT_TOKENS[taskId] ?? GLOBAL_DEFAULT_MAX_INPUT_TOKENS;

  if (tenantId) {
    const tenantConfig = await prisma.llmConfig.findFirst({
      where: { taskId, tenantId, isDefault: true, isActive: true },
    });
    if (tenantConfig) {
      return {
        provider: tenantConfig.provider,
        baseUrl: tenantConfig.baseUrl,
        apiKey: tenantConfig.apiKey,
        model: tenantConfig.model,
        temperature: tenantConfig.temperature,
        maxTokens: tenantConfig.maxOutputTokens,
        maxInputTokens: tenantConfig.maxInputTokens ?? defaultMaxInput,
        sourceConfigId: tenantConfig.id,
        sourceType: "db_tenant",
      };
    }
  }

  const globalConfig = await prisma.llmConfig.findFirst({
    where: { taskId, tenantId: null, isDefault: true, isActive: true },
  });
  if (globalConfig) {
    return {
      provider: globalConfig.provider,
      baseUrl: globalConfig.baseUrl,
      apiKey: globalConfig.apiKey,
      model: globalConfig.model,
      temperature: globalConfig.temperature,
      maxTokens: globalConfig.maxOutputTokens,
      maxInputTokens: globalConfig.maxInputTokens ?? defaultMaxInput,
      sourceConfigId: globalConfig.id,
      sourceType: "db_global",
    };
  }

  const prefix = `LLM_${taskId.toUpperCase()}_`;
  const defaultMax = DEFAULT_MAX_TOKENS[taskId] ?? GLOBAL_DEFAULT_MAX_TOKENS;

  const taskProvider = process.env[`${prefix}PROVIDER`];
  const taskModel = process.env[`${prefix}MODEL`];
  const hasTaskEnv = !!(taskProvider || taskModel);

  return {
    provider: taskProvider || process.env.LLM_PROVIDER || "yandexgpt",
    baseUrl: process.env[`${prefix}BASE_URL`] || process.env.LLM_BASE_URL || "",
    apiKey: process.env[`${prefix}API_KEY`] || process.env.LLM_API_KEY || "",
    model: taskModel || process.env.LLM_MODEL || "",
    temperature: parseFloat(process.env[`${prefix}TEMPERATURE`] || "0.1"),
    maxTokens: parseInt(process.env[`${prefix}MAX_TOKENS`] || String(defaultMax), 10),
    maxInputTokens: parseInt(process.env[`${prefix}MAX_INPUT_TOKENS`] || String(defaultMaxInput), 10),
    sourceType: hasTaskEnv ? "env_task" : "env_global",
  };
}

export function toConfigSnapshot(config: LlmTaskConfig): LlmConfigSnapshot {
  return {
    provider: config.provider,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    maxInputTokens: config.maxInputTokens,
    sourceType: config.sourceType,
    sourceConfigId: config.sourceConfigId,
  };
}

const CHARS_PER_TOKEN = 3.5;

export function getInputBudgetChars(cfg: { maxInputTokens: number }): number {
  return Math.floor(cfg.maxInputTokens * CHARS_PER_TOKEN);
}
