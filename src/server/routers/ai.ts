import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/server/middleware/audit";
import { Prisma } from "@/generated/prisma";

export const aiRouter = router({
  getConversation: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("VIEWER"))
    .query(async ({ input }) => {
      const conversation = await prisma.aiConversation.findFirst({
        where: { pipelineId: input.pipelineId },
        orderBy: { createdAt: "desc" },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            include: {
              createdBy: { select: { id: true, name: true, image: true } },
            },
          },
        },
      });
      return conversation;
    }),

  startNewConversation: protectedProcedure
    .input(z.object({ pipelineId: z.string() }))
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.ai_conversation_started", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      const conversation = await prisma.aiConversation.create({
        data: {
          pipelineId: input.pipelineId,
          createdById: ctx.session.user.id,
        },
      });
      return conversation;
    }),

  markSuggestionsApplied: protectedProcedure
    .input(
      z.object({
        pipelineId: z.string(),
        conversationId: z.string(),
        messageId: z.string(),
        suggestionIds: z.array(z.string()),
      }),
    )
    .use(withTeamAccess("EDITOR"))
    .use(withAudit("pipeline.ai_suggestion_applied", "Pipeline"))
    .mutation(async ({ input, ctx }) => {
      return prisma.$transaction(async (tx) => {
        const message = await tx.aiMessage.findUnique({
          where: { id: input.messageId },
          include: {
            conversation: { select: { pipelineId: true } },
          },
        });

        if (
          !message ||
          message.conversationId !== input.conversationId ||
          message.conversation.pipelineId !== input.pipelineId
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Message not found in conversation" });
        }

        // Mark suggestions as applied in the JSON
        const suggestions = (message.suggestions as Array<Record<string, unknown>>) ?? [];
        const updatedSuggestions = suggestions.map((s) =>
          input.suggestionIds.includes(s.id as string)
            ? { ...s, appliedAt: new Date().toISOString(), appliedById: ctx.session.user.id }
            : s,
        );

        await tx.aiMessage.update({
          where: { id: input.messageId },
          data: { suggestions: updatedSuggestions as unknown as Prisma.InputJsonValue },
        });

        return { applied: input.suggestionIds.length };
      });
    }),
});
