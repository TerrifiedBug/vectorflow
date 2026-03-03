/**
 * Returns true if `current` is an older semver than `latest`.
 * Handles multi-digit segments correctly (e.g., "0.9.0" < "0.10.0").
 */
export function isVersionOlder(current: string, latest: string): boolean {
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
