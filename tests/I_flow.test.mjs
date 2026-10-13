// Lane I: confirm steps, sending state, offline and refused states, probe failure, demo without network, routes and list behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, CATALOGUE, item, flush } from './I_harness.mjs';

const ok = () => ({ data: { ok: true }, error: null });
const WRITES = { count: ['owner', 'reconcile_inventory_baseline_v1'], used: ['cleaner', 'record_inventory_usage'], recv: ['owner', 'record_inventory_receipt_v1'], shop: ['cleaner', 'save_shopping_item_v1'] };

for (const kind of Object.keys(WRITES)) {
  test('I_flow ' + kind + ': a confirm step comes first, and nothing is sent until it is confirmed', async () => {
    const [role, fn] = WRITES[kind];
    const e = await setup({ role });
    await e.mount(''); await e.open('i1'); await e.begin(kind);
    assert.equal(e.client.rpcCalls(fn).length, 0);
    await e.submit(); // to the confirm step
    assert.equal(e.client.rpcCalls(fn).length, 0);
    assert.match(e.sheet(), /\?<\/h2>/); // the confirm title is a question
    if (kind === 'count') assert.match(e.sheet(), /Set Toilet paper to 4\?/);
    await e.act('back'); // Back from the confirm step: still nothing sent
    assert.equal(e.client.rpcCalls(fn).length, 0);
    await e.submit(); await e.submit();
    assert.equal(e.client.rpcCalls(fn).length, 1);
  });
}

test('I_flow count rejects a value that is not a number and stays on the form', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', 'abc'); await e.submit();
  assert.match(e.sheet(), /Enter a number/); assert.doesNotMatch(e.sheet(), /Set Toilet paper/);
  await e.input('I_f_qty', '1.234'); await e.submit(); assert.match(e.sheet(), /Enter a number/);
  await e.input('I_f_qty', '-3'); await e.submit(); assert.match(e.sheet(), /Enter a number/);
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length, 0);
  await e.input('I_f_qty', '0'); await e.submit(); assert.match(e.sheet(), /Set Toilet paper to 0\?/); // zero is a real count
});

test('I_flow the stepper moves by one, never below the minimum', async () => {
  const e = await setup({ role: 'cleaner' });
  await e.mount(''); await e.open('i1'); await e.begin('used');
  const dec = () => e.act('step', { 'data-f': 'qty', 'data-d': '-1', 'data-z': '0' });
  await dec(); assert.match(e.sheet(), /id="I_f_qty"[^>]*value="1"/);
  await e.act('step', { 'data-f': 'qty', 'data-d': '1', 'data-z': '0' }); assert.match(e.sheet(), /value="2"/);
});

test('I_flow the button is disabled while sending, a second submit sends nothing, then toast, haptic, refresh and close', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const client = mockClient({ catalogue: CATALOGUE, rpc: { reconcile_inventory_baseline_v1: () => held } });
  const e = await setup({ role: 'owner', client });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '12'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /type="submit" disabled>Sending/);
  await e.submit(); await e.act('begin', { 'data-kind': 'count' });
  assert.equal(client.rpcCalls('reconcile_inventory_baseline_v1').length, 1);
  assert.equal(client.rpcCalls('get_inventory_catalogue_v1').length, 1);
  release(ok()); await flush();
  assert.equal(e.toasts.length, 1); assert.match(e.toasts[0], /Counted/);
  assert.deepEqual(e.hapts, ['success']);
  assert.ok(client.rpcCalls('get_inventory_catalogue_v1').length >= 2); // list refreshed
  assert.equal(e.sheet(), ''); // sheet closed
  assert.equal(e.navs[e.navs.length - 1], '#stock');
});

test('I_flow offline: nothing is sent and the line says so, inline, with no queue', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.submit();
  e.nav.onLine = false;
  await e.submit();
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length, 0);
  assert.match(e.sheet(), /No connection, so nothing was sent\./);
  assert.equal(e.toasts.length, 0);
  e.nav.onLine = true; await e.submit(); // still on the confirm step: the person can send it now
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length, 1);
});

test('I_flow a network failure mid-send reads the same way', async () => {
  const client = mockClient({ catalogue: CATALOGUE, rpc: { record_inventory_usage: () => { throw new TypeError('Failed to fetch'); } } });
  const e = await setup({ role: 'cleaner', client });
  await e.mount(''); await e.open('i1'); await e.begin('used'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /No connection, so nothing was sent\./);
  assert.doesNotMatch(e.sheet(), /disabled>Sending/); // the button is back
});

test('I_flow refused (42501): a calm line and the action is gone', async () => {
  const client = mockClient({ catalogue: CATALOGUE, rpc: { reconcile_inventory_baseline_v1: () => ({ data: null, error: { code: '42501', message: 'not authorised' } }) } });
  const e = await setup({ role: 'owner', client });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /This is not available to you\./);
  assert.doesNotMatch(e.sheet(), /not authorised/); // the raw server text is never shown
  assert.doesNotMatch(e.sheet(), /data-kind="count"/);
  assert.match(e.sheet(), /data-kind="shop"/); // other actions stay
});

test('I_flow a server reason is mapped to plain words', async () => {
  const client = mockClient({ catalogue: CATALOGUE, rpc: { record_inventory_usage: () => ({ data: null, error: { code: '22023', message: 'insufficient stock for Toilet paper' } }) } });
  const e = await setup({ role: 'cleaner', client });
  await e.mount(''); await e.open('i1'); await e.begin('used'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /less on hand than that/); assert.doesNotMatch(e.sheet(), /insufficient stock/);
});

test('I_flow the catalogue refusing or missing shows "Inventory is not available right now" with Try again and never rows', async () => {
  for (const error of [{ code: 'PGRST202', message: 'Could not find the function' }, { code: '42501', message: 'denied' }, { code: 'XX000', message: 'boom' }]) {
    let fail = true;
    const client = mockClient({ catalogue: CATALOGUE, rpc: { get_inventory_catalogue_v1: () => (fail ? { data: null, error } : { data: CATALOGUE, error: null }) } });
    const e = await setup({ role: 'cleaner', client });
    await e.mount('');
    assert.match(e.html(), /Inventory is not available right now/); assert.match(e.html(), /Try again/);
    assert.doesNotMatch(e.html(), /Toilet paper|Hand soap|Bath towels/);
    fail = false; await e.act('retry');
    assert.match(e.html(), /Toilet paper/);
  }
});

test('I_flow offline on the first load says No connection and sends nothing', async () => {
  const e = await setup({ role: 'cleaner' });
  e.nav.onLine = false;
  await e.mount('');
  assert.match(e.html(), /No connection/); assert.match(e.html(), /Try again/);
  assert.equal(e.client.calls.length, 0);
});

test('I_flow a refused catalogue payload that is not a list is also "not available", never a sample', async () => {
  const e = await setup({ role: 'cleaner', client: mockClient({ catalogue: { nope: true } }) });
  await e.mount('');
  assert.match(e.html(), /Inventory is not available right now/);
  assert.doesNotMatch(e.html(), /data-act="open"/);
});

test('I_flow demo: a built-in sample of 12 items, a full write walk and no network call at all', async () => {
  const trip = new Proxy({}, { get() { throw new Error('network touched in demo'); }, has() { throw new Error('network touched in demo'); } });
  for (const role of ['owner', 'cleaner']) {
    const e = await setup({ role, demo: true, client: trip });
    await e.mount('');
    assert.equal((e.html().match(/data-act="open"/g) || []).length, 12);
    await e.open('d1');
    await e.begin(role === 'owner' ? 'count' : 'used'); await e.submit(); await e.submit();
    assert.match(e.toasts[0], /Demo only/);
    await e.open('d1'); await e.begin('shop'); await e.submit(); await e.submit();
    assert.equal(e.toasts.length, 2);
    await e.act('tab', { 'data-to': 'shopping' });
    assert.match(e.html(), /Hand soap/);
  }
});

test('I_flow demo for a cleaner carries no cost either', async () => {
  const e = await setup({ role: 'cleaner', demo: true });
  await e.mount(''); await e.open('d1');
  assert.doesNotMatch(e.html() + e.sheet(), /₱|Unit cost/);
  const o = await setup({ role: 'owner', demo: true });
  await o.mount(''); await o.open('d1');
  assert.match(o.sheet(), /Unit cost/);
});

test('I_flow route #stock/item/<id> opens that item once the list is here; Escape closes it and returns to #stock', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount('item/i2');
  assert.match(e.sheet(), /Hand soap/);
  assert.match(e.sheet(), /role="dialog"/);
  await e.key('Escape');
  assert.equal(e.sheet(), '');
  assert.equal(e.navs[e.navs.length - 1], '#stock');
});

test('I_flow opening an item and a tab go through navigate', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount(''); await e.open('i1'); assert.equal(e.navs[e.navs.length - 1], '#stock/item/i1');
  await e.act('close');
  await e.act('tab', { 'data-to': 'shopping' }); assert.equal(e.navs[e.navs.length - 1], '#stock/shopping');
});

test('I_flow header, order, chips and search', async () => {
  const e = await setup({ role: 'owner' });
  await e.mount('');
  assert.match(e.html(), /2 items low/); assert.match(e.html(), /1 is out/);
  assert.match(e.html(), /data-k="low" aria-pressed="true"/); // Low first is the default
  const order = [...e.html().matchAll(/class="t">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(order, ['Hand soap', 'Toilet paper', 'Bath towels']); // out, low, ok; the inactive lamp is hidden
  assert.match(e.html(), /✕<\/span> Out/); assert.match(e.html(), /▲<\/span> Low/); assert.match(e.html(), /✓<\/span> OK/);
  assert.match(e.html(), /data-k="c:Linen"/);
  await e.input('I_q', 'tow'); assert.deepEqual([...e.html().matchAll(/class="t">([^<]+)</g)].map((m) => m[1]), ['Bath towels']);
  await e.input('I_q', 'zzz'); assert.match(e.html(), /Nothing matches that search/);
  await e.act('showall'); assert.equal((e.html().match(/data-act="open"/g) || []).length, 3);
  await e.act('chip', { 'data-k': 'cons' }); assert.doesNotMatch(e.html(), /Bath towels/);
});

test('I_flow Stock is fine when nothing is low', async () => {
  const e = await setup({ role: 'cleaner', client: mockClient({ catalogue: { items: [item('a', 'Candles', 9, 2)] } }) });
  await e.mount('');
  assert.match(e.html(), /Stock is fine/); assert.doesNotMatch(e.html(), /items? low/);
});

test('I_flow level bar and words: pure helpers', async () => {
  const e = await setup({ role: 'cleaner' });
  const L = e.lib;
  assert.equal(L.level({ qty: 0, reorder: 3 }), 'out'); assert.equal(L.level({ qty: 3, reorder: 3 }), 'low'); assert.equal(L.level({ qty: 4, reorder: 3 }), 'ok'); assert.equal(L.level({ qty: 4, reorder: null }), 'ok');
  assert.equal(L.barPct({ qty: 6, reorder: 6 }), 50); assert.equal(L.barPct({ qty: 99, reorder: 6 }), 100); assert.equal(L.barPct({ qty: 4, reorder: null }), null);
  assert.equal(L.parseQty('2,5'), 2.5); assert.equal(L.parseQty('0'), null); assert.equal(L.parseQty('0', true), 0); assert.equal(L.parseQty('1e3'), null);
  assert.equal(L.errKind({ code: 'PGRST202' }), 'missing'); assert.equal(L.errKind({ code: '42501' }), 'refused'); assert.equal(L.errKind(new TypeError('x')), 'offline'); assert.equal(L.errKind({ code: '22023', message: 'x' }, false), 'offline');
});

test('I_flow unmount removes its listeners and a late answer does not throw', async () => {
  let release; const held = new Promise((r) => { release = r; });
  const client = mockClient({ catalogue: CATALOGUE, rpc: { get_inventory_catalogue_v1: () => held } });
  const e = await setup({ role: 'owner', client });
  await e.mount('');
  e.unmount();
  assert.equal(e.root.l.click.length, 0); assert.equal(e.root.l.submit.length, 0);
  release({ data: CATALOGUE, error: null }); await flush();
});
