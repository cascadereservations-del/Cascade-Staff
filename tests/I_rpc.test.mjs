// Lane I: every server call, by exact name and argument keys, plus the frozen clock and the idempotency key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, CATALOGUE, keysOf } from './I_harness.mjs';

const PROP = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const ok = () => ({ data: { ok: true }, error: null });

test('I_rpc catalogue read: get_inventory_catalogue_v1 with p_property_id only, and the shopping table read selects no cost column', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount('');
  const c = e.client.rpcCalls('get_inventory_catalogue_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keysOf(c[0][2]), ['p_property_id']);
  assert.equal(c[0][2].p_property_id, PROP);
  const from = e.client.calls.filter((x) => x[0] === 'from' && x[1] === 'inventory_shopping_list')[0][2];
  assert.equal(from.select, 'id,item_id,item_name,quantity,purchase_unit,reason,status,proposed_by,proposed_at');
  assert.ok(!/cost|supplier|price/.test(from.select));
  assert.deepEqual(from.eq, [['property_id', PROP]]);
});

test('I_rpc the shell may pass propertyId and it wins', async () => {
  const e = await setup({ role: 'owner', propertyId: 'prop-x' });
  await e.mount('');
  assert.equal(e.client.rpcCalls('get_inventory_catalogue_v1')[0][2].p_property_id, 'prop-x');
});

test('I_rpc count: reconcile_inventory_baseline_v1 keys and values', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); await e.open('i1'); await e.begin('count');
  await e.input('I_f_qty', '12'); await e.input('I_f_note', 'Storeroom shelf 2'); await e.submit(); await e.submit();
  const c = e.client.rpcCalls('reconcile_inventory_baseline_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keysOf(c[0][2]), ['p_counted_qty', 'p_idempotency_key', 'p_item_id', 'p_note']);
  assert.equal(c[0][2].p_item_id, 'i1'); assert.equal(c[0][2].p_counted_qty, 12); assert.equal(c[0][2].p_note, 'Storeroom shelf 2');
  assert.ok(c[0][2].p_idempotency_key.length >= 16 && c[0][2].p_idempotency_key.length <= 160);
});

test('I_rpc count without a note sends the default note (the server needs three characters)', async () => {
  const e = await setup({ role: 'admin' });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.submit(); await e.submit();
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1')[0][2].p_note, 'Counted in the staff app');
});

test('I_rpc usage: record_inventory_usage keys, Manila date from the frozen clock, usage_key = the idempotency key', async () => {
  const e = await setup({ role: 'cleaner' });
  await e.mount(''); await e.open('i1'); await e.begin('used'); await e.act('step', { 'data-f': 'qty', 'data-d': '1', 'data-z': '0' }); await e.submit(); await e.submit();
  const c = e.client.rpcCalls('record_inventory_usage');
  assert.equal(c.length, 1);
  assert.deepEqual(keysOf(c[0][2]), ['p_logged_by', 'p_notes', 'p_property_id', 'p_rows', 'p_session_date']);
  assert.equal(c[0][2].p_session_date, '2026-10-15'); assert.equal(c[0][2].p_property_id, PROP);
  assert.equal(c[0][2].p_rows.length, 1);
  assert.deepEqual(keysOf(c[0][2].p_rows[0]), ['item_id', 'usage_key', 'used_qty']);
  assert.equal(c[0][2].p_rows[0].used_qty, 2); assert.equal(c[0][2].p_rows[0].item_id, 'i1');
  assert.ok(c[0][2].p_rows[0].usage_key.length >= 16);
});

test('I_rpc frozen clock: after 16:00 UTC the Manila date is already tomorrow', async () => {
  const e = await setup({ role: 'cleaner', now: '2026-10-15T17:00:00Z' });
  await e.mount(''); await e.open('i1'); await e.begin('used'); await e.submit(); await e.submit();
  assert.equal(e.client.rpcCalls('record_inventory_usage')[0][2].p_session_date, '2026-10-16');
  const o = await setup({ role: 'owner', now: '2026-10-15T17:00:00Z' });
  await o.mount(''); await o.open('i1'); await o.begin('recv'); await o.submit(); await o.submit();
  assert.equal(o.client.rpcCalls('record_inventory_receipt_v1')[0][2].p_purchased_at, '2026-10-16');
});

test('I_rpc receipt: record_inventory_receipt_v1 keys, no receipt upload, optional cost and supplier', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); await e.open('i1'); await e.begin('recv');
  await e.input('I_f_packs', '2'); await e.input('I_f_supplier', 'Gaisano'); await e.input('I_f_cost', '150.50'); await e.submit();
  assert.match(e.sheet(), /Add 24 rolls of Toilet paper\?/); // 2 packs x 12
  await e.submit();
  const c = e.client.rpcCalls('record_inventory_receipt_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keysOf(c[0][2]), ['p_idempotency_key', 'p_item_id', 'p_packs', 'p_purchased_at', 'p_receipt_path', 'p_shopping_list_id', 'p_supplier', 'p_unit_cost']);
  const a = c[0][2];
  assert.equal(a.p_packs, 2); assert.equal(a.p_unit_cost, 150.5); assert.equal(a.p_supplier, 'Gaisano'); assert.equal(a.p_receipt_path, null); assert.equal(a.p_shopping_list_id, null); assert.equal(a.p_purchased_at, '2026-10-15');
});

test('I_rpc receipt with no cost sends null, not zero', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); await e.open('i1'); await e.begin('recv'); await e.submit(); await e.submit();
  const a = e.client.rpcCalls('record_inventory_receipt_v1')[0][2];
  assert.equal(a.p_unit_cost, null); assert.equal(a.p_supplier, null);
});

test('I_rpc shopping add: save_shopping_item_v1 with the item payload and no cost', async () => {
  const e = await setup({ role: 'cleaner' });
  await e.mount(''); await e.open('i1'); await e.begin('shop'); await e.input('I_f_note', 'Last pack used'); await e.submit(); await e.submit();
  const c = e.client.rpcCalls('save_shopping_item_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keysOf(c[0][2]), ['p_idempotency_key', 'p_item', 'p_property_id']);
  assert.deepEqual(keysOf(c[0][2].p_item), ['item_id', 'item_name', 'purchase_unit', 'quantity', 'reason']);
  assert.deepEqual(c[0][2].p_item, { item_id: 'i1', item_name: 'Toilet paper', purchase_unit: 'pack', quantity: 1, reason: 'Last pack used' });
});

test('I_rpc idempotency: the key is stable across a retry of the same values and new when the values change', async () => {
  let n = 0;
  const client = mockClient({ catalogue: CATALOGUE, rpc: { reconcile_inventory_baseline_v1: () => { n++; if (n === 1) throw new TypeError('Failed to fetch'); return ok(); } } });
  const e = await setup({ role: 'owner', client });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /No connection, so nothing was sent\./);
  await e.submit(); // retry, same values
  const calls = client.rpcCalls('reconcile_inventory_baseline_v1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].p_idempotency_key, calls[1][2].p_idempotency_key);
  // a second, different count gets a different key
  await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '10'); await e.submit(); await e.submit();
  const third = client.rpcCalls('reconcile_inventory_baseline_v1')[2][2];
  assert.notEqual(third.p_idempotency_key, calls[0][2].p_idempotency_key);
});

test('I_rpc idempotency: changing the value after a failure gives a new key (a replay must never carry other numbers)', async () => {
  let n = 0;
  const client = mockClient({ catalogue: CATALOGUE, rpc: { reconcile_inventory_baseline_v1: () => { n++; if (n === 1) throw new TypeError('Failed to fetch'); return ok(); } } });
  const e = await setup({ role: 'owner', client });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit(); await e.submit();
  await e.act('back'); // to the form
  await e.input('I_f_qty', '11'); await e.submit(); await e.submit();
  const c = client.rpcCalls('reconcile_inventory_baseline_v1');
  assert.equal(c.length, 2); assert.notEqual(c[0][2].p_idempotency_key, c[1][2].p_idempotency_key); assert.equal(c[1][2].p_counted_qty, 11);
});

test('I_rpc shopping approve, remove and mark bought use save_shopping_item_v1 and the receipt with the list id', async () => {
  const shop = [
    { id: 's1', item_id: 'i2', item_name: 'Hand soap', quantity: 6, purchase_unit: 'bottles', reason: 'Last one', status: 'proposed', proposed_by: 'me-1', proposed_at: '2026-10-12T02:00:00Z' },
    { id: 's2', item_id: 'i1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z' }
  ];
  const e = await setup({ role: 'owner', client: mockClient({ catalogue: CATALOGUE, shop }) });
  await e.mount('shopping');
  await e.act('shop-open', { 'data-id': 's1' }); await e.act('shop-do', { 'data-do': 'approved' });
  assert.equal(e.client.rpcCalls('save_shopping_item_v1').length, 0); // confirm first
  await e.submit();
  assert.deepEqual(e.client.rpcCalls('save_shopping_item_v1')[0][2].p_item, { id: 's1', status: 'approved' });
  await e.act('shop-open', { 'data-id': 's1' }); await e.act('shop-do', { 'data-do': 'rejected' }); await e.submit();
  assert.deepEqual(e.client.rpcCalls('save_shopping_item_v1')[1][2].p_item, { id: 's1', status: 'rejected' });
  await e.act('shop-open', { 'data-id': 's2' }); await e.act('shop-bought'); await e.submit(); await e.submit();
  const r = e.client.rpcCalls('record_inventory_receipt_v1')[0][2];
  assert.equal(r.p_shopping_list_id, 's2'); assert.equal(r.p_item_id, 'i1'); assert.equal(r.p_packs, 2);
});
