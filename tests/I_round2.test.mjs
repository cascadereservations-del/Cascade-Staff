// Lane I (s84 r2): Opus round 2 fixes R2-1 to R2-12 that sit in the client.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { here, setup, mockClient, item } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const okd = (d) => () => ({ data: { ok: true, ...d }, error: null });
const css = fs.readFileSync(path.join(here, '..', 'stock', 'I_stock.css'), 'utf8');
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { par: 36, codes: [] }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unitsPerPurchase: 1, purchaseUnit: null, codes: [] }), item('i3', 'Bath towels', 14, 10, { category: 'Linen', consumable: false, movementControlled: true, unit: 'pieces', purchaseUnit: null, unitsPerPurchase: 1, codes: [] })] });
const RPC = { reconcile_inventory_baseline_v1: (a) => ({ data: { ok: true, movementId: 'mv-' + a.p_item_id }, error: null }), record_inventory_receipt_v1: okd({ purchaseId: 'p1', movementId: 'm1' }), inventory_item_create_v1: okd({ item_id: 'new-1' }), inventory_undo_v1: okd({ item_id: 'i1' }), inventory_code_detach_v1: okd({}), inventory_item_update_v1: okd({}) };
const make = (role = 'owner', rpc = {}, o = {}) => setup({ role, client: mockClient({ catalogue: o.cat || raw(), shop: o.shop, rpc: { ...RPC, ...rpc }, fn: o.fn }) });
const press = async (e, n = 1) => { for (let i = 0; i < n; i++) await e.submit(); };
const uid = (e) => /data-id="(u\d+)"/.exec(e.undo())[1];

test('I_round2 R2-1: the undo bar is fixed above the tab bar, not sticky inside a zero-height slot', () => {
  const rule = /\.I_undo \{[^}]*\}/.exec(css)[0];
  assert.match(rule, /position: fixed/); assert.doesNotMatch(rule, /sticky/);
  assert.match(rule, /var\(--tabbar-h, 0px\)/); assert.match(rule, /safe-area-inset-bottom/); assert.match(rule, /z-index: 7/);
});

test('I_round2 R2-2: undoing a New item frees its code first, then deactivates it, with one confirm', async () => {
  const e = await make();
  await e.mount(''); await e.act('scan'); await e.input('I_f_code', '555'); await e.submit(); await e.act('scan-new');
  await e.input('I_f_name', 'Spare keys'); await e.input('I_f_category', 'Miscellaneous'); await press(e, 2);
  await e.act('undo', { 'data-id': uid(e) });
  assert.match(e.sheet(), /Remove Spare keys and free code 555\?/);
  await e.submit();
  const order = e.client.calls.filter((c) => c[0] === 'rpc' && ['inventory_code_detach_v1', 'inventory_item_update_v1'].includes(c[1])).map((c) => c[1]);
  assert.deepEqual(order, ['inventory_code_detach_v1', 'inventory_item_update_v1']);
  assert.deepEqual({ ...e.client.rpcCalls('inventory_code_detach_v1')[0][2] }, { p_property_id: PID, p_code: '555' });
  assert.deepEqual({ ...e.client.rpcCalls('inventory_item_update_v1')[0][2].p_patch }, { active: false });
});

const SHOP = [
  { id: 's1', item_id: 'i1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-12T02:00:00Z' },
  { id: 's2', item_id: 'i2', item_name: 'Hand soap', quantity: 3, purchase_unit: null, reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z' },
  { id: 's3', item_id: 'i3', item_name: 'Bath towels', quantity: 1, purchase_unit: null, reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-10T02:00:00Z' }
];
let n = 0;
const recv = () => ({ data: { ok: true, purchaseId: 'p' + (++n), movementId: 'm' + n }, error: null });

test('I_round2 R2-3: a retried Undo all skips the lines already undone', async () => {
  let fails = 1;
  const e = await make('owner', { record_inventory_receipt_v1: recv, inventory_undo_v1: (a) => (a.p_purchase_id === 'p' + (n - 1) && fails-- > 0 ? { data: null, error: { code: 'XX000', message: 'boom' } } : { data: { ok: true }, error: null }) }, { shop: SHOP });
  await e.mount('shopping'); await e.act('bought-open');
  for (const id of ['s1', 's2', 's3']) await e.act('b-tick', { 'data-id': id });
  await press(e, 2);
  await e.act('b-undoall'); await press(e); // newest (p3) undone, p2 fails
  const afterFirst = e.client.rpcCalls('inventory_undo_v1').map((c) => c[2].p_purchase_id);
  assert.deepEqual(afterFirst, ['p' + n, 'p' + (n - 1)]);
  await press(e); // retry
  const all = e.client.rpcCalls('inventory_undo_v1').map((c) => c[2].p_purchase_id);
  assert.deepEqual(all, ['p' + n, 'p' + (n - 1), 'p' + (n - 1), 'p' + (n - 2)]); // p3 is not asked again
});

test('I_round2 R2-3: not_found on an Undo means it is already undone', async () => {
  const e = await make('owner', { inventory_undo_v1: () => ({ data: { ok: false, reason: 'not_found' }, error: null }) });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '12'); await press(e, 2);
  await e.act('undo', { 'data-id': uid(e) }); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /^Undone\.$/); assert.equal(e.undo(), '');
});

test('I_round2 R2-5: after a count that may have landed unseen, a changed value gets a new key; the same value keeps its key', async () => {
  let k = 0;
  const e = await make('owner', { reconcile_inventory_baseline_v1: () => (++k <= 2 ? { data: null, error: { code: 'XX000', message: 'boom' } } : { data: { ok: true, movementId: 'm' }, error: null }) });
  await e.mount(''); await e.act('walk', { 'data-cat': 'Bathroom' });
  await e.input('I_f_qty', '12'); await e.submit();
  const key1 = e.client.rpcCalls('reconcile_inventory_baseline_v1')[0][2].p_idempotency_key;
  await e.submit(); assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1')[1][2].p_idempotency_key, key1); // same value, same key
  await e.input('I_f_qty', '13'); await e.submit();
  assert.notEqual(e.client.rpcCalls('reconcile_inventory_baseline_v1')[2][2].p_idempotency_key, key1);
  assert.ok(e.client.rpcCalls('get_inventory_catalogue_v1').length >= 2); // the list is looked at again after the failure
});

test('I_round2 R2-6: Close after a too-late Undo sends nothing more', async () => {
  const e = await make('owner', { inventory_undo_v1: () => ({ data: { ok: false, reason: 'too_late' }, error: null }) });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '12'); await press(e, 2);
  await e.act('undo', { 'data-id': uid(e) }); await e.submit();
  const before = e.client.rpcCalls('inventory_undo_v1').length;
  await e.submit();
  assert.equal(e.client.rpcCalls('inventory_undo_v1').length, before); assert.equal(e.sheet(), '');
});

test('I_round2 R2-7: undoing a first count says the item stays counted in the app; a controlled item does not', async () => {
  const e = await make();
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '12'); await press(e, 2);
  await e.act('undo', { 'data-id': uid(e) });
  assert.match(e.sheet(), /It stays counted in the app\./);
  const c = await make();
  await c.mount(''); await c.open('i3'); await c.begin('count'); await c.input('I_f_qty', '12'); await press(c, 2);
  await c.act('undo', { 'data-id': uid(c) });
  assert.doesNotMatch(c.sheet(), /stays counted/);
});

test('I_round2 R2-8: a Bought line that needs a fresh count says so, not "Try again"', async () => {
  const e = await make('owner', { record_inventory_receipt_v1: () => ({ data: null, error: { code: 'P0001', message: 'stock reconciliation required' } }) }, { shop: SHOP });
  await e.mount('shopping'); await e.act('bought-open'); await e.act('b-tick', { 'data-id': 's3' }); await press(e, 2);
  assert.match(e.sheet(), /needs a fresh count first/); assert.doesNotMatch(e.sheet(), /Try again\./);
});

test('I_round2 R2-10: History uses the server words and the unit on Last bought', async () => {
  const hist = { ok: true, usage: { cleans_30d: 0, per_clean: null, cleans_14d: 0 }, changes: [{ at: '2026-10-12T03:00:00Z', kind: 'counted', before: 1, after: 2, who: 'Lloyd' }, { at: '2026-10-11T03:00:00Z', kind: 'received', before: 2, after: 5, who: 'Lloyd' }, { at: '2026-10-10T03:00:00Z', kind: 'used', before: 5, after: 4, who: 'Honey' }, { at: '2026-10-09T03:00:00Z', kind: 'adjusted', before: 4, after: 3, who: 'Lloyd' }], last_bought: { at: '2026-10-12T03:00:00Z', qty: 12 } };
  const e = await make('owner', { inventory_item_history_v1: () => ({ data: hist, error: null }) });
  await e.mount(''); await e.open('i1'); await e.act('history-open');
  for (const w of ['Counted 1 → 2', 'Received 2 → 5', 'Used 5 → 4', 'Adjusted 4 → 3']) assert.match(e.sheet(), new RegExp(w));
  assert.match(e.sheet(), /Oct 12, 12 rolls/);
});

test('I_round2 R2-4: opening Bought re-reads the shopping list, and a row bought elsewhere drops out', async () => {
  const shop = SHOP.map((r) => ({ ...r }));
  const e = await make('owner', { record_inventory_receipt_v1: recv }, { shop });
  await e.mount('shopping');
  const reads = () => e.client.calls.filter((c) => c[0] === 'from' && c[1] === 'inventory_shopping_list').length;
  const before = reads();
  shop.splice(0, 1); // someone else marked Toilet paper as bought
  await e.act('bought-open');
  assert.ok(reads() > before);
  assert.doesNotMatch(e.sheet(), /data-id="s1"/); assert.match(e.sheet(), /data-id="s2"/);
});

test('I_round2 R2-4: already_received from the server reads in plain words, refreshes the list and returns to the pick screen', async () => {
  const e = await make('owner', { record_inventory_receipt_v1: () => ({ data: { ok: false, reason: 'already_received' }, error: null }) }, { shop: SHOP });
  await e.mount('shopping'); await e.act('bought-open'); await e.act('b-tick', { 'data-id': 's1' }); await press(e, 2);
  assert.match(e.sheet(), /Someone already marked this as bought\. The list is refreshed\./);
  assert.match(e.sheet(), /Tick what you bought/);
});

test('I_round2 R2-12: Count this group is offered under a category chip too', async () => {
  const e = await make(); await e.mount(''); await e.act('chip', { 'data-k': 'c:Bathroom' });
  assert.match(e.html(), /data-act="walk" data-cat="Bathroom"/);
});
