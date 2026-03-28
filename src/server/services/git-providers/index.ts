import type { GitProvider } from "./types";
import { GitHubProvider } from "./github";
import { GitLabProvider } from "./gitlab";

export type { GitProvider, GitWebhookEvent, CreatePROptions, RepoCoordinates } from "./types";

const providers: Record<string, GitProvider> = {
  github: new GitHubProvider(),
  gitlab: new GitLabProvider(),
};

/**
 * Detect the git provider from a repository URL domain.
 * Returns "github", "gitlab", or "bitbucket", or null if unknown.
 */
export function detectProvider(repoUrl: string): "github" | "gitlab" | "bitbucket" | null {
  try {
    // Handle SSH URLs
    if (repoUrl.startsWith("git@github.com")) return "github";
    if (repoUrl.startsWith("git@gitlab.com")) return "gitlab";
    if (repoUrl.startsWith("git@bitbucket.org")) return "bitbucket";

    const url = new URL(repoUrl);
    const host = url.hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host === "gitlab.com" || host.endsWith(".gitlab.com")) return "gitlab";
    if (host === "bitbucket.org" || host.endsWith(".bitbucket.org")) return "bitbucket";
  } catch {
    // Invalid URL
  }
  return null;
}

/**
 * Resolve the GitProvider for an environment. Uses the explicit gitProvider
 * field if set, otherwise auto-detects from gitRepoUrl.
 */
export function getProvider(env: {
  gitProvider?: string | null;
  gitRepoUrl?: string | null;
}): GitProvider | null {
  const providerName = env.gitProvider ?? (env.gitRepoUrl ? detectProvider(env.gitRepoUrl) : null);
  if (!providerName) return null;
  return providers[providerName] ?? null;
}

/**
 * Register a provider implementation. Used to add GitLab/Bitbucket.
 */
export function registerProvider(provider: GitProvider): void {
  providers[provider.name] = provider;
}
