// s124 (staff 3.4.39): the cleaner edits item details and sets a new price blind; one Undo through the change log; "Updated by" line; three-column history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const okd = (d) => () => ({ data: { ok: true, ...d }, error: null });
const bad = (d) => () => ({ data: { ok: false, ...d }, error: null });
const raw = (x = {}) => ({ items: [item('i1', 'Toilet paper', 4, 12, { par: 36, codes: [], location: 'Hall cabinet', ...x }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen', unit: 'bottles' })] });
const RPC = { inventory_item_update_v1: okd({ item_id: 'i1', change_id: 'chg-1' }), inventory_item_price_set_v1: okd({ item_id: 'i1', change_id: 'chg-2' }), inventory_item_change_undo_v1: okd({ item_id: 'i1', kind: 'details' }) };
const make = (role, rpc = {}, cat = raw()) => setup({ role, client: mockClient({ catalogue: cat, rpc: { ...RPC, ...rpc } }) });
const AMOUNT = /7391|7,391|₱|PHP [0-9]|\b95(\.\d+)?\b/;
const hist = (changes) => ({ inventory_item_history_v1: okd({ usage: { cleans_30d: 0, per_clean: null, cleans_14d: 0 }, changes }) });
const undoId = (html) => /data-id="(u\d+)"/.exec(html)[1];

test('s124 1: a cleaner sees Edit details and Change price in More, and History as a full row; no Report a problem', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1');
  const s = e.sheet();
  assert.match(s, /data-kind="levels">Edit details</); assert.match(s, /data-kind="price">Change price</);
  assert.match(s, /class="btn btn-secondary I_wide btn-block" type="button" data-act="history-open"/);
  assert.doesNotMatch(s, /Report a problem/);
  assert.ok(s.indexOf('data-kind="levels"') < s.indexOf('data-kind="price"'));
});

test('s124 2: the form starts with Name (80 max); a cleaner picks only categories already in use; the check step is an old to new list; only changed keys go', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.begin('levels');
  const f = e.sheet();
  assert.ok(f.indexOf('id="I_f_name"') > 0 && f.indexOf('id="I_f_name"') < f.indexOf('id="I_f_reorder"'));
  assert.match(f, /id="I_f_name" autocomplete="off" maxlength="80" required value="Toilet paper"/);
  assert.doesNotMatch(f, /<option value="Miscellaneous">/); assert.match(f, /<option value="Kitchen">/);
  await e.input('I_f_name', 'T'); await e.submit(); assert.match(e.sheet(), /2 to 80 characters/);
  await e.input('I_f_name', 'Toilet tissue'); await e.input('I_f_location', 'Bathroom shelf'); await e.submit();
  assert.match(e.sheet(), /<dl class="I_diff"><dt>Name<\/dt><dd><s>Toilet paper<\/s> → Toilet tissue<\/dd><dt>Kept in<\/dt><dd><s>Hall cabinet<\/s> → Bathroom shelf<\/dd><\/dl>/);
  assert.equal(e.client.rpcCalls('inventory_item_update_v1').length, 0);
  await e.submit();
  assert.deepEqual(e.client.rpcCalls('inventory_item_update_v1')[0][2], { p_item_id: 'i1', p_patch: { name: 'Toilet tissue', location: 'Bathroom shelf' } });
});

test('s124 2: nothing changed does not send; a taken name says so', async () => {
  const e = await make('cleaner', { inventory_item_update_v1: bad({ reason: 'name_exists', item_id: 'i2' }) }); await e.mount(''); await e.open('i1'); await e.begin('levels');
  await e.submit(); assert.match(e.sheet(), /Nothing has changed yet/); assert.equal(e.client.rpcCalls('inventory_item_update_v1').length, 0);
  await e.input('I_f_name', 'Hand soap'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /An item with that name already exists/);
});

test('s124 3: a cleaner sets a new price blind; no amount shows in the form, check, undo bar, Last change line or undo confirm', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.begin('price');
  const f = e.sheet();
  assert.match(f, /New price each \(PHP\)/); assert.match(f, /Prices stay private\. You will not see the current price\./);
  assert.match(f, /id="I_f_cost"[^>]*value=""/); assert.doesNotMatch(f, /7391|7,391|₱/);
  await e.submit(); assert.match(e.sheet(), /Enter a number such as 95/); // empty is not allowed blind
  await e.input('I_f_cost', '95'); await e.submit();
  assert.match(e.sheet(), /Save the new price for Toilet paper\?/); assert.match(e.sheet(), /Yes, save it/); assert.doesNotMatch(e.sheet(), /7391|7,391|₱|PHP 95|\b95\b/);
  await e.submit();
  assert.deepEqual(e.client.rpcCalls('inventory_item_price_set_v1')[0][2], { p_item_id: 'i1', p_unit_cost: 95 });
  assert.match(e.undo(), /Price saved for Toilet paper/); assert.doesNotMatch(e.undo(), AMOUNT);
  await e.open('i1'); assert.match(e.sheet(), /Last change: changed the price by you/); assert.doesNotMatch(e.sheet(), AMOUNT); assert.doesNotMatch(e.sheet(), /Unit cost/);
  await e.act('undo', { 'data-id': undoId(e.sheet()) });
  assert.match(e.sheet(), /Put the price of Toilet paper back as it was\?/); assert.doesNotMatch(e.sheet(), AMOUNT);
});

test('s124 3: the owner keeps the full price flow', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1'); await e.begin('price');
  assert.match(e.sheet(), /Price per rolls in PHP/); assert.match(e.sheet(), /value="7391\.55"/);
  await e.input('I_f_cost', '95'); await e.submit(); assert.match(e.sheet(), /Set the price of Toilet paper to PHP 95\?/);
});

test('s124 4: Undo of details and price calls inventory_item_change_undo_v1 with the change id; a photo does too', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.begin('levels');
  await e.input('I_f_name', 'Toilet tissue'); await e.submit(); await e.submit();
  await e.act('undo', { 'data-id': undoId(e.undo()) });
  assert.match(e.sheet(), /Put the details of Toilet paper back as they were\?/); await e.submit();
  assert.deepEqual(e.client.rpcCalls('inventory_item_change_undo_v1')[0][2], { p_change_id: 'chg-1' });
  assert.equal(e.client.rpcCalls('inventory_item_update_v1').length, 1); // no second update call
  const p = await make('cleaner'); await p.mount(''); await p.open('i1'); await p.begin('price'); await p.input('I_f_cost', '95'); await p.submit(); await p.submit();
  await p.act('undo', { 'data-id': undoId(p.undo()) }); await p.submit();
  assert.deepEqual(p.client.rpcCalls('inventory_item_change_undo_v1')[0][2], { p_change_id: 'chg-2' });
  const ph = await make('owner', { inventory_item_photo_set_v1: okd({ item_id: 'i1', before: 'old/p.webp', change_id: 'chg-3' }) }, raw({ photo: 'old/p.webp' })); await ph.mount(''); await ph.open('i1'); await ph.act('photo-remove'); await ph.submit();
  await ph.act('undo', { 'data-id': undoId(ph.undo()) }); await ph.submit();
  assert.deepEqual(ph.client.rpcCalls('inventory_item_change_undo_v1')[0][2], { p_change_id: 'chg-3' });
});

test('s124 4: undo refusals read as plain messages and the button turns into Close', async () => {
  for (const [reason, text] of [['too_late', /This can no longer be undone here/], ['changed_since', /Someone changed it after you\. Count or edit it again\./]]) {
    const e = await make('cleaner', { inventory_item_change_undo_v1: bad({ reason }) }); await e.mount(''); await e.open('i1'); await e.begin('levels');
    await e.input('I_f_name', 'Toilet tissue'); await e.submit(); await e.submit();
    await e.act('undo', { 'data-id': undoId(e.undo()) }); await e.submit();
    assert.match(e.sheet(), text); assert.match(e.sheet(), />Close</);
  }
});

const editName = async (e) => { await e.mount(''); await e.open('i1'); await e.begin('levels'); await e.input('I_f_name', 'Toilet tissue'); await e.submit(); await e.submit(); await e.act('undo', { 'data-id': undoId(e.undo()) }); await e.submit(); };

test('s124 4: a cleaner price save with no change id leaves no Undo bar and no Last change line', async () => {
  const e = await make('cleaner', { inventory_item_price_set_v1: okd({ item_id: 'i1' }) }); await e.mount(''); await e.open('i1'); await e.begin('price');
  await e.input('I_f_cost', '95'); await e.submit(); await e.submit();
  assert.equal(e.client.rpcCalls('inventory_item_price_set_v1').length, 1);
  assert.doesNotMatch(e.undo(), /data-act="undo"/);
  await e.open('i1'); assert.doesNotMatch(e.sheet(), /Last change|I_last/);
});

test('s124 4: a change undo that is already undone or not found says to edit again, and the button is Close', async () => {
  for (const reason of ['already_undone', 'not_found']) {
    const e = await make('cleaner', { inventory_item_change_undo_v1: bad({ reason }) }); await editName(e);
    assert.match(e.sheet(), /This can no longer be undone here\. Edit it again to correct it\./); assert.match(e.sheet(), />Close</);
    assert.doesNotMatch(e.sheet(), /Count the item/);
  }
});

test('s124 4: a change undo refused by the server (42501) hides Undo with a toast', async () => {
  const e = await make('cleaner', { inventory_item_change_undo_v1: () => ({ data: null, error: { code: '42501', message: 'permission denied', status: 403 } }) }); await editName(e);
  assert.ok(e.toasts.length > 0); assert.doesNotMatch(e.sheet(), /Yes, undo it/);
  await e.open('i1'); assert.doesNotMatch(e.sheet(), /I_last|Last change/);
});

test('s124 4: a change undo whose old name is now taken says so and the button is Close', async () => {
  const e = await make('cleaner', { inventory_item_change_undo_v1: bad({ reason: 'name_exists', item_id: 'i2' }) }); await editName(e);
  assert.match(e.sheet(), /An item with that name already exists/); assert.match(e.sheet(), />Close</); assert.doesNotMatch(e.sheet(), /Yes, undo it/);
});

test('s124 3: saving a new name toasts Details saved for the new name; a levels-only edit says Levels', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('i1'); await e.begin('levels'); await e.input('I_f_name', 'Toilet tissue'); await e.submit(); await e.submit();
  assert.ok(e.toasts.concat(e.undo()).some((m) => /Details saved for Toilet tissue/.test(m)), String(e.toasts) + e.undo());
  const l = await make('cleaner'); await l.mount(''); await l.open('i1'); await l.begin('levels'); await l.input('I_f_reorder', '5'); await l.submit(); await l.submit();
  assert.ok(l.toasts.concat(l.undo()).some((m) => /Levels saved for Toilet paper/.test(m)));
});

test('s124 5: the Updated line and history day are Manila days (17:30 UTC is next day)', async () => {
  const e = await make('cleaner', { ...hist([{ at: '2026-11-19T17:30:00Z', kind: 'counted', before: 1, after: 2, who: 'Lloyd' }]) }, raw({ updatedAt: '2026-11-19T17:30:00Z', updatedBy: 'Honey Santos' })); await e.mount(''); await e.open('i1');
  assert.match(e.sheet(), /Updated Nov 20 by Honey/);
  await e.act('history-open'); assert.match(e.sheet(), /I_hwhen">Nov 20</);
});

test('s124 5: the Updated line shows with a name and date, hides without one, and gives way to the Last change line', async () => {
  const e = await make('cleaner', {}, raw({ updatedAt: '2026-10-12T03:00:00Z', updatedBy: 'Honey Santos' })); await e.mount(''); await e.open('i1');
  assert.match(e.sheet(), /<p class="I_upd"><svg[^>]*>.*?<\/svg> Updated Oct 12 by Honey<\/p>/);
  assert.ok(e.sheet().indexOf('I_lvline') < e.sheet().indexOf('I_upd'));
  assert.doesNotMatch(e.sheet(), /Santos/);
  await e.begin('levels'); await e.input('I_f_name', 'Toilet tissue'); await e.submit(); await e.submit(); await e.open('i1');
  assert.match(e.sheet(), /I_last/); assert.doesNotMatch(e.sheet(), /I_upd/);
  const n = await make('cleaner'); await n.mount(''); await n.open('i1'); assert.doesNotMatch(n.sheet(), /I_upd|Updated/);
});

const CH = [
  { at: '2026-10-12T03:00:00Z', kind: 'details', who: 'Honey Santos', fields: { location: { before: null, after: 'Bathroom shelf' }, reorder_below: { before: 10, after: 8 } } },
  { at: '2026-10-11T03:00:00Z', kind: 'price', who: 'Honey', fields: {} },
  { at: '2026-10-10T03:00:00Z', kind: 'photo', who: 'Lloyd', fields: {} },
  { at: '2026-10-09T03:00:00Z', kind: 'counted', before: 7, after: 7, who: 'Lloyd' },
  { at: '2026-10-08T03:00:00Z', kind: 'received', before: 3, after: 10, who: 'Marifel' }
];
const row = (d, w, t, who) => new RegExp(d + '</span><span class="I_hwhat"><b>' + w + '</b>' + (t ? '<span>' + t + '</span>' : '') + '</span><span class="I_hwho">' + who + '</span></li>');

test('s124 6: history rows have three columns; a cleaner sees "Price changed" with no amounts', async () => {
  const e = await make('cleaner', hist(CH)); await e.mount(''); await e.open('i1'); await e.act('history-open');
  const s = e.sheet();
  assert.match(s, /<ul class="I_hist">/);
  assert.match(s, row('Oct 12', 'Details', 'Kept in → Bathroom shelf · Reorder at 10 → 8|Reorder at 10 → 8 · Kept in → Bathroom shelf', 'Honey'));
  assert.match(s, row('Oct 11', 'Price changed', '', 'Honey'));
  assert.match(s, row('Oct 10', 'Photo changed', '', 'Lloyd'));
  assert.match(s, row('Oct 9', 'Counted', '7 → 7 rolls', 'Lloyd'));
  assert.match(s, row('Oct 8', 'Received', '3 → 10 rolls', 'Marifel'));
  assert.doesNotMatch(s, AMOUNT);
});

test('s124 6: a price row shows amounts only to a role that may see prices; history without the new kinds renders as before', async () => {
  const ch = [{ at: '2026-10-11T03:00:00Z', kind: 'price', who: 'Honey', fields: { unit_cost: { before: 90, after: 95 } } }];
  const o = await make('owner', hist(ch)); await o.mount(''); await o.open('i1'); await o.act('history-open');
  assert.match(o.sheet(), row('Oct 11', 'Price changed', 'PHP 90 → PHP 95', 'Honey'));
  const c = await make('cleaner', hist(ch)); await c.mount(''); await c.open('i1'); await c.act('history-open');
  assert.match(c.sheet(), row('Oct 11', 'Price changed', '', 'Honey')); assert.doesNotMatch(c.sheet(), /\b90\b|\b95\b/);
  const old = await make('owner', hist([{ at: '2026-10-09T03:00:00Z', kind: 'counted', before: 7, after: 8, who: 'Lloyd' }])); await old.mount(''); await old.open('i1'); await old.act('history-open');
  assert.match(old.sheet(), row('Oct 9', 'Counted', '7 → 8 rolls', 'Lloyd'));
});
