// s117 lane A: the per-item low-stock rows fold into ONE row, "N items running low". Hand-computed counts, pure CS functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS } from './_a_harness.mjs';

const READY = { payload: true, tasks: true, bookings: true, notices: true };
const NAMES = ['towels', 'soap', 'tissue', 'sponge', 'bleach', 'bags', 'foil', 'salt', 'sugar', 'tea', 'coffee', 'rice', 'oil', 'matches'];
const lows = (names) => names.map((n) => ({ kind: 'inventory', title: 'Low stock: ' + n, detail: { qty: 1, unit: 'pc', reorder_below: 4 } }));
const att = (role, warnings, o) => CS.E_attention(Object.assign({ role, today: '2026-11-11', ready: READY, tasks: [], clashDays: [], bookings: 0, inbox: null, warnings, notices: [] }, o || {}));

test('s117 14 low-stock warnings become one row, count 14, first three names then "and 11 more"', () => {
  for (const role of ['cleaner', 'admin', 'owner']) {
    const a = att(role, lows(NAMES));
    const rows = a.sections.find((s) => s.key === 'warn').rows;
    assert.equal(rows.length, 1, role);
    assert.equal(rows[0].title, '14 items running low');
    assert.equal(rows[0].sub, 'Towels, Soap, Tissue and 11 more');
    assert.deepEqual(rows[0].go, { kind: 'inventory' });
    assert.equal(a.n, 1, 'the pill counts it once'); assert.equal(a.pill.short, '1 to look at');
  }
});

test('s117 pill total counts the folded row once next to real warnings (shared source with the list)', () => {
  const sys = { kind: 'verifier', title: 'A check', severity: 'alert', detail: { check_id: 'V1m' } };
  const a = att('admin', lows(NAMES).concat([sys]));
  assert.equal(a.n, 2);
  const rows = a.sections.find((s) => s.key === 'warn').rows;
  assert.equal(rows.length, 2);
  assert.equal(CS.foldLowStock(lows(NAMES).concat([sys])).length, 2, 'the calendar list and its tab badge use the same fold');
});

test('s117 items already on the shopping list are not counted; a single item keeps its own row; zero gives no row', () => {
  const shop = NAMES.slice(0, 11).map((n) => n.toUpperCase());
  const a = att('admin', lows(NAMES), { shopNames: shop });
  const rows = a.sections.find((s) => s.key === 'warn').rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].title, '3 items running low'); assert.equal(rows[0].sub, 'Rice, Oil, Matches');
  const one = att('admin', lows(NAMES), { shopNames: NAMES.slice(1) }).sections.find((s) => s.key === 'warn').rows;
  assert.equal(one.length, 1); assert.equal(one[0].title, 'Low stock · towels, 1 pc (reorder below 4)', 'one item left keeps its own row');
});

test('s117 flag on_list excludes; everything excluded or none low -> no row, All clear', () => {
  const flagged = lows(NAMES).map((w) => Object.assign(w, { detail: Object.assign(w.detail, { on_list: true }) }));
  assert.equal(att('admin', flagged).phase, 'clear');
  assert.equal(att('admin', []).sections.length, 0);
  assert.equal(CS.foldLowStock(flagged).length, 0);
});

test('s117 admin house low_stock items fold too, unless the payload already carries them', () => {
  const house = NAMES.slice(0, 5).map((n, k) => ({ kind: 'low_stock', id: 's' + k, title: 'Low stock: ' + n, detail: '1 left' }));
  const a = att('admin', [], { house });
  assert.equal(a.sections.find((s) => s.key === 'stock').rows.length, 1);
  assert.equal(a.n, 1);
  assert.equal(att('admin', lows(NAMES), { house }).n, 1);
});

test('s117 the board shows one low-stock row (weight 1) and routes to Inventory', () => {
  const b = CS.A_board(att('admin', lows(NAMES)));
  assert.equal(b.n, 1); assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0].title, '14 items running low'); assert.deepEqual(b.rows[0].go, { kind: 'inventory' });
});

// ---- fix round 1 (Opus findings): role gate, sheet link, one-shot Low view
import { boot, baseHandlers, HOMEWITH, read } from './_a_harness.mjs';
import { setup, mockClient, item } from './I_harness.mjs';
const lowW = lows(NAMES.slice(0, 4));
const calHtml = async (role) => { const s = await boot({ role, hash: '#calendar/warnings', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([], { warnings: lowW }) }) }); return s.els['v-calendar'].innerHTML; };

test('s117 fix1 the folded Warnings row links to Inventory only for roles that have it; inspector and maintenance get a plain row', async () => {
  for (const role of ['admin', 'cleaner']) { const h = await calHtml(role); assert.match(h, /<a class="wbtn" href="#stock\?low">[^]*4 items running low/, role); }
  for (const role of ['inspector', 'maintenance']) { const h = await calHtml(role); assert.match(h, /4 items running low/, role); assert.doesNotMatch(h, /href="#stock/, role); }
});

test('s117 fix2 the To look at sheet row goes to #stock?low with Inventory, keeps the old fallback without it', () => {
  const src = read('app.js');
  assert.match(src, /go\.kind === 'inventory'\) \{ l = K_invMay\('stock'\) \? \{ href: '#stock\?low'/);
  assert.match(src, /: state\.layout === 'admin' \? A_hubLink\('inventory'\) : null; l = l \|\| \{ href: '#calendar\/warnings'/);
});

test('s117 fix3 #stock?low mounts once with low:true and the URL becomes #stock; a plain #stock does not; no Inventory role never sets it', async () => {
  const mounts = [], winInit = (win) => { win.H_loadAsset = (m) => { win[m.global] = { mount(el, o) { mounts.push(o); }, unmount() {} }; return Promise.resolve(); }; };
  const s = await boot({ role: 'admin', hash: '#stock?low', winInit, handlers: baseHandlers('admin') });
  assert.equal(mounts.length, 1); assert.equal(mounts[0].low, true); assert.equal(mounts[0].sub, ''); assert.equal(s.location.hash, '#stock');
  const p = await boot({ role: 'admin', hash: '#stock', winInit, handlers: baseHandlers('admin') }); assert.equal(mounts.at(-1).low, false); assert.equal(p.location.hash, '#stock');
  const m = await boot({ role: 'maintenance', hash: '#stock?low', winInit, handlers: baseHandlers('maintenance') }); assert.equal(mounts.length, 2, 'no module mounts for a role without Inventory'); assert.ok(m);
});

test('s117 fix3 I_stock low:true opens Items on Low over a saved All/shopping view, saves it; the next plain mount restores that saved Low', async () => {
  const ss = { cs_I_view: JSON.stringify({ role: 'owner', tab: 'shopping', chip: 'all' }) };
  const cat = { items: [item('a1', 'Toilet paper', 4, 12), item('a3', 'Bath towels', 14, 10, { consumable: false })] };
  const e = await setup({ role: 'owner', client: mockClient({ catalogue: cat }), ss, low: true }); await e.mount('');
  assert.equal(e.navs.length, 0, 'no jump to the shopping tab'); assert.match(e.html(), /data-k="low"[^>]*aria-pressed="true"/);
  assert.deepEqual(JSON.parse(ss.cs_I_view), { role: 'owner', tab: '', chip: 'low' });
});
