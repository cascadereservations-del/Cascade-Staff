// Session 120, lane R4: the Restock and linen port onto the checklist cleaners really use (Cascade-Staff/checklist).
// Pins what the s99g supply log guaranteed (one save per report, an old draft cannot be resent, Nothing used cannot wipe totals),
// upgrade safety for a draft written by the live version, and that no learned decimal reaches a screen or a payload.
// The real S120R block and send functions from checklist/index.html run here with the page's globals stubbed. Synthetic items only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const NL = String.fromCharCode(10);
const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(NL);
const fnText = name => {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  return html.slice(s, html.indexOf('\n}\n', s) + 3);
};
const block = html.slice(html.indexOf('/* S120R:BEGIN'), html.indexOf('/* S120R:END */'));

// synthetic consumables; the decimal is what usage learning will store in consumption_per_booking
const ITEMS = [['Bottled Water', 3.8462], ['Coffee (3-in-1)', 2.5], ['Tea', 1.3333], ['Sugar & Creamer Sticks', 4.75], ['Bathroom tissue', 2.2],
  ['Laundry Detergent', 0.4167], ['Toiletries (toothbrush, toothpaste, soap)', 1.9], ['Kitchen towel', 0.6], ['Demo Soap', 1.5]]
  .map(([name, c], n) => ({ id: 'id' + n, name, category: 'x', unit: 'bottle', consumption_per_booking: c }));
const idOf = nm => ITEMS.find(i => i.name === nm).id;
const FIELDS = 'id,name,category,unit';

const pure = new Function(block + NL + 'return { S120R_classify, S120R_restockRows, S120R_restockMissing, S120R_newRestock, S120R_migrateRestock };')();

function world({ online = true, fieldsServed = 'all' } = {}) {
  const calls = [];
  const state = { cleaningType: 'turnover', linen: null, restock: null, supplyLogSaved: false, confirmItems: {}, confirmNotes: {}, issueFlags: {} };
  const els = {}, cache = {}, log = { saves: 0, html: [] };
  const mk = id => ({ id, style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false }, textContent: '', disabled: false, set innerHTML(h) { log.html.push(h); }, closest: () => null, querySelector: () => null });
  const el = id => (id === 'cleaningDate' ? { value: '2026-11-18' } : id === 'cleanerName' ? { value: 'Kay' } : (els[id] = els[id] || mk(id)));
  const fetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null });
    if (!opt.method) {   // the item list: the server may send every column even when the page asks for four
      const rows = fieldsServed === 'all' ? ITEMS : ITEMS.map(({ id, name, category, unit }) => ({ id, name, category, unit }));
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(rows)), text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const nav = { onLine: online };
  let n = 0;
  const fns = ['S120R_rpc', 'S120R_sendLinen', 'S120R_sendRestock', 'S120R_flushAll', 'S120R_flushOnce', 'S120R_commit', 'S120R_refreshStatus', 'S120R_fetchItems', 'S120R_loadItems',
    'S120R_unsave', 'S120R_onRestockClick', 'S120R_saveRestock', 'S120R_renderRestock', 'S120R_stepperHtml', 'S120R_focusKey', 'S120R_focusBack', 'S120R_restore', 'S120R_syncLinen'].map(fnText).join(NL);
  const api = new Function('state', 'el', 'fetch', 'staffHeaders', 'uuid', 'todayManila', 'saveDraft', 'SUPABASE_URL', 'PROPERTY_ID', 'cache', 'navigator', 'log', 'document', 'esc',
    block + NL + fns + NL
    + 'let _susItems = [], _susLoaded = false;\n'
    + 'const fetchWithRetry = (u, o) => fetch(u, o);\n'
    + 'const lsJSON = (k, v) => { if (v === undefined) return cache[k] || null; cache[k] = v; };\n'
    + 'const K_syncFlag = () => {}; const updateBottomBar = () => {}; const closeSupplyUsageSheet = () => {}; const showToast = () => {}; const renderConfirmItems = () => {};\n'
    + 'return { flush: S120R_flushAll, save: S120R_saveRestock, click: S120R_onRestockClick, restore: S120R_restore, load: S120R_loadItems, render: S120R_renderRestock, items: () => _susItems };')(
    state, el, fetch, async () => ({}), () => 'uuid-' + (++n), () => '2026-11-18', () => { log.saves++; }, 'https://x.test', 'prop-1', cache, nav, log,
    { activeElement: null }, s => String(s));
  const sent = () => calls.filter(c => c.method === 'POST');
  return { api, state, calls, sent, els, log, cache, nav };
}
const btn = data => ({ target: { closest: () => ({ dataset: data, disabled: false, id: '' }) } });

/* ---- rule 3: what the s99g supply log guaranteed, in the Restock flow ---- */

test('rule 3: one save per report; a second Save, a second flush and a "Nothing used" after it send nothing and change nothing', async () => {
  const w = world();
  w.state.cleaningType = 'mid_stay';
  await w.api.load();
  const R = w.state.restock = pure.S120R_newRestock();
  pure.S120R_classify(w.api.items()).top.forEach(i => { R.top[i.id] = 0; }); R.top[idOf('Tea')] = 2; R.kit = { a: 'no', n: null };
  await w.api.save(false);
  assert.equal(w.sent().length, 1, 'the first Save sends once');
  assert.deepEqual(w.sent()[0].body.p_rows.map(r => [r.item_id, r.used_qty]), [[idOf('Tea'), 2]]);
  assert.equal(R.sent, true);
  await w.api.save(false);
  await w.api.save(true);                       // Nothing used, mid-stay, after totals were saved
  await w.api.flush(false, true);
  assert.equal(w.sent().length, 1, 'no second write for this report');
  assert.deepEqual([R.none, R.top[idOf('Tea')], R.sent, w.state.supplyLogSaved], [false, 2, true, true], 'totals and the saved flag are untouched');
  await w.api.click(btn({ d: '1' }));
  assert.equal(R.top[idOf('Tea')], 2, 'a sent sheet takes no more taps');
});

test('rule 3: a draft written before the Restock sheet is never sent again and a tap cannot wipe or rewrite it', async () => {
  for (const old of [{ supplyLogSaved: true, supplySaved: { sid: 's1', rows: { id0: 3 } } }, { supplyLogSaved: true }, { supplySaved: { sid: 's1', rows: {} } }]) {
    const w = world();
    w.state.cleaningType = 'mid_stay';
    await w.api.load();
    w.api.restore(old);
    const R = w.state.restock;
    assert.deepEqual([R.legacy, R.saved, R.sent, R.none], [true, true, true, false], 'its own state: saved earlier, sent, not "nothing used"');
    assert.equal(w.state.supplyLogSaved, true, 'the gate stays open');
    await w.api.flush(false, true);
    await w.api.save(false);
    await w.api.save(true);
    await w.api.click(btn({ d: '1' }));
    assert.equal(w.sent().length, 0, 'no write of any kind for ' + JSON.stringify(old));
    assert.equal(w.calls.filter(c => /inventory_usage/.test(c.url) && c.method === 'POST').length, 0, 'not through the old table either');
    assert.deepEqual([R.legacy, R.saved, R.sent, R.none, w.state.supplyLogSaved], [true, true, true, false, true], 'and nothing was wiped');
  }
});

/* ---- rule 4: upgrade safety ---- */

test('rule 4: a draft that already wrote supply rows through the old path writes none through the new one, online or offline, on resume and at Submit', async () => {
  const oldDraft = { submissionId: 'sub-9', supplyLogSaved: true, supplySaved: { sid: 'sub-9', rows: { id0: 2, id1: 1 } }, cleaningType: 'turnover', confirmItems: {}, confirmNotes: {} };
  for (const online of [true, false]) {
    const w = world({ online });
    w.state.cleaningType = 'turnover';
    w.api.restore(oldDraft);                                  // what applyDraft calls
    await w.api.flush(true);                                  // the online event
    await w.api.flush(false, true);                           // Submit
    assert.equal(w.sent().length, 0, 'no POST at all (online ' + online + ')');
    assert.equal(w.state.restock.legacy, true);
    assert.deepEqual(pure.S120R_restockRows(w.state.restock, pure.S120R_classify(ITEMS), 'turnover'), [], 'and no rows could be built from it');
  }
  assert.doesNotMatch(html, /state\.supplySaved|supplySaved:/, 'no page code still reads or writes the old key');
  const apply = fnText('applyDraft');
  assert.match(apply, /S120R_restore\(draft\)/, 'the draft is restored through the migration');
  assert.match(fnText('S120R_migrateRestock'), /d\.supplyLogSaved \|\| d\.supplySaved/, 'either old key marks it saved and sent');
});

/* ---- rule 5: no learned decimal on a screen or in a payload ---- */

test('rule 5: consumption_per_booking never reaches the list, a screen, the cache or a payload', async () => {
  const w = world({ fieldsServed: 'all' });                    // a server that sends every column, decimals included
  await w.api.load();
  const get = w.calls.find(c => c.method === 'GET');
  assert.ok(get.url.includes('select=' + FIELDS + '&'), 'the request names only four columns');
  assert.ok(w.api.items().every(i => Object.keys(i).sort().join() === 'category,id,name,unit'), 'and nothing else is kept even if more arrives');
  assert.ok(!JSON.stringify(w.cache).includes('consumption') && !JSON.stringify(w.cache).includes('3.8462'), 'the phone cache holds no decimal');
  const R = w.state.restock = pure.S120R_newRestock(); R.otherOpen = true;
  w.api.render();
  const screen = w.log.html.join('\n');
  assert.ok(screen.includes('Bottled Water') && screen.includes('Demo Soap'), 'the sheet drew its rows');
  assert.doesNotMatch(screen, /\d+\.\d+/, 'no decimal number anywhere on the Restock sheet');
  pure.S120R_classify(w.api.items()).top.forEach(i => { R.top[i.id] = 1; }); R.kit = { a: 'yes', n: 2 }; R.other[idOf('Demo Soap')] = 1;
  R.saved = true; w.state.supplyLogSaved = true;
  await w.api.flush(true);
  const body = JSON.stringify(w.sent().map(c => c.body));
  assert.ok(w.sent().length === 1 && !/consumption|\d\.\d/.test(body), 'the payload has whole numbers only');
});

test('rule 5: a fractional amount in a draft cannot be sent either, and no page code reads consumption_per_booking', () => {
  const cls = pure.S120R_classify(ITEMS), rs = pure.S120R_newRestock(); rs.key = 'K';
  rs.top[idOf('Tea')] = 3.8462; rs.top[idOf('Coffee (3-in-1)')] = 2; rs.other[idOf('Demo Soap')] = 0.5;
  assert.deepEqual(pure.S120R_restockRows(rs, cls, 'turnover').map(r => [r.item_id, r.used_qty]), [[idOf('Coffee (3-in-1)'), 2]]);
  assert.ok(!/consumption_per_booking|per_booking/.test(html), 'nothing in checklist/index.html reads it');
});
