#!/usr/bin/env bash
# verify-no-cloud-context-leaks.sh — fail the build if forbidden internal-
# context tokens leak into committed source.
#
# The OSS repo MUST NOT advertise the closed-surface deployment model
# through comments, vendor names, or plan-section references. This gate
# enforces that contract automatically.
#
# Forbidden tokens (case-sensitive unless noted):
#   - "plan §<n>" / "plan §<n>.<m>" / "Plan §<n>" — internal plan refs
#   - "S15a", "S15b", "S16b cloud-<n>", "§16b" — section identifiers
#   - "vectorflow-cloud"                          — closed-surface workspace name
#   - "ops.vectorflow.sh"                         — operator surface
#   - "auth.vectorflow.sh"                        — auth surface
#   - "cloud.vectorflow.sh"                       — closed-surface domain
#   - "Resend"                                    — email-vendor decision
#   - "Postmark"                                  — email-vendor decision
#   - "BYOK"                                      — bring-your-own-key marker
#   - "kmsKeyArn", "byokKeyArn", "kmsGrantToken"  — pre-rename field names
#   - "stampId", "STAMP_ID", "VF_STAMP_ID"        — pre-rename identifiers
#
# Scope:
#   Checks every committed file under src/, prisma/, scripts/, charts/,
#   docker/, docs/, .github/workflows/, plus any root-level *.md file.
#
# Whitelist:
#   - Root-level public meta files that exist to inform contributors
#     about the boundary (LICENSE-CLOUD.md, SECURITY.md, CLA.md,
#     CONTRIBUTING.md, README.md, AGENTS.md) are exempt — they describe
#     the forbidden tokens by name.
#   - This script (`scripts/verify-no-cloud-context-leaks.sh`) itself
#     enumerates the tokens, so it's whitelisted from self-detection.
#   - Historical Prisma migrations created BEFORE the field rename are
#     allowed to reference the old column names — those are immutable
#     history that the rename migration converts at runtime.
#
# Exit code:
#   0 = no leakage
#   1 = at least one token found in a non-whitelisted file
#
# Usage:
#   ./scripts/verify-no-cloud-context-leaks.sh         # full sweep
#   ./scripts/verify-no-cloud-context-leaks.sh --diff  # only changed files
#                                                      # against origin/main
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Tokens that are ALWAYS forbidden, regardless of file.
ALWAYS_FORBIDDEN=(
  'plan §[0-9]+'
  'Plan §[0-9]+'
  '\bS15a\b'
  '\bS15b\b'
  'S16b cloud-[0-9]+'
  '§16b'
  'vectorflow-cloud'
  'ops\.vectorflow\.sh'
  'auth\.vectorflow\.sh'
  'cloud\.vectorflow\.sh'
  '\bResend\b'
  '\bPostmark\b'
  '\bBYOK\b'
)

# Post-rename tokens — forbidden in `src/` and `scripts/`, allowed in
# historical Prisma migrations (which carry the old names by design).
POST_RENAME_FORBIDDEN=(
  '\bkmsKeyArn\b'
  '\bbyokKeyArn\b'
  '\bkmsGrantToken\b'
  '\bstampId\b'
  '\bSTAMP_ID\b'
  '\bVF_STAMP_ID\b'
)

# Files always excluded — the gate's own definitions live in the script
# (it lists every forbidden token by name), and the root-level meta
# documents (LICENSE/SECURITY/CLA/CONTRIBUTING/README/AGENTS) are
# whitelisted because they describe the boundary contract for human
# contributors and necessarily mention the forbidden tokens.
WHITELIST=(
  "scripts/verify-no-cloud-context-leaks.sh"
  "LICENSE-CLOUD.md"
  "SECURITY.md"
  "CLA.md"
  "CONTRIBUTING.md"
  "README.md"
  "AGENTS.md"
)

is_whitelisted() {
  local f="$1"
  local w
  for w in "${WHITELIST[@]}"; do
    if [[ "$f" == "$w" ]]; then return 0; fi
  done
  return 1
}

# Paths to check. The gate runs in two phases (different exclusions per
# token group), so we don't pre-list files here. Root-level *.md files
# are added separately below so the pathspec stays anchored to top-level.
SEARCH_SCOPE=(src prisma scripts charts docker docs .github/workflows)

# Build the diff-only file list if --diff was passed.
USE_DIFF=0
if [[ "${1:-}" == "--diff" ]]; then
  USE_DIFF=1
fi

# Build the list of files to scan.
if [[ "$USE_DIFF" == "1" ]]; then
  ALL_FILES_RAW=$(git diff --name-only --diff-filter=ACMR origin/main...HEAD -- \
    "${SEARCH_SCOPE[@]}" 2>/dev/null || true)
  ROOT_MD_RAW=$(git diff --name-only --diff-filter=ACMR origin/main...HEAD 2>/dev/null \
    | awk -F/ 'NF==1 && /\.md$/' || true)
else
  ALL_FILES_RAW=$(git ls-files -- "${SEARCH_SCOPE[@]}")
  ROOT_MD_RAW=$(git ls-files | awk -F/ 'NF==1 && /\.md$/')
fi

if [[ -n "$ROOT_MD_RAW" ]]; then
  ALL_FILES_RAW="${ALL_FILES_RAW}"$'\n'"${ROOT_MD_RAW}"
fi

ALL_FILES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && ALL_FILES+=("$line")
done <<< "$ALL_FILES_RAW"

if [[ ${#ALL_FILES[@]} -eq 0 ]]; then
  echo "verify-no-cloud-context-leaks: nothing to scan."
  exit 0
fi

violations=0

scan_token() {
  local token="$1"
  shift
  local files=("$@")
  # `grep -E` extended regex; `-n` line numbers; `-H` always show filename.
  local hits
  hits=$(grep -EnH "$token" "${files[@]}" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    echo "FORBIDDEN: $token"
    echo "$hits" | sed 's/^/    /'
    echo
    return 1
  fi
  return 0
}

# Always-forbidden tokens scan every file EXCEPT the whitelist.
always_files=()
for f in "${ALL_FILES[@]}"; do
  if is_whitelisted "$f"; then continue; fi
  always_files+=("$f")
done

if [[ ${#always_files[@]} -gt 0 ]]; then
  for token in "${ALWAYS_FORBIDDEN[@]}"; do
    if ! scan_token "$token" "${always_files[@]}"; then
      violations=$((violations + 1))
    fi
  done
fi

# Post-rename tokens exclude the whitelist and historical migrations.
post_files=()
for f in "${ALL_FILES[@]}"; do
  if is_whitelisted "$f"; then continue; fi
  if [[ "$f" == prisma/migrations/* ]]; then continue; fi
  post_files+=("$f")
done

if [[ ${#post_files[@]} -gt 0 ]]; then
  for token in "${POST_RENAME_FORBIDDEN[@]}"; do
    if ! scan_token "$token" "${post_files[@]}"; then
      violations=$((violations + 1))
    fi
  done
fi

if [[ "$violations" -gt 0 ]]; then
  echo "✗ verify-no-cloud-context-leaks: ${violations} forbidden token group(s) found."
  echo "  Strip the leakage or whitelist the file in scripts/verify-no-cloud-context-leaks.sh."
  exit 1
fi

echo "✓ verify-no-cloud-context-leaks: ${#ALL_FILES[@]} file(s) scanned, no leakage."
exit 0
