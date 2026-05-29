/**
 * Seed цен LLM-моделей (LlmModelPricing) для расчёта стоимости токенов
 * в разделе «Аудит обработок».
 *
 * Цены — из документации Yandex AI Studio (синхронный режим, ₽ за 1000 токенов,
 * с НДС). Источник: https://aistudio.yandex.ru/docs/ru/ai-studio/pricing
 *
 * Идемпотентно: upsert по modelPattern (обновляет цены, если pattern уже есть).
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/seed-llm-pricing.ts
 * На проде (scripts/ монтируется томом):
 *   docker compose run --rm -v "$(pwd)/scripts:/app/scripts" workers \
 *     npx tsx scripts/seed-llm-pricing.ts
 */

import { prisma } from "@clinscriptum/db";

interface PricingSpec {
  modelPattern: string;
  provider: string;
  costPerInputKTokens: number;
  costPerOutputKTokens: number;
  note: string;
}

// ₽ за 1000 токенов. modelPattern — подстрока для матчинга LlmResponseLog.model
// (напр. "qwen3-235b" матчит "gpt://<folder>/qwen3-235b-a22b-fp8/latest").
const PRICING: PricingSpec[] = [
  {
    modelPattern: "qwen3-235b",
    provider: "yandexgpt",
    costPerInputKTokens: 0.5,
    costPerOutputKTokens: 0.5,
    note: "Yandex AI Studio — Qwen3-235B (синхронный режим)",
  },
  {
    modelPattern: "deepseek-v32",
    provider: "yandexgpt",
    costPerInputKTokens: 0.5,
    costPerOutputKTokens: 0.8,
    note: "Yandex AI Studio — DeepSeek V3.2 (синхронный режим)",
  },
  {
    modelPattern: "deepseek-v4-flash",
    provider: "yandexgpt",
    costPerInputKTokens: 0.3,
    costPerOutputKTokens: 0.5,
    note: "Yandex AI Studio — DeepSeek V4 Flash (синхронный режим)",
  },
];

async function main() {
  console.log("=== Seeding LLM model pricing ===");
  for (const spec of PRICING) {
    const existing = await prisma.llmModelPricing.findFirst({
      where: { modelPattern: spec.modelPattern },
    });
    if (existing) {
      await prisma.llmModelPricing.update({
        where: { id: existing.id },
        data: {
          provider: spec.provider,
          costPerInputKTokens: spec.costPerInputKTokens,
          costPerOutputKTokens: spec.costPerOutputKTokens,
          note: spec.note,
          isActive: true,
        },
      });
      console.log(`  updated ${spec.modelPattern} (in=${spec.costPerInputKTokens} out=${spec.costPerOutputKTokens} ₽/1k)`);
    } else {
      await prisma.llmModelPricing.create({ data: spec });
      console.log(`  created ${spec.modelPattern} (in=${spec.costPerInputKTokens} out=${spec.costPerOutputKTokens} ₽/1k)`);
    }
  }
  console.log("Done.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
