import { Octokit } from "@octokit/rest";
import { decrypt } from "@/server/services/crypto";
import { toFilenameSlug } from "@/server/services/git-sync";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreatePromotionPROptions {
  /** Encrypted GitHub PAT (stored in Environment.gitToken) */
  encryptedToken: string;
  /** GitHub repo URL — https or SSH format */
  repoUrl: string;
  /** Target branch in the repo (e.g. "main") */
  baseBranch: string;
  /** PromotionRequest.id — used to make branch name unique and embedded in PR body */
  requestId: string;
  /** Source pipeline name */
  pipelineName: string;
  /** Source environment name */
  sourceEnvironmentName: string;
  /** Target environment name */
  targetEnvironmentName: string;
  /** Vector YAML config string for the promoted pipeline */
  configYaml: string;
}

export interface CreatePromotionPRResult {
  prNumber: number;
  prUrl: string;
  prBranch: string;
}

// ─── URL Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses owner and repo from a GitHub URL.
 * Supports:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - git@github.com:owner/repo.git
 */
export function parseGitHubOwnerRepo(repoUrl: string): { owner: string; repo: string } {
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

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Creates a GitHub PR for a pipeline promotion using the GitHub REST API.
 *
 * Flow:
 *   1. Decrypt token and authenticate with Octokit
 *   2. Get the base branch SHA
 *   3. Create a new PR branch (vf-promote/{envSlug}-{pipelineSlug}-{requestId[:8]})
 *   4. Commit the pipeline YAML file to {envSlug}/{pipelineSlug}.yaml on the PR branch
 *   5. Open a PR with the VF promotion request ID embedded in the body
 *
 * The promotion request ID in the PR body is used by the merge webhook handler
 * to look up the PromotionRequest when the PR is merged.
 */
export async function createPromotionPR(
  opts: CreatePromotionPROptions,
): Promise<CreatePromotionPRResult> {
  const token = decrypt(opts.encryptedToken);
  const { owner, repo } = parseGitHubOwnerRepo(opts.repoUrl);

  const octokit = new Octokit({ auth: token });

  // Step 1: Get base branch SHA
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${opts.baseBranch}`,
  });
  const baseSha = refData.object.sha;

  // Step 2: Create PR branch with unique name to avoid collision
  const envSlug = toFilenameSlug(opts.targetEnvironmentName);
  const pipelineSlug = toFilenameSlug(opts.pipelineName);
  const prBranch = `vf-promote/${envSlug}-${pipelineSlug}-${opts.requestId.slice(0, 8)}`;

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${prBranch}`,
    sha: baseSha,
  });

  // Step 3: Check for existing file (to get SHA for update vs create)
  const filePath = `${envSlug}/${pipelineSlug}.yaml`;
  let existingSha: string | undefined;
  try {
    const { data: existing } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: prBranch,
    });
    if (!Array.isArray(existing) && "sha" in existing) {
      existingSha = existing.sha;
    }
  } catch {
    // File does not exist yet — this is expected for new promotions
  }

  // Step 4: Commit YAML file to PR branch
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: `promote: "${opts.pipelineName}" \u2192 ${opts.targetEnvironmentName}`,
    content: Buffer.from(opts.configYaml).toString("base64"),
    branch: prBranch,
    ...(existingSha ? { sha: existingSha } : {}),
  });

  // Step 5: Create the pull request
  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `Promote "${opts.pipelineName}" to ${opts.targetEnvironmentName}`,
    body: [
      `<!-- vf-promotion-request-id: ${opts.requestId} -->`,
      ``,
      `Automatically promoted by **VectorFlow** from **${opts.sourceEnvironmentName}** to **${opts.targetEnvironmentName}**.`,
      ``,
      `**Merge this PR to deploy the pipeline to ${opts.targetEnvironmentName}.**`,
    ].join("\n"),
    head: prBranch,
    base: opts.baseBranch,
  });

  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    prBranch,
  };
}
