// Session 120, lane R4: the linen check DOM cases (from K_checklist_dom, the s120R and R3 ones), run against the live Cascade-Staff checklist.
// The real renderConfirmItems and the S120R block from checklist/index.html run against a small fake DOM. Clock frozen (K_NOW).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const K_NOW = Date.parse('2026-10-13T02:00:00Z');
const LINEN = [{ id: 'i-towel', name: 'Bath Towel' }, { id: 'i-fit', name: 'Fitted Sheet (Q)' }];
const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [K_NOW])); } static now() { return K_NOW; } };

/* every top-level function named here, by source text */
const fnText = name => {
  const re = new RegExp(`\\n(async )?function ${name}\\(`);
  const m = re.exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  const e = html.indexOf('\n}\n', s);
  return html.slice(s, e + 3);
};
const s120Block = () => html.slice(html.indexOf('/* S120R:BEGIN'), html.indexOf('/* S120R:END */'));
const s120Ui = () => ['S120R_syncLinen', 'S120R_renderLinen', 'S120R_bindLinen', 'S120R_bindPhoto', 'S120R_refreshStatus', 'S120R_focusKey', 'S120R_focusBack'].map(fnText).join('\n');
const dataBlock = () => html.slice(html.indexOf('const PHASE_LABELS'), html.lastIndexOf('/*', html.indexOf('const state = {')));

/* ---- a fake DOM just big enough for the confirm controls ---- */
class FakeEl {
  constructor(id = '') {
    this.id = id; this.children = []; this._html = ''; this.className = ''; this.value = ''; this.textContent = ''; this.dataset = {}; this.listeners = {}; this._cl = new Set(); this._kids = {};
    this.classList = { add: (...c) => c.forEach(x => this._cl.add(x)), remove: (...c) => c.forEach(x => this._cl.delete(x)), contains: c => this._cl.has(c), toggle: c => (this._cl.has(c) ? this._cl.delete(c) : this._cl.add(c)) };
  }
  set innerHTML(h) { this._html = h; this._kids = {}; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, f) { this.listeners[t] = f; }
  setAttribute() {}
  getAttribute() { return null; }
  _kid(key, make) { return this._kids[key] || (this._kids[key] = make()); }
  querySelectorAll(sel) {
    if (sel !== '.confirm-btn') return [];
    return [...this._html.matchAll(/<button class="confirm-btn" id="([^"]+)"[^>]*?data-item="([^"]+)"\s+data-state="([^"]+)"/g)]
      .map(m => this._kid(m[1], () => { const b = new FakeEl(m[1]); b.dataset = { item: m[2], state: m[3] }; return b; }));
  }
  querySelector(sel) {
    let m;
    if (sel === '.s120-linen') return this.children.find(c => c.className === 's120-linen') || null;
    if ((m = /^#conf-note-(.+)$/.exec(sel))) return this._html.includes(`id="conf-note-${m[1]}"`) ? this._kid(sel, () => new FakeEl(sel)) : null;
    if ((m = /^\.issue-photo-input-(.+)$/.exec(sel))) return this._html.includes(`issue-photo-input-${m[1]}`) ? this._kid(sel, () => new FakeEl(sel)) : null;
    if ((m = /^\.confirm-btn\[data-state="(\w+)"\]$/.exec(sel))) return this.querySelectorAll('.confirm-btn').find(b => b.dataset.state === m[1]) || null;
    return null;
  }
}

/* run the real confirm controls for a cleaning type */
function loadConfirm(type = 'turnover') {
  const state = { cleaningType: type, confirmItems: {}, confirmNotes: {}, checklist: {}, issueFlags: {}, startTimestamp: K_NOW };
  const els = {};
  const el = id => (els[id] = els[id] || new FakeEl(id));
  const photoCalls = [];
  const src = dataBlock() + '\n' + s120Block() + '\n' + s120Ui() + '\n' + [fnText('renderConfirmItems'), fnText('restoreConfirmItem'), fnText('K_syncFlag')].join('\n')
    + '\nreturn { renderConfirmItems, K_gatedOk, K_gatedForPhase, K_gatedAll, K_isUrgentIssue, K_syncFlag, confirmItemsNow, PHASE_COUNT };';
  const api = new Function('state', 'el', 'esc', 'document', 'updateBottomBar', 'updateProgress', 'saveDraft', 'handleIssuePhoto', 'FOLDED', 'Date', 'lsJSON', 'uuid', 'navigator', 'S120R_loadLinenItems',
    src)(state, el, s => String(s), { createElement: () => new FakeEl(), activeElement: null }, () => {}, () => {}, () => {}, (id) => photoCalls.push(id), true, FakeDate,
    k => (k === 'ch_s120_linen' ? LINEN : null), (() => { let n = 0; return () => 'rid-' + (++n); })(), { onLine: false }, async () => []);
  api.renderConfirmItems();
  const wrap = id => {
    const c = Object.values(els).filter(e => e.children.length).flatMap(e => e.children).find(ch => ch.id === `confirm-wrap-${id}`);
    assert.ok(c, `${id} is rendered`);
    return c;
  };
  const tap = (id, which) => wrap(id).querySelectorAll('.confirm-btn').find(b => b.dataset.state === which).listeners.click();
  const linenClick = async data => { const lin = wrap('check_2_4').children.find(c => c.className === 's120-linen'); await lin.listeners.click({ target: { closest: () => ({ dataset: data, disabled: false }) } }); return lin; };
  return { api, state, els, photoCalls, wrap, tap, linenClick };
}

test('DOM s120R: the linen check asks which piece and what happened; the step stays closed until every row has an outcome', async () => {
  const { api, state, wrap, linenClick } = loadConfirm('turnover');
  assert.equal(api.K_gatedOk(2), false, 'the step is closed until the killer is answered');
  await linenClick({ ans: 'none' });
  assert.equal(state.confirmItems.check_2_4, 'confirmed', 'No stains is Confirmed');
  assert.equal(api.K_gatedOk(2), true);
  assert.equal(state.issueFlags.check_2_4, undefined);
  await linenClick({ ans: 'found' });
  assert.equal(api.K_gatedOk(2), false, 'Found stains with no piece chosen is not an answer');
  await linenClick({ pick: 'i-towel' });
  assert.equal(state.linen.rows.length, 1);
  assert.equal(api.K_gatedOk(2), false, 'a row without an outcome keeps Next closed');
  await linenClick({ out: '0:cleaned' });
  assert.equal(state.confirmItems.check_2_4, 'confirmed', 'all cleaned is Confirmed');
  assert.equal(state.confirmNotes.check_2_4, 'Linen stains. Stain came out: Bath Towel.', 'with a generated report note');
  assert.equal(state.issueFlags.check_2_4, undefined);
  const lin = await linenClick({ pick: 'i-towel' });
  assert.equal(state.linen.rows.length, 2, 'tapping the same piece again adds a second row');
  assert.equal(api.K_gatedOk(2), false, 'the new row has no outcome yet');
  await linenClick({ out: '1:needs_replacing' });
  assert.equal(state.confirmItems.check_2_4, 'issue', 'any needs replacing is Issue Found');
  assert.equal(state.confirmNotes.check_2_4, 'Linen stains. Needs replacing: Bath Towel. Stain came out: Bath Towel.');
  assert.equal(state.issueFlags.check_2_4.note, state.confirmNotes.check_2_4, 'travels as an ordinary flagged note with no typing');
  assert.equal(api.K_isUrgentIssue(api.K_gatedAll().find(i => i.id === 'check_2_4')), false);
  assert.ok(lin._html.includes('issue-photo-input-check_2_4') && lin._html.includes('id="issue-preview-check_2_4"'), 'the optional photo keeps its input and preview');
  await linenClick({ ans: 'none' });
  assert.equal(state.issueFlags.check_2_4, undefined, 'No stains clears the flag');
  assert.equal(state.linen.rows.length, 0);
});


/* ---- Lane R3 (s120) ---- */
test('DOM s120R R3 item 5: once linen is sent every control is drawn disabled, none hidden or silently dead', () => {
  const { renderLocked } = renderLockedCard();
  const state = { linen: { answer: 'found', rows: [{ rid: 'r', item_id: 'i-towel', name: 'Bath Towel', qty: 1, outcome: 'needs_replacing' }], sent: true, tried: false, failed: '', unavailable: false }, confirmItems: {}, issueFlags: {} };
  const buttons = [...renderLocked(state).matchAll(/<button[^>]*>/g)].map(m => m[0]).filter(b => !/issue-photo-btn/.test(b));
  assert.ok(buttons.length >= 9, 'answers, chips, outcomes, stepper and remove are all drawn: ' + buttons.length);
  for (const b of buttons) assert.match(b, /disabled/, 'locked: ' + b);
  state.linen.sent = false;
  const live = [...renderLocked(state).matchAll(/<button[^>]*>/g)].map(m => m[0]).filter(b => !/issue-photo-btn/.test(b));
  for (const b of live) assert.ok(!/ disabled/.test(b), 'unlocked: ' + b);
});

function renderLockedCard() {
  const src = dataBlock() + '\n' + s120Block() + '\n' + ['S120R_renderLinen', 'S120R_refreshStatus'].map(fnText).join('\n') + '\nreturn S120R_renderLinen;';
  return {
    renderLocked(state) {
      const target = new FakeEl('linen'); const div = new FakeEl('card'); div.children.push(Object.assign(target, { className: 's120-linen' }));
      const render = new Function('state', 'el', 'esc', src.replace('return S120R_renderLinen;', "_linenItems = [{ id: 'i-towel', name: 'Bath Towel' }]; return S120R_renderLinen;"))(state, () => new FakeEl(), s => String(s));
      render(div, { id: 'check_2_4', text: 'Linen' });
      return target._html;
    },
  };
}

test('DOM s120R R3 item 9: No stains removes a photo-only flag; a photo stays with found-and-cleaned stains', async () => {
  const { state, linenClick } = loadConfirm('turnover');
  await linenClick({ ans: 'found' }); await linenClick({ pick: 'i-towel' }); await linenClick({ out: '0:cleaned' });
  state.issueFlags.check_2_4 = { note: '', photoData: 'data:x', photoUrl: null, photoFileId: null };
  await linenClick({ out: '0:cleaned' });   // untick then tick again: still no issue
  await linenClick({ out: '0:cleaned' });
  assert.ok(state.issueFlags.check_2_4 && state.issueFlags.check_2_4.photoData, 'a stain that came out keeps its photo');
  await linenClick({ ans: 'none' });
  assert.equal(state.issueFlags.check_2_4, undefined, 'No stains leaves no photo-only flag');
});

test('DOM s120R: the linen card repaint draws the locked state on the existing card', async () => {
  const { state, wrap, linenClick } = loadConfirm('turnover');
  await linenClick({ ans: 'found' });
  const card = wrap('check_2_4'), lin = card.children.find(c => c.className === 's120-linen');
  assert.ok(!/data-ans="found"[^>]* disabled/.test(lin._html), 'open before the send');
  state.linen.sent = true;
  card._s120Repaint();
  assert.match(lin._html, /data-ans="found"[^>]* disabled/);
});
