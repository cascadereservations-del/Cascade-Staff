// Lane D-client-stock (s86 4.3 + 4.0): Bought and Stock received pick a supplier through I_Suppliers.pick; the old text box stays when I_suppliers.js is missing
// or when pick resolves null. The module is loaded once, hidden for the visit when it 404s. confirm and undo are this module's own primitives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { codes: [] }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', purchaseUnit: null, unitsPerPurchase: 1, codes: [] })] });
const SHOP = [
  { id: 's1', item_id: 'i1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-12T02:00:00Z' },
  { id: 's2', item_id: 'i2', item_name: 'Hand soap', quantity: 3, purchase_unit: null, reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z' }
];
let n = 0;
const recv = () => ({ data: { ok: true, purchaseId: 'p' + (++n), movementId: 'm' + n, unitsAdded: 1 }, error: null });
const j = (x) => JSON.stringify(x);
const stub = (result, log = []) => ({ pick: async (ctx, o) => { log.push([ctx, o]); return result; }, mountList() {}, openPriceHistory() {}, openItemSuppliers() {} });
const make = (o = {}) => setup({ role: o.role || 'owner', doc: o.doc || {}, ...(o.sup ? { suppliers: o.sup } : {}), client: mockClient({ catalogue: raw(), shop: SHOP, rpc: { record_inventory_receipt_v1: recv, inventory_supplier_save_v1: () => ({ data: { ok: true }, error: null }), ...(o.rpc || {}) } }) });
const rcpts = (e) => e.client.rpcCalls('record_inventory_receipt_v1');

test('I_bought-supplier Stock received: a Supplier button first; the pick sends p_supplier_id and the name in p_supplier', async () => {
  const log = [];
  const e = await make({ sup: stub({ id: 'sup-1', name: 'SM Savemore', created: false }, log) });
  await e.mount(''); await e.open('i1'); await e.begin('recv');
  assert.match(e.sheet(), /data-act="pick-sup"/); assert.doesNotMatch(e.sheet(), /id="I_f_supplier"/);
  assert.ok(e.sheet().indexOf('pick-sup') < e.sheet().indexOf('I_f_packs'));
  await e.act('pick-sup');
  assert.equal(j(log[0][1]), j({ itemId: 'i1', preferredId: null, selectedId: null }));
  assert.match(e.sheet(), /SM Savemore/);
  await e.submit(); assert.match(e.sheet(), /from SM Savemore/); await e.submit();
  const a = rcpts(e)[0][2];
  assert.equal(a.p_supplier_id, 'sup-1'); assert.equal(a.p_supplier, 'SM Savemore');
});

test('I_bought-supplier the ctx handed to pick holds the contract keys', async () => {
  const log = [];
  const e = await make({ sup: stub({ id: 'sup-1', name: 'SM', created: false }, log) });
  await e.mount(''); await e.open('i1'); await e.begin('recv'); await e.act('pick-sup');
  const ctx = log[0][0];
  assert.equal(j(Object.keys(ctx).sort()), j(['client', 'confirm', 'esc', 'haptic', 'nowMs', 'propertyId', 'role', 'toast', 'undo']));
  assert.equal(ctx.role, 'owner'); assert.equal(ctx.propertyId, '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd');
});

test('I_bought-supplier Bought: the Supplier field is on the review screen, applies to every line, and is remembered for the visit', async () => {
  const e = await make({ sup: stub({ id: 'sup-1', name: 'SM Savemore', created: false }) });
  await e.mount('shopping'); await e.act('bought-open');
  await e.act('b-tick', { 'data-id': 's1' }); await e.act('b-tick', { 'data-id': 's2' }); await e.submit();
  assert.match(e.sheet(), /Add these to the stock\?/); assert.match(e.sheet(), /pick-sup/);
  await e.act('pick-sup'); await e.submit();
  assert.equal(rcpts(e).length, 2);
  for (const c of rcpts(e)) { assert.equal(c[2].p_supplier_id, 'sup-1'); assert.equal(c[2].p_supplier, 'SM Savemore'); }
  await e.act('close');
  await e.open('i1'); await e.begin('recv'); assert.match(e.sheet(), /SM Savemore/); // remembered
});

test('I_bought-supplier with no I_suppliers.js (404) the old Supplier (optional) text box stays and no id is sent; the module is asked for once', async () => {
  const e = await make({ doc: { script: 'error' } });
  await e.mount(''); await e.mount('');
  assert.equal(e.ctx.window.document.appended.filter((x) => x.tag === 'script').length, 1);
  assert.equal(e.ctx.window.document.appended.find((x) => x.tag === 'script').src, 'stock/I_suppliers.js');
  assert.equal(e.ctx.window.document.appended.find((x) => x.tag === 'link').href, 'stock/I_suppliers.css');
  assert.doesNotMatch(e.html(), /Suppliers<\/button>/); // the chip is hidden
  await e.open('i1'); await e.begin('recv');
  assert.match(e.sheet(), /Supplier \(optional\)/); assert.doesNotMatch(e.sheet(), /pick-sup/);
  await e.input('I_f_supplier', 'Corner store'); await e.submit(); await e.submit();
  assert.equal(rcpts(e)[0][2].p_supplier, 'Corner store'); assert.ok(!('p_supplier_id' in rcpts(e)[0][2]));
});

test('I_bought-supplier the script loads, the module is used, and the Suppliers chip mounts its list with the ctx', async () => {
  const mounted = [];
  const e = await make({ doc: { script: 'ok', suppliers: { pick: async () => null, mountList: (h, c) => mounted.push([h, c.role]) } } });
  await e.mount('');
  assert.match(e.html(), /data-k="suppliers"[^>]*>.*Suppliers<\/button>/);
  await e.act('chip', { 'data-k': 'suppliers' });
  assert.equal(mounted.length, 1); assert.equal(mounted[0][1], 'owner'); assert.ok(mounted[0][0]);
});

test('I_bought-supplier pick resolving null (R1 missing, or cancelled) falls back to the text box for that sheet', async () => {
  const e = await make({ sup: stub(null) });
  await e.mount(''); await e.open('i1'); await e.begin('recv'); await e.act('pick-sup');
  assert.match(e.sheet(), /Supplier \(optional\)/);
  await e.input('I_f_supplier', 'Market'); await e.submit(); await e.submit();
  assert.equal(rcpts(e)[0][2].p_supplier, 'Market'); assert.ok(!('p_supplier_id' in rcpts(e)[0][2]));
});

test('I_bought-supplier Undo all also stops using a supplier this run created (R2 active:false)', async () => {
  const e = await make({ sup: stub({ id: 'sup-9', name: 'New shop', created: true }) });
  await e.mount('shopping'); await e.act('bought-open'); await e.act('b-tick', { 'data-id': 's1' }); await e.submit();
  await e.act('pick-sup'); await e.submit();
  await e.act('b-undoall'); await e.submit();
  const r2 = e.client.rpcCalls('inventory_supplier_save_v1');
  assert.equal(r2.length, 1);
  assert.equal(j(r2[0][2]), j({ p_property_id: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd', p_supplier: { id: 'sup-9', active: false } }));
  assert.equal(e.client.rpcCalls('inventory_undo_v1').length, 1);
});

test('I_bought-supplier ctx.confirm asks inside this screen and ctx.undo puts an entry on the shared Undo bar', async () => {
  let ctx; const ran = [];
  const e = await make({ sup: { pick: async (c) => { ctx = c; return null; }, mountList() {} } });
  await e.mount(''); await e.open('i1'); await e.begin('recv'); await e.act('pick-sup');
  const yes = ctx.confirm('Add Corner store as a supplier?');
  assert.match(e.sheet(), /Add Corner store as a supplier\?/);
  await e.submit(); assert.equal(await yes, true);
  const no = ctx.confirm('Stop using it?'); await e.act('back'); assert.equal(await no, false);
  await e.act('close'); // the stock-received sheet is still the one underneath until closed
  ctx.undo('Supplier added', async () => { ran.push(1); return { data: { ok: true }, error: null }; });
  assert.match(e.undo(), /Supplier added/);
  await e.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(e.undo())[1] }); await e.submit();
  assert.equal(ran.length, 1);
});

test('I_bought-supplier pick gets preferredId from the item supplier; ctx.undo with {itemId} lands on that item (card line and bar)', async () => {
  const log = []; let ctx;
  const cat = raw(); cat.items[0].supplier = { id: 'sup-7', name: 'KCC', location: '' };
  const e = await setup({ role: 'owner', suppliers: { pick: async (c, o) => { ctx = c; log.push(o); return null; }, mountList() {} }, client: mockClient({ catalogue: cat, shop: SHOP, rpc: { record_inventory_receipt_v1: recv } }) });
  await e.mount(''); await e.open('i1'); await e.begin('recv'); await e.act('pick-sup');
  assert.equal(j(log[0]), j({ itemId: 'i1', preferredId: 'sup-7', selectedId: null }));
  ctx.undo('Linked KCC', async () => ({ data: { ok: true }, error: null }), { itemId: 'i1' });
  await e.act('back'); await e.mount('item/i1');
  assert.match(e.sheet(), /Last change: Linked KCC/);
  const o = await make({ sup: stub(null) }); await o.mount(''); await o.open('i1'); await o.begin('recv'); await o.act('pick-sup');
  const none = await make({ sup: stub(null) }); await none.mount(''); await none.open('i2'); await none.begin('recv');
});
