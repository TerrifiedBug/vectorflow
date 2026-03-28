/** Normalized webhook event from any Git provider. */
export interface GitWebhookEvent {
  type: "push" | "pull_request_merged" | "pull_request_closed" | "ping" | "unknown";
  branch: string | null;
  commits: Array<{
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  /** For PR events */
  prBody: string | null;
  prNumber: number | null;
  /** Commit SHA for push events */
  afterSha: string | null;
  /** Pusher name for attribution */
  pusherName: string | null;
}

/** Options for creating a pull request via the provider. */
export interface CreatePROptions {
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
}

/** Parsed repository coordinates. */
export interface RepoCoordinates {
  owner: string;
  repo: string;
}

/**
 * Abstraction over Git hosting providers for webhook verification,
 * file operations, and PR management.
 */
export interface GitProvider {
  readonly name: "github" | "gitlab" | "bitbucket";

  /** Verify the incoming webhook request signature. */
  verifyWebhookSignature(headers: Headers, body: string, secret: string): boolean;

  /** Parse a webhook request into a normalized event. */
  parseWebhookEvent(headers: Headers, body: Record<string, unknown>): GitWebhookEvent;

  /** Parse owner/repo from a repository URL. */
  parseRepoUrl(repoUrl: string): RepoCoordinates;

  /** Fetch file content from the repository. */
  fetchFileContent(
    repoUrl: string,
    token: string,
    branch: string,
    path: string,
  ): Promise<string>;

  /** Create a new branch from the base branch. */
  createBranch(
    repoUrl: string,
    token: string,
    baseBranch: string,
    newBranch: string,
  ): Promise<void>;

  /** Commit a file to a branch, creating or updating it. Returns the commit SHA. */
  commitFile(
    repoUrl: string,
    token: string,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<string>;

  /** Create a pull request. Returns the PR URL and number. */
  createPullRequest(
    repoUrl: string,
    token: string,
    options: CreatePROptions,
  ): Promise<{ url: string; number: number }>;
}
