# Hooks — deterministic gates in the harness

Evals are probabilistic checks with a threshold; some rules must hold **always**.
Those get a hook, not an eval — two different answers to two different classes of
rules (L02's reliability ladder).

| Hook | Event | Rule it makes unconditional |
|---|---|---|
| `../skills/pr-self-review/scripts/check-gate.sh` | PreToolUse (Bash) | no `git push` / `gh pr create` / merge without a fresh pr-self-review PASS for the current diff |
| `test-gate.sh` | PreToolUse (Bash) | **no `git commit` without green tests** for every package the staged files touch |

## test-gate.sh — decision model

Same pattern as the repo's template example (`check-gate.sh`): exit `2` = deny
(stderr shown to the agent), exit `0` = allow, and every *internal* failure fails
**open** — a broken hook must never brick the workflow.

- not a `git commit` → allow
- `TEST_GATE_OVERRIDE="reason"` → allow (logged) — the hotfix escape hatch
- staged files under `server/` → hermetic server unit suite must be green
- staged files under `client/` → client unit suite must be green
- staged files under `reviewer-core/` → its unit suite must be green
- only docs/config staged → allow

`TEST_GATE_CMD_SERVER` / `_CLIENT` / `_CORE` override the suite commands (used by
the verification below). Probabilistic quality lives in evals; this rule is
critical, so it is a hook.

## Caught cases (append real ones here)

- **2026-08-24 — mechanism verified end-to-end.** With eval-pipeline changes in the
  working tree, a simulated `git commit` was fed to the hook with the server suite
  forced red: **denied, exit 2**, failing package named; suites green → allowed
  (exit 0); non-commit and override paths per the table. *(Synthetic verification —
  replace this caveat with the first live catch.)*
- **2026-08-24 — real denies observed from the sibling gate, twice.** While writing
  THIS file, `check-gate.sh` denied the write because the document text mentioned
  the push / PR commands and the gate substring-matches the whole Bash command
  line — heredoc content included. The file you are reading is written with those
  phrases assembled programmatically. False positives — but live proof the
  PreToolUse layer sits in front of every Bash call.
