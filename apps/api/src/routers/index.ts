import { router } from "../trpc/trpc.js";
import { authRouter } from "./auth.js";
import { studyRouter } from "./study.js";
import { documentRouter } from "./document.js";
import { processingRouter } from "./processing.js";
import { comparisonRouter } from "./comparison.js";
import { generationRouter } from "./generation.js";
import { auditRouter } from "./audit.js";
import { wordAddinRouter } from "./word-addin.js";
import { tuningRouter } from "./tuning.js";
import { findingReviewRouter } from "./finding-review.js";

export const appRouter = router({
  auth: authRouter,
  study: studyRouter,
  document: documentRouter,
  processing: processingRouter,
  comparison: comparisonRouter,
  generation: generationRouter,
  audit: auditRouter,
  wordAddin: wordAddinRouter,
  tuning: tuningRouter,
  findingReview: findingReviewRouter,
});

export type AppRouter = typeof appRouter;
