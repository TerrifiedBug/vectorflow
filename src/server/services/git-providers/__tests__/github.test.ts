import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { GitHubProvider } from "../github";

const provider = new GitHubProvider();

describe("GitHubProvider", () => {
  describe("verifyWebhookSignature", () => {
    it("returns true for valid HMAC-SHA256 signature", () => {
      const secret = "test-secret-123";
      const body = '{"ref":"refs/heads/main"}';
      const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
      const signature = `sha256=${hmac}`;

      const headers = new Headers({ "x-hub-signature-256": signature });
      expect(provider.verifyWebhookSignature(headers, body, secret)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const headers = new Headers({ "x-hub-signature-256": "sha256=invalid" });
      expect(provider.verifyWebhookSignature(headers, "body", "secret")).toBe(false);
    });

    it("returns false when signature header is missing", () => {
      const headers = new Headers();
      expect(provider.verifyWebhookSignature(headers, "body", "secret")).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses a ping event", () => {
      const headers = new Headers({ "x-github-event": "ping" });
      const event = provider.parseWebhookEvent(headers, {});
      expect(event.type).toBe("ping");
    });

    it("parses a push event with changed files", () => {
      const headers = new Headers({ "x-github-event": "push" });
      const body = {
        ref: "refs/heads/main",
        after: "abc123",
        pusher: { name: "danny" },
        commits: [
          { added: ["staging/new.yaml"], modified: ["staging/existing.yaml"], removed: [] },
        ],
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("push");
      expect(event.branch).toBe("main");
      expect(event.afterSha).toBe("abc123");
      expect(event.pusherName).toBe("danny");
      expect(event.commits).toHaveLength(1);
      expect(event.commits[0].added).toEqual(["staging/new.yaml"]);
    });

    it("parses a merged pull request event", () => {
      const headers = new Headers({ "x-github-event": "pull_request" });
      const body = {
        action: "closed",
        pull_request: {
          merged: true,
          body: "<!-- vf-promotion-request-id: abc123 -->",
          number: 42,
        },
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("pull_request_merged");
      expect(event.prBody).toBe("<!-- vf-promotion-request-id: abc123 -->");
      expect(event.prNumber).toBe(42);
    });

    it("parses a closed-without-merge PR event", () => {
      const headers = new Headers({ "x-github-event": "pull_request" });
      const body = {
        action: "closed",
        pull_request: { merged: false, body: "test", number: 10 },
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("pull_request_closed");
    });
  });

  describe("parseRepoUrl", () => {
    it("parses HTTPS URL", () => {
      const result = provider.parseRepoUrl("https://github.com/acme/configs.git");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("parses HTTPS URL without .git", () => {
      const result = provider.parseRepoUrl("https://github.com/acme/configs");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("parses SSH URL", () => {
      const result = provider.parseRepoUrl("git@github.com:acme/configs.git");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("throws for invalid URL", () => {
      expect(() => provider.parseRepoUrl("https://gitlab.com/acme/configs")).toThrow();
    });
  });
});
