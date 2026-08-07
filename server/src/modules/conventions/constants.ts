/** Tuning knobs for convention extraction. Deliberately conservative — the
 *  whole sample plus the instructions has to fit one model call comfortably. */

/** How many top-ranked source files feed the sample. */
export const SAMPLE_FILE_COUNT = 12;

/** Lines kept per sampled source file (head of the file). */
export const MAX_SAMPLE_LINES = 200;

/** Characters kept per sampled config file. */
export const MAX_CONFIG_CHARS = 4_000;

/** Characters kept per sampled source line — guards against minified files. */
export const MAX_SAMPLE_LINE_CHARS = 400;

/** Longest rule text we persist; anything beyond is the model rambling. */
export const MAX_RULE_LEN = 400;

/** Longest evidence snippet we persist. */
export const MAX_SNIPPET_LEN = 300;

/**
 * Config files sampled verbatim, checked by exact name at the clone root.
 * No globbing: the set is fixed so two scans of the same commit sample the
 * same bytes. Missing entries are simply skipped.
 */
export const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'prettier.config.js',
  'prettier.config.mjs',
  'biome.json',
  '.editorconfig',
] as const;
