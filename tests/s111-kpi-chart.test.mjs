// s111 (Staff 3.4.27): Average per stay card (electricity + water, 12 months), aria-labels on every bar, water beside electricity.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read } from './_a_harness.mjs';

const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const rows = ['2025-11'].concat(MONTHS).map((m, i) => ({ month: m, stays: i === 3 || i === 8 ? 0 : 4, kwh_per_stay: i === 3 || i === 8 ? null : 15 + i, m3_per_stay: i === 3 || i === 8 ? null : 0.4 + i / 10, kwh_per_night: null, m3_per_night: null }));
rows[11] = { month: '2026-10', stays: 5, kwh_per_stay: 21.4, m3_per_stay: 0.6, kwh_per_night: 10, m3_per_night: 0.3 };
const payload = (u) => ({ ok: true, month: '2026-10-01', utility: Object.assign({ kwh_month: 412, nights_month: 22, kwh_per_night: 18.7, last_reading: null,
  per_stay: [14, 18, 12].map((v, i) => ({ checkout_date: '2026-10-0' + (i + 1), kwh_per_night: v })), brownouts: { count: 0, hours: 0 }, water_cuts: { count: 0, hours: 0 } }, u), inventory: {} });
function mountWith(data) {
  const win = { ICON: () => '', document: {} }; win.window = win; vm.runInContext(read('kpi/K_kpi.js'), vm.createContext(win));
  const L = {}, el = { innerHTML: '', addEventListener: (t, f) => { (L[t] ||= []).push(f); }, removeEventListener() {}, querySelector: () => null };
  win.K_Kpi.mount(el, { client: { rpc: () => Promise.resolve({ data, error: null }) }, role: 'cleaner', propertyId: 'p' });
  const click = async (attrs) => { const t = { getAttribute: (n) => attrs[n] ?? null, closest: () => t }; for (const f of L.click) f({ target: t }); await tick(); };
  return { win, el, click };
}

test('s111 card: 12 months, current highlighted, empty months are gaps, summary line, every bar labelled', async () => {
  const { el } = mountWith(payload({ m3_month: 13.2, m3_per_night: 0.6, per_month: rows })); await tick();
  const h = el.innerHTML, card = h.slice(h.indexOf('id="K_avg"'), h.indexOf('K_lines'));
  assert.equal((card.match(/role="img"/g) || []).length, 12);
  assert.equal((card.match(/K_bar-gap/g) || []).length, 2, 'two empty months'); assert.equal((card.match(/K_bar-cur/g) || []).length, 1);
  assert.match(card, /aria-label="Oct 2026: 21\.4 kWh per stay, 5 stays"/); assert.match(card, /aria-label="Feb 2026: no stays"/);
  assert.match(card, /This month: 21\.4 kWh and 0\.6 m³ per stay over 5 stays\./); assert.match(card, /role="tab"[^>]*data-avg="m3"/);
  assert.doesNotMatch(card, /style="height:0|!|px/);
});
test('s111 water toggle redraws in m³; water tile sits beside electricity; per-stay bars are labelled', async () => {
  const { el, click } = mountWith(payload({ m3_month: 13.2, m3_per_night: 0.6, per_month: rows })); await tick();
  assert.match(el.innerHTML, /<span class="K_lab">Water<\/span><span class="K_val">13\.2 m³<\/span><span class="K_sub">0\.6 m³ per night/);
  assert.match(el.innerHTML, /aria-label="Oct 1: 14 kWh per night"/);
  await click({ 'data-kact': 'avg', 'data-avg': 'm3' });
  assert.match(el.innerHTML, /Average per stay, water/); assert.match(el.innerHTML, /aria-label="Oct 2026: 0\.6 m³ per stay, 5 stays"/);
});
test('s111 an older server (no per_month, no m3) shows no card and no water tile; electricity-only history has no toggle', async () => {
  const old = mountWith(payload({})); await tick();
  assert.doesNotMatch(old.el.innerHTML, /K_avg|Average per stay|>Water</); assert.match(old.el.innerHTML, /412 kWh/);
  const e = mountWith(payload({ per_month: rows.map((r) => Object.assign({}, r, { m3_per_stay: null })) })); await tick();
  assert.match(e.el.innerHTML, /id="K_avg"/); assert.doesNotMatch(e.el.innerHTML, /data-avg=/);
  const q = mountWith(payload({ per_month: rows.map((r) => Object.assign({}, r, { stays: 0, kwh_per_stay: null, m3_per_stay: null })) })); await tick();
  assert.match(q.el.innerHTML, /No stay has been read this month yet\./);
});
test('s111 release pins and tokens', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.27'); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v52'/);
  const css = read('kpi/K_kpi.css'); assert.doesNotMatch(css.slice(css.indexOf('s111'), css.indexOf('.K_lines')), /#[0-9a-f]{3,6}\b|rgb\(|\d+px;?\s*}.*font|nowrap/i);
});
