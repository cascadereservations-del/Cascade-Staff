// Lane I (s84): the item card additions (Buy up to, Barcodes, Change price, Edit levels) and the money rules around them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const cat = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { par: 36, codes: ['A1', 'A2'] }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unitCost: 95 }), item('i3', 'Bath towels', 14, null, { category: 'Linen', consumable: false })] });
const make = (role, mock = {}) => setup({ role, client: mockClient({ catalogue: cat(), ...mock }) });
const MONEY = /₱|PHP|unit cost|Unit cost|price|7391|7,391/i;
const miss = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
const kinds = (s) => [...s.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);

test('I_card Buy up to shows the level, or twice the reorder level when none is set; Barcodes only for owner and admin', async () => {
  const o = await make('owner');
  await o.mount(''); await o.open('i1');
  assert.match(o.sheet(), /Buy up to<\/dt><dd>36 rolls/); assert.match(o.sheet(), /Barcodes<\/dt><dd>2 linked/);
  await o.act('close'); await o.open('i2');
  assert.match(o.sheet(), /Buy up to<\/dt><dd>2 x reorder level \(6\)/); assert.match(o.sheet(), /Barcodes<\/dt><dd>None linked/);
  const c = await make('cleaner');
  await c.mount(''); await c.open('i1');
  assert.match(c.sheet(), /Buy up to/); assert.doesNotMatch(c.sheet(), /Barcodes/);
});

test('I_card Change price: owner, admin and finance see it; a cleaner never does, and a hand-made click does nothing', async () => {
  for (const role of ['owner', 'admin', 'finance']) {
    const e = await make(role); await e.mount(''); await e.open('i1');
    assert.ok(kinds(e.sheet()).includes('price'), role);
  }
  const c = await make('cleaner'); await c.mount(''); await c.open('i1');
  assert.ok(!kinds(c.sheet()).includes('price'));
  await c.begin('price');
  assert.doesNotMatch(c.sheet(), /Price per|Change price/);
  assert.equal(c.client.rpcCalls('inventory_item_price_set_v1').length, 0);
});

test('I_card Change price flow: field, confirm in plain words, then inventory_item_price_set_v1 {p_item_id, p_unit_cost}', async () => {
  const e = await make('finance');
  await e.mount(''); await e.open('i2'); await e.begin('price');
  assert.match(e.sheet(), /Price per rolls in PHP/); assert.match(e.sheet(), /value="95"/);
  await e.input('I_f_cost', '1,250.5');
  await e.submit();
  assert.match(e.sheet(), /Enter a number such as 95/);
  await e.input('I_f_cost', '1250.50'); await e.submit();
  assert.match(e.sheet(), /Set the price of Hand soap to PHP 1,250\.5\?/);
  assert.equal(e.client.rpcCalls('inventory_item_price_set_v1').length, 0);
  await e.submit();
  const c = e.client.rpcCalls('inventory_item_price_set_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][2]).sort(), ['p_item_id', 'p_unit_cost']);
  assert.deepEqual({ ...c[0][2] }, { p_item_id: 'i2', p_unit_cost: 1250.5 });
  assert.match(e.toasts[e.toasts.length - 1], /Price saved for Hand soap/);
});

test('I_card Change price: an empty box clears the price after a confirm; zero and a million are refused before sending', async () => {
  const e = await make('owner');
  await e.mount(''); await e.open('i2'); await e.begin('price');
  await e.input('I_f_cost', ''); await e.submit();
  assert.match(e.sheet(), /Clear the price of Hand soap\?/);
  await e.submit();
  assert.deepEqual({ ...e.client.rpcCalls('inventory_item_price_set_v1')[0][2] }, { p_item_id: 'i2', p_unit_cost: null });
  const f = await make('owner'); await f.mount(''); await f.open('i2'); await f.begin('price');
  for (const bad of ['0', '1000000', '-5', '12.345', 'abc']) { await f.input('I_f_cost', bad); await f.submit(); assert.match(f.sheet(), /Enter a number such as 95/, bad); }
  assert.equal(f.client.rpcCalls('inventory_item_price_set_v1').length, 0);
});

test('I_card Edit levels: owner and admin only; sends inventory_item_update_v1 {p_item_id, p_patch} with only reorder_below and par_qty', async () => {
  const f = await make('finance'); await f.mount(''); await f.open('i1');
  assert.ok(!kinds(f.sheet()).includes('levels'));
  const e = await make('admin');
  await e.mount(''); await e.open('i1'); await e.begin('levels');
  assert.match(e.sheet(), /value="12"/); assert.match(e.sheet(), /value="36"/);
  await e.input('I_f_reorder', '10'); await e.input('I_f_par', '30'); await e.submit();
  assert.match(e.sheet(), /Save the levels for Toilet paper\?/);
  await e.submit();
  const c = e.client.rpcCalls('inventory_item_update_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][2]).sort(), ['p_item_id', 'p_patch']);
  assert.deepEqual({ ...c[0][2].p_patch }, { reorder_below: 10, par_qty: 30 });
  assert.equal(c[0][2].p_item_id, 'i1');
});

test('I_card Edit levels: a buy-up-to below the reorder level is not sent; an empty box clears that level', async () => {
  const e = await make('owner');
  await e.mount(''); await e.open('i1'); await e.begin('levels');
  await e.input('I_f_par', '5'); await e.submit();
  assert.match(e.sheet(), /Buy up to should be the same as or more than the reorder level/);
  await e.input('I_f_par', ''); await e.submit(); await e.submit();
  assert.deepEqual({ ...e.client.rpcCalls('inventory_item_update_v1')[0][2].p_patch }, { reorder_below: 12, par_qty: null });
});

test('I_card probe-and-hide: a missing price RPC hides Change price only, with a calm toast and no error box', async () => {
  const e = await make('owner', { rpc: { inventory_item_price_set_v1: () => miss } });
  await e.mount(''); await e.open('i1'); await e.begin('price'); await e.submit(); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  assert.doesNotMatch(e.sheet(), /errbox/);
  await e.open('i1');
  assert.ok(!kinds(e.sheet()).includes('price')); assert.ok(kinds(e.sheet()).includes('levels'));
});

test('I_card probe-and-hide: a refusal (42501) on Edit levels removes it for the visit', async () => {
  const e = await make('owner', { rpc: { inventory_item_update_v1: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) } });
  await e.mount(''); await e.open('i1'); await e.begin('levels'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /not available to you/);
  assert.ok(!kinds(e.sheet()).includes('levels')); assert.ok(kinds(e.sheet()).includes('price'));
});

test('I_card money: a cleaner never sees a price, a cost, a peso sign or PHP anywhere in the whole walk', async () => {
  const e = await make('cleaner');
  await e.mount('');
  assert.doesNotMatch(e.html(), MONEY);
  await e.open('i2'); assert.doesNotMatch(e.sheet(), MONEY);
  await e.act('close'); await e.act('scan'); assert.doesNotMatch(e.sheet(), MONEY);
  await e.input('I_f_code', 'NOPE1'); await e.submit(); assert.doesNotMatch(e.sheet(), MONEY);
  await e.act('close'); await e.act('report'); assert.doesNotMatch(e.sheet(), MONEY);
  await e.submit(); assert.doesNotMatch(e.sheet(), MONEY);
  assert.equal(Object.prototype.hasOwnProperty.call(e.lib.normalize(cat().items[1], 'cleaner'), 'cost'), false);
});

test('I_card money: finance reads the cost on the card, still not in the list; owner, admin the same', async () => {
  for (const role of ['finance', 'owner', 'admin']) {
    const e = await make(role); await e.mount('');
    assert.doesNotMatch(e.html(), /₱/, role);
    await e.open('i2'); assert.match(e.sheet(), /Unit cost<\/dt><dd>₱95/, role);
  }
});

test('I_card the card for an item with no consumable flag and no reorder level shows no Buy up to row', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i3');
  assert.doesNotMatch(e.sheet(), /Buy up to/);
});

test('I_card demo: price and levels talk to nobody', async () => {
  const e = await setup({ role: 'owner', demo: true });
  await e.mount(''); await e.open('d1'); await e.begin('price'); await e.submit(); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /Demo only/);
  assert.equal(e.client, null);
});
