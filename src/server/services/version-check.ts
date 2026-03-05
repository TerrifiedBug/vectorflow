import { prisma } from "@/lib/prisma";

const GITHUB_API = "https://api.github.com";
const SERVER_REPO = "TerrifiedBug/vectorflow";
const AGENT_REPO = "TerrifiedBug/vectorflow";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleaseWithAssets extends GitHubRelease {
  assets: GitHubAsset[];
}

async function fetchLatestRelease(
  repo: string,
): Promise<GitHubReleaseWithAssets | null> {
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

async function fetchChecksums(
  release: GitHubReleaseWithAssets,
): Promise<Record<string, string>> {
  const asset = release.assets.find((a) => a.name === "checksums.txt");
  if (!asset) return {};
  try {
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) return {};
    const text = await res.text();
    const checksums: Record<string, string> = {};
    for (const line of text.trim().split("\n")) {
      // Format: "<sha256hash>  <filename>"
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
      if (match) {
        checksums[match[2]] = match[1];
      }
    }
    return checksums;
  } catch {
    return {};
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
  checksums: Record<string, string>;
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
  let checksums: Record<string, string> = {};
  let checkedAt: Date | null = lastChecked ?? null;

  if (needsCheck) {
    const release = await fetchLatestRelease(AGENT_REPO);
    if (release) {
      latestVersion = release.tag_name.replace(/^v/, "");
      checksums = await fetchChecksums(release);
      checkedAt = new Date();
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: {
          latestAgentRelease: latestVersion,
          latestAgentReleaseCheckedAt: checkedAt,
          latestAgentChecksums: JSON.stringify(checksums),
        },
        create: {
          id: "singleton",
          latestAgentRelease: latestVersion,
          latestAgentReleaseCheckedAt: checkedAt,
          latestAgentChecksums: JSON.stringify(checksums),
        },
      });
    }
  } else if (settings?.latestAgentChecksums) {
    try { checksums = JSON.parse(settings.latestAgentChecksums); } catch { /* ignore */ }
  }

  return { latestVersion, checksums, checkedAt };
}

async function fetchDevRelease(): Promise<GitHubReleaseWithAssets | null> {
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${AGENT_REPO}/releases/tags/dev`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 0 },
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchDevVersionString(
  release: GitHubReleaseWithAssets,
): Promise<string | null> {
  const asset = release.assets.find((a) => a.name === "dev-version.txt");
  if (!asset) return null;
  try {
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

export async function checkDevAgentVersion(force = false): Promise<{
  latestVersion: string | null;
  checksums: Record<string, string>;
  checkedAt: Date | null;
}> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
  });

  const lastChecked = settings?.latestDevAgentReleaseCheckedAt;
  const needsCheck =
    force ||
    !lastChecked ||
    Date.now() - lastChecked.getTime() > CHECK_INTERVAL_MS;

  let latestVersion = settings?.latestDevAgentRelease ?? null;
  let checksums: Record<string, string> = {};
  let checkedAt: Date | null = lastChecked ?? null;

  if (needsCheck) {
    const release = await fetchDevRelease();
    if (release) {
      const versionString = await fetchDevVersionString(release);
      if (versionString) {
        latestVersion = versionString;
        checksums = await fetchChecksums(release);
        checkedAt = new Date();
        await prisma.systemSettings.upsert({
          where: { id: "singleton" },
          update: {
            latestDevAgentRelease: latestVersion,
            latestDevAgentReleaseCheckedAt: checkedAt,
            latestDevAgentChecksums: JSON.stringify(checksums),
          },
          create: {
            id: "singleton",
            latestDevAgentRelease: latestVersion,
            latestDevAgentReleaseCheckedAt: checkedAt,
            latestDevAgentChecksums: JSON.stringify(checksums),
          },
        });
      }
    }
  } else if (settings?.latestDevAgentChecksums) {
    try { checksums = JSON.parse(settings.latestDevAgentChecksums); } catch { /* ignore */ }
  }

  return { latestVersion, checksums, checkedAt };
}
