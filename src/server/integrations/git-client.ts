import simpleGit, { type SimpleGit } from "simple-git";
import { mkdtemp, rm, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export interface GitConfig {
  repoUrl: string;
  branch: string;
  commitAuthor?: string;
  sshKey?: string;
  httpsToken?: string;
}

export interface GitWorkspace {
  git: SimpleGit;
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Clone a git repo into a temporary directory. Returns a workspace handle
 * with the simple-git instance, directory path, and a cleanup function.
 */
export async function cloneRepo(config: GitConfig): Promise<GitWorkspace> {
  const dir = await mkdtemp(join(tmpdir(), "vectorflow-gitops-"));

  // Determine the effective URL (inject HTTPS token if applicable)
  let effectiveUrl = config.repoUrl;

  if (config.httpsToken && config.repoUrl.startsWith("https://")) {
    // Inject token as password: https://oauth2:TOKEN@host/path
    const url = new URL(config.repoUrl);
    url.username = "oauth2";
    url.password = config.httpsToken;
    effectiveUrl = url.toString();
  }

  // Write SSH key to temp file if provided and URL is not HTTPS
  let sshKeyPath: string | undefined;
  if (config.sshKey && !config.repoUrl.startsWith("https://")) {
    sshKeyPath = join(dir, ".deploy-key");
    await writeFile(sshKeyPath, config.sshKey, { mode: 0o600 });
    await chmod(sshKeyPath, 0o600);
  }

  // Build environment variables for git
  const gitEnv: Record<string, string> = {};
  if (sshKeyPath) {
    gitEnv.GIT_SSH_COMMAND = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
  }

  const git = simpleGit({ baseDir: dir });

  // Set env before clone
  if (Object.keys(gitEnv).length > 0) {
    git.env(gitEnv);
  }

  await git.clone(effectiveUrl, dir, [
    "--branch",
    config.branch,
    "--single-branch",
    "--depth",
    "1",
  ]);

  // Re-initialize git in the cloned directory
  const repoGit = simpleGit({ baseDir: dir });

  // Preserve env for push operations
  if (Object.keys(gitEnv).length > 0) {
    repoGit.env(gitEnv);
  }

  if (config.commitAuthor) {
    const match = config.commitAuthor.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      await repoGit.addConfig("user.name", match[1].trim());
      await repoGit.addConfig("user.email", match[2].trim());
    } else {
      await repoGit.addConfig("user.name", config.commitAuthor);
      await repoGit.addConfig("user.email", "vectorflow@local");
    }
  } else {
    await repoGit.addConfig("user.name", "VectorFlow");
    await repoGit.addConfig("user.email", "vectorflow@company.com");
  }

  return {
    git: repoGit,
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Pull latest changes from remote.
 */
export async function pullLatest(workspace: GitWorkspace): Promise<void> {
  await workspace.git.pull();
}

/**
 * Stage a file, commit with the given message, and push to remote.
 */
export async function commitAndPush(
  workspace: GitWorkspace,
  filePath: string,
  message: string,
  branch: string,
): Promise<string> {
  await workspace.git.add(filePath);
  const result = await workspace.git.commit(message);
  await workspace.git.push("origin", branch);
  return result.commit;
}
