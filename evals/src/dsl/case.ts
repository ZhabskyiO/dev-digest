/**
 * Case types + the runners that turn a data array into vitest tests. This module owns the ONE
 * true measure → (log) → assert body, so case authors never rewrite it — which is exactly what
 * keeps the "assert before record" bug from recurring once record() lands (T2 slots into the
 * marked spot below, in this one file).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_THRESHOLD, EVAL_BACKEND, EVAL_MODEL } from "../config.js";
import { skillTask, agentTask, workflowTask } from "../tasks.js";
import { runClaude, type Result, type RunOptions } from "../runtime/run-claude.js";
import { patternMatch } from "../scoring/pattern-match.js";
import { llmJudge, type Verdict } from "../scoring/llm-judge.js";
import { logTrace, logVerdict } from "../logging/log.js";
import { record } from "../records/record.js";
import { REPO_ROOT } from "../artifacts/paths.js";

// --- Case shapes ------------------------------------------------------------

/** A judge-and-grounding case. Same shape for skills and agents; only the task differs. */
export interface QualityCase {
  name: string;
  kind?: "quality" | "grounding";
  prompt: string;
  /** Practices the judge scores (quality). Omit for a pure grounding case. */
  practices?: string[];
  /** Substrings that must ALL appear before the judge runs (cheap-tier gate). */
  grounding?: string[];
  /** Judge score gate (default 0.6). */
  threshold?: number;
  maxTurns?: number;
}
export type SkillCase = QualityCase;
export type AgentCase = QualityCase;

/** A trace-asserted workflow case — a discriminated union routed by `kind`. */
export type WorkflowCase =
  | { kind: "dispatch"; name: string; prompt: string; expectSubagent: string; maxTurns?: number }
  | {
      kind: "activation";
      name: string;
      prompt: string;
      skill: string;
      shouldActivate: boolean;
      /**
       * Behaviour-shaped: asserts the model invokes the Skill TOOL. Some cheap non-Anthropic
       * models answer from general knowledge instead (measured: gemini-2.5-flash 0/2 on the
       * onion-architecture positive). An indicative case is skipped — with a visible reason —
       * when EVAL_BACKEND=openrouter and the model is not anthropic/*, unless EVAL_RUN_INDICATIVE=1.
       */
      indicative?: boolean;
      maxTurns?: number;
    }
  | {
      kind: "contrast";
      name: string;
      prompt: string;
      expectFileRead: string;
      tools?: string[];
      maxTurns?: number;
    }
  | {
      // A single-session composite: run ONE workflowTask and assert several trace facets at once.
      // Cheaper than separate dispatch/activation/contrast cases (one session, not N) at the cost
      // of coarser diagnostics and no control run — use contrast when you must isolate CLAUDE.md's
      // contribution. Every provided expectation must hold; omitted fields are not checked.
      kind: "trace";
      name: string;
      prompt: string;
      /** Every one of these must be dispatched. */
      expectSubagents?: string[];
      /** At least ONE of these must be dispatched — for roles served by interchangeable agents. */
      expectAnySubagent?: string[];
      expectSkills?: string[];
      /**
       * Substring match against every `Read` path. Prefix with `./` to anchor at the repo root
       * (`./README.md` matches only the root README, not `server/README.md`).
       */
      expectFilesRead?: string[];
      /** No `Read` path may match any of these (same matching rules). Disables early stop. */
      expectFilesNotRead?: string[];
      /** Substrings that must ALL appear in the final answer (case-insensitive). Disables early stop. */
      expectOutput?: string[];
      /** Substrings that must NOT appear in the final answer (case-insensitive). Disables early stop. */
      expectOutputNot?: string[];
      maxTurns?: number;
    };

/**
 * Does a recorded `Read` path satisfy a file expectation? Plain strings are substrings; a `./`
 * prefix anchors the rest at REPO_ROOT so `./README.md` cannot be satisfied by a nested README.
 */
export function readMatches(read: string, expected: string): boolean {
  if (!expected.startsWith("./")) return read.includes(expected);
  const rel = expected.slice(2);
  return read === join(REPO_ROOT, rel) || read === rel;
}

/** Did a skill engage? Either an explicit Skill tool-call, or reading its SKILL.md. */
export function activated(result: Result, skill: string): boolean {
  const bySkill = result.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`));
  const byRead = result.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
  return bySkill || byRead;
}

// --- Runners ----------------------------------------------------------------

type Task = (prompt: string, artifact: string, opts?: RunOptions) => Promise<Result>;

function runQualityCases(artifact: string, cases: QualityCase[], task: Task): void {
  for (const c of cases) {
    test(c.name, async () => {
      const threshold = c.threshold ?? DEFAULT_THRESHOLD;
      const result = await task(c.prompt, artifact, { maxTurns: c.maxTurns });
      logTrace(c.name, result);

      // measure → record → assert. Everything measurable runs in the try; record() fires in the
      // finally with whatever accumulated; the asserts happen strictly after. A failing config
      // (e.g. baseline: grounding gate fails, judge skipped) still leaves a record.
      let grounded: number | undefined;
      let verdict: Verdict | undefined;
      try {
        // Cheap deterministic tier first — the grounding gate. When it fails the judge is skipped.
        if (c.grounding?.length) grounded = patternMatch(result.text, c.grounding);
        if (c.practices?.length && (grounded === undefined || grounded === 1)) {
          verdict = await llmJudge(result.text, c.practices);
          logVerdict(c.name, verdict);
        }
      } finally {
        record(c.name, { result, verdict, grounded, threshold });
      }

      if (grounded !== undefined) {
        expect(grounded, `missing concrete evidence; output:\n${result.text}`).toBe(1);
      }
      if (verdict) {
        expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
      }
    });
  }
}

export const runSkillCases = (skill: string, cases: SkillCase[]) => runQualityCases(skill, cases, skillTask);
export const runAgentCases = (agent: string, cases: AgentCase[]) => runQualityCases(agent, cases, agentTask);

/** Indicative cases only assert on a capable model: the Anthropic path, or an anthropic/* slug. */
function skipIndicative(c: WorkflowCase): string | null {
  if (c.kind !== "activation" || !c.indicative) return null;
  if (process.env.EVAL_RUN_INDICATIVE === "1") return null;
  if (EVAL_BACKEND !== "openrouter" || EVAL_MODEL.startsWith("anthropic/")) return null;
  return `indicative activation case — skipped on ${EVAL_MODEL} (set EVAL_RUN_INDICATIVE=1 to run)`;
}

export function runWorkflowCases(cases: WorkflowCase[]): void {
  for (const c of cases) {
    const skip = skipIndicative(c);
    if (skip) {
      test.skip(`${c.name} [${skip}]`, () => {});
      continue;
    }
    test(c.name, async () => {
      if (c.kind === "dispatch") {
        // Stop the moment the subagent is launched — no need to wait out its nested session.
        const expect1 = c.expectSubagent;
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: (p) => p.subagents.includes(expect1),
        });
        logTrace(c.name, result);
        try {
          expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(c.expectSubagent);
        } finally {
          record(c.name, { result });
        }
      } else if (c.kind === "activation") {
        const result = await workflowTask(c.prompt, { maxTurns: c.maxTurns });
        logTrace(c.name, result);
        try {
          expect(
            activated(result, c.skill),
            `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
          ).toBe(c.shouldActivate);
        } finally {
          record(c.name, { result });
        }
      } else if (c.kind === "trace") {
        // One session, many asserts — every provided expectation is checked against the same trace.
        // Stop as soon as ALL expectations are satisfied (e.g. doc read + subagent launched), so a
        // dispatch-bearing trace doesn't pay for the nested subagent's full run.
        const subs = c.expectSubagents ?? [];
        const anySub = c.expectAnySubagent ?? [];
        const skls = c.expectSkills ?? [];
        const files = c.expectFilesRead ?? [];
        const notFiles = c.expectFilesNotRead ?? [];
        const outYes = c.expectOutput ?? [];
        const outNo = c.expectOutputNot ?? [];
        const skillEngaged = (p: { skillsInvoked: string[]; filesRead: string[] }, skill: string) =>
          p.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`)) ||
          p.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
        // Negative and output expectations are only meaningful on a COMPLETE session: a read of a
        // forbidden path may come after the positive evidence, and the final answer only exists at
        // the end. So early stop is disabled whenever any of them is set.
        const canStopEarly = notFiles.length === 0 && outYes.length === 0 && outNo.length === 0;
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: canStopEarly
            ? (p) =>
                subs.every((s) => p.subagents.includes(s)) &&
                (anySub.length === 0 || anySub.some((s) => p.subagents.includes(s))) &&
                skls.every((s) => skillEngaged(p, s)) &&
                files.every((f) => p.filesRead.some((r) => readMatches(r, f)))
            : undefined,
        });
        logTrace(c.name, result);
        try {
          for (const sub of subs) {
            expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(sub);
          }
          if (anySub.length) {
            expect(
              anySub.some((s) => result.subagents.includes(s)),
              `none of [${anySub.join(", ")}] dispatched | subagents: ${result.subagents.join(", ")}`,
            ).toBe(true);
          }
          for (const skill of c.expectSkills ?? []) {
            expect(
              activated(result, skill),
              `skill ${skill} not engaged | skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            ).toBe(true);
          }
          for (const file of files) {
            expect(
              result.filesRead.some((f) => readMatches(f, file)),
              `${file} not read | reads: ${result.filesRead.join(", ")}`,
            ).toBe(true);
          }
          for (const file of notFiles) {
            const offenders = result.filesRead.filter((f) => readMatches(f, file));
            expect(offenders, `forbidden read of ${file}: ${offenders.join(", ")}`).toEqual([]);
          }
          if (outYes.length) {
            expect(
              patternMatch(result.text, outYes),
              `expected all of [${outYes.join(", ")}] in output:\n${result.text}`,
            ).toBe(1);
          }
          for (const bad of outNo) {
            expect(
              result.text.toLowerCase().includes(bad.toLowerCase()),
              `forbidden "${bad}" in output:\n${result.text}`,
            ).toBe(false);
          }
          expect(result.isError).toBe(false);
        } finally {
          record(c.name, { result });
        }
      } else {
        // contrast: treatment (real harness) vs control (empty tmpdir, no on-disk config).
        const tools = c.tools ?? ["Read", "Grep", "Glob"];
        const treatment = await workflowTask(c.prompt, { allowedTools: tools, maxTurns: c.maxTurns });
        const emptyCwd = mkdtempSync(join(tmpdir(), "eval-control-"));
        const control = await runClaude(c.prompt, {
          allowedTools: tools,
          maxTurns: c.maxTurns,
          cwd: emptyCwd,
          settingSources: [],
        });
        logTrace(`${c.name} [treatment]`, treatment);
        logTrace(`${c.name} [control]`, control);
        try {
          const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
          const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
          expect(treatmentRead, `treatment reads: ${treatment.filesRead.join(", ")}`).toBe(true);
          expect(controlRead, `control reads: ${control.filesRead.join(", ")}`).toBe(false);
        } finally {
          record(`${c.name} [treatment]`, { result: treatment });
          record(`${c.name} [control]`, { result: control });
        }
      }
    });
  }
}
