/**
 * Onboarding module (T8) — the ONLY fs-touching file in this module.
 * `collectEvidence()` reads a repo's clone once and hands back a
 * self-contained, already-truncated evidence bundle plus two synchronous-ish
 * (but I/O-backed) existence checks. `helpers.ts#groundTour` (pure, no I/O of
 * its own) consumes this bundle to ground a model draft against reality —
 * this file is where that reality is actually read.
 *
 * Every failure here is a SKIP, never a throw: a missing clone, a missing
 * file, a malformed manifest, an unreadable directory all degrade to "no
 * evidence for that bit," exactly like `readDocRefs`
 * (`modules/reviews/intent/docs.ts`) and `readClone`
 * (`modules/conventions/service.ts:209`) already do for the same reason —
 * this reads THIRD-PARTY repository content, which cannot be trusted to be
 * well-formed, let alone safe.
 *
 * Path containment: every path this module resolves against the clone goes
 * through the SAME two-guard shape as `readDocRefs`
 * (`modules/reviews/intent/docs.ts:36`) — resolve, check the result still has
 * `root + path.sep` as a prefix, THEN `realpath` (follows symlinks) and
 * re-check the SAME prefix. A single check is not enough: the first guard
 * catches a lexical escape (`../../etc/passwd`), the second catches an
 * escape hidden in the clone's own contents (a symlink committed by the
 * target repo pointing outside the clone — git happily stores one). Do NOT
 * collapse this to a single `realpath` call "for simplicity" — see
 * `server/insights/gotchas.md` (2026-08-18) for why a `Dirent`/naive check
 * alone cannot be trusted here either.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { MANIFEST_FILES, TASK_FILES, README_NAMES } from './constants.js';

export interface EvidenceFile {
  /** Path relative to the clone root, e.g. "package.json" or "docs/README.md". */
  path: string;
  body: string;
}

export interface CollectEvidenceOptions {
  /** See `AppConfig.onboardingMaxExcerptFiles`. */
  maxExcerptFiles: number;
  /** See `AppConfig.onboardingExcerptCharCap`. */
  excerptCharCap: number;
}

export interface EvidenceResult {
  /** MANIFEST_FILES actually present at the clone root (full content, uncapped by excerptCharCap — command attestation needs the real `scripts` object, not a truncated one). */
  manifests: EvidenceFile[];
  /** TASK_FILES actually present at the clone root. */
  taskFiles: EvidenceFile[];
  /** First README_NAMES candidate found, or null. */
  readme: EvidenceFile | null;
  /**
   * Up to `maxExcerptFiles` of the above (manifests, then task files, then
   * the README), each truncated to `excerptCharCap` — the curated set
   * `helpers.ts#renderFacts` shows the model, one `wrapUntrusted` block each
   * (AC-12).
   */
  excerpts: EvidenceFile[];
  /**
   * Leading-executable / script / target names this repo attests to, built
   * from package.json scripts + packageManager, Makefile/Taskfile/justfile
   * targets, docker-compose services, and README fenced/inline commands
   * (AC-9). `groundTour` drops any `local_setup` command whose first token
   * is not in this set.
   */
  commandAttestations: Set<string>;
  /** True iff `relPath` resolves, inside the clone, to a regular file. */
  fileExists(relPath: string): Promise<boolean>;
  /** True iff `relPath` resolves, inside the clone, to a directory (AC-23). */
  dirExists(relPath: string): Promise<boolean>;
}

/** Cap on how much of a manifest/task/readme file we hold in memory for parsing. Generous — command attestation needs the real content, not a preview. */
const MAX_ATTESTATION_FILE_CHARS = 200_000;

interface ResolvedEntry {
  kind: 'file' | 'dir';
  real: string;
}

/**
 * The one true containment guard (see file header). Returns null for
 * anything lexically suspicious, anything outside the clone after
 * resolution, anything whose realpath escapes the clone, or anything that
 * doesn't exist / isn't a plain file or directory (e.g. a device, a FIFO).
 */
async function resolveEntry(root: string, rel: string): Promise<ResolvedEntry | null> {
  if (typeof rel !== 'string' || rel.length === 0) return null;
  if (rel.includes('..') || path.isAbsolute(rel)) return null;

  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  const real = await realpath(resolved).catch(() => null);
  if (real === null) return null;
  if (real !== root && !real.startsWith(root + path.sep)) return null;

  const st = await stat(real).catch(() => null);
  if (st === null) return null;
  if (st.isDirectory()) return { kind: 'dir', real };
  if (st.isFile()) return { kind: 'file', real };
  return null;
}

function addToken(set: Set<string>, token: string | null | undefined): void {
  if (!token) return;
  const trimmed = token.trim();
  if (trimmed.length > 0) set.add(trimmed);
}

/** Best-effort Makefile target parser: unindented `name:` lines, skipping recipe lines and `.PHONY`-style directives. */
function parseMakeTargets(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    if (/^\s/.test(line)) continue; // recipe lines are indented — never a target declaration
    const m = /^([A-Za-z0-9_.\-/%]+)\s*:(?!=)/.exec(line);
    const name = m?.[1];
    if (!name || name.startsWith('.') || name.startsWith('#')) continue;
    out.push(name);
  }
  return out;
}

/** Best-effort justfile recipe parser: unindented `name ...args:` lines. */
function parseJustRecipes(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    if (/^\s/.test(line) || line.startsWith('#') || line.trim() === '') continue;
    const m = /^([a-zA-Z0-9_-]+)\b[^:]*:/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Best-effort YAML "direct child keys of a top-level block" parser (no yaml
 * dependency in this package). Used for Taskfile's `tasks:` and
 * docker-compose's `services:`. Indentation-based: finds an unindented
 * `blockName:` line, then collects the FIRST indentation level of keys
 * beneath it, stopping at the first line that dedents back to (or past) the
 * block's own indentation.
 */
function parseYamlBlockKeys(body: string, blockName: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  let blockIndent = -1;
  let childIndent = -1;
  for (const rawLine of body.split('\n')) {
    if (rawLine.trim() === '') continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const trimmed = rawLine.trim();
    if (!inBlock) {
      if (trimmed === `${blockName}:` && indent === 0) {
        inBlock = true;
        blockIndent = indent;
        childIndent = -1;
      }
      continue;
    }
    if (indent <= blockIndent) {
      inBlock = false;
      continue;
    }
    if (childIndent === -1) childIndent = indent;
    if (indent !== childIndent) continue; // a nested grandchild — not a direct service/task name
    const m = /^([A-Za-z0-9_.-]+)\s*:/.exec(trimmed);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/**
 * README command extraction: fenced code blocks (any/no language tag) and
 * inline code spans that look like a shell invocation (contain a space, so a
 * bare identifier like `` `foo.ts` `` never counts). Only the LEADING TOKEN
 * of each candidate line/span is attested — matching `groundTour`'s
 * "leading executable/script name" check (AC-9).
 */
function extractReadmeCommandTokens(body: string): string[] {
  const out: string[] = [];
  const tokenPattern = /^[a-zA-Z0-9._-]+$/;

  const fenceRe = /```[a-zA-Z0-9]*\n([\s\S]*?)```/g;
  for (const match of body.matchAll(fenceRe)) {
    const block = match[1] ?? '';
    for (const line of block.split('\n')) {
      const trimmed = line.trim().replace(/^\$\s*/, '');
      if (!trimmed || trimmed.startsWith('#')) continue;
      const token = trimmed.split(/\s+/)[0];
      if (token && tokenPattern.test(token)) out.push(token);
    }
  }

  const inlineRe = /`([^`\n]+)`/g;
  for (const match of body.matchAll(inlineRe)) {
    const span = (match[1] ?? '').trim();
    if (!span.includes(' ')) continue; // require "cmd arg" shape — bare identifiers/paths don't count
    const token = span.split(/\s+/)[0];
    if (token && tokenPattern.test(token)) out.push(token);
  }

  return out;
}

/** Manifest-derived attestations: package-manager runners + declared scripts, plus a light per-ecosystem tool guess for the other MANIFEST_FILES. */
function attestFromManifest(set: Set<string>, file: EvidenceFile): void {
  const base = path.basename(file.path);
  if (base === 'package.json') {
    try {
      const parsed = JSON.parse(file.body) as {
        packageManager?: unknown;
        scripts?: unknown;
      };
      addToken(set, 'npm'); // bundled with node — always usable once package.json exists
      if (typeof parsed.packageManager === 'string') {
        addToken(set, parsed.packageManager.split('@')[0]?.toLowerCase());
      }
      if (parsed.scripts && typeof parsed.scripts === 'object') {
        for (const key of Object.keys(parsed.scripts as Record<string, unknown>)) addToken(set, key);
      }
    } catch {
      // malformed package.json — evidence collection degrades, never throws
    }
    return;
  }
  if (base === 'pnpm-workspace.yaml') {
    addToken(set, 'pnpm');
    return;
  }
  if (base === 'pyproject.toml') {
    addToken(set, 'poetry');
    addToken(set, 'python');
    addToken(set, 'pip');
    return;
  }
  if (base === 'requirements.txt') {
    addToken(set, 'pip');
    addToken(set, 'python');
    return;
  }
  if (base === 'Pipfile') {
    addToken(set, 'pipenv');
    addToken(set, 'python');
    return;
  }
  if (base === 'Gemfile') {
    addToken(set, 'bundle');
    addToken(set, 'bundler');
    return;
  }
  if (base === 'go.mod') {
    addToken(set, 'go');
    return;
  }
  if (base === 'Cargo.toml') {
    addToken(set, 'cargo');
    return;
  }
  if (base === 'composer.json') {
    addToken(set, 'composer');
    return;
  }
}

/** Task-runner-derived attestations: the runner itself, plus its target/service names. */
function attestFromTaskFile(set: Set<string>, file: EvidenceFile): void {
  const base = path.basename(file.path);
  if (base === 'Makefile' || base === 'makefile') {
    addToken(set, 'make');
    for (const target of parseMakeTargets(file.body)) addToken(set, target);
    return;
  }
  if (base === 'Taskfile.yml' || base === 'Taskfile.yaml') {
    addToken(set, 'task');
    for (const t of parseYamlBlockKeys(file.body, 'tasks')) addToken(set, t);
    return;
  }
  if (base === 'justfile' || base === 'Justfile') {
    addToken(set, 'just');
    for (const r of parseJustRecipes(file.body)) addToken(set, r);
    return;
  }
  if (/^(docker-)?compose\.ya?ml$/.test(base)) {
    addToken(set, 'docker'); // `docker compose ...`
    addToken(set, 'docker-compose'); // `docker-compose ...`
    for (const svc of parseYamlBlockKeys(file.body, 'services')) addToken(set, svc);
    return;
  }
}

function isEvidenceFile(f: EvidenceFile | null): f is EvidenceFile {
  return f !== null;
}

/**
 * Reads a repo clone's manifest/task/readme evidence and builds the
 * grounding data `helpers.ts#groundTour` needs. Never throws — a null/absent
 * clone, or one that resolves to nothing, degrades to the empty evidence
 * bundle (every check then correctly drops everything downstream).
 */
export async function collectEvidence(
  clonePath: string | null,
  opts: CollectEvidenceOptions,
): Promise<EvidenceResult> {
  const empty = (): EvidenceResult => ({
    manifests: [],
    taskFiles: [],
    readme: null,
    excerpts: [],
    commandAttestations: new Set<string>(),
    fileExists: async () => false,
    dirExists: async () => false,
  });

  if (!clonePath) return empty();

  // Resolve the clone root's own symlinks ONCE, so every later containment
  // comparison is realpath-to-realpath (macOS: /tmp clones realpath under
  // /private/tmp — comparing a realpath against a non-realpath root would
  // drop everything).
  const root = await realpath(clonePath).catch(() => null);
  if (root === null) return empty();

  // Memoize per relative path — collectEvidence and later groundTour calls
  // routinely re-check the same path (e.g. a first_tasks target that's also
  // cited in reading_path).
  const cache = new Map<string, Promise<ResolvedEntry | null>>();
  const resolve = (rel: string): Promise<ResolvedEntry | null> => {
    let pending = cache.get(rel);
    if (!pending) {
      pending = resolveEntry(root, rel);
      cache.set(rel, pending);
    }
    return pending;
  };

  const fileExists = async (rel: string) => (await resolve(rel))?.kind === 'file';
  const dirExists = async (rel: string) => (await resolve(rel))?.kind === 'dir';

  async function readRoot(name: string): Promise<EvidenceFile | null> {
    const entry = await resolve(name);
    if (!entry || entry.kind !== 'file') return null;
    const raw = await readFile(entry.real, 'utf8').catch(() => null);
    if (raw === null) return null;
    return { path: name, body: raw.slice(0, MAX_ATTESTATION_FILE_CHARS) };
  }

  const manifests = (await Promise.all(MANIFEST_FILES.map((name) => readRoot(name)))).filter(
    isEvidenceFile,
  );
  const taskFiles = (await Promise.all(TASK_FILES.map((name) => readRoot(name)))).filter(
    isEvidenceFile,
  );
  const readmeCandidates = (await Promise.all(README_NAMES.map((name) => readRoot(name)))).filter(
    isEvidenceFile,
  );
  const readme = readmeCandidates[0] ?? null;

  const commandAttestations = new Set<string>();
  for (const m of manifests) attestFromManifest(commandAttestations, m);
  for (const t of taskFiles) attestFromTaskFile(commandAttestations, t);
  if (readme) {
    for (const token of extractReadmeCommandTokens(readme.body)) addToken(commandAttestations, token);
  }

  const excerptCandidates: EvidenceFile[] = [...manifests, ...taskFiles, ...(readme ? [readme] : [])];
  const maxExcerptFiles = Math.max(0, opts.maxExcerptFiles);
  const excerptCharCap = Math.max(0, opts.excerptCharCap);
  const excerpts = excerptCandidates.slice(0, maxExcerptFiles).map((f) => ({
    path: f.path,
    body: f.body.slice(0, excerptCharCap),
  }));

  return { manifests, taskFiles, readme, excerpts, commandAttestations, fileExists, dirExists };
}
