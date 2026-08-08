/**
 * Intent Layer (L03) module barrel.
 *
 * Pure cores (`confidence.ts`, `evidence.ts`) + the fs-touching `docs.ts` +
 * the orchestrating `service.ts` (the only piece that does network/DB I/O).
 */
export * from './confidence.js';
export * from './evidence.js';
export * from './docs.js';
export * from './service.js';
