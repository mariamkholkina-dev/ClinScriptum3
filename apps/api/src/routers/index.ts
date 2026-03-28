import { router } from "../trpc/trpc.js";
import { authRouter } from "./auth.js";
import { studyRouter } from "./study.js";
import { documentRouter } from "./document.js";
import { processingRouter } from "./processing.js";
import { comparisonRouter } from "./comparison.js";

export const appRouter = router({
  auth: authRouter,
  study: studyRouter,
  document: documentRouter,
  processing: processingRouter,
  comparison: comparisonRouter,
});

export type AppRouter = typeof appRouter;
