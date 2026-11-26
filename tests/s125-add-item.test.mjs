// s125 (staff 3.4.41): everyone can add a new inventory item, saved at once with a 30 minute Undo (D-386). Contract: docs/s125/CONTRACT-add-item.md, L2 Staff.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, mockClient, item, here } from './I_harness.mjs';

const okd = (d) => () => ({ data: { ok: true, ...d }, error: null });
const bad = (d) => () => ({ data: { ok: false, ...d }, error: null });
const cat = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { location: 'Hall cabinet' }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unit: 'bottles' })] });
const SUPS = { inventory_supplier_list_v1: okd({ suppliers: [{ id: 's-1', name: 'Shopsuki', active: true }, { id: 's-2', name: 'Old shop', active: false }] }) };
const RPC = { inventory_item_create_v1: okd({ item_id: 'n1', change_id: 'chg-n1' }), inventory_item_change_undo_v1: okd({ item_id: 'n1' }), inventory_item_photo_set_v1: okd({ item_id: 'n1', change_id: 'chg-p' }), inventory_option_request_v1: okd({ request_id: 'r1', applied: true }), ...SUPS };
const upload = () => ({ data: { ok: true, path: 'inv/n1/p.webp', signedUrl: 'https://x/p' }, error: null });
// the real catalogue lists the new item after a create; so does this one
const make = (role, rpc = {}, o = {}) => { const c = o.cat || cat(); const add = (a) => { c.items.push(item('n1', a.p_item.name, a.p_item.qty ?? null, a.p_item.reorder_below ?? null, { category: a.p_item.category, unit: a.p_item.unit })); return { data: { ok: true, item_id: 'n1', change_id: 'chg-n1' }, error: null }; };
  return setup({ role, doc: o.doc, client: mockClient({ catalogue: c, rpc: { ...RPC, inventory_item_create_v1: add, ...rpc }, fn: { 'upload-photo': upload, ...(o.fn || {}) } }) }); };
const creates = (e) => e.client.rpcCalls('inventory_item_create_v1');
const undoId = (html) => /data-id="(u\d+)"/.exec(html)[1];
const fill = async (e, name = 'Spare keys', category = 'Bathroom') => { await e.input('I_f_name', name); await e.input('I_f_category', category); };

test('s125 1: a cleaner and an owner see ONE Add item button in the search row (third column); nothing when the server lacks the barcode release', async () => {
  for (const role of ['cleaner', 'owner']) {
    const e = await make(role); await e.mount('');
    const h = e.html();
    assert.equal((h.match(/data-act="add-new"/g) || []).length, 1);
    assert.match(h, /class="I_srow I_srow3"/); assert.match(h, /Add item/);
  }
  const old = { items: cat().items.map(({ codes, ...r }) => r) }; // no 'codes' key = the s84 SQL is not applied: the whole Add item feature stays hidden
  const n = await make('cleaner', {}, { cat: old }); await n.mount('');
  assert.doesNotMatch(n.html(), /data-act="add-new"/);
});

test('s125 2: an empty search says what to do and Add item pre-fills the name; no second button in the empty state', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.input('I_q', 'Spare keys');
  const h = e.html(); assert.match(h, /No item called "Spare keys"\. Tap Add item to add it\./);
  assert.equal((h.match(/data-act="add-new"/g) || []).length, 1);
  await e.act('add-new');
  assert.match(e.sheet(), /id="I_f_name"[^>]*value="Spare keys"/);
});

test('s125 3: the sheet has the approved shape: I_new class, aria-modal, title focus, required Name described by its message, Close only, details closed', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new');
  const s = e.sheet();
  assert.match(s, /class="sheet on I_sheet I_new" role="dialog" aria-modal="true" aria-labelledby="I_sh_t"/);
  assert.match(s, /<h2 class="hd I_sht" id="I_sh_t" tabindex="-1">New item<\/h2>/);
  assert.match(s, /id="I_f_name"[^>]*maxlength="80" required aria-required="true"/);
  assert.match(s, /data-act="close"/); assert.doesNotMatch(s, /data-act="back"/);
  assert.match(s, /<details class="I_det"><summary data-act="more-toggle">More details \(optional\)<\/summary>/);
  assert.match(s, /id="I_np_in"[^>]*capture="environment"/); assert.match(s, /id="I_np_pick"/);
  assert.doesNotMatch(s, /!/); // calm copy, no exclamation mark
  const t = e.root.kids.layer; assert.equal(e.root.byId && e.root.byId.I_sh_t && e.root.byId.I_sh_t.focused, 1);
  await e.submit(); const s2 = e.sheet();
  assert.match(s2, /aria-invalid="true" aria-describedby="I_e_name"/); assert.match(s2, /<p class="err" id="I_e_name">Type a name, at least 2 letters\./);
  assert.equal(creates(e).length, 0);
});

test('s125 4: a cleaner has no Let Cassy choose, no pre-selected category, no New category, only categories in use; an owner has all three', async () => {
  const c = await make('cleaner'); await c.mount(''); await c.act('add-new');
  const s = c.sheet();
  assert.doesNotMatch(s, /__cassy/); assert.doesNotMatch(s, /__new/); assert.doesNotMatch(s, /Miscellaneous/);
  assert.match(s, /<option value="" selected>Choose a category/); assert.match(s, /<option value="Kitchen">/);
  await c.input('I_f_name', 'Spare keys'); await c.submit(); assert.match(c.sheet(), /<p class="err" id="I_e_category">Choose a category\./);
  const o = await make('owner'); await o.mount(''); await o.act('add-new');
  assert.match(o.sheet(), /<option value="__cassy" selected>Let Cassy choose/); assert.match(o.sheet(), /<option value="__new">New category/); assert.match(o.sheet(), /<option value="Miscellaneous">/);
  await o.input('I_f_name', 'Spare keys'); await o.input('I_f_category', '__new'); assert.match(o.sheet(), /id="I_f_newcat"/);
  await o.submit(); assert.match(o.sheet(), /Type the new category\./);
  await o.input('I_f_newcat', 'Keys'); await o.submit(); await o.submit();
  assert.equal(creates(o)[0][2].p_item.category, 'Keys');
});

test('s125 5: Continue shows the check step; Yes, add it sends only the allowed keys and a long idempotency key; the card opens with the Added by you line and no code', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new');
  await fill(e); await e.input('I_f_qty', '3'); await e.submit();
  const s = e.sheet();
  assert.match(s, /<h2 [^>]*>Add Spare keys\?<\/h2>/); assert.match(s, /<dl class="I_diff">/); assert.match(s, /Yes, add it/); assert.match(s, /data-act="back"/);
  assert.equal(creates(e).length, 0);
  await e.submit();
  const c = creates(e); assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][2]).sort(), ['p_code', 'p_format', 'p_idempotency_key', 'p_item', 'p_property_id']);
  assert.deepEqual({ ...c[0][2].p_item }, { name: 'Spare keys', category: 'Bathroom', unit: 'pc', consumable: false, qty: 3 });
  assert.equal(c[0][2].p_code, null); assert.ok(c[0][2].p_idempotency_key.length >= 16 && c[0][2].p_idempotency_key.length <= 160);
  assert.doesNotMatch(JSON.stringify(c[0][2]), /par_qty|unit_cost|price/);
  assert.equal(e.navs[e.navs.length - 1], '#stock/item/n1');
  const card = e.sheet();
  assert.match(card, /Spare keys added\./); assert.match(card, /Added by you just now\. <button[^>]*data-act="undo"/);
  assert.doesNotMatch(card, /!/);
});

test('s125 6: the check step has a busy state that disables the button; a retry of the same values reuses the same key', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const e = await make('cleaner', { inventory_item_create_v1: async () => { await gate; return { data: { ok: true, item_id: 'n1', change_id: 'chg-n1' }, error: null }; } });
  await e.mount(''); await e.act('add-new'); await fill(e); await e.submit();
  const p = e.submit(); await new Promise((r) => setImmediate(r));
  assert.match(e.sheet(), /<button class="btn btn-primary btn-block" type="submit" disabled>Adding…<\/button>/); assert.match(e.sheet(), /data-act="back" disabled/);
  release(); await p;
  const f = await make('cleaner', { inventory_item_create_v1: () => { throw { code: 'XX000', message: 'boom' }; } });
  await f.mount(''); await f.act('add-new'); await fill(f); await f.submit(); await f.submit();
  assert.match(f.sheet(), /Could not add it\. Nothing was lost\. Check the signal and try again\./); assert.doesNotMatch(f.sheet(), /nothing was added/i); await f.submit();
  const k = creates(f).map((x) => x[2].p_idempotency_key); assert.equal(k.length, 2); assert.equal(k[0], k[1]);
});

test('s125 7: the same name is caught as you type (case and spaces ignored) with Open it; the server name_exists says it too', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new');
  await e.input('I_f_name', '  hand SOAP '); await e.input('I_f_category', 'Kitchen');
  await e.submit();
  assert.match(e.sheet(), /That name is already on the list\./); assert.equal(creates(e).length, 0);
  assert.match(e.root.byId.I_dup.innerHTML || e.sheet(), /<b>Hand soap<\/b> is already on the list\. Is it the same\?/);
  assert.match(e.sheet(), /data-act="open-taken" data-id="i2">Open Hand soap</);
  const s = await make('cleaner', { inventory_item_create_v1: bad({ reason: 'name_exists', item_id: 'i2' }) }); await s.mount(''); await s.act('add-new');
  await fill(s, 'Hand soaps'); await s.submit(); await s.submit();
  assert.match(s.sheet(), /<h2 [^>]*>New item<\/h2>/); assert.match(s.sheet(), /already on the list/); assert.match(s.sheet(), /data-act="open-taken" data-id="i2"/);
  await s.act('open-taken', { 'data-id': 'i2' }); assert.equal(s.navs[s.navs.length - 1], '#stock/item/i2');
});

test('s125 8: the field limits: name 2 to 80, numbers, unit, reorder and Kept in sit under More details and open it on error', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new');
  await e.input('I_f_name', 'x'.repeat(81)); await e.input('I_f_category', 'Bathroom'); await e.submit(); assert.match(e.sheet(), /up to 80 characters/);
  await fill(e); await e.input('I_f_qty', 'abc'); await e.submit(); assert.match(e.sheet(), /id="I_e_qty">Enter a number such as 12 or 2\.5\./);
  await e.input('I_f_qty', ''); await e.input('I_f_reorder', '-1'); await e.submit();
  assert.match(e.sheet(), /<details class="I_det" open>/); assert.match(e.sheet(), /id="I_e_reorder"/);
  assert.equal(creates(e).length, 0);
  await e.input('I_f_reorder', '2'); await e.input('I_f_location', 'Hall'); await e.submit(); await e.submit();
  assert.deepEqual({ ...creates(e)[0][2].p_item }, { name: 'Spare keys', category: 'Bathroom', unit: 'pc', consumable: false, reorder_below: 2, location: 'Hall' });
});

test('s125 9: the photo goes after the item, with the existing pipeline; a failed photo never undoes the item and the card offers Try again', async () => {
  const e = await make('cleaner', {}, { doc: {} }); await e.mount(''); await e.act('add-new');
  await e.change('I_np_in', [{ name: 'a.jpg' }]); assert.match(e.sheet(), /Photo ready/); assert.match(e.sheet(), /Preview of the new photo/);
  await fill(e); await e.submit(); assert.match(e.sheet(), /<dt>Photo<\/dt><dd>Ready/); await e.submit();
  assert.equal(creates(e).length, 1);
  const up = e.client.calls.filter((c) => c[0] === 'fn' && c[1] === 'upload-photo' && c[2] && c[2].fileData);
  assert.equal(up.length, 1); assert.equal(up[0][2].itemId, 'n1');
  assert.deepEqual(e.client.rpcCalls('inventory_item_photo_set_v1')[0][2], { p_item_id: 'n1', p_path: 'inv/n1/p.webp' });
  const f = await make('cleaner', {}, { doc: {}, fn: { 'upload-photo': () => ({ data: null, error: { message: 'offline' } }) } }); await f.mount(''); await f.act('add-new');
  await f.change('I_np_in', [{ name: 'a.jpg' }]); await fill(f); await f.submit(); await f.submit();
  assert.equal(f.client.rpcCalls('inventory_item_change_undo_v1').length, 0);
  assert.match(f.sheet(), /Spare keys was added, but the photo did not upload\. <button[^>]*data-act="add-retry"[^>]*>[^<]*<\/button>|Spare keys was added, but the photo did not upload\./);
  assert.match(f.sheet(), /data-act="add-retry"/);
});

test('s125 10: products go one request each after the item, with their own keys; Shop is the supplier menu; max 3; link must be shopsuki.ph or shopee.ph; no price', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new');
  assert.match(e.sheet(), /Products you buy/); assert.match(e.sheet(), /<option value="s-1">Shopsuki/); assert.doesNotMatch(e.sheet(), /Old shop/); assert.doesNotMatch(e.sheet(), /Price/);
  await e.act('prod-add'); await e.act('prod-add'); await e.act('prod-add'); assert.doesNotMatch(e.sheet(), /data-act="prod-add"/); assert.doesNotMatch(e.sheet(), /id="I_f_p4_name"/);
  await fill(e); await e.input('I_f_p1_name', 'Brass keys 6 pack'); await e.submit();
  assert.match(e.sheet(), /id="I_e_p1_shop">Choose a shop/); assert.match(e.sheet(), /<details class="I_det" open>/);
  await e.input('I_f_p1_shop', 's-1'); await e.input('I_f_p1_link', 'https://evil.example/x'); await e.submit(); assert.match(e.sheet(), /The link must be from shopsuki\.ph or shopee\.ph\./);
  await e.input('I_f_p1_link', 'https://shopsuki.ph/products/keys'); await e.input('I_f_p2_name', 'Steel keys'); await e.input('I_f_p2_shop', 's-1'); await e.submit();
  assert.match(e.sheet(), /Brass keys 6 pack · Shopsuki<br>Steel keys · Shopsuki/);
  await e.submit();
  const r = e.client.rpcCalls('inventory_option_request_v1'); assert.equal(r.length, 2);
  assert.deepEqual({ ...r[0][2].p_payload }, { title: 'Brass keys 6 pack', supplier_id: 's-1', available: true, source_url: 'https://shopsuki.ph/products/keys' });
  assert.deepEqual({ ...r[1][2].p_payload }, { title: 'Steel keys', supplier_id: 's-1', available: true });
  assert.equal(r[0][2].p_item_id, 'n1'); assert.equal(r[0][2].p_action, 'add');
  assert.notEqual(r[0][2].p_idempotency_key, r[1][2].p_idempotency_key); assert.ok(r[0][2].p_idempotency_key.length >= 16);
  const ci = e.client.calls.map((c) => c[1]); assert.ok(ci.indexOf('inventory_item_create_v1') < ci.indexOf('inventory_option_request_v1'));
});

test('s125 11: a product that fails stays on the card as Try again; the retry sends only the missing one with the same key', async () => {
  let n = 0;
  const e = await make('cleaner', { inventory_option_request_v1: () => (++n === 1 ? { data: null, error: { message: 'x' } } : { data: { ok: true }, error: null }) });
  await e.mount(''); await e.act('add-new'); await fill(e); await e.input('I_f_p1_name', 'Brass keys'); await e.input('I_f_p1_shop', 's-1'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /Spare keys was added, but a product did not save\./);
  await e.act('add-retry', { 'data-id': 'n1' });
  const r = e.client.rpcCalls('inventory_option_request_v1'); assert.equal(r.length, 2); assert.equal(r[0][2].p_idempotency_key, r[1][2].p_idempotency_key);
  assert.doesNotMatch(e.sheet(), /did not save/);
});

test('s125 12: Undo calls inventory_item_change_undo_v1 with the change id, asks Remove <name> again?, and drops the card', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new'); await fill(e); await e.submit(); await e.submit();
  await e.act('undo', { 'data-id': undoId(e.sheet()) });
  assert.match(e.sheet(), /Remove Spare keys again\?/);
  await e.submit();
  assert.deepEqual(e.client.rpcCalls('inventory_item_change_undo_v1')[0][2], { p_change_id: 'chg-n1' });
  assert.equal(e.client.rpcCalls('inventory_item_update_v1').length, 0);
  assert.equal(e.navs[e.navs.length - 1], '#stock');
});

test('s125 13: the Undo line lasts 30 minutes, not 15; after that it is gone', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new'); await fill(e); await e.submit(); await e.submit();
  e.advance(20 * 60000); await e.mount('item/n1'); assert.match(e.sheet(), /Added by you 20 min ago\./); assert.match(e.sheet(), /data-act="undo"/);
  e.advance(11 * 60000); await e.mount('item/n1'); assert.doesNotMatch(e.sheet(), /Added by you/);
});

test('s125 14: undo refusals say why: too_late, changed_since (stays, ask the owner), already_undone', async () => {
  const want = { too_late: /This can no longer be undone here\. Ask the owner to remove it\./, changed_since: /It was used or changed since, so it stays\. Ask the owner to remove it\./, already_undone: /It was already removed\./ };
  for (const [reason, re] of Object.entries(want)) {
    const e = await make('cleaner', { inventory_item_change_undo_v1: bad({ reason }) }); await e.mount(''); await e.act('add-new'); await fill(e); await e.submit(); await e.submit();
    await e.act('undo', { 'data-id': undoId(e.sheet()) }); await e.submit();
    assert.match(e.sheet(), re); assert.match(e.sheet(), />Close</); assert.doesNotMatch(e.sheet(), /Yes, undo it/);
  }
});

test('s125 15: Close asks before it throws typed input away; an untouched sheet closes at once; Keep editing returns', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.act('add-new'); await e.act('close'); assert.equal(e.sheet(), '');
  await e.act('add-new'); await e.input('I_f_name', 'Spare'); await e.act('close');
  assert.match(e.sheet(), /Throw away this new item\?/); assert.match(e.sheet(), /Keep editing/);
  await e.act('back'); assert.match(e.sheet(), /id="I_f_name"[^>]*value="Spare"/);
  await e.key('Escape'); assert.match(e.sheet(), /Throw away this new item\?/);
  await e.submit(); assert.equal(e.sheet(), ''); assert.equal(creates(e).length, 0);
  const p = await make('cleaner'); await p.mount(''); await p.input('I_q', 'Spare keys'); await p.act('add-new'); await p.act('close'); assert.equal(p.sheet(), ''); // the pre-filled name alone is not typed input
});

test('s125 16: a server that refuses (42501 before the SQL ships) gets one calm line, the sheet closes and the button goes away; no crash', async () => {
  const e = await make('cleaner', { inventory_item_create_v1: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) });
  await e.mount(''); await e.act('add-new'); await fill(e); await e.submit(); await e.submit();
  assert.equal(e.sheet(), ''); assert.match(e.toasts[e.toasts.length - 1], /You cannot add items yet\. Ask the owner\./);
  assert.doesNotMatch(e.html(), /data-act="add-new"/);
  const m = await make('cleaner', { inventory_item_create_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
  await m.mount(''); await m.act('add-new'); await fill(m); await m.submit(); await m.submit();
  assert.equal(m.sheet(), ''); assert.doesNotMatch(m.html(), /data-act="add-new"/);
});

test('s125 17: updatedKind created shows Added <date> by <name>; other kinds keep Updated', async () => {
  const c = { items: [item('i1', 'Toilet paper', 4, 12, { updatedAt: '2026-11-18T17:30:00Z', updatedBy: 'Honey Dela Cruz', updatedKind: 'created' }), item('i2', 'Hand soap', 0, 3, { updatedAt: '2026-11-18T17:30:00Z', updatedBy: 'Honey', updatedKind: 'details' })] };
  const e = await make('cleaner', {}, { cat: c }); await e.mount(''); await e.open('i1'); assert.match(e.sheet(), /Added Nov 19 by Honey/);
  await e.act('close'); await e.open('i2'); assert.match(e.sheet(), /Updated Nov 19 by Honey/);
});

test('s125 18: scanning an unknown code keeps New item for managers only, opens this same sheet with the code attached', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('scan');
  await e.input('I_f_code', '555000777'); await e.submit();
  assert.match(e.sheet(), /data-act="scan-new">New item</);
  await e.act('scan-new'); assert.match(e.sheet(), /class="sheet on I_sheet I_new"/); assert.match(e.sheet(), />New item</);
  await fill(e); await e.submit(); assert.match(e.sheet(), /Barcode<\/dt><dd>555000777/); await e.submit();
  assert.equal(creates(e)[0][2].p_code, '555000777');
  const c = await make('cleaner'); await c.mount(''); await c.act('scan'); await c.input('I_f_code', '555000777'); await c.submit();
  assert.doesNotMatch(c.sheet(), /data-act="scan-new"/);
  await c.act('scan-new'); assert.doesNotMatch(c.sheet(), /I_new/);
});

test('s125 19: the CSS carries the approved pieces and the version is 3.4.57 with cs-shell-v84', () => {
  const css = fs.readFileSync(path.join(here, '..', 'stock', 'I_stock.css'), 'utf8');
  assert.match(css, /\.sheet\.I_sheet\.I_new \{/); assert.match(css, /box-shadow: inset 0 3px 0 var\(--v5-gold\)/); assert.match(css, /\.I_srow\.I_srow3 \{ grid-template-columns: minmax\(0, 1fr\) auto auto; \}/);
  assert.match(css, /prefers-contrast: more\) \{ \.sheet\.I_sheet\.I_new/);
  assert.match(fs.readFileSync(path.join(here, '..', 'sw.js'), 'utf8'), /cs-shell-v84/);
  assert.match(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'), /"version": "3.4.57"/);
});

test('s125 20 (A4): a create whose answer was lost and replays as name_exists with the new item id opens it as already added, with no Undo line', async () => {
  let n = 0;
  const e = await make('cleaner', { inventory_item_create_v1: () => { if (++n === 1) throw { name: 'TypeError', message: 'Failed to fetch' }; return { data: { ok: false, reason: 'name_exists', item_id: 'i2' }, error: null }; } });
  await e.mount(''); await e.act('add-new'); await fill(e, 'Spare keys'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /Could not add it\./); await e.submit();
  assert.equal(e.navs[e.navs.length - 1], '#stock/item/i2'); assert.doesNotMatch(e.sheet(), /Added by you/); assert.doesNotMatch(e.sheet(), /data-act="undo"/);
  const k = creates(e).map((x) => x[2].p_idempotency_key); assert.equal(k[0], k[1]);
});

test('s125 21: a scan-new create with a code: Undo calls change_undo first, then detaches the code; a changed_since refusal never frees the code', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('scan'); await e.input('I_f_code', '555000777'); await e.submit();
  await e.act('scan-new'); await fill(e); await e.submit(); await e.submit();
  await e.act('undo', { 'data-id': undoId(e.sheet()) }); assert.match(e.sheet(), /free code/);
  await e.submit();
  const u = e.client.rpcCalls('inventory_item_change_undo_v1'), d = e.client.rpcCalls('inventory_code_detach_v1');
  assert.deepEqual(u[0][2], { p_change_id: 'chg-n1' }); assert.equal(d.length, 1); assert.equal(d[0][2].p_code, '555000777');
  const f = await make('owner', { inventory_item_change_undo_v1: bad({ reason: 'changed_since' }) }); await f.mount(''); await f.act('scan'); await f.input('I_f_code', '555000777'); await f.submit();
  await f.act('scan-new'); await fill(f); await f.submit(); await f.submit();
  await f.act('undo', { 'data-id': undoId(f.sheet()) }); await f.submit();
  assert.equal(f.client.rpcCalls('inventory_item_change_undo_v1').length, 1); assert.equal(f.client.rpcCalls('inventory_code_detach_v1').length, 0);
});

test('s125 22: Add item shows for cleaner and inspector (and owner), never for finance, laundry or maintenance', async () => {
  for (const role of ['cleaner', 'inspector', 'owner', 'admin']) { const e = await make(role); await e.mount(''); assert.match(e.html(), /data-act="add-new"/, role); }
  for (const role of ['finance', 'laundry', 'maintenance']) { const e = await make(role); await e.mount(''); assert.doesNotMatch(e.html(), /data-act="add-new"/, role); }
});

test('s125 23: a 22023 refusal is a server answer, not a lost one: a later name_exists is shown, not treated as already added', async () => {
  let n = 0;
  const e = await make('cleaner', { inventory_item_create_v1: () => { if (++n === 1) throw { code: '22023', message: 'invalid' }; return { data: { ok: false, reason: 'name_exists', item_id: 'i2' }, error: null }; } });
  await e.mount(''); await e.act('add-new'); await fill(e, 'Hand soaps'); await e.submit(); await e.submit(); await e.submit();
  assert.match(e.sheet(), /<h2 [^>]*>New item<\/h2>/); assert.match(e.sheet(), /already on the list/);
  assert.notEqual(e.navs[e.navs.length - 1], '#stock/item/i2');
});
