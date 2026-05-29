import { prisma } from "@clinscriptum/db";
import { requireTenantResource } from "./tenant-guard.js";

/**
 * Расчёт стоимости токенов прогона обработки на основе сохранённой истории
 * LLM-вызовов (LlmResponseLog) и таблицы цен (LlmModelPricing).
 *
 * Стоимость считается НА ЛЕТУ (не хранится) — цены могут меняться, а лог токенов
 * неизменен. Матчинг цены: LlmResponseLog.model содержит modelPattern; при
 * нескольких совпадениях берётся самый длинный (специфичный) pattern.
 */

interface PricingRow {
  modelPattern: string;
  costPerInputKTokens: number;
  costPerOutputKTokens: number;
  currency: string;
}

export interface ResolvedCost {
  inK: number;
  outK: number;
  currency: string;
}

/** Находит цену для модели по самому длинному совпавшему modelPattern. */
export function resolveModelCost(model: string | null, pricing: PricingRow[]): ResolvedCost | null {
  if (!model) return null;
  let best: ResolvedCost | null = null;
  let bestLen = -1;
  for (const p of pricing) {
    if (model.includes(p.modelPattern) && p.modelPattern.length > bestLen) {
      best = { inK: p.costPerInputKTokens, outK: p.costPerOutputKTokens, currency: p.currency };
      bestLen = p.modelPattern.length;
    }
  }
  return best;
}

export interface CostCall {
  id: string;
  label: string | null;
  level: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costInput: number;
  costOutput: number;
  costTotal: number;
  priced: boolean;
}

export interface LevelAggregate {
  promptTokens: number;
  completionTokens: number;
  cost: number;
  calls: number;
}

export const costService = {
  async computeRunCost(tenantId: string, runId: string) {
    const run = await prisma.processingRun.findUnique({
      where: { id: runId },
      include: { study: true },
    });
    requireTenantResource(run, tenantId, (r) => r.study.tenantId);

    const [logs, pricing] = await Promise.all([
      prisma.llmResponseLog.findMany({
        where: { processingRunId: runId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, label: true, level: true, model: true,
          promptTokens: true, completionTokens: true, totalTokens: true,
        },
      }),
      prisma.llmModelPricing.findMany({ where: { isActive: true } }),
    ]);

    const calls: CostCall[] = [];
    const byLevel: Record<string, LevelAggregate> = {};
    const unpriced = new Set<string>();
    let totalIn = 0;
    let totalOut = 0;
    let totalCost = 0;
    let currency = "RUB";

    for (const log of logs) {
      const cost = resolveModelCost(log.model, pricing);
      const priced = cost !== null;
      if (!priced && log.model) unpriced.add(log.model);
      const costInput = cost ? (log.promptTokens / 1000) * cost.inK : 0;
      const costOutput = cost ? (log.completionTokens / 1000) * cost.outK : 0;
      const costTotal = costInput + costOutput;
      if (cost) currency = cost.currency;

      calls.push({
        id: log.id,
        label: log.label,
        level: log.level,
        model: log.model,
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
        totalTokens: log.totalTokens,
        costInput,
        costOutput,
        costTotal,
        priced,
      });

      const lvl = byLevel[log.level] ?? (byLevel[log.level] = { promptTokens: 0, completionTokens: 0, cost: 0, calls: 0 });
      lvl.promptTokens += log.promptTokens;
      lvl.completionTokens += log.completionTokens;
      lvl.cost += costTotal;
      lvl.calls += 1;

      totalIn += log.promptTokens;
      totalOut += log.completionTokens;
      totalCost += costTotal;
    }

    return {
      currency,
      calls,
      byLevel,
      total: { promptTokens: totalIn, completionTokens: totalOut, cost: totalCost, calls: logs.length },
      unpricedModels: [...unpriced],
    };
  },
};
