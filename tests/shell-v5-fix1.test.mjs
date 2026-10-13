import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CS, D, read, root, boot, stayRow, HOMEWITH, NOTICES_RAW, baseHandlers, TODAY, NOW } from './_a_harness.mjs';

// Lane A fix round 1 (review of 16a0cca). Every test here was run RED on the pre-fix code (see the lane report). Clocks are frozen.
const at = (iso) => new Date(iso);
const css = read('styles.css');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const html = (o) => o.els['v-calendar'].innerHTML;
const dayCell = (h, iso) => (h.split('<button class="d ').find((c) => c.includes('data-day="' + iso + '"')) || '');

// ---------------------------------------------------------------- H1 calendar guest tag
test('A_fix H1: the guest tag is readable on past and clash cells, and a one-night stay shows its name on the arrival cell', async () => {
  assert.match(css, /\.cal \.d\.past \.A_tag \{ color: var\(--v5-cal-past-fg\); \}/);
  assert.match(css, /\.cal \.d\.clash \.A_tag \{ color: var\(--v5-danger-t\); \}/);
  const cal = [stayRow('Ana Reyes', '2026-10-20', '2026-10-21'), stayRow('Ben Cruz', '2026-10-22', '2026-10-25')];
  const app = await boot({ role: 'cleaner', hash: '#calendar', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH(cal) }) });
  const h = html(app);
  assert.match(dayCell(h, '2026-10-20'), /A_tag in">Ana/, 'a one-night stay: the name sits on the arrival cell');
  assert.doesNotMatch(dayCell(h, '2026-10-22'), /A_tag/, 'a longer stay keeps its name on the first night cell, not on the arrival');
  assert.match(dayCell(h, '2026-10-23'), /A_tag"[^>]*>Ben/);
});

// ---------------------------------------------------------------- H2 turnover claims
test('A_fix H2: at 2:01 pm with no cleaning record the card never says Guest out was done or Clean is Done; it works from the calendar, not from current_guest', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-12', TODAY), stayRow('Ben Cruz', TODAY, '2026-10-18')];
  const app = await boot({ role: 'cleaner', hash: '#home', now: at('2026-10-15T06:01:00Z'), handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH(cal, { current_guest: null, next_guest: null }) }) });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /aria-label="Turnover today"/, 'the card shows although current_guest is gone after noon');
  assert.match(h, /Clean<\/span><b>Window closed/); assert.doesNotMatch(h, />Done</); assert.doesNotMatch(h, /class="done"/);
  const steps = h.slice(h.indexOf('class="A_steps"'), h.indexOf('A_slide'));
  assert.doesNotMatch(steps, /data-i="check"/, 'no tick on any step: the app does not know what happened');
  const before = await boot({ role: 'cleaner', hash: '#home', now: at('2026-10-15T01:00:00Z'), handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH(cal) }) });
  assert.match(before.els['v-home'].innerHTML, /Clean<\/span><b>From 12:00 noon/);
});

// ---------------------------------------------------------------- H3 Add a notice
test('A_fix H3: Add a notice exists only once notices_v1 answered; a missing RPC keeps the sheet open, says so and keeps the typed text', async () => {
  const gone = () => ({ error: { code: 'PGRST202', message: 'Could not find the function' }, data: null });
  const cal = [stayRow('Ana Reyes', '2026-10-14', '2026-10-17')];
  const none = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { notices_v1: gone, staff_home_v1: () => HOMEWITH(cal) }) });
  await none.click({ 'data-day': '2026-10-16' });
  assert.doesNotMatch(none.els['cs-body'].innerHTML, /notice-add-open/, 'no notices_v1: no Add a notice on the Day sheet');
  await none.click({ 'data-act': 'notice-add-open', 'data-date': TODAY });
  assert.doesNotMatch(none.els['cs-body'].innerHTML, /id="n-title"/, 'and the form cannot be opened by hand');
  const sent = [];
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH(cal), ops_notice_add_v1: (a) => { sent.push(a); return gone(); } }) });
  await app.click({ 'data-day': '2026-10-16' });
  assert.match(app.els['cs-body'].innerHTML, /data-act="notice-add-open"/, 'notices_v1 answered: the button is there');
  await app.click({ 'data-act': 'notice-add-open', 'data-date': '2026-10-16' });
  app.input('n-title', 'Pipe repair'); app.input('n-detail', 'Fill the drums');
  await app.click({ 'data-act': 'notice-add-save' });
  const body = app.els['cs-body'].innerHTML;
  assert.equal(sent.length, 1);
  assert.match(body, /Available after the next update\./); assert.match(body, /id="n-title"[^>]*value="Pipe repair"/); assert.match(body, /value="Fill the drums"/, 'the sheet stays open with what was typed');
});

// ---------------------------------------------------------------- M1 / M2 / M3
test('A_fix M1: the Notices card has one fixed height for loaded, empty and failed, shows two rows and collapses only when the RPC is absent; the inbox slot is reserved', async () => {
  assert.match(css, /\.A_noticecard \{ min-height: 232px/);
  const three = NOTICES_RAW({ notices: [...NOTICES_RAW().notices, { id: 'n3', type: 'deep_clean', title: 'Deep clean', date: '2026-10-21', source: 'manual' }] });
  const ok = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { notices_v1: () => ({ error: null, data: three }) }) });
  const h = ok.els['v-home'].innerHTML; assert.match(h, /A_noticecard/); assert.equal((h.match(/<a class="rowi" href="#calendar\/notices"/g) || []).length, 2, 'two rows and See all 3'); assert.match(h, /See all 3/);
  const empty = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ notices: [], weather: null }) }) }) });
  assert.match(empty.els['v-home'].innerHTML, /A_noticecard[^>]*>.*No notices/s);
  const failed = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { notices_v1: () => ({ error: { code: '500', message: 'boom' }, data: null }) }) });
  const fh = failed.els['v-home'].innerHTML; assert.match(fh, /A_noticecard/); assert.match(fh, /No connection\. <button/); assert.match(fh, /id="slot-inbox" style="min-height:64px"/, 'the inbox slot keeps its height');
  const gone = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { notices_v1: () => ({ error: { code: 'PGRST202', message: 'x' }, data: null }) }) });
  assert.doesNotMatch(gone.els['v-home'].innerHTML, /A_noticecard/);
});
test('A_fix M2: a redraw of Home carries the paid-notice slot node over instead of rebuilding it', async () => {
  let html = '', rendered = false, phase = 'idle'; const swaps = [], removed = [];
  const mounted = { tag: 'mounted', parentNode: { removeChild(n) { removed.push(n); } } };
  const fresh = { tag: 'fresh', parentNode: { replaceChild(n, o) { swaps.push([n, o]); phase = 'idle'; } } };
  const home = { style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], focus() {},
    querySelector: (q) => (q !== '#slot-paid-notice' || !rendered ? null : phase === 'fresh' ? fresh : mounted) };
  Object.defineProperty(home, 'innerHTML', { get: () => html, set: (v) => { if (rendered && v.includes('slot-paid-notice')) phase = 'fresh'; if (v.includes('slot-paid-notice')) rendered = true; html = v; } });
  const app = await boot({ role: 'cleaner', hash: '#home', els: { 'v-home': home }, handlers: baseHandlers('cleaner') });
  assert.match(html, /id="slot-paid-notice"/);
  await app.click({ 'data-act': 'refresh' });
  assert.ok(swaps.length >= 1, 'the mounted node is put back after a redraw'); assert.equal(swaps[0][0], mounted); assert.equal(swaps[0][1], fresh); assert.equal(removed[0], mounted);
});
test('A_fix M3: slide-to-start never swallows a later tap: the flag clears on the next pointerdown and after 400 ms', async () => {
  const attrs = {}, a = { getAttribute: (k) => attrs[k] ?? null, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; }, querySelector: () => ({ style: {} }), offsetWidth: 300, href: '#door/checklist' };
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner'), docQuery: (q) => (q === '[data-slid]' && attrs['data-slid'] ? a : null) });
  const fire = (t, ev) => { for (const fn of app.listeners[t] || []) fn(ev); };
  const slide = (x) => { fire('pointerdown', { target: { closest: () => a }, button: 0, clientX: 0 }); fire('pointermove', { clientX: x }); fire('pointerup', {}); };
  slide(100); assert.equal(attrs['data-slid'], '1', 'a short drag arms the swallow');
  fire('pointerdown', { target: { closest: () => null }, button: 0, clientX: 5 });
  assert.equal(attrs['data-slid'], undefined, 'the next pointerdown clears it');
  slide(100); assert.equal(attrs['data-slid'], '1'); await wait(450); assert.equal(attrs['data-slid'], undefined, 'and 400 ms is the longest it lives');
});

// ---------------------------------------------------------------- M4 M5
test('A_fix M4: the deep-clean tile has a colour (the class the app writes is the class the stylesheet styles)', () => {
  assert.match(css, /\.lead\.A_t-deep_clean \{ background: var\(--v5-deep\)/); assert.doesNotMatch(css, /\.A_t-deep\b(?!_)/);
  assert.ok(CS.A_noticesView({ notices: [{ id: 'd', type: 'deep_clean', title: 'Deep clean', date: '2026-10-20' }] }, 'cleaner', TODAY).list[0].type === 'deep_clean');
});
test('A_fix M5: every interactive class is at least 44 px tall in the stylesheet, and the house row keeps its buttons on their own line', async () => {
  const interactive = ['.btn', '.btn-sm', '.chip', '.iconbtn', '.sw', '.ctval', '.tab', '.trust', '.rowi', '.A_chipglass', '.doorbar .back', '.pad button'];
  const last = {};
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((x) => x.trim()), v = /(?:^|[;\s])(?:min-)?height:\s*([^;]+)/.exec(m[2]);
    if (!v) continue; for (const s of sels) if (interactive.includes(s)) last[s] = v[1].trim();
  }
  for (const k of Object.keys(last)) { const px = /^(\d+(?:\.\d+)?)px$/.exec(last[k]); assert.ok(!px || +px[1] >= 44, k + ' is ' + last[k] + ' tall'); }
  assert.ok(Object.keys(last).length >= 8, 'the check actually found the rules');
  const app = await boot({ role: 'admin', hash: '#calendar/notices', handlers: baseHandlers('admin', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ house: [{ kind: 'finding', id: 'V1m:x', title: 'System check', detail: 'Airbnb block runs past the last guest night' }] }) }) }) });
  assert.match(html(app), /<\/span><div class="A_acts"><button[^>]*notice-resolve/, 'Resolve sits in its own A_acts line, after the text');
  assert.match(css, /\.A_acts \{ display: flex; gap: 8px; flex-wrap: wrap; width: 100%/);
});

// ---------------------------------------------------------------- M6 M7
test('A_fix M6: a cleaner never sees System check warnings or a badge for them, even when the payload carries one; the demo cleaner is sent none', async () => {
  const warn = [{ kind: 'verifier', title: 'Airbnb block runs past the last guest night', severity: 'alert', key: 'V1m:x', detail: { check_id: 'V1m' } }];
  const c = await boot({ role: 'cleaner', hash: '#calendar/stays', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { warnings: warn }) }) });
  assert.doesNotMatch(html(c), /System check/); assert.doesNotMatch(c.els.tabbar.innerHTML, /warnings/);
  const o = await boot({ role: 'owner', hash: '#calendar/stays', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([], { warnings: warn }) }) });
  assert.match(html(o), /System check/);
  assert.ok(!D.build('cleaner', NOW).home.warnings.some((w) => w.kind === 'verifier')); assert.ok(D.build('owner', NOW).home.warnings.some((w) => w.kind === 'verifier'));
});
test('A_fix M7: the hub lists pricing/advisor (read_finance) and search (read_operations) with the right roles', () => {
  const flat = (role) => CS.A_hubGroups(role).flatMap((g) => g.items.map((i) => i.route));
  for (const r of ['owner', 'admin', 'finance']) { assert.ok(flat(r).includes('pricing/advisor'), r); assert.ok(flat(r).includes('search'), r); }
  assert.ok(!flat('finance').includes('pricing'), 'the rate card itself is still owner/admin');
  const g = CS.A_hubGroups('owner').find((x) => x.items.some((i) => i.route === 'pricing/advisor')); assert.equal(g.title, 'Money and stock');
  const file = path.join(root, '..', 's81-admin-D', 'app', 'src', 'routes.tsx');
  if (fs.existsSync(file)) { const tsx = fs.readFileSync(file, 'utf8'); for (const r of ['pricing/advisor', 'search']) assert.ok(tsx.includes("path: '" + r + "'"), r); }
});

// ---------------------------------------------------------------- LOW
test('A_fix LOW: an invalid time gives no "NaN", the refusal sentences are plain and only refusals are echoed, the guest message never repeats a time or carries [hidden]', () => {
  assert.equal(CS.A_hour12('not a time'), ''); assert.equal(CS.A_hour12(undefined), '');
  const v = CS.A_noticesView({ weather: { temp_c: 28, hourly: [{ time: 'bad', rain_chance_pct: 10 }], rain_watch: { from: 'bad', to: 'worse', peak_pct: 50 } }, notices: [] }, 'cleaner', TODAY);
  assert.equal(v.weather.watch, null); assert.ok(!JSON.stringify(v).includes('NaN'));
  const e = (code, message) => CS.A_noticeAddError({ code, message });
  assert.equal(e('22023', 'contact_or_amount_not_allowed'), 'Put the date in the date field. No phone numbers, e-mails or amounts in the text.');
  assert.equal(e('P0001', 'title_length'), 'Keep the title between 1 and 80 characters.'); assert.equal(e('22023', 'duration_out_of_range'), 'Hours must be between 1 and 72.');
  assert.equal(e('22023', 'type_not_allowed'), 'Choose water, maintenance, deep cleaning or note.'); assert.match(e('22023', 'date_out_of_range'), /date/); assert.match(e('22023', 'detail_length'), /200/);
  assert.equal(e('42501', 'denied'), 'Only an owner or admin can add a notice.');
  assert.equal(e('500', 'relation "x" does not exist'), 'No connection. Try again.'); assert.equal(e(undefined, 'Failed to fetch'), 'No connection. Try again.');
  assert.doesNotMatch(e('22023', 'raw {"sql": "x"} sqlstate'), /sql/);
  const withTime = CS.A_guestMessage({ title: 'Brownout 1:00 to 4:00 pm', date: '2026-10-16', start: '13:00', end: '16:00' });
  assert.equal((withTime.match(/1:00/g) || []).length, 1, 'the time is said once'); assert.doesNotMatch(withTime, /!/);
  assert.match(CS.A_guestMessage({ title: 'No water', date: '2026-10-20', start: '09:00', end: '15:00' }), /9:00 am to 3:00 pm/);
  assert.equal(CS.A_guestMessage({ title: 'Call [hidden] about the gate', date: '2026-10-16' }), null); assert.equal(CS.A_guestMessage({ title: 'Gate', detail: 'Mail [hidden]' }), null);
  assert.ok(read('app.js').includes('Check the notice text first.'));
});
test('A_fix LOW: a flag and a notice of one kind read once on the cell and on the sheet', async () => {
  assert.equal(CS.A_flagDup({ kind: 'brownout' }, [{ type: 'power' }]), true); assert.equal(CS.A_flagDup({ kind: 'maintenance' }, [{ type: 'power' }]), false);
  const flags = [{ date: '2026-10-16', kind: 'brownout', label: 'Brownout', source: 'auto', id: null }];
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-14', '2026-10-17')], { day_flags: flags, warnings: [] }) }) });
  assert.doesNotMatch(dayCell(html(app), '2026-10-16'), /; Brownout; Brownout 1:00/); assert.match(dayCell(html(app), '2026-10-16'), /Brownout 1:00 to 4:00 pm/);
  await app.click({ 'data-day': '2026-10-16' }); assert.doesNotMatch(app.els['cs-body'].innerHTML, /<b>Brownout<\/b>/, 'the automatic brownout flag is not listed beside the power notice');
});
test('A_fix LOW: no raw colour in styles.css, tokens added for both themes, no Google Fonts host and no font preload for the missing file', () => {
  const raw = css.split('\n').filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)); assert.deepEqual(raw, []);
  const tk = read('tokens.css'); for (const t of ['--v5-photo-ink', '--v5-photo-fade', '--v5-live-ok', '--v5-bar-on', '--v5-scrim']) assert.ok(tk.includes(t + ':'), t);
  const sw = read('sw.js'); assert.doesNotMatch(sw, /fonts\.googleapis|fonts\.gstatic/); assert.match(sw, /'facebook\.com'/);
  assert.doesNotMatch(read('index.html'), /rel="preload"/);
});
test('A_fix LOW: one time format ("2:00 pm", "12:00 noon"); the demo registers no service worker, a live page does', async () => {
  assert.deepEqual([CS.fmtTime('14:00:00'), CS.fmtTime('12:00:00'), CS.fmtTime('09:05:00'), CS.fmtTime('00:30:00')], ['2:00 pm', '12:00 noon', '9:05 am', '12:30 am']);
  assert.equal(CS.A_houseTimes(null).inLabel, '2:00 pm'); assert.equal(CS.A_hour12('2026-10-15T14:00:00+08:00'), '2 pm');
  const demo = await boot({ role: 'cleaner', hash: '#home', demo: true, handlers: baseHandlers('cleaner') });
  for (const fn of demo.winListeners.load || []) fn(); assert.deepEqual(demo.registered, []);
  const live = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner') });
  for (const fn of live.winListeners.load || []) fn(); assert.deepEqual(live.registered, ['sw.js']);
});

// ---------------------------------------------------------------- notice sources and the opt-in GSCWD posts
test('A_fix sources: a source link is an https facebook.com address or nothing', () => {
  const ok = ['https://www.facebook.com/gscwaterdistrict/', 'https://facebook.com/x', 'https://m.facebook.com/x'];
  for (const u of ok) assert.ok(CS.A_facebookUrl(u), u);
  for (const u of ['http://www.facebook.com/x', 'https://evilfacebook.com/x', 'https://facebook.com.evil.example/x', 'https://user:pw@www.facebook.com/x', 'https://www.facebook.com:8443/x', 'javascript:alert(1)', '//www.facebook.com/x', '', null, undefined, 42, 'https://www.facebook.com/' + 'a'.repeat(400)]) assert.equal(CS.A_facebookUrl(u), null, String(u));
  const v = CS.A_noticesView(NOTICES_RAW({ sources: { water_page: 'https://evil.example/x', power_page: 'https://www.facebook.com/socoteco2.EC/' } }), 'cleaner', TODAY);
  assert.deepEqual(v.sources, { water: null, power: 'https://www.facebook.com/socoteco2.EC/' });
  assert.deepEqual(CS.A_noticesView(NOTICES_RAW({ sources: undefined }), 'cleaner', TODAY).sources, { water: null, power: null }, 'an older server: nothing');
  assert.equal(CS.A_fbPluginUrl('https://evil.example/x', 300), null);
  const u = CS.A_fbPluginUrl('https://www.facebook.com/gscwaterdistrict/', 900);
  assert.ok(u.startsWith('https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Fgscwaterdistrict%2F&tabs=timeline&width=500&height=600&small_header=true&adapt_container_width=true&hide_cover=true&show_facepile=false'));
  assert.match(CS.A_fbPluginUrl('https://www.facebook.com/x', 10), /width=180&/);
});
test('A_fix sources: the Notices page shows both page links to every role, the posts only after a tap, never in demo, and Hide removes them', async () => {
  for (const role of ['cleaner', 'admin']) {
    const app = await boot({ role, hash: '#calendar/notices', handlers: baseHandlers(role) }), h = html(app);
    assert.match(h, /Check the GSCWD page/); assert.match(h, /Check the SOCOTECO II page/);
    assert.match(h, /href="https:\/\/www\.facebook\.com\/gscwaterdistrict\/" target="_blank" rel="noopener noreferrer"/); assert.match(h, /href="https:\/\/www\.facebook\.com\/socoteco2\.EC\/" target="_blank" rel="noopener noreferrer"/);
    assert.doesNotMatch(h, /<iframe/, role + ': nothing is loaded before the tap'); assert.match(h, /data-act="fb-show">Show the latest GSCWD posts/);
    await app.click({ 'data-act': 'fb-show' });
    const o = html(app), tag = /<iframe [^>]*>/.exec(o); assert.ok(tag, 'inserted by the tap');
    assert.match(tag[0], /title="Latest GSCWD posts"/); assert.match(tag[0], /loading="lazy"/); assert.match(tag[0], /referrerpolicy="no-referrer"/); assert.match(tag[0], /sandbox="allow-scripts allow-same-origin allow-popups"/);
    assert.match(tag[0].replace(/&amp;/g, '&'), /src="https:\/\/www\.facebook\.com\/plugins\/page\.php\?href=https%3A%2F%2Fwww\.facebook\.com%2Fgscwaterdistrict%2F&tabs=timeline&width=328&height=600&small_header=true/);
    assert.match(o, /class="A_fbbox"/); assert.match(o, /From GSCWD’s Facebook page\./);
    assert.equal(/send the post link to Cassy/.test(o.slice(o.indexOf('A_fbbox'))), role === 'admin', role + ': the second sentence is for owner and admin');
    await app.click({ 'data-act': 'fb-hide' }); assert.doesNotMatch(html(app), /<iframe/, 'Hide removes it'); assert.match(html(app), /fb-show/);
  }
  const demo = await boot({ role: 'admin', hash: '#calendar/notices', demo: true, handlers: baseHandlers('admin') });
  await demo.click({ 'data-act': 'fb-show' }); assert.doesNotMatch(html(demo), /<iframe/, 'demo loads nothing'); assert.match(html(demo), /Demo: the live posts are not loaded here\./);
  const bad = await boot({ role: 'cleaner', hash: '#calendar/notices', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ sources: { water_page: 'https://evil.example/x', power_page: 'http://facebook.com/a' } }) }) }) });
  assert.doesNotMatch(html(bad), /Check the (GSCWD|SOCOTECO II) page|fb-show|evil\.example/);
  const old = await boot({ role: 'cleaner', hash: '#calendar/notices', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ sources: undefined }) }) }) });
  assert.doesNotMatch(html(old), /Check the (GSCWD|SOCOTECO II) page/);
  assert.equal(D.build('owner', NOW).notices.sources.water_page, 'https://www.facebook.com/gscwaterdistrict/'); assert.equal(D.build('cleaner', NOW).notices.sources.power_page, 'https://www.facebook.com/socoteco2.EC/');
});
