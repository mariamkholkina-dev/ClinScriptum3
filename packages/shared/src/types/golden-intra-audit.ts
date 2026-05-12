/**
 * Структура GoldenSampleStageStatus.expectedResults для stage='intra_audit'.
 *
 * Два параллельных уровня разметки:
 *   - findings[]  — пер-detection: каждое отдельное место в тексте, которое
 *                   эксперт ожидает увидеть в виде Finding. Используется
 *                   cascade-матчингом (strict + lenient) и LLM-as-judge.
 *   - problems[]  — пер-проблема: уникальные смысловые проблемы документа
 *                   (один и тот же defect может проявляться в N местах,
 *                   но как problem он один). Используется document-level
 *                   coverage-матчингом.
 *
 * mustDetect=false разрешает модели его не находить (контрольный пример).
 */
export interface GoldenIntraAuditExpected {
  findings: ExpectedFinding[];
  problems: ExpectedProblem[];
  /** complete — эталон покрывает весь документ; partial_by_family — размечены
   *  только семейства из mustDetectFamilies, остальное в метрике игнорируется. */
  coverage: "complete" | "partial_by_family";
  /** При coverage='partial_by_family' — только эти семейства засчитываются.
   *  Predicted finding в семействе НЕ из списка не считается FP. */
  mustDetectFamilies?: string[];
}

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

/** Минимальная проекция Finding из БД, нужная матчингу. */
export interface PredictedFinding {
  id: string;
  issueFamily: string | null;
  issueType: string | null;
  severity: ExpectedSeverity | null;
  anchorZone: string | null;
  targetZone: string | null;
  anchorQuote: string | null;
  targetQuote: string | null;
  description: string;
  /** Из extraAttributes.method — "deterministic" | "llm" */
  method: "deterministic" | "llm" | null;
}
