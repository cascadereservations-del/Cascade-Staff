// Lane C: pay.js "Your requests" shows Requested -> Paying -> Paid with the reference, reads only HER rows through staff_pay_my_requests_v1,
// falls back to the older list when that RPC is absent, and hosts the push toggle slot at the bottom. Fake browser; no clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeEl, fire, load, plain, target, until } from './C_dom-harness.mjs';

const CANDS = { ok: true, payee_name: 'Honey', sessions: [{ id: 's1', date: '2026-10-02', type: 'turnover', base: 500, transport: 150 }], claims: [], missing_reports: [],
  requests: [{ ref: 'CASCADE-OLD00001', status: 'requested', total: 500, created_at: '2026-10-01T02:00:00Z', paid_at: null }] };
const MINE = [
  { ref: 'AAAA0001', status: 'paid', total: 1235, created_at: '2026-10-10T02:00:00Z', paid_at: '2026-10-15T07:12:00Z', bank_reference: '12345678', first_name: 'Honey' },
  { ref: 'BBBB0002', status: 'paying', total: 500, created_at: '2026-10-12T02:00:00Z', paid_at: null, bank_reference: null, first_name: 'Honey' },
  { ref: 'CCCC0003', status: 'requested', total: 40, created_at: '2026-10-13T02:00:00Z', paid_at: null, bank_reference: null, first_name: 'Honey' },
  { ref: 'DDDD0004', status: 'cancelled', total: 90, created_at: '2026-10-01T02:00:00Z', paid_at: null, bank_reference: null, first_name: 'Honey' },
];

function boot({ mine, pushState = 'off', cands = CANDS } = {}) {
  const els = { pay: new FakeEl('pay'), 'C_push-slot': new FakeEl('C_push-slot') }; const rpcs = [];
  const ctx = {
    console, setTimeout, setImmediate, Promise, JSON, Math, Object, Array, String, Number, Error, isNaN, parseInt, encodeURIComponent, crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Image: class {}, File: class {}, navigator: { userAgent: 'test' }, sessionStorage: null,
    document: { getElementById: (id) => els[id] || null, querySelector: () => null, createElement: () => ({}) }, scrollY: 0, scrollTo() {},
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) }, rpc: async (n, a) => { rpcs.push([n, a]); return n === 'staff_pay_candidates_v1' ? { data: cands, error: null } : mine === undefined ? { data: null, error: { code: 'PGRST202' } } : { data: { ok: true, requests: mine }, error: null }; } }) },
  };
  ctx.self = ctx; ctx.window = ctx; ctx.addEventListener = () => {};
  load(['icons.js', 'lib.js', 'pay/pay-lib.js', 'pay/C_paid-text.js'], ctx);
  ctx.C_Push = { status: async () => ({ state: pushState }), enable: async () => ({ ok: true }), disable: async () => ({ ok: true }), words: (s) => ({ off: 'Tell me on this phone when I am paid', on: 'You will be told on this phone when you are paid', needs_install: 'add to Home Screen', blocked: 'blocked', failed: 'failed', not_configured: 'not configured' }[s]) };
  load(['pay/pay.js'], ctx);
  return { ctx, root: els.pay, slot: els['C_push-slot'], rpcs };
}

test('Your requests: her own rows from staff_pay_my_requests_v1, each with the three steps as glyph + word, the ref, and the bank reference once paid', async () => {
  const b = boot({ mine: MINE });
  await until(() => /Your requests/.test(b.root.innerHTML), 'history');
  assert.deepEqual(plain(b.rpcs.map((r) => r[0])), ['staff_pay_candidates_v1', 'staff_pay_my_requests_v1']);
  const h = b.root.innerHTML;
  assert.equal((h.match(/class="C_step"/g) || []).length, 9, 'three steps for each of the three open or paid requests');
  assert.match(h, /data-state="done"[^>]*>[^<]*<svg[^]*?Requested/); assert.match(h, /Requested/); assert.match(h, /Paying/); assert.match(h, /Paid/);
  assert.match(h, /Ref AAAA0001 · sent 10 Oct · paid 15 Oct · Bank ref 1234 5678/); assert.match(h, /Ref BBBB0002/);
  assert.match(h, /pill p-neutral[^>]*>[^]*?Cancelled/);
  assert.doesNotMatch(h, /OLD00001/, 'the older list is not used when her own list answered');
  const paid = h.split('Ref AAAA0001')[1].split('Ref BBBB0002')[0]; assert.match(paid, /data-state="now"[^>]*>[^<]*<svg[^]*?Paid/);
});

test('Your requests: a missing RPC falls back to the candidates\' list without an error', async () => {
  const b = boot({ mine: undefined });
  await until(() => /Your requests/.test(b.root.innerHTML), 'history');
  assert.match(b.root.innerHTML, /Ref OLD00001/); assert.match(b.root.innerHTML, /Requested/); assert.doesNotMatch(b.root.innerHTML, /errbox/);
});

test('push toggle: the slot sits last in the page, is empty at first paint, and is filled only when the phone can do it', async () => {
  const b = boot({ mine: MINE, pushState: 'off' });
  await until(() => /Your requests/.test(b.root.innerHTML), 'history');
  assert.match(b.root.innerHTML, /<div id="C_push-slot"><\/div>/, 'reserved and empty at first paint');
  assert.ok(b.root.innerHTML.indexOf('C_push-slot') > b.root.innerHTML.indexOf('Your requests'), 'below the requests, never above the controls');
  await until(() => /role="switch"/.test(b.slot.innerHTML), 'toggle');
  assert.match(b.slot.innerHTML, /aria-checked="false"[^>]*data-C-push="1"/); assert.match(b.slot.innerHTML, /Tell me on this phone when I am paid/);
  const hidden = boot({ mine: MINE, pushState: 'hidden' });
  await until(() => /Your requests/.test(hidden.root.innerHTML), 'history'); await new Promise((r) => setTimeout(r, 20));
  assert.equal(hidden.slot.innerHTML, '');
  const install = boot({ mine: MINE, pushState: 'needs_install' });
  await until(() => /add to Home Screen/.test(install.slot.innerHTML), 'install hint');
});

test('push toggle: tapping it turns it on through C_Push.enable and shows the on words', async () => {
  const b = boot({ mine: MINE, pushState: 'off' });
  await until(() => /role="switch"/.test(b.slot.innerHTML), 'toggle');
  let called = null; b.ctx.C_Push.enable = async (o) => { called = Object.keys(o).sort(); return { ok: true }; };
  await fire(b.root, 'click', { target: target({ 'data-C-push': '1' }) });
  await until(() => /aria-checked="true"/.test(b.slot.innerHTML), 'on');
  assert.deepEqual(called, ['call', 'client']); assert.match(b.slot.innerHTML, /You will be told on this phone when you are paid/);
  b.ctx.C_Push.disable = async () => ({ ok: false, reason: 'failed' });
  await fire(b.root, 'click', { target: target({ 'data-C-push': '1' }) });
  await until(() => /failed/.test(b.slot.innerHTML), 'failure words');
});
