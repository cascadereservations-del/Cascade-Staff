// s133 L2 Staff: products with their own stock, Update this group, the photo viewer and the inventory history.
// Pure helpers and call builders, with the exact function names and argument names of docs/s133/CONTRACT.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const lib = async (role = 'owner') => (await setup({ role })).lib;
const keys = (o) => Object.keys(o);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m); // the lib lives in another realm: compare by value

test('s133 count call: inventory_option_count_v1 with the contract argument names', async () => {
  const L = await lib();
  const c = L.optionCountCall('i1', [{ option_id: 'o1', qty: 2 }], 1, 'Recount', 'key-aaaaaaaaaaaaaaaa');
  assert.equal(c.fn, 'inventory_option_count_v1');
  same(keys(c.args), ['p_item_id', 'p_counts', 'p_unsorted', 'p_note', 'p_idempotency_key']);
  same(c.args.p_counts, [{ option_id: 'o1', qty: 2 }]);
});

test('s133 receipt call: inventory_receipt_lines_v1 with lines, total, date and supplier', async () => {
  const L = await lib();
  const c = L.receiptLinesCall('i1', [{ option_id: 'o1', packs: 2, unit_cost: 50 }, { option_id: null, packs: 1, unit_cost: null }], 150, '2026-11-23', 's1', 'key-aaaaaaaaaaaaaaaa');
  assert.equal(c.fn, 'inventory_receipt_lines_v1');
  same(keys(c.args), ['p_item_id', 'p_lines', 'p_total_paid', 'p_purchased_at', 'p_supplier_id', 'p_idempotency_key']);
  assert.equal(c.args.p_lines.length, 2); assert.equal(c.args.p_lines[1].option_id, null);
  assert.equal(L.receiptLinesCall('i1', [], null, '2026-11-23', '', 'k').args.p_supplier_id, null);
});

test('s133 use call: inventory_option_use_v1; no product sends null', async () => {
  const L = await lib();
  const c = L.optionUseCall('p1', 'i1', 'o2', 1.5, 'Used', '2026-11-23', 'key-aaaaaaaaaaaaaaaa');
  assert.equal(c.fn, 'inventory_option_use_v1');
  same(keys(c.args), ['p_property_id', 'p_item_id', 'p_option_id', 'p_qty', 'p_note', 'p_session_date', 'p_idempotency_key']);
  assert.equal(L.optionUseCall('p1', 'i1', '', 1, 'x', '2026-11-23', 'k').args.p_option_id, null);
});

test('s133 group call: inventory_group_update_v1 and the log call clamp', async () => {
  const L = await lib();
  const g = L.groupCall('p1', 'count', [{ item_id: 'i1', qty: 3 }], 'key-aaaaaaaaaaaaaaaa');
  assert.equal(g.fn, 'inventory_group_update_v1'); same(keys(g.args), ['p_property_id', 'p_mode', 'p_rows', 'p_idempotency_key']);
  const l = L.logCall('p1', { limit: 500, kind: 'used', itemId: 'i1', oldest: true, before: '2026-11-20T00:00:00Z' });
  assert.equal(l.fn, 'inventory_log_v1');
  same(keys(l.args), ['p_property_id', 'p_before', 'p_limit', 'p_kind', 'p_item_id', 'p_oldest_first']);
  assert.equal(l.args.p_limit, 100); assert.equal(l.args.p_kind, 'used'); assert.equal(l.args.p_oldest_first, true);
  const d = L.logCall('p1', {}); assert.equal(d.args.p_limit, 50); assert.equal(d.args.p_kind, null); assert.equal(d.args.p_before, null); assert.equal(d.args.p_item_id, null); assert.equal(d.args.p_oldest_first, false);
  assert.equal(L.logCall('p1', { kind: 'all', limit: 0 }).args.p_kind, null); assert.equal(L.logCall('p1', { limit: 0 }).args.p_limit, 50);
});

test('s133 sum math: units are packs x pack size, the total is split by share with the remainder on the last line', async () => {
  const L = await lib();
  const it = { id: 'i1', perPack: 12, qty: 6 };
  assert.equal(L.lineUnits(it, { packSize: 6 }, 3), 18); assert.equal(L.lineUnits(it, { packSize: null }, 2), 24);
  const list = [{ id: 'o1', title: 'A', packSize: 12, price: 100 }, { id: 'o2', title: 'B', packSize: 6, price: 50 }];
  const plan = L.buyPlan(it, list, { lp_o1: '2', lp_o2: '1', lx: '1' });
  same(plan.lines.map((l) => l.units), [24, 6, 12]); assert.equal(plan.units, 42); assert.equal(plan.bad, false);
  assert.equal(plan.lines[2].o, null); assert.equal(L.planTotal(plan), 250); // 2 x 100 + 1 x 50
  same(L.splitTotal(100, [1, 1, 1]), [33.33, 33.33, 33.34]);
  same(L.splitTotal(250, [200, 50]), [200, 50]);
  const parts = L.splitTotal(99.99, [3, 2, 1]); assert.equal(Math.round(parts.reduce((s, x) => s + x, 0) * 100) / 100, 99.99);
  same(L.splitTotal(null, [1]), []); same(L.splitTotal(10, [5]), [10]);
  assert.equal(L.buyPlan(it, list, { lp_o1: 'x' }).bad, true); assert.equal(L.buyPlan(it, list, { lp_o1: '0' }).lines.length, 0);
});

test('s133 count total: the sum of the products plus Not sorted; Not sorted is the item quantity less the products', async () => {
  const L = await lib();
  const list = [{ id: 'o1', qty: 2 }, { id: 'o2', qty: 1 }, { id: 'o3', qty: 0 }];
  const pl = L.countPlan({ id: 'i1' }, list, { cq_o1: '3', cq_o2: '1.5', cq_o3: '0', cu: '2' });
  assert.equal(pl.total, 6.5); assert.equal(pl.unsorted, 2); assert.equal(pl.bad, false);
  same(pl.counts, [{ option_id: 'o1', qty: 3 }, { option_id: 'o2', qty: 1.5 }, { option_id: 'o3', qty: 0 }]);
  assert.equal(L.countPlan({ id: 'i1' }, list, { cq_o1: 'abc', cu: '0' }).bad, true);
  assert.equal(L.optSum(list), 3); assert.equal(L.unsortedOf({ qty: 5 }, list), 2); assert.equal(L.unsortedOf({ qty: 2 }, list), 0, 'never negative');
});

test('s133 one or no product keeps the old screens; two with quantities switch to the product forms', async () => {
  const e = await setup({ role: 'owner' }); const L = e.lib, K = L.K();
  K.opt = {};
  assert.equal(L.multiOpts({ id: 'i1' }), null);
  K.opt.i1 = { list: [{ id: 'o1', qty: 2 }] }; assert.equal(L.multiOpts({ id: 'i1' }), null, 'one product');
  K.opt.i1 = { list: [{ id: 'o1', qty: 2 }, { id: 'o2', qty: null }] }; assert.equal(L.multiOpts({ id: 'i1' }), null, 'an old server sends no quantity');
  K.opt.i1 = { list: [{ id: 'o1', qty: 2 }, { id: 'o2', qty: 0 }] }; assert.equal(L.multiOpts({ id: 'i1' }).length, 2);
});

test('s133 Low and Out are real filters and the chip count is the list length', async () => {
  const L = await lib();
  const raw = [item('a', 'Candles', 9, 2), item('b', 'Soap', 1, 3), item('c', 'Bleach', 0, 2), item('d', 'Towels', 14, 10, { category: 'Linen', consumable: false })];
  const items = raw.map((r) => L.normalize(r, 'owner'));
  const names = (chip) => L.visible(items, chip, '').map((i) => i.name);
  same(names('low').sort(), ['Bleach', 'Soap']); same(names('out'), ['Bleach']);
  assert.equal(names('all').length, 4); assert.equal(names('first').length, 4, 'the default view lists everything, worst first');
  assert.equal(names('first')[0], 'Bleach');
  const chips = L.chipsFor(items, 0, 0);
  assert.equal(chips.find((c) => c.k === 'low').n, names('low').length); assert.equal(chips.find((c) => c.k === 'out').n, names('out').length);
  same(chips.slice(0, 3).map((c) => c.k), ['low', 'out', 'all']);
  assert.equal(L.chipsFor(items.filter((i) => i.name === 'Candles'), 0, 0).some((c) => c.k === 'out'), false, 'no Out chip when nothing is out');
});

test('s133 links: any https address up to 500 characters; pictures: a shop CDN or the item\'s own path', async () => {
  const L = await lib();
  assert.equal(L.o8Link('https://example.com/p/1'), 'https://example.com/p/1'); assert.equal(L.o8Link('https://Example.COM/p'), 'https://example.com/p');
  assert.equal(L.o8Link('https://shopee.ph/Joy-i.1.2?sp_atk=x'), 'https://shopee.ph/Joy-i.1.2');
  for (const bad of ['http://example.com/p', 'https://localhost/p', 'https://a b.com', 'ftp://example.com', 'javascript:alert(1)', '', 'https://example.com/' + 'a'.repeat(490)]) assert.equal(L.o8Link(bad), null, bad);
  assert.equal(L.o8Link('https://example.com/' + 'a'.repeat(470)) !== null, true);
  assert.equal(L.siteOf('https://www.lazada.com.ph/x'), 'lazada.com.ph'); assert.equal(L.siteOf('https://shopsuki.ph/x'), 'Shopsuki');
  assert.equal(L.o8LinkShow('https://shopsuki.ph/x'), "Shows as 'View on Shopsuki'"); assert.equal(L.o8LinkShow('nope'), 'Not a valid https link yet'); assert.equal(L.o8LinkShow(''), '');
  const U = '22222222-2222-4222-8222-222222222222', path = 'items/' + ID + '/' + U + '.webp';
  assert.equal(L.o8PicPath(path, ID), path); assert.equal(L.o8PicPath('items/' + ID + '/' + U + '.jpg', ID), 'items/' + ID + '/' + U + '.jpg');
  assert.equal(L.o8PicPath(path, '33333333-3333-4333-8333-333333333333'), null, 'another item\'s path');
  assert.equal(L.o8PicPath('items/' + ID + '/' + U + '.png', ID), null); assert.equal(L.o8PicPath('../items/' + ID + '/' + U + '.webp', ID), null); assert.equal(L.o8PicPath(path, ''), null);
  assert.equal(L.o8Pic(path, ID), path); assert.equal(L.o8Pic('https://cdn.shopify.com/a.jpg', ID), 'https://cdn.shopify.com/a.jpg'); assert.equal(L.o8Pic('https://down-ph.img.susercontent.com/f', ID), 'https://down-ph.img.susercontent.com/f');
  assert.equal(L.o8Pic('https://example.com/a.jpg', ID), null);
});

test('s133 links: a userinfo host (https://shopee.ph@evil.example/) is refused', async () => {
  const L = await lib();
  for (const bad of ['https://shopee.ph@evil.example/', 'https://user:pw@example.com/p', 'https://a@b.com', 'https://example.com@evil.example/x?y=1']) assert.equal(L.o8Link(bad), null, bad);
  assert.equal(L.o8Link('https://example.com/a@b'), 'https://example.com/a@b', 'an @ in the path is fine');
  assert.equal(L.o8Link('https://example.com/p?e=a@b.c'), 'https://example.com/p?e=a@b.c', 'an @ in the query is fine');
});

test('s133 group rows: count sends changes only, used sends the product, bought sends one line per item', async () => {
  const e = await setup({ role: 'owner' }); const L = e.lib, K = L.K();
  K.opt = {}; K.items = [L.normalize(item('i1', 'Soap', 4, 3), 'owner'), L.normalize(item('i2', 'Bleach', 2, 3), 'owner')];
  const a = (mode, vals) => ({ ids: ['i1', 'i2'], mode, vals });
  same(L.groupRows(a('count', { g_i1: '4', g_i2: '5' })), [{ item_id: 'i2', qty: 5 }]);
  same(L.groupRows(a('used', { g_i1: '1', g_i2: '0' })).map((r) => r.item_id), ['i1']);
  const b = L.groupRows(a('bought', { g_i1: '2', g_i2: '' }));
  assert.equal(b.length, 1); assert.equal(b[0].item_id, 'i1'); assert.equal(b[0].lines[0].packs, 2); assert.equal(b[0].lines[0].option_id, null);
});

test('s133 group count: a never-counted item starts blank and one Save sends only what was typed', async () => {
  const e = await setup({ role: 'owner' }); const L = e.lib, K = L.K();
  K.opt = {}; K.items = [L.normalize(item('i1', 'Soap', 4, 3), 'owner'), L.normalize(item('i2', 'Bleach', null, 3), 'owner'), L.normalize(item('i3', 'Mop', null, 3), 'owner')];
  const a = { ids: ['i1', 'i2', 'i3'], mode: 'count', vals: {} };
  a.vals = L.groupDefaults(a);
  same(a.vals, { g_i1: '4', g_i2: '', g_i3: '' }); // null stays blank, never 0
  same(L.groupRows(a), []); assert.equal(L.groupSave(a), 'Save');
  a.vals.g_i2 = '7'; a.vals.g_i3 = ' ';
  same(L.groupRows(a), [{ item_id: 'i2', qty: 7 }]); assert.equal(L.groupSave(a), 'Save 1 change');
  a.vals.g_i3 = '0'; same(L.groupRows(a).map((r) => r.item_id), ['i2', 'i3']); assert.equal(L.groupSave(a), 'Save 2 changes'); // a typed 0 is a real count
  a.vals.g_i1 = '5'; assert.equal(L.groupSave(a), 'Save 3 changes');
});

test('s133 group modes: one refused mode hides only that mode; Used follows the usage flag', async () => {
  const e = await setup({ role: 'owner', demo: true }); await e.mount(''); const L = e.lib, K = L.K();
  const names = () => L.groupModes().map((m) => m[0]);
  const all = names(); assert.equal(all.includes('count') && all.includes('bought'), true);
  K.denied.group_bought = true; same(names().filter((n) => n === 'bought'), []); assert.equal(names().includes('count'), true);
  delete K.denied.group_bought; K.denied.group_count = true; assert.equal(names().includes('count'), false); assert.equal(names().includes('bought'), true);
  delete K.denied.group_count;
});

test('s133 zoom clamp: scale 1 sits still, the picture always covers the frame', async () => {
  const L = await lib();
  same(L.zoomClamp(1, 50, 50, 300, 200), { scale: 1, x: 0, y: 0 });
  same(L.zoomClamp(0.2, 5, 5, 300, 200), { scale: 1, x: 0, y: 0 });
  assert.equal(L.zoomClamp(9, 0, 0, 300, 200).scale, 4);
  same(L.zoomClamp(2, 999, -999, 300, 200), { scale: 2, x: 150, y: -100 });
});

const row = (o) => ({ at: '2026-11-23T05:00:00Z', kind: 'count', item_id: 'i1', item_name: 'Toilet paper', summary_parts: [], qty_before: 4, qty_after: 6, delta: 2, unit: 'rolls', option_title: null, money: null, actor_first_name: 'Ana', source_note: null, undone_at: null, undone_by_first_name: null, group_key: null, ...o });

test('s133 history: days are Manila days and read Today, Yesterday, then the date', async () => {
  const L = await lib(); const today = '2026-11-23';
  assert.equal(L.dayLabel('2026-11-23', today), 'Today, Mon 23 Nov'); assert.equal(L.dayLabel('2026-11-22', today), 'Yesterday, Sun 22 Nov');
  assert.equal(L.dayLabel('2026-11-10', today), 'Tue 10 Nov'); assert.equal(L.dayLabel('2025-12-31', today), 'Wed 31 Dec 2025');
  const rows = L.normLog([row({ at: '2026-11-23T05:00:00Z' }), row({ at: '2026-11-22T17:30:00Z' }), row({ at: '2026-11-22T03:00:00Z' }), row({ at: '2026-11-10T01:00:00Z' })]);
  const g = L.dayGroups(rows, false, today);
  same(g.map((x) => x.rows.length), [2, 1, 1]); // 17:30 UTC on the 22nd is the 23rd in Manila
  assert.match(g[0].label, /^Today/); assert.match(g[1].label, /^Yesterday/);
});

test('s133 history: newest first by default, oldest first when toggled, ties keep the server order', async () => {
  const L = await lib();
  const rows = L.normLog([row({ at: '2026-11-23T01:00:00Z', item_name: 'A' }), row({ at: '2026-11-23T03:00:00Z', item_name: 'B' }), row({ at: '2026-11-23T03:00:00Z', item_name: 'C' }), row({ at: '2026-11-21T03:00:00Z', item_name: 'D' })]);
  same(L.sortLog(rows, false).map((r) => r.item), ['B', 'C', 'A', 'D']);
  same(L.sortLog(rows, true).map((r) => r.item), ['D', 'A', 'B', 'C']);
  const days = (o) => L.dayGroups(rows, o, '2026-11-23').map((g) => g.day);
  same(days(false), ['2026-11-23', '2026-11-21']); same(days(true), ['2026-11-21', '2026-11-23']);
});

test('s133 history: rows normalise every contract field and the summary does not repeat the change', async () => {
  const L = await lib();
  const [r] = L.normLog([row({ kind: 'bought', summary_parts: ['2 packs', '4 to 6'], option_title: 'Joy 375ml', money: { unit_cost: 60.25, total_cost: 120.5 }, undone_at: '2026-11-23T06:00:00Z', undone_by_first_name: 'Lloyd', group_key: 'g1', source_note: 'Telegram' })]);
  assert.equal(r.kind, 'bought'); assert.equal(r.option, 'Joy 375ml'); same(r.money, { total: 120.5, unit: 60.25 }); assert.equal(r.undoneBy, 'Lloyd'); assert.equal(r.group, 'g1'); assert.equal(r.who, 'Ana'); assert.equal(r.note, 'Telegram');
  assert.equal(L.logSummary(r), '2 packs · 4 to 6 · Joy 375ml');
  same(L.normLog(null), []); same(L.normLog([{ kind: 'count' }, null]), []);
  assert.equal(L.normLog([row({ money: null })])[0].money, null);
});

test('s133 history sheet: History is in the menu, the demo covers every kind, filters and order work', async () => {
  const e = await setup({ role: 'owner', demo: true }); await e.mount('');
  assert.match(e.html(), /data-act="ilog-open">History<\/button>/);
  await e.act('ilog-open');
  const s = e.sheet();
  for (const w of ['Count', 'Bought', 'Used', 'Broken', 'Undone']) assert.match(s, new RegExp(w), w);
  assert.match(s, /I_lgdone/); assert.match(s, /Newest first/); assert.match(s, /Today/);
  await e.act('ilog-order'); assert.match(e.sheet(), /Oldest first/);
  await e.act('ilog-kind', { 'data-k': 'used' }); assert.doesNotMatch(e.sheet(), /I_lgk_bought/); assert.match(e.sheet(), /I_lgk_used/);
});

test('s133 history sheet on a live client: one inventory_log_v1 call, then paging with next_before', async () => {
  const page1 = { ok: true, rows: [row({ item_name: 'Toilet paper' })], next_before: '2026-11-22T00:00:00Z' };
  const page2 = { ok: true, rows: [row({ at: '2026-11-21T05:00:00Z', item_name: 'Old row' })], next_before: null };
  let n = 0;
  const e = await setup({ role: 'owner', client: mockClient({ catalogue: { items: [item('i1', 'Toilet paper', 4, 12)] }, rpc: { inventory_log_v1: () => ({ data: ++n === 1 ? page1 : page2, error: null }) } }) });
  await e.mount(''); await e.act('ilog-open');
  const c = e.client.rpcCalls('inventory_log_v1'); assert.equal(c.length, 1); assert.equal(c[0][2].p_before, null); assert.equal(c[0][2].p_limit, 50);
  assert.match(e.sheet(), /Show older/);
  await e.act('ilog-more');
  const c2 = e.client.rpcCalls('inventory_log_v1'); assert.equal(c2.length, 2); assert.equal(c2[1][2].p_before, '2026-11-22T00:00:00Z');
  assert.match(e.sheet(), /Old row/); assert.doesNotMatch(e.sheet(), /Show older/);
});

test('s133 history money: a bought row keeps total_cost, a price edit keeps before and after, null stays null', async () => {
  const L = await lib();
  const [b, p, n, junk] = L.normLog([row({ kind: 'bought', money: { unit_cost: 12.5, total_cost: 530.05 } }), row({ kind: 'edit', money: { before: 11.5, after: 12.5 } }), row({ money: null }), row({ money: 120 })]);
  same(b.money, { total: 530.05, unit: 12.5 }); assert.equal(L.moneyText(b.money), '₱530.05');
  same(p.money, { before: 11.5, after: 12.5 }); assert.equal(L.moneyText(p.money), '₱11.50 → ₱12.50');
  assert.equal(n.money, null); assert.equal(L.moneyText(n.money), ''); assert.equal(junk.money, null, 'a bare number is not a contract shape');
  assert.equal(L.moneyText({ before: null, after: 9 }), 'none → ₱9');
});

test('s133 history summary: the change is not added twice when summary_parts already carries it', async () => {
  const L = await lib();
  const [a, b] = L.normLog([row({ summary_parts: ['2 packs', '4 to 6'] }), row({ summary_parts: [] })]);
  assert.equal(L.logSummary(a), '2 packs · 4 to 6'); assert.equal(L.logSummary(b), '4 → 6 rolls', 'a row with no parts still shows its change');
});

test('s133 Total paid split follows the server weights: a Something else line weighs unit cost x pack, all-zero follows the units', async () => {
  const L = await lib();
  const it = { id: 'i1', perPack: 12, qty: 6, cost: 2 }; // unit cost 2 a roll: the else line weighs 24 a pack
  const list = [{ id: 'o1', title: 'A', packSize: 12, price: 100 }];
  const plan = L.buyPlan(it, list, { lp_o1: '1', lx: '1' });
  same(plan.lines.map((l) => l.w), [100, 24]); assert.equal(L.planTotal(plan), 124); // the auto-filled Total paid includes the else line
  same(L.buyShares(plan, { total: '124' }), [100, 24]); same(L.buyShares(plan, { total: '62' }), [50, 12]);
  const free = L.buyPlan({ id: 'i1', perPack: 10, qty: 0, cost: null }, [{ id: 'o1', title: 'A', packSize: 30, price: null }], { lp_o1: '1', lx: '1' }); // nothing priced: weights 0, shares follow the units 30 : 10
  assert.equal(L.planTotal(free), null); same(L.buyShares(free, { total: '40' }), [30, 10]);
});
