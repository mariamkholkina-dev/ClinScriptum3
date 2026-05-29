/**
 * Фабрика onResponse-хука для LLMGateway: пишет каждый вызов LLM
 * (промт → ответ) в LlmResponseLog. Хук передаётся в конфиг gateway;
 * gateway сам ловит ошибки хука, чтобы логирование не ломало генерацию.
 *
 * История доступна в разделе «Аудит обработок» (просмотр + скачивание .zip).
 */

import { prisma } from "@clinscriptum/db";
import type { PipelineLevel } from "@prisma/client";
import type { LlmCallRecord } from "@clinscriptum/llm-gateway";
import { logger } from "./logger.js";

export function makeLlmResponseLogger(
  processingRunId: string,
  docVersionId: string,
  level: PipelineLevel,
): (entry: LlmCallRecord) => Promise<void> {
  return async (entry: LlmCallRecord) => {
    try {
      await prisma.llmResponseLog.create({
        data: {
          processingRunId,
          docVersionId,
          level,
          label: entry.label ?? null,
          systemPrompt: entry.system ?? null,
          userPrompt: entry.messages.map((m) => m.content).join("\n\n"),
          responseContent: entry.content,
          promptTokens: entry.usage.promptTokens,
          completionTokens: entry.usage.completionTokens,
          totalTokens: entry.usage.totalTokens,
          provider: entry.provider,
          model: entry.model,
        },
      });
    } catch (err) {
      // Дублируем глушение из gateway: история не критична для пайплайна.
      logger.warn("[llm-response-logger] failed to persist LLM response", {
        processingRunId,
        pipelineLevel: level,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
