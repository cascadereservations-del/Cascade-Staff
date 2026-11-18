// Session 120, lane R5: resuming a draft must not erase Restock or linen; the Submit cue names Restock at Lock up; two send paths are pinned.
// The real saveDraft, applyDraft, setCleaningType and S120R functions from checklist/index.html run here with the page's globals stubbed. Synthetic items only.
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

const ITEMS = [['Bottled Water'], ['Coffee (3-in-1)'], ['Tea'], ['Sugar & Creamer Sticks'], ['Bathroom tissue'], ['Laundry Detergent'], ['Toiletries (toothbrush, toothpaste, soap)'], ['Kitchen towel'], ['Demo Soap']]
  .map(([name], n) => ({ id: 'id' + n, name, category: 'x', unit: 'bottle' }));
const idOf = nm => ITEMS.find(i => i.name === nm).id;
const LINEN_ITEMS = [{ id: 'lin1', name: 'Bath Towel' }];

class Elm {
  constructor(id) { this.id = id; this.value = ''; this.checked = false; this.style = {}; this.dataset = {}; this.textContent = ''; this.childNodes = [{ textContent: '' }];
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  click() {} addEventListener() {} dispatchEvent() {} appendChild() {} setAttribute() {} querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; }
}

function world({ online = false } = {}) {
  const calls = [], els = {}, store = {};
  const fresh = () => ({ phase: 0, cleaningType: 'turnover', linen: null, restock: null, supplyLogSaved: false, confirmItems: {}, confirmNotes: {}, issueFlags: {}, checklist: {},
    meterPhotos: [], precleanPhotos: [], bedroomPhotos: [], kitchenPhotos: [], aftercleanPhotos: [], numberOfNights: 0, startTimestamp: null, conditionStatus: null, conditionNote: '',
    meterVerified: false, isWeeklyIncluded: false, sessionFolderId: null, sessionFolderUrl: null, submissionId: 'sub-1', meterSkipReason: '' });
  const w = { state: fresh(), nav: { onLine: online }, calls, store, saves: [] };
  const el = id => (id === 'cleaningDate' ? { value: '2026-11-18' } : id === 'cleanerName' ? { value: 'Kay' } : (els[id] = els[id] || new Elm(id)));
  const fetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null });
    if (!opt.method) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(url.includes('linen') ? LINEN_ITEMS : ITEMS)), text: async () => '' };
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const fns = ['S120R_rpc', 'S120R_sendLinen', 'S120R_sendRestock', 'S120R_flushAll', 'S120R_flushOnce', 'S120R_refreshStatus', 'S120R_fetchItems', 'S120R_loadItems', 'S120R_unsave', 'S120R_restore',
    'S120R_syncLinen', 'S120R_typeChanged', 'S120R_loadLinenItems', 'saveDraft', 'applyDraft', 'setCleaningType', 'loadDraft', 'flashAutosave'].map(fnText).join(NL)
    + NL + (/\n(async )?function resumeDraft\(/.test(html) ? fnText('resumeDraft') : 'function resumeDraft(d) { applyDraft(d); }');   // before the fix there is no wrapper: the page called applyDraft directly
  let n = 0;
  const api = new Function('w', 'el', 'fetch', 'staffHeaders', 'uuid', 'todayManila', 'SUPABASE_URL', 'PROPERTY_ID', 'navigator', 'document', 'esc', 'setTimeout', 'clearTimeout',
    'let state = w.state;\n'
    + block + NL + fns + NL
    + 'const DRAFT_KEY = "ch_draft_v6", DRAFT_VERSION = 5, PHASE_COUNT = 7;\n'
    + 'let _susItems = [], _susLoaded = false, _draftHold = false;\n'
    + 'const fetchWithRetry = (u, o) => fetch(u, o);\n'
    + 'const lsJSON = (k, v) => { if (v === undefined) return w.store[k] ? JSON.parse(w.store[k]) : null; w.store[k] = JSON.stringify(v); if (k === "ch_draft_v6") w.saves.push(JSON.parse(w.store[k])); };\n'
    + 'const K_migrateDraft = d => d, ARRIVE_ITEMS = [], CHEMICAL_ITEMS = [], BEDROOM_ITEMS = [], KITCHEN_ITEMS = [], FINAL_CLEANING_ITEMS = [], K_KILLER_ITEMS = [], K_PHASE_FROM_V1 = {};\n'
    + 'const K_syncFlag = () => {}, K_renderBedroom = () => {}, renderConfirmItems = () => {}, updateBottomBar = () => {}, updateProgress = () => {}, showToast = () => {}, closeSupplyUsageSheet = () => {};\n'
    + 'const collectExtraExpenses = () => [], photoMeta = p => p, addExtraExpenseRow = () => {}, updatePhotoCounter = () => {}, loadCleanableBookings = () => {};\n'
    + 'const METER_PHOTO_API = [], SECTION_PHOTO_API = {};\n'
    + 'const goToPhase = ph => { state.phase = ph; saveDraft(); };\n'
    + 'return { saveDraft, resumeDraft, loadDraft, flush: S120R_flushAll, load: S120R_loadItems, setState: s => { state = s; }, getState: () => state };')(
    w, el, fetch, async () => ({}), () => 'uuid-' + (++n), () => '2026-11-18', 'https://x.test', 'prop-1', w.nav, { querySelectorAll: () => [] }, s => String(s), f => 0, () => {});
  w.api = api;
  w.reload = () => { w.state = fresh(); api.setState(w.state); };   // the page is opened again: state is empty, only the stored draft remains
  w.post = name => calls.filter(c => c.method === 'POST' && c.url.endsWith('/rpc/' + name));
  return w;
}

const classify = () => new Function(block + '\nreturn S120R_classify;')()(ITEMS);

/* a cleaner who saved Restock (6 answers, kit No, not sent) and one linen row, offline, then reopened the app */
async function seed(w, phase) {
  w.nav.onLine = true; await w.api.load(); w.nav.onLine = false;
  const s = w.state, cls = classify();
  s.phase = phase;
  s.restock = new Function(block + '\nreturn S120R_newRestock();')();
  cls.top.forEach(i => { s.restock.top[i.id] = 0; }); s.restock.top[idOf('Tea')] = 2; s.restock.kit = { a: 'no', n: null };
  s.restock.saved = true; s.restock.key = 'rk-1'; s.supplyLogSaved = true;
  s.linen = new Function(block + '\nreturn S120R_newLinen();')();
  s.linen.answer = 'found'; s.linen.rows = [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }]; s.linen.key = 'lk-1';
  s.confirmItems.check_2_4 = 'confirmed'; s.confirmNotes.check_2_4 = 'Bath Towel: stain came out';
  w.api.saveDraft();
}

for (const phase of [0, 4]) {
  test(`R5 item 1: a draft resumed twice offline at phase ${phase} keeps Restock, linen and check_2_4, and Restock is sent once when online`, async () => {
    const w = world();
    await seed(w, phase);
    for (let round = 1; round <= 2; round++) {
      w.reload();
      await w.api.resumeDraft(w.api.loadDraft());   // R8: the resume ends when every restore has settled
      const s = w.api.getState();
      assert.equal(Object.values(s.restock.top).length, 6, `round ${round}: six Restock answers survive`);
      assert.equal(s.restock.top[idOf('Tea')], 2);
      assert.deepEqual([s.restock.saved, s.restock.sent, s.restock.legacy, s.supplyLogSaved], [true, false, false, true], `round ${round}: still saved, still unsent, never legacy`);
      assert.equal(s.linen.rows.length, 1, `round ${round}: the linen row survives`);
      assert.equal(s.confirmItems.check_2_4, 'confirmed', `round ${round}: check_2_4 survives`);
      const stored = w.api.loadDraft();
      assert.ok(stored.restock && stored.restock.saved && !stored.restock.sent, `round ${round}: the stored draft still holds the unsent Restock`);
      assert.equal(stored.linen.rows.length, 1, `round ${round}: and the linen row`);
      assert.equal(stored.phase, phase, `round ${round}: and the phase`);
    }
    assert.equal(w.post('record_inventory_usage').length, 0, 'offline: nothing was sent');
    w.nav.onLine = true;
    const r = await w.api.flush(false);
    assert.deepEqual(r.pending, []);
    assert.equal(w.post('record_inventory_usage').length, 1, 'online: Restock goes once');
    assert.equal(w.post('record_linen_stains_v1').length, 1, 'and linen goes once');
    assert.equal(w.api.getState().restock.sent, true);
    await w.api.flush(false);
    assert.equal(w.post('record_inventory_usage').length, 1, 'never twice');
  });
}

test('R5 item 1: no save during a resume writes a half-restored draft, whatever order the restore runs in', () => {
  const w = world();
  return seed(w, 0).then(async () => {
    w.reload();
    const before = w.saves.length;
    await w.api.resumeDraft(w.api.loadDraft());
    assert.equal(w.saves.length, before + 1, 'the resume writes once, at the end (R7), when every part is back');
    assert.equal(w.saves[w.saves.length - 1].restock.saved, true, 'and that one write holds the full restored draft');
    // and the hold is cleared again: a normal save works after the resume
    w.api.saveDraft();
    assert.equal(w.saves.length, before + 2);
    assert.equal(w.saves[w.saves.length - 1].restock.saved, true);
  });
});

test('R5 item 1: a draft that claims saved but lost its Restock is never silently treated as sent; a true legacy draft still is', () => {
  const mig = new Function(block + '\nreturn { S120R_migrateRestock, S120R_migrateLinen };')();
  const lost = mig.S120R_migrateRestock({ supplyLogSaved: true, restock: null, linen: { answer: null, rows: [] } });
  assert.deepEqual([lost.saved, lost.sent, lost.legacy], [false, false, false], 'written by this version, restock lost: ask again, never mark sent');
  const legacy = mig.S120R_migrateRestock({ supplyLogSaved: true });
  assert.deepEqual([legacy.saved, legacy.sent, legacy.legacy], [true, true, true], 'no restock key at all: the old sheet already sent it');
  const legacy2 = mig.S120R_migrateRestock({ supplySaved: { sid: 's1', rows: {} } });
  assert.deepEqual([legacy2.saved, legacy2.sent, legacy2.legacy], [true, true, true]);
});

test('R5 item 1: resuming a draft that lost its Restock leaves the gate closed and sends nothing', async () => {
  const w = world(); w.nav.onLine = true;
  await w.api.load();
  w.store.ch_draft_v6 = JSON.stringify({ _v: 5, _k: 2, _saved: 1, phase: 0, supplyLogSaved: true, restock: null, linen: null, cleaningType: 'turnover', checklist: {}, confirmItems: {}, confirmNotes: {} });
  w.api.resumeDraft(w.api.loadDraft());
  await w.api.flush(true);
  const s = w.api.getState();
  assert.deepEqual([s.supplyLogSaved, s.restock.saved, s.restock.sent, s.restock.legacy], [false, false, false, false]);
  assert.equal(w.post('record_inventory_usage').length, 0);
});

/* ---- item 2: the Submit cue ---- */
function cueWorld(ph) {
  const box = { hidden: false, textContent: '' };
  const state = { phase: ph, cleaningType: 'turnover', supplyLogSaved: false, aftercleanPhotos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], precleanPhotos: [], kitchenPhotos: [], meterPhotos: [] };
  const goes = [];
  const src = fnText('S94_unmet') + fnText('S94_renderCue') + fnText('S94_scrollToFirst')
    + '\nreturn { S94_unmet, S94_renderCue, S94_scrollToFirst };';
  const target = { tagName: 'DIV', scrollIntoView() { goes.push('scroll'); } };
  const api = new Function('state', 'el', 'K_gatedForPhase', 'K_answered', 'isPhaseValid', 'PHASE_COUNT', 'AFTERCLEAN_PHOTO_MIN', 'MIDSTAY_PHOTO_MIN', 'K_missingSlots', 'K_KITCHEN_PHOTO_MIN', 'kitchenPhotosRequired', 'goToPhase', 'window', 'matchMedia', 'setTimeout', src)(
    state, id => (id === 'nav-cue' ? box : id === 'supply-usage-trigger-card' ? target : null), () => [], () => true, () => false, 7, 3, 2, () => [], 0, () => false, ph2 => { goes.push('go' + ph2); state.phase = ph2; }, {}, () => ({ matches: true }), f => f());
  return { api, box, state, goes };
}

test('R5 item 2: at Lock up an unsaved Restock is named in the Submit cue and the cue takes the cleaner to it', () => {
  const c = cueWorld(6);
  assert.deepEqual(c.api.S94_unmet(6).map(x => x.t), ['restock (on the Bathroom & Kitchen step)']);
  c.api.S94_renderCue();
  assert.match(c.box.textContent, /^To submit: restock \(on the Bathroom & Kitchen step\)/);
  c.api.S94_scrollToFirst();
  assert.deepEqual(c.goes, ['go4', 'scroll'], 'Restock lives on the Bathroom & Kitchen step: go there, then scroll to the card');
  const ok = cueWorld(6); ok.state.supplyLogSaved = true;
  assert.deepEqual(ok.api.S94_unmet(6), []);
  const em = cueWorld(6); em.state.cleaningType = 'emergency';
  assert.deepEqual(em.api.S94_unmet(6), [], 'an emergency visit has no Restock');
  const p4 = cueWorld(4);
  assert.deepEqual(p4.api.S94_unmet(4).map(x => x.t), ['restock'], 'phase 4 is unchanged');
  p4.api.S94_renderCue(); p4.api.S94_scrollToFirst();
  assert.deepEqual(p4.goes, ['scroll'], 'already on that step: no jump');
});

/* ---- item 3: two send paths that nothing pinned ---- */
test('R5 item 3a: a refused Restock reaches submit-cleaning as "Restock was not recorded"', () => {
  const blockFns = new Function(block + '\nreturn { S120R_reportLines, S120R_newRestock };')();
  const R = blockFns.S120R_newRestock(); R.failed = 'unknown item';
  assert.deepEqual(blockFns.S120R_reportLines(null, R).map(l => l.text), ['Restock was not recorded (unknown item). The host will check the shelf.']);
  // the payload builder must push those lines into the notes the report carries
  const build = fnText('buildPayload');
  assert.match(build, /S120R_reportLines\(state\.linen, state\.restock\)\.forEach\(l => allNotes\.push\(\{ section: l\.section, text: l\.text/, 'buildPayload adds the Restock and linen lines to allNotes');
  assert.match(build, /^\s+allNotes,$/m, 'and allNotes is sent in the payload');
});

test('R5 item 3b: resuming online with a saved, unsent Restock sends it once and marks it sent', async () => {
  const w = world(); w.nav.onLine = true;
  await w.api.load();
  const R = new Function(block + '\nreturn S120R_newRestock();')();
  classify().top.forEach(i => { R.top[i.id] = 0; }); R.top[idOf('Tea')] = 1; R.kit = { a: 'no', n: null }; R.saved = true; R.key = 'rk-2';
  w.store.ch_draft_v6 = JSON.stringify({ _v: 5, _k: 2, _saved: 1, phase: 0, supplyLogSaved: true, restock: R, linen: null, cleaningType: 'turnover', checklist: {}, confirmItems: {}, confirmNotes: {} });
  w.api.resumeDraft(w.api.loadDraft());
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));   // let the send the resume itself started finish; no flush is called here
  assert.equal(w.post('record_inventory_usage').length, 1, 'exactly one call');
  assert.equal(w.api.getState().restock.sent, true);
});
