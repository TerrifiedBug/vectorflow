import { decrypt } from "@/server/services/crypto";
import { getProvider } from "@/server/services/git-providers";
import { toFilenameSlug } from "@/server/services/git-sync";

// --- Types ---

export interface CreatePromotionPROptions {
  encryptedToken: string;
  repoUrl: string;
  baseBranch: string;
  requestId: string;
  pipelineName: string;
  sourceEnvironmentName: string;
  targetEnvironmentName: string;
  configYaml: string;
  /** Explicit provider override. Auto-detected from repoUrl if null. */
  gitProvider?: string | null;
  /** Stable git path for the pipeline. Falls back to slug-based derivation. */
  gitPath?: string | null;
}

export interface CreatePromotionPRResult {
  prNumber: number;
  prUrl: string;
  prBranch: string;
}

// --- URL Parsing (kept for backward compatibility) ---

export { parseGitHubOwnerRepo } from "@/server/services/git-providers/github";

// --- Service ---

/**
 * Creates a PR for a pipeline promotion using the resolved Git provider.
 *
 * Flow:
 *   1. Resolve the provider from repoUrl or explicit gitProvider
 *   2. Decrypt token
 *   3. Create a new branch (vf-promote/{envSlug}-{pipelineSlug}-{requestId[:8]})
 *   4. Commit the pipeline YAML file
 *   5. Open a PR/MR with the VF promotion request ID in the body
 */
export async function createPromotionPR(
  opts: CreatePromotionPROptions,
): Promise<CreatePromotionPRResult> {
  const provider = getProvider({
    gitProvider: opts.gitProvider ?? null,
    gitRepoUrl: opts.repoUrl,
  });

  if (!provider) {
    throw new Error(
      `Cannot determine git provider for URL: "${opts.repoUrl}". ` +
        `Supported providers: github, gitlab, bitbucket.`,
    );
  }

  const token = decrypt(opts.encryptedToken);

  // Determine the file path: use gitPath if provided, otherwise derive from slugs
  const envSlug = toFilenameSlug(opts.targetEnvironmentName);
  const pipelineSlug = toFilenameSlug(opts.pipelineName);
  const filePath = opts.gitPath ?? `${envSlug}/${pipelineSlug}.yaml`;

  const prBranch = `vf-promote/${envSlug}-${pipelineSlug}-${opts.requestId.slice(0, 8)}`;

  // Step 1: Create branch
  await provider.createBranch(opts.repoUrl, token, opts.baseBranch, prBranch);

  // Step 2: Commit file
  await provider.commitFile(
    opts.repoUrl,
    token,
    prBranch,
    filePath,
    opts.configYaml,
    `promote: "${opts.pipelineName}" \u2192 ${opts.targetEnvironmentName}`,
  );

  // Step 3: Create PR/MR
  const prResult = await provider.createPullRequest(opts.repoUrl, token, {
    baseBranch: opts.baseBranch,
    headBranch: prBranch,
    title: `Promote "${opts.pipelineName}" to ${opts.targetEnvironmentName}`,
    body: [
      `<!-- vf-promotion-request-id: ${opts.requestId} -->`,
      ``,
      `Automatically promoted by **VectorFlow** from **${opts.sourceEnvironmentName}** to **${opts.targetEnvironmentName}**.`,
      ``,
      `**Merge this PR to deploy the pipeline to ${opts.targetEnvironmentName}.**`,
    ].join("\n"),
  });

  return {
    prNumber: prResult.number,
    prUrl: prResult.url,
    prBranch,
  };
}
