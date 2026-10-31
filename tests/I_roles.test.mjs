// Lane I: money and roles. A cleaner sees no cost anywhere; every action is hidden for a role that cannot perform it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, CATALOGUE, item } from './I_harness.mjs';

const SHOP = [
  { id: 's1', item_id: 'i2', item_name: 'Hand soap', quantity: 6, purchase_unit: 'bottles', reason: 'Last one', status: 'proposed', proposed_by: 'me-1', proposed_at: '2026-10-12T02:00:00Z', estimated_cost: 8888.25, unit_cost: 8888.25, supplier: 'Secret Supplier' },
  { id: 's2', item_id: 'i1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z', estimated_cost: 8888.25 },
  { id: 's3', item_id: 'i3', item_name: 'Gone item', quantity: 1, purchase_unit: null, reason: null, status: 'rejected', proposed_by: 'x', proposed_at: '2026-10-10T02:00:00Z' }
];
const COST_WORDS = /7391|8888|unitCost|unit_cost|estimated_cost|Unit cost|₱|Secret Supplier|supplier|price|total/i;

for (const role of ['cleaner']) {
  test('I_roles ' + role + ': no cost anywhere, even when the payload carries unitCost, estimated_cost and a supplier', async () => {
    const e = await setup({ role, client: mockClient({ catalogue: CATALOGUE, shop: SHOP }) });
    await e.mount('');
    assert.match(e.html(), /Toilet paper/);
    assert.doesNotMatch(e.html(), COST_WORDS);
    await e.open('i1');
    assert.match(e.sheet(), /Toilet paper/);
    assert.doesNotMatch(e.sheet(), COST_WORDS);
    for (const k of ['shop', 'used']) { await e.begin(k); assert.doesNotMatch(e.sheet(), COST_WORDS); await e.submit(); assert.doesNotMatch(e.sheet(), COST_WORDS); await e.act('back'); await e.act('back'); }
    await e.act('tab', { 'data-to': 'shopping' });
    assert.match(e.html(), /Hand soap/);
    assert.doesNotMatch(e.html(), COST_WORDS);
    const kept = e.lib.normalize(CATALOGUE.items[0], role);
    assert.equal(Object.prototype.hasOwnProperty.call(kept, 'cost'), false);
    assert.doesNotMatch(JSON.stringify(kept), /7391/);
    assert.doesNotMatch(JSON.stringify(e.lib.normalizeShop(SHOP, 'me-1')), /8888|Secret/);
  });
}

for (const role of ['owner', 'admin']) {
  test('I_roles ' + role + ': may see the unit cost on the item sheet, and only there', async () => {
    const e = await setup({ role });
    await e.mount('');
    assert.doesNotMatch(e.html(), /7,391/); // not in the list
    await e.open('i1');
    assert.match(e.sheet(), /Unit cost/);
    assert.match(e.sheet(), /₱7,391\.55/);
  });
}

test('I_roles an item with no unit cost shows no cost row for the owner', async () => {
  const e = await setup({ role: 'owner', client: mockClient({ catalogue: { items: [item('z1', 'Candles', 5, 2, { unitCost: null })] } }) });
  await e.mount(''); await e.open('z1');
  assert.doesNotMatch(e.sheet(), /Unit cost/);
});

const MATRIX = { owner: { count: 1, used: 0, recv: 1, shop: 1, link: 1 }, admin: { count: 1, used: 0, recv: 1, shop: 1, link: 1 }, cleaner: { count: 1, used: 1, recv: 0, shop: 1, link: 0 }, finance: { count: 0, used: 0, recv: 0, shop: 1, link: 0 } };

test('I_roles finance: the unit cost shows on the item sheet only, never in the list, the shopping list or a sheet it cannot use', async () => {
  const e = await setup({ role: 'finance', client: mockClient({ catalogue: CATALOGUE, shop: SHOP }) });
  await e.mount('');
  assert.doesNotMatch(e.html(), COST_WORDS);
  await e.open('i1');
  assert.match(e.sheet(), /Unit cost/); assert.match(e.sheet(), /₱7,391\.55/);
  await e.act('close');
  await e.act('tab', { 'data-to': 'shopping' });
  assert.doesNotMatch(e.html(), /7391|8888|unitCost|unit_cost|estimated_cost|Unit cost|Secret Supplier/i); // s107 B10: finance may see a shop subtotal, never a unit cost
  assert.match(e.html(), /₱/);
  assert.doesNotMatch(JSON.stringify(e.lib.normalizeShop(SHOP, 'me-1')), /8888|Secret/);
});
for (const role of Object.keys(MATRIX)) {
  test('I_roles action visibility for ' + role, async () => {
    const e = await setup({ role });
    await e.mount(''); await e.open('i1');
    const s = e.sheet(), m = MATRIX[role];
    assert.equal(/data-kind="count"/.test(s), !!m.count, 'count');
    assert.equal(/data-kind="used"/.test(s), !!m.used, 'used');
    assert.equal(/data-kind="recv"/.test(s), !!m.recv, 'recv');
    assert.equal(/data-kind="shop"/.test(s), !!m.shop, 'shop');
    assert.equal(/#door\/inventory/.test(s), !!m.link, 'admin link');
  });
}

test('I_roles shopping list: only owner and admin get row actions; everyone else reads', async () => {
  const c = await setup({ role: 'cleaner', client: mockClient({ catalogue: CATALOGUE, shop: SHOP }) });
  await c.mount('shopping');
  assert.match(c.html(), /Hand soap/); assert.match(c.html(), /You asked/); assert.match(c.html(), /Asked by staff/);
  assert.doesNotMatch(c.html(), /shop-open/);
  assert.doesNotMatch(c.html(), /Gone item/); // rejected rows are not open items
  await c.act('shop-open', { 'data-id': 's1' }); // a hand-made click does nothing for a cleaner
  assert.equal(c.sheet(), '');
  const o = await setup({ role: 'owner', client: mockClient({ catalogue: CATALOGUE, shop: SHOP }) });
  await o.mount('shopping');
  assert.match(o.html(), /data-act="shop-open"/);
});

test('I_roles the admin dashboard link goes through navigate(#door/inventory)', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); await e.open('i1');
  await e.act('admin');
  assert.equal(e.navs[e.navs.length - 1], '#door/inventory');
});

test('I_roles last counted is read for owner/admin only; a cleaner makes no movements query', async () => {
  const moves = [{ kind: 'reconcile', created_at: '2026-10-12T03:00:00Z' }];
  const o = await setup({ role: 'owner', client: mockClient({ catalogue: CATALOGUE, moves }) });
  await o.mount(''); await o.open('i1');
  assert.match(o.sheet(), /Last counted/); assert.match(o.sheet(), /Oct 12/);
  const q = o.client.calls.filter((c) => c[0] === 'from' && c[1] === 'inventory_stock_movements')[0][2];
  assert.deepEqual(q.eq, [['item_id', 'i1'], ['kind', 'reconcile']]);
  const c = await setup({ role: 'cleaner', client: mockClient({ catalogue: CATALOGUE, moves }) });
  await c.mount(''); await c.open('i1');
  assert.doesNotMatch(c.sheet(), /Last counted/);
  assert.equal(c.client.calls.filter((x) => x[0] === 'from' && x[1] === 'inventory_stock_movements').length, 0);
});

test('I_roles a cached list is never shown to another role', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); assert.match(e.html(), /Toilet paper/);
  e.unmount();
  // same module instance, now a cleaner whose load never answers: nothing from the owner list may appear
  const never = mockClient({ catalogue: CATALOGUE, rpc: { get_inventory_catalogue_v1: () => new Promise(() => {}) } });
  const opts = { client: never, demo: false, role: 'cleaner', sub: '', navigate() {}, toast() {}, haptic() {} };
  e.win.I_Stock.mount(e.root, opts);
  assert.doesNotMatch(e.html(), /Toilet paper/);
});
