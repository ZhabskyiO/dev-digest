# Severity rubric & finding catalog

Tiers answer one question: **what happens if nobody acts?** Not "how big is the number".

| Tier | If nobody acts… | Time horizon |
|------|-----------------|--------------|
| **P0** | something is already wrong or exploitable in shipped code: requests can fail, an attacker has a known path, an enforced boundary is breached | before the next merge / release |
| **P1** | a structural risk compounds: the next refactor or upgrade breaks something, or waste ships in prod | this sprint |
| **P2** | hygiene debt grows: upgrades get harder, CI gets slower, the next audit has more noise | batch into a maintenance PR |
| **Info** | nothing — the reader is better informed | none |

Tie-breakers inside a tier: prod before dev; runtime libraries crossing a package boundary before
leaf libraries; bigger quantified gain first.

Two rules that decide most borderline calls:

- **Several catalog rows apply → the highest tier wins.** A relative import is P1 on its own, but
  a relative import *from the pure core into a server I/O adapter* also matches the "inward →
  outward through an enforced boundary" row, so it is P0. Say which row lifted it.
- **Severity of an advisory ≠ tier of the finding.** A *critical* advisory reachable only through
  dev dependencies is P1 — it never ships, it lives in the CI supply chain. A *high* advisory in
  a prod dependency is P0. Prod reachability, not the CVSS word, sets the tier.

## Finding catalog

| Category | Signal (from the script or by hand) | Default tier | Typical fix | Effort |
|----------|-------------------------------------|--------------|-------------|--------|
| **Internal coupling** | relative import into another package (`../server/src/…`) | P1 | import through the alias / public entry; if there is none, add an `index.ts` export | S |
| | alias sub-path import bypassing an entry point (`@devdigest/reviewer-core/src/x`) | P1 | re-export from the package index, import the index | S |
| | edge pointing *inward→outward* through an enforced boundary (pure core importing I/O, `reviewer-core` → `server` adapters) | P0 | move the type/contract to the shared package; see onion-architecture | M |
| | vendored copies of shared code differ | P0 | diff the copies, re-sync from the canonical one, add a sync check to CI | S–M |
| **Duplication & drift** | same dep, different *installed* versions, and it's a runtime lib shared across a boundary (zod, a schema lib, a client SDK) | P1 | pin the same range everywhere, reinstall, add a drift check | S |
| | same dep, different declared ranges, same installed version | P2 | align ranges so the next `install` doesn't diverge | S |
| | dev-tool drift (typescript, vitest, tsx, @types/node) | P2 (Info if patch-level) | align in one maintenance PR | S |
| | two packages doing the same job in one package (`moment` + `date-fns`, `axios` + `fetch` wrapper, two markdown parsers) | P2 | pick one, migrate call sites | M |
| **Dead weight** | `unreferenced` **prod** dependency with no framework/bin/config explanation | P1 | `pnpm remove` after confirming no dynamic use | S |
| | `unreferenced` **dev** dependency | P2 | remove | S |
| | dep declared but not installed (lockfile out of date) | P1 | reinstall / fix lockfile | S |
| **Size** | single prod dep > 25 % of the package's node_modules or > 100 MB transitive | P2 | lighter alternative, lazy `import()`, or accept with a note | M–L |
| | dev-only weight dominating (> 60 % of node_modules) | Info | note it; affects CI/install time only | — |
| | heavy dep used in one file for one function | P2 | replace with a small util or native API | S–M |
| **Hygiene** | deprecated package | P1 | migrate to the successor named in the deprecation | S–M |
| | major-version bump available for a prod dep | P2 | plan the upgrade; link the changelog | M |
| | minor/patch bumps | Info | batch update | S |
| **Security** | critical/high advisory reachable from a **prod** dependency | P0 | update the top-level dep named in the advisory path; if unfixable, document the override | S–M |
| | critical/high advisory only via **dev** deps | P1 | update; lower real-world exposure but still in the CI supply chain | S |
| | moderate/low advisory | P2 | batch | S |
| **Licensing** | copyleft (GPL/AGPL/LGPL) or unknown licence in a prod dep of a distributed artifact | P1 | confirm obligations or replace | M |
| | same, dev-only | Info | note | — |
| **Graph health** | cycle within one module (`helpers ↔ repository`) | P2 | extract the shared piece | S–M |
| | cycles through a DI composition root (`container ↔ service`) | Info | accepted trade-off of the style; mention once | — |
| | hub file with very high fan-in (a `schema.ts` or `index.ts` everyone imports) | Info | fine unless it drags I/O into pure code | — |

When a signal isn't in this table, place it by the "if nobody acts" question above and say in
the finding that you classified it by judgement.

## Manual collection (when the script can't run)

Use this when the repo isn't on a filesystem you can execute in, or the prompt already contains
the data. Gather per package; mark anything you couldn't get as `not measured` in Scope.

```bash
# declared deps by type
jq '{dependencies, devDependencies, peerDependencies}' <pkg>/package.json
# installed versions (pnpm) — note the realpath under .pnpm for sizing
pnpm --dir <pkg> ls --json --depth 0
# sizes: follow the symlink, or du the .pnpm path
du -skL <pkg>/node_modules/<dep>
# usage — imports, then bins in scripts, then config files by name
grep -rn --include='*.ts' --include='*.tsx' -E "from ['\"]<dep>(/|['\"])" <pkg>/src
grep -n '"scripts"' -A20 <pkg>/package.json
grep -l '<dep>' <pkg>/*.config.* <pkg>/*.json
# internal edges + deep imports
jq '.compilerOptions.paths' <pkg>/tsconfig.json
grep -rn --include='*.ts' -E "from ['\"]\.\./(server|client|reviewer-core|mcp-server)/" <pkg>/src
# vendored copies
diff -rq server/src/vendor/shared client/src/vendor/shared
# hygiene / security / licences (exit 1 when findings exist — that's normal)
pnpm --dir <pkg> outdated --format json
pnpm --dir <pkg> audit --json
pnpm --dir <pkg> licenses list --json
# cycles (if madge or dependency-cruiser is installed)
madge --circular --extensions ts,tsx --ts-config <pkg>/tsconfig.json <pkg>/src
```

Even with partial data the report keeps all five sections; a finding can be `evidence: reported
by user` when the prompt supplied the fact.
