import { describe, it, expect } from "vitest";
import { GitLabProvider } from "../gitlab";

const provider = new GitLabProvider();

describe("GitLabProvider", () => {
  describe("verifyWebhookSignature", () => {
    it("returns true when X-Gitlab-Token matches secret", () => {
      const secret = "my-webhook-secret";
      const headers = new Headers({ "x-gitlab-token": secret });
      expect(provider.verifyWebhookSignature(headers, "any-body", secret)).toBe(true);
    });

    it("returns false for wrong token", () => {
      const headers = new Headers({ "x-gitlab-token": "wrong" });
      expect(provider.verifyWebhookSignature(headers, "any-body", "correct")).toBe(false);
    });

    it("returns false when token header is missing", () => {
      const headers = new Headers();
      expect(provider.verifyWebhookSignature(headers, "body", "secret")).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses a push hook", () => {
      const headers = new Headers({ "x-gitlab-event": "Push Hook" });
      const body = {
        ref: "refs/heads/main",
        after: "def456",
        user_username: "danny",
        commits: [
          { added: ["prod/pipeline.yaml"], modified: [], removed: [] },
        ],
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("push");
      expect(event.branch).toBe("main");
      expect(event.afterSha).toBe("def456");
      expect(event.pusherName).toBe("danny");
      expect(event.commits[0].added).toEqual(["prod/pipeline.yaml"]);
    });

    it("parses a merged merge request hook", () => {
      const headers = new Headers({ "x-gitlab-event": "Merge Request Hook" });
      const body = {
        object_attributes: {
          action: "merge",
          state: "merged",
          description: "<!-- vf-promotion-request-id: xyz789 -->",
          iid: 5,
        },
        user: { username: "reviewer" },
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("pull_request_merged");
      expect(event.prBody).toBe("<!-- vf-promotion-request-id: xyz789 -->");
      expect(event.prNumber).toBe(5);
    });

    it("parses a closed (not merged) MR", () => {
      const headers = new Headers({ "x-gitlab-event": "Merge Request Hook" });
      const body = {
        object_attributes: { action: "close", state: "closed", iid: 6 },
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("pull_request_closed");
    });

    it("treats Test Hook as ping", () => {
      const headers = new Headers({ "x-gitlab-event": "Test Hook" });
      const event = provider.parseWebhookEvent(headers, {});
      expect(event.type).toBe("ping");
    });
  });

  describe("parseRepoUrl", () => {
    it("parses HTTPS URL", () => {
      const result = provider.parseRepoUrl("https://gitlab.com/acme/configs.git");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("parses nested group URL", () => {
      const result = provider.parseRepoUrl("https://gitlab.com/acme/infra/configs");
      expect(result).toEqual({ owner: "acme/infra", repo: "configs" });
    });

    it("parses SSH URL", () => {
      const result = provider.parseRepoUrl("git@gitlab.com:acme/configs.git");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("parses self-hosted GitLab URL", () => {
      const result = provider.parseRepoUrl("https://gitlab.internal.io/team/repo.git");
      expect(result).toEqual({ owner: "team", repo: "repo" });
    });

    it("throws for non-GitLab URL", () => {
      expect(() => provider.parseRepoUrl("https://github.com/acme/configs")).toThrow();
    });
  });
});
