// s86 D-client-sup: price history sheet (R6), sparkline, stats line, "Cheaper last time", roles and probe-and-hide. Frozen clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, HISTORY, flush } from './I_sup-harness.mjs';

const ITEM = { id: 'i1', name: 'Toilet paper' };
const r6 = (d) => ({ inventory_price_history_v1: () => ({ data: d, error: null }) });
const open = async (e, item) => { const s = e.S.openPriceHistory(e.ctx, item || ITEM); await flush(); return s; };

test('R6 call: exact name and key, stats line wording, price-up mark with glyph and word', async () => {
  const e = await setup({ rpc: r6(HISTORY) });
  await open(e);
  const c = e.client.rpcCalls('inventory_price_history_v1');
  assert.equal(c.length, 1); assert.deepEqual(c[0][2], { p_item_id: 'i1' });
  const s = e.sheet();
  assert.match(s, /Last PHP 12\.50 · 6-month average PHP 11\.20 · lowest in a year PHP 10/);
  assert.match(s, /▲<\/span> Price up 25%/);
  assert.match(s, /Toilet paper/);
});

test('rows: date, supplier, quantity with unit, price per unit and per pack, source as a word', async () => {
  const e = await setup({ rpc: r6(HISTORY) });
  await open(e);
  const s = e.sheet();
  assert.match(s, /Oct 10/); assert.match(s, /SM Supermarket · 24 rolls/); assert.match(s, /PHP 12\.50 each<br>PHP 150 a pack of 12/);
  assert.match(s, /Added in the app/); assert.match(s, /From a Telegram receipt/); assert.match(s, /Earlier record/);
});

test('"Cheaper last time": another supplier with a lower last price is named; none when the newest supplier is the cheapest', async () => {
  const e = await setup({ rpc: r6(HISTORY) });
  await open(e);
  assert.match(e.sheet(), /Cheaper last time at Robinsons: PHP 11 each/);
  const lib = e.S.lib;
  assert.deepEqual(lib.cheaperLast(HISTORY), { name: 'Robinsons', price: 11 });
  // newest purchase was at the cheapest supplier
  const cheapest = { ...HISTORY, rows: [{ ...HISTORY.rows[1] }], stats: { ...HISTORY.stats, last: 11 } };
  assert.equal(lib.cheaperLast(cheapest), null);
  // equal price is not cheaper
  assert.equal(lib.cheaperLast({ ...HISTORY, stats: { ...HISTORY.stats, last: 11 }, rows: [{ ...HISTORY.rows[0], unit_price: 11 }] }), null);
  // picks the cheapest of several, ignores the supplier of the newest row
  const many = { rows: [{ supplier_id: 'a', unit_price: 20 }], stats: { last: 20 }, by_supplier: [{ supplier_id: 'a', name: 'A', last_unit_price: 5 }, { supplier_id: 'b', name: 'B', last_unit_price: 18 }, { supplier_id: 'c', name: 'C', last_unit_price: 15 }, { supplier_id: 'd', name: 'D', last_unit_price: 25 }] };
  assert.deepEqual(lib.cheaperLast(many), { name: 'C', price: 15 });
  assert.equal(lib.cheaperLast(null), null); assert.equal(lib.cheaperLast({ rows: [], by_supplier: [] }), null);
});

test('sparkline points for a fixed series: oldest left, 280 x 80, higher price higher up, time-proportional', async () => {
  const lib = (await setup()).S.lib;
  const rows = HISTORY.rows; // newest first, 2026-10-10 12.5, 2026-09-20 11, 2026-08-30 10
  const sp = lib.sparkPoints(rows, 280, 80);
  assert.equal(sp.points.length, 3);
  assert.deepEqual(sp.points.map((p) => p.v), [10, 11, 12.5]);
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  assert.equal(sp.points[0].x, 10); assert.equal(sp.points[2].x, 270);
  const mid = 10 + (days('2026-08-30T05:00:00Z', '2026-09-20T05:00:00Z') / days('2026-08-30T05:00:00Z', '2026-10-10T05:00:00Z')) * 260;
  assert.ok(Math.abs(sp.points[1].x - Math.round(mid * 10) / 10) < 0.11);
  assert.equal(sp.points[0].y, 68); assert.equal(sp.points[2].y, 12); // lowest at the bottom pad, highest at the top pad
  assert.ok(sp.points[1].y > 12 && sp.points[1].y < 68);
  assert.equal(sp.path, sp.points.map((p) => p.x + ',' + p.y).join(' '));
});

test('sparkline edge cases: one point sits in the middle, a flat series is a mid line, nothing is empty', async () => {
  const lib = (await setup()).S.lib;
  const one = lib.sparkPoints([HISTORY.rows[0]], 280, 80);
  assert.deepEqual([one.points[0].x, one.points[0].y], [140, 40]);
  const flat = lib.sparkPoints([{ at: '2026-10-02T00:00:00Z', unit_price: 5 }, { at: '2026-10-01T00:00:00Z', unit_price: 5 }], 280, 80);
  assert.deepEqual(flat.points.map((p) => p.y), [40, 40]);
  const same = lib.sparkPoints([{ at: '2026-10-01T00:00:00Z', unit_price: 5 }, { at: '2026-10-01T00:00:00Z', unit_price: 6 }], 280, 80);
  assert.deepEqual(same.points.map((p) => p.x), [10, 270]);
  assert.deepEqual(lib.sparkPoints([], 280, 80), { points: [], path: '' });
  assert.equal(lib.sparkPoints([{ at: 'x', unit_price: 1 }, { at: '2026-10-01T00:00:00Z', unit_price: null }]).points.length, 0);
});

test('sheet draws an inline SVG 280 x 80 polyline, no library, with focusable labelled dots', async () => {
  const e = await setup({ rpc: r6(HISTORY) });
  await open(e);
  const s = e.sheet();
  assert.match(s, /<svg viewBox="0 0 280 80" width="100%" role="img"/);
  assert.match(s, /<polyline class="S_line" fill="none" points="[\d.,\- ]+"/);
  assert.equal((s.match(/<circle /g) || []).length, 3);
  assert.match(s, /tabindex="0" role="button" data-s-act="pt" data-i="2" aria-label="Oct 10, PHP 12\.50 each at SM Supermarket"/);
  assert.match(s, /Tap a dot to see the price/);
  await e.click('pt', { 'data-i': '1' });
  assert.match(e.sheet(), /Sep 20: PHP 11 each at Robinsons/); assert.match(e.sheet(), /S_dot S_dot-on/);
});

test('empty history shows the exact empty text', async () => {
  const e = await setup({ rpc: r6({ ok: true, unit: 'rolls', units_per_purchase: 12, rows: [], stats: { last: null, n: 0 }, by_supplier: [], jump: null }) });
  await open(e);
  assert.match(e.sheet(), /No prices recorded yet\. They appear when you mark items Bought or apply a receipt in Telegram\./);
  assert.doesNotMatch(e.sheet(), /<svg viewBox="0 0 280/);
});

test('no jump mark and no stats gaps: missing stats are left out of the line, not shown as zero', async () => {
  const lib = (await setup()).S.lib;
  assert.equal(lib.statsLine({ last: 12.5, avg_180d: null, min_365d: 10 }), 'Last PHP 12.50 · lowest in a year PHP 10');
  assert.equal(lib.statsLine(null), '');
  const e = await setup({ rpc: r6({ ...HISTORY, jump: null }) });
  await open(e);
  assert.doesNotMatch(e.sheet(), /Price up/);
});

test('money format: whole pesos without decimals, otherwise two, thousands separated', async () => {
  const lib = (await setup()).S.lib;
  assert.equal(lib.money(150), 'PHP 150'); assert.equal(lib.money(12.5), 'PHP 12.50'); assert.equal(lib.money('1234.5'), 'PHP 1,234.50'); assert.equal(lib.money(null), ''); assert.equal(lib.money(7391.5472), 'PHP 7,391.55');
});

test('roles: owner, admin and finance see price history; a cleaner gets nothing and no call', async () => {
  for (const role of ['owner', 'admin', 'finance']) {
    const e = await setup({ role, rpc: r6(HISTORY) });
    await open(e);
    assert.equal(e.sheets(), 1, role); assert.equal(e.client.rpcCalls('inventory_price_history_v1').length, 1, role);
  }
  for (const role of ['cleaner', 'staff']) {
    const e = await setup({ role, rpc: r6(HISTORY) });
    assert.equal(e.S.openPriceHistory(e.ctx, ITEM), null, role);
    await flush();
    assert.equal(e.sheets(), 0, role); assert.equal(e.client.calls.length, 0, role);
  }
});

test('probe-and-hide: PGRST202 on R6 closes the sheet with a calm toast, no error box', async () => {
  const e = await setup({ rpc: { inventory_price_history_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await open(e);
  assert.equal(e.sheets(), 0); assert.deepEqual(e.toasts, ['Price history is not available yet.']);
});

test('refused (42501) and offline show a plain line with Try again, and a retry calls R6 again', async () => {
  let n = 0;
  const e = await setup({ rpc: { inventory_price_history_v1: () => (++n === 1 ? { data: null, error: { name: 'TypeError', message: 'Failed to fetch' } } : { data: HISTORY, error: null }) } });
  await open(e);
  assert.match(e.sheet(), /No connection|did not go through/); assert.match(e.sheet(), /Try again/);
  await e.click('retry');
  assert.equal(e.client.rpcCalls('inventory_price_history_v1').length, 2); assert.match(e.sheet(), /Last PHP 12\.50/);
  const e2 = await setup({ rpc: { inventory_price_history_v1: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) } });
  await open(e2);
  assert.match(e2.sheet(), /not allowed/);
});

test('markup is escaped: a supplier or item name cannot inject HTML', async () => {
  const evil = { ...HISTORY, rows: [{ ...HISTORY.rows[0], supplier: '<img src=x onerror=1>' }], by_supplier: [] };
  const e = await setup({ rpc: r6(evil) });
  await open(e, { id: 'i1', name: '<b>Paper</b>' });
  assert.doesNotMatch(e.sheet(), /<img src=x|<b>Paper/); assert.match(e.sheet(), /&lt;img/);
});
