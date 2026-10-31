// s106: shopping tools. Add low items (one confirm, one call per ticked line, one Undo), Share as text, Save as image, PDF to Telegram shortcut.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { setup, mockClient, item, here } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const REASON = 'Running low (from the staff app)';
const raw = () => ({ items: [
  item('i1', 'Toilet paper', 4, 12, { par: 36, unitCost: null }), // Usual pack of 12: need 32 -> 3 packs
  item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unit: 'bottles', purchaseUnit: null, unitsPerPurchase: 1, unitCost: null }), // no Buy up to: 2 x 3 = 6
  item('i3', 'Bath towels', 14, null, { category: 'Linen', consumable: false, unit: 'pieces' }), // not low
  item('i4', 'Dish soap', 1, 2, { category: 'Kitchen', unit: 'bottles', par: 10, purchaseUnit: null, unitsPerPurchase: 1, unitCost: null }), // Usual pack of 6: need 9 -> 2 packs
  item('i5', 'Gas bottle', 2, 5, { category: 'Kitchen', unit: 'bottles', par: 7, purchaseUnit: null, unitsPerPurchase: 1, movementControlled: true, unitCost: null }), // controlled items are allowed: 7 - 2 = 5
  item('i6', 'Sponges', 1, 3, { category: 'Kitchen', unit: 'pieces', purchaseUnit: null, unitsPerPurchase: 1 }) // already on the list
] });
const onList = (id, name, qty, unit, extra) => ({ id: 'row-' + id, item_id: id, item_name: name, quantity: qty, purchase_unit: unit, reason: null, status: 'proposed', proposed_by: 'x', proposed_at: '2026-10-12T02:00:00Z', ...(extra || {}) });
const SHOP = [onList('i6', 'Sponges', 2, null)];
const USUAL = { i1: { itemId: 'i1', supplier: 'SM Savemore', label: 'pack of 12', packSize: 12, quoted: 210, lastUnit: null }, i4: { itemId: 'i4', supplier: 'SM Savemore', label: 'Joy 6-pack', packSize: 6, quoted: 300, lastUnit: null } };
const sup = (map = USUAL) => ({ pick: async () => null, mountList() {}, openPriceHistory() {}, openItemSuppliers() {}, usualMap: async () => map });
let n = 0;
const make = (role, o = {}) => setup({ role, suppliers: o.sup === undefined ? sup() : o.sup, client: mockClient({ catalogue: raw(), shop: o.shop || SHOP, rpc: { save_shopping_item_v1: (a) => (o.rpc && o.rpc(a)) || { data: { ok: true, id: 'new-' + (++n) }, error: null }, ...(o.rpcs || {}) } }) });
const saves = (e) => e.client.rpcCalls('save_shopping_item_v1');
const names = (sheet) => [...sheet.matchAll(/data-act="al-tick" data-id="(\w+)"/g)].map((m) => m[1]);
const j = (x) => JSON.stringify(x);

test('I_shop lowItems: Buy up to minus on hand in whole Usual packs, no-par rule, skips what is on the list, controlled allowed', async () => {
  const e = await make('owner'); const L = e.lib;
  const items = raw().items.map((r) => L.normalize(r, 'owner'));
  const shop = L.normalizeShop(SHOP, null);
  const got = JSON.parse(JSON.stringify(L.lowItems(items, shop, USUAL))).map((x) => [x.itemId, x.qty, x.unit]);
  // out first (Hand soap), then by name: Dish soap, Gas bottle, Toilet paper
  assert.deepEqual(got, [['i2', 6, 'bottles'], ['i4', 2, 'pack'], ['i5', 5, 'bottles'], ['i1', 3, 'pack']]);
  // without a Usual option the item's own pack (12) is used: 32 / 12 -> 3 as well; Dish soap 9 / 1 -> 9
  const plain = JSON.parse(JSON.stringify(L.lowItems(items, shop, {}))).map((x) => [x.itemId, x.qty]);
  assert.deepEqual(plain, [['i2', 6], ['i4', 9], ['i5', 5], ['i1', 3]]);
  // a rounding case: need 13 with a pack of 12 is 2 packs, never 1.08
  const odd = L.normalize(item('x', 'Rice', 3, 5, { par: 16, purchaseUnit: 'pack', unitsPerPurchase: 12 }), 'owner');
  assert.equal(L.lowItems([odd], [], {})[0].qty, 2);
  // par below the count never gives zero
  const over = L.normalize(item('y', 'Salt', 2, 5, { par: 1, purchaseUnit: null, unitsPerPurchase: 1 }), 'owner');
  assert.equal(L.lowItems([over], [], {})[0].qty, 1);
});

test('I_shop Add low items: owner and admin get the button on both views; cleaner and finance get none', async () => {
  for (const role of ['owner', 'admin']) {
    const e = await make(role); await e.mount(''); assert.match(e.html(), /data-act="addlow-open"/, role + ' items');
    await e.mount('shopping'); assert.match(e.html(), /data-act="addlow-open"/, role + ' shopping');
  }
  for (const role of ['cleaner', 'finance']) {
    const e = await make(role); await e.mount(''); assert.doesNotMatch(e.html(), /addlow-open/, role + ' items');
    await e.mount('shopping'); assert.doesNotMatch(e.html(), /addlow-open/, role + ' shopping');
    assert.match(e.html(), /data-act="shop-share"/); // every role that can see the list can export it
  }
});

test('I_shop confirm sheet: nothing is sent before Confirm; lines show quantity, Usual option and price for owner', async () => {
  const e = await make('owner'); await e.mount('shopping');
  await e.act('addlow-open');
  assert.equal(saves(e).length, 0);
  assert.deepEqual(names(e.sheet()), ['i2', 'i4', 'i5', 'i1']);
  const s = e.sheet();
  assert.match(s, /3 packs · SM Savemore · pack of 12 · PHP 210 a pack/);
  assert.match(s, /2 packs · SM Savemore · Joy 6-pack · PHP 300 a pack/);
  assert.match(s, /6 bottles/); assert.match(s, /5 bottles/);
  assert.doesNotMatch(s, /Sponges/); // already on the list
  assert.equal((s.match(/aria-pressed="true"/g) || []).length, 4); // all ticked
  assert.equal(saves(e).length, 0);
});

test('I_shop confirm sends exactly one save_shopping_item_v1 per ticked line with its own key, then one Undo for the batch', async () => {
  const e = await make('owner'); await e.mount('shopping');
  await e.act('addlow-open'); await e.act('al-tick', { 'data-id': 'i5' }); // untick the Gas bottle
  assert.equal(saves(e).length, 0);
  await e.submit();
  const c = saves(e);
  assert.equal(c.length, 3);
  c.forEach((x) => { assert.deepEqual(Object.keys(x[2]).sort(), ['p_idempotency_key', 'p_item', 'p_property_id']); assert.equal(x[2].p_property_id, PID); assert.ok(x[2].p_idempotency_key.length >= 16 && x[2].p_idempotency_key.length <= 160); });
  assert.equal(new Set(c.map((x) => x[2].p_idempotency_key)).size, 3);
  assert.deepEqual(c.map((x) => ({ ...x[2].p_item })), [
    { item_id: 'i2', item_name: 'Hand soap', quantity: 6, purchase_unit: null, reason: REASON },
    { item_id: 'i4', item_name: 'Dish soap', quantity: 2, purchase_unit: null, reason: REASON },
    { item_id: 'i1', item_name: 'Toilet paper', quantity: 3, purchase_unit: 'pack', reason: REASON }]);
  assert.equal(e.sheet(), ''); // the sheet closed
  assert.match(e.undo(), /Added 3 items to the shopping list/);
  assert.equal((e.undo().match(/data-act="undo"/g) || []).length, 1);
  const made = n; // the ids the server handed out for the three rows
  await e.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(e.undo())[1] }); await e.submit();
  const u = saves(e).slice(3);
  assert.equal(u.length, 3);
  assert.deepEqual(u.map((x) => ({ ...x[2].p_item })), [{ id: 'new-' + (made - 2), status: 'cancelled' }, { id: 'new-' + (made - 1), status: 'cancelled' }, { id: 'new-' + made, status: 'cancelled' }]);
  assert.equal(new Set(u.map((x) => x[2].p_idempotency_key)).size, 3);
});

test('I_shop partial failure keeps the successes, names the failures, and the retry sends only those with the same keys', async () => {
  let failDish = true;
  const e = await make('owner', { rpc: (a) => (a.p_item.item_id === 'i4' && failDish ? { data: null, error: { code: 'XX000', message: 'boom' } } : null) });
  await e.mount('shopping'); await e.act('addlow-open'); await e.submit();
  assert.equal(saves(e).length, 4);
  assert.match(e.sheet(), /3 added\. Not added: Dish soap/);
  assert.match(e.sheet(), />Try again</);
  const firstKey = saves(e).filter((x) => x[2].p_item.item_id === 'i4')[0][2].p_idempotency_key;
  failDish = false;
  await e.submit();
  const c = saves(e);
  assert.equal(c.length, 5); // only the failed line went again
  assert.equal(c[4][2].p_item.item_id, 'i4'); assert.equal(c[4][2].p_idempotency_key, firstKey);
  assert.equal(e.sheet(), '');
  assert.match(e.undo(), /Added 4 items/);
});

test('I_shop nothing ticked sends nothing; demo writes nothing; an offline phone sends nothing', async () => {
  const e = await make('owner'); await e.mount('shopping'); await e.act('addlow-open');
  for (const id of ['i2', 'i4', 'i5', 'i1']) await e.act('al-tick', { 'data-id': id });
  await e.submit(); assert.match(e.sheet(), /Tick at least one item/); assert.equal(saves(e).length, 0);
  await e.act('al-tick', { 'data-id': 'i2' }); e.nav.onLine = false; await e.submit();
  assert.equal(saves(e).length, 0); assert.match(e.sheet(), /No connection/);
  const d = await setup({ role: 'owner', demo: true });
  await d.mount(''); assert.match(d.html(), /data-act="addlow-open"/);
  await d.act('addlow-open'); assert.match(d.sheet(), /Trash bags/); assert.match(d.sheet(), /Drinking water/); assert.doesNotMatch(d.sheet(), /Hand soap|Toilet paper/);
  await d.submit(); assert.match(d.toasts[d.toasts.length - 1], /Demo only/);
});

test('I_shop a refused write hides the button for the visit', async () => {
  const e = await make('owner', { rpc: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) });
  await e.mount('shopping'); await e.act('addlow-open'); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available to you/);
  assert.doesNotMatch(e.html(), /addlow-open/);
});

const PRICED = [onList('i1', 'Toilet paper', 3, 'pack'), onList('i4', 'Dish soap', 2, 'pack')];
test('I_shop share text for the owner: title, checklist lines with pack and price, a total', async () => {
  const e = await make('owner', { shop: PRICED }); await e.mount('shopping');
  const L = e.lib, shop = L.normalizeShop(PRICED, null), items = raw().items.map((r) => L.normalize(r, 'owner'));
  assert.equal(L.shopText(shop, { role: 'owner', items, usual: USUAL, today: '2026-10-15' }),
    'Cascade shopping list · 15 Oct 2026\n\n☐ Toilet paper — 3 packs (pack of 12 @ PHP 210)\n☐ Dish soap — 2 packs (Joy 6-pack @ PHP 300)\n\nTotal: PHP 1,230');
  // one row without a price: no invented total
  const mixed = L.normalizeShop([...PRICED, onList('i2', 'Hand soap', 6, null)], null);
  const t = L.shopText(mixed, { role: 'owner', items, usual: USUAL, today: '2026-10-15' });
  assert.match(t, /☐ Hand soap — 6 bottles\n/); assert.match(t, /Total: some prices unknown$/);
});

test('I_shop share text for a cleaner has no money at all', async () => {
  const e = await make('cleaner', { shop: PRICED }); const L = e.lib;
  const items = raw().items.map((r) => L.normalize(r, 'cleaner'));
  const t = L.shopText(L.normalizeShop(PRICED, null), { role: 'cleaner', items, usual: USUAL, today: '2026-10-15' });
  assert.equal(t, 'Cascade shopping list · 15 Oct 2026\n\n☐ Toilet paper — 3 packs\n☐ Dish soap — 2 packs');
  assert.doesNotMatch(t, /PHP|₱|Total|@/);
  // and through the button: the cleaner's shared text is that text
  const got = []; e.nav.share = async (o) => { got.push(o); };
  await e.mount('shopping'); await e.act('shop-share');
  assert.equal(got.length, 1); assert.equal(got[0].text, t);
});

test('I_shop share text goes through navigator.share, else the clipboard with a Copied toast, else a textarea', async () => {
  const e = await make('owner', { shop: PRICED }); await e.mount('shopping');
  const shared = []; e.nav.share = async (o) => { shared.push(o); };
  await e.act('shop-share');
  assert.equal(shared.length, 1); assert.match(shared[0].text, /^Cascade shopping list · 15 Oct 2026/); assert.match(shared[0].text, /Total: PHP 1,230/);
  delete e.nav.share; const copied = []; e.nav.clipboard = { writeText: async (t) => { copied.push(t); } };
  await e.act('shop-share');
  assert.equal(copied.length, 1); assert.equal(e.toasts[e.toasts.length - 1], 'Copied');
  delete e.nav.clipboard;
  await e.act('shop-share');
  assert.match(e.sheet(), /<textarea id="I_copy"[^>]*readonly>Cascade shopping list/);
  // a cancelled share sheet is not an error and does not fall through to the clipboard
  await e.act('close'); e.nav.share = async () => { const x = new Error('cancelled'); x.name = 'AbortError'; throw x; }; e.nav.clipboard = { writeText: async (t) => { copied.push(t); } };
  await e.act('shop-share'); assert.equal(copied.length, 1);
});

function imgEnv(e, canShare) {
  const out = { anchors: [], shares: [], ops: [], canvas: null, revoked: [] };
  const g = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textBaseline: '', measureText: (s) => ({ width: s.length * 14 }), fillRect: (...a) => out.ops.push(['rect', ...a]), strokeRect: (...a) => out.ops.push(['box', ...a]), fillText: (s, x, y) => out.ops.push(['text', s, x, y]) };
  e.win.document = { body: { appendChild() {} }, createElement(tag) {
    if (tag === 'canvas') { const c = { width: 0, height: 0, getContext: () => g, toBlob(cb, type) { out.type = type; out.canvas = c; cb({ type, size: 5000 }); } }; return c; }
    const a = { click() { out.anchors.push(a); }, remove() {} }; return a;
  } };
  e.win.URL = { createObjectURL: () => 'blob:pic', revokeObjectURL: (u) => out.revoked.push(u) };
  e.win.File = class { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o.type; } };
  if (canShare) { e.nav.canShare = (d) => !!(d && d.files && d.files.length); e.nav.share = async (d) => { out.shares.push(d); }; }
  return out;
}
test('I_shop Save as image: a file-sharing phone gets the share sheet with a PNG; anything else gets a dated download', async () => {
  const a = await make('owner', { shop: PRICED }); await a.mount('shopping');
  const oa = imgEnv(a, true); await a.act('shop-image');
  assert.equal(oa.type, 'image/png'); assert.equal(oa.canvas.width, 1080); assert.ok(oa.canvas.height > 300);
  assert.equal(oa.shares.length, 1); assert.equal(oa.shares[0].files[0].name, 'cascade-shopping-2026-10-15.png'); assert.equal(oa.shares[0].files[0].type, 'image/png');
  assert.equal(oa.anchors.length, 0);
  assert.ok(oa.ops.some((o) => o[0] === 'text' && /Cascade shopping list · 15 Oct 2026/.test(o[1]))); assert.ok(oa.ops.some((o) => o[0] === 'text' && /Total: PHP 1,230/.test(o[1])));
  const b = await make('owner', { shop: PRICED }); await b.mount('shopping');
  const ob = imgEnv(b, false); await b.act('shop-image');
  assert.equal(ob.shares.length, 0); assert.equal(ob.anchors.length, 1); assert.equal(ob.anchors[0].download, 'cascade-shopping-2026-10-15.png'); assert.equal(ob.anchors[0].href, 'blob:pic');
  assert.match(b.toasts[b.toasts.length - 1], /saved to your downloads/);
  // the cleaner's picture carries no money either
  const c = await make('cleaner', { shop: PRICED }); await c.mount('shopping'); const oc = imgEnv(c, false); await c.act('shop-image');
  assert.ok(oc.ops.filter((o) => o[0] === 'text').every((o) => !/PHP|Total|@/.test(o[1])));
});

test('I_shop shopLayout: long lines wrap inside the width and the height grows with the rows', async () => {
  const e = await make('owner'); const L = e.lib, measure = (f, s) => s.length * 14;
  const short = L.shopLayout(measure, { title: 'T', rows: ['A — 1 pack'], total: '' }, 1080);
  const long = L.shopLayout(measure, { title: 'T', rows: ['A — 1 pack', 'word '.repeat(60).trim()], total: 'Total: PHP 1' }, 1080);
  assert.ok(long.height > short.height + 100);
  long.ops.filter((o) => o.t === 'text').forEach((o) => assert.ok(o.x + measure('', o.s) <= 1080 - 56 + 1, o.s));
  assert.ok(long.ops.filter((o) => o.t === 'box').length === 2);
});

test('I_shop PDF to Telegram: the shortcut opens the report sheet on the order list and sends the same inventory-report call', async () => {
  const e = await make('owner'); await e.mount('shopping');
  assert.match(e.html(), /data-act="report" data-k="order">PDF to Telegram</);
  await e.act('report', { 'data-k': 'order' });
  assert.match(e.sheet(), /data-act="rep-kind" data-k="order" aria-pressed="true"/);
  assert.match(e.sheet(), /data-act="rep-kind" data-k="low" aria-pressed="false"/);
  await e.submit(); await e.submit(); // pick the list, then confirm
  const f = e.client.fnCalls('inventory-report');
  assert.equal(f.length, 1); assert.deepEqual({ ...f[0][2] }, { kind: 'order', to: 'ops' });
  // the Items view button still opens the sheet on the same default, and an unknown kind falls back to it
  await e.mount(''); await e.act('report', { 'data-k': 'nonsense' });
  assert.match(e.sheet(), /data-k="order" aria-pressed="true"/);
  const c = await make('cleaner'); await c.mount('shopping'); assert.match(c.html(), /PDF to Telegram/); // the OPS list has no prices; the sheet decides who may pick Finance
  await c.act('report', { 'data-k': 'order' }); assert.doesNotMatch(c.sheet(), /Finance group/);
});

test('I_shop demo shows the new buttons on both views', async () => {
  const d = await setup({ role: 'owner', demo: true });
  await d.mount('shopping');
  for (const a of ['addlow-open', 'shop-share', 'shop-image']) assert.match(d.html(), new RegExp('data-act="' + a + '"'));
  assert.match(d.html(), /PDF to Telegram/);
});

test('I_shop usualMap reads the Usual option per item from the supplier list and detail RPCs', async () => {
  const ctx = { window: {} }; ctx.self = ctx.window; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '..', 'stock', 'I_suppliers.js'), 'utf8'), ctx);
  const calls = [];
  const client = { rpc: async (nm, a) => { calls.push([nm, a]); if (nm === 'inventory_supplier_list_v1') return { data: { ok: true, suppliers: [{ id: 's1', name: 'SM', active: true }, { id: 's2', name: 'Old', active: false }, { id: 's3', name: 'Robinsons', active: true }] }, error: null };
    return { data: { ok: true, items: a.p_supplier_id === 's1' ? [{ item_id: 'i1', preferred: true, pack_label: 'pack of 12', pack_size: 12, quoted_pack_price: 210 }, { item_id: 'i2', preferred: false, pack_size: 3 }] : [{ item_id: 'i4', preferred: true, pack_size: '6', last_unit_price: 50 }] }, error: null }; } };
  const m = JSON.parse(JSON.stringify(await ctx.window.I_Suppliers.usualMap({ client, role: 'owner', propertyId: PID })));
  assert.deepEqual(Object.keys(m).sort(), ['i1', 'i4']);
  assert.deepEqual(m.i1, { itemId: 'i1', supplier: 'SM', label: 'pack of 12', packSize: 12, quoted: 210, lastUnit: null });
  assert.deepEqual(m.i4, { itemId: 'i4', supplier: 'Robinsons', label: '', packSize: 6, quoted: null, lastUnit: 50 });
  assert.equal(calls.filter((c) => c[0] === 'inventory_supplier_detail_v1').length, 2); // the inactive supplier is not read
});

test('I_shop the Usual options are read once for the owner, never for the cleaner', async () => {
  let reads = 0; const s = sup(); s.usualMap = async () => { reads++; return USUAL; };
  const o = await make('owner', { sup: s }); await o.mount('shopping'); await o.act('addlow-open'); await o.act('close'); await o.act('addlow-open');
  assert.equal(reads, 1);
  let cr = 0; const s2 = sup(); s2.usualMap = async () => { cr++; return USUAL; };
  const c = await make('cleaner', { sup: s2 }); await c.mount('shopping'); await c.act('shop-share'); assert.equal(cr, 0);
});
