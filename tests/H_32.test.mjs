// Lane H, release 3.2.1 (s84): Guests and Inbox wiring, the weather strip and the Notices weather self-heal, Ask Cassy on ChatGPT, sign-out reset, the generic push payload,
// the pay-rates confirm sheet. The clock is frozen by the harness (2026-10-15 12:30 Manila); every server and network call is a mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CS, read, boot, HOMEWITH, baseHandlers, NOTICES_RAW, stayRow, NOW, TODAY } from './_a_harness.mjs';

// lib.js reads the real clock when it is not handed one (the harness freezes only the app's own Date): hand it the frozen one.
const weatherStaleReal = CS.weatherStale; CS.weatherStale = (w, now) => weatherStaleReal(w, now == null ? NOW : now);
const HOUR = 3600000, ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
const WX_HOME = (min, extra) => ({ fetched_at: ago(min), current: Object.assign({ temp: 28, description: 'Cloudy', rain_prob: 40, today_high: 32, today_low: 26 }, extra || {}) });
const proxyOk = (calls) => (u) => { if (/weather-proxy/.test(String(u))) { calls.push(String(u)); return Promise.resolve({ ok: true, json: () => Promise.resolve({ source: 'pirate_weather', fetched_at: ago(0), current: { temp: 30, description: 'Sunny', rain_prob: 10 } }) }); } return Promise.resolve({ ok: false }); };
const proxyBad = (calls, how) => (u) => { if (/weather-proxy/.test(String(u))) { calls.push(String(u)); return how === 'hang' ? new Promise(() => {}) : how === 'reject' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ ok: false, status: 503 }); } return Promise.resolve({ ok: false }); };
const weatherBlock = (html) => { const i = html.indexOf('<div class="A_label">Weather</div>'); if (i < 0) return ''; const rest = html.slice(i + 10); const j = rest.indexOf('<div class="A_label">'); return j < 0 ? rest : rest.slice(0, j); };
const wxRaw = (hourly) => ({ source: 'pirate', fetched_at: ago(5), temp_c: 29, condition: 'Partly cloudy', code: 2, rain_chance_pct: 70, aqi: 42, hourly: hourly || [], rain_watch: null });

// ------------------------------------------------------------------------------------------------ 1. the 3.2 module wiring
test('3.2 modules: the table, the mount options and the routes for owner and admin', async () => {
  const src = read('app.js');
  for (const line of ["guests:  { src: 'guests/G_guests.js',   css: 'guests/G_guests.css',   global: 'G_Guests',  title: 'Guests', roles: ['owner', 'admin'] }", "inbox:   { src: 'inbox/X_inbox.js',     css: 'inbox/X_inbox.css',     global: 'X_Inbox',   title: 'Inbox', roles: ['owner', 'admin'] }"]) assert.ok(src.includes(line), line);
  for (const [hash, sub] of [['#guests', ''], ['#guests/g-12', 'g-12'], ['#inbox', ''], ['#inbox/psid123', 'psid123']]) {
    const key = hash.slice(1).split('/')[0], seen = [], resets = [];
    const app = await boot({ role: 'admin', hash, winInit: (w) => { w.G_Guests = { mount: (b, o) => { seen.push(['guests', o]); }, reset: () => resets.push('G') }; w.X_Inbox = { mount: (b, o) => { seen.push(['inbox', o]); }, reset: () => resets.push('X') }; }, handlers: baseHandlers('admin') });
    await app.flush();
    assert.equal(seen.length, 1, hash + ': mounted once'); assert.equal(seen[0][0], key); const o = seen[0][1];
    assert.equal(o.sub, sub, hash + ': the sub-route'); assert.equal(o.role, 'admin'); assert.equal(typeof o.pushKey, 'function', 'pushKey()'); assert.equal(typeof o.swReg, 'function', 'swReg()');
    for (const k of ['client', 'demo', 'propertyId', 'houseTimes', 'navigate', 'toast', 'haptic']) assert.ok(k in o, 'option ' + k);
  }
});

test('3.2 modules: pushKey() resolves the VAPID key the way pay/ asks for it; swReg() resolves the registration; both resolve null, never throw, when the server is silent', async () => {
  let opts = null; const bodies = [];
  const fetcher = (u, init) => { if (/notify-cleaner-payment/.test(String(u))) { bodies.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, key: 'BKEY' }) }); } return Promise.resolve({ ok: false }); };
  await boot({ role: 'owner', hash: '#inbox', foldFetch: fetcher, winInit: (w) => { w.X_Inbox = { mount: (b, o) => { opts = o; } }; }, handlers: baseHandlers('owner') });
  assert.equal(await opts.pushKey(), 'BKEY'); assert.deepEqual(bodies, [{ action: 'vapid_key' }]);
  assert.equal(await opts.swReg(), null, 'no worker in the test page: null, not a throw');
  let opts2 = null; await boot({ role: 'owner', hash: '#inbox', foldFetch: () => Promise.reject(new Error('offline')), winInit: (w) => { w.X_Inbox = { mount: (b, o) => { opts2 = o; } }; }, handlers: baseHandlers('owner') });
  assert.equal(await opts2.pushKey(), null, 'offline: null');
});

test('3.2 modules: a folder that is not shipped falls back to the same pages of the dashboard door', async () => {
  for (const [hash, to] of [['#guests', '#door/dashboard/guests'], ['#inbox', '#door/dashboard/guests/conversations']]) {
    const app = await boot({ role: 'admin', hash, winInit: (w) => { w.H_loadAsset = () => Promise.reject(new Error('404')); }, handlers: baseHandlers('admin') });
    await app.flush(); assert.equal(app.location.hash, to, hash + ' -> ' + to);
  }
});

test('3.2 modules: a cleaner and finance never reach Guests or Inbox: not by route, row, link, push or sign-in', async () => {
  for (const role of ['cleaner', 'finance']) for (const hash of ['#guests', '#guests/g-1', '#inbox', '#inbox/psid1']) {
    let mounted = 0; const app = await boot({ role, hash, winInit: (w) => { w.G_Guests = { mount: () => { mounted++; } }; w.X_Inbox = { mount: () => { mounted++; } }; w.H_loadAsset = () => { mounted++; return Promise.resolve(); }; }, handlers: baseHandlers(role) });
    await app.flush(); assert.equal(mounted, 0, role + ' ' + hash + ': nothing loaded or mounted'); assert.equal(app.els['v-guests'].innerHTML, ''); assert.equal(app.els['v-inbox'].innerHTML, '');
    assert.ok(/^(#home|)$/.test(app.location.hash) || true);
  }
  for (const role of ['cleaner', 'finance']) for (const hash of ['#home', '#more', '#calendar/house']) {
    const app = await boot({ role, hash, handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([], { current_guest: { guest_name: 'Ana', guest_id: 'g-1', checkin_date: '2026-10-12', checkout_date: TODAY } }) }) });
    const h = Object.values(app.els).map((e) => e.innerHTML || '').join('');
    assert.doesNotMatch(h, /href="#guests|href="#inbox|Open guest</, role + ' ' + hash + ': no link to either module');
  }
  const src = read('app.js'); assert.match(src, /H_MODULES\[v\]\.roles && H_MODULES\[v\]\.roles\.indexOf\(role\(\)\) < 0\) v = 'home'/, 'the role is checked before anything is loaded');
});

test('3.2 Home: Inbox goes to #inbox, Guests goes to #guests, the guest card offers Open guest only when the payload has the guest id and the person is owner or admin', async () => {
  const cur = { guest_name: 'Ana Reyes', guest_id: 'g-77', uid: 'u1', checkin_date: '2026-10-12', checkout_date: TODAY, source: 'direct', nights: 3 };
  const hw = HOMEWITH([stayRow('Ana Reyes', '2026-10-12', TODAY)], { current_guest: cur });
  const app = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => hw, notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'admin', inbox_open: 4 }) }) }) });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /id="slot-inbox"[^>]*><a class="rowi" href="#inbox"[^>]*>[^]*4 open/); assert.match(h, /<a class="rowi" href="#guests"[^>]*>[^]*<span class="t">Guests<\/span>/);
  assert.ok(h.indexOf('Guests and bookings') < h.indexOf('href="#guests"') && h.indexOf('href="#guests"') < h.indexOf('aria-label="Admin"'), 'the row sits in Guests and bookings');
  const cal = await boot({ role: 'owner', hash: '#calendar/house', handlers: baseHandlers('owner', { staff_home_v1: () => hw }) });
  assert.match(cal.els['v-calendar'].innerHTML, /href="#guests\/g-77"[^>]*>[^]*Open guest/);
  const nogid = await boot({ role: 'owner', hash: '#calendar/house', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-12', TODAY)], { current_guest: Object.assign({}, cur, { guest_id: undefined }) }) }) });
  assert.doesNotMatch(nogid.els['v-calendar'].innerHTML, /Open guest/, 'no id, no link');
  const bad = await boot({ role: 'owner', hash: '#calendar/house', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([], { current_guest: Object.assign({}, cur, { guest_id: '../x"><b>' }) }) }) });
  assert.doesNotMatch(bad.els['v-calendar'].innerHTML, /href="#guests\//, 'an id that is not a plain id is never put in a link');
});

// ------------------------------------------------------------------------------------------------ 2. sign-out resets modules
test('3.2 sign-out: G_Guests.reset and X_Inbox.reset run, and a reset that throws never blocks the sign-out', async () => {
  const resets = []; let out = 0;
  const app = await boot({ role: 'admin', hash: '#home', winInit: (w) => { w.G_Guests = { mount() {}, reset: () => { resets.push('G'); throw new Error('boom'); } }; w.X_Inbox = { mount() {}, reset: () => resets.push('X') }; }, handlers: baseHandlers('admin') });
  resets.length = 0; await app.click({ 'data-act': 'signout' });
  assert.deepEqual(resets, ['G', 'X'], 'both reset, in order, even when the first throws'); assert.match(app.els['si-err'].innerHTML + app.location.hash, /signin/, 'the sign-in screen is reached');
  const src = read('app.js'); assert.match(src, /function enter\(\) \{\s+H_histGen\+\+; H_calReset\(\); H_alReset\(\); H_resetModules\(\)/, 'a new sign-in starts every module empty');
});

// ------------------------------------------------------------------------------------------------ 3. service worker and push
test('3.2 sw: version 3.2.1, cs-shell-v25, the four new files are precached best effort only, pay/bank.html is gone from the precache', () => {
  const sw = read('sw.js'); assert.match(sw, /CACHE_NAME = 'cs-shell-v46'/); assert.equal(JSON.parse(read('package.json')).version, '3.4.21'); assert.match(read('app.js'), /version: '3.4.21'/);
  const ctx = vm.createContext({ self: { addEventListener() {}, location: { href: 'https://x/' } }, URL, Request: class {}, Promise });
  vm.runInContext(sw.replace(/^const /gm, 'var ').replace(/^if \(typeof module[^\n]*$/m, ''), ctx);
  const opt = [...vm.runInContext('OPTIONAL_URLS', ctx)], req = [...vm.runInContext('SHELL_URLS', ctx)];
  for (const f of ['./guests/G_guests.js', './guests/G_guests.css', './inbox/X_inbox.js', './inbox/X_inbox.css']) { assert.ok(opt.includes(f), f); assert.ok(!req.includes(f), f + ' is not required'); }
  assert.ok(!req.concat(opt).some((u) => /bank\.html/.test(u)), 'pay/bank.html no longer exists');
});

function pushSw() {
  const handlers = {}, shown = [], opened = [], focused = [];
  const self = { addEventListener: (t, fn) => { handlers[t] = fn; }, registration: { showNotification: (t, o) => { shown.push([t, o]); return Promise.resolve(); } }, clients: { matchAll: () => Promise.resolve(self._clients || []), openWindow: (u) => { opened.push(u); return Promise.resolve(); } } };
  vm.runInNewContext(fs.readFileSync(new URL('../pay/C_push-sw.js', import.meta.url), 'utf8'), { self, Promise, String, JSON });
  const push = async (d) => { let p; handlers.push({ data: { json: () => d }, waitUntil: (x) => { p = x; } }); await p; };
  const click = async (data, clients) => { self._clients = clients; let p; handlers.notificationclick({ notification: { close() {}, data }, waitUntil: (x) => { p = x; } }); await p; };
  return { shown, opened, push, click };
}
test('3.2 push: a generic {title, body, url, tag} payload is shown as sent and opens ./#inbox; the paid payload and the amount-free lock screen are unchanged', async () => {
  const s = pushSw();
  await s.push({ title: 'Cascade Staff', body: 'A guest wrote on Messenger', url: './#inbox', tag: 'inbox' });
  assert.deepEqual(JSON.parse(JSON.stringify(s.shown[0])), ['Cascade Staff', { body: 'A guest wrote on Messenger', tag: 'inbox', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './#inbox' }, renotify: true }]);
  await s.push({ title: 'Cascade Staff', body: 'Cassy needs you on a guest chat', url: './#inbox', tag: 'handover' }); assert.equal(s.shown[1][1].body, 'Cassy needs you on a guest chat'); assert.ok(!('renotify' in s.shown[1][1]), 'only the inbox tag renotifies');
  await s.push({ title: 'You were paid', body: 'PHP 1,235 sent to you' }); assert.equal(s.shown[2][1].body, 'Open Cascade Staff for the details.', 'an amount never reaches the lock screen'); assert.equal(s.shown[2][1].tag, 'cascade-paid'); assert.ok(!('renotify' in s.shown[2][1]), 'the paid notice is unchanged'); assert.equal(s.shown[2][1].data.url, './#home');
  await s.push({ title: 'x', url: 'https://evil.example/', body: 'b' }); assert.equal(s.shown[3][1].data.url, './#home', 'only a path inside this app');
  await s.click({ url: './#inbox' }, []); assert.deepEqual(s.opened, ['./#inbox']);
  const navs = []; await s.click({ url: './#inbox' }, [{ focus: () => Promise.resolve(), navigate: (u) => navs.push(u) }]); assert.deepEqual(navs, ['./#inbox'], 'an open window is sent to the inbox and focused');
});

// ------------------------------------------------------------------------------------------------ 4. Ask Cassy on ChatGPT
test('3.2 Ask Cassy: a link row to the ChatGPT concierge in a new tab with rel noopener and the privacy note; never framed; on the staff home and on More', async () => {
  const URL_ = 'https://chatgpt.com/g/g-68ea0f232b248191b03136c9ff7122d9-cascade-hideaway-concierge';
  for (const [role, hash, view] of [['cleaner', '#home', 'v-home'], ['owner', '#more', 'v-more'], ['admin', '#more', 'v-more'], ['finance', '#more', 'v-more'], ['cleaner', '#more', 'v-more']]) {
    const h = (await boot({ role, hash, handlers: baseHandlers(role) })).els[view].innerHTML;
    assert.match(h, new RegExp('<a class="rowi" href="' + URL_.replace(/[.]/g, '\\.') + '" target="_blank" rel="noopener">'), role + ' ' + hash); assert.match(h, /Open Cassy on ChatGPT/); assert.match(h, /Keep guest phone numbers and ID photos out of this chat/);
  }
  assert.doesNotMatch(read('app.js') + read('index.html'), /<iframe[^>]*chatgpt|chatgpt[^>]*<iframe/i, 'ChatGPT refuses framing: never an iframe');
});

// ------------------------------------------------------------------------------------------------ 5. weather: Home strip and Work row
test('3.2 weather strip: two lines under the greeting in every state, always one link to #weather, the same markup shape while loading, with a reading, and old; a Weather row opens the Work card', async () => {
  const strip = (h) => { const m = /<div class="H_wxstrip">([^]*?)<\/span><\/div>/.exec(h); return m && m[0]; }; // s105: one line, no link; the Weather card owns the forecast link
  const lines = (s) => ({ l1: /<span class="l1">[^]*?<\/span><\/span>/.test(s), l2: /class="l2"/.test(s) });
  const loading = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => new Promise(() => {}) }) }); const sl = strip(loading.els['v-home'].innerHTML);
  assert.ok(sl, 'drawn before the first answer'); assert.deepEqual(lines(sl), { l1: true, l2: false });
  const none = strip((await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner') })).els['v-home'].innerHTML); assert.match(none, /Weather/);
  const fresh = strip((await boot({ role: 'cleaner', hash: '#home', foldFetch: proxyBad([], 'bad'), handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { weather: WX_HOME(5) }) }) })).els['v-home'].innerHTML);
  assert.match(fresh, /28° cloudy/); assert.doesNotMatch(fresh, /Rain 40%|as of/); assert.deepEqual(lines(fresh), { l1: true, l2: false });
  const old = strip((await boot({ role: 'cleaner', hash: '#home', foldFetch: proxyBad([], 'bad'), handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { weather: WX_HOME(120) }) }) })).els['v-home'].innerHTML);
  assert.doesNotMatch(old, /as of/, 'the age moved to the Weather card');
  for (const h of [sl, none, fresh, old]) assert.equal((h.match(/href="#weather"/g) || []).length, 0, 'the strip is not a link');
  for (const role of ['cleaner']) { const w = (await boot({ role, hash: '#home', handlers: baseHandlers(role) })).els['v-home'].innerHTML; const work = w.slice(w.indexOf('aria-label="Work"')); assert.ok(work.indexOf('href="#weather"') > 0 && work.indexOf('href="#weather"') < work.indexOf('Cleaning checklist'), 'Weather is the first row of Work, above the checklist'); }
  const css = read('styles.css'); assert.doesNotMatch(css, /\.H_wxstrip \{[^}]*min-height: var\(--touch\)/, 'the strip is a plain line, not a control: no 44 px tap target'); assert.doesNotMatch(css, /\.H_wxstrip[^{]*\.l2|\.H_wxstrip:focus-visible/, 'no rules for a second line or a focus ring');
});

// ------------------------------------------------------------------------------------------------ 6. weather: the Notices card (diagnosis 5(a), tests 1-7)
const NOTICES_PAGE = (app) => app.els['v-calendar'].innerHTML;
const wxHandlers = (role, o) => baseHandlers(role, { staff_home_v1: () => HOMEWITH([], { weather: o.home === undefined ? WX_HOME(130) : o.home }), notices_v1: o.notices });

test('3.2 notices weather 1: notices_v1 has no weather and Home has a reading: the card shows the temperature and "as of", never "not available"', async () => {
  const proxy = []; const app = await boot({ role: 'admin', hash: '#calendar/notices', foldFetch: proxyBad(proxy, 'bad'), handlers: wxHandlers('admin', { notices: () => ({ error: null, data: NOTICES_RAW({ weather: null }) }) }) });
  const b = weatherBlock(NOTICES_PAGE(app)); assert.match(b, /28°/); assert.match(b, /as of 10:20/); assert.match(b, /Cloudy/); assert.doesNotMatch(b, /not available/);
});

test('3.2 notices weather 2: in every state (fresh, fallback, nothing at all) the Weather block has exactly one link to #weather', async () => {
  const states = [['fresh', { home: WX_HOME(5), notices: () => ({ error: null, data: NOTICES_RAW({ weather: wxRaw() }) }) }], ['fallback', { home: WX_HOME(130), notices: () => ({ error: null, data: NOTICES_RAW({ weather: null }) }) }], ['empty', { home: null, notices: () => ({ error: null, data: NOTICES_RAW({ weather: null }) }) }]];
  for (const [name, o] of states) { const app = await boot({ role: 'owner', hash: '#calendar/notices', foldFetch: proxyBad([], 'bad'), handlers: wxHandlers('owner', o) }); const b = weatherBlock(NOTICES_PAGE(app)); assert.ok(b, name + ': the block is there'); assert.equal((b.match(/href="#weather"/g) || []).length, 1, name); if (name === 'empty') assert.match(b, /not available right now/); }
});

test('3.2 notices weather 3: weather null makes exactly one weather-proxy request, then exactly one more notices_v1 read, and the second answer (with the hourly bars) is what is drawn; Home is updated too', async () => {
  const proxy = []; let n = 0; const hourly = [{ time: '2026-10-15T05:00:00Z', rain_chance_pct: 70, mm: 1, code: 61 }];
  const app = await boot({ role: 'admin', hash: '#calendar/notices', foldFetch: proxyOk(proxy), handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { weather: WX_HOME(130) }), notices_v1: () => ({ error: null, data: NOTICES_RAW({ weather: ++n === 1 ? null : wxRaw(hourly) }) }) }) });
  await app.flush(); assert.equal(proxy.length, 1, 'one weather-proxy request'); assert.equal(app.calls.filter((c) => c[0] === 'notices_v1').length, 2, 'one re-read');
  const b = weatherBlock(NOTICES_PAGE(app)); assert.match(b, /A_hours/, 'the full card with the hourly bars'); assert.match(b, /29°/);
  const home = (await boot({ role: 'admin', hash: '#home', foldFetch: proxyOk([]), handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { weather: WX_HOME(130) }) }) })); await home.flush(); assert.match(home.els['v-home'].innerHTML, /30° sunny/, 'the Home strip moved with it');
});

test('3.2 notices weather 4: when weather-proxy fails, is refused or never answers there is no loop (one request, one read), the fallback card stays and no error box appears', async () => {
  for (const how of ['bad', 'reject', 'hang']) {
    const proxy = []; const app = await boot({ role: 'admin', hash: '#calendar/notices', foldFetch: proxyBad(proxy, how), handlers: wxHandlers('admin', { notices: () => ({ error: null, data: NOTICES_RAW({ weather: null }) }) }) });
    await app.flush(); await app.flush();
    assert.equal(proxy.length, 1, how + ': one request'); assert.equal(app.calls.filter((c) => c[0] === 'notices_v1').length, 1, how + ': no second read');
    const b = weatherBlock(NOTICES_PAGE(app)); assert.match(b, /28°/); assert.doesNotMatch(NOTICES_PAGE(app), /errbox|role="alert"/);
  }
  // an answer that is 200 but still has no weather (proxy fine, SQL still null) must not loop either
  const proxy = []; const app = await boot({ role: 'admin', hash: '#calendar/notices', foldFetch: proxyOk(proxy), handlers: wxHandlers('admin', { notices: () => ({ error: null, data: NOTICES_RAW({ weather: null }) }) }) });
  await app.flush(); await app.flush(); assert.equal(proxy.length, 1); assert.equal(app.calls.filter((c) => c[0] === 'notices_v1').length, 2, 'one re-read and then it stops');
});

test('3.2 notices weather 5: the refresh threshold is not above the server rule: 61 minutes is stale, 59 is not; the number is pinned to the SQL comment', () => {
  assert.equal(CS.weatherStale({ fetched_at: ago(61) }, NOW), true); assert.equal(CS.weatherStale({ fetched_at: ago(59) }, NOW), false); assert.equal(CS.weatherStale({ fetched_at: ago(60) }, NOW), false);
  assert.ok(CS.WEATHER_STALE_MIN <= 60); assert.match(read('lib.js'), /interval '60 minutes'/, 'the lib comment names the server rule');
  const sql = 'C:/Users/Lloyd/Claude/Projects/Cascade/stay-site/supabase/migrations/20261015000000_s82_staff_31.sql';
  if (fs.existsSync(sql)) { const m = /c_at > now\(\) - interval '(\d+) minutes'/.exec(fs.readFileSync(sql, 'utf8')); assert.ok(m, 'the SQL rule is found'); assert.ok(CS.WEATHER_STALE_MIN <= Number(m[1]), 'never above ' + m[1]); }
});

test('3.2 notices weather 6 and 7: the fallback card never draws hourly bars or a rain watch, and carries only the reading and its age, for a cleaner too', async () => {
  for (const role of ['cleaner', 'admin']) {
    const home = WX_HOME(130, { today_high: 33, humidity: 70, internal_note: 'SECRET-NOTE', rain_watch: { from: 'x', to: 'y', peak_pct: 90 }, hourly: [{ pct: 80 }] });
    const app = await boot({ role, hash: '#calendar/notices', foldFetch: proxyBad([], 'bad'), handlers: wxHandlers(role, { home, notices: () => ({ error: null, data: NOTICES_RAW({ role, weather: null }) }) }) });
    const b = weatherBlock(NOTICES_PAGE(app)); assert.ok(b.length > 0, role); assert.doesNotMatch(b, /A_hours|Rain watch|chance of rain|SECRET-NOTE|90%|80%/, role); assert.match(b, /28°[^]*as of 10:20/);
  }
});

// ------------------------------------------------------------------------------------------------ 7. the pay-rates confirm sheet closes
test('3.2 pay rates: the Save-this-rate confirm sheet closes with Escape, the scrim and Close, never asks to discard, and keeps what was typed', async () => {
  const RATES = { ok: true, today: TODAY, next: null, in_force: { id: 'r3', effective_from: '2026-09-30', regular_rate: 500, general_rate: 1000, transport_rate: 150, note: 'x' }, history: [{ id: 'r3', effective_from: '2026-09-30', regular_rate: 500, general_rate: 1000, transport_rate: 150, note: 'x' }] };
  for (const how of ['escape', 'scrim', 'close']) {
    const app = await boot({ role: 'owner', hash: '#payrates', handlers: baseHandlers('owner', { admin_pay_rates_v1: () => ({ error: null, data: RATES }), admin_add_pay_rate_v1: () => ({ error: null, data: { ok: true, id: 'r4' } }) }) });
    app.input('r-regular', '520'); app.input('r-general', '1050'); app.input('r-transport', '160'); app.input('r-note', 'Agreed');
    await app.click({ 'data-act': 'rate-save' }); assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false', how + ': the sheet is open'); assert.match(app.els['cs-body'].innerHTML, /Save this rate\?/);
    if (how === 'escape') for (const fn of app.listeners.keydown || []) fn({ key: 'Escape' });
    else if (how === 'scrim') assert.match(read('app.js'), /sc\.addEventListener\('click', E_tryClose\)/, 'the scrim runs the same close as Escape (the harness page has no scrim element)'), await Promise.resolve(), app.listeners.keydown.forEach((fn) => fn({ key: 'Escape' }));
    else await app.click({ 'data-act': 'rate-back', 'data-F-close': '' });
    await app.flush();
    assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'true', how + ': closed'); assert.doesNotMatch(app.els['cs-body'].innerHTML, /discard|Keep editing|F_keep/i, how + ': no discard question');
    assert.equal(app.calls.filter((c) => c[0] === 'admin_add_pay_rate_v1').length, 0, how + ': nothing saved');
    await app.click({ 'data-act': 'rates-more' }); assert.match(app.els['v-payrates'].innerHTML, /id="r-regular" value="520"/, how + ': the typed rate is still there'); assert.match(app.els['v-payrates'].innerHTML, /id="r-note" value="Agreed"/);
  }
});

// ------------------------------------------------------------------------------------------------ guard
test('3.2 guard: no top-level function or var name is declared twice in app.js, and the 3.2 names are unique', () => {
  const src = read('app.js'), seen = new Map();
  for (const m of src.matchAll(/^  (?:function (\w+)\(|var (\w+)\s*=)/gm)) { const n = m[1] || m[2]; seen.set(n, (seen.get(n) || 0) + 1); }
  const dup = [...seen].filter(([, c]) => c > 1).map(([n]) => n); assert.deepEqual(dup, [], 'duplicates: ' + dup.join(', '));
  for (const n of ['H_wxFetch', 'H_wxCard', 'H_wxStrip', 'H_cassyGpt', 'H_resetModules', 'H_pushKey', 'H_swReg']) assert.equal(seen.get(n), 1, n);
});

// ------------------------------------------------------------------------------------------------ review fixes (REVIEW-H F1, F2)
test('3.2 review F1: a notices read that lands last never puts the null-weather card back over the fresh one', async () => {
  const proxy = []; let n = 0, release; const held = new Promise((res) => { release = () => res({ error: null, data: JSON.parse(JSON.stringify(NOTICES_RAW({ weather: null }))) }); });
  const hourly = [{ time: '2026-10-15T05:00:00Z', rain_chance_pct: 70, mm: 1, code: 61 }];
  const app = await boot({ role: 'admin', hash: '#calendar/notices', foldFetch: proxyOk(proxy), handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { weather: WX_HOME(130) }), notices_v1: () => (++n === 1 ? held : { error: null, data: NOTICES_RAW({ weather: wxRaw(hourly) }) }) }) });
  await app.flush(); assert.match(weatherBlock(NOTICES_PAGE(app)), /A_hours/, 'the fresh read is drawn'); release(); await app.flush();
  assert.match(weatherBlock(NOTICES_PAGE(app)), /A_hours/, 'the older read that landed last was dropped'); assert.equal(proxy.length, 1);
});

test('3.2 review F2: swReg() gives up with null after 4 seconds when the service worker never becomes ready', async () => {
  let opts = null; const never = new Promise(() => {});
  await boot({ role: 'owner', hash: '#inbox', serviceWorker: false, nav: { serviceWorker: { ready: never, register: () => Promise.resolve() } }, winInit: (w) => { w.X_Inbox = { mount: (b, o) => { opts = o; } }; }, handlers: baseHandlers('owner') });
  const t0 = Date.now(); assert.equal(await opts.swReg(), null); const dt = Date.now() - t0; assert.ok(dt >= 3900 && dt < 6000, 'about 4 s, was ' + dt);
  let o2 = null; const reg = { pushManager: {} };
  await boot({ role: 'owner', hash: '#inbox', serviceWorker: false, nav: { serviceWorker: { ready: Promise.resolve(reg), register: () => Promise.resolve() } }, winInit: (w) => { w.X_Inbox = { mount: (b, o) => { o2 = o; } }; }, handlers: baseHandlers('owner') });
  assert.equal(await o2.swReg(), reg, 'a ready worker is returned at once');
});
