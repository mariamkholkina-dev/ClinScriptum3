/**
 * Локальная копия типов из `@clinscriptum/shared` для intra-audit golden expected.
 * Держим inline, чтобы rule-admin не зависел от shared (Next.js bundle).
 * При расхождении со shared — см. `packages/shared/src/types/golden-intra-audit.ts`.
 */

export type ExpectedSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ExpectedFinding {
  id: string;
  issueFamily: string;
  issueType: string;
  severity: ExpectedSeverity;
  anchorZone: string;
  targetZone?: string;
  anchorQuote: string;
  targetQuote?: string;
  description: string;
  mustDetect: boolean;
  notes?: string;
}

export interface ExpectedProblem {
  id: string;
  problemDescription: string;
  issueFamily: string;
  anchorZone: string;
  exampleQuote?: string;
  mustDetect: boolean;
}

export interface GoldenIntraAuditExpected {
  findings: ExpectedFinding[];
  problems: ExpectedProblem[];
  coverage: "complete" | "partial_by_family";
  mustDetectFamilies?: string[];
  /** Промежуточное состояние аннотации до approve. */
  draft?: IntraAuditDraft;
}

export type AnnotationDecision = "unreviewed" | "accepted" | "rejected";

export interface AnnotationOverrides {
  issueFamily?: string;
  issueType?: string;
  severity?: ExpectedSeverity;
  anchorZone?: string;
  description?: string;
  notes?: string;
}

export interface IntraAuditDraft {
  /** key = candidate Finding.id; value — решение эксперта + любые правки полей. */
  annotations: Record<string, { decision: AnnotationDecision; overrides?: AnnotationOverrides }>;
  /** Вручную добавленные finding'и, отсутствовавшие у модели (будущие FN). */
  manualFindings?: ExpectedFinding[];
}

/** Сырой Finding из `trpc.processing.listFindings`. Поля приведены к unknown,
 *  потому что роутер возвращает Prisma row с JsonValue полями. */
export interface CandidateFindingRaw {
  id: string;
  type?: string;
  description: string;
  suggestion?: string | null;
  severity?: ExpectedSeverity | null;
  issueFamily?: string | null;
  issueType?: string | null;
  anchorZone?: string | null;
  targetZone?: string | null;
  auditCategory?: string | null;
  status?: string;
  sourceRef?: unknown;
  extraAttributes?: unknown;
}
