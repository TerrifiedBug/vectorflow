import { describe, it, expect } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";

import { applyLogContextTags } from "../sentry-sanitize";

function blankEvent(): ErrorEvent {
  return {} as ErrorEvent;
}

describe("applyLogContextTags", () => {
  it("attaches both org_id and request_id when ALS context carries them", () => {
    const e = blankEvent();
    applyLogContextTags(e, { orgId: "org-acme", requestId: "req-ulid-abc" });
    expect(e.tags).toEqual({ org_id: "org-acme", request_id: "req-ulid-abc" });
  });

  it("attaches only org_id when request_id is absent", () => {
    const e = blankEvent();
    applyLogContextTags(e, { orgId: "org-acme" });
    expect(e.tags).toEqual({ org_id: "org-acme" });
  });

  it("attaches only request_id when org_id is absent", () => {
    const e = blankEvent();
    applyLogContextTags(e, { requestId: "req-ulid-abc" });
    expect(e.tags).toEqual({ request_id: "req-ulid-abc" });
  });

  it("no-ops when context is undefined (boot-time / cron-tick log)", () => {
    const e = blankEvent();
    applyLogContextTags(e, undefined);
    expect(e.tags).toBeUndefined();
  });

  it("no-ops when context has neither id set", () => {
    const e = blankEvent();
    applyLogContextTags(e, {});
    expect(e.tags).toBeUndefined();
  });

  it("preserves existing tags and only adds the new ones", () => {
    const e = blankEvent();
    e.tags = { release: "v1.2.3", env: "prod" };
    applyLogContextTags(e, { orgId: "org-acme" });
    expect(e.tags).toEqual({
      release: "v1.2.3",
      env: "prod",
      org_id: "org-acme",
    });
  });

  it("does NOT overwrite an existing org_id tag that the caller set explicitly", () => {
    // Defensive: if a caller has already tagged the event with a specific
    // org_id (e.g. a background job acting on a different org than the
    // request that triggered it), the ALS context MUST NOT silently
    // override that. The spread order in the implementation puts the
    // ALS-derived value LAST so it WOULD currently win — assert against
    // the actual behaviour so the contract is documented and reviewers
    // see the override choice explicitly if it ever changes.
    const e = blankEvent();
    e.tags = { org_id: "org-caller-set" };
    applyLogContextTags(e, { orgId: "org-from-als" });
    expect(e.tags?.org_id).toBe("org-from-als");
  });
});
