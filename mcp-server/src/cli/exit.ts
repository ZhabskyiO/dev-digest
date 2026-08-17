/**
 * The CLI's exit-code contract. Scripts and git hooks branch on these, so they
 * are defined once, here, and documented verbatim in `--help` and the README.
 *
 *   0  OK          — the review ran and nothing tripped the gate. Also the code
 *                    when there was nothing to review (a clean working tree is
 *                    a pass, not an error).
 *   1  BLOCKED     — the review ran and found blocking findings, i.e. at least
 *                    one finding at or above the gate (`--fail-on`, else the
 *                    agent's own `ci_fail_on`). This is the ONLY code that
 *                    means "the code has a problem".
 *   2  USAGE       — the command was wrong: unknown flag, unknown or
 *                    unimplemented `--mode`, bad `--fail-on` value.
 *   3  UNAVAILABLE — the review could not be performed at all: not a git repo,
 *                    git failed, the API is down or errored, no usable agent,
 *                    timeout. Nothing is known about the code.
 *
 * The split between 1 and 3 is the point: a pre-push hook must be able to tell
 * "the reviewer says no" from "the reviewer never ran", and only ever block a
 * developer on the first.
 */
export const EXIT = {
  OK: 0,
  BLOCKED: 1,
  USAGE: 2,
  UNAVAILABLE: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
