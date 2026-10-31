// Pins s100 (D-352) on the checklist: the skip offer shows when Next is refused with an empty meter photo slot,
// can_skip_meter_photos_v2 gets the check-out date (404 falls back to v1), and the follow-up card has a third answer.
// Runs the real code: the functions are cut out of checklist/index.html and evaluated with a thin stub page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); assert.ok(a > 0 && b > a, from); return html.slice(a, b); };
const reveal = cut('// s100 (D-352): a Next that is refused', '// True when a missing meter photo is the only thing');
const refresh = cut('async function refreshMeterSkipAllowance()', 'function applyMeterSkip()');
const third0 = cut('function showNoMeterPhotoBox()', "/* The way out is hidden until it is needed");
const third = cut('function paintMeterFollowupCopy()', 'async function loadMeterFollowups()') + third0;

function world({ fetchImpl, state: st = {}, checkout = '2026-10-29' } = {}) {
  const els = {}, calls = [];
  const mk = () => ({ closest: () => ({ querySelector: () => ({ focus() {} }) }), querySelector: () => ({ innerHTML: '' }), hidden: false, disabled: false, value: '', textContent: '', classList: { add() {}, remove() {} }, focus() {}, scrollIntoView() {} });
  const E = (id) => (els[id] ||= mk());
  E('checkOutDate').value = checkout;
  const state = { phase: 1, cleaningType: 'turnover', meterPhotos: [null, null], meterPhotosSkipped: false, meterSkipRevealed: false, meterSkipAllowed: null, ...st };
  const ctx = {
    state, el: E, calls, navigator: { onLine: true }, PROPERTY_ID: 'prop-1', SUPABASE_URL: 'https://x',
    staffHeaders: async () => ({}), document: { querySelectorAll: () => ['a', 'b', 'c'].map(() => mk()), }, escapeHtml: (x) => String(x),
    fetch: async (url, o) => { const fn = String(url).split('/rpc/')[1]; const body = JSON.parse(o.body); calls.push({ fn, body }); return fetchImpl(fn, body); },
  };
  const api = new Function(...Object.keys(ctx), reveal + refresh + third +
    '\nreturn { revealSkipIfPhotoMissing, refreshMeterSkipAllowance, reportNoMeterPhoto, showNoMeterPhotoBox };')(...Object.values(ctx));
  return { ctx, api, els, calls, state };
}
const ok = (v, status = 200) => ({ ok: status < 400, status, json: async () => v });

test('a refused Next with an empty meter photo slot reveals the skip row and asks the server with the check-out date', async () => {
  const w = world({ fetchImpl: () => ok({ allowed: true, reason: null, neighbour_checkout: null }) });
  w.api.revealSkipIfPhotoMissing();
  assert.equal(w.state.meterSkipRevealed, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(w.calls, [{ fn: 'can_skip_meter_photos_v2', body: { p_property_id: 'prop-1', p_checkout_date: '2026-10-29' } }]);
  assert.equal(w.els['meter-skip-row'].hidden, false);
  assert.equal(w.els['meter-skip-btn'].hidden, false);
});

test('no reveal: both photos present, mid-stay or emergency, another phase, or already skipped', () => {
  const pic = { data: 'x' };
  const cases = [{ meterPhotos: [pic, pic] }, { cleaningType: 'mid_stay' }, { cleaningType: 'emergency' }, { phase: 2 }, { meterPhotosSkipped: true }];
  for (const st of cases) {
    const w = world({ state: st, fetchImpl: () => ok({}) });
    w.api.revealSkipIfPhotoMissing();
    assert.equal(w.state.meterSkipRevealed, false, JSON.stringify(st));
  }
  const w = world({ state: { meterPhotos: [{ data: 'x' }, null], cleaningType: 'deep_clean' }, fetchImpl: () => ok({}) });
  w.api.revealSkipIfPhotoMissing();
  assert.equal(w.state.meterSkipRevealed, true, 'one empty slot is enough, deep_clean counts');
});

test('v2 404 falls back to v1; a refusal shows the contract copy and hides the button', async () => {
  const w = world({ state: { meterSkipRevealed: true }, fetchImpl: (fn) => (fn === 'can_skip_meter_photos_v2' ? ok({}, 404) : ok([{ allowed: false }])) });
  await w.api.refreshMeterSkipAllowance();
  assert.deepEqual(w.calls.map((c) => c.fn), ['can_skip_meter_photos_v2', 'can_skip_meter_photos']);
  assert.deepEqual(w.calls[1].body, { p_property_id: 'prop-1' });
  assert.equal(w.els['meter-skip-btn'].hidden, true);
  assert.equal(w.els['meter-skip-note'].textContent, 'The stay next to this one also has no meter photo, so this one needs them. If you truly cannot, message Lloyd.');
});

test('a missing check-out date sends null to v2', async () => {
  const w = world({ checkout: '', state: { meterSkipRevealed: true }, fetchImpl: () => ok({ allowed: true }) });
  await w.api.refreshMeterSkipAllowance();
  assert.equal(w.calls[0].body.p_checkout_date, null);
});

test('third follow-up answer: short reason is held back, each raised row is reported, ok hides the card', async () => {
  const w = world({ fetchImpl: () => ok({ ok: true }) });
  w.state.meterFollowups = [{ session_id: 's1' }, { session_id: 's2' }];
 
  w.els['mf-nophoto-why'] = { value: 'abc', focus() {} };
  await w.api.reportNoMeterPhoto();
  assert.equal(w.calls.length, 0);
  w.els['mf-nophoto-why'].value = '  Phone lost the photos  ';
  await w.api.reportNoMeterPhoto();
  assert.deepEqual(w.calls, [
    { fn: 'report_no_meter_photo_v1', body: { p_session_id: 's1', p_note: 'Phone lost the photos' } },
    { fn: 'report_no_meter_photo_v1', body: { p_session_id: 's2', p_note: 'Phone lost the photos' } },
  ]);
  assert.equal(w.els['meter-followup'].hidden, true);
  assert.deepEqual(w.state.meterFollowups, []);
});

test('third follow-up answer: a refusal shows its message; offline shows the did-not-save line', async () => {
  const w = world({ fetchImpl: () => ok({ ok: false, reason: 'neighbour_skipped', message: 'The stay next to this one also has no meter photo.' }) });
  w.state.meterFollowups = [{ session_id: 's1' }];
  w.els['mf-nophoto-why'] = { value: 'Phone lost the photos', focus() {} };
  await w.api.reportNoMeterPhoto();
  assert.equal(w.els['meter-followup-foot'].textContent, 'The stay next to this one also has no meter photo.');
  const off = world({ fetchImpl: () => { throw new TypeError('offline'); } });
  off.state.meterFollowups = [{ session_id: 's1' }];
  off.els['mf-nophoto-why'] = { value: 'Phone lost the photos', focus() {} };
  await off.api.reportNoMeterPhoto();
  assert.match(off.els['meter-followup-foot'].textContent, /^That did not save/);
});

test('markup and wiring: button text, help line, third button, reveal hooks, no exclamation marks', () => {
  assert.match(html, /<button type="button" id="meter-skip-btn" hidden>No meter photo was taken<\/button>/);
  assert.match(html, /Tell the admin why\. Still type both readings\./);
  assert.match(html, /id="mf-nophoto-btn">No meter photo was taken<\/button>/);
  assert.match(html, /id="mf-nophoto-why"[^>]*aria-label="[^"]+"/);
  assert.ok(html.includes("revealMeterSkipOffer('photos_missing')"));
  assert.match(html, /revealSkipIfPhotoMissing\(\);\n    showGateHint\(state\.phase\)/);
  assert.match(html, /\{ revealSkipIfPhotoMissing\(\); S94_scrollToFirst\(\); \}/);
  assert.match(html, /el\('mf-nophoto-send'\)\?\.addEventListener\('click', reportNoMeterPhoto\)/);
  assert.doesNotMatch(html.slice(html.indexOf('id="mf-nophoto-btn"'), html.indexOf('id="mf-nophoto-send"')) + (third0.replace(/\/\/.*$/gm, '').match(/'[^']*'/g) || []).join(''), /!/);
});

test('S1: two rows, first saved, second refused: only the unanswered row is left and a retry writes only that one', async () => {
  let n = 0;
  const w = world({ fetchImpl: () => (++n === 1 ? ok({ ok: true }) : ok({ ok: false, message: 'The stay next to this one also has no meter photo.' })) });
  w.state.meterFollowups = [{ session_id: 's1', vision_verdict: 'mismatch' }, { session_id: 's2' }];
 
  w.els['mf-nophoto-why'] = { value: 'Phone lost the photos', focus() {} };
  await w.api.reportNoMeterPhoto();
  assert.deepEqual(w.state.meterFollowups, [{ session_id: 's2' }]);
  assert.equal(w.els['meter-followup-foot'].textContent, 'The stay next to this one also has no meter photo. The other report was saved.');
  assert.equal(w.els['meter-followup-list'].innerHTML.match(/<li>/g).length, 1);
  assert.notEqual(w.els['meter-followup']?.hidden, true);
  await w.api.reportNoMeterPhoto();
  assert.deepEqual(w.calls.map((c) => c.body.p_session_id), ['s1', 's2', 's2']);
});

test('S5: any non-ok v2 answer falls back to v1; a non-2xx report answer is not the offline line', async () => {
  const w = world({ state: { meterSkipRevealed: true }, fetchImpl: (fn) => (fn === 'can_skip_meter_photos_v2' ? ok({}, 500) : ok([{ allowed: true }])) });
  await w.api.refreshMeterSkipAllowance();
  assert.deepEqual(w.calls.map((c) => c.fn), ['can_skip_meter_photos_v2', 'can_skip_meter_photos']);
  const r = world({ fetchImpl: () => ok({}, 500) });
  r.state.meterFollowups = [{ session_id: 's1' }];
  r.els['mf-nophoto-why'] = { value: 'Phone lost the photos', focus() {} };
  await r.api.reportNoMeterPhoto();
  assert.equal(r.els['meter-followup-foot'].textContent, 'That could not be saved. Please message Lloyd.');
});

test('S3: a refusal hides the reason box and its help line, an allowance shows them again', async () => {
  let allowed = false;
  const w = world({ state: { meterSkipRevealed: true }, fetchImpl: () => ok([{ allowed }]) });
  await w.api.refreshMeterSkipAllowance();
  assert.equal(w.els['meter-skip-why'].hidden, true);
  assert.equal(w.els['meter-skip-help'].hidden, true);
  allowed = true;
  await w.api.refreshMeterSkipAllowance();
  assert.equal(w.els['meter-skip-why'].hidden, false);
  assert.equal(w.els['meter-skip-help'].hidden, false);
});

test('S2, S4, S6 wiring: copy, autofill refresh, draft reason, 44px buttons, focus after success', () => {
  assert.ok(html.includes("'Recorded. Still type both readings. The stays next to this one will need their meter photos.'"));
  assert.ok(html.includes("showToast('Noted. No meter photo for this stay.'"));
  assert.match(html, /fetchPrevReadings\(\);[^\n]*\n  if \(state\.meterSkipRevealed\) refreshMeterSkipAllowance\(\);/);
  assert.match(html, /meterSkipReason: el\('meter-skip-why'\)\?\.value/);
  assert.match(html, /set\('meter-skip-why', draft\.meterSkipReason\)/);
  assert.doesNotMatch(html, /draft\.meterPhotosSkipped/);
  assert.match(html, /#meter-followup \.mf-dismiss \{\n  margin: [^\n]*min-height: 44px/);
  assert.ok(html.includes("box?.closest('section')?.querySelector('h1')"));
  assert.ok(html.includes('D-352 replaces the 2026-09-13 anomaly-only rule'));
});

// ── Fix round 2 ──
const NOTE = 'This number does not fit the readings before and after. It is kept for now and checked when the next meter photo comes in.';
const orderSrc = cut('const METER_ORDER_NOTE', 'function meterFindings()') + cut('function meterFindings()', '  // Photo provenance') + 'return out; }';
function findingsWorld(skipped, elec) {
  const vals = { electricMeterReading: String(elec), waterMeterReading: '', checkOutDate: '2026-10-29' };
  const state = { meterPhotosSkipped: skipped, meterPhotos: [{}, {}], prevElectricReading: 100, prevWaterReading: 0, nextReading: { electric: 200, water: 0 }, prevReadingDate: '2026-10-25' };
  const fn = new Function('state', 'el', 'todayManila', 'daysBetween', 'ELEC_KWH_PER_DAY_MAX', 'WATER_M3_PER_DAY_MAX', 'DIGIT_SLIP_FACTOR',
    orderSrc + '\nreturn { meterFindings, meterOrderRefuses, METER_ORDER_NOTE };');
  return fn(state, (id) => ({ value: vals[id] ?? '' }), () => '2026-10-29', () => 4, 99, 99, 50);
}

test('X1: a declared no-photo report with a reading below the earlier or above the later stay gets the calm note, not a refusal', () => {
  for (const v of [90, 250]) {
    const w = findingsWorld(true, v);
    assert.equal(w.meterOrderRefuses(['x']), false, 'gate does not refuse');
    assert.ok(w.meterFindings().includes('Electric: ' + NOTE), String(v));
    assert.ok(!w.meterFindings().some((f) => /does not run backwards|read the photo again|lower than|higher than/.test(f)));
  }
});

test('X1: with photos the same readings still refuse and the old wording stays', () => {
  const lo = findingsWorld(false, 90), hi = findingsWorld(false, 250);
  assert.equal(lo.meterOrderRefuses(['x']), true);
  assert.equal(lo.meterOrderRefuses([]), false);
  assert.match(lo.meterFindings()[0], /lower than the reading for the stay before \(100\)/);
  assert.match(hi.meterFindings()[0], /higher than the reading for the later stay \(200\)/);
});

test('X1 wiring: the submit gate shows the note through showToast and only refuses when meterOrderRefuses says so', () => {
  const gate = cut('const backwards = [', 'state.isSubmitting = true;');
  assert.match(gate, /backwards\.length && !meterOrderRefuses\(backwards\)\) \{\s*showToast\(METER_ORDER_NOTE/);
  assert.match(gate, /else if \(backwards\.length\) \{[\s\S]*A meter does not run backwards[\s\S]*return;/);
});

test('F4: a recorded skip keeps the button hidden and the Recorded note; a refusal clears the skip and says why', async () => {
  const calls = [];
  const mkw = (allowed) => {
    const w = world({ state: { meterSkipRevealed: true, meterPhotosSkipped: true }, fetchImpl: () => ok([{ allowed }]) });
    return w;
  };
  const stubs = '';
  const run = async (allowed) => {
    const els = {};
    const mk = () => ({ hidden: false, textContent: '', value: '', classList: { add() { this.used = true; }, remove() { this.used = false; } } });
    const E = (id) => (els[id] ||= mk());
    E('checkOutDate').value = '2026-10-29';
    const state = { cleaningType: 'turnover', meterSkipRevealed: true, meterPhotosSkipped: true };
    let side = 0;
    const f = new Function('state', 'el', 'navigator', 'PROPERTY_ID', 'SUPABASE_URL', 'staffHeaders', 'fetch', 'updateBottomBar', 'updatePhotoCounter', 'saveDraft',
      refresh + '\nreturn refreshMeterSkipAllowance;')(state, E, { onLine: true }, 'p', 'https://x', async () => ({}), async () => ok([{ allowed }]), () => side++, () => side++, () => side++);
    await f();
    return { state, els, side };
  };
  const still = await run(true);
  assert.equal(still.state.meterPhotosSkipped, true);
  assert.equal(still.els['meter-skip-btn'].hidden, true);
  assert.match(still.els['meter-skip-note'].textContent, /^Recorded\./);
  const gone = await run(false);
  assert.equal(gone.state.meterPhotosSkipped, false);
  assert.equal(gone.els['meter-skip-btn'].hidden, true);
  assert.equal(gone.els['meter-skip-note'].textContent, 'The stay next to this one also has no meter photo, so this one needs them. If you truly cannot, message Lloyd.');
  assert.equal(gone.side, 3, 'bottom bar, photo counter and draft refreshed');
});

test('F2/F3/F1b: partial save repaints head and copy; a later offline failure says the other was saved; success clears the box', async () => {
  const rows = [{ session_id: 's1', vision_verdict: 'mismatch' }, { session_id: 's2', vision_verdict: 'unreadable' }];
  const build = (fetchImpl) => {
    const els = {};
    const mk = () => ({ hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', closest: () => null, focus() {}, querySelector: () => els.head || (els.head = { innerHTML: '' }) });
    const E = (id) => (els[id] ||= mk());
    E('mf-nophoto-why').value = 'phone lost them';
    const state = { meterFollowups: rows.slice() };
    const ctx = { state, el: E, escapeHtml: String, SUPABASE_URL: 'https://x', staffHeaders: async () => ({}), document: { querySelectorAll: () => [mk()] }, fetch: fetchImpl };
    const src = third;
    const api = new Function(...Object.keys(ctx), src + '\nreturn { reportNoMeterPhoto };')(...Object.values(ctx));
    return { els, state, api };
  };
  let n = 0;
  const w1 = build(async () => { if (n++ === 0) return ok([{ ok: true }]); throw new Error('offline'); });
  await w1.api.reportNoMeterPhoto();
  assert.match(w1.els['meter-followup-foot'].textContent, /you may be offline\. Try again when you have signal\. The other report was saved\.$/);
  assert.match(w1.els.head.innerHTML, /A meter photo needs another look/, 'head follows the remaining row, which does not block');
  const w2 = build(async () => ok([{ ok: true }]));
  await w2.api.reportNoMeterPhoto();
  assert.equal(w2.els['mf-nophoto-why'].value, '');
  assert.equal(w2.els['mf-nophoto-box'].hidden, true);
  assert.equal(w2.els['meter-followup'].hidden, true);
});

test('F1: resetApp clears the skip reason, hides the skip row and drops its used class', () => {
  const reset = cut('function resetApp()', '  _susChanging');
  assert.match(reset, /el\('meter-skip-why'\)[\s\S]*value = ''/);
  assert.match(reset, /skipRow\.hidden = true; skipRow\.classList\.remove\('used'\)/);
});

test('s103 (D-354): a meter mismatch never blocks a report; the card is never worded as blocking and names the report', () => {
  assert.doesNotMatch(html, /meterBlocked/);
  assert.doesNotMatch(html, /Answer this before the next report|has to be answered before the next turnover/);
  const paint = cut('function paintMeterFollowupCopy()', 'async function loadMeterFollowups()');
  assert.match(paint, /A meter photo needs another look/);
  assert.match(paint, /This is about an earlier report, not the one you are doing now\. You can still send today/);
  const list = cut('function renderMeterFollowupList()', 'async function reportNoMeterPhoto()');
  assert.match(list, /Report sent \$\{when\}/);
});
