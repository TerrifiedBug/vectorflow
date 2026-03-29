import crypto from "crypto";
import type {
  GitProvider,
  GitWebhookEvent,
  CreatePROptions,
  RepoCoordinates,
} from "./types";

/**
 * Bitbucket Cloud REST API 2.0 provider.
 *
 * Webhook verification uses HMAC-SHA256 on the X-Hub-Signature header.
 * PR operations use the Bitbucket 2.0 pullrequests API.
 */
export class BitbucketProvider implements GitProvider {
  readonly name = "bitbucket" as const;

  verifyWebhookSignature(headers: Headers, body: string, secret: string): boolean {
    const signature = headers.get("x-hub-signature");
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
    const eventKey = headers.get("x-event-key") ?? "";

    if (eventKey === "diagnostics:ping" || eventKey === "") {
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

    if (eventKey === "pullrequest:fulfilled") {
      const pr = body.pullrequest as Record<string, unknown> | undefined;
      return {
        type: "pull_request_merged",
        branch: null,
        commits: [],
        prBody: (pr?.description as string) ?? null,
        prNumber: (pr?.id as number) ?? null,
        afterSha: null,
        pusherName: (body.actor as { display_name?: string } | undefined)?.display_name ?? null,
      };
    }

    if (eventKey === "pullrequest:rejected") {
      const pr = body.pullrequest as Record<string, unknown> | undefined;
      return {
        type: "pull_request_closed",
        branch: null,
        commits: [],
        prBody: (pr?.description as string) ?? null,
        prNumber: (pr?.id as number) ?? null,
        afterSha: null,
        pusherName: null,
      };
    }

    if (eventKey === "repo:push") {
      const push = body.push as { changes?: Array<Record<string, unknown>> } | undefined;
      const changes = push?.changes ?? [];

      // Extract branch from the first change's new ref
      let branch: string | null = null;
      let afterSha: string | null = null;
      const commits: Array<{ added: string[]; modified: string[]; removed: string[] }> = [];

      for (const change of changes) {
        const newRef = change.new as { name?: string; target?: { hash?: string } } | undefined;
        if (!branch && newRef?.name) {
          branch = newRef.name;
        }
        if (!afterSha && newRef?.target?.hash) {
          afterSha = newRef.target.hash;
        }

        // Bitbucket push events don't include file-level changes in the webhook payload.
        // We need to handle this in the webhook handler by fetching the diff.
        const rawCommits = (change.commits ?? []) as Array<Record<string, unknown>>;
        // Bitbucket webhook push payloads don't include per-file changes.
        // The webhook handler will need to fetch changed files via the API.
        for (let i = 0; i < rawCommits.length; i++) {
          commits.push({ added: [], modified: [], removed: [] });
        }
      }

      const actor = body.actor as { display_name?: string } | undefined;

      return {
        type: "push",
        branch,
        commits,
        prBody: null,
        prNumber: null,
        afterSha,
        pusherName: actor?.display_name ?? null,
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

  parseRepoUrl(repoUrl: string): RepoCoordinates {
    // SSH: git@bitbucket.org:workspace/repo.git
    const sshMatch = repoUrl.match(/git@bitbucket\.org:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // HTTPS: https://bitbucket.org/workspace/repo[.git]
    const httpsMatch = repoUrl.match(/bitbucket\.org\/([^/]+)\/(.+?)(?:\.git)?(?:\/.*)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    throw new Error(
      `Cannot parse Bitbucket workspace/repo from URL: "${repoUrl}". ` +
        `Expected format: https://bitbucket.org/workspace/repo or git@bitbucket.org:workspace/repo.git`,
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
      `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src/${encodeURIComponent(branch)}/${encodedPath}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Bitbucket API returned ${res.status} fetching ${path}`);
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

    const res = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/refs/branches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newBranch,
          target: { hash: baseBranch },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Bitbucket createBranch failed (${res.status}): ${errText}`);
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
    const { owner, repo } = this.parseRepoUrl(repoUrl);

    // Bitbucket uses multipart form data for the src endpoint
    const form = new FormData();
    form.append(path, new Blob([content], { type: "text/plain" }));
    form.append("message", message);
    form.append("branch", branch);

    const res = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Bitbucket commitFile failed (${res.status}): ${errText}`);
    }

    // Bitbucket src endpoint doesn't return commit SHA directly;
    // fetch the latest commit on the branch.
    const logRes = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/commits/${encodeURIComponent(branch)}?pagelen=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (logRes.ok) {
      const logData = (await logRes.json()) as { values?: Array<{ hash?: string }> };
      return logData.values?.[0]?.hash ?? "";
    }

    return "";
  }

  async createPullRequest(
    repoUrl: string,
    token: string,
    options: CreatePROptions,
  ): Promise<{ url: string; number: number }> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);

    const res = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: options.title,
          description: options.body,
          source: { branch: { name: options.headBranch } },
          destination: { branch: { name: options.baseBranch } },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Bitbucket createPullRequest failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      links?: { html?: { href?: string } };
      id?: number;
    };

    return {
      url: data.links?.html?.href ?? "",
      number: data.id ?? 0,
    };
  }

  /**
   * Fetch the list of changed files for a specific commit.
   * Used to supplement push events which don't include file-level changes.
   */
  async fetchCommitDiffstat(
    repoUrl: string,
    token: string,
    commitHash: string,
  ): Promise<Array<{ path: string; status: "added" | "modified" | "removed" }>> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);

    const res = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/diffstat/${commitHash}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) return [];

    const data = (await res.json()) as {
      values?: Array<{
        new?: { path?: string };
        old?: { path?: string };
        status?: string;
      }>;
    };

    return (data.values ?? []).map((v) => ({
      path: v.new?.path ?? v.old?.path ?? "",
      status:
        v.status === "added"
          ? "added"
          : v.status === "removed"
            ? "removed"
            : "modified",
    }));
  }
}
