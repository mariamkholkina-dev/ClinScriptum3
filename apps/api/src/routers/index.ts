import { router } from "../trpc/trpc.js";
import { authRouter } from "./auth.js";
import { studyRouter } from "./study.js";
import { documentRouter } from "./document.js";

export const appRouter = router({
  auth: authRouter,
  study: studyRouter,
  document: documentRouter,
});

export type AppRouter = typeof appRouter;
