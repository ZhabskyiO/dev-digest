import type { Finding } from '@devdigest/shared';
import type { AuditedFinding } from './severity-audit.js';

/**
 * Scoring helpers for the severity audit. Pure (no I/O, no `this`), so the same
 * numbers come out in the server and in the CI runner.
 */

const SEVERITY_WEIGHT: Record<Finding['severity'], number> = {
  CRITICAL: 35,
  WARNING: 12,
  SUGGESTION: 3,
};

/**
 * How far the audit moved the review, 0–1. 0 means nothing was re-rated; 1 means
 * every finding changed severity by the maximum distance. The UI uses this to
 * decide whether the audit is worth surfacing at all.
 */
export function auditDrift(findings: AuditedFinding[]): number {
  if (findings.length === 0) return 0;
  const maxDelta = SEVERITY_WEIGHT.CRITICAL - SEVERITY_WEIGHT.SUGGESTION;
  const total = findings.reduce((sum, f) => {
    const before = SEVERITY_WEIGHT[f.originalSeverity];
    const after = SEVERITY_WEIGHT[f.severity];
    return sum + Math.abs(before - after);
  }, 0);
  return Number((total / (findings.length * maxDelta)).toFixed(3));
}

/**
 * Deterministic 0–100 score over the audited findings, mirroring the engine's
 * main scoring so an audited review and a plain one stay comparable.
 */
export function auditedScore(findings: AuditedFinding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Findings the audit downgraded, most-downgraded first. */
export function downgraded(findings: AuditedFinding[]): AuditedFinding[] {
  return findings
    .filter((f) => f.adjusted && SEVERITY_WEIGHT[f.severity] < SEVERITY_WEIGHT[f.originalSeverity])
    .sort(
      (a, b) =>
        SEVERITY_WEIGHT[b.originalSeverity] -
        SEVERITY_WEIGHT[b.severity] -
        (SEVERITY_WEIGHT[a.originalSeverity] - SEVERITY_WEIGHT[a.severity]),
    );
}
