// s108: any staff user can add, change or remove a product under an inventory item; owner and admin approve.
// Exact RPC names and keys, the cleaner never sees or sends a price, host rules checked in the app, probe-and-hide when the SQL release is not applied, demo writes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, NOW } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const IMG = 'https://cdn.shopify.com/s/files/1/0358/1335/9748/files/4902430093767.jpg';
const MISSING = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen' })], sourceAsOf: NOW });
const opts = (role) => ({ ok: true, item_id: 'i1', options: [
  { id: 'o1', supplier_id: 's1', supplier: 'Shopsuki', title: 'Softly Bath Tissue 12 rolls', brand: 'Softly', pack_label: '12 rolls', pack_size: 12, image_url: IMG, source_url: 'https://shopsuki.ph/products/softly', usual: true, preferred: false, available: true, ...(['owner', 'admin', 'finance'].includes(role) ? { price: 210 } : {}) },
  { id: 'o2', supplier_id: 's1', supplier: 'Shopsuki', title: 'Cloud Bath Tissue 12 rolls', brand: 'Cloud', pack_label: null, pack_size: null, image_url: null, source_url: 'https://shopee.ph/cloud-i.1.2', usual: false, preferred: false, available: true, ...(['owner', 'admin', 'finance'].includes(role) ? { price: 195 } : {}) }
] });
const SUPS = { ok: true, suppliers: [{ id: 's1', name: 'Shopsuki', active: true }, { id: 's2', name: 'Shopee', active: true }] };
const req = (o) => ({ id: 'q1', item_id: 'i1', item: 'Toilet paper', option_id: null, option_title: null, action: 'add', payload: { title: 'Plush Bath Tissue 12 rolls', brand: 'Plush', supplier_id: 's2', source_url: 'https://shopee.ph/plush-i.3.4', image_url: IMG, price: 175, available: true },
  status: 'pending', note: 'Cheaper per roll', requester: 'Ana', mine: false, requested_at: '2026-10-30T02:00:00Z', current: null, ...o });
const make = (role = 'owner', o = {}) => {
  const st = { reqs: o.reqs || [], opts: opts(role), n: 0 };
  return setup({ role, doc: {}, client: mockClient({ catalogue: raw(), rpc: {
    inventory_item_options_v1: () => ({ data: st.opts, error: null }),
    inventory_supplier_list_v1: () => ({ data: SUPS, error: null }),
    inventory_option_requests_v1: () => ({ data: { ok: true, manage: ['owner', 'admin'].includes(role), requests: st.reqs }, error: null }),
    inventory_option_request_v1: () => ({ data: { ok: true, applied: ['owner', 'admin'].includes(role), request_id: 'n' + (++st.n) }, error: null }),
    inventory_option_request_decide_v1: () => ({ data: { ok: true, status: 'approved' }, error: null }),
    inventory_option_request_cancel_v1: () => ({ data: { ok: true, status: 'cancelled' }, error: null }),
    ...(o.rpc || {}) } }) }).then((e) => Object.assign(e, { st }));
};
const calls = (e, n) => e.client.rpcCalls(n);
const fill = async (e, v) => { for (const [k, x] of Object.entries(v)) await e.input('I_f_' + k, x); };
const addForm = async (e) => { await e.mount(''); await e.open('i1'); await e.act('o8-add'); };

test('I_s108 a cleaner adds a product: no price field, no price key, exact RPC keys, then the Waiting for approval line with Cancel', async () => {
  const e = await make('cleaner'); await addForm(e);
  const f = e.sheet();
  assert.match(f, /Add a product/); assert.doesNotMatch(f, /I_f_price|Price/); assert.match(f, /id="I_f_supplierId"/); assert.match(f, /<option value="s2">Shopee<\/option>/);
  assert.match(f, /Send for approval/);
  e.st.reqs = [req({ id: 'q9', mine: true, requester: 'Me', payload: { title: 'Plush Bath Tissue 12 rolls', supplier_id: 's2', source_url: 'https://shopee.ph/plush-i.3.4', available: true } })];
  await fill(e, { title: '  Plush Bath Tissue 12 rolls ', brand: 'Plush', packSize: '12', supplierId: 's2', link: 'https://shopee.ph/plush-i.3.4', note: 'Cheaper' });
  await e.submit();
  const c = calls(e, 'inventory_option_request_v1'); assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][2]).sort(), ['p_action', 'p_idempotency_key', 'p_item_id', 'p_note', 'p_option_id', 'p_payload']);
  assert.equal(c[0][2].p_item_id, 'i1'); assert.equal(c[0][2].p_action, 'add'); assert.equal(c[0][2].p_option_id, null); assert.equal(c[0][2].p_note, 'Cheaper');
  assert.match(c[0][2].p_idempotency_key, /^stk-opt-[0-9a-z]{16,}$/);
  assert.deepEqual(c[0][2].p_payload, { title: 'Plush Bath Tissue 12 rolls', brand: 'Plush', pack_size: 12, supplier_id: 's2', source_url: 'https://shopee.ph/plush-i.3.4', available: true });
  assert.ok(!('price' in c[0][2].p_payload));
  assert.ok(e.toasts.includes('Sent for approval. An admin will check it.'));
  const s = e.sheet();
  assert.match(s, /Waiting for approval/); assert.match(s, /New product: Plush Bath Tissue 12 rolls/); assert.match(s, /data-act="o8-cancel" data-id="q9"/);
  assert.deepEqual(calls(e, 'inventory_option_requests_v1')[0][2], { p_property_id: PID, p_status: 'pending' });
  await e.act('o8-cancel', { 'data-id': 'q9' });
  assert.deepEqual(calls(e, 'inventory_option_request_cancel_v1')[0][2], { p_request_id: 'q9' });
  assert.ok(e.toasts.includes('Request cancelled.'));
});

test('I_s108 a cleaner editing an option has no price in the form and only the changed field in the payload', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.act('o8-edit', { 'data-id': 'o2' });
  assert.doesNotMatch(e.sheet(), /I_f_price/); assert.match(e.sheet(), /value="Cloud Bath Tissue 12 rolls"/);
  await e.submit(); assert.match(e.sheet(), /Nothing has changed yet\./); assert.equal(calls(e, 'inventory_option_request_v1').length, 0);
  await e.input('I_f_brand', 'Cloud Soft'); await e.submit();
  const a = calls(e, 'inventory_option_request_v1')[0][2];
  assert.equal(a.p_action, 'edit'); assert.equal(a.p_option_id, 'o2'); assert.deepEqual(a.p_payload, { brand: 'Cloud Soft' });
});

test('I_s108 owner adds a product: price field, price sent, Saved, and the options are read again', async () => {
  const e = await make('owner'); await addForm(e);
  assert.match(e.sheet(), /id="I_f_price"/); assert.match(e.sheet(), />Save</);
  const before = calls(e, 'inventory_item_options_v1').length;
  await fill(e, { title: 'Plush', supplierId: 's1', link: 'https://shopsuki.ph/products/plush', photo: IMG, price: '175' });
  await e.act('o8-avail'); // out of stock
  await e.submit();
  const a = calls(e, 'inventory_option_request_v1')[0][2];
  assert.deepEqual(a.p_payload, { title: 'Plush', supplier_id: 's1', source_url: 'https://shopsuki.ph/products/plush', image_url: IMG, price: 175, available: false });
  assert.ok(e.toasts.includes('Saved.')); assert.equal(calls(e, 'inventory_item_options_v1').length, before + 1);
  assert.doesNotMatch(e.sheet(), /Waiting for approval/); assert.match(e.sheet(), /Softly Bath Tissue/); assert.doesNotMatch(e.sheet(), /Add a product<\/h2>/);
});

test('I_s108 shopee links lose their tracking query, a shopsuki link keeps its own; a disallowed or http link is refused in the app with no call', async () => {
  const L = (await setup({ role: 'owner' })).lib;
  assert.equal(L.o8Link('https://shopee.ph/Joy-i.123.456?sp_atk=abc&xptdk=x#top'), 'https://shopee.ph/Joy-i.123.456');
  assert.equal(L.o8Link('https://SHOPSUKI.ph/products/joy?variant=9'), 'https://shopsuki.ph/products/joy?variant=9');
  assert.equal(L.o8Link('https://shopee.ph'), 'https://shopee.ph/');
  for (const bad of ['http://shopee.ph/x', 'https://example.com/x', 'https://shopee.ph.evil.com/x', 'https://evil.com/shopee.ph/x', 'javascript:alert(1)', 'https://www.shopee.ph/x', '']) assert.equal(L.o8Link(bad), null, bad);
  assert.equal(L.o8Pic('https://down-ph.img.susercontent.com/file/abc'), 'https://down-ph.img.susercontent.com/file/abc'); assert.equal(L.o8Pic('https://example.com/a.jpg'), null);
  const e = await make('owner'); await addForm(e);
  await fill(e, { title: 'X', supplierId: 's1', link: 'https://shopee.ph/Joy-i.123.456?sp_atk=abc&utm_source=x' }); await e.submit();
  assert.equal(calls(e, 'inventory_option_request_v1')[0][2].p_payload.source_url, 'https://shopee.ph/Joy-i.123.456');
  const f = await make('owner'); await addForm(f);
  await fill(f, { title: 'X', supplierId: 's1', link: 'https://example.com/product' }); await f.submit();
  assert.equal(calls(f, 'inventory_option_request_v1').length, 0); assert.match(f.sheet(), /role="alert"[^>]*>.*shopsuki\.ph or shopee\.ph/);
  await fill(f, { link: 'https://shopsuki.ph/p', photo: 'https://example.com/a.jpg' }); await f.submit();
  assert.equal(calls(f, 'inventory_option_request_v1').length, 0); assert.match(f.sheet(), /cdn\.shopify\.com or down-ph\.img\.susercontent\.com/);
  await fill(f, { photo: '', supplierId: '' }); await f.submit(); assert.match(f.sheet(), /Choose the shop/); assert.equal(calls(f, 'inventory_option_request_v1').length, 0);
});

test('I_s108 Remove asks first, sends delete with an empty payload, and the usual option is refused with the plain server message', async () => {
  const e = await make('owner', { rpc: { inventory_option_request_v1: (a) => (a.p_option_id === 'o1' ? { data: null, error: { code: '22023', message: 'usual_option' } } : { data: { ok: true, applied: true, request_id: 'r' }, error: null }) } });
  await e.mount(''); await e.open('i1');
  await e.act('o8-del', { 'data-id': 'o2' });
  assert.match(e.sheet(), /Remove Cloud Bath Tissue 12 rolls\?/); assert.equal(calls(e, 'inventory_option_request_v1').length, 0);
  await e.submit();
  const a = calls(e, 'inventory_option_request_v1')[0][2];
  assert.equal(a.p_action, 'delete'); assert.equal(a.p_option_id, 'o2'); assert.deepEqual(a.p_payload, {}); assert.equal(a.p_note, null); assert.ok(e.toasts.includes('Saved.'));
  await e.act('o8-del', { 'data-id': 'o1' }); await e.submit();
  assert.match(e.sheet(), /role="alert"[^>]*>.*The usual product cannot be removed\. Make another product the usual one first\./);
  assert.match(e.sheet(), /Remove Softly Bath Tissue 12 rolls\?/); // still on the confirm sheet
  const c = await make('cleaner'); await c.mount(''); await c.open('i1'); await c.act('o8-del', { 'data-id': 'o2' });
  assert.match(c.sheet(), /An admin will check the request before it is removed\./); assert.match(c.sheet(), /Yes, ask to remove it/);
});

test('I_s108 the form stays on screen when the server says duplicate; every option row has Edit and Remove with 44 px targets', async () => {
  const e = await make('owner', { rpc: { inventory_option_request_v1: () => ({ data: null, error: { code: '22023', message: 'duplicate_option' } }) } });
  await e.mount(''); await e.open('i1');
  assert.equal((e.sheet().match(/data-act="o8-edit"/g) || []).length, 2); assert.equal((e.sheet().match(/data-act="o8-del"/g) || []).length, 2);
  await e.act('o8-edit', { 'data-id': 'o2' }); await e.input('I_f_title', 'Softly Bath Tissue 12 rolls'); await e.submit();
  assert.match(e.sheet(), /That product is already in the list\./); assert.match(e.sheet(), /Edit product/);
  const fs = await import('node:fs'); const css = fs.readFileSync(new URL('../stock/I_stock.css', import.meta.url), 'utf8');
  assert.match(css, /\.I_undobtn \{ min-height: 44px; \}/); assert.match(css, /\.I_req \.btn \{ min-height: 44px; \}/); assert.doesNotMatch(css.slice(css.indexOf('s108')), /#[0-9a-f]{3,6}\b/i);
});

test('I_s108 the idempotency key is kept on a retry and renewed when the values change', async () => {
  let n = 0;
  const e = await make('owner', { rpc: { inventory_option_request_v1: () => (++n === 1 ? Promise.reject(Object.assign(new TypeError('Failed to fetch'))) : { data: { ok: true, applied: true, request_id: 'r' }, error: null }) } });
  await addForm(e); await fill(e, { title: 'Plush', supplierId: 's1', link: 'https://shopsuki.ph/p' });
  await e.submit(); assert.match(e.sheet(), /No connection|did not go through/); assert.match(e.sheet(), /Add a product/);
  await e.submit();
  const [k1, k2] = calls(e, 'inventory_option_request_v1').map((c) => c[2].p_idempotency_key); assert.equal(k1, k2);
  const f = await make('owner', { rpc: { inventory_option_request_v1: () => ({ data: null, error: { code: 'XX000', message: 'boom' } }) } });
  await addForm(f); await fill(f, { title: 'Plush', supplierId: 's1', link: 'https://shopsuki.ph/p' }); await f.submit(); await f.input('I_f_title', 'Plush 2'); await f.submit();
  const [a, b] = calls(f, 'inventory_option_request_v1').map((c) => c[2].p_idempotency_key); assert.notEqual(a, b);
});

test('I_s108 approvals: Requests N in the More menu and a pill, the list shows what changes field by field, the link opens safely', async () => {
  const mine = req({ id: 'q2', action: 'edit', option_id: 'o2', option_title: 'Cloud Bath Tissue 12 rolls', payload: { price: 180, brand: 'Cloud Soft' }, current: { title: 'Cloud Bath Tissue 12 rolls', brand: 'Cloud', price: 195, supplier_id: 's1' }, requester: 'Ben', note: null });
  const del = req({ id: 'q3', action: 'delete', option_id: 'o2', option_title: 'Cloud Bath Tissue 12 rolls', payload: {}, current: { title: 'Cloud Bath Tissue 12 rolls', image_url: IMG } });
  const e = await make('owner', { reqs: [req(), mine, del] }); await e.mount('');
  const top = e.html();
  assert.match(top, /data-act="o8-reqs">Requests 3<\/button>/); assert.match(top, /I_pill I_pinfo" type="button" data-act="o8-reqs"[^>]*>.*3 requests<\/button>/);
  await e.act('o8-reqs'); const s = e.sheet();
  assert.match(s, /3 waiting for you/); assert.equal((s.match(/class="I_req"/g) || []).length, 3); // the badge and the list use one selector
  assert.match(s, /New product · Toilet paper/); assert.match(s, /Change · Toilet paper/); assert.match(s, /Remove · Toilet paper/); assert.match(s, /Ana · Oct 30/);
  assert.match(s, /Plush Bath Tissue 12 rolls/); assert.match(s, /<dt>Shop<\/dt><dd>Shopee<\/dd>/); assert.match(s, /<dt>Price<\/dt><dd>₱175<\/dd>/);
  assert.match(s, /<a href="https:\/\/shopee\.ph\/plush-i\.3\.4" target="_blank" rel="noopener noreferrer">View on Shopee<\/a>/);
  assert.match(s, /<img class="I_rth" src="https:\/\/cdn\.shopify\.com[^"]+" alt="" width="56" height="56"/);
  assert.match(s, /<dt>Brand<\/dt><dd>Cloud → Cloud Soft<\/dd>/); assert.match(s, /<dt>Price<\/dt><dd>₱195 → ₱180<\/dd>/);
  assert.match(s, /<dt>Product<\/dt><dd>Cloud Bath Tissue 12 rolls<\/dd>/);
  const none = await make('owner'); await none.mount(''); assert.doesNotMatch(none.html(), /3 requests|I_pill I_pinfo[^>]*o8-reqs/); assert.match(none.html(), /data-act="o8-reqs">Requests<\/button>/);
});

test('I_s108 approve with a price override and reject with a note: exact decide keys, then the list and the item options are read again', async () => {
  const e = await make('owner', { reqs: [req(), req({ id: 'q4', payload: { title: 'Other', supplier_id: 's1', source_url: 'https://shopsuki.ph/o' } })] }); await e.mount(''); await e.open('i1'); await e.act('close');
  const optReads = calls(e, 'inventory_item_options_v1').length;
  await e.act('o8-reqs');
  await e.act('o8-approve', { 'data-id': 'q1' });
  assert.match(e.sheet(), /id="I_f_dprice"[^>]*value="175"/);
  await e.input('I_f_dprice', '160'); e.st.reqs = [e.st.reqs[1]]; await e.submit();
  assert.deepEqual(calls(e, 'inventory_option_request_decide_v1')[0][2], { p_request_id: 'q1', p_decision: 'approve', p_payload_override: { price: 160 }, p_note: null });
  assert.ok(e.toasts.includes('Approved.')); assert.match(e.sheet(), /1 waiting for you/); assert.equal(calls(e, 'inventory_option_requests_v1').length >= 2, true);
  await e.act('o8-reject', { 'data-id': 'q4' }); assert.doesNotMatch(e.sheet(), /dprice/); assert.match(e.sheet(), /id="I_f_dnote"/);
  e.st.reqs = []; await e.input('I_f_dnote', 'Too dear'); await e.submit();
  assert.deepEqual(calls(e, 'inventory_option_request_decide_v1')[1][2], { p_request_id: 'q4', p_decision: 'reject', p_payload_override: null, p_note: 'Too dear' });
  assert.match(e.sheet(), /Nothing is waiting for approval\./); assert.ok(e.toasts.includes('Rejected.'));
  await e.act('close'); await e.open('i1'); assert.ok(calls(e, 'inventory_item_options_v1').length > optReads, 'the item options cache was dropped'); assert.doesNotMatch(e.html(), /data-act="o8-reqs" data-k="x"/);
  // approve without touching the price sends no override
  const f = await make('owner', { reqs: [req()] }); await f.mount(''); await f.act('o8-reqs'); await f.act('o8-approve', { 'data-id': 'q1' }); await f.submit();
  assert.equal(calls(f, 'inventory_option_request_decide_v1')[0][2].p_payload_override, null);
});

test('I_s108 a cleaner and a finance user get no Requests entry; the finance form shows the price', async () => {
  const c = await make('cleaner'); await c.mount(''); assert.doesNotMatch(c.html(), /o8-reqs/); await c.act('o8-reqs'); assert.equal(c.sheet(), '');
  const f = await make('finance'); await f.mount(''); assert.doesNotMatch(f.html(), /o8-reqs/); await f.open('i1'); await f.act('o8-add'); assert.match(f.sheet(), /id="I_f_price"/); assert.match(f.sheet(), /Send for approval/);
});

test('I_s108 PGRST202 on the requests read hides Add, Edit, Remove and Requests silently', async () => {
  const e = await make('owner', { rpc: { inventory_option_requests_v1: () => MISSING } }); await e.mount(''); await e.open('i1');
  const s = e.sheet(); assert.doesNotMatch(s, /o8-add|o8-edit|o8-del|Add a product/); assert.match(s, /Softly Bath Tissue/);
  assert.doesNotMatch(e.html(), /o8-reqs/); assert.equal(e.toasts.length, 0); assert.doesNotMatch(s, /role="alert"/);
  await e.act('close'); await e.open('i2'); assert.equal(calls(e, 'inventory_option_requests_v1').length, 1, 'not asked again this visit');
  const n = await make('cleaner', { rpc: { inventory_option_requests_v1: () => ({ data: null, status: 404, error: { status: 404, message: 'Not Found' } }) } }); await n.mount(''); await n.open('i1');
  assert.doesNotMatch(n.sheet(), /o8-add|o8-edit|o8-del/);
});

test('I_s108 a 404 on the write hides the controls for the visit', async () => {
  const e = await make('cleaner', { rpc: { inventory_option_request_v1: () => MISSING } }); await addForm(e);
  await fill(e, { title: 'X', supplierId: 's1', link: 'https://shopsuki.ph/p' }); await e.submit();
  assert.doesNotMatch(e.sheet(), /o8-add|o8-edit|o8-del/); assert.match(e.sheet(), /Softly Bath Tissue/); assert.ok(e.toasts.includes('This is not available right now.'));
});

test('I_s108 demo writes nothing, shows the form, and shows one pending request to the owner only', async () => {
  const e = await setup({ role: 'owner', demo: true }); await e.mount('');
  assert.match(e.html(), /data-act="o8-reqs">Requests 1<\/button>/); await e.act('o8-reqs');
  assert.match(e.sheet(), /New product · Toilet paper/); assert.match(e.sheet(), /<dt>Shop<\/dt><dd>Demo Mart<\/dd>/); assert.match(e.sheet(), /Demo staff/);
  await e.act('o8-approve', { 'data-id': 'dq1' }); await e.submit(); assert.ok(e.toasts.includes('Demo only, nothing was saved.'));
  await e.act('close'); await e.open('d1'); await e.act('o8-add');
  await fill(e, { title: 'Plush', supplierId: 'demo-sup', link: 'https://shopsuki.ph/p' }); await e.submit();
  assert.equal(e.toasts.filter((t) => t === 'Demo only, nothing was saved.').length, 2); assert.match(e.sheet(), /Toilet paper/);
  const c = await setup({ role: 'cleaner', demo: true }); await c.mount(''); assert.doesNotMatch(c.html(), /o8-reqs/);
});

test('I_s108 text from the server is escaped in the request list and in the pending line', async () => {
  const bad = '<img src=x onerror=alert(1)>';
  const e = await make('owner', { reqs: [req({ requester: bad, item: bad, note: bad, payload: { title: bad, source_url: 'https://shopsuki.ph/"onclick=1', supplier_id: 's1' } })] }); await e.mount(''); await e.act('o8-reqs');
  assert.doesNotMatch(e.sheet(), /<img src=x/); assert.match(e.sheet(), /&lt;img src=x onerror=alert\(1\)&gt;/);
});
