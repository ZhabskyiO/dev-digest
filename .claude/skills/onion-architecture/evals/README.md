# onion-architecture — eval suite

Test cases and fixtures that measure whether this skill actually changes what a
model does. They ship **with** the skill so `package_skill.py` bundles them and
the suite travels wherever the skill is delivered.

> [!WARNING]
> **`fixtures/` is deliberately broken code.** Every file under it either plants a
> layering violation or acts as a correct-code control. It is test data, never a
> reference for how DevDigest is written. Read `../layer-map.md` for the real
> patterns.

## Layout

| Path | What |
|------|------|
| `evals.json` | the 4 test cases: prompt, fixture, expected output, assertions |
| `fixtures/` | the code under review — 3 planted violations per detection fixture |

Ground truth (`answer-keys/`), run output, gradings and benchmarks live **outside**
the skill, in `.claude/skill-evals/onion-architecture/`. Answer keys are kept out
deliberately: the with-skill arm of every A/B is pointed at this directory, so
keys stored here would leak into the runs being measured.

## The test cases

| # | Name | Kind | What it measures |
|---|------|------|------------------|
| 1 | notifications-module-review | detection | transport→DB, service→concrete adapter, cross-module import |
| 2 | reviewer-core-purity | detection | outward-pointing deps that survive a "no db/fs/SDK" check |
| 3 | codecov-adapter-wiring | detection | vendor-shaped port, adapter→module, transport→adapter |
| 4 | slack-summary-placement | placement | the canonical move: port → adapter → mock → container → service |

Each detection fixture also holds at least one **deliberately correct** control
file. A run that reports it has produced a false positive, which matters as much
as a miss: a skill that makes reviewers shout at legitimate `drizzle-orm` imports
in a repository is worse than no skill.

## Assertion tiers

`evals.json` assertions come in two kinds, and the distinction is load-bearing:

- **unprefixed** — ground-truth coverage of the planted violations. These are
  *expected* to pass in both arms. `server/CLAUDE.md` and `reviewer-core/CLAUDE.md`
  already state much of the dependency rule, and they load automatically, so a
  baseline run gets those findings without the skill.
- **`DISCRIMINATOR:`** — capability the module docs do **not** supply. These are
  the ones worth gating on. In iteration-1 the skill's entire measured advantage
  came from a single one: recognising that the `CodecovClient` *port itself* was
  vendor-shaped, which the baseline never saw.

A headline pass-rate delta across all assertions mostly measures the module docs.
Read the DISCRIMINATOR rows.

## Running

The suite is executed by the `skill-creator` skill, which spawns each test case
twice — once with this skill loaded, once without — then grades against the answer
keys and aggregates a benchmark. See
`.claude/skill-evals/onion-architecture/README.md` for the run procedure and the
known confounds.

## Editing fixtures

Two invariants, both easy to break by accident:

1. **No hint language.** Fixtures carry ordinary JSDoc describing what the code
   does, never a comment pointing at the planted problem. Verify with:
   ```bash
   grep -rniE 'violation|wrong|should not|TODO|FIXME|bug|anti-?pattern|onion|layer|leak|refactor|architect|must not' fixtures/
   ```
2. **Fidelity to the real codebase.** Fixtures imitate real signatures
   (`getContext(container, req)`, `GitHubClient.getPullRequest(RepoRef, n)`,
   SCREAMING_SNAKE_CASE secret keys). Unintended inaccuracies generate noise
   findings that dilute the signal — iteration-1 lost several assertions to
   exactly that. Check a signature before inventing one.
