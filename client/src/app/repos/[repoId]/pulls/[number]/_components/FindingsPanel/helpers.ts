import type { FindingRecord } from "@devdigest/shared";
import { sortBySeverity } from "../../../../../../../lib/findings";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";

/** Optionally drop low-confidence findings and sort by severity. */
export function visibleFindings(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  const shown = hideLow
    ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD)
    : findings;
  return sortBySeverity(shown);
}
