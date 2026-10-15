// Lane I (s84 1b, Q3): item history and the suggested Buy up to. Frozen data, exact RPC name and key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const raw = () => ({ items: [item('i1', 'Toilet paper', 20, 12, { par: 36, codes: [] }), item('i2', 'Bath towels', 14, 10, { category: 'Linen', consumable: false, purchaseUnit: null, unitsPerPurchase: 1, codes: [] })] });
const HIST = {
  ok: true,
  usage: { cleans_30d: 22, used_30d: 44, per_clean: 2, cleans_14d: 6 }, // 2 x 6 x 1.5 = 18 -> 2 packs of 12 = 24
  changes: [
    { at: '2026-10-12T03:00:00Z', kind: 'reconcile', before: 9, after: 12, who: 'Marifel Santos' },
    { at: '2026-10-05T03:00:00Z', kind: 'receipt', before: 12, after: 24, who: 'Lloyd' },
    { at: '2026-10-04T03:00:00Z', kind: 'telegram_count', before: 10, after: 12, who: 'Honey' }
  ],
  last_bought: { at: '2026-10-05T03:00:00Z', qty: 12, unit_cost: 7391.55 }
};
const make = (role, h = HIST, extra = {}) => setup({ role, client: mockClient({ catalogue: raw(), rpc: { inventory_item_history_v1: () => ({ data: h, error: null }), ...extra } }) });
const hc = (e) => e.client.rpcCalls('inventory_item_history_v1');

test('I_history the History button opens the sheet through inventory_item_history_v1 {p_item_id}', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1');
  assert.equal(hc(e).length, 0);
  await e.act('history-open');
  assert.equal(hc(e).length, 1); assert.deepEqual(Object.keys(hc(e)[0][2]), ['p_item_id']); assert.equal(hc(e)[0][2].p_item_id, 'i1');
  assert.match(e.sheet(), /Use per clean/); assert.match(e.sheet(), /About 2 rolls per clean, over 22 cleans in the last 30 days/);
  assert.match(e.sheet(), /About 14 days left at the current booking pace \(an estimate\)/); // 20 / (2 x 22 / 30) = 13.6
});

test('I_history changes read as date, word, before to after and a first name; the last purchase is listed', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1'); await e.act('history-open');
  assert.match(e.sheet(), /Oct 12 · Counted 9 → 12 · Marifel(?! Santos)/);
  assert.match(e.sheet(), /Oct 5 · Received 12 → 24 · Lloyd/);
  assert.match(e.sheet(), /Oct 4 · Telegram count 10 → 12 · Honey/);
  assert.match(e.sheet(), /Last bought[\s\S]*Oct 5, 12/);
});

test('I_history a cleaner never sees a price, even if the payload carried one; finance and the owner do', async () => {
  const c = await make('cleaner'); await c.mount(''); await c.open('i1'); await c.act('history-open');
  assert.doesNotMatch(c.sheet(), /PHP|₱|7,391|7391|each/);
  for (const role of ['owner', 'finance']) {
    const e = await make(role); await e.mount(''); await e.open('i1'); await e.act('history-open');
    assert.match(e.sheet(), /PHP 7,391\.55 each/, role);
  }
  const noCost = await make('finance', { ...HIST, last_bought: { at: '2026-10-05T03:00:00Z', qty: 12 } }); await noCost.mount(''); await noCost.open('i1'); await noCost.act('history-open');
  assert.doesNotMatch(noCost.sheet(), /PHP/);
});

test('I_history fewer than 5 cleans says so plainly and offers no suggestion', async () => {
  const h = { ...HIST, usage: { cleans_30d: 3, used_30d: 6, per_clean: 2, cleans_14d: 2 } };
  const e = await make('owner', h); await e.mount(''); await e.open('i1'); await e.act('history-open');
  assert.match(e.sheet(), /Not enough cleans yet to tell\./); assert.doesNotMatch(e.sheet(), /days left/);
  await e.act('back'); await e.begin('levels');
  assert.doesNotMatch(e.sheet(), /Suggested/);
  const z = await make('owner', { ...HIST, usage: { cleans_30d: 0, used_30d: 0, per_clean: null, cleans_14d: 0 } }); await z.mount(''); await z.open('i1'); await z.act('history-open');
  assert.match(z.sheet(), /Not enough cleans yet to tell\./);
});

test('I_history suggestion maths: per clean x cleans in 14 days x 1.5, rounded up to a whole pack', async () => {
  const e = await make('owner'); await e.mount('');
  const it = e.lib.normalize(raw().items[0], 'owner'), one = e.lib.normalize(raw().items[1], 'owner');
  // lib has no suggest export on purpose: it is driven through the sheet below. Check the numbers through the screen.
  await e.open('i1'); await e.begin('levels');
  assert.match(e.sheet(), /Suggested: buy up to 24/); assert.match(e.sheet(), />Use 24</);
  assert.equal(it.perPack, 12); assert.equal(one.perPack, 1);
});

test('I_history a pack of one rounds to a whole unit; 2.4 x 1.5 over 5 cleans reads 18.9 rounds up', async () => {
  const h = { ...HIST, usage: { cleans_30d: 10, used_30d: 25, per_clean: 2.5, cleans_14d: 5 } }; // 2.5 x 5 x 1.5 = 18.75 -> 19 for a pack of 1
  const e = await make('owner', h); await e.mount(''); await e.open('i2'); await e.begin('levels');
  assert.match(e.sheet(), /Suggested: buy up to 19/);
});

test('I_history Use 24 fills the box and writes nothing until the confirm', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1'); await e.begin('levels');
  await e.act('use-sugg');
  assert.match(e.sheet(), /id="I_f_par"[^>]*value="24"/);
  assert.equal(e.client.rpcCalls('inventory_item_update_v1').length, 0);
  await e.submit();
  assert.equal(e.client.rpcCalls('inventory_item_update_v1').length, 0);
  await e.submit();
  assert.deepEqual({ ...e.client.rpcCalls('inventory_item_update_v1')[0][2].p_patch }, { reorder_below: 12, par_qty: 24 });
});

test('I_history only owner and admin get the suggestion (Edit levels is theirs)', async () => {
  const f = await make('finance'); await f.mount(''); await f.open('i1');
  assert.doesNotMatch(f.sheet(), /data-kind="levels"/);
  assert.equal(hc(f).length, 0);
});

test('I_history probe-and-hide: PGRST202 hides the History button, with a calm toast, and Edit levels still works without a suggestion', async () => {
  const miss = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  const e = await make('owner', HIST, { inventory_item_history_v1: () => miss });
  await e.mount(''); await e.open('i1'); await e.act('history-open');
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  assert.match(e.sheet(), /Toilet paper/); assert.doesNotMatch(e.sheet(), /data-act="history-open"/);
  await e.begin('levels'); assert.match(e.sheet(), /Edit details/); assert.doesNotMatch(e.sheet(), /Suggested/);
});

test('I_history a failure that is not "missing" gives the calm line and Back; the demo has no History', async () => {
  const e = await make('owner', HIST, { inventory_item_history_v1: () => ({ data: null, error: { code: 'XX000', message: 'boom' } }) });
  await e.mount(''); await e.open('i1'); await e.act('history-open');
  assert.match(e.sheet(), /did not go through/); await e.act('back'); assert.match(e.sheet(), /data-act="history-open"/);
  const d = await setup({ role: 'owner', demo: true }); await d.mount(''); await d.open('d1');
  assert.doesNotMatch(d.sheet(), /history-open/);
});
