// Session 120, lane R9: a real Chromium (Playwright) against the real checklist page, for the cases a source-text harness cannot show (IndexedDB, layout, the order of writes).
// Nothing leaves the machine: the page is served from a local port and every Supabase or other outside request is answered here. The session and the draft are made up for the test.
// If Playwright or a Chromium cannot be found, browser() returns null and the test says why it skipped; set PW_CORE and PW_CHROME to point at them.
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = process.env.S120_PAGE_ROOT ? join(process.env.S120_PAGE_ROOT, '/') : fileURLToPath(new URL('../checklist/', import.meta.url));   // S120_PAGE_ROOT: run the same tests against another copy of the page (the base commit)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

const firstExisting = list => list.find(p => p && existsSync(p));
function findCore() {
  const req = createRequire(import.meta.url);
  const roots = [process.env.PW_CORE, join(process.env.APPDATA || '', 'npm/node_modules/playwright-mcp-server/node_modules/playwright-core'), join(process.env.APPDATA || '', 'npm/node_modules/omniroute/node_modules/playwright-core')];
  for (const p of roots) { if (p && existsSync(p)) { try { return req(p); } catch { /* next */ } } }
  try { return req('playwright-core'); } catch { return null; }
}
function findChrome() {
  if (process.env.PW_CHROME && existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  const base = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'ms-playwright');
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  return firstExisting(dirs.map(d => join(base, d, 'chrome-win64/chrome.exe')).concat(dirs.map(d => join(base, d, 'chrome-win/chrome.exe'))));
}

let shared = null;
/* one browser and one local server for the whole file; returns null when none can be had */
export async function browser() {
  if (shared) return shared;
  shared = (async () => {
    const core = findCore(), exe = findChrome();
    if (!core || !exe) return null;
    const server = http.createServer((req, res) => {
      const path = decodeURIComponent(req.url.split('?')[0]);
      if (path === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
      const file = join(ROOT, path === '/' ? 'index.html' : path);
      if (!file.startsWith(ROOT) || !existsSync(file) || file === ROOT) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(readFileSync(file));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const b = await core.chromium.launch({ executablePath: exe, headless: true });
    return { b, server, url: 'http://127.0.0.1:' + server.address().port + '/' };
  })();
  return shared;
}
/* The browser tests run, or they fail: a missing Playwright or Chromium is a red test, never a silent skip. S120_ALLOW_NO_BROWSER=1 turns that into a skip (a machine that cannot have one). */
export async function browserSuite(test, assert) {
  const have = await browser();
  const allowed = process.env.S120_ALLOW_NO_BROWSER === '1';
  if (!have && !allowed) test('a real browser is available for the browser tests', () => assert.fail('Playwright or a Chromium was not found. Set PW_CORE and PW_CHROME, or set S120_ALLOW_NO_BROWSER=1 to skip these tests.'));
  return (name, fn) => test(name, { skip: have ? false : 'Playwright or a Chromium was not found (S120_ALLOW_NO_BROWSER=1)', timeout: 90000 }, fn);
}
export async function closeBrowser() {
  if (!shared) return;
  const s = await shared; shared = null;
  if (s) { await s.b.close(); s.server.close(); }
}

const SESSION = { access_token: 'test-access', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user: { id: 'u-test', email: 'test.cleaner@example.test', user_metadata: { display_name: 'Test Cleaner' } } };
export const MANILA_TODAY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

/* a made-up draft the page of the live version c5350f1 would write: nothing here is a real guest or key */
export function draftOf(over = {}) {
  const today = MANILA_TODAY();
  const photo = (name, idbId) => ({ name, url: idbId ? '' : 'https://drive.example.test/' + name, fileId: idbId ? '' : 'f-' + name, uploaded: !idbId, status: idbId ? 'queued' : 'done', idbId: idbId || null, slot: null, takenAt: null });
  return {
    _v: 5, _k: 2, _saved: Date.now(), phase: 1, cleanerName: 'Test Cleaner', cleaningDate: today, checkInDate: today, checkOutDate: today, numberOfNights: 1, lastGuestName: '', startTime: '', startTimestamp: Date.now() - 600000,
    electricReading: '', waterReading: '', conditionStatus: null, conditionNote: '', meterVerified: false, meterSkipReason: '', isWeeklyIncluded: false, checklist: {}, issueFlags: {}, confirmItems: {}, confirmNotes: {},
    supplyLogSaved: false, linen: null, restock: null, cleaningType: 'turnover', extraExpenses: [], sessionFolderId: null, sessionFolderUrl: null, submissionId: 'sub-test-1',
    meterPhotoMeta: [photo('m0.jpg', 'idb-m0'), null], precleanPhotoMeta: [photo('p1.jpg', 'idb-p1'), photo('p2.jpg', 'idb-p2'), photo('p3.jpg')], bedroomPhotoMeta: [], kitchenPhotoMeta: [], aftercleanPhotoMeta: [],
    ...over,
  };
}

/* opens a fresh context: signed in, no PIN, every outside request answered here. t.calls lists the requests the page sent to the (fake) server. */
export async function openPage({ draft, blobs = [], viewport = { width: 375, height: 700 }, answers = {} } = {}) {
  const s = await browser();
  const ctx = await s.b.newContext({ viewport, serviceWorkers: 'block' });
  const t = { ctx, calls: [], ops: [], answers, s };
  await ctx.addInitScript(({ session, draft }) => {
    try { Object.defineProperty(window.crypto, 'subtle', { value: undefined }); } catch { /* ignore */ }
    try { if (!localStorage.getItem('ch_staff_session_v1')) localStorage.setItem('ch_staff_session_v1', JSON.stringify(session)); } catch { /* ignore */ }
    if (draft) { try { if (!localStorage.getItem('__seeded')) { localStorage.setItem('ch_draft_v6', draft); localStorage.setItem('__seeded', '1'); } } catch { /* ignore */ } }
    // every blob delete and every draft write goes on one list, in order, so a test can say which came first
    window.__s120Test = true;   // makes the page expose its state and a few functions as window.__s120 (see the end of checklist/index.html)
    window.__ops = []; window.__drafts = []; window.__atSend = [];
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (k) {
      window.__ops.push('delete:' + k);
      if (window.__failDelete === 'abort') { this.transaction.abort(); return undefined; }   // the transaction aborts: no complete, no error event on the request
      return del.call(this, k);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { if (window.__abortPut) { this.transaction.abort(); return undefined; } return put.apply(this, arguments); };   // __abortPut: the write aborts on its own (abort event only, no error event)
    const txn = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (store, mode) {
      if (window.__failDelete === 'throw' && mode === 'readwrite') throw new DOMException('transaction failed', 'InvalidStateError');
      // __hangTx = 'write' | 'read' | 'all': a transaction that never fires an event (a store call that never settles)
      const h = window.__hangTx; if (h && (h === 'all' || (h === 'write') === (mode === 'readwrite'))) { const req = { set onsuccess(f) {}, set onerror(f) {} }; const os = { put() { return req; }, get() { return req; }, delete() { return req; } }; return { objectStore() { return os; }, set oncomplete(f) {}, set onerror(f) {}, set onabort(f) {}, abort() {} }; }
      // __holdReal = ms: once the Resume question is closed, the first read starts a REAL readwrite transaction on the store and keeps it busy for that long; every later transaction on the store waits behind it
      if (window.__holdReal && !window.__holdStarted && mode !== 'readwrite' && !document.getElementById('draft-modal')?.classList.contains('open')) {
        window.__holdStarted = true;
        const os = txn.call(this, store, 'readwrite').objectStore(store), end = Date.now() + window.__holdReal;
        const tick = () => { if (Date.now() < end) os.get('__none').onsuccess = tick; };
        tick();
      }
      return txn.apply(this, arguments);
    };
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'ch_draft_v6' && window.__failSave) throw new DOMException('full', 'QuotaExceededError');
      // storage full: the carry key fits only once the old draft is gone ('until-cleared'), or never ('always')
      if (k === 'ch_s120_carry' && (window.__fullCarry === 'always' || (window.__fullCarry === 'until-cleared' && localStorage.getItem('ch_draft_v6') !== null))) throw new DOMException('full', 'QuotaExceededError');
      if (k === 'ch_draft_v6') { window.__drafts.push(String(v)); window.__ops.push('draft:' + (String(v).match(/"url":"https:[^"]*"/g) || []).length); } return set.call(this, k, v); };
    // what the stored draft held at the moment each upload or send request left the page
    const ofetch = window.fetch;
    window.fetch = function (u) { try { const url = String((u && u.url) || u); if (url.includes('/rpc/record_') || url.includes('/upload-photo')) { window.__atSend.push({ url, draft: localStorage.getItem('ch_draft_v6') }); window.__ops.push('req:' + url.split('/').pop()); } } catch (e) { /* ignore */ } return ofetch.apply(this, arguments); };
    const iopen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function () { if (window.__hangOpen > 0) { window.__hangOpen--; return {}; }   // __hangOpen = n: the next n opens never answer
      if (window.__slowOpen) {   // __slowOpen = ms: the next open answers that late (it is a real open that only starts then)
        const ms = window.__slowOpen, args = arguments, self = this, fake = {}; window.__slowOpen = 0;
        setTimeout(() => { const real = iopen.apply(self, args); Object.defineProperty(fake, 'result', { get: () => real.result }); real.onupgradeneeded = e => fake.onupgradeneeded && fake.onupgradeneeded(e); real.onsuccess = e => fake.onsuccess && fake.onsuccess(e); real.onerror = e => fake.onerror && fake.onerror(e); }, ms);
        return fake;
      }
      if (!window.__failOpen) return iopen.apply(this, arguments); const req = {}; setTimeout(() => { if (req.onerror) req.onerror({ target: req }); }, 0); return req; };
    // test switches: __hangTx = 'write' | 'read' | 'all' makes a blob transaction that never settles; __failOpen / __failGet make the blob store fail to open / read; __failDelete = 'throw' | 'abort' makes a blob delete fail; __fullCarry = 'until-cleared' | 'always' makes the carry key not fit; __gate holds every blob read until it settles; __failRestore makes a restored photo throw; __failSave makes every draft write fail; __bootBreak makes the page's first form step throw
    // __slowComplete = ms: every transaction reports 'complete' that many ms late (a slow delete that does finish)
    const od = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { configurable: true, get() { return od.get.call(this); }, set(fn) { od.set.call(this, typeof fn === 'function' ? function (e) { const ms = window.__slowComplete; if (ms) setTimeout(() => fn.call(this, e), ms); else fn.call(this, e); } : fn); } });
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (k) {
      const req = get.call(this, k);
      if (window.__failGet) return { get result() { return undefined; }, get error() { return null; }, set onsuccess(fn) { /* never */ }, set onerror(fn) { setTimeout(() => fn({ target: this }), 0); } };
      // __slowRead = ms: a read made after the Resume question is closed (an upload's read) answers that late
      if (window.__slowRead && !document.getElementById('draft-modal')?.classList.contains('open')) { const ms = window.__slowRead; return { get result() { return req.result; }, set onsuccess(fn) { req.onsuccess = () => setTimeout(() => fn({ target: req }), ms); }, set onerror(fn) { req.onerror = fn; } }; }
      if (!window.__gate) return req;
      const gate = window.__gate;
      return { get result() { return req.result; }, set onsuccess(fn) { req.onsuccess = () => gate.then(() => fn({ target: req })); }, set onerror(fn) { req.onerror = fn; } };
    };
    const cou = URL.createObjectURL;
    URL.createObjectURL = function (b) { if (window.__failRestore) throw new Error('cannot read the photo'); return cou.call(this, b); };
    const byId = Document.prototype.getElementById;
    Document.prototype.getElementById = function (id) { if (window.__bootBreak && id === 'cleaningDate') throw new Error('boot break'); return byId.call(this, id); };
  }, { session: SESSION, draft: draft ? JSON.stringify(draft) : null });
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1') return route.continue();
    const rec = { url: route.request().url(), method: route.request().method(), body: route.request().postData() || '' };
    t.calls.push(rec);
    const custom = t.answers.handler && t.answers.handler(rec, route);
    if (custom === 'held') return undefined;
    if (custom) return route.fulfill(custom);
    if (u.hostname.endsWith('supabase.co')) {
      if (u.pathname.includes('/auth/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: u.pathname.includes('/rpc/') ? '{}' : '[]' });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  t.page = page; t.url = s.url;
  t.errors = []; page.on('pageerror', e => t.errors.push(String(e)));
  t.close = () => ctx.close();
  // put photo blobs in IndexedDB the way the page does (store 'photos', key = idbId); done on the page's own origin before it boots
  t.putBlobs = async list => {
    await page.evaluate(async list => {
      const db = await new Promise((ok, no) => { const r = indexedDB.open('ch_photos_v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      await new Promise((ok, no) => { const tx = db.transaction('photos', 'readwrite'); list.forEach(id => tx.objectStore('photos').put(new Blob([new Uint8Array(64).fill(7)], { type: 'image/jpeg' }), id)); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
      db.close();
    }, list);
  };
  t.blobIds = () => page.evaluate(async () => {
    const db = await new Promise(ok => { const r = indexedDB.open('ch_photos_v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => ok(r.result); });
    const keys = await new Promise(ok => { const r = db.transaction('photos').objectStore('photos').getAllKeys(); r.onsuccess = () => ok(r.result); });
    db.close(); return keys.sort();
  });
  t.stored = () => page.evaluate(() => localStorage.getItem('ch_draft_v6'));
  t.ops_ = () => page.evaluate(() => window.__ops.slice());
  /* the first load only seeds the origin so the blobs can be written; then the page loads for real */
  t.boot = async () => {
    await page.goto(s.url + '__blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (blobs.length) await t.putBlobs(blobs);
    await page.goto(s.url, { waitUntil: 'domcontentloaded' });
  };
  return t;
}
