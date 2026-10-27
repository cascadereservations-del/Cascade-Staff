// Pins the checklist supply log (s99g, D-351 amended): items start at 0, one save per report, only the extra is re-sent.
// Runs the real code: the block from "let _susItems" to "function initInventoryUsage" is evaluated with a thin stub page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = html.indexOf('let _susItems = [];');
const b = html.indexOf('function initInventoryUsage()');
const block = html.slice(a, b);

function world() {
  const posts = [], toasts = [], els = {}, created = [];
  const mk = () => ({ style: {}, dataset: {}, textContent: '', innerHTML: '', disabled: false,
    classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {},
    setAttribute() {}, querySelector: () => null });
  const ctx = {
    state: { supplyLogSaved: false, supplySaved: null, submissionId: null },
    el: (id) => (els[id] ||= mk()),
    document: { createElement: () => { const e = mk(); created.push(e); return e; } },
    esc: (x) => String(x), todayManila: () => '2026-10-27', uuid: () => 'sub-1',
    navigator: { onLine: true }, staffSession: { user: { id: 'u1' } }, PROPERTY_ID: 'p1',
    SUPABASE_URL: 'https://x', LIQUID_ML_PER_UNIT: 100, QUICK_ITEM_NAMES: [],
    staffHeaders: async () => ({}), updateBottomBar() {}, saveDraft() {}, closeSupplyUsageSheet() {},
    showToast: (m) => toasts.push(m),
    fetch: async (url, o) => { posts.push(JSON.parse(o.body)); return { ok: ctx.ok !== false, text: async () => 'bad' }; },
    ok: true,
  };
  const api = new Function(...Object.keys(ctx), block + '\nreturn { items: () => _susItems, set: (v) => { _susItems = v; }, ' +
    'changing: () => _susChanging, open: openSupplyUsageSheet, view: renderSupplySavedView, footer: susFooter, save: saveSupplyUsage, none: markSupplyLogNoneUsed, typical: susTypical, change: susStartChange };')(...Object.values(ctx));
  api.set([
    { id: 'lysol', name: 'Lysol', consumption_per_booking: 2, isLiquid: false, isQuick: true, usedQty: 0, usedMl: 0 },
    { id: 'bag', name: 'Garbage bag', consumption_per_booking: 2, isLiquid: false, isQuick: true, usedQty: 0, usedMl: 0 },
    { id: 'opt', name: 'Candle', consumption_per_booking: 2, isLiquid: false, isQuick: false, usedQty: 0, usedMl: 0 },
  ]);
  return { ctx, api, posts, toasts, els, created };
}

test('items start at 0 in the code, and Save with nothing chosen sends nothing', async () => {
  assert.doesNotMatch(block, /defaultCpb/);
  const w = world();
  await w.api.save();
  assert.equal(w.posts.length, 0);
  assert.equal(w.ctx.state.supplySaved, null);
});

test('Fill typical amounts sets each item to its consumption_per_booking', () => {
  const w = world();
  w.api.typical();
  assert.deepEqual(w.api.items().map((i) => i.usedQty), [2, 2, 0]); // hidden optional item stays 0
});

test('save sends the same row shape, then a second Save with no change sends nothing', async () => {
  const w = world();
  w.api.items()[0].usedQty = 3;
  await w.api.save();
  assert.deepEqual(w.posts, [[{ item_id: 'lysol', used_qty: 3, session_date: '2026-10-27', logged_by: 'cleaner', property_id: 'p1', submitted_by_user_id: 'u1' }]]);
  assert.deepEqual(w.ctx.state.supplySaved, { sid: 'sub-1', rows: { lysol: 3 } });
  await w.api.save();
  assert.equal(w.posts.length, 1);
});

test('a failed save marks nothing saved', async () => {
  const w = world();
  w.ctx.ok = false;
  w.api.items()[0].usedQty = 1;
  await w.api.save();
  assert.equal(w.ctx.state.supplySaved, null);
  assert.equal(w.ctx.state.supplyLogSaved, false);
});

test('Change then +1 sends a 1-row delta', async () => {
  const w = world();
  w.api.items()[0].usedQty = 3;
  await w.api.save();
  w.api.change();
  assert.equal(w.api.items()[0].usedQty, 3);
  w.api.items()[0].usedQty = 4;
  await w.api.save();
  assert.equal(w.posts.length, 2);
  assert.equal(w.posts[1].length, 1);
  assert.equal(w.posts[1][0].used_qty, 1);
  assert.equal(w.ctx.state.supplySaved.rows.lysol, 4);
});

test('lowering sends nothing and shows the calm line', async () => {
  const w = world();
  w.api.items()[0].usedQty = 3;
  await w.api.save();
  w.api.change();
  w.api.items()[0].usedQty = 1;
  await w.api.save();
  assert.equal(w.posts.length, 1);
  assert.match(w.els['sus-note'].textContent, /cannot be undone here\. Lloyd will correct it with a stock count\./);
  assert.equal(w.ctx.state.supplySaved.rows.lysol, 3);
  assert.doesNotMatch(block, /exclam|!'\)/);
});

test('Nothing used is remembered for the report and not re-sent', async () => {
  const w = world();
  w.api.none();
  assert.deepEqual(w.ctx.state.supplySaved, { sid: 'sub-1', rows: {} });
  await w.api.save();
  assert.equal(w.posts.length, 0);
});

test('draft keeps the saved state for the same report only, and reset clears it', () => {
  assert.match(html, /supplySaved:\s+state\.supplySaved,/);
  assert.match(html, /state\.supplySaved\s+= \(draft\.supplySaved && draft\.supplySaved\.sid === state\.submissionId\) \? draft\.supplySaved\s+: \(state\.supplyLogSaved \? \{ sid: state\.submissionId, rows: \{\}, legacy: true \} : null\);/);
  const reset = html.slice(html.indexOf('function resetApp()'), html.indexOf('clearDraft();', html.indexOf('function resetApp()')));
  assert.match(reset, /state\.supplySaved\s+= null;/);
  assert.match(reset, /_susChanging\s+= false;/);
});

test('legacy draft opens read-only: no Change, saved wording, 0 POSTs', async () => {
  const w = world();
  w.ctx.state.supplyLogSaved = true;
  w.ctx.state.supplySaved = { sid: 'sub-1', rows: {}, legacy: true };
  w.api.footer(true);
  assert.equal(w.els['sus-change-btn'].style.display, 'none');
  w.api.view(w.ctx.el('sus-list'));
  assert.equal(w.created[0].textContent, 'Usage for this report is already saved.');
  w.api.items()[0].usedQty = 5;
  await w.api.save();
  w.api.none();
  assert.equal(w.posts.length, 0);
});

test('Nothing used with a saved log leaves the totals alone and sends nothing', () => {
  const w = world();
  w.ctx.state.supplySaved = { sid: 'sub-1', rows: { lysol: 3 } };
  w.api.none();
  assert.deepEqual(w.ctx.state.supplySaved.rows, { lysol: 3 });
  assert.equal(w.posts.length, 0);
});

test('opening the sheet with a saved log hides Save/None before any fetch', () => {
  const w = world();
  w.ctx.state.supplySaved = { sid: 'sub-1', rows: { lysol: 3 } };
  w.els['sus-none-btn'] = { style: { display: '' } };
  w.api.open();
  assert.equal(w.els['sus-none-btn'].style.display, 'none');
});

test('saved rows carry an aria-label and Change moves focus to Save', () => {
  assert.match(block, /setAttribute\('aria-label', `\$\{it \? it\.name : 'Item'\}, \$\{rows\[id\]\} used`\)/);
  const w = world();
  let focused = false;
  w.els['sus-save-btn'] = { style: {}, focus: () => { focused = true; }, setAttribute() {} };
  w.ctx.state.supplySaved = { sid: 'sub-1', rows: { lysol: 3 } };
  w.api.change();
  assert.equal(focused, true);
});
