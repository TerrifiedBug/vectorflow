#!/usr/bin/env bash
# verify-no-cloud-context-leaks.sh — assert that no cloud-only references
# leak into the OSS source tree.
#
# VectorFlow Cloud closed-source additions live in a separate private
# repository (vectorflow-cloud). This script enforces the license boundary
# defined in LICENSE-CLOUD.md by failing CI on any of the following patterns:
#
#   §16b / cloud-N   — plan-section annotations referencing closed-source
#                       sections (should only ever appear in private docs)
#   STRIPE_           — Stripe billing env-var references
#   vectorflow-cloud/ — path references into the closed-source repo
#   @cloud/           — reserved closed-source import namespace
#
# Excluded paths (patterns appear legitimately):
#   This script itself — contains the patterns as string literals
#   docs/              — public docs may describe cloud features by design
#   *.md at repo root  — LICENSE-CLOUD.md, README.md, CONTRIBUTING.md, etc.
#   .git/, node_modules/, .next/
#
# Exit status:
#   0 — no leaks found
#   1 — at least one cloud-only reference found in OSS source

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$REPO_ROOT"

# Patterns that must NOT appear in OSS source files.
# Keep this list in sync with the header comment above.
PATTERNS=(
  '§16b'
  'cloud-[0-9]+'
  'STRIPE_'
  'vectorflow-cloud/'
  '@cloud/'
)

GREP_OPTS=(
  --recursive
  --line-number
  --extended-regexp
  --exclude-dir=.git
  --exclude-dir=node_modules
  --exclude-dir=.next
  --exclude-dir=docs
  --exclude="$SCRIPT_NAME"
)

# Combine all patterns into a single alternation for one grep pass
COMBINED="$(IFS='|'; echo "${PATTERNS[*]}")"

echo "verify-no-cloud-context-leaks: scanning OSS source..."
echo "  Patterns : ${PATTERNS[*]}"
echo "  Excluding: $SCRIPT_NAME, docs/, top-level *.md, .git, node_modules, .next"
echo

# Run the grep; suppress "no match" exit code with || true so the subshell
# doesn't trip set -e when nothing is found.
# grep output format (from repo root): ./path/to/file:N:content
# Filter out top-level *.md files afterwards — LICENSE-CLOUD.md and friends
# discuss the cloud/OSS boundary by design and must not cause false positives.
# Top-level matches look like ./README.md:N:... (basename only, one path
# component) which is what the grep -v pattern below targets.
raw_hits=$(grep "${GREP_OPTS[@]}" -E "$COMBINED" . 2>/dev/null || true)

hits=$(echo "$raw_hits" | grep -v '^\./[^/]*\.md:' || true)

# Strip any trailing blank lines that grep -v can leave
hits="${hits%$'\n'}"

if [[ -z "$hits" ]]; then
  echo "verify-no-cloud-context-leaks: passed. No cloud-only references found."
  exit 0
fi

echo "ERROR: cloud-only references detected in OSS source tree:"
echo
echo "$hits"
echo
echo "These strings must not appear in this public repository."
echo "See LICENSE-CLOUD.md for the cloud/OSS boundary definition."
exit 1
