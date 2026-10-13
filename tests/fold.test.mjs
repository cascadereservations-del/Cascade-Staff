import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { foldIn, stripManifestLink } from '../scripts/fold-in.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'fold-in.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fold-'));
function tree(root, files) { for (const [f, c] of Object.entries(files)) { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); } return root; }
function list(root, rel = '') { return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(root, path.join(rel, e.name)) : [path.join(rel, e.name).replace(/\\/g, '/')]).sort(); }

const appRoot = (files = {}) => tree(tmp(), { 'app.js': 'x', 'manifest.webmanifest': '{}', ...files });
const CHECK = {
  'index.html': '<html><head><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icons/i.png"><script src="install.js"></script></head><script>navigator.serviceWorker.register("sw.js")</script></html>',
  'sw.js': 'x', 'install.js': 'x', 'install.html': 'x', 'manifest.webmanifest': '{}', 'icons/i.png': 'p', 'fonts/f.woff2': 'f',
  'docs/a.md': 'd', 'sql/a.sql': 's', 'supabase/c.toml': 's', 'tests/t.js': 't', 'Code.gs': 'g', 'appsscript.json': '{}', '.gitignore': 'x', 'README.md': 'r', 'icons/README.md': 'r', 'icons/x.gs': 'g', 'sw 2.js': 'o', 'sw deprectaed.js': 'o'
};

test('checklist: allow-list honoured, forbidden files never copied, manifest link stripped', () => {
  const root = appRoot(), src = tree(tmp(), CHECK);
  const rows = foldIn({ checklist: src }, { root });
  // install files, the manifest and names with spaces never go in
  assert.deepEqual(list(path.join(root, 'checklist')), ['fonts/f.woff2', 'icons/i.png', 'index.html', 'sw.js']);
  const html = fs.readFileSync(path.join(root, 'checklist', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /rel="manifest"/); assert.match(html, /rel="icon"/);
  assert.equal(rows[0].files, 4);
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'fold-manifest.json'), 'utf8'));
  assert.equal(mf.surfaces.checklist.files, 4); assert.ok(mf.surfaces.checklist.bytes > 0); assert.ok(mf.surfaces.checklist.time); assert.ok('head' in mf.surfaces.checklist);
});

test('checklist: sw.js and install files are copied only when index.html names them', () => {
  const root = appRoot(), src = tree(tmp(), { ...CHECK, 'index.html': '<html>nothing here</html>' });
  foldIn({ checklist: src }, { root });
  assert.deepEqual(list(path.join(root, 'checklist')), ['fonts/f.woff2', 'icons/i.png', 'index.html']);
});

test('admin copies everything; manual and guide take only their allow-list; the manifest merges across runs', () => {
  const root = appRoot();
  const admin = tree(tmp(), { 'index.html': 'a', 'assets/x.js': 'x', 'assets/y.css': 'y' });
  const manual = tree(tmp(), { 'index.html': 'm', 'img/a.png': 'p', 'notes.txt': 'n', 'docs/d.md': 'd', 'README.md': 'r' });
  const guide = tree(tmp(), { 'index.html': 'g', 'staff/index.html': 's', 'admin/index.html': 'a', 'assets/a.js': 'j', 'img/i.png': 'i', 'research/r.md': 'r', 'tools/t.mjs': 't', 'private/p.md': 'p', 'build.mjs': 'b', 'staff/notes.md': 'n', 'content/c.md': 'c' });
  foldIn({ admin }, { root }); foldIn({ manual, guide }, { root });
  assert.deepEqual(list(path.join(root, 'admin')), ['assets/x.js', 'assets/y.css', 'index.html']);
  assert.deepEqual(list(path.join(root, 'manual')), ['img/a.png', 'index.html']);
  assert.deepEqual(list(path.join(root, 'guide')), ['admin/index.html', 'assets/a.js', 'img/i.png', 'index.html', 'staff/index.html']);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'fold-manifest.json'), 'utf8')).surfaces).sort(), ['admin', 'guide', 'manual']);
});

test('a refold replaces the old folder and touches nothing else in the app root', () => {
  const root = appRoot({ 'index.html': 'app', 'admin/old.js': 'old', 'pay/p.js': 'p' });
  foldIn({ admin: tree(tmp(), { 'index.html': 'new' }) }, { root });
  assert.deepEqual(list(root), ['admin/index.html', 'app.js', 'fold-manifest.json', 'index.html', 'manifest.webmanifest', 'pay/p.js']);
});

test('refuses a bad source: no index.html, not a folder, nothing given, a source inside its target', () => {
  const root = appRoot();
  assert.throws(() => foldIn({ manual: tree(tmp(), { 'x.html': '1' }) }, { root }), /no index\.html/);
  assert.throws(() => foldIn({ manual: path.join(tmp(), 'missing') }, { root }), /not a folder/);
  assert.throws(() => foldIn({}, { root }), /nothing to fold/);
  assert.throws(() => foldIn({ guide: tree(tmp(), { 'index.html': 'g' }), manual: tree(tmp(), {}) }, { root }), /manual/);
  assert.deepEqual(fs.readdirSync(root).sort(), ['app.js', 'manifest.webmanifest'], 'one bad source stops the whole run before anything is written');
  tree(root, { 'admin/index.html': 'a' });
  assert.throws(() => foldIn({ admin: path.join(root, 'admin') }, { root }), /refusing/);
});

test('--dry reports but writes and deletes nothing', () => {
  const root = appRoot({ 'manual/old.html': 'keep me' }), src = tree(tmp(), { 'index.html': 'm' });
  const r = spawnSync(process.execPath, [SCRIPT, '--manual', src, '--dry', '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /DRY RUN/); assert.match(r.stdout, /manual/);
  assert.deepEqual(list(root), ['app.js', 'manifest.webmanifest', 'manual/old.html']);
});

test('CLI exits 1 with a message on a bad source', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--guide', tmp(), '--root', appRoot()], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /no index\.html/);
});

test('guide staff links to siblings are rewritten (exact strings, counted); other links stay', () => {
  const root = appRoot(), A = 'https://cascadereservations-del.github.io/';
  const guide = tree(tmp(), { 'index.html': 'g', 'staff/index.html': `<a href="${A}CH-Cleaners-Checklist/">c</a><a href="${A}Cascade-Manual/">m</a><a href="${A}Cascade-Staff/">s</a><a href="${A}Cascade-Manual/">m2</a><a href="https://t.me/x">t</a>` });
  foldIn({ guide }, { root });
  assert.equal(fs.readFileSync(path.join(root, 'guide/staff/index.html'), 'utf8'), '<a href="../../checklist/">c</a><a href="../../manual/">m</a><a href="../../">s</a><a href="../../manual/">m2</a><a href="https://t.me/x">t</a>');
});

test('sw: activate deletes only old cs-shell caches, never a foreign cache', () => {
  const sandbox = { self: { addEventListener() {}, location: { href: 'https://x.github.io/Cascade-Staff/sw.js' } }, module: { exports: {} }, URL, caches: {}, fetch() {}, setTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, '..', 'sw.js'), 'utf8'), sandbox);
  const { staleShellCache } = sandbox.module.exports;
  assert.equal(staleShellCache('cs-shell-v16'), true); assert.equal(staleShellCache('cs-shell-v18'), false);
  for (const k of ['ch-shell-v3', 'ch-data', 'workbox-x']) assert.equal(staleShellCache(k), false, k);
});

test('manifest publishes the folder name, not the local path; adminGuide is recorded', () => {
  const root = appRoot(), guide = tree(path.join(tmp(), 'system-guide'), { 'index.html': 'g', 'staff/index.html': 's', 'admin/index.html': 'a' });
  const rows = foldIn({ guide }, { root });
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'fold-manifest.json'), 'utf8'));
  assert.equal(mf.surfaces.guide.source, 'system-guide'); assert.doesNotMatch(JSON.stringify(mf), /fold-|Users|tmp/i); assert.ok(path.isAbsolute(rows[0].source));
  assert.equal(mf.surfaces.guide.adminGuide, true);
  foldIn({ guide: tree(tmp(), { 'index.html': 'g', 'staff/index.html': 's' }) }, { root });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'fold-manifest.json'), 'utf8')).surfaces.guide.adminGuide, false);
});

test('dotfiles and source maps: skipped on allow-listed surfaces, a refused run for admin', () => {
  const root = appRoot();
  foldIn({ manual: tree(tmp(), { 'index.html': 'm', 'img/a.png': 'p', 'img/.DS_Store': 'x', 'img/a.png.map': 'm', 'img/.hid/y.png': 'y' }) }, { root });
  assert.deepEqual(list(path.join(root, 'manual')), ['img/a.png', 'index.html']);
  for (const bad of ['assets/a.js.map', '.env', 'assets/.hidden']) assert.throws(() => foldIn({ admin: tree(tmp(), { 'index.html': 'a', [bad]: 'x' }) }, { root }), /dotfiles or source maps/, bad);
  assert.ok(!fs.existsSync(path.join(root, 'admin')));
});

test('swap leaves no temp folders; the root must be the staff app', () => {
  const root = appRoot({ 'guide/old.txt': 'o' });
  foldIn({ guide: tree(tmp(), { 'index.html': 'g' }) }, { root });
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith('.fold-')), []);
  assert.throws(() => foldIn({ guide: tree(tmp(), { 'index.html': 'g' }) }, { root: tmp() }), /not the staff app root/);
});

test('stripManifestLink removes only the manifest link', () => {
  assert.equal(stripManifestLink('<link rel="icon" href="a"><link href="m.json" rel=manifest>\n<b>'), '<link rel="icon" href="a"><b>');
});

// ---- service worker routing ----------------------------------------------------------------------------------------
test('sw: folded apps go straight to the network, the shell stays cached, the cache name moved on', () => {
  const sandbox = { self: { addEventListener() {}, location: { href: 'https://x.github.io/Cascade-Staff/sw.js' } }, module: { exports: {} }, URL, caches: {}, fetch() {}, setTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, '..', 'sw.js'), 'utf8'), sandbox);
  const { swRoute, CACHE_NAME } = sandbox.module.exports, B = '/Cascade-Staff/';
  assert.equal(CACHE_NAME, 'cs-shell-v18');
  for (const p of ['admin/', 'admin/assets/a.js', 'checklist/', 'checklist/sw.js', 'manual/img/x.png', 'guide/staff/', 'guide/admin/index.html', 'admin', '%61dmin/x', 'adm%ZZ/']) assert.equal(swRoute(B + p, B), 'network', p);
  for (const p of ['', 'index.html', 'app.js', 'pay/', 'quick/', 'install/', 'adminx/', 'icons/icon-192.png', 'fold-manifest.json']) assert.equal(swRoute(B + p, B), 'shell', p);
  assert.equal(swRoute('/other/admin/', B), 'shell');
});
