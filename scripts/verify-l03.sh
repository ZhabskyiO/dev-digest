#!/usr/bin/env bash
#
# L03 Smart Diff — verify the file-classification logic in one command.
#
#   ./scripts/verify-l03.sh
#
# Smart Diff sorts a PR's files into Core logic / Wiring / Boilerplate from path
# and filename patterns alone — pure logic, no model call. This script proves
# that grouping is right without opening the UI and clicking through PRs.
#
# It runs BOTH halves, because the behaviour spans two packages:
#
#   server/test/smart-diff.test.ts   WHICH GROUP a file lands in (a `.lock` file
#                                    or anything under `dist/` must be
#                                    Boilerplate), the findings-first ordering
#                                    inside a group, and the split suggestion.
#
#   client .../SmartDiffViewer.test.tsx   HOW the groups render — the lockfile
#                                    starts collapsed, the core file with a
#                                    finding starts expanded, badges jump to the
#                                    line.
#
# Both suites are hermetic: no database, no API, no browser, no network. Neither
# spends a token — Smart Diff never calls a model, and that is asserted here too.
#
# Exits 0 only if BOTH suites pass. A failure in one does not skip the other:
# the point is to see the whole picture in one run.
#
# Needs `pnpm install` in server/ and client/ first (each package has its own
# lockfile — this is not a workspace).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colour only when attached to a terminal, so piping to a file or CI log stays
# readable.
if [ -t 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  GREEN=''; RED=''; BOLD=''; DIM=''; OFF=''
fi

server_status=0
client_status=0

echo "${BOLD}L03 Smart Diff — classification checks${OFF}"
echo

echo "${BOLD}[1/2] server — which group each file lands in${OFF}"
echo "${DIM}      server/test/smart-diff.test.ts${OFF}"
( cd "$ROOT/server" && pnpm exec vitest run test/smart-diff.test.ts ) || server_status=$?
echo

echo "${BOLD}[2/2] client — how the groups render${OFF}"
echo "${DIM}      .../_components/SmartDiffViewer/SmartDiffViewer.test.tsx${OFF}"
( cd "$ROOT/client" && pnpm exec vitest run SmartDiffViewer ) || client_status=$?
echo

report() {
  if [ "$2" -eq 0 ]; then
    printf '  %sPASS%s  %s\n' "$GREEN" "$OFF" "$1"
  else
    printf '  %sFAIL%s  %s (exit %s)\n' "$RED" "$OFF" "$1" "$2"
  fi
}

echo "${BOLD}Summary${OFF}"
report "server  file classification, ordering, split suggestion" "$server_status"
report "client  group rendering, collapse/expand, finding badges" "$client_status"
echo

if [ "$server_status" -eq 0 ] && [ "$client_status" -eq 0 ]; then
  echo "${GREEN}${BOLD}L03 Smart Diff: all classification checks passed.${OFF}"
  exit 0
fi

echo "${RED}${BOLD}L03 Smart Diff: classification checks FAILED.${OFF}" >&2
exit 1
