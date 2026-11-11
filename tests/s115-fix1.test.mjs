// s115 fix round 1 (Staff 3.4.30). Hand-computed expectations. Notes order, the 90-character cut, and the 12-month KPI chart per DAY.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, CS } from './_a_harness.mjs';

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

test('s115 notes: 3 reports + a current request -> the request first, then ONLY the newest report; the rest are counted', () => {
  const t = '2026-10-01: Turnover report: a || 2026-10-20: Turnover report: b || 2026-09-01: Turnover report: c || 2026-10-25: Special request: extra pillows';
  const g = CS.goodToKnow({ notes: t }, false);
  assert.deepEqual(g.notes.map((n) => n.p), ['Special request: extra pillows', 'Turnover report: b']);
  assert.equal(g.more, 2, '4 notes, 2 shown');
  const k = CS.keyNote(t); assert.equal(k.p, 'Special request: extra pillows'); assert.equal(k.more, 3);
  // an incident (rank 0) still comes before the request, and the report after it
  const g2 = CS.goodToKnow({ notes: '2026-10-20: Turnover report: b || 2026-10-25: Special request: x | Reported damage to the kettle' }, false);
  assert.deepEqual(g2.notes.map((n) => n.p), ['Reported damage to the kettle', 'Special request: x', 'Turnover report: b']);
  // only reports: the newest one by chunk date, not the first listed
  assert.equal(CS.keyNote('2026-09-01: Turnover report: old || 2026-10-20: Turnover report: new').p, 'Turnover report: new');
});
test('s115 notes: an allergy or medical note is shown (guest safety)', () => {
  for (const w of ['Guest has a peanut allergy', 'Asthma, needs a clean room', 'Medical: insulin in the fridge', 'Needs a wheelchair ramp', 'Disabled guest, ground floor']) {
    const g = CS.goodToKnow({ notes: '2026-10-25: ' + w }, false);
    assert.deepEqual(g.notes.map((n) => [n.p, n.rank]), [[w, 1]], w);
  }
});
test('s115 the 90-character cut: a word boundary that would drop more than 20 characters hard-slices instead', () => {
  const long = 'Turnover report: ' + 'x'.repeat(100);
  const a = CS.goodToKnow({ notes: '2026-10-20: ' + long }, false).notes[0].p;
  assert.equal(a, long.slice(0, 89) + '…'); assert.equal(a.length, 90);
  const words = 'Turnover report: ' + 'word '.repeat(30), b = CS.goodToKnow({ notes: '2026-10-20: ' + words }, false).notes[0].p;
  assert.match(b, /word…$/); assert.ok(b.length <= 90 && b.length >= 70);
});
test('s115 a turnover text with " / " (the server replaced " | ") stays ONE point', () => {
  const g = CS.parseNotes('2026-10-20: Turnover report: sofa stained / towel missing');
  assert.equal(g.length, 1); assert.equal(g[0].points.length, 1); assert.equal(g[0].points[0].p, 'Turnover report: sofa stained / towel missing');
});

// ---------------------------------------------------------------------------------------------- KPI per day
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
// per stay: April 233.5 = one reading across a vacant gap. per day (fixed server): 10, 12, gap, 14, 9, 11, 13, 10, 12, gap, 11, 9
const DAY = [10, 12, null, 14, 9, 11, 13, 10, 12, null, 11, 9], STAY = [30, 36, null, 42, 27, 233.5, 39, 30, 36, null, 33, 27];
const perMonth = (perDay) => MONTHS.map((m, i) => Object.assign({ month: m, stays: DAY[i] == null ? 0 : 3, kwh: null, m3: null, kwh_per_stay: STAY[i], m3_per_stay: DAY[i] == null ? null : 1 }, perDay ? { kwh_per_day: DAY[i], m3_per_day: DAY[i] == null ? null : 0.4 } : {}));
const stay = (from, to) => Object.assign({ checkout_date: to, recorded_at: to + 'T04:00:00Z', days: 3, kwh: 30, kwh_per_day: 10, m3: 0.9, m3_per_day: 0.3 }, from ? { from, to } : {});
const payload = (pd, extra) => ({ ok: true, month: '2026-10-01', utility: Object.assign({ kwh_month: 79, kwh_per_day: 9.9, m3_month: 3.1, m3_per_day: 0.39, nights_booked: 12, nights_in_month: 30,
  last_reading: { recorded_at: '2026-11-05T02:00:00Z', delta_kwh: 25, days: 3, kwh_per_day: 8.3, delta_m3: 0.57, m3_per_day: 0.19, flag: null },
  per_stay: [stay(extra && '2026-10-20', '2026-10-23'), stay(extra && '2026-10-23', '2026-10-26')], per_month: perMonth(pd), brownouts: { count: 0, hours: 0 }, water_cuts: { count: 0, hours: 0 } }), inventory: {} });
function mountWith(data) {
  const win = { ICON: () => '', document: {} }; win.window = win; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(win));
  const L = {}, el0 = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
  win.K_Kpi.reset(); win.K_Kpi.mount(el0, { client: { rpc: (n) => Promise.resolve(n === 'kpi_tab_v1' ? { data, error: null } : { data: [], error: null }) }, role: 'cleaner', propertyId: 'p' });
  const click = async (attrs) => { const t = { getAttribute: (n) => attrs[n] ?? null, closest: () => t }; for (const f of L.click || []) f({ target: t, preventDefault() {} }); await tick(); };
  return { el: el0, click };
}
const cardOf = (h, id) => { const i = h.indexOf('id="' + id + '"'); assert.ok(i > 0, id + ' is drawn'); const rest = h.slice(i); const j = rest.indexOf('<div class="card glass', 10); return j > 0 ? rest.slice(0, j) : rest; };

test('s115 the 12-month chart is per DAY: typical = median of the 10 months (11), no outlier, units a day, caption; the spike-month spike is gone', async () => {
  const { el, click } = mountWith(payload(true)); await tick(); let c = cardOf(el.innerHTML, 'K_avg');
  assert.match(c, /<b>Average per day, last 12 months, kWh<\/b>/);
  assert.match(c, /typical 11(\.0)? kWh/, 'sorted 9,9,10,10,11,11,12,12,13,14 -> (11+11)/2');
  assert.doesNotMatch(c, /KU_pt-over|unusually high/); assert.doesNotMatch(c, /per stay/);
  assert.match(c, /aria-label="Apr 2026: 11(\.0)? kWh a day, 3 stays"/);
  assert.equal((c.match(/role="img"/g) || []).length, 10, 'two empty months are gaps');
  assert.match(c, /Each point is the use per day in that month \(meter use divided by the days between checkouts\)\. The dashed line is the typical month\. A month with no readings is a gap\./);
  assert.match(c, /This month: 9(\.0)? kWh a day over 3 stays\./);
  await click({ 'data-kact': 'avg', 'data-avg': 'm3' }); c = cardOf(el.innerHTML, 'K_avg');
  assert.match(c, /<b>Average per day, last 12 months, m³<\/b>/); assert.match(c, /typical 0\.4(0)? m³/); assert.match(c, /0\.4(0)? m³ a day/);
});
test('s115 an older server (no per-day keys in per_month) keeps the per-stay chart unchanged, outlier included', async () => {
  const { el } = mountWith(payload(false)); await tick(); const c = cardOf(el.innerHTML, 'K_avg');
  assert.match(c, /<b>Average per stay, last 12 months, kWh<\/b>/); assert.match(c, /KU_pt-over/); assert.match(c, /233\.5 kWh in April: unusually high/);
  assert.match(c, /Each point is the average per stay in that month/);
});
test('s115 the daily chart uses "to" for the point and names from-to in the label; without them nothing changes', async () => {
  let m = mountWith(payload(true, true)); await tick(); let c = cardOf(m.el.innerHTML, 'K_day');
  assert.match(c, /aria-label="20 Oct–23 Oct: 10(\.0)? kWh a day over 3 days/);
  assert.match(c, /aria-label="23 Oct–26 Oct: /); assert.match(c, /<span class="KU_x[^"]*" style="left:[\d.]+%">26 Oct<\/span>/);
  m = mountWith(payload(true, false)); await tick(); c = cardOf(m.el.innerHTML, 'K_day');
  assert.match(c, /aria-label="23 Oct: /); assert.doesNotMatch(c, /–/);
});
