import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function loadSw() {
  const ctx = { self: { addEventListener() {}, location: { origin: 'http://x' } }, caches: {}, URL, Promise, setTimeout };
  vm.createContext(ctx); vm.runInContext(read('sw.js'), ctx);
  return ctx;
}

test('sw shell list: every file exists, and the maskable icon, manifest and every @font-face file are in it', () => {
  const ctx = loadSw(), urls = vm.runInContext('SHELL_URLS', ctx);
  for (const u of urls) {
    if (u.endsWith('/')) { assert.ok(fs.existsSync(path.join(root, u, 'index.html')), u); continue; }
    assert.ok(fs.existsSync(path.join(root, u)), 'missing from disk: ' + u);
  }
  assert.ok(urls.includes('./icons/icon-512-maskable.png'));
  const faces = [...read('styles.css').matchAll(/@font-face[^}]*url\("([^"]+)"\)/g)].map((m) => './' + m[1]);
  assert.ok(faces.length >= 1);
  for (const f of faces) assert.ok(urls.includes(f), 'font used by styles.css but not cached: ' + f);
  const manifestIcons = JSON.parse(read('manifest.webmanifest')).icons.map((i) => './' + i.src);
  for (const i of manifestIcons) assert.ok(urls.includes(i), 'manifest icon not cached: ' + i);
  assert.equal(new Set(urls).size, urls.length, 'no duplicates');
});

test('supabase-js is pinned and loaded with the same SRI hash on every page that uses it', () => {
  const tags = ['index.html', 'pay/index.html', 'guest/index.html'].map((f) => read(f).match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\/[^"]+)"([^>]*)>/));
  for (const t of tags) {
    assert.ok(t, 'supabase-js tag found');
    assert.match(t[2], /integrity="sha384-[A-Za-z0-9+/]{64}"/);
    assert.match(t[2], /crossorigin="anonymous"/);
  }
  for (const t of tags.slice(1)) { assert.equal(t[1], tags[0][1]); assert.equal(t[2], tags[0][2]); }
});
