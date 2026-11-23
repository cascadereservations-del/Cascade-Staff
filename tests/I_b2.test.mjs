// Lane I (s85 ui-b2): Inventory controls. One icon system (ICON), unit plurals, one chip row, scan pill, group footer, segmented control.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { here, setup, mockClient, item } from './I_harness.mjs';

const css = fs.readFileSync(path.join(here, '..', 'stock', 'I_stock.css'), 'utf8');
const src = fs.readFileSync(path.join(here, '..', 'stock', 'I_stock.js'), 'utf8');
const rule = (sel) => { const m = new RegExp(sel.replace(/[.[\]()]/g, '\\$&') + ' \\{[^}]*\\}').exec(css); assert.ok(m, 'no rule for ' + sel); return m[0]; };
const cat = () => ({ items: [item('i1', 'Toilet paper', 1, 12, { codes: ['4800000000011'] }), item('i2', 'Hand soap', 2, 3, { category: 'Kitchen', unit: 'bottles', purchaseUnit: null, unitsPerPurchase: 1, codes: [] }), item('i3', 'Bath towels', 0, 10, { category: 'Linen', consumable: false, unit: 'piece', codes: [] })] });
const make = (role = 'owner') => setup({ role, client: mockClient({ catalogue: cat(), shop: [{ id: 's1', item_id: 'i1', item_name: 'Toilet paper', quantity: 1, purchase_unit: 'rolls', reason: '', status: 'proposed', proposed_at: '2026-10-12T02:00:00Z', proposed_by: 'x' }, { id: 's2', item_id: 'i2', item_name: 'Hand soap', quantity: 2, purchase_unit: 'bottles', reason: '', status: 'approved', proposed_at: '2026-10-11T02:00:00Z', proposed_by: 'x' }] }) });
const GLYPHS = /[✕▲✓○▥↶−✗✔]/;

test('I_b2 unit plurals: 1 roll, 2 rolls, 1 bottle, 2 bottles on the list, the card and every confirm', async () => {
  const e = await make('owner');
  await e.mount('');
  assert.match(e.html(), /1 of 12 rolls/); assert.doesNotMatch(e.html(), /1 rolls/); // s107 B5: a low row reads 'Low · 1 of 12 rolls'
  assert.match(e.html(), /2 of 3 bottles/); assert.doesNotMatch(e.html(), /2 bottle(?!s)/);
  assert.match(e.html(), /0 of 10 pieces/); // zero is plural
  await e.open('i1');
  assert.match(e.sheet(), /1 roll[^s]/); assert.doesNotMatch(e.sheet(), /1 rolls/);
  await e.begin('recv'); // s132: the Bought form shows the pack and the before-to-after picture instead of a confirm step
  assert.match(e.sheet(), /1 pack = 12 rolls/);
  assert.match(e.sheet(), /1<\/b><small>now<\/small>[\s\S]*13<\/b><small>after<\/small>/);
  assert.match(e.sheet(), /Save \u00b7 \+12 rolls/);
});

test('I_b2 unit plurals: the Record use confirm and the Undo bar say 1 roll', async () => {
  const e = await setup({ role: 'cleaner', client: mockClient({ catalogue: cat(), rpc: { record_inventory_usage: () => ({ data: { ok: true, rows: 1, movementIds: ['m1'] }, error: null }) } }) });
  await e.mount(''); await e.open('i1'); await e.begin('used');
  assert.match(e.sheet(), /Save \u00b7 1 used/); assert.doesNotMatch(e.sheet(), /1 rolls/); // s132: one tap saves, Undo replaces the confirm
  await e.submit();
  assert.match(e.undo(), /Logged 1 roll of Toilet paper as used/); assert.doesNotMatch(e.undo(), /1 rolls/);
});

test('I_b2 the shopping list and its card read 1 roll and 2 bottles', async () => {
  const e = await make('owner');
  await e.mount('shopping');
  assert.match(e.html(), /1 roll[^s]/); assert.doesNotMatch(e.html(), /1 rolls/); assert.match(e.html(), /2 bottles/);
});

test('I_b2 no Unicode glyph is drawn anywhere: every mark is an ICON svg', async () => {
  const e = await make('owner');
  await e.mount('');
  assert.doesNotMatch(e.html(), GLYPHS);
  assert.match(e.html(), /<svg class="i s16"/); assert.match(e.html(), /<svg class="i" /); // pills 16 px, summary 20 px
  await e.open('i1'); assert.doesNotMatch(e.sheet(), GLYPHS);
  await e.begin('count'); assert.doesNotMatch(e.sheet(), GLYPHS); assert.match(e.sheet(), /<svg class="i" [^>]*><path d="M5 12h14"\/><\/svg>/); // stepper minus
  await e.input('I_f_qty', 'x'); await e.submit(); assert.doesNotMatch(e.sheet(), GLYPHS); assert.match(e.sheet(), /class="err"><svg/);
  const s = await make('owner'); await s.mount('shopping'); assert.doesNotMatch(s.html(), GLYPHS); assert.match(s.html(), /<svg class="i s16"/);
  // the source strings hold none either
  const strs = src.split('\n').filter((l) => GLYPHS.test(l));
  assert.deepEqual(strs, []);
});

test('I_b2 filter chips are one nowrap scroll row with an edge fade; Scan is a chip; summary is a 2-column grid', async () => {
  const e = await make('owner');
  await e.mount('');
  assert.match(e.html(), /class="I_chips" role="group"/); assert.doesNotMatch(e.html(), /row-wrap I_chips/);
  assert.match(e.html(), /class="chip I_scanbtn"[^>]*data-act="scan" aria-label="Scan a barcode"><svg/); // s107 B4: an icon button with a name
  const c = rule('.I_chips');
  assert.match(c, /flex-wrap: nowrap/); assert.match(c, /overflow-x: auto/); assert.match(c, /mask-image: linear-gradient/);
  assert.match(rule('.I_chips .chip'), /flex: none/);
  assert.match(rule('.I_pills'), /flex-wrap: nowrap/); assert.match(rule('.I_pills'), /overflow-x: auto/); // s107 B3: the summary card is a pill row
  assert.match(rule('.I_find'), /position: sticky/); assert.match(rule('.I_find'), /background: var\(--bg\)/); // B4
});

test('I_b2 segmented control: selected = surface + shadow, unselected = plain', () => {
  const sel = rule('.I_tabs .btn[aria-pressed="true"]'), base = rule('.I_tabs .btn');
  assert.match(sel, /background: var\(--v5-surf\)/); assert.match(sel, /box-shadow: var\(--shadow-sm\)/);
  assert.match(base, /background: transparent/); assert.match(base, /border-color: transparent/); assert.match(base, /box-shadow: none/);
  assert.doesNotMatch(sel, /border-color: var\(--primary\)/);
});

test('I_b2 Count this group is a ghost button in the card footer, inside the list card, for owner and cleaner', async () => {
  for (const role of ['owner', 'cleaner']) {
    const e = await make(role);
    await e.mount('');
    const m = /<div class="card list I_list">[\s\S]*?<div class="I_foot"><button class="btn btn-secondary I_gupd"[^>]*data-act="group-open"[^>]*>Update this group \(\d+ items?\)<\/button><\/div><\/div><\/section>/.exec(e.html());
    assert.ok(m, role);
    assert.doesNotMatch(e.html(), /I_gcount/);
  }
  const f = await make('finance'); await f.mount(''); assert.doesNotMatch(f.html(), /I_gcount|I_gupd/);
});

const rowOf = (h, id) => (new RegExp('<div class="I_it">(?:(?!<div class="I_it">)[\s\S])*?data-id="' + id + '"[\s\S]*?</div>').exec(h) || [''])[0];
const qaOf = (h, id) => (new RegExp('data-act="quick" data-kind="([a-z]+)" data-id="' + id + '"').exec(h) || [])[1];

test('I_b2 each row carries one quick action by role: owner adds low items to the list, counts the rest, the cleaner records use', async () => {
  const o = await make('owner'); await o.mount('');
  assert.equal(qaOf(o.html(), 'i3'), 'update'); // s132: every tile carries one Update button
  assert.equal(qaOf(o.html(), 'i1'), 'update');
  assert.match(o.html(), />Update</);
  const c = await make('cleaner'); await c.mount('');
  assert.equal(qaOf(c.html(), 'i1'), 'update'); assert.equal(qaOf(c.html(), 'i3'), 'update');
  const l = await make('laundry'); await l.mount(''); assert.equal(qaOf(l.html(), 'i1'), 'update');
  const f = await make('finance'); await f.mount('');
  assert.doesNotMatch(f.html(), /data-kind="count"|data-kind="used"/); // finance neither counts nor records use
  assert.match(o.html(), /<button class="rowi I_row I_irow" type="button" data-act="open" data-id="i1"/); // the open hook is unchanged
});

test('I_b2 the quick action opens the card straight on the form with the current amount filled in; nothing is sent until confirmed', async () => {
  const o = await make('owner'); await o.mount('');
  await o.act('quick', { 'data-id': 'i1', 'data-kind': 'update' });
  assert.match(o.sheet(), /Toilet paper/); assert.match(o.sheet(), /Recount/);
  await o.begin('count'); assert.match(o.sheet(), /id="I_f_qty"[^>]*value="1"/); // the Recount form opens with the current amount filled in
  assert.equal(o.client.rpcCalls('reconcile_inventory_baseline_v1').length, 0);
  const c = await make('cleaner'); await c.mount('');
  await c.act('quick', { 'data-id': 'i1', 'data-kind': 'update' });
  assert.match(c.sheet(), /Used up/);
  const x = await make('finance'); await x.mount('');
  await x.act('quick', { 'data-id': 'i1', 'data-kind': 'recv' }); // a hand-made click for something not allowed does nothing
  assert.doesNotMatch(x.sheet(), /Stock received|How many/);
});

test('I_b2 rows say what needs action and the summary says it in plain words', async () => {
  const o = await make('owner'); await o.mount('');
  assert.match(o.html(), /I_tg I_tagl"><svg[^>]*>.*?<\/svg><span class="sr">On the list/);
  assert.match(o.html(), /Low <span class="I_cn">3<\/span>/); assert.match(o.html(), /Out <span class="I_cn">1<\/span>/); assert.match(o.html(), /On list <span class="I_cn">2<\/span>/); // s133: chips with a count
  assert.doesNotMatch(o.html(), /\d items low/);
});
