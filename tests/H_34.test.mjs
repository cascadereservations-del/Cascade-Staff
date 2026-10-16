// Lane H, release 3.2.0 (s84): alerts on by default for every role (one permission tap), the card on Home, the switch on More, the topics sent to the server.
// The clock is frozen by the harness (2026-10-15 12:30 Manila); the browser's Notification, PushManager and service worker are stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { read, boot, baseHandlers, NOW } from './_a_harness.mjs';

const C_Push = createRequire(import.meta.url)('../pay/C_push.js');
const DAY = 86400000;
const card = (app) => { const m = /<section class="card glass A_card H_alerts"[^]*?<\/section>/.exec(app.els['v-home'].innerHTML); return m && m[0]; };
const STUB = { key: 'AQIDBA' };

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
const subCalls = (app) => app.calls.filter((c) => c[0] === 'staff_push_subscribe_v1');

test('3.2 alerts card: every role sees the one-time card on Home when permission is "default" and push works; copy and buttons', async () => {
  for (const role of ['cleaner', 'finance', 'owner', 'admin']) {
    const p = phone(); const app = await boot(p.opts(role)); const c = card(app);
    assert.ok(c, role + ': the card is there'); assert.match(c, /<h2 class="hd">Turn on alerts<\/h2>/); assert.match(c, /Brownouts, water interruptions and rain on the way./);
    assert.match(c, /data-act="alerts-on"[^>]*>Turn on<\/button>/); assert.match(c, /data-act="alerts-later"[^>]*>Not now<\/button>/); assert.doesNotMatch(c, /!/, 'no exclamation marks');
    const h = app.els['v-home'].innerHTML; assert.ok(h.indexOf('class="card glass A_card H_alerts"') < h.search(/aria-label="(Notices|Needs action)"/), 'above Notices, drawn in the first Home paint, not inserted later');
    assert.equal(p.ctl.asked, 0, 'nothing is asked until the person taps');
  }
});

test('3.2 alerts card: no card when the permission is already answered, push is unsupported, an iPhone is not on the Home Screen, or the person said Not now less than 7 days ago', async () => {
  for (const [name, o] of [['granted', { permission: 'granted' }], ['denied', { permission: 'denied' }], ['iphone in the browser', { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }], ['not now 6 days ago', { flag: NOW.getTime() - 6 * DAY }]]) {
    const app = await boot(phone(o).opts('cleaner')); assert.equal(card(app), null, name);
  }
  const p = phone(); const o = p.opts('cleaner'); const w0 = o.winInit; o.winInit = (w) => { w0(w); delete w.PushManager; }; assert.equal(card(await boot(o)), null, 'no PushManager');
  const o2 = phone().opts('cleaner'); const w1 = o2.winInit; o2.winInit = (w) => { w1(w); delete w.C_Push; }; assert.equal(card(await boot(o2)), null, 'push code absent: hidden, no error');
  assert.ok(card(await boot(phone({ flag: NOW.getTime() - 8 * DAY }).opts('cleaner'))), 'not now 8 days ago: asked again');
});

test('3.2 alerts card: Not now stores one time stamp, hides the card, asks nothing', async () => {
  const p = phone(); const app = await boot(p.opts('owner')); await app.click({ 'data-act': 'alerts-later' });
  assert.equal(card(app), null); assert.deepEqual(p.ctl.store, { cs_h_alerts_later: String(NOW.getTime()) }, 'one key, a time stamp, nothing else'); assert.equal(p.ctl.asked, 0); assert.equal(subCalls(app).length, 0);
});

test('3.2 alerts card: Turn on asks the browser, gets the key from the server, subscribes, and sends the topics: owner and admin paid + inbox + notices, others paid + notices', async () => {
  for (const [role, topics] of [['owner', ['paid', 'inbox', 'notices']], ['admin', ['paid', 'inbox', 'notices']], ['cleaner', ['paid', 'notices']], ['finance', ['paid', 'notices']]]) {
    const p = phone(); const app = await boot(p.opts(role)); await app.click({ 'data-act': 'alerts-on' }); await app.flush();
    assert.equal(p.ctl.asked, 1, role); assert.deepEqual(p.ctl.vapid, [{ action: 'vapid_key' }]); assert.equal(p.ctl.subscribed.length, 1); assert.equal(p.ctl.subscribed[0].userVisibleOnly, true); assert.ok(p.ctl.subscribed[0].applicationServerKey.length > 0, 'the key as bytes');
    assert.equal(subCalls(app).length, 1, role); assert.deepEqual(Object.keys(subCalls(app)[0][1]), ['p_endpoint', 'p_p256dh', 'p_auth', 'p_user_agent', 'p_topics'], role + ': exact keys');
    assert.deepEqual(subCalls(app)[0][1], { p_endpoint: 'https://push.example/e1', p_p256dh: 'P256', p_auth: 'AUTH', p_user_agent: 'Android', p_topics: topics }, role);
    assert.equal(card(app), null, role + ': the card is gone once permission is granted');
    assert.match((await boot(Object.assign(p.opts(role), { hash: '#more' }))).els['v-more'].innerHTML, /role="switch"[^>]*aria-checked="false"/, 'a fresh page on a phone that already has permission and no subscription shows the switch off');
  }
});

test('3.2 alerts card: a server that does not know the topic yet gets the same call without topics, so nothing breaks; a refusal anywhere else undoes the subscription', async () => {
  for (const err of [{ code: '22023', message: 'unknown topic notices' }, { code: 'PGRST202', message: 'Could not find the function' }]) {
    const p = phone({ subscribeRpc: (a) => ('p_topics' in a ? { error: err, data: null } : { error: null, data: { ok: true } }) }); const app = await boot(p.opts('cleaner')); await app.click({ 'data-act': 'alerts-on' }); await app.flush();
    assert.equal(subCalls(app).length, 2, err.code); assert.deepEqual(Object.keys(subCalls(app)[1][1]), ['p_endpoint', 'p_p256dh', 'p_auth', 'p_user_agent'], 'the retry has no topics key'); assert.equal(p.ctl.unsub, 0, 'the subscription is kept'); assert.equal(card(app), null);
  }
  const bad = phone({ subscribeRpc: () => ({ error: { code: 'XX000', message: 'boom' }, data: null }) }); const app = await boot(bad.opts('cleaner')); await app.click({ 'data-act': 'alerts-on' }); await app.flush();
  assert.equal(subCalls(app).length, 1, 'an ordinary failure is not retried'); assert.equal(bad.ctl.unsub, 1, 'the half-made subscription is undone'); assert.equal(card(app), null, 'permission was granted, so the card goes; More has the switch');
  const gone = phone({ subscribeRpc: () => ({ error: { code: 'PGRST202', message: 'x' }, data: null }) }); const a2 = await boot(gone.opts('cleaner')); await a2.click({ 'data-act': 'alerts-on' }); await a2.flush();
  assert.equal(subCalls(a2).length, 2); assert.equal(gone.ctl.unsub, 1, 'both refused: undone');
});

test('3.2 alerts card: a "no" from the browser makes no subscription and no server call; a dismissed prompt keeps the card', async () => {
  const no = phone({ answer: 'denied' }); const app = await boot(no.opts('owner')); await app.click({ 'data-act': 'alerts-on' }); await app.flush();
  assert.equal(subCalls(app).length, 0); assert.equal(no.ctl.vapid.length, 0, 'the server is not asked for a key'); assert.equal(card(app), null);
  const later = phone({ answer: 'default' }); const a2 = await boot(later.opts('owner')); await a2.click({ 'data-act': 'alerts-on' }); await a2.flush();
  assert.equal(subCalls(a2).length, 0); assert.equal(card(a2), null, 'the prompt was closed without an answer: treated as Not now for 7 days (3.2.1)');
  const nokey = phone(); const o = nokey.opts('owner'); o.foldFetch = () => Promise.resolve({ ok: false }); const a3 = await boot(o); await a3.click({ 'data-act': 'alerts-on' }); await a3.flush();
  assert.equal(subCalls(a3).length, 0); assert.equal(nokey.ctl.subscribed.length, 0, 'no key from the server: no subscription');
});

test('3.2 alerts switch: More > This phone shows the state for every role; hidden when unsupported; a plain sentence when blocked; off by default, on after Turn on', async () => {
  for (const role of ['cleaner', 'finance', 'owner', 'admin']) {
    const p = phone(); const app = await boot(Object.assign(p.opts(role), { hash: '#more' })); await app.flush();
    const h = app.els['v-more'].innerHTML; assert.match(h, /<b>Alerts on this phone<\/b>/, role); assert.match(h, /data-act="alerts-switch" aria-checked="false"/); assert.match(h, /This phone<\/div><section class="card glass H_alsw"/, 'inside the This phone group');
    await app.click({ 'data-act': 'alerts-switch' }); await app.flush(); assert.equal(subCalls(app).length, 1, role + ': the switch turns alerts on the same way'); assert.match(app.els['v-more'].innerHTML, /data-act="alerts-switch" aria-checked="true"/);
  }
  const blocked = await boot(Object.assign(phone({ permission: 'denied' }).opts('cleaner'), { hash: '#more' })); await blocked.flush(); assert.match(blocked.els['v-more'].innerHTML, /Messages are blocked for this app/); assert.doesNotMatch(blocked.els['v-more'].innerHTML, /data-act="alerts-switch"/);
  const o = phone().opts('cleaner'); const w0 = o.winInit; o.winInit = (w) => { w0(w); delete w.PushManager; }; const un = await boot(Object.assign(o, { hash: '#more' })); await un.flush(); assert.doesNotMatch(un.els['v-more'].innerHTML, /Alerts on this phone/);
});

test('3.2 alerts push: a notices alert opens the Notices tab (the real route), with or without a url; #notices is a short name for it; the paid and inbox payloads are unchanged', async () => {
  const handlers = {}, shown = [], self = { addEventListener: (t, fn) => { handlers[t] = fn; }, registration: { showNotification: (t, o) => { shown.push([t, o]); return Promise.resolve(); } }, clients: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../pay/C_push-sw.js', import.meta.url), 'utf8'), { self, Promise, String, JSON });
  const push = async (d) => { let p; handlers.push({ data: { json: () => d }, waitUntil: (x) => { p = x; } }); await p; };
  await push({ title: 'Cascade Staff', body: 'Brownout 1:00 to 4:00 pm today', tag: 'notices' }); assert.equal(shown[0][1].data.url, './#calendar/notices'); assert.equal(shown[0][1].tag, 'notices');
  await push({ title: 'Cascade Staff', body: 'Rain during the brownout', tag: 'notices', url: './#notices' }); assert.equal(shown[1][1].data.url, './#notices', 'a url from the server is kept');
  await push({ title: 'x', body: 'y' }); assert.equal(shown[2][1].data.url, './#home'); await push({ title: 'x', body: 'y', tag: 'inbox', url: './#inbox' }); assert.equal(shown[3][1].data.url, './#inbox');
  const app = await boot({ role: 'cleaner', hash: '#notices', handlers: baseHandlers('cleaner') }); await app.flush(); assert.equal(app.location.hash, '#calendar/notices', '#notices lands on the Notices tab');
  assert.match(read('app.js'), /manage\|guests\|inbox\|notices\|search/, 'a hand-typed #notices survives the first sign-in');
});

test('3.2 alerts: signing out clears the alerts state and the shell loads pay/C_push.js', () => {
  assert.match(read('app.js'), /H_resetModules\(\); H_histGen\+\+; H_calReset\(\); H_alReset\(\);/); assert.match(read('index.html'), /<script src="pay\/C_push\.js"><\/script>/);
  assert.match(read('styles.css'), /\.H_alrow \.btn \{ flex: 1 1 8rem; \}/, 'the buttons wrap instead of clipping');
});

test('3.2 alerts: the old Not now key is read once and moved to cs_h_alerts_later; the More switch lines mention pay notices', async () => {
  const p = phone(); p.ctl.store.cs_alerts_later = String(NOW.getTime() - 2 * DAY); const app = await boot(p.opts('cleaner'));
  assert.equal(card(app), null, 'an old Not now still counts'); assert.deepEqual(p.ctl.store, { cs_h_alerts_later: String(NOW.getTime() - 2 * DAY) }, 'moved, the old key is gone');
  const m = await boot(Object.assign(phone().opts('cleaner'), { hash: '#more' })); await m.flush(); assert.match(m.els['v-more'].innerHTML, /Pay notices, brownouts, water interruptions and rain on the way\./);
  await m.click({ 'data-act': 'alerts-switch' }); await m.flush(); assert.match(m.els['v-more'].innerHTML, /You will be told about pay notices, brownouts, water interruptions and rain on the way on this phone\./);
});
