// s132 lane L2: the Update sheet. One Update button, the options each kind of item allows, one short form each, payload per form, photo first with an emoji fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, NOW } from './I_harness.mjs';

const PID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
const P1 = 'items/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp';
const URL1 = 'https://stay.example/storage/v1/object/sign/inventory-photos/' + P1 + '?token=aaa';
const raw = () => ({ items: [
  item('c1', 'Coffee (3-in-1)', 18, 10, { category: 'Kitchen supplies', unit: 'sachets', purchaseUnit: 'box', unitsPerPurchase: 30 }),
  item('u1', 'Drinking glass', 6, null, { category: 'Kitchen utensils', unit: 'pcs', consumable: false, purchaseUnit: null, unitsPerPurchase: 1, photo: P1 }),
  item('a1', 'Rice cooker', 1, null, { category: 'Appliances', unit: 'pc', consumable: false, purchaseUnit: null, unitsPerPurchase: 1 }),
  item('l1', 'Bath towels', 14, 10, { category: 'Linen', unit: 'pieces', consumable: false, purchaseUnit: null, unitsPerPurchase: 1 })
], sourceAsOf: NOW });
const sign = (b) => (b.action === 'sign' ? { data: { ok: true, urls: { [P1]: URL1 } }, error: null } : { data: { ok: true, path: P1 }, error: null });
const make = (role = 'cleaner', rpc = {}, extra = {}) => setup({ role, doc: {}, ...extra, client: mockClient({ catalogue: raw(), rpc, fn: { 'upload-photo': sign } }) });
const kindsIn = (s) => [...s.matchAll(/data-act="upd-pick" data-kind="(\w+)"/g)].map((m) => m[1]);
const okd = (d) => () => ({ data: { ok: true, ...d }, error: null });
const the = (e, fn) => e.client.rpcCalls(fn);

test('s132 option sets: a consumable shows Used up, a lasting item Broken or missing, linen Stained or damaged; Bought and Recount always', async () => {
  const e = await make('owner'); await e.mount('');
  const want = { c1: ['used', 'recv', 'count'], u1: ['brk', 'recv', 'count'], a1: ['brk', 'recv', 'count'], l1: ['lin', 'recv', 'count'] };
  for (const id of Object.keys(want)) {
    await e.open(id); await e.begin('update');
    assert.deepEqual(kindsIn(e.sheet()), want[id], id);
    assert.deepEqual([...e.lib.updKinds(raw().items.find((x) => x.id === id))], want[id], id + ' lib');
    await e.act('close');
  }
  await e.open('c1'); await e.begin('update');
  assert.match(e.sheet(), /Used up/); assert.doesNotMatch(e.sheet(), /Broken or missing|Stained or damaged/);
  await e.act('close'); await e.open('l1'); await e.begin('update');
  assert.match(e.sheet(), /Stained or damaged/); assert.doesNotMatch(e.sheet(), /Used up|Broken or missing/);
  await e.act('close'); await e.open('a1'); await e.begin('update');
  assert.match(e.sheet(), /Broken or missing/); assert.doesNotMatch(e.sheet(), /Used up|Stained or damaged/);
  // a hand-made click for an option the item does not allow does nothing
  await e.act('close'); await e.open('c1'); await e.begin('brk'); assert.doesNotMatch(e.sheet(), /I_hue_brk/);
  await e.act('close'); await e.open('u1'); await e.begin('lin'); assert.doesNotMatch(e.sheet(), /I_hue_lin/);
});

test('s132 option rows are tinted by their own hue, and each form has a band, a before-to-after graphic and a Save button that says what happens', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('c1'); await e.begin('update');
  assert.match(e.sheet(), /I_hue_use/); assert.match(e.sheet(), /I_hue_buy/); assert.match(e.sheet(), /I_hue_cnt/);
  for (const [kind, hue, save] of [['used', 'use', /Save · 1 used/], ['recv', 'buy', /Save · \+30 sachets/], ['count', 'cnt', /Save count/]]) {
    await e.act('upd-pick', { 'data-kind': kind });
    const s = e.sheet();
    assert.match(s, new RegExp('I_uf I_hue_' + hue)); assert.match(s, /class="I_band"/); assert.match(s, /class="I_flow"/); assert.match(s, kind === 'count' ? /app says/ : /<small>now<\/small>/); assert.match(s, kind === 'count' ? /you counted/ : /<small>after<\/small>/); assert.match(s, save);
    await e.act('back'); assert.match(e.sheet(), /upd-pick/); // Back returns to the three options
  }
});

test('s132 who sees Update: owner, admin, cleaner and laundry; finance, inspector and maintenance do not', async () => {
  for (const [role, yes] of [['owner', 1], ['admin', 1], ['cleaner', 1], ['laundry', 1], ['finance', 0]]) {
    const e = await make(role); await e.mount(''); await e.open('c1');
    assert.equal(/data-kind="update"/.test(e.sheet()), !!yes, role + ' card');
    assert.equal(/data-act="quick" data-kind="update"/.test(e.html()), !!yes, role + ' row');
    await e.begin('update');
    assert.equal(/upd-pick/.test(e.sheet()), !!yes, role + ' sheet');
  }
  const L = (await make('owner')).lib;
  for (const r of ['owner', 'admin', 'cleaner', 'laundry']) assert.equal(L.canUpdate(r), true, r);
  for (const r of ['finance', 'inspector', 'maintenance', '', null]) assert.equal(L.canUpdate(r), false, String(r));
});

test('s132 payload: Used up sends record_inventory_usage with the picked note and a usage key', async () => {
  const e = await make('cleaner'); await e.mount(''); await e.open('c1'); await e.begin('used');
  await e.act('step', { 'data-f': 'qty', 'data-d': '1', 'data-z': '0' }); await e.act('upd-note', { 'data-v': 'Cleaning' });
  await e.submit();
  const c = the(e, 'record_inventory_usage'); assert.equal(c.length, 1);
  const a = c[0][2];
  assert.equal(a.p_property_id, PID); assert.equal(a.p_notes, 'Cleaning'); assert.equal(a.p_rows[0].item_id, 'c1'); assert.equal(a.p_rows[0].used_qty, 2); assert.ok(a.p_rows[0].usage_key.length >= 16);
});

test('s132 payload: Broken or missing sends record_inventory_damage_v1 (source update, add to list on, no stay without a booking)', async () => {
  const e = await make('cleaner', { record_inventory_damage_v1: okd({ report_id: 'r1' }) }); await e.mount(''); await e.open('u1'); await e.begin('brk');
  await e.act('upd-set', { 'data-f': 'what', 'data-v': 'missing' }); await e.input('I_f_qty', '2'); await e.act('upd-note', { 'data-v': 'Not found at turnover' });
  await e.submit();
  const c = the(e, 'record_inventory_damage_v1'); assert.equal(c.length, 1);
  const a = c[0][2];
  assert.deepEqual(a.p_rows, [{ item_id: 'u1', qty: 2, reason: 'missing', note: 'Not found at turnover' }]);
  assert.equal(a.p_source, 'update'); assert.equal(a.p_add_to_list, true); assert.equal(a.p_booking_id, null); assert.equal(a.p_photo_path, null); assert.equal(a.p_note, 'Not found at turnover'); assert.ok(a.p_idempotency_key.length >= 16);
  // the add-to-list switch turns off
  const f = await make('cleaner', { record_inventory_damage_v1: okd({ report_id: 'r2' }) }); await f.mount(''); await f.open('a1'); await f.begin('brk');
  await f.act('upd-sw', { 'data-f': 'list' }); await f.submit();
  assert.equal(the(f, 'record_inventory_damage_v1')[0][2].p_add_to_list, false);
  assert.equal(the(f, 'record_inventory_damage_v1')[0][2].p_rows[0].reason, 'broken');
});

test('s132 payload: Stained or damaged sends record_linen_stains_v1 with the outcome, the reason and the Manila date', async () => {
  const e = await make('laundry', { record_linen_stains_v1: okd({}) }); await e.mount(''); await e.open('l1'); await e.begin('lin');
  await e.act('upd-set', { 'data-f': 'what', 'data-v': 'damaged' }); await e.act('upd-set', { 'data-f': 'now', 'data-v': 'needs_replacing' });
  await e.submit();
  const c = the(e, 'record_linen_stains_v1'); assert.equal(c.length, 1);
  const a = c[0][2];
  assert.equal(a.p_property, PID); assert.equal(a.p_session_date, '2026-10-15'); assert.equal(a.p_logged_by, 'staff');
  assert.deepEqual(a.p_rows, [{ item_id: 'l1', outcome: 'needs_replacing', qty: 1, reason: 'damaged' }]); assert.equal(a.p_photo_path, null); assert.ok(a.p_idempotency_key.length >= 16);
});

test('s132 payload: Bought is a manual receipt for staff and a receipt with a cost per pack for the owner; Recount sends the default note', async () => {
  const s = await make('cleaner', { inventory_receipt_manual_v1: okd({ draft_id: 'd1' }) }); await s.mount(''); await s.open('c1'); await s.begin('recv');
  await s.input('I_f_packs', '2'); await s.input('I_f_total', '240'); await s.submit();
  const m = the(s, 'inventory_receipt_manual_v1'); assert.equal(m.length, 1);
  assert.deepEqual(m[0][2].p_lines, [{ item_id: 'c1', new_item: null, qty_units: 60 }]); assert.equal(m[0][2].p_total_paid, 240); assert.equal(m[0][2].p_purchased_on, '2026-10-15'); assert.equal(m[0][2].p_vendor, null); assert.equal(m[0][2].p_receipt_path, null);
  const o = await make('owner'); await o.mount(''); await o.open('c1'); await o.begin('recv');
  await o.input('I_f_packs', '2'); await o.input('I_f_total', '240'); await o.submit();
  const r = the(o, 'record_inventory_receipt_v1'); assert.equal(r.length, 1);
  assert.equal(r[0][2].p_packs, 2); assert.equal(r[0][2].p_unit_cost, 120); assert.equal(r[0][2].p_receipt_path, null);
  const k = await make('cleaner'); await k.mount(''); await k.open('c1'); await k.begin('count'); await k.input('I_f_qty', '15'); await k.submit();
  const n = the(k, 'reconcile_inventory_baseline_v1'); assert.equal(n.length, 1); assert.equal(n[0][2].p_counted_qty, 15); assert.equal(n[0][2].p_note, 'Recount');
});

test('s132 a quantity that is not a whole number from 1 to 99 stays on the form and sends nothing (broken, missing, linen)', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('u1'); await e.begin('brk');
  for (const bad of ['0', '1.5', '100', 'abc', '']) { await e.input('I_f_qty', bad); await e.submit(); assert.match(e.sheet(), /whole number from 1 to 99/, bad); }
  assert.equal(the(e, 'record_inventory_damage_v1').length, 0);
  await e.act('close'); await e.open('l1'); await e.begin('lin'); await e.input('I_f_qty', '0'); await e.submit();
  assert.match(e.sheet(), /whole number from 1 to 99/); assert.equal(the(e, 'record_linen_stains_v1').length, 0);
});

test('s132 photo first: the item picture shows on the row, in the Update sheet and in the form; the emoji only when there is none', async () => {
  const e = await make('owner'); await e.mount('');
  const row = (id) => new RegExp('data-act="open" data-id="' + id + '"[\\s\\S]*?</button>').exec(e.html())[0];
  assert.match(row('u1'), /<img data-uimg="1" src="https:\/\/stay\.example/); assert.doesNotMatch(row('u1'), /I_emo/);
  assert.match(row('c1'), /I_emo/); assert.doesNotMatch(row('c1'), /<img/);
  await e.open('u1'); await e.begin('update'); assert.match(e.sheet(), /<img data-uimg="1" src="https:\/\/stay\.example/);
  await e.begin('brk'); assert.match(e.sheet(), /<img data-uimg="1" src="https:\/\/stay\.example/);
  await e.act('close'); await e.open('c1'); await e.begin('update'); assert.doesNotMatch(e.sheet(), /<img/); assert.match(e.sheet(), /I_bigem/);
});

test('s132 photo first: a picture that fails to load falls back to the emoji on the row, in the sheet and in the form', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('u1'); await e.begin('update');
  const bad = { target: { getAttribute: (k) => ({ 'data-uimg': '1', src: URL1 })[k] || null } };
  for (const f of e.root.l.error || []) await f(bad);
  assert.doesNotMatch(e.html() + e.sheet(), /<img/);
  assert.match(e.sheet(), /I_bigem[^>]*>[^<]*<\/span>/); // the emoji sits where the picture was
  await e.begin('brk'); assert.doesNotMatch(e.sheet(), /<img/);
  assert.match(e.html(), /I_emo/);
});

test('s132 refusals are said in plain words: consumable, linen, quantity, not allowed', async () => {
  const say = async (reason, kind, id, rx) => {
    const e = await make('owner', { record_inventory_damage_v1: () => ({ data: { ok: false, reason }, error: null }), record_linen_stains_v1: () => ({ data: { ok: false, reason }, error: null }) });
    await e.mount(''); await e.open(id); await e.begin(kind); await e.submit();
    assert.match(e.sheet(), rx, reason); assert.doesNotMatch(e.sheet(), new RegExp(reason), reason + ' raw');
  };
  await say('consumable_item', 'brk', 'u1', /gets used up/);
  await say('linen_item', 'brk', 'a1', /Towels and sheets are reported as stained or damaged/);
  await say('qty_invalid', 'lin', 'l1', /whole number from 1 to 99/);
  await say('not_allowed', 'brk', 'u1', /not available to you/);
});

test('s132 Undo: broken, stained and a staff purchase each take their own call back', async () => {
  const b = await make('cleaner', { record_inventory_damage_v1: okd({ report_id: 'r9' }), undo_inventory_damage_v1: okd({}) }); await b.mount(''); await b.open('u1'); await b.begin('brk'); await b.submit();
  assert.match(b.undo(), /Marked 1 broken: Drinking glass/);
  await b.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(b.undo())[1] }); await b.submit();
  assert.deepEqual(the(b, 'undo_inventory_damage_v1')[0][2], { p_report_id: 'r9' });
  const l = await make('laundry', { record_linen_stains_v1: okd({}), undo_linen_stain_v1: okd({}) }); await l.mount(''); await l.open('l1'); await l.begin('lin'); await l.submit();
  await l.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(l.undo())[1] }); await l.submit();
  const key = the(l, 'record_linen_stains_v1')[0][2].p_idempotency_key;
  assert.deepEqual(the(l, 'undo_linen_stain_v1')[0][2], { p_idempotency_key: key });
  const s = await make('cleaner', { inventory_receipt_manual_v1: okd({ draft_id: 'd7' }), inventory_receipt_undo_v1: okd({}) }); await s.mount(''); await s.open('c1'); await s.begin('recv'); await s.submit();
  await s.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(s.undo())[1] }); await s.submit();
  assert.deepEqual(the(s, 'inventory_receipt_undo_v1')[0][2], { p_draft_id: 'd7' });
  // a report the server says is too late to undo is said calmly
  const t = await make('cleaner', { record_inventory_damage_v1: okd({ report_id: 'r5' }), undo_inventory_damage_v1: () => ({ data: { ok: false, reason: 'not_allowed' }, error: null }) });
  await t.mount(''); await t.open('u1'); await t.begin('brk'); await t.submit();
  await t.act('undo', { 'data-id': /data-id="(u\d+)"/.exec(t.undo())[1] }); await t.submit();
  assert.match(t.sheet(), /too late|can no longer be undone|already|moved on/i);
});

// ML-65: the fixture is the live producer's shape (inventory_item_history_v1, s132): {at, kind, before, after, qty, note, source, who}; usage and receipt rows have before = after = null and qty set.
const HROW = (o) => ({ at: '2026-10-12T03:00:00Z', kind: 'adjusted', before: null, after: null, qty: null, note: null, source: 'edit', who: 'Honey', ...o });
const histOf = async (changes, id = 'c1') => { const e = await make('owner', { inventory_item_history_v1: () => ({ data: { ok: true, usage: {}, changes }, error: null }) }); await e.mount(''); await e.open(id); await e.act('history-open'); return e; };
const lines = (h) => [...h.matchAll(/<li>[\s\S]*?<\/li>/g)].map((m) => m[0].replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'));
test('s132 history renders each source in the live shape: count, usage, receipt, damage, linen (stained, cleaned), edit', async () => {
  const e = await histOf([
    HROW({ kind: 'counted', before: 5, after: 6, source: 'count', note: 'Found extra' }),
    HROW({ kind: 'used', qty: 2, source: 'usage', note: 'For a guest stay' }),
    HROW({ kind: 'received', qty: 24, source: 'receipt' }),
    HROW({ kind: 'broken', before: 6, after: 4, qty: 2, source: 'damage', note: 'Guest broke it' }),
    HROW({ kind: 'missing', before: 4, after: 3, qty: 1, source: 'damage' }),
    HROW({ kind: 'stained', before: 14, after: 13, qty: 1, source: 'linen' }),
    HROW({ kind: 'cleaned', before: 13, after: 13, qty: 1, source: 'linen' }),
    HROW({ kind: 'adjusted', before: 5, after: 7, source: 'edit' })
  ]);
  const h = e.sheet(), L = lines(h);
  assert.equal(L.length, 8);
  assert.match(L[0], /Counted\|5 → 6 sachets/); assert.match(h, /<span class="I_hnote">Found extra<\/span>/);
  assert.match(L[1], /Used\|-2 sachets/); assert.match(h, /<span class="I_hnote">For a guest stay<\/span>/);
  assert.match(L[2], /Received\|\+24 sachets/);
  assert.match(L[3], /Broken\|-2 sachets \(6 → 4\)/); assert.match(h, /<span class="I_hnote">Guest broke it<\/span>/);
  assert.match(L[4], /Missing\|-1 sachet \(4 → 3\)/);
  assert.match(L[5], /Stained\|-1 sachet \(14 → 13\)/);
  assert.match(L[6], /Cleaned, back in use\|1 sachet/); assert.doesNotMatch(L[6], /→/);
  assert.match(L[7], /Adjusted\|5 → 7 sachets/);
  for (const l of L) assert.doesNotMatch(l, /→ \s*sachets|null|NaN|undefined/);
  const emo = [...h.matchAll(/class="I_hsrc"[^>]*>([^<]+)<\/em>/g)].map((m) => m[1]);
  assert.equal(emo.length, 8);
  assert.equal(new Set([emo[0], emo[1], emo[2], emo[3], emo[5], emo[7]]).size, 6, 'six sources, six emoji'); assert.equal(emo[3], emo[4]); assert.equal(emo[5], emo[6]);
});

test('s132 history: a usage row with no counts and no qty shows no arrow or empty numbers', async () => {
  const e = await histOf([HROW({ kind: 'used', source: 'usage' })]);
  const L = lines(e.sheet()); assert.equal(L.length, 1); assert.match(L[0], /Used/); assert.doesNotMatch(L[0], /→|null|NaN/);
});

test('s132 booking: the stay in the house goes to the damage call; without one the switch writes During a guest stay. into the note', async () => {
  const BID = '33333333-3333-4333-8333-333333333333';
  const run = async (extra, note) => {
    const e = await make('cleaner', { record_inventory_damage_v1: okd({ report_id: 'r1' }) }, extra); await e.mount(''); await e.open('u1'); await e.begin('brk');
    await e.act('upd-sw', { 'data-f': 'stay' }); if (note) await e.input('I_f_note', note); await e.submit();
    return the(e, 'record_inventory_damage_v1')[0][2];
  };
  let a = await run({ bookingId: BID }); assert.equal(a.p_booking_id, BID); assert.equal(a.p_note, null);
  a = await run({ bookingId: () => BID }); assert.equal(a.p_booking_id, BID, 'a function is read when the form is saved');
  a = await run({}); assert.equal(a.p_booking_id, null); assert.equal(a.p_note, 'During a guest stay.');
  a = await run({ bookingId: null }, 'Dropped'); assert.equal(a.p_booking_id, null); assert.equal(a.p_note, 'Dropped During a guest stay.');
  const e = await make('cleaner', { record_inventory_damage_v1: okd({ report_id: 'r1' }) }, { bookingId: BID }); await e.mount(''); await e.open('u1'); await e.begin('brk'); await e.submit();
  const b = the(e, 'record_inventory_damage_v1')[0][2]; assert.equal(b.p_booking_id, null); assert.equal(b.p_note, null);
});

test('s132 refusals: rows_invalid, source_invalid, stock_moved and item_not_found are said plainly, with reload and try again', async () => {
  const say = async (reason, rx) => {
    const e = await make('owner', { record_inventory_damage_v1: () => ({ data: { ok: false, reason }, error: null }) });
    await e.mount(''); await e.open('u1'); await e.begin('brk'); await e.submit();
    assert.match(e.sheet(), rx, reason); assert.match(e.sheet(), /Reload and try again/, reason); assert.doesNotMatch(e.sheet(), new RegExp(reason), reason + ' raw');
  };
  await say('rows_invalid', /could not be read/); await say('source_invalid', /could not be sent from here/);
  await say('stock_moved', /stock changed/); await say('item_not_found', /no longer on the list/);
});

test('s132 a refused save from the Update sheet toasts the plain refusal and keeps the form and the typed note', async () => {
  for (const [kind, id, fn, role] of [['used', 'c1', 'record_inventory_usage', 'laundry'], ['brk', 'u1', 'record_inventory_damage_v1', 'cleaner'], ['lin', 'l1', 'record_linen_stains_v1', 'laundry']]) {
    const e = await make(role, { [fn]: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) });
    await e.mount(''); await e.open(id); await e.begin('update'); await e.act('upd-pick', { 'data-kind': kind }); await e.input('I_f_note', 'typed words'); await e.submit();
    assert.ok(e.toasts.some((t) => /not available to you/.test(String(t))), kind + ' toast');
    assert.match(e.sheet(), /not available to you/, kind + ' line in the form'); assert.match(e.sheet(), /data-i-save/, kind + ' still on the form');
  }
});

test('s132 isLinen follows the server: lower(btrim(category)) like linen%', async () => {
  const e = await make('owner'); await e.mount('');
  const f = e.lib.isLinen;
  assert.equal(f({ category: 'Linen' }), true); assert.equal(f({ category: ' linen ' }), true); assert.equal(f({ category: 'LINENS' }), true); assert.equal(f({ category: 'Linen & towels' }), true);
  assert.equal(f({ category: 'Kitchen linen' }), false); assert.equal(f({ category: '' }), false); assert.equal(f({ category: null }), false); assert.equal(f(null), false);
});

test('s132 Mark bought on an approved shopping row is owner and admin only (button and click), proven on a sheet staff are put on', async () => {
  const SHOP = [{ id: 's9', item_id: 'c1', item_name: 'Coffee (3-in-1)', quantity: 1, purchase_unit: 'box', reason: null, status: 'approved', proposed_by: 'x', proposed_at: '2026-10-11T02:00:00Z' }];
  for (const role of ['owner', 'admin', 'cleaner', 'laundry']) {
    const e = await setup({ role, doc: {}, client: mockClient({ catalogue: raw(), shop: SHOP }) }); await e.mount('shopping');
    const can = role === 'owner' || role === 'admin';
    await e.act('shop-open', { 'data-id': 's9' }); // the row hand-click: staff are refused here
    assert.equal((e.lib.state().act || {}).shopId, can ? 's9' : undefined, role + ' shop-open');
    // put the approved row's sheet in front of every role (the state the guard on the button and the click protects), then look
    e.lib.state().act = { kind: 'menu', shopId: 's9' }; await e.act('retry');
    assert.match(e.sheet(), /Approved/, role + ' the approved sheet is open (state reached)'); assert.match(e.sheet(), /Remove from the list/, role + ' sheet drawn');
    assert.equal(/data-act="shop-bought"/.test(e.sheet()), can, role + ' button');
    await e.act('shop-bought');
    assert.equal(e.lib.state().act && e.lib.state().act.kind, can ? 'recv' : 'menu', role + ' click effect'); assert.equal(/I_hue_buy/.test(e.sheet()), can, role + ' form');
    assert.equal(the(e, 'inventory_receipt_manual_v1').length, 0, role);
  }
});

test('s132 a picture that fails to load does not redraw the open sheet while a field in it has focus', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('u1'); await e.begin('brk');
  e.win.document.activeElement = { tagName: 'INPUT', id: 'I_f_note' }; const sheet = { contains: (n) => n === e.win.document.activeElement };
  const before = e.sheet(); const orig = e.root.querySelector; e.root.querySelector = (sel) => (sel === '.sheet' ? sheet : orig && orig.call(e.root, sel));
  const bad = { target: { getAttribute: (k) => ({ 'data-uimg': '1', src: URL1 })[k] || null } };
  for (const f of e.root.l.error || []) await f(bad);
  assert.match(e.sheet(), /<img/, 'sheet not redrawn while typing: the picture is still in the markup'); assert.equal(e.sheet(), before);
});

test('s132 owner and admin see the cost of one pack under the total; staff do not', async () => {
  const o = await make('owner'); await o.mount(''); await o.open('c1'); await o.begin('recv'); await o.input('I_f_total', '180'); await o.act('step', { 'data-f': 'packs', 'data-d': '1', 'data-z': '0' }); // 2 packs for 180
  assert.match(o.sheet(), /data-i-perpack>₱90\.00 per box</);
  const s = await make('cleaner'); await s.mount(''); await s.open('c1'); await s.begin('recv'); await s.input('I_f_total', '180'); await s.act('step', { 'data-f': 'packs', 'data-d': '1', 'data-z': '0' });
  assert.match(s.sheet(), /value="180"/); assert.match(s.sheet(), /data-i-perpack>/, 'the same state is reached: 2 packs for 180 on the staff form'); // staff typed the same numbers the owner did
  assert.doesNotMatch(s.sheet(), /per box|per pack|₱90/);
});

test('s132 the create-item group sets the consumable default: supplies yes, utensils and appliances no, until the person changes it', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('scan'); await e.input('I_f_code', '555000778'); await e.submit(); await e.act('scan-new');
  const cons = () => { const m = /<select id="I_f_cons"[^>]*>([\s\S]*?)<\/select>/.exec(e.sheet()); return m ? (/<option value="(yes|no)" selected>/.exec(m[1]) || [])[1] : null; };
  await e.input('I_f_category', 'Kitchen supplies'); assert.equal(cons(), 'yes');
  await e.input('I_f_category', 'Kitchen utensils'); assert.equal(cons(), 'no');
  await e.input('I_f_category', 'Appliances'); assert.equal(cons(), 'no');
  await e.input('I_f_category', 'Kitchen supplies'); assert.equal(cons(), 'yes');
  await e.input('I_f_cons', 'no'); await e.input('I_f_category', 'Kitchen supplies'); // once the person has chosen, the group no longer overrides it
  assert.equal(cons(), 'no');
});

test('s132 the demo has a lasting utensil with a photo, an appliance, a supply and linen, and no network call', async () => {
  const trip = new Proxy({}, { get() { throw new Error('network touched in demo'); }, has() { throw new Error('network touched in demo'); } });
  const e = await setup({ role: 'owner', demo: true, client: trip }); await e.mount('');
  for (const name of ['Drinking glass', 'Rice cooker', 'Coffee \\(3-in-1\\)', 'Bath towels']) assert.match(e.html(), new RegExp(name));
  const row = (n) => new RegExp('data-act="open" data-id="' + n + '"[\\s\\S]*?</button>').exec(e.html())[0];
  assert.match(row('d13'), /<img data-uimg="1"/); assert.match(row('d14'), /I_emo/);
  await e.open('d13'); await e.begin('update'); assert.deepEqual(kindsIn(e.sheet()), ['brk', 'recv', 'count']);
  await e.begin('brk'); await e.submit(); assert.match(e.toasts[0], /Demo only/);
});

test('s132 groups: Kitchen supplies, Kitchen utensils and Appliances are chips with their own emoji and a level bar sits on every row', async () => {
  const e = await make('owner'); await e.mount('');
  assert.match(e.html(), /Kitchen supplies/); assert.match(e.html(), /Kitchen utensils/); assert.match(e.html(), /Appliances/);
  for (const id of ['c1', 'u1', 'a1', 'l1']) assert.match(new RegExp('data-act="open" data-id="' + id + '"[\\s\\S]*?</button>').exec(e.html())[0], /I_bar|I_lbar|class="lv/, id + ' bar');
});

test('s132 a receipt photo path goes to the server: p_receipt_path on the owner call and on the staff manual call', async () => {
  const RP = 'receipts/aaaa/bbbb.webp';
  for (const role of ['owner', 'cleaner']) {
    const e = await make(role); await e.mount('');
    const it = { id: 'c1', perPack: 30, name: 'Coffee (3-in-1)', purchaseUnit: 'box', unit: 'sachets' };
    const c = e.lib.boughtCall(it, { packs: '2', total: '240', supplier: '', supplierId: '' }, 'k-' + role + '-0123456789', '2026-10-15', RP);
    assert.equal(c.fn, role === 'owner' ? 'record_inventory_receipt_v1' : 'inventory_receipt_manual_v1', role);
    assert.equal(c.args.p_receipt_path, RP, role + ' path sent');
    assert.equal(e.lib.boughtCall(it, { packs: '2', total: '240', supplier: '', supplierId: '' }, 'k-x-0123456789', '2026-10-15', null).args.p_receipt_path, null, role + ' no photo is null');
  }
});

test('s132 inventory_receipt_manual_v1 refuses with {error:forbidden} or {error:bad_line}: said plainly, the form and typed values kept', async () => {
  for (const [error, rx] of [['forbidden', /not available to you/], ['bad_line', /could not be read/]]) {
    const e = await make('cleaner', { inventory_receipt_manual_v1: () => ({ data: { ok: false, error }, error: null }) });
    await e.mount(''); await e.open('c1'); await e.begin('update'); await e.act('upd-pick', { 'data-kind': 'recv' }); await e.input('I_f_packs', '2'); await e.input('I_f_note', 'typed words'); await e.submit();
    assert.match(e.sheet(), rx, error); assert.doesNotMatch(e.sheet(), new RegExp(error), error + ' raw'); assert.match(e.sheet(), /data-i-save/, error + ' still on the form'); assert.match(e.sheet(), /typed words/, error + ' values kept');
    if (error === 'forbidden') assert.ok(e.toasts.some((t) => /not available to you/.test(String(t))), 'forbidden toast');
  }
});
