/**
 * Side-by-side comparison of TWO artifacts that share the same cases — e.g. an agent and its
 * "lite" variant, or two skills answering the same prompts. Reads results/records.jsonl, keeps
 * the `candidate` records whose nodeid carries `agent:<name>` / `skill:<name>`, pairs them by
 * case label, and prints per-case pass · practices hit · tokens · duration · tool calls, then
 * totals with the delta (B relative to A). Uses every recorded run unless `--last` limits to the
 * most recent N runs of each side, or `--run <run_id>` pins one run.
 *
 *   pnpm eval:versus architecture-reviewer architecture-reviewer-lite
 *   pnpm eval:versus architecture-reviewer architecture-reviewer-lite --last 3
 *   pnpm eval:versus dependency-checker dependency-checker --run 20260823T040021   # sanity: same thing twice
 */
import { GREEN, RED, DIM, YELLOW, RESET } from "./ansi.js";
import { loadRecords, calcStats, type EvalRecord } from "./records/stats.js";

const args = process.argv.slice(2);
const [nameA, nameB] = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a) && !/^\d{8}T\d{6}$/.test(a));
const opt = (n: string) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const LAST = Number(opt("--last") ?? 0);
const RUN = opt("--run");

if (!nameA || !nameB) {
  console.error("usage: pnpm eval:versus <artifactA> <artifactB> [--last N] [--run <run_id>]");
  process.exit(1);
}

const isArtifact = (r: EvalRecord, name: string) =>
  new RegExp(`(agent|skill):${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} >`).test(r.nodeid);

function pick(name: string): EvalRecord[] {
  let rs = loadRecords().filter((r) => r.config === "candidate" && isArtifact(r, name));
  if (RUN) rs = rs.filter((r) => r.run_id === RUN);
  if (LAST > 0) {
    const runs = [...new Set(rs.map((r) => r.run_id))].sort().slice(-LAST);
    rs = rs.filter((r) => runs.includes(r.run_id));
  }
  return rs;
}

interface Side { pass: number; total: number; hit: number; practices: number; inTok: number; outTok: number; ms: number; tools: number; turns: number; runs: number }

function side(rs: EvalRecord[]): Side {
  const s: Side = { pass: 0, total: rs.length, hit: 0, practices: 0, inTok: 0, outTok: 0, ms: 0, tools: 0, turns: 0, runs: new Set(rs.map((r) => r.run_id)).size };
  for (const r of rs) {
    s.pass += r.outcome ? 1 : 0;
    s.hit += r.practices.filter((p) => p.passed).length;
    s.practices += r.practices.length;
    s.inTok += r.metrics.inputTokens; s.outTok += r.metrics.outputTokens; s.ms += r.metrics.durationMs;
    s.tools += r.metrics.toolCallCount; s.turns += r.num_turns;
  }
  return s;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");
const mean = (n: number, d: number) => (d ? n / d : 0);
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const delta = (a: number, b: number, lowerIsBetter: boolean) => {
  if (!a) return `${DIM}n/a${RESET}`;
  const d = ((b - a) / a) * 100;
  const good = lowerIsBetter ? d < 0 : d > 0;
  const col = Math.abs(d) < 1 ? DIM : good ? GREEN : RED;
  return `${col}${d > 0 ? "+" : ""}${d.toFixed(0)}%${RESET}`;
};

function main(): void {
  const A = pick(nameA!); const B = pick(nameB!);
  if (!A.length || !B.length) {
    console.error(`no candidate records for ${!A.length ? nameA : nameB}. Run its eval first (pnpm vitest run agents/<name> or skills/<name>).`);
    process.exit(1);
  }
  const labels = [...new Set([...A, ...B].map((r) => r.label))];
  console.log(`\n${"=".repeat(96)}\n${nameA}  vs  ${nameB}   ${DIM}(candidate records; A: ${new Set(A.map((r) => r.run_id)).size} run(s), B: ${new Set(B.map((r) => r.run_id)).size} run(s))${RESET}\n${"=".repeat(96)}`);
  console.log(`${"case".padEnd(44)} ${"pass A/B".padEnd(11)} ${"practices A/B".padEnd(15)} ${"in-tok A/B".padEnd(15)} ${"sec A/B".padEnd(12)} tools A/B`);
  for (const label of labels) {
    const a = side(A.filter((r) => r.label === label)); const b = side(B.filter((r) => r.label === label));
    const name = label.length > 42 ? label.slice(0, 41) + "…" : label;
    const passCol = (s: Side) => (s.total === 0 ? DIM : s.pass === s.total ? GREEN : s.pass === 0 ? RED : YELLOW);
    console.log(
      `${name.padEnd(44)} ${passCol(a)}${pct(a.pass, a.total).padEnd(5)}${RESET}${passCol(b)}${pct(b.pass, b.total).padEnd(6)}${RESET} ` +
      `${`${pct(a.hit, a.practices)}/${pct(b.hit, b.practices)}`.padEnd(15)} ` +
      `${`${fmtK(mean(a.inTok, a.total))}/${fmtK(mean(b.inTok, b.total))}`.padEnd(15)} ` +
      `${`${(mean(a.ms, a.total) / 1000).toFixed(0)}/${(mean(b.ms, b.total) / 1000).toFixed(0)}`.padEnd(12)} ` +
      `${mean(a.tools, a.total).toFixed(0)}/${mean(b.tools, b.total).toFixed(0)}`,
    );
  }
  const a = side(A); const b = side(B);
  console.log(`${"-".repeat(96)}`);
  console.log(`${"TOTAL".padEnd(44)} ${pct(a.pass, a.total).padEnd(5)}${pct(b.pass, b.total).padEnd(6)} ${`${pct(a.hit, a.practices)}/${pct(b.hit, b.practices)}`.padEnd(15)} ${`${fmtK(mean(a.inTok, a.total))}/${fmtK(mean(b.inTok, b.total))}`.padEnd(15)} ${`${(mean(a.ms, a.total) / 1000).toFixed(0)}/${(mean(b.ms, b.total) / 1000).toFixed(0)}`.padEnd(12)} ${mean(a.tools, a.total).toFixed(0)}/${mean(b.tools, b.total).toFixed(0)}`);
  console.log(`\n${nameB} relative to ${nameA}:`);
  console.log(`  pass rate      ${pct(a.pass, a.total)} -> ${pct(b.pass, b.total)}   ${delta(mean(a.pass, a.total), mean(b.pass, b.total), false)}`);
  console.log(`  practices hit  ${pct(a.hit, a.practices)} -> ${pct(b.hit, b.practices)}   ${delta(mean(a.hit, a.practices), mean(b.hit, b.practices), false)}`);
  console.log(`  input tokens   ${fmtK(mean(a.inTok, a.total))} -> ${fmtK(mean(b.inTok, b.total))}   ${delta(mean(a.inTok, a.total), mean(b.inTok, b.total), true)}   (per case, mean)`);
  console.log(`  output tokens  ${fmtK(mean(a.outTok, a.total))} -> ${fmtK(mean(b.outTok, b.total))}   ${delta(mean(a.outTok, a.total), mean(b.outTok, b.total), true)}`);
  console.log(`  duration       ${(mean(a.ms, a.total) / 1000).toFixed(0)}s -> ${(mean(b.ms, b.total) / 1000).toFixed(0)}s   ${delta(mean(a.ms, a.total), mean(b.ms, b.total), true)}`);
  console.log(`  tool calls     ${mean(a.tools, a.total).toFixed(1)} -> ${mean(b.tools, b.total).toFixed(1)}   ${delta(mean(a.tools, a.total), mean(b.tools, b.total), true)}`);
  console.log(`  turns          ${mean(a.turns, a.total).toFixed(1)} -> ${mean(b.turns, b.total).toFixed(1)}   ${delta(mean(a.turns, a.total), mean(b.turns, b.total), true)}`);
  const spreadA = calcStats(A.map((r) => r.metrics.inputTokens)); const spreadB = calcStats(B.map((r) => r.metrics.inputTokens));
  console.log(`\n${DIM}input-token spread — A: ${fmtK(spreadA.min)}…${fmtK(spreadA.max)}  B: ${fmtK(spreadB.min)}…${fmtK(spreadB.max)}. Both sides run on the same EVAL_MODEL; the agent's own model: frontmatter is not applied by the harness.${RESET}\n`);
}

main();
