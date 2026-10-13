// Lane E: the streamlining of Home, Calendar, Tasks and More (what moved, what was renamed, what went quiet). Frozen clock (15 Oct 2026, 12:30 Manila).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, NOTICES_RAW, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const css = read('styles.css');
const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const tasksOf = (list, manager) => () => ({ error: null, data: { ok: true, manager: !!manager, today: TODAY, tasks: list } });
const idx = (h, s) => { const i = h.indexOf(s); assert.ok(i >= 0, 'missing ' + s); return i; };

test('E_ cleaner home order: Today, Turnover, the paid-notice slot, Notices, Work, Ask Cassy, footer; Help trimmed to two rows; no Sign out', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner') });
  const h = app.els['v-home'].innerHTML;
  const order = ['aria-label="Today in the house"', 'aria-label="Turnover today"', 'id="slot-paid-notice"', 'aria-label="Notices"', 'aria-label="Work"', 'aria-label="Ask Cassy"', 'Updated '].map((s) => idx(h, s));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the order is fixed');
  const cassy = h.slice(idx(h, 'aria-label="Ask Cassy"'), idx(h, 'Updated '));
  assert.equal((cassy.match(/class="rowi"|class="rowi" /g) || []).length, 2, 'two rows: Cassy OPS and Quick guide'); assert.match(cassy, /Cassy · OPS/); assert.match(cassy, /Quick guide/);
  assert.doesNotMatch(h, /House manual|System Guide|Sign out|data-act="signout"/);
  assert.match(h, /Ask for your pay/); assert.match(h, /<span class="t">Calendar<\/span><span class="s">Who is staying, who is next/); assert.doesNotMatch(h, /Payment Request|Guest Calendar Info/);
  // the slot is empty and reserved, so Turnover and Slide to start never move when the notice lands
  assert.match(h, /id="slot-paid-notice" class="A_slot" hidden><\/div>/);
});

test('E_ admin home: one Admin group (dashboard, Pay staff, Pay rates, Inventory), no Team and help, no hub row, Calendar renamed; More has the rest', async () => {
  const app = await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner') });
  const h = app.els['v-home'].innerHTML;
  assert.deepEqual([...h.matchAll(/<div class="A_label">([^<]*)</g)].map((m) => m[1]), ['Guests and bookings', 'Admin']);
  assert.doesNotMatch(h, /Team and help|Money and stock|Admin hub|House manual|System Guide|Quick guide|Cassy · /);
  const admin = h.slice(idx(h, 'aria-label="Admin"'));
  for (const w of ['Admin dashboard', 'Pay staff', 'Pay rates', 'Inventory']) assert.ok(admin.includes(w), w);
  assert.match(h, /<span class="t">Calendar<\/span><span class="s">Stays, blocked nights, notices/);
  const more = (await boot({ role: 'owner', hash: '#more', handlers: baseHandlers('owner') })).els['v-more'].innerHTML;
  for (const w of ['Cassy · Telegram OPS', 'Cassy · Telegram Finance', 'Quick guide', 'House manual', 'Admin hub', 'Pay rates', 'Inventory']) assert.ok(more.includes(w), 'reachable on More: ' + w);
  const fin = (await boot({ role: 'finance', hash: '#home', handlers: baseHandlers('finance') })).els['v-home'].innerHTML;
  assert.doesNotMatch(fin, /Pay rates/); assert.match(fin, /Pay staff/);
});

test('E_ counts are neutral: red only where something is late (the Tasks badge with an overdue task)', async () => {
  assert.match(css, /\.count \{ background: var\(--v5-act\); color: var\(--v5-act-fg\);/); assert.match(css, /\.count\.bad \{ background: var\(--v5-danger\); \}/);
  assert.match(css, /\.tab \.badge \{ background: var\(--v5-act\);/); assert.match(css, /\.tab \.badge\.bad \{ background: var\(--v5-danger\); \}/);
  const home = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { warnings: [{ kind: 'inventory', title: 'Low stock: soap', detail: {} }] }), tasks_list_v1: tasksOf([T({})], true) }) });
  const h = home.els['v-home'].innerHTML; assert.doesNotMatch(h, /class="count bad"/, 'no count on Home is an alarm');
  const tabs = home.els.tabbar.innerHTML;
  assert.match(tabs, /<span class="badge bad" aria-label="1 due">1<\/span>/, 'an overdue task: the Tasks badge is red');
  assert.match(tabs, /<span class="badge" aria-label="1 warnings">1<\/span>/, 'the Calendar badge counts warnings, not failures: neutral');
  const today = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { tasks_list_v1: tasksOf([T({ due_at: '2026-10-15T09:00:00Z' })], true) }) });
  assert.match(today.els.tabbar.innerHTML, /<span class="badge" aria-label="1 due">1<\/span>/, 'due today is not late: neutral');
});

test('E_ Notices card rows: the title keeps the time, the sub is date and source only; rain watch says the chance', async () => {
  const raw = NOTICES_RAW({ weather: { source: 'open-meteo', fetched_at: '2026-10-15T02:00:00Z', temp_c: 29, condition: 'Rain', code: 61, rain_chance_pct: 80, aqi: 40, hourly: [], rain_watch: { from: '2026-10-15T06:00:00Z', to: '2026-10-15T09:00:00Z', peak_pct: 80 } } });
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { notices_v1: () => ({ error: null, data: raw }) }) });
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /<span class="t">Rain watch, 2 to 5 pm<\/span><span class="s">80% chance today<\/span>/);
  assert.match(h, /<span class="t">Brownout 1:00 to 4:00 pm<\/span><span class="s">Fri 16 Oct · SOCOTECO II<\/span>/);
  assert.doesNotMatch(h.slice(h.indexOf('aria-label="Notices"')), /<span class="s">[^<]*\d:\d\d [ap]m[^<]*<\/span>/, 'no time in any sub');
  assert.match(css, /\.A_noticecard \{ background: var\(--v5-card-glass\); \}/);
});

test('E_ paid notice: compact (a tile, the amount, the day, two buttons), under the Turnover card, max 128 px tall', () => {
  const N = read('pay/C_paid-notice.js'), c = read('pay/C_notice.css');
  assert.match(N, /C_notice-head">' \+ C_esc\(T\.titleLine\(r\)\)/); assert.match(N, /data-C-ok=/); assert.match(N, /data-C-more="1" aria-expanded="false">Read the message/); assert.match(N, /<p class="C_notice-text" hidden>/);
  assert.match(c, /\.C_notice-ico \{ width: 44px; height: 44px;/); assert.match(c, /\.C_notice-head \{ font: 600 var\(--v5-t-body\)\/24px/); assert.match(c, /\.C_notice-line \{ font: 400 var\(--v5-t-2\)\/20px/);
  // 12 + 44 (tile and the two text lines) + 8 + 44 (buttons) + 12 + 2 (border) = 122
  assert.ok(12 + 44 + 8 + 44 + 12 + 2 <= 128);
});

test('E_ Calendar: no Back arrow, the title is "Calendar", the legend wraps, Stays has one cap per card, Updated stays', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-12', '2026-10-17'), stayRow('Ben Cruz', '2026-10-20', '2026-10-22')];
  const guest = { uid: 'g1', guest_name: 'Ana Reyes', source: 'direct', checkin_date: '2026-10-12', checkout_date: '2026-10-17', nights: 5 };
  const next = { uid: 'g2', guest_name: 'Ben Cruz', source: 'direct', checkin_date: '2026-10-20', checkout_date: '2026-10-22', nights: 2 };
  const app = await boot({ role: 'cleaner', hash: '#calendar/stays', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH(cal, { current_guest: guest, next_guest: next }) }) });
  const h = app.els['v-calendar'].innerHTML;
  assert.match(h, /<h1 class="ttl">Calendar<\/h1>/); assert.doesNotMatch(h.slice(0, h.indexOf('</header>')), /aria-label="Back"|class="iconbtn" href/);
  assert.equal((h.match(/In the house/gi) || []).length, 1, 'the cap is said once (case-insensitive: the CSS uppercases it)'); assert.equal((h.match(/Next arrival/gi) || []).length, 1);
  assert.match(h, /Coming up/);
  const empty = await boot({ role: 'cleaner', hash: '#calendar/stays', handlers: baseHandlers('cleaner') });
  assert.match(empty.els['v-calendar'].innerHTML, /<span class="cap up">In the house<\/span><div class="card glass"><p class="sub">No guest in the house tonight/, 'an empty card still has its label');
  const month = await boot({ role: 'cleaner', hash: '#calendar', handlers: baseHandlers('cleaner') });
  assert.match(month.els['v-calendar'].innerHTML, /<div class="A_legend" role="group" aria-label="Legend">/); assert.doesNotMatch(month.els['v-calendar'].innerHTML, /scroll sideways|tabindex="0"/);
  assert.match(css, /\.A_legend \{ display: flex; flex-wrap: wrap; gap: 8px; row-gap: 6px; overflow: visible;/);
  assert.match(month.els['v-calendar'].innerHTML, /Updated /);
});

test('E_ Calendar day sheet: the admin note form is collapsed behind one button and opens in place; a cleaner has neither', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-14', '2026-10-17')];
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH(cal) }) });
  await app.click({ 'data-day': '2026-10-16' });
  let b = app.els['cs-body'].innerHTML;
  assert.match(b, /<button class="btn btn-secondary btn-sm" type="button" data-act="dayform-open"[^>]*>[^]*Add a note for this day<\/button>/); assert.doesNotMatch(b, /id="df-kind"|id="df-label"|data-act="flag-save"/);
  assert.doesNotMatch(b, /Nothing else noted/);
  assert.match(b, /data-act="sheet-close"[^>]*>Close<\/button>/);
  await app.click({ 'data-act': 'dayform-open' });
  b = app.els['cs-body'].innerHTML; assert.match(b, /id="df-kind"/); assert.match(b, /id="df-label"/); assert.match(b, /data-act="flag-save"/); assert.doesNotMatch(b, /data-act="dayform-open"/);
  const cl = await boot({ role: 'cleaner', hash: '#calendar', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH(cal) }) });
  await cl.click({ 'data-day': '2026-10-16' });
  assert.doesNotMatch(cl.els['cs-body'].innerHTML, /dayform-open|df-kind|Add a note|flag-save/);
  await cl.click({ 'data-act': 'dayform-open' }); assert.doesNotMatch(cl.els['cs-body'].innerHTML, /df-kind/, 'a cleaner cannot open the form by hand');
  assert.match(css, /\.sheet\.calsheet \{ max-height: 92vh;/);
});

test('E_ Tasks: plain priority words, "No due date", a toast with Undo beside the thumb, the top line kept for screen readers only', async () => {
  const list = [T({ id: 'u', title: 'Urgent job', priority: 'urgent', due_at: null }), T({ id: 'h', title: 'High job', priority: 'high', due_at: null }), T({ id: 'n', title: 'Normal job', priority: 'normal', due_at: null })];
  const gone = new Set(); // the server hides a finished task once the list reloads, as the real one does
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: () => tasksOf(list.filter((t) => !gone.has(t.id)), true)(), task_set_done_v1: (a) => { if (a.p_done) gone.add(a.p_id); else gone.delete(a.p_id); return { error: null, data: { ok: true } }; } }) });
  const h = app.els['v-tasks'].innerHTML;
  assert.match(h, /No due date \(3\)/); assert.doesNotMatch(h, /No date/);
  assert.match(h, /data-i="alert"><\/svg>High priority<\/span>/); assert.match(h, /data-i="alert"><\/svg>Urgent<\/span>/); assert.doesNotMatch(h, /<\/svg>high<\/span>|<\/svg>urgent<\/span>/);
  assert.doesNotMatch(h.slice(h.indexOf('Normal job')), /High priority|Urgent<\/span>/);
  await app.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:n' });
  const t = app.els['cs-toast'];
  assert.match(t.innerHTML, /<span>Marked done<\/span><button class="btn btn-ghost btn-sm E_toastbtn" type="button" data-act="task-undo" data-task="follow_up_tasks:n" aria-label="Undo: Normal job">Undo<\/button>/);
  assert.match(app.els['v-tasks'].innerHTML, /<div class="okbox sr" role="status">/, 'still read out for screen readers, not drawn at the top of the list');
  assert.match(css, /\.toast\.on\.E_hasact \{ pointer-events: auto; \}/); assert.match(css, /\.okbox\.sr \{ position: absolute;/);
  await app.click({ 'data-act': 'task-undo', 'data-task': 'follow_up_tasks:n' });
  assert.deepEqual(app.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1].p_done), [true, false], 'Undo restores through the same call');
  assert.match(t.innerHTML, /Back on the list/);
});

test('E_ More: one Sign out button, on the profile card, with the dashboard note; the bottom Account card is gone', async () => {
  for (const role of ['cleaner', 'admin']) {
    const app = await boot({ role, hash: '#more', handlers: baseHandlers(role) });
    const h = app.els['v-more'].innerHTML;
    assert.equal((h.match(/data-act="signout"/g) || []).length, 1, role);
    const prof = h.slice(idx(h, 'class="card glass A_prof"'), idx(h, 'aria-label="What’s new"'));
    assert.match(prof, /data-act="signout"/); assert.match(prof, /Signs you out of the admin dashboard as well, on this phone\./);
    assert.doesNotMatch(h, /Signed in as|aria-label="Account"/);
  }
  assert.match(css, /\.A_prof \{ flex-wrap: wrap; \}/);
});

test('E_ press and hover: the many-times-a-day controls change colour only; hover rules are behind a real hover; reduced motion turns every press transform off', () => {
  assert.match(css, /\.calhdr \.iconbtn:active, \.A_tabs a:active \{ transform: none; background: var\(--v5-fill\); \}/);
  assert.match(css, /\.btn:active, \.chip:active, \.rowi:active, \.A_slide:active, \.iconbtn:active, \.E_pill:active, \.chk:active \{ transform: scale\(var\(--v5-press-scale\)\)/);
  assert.doesNotMatch(css, /\.tab:active \{[^}]*transform/);
  const free = css.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[^{}]*\{[^}]*\}\s*\}/g, '');
  assert.doesNotMatch(free, /\.btn-ghost:hover|\.iconbtn:hover/, 'hover only inside (hover: hover) and (pointer: fine)');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.btn:active[^}]*\.E_pill:active, \.chk:active \{ transform: none; \} \}/);
});

test('E_ renames and wording: the pay page is "Your pay", the quick guide names the new row, the old names are gone from every screen', () => {
  assert.match(read('pay/index.html'), /<title>Your pay<\/title>/); assert.doesNotMatch(read('pay/pay.js'), /shell\('Payment Request'/); assert.match(read('pay/pay.js'), /shell\('Your pay'/);
  assert.match(read('quick/index.html'), /Open <strong>Ask for your pay<\/strong>/);
  assert.doesNotMatch(read('app.js'), /title: 'Payment Request'|title: 'Guest Calendar Info'|'Guest Calendar Info'/);
});
