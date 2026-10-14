// Lane I (s84 1b, Q4): Running low in one tap, with one confirm, the right quantity and an Undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const raw = () => ({ items: [
  item('i1', 'Toilet paper', 4, 12, { par: 36, codes: ['T1'] }), // par 36, qty 4, 12 per pack -> ceil(32/12) = 3 packs
  item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', purchaseUnit: null, unitsPerPurchase: 1, codes: [] }), // 2 x 3 = 6, qty 0 -> 6
  item('i3', 'Bath towels', 14, null, { category: 'Linen', consumable: false, codes: [] }) // nothing to work out -> 1
] });
const make = (role, o = {}) => setup({ role, client: mockClient({ catalogue: raw(), shop: o.shop, rpc: { save_shopping_item_v1: () => ({ data: { ok: true, id: 'shop-9' }, error: null }), ...(o.rpc || {}) } }) });
const kinds = (s) => [...s.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);

test('I_running-low it is the first button on the card for every role', async () => {
  for (const role of ['cleaner', 'owner', 'admin', 'finance']) {
    const e = await make(role); await e.mount(''); await e.open('i1');
    assert.equal(kinds(e.sheet())[0], 'low', role);
    assert.match(e.sheet(), />Running low</);
  }
});

test('I_running-low one confirm, then save_shopping_item_v1 with the packs to par and the reason', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.begin('low');
  assert.match(e.sheet(), /Tell the owner Toilet paper is running low\?/);
  assert.equal(e.client.rpcCalls('save_shopping_item_v1').length, 0);
  await e.submit();
  const c = e.client.rpcCalls('save_shopping_item_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][2]).sort(), ['p_idempotency_key', 'p_item', 'p_property_id']);
  assert.equal(c[0][2].p_property_id, PID); assert.ok(c[0][2].p_idempotency_key.length >= 16);
  assert.deepEqual({ ...c[0][2].p_item }, { item_id: 'i1', item_name: 'Toilet paper', quantity: 3, purchase_unit: 'pack', reason: 'Running low (from the staff app)' });
  assert.match(e.toasts[e.toasts.length - 1], /Passed on/);
});

test('I_running-low the default quantity: 2 x reorder level when there is no par, one when unknown', async () => {
  const e = await make('cleaner'); await e.mount('');
  await e.open('i2'); await e.begin('low'); await e.submit();
  assert.equal(e.client.rpcCalls('save_shopping_item_v1')[0][2].p_item.quantity, 6);
  await e.open('i3'); await e.begin('low'); await e.submit();
  assert.equal(e.client.rpcCalls('save_shopping_item_v1')[1][2].p_item.quantity, 1);
  const L = e.lib;
  assert.equal(L.normalize(raw().items[0], 'owner').par, 36);
});

test('I_running-low already on the list: a disabled "On the shopping list" and no way to send it twice', async () => {
  const shop = [{ id: 's1', item_id: 'i1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: null, status: 'proposed', proposed_by: 'x', proposed_at: '2026-10-12T02:00:00Z' }];
  const e = await make('cleaner', { shop }); await e.mount(''); await e.open('i1');
  assert.match(e.sheet(), /disabled><span aria-hidden="true">✓<\/span> On the shopping list/);
  assert.ok(!kinds(e.sheet()).includes('low'));
  await e.begin('low'); // a hand-made click does nothing
  assert.doesNotMatch(e.sheet(), /Tell the owner/);
  await e.submit();
  assert.equal(e.client.rpcCalls('save_shopping_item_v1').length, 0);
});

test('I_running-low Undo cancels her own row with save_shopping_item_v1', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.begin('low'); await e.submit();
  assert.match(e.undo(), /Toilet paper flagged as running low/);
  const id = /data-id="(u\d+)"/.exec(e.undo())[1];
  await e.act('undo', { 'data-id': id }); await e.submit();
  const c = e.client.rpcCalls('save_shopping_item_v1').pop();
  assert.deepEqual({ ...c[2].p_item }, { id: 'shop-9', status: 'cancelled' });
});

test('I_running-low after a scan it is the first action for a cleaner; it writes only after the confirm', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('scan'); await e.input('I_f_code', 'T1'); await e.submit();
  assert.equal(kinds(e.sheet())[0], 'low');
  assert.match(e.sheet(), /btn-primary btn-block" type="button" data-act="begin" data-kind="low"/);
  assert.equal(e.client.rpcCalls('save_shopping_item_v1').length, 0);
});

test('I_running-low a missing or refused RPC hides the button for the visit, with a calm line', async () => {
  const miss = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  const e = await make('cleaner', { rpc: { save_shopping_item_v1: () => miss } });
  await e.mount(''); await e.open('i1'); await e.begin('low'); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  await e.open('i1'); assert.ok(!kinds(e.sheet()).includes('low')); assert.ok(kinds(e.sheet()).includes('shop'));
});

test('I_running-low demo writes nothing', async () => {
  const e = await setup({ role: 'cleaner', demo: true });
  await e.mount(''); await e.open('d5'); await e.begin('low'); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /Demo only/);
});

test('I_running-low Back from the confirm returns to the card', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.begin('low'); await e.act('back');
  assert.match(e.sheet(), /data-kind="low"/);
});
