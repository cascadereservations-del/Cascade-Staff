// Session 120, lane R7: the stored draft has one owner while the Resume question is open; a Start fresh never doubles a stock deduction;
// a lasting server error cannot trap the report; the Submit cue reaches its card; two copy fixes.
// The real page functions run here with the page's globals stubbed; the Resume and Start fresh buttons are driven through their registered handlers. Synthetic items only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holdSnippet, resumeSnippet } from './s120_page_snippets.mjs';

const NL = String.fromCharCode(10);
const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(NL);
const hasFn = name => new RegExp(`\\n(async )?function ${name}\\(`).test(html);
const fnText = name => {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  return html.slice(s, html.indexOf('\n}\n', s) + 3);
};
const block = html.slice(html.indexOf('/* S120R:BEGIN'), html.indexOf('/* S120R:END */'));
const guardLine = html.slice(html.indexOf('/* S120R14:BEGIN'), html.indexOf('/* S120R14:END */')) + NL + (/let _preSubmitRunning = false;/.exec(html) || [''])[0];   // s120 R14: the photo record and its helpers sit just before the guard
const initSrc = html.slice(html.indexOf('async function init() {'));
const bootLine = (/\n\s*(_draftHold\s*=\s*!!loadDraft\(\);)/.exec(initSrc.slice(0, initSrc.indexOf('await '))) || [])[1] || '';

const ITEMS = [['Bottled Water'], ['Coffee (3-in-1)'], ['Tea'], ['Sugar & Creamer Sticks'], ['Bathroom tissue'], ['Laundry Detergent'], ['Toiletries (toothbrush, toothpaste, soap)'], ['Kitchen towel'], ['Demo Soap']]
  .map(([name], n) => ({ id: 'id' + n, name, category: 'x', unit: 'bottle' }));
const idOf = nm => ITEMS.find(i => i.name === nm).id;
const LINEN_ITEMS = [{ id: 'lin1', name: 'Bath Towel' }];
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

class Elm {
  constructor(id) { this.id = id; this.value = ''; this.checked = false; this.style = {}; this.dataset = {}; this.textContent = ''; this.className = ''; this.disabled = false; this.childNodes = [{ textContent: '' }];
    const set = new Set(); this.classList = { add: c => set.add(c), remove: (...c) => c.forEach(x => set.delete(x)), toggle() {}, contains: c => set.has(c) }; this.handlers = []; }
  click() {} dispatchEvent() {} appendChild() {} setAttribute() {} querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; }
  addEventListener(type, fn, opt) { this.handlers.push({ type, fn, once: !!(opt && opt.once) }); }
}

function world({ online = true } = {}) {
  const w = { nav: { onLine: online }, calls: [], store: {}, saves: [], timers: [], toasts: [], proceeded: 0, date: '2026-11-18', today: '2026-11-18', postStatus: 200, netDown: false, els: {}, intervals: [] };
  const fresh = () => ({ phase: 0, cleaningType: 'turnover', linen: null, restock: null, supplyLogSaved: false, confirmItems: {}, confirmNotes: {}, issueFlags: {}, checklist: {},
    meterPhotos: [], precleanPhotos: [], bedroomPhotos: [], kitchenPhotos: [], aftercleanPhotos: [], numberOfNights: 0, startTimestamp: null, conditionStatus: null, conditionNote: '',
    meterVerified: false, isWeeklyIncluded: false, sessionFolderId: null, sessionFolderUrl: null, submissionId: 'sub-1', meterSkipReason: '', isSubmitting: false, pendingPreSubmit: false });
  w.state = fresh();
  const el = id => (id === 'cleaningDate' ? { value: w.date } : id === 'cleanerName' ? { value: 'Kay' } : (w.els[id] = w.els[id] || new Elm(id)));
  const fetch = async (url, opt = {}) => {
    const post = !!opt.method;
    if (post) {
      if (w.netDown) throw new Error('fetch failed');
      w.calls.push({ url, method: 'POST', body: JSON.parse(opt.body) });
      return w.postStatus === 200 ? { ok: true, status: 200, text: async () => '{}' } : { ok: false, status: w.postStatus, text: async () => '{}' };
    }
    w.calls.push({ url, method: 'GET', body: null });
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(url.includes('linen') ? LINEN_ITEMS : ITEMS)), text: async () => '' };
  };
  const names = ['S120R_rpc', 'S120R_sendLinen', 'S120R_sendRestock', 'S120R_flushAll', 'S120R_flushOnce', 'S120R_refreshStatus', 'S120R_fetchItems', 'S120R_loadItems', 'S120R_unsave', 'S120R_restore',
    'S120R_syncLinen', 'S120R_typeChanged', 'S120R_loadLinenItems', 'S120R_resumePreSubmit', 'saveDraft', 'applyDraft', 'setCleaningType', 'loadDraft', 'flashAutosave', 'clearDraft',
    'checkAndShowDraftModal', 'runPreSubmitFlush', 'initSubmitModal', 'startAutoSave'].filter(hasFn);
  const fns = names.map(fnText).join(NL) + NL + holdSnippet(html) + NL + resumeSnippet(html) + NL + 'const S120R_RESUME_FAIL = "x"; const console = { error() {} };';
  const api = new Function('w', 'el', 'fetch', 'staffHeaders', 'uuid', 'todayManila', 'SUPABASE_URL', 'PROPERTY_ID', 'navigator', 'document', 'esc', 'setTimeout', 'clearTimeout', 'setInterval', 'localStorage',
    'let state = w.state;\n'
    + block + NL + fns + NL + guardLine + NL
    + 'const DRAFT_KEY = "ch_draft_v6", DWELL_KEY = "ch_dwell", DRAFT_VERSION = 5, PHASE_COUNT = 7, SUBMITTED_IDS_KEY = "ids";\n'
    + 'let _susItems = [], _susLoaded = false, _draftRestoring = false;\n'
    + 'const fetchWithRetry = (u, o) => fetch(u, o);\n'
    + 'const PHASE_KEY = "ch_phase", K_reportProgress = () => {};\n'
    + 'const ls = (k, v) => { if (v === null) delete w.store[k]; else w.store[k] = v; }, idbDeletePhoto = () => {}, startElapsedTimer = () => {};\n'
    + 'const lsJSON = (k, v) => { if (v === undefined) return w.store[k] ? JSON.parse(w.store[k]) : null; w.store[k] = JSON.stringify(v); if (k === "ch_draft_v6") w.saves.push(w.store[k]); };\n'
    + 'const K_migrateDraft = d => d, ARRIVE_ITEMS = [], CHEMICAL_ITEMS = [], BEDROOM_ITEMS = [], KITCHEN_ITEMS = [], FINAL_CLEANING_ITEMS = [], K_KILLER_ITEMS = [], K_PHASE_FROM_V1 = {};\n'
    + 'let _throwIn = false;\n'
    + 'const K_syncFlag = () => {}, K_renderBedroom = () => {}, renderConfirmItems = () => { if (_throwIn) throw new Error("render failed"); }, updateBottomBar = () => {}, updateProgress = () => {}, showToast = (m) => w.toasts.push(m), closeSupplyUsageSheet = () => {};\n'
    + 'const collectExtraExpenses = () => [], photoMeta = p => p, addExtraExpenseRow = () => {}, updatePhotoCounter = () => {}, loadCleanableBookings = () => {}, S94_renderCue = () => {}, isPhaseValid = () => true;\n'
    + 'const METER_PHOTO_API = [], SECTION_PHOTO_API = {};\n'
    + 'const proceedWithSubmission = () => { w.proceeded++; };\n'
    + 'const goToPhase = ph => { state.phase = ph; saveDraft(); };\n'
    + 'function boot() { ' + bootLine + ' }\n'
    + 'return { saveDraft, resumeDraft, loadDraft, flush: S120R_flushAll, load: S120R_loadItems, setState: s => { state = s; }, getState: () => state, setCleaningType,\n'
    + '  checkAndShowDraftModal: typeof checkAndShowDraftModal === "function" ? checkAndShowDraftModal : () => {}, initSubmitModal: typeof initSubmitModal === "function" ? initSubmitModal : () => {},\n'
    + '  startAutoSave: typeof startAutoSave === "function" ? startAutoSave : () => {}, resumePre: S120R_resumePreSubmit, refreshStatus: S120R_refreshStatus, boot, hold: () => _draftHold,\n'
    + '  throwIn: v => { _throwIn = v; }, resetPage: () => { _draftHold = false; _draftRestoring = false; _susItems = []; } };')(
    w, el, fetch, async () => ({}), (() => { let n = 0; return () => 'uuid-' + (++n); })(), () => w.today, 'https://x.test', 'prop-1', w.nav, { querySelectorAll: () => [] }, s => String(s),
    f => { w.timers.push(f); return 0; }, () => {}, f => { w.intervals.push(f); return 0; }, { getItem: () => null });
  w.api = api;
  // a page opened again: the state is empty, the elements are new, only the stored draft remains
  w.reload = (o = {}) => { w.state = fresh(); api.setState(w.state); w.els = {}; w.intervals = []; api.resetPage(); if (o.boot !== false) api.boot(); };
  w.click = id => { const e = w.els[id]; for (const h of [...e.handlers].filter(x => x.type === 'click')) { if (h.once) e.handlers.splice(e.handlers.indexOf(h), 1); h.fn(); } };
  w.post = name => w.calls.filter(c => c.method === 'POST' && c.url.endsWith('/rpc/' + name));
  w.runTimers = () => { const t = w.timers.splice(0); t.forEach(f => f()); };
  return w;
}

const mk = (fn) => new Function(block + '\nreturn ' + fn + '();')();
const classify = () => new Function(block + '\nreturn S120R_classify;')()(ITEMS);

/* a draft with Restock (6 answers, kit No), one linen row and check_2_4; `rs` and `ln` choose how far each was sent */
async function seed(w, { phase = 4, rs = 'saved', ln = 'saved', date } = {}) {
  if (date) w.date = date;
  await w.api.load();
  const s = w.state, cls = classify();
  s.phase = phase;
  if (rs) {
    s.restock = mk('S120R_newRestock');
    cls.top.forEach(i => { s.restock.top[i.id] = 0; }); s.restock.top[idOf('Tea')] = 2; s.restock.kit = { a: 'no', n: null };
    s.restock.saved = true; s.restock.key = 'rk-1'; s.supplyLogSaved = true;
    if (rs !== 'saved') s.restock.sendStartedAt = Date.now();
    if (rs === 'sent') { s.restock.tried = true; s.restock.sent = true; }
    if (rs === 'tried') s.restock.tried = true;
    if (rs === 'waiting') { s.restock.tried = true; s.restock.waiting = true; }
  }
  if (ln) {
    s.linen = mk('S120R_newLinen');
    s.linen.answer = 'found'; s.linen.rows = [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }]; s.linen.key = 'lk-1';
    if (ln && ln !== 'saved') s.linen.sendStartedAt = Date.now();
    if (ln === 'sent') { s.linen.tried = true; s.linen.sent = true; }
    if (ln === 'tried') s.linen.tried = true;
    if (ln === 'waiting') { s.linen.tried = true; s.linen.waiting = true; }
    s.confirmItems.check_2_4 = 'confirmed'; s.confirmNotes.check_2_4 = 'Bath Towel: stain came out';
  }
  w.api.saveDraft();
  return w.store.ch_draft_v6;
}

/* ---- the rule: while the Resume question is open the stored draft is read-only ---- */
test('R7 item 1-3: boot sets the hold before anything can save; a stay pick, a type tap and the 60-second autosave leave the stored draft byte-identical; Resume restores everything', async () => {
  assert.ok(bootLine, 'init() sets _draftHold from the stored draft before its first await');
  const w = world();
  const before = await seed(w, { phase: 4, rs: 'saved', ln: 'saved' });
  w.reload();                                   // the app opened again: empty state, hold set by init
  assert.equal(w.api.hold(), true, 'the hold is set at boot, before the modal is built');
  w.api.checkAndShowDraftModal();
  assert.ok(w.els['draft-modal'].classList.contains('open'), 'the Resume question is open');
  w.api.startAutoSave();
  w.api.setCleaningType('turnover');            // what a stay pick does: it saves
  w.api.saveDraft();
  w.intervals.forEach(f => f());                // the 60-second autosave
  assert.equal(w.store.ch_draft_v6, before, 'the stored draft is byte-identical');
  w.reload(); w.api.checkAndShowDraftModal();
  w.click('btn-draft-resume');   // the restored values are read at once, before the online flush of the unsent Restock runs
  const s = w.api.getState();
  assert.equal(s.phase, 4);
  assert.equal(s.restock.top[idOf('Tea')], 2); assert.deepEqual([s.restock.saved, s.restock.sent, s.supplyLogSaved], [true, false, true]);
  assert.equal(s.linen.rows.length, 1); assert.equal(s.linen.tried, false);
  assert.equal(s.confirmItems.check_2_4, 'confirmed');
  await settle();   // R8: the hold ends when the restores have settled
  assert.equal(w.api.hold(), false, 'Resume clears the hold');
});

test('R7 item 3: after Resume the store holds the full restored draft at once', async () => {
  const w = world();
  await seed(w, { phase: 4 });
  const old = JSON.parse(w.store.ch_draft_v6); old._saved = 1; w.store.ch_draft_v6 = JSON.stringify(old);
  w.reload(); w.api.checkAndShowDraftModal();
  w.click('btn-draft-resume'); await settle();
  const stored = JSON.parse(w.store.ch_draft_v6);
  assert.ok(stored._saved > 1, 'a save ran at the end of the resume');
  assert.equal(stored.restock.saved, true); assert.equal(stored.linen.rows.length, 1); assert.equal(stored.phase, 4);
});

test('R7 item 3 (changed by R8 item 2): if applyDraft throws, nothing is saved, the stored draft stays as it was, and the hold stays on until a reload', async () => {
  const w = world();
  const before = await seed(w, { phase: 4 });
  w.reload(); w.api.checkAndShowDraftModal();
  w.api.saveDraft();                            // a save while the question is open must not reach the store
  w.api.throwIn(true);
  w.click('btn-draft-resume'); await settle();
  assert.equal(w.store.ch_draft_v6, before, 'the stored draft is unchanged');
  assert.equal(w.api.hold(), true, 'the hold stays on (R8: later saves wait for a reload)');
  w.api.throwIn(false);
  w.api.saveDraft();
  assert.equal(w.store.ch_draft_v6, before, 'no later save writes over it');
});

/* ---- Start fresh must not double a stock deduction ---- */
test('R7 item 5: Start fresh the same day keeps a sent Restock and linen (same key, status shown, nothing sent again)', async () => {
  const w = world();
  await seed(w, { rs: 'sent', ln: 'sent' });
  w.reload(); w.api.checkAndShowDraftModal();
  w.click('btn-draft-fresh');
  const s = w.api.getState();
  assert.deepEqual([s.restock && s.restock.sent, s.restock && s.restock.key, s.supplyLogSaved], [true, 'rk-1', true]);
  assert.deepEqual([s.linen && s.linen.sent, s.linen && s.linen.key], [true, 'lk-1']);
  const stored = JSON.parse(w.store.ch_draft_v6);
  assert.deepEqual([stored.restock.sent, stored.supplyLogSaved, stored.linen.sent], [true, true, true], 'and it is saved');
  assert.equal(w.api.hold(), false);
  await w.api.flush(false, true);
  assert.equal(w.post('record_inventory_usage').length, 0); assert.equal(w.post('record_linen_stains_v1').length, 0);
});

for (const mode of ['tried', 'waiting']) {
  test(`R7 item 5: Start fresh the same day with a ${mode}-unsent Restock and linen resends the SAME key, once`, async () => {
    const w = world();
    await seed(w, { rs: mode, ln: mode });
    w.reload(); w.api.checkAndShowDraftModal();
    w.click('btn-draft-fresh');
    const s = w.api.getState();
    assert.equal(s.restock.key, 'rk-1'); assert.equal(s.linen.key, 'lk-1');
    await w.api.load();
    await w.api.flush(false, true);
    const r = w.post('record_inventory_usage'), l = w.post('record_linen_stains_v1');
    assert.equal(r.length, 1); assert.ok(r[0].body.p_rows.every(x => x.usage_key.startsWith('s120-rk-1-')), 'restock keeps its key');
    assert.equal(l.length, 1); assert.equal(l[0].body.p_idempotency_key, 'lk-1', 'linen keeps its key');
  });
}

test('R7 item 5: Start fresh discards an answer never sent and never tried, and everything from an earlier date (a new key follows)', async () => {
  const a = world();
  await seed(a, { rs: 'saved', ln: 'saved' });
  a.reload(); a.api.checkAndShowDraftModal(); a.click('btn-draft-fresh');
  assert.deepEqual([a.api.getState().restock, a.api.getState().linen, a.api.getState().supplyLogSaved], [null, null, false], 'never sent, never tried: discarded');
  const b = world(); b.today = '2026-11-18';
  await seed(b, { rs: 'sent', ln: 'sent', date: '2026-11-17' });
  const old = JSON.parse(b.store.ch_draft_v6); const at = Date.UTC(2026, 10, 10); old._saved = Date.now(); old.restock.sendStartedAt = at; old.linen.sendStartedAt = at; b.store.ch_draft_v6 = JSON.stringify(old);   // R9: carry-over goes by the send's own stamp, never the save time
  const kept = b.store.ch_draft_v6;
  b.reload(); b.date = '2026-11-18'; b.api.checkAndShowDraftModal();
  b.api.saveDraft(); assert.equal(b.store.ch_draft_v6, kept, 'a save while the question is open leaves the stored draft alone');
  b.click('btn-draft-fresh');
  const s = b.api.getState();
  assert.deepEqual([s.restock, s.linen, s.supplyLogSaved], [null, null, false], 'an earlier day is finished work');
  assert.equal(b.store.ch_draft_v6, undefined);
  await b.api.load();
  s.restock = mk('S120R_newRestock'); classify().top.forEach(i => { s.restock.top[i.id] = 1; }); s.restock.kit = { a: 'no', n: null }; s.restock.saved = true; s.supplyLogSaved = true;
  await b.api.flush(true);
  const sent = b.post('record_inventory_usage');
  assert.equal(sent.length, 1); assert.ok(sent.every(c => c.body.p_rows.every(x => !x.usage_key.includes('rk-1'))), 'a new cleaning gets a new key');
});

/* ---- a lasting server error cannot trap the report ---- */
async function submitWorld(over = {}) {
  const w = world();
  await seed(w, { phase: 6, rs: 'saved', ln: over.linen === false ? null : 'saved' });
  w.api.setState(w.state);
  w.api.initSubmitModal();
  w.postStatus = over.status ?? 500;
  w.tap = async () => { w.click('btn-submit-confirm'); await settle(); };
  w.msg = () => w.els['submit-status'].textContent;
  return w;
}
const FIRST = 'Not sent yet: restock. Tap Submit again to send the report without it. The host will be told.';

test('R7 item 6-8: server 500 forever, online: the first tap stops, the second sends the report with the Restock line', async () => {
  const w = await submitWorld({ linen: false });
  await w.tap();
  assert.equal(w.proceeded, 0, 'first tap stops'); assert.equal(w.msg(), FIRST);
  await w.tap();
  assert.equal(w.proceeded, 1, 'second tap lets the report go');
  assert.equal(w.state.restock.unconfirmed, true); assert.equal(w.state.restock.key, 'rk-1', 'the key stays');
  const lines = new Function(block + '\nreturn S120R_reportLines;')()(w.state.linen, w.state.restock).map(l => l.text);
  assert.deepEqual(lines, ['Restock could not be confirmed as recorded. The host will check the shelf.']);
  w.postStatus = 200; await w.api.flush(true);   // the server comes back after the report went: the same key records it, and the line is not repeated on a later report
  assert.equal(w.state.restock.sent, true);
  assert.deepEqual(new Function(block + '\nreturn S120R_reportLines;')()(w.state.linen, w.state.restock), []);
});

test('R7 item 2: the modal sets the hold itself, so a call order that skips the boot line still cannot save over the draft', async () => {
  const w = world();
  const before = await seed(w, { phase: 4 });
  w.reload({ boot: false });
  assert.equal(w.api.hold(), false);
  w.api.checkAndShowDraftModal();
  assert.equal(w.api.hold(), true);
  w.api.saveDraft();
  assert.equal(w.store.ch_draft_v6, before);
  w.click('btn-draft-fresh');
  assert.equal(w.api.hold(), false, 'Start fresh clears the hold');
});

test('R7 item 6: linen and restock both stuck: the message names both and the report carries both lines', async () => {
  const w = await submitWorld();
  await w.tap();
  assert.equal(w.msg(), 'Not sent yet: linen check and restock. Tap Submit again to send the report without it. The host will be told.');
  await w.tap();
  assert.equal(w.proceeded, 1);
  const lines = new Function(block + '\nreturn S120R_reportLines;')()(w.state.linen, w.state.restock).map(l => l.text);
  assert.deepEqual(lines.sort(), ['Linen check could not be confirmed as recorded. The host will check the linen.', 'Restock could not be confirmed as recorded. The host will check the shelf.']);
});

test('R7 item 8: the server recovers on the second tap: the report goes, the key records normally, no line is added', async () => {
  const w = await submitWorld({ linen: false });
  await w.tap();
  assert.equal(w.proceeded, 0); assert.equal(w.msg(), FIRST);
  w.postStatus = 200;
  await w.tap();
  assert.equal(w.proceeded, 1); assert.equal(w.state.restock.sent, true); assert.ok(!w.state.restock.unconfirmed);
  assert.deepEqual(new Function(block + '\nreturn S120R_reportLines;')()(w.state.linen, w.state.restock), []);
  assert.ok(w.post('record_inventory_usage').every(c => c.body.p_rows.every(x => x.usage_key.startsWith('s120-rk-1-'))));
});

test('R7 item 7: an automatic resubmit when the connection returns never counts as the second tap', async () => {
  const w = await submitWorld({ linen: false });
  await w.tap();
  assert.equal(w.msg(), FIRST);
  for (let i = 0; i < 3; i++) { w.state.pendingPreSubmit = true; w.api.resumePre(); w.runTimers(); await settle(); }
  assert.equal(w.proceeded, 0, 'three automatic runs, none passes');
  await w.tap();
  assert.equal(w.proceeded, 1, 'the cleaner tapping once more does');
});

test('R7 item 7: certainly offline never lets the report go and keeps today\'s message', async () => {
  const w = await submitWorld({ linen: false });
  await w.tap();
  assert.equal(w.msg(), FIRST);
  w.nav.onLine = false; w.netDown = true;
  await w.tap(); await w.tap(); await w.tap();
  assert.equal(w.proceeded, 0);
  assert.match(w.msg(), /^Not sent yet: restock\. Your answers are kept on this phone\. The report goes when you are online again, or tap Submit again\.$/);
});

/* ---- small fixes ---- */
test('R7 item 9: the Submit cue reaches the card on one tap, with the real step timing', async () => {
  const phases = {}; for (let i = 0; i < 7; i++) { const set = new Set(i === 6 ? ['active'] : []); phases[i] = { classList: { add: c => set.add(c), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) }, scrollTop: 0 }; }
  const seen = [];
  const target = { tagName: 'DIV', scrollIntoView() { seen.push(phases[4].classList.contains('active')); } };
  const box = { hidden: false, textContent: '' };
  const state = { phase: 6, cleaningType: 'turnover', supplyLogSaved: false, aftercleanPhotos: Array(10).fill(1), precleanPhotos: [], kitchenPhotos: [], meterPhotos: [] };
  const src = fnText('S94_unmet') + fnText('S94_renderCue') + fnText('S94_scrollToFirst') + fnText('goToPhase') + '\nreturn { S94_renderCue, S94_scrollToFirst };';
  const noop = () => {};
  const api = new Function('state', 'el', 'K_gatedForPhase', 'K_answered', 'isPhaseValid', 'PHASE_COUNT', 'AFTERCLEAN_PHOTO_MIN', 'MIDSTAY_PHOTO_MIN', 'K_missingSlots', 'K_KITCHEN_PHOTO_MIN', 'kitchenPhotosRequired', 'window', 'matchMedia',
    'revealSkipIfPhotoMissing', 'showGateHint', 'updateStepper', 'updateBottomBar', 'refreshCheckAllButtons', 'ls', 'PHASE_KEY', 'saveDraft', 'K_headerPhoto', 'K_reportProgress', 'K_phaseDone', 'PHASE_LABELS', '_draftHold', src)(
    state, id => (id === 'nav-cue' ? box : id === 'supply-usage-trigger-card' ? target : (/^phase-(\d)$/.exec(id) ? phases[/^phase-(\d)$/.exec(id)[1]] : null)), () => [], () => true, () => false, 7, 3, 2, () => [], 0, () => false, {}, () => ({ matches: true }),
    noop, noop, noop, noop, noop, noop, 'k', noop, noop, noop, noop, [], false);
  api.S94_renderCue();
  api.S94_scrollToFirst();
  await new Promise(r => setTimeout(r, 250));
  assert.deepEqual(seen, [true], 'scrolled once, after the Bathroom & Kitchen step was active');
});

test('R7 item 10: linen waiting text no longer promises the online event; item 11: the nudge has no exclamation mark', () => {
  const ST = 'Saved on this phone. It sends when you submit; the answers stay locked until then.';
  assert.ok(html.includes("t = '" + ST + "'"), 'the linen status text');
  assert.ok(!/L\.tried && L\.waiting\) t = '[^']*connection returns/.test(html), 'the linen text no longer says the connection sends it');
  assert.ok(html.includes('`Almost ready to finish. Still needed: ${missing.join(\'; \')}.'), 'the phase 4 nudge');
  assert.ok(!html.includes('Almost ready to finish!'));
});
