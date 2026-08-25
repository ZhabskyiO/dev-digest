#!/usr/bin/env bash
#
# L06 Eval Pipeline — verify the regression-harness logic in one command.
#
#   ./scripts/verify-l06.sh
#
# The eval pipeline turns accept/dismiss decisions on real findings into eval
# cases and scores agent runs ENTIRELY IN CODE — recall / precision /
# citation_accuracy come from file + line-range matching, never from a model.
# This script proves that without opening the UI:
#
#   server/test/evals-scoring.test.ts   the scoring rules (must_find /
#                                       must_not_flag, range intersection,
#                                       metric formulas, degenerate batches),
#                                       decision→expectation mapping, diff
#                                       freezing, batch grouping.
#
#   client EvalsTab / EvalDashboardView / FindingCard tests
#                                       the Evals tab (tiles, cases, run
#                                       history, two-run compare), the /evals
#                                       dashboard, and the one-click
#                                       "Turn into eval case" button states.
#
# Both suites are hermetic: no database, no API, no browser, no network, no
# tokens. That the SCORER never calls a model is also asserted structurally
# below: modules/evals/scoring.ts must not reference any LLM surface.
#
# Needs `pnpm install` in server/ and client/ first (own lockfiles — not a
# workspace).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -t 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  GREEN=''; RED=''; BOLD=''; DIM=''; OFF=''
fi

server_status=0
client_status=0
purity_status=0

echo "${BOLD}L06 Eval Pipeline — scoring & UI checks${OFF}"
echo

echo "${BOLD}[1/3] scorer purity — no model call anywhere in scoring${OFF}"
echo "${DIM}      grep for LLM surfaces in server/src/modules/evals/scoring.ts${OFF}"
if grep -nE 'llm|LLM|completeStructured|openai|anthropic|openrouter' \
    "$ROOT/server/src/modules/evals/scoring.ts"; then
  echo "${RED}scoring.ts references an LLM surface — scoring must be pure code${OFF}"
  purity_status=1
else
  echo "  clean — scoring.ts is pure code (imports only shared types)"
fi
echo

echo "${BOLD}[2/3] server — scoring rules, metrics, batch grouping${OFF}"
echo "${DIM}      server/test/evals-scoring.test.ts${OFF}"
( cd "$ROOT/server" && pnpm exec vitest run test/evals-scoring.test.ts ) || server_status=$?
echo

echo "${BOLD}[3/3] client — Evals tab, dashboard, one-click case button${OFF}"
echo "${DIM}      EvalsTab / EvalDashboardView / FindingCard tests${OFF}"
( cd "$ROOT/client" && pnpm exec vitest run EvalsTab EvalDashboardView FindingCard ) || client_status=$?
echo

report() {
  if [ "$2" -eq 0 ]; then
    printf '  %sPASS%s  %s\n' "$GREEN" "$OFF" "$1"
  else
    printf '  %sFAIL%s  %s (exit %s)\n' "$RED" "$OFF" "$1" "$2"
  fi
}

echo "${BOLD}Summary${OFF}"
report "purity  scoring makes zero LLM calls" "$purity_status"
report "server  scoring rules, metrics, batch grouping" "$server_status"
report "client  Evals tab, dashboard, case button" "$client_status"
echo

if [ "$purity_status" -eq 0 ] && [ "$server_status" -eq 0 ] && [ "$client_status" -eq 0 ]; then
  echo "${GREEN}${BOLD}L06 Eval Pipeline: all checks passed.${OFF}"
  exit 0
fi

echo "${RED}${BOLD}L06 Eval Pipeline: checks FAILED.${OFF}" >&2
exit 1
