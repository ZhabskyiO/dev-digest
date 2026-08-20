#!/usr/bin/env bash
#
# List every insight already recorded across the repo, so a capture can check
# for duplicates before writing anything.
#
# READ-ONLY. This script only greps and prints — it never creates, edits, or
# deletes a file. server/clones/** is never read: those are vendored checkouts
# of other repositories and contain a full copy of this repo.
#
# Each module keeps an insights/ folder holding two halves of the same log:
#   insights/INSIGHTS.md  what works, codebase patterns, session notes, open questions
#   insights/gotchas.md   what doesn't work, tool & library quirks, error → cause → fix
#
# Usage:
#   list-entries.sh                 # every module
#   list-entries.sh server          # one module: root|client|server|reviewer-core|e2e|mcp-server

set -euo pipefail

# scripts/ -> engineering-insights/ -> skills/ -> .claude/ -> repo root
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

if [ ! -f "$ROOT/CLAUDE.md" ]; then
  echo "error: repo root not found (looked in $ROOT)" >&2
  exit 1
fi

DIRS=(insights client/insights server/insights \
      reviewer-core/insights e2e/insights mcp-server/insights)

if [ "$#" -gt 0 ]; then
  case "$1" in
    root)                                     DIRS=(insights) ;;
    client|server|reviewer-core|e2e|mcp-server) DIRS=("$1/insights") ;;
    *) echo "error: unknown module '$1' (use root|client|server|reviewer-core|e2e|mcp-server)" >&2
       exit 2 ;;
  esac
fi

FILES=()
for d in "${DIRS[@]}"; do
  FILES+=("$d/INSIGHTS.md" "$d/gotchas.md")
done

total=0

for rel in "${FILES[@]}"; do
  f="$ROOT/$rel"
  printf '\n== %s ==\n' "$rel"

  if [ ! -f "$f" ]; then
    echo "  (does not exist yet — create it from assets/insights-template.md)"
    continue
  fi

  # Three entry shapes coexist by design:
  #   "## YYYY-MM-DD — title"  entries written before the section format
  #   "- YYYY-MM-DD — claim"   entries written under one of the sections
  #   "YYYY-MM-DD — claim"     bare-paragraph entries (mcp-server's older style)
  awk '
    /^## [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
      print "  [earlier] " substr($0, 4); next
    }
    /^## / { section = substr($0, 4); next }
    /^[[:space:]]*- [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
      line = $0
      sub(/^[[:space:]]*- /, "", line)
      print "  [" section "] " line
      next
    }
    /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] / {
      print "  [" section "] " $0
    }
  ' "$f"

  n=$(grep -cE '^## [0-9]{4}-[0-9]{2}-[0-9]{2}|^[[:space:]]*- [0-9]{4}-[0-9]{2}-[0-9]{2}|^[0-9]{4}-[0-9]{2}-[0-9]{2} ' "$f" || true)
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
