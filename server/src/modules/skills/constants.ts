/** Constants for the skills module. */

/** Initial config version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Zip-bomb guard: reject an import archive with more entries than this, before reading any content. */
export const MAX_ARCHIVE_ENTRIES = 200;

/** Zip-bomb guard: reject an import archive whose total decompressed size exceeds this many bytes (5 MB). */
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 5 * 1024 * 1024;

/** Cap on the response body size the server will read when importing a skill from a URL (512 KB). */
export const MAX_URL_IMPORT_BYTES = 512 * 1024;

/** Timeout for the server-side URL-import fetch, so a slow/hanging host can't stall the request. */
export const URL_IMPORT_TIMEOUT_MS = 8000;

/**
 * Content types a URL import will accept. A skill is markdown, so an HTML page
 * is never one: importing `text/html` pulls a whole rendered web page (nav,
 * scripts, embedded JSON) into a body that later goes into a model prompt.
 * Deliberately an allowlist, not `text/*` minus html — a server can serve a
 * skill as any number of text subtypes, but the ones we can actually read as
 * markdown are these.
 */
export const ALLOWED_IMPORT_CONTENT_TYPES = [
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'application/markdown',
  'application/x-markdown',
] as const;

/** How much of the body to sniff when double-checking a lying content-type. */
export const HTML_SNIFF_CHARS = 2048;

/** Bodies longer than this get an advisory "oversized" flag (not a rejection). */
export const LARGE_SKILL_BODY_CHARS = 60_000;

/** Cap on advisory warnings returned per preview — the list is a hint, not a report. */
export const MAX_IMPORT_WARNINGS = 8;

/** Default trailing window for skill stats. */
export const DEFAULT_STATS_DAYS = 30;

/** Upper bound on `?days=`, so an absurd value can't scan the whole table. */
export const MAX_STATS_DAYS = 90;
