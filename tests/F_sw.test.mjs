// The service worker revalidates same-origin shell files (no stale app.js beside a fresh index.html), and leaves everything else alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), SRC = fs.readFileSync(path.join(HERE, '..', 'sw.js'), 'utf8');

function load(opts = {}) {
  const handlers = {}, fetched = [], store = new Map(), deleted = [];
  class Req { constructor(r, init) { this.url = typeof r === 'string' ? r : r.url; this.method = (r.method || 'GET'); this.mode = r.mode || 'cors'; this.cache = (init && init.cache) || r.cache || 'default'; } }
  const sandbox = { self: { addEventListener: (t, f) => { handlers[t] = f; }, location: new URL('https://x.github.io/Cascade-Staff/sw.js'), clients: { claim: () => Promise.resolve() }, skipWaiting: () => Promise.resolve() },
    module: { exports: {} }, URL, Request: Req, setTimeout, clearTimeout, Promise, importScripts: undefined,
    fetch: (r) => { fetched.push(r); return opts.offline ? Promise.reject(new Error('offline')) : Promise.resolve({ status: 200, type: 'basic', clone() { return this; }, url: r.url }); },
    caches: { match: (r) => Promise.resolve(store.get(typeof r === 'string' ? r.replace(/^\.\//, 'https://x.github.io/Cascade-Staff/') : r.url) || null), open: () => Promise.resolve({ put: (r, v) => { store.set(r.url, v); return Promise.resolve(); } }),
      keys: () => Promise.resolve(['cs-shell-v1', 'cs-shell-v23', 'cs-shell-v24', 'cs-shell-v25', 'cs-shell-v26', 'cs-shell-v27', 'cs-shell-v28', 'cs-shell-v29', 'cs-shell-v30', 'ch-shell-v3', 'other']), delete: (k) => { deleted.push(k); return Promise.resolve(true); } } };
  vm.runInNewContext(SRC, sandbox);
  const run = async (url, mode) => { let p; const req = new Req(url); req.mode = mode || 'cors'; handlers.fetch({ request: req, respondWith: (x) => { p = x; } }); return p ? await p : undefined; };
  return { run, fetched, store, deleted, handlers, sandbox };
}
const B = 'https://x.github.io/Cascade-Staff/';

test('F_ sw: shell files and navigations are fetched with cache: no-cache (the server is asked every time)', async () => {
  const w = load();
  await w.run(B + 'app.js'); await w.run(B + 'lib.js'); await w.run(B + 'styles.css'); await w.run(B, 'navigate'); await w.run(B + 'pay/pay.js');
  assert.equal(w.fetched.length, 5); for (const r of w.fetched) assert.equal(r.cache, 'no-cache', r.url);
  assert.match(SRC, /fetch\(new Request\(req, \{ cache: 'no-cache' \}\)\)/);
});

test('F_ sw: offline, the shell answers from the cache (file and navigation); a successful fetch refreshes the cache', async () => {
  const on = load(); await on.run(B + 'app.js'); await Promise.resolve(); assert.ok(on.store.has(B + 'app.js'), 'cached for later');
  const off = load({ offline: true }); off.store.set(B + 'app.js', { cached: 'js' }); off.store.set(B + 'index.html', { cached: 'index' });
  assert.deepEqual(await off.run(B + 'app.js'), { cached: 'js' }); assert.deepEqual(await off.run(B + 'about', 'navigate'), { cached: 'index' });
});

test('F_ sw: folded apps, Supabase, Telegram and the jsDelivr build are passed through exactly as before', async () => {
  const w = load();
  for (const u of [B + 'admin/app.js', B + 'checklist/', B + 'manual/x.png', B + 'guide/staff/']) assert.equal(await w.run(u), undefined, u + ' is not ours: no respondWith');
  assert.equal(w.fetched.length, 0);
  await w.run('https://abc.supabase.co/rest/v1/x'); await w.run('https://api.telegram.org/x'); await w.run(B + 'functions/v1/y');
  assert.equal(w.fetched.length, 3); for (const r of w.fetched) assert.equal(r.cache, undefined === r.cache ? undefined : 'default', 'handed on untouched, not revalidated by us');
  const js = load(); js.store.set('https://cdn.jsdelivr.net/npm/a.js', { cdn: 1 }); assert.deepEqual(await js.run('https://cdn.jsdelivr.net/npm/a.js'), { cdn: 1 }, 'cache-first');
  assert.equal(await js.run('https://example.org/x.js'), undefined, 'other cross-origin: the browser\'s own handling');
});

test('F_ sw: activate deletes only old cs-shell-* caches and claims clients', async () => {
  const w = load(); let waited; w.handlers.activate({ waitUntil: (p) => { waited = p; } }); await waited;
  assert.deepEqual(w.deleted, ['cs-shell-v1', 'cs-shell-v23', 'cs-shell-v24', 'cs-shell-v25', 'cs-shell-v26', 'cs-shell-v27', 'cs-shell-v28', 'cs-shell-v29', 'cs-shell-v30'], 'ch-shell-* (the checklist) and everything else are left alone');
  assert.match(SRC, /CACHE_NAME = 'cs-shell-v34'/);
});
