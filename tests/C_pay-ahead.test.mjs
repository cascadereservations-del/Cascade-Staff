// Lane P (s82): Pay staff shows unpaid work with no request (NOT YET REQUESTED), pays ahead through staff_pay_admin_create_v1, keeps PAID RECENTLY,
// and the cleaner page says "Cleaning fee", takes ?clean=<session_id>, and shares the app's bar and tab bar. Fake browser; no clock; every call mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { FakeEl, fire, load, plain, target, tick, until } from './C_dom-harness.mjs';
const req = createRequire(import.meta.url);
const P = req('../pay/pay-lib.js');
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const OPEN = { id: 'req1', ref: 'ABCD1234', status: 'requested', payee_name: 'Honey', total: 500, created_at: '2026-10-13T02:00:00Z', has_qr: true, lines: [] };
const PAID = { id: 'old1', ref: 'ZZZZ0001', status: 'paid', payee_name: 'Honey', total: 900, created_at: '2026-10-08T02:00:00Z', paid_at: '2026-10-09T04:00:00Z', paid_by_name: 'Marifel', lines: [] };
const UNREQ = [{ payee_user_id: 'u-2', payee_name: 'Marites', has_qr: true, total: 1340,
  sessions: [{ id: 's-1', date: '2026-10-11', type: 'turnover', base: 500, transport: 100 }, { id: 's-2', date: '2026-10-12', type: 'deep_clean', base: 735, transport: null }],
  claims: [{ id: 'c-1', date: '2026-10-12', description: 'Trash bags', amount: 105, receipt: true }] }];
const NEW = { ...OPEN, id: 'new1', ref: 'NEWW0001', payee_name: 'Marites', total: 1340 };

function bootAdmin(handlers = {}, win = {}) {
  const els = { C_pay_admin: new FakeEl('C_pay_admin') }; const rpcs = [];
  const ctx = {
    console, setTimeout, clearTimeout, setImmediate, Promise, Uint8Array, ArrayBuffer, TextEncoder, JSON, Math, Object, Array, String, Number, Error, isNaN, parseInt, atob, btoa, encodeURIComponent, decodeURIComponent,
    crypto: globalThis.crypto, localStorage: null, sessionStorage: null, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Image: class {}, File: class {},
    navigator: { userAgent: 'test' }, fetch: async () => ({ json: async () => ({ ok: true }) }),
    document: { getElementById: (id) => els[id] || null, createElement: () => ({}), body: { appendChild() {}, removeChild() {} } },
    supabase: { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'me-1' } } } }) },
      rpc: async (name, args) => { rpcs.push([name, args]); return (handlers.rpc && handlers.rpc(name, args)) || { data: null, error: { code: 'PGRST202' } }; },
    }) }, ...win,
  };
  ctx.self = ctx; ctx.window = ctx; ctx.addEventListener = () => {};
  load(['icons.js', 'lib.js', 'pay/pay-lib.js', 'pay/C_qrph.js', 'pay/C_qr.js', 'pay/C_admin-lib.js'], ctx);
  load(['pay/C_admin.js'], ctx);
  return { ctx, root: els.C_pay_admin, rpcs };
}
const LIST = (requests, unrequested) => ({ data: { ok: true, requests, ...(unrequested === undefined ? {} : { unrequested }) }, error: null });
const click = (b, attrs) => fire(b.root, 'click', { target: target(attrs) });

test('P_ list: three groups when the server sends unrequested; each staff card names the person, the count and the total', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([OPEN, PAID], UNREQ) }[n]) }); await tick();
  const h = b.root.innerHTML;
  assert.ok(h.indexOf('To pay') < h.indexOf('Not yet requested') && h.indexOf('Not yet requested') < h.indexOf('Paid recently'), 'order');
  assert.match(h, /data-act="pay" data-id="req1"/); assert.match(h, /<span class="P_go btn btn-primary">Pay<\/span>/);
  assert.match(h, /data-act="unreq" data-id="u-2"/); assert.match(h, /<span class="P_amt num">₱1,340<\/span><span class="t">Marites<\/span>/); assert.match(h, /2 cleans · 1 expense · not requested yet/);
  assert.match(h, /Paid 9 Oct · Ref ZZZZ0001 · by Marifel/); assert.doesNotMatch(h, /data-id="old1"/, 'a paid row is a record, not a button');
  assert.doesNotMatch(h, /Nothing to pay right now/);
});

test('P_ list: with no unrequested key (older server) NOT YET REQUESTED is not drawn and the rest is unchanged', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([OPEN, PAID]) }[n]) }); await tick();
  assert.doesNotMatch(b.root.innerHTML, /Not yet requested/); assert.match(b.root.innerHTML, /To pay/); assert.match(b.root.innerHTML, /Paid recently/);
  const only = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([]) }[n]) }); await tick();
  assert.match(only.root.innerHTML, /Nothing to pay right now<\/h2><p>Unpaid cleans appear here as soon as a report is sent\./);
});

test('P_ list: the empty state shows only when all three groups are empty', async () => {
  const none = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], []) }[n]) }); await tick();
  assert.match(none.root.innerHTML, /Nothing to pay right now/); assert.doesNotMatch(none.root.innerHTML, /Not yet requested/);
  const un = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], UNREQ) }[n]) }); await tick();
  assert.doesNotMatch(un.root.innerHTML, /Nothing to pay right now/); assert.match(un.root.innerHTML, /Not yet requested/);
});

test('P_ pay ahead: lines open pre-ticked, a transport toggle changes the total, Pay now calls staff_pay_admin_create_v1 with the exact keys, then goes into the normal Pay flow', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: b2list(), staff_pay_admin_create_v1: { data: { ok: true, id: 'new1', ref: 'NEWW0001' }, error: null },
    staff_pay_admin_step_v1: { data: { ok: true, status: 'paying' }, error: null }, staff_pay_payout_qr_v1: { data: { ok: true, id: 'new1', ref: 'NEWW0001', status: 'requested', payee_name: 'Marites', total: 1340, payout_qrph: null }, error: null } }[n]) });
  let created = false; function b2list() { return LIST(created ? [NEW, OPEN] : [OPEN], created ? [] : UNREQ); }
  await tick();
  await click(b, { 'data-act': 'unreq', 'data-id': 'u-2' });
  let h = b.root.innerHTML;
  assert.equal((h.match(/aria-checked="true"/g) || []).length, 3, 'two cleans and one expense pre-ticked'); assert.match(h, /Total to pay/); assert.match(h, /₱1,340/);
  assert.match(h, /Transport \+₱100/); assert.equal((h.match(/role="switch"/g) || []).length, 1, 'only the clean with a transport rate has the toggle');
  await click(b, { 'data-act': 'u-sw', 'data-id': 's-1' }); assert.match(b.root.innerHTML, /₱1,440/);
  await click(b, { 'data-act': 'u-ses', 'data-id': 's-2' }); assert.match(b.root.innerHTML, /₱705/, 'unticking a clean takes its base off');
  created = true;
  await click(b, { 'data-act': 'u-pay' });
  await until(() => b.rpcs.some((r) => r[0] === 'staff_pay_payout_qr_v1'), 'continues into Pay');
  const c = b.rpcs.filter((r) => r[0] === 'staff_pay_admin_create_v1'); assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][1]), ['p_payee_user_id', 'p_sessions', 'p_claim_ids', 'p_idempotency_key']);
  assert.equal(c[0][1].p_payee_user_id, 'u-2'); assert.deepEqual(plain(c[0][1].p_sessions), [{ id: 's-1', transport: true }]); assert.deepEqual(plain(c[0][1].p_claim_ids), ['c-1']);
  assert.match(c[0][1].p_idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const after = plain(b.rpcs.map((r) => [r[0], r[1] && (r[1].p_step || r[1].p_request_id) || null]).slice(b.rpcs.indexOf(c[0]) + 1));
  assert.deepEqual(after.filter((x) => x[0] !== 'staff_pay_admin_list_v1'), [['staff_pay_admin_step_v1', 'pay'], ['staff_pay_payout_qr_v1', 'new1']], 'the new request is claimed and its QR read, nothing else');
});

test('P_ pay ahead: a failed create keeps the same idempotency key on the retry', async () => {
  let fail = true;
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], UNREQ), staff_pay_admin_create_v1: fail ? { data: null, error: { code: '08006', message: 'network' } } : { data: { ok: false, reason: 'not_authorized' }, error: null } }[n]) }); await tick();
  await click(b, { 'data-act': 'unreq', 'data-id': 'u-2' }); await click(b, { 'data-act': 'u-pay' });
  await until(() => /No connection/.test(b.root.innerHTML), 'offline words');
  fail = false; await click(b, { 'data-act': 'u-pay' });
  await until(() => /for the owner, admin and finance/.test(b.root.innerHTML), 'calm refusal');
  const keys = b.rpcs.filter((r) => r[0] === 'staff_pay_admin_create_v1').map((r) => r[1].p_idempotency_key); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});

test('P_ pay ahead: a taken clean sends her back to a refreshed list with the sentence; an old server says it is not switched on', async () => {
  const taken = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], UNREQ), staff_pay_admin_create_v1: { data: { ok: false, reason: 'session_taken' }, error: null } }[n]) }); await tick();
  await click(taken, { 'data-act': 'unreq', 'data-id': 'u-2' }); await click(taken, { 'data-act': 'u-pay' });
  await until(() => /already requested or paid/.test(taken.root.innerHTML), 'sentence'); assert.equal(taken.rpcs.filter((r) => r[0] === 'staff_pay_admin_list_v1').length, 2, 'list read again');
  const old = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], UNREQ) }[n]) }); await tick();
  await click(old, { 'data-act': 'unreq', 'data-id': 'u-2' }); await click(old, { 'data-act': 'u-pay' });
  await until(() => /Paying ahead is not switched on yet/.test(old.root.innerHTML), 'old server');
});

test('P_ done card: says what was recorded (amount, request, bank reference) and that the staff member is told', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([OPEN]), staff_pay_admin_step_v1: { data: { ok: true, status: 'paying' }, error: null },
    staff_pay_payout_qr_v1: { data: { ok: true, id: 'req1', ref: 'ABCD1234', status: 'requested', payee_name: 'Honey', total: 500, payout_qrph: null }, error: null }, staff_pay_admin_settle_v1: { data: { ok: true, status: 'paid' }, error: null } }[n]) });
  await tick(); await click(b, { 'data-act': 'pay', 'data-id': 'req1' }); await until(() => /Mark as paid/.test(b.root.innerHTML), 'pay view');
  b.ctx.document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toBlob(cb) { cb({ arrayBuffer: async () => new Uint8Array([1, 2]).buffer }); } });
  b.ctx.Image = class { set src(v) { this.naturalWidth = 10; this.naturalHeight = 10; setImmediate(() => this.onload()); } };
  b.ctx.fetch = async () => ({ json: async () => ({ ok: true, path: 'p/shot.jpg', sha256: 'a'.repeat(64) }) });
  await fire(b.root, 'input', { target: { id: 'C_amt', value: '500' } }); await fire(b.root, 'input', { target: { id: 'C_ref', value: 'ab-1234' } });
  await fire(b.root, 'change', { target: { id: 'C_file', files: [{ name: 's.png' }] } });
  await click(b, { 'data-act': 'settle' }); await until(() => /What was recorded/.test(b.root.innerHTML), 'done card');
  const h = b.root.innerHTML; assert.match(h, /Marked paid\. Honey is told by message, in Telegram and in the app\./); assert.match(h, /<b>₱500<\/b>/); assert.match(h, /<b>ABCD1234<\/b>/); assert.match(h, /<b>AB1234<\/b>/);
});

// ---------------------------------------------------------------- cleaner page
const CANDS = { ok: true, payee_name: 'Honey', sessions: [{ id: 's-1', date: '2026-10-02', type: 'turnover', base: 500, transport: 150 }, { id: 's-2', date: '2026-10-04', type: 'deep_clean', base: 800, transport: null }],
  claims: [{ id: 'c-1', date: '2026-10-03', description: 'Gloves', amount: 90 }], missing_reports: [], requests: [] };
function bootPay({ search = '', hash = '', mine, noSession = false } = {}) {
  const els = { pay: new FakeEl('pay'), 'C_push-slot': new FakeEl('C_push-slot') };
  const ctx = {
    console, setTimeout, setImmediate, Promise, JSON, Math, Object, Array, String, Number, Error, isNaN, parseInt, encodeURIComponent, crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Image: class {}, File: class {}, navigator: { userAgent: 'test' }, sessionStorage: null, location: { search, hash },
    document: { getElementById: (id) => els[id] || null, querySelector: () => null, createElement: () => ({}) }, scrollY: 0, scrollTo() {},
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: noSession ? null : { access_token: 't' } } }) }, rpc: async (n) => (n === 'staff_pay_candidates_v1' ? { data: CANDS, error: null } : mine ? { data: { ok: true, requests: mine }, error: null } : { data: null, error: { code: 'PGRST202' } }) }) },
  };
  ctx.self = ctx; ctx.window = ctx; ctx.addEventListener = () => {};
  load(['icons.js', 'lib.js', 'pay/pay-lib.js', 'pay/C_paid-text.js'], ctx);
  ctx.C_Push = { status: async () => ({ state: 'hidden' }) };
  load(['pay/pay.js'], ctx);
  return { root: els.pay };
}

test('P_ Cleaning fee: the page is titled Cleaning fee with its sub-line, and the old phrase is gone', async () => {
  const b = bootPay(); await until(() => /Not yet paid/.test(b.root.innerHTML), 'list');
  assert.match(b.root.innerHTML, /<h1 class="ttl">Cleaning fee<\/h1>/); assert.match(b.root.innerHTML, /Ask for payment for your cleans and expenses/);
  assert.doesNotMatch(b.root.innerHTML, /Ask for your pay|>Your pay</);
  const nosess = bootPay({ noSession: true }); await until(() => /Sign in to the Staff app first/.test(nosess.root.innerHTML), 'signin state'); // the title tag is HTML, outside the fake browser: checked in a real browser
  assert.match(nosess.root.innerHTML, /then open Cleaning fee\./); assert.doesNotMatch(nosess.root.innerHTML, /Ask for your pay/);
  assert.match(b.root.innerHTML, /Review request/);
});

test('P_ ?clean=<session_id> ticks that clean only (expenses stay ticked); an unknown id changes nothing', async () => {
  const b = bootPay({ search: '?clean=s-2' }); await until(() => /Not yet paid/.test(b.root.innerHTML), 'list');
  const on = (id) => new RegExp('aria-checked="true" aria-label="[^"]*" data-ses="' + id + '"').test(b.root.innerHTML);
  assert.equal(on('s-2'), true); assert.equal(on('s-1'), false); assert.match(b.root.innerHTML, /aria-checked="true" aria-label="Gloves" data-clm="c-1"/);
  const unk = bootPay({ search: '?clean=nope' }); await until(() => /Not yet paid/.test(unk.root.innerHTML), 'list');
  assert.match(unk.root.innerHTML, /aria-checked="true" aria-label="[^"]*" data-ses="s-1"/); assert.match(unk.root.innerHTML, /aria-checked="true" aria-label="[^"]*" data-ses="s-2"/);
});

test('P_ transport toggle is one row, label on the left and the switch on the right, with its own accessible name (H7)', async () => {
  const b = bootPay(); await until(() => /Not yet paid/.test(b.root.innerHTML), 'list');
  assert.match(b.root.innerHTML, /<button class="sw P_tr" type="button" role="switch" aria-checked="false" aria-label="Add ₱150 transport for Fri 2 Oct" data-sw="s-1"><span>Transport \+₱150<\/span><i aria-hidden="true"><\/i><\/button>/);
  assert.doesNotMatch(b.root.innerHTML, /added for this clean/);
  // the 44 px height is a layout fact: measured in a real browser (258x44), not asserted from stylesheet text
});

test('P_ expectation line sits under the stepper of an open request and not under a paid one (F24)', async () => {
  const mine = [{ ref: 'AAAA0001', status: 'requested', total: 500, created_at: '2026-10-13T02:00:00Z' }, { ref: 'BBBB0002', status: 'paid', total: 90, created_at: '2026-10-10T02:00:00Z', paid_at: '2026-10-11T02:00:00Z', bank_reference: '12345678' }];
  const b = bootPay({ mine }); await until(() => /Your requests/.test(b.root.innerHTML), 'history');
  assert.equal((b.root.innerHTML.match(/Usually paid the same day\. You will see "You were paid" here\./g) || []).length, 1);
});

// ---------------------------------------------------------------- shared chrome
test('P_ chrome: Today is current, badges come from the hash, Back is the app home unless the link came from the app', async () => {
  const b = bootPay({ hash: '#tasks=2&cal=3' }); await until(() => /Not yet paid/.test(b.root.innerHTML), 'list');
  const h = b.root.innerHTML;
  assert.match(h, /<a class="tab" href="\.\.\/#home"><span/); assert.equal((h.match(/aria-current="page"/g) || []).length, 0, 'B3: a pay page marks no tab');
  assert.match(h, /<span class="badge" aria-label="3 warnings">3<\/span>/); assert.match(h, /<span class="badge" aria-label="2 due">2<\/span>/);
  assert.match(h, /<a class="iconbtn" href="\.\.\/#home" aria-label="Back" data-p-back="1">/);
  assert.doesNotMatch(bootPay().root.innerHTML + h.replace(/#tasks=2&cal=3/, ''), /class="badge" aria-label="0/);
  assert.deepEqual(P.P_hashCounts('#tasks=2&cal=x&evil=9'), { tasks: 2, cal: 0 });
  assert.equal(P.P_backIsHistory('', 'https://x.test', '#tasks=0&cal=0', 2), true, 'the app link carries the hash even when the referrer is hidden');
  assert.equal(P.P_backIsHistory('https://x.test/index.html', 'https://x.test', '', 3), true);
  assert.equal(P.P_backIsHistory('https://evil.test/', 'https://x.test', '', 3), false); assert.equal(P.P_backIsHistory('', 'https://x.test', '#tasks=1', 1), false, 'no history to go back to');
});

test('P_ chrome: both pages carry the ambient background and the admin page uses the same bar and tab bar', async () => {
  // the A_bg block is static HTML: proven in a real browser, not here
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([OPEN]) }[n]) }, { location: { hash: '#tasks=1&cal=0', search: '' } }); await tick();
  assert.doesNotMatch(b.root.innerHTML, /aria-current="page"/); assert.match(b.root.innerHTML, /aria-label="1 due"/); assert.match(b.root.innerHTML, /<nav class="tabbar" aria-label="Primary">/);
});

test('P_ unreachable states stay calm: not authorised and not ready read as sentences, with no staff list', async () => {
  const no = bootAdmin({ rpc: () => ({ data: { ok: false, reason: 'not_authorized' }, error: null }) }); await tick();
  assert.match(no.root.innerHTML, /for the owner, admin and finance/); assert.doesNotMatch(no.root.innerHTML, /Not yet requested|Marites/);
});

// ---------------------------------------------------------------- fix round (Fable review of fc37cf7)
const deferred = () => { let ok; const p = new Promise((r) => { ok = r; }); return { p, ok }; };
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
const qrBody = tlv('00', '01') + tlv('01', '11') + tlv('27', tlv('00', 'com.p2pqrpay') + tlv('01', 'ZZTESTPHZZZ') + tlv('02', '99964403') + tlv('03', '9990000111122223')) + tlv('52', '6016') + tlv('53', '608') + tlv('58', 'PH') + tlv('59', 'ZZ TEST PAYEE') + tlv('60', 'TESTCITY') + '6304';
const STATIC = qrBody + req('../pay/C_qrph.js').crc16(qrBody);
const backTarget = () => target({}, 'appbar-a');
const openUn = async (b) => { await tick(); await click(b, { 'data-act': 'unreq', 'data-id': 'u-2' }); };

test('P_ fix: Back is ignored while the request is being made, and the answer then goes on into Pay for the new request only', async () => {
  const create = deferred(); let made = false;
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST(made ? [NEW, OPEN] : [OPEN], made ? [] : UNREQ), staff_pay_admin_create_v1: create.p,
    staff_pay_admin_step_v1: { data: { ok: true }, error: null }, staff_pay_payout_qr_v1: { data: { ok: true, id: 'new1', ref: 'NEWW0001', status: 'requested', payee_name: 'Marites', total: 1340, payout_qrph: null }, error: null } }[n]) });
  await openUn(b); await click(b, { 'data-act': 'u-pay' });
  await fire(b.root, 'click', { target: backTarget(), preventDefault() {} });
  assert.match(b.root.innerHTML, /Making the request/, 'still on the pay-ahead screen'); assert.equal(b.rpcs.filter((r) => r[0] === 'staff_pay_admin_list_v1').length, 1, 'no list reload from Back');
  made = true; create.ok({ data: { ok: true, id: 'new1', ref: 'NEWW0001' }, error: null });
  await until(() => b.rpcs.some((r) => r[0] === 'staff_pay_payout_qr_v1'), 'Pay flow');
  assert.deepEqual(plain(b.rpcs.filter((r) => /step|qr/.test(r[0])).map((r) => r[1].p_request_id)), ['new1', 'new1']);
});

test('P_ fix: overlapping openPay calls: the older call is dropped, so a late QR is never drawn under another request', async () => {
  const stepA = deferred(), qrA = deferred(); const B = { ...OPEN, id: 'reqB', ref: 'BBBB0002', payee_name: 'Marites', total: 700 };
  const b = bootAdmin({ rpc: (n, a) => ({ staff_pay_admin_list_v1: LIST([OPEN, B]),
    staff_pay_admin_step_v1: (a || {}).p_request_id === 'req1' ? stepA.p : { data: { ok: true }, error: null },
    staff_pay_payout_qr_v1: (a || {}).p_request_id === 'req1' ? qrA.p : { data: { ok: true, id: 'reqB', ref: 'BBBB0002', status: 'requested', payee_name: 'Marites', total: 700, payout_qrph: null }, error: null } }[n]) });
  await tick(); await click(b, { 'data-act': 'pay', 'data-id': 'req1' }); stepA.ok({ data: { ok: true }, error: null }); await until(() => b.rpcs.some((r) => r[0] === 'staff_pay_payout_qr_v1' && r[1].p_request_id === 'req1'), 'A asks for its QR');
  await click(b, { 'data-act': 'pay', 'data-id': 'reqB' }); await until(() => /Pay Marites/.test(b.root.innerHTML) && /₱700/.test(b.root.innerHTML) && b.rpcs.some((r) => r[0] === 'staff_pay_payout_qr_v1' && r[1].p_request_id === 'reqB'), 'B drawn'); await tick(10);
  qrA.ok({ data: { ok: true, id: 'req1', ref: 'ABCD1234', status: 'requested', payee_name: 'Honey', total: 500, payout_qrph: STATIC }, error: null }); await tick(10);
  assert.doesNotMatch(b.root.innerHTML, /<svg [^>]*role="img"/, 'the late QR for the other request is not drawn'); assert.match(b.root.innerHTML, /Pay Marites/); assert.doesNotMatch(b.root.innerHTML, /₱500/);
});

test('P_ fix: a step answer that arrives after another request took over does nothing (no QR read)', async () => {
  const stepA = deferred(); const B = { ...OPEN, id: 'reqB', ref: 'BBBB0002', payee_name: 'Marites', total: 700 };
  const b = bootAdmin({ rpc: (n, a) => ({ staff_pay_admin_list_v1: LIST([OPEN, B]), staff_pay_admin_step_v1: (a || {}).p_request_id === 'req1' ? stepA.p : { data: { ok: true }, error: null },
    staff_pay_payout_qr_v1: { data: { ok: true, id: (a || {}).p_request_id, ref: 'x', status: 'requested', payee_name: 'Marites', total: 700, payout_qrph: null }, error: null } }[n]) });
  await tick(); await click(b, { 'data-act': 'pay', 'data-id': 'req1' }); await click(b, { 'data-act': 'pay', 'data-id': 'reqB' });
  await until(() => b.rpcs.some((r) => r[0] === 'staff_pay_payout_qr_v1'), 'B QR'); stepA.ok({ data: { ok: true }, error: null }); await tick(10);
  assert.deepEqual(plain(b.rpcs.filter((r) => r[0] === 'staff_pay_payout_qr_v1').map((r) => r[1].p_request_id)), ['reqB']);
});

test('P_ fix: a 403 / 42501 on create reads as not authorised, not as no connection, and offers no retry words', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], UNREQ), staff_pay_admin_create_v1: { data: null, error: { code: '42501', message: 'permission denied' } } }[n]) }); await openUn(b);
  await click(b, { 'data-act': 'u-pay' }); await until(() => /for the owner, admin and finance/.test(b.root.innerHTML), 'not authorised');
  assert.doesNotMatch(b.root.innerHTML, /No connection|Try again/);
});

test('P_ fix: created but missing from the reloaded list: a status note with a tick, not an alert', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([OPEN], UNREQ), staff_pay_admin_create_v1: { data: { ok: true, id: 'ghost', ref: 'GHOST001' }, error: null } }[n]) }); await openUn(b);
  await click(b, { 'data-act': 'u-pay' }); await until(() => /GHOST001 was made\. Open it from To pay\./.test(b.root.innerHTML), 'note');
  assert.match(b.root.innerHTML, /<div class="okbox" role="status"><svg[^>]*>.*?<\/svg><span>Request GHOST001 was made/); assert.doesNotMatch(b.root.innerHTML, /errbox/);
  assert.equal(b.rpcs.filter((r) => /step|qr/.test(r[0])).length, 0, 'nothing is claimed for a request that is not on the list');
});

test('P_ fix: created, then the list reload fails: the connection screen shows and nothing is claimed', async () => {
  let lists = 0;
  const b = bootAdmin({ rpc: (n) => (n === 'staff_pay_admin_list_v1' ? (++lists === 1 ? LIST([OPEN], UNREQ) : { data: null, error: { code: '08006', message: 'network' } }) : n === 'staff_pay_admin_create_v1' ? { data: { ok: true, id: 'new1', ref: 'NEWW0001' }, error: null } : null) }); await openUn(b);
  await click(b, { 'data-act': 'u-pay' }); await until(() => /No connection/.test(b.root.innerHTML), 'connection screen');
  assert.match(b.root.innerHTML, /Try again/); assert.equal(b.rpcs.filter((r) => /step|qr/.test(r[0])).length, 0);
});

test('P_ fix guard: no P_ name is declared twice across the pay scripts, and the pay-lib exports are unique', () => {
  const seen = new Map();
  for (const f of fs.readdirSync(new URL('../pay/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    for (const m of read('pay/' + f).matchAll(/^\s*(?:function|var|let|const)\s+(P_\w+)/gm)) { assert.ok(!seen.has(m[1]), `${m[1]} declared in ${seen.get(m[1])} and ${f}`); seen.set(m[1], f); }
  }
  assert.ok(seen.size >= 8, 'the P_ helpers are found'); assert.equal(new Set(Object.keys(P)).size, Object.keys(P).length);
});

test('P_ fix 2: Back while the step is in flight never repaints the pay view or reads the QR, and the claimed request is handed back with not_sent', async () => {
  const step = deferred();
  const b = bootAdmin({ rpc: (n, a) => (n === 'staff_pay_admin_list_v1' ? LIST([OPEN]) : n === 'staff_pay_admin_step_v1' ? ((a || {}).p_step === 'pay' ? step.p : { data: { ok: true, status: 'requested' }, error: null }) : { data: { ok: true, id: 'req1', ref: 'ABCD1234', status: 'requested', payee_name: 'Honey', total: 500, payout_qrph: STATIC }, error: null }) });
  await tick(); await click(b, { 'data-act': 'pay', 'data-id': 'req1' });
  await fire(b.root, 'click', { target: backTarget(), preventDefault() {} }); await tick(10);
  step.ok({ data: { ok: true, status: 'paying' }, error: null }); await tick(15);
  assert.equal(b.rpcs.filter((r) => r[0] === 'staff_pay_payout_qr_v1').length, 0, 'no QR fetched');
  assert.doesNotMatch(b.root.innerHTML, /Mark as paid|<svg [^>]*role="img"/); assert.match(b.root.innerHTML, /Pay staff/);
  assert.deepEqual(plain(b.rpcs.filter((r) => r[0] === 'staff_pay_admin_step_v1').map((r) => r[1].p_step)), ['pay', 'not_sent'], 'claimed, then handed back');
});

test('P_ self: an entry marked self shows the card with no Pay now and no create call; the two new refusals read calmly', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], [{ ...UNREQ[0], self: true }]), staff_pay_admin_create_v1: { data: { ok: true, id: 'x', ref: 'X' }, error: null } }[n]) }); await openUn(b);
  assert.match(b.root.innerHTML, /This is your own work\. Another admin pays it\./); assert.doesNotMatch(b.root.innerHTML, /data-act="u-pay"/);
  await click(b, { 'data-act': 'u-pay' }); await tick(); assert.equal(b.rpcs.filter((r) => r[0] === 'staff_pay_admin_create_v1').length, 0);
  for (const [reason, text] of [['self', /You cannot pay your own request\. Ask another admin\./], ['payee_not_allowed', /not set up to be paid for cleans/]]) {
    const c = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([], UNREQ), staff_pay_admin_create_v1: { data: { ok: false, reason }, error: null } }[n]) }); await openUn(c);
    await click(c, { 'data-act': 'u-pay' }); await until(() => text.test(c.root.innerHTML), reason);
  }
});

test('B3: Pay is one filled 44 px button, Review is ghost, the amount sits over the name, dates read 15 Oct, no tab is marked', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([OPEN, { ...OPEN, id: 'req2', ref: 'EFGH5678' }], UNREQ) }[n]) }); await tick();
  const h = b.root.innerHTML;
  assert.equal((h.match(/class="P_go btn btn-primary"/g) || []).length, 1, 'one filled button per screen');
  assert.equal((h.match(/class="P_go btn btn-ghost">Pay</g) || []).length, 1, 'the second Pay is quiet');
  assert.match(h, /class="P_go btn btn-ghost">Review<\/span>/);
  assert.match(h, /<span class="P_amt num">₱500<\/span><span class="t">Honey<\/span>/);
  assert.match(h, /sent 13 Oct/); assert.doesNotMatch(h, /Oct 13/);
  assert.doesNotMatch(h, /aria-current="page"/);
  const css = (await import('node:fs')).readFileSync(new URL('../pay/C_pay.css', import.meta.url), 'utf8');
  assert.match(css, /\.P_amt \{[^}]*font: 650 1\.25rem[^}]*tabular-nums/); assert.match(css, /\.P_go \{[^}]*min-height: var\(--v5-touch\)/);
});

test('B3 r2: the filled Pay goes to the first row that has a Pay button; admin-lib dates read 15 Oct', async () => {
  const other = { ...OPEN, id: 'req0', ref: 'OTHR0000', status: 'paying', paying_by_user_id: 'someone-else', paying_by_name: 'Marifel' };
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LIST([other, OPEN], []) }[n]) }); await tick();
  const h = b.root.innerHTML;
  assert.equal((h.match(/P_go btn btn-primary/g) || []).length, 1, 'a filled Pay is on screen');
  assert.match(h, /data-id="req1"><span class="lead">[\s\S]*?P_go btn btn-primary">Pay/);
  assert.equal((await import('../pay/C_admin-lib.js')).default.status({ status: 'paid', paid_at: '2026-10-09T04:00:00Z' }).label, 'Paid 9 Oct');
  assert.equal((await import('../pay/C_admin-lib.js')).default.lineText({ kind: 'clean', date: '2026-10-02', type: 'turnover', amount: 500 }).slice(0, 9), 'Fri 2 Oct');
});

// ---------------------------------------------------------------- s99d: cleaner pays ahead (D-348)
const ADV = [{ checkout_date: '2026-10-19', base: 500, transport: 150 }, { checkout_date: '2026-10-22', base: 500, transport: null }];
function bootAdv(cands, sent, pushState = 'hidden') {
  const els = { pay: new FakeEl('pay'), 'C_push-slot': new FakeEl('C_push-slot') };
  const ctx = {
    console, setTimeout, setImmediate, Promise, JSON, Math, Object, Array, String, Number, Error, isNaN, parseInt, encodeURIComponent, crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Image: class {}, File: class {}, navigator: { userAgent: 'test' }, sessionStorage: null, location: { search: '', hash: '' },
    document: { getElementById: (id) => els[id] || null, querySelector: () => null, createElement: () => ({}) }, scrollY: 0, scrollTo() {},
    fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return { json: async () => (sent.reply || { ok: true, total: 500, ref: 'CASCADE-AAAA0001' }) }; },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) }, rpc: async (n) => (n === 'staff_pay_candidates_v1' ? { data: cands, error: null } : { data: null, error: { code: 'PGRST202' } }) }) },
  };
  ctx.self = ctx; ctx.window = ctx; ctx.addEventListener = () => {};
  load(['icons.js', 'lib.js', 'pay/pay-lib.js', 'pay/C_paid-text.js'], ctx);
  ctx.C_Push = { status: async () => ({ state: pushState }), words: (x) => x };
  els.pay.querySelector = () => ({ addEventListener() {}, insertAdjacentHTML: (pos, h) => { els.pay._html = h + els.pay._html; } }); // the review page wires its back arrow
  load(['pay/pay.js'], ctx);
  return { root: els.pay };
}
const btn = (a) => { const t = target(a), c = t.closest; t.closest = (sel) => c(sel) || (sel.includes('button') ? t : null); return t; }; // the harness knows [attr] selectors only; pay.js also matches plain buttons
const NOADV = { ...CANDS, sessions: [], claims: [] };

test('s99d: cands.advance draws a "No report yet" group with date, base, transport switch only when the rate has one, and the help line', async () => {
  const b = bootAdv({ ...CANDS, missing_reports: ['2026-10-19', '2026-10-22'], advance: ADV }, []); await until(() => /No report yet/.test(b.root.innerHTML), 'group');
  const h = b.root.innerHTML;
  assert.match(h, /aria-label="Mon 19 Oct turnover, no report yet" data-adv="2026-10-19"/); assert.match(h, /aria-label="Thu 22 Oct turnover, no report yet" data-adv="2026-10-22"/);
  assert.match(h, /data-advsw="2026-10-19"/); assert.doesNotMatch(h, /data-advsw="2026-10-22"/, 'no transport rate, no switch');
  assert.match(h, /You can include these now\. Please still send each report - the app will remind you\./);
  assert.doesNotMatch(h, /Submit the cleaning checklist first/, 'the old note is replaced');
  assert.doesNotMatch(h, /aria-checked="true" aria-label="Mon 19 Oct turnover/, 'not ticked by default');
});

test('s99d: an older server (no cands.advance) keeps the old note and no group', async () => {
  const b = bootAdv({ ...CANDS, missing_reports: ['2026-10-19'] }, []); await until(() => /Not yet paid/.test(b.root.innerHTML), 'list');
  assert.match(b.root.innerHTML, /Submit the cleaning checklist first/); assert.doesNotMatch(b.root.innerHTML, /data-adv=/);
});

test('s99d: ticking rows adds them to the total (500 + 500 + 150 transport = 1150 on top of 1 clean) and the payload carries advance', async () => {
  const sent = []; sent.reply = { ok: true, total: 1150, ref: 'CASCADE-AAAA0001' }; const b = bootAdv({ ...NOADV, advance: ADV }, sent); await until(() => /No report yet/.test(b.root.innerHTML), 'group');
  assert.match(b.root.innerHTML, /<button class="btn btn-primary btn-block" type="button" data-act="review" disabled>/);
  await fire(b.root, 'click', { target: target({ 'data-adv': '2026-10-19' }) }); await fire(b.root, 'click', { target: target({ 'data-adv': '2026-10-22' }) }); await fire(b.root, 'click', { target: target({ 'data-advsw': '2026-10-19' }) });
  assert.match(b.root.innerHTML, /Total to request<\/span><span class="amt num">₱1,150</);
  await fire(b.root, 'click', { target: btn({ 'data-act': 'review' }) });
  assert.match(plain(b.root.innerHTML), /no report yet/); assert.match(b.root.innerHTML, /Total: ₱1,150/);
  await fire(b.root, 'click', { target: btn({ 'data-act': 'send' }) }); await until(() => sent.length === 1, 'sent');
  assert.deepEqual(plain(sent[0].advance), [{ checkout_date: '2026-10-19', transport: true }, { checkout_date: '2026-10-22', transport: false }]);
  await until(() => /Send the cleaning report for 19 Oct, 22 Oct when you can\./.test(b.root.innerHTML), 'success text');
});

test('s99d: a request with no advance rows carries no advance key', () => {
  assert.equal('advance' in P.buildPayload({ sessions: [], claims: [], advance: ADV }, { advance: {} }, 'k'), false);
});

test('s99d: refusal reasons read as plain sentences; taken and not-owed refresh the list', () => {
  for (const r of ['advance_taken', 'advance_not_owed']) { const m = P.resultMessage({ ok: false, reason: r }); assert.equal(m.refresh, true); assert.doesNotMatch(m.text, new RegExp(r)); assert.doesNotMatch(m.text, /!/); }
  assert.match(P.resultMessage({ ok: false, reason: 'no_rate' }).text, /no pay rate set yet/); assert.match(P.resultMessage({ ok: false, reason: 'transport_not_allowed' }).text, /Transport cannot be added/);
});

const tickAdv = async (b, sent) => { await until(() => /No report yet/.test(b.root.innerHTML), 'group'); await fire(b.root, 'click', { target: target({ 'data-adv': '2026-10-19' }) }); await fire(b.root, 'click', { target: btn({ 'data-act': 'review' }) }); await fire(b.root, 'click', { target: btn({ 'data-act': 'send' }) }); await until(() => sent.length >= 1, 'sent'); };

test('s99d: an old server that drops advance (total 0 back for 500 asked) gets a calm partial notice and no report reminder', async () => {
  const sent = []; sent.reply = { ok: true, total: 0, ref: 'CASCADE-AAAA0002' };
  const b = bootAdv({ ...NOADV, advance: ADV }, sent); await tickAdv(b, sent);
  await until(() => /Finance received only part of this request\. Please tell Lloyd\./.test(b.root.innerHTML), 'notice');
  assert.doesNotMatch(b.root.innerHTML, /Send the cleaning report for/); assert.doesNotMatch(plain(b.root.innerHTML), /!/);
});

test('s99d: a matching total keeps the reminder and no partial notice', async () => {
  const sent = []; sent.reply = { ok: true, total: 500, ref: 'CASCADE-AAAA0003' };
  const b = bootAdv({ ...NOADV, advance: ADV }, sent); await tickAdv(b, sent);
  await until(() => /Send the cleaning report for 19 Oct when you can\./.test(b.root.innerHTML), 'reminder'); assert.doesNotMatch(b.root.innerHTML, /only part/);
});

test('s99d: advance_taken shows the notice, brings the rows back unticked, and the next payload has no advance key', async () => {
  const sent = []; sent.reply = { ok: false, reason: 'advance_taken' };
  const b = bootAdv({ ...CANDS, advance: ADV }, sent); await tickAdv(b, sent);
  await until(() => /already in another request/.test(b.root.innerHTML), 'notice');
  assert.match(b.root.innerHTML, /data-adv="2026-10-19"/); assert.doesNotMatch(b.root.innerHTML, /aria-checked="true" aria-label="[^"]*no report yet/, 'rows unticked');
  sent.reply = { ok: true, total: 1340, ref: 'CASCADE-AAAA0004' };
  await fire(b.root, 'click', { target: btn({ 'data-act': 'review' }) }); await fire(b.root, 'click', { target: btn({ 'data-act': 'send' }) }); await until(() => sent.length === 2, 'second send');
  assert.equal('advance' in sent[1], false);
});

test('s99d: toggling an advance row transport gives a new idempotency key', () => {
  const K = P.keyKeeper(globalThis.crypto, null), sel = { sessions: {}, claims: {}, extras: [], advance: { '2026-10-19': { on: true, transport: false } } };
  const k1 = K.forSelection({ sessions: [], claims: [], advance: ADV }, sel); sel.advance['2026-10-19'].transport = true;
  const k2 = K.forSelection({ sessions: [], claims: [], advance: ADV }, sel); assert.notEqual(k1, k2);
  assert.equal(K.forSelection({ sessions: [], claims: [], advance: ADV }, sel), k2, 'same selection keeps its key');
});

test('s99d: the help line asks her to turn on notifications only when they are not on', async () => {
  const off = bootAdv({ ...NOADV, advance: ADV }, [], 'off'); await until(() => /Turn on notifications to get a reminder\./.test(off.root.innerHTML), 'off');
  const on = bootAdv({ ...NOADV, advance: ADV }, [], 'on'); await until(() => /No report yet/.test(on.root.innerHTML), 'group'); await tick();
  assert.doesNotMatch(on.root.innerHTML, /Turn on notifications/); assert.match(on.root.innerHTML, /the app will remind you\./);
});
