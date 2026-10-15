// Lane I (s84 1b, Q5): Bought some of these. One receipt per ticked line, one key per line, a failed line stops the run and a retry re-sends only the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const raw = () => ({ items: [
  item('i1', 'Toilet paper', 4, 12, { codes: [] }),
  item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', purchaseUnit: null, unitsPerPurchase: 1, codes: [] }),
  item('i3', 'Bath towels', 14, 10, { category: 'Linen', consumable: false, unit: 'pieces', purchaseUnit: null, unitsPerPurchase: 1, movementControlled: true, codes: [] })
] });
const SHOP = [
  { id: 's1', item_id: 'i1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-12T02:00:00Z' },
  { id: 's2', item_id: 'i2', item_name: 'Hand soap', quantity: 3, purchase_unit: null, reason: null, status: 'proposed', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z' },
  { id: 's3', item_id: 'i3', item_name: 'Bath towels', quantity: 1, purchase_unit: null, reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-10T02:00:00Z' }
];
let n = 0;
const recv = () => ({ data: { ok: true, purchaseId: 'p' + (++n), movementId: 'm' + n, unitsAdded: 1 }, error: null });
const make = (role = 'owner', o = {}) => setup({ role, client: mockClient({ catalogue: raw(), shop: SHOP, rpc: { record_inventory_receipt_v1: recv, ...(o.rpc || {}) } }) });
const tick = async (e, ...ids) => { for (const id of ids) await e.act('b-tick', { 'data-id': id }); };
const open = async (e) => { await e.mount('shopping'); await e.act('bought-open'); };
const rcpts = (e) => e.client.rpcCalls('record_inventory_receipt_v1');

test('I_bought only owner and admin get the button; a cleaner and finance never do, and a hand-made click opens nothing', async () => {
  for (const role of ['cleaner', 'finance']) {
    const e = await make(role); await e.mount('shopping');
    assert.doesNotMatch(e.html(), /bought-open/, role);
    await e.act('bought-open'); assert.equal(e.sheet(), '', role);
  }
  for (const role of ['owner', 'admin']) { const e = await make(role); await e.mount('shopping'); assert.match(e.html(), /Bought some of these/, role); }
});

test('I_bought approved and waiting rows are listed; ticking shows a stepper prefilled with the quantity', async () => {
  const e = await make(); await open(e);
  assert.match(e.sheet(), /Toilet paper/); assert.match(e.sheet(), /Waiting for approval/);
  await tick(e, 's1');
  assert.match(e.sheet(), /id="I_f_packs_s1"[^>]*value="2"/);
  await tick(e, 's1');
  assert.doesNotMatch(e.sheet(), /I_f_packs_s1/);
});

test('I_bought the review shows before and after with the pack conversion, and nothing is sent yet', async () => {
  const e = await make(); await open(e); await tick(e, 's1', 's3');
  await e.input('I_f_packs_s1', '2'); await e.submit();
  assert.match(e.sheet(), /Toilet paper<\/strong>: 2 packs = 24 rolls, on hand 4 → 28/);
  assert.match(e.sheet(), /Bath towels<\/strong>: 1 pack = 1 piece, on hand 14 → 15|Bath towels<\/strong>: 1 pieces, on hand 14 → 15/);
  assert.equal(rcpts(e).length, 0);
});

test('I_bought N rows make N calls with exact keys, p_shopping_list_id and a different key each; a controlled item is included', async () => {
  const e = await make(); await open(e); await tick(e, 's1', 's3'); await e.submit(); await e.submit();
  const c = rcpts(e);
  assert.equal(c.length, 2);
  for (const x of c) assert.deepEqual(Object.keys(x[2]).sort(), ['p_idempotency_key', 'p_item_id', 'p_packs', 'p_purchased_at', 'p_receipt_path', 'p_shopping_list_id', 'p_supplier', 'p_unit_cost']);
  assert.deepEqual(c.map((x) => x[2].p_shopping_list_id), ['s1', 's3']);
  assert.deepEqual(c.map((x) => x[2].p_item_id), ['i1', 'i3']);
  assert.equal(c[0][2].p_purchased_at, '2026-10-15');
  assert.notEqual(c[0][2].p_idempotency_key, c[1][2].p_idempotency_key);
  assert.match(e.sheet(), /2 items added/);
  assert.equal(e.client.rpcCalls('get_inventory_catalogue_v1').length, 2);
});

test('I_bought a waiting row is approved first with save_shopping_item_v1, then received', async () => {
  const e = await make(); await open(e); await tick(e, 's2'); await e.submit();
  assert.match(e.sheet(), /approved first/);
  await e.submit();
  const order = e.client.calls.filter((x) => x[0] === 'rpc' && (x[1] === 'save_shopping_item_v1' || x[1] === 'record_inventory_receipt_v1')).map((x) => x[1]);
  assert.deepEqual(order, ['save_shopping_item_v1', 'record_inventory_receipt_v1']);
  assert.deepEqual({ ...e.client.rpcCalls('save_shopping_item_v1')[0][2].p_item }, { id: 's2', status: 'approved' });
});

test('I_bought a failure on line 2 keeps line 1, says so, and the retry sends only the rest with the same key', async () => {
  let calls = 0;
  const e = await make('owner', { rpc: { record_inventory_receipt_v1: (a) => (a.p_shopping_list_id === 's3' && ++calls === 1 ? { data: null, error: { code: 'XX000', message: 'boom' } } : recv()) } });
  await open(e); await tick(e, 's1', 's3'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /1 of 2 added\. Bath towels did not go through\. Try again\./);
  assert.equal(rcpts(e).length, 2);
  const firstKey = rcpts(e)[1][2].p_idempotency_key;
  await e.submit();
  const c = rcpts(e);
  assert.equal(c.length, 3); // line 1 is not sent again
  assert.equal(c[2][2].p_shopping_list_id, 's3'); assert.equal(c[2][2].p_idempotency_key, firstKey);
  assert.match(e.sheet(), /2 items added/);
});

test('I_bought the price field is there for the roles that may see prices and goes out as a number, or null when empty', async () => {
  const e = await make(); await open(e); await tick(e, 's1', 's3');
  assert.match(e.sheet(), /Price per pack in PHP/);
  await e.input('I_f_cost_s1', '150.5'); await e.submit(); await e.submit();
  const c = rcpts(e);
  assert.equal(c[0][2].p_unit_cost, 150.5); assert.equal(c[1][2].p_unit_cost, null);
});

test('I_bought Undo all takes the receipts back out, newest first, with its own confirm', async () => {
  const e = await make(); await open(e); await tick(e, 's1', 's3'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /Undo all/);
  await e.act('b-undoall');
  assert.match(e.sheet(), /Undo all 2 receipts\?/);
  assert.equal(e.client.rpcCalls('inventory_undo_v1').length, 0);
  await e.submit();
  const u = e.client.rpcCalls('inventory_undo_v1');
  assert.equal(u.length, 2);
  assert.deepEqual(u.map((x) => x[2].p_purchase_id), ['p' + n, 'p' + (n - 1)]);
  assert.deepEqual(Object.keys(u[0][2]).sort(), ['p_movement_id', 'p_purchase_id']);
  assert.match(e.toasts[e.toasts.length - 1], /Undone/);
});

test('I_bought nothing ticked or a bad number stays on the pick screen', async () => {
  const e = await make(); await open(e); await e.submit();
  assert.match(e.sheet(), /Tick at least one/);
  await tick(e, 's1'); await e.input('I_f_packs_s1', 'x'); await e.submit();
  assert.match(e.sheet(), /Tick at least one/); assert.equal(rcpts(e).length, 0);
});

test('I_bought probe-and-hide: a refused or missing receipt RPC removes the button for the visit', async () => {
  const miss = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  const e = await make('owner', { rpc: { record_inventory_receipt_v1: () => miss } });
  await open(e); await tick(e, 's1'); await e.submit(); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  assert.doesNotMatch(e.html(), /bought-open/);
});

test('I_bought offline sends nothing; demo writes nothing', async () => {
  const e = await make(); await open(e); await tick(e, 's1'); await e.submit();
  e.nav.onLine = false; await e.submit();
  assert.equal(rcpts(e).length, 0); assert.match(e.sheet(), /No connection/);
  const d = await setup({ role: 'owner', demo: true });
  await d.mount('shopping'); await d.act('bought-open'); await d.act('b-tick', { 'data-id': 's1' }); await d.submit(); await d.submit();
  assert.match(d.toasts[d.toasts.length - 1], /Demo only/);
});

test('I_bought Back steps out one level', async () => {
  const e = await make(); await open(e); await tick(e, 's1'); await e.submit();
  await e.act('back'); assert.match(e.sheet(), /Tick what you bought/);
  await e.act('back'); assert.equal(e.sheet(), '');
});
