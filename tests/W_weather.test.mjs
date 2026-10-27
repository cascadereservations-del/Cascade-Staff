// Lane W (s82): the full weather screen. A small fake browser, a frozen clock, no network. Run: node --test tests/W_weather.test.mjs
// W_SRC=<path> points the same tests at a mutated copy (used to show each test red once).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.W_SRC || path.join(root, 'weather', 'W_weather.js');
const code = fs.readFileSync(SRC, 'utf8');

const NOW = Date.parse('2026-10-13T08:00:00Z');       // 16:00 Manila, outside the turnover window
const NOON = Date.parse('2026-10-13T04:20:00Z');      // 12:20 Manila, inside it
const HR = 3600000;

// A fake container: setting innerHTML to the scaffold creates named parts (data-w-part); a part counts its writes. Reading innerHTML joins the parts.
function el() {
  const e = { listeners: {}, parts: null, _h: '' };
  Object.defineProperty(e, 'innerHTML', {
    get: () => (e.parts ? Object.values(e.parts).map((p) => p.html).join('') : e._h),
    set: (v) => { e._h = String(v); e.parts = null; const names = [...e._h.matchAll(/data-w-part="(\w+)"/g)].map((m) => m[1]);
      if (names.length) { e.parts = {}; for (const n of names) { const p = { html: '', writes: 0, querySelector: () => null }; Object.defineProperty(p, 'innerHTML', { get: () => p.html, set: (x) => { p.html = String(x); p.writes++; } }); e.parts[n] = p; } } },
  });
  e.querySelector = (sel) => { const m = /data-w-part="(\w+)"/.exec(sel); return m && e.parts ? e.parts[m[1]] || null : null; };
  e.addEventListener = (t, f) => { (e.listeners[t] = e.listeners[t] || []).push(f); };
  e.removeEventListener = (t, f) => { e.listeners[t] = (e.listeners[t] || []).filter((x) => x !== f); };
  return e;
}
const tgt = (attrs) => { const t = { getAttribute: (k) => (k in attrs ? attrs[k] : null) }; t.closest = (sel) => (sel.split(',').some((s) => { const m = /^\[([\w-]+)\]$/.exec(s.trim()); return m && m[1] in attrs; }) ? t : null); return t; };
const click = async (e, attrs) => { for (const f of e.listeners.click || []) f({ target: tgt(attrs) }); await settle(); };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

// A fresh sandbox per test: frozen Date, spy storage, spy document, a fake client.
function world({ now = NOW, store = {}, invoke } = {}) {
  const clock = { t: now };
  const touched = [], calls = [], docL = {};
  const ctx = vm.createContext({
    console, Promise, JSON, Math, setTimeout, clearTimeout,
    localStorage: { getItem: (k) => { touched.push(['get', k]); return k in store ? store[k] : null; }, setItem: (k, v) => { touched.push(['set', k]); store[k] = v; }, removeItem: () => {} },
    document: { hidden: false, addEventListener: (t, f) => { docL[t] = f; }, removeEventListener: (t) => { delete docL[t]; } },
    fetch: () => { calls.push('fetch'); throw new Error('no network in tests'); },
  });
  vm.runInContext(`globalThis.Date = (function (R) { return class extends R { constructor(...a) { a.length ? super(...a) : super(globalThis.__now); } static now() { return globalThis.__now; } }; })(Date);`, ctx);
  Object.defineProperty(ctx, '__now', { get: () => clock.t, configurable: true });
  vm.runInContext(code, ctx, { filename: SRC });
  const client = { functions: { invoke: (...a) => { calls.push(a); return invoke ? invoke(...a) : Promise.resolve({ data: null, error: { message: 'offline' } }); } } };
  return { W: ctx.W_Weather, ctx, clock, touched, calls, store, docL, client };
}

const iso = (ms) => new Date(ms).toISOString();
function hourly(from, n, f = () => ({})) { return Array.from({ length: n }, (_, i) => ({ time: iso(Math.floor(from / HR) * HR + i * HR), rain_chance_pct: 10, mm: 0, code: 2, temp: 30 - (i % 4), ...f(i) })); }
function days(n, f = () => ({})) { return Array.from({ length: n }, (_, i) => ({ date: `2026-10-${13 + i}`, label: ['Today', 'Tomorrow', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'][i], high: 31 + (i % 2), low: 25, code: i === 1 ? 63 : 2, description: 'Partly cloudy', rain_prob: 20 + i * 5, feels_like_high: 36, feels_like_low: 27, wind_kph: 12, wind_gust_kph: 25, uv_index: 7, uv_label: 'High', sunrise: '5:47 AM', sunset: '5:51 PM', ...f(i) })); }
function full(now = NOW, over = {}) {
  return { source: 'pirate_weather', hourly_source: 'open_meteo', fetched_at: new Date(now - 60000).toISOString(), code: 2, aqi: 42, location: 'General Santos City, PH',
    current: { temp: 29, feels_like: 34, description: 'Partly cloudy', code: 2, is_day: true, humidity: 78, wind_kph: 14, wind_gust_kph: 28, wind_dir: 70, uv_index: 7, uv_label: 'High', pressure_mb: 1009, visibility: 9.5, sunrise: '5:47 AM', sunset: '5:51 PM', today_high: 32, today_low: 25, rain_prob: 40 },
    hourly: hourly(now, 24), forecast: days(7), rain_watch: null, ...over };
}
// what the server sent before s82: 12 hourly rows without temp, 5 days without code, no is_day
function oldPayload(now = NOW) {
  const p = full(now);
  p.hourly = hourly(now, 12).map(({ temp, ...r }) => r); p.forecast = days(5).map(({ code, ...d }) => d); delete p.current.is_day; delete p.current.code; delete p.code;
  return p;
}
const ok = (data) => () => Promise.resolve({ data, error: null });

test('the script parses and runs on its own (no DOM needed to load it)', () => {
  new vm.Script(code, { filename: SRC });
  const w = world();
  assert.equal(typeof w.W.mount, 'function'); assert.equal(typeof w.W.unmount, 'function');
});

test('mount with a full payload: every section, the server was asked for weather-proxy once, and nothing else', async () => {
  const w = world({ invoke: ok(full()) }); const e = el();
  w.W.mount(e, { client: w.client, demo: false, role: 'owner' }); await settle();
  assert.deepEqual(w.calls, [['weather-proxy']]);
  const h = e.innerHTML;
  for (const need of ['General Santos', 'as of 15:59', '29°', 'Partly cloudy', 'Feels like', 'Humidity', 'Gusts', 'Rain next 6 h', 'UV today', 'Air quality', 'Next 24 hours', '7 days', 'Sun and air', 'Live map', 'Forecast: PirateWeather', 'hourly: Open-Meteo'])
    assert.ok(h.includes(need), 'missing: ' + need);
  assert.equal((h.match(/class="W_h"/g) || []).length, 24, '24 hours');
  assert.equal((h.match(/class="W_dli"/g) || []).length, 7, '7 days');
  assert.ok(h.includes('Good'), 'AQI 42 reads Good');
  assert.ok(h.includes('from ENE'), 'wind direction word');
  assert.ok(!h.includes('<canvas') && !h.includes('<script'), 'no canvas, no script');
  assert.equal(h.includes('data-w-retry'), false);
});

test('the old 12-hour / 5-day payload still draws; sections with no data are hidden, not broken', async () => {
  const w = world({ invoke: ok(oldPayload()) }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  const h = e.innerHTML;
  assert.equal((h.match(/class="W_h"/g) || []).length, 12);
  assert.equal((h.match(/class="W_dli"/g) || []).length, 5);
  assert.ok(!h.includes('class="W_hd"'), 'no temperature column when the rows carry none');
  assert.ok(h.includes('Partly cloudy'));
  const bare = full(); delete bare.hourly; delete bare.forecast; delete bare.aqi; delete bare.rain_watch;
  const w2 = world({ invoke: ok(bare) }); const e2 = el();
  w2.W.mount(e2, { client: w2.client }); await settle();
  assert.ok(!e2.innerHTML.includes('Next 24 hours') && !e2.innerHTML.includes('>7 days<') && !e2.innerHTML.includes('Rain next 6 h') && !e2.innerHTML.includes('Air quality'));
  assert.ok(e2.innerHTML.includes('Sun and air') && e2.innerHTML.includes('Live map'));
});

test('no connection and no copy: "No connection" and "Try again", never sample rows; Try again asks again', async () => {
  const w = world(); const e = el();   // default invoke answers with an error
  w.W.mount(e, { client: w.client }); await settle();
  assert.ok(e.innerHTML.includes('No connection') && e.innerHTML.includes('Try again'));
  assert.ok(!e.innerHTML.includes('Partly cloudy') && !e.innerHTML.includes('W_dli') && !e.innerHTML.includes('Sample'));
  assert.equal(w.calls.length, 1);
  await click(e, { 'data-w-retry': '1' });
  assert.equal(w.calls.length, 2, 'Try again calls the server again');
  const w3 = world({ invoke: () => Promise.reject(new Error('Failed to fetch')) }); const e3 = el();
  w3.W.mount(e3, { client: w3.client }); await settle();
  assert.ok(e3.innerHTML.includes('No connection'), 'a thrown network error reads the same');
  const w4 = world(); const e4 = el();
  w4.W.mount(e4, { client: null }); await settle();
  assert.ok(e4.innerHTML.includes('No connection'), 'no client at all');
});

test('the last good copy shows first, then the refresh replaces it; a failed refresh keeps the copy and says so', async () => {
  const old = full(NOW - 2 * HR); old.current.temp = 27;
  let release; const slow = new Promise((r) => { release = r; });
  const w = world({ store: { cs_w_wx: JSON.stringify({ at: NOW - 2 * HR, j: old }) }, invoke: () => slow }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  assert.ok(e.innerHTML.includes('W_temp">27°'), 'the saved copy is on screen while the call is still out');
  release({ data: full(), error: null }); await settle();
  assert.ok(e.innerHTML.includes('W_temp">29°') && !e.innerHTML.includes('W_temp">27°'));
  assert.ok(w.touched.some((t) => t[0] === 'set' && t[1] === 'cs_w_wx'), 'the new answer is kept under cs_w_wx');
  assert.equal(JSON.parse(w.store.cs_w_wx).j.current.temp, 29);
  const w2 = world({ store: { cs_w_wx: JSON.stringify({ at: NOW - HR, j: full(NOW - HR) }) } }); const e2 = el();
  w2.W.mount(e2, { client: w2.client }); await settle();
  assert.ok(e2.innerHTML.includes('29°') && e2.innerHTML.includes('Could not refresh. Showing the saved forecast.'));
  assert.ok(!e2.innerHTML.includes('No connection'));
  assert.ok(!w2.touched.some((t) => t[0] !== 'get' && t[1] === 'cs_w_wx'), 'a failed refresh does not overwrite the copy');
});

test('data over 3 hours old says "offline copy"; under 3 hours it does not', async () => {
  const w = world({ store: { cs_w_wx: JSON.stringify({ at: NOW - 4 * HR, j: full(NOW - 4 * HR) }) } }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  assert.ok(e.innerHTML.includes('as of 11:59 · offline copy'), e.innerHTML.slice(0, 600));
  const w2 = world({ invoke: ok(full()) }); const e2 = el();
  w2.W.mount(e2, { client: w2.client }); await settle();
  assert.ok(!e2.innerHTML.includes('offline copy'));
  const at = (ms) => full(NOW, { fetched_at: iso(ms) });
  assert.equal(w.W.lib.parse(at(NOW - 3 * HR), NOW).offlineCopy, false, 'exactly 3 hours is not over');
  assert.equal(w.W.lib.parse(at(NOW - 3 * HR - 1000), NOW).offlineCopy, true);
});

test('demo mode: the built-in sample, no call to the server, no fetch, no storage touched', async () => {
  const w = world({ invoke: ok(full()) }); const e = el();
  w.W.mount(e, { client: null, demo: true, role: 'owner' }); await settle();
  assert.deepEqual(w.calls, [], 'no network call of any kind');
  assert.deepEqual(w.touched, [], 'no storage');
  const h = e.innerHTML;
  assert.ok(h.includes('Sample data') && h.includes('Next 24 hours') && h.includes('7 days') && h.includes('Rain watch'));
  const w2 = world({ invoke: ok(full()) }); const e2 = el();
  w2.W.mount(e2, { client: w2.client, demo: true }); await settle();
  assert.deepEqual(w2.calls, [], 'a client is ignored in demo');
  assert.ok(!e.innerHTML.includes('data-w-refresh'), 'no refresh button in demo');
});

test('the sample is built from the clock it is given, so it is never old', () => {
  const w = world(); const s = w.W.lib.sample(NOW);
  assert.ok(Date.parse(s.hourly[0].time) <= NOW && Date.parse(s.hourly[0].time) > NOW - HR);
  assert.equal(s.forecast.length, 7); assert.equal(s.hourly.length, 30);
  assert.equal(w.W.lib.parse(s, NOW).hours.length, 24);
  const later = w.W.lib.sample(NOW + 5 * 86400000); assert.ok(Date.parse(later.hourly[0].time) > Date.parse(s.hourly[0].time) + 4 * 86400000);
});

test('parse: a full payload becomes one model; junk becomes null; hours that have passed are dropped', () => {
  const w = world(); const L = w.W.lib;
  const m = L.parse(full(), NOW);
  assert.deepEqual([m.temp, m.feels, m.humidity, m.wind, m.gust, m.windDir, m.uv, m.aqi, m.pressure, m.visibility, m.hi, m.lo, m.code, m.isDay], [29, 34, 78, 14, 28, 70, 7, 42, 1009, 9.5, 32, 25, 2, true]);
  assert.equal(m.hours.length, 24); assert.equal(m.days.length, 7); assert.equal(m.days[1].code, 63);
  assert.equal(m.rain6, 10);
  for (const bad of [null, undefined, '', 'x', {}, { current: {} }, { current: { temp: 'abc' } }, 5]) assert.equal(L.parse(bad, NOW), null, JSON.stringify(bad));
  assert.equal(L.parse(JSON.stringify(full()), NOW).temp, 29, 'a JSON string is read');
  const later = L.parse(full(), NOW + 3 * HR); assert.ok(later.hours[0].ms + HR > NOW + 3 * HR);
  assert.equal(later.hours.length, 21, 'three of the 24 rows have passed');
  const o = L.parse(oldPayload(), NOW);
  assert.equal(o.hours.length, 12); assert.equal(o.hours[0].temp, null); assert.equal(o.code, 2, 'code comes from the sentence when the server sent none');
  assert.equal(o.isDay, true, 'day or night from sunrise and sunset when the server sent no flag');
  const night = L.parse(oldPayload(Date.parse('2026-10-13T14:00:00Z')), Date.parse('2026-10-13T14:00:00Z')); assert.equal(night.isDay, false);
  assert.deepEqual([L.aqiWord(50), L.aqiWord(51), L.aqiWord(151), L.aqiWord(null)], ['Good', 'Moderate', 'Poor', null]);
  assert.deepEqual([L.compass(0), L.compass(70), L.compass(359), L.compass(null)], ['N', 'ENE', 'N', '']);
  assert.deepEqual([L.group(0), L.group(2), L.group(3), L.group(63), L.group(95), L.group(45), L.group(null), L.group(2, 35, 0), L.group(2, 0, 45), L.group(63, 40, 60)], ['clear', 'partly', 'overcast', 'rain', 'storm', 'fog', 'neutral', 'windy', 'windy', 'rain']);
});

test('alert thresholds: thunder at code 95, gusts at 62 km/h, rain at 70% in the next 6 hours; one under each is calm', () => {
  const w = world(); const L = w.W.lib;
  const kinds = (p, now = NOW) => Array.from(L.alerts(L.parse(p, now), null), (a) => a.kind);
  assert.deepEqual(kinds(full()), []);
  const code = (c) => { const p = full(); p.current.code = c; return p; };
  assert.deepEqual(kinds(code(94)), []); assert.deepEqual(kinds(code(95)), ['thunder']); assert.deepEqual(kinds(code(99)), ['thunder']);
  const gust = (g) => { const p = full(); p.current.wind_gust_kph = g; return p; };
  assert.deepEqual(kinds(gust(61)), []); assert.deepEqual(kinds(gust(62)), ['gust']);
  const rain = (pct, at = 3) => full(NOW, { hourly: hourly(NOW, 24, (i) => (i === at ? { rain_chance_pct: pct } : {})) });
  assert.deepEqual(kinds(rain(69)), []); assert.deepEqual(kinds(rain(70)), ['rain']);
  assert.deepEqual(kinds(rain(95, 6)), [], 'rain 7 hours out is not "the next 6 hours"');
  assert.deepEqual(kinds(rain(95, 5)), ['rain'], 'the sixth row counts');
  const soon = full(NOW, { hourly: hourly(NOW, 24, (i) => (i === 2 ? { code: 95, rain_chance_pct: 30 } : {})) });
  assert.deepEqual(kinds(soon), ['thunder'], 'thunder in the hours ahead is a softer line');
  assert.match(L.alerts(L.parse(soon, NOW), null)[0].text, /possible in the next few hours/);
  const all = full(NOW, { hourly: hourly(NOW, 24, (i) => (i === 1 ? { rain_chance_pct: 90 } : {})) }); all.current.code = 96; all.current.wind_gust_kph = 70;
  assert.deepEqual(kinds(all), ['thunder', 'gust', 'rain']);
  for (const a of L.alerts(L.parse(all, NOW), null)) assert.ok(!a.text.includes('!') && a.text.length > 20 && a.glyph);
});

test('the practical line shows only in the turnover window (12:00 to 2:00 pm Manila) and only when rain or thunder is on the way', () => {
  const w = world(); const L = w.W.lib;
  const wet = (now) => full(now, { hourly: hourly(now, 24, (i) => (i === 1 ? { rain_chance_pct: 85 } : {})) });
  const line = 'Close the windows and bring in the laundry before the rain.';
  const texts = (p, now, ht) => Array.from(L.alerts(L.parse(p, now), ht), (a) => a.text);
  assert.ok(texts(wet(NOON), NOON).includes(line), '12:20 inside the window');
  assert.ok(!texts(wet(NOW), NOW).includes(line), '16:00 outside the window');
  const at = (hhmm) => Date.parse('2026-10-13T' + hhmm + ':00+08:00');
  assert.ok(texts(wet(at('12:00')), at('12:00')).includes(line), '12:00 is in'); assert.ok(!texts(wet(at('14:00')), at('14:00')).includes(line), '14:00 is out'); assert.ok(!texts(wet(at('11:59')), at('11:59')).includes(line));
  assert.ok(texts(wet(at('13:59')), at('13:59')).includes(line), '13:59 is still in');
  assert.ok(!texts(full(NOON), NOON).includes(line), 'dry day, no line');
  assert.ok(texts(wet(at('15:00')), at('15:00'), { check_out: '14:00', check_in: '16:00' }).includes(line), 'house times from the shell are honoured');
  assert.ok(!texts(wet(at('12:30')), at('12:30'), { check_out: '14:00', check_in: '16:00' }).includes(line));
  assert.ok(texts(wet(at('12:30')), at('12:30'), { check_out: 'x' }).includes(line), 'junk house times fall back to noon and 2 pm');
});

test('alerts and the rain watch card show on screen with a glyph word, and the watch gives its times and peak', async () => {
  const p = full(NOON, { hourly: hourly(NOON, 24, (i) => (i >= 2 && i <= 4 ? { rain_chance_pct: 80 } : {})), rain_watch: { from: iso(Math.floor(NOON / HR) * HR + 2 * HR), to: iso(Math.floor(NOON / HR) * HR + 5 * HR), peak_pct: 80 } });
  p.current.wind_gust_kph = 65;
  const w = world({ now: NOON, invoke: ok(p) }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  const h = e.innerHTML;
  assert.ok(h.includes('role="status"') && h.includes('Strong gusts of 65 km/h') && h.includes('Rain is likely in the next 6 hours (80%).'));
  assert.ok(h.includes('Close the windows and bring in the laundry before the rain.'));
  assert.ok(h.includes('Rain watch') && h.includes('From 2 pm to 5 pm, up to 80% chance.'), h.match(/Rain watch.{0,120}/)?.[0]);
  const past = full(NOON, { rain_watch: { from: iso(NOON - 5 * HR), to: iso(NOON - 2 * HR), peak_pct: 80 } });
  assert.equal(w.W.lib.parse(past, NOON).rainWatch, null, 'a watch that is over is not shown');
});

test('7 days: a row opens to feels like, wind, gusts, UV, sunrise and sunset; a second tap closes it', async () => {
  const w = world({ invoke: ok(full()) }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  assert.ok(/data-w-day="2" aria-expanded="false"/.test(e.innerHTML));
  assert.ok(/<dl class="W_more" hidden>/.test(e.innerHTML));
  await click(e, { 'data-w-day': '2' });
  assert.ok(/data-w-day="2" aria-expanded="true"/.test(e.innerHTML) && /data-w-day="0" aria-expanded="false"/.test(e.innerHTML));
  const open = e.innerHTML.split('<li class="W_dli">')[3];
  for (const need of ['Feels like', '27° to 36°', 'Wind', '12 km/h', 'Gusts', '25 km/h', 'UV', '7 · High', 'Sunrise', '5:47 AM', 'Sunset', '5:51 PM']) assert.ok(open.includes(need), need);
  assert.ok(!/<dl class="W_more" hidden>/.test(open));
  await click(e, { 'data-w-day': '2' });
  assert.ok(/data-w-day="2" aria-expanded="false"/.test(e.innerHTML));
  const bare = full(); bare.forecast = days(5, () => ({ feels_like_high: null, feels_like_low: null, wind_kph: null, wind_gust_kph: null, uv_index: null, uv_label: null, sunrise: null, sunset: null }));
  const w2 = world({ invoke: ok(bare) }); const e2 = el(); w2.W.mount(e2, { client: w2.client }); await settle();
  assert.ok(!e2.innerHTML.includes('data-w-day'), 'a row with nothing to open is not a button');
});

test('the live map loads by itself, lazily; layers switch the overlay; two-decimal house point, no pin', async () => {
  const w = world({ invoke: ok(full()) }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  assert.ok(/<iframe[^>]*loading="lazy"/.test(e.innerHTML), 'the map is there without a tap, and lazy');
  assert.ok(!e.innerHTML.includes('Load the live map'));
  for (const l of ['rain', 'wind', 'temp']) assert.ok(e.innerHTML.includes(`data-w-layer="${l}"`));
  await click(e, { 'data-w-layer': 'wind' });
  const m = /<iframe[^>]*src="([^"]+)"/.exec(e.innerHTML); assert.ok(m, 'iframe after choosing a layer');
  const u = new URL(m[1].replace(/&amp;/g, '&'));
  assert.ok(!u.searchParams.has('marker') && !u.searchParams.has('detailLat'), 'no pin');
  assert.equal(u.hostname, 'embed.windy.com'); assert.equal(u.pathname, '/embed2.html');
  assert.deepEqual([u.searchParams.get('lat'), u.searchParams.get('lon'), u.searchParams.get('overlay')], ['6.12', '125.17', 'wind']);
  await click(e, { 'data-w-layer': 'temp' });
  assert.equal(new URL(/<iframe[^>]*src="([^"]+)"/.exec(e.innerHTML)[1].replace(/&amp;/g, '&')).searchParams.get('overlay'), 'temp');
  assert.ok(/referrerpolicy="no-referrer"/.test(e.innerHTML) && /title="Live weather map/.test(e.innerHTML));
  assert.equal(w.calls.length, 1, 'the map is the only thing that leaves the page, and it is an iframe, not a call from the script');
  // The server copy lives in the waves repo; s89 moved this off a deleted s82 worktree onto the long-lived waves clone, and skips when absent (CI).
  const proxy = path.join(root, '..', 'direct-booking-waves-0-1-sol', 'supabase', 'functions', 'weather-proxy', 'index.ts');
  if (fs.existsSync(proxy)) { const server = fs.readFileSync(proxy, 'utf8'); assert.ok(server.includes('GEN_SAN_LAT    = 6.1164') && server.includes('GEN_SAN_LNG    = 125.1716')); }
});

test('return to the screen: no refetch inside 15 minutes, a refetch after; hidden pages do nothing; the clock-dependent text moves', async () => {
  const w = world({ invoke: ok(full()) }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  assert.equal(w.calls.length, 1); assert.equal(typeof w.docL.visibilitychange, 'function');
  w.clock.t = NOW + 14 * 60000; w.docL.visibilitychange(); await settle();
  assert.equal(w.calls.length, 1, '14 minutes: no new call');
  w.clock.t = NOW + 15 * 60000; w.docL.visibilitychange(); await settle();
  assert.equal(w.calls.length, 2, '15 minutes: a new call');
  w.ctx.document.hidden = true; w.clock.t = NOW + 60 * 60000; w.docL.visibilitychange(); await settle();
  assert.equal(w.calls.length, 2, 'a hidden page does nothing');
});

test('unmount: listeners are removed, a late answer is dropped without error, and mounting again starts clean', async () => {
  let release; const slow = new Promise((r) => { release = r; });
  const w = world({ invoke: () => slow }); const e = el();
  w.W.mount(e, { client: w.client }); w.W.unmount();
  assert.deepEqual(e.listeners.click, []); assert.equal(w.docL.visibilitychange, undefined);
  const before = e.innerHTML; release({ data: full(), error: null }); await settle();
  assert.equal(e.innerHTML, before, 'nothing is drawn after unmount');
  assert.equal(w.touched.some((t) => t[0] === 'set'), false, 'and nothing is stored');
  w.W.unmount();
  const e2 = el(); w.W.mount(e2, { demo: true }); await settle(); assert.ok(e2.innerHTML.includes('Next 24 hours'));
});

test('text is escaped: a hostile condition sentence cannot add markup', async () => {
  const p = full(); p.current.description = '<img src=x onerror=alert(1)>'; p.forecast[0].label = '"><b>';
  const w = world({ invoke: ok(p) }); const e = el(); w.W.mount(e, { client: w.client }); await settle();
  assert.ok(!e.innerHTML.includes('<img') && !e.innerHTML.includes('"><b>'));
});

test('no money, no contact, no key is read or written: only cs_w_wx is ever touched', async () => {
  const w = world({ invoke: ok(full()) }); const e = el(); w.W.mount(e, { client: w.client }); await settle();
  assert.deepEqual([...new Set(w.touched.map((t) => t[1]))], ['cs_w_wx']);
  assert.ok(!/payout|phone|e-?mail|messenger|income|₱/i.test(e.innerHTML));
});

test('guard: every function in the weather files carries the W_ prefix (mount and unmount are the API) and no name repeats', () => {
  const src = fs.readFileSync(path.join(root, 'weather', 'W_weather.js'), 'utf8'), names = [];
  for (const m of src.matchAll(/^  (?:function|var)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  assert.ok(names.length > 40);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'duplicate name');
  assert.deepEqual(names.filter((n) => !n.startsWith('W_') && !['mount', 'unmount', 'api'].includes(n)), [], 'unprefixed name');
  const css = fs.readFileSync(path.join(root, 'weather', 'W_weather.css'), 'utf8');
  assert.deepEqual([...css.matchAll(/(?:^|[\s,}])\.((?!W_)[a-zA-Z][\w-]*)/gm)].map((m) => m[1]).filter((c) => !['A_label', 'card', 'glass', 'chip', 'btn', 'btn-secondary', 'btn-primary', 'btn-ghost', 'help', 'sub', 'i'].includes(c)), [], 'an unprefixed class that is not a shell class');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/#000/g, '')), 'no hex colour in the stylesheet (tokens only)');
  assert.ok(!/sessionStorage|indexedDB/.test(src), 'only the one localStorage key');
  const key = [...src.matchAll(/W_KEY = '([^']+)'/g)].map((m) => m[1]); assert.deepEqual(key, ['cs_w_wx']);
});

test('the folder holds only the files this lane owns', () => {
  assert.deepEqual(fs.readdirSync(path.join(root, 'weather')).sort(), ['W_weather.css', 'W_weather.js']);
});

// ---- fix round ----
const rich = (attrs, sib) => { const t = tgt(attrs); t.setAttribute = (k, v) => { t.attrs = { ...(t.attrs || {}), [k]: v }; }; t.nextElementSibling = sib; return t; };
const clickT = async (e, t) => { for (const f of e.listeners.click || []) f({ target: t }); await settle(); };

test('fix 1: a day row opens in place (attribute and hidden flip, no markup rewrite, so focus stays); the map and alerts are not rebuilt by other redraws', async () => {
  const wet = full(NOW, { hourly: hourly(NOW, 24, (i) => (i === 1 ? { rain_chance_pct: 90 } : {})) });
  const w = world({ invoke: ok(wet) }); const e = el();
  w.W.mount(e, { client: w.client }); await settle();
  const sib = { hidden: true };
  const t = rich({ 'data-w-day': '2' }, sib), daysBefore = e.parts.days.writes;
  await clickT(e, t);
  assert.equal(e.parts.days.writes, daysBefore, 'no rewrite of the days');
  assert.deepEqual([t.attrs['aria-expanded'], sib.hidden], ['true', false]);
  await clickT(e, t); assert.deepEqual([t.attrs['aria-expanded'], sib.hidden], ['false', true]);
  await click(e, { 'data-w-day': '3' }); // a target that cannot be edited in place still works, by redraw
  assert.ok(/data-w-day="3" aria-expanded="true"/.test(e.innerHTML));
  const mapW = e.parts.map.writes, alertW = e.parts.alerts.writes; assert.ok(mapW >= 1 && alertW >= 1);
  await click(e, { 'data-w-day': '1' });
  w.clock.t = NOW + 15 * 60000; w.docL.visibilitychange(); await settle(); await click(e, { 'data-w-refresh': '1' });
  assert.ok(w.calls.length >= 3, 'refreshes happened');
  assert.equal(e.parts.map.writes, mapW, 'the map (iframe) was not rebuilt by a day toggle, a refresh or a return to the tab');
  assert.equal(e.parts.alerts.writes, alertW, 'an unchanged alert is not written again, so it is not announced again');
  await click(e, { 'data-w-layer': 'wind' });
  assert.equal(e.parts.map.writes, mapW + 1, 'only a changed layer reloads the map');
  await click(e, { 'data-w-layer': 'wind' }); assert.equal(e.parts.map.writes, mapW + 1, 'the same layer again changes nothing');
});

test('fix 2: the 24-hour strip no longer blocks vertical page scroll (no touch-action), and still scrolls sideways', () => {
  const css = fs.readFileSync(path.join(root, 'weather', 'W_weather.css'), 'utf8');
  assert.ok(!/touch-action/.test(css)); assert.ok(/\.W_strip \{[^}]*overflow-x: auto/.test(css));
});

test('fix 3: an old copy labels days against Manila today, drops days that are over, and keeps no "now" alerts', async () => {
  const L = world().W.lib;
  const old = full(NOW - 4 * HR, { forecast: days(7).map((d, i) => ({ ...d, date: `2026-10-${11 + i}` })) }); // server labels are frozen at fetch time
  const m = L.parse(old, NOW);
  assert.deepEqual(Array.from(m.days, (d) => d.label), ['Today', 'Tomorrow', 'Thu', 'Fri', 'Sat'], 'Oct 11 and 12 are over; Oct 13 is Today whatever the server said');
  assert.equal(m.days.length, 5);
  const stale = full(NOW - 4 * HR, { hourly: hourly(NOW, 24, (i) => (i === 2 ? { rain_chance_pct: 90 } : {})) }); stale.current.code = 96; stale.current.wind_gust_kph = 80;
  assert.equal(L.parse(stale, NOW).offlineCopy, true);
  assert.deepEqual(Array.from(L.alerts(L.parse(stale, NOW), null), (a) => a.kind), ['rain'], 'thunder nearby and strong gusts are not claimed from an old copy; rain still ahead is kept');
  const fresh = full(NOW, { hourly: hourly(NOW, 24, (i) => (i === 2 ? { rain_chance_pct: 90 } : {})) }); fresh.current.code = 96; fresh.current.wind_gust_kph = 80;
  assert.deepEqual(Array.from(L.alerts(L.parse(fresh, NOW), null), (a) => a.kind), ['thunder', 'gust', 'rain']);
});

test('fix 4: a call that never answers ends after the timeout: Refresh comes back, the saved copy stays with the failed-refresh line, and a late answer is ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); // s91: the 30 ms timeout fires only on tick, never during settle() on a loaded machine
  let late; const hang = new Promise((r) => { late = r; });
  const w = world({ store: { cs_w_wx: JSON.stringify({ at: NOW - HR, j: full(NOW - HR) }) }, invoke: () => hang }); const e = el();
  w.W.mount(e, { client: w.client, timeoutMs: 30 }); await settle();
  assert.ok(e.innerHTML.includes('data-w-refresh="1" disabled'), 'busy while the call is out');
  t.mock.timers.tick(30); await settle();
  assert.ok(!e.innerHTML.includes('data-w-refresh="1" disabled') && e.innerHTML.includes('data-w-refresh="1"'), 'Refresh is usable again');
  assert.ok(e.innerHTML.includes('Could not refresh. Showing the saved forecast.'));
  const before = e.innerHTML; late({ data: full(NOW + HR), error: null }); await settle();
  assert.equal(e.innerHTML, before, 'the late answer changes nothing');
  const w2 = world({ invoke: () => new Promise(() => {}) }); const e2 = el();
  w2.W.mount(e2, { client: w2.client, timeoutMs: 30 }); await settle(); t.mock.timers.tick(30); await settle();
  assert.ok(e2.innerHTML.includes('No connection') && e2.innerHTML.includes('Try again'));
});

test('fix 5: hourly icons have a text alternative; "Now" only on the current hour; "6 AM" reads like "6:00 AM"', () => {
  const w = world(); const L = w.W.lib;
  const html = L.page({ model: L.parse(full(), NOW), open: {}, layer: 'rain', mapOn: false });
  assert.ok(/class="W_h"><span class="W_ht">Now<\/span><svg[^>]*role="img" aria-label="(Partly cloudy|Clear|Cloudy)"/.test(html), html.match(/class="W_h">.{0,200}/)?.[0]);
  const next = full(NOW, { hourly: hourly(NOW + HR, 24) }); // the first row starts in the NEXT hour
  const h2 = L.page({ model: L.parse(next, NOW), open: {}, layer: 'rain', mapOn: false });
  assert.ok(!/<span class="W_ht">Now<\/span>/.test(h2) && /class="W_h"><span class="W_ht">5 pm/.test(h2));
  const dayAt = (hhmm, rise, set) => { const t = Date.parse('2026-10-13T' + hhmm + ':00+08:00'), p = oldPayload(t); p.current.sunrise = rise; p.current.sunset = set; return L.parse(p, t).isDay; };
  assert.equal(dayAt('17:30', '6 AM', '5 PM'), false, 'sunset 5 PM, read as 17:00');
  assert.equal(dayAt('05:30', '6 AM', '5 PM'), false); assert.equal(dayAt('06:30', '6 AM', '5 PM'), true);
  assert.equal(dayAt('17:30', '6:00 AM', '5:00 PM'), false);
});

test('fix 2: after a layer chip or Refresh rewrites its part, keyboard focus goes back to that control', async () => {
  const w = world({ invoke: ok(full()) }); const e = el(); const focused = [];
  const base = e.querySelector;
  e.querySelector = (sel) => (/data-w-(layer|refresh)/.test(sel) ? { disabled: /data-w-refresh/.test(sel) && w.calls.length > 1 && !e.settled, focus: () => focused.push(sel) } : base(sel));
  w.W.mount(e, { client: w.client }); await settle();
  await click(e, { 'data-w-layer': 'wind' });
  assert.deepEqual(focused, ['[data-w-layer="wind"]']);
  e.settled = true; await click(e, { 'data-w-refresh': '1' });
  assert.equal(focused[focused.length - 1], '[data-w-refresh="1"]');
  assert.equal(focused.length, 2, 'once per tap');
});

test('3.1.1: a first load that fails (error answer, thrown error, or no answer in 15 s) replaces the loading text with the plain failure line and Try again', async () => {
  const cases = [['error answer', () => Promise.resolve({ data: null, error: { message: 'FunctionsFetchError' } })], ['thrown', () => Promise.reject(new TypeError('Failed to fetch'))], ['never answers', () => new Promise(() => {})]];
  for (const [name, invoke] of cases) {
    const w = world({ invoke }); const e = el();
    w.W.mount(e, { client: w.client, timeoutMs: 30 });
    assert.ok(e.innerHTML.includes('Loading the forecast.'), name + ': loading text first');
    await new Promise((r) => setTimeout(r, 80)); await settle();
    const h = e.innerHTML;
    assert.ok(!h.includes('Loading the forecast.'), name + ': the loading text is gone');
    assert.ok(h.includes('The weather did not load. Check your connection and try again.') && h.includes('data-w-retry="1"') && h.includes('Try again'), name);
    assert.ok(!h.includes('W_dli') && !h.includes('Partly cloudy'), name + ': no sample rows');
  }
});
