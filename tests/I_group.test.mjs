// Lane I (s84): Low first keeps the category groups. groupsFor() is pure; the list draws one header per non-empty group.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';
const eq = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b); // arrays from the module's realm

const raw = [
  item('k1', 'Dish soap', 5, 2, { category: 'Kitchen' }),
  item('b1', 'Shampoo', 9, 4, { category: 'Bath' }),
  item('b2', 'Toilet paper', 2, 6, { category: 'Bath' }), // low
  item('b3', 'Hand soap', 0, 3, { category: 'Bath' }), // out
  item('l1', 'Sheets', 2, 4, { category: 'Linen', consumable: false }), // low
  item('l2', 'Pillow cases', 1, 4, { category: 'Linen', consumable: false }), // low
  item('z1', 'Candles', 8, 2, { category: 'Zed' })
];

async function lib() { return (await setup({ role: 'owner' })).lib; }
const norm = (L, role = 'owner') => raw.map((r) => L.normalize(r, role));

test('I_group Low first: the group with an Out leads, then Low groups by how many are low, then all-OK groups by name', async () => {
  const L = await lib();
  const g = L.groupsFor(norm(L), 'first', '');
  eq(g.map((x) => x.cat), ['Bath', 'Linen', 'Kitchen', 'Zed']);
  eq([g[0].out, g[0].low, g[1].out, g[1].low], [1, 1, 0, 2]);
});

test('I_group inside a group: Out, then Low, then OK, then name; the lowest item leads', async () => {
  const L = await lib();
  const bath = L.groupsFor(norm(L), 'first', '')[0];
  eq(bath.rows.map((r) => r.name), ['Hand soap', 'Toilet paper', 'Shampoo']);
});

test('I_group more Out+Low wins between two Low-only groups, then the name', async () => {
  const L = await lib();
  const more = norm(L).concat([L.normalize(item('m1', 'Mop', 1, 3, { category: 'Cleaning' }), 'owner')]);
  const g = L.groupsFor(more, 'first', '');
  eq(g.map((x) => x.cat).slice(0, 3), ['Bath', 'Linen', 'Cleaning']);
});

test('I_group search drops groups with no matching rows', async () => {
  const L = await lib();
  const g = L.groupsFor(norm(L), 'first', 'soap');
  eq(g.map((x) => x.cat), ['Bath', 'Kitchen']);
  eq(g[0].rows.map((r) => r.name), ['Hand soap']);
  eq(L.groupsFor(norm(L), 'first', 'nothing here'), []);
});

test('I_group All and Consumables: consumable groups first (s132 update order), rows by name', async () => {
  const L = await lib();
  const all = L.groupsFor(norm(L), 'all', '');
  eq(all.map((x) => x.cat), ['Bath', 'Kitchen', 'Zed', 'Linen']); // s132: Linen is lasting, so after the consumable groups
  eq(all[0].rows.map((r) => r.name), ['Hand soap', 'Shampoo', 'Toilet paper']);
  const cons = L.groupsFor(norm(L), 'cons', '');
  eq(cons.map((x) => x.cat), ['Bath', 'Kitchen', 'Zed']); // Linen is not consumable
});

test('I_group Consumables: rows by name inside each group, not by level (SPEC 5.1)', async () => {
  const L = await lib();
  const g = L.groupsFor(norm(L), 'cons', '');
  eq(g[0].rows.map((r) => r.name), ['Hand soap', 'Shampoo', 'Toilet paper']); // Out, OK, Low by level would be Hand soap, Toilet paper, Shampoo
});

test('I_group a category chip is one group', async () => {
  const L = await lib();
  const g = L.groupsFor(norm(L), 'c:Linen', '');
  assert.equal(g.length, 1); assert.equal(g[0].cat, 'Linen');
});

test('I_group the list draws one header per non-empty category with the count in glyph and words', async () => {
  const e = await setup({ role: 'owner', client: mockClient({ catalogue: { items: raw } }) });
  await e.mount('');
  const h = e.html();
  const heads = [...h.matchAll(/class="I_gh"/g)].length;
  assert.equal(heads, 4);
  // each level is counted once, in glyph and word: one Out and one Low is "1 out, 1 low", never "2 low, 1 out"
  assert.match(h, /Bath<\/span><span class="I_ghn"><svg[^>]*>.*?<\/svg> 1 out, <svg[^>]*>.*?<\/svg> 1 low</);
  assert.match(h, /Linen<\/span><span class="I_ghn"><svg[^>]*>.*?<\/svg> 2 low</);
  assert.doesNotMatch(h, /2 low, 1 out/);
  assert.ok(h.indexOf('<span>Bath</span>') < h.indexOf('<span>Linen</span>') && h.indexOf('<span>Linen</span>') < h.indexOf('<span>Kitchen</span>'));
  assert.doesNotMatch(h.slice(h.indexOf('<span>Zed</span>'), h.indexOf('<span>Zed</span>') + 40), /I_ghn/); // an all-OK group has no note
  await e.act('chip', { 'data-k': 'c:Linen' });
  assert.equal([...e.html().matchAll(/class="I_gh"/g)].length, 0);
  await e.act('chip', { 'data-k': 'all' });
  assert.equal([...e.html().matchAll(/class="I_gh"/g)].length, 4);
  assert.ok(e.html().indexOf('<span>Bath</span>') < e.html().indexOf('<span>Kitchen</span>'));
});

test('I_group the cleaner gets the same groups (a layout, not a privilege)', async () => {
  const e = await setup({ role: 'cleaner', client: mockClient({ catalogue: { items: raw } }) });
  await e.mount('');
  assert.equal([...e.html().matchAll(/class="I_gh"/g)].length, 4);
});

test('s132 I_group All: consumable groups first, then update order, slowest last; unknown groups after their kind by name', async () => {
  const L = await lib();
  const mk = (id, cat, cons) => L.normalize(item(id, id, 3, 1, { category: cat, consumable: cons }), 'owner');
  const items = [mk('a', 'Living Area', false), mk('b', 'Appliances', false), mk('c', 'Kitchen utensils', false), mk('d', 'Linen', false),
    mk('e', 'Kitchen supplies', true), mk('f', 'Toiletries', true), mk('g', 'Cleaning Supplies', true), mk('h', 'Zed lasting', false), mk('i', 'Aaa used', true),
    mk('j', 'Bedroom / Sleeping Area', false), mk('k', 'Bathroom & Utility', false)];
  const want = ['Toiletries', 'Cleaning Supplies', 'Kitchen supplies', 'Aaa used', 'Linen', 'Kitchen utensils', 'Bathroom & Utility', 'Bedroom / Sleeping Area', 'Appliances', 'Living Area', 'Zed lasting'];
  eq(L.groupsFor(items, 'all', '').map((x) => x.cat), want);
  eq(L.chipsFor(items, 0).filter((c) => c.k.indexOf('c:') === 0).map((c) => c.t), want);
});

test('s132 I_group a mostly-lasting group stays with the lasting groups even with one consumable in it', async () => {
  const L = await lib();
  const mk = (id, cat, cons) => L.normalize(item(id, id, 3, 1, { category: cat, consumable: cons }), 'owner');
  const items = [mk('a', 'Kitchen utensils', false), mk('b', 'Kitchen utensils', false), mk('c', 'Kitchen utensils', true), mk('d', 'Living Area', false), mk('e', 'Toiletries', true)];
  eq(L.groupsFor(items, 'all', '').map((x) => x.cat), ['Toiletries', 'Kitchen utensils', 'Living Area']);
});
