#!/usr/bin/env bash
# verify-no-cloud-imports.sh — enforce the §15a / §16c boundary that no
# OSS source (anything under `src/`) imports from the closed `cloud/`
# workspace. Without this gate, a stray `import { ... } from "@vectorflow/
# cloud/..."` would pull AGPL-incompatible code into the AGPL build and
# contaminate the license boundary.
#
# Detection strategy:
#
#   1. Find every `.ts` / `.tsx` file under `src/` (OSS source).
#   2. Reject any module specifier that begins with `@vectorflow/cloud`,
#      `@cloud/`, or a relative path that escapes upward into `cloud/`
#      (`../cloud/`, `../../cloud/`, etc.).
#   3. Print the offending file:line:specifier and exit non-zero.
#
# Static-text matching is sufficient here because TypeScript module
# specifiers are string literals at parse time; an indirect import via
# dynamic `import(varName)` is not common in this codebase and would not
# typecheck against the cloud/ types anyway. We deliberately do NOT scan
# for variable-named imports — false positives ("the variable is named
# cloudClient") would block legitimate code.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

OSS_SRC="src"

# Patterns:
#   import ... from "@vectorflow/cloud"          (workspace package)
#   import ... from "@vectorflow/cloud/anything"
#   import ... from "@cloud/anything"            (workspace tsconfig alias)
#   import ... from "../../cloud/anything"       (relative escape)
#   import ... from "../cloud/anything"
#   dynamic import("@vectorflow/cloud...") variants too
#
# `grep -E` regex is anchored on the closing quote to avoid matching
# substrings like "@vectorflow/cloud-utils" if that ever existed.
pattern='from[[:space:]]+("|'"'"')(@vectorflow/cloud([/"'"'"']|$)|@cloud/|(\.\./)+cloud/)'
dynamic_pattern='import\(([[:space:]]*)("|'"'"')(@vectorflow/cloud([/"'"'"']|$)|@cloud/|(\.\./)+cloud/)'

found=0

# `find` with -prune to skip generated dirs that would bloat output.
files=$(
  find "$OSS_SRC" -type f \( -name "*.ts" -o -name "*.tsx" \) \
       -not -path "$OSS_SRC/generated/*" \
       -not -path "*/node_modules/*"
)

while IFS= read -r f; do
  hits=$(grep -nE "$pattern" "$f" || true)
  if [[ -n "$hits" ]]; then
    echo "FAIL  $f imports from cloud/:"
    echo "$hits" | sed 's/^/    /'
    found=$((found + 1))
  fi
  dhits=$(grep -nE "$dynamic_pattern" "$f" || true)
  if [[ -n "$dhits" ]]; then
    echo "FAIL  $f dynamic-imports from cloud/:"
    echo "$dhits" | sed 's/^/    /'
    found=$((found + 1))
  fi
done <<< "$files"

if [[ "$found" -gt 0 ]]; then
  cat <<MSG

verify-no-cloud-imports: $found file(s) import from the closed cloud/
workspace into OSS source. This is a §15a / §16c license-boundary
violation. AGPL OSS code MUST NOT depend on cloud/ artifacts.

To fix:
  - If the function belongs in OSS, move it from cloud/src/... to
    src/server/services/...
  - If the function is genuinely cloud-only, refactor the OSS caller
    to depend on an injection point (e.g. KmsProvider, QuotaPolicyProvider)
    that the cloud build registers at startup.
MSG
  exit 1
fi

echo "verify-no-cloud-imports: clean (no OSS source imports from cloud/)"
