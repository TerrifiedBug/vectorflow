import crypto from "crypto";
import type {
  GitProvider,
  GitWebhookEvent,
  CreatePROptions,
  RepoCoordinates,
} from "./types";

/**
 * GitLab REST API v4 provider.
 *
 * Webhook verification uses the `X-Gitlab-Token` header (shared secret, NOT HMAC).
 * File and MR operations use the GitLab projects API with URL-encoded project path.
 */
export class GitLabProvider implements GitProvider {
  readonly name = "gitlab" as const;

  /**
   * GitLab webhook verification: compare the X-Gitlab-Token header directly
   * against the stored secret using timing-safe comparison.
   */
  verifyWebhookSignature(headers: Headers, _body: string, secret: string): boolean {
    const token = headers.get("x-gitlab-token");
    if (!token) return false;

    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);
    if (tokenBuf.length !== secretBuf.length) return false;

    return crypto.timingSafeEqual(tokenBuf, secretBuf);
  }

  parseWebhookEvent(headers: Headers, body: Record<string, unknown>): GitWebhookEvent {
    const eventType = headers.get("x-gitlab-event") ?? "";

    if (eventType === "System Hook" || eventType === "Test Hook") {
      return {
        type: "ping",
        branch: null,
        commits: [],
        prBody: null,
        prNumber: null,
        afterSha: null,
        pusherName: null,
      };
    }

    if (eventType === "Merge Request Hook") {
      const attrs = body.object_attributes as Record<string, unknown> | undefined;
      const action = attrs?.action as string | undefined;
      const state = attrs?.state as string | undefined;

      const type =
        state === "merged" || action === "merge"
          ? "pull_request_merged"
          : state === "closed"
            ? "pull_request_closed"
            : "unknown";

      return {
        type,
        branch: null,
        commits: [],
        prBody: (attrs?.description as string) ?? null,
        prNumber: (attrs?.iid as number) ?? null,
        afterSha: null,
        pusherName: (body.user as { username?: string } | undefined)?.username ?? null,
      };
    }

    if (eventType === "Push Hook" || eventType === "Tag Push Hook") {
      const ref = body.ref as string | undefined;
      const branch = ref?.replace("refs/heads/", "") ?? null;
      const rawCommits = (body.commits ?? []) as Array<{
        added?: string[];
        modified?: string[];
        removed?: string[];
      }>;
      const commits = rawCommits.map((c) => ({
        added: c.added ?? [],
        modified: c.modified ?? [],
        removed: c.removed ?? [],
      }));

      return {
        type: "push",
        branch,
        commits,
        prBody: null,
        prNumber: null,
        afterSha: (body.after as string) ?? null,
        pusherName: (body.user_username as string) ?? null,
      };
    }

    return {
      type: "unknown",
      branch: null,
      commits: [],
      prBody: null,
      prNumber: null,
      afterSha: null,
      pusherName: null,
    };
  }

  /**
   * Parse owner/repo (or the full project path) from a GitLab URL.
   * Supports nested groups: https://gitlab.com/group/subgroup/repo
   */
  parseRepoUrl(repoUrl: string): RepoCoordinates {
    // SSH: git@gitlab.com:group/repo.git
    const sshMatch = repoUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
    if (sshMatch) {
      const parts = sshMatch[1].split("/");
      const repo = parts.pop()!;
      const owner = parts.join("/");
      return { owner, repo };
    }

    // HTTPS: https://gitlab.com/group/[subgroup/]repo[.git]
    const httpsMatch = repoUrl.match(/gitlab\.[^/]+\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      const parts = httpsMatch[1].split("/");
      const repo = parts.pop()!;
      const owner = parts.join("/");
      return { owner, repo };
    }

    throw new Error(
      `Cannot parse GitLab project path from URL: "${repoUrl}". ` +
        `Expected format: https://gitlab.com/group/repo or git@gitlab.com:group/repo.git`,
    );
  }

  /** URL-encode the full project path for the GitLab API. */
  private projectPath(repoUrl: string): string {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    return encodeURIComponent(`${owner}/${repo}`);
  }

  /** Resolve the GitLab API base URL (supports self-hosted). */
  private apiBase(repoUrl: string): string {
    try {
      if (repoUrl.startsWith("git@")) {
        const hostMatch = repoUrl.match(/git@([^:]+):/);
        return `https://${hostMatch?.[1] ?? "gitlab.com"}/api/v4`;
      }
      const url = new URL(repoUrl);
      return `${url.protocol}//${url.host}/api/v4`;
    } catch {
      return "https://gitlab.com/api/v4";
    }
  }

  async fetchFileContent(
    repoUrl: string,
    token: string,
    branch: string,
    path: string,
  ): Promise<string> {
    const base = this.apiBase(repoUrl);
    const project = this.projectPath(repoUrl);
    const encodedPath = encodeURIComponent(path);

    const res = await fetch(
      `${base}/projects/${project}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(branch)}`,
      {
        headers: { "PRIVATE-TOKEN": token },
      },
    );

    if (!res.ok) {
      throw new Error(`GitLab API returned ${res.status} fetching ${path}`);
    }

    return res.text();
  }

  async createBranch(
    repoUrl: string,
    token: string,
    baseBranch: string,
    newBranch: string,
  ): Promise<void> {
    const base = this.apiBase(repoUrl);
    const project = this.projectPath(repoUrl);

    const res = await fetch(`${base}/projects/${project}/repository/branches`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ branch: newBranch, ref: baseBranch }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GitLab createBranch failed (${res.status}): ${errText}`);
    }
  }

  async commitFile(
    repoUrl: string,
    token: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<string> {
    const base = this.apiBase(repoUrl);
    const project = this.projectPath(repoUrl);

    // Check if file exists to determine create vs update
    const checkRes = await fetch(
      `${base}/projects/${project}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      { headers: { "PRIVATE-TOKEN": token } },
    );
    const action = checkRes.ok ? "update" : "create";

    const res = await fetch(`${base}/projects/${project}/repository/commits`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        branch,
        commit_message: message,
        actions: [{ action, file_path: path, content }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GitLab commitFile failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { id?: string };
    return data.id ?? "";
  }

  async createPullRequest(
    repoUrl: string,
    token: string,
    options: CreatePROptions,
  ): Promise<{ url: string; number: number }> {
    const base = this.apiBase(repoUrl);
    const project = this.projectPath(repoUrl);

    const res = await fetch(`${base}/projects/${project}/merge_requests`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_branch: options.headBranch,
        target_branch: options.baseBranch,
        title: options.title,
        description: options.body,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`GitLab createMergeRequest failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { web_url?: string; iid?: number };
    return {
      url: data.web_url ?? "",
      number: data.iid ?? 0,
    };
  }
}
