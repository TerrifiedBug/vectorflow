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

function sanitizeError(message: string): string {
  return message.replace(/https?:\/\/[^@\s]+@/g, "https://[redacted]@");
}

function sanitizeAuthor(name: string, email: string): string {
  const cleanName = (name || "VectorFlow User").replace(/[<>\n\r]/g, "");
  const cleanEmail = email.replace(/[<>\n\r]/g, "");
  return `${cleanName} <${cleanEmail}>`;
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
    const repoDir = join(workdir, "repo");

    const git: SimpleGit = simpleGit(workdir);
    await git.clone(url, repoDir, ["--branch", config.branch, "--depth", "1", "--single-branch"]);
    const repoGit: SimpleGit = simpleGit(repoDir);

    // Write the pipeline YAML file
    const envDir = toFilenameSlug(environmentName);
    const filename = `${toFilenameSlug(pipelineName)}.yaml`;
    const filePath = join(envDir, filename);
    const fullPath = join(repoDir, filePath);

    await mkdir(join(repoDir, envDir), { recursive: true });
    await writeFile(fullPath, configYaml, "utf-8");

    await repoGit.add(filePath);

    // Check if there are actually changes to commit
    const status = await repoGit.status();
    if (status.isClean()) {
      return { success: true, commitSha: "no-change" };
    }

    await repoGit.addConfig("user.name", author.name || "VectorFlow User");
    await repoGit.addConfig("user.email", author.email || "noreply@vectorflow");
    await repoGit.commit(commitMessage, filePath, {
      "--author": sanitizeAuthor(author.name, author.email),
    });
    await repoGit.push("origin", config.branch);

    const log = await repoGit.log({ maxCount: 1 });
    return { success: true, commitSha: log.latest?.hash };
  } catch (err) {
    const message = sanitizeError(err instanceof Error ? err.message : String(err));
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
    const repoDir = join(workdir, "repo");

    const git: SimpleGit = simpleGit(workdir);
    await git.clone(url, repoDir, ["--branch", config.branch, "--depth", "1", "--single-branch"]);
    const repoGit: SimpleGit = simpleGit(repoDir);

    const envDir = toFilenameSlug(environmentName);
    const filename = `${toFilenameSlug(pipelineName)}.yaml`;
    const filePath = join(envDir, filename);

    try {
      await repoGit.rm(filePath);
    } catch {
      // File not tracked in repo — nothing to delete
      return { success: true, commitSha: "no-file" };
    }

    await repoGit.addConfig("user.name", author.name || "VectorFlow User");
    await repoGit.addConfig("user.email", author.email || "noreply@vectorflow");
    await repoGit.commit(`Delete pipeline: ${pipelineName}`, filePath, {
      "--author": sanitizeAuthor(author.name, author.email),
    });
    await repoGit.push("origin", config.branch);

    const log = await repoGit.log({ maxCount: 1 });
    return { success: true, commitSha: log.latest?.hash };
  } catch (err) {
    const message = sanitizeError(err instanceof Error ? err.message : String(err));
    console.error("[git-sync] Delete failed:", message);
    return { success: false, error: message };
  } finally {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
