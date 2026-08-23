#!/usr/bin/env node
/**
 * collect-deps.mjs — deterministic dependency inventory for a multi-package repo.
 *
 * Zero dependencies, Node >= 20. Discovers every directory under --root that has a package.json
 * (standalone packages OR workspace members — it does not care which) and, for each one, gathers
 * the facts a dependency review needs so the model spends its effort on judgement, not on
 * re-deriving numbers:
 *
 *   - declared deps by type (prod / dev / peer / optional), declared range vs installed version
 *   - installed size per dep: own, transitive (its whole subtree) and EXCLUSIVE (what only it
 *     brings — i.e. what removing it would actually free)
 *   - usage evidence: imported in source? a bin used in package.json scripts? named in a config
 *     file? (→ "unreferenced" is a strong hint, not proof: see usage.evidence)
 *   - version drift: the same dep declared/installed at different versions across packages
 *   - internal edges: tsconfig path aliases pointing into sibling packages, vendored copies and
 *     whether those copies have drifted from each other
 *   - deep imports: relative `../<other-package>/…` imports and alias sub-path imports that
 *     bypass a package's public entry point
 *   - per-package module graph: size, cycles (Tarjan SCC), top fan-in hubs
 *   - with network (default): outdated (major bumps flagged), audit (vulns by severity), licenses
 *
 * Usage:
 *   node collect-deps.mjs [--root <dir>] [--packages a,b] [--top 10] [--no-network]
 *                         [--out deps.json] [--md]
 *
 *   --md          print markdown sections (tables + Mermaid) instead of JSON — paste-ready
 *   --out <file>  also write the full JSON to <file>
 *   --no-network  skip outdated / audit / licenses (offline or when speed matters)
 *
 * Exit code is 0 even when findings exist: this is an inventory, the skill decides severity.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// ───────────────────────────── args ─────────────────────────────

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i !== -1 && args[i + 1] ? args[i + 1] : d; };

const ROOT = resolve(opt("--root", process.cwd()));
const ONLY = opt("--packages", "").split(",").map((s) => s.trim()).filter(Boolean);
const TOP = Number(opt("--top", "10"));
const NETWORK = !flag("--no-network");
const OUT = opt("--out", "");
const MD = flag("--md");

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", "clones", ".turbo", "out",
  ".pnpm", ".cache", "results",
]);
const SRC_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

// ───────────────────────────── helpers ─────────────────────────────

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const exists = (p) => { try { lstatSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n} KB`);
const rel = (p) => relative(ROOT, p) || ".";
const uniq = (a) => [...new Set(a)];

function run(cmd, cmdArgs, cwd, { allowFail = true, maxBuffer = 64 * 1024 * 1024 } = {}) {
  try {
    return execFileSync(cmd, cmdArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer });
  } catch (e) {
    // pnpm/npm exit non-zero when they *find* something (outdated, vulns) — stdout is still the JSON
    if (allowFail && e.stdout) return String(e.stdout);
    return null;
  }
}

function walk(dir, out = [], { exts = SRC_EXT, maxDepth = 12 } = {}, depth = 0) {
  if (depth > maxDepth) return out;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(p, out, { exts, maxDepth }, depth + 1); }
    else if (exts.test(e.name)) out.push(p);
  }
  return out;
}

// ───────────────────────────── discovery ─────────────────────────────

function discoverPackages() {
  const dirs = [];
  const rootPkg = readJson(join(ROOT, "package.json"));
  if (rootPkg && (rootPkg.dependencies || rootPkg.devDependencies)) dirs.push(ROOT);
  for (const e of readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const d = join(ROOT, e.name);
    if (exists(join(d, "package.json"))) dirs.push(d);
  }
  const chosen = ONLY.length ? dirs.filter((d) => ONLY.includes(basename(d)) || ONLY.includes(rel(d))) : dirs;
  return chosen.sort();
}

function packageManager(dir) {
  if (exists(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(join(dir, "package-lock.json"))) return "npm";
  if (exists(join(dir, "yarn.lock"))) return "yarn";
  if (exists(join(dir, "bun.lockb")) || exists(join(dir, "bun.lock"))) return "bun";
  return "none";
}

// ───────────────────────────── installed tree + sizes ─────────────────────────────

const realCache = new Map();      // node_modules/<name> entry path → realpath | null
const pkgJsonCache = new Map();   // realpath → package.json
const closureCache = new Map();   // realpath → Set<realpath>

function pkgJsonOf(real) {
  if (!pkgJsonCache.has(real)) pkgJsonCache.set(real, readJson(join(real, "package.json")) || {});
  return pkgJsonCache.get(real);
}

/** Node resolution of a bare package name starting from `fromDir`, following symlinks. */
function resolvePackage(name, fromDir) {
  let dir = fromDir;
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "node_modules", name);
    if (!realCache.has(candidate)) {
      let real = null;
      if (exists(candidate) && exists(join(candidate, "package.json"))) { try { real = realpathSync(candidate); } catch { real = null; } }
      realCache.set(candidate, real);
    }
    const real = realCache.get(candidate);
    if (real) return real;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = basename(parent) === "node_modules" ? dirname(parent) : parent;
  }
  return null;
}

/** Transitive closure of installed packages reachable from `real` (itself included). */
function closureOf(real) {
  if (closureCache.has(real)) return closureCache.get(real);
  const seen = new Set([real]);
  const stack = [real];
  while (stack.length) {
    const cur = stack.pop();
    const pj = pkgJsonOf(cur);
    const names = Object.keys({ ...(pj.dependencies || {}), ...(pj.optionalDependencies || {}) });
    for (const n of names) {
      const r = resolvePackage(n, cur);
      if (r && !seen.has(r)) { seen.add(r); stack.push(r); }
    }
  }
  closureCache.set(real, seen);
  return seen;
}

const sizeCache = new Map(); // realpath → KB
function measure(paths) {
  const todo = uniq(paths).filter((p) => !sizeCache.has(p));
  for (let i = 0; i < todo.length; i += 400) {
    const batch = todo.slice(i, i + 400);
    const out = run("du", ["-sk", ...batch], ROOT, { allowFail: true }) || "";
    for (const line of out.split("\n")) {
      const m = line.match(/^(\d+)\s+(.*)$/);
      if (m) sizeCache.set(m[2], Number(m[1]));
    }
    for (const p of batch) if (!sizeCache.has(p)) sizeCache.set(p, 0);
  }
}
const sizeOf = (p) => sizeCache.get(p) ?? 0;

// ───────────────────────────── usage evidence ─────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function importSpecifiers(text) {
  // import x from '…' | import '…' | export … from '…' | require('…') | import('…')
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bexport\s+\*\s+from\s*|\bexport\s+\{[^}]*\}\s+from\s*)['"]([^'"\n]+)['"]/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push({ spec: m[1], index: m.index });
  return out;
}

function lineOf(text, index) { return text.slice(0, index).split("\n").length; }

function analyzeUsage(pkgDir, deps, sourceFiles, scripts) {
  const srcText = new Map(sourceFiles.map((f) => [f, readFileSync(f, "utf8")]));
  const configFiles = readdirSync(pkgDir, { withFileTypes: true })
    .filter((e) => e.isFile() && !/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json)$/.test(e.name) && !e.name.startsWith(".env"))
    .map((e) => join(pkgDir, e.name))
    .concat(exists(join(pkgDir, "scripts")) ? walk(join(pkgDir, "scripts"), [], { exts: /.*/ }) : [])
    .concat(exists(join(pkgDir, ".github")) ? walk(join(pkgDir, ".github"), [], { exts: /.*/ }) : []);
  const configText = new Map();
  for (const f of configFiles) { try { if (statSync(f).size < 512 * 1024) configText.set(f, readFileSync(f, "utf8")); } catch { /* ignore */ } }
  const scriptsText = Object.values(scripts || {}).join("\n");

  for (const d of deps) {
    const nameRe = new RegExp(`['"]${escapeRe(d.name)}(?:['"]|/)`);
    const imports = [];
    for (const [f, t] of srcText) {
      if (nameRe.test(t)) { imports.push(rel(f)); if (imports.length >= 3) break; }
    }
    const bins = d.installedPath ? Object.keys(typeof pkgJsonOf(d.installedPath).bin === "string" ? { [d.name.split("/").pop()]: 1 } : (pkgJsonOf(d.installedPath).bin || {})) : [];
    const binInScripts = bins.filter((b) => new RegExp(`(^|[\\s;&|"'])(npx\\s+)?${escapeRe(b)}(\\s|$)`).test(scriptsText));
    const nameInScripts = new RegExp(`(^|[\\s"'/])${escapeRe(d.name)}(\\s|$|["'@])`).test(scriptsText);
    const config = [];
    for (const [f, t] of configText) if (t.includes(d.name)) config.push(rel(f));
    const typesFor = d.name.startsWith("@types/") ? d.name.slice(7).replace(/^(\w+)__(.+)$/, "@$1/$2") : null;
    const typesTargetUsed = typesFor
      ? (typesFor === "node" || deps.some((o) => o.name === typesFor) || [...srcText.values()].some((t) => new RegExp(`['"]${escapeRe(typesFor)}(?:['"]|/)`).test(t)))
      : false;

    const evidence = [];
    if (imports.length) evidence.push(`imported in ${imports.length >= 3 ? "3+" : imports.length} source file(s) e.g. ${imports[0]}`);
    if (binInScripts.length) evidence.push(`bin \`${binInScripts[0]}\` used in package.json scripts`);
    else if (nameInScripts) evidence.push("named in package.json scripts");
    if (config.length) evidence.push(`named in config: ${config.slice(0, 2).join(", ")}`);
    if (typesFor && typesTargetUsed) evidence.push(`types for \`${typesFor}\` which is used`);

    d.usage = {
      status: evidence.length ? "used" : "unreferenced",
      evidence,
      importedIn: imports,
    };
  }
}

// ───────────────────────────── tsconfig aliases / internal edges ─────────────────────────────

// tsconfig is JSONC: strip line and block comments OUTSIDE strings (a path alias like "x/*" is not a comment), plus trailing commas.
function stripJsonc(src) {
  let out = ""; let i = 0; let inStr = false;
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (inStr) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const end = src.indexOf("*/", i + 2); i = end === -1 ? src.length : end + 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function readTsconfigPaths(pkgDir, file = "tsconfig.json", depth = 0) {
  const tsc = resolve(pkgDir, file);
  if (!exists(tsc) || depth > 3) return { paths: {}, baseUrl: pkgDir };
  let json = null;
  try { json = JSON.parse(stripJsonc(readFileSync(tsc, "utf8"))); } catch { json = null; }
  const co = (json && json.compilerOptions) || {};
  let inherited = { paths: {}, baseUrl: dirname(tsc) };
  if (json && typeof json.extends === "string" && json.extends.startsWith(".")) inherited = readTsconfigPaths(dirname(tsc), json.extends.endsWith(".json") ? json.extends : `${json.extends}.json`, depth + 1);
  const baseUrl = co.baseUrl ? resolve(dirname(tsc), co.baseUrl) : inherited.baseUrl;
  return { paths: co.paths || inherited.paths, baseUrl };
}

function classifyAliases(pkg, allPkgs) {
  const { paths, baseUrl } = readTsconfigPaths(pkg.dir);
  const aliases = [];
  for (const [alias, targets] of Object.entries(paths)) {
    for (const t of targets) {
      const abs = resolve(baseUrl, t.replace(/\*$/, ""));
      const owner = allPkgs.filter((p) => abs === p.dir || abs.startsWith(p.dir + sep)).sort((a, b) => b.dir.length - a.dir.length)[0];
      const insideNodeModules = abs.includes(`${sep}node_modules${sep}`);
      let kind;
      if (insideNodeModules) kind = "node_modules-pin";
      else if (!owner) kind = "outside-repo";
      else if (owner.dir === pkg.dir) kind = /[\\/]vendor[\\/]/.test(abs) ? "vendored" : "self";
      else kind = "cross-package";
      aliases.push({ alias, target: t, resolved: rel(abs), kind, to: owner ? owner.name : null, toDir: owner ? rel(owner.dir) : null });
    }
  }
  return aliases;
}

function hashDir(dir) {
  const files = walk(dir, [], { exts: /.*/ }).sort();
  const map = {};
  for (const f of files) map[relative(dir, f)] = createHash("sha1").update(readFileSync(f)).digest("hex");
  return map;
}

function compareVendoredCopies(pkgs) {
  // group vendored aliases by alias name (e.g. "@devdigest/shared") across packages
  const groups = new Map();
  for (const p of pkgs) for (const a of p.aliases) {
    if (a.kind !== "vendored" || a.alias.endsWith("/*")) continue;
    const dir = resolve(ROOT, dirname(a.resolved));
    if (!isDir(dir)) continue;
    if (!groups.has(a.alias)) groups.set(a.alias, []);
    groups.get(a.alias).push({ pkg: p.name, dir });
  }
  const out = [];
  for (const [alias, copies] of groups) {
    if (copies.length < 2) continue;
    const hashes = copies.map((c) => ({ ...c, files: hashDir(c.dir) }));
    const [base, ...rest] = hashes;
    const diffs = [];
    for (const other of rest) {
      const all = uniq([...Object.keys(base.files), ...Object.keys(other.files)]);
      const changed = all.filter((f) => base.files[f] !== other.files[f]);
      diffs.push({ a: `${base.pkg}:${rel(base.dir)}`, b: `${other.pkg}:${rel(other.dir)}`, differingFiles: changed, identical: changed.length === 0 });
    }
    out.push({ alias, copies: copies.map((c) => `${c.pkg}:${rel(c.dir)}`), diffs });
  }
  return out;
}

// ───────────────────────────── module graph: deep imports, cycles, hubs ─────────────────────────────

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const tries = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), base.replace(/\.mjs$/, ".mts"),
    `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.js")];
  for (const t of tries) if (exists(t) && !isDir(t)) return t;
  return null;
}

function moduleGraph(pkg, sourceFiles) {
  const selfAliases = pkg.aliases.filter((a) => a.kind === "self" && a.alias.endsWith("/*"));
  const crossAliases = pkg.aliases.filter((a) => a.kind === "cross-package");
  const edges = new Map(sourceFiles.map((f) => [f, new Set()]));
  const deepImports = [];
  const fileSet = new Set(sourceFiles);

  for (const f of sourceFiles) {
    const text = readFileSync(f, "utf8");
    for (const { spec, index } of importSpecifiers(text)) {
      let target = null;
      if (spec.startsWith(".")) {
        target = resolveRelative(f, spec);
        if (target && !target.startsWith(pkg.dir + sep)) {
          deepImports.push({ file: `${rel(f)}:${lineOf(text, index)}`, spec, kind: "relative-cross-package", resolved: rel(target) });
          continue;
        }
      } else {
        const self = selfAliases.find((a) => spec.startsWith(a.alias.slice(0, -1)));
        if (self) target = resolveRelative(join(pkg.dir, "x.ts"), "./" + relative(pkg.dir, resolve(ROOT, self.resolved, spec.slice(self.alias.length - 1))));
        const cross = crossAliases.find((a) => a.alias.endsWith("/*") && spec.startsWith(a.alias.slice(0, -1)));
        if (cross) deepImports.push({ file: `${rel(f)}:${lineOf(text, index)}`, spec, kind: "alias-subpath-bypasses-entry", resolved: `${cross.to} (${cross.resolved}…)` });
      }
      if (target && fileSet.has(target) && target !== f) edges.get(f).add(target);
    }
  }

  // Tarjan SCC
  let index = 0; const idx = new Map(); const low = new Map(); const onStack = new Set(); const stack = []; const sccs = [];
  function strong(v) {
    idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
    for (const w of edges.get(v)) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = []; let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) sccs.push(comp);
    }
  }
  for (const v of edges.keys()) if (!idx.has(v)) strong(v);

  const fanIn = new Map();
  for (const [, tos] of edges) for (const t of tos) fanIn.set(t, (fanIn.get(t) || 0) + 1);
  const hubs = [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => ({ file: rel(f), fanIn: n }));
  const edgeCount = [...edges.values()].reduce((n, s) => n + s.size, 0);

  return {
    files: sourceFiles.length, edges: edgeCount,
    cycles: sccs.sort((a, b) => b.length - a.length).slice(0, 10).map((c) => c.map(rel)),
    cycleCount: sccs.length, hubs, deepImports,
  };
}

// ───────────────────────────── network: outdated / audit / licenses ─────────────────────────────

function outdated(pkg) {
  let raw = null;
  if (pkg.pm === "pnpm") raw = run("pnpm", ["outdated", "--format", "json"], pkg.dir);
  else if (pkg.pm === "npm") raw = run("npm", ["outdated", "--json"], pkg.dir);
  if (raw == null) return { available: false, items: [] };
  let json; try { json = JSON.parse(raw || "{}"); } catch { return { available: false, items: [] }; }
  const items = Object.entries(json).map(([name, v]) => {
    const current = v.current || null; const latest = v.latest || null;
    const bump = current && latest ? (current.split(".")[0] !== latest.split(".")[0] ? "major" : current.split(".")[1] !== latest.split(".")[1] ? "minor" : "patch") : "unknown";
    return { name, current, wanted: v.wanted || null, latest, bump, deprecated: !!v.isDeprecated, type: v.dependencyType || v.type || null };
  });
  const order = { major: 0, minor: 1, patch: 2, unknown: 3 };
  return { available: true, items: items.sort((a, b) => order[a.bump] - order[b.bump] || a.name.localeCompare(b.name)) };
}

function audit(pkg) {
  let raw = null;
  if (pkg.pm === "pnpm") raw = run("pnpm", ["audit", "--json"], pkg.dir);
  else if (pkg.pm === "npm") raw = run("npm", ["audit", "--json"], pkg.dir);
  if (raw == null) return { available: false };
  let json; try { json = JSON.parse(raw); } catch { return { available: false }; }
  const counts = (json.metadata && json.metadata.vulnerabilities) || {};
  const advisories = Object.values(json.advisories || {}).map((a) => ({
    id: a.id, module: a.module_name, severity: a.severity, title: a.title, url: a.url,
    patched: a.patched_versions, via: uniq((a.findings || []).flatMap((f) => f.paths || []).map((p) => p.split(">")[1] || p)).slice(0, 3),
    dev: (a.findings || []).every((f) => f.dev === true),
  }));
  const sev = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  return { available: true, counts, advisories: advisories.sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9)) };
}

const PERMISSIVE_ONE = /^(MIT|MIT-0|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|CC-BY-4\.0|MPL-2\.0|Zlib|WTFPL|PSF-2\.0)$/i;
// an SPDX expression is permissive when every operand is ("MIT AND ISC", "(MIT OR Apache-2.0)")
const isPermissive = (expr) => expr.replace(/[()]/g, "").split(/\s+(?:AND|OR|WITH)\s+/i).every((part) => PERMISSIVE_ONE.test(part.trim()));
function licenses(pkg) {
  if (pkg.pm !== "pnpm") return { available: false };
  const raw = run("pnpm", ["licenses", "list", "--json"], pkg.dir);
  if (raw == null) return { available: false };
  let json; try { json = JSON.parse(raw); } catch { return { available: false }; }
  const summary = {}; const flagged = [];
  for (const [lic, list] of Object.entries(json)) {
    summary[lic] = list.length;
    if (!isPermissive(lic)) for (const l of list) flagged.push({ name: l.name, license: lic, versions: l.versions });
  }
  return { available: true, summary, flagged };
}

// ───────────────────────────── main collection ─────────────────────────────

function collectPackage(dir, allDirs) {
  const manifest = readJson(join(dir, "package.json")) || {};
  const pkg = {
    name: manifest.name || basename(dir), dir, relDir: rel(dir), version: manifest.version || null,
    private: !!manifest.private, pm: packageManager(dir), moduleType: manifest.type || "commonjs",
    scripts: manifest.scripts || {}, deps: [], aliases: [], totals: {},
  };
  const declare = (obj, type) => Object.entries(obj || {}).forEach(([name, range]) => pkg.deps.push({ name, range, type }));
  declare(manifest.dependencies, "prod");
  declare(manifest.devDependencies, "dev");
  declare(manifest.peerDependencies, "peer");
  declare(manifest.optionalDependencies, "optional");

  // installed + sizes
  const nm = join(dir, "node_modules");
  pkg.installed = exists(nm);
  for (const d of pkg.deps) {
    const real = pkg.installed ? resolvePackage(d.name, dir) : null;
    d.installedPath = real;
    d.installedVersion = real ? pkgJsonOf(real).version || null : null;
    d.license = real ? (typeof pkgJsonOf(real).license === "string" ? pkgJsonOf(real).license : null) : null;
    d.closure = real ? closureOf(real) : new Set();
  }
  measure(pkg.deps.flatMap((d) => [...d.closure]));
  const owners = new Map(); // realpath → how many top-level deps pull it in
  for (const d of pkg.deps) for (const p of d.closure) owners.set(p, (owners.get(p) || 0) + 1);
  for (const d of pkg.deps) {
    d.ownKB = d.installedPath ? sizeOf(d.installedPath) : 0;
    d.transitiveKB = [...d.closure].reduce((n, p) => n + sizeOf(p), 0);
    d.exclusiveKB = [...d.closure].filter((p) => owners.get(p) === 1).reduce((n, p) => n + sizeOf(p), 0);
    d.transitiveCount = d.closure.size;
    delete d.closure;
  }
  if (pkg.installed) measure([nm]);
  pkg.totals = {
    prod: pkg.deps.filter((d) => d.type === "prod").length, dev: pkg.deps.filter((d) => d.type === "dev").length,
    peer: pkg.deps.filter((d) => d.type === "peer").length, optional: pkg.deps.filter((d) => d.type === "optional").length,
    nodeModulesKB: pkg.installed ? sizeOf(nm) : 0,
    installedPackages: uniq(pkg.deps.map((d) => d.installedPath).filter(Boolean)).length,
  };

  return pkg;
}

function main() {
  const dirs = discoverPackages();
  if (!dirs.length) { console.error(`no package.json found under ${ROOT}`); process.exit(2); }
  const pkgs = dirs.map((d) => collectPackage(d, dirs));

  // aliases + internal edges (needs every package known)
  for (const p of pkgs) p.aliases = classifyAliases(p, pkgs);
  const internalEdges = pkgs.flatMap((p) => p.aliases.filter((a) => a.kind === "cross-package").map((a) => ({ from: p.name, to: a.to, alias: a.alias, target: a.resolved })));
  const vendored = compareVendoredCopies(pkgs);

  // usage + module graph
  for (const p of pkgs) {
    const srcRoot = isDir(join(p.dir, "src")) ? join(p.dir, "src") : p.dir;
    const sources = walk(srcRoot).concat(srcRoot === p.dir ? [] : ["test", "tests", "__tests__", "scripts", "e2e", "flows", "bin"].filter((d) => isDir(join(p.dir, d))).flatMap((d) => walk(join(p.dir, d))));
    analyzeUsage(p.dir, p.deps, sources, p.scripts);
    p.moduleGraph = moduleGraph(p, walk(srcRoot));
  }

  // drift: same dep, different range or installed version across packages
  const byName = new Map();
  for (const p of pkgs) for (const d of p.deps) { if (!byName.has(d.name)) byName.set(d.name, []); byName.get(d.name).push({ pkg: p.name, range: d.range, installed: d.installedVersion, type: d.type }); }
  const drift = [];
  const shared = [];
  for (const [name, uses] of byName) {
    if (uses.length < 2) continue;
    shared.push({ name, packages: uses.map((u) => u.pkg) });
    const ranges = uniq(uses.map((u) => u.range)); const installed = uniq(uses.map((u) => u.installed).filter(Boolean));
    if (ranges.length > 1 || installed.length > 1) drift.push({ name, uses, rangesDiffer: ranges.length > 1, installedDiffer: installed.length > 1 });
  }

  // network
  if (NETWORK) for (const p of pkgs) { p.outdated = outdated(p); p.audit = audit(p); p.licenses = licenses(p); }

  const report = {
    generatedAt: new Date().toISOString(), root: ROOT, network: NETWORK,
    packages: pkgs.map((p) => ({ ...p, deps: p.deps.map(({ installedPath, ...d }) => d) })),
    internalEdges, vendored, drift, shared: shared.sort((a, b) => b.packages.length - a.packages.length),
  };
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  if (MD) process.stdout.write(renderMarkdown(report));
  else if (!OUT) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else console.error(`wrote ${OUT}`);
}

// ───────────────────────────── markdown rendering ─────────────────────────────

const mmId = (s) => s.replace(/[^A-Za-z0-9]/g, "_");
const short = (s) => s.replace(/^@devdigest\//, "");
const table = (header, rows) => rows.length ? [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n") : "_none_";

function renderMarkdown(r) {
  const out = [];
  const P = r.packages;
  out.push(`<!-- generated by dependency-checker/scripts/collect-deps.mjs at ${r.generatedAt}; network=${r.network} -->`);

  out.push(`\n## Packages\n`);
  out.push(table(["Package", "Dir", "Manager", "Prod", "Dev", "Installed (node_modules)", "Internal edges (out)"],
    P.map((p) => [p.name, `\`${p.relDir}\``, p.pm, p.totals.prod, p.totals.dev, p.installed ? kb(p.totals.nodeModulesKB) : "not installed", uniq(r.internalEdges.filter((e) => e.from === p.name).map((e) => short(e.to))).join(", ") || "—"])));

  // internal graph
  out.push(`\n## Internal dependency graph\n\n\`\`\`mermaid\nflowchart LR`);
  for (const p of P) out.push(`  ${mmId(p.name)}["${short(p.name)}<br/>${p.relDir}/"]`);
  const vendoredAliases = uniq(r.vendored.map((v) => v.alias));
  for (const v of r.vendored) {
    const drifted = v.diffs.filter((d) => !d.identical).length;
    out.push(`  ${mmId(v.alias)}(["${v.alias}<br/>vendored in ${v.copies.length} packages${drifted ? ` · copies differ ⚠` : " · copies identical"}"])`);
    for (const c of v.copies) out.push(`  ${mmId(c.split(":")[0])} -. "vendored copy" .-> ${mmId(v.alias)}`);
  }
  const seenEdge = new Set();
  for (const e of r.internalEdges) {
    const key = `${e.from}→${e.to}`;
    if (vendoredAliases.includes(e.alias.replace(/\/\*$/, "")) || seenEdge.has(key)) continue;
    seenEdge.add(key);
    const labels = uniq(r.internalEdges.filter((x) => x.from === e.from && x.to === e.to).map((x) => x.alias.replace(/\/\*$/, "")));
    out.push(`  ${mmId(e.from)} -- "${labels.join(", ")}" --> ${mmId(e.to)}`);
  }
  const deep = P.flatMap((p) => p.moduleGraph.deepImports.map((d) => ({ ...d, from: p.name })));
  for (const d of uniq(deep.map((d) => `${d.from}→${d.resolved.split("/")[0]}`))) { const [from, to] = d.split("→"); const target = P.find((p) => p.relDir === to || p.name === to); if (target) out.push(`  ${mmId(from)} -. "deep import ⚠" .-> ${mmId(target.name)}`); }
  out.push("```");

  // external footprint graph: heavy or shared deps
  out.push(`\n## External footprint graph (top ${Math.min(TOP, 6)} heaviest per package + every dep shared by ≥2 packages)\n\n\`\`\`mermaid\nflowchart TB`);
  const sharedNames = new Set(r.shared.map((s) => s.name));
  const shown = new Map();
  for (const p of P) {
    const heavy = [...p.deps].filter((d) => d.installedVersion).sort((a, b) => b.transitiveKB - a.transitiveKB).slice(0, Math.min(TOP, 6));
    for (const d of p.deps) if (heavy.includes(d) || sharedNames.has(d.name)) {
      if (!shown.has(d.name)) { shown.set(d.name, d); out.push(`  dep_${mmId(d.name)}["${d.name}<br/>${kb(d.transitiveKB)} transitive"]`); }
      out.push(`  ${mmId(p.name)} -- "${d.type} ${d.installedVersion || d.range}" --> dep_${mmId(d.name)}`);
    }
  }
  for (const p of P) out.push(`  ${mmId(p.name)}[["${short(p.name)}"]]`);
  out.push("```");

  // sizes
  for (const p of P) {
    out.push(`\n## Size breakdown — ${p.name} (\`${p.relDir}/\`, node_modules ${p.installed ? kb(p.totals.nodeModulesKB) : "not installed"})\n`);
    const rows = [...p.deps].sort((a, b) => b.transitiveKB - a.transitiveKB).slice(0, TOP)
      .map((d) => [d.name, d.type, `${d.range} → ${d.installedVersion || "not installed"}`, kb(d.ownKB), `${kb(d.transitiveKB)} (${d.transitiveCount} pkgs)`, kb(d.exclusiveKB), d.usage.status === "used" ? "used" : "**unreferenced**"]);
    out.push(`Top ${TOP} by transitive size. _Exclusive_ = what only this dep pulls in (≈ what removing it frees).\n`);
    out.push(table(["Dependency", "Type", "Declared → installed", "Own", "Transitive", "Exclusive", "Usage"], rows));
  }

  out.push(`\n## Version drift across packages\n`);
  out.push(table(["Dependency", "Declared (package: range → installed)", "Ranges differ", "Installed differ"],
    r.drift.map((d) => [d.name, d.uses.map((u) => `${short(u.pkg)}: ${u.range} → ${u.installed || "—"}`).join("<br/>"), d.rangesDiffer ? "yes" : "no", d.installedDiffer ? "yes" : "no"])));

  out.push(`\n## Unreferenced dependencies (no import, no bin in scripts, not named in a config file)\n`);
  out.push(table(["Package", "Dependency", "Type", "Exclusive size", "Note"],
    P.flatMap((p) => p.deps.filter((d) => d.usage.status === "unreferenced").map((d) => [short(p.name), d.name, d.type, kb(d.exclusiveKB), d.installedVersion ? "verify before removing (may be loaded dynamically / by a framework)" : "declared but not installed"]))));

  out.push(`\n## Vendored copies\n`);
  out.push(r.vendored.length ? r.vendored.map((v) => `- \`${v.alias}\`: ${v.copies.map((c) => `\`${c}\``).join(", ")}\n${v.diffs.map((d) => `  - ${d.identical ? "identical" : `**differs** in ${d.differingFiles.length} file(s): ${d.differingFiles.slice(0, 5).join(", ")}`} (${d.a} vs ${d.b})`).join("\n")}`).join("\n") : "_none_");

  out.push(`\n## Deep / cross-package imports\n`);
  out.push(deep.length ? table(["Package", "File", "Import", "Kind", "Resolves to"], deep.map((d) => [short(d.from), `\`${d.file}\``, `\`${d.spec}\``, d.kind, d.resolved])) : "_none_");

  out.push(`\n## Module graph per package\n`);
  out.push(table(["Package", "Files", "Edges", "Cycles (SCCs)", "Largest cycle", "Top fan-in hub"],
    P.map((p) => [short(p.name), p.moduleGraph.files, p.moduleGraph.edges, p.moduleGraph.cycleCount, p.moduleGraph.cycles[0] ? `${p.moduleGraph.cycles[0].length} files: ${p.moduleGraph.cycles[0].slice(0, 3).map((f) => f.split("/").slice(-2).join("/")).join(" ↔ ")}${p.moduleGraph.cycles[0].length > 3 ? " …" : ""}` : "—", p.moduleGraph.hubs[0] ? `${p.moduleGraph.hubs[0].file} (${p.moduleGraph.hubs[0].fanIn})` : "—"])));

  if (r.network) {
    out.push(`\n## Outdated — major bumps and deprecations\n`);
    out.push(table(["Package", "Dependency", "Type", "Current → latest", "Bump", "Deprecated"],
      P.flatMap((p) => (p.outdated?.items || []).filter((o) => o.bump === "major" || o.deprecated).map((o) => [short(p.name), o.name, (o.type || "").replace("Dependencies", "").replace("dependencies", "prod"), `${o.current} → ${o.latest}`, o.bump, o.deprecated ? "**yes**" : "no"]))));
    for (const p of P) {
      if (!p.outdated?.available) { out.push(`\n_${short(p.name)}: outdated check unavailable._`); continue; }
      const minor = p.outdated.items.filter((o) => o.bump === "minor"); const patch = p.outdated.items.filter((o) => o.bump === "patch");
      if (minor.length || patch.length) out.push(`\n_${short(p.name)}: ${minor.length} minor (${minor.map((o) => o.name).join(", ") || "—"}), ${patch.length} patch._`);
    }

    out.push(`\n## Vulnerabilities (audit)\n`);
    out.push(table(["Package", "Critical", "High", "Moderate", "Low", "Top advisories (module · severity · via top-level dep)"],
      P.map((p) => [short(p.name), ...(p.audit?.available ? ["critical", "high", "moderate", "low"].map((s) => p.audit.counts[s] ?? 0) : ["n/a", "n/a", "n/a", "n/a"]),
        p.audit?.available ? (uniq(p.audit.advisories.map((a) => { const viaType = uniq(a.via.map((v) => (p.deps.find((d) => d.name === v) || {}).type || "?")).join("/"); return `${a.module} · ${a.severity} · via ${a.via.join("/") || "?"} (${viaType})`; })).slice(0, 6).join("<br/>") || "—") : "audit unavailable"])));

    out.push(`\n## Licenses\n`);
    out.push(table(["Package", "Summary", "Non-permissive / unknown"],
      P.map((p) => [short(p.name), p.licenses?.available ? Object.entries(p.licenses.summary).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, n]) => `${l}: ${n}`).join(", ") : "n/a", p.licenses?.available ? (p.licenses.flagged.slice(0, 8).map((f) => `${f.name} (${f.license})`).join(", ") || "none") : "n/a"])));
  } else {
    out.push(`\n_Outdated / audit / licenses skipped (--no-network)._`);
  }
  return out.join("\n") + "\n";
}

main();
