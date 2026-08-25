#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — DETERMINISTIC commit gate: "never commit
# without green tests". Written to the same decision model as
# .claude/skills/pr-self-review/scripts/check-gate.sh (the repo's template
# example): exit 2 = deny (stderr shown to the agent), exit 0 = allow, and any
# INTERNAL error fails OPEN — a broken hook must never brick the workflow.
#
#   - command is not `git commit` ................ allow
#   - TEST_GATE_OVERRIDE set ..................... allow (logged, for hotfixes)
#   - staged changes touch server/ ............... run server unit tests (hermetic)
#   - staged changes touch client/ ............... run client unit tests (hermetic)
#   - staged changes touch reviewer-core/ ........ run its unit tests
#   - any suite fails ............................ deny with the failing package named
#   - nothing testable staged (docs, .claude/) ... allow
#
# Unlike an eval (probabilistic, threshold-scored), this rule must hold ALWAYS —
# that is why it is a hook and not an eval case.
set -uo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.command)||"")}catch{process.stdout.write("")}})' 2>/dev/null || echo "")"

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

if [ -n "${TEST_GATE_OVERRIDE:-}" ]; then
  echo "test-gate: overridden — reason: ${TEST_GATE_OVERRIDE}" >&2
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$ROOT" ] && exit 0  # fail-open: cannot locate the repo

# Staged files decide which package suites must be green.
staged="$(cd "$ROOT" && git diff --cached --name-only 2>/dev/null)"
[ -z "$staged" ] && staged="$(cd "$ROOT" && git diff --name-only HEAD 2>/dev/null)"  # commit -a
[ -z "$staged" ] && exit 0

run_suite() { # pkg, label, cmd
  local pkg="$1"
  local label="$2"
  local run="$3"
  echo "test-gate: staged changes in $pkg/ - running $label..." >&2
  if ! (cd "$ROOT/$pkg" && eval "$run") >/tmp/test-gate-$$.log 2>&1; then
    echo "test-gate: $pkg tests FAILED - commit blocked. Last 25 lines:" >&2
    tail -25 /tmp/test-gate-$$.log >&2
    rm -f /tmp/test-gate-$$.log
    echo "   Fix the tests (or TEST_GATE_OVERRIDE=reason for a genuine emergency)." >&2
    exit 2
  fi
  rm -f /tmp/test-gate-$$.log
}

if printf '%s\n' "$staged" | grep -q '^server/'; then
  run_suite server "hermetic unit tests" "${TEST_GATE_CMD_SERVER:-pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot}"
fi
if printf '%s\n' "$staged" | grep -q '^client/'; then
  run_suite client "unit tests" "${TEST_GATE_CMD_CLIENT:-pnpm exec vitest run --reporter=dot}"
fi
if printf '%s\n' "$staged" | grep -q '^reviewer-core/'; then
  run_suite reviewer-core "unit tests" "${TEST_GATE_CMD_CORE:-pnpm exec vitest run --reporter=dot}"
fi

echo "test-gate: green — commit allowed." >&2
exit 0
