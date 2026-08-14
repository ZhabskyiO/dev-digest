#!/usr/bin/env node
/**
 * `devdigest` bin shim.
 *
 * The package ships TypeScript source and has no build step (same as the MCP
 * server, which `.mcp.json` starts with `npx tsx`). Node cannot import .ts
 * directly on every Node 22.x, so this shim registers tsx's ESM loader in-process
 * and then imports the real entry point — one process, no subprocess spawn, and
 * the child's exit code stays ours.
 */
import { register } from 'tsx/esm/api';

const unregister = register();
try {
  await import('../src/cli/index.ts');
} finally {
  unregister();
}
