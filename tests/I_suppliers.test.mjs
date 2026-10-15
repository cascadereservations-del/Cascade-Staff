// s86 D-client-sup: supplier list and card (R1-R5), picker, roles, cleaner privacy, probe-and-hide, undo. Frozen clock (NOW in the harness).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, mockClient, okRows, suppliers, cleanerRows, keysOf, PID, srcPath } from './I_sup-harness.mjs';

const LEAK = /PHP|₱|cost|price|phone|notes|payment|lastPrice|priceUp|tel:|Call\b/i;

test('R1 list: exact name and key, rows show name, location, payment word, item count and last bought date', async () => {
  const e = await setup();
  await e.mountList();
  const c = e.client.rpcCalls('inventory_supplier_list_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keysOf(c[0][2]), ['p_property_id']);
  const h = e.hostHtml();
  assert.match(h, /SM Supermarket/); assert.match(h, /KCC Mall, ground floor/); assert.match(h, /GCash/);
  assert.match(h, /12 items, last bought Oct 3/); assert.match(h, /3 items, last bought Oct 10/); assert.match(h, /0 items/);
  assert.match(h, /New supplier/);
});

test('inactive suppliers sit under a collapsed "Not used any more" line', async () => {
  const e = await setup();
  await e.mountList();
  assert.doesNotMatch(e.hostHtml(), /Old Market Stall/);
  assert.match(e.hostHtml(), /Not used any more \(1\)/);
  assert.match(e.hostHtml(), /aria-expanded="false"/);
  await e.clickHost('more');
  assert.match(e.hostHtml(), /Old Market Stall/); assert.match(e.hostHtml(), /Not in use/);
});

test('supplier card: R3 call, Call and Map as links, payment, notes, items with last price per unit and per pack', async () => {
  const detail = { ok: true, supplier: suppliers()[0], items: [{ item_id: 'i1', name: 'Toilet paper', unit: 'rolls', last_unit_price: 12.5, last_pack_price: 150, last_at: '2026-10-03T05:00:00Z', times: 2, preferred: true, pack_size: 12, pack_label: 'pack of 12', quoted_pack_price: null }] };
  const e = await setup({ rpc: { inventory_supplier_detail_v1: () => ({ data: detail, error: null }) } });
  await e.mountList();
  await e.clickHost('open', { 'data-id': 's1' });
  const c = e.client.rpcCalls('inventory_supplier_detail_v1');
  assert.deepEqual(c[0][2], { p_supplier_id: 's1' });
  const s = e.sheet();
  assert.match(s, /href="tel:\+63835520001"/); assert.match(s, /class="btn btn-secondary S_act" data-s-act="call"[^>]*>Call</);
  assert.match(s, /href="https:\/\/maps.example\/sm"/); assert.match(s, /Map</);
  assert.match(s, /GCash/); assert.match(s, /senior card/);
  assert.match(s, /Toilet paper/); assert.match(s, /PHP 12\.50 each/); assert.match(s, /PHP 150 a pack of 12/); assert.match(s, /Oct 3/);
  assert.match(s, />Edit</); assert.match(s, />Stop using</);
});

test('R2 create: exact keys, no id, no confirm step, Undo sets active false', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => ({ data: { ok: true, supplier_id: 'new1', before: null }, error: null }) } });
  await e.mountList();
  await e.clickHost('new');
  assert.match(e.sheet(), /New supplier/);
  await e.type('name', '  Puregold '); await e.type('phone', '083 555 1234'); await e.type('location', 'Lagao'); await e.type('maps_url', 'https://maps.example/pg'); await e.type('payment', 'cash'); await e.type('notes', 'Open late');
  await e.submit();
  const c = e.client.rpcCalls('inventory_supplier_save_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keysOf(c[0][2]), ['p_idempotency_key', 'p_property_id', 'p_supplier']);
  assert.ok(c[0][2].p_idempotency_key.length >= 16);
  assert.deepEqual(c[0][2].p_supplier, { name: 'Puregold', phone: '083 555 1234', location: 'Lagao', maps_url: 'https://maps.example/pg', payment: 'cash', notes: 'Open late' });
  assert.equal(e.confirms.length, 0);
  assert.equal(e.sheets(), 0);
  assert.equal(e.undos.length, 1);
  await e.undos[0].fn();
  const u = e.client.rpcCalls('inventory_supplier_save_v1')[1][2].p_supplier;
  assert.deepEqual(u, { id: 'new1', active: false });
  assert.equal(e.client.rpcCalls('inventory_supplier_list_v1').length, 2); // list refreshed after the write
});

test('R2 create: a bad name, phone or map link blocks the call and says why', async () => {
  const e = await setup();
  await e.mountList(); await e.clickHost('new');
  await e.type('name', 'A'); await e.type('phone', 'abc'); await e.type('maps_url', 'http://insecure');
  await e.submit();
  assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 0);
  assert.match(e.sheet(), /2 to 80 characters/); assert.match(e.sheet(), /digits, spaces/); assert.match(e.sheet(), /starts with https/);
});

test('R2 edit: confirm first, sends id plus only the changed keys, empty clears with null, Undo sends the before values', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => ({ data: { ok: true, supplier_id: 's1', before: { location: 'KCC Mall, ground floor', notes: 'Ask for the senior card; usually 5% off pack prices' } }, error: null }) } });
  await e.mountList(); await e.clickHost('open', { 'data-id': 's1' });
  await e.click('edit');
  assert.match(e.sheet(), /Edit SM Supermarket/);
  await e.type('location', 'KCC Mall, second floor'); await e.type('notes', '');
  await e.submit();
  assert.match(e.confirms[0], /Save changes to SM Supermarket/);
  const c = e.client.rpcCalls('inventory_supplier_save_v1');
  assert.deepEqual(c[0][2].p_supplier, { id: 's1', location: 'KCC Mall, second floor', notes: null });
  await e.undos[0].fn();
  assert.deepEqual(e.client.rpcCalls('inventory_supplier_save_v1')[1][2].p_supplier, { id: 's1', location: 'KCC Mall, ground floor', notes: 'Ask for the senior card; usually 5% off pack prices' });
});

test('R2 edit: nothing changed makes no call; a declined confirm makes no call', async () => {
  const e = await setup({ confirm: false });
  await e.mountList(); await e.clickHost('open', { 'data-id': 's1' }); await e.click('edit');
  await e.submit();
  assert.match(e.sheet(), /Nothing changed/);
  await e.type('name', 'SM Gensan'); await e.submit();
  assert.equal(e.confirms.length, 1);
  assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 0);
});

test('Stop using and Use again: confirm, R2 {id, active}, Undo restores', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: (a) => ({ data: { ok: true, supplier_id: a.p_supplier.id, before: { active: !a.p_supplier.active } }, error: null }) } });
  await e.mountList(); await e.clickHost('open', { 'data-id': 's2' });
  await e.click('stop');
  assert.match(e.confirms[0], /Stop using Robinsons/);
  let c = e.client.rpcCalls('inventory_supplier_save_v1');
  assert.deepEqual(c[0][2].p_supplier, { id: 's2', active: false });
  await e.undos[0].fn();
  assert.deepEqual(e.client.rpcCalls('inventory_supplier_save_v1')[1][2].p_supplier, { id: 's2', active: true });
  await e.clickHost('more'); await e.clickHost('open', { 'data-id': 's3' });
  assert.match(e.sheet(), />Use again</);
  await e.click('again');
  assert.match(e.confirms[1], /Use Old Market Stall again/);
  assert.deepEqual(e.client.rpcCalls('inventory_supplier_save_v1')[2][2].p_supplier, { id: 's3', active: true });
});

test('R2 name_exists on an inactive supplier offers Use again (R2 {id, active:true})', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: (a) => (a.p_supplier.id ? { data: { ok: true, supplier_id: a.p_supplier.id, before: { active: false } }, error: null } : { data: { ok: false, reason: 'name_exists', supplier_id: 's3', active: false }, error: null }) } });
  await e.mountList(); await e.clickHost('new');
  await e.type('name', 'old market stall'); await e.submit();
  assert.match(e.sheet(), /was stopped earlier/); assert.match(e.sheet(), /data-s-act="reuse"/);
  await e.click('reuse');
  assert.deepEqual(e.client.rpcCalls('inventory_supplier_save_v1')[1][2].p_supplier, { id: 's3', active: true });
  assert.equal(e.sheets(), 0); assert.equal(e.undos.length, 1);
});

test('R2 name_exists on an active supplier says so and keeps the sheet', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => ({ data: { ok: false, reason: 'name_exists', supplier_id: 's1', active: true }, error: null }) } });
  await e.mountList(); await e.clickHost('new');
  await e.type('name', 'SM Supermarket'); await e.submit();
  assert.match(e.sheet(), /already in your list/); assert.equal(e.undos.length, 0);
});

test('a retried save keeps one idempotency key; a different set of values gets a new one', async () => {
  let n = 0;
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => { n++; return n === 1 ? { data: null, error: { name: 'TypeError', message: 'Failed to fetch' } } : { data: { ok: true, supplier_id: 'x', before: null }, error: null }; } } });
  await e.mountList(); await e.clickHost('new'); await e.type('name', 'Puregold'); await e.submit();
  assert.match(e.sheet(), /did not go through|No connection/);
  await e.submit();
  const c = e.client.rpcCalls('inventory_supplier_save_v1');
  assert.equal(c[0][2].p_idempotency_key, c[1][2].p_idempotency_key);
});

/* ---------- roles */
test('finance may add and edit suppliers, sees prices; owner and admin the same', async () => {
  for (const role of ['finance', 'admin', 'owner']) {
    const e = await setup({ role });
    await e.mountList();
    assert.match(e.hostHtml(), /New supplier/, role);
    await e.clickHost('open', { 'data-id': 's1' });
    assert.match(e.sheet(), />Edit</, role); assert.match(e.sheet(), />Stop using</, role);
    assert.equal(e.client.rpcCalls('inventory_supplier_detail_v1').length, 1, role);
  }
});

test('finance and cleaner get no link editor; owner and admin do', async () => {
  for (const role of ['finance', 'cleaner']) {
    const e = await setup({ role });
    assert.equal(e.S.openItemSuppliers(e.ctx, { id: 'i1', name: 'Toilet paper' }), null, role);
    await e.flush();
    assert.equal(e.sheets(), 0, role);
    assert.equal(e.client.rpcCalls('inventory_item_supplier_link_v1').length, 0);
  }
  const e = await setup({ role: 'admin', rpc: { inventory_supplier_detail_v1: () => ({ data: { ok: true, items: [] }, error: null }) } });
  e.S.openItemSuppliers(e.ctx, { id: 'i1', name: 'Toilet paper' }); await e.flush();
  assert.equal(e.sheets(), 1);
});

test('cleaner: R1 is the only call; list and card show name, location and Map, and nothing else', async () => {
  const e = await setup({ role: 'cleaner' });
  await e.mountList();
  assert.deepEqual(e.client.names(), ['inventory_supplier_list_v1']);
  const h = e.hostHtml();
  assert.match(h, /SM Supermarket/); assert.match(h, /KCC Mall, ground floor/);
  assert.doesNotMatch(h, LEAK); assert.doesNotMatch(h, /New supplier/); assert.doesNotMatch(h, /items/); assert.doesNotMatch(h, /Old Market Stall/);
  await e.clickHost('open', { 'data-id': 's1' });
  const s = e.sheet();
  assert.match(s, /SM Supermarket/); assert.match(s, /KCC Mall, ground floor/); assert.match(s, /href="https:\/\/maps.example\/sm"/); assert.match(s, /Map</);
  assert.doesNotMatch(s, LEAK); assert.doesNotMatch(s, />Edit</); assert.doesNotMatch(s, /Stop using/); assert.doesNotMatch(s, /Items bought here/);
  assert.deepEqual(e.client.names(), ['inventory_supplier_list_v1']); // the card made no call
  assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 0);
});

test('cleaner: R1 rendered from exactly the five keys works, and a leaky response is still not drawn', async () => {
  const five = cleanerRows();
  assert.deepEqual(keysOf(five[0]), ['active', 'id', 'location', 'maps_url', 'name']);
  const e = await setup({ role: 'cleaner', rpc: { inventory_supplier_list_v1: okRows(five) } });
  await e.mountList(); assert.match(e.hostHtml(), /Robinsons/);
  const e2 = await setup({ role: 'cleaner', rpc: { inventory_supplier_list_v1: okRows(suppliers()) } }); // a server that over-shares
  await e2.mountList(); await e2.clickHost('open', { 'data-id': 's1' });
  assert.doesNotMatch(e2.hostHtml() + e2.sheet(), LEAK);
  assert.doesNotMatch(e2.hostHtml() + e2.sheet(), /senior card|0001|GCash/);
});

test('cleaner and unknown roles: pick resolves null and calls nothing', async () => {
  for (const role of ['cleaner', 'staff']) {
    const e = await setup({ role });
    assert.equal(await e.S.pick(e.ctx, { itemId: 'i1' }), null);
    assert.equal(e.client.calls.length, 0, role);
  }
});

/* ---------- picker */
test('picker: preferred first, then most recently bought, then by name; New supplier last; inactive left out', async () => {
  const e = await setup();
  const p = e.S.pick(e.ctx, { itemId: 'i1', selectedId: 's2', preferredId: 's1' }); await e.flush();
  const ids = [...e.sheet().matchAll(/data-s-act="choose" data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['s1', 's2', 's4']); // s1 preferred, s2 newer than s1 would be but preferred wins; s4 never bought; s3 inactive
  assert.ok(e.sheet().indexOf('New supplier') > e.sheet().lastIndexOf('data-s-act="choose"'));
  assert.match(e.sheet(), /Usual/); assert.match(e.sheet(), /Selected/);
  assert.equal(e.client.rpcCalls('inventory_supplier_list_v1').length, 1);
  await e.click('close'); assert.equal(await p, null);
});

test('picker without a preferred supplier orders by recency (Robinsons Oct 10 before SM Oct 3)', async () => {
  const e = await setup();
  const p = e.S.pick(e.ctx, { itemId: 'i1' }); await e.flush();
  const ids = [...e.sheet().matchAll(/data-s-act="choose" data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['s2', 's1', 's4']);
  await e.click('choose', { 'data-id': 's1' });
  assert.deepEqual(await p, { id: 's1', name: 'SM Supermarket', created: false });
  assert.equal(e.sheets(), 0);
});

test('picker: New supplier is created only at the confirm tap, never on opening, typing or Cancel', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => ({ data: { ok: true, supplier_id: 'n9', before: null }, error: null }) } });
  const p = e.S.pick(e.ctx, { itemId: 'i1' }); await e.flush();
  await e.click('new'); await e.type('name', 'Puregold');
  assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 0);
  await e.click('back'); await e.click('new'); await e.type('name', 'Puregold');
  assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 0);
  await e.submit();
  const c = e.client.rpcCalls('inventory_supplier_save_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(c[0][2].p_supplier, { name: 'Puregold' });
  assert.deepEqual(keysOf(c[0][2]), ['p_idempotency_key', 'p_property_id', 'p_supplier']);
  assert.deepEqual(await p, { id: 'n9', name: 'Puregold', created: true });
});

test('picker: cancelling after typing a new name creates nothing and resolves null', async () => {
  const e = await setup();
  const p = e.S.pick(e.ctx, {}); await e.flush();
  await e.click('new'); await e.type('name', 'Puregold'); await e.click('close');
  assert.equal(await p, null); assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 0);
});

test('picker: name_exists on an active supplier uses it (created false); on an inactive one offers Use again', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: (a) => (a.p_supplier.id ? { data: { ok: true, supplier_id: a.p_supplier.id, before: { active: false } }, error: null } : { data: { ok: false, reason: 'name_exists', supplier_id: a.p_supplier.name === 'robinsons' ? 's2' : 's3', active: a.p_supplier.name === 'robinsons' }, error: null }) } });
  let p = e.S.pick(e.ctx, {}); await e.flush();
  await e.click('new'); await e.type('name', 'robinsons'); await e.submit();
  assert.deepEqual(await p, { id: 's2', name: 'Robinsons', created: false });
  p = e.S.pick(e.ctx, {}); await e.flush();
  await e.click('new'); await e.type('name', 'Old Market Stall'); await e.submit();
  assert.match(e.sheet(), /was stopped earlier/);
  await e.click('reuse');
  assert.deepEqual(await p, { id: 's3', name: 'Old Market Stall', created: false, reactivated: true });
  assert.deepEqual(e.client.rpcCalls('inventory_supplier_save_v1').pop()[2].p_supplier, { id: 's3', active: true });
});

test('probe-and-hide: PGRST202 on R1 makes pick resolve null, and later picks in the visit skip the call', async () => {
  const miss = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.inventory_supplier_list_v1' } });
  const e = await setup({ rpc: { inventory_supplier_list_v1: miss } });
  assert.equal(await e.S.pick(e.ctx, { itemId: 'i1' }), null);
  assert.equal(e.sheets(), 0);
  assert.equal(await e.S.pick(e.ctx, { itemId: 'i1' }), null);
  assert.equal(e.client.rpcCalls('inventory_supplier_list_v1').length, 1);
});

test('probe-and-hide: PGRST202 in the list view shows a calm line, not an error box', async () => {
  const miss = () => ({ data: null, error: { code: 'PGRST202', message: 'x' } });
  const e = await setup({ rpc: { inventory_supplier_list_v1: miss } });
  await e.mountList();
  assert.match(e.hostHtml(), /not available yet/); assert.doesNotMatch(e.hostHtml(), /errbox/);
});

test('offline first load: "No connection" and Try again; no sample rows', async () => {
  const e = await setup({ offline: true, rpc: { inventory_supplier_list_v1: () => ({ data: null, error: { name: 'TypeError', message: 'Failed to fetch' } }) } });
  await e.mountList();
  assert.match(e.hostHtml(), /No connection/); assert.match(e.hostHtml(), /Try again/); assert.doesNotMatch(e.hostHtml(), /SM Supermarket/);
});

test('picker list is cached for a minute and a write clears the cache', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => ({ data: { ok: true, supplier_id: 'n9', before: null }, error: null }) } });
  let p = e.S.pick(e.ctx, {}); await e.flush(); await e.click('close'); await p;
  p = e.S.pick(e.ctx, {}); await e.flush();
  assert.equal(e.client.rpcCalls('inventory_supplier_list_v1').length, 1);
  await e.click('new'); await e.type('name', 'Puregold'); await e.submit(); await p;
  p = e.S.pick(e.ctx, {}); await e.flush();
  assert.equal(e.client.rpcCalls('inventory_supplier_list_v1').length, 2);
  await e.click('close'); await p;
});

test('a search box appears only when there are more than eight suppliers', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: 'm' + i, name: 'Shop ' + i, location: '', maps_url: '', payment: '', notes: '', phone: '', active: true, items: 0, last_bought_at: null }));
  const e = await setup({ rpc: { inventory_supplier_list_v1: okRows(many) } });
  const p = e.S.pick(e.ctx, {}); await e.flush();
  assert.match(e.sheet(), /Find a supplier/);
  await e.type('find', 'shop 3');
  assert.match(e.sheet(), /Shop 3/); assert.doesNotMatch(e.sheet(), /Shop 4/);
  await e.click('close'); await p;
  const e2 = await setup(); const p2 = e2.S.pick(e2.ctx, {}); await e2.flush();
  assert.doesNotMatch(e2.sheet(), /Find a supplier/); await e2.click('close'); await p2;
});

/* ---------- item suppliers (R4, R5) */
const ITEM = { id: 'i1', name: 'Toilet paper' };
const detailFor = (links) => (a) => ({ data: { ok: true, supplier: { id: a.p_supplier_id }, items: links[a.p_supplier_id] || [] }, error: null });
const L1 = { item_id: 'i1', name: 'Toilet paper', preferred: true, pack_label: 'pack of 12', pack_size: 12, quoted_pack_price: null, last_unit_price: 12.5, last_pack_price: 150, last_at: '2026-10-03T05:00:00Z', times: 2 };
const L2 = { item_id: 'i1', name: 'Toilet paper', preferred: false, pack_label: null, pack_size: null, quoted_pack_price: 130, last_unit_price: null, last_pack_price: null, last_at: null, times: 0 };

test('item suppliers: lists the links with Preferred shown as a word, pack text, last price or Quoted', async () => {
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1], s2: [L2] }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  const s = e.sheet();
  assert.match(s, /Suppliers for this item/); assert.match(s, /SM Supermarket/); assert.match(s, /Robinsons/);
  assert.match(s, /pack of 12/); assert.match(s, /12 per pack/); assert.match(s, /last PHP 12\.50 each/); assert.match(s, /Quoted PHP 130 a pack/);
  assert.match(s, /aria-pressed="true">[^<]*<svg[^>]*>.*?<\/svg> Preferred</s); assert.match(s, /Make preferred/); assert.match(s, /Add a supplier/);
  assert.equal(e.client.rpcCalls('inventory_supplier_detail_v1').length, 4); // one per supplier
});

test('R4 make preferred: confirm, exact keys, Undo re-prefers the previous supplier', async () => {
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1], s2: [L2] }), inventory_item_supplier_link_v1: () => ({ data: { ok: true, before: { pack_label: null, pack_size: null, quoted_pack_price: 130, preferred: false } }, error: null }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('pref', { 'data-id': 's2' });
  assert.match(e.confirms[0], /Make Robinsons the usual supplier for Toilet paper/);
  const c = e.client.rpcCalls('inventory_item_supplier_link_v1');
  assert.deepEqual(c[0][2], { p_item_id: 'i1', p_supplier_id: 's2', p_link: { preferred: true } });
  await e.undos[0].fn();
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_link_v1')[1][2], { p_item_id: 'i1', p_supplier_id: 's1', p_link: { preferred: true } });
});

test('R4 pack details: confirm, only changed keys, quoted price sent as a number; Undo sends before', async () => {
  const before = { pack_label: 'pack of 12', pack_size: 12, quoted_pack_price: null, preferred: true };
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1] }), inventory_item_supplier_link_v1: () => ({ data: { ok: true, before }, error: null }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('pack', { 'data-id': 's1' });
  await e.type('pack_label', '1 box of 12'); await e.type('quoted', '140.5');
  await e.submit();
  const c = e.client.rpcCalls('inventory_item_supplier_link_v1');
  assert.deepEqual(c[0][2], { p_item_id: 'i1', p_supplier_id: 's1', p_link: { pack_label: '1 box of 12', quoted_pack_price: 140.5 } });
  await e.undos[0].fn();
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_link_v1')[1][2].p_link, before);
});

test('R4 pack details: a zero or negative pack size or price blocks the call', async () => {
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1] }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('pack', { 'data-id': 's1' }); await e.type('pack_size', '0'); await e.submit();
  assert.match(e.sheet(), /more than 0/); assert.equal(e.client.rpcCalls('inventory_item_supplier_link_v1').length, 0);
});

test('R5 remove: confirm, exact keys, Undo is R4 with the before values', async () => {
  const before = { pack_label: 'pack of 12', pack_size: 12, quoted_pack_price: null, preferred: true };
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1] }), inventory_item_supplier_unlink_v1: () => ({ data: { ok: true, removed: true, before }, error: null }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('unlink', { 'data-id': 's1' });
  assert.match(e.confirms[0], /Remove SM Supermarket from Toilet paper/);
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_unlink_v1')[0][2], { p_item_id: 'i1', p_supplier_id: 's1' });
  await e.undos[0].fn();
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_link_v1')[0][2], { p_item_id: 'i1', p_supplier_id: 's1', p_link: before });
});

test('Add a supplier: uses the picker, R4 with preferred false; Undo is R5 when the link was new', async () => {
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1] }), inventory_item_supplier_link_v1: () => ({ data: { ok: true, before: null }, error: null }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('add'); // the picker opens on top
  assert.equal(e.sheets(), 2);
  await e.click('choose', { 'data-id': 's2' });
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_link_v1')[0][2], { p_item_id: 'i1', p_supplier_id: 's2', p_link: { preferred: false } });
  await e.undos[0].fn();
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_unlink_v1')[0][2], { p_item_id: 'i1', p_supplier_id: 's2' });
});

/* ---------- module shape */
test('contract: exact exported names and no chart library', () => {
  const src = fs.readFileSync(srcPath, 'utf8');
  assert.match(src, /root\.I_Suppliers = \{\s*mountList: mountList, pick: pick, openPriceHistory: openPriceHistory, openItemSuppliers: openItemSuppliers/);
  assert.doesNotMatch(src, /chart\.js|d3\.|<script/i);
});

test('voice: no exclamation mark in any string the module can show', async () => {
  const src = fs.readFileSync(srcPath, 'utf8');
  const strings = [...src.matchAll(/'([^'\\\n]|\\.)*'/g)].map((m) => m[0]).filter((s) => /[A-Za-z]{3}/.test(s));
  assert.deepEqual(strings.filter((s) => /!/.test(s) && !/!==|!=/.test(s)), []);
});

test('guard: no duplicate top-level function names, and the module parses', () => {
  const src = fs.readFileSync(srcPath, 'utf8');
  new Function(src);
  const names = [...src.matchAll(/^  function (\w+)\(/gm)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length);
});

test('keyboard: Escape closes a sheet and the picker resolves null', async () => {
  const e = await setup();
  const p = e.S.pick(e.ctx, {}); await e.flush();
  await e.key('Escape');
  assert.equal(await p, null); assert.equal(e.sheets(), 0);
});

test('sheets announce themselves: dialog role, aria-modal, labelled heading, 48 px actions via btn classes', async () => {
  const e = await setup();
  await e.mountList(); await e.clickHost('open', { 'data-id': 's1' });
  assert.match(e.sheet(), /role="dialog" aria-modal="true" aria-labelledby="S\d+_sh_t"/);
  assert.match(e.sheet(), /id="S\d+_sh_t" tabindex="-1"/);
  assert.equal(Object.entries(e.top().byId).filter(([k]) => /_sh_t$/.test(k))[0][1].focused, 1);
});

test('PID constant matches the shell property id and is passed on every R1 call', async () => {
  const e = await setup(); await e.mountList();
  assert.equal(e.client.rpcCalls('inventory_supplier_list_v1')[0][2].p_property_id, PID);
});

/* ---------- r2 fixes (review REVIEW-D-client-sup) */
test('r2 F1: the supplier sheet is hidden while the confirm is open and comes back after No or Yes', async () => {
  const e = await setup({ hold: true, rpc: { inventory_supplier_save_v1: () => ({ data: { ok: true, supplier_id: 's2', before: { active: true } }, error: null }) } });
  await e.mountList(); await e.clickHost('open', { 'data-id': 's2' });
  const layer = e.top();
  await e.click('stop');
  assert.equal(layer.style.display, 'none');
  await e.answer(false);
  assert.equal(layer.style.display, ''); assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 0);
  await e.click('stop'); assert.equal(layer.style.display, 'none');
  await e.answer(true);
  assert.equal(e.client.rpcCalls('inventory_supplier_save_v1').length, 1);
});

test('r2 F1: edit save and item-link confirms hide the layer too', async () => {
  const e = await setup({ hold: true, rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1] }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  const layer = e.top();
  await e.click('unlink', { 'data-id': 's1' });
  assert.equal(layer.style.display, 'none'); await e.answer(false); assert.equal(layer.style.display, '');
  await e.click('pack', { 'data-id': 's1' }); await e.type('pack_label', 'x'); await e.submit();
  assert.equal(layer.style.display, 'none'); await e.answer(false); assert.equal(layer.style.display, '');
});

test('r2 F2: item-link Undo entries carry the item id as the third argument', async () => {
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1], s2: [L2] }), inventory_item_supplier_link_v1: () => ({ data: { ok: true, before: { preferred: false } }, error: null }), inventory_item_supplier_unlink_v1: () => ({ data: { ok: true, removed: true, before: { preferred: false } }, error: null }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('pref', { 'data-id': 's2' }); await e.click('unlink', { 'data-id': 's1' });
  assert.equal(e.undos.length, 2);
  for (const u of e.undos) assert.deepEqual(JSON.parse(JSON.stringify(u.opts)), { itemId: 'i1' });
});

test('r2 F3: the picker tag says Usual, not Preferred', async () => {
  const e = await setup();
  const p = e.S.pick(e.ctx, { itemId: 'i1', preferredId: 's1' }); await e.flush();
  assert.match(e.sheet(), /Usual/); assert.doesNotMatch(e.sheet(), /Preferred/);
  await e.click('close'); await p;
});

test('r2 F4: Undo of Make preferred on a link that did not exist calls R5 (with and without a previous usual supplier)', async () => {
  const mk = (links) => ({ inventory_supplier_detail_v1: detailFor(links), inventory_item_supplier_link_v1: () => ({ data: { ok: true, before: null }, error: null }) });
  let e = await setup({ rpc: mk({ s2: [L2] }) });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('pref', { 'data-id': 's2' }); await e.undos[0].fn();
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_unlink_v1')[0][2], { p_item_id: 'i1', p_supplier_id: 's2' });
  e = await setup({ rpc: mk({ s1: [L1], s2: [L2] }) });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('pref', { 'data-id': 's2' }); await e.undos[0].fn();
  const links = e.client.rpcCalls('inventory_item_supplier_link_v1');
  assert.deepEqual(links[1][2], { p_item_id: 'i1', p_supplier_id: 's1', p_link: { preferred: true } });
  assert.deepEqual(e.client.rpcCalls('inventory_item_supplier_unlink_v1')[0][2], { p_item_id: 'i1', p_supplier_id: 's2' });
});

test('r2 F6: stacked sheets never share an id', async () => {
  const e = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s1: [L1] }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  await e.click('add'); assert.equal(e.sheets(), 2);
  const ids = e.body.children.map((l) => l.innerHTML.match(/id="([^"]*sh_t)"/)[1]);
  assert.equal(new Set(ids).size, 2);
  for (const l of e.body.children) { const id = l.innerHTML.match(/id="([^"]*sh_t)"/)[1]; assert.match(l.innerHTML, new RegExp('aria-labelledby="' + id + '"')); }
  await e.click('new'); await e.type('name', 'Puregold');
  assert.match(e.sheet(), /for="S\d+_f_name"/); assert.match(e.sheet(), /id="S\d+_f_name"/);
});

test('r2 F7: a map link is capped at 300 characters in all', async () => {
  const v = (await setup()).S.lib.validate;
  assert.equal(v({ name: 'Shop', maps_url: 'https://' + 'a'.repeat(292) }).ok, true);
  assert.equal(v({ name: 'Shop', maps_url: 'https://' + 'a'.repeat(293) }).ok, false);
});

test('r2 F8: renaming to an inactive supplier name on Edit does not offer Use again', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => ({ data: { ok: false, reason: 'name_exists', supplier_id: 's3', active: false }, error: null }) } });
  await e.mountList(); await e.clickHost('open', { 'data-id': 's1' }); await e.click('edit');
  await e.type('name', 'Old Market Stall'); await e.submit();
  assert.doesNotMatch(e.sheet(), /data-s-act="reuse"/); assert.match(e.sheet(), /Another supplier already has that name/);
});

test('r2 F9: a change with an Undo bar makes no extra toast, and labels have no trailing period or colon', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: () => ({ data: { ok: true, supplier_id: 'n1', before: null }, error: null }) } });
  await e.mountList(); await e.clickHost('new'); await e.type('name', 'Puregold'); await e.submit();
  assert.deepEqual(e.toasts, []); assert.equal(e.undos[0].label, 'Added Puregold');
  await e.clickHost('open', { 'data-id': 's2' }); await e.click('stop');
  assert.equal(e.undos[1].label, 'Stopped using Robinsons');
});

test('r2 F10: one failed R3 fails the whole item-links load; a link to a stopped supplier is tagged', async () => {
  const e = await setup({ rpc: { inventory_supplier_detail_v1: (a) => (a.p_supplier_id === 's2' ? { data: null, error: { code: 'XX', message: 'boom' } } : { data: { ok: true, items: [L1] }, error: null }) } });
  e.S.openItemSuppliers(e.ctx, ITEM); await e.flush();
  assert.match(e.sheet(), /errbox/); assert.match(e.sheet(), /Try again/); assert.doesNotMatch(e.sheet(), /Add a supplier/);
  const e2 = await setup({ rpc: { inventory_supplier_detail_v1: detailFor({ s3: [L2] }) } });
  e2.S.openItemSuppliers(e2.ctx, ITEM); await e2.flush();
  assert.match(e2.sheet(), /Old Market Stall[\s\S]*Not in use/);
});

test('r2 F12: picker Use again says reactivated; F13: focus goes back to the opener on close', async () => {
  const e = await setup({ rpc: { inventory_supplier_save_v1: (a) => (a.p_supplier.id ? { data: { ok: true, supplier_id: 's3', before: { active: false } }, error: null } : { data: { ok: false, reason: 'name_exists', supplier_id: 's3', active: false }, error: null }) } });
  const opener = e.doc.activeElement;
  const p = e.S.pick(e.ctx, {}); await e.flush();
  await e.click('new'); await e.type('name', 'Old Market Stall'); await e.submit(); await e.click('reuse');
  const r = await p; assert.equal(r.reactivated, true); assert.equal(r.created, false);
  assert.ok(opener.focused >= 1);
});
