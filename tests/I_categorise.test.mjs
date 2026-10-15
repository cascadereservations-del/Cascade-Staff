// Lane D-client-stock (s86 4.6 + 9.5): Tidy categories (rename / merge with confirm and Undo), Let Cassy choose on a new item, Sort uncategorised items (30 s throttle).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, NOW } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const raw = () => ({ items: [
  item('i1', 'Toilet paper', 4, 12, { category: 'Utility' }), item('i2', 'Bin liners', 9, 4, { category: 'Cleaning' }), item('i3', 'Mop', 2, 1, { category: 'Uncategorised' }),
  item('i4', 'Sponge', 6, 3, { category: 'Uncategorised' }), item('i5', 'Soap', 6, 3, { category: 'Bathroom & Utility' })], sourceAsOf: NOW });
const sorted = { data: { ok: true, remaining: 0, results: [{ item_id: 'i3', name: 'Mop', before: 'Uncategorised', after: 'Cleaning', confidence: 0.9 }, { item_id: 'i4', name: 'Sponge', before: 'Uncategorised', after: 'Cleaning', confidence: 0.8 }] }, error: null };
const make = (role = 'owner', o = {}) => setup({ role, client: mockClient({ catalogue: raw(), fn: { 'inventory-categorise': () => sorted, ...(o.fn || {}) }, rpc: {
  inventory_items_recategorize_v1: (a) => ({ data: { ok: true, moved: a.p_item_ids.map((id) => ({ id, before: id === 'i1' ? 'Utility' : id === 'i2' ? 'Cleaning' : 'Uncategorised' })) }, error: null }),
  inventory_item_create_v1: () => ({ data: { ok: true, item_id: 'new-1' }, error: null }), inventory_item_update_v1: () => ({ data: { ok: true }, error: null }), ...(o.rpc || {}) } }) });
const j = (x) => JSON.stringify(x);
const bar = (e) => e.undo();
const undoId = (e) => /data-id="(u\d+)"/.exec(e.undo())[1];

test('I_categorise Tidy categories is for owner and admin; it lists each category with its count', async () => {
  for (const r of ['cleaner', 'finance']) { const e = await make(r); await e.mount(''); assert.doesNotMatch(e.html(), /Tidy categories/, r); await e.act('tidy'); assert.equal(e.sheet(), '', r); }
  const e = await make('admin'); await e.mount(''); await e.act('tidy');
  assert.match(e.sheet(), /Utility<\/span><span class="s">1 item</); assert.match(e.sheet(), /Uncategorised<\/span><span class="s">2 items</);
});

test('I_categorise rename: confirm first, then inventory_items_recategorize_v1 with the ids, Undo restores each distinct before', async () => {
  const e = await make(); await e.mount(''); await e.act('tidy'); await e.act('rename', { 'data-cat': 'Utility' });
  await e.input('I_f_to', 'Bathroom'); await e.submit();
  assert.match(e.sheet(), /Rename Utility to Bathroom\?/); assert.equal(e.client.rpcCalls('inventory_items_recategorize_v1').length, 0);
  await e.submit();
  assert.equal(j(e.client.rpcCalls('inventory_items_recategorize_v1')[0][2]), j({ p_property_id: PID, p_item_ids: ['i1'], p_category: 'Bathroom' }));
  assert.match(bar(e), /Moved 1 item into Bathroom/);
  await e.act('undo', { 'data-id': undoId(e) }); await e.submit();
  assert.equal(j(e.client.rpcCalls('inventory_items_recategorize_v1')[1][2]), j({ p_property_id: PID, p_item_ids: ['i1'], p_category: 'Utility' }));
});

test('I_categorise merge: typing an existing name asks "Move N items from X into Y?", and Undo is one call per distinct before category', async () => {
  const e = await make(); await e.mount(''); await e.act('tidy'); await e.act('rename', { 'data-cat': 'Cleaning' });
  await e.input('I_f_to', 'bathroom & utility'); await e.submit();
  assert.match(e.sheet(), /Move 1 item from Cleaning into Bathroom &amp; Utility\?/);
  await e.submit();
  assert.equal(e.client.rpcCalls('inventory_items_recategorize_v1')[0][2].p_category, 'Bathroom & Utility'); // the existing spelling
  // two categories merged one after the other leave two Undo entries; a single merge of mixed befores undoes per category
  const m = await make('owner', { rpc: { inventory_items_recategorize_v1: (a) => ({ data: { ok: true, moved: [{ id: 'i1', before: 'Utility' }, { id: 'i2', before: 'Cleaning' }, { id: 'i3', before: 'Utility' }] }, error: null }) } });
  await m.mount(''); await m.act('tidy'); await m.act('rename', { 'data-cat': 'Uncategorised' }); await m.input('I_f_to', 'Bathroom'); await m.submit(); await m.submit();
  await m.act('undo', { 'data-id': undoId(m) }); await m.submit();
  const u = m.client.rpcCalls('inventory_items_recategorize_v1').slice(1).map((c) => c[2]);
  assert.equal(j(u), j([{ p_property_id: PID, p_item_ids: ['i1', 'i3'], p_category: 'Utility' }, { p_property_id: PID, p_item_ids: ['i2'], p_category: 'Cleaning' }]));
});

test('I_categorise a new item defaults to Let Cassy choose: created as Uncategorised, then inventory-categorise {item_id}; the Undo bar puts it back', async () => {
  const e = await make('owner', { fn: { 'inventory-categorise': () => ({ data: { ok: true, remaining: 0, results: [{ item_id: 'new-1', name: 'Mop', before: 'Uncategorised', after: 'Cleaning', confidence: 0.9 }] }, error: null }) } });
  await e.mount(''); await e.act('scan'); await e.input('I_f_code', '555'); await e.submit(); await e.act('scan-new');
  assert.match(e.sheet(), /<option value="__cassy" selected>Let Cassy choose/);
  await e.input('I_f_name', 'Mop'); await e.submit(); assert.match(e.sheet(), /Cassy will choose the category/); await e.submit();
  assert.equal(e.client.rpcCalls('inventory_item_create_v1')[0][2].p_item.category, 'Uncategorised');
  assert.equal(j(e.client.fnCalls('inventory-categorise')[0][2]), j({ item_id: 'new-1' }));
  assert.match(bar(e), /Cassy put Mop in Cleaning/);
  await e.act('undo', { 'data-id': undoId(e) });
  assert.match(e.sheet(), /Put Mop back in Uncategorised\?/);
  await e.submit();
  assert.equal(j(e.client.rpcCalls('inventory_item_update_v1').pop()[2]), j({ p_item_id: 'new-1', p_patch: { category: 'Uncategorised' } }));
});

test('I_categorise a chosen category is sent as it is and Cassy is not asked', async () => {
  const e = await make(); await e.mount(''); await e.act('scan'); await e.input('I_f_code', '556'); await e.submit(); await e.act('scan-new');
  await e.input('I_f_name', 'Mop'); await e.input('I_f_category', 'Cleaning'); await e.submit(); await e.submit();
  assert.equal(e.client.rpcCalls('inventory_item_create_v1')[0][2].p_item.category, 'Cleaning'); assert.equal(e.client.fnCalls('inventory-categorise').length, 0);
});

test('I_categorise probe-and-hide: a 404 from inventory-categorise hides Let Cassy choose and Sort for the visit, with no error box', async () => {
  const e = await make('owner', { fn: { 'inventory-categorise': () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 404 } } }) } });
  await e.mount(''); await e.act('scan'); await e.input('I_f_code', '557'); await e.submit(); await e.act('scan-new');
  await e.input('I_f_name', 'Mop'); await e.submit(); await e.submit();
  assert.doesNotMatch(e.html(), /role="alert"/);
  await e.act('scan'); await e.input('I_f_code', '558'); await e.submit(); await e.act('scan-new');
  assert.match(e.sheet(), /<option value="" selected>Choose one/); assert.doesNotMatch(e.sheet(), /Let Cassy choose/);
  await e.act('close'); await e.act('tidy'); assert.doesNotMatch(e.sheet(), /Sort uncategorised/);
});

test('I_categorise Sort uncategorised items: confirm, then {all:true}; the result and an Undo; asking again within 30 s is held back', async () => {
  const e = await make(); await e.mount(''); await e.act('tidy');
  assert.match(e.sheet(), /Sort uncategorised items \(2\)/);
  await e.act('sort'); assert.match(e.sheet(), /Let Cassy sort 2 items\?/); assert.equal(e.client.fnCalls('inventory-categorise').length, 0);
  await e.submit();
  assert.equal(j(e.client.fnCalls('inventory-categorise')[0][2]), j({ all: true }));
  assert.match(bar(e), /Cassy sorted 2 items/);
  await e.act('undo', { 'data-id': undoId(e) }); await e.submit();
  assert.equal(j(e.client.rpcCalls('inventory_items_recategorize_v1').pop()[2]), j({ p_property_id: PID, p_item_ids: ['i3', 'i4'], p_category: 'Uncategorised' }));
  await e.act('tidy'); await e.act('sort'); e.advance(10000); await e.submit();
  assert.match(e.sheet(), /wait half a minute/); assert.equal(e.client.fnCalls('inventory-categorise').length, 1);
  e.advance(21000); await e.submit();
  assert.equal(e.client.fnCalls('inventory-categorise').length, 2);
});

test('I_categorise nothing moved reads calmly and offers no Undo; Sort is not shown when nothing is Uncategorised or to other roles', async () => {
  const e = await make('owner', { fn: { 'inventory-categorise': () => ({ data: { ok: true, results: [], remaining: 0 }, error: null }) } });
  await e.mount(''); await e.act('tidy'); await e.act('sort'); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /Nothing was moved/); assert.equal(bar(e), '');
  const c = await make('cleaner'); await c.mount(''); assert.doesNotMatch(c.html(), /Sort uncategorised|Tidy categories/);
});

test('I_categorise r2 F8: when more items are waiting the Undo bar says so', async () => {
  const e = await make('owner', { fn: { 'inventory-categorise': () => ({ data: { ok: true, remaining: 7, results: sorted.data.results }, error: null }) } });
  await e.mount(''); await e.act('tidy'); await e.act('sort'); await e.submit();
  assert.match(bar(e), /Cassy sorted 2 items/); assert.match(bar(e), /7 more are waiting/);
});

test('I_categorise r2 F9: a sort that fails does not start the 30 second hold', async () => {
  let n = 0;
  const e = await make('owner', { fn: { 'inventory-categorise': () => (++n === 1 ? { data: null, error: { name: 'FunctionsHttpError', context: { status: 500 } } } : sorted) } });
  await e.mount(''); await e.act('tidy'); await e.act('sort'); await e.submit();
  assert.doesNotMatch(e.sheet(), /wait half a minute/);
  await e.submit();
  assert.equal(e.client.fnCalls('inventory-categorise').length, 2);
  assert.match(bar(e), /Cassy sorted 2 items/);
});

test('I_categorise r2 F11: rename also moves inactive items so they do not bring the old name back', async () => {
  const cat = raw(); cat.items.push(item('i6', 'Old plunger', 1, 0, { category: 'Utility', active: false }));
  const e = await setup({ role: 'owner', client: mockClient({ catalogue: cat, rpc: { inventory_items_recategorize_v1: (a) => ({ data: { ok: true, moved: a.p_item_ids.map((id) => ({ id, before: 'Utility' })) }, error: null }) } }) });
  await e.mount(''); await e.act('tidy'); await e.act('rename', { 'data-cat': 'Utility' }); await e.input('I_f_to', 'Bathroom'); await e.submit(); await e.submit();
  assert.equal(j(e.client.rpcCalls('inventory_items_recategorize_v1')[0][2].p_item_ids), j(['i1', 'i6']));
});
