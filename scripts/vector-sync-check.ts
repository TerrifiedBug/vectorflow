#!/usr/bin/env npx tsx
/**
 * vector-sync-check.ts
 *
 * Compares VectorFlow's local component catalog against Vector's upstream
 * GitHub repository. Detects added/removed components between the currently
 * pinned version and a target version, cross-references our catalog, and
 * produces a markdown upgrade-review report on stdout.
 *
 * Usage:
 *   npx tsx scripts/vector-sync-check.ts <target-version>
 *   npx tsx scripts/vector-sync-check.ts 0.53.0 > upgrade-review.md
 *
 * Set GITHUB_TOKEN env var for higher API rate limits.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CatalogEntry {
  type: string;
  kind: "source" | "transform" | "sink";
}

interface GitHubContentEntry {
  name: string;
  type: "file" | "dir";
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

type ComponentKind = "source" | "transform" | "sink";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

function log(msg: string) {
  process.stderr.write(`${msg}\n`);
}

function parseVersion(v: string): [number, number, number] {
  const parts = v.replace(/^v/, "").split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function versionGreaterThan(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

function versionLessThanOrEqual(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  return !versionGreaterThan(a, b);
}

// ---------------------------------------------------------------------------
// Read pinned version from Dockerfile
// ---------------------------------------------------------------------------

function readPinnedVersion(): string {
  const dockerfile = readFileSync(
    join(ROOT, "docker/server/Dockerfile"),
    "utf-8",
  );
  const match = dockerfile.match(/ARG\s+VECTOR_VERSION=(\S+)/);
  if (!match) {
    throw new Error(
      "Could not find ARG VECTOR_VERSION in docker/server/Dockerfile",
    );
  }
  return match[1];
}

// ---------------------------------------------------------------------------
// Read our local catalog via regex (avoids TS path-alias issues)
// ---------------------------------------------------------------------------

function readLocalCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  const extractTypes = (filePath: string, kind: ComponentKind) => {
    const content = readFileSync(filePath, "utf-8");
    // Match `type: "some_name"` at the top level of object literals in arrays.
    // We look for `type:` followed by a quoted string that represents the
    // component type name. Component type fields appear at 2-4 spaces indent.
    const re = /^\s{2,4}type:\s*"([a-z][a-z0-9_]*)"/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      entries.push({ type: m[1], kind });
    }
  };

  // Sources: multiple files under schemas/sources/
  const sourcesDir = join(ROOT, "src/lib/vector/schemas/sources");
  for (const file of readdirSync(sourcesDir)) {
    if (file.endsWith(".ts") && file !== "index.ts") {
      extractTypes(join(sourcesDir, file), "source");
    }
  }

  // Transforms: single file
  extractTypes(
    join(ROOT, "src/lib/vector/schemas/transforms.ts"),
    "transform",
  );

  // Sinks: multiple files under schemas/sinks/
  const sinksDir = join(ROOT, "src/lib/vector/schemas/sinks");
  for (const file of readdirSync(sinksDir)) {
    if (file.endsWith(".ts") && file !== "index.ts") {
      extractTypes(join(sinksDir, file), "sink");
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function ghFetch<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "vectorflow-sync-check/1.0",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} for ${url}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch component type names from the Vector repo for a given version and kind.
 */
async function fetchUpstreamComponents(
  version: string,
  kind: ComponentKind,
): Promise<string[]> {
  const kindPlural =
    kind === "source"
      ? "sources"
      : kind === "transform"
        ? "transforms"
        : "sinks";
  const url = `https://api.github.com/repos/vectordotdev/vector/contents/website/cue/reference/components/${kindPlural}?ref=v${version}`;

  log(`  Fetching ${kindPlural} for v${version}...`);
  const entries = await ghFetch<GitHubContentEntry[]>(url);

  return entries
    .filter((e) => e.type === "file" && e.name.endsWith(".cue"))
    .map((e) => e.name.replace(/\.cue$/, ""));
}

/**
 * Fetch all releases and filter to those between current (exclusive) and
 * target (inclusive).
 */
async function fetchReleaseNotes(
  currentVersion: string,
  targetVersion: string,
): Promise<GitHubRelease[]> {
  log("  Fetching releases...");
  const currentParsed = parseVersion(currentVersion);
  const targetParsed = parseVersion(targetVersion);

  // Paginate -- releases are sorted newest-first
  const allReleases: GitHubRelease[] = [];
  let page = 1;
  let keepGoing = true;

  while (keepGoing) {
    const url = `https://api.github.com/repos/vectordotdev/vector/releases?per_page=100&page=${page}`;
    const batch = await ghFetch<GitHubRelease[]>(url);
    if (batch.length === 0) break;

    for (const rel of batch) {
      const tag = rel.tag_name.replace(/^v/, "");
      const parsed = parseVersion(tag);

      // Skip pre-releases (e.g. 0.45.0-rc.1)
      if (tag.includes("-")) continue;

      // We want versions where current < version <= target
      if (
        versionGreaterThan(parsed, currentParsed) &&
        versionLessThanOrEqual(parsed, targetParsed)
      ) {
        allReleases.push(rel);
      }

      // If we have gone past the current version going backwards, stop
      if (
        !versionGreaterThan(parsed, currentParsed) &&
        !tag.includes("-")
      ) {
        keepGoing = false;
        break;
      }
    }
    page++;
  }

  // Sort chronologically (oldest first)
  allReleases.sort((a, b) => {
    const pa = parseVersion(a.tag_name);
    const pb = parseVersion(b.tag_name);
    if (pa[0] !== pb[0]) return pa[0] - pb[0];
    if (pa[1] !== pb[1]) return pa[1] - pb[1];
    return pa[2] - pb[2];
  });

  return allReleases;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function cleanReleaseBody(body: string | null): string {
  if (!body) return "_No release notes._";
  return body
    .replace(/\[View release notes\]\([^)]*\)/gi, "")
    .trim();
}

interface ComponentDiff {
  added: string[];
  removed: string[];
  gapsInCatalog: string[];
}

function computeDiff(
  currentUpstream: string[],
  targetUpstream: string[],
  ourTypes: Set<string>,
): ComponentDiff {
  const currentSet = new Set(currentUpstream);
  const targetSet = new Set(targetUpstream);

  const added = targetUpstream
    .filter((c) => !currentSet.has(c))
    .sort();
  const removed = currentUpstream
    .filter((c) => !targetSet.has(c))
    .sort();

  // Pre-existing gaps: in target upstream but not in our catalog
  // (excluding newly added -- those are covered in "added")
  const gapsInCatalog = targetUpstream
    .filter((c) => currentSet.has(c) && !ourTypes.has(c))
    .sort();

  return { added, removed, gapsInCatalog };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const targetVersion = process.argv[2];
  if (!targetVersion) {
    console.error(
      "Usage: npx tsx scripts/vector-sync-check.ts <target-version>",
    );
    console.error("Example: npx tsx scripts/vector-sync-check.ts 0.53.0");
    process.exit(1);
  }

  const currentVersion = readPinnedVersion();
  log(`Current pinned version: ${currentVersion}`);
  log(`Target version: ${targetVersion}`);

  // Read local catalog
  log("Reading local component catalog...");
  const catalog = readLocalCatalog();
  log(`  Found ${catalog.length} components in local catalog`);

  const ourSources = new Set(
    catalog.filter((c) => c.kind === "source").map((c) => c.type),
  );
  const ourTransforms = new Set(
    catalog.filter((c) => c.kind === "transform").map((c) => c.type),
  );
  const ourSinks = new Set(
    catalog.filter((c) => c.kind === "sink").map((c) => c.type),
  );

  // Fetch upstream component listings
  log("Fetching upstream component listings...");
  const [
    currentSources,
    currentTransforms,
    currentSinks,
    targetSources,
    targetTransforms,
    targetSinks,
  ] = await Promise.all([
    fetchUpstreamComponents(currentVersion, "source"),
    fetchUpstreamComponents(currentVersion, "transform"),
    fetchUpstreamComponents(currentVersion, "sink"),
    fetchUpstreamComponents(targetVersion, "source"),
    fetchUpstreamComponents(targetVersion, "transform"),
    fetchUpstreamComponents(targetVersion, "sink"),
  ]);

  // Compute diffs
  const sourcesDiff = computeDiff(currentSources, targetSources, ourSources);
  const transformsDiff = computeDiff(
    currentTransforms,
    targetTransforms,
    ourTransforms,
  );
  const sinksDiff = computeDiff(currentSinks, targetSinks, ourSinks);

  // Fetch release notes
  log("Fetching release notes...");
  const releases = await fetchReleaseNotes(currentVersion, targetVersion);
  log(`  Found ${releases.length} releases between versions`);

  // -----------------------------------------------------------------------
  // Build report
  // -----------------------------------------------------------------------

  const lines: string[] = [];
  const out = (s: string = "") => lines.push(s);

  out(`# Vector Upgrade Review: v${currentVersion} -> v${targetVersion}`);
  out();
  out(`> Generated: ${new Date().toISOString().split("T")[0]}`);
  out();

  // Section 1: Component Diff
  out("## 1. Component Diff");
  out();

  const renderDiffSection = (
    label: string,
    diff: ComponentDiff,
    ourTypes: Set<string>,
  ) => {
    out(`### ${label}`);
    out();

    if (diff.added.length > 0) {
      out("**Added in Vector:**");
      out();
      for (const c of diff.added) {
        const inCatalog = ourTypes.has(c);
        const mark = inCatalog ? "\u2705" : "\u26A0\uFE0F";
        const note = inCatalog
          ? "(already in our catalog)"
          : "(missing from our catalog)";
        out(`- ${mark} \`${c}\` ${note}`);
      }
      out();
    } else {
      out("**Added in Vector:** _none_");
      out();
    }

    if (diff.removed.length > 0) {
      out("**Removed from Vector:**");
      out();
      for (const c of diff.removed) {
        const inCatalog = ourTypes.has(c);
        const mark = inCatalog ? "\u26A0\uFE0F" : "\u2705";
        const note = inCatalog
          ? "(still in our catalog -- needs removal)"
          : "(not in our catalog)";
        out(`- ${mark} \`${c}\` ${note}`);
      }
      out();
    } else {
      out("**Removed from Vector:** _none_");
      out();
    }

    if (diff.gapsInCatalog.length > 0) {
      out("**In Vector but not in our catalog** (pre-existing gaps):");
      out();
      for (const c of diff.gapsInCatalog) {
        out(`- \`${c}\``);
      }
      out();
    } else {
      out("**In Vector but not in our catalog:** _none_ (full coverage)");
      out();
    }
  };

  renderDiffSection("Sources", sourcesDiff, ourSources);
  renderDiffSection("Transforms", transformsDiff, ourTransforms);
  renderDiffSection("Sinks", sinksDiff, ourSinks);

  // Section 2: Release Notes Rollup
  out("## 2. Release Notes Rollup");
  out();

  if (releases.length === 0) {
    out("_No releases found between these versions._");
    out();
  } else {
    for (const rel of releases) {
      const ver = rel.tag_name.replace(/^v/, "");
      out(`### [v${ver}](https://vector.dev/releases/${ver}/)`);
      out();
      out(cleanReleaseBody(rel.body));
      out();
      out("---");
      out();
    }
  }

  // Section 3: Upgrade Checklist
  out("## 3. Upgrade Checklist");
  out();
  out(
    `- [ ] Update \`ARG VECTOR_VERSION=${currentVersion}\` to \`${targetVersion}\` in \`docker/server/Dockerfile\``,
  );
  out(
    "- [ ] Add schema definitions for any new components marked with \u26A0\uFE0F above",
  );
  out(
    "- [ ] Remove schema definitions for any removed components marked with \u26A0\uFE0F above",
  );
  out(
    "- [ ] Review release notes for breaking changes to existing component configs",
  );
  out("- [ ] Update config generator if any config field names changed");
  out("- [ ] Run integration tests against the new Vector version");
  out("- [ ] Update `docker/server/docker-compose.dev.yml` if needed");
  out("- [ ] Test pipeline deployment end-to-end with the new binary");
  out();

  // Print report to stdout
  process.stdout.write(lines.join("\n"));
  log("\nDone. Report written to stdout.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
