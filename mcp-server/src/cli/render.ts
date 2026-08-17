/**
 * Terminal rendering. Pure string building — no I/O, no colors decided here
 * beyond the `color` flag the caller passes in.
 *
 * Every finding is printed as `SEVERITY  path:line` plus its title and
 * rationale, so the output is greppable and each line points at a place in the
 * working copy the developer can jump to.
 */

import type { LocalReviewResult } from '@devdigest/shared';

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  green: '\u001b[32m',
} as const;

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: ANSI.red,
  WARNING: ANSI.yellow,
  SUGGESTION: ANSI.blue,
};

export type RenderOpts = { color: boolean };

function paint(text: string, code: string, opts: RenderOpts): string {
  return opts.color ? `${code}${text}${ANSI.reset}` : text;
}

/** The full human report for a completed review. */
export function renderResult(
  result: LocalReviewResult,
  context: { label: string; skipped: { path: string; reason: string }[] },
  opts: RenderOpts,
): string {
  const out: string[] = [];
  const { agent, counts } = result;

  out.push(
    paint(`DevDigest review — ${result.mode} · ${context.label}`, ANSI.bold, opts),
  );
  out.push(
    paint(
      `${agent.name} (${agent.provider}/${agent.model}) · ${result.files} file(s) · grounding ${result.grounding}`,
      ANSI.dim,
      opts,
    ),
  );
  out.push('');

  if (result.findings.length === 0) {
    out.push(paint('No findings.', ANSI.green, opts));
  }

  for (const f of result.findings) {
    const severity = paint(
      f.severity.padEnd(10),
      SEVERITY_COLOR[f.severity] ?? ANSI.reset,
      opts,
    );
    const range = f.end_line > f.start_line ? `${f.start_line}-${f.end_line}` : `${f.start_line}`;
    out.push(`${severity}${f.file}:${range}  ${paint(f.title, ANSI.bold, opts)}`);
    for (const line of f.rationale.trim().split('\n')) {
      out.push(`            ${line}`);
    }
    if (f.suggestion) {
      out.push(`            ${paint('suggestion:', ANSI.dim, opts)} ${f.suggestion.trim().split('\n')[0]}`);
    }
    out.push('');
  }

  if (result.summary.trim()) {
    out.push(paint(result.summary.trim(), ANSI.dim, opts));
    out.push('');
  }

  const tally = `${counts.critical} critical · ${counts.warning} warning · ${counts.suggestion} suggestion`;
  out.push(`${tally} · score ${result.score}/100 · verdict ${result.verdict}`);

  const gate = `gate ${result.fail_on}`;
  out.push(
    result.blocking
      ? paint(`BLOCKING — ${result.blockers} finding(s) at or above ${gate}`, ANSI.red, opts)
      : paint(`Not blocking — nothing at or above ${gate}`, ANSI.green, opts),
  );

  // Degradations and skips are stated, never swallowed: a review with less
  // context than usual must not look identical to a full one.
  for (const note of result.degraded) {
    out.push(paint(`note: ${note}`, ANSI.dim, opts));
  }
  for (const s of context.skipped) {
    out.push(paint(`skipped ${s.path} — ${s.reason}`, ANSI.dim, opts));
  }

  return out.join('\n');
}

/** `--dry-run` report: what WOULD have been reviewed. */
export function renderDryRun(
  context: {
    label: string;
    mode: string;
    files: string[];
    skipped: { path: string; reason: string }[];
    bytes: number;
  },
  opts: RenderOpts,
): string {
  const out: string[] = [];
  out.push(paint(`Dry run — ${context.mode} · ${context.label}`, ANSI.bold, opts));
  out.push(
    paint(`${context.files.length} file(s), ${context.bytes} bytes of diff — not sent`, ANSI.dim, opts),
  );
  for (const f of context.files) out.push(`  ${f}`);
  for (const s of context.skipped) out.push(paint(`  skipped ${s.path} — ${s.reason}`, ANSI.dim, opts));
  return out.join('\n');
}
