import { router } from "../trpc/trpc.js";
import { authRouter } from "./auth.js";
import { studyRouter } from "./study.js";
import { documentRouter } from "./document.js";
import { processingRouter } from "./processing.js";

export const appRouter = router({
  auth: authRouter,
  study: studyRouter,
  document: documentRouter,
  processing: processingRouter,
});

export type AppRouter = typeof appRouter;
