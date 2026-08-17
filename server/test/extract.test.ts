import { describe, it, expect } from 'vitest';
import {
  extractSymbols,
  extractReferences,
  extractEndpoints,
  extractCrons,
} from '../src/adapters/codeindex/extract.js';

/**
 * A3 — unit tests for the enhanced TS/JS symbol/reference extractor (L04).
 * Pure (no DB/network) — the core of blast-radius accuracy.
 */
describe('extractSymbols', () => {
  it('finds functions, arrows, classes, methods, interfaces, types', () => {
    const src = `
export function rateLimit(req) { return true; }
const helper = (x) => x + 1;
export const compute = async (n: number) => n * 2;
export class Bucket {
  refill(now: number) { return now; }
  static make() { return new Bucket(); }
}
export interface Config { port: number }
export type Id = string;
`;
    const syms = extractSymbols(src);
    const names = syms.map((s) => s.name);
    expect(names).toContain('rateLimit');
    expect(names).toContain('helper');
    expect(names).toContain('compute');
    expect(names).toContain('Bucket');
    expect(names).toContain('refill'); // class method (bare)
    expect(names).toContain('Bucket.refill'); // class method (qualified)
    expect(names).toContain('Config');
    expect(names).toContain('Id');
    expect(syms.find((s) => s.name === 'Bucket')?.kind).toBe('class');
    expect(syms.find((s) => s.name === 'Config')?.kind).toBe('interface');
  });

  it('ignores keywords and comment lines', () => {
    const src = `
// function notReal(x) {}
/* class AlsoNot {} */
if (x) { doThing(); }
`;
    const syms = extractSymbols(src);
    expect(syms.map((s) => s.name)).not.toContain('notReal');
    expect(syms.map((s) => s.name)).not.toContain('AlsoNot');
    expect(syms.map((s) => s.name)).not.toContain('if');
  });
});

describe('extractReferences (downstream callers)', () => {
  it('finds call sites and excludes the declaration', () => {
    const caller = `
import { rateLimit } from './mw';
export function handler(req) {
  if (!rateLimit(req)) return 429;
  return 200;
}
`;
    const refs = extractReferences(caller, 'rateLimit');
    // exactly the call site on the if-line, NOT the import line
    expect(refs.length).toBe(1);
    expect(refs[0]!.line).toBe(4);
  });

  it('matches member calls, new, and JSX usage', () => {
    expect(extractReferences('obj.compute(1)', 'compute').length).toBe(1);
    expect(extractReferences('const b = new Bucket()', 'Bucket').length).toBe(1);
    expect(extractReferences('return <Widget id={1} />', 'Widget').length).toBe(1);
  });

  it('does not count the declaration line as a reference', () => {
    const decl = `export function rateLimit(req) { return true; }`;
    expect(extractReferences(decl, 'rateLimit').length).toBe(0);
  });
});

describe('extractEndpoints / extractCrons', () => {
  it('detects fastify/express route registrations', () => {
    const src = `
app.get('/users', handler);
router.post("/users/:id", update);
app.get<{ Params: { id: string } }>('/pulls/:id/blast', blast);
`;
    const eps = extractEndpoints(src);
    expect(eps).toContain('GET /users');
    expect(eps).toContain('POST /users/:id');
    expect(eps).toContain('GET /pulls/:id/blast');
  });

  it('detects a route whose path sits on the line after the verb', () => {
    // Every formatter wraps a route that takes options, so this is the normal
    // shape in any real codebase — a per-line scan finds nothing here.
    const src = [
      'app.get(',
      "  '/pulls/:id/blast',",
      '  { schema: { params: IdParams } },',
      '  async (req) => service.blastForPull(req.params.id),',
      ');',
      'app.post(',
      "  '/articles',",
      '  { schema: { body: CreateArticle } },',
      '  handler,',
      ');',
    ].join('\n');
    const eps = extractEndpoints(src);
    expect(eps).toContain('GET /pulls/:id/blast');
    expect(eps).toContain('POST /articles');
  });

  it('does not pair a `method:` with a `url:` from an unrelated object', () => {
    const src = [
      "const a = { method: 'GET' };",
      'const filler = 1;'.repeat(120),
      "const b = { url: '/somewhere-else' };",
    ].join('\n');
    expect(extractEndpoints(src)).toEqual([]);
  });

  it('detects cron expressions and background job kinds', () => {
    const src = `
cron.schedule('*/5 * * * *', poll);
jobs.register('poll_repo', handler);
`;
    const crons = extractCrons(src);
    expect(crons.some((c) => c.includes('*/5'))).toBe(true);
    expect(crons).toContain('job:poll_repo');
  });

  it('finds a cron expression hoisted away from its scheduler call', () => {
    // The idiomatic shape: a schedule-of-record table, the call site taking a
    // variable. On the line that HAS the literal there is no cron/schedule
    // keyword at all, so keyword-adjacency alone finds nothing here.
    const src = [
      'export const CRON_SCHEDULES = {',
      "  [STALE_DRAFT_DIGEST]: '0 3 * * *',",
      '} as const;',
      'container.scheduler.schedule(STALE_DRAFT_DIGEST, schedule, run);',
    ].join('\n');
    expect(extractCrons(src)).toContain('0 3 * * *');
  });

  it('matches a cron expression after `:` or `=`, not only after `.`/`(`', () => {
    expect(extractCrons("const schedule = '0 4 * * 1';")).toContain('0 4 * * 1');
    expect(extractCrons("{ cron: '15 2 * * *' }")).toContain('15 2 * * *');
  });

  it('keeps kebab-case job kinds instead of dropping them', () => {
    expect(extractCrons("jobs.register('stale-draft-digest', run);")).toContain(
      'job:stale-draft-digest',
    );
  });

  it('does not invent crons from ordinary code', () => {
    const src = [
      "const version = '1.2.3';",
      "const label = 'GET /articles';",
      'const nums = [1, 2, 3, 4, 5];',
      "log('processed 4 of 5 files');",
    ].join('\n');
    expect(extractCrons(src)).toEqual([]);
  });
});
