#!/usr/bin/env bash
#
# DevDigest phase gate — the one full verification pass across every package.
#
#   ./scripts/verify.sh                  # typecheck + unit tests, all packages
#   ./scripts/verify.sh --it             # ...plus server integration tests (Docker, slow)
#   ./scripts/verify.sh server client    # only the named packages
#   ./scripts/verify.sh --verbose        # stream full output instead of per-check summaries
#
# Who runs this: the ORCHESTRATOR, once between phases of a plan and before
# /pr-self-review. Implementer agents must NOT run it — a project-wide typecheck
# fails on another implementer's in-flight file, and "iterate until green" then
# drags an agent outside its Owned paths. Implementers verify their own paths only
# (`pnpm exec vitest related --run <files> --reporter=dot`).
#
# Output is condensed on purpose: one PASS/FAIL line per check, full log only for
# failures, so the result stays cheap to read for an agent.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_IT=0
VERBOSE=0
SELECTED=()

for arg in "$@"; do
  case "$arg" in
    --it|--integration) RUN_IT=1 ;;
    --verbose|-v)       VERBOSE=1 ;;
    -h|--help)          sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)                 echo "unknown flag: $arg" >&2; exit 2 ;;
    *)                  SELECTED+=("$arg") ;;
  esac
done

# Node ≥22 — Next.js and dependency-cruiser both refuse to run below it.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "⛔ Node $NODE_MAJOR detected — this repo needs Node ≥22. Run 'nvm use' first." >&2
  exit 2
fi

LOGDIR="$(mktemp -d)"
trap 'rm -rf "$LOGDIR"' EXIT

FAILED=()
PASSED=0
SKIPPED=()

wanted() {
  [ ${#SELECTED[@]} -eq 0 ] && return 0
  local pkg="$1"
  for s in "${SELECTED[@]}"; do [ "$s" = "$pkg" ] && return 0; done
  return 1
}

# check <package-dir> <label> <command>
check() {
  local pkg="$1" label="$2" cmd="$3"
  local name="$pkg · $label"
  local log="$LOGDIR/${pkg//\//_}-${label// /_}.log"

  if [ ! -d "$ROOT/$pkg/node_modules" ]; then
    SKIPPED+=("$name — no node_modules (run 'cd $pkg && pnpm install')")
    printf '  ○ %-34s skipped (not installed)\n' "$name"
    return
  fi

  local start=$SECONDS
  if [ "$VERBOSE" -eq 1 ]; then
    ( cd "$ROOT/$pkg" && eval "$cmd" ) 2>&1 | tee "$log"
    local rc=${PIPESTATUS[0]}
  else
    ( cd "$ROOT/$pkg" && eval "$cmd" ) >"$log" 2>&1
    local rc=$?
  fi
  local secs=$(( SECONDS - start ))

  if [ $rc -eq 0 ]; then
    PASSED=$(( PASSED + 1 ))
    printf '  ✓ %-34s %ss\n' "$name" "$secs"
  else
    FAILED+=("$name")
    printf '  ✗ %-34s %ss\n' "$name" "$secs"
    if [ "$VERBOSE" -eq 0 ]; then
      echo "    ── last 40 lines ──"
      tail -40 "$log" | sed 's/^/    /'
      echo "    ───────────────────"
    fi
  fi
}

echo "DevDigest verify — $( [ $RUN_IT -eq 1 ] && echo 'typecheck + unit + integration' || echo 'typecheck + unit' )"
echo

if wanted server; then
  check server "typecheck" "pnpm typecheck"
  check server "unit" "pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot"
  [ $RUN_IT -eq 1 ] && check server "integration" "pnpm exec vitest run .it.test --reporter=dot"
fi

if wanted client; then
  check client "typecheck" "pnpm typecheck"
  check client "unit" "pnpm exec vitest run --reporter=dot"
fi

if wanted reviewer-core; then
  check reviewer-core "typecheck" "pnpm typecheck"
  check reviewer-core "unit" "pnpm exec vitest run --reporter=dot"
fi

# No test suite of its own — the type-check is the gate.
if wanted mcp-server; then
  check mcp-server "typecheck" "pnpm typecheck"
fi

# Browser flows are deliberately excluded: run ./scripts/e2e.sh for those.
if wanted e2e; then
  check e2e "typecheck" "pnpm typecheck"
fi

echo
if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "Skipped:"
  printf '  - %s\n' "${SKIPPED[@]}"
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "⛔ FAIL — ${#FAILED[@]} check(s): ${FAILED[*]}"
  echo "   ($PASSED passed. Browser e2e is not covered here — run ./scripts/e2e.sh separately.)"
  exit 1
fi

echo "✅ PASS — $PASSED check(s) green."
echo "   (Browser e2e is not covered here — run ./scripts/e2e.sh separately.)"
