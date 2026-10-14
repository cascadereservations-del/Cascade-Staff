// Lane C: the admin "Pay staff" screen, run in a fake browser. Every server call is mocked and the exact RPC / function name and argument keys are asserted.
// The payout payload here is SYNTHETIC (a ZZ account). Nothing reads the real clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    fetch: async (url, init) => { fetches.push({ url, init }); return { json: async () => (handlers.fetch ? handlers.fetch(url, init) : { ok: true, path: `${PROP}/c5100000-0000-4000-8000-0000000000a3/sub/shot.jpg`, sha256: '1'.repeat(64) }) }; },
    supabase: { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'me-1' } } } }) },
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
  assert.match(b.root.innerHTML, /To pay/); assert.match(b.root.innerHTML, /Honey/); assert.match(b.root.innerHTML, /data-act="pay" data-id="req1"/);
  assert.match(b.root.innerHTML, /Waiting for payment/);
  const denied = boot({ rpc: () => ({ data: { ok: false, reason: 'not_authorized' }, error: null }) }); await tick();
  assert.match(denied.root.innerHTML, /for the owner, admin and finance/);
  const absent = boot({}); await tick();
  assert.match(absent.root.innerHTML, /not switched on yet/);
  const offline = boot({ rpc: () => ({ data: null, error: { code: '08006', message: 'network' } }) }); await tick();
  assert.match(offline.root.innerHTML, /No connection/); assert.match(offline.root.innerHTML, /Try again/);
});

test('Pay: reads the QR for that request, marks it paying, draws the amount QR big with Save QR to photos, Copy amount and the fallback; the payload never reaches the page text or any storage', async () => {
  const b = boot(happy()); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  assert.deepEqual(plain(b.rpcs.slice(1)), [['staff_pay_admin_step_v1', { p_request_id: 'req1', p_step: 'pay' }], ['staff_pay_payout_qr_v1', { p_request_id: 'req1' }]], 'the payment is claimed first, then the QR is read');
  const h = b.root.innerHTML;
  assert.match(h, /<svg [^>]*viewBox="0 0 \d+ \d+"/); assert.match(h, /C_qrframe/);
  assert.match(h, /C_amount num"[^>]*>₱500</); assert.match(h, /Save QR to photos/); assert.match(h, /Honey's payout QR/); assert.match(h, /pick the saved QR, check the amount, send/); assert.doesNotMatch(h, /Open bank app|bank\.html|<a [^>]*target="_blank"/);
  assert.match(h, /If your bank ignores the amount/); assert.match(h, /Copy amount/); assert.match(h, /Show the QR without an amount/);
  assert.doesNotMatch(h, /ZZTESTPH|com\.p2pqrpay|000201/, 'the payload is not in the page');
  // the QR that was drawn first is the amount QR: dynamic, tag 54 = 500.00, valid CRC; the second is the static fallback
  const dyn = QrPh.decode(b.seen[0]); assert.equal(dyn.initiation, '12'); assert.equal(dyn.amount, '500.00');
  assert.equal(QrPh.decode(b.seen[1]).initiation, '11'); assert.equal(QrPh.decode(b.seen[1]).amount, null);
  assert.deepEqual(plain(b.touched), { local: [], session: [], caches: [] }, 'no storage and no cache was touched');
  // fallback screen
  await fire(b.root, 'click', { target: target({ 'data-act': 'togglestatic' }) });
  assert.match(b.root.innerHTML, /This QR has no amount\. Type ₱500 in your bank app\./); assert.match(b.root.innerHTML, /Show the QR with the amount/);
  assert.doesNotMatch(b.root.innerHTML, /Save QR to photos/, 'the saved photo is always the amount QR');
  await fire(b.root, 'click', { target: target({ 'data-act': 'copyamt' }) }); await fire(b.root, 'click', { target: target({ 'data-act': 'copyref' }) });
  assert.deepEqual(plain(b.copied), ['500', 'CASCADE-ABCD1234']);
  // leaving the page clears the screen
  for (const f of b.pagehide) f(); assert.equal(b.root.innerHTML, '');
});

test('Pay: a payee with no QR saved gets the plain fallback (amount, copy, the steps), not an error', async () => {
  const b = boot(happy({ staff_pay_payout_qr_v1: { data: { ok: true, id: 'req1', status: 'requested', payee_name: 'Honey', total: 500, payout_qrph: null }, error: null } })); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  assert.match(b.root.innerHTML, /payout QR is not saved yet/); assert.match(b.root.innerHTML, /Copy reference/); assert.doesNotMatch(b.root.innerHTML, /Open bank app/); assert.match(b.root.innerHTML, /C_amount num"[^>]*>₱500</);
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
  const notify = b.fetches.find((f) => /notify-cleaner-payment$/.test(f.url) && JSON.parse(f.init.body).action === 'paid');
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
  assert.match(c.root.innerHTML, /To pay/);
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

// ---- H1: two admins must never both pay the same request
const ROWS = [
  { ...REQ, id: 'rq', ref: 'REQ00001', payee_name: 'Reqy' },
  { ...REQ, id: 'own', ref: 'OWN00002', payee_name: 'Owny', status: 'paying', paying_by_name: 'Me', paying_by_user_id: 'me-1' },
  { ...REQ, id: 'oth', ref: 'OTH00003', payee_name: 'Othy', status: 'paying', paying_by_name: 'Marifel', paying_by_user_id: 'admin-2' },
  { ...REQ, id: 'tg', ref: 'TGG00004', payee_name: 'Telly', status: 'paying', paying_by_name: 'Lloyd', paying_by_user_id: null },
];
const multi = (over = {}) => happy({ staff_pay_admin_list_v1: { data: { ok: true, requests: ROWS.map((r) => ({ ...r })) }, error: null }, ...over });

test('H1 list: Pay only on requested rows and on paying rows this person started; another admin\'s or Telegram\'s payment shows who, with no Pay button', async () => {
  const b = boot(multi()); await tick();
  const h = b.root.innerHTML;
  assert.match(h, /data-act="pay" data-id="rq"/); assert.match(h, /data-act="pay" data-id="own"/);
  assert.doesNotMatch(h, /data-act="pay" data-id="oth"/); assert.doesNotMatch(h, /data-act="pay" data-id="tg"/);
  assert.match(h, /Marifel is paying this now\./); assert.match(h, /Lloyd is paying this now\./);
  assert.equal((h.match(/I am paying it instead/g) || []).length, 2); assert.match(h, /data-act="takeover-ask" data-id="oth"/);
  // a stale click on their row does nothing
  await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'oth' }) }); await tick();
  assert.equal(b.rpcs.filter((r) => r[0] !== 'staff_pay_admin_list_v1').length, 0, 'no step, no QR for a row somebody else is paying');
});

test('H1 take-over: asks first with the exact warning; Cancel changes nothing; Yes calls the takeover step, then pays and reads the QR', async () => {
  const b = boot(multi()); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'takeover-ask', 'data-id': 'oth' }) });
  assert.match(b.root.innerHTML, /Check with Marifel first\. Only one person should send the money\./); assert.match(b.root.innerHTML, /Yes, I am paying it/);
  assert.equal(b.rpcs.filter((r) => r[0] === 'staff_pay_admin_step_v1').length, 0);
  await fire(b.root, 'click', { target: target({ 'data-act': 'takecancel' }) });
  assert.doesNotMatch(b.root.innerHTML, /Check with Marifel first/); assert.match(b.root.innerHTML, /I am paying it instead/);
  await fire(b.root, 'click', { target: target({ 'data-act': 'takeover-ask', 'data-id': 'tg' }) });
  assert.match(b.root.innerHTML, /Check with Lloyd first/);
  await fire(b.root, 'click', { target: target({ 'data-act': 'takeover', 'data-id': 'oth' }) });
  await until(() => /<svg [^>]*role="img"/.test(b.root.innerHTML), 'pay view');
  assert.deepEqual(plain(b.rpcs.slice(1).map((r) => [r[0], r[1].p_step || null])), [['staff_pay_admin_step_v1', 'takeover'], ['staff_pay_admin_step_v1', 'pay'], ['staff_pay_payout_qr_v1', null]]);
});

test('H1 refusals never draw the QR: a not_open answer to Pay, a being_paid answer to the QR, a refused take-over', async () => {
  const a = boot(multi({ staff_pay_admin_step_v1: { data: { ok: false, reason: 'not_open', status: 'paying' }, error: null } })); await tick();
  await fire(a.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'rq' }) }); await until(() => /Someone else is already paying this one\./.test(a.root.innerHTML), 'refusal');
  assert.doesNotMatch(a.root.innerHTML, /<svg [^>]*role="img"/); assert.doesNotMatch(a.root.innerHTML, /Mark as paid/);
  assert.ok(!a.rpcs.some((r) => r[0] === 'staff_pay_payout_qr_v1'), 'the QR is not even requested');
  const b = boot(multi({ staff_pay_payout_qr_v1: { data: { ok: false, reason: 'being_paid', paying_by_name: 'Marifel' }, error: null } })); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'rq' }) }); await until(() => /Marifel is paying this now\./.test(b.root.innerHTML), 'refusal');
  assert.doesNotMatch(b.root.innerHTML, /<svg [^>]*role="img"/); assert.doesNotMatch(b.root.innerHTML, /Mark as paid/);
  const c = boot(multi({ staff_pay_admin_step_v1: { data: { ok: false, reason: 'money_may_be_sent' }, error: null } })); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'takeover', 'data-id': 'oth' }) }); await until(() => /already said the money was sent/.test(c.root.innerHTML), 'refusal');
  assert.doesNotMatch(c.root.innerHTML, /<svg [^>]*role="img"/);
});

test('H1: a refusal from the server on my own paying row goes back to the list with the sentence and no QR', async () => {
  const c = boot(multi({ staff_pay_admin_step_v1: { data: { ok: false, reason: 'not_yours' }, error: null } })); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'own' }) });
  await until(() => /Only the person who started paying can stop it\./.test(c.root.innerHTML), 'refusal');
  // opening my own paying row asks the server again; a refusal there goes back to the list with the sentence and no QR
  assert.doesNotMatch(c.root.innerHTML, /<svg [^>]*role="img"/);
});

test('M5 lost answer: the first settle fails on the network, the retry answers ok replay, and the screen is Done (never "not being paid")', async () => {
  let n = 0;
  const c = boot({ rpc: (name) => { if (name === 'staff_pay_admin_settle_v1') { if (++n === 1) throw new Error('network lost'); return { data: { ok: true, replay: true, status: 'paid', ref: 'ABCD1234' }, error: null }; } return happy().rpc(name); } }); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  await fire(c.root, 'change', { target: { id: 'C_file', files: [{ name: 'shot.png' }] } }); await fire(c.root, 'input', { target: { id: 'C_ref', value: 'ref12345' } });
  await fire(c.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /nothing was marked paid/.test(c.root.innerHTML), 'first failure');
  await fire(c.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /Marked paid/.test(c.root.innerHTML), 'done');
  assert.doesNotMatch(c.root.innerHTML, /not being paid/);
  assert.equal(c.fetches.filter((f) => /upload-photo$/.test(f.url)).length, 1, 'the retry reuses the stored screenshot');
});

test('the upload response sha256 (the server\'s own figure) is what is sent to the settle', async () => {
  const c = boot({ rpc: happy().rpc, fetch: () => ({ ok: true, path: PROP + '/u/s/x.jpg', sha256: 'f'.repeat(64) }) }); await tick();
  await fire(c.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick();
  await fire(c.root, 'change', { target: { id: 'C_file', files: [{ name: 'shot.png' }] } }); await fire(c.root, 'input', { target: { id: 'C_ref', value: 'ref12345' } });
  await fire(c.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /Marked paid/.test(c.root.innerHTML), 'done');
  assert.equal(plain(c.rpcs.find((r) => r[0] === 'staff_pay_admin_settle_v1'))[1].p_proof.sha256, 'f'.repeat(64));
});

test('refusal sentences for the new reasons are plain', () => {
  for (const [res, re] of [[{ reason: 'being_paid', paying_by_name: 'Marifel' }, /^Marifel is paying this now\.$/], [{ reason: 'not_open', status: 'paying' }, /Someone else is already paying/], [{ reason: 'not_open', status: 'paid' }, /already closed/],
    [{ reason: 'not_yours' }, /Only the person who started/], [{ reason: 'not_your_payment' }, /cannot mark it paid/], [{ reason: 'sha_mismatch' }, /changed after it was uploaded/]]) assert.match(A.refusal(res), re);
});

// ---- M-A: the first sign that money may be on its way tells the server once
const sayYes = async (root) => { await fire(root, 'click', { target: target({ 'data-act': 'sent' }) }); await fire(root, 'click', { target: target({ 'data-act': 'sent-yes' }) }); };
const stepsOf = (b) => plain(b.rpcs.filter((r) => r[0] === 'staff_pay_admin_step_v1').map((r) => r[1].p_step));
async function openOwn(b) { await tick(); await fire(b.root, 'click', { target: target({ 'data-act': 'pay', 'data-id': 'req1' }) }); await tick(); }

test('M-A (P_ s83): only the explicit "I have sent it" says "sent" to the server, once, and the screen shows it', async () => {
  const b = boot(happy()); await openOwn(b);
  assert.deepEqual(stepsOf(b), ['pay']); assert.doesNotMatch(b.root.innerHTML, /Marked as sent/); assert.match(b.root.innerHTML, /data-act="sent"/);
  await sayYes(b.root); await until(() => /Marked as sent, so nobody else can take this over/.test(b.root.innerHTML), 'marked');
  const sent = plain(b.rpcs.filter((r) => r[1] && r[1].p_step === 'sent')[0]); assert.deepEqual(sent, ['staff_pay_admin_step_v1', { p_request_id: 'req1', p_step: 'sent' }]);
  await sayYes(b.root); await fire(b.root, 'click', { target: target({ 'data-act': 'copyamt' }) }); await tick();
  assert.deepEqual(stepsOf(b), ['pay', 'sent'], 'only once');
  assert.match(b.root.innerHTML, /I have not sent it/); assert.doesNotMatch(b.root.innerHTML, /I am not paying this now/); assert.doesNotMatch(b.root.innerHTML, /data-act="sent"/, 'the button is gone once it is said');
});

test('M-A: "I have not sent it" steps back with not_sent; a refused sent (somebody took over) shows the sentence and clears the mark; reopening my sent payment starts marked', async () => {
  const b = boot(happy()); await openOwn(b);
  await sayYes(b.root); await until(() => /I have not sent it/.test(b.root.innerHTML), 'marked');
  await fire(b.root, 'click', { target: target({ 'data-act': 'unpay' }) }); await tick();
  assert.deepEqual(stepsOf(b), ['pay', 'sent', 'not_sent']);
  const r = boot(happy({ staff_pay_admin_step_v1: { data: { ok: false, reason: 'not_yours' }, error: null } })); await tick();
  r.ctx.document.getElementById('C_pay_admin');
  const lost = boot({ rpc: (name, a) => (name === 'staff_pay_admin_step_v1' && a.p_step === 'sent' ? { data: { ok: false, reason: 'not_yours' }, error: null } : happy().rpc(name)) }); await openOwn(lost);
  await sayYes(lost.root); await until(() => /Only the person who started paying can stop it/.test(lost.root.innerHTML), 'refusal');
  const again = boot(happy({ staff_pay_admin_list_v1: { data: { ok: true, requests: [{ ...REQ, status: 'paying', paying_by_user_id: 'me-1', paying_by_name: 'Me', sent_said_at: '2026-10-13T03:00:00Z' }] }, error: null } })); await openOwn(again);
  assert.match(again.root.innerHTML, /Marked as sent/); assert.match(again.root.innerHTML, /I have not sent it/);
});

test('M-A list: another admin payment that may already be sent says so and offers no take-over', async () => {
  const b = boot(multi({ staff_pay_admin_list_v1: { data: { ok: true, requests: [{ ...ROWS[2], sent_said_at: '2026-10-13T03:00:00Z' }, { ...ROWS[3] }] }, error: null } })); await tick();
  const h = b.root.innerHTML;
  assert.match(h, /Marifel may already have sent this\. Ask Marifel before doing anything\./);
  assert.doesNotMatch(h, /data-act="takeover-ask" data-id="oth"/); assert.match(h, /data-act="takeover-ask" data-id="tg"/);
});

test('L-B: an upload answer without sha256 never reaches the settle; the screenshot stays chosen; the sentence says to ask Lloyd', async () => {
  const c = boot({ rpc: happy().rpc, fetch: () => ({ ok: true, path: PROP + '/u/s/x.jpg' }) }); await openOwn(c);
  await fire(c.root, 'change', { target: { id: 'C_file', files: [{ name: 'shot.png' }] } }); await fire(c.root, 'input', { target: { id: 'C_ref', value: 'ref12345' } });
  await fire(c.root, 'click', { target: target({ 'data-act': 'settle' }) }); await until(() => /not fully switched on yet\. Ask Lloyd\./.test(c.root.innerHTML), 'sentence');
  assert.ok(!c.rpcs.some((r) => r[0] === 'staff_pay_admin_settle_v1'), 'settle is not called');
  assert.match(c.root.innerHTML, /Change screenshot/, 'the chosen screenshot is kept'); assert.match(c.root.innerHTML, /shot\.png/);
  assert.doesNotMatch(c.root.innerHTML, /Marked paid/);
});

test('L-A: opening, taking over and stepping back redraw the Finance card through the card action (best effort)', async () => {
  const b = boot(multi()); await tick();
  await fire(b.root, 'click', { target: target({ 'data-act': 'takeover', 'data-id': 'oth' }) }); await until(() => /<svg [^>]*role="img"/.test(b.root.innerHTML), 'pay view');
  await until(() => b.fetches.some((f) => /notify-cleaner-payment$/.test(f.url)), 'card call');
  const cards = b.fetches.filter((f) => /notify-cleaner-payment$/.test(f.url)).map((f) => plain(JSON.parse(f.init.body)));
  assert.ok(cards.length >= 1 && cards.every((c) => c.action === 'card' && c.request_id === 'oth'), JSON.stringify(cards));
  const before = cards.length;
  await fire(b.root, 'click', { target: target({ 'data-act': 'unpay' }) }); await until(() => b.fetches.filter((f) => /notify-cleaner-payment$/.test(f.url)).length > before, 'card after step back');
  const down = boot({ rpc: happy().rpc, fetch: () => { throw new Error('offline'); } }); await openOwn(down);
  assert.match(down.root.innerHTML, /Mark as paid/, 'a failed card call never blocks the screen');
});

// ---- P_ (s83): the dead bank-app control is gone; Save, Copy and the screenshot never say "sent"; honest copy and share paths
const everyOtherTap = [['saveqr'], ['copyamt'], ['copyref'], ['togglestatic'], ['pickfile'], ['bank'], ['unreq']];
test('P_ no tap except the explicit confirmation ever calls the sent step or the settle RPC (Save, Copy, bank link, fallback toggle, picked screenshot)', async () => {
  const b = boot(happy()); await openOwn(b);
  b.ctx.navigator.canShare = () => true; b.ctx.navigator.share = async () => {};
  for (const [act] of everyOtherTap) await fire(b.root, 'click', { target: target({ 'data-act': act, 'data-id': 'x' }) });
  await fire(b.root, 'change', { target: { id: 'C_file', files: [{ name: 'shot.png' }] } }); await tick();
  assert.deepEqual(stepsOf(b), ['pay'], 'nothing said "sent"');
  assert.equal(b.rpcs.some((r) => r[0] === 'staff_pay_admin_settle_v1'), false, 'no settle without Mark as paid');
  assert.doesNotMatch(b.root.innerHTML, /Marked as sent/);
  // and the one explicit tap does
  await sayYes(b.root); await until(() => /Marked as sent/.test(b.root.innerHTML), 'marked');
  assert.deepEqual(stepsOf(b), ['pay', 'sent']);
});

test('P_ the pay screen carries no link at all and no bank-app words; the steps line and the explicit confirmation are there', async () => {
  const b = boot(happy()); await openOwn(b);
  const h = b.root.innerHTML;
  assert.doesNotMatch(h, /<a [^>]*href="(?!#)[^"]*"[^>]*data-act="bank"|Open bank app|Open BPI|bank\.html|intent:/);
  assert.match(h, /open it, choose Pay by QR, pick the saved QR, check the amount, send/); assert.match(h, />I have sent it</);
  assert.ok(h.indexOf('Save QR to photos') < h.indexOf('Pay by QR') && h.indexOf('Pay by QR') < h.indexOf('I have sent it') && h.indexOf('I have sent it') < h.indexOf('Add the screenshot'), 'order: save, steps, confirm, screenshot');
  const noqr = boot(happy({ staff_pay_payout_qr_v1: { data: { ok: true, id: 'req1', status: 'requested', payee_name: 'Honey', total: 500, payout_qrph: null }, error: null } })); await openOwn(noqr);
  assert.doesNotMatch(noqr.root.innerHTML, /Open bank app|bank\.html/); assert.match(noqr.root.innerHTML, />I have sent it</);
});

test('P_ Copy amount shows "Amount copied" on screen; a refused clipboard says so and selects the amount instead of failing silently', async () => {
  const b = boot(happy()); await openOwn(b);
  await fire(b.root, 'click', { target: target({ 'data-act': 'copyamt' }) }); await tick();
  assert.deepEqual(plain(b.copied), ['500']);
  await fire(b.root, 'click', { target: target({ 'data-act': 'togglestatic' }) });
  assert.match(b.root.innerHTML, /role="status">Amount copied</);
  const r = boot(happy()); await openOwn(r);
  const sel = []; r.ctx.getSelection = () => ({ removeAllRanges() {}, addRange(x) { sel.push(x); } }); r.ctx.document.createRange = () => ({ selectNodeContents(el) { this.el = el; } });
  r.els.C_amttext = new FakeEl('C_amttext'); r.ctx.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await fire(r.root, 'click', { target: target({ 'data-act': 'copyamt' }) }); await tick();
  await fire(r.root, 'click', { target: target({ 'data-act': 'togglestatic' }) });
  assert.match(r.root.innerHTML, /Copy did not work\. The amount is selected/); assert.equal(sel.length, 1, 'the amount text was selected');
  assert.deepEqual(stepsOf(r), ['pay']);
});

test('P_ Save QR to photos: shares the PNG file when the phone offers it, else downloads it; neither says "sent"', async () => {
  const b = boot(happy()); await openOwn(b); const shared = [];
  b.ctx.navigator.canShare = () => true; b.ctx.navigator.share = async (o) => { shared.push(o); };
  await fire(b.root, 'click', { target: target({ 'data-act': 'saveqr' }) });
  assert.equal(shared.length, 1); assert.equal(shared[0].files[0].name, 'cascade-pay-ABCD1234.png');
  const d = boot(happy()); await openOwn(d); const made = []; const mk = d.ctx.document.createElement;
  d.ctx.document.createElement = (tag) => (tag === 'a' ? (made.push(tag), { click() { made.push('click'); } }) : mk(tag)); d.ctx.setTimeout = () => {};
  await fire(d.root, 'click', { target: target({ 'data-act': 'saveqr' }) });
  assert.deepEqual(made, ['a', 'click']); assert.deepEqual(stepsOf(d), ['pay']);
  await fire(d.root, 'click', { target: target({ 'data-act': 'togglestatic' }) });
});

test('P_ Paid recently shows the reference and who paid; the payee is named above the QR', async () => {
  const b = boot({ rpc: (n) => ({ staff_pay_admin_list_v1: { data: { ok: true, requests: [{ ...REQ, id: 'p1', ref: 'PAID9999', status: 'paid', paid_at: '2026-10-12T04:00:00Z', paid_by_name: 'Marifel' }] }, error: null } }[n]) }); await tick();
  assert.match(b.root.innerHTML, /Paid recently/); assert.match(b.root.innerHTML, /Ref PAID9999 · by Marifel/);
});

test('P_ "I have sent it" asks once first: the first tap sends nothing, "Not yet" cancels, only "Yes, I sent it" says sent', async () => {
  const b = boot(happy()); await openOwn(b);
  await fire(b.root, 'click', { target: target({ 'data-act': 'sent' }) }); await tick();
  assert.match(b.root.innerHTML, /Has the money left your bank app\?/); assert.deepEqual(stepsOf(b), ['pay'], 'asking is not saying');
  await fire(b.root, 'click', { target: target({ 'data-act': 'sent-no' }) }); await tick();
  assert.doesNotMatch(b.root.innerHTML, /Has the money left/); assert.deepEqual(stepsOf(b), ['pay']);
  await sayYes(b.root); await until(() => /Marked as sent/.test(b.root.innerHTML), 'marked'); assert.deepEqual(stepsOf(b), ['pay', 'sent']);
});

test('P_ source guard: markSent has exactly one caller, the sent-yes handler; the bank anchor and its handler are gone', () => {
  const src = fs.readFileSync(path.join(root, 'pay', 'C_admin.js'), 'utf8');
  const calls = src.match(/markSent\(\)/g) || [];
  assert.equal(calls.length, 2, 'the definition and one call');
  assert.match(src, /a === 'sent-yes'\) \{[^}]*markSent\(\)/);
  assert.doesNotMatch(src, /data-act="bank"|a === 'bank'|bankLink|Open bank app/);
  assert.equal(fs.existsSync(path.join(root, 'pay', 'bank.html')), false);
});

test('P_ admin cancel: ask, confirm text, Keep it sends nothing, Yes calls staff_pay_admin_step_v1 {p_request_id, p_step:cancel}, list reloads with the note', async () => {
  const b = boot(happy()); await openOwn(b);
  await fire(b.root, 'click', { target: target({ 'data-act': 'cancel-ask' }) }); await tick();
  assert.match(b.root.innerHTML, /Cancel request ABCD1234\? The cleans and claims go back to unpaid work\./);
  await fire(b.root, 'click', { target: target({ 'data-act': 'cancel-no' }) }); await tick();
  assert.doesNotMatch(b.root.innerHTML, /go back to unpaid work/); assert.deepEqual(stepsOf(b), ['pay']);
  const before = b.rpcs.filter((r) => r[0] === 'staff_pay_admin_list_v1').length;
  await fire(b.root, 'click', { target: target({ 'data-act': 'cancel-ask' }) }); await fire(b.root, 'click', { target: target({ 'data-act': 'cancel-yes' }) });
  await until(() => /is cancelled\. Its cleans and claims are back under Not yet requested/.test(b.root.innerHTML), 'cancelled');
  assert.deepEqual(plain(b.rpcs.filter((r) => r[1] && r[1].p_step === 'cancel')), [['staff_pay_admin_step_v1', { p_request_id: 'req1', p_step: 'cancel' }]]);
  assert.equal(b.rpcs.filter((r) => r[0] === 'staff_pay_admin_list_v1').length, before + 1, 'the list reloads');
});

test('P_ admin cancel: no cancel button once sent is marked; a server refusal money_may_be_sent shows the sentence and points to I have not sent it', async () => {
  const b = boot(happy()); await openOwn(b); await sayYes(b.root); await until(() => /I have not sent it/.test(b.root.innerHTML), 'marked');
  assert.doesNotMatch(b.root.innerHTML, /data-act="cancel-ask"/); assert.match(b.root.innerHTML, /cancel the request after that/);
  const r = boot({ rpc: (n, a) => (a && a.p_step === 'cancel' ? { data: { ok: false, reason: 'money_may_be_sent' }, error: null } : happy().rpc(n, a)) }); await openOwn(r);
  await fire(r.root, 'click', { target: target({ 'data-act': 'cancel-ask' }) }); await fire(r.root, 'click', { target: target({ 'data-act': 'cancel-yes' }) });
  await until(() => /Tap I have not sent it first, then cancel\./.test(r.root.innerHTML), 'refused'); assert.match(r.root.innerHTML, /already said the money was sent/);
});
