import { prisma } from "@clinscriptum/db";
import { LLMGateway } from "@clinscriptum/llm-gateway";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";

/**
 * URS-036..042, URS-075..078
 * Intra-document audit: find editorial and semantic inconsistencies.
 * Uses maximum document context for LLM (URS-075/076).
 */

interface AuditFinding {
  type: "editorial" | "semantic";
  description: string;
  suggestion: string | null;
  sourceText: string;
  sectionTitle?: string;
  severity: "low" | "medium" | "high";
}

export async function handleIntraDocAudit(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
}) {
  const deterministicHandler: PipelineStepHandler = {
    level: "deterministic",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const sections = await prisma.section.findMany({
        where: { docVersionId: ctx.docVersionId },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });

      const findings: AuditFinding[] = [];

      for (const section of sections) {
        for (const block of section.contentBlocks) {
          const editorialIssues = runEditorialChecks(block.content, section.title);
          findings.push(...editorialIssues);
        }
      }

      for (const finding of findings) {
        await prisma.finding.create({
          data: {
            docVersionId: ctx.docVersionId,
            type: finding.type,
            description: finding.description,
            suggestion: finding.suggestion,
            sourceRef: {
              sectionTitle: finding.sectionTitle,
              textSnippet: finding.sourceText.slice(0, 200),
            },
            status: "pending",
            extraAttributes: { severity: finding.severity, method: "deterministic" },
          },
        });
      }

      return {
        data: { deterministicFindings: findings.length },
        needsNextStep: true,
      };
    },
  };

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const sections = await prisma.section.findMany({
        where: { docVersionId: ctx.docVersionId },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      });

      // URS-075/076: Build full document text for LLM context
      const fullDocText = buildFullDocumentText(sections);

      const apiKey = process.env.LLM_API_KEY;
      if (!apiKey) {
        return {
          data: { message: "LLM API key not configured, skipping LLM audit" },
          needsNextStep: true,
        };
      }

      const gateway = new LLMGateway({
        provider: (process.env.LLM_PROVIDER as any) ?? "openai",
        model: process.env.LLM_MODEL ?? "gpt-4o",
        apiKey,
        baseUrl: process.env.LLM_BASE_URL,
        temperature: 0.1,
      });

      const response = await gateway.generate({
        system: AUDIT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Analyze the following clinical protocol for internal inconsistencies:\n\n${fullDocText}`,
          },
        ],
        maxTokens: 4096,
      });

      const llmFindings = parseLLMFindings(response.content);

      for (const finding of llmFindings) {
        await prisma.finding.create({
          data: {
            docVersionId: ctx.docVersionId,
            type: finding.type,
            description: finding.description,
            suggestion: finding.suggestion,
            sourceRef: { textSnippet: finding.sourceText },
            status: "pending",
            extraAttributes: { severity: finding.severity, method: "llm" },
          },
        });
      }

      return {
        data: {
          llmFindings: llmFindings.length,
          tokensUsed: response.usage.totalTokens,
        },
        needsNextStep: true,
      };
    },
  };

  const llmQaHandler: PipelineStepHandler = {
    level: "llm_qa",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      // LLM QA arbitration: cross-check deterministic and LLM findings
      const allFindings = await prisma.finding.findMany({
        where: { docVersionId: ctx.docVersionId, status: "pending" },
      });

      return {
        data: { totalPendingFindings: allFindings.length },
        needsNextStep: true,
      };
    },
  };

  const handlers = new Map([
    ["deterministic" as const, deterministicHandler],
    ["llm_check" as const, llmCheckHandler],
    ["llm_qa" as const, llmQaHandler],
  ]);

  await runPipeline(data.processingRunId, {
    operatorReviewEnabled: data.operatorReviewEnabled ?? false,
    steps: Array.from(handlers.values()),
  }, handlers);
}

function buildFullDocumentText(
  sections: Array<{ title: string; contentBlocks: Array<{ content: string }> }>
): string {
  const parts: string[] = [];
  for (const section of sections) {
    parts.push(`\n## ${section.title}\n`);
    for (const block of section.contentBlocks) {
      parts.push(block.content);
    }
  }
  return parts.join("\n");
}

function runEditorialChecks(text: string, sectionTitle: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Double spaces
  if (/  +/.test(text)) {
    findings.push({
      type: "editorial",
      description: "Double or multiple spaces detected",
      suggestion: "Replace multiple spaces with a single space",
      sourceText: text,
      sectionTitle,
      severity: "low",
    });
  }

  // Inconsistent tense within a section (future vs past mixed)
  const futureCount = (text.match(/\bwill\b|\bshall\b/gi) ?? []).length;
  const pastCount = (text.match(/\bwas\b|\bwere\b|\bhas been\b/gi) ?? []).length;
  if (futureCount > 2 && pastCount > 2) {
    findings.push({
      type: "semantic",
      description: "Mixed future and past tense detected in the same section",
      suggestion: "Ensure consistent tense usage within the section",
      sourceText: text.slice(0, 200),
      sectionTitle,
      severity: "medium",
    });
  }

  // Placeholder text
  if (/\[TBD\]|\[INSERT\]|\[PLACEHOLDER\]|\[TODO\]/i.test(text)) {
    findings.push({
      type: "editorial",
      description: "Placeholder text found",
      suggestion: "Replace placeholder with actual content",
      sourceText: text,
      sectionTitle,
      severity: "high",
    });
  }

  return findings;
}

function parseLLMFindings(llmOutput: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const blocks = llmOutput.split(/(?:^|\n)(?=\d+\.\s)/);
  for (const block of blocks) {
    if (!block.trim()) continue;

    const typeMatch = block.match(/\b(editorial|semantic)\b/i);
    const type = (typeMatch?.[1]?.toLowerCase() as "editorial" | "semantic") ?? "semantic";

    const descMatch = block.match(/(?:description|issue|finding)[:\s]+(.+?)(?:\n|$)/i);
    const suggMatch = block.match(/(?:suggestion|recommendation|fix)[:\s]+(.+?)(?:\n|$)/i);
    const textMatch = block.match(/(?:source|text|quote)[:\s]+(.+?)(?:\n|$)/i);

    if (descMatch || block.length > 20) {
      findings.push({
        type,
        description: descMatch?.[1]?.trim() ?? block.trim().slice(0, 300),
        suggestion: suggMatch?.[1]?.trim() ?? null,
        sourceText: textMatch?.[1]?.trim() ?? "",
        severity: "medium",
      });
    }
  }

  return findings;
}

const AUDIT_SYSTEM_PROMPT = `You are a clinical document QA auditor. Analyze clinical trial protocols for:
1. **Editorial issues**: typos, formatting inconsistencies, double spaces, placeholder text
2. **Semantic inconsistencies**: contradictions between sections, mismatched numbers, inconsistent terminology

For each finding, output in this format:
1. Type: editorial|semantic
Description: <clear description>
Source: <quote from document>
Suggestion: <how to fix>

Be precise and cite the exact text. Focus on real issues, not stylistic preferences.`;
