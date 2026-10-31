// Lane I (s84 1b, Q2): Count this group, one item per screen, and the Needs a count chip (frozen clock 2026-10-15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const raw = () => ({ items: [
  item('b1', 'Shampoo', 9, 4, { category: 'Bath', countedAt: '2026-10-01T03:00:00Z' }), // ok, counted 14 days ago
  item('b2', 'Toilet paper', 4, 12, { category: 'Bath', countedAt: '2026-09-01T03:00:00Z' }), // low, 44 days ago
  item('b3', 'Hand soap', 0, 3, { category: 'Bath', countedAt: null }), // out, never
  item('k1', 'Dish soap', 5, 2, { category: 'Kitchen', countedAt: '2026-10-10T03:00:00Z' }),
  item('l1', 'Bath towels', 14, 10, { category: 'Linen', consumable: false, countedAt: null }) // not a consumable: never "needs a count"
] });
const rec = (a) => ({ data: { ok: true, movementId: 'mv-' + a.p_item_id, before: 1, after: 2 }, error: null });
const make = (role = 'owner', rpc = {}, cat = raw()) => setup({ role, client: mockClient({ catalogue: cat, rpc: { reconcile_inventory_baseline_v1: rec, ...rpc } }) });
const rc = (e) => e.client.rpcCalls('reconcile_inventory_baseline_v1');
const start = async (e, cat = 'Bath') => { await e.mount(''); await e.act('walk', { 'data-cat': cat }); };

test('I_count-walk the walk follows the group order, one item per screen, and opening it writes nothing', async () => {
  const e = await make(); await start(e);
  assert.match(e.sheet(), /Item 1 of 3/); assert.match(e.sheet(), /Hand soap/); // Out first, then Low, then OK
  assert.equal(rc(e).length, 0);
  assert.match(e.sheet(), /Not counted in the app yet/);
  await e.act('w-same'); assert.match(e.sheet(), /Item 2 of 3[\s\S]*Toilet paper/); assert.match(e.sheet(), /Last counted Sep 1/);
  await e.act('w-same'); assert.match(e.sheet(), /Item 3 of 3[\s\S]*Shampoo/);
  assert.match(e.sheet(), />Finish</);
});

test('I_count-walk Same as before writes nothing at all', async () => {
  const e = await make(); await start(e);
  await e.act('w-same'); await e.act('w-same'); await e.act('w-same');
  assert.equal(rc(e).length, 0);
  assert.match(e.sheet(), /0 counted, 3 the same/);
});

test('I_count-walk Next saves that item at once: one reconcile with the exact keys, a note and one key per item', async () => {
  const e = await make(); await start(e);
  assert.match(e.sheet(), /value="0"/); // prefilled with the current quantity
  await e.input('I_f_qty', '6'); await e.submit();
  const c = rc(e);
  assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][2]).sort(), ['p_counted_qty', 'p_idempotency_key', 'p_item_id', 'p_note']);
  assert.deepEqual({ p_item_id: c[0][2].p_item_id, p_counted_qty: c[0][2].p_counted_qty, p_note: c[0][2].p_note }, { p_item_id: 'b3', p_counted_qty: 6, p_note: 'Group count in the staff app' });
  assert.match(e.sheet(), /Item 2 of 3/); assert.match(e.sheet(), /<\/svg><span>Saved</);
  await e.submit(); await e.submit();
  const k = rc(e).map((x) => x[2].p_idempotency_key);
  assert.equal(new Set(k).size, 3);
  assert.deepEqual(rc(e).map((x) => x[2].p_item_id), ['b3', 'b2', 'b1']);
  assert.match(e.sheet(), /3 counted, 0 the same/);
});

test('I_count-walk a failure on item 2 stays on item 2 with the inline line, keeps item 1, and the retry reuses the key', async () => {
  let n = 0;
  const e = await make('owner', { reconcile_inventory_baseline_v1: (a) => (a.p_item_id === 'b2' && ++n === 1 ? { data: null, error: { code: 'XX000', message: 'boom' } } : rec(a)) });
  await start(e);
  await e.input('I_f_qty', '1'); await e.submit();
  await e.input('I_f_qty', '7'); await e.submit();
  assert.match(e.sheet(), /Item 2 of 3/); assert.match(e.sheet(), /did not go through/);
  const first = rc(e)[1][2].p_idempotency_key;
  await e.submit();
  assert.equal(rc(e)[2][2].p_idempotency_key, first);
  assert.match(e.sheet(), /Item 3 of 3/);
  await e.act('w-stop');
  assert.match(e.sheet(), /2 counted, 0 the same/);
});

test('I_count-walk offline stays on the item and sends nothing', async () => {
  const e = await make(); await start(e); e.nav.onLine = false; await e.submit();
  assert.equal(rc(e).length, 0); assert.match(e.sheet(), /No connection/); assert.match(e.sheet(), /Item 1 of 3/);
});

test('I_count-walk a change of more than half is marked and can be undone from the summary', async () => {
  const e = await make(); await start(e);
  await e.act('w-same');
  await e.input('I_f_qty', '40'); await e.submit(); // Toilet paper 4 -> 40
  await e.act('w-same');
  assert.match(e.sheet(), /1 counted, 2 the same, 1 changed by more than half/);
  assert.match(e.sheet(), /<\/svg> Toilet paper/); assert.match(e.sheet(), /4 → 40/);
  const id = /data-act="undo" data-id="(u\d+)"/.exec(e.sheet())[1];
  await e.act('undo', { 'data-id': id });
  assert.match(e.sheet(), /Put Toilet paper back to 4\?/);
  await e.submit();
  assert.deepEqual({ ...e.client.rpcCalls('inventory_undo_v1')[0][2] }, { p_movement_id: 'mv-b2', p_purchase_id: null });
});

test('I_count-walk closing partway keeps what was saved and says so', async () => {
  const e = await make(); await start(e);
  await e.input('I_f_qty', '5'); await e.submit();
  await e.act('close');
  assert.match(e.toasts[e.toasts.length - 1], /^1 item saved\. The rest were not changed\.$/);
  assert.equal(e.sheet(), '');
});

test('I_count-walk Stop here goes to the summary with the rest unchanged', async () => {
  const e = await make(); await start(e);
  await e.act('w-stop');
  assert.match(e.sheet(), /The rest were not changed/);
});

test('I_count-walk the Needs a count chip lists consumables never counted or older than 30 days (frozen clock)', async () => {
  const e = await make(); await e.mount('');
  assert.match(e.html(), /To count/); assert.match(e.html(), /2 to count/);
  await e.act('chip', { 'data-k': 'need' });
  const h = e.html().slice(e.html().indexOf('I_list'));
  assert.match(h, /Hand soap/); assert.match(h, /Toilet paper/);
  assert.doesNotMatch(h, /Shampoo/); assert.doesNotMatch(h, /Dish soap/); assert.doesNotMatch(h, /Bath towels/);
  e.advance(20 * 86400000); // Shampoo (14 days) is now 34 days old
  await e.act('chip', { 'data-k': 'need' });
  assert.match(e.html().slice(e.html().indexOf('I_list')), /Shampoo/);
});

test('I_count-walk finance never sees the button, the chip or the summary line; a hand-made click does nothing (the cleaner may count since s85)', async () => {
  for (const role of ['finance']) {
    const e = await make(role); await e.mount('');
    assert.doesNotMatch(e.html(), /Count this group|Needs a count|need a count/, role);
    await e.act('walk', { 'data-cat': 'Bath' }); assert.equal(e.sheet(), '', role);
    await e.act('chip', { 'data-k': 'need' });
    assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length, 0);
  }
});

test('I_count-walk probe-and-hide: a catalogue without countedAt has no chip and no summary line, but the walk still works', async () => {
  const old = { items: raw().items.map(({ countedAt, ...r }) => r) };
  const e = await make('owner', {}, old); await e.mount('');
  assert.doesNotMatch(e.html(), /Needs a count/); assert.match(e.html(), /Count this group/);
});

test('I_count-walk the button is on every group, and also under a category chip (a shelf count starts there)', async () => {
  const e = await make(); await e.mount('');
  assert.equal([...e.html().matchAll(/data-act="walk"/g)].length, 3);
  await e.act('chip', { 'data-k': 'c:Bath' });
  assert.equal([...e.html().matchAll(/data-act="walk"/g)].length, 1);
  await e.act('walk', { 'data-cat': 'Bath' }); assert.match(e.sheet(), /Item 1 of 3/);
});

test('I_count-walk a refusal ends the walk with a calm line and hides the button for the visit', async () => {
  const e = await make('owner', { reconcile_inventory_baseline_v1: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) });
  await start(e); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available to you/);
  assert.doesNotMatch(e.html(), /data-act="walk"/);
});

test('I_count-walk demo: the walk writes nothing', async () => {
  const e = await setup({ role: 'owner', demo: true });
  await e.mount(''); await e.act('walk', { 'data-cat': 'Bathroom' }); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /Demo only/);
});
