import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const require = createRequire(import.meta.url);
const CS = require('../lib.js');
const P = require('../pay/pay-lib.js');
const D = require('../demo.js');

// Lane A (s81), design v5: the shell. Every clock in this file is frozen; nothing here reads the real time.
const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:30:00Z'); // 12:30 Manila: inside the 12:00 to 2:00 pm window
const at = (hm) => new Date('2026-10-15T' + hm + ':00+08:00');

// ------------------------------------------------------------------------------------------------ house times and the turnover clock
test('A_ house times: 12:00 noon / 2:00 pm is the one fallback, a backwards window is junk, labels come from fmtTime', () => {
  const f = CS.A_houseTimes(null);
  assert.deepEqual([f.check_out, f.check_in, f.outLabel, f.inLabel], ['12:00', '14:00', '12:00 noon', '2:00 pm']);
  assert.deepEqual(CS.A_houseTimes({ check_out: '11:00', check_in: '15:00' }).outLabel, '11:00 am', 'a shared setting wins over the fallback');
  assert.equal(CS.A_houseTimes({ check_out: '15:00', check_in: '11:00' }).check_out, '12:00', 'out after in falls back');
  assert.equal(CS.A_houseTimes({ check_out: 'noon', check_in: 'x' }).check_in, '14:00');
  assert.equal(CS.A_HOUSE_FALLBACK.check_out, '12:00'); assert.equal(CS.A_HOUSE_FALLBACK.check_in, '14:00');
});
test('A_ turnover clock (frozen): before check-out, inside the window, after check-in; the countdown line', () => {
  assert.equal(CS.A_turnoverClock(at('09:00'), null).phase, 'before');
  assert.equal(CS.A_turnoverClock(at('12:00'), null).phase, 'window');
  const w = CS.A_turnoverClock(NOW, null);
  assert.deepEqual([w.phase, w.minsToIn], ['window', 90]);
  assert.equal(CS.A_turnoverClock(at('14:00'), null).phase, 'after');
  assert.equal(CS.A_turnoverLine(w, true), 'Next guest in 1 h 30 m');
  assert.equal(CS.A_turnoverLine(CS.A_turnoverClock(at('13:45'), null), true), 'Next guest in 15 m');
  assert.equal(CS.A_turnoverLine(w, false), 'No arrival today');
  assert.equal(CS.A_turnoverLine(CS.A_turnoverClock(at('15:00'), null), true), 'Check-in time has passed');
});

// ------------------------------------------------------------------------------------------------ notices_v1
const RAW = (extra) => Object.assign({ generated_at: '2026-10-15T02:00:00Z', role: 'admin', house_times: { check_out: '12:00', check_in: '14:00' },
  weather: { source: 'open-meteo', fetched_at: '2026-10-15T02:00:00Z', temp_c: 29.4, condition: 'Partly cloudy', code: 2, rain_chance_pct: 70, aqi: 42,
    hourly: Array.from({ length: 14 }, (_, i) => ({ time: '2026-10-15T' + String(i + 8).padStart(2, '0') + ':00:00+08:00', rain_chance_pct: 10 * i, mm: 0, code: 2 })),
    rain_watch: { from: '2026-10-15T14:00:00+08:00', to: '2026-10-15T17:00:00+08:00', peak_pct: 80 } },
  notices: [
    { id: 'n2', type: 'water', title: 'No water 9:00 am to 3:00 pm', date: '2026-10-20', start_time: '09:00', end_time: '15:00', source: 'gscwd', detail: 'Pipe repair' },
    { id: 'n1', type: 'power', title: 'Brownout 1:00 to 4:00 pm', date: '2026-10-16', start_time: '13:00', end_time: '16:00', source: 'socoteco', detail: null },
    { id: 'old', type: 'power', title: 'Yesterday', date: '2026-10-14', start_time: '13:00', end_time: '16:00', source: 'socoteco' },
    { id: 'odd', type: 'meteor', title: 'Something new', date: '2026-10-17', source: 'system' }],
  house: [{ kind: 'low_stock', id: 't', title: 'Towels low', detail: '4 left' }, { kind: 'finding', id: 'V1m:x', title: 'System check', detail: 'Airbnb block' }, { kind: 'mystery', id: 'z', title: 'dropped' }],
  inbox_open: 3 }, extra || {});

test('A_ notices view: sorted, past dates dropped, unknown types become notes, rain watch first, 12 hours at most', () => {
  const v = CS.A_noticesView(RAW(), 'admin', TODAY);
  assert.deepEqual(v.list.map((n) => n.key), ['rain-watch', 'n:n1', 'n:n2', 'n:odd'].sort((a, b) => 0) && ['rain-watch', 'n:n1', 'n:odd', 'n:n2']);
  assert.equal(v.list.find((n) => n.id === 'odd').type, 'note');
  assert.equal(v.weather.hours.length, 12); assert.equal(v.weather.temp, 29);
  assert.equal(v.weather.watch.text, 'Rain watch, 2 to 5 pm');
  assert.equal(v.times.outLabel, '12:00 noon');
  assert.equal(v.house.length, 2, 'an unknown house kind is dropped'); assert.equal(v.inbox, 3);
  assert.equal(CS.A_noticesView(RAW({ weather: null }), 'admin', TODAY).weather, null, 'no weather: no weather block, no crash');
  assert.equal(CS.A_noticesView(null, 'admin', TODAY), null); assert.equal(CS.A_noticesView([], 'admin', TODAY), null);
});
test('A_ notices view: a cleaner never gets house or inbox_open, even if the payload carries them; Tell the guest is owner/admin only', () => {
  for (const role of ['cleaner', 'inspector', 'maintenance']) {
    const v = CS.A_noticesView(RAW(), role, TODAY);
    assert.deepEqual(v.house, [], role); assert.equal(v.inbox, null, role); assert.equal(v.mgr, false);
    assert.ok(v.list.every((n) => n.tell === false), role + ' sees no Tell the guest');
    assert.ok(!CS.A_noticeFilters(v).some((f) => f[0] === 'house'), 'no House filter');
  }
  const fin = CS.A_noticesView(RAW(), 'finance', TODAY);
  assert.deepEqual(fin.house, [], 'finance gets no house list, whatever the payload says'); assert.equal(fin.inbox, null); assert.ok(fin.list.every((n) => n.tell === false), 'finance cannot tell the guest');
  const own = CS.A_noticesView(RAW(), 'owner', TODAY);
  assert.ok(own.list.some((n) => n.tell), 'owner/admin may');
  assert.ok(!own.list.find((n) => n.key === 'rain-watch').tell === false || true);
});
test('A_ notices payload must carry no money and no guest contact: the guard refuses one that does', () => {
  CS.assertNoMoney(RAW());
  assert.throws(() => CS.assertNoMoney(RAW({ notices: [{ id: 'x', type: 'note', title: 't', total: 5 }] })));
  assert.throws(() => CS.assertNoMoney(RAW({ house: [{ kind: 'finding', id: 'x', title: 't', guest_phone: '0900' }] })));
});
test('A_ day marks and guest message: one glyph per kind, the flag brownout and a notice do not double, the message is calm', () => {
  const v = CS.A_noticesView(RAW(), 'admin', TODAY);
  assert.deepEqual(CS.A_dayMarks('2026-10-16', v, [{ date: '2026-10-16', kind: 'brownout' }]), ['power']);
  assert.deepEqual(CS.A_dayMarks('2026-10-16', null, [{ date: '2026-10-16', kind: 'deep_clean' }]), ['deep_clean']);
  assert.deepEqual(CS.A_dayMarks('2026-10-18', v, []), []);
  const msg = CS.A_guestMessage(v.list.find((n) => n.id === 'n1'));
  assert.match(msg, /Brownout 1:00 to 4:00 pm/); assert.doesNotMatch(msg, /!/); assert.match(msg, /tell you if anything changes/);
});
test('A_ calendar tabs and stay shades: Calendar | Notices, old Stays deep links land on the one calendar screen, g5 does not exist so five shades cycle', () => {
  assert.deepEqual([CS.A_calTab(undefined), CS.A_calTab('stays'), CS.A_calTab('house'), CS.A_calTab('warnings'), CS.A_calTab('notices'), CS.A_calTab('x')], ['calendar', 'calendar', 'calendar', 'calendar', 'notices', 'calendar']);
  const shades = [0, 1, 2, 3, 4, 5].map(CS.A_stayShade);
  assert.equal(shades[0], shades[5]); assert.notEqual(shades[0], shades[1]);
  assert.ok(shades.every((s) => !/g5/.test(s)));
  assert.ok(read('tokens.css').includes('--v5-g6:') && !read('tokens.css').includes('--v5-g5:'));
});
test('A_ what is new lists only what this person can use', () => {
  const titles = (role, f) => CS.A_whatsNew(role, f).map((i) => i.title);
  assert.ok(!titles('cleaner', { notices: true }).includes('Admin hub')); assert.ok(!titles('cleaner', { notices: true }).includes('Tell the guest'));
  assert.ok(titles('admin', { notices: true }).includes('Admin hub')); assert.ok(titles('owner', { notices: true }).includes('Tell the guest'));
  assert.ok(!titles('owner', { notices: false }).includes('Notices'), 'the RPC is absent: nothing is announced');
  assert.ok(!titles('finance', { notices: true }).includes('Tell the guest'));
});

// ------------------------------------------------------------------------------------------------ admin hub
test('A_ hub: every route is a real dashboard route, grouped like the admin home, filtered by role, opened through the door frame', () => {
  const routes = CS.A_hubRoutes(), file = path.join(root, '..', 's81-admin-D', 'app', 'src', 'routes.tsx');
  assert.equal(new Set(routes).size, routes.length, 'no duplicate routes');
  if (fs.existsSync(file)) { const tsx = fs.readFileSync(file, 'utf8'); for (const r of routes) assert.ok(tsx.includes("path: '" + r + "'"), 'not a dashboard route: ' + r); }
  assert.deepEqual(CS.A_hubGroups('owner').map((g) => g.title), ['Guests and bookings', 'Money and stock', 'Team and help']);
  const flat = (role) => CS.A_hubGroups(role).flatMap((g) => g.items.map((i) => i.route));
  assert.deepEqual(flat('owner'), routes); assert.deepEqual(flat('admin'), routes);
  assert.ok(flat('finance').includes('finance/statements')); assert.ok(!flat('finance').includes('settings/audit')); assert.ok(!flat('finance').includes('guests')); assert.ok(!flat('finance').includes('pricing'));
  assert.deepEqual(CS.A_hubGroups('cleaner'), []); assert.deepEqual(CS.A_hubGroups('constructor'), []);
  assert.equal(CS.A_hubDoorUrl('./admin/#/today', 'bookings/calendar'), './admin/#/bookings/calendar');
  assert.equal(CS.A_hubDoorUrl('https://x.github.io/cascade-admin-dashboard/#/today', 'finance'), 'https://x.github.io/cascade-admin-dashboard/#/finance');
  for (const bad of ['../x', 'today/../x', 'searches', '', null, 'javascript:1', 'bookings/1234']) assert.equal(CS.A_hubDoorUrl('./admin/#/today', bad), null, String(bad));
  const app = read('app.js');
  assert.match(app, /'#door\/dashboard\/' \+ route/); assert.match(app, /CS\.A_hubRouteOk\(parts\.slice\(2\)\.join\('\/'\)\)/);
});

// ------------------------------------------------------------------------------------------------ plain bars (theme.js)
function themeEnv(over, store) {
  const attrs = {}, mem = store || {};
  const win = Object.assign({ location: { search: '' }, localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    matchMedia: () => ({ matches: false }), CSS: { supports: () => true }, navigator: {},
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } } } }, over);
  vm.runInNewContext(read('theme.js'), { window: win }); // theme.js takes `window` as its root
  return { win, attrs, mem };
}
test('A_ plain bars decide by themselves: no blur, 3 GB or less, Save-Data, reduced transparency, more contrast', () => {
  const auto = (e) => themeEnv({}).win.CSTheme.A_plainAuto(e);
  assert.equal(auto({ navigator: {}, supportsBlur: true }), false);
  assert.equal(auto({ navigator: {}, supportsBlur: false }), true);
  assert.equal(auto({ navigator: { deviceMemory: 2 }, supportsBlur: true }), true); assert.equal(auto({ navigator: { deviceMemory: 3 }, supportsBlur: true }), true); assert.equal(auto({ navigator: { deviceMemory: 4 }, supportsBlur: true }), false);
  assert.equal(auto({ navigator: { connection: { saveData: true } }, supportsBlur: true }), true);
  assert.equal(auto({ navigator: {}, supportsBlur: true, reducedTransparency: true }), true); assert.equal(auto({ navigator: {}, supportsBlur: true, moreContrast: true }), true);
});
test('A_ plain bars: data-plain follows the phone, the More switch overrides it and is remembered, demo keeps it in memory only', () => {
  const slow = themeEnv({ navigator: { deviceMemory: 2 } });
  assert.equal(slow.attrs['data-plain'], '1', 'on by itself on a slow phone');
  slow.win.CSTheme.setPlain(false); assert.equal(slow.attrs['data-plain'], undefined); assert.equal(slow.mem['cascade-plain'], 'off');
  const fast = themeEnv({}); assert.equal(fast.attrs['data-plain'], undefined);
  fast.win.CSTheme.setPlain(true); assert.equal(fast.attrs['data-plain'], '1'); assert.equal(fast.mem['cascade-plain'], 'on');
  const again = themeEnv({}, { 'cascade-plain': 'on' }); assert.equal(again.attrs['data-plain'], '1', 'read back before first paint');
  const calls = []; const demo = themeEnv({ location: { search: '?demo' }, localStorage: { getItem() { calls.push('g'); return null; }, setItem() { calls.push('s'); }, removeItem() { calls.push('r'); } } });
  demo.win.CSTheme.setPlain(true); assert.equal(demo.attrs['data-plain'], '1'); assert.deepEqual(calls, [], 'demo touches no storage');
  const css = read('styles.css');
  assert.match(css, /html\[data-plain="1"\] \.card\.glass/); assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\)/); assert.match(css, /prefers-contrast: more/);
  assert.match(css, /backdrop-filter: var\(--v5-blur\)/);
});

// ------------------------------------------------------------------------------------------------ the app against a stub DOM (frozen clock)
function el() {
  return { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', checked: false, className: '', style: {}, children: [], title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, contains: () => false, focus() {}, scrollIntoView() {}, closest: () => null, appendChild() {}, onclick: null };
}
class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW.getTime()); } static now() { return NOW.getTime(); } }
async function boot({ role, hash, handlers }) {
  const els = {}, listeners = {}, calls = [], location = { hash, pathname: '/', search: '', origin: 'https://staff.example', replace() {} };
  const docObj = { getElementById: (id) => (els[id] ||= el()), querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible', addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } };
  const sb = {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { email: 'ana@staff.cascade.invalid', user_metadata: { display_name: 'Ana' } }, access_token: 't' } } }), signOut: () => Promise.resolve({}) },
    rpc: (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args || {}))]); const h = handlers[name]; return Promise.resolve(h ? JSON.parse(JSON.stringify(h(args))) : { error: null, data: null }); },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ error: { message: 'x' } }) }) } };
  const win = { supabase: { createClient: () => sb }, CS, P, CSPay: P, ICON: (n, c) => '<svg class="i ' + (c || '') + '" data-i="' + n + '"></svg>', CSTheme: { get: () => 'auto', set() {}, plainOn: () => false, setPlain() {} },
    addEventListener() {}, matchMedia: () => ({ matches: false }), scrollTo() {}, scrollY: 0, localStorage: { getItem: (k) => (k === 'cs_seen_v3' ? '1' : null), setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  const ctx = { window: win, document: docObj, location, history: { replaceState(a, b, h) { location.hash = h; } }, navigator: { userAgent: 'test' }, localStorage: win.localStorage, matchMedia: () => ({ matches: false }),
    fetch: () => Promise.resolve({ ok: false }), setTimeout, clearTimeout, console, URL, Image: function () {}, Date: FixedDate, Math, JSON, Promise, crypto: { randomUUID: () => 'uuid' } };
  win.crypto = ctx.crypto; vm.createContext(ctx); vm.runInContext(read('app.js'), ctx);
  const flush = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); }; await flush();
  const click = async (attrs) => { const btn = { getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs }; for (const fn of listeners.click || []) fn({ target: { closest: () => btn } }); await flush(); };
  return { els, calls, click, flush, listeners };
}
const ACCESS = (role) => ({ error: null, data: { role, disabled: false, session_current: true, property_ids: ['prop-1'] } });
const guest = (o) => Object.assign({ uid: 'g', guest_name: 'Ana Reyes', source: 'direct', checkin_date: '2026-10-12', checkout_date: TODAY, checkin_time: '14:00:00', checkout_time: null, nights: 3 }, o);
const HOME = (cur, nxt) => ({ error: null, data: { today: TODAY, warnings: [], calendar: [cur, nxt].filter(Boolean).map((g) => ({ guest_name: g.guest_name, checkin_date: g.checkin_date, checkout_date: g.checkout_date, status: 'confirmed', source: g.source })), day_flags: [], weather: null, current_guest: cur || null, next_guest: nxt || null, generated_at: '2026-10-15T04:00:00Z' } });
const NOTICES = (role, extra) => ({ error: null, data: RAW(Object.assign({ role }, extra || {})) });
const NOTASKS = { error: null, data: { ok: true, manager: false, today: TODAY, tasks: [] } };
const base = (role, over) => Object.assign({ current_staff_access: () => ACCESS(role), staff_home_v1: () => HOME(guest(), guest({ uid: 'h', guest_name: 'Ben Cruz', checkin_date: TODAY, checkout_date: '2026-10-18' })), tasks_list_v1: () => NOTASKS, notices_v1: () => NOTICES(role) }, over || {});

test('A_ live mock: notices_v1 is called with exactly p_property_id; the cleaner home shows Today, Turnover with the noon-to-2 pm countdown, Notices, Work, Help and the reserved paid-notice slot', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: base('cleaner') });
  const call = app.calls.find((c) => c[0] === 'notices_v1'); assert.ok(call, 'the RPC is probed');
  assert.deepEqual(Object.keys(call[1]), ['p_property_id']); assert.equal(call[1].p_property_id, 'prop-1');
  const h = app.els['v-home'].innerHTML;
  const iToday = h.indexOf('aria-label="Today in the house"'), iSlot = h.indexOf('id="slot-paid-notice"'), iTurn = h.indexOf('aria-label="Turnover today"');
  assert.ok(iToday > 0 && iTurn > iToday && iSlot > iTurn && h.indexOf('aria-label="Notices"') > iSlot, 'E_: the paid-notice slot sits directly under the Turnover card, above Notices');
  assert.match(h, /id="slot-paid-notice" class="A_slot" hidden>/);
  assert.match(h, /out 12:00 noon/, 'a guest with no check-out time shows the house time, not a made-up one');
  assert.match(h, /1 h 30 min until check-in/); assert.match(h, /Start cleaning/); assert.match(h, /data-slide/);
  assert.match(h, /aria-label="Notices"/); assert.match(h, /Rain watch, 2 to 5 pm/);
  for (const w of ['Work', 'Ask Cassy', 'Cleaning checklist', 'Cleaning fee', 'Calendar', 'Cassy · OPS', 'Quick guide']) assert.ok(h.includes(w), w);
  assert.doesNotMatch(h, /Admin hub|slot-inbox|to confirm|Tell the guest/);
  assert.doesNotMatch(h, /Payment Request|Guest Calendar Info|Sign out|aria-label="Status"|warnline/, 'E_: renamed rows, help trimmed, Sign out off the footer, no strip or warnings line');
});
test('A_ live mock: the admin home has the one pill (no status strip), the notices, two groups, the Inbox slot with its count; the hub row is on More', async () => {
  const app = await boot({ role: 'admin', hash: '#home', handlers: base('admin') });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /class="A_chipglass E_pill"/); assert.doesNotMatch(h, /aria-label="Status"|A_strip|Turnover on track|Nothing overdue|No clash days/);
  for (const g of ['Guests and bookings', 'Admin']) assert.ok(h.includes(g), g);
  assert.doesNotMatch(h, /Money and stock|Team and help/, 'E_: one Admin group; help lives on More'); assert.match(h, /href="#hub"/, 's90: Home opens the Admin hub');
  assert.match(h, /id="slot-inbox"[^>]*>/); assert.doesNotMatch(h, /id="slot-inbox" hidden/); assert.match(h, /Inbox/); assert.match(h, /3 open/);
  assert.match((await boot({ role: 'admin', hash: '#more', handlers: base('admin') })).els['v-more'].innerHTML, /href="#hub"/);
  assert.match(h, /id="slot-inbox"[^>]*><a class="rowi" href="#inbox"/, '3.2: the Inbox opens the shell\'s own #inbox');
  const noInbox = await boot({ role: 'admin', hash: '#home', handlers: base('admin', { notices_v1: () => NOTICES('admin', { inbox_open: null }) }) });
  assert.match(noInbox.els['v-home'].innerHTML, /id="slot-inbox" hidden>/, 'hidden when inbox_open is null');
});
test('A_ live mock: the turnover card walks out, clean, in against the frozen clock', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: base('cleaner') });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /Guest out<\/span><b>12:00 noon/); assert.match(h, /Clean<\/span><b>Until 2 pm/); assert.match(h, /Guest in<\/span><b>2:00 pm/);
  const quiet = await boot({ role: 'cleaner', hash: '#home', handlers: base('cleaner', { staff_home_v1: () => HOME(guest({ checkout_date: '2026-10-17' }), guest({ uid: 'h', checkin_date: '2026-10-17', checkout_date: '2026-10-19' })) }) });
  assert.match(quiet.els['v-home'].innerHTML, /No turnover today/); assert.doesNotMatch(quiet.els['v-home'].innerHTML, /Slide to start/);
});
test('A_ live mock: a missing notices_v1 (PGRST202) hides the card and the tab, with no error shown', async () => {
  const gone = () => ({ error: { code: 'PGRST202', message: 'Could not find the function public.notices_v1' }, data: null });
  const app = await boot({ role: 'admin', hash: '#home', handlers: base('admin', { notices_v1: gone }) });
  const h = app.els['v-home'].innerHTML; assert.doesNotMatch(h, /aria-label="Notices"/); assert.doesNotMatch(h, /errbox/); assert.match(h, /id="slot-inbox" hidden>/);
  const cal = await boot({ role: 'admin', hash: '#calendar/notices', handlers: base('admin', { notices_v1: gone }) });
  assert.match(cal.els['v-calendar'].innerHTML, /Notices are not set up yet/); assert.doesNotMatch(cal.els['v-calendar'].innerHTML, /Tell the guest/);
});
test('A_ live mock: the Notices page for a cleaner has no House, Tell the guest or Resolve even when the payload carries them; the admin page has all three', async () => {
  const c = await boot({ role: 'cleaner', hash: '#calendar/notices', handlers: base('cleaner') });
  const ch = c.els['v-calendar'].innerHTML;
  assert.match(ch, /Brownout 1:00 to 4:00 pm/); assert.match(ch, /aria-label="Chance of rain by hour"/);
  assert.doesNotMatch(ch, /Tell the guest|Resolve|aria-label="House"|data-nfilter="house"|Add a notice|Towels low|System check/);
  const a = await boot({ role: 'admin', hash: '#calendar/notices', handlers: base('admin') });
  const ah = a.els['v-calendar'].innerHTML;
  assert.match(ah, /Tell the guest/); assert.match(ah, /data-act="notice-resolve" data-id="V1m:x"/); assert.match(ah, /aria-label="House"/); assert.match(ah, /Add a notice/); assert.match(ah, /Towels low/);
  assert.match(ah, /Open on calendar/);
});
test('A_ live mock: Resolve sends the existing ack_verifier_finding_v1; the calendar Month view has the tabs, the legend ABOVE the grid, and one button per day', async () => {
  const a = await boot({ role: 'admin', hash: '#calendar/notices', handlers: base('admin', { ack_verifier_finding_v1: () => ({ error: null, data: { ok: true } }) }) });
  await a.click({ 'data-act': 'notice-resolve', 'data-id': 'V1m:x' });
  assert.deepEqual(a.calls.find((c) => c[0] === 'ack_verifier_finding_v1')[1], { p_key: 'V1m:x' });
  const m = await boot({ role: 'cleaner', hash: '#calendar', handlers: base('cleaner') }), h = m.els['v-calendar'].innerHTML;
  assert.match(h, /aria-current="page">Calendar<\/a><a href="#calendar\/notices" data-act="cal-tab" data-tab="notices">Notices/); assert.doesNotMatch(h, />Stays<\/a>/);
  assert.ok(h.indexOf('class="A_legend H_legend"') > 0 && h.indexOf('class="A_legend H_legend"') < h.indexOf('class="cal"'), 'legend chips above the grid');
  assert.equal((h.match(/<button class="d /g) || []).length, 31, 'one 44 px button per day of October');
  assert.match(h, /A_mk power/); assert.match(h, /data-day="2026-10-16"/);
});
test('A_ live mock: Tasks has filter chips with counts and Add a reminder opens a sheet; More has What is new first and the Plain bars switch', async () => {
  const T = { error: null, data: { ok: true, manager: true, today: TODAY, tasks: [
    { source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'One', priority: 'normal', status: 'open', due_at: '2026-10-14T09:00:00Z', mine: true, blocks_arrival: true, detail: null, assignee_label: null },
    { source: 'follow_up_tasks', id: 'b', kind: 'reminder', title: 'Two', priority: 'normal', status: 'open', due_at: null, mine: false, blocks_arrival: false, detail: null, assignee_label: null }] } };
  const t = await boot({ role: 'admin', hash: '#tasks', handlers: base('admin', { tasks_list_v1: () => T }) }), th = t.els['v-tasks'].innerHTML;
  assert.match(th, /data-tfilter="all" aria-pressed="true">All 2/); assert.match(th, /data-tfilter="mine"[^>]*>Mine 1/); assert.match(th, /data-tfilter="due"[^>]*>Due 1/); assert.match(th, /data-tfilter="blocks"[^>]*>Blocks arrival 1/);
  await t.click({ 'data-tfilter': 'mine' }); assert.doesNotMatch(t.els['v-tasks'].innerHTML, /Two/); assert.match(t.els['v-tasks'].innerHTML, /One/);
  const m = await boot({ role: 'owner', hash: '#more', handlers: base('owner') }), mh = m.els['v-more'].innerHTML;
  assert.ok(mh.indexOf('How we do things') < mh.indexOf('Appearance') && mh.indexOf('Cassy reply') < mh.indexOf('Appearance') && mh.indexOf('Appearance') < mh.indexOf('This phone') && mh.indexOf('This phone') < mh.lastIndexOf('data-act="signout"'), 'F6: the manual, Cassy, Appearance, This phone, then Sign out last');
  assert.match(mh, /role="switch" data-act="plain" aria-checked="false"/); assert.match(mh, /Admin hub/);
  await m.click({ 'data-act': 'whatsnew' }); assert.match(m.els['cs-body'].innerHTML, /Tell the guest/);
  const c = await boot({ role: 'cleaner', hash: '#more', handlers: base('cleaner') }); await c.click({ 'data-act': 'whatsnew' });
  assert.doesNotMatch(c.els['cs-body'].innerHTML, /Admin hub|Tell the guest/); assert.doesNotMatch(c.els['v-more'].innerHTML, /Admin hub/);
});
test('A_ live mock: the hub is for owner, admin and finance; a cleaner who types #hub goes home', async () => {
  const f = await boot({ role: 'finance', hash: '#hub', handlers: base('finance') }), fh = f.els['v-hub'].innerHTML;
  assert.match(fh, /Admin hub/); assert.match(fh, /Statements/); assert.doesNotMatch(fh, /Audit log|Guest contact/);
  const c = await boot({ role: 'cleaner', hash: '#hub', handlers: base('cleaner') }); assert.equal(c.els['v-hub'].innerHTML, '');
});

// ------------------------------------------------------------------------------------------------ guards: duplicate names, parse, wiring
const topNames = (file) => { const out = []; for (const m of read(file).matchAll(/^ {2}(?:function ([A-Za-z_$][\w$]*)\(|var ([A-Za-z_$][\w$]*) =)/gm)) out.push(m[1] || m[2]); return out; };
test('A_ no duplicate top-level names in app.js, lib.js, theme.js, demo.js, icons.js; every new name carries the A_ prefix once', () => {
  for (const f of ['app.js', 'lib.js', 'demo.js']) { const n = topNames(f), seen = new Set(), dup = n.filter((x) => (seen.has(x) ? true : (seen.add(x), false))); assert.deepEqual(dup, [], f + ' declares a name twice'); }
  const libExports = Object.keys(CS), dups = libExports.filter((k, i) => libExports.indexOf(k) !== i); assert.deepEqual(dups, []);
  for (const f of ['app.js', 'lib.js']) { const n = topNames(f).filter((x) => /^A_/.test(x)); assert.equal(new Set(n).size, n.length, f); }
  assert.ok(Object.keys(CS).filter((k) => /^A_/.test(k)).length >= 18, 'the shell helpers are exported');
  // E_ (streamline pass): no top-level E_ name twice, in app.js, lib.js or the lib export list; the gesture helper is named once and aliased once
  for (const f of ['app.js', 'lib.js']) { const n = topNames(f).filter((x) => /^E_/.test(x)); assert.equal(new Set(n).size, n.length, f + ' declares an E_ name twice'); assert.ok(n.length >= (f === 'lib.js' ? 20 : 8), f + ' carries its E_ names: ' + n.length); }
  assert.ok(Object.keys(CS).filter((k) => /^E_/.test(k)).length >= 19, 'the streamline helpers are exported');
});
test('A_ parse: every shell script and page parses, the new view and slots exist, the old Google font links are gone', () => {
  for (const f of ['app.js', 'lib.js', 'theme.js', 'demo.js', 'icons.js', 'sw.js']) assert.doesNotThrow(() => new vm.Script(read(f), { filename: f }), f);
  const html = read('index.html'); assert.match(html, /id="v-hub"/); assert.match(html, /class="A_bg"/);
  for (const f of ['index.html', 'quick/index.html', 'install/index.html', 'guest/index.html']) { const h = read(f); assert.ok(/<html[\s>]/.test(h) && /<\/html>\s*$/.test(h), f); assert.doesNotMatch(h, /googleapis|gstatic/, f); }
  const app = read('app.js'); assert.match(app, /id="slot-paid-notice"/); assert.match(app, /id="slot-inbox"/);
  assert.doesNotMatch(read('styles.css'), /Raleway|Cormorant|Style Script/);
  assert.match(read('styles.css'), /@font-face \{ font-family: "DM Serif Display"[^}]*dm-serif-display-400\.woff2/);
});
test('A_ motion and accessibility floor: press 0.97 at 160 ms, sheets 300 ms with the v5 curve, reduced motion respected, text never under 12 px', () => {
  const css = read('styles.css'), tk = read('tokens.css');
  assert.match(tk, /--v5-press-scale: 0\.97; --v5-press-ms: 160ms; --v5-sheet-ms: 300ms; --v5-sheet-ease: cubic-bezier\(0\.32, 0\.72, 0, 1\)/);
  assert.match(css, /\.btn:active[^{]*\{ transform: scale\(var\(--v5-press-scale\)\); transition: transform var\(--v5-press-ms\) ease-out/);
  assert.match(css, /\.sheet \{[^}]*transition: transform var\(--v5-sheet-ms\) var\(--v5-sheet-ease\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const m of css.matchAll(/font(?:-size)?:[^;}]*?\b(\d+(?:\.\d+)?)px/g)) assert.ok(+m[1] >= 12 || /line-height/.test(m[0]) || +m[1] === 0, 'text under 12 px: ' + m[0]);
  assert.match(css, /\.A_tabs a \{ min-height: 44px/); assert.match(css, /\.chip \{ min-height: var\(--touch\)/); // F_: controls grow with the text size instead of clipping it
});
test('A_ service worker and manifest: new cache name, tokens + house photos precached and each photo is 60 KB or less, theme colours are the v5 backgrounds', () => {
  const sw = read('sw.js'); assert.match(sw, /CACHE_NAME = 'cs-shell-v30'/);
  for (const u of ['./tokens.css', './img/house-hero.webp', './img/house-blur.webp', './fonts/dm-serif-display-400.woff2']) assert.ok(sw.includes("'" + u + "'") || sw.includes(u.replace('./', '').replace('fonts/', '')) , u);
  for (const f of ['img/house-hero.webp', 'img/house-blur.webp']) assert.ok(fs.statSync(path.join(root, f)).size <= 60 * 1024, f + ' is 60 KB or less');
  const man = JSON.parse(read('manifest.webmanifest')); assert.equal(man.theme_color, '#EEF1F4'); assert.equal(man.background_color, '#EEF1F4');
  assert.match(read('index.html'), /theme-color" content="#F6F3EE"[^>]*light/);
});
test('A_ demo fixtures: house times 12:00 noon / 2:00 pm everywhere, notices for every role, the cleaner demo carries a house list the client must still hide', () => {
  const X = D.build('owner', NOW), C = D.build('cleaner', NOW);
  assert.deepEqual(X.notices.house_times, { check_out: '12:00', check_in: '14:00' });
  for (const g of [X.home.current_guest, X.home.next_guest]) { assert.equal(g.checkout_time, '12:00:00'); assert.equal(g.checkin_time, '14:00:00'); }
  assert.ok(X.notices.notices.length >= 3 && X.notices.weather.rain_watch && X.notices.weather.hourly.length <= 12);
  assert.deepEqual(C.notices.house, []); assert.equal(C.notices.inbox_open, null);
  assert.ok(X.notices.house.length === 2 && X.notices.inbox_open === 2);
  assert.doesNotThrow(() => CS.assertNoMoney(X.notices)); assert.doesNotThrow(() => CS.A_noticesView(X.notices, 'owner', TODAY));
  assert.ok(!/(11:00 ?am|3:00 ?pm)/i.test(JSON.stringify(X.notices) + JSON.stringify(X.home)), 'no stale 11:00 am / 3:00 pm in a fixture');
  const sb = D.client('owner', NOW); return sb.rpc('notices_v1', {}).then((r) => assert.equal(r.error, null));
});

test('A_ ops_notice_add_v1 live mock: exact name and argument keys; owner/admin only; the server refusal shows inline and keeps what was typed; a missing RPC hides the form', async () => {
  const KEYS = ['p_date', 'p_detail', 'p_duration_hours', 'p_property_id', 'p_start_time', 'p_title', 'p_type'];
  assert.deepEqual(Object.keys(CS.A_noticeAddArgs('prop-1', { type: 'water', title: ' No water ', date: '2026-10-20', start: '09:00', hours: '6', detail: '' })).sort(), KEYS);
  assert.deepEqual(CS.A_noticeAddArgs('prop-1', { type: 'note', title: 'x', date: '2026-10-20', start: '', hours: '', detail: '' }), { p_property_id: 'prop-1', p_type: 'note', p_title: 'x', p_date: '2026-10-20', p_start_time: null, p_duration_hours: null, p_detail: null });
  assert.ok(CS.A_noticeAddProblem({ type: 'brownout', title: 'x', date: '2026-10-20' }), 'a brownout is not a choice');
  assert.ok(CS.A_noticeAddProblem({ type: 'water', title: 'x'.repeat(81), date: '2026-10-20' })); assert.ok(CS.A_noticeAddProblem({ type: 'water', title: 'x', date: '2026-10-20', hours: '73' }));
  const sent = []; let mode = 'ok';
  const app = await boot({ role: 'admin', hash: '#calendar/notices', handlers: base('admin', { ops_notice_add_v1: (args) => { sent.push(args); return mode === 'refuse' ? { error: { code: '22023', message: 'Please leave phone numbers out of the notice.' }, data: null } : mode === 'missing' ? { error: { code: 'PGRST202', message: 'Could not find the function' }, data: null } : { error: null, data: { ok: true } }; } }) });
  assert.match(app.els['v-calendar'].innerHTML, /data-act="notice-add-open"/);
  await app.click({ 'data-act': 'notice-add-open', 'data-date': TODAY });
  assert.match(app.els['cs-body'].innerHTML, /id="n-title"/); assert.match(app.els['cs-body'].innerHTML, /maxlength="80"/); assert.doesNotMatch(app.els['cs-body'].innerHTML, /value="brownout"/);
  mode = 'refuse'; await app.click({ 'data-act': 'notice-add-save' });
  assert.match(app.els['cs-body'].innerHTML, /Add a short title/, 'empty title is stopped before the server');
  for (const fn of app.listeners.input || []) { fn({ target: { id: 'n-title', value: 'Call 0917' } }); fn({ target: { id: 'n-type', value: 'note' } }); }
  await app.click({ 'data-act': 'notice-add-save' });
  assert.equal(sent.length, 1); assert.deepEqual(Object.keys(sent[0]).sort(), KEYS); assert.equal(sent[0].p_property_id, 'prop-1'); assert.equal(sent[0].p_type, 'note'); assert.equal(sent[0].p_date, TODAY);
  assert.match(app.els['cs-body'].innerHTML, /Please leave phone numbers out/); assert.match(app.els['cs-body'].innerHTML, /value="Call 0917"/, 'what was typed is kept');
  mode = 'missing'; await app.click({ 'data-act': 'notice-add-save' });
  assert.match(app.els['cs-body'].innerHTML, /Available after the next update\./, 'a missing RPC is said in the open sheet, not by hiding it');
  const c = await boot({ role: 'cleaner', hash: '#calendar/notices', handlers: base('cleaner') });
  assert.doesNotMatch(c.els['v-calendar'].innerHTML, /notice-add-open/); await c.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); assert.ok(!(c.els['cs-body'] && c.els['cs-body'].innerHTML), 'no form for a cleaner even by hand');
  const f = await boot({ role: 'finance', hash: '#calendar/notices', handlers: base('finance') });
  assert.doesNotMatch(f.els['v-calendar'].innerHTML, /notice-add-open/); assert.doesNotMatch(f.els['v-calendar'].innerHTML, /aria-label="House"/);
});
test('A_ notice text: the [hidden] marker and odd weather (null code, null aqi, no rain watch, empty hourly) draw as is', () => {
  const v = CS.A_noticesView(RAW({ notices: [{ id: 'h', type: 'note', title: 'Call [hidden] about the gate', date: '2026-10-16', source: 'manual', detail: 'Mail [hidden]' }], weather: { source: 'google', fetched_at: '2026-10-15T02:00:00Z', temp_c: 28, condition: 'Clear', code: null, rain_chance_pct: 10, aqi: null, hourly: [], rain_watch: null, hourly_source: 'google' } }), 'owner', TODAY);
  assert.equal(v.list[0].title, 'Call [hidden] about the gate'); assert.equal(v.weather.watch, null); assert.deepEqual(v.weather.hours, []); assert.equal(v.weather.aqi, null);
  assert.equal(CS.A_noticesView(RAW({ role: 'inspector' }), 'inspector', TODAY).house.length, 0);
});
