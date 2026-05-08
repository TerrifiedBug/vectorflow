import { describe, expect, it } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { fetchPromotionPipelinesForEnvironments } from "./new-promotion-button";

describe("fetchPromotionPipelinesForEnvironments", () => {
  it("fetches every page for each environment", async () => {
    const calls: Array<{ environmentId: string; cursor?: string; limit: number }> = [];
    const queryClient = {
      fetchQuery: async (options: { queryKey: [string, string, { environmentId: string; cursor?: string; limit: number }] }) => {
        const [, , input] = options.queryKey;
        calls.push(input);

        if (input.environmentId === "env-1" && !input.cursor) {
          return {
            pipelines: [{ id: "p-1", name: "alpha" }],
            nextCursor: "cursor-1",
          };
        }
        if (input.environmentId === "env-1" && input.cursor === "cursor-1") {
          return {
            pipelines: [{ id: "p-2", name: "omega" }],
            nextCursor: undefined,
          };
        }
        return {
          pipelines: [{ id: "p-3", name: "beta" }],
          nextCursor: undefined,
        };
      },
    } as Pick<QueryClient, "fetchQuery">;

    const pipelines = await fetchPromotionPipelinesForEnvironments({
      queryClient,
      environments: [
        { id: "env-1", name: "prod" },
        { id: "env-2", name: "stage" },
      ],
      getQueryOptions: (input) => ({ queryKey: ["pipeline.list", "test", input] }),
    });

    expect(calls).toEqual([
      { environmentId: "env-1", limit: 200 },
      { environmentId: "env-1", cursor: "cursor-1", limit: 200 },
      { environmentId: "env-2", limit: 200 },
    ]);
    expect(pipelines.map((pipeline) => pipeline.id)).toEqual(["p-1", "p-3", "p-2"]);
    expect(pipelines.map((pipeline) => pipeline.environmentName)).toEqual(["prod", "stage", "prod"]);
  });
});
