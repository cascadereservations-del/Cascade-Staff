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
const make = (role = 'cleaner', rpc = {}) => setup({ role, doc: {}, client: mockClient({ catalogue: raw(), rpc, fn: { 'upload-photo': sign } }) });
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

test('s132 history rows show the source emoji and the note', async () => {
  const hist = { ok: true, usage: {}, changes: [{ at: '2026-10-12T03:00:00Z', kind: 'damage', before: 6, after: 5, who: 'Honey', source: 'damage', note: 'Guest broke it' }, { at: '2026-10-11T03:00:00Z', kind: 'counted', before: 5, after: 6, who: 'Lloyd', source: 'count', note: 'Found extra' }] };
  const e = await make('owner', { inventory_item_history_v1: () => ({ data: hist, error: null }) }); await e.mount(''); await e.open('u1'); await e.act('history-open');
  assert.match(e.sheet(), /class="I_hsrc"[^>]*>[^<]+<\/em> Broken or missing/); assert.match(e.sheet(), /<span class="I_hnote">Guest broke it<\/span>/);
  assert.match(e.sheet(), /<span class="I_hnote">Found extra<\/span>/);
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
