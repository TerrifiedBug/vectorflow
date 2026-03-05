/**
 * Returns true if `current` is an older version than `latest`.
 *
 * For release versions: standard semver comparison.
 * For dev versions: true if SHAs differ (any difference = update available).
 * Cross-channel (dev vs release): always false.
 */
export function isVersionOlder(current: string, latest: string): boolean {
  const currentIsDev = current.startsWith("dev-");
  const latestIsDev = latest.startsWith("dev-");

  // Plain "dev" (local build, no SHA) — not trackable
  if (current === "dev" || latest === "dev") return false;

  // Cross-channel: never suggest updates
  if (currentIsDev !== latestIsDev) return false;

  // Dev-to-dev: different SHA means update available
  if (currentIsDev && latestIsDev) {
    return current !== latest;
  }

  // Release-to-release: semver comparison
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}
