import { prisma } from "@/lib/prisma";
import { fireEventAlert } from "./event-alerts";

const GITHUB_API = "https://api.github.com";
const SERVER_REPO = "TerrifiedBug/vectorflow";
const AGENT_REPO = "TerrifiedBug/vectorflow";
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (ETag keeps most checks free)

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

interface FetchResult {
  release: GitHubReleaseWithAssets | null;
  etag: string | null;
  notModified: boolean;
}

async function fetchRelease(
  url: string,
  etag?: string | null,
): Promise<FetchResult> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (etag) {
      headers["If-None-Match"] = etag;
    }
    const res = await fetch(url, { headers, next: { revalidate: 0 } });
    if (res.status === 304) {
      return { release: null, etag: etag ?? null, notModified: true };
    }
    if (!res.ok) return { release: null, etag: null, notModified: false };
    const newEtag = res.headers.get("etag");
    const release = await res.json();
    return { release, etag: newEtag, notModified: false };
  } catch {
    return { release: null, etag: null, notModified: false };
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
    const { release, etag, notModified } = await fetchRelease(
      `${GITHUB_API}/repos/${SERVER_REPO}/releases/latest`,
      settings?.latestServerReleaseEtag,
    );
    checkedAt = new Date();

    if (notModified) {
      // Nothing changed — just bump the check timestamp
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: { latestServerReleaseCheckedAt: checkedAt },
        create: { id: "singleton", latestServerReleaseCheckedAt: checkedAt },
      });
    } else if (release) {
      const previousVersion = latestVersion;
      latestVersion = release.tag_name.replace(/^v/, "");
      releaseUrl = release.html_url;
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: {
          latestServerRelease: latestVersion,
          latestServerReleaseCheckedAt: checkedAt,
          latestServerReleaseEtag: etag,
        },
        create: {
          id: "singleton",
          latestServerRelease: latestVersion,
          latestServerReleaseCheckedAt: checkedAt,
          latestServerReleaseEtag: etag,
        },
      });

      // Fire alert when a genuinely new version is detected
      if (
        latestVersion !== currentVersion &&
        latestVersion !== previousVersion &&
        currentVersion !== "dev"
      ) {
        // Version check is system-wide — fire for all environments
        prisma.environment.findMany({ where: { isSystem: false }, select: { id: true } })
          .then((envs) => {
            for (const env of envs) {
              void fireEventAlert("new_version_available", env.id, {
                message: `New VectorFlow version available: ${latestVersion}`,
              });
            }
          })
          .catch(() => {});
      }
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
    const { release, etag, notModified } = await fetchRelease(
      `${GITHUB_API}/repos/${AGENT_REPO}/releases/latest`,
      settings?.latestAgentReleaseEtag,
    );
    checkedAt = new Date();

    if (notModified) {
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: { latestAgentReleaseCheckedAt: checkedAt },
        create: { id: "singleton", latestAgentReleaseCheckedAt: checkedAt },
      });
      // Return cached checksums
      if (settings?.latestAgentChecksums) {
        try { checksums = JSON.parse(settings.latestAgentChecksums); } catch { /* ignore */ }
      }
    } else if (release) {
      latestVersion = release.tag_name.replace(/^v/, "");
      checksums = await fetchChecksums(release);
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: {
          latestAgentRelease: latestVersion,
          latestAgentReleaseCheckedAt: checkedAt,
          latestAgentReleaseEtag: etag,
          latestAgentChecksums: JSON.stringify(checksums),
        },
        create: {
          id: "singleton",
          latestAgentRelease: latestVersion,
          latestAgentReleaseCheckedAt: checkedAt,
          latestAgentReleaseEtag: etag,
          latestAgentChecksums: JSON.stringify(checksums),
        },
      });
    }
  } else if (settings?.latestAgentChecksums) {
    try { checksums = JSON.parse(settings.latestAgentChecksums); } catch { /* ignore */ }
  }

  return { latestVersion, checksums, checkedAt };
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
    const { release, etag, notModified } = await fetchRelease(
      `${GITHUB_API}/repos/${AGENT_REPO}/releases/tags/dev`,
      settings?.latestDevAgentReleaseEtag,
    );
    checkedAt = new Date();

    if (notModified) {
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: { latestDevAgentReleaseCheckedAt: checkedAt },
        create: { id: "singleton", latestDevAgentReleaseCheckedAt: checkedAt },
      });
      if (settings?.latestDevAgentChecksums) {
        try { checksums = JSON.parse(settings.latestDevAgentChecksums); } catch { /* ignore */ }
      }
    } else if (release) {
      const versionString = await fetchDevVersionString(release);
      if (versionString) {
        latestVersion = versionString;
        checksums = await fetchChecksums(release);
      }
      await prisma.systemSettings.upsert({
        where: { id: "singleton" },
        update: {
          latestDevAgentRelease: latestVersion,
          latestDevAgentReleaseCheckedAt: checkedAt,
          latestDevAgentReleaseEtag: etag,
          ...(versionString ? { latestDevAgentChecksums: JSON.stringify(checksums) } : {}),
        },
        create: {
          id: "singleton",
          latestDevAgentRelease: latestVersion,
          latestDevAgentReleaseCheckedAt: checkedAt,
          latestDevAgentReleaseEtag: etag,
          ...(versionString ? { latestDevAgentChecksums: JSON.stringify(checksums) } : {}),
        },
      });
    }
  } else if (settings?.latestDevAgentChecksums) {
    try { checksums = JSON.parse(settings.latestDevAgentChecksums); } catch { /* ignore */ }
  }

  return { latestVersion, checksums, checkedAt };
}
