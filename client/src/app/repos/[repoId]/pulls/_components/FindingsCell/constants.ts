import type { PrMeta } from "@devdigest/shared";

/**
 * The list payload's findings tally. Note this covers only the three contract
 * severities — narrower than `@devdigest/ui`'s `Severity`, which also has INFO.
 */
export type SeverityBreakdown = NonNullable<PrMeta["findings_by_severity"]>;
export type CellSeverity = keyof SeverityBreakdown;

/** Severities the FINDINGS column tallies, in display (and sort) order. */
export const CELL_SEVERITIES: CellSeverity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Findings rendered in the hover card before the "+N more" footer takes over. */
export const POPOVER_MAX_FINDINGS = 12;

/** Hover card width, and the gap it keeps from the anchor cell. */
export const POPOVER_WIDTH = 490;
export const POPOVER_GAP = 8;

/** Viewport padding the hover card never crosses when it is flipped/clamped. */
export const POPOVER_MARGIN = 12;

/**
 * Open/close delays in ms. The open delay keeps the card from flashing as the
 * pointer crosses the column on its way elsewhere; the close delay leaves time
 * to move the pointer into the card without it vanishing underneath.
 */
export const OPEN_DELAY_MS = 120;
export const CLOSE_DELAY_MS = 120;
