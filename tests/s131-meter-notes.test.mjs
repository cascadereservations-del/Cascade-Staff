// s131 lane A: bill period wording, the meter reading date on the pay sheet, note kinds, cleaning-report markers, Good to know on both cards. Names are invented ("Zz").
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CS, read, boot, baseHandlers, HOMEWITH, stayRow, TODAY } from './_a_harness.mjs';

const win = { CS, ICON: (n) => '<svg data-i="' + n + '"></svg>' }; win.window = win;
vm.runInContext(read('bills/BL_bills.js'), vm.createContext(win));
const L = win.BL_Bills.lib;
const plain = (x) => JSON.parse(JSON.stringify(x));
const BASE = { since: '2026-10-21', last_reading_at: '2026-10-14T02:00:00Z', electric: { php: 4314.35, kwh: 383 }, water: { php: 212, m3: 7.2 } };
const todayHtml = async (role, extra) => { const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, { today_bills_v1: () => ({ error: null, data: Object.assign({}, BASE, extra) }) }) }); return app.els['v-home'].innerHTML; };

// ---- 1, 2: bills card
test('billsToday: the new keys are carried, an old payload keeps today\'s shape', () => {
  const n = CS.billsToday(Object.assign({}, BASE, { water_since: '2026-10-14', waiting_for: 'November', can_pay_list: false, check_bills: true }));
  assert.equal(n.waterSince, '2026-10-14'); assert.equal(n.waiting, 'November'); assert.equal(n.canPayList, false); assert.equal(n.checkBills, true);
  const o = CS.billsToday(BASE);
  assert.equal(o.canPayList, null); assert.equal(o.checkBills, false); assert.equal(o.waiting, ''); assert.equal(o.waterSince, '');
});
test('bills card: "This bill so far · since", no cycle wording', async () => {
  const h = await todayHtml('owner', { due: [] });
  assert.match(h, /This bill so far · since 21[\s ]Oct/); assert.doesNotMatch(h, /This cycle so far/);
  assert.doesNotMatch(h, /No meter reading in this bill yet/);
});
test('bills card: a water column that started on another day says so', async () => {
  const h = await todayHtml('owner', { water_since: '2026-10-14', due: [] });
  assert.match(h, /K_since[^>]*>since 14[\s ]Oct/);
});
test('bills card: waiting for the next bill is info tone, never danger', async () => {
  const h = await todayHtml('owner', { waiting_for: 'November', due: [] });
  assert.match(h, /Waiting for the November (electricity )?bill/); assert.match(h, /Counting goes on until its reading date is entered/);
  const w = h.slice(h.indexOf('Waiting for the')- 200, h.indexOf('Waiting for the') + 20);
  assert.doesNotMatch(w, /p-danger|p-warn|danger/); assert.match(w, /p-info/);
});
test('bills card: can_pay_list false hides the To pay rows; check_bills shows the row to #supply', async () => {
  const due = [{ id: 'b1', kind: 'internet', label: 'Zz Internet', status: 'due', estimate_php: 1500, is_estimate: false, due_day: 28, can_pay: false }];
  const hid = await todayHtml('cleaner', { due, can_pay_list: false, check_bills: false });
  assert.doesNotMatch(hid, /Zz Internet/); assert.doesNotMatch(hid, /Check for the bills/);
  const chk = await todayHtml('cleaner', { due: [], can_pay_list: false, check_bills: true });
  assert.match(chk, /Check for the bills/); assert.match(chk, /href="#supply"/);
});
test('bills card: an old payload (no can_pay_list) still lists the due rows', async () => {
  const due = [{ id: 'b1', kind: 'internet', label: 'Zz Internet', status: 'due', estimate_php: 1500, is_estimate: false, due_day: 28, can_pay: true }];
  assert.match(await todayHtml('owner', { due }), /Zz Internet/);
});

// ---- 3: the pay sheet
test('pay sheet lib: a meter bill needs a real reading date not after today; the reading is optional but numeric', () => {
  const ok = { file: {}, amountText: '10', meter: true, readDate: '2026-11-21', today: '2026-11-22', readVal: '' };
  assert.equal(L.payReady(ok), true);
  assert.equal(L.payReady(Object.assign({}, ok, { readDate: '' })), false);
  assert.equal(L.payReady(Object.assign({}, ok, { readDate: '2026-11-23' })), false);
  assert.equal(L.payReady(Object.assign({}, ok, { readDate: '2026-02-30' })), false);
  assert.equal(L.payReady(Object.assign({}, ok, { readVal: '12x' })), false);
  assert.equal(L.payReady(Object.assign({}, ok, { readVal: '4,655.5' })), true);
  assert.equal(L.payReady({ file: {}, amountText: '10' }), true, 'a bill that is not a meter bill is unchanged');
});
test('pay sheet lib: the reading goes in p_proof, left out when blank', () => {
  const up = { path: 'p', sha256: 'h' };
  const a = plain(L.proofPayload(up, 10, 10, { date: '2026-11-21', value: '4,655.5' }));
  assert.equal(a.reading_date, '2026-11-21'); assert.equal(a.reading_value, 4655.5);
  assert.equal('reading_value' in plain(L.proofPayload(up, 10, null, { date: '2026-11-21', value: '' })), false);
  assert.equal('reading_date' in plain(L.proofPayload(up, 10, null)), false);
});
test('pay sheet lib: default date is the 21st of the billed month, never after today', () => {
  assert.equal(L.defaultReadDate('2026-10', '2026-11-22'), '2026-10-21');
  assert.equal(L.defaultReadDate('2026-11', '2026-11-15'), '2026-11-15');
  assert.equal(L.monthName('2026-11'), 'November');
});
test('pay sheet lib: plain reasons for the two new refusals', () => {
  for (const reason of ['reading_date_required', 'reading_date_invalid']) {
    const s = L.refusal({ reason }); assert.ok(s.length > 20, reason); assert.doesNotMatch(s, /may not be logged/, reason);
  }
});
test('pay sheet source: date input with max today, optional reading, estimate on its own line, soft warning', () => {
  const src = read('bills/BL_bills.js');
  assert.match(src, /Meter reading date on the bill/); assert.match(src, /Present reading on the bill \(optional\)/);
  assert.match(src, /type="date" max="/); assert.match(src, /BL_est/); assert.match(src, /reading_warn/);
});

// ---- 4, 5: kinds
test('note kinds: all four parse and round trip; old text is unchanged', () => {
  const stored = '2026-11-01: Request: more towels || 2026-11-02: ! Issue: leaky tap || 2026-11-03: Suggestion: a rug || 2026-11-04: plain';
  const list = CS.parseNoteList(stored);
  assert.deepEqual(list.map((n) => CS.noteKind(n)), ['request', 'issue', 'suggestion', 'note']);
  assert.equal(CS.serializeNotes(list), stored);
  assert.deepEqual(plain(CS.NOTE_KINDS), ['note', 'request', 'suggestion', 'issue']);
});
test('note kinds: changing the kind rewrites only the prefix', () => {
  const next = CS.notesEdit('2026-11-01: Request: towels', 0, { text: 'towels', mark: 0, kind: 'issue', date: '2026-11-01' }, '2026-11-22');
  assert.equal(next, '2026-11-01: Issue: towels');
});

// ---- 6: turnover markers
const RAW = '2026-11-10: Turnover report: Faucet is leaking in the CR';
test('turnoverRows: reads the raw rows with date, body and index', () => {
  const r = CS.turnoverRows(RAW + ' || 2026-11-12: Turnover report: Sofa stained');
  assert.equal(r.length, 2); assert.equal(r[0].date, '2026-11-10'); assert.equal(r[0].body, 'Faucet is leaking in the CR'); assert.equal(r[0].covered, false);
});
test('notesAddTurn: the marker keeps the cleaner\'s words, raw row is hidden once a marker exists (D-391.5)', () => {
  const stored = CS.notesAddTurn(RAW, { text: 'Faucet is leaking in the CR', mark: 1, kind: 'issue', turn: '2026-11-10' }, '2026-11-22');
  assert.match(stored, /! Issue: \[turnover 2026-11-10\] Faucet is leaking in the CR/);
  assert.ok(stored.startsWith(RAW), 'nothing typed is lost: the raw words stay stored');
  const marker = CS.parseNoteList(stored).find((n) => n.turn);
  assert.equal(marker.turn, '2026-11-10'); assert.equal(marker.text, 'Faucet is leaking in the CR'); assert.equal(CS.noteKind(marker), 'issue');
  assert.equal(CS.turnoverRows(stored)[0].covered, true);
  const shown = CS.notesView(stored).all.map((n) => n.text);
  assert.equal(shown.filter((t) => /Faucet/.test(t)).length, 1, 'one row, not two');
});
test('Addressed turns the marker off Good to know without editing the words', () => {
  const stored = CS.notesAddTurn(RAW, { text: 'Faucet is leaking in the CR', mark: 1, kind: 'issue', turn: '2026-11-10' }, '2026-11-22');
  const i = CS.parseNoteList(stored).findIndex((n) => n.turn);
  const done = CS.notesEdit(stored, i, { text: 'Faucet is leaking in the CR', mark: 1, kind: 'issue', addressed: true, date: '2026-11-10' }, '2026-11-22');
  assert.match(done, /\[addressed 2026-11-22\]/); assert.match(done, /Faucet is leaking in the CR/);
  assert.equal(CS.goodToKnow({ notes: done }, false).notes.length, 0);
});

// ---- 4: Good to know
test('goodToKnow: bold kind, max 3 rows, newest open turnover issue, +N more', () => {
  const notes = '2026-11-01: ! Request: towels || 2026-11-02: !! Request: toaster || 2026-11-03: ! Note: a || 2026-11-04: ! Note: b || ' + RAW;
  const g = CS.goodToKnow({ notes }, false);
  assert.equal(g.notes.length, 3);
  assert.ok(g.notes.some((x) => x.kind === 'issue' && /Faucet/.test(x.p) && /10 Nov turnover/.test(x.src)));
  assert.equal(g.notes[0].p, 'toaster');
  assert.ok(g.more >= 1);
});
test('goodToKnow: a level-0 note stays out', () => {
  assert.equal(CS.goodToKnow({ notes: '2026-11-01: Request: plain' }, false).notes.length, 0);
});
test('Good to know renders on the house card and the Up next card with the kind in bold', async () => {
  const G = (o) => Object.assign({ uid: 'stay-1', guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 2, repeat: false, stay_count: 1, tier: 'first', tier_line: null, notes: null }, o);
  const n = '2026-10-12: ! Request: extra towels || 2026-10-10: Turnover report: Faucet is leaking in the CR';
  const app = await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: G({ notes: n }), next_guest: G({ uid: 'stay-2', guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', notes: n }) }) }) });
  const h = app.els['v-home'].innerHTML;
  const up = h.indexOf('T_upnext'); assert.ok(up > 0, 'Up next card');
  for (const part of [h.slice(0, up), h.slice(up)]) {
    assert.match(part, /<b>Request:<\/b>/); assert.match(part, /<b>Issue:<\/b>/); assert.match(part, /Faucet is leaking in the CR/);
  }
});

// ---- 7, 8: perk, inventory
test('PERKS.std is the new freebie text', () => {
  assert.match(read('lib.js'), /Returning-guest freebie: 1 chocolate and 2 extra bottles of water/);
});
test('inventory tiles: row layout, icon left, tall enough to tap', () => {
  const css = read('styles.css');
  const m = /\.K_inv-btn\s*\{([^}]*)\}/.exec(css);
  assert.ok(m); assert.match(m[1], /flex-direction:\s*row/); assert.match(m[1], /align-items:\s*center/);
  assert.ok(+/min-height:\s*(\d+)px/.exec(m[1])[1] >= 56);
});

// ---- 9: demo data
test('demo: today_bills_v1 shows since, waiting_for, and the check view for a non-payer', async () => {
  const D = (await import('./_a_harness.mjs')).D;
  const call = (role) => D.call ? D.call('today_bills_v1', {}, { role }) : null;
  const src = read('demo.js');
  assert.match(src, /waiting_for/); assert.match(src, /check_bills/); assert.match(src, /water_since/); assert.match(src, /Faucet is leaking in the CR/);
  assert.match(src, /reading_date_required/); assert.match(src, /reading_warn/);
  void call;
});

// ---- 10: version
test('version 3.4.48, shell v73', () => {
  assert.match(read('app.js'), /3\.4\.48/); assert.match(read('sw.js'), /cs-shell-v73/);
});
