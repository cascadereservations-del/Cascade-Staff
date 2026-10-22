// SPEC-47 (Staff 3.4.12): tier colours, important notes, asked-about line, rain row, face, key time. Pure helpers in lib.js plus the real Home render through the app harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY, NOTICES_RAW } from './_a_harness.mjs';

const pill = (tone, icon, text) => '<span class="pill p-' + tone + '">' + icon + text + '</span>';
const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: '2026-10-13', checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 4, repeat: true, stay_count: 3,
  tier: 'regular', tier_line: 'Late check-out when free', notes: '2026-08-01: Likes extra towels | Reported a damage to the kettle | Special request: extra pillows || 2026-02-10: Brought a gift', id_photo_path: null }, o || {});
const homeOf = (cur, extra) => () => HOMEWITH([stayRow('Ana Reyes', '2026-10-13', '2026-10-17')], Object.assign({ current_guest: cur }, extra || {}));
const WX = (prob) => ({ fetched_at: new Date(Date.now() - 300000).toISOString(), current: { temp: 29, description: 'Light rain', rain_prob: prob, today_high: 32, today_low: 26 } });
const html = (app) => app.els['v-home'].innerHTML;

test('parseNotes keeps the rank: 0 incident/complaint, 1 request, 4 plain', () => {
  const g = CS.parseNotes('2026-08-01: Likes extra towels | Reported a damage to the kettle | Special request: extra pillows');
  assert.deepEqual(g[0].points.map((x) => x.rank), [0, 1, 4]);
  assert.deepEqual(CS.keyNote('2026-08-01: Likes extra towels | Reported a damage to the kettle | Special request: extra pillows'), { p: 'Reported a damage to the kettle', rank: 0, word: 'Important:', more: 2 });
  assert.equal(CS.keyNote('2026-08-01: Likes extra towels'), null); assert.equal(CS.keyNote(null), null);
  assert.equal(CS.keyNote('Late check-out requested').word, 'Request:');
});

test('tierParts: one class per tier, the benefits line carries the tier, no older pill beside a chip', () => {
  for (const [t, glyph] of [['returning', 'repeat'], ['regular', 'repeat'], ['vip', 'star']]) {
    const a = CS.tierParts({ tier: t, tier_line: 'Line', repeat: true, stay_count: 2 }, true, pill);
    assert.match(a.chip, new RegExp('p-tier-' + t + '"><span>|p-tier-' + t + '">' + glyph)); assert.match(a.line, new RegExp('class="sub T_line T_' + t + '"')); assert.equal(a.ret, '');
    assert.equal(CS.tierParts({ tier: t, repeat: true, stay_count: 2 }, true, pill).ret, '', 'chip without a line: still no Returning pill');
  }
  assert.match(CS.tierParts({ tier: null, repeat: true, stay_count: 2 }, true, pill).ret, /Returning · 2nd stay/, 'no tier: the older pill stays');
});

test('notableLine: plain words, max 3, unknown topics and duplicates dropped, absent or empty is null', () => {
  const n = (...t) => ({ notable: t.map((x) => ({ topic: x, last_seen: '2026-10-14T01:00:00Z', source: 'airbnb' })) });
  assert.equal(CS.notableLine(n('directions', 'guest_count', 'brownout')), 'Asked about: directions, guest count · brownout');
  assert.equal(CS.notableLine(n('wifi', 'late_checkout')), 'Asked about: Wi-Fi, late check-out');
  assert.equal(CS.notableLine(n('wifi', 'wifi', 'bogus', 'pets', 'id', 'parking')), 'Asked about: Wi-Fi, pets · ID');
  assert.equal(CS.notableLine(n('complaint')), 'Asked about: a concern');
  assert.equal(CS.notableLine({ notable: [] }), null); assert.equal(CS.notableLine({}), null); assert.equal(CS.notableLine(null), null);
  assert.deepEqual(Object.keys(CS.TOPIC_LABELS).sort(), ['brownout', 'complaint', 'directions', 'early_checkin', 'guest_count', 'id', 'late_checkout', 'links', 'parking', 'pets', 'wifi']);
});

test('rainAlert gate: 60 percent on a fresh reading, or a rain-watch notice; not at 59, not on a stale reading', () => {
  const NOW = Date.now();
  const fresh = (p) => ({ weather: { fetched_at: new Date(NOW - 5 * 60000).toISOString(), current: { rain_prob: p, today_high: 32, today_low: 26 } } });
  assert.equal(CS.rainAlert(fresh(59), null), null); assert.equal(CS.rainAlert(fresh(null), null), null); assert.equal(CS.rainAlert(null, null), null);
  const a = CS.rainAlert(fresh(60), null); assert.equal(a.window, 'today'); assert.equal(a.hi, 32); assert.equal(a.lo, 26);
  assert.equal(CS.rainAlert({ weather: { fetched_at: new Date(NOW - 3 * 3600000).toISOString(), current: { rain_prob: 90 } } }, null), null, 'a 3 hour old reading raises nothing');
  const w = CS.rainAlert(fresh(10), { weather: { watch: { text: 'Rain watch, 2 to 5 pm', peak: 80 }, hours: [{ label: '2 pm', pct: 50 }, { label: '3 pm', pct: 80 }, { label: '4 pm', pct: 0 }] } });
  assert.equal(w.window, '2 to 5 pm'); assert.equal(w.pct, 80); assert.equal(w.peakAt, '3 pm');
  assert.equal(CS.weatherIcon('Light rain'), 'rain'); assert.equal(CS.weatherIcon('Sunny'), 'sun'); assert.equal(CS.weatherIcon('Partly cloudy'), 'cloud'); assert.equal(CS.weatherIcon(null), 'cloud');
});

test('Today card (live path): key time first, tier chip + line, important note with +N, asked-about', async () => {
  const g = GUEST({ notable: [{ topic: 'directions', last_seen: '2026-10-14T01:00:00Z', source: 'airbnb' }, { topic: 'guest_count', last_seen: '2026-10-13T01:00:00Z', source: 'messenger' }] });
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: homeOf(g) }) });
  const h = html(app);
  assert.match(h, /<p class="A_key num">Out 12:00 noon<\/p>/); assert.ok(h.indexOf('A_key') < h.indexOf('→'), 'the time comes before the dates');
  assert.doesNotMatch(h, / · out /);
  assert.match(h, /class="pill p-tier-regular"/); assert.match(h, /<p class="sub T_line T_regular">Late check-out when free<\/p>/);
  assert.match(h, /<div class="T_key note-key">[\s\S]*<b>Important:<\/b> Reported a damage to the kettle/); assert.match(h, /href="#calendar\/house">\+3 more notes<\/a>/);
  assert.match(h, /<p class="help T_ask">Asked about: directions, guest count<\/p>/);
  assert.doesNotMatch(h, /T_face/, 'no photo, no face');
  const none = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: homeOf(GUEST({ notes: null, notable: [] })) }) });
  assert.doesNotMatch(html(none), /T_ask|T_key|T_more/);
  const absent = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: homeOf(GUEST({ notes: 'Brought a gift' })) }) });
  assert.doesNotMatch(html(absent), /T_ask|T_key|T_more/, 'no notable key (SQL not live): nothing drawn; no important note: nothing drawn');
});

test('Today card: arriving guest gets In time; the face shows only with a photo and is a button for owner/admin only', async () => {
  const arriving = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { next_guest: GUEST({ checkin_date: TODAY, id_photo_path: 'g/1.jpg' }) }) }) });
  assert.match(html(arriving), /<p class="A_key num">In 2:00 pm<\/p>/);
  assert.match(html(arriving), /<button class="T_face" type="button" data-act="id-full" data-facepath="g\/1.jpg" aria-label="Show the ID photo full screen"><\/button>/);
  const cleaner = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: homeOf(GUEST({ id_photo_path: 'g/1.jpg' })) }) });
  assert.match(html(cleaner), /<span class="T_face" data-facepath="g\/1.jpg"><\/span>/); assert.doesNotMatch(html(cleaner), /<button class="T_face"/);
  const src = read('app.js');
  assert.match(src, /img\.alt = 'Guest photo from ID'/); assert.match(src, /img\.draggable = false/);
  assert.doesNotMatch(/function A_loadFaces[\s\S]*?\n  \}\n/.exec(src)[0], /download|createElement\('a'\)|share|clipboard/i, 'no new download, copy or share control');
});

test('rain row: outside the hero, only when rain is likely, words and glyph, closed by default', async () => {
  const g = GUEST();
  const wet = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: homeOf(g, { weather: WX(80) }) }) });
  const h = html(wet);
  assert.match(h, /<details class="H_wxalert"><summary data-act="wx-toggle">[\s\S]*Rain likely [^<]*· bring towels in/);
  assert.ok(h.indexOf('</div></div><details') > 0 || h.indexOf('<details') > h.indexOf('A_greet'), 'the row is a sibling after the hero, not inside it');
  assert.match(h, /class="H_wxstrip rain"/); assert.match(h, /Rain likely, 80% today/);
  assert.match(h, /High 32°, low 26°\./); assert.match(h, /href="#weather"/);
  const dry = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: homeOf(g, { weather: WX(40) }) }) });
  assert.doesNotMatch(html(dry), /H_wxalert|wxstrip rain/); assert.match(html(dry), /Rain 40% today/);
  const watch = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: homeOf(g, { weather: WX(30) }),
    notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'cleaner', weather: { source: 'open-meteo', fetched_at: new Date(Date.now() - 300000).toISOString(), temp_c: 29, condition: 'Rain', code: 61, rain_chance_pct: 70, aqi: 42, hourly: [], rain_watch: { from: '2026-10-15T14:00:00+08:00', to: '2026-10-15T17:00:00+08:00', peak_pct: 80 } } }) }) }) });
  assert.match(html(watch), /H_wxalert/, 'an active rain-watch notice raises the row even under 60 percent');
});

test('ID card and contact: no status tint on the ID card, one copy control per value, loading frame keeps 8:5', async () => {
  const src = read('app.js');
  assert.match(src, /var idcard = '<div class="card glass"><h3 class="hd">Guest ID<\/h3>/);
  assert.doesNotMatch(src, /label\.toLowerCase\(\)\) \+ '">Copy<\/button>/);
  assert.match(read('styles.css'), /\.idphoto\.empty\.err \{ aspect-ratio: 8 \/ 5/);
});

test('release: 3.4.12, cache v37, tier and key-note tokens in all three theme blocks, reduced motion covers the skeleton and the rain row', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.12'); assert.match(read('app.js'), /version: '3\.4\.12'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v37'/);
  const tk = read('tokens.css');
  for (const k of ['returning', 'regular', 'vip']) for (const s of ['t', 'w']) assert.equal(tk.split('--v5-tier-' + k + '-' + s + ':').length - 1, 3, k + s);
  assert.equal(tk.split('--v5-note-key-w:').length - 1, 3);
  assert.match(tk, /--v5-tier-vip-t: #0F1B2A; --v5-tier-vip-w: #C9A063;/); assert.match(tk, /--v5-tier-vip-t: #0F1B2A; --v5-tier-vip-w: #E0B872;/);
  const css = read('styles.css');
  assert.match(css, /animation-iteration-count: 1 !important; \} \.skel \{ animation: none;/); assert.match(css, /prefers-reduced-motion: reduce\) \{ \.H_wxalert \.H_rain \{ transition-property: opacity; \}/);
  assert.match(css, /grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 240ms var\(--v5-ease-out\)/);
  assert.doesNotMatch(css, /\n:focus-visible \{[^}]*border-radius/);
});
