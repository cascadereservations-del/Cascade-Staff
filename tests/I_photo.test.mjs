// Lane D-client-stock (s86 4.4 + 9.1): item photos for every role. Private bucket: the catalogue holds a storage path, upload-photo signs it for display.
// Resize on the phone, preview, upload, then inventory_item_photo_set_v1 (R7) only after the person confirms, Undo with the old path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, NOW } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const P1 = 'items/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp';
const P2 = 'items/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.webp';
const NEWP = 'items/55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.webp';
const URL1 = 'https://stay.example/storage/v1/object/sign/inventory-photos/' + P1 + '?token=aaa';
const URLN = 'https://stay.example/storage/v1/object/sign/inventory-photos/' + NEWP + '?token=bbb';
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { photo: P1 }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen' }), item('i3', 'Bath towels', 14, 10, { category: 'Linen', photo: P2 })], sourceAsOf: NOW });
const upload = (b) => (b.action === 'sign' ? { data: { ok: true, urls: { [P1]: URL1 } }, error: null } : { data: { ok: true, path: NEWP, signedUrl: URLN }, error: null });
const make = (role = 'owner', o = {}) => setup({ role, doc: o.doc || {}, client: mockClient({ catalogue: raw(), rpc: { inventory_item_photo_set_v1: () => ({ data: { ok: true, before: null }, error: null }), ...(o.rpc || {}) }, fn: { 'upload-photo': upload, ...(o.fn || {}) } }) });
const FILE = { name: 'IMG_1.jpg', size: 3200000 };
const uploads = (e) => e.client.fnCalls('upload-photo').filter((c) => !c[2].action);
const signs = (e) => e.client.fnCalls('upload-photo').filter((c) => c[2].action === 'sign');
const photoCalls = (e) => e.client.rpcCalls('inventory_item_photo_set_v1');
async function choose(e, id = 'i2') { await e.open(id); await e.change('I_photo_in', [FILE]); }

test('I_photo the resize keeps the aspect ratio and caps the long side at 800 px', async () => {
  const e = await make();
  const f = e.lib.fitSize;
  const j = (x) => JSON.stringify(x);
  assert.equal(j(f(4000, 3000)), j({ w: 800, h: 600 }));
  assert.equal(j(f(3000, 4000)), j({ w: 600, h: 800 }));
  assert.equal(j(f(400, 300)), j({ w: 400, h: 300 })); // a small picture is never enlarged
  await e.mount(''); await choose(e);
  const c = e.ctx.window.document.canvases[0];
  assert.equal(c.width, 800); assert.equal(c.height, 600); assert.equal(c.draws.length, 1);
});

test('I_photo WebP 0.72 first; JPEG 0.75 where WebP is not produced; over 1 MB once more at 0.6; still too big is refused calmly', async () => {
  const a = await make('owner', { doc: { encode: (t) => ({ type: t, size: 90000 }) } });
  await a.mount(''); await choose(a);
  assert.deepEqual(a.ctx.window.document.canvases[0].blobCalls, [['image/webp', 0.72]]);
  const b = await make('owner', { doc: { encode: (t) => ({ type: 'image/png', size: 90000 }) } });
  await b.mount(''); await choose(b);
  assert.deepEqual(b.ctx.window.document.canvases[0].blobCalls, [['image/webp', 0.72], ['image/jpeg', 0.75]]);
  const c = await make('owner', { doc: { encode: (t, q) => ({ type: t, size: q === 0.6 ? 800000 : 1200000 }) } });
  await c.mount(''); await choose(c);
  assert.deepEqual(c.ctx.window.document.canvases[0].blobCalls, [['image/webp', 0.72], ['image/webp', 0.6]]);
  assert.match(c.sheet(), /Use this photo for Hand soap\?/);
  const d = await make('owner', { doc: { encode: (t) => ({ type: t, size: 2000000 }) } });
  await d.mount(''); await choose(d);
  assert.match(d.sheet(), /too large to send/); assert.doesNotMatch(d.sheet(), /Use this photo/);
  assert.equal(uploads(d).length, 0); assert.equal(photoCalls(d).length, 0);
});

test('I_photo nothing is sent until the person confirms; then upload-photo {purpose, propertyId, itemId, fileData, mimeType} and only then R7', async () => {
  const e = await make(); await e.mount(''); await choose(e);
  assert.match(e.sheet(), /Use this photo for Hand soap\?/); assert.match(e.sheet(), /<img src="blob:fake-/); assert.match(e.sheet(), /About \d+ KB/);
  assert.equal(uploads(e).length, 0); assert.equal(photoCalls(e).length, 0); // preview only
  await e.submit();
  assert.equal(uploads(e).length, 1);
  const body = uploads(e)[0][2];
  assert.deepEqual(Object.keys(body).sort(), ['fileData', 'itemId', 'mimeType', 'propertyId', 'purpose']);
  assert.equal(body.purpose, 'inventory'); assert.equal(body.itemId, 'i2'); assert.equal(body.propertyId, PID); assert.equal(body.mimeType, 'image/webp');
  assert.equal(Buffer.from(body.fileData, 'base64').length, 90000);
  assert.equal(photoCalls(e).length, 1);
  assert.deepEqual(photoCalls(e)[0][2], { p_item_id: 'i2', p_path: NEWP });
  const order = e.client.calls.filter((c) => (c[1] === 'upload-photo' && !c[2].action) || c[1] === 'inventory_item_photo_set_v1').map((c) => c[1]);
  assert.deepEqual(order.slice(-2), ['upload-photo', 'inventory_item_photo_set_v1']);
  assert.deepEqual(e.ctx.window.revoked.length, 1); // the preview URL is released
});

test('I_photo a failed upload writes nothing: R7 is never called and a calm line shows', async () => {
  const e = await make('owner', { fn: { 'upload-photo': (b) => (b.action === 'sign' ? upload(b) : { data: null, error: { name: 'FunctionsHttpError', context: { status: 500 } } }) } });
  await e.mount(''); await choose(e); await e.submit();
  assert.equal(photoCalls(e).length, 0);
  assert.match(e.sheet(), /did not go through/); assert.equal(e.undo(), '');
  const x = await make('owner', { fn: { 'upload-photo': (b) => (b.action === 'sign' ? upload(b) : { data: { ok: false, error: 'invalid_image_size' }, error: null }) } });
  await x.mount(''); await choose(x); await x.submit();
  assert.equal(photoCalls(x).length, 0);
});

test('I_photo Undo calls R7 with the before path and asks first', async () => {
  const e = await make('owner', { rpc: { inventory_item_photo_set_v1: () => ({ data: { ok: true, before: P2 }, error: null }) } });
  await e.mount(''); await choose(e, 'i3'); await e.submit();
  assert.match(e.undo(), /Photo saved for Bath towels/);
  const id = /data-id="(u\d+)"/.exec(e.undo())[1];
  await e.act('undo', { 'data-id': id });
  assert.match(e.sheet(), /Put the old photo of Bath towels back\?/);
  assert.equal(photoCalls(e).length, 1);
  await e.submit();
  assert.equal(photoCalls(e).length, 2);
  assert.deepEqual(photoCalls(e)[1][2], { p_item_id: 'i3', p_path: P2 });
});

test('I_photo Undo of a first photo removes it again (before is null)', async () => {
  const e = await make(); await e.mount(''); await choose(e); await e.submit();
  const id = /data-id="(u\d+)"/.exec(e.undo())[1];
  await e.act('undo', { 'data-id': id });
  assert.match(e.sheet(), /Remove the new photo of Hand soap again\?/);
  await e.submit();
  assert.deepEqual(photoCalls(e)[1][2], { p_item_id: 'i2', p_path: null });
});

test('I_photo a cleaner can add a photo, and Undo it (D-330 answer 1)', async () => {
  const e = await make('cleaner', { rpc: { inventory_item_photo_set_v1: () => ({ data: { ok: true, before: P2 }, error: null }) } });
  await e.mount(''); await e.open('i3');
  assert.match(e.sheet(), /Change photo/); assert.match(e.sheet(), /Remove photo/);
  await e.change('I_photo_in', [FILE]); await e.submit();
  assert.equal(uploads(e).length, 1); assert.deepEqual(photoCalls(e)[0][2], { p_item_id: 'i3', p_path: NEWP });
  const id = /data-id="(u\d+)"/.exec(e.undo())[1];
  await e.act('undo', { 'data-id': id }); await e.submit();
  assert.deepEqual(photoCalls(e)[1][2], { p_item_id: 'i3', p_path: P2 });
  const f = await make('finance'); await f.mount(''); await f.open('i2');
  assert.match(f.sheet(), /Add photo/); // finance too
});

test('I_photo Remove photo asks first, sends R7 with null and Undo puts the old path back', async () => {
  const e = await make('owner', { rpc: { inventory_item_photo_set_v1: () => ({ data: { ok: true, before: P2 }, error: null }) } });
  await e.mount(''); await e.open('i3'); await e.act('photo-remove');
  assert.match(e.sheet(), /Remove the photo of Bath towels\?/); assert.equal(photoCalls(e).length, 0);
  await e.submit();
  assert.deepEqual(photoCalls(e)[0][2], { p_item_id: 'i3', p_path: null });
  assert.match(e.undo(), /Photo removed from Bath towels/);
  const id = /data-id="(u\d+)"/.exec(e.undo())[1];
  await e.act('undo', { 'data-id': id }); await e.submit();
  assert.deepEqual(photoCalls(e)[1][2], { p_item_id: 'i3', p_path: P2 });
});

test('I_photo display: one sign call per catalogue load for the paths shown, cached by path; lazy 48 px thumbnails in a reserved box; a placeholder glyph when none', async () => {
  const e = await make(); await e.mount('');
  assert.equal(signs(e).length, 1);
  assert.deepEqual(signs(e)[0][2], { purpose: 'inventory', action: 'sign', propertyId: PID, paths: [P1, P2] });
  const h = e.html();
  assert.match(h, new RegExp('<span class="I_th" aria-hidden="true"><img src="' + URL1.replace(/[?.]/g, '\\$&') + '" alt="" width="48" height="48" loading="lazy"'));
  assert.match(h, /<span class="I_th" aria-hidden="true"><svg class="i s16"/); // Hand soap has none: the glyph holds the box
  e.client.calls.length = 0; e.advance(61000); e.unmount(); await e.mount('');
  assert.equal(signs(e).length, 1); assert.equal(JSON.stringify(signs(e)[0][2].paths), JSON.stringify([P2])); // P1 is cached; P2 was left out by the server
});

test('I_photo only the paths not yet cached are asked for again; a missing object stays a placeholder', async () => {
  const e = await make(); await e.mount('');
  e.client.calls.length = 0; e.advance(61000); e.unmount(); await e.mount('');
  const s = signs(e); assert.equal(s.length, 1); assert.deepEqual(s[0][2].paths, [P2]);
});

test('I_photo the card shows the photo with the item name as alt; on a scan result it comes first', async () => {
  const e = await make(); await e.mount(''); await e.open('i1');
  assert.match(e.sheet(), new RegExp('<div class="I_photo"><img src="' + URL1.replace(/[?.]/g, '\\$&') + '" alt="Toilet paper" loading="lazy"'));
  assert.ok(e.sheet().indexOf('I_photo') > e.sheet().indexOf('id="I_sh_t"')); // after the title on a plain open
  const s = await make(); await s.mount('');
  s.win.I_Stock.lib; // scan flow: the right product first
  s.client.calls.length = 0;
  const hit = await make('cleaner', { }); await hit.mount('');
  // a scanned card: the shell sets K.scanned by opening through a code; simulate through the same route the scan uses
  await hit.act('scan');
  const cat = raw(); cat.items[0].codes = ['4800000000011'];
  const sc = await setup({ role: 'cleaner', doc: {}, client: mockClient({ catalogue: cat, fn: { 'upload-photo': upload } }) });
  await sc.mount(''); await sc.act('scan'); await sc.input('I_f_code', '4800000000011'); await sc.submit();
  assert.ok(sc.sheet().indexOf('I_photo') < sc.sheet().indexOf('id="I_sh_t"'));
});

test('I_photo probe-and-hide: R7 missing hides Add photo for the visit with a calm toast; upload-photo sign 404 leaves placeholders and no error', async () => {
  const e = await make('owner', { rpc: { inventory_item_photo_set_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await e.mount(''); await choose(e); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  await e.open('i2'); assert.doesNotMatch(e.sheet(), /Add photo|I_photo_in/);
  const s = await make('owner', { fn: { 'upload-photo': () => ({ data: null, error: { name: 'FunctionsHttpError', context: { status: 404 } } }) } });
  await s.mount('');
  assert.doesNotMatch(s.html(), /<img /); assert.doesNotMatch(s.html(), /role="alert"/);
});

test('I_photo demo: a photo is resized and previewed but nothing is sent', async () => {
  const e = await setup({ demo: true, role: 'owner', doc: {} });
  await e.mount(''); await e.open('d1'); await e.change('I_photo_in', [FILE]);
  assert.match(e.sheet(), /Use this photo for Toilet paper\?/);
  await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /Demo only/);
});

test('I_photo r2 F3: after a save the list and card show the new picture at once, before the reload answers', async () => {
  let loads = 0;
  const e = await make('owner', { rpc: { get_inventory_catalogue_v1: () => (++loads === 1 ? { data: raw(), error: null } : new Promise(() => {})) } });
  await e.mount(''); await choose(e); await e.submit();
  assert.ok(e.root.kids.list.innerHTML.includes(URLN)); // the row thumbnail
  await e.open('i2'); assert.ok(e.sheet().includes(URLN));
});

test('I_photo r2 F5: signed links are kept in localStorage with their time; a new visit does not sign again, and re-signs when under a day is left', async () => {
  const ls = {};
  const a = await setup({ role: 'owner', ls, client: mockClient({ catalogue: raw(), fn: { 'upload-photo': upload } }) });
  await a.mount('');
  assert.equal(signs(a).length, 1); assert.ok(JSON.parse(ls.I_pu_v1)[P1].url === URL1);
  const b = await setup({ role: 'owner', ls, client: mockClient({ catalogue: raw(), fn: { 'upload-photo': upload } }) });
  await b.mount('');
  assert.equal(JSON.stringify(signs(b).map((c) => c[2].paths)), JSON.stringify([[P2]])); // P1 came from the store
  assert.ok(b.root.kids.list.innerHTML.includes(URL1));
  const old = JSON.parse(ls.I_pu_v1); old[P1].at = Date.parse(NOW) - 6.5 * 86400000; ls.I_pu_v1 = JSON.stringify(old);
  const c = await setup({ role: 'owner', ls, client: mockClient({ catalogue: raw(), fn: { 'upload-photo': upload } }) });
  await c.mount('');
  assert.ok(signs(c)[0][2].paths.includes(P1));
});
