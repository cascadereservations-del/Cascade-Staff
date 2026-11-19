// Session 120, lane R8: Resume keeps photo records, a failed resume keeps the stored draft, carry-over goes by the save time,
// one run of the pre-submit send at a time, the thrown send names what is unsent, one Restock line per send, a visible boot failure, a 44 px cue.
// The real page functions run with the page's globals stubbed; the Resume and Start fresh buttons and the submit confirm are driven through
// their registered handlers. The photo restores are stubs that wait on a gate the test opens; every name and id is invented.
// CH_HTML points the same tests at a scratch copy of the page (mutation runs); the default is the worktree page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holdSnippet, resumeSnippet } from './s120_page_snippets.mjs';

const NL = String.fromCharCode(10);
const html = readFileSync(process.env.CH_HTML || new URL('../checklist/index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(NL);
const hasFn = name => new RegExp(`\\n(async )?function ${name}\\(`).test(html);
const fnText = name => {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  return html.slice(s, html.indexOf('\n}\n', s) + 3);
};
const lineOf = re => { const m = re.exec(html); return m ? m[0] : ''; };
const block = html.slice(html.indexOf('/* S120R:BEGIN'), html.indexOf('/* S120R:END */'));
const initSrc = html.slice(html.indexOf('async function init() {'));
const bootLine = (/\n\s*(_draftHold\s*=\s*!!loadDraft\(\);)/.exec(initSrc.slice(0, initSrc.indexOf('await '))) || [])[1] || '';
const consts = '';
const guardLine = lineOf(/let _preSubmitRunning = false;/);

const RESUME_FAIL = 'Your saved work could not be restored. It is still safe on this phone.';
const BOOT_FAIL = 'This page did not finish loading. Reload it before you continue.';
const ITEMS = [['Bottled Water'], ['Coffee (3-in-1)'], ['Tea'], ['Sugar & Creamer Sticks'], ['Bathroom tissue'], ['Laundry Detergent'], ['Toiletries (toothbrush, toothpaste, soap)'], ['Kitchen towel'], ['Demo Soap']]
  .map(([name], n) => ({ id: 'id' + n, name, category: 'x', unit: 'bottle' }));
const idOf = nm => ITEMS.find(i => i.name === nm).id;
const LINEN_ITEMS = [{ id: 'lin1', name: 'Bath Towel' }];
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const manila = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 8, mi);   // a Manila wall-clock time as epoch ms
const MIN = 60000, HOUR = 3600000;

class Elm {
  constructor(id) { this.id = id; this.value = ''; this.checked = false; this.style = {}; this.dataset = {}; this.textContent = ''; this.className = ''; this.disabled = false; this.childNodes = [{ textContent: '' }];
    const set = new Set(); this.classList = { add: c => set.add(c), remove: (...c) => c.forEach(x => set.delete(x)), toggle() {}, contains: c => set.has(c) }; this.handlers = []; }
  click() {} dispatchEvent() {} appendChild() {} setAttribute() {} querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; }
  addEventListener(type, fn, opt) { this.handlers.push({ type, fn, once: !!(opt && opt.once) }); }
}

function world({ online = true } = {}) {
  const w = { nav: { onLine: online }, calls: [], store: {}, saves: [], timers: [], toasts: [], proceeded: 0, date: '2026-11-18', now: manila(2026, 11, 18, 10, 0), postStatus: 200, netDown: false, els: {}, intervals: [],
    gates: [], delay: false, failMeter: false, failSection: false, lsThrow: false, barThrow: false };
  const fresh = () => ({ phase: 0, cleaningType: 'turnover', linen: null, restock: null, supplyLogSaved: false, confirmItems: {}, confirmNotes: {}, issueFlags: {}, checklist: {},
    meterPhotos: [], precleanPhotos: [], bedroomPhotos: [], kitchenPhotos: [], aftercleanPhotos: [], numberOfNights: 0, startTimestamp: null, conditionStatus: null, conditionNote: '',
    meterVerified: false, isWeeklyIncluded: false, sessionFolderId: null, sessionFolderUrl: null, submissionId: 'sub-1', meterSkipReason: '', isSubmitting: false, pendingPreSubmit: false });
  w.state = fresh();
  const el = id => (id === 'cleaningDate' ? { value: w.date } : id === 'cleanerName' ? { value: 'Kay' } : (w.els[id] = w.els[id] || new Elm(id)));
  const fetch = async (url, opt = {}) => {
    if (opt.method) {
      if (w.netDown) throw new Error('fetch failed');
      w.calls.push({ url, method: 'POST', body: JSON.parse(opt.body) });
      return w.postStatus === 200 ? { ok: true, status: 200, text: async () => '{}' } : { ok: false, status: w.postStatus, text: async () => '{}' };
    }
    w.calls.push({ url, method: 'GET', body: null });
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(url.includes('linen') ? LINEN_ITEMS : ITEMS)), text: async () => '' };
  };
  // a clock the test moves; new Date() and Date.now() follow it
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(w.now); } static now() { return w.now; } }
  // a photo restore waits at a gate while w.delay is set; failMeter / failSection make it reject
  const gate = () => (w.delay ? new Promise(res => w.gates.push(res)) : Promise.resolve());
  const rebuilt = m => ({ name: m.name, url: m.url || null, fileId: m.fileId || null, uploaded: m.uploaded, status: m.uploaded ? 'done' : 'queued', idbId: m.uploaded ? null : m.idbId, slot: m.slot || null, takenAt: m.takenAt || null });
  w.release = () => { w.gates.splice(0).forEach(r => r()); };
  w.drain = async () => { for (let i = 0; i < 30; i++) { w.release(); await settle(); } };   // opens every gate, the later ones too
  const names = ['S120R_rpc', 'S120R_sendLinen', 'S120R_sendRestock', 'S120R_flushAll', 'S120R_flushOnce', 'S120R_refreshStatus', 'S120R_fetchItems', 'S120R_loadItems', 'S120R_unsave', 'S120R_restore',
    'S120R_syncLinen', 'S120R_typeChanged', 'S120R_loadLinenItems', 'S120R_resumePreSubmit', 'saveDraft', 'applyDraft', 'setCleaningType', 'loadDraft', 'flashAutosave', 'clearDraft',
    'checkAndShowDraftModal', 'runPreSubmitFlush', 'initSubmitModal', 'startAutoSave', 'photoMeta', 'todayManila'].filter(hasFn);
  const fns = names.map(fnText).join(NL) + NL + holdSnippet(html) + NL + resumeSnippet(html);
  const api = new Function('w', 'el', 'fetch', 'staffHeaders', 'uuid', 'SUPABASE_URL', 'PROPERTY_ID', 'navigator', 'document', 'esc', 'setTimeout', 'clearTimeout', 'setInterval', 'localStorage', 'Date', 'gate', 'rebuilt', 'console',
    'let state = w.state;\n'
    + block + NL + fns + NL + consts + NL + guardLine + NL
    + 'const DRAFT_KEY = "ch_draft_v6", DWELL_KEY = "ch_dwell", DRAFT_VERSION = 5, PHASE_COUNT = 7, SUBMITTED_IDS_KEY = "ids";\n'
    + 'let _susItems = [], _susLoaded = false, _draftRestoring = false;\n'
    + 'const fetchWithRetry = (u, o) => fetch(u, o);\n'
    + 'const PHASE_KEY = "ch_phase", K_reportProgress = () => {};\n'
    + 'const ls = (k, v) => { if (v === null) delete w.store[k]; else w.store[k] = v; }, idbDeletePhoto = () => {}, startElapsedTimer = () => {};\n'
    + 'const lsJSON = (k, v) => { if (v === undefined) return w.store[k] ? JSON.parse(w.store[k]) : null; if (w.lsThrow) throw new Error("storage full"); w.store[k] = JSON.stringify(v); if (k === "ch_draft_v6") w.saves.push(w.store[k]); };\n'
    + 'const K_migrateDraft = d => d, ARRIVE_ITEMS = [], CHEMICAL_ITEMS = [], BEDROOM_ITEMS = [], KITCHEN_ITEMS = [], FINAL_CLEANING_ITEMS = [], K_KILLER_ITEMS = [], K_PHASE_FROM_V1 = {};\n'
    + 'let _throwIn = false;\n'
    + 'const K_syncFlag = () => {}, K_renderBedroom = () => {}, renderConfirmItems = () => { if (_throwIn) throw new Error("render failed"); }, updateBottomBar = () => { if (w.barThrow) throw new Error("bar failed"); }, updateProgress = () => {}, showToast = (m, t, d) => w.toasts.push(m), closeSupplyUsageSheet = () => {};\n'
    + 'const collectExtraExpenses = () => [], addExtraExpenseRow = () => {}, updatePhotoCounter = () => {}, loadCleanableBookings = () => {}, S94_renderCue = () => {};\n'
    // the step 7 gate stands in for the photo-gated steps: it is true only while every photo group holds the counts the seed saved
    + 'const isPhaseValid = () => state.meterPhotos.filter(Boolean).length === 2 && state.precleanPhotos.length === 3 && state.bedroomPhotos.length === 1 && state.kitchenPhotos.length === 2 && state.aftercleanPhotos.length === 4;\n'
    + 'const METER_PHOTO_API = [0, 1].map(i => ({ restoreFromDraft: async meta => { await gate(); if (w.failMeter) throw new Error("idb read failed"); if (meta) state.meterPhotos[i] = rebuilt(meta); } }));\n'
    + 'const SECTION_PHOTO_API = {}; ["preclean", "bedroom", "kitchen", "afterclean"].forEach(k => { SECTION_PHOTO_API[k] = { restoreFromDraft: async list => { if (!Array.isArray(list)) return; for (const m of list) { await gate(); if (w.failSection) throw new Error("idb read failed"); state[k + "Photos"].push(rebuilt(m)); } } }; });\n'
    + 'const proceedWithSubmission = () => { w.proceeded++; }, enqueuePhotoUpload = f => f(), uploadPhotoRecord = async p => { p.uploaded = true; },   /* s120R13: a flush that works marks the photo uploaded; a photo still unsent now stops Submit */  showFlushOverlay = () => {}, updateFlushOverlay = () => {}, hideFlushOverlay = () => {};\n'
    + 'const goToPhase = ph => { state.phase = ph; saveDraft(); };\n'
    + 'function boot() { ' + bootLine + ' }\n'
    + 'return { saveDraft, resumeDraft, loadDraft, flush: S120R_flushAll, load: S120R_loadItems, setState: s => { state = s; }, getState: () => state, setCleaningType, run: runPreSubmitFlush,\n'
    + '  checkAndShowDraftModal: typeof checkAndShowDraftModal === "function" ? checkAndShowDraftModal : () => {}, initSubmitModal: typeof initSubmitModal === "function" ? initSubmitModal : () => {},\n'
    + '  startAutoSave: typeof startAutoSave === "function" ? startAutoSave : () => {}, resumePre: S120R_resumePreSubmit, boot, hold: () => _draftHold, valid6: () => isPhaseValid(6),\n'
    + '  initFailed: typeof S120R_initFailed === "function" ? S120R_initFailed : () => {}, throwIn: v => { _throwIn = v; }, resetPage: () => { _draftHold = false; _draftRestoring = false; _susItems = []; } };')(
    w, el, fetch, async () => ({}), (() => { let n = 0; return () => 'uuid-' + (++n); })(), 'https://x.test', 'prop-1', w.nav, { querySelectorAll: () => [] }, s => String(s),
    f => { w.timers.push(f); return 0; }, () => {}, f => { w.intervals.push(f); return 0; }, { getItem: () => null }, FakeDate, gate, rebuilt, { error() {}, log() {} });
  w.api = api;
  w.reload = (o = {}) => { w.state = fresh(); api.setState(w.state); w.els = {}; w.intervals = []; w.gates = []; api.resetPage(); if (o.boot !== false) api.boot(); };
  w.click = id => { const e = w.els[id]; for (const h of [...e.handlers].filter(x => x.type === 'click')) { if (h.once) e.handlers.splice(e.handlers.indexOf(h), 1); h.fn(); } };
  w.post = name => w.calls.filter(c => c.method === 'POST' && c.url.endsWith('/rpc/' + name));
  w.runTimers = () => { const t = w.timers.splice(0); t.forEach(f => f()); };
  w.stored = () => JSON.parse(w.store.ch_draft_v6);
  return w;
}

const mk = fn => new Function(block + '\nreturn ' + fn + '();')();
const classify = () => new Function(block + '\nreturn S120R_classify;')()(ITEMS);
const photo = (name, pending) => ({ name, url: pending ? '' : 'https://x.test/' + name, fileId: pending ? '' : 'f-' + name, uploaded: !pending, status: pending ? 'queued' : 'done', idbId: pending ? 'idb-' + name : null, slot: null, takenAt: null });
const COUNTS = { meter: 2, preclean: 3, bedroom: 1, kitchen: 2, afterclean: 4 };
const counts = s => ({ meter: s.meterPhotos.filter(Boolean).length, preclean: s.precleanPhotos.length, bedroom: s.bedroomPhotos.length, kitchen: s.kitchenPhotos.length, afterclean: s.aftercleanPhotos.length });
const storedCounts = d => ({ meter: d.meterPhotoMeta.filter(Boolean).length, preclean: d.precleanPhotoMeta.length, bedroom: d.bedroomPhotoMeta.length, kitchen: d.kitchenPhotoMeta.length, afterclean: d.aftercleanPhotoMeta.length });
const pendingIds = d => ['meterPhotoMeta', 'precleanPhotoMeta', 'bedroomPhotoMeta', 'kitchenPhotoMeta', 'aftercleanPhotoMeta'].flatMap(k => d[k].filter(Boolean).filter(m => m.idbId).map(m => m.idbId)).sort();
const PENDING = ['idb-a3', 'idb-m1', 'idb-p3'];

/* a draft with Restock, one linen row, and photos in every group (three of them still pending, with their IndexedDB ids) */
async function seed(w, { phase = 6, rs = 'saved', ln = 'saved', photos = true } = {}) {
  await w.api.load();
  const s = w.state, cls = classify();
  s.phase = phase;
  if (rs) {
    s.restock = mk('S120R_newRestock');
    cls.top.forEach(i => { s.restock.top[i.id] = 0; }); s.restock.top[idOf('Tea')] = 2; s.restock.kit = { a: 'no', n: null };
    s.restock.saved = true; s.restock.key = 'rk-1'; s.supplyLogSaved = true;
    if (rs !== 'saved') s.restock.sendStartedAt = w.now;
    if (rs === 'sent') { s.restock.tried = true; s.restock.sent = true; }
    if (rs === 'tried') s.restock.tried = true;
  }
  if (ln) {
    s.linen = mk('S120R_newLinen');
    s.linen.answer = 'found'; s.linen.rows = [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }]; s.linen.key = 'lk-1';
    if (ln && ln !== 'saved') s.linen.sendStartedAt = w.now;
    if (ln === 'sent') { s.linen.tried = true; s.linen.sent = true; }
    if (ln === 'tried') s.linen.tried = true;
    s.confirmItems.check_2_4 = 'confirmed'; s.confirmNotes.check_2_4 = 'Bath Towel: stain came out';
  }
  if (photos) {
    s.meterPhotos = [photo('m0'), photo('m1', true)];
    s.precleanPhotos = [photo('p1'), photo('p2'), photo('p3', true)];
    s.bedroomPhotos = [photo('b1')];
    s.kitchenPhotos = [photo('k1'), photo('k2')];
    s.aftercleanPhotos = [photo('a1'), photo('a2'), photo('a3', true), photo('a4')];
  }
  w.api.saveDraft();
  return w.store.ch_draft_v6;
}
const reopen = w => { w.reload(); w.api.checkAndShowDraftModal(); };

/* ---- item 1: Resume must not erase photo records ---- */
test('R8 item 1: with delayed restores the store keeps every photo record during the wait and after it; a reload and Resume give the same counts and pending ids', async () => {
  const w = world();
  const before = await seed(w);
  assert.deepEqual(storedCounts(w.stored()), COUNTS); assert.deepEqual(pendingIds(w.stored()), PENDING);
  reopen(w);
  w.delay = true;
  w.click('btn-draft-resume');
  assert.equal(w.store.ch_draft_v6, before, 'right after the tap the stored draft is untouched');
  await settle();
  w.api.startAutoSave(); w.intervals.forEach(f => f());   // an autosave tick during the wait
  w.api.saveDraft();
  assert.equal(w.store.ch_draft_v6, before, 'during the wait nothing is written');
  assert.equal(w.api.hold(), true, 'the hold is still on during the wait');
  assert.equal(w.saves.length, 1, 'only the seed save ever reached the store');
  await w.drain();
  assert.equal(w.api.hold(), false, 'the hold ends once every restore has settled');
  assert.deepEqual(storedCounts(w.stored()), COUNTS, 'after the wait the store holds every photo record');
  assert.deepEqual(pendingIds(w.stored()), PENDING, 'pending photos keep their idbId');
  assert.deepEqual(storedCounts(JSON.parse(w.saves[1])), COUNTS, 'the first save after the seed (the Resume save) already holds every photo record; the sends that follow save their own state later');
  w.delay = false;
  reopen(w);
  w.click('btn-draft-resume'); await settle();
  assert.deepEqual(counts(w.api.getState()), COUNTS, 'same photo counts after the reload');
  assert.equal(w.api.valid6(), true, 'isPhaseValid(6) holds after the resume');
  assert.deepEqual(pendingIds(w.stored()), PENDING);
  assert.equal(w.api.getState().meterPhotos[1].idbId, 'idb-m1', 'the pending meter photo keeps its idbId in state');
});

test('R8 item 1: an old-format draft (no Restock, no linen, no cleaningType) keeps its photo records through the same delayed Resume', async () => {
  const w = world();
  await seed(w, { rs: null, ln: null });
  const old = w.stored(); delete old.restock; delete old.linen; delete old.cleaningType; delete old._k; delete old.supplyLogSaved;
  w.store.ch_draft_v6 = JSON.stringify(old);
  const before = w.store.ch_draft_v6;
  reopen(w);
  w.delay = true;
  w.click('btn-draft-resume'); await settle();
  assert.equal(w.store.ch_draft_v6, before, 'nothing written while the restores wait');
  await w.drain();
  assert.deepEqual(storedCounts(w.stored()), COUNTS); assert.deepEqual(pendingIds(w.stored()), PENDING);
  reopen(w); w.delay = false; w.click('btn-draft-resume'); await settle();
  assert.deepEqual(counts(w.api.getState()), COUNTS); assert.equal(w.api.valid6(), true);
});

/* ---- item 2: a failed restore keeps the stored draft safe ---- */
async function failedResume(w, how) {
  const before = await seed(w);
  reopen(w);
  if (how === 'apply') w.api.throwIn(true);
  if (how === 'meter') w.failMeter = true;
  if (how === 'section') w.failSection = true;
  w.delay = how !== 'apply';
  w.click('btn-draft-resume'); await settle();
  await w.drain();
  return before;
}
for (const how of ['apply', 'meter', 'section']) {
  test(`R8 item 2: a failed resume (${how}) leaves the store as it was after an autosave tick, shows the message, and a reload then Resume works`, async () => {
    const w = world();
    const before = await failedResume(w, how);
    w.api.startAutoSave(); w.intervals.forEach(f => f()); w.api.saveDraft();
    assert.equal(w.store.ch_draft_v6, before, 'the stored draft is unchanged');
    assert.equal(w.saves.length, 1, 'no save reached the store');
    assert.equal(w.api.hold(), true, 'the hold stays on');
    assert.equal(w.els['draft-modal-note'].textContent, RESUME_FAIL, 'the message is shown in the modal'); assert.equal(w.els['draft-modal'].classList.contains('open'), true, 'the modal stays open');
    w.api.throwIn(false); w.failMeter = false; w.failSection = false; w.delay = false;
    reopen(w);
    w.click('btn-draft-resume'); await settle();
    assert.deepEqual(counts(w.api.getState()), COUNTS); assert.equal(w.api.valid6(), true);
    assert.equal(w.api.hold(), false);
    assert.deepEqual(storedCounts(w.stored()), COUNTS);
  });
}

/* ---- item 3: carry-over goes by when the draft was saved ---- */
async function freshAt(savedAt, nowAt, { reportDate = '2026-11-18', rs = 'sent', ln = 'sent' } = {}) {
  const w = world();
  w.date = reportDate; w.now = savedAt;
  await seed(w, { rs, ln, photos: false });
  assert.equal(w.stored()._saved, savedAt);
  w.now = nowAt;
  reopen(w);
  w.click('btn-draft-fresh');
  return w;
}
const carried = w => { const s = w.api.getState(); return !!(s.restock && s.restock.key === 'rk-1' && s.linen && s.linen.key === 'lk-1'); };

test('R8 item 3: saved 23:30 Manila, reopened 00:30 the next day: carried (work across midnight)', async () => {
  const w = await freshAt(manila(2026, 11, 18, 23, 30), manila(2026, 11, 19, 0, 30), { reportDate: '2026-11-18' });
  assert.equal(carried(w), true);
  assert.equal(w.stored().restock.sent, true, 'and stored');
});
test('R8 item 3: a backdated report saved a minute ago is carried (cleaningDate is the report date, not the save time)', async () => {
  const w = await freshAt(manila(2026, 11, 18, 10, 0), manila(2026, 11, 18, 10, 1), { reportDate: '2026-11-10' });
  assert.equal(carried(w), true);
});
test('R8 item 3: saved the previous afternoon, reopened next morning: starts clean, even when the report date is today', async () => {
  const w = await freshAt(manila(2026, 11, 17, 15, 0), manila(2026, 11, 18, 9, 0), { reportDate: '2026-11-18' });
  const s = w.api.getState();
  assert.deepEqual([s.restock, s.linen, s.supplyLogSaved], [null, null, false]);
  assert.equal(w.store.ch_draft_v6, undefined, 'nothing is stored for the cleared draft');
});
test('R8 item 3: saved this morning, reopened this evening (12 hours, same Manila day): carried', async () => {
  const w = await freshAt(manila(2026, 11, 18, 8, 0), manila(2026, 11, 18, 20, 0), { reportDate: '2026-11-10' });
  assert.equal(carried(w), true);
});
test('R8 item 3: the Manila day decides, not the phone or UTC: saved 07:50 Manila (23:50 UTC the day before), reopened 23:00 Manila the same day: carried', async () => {
  const w = await freshAt(Date.UTC(2026, 10, 18, 23, 50), Date.UTC(2026, 10, 19, 15, 0), { reportDate: '2026-11-19' });
  assert.equal(carried(w), true);
});
test('R8 item 3: 6 hours exactly across midnight is not enough: saved 22:00, reopened 04:00 the next day: clean; 5 h 59 min: carried', async () => {
  const a = await freshAt(manila(2026, 11, 18, 22, 0), manila(2026, 11, 19, 4, 0));
  assert.equal(carried(a), false);
  const b = await freshAt(manila(2026, 11, 18, 22, 0), manila(2026, 11, 19, 3, 59));
  assert.equal(carried(b), true);
});
test('R9 item 6: a send with no stamp of its own cannot be shown to be recent: it starts clean', async () => {
  const w = world(); w.now = manila(2026, 11, 18, 10, 0);
  await seed(w, { photos: false });
  const d = w.stored(); delete d.restock.sendStartedAt; delete d.linen.sendStartedAt; w.store.ch_draft_v6 = JSON.stringify(d);
  reopen(w); w.click('btn-draft-fresh');
  assert.equal(carried(w), false);
});

/* ---- item 4: a tap during a running send is not the second tap ---- */
async function submitWorld(over = {}) {
  const w = world();
  await seed(w, { phase: 6, rs: 'saved', ln: over.linen === false ? null : 'saved' });   // the photos make the step 7 gate true, so an automatic resubmit may run
  w.api.setState(w.state);
  w.api.initSubmitModal();
  w.postStatus = over.status ?? 500;
  w.tap = async () => { w.click('btn-submit-confirm'); await settle(); };
  w.msg = () => w.els['submit-status'].textContent;
  return w;
}
const FIRST = 'Not sent yet: restock. Tap Submit again to send the report without it. The host will be told.';

test('R8 item 4: offline Submit, back online, the cleaner taps confirm while the automatic run is out, server answers 500: no report is sent and the stop message shows', async () => {
  const w = await submitWorld({ linen: false });
  w.nav.onLine = false; w.netDown = true;
  await w.tap();
  assert.match(w.msg(), /^Not sent yet: restock\. Your answers are kept on this phone/);
  assert.equal(w.state.pendingPreSubmit, true);
  w.nav.onLine = true; w.netDown = false; w.postStatus = 500;
  w.api.resumePre(); w.runTimers();            // the automatic run starts and is out (not awaited)
  w.click('btn-submit-confirm');               // the tap lands while it is out
  await settle();
  assert.equal(w.proceeded, 0, 'the report was not sent');
  assert.equal(w.msg(), FIRST, 'the stop message shows');
  assert.equal(w.post('record_inventory_usage').length, 1, 'one send, not two');
  await w.tap();
  assert.equal(w.proceeded, 1, 'a real second tap, after the stop, lets the report go');
});

test('R8 item 4: the guard clears on every path, including a throw', async () => {
  const w = await submitWorld({ linen: false });
  w.barThrow = true;
  await assert.rejects(w.api.run(true), /bar failed/);
  w.barThrow = false; w.postStatus = 200;
  await w.api.run(true);
  assert.equal(w.proceeded, 1, 'a run after the throw is not refused');
  await w.api.run(true);
  assert.equal(w.proceeded, 2, 'and the one after that');
});

/* ---- item 5: a thrown send still tells the host what is unsent ---- */
test('R8 item 5: a thrown send names linen check and restock, and both reach the report as unconfirmed', async () => {
  const w = await submitWorld();
  await w.api.load();
  w.lsThrow = true;                            // the first save inside the send throws
  await w.tap();
  assert.equal(w.msg(), 'Not sent yet: linen check and restock. Tap Submit again to send the report without it. The host will be told.');
  assert.ok(!w.msg().includes('restock or linen'));
  await w.tap();
  assert.equal(w.proceeded, 1);
  assert.equal(w.state.linen.unconfirmed, true); assert.equal(w.state.restock.unconfirmed, true);
  const lines = new Function(block + '\nreturn S120R_reportLines;')()(w.state.linen, w.state.restock).map(l => l.text);
  assert.deepEqual(lines.sort(), ['Linen check could not be confirmed as recorded. The host will check the linen.', 'Restock could not be confirmed as recorded. The host will check the shelf.']);
});
test('R8 item 5: a thrown send with the linen already sent names only restock', async () => {
  const w = world();
  await seed(w, { phase: 6, rs: 'saved', ln: 'sent', photos: false });
  w.api.setState(w.state); w.api.initSubmitModal();
  await w.api.load();
  w.lsThrow = true;
  w.click('btn-submit-confirm'); await settle();
  assert.equal(w.els['submit-status'].textContent, FIRST);
});

/* ---- item 6: one Restock line per send ---- */
test('R8 item 6: an unconfirmed line is emitted only when that part has no failed text', () => {
  const lines = new Function(block + '\nreturn S120R_reportLines;')();
  const both = (l, r) => lines(l, r).map(x => x.text);
  assert.deepEqual(both(null, { unconfirmed: true, failed: 'error 400', sent: false }), ['Restock was not recorded (error 400). The host will check the shelf.']);
  assert.deepEqual(both({ unconfirmed: true, failed: 'error 400', sent: false }, null), ['Linen stock was not updated (error 400). The host will check the shelf.']);
  assert.deepEqual(both(null, { unconfirmed: true, failed: '', sent: false }), ['Restock could not be confirmed as recorded. The host will check the shelf.']);
  assert.deepEqual(both({ unconfirmed: true, failed: '', sent: false }, null), ['Linen check could not be confirmed as recorded. The host will check the linen.']);
  assert.equal(lines(null, { unconfirmed: true, failed: 'x' }).filter(l => l.section === 'Restock').length, 1, 'one Restock line');
});

/* ---- item 7: a boot failure is visible ---- */
test('R8 item 7: when init fails the page says so, the hold stays on and the stored draft is untouched; both boot paths route a failure there', async () => {
  const w = world();
  const before = await seed(w);
  w.reload();                                  // the boot line sets the hold
  assert.equal(w.api.hold(), true);
  w.api.initFailed(new Error('boom'));
  assert.ok(w.toasts.includes(BOOT_FAIL), JSON.stringify(w.toasts));
  w.api.saveDraft(); w.api.startAutoSave(); w.intervals.forEach(f => f());
  assert.equal(w.store.ch_draft_v6, before, 'the stored draft stays as it is');
  assert.equal(w.api.hold(), true);
  assert.ok(/DOMContentLoaded',\s*\(\)\s*=>\s*init\(\)\.catch\(S120R_initFailed\)/.test(html), 'the deferred boot path');
  assert.ok(/\n  init\(\)\.catch\(S120R_initFailed\);/.test(html), 'the direct boot path');
});

/* ---- item 8: the cue is a 44 px target that fits 320 px ---- */
test('R8 item 8: #nav-cue is at least 44 px high, wraps inside the width, and the page leaves room for it above the bottom bar', () => {
  const rule = /#nav-cue \{([^}]*)\}/.exec(html)[1];
  const px = (re) => { const m = re.exec(rule); return m ? parseFloat(m[1]) : NaN; };
  assert.ok(px(/min-height:\s*([\d.]+)px/) >= 44, 'min-height');
  assert.match(rule, /box-sizing:\s*border-box/); assert.match(rule, /left:\s*0/); assert.match(rule, /right:\s*0/);
  assert.match(rule, /overflow-wrap:\s*anywhere/, 'a long unmet list wraps instead of overflowing at 320 px');
  assert.match(rule, /display:\s*flex/); assert.match(rule, /align-items:\s*center/);
  assert.match(html, /#nav-cue\[hidden\] \{ display: none; \}/, 'hidden still hides it');
  const pad = /\.phase::after \{[^}]*height:\s*([\d.]+)rem/.exec(html);
  assert.ok(pad && parseFloat(pad[1]) * 16 >= 60 + 44 + 24, 'end-of-step spacing clears the bar and a cue');
});
