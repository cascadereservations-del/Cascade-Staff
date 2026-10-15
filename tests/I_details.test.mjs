// Lane D-client-stock (s86 4.2 + 4.6 + 9.2): Edit details (Kept in, Unit, Category), search on location, Where to buy for every role (price for finance only),
// and the cleaner rendered-HTML scan (no money word anywhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, NOW } from './I_harness.mjs';

const SUP = { id: 's1', name: 'SM Savemore', location: 'KCC Mall' };
const P1 = 'items/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp';
const raw = (role) => {
  const priced = role === 'owner' || role === 'admin' || role === 'finance';
  return { items: [
    item('i1', 'Toilet paper', 4, 12, { location: 'Hall cabinet', supplier: SUP, photo: P1, ...(priced ? { lastPrice: 12.5, priceUp: 25 } : {}), ...(role === 'cleaner' ? { unitCost: undefined } : {}) }),
    item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', location: '' }),
    item('i3', 'Bath towels', 14, 10, { category: 'Linen', location: 'Store room' })], sourceAsOf: NOW };
};
const stripCost = (c) => { c.items.forEach((i) => { delete i.unitCost; }); return c; };
const make = (role = 'owner', o = {}) => setup({ role, ...(o.sup ? { suppliers: o.sup } : {}), client: mockClient({ catalogue: role === 'cleaner' ? stripCost(raw(role)) : raw(role), fn: { 'upload-photo': (b) => ({ data: { ok: true, urls: { [P1]: 'https://stay.example/sign/' + P1 + '?token=t' } }, error: null }) }, rpc: { inventory_item_update_v1: () => ({ data: { ok: true }, error: null }) } }) });
const j = (x) => JSON.stringify(x);
const updates = (e) => e.client.rpcCalls('inventory_item_update_v1');

test('I_details Edit details: Kept in with the places already used, Unit select keeps the current value, Category select; owner and admin only', async () => {
  const f = await make('finance'); await f.mount(''); await f.open('i1'); assert.doesNotMatch(f.sheet(), /Edit details/);
  const e = await make('owner'); await e.mount(''); await e.open('i1'); await e.begin('levels');
  const s = e.sheet();
  assert.match(s, /Edit details: Toilet paper/);
  assert.match(s, /id="I_f_location" list="I_locs"/); assert.match(s, /<option value="Hall cabinet">/); assert.match(s, /<option value="Store room">/);
  assert.match(s, /<option value="rolls" selected>rolls<\/option>/); // not in the standard list, kept as it is
  assert.match(s, /<option value="pc">pc<\/option>/); assert.match(s, /<option value="mL">mL<\/option>/);
  assert.match(s, /<option value="Bathroom" selected>Bathroom<\/option>/); assert.match(s, /<option value="Miscellaneous">/);
});

test('I_details one inventory_item_update_v1 call carries location, unit and category (changed ones) with the levels; Undo puts the old values back', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1'); await e.begin('levels');
  await e.input('I_f_location', 'Linen closet'); await e.input('I_f_unit', 'pack'); await e.input('I_f_category', 'Linen'); await e.submit();
  assert.match(e.sheet(), /Kept in: Linen closet/); assert.match(e.sheet(), /Unit: pack/); assert.match(e.sheet(), /Category: Linen/);
  assert.equal(updates(e).length, 0);
  await e.submit();
  assert.equal(updates(e).length, 1);
  assert.equal(j(updates(e)[0][2]), j({ p_item_id: 'i1', p_patch: { reorder_below: 12, par_qty: null, location: 'Linen closet', unit: 'pack', category: 'Linen' } }));
  assert.match(e.undo(), /Details saved for Toilet paper/);
  await e.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(e.undo())[1] }); await e.submit();
  assert.equal(j(updates(e)[1][2].p_patch), j({ reorder_below: 12, par_qty: null, location: 'Hall cabinet', unit: 'rolls', category: 'Bathroom' }));
});

test('I_details an unchanged Kept in, Unit and Category are not sent; clearing Kept in sends an empty string', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1'); await e.begin('levels'); await e.input('I_f_reorder', '10'); await e.submit(); await e.submit();
  assert.equal(j(updates(e)[0][2].p_patch), j({ reorder_below: 10, par_qty: null }));
  const c = await make('owner'); await c.mount(''); await c.open('i1'); await c.begin('levels'); await c.input('I_f_location', ''); await c.submit(); await c.submit();
  assert.equal(updates(c)[0][2].p_patch.location, '');
});

test('I_details search also matches where an item is kept; Count a group shows Kept in under the name', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('chip', { 'data-k': 'all' });
  await e.input('I_q', 'store room');
  const list = e.root.kids.list.innerHTML;
  assert.match(list, /Bath towels/); assert.doesNotMatch(list, /Toilet paper/);
  await e.input('I_q', '');
  await e.act('chip', { 'data-k': 'c:Bathroom' }); await e.act('walk', { 'data-cat': 'Bathroom' });
  assert.match(e.sheet(), /Kept in Hall cabinet/);
});

test('I_details Where to buy: every role sees the shop and its place; only finance-capable roles see the price, the pack figure and the price-up mark', async () => {
  const o = await make('owner'); await o.mount(''); await o.open('i1');
  assert.match(o.sheet(), /Where to buy/); assert.match(o.sheet(), /SM Savemore, KCC Mall, last PHP 12\.50 each \(PHP 150 a pack of 12\)/);
  assert.match(o.sheet(), /Price up 25%/); assert.match(o.sheet(), /Kept in/);
  const f = await make('finance'); await f.mount(''); await f.open('i1'); assert.match(f.sheet(), /last PHP 12\.50 each/);
  const c = await make('cleaner'); await c.mount(''); await c.open('i1');
  assert.match(c.sheet(), /Where to buy/); assert.match(c.sheet(), /SM Savemore, KCC Mall/); assert.match(c.sheet(), /Kept in/);
  assert.doesNotMatch(c.sheet(), /last PHP|Price up|each/);
});

test('I_details a tap on Where to buy opens the price history through I_Suppliers when it is here (finance-capable roles)', async () => {
  const seen = [];
  const sup = { pick: async () => null, openPriceHistory: (ctx, it) => seen.push([ctx.role, it.id, it.lastPrice]), mountList() {} };
  const e = await make('owner', { sup }); await e.mount(''); await e.open('i1'); await e.act('pricehist');
  assert.equal(j(seen), j([['owner', 'i1', 12.5]]));
  const c = await make('cleaner', { sup }); await c.mount(''); await c.open('i1'); assert.doesNotMatch(c.sheet(), /pricehist/);
});

test('I_details cleaner rendered HTML holds no PHP, ₱, cost, price, lastPrice or priceUp anywhere (list, card, photo sheet, supplier chip); the shop name and place are allowed', async () => {
  const sup = { pick: async () => null, openPriceHistory() {}, mountList() {} };
  const c = await setup({ role: 'cleaner', suppliers: sup, doc: {}, client: mockClient({ catalogue: stripCost(raw('cleaner')), fn: { 'upload-photo': () => ({ data: { ok: true, urls: { [P1]: 'https://stay.example/sign/' + P1 + '?token=t' } }, error: null }) } }) });
  const bad = /PHP|₱|cost|price|lastPrice|priceUp/i;
  await c.mount('');
  assert.doesNotMatch(c.html(), bad); assert.match(c.html(), /Suppliers/);
  await c.open('i1'); assert.doesNotMatch(c.html() + c.sheet(), bad); assert.match(c.sheet(), /SM Savemore/);
  await c.change('I_photo_in', [{ name: 'a.jpg', size: 100 }]); assert.doesNotMatch(c.sheet(), bad);
  await c.act('back'); await c.act('photo-remove'); assert.doesNotMatch(c.sheet(), bad);
  await c.act('back'); await c.act('close');
  await c.act('chip', { 'data-k': 'all' }); assert.doesNotMatch(c.html(), bad);
});

test('I_details the cleaner payload keys are never read: lastPrice and priceUp in a cleaner catalogue are ignored', async () => {
  const cat = stripCost(raw('owner')); // a server that leaked them
  const c = await setup({ role: 'cleaner', client: mockClient({ catalogue: cat }) });
  await c.mount(''); await c.open('i1');
  assert.doesNotMatch(c.sheet(), /last PHP|Price up|12\.5/);
});
