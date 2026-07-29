#!/usr/bin/env bash
#
# List every insight already recorded across the repo, so a capture can check
# for duplicates before writing anything.
#
# READ-ONLY. This script only greps and prints — it never creates, edits, or
# deletes a file. server/clones/** is never read: those are vendored checkouts
# of other repositories and contain a full copy of this repo.
#
# Usage:
#   list-entries.sh                 # every module
#   list-entries.sh server          # one module: root|client|server|reviewer-core|e2e

set -euo pipefail

# scripts/ -> engineering-insights/ -> skills/ -> .claude/ -> repo root
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

if [ ! -f "$ROOT/CLAUDE.md" ]; then
  echo "error: repo root not found (looked in $ROOT)" >&2
  exit 1
fi

FILES=(insights.md client/insights.md server/insights.md \
       reviewer-core/insights.md e2e/insights.md)

if [ "$#" -gt 0 ]; then
  case "$1" in
    root)                          FILES=(insights.md) ;;
    client|server|reviewer-core|e2e) FILES=("$1/insights.md") ;;
    *) echo "error: unknown module '$1' (use root|client|server|reviewer-core|e2e)" >&2
       exit 2 ;;
  esac
fi

total=0

for rel in "${FILES[@]}"; do
  f="$ROOT/$rel"
  printf '\n== %s ==\n' "$rel"

  if [ ! -f "$f" ]; then
    echo "  (does not exist yet — create it from assets/insights-template.md)"
    continue
  fi

  # Two entry shapes coexist by design:
  #   "## YYYY-MM-DD — title"  entries written before the section format
  #   "- YYYY-MM-DD — claim"   entries written under one of the 7 sections
  awk '
    /^## [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
      print "  [earlier] " substr($0, 4); next
    }
    /^## / { section = substr($0, 4); next }
    /^[[:space:]]*- [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
      line = $0
      sub(/^[[:space:]]*- /, "", line)
      print "  [" section "] " line
    }
  ' "$f"

  n=$(grep -cE '^## [0-9]{4}-[0-9]{2}-[0-9]{2}|^[[:space:]]*- [0-9]{4}-[0-9]{2}-[0-9]{2}' "$f" || true)
  if [ "$n" -eq 0 ]; then
    echo "  (no entries yet)"
  fi
  total=$((total + n))
done

printf '\n-- %d entries total --\n' "$total"

if [ "$total" -ge 30 ]; then
  printf 'NOTE: at or over the ~30-entry guideline. Report consolidation\n'
  printf 'candidates to the human. Do NOT delete or rewrite anything.\n'
fi

exit 0
