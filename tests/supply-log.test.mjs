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
  const posts = [], toasts = [], els = {};
  const mk = () => ({ style: {}, dataset: {}, textContent: '', innerHTML: '', disabled: false,
    classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {},
    setAttribute() {}, querySelector: () => null });
  const ctx = {
    state: { supplyLogSaved: false, supplySaved: null, submissionId: null },
    el: (id) => (els[id] ||= mk()),
    document: { createElement: mk },
    esc: (x) => String(x), todayManila: () => '2026-10-27', uuid: () => 'sub-1',
    navigator: { onLine: true }, staffSession: { user: { id: 'u1' } }, PROPERTY_ID: 'p1',
    SUPABASE_URL: 'https://x', LIQUID_ML_PER_UNIT: 100, QUICK_ITEM_NAMES: [],
    staffHeaders: async () => ({}), updateBottomBar() {}, saveDraft() {}, closeSupplyUsageSheet() {},
    showToast: (m) => toasts.push(m),
    fetch: async (url, o) => { posts.push(JSON.parse(o.body)); return { ok: ctx.ok !== false, text: async () => 'bad' }; },
    ok: true,
  };
  const api = new Function(...Object.keys(ctx), block + '\nreturn { items: () => _susItems, set: (v) => { _susItems = v; }, ' +
    'changing: () => _susChanging, save: saveSupplyUsage, none: markSupplyLogNoneUsed, typical: susTypical, change: susStartChange };')(...Object.values(ctx));
  api.set([
    { id: 'lysol', name: 'Lysol', consumption_per_booking: 2, isLiquid: false, isQuick: true, usedQty: 0, usedMl: 0 },
    { id: 'bag', name: 'Garbage bag', consumption_per_booking: 2, isLiquid: false, isQuick: true, usedQty: 0, usedMl: 0 },
  ]);
  return { ctx, api, posts, toasts, els };
}

test('items start at 0 in the code, and Save with nothing chosen sends nothing', async () => {
  assert.doesNotMatch(block, /Math\.max\(0, defaultCpb\)/);
  const w = world();
  await w.api.save();
  assert.equal(w.posts.length, 0);
  assert.equal(w.ctx.state.supplySaved, null);
});

test('Fill typical amounts sets each item to its consumption_per_booking', () => {
  const w = world();
  w.api.typical();
  assert.deepEqual(w.api.items().map((i) => i.usedQty), [2, 2]);
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
  assert.match(w.els['sus-note'].textContent, /cannot be undone from here.*count/);
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
  assert.match(html, /state\.supplySaved\s+= \(draft\.supplySaved && draft\.supplySaved\.sid === state\.submissionId\) \? draft\.supplySaved : null;/);
  const reset = html.slice(html.indexOf('function resetApp()'), html.indexOf('clearDraft();', html.indexOf('function resetApp()')));
  assert.match(reset, /state\.supplySaved\s+= null;/);
  assert.match(reset, /_susChanging\s+= false;/);
});
