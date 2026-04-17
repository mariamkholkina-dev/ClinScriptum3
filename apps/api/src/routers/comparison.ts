import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { comparisonService } from "../services/comparison.service.js";

const p = protectedProcedure.use(withDomainErrors);

export const comparisonRouter = router({
  compare: p
    .input(
      z.object({
        oldVersionId: z.string().uuid(),
        newVersionId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      comparisonService.compare(ctx.user.tenantId, input.oldVersionId, input.newVersionId),
    ),

  impactAnalysis: p
    .input(
      z.object({
        oldVersionId: z.string().uuid(),
        newVersionId: z.string().uuid(),
        targetDocumentId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      comparisonService.impactAnalysis(
        ctx.user.tenantId,
        input.oldVersionId,
        input.newVersionId,
        input.targetDocumentId,
      ),
    ),
});
