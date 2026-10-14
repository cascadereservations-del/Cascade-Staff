// Lane I (s84 1b, Q1): Undo. A bar for 10 s after a write, a Last change line for 15 min, an own confirm step, the exact RPC for each of the 7 writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const okd = (d) => () => ({ data: { ok: true, ...d }, error: null });
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { par: 36, codes: [] }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unitCost: 95 })] });
const RPC = {
  reconcile_inventory_baseline_v1: okd({ movementId: 'mov-1', before: 4, after: 12 }),
  record_inventory_receipt_v1: okd({ purchaseId: 'pur-1', movementId: 'mov-2', unitsAdded: 12 }),
  inventory_item_price_set_v1: okd({ before: 7391.55, after: 95 }),
  inventory_code_attach_v1: okd({ item_id: 'i2' }),
  inventory_item_create_v1: okd({ item_id: 'new-1' }),
  save_shopping_item_v1: okd({ id: 'shop-1' }),
  inventory_item_update_v1: okd({ item_id: 'i1' })
};
const make = (role = 'owner', rpc = {}) => setup({ role, client: mockClient({ catalogue: raw(), rpc: { ...RPC, ...rpc } }) });
const press = async (e, n = 1) => { for (let i = 0; i < n; i++) await e.submit(); };
const bar = (e) => e.undo();
const barId = (e) => /data-id="(u\d+)"/.exec(bar(e))[1];
const last = (e, fn) => e.client.rpcCalls(fn).pop();

const WRITES = {
  count: { who: 'owner', say: /Counted Toilet paper: 12/, go: async (e) => { await e.open('i1'); await e.begin('count'); await e.input('I_f_qty', '12'); await press(e, 2); }, confirm: /Put Toilet paper back to 4\?/, fn: 'inventory_undo_v1', args: { p_movement_id: 'mov-1', p_purchase_id: null } },
  recv: { who: 'owner', say: /Received Toilet paper/, go: async (e) => { await e.open('i1'); await e.begin('recv'); await press(e, 2); }, confirm: /back out/, fn: 'inventory_undo_v1', args: { p_movement_id: 'mov-2', p_purchase_id: 'pur-1' } },
  price: { who: 'finance', say: /Price saved for Toilet paper/, go: async (e) => { await e.open('i1'); await e.begin('price'); await e.input('I_f_cost', '95'); await press(e, 2); }, confirm: /Put the price of Toilet paper back to PHP 7,391\.55\?/, fn: 'inventory_item_price_set_v1', args: { p_item_id: 'i1', p_unit_cost: 7391.55 } },
  link: { who: 'owner', say: /Linked a barcode to Hand soap/, go: async (e) => { await e.open('i2'); await e.act('begin-link'); await e.input('I_f_code', '777'); await e.submit(); await e.submit(); }, confirm: /Unlink code 777 from Hand soap\?/, fn: 'inventory_code_detach_v1', args: { p_property_id: PID, p_code: '777' } },
  create: { who: 'owner', say: /Added Spare keys/, go: async (e) => { await e.act('scan'); await e.input('I_f_code', '555'); await e.submit(); await e.act('scan-new'); await e.input('I_f_name', 'Spare keys'); await e.input('I_f_category', 'Miscellaneous'); await press(e, 2); }, confirm: /Remove Spare keys again\?/, fn: 'inventory_item_update_v1', args: { p_item_id: 'new-1', p_patch: { active: false } } },
  shop: { who: 'cleaner', say: /Added Toilet paper to the shopping list/, go: async (e) => { await e.open('i1'); await e.begin('shop'); await press(e, 2); }, confirm: /Take Toilet paper off the shopping list\?/, fn: 'save_shopping_item_v1', args: { p_property_id: PID, p_item: { id: 'shop-1', status: 'cancelled' } }, keyed: true },
  levels: { who: 'owner', say: /Levels saved for Toilet paper/, go: async (e) => { await e.open('i1'); await e.begin('levels'); await e.input('I_f_reorder', '10'); await press(e, 2); }, confirm: /Put the levels of Toilet paper back/, fn: 'inventory_item_update_v1', args: { p_item_id: 'i1', p_patch: { reorder_below: 12, par_qty: 36 } } }
};

for (const [name, w] of Object.entries(WRITES)) {
  test('I_undo ' + name + ': the bar shows, Undo asks first, then sends ' + w.fn + ' with the exact keys, then the bar and the line go', async () => {
    const e = await make(w.who);
    await e.mount('');
    await w.go(e);
    assert.match(bar(e), w.say); assert.match(bar(e), /↶<\/span> Undo/);
    const before = e.client.calls.filter((c) => c[1] === w.fn).length;
    await e.act('undo', { 'data-id': barId(e) });
    assert.match(e.sheet(), w.confirm);
    assert.equal(e.client.calls.filter((c) => c[1] === w.fn).length, before); // nothing before the confirm
    await e.submit();
    const c = last(e, w.fn);
    const got = JSON.parse(JSON.stringify(c[2]));
    if (w.keyed) { assert.ok(got.p_idempotency_key.length >= 16); delete got.p_idempotency_key; }
    assert.deepEqual(got, w.args);
    assert.match(e.toasts[e.toasts.length - 1], /^Undone\.$/);
    assert.equal(bar(e), '');
  });
}

test('I_undo the bar goes after 10 s on the frozen clock; the card keeps a Last change line for 15 minutes, for the person who made it', async () => {
  const e = await make('owner');
  await e.mount(''); await WRITES.count.go(e);
  assert.match(bar(e), /Undo/);
  e.advance(10001); await e.fireTimeouts();
  assert.equal(bar(e), '');
  await e.open('i1');
  assert.match(e.sheet(), /Last change: counted 12 by you, 0 min ago|Last change: counted 12 by you, just now/);
  assert.match(e.sheet(), /data-act="undo"/);
  await e.act('close');
  e.advance(5 * 60000); await e.open('i1');
  assert.match(e.sheet(), /5 min ago/);
  await e.act('close');
  e.advance(11 * 60000); await e.open('i1');
  assert.doesNotMatch(e.sheet(), /Last change/);
});

test('I_undo another item never shows the line, and a different role starts with none', async () => {
  const e = await make('owner');
  await e.mount(''); await WRITES.count.go(e);
  await e.open('i2'); assert.doesNotMatch(e.sheet(), /Last change/);
  e.unmount();
  const opts = { client: mockClient({ catalogue: raw() }), demo: false, role: 'admin', sub: '', navigate() {}, toast() {}, haptic() {} };
  e.win.I_Stock.mount(e.root, opts);
  assert.equal(bar(e), '');
});

test('I_undo too_late gives the calm line, then Undo goes away', async () => {
  const e = await make('owner', { inventory_undo_v1: () => ({ data: { ok: false, reason: 'too_late' }, error: null }) });
  await e.mount(''); await WRITES.count.go(e);
  await e.act('undo', { 'data-id': barId(e) }); await e.submit();
  assert.match(e.sheet(), /This can no longer be undone here\. Count the item to correct it\./);
  await e.act('close');
  assert.equal(bar(e), '');
  await e.open('i1'); assert.doesNotMatch(e.sheet(), /Last change/);
});

test('I_undo not_yours and stock_moved read the same calm way', async () => {
  for (const reason of ['not_yours', 'stock_moved']) {
    const e = await make('owner', { inventory_undo_v1: () => ({ data: { ok: false, reason }, error: null }) });
    await e.mount(''); await WRITES.count.go(e);
    await e.act('undo', { 'data-id': barId(e) }); await e.submit();
    assert.match(e.sheet(), /no longer be undone/, reason);
  }
});

test('I_undo probe-and-hide: inventory_undo_v1 missing hides Undo for counts, not for the others', async () => {
  const miss = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  const e = await make('owner', { inventory_undo_v1: () => miss });
  await e.mount(''); await WRITES.count.go(e);
  await e.act('undo', { 'data-id': barId(e) }); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  assert.equal(bar(e), '');
  await e.open('i1'); assert.doesNotMatch(e.sheet(), /Last change/);
  await WRITES.levels.go(e);
  assert.match(bar(e), /Levels saved/);
});

test('I_undo a write whose answer carries no movement id offers no Undo (a replay)', async () => {
  const e = await make('owner', { reconcile_inventory_baseline_v1: () => ({ data: { ok: true, replayed: true }, error: null }) });
  await e.mount(''); await WRITES.count.go(e);
  assert.equal(bar(e), '');
});

test('I_undo the bar timer pauses while the button has focus and gives 3 seconds after it leaves', async () => {
  const e = await make('owner');
  await e.mount(''); await WRITES.count.go(e);
  const id = barId(e), t = { getAttribute: (k) => ({ 'data-act': 'undo', 'data-id': id }[k] || null) };
  for (const f of e.root.l.focusin) await f({ target: t });
  e.advance(30000); await e.fireTimeouts();
  assert.match(bar(e), /Undo/);
  for (const f of e.root.l.focusout) await f({ target: t });
  assert.match(bar(e), /Undo/);
  e.advance(3500); await e.fireTimeouts();
  assert.equal(bar(e), '');
});

test('I_undo a cleaner can undo her own shopping request and nothing else; the demo writes nothing', async () => {
  const c = await make('cleaner');
  await c.mount(''); await WRITES.shop.go(c);
  assert.match(bar(c), /Undo/);
  const d = await setup({ role: 'owner', demo: true });
  await d.mount(''); await d.open('d1'); await d.begin('count'); await press(d, 2);
  assert.equal(bar(d), '');
});
