// s111 Phone check (Lloyd: "a one time checker if notifications and necessary functions are on by default; if not, a button to fix"). Pure mapping in lib.js
// (CS.phoneCheckRows / phoneFixPlan / phoneCheckDue), the sheet and Fix all in app.js, driven through the lane A harness with fake browser APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { read, boot, baseHandlers, CS } from './_a_harness.mjs';

const C_Push = createRequire(import.meta.url)('../pay/C_push.js');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const OK = { ua: 'Android', alerts: { support: 'ready', permission: 'granted', subscribed: true }, install: { standalone: true }, camera: { has: true, perm: 'granted' }, storage: { api: true, persisted: true }, update: { sw: true, controller: true, waiting: false, cacheOk: true }, trusted: true };
const probe = (o) => Object.assign({}, OK, o);
const row = (rows, id) => rows.find((r) => r.id === id);

test('s111 phone check: run once per device, again after a version that adds a check, and every time when storage is unavailable', () => {
  const m = {}; const ls = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
  assert.equal(CS.phoneCheckDue(ls), true, 'never run on this device');
  assert.equal(CS.phoneCheckSave(ls, CS.phoneCheckRows(probe({ storage: { api: true, persisted: false } }))), true);
  const saved = JSON.parse(m.cs_phone_check); assert.equal(saved.v, CS.PHONE_CHECK_VER); assert.deepEqual(saved.open, ['storage'], 'only the rows Fix all can still fix');
  assert.equal(CS.phoneCheckDue(ls), false, 'run once'); assert.deepEqual(CS.phoneCheckOpen(ls), ['storage']);
  m.cs_phone_check = JSON.stringify({ v: CS.PHONE_CHECK_VER - 1, open: [] }); assert.equal(CS.phoneCheckDue(ls), true, 'an update that adds a check runs it again');
  m.cs_phone_check = '{bad json'; assert.equal(CS.phoneCheckDue(ls), true); assert.deepEqual(CS.phoneCheckOpen(ls), []);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(CS.phoneCheckDue(broken), true, 'no storage: it just runs again next time'); assert.equal(CS.phoneCheckSave(broken, []), false); assert.equal(CS.phoneCheckDue(null), true);
});

test('s111 phone check: each check maps to OK / Needs a tap / Not possible here from the real probe values only', () => {
  const all = CS.phoneCheckRows(OK); assert.deepEqual(all.map((r) => [r.id, r.state]), [['alerts', 'ok'], ['install', 'ok'], ['camera', 'ok'], ['storage', 'ok'], ['update', 'ok'], ['trust', 'ok']]);
  assert.deepEqual([...CS.phoneFixPlan(all)], []);
  const cases = [
    [{ alerts: { support: 'ready', permission: 'default' } }, 'alerts', 'tap', true], [{ alerts: { support: 'ready', permission: 'granted', subscribed: false } }, 'alerts', 'tap', true, 'granted but no saved subscription is not OK'],
    [{ alerts: { support: 'blocked' } }, 'alerts', 'tap', false], [{ alerts: { support: 'needs_install' } }, 'alerts', 'tap', false], [{ alerts: { support: 'unsupported' } }, 'alerts', 'no', false],
    [{ install: { standalone: false, canPrompt: true } }, 'install', 'tap', true], [{ install: { standalone: false, ios: true } }, 'install', 'tap', false], [{ install: { standalone: false } }, 'install', 'tap', false],
    [{ camera: { has: false } }, 'camera', 'no', false], [{ camera: { has: true, perm: 'prompt' } }, 'camera', 'tap', true], [{ camera: { has: true, perm: 'denied' } }, 'camera', 'tap', false], [{ camera: { has: true, perm: null } }, 'camera', 'no', false, 'unknown is never OK'],
    [{ storage: { api: true, persisted: false } }, 'storage', 'tap', true], [{ storage: { api: false } }, 'storage', 'no', false],
    [{ update: { sw: true, controller: true, waiting: true, cacheOk: true } }, 'update', 'tap', true], [{ update: { sw: true, controller: true, waiting: false, cacheOk: false } }, 'update', 'tap', true, 'cache of another version'], [{ update: { sw: true, controller: false, cacheOk: true } }, 'update', 'tap', true], [{ update: { sw: false } }, 'update', 'no', false],
    [{ trusted: false }, 'trust', 'tap', false, 'shown, never changed by Fix all']];
  for (const [o, id, state, fix, why] of cases) { const r = row(CS.phoneCheckRows(probe(o)), id); assert.equal(r.state, state, JSON.stringify(o) + (why ? ' ' + why : '')); assert.equal(r.fix, fix, id + ' fix'); assert.ok(r.text && !/!/.test(r.text)); }
  assert.match(row(CS.phoneCheckRows(probe({ trusted: false })), 'trust').steps[0], /sign out, then turn on Trust this device/);
});

test('s111 phone check: Fix all order is alerts, storage, install, camera, update, and only for rows Fix all can do', () => {
  const rows = CS.phoneCheckRows(probe({ alerts: { support: 'ready', permission: 'default' }, install: { standalone: false, canPrompt: true }, camera: { has: true, perm: 'prompt' }, storage: { api: true, persisted: false }, update: { sw: true, controller: true, waiting: true, cacheOk: true }, trusted: false }));
  assert.deepEqual([...CS.phoneFixPlan(rows)], ['alerts', 'storage', 'install', 'camera', 'update']);
  assert.deepEqual([...CS.phoneFixPlan(CS.phoneCheckRows(probe({ camera: { has: true, perm: 'denied' }, storage: { api: true, persisted: false } })))], ['storage'], 'a denied camera is steps, not a fixer');
});

test('s111 phone check: iPhone in Safari gets numbered Home Screen steps for alerts and install, and Fix all leaves them to the person', () => {
  const rows = CS.phoneCheckRows(probe({ ua: IPHONE, alerts: { support: 'needs_install' }, install: { standalone: false, ios: true } }));
  for (const id of ['alerts', 'install']) { const r = row(rows, id); assert.equal(r.state, 'tap'); assert.equal(r.fix, false); assert.match(r.steps.join(' '), /Tap Share \(the square with an arrow pointing up\)\.[\s\S]*Add to Home Screen/); }
  assert.deepEqual([...CS.phoneFixPlan(rows)], []);
  assert.match(CS.phoneCheckRows(probe({ ua: IPHONE, alerts: { support: 'blocked' } }))[0].steps.join(' '), /Open Settings\.[\s\S]*Turn on Allow Notifications/);
  assert.match(CS.phoneCheckRows(probe({ ua: 'Android', alerts: { support: 'blocked' } }))[0].steps.join(' '), /Permissions, then Notifications/);
});

// a phone for the shell: every API is a fake that records what it was asked, in order
function phone(o = {}) {
  const order = [], store = {}, ctl = { permission: o.permission || 'default', subscribed: 0, persisted: !!o.persisted, camPerm: o.camPerm || 'prompt', waiting: o.waiting !== undefined ? o.waiting : {}, stopped: 0, cacheOk: o.cacheOk !== false };
  const sub = { endpoint: 'https://push.example/e1', toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' } }), unsubscribe: () => Promise.resolve(true) };
  const reg = { pushManager: { subscribe: () => { order.push('subscribe'); ctl.subscribed++; return Promise.resolve(sub); }, getSubscription: () => Promise.resolve(ctl.subscribed ? sub : null) },
    get waiting() { return ctl.waiting; }, installing: null, update: () => { order.push('update'); ctl.waiting = null; return Promise.resolve(); } };
  const N = { get permission() { return ctl.permission; }, requestPermission: () => { order.push('permission'); ctl.permission = 'granted'; return Promise.resolve('granted'); } };
  const ls = { getItem: (k) => (k === 'cs_seen_v3' ? '1' : k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const track = () => ({ stop: () => { ctl.stopped++; order.push('stop'); } });
  const nav = { userAgent: o.ua || 'Mozilla/5.0 (Linux; Android 14) Chrome/120', serviceWorker: { ready: Promise.resolve(reg), controller: {}, register: () => Promise.resolve(), addEventListener() {} },
    mediaDevices: { getUserMedia: (c) => { order.push('camera:' + JSON.stringify(c)); ctl.camPerm = 'granted'; return Promise.resolve({ getTracks: () => [track(), track()] }); } },
    permissions: { query: (q) => Promise.resolve({ state: q.name === 'camera' ? ctl.camPerm : 'prompt' }) },
    storage: { persisted: () => Promise.resolve(ctl.persisted), persist: () => { order.push('persist'); ctl.persisted = true; return Promise.resolve(true); } } };
  if (o.standalone) nav.standalone = true;
  const fetcher = (u) => (/notify-cleaner-payment/.test(String(u)) ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, key: 'AQIDBA' }) }) : Promise.resolve({ ok: false }));
  const push = Object.assign({}, C_Push, { status: () => Promise.resolve({ state: ctl.subscribed ? 'on' : 'off' }) });
  const opts = (role) => ({ role, hash: '#home', ls, foldFetch: fetcher, serviceWorker: false, nav,
    winInit: (w) => { w.Notification = N; w.PushManager = function () {}; w.C_Push = push; w.caches = { has: (k) => Promise.resolve(ctl.cacheOk && k === 'cs-shell-v54') }; }, handlers: baseHandlers(role, { staff_push_subscribe_v1: () => ({ error: null, data: { ok: true } }) }) });
  return { order, store, ctl, opts };
}
const sheet = (app) => app.els['pc-sheet'];
const prompt = (order) => ({ preventDefault() {}, prompt: () => order.push('install'), userChoice: Promise.resolve({ outcome: 'accepted' }) });

test('s111 phone check: runs once after the first sign-in, opens the sheet when something needs a tap, remembers the result; the next open only re-checks quietly', async () => {
  const p = phone(); const app = await boot(p.opts('cleaner')); await app.flush();
  assert.equal(sheet(app).hidden, false, 'opened by itself the first time'); assert.match(sheet(app).innerHTML, /<h2 class="hd" id="pc-h" tabindex="-1">Check this phone<\/h2>/);
  const saved = JSON.parse(p.store.cs_phone_check); assert.equal(saved.v, 1); assert.deepEqual(saved.open, ['alerts', 'install', 'camera', 'storage', 'update'].filter((x) => x !== 'install'), 'no install prompt captured yet: install is steps');
  assert.match(sheet(app).innerHTML, /data-pc="alerts"[\s\S]*Needs a tap[\s\S]*data-pc="trust"/); assert.match(sheet(app).innerHTML, /data-act="pc-fix"[^>]*>Fix all</); assert.equal(p.order.length, 0, 'the check itself changes nothing');
  assert.match(app.els['v-home'].innerHTML, /PC_today[\s\S]*3 settings can be fixed with one tap\.[\s\S]*data-act="pc-open"/, 'Today keeps a card while a fixable row is off (alerts have their own card)');
  const q = phone(); Object.assign(q.store, p.store); const a2 = await boot(q.opts('cleaner')); await a2.flush();
  assert.notEqual(sheet(a2).hidden, false, 'not opened again'); assert.equal(q.order.length, 0);
  const done = phone({ permission: 'granted', persisted: true, camPerm: 'granted', waiting: null, standalone: true }); done.ctl.subscribed = 1; const a3 = await boot(done.opts('owner')); await a3.flush();
  assert.notEqual(sheet(a3).hidden, false, 'all OK: no sheet'); assert.deepEqual(JSON.parse(done.store.cs_phone_check).open, []); assert.doesNotMatch(a3.els['v-home'].innerHTML, /PC_today/);
});

test('s111 Fix all: from one tap, permission first (inside the tap), then subscribe, persist, install prompt, camera once with every track stopped, update; then a real re-check', async () => {
  const p = phone(); const app = await boot(p.opts('owner')); await app.flush();
  for (const fn of app.winListeners.beforeinstallprompt || []) fn(prompt(p.order));
  await app.click({ 'data-act': 'pc-run' }); await app.flush();
  assert.match(sheet(app).innerHTML, /data-pc="install"[\s\S]*One tap installs Cascade Staff/);
  await app.click({ 'data-act': 'pc-fix' }); await app.flush(); await app.flush();
  assert.deepEqual(p.order, ['permission', 'subscribe', 'persist', 'install', 'camera:{"video":true}', 'stop', 'stop', 'update']);
  assert.equal(p.ctl.stopped, 2, 'both tracks stopped at once');
  const h = sheet(app).innerHTML; for (const id of ['alerts', 'install', 'camera', 'storage', 'update']) assert.match(h, new RegExp('class="PC_row PC_(ok|tap)" data-pc="' + id + '"'));
  assert.match(h, /PC_ok" data-pc="alerts"/); assert.match(h, /PC_ok" data-pc="camera"/); assert.match(h, /PC_ok" data-pc="storage"/); assert.match(h, /PC_ok" data-pc="update"/);
  assert.match(h, /PC_tap" data-pc="install"/, 'the prompt was answered but the page is still in the browser: still a tap, never a faked OK');
  assert.match(h, /Checked again\./); assert.deepEqual(JSON.parse(p.store.cs_phone_check).open, []);
});

test('s111 Fix all: no camera is opened when its permission is already granted or denied; rows that are OK are not touched', async () => {
  for (const camPerm of ['granted', 'denied']) {
    const p = phone({ permission: 'granted', persisted: true, camPerm, waiting: null }); const app = await boot(p.opts('cleaner')); await app.flush();
    assert.deepEqual(p.order, ['subscribe'], 'granted: the sign-in subscribes quietly, no prompt'); p.order.length = 0; p.ctl.subscribed = 0; // the saved subscription is gone again: alerts need the fixer
    await app.click({ 'data-act': 'pc-run' }); await app.flush(); await app.click({ 'data-act': 'pc-fix' }); await app.flush(); await app.flush();
    assert.ok(!p.order.some((x) => /^camera/.test(x)), camPerm + ': camera never opened'); assert.ok(!p.order.includes('persist'), 'storage already kept'); assert.ok(!p.order.includes('update'), 'already up to date');
    assert.deepEqual(p.order, ['permission', 'subscribe'], camPerm + ': only the alerts fixer ran');
    if (camPerm === 'denied') assert.match(sheet(app).innerHTML, /data-pc="camera"[\s\S]*?<ol class="H_alsteps">/, 'denied: steps instead');
  }
});

test('s111 phone check: iPhone in Safari shows the Home Screen steps and Fix all does not pretend', async () => {
  const p = phone({ ua: IPHONE }); const app = await boot(p.opts('cleaner')); await app.flush();
  const h = sheet(app).innerHTML; assert.match(h, /data-pc="alerts"[\s\S]*?Tap Share \(the square with an arrow pointing up\)\./); assert.match(h, /data-pc="install"[\s\S]*?Add to Home Screen/);
  await app.click({ 'data-act': 'pc-fix' }); await app.flush(); await app.flush(); assert.ok(!p.order.includes('permission'), 'no prompt from Safari outside the Home Screen app');
});

test('s111 phone check: More > This phone > Check this phone opens it for every role; the cache name matches sw.js; Esc and Close shut it; sign-out clears it', async () => {
  for (const role of ['cleaner', 'laundry', 'owner']) { const h = (await boot({ role, hash: '#more', handlers: baseHandlers(role) })).els['v-more'].innerHTML; assert.match(h, /This phone<\/div>[\s\S]*data-act="pc-open"[\s\S]*Check this phone/, role); }
  assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v54';/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v54'/);
  assert.match(read('index.html'), /<div class="PC_sheet" id="pc-sheet" role="dialog" aria-modal="true" aria-labelledby="pc-h" hidden><\/div>/);
  const p = phone(); const app = await boot(p.opts('cleaner')); await app.flush(); assert.equal(sheet(app).hidden, false);
  for (const fn of app.listeners.keydown) fn({ key: 'Escape' }); assert.equal(sheet(app).hidden, true);
  await app.click({ 'data-act': 'pc-open' }); await app.flush(); assert.equal(sheet(app).hidden, false); await app.click({ 'data-act': 'pc-close' }); assert.equal(sheet(app).hidden, true);
  assert.match(read('app.js'), /PC = \{ open: false, busy: false, rows: null, msg: '', camPerm: null \}; PC_draw\(\); \}/, 'H_alReset (sign-out) clears the sheet');
  assert.doesNotMatch(read('app.js').slice(read('app.js').indexOf('s111 Phone check'), read('app.js').indexOf('Admin hub (owner')), /trustOn\s*=|rememberRole|authStorage\(/, 'the check never changes Trust this device');
});

// ---------------------------------------------------------------------------------------------- fix round r3 (M2)
test('s111 r3 M2: a soft row Fix all already tried (storage, update with nothing waiting) is Not possible here; a waiting update or an untried row stays a tap; never OK', () => {
  const rows = CS.phoneCheckRows(probe({ storage: { api: true, persisted: false }, update: { sw: true, controller: true, waiting: false, cacheOk: false }, camera: { has: true, perm: 'prompt' } }));
  assert.deepEqual(CS.phoneCheckSettle(rows, []).map((r) => r.state), rows.map((r) => r.state), 'nothing tried: unchanged');
  const s = CS.phoneCheckSettle(rows, ['storage', 'update', 'camera']);
  for (const id of ['storage', 'update']) { const r = row(s, id); assert.equal(r.state, 'no', id); assert.equal(r.fix, false); assert.equal(r.text, 'This browser decides this one.'); }
  assert.equal(row(s, 'camera').state, 'tap', 'the camera prompt can still be asked: not soft');
  assert.deepEqual([...CS.phoneFixPlan(s)], ['camera']);
  const waiting = CS.phoneCheckRows(probe({ update: { sw: true, controller: true, waiting: true, cacheOk: true } }));
  assert.equal(row(CS.phoneCheckSettle(waiting, ['update']), 'update').state, 'tap', 'a newer version waiting is still one tap');
  assert.equal(row(CS.phoneCheckSettle(CS.phoneCheckRows(OK), ['storage']), 'storage').state, 'ok', 'OK stays OK');
  const m = {}; const ls = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
  CS.phoneCheckSave(ls, rows, ['storage', 'update', 'bogus']); assert.deepEqual(CS.phoneCheckTried(ls), ['storage', 'update']);
  CS.phoneCheckSave(ls, CS.phoneCheckRows(probe({ update: { sw: true, controller: true, waiting: false, cacheOk: false } }))); assert.deepEqual(CS.phoneCheckTried(ls), ['update'], 'a row that reads OK forgets its try');
});

test('s111 r3 M2: Fix all where the browser says no without asking: storage and update become Not possible here, the Today card goes, Check again keeps them settled', async () => {
  const p = phone({ permission: 'granted', camPerm: 'granted', waiting: null, cacheOk: false, standalone: true }); p.ctl.subscribed = 1;
  const o = p.opts('owner'); o.nav.storage.persist = () => { p.order.push('persist'); return Promise.resolve(false); };
  const app = await boot(o); await app.flush();
  assert.match(sheet(app).innerHTML, /PC_tap" data-pc="storage"/); assert.match(sheet(app).innerHTML, /PC_tap" data-pc="update"/);
  assert.match(app.els['v-home'].innerHTML, /PC_today[\s\S]*2 settings can be fixed/);
  await app.click({ 'data-act': 'pc-fix' }); await app.flush(); await app.flush();
  assert.deepEqual(p.order.filter((x) => x === 'persist' || x === 'update'), ['persist', 'update'], 'both fixers really ran');
  let h = sheet(app).innerHTML;
  for (const id of ['storage', 'update']) { const li = h.slice(h.indexOf('data-pc="' + id + '"') - 20); assert.match(li, /^[^<]*PC_no" data-pc="\w+"[\s\S]*?Not possible here[\s\S]*?This browser decides this one\./, id); }
  assert.doesNotMatch(h, /data-act="pc-fix"/, 'nothing left for Fix all'); assert.match(h, /Everything this phone can do is on\./);
  const saved = JSON.parse(p.store.cs_phone_check); assert.deepEqual(saved.open, []); assert.deepEqual(saved.tried, ['storage', 'update']);
  assert.doesNotMatch(app.els['v-home'].innerHTML, /PC_today/, 'the Today card stops');
  await app.click({ 'data-act': 'pc-run' }); await app.flush(); h = sheet(app).innerHTML;
  assert.match(h, /PC_no" data-pc="storage"/, 'a plain re-check does not bring the tap back'); assert.doesNotMatch(app.els['v-home'].innerHTML, /PC_today/);
  p.ctl.persisted = true; await app.click({ 'data-act': 'pc-run' }); await app.flush();
  assert.match(sheet(app).innerHTML, /PC_ok" data-pc="storage"/, 'OK only from a real re-check'); assert.deepEqual(JSON.parse(p.store.cs_phone_check).tried, ['update']);
});
