/**
 * Onboarding module constants — the single source of truth for section
 * ordering/shape (AC-1, AC-13), the background job kind, and the clone files
 * `evidence.ts` reads to ground `local_setup` commands (AC-9).
 */

// --- Section shape (AC-1) ---------------------------------------------------
/**
 * The six section kinds, always in this fixed order (AC-1). Single source of
 * truth for BOTH:
 *  - the prompt's `{{sections}}` fill (assembled from this list at call time), and
 *  - the server-side shape check (`helpers.ts#groundTour`, T8) that rejects a
 *    draft missing, duplicating, or adding a kind.
 */
export const SECTION_KINDS = [
  'architecture',
  'critical_paths',
  'routes_and_apis',
  'local_setup',
  'reading_path',
  'first_tasks',
] as const;

/**
 * Only these two kinds may carry a mermaid `diagram` (AC-13). `groundTour`
 * strips `diagram` from every other kind before storage.
 */
export const DIAGRAM_KINDS = ['architecture', 'routes_and_apis'] as const;

// --- Background job ----------------------------------------------------------
/** `JobRunner` kind for a tour (re)generation, registered by T10/T11's route boot. */
export const ONBOARDING_JOB_KIND = 'onboarding.generate';

// --- Evidence read (AC-9: local_setup command attestation) -------------------
/** Manifest files `evidence.ts` reads for dependency/script facts. */
export const MANIFEST_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'Gemfile',
  'go.mod',
  'Cargo.toml',
  'composer.json',
] as const;

/** Task-runner / compose files `evidence.ts` reads for command attestation targets. */
export const TASK_FILES = [
  'Makefile',
  'makefile',
  'Taskfile.yml',
  'Taskfile.yaml',
  'justfile',
  'Justfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

/** README file names `evidence.ts` scans for fenced/inline commands (AC-9). */
export const README_NAMES = ['README.md', 'Readme.md', 'readme.md', 'README', 'README.rst'] as const;

// --- critical_paths ordering (AC-15, AC-16, AC-17) ---------------------------
/**
 * Substrings that exclude a file from `critical_paths` — tests, fixtures,
 * configs, declaration files, and migrations, per R7. Checked as a
 * case-sensitive substring/suffix match against the full repo-relative path
 * (e.g. `path.includes(segment)`), not a single path segment equality check.
 */
export const EXCLUDED_PATH_SEGMENTS = [
  '__tests__',
  '__fixtures__',
  '.test.',
  '.spec.',
  '/test/',
  '/tests/',
  '/fixture/',
  '/fixtures/',
  '/migrations/',
  '/migration/',
  '.d.ts',
  '/config/',
  '.config.',
] as const;
