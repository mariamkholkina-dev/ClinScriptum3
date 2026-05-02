import { router } from "../trpc/trpc.js";
import { authRouter } from "./auth.js";
import { studyRouter } from "./study.js";
import { documentRouter } from "./document.js";
import { processingRouter } from "./processing.js";
import { soaFootnoteRouter } from "./soa-footnote.js";
import { comparisonRouter } from "./comparison.js";
import { generationRouter } from "./generation.js";
import { auditRouter } from "./audit.js";
import { wordAddinRouter } from "./word-addin.js";
import { tuningRouter } from "./tuning.js";
import { findingReviewRouter } from "./finding-review.js";
import { ruleManagementRouter } from "./rule-management.js";
import { llmConfigRouter } from "./llm-config.js";
import { goldenDatasetRouter } from "./golden-dataset.js";
import { evaluationRouter } from "./evaluation.js";
import { qualityRouter } from "./quality.js";
import { bundleRouter } from "./bundle.js";

export const appRouter = router({
  auth: authRouter,
  study: studyRouter,
  document: documentRouter,
  processing: processingRouter,
  soaFootnote: soaFootnoteRouter,
  comparison: comparisonRouter,
  generation: generationRouter,
  audit: auditRouter,
  wordAddin: wordAddinRouter,
  tuning: tuningRouter,
  findingReview: findingReviewRouter,
  ruleManagement: ruleManagementRouter,
  llmConfig: llmConfigRouter,
  goldenDataset: goldenDatasetRouter,
  evaluation: evaluationRouter,
  quality: qualityRouter,
  bundle: bundleRouter,
});

export type AppRouter = typeof appRouter;
