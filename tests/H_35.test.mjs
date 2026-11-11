// Lane H, release 3.2.1 (s85): alerts on by default as far as the platform allows. Auto-subscribe when permission is granted, the first tap asks when it is not,
// a blocked phone is told how to allow it, and a person who switched alerts off is left alone. The clock is frozen by the harness (2026-10-15 12:30 Manila).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { read, boot, baseHandlers, NOW } from './_a_harness.mjs';

const C_Push = createRequire(import.meta.url)('../pay/C_push.js');
const DAY = 86400000;
const STUB = { key: 'AQIDBA' };
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const subCalls = (app) => app.calls.filter((c) => c[0] === 'staff_push_subscribe_v1');
const blocked = (app) => { const m = /<section class="card glass A_card F_span H_alerts H_alblocked"[^]*?<\/section>/.exec(app.els['v-home'].innerHTML); return m && m[0]; };
const tap = async (app) => { for (const fn of [...(app.listeners.touchend || [])]) fn({ target: { closest: () => null } }); await app.flush(); };
const withStore = (p, o) => { Object.assign(p.ctl.store, o); return p; };
// a phone: permission state, answers to requestPermission, a push manager that subscribes, and the server's answers to staff_push_subscribe_v1
function phone({ permission = 'default', answer = 'granted', ua = 'Android', subscribeRpc, flag } = {}) {
  const ctl = { permission, asked: 0, subscribed: [], unsub: 0, vapid: [], store: {} };
  if (flag !== undefined) ctl.store.cs_h_alerts_later = String(flag);
  const sub = { endpoint: 'https://push.example/e1', toJSON: () => ({ keys: { p256dh: 'P256', auth: 'AUTH' } }), unsubscribe: () => { ctl.unsub++; return Promise.resolve(true); } };
  const reg = { pushManager: { subscribe: (o) => { ctl.subscribed.push(o); return Promise.resolve(sub); }, getSubscription: () => Promise.resolve(null) } };
  const N = { get permission() { return ctl.permission; }, requestPermission: () => { ctl.asked++; ctl.permission = answer; return Promise.resolve(answer); } };
  const ls = { getItem: (k) => (k === 'cs_seen_v3' ? '1' : k in ctl.store ? ctl.store[k] : null), setItem: (k, v) => { ctl.store[k] = String(v); }, removeItem: (k) => { delete ctl.store[k]; } };
  const fetcher = (u, init) => { if (/notify-cleaner-payment/.test(String(u))) { ctl.vapid.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, key: STUB.key }) }); } return Promise.resolve({ ok: false }); };
  const opts = (role, handlers) => ({ role, hash: '#home', ls, foldFetch: fetcher, serviceWorker: false, nav: { userAgent: ua, serviceWorker: { ready: Promise.resolve(reg), register: () => Promise.resolve() } },
    winInit: (w) => { w.Notification = N; w.PushManager = function () {}; w.C_Push = C_Push; }, handlers: baseHandlers(role, Object.assign({ staff_push_subscribe_v1: (a) => (subscribeRpc ? subscribeRpc(a, ctl) : { error: null, data: { ok: true } }) }, handlers || {})) });
  return { ctl, opts };
}

test('3.2.1 auto-subscribe: permission granted and not subscribed, subscribes quietly with the role topics, no card, no prompt', async () => {
  for (const [role, topics] of [['owner', ['paid', 'inbox', 'notices']], ['admin', ['paid', 'inbox', 'notices']], ['cleaner', ['paid', 'notices']]]) {
    const p = phone({ permission: 'granted' }); const app = await boot(p.opts(role)); await app.flush();
    assert.equal(p.ctl.asked, 0, role + ': no prompt'); assert.equal(subCalls(app).length, 1, role); assert.deepEqual(subCalls(app)[0][1].p_topics, topics, role);
    assert.doesNotMatch(app.els['v-home'].innerHTML, /H_alerts|H_alblocked/, 'no card');
  }
});

test('3.2.1 auto-subscribe: once per page load, and a failure shows nothing on Home', async () => {
  const bad = phone({ permission: 'granted', subscribeRpc: () => ({ error: { code: 'XX000', message: 'boom' }, data: null }) }); const app = await boot(bad.opts('cleaner')); await app.flush();
  assert.equal(subCalls(app).length, 1); assert.doesNotMatch(app.els['v-home'].innerHTML, /H_alerts|H_alblocked|could not/i);
});

test('3.2.1 auto-subscribe: never when the person switched alerts off (cs_h_alerts_off)', async () => {
  const p = withStore(phone({ permission: 'granted' }), { cs_h_alerts_off: '1' }); const app = await boot(p.opts('owner')); await app.flush();
  assert.equal(subCalls(app).length, 0); assert.equal(p.ctl.subscribed.length, 0);
});

test('3.2.1 switch: switching on clears cs_h_alerts_off; switching off sets it', async () => {
  const p = withStore(phone({ permission: 'granted' }), { cs_h_alerts_off: '1' }); const o = p.opts('owner'); o.hash = '#more'; const app = await boot(o); await app.flush();
  await app.click({ 'data-act': 'alerts-switch' }); await app.flush();
  assert.equal(p.ctl.store.cs_h_alerts_off, undefined, 'cleared'); assert.equal(subCalls(app).length, 1);
  await app.click({ 'data-act': 'alerts-switch' }); await app.flush(); // now reads on, so this switches off
  assert.equal(p.ctl.store.cs_h_alerts_off, '1', 'set when switched off');
});

test('3.2.1 first tap: permission default, one tap anywhere asks exactly once, and the listeners are gone afterwards', async () => {
  const base = await boot(phone({ permission: 'granted' }).opts('cleaner')); const n0 = (base.listeners.touchend || []).length, c0 = (base.listeners.click || []).length;
  const p = phone(); const app = await boot(p.opts('cleaner')); await app.flush();
  assert.equal(p.ctl.asked, 0, 'nothing before a tap'); assert.equal((app.listeners.touchend || []).length, n0 + 1); assert.equal((app.listeners.click || []).length, c0 + 1);
  await tap(app); await tap(app); await tap(app);
  assert.equal(p.ctl.asked, 1, 'asked once'); assert.equal(subCalls(app).length, 1); assert.equal((app.listeners.touchend || []).length, n0); assert.equal((app.listeners.click || []).length, c0, 'both listeners removed');
});

test('3.2.1 first tap: a Block answer is not asked again this load', async () => {
  const p = phone({ answer: 'denied' }); const app = await boot(p.opts('owner')); await tap(app); await tap(app);
  assert.equal(p.ctl.asked, 1); assert.equal(subCalls(app).length, 0);
});

test('3.2.1 first tap: no ask when granted, denied, in the demo, or when switched off; an old Not now stamp no longer stops it (s111)', async () => {
  for (const [name, p] of [['granted', phone({ permission: 'granted' })], ['denied', phone({ permission: 'denied' })], ['off', withStore(phone(), { cs_h_alerts_off: '1' })]]) {
    const app = await boot(p.opts('cleaner')); await tap(app); assert.equal(p.ctl.asked, 0, name);
  }
  const d = phone(); const o = d.opts('cleaner'); o.demo = true; const app = await boot(o); await tap(app); assert.equal(d.ctl.asked, 0, 'demo');
  const l = phone({ flag: NOW.getTime() - DAY }); const a2 = await boot(l.opts('cleaner')); await tap(a2); assert.equal(l.ctl.asked, 1, 'an old Not now stamp is ignored');
});

test('3.2.1 first tap: sign-out removes the listener', async () => {
  const base = await boot(phone({ permission: 'granted' }).opts('cleaner')); const n0 = (base.listeners.touchend || []).length;
  const p = phone(); const app = await boot(p.opts('cleaner')); assert.equal((app.listeners.touchend || []).length, n0 + 1);
  await app.click({ 'data-act': 'signout' }); assert.equal((app.listeners.touchend || []).length, n0); await tap(app); assert.equal(p.ctl.asked, 0);
});

test('s111 blocked card: every role, Android Chrome and iPhone Settings steps, no Hide; the re-check reads the permission again and subscribes once allowed', async () => {
  for (const [name, ua] of [['android', 'Android'], ['iphone', IPHONE], ['desktop', CHROME]]) for (const role of ['cleaner', 'owner']) {
    const p = phone({ permission: 'denied', ua }); const o = p.opts(role); if (name === 'iphone') o.nav.standalone = true; const app = await boot(o); const c = blocked(app);
    assert.ok(c, name + role); assert.match(c, /Alerts are off on this phone/); assert.match(c, /<b>Android \(Chrome\)<\/b>[\s\S]*Tap Permissions, then Notifications\.[\s\S]*<b>iPhone<\/b>[\s\S]*Tap Notifications, then Cascade Staff\.[\s\S]*Turn on Allow Notifications\./);
    assert.doesNotMatch(c, /!|alerts-blocked-later|Hide for 7 days/); assert.match(c, /data-act="alerts-recheck"[^>]*>I’ve turned it on</);
  }
  const old = withStore(phone({ permission: 'denied' }), { cs_h_alerts_blocked_later: String(NOW.getTime() - DAY) }); assert.ok(blocked(await boot(old.opts('cleaner'))), 'an old Hide stamp no longer hides it');
  const p = phone({ permission: 'denied' }); const app = await boot(p.opts('cleaner'));
  await app.click({ 'data-act': 'alerts-recheck' }); assert.match(blocked(app), /Notifications are still blocked\. Check the steps above, then tap again\./); assert.equal(subCalls(app).length, 0);
  p.ctl.permission = 'granted'; await app.click({ 'data-act': 'alerts-recheck' }); await app.flush();
  assert.equal(blocked(app), null, 'allowed now: the card goes'); assert.equal(subCalls(app).length, 1, 'subscribed without a prompt'); assert.equal(p.ctl.asked, 0);
  assert.equal(blocked(await boot(phone({ permission: 'denied', ua: IPHONE }).opts('cleaner'))), null, 'iPhone not installed gets the install card instead');
});

test('s111 iPhone in Safari: the card shows the Home Screen steps, not a dead button; installed: Turn on', async () => {
  const p = phone({ ua: IPHONE }); const app = await boot(p.opts('cleaner')); const h = app.els['v-home'].innerHTML;
  const c = /<section class="card glass A_card F_span H_alerts H_alinstall"[^]*?<\/section>/.exec(h); assert.ok(c, 'install card');
  assert.match(c[0], /add Cascade Staff to your Home Screen first/); assert.match(c[0], /Tap Share \(the square with an arrow pointing up\)\.[\s\S]*Add to Home Screen/); assert.match(c[0], /href="\.\/install\/"/); assert.doesNotMatch(c[0], /data-act="alerts-on"/);
  const q = phone({ ua: IPHONE }); const o = q.opts('cleaner'); o.nav.standalone = true; const a2 = await boot(o); assert.match(a2.els['v-home'].innerHTML, /data-act="alerts-on"[^>]*>Turn on</);
});

test('s111 switched off on More: no card in that visit, back on the next open', async () => {
  const p = phone({ permission: 'granted' }); const o = p.opts('cleaner'); o.hash = '#more'; const app = await boot(o); await app.flush();
  await app.click({ 'data-act': 'alerts-switch' }); await app.flush(); // reads on (auto-subscribed), so this switches off
  assert.equal(p.ctl.store.cs_h_alerts_off, '1');
  const q = phone({ permission: 'granted' }); Object.assign(q.ctl.store, p.ctl.store); const a2 = await boot(q.opts('cleaner')); await a2.flush();
  assert.match(a2.els['v-home'].innerHTML, /class="card glass A_card F_span H_alerts"[\s\S]*data-act="alerts-on"/, 'the next open asks again');
  await a2.click({ 'data-act': 'alerts-on' }); await a2.flush(); assert.equal(q.ctl.store.cs_h_alerts_off, undefined); assert.doesNotMatch(a2.els['v-home'].innerHTML, /data-act="alerts-on"/);
});

test('3.2.1 version 3.2.1, cache v21, What is new line', async () => {
  const CS = createRequire(import.meta.url)('../lib.js');
  assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v57'/); assert.match(read('app.js'), /version: '3.4.32'/);
  for (const r of ['cleaner', 'owner']) assert.ok(CS.A_whatsNew(r, {}).some((i) => /Alerts now turn on by themselves when this phone allows them\. If they are blocked, Today shows how to allow them\./.test(i.text) && !/!/.test(i.text)));
});

test('3.2.1 r2: the first tap asks with NO render before it, and the tapped control still works', async () => {
  const p = phone(); const app = await boot(p.opts('cleaner')); await app.flush();
  const before = app.els['v-home'].innerHTML; let seenAtAsk = null;
  const N = app.els; void N; // the stub's requestPermission runs inside the handler: record the page at that moment
  const orig = p.ctl; Object.defineProperty(orig, 'asked', { get() { return this._a || 0; }, set(v) { this._a = v; seenAtAsk = app.els['v-home'].innerHTML; } });
  for (const fn of [...(app.listeners.touchend || [])]) fn({ target: { closest: () => null } });
  assert.equal(orig.asked, 1, 'asked synchronously in the tap'); assert.equal(seenAtAsk, before, 'Home was not redrawn before the ask');
  await app.flush();
});

test('s111: dismissing the browser prompt stores no stamp, so the next load asks again (alerts are required)', async () => {
  const p = phone({ answer: 'default' }); const app = await boot(p.opts('owner')); await tap(app);
  assert.equal(p.ctl.store.cs_h_alerts_later, undefined);
  const q = phone(); Object.assign(q.ctl.store, p.ctl.store); const a2 = await boot(q.opts('owner')); await tap(a2); assert.equal(q.ctl.asked, 1);
});

test('3.2.1 r2: a failed quiet subscribe never unsubscribes an existing push subscription', async () => {
  const p = phone({ permission: 'granted', subscribeRpc: () => ({ error: { code: 'XX000', message: 'boom' }, data: null }) }); const app = await boot(p.opts('cleaner')); await app.flush();
  assert.equal(subCalls(app).length, 1); assert.equal(p.ctl.unsub, 0);
});

test('3.4.0 What is new line: suppliers, price history and photos, calm, no exclamation mark', () => {
  const CS = createRequire(import.meta.url)('../lib.js');
  for (const r of ['cleaner', 'owner']) assert.ok(CS.A_whatsNew(r, {}).some((i) => i.text === 'Suppliers, price history and item photos are in Inventory.'));
  assert.ok(read('sw.js').includes("'./stock/I_suppliers.js'") && read('sw.js').includes("'./stock/I_suppliers.css'"));
});

test('3.4.1 checklist: the kitchen card requires exactly the two named kitchen photos; the bedroom minimum is unchanged', () => {
  const h = read('checklist/index.html');
  const slots = h.match(/const K_PHOTO_SLOTS = \[([^]*?)\n\];/)[1];
  assert.deepEqual([...slots.matchAll(/id: '([a-z_]+)'/g)].map((m) => m[1]), ['k_utensils', 'k_cookware']);
  assert.match(h, /const K_KITCHEN_PHOTO_MIN\s*=\s*2;/); assert.match(h, /const SECTION_PHOTO_MIN\s*=\s*3;/);
  assert.match(h, /label: 'bedroom',\s+photoMin: SECTION_PHOTO_MIN/); assert.match(h, /label: 'kitchen',\s+photoMin: K_KITCHEN_PHOTO_MIN/);
  assert.match(h, /kitchenPhotos\.length < K_KITCHEN_PHOTO_MIN\) return false/);
  for (const m of slots.matchAll(/label: '([^']+)'/g)) assert.doesNotMatch(m[1].split(':')[0], /\(/, 'the short name (before the colon) is shown alone in the nudge and the thumbnail caption');
  assert.match(h, /Required &nbsp;·&nbsp; 2 kitchen photos/); assert.doesNotMatch(h, /3 bathroom|b_toilet|six spots/);
});
