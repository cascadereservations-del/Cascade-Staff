// Lane I fix round: flags, controlled items, close while sending, short note, reload after failure, re-mount, refused approve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, CATALOGUE, item, flush } from './I_harness.mjs';

const CAT = { items: [...CATALOGUE.items, item('c1', 'Controlled soap', 5, 2, { movementControlled: true })] };
const SHOP = [
  { id: 's1', item_id: 'i2', item_name: 'Hand soap', quantity: 6, purchase_unit: 'bottles', reason: null, status: 'proposed', proposed_by: 'x', proposed_at: '2026-10-12T02:00:00Z' },
  { id: 's2', item_id: 'i1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z' },
  { id: 's3', item_id: 'c1', item_name: 'Controlled soap', quantity: 1, purchase_unit: 'pack', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z' }
];
const cl = (o) => mockClient(Object.assign({ catalogue: CAT, shop: SHOP }, o));

for (const role of ['owner', 'admin', 'cleaner', 'finance']) {
  test('I_fix flags OFF: ' + role + ' gets no Count it or Used some, and a hand-typed click or route opens nothing', async () => {
    const e = await setup({ role, flags: { count: false, usage: false }, client: cl() });
    await e.mount('item/i1');
    assert.match(e.sheet(), /Toilet paper/);
    assert.doesNotMatch(e.sheet(), /data-kind="count"|data-kind="used"/);
    await e.begin('count'); await e.begin('used');
    assert.doesNotMatch(e.sheet(), /Count Toilet paper|Used some Toilet paper|Record use: Toilet paper/);
    await e.submit();
    assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length + e.client.rpcCalls('record_inventory_usage').length, 0);
    assert.match(e.sheet(), /data-kind="shop"/); // everything else stays
  });
}

test('I_fix (1b) a controlled item can be received in the app: record_inventory_receipt_v1 writes its movement, so no dashboard detour', async () => {
  const e = await setup({ role: 'owner', client: cl() });
  await e.mount(''); await e.open('c1');
  assert.match(e.sheet(), /data-kind="recv"/);
  assert.doesNotMatch(e.sheet(), /Receive this one in the admin dashboard/);
  await e.begin('recv'); await e.submit(); await e.submit();
  assert.equal(e.client.rpcCalls('record_inventory_receipt_v1').length, 1);
});

test('I_fix (1b) Mark bought works for a controlled item too', async () => {
  const e = await setup({ role: 'owner', client: cl() });
  await e.mount('shopping');
  await e.act('shop-open', { 'data-id': 's3' });
  assert.match(e.sheet(), /shop-bought/); assert.doesNotMatch(e.sheet(), /Receive this one in the admin dashboard/);
  await e.act('shop-bought'); assert.match(e.sheet(), /Stock received:/);
});

test('I_fix Close, the scrim and Escape do nothing while a write is sending; the result then lands with its toast', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const e = await setup({ role: 'owner', client: cl({ rpc: { reconcile_inventory_baseline_v1: () => held } }) });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '12'); await e.submit(); await e.submit();
  const navsBefore = e.navs.length;
  await e.act('close'); await e.key('Escape');
  assert.match(e.sheet(), /Sending/); assert.equal(e.navs.length, navsBefore);
  release({ data: { ok: true }, error: null }); await flush();
  assert.equal(e.toasts.length, 1); assert.equal(e.sheet(), '');
});

test('I_fix a count note shorter than 3 characters falls back to the default and the server accepts it', async () => {
  const e = await setup({ role: 'owner', client: cl() });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_note', 'ok '); await e.submit(); await e.submit();
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1')[0][2].p_note, 'Counted in the staff app');
  assert.equal(e.toasts.length, 1); // the mock refuses a short note, so this is the server rule holding
  assert.equal(e.lib.countCall({ id: 'x' }, { qty: '1', note: 'abc' }, 'k'.repeat(16)).args.p_note, 'abc');
});

test('I_fix after a failed send the list is reloaded and the same key is used when the same submission is retried from a reopened sheet', async () => {
  let n = 0;
  const e = await setup({ role: 'owner', client: cl({ rpc: { reconcile_inventory_baseline_v1: () => { n++; return n === 1 ? { data: null, error: { code: 'XX000', message: 'boom' } } : { data: { ok: true }, error: null }; } } }) });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /did not go through/);
  assert.equal(e.client.rpcCalls('get_inventory_catalogue_v1').length, 2); // reloaded: the write may have landed
  await e.act('back'); await e.act('back'); await e.act('close'); // leave the sheet entirely
  await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit(); await e.submit();
  const c = e.client.rpcCalls('reconcile_inventory_baseline_v1');
  assert.equal(c.length, 2); assert.equal(c[0][2].p_idempotency_key, c[1][2].p_idempotency_key);
  // after success the same values get a fresh key
  await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit(); await e.submit();
  assert.notEqual(e.client.rpcCalls('reconcile_inventory_baseline_v1')[2][2].p_idempotency_key, c[0][2].p_idempotency_key);
});

test('I_fix a re-mount with a new sub keeps the fresh list (no second catalogue call) and the item route loads Last counted', async () => {
  const moves = [{ kind: 'reconcile', created_at: '2026-10-12T03:00:00Z' }];
  const e = await setup({ role: 'owner', client: cl({ moves }) });
  await e.mount(''); await e.input('I_q', 'soap');
  await e.mount('shopping'); assert.match(e.html(), /Hand soap/);
  await e.mount('item/i1');
  assert.match(e.sheet(), /Toilet paper/); assert.match(e.sheet(), /Last counted/); assert.match(e.sheet(), /Oct 12/);
  await e.mount('');
  assert.equal(e.client.rpcCalls('get_inventory_catalogue_v1').length, 1);
  assert.match(e.html(), /value="soap"/); // search kept too
});

test('I_fix a refused approve hides Approve and Remove, not Stock received', async () => {
  const e = await setup({ role: 'owner', client: cl({ rpc: { save_shopping_item_v1: () => ({ data: null, error: { code: '42501', message: 'not authorised' } }) } }) });
  await e.mount('shopping');
  await e.act('shop-open', { 'data-id': 's1' }); await e.act('shop-do', { 'data-do': 'approved' }); await e.submit();
  assert.match(e.sheet(), /This is not available to you\./);
  assert.doesNotMatch(e.sheet(), /data-do="approved"|data-do="rejected"/);
  await e.act('close'); await e.act('shop-open', { 'data-id': 's2' });
  assert.match(e.sheet(), /shop-bought/);
  await e.act('close'); await e.mount('item/i1');
  assert.match(e.sheet(), /data-kind="recv"/);
});

test('I_fix defaults: Count it is ON for owner, admin and cleaner (s85), Record use for the cleaner only', async () => {
  for (const [role, count, used] of [['owner', true, false], ['admin', true, false], ['cleaner', true, true], ['finance', false, false]]) {
    const e = await setup({ role, flags: null, client: cl() });
    await e.mount('item/i1');
    assert.equal(/data-kind="count"/.test(e.sheet()), count, role + ' count');
    assert.equal(/data-kind="used"/.test(e.sheet()), used, role + ' used');
  }
});

test('I_fix count confirm: a first count says it is one-way; a controlled item gets the plain question', async () => {
  const e = await setup({ role: 'owner', flags: null, client: cl() });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit();
  assert.match(e.sheet(), /Set Toilet paper to 9\?/);
  assert.match(e.sheet(), /After this, Toilet paper is counted in the app\. Telegram \/count will skip it\./);
  await e.act('back'); await e.act('back'); await e.act('close');
  await e.open('c1'); await e.begin('count'); await e.input('I_f_qty', '3'); await e.submit();
  assert.match(e.sheet(), /Set Controlled soap to 3\?/);
  assert.doesNotMatch(e.sheet(), /Telegram/);
});

test('I_fix3 after a successful write from an item sheet the shell re-mounts and the row shows the new quantity (the list is stale at once)', async () => {
  let qty = 4;
  const cat = () => ({ items: [item('i1', 'Toilet paper', qty, 12)] });
  const client = cl({ rpc: { get_inventory_catalogue_v1: () => ({ data: cat(), error: null }), reconcile_inventory_baseline_v1: () => { qty = 12; return { data: { ok: true }, error: null }; } } });
  const e = await setup({ role: 'owner', client });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '12'); await e.submit(); await e.submit();
  assert.ok(client.rpcCalls('get_inventory_catalogue_v1').length >= 2);
  assert.match(e.html(), /12 rolls/); assert.doesNotMatch(e.html(), /4 rolls/);
  assert.equal(e.navs[e.navs.length - 1], '#stock');
});

test('I_fix3 an idempotency key is forgotten after 10 minutes and kept before that', async () => {
  const bad = { data: null, error: { code: 'XX000', message: 'boom' } };
  const e = await setup({ role: 'owner', client: cl({ rpc: { reconcile_inventory_baseline_v1: () => bad } }) });
  const go = async () => { await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit(); await e.submit(); await e.act('back'); await e.act('back'); await e.act('close'); };
  await e.mount(''); await go();
  e.advance(9 * 60000); await go();
  e.advance(11 * 60000); await go();
  const k = e.client.rpcCalls('reconcile_inventory_baseline_v1').map((c) => c[2].p_idempotency_key);
  assert.equal(k.length, 3); assert.equal(k[0], k[1]); assert.notEqual(k[1], k[2]);
});
