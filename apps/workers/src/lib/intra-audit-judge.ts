import { LLMGateway, type LLMConfig, type LLMProvider } from "@clinscriptum/llm-gateway";
import type { ExpectedFinding, PredictedFinding } from "@clinscriptum/shared";
import { findJsonSpan } from "@clinscriptum/shared";
import { logger } from "./logger.js";
import type { LLMJudge } from "./intra-audit-match.js";

/**
 * LLM-as-judge для пар (predicted, expected) — определяет, описывают ли они
 * одну и ту же проблему документа. Вызывается из run-evaluation handler.
 *
 * Конфиг берётся из переменных окружения LLM_AUDIT_JUDGE_*; если ключа нет,
 * фабрика возвращает null, и primary-метрика fallback'нется на cascade.lenient.
 */

const SYSTEM_PROMPT = `Ты — судья качества автоматического аудита клинических протоколов.
Тебе дают два описания проблемы в одном документе:
  PREDICTED — то, что нашла модель.
  EXPECTED  — эталонная разметка эксперта.

Задача: определить, описывают ли они ОДНУ И ТУ ЖЕ проблему документа.

Правила:
- Если они про один и тот же defect в одной и той же области текста — verdict="yes".
- Если про разные проблемы или разные места — verdict="no".
- Если описание двусмысленное и невозможно решить уверенно — verdict="uncertain".
- НЕ требуй точного совпадения формулировки или тега issueType.
- НЕ требуй совпадения цитаты слово-в-слово, главное — про что defect.

Ответ строго JSON: { "verdict": "yes"|"no"|"uncertain", "rationale": "1-2 предложения" }.`;

function formatFinding(label: string, f: PredictedFinding | ExpectedFinding): string {
  const isExp = "mustDetect" in f;
  const quote = f.anchorQuote ?? "(нет цитаты)";
  const zone = f.anchorZone ?? "(нет зоны)";
  const family = f.issueFamily ?? "(нет family)";
  const type = f.issueType ?? "(нет type)";
  const target = f.targetZone ? ` → ${f.targetZone}` : "";
  return `${label} [${family} / ${type} / ${zone}${target}]${isExp ? "" : ""}
  цитата: «${quote}»
  описание: ${f.description}`;
}

export function makeIntraAuditJudge(config: LLMConfig): LLMJudge {
  const gateway = new LLMGateway(config);

  return async (predicted, expected) => {
    const userPrompt = `${formatFinding("PREDICTED", predicted)}\n\n${formatFinding("EXPECTED", expected)}`;

    try {
      const response = await gateway.generate({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        responseFormat: "json",
        maxTokens: 200,
        temperature: 0,
      });

      const span = findJsonSpan(response.content);
      let parsed: { verdict?: unknown; rationale?: unknown } | null = null;
      if (span) {
        try {
          parsed = JSON.parse(span) as { verdict?: unknown; rationale?: unknown };
        } catch {
          parsed = null;
        }
      }
      const raw = typeof parsed?.verdict === "string" ? parsed.verdict.toLowerCase().trim() : "";
      const verdict: "yes" | "no" | "uncertain" =
        raw === "yes" ? "yes" : raw === "no" ? "no" : "uncertain";
      const rationale = typeof parsed?.rationale === "string" ? parsed.rationale : undefined;
      return { verdict, rationale };
    } catch (err) {
      logger.warn("intra-audit judge call failed; counting as uncertain", {
        error: (err as Error).message,
        predictedId: predicted.id,
        expectedId: expected.id,
      });
      return { verdict: "uncertain", rationale: "judge error" };
    }
  };
}

/** Собирает LLMConfig из env. Возвращает null, если не задан API key —
 *  тогда LLM-judge не используется и primary-метрика = cascade.lenient. */
export function resolveJudgeConfigFromEnv(): LLMConfig | null {
  const apiKey = process.env.LLM_AUDIT_JUDGE_API_KEY ?? process.env.LLM_API_KEY;
  if (!apiKey) return null;

  const providerEnv = (process.env.LLM_AUDIT_JUDGE_PROVIDER ?? process.env.LLM_PROVIDER) as
    | LLMProvider
    | undefined;
  const provider: LLMProvider = providerEnv ?? "openai";

  const model = process.env.LLM_AUDIT_JUDGE_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  const baseUrl = process.env.LLM_AUDIT_JUDGE_BASE_URL ?? process.env.LLM_BASE_URL;
  const temperature = Number(process.env.LLM_AUDIT_JUDGE_TEMPERATURE ?? "0");

  return {
    provider,
    model,
    apiKey,
    baseUrl,
    temperature: isFinite(temperature) ? temperature : 0,
    maxTokens: 200,
  };
}
