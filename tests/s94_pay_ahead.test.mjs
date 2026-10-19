// s94: pay ahead (no report yet) in the admin pay maker, advance lines in text, reports owed card.
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
const click = (b, attrs) => fire(b.root, 'click', { target: target(attrs) });
const ADV = [{ checkout_date: '2026-10-14', guest: 'Shasha', base: 500, transport: 150 }, { checkout_date: '2026-10-17', guest: 'Abe', base: 500, transport: 150 }];
const UN = [{ payee_user_id: 'u-1', payee_name: 'Honey', has_qr: true, total: 0, sessions: [], claims: [] }];
const LISTA = (adv, un = UN) => ({ data: { ok: true, requests: [], unrequested: un, advance_candidates: adv }, error: null });

test('s94: the Pay ahead group lists missing-report checkouts; ticking two with transport totals 1,300 and calls create_v2', async () => {
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LISTA(ADV), staff_pay_admin_create_v2: { data: { ok: true, id: 'n1', ref: 'NEWW' }, error: null } }[n]) }); await tick();
  assert.match(b.root.innerHTML, /Pay ahead \(no report yet\)/);
  await click(b, { 'data-act': 'ahead' });
  await click(b, { 'data-act': 'u-ases', 'data-id': '2026-10-14' }); await click(b, { 'data-act': 'u-ases', 'data-id': '2026-10-17' });
  await click(b, { 'data-act': 'u-asw', 'data-id': '2026-10-14' }); await click(b, { 'data-act': 'u-asw', 'data-id': '2026-10-17' });
  assert.match(b.root.innerHTML, /₱1,300/);
  await click(b, { 'data-act': 'u-pay' });
  const c = b.rpcs.find((r) => r[0] === 'staff_pay_admin_create_v2');
  assert.deepEqual(plain(c[1].p_advance), [{ checkout_date: '2026-10-14', transport: true }, { checkout_date: '2026-10-17', transport: true }]);
  assert.equal(c[1].p_payee_user_id, 'u-1');
});

test('s94: with nothing ahead and no v2 on the server, create falls back to v1; with an advance it does not', async () => {
  const un = [{ payee_user_id: 'u-1', payee_name: 'Honey', has_qr: true, total: 500, sessions: [{ id: 's-1', date: '2026-10-11', type: 'turnover', base: 500, transport: null }], claims: [] }];
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LISTA([], un), staff_pay_admin_create_v1: { data: { ok: true, id: 'n1', ref: 'NEWW' }, error: null } }[n]) }); await tick();
  assert.doesNotMatch(b.root.innerHTML, /Pay ahead/);
  await click(b, { 'data-act': 'unreq', 'data-id': 'u-1' }); await click(b, { 'data-act': 'u-pay' });
  assert.ok(b.rpcs.some((r) => r[0] === 'staff_pay_admin_create_v1'));
});

test('s94: advance_taken and advance_not_owed read as plain sentences; advance lines read as the contract says', async () => {
  const A = req('../pay/C_admin-lib.js'), T = req('../pay/C_paid-text.js');
  assert.match(A.refusal({ reason: 'advance_taken', date: '2026-10-14', ref: 'ABCD1234' }), /14 Oct turnover was already paid ahead \(request ABCD1234\)/);
  assert.match(A.refusal({ reason: 'advance_not_owed', date: '2026-10-14' }), /14 Oct turnover already has a report/);
  const l = { kind: 'advance', date: '2026-10-14', guest: 'Shasha' };
  assert.equal(A.lineText(l), '14 Oct turnover - Shasha (paid ahead, report owed)');
  assert.equal(T.advanceLine(l), '14 Oct turnover - Shasha (paid ahead, report owed)');
  assert.equal(T.owedText(['2026-10-14', '2026-10-17', '2026-10-19']), 'You were paid ahead for 14 Oct, 17 Oct and 19 Oct. Please still send the cleaning report for each.');
  assert.match(T.noticeText({ first_name: 'Honey', total: 3250, ref: 'X', reports_owed: ['2026-10-14'] }), /Paid ahead - please still send the report for 14 Oct\./);
});

test('s94: the owed card is hidden for an empty or absent list and shows a button otherwise', () => {
  const N = req('../pay/C_paid-notice.js');
  assert.equal(N.owedHtml([], '#x'), '');
  assert.match(N.owedHtml([{ date: '2026-10-14' }], '#door/checklist'), /Reports still owed[\s\S]*href="#door\/checklist"/);
});

test('s94 fix: with two staff nobody is preselected and Pay now stays inert until one is chosen', async () => {
  const two = [...UN, { payee_user_id: 'u-9', payee_name: 'Marites', has_qr: true, total: 0, sessions: [], claims: [] }];
  const b = bootAdmin({ rpc: (n) => ({ staff_pay_admin_list_v1: LISTA(ADV, two), staff_pay_admin_create_v2: { data: { ok: true, id: 'n1', ref: 'N' }, error: null } }[n]) }); await tick();
  await click(b, { 'data-act': 'ahead' });
  assert.match(b.root.innerHTML, /Choose who cleaned, then tick what to pay ahead\./);
  assert.match(b.root.innerHTML, /<option value="" selected>Choose who cleaned<\/option>/);
  await click(b, { 'data-act': 'u-ases', 'data-id': '2026-10-14' });
  assert.match(b.root.innerHTML, /data-act="u-pay" disabled/);
  await click(b, { 'data-act': 'u-pay' });
  assert.ok(!b.rpcs.some((r) => r[0] === 'staff_pay_admin_create_v2'));
});

test('s94 fix: the owed sentence says "paid ahead" only for paid rows', () => {
  const T = req('../pay/C_paid-text.js');
  assert.equal(T.owedText([{ date: '2026-10-14', status: 'requested' }]), 'Please send the cleaning report for 14 Oct. Its pay was set up before the report.');
  assert.match(T.owedText([{ date: '2026-10-14', status: 'paid' }, { date: '2026-10-17', status: 'paying' }]), /^You were paid ahead for 14 Oct\. Please still send the cleaning report for it\. Please send the cleaning report for 17 Oct\./);
});
