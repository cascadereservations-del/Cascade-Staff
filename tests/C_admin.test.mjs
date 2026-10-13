// Lane C: the admin "Pay staff" screen, run in a fake browser. Every server call is mocked and the exact RPC / function name and argument keys are asserted.
// The payout payload here is SYNTHETIC (a ZZ account). Nothing reads the real clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeEl, fire, load, plain, spyStorage, target, tick, until } from './C_dom-harness.mjs';
const req = createRequire(import.meta.url);
const QrPh = req('../pay/C_qrph.js');
const A = req('../pay/C_admin-lib.js');

const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const body = tlv('00', '01') + tlv('01', '11') + tlv('27', tlv('00', 'com.p2pqrpay') + tlv('01', 'ZZTESTPHZZZ') + tlv('02', '99964403') + tlv('03', '9990000111122223')) + tlv('52', '6016') + tlv('53', '608') + tlv('58', 'PH') + tlv('59', 'ZZ TEST PAYEE') + tlv('60', 'TESTCITY') + '6304';
const STATIC = body + QrPh.crc16(body);
const PROP = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const REQ = { id: 'req1', ref: 'ABCD1234', status: 'requested', payee_name: 'Honey', total: 500, created_at: '2026-10-13T02:00:00Z', has_qr: true, lines: [{ kind: 'clean', date: '2026-10-10', type: 'turnover', amount: 500 }] };

function boot(handlers = {}) {
  const els = { C_pay_admin: new FakeEl('C_pay_admin'), C_done: new FakeEl('C_done'), C_file: new FakeEl('C_file') };
  const rpcs = [], fetches = [], copied = [], pagehide = [];
  const store = spyStorage(), sess = spyStorage(), cachesTouched = [];
  const ctx = {
    console, setTimeout, clearTimeout, setImmediate, Promise, Uint8Array, ArrayBuffer, TextEncoder, JSON, Math, Object, Array, String, Number, Error, isNaN, parseInt, atob, btoa, encodeURIComponent, decodeURIComponent,
    crypto: globalThis.crypto, localStorage: store.st, sessionStorage: sess.st, caches: { open: () => { cachesTouched.push('open'); } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Image: class { set src(v) { this.naturalWidth = 2000; this.naturalHeight = 1000; setImmediate(() => this.onload()); } },
    File: class { constructor(parts, name) { this.name = name; } },
    navigator: { userAgent: 'test', clipboard: { writeText: async (t) => { copied.push(t); } } },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: (tag) => (tag === 'canvas' ? { getContext: () => ({ drawImage() {}, fillRect() {} }), toBlob(cb) { cb({ arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer, type: 'image/jpeg' }); } } : { click() {}, select() {} }),
      body: { appendChild() {}, removeChild() {} }, execCommand: () => true,
    },
    fetch: async (url, init) => { fetches.push({ url, init }); return { json: async () => (handlers.fetch ? handlers.fetch(url, init) : { ok: true, path: `${PROP}/c5100000-0000-4000-8000-0000000000a3/sub/shot.jpg` }) }; },
    supabase: { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
      rpc: async (name, args) => { rpcs.push([name, args]); return (handlers.rpc && handlers.rpc(name, args)) || { data: null, error: { code: 'PGRST202' } }; },
    }) },
  };
  ctx.self = ctx; ctx.window = ctx; ctx.addEventListener = (t, f) => { if (t === 'pagehide') pagehide.push(f); };
  load(['icons.js', 'lib.js', 'pay/pay-lib.js', 'pay/C_qrph.js', 'pay/C_qr.js', 'pay/C_admin-lib.js'], ctx);
  const seen = []; const orig = ctx.C_QR.matrix; ctx.C_QR.matrix = (t, m) => { seen.push(t); return orig(t, m); };
  load(['pay/C_admin.js'], ctx);
  return { ctx, root: els.C_pay_admin, els, rpcs, fetches, copied, pagehide, seen, touched: { local: store.touched, session: sess.touched, caches: cachesTouched } };
}
const LIST = (extra) => ({ data: { ok: true, requests: [{ ...REQ, lines: [...REQ.lines] }, ...(extra || [])] }, error: null });
const happy = (over = {}) => ({
  rpc: (name) => ({
    staff_pay_admin_list_v1: LIST(), staff_pay_payout_qr_v1: { data: { ok: true, id: 'req1', ref: 'ABCD1234', status: 'requested', payee_name: 'Honey', total: 500, payout_qrph: STATIC }, error: null },
    staff_pay_admin_step_v1: { data: { ok: true, status: 'paying' }, error: null }, staff_pay_admin_settle_v1: { data: { ok: true, status: 'paid' }, error: null }, ...over,
  }[name]),
});

test('list: one list call, the open request with a Pay button, and the signed-in states', async () => {
  const b = boot(happy()); await tick();
  assert.equal(b.rpcs[0][0], 'staff_pay_admin_list_v1'); assert.equal(b.rpcs[0][1], undefined, 'no arguments');
  assert.match(b.root.innerHTML, /Waiting to be paid/); assert.match(b.root.innerHTML, /Honey/); assert.match(b.root.innerHTML, /data-act="pay" data-id="req1"/);
  assert.match(b.root.innerHTML, /Waiting for payment/);
  const denied = boot({ rpc: () => ({ data: { ok: false, reason: 'not_authorized' }, error: null }) }); await tick();
  assert.match(denied.root.innerHTML, /for the owner, admin and finance/);
  const absent = boot({}); await tick();
  assert.match(absent.root.innerHTML, /not switched on yet/);
  const offline = boot({ rpc: () => ({ data: null, error: { code: '08006', message: 'network' } }) }); await tick();
  assert.match(offline.root.innerHTML, /No connection/); assert.match(offline.root.innerHTML, /Try again/);
});

test('Pay: reads the QR for that request, marks it paying, draws the amount QR big with Save, Open bank app and the fallback; the payload never reaches the page text or any storage', async () => {
  const b = boot(happy()); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  assert.deepEqual(plain(b.rpcs.slice(1)), [['staff_pay_payout_qr_v1', { p_request_id: 'req1' }], ['staff_pay_admin_step_v1', { p_request_id: 'req1', p_step: 'pay' }]]);
  const h = b.root.innerHTML;
  assert.match(h, /<svg [^>]*viewBox="0 0 \d+ \d+"/); assert.match(h, /C_qrframe/);
  assert.match(h, /C_amount num">₱500</); assert.match(h, /Save QR to phone/); assert.match(h, /Open bank app/); assert.match(h, /href="bank\.html\?app=bpi"/);
  assert.match(h, /If your bank ignores the amount/); assert.match(h, /Copy amount/); assert.match(h, /Show the QR without an amount/);
  assert.doesNotMatch(h, /ZZTESTPH|com\.p2pqrpay|000201/, 'the payload is not in the page');
  // the QR that was drawn first is the amount QR: dynamic, tag 54 = 500.00, valid CRC; the second is the static fallback
  const dyn = QrPh.decode(b.seen[0]); assert.equal(dyn.initiation, '12'); assert.equal(dyn.amount, '500.00');
  assert.equal(QrPh.decode(b.seen[1]).initiation, '11'); assert.equal(QrPh.decode(b.seen[1]).amount, null);
  assert.deepEqual(plain(b.touched), { local: [], session: [], caches: [] }, 'no storage and no cache was touched');
  // fallback screen
  await fire(b.root, 'click', { target: target({ 'data-act': 'togglestatic' }) });
  assert.match(b.root.innerHTML, /This QR has no amount\. Type ₱500 in your bank app\./); assert.match(b.root.innerHTML, /Show the QR with the amount/);
  assert.doesNotMatch(b.root.innerHTML, /Save QR to phone/, 'the saved photo is always the amount QR');
  await fire(b.root, 'click', { target: target({ 'data-act': 'copyamt' }) }); await fire(b.root, 'click', { target: target({ 'data-act': 'copyref' }) });
  assert.deepEqual(plain(b.copied), ['500', 'CASCADE-ABCD1234']);
  // leaving the page clears the screen
  for (const f of b.pagehide) f(); assert.equal(b.root.innerHTML, '');
});

test('Pay: a payee with no QR saved gets the plain fallback (amount, copy, open bank app), not an error', async () => {
  const b = boot(happy({ staff_pay_payout_qr_v1: { data: { ok: true, id: 'req1', status: 'requested', payee_name: 'Honey', total: 500, payout_qrph: null }, error: null } })); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  assert.match(b.root.innerHTML, /payout QR is not saved yet/); assert.match(b.root.innerHTML, /Open bank app/); assert.match(b.root.innerHTML, /C_amount num">₱500</);
  assert.doesNotMatch(b.root.innerHTML, /<svg [^>]*viewBox="0 0 \d+ \d+"[^>]*role="img"/);
});

test('Mark as paid: needs the screenshot, an amount and a reference; uploads, then settles with exactly the proof keys, then asks for the notice', async () => {
  const b = boot(happy()); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  assert.match(b.root.innerHTML, /id="C_done" data-act="settle" disabled/);
  await fire(b.root, 'change', { target: { id: 'C_file', files: [{ name: 'shot.png' }] } });
  await fire(b.root, 'input', { target: { id: 'C_ref', value: 'ab 1234 5678' } });
  assert.equal(b.els.C_done.disabled, false, 'live once the screenshot, the amount and the reference are there');
  await fire(b.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /Marked paid/.test(b.root.innerHTML), 'done screen');
  const settle = plain(b.rpcs.find((r) => r[0] === 'staff_pay_admin_settle_v1'));
  assert.deepEqual(Object.keys(settle[1]), ['p_request_id', 'p_proof']); assert.equal(settle[1].p_request_id, 'req1');
  assert.deepEqual(Object.keys(settle[1].p_proof), ['path', 'sha256', 'amount', 'reference']);
  assert.match(settle[1].p_proof.sha256, /^[0-9a-f]{64}$/); assert.equal(settle[1].p_proof.amount, 500); assert.equal(settle[1].p_proof.reference, 'AB12345678'); assert.match(settle[1].p_proof.path, new RegExp('^' + PROP + '/'));
  const upload = b.fetches.find((f) => /upload-photo$/.test(f.url));
  assert.equal(upload.init.headers['x-cascade-property-id'], PROP); assert.match(upload.init.headers['x-cascade-submission-id'], /^[0-9a-f-]{36}$/);
  const notify = b.fetches.find((f) => /notify-cleaner-payment$/.test(f.url));
  assert.deepEqual(JSON.parse(notify.init.body), { action: 'paid', request_id: 'req1' });
  assert.match(b.root.innerHTML, /Marked paid\. Honey is told by message, in Telegram and in the app\./);
  assert.deepEqual(plain(b.touched), { local: [], session: [], caches: [] });
});

test('Mark as paid: an amount that is not the total asks for a tick, then sends override once without uploading the screenshot again', async () => {
  let n = 0;
  const c = boot({ rpc: (name) => (name === 'staff_pay_admin_settle_v1'
    ? (++n === 1 ? { data: { ok: false, reason: 'amount_mismatch', typed: 400, total: 500 }, error: null } : { data: { ok: true, status: 'paid' }, error: null })
    : happy().rpc(name)) }); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  await fire(c.root, 'change', { target: { id: 'C_file', files: [{ name: 'shot.png' }] } });
  await fire(c.root, 'input', { target: { id: 'C_amt', value: '400' } }); await fire(c.root, 'input', { target: { id: 'C_ref', value: 'ref12345' } });
  await fire(c.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /id="C_ovr"/.test(c.root.innerHTML), 'override box');
  assert.match(c.root.innerHTML, /The amount you typed \(₱400\) is not the request \(₱500\)/); assert.match(c.root.innerHTML, /id="C_ovr"/);
  await fire(c.root, 'input', { target: { id: 'C_ovr', checked: true } });
  await fire(c.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /Marked paid/.test(c.root.innerHTML), 'done screen');
  const settles = plain(c.rpcs.filter((r) => r[0] === 'staff_pay_admin_settle_v1'));
  assert.equal(settles.length, 2); assert.equal(settles[0][1].p_proof.override, undefined); assert.equal(settles[1][1].p_proof.override, true); assert.equal(settles[1][1].p_proof.amount, 400);
  assert.equal(c.fetches.filter((f) => /upload-photo$/.test(f.url)).length, 1, 'one upload');
  assert.match(c.root.innerHTML, /Marked paid/);
});

test('refusals are plain sentences and a refused settle leaves the screen open', async () => {
  const c = boot({ rpc: (name) => (name === 'staff_pay_admin_settle_v1' ? { data: { ok: false, reason: 'duplicate_proof', other_ref: 'ZZ99' }, error: null } : happy().rpc(name)) }); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  await fire(c.root, 'change', { target: { id: 'C_file', files: [{ name: 'shot.png' }] } }); await fire(c.root, 'input', { target: { id: 'C_ref', value: 'ref12345' } });
  await fire(c.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /already used/.test(c.root.innerHTML), 'refusal');
  assert.match(c.root.innerHTML, /already used for request ZZ99, so nothing changed/); assert.match(c.root.innerHTML, /Mark as paid/);
  assert.doesNotMatch(c.root.innerHTML, /Marked paid/);
  for (const r of ['not_authorized', 'not_paying', 'not_open', 'not_found', 'bad_proof', 'no_stored_proof', 'already_paid', 'offline', 'weird']) assert.ok(A.refusal({ reason: r }).length > 20 && !A.refusal({ reason: r }).includes('!'), r);
});

test('I am not paying this now: returns the request to requested and goes back to the list', async () => {
  const c = boot(happy({ staff_pay_admin_step_v1: { data: { ok: true, status: 'paying' }, error: null } })); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'unpay' }) }); await tick();
  assert.deepEqual(plain(c.rpcs.filter((r) => r[0] === 'staff_pay_admin_step_v1').map((r) => r[1].p_step)), ['pay', 'not_sent']);
  assert.match(c.root.innerHTML, /Waiting to be paid/);
});

test('lib: ready needs all three, proof keys, copy amount, sha256, the status words', async () => {
  assert.equal(A.ready({ file: {}, amount: '500', reference: 'ab12' }), true);
  for (const f of [{ amount: '500', reference: 'ab12' }, { file: {}, amount: '0', reference: 'ab12' }, { file: {}, amount: '500', reference: 'ab' }, { file: {}, amount: '', reference: 'ab12' }]) assert.equal(A.ready(f), false);
  assert.deepEqual(A.proof('p', 'h', '1,235.50', 'ab-12 34', false), { path: 'p', sha256: 'h', amount: 1235.5, reference: 'AB1234' });
  assert.equal(A.proof('p', 'h', 5, 'abcd', true).override, true);
  assert.equal(A.copyAmount(1235), '1235'); assert.equal(A.copyAmount(1235.5), '1235.50');
  assert.equal(await A.sha256Hex(new TextEncoder().encode('abc').buffer), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(A.status({ status: 'paying', paying_by_name: 'Marifel' }), { label: 'Being paid by Marifel', tone: 'info', glyph: 'info' });
});
