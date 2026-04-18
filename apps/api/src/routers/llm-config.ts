import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { llmConfigService } from "../services/llm-config.service.js";

const p = qualityProcedure.use(withDomainErrors);

const contextStrategyEnum = z.enum(["chunk", "multi_chunk", "full_document", "multi_document"]);

const llmConfigInputSchema = z.object({
  name: z.string(),
  taskId: z.string(),
  provider: z.string(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  contextStrategy: contextStrategyEnum.optional(),
  chunkSizeChars: z.number().int().positive().optional(),
  chunkOverlapChars: z.number().int().nonnegative().optional(),
  modelWindowChars: z.number().int().positive().optional(),
  rateLimit: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  coldStartMs: z.number().int().nonnegative().optional(),
  costPerInputKTokens: z.number().nonnegative().optional(),
  costPerOutputKTokens: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const llmConfigRouter = router({
  /* ═══════════════ Configs CRUD ═══════════════ */

  listConfigs: p
    .input(z.object({ taskId: z.string().optional() }))
    .query(({ ctx, input }) =>
      llmConfigService.listConfigs(ctx.user.tenantId, input.taskId),
    ),

  getConfig: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) =>
      llmConfigService.getConfig(input.id),
    ),

  getDefaultConfig: p
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) =>
      llmConfigService.getDefaultConfig(input.taskId, ctx.user.tenantId),
    ),

  getEffectiveConfig: p
    .input(z.object({ taskId: z.string() }))
    .query(({ ctx, input }) =>
      llmConfigService.getEffectiveConfig(input.taskId, ctx.user.tenantId),
    ),

  createConfig: p
    .input(llmConfigInputSchema)
    .mutation(({ ctx, input }) =>
      llmConfigService.createConfig({
        tenantId: ctx.user.tenantId,
        ...input,
      }),
    ),

  updateConfig: p
    .input(
      z.object({
        id: z.string().uuid(),
        data: llmConfigInputSchema.partial(),
      }),
    )
    .mutation(({ input }) =>
      llmConfigService.updateConfig(input.id, input.data),
    ),

  deleteConfig: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) =>
      llmConfigService.deleteConfig(input.id),
    ),

  /* ═══════════════ Default & Test ═══════════════ */

  setDefault: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) =>
      llmConfigService.setDefault(input.id),
    ),

  testConnection: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) =>
      llmConfigService.testConnection(input.id),
    ),

  /* ═══════════════ Tasks ═══════════════ */

  listTasks: p
    .query(() =>
      llmConfigService.listTasks(),
    ),
});
