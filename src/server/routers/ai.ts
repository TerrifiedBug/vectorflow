import { z } from "zod";
import { router, protectedProcedure, withTeamAccess } from "@/trpc/init";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/services/audit";
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
    .mutation(async ({ input, ctx }) => {
      const message = await prisma.aiMessage.findUnique({
        where: { id: input.messageId },
        include: {
          conversation: { select: { pipelineId: true } },
        },
      });

      if (!message || message.conversationId !== input.conversationId) {
        throw new Error("Message not found in conversation");
      }

      // Mark suggestions as applied in the JSON
      const suggestions = (message.suggestions as Array<Record<string, unknown>>) ?? [];
      const updatedSuggestions = suggestions.map((s) =>
        input.suggestionIds.includes(s.id as string)
          ? { ...s, appliedAt: new Date().toISOString(), appliedById: ctx.session.user.id }
          : s,
      );

      await prisma.aiMessage.update({
        where: { id: input.messageId },
        data: { suggestions: updatedSuggestions as unknown as Prisma.InputJsonValue },
      });

      // Audit log
      const pipeline = await prisma.pipeline.findUnique({
        where: { id: message.conversation.pipelineId },
        select: { environmentId: true, environment: { select: { teamId: true } } },
      });

      writeAuditLog({
        userId: ctx.session.user.id,
        action: "pipeline.ai_suggestion_applied",
        entityType: "Pipeline",
        entityId: message.conversation.pipelineId,
        metadata: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          suggestionIds: input.suggestionIds,
          suggestionCount: input.suggestionIds.length,
        },
        teamId: pipeline?.environment.teamId ?? null,
        environmentId: pipeline?.environmentId ?? null,
        userEmail: ctx.session.user.email ?? null,
        userName: ctx.session.user.name ?? null,
      }).catch(() => {});

      return { applied: input.suggestionIds.length };
    }),
});
