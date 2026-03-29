import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { BitbucketProvider } from "../bitbucket";

const provider = new BitbucketProvider();

describe("BitbucketProvider", () => {
  describe("verifyWebhookSignature", () => {
    it("returns true for valid HMAC-SHA256 signature", () => {
      const secret = "bb-secret";
      const body = '{"push":{"changes":[]}}';
      const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
      const signature = `sha256=${hmac}`;

      const headers = new Headers({ "x-hub-signature": signature });
      expect(provider.verifyWebhookSignature(headers, body, secret)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const headers = new Headers({ "x-hub-signature": "sha256=wrong" });
      expect(provider.verifyWebhookSignature(headers, "body", "secret")).toBe(false);
    });

    it("returns false when signature header is missing", () => {
      const headers = new Headers();
      expect(provider.verifyWebhookSignature(headers, "body", "secret")).toBe(false);
    });
  });

  describe("parseWebhookEvent", () => {
    it("parses a push event", () => {
      const headers = new Headers({ "x-event-key": "repo:push" });
      const body = {
        push: {
          changes: [
            {
              new: { name: "main", target: { hash: "abc123" } },
              commits: [{}],
            },
          ],
        },
        actor: { display_name: "Danny" },
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("push");
      expect(event.branch).toBe("main");
      expect(event.afterSha).toBe("abc123");
      expect(event.pusherName).toBe("Danny");
    });

    it("parses a fulfilled (merged) pull request", () => {
      const headers = new Headers({ "x-event-key": "pullrequest:fulfilled" });
      const body = {
        pullrequest: {
          id: 42,
          description: "<!-- vf-promotion-request-id: promo123 -->",
        },
        actor: { display_name: "Reviewer" },
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("pull_request_merged");
      expect(event.prNumber).toBe(42);
      expect(event.prBody).toContain("promo123");
    });

    it("parses a rejected (closed) pull request", () => {
      const headers = new Headers({ "x-event-key": "pullrequest:rejected" });
      const body = {
        pullrequest: { id: 10, description: "test" },
      };
      const event = provider.parseWebhookEvent(headers, body);
      expect(event.type).toBe("pull_request_closed");
    });

    it("treats diagnostics:ping as ping", () => {
      const headers = new Headers({ "x-event-key": "diagnostics:ping" });
      const event = provider.parseWebhookEvent(headers, {});
      expect(event.type).toBe("ping");
    });
  });

  describe("parseRepoUrl", () => {
    it("parses HTTPS URL", () => {
      const result = provider.parseRepoUrl("https://bitbucket.org/acme/configs.git");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("parses HTTPS URL without .git", () => {
      const result = provider.parseRepoUrl("https://bitbucket.org/acme/configs");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("parses SSH URL", () => {
      const result = provider.parseRepoUrl("git@bitbucket.org:acme/configs.git");
      expect(result).toEqual({ owner: "acme", repo: "configs" });
    });

    it("throws for non-Bitbucket URL", () => {
      expect(() => provider.parseRepoUrl("https://github.com/acme/configs")).toThrow();
    });
  });
});
