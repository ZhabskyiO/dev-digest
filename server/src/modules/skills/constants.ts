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
