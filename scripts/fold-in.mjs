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
const FORBIDDEN = /^(docs|sql|supabase|tests?|node_modules|\..*|.*\.map|readme.*|appsscript\.json|.*\.gs|.*\.md|private|research|content|tools|shots|diagrams|build\.mjs|.*\s.*)$/i; // .*\s.* = names with spaces (sw 2.js, sw deprecated.js)
const SURFACES = {
  admin: { all: true },
  checklist: { files: ['index.html', 'sw.js'], dirs: ['icons', 'fonts'], onlyIfReferenced: ['sw.js'] },
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
  if (spec.all) {
    const all = walk(src, '', false, []), bad = all.filter((f) => /(^|[\\/])\.|\.map$/.test(f));
    if (bad.length) throw new Error(`${name}: refusing a build with dotfiles or source maps (${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', ...' : ''})`);
    return all;
  }
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

// The public System Guide links its siblings by absolute URL; folded, they are one folder up. Exact strings only, counted.
const GUIDE_LINKS = [['https://cascadereservations-del.github.io/CH-Cleaners-Checklist/', '../../checklist/'], ['https://cascadereservations-del.github.io/Cascade-Manual/', '../../manual/'], ['https://cascadereservations-del.github.io/Cascade-Staff/', '../../']];
export function rewriteGuideLinks(html) {
  let n = 0;
  for (const [a, b] of GUIDE_LINKS) { const parts = html.split(a); n += parts.length - 1; html = parts.join(b); }
  return { html, n };
}
export function stripManifestLink(html) { return html.replace(/<link\b[^>]*\brel\s*=\s*["']?manifest["']?[^>]*>[ \t]*\r?\n?/gi, ''); }

const fixCase = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const within = (child, parent) => fixCase(child).startsWith(fixCase(parent) + path.sep);
const same = (a, b) => fixCase(a) === fixCase(b);

export function foldIn(sources, { root = DEFAULT_ROOT, dry = false, now = new Date() } = {}) {
  root = path.resolve(root);
  if (!isFile(path.join(root, 'app.js')) || !isFile(path.join(root, 'manifest.webmanifest'))) throw new Error(`${root} is not the staff app root (no app.js and manifest.webmanifest)`);
  const names = Object.keys(SURFACES).filter((n) => sources[n]);
  if (!names.length) throw new Error('nothing to fold: give at least one of --admin --checklist --manual --guide');
  const plans = names.map((n) => ({ name: n, src: path.resolve(sources[n]), files: plan(n, path.resolve(sources[n])) })); // every source is checked before anything is touched
  for (const p of plans) {
    p.target = path.resolve(root, p.name);
    if (!same(path.dirname(p.target), root) || same(p.src, p.target) || within(p.src, p.target)) throw new Error(`${p.name}: refusing to write outside the staff app root or onto its own source`);
  }
  const mf = path.join(root, 'fold-manifest.json'), rows = [];
  for (const p of plans) {
    let bytes = 0;
    const tmp = path.join(root, `.fold-tmp-${p.name}`), old = path.join(root, `.fold-old-${p.name}`);
    if (!dry) { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); }
    const put = (f, data) => { if (dry) return; fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), data); };
    for (const f of p.files) {
      const from = path.join(p.src, f);
      if (p.name === 'checklist' && f === 'index.html') { // one install only: the checklist must not offer its own manifest
        const html = stripManifestLink(fs.readFileSync(from, 'utf8')); bytes += Buffer.byteLength(html); put(f, html);
      } else if (p.name === 'guide' && f === 'staff/index.html') {
        const r = rewriteGuideLinks(fs.readFileSync(from, 'utf8')); bytes += Buffer.byteLength(r.html); p.rewrites = r.n; put(f, r.html);
      } else {
        bytes += fs.statSync(from).size;
        if (!dry) { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.copyFileSync(from, path.join(tmp, f)); }
      }
    }
    if (!dry) { // swap: target -> old, tmp -> target, drop old; put the old one back if the second rename fails
      const had = fs.existsSync(p.target);
      if (had) fs.renameSync(p.target, old);
      try { fs.renameSync(tmp, p.target); } catch (e) { if (had) fs.renameSync(old, p.target); throw e; }
      fs.rmSync(old, { recursive: true, force: true });
    }
    if (p.rewrites != null) console.log(`guide/staff/index.html: ${p.rewrites} sibling link(s) rewritten`);
    const row = { surface: p.name, source: p.src, head: head(p.src), files: p.files.length, bytes, time: now.toISOString() };
    rows.push(row);
    if (!dry) { // recorded as each surface lands, so a mid-run failure never leaves an unrecorded folder; no local absolute paths are published
      let old2 = {}; try { old2 = JSON.parse(fs.readFileSync(mf, 'utf8')).surfaces || {}; } catch { /* first fold */ }
      old2[p.name] = { source: path.basename(p.src), head: row.head, files: row.files, bytes: row.bytes, time: row.time };
      if (p.name === 'guide') old2.guide.adminGuide = p.files.includes('admin/index.html');
      fs.writeFileSync(mf, JSON.stringify({ schema: 1, surfaces: old2 }, null, 2) + '\n');
    }
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
