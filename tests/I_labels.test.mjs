// Lane D-client-stock (s86 4.5 + 9.6): QR labels. R9 mints codes, inventory-report {kind:'labels'} sends the sheet to the Finance group, Undo detaches the minted codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, NOW } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen' }), item('i3', 'Bath towels', 14, 10, { category: 'Linen', codes: ['CH-AAAAAAAAAA'] }), item('i4', 'Dish soap', 5, 2, { category: 'Kitchen', codes: ['4800000000011'] })], sourceAsOf: NOW });
const MINT = { inventory_code_mint_v1: (a) => ({ data: { ok: true, minted: a.p_item_ids.filter((x) => x === 'i1' || x === 'i2').map((x) => ({ item_id: x, code: 'CH-' + x.toUpperCase() })), skipped: 0 }, error: null }) };
const make = (role = 'owner', o = {}) => setup({ role, client: mockClient({ catalogue: raw(), rpc: { ...MINT, inventory_code_detach_v1: () => ({ data: { ok: true }, error: null }), ...(o.rpc || {}) }, fn: { 'inventory-report': () => ({ data: { ok: true }, error: null }), ...(o.fn || {}) } }) });
const j = (x) => JSON.stringify(x);

test('I_labels Print QR labels is for owner and admin only', async () => {
  for (const r of ['cleaner', 'finance']) { const e = await make(r); await e.mount(''); assert.doesNotMatch(e.html(), /Print QR labels/); }
  const a = await make('admin'); await a.mount(''); assert.match(a.html(), /Print QR labels/);
});

test('I_labels the sheet counts items with no barcode, ticks them all and filters by category', async () => {
  const e = await make(); await e.mount(''); await e.act('labels');
  assert.match(e.sheet(), /2 items have no barcode\./);
  assert.match(e.sheet(), /Toilet paper/); assert.match(e.sheet(), /Hand soap/); assert.doesNotMatch(e.sheet(), /Bath towels|Dish soap/);
  assert.equal((e.sheet().match(/aria-pressed="true" data-act="lab-tick"|data-act="lab-tick"[^>]*aria-pressed="true"/g) || []).length, 2);
  await e.act('lab-cat', { 'data-k': 'Kitchen' });
  assert.doesNotMatch(e.sheet(), /data-id="i1"/); assert.match(e.sheet(), /data-id="i2"/);
});

test('I_labels confirm first, then R9 with the ids, then the function with {kind, to:finance, item_ids}; Undo detaches each minted code', async () => {
  const e = await make(); await e.mount(''); await e.act('labels'); await e.submit();
  assert.match(e.sheet(), /Make QR codes for 2 items and send a label sheet to the Finance group\?/);
  assert.equal(e.client.rpcCalls('inventory_code_mint_v1').length, 0); assert.equal(e.client.fnCalls('inventory-report').length, 0);
  await e.submit();
  assert.equal(j(e.client.rpcCalls('inventory_code_mint_v1')[0][2]), j({ p_property_id: PID, p_item_ids: ['i1', 'i2'] }));
  assert.equal(j(e.client.fnCalls('inventory-report')[0][2]), j({ kind: 'labels', to: 'finance', item_ids: ['i1', 'i2'] }));
  const seq = e.client.calls.map((c) => c[1]).filter((n) => n === 'inventory_code_mint_v1' || n === 'inventory-report');
  assert.equal(j(seq), j(['inventory_code_mint_v1', 'inventory-report']));
  assert.match(e.toasts[e.toasts.length - 1], /^Label sheet sent to the Finance group\.$/);
  assert.match(e.undo(), /Made 2 QR codes/);
  await e.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(e.undo())[1] });
  assert.match(e.sheet(), /Remove the 2 QR codes just made\?/);
  await e.submit();
  const d = e.client.rpcCalls('inventory_code_detach_v1');
  assert.equal(j(d.map((c) => c[2])), j([{ p_property_id: PID, p_code: 'CH-I1' }, { p_property_id: PID, p_code: 'CH-I2' }]));
});

test('I_labels re-sending items that already have a CH- code mints nothing and just sends the sheet', async () => {
  const e = await make(); await e.mount(''); await e.act('labels');
  await e.act('lab-all'); // untick the two unlabelled
  await e.act('lab-has'); await e.act('lab-tick', { 'data-id': 'i3' }); await e.submit();
  assert.match(e.sheet(), /Send a label sheet for 1 item to the Finance group\?/);
  await e.submit();
  assert.equal(j(e.client.rpcCalls('inventory_code_mint_v1')[0][2].p_item_ids), j(['i3']));
  assert.equal(j(e.client.fnCalls('inventory-report')[0][2].item_ids), j(['i3']));
  assert.equal(e.undo(), ''); // nothing was minted, so there is nothing to undo
});

test('I_labels if the sheet fails after the codes are made: a calm line, the Undo stays, and a retry sends without new codes', async () => {
  let n = 0;
  const e = await make('owner', { fn: { 'inventory-report': () => (++n === 1 ? { data: null, error: { name: 'FunctionsHttpError', context: { status: 500 } } } : { data: { ok: true }, error: null }) } });
  await e.mount(''); await e.act('labels'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /label sheet was not sent/);
  await e.submit();
  assert.equal(e.client.fnCalls('inventory-report').length, 2);
  assert.match(e.toasts[e.toasts.length - 1], /Label sheet sent/);
  assert.match(e.undo(), /Made 2 QR codes/); // the codes made on the first try can still be undone
  assert.equal(e.client.rpcCalls('inventory_code_mint_v1').length, 2); // the retry asks again; the server mints nothing new
});

test('I_labels probe-and-hide: R9 missing hides the button for the visit with a calm toast and no error box', async () => {
  const e = await make('owner', { rpc: { inventory_code_mint_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await e.mount(''); await e.act('labels'); await e.submit(); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  assert.doesNotMatch(e.html(), /Print QR labels/); assert.equal(e.client.fnCalls('inventory-report').length, 0);
});
