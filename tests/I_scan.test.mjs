// Lane I (s84): scan, link or create. Camera and detector are stubs; every write asserts the exact RPC name and argument keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, flush } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const CODE = '4800000000011';
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { codes: [CODE] }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', codes: [] }), item('i3', 'Bath towels', 14, 10, { category: 'Linen', consumable: false, codes: ['LINEN-1'] })] });
const make = (role, o = {}) => setup({ role, client: mockClient({ catalogue: raw(), ...(o.mock || {}) }), ...o });
const typeCode = async (e, c) => { await e.input('I_f_code', c); await e.submit(); };
const keys = (o) => Object.keys(o).sort();

test('I_scan codeIndex maps every code to its item and drops stray spaces', async () => {
  const e = await make('owner');
  const idx = e.lib.codeIndex([{ id: 'a', codes: [' 480 0001 '] }, { id: 'b', codes: ['X1', 'X2'] }, { id: 'c' }]);
  assert.deepEqual({ ...idx }, { 4800001: 'a', X1: 'b', X2: 'b' });
  assert.equal(e.lib.normCode('  4800 0011\n'), '48000011');
  assert.equal(e.lib.validCode('4800'), true); assert.equal(e.lib.validCode(''), false); assert.equal(e.lib.validCode('a'.repeat(129)), false); assert.equal(e.lib.validCode('é1'), false);
});

test('I_scan the Scan button is on the list for every role and the sheet always has the typed field', async () => {
  for (const role of ['owner', 'admin', 'cleaner', 'finance']) {
    const e = await make(role);
    await e.mount('');
    assert.match(e.html(), /data-act="scan"/, role);
    await e.act('scan');
    assert.match(e.sheet(), /Type the code under the barcode/, role);
    assert.match(e.sheet(), /id="I_f_code"/, role);
  }
});

test('I_scan a typed code that is linked opens that item card (route and sheet)', async () => {
  const e = await make('owner');
  await e.mount(''); await e.act('scan'); await typeCode(e, CODE);
  assert.equal(e.navs[e.navs.length - 1], '#stock/item/i1');
  assert.match(e.sheet(), /Toilet paper/); assert.match(e.sheet(), /data-kind="count"/);
});

test('I_scan after a scan the right action comes first: owner Count it, finance Change price, cleaner Running low', async () => {
  const order = { owner: 'count', admin: 'count', finance: 'price', cleaner: 'low' };
  for (const role of Object.keys(order)) {
    const e = await make(role);
    await e.mount(''); await e.act('scan'); await typeCode(e, CODE);
    const kinds = [...e.sheet().matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);
    assert.equal(kinds[0], order[role], role + ' got ' + kinds.join(','));
    assert.match(e.sheet(), new RegExp('btn-primary btn-block" type="button" data-act="begin" data-kind="' + order[role] + '"'), role + ' leads in the primary style');
  }
  // a plain tap on a row is not a scan: the owner keeps Count it, finance keeps its order (price is not primary)
  const f = await make('finance');
  await f.mount(''); await f.open('i1');
  assert.doesNotMatch(f.sheet(), /btn-primary btn-block" type="button" data-act="begin" data-kind="price"/);
});

test('I_scan a cleaner can scan to read the card; a scan alone writes no count (the scanned card leads with Running low)', async () => {
  const e = await make('cleaner');
  await e.mount(''); await e.act('scan'); await typeCode(e, CODE);
  assert.match(e.sheet(), /Toilet paper/);
  assert.match(e.sheet(), /data-kind="low"/);
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length, 0);
});

test('I_scan an unknown code: the owner is offered Link to an item and New item', async () => {
  const e = await make('owner');
  await e.mount(''); await e.act('scan'); await typeCode(e, '999000111');
  assert.match(e.sheet(), /This code is not linked yet/); assert.match(e.sheet(), /999000111/);
  assert.match(e.sheet(), /data-act="scan-pick"/); assert.match(e.sheet(), /data-act="scan-new"/);
});

test('I_scan an unknown code: a cleaner and finance are told to ask the owner and nothing is written', async () => {
  for (const role of ['cleaner', 'finance']) {
    const e = await make(role);
    await e.mount(''); await e.act('scan'); await typeCode(e, '999000111');
    assert.match(e.sheet(), /Ask the owner to link it\. The code is 999000111\./, role);
    assert.doesNotMatch(e.sheet(), /scan-pick|scan-new/, role);
    await e.act('scan-pick'); await e.act('scan-new'); await e.act('pick', { 'data-id': 'i2' }); // hand-made clicks
    assert.doesNotMatch(e.sheet(), /which item|Counted now|Link code/, role);
    await e.submit();
    assert.equal(e.client.calls.filter((c) => c[0] === 'rpc' && c[1] !== 'get_inventory_catalogue_v1').length, 0, role);
  }
});

test('I_scan link to an existing item: search, tap, confirm, then inventory_code_attach_v1 with the exact keys', async () => {
  const e = await make('owner');
  await e.mount(''); await e.act('scan'); await typeCode(e, '999000111');
  await e.act('scan-pick');
  assert.match(e.sheet(), /Hand soap/);
  await e.input('I_f_find', 'hand');
  assert.doesNotMatch(e.sheet(), /Toilet paper/); assert.match(e.sheet(), /Hand soap/);
  await e.act('pick', { 'data-id': 'i2' });
  assert.match(e.sheet(), /Link code 999000111 to Hand soap\?/);
  assert.equal(e.client.rpcCalls('inventory_code_attach_v1').length, 0); // nothing before the confirm
  await e.submit();
  const c = e.client.rpcCalls('inventory_code_attach_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keys(c[0][2]), ['p_code', 'p_format', 'p_item_id', 'p_property_id']);
  assert.deepEqual({ ...c[0][2] }, { p_property_id: PID, p_code: '999000111', p_format: null, p_item_id: 'i2' });
  assert.match(e.undo(), /Linked a barcode/);
  assert.equal(e.client.rpcCalls('get_inventory_catalogue_v1').length, 2); // reloaded: the new code works at once
});

test('I_scan a code that belongs to another item: the calm line and an Open button, nothing created', async () => {
  const e = await make('owner', { mock: { rpc: { inventory_code_attach_v1: () => ({ data: { ok: false, reason: 'code_taken', item_id: 'i3', item_name: 'Bath towels' }, error: null }) } } });
  await e.mount(''); await e.act('scan'); await typeCode(e, 'RACE-9');
  await e.act('scan-pick'); await e.act('pick', { 'data-id': 'i2' }); await e.submit();
  assert.match(e.sheet(), /That code is already linked to Bath towels\./);
  assert.match(e.sheet(), /data-act="open-taken" data-id="i3"/);
  await e.act('open-taken', { 'data-id': 'i3' });
  assert.equal(e.navs[e.navs.length - 1], '#stock/item/i3');
});

test('I_scan new item: form, confirm, then inventory_item_create_v1 with the exact keys and a long idempotency key', async () => {
  const e = await make('owner');
  await e.mount(''); await e.act('scan'); await typeCode(e, '555000777');
  await e.act('scan-new');
  assert.match(e.sheet(), /Miscellaneous/); assert.match(e.sheet(), /<option value="" selected>Choose one/);
  await e.input('I_f_name', 'Spare keys'); await e.input('I_f_category', 'Miscellaneous'); await e.input('I_f_unit', 'pieces'); await e.input('I_f_qty', '3'); await e.input('I_f_reorder', '1');
  await e.submit();
  assert.match(e.sheet(), /Add Spare keys as a new item\?/); assert.match(e.sheet(), /Telegram \/count will skip it/);
  assert.equal(e.client.rpcCalls('inventory_item_create_v1').length, 0);
  await e.submit();
  const c = e.client.rpcCalls('inventory_item_create_v1');
  assert.equal(c.length, 1);
  assert.deepEqual(keys(c[0][2]), ['p_code', 'p_format', 'p_idempotency_key', 'p_item', 'p_property_id']);
  assert.equal(c[0][2].p_property_id, PID); assert.equal(c[0][2].p_code, '555000777'); assert.equal(c[0][2].p_format, null);
  assert.deepEqual({ ...c[0][2].p_item }, { name: 'Spare keys', category: 'Miscellaneous', unit: 'pieces', consumable: false, reorder_below: 1, qty: 3 });
  assert.ok(c[0][2].p_idempotency_key.length >= 16 && c[0][2].p_idempotency_key.length <= 160);
  assert.match(e.toasts[e.toasts.length - 1], /Added Spare keys/);
});

test('I_scan new item: a missing name or category stays on the form; the optional numbers are left out when empty', async () => {
  const e = await make('owner');
  await e.mount(''); await e.act('scan'); await typeCode(e, '555000777'); await e.act('scan-new');
  await e.submit();
  assert.match(e.sheet(), /Give it a name and a category/);
  await e.input('I_f_name', 'Candle'); await e.input('I_f_category', 'Living Area'); await e.input('I_f_unit', ''); await e.submit(); await e.submit();
  const a = e.client.rpcCalls('inventory_item_create_v1')[0][2];
  assert.deepEqual({ ...a.p_item }, { name: 'Candle', category: 'Living Area', unit: 'pc', consumable: false });
});

test('I_scan new item: a name that already exists is refused with an Open button', async () => {
  const e = await make('owner', { mock: { rpc: { inventory_item_create_v1: () => ({ data: { ok: false, reason: 'name_exists', item_id: 'i2' }, error: null }) } } });
  await e.mount(''); await e.act('scan'); await typeCode(e, '555000777'); await e.act('scan-new');
  await e.input('I_f_name', 'Hand soap'); await e.input('I_f_category', 'Kitchen'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /An item with that name already exists\./); assert.match(e.sheet(), /data-id="i2"/);
});

test('I_scan link a barcode from the item card (link mode): a code that is new is confirmed and attached to that item', async () => {
  const e = await make('owner');
  await e.mount(''); await e.open('i2');
  assert.match(e.sheet(), /data-act="begin-link"/);
  await e.act('begin-link');
  assert.match(e.sheet(), /Link a barcode to Hand soap/);
  await typeCode(e, '777');
  assert.match(e.sheet(), /Link code 777 to Hand soap\?/);
  await e.submit();
  assert.deepEqual({ ...e.client.rpcCalls('inventory_code_attach_v1')[0][2] }, { p_property_id: PID, p_code: '777', p_format: null, p_item_id: 'i2' });
});

test('I_scan link mode: a code already on this item or on another is said plainly and nothing is sent', async () => {
  const e = await make('owner');
  await e.mount(''); await e.open('i1'); await e.act('begin-link');
  await typeCode(e, CODE);
  assert.match(e.sheet(), /already linked to this item/);
  await typeCode(e, 'LINEN-1');
  assert.match(e.sheet(), /already linked to Bath towels/);
  assert.equal(e.client.rpcCalls('inventory_code_attach_v1').length, 0);
});

test('I_scan the last typed code is remembered for the visit, so a typo is fixed and not retyped', async () => {
  const e = await make('owner');
  await e.mount(''); await e.act('scan'); await typeCode(e, '99900011x');
  await e.act('back'); // Scan again
  assert.match(e.sheet(), /value="99900011x"/);
});

test('I_scan a blank or unreadable code shows the calm line and stays put', async () => {
  const e = await make('owner');
  await e.mount(''); await e.act('scan'); await e.input('I_f_code', ''); await e.submit();
  assert.match(e.sheet(), /does not look like a barcode/);
  await typeCode(e, 'é');
  assert.match(e.sheet(), /does not look like a barcode/);
});

test('I_scan camera: no BarcodeDetector means the typed field only, no camera request', async () => {
  const e = await make('owner', { camera: false });
  await e.mount(''); await e.act('scan');
  assert.match(e.sheet(), /cannot read barcodes\. You can type the code instead/); assert.doesNotMatch(e.sheet(), /<video/);
  assert.equal(e.cam.opened, 0);
});

test('I_scan camera: opens the rear camera, asks only the formats the phone knows, polls every 250 ms and stops at the first match', async () => {
  const e = await make('owner', { camera: true });
  await e.mount(''); await e.act('scan'); await flush();
  assert.deepEqual({ ...e.cam.constraints.video }, { facingMode: 'environment' });
  assert.deepEqual([...e.cam.formats], ['ean_13', 'qr_code']); // pdf417 is dropped
  assert.match(e.sheet(), /<video[^>]*data-i-video/);
  assert.equal(e.cam.opened, 1);
  assert.equal(e.timers.length, 1); assert.equal(e.timers[0].ms, 250);
  assert.ok(e.root.video.srcObject); assert.ok(e.root.video.played >= 1);
  await e.tick(); assert.equal(e.cam.detectCalls, 1); assert.equal(e.cam.stopped, 0); // nothing seen yet
  e.cam.found.push({ rawValue: CODE, format: 'ean_13' });
  await e.tick();
  assert.equal(e.navs[e.navs.length - 1], '#stock/item/i1');
  assert.equal(e.cam.stopped, 1); // the track is stopped on a match
  assert.equal(e.timers[0].on, false);
});

test('I_scan camera: a detected unknown code remembers its format for the link call', async () => {
  const e = await make('owner', { camera: true });
  await e.mount(''); await e.act('scan'); await flush();
  e.cam.found.push({ rawValue: '0123456789012', format: 'ean_13' });
  await e.tick();
  await e.act('scan-pick'); await e.act('pick', { 'data-id': 'i2' }); await e.submit();
  assert.equal(e.client.rpcCalls('inventory_code_attach_v1')[0][2].p_format, 'ean_13');
});

test('I_scan camera: tracks are stopped on close and on unmount', async () => {
  const a = await make('owner', { camera: true });
  await a.mount(''); await a.act('scan'); await flush();
  await a.act('close');
  assert.equal(a.cam.stopped, 1); assert.equal(a.timers[0].on, false);
  const b = await make('owner', { camera: true });
  await b.mount(''); await b.act('scan'); await flush();
  b.unmount();
  assert.equal(b.cam.stopped, 1); assert.equal(b.timers[0].on, false);
  const c = await make('owner', { camera: true });
  await c.mount(''); await c.act('scan'); await flush();
  await c.key('Escape');
  assert.equal(c.cam.stopped, 1);
});

test('I_scan camera: the page going to the background stops the camera and offers to start it again', async () => {
  const e = await make('owner', { camera: true });
  const ls = {}; e.win.document = { hidden: false, addEventListener: (t, f) => { ls[t] = f; }, removeEventListener: (t) => { delete ls[t]; } };
  await e.mount(''); await e.act('scan'); await flush();
  assert.ok(ls.visibilitychange);
  e.win.document.hidden = true; ls.visibilitychange();
  assert.equal(e.cam.stopped, 1);
  assert.match(e.sheet(), /data-act="cam-start"/);
  e.win.document.hidden = false;
  await e.act('cam-start'); await flush();
  assert.equal(e.cam.opened, 2);
  e.unmount(); assert.equal(ls.visibilitychange, undefined);
});

test('I_scan camera: a refusal is a calm line and the typed field still works', async () => {
  for (const name of ['NotAllowedError', 'SecurityError']) {
    const e = await make('owner', { camera: true, camDenied: name });
    await e.mount(''); await e.act('scan'); await flush();
    assert.match(e.sheet(), /The camera is off for this app\. You can type the code instead\./);
    assert.doesNotMatch(e.sheet(), /errbox/);
    await typeCode(e, CODE);
    assert.equal(e.navs[e.navs.length - 1], '#stock/item/i1');
  }
  const f = await make('owner', { camera: true, camDenied: 'NotReadableError' });
  await f.mount(''); await f.act('scan'); await flush();
  assert.match(f.sheet(), /The camera did not start/);
});

test('I_scan camera: a match in link mode (no navigation) also stops the camera', async () => {
  const e = await make('owner', { camera: true });
  await e.mount(''); await e.open('i2'); await e.act('begin-link'); await flush();
  e.cam.found.push({ rawValue: CODE, format: 'ean_13' });
  await e.tick();
  assert.match(e.sheet(), /already linked to Toilet paper/);
  assert.equal(e.cam.stopped, 1);
});

test('I_scan a camera that answers after the sheet was closed is released at once', async () => {
  const e = await make('owner', { camera: true });
  await e.mount(''); await e.act('scan'); await e.act('close'); await flush();
  assert.equal(e.cam.opened, e.cam.stopped);
});

test('I_scan probe-and-hide: a catalogue without codes (the old function) has no Scan button and no link actions', async () => {
  const old = { items: raw().items.map(({ codes, par, ...r }) => r) };
  const e = await setup({ role: 'owner', client: mockClient({ catalogue: old }) });
  await e.mount('');
  assert.doesNotMatch(e.html(), /data-act="scan"/);
  await e.open('i1');
  assert.doesNotMatch(e.sheet(), /begin-link|Change price|Edit levels|Barcodes/);
});

test('I_scan the link RPC missing (PGRST202) hides Link to an item for the rest of the visit', async () => {
  const miss = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.inventory_code_attach_v1' } });
  const e = await make('owner', { mock: { rpc: { inventory_code_attach_v1: miss } } });
  await e.mount(''); await e.act('scan'); await typeCode(e, '999000111');
  await e.act('scan-pick'); await e.act('pick', { 'data-id': 'i2' }); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  assert.doesNotMatch(e.sheet(), /errbox/);
  await e.act('scan'); await typeCode(e, '999000111');
  assert.doesNotMatch(e.sheet(), /scan-pick/); assert.match(e.sheet(), /scan-new/);
});

test('I_scan demo: scanning the sample code opens the card; a link writes nothing', async () => {
  const e = await setup({ role: 'owner', demo: true });
  await e.mount(''); await e.act('scan'); await typeCode(e, '4800000000028');
  assert.equal(e.navs[e.navs.length - 1], '#stock/item/d3');
  await e.act('close'); await e.act('scan'); await typeCode(e, '123');
  await e.act('scan-pick'); await e.act('pick', { 'data-id': 'd2' }); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /Demo only/);
});

test('I_scan fix L1: a sheet closed before the formats were read never asks for the camera', async () => {
  const e = await make('owner', { camera: true });
  let release; e.win.BarcodeDetector.getSupportedFormats = () => new Promise((r) => { release = () => r(['ean_13']); });
  await e.mount(''); await e.act('scan'); await e.act('close'); release(); await flush();
  assert.equal(e.cam.constraints, null); assert.equal(e.cam.opened, 0);
});

test('I_scan fix L2: a phone that supports none of our formats says so and shows the typed field, not "camera did not start"', async () => {
  const e = await make('owner', { camera: true });
  e.win.BarcodeDetector.getSupportedFormats = async () => [];
  await e.mount(''); await e.act('scan'); await flush();
  assert.match(e.sheet(), /This phone cannot read barcodes\. You can type the code instead\./);
  assert.doesNotMatch(e.sheet(), /did not start/); assert.match(e.sheet(), /id="I_f_code"/);
  assert.equal(e.cam.opened, 0);
});

test('I_scan fix L3: typing in the code box while the camera warms up keeps the focus when it goes live', async () => {
  const e = await make('owner', { camera: true });
  e.win.document = { hidden: false, activeElement: { id: 'I_f_code' }, addEventListener() {}, removeEventListener() {} };
  await e.mount(''); await e.act('scan'); await flush();
  assert.ok(e.root.byId.I_f_code.focused >= 1);
});

test('I_scan fix L5: owner and admin can Unlink a code from the card, with a confirm and the exact detach keys; Undo links it again', async () => {
  for (const role of ['owner', 'admin']) {
    const e = await make(role);
    await e.mount(''); await e.open('i1');
    assert.match(e.sheet(), /data-act="unlink" data-code="4800000000011"/);
    await e.act('unlink', { 'data-code': CODE });
    assert.match(e.sheet(), /Unlink code 4800000000011 from Toilet paper\?/);
    assert.equal(e.client.rpcCalls('inventory_code_detach_v1').length, 0);
    await e.submit();
    const c = e.client.rpcCalls('inventory_code_detach_v1');
    assert.equal(c.length, 1); assert.deepEqual(Object.keys(c[0][2]).sort(), ['p_code', 'p_property_id']);
    assert.deepEqual({ ...c[0][2] }, { p_property_id: PID, p_code: CODE });
    assert.match(e.undo(), /Unlinked a barcode/);
    await e.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(e.undo())[1] }); await e.submit();
    assert.deepEqual({ ...e.client.rpcCalls('inventory_code_attach_v1').pop()[2] }, { p_property_id: PID, p_code: CODE, p_format: null, p_item_id: 'i1' });
  }
});

test('I_scan fix L5: a cleaner and finance see no Unlink, and a hand-made click does nothing; a missing RPC hides it', async () => {
  for (const role of ['cleaner', 'finance']) {
    const e = await make(role); await e.mount(''); await e.open('i1');
    assert.doesNotMatch(e.sheet(), /unlink/i);
    await e.act('unlink', { 'data-code': CODE }); assert.doesNotMatch(e.sheet(), /Unlink code/);
    assert.equal(e.client.rpcCalls('inventory_code_detach_v1').length, 0);
  }
  const miss = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  const o = await make('owner', { mock: { rpc: { inventory_code_detach_v1: () => miss } } });
  await o.mount(''); await o.open('i1'); await o.act('unlink', { 'data-code': CODE }); await o.submit();
  assert.match(o.toasts[o.toasts.length - 1], /not available right now/);
  await o.open('i1'); assert.doesNotMatch(o.sheet(), /data-act="unlink"/);
});
