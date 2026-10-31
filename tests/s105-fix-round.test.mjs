// s105 fix round: Today card layout (name, key line and ID pill beside the face), tier ribbon colours in both themes, next-arrival prep, and the review fixes in lib.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, TODAY } from './_a_harness.mjs';

const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: '2026-10-13', checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 4, repeat: true, stay_count: 3, tier: 'returning', tier_line: null, notes: null, id_photo_path: 'g/1.jpg', id_face_box: { x: 0.1, y: 0.2, w: 0.2, h: 0.4, src: 'vision' } }, o || {});
const house = async (cur, extra, role = 'admin') => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([], Object.assign({ current_guest: cur }, extra || {})) }) })).els['v-home'].innerHTML;
const plus = (n) => CS.addDays(TODAY, n);

test('layout: the name, the key day/time line and the ID pill are inside .T_id beside the face; Good to know and perks follow full width', async () => {
  const h = await house(GUEST());
  const m = /<div class="T_who"><div class="T_id">([\s\S]*?)<\/div><button class="T_face"/.exec(h); assert.ok(m, 'T_id closes right before the face');
  const id = m[1]; const a = id.indexOf('A_name'), w = id.indexOf('T_when'), p = id.indexOf('ID on file');
  assert.ok(a > 0 && a < w && w < p, 'name, then the time line, then the ID pill');
  assert.match(id, /Out.17.Oct,.12:00.noon<\/strong> · 4.nights/);
  assert.equal((h.match(/ID on file/g) || []).length, 1, 'said once');
  assert.ok(h.indexOf('T_face') < h.indexOf('T_perks'), 'perks come after the whole header');
  const none = await house(GUEST({ id_photo_path: null, id_face_box: null }));
  assert.match(/<div class="T_id">([\s\S]*?)<\/div><\/div>/.exec(none)[1], /No ID yet/);
});

test('ribbon: one colour class per tier, none for a first stay', async () => {
  for (const [t, words] of [['returning', 'Welcome back'], ['regular', 'Regular guest'], ['vip', 'VIP guest']]) {
    const h = await house(GUEST({ tier: t })); assert.match(h, new RegExp('<div class="T_ribbon p-tier-' + t + '" role="note">[\\s\\S]*?' + words));
  }
  assert.doesNotMatch(await house(GUEST({ tier: null, repeat: false })), /T_ribbon/);
});

const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test('ribbon tokens: defined in light and both dark blocks, text 4.5:1 on its own background, styles.css holds no raw colour for it', () => {
  const tk = read('tokens.css'), css = read('styles.css');
  assert.equal(tk.split('--v5-rib-returning-bg:').length - 1, 3, 'light, media dark, data-theme dark');
  for (const t of ['returning', 'regular', 'vip']) {
    const vals = [...tk.matchAll(new RegExp('--v5-rib-' + t + '-bg: (#[0-9A-F]{6}); --v5-rib-' + t + '-fg: (#[0-9A-F]{6}); --v5-rib-' + t + '-bar: (#[0-9A-F]{6});', 'g'))];
    assert.equal(vals.length, 3, t);
    for (const [, bg, fg, bar] of vals) { assert.ok(ratio(bg, fg) >= 4.5, t + ' text ' + ratio(bg, fg).toFixed(2)); assert.ok(ratio(bg, bar) >= 2.5, t + ' bar ' + ratio(bg, bar).toFixed(2)); }
    assert.match(css, new RegExp('\\.T_ribbon\\.p-tier-' + t + ' \\{ background: var\\(--v5-rib-' + t + '-bg\\); color: var\\(--v5-rib-' + t + '-fg\\); border-left-color: var\\(--v5-rib-' + t + '-bar\\); \\}'));
  }
});

test('next arrival prep: a returning, regular or VIP next guest within 2 days shows under the in-house card for every role; a first stay or a later arrival shows nothing', async () => {
  const nx = (o) => GUEST(Object.assign({ guest_name: 'Ben Cruz', checkin_date: plus(1), checkout_date: plus(3), tier: 'regular', id_photo_path: null }, o));
  const cur = GUEST({ checkin_date: plus(-1), checkout_date: plus(1), tier: null, repeat: false });
  for (const role of ['admin', 'cleaner']) {
    const h = await house(cur, { next_guest: nx() }, role);
    assert.match(h, /<div class="T_next" role="group" aria-label="Next arrival"><span class="cap up">Next arrival · Ben Cruz · tomorrow<\/span><div class="T_ribbon p-tier-regular" role="note">[\s\S]*?Regular guest/);
    assert.match(h.slice(h.indexOf('T_next')), /Prepare before arrival[\s\S]*Set saved preferences/);
  }
  assert.doesNotMatch(await house(cur, { next_guest: nx({ tier: null, repeat: false }) }), /T_next/, 'first stay');
  assert.doesNotMatch(await house(cur, { next_guest: nx({ checkin_date: plus(3), checkout_date: plus(5) }) }), /T_next/, 'three days away');
  assert.equal(CS.nextPrep({ current_guest: null, next_guest: nx() }, TODAY), null, 'nobody in the house: the Today card is already the arrival card');
});

test('goodToKnow: guest count ignores the main guest own companion row', () => {
  assert.equal(CS.goodToKnow({ guest_name: 'Ana Reyes', companions: [{ name: ' ana reyes ' }, { name: 'Ben' }] }, true).guests, 2);
  assert.equal(CS.goodToKnow({ guest_name: 'Ana Reyes', companions: [{ name: 'Ana Reyes' }] }, true).guests, null);
  assert.equal(CS.goodToKnow({ guest_name: 'Ana', companions: [{ name: 'Ben' }, { name: 'Cy' }] }, true).guests, 3);
});

test('goodToKnow: ID state prefers arrival_ready, and an unlinked stay without a photo says nothing', () => {
  const a = CS.goodToKnow({ arrival_ready: { id: true } }, true); assert.deepEqual([a.id, a.idKnown], [true, true]);
  const b = CS.goodToKnow({ guest_id: null }, false); assert.deepEqual([b.id, b.idKnown], [false, false]);
  assert.equal(CS.goodToKnow({ guest_id: 'abc' }, false).idKnown, true); assert.equal(CS.goodToKnow({}, false).idKnown, true);
});

test('wxCard watch window edges with a fixed clock: start passed and end not passed is any time, end passed is over; NaN temp is no reading', () => {
  const at = (hm) => Date.parse('2026-10-15T' + hm + ':00+08:00');
  const p = { weather: { fetched_at: new Date(at('16:50')).toISOString(), current: { temp: 29, description: 'Light rain', rain_prob: 80, today_high: 32, today_low: 26 } } };
  const v = { weather: { watch: { text: 'Rain watch, 2 to 5 pm', peak: 80 }, hours: [{ label: '3 pm', pct: 80 }] } };
  const a = CS.wxCard(p, v, at('16:59')); assert.deepEqual([a.soon, a.action], [true, 'Rain may start any time. Bring towels and mats in now.']);
  const b = CS.wxCard(p, v, at('17:01')); assert.deepEqual([b.soon, b.action], [false, '']);
  const c = CS.wxCard(p, v, at('14:00')); assert.deepEqual([c.soon, c.action], [true, 'Bring towels and mats in before 2 pm'], 'start not passed: unchanged');
  assert.equal(CS.wxCard({ weather: { current: { temp: 'abc' } } }, null), null);
});

test('Today: no weather reading draws no Weather card; a past check-out date falls back to the stay dates line', async () => {
  const h = await house(GUEST({ checkin_date: plus(-5), checkout_date: plus(-1), nights: 4 }), { weather: null });
  assert.doesNotMatch(h, /W_card|not available/); assert.doesNotMatch(h, /Out.\d+.\w+,/); assert.match(h, /<strong class="A_key">Out.12:00.noon<\/strong> · \d+.→.\d+.\w+.·.4.nights/);
});
