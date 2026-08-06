import { strFromU8, unzipSync } from 'fflate';

import type {
  Skill,
  SkillImportWarning,
  SkillSource,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import {
  DEFAULT_STATS_DAYS,
  HTML_SNIFF_CHARS,
  LARGE_SKILL_BODY_CHARS,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_IMPORT_WARNINGS,
  MAX_STATS_DAYS,
} from './constants.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping, the
 * config-version-bump rule, minimal frontmatter parsing, and archive
 * extraction for skill import. No I/O, no DB import.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    label: row.label ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes a skill's `body` relative to the existing row —
 * unlike agents, only `body` bumps the version and writes `skill_versions`;
 * name/description/type/source/enabled changes do not (per the API surface).
 */
export function isConfigChange(
  existing: Pick<SkillRow, 'body'>,
  patch: { body?: string },
): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/**
 * True when `ip` (a resolved IPv4/IPv6 literal) is loopback, private, link-local
 * (including the `169.254.169.254` cloud-metadata address), or otherwise not a
 * safe target for a server-side fetch. Used by the URL-import SSRF guard in
 * `service.ts`: a skill URL is resolved via DNS first, and any resolved address
 * failing this check is rejected before the actual fetch happens — otherwise an
 * "import a skill from a URL" feature is a ready-made SSRF into this server's
 * own network (internal services, cloud metadata endpoints, localhost).
 */
export function isDisallowedIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const parts = v4.split('.').map(Number);
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → fail closed
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 0) return true; // "this network"
    return false;
  }
  // IPv6 (anything not matched above, incl. non-mapped IPv6 literals).
  const norm = ip.toLowerCase();
  if (norm === '::1') return true; // loopback
  if (norm.startsWith('fe80:')) return true; // link-local
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // unique local (fc00::/7)
  if (!/^[0-9a-f:]+$/.test(norm)) return true; // not a real IP literal → fail closed
  return false;
}

// ---------------------------------------------------------------------------
// URL import: normalization, HTML detection, body hygiene, advisory risk scan
// ---------------------------------------------------------------------------

/**
 * Rewrite a human-facing code-host URL to the one that actually serves the
 * markdown. Pasting the page URL you were looking at is the overwhelmingly
 * common mistake, and the page is HTML — which the importer now rejects — so
 * silently fixing it beats an error the user can't act on.
 *
 * Only the host and path shape are rewritten. The result still goes through the
 * full SSRF check in `fetchUrlBody`, so this cannot be used to reach somewhere
 * the raw URL couldn't.
 */
export function normalizeImportUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw; // let the caller's own parse produce the error
  }
  const host = u.hostname.toLowerCase();
  const segments = u.pathname.split('/').filter(Boolean);

  // github.com/<owner>/<repo>/blob|raw/<ref>/<path...>
  //   → raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
  if (host === 'github.com' || host === 'www.github.com') {
    const [owner, repo, kind, ...rest] = segments;
    if (owner && repo && (kind === 'blob' || kind === 'raw') && rest.length >= 2) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}`;
    }
    return raw;
  }

  // gist.github.com/<user>/<id> → …/raw (gist.githubusercontent.com serves it)
  if (host === 'gist.github.com') {
    if (segments.length === 2 && segments[segments.length - 1] !== 'raw') {
      return `https://gist.githubusercontent.com/${segments.join('/')}/raw`;
    }
    return raw;
  }

  // gitlab.com/<group…>/<repo>/-/blob/<ref>/<path…> → …/-/raw/<ref>/<path…>
  if (host === 'gitlab.com' || host === 'www.gitlab.com') {
    const dashIndex = segments.indexOf('-');
    if (dashIndex > 0 && segments[dashIndex + 1] === 'blob') {
      const rewritten = [...segments];
      rewritten[dashIndex + 1] = 'raw';
      return `https://gitlab.com/${rewritten.join('/')}`;
    }
    return raw;
  }

  return raw;
}

/**
 * Content sniff for HTML, because a `content-type` header is only the server's
 * claim. Checked against the head of the body, where a doctype or root tag
 * lives; also catches the JSON-escaped (`<`) markup that code hosts embed
 * in their page payloads.
 */
export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, HTML_SNIFF_CHARS).toLowerCase();
  if (/<!doctype\s+html/.test(head)) return true;
  if (/<html[\s>]/.test(head)) return true;
  if (/<(head|body|meta|script|link)[\s>]/.test(head)) return true;
  if (/\\u003c(!doctype|html|head|body|script|div|p)[\s\\>]/.test(head)) return true;
  return false;
}

/**
 * Zero-width and bidi-override characters, which render as nothing but are read
 * by the model. Stripped rather than flagged: they cannot carry legitimate
 * meaning in a skill body, and leaving them in means the preview a human vets
 * is not the text the model receives.
 */
const INVISIBLE_CHARS = /[​-‏‪-‮⁠-⁤⁪-⁯﻿]/g;

/** True when `body` contains characters `sanitizeSkillBody` would remove. */
export function hasInvisibleChars(body: string): boolean {
  INVISIBLE_CHARS.lastIndex = 0;
  return INVISIBLE_CHARS.test(body);
}

/** Strip invisible control characters and normalize line endings. */
export function sanitizeSkillBody(body: string): string {
  return body.replace(INVISIBLE_CHARS, '').replace(/\r\n?/g, '\n');
}

/** Text aimed at the model rather than at the human reviewing the skill. */
const INSTRUCTION_OVERRIDE = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|preceding)\s+instructions?/i,
  /disregard\s+(all\s+|any\s+|the\s+)?(previous|prior|above|preceding)/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /\bsystem\s*prompt\b/i,
  /\b(reveal|print|output|repeat)\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
  /\bdo\s+not\s+(tell|inform|mention\s+to)\s+the\s+(user|human|reviewer)/i,
];

const CREDENTIAL_REFERENCE = [
  /process\.env\b/,
  /\b[A-Z][A-Z0-9]*_(?:API_)?(?:KEY|TOKEN|SECRET|PASSWORD)\b/,
  /\bsk[-_](?:live|test|proj)[-_][A-Za-z0-9]/i,
  /\bauthorization\s*:\s*bearer\b/i,
  /\bghp_[A-Za-z0-9]{10,}/,
];

/**
 * Advisory risk flags for an imported body. Explicitly NOT a security gate: the
 * real defenses are the content-type allowlist, the SSRF guard, imports landing
 * disabled, and the trusted-rule/untrusted-wrapper split at prompt-assembly
 * time (server/CLAUDE.md is emphatic that injection defense is never a
 * denylist). This exists so the human doing the vetting knows where to look —
 * a miss here costs nothing that wasn't already covered.
 */
export function scanSkillBodyRisks(body: string): SkillImportWarning[] {
  const found = new Set<SkillImportWarning>();

  if (/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(body)) found.add('html_markup');
  if (/<!--/.test(body) || hasInvisibleChars(body)) found.add('hidden_text');
  if (INSTRUCTION_OVERRIDE.some((re) => re.test(body))) found.add('instruction_override');
  if (CREDENTIAL_REFERENCE.some((re) => re.test(body))) found.add('credential_reference');
  if (/\bdata:[a-z/+-]+;base64,/i.test(body)) found.add('data_uri');
  if (/\bhttps?:\/\/[^\s)>"']+/i.test(body)) found.add('external_url');
  if (body.length > LARGE_SKILL_BODY_CHARS) found.add('oversized');

  return [...found].slice(0, MAX_IMPORT_WARNINGS);
}

/** Clamp a caller-supplied `?days=` into [1, MAX_STATS_DAYS], defaulting when absent. */
export function clampStatsDays(days?: number): number {
  if (days === undefined || !Number.isFinite(days)) return DEFAULT_STATS_DAYS;
  return Math.min(Math.max(Math.trunc(days), 1), MAX_STATS_DAYS);
}

/** Scalar frontmatter fields this module reads out of an imported skill's markdown. */
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  type?: string;
}

/**
 * Minimal scalar YAML-frontmatter reader — deliberately not a real YAML
 * parser (no `yaml` dependency). Only handles a `---` … `---` block of flat
 * `key: value` lines and only collects the three keys this module cares
 * about. Never throws: anything that doesn't look like frontmatter, or a
 * line that doesn't parse, is silently ignored.
 */
export function parseFrontmatter(md: string): SkillFrontmatter {
  const result: SkillFrontmatter = {};
  const lines = md.split('\n');
  if (lines[0]?.trim() !== '---') return result;

  const endIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (endIndex === -1) return result;

  for (const line of lines.slice(1, endIndex)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    if (key !== 'name' && key !== 'description' && key !== 'type') continue;

    let value = line.slice(colonIndex + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    result[key] = value;
  }

  return result;
}

/**
 * Derive a display name for an imported skill: frontmatter `name` first,
 * else the first ATX heading (`# Title`), else a fixed fallback so import
 * never fails on a name.
 */
export function deriveSkillName(md: string): string {
  const fromFrontmatter = parseFrontmatter(md).name;
  if (fromFrontmatter) return fromFrontmatter;

  for (const line of md.split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim();
  }

  return 'Untitled skill';
}

/** Result of pulling a skill body out of an uploaded archive. */
export interface ExtractedSkill {
  body: string;
  skipped: string[];
}

/**
 * Extract a skill's markdown body from an uploaded zip archive, in memory,
 * via `fflate`'s synchronous `unzipSync` — nothing is ever written to disk.
 *
 * The entry-count and total-decompressed-size caps run FIRST, before any
 * entry's content is read: this is the zip-bomb guard. A small compressed
 * archive can expand to gigabytes in memory (or contain hundreds of
 * thousands of entries) once decompressed, so the caps must be checked
 * against the already-decompressed `unzipSync` output before we do anything
 * else with it — reading content first would defeat the guard.
 */
export function extractSkillFromArchive(bytes: Uint8Array): ExtractedSkill {
  const entries = unzipSync(bytes);
  const paths = Object.keys(entries);

  if (paths.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(
      `Archive has too many entries (${paths.length} > ${MAX_ARCHIVE_ENTRIES} max) — refusing to extract`,
    );
  }

  const totalBytes = paths.reduce((sum, path) => sum + (entries[path]?.byteLength ?? 0), 0);
  if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Archive is too large decompressed (${totalBytes} > ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} bytes max) — refusing to extract`,
    );
  }

  const mdPaths = paths.filter((path) => !path.endsWith('/') && path.toLowerCase().endsWith('.md'));
  if (mdPaths.length === 0) {
    throw new Error('No markdown file found in the archive');
  }

  const skillMdPath = mdPaths.find((path) => path === 'SKILL.md' || path.endsWith('/SKILL.md'));

  let bodyPath: string;
  if (skillMdPath !== undefined) {
    bodyPath = skillMdPath;
  } else if (mdPaths.length === 1) {
    bodyPath = mdPaths[0]!;
  } else {
    // Shallowest path wins; ties broken by the shorter path string.
    bodyPath = mdPaths.reduce((shallowest, path) => {
      const depth = path.split('/').length;
      const shallowestDepth = shallowest.split('/').length;
      if (depth < shallowestDepth) return path;
      if (depth === shallowestDepth && path.length < shallowest.length) return path;
      return shallowest;
    });
  }

  const bodyBytes = entries[bodyPath];
  if (bodyBytes === undefined) {
    throw new Error(`Archive entry for "${bodyPath}" is missing`);
  }
  const body = strFromU8(bodyBytes);
  const skipped = paths.filter((path) => path !== bodyPath && !path.endsWith('/'));

  return { body, skipped };
}
