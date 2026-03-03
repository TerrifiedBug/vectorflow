import { prisma } from "@/lib/prisma";

const GITHUB_API = "https://api.github.com";
const SERVER_REPO = "terrifiedbug/vectorflow-server";
const AGENT_REPO = "terrifiedbug/vectorflow-agent";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
}

async function fetchLatestRelease(
  repo: string,
): Promise<GitHubRelease | null> {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github.v3+json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function checkServerVersion(force = false): Promise<{
  latestVersion: string | null;
  currentVersion: string;
  updateAvailable: boolean;
  releaseUrl?: string;
  checkedAt: Date | null;
}> {
  const currentVersion = process.env.VF_VERSION ?? "dev";
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
  });

  const lastChecked = settings?.latestServerReleaseCheckedAt;
  const needsCheck =
    force ||
    !lastChecked ||
    Date.now() - lastChecked.getTime() > CHECK_INTERVAL_MS;

  let latestVersion = settings?.latestServerRelease ?? null;
  let releaseUrl: string | undefined;
  let checkedAt: Date | null = lastChecked ?? null;

  if (needsCheck) {
    const release = await fetchLatestRelease(SERVER_REPO);
    if (release) {
      latestVersion = release.tag_name.replace(/^v/, "");
      releaseUrl = release.html_url;
      checkedAt = new Date();
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: {
          latestServerRelease: latestVersion,
          latestServerReleaseCheckedAt: checkedAt,
        },
        create: {
          id: "singleton",
          latestServerRelease: latestVersion,
          latestServerReleaseCheckedAt: checkedAt,
        },
      });
    }
  }

  // Reconstruct releaseUrl on cache hit
  if (latestVersion && !releaseUrl) {
    releaseUrl = `https://github.com/${SERVER_REPO}/releases/tag/v${latestVersion}`;
  }

  return {
    latestVersion,
    currentVersion,
    updateAvailable:
      !!latestVersion &&
      latestVersion !== currentVersion &&
      currentVersion !== "dev",
    releaseUrl,
    checkedAt,
  };
}

export async function checkAgentVersion(force = false): Promise<{
  latestVersion: string | null;
  checkedAt: Date | null;
}> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
  });

  const lastChecked = settings?.latestAgentReleaseCheckedAt;
  const needsCheck =
    force ||
    !lastChecked ||
    Date.now() - lastChecked.getTime() > CHECK_INTERVAL_MS;

  let latestVersion = settings?.latestAgentRelease ?? null;
  let checkedAt: Date | null = lastChecked ?? null;

  if (needsCheck) {
    const release = await fetchLatestRelease(AGENT_REPO);
    if (release) {
      latestVersion = release.tag_name.replace(/^v/, "");
      checkedAt = new Date();
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: {
          latestAgentRelease: latestVersion,
          latestAgentReleaseCheckedAt: checkedAt,
        },
        create: {
          id: "singleton",
          latestAgentRelease: latestVersion,
          latestAgentReleaseCheckedAt: checkedAt,
        },
      });
    }
  }

  return { latestVersion, checkedAt };
}
