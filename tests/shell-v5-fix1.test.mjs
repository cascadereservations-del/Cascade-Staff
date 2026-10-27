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
  assert.match(dayCell(h, '2026-10-20'), /A_tag in" style="--A_g:var\(--v5-g\d\);--A_gfg:var\(--v5-g\d-fg\)">Ana/, 'a one-night stay: the name sits on the arrival cell and carries its own shade');
  const tagRule = css.match(/\.cal \.d \.A_tag\.in \{[^}]*\}/)[0]; assert.match(tagRule, /max-width: calc\(100% - 8px\)/); assert.match(tagRule, /background: var\(--A_g/); assert.match(tagRule, /left: 4px/);
  assert.match(css.match(/\.cal \.d \.A_tag \{[^}]*\}/)[0], /overflow: hidden; text-overflow: ellipsis/);
  assert.match(css, /\.cal \.d\.past \.A_tag\.in \{ color: var\(--v5-cal-past-fg\); \}/);
  assert.doesNotMatch(dayCell(h, '2026-10-22'), /A_tag/, 'a longer stay keeps its name on the first night cell, not on the arrival');
  assert.match(dayCell(h, '2026-10-23'), /A_tag"[^>]*>Ben/);
});

// ---------------------------------------------------------------- H2 turnover claims
test('A_fix H2: at 2:01 pm with no cleaning record the card never says Guest out was done or Clean is Done; it works from the calendar, not from current_guest', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-12', TODAY), stayRow('Ben Cruz', TODAY, '2026-10-18')];
  const app = await boot({ role: 'cleaner', hash: '#home', now: at('2026-10-15T06:01:00Z'), handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH(cal, { current_guest: null, next_guest: null }) }) });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /aria-label="Turnover today"/, 'the card shows although current_guest is gone after noon');
  assert.match(h, /Clean<\/span><b>Closed/); assert.doesNotMatch(h, />Done</); assert.doesNotMatch(h, /class="done"/);
  const steps = h.slice(h.indexOf('class="A_steps"'), h.indexOf('A_slide'));
  assert.doesNotMatch(steps, /data-i="check"/, 'no tick on any step: the app does not know what happened');
  const before = await boot({ role: 'cleaner', hash: '#home', now: at('2026-10-15T01:00:00Z'), handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH(cal) }) });
  assert.match(before.els['v-home'].innerHTML, /Clean<\/span><b>From noon/);
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
  const card = css.match(/\.A_noticecard \{[^}]*\}/)[0]; assert.match(card, /(^|[ ;{])height: 216px/); assert.doesNotMatch(card, /min-height/); assert.match(card, /overflow: hidden/);
  assert.match(css, /\.A_noticecard \.rowi \{ height: 64px; min-height: 64px; overflow: hidden; \}/);
  assert.match(css, /\.A_noticecard \.rowi \.t, \.A_noticecard \.rowi \.s \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
  const three = NOTICES_RAW({ notices: [...NOTICES_RAW().notices, { id: 'n3', type: 'deep_clean', title: 'Deep clean', date: '2026-10-21', source: 'manual' }] });
  const ok = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: null, data: three }) }) }); // s91: owner/admin/finance get Needs action; the card stays for the cleaner
  const h = ok.els['v-home'].innerHTML; assert.match(h, /A_noticecard/); assert.equal((h.match(/<a class="rowi" href="#calendar\/notices"/g) || []).length, 2, 'two rows and See all 3'); assert.match(h, /See all 3/);
  const empty = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ notices: [], weather: null }) }) }) });
  assert.match(empty.els['v-home'].innerHTML, /A_noticecard[^>]*>.*No notices/s);
  const failed = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { notices_v1: () => ({ error: { code: '500', message: 'boom' }, data: null }) }) });
  const fh = failed.els['v-home'].innerHTML; assert.match(fh, /id="B_card"/); assert.match(fh, /Could not update\./); assert.match(fh, /id="slot-inbox" hidden>/, 'a failed read drops the inbox reserve');
  const cf = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: { code: '500', message: 'boom' }, data: null }) }) }); assert.match(cf.els['v-home'].innerHTML, /A_noticecard/); assert.match(cf.els['v-home'].innerHTML, /No connection\. <button/);
  assert.match(ok.els['v-home'].innerHTML, /title="Brownout 1:00 to 4:00 pm · /, 'the row is one line; the full text is in its title');
  const never = new Promise(() => {});
  const pend = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { notices_v1: () => never }) });
  assert.match(pend.els['v-home'].innerHTML, /aria-busy="true"/); assert.match(pend.els['v-home'].innerHTML, /id="slot-inbox" style="min-height:64px"/, 'owner/admin: the reserve is kept while loading');
  const fin = await boot({ role: 'finance', hash: '#home', handlers: baseHandlers('finance', { notices_v1: () => never }) });
  assert.match(fin.els['v-home'].innerHTML, /id="slot-inbox" hidden>/, 'finance never has an inbox');
  const gone = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { notices_v1: () => ({ error: { code: 'PGRST202', message: 'x' }, data: null }) }) });
  assert.doesNotMatch(gone.els['v-home'].innerHTML, /A_noticecard/); assert.match(gone.els['v-home'].innerHTML, /Nothing needs you right now/);
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
test('A_fix M3 (E_: now through E_drag): slide-to-start swallows only the click that follows a short drag, on the slide itself, for 400 ms at most', async () => {
  const a = { getAttribute: () => null, querySelector: () => ({ style: {} }), offsetWidth: 300, href: '#door/checklist', contains: (t) => t === a, closest: () => null, setPointerCapture() {} };
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner') });
  const fire = (t, ev) => { for (const fn of app.listeners[t] || []) fn(ev); };
  const slide = (x, t0) => { const at0 = { target: { closest: (s) => (s === '[data-slide]' ? a : null) }, button: 0, clientX: 40, clientY: 10, pointerId: 1, timeStamp: t0 };
    fire('pointerdown', at0); fire('pointermove', { clientX: 40 + x, clientY: 10, pointerId: 1, timeStamp: t0 + 90 }); fire('pointerup', { clientX: 40 + x, clientY: 10, pointerId: 1, timeStamp: t0 + 100 }); };
  const click = (target) => { let p = 0; fire('click', { target, preventDefault() { p++; }, stopPropagation() {} }); return p; };
  let now = 0; CS.E_setClock(() => now); // frozen: no real waiting
  try {
    slide(60, 0); assert.equal(click(a), 1, 'a short drag swallows the click that follows it');
    assert.equal(click(a), 0, 'once');
    slide(60, 200); assert.equal(click({ closest: () => null }), 0, 'a click anywhere else is never swallowed');
    now = 500; assert.equal(click(a), 0, 'and 400 ms is the longest it lives');
    slide(60, 600); fire('pointerdown', { target: { closest: () => null }, button: 0, clientX: 5, clientY: 5, pointerId: 3, timeStamp: 650 }); assert.equal(click(a), 0, 'the next pointerdown clears it: a real tap on the slide right after a drag is a tap'); // the M3 guarantee, restored (review F5)
  } finally { CS.E_setClock(null); }
});

// ---------------------------------------------------------------- M4 M5
test('A_fix M4: the deep-clean tile has a colour (the class the app writes is the class the stylesheet styles)', () => {
  assert.match(css, /\.lead\.A_t-deep_clean \{ color: var\(--v5-ok-t\)/); assert.match(css, /\.lead\.A_t-power, [^{]*\{ background: var\(--v5-sunk\)/); assert.doesNotMatch(css, /\.A_t-deep\b(?!_)/);
  assert.ok(CS.A_noticesView({ notices: [{ id: 'd', type: 'deep_clean', title: 'Deep clean', date: '2026-10-20' }] }, 'cleaner', TODAY).list[0].type === 'deep_clean');
});
test('A_fix M5: EVERY rule ending in an interactive class sets a height of at least 44 px (px >= 44 or the touch token), and the house row keeps its buttons on their own line', async () => {
  const interactive = ['.btn', '.btn-sm', '.chip', '.iconbtn', '.sw', '.ctval', '.tab', '.trust', '.rowi', '.A_chipglass', '.doorbar .back', '.pad button'];
  const seen = new Set(), bad = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    for (const s of m[1].split(',').map((x) => x.trim())) {
      const hit = interactive.find((c) => s === c || s.endsWith(' ' + c)); if (!hit) continue;
      for (const d of m[2].matchAll(/(?:^|[;\s])((?:min-)?height):\s*([^;]+)/g)) {
        seen.add(hit); const val = d[2].trim(), px = /^(\d+(?:\.\d+)?)px$/.exec(val);
        if (!(val === 'var(--touch)' || val === 'var(--v5-touch)' || (px && +px[1] >= 44))) bad.push(s + ' { ' + d[1] + ': ' + val + ' }');
      }
    }
  }
  assert.deepEqual(bad, [], 'a rule under 44 px, or a value that is not a plain size');
  assert.ok(seen.size >= 9, 'the check found the rules: ' + [...seen].join(' '));
  const app = await boot({ role: 'admin', hash: '#calendar/notices', handlers: baseHandlers('admin', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ house: [{ kind: 'finding', id: 'V1m:x', title: 'System check', detail: 'Airbnb block runs past the last guest night' }] }) }) }) });
  assert.match(html(app), /<\/span><div class="A_acts"><button[^>]*notice-resolve/, 'Resolve sits in its own A_acts line, after the text');
  assert.match(css, /\.A_acts \{ display: flex; gap: 8px; flex-wrap: wrap; width: 100%/);
});
test('A_fix F5: the three turnover labels are short enough for one line and align from the top', () => {
  assert.deepEqual(['12:00', '14:00', '14:30', '09:05', '00:00'].map(CS.A_shortTime), ['noon', '2 pm', '2:30 pm', '9:05 am', '12 am']); assert.equal(CS.A_shortTime('bad'), '');
  assert.match(css, /\.A_steps > div \{ align-content: start; \} \.A_steps b \{ white-space: nowrap; \}/);
  assert.ok(CS.A_shortTime('12:00').length + 5 <= 10 && ('Until ' + CS.A_shortTime('14:00')).length <= 10, 'none of the three labels is longer than 10 characters');
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
  const g = CS.A_hubGroups('owner').find((x) => x.items.some((i) => i.route === 'pricing/advisor')); assert.equal(g.title, 'Money');
  const file = path.join(root, '..', 's81-admin-D', 'app', 'src', 'routes.tsx');
  if (fs.existsSync(file)) { const tsx = fs.readFileSync(file, 'utf8'); for (const r of ['pricing/advisor', 'search']) assert.ok(tsx.includes("path: '" + r + "'"), r); }
});

// ---------------------------------------------------------------- LOW
test('A_fix LOW: an invalid time gives no "NaN", the refusal sentences are plain and only refusals are echoed, the guest message never repeats a time or carries [hidden]', () => {
  assert.equal(CS.A_hour12('not a time'), ''); assert.equal(CS.A_hour12(undefined), '');
  const v = CS.A_noticesView({ weather: { temp_c: 28, hourly: [{ time: 'bad', rain_chance_pct: 10 }], rain_watch: { from: 'bad', to: 'worse', peak_pct: 50 } }, notices: [] }, 'cleaner', TODAY);
  assert.equal(v.weather.watch, null); assert.ok(!JSON.stringify(v).includes('NaN'));
  const e = (code, message) => CS.A_noticeAddError({ code, message });
  assert.equal(e('22023', 'contact_or_amount_not_allowed'), 'A number in the text reads as a phone number or an amount (meter readings do too). Write it without those numbers.');
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
test('A_fix LOW: no raw colour in styles.css, tokens added for both themes, no Google Fonts host, and the font preload names a file that exists', () => {
  const raw = css.split('\n').filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)); assert.deepEqual(raw, []);
  const tk = read('tokens.css'); for (const t of ['--v5-photo-ink', '--v5-photo-fade', '--v5-live-ok', '--v5-bar-on', '--v5-scrim']) assert.ok(tk.includes(t + ':'), t);
  const sw = read('sw.js'); assert.doesNotMatch(sw, /fonts\.googleapis|fonts\.gstatic/); assert.doesNotMatch(sw, /facebook/, 'a cross-origin frame never reaches our worker');
  const pre = [...read('index.html').matchAll(/rel="preload" href="([^"]+)"/g)].map((m) => m[1]); assert.deepEqual(pre, ['fonts/inter-var.woff2', 'fonts/dm-serif-display-400.woff2']); for (const p of pre) assert.ok(fs.existsSync(path.join(root, p)), p);
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
const HOSTILE = ['https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example', 'https://www.facebook.com/dialog/oauth?client_id=1&redirect_uri=https%3A%2F%2Fevil.example', 'https://apps.facebook.com/x', 'https://evil.example.facebook.com/',
  'https://www.facebook.com/someotherpage/', 'https://www.facebook.com/gscwaterdistrict/?ref=x', 'https://www.facebook.com/gscwaterdistrict/#x', 'https://www.facebook.com/gscwaterdistrict/?', 'https://www.facebook.com/gscwaterdistrict/extra',
  'http://www.facebook.com/gscwaterdistrict/', 'https://evilfacebook.com/gscwaterdistrict/', 'https://facebook.com.evil.example/gscwaterdistrict/', 'https://user:pw@www.facebook.com/gscwaterdistrict/', 'https://www.facebook.com:8443/gscwaterdistrict/',
  'https://www.facebook.com/%67scwaterdistrict/', 'https://web.facebook.com/gscwaterdistrict/', 'https://fb.com/gscwaterdistrict/', 'javascript:alert(1)', '//www.facebook.com/gscwaterdistrict/', '', null, undefined, 42, {}, 'https://www.facebook.com/' + 'a'.repeat(400)];
test('A_fix F1: the source pages are pinned in code; a payload value counts only when it is exactly that page, and anything else is the pinned page or nothing', () => {
  assert.deepEqual(CS.A_PINNED, { water: 'https://www.facebook.com/gscwaterdistrict/', power: 'https://www.facebook.com/socoteco2.EC/' });
  for (const u of ['https://www.facebook.com/gscwaterdistrict/', 'https://www.facebook.com/gscwaterdistrict', 'https://facebook.com/GSCWaterDistrict/', 'https://m.facebook.com/gscwaterdistrict/']) assert.equal(CS.A_facebookUrl(u, 'water'), CS.A_PINNED.water, u);
  for (const u of ['https://www.facebook.com/socoteco2.EC/', 'https://www.facebook.com/SOCOTECO2.ec']) assert.equal(CS.A_facebookUrl(u, 'power'), CS.A_PINNED.power, u);
  assert.equal(CS.A_facebookUrl('https://www.facebook.com/socoteco2.EC/', 'water'), null, 'the power page is not the water page');
  for (const k of ['constructor', '__proto__', 'x', undefined]) assert.equal(CS.A_facebookUrl('https://www.facebook.com/gscwaterdistrict/', k), null, String(k));
  for (const u of HOSTILE) { for (const k of ['water', 'power']) assert.equal(CS.A_facebookUrl(u, k), null, k + ' ' + String(u).slice(0, 60));
    const v = CS.A_noticesView(NOTICES_RAW({ sources: { water_page: u, power_page: u } }), 'cleaner', TODAY); assert.deepEqual(v.sources, { water: CS.A_PINNED.water, power: CS.A_PINNED.power }, 'a bad value with the entry present falls back to the pinned page: ' + String(u).slice(0, 50)); }
  assert.deepEqual(CS.A_noticesView(NOTICES_RAW({ sources: { water_page: 'https://l.facebook.com/l.php?u=x' } }), 'cleaner', TODAY).sources, { water: CS.A_PINNED.water, power: null }, 'an entry that is not there draws nothing');
  for (const none of [undefined, null, 'x', [], {}]) assert.deepEqual(CS.A_noticesView(NOTICES_RAW({ sources: none }), 'cleaner', TODAY).sources, { water: null, power: null }, 'an older server: nothing');
  for (const u of HOSTILE) assert.equal(CS.A_fbPluginUrl(u, 300), null, 'the plugin is never built from ' + String(u).slice(0, 50));
  const u = CS.A_fbPluginUrl('https://m.facebook.com/GSCwaterdistrict', 900);
  assert.ok(u.startsWith('https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Fgscwaterdistrict%2F&tabs=timeline&width=500&height=600&small_header=true&adapt_container_width=true&hide_cover=true&show_facepile=false'), 'built from the pinned page, not the payload spelling');
  assert.match(CS.A_fbPluginUrl(CS.A_PINNED.water, 10), /width=180&/);
});
test('A_fix F1/F4: hostile payload links are never drawn; the posts load only on a tap, are carried across redraws, and a new visit to the tab needs a new tap', async () => {
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
  const bad = await boot({ role: 'cleaner', hash: '#calendar/notices', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ sources: { water_page: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example', power_page: 'https://apps.facebook.com/x' } }) }) }) });
  assert.doesNotMatch(html(bad), /evil\.example|apps\.facebook|l\.facebook/); assert.match(html(bad), /href="https:\/\/www\.facebook\.com\/gscwaterdistrict\/"/, 'the pinned page stands in');
  const old = await boot({ role: 'cleaner', hash: '#calendar/notices', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: null, data: NOTICES_RAW({ sources: undefined }) }) }) });
  assert.doesNotMatch(html(old), /Check the (GSCWD|SOCOTECO II) page|fb-show/);
  assert.equal(D.build('owner', NOW).notices.sources.water_page, 'https://www.facebook.com/gscwaterdistrict/'); assert.equal(D.build('cleaner', NOW).notices.sources.power_page, 'https://www.facebook.com/socoteco2.EC/');
  // F4: carried across redraws (no second request), reset when the tab changes or the calendar is left
  let out = '', rendered = false, phase = 'idle'; const swaps = [], removed = [];
  const live = { tag: 'live', parentNode: { removeChild(n) { removed.push(n); } } }, fresh = { tag: 'fresh', parentNode: { replaceChild(n, o) { swaps.push([n, o]); phase = 'idle'; } } };
  const cal = { style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [], focus() {}, querySelector: (q) => (q !== '#A_fbbox' || !/<iframe|A_fbbox/.test(out) ? null : phase === 'fresh' ? fresh : live) };
  Object.defineProperty(cal, 'innerHTML', { get: () => out, set: (x) => { if (/A_fbbox/.test(out) && /id="A_fbbox"/.test(x)) phase = 'fresh'; out = x; rendered = true; } });
  const app = await boot({ role: 'cleaner', hash: '#calendar/notices', els: { 'v-calendar': cal }, handlers: baseHandlers('cleaner') });
  await app.click({ 'data-act': 'fb-show' }); assert.equal((out.match(/<iframe/g) || []).length, 1);
  await app.click({ 'data-nfilter': 'all' });
  assert.equal((out.match(/<iframe/g) || []).length, 0, 'the redraw writes no second iframe (no second request to Facebook)'); assert.ok(/id="A_fbbox"/.test(out));
  assert.equal(swaps.length, 1, 'the live node is put back'); assert.equal(swaps[0][0], live); assert.equal(removed[0], live);
  const go = (hash) => { app.location.hash = hash; for (const fn of app.winListeners.hashchange || []) fn(); };
  go('#calendar/stays'); go('#calendar/notices'); await app.flush();
  assert.doesNotMatch(out, /<iframe/); assert.match(out, /data-act="fb-show"/, 'coming back to the tab needs a new tap');
  await app.click({ 'data-act': 'fb-show' }); assert.equal((out.match(/<iframe/g) || []).length, 1);
  go('#home'); go('#calendar/notices'); await app.flush(); assert.doesNotMatch(out, /<iframe/, 'leaving the calendar resets it too');
});

test('A_fix pay rates: Add rate opens a confirm sheet; nothing is sent before Save rate; Go back keeps the typed values; exact RPC name and argument keys; owner/admin only', async () => {
  const RATES = { ok: true, today: TODAY, next: null, in_force: { id: 'r3', effective_from: '2026-09-30', regular_rate: 500, general_rate: 1000, transport_rate: 150, note: 'x' },
    history: [{ id: 'r3', effective_from: '2026-09-30', regular_rate: 500, general_rate: 1000, transport_rate: 150, note: 'x' }, { id: 'r2', effective_from: '2026-05-07', regular_rate: 650, general_rate: 1000, transport_rate: null, note: 'y' }, { id: 'r1', effective_from: '2025-09-08', regular_rate: 600, general_rate: 900, transport_rate: null, note: 'z' }] };
  const mk = (role) => boot({ role, hash: '#payrates', handlers: baseHandlers(role, { admin_pay_rates_v1: () => ({ error: null, data: RATES }), admin_add_pay_rate_v1: () => ({ error: null, data: { ok: true, id: 'r4' } }) }) });
  const app = await mk('owner'), page = () => app.els['v-payrates'].innerHTML, sent = () => app.calls.filter((c) => c[0] === 'admin_add_pay_rate_v1');
  assert.match(page(), />Add rate</); assert.match(page(), /You will confirm before it saves\./); assert.doesNotMatch(page(), /Save new rate/);
  assert.match(page(), /Show 2 earlier rates/); assert.equal((page().match(/class="rowi"/g) || []).length, 1, 'the latest entry first, the others behind the button');
  app.input('r-regular', '520'); app.input('r-general', '1050'); app.input('r-transport', '160'); app.input('r-note', 'Agreed');
  await app.click({ 'data-act': 'rate-save' });
  assert.equal(sent().length, 0, 'the RPC is not called by Add rate');
  const sheet = app.els['cs-body'].innerHTML;
  assert.match(sheet, /Save this rate\?/); assert.match(sheet, /520/); assert.match(sheet, /1,050/); assert.match(sheet, /160/); assert.match(sheet, /every cleaner/); assert.match(sheet, /6 Oct 2026|Oct 2026/); assert.match(sheet, /data-act="rate-confirm">Save rate</); assert.match(sheet, /data-act="rate-back">Go back</);
  assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'false');
  await app.click({ 'data-act': 'rate-back' });
  assert.equal(sent().length, 0); assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'true', 'Go back closes the sheet');
  await app.click({ 'data-act': 'rates-more' }); // a redraw: the form is rebuilt from state, so state must hold the typed values
  assert.match(page(), /id="r-regular" value="520"/); assert.match(page(), /id="r-note" value="Agreed"/, 'the typed values are still there');
  await app.click({ 'data-act': 'rate-save' }); assert.equal(sent().length, 0);
  await app.click({ 'data-act': 'rate-confirm' });
  assert.equal(sent().length, 1); assert.deepEqual(Object.keys(sent()[0][1]).sort(), ['p_effective_from', 'p_general', 'p_note', 'p_property_id', 'p_regular', 'p_transport']);
  assert.deepEqual(sent()[0][1], { p_property_id: 'prop-1', p_effective_from: '2026-10-15', p_regular: 520, p_general: 1050, p_transport: 160, p_note: 'Agreed' });
  assert.equal(app.els['cal-sheet'].getAttribute('aria-hidden'), 'true');
  // an empty form never opens the sheet, and nobody but owner/admin has the screen or the confirm
  const empty = await mk('admin'); await empty.click({ 'data-act': 'rate-save' }); assert.ok(!empty.els['cal-sheet'] || empty.els['cal-sheet'].getAttribute('aria-hidden') !== 'false', 'nothing to confirm yet');
  for (const role of ['finance', 'cleaner']) { const o = await mk(role); await o.click({ 'data-act': 'rate-confirm' }); assert.equal(o.calls.filter((c) => c[0] === 'admin_add_pay_rate_v1').length, 0, role); assert.equal(o.calls.filter((c) => c[0] === 'admin_pay_rates_v1').length, 0, role + ' never reads rates'); }
  const gone = await boot({ role: 'owner', hash: '#payrates', handlers: baseHandlers('owner', { admin_pay_rates_v1: () => ({ error: { code: 'PGRST202', message: 'x' }, data: null }) }) });
  assert.match(gone.els['v-payrates'].innerHTML, /available after the next update/); assert.doesNotMatch(gone.els['v-payrates'].innerHTML, /data-act="rate-save"/);
});
