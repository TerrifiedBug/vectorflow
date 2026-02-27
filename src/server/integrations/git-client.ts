import simpleGit, { type SimpleGit } from "simple-git";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export interface GitConfig {
  repoUrl: string;
  branch: string;
  commitAuthor?: string;
  sshKey?: string;
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

  const gitOptions: Record<string, string> = {};
  if (config.sshKey) {
    gitOptions["core.sshCommand"] = `ssh -i ${config.sshKey} -o StrictHostKeyChecking=no`;
  }

  const git = simpleGit({ baseDir: dir });

  await git.clone(config.repoUrl, dir, [
    "--branch",
    config.branch,
    "--single-branch",
    "--depth",
    "1",
  ]);

  // Re-initialize git in the cloned directory
  const repoGit = simpleGit({ baseDir: dir });

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
