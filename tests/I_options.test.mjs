// s106: Shopsuki options on the item card. Read inventory_item_options_v1, Make usual (inventory_item_option_set_usual_v1) with Undo,
// Use as item photo through the existing add-photo pipeline, role gating, probe-and-hide when the SQL release is not applied yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, mockClient, item, NOW, here, FakeBlob } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const NEWP = 'items/55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.webp';
const IMG = 'https://cdn.shopify.com/s/files/1/0358/1335/9748/files/4902430093767.jpg';
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen' })], sourceAsOf: NOW });
const opts = (usualId, withPrice) => ({ ok: true, item_id: 'i1', options: [
  { id: 'o1', supplier_id: 's1', supplier: 'Shopsuki', title: 'Joy Dishwashing Liquid Kalamansi 375ml', brand: 'Joy', pack_label: null, pack_size: null, image_url: IMG, source_url: 'https://shopsuki.ph/products/joy-375', usual: usualId === 'o1', available: true, captured_at: NOW, ...(withPrice ? { price: 115.65 } : {}) },
  { id: 'o2', supplier_id: 's1', supplier: 'Shopsuki', title: 'Joy Dishwashing Liquid Lemon 250ml', brand: 'Joy', pack_label: null, pack_size: null, image_url: null, source_url: 'https://shopsuki.ph/products/joy-250', usual: usualId === 'o2', available: false, captured_at: NOW, ...(withPrice ? { price: 86.85 } : {}) }
] });
const upload = (b) => (b.action === 'sign' ? { data: { ok: true, urls: {} }, error: null } : { data: { ok: true, path: NEWP, signedUrl: 'https://stay.example/s/' + NEWP }, error: null });
let usual = 'o1';
const make = (role = 'owner', o = {}) => { usual = 'o1'; return setup({ role, doc: {}, client: mockClient({ catalogue: raw(), rpc: {
  inventory_item_options_v1: () => ({ data: opts(usual, ['owner', 'admin', 'finance'].includes(role)), error: null }),
  inventory_item_option_set_usual_v1: (a) => { usual = a.p_option_id; return { data: opts(usual, ['owner', 'admin', 'finance'].includes(role)), error: null }; },
  inventory_item_photo_set_v1: () => ({ data: { ok: true, before: null }, error: null }), ...(o.rpc || {}) }, fn: { 'upload-photo': upload } }) }); };
const calls = (e, n) => e.client.rpcCalls(n);
const goodFetch = (e, log) => { e.win.fetch = async (url, init) => { log.push([url, init]); return { ok: true, blob: async () => new FakeBlob('image/jpeg', 50000) }; }; };

test('I_options the Options section: 56 px lazy thumbnail with alt, title, brand, supplier, Usual tag, price, Out of stock, View link', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1');
  const s = e.sheet();
  assert.match(s, /<h3 class="I_opth">Options<\/h3>/);
  assert.match(s, /<img src="https:\/\/cdn\.shopify\.com\/[^"]+4902430093767\.jpg" alt="Joy Dishwashing Liquid Kalamansi 375ml" width="56" height="56" loading="lazy"/);
  assert.match(s, /Joy · Shopsuki/); assert.match(s, /I_usual">Usual</); assert.equal((s.match(/I_usual">Usual</g) || []).length, 1);
  assert.match(s, /₱115\.65/); assert.match(s, /₱86\.85/); assert.match(s, /Out of stock/); assert.equal((s.match(/Out of stock/g) || []).length, 1);
  assert.match(s, /<a class="btn btn-ghost I_undobtn" href="https:\/\/shopsuki\.ph\/products\/joy-375" target="_blank" rel="noopener">View on Shopsuki<\/a>/);
  assert.equal(calls(e, 'inventory_item_options_v1').length, 1); assert.deepEqual(calls(e, 'inventory_item_options_v1')[0][2], { p_item_id: 'i1' });
  // the option without a picture keeps the reserved box with the placeholder glyph
  assert.equal((s.match(/class="I_oth"/g) || []).length, 2); assert.equal((s.match(/<img src="https:\/\/cdn\.shopify/g) || []).length, 1);
});

test('I_options a picture that fails to load falls back to the placeholder and stays that way after a redraw', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1');
  const t = { getAttribute: (k) => ({ 'data-oimg': '1', src: IMG })[k] || null };
  for (const f of e.root.l.error || []) await f({ target: t });
  assert.doesNotMatch(e.sheet(), /cdn\.shopify\.com/); assert.equal((e.sheet().match(/class="I_oth"/g) || []).length, 2);
});

test('I_options role gating: owner and admin get Make usual and Use as item photo; finance sees prices only; the cleaner sees options with no money and no buttons', async () => {
  for (const role of ['owner', 'admin']) {
    const e = await make(role); await e.mount(''); await e.open('i1');
    assert.match(e.sheet(), /data-act="opt-usual" data-id="o2"/, role); assert.doesNotMatch(e.sheet(), /data-act="opt-usual" data-id="o1"/, role + ': the usual one has no Make usual');
    assert.match(e.sheet(), /data-act="opt-photo" data-id="o1"/, role); assert.doesNotMatch(e.sheet(), /data-act="opt-photo" data-id="o2"/, role + ': no picture, no photo button');
  }
  const f = await make('finance'); await f.mount(''); await f.open('i1');
  assert.match(f.sheet(), /₱115\.65/); assert.doesNotMatch(f.sheet(), /opt-usual|opt-photo/);
  const c = await make('cleaner'); await c.mount(''); await c.open('i1');
  assert.match(c.sheet(), /Options/); assert.match(c.sheet(), /Joy Dishwashing Liquid Kalamansi/); assert.doesNotMatch(c.sheet(), /opt-usual|opt-photo/);
  assert.doesNotMatch(c.sheet(), /₱|PHP/, 'no money for a cleaner');
  // even a payload that wrongly carried a price renders none for a cleaner
  const w = await make('cleaner', { rpc: { inventory_item_options_v1: () => ({ data: opts('o1', true), error: null }) } }); await w.mount(''); await w.open('i1');
  assert.doesNotMatch(w.sheet(), /₱/);
});

test('I_options PGRST202 hides the section silently for the visit; an empty list shows nothing', async () => {
  const e = await make('owner', { rpc: { inventory_item_options_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await e.mount(''); await e.open('i1');
  assert.doesNotMatch(e.sheet(), /Options/); assert.equal(e.toasts.length, 0); assert.doesNotMatch(e.sheet(), /role="alert"/);
  await e.act('close'); await e.open('i2');
  assert.equal(calls(e, 'inventory_item_options_v1').length, 1, 'not asked again this visit');
  const z = await make('owner', { rpc: { inventory_item_options_v1: () => ({ data: { ok: true, item_id: 'i1', options: [] }, error: null }) } });
  await z.mount(''); await z.open('i1'); assert.doesNotMatch(z.sheet(), /Options/);
});

test('I_options Make usual: confirm first, then inventory_item_option_set_usual_v1 {p_option_id}; the list redraws and Undo sets the previous usual back', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1');
  await e.act('opt-usual', { 'data-id': 'o2' });
  assert.match(e.sheet(), /Make this the usual for Toilet paper\?/); assert.match(e.sheet(), /Joy Dishwashing Liquid Lemon 250ml from Shopsuki at ₱86\.85/);
  assert.equal(calls(e, 'inventory_item_option_set_usual_v1').length, 0, 'nothing sent before Yes');
  await e.submit();
  const c = calls(e, 'inventory_item_option_set_usual_v1');
  assert.equal(c.length, 1); assert.deepEqual(c[0][2], { p_option_id: 'o2' });
  assert.match(e.sheet(), /Options/); assert.match(e.sheet(), /data-act="opt-usual" data-id="o1"/); assert.doesNotMatch(e.sheet(), /data-act="opt-usual" data-id="o2"/, 'the tag moved to the other option');
  assert.match(e.sheet(), /Last change: changed the usual option/);
  const id = /data-act="undo" data-id="(u\d+)"/.exec(e.sheet())[1];
  await e.act('undo', { 'data-id': id });
  assert.match(e.sheet(), /Make Joy Dishwashing Liquid Kalamansi 375ml the usual for Toilet paper again\?/);
  await e.submit();
  assert.equal(calls(e, 'inventory_item_option_set_usual_v1').length, 2); assert.deepEqual(calls(e, 'inventory_item_option_set_usual_v1')[1][2], { p_option_id: 'o1' });
  assert.equal(usual, 'o1');
});

test('I_options Make usual that the server does not have yet hides the button for the visit', async () => {
  const e = await make('owner', { rpc: { inventory_item_option_set_usual_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await e.mount(''); await e.open('i1'); await e.act('opt-usual', { 'data-id': 'o2' }); await e.submit();
  assert.doesNotMatch(e.sheet(), /opt-usual/); assert.match(e.sheet(), /Options/);
});

test('I_options Use as item photo: the picture is fetched, resized and confirmed, then the existing upload-photo and inventory_item_photo_set_v1 calls, with Undo', async () => {
  const e = await make('owner'); const log = []; goodFetch(e, log);
  await e.mount(''); await e.open('i1');
  await e.act('opt-photo', { 'data-id': 'o1' });
  assert.equal(log.length, 1); assert.equal(log[0][0], IMG);
  assert.match(e.sheet(), /Use this photo for Toilet paper\?/); assert.match(e.sheet(), /<img src="blob:fake-/);
  assert.equal(e.client.fnCalls('upload-photo').filter((c) => !c[2].action).length, 0, 'nothing uploaded before Yes');
  await e.submit();
  const up = e.client.fnCalls('upload-photo').filter((c) => !c[2].action);
  assert.equal(up.length, 1); assert.deepEqual(Object.keys(up[0][2]).sort(), ['fileData', 'itemId', 'mimeType', 'propertyId', 'purpose']);
  assert.equal(up[0][2].purpose, 'inventory'); assert.equal(up[0][2].itemId, 'i1'); assert.equal(up[0][2].propertyId, PID); assert.equal(up[0][2].mimeType, 'image/webp');
  assert.deepEqual(calls(e, 'inventory_item_photo_set_v1').map((c) => c[2]), [{ p_item_id: 'i1', p_path: NEWP }]);
  assert.match(e.undo() + e.sheet(), /Photo saved for Toilet paper|changed the photo/);
});

test('I_options Use as item photo: a picture that cannot be fetched says so plainly and writes nothing', async () => {
  for (const bad of [async () => { throw new TypeError('Failed to fetch'); }, async () => ({ ok: false, status: 403, blob: async () => null })]) {
    const e = await make('owner'); e.win.fetch = bad;
    await e.mount(''); await e.open('i1'); await e.act('opt-photo', { 'data-id': 'o1' });
    assert.match(e.sheet(), /The picture could not be fetched/);
    assert.equal(e.client.fnCalls('upload-photo').length, 0); assert.equal(calls(e, 'inventory_item_photo_set_v1').length, 0);
  }
  const e = await make('owner'); await e.mount(''); await e.open('i1'); await e.act('opt-photo', { 'data-id': 'o1' }); // no fetch at all
  assert.match(e.sheet(), /could not be fetched/);
});

test('I_options a cleaner cannot start Make usual or Use as item photo even by a forged action', async () => {
  const e = await make('cleaner'); const log = []; goodFetch(e, log); await e.mount(''); await e.open('i1');
  await e.act('opt-usual', { 'data-id': 'o2' }); await e.act('opt-photo', { 'data-id': 'o1' });
  assert.equal(log.length, 0); assert.doesNotMatch(e.sheet(), /Make this the usual|Use this photo/);
  assert.equal(calls(e, 'inventory_item_option_set_usual_v1').length, 0);
});

test('I_options demo: synthetic options with no network; writes say Demo', async () => {
  const d = await setup({ role: 'owner', demo: true });
  await d.mount(''); await d.open('d1');
  assert.match(d.sheet(), /Options/); assert.match(d.sheet(), /Softly Bath Tissue/); assert.match(d.sheet(), /Out of stock/); assert.match(d.sheet(), /I_usual">Usual</);
  await d.act('opt-usual', { 'data-id': 'o2' }); await d.submit();
  assert.match(d.toasts[d.toasts.length - 1], /Demo only/);
});

test('I_options the page allows images from cdn.shopify.com: no CSP meta restricts them (or img-src lists the host)', () => {
  const pages = ['index.html'].map((f) => fs.readFileSync(path.join(here, '..', f), 'utf8'));
  for (const h of pages) {
    const m = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(h);
    if (m) assert.match(m[0], /img-src[^;"']*https:\/\/cdn\.shopify\.com/);
  }
  const sw = fs.readFileSync(path.join(here, '..', 'sw.js'), 'utf8');
  assert.match(sw, /url\.origin !== self\.location\.origin\) return;/, 'the service worker leaves cross-origin pictures to the browser');
  assert.doesNotMatch(sw, /shopify/);
});
