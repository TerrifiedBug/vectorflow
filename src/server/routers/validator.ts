import { z } from "zod";
import { router, protectedProcedure } from "@/trpc/init";
import { validateConfig } from "@/server/services/validator";

export const validatorRouter = router({
  validate: protectedProcedure
    .input(z.object({ yaml: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return validateConfig(input.yaml);
    }),
});
