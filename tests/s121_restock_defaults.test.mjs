// Session 121, lane R6 (D-382): the Restock screen with standard amounts, a stock limit, welcome treats and the dish upkeep questions.
// The real S120R block and the real send functions from checklist/index.html run here; the page's globals are stubbed. Every test below fails on the s120 sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holdSnippet } from './s120_page_snippets.mjs';

const NL = String.fromCharCode(10);
const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(NL);
const fnText = name => {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  return html.slice(s, html.indexOf('\n}\n', s) + 3);
};
const block = html.slice(html.indexOf('/* S120R:BEGIN'), html.indexOf('/* S120R:END */'));

const names = ['Coffee (3-in-1)', 'Bottled Water', 'Tea', 'Sugar & Creamer Sticks', 'Toiletries (toothbrush, toothpaste, soap)', 'Bathroom tissue', 'Kitchen towel',
  'Body Wash', 'Laundry Detergent', 'Dishwashing Liquid (Joy)'];
const ITEMS = names.map((name, n) => ({ id: 'id' + n, name, category: 'x', unit: 'pc' }));
const idOf = nm => ITEMS.find(i => i.name === nm).id;
const WATER = idOf('Bottled Water'), COFFEE = idOf('Coffee (3-in-1)'), TEA = idOf('Tea'), SUGAR = idOf('Sugar & Creamer Sticks'), TISSUE = idOf('Bathroom tissue');
const KIT = idOf('Toiletries (toothbrush, toothpaste, soap)'), DETERGENT = idOf('Laundry Detergent');

const P = new Function(block + `
return { S120R_classify, S120R_restockMissing, S120R_restockRows, S120R_newRestock, S120R_migrateRestock, S120R_reportLines, S120R_normCtx, S120R_setCtx, S120R_getCtx,
  S120R_topModel, S120R_kitModel, S120R_treatModel, S120R_materialize, S120R_upkeepRows, S120R_restockHtml, S120R_treatAllowed };`)();
const cls = () => P.S120R_classify(ITEMS);
const server = (o = {}) => ({
  ok: true,
  stock: ITEMS.map(i => ({ item_id: i.id, on_hand: o.stock && o.stock[i.id] != null ? o.stock[i.id] : 20 })),
  remembered: o.remembered || {}, upkeep_due: o.due || { dish_soap: false, dish_sponge: false }, next_tier: o.tier === undefined ? null : o.tier,
});
const setCtx = o => P.S120R_setCtx(o === null ? null : P.S120R_normCtx(server(o)));
const fresh = () => { const r = P.S120R_newRestock(); r.key = 'K1'; return r; };

/* ---------- 1. defaults ---------- */
test('R6 1: the sheet starts from the standard amounts, already answered; detergent leaves the top group', () => {
  setCtx(null);
  const c = cls();
  assert.deepEqual(c.top.map(i => i.name), ['Bottled Water', 'Coffee (3-in-1)', 'Tea', 'Sugar & Creamer Sticks', 'Bathroom tissue']);
  assert.ok(c.other.some(i => i.id === DETERGENT), 'Laundry Detergent is under Other items');
  const R = fresh();
  assert.deepEqual(P.S120R_topModel(R, c).map(m => [m.item.name, m.val]), [['Bottled Water', 1], ['Coffee (3-in-1)', 4], ['Tea', 0], ['Sugar & Creamer Sticks', 0], ['Bathroom tissue', 0]]);
  const k = P.S120R_kitModel(R, c);
  assert.deepEqual([k.a, k.val], ['yes', 2]);
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), [], 'filled rows count as answered');
  assert.deepEqual(P.S120R_restockRows(R, c, 'turnover'), [
    { item_id: WATER, used_qty: 1, usage_key: 's120-K1-' + WATER }, { item_id: COFFEE, used_qty: 4, usage_key: 's120-K1-' + COFFEE }, { item_id: KIT, used_qty: 2, usage_key: 's120-K1-' + KIT }]);
});

test('R6 1: with no context there are no stock numbers and no limit', () => {
  setCtx(null);
  const out = P.S120R_restockHtml(fresh(), cls(), 'turnover', false);
  assert.ok(!/in stock|left in inventory/.test(out), 'no stock number is shown');
  assert.ok(out.includes('These are the standard amounts. Change a number only if you used a different amount.'));
  assert.ok(out.includes('Standard amount.'));
  const m = P.S120R_topModel(fresh(), cls()).find(x => x.id === WATER);
  assert.equal(m.max, 99); assert.equal(m.stock, null);
});

/* ---------- 2. remembered amounts and one-report rows ---------- */
test('R6 2: water, coffee and the kit start from the remembered amount; a change is sent in p_remember; the one-report rows never are', () => {
  setCtx({ remembered: { [WATER]: 2, [COFFEE]: 6, [KIT]: 3 } });
  const c = cls(), R = fresh();
  assert.deepEqual(P.S120R_topModel(R, c).slice(0, 2).map(m => m.val), [2, 6]);
  assert.equal(P.S120R_kitModel(R, c).val, 3);
  assert.ok(P.S120R_restockHtml(R, c, 'turnover', false).includes('Changed. Standard is 1. This number stays for the next report.'), 'a remembered number differs from the standard and says so');
  R.top[WATER] = 5; R.top[TEA] = 2; R.top[SUGAR] = 10; R.top[TISSUE] = 1;
  P.S120R_materialize(R, c);
  assert.deepEqual(R.remember, { [WATER]: 5 }, 'only the changed remembered row, never tea, sugar or tissue');
  const out = P.S120R_restockHtml(R, c, 'turnover', false);
  assert.ok(out.includes('For this report only. It goes back to 0 next time.'));
});

test('R6 2: putting a remembered amount back to the standard is remembered too', () => {
  setCtx({ remembered: { [COFFEE]: 6 } });
  const c = cls(), R = fresh(); R.top[COFFEE] = 4;
  P.S120R_materialize(R, c);
  assert.deepEqual(R.remember, { [COFFEE]: 4 });
});

test('R6 2: unchanged rows send no remembered amount, and a stock-limited start is not a change', () => {
  setCtx({ stock: { [COFFEE]: 3 } });
  const c = cls(), R = fresh();
  P.S120R_materialize(R, c);
  assert.deepEqual(R.remember, {}, 'a start of 3 because only 3 are left is not something the cleaner changed');
  assert.equal(R.top[COFFEE], 3);
});

/* ---------- 3. stock limit and lock ---------- */
test('R6 3: each row shows its stock; plus stops at stock; zero locks the row; a short row starts at what is left', () => {
  setCtx({ stock: { [WATER]: 0, [COFFEE]: 3, [TEA]: 12 } });
  const c = cls(), R = fresh();
  const m = Object.fromEntries(P.S120R_topModel(R, c).map(x => [x.item.name, x]));
  assert.deepEqual([m['Bottled Water'].val, m['Bottled Water'].max, m['Bottled Water'].locked], [0, 0, true]);
  assert.deepEqual([m['Coffee (3-in-1)'].val, m['Coffee (3-in-1)'].max, m['Coffee (3-in-1)'].locked], [3, 3, false]);
  assert.equal(m.Tea.max, 12);
  const out = P.S120R_restockHtml(R, c, 'turnover', false);
  assert.ok(out.includes('None left in inventory. This item cannot be recorded.'));
  assert.ok(out.includes('Only 3 left in inventory. Standard is 4.'));
  assert.ok(out.includes('Optional. Add only if tea was put out. 12 in stock.'));
  assert.equal((out.match(/Remind admin/g) || []).length, 2, 'the locked and the short row only');
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), [], 'a locked or short row does not block Save');
  assert.ok(!P.S120R_restockRows(R, c, 'turnover').some(r => r.item_id === WATER), 'nothing is sent for a row at 0');
});

test('R6 3: a number above the known stock blocks Save and is not lowered silently', () => {
  setCtx({ stock: { [COFFEE]: 3 } });
  const c = cls(), R = fresh(); R.top[COFFEE] = 4;
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), ['Coffee (3-in-1), only 3 left']);
  assert.equal(R.top[COFFEE], 4);
  const m = P.S120R_topModel(R, c).find(x => x.id === COFFEE);
  assert.deepEqual([m.val, m.max, m.over], [4, 3, true]);
});

/* ---------- 4. main plus treat ---------- */
test('R6 4: a water or coffee treat shares the main row stock limit', () => {
  setCtx({ stock: { [COFFEE]: 5 }, tier: 'regular' });
  const c = cls(), R = fresh();
  R.treat = { k: 'coffee', n: 2 };
  const t = P.S120R_treatModel(R, c);
  assert.deepEqual([t.k, t.val, t.max], ['coffee', 2, 1], 'main 4 plus treat cannot exceed 5');
  const main = P.S120R_topModel(R, c).find(x => x.id === COFFEE);
  assert.equal(main.max, 3, 'and the main row stops one lower while the treat holds one');
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), ['Coffee (3-in-1), only 5 left'], 'main 4 plus treat 2 is 6 of 5');
  R.treat.n = 1;
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), []);
  const rows = P.S120R_restockRows(R, c, 'turnover');
  assert.deepEqual(rows.filter(r => r.item_id === COFFEE).map(r => [r.used_qty, r.usage_key]), [[4, 's120-K1-' + COFFEE], [1, 's120-K1-' + COFFEE + '-treat']]);
});

/* ---------- 5. treat per tier ---------- */
test('R6 5: the treat panel is for returning, regular and vip only; a first stay or unknown tier has none', () => {
  for (const [tier, want] of [['returning', true], ['regular', true], ['vip', true], [null, false], ['new', false], [undefined, false]]) {
    setCtx({ tier: tier === undefined ? null : tier });
    assert.equal(P.S120R_treatAllowed(), want, String(tier));
  }
  const panel = t => { setCtx({ tier: t }); return P.S120R_restockHtml(fresh(), cls(), 'turnover', false); };
  assert.ok(!panel(null).includes('Welcome treat'));
  assert.ok(/aria-expanded="false"[^>]*>[^<]*Anything extra/.test(panel(null)), 'collapsed for a first stay');
  const r = panel('returning');
  assert.ok(r.includes('Welcome treat · Returning') && r.includes('Shown because the next guest is a returning guest. Choose one. For this guest only. The usual numbers stay.'));
  assert.ok(panel('regular').includes('Shown because the next guest is a regular guest.'));
  assert.ok(panel('vip').includes('Welcome treat · VIP') && panel('vip').includes('Shown because the next guest is VIP.'));
  for (const w of ['Chocolates', 'Kit Kats', 'Bottled water', 'Extra coffee']) assert.ok(r.includes('>' + w + '<'), w);
  assert.ok(r.includes('#EEF8F5') || r.includes('s120-t-r'), 'the tier colour hook is on the panel');
});

test('R6 5: chocolates and Kit Kats go on the report, not to stock; water and coffee become usage rows; a treat never changes a remembered amount', () => {
  setCtx({ tier: 'vip' });
  const c = cls(), R = fresh(); R.saved = true;
  R.treat = { k: 'kitkat', n: 2 };
  assert.deepEqual(P.S120R_restockRows(R, c, 'turnover').filter(r => r.usage_key.endsWith('-treat')), []);
  assert.deepEqual(P.S120R_reportLines(null, R), [{ section: 'Restock', text: 'Welcome treat: Kit Kats x2' }]);
  R.treat = { k: 'choc', n: 1 };
  assert.deepEqual(P.S120R_reportLines(null, R), [{ section: 'Restock', text: 'Welcome treat: Chocolates' }]);
  R.treat = { k: 'water', n: 1 };
  assert.deepEqual(P.S120R_reportLines(null, R), [], 'a stock treat is recorded through usage, not as a line');
  assert.deepEqual(P.S120R_restockRows(R, c, 'turnover').filter(r => r.usage_key.endsWith('-treat')), [{ item_id: WATER, used_qty: 1, usage_key: 's120-K1-' + WATER + '-treat' }]);
  P.S120R_materialize(R, c);
  assert.deepEqual(R.remember, {}, 'water is at its standard 1; the treat never counts');
});

/* ---------- 7. dish soap and sponge ---------- */
test('R6 7: the two questions appear only when due, block Save until answered, and are sent with a key that carries the answer', () => {
  setCtx({ due: { dish_soap: true, dish_sponge: true } });
  const c = cls(), R = fresh();
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), ['Dish soap', 'Dish sponge']);
  const out = P.S120R_restockHtml(R, c, 'turnover', false);
  for (const s of ['Not changed in the last 3 reports', 'Dish soap: refilled today?', 'No refill recorded in the last 3 reports.', 'Dish sponge: replaced today?', 'No new sponge recorded in the last 3 reports.']) assert.ok(out.includes(s), s);
  R.upkeep.dish_soap = 'yes';
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), ['Dish sponge']);
  R.upkeep.dish_sponge = 'no';
  assert.deepEqual(P.S120R_restockMissing(R, c, 'turnover'), []);
  assert.deepEqual(P.S120R_upkeepRows(R), [
    { kind: 'dish_soap', changed: true, check_key: 's120-K1-dish_soap-yes' }, { kind: 'dish_sponge', changed: false, check_key: 's120-K1-dish_sponge-no' }]);
  R.upkeep.dish_sponge = 'yes';
  assert.equal(P.S120R_upkeepRows(R)[1].check_key, 's120-K1-dish_sponge-yes', 'a changed answer never reuses a key');
  setCtx({ due: { dish_soap: false, dish_sponge: false } });
  assert.ok(!P.S120R_restockHtml(fresh(), c, 'turnover', false).includes('Not changed in the last 3 reports'));
  assert.deepEqual(P.S120R_restockMissing(fresh(), c, 'turnover'), []);
});

/* ---------- old drafts ---------- */
test('R6: an old draft migrates, keeps its answers and never sends again what the old sheet sent', () => {
  const kept = P.S120R_migrateRestock({ restock: { top: { a: 2 }, kit: { a: 'yes', n: 1 }, saved: true, sent: true, key: 'k' } });
  assert.deepEqual([kept.top.a, kept.kit.n, kept.sent, kept.upkeep, kept.treat, kept.short, kept.reminded], [2, 1, true, { dish_soap: null, dish_sponge: null }, null, null, {}]);
  const withNew = P.S120R_migrateRestock({ restock: { saved: true, key: 'k', upkeep: { dish_soap: 'yes', dish_sponge: null }, treat: { k: 'choc', n: 1 }, short: [{ item_id: 'x', name: 'Tea', on_hand: 1, asked: 2 }], remember: { x: 3 }, reminded: { x: true } } });
  assert.deepEqual([withNew.upkeep.dish_soap, withNew.treat.k, withNew.short.length, withNew.remember.x, withNew.reminded.x], ['yes', 'choc', 1, 3, true], 'short_stock, the reminder and the answers survive a resume');
  setCtx(null);
  const R = P.S120R_migrateRestock({ restock: { top: { [DETERGENT]: 2 }, saved: true, key: 'k' } });
  assert.ok(P.S120R_restockRows(R, cls(), 'turnover').some(r => r.item_id === DETERGENT && r.used_qty === 2), 'a detergent count typed on the old sheet is not lost');
});

/* ---------- sending ---------- */
function sender(serverBody) {
  const calls = [];
  const cache = {};
  let mode = 'online', body = serverBody;
  const state = { cleaningType: 'turnover', linen: null, restock: null, supplyLogSaved: false, confirmItems: {}, confirmNotes: {}, issueFlags: {} };
  const log = { saves: 0, toasts: [], opened: 0 };
  const el = id => (id === 'cleaningDate' ? { value: '2026-11-20' } : id === 'cleanerName' ? { value: 'Kay' } : { classList: { add() {}, remove() {} } });
  const fetch = async (url, opt) => {
    calls.push({ url, body: opt.body ? JSON.parse(opt.body) : null });
    if (mode === 'offline') throw new TypeError('Failed to fetch');
    if (mode === 'refuse') return { ok: false, status: 403, text: async () => JSON.stringify({ message: 'staff access denied' }) };
    const b = typeof body === 'function' ? body(url, opt) : body;
    return { ok: true, status: 200, text: async () => JSON.stringify(b == null ? {} : b) };
  };
  let n = 0;
  const fns = ['S120R_rpc', 'S120R_sendLinen', 'S120R_sendRestock', 'S120R_shortStock', 'S120R_flushAll', 'S120R_flushOnce', 'S120R_commit', 'S120R_refreshStatus', 'S120R_fetchItems', 'S120R_loadItems', 'S120R_loadContext', 'S120R_remindAdmin', 'S120R_unsave', 'S120R_onRestockClick', 'S120R_saveRestock'];
  const h = new Function('state', 'el', 'fetch', 'staffHeaders', 'uuid', 'todayManila', 'saveDraft', 'SUPABASE_URL', 'PROPERTY_ID', 'log', 'cache',
    block + NL + holdSnippet(html) + NL + fns.map(fnText).join(NL) + NL
    + 'let _susItems = ' + JSON.stringify(ITEMS) + ', _susLoaded = false;\n'
    + 'const fetchWithRetry = (u, o) => fetch(u, o);\n'
    + 'const lsJSON = (k, v) => { if (v === undefined) return cache[k] || null; cache[k] = v; };\n'
    + 'const updateBottomBar = () => {}; const closeSupplyUsageSheet = () => {}; const showToast = m => { log.toasts.push(m); };\n'
    + 'function S120R_openRestock() { log.opened++; } function S120R_renderRestock() {}\n'
    + 'return { flush: S120R_flushAll, save: S120R_saveRestock, load: S120R_loadContext, remind: S120R_remindAdmin, click: S120R_onRestockClick, api: { S120R_setCtx, S120R_getCtx, S120R_normCtx, S120R_materialize, S120R_restockHtml, S120R_classify, S120R_migrateRestock, S120R_newRestock, S120R_restockMissing } };')(
    state, el, fetch, async () => ({}), () => 'uuid-' + (++n), () => '2026-11-20', () => { log.saves++; }, 'https://x.test', 'prop-1', log, cache);
  return { h, api: h.api, calls, state, log, cache, tc(o) { h.api.S120R_setCtx(o === null ? null : h.api.S120R_normCtx(server(o))); }, set mode(m) { mode = m; }, set body(b) { body = b; } };
}
const saved = (t, mut) => { t.tc({}); const R = t.state.restock = t.api.S120R_newRestock(); R.key = 'K1'; R.saved = true; t.state.supplyLogSaved = true; if (mut) mut(R); return R; };

test('R6 8: Save sends record_restock_v1 with the rows, the remembered amounts and the answers, in one call', async () => {
  const t = sender({ ok: true, rows: 3 });
  const R = saved(t, r => { r.top[WATER] = 3; r.upkeep = { dish_soap: 'yes', dish_sponge: 'no' }; });
  t.tc({ due: { dish_soap: true, dish_sponge: true } });
  t.api.S120R_materialize(R, t.api.S120R_classify(ITEMS));
  await t.h.flush(false);
  const calls = t.calls.filter(c => c.url.includes('/rpc/'));
  assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith('/rpc/record_restock_v1'));
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['p_logged_by', 'p_notes', 'p_property_id', 'p_remember', 'p_rows', 'p_session_date', 'p_upkeep']);
  assert.deepEqual(calls[0].body.p_remember, { [WATER]: 3 });
  assert.equal(calls[0].body.p_upkeep.length, 2);
  assert.ok(calls[0].body.p_rows.every(r => r.usage_key), 'every usage row carries a usage_key');
  assert.equal(R.sent, true);
});

test('R6 8: answers with no usage rows still send the dish questions, and a sheet with nothing at all sends nothing', async () => {
  const t = sender({ ok: true, rows: 0 });
  const R = saved(t, r => { r.top[WATER] = 0; r.top[COFFEE] = 0; r.kit = { a: 'no', n: null }; r.upkeep = { dish_soap: 'no', dish_sponge: 'no' }; });
  t.tc({ due: { dish_soap: true, dish_sponge: true } });
  await t.h.flush(false);
  assert.equal(t.calls.length, 1); assert.deepEqual(t.calls[0].body.p_rows, []); assert.equal(R.sent, true);
  const t2 = sender({ ok: true });
  const R2 = saved(t2, r => { r.top[WATER] = 0; r.top[COFFEE] = 0; r.kit = { a: 'no', n: null }; });
  await t2.h.flush(false);
  assert.equal(t2.calls.length, 0); assert.equal(R2.sent, false);
});

test('R6 8: short_stock records nothing, keeps every entry, names the items, reopens Restock and needs Save again', async () => {
  const t = sender({ ok: false, error: 'short_stock', short: [{ item_id: COFFEE, name: 'Coffee (3-in-1)', on_hand: 2, asked: 4 }] });
  const R = saved(t, r => { r.top[COFFEE] = 4; r.top[TEA] = 2; });
  t.tc({ stock: { [COFFEE]: 9 } });
  const r = await t.h.flush(false, true);
  assert.equal(R.sent, false); assert.equal(R.tried, false); assert.equal(R.saved, false); assert.equal(t.state.supplyLogSaved, false, 'Restock must be saved again');
  assert.deepEqual([R.top[COFFEE], R.top[TEA]], [4, 2], 'nothing is lowered silently');
  assert.equal(t.api.S120R_getCtx().stock[COFFEE], 2, 'the stock number is updated from the answer');
  assert.deepEqual(R.short.map(s => s.name), ['Coffee (3-in-1)']);
  assert.equal(t.log.opened, 1, 'the sheet is reopened');
  assert.ok(r.unanswered.join(' ').includes('Coffee (3-in-1)'), 'Submit stops and names the item');
  assert.ok(t.api.S120R_restockHtml(R, t.api.S120R_classify(ITEMS), 'turnover', false).includes('Nothing was recorded. Only 2 left in inventory for Coffee (3-in-1).'));
  const back = t.api.S120R_migrateRestock({ restock: JSON.parse(JSON.stringify(R)) });
  assert.deepEqual([back.saved, back.short.length, back.top[COFFEE]], [false, 1, 4], 'the state survives a draft resume');
  assert.deepEqual(t.api.S120R_restockMissing(R, t.api.S120R_classify(ITEMS), 'turnover'), ['Coffee (3-in-1), only 2 left'], 'and Save stays closed until the number is lowered');
});

test('R6 8: a refused answer (check_key_conflict) is reported and is not retried as a lost connection', async () => {
  const t = sender({ ok: false, error: 'check_key_conflict' });
  const R = saved(t);
  const r = await t.h.flush(false, true);
  assert.deepEqual(r.pending, []);
  assert.ok(R.failed && R.sent === false);
});

test('R6 8: a lost connection keeps the answers and sends once with the same key later', async () => {
  const t = sender({ ok: true, rows: 3 });
  const R = saved(t); t.mode = 'offline';
  let r = await t.h.flush(false);
  assert.deepEqual(r.pending, ['restock']);
  const key = R.key; t.mode = 'online';
  await t.h.flush(false);
  assert.equal(R.sent, true);
  assert.ok(t.calls.at(-1).body.p_rows.every(x => x.usage_key.startsWith('s120-' + key + '-')));
});

/* ---------- 5 (remind) ---------- */
test('R6 5: Remind admin calls restock_remind_admin_v1; success is kept in the draft, failure keeps the button', async () => {
  const t = sender({ ok: true });
  const R = saved(t);
  assert.equal(await t.h.remind(COFFEE), true);
  assert.ok(t.calls[0].url.endsWith('/rpc/restock_remind_admin_v1'));
  assert.deepEqual(t.calls[0].body, { p_property_id: 'prop-1', p_item_id: COFFEE });
  assert.equal(R.reminded[COFFEE], true);
  assert.ok(t.log.saves > 0, 'kept in the draft');
  const t2 = sender({ ok: true }); const R2 = saved(t2); t2.mode = 'offline';
  assert.equal(await t2.h.remind(COFFEE), false);
  assert.equal(R2.reminded[COFFEE], undefined);
  assert.ok(t2.log.toasts.some(m => m.includes('could not be sent')), 'it says it could not be sent');
  const t3 = sender(); const R3 = saved(t3); t3.mode = 'refuse';
  assert.equal(await t3.h.remind(COFFEE), false); assert.equal(R3.reminded[COFFEE], undefined);
  t.tc({ stock: { [COFFEE]: 0 } });
  R.reminded = { [COFFEE]: true };
  const out = t.api.S120R_restockHtml(R, t.api.S120R_classify(ITEMS), 'turnover', false);
  assert.ok(out.includes('Admin reminded') && !out.includes('>Remind admin<'));
});

/* ---------- 1 and 9: loading the context, online, offline with and without a cache ---------- */
test('R6 1: the context is read when the sheet opens and the last answer is kept; offline it falls back to that copy, and without one shows no numbers', async () => {
  const t = sender(() => server({ stock: { [WATER]: 7 }, remembered: { [COFFEE]: 5 }, tier: 'regular' }));
  await t.h.load();
  assert.ok(t.calls[0].url.endsWith('/rpc/restock_context_v1')); assert.deepEqual(t.calls[0].body, { p_property_id: 'prop-1' });
  assert.equal(t.api.S120R_getCtx().stock[WATER], 7); assert.equal(t.api.S120R_getCtx().tier, 'regular');
  assert.ok(Object.keys(t.cache).some(k => k.includes('restock')), 'the last answer is in local storage');
  const off = sender(); off.mode = 'offline'; Object.assign(off.cache, t.cache);
  await off.h.load();
  assert.equal(off.api.S120R_getCtx().stock[WATER], 7, 'the cached copy is used');
  const none = sender(); none.mode = 'offline';
  await none.h.load();
  assert.equal(none.api.S120R_getCtx(), null, 'no answer at all: no numbers, no limit');
  const refused = sender({ ok: false });
  await refused.h.load();
  assert.equal(refused.api.S120R_getCtx(), null, 'an answer without ok is not trusted');
});

/* ---------- the page: wording, wiring, header, shell ---------- */
test('R6 9 and 10: task 7.7 reads Check the dish sponge, the typical amounts are gone, the shell cache is bumped, the header look is the approved one', () => {
  assert.match(html, /id: 'check_7_7',\s+text: 'Check the dish sponge'/);
  assert.ok(!html.includes('susTypical'));
  assert.ok(!html.includes('record_inventory_usage\', {'), 'Save goes through record_restock_v1');
  assert.match(fnText('S120R_sendRestock'), /record_restock_v1/);
  const sw = readFileSync(new URL('../checklist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE_NAME = 'ch-shell-v15-utensils';/);
  const css = html.slice(0, html.lastIndexOf('</style>'));
  assert.match(css, /#top-bar \{[^}]*linear-gradient\(180deg, ?#3F2B1A 0%, ?#2C1D10 100%\)/);
  assert.match(css, /#property-name \{[^}]*color: #E3BC6E/);
  assert.match(css, /\.phase-header \.phase-tagline \{[^}]*color: rgba\(249, ?246, ?240, ?0?\.86\)/);
  const base = [['#513A26', '#32210F'], ['#583F22', '#362411'], ['#4C4424', '#2F2812'], ['#5C4226', '#392712'], ['#543D23', '#342310'], ['#4F3820', '#31200E'], ['#4A3520', '#2E1E0E']];
  base.forEach(([a, b], n) => assert.match(css, new RegExp(`#phase-${n} \\.phase-header[^{]*\\{[^}]*linear-gradient\\(150deg, ?${a} 0%, ?${b} 100%\\)`), 'phase ' + n));
  assert.ok(!/backdrop-filter/.test(css.slice(css.indexOf('#top-bar {'), css.indexOf('#top-bar {') + 600)), 'no blur on the bar');
});

test('R6 review B1: a chosen water treat can always be tapped off, and stays visible when the tier is gone, so a 0-stock reply never traps Save', () => {
  setCtx({ tier: 'vip', stock: { [idOf('Bottled Water')]: 5 } });
  const R = fresh(); R.treat = { k: 'water', n: 1 }; R.extraOpen = true;
  setCtx({ tier: 'vip', stock: { [idOf('Bottled Water')]: 0 } });
  const on = P.S120R_restockHtml(R, cls(), 'turnover', false);
  const tag = on.match(/<button[^>]*data-treat="water"[^>]*>/)[0];
  assert.ok(tag.includes('aria-pressed="true"') && !/disabled/.test(tag), 'the selected chip is not disabled: ' + tag);
  setCtx({ tier: null, stock: { [idOf('Bottled Water')]: 0 } });
  const noTier = P.S120R_restockHtml(R, cls(), 'turnover', false);
  assert.ok(noTier.includes('data-treat="water"') && noTier.includes('guest tier could not be read'), 'the treat panel is still drawn');
  R.treat = null;   // tapping it off clears the over-stock block
  assert.ok(!P.S120R_restockMissing(R, cls(), 'turnover').some(x => /water/i.test(x)), 'with the treat off, no stock block remains');
  setCtx(null);
});
