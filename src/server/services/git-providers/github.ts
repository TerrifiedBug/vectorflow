import crypto from "crypto";
import { Octokit } from "@octokit/rest";
import type {
  GitProvider,
  GitWebhookEvent,
  CreatePROptions,
  RepoCoordinates,
} from "./types";

export class GitHubProvider implements GitProvider {
  readonly name = "github" as const;

  verifyWebhookSignature(headers: Headers, body: string, secret: string): boolean {
    const signature = headers.get("x-hub-signature-256");
    if (!signature) return false;

    const expected =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  parseWebhookEvent(headers: Headers, body: Record<string, unknown>): GitWebhookEvent {
    const eventType = headers.get("x-github-event") ?? "push";

    if (eventType === "ping") {
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

    if (eventType === "pull_request") {
      const pr = body.pull_request as Record<string, unknown> | undefined;
      const action = body.action as string | undefined;
      const merged = pr?.merged as boolean | undefined;

      const type =
        action === "closed" && merged
          ? "pull_request_merged"
          : action === "closed"
            ? "pull_request_closed"
            : "unknown";

      return {
        type,
        branch: null,
        commits: [],
        prBody: (pr?.body as string) ?? null,
        prNumber: (pr?.number as number) ?? null,
        afterSha: null,
        pusherName: null,
      };
    }

    // Push event
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
      pusherName: (body.pusher as { name?: string } | undefined)?.name ?? null,
    };
  }

  parseRepoUrl(repoUrl: string): RepoCoordinates {
    // SSH format: git@github.com:owner/repo.git
    const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // HTTPS format: https://github.com/owner/repo[.git]
    const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?(?:\/.*)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    throw new Error(
      `Cannot parse GitHub owner/repo from URL: "${repoUrl}". ` +
        `Expected format: https://github.com/owner/repo or git@github.com:owner/repo.git`,
    );
  }

  async fetchFileContent(
    repoUrl: string,
    token: string,
    branch: string,
    path: string,
  ): Promise<string> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw",
        },
      },
    );

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status} fetching ${path}`);
    }

    return res.text();
  }

  async createBranch(
    repoUrl: string,
    token: string,
    baseBranch: string,
    newBranch: string,
  ): Promise<void> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const octokit = new Octokit({ auth: token });

    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });

    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranch}`,
      sha: refData.object.sha,
    });
  }

  async commitFile(
    repoUrl: string,
    token: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<string> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const octokit = new Octokit({ auth: token });

    // Check for existing file to get SHA
    let existingSha: string | undefined;
    try {
      const { data: existing } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      if (!Array.isArray(existing) && "sha" in existing) {
        existingSha = existing.sha;
      }
    } catch {
      // File does not exist yet
    }

    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });

    return data.commit.sha ?? "";
  }

  async createPullRequest(
    repoUrl: string,
    token: string,
    options: CreatePROptions,
  ): Promise<{ url: string; number: number }> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const octokit = new Octokit({ auth: token });

    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: options.title,
      body: options.body,
      head: options.headBranch,
      base: options.baseBranch,
    });

    return { url: pr.html_url, number: pr.number };
  }
}

/**
 * Backward-compatible re-export used by gitops-promotion.ts.
 */
export function parseGitHubOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  return new GitHubProvider().parseRepoUrl(repoUrl);
}
