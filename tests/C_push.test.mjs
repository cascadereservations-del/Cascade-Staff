// Lane C: the push toggle logic and the service-worker handlers. Fake browser objects only; nothing reads the clock or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { plain, until } from './C_dom-harness.mjs';
const req = createRequire(import.meta.url);
const K = req('../pay/C_push.js');

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/120';
const win = (o = {}) => ({ PushManager: function () {}, Notification: { permission: 'default', requestPermission: async () => 'granted' }, matchMedia: () => ({ matches: false }), ...o });

test('support: ready, unsupported, needs install on an iPhone browser tab, blocked after a refusal', () => {
  assert.equal(K.support({ navigator: { serviceWorker: {}, userAgent: ANDROID }, window: win() }), 'ready');
  assert.equal(K.support({ navigator: { userAgent: ANDROID }, window: win() }), 'unsupported');
  assert.equal(K.support({ navigator: { serviceWorker: {}, userAgent: ANDROID }, window: { matchMedia: () => ({ matches: false }) } }), 'unsupported');
  assert.equal(K.support({ navigator: { serviceWorker: {}, userAgent: IOS }, window: win() }), 'needs_install');
  assert.equal(K.support({ navigator: { serviceWorker: {}, userAgent: IOS, standalone: true }, window: win() }), 'ready');
  assert.equal(K.support({ navigator: { serviceWorker: {}, userAgent: ANDROID }, window: win({ Notification: { permission: 'denied' } }) }), 'blocked');
});

test('args: the four arguments of staff_push_subscribe_v1 from a subscription, user agent clipped', () => {
  const sub = { endpoint: 'https://push.example.test/x', toJSON: () => ({ keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }) };
  const a = K.args(sub, 'u'.repeat(300));
  assert.deepEqual(Object.keys(a), ['p_endpoint', 'p_p256dh', 'p_auth', 'p_user_agent']); assert.equal(a.p_user_agent.length, 200); assert.equal(a.p_endpoint, 'https://push.example.test/x');
  const raw = { endpoint: 'https://e.test', getKey: (n) => new Uint8Array(n === 'auth' ? 16 : 65).fill(255).buffer };
  assert.equal(K.args(raw, 'ua').p_auth.length, 22); assert.equal(K.args(raw, 'ua').p_p256dh.length, 87);
  assert.deepEqual(Array.from(K.keyBytes('AQID')), [1, 2, 3]);
});

function phone({ granted = true, existing = null, rpc, call, ua = ANDROID } = {}) {
  const log = [];
  const sub = { endpoint: 'https://push.example.test/zz', toJSON: () => ({ keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }), unsubscribe: async () => { log.push('unsubscribe'); return true; } };
  const reg = { pushManager: { getSubscription: async () => existing, subscribe: async (o) => { log.push(['subscribe', o.userVisibleOnly, o.applicationServerKey.length]); return sub; } } };
  const env = { navigator: { serviceWorker: { ready: Promise.resolve(reg) }, userAgent: ua }, window: win({ Notification: { permission: 'default', requestPermission: async () => (granted ? 'granted' : 'denied') } }) };
  const q = (table) => ({ select: () => q(table), eq: (c, v) => { log.push(['eq', table, c, v]); return q(table); }, limit: async () => ({ data: existing ? [{ id: 1 }] : [], error: null }), delete: () => { log.push(['delete', table]); return q(table); }, then: (f) => Promise.resolve({ error: null }).then(f) });
  const client = { rpc: async (n, a) => { log.push(['rpc', n, plain(a)]); return rpc ? rpc(n, a) : { data: { ok: true }, error: null }; }, from: (t) => q(t) };
  return { env, client, log, call: call || (async (b) => { log.push(['call', plain(b)]); return { ok: true, key: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4' }; }) };
}

test('enable: asks the server for the public key, asks permission, subscribes, then calls staff_push_subscribe_v1 with exactly four arguments', async () => {
  const p = phone();
  const r = await K.enable({ env: p.env, client: p.client, call: p.call });
  assert.deepEqual(plain(r), { ok: true });
  assert.deepEqual(plain(p.log[0]), ['call', { action: 'vapid_key' }]);
  assert.deepEqual(plain(p.log[1]), ['subscribe', true, 65]);
  const rpc = p.log.find((l) => l[0] === 'rpc');
  assert.equal(rpc[1], 'staff_push_subscribe_v1'); assert.deepEqual(Object.keys(rpc[2]), ['p_endpoint', 'p_p256dh', 'p_auth', 'p_user_agent']);
});

test('enable: stops quietly when push is not configured, permission is refused, the RPC is missing or answers not ok (and unsubscribes in the last two)', async () => {
  const none = phone({ call: async () => ({ ok: false, reason: 'push_not_configured' }) });
  assert.deepEqual(plain(await K.enable({ env: none.env, client: none.client, call: none.call })), { ok: false, reason: 'not_configured' });
  assert.ok(!none.log.some((l) => l[0] === 'rpc'));
  const no = phone({ granted: false });
  assert.deepEqual(plain(await K.enable({ env: no.env, client: no.client, call: no.call })), { ok: false, reason: 'blocked' });
  const gone = phone({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) });
  assert.deepEqual(plain(await K.enable({ env: gone.env, client: gone.client, call: gone.call })), { ok: false, reason: 'not_configured' });
  assert.ok(gone.log.includes('unsubscribe'));
  const bad = phone({ rpc: async () => ({ data: { ok: false, reason: 'bad_request' }, error: null }) });
  assert.deepEqual(plain(await K.enable({ env: bad.env, client: bad.client, call: bad.call })), { ok: false, reason: 'failed' });
  assert.ok(bad.log.includes('unsubscribe'));
  const ios = phone({ ua: IOS });
  assert.deepEqual(plain(await K.enable({ env: ios.env, client: ios.client, call: ios.call })), { ok: false, reason: 'needs_install' });
  const offline = phone({ call: async () => { throw new Error('net'); } });
  assert.deepEqual(plain(await K.enable({ env: offline.env, client: offline.client, call: offline.call })), { ok: false, reason: 'not_configured' });
});

test('status and disable: reads its own row by endpoint, hides when the table is absent, deletes the row then unsubscribes', async () => {
  const sub = { endpoint: 'https://push.example.test/zz', unsubscribe: async () => true };
  const on = phone({ existing: sub });
  assert.deepEqual(plain(await K.status({ env: on.env, client: on.client })), { state: 'on' });
  assert.deepEqual(plain(on.log.find((l) => l[0] === 'eq')), ['eq', 'staff_push_subscriptions', 'endpoint', 'https://push.example.test/zz']);
  const off = phone({}); assert.deepEqual(plain(await K.status({ env: off.env, client: off.client })), { state: 'off' });
  assert.deepEqual(plain(await K.status({ env: { navigator: { userAgent: ANDROID }, window: win() }, client: {} })), { state: 'hidden' });
  assert.deepEqual(plain(await K.status({ env: { navigator: { serviceWorker: {}, userAgent: IOS }, window: win() }, client: {} })), { state: 'needs_install' });
  const d = phone({ existing: sub });
  assert.deepEqual(plain(await K.disable({ env: d.env, client: d.client })), { ok: true });
  assert.deepEqual(d.log.filter((l) => l[0] === 'delete' || l[0] === 'eq').map((l) => l[0]), ['delete', 'eq']);
  for (const w of ['off', 'on', 'needs_install', 'blocked', 'failed', 'not_configured']) assert.ok(K.words(w).length > 10 && !K.words(w).includes('!'), w);
  assert.equal(K.words('off'), 'Tell me on this phone when I am paid');
});

// ---- the service worker file, run in a fake worker scope
function worker(clientsList = []) {
  const listeners = {}, shown = [], opened = [], focused = [], navigated = [];
  const self_ = {
    addEventListener: (t, f) => { listeners[t] = f; },
    registration: { showNotification: async (title, o) => { shown.push({ title, ...o }); } },
    clients: {
      matchAll: async () => clientsList.map((c) => ({ focus: async () => { focused.push(c); }, navigate: async (u) => { navigated.push(u); } })),
      openWindow: async (u) => { opened.push(u); },
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../pay/C_push-sw.js', import.meta.url), 'utf8'), { self: self_ });
  const run = async (type, ev) => { let p; await listeners[type]({ ...ev, waitUntil: (x) => { p = x; } }); await p; };
  return { run, shown, opened, focused, navigated, listeners };
}

test('service worker: shows the title and body the server sent, with no amount even if the payload carries one', async () => {
  const w = worker();
  await w.run('push', { data: { json: () => ({ title: 'Your payment has been sent', body: 'Hi Honey, your pay for Oct 10 is on its way to your MariBank account. Open Cascade Staff for the details.', tag: 'cascade-paid' }) } });
  assert.equal(w.shown[0].title, 'Your payment has been sent'); assert.match(w.shown[0].body, /^Hi Honey, your pay for Oct 10/); assert.equal(w.shown[0].tag, 'cascade-paid'); assert.equal(w.shown[0].data.url, './#home');
  for (const leaky of ['We sent PHP 1,235 to you', 'You got ₱500', 'Total 1,235 sent', 'ref 12345678']) {
    const x = worker(); await x.run('push', { data: { json: () => ({ title: 'T', body: leaky }) } });
    assert.equal(x.shown[0].body, 'Open Cascade Staff for the details.', leaky);
  }
  const empty = worker(); await empty.run('push', {}); assert.equal(empty.shown[0].title, 'Cascade Staff'); assert.equal(empty.shown[0].body, 'Open Cascade Staff for the details.');
  const broken = worker(); await broken.run('push', { data: { json: () => { throw new Error('not json'); } } }); assert.equal(broken.shown.length, 1);
});

test('service worker: a tap focuses an open window, else opens the app; only in-app addresses are followed', async () => {
  const closed = []; const note = (url) => ({ close: () => closed.push(1), data: { url } });
  const open = worker([{ id: 1 }]); await open.run('notificationclick', { notification: note('./#home') });
  assert.equal(open.focused.length, 1); assert.deepEqual(open.navigated, ['./#home']); assert.equal(open.opened.length, 0);
  const shut = worker([]); await shut.run('notificationclick', { notification: note('./#home') });
  assert.deepEqual(shut.opened, ['./#home']);
  for (const evil of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)']) { const x = worker([]); await x.run('notificationclick', { notification: note(evil) }); assert.deepEqual(x.opened, ['./#home'], evil); }
  assert.equal(closed.length, 5);
});
