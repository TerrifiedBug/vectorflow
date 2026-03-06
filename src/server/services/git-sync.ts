import simpleGit, { SimpleGit } from "simple-git";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { decrypt } from "@/server/services/crypto";

export interface GitSyncConfig {
  repoUrl: string;
  branch: string;
  encryptedToken: string;
}

export interface GitSyncResult {
  success: boolean;
  commitSha?: string;
  error?: string;
}

interface GitAuthor {
  name: string;
  email: string;
}

/**
 * Build an authenticated HTTPS URL by injecting the PAT.
 * Supports GitHub, GitLab, Bitbucket URL formats.
 * Example: https://github.com/org/repo.git → https://<token>@github.com/org/repo.git
 */
function authenticatedUrl(repoUrl: string, token: string): string {
  const url = new URL(repoUrl);
  url.username = token;
  url.password = "";
  return url.toString();
}

/**
 * Slugify a string for use as a filename.
 */
export function toFilenameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Commit a pipeline YAML file to the configured Git repo.
 * Used after successful deploy.
 */
export async function gitSyncCommitPipeline(
  config: GitSyncConfig,
  environmentName: string,
  pipelineName: string,
  configYaml: string,
  author: GitAuthor,
  commitMessage: string,
): Promise<GitSyncResult> {
  let workdir: string | null = null;

  try {
    const token = decrypt(config.encryptedToken);
    const url = authenticatedUrl(config.repoUrl, token);
    workdir = await mkdtemp(join(tmpdir(), "vf-git-sync-"));

    const git: SimpleGit = simpleGit(workdir);
    await git.clone(url, workdir, ["--branch", config.branch, "--depth", "1", "--single-branch"]);

    // Write the pipeline YAML file
    const envDir = toFilenameSlug(environmentName);
    const filename = `${toFilenameSlug(pipelineName)}.yaml`;
    const filePath = join(envDir, filename);
    const fullPath = join(workdir, filePath);

    await mkdir(join(workdir, envDir), { recursive: true });
    await writeFile(fullPath, configYaml, "utf-8");

    await git.add(filePath);

    // Check if there are actually changes to commit
    const status = await git.status();
    if (status.isClean()) {
      return { success: true, commitSha: "no-change" };
    }

    await git.commit(commitMessage, filePath, {
      "--author": `${author.name || "VectorFlow User"} <${author.email}>`,
    });
    await git.push("origin", config.branch);

    const log = await git.log({ maxCount: 1 });
    return { success: true, commitSha: log.latest?.hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[git-sync] Commit failed:", message);
    return { success: false, error: message };
  } finally {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Delete a pipeline YAML file from the configured Git repo.
 * Used after pipeline deletion.
 */
export async function gitSyncDeletePipeline(
  config: GitSyncConfig,
  environmentName: string,
  pipelineName: string,
  author: GitAuthor,
): Promise<GitSyncResult> {
  let workdir: string | null = null;

  try {
    const token = decrypt(config.encryptedToken);
    const url = authenticatedUrl(config.repoUrl, token);
    workdir = await mkdtemp(join(tmpdir(), "vf-git-sync-"));

    const git: SimpleGit = simpleGit(workdir);
    await git.clone(url, workdir, ["--branch", config.branch, "--depth", "1", "--single-branch"]);

    const envDir = toFilenameSlug(environmentName);
    const filename = `${toFilenameSlug(pipelineName)}.yaml`;
    const filePath = join(envDir, filename);

    await git.rm(filePath);
    await git.commit(`Delete pipeline: ${pipelineName}`, filePath, {
      "--author": `${author.name || "VectorFlow User"} <${author.email}>`,
    });
    await git.push("origin", config.branch);

    const log = await git.log({ maxCount: 1 });
    return { success: true, commitSha: log.latest?.hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[git-sync] Delete failed:", message);
    return { success: false, error: message };
  } finally {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
