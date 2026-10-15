// Lane I (s85): the cleaner can update the amount left (Count it) and record use (Record use). Prices stay hidden. Frozen clock 2026-10-15.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { unitCost: 7391.55, countedAt: null }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unitCost: 95, countedAt: null })] });
const okd = (d) => () => ({ data: { ok: true, ...d }, error: null });
const denied = () => ({ data: null, error: { code: '42501', message: 'permission denied for function' } });
const make = (role = 'cleaner', rpc = {}, o = {}) => setup({ role, ...o, client: mockClient({ catalogue: raw(), rpc: { record_inventory_usage: okd({ rows: 1, movements: ['mov-u1'] }), reconcile_inventory_baseline_v1: okd({ movementId: 'mov-c1', before: 4, after: 9 }), ...rpc } }) });

test('I_staff the cleaner sees Record use on the card by default (no flag set) and it sends record_inventory_usage with the right rows', async () => {
  const e = await make('cleaner', {}, { flags: null });
  await e.mount(''); await e.open('i1');
  assert.match(e.sheet(), /data-kind="used"[^>]*>Record use</);
  await e.begin('used'); await e.act('step', { 'data-f': 'qty', 'data-d': '1', 'data-z': '0' }); await e.submit();
  assert.match(e.sheet(), /Log 2 rolls of Toilet paper as used\?/);
  assert.equal(e.client.rpcCalls('record_inventory_usage').length, 0);
  await e.submit();
  const c = e.client.rpcCalls('record_inventory_usage');
  assert.equal(c.length, 1);
  const a = c[0][2];
  assert.equal(a.p_property_id, PID); assert.equal(a.p_session_date, '2026-10-15'); assert.equal(a.p_rows.length, 1);
  assert.equal(a.p_rows[0].item_id, 'i1'); assert.equal(a.p_rows[0].used_qty, 2); assert.ok(a.p_rows[0].usage_key.length >= 16);
  assert.match(e.undo(), /Logged 2 rolls of Toilet paper as used/); // the Undo bar says it, so no toast over it
  assert.doesNotMatch(e.undo() + e.toasts.join(' '), /!/);
});

test('I_staff Undo of a use sends inventory_undo_v1 with the movement and asks first; no movement in the answer means no Undo bar', async () => {
  const e = await make('cleaner');
  await e.mount(''); await e.open('i1'); await e.begin('used'); await e.submit(); await e.submit();
  assert.match(e.undo(), /Logged 1 rolls of Toilet paper as used/);
  const id = /data-id="(u\d+)"/.exec(e.undo())[1];
  await e.act('undo', { 'data-id': id });
  assert.match(e.sheet(), /Put the 1 rolls of Toilet paper back\?/);
  assert.equal(e.client.rpcCalls('inventory_undo_v1').length, 0);
  await e.submit();
  assert.deepEqual(e.client.rpcCalls('inventory_undo_v1')[0][2], { p_movement_id: 'mov-u1', p_purchase_id: null });
  assert.match(e.toasts[e.toasts.length - 1], /^Undone\.$/); assert.equal(e.undo(), '');
  const n = await make('cleaner', { record_inventory_usage: okd({ rows: 1 }) });
  await n.mount(''); await n.open('i1'); await n.begin('used'); await n.submit(); await n.submit();
  assert.equal(n.undo(), ''); assert.match(n.toasts[n.toasts.length - 1], /Logged/);
});

test('I_staff the cleaner sees Count it and it sends reconcile_inventory_baseline_v1; Count a group and Needs a count show for her too', async () => {
  const e = await make('cleaner');
  await e.mount('');
  assert.match(e.html(), /Count this group/); assert.match(e.html(), /need a count/);
  await e.open('i1');
  assert.match(e.sheet(), /data-kind="count"/);
  await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit();
  assert.match(e.sheet(), /Set Toilet paper to 9\?/);
  await e.submit();
  const c = e.client.rpcCalls('reconcile_inventory_baseline_v1');
  assert.equal(c.length, 1); assert.equal(c[0][2].p_item_id, 'i1'); assert.equal(c[0][2].p_counted_qty, 9); assert.ok(c[0][2].p_idempotency_key.length >= 16);
  assert.match(e.undo(), /Counted Toilet paper: 9/);
});

test('I_staff a 42501 on a cleaner count hides Count for the visit with no error box; Running low stays; a re-mount keeps it hidden', async () => {
  const e = await make('cleaner', { reconcile_inventory_baseline_v1: denied });
  await e.mount(''); await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '9'); await e.submit(); await e.submit();
  assert.doesNotMatch(e.sheet(), /errbox|not available to you|Ask the owner/);
  assert.doesNotMatch(e.sheet(), /data-kind="count"/); assert.match(e.sheet(), /data-kind="low"/);
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length, 1);
  await e.act('close');
  assert.doesNotMatch(e.html(), /Count this group|need a count/);
  await e.mount(''); await e.open('i1'); assert.doesNotMatch(e.sheet(), /data-kind="count"/);
  await e.begin('count'); assert.doesNotMatch(e.sheet(), /Counted \(/); // a hand-made click does nothing
  assert.equal(e.client.rpcCalls('reconcile_inventory_baseline_v1').length, 1);
});

test('I_staff a 42501 in the cleaner group count ends the walk with a calm toast and hides Count', async () => {
  const e = await make('cleaner', { reconcile_inventory_baseline_v1: denied });
  await e.mount(''); await e.act('walk', { 'data-cat': 'Bathroom' });
  if (!e.sheet()) await e.act('walk', { 'data-cat': 'Kitchen' });
  assert.match(e.sheet(), /Item 1 of/);
  await e.act('begin'); // no-op safety
  await e.submit();
  assert.equal(e.sheet(), ''); assert.doesNotMatch(e.html(), /Count this group/); assert.doesNotMatch(e.toasts.join(' '), /Ask the owner/);
});

test('I_staff the cleaner never sees a price, cost or peso sign through Count, Record use and the undo line', async () => {
  const e = await make('cleaner');
  await e.mount('');
  const bad = /₱|PHP|Unit cost|7391|7,391|Change price|Stock received|Edit levels|data-kind="(recv|price|levels|link)"|data-act="bought-open"|Unlink/;
  assert.doesNotMatch(e.html(), bad);
  await e.open('i1'); assert.doesNotMatch(e.sheet(), bad);
  for (const k of ['count', 'used']) { await e.begin(k); assert.doesNotMatch(e.sheet(), bad); await e.submit(); assert.doesNotMatch(e.sheet(), bad); await e.submit(); await e.open('i1'); assert.doesNotMatch(e.sheet(), bad); }
  assert.equal(Object.prototype.hasOwnProperty.call(e.lib.normalize(raw().items[0], 'cleaner'), 'cost'), false);
});

test('I_staff owner and admin are unchanged: Count it, no Record use, prices still shown to them', async () => {
  for (const role of ['owner', 'admin']) {
    const e = await make(role, {}, { flags: null });
    await e.mount(''); await e.open('i1');
    assert.match(e.sheet(), /data-kind="count"/); assert.doesNotMatch(e.sheet(), /data-kind="used"/); assert.match(e.sheet(), /Unit cost/);
    await e.begin('used'); assert.doesNotMatch(e.sheet(), /Used some|Record use:|How much did you use/); // a hand-made click does nothing
  }
});

test('I_staff finance gets neither Count nor Record use', async () => {
  const e = await make('finance', {}, { flags: null });
  await e.mount(''); await e.open('i1');
  assert.doesNotMatch(e.sheet(), /data-kind="(count|used)"/); assert.doesNotMatch(e.html(), /Count this group/);
});
