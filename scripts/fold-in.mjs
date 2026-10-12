#!/usr/bin/env node
// Fold sibling surfaces into the staff app as subfolders (D-324). Node 20+, no dependencies.
//   node scripts/fold-in.mjs --admin <dist dir> --checklist <repo dir> --manual <repo dir> --guide <repo dir> [--dry]
// Each flag is optional (only what is given is folded). A target folder (admin/ checklist/ manual/ guide/) is replaced by an
// allow-listed copy of its source; nothing else in the staff app is ever deleted. Writes fold-manifest.json at the app root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Never copied from a repo-style source (admin dist is a build output, so it is copied whole).
const FORBIDDEN = /^(docs|sql|supabase|tests?|node_modules|\.git.*|readme.*|appsscript\.json|.*\.gs)$/i;
const SURFACES = {
  admin: { all: true },
  checklist: { files: ['index.html', 'sw.js', 'install.js', 'install.html'], dirs: ['icons', 'fonts'], onlyIfReferenced: ['sw.js', 'install.js', 'install.html'] },
  manual: { files: ['index.html'], dirs: ['img'] },
  guide: { files: ['index.html'], dirs: ['staff', 'admin', 'assets', 'img'] }
};

const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };

function walk(dir, rel, deny, out) { // regular files and directories only: symlinks are skipped
  for (const name of fs.readdirSync(dir).sort()) {
    if (deny && FORBIDDEN.test(name)) continue;
    const full = path.join(dir, name), r = rel ? rel + '/' + name : name;
    if (isDir(full)) walk(full, r, deny, out); else if (isFile(full)) out.push(r);
  }
  return out;
}

export function plan(name, src) { // -> sorted list of relative file paths to copy; throws on a bad source
  const spec = SURFACES[name];
  if (!isDir(src)) throw new Error(`${name}: source is not a folder: ${src}`);
  if (!isFile(path.join(src, 'index.html'))) throw new Error(`${name}: source has no index.html: ${src}`);
  if (spec.all) return walk(src, '', false, []);
  const index = fs.readFileSync(path.join(src, 'index.html'), 'utf8'), out = [];
  for (const f of spec.files) {
    if (!isFile(path.join(src, f))) continue;
    if ((spec.onlyIfReferenced || []).includes(f) && !index.includes(f)) continue;
    out.push(f);
  }
  for (const d of spec.dirs) if (isDir(path.join(src, d))) walk(path.join(src, d), d, true, out);
  return out.sort();
}

function head(src) {
  try { return execFileSync('git', ['-c', 'safe.directory=*', '-C', src, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown'; } catch { return 'unknown'; }
}

export function stripManifestLink(html) { return html.replace(/<link\b[^>]*\brel\s*=\s*["']?manifest["']?[^>]*>[ \t]*\r?\n?/gi, ''); }

export function foldIn(sources, { root = DEFAULT_ROOT, dry = false, now = new Date() } = {}) {
  root = path.resolve(root);
  const names = Object.keys(SURFACES).filter((n) => sources[n]);
  if (!names.length) throw new Error('nothing to fold: give at least one of --admin --checklist --manual --guide');
  const plans = names.map((n) => ({ name: n, src: path.resolve(sources[n]), files: plan(n, path.resolve(sources[n])) })); // every source is checked before anything is touched
  for (const p of plans) {
    p.target = path.resolve(root, p.name);
    if (path.dirname(p.target) !== root || p.src === p.target || p.src.startsWith(p.target + path.sep)) throw new Error(`${p.name}: refusing to write outside the staff app root or onto its own source`);
  }
  const rows = [];
  for (const p of plans) {
    let bytes = 0;
    const tmp = path.join(root, `.fold-tmp-${p.name}`);
    if (!dry) { fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); }
    for (const f of p.files) {
      const from = path.join(p.src, f);
      if (p.name === 'checklist' && f === 'index.html') { // one install only: the checklist must not offer its own manifest
        const html = stripManifestLink(fs.readFileSync(from, 'utf8')); bytes += Buffer.byteLength(html);
        if (!dry) { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), html); }
      } else {
        bytes += fs.statSync(from).size;
        if (!dry) { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.copyFileSync(from, path.join(tmp, f)); }
      }
    }
    if (!dry) { fs.rmSync(p.target, { recursive: true, force: true }); fs.renameSync(tmp, p.target); }
    rows.push({ surface: p.name, source: p.src, head: head(p.src), files: p.files.length, bytes, time: now.toISOString() });
  }
  if (!dry) {
    const mf = path.join(root, 'fold-manifest.json');
    let old = {}; try { old = JSON.parse(fs.readFileSync(mf, 'utf8')).surfaces || {}; } catch { /* first fold */ }
    for (const r of rows) old[r.surface] = { source: r.source, head: r.head, files: r.files, bytes: r.bytes, time: r.time };
    fs.writeFileSync(mf, JSON.stringify({ schema: 1, surfaces: old }, null, 2) + '\n');
  }
  return rows;
}

export function table(rows) {
  const line = (r) => [r.surface.padEnd(10), String(r.head).padEnd(9), String(r.files).padStart(6), String(r.bytes).padStart(11), r.source].join('  ');
  return ['surface     head       files       bytes  source', ...rows.map(line)].join('\n');
}

function main(argv) {
  const src = {}, flags = new Set(['admin', 'checklist', 'manual', 'guide']);
  let dry = false, root;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') dry = true;
    else if (a === '--root') root = argv[++i]; // tests only
    else if (a.startsWith('--') && flags.has(a.slice(2)) && argv[i + 1] && !argv[i + 1].startsWith('--')) src[a.slice(2)] = argv[++i];
    else throw new Error('unknown or incomplete argument: ' + a);
  }
  const rows = foldIn(src, { root, dry });
  console.log((dry ? 'DRY RUN - nothing written\n' : '') + table(rows));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('fold-in: ' + e.message); process.exit(1); }
}
