// s110 (Staff 3.4.29): tier badge with stay count, weather warnings beyond rain, hourly strip with rain chance, cleaner walk-through and thank-you nudges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, NOTICES_RAW, baseHandlers, stayRow, TODAY, NOW } from './_a_harness.mjs';

// ---------------------------------------------------------------------------------------------- 1. tier badge
test('s110 CS.tierBadge: a glyph and the total stays per tier; first stay only when the data says so; unknown gives null', () => {
  const b = (g) => CS.tierBadge(g);
  assert.deepEqual(b({ tier: 'first', repeat: false, stay_count: 1 }), { tier: 'first', icon: 'sprout', word: 'First stay', count: 1, text: 'First stay' });
  assert.deepEqual(b({ tier: 'returning', stay_count: 2 }), { tier: 'returning', icon: 'repeat', word: 'Returning', count: 2, text: 'Returning · 2 stays' });
  assert.equal(b({ tier: 'regular', stay_count: 5 }).text, 'Regular · 5 stays'); assert.equal(b({ tier: 'regular', stay_count: 5 }).icon, 'sparkles');
  assert.equal(b({ tier: 'vip', stay_count: 11 }).text, 'VIP · 11 stays'); assert.equal(b({ tier: 'vip', stay_count: 11 }).icon, 'crown');
  assert.equal(b({ tier: 'vip' }).text, 'VIP', 'a known tier with no count: the word alone');
  assert.equal(b({ tier: 'returning', stay_count: 1 }).text, 'Returning · 1 stay', 'singular');
  assert.equal(b({ tier: null, repeat: false }).text, 'First stay'); assert.equal(b({ tier: null, stay_count: 1 }).text, 'First stay');
  assert.equal(b({ tier: null, repeat: true, stay_count: 3 }).text, 'Returning · 3 stays', 'no tier, a repeat flag and a count');
  assert.equal(b({ tier: null, repeat: true }).text, 'Returning');
  assert.equal(b({ tier: 'first', stay_count: 4 }).tier, 'returning', 'the count beats a stale first tier');
  for (const g of [null, undefined, {}, { tier: null }, { tier: 'gold' }, { tier: null, repeat: undefined, stay_count: 0 }]) assert.equal(b(g), null, JSON.stringify(g));
  const icons = read('icons.js'); for (const n of ['sprout', 'repeat', 'sparkles', 'crown', 'wind', 'thermo', 'haze']) assert.match(icons, new RegExp('"' + n + '":'), n + ' icon exists');
});

const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: '2026-10-13', checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 4, repeat: true, stay_count: 3, tier: 'returning', tier_line: null, notes: null, id_photo_path: null }, o || {});
const homeHtml = async (role, extra, over) => (await boot({ role, hash: '#home', handlers: baseHandlers(role, Object.assign({ staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-13', '2026-10-17')], extra) }, over || {})) })).els['v-home'].innerHTML;

test('s110 tier tag: on the Now card (once), the Up next card and the Calendar guest card, for owner and cleaner', async () => {
  const cur = GUEST({ tier: 'vip', stay_count: 11 }), nxt = GUEST({ guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', tier: null, repeat: false, stay_count: 1 });
  for (const role of ['owner', 'cleaner']) {
    const h = await homeHtml(role, { current_guest: cur, next_guest: nxt });
    assert.match(h, /aria-label="Today in the house"><button class="T_ribbon p-tier-vip" type="button" data-act="tiers-open" data-tier="vip"><svg[^>]*data-i="crown"[^>]*><\/svg><span>VIP · 11 stays<\/span><span class="sr">, open the guest tiers guide<\/span><\/button>/, role);
    assert.equal((h.match(/11 stays/g) || []).length, 1, 'the count is said once');
    assert.match(h, /T_upnext[\s\S]*?<button class="T_badge p-tier-first" type="button" data-act="tiers-open" data-tier="first"><svg[^>]*data-i="sprout"[^>]*><\/svg><span>First stay<\/span>/, role);
  }
  const cal = (await boot({ role: 'owner', hash: '#calendar/house', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-13', '2026-10-17')], { current_guest: GUEST({ tier: 'regular', stay_count: 5 }) }) }) })).els['v-calendar'].innerHTML;
  assert.match(cal, /<button class="T_badge p-tier-regular" type="button" data-act="tiers-open" data-tier="regular"><svg[^>]*data-i="sparkles"[^>]*><\/svg><span>Regular · 5 stays<\/span><span class="sr">, open the guest tiers guide<\/span><\/button>/);
  assert.equal((cal.match(/5 stays/g) || []).length, 1, 'the guest card says it once');
  const css = read('styles.css'); for (const t of ['returning', 'regular', 'vip', 'first']) assert.match(css, new RegExp('\\.T_badge\\.p-tier-' + t));
});

// ---------------------------------------------------------------------------------------------- 2. weather warnings
const FRESH = '2026-10-15T04:20:00Z', HOUR = (n, o) => Object.assign({ time: new Date(NOW.getTime() + n * 3600000).toISOString(), rain_chance_pct: 10, temp: 30, code: 2, mm: 0 }, o || {});
const WX = (cur, extra) => ({ weather: Object.assign({ fetched_at: FRESH, current: Object.assign({ temp: 29, description: 'Partly cloudy', rain_prob: 20, today_high: 32, today_low: 26 }, cur || {}) }, extra || {}) });
const kinds = (p, v) => CS.wxHazards(p, v || null, NOW).map((x) => x.kind);

test('s110 CS.wxHazards: each kind from the real fields, ordered; PAGASA bands for heat; a missing field or an old reading gives nothing', () => {
  assert.deepEqual(kinds(WX()), [], 'a plain day');
  assert.deepEqual(kinds(WX({ description: 'Thunderstorm' })), ['storm']); assert.deepEqual(kinds(WX({ code: 96 })), ['storm']);
  const soon = CS.wxHazards(WX({}, { hourly: [HOUR(2, { code: 95 })] }), null, NOW); assert.equal(soon[0].word, 'Thunderstorm possible'); assert.equal(soon[0].level, 2);
  assert.deepEqual(kinds(WX({}, { hourly: [HOUR(9, { code: 95 })] })), [], 'beyond six hours is not "soon"');
  assert.deepEqual(kinds(WX({ wind_gust_kph: 49 })), []); const w = CS.wxHazards(WX({ wind_gust_kph: 50 }), null, NOW)[0]; assert.deepEqual([w.kind, w.detail, w.strip], ['wind', 'Gusts to 50 km/h', true]);
  assert.deepEqual(kinds(WX({ description: 'Heavy rain' })), ['rain']); assert.deepEqual(kinds(WX({ code: 65 })), ['rain']); assert.deepEqual(kinds(WX({}, { hourly: [HOUR(1, { mm: 8 })] })), ['rain']); assert.deepEqual(kinds(WX({}, { hourly: [HOUR(1, { mm: 7 })] })), []);
  const heat = (f) => CS.wxHazards(WX({ feels_like: f }), null, NOW)[0];
  assert.equal(heat(32), undefined); assert.deepEqual([heat(33).level, heat(33).detail, heat(33).strip], [1, 'Feels like 33°, extreme caution', false], 'a caution stays in the Weather card');
  assert.deepEqual([heat(41).level, heat(42).level, heat(42).strip, heat(51).level, heat(52).level, heat(52).detail], [1, 2, true, 2, 3, 'Feels like 52°, extreme danger']);
  assert.deepEqual(kinds(WX({}, { aqi: 100 })), []); assert.equal(CS.wxHazards(WX({}, { aqi: 101 }), null, NOW)[0].word, 'Hazy air'); assert.equal(CS.wxHazards(WX({}, { aqi: 151 }), null, NOW)[0].word, 'Haze, poor air');
  assert.deepEqual(kinds(WX(), { weather: { fetched_at: FRESH, aqi: 130, hours: [], condition: 'Partly cloudy' } }), ['haze'], 'air quality from notices_v1 when Home has none');
  assert.deepEqual(kinds(WX(), { weather: { fetched_at: '2026-10-15T01:00:00Z', aqi: 130, hours: [], condition: 'Thunderstorm' } }), [], 'an old notices reading says nothing either');
  assert.deepEqual(kinds(WX({ uv_index: 7 })), []); assert.deepEqual(kinds(WX({ uv_index: 8 })), ['uv']); assert.deepEqual(kinds(WX({ uv_label: 'Very high' })), ['uv']); assert.equal(CS.wxHazards(WX({ uv_index: 9 }), null, NOW)[0].strip, false);
  assert.deepEqual(kinds(WX({ description: 'Thunderstorm', wind_gust_kph: 80, feels_like: 45, uv_index: 10 }, { aqi: 160 })), ['storm', 'wind', 'heat', 'haze', 'uv'], 'storm, wind, heavy rain, heat, haze, UV');
  assert.deepEqual(kinds({ weather: { fetched_at: '2026-10-15T01:00:00Z', current: { temp: 29, description: 'Thunderstorm', feels_like: 50 } } }), [], 'an old reading says nothing about the sky now');
  assert.deepEqual(kinds({ weather: null }), []); assert.deepEqual(kinds(null), []);
  assert.deepEqual(kinds({ weather: null }, { weather: { fetched_at: FRESH, condition: 'Thunderstorm', code: 95, hours: [] } }), ['storm'], 'notices_v1 alone can raise a storm');
  assert.deepEqual([heat(33).word, heat(42).word, heat(52).word], ['Hot today', 'Dangerous heat', 'Extreme heat'], 'the caution band is not called extreme');
  assert.deepEqual(CS.wxHazards(WX({ uv_index: 10 }), null, new Date('2026-10-15T13:00:00Z')).map((x) => x.kind), [], 'no UV warning at 9 pm (the fallback gives the day peak)');
  for (const x of CS.wxHazards(WX({ description: 'Thunderstorm', wind_gust_kph: 80, feels_like: 45, uv_index: 10 }, { aqi: 160 }), null, NOW)) assert.doesNotMatch(x.advice + x.word + x.detail, /!/, 'no exclamation marks');
});

test('s110 CS.wxHourly: the proxy hours (time, glyph, temperature, rain chance) over the notices hours; hours already over are dropped; a missing temperature stays null', () => {
  const rows = [HOUR(-3), HOUR(0, { rain_chance_pct: 70, code: 61, temp: 28.6 }), HOUR(1, { code: 0, temp: null }), ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => HOUR(n))];
  const h = CS.wxHourly(WX({}, { hourly: rows }), null, NOW);
  assert.equal(h.length, 12); assert.deepEqual(h[0], { label: '12 pm', pct: 70, temp: 29, icon: 'rain' }, 'the 4:00 UTC hour (12 pm) is still running at 12:30');
  assert.deepEqual([h[1].label, h[1].temp, h[1].icon], ['1 pm', null, 'sun']);
  const v = CS.A_noticesView(NOTICES_RAW({ weather: { source: 'open-meteo', fetched_at: FRESH, temp_c: 29, condition: 'Cloudy', code: 3, rain_chance_pct: 60, aqi: 40, hourly: [{ time: '2026-10-15T14:00:00+08:00', rain_chance_pct: 80, mm: 2 }, { time: '2026-10-15T20:00:00+08:00', rain_chance_pct: 5, mm: 0 }], rain_watch: null } }), 'admin', TODAY);
  const f = CS.wxHourly({ weather: { fetched_at: FRESH, current: { temp: 29 } } }, v, NOW);
  assert.deepEqual(f.map((x) => [x.label, x.pct, x.temp, x.icon]), [['2 pm', 80, null, 'rain'], ['8 pm', 5, null, 'cloud']]);
  assert.deepEqual(CS.wxHourly({ weather: null }, null, NOW), []);
});

test('s110 Today: a warning gets its own coloured row on top, the Weather card lists every warning and a sideways hourly strip with the rain chance', async () => {
  const real = Date.now(), RH = (n, o) => Object.assign(HOUR(0, o), { time: new Date(real + n * 3600000).toISOString() }); // lib.js reads the real clock when the app passes none
  const weather = Object.assign(WX({ description: 'Partly cloudy', feels_like: 44, wind_gust_kph: 55, uv_index: 9 }, { aqi: 120, hourly: [RH(0, { rain_chance_pct: 70, code: 61 }), RH(1, { rain_chance_pct: 20, temp: 31 }), RH(2)] }).weather, { fetched_at: new Date(real).toISOString() });
  const h = await homeHtml('admin', { weather });
  const bar = /<section class="U_bar F_span"[^>]*>([\s\S]*?)<\/section>/.exec(h); assert.ok(bar, 'strip drawn');
  assert.match(bar[1], /<a class="U_row U_hz U_wind" href="#weather">[\s\S]*?Strong wind[\s\S]*?Gusts to 55 km\/h/); assert.match(bar[1], /U_hz U_heat[\s\S]*?Dangerous heat[\s\S]*?Feels like 44°, danger/); assert.match(bar[1], /U_hz U_haze[\s\S]*?Hazy air/);
  assert.doesNotMatch(bar[1], /U_uv/, 'UV stays in the Weather card');
  const card = /<details class="card glass A_card W_card[\s\S]*?<\/details>/.exec(h)[0];
  assert.match(card, /<ul class="HZ_list"[\s\S]*?HZ_wind[\s\S]*?HZ_heat[\s\S]*?HZ_haze[\s\S]*?HZ_uv/); assert.match(card, / open /, 'a warning that is on the strip opens the card');
  assert.match(card, /<ul class="HF_strip" role="list" tabindex="0" aria-label="[^"]*scroll sideways">[\s\S]*?class="HF_h wet"[\s\S]*?70%[\s\S]*?31°[\s\S]*?20%/);
  assert.equal((card.match(/class="HF_h/g) || []).length, 3);
  const calm = await homeHtml('admin', { weather: Object.assign(WX().weather, { fetched_at: new Date().toISOString() }) });
  assert.doesNotMatch(calm, /U_hz|HZ_list/);
  const none = await homeHtml('admin', { weather: { fetched_at: new Date().toISOString(), current: { temp: 29, description: 'Clear' } } }); assert.doesNotMatch(none, /U_hz|HZ_list|HF_strip/, 'no extra fields: no warning, no strip');
});

test('s110 Weather screen: the chance of rain is shown on every hour, a wet hour is marked', () => {
  const w = read('weather/W_weather.js'), css = read('weather/W_weather.css');
  assert.match(w, /h\.pct != null \? h\.pct \+ '%' : '&nbsp;'/); assert.doesNotMatch(w, /h\.pct >= 20 \? h\.pct/); assert.match(css, /\.W_hr\.wet \{/);
});

// ---------------------------------------------------------------------------------------------- 4. cleaner nudges
const turnover = () => HOMEWITH([stayRow('Ana', '2026-10-12', TODAY), stayRow('Bianca Lim', TODAY, '2026-10-18')]);
const FOLD = { schema: 1, surfaces: { admin: { files: 84 }, checklist: { files: 8 }, manual: { files: 16 }, guide: { files: 48, adminGuide: true } } };

test('s110 cleaner: after check-out and before the clean, the walk-through nudge points to Slide to start (one way into the checklist); no phone, no money; admin gets none', async () => {
  const h = await homeHtml('cleaner', {}, { staff_home_v1: turnover });
  const n = /<div class="S_walk" role="note">[\s\S]*?<\/div><\/div>/.exec(h); assert.ok(n, 'the nudge is drawn in the window');
  assert.match(n[0], /Walk through first/); assert.match(n[0], /Slide to start below, then note each issue in the checklist: damage, stains, missing or broken items/);
  assert.doesNotMatch(n[0], /<a |<button/, 'no second button beside Slide to start');
  assert.doesNotMatch(n[0], /!/); assert.doesNotMatch(h, /tel:|T_call|₱|PHP/, 'a cleaner screen carries no phone and no money');
  assert.doesNotMatch(await homeHtml('admin', {}, { staff_home_v1: turnover }), /S_walk/, 'the cleaner nudge is for the staff layout');
  const day2 = await homeHtml('cleaner', {}, { staff_home_v1: () => HOMEWITH([stayRow('Ana', '2026-10-10', '2026-10-14')]) }); assert.doesNotMatch(day2, /S_walk/, 'nobody leaves today: no nudge');
  const late = await boot({ role: 'cleaner', hash: '#home', now: new Date('2026-10-15T07:30:00Z'), handlers: baseHandlers('cleaner', { staff_home_v1: turnover }) }); assert.doesNotMatch(late.els['v-home'].innerHTML, /S_walk/, 'after check-in time the window has closed');
});

const frameEl = () => { const w = { location: { replace() {} } }, a = {}; return { w, el: { contentWindow: w, style: {}, title: '', setAttribute(k, v) { a[k] = v; }, getAttribute: (k) => (k in a ? a[k] : null), removeAttribute(k) { delete a[k]; } } }; };
async function cleanDone(role, data, home) {
  const f = frameEl(), app = await boot({ role, hash: '#home', fold: FOLD, els: { 'door-frame': f.el }, handlers: baseHandlers(role, { staff_home_v1: home || turnover }) });
  app.location.hash = '#door/checklist'; for (const fn of app.winListeners.hashchange || []) fn(); await app.flush();
  for (const fn of app.winListeners.message || []) fn({ origin: 'https://staff.example', data: Object.assign({ type: 'cs-clean-done', session_id: 's-1', started_at: '2026-10-15T03:00:00Z', finished_at: '2026-10-15T04:25:00Z', issues: 0, photos: 4 }, data || {}), source: f.w });
  await app.flush(); return app.els['v-home'].innerHTML;
}

test('s110 cleaner: a warm thank-you with her first name and the arriving guest; a second line when issues were reported; no exclamation, no phone', async () => {
  const h = await cleanDone('cleaner');
  assert.match(h, /<p class="S_thanks" role="status">[\s\S]*?<span>Thank you, Ana\. The house is ready for Bianca\.<\/span><\/p>/);
  const i = await cleanDone('cleaner', { issues: 2 });
  assert.match(i, /Thank you, Ana\. The house is ready for Bianca\. Thank you also for reporting 2 issues\. It helps us look after the house\./);
  const solo = await cleanDone('cleaner', {}, () => HOMEWITH([stayRow('Ana', '2026-10-12', TODAY)]));
  assert.match(solo, /<span>Thank you, Ana\. The house is ready\.<\/span>/, 'no arriving guest: no name');
  for (const x of [h, i, solo]) { assert.doesNotMatch(/S_thanks[\s\S]*?<\/p>/.exec(x)[0], /!/); assert.doesNotMatch(x, /tel:|T_call|₱/); }
  assert.doesNotMatch(h, /S_walk/, 'once the clean is done the walk-through nudge is gone');
});

// ---------------------------------------------------------------------------------------------- 5. house rules and release
test('s110 house rules: tokens in all three theme blocks, no raw colour or px font in the s110 CSS, no new nowrap, release pins', () => {
  const tk = read('tokens.css'), css = read('styles.css'), s110 = css.slice(css.indexOf('/* ---- s110:'));
  for (const t of ['--v5-hz-haze-t', '--v5-hz-haze-w', '--v5-hz-sun-t', '--v5-hz-sun-w']) assert.equal(tk.split(t + ':').length - 1, 3, t + ' in light, media dark and data-theme dark');
  assert.doesNotMatch(s110, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'tokens only'); assert.doesNotMatch(s110, /font-size:\s*[\d.]+px/); assert.doesNotMatch(s110, /white-space:\s*nowrap/);
  assert.doesNotMatch(s110, /gap:\s*(?!0\b|4px|8px|12px|16px|24px)\S+/, 'gaps on the 4/8/12/16/24 scale');
  assert.equal(JSON.parse(read('package.json')).version, '3.4.29'); assert.match(read('app.js'), /version: '3.4.29'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v54'/);
});
