// s131b: three low follow-ups from the D-395 review. Names are invented ("Zz").
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CS, read, D } from './_a_harness.mjs';

const flushP = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
async function sheet(editable) {
  const w = { CS, ICON: (n) => '<svg data-i="' + n + '"></svg>' }; w.window = w; vm.runInContext(read('bills/BL_bills.js'), vm.createContext(w));
  const open = { ok: true, bill: { id: 'b', label: 'Internet', kind: 'internet', period: '2026-11' }, pay: { amount_php: 1500, amount_editable: editable, payee_name: 'Zz Net', number: '123', note: 'Bill', number_label: 'Account number' }, can_edit: false };
  const h = {}, nodes = { '#BL_done': { disabled: false }, '#BL_amthelp': { textContent: '' }, '#BL_file': { click() {} } };
  const box = { innerHTML: '', addEventListener: (t, f) => { h[t] = f; }, removeEventListener() {}, querySelector: (s) => nodes[s] || null, querySelectorAll: () => [] };
  const o = { box, sub: 'pay/b', propertyId: 'p', client: { rpc: (n) => Promise.resolve({ error: null, data: n === 'bill_pay_open_v1' ? open : { ok: true } }) }, upload: async (f) => ({ path: 'x/' + f.name, sha256: 'a'.repeat(64) }), onChange() {}, navigate() {}, toast() {} };
  w.BL_Bills.mount(box, o); await flushP();
  h.change({ target: { id: 'BL_file', files: [{ name: 'a.jpg' }] } }); await flushP();
  return { box, nodes, type: async (id, value) => { h.input({ target: { id, value, getAttribute: () => null } }); await flushP(); } };
}

// 1: without the fix, payNow() read the amount text for any truthy amount_editable, so a stray amount event on a non-editable sheet ("yes") disabled the button that render had enabled.
test('s131b 1: amount_editable "yes" (truthy, not true) gives the same button state at render and after typing', async () => {
  const s = await sheet('yes');
  assert.doesNotMatch(s.box.innerHTML, /id="BL_amt"/, 'not editable: no amount field');
  assert.doesNotMatch(s.box.innerHTML, /id="BL_done"[^>]*disabled/, 'render: ready with a file');
  await s.type('BL_amt', 'abc'); assert.equal(s.nodes['#BL_done'].disabled, false, 'typing cannot change a fixed amount');
});
test('s131b 1: a truly editable bill still follows the typed amount', async () => {
  const s = await sheet(true);
  await s.type('BL_amt', 'abc'); assert.equal(s.nodes['#BL_done'].disabled, true);
  await s.type('BL_amt', '1500'); assert.equal(s.nodes['#BL_done'].disabled, false);
});

// 2: without the fix, the marker's edited note date (11-20) outranked the newer raw report (11-10), and the raw issue lost its row.
test('s131b 2: a re-dated older marker does not outrank a newer raw cleaning-report issue', () => {
  const notes = '2026-11-01: !! Request: a || 2026-11-02: !! Request: b || 2026-11-03: !! Request: c || 2026-11-20: ! Issue: [turnover 2026-11-05] Zz old drip || 2026-11-10: Turnover report: Faucet is leaking in the CR';
  const g = CS.goodToKnow({ notes }, false);
  assert.ok(g.notes.some((x) => /Faucet/.test(x.p)), 'the newer raw issue has its row');
  assert.ok(!g.notes.some((x) => /Zz old drip/.test(x.p)), 'the older marker does not take it');
});

// 3: without the fix the To pay meter rows said period 2026-10 while the card waited for September.
test('s131b 3: demo on 2026-10-15 gives a matching period and waiting month; 21st onwards unchanged', async () => {
  const get = async (day) => (await D.client('owner', new Date(day)).rpc('today_bills_v1', {})).data;
  const monthOf = (p) => new Date(p + '-01T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  for (const [day, per] of [['2026-10-15T04:30:00Z', '2026-09'], ['2026-10-25T04:30:00Z', '2026-10']]) {
    const d = await get(day);
    for (const b of d.due.filter((x) => x.kind === 'electric' || x.kind === 'water')) { assert.equal(b.period, per, day + ' ' + b.kind); assert.equal(monthOf(b.period), d.waiting_for); }
    assert.ok(d.due.some((x) => x.kind === 'internet' && x.period === day.slice(0, 7)), 'other bills keep the current month');
  }
});
