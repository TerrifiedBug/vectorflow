import { router } from "@/trpc/init";
import { directReleaseRouter } from "@/server/routers/release/direct";
import { promotionReleaseRouter } from "@/server/routers/release/promotion";
import { canaryReleaseRouter } from "@/server/routers/release/canary";

export const releaseRouter = router({
  direct: directReleaseRouter,
  promotion: promotionReleaseRouter,
  canary: canaryReleaseRouter,
});
