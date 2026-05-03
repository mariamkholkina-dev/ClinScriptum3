import { LLMGateway } from "@clinscriptum/llm-gateway";
import { prisma } from "@clinscriptum/db";
import { logger } from "./logger.js";

/**
 * Sprint 4: LLM-based verification of detected SoA tables.
 *
 * After the deterministic detector finds a candidate SoA table, this
 * runs an LLM Check that asks the model whether the table is in fact a
 * Schedule of Assessments and how confident it is. The result updates
 * `SoaTable.verificationLevel` and `SoaTable.llmConfidence`.
 *
 * Disabled by default — controlled by env `LLM_SOA_VERIFY_ENABLED=true`.
 * The deterministic-only flow (Sprints 1-3) keeps working unchanged
 * when this is off.
 */

interface SoaVerifyResult {
  isSoa: boolean;
  confidence: number;
  reasoning?: string;
}

const SYSTEM_PROMPT = `You verify Schedule of Assessments (SoA) tables in clinical trial protocols. \
A SoA table lists procedures (rows) against visits/timepoints (columns) with X-marks indicating which procedure happens at which visit. \
Given a candidate table, decide whether it is truly a SoA. Reply ONLY with JSON: {"is_soa": boolean, "confidence": 0..1, "reasoning": "<one short sentence>"}.`;

function buildUserMessage(args: {
  title: string;
  visits: string[];
  procedures: string[];
  sampleRows: string[][];
  soaScore: number;
}): string {
  const visitsLine = args.visits.slice(0, 12).join(" | ");
  const proceduresLine = args.procedures.slice(0, 15).join(", ");
  const sampleText = args.sampleRows
    .slice(0, 6)
    .map((r) => r.slice(0, 12).join(" | "))
    .join("\n");

  return `Title: ${args.title}
Deterministic SoA score: ${args.soaScore.toFixed(1)}
Visits (${args.visits.length}): ${visitsLine}
Procedures (${args.procedures.length}): ${proceduresLine}

Matrix sample (first rows × first columns):
${sampleText}

Is this a SoA?`;
}

function parseLlmResponse(content: string): SoaVerifyResult | null {
  // Tolerate code-fenced JSON.
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const isSoa = typeof obj.is_soa === "boolean" ? obj.is_soa : null;
    const conf =
      typeof obj.confidence === "number"
        ? Math.max(0, Math.min(1, obj.confidence))
        : null;
    if (isSoa == null || conf == null) return null;
    const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : undefined;
    return { isSoa, confidence: conf, reasoning };
  } catch {
    return null;
  }
}

function getGatewayFromEnv(): LLMGateway | null {
  const provider = process.env.LLM_SOA_VERIFY_PROVIDER ?? process.env.LLM_PROVIDER;
  const model = process.env.LLM_SOA_VERIFY_MODEL ?? process.env.LLM_MODEL;
  const apiKey = process.env.LLM_SOA_VERIFY_API_KEY ?? process.env.LLM_API_KEY;
  const temperature = parseFloat(
    process.env.LLM_SOA_VERIFY_TEMPERATURE ?? "0",
  );
  if (!provider || !model || !apiKey) return null;
  return new LLMGateway({
    provider: provider as never,
    model,
    apiKey,
    temperature: Number.isFinite(temperature) ? temperature : 0,
    timeoutMs: 30_000,
  });
}

export async function verifySoaTablesForVersion(versionId: string): Promise<void> {
  if (process.env.LLM_SOA_VERIFY_ENABLED !== "true") {
    logger.info("[soa-llm] Skipping — LLM_SOA_VERIFY_ENABLED is not 'true'", {
      versionId,
    });
    return;
  }

  const gateway = getGatewayFromEnv();
  if (!gateway) {
    logger.error("[soa-llm] Skipping — gateway env vars missing", { versionId });
    return;
  }

  const tables = await prisma.soaTable.findMany({
    where: { docVersionId: versionId },
    include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } },
  });

  for (const table of tables) {
    try {
      const headerData = table.headerData as { visits?: string[] } | null;
      const visits = headerData?.visits ?? [];
      const procedures = Array.from(
        new Set(table.cells.map((c) => c.procedureName)),
      );

      const rowSamples = new Map<number, string[]>();
      for (const c of table.cells) {
        const arr = rowSamples.get(c.rowIndex) ?? [];
        arr[c.colIndex] = c.normalizedValue || c.rawValue || "";
        rowSamples.set(c.rowIndex, arr);
      }
      const sampleRows = [...rowSamples.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, row]) => row.map((v) => v ?? ""));

      const userMessage = buildUserMessage({
        title: table.title,
        visits,
        procedures,
        sampleRows,
        soaScore: table.soaScore,
      });

      const start = Date.now();
      const response = await gateway.generate({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        responseFormat: "json",
        maxTokens: 200,
      });
      const durationMs = Date.now() - start;

      const parsed = parseLlmResponse(response.content);
      if (!parsed) {
        logger.error("[soa-llm] Could not parse LLM response", {
          tableId: table.id,
          contentSnippet: response.content.slice(0, 200),
        });
        continue;
      }

      // Disagreement triggers QA: deterministic kept it (it's in the DB),
      // LLM says it's not a SoA. Mark as llm_qa with the LLM confidence
      // so the operator knows to review.
      const deterministicSaysSoa = true; // detector wouldn't have inserted otherwise
      const disagreement = !parsed.isSoa;
      const verificationLevel = disagreement ? "llm_qa" : "llm_check";

      await prisma.soaTable.update({
        where: { id: table.id },
        data: {
          verificationLevel,
          llmConfidence: parsed.confidence,
        },
      });

      logger.info("[soa-llm] Verified", {
        tableId: table.id,
        verificationLevel,
        llmConfidence: parsed.confidence,
        deterministicSaysSoa,
        durationMs,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        reasoning: parsed.reasoning,
      });
    } catch (err) {
      logger.error("[soa-llm] LLM verification failed", {
        tableId: table.id,
        error: String(err),
      });
      // Keep deterministic result, do not raise — verification is
      // advisory and shouldn't block the pipeline.
    }
  }
}

// Exposed for unit tests.
export const __test__ = { parseLlmResponse, buildUserMessage };
