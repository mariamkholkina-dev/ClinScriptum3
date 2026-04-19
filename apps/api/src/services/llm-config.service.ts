import { prisma, getEffectiveLlmConfig as resolveConfig } from "@clinscriptum/db";
import type { ContextStrategy, LlmTaskConfig } from "@clinscriptum/db";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import type { LLMProvider } from "@clinscriptum/llm-gateway";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

/* ═══════════════ Types ═══════════════ */

export interface CreateLlmConfigInput {
  tenantId?: string;
  name: string;
  taskId: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  contextStrategy?: ContextStrategy;
  chunkSizeChars?: number;
  chunkOverlapChars?: number;
  modelWindowChars?: number;
  rateLimit?: number;
  timeoutMs?: number;
  coldStartMs?: number;
  costPerInputKTokens?: number;
  costPerOutputKTokens?: number;
  isActive?: boolean;
  isDefault?: boolean;
}

export type { LlmTaskConfig } from "@clinscriptum/db";

/* ═══════════════ Task definitions ═══════════════ */

const LLM_TASKS: Array<{ id: string; description: string }> = [
  { id: "section_classify", description: "Section classification via LLM" },
  { id: "section_classify_qa", description: "QA arbitration for section classification" },
  { id: "fact_extraction", description: "Fact extraction from document sections" },
  { id: "fact_extraction_qa", description: "QA arbitration for fact extraction" },
  { id: "soa_detection", description: "Schedule of Assessments table detection" },
  { id: "soa_detection_qa", description: "QA arbitration for SOA detection" },
  { id: "intra_audit", description: "Intra-document consistency audit" },
  { id: "intra_audit_qa", description: "QA arbitration for intra-document audit" },
  { id: "inter_audit", description: "Inter-document cross-reference audit" },
  { id: "inter_audit_qa", description: "QA arbitration for inter-document audit" },
  { id: "fact_audit_intra", description: "Intra-document fact-level audit" },
  { id: "fact_audit_intra_qa", description: "QA arbitration for intra-document fact audit" },
  { id: "fact_audit_inter", description: "Inter-document fact-level audit" },
  { id: "fact_audit_inter_qa", description: "QA arbitration for inter-document fact audit" },
  { id: "generation", description: "Document generation (ICF/CSR)" },
  { id: "generation_qa", description: "QA review of generated documents" },
  { id: "impact_analysis", description: "Cross-document impact analysis" },
  { id: "impact_analysis_qa", description: "QA arbitration for impact analysis" },
  { id: "comparison", description: "Document version comparison" },
  { id: "summarization", description: "Document summarization" },
  { id: "translation", description: "Document translation" },
];

/* ═══════════════ Service ═══════════════ */

class LlmConfigService {
  async listConfigs(tenantId?: string, taskId?: string) {
    const where: { tenantId?: string | null; taskId?: string } = {};
    if (tenantId !== undefined) {
      where.tenantId = tenantId;
    }
    if (taskId) {
      where.taskId = taskId;
    }

    return prisma.llmConfig.findMany({
      where,
      orderBy: [{ taskId: "asc" }, { isDefault: "desc" }, { createdAt: "desc" }],
    });
  }

  async getConfig(id: string) {
    const config = await prisma.llmConfig.findUnique({ where: { id } });
    if (!config) {
      throw new DomainError("NOT_FOUND", "LLM config not found");
    }
    return config;
  }

  async getDefaultConfig(taskId: string, tenantId?: string) {
    // Try tenant-specific default first
    if (tenantId) {
      const tenantConfig = await prisma.llmConfig.findFirst({
        where: { taskId, tenantId, isDefault: true, isActive: true },
      });
      if (tenantConfig) return tenantConfig;
    }

    // Fallback to global default (tenantId = null)
    const globalConfig = await prisma.llmConfig.findFirst({
      where: { taskId, tenantId: null, isDefault: true, isActive: true },
    });

    if (!globalConfig) {
      throw new DomainError("NOT_FOUND", `No default LLM config found for task "${taskId}"`);
    }

    return globalConfig;
  }

  async getEffectiveConfig(taskId: string, tenantId?: string): Promise<LlmTaskConfig> {
    return resolveConfig(taskId, tenantId);
  }

  async createConfig(data: CreateLlmConfigInput) {
    const config = await prisma.llmConfig.create({
      data: {
        tenantId: data.tenantId ?? null,
        name: data.name,
        taskId: data.taskId,
        provider: data.provider,
        baseUrl: data.baseUrl ?? "",
        apiKey: data.apiKey ?? "",
        model: data.model,
        temperature: data.temperature ?? 0.1,
        maxOutputTokens: data.maxOutputTokens ?? 2048,
        maxInputTokens: data.maxInputTokens ?? null,
        contextStrategy: data.contextStrategy ?? "chunk",
        chunkSizeChars: data.chunkSizeChars ?? null,
        chunkOverlapChars: data.chunkOverlapChars ?? null,
        modelWindowChars: data.modelWindowChars ?? null,
        rateLimit: data.rateLimit ?? null,
        timeoutMs: data.timeoutMs ?? null,
        coldStartMs: data.coldStartMs ?? null,
        costPerInputKTokens: data.costPerInputKTokens ?? null,
        costPerOutputKTokens: data.costPerOutputKTokens ?? null,
        isActive: data.isActive ?? true,
        isDefault: data.isDefault ?? false,
      },
    });

    logger.info("LLM config created", { configId: config.id, taskId: data.taskId });
    return config;
  }

  async updateConfig(id: string, data: Partial<CreateLlmConfigInput>) {
    const existing = await prisma.llmConfig.findUnique({ where: { id } });
    if (!existing) {
      throw new DomainError("NOT_FOUND", "LLM config not found");
    }

    return prisma.llmConfig.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.taskId !== undefined && { taskId: data.taskId }),
        ...(data.provider !== undefined && { provider: data.provider }),
        ...(data.baseUrl !== undefined && { baseUrl: data.baseUrl }),
        ...(data.apiKey !== undefined && { apiKey: data.apiKey }),
        ...(data.model !== undefined && { model: data.model }),
        ...(data.temperature !== undefined && { temperature: data.temperature }),
        ...(data.maxOutputTokens !== undefined && { maxOutputTokens: data.maxOutputTokens }),
        ...(data.maxInputTokens !== undefined && { maxInputTokens: data.maxInputTokens }),
        ...(data.contextStrategy !== undefined && { contextStrategy: data.contextStrategy }),
        ...(data.chunkSizeChars !== undefined && { chunkSizeChars: data.chunkSizeChars }),
        ...(data.chunkOverlapChars !== undefined && { chunkOverlapChars: data.chunkOverlapChars }),
        ...(data.modelWindowChars !== undefined && { modelWindowChars: data.modelWindowChars }),
        ...(data.rateLimit !== undefined && { rateLimit: data.rateLimit }),
        ...(data.timeoutMs !== undefined && { timeoutMs: data.timeoutMs }),
        ...(data.coldStartMs !== undefined && { coldStartMs: data.coldStartMs }),
        ...(data.costPerInputKTokens !== undefined && { costPerInputKTokens: data.costPerInputKTokens }),
        ...(data.costPerOutputKTokens !== undefined && { costPerOutputKTokens: data.costPerOutputKTokens }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
      },
    });
  }

  async deleteConfig(id: string) {
    const config = await prisma.llmConfig.findUnique({ where: { id } });
    if (!config) {
      throw new DomainError("NOT_FOUND", "LLM config not found");
    }

    await prisma.llmConfig.delete({ where: { id } });
    logger.info("LLM config deleted", { configId: id, taskId: config.taskId });
  }

  async setDefault(id: string) {
    const config = await prisma.llmConfig.findUnique({ where: { id } });
    if (!config) {
      throw new DomainError("NOT_FOUND", "LLM config not found");
    }

    // Unset other defaults for same task and same tenant scope
    await prisma.$transaction([
      prisma.llmConfig.updateMany({
        where: {
          taskId: config.taskId,
          tenantId: config.tenantId,
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      }),
      prisma.llmConfig.update({
        where: { id },
        data: { isDefault: true, isActive: true },
      }),
    ]);

    logger.info("LLM config set as default", { configId: id, taskId: config.taskId });

    return prisma.llmConfig.findUnique({ where: { id } });
  }

  async testConnection(id: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const config = await prisma.llmConfig.findUnique({ where: { id } });
    if (!config) {
      throw new DomainError("NOT_FOUND", "LLM config not found");
    }

    const prefix = `LLM_${config.taskId.toUpperCase()}_`;
    const effectiveApiKey = config.apiKey
      || process.env[`${prefix}API_KEY`]
      || process.env.LLM_API_KEY
      || "";
    const effectiveBaseUrl = config.baseUrl
      || process.env[`${prefix}BASE_URL`]
      || process.env.LLM_BASE_URL
      || undefined;

    if (!effectiveApiKey) {
      return { success: false, latencyMs: 0, error: "API key not configured (neither in DB nor in environment)" };
    }

    const gateway = new LLMGateway({
      provider: config.provider as LLMProvider,
      model: config.model,
      apiKey: effectiveApiKey,
      baseUrl: effectiveBaseUrl,
      maxTokens: 50,
      temperature: 0,
    });

    const start = Date.now();

    try {
      await gateway.generate({
        messages: [{ role: "user", content: "Reply with the word OK." }],
        maxTokens: 10,
        temperature: 0,
      });

      const latencyMs = Date.now() - start;
      logger.info("LLM connection test succeeded", { configId: id, latencyMs });
      return { success: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn("LLM connection test failed", { configId: id, latencyMs, error: errorMessage });
      return { success: false, latencyMs, error: errorMessage };
    }
  }

  listTasks() {
    return LLM_TASKS;
  }
}

export const llmConfigService = new LlmConfigService();
