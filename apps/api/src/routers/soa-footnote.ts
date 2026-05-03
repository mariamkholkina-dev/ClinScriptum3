import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { soaFootnoteService } from "../services/soa-footnote.service.js";

const p = protectedProcedure.use(withDomainErrors);

const anchorTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cell"), cellId: z.string().uuid() }),
  z.object({ type: z.literal("row"), rowIndex: z.number().int().min(0) }),
  z.object({ type: z.literal("col"), colIndex: z.number().int().min(0) }),
]);

export const soaFootnoteRouter = router({
  listForTable: p
    .input(z.object({ soaTableId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      soaFootnoteService.listForTable(ctx.user.tenantId, input.soaTableId),
    ),

  create: p
    .input(
      z.object({
        soaTableId: z.string().uuid(),
        marker: z.string().min(1).max(8),
        text: z.string().default(""),
      }),
    )
    .mutation(({ ctx, input }) =>
      soaFootnoteService.create(
        ctx.user.tenantId,
        input.soaTableId,
        input.marker,
        input.text,
      ),
    ),

  update: p
    .input(
      z.object({
        footnoteId: z.string().uuid(),
        marker: z.string().min(1).max(8).optional(),
        text: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      soaFootnoteService.update(ctx.user.tenantId, input.footnoteId, {
        marker: input.marker,
        text: input.text,
      }),
    ),

  delete: p
    .input(z.object({ footnoteId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      soaFootnoteService.delete(ctx.user.tenantId, input.footnoteId),
    ),

  linkAnchor: p
    .input(
      z.object({
        footnoteId: z.string().uuid(),
        target: anchorTargetSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      soaFootnoteService.linkAnchor(
        ctx.user.tenantId,
        input.footnoteId,
        input.target,
      ),
    ),

  unlinkAnchor: p
    .input(z.object({ anchorId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      soaFootnoteService.unlinkAnchor(ctx.user.tenantId, input.anchorId),
    ),
});
