// s107: Inventory redesign. Pills, More menu, sticky search, flat rows, the item card's action bar, options order, the shopping list by shop, in-cart ticks, shop links, remembered view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const SUP = { id: 'sup1', name: 'Shopsuki', location: 'Gensan' };
const cat = () => ({ items: [
  item('a1', 'Toilet paper', 4, 12, { category: 'Bathroom', supplier: SUP, unitCost: 100, unitsPerPurchase: 1, purchaseUnit: 'pack', codes: ['4800000000011'] }),
  item('a2', 'Hand soap', 0, 3, { category: 'Kitchen', unit: 'bottles', supplier: SUP, unitCost: 50, unitsPerPurchase: 1, purchaseUnit: 'bottle' }),
  item('a3', 'Bath towels', 14, 10, { category: 'Linen', consumable: false, unit: 'pieces', unitCost: 200, unitsPerPurchase: 1 }),
  item('a4', 'Sponges', 9, 6, { category: 'Linen', unit: 'pieces' })
] });
const row = (id, itemId, name, qty, unit) => ({ id, item_id: itemId, item_name: name, quantity: qty, purchase_unit: unit, reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-12T02:00:00Z' });
const SHOP = [row('s1', 'a1', 'Toilet paper', 2, 'pack'), row('s2', 'a2', 'Hand soap', 3, 'bottle'), row('s3', 'a3', 'Bath towels', 1, 'piece')];
const make = (role = 'owner', o = {}) => setup({ role, ss: o.ss, client: mockClient({ catalogue: o.cat || cat(), shop: o.shop || [], rpc: o.rpc || {} }) });
const rule = async (sel) => { const fs = await import('node:fs'); const css = fs.readFileSync(new URL('../stock/I_stock.css', import.meta.url), 'utf8'); const m = new RegExp(sel.replace(/[.[\]()]/g, '\\$&') + ' \\{[^}]*\\}').exec(css); assert.ok(m, sel); return m[0]; };

test('I_s107 B9 chips: Low, To count, All, Consumables, then the categories, each with its count', async () => {
  const L = (await setup({ role: 'owner' })).lib, items = cat().items.map((r) => L.normalize(r, 'owner'));
  assert.equal(JSON.stringify(L.chipsFor(items, 2).map((c) => [c.k, c.n])), JSON.stringify([['low', 2], ['need', 2], ['all', 4], ['cons', 3], ['c:Bathroom', 1], ['c:Kitchen', 1], ['c:Linen', 2]]));
  assert.equal(L.chipsFor(items, 0).map((c) => c.k).slice(0, 3).join(), 'low,all,cons');
  const e = await make(); await e.mount('');
  assert.match(e.html(), /data-k="low"[^>]*>Low <span class="I_cn">2<\/span>/); assert.match(e.html(), /data-k="all"[^>]*>All <span class="I_cn">4<\/span>/);
});

test('I_s107 B3 status pills: glyph, number and word; each filters or opens the Shopping list; Stock is fine when nothing is low', async () => {
  const e = await make('owner', { shop: SHOP }); await e.mount('');
  const h = e.html();
  assert.match(h, /data-act="chip" data-k="low"><svg[^>]*>.*?<\/svg> 2 low<\/button>/); assert.match(h, /data-k="out"><svg[^>]*>.*?<\/svg> 1 out<\/button>/);
  assert.match(h, /data-act="tab" data-to="shopping"><svg[^>]*>.*?<\/svg> 3 on list<\/button>/); assert.doesNotMatch(h, /I_sum/);
  await e.act('chip', { 'data-k': 'out' });
  assert.match(e.html(), /Hand soap/); assert.doesNotMatch(e.html().slice(e.html().indexOf('I_list')), /Toilet paper/);
  const fine = await make('owner', { cat: { items: [item('b1', 'Candles', 9, 2)] } }); await fine.mount('');
  assert.match(fine.html(), /I_pok"><svg[^>]*>.*?<\/svg> Stock is fine/); assert.doesNotMatch(fine.html(), /data-k="out"/);
});

test('I_s107 B2 the More menu: Items tab holds add low, tidy, report and labels for the owner; Shopping holds share, image and PDF; a cleaner has no tidy or labels', async () => {
  const o = await make('owner', { shop: [SHOP[2]] }); await o.mount('');
  const m = /<details class="I_menu"><summary class="btn btn-ghost I_mbtn" aria-label="More inventory actions">[\s\S]*?<\/details>/.exec(o.html());
  assert.ok(m); for (const a of ['addlow-open', 'tidy', 'report', 'labels']) assert.match(m[0], new RegExp('data-act="' + a + '"'));
  await o.act('tab', { 'data-to': 'shopping' });
  const sm = /<details class="I_menu">[\s\S]*?<\/details>/.exec(o.html())[0];
  for (const a of ['shop-share', 'shop-image', 'report']) assert.match(sm, new RegExp('data-act="' + a + '"')); assert.match(sm, /PDF to Telegram/);
  const c = await make('cleaner'); await c.mount('');
  const cm = /<details class="I_menu">[\s\S]*?<\/details>/.exec(c.html())[0]; assert.doesNotMatch(cm, /tidy|labels/); assert.match(cm, /Send a report/);
  assert.doesNotMatch(o.html(), /I_repbtn/);
});

test('I_s107 B1/B4 Recent shows only while the search box is empty; the search keeps a hidden label, a Scan icon button and sits in a sticky block', async () => {
  const ls = {}; const e = await setup({ role: 'owner', ls, client: mockClient({ catalogue: cat() }) });
  await e.mount(''); await e.open('a1'); await e.act('close');
  assert.match(e.html(), /I_recent/);
  await e.input('I_q', 'soap'); assert.doesNotMatch(e.html(), /I_recent/); assert.match(e.html(), /Hand soap/);
  await e.input('I_q', ''); assert.match(e.html(), /I_recent/);
  assert.match(e.html(), /<label class="sr" for="I_q">Search items<\/label>/); assert.match(e.html(), /placeholder="Search items"/);
  assert.match(await rule('.I_find'), /position: sticky/); assert.match(await rule('.I_find'), /z-index: 4/);
  assert.match(await rule('.I_rc'), /max-width: 14rem/); assert.match(await rule('.I_rc'), /white-space: nowrap/); assert.doesNotMatch(await rule('.I_rc'), /anywhere/);
  assert.match(await rule('.I_recent'), /overflow-x: auto/);
});

test('I_s107 B5 flat rows: name, then level word and amount, one quick action; tags are glyphs with spoken words; no second footer line', async () => {
  const e = await make('owner', { shop: SHOP }); await e.mount('');
  const r = /<div class="I_it"><button class="rowi I_row I_irow"[^>]*data-id="a1"[\s\S]*?<\/div>/.exec(e.html())[0];
  assert.match(r, /Low<\/span> · 4 of 12 rolls/); assert.match(r, /<span class="sr">On the list<\/span>/); assert.match(r, /data-act="quick" data-kind="count"/);
  assert.doesNotMatch(e.html(), /I_foot2|I_tags|reorder at/);
  assert.match(e.html(), /Out<\/span> · 0 of 3 bottles/);
  assert.match(await rule('.I_irow .t'), /white-space: nowrap/); assert.match(await rule('.I_irow .t'), /text-overflow: ellipsis/);
  assert.match(await rule('.I_lbox'), /var\(--tabbar-h, 0px\) \+ 80px \+ env\(safe-area-inset-bottom, 0px\)/); // B15
});

test('I_s107 B6 the item card: sticky title and Close, one primary, status line when listed, never both a listed line and an add button, More grid', async () => {
  const e = await make('owner', { shop: SHOP }); await e.mount(''); await e.open('a4');
  let s = e.sheet();
  assert.match(s, /^<div class="scrim on"[^>]*><\/div><div class="sheet on I_sheet I_sheetm"[^>]*><div class="F_sheethead I_sh"><h2 class="hd I_sht" id="I_sh_t"[^>]*>Sponges<\/h2><button class="btn btn-secondary btn-sm F_close" type="button" data-act="close">/);
  assert.match(s, /I_actbar"><button class="btn btn-primary btn-block" type="button" data-act="begin" data-kind="count">Count it<\/button>/);
  assert.match(s, /<h3 class="I_hh">More<\/h3><div class="I_grid2">/); assert.match(s, /<details class="I_det" open>/);
  assert.ok(s.indexOf('I_actbar') < s.indexOf('I_det')); assert.match(s, /data-kind="shop"/); assert.doesNotMatch(s, /On the list/);
  await e.act('close'); await e.open('a1'); s = e.sheet();
  assert.match(s, /I_onlist"><svg[^>]*>.*?<\/svg> On the list, 2 packs/); assert.doesNotMatch(s, /data-kind="shop"|data-kind="low"|On the shopping list/);
  assert.match(s, /<span class="I_lv I_low"><svg[^>]*>.*?<\/svg> Low<\/span> 4 of 12 rolls/);
  await e.act('close'); await e.open('a2'); // out and not listed would be Add to list; a2 is listed in SHOP so the status line wins
  assert.doesNotMatch(e.sheet(), /data-kind="low"/);
  const f = await make('owner'); await f.mount(''); await f.open('a2');
  assert.match(f.sheet(), /I_actbar"><button class="btn btn-primary btn-block" type="button" data-act="begin" data-kind="low">Add to list<\/button>/);
  const c = await make('cleaner'); await c.mount(''); await c.open('a1');
  assert.match(c.sheet(), /I_actbar"><button class="btn btn-primary btn-block" type="button" data-act="begin" data-kind="used">Record use<\/button><button class="btn btn-secondary btn-block" type="button" data-act="begin" data-kind="low">Running low<\/button>/);
});

test('I_s107 B7 options sort: usual, preferred, in stock, then cheapest for price roles, by title for the rest; others collapse with ghost buttons', async () => {
  const L = (await setup({ role: 'owner' })).lib;
  const mk = (id, title, o) => Object.assign({ id, title, usual: false, preferred: false, available: true, price: null }, o);
  const l = [mk('o1', 'Zed', { price: 50 }), mk('o2', 'Beta', { price: 90, preferred: true }), mk('o3', 'Cheap', { price: 10 }), mk('o4', 'Gone', { price: 5, available: false }), mk('o5', 'Usual one', { usual: true, price: 300 }), mk('o6', 'Alpha', { price: 90 })];
  assert.deepEqual(L.optSort(l, true).map((o) => o.id), ['o5', 'o2', 'o3', 'o1', 'o6', 'o4']);
  assert.deepEqual(L.optSort(l, false).map((o) => o.id), ['o5', 'o2', 'o6', 'o3', 'o1', 'o4']);
  const opts = { ok: true, item_id: 'a1', options: [
    { id: 'o1', supplier: 'Shopsuki', title: 'Usual tissue', usual: true, available: true, image_url: 'https://x.example/a.jpg', source_url: 'https://shopsuki.ph/p/1', price: 200 },
    { id: 'o2', supplier: 'Shopsuki', title: 'Other tissue', usual: false, available: true, image_url: 'https://x.example/b.jpg', source_url: null, price: 150 }] };
  const e = await make('owner', { rpc: { inventory_item_options_v1: () => ({ data: opts, error: null }) } }); await e.mount(''); await e.open('a1');
  const s = e.sheet(), main = s.slice(s.indexOf('I_opts'), s.indexOf('<details class="I_other"'));
  assert.match(main, /Usual tissue/); assert.doesNotMatch(main, /opt-photo|opt-usual/);
  assert.match(s, /<details class="I_other"><summary>Other options \(1\)<\/summary>[\s\S]*data-act="opt-usual" data-id="o2"[\s\S]*data-act="opt-photo" data-id="o2"/);
  assert.match(s, /btn btn-ghost I_undobtn" type="button" data-act="opt-usual"/); assert.doesNotMatch(s, /btn-secondary I_undobtn/);
});

test('I_s107 B10 the shopping list is grouped by shop with an item count and, for price roles, a subtotal; a cleaner sees no money', async () => {
  const e = await make('owner', { shop: SHOP }); await e.mount('shopping');
  assert.match(e.html(), /<h3 class="I_gh" id="I_sg_0">No shop set · 1 item · ₱200<\/h3>|<h3 class="I_gh" id="I_sg_1">No shop set · 1 item · ₱200<\/h3>/);
  assert.match(e.html(), />Shopsuki · 2 items · ₱350<\/h3>/); // 2 x 100 + 3 x 50
  assert.ok(e.html().indexOf('Shopsuki · 2 items') < e.html().indexOf('No shop set')); // an unknown shop comes last
  const c = await make('cleaner', { shop: SHOP }); await c.mount('shopping');
  assert.match(c.html(), />Shopsuki · 2 items<\/h3>/); assert.doesNotMatch(c.html(), /₱/);
});

test('I_s107 B11/B12 an in-cart tick is local: it sinks the row, is kept for the visit, and pre-selects the Bought sheet', async () => {
  const ss = {}; const e = await make('owner', { shop: SHOP, ss }); await e.mount('shopping');
  assert.match(e.html(), />Bought some of these</); assert.match(e.html(), /class="sticky I_stk"/);
  const before = e.client.calls.length;
  await e.act('cart', { 'data-id': 's1' });
  assert.match(e.html(), /I_incart[^>]*>[\s\S]*?Toilet paper/); assert.match(e.html(), /data-act="cart" data-id="s1" aria-pressed="true"/);
  assert.deepEqual(JSON.parse(ss.cs_I_cart), { role: 'owner', ids: ['s1'] });
  assert.equal(e.client.rpcCalls('save_shopping_item_v1').length, 0); assert.equal(e.client.calls.slice(before).filter((c) => c[0] === 'rpc' && /shopping/.test(c[1])).length, 0);
  const h = e.html(); assert.ok(h.indexOf('Hand soap') < h.indexOf('Toilet paper') || h.indexOf('Shopsuki') < 0, 'ticked row sinks within its shop');
  assert.match(e.html(), />Bought these \(1\)</);
  await e.act('bought-open');
  assert.match(e.sheet(), /data-act="b-tick" data-id="s1" aria-pressed="true"/); assert.match(e.sheet(), /data-act="b-tick" data-id="s2" aria-pressed="false"/);
  await e.act('close'); await e.act('cart', { 'data-id': 's1' });
  assert.match(e.html(), />Bought some of these</); assert.deepEqual(JSON.parse(ss.cs_I_cart).ids, []);
  const blocked = await setup({ role: 'owner', client: mockClient({ catalogue: cat(), shop: SHOP }) }); await blocked.mount('shopping'); await blocked.act('cart', { 'data-id': 's2' }); // no session store: still works
  assert.match(blocked.html(), /data-id="s2" aria-pressed="true"/);
});

test('I_s107 B13 each listed item gets one options read and its usual option becomes an Open in shop link; a failed read does not loop', async () => {
  const opt = (id) => ({ ok: true, item_id: id, options: [{ id: 'o' + id, supplier: 'Shopsuki', title: 'T', usual: true, available: true, source_url: 'https://shopsuki.ph/p/' + id, image_url: null }] });
  const e = await make('owner', { shop: SHOP, rpc: { inventory_item_options_v1: (a) => ({ data: opt(a.p_item_id), error: null }) } }); await e.mount('shopping');
  assert.equal(e.client.rpcCalls('inventory_item_options_v1').length, 3);
  assert.match(e.html(), /<a class="btn btn-ghost I_shopa" href="https:\/\/shopsuki\.ph\/p\/a1" target="_blank" rel="noopener noreferrer" aria-label="Open Toilet paper in Shopsuki">/);
  await e.act('cart', { 'data-id': 's1' }); assert.equal(e.client.rpcCalls('inventory_item_options_v1').length, 3, 'cached');
  const c = await make('cleaner', { shop: SHOP, rpc: { inventory_item_options_v1: (a) => ({ data: opt(a.p_item_id), error: null }) } }); await c.mount('shopping');
  assert.match(c.html(), /I_shopa/);
  const bad = await make('owner', { shop: SHOP, rpc: { inventory_item_options_v1: () => ({ data: null, error: { code: 'XX', message: 'boom' } }) } }); await bad.mount('shopping');
  assert.equal(bad.client.rpcCalls('inventory_item_options_v1').length, 3); await bad.act('cart', { 'data-id': 's1' }); assert.equal(bad.client.rpcCalls('inventory_item_options_v1').length, 3, 'not retried within a minute');
  assert.doesNotMatch(bad.html(), /I_shopa/);
});

test('I_s107 B14 the tab and chip come back once per visit; a store that throws changes nothing', async () => {
  const ss = { cs_I_view: JSON.stringify({ role: 'owner', tab: 'shopping', chip: 'all' }) };
  const e = await make('owner', { shop: SHOP, ss }); await e.mount('');
  assert.equal(e.navs[e.navs.length - 1], '#stock/shopping'); assert.match(e.html(), /aria-pressed="true">Shopping list/);
  await e.act('tab', { 'data-to': '' });
  assert.equal(JSON.parse(ss.cs_I_view).tab, ''); assert.match(e.html(), /data-k="all"[^>]*aria-pressed="true"/);
  await e.act('chip', { 'data-k': 'cons' }); assert.equal(JSON.parse(ss.cs_I_view).chip, 'cons');
  const other = await make('cleaner', { ss: { cs_I_view: JSON.stringify({ role: 'owner', tab: 'shopping', chip: 'all' }) } }); await other.mount('');
  assert.equal(other.navs.length, 0); // another role's view is not applied
  const boom = await make('owner'); boom.win.sessionStorage = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  await boom.mount(''); await boom.act('chip', { 'data-k': 'all' }); assert.match(boom.html(), /Toilet paper/);
});

test('I_s107 B8 a cleaner sees Running low on a low row not yet listed, Use otherwise', async () => {
  const c = await make('cleaner', { shop: [SHOP[0]] }); await c.mount('');
  const kind = (id) => (new RegExp('data-act="quick" data-kind="([a-z]+)" data-id="' + id + '"').exec(c.html()) || [])[1];
  assert.equal(kind('a2'), 'low'); assert.equal(kind('a1'), 'used'); assert.equal(kind('a3'), 'used');
  assert.match(c.html(), />Running low</); assert.match(c.html(), />Use</);
});
