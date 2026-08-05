import { strFromU8, unzipSync } from 'fflate';

import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_UNCOMPRESSED_BYTES } from './constants.js';

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
