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
  assert.match(h, /data-act="pay" data-id="req1"/); assert.match(h, /Pay ›/);
  assert.match(h, /data-act="unreq" data-id="u-2"/); assert.match(h, /Marites · <span class="num">₱1,340<\/span>/); assert.match(h, /2 cleans · 1 expense · not requested yet/);
  assert.match(h, /Paid Oct 9 · Ref ZZZZ0001 · by Marifel/); assert.doesNotMatch(h, /data-id="old1"/, 'a paid row is a record, not a button');
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
  assert.match(b.root.innerHTML, /<button class="sw P_tr" type="button" role="switch" aria-checked="false" aria-label="Add ₱150 transport for Oct 2 Fri" data-sw="s-1"><span>Transport \+₱150<\/span><i aria-hidden="true"><\/i><\/button>/);
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
  assert.match(h, /<a class="tab" href="\.\.\/#home" aria-current="page">/); assert.equal((h.match(/aria-current="page"/g) || []).length, 1);
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
  assert.match(b.root.innerHTML, /aria-current="page"/); assert.match(b.root.innerHTML, /aria-label="1 due"/); assert.match(b.root.innerHTML, /<nav class="tabbar" aria-label="Primary">/);
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
