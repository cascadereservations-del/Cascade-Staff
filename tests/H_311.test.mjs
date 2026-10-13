// Lane H, release 3.1.1: Undo that survives a slow read, earlier months, the Cassy wait, the weather line, Add a notice from Today, More in two even columns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, D, read, boot, HOMEWITH, baseHandlers, NOTICES_RAW, stayRow, TODAY } from './_a_harness.mjs';

const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const list = (tasks, manager) => ({ error: null, data: { ok: true, manager: !!manager, today: TODAY, tasks } });
const monthOf = (app) => (/<h2 class="dlg"[^>]*>([^<]+)<\/h2>/.exec(app.els['v-calendar'].innerHTML) || [])[1];

// ------------------------------------------------------------------------------------------------ 1. Undo
test('3.1.1 Undo: the task is back even when the slow read from the first tap lands after the read that followed Undo; the un-done call is sent once', async () => {
  let open = true, hold = false; const held = [];
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', {
    tasks_list_v1: () => { const snap = list(open ? [T({})] : [], true); return hold ? new Promise((res) => held.push(() => res(JSON.parse(JSON.stringify(snap))))) : snap; },
    task_set_done_v1: (a) => { open = !a.p_done; return { error: null, data: { ok: true } }; } }) });
  hold = true; await app.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' }); // the first tap (a swipe or the box: one path); its re-read is slow
  assert.doesNotMatch(app.els['v-tasks'].innerHTML, /data-E-swipe="task-done"[^>]*data-task="follow_up_tasks:a"/, 'the row left the list');
  hold = false; await app.click({ 'data-act': 'task-undo', 'data-task': 'follow_up_tasks:a' });
  assert.match(app.els['v-tasks'].innerHTML, /data-E-swipe="task-done"[^>]*data-task="follow_up_tasks:a"/, 'Undo brought it back');
  held.forEach((f) => f()); await app.flush();
  assert.match(app.els['v-tasks'].innerHTML, /data-E-swipe="task-done"[^>]*data-task="follow_up_tasks:a"/, 'the stale read that landed last did not take it away again');
  assert.deepEqual(app.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1].p_done), [true, false], 'done once, un-done once');
});

test('3.1.1 Undo: the writes for one task go out in the order of the taps, even when the first is slow', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const app = await boot({ role: 'admin', hash: '#tasks', handlers: baseHandlers('admin', { tasks_list_v1: () => list([T({})], true), task_set_done_v1: (a) => (a.p_done ? gate.then(() => ({ error: null, data: { ok: true } })) : { error: null, data: { ok: true } }) }) });
  await app.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:a' }); await app.click({ 'data-act': 'task-undo', 'data-task': 'follow_up_tasks:a' });
  assert.deepEqual(app.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1].p_done), [true], 'Undo waits for the first write');
  release(); await app.flush(); assert.deepEqual(app.calls.filter((c) => c[0] === 'task_set_done_v1').map((c) => c[1].p_done), [true, false]);
  const src = read('app.js'); assert.match(src, /var gen = \+\+H_tasksGen/); assert.match(src, /H_serial\(key, function \(\)/); assert.match(src, /act \? 7000 : 2000/, 'the Undo toast stays 7 s');
});

test('3.1.1 Undo in the demo: a task marked done leaves the list and Undo brings it back (memory only)', async () => {
  const sb = D.client('owner'); await sb.rpc('task_set_done_v1', { p_id: 'demo-t4', p_done: true });
  assert.ok(!(await sb.rpc('tasks_list_v1', { p_include_done: false })).data.tasks.some((t) => t.id === 'demo-t4')); assert.ok((await sb.rpc('tasks_list_v1', { p_include_done: true })).data.tasks.some((t) => t.id === 'demo-t4' && t.status === 'done'));
  await sb.rpc('task_set_done_v1', { p_id: 'demo-t4', p_done: false }); assert.ok((await sb.rpc('tasks_list_v1', { p_include_done: false })).data.tasks.some((t) => t.id === 'demo-t4'));
});

// ------------------------------------------------------------------------------------------------ 2. earlier months
test('3.1.1 calendar: Previous is available back a year; days the server cannot tell us about are dashed, never free; the older-stays line points to the dashboard', async () => {
  const cal = [stayRow('Ana Reyes', '2026-10-12', '2026-10-17')];
  const a = await boot({ role: 'admin', hash: '#calendar', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH(cal) }) });
  assert.doesNotMatch(a.els['v-calendar'].innerHTML, /data-act="prev"[^>]*disabled/, 'Previous is not disabled in October');
  await a.click({ 'data-act': 'prev' }); const h = a.els['v-calendar'].innerHTML; assert.equal(monthOf(a), 'September 2026');
  assert.match(h, /Stays before 8 Oct are in the admin dashboard\./); assert.match(h, /Open the booking calendar/);
  assert.match(h, /class="d s-free nodata past"[^>]*data-day="2026-09-10"[^>]*aria-label="[^"]*no stay information here"/); assert.doesNotMatch(h, /data-day="2026-09-10"[^>]*, free"/);
  await a.click({ 'data-act': 'next' }); assert.equal(monthOf(a), 'October 2026'); assert.match(a.els['v-calendar'].innerHTML, /H_older/, 'October starts before the week the server sends, so it says so too'); assert.match(a.els['v-calendar'].innerHTML, /data-day="2026-10-05"[^>]*no stay information here/);
  for (let i = 0; i < 14; i++) await a.click({ 'data-act': 'prev' }); assert.equal(monthOf(a), 'October 2025', 'a year back, then the arrow is disabled'); assert.match(a.els['v-calendar'].innerHTML, /data-act="prev"[^>]*disabled/);
  const c = await boot({ role: 'cleaner', hash: '#calendar', handlers: baseHandlers('cleaner') }); await c.click({ 'data-act': 'prev' });
  assert.match(c.els['v-calendar'].innerHTML, /Stays before 8 Oct are not shown here\./); assert.doesNotMatch(c.els['v-calendar'].innerHTML, /Open the booking calendar/, 'no dashboard link for a cleaner');
  await a.click({ 'data-act': 'next' }); await a.click({ 'data-day': '2026-10-05' }); assert.match(a.els['cs-body'].innerHTML, /Not shown here/, 'the day sheet does not call an unknown day free');
});

// ------------------------------------------------------------------------------------------------ 3. the Cassy wait
test('3.1.1 Cassy reply: a calm honest wait with the usual time and Cancel; the form stays and is locked; a late answer after Cancel is ignored; nothing is retyped', async () => {
  let answer; const fetcher = (u) => (/guest-reply-draft/.test(String(u)) ? new Promise((res) => { answer = res; }) : Promise.resolve({ ok: false }));
  const app = await boot({ role: 'cleaner', hash: '#reply', foldFetch: fetcher, handlers: baseHandlers('cleaner') });
  await app.click({ 'data-act': 'reply-mode', 'data-mode': 'text' }); app.input('rp-text', 'Is early check-in possible?'); app.input('rp-name', 'Ana'); await app.click({ 'data-act': 'reply-send' });
  const h = app.els['rp-body'].innerHTML;
  assert.match(h, /Cassy is writing/); assert.match(h, /id="rp-step"[^>]*>Reading the message</); assert.match(h, /Usually 10 to 20 seconds/); assert.match(h, /data-act="reply-cancel"/); assert.match(h, /H_bar/);
  assert.match(h, /data-act="reply-send" disabled>Writing…</); assert.match(h, /<textarea[^>]*disabled[^>]*>Is early check-in possible\?<\/textarea>/); assert.match(h, /value="Ana" autocomplete="off" disabled/); assert.doesNotMatch(h, /data-act="reply-back"/);
  await app.click({ 'data-act': 'reply-cancel' }); const c = app.els['rp-body'].innerHTML;
  assert.doesNotMatch(c, /Cassy is writing/); assert.match(c, /Is early check-in possible\?<\/textarea>/); assert.doesNotMatch(c, /<textarea[^>]*disabled/); assert.match(c, /value="Ana"/); assert.match(c, /data-act="reply-send">Write the reply</);
  answer({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, options: [{ label: 'Short', text: 'A' }, { label: 'Warm', text: 'B' }, { label: 'With details', text: 'C' }] }) }); await app.flush();
  assert.doesNotMatch(app.els['rp-body'].innerHTML, /Replying to|H_draft/, 'the late answer was ignored'); assert.match(app.els['rp-body'].innerHTML, /Is early check-in possible\?/);
  const src = read('app.js'); assert.match(src, /class="H_thumb" alt="The screenshot Cassy is reading"/, 'a screenshot shows its thumbnail while waiting'); assert.match(read('styles.css'), /@media \(prefers-reduced-motion: reduce\) \{ \.H_bar i \{ animation: none;/);
  assert.equal(CS.H_waitStep(0), 'Reading the message'); assert.equal(CS.H_waitStep(4), 'Writing three replies'); assert.equal(CS.H_waitStep(11), 'Writing three replies'); assert.equal(CS.H_waitStep(12), 'Almost there'); assert.equal(CS.H_waitStep(60), 'Almost there');
});

test('3.1.1 Cassy reply: an answer that arrives in time still draws the replies', async () => {
  const fetcher = (u) => Promise.resolve(/guest-reply-draft/.test(String(u)) ? { ok: true, status: 200, json: () => Promise.resolve({ ok: true, guest_text: 'Hi', options: [{ label: 'Short', text: 'A' }, { label: 'Warm', text: 'B' }] }) } : { ok: false });
  const app = await boot({ role: 'owner', hash: '#reply', foldFetch: fetcher, handlers: baseHandlers('owner') }); await app.click({ 'data-act': 'reply-mode', 'data-mode': 'text' }); app.input('rp-text', 'Hi'); await app.click({ 'data-act': 'reply-send' });
  assert.match(app.els['rp-body'].innerHTML, /Replying to/); assert.equal((app.els['rp-body'].innerHTML.match(/H_draft/g) || []).length, 2);
});

// ------------------------------------------------------------------------------------------------ 4. the weather line
test('3.1.1 hero weather: a failed refresh (refused, offline, or an empty answer) never blanks the line', async () => {
  const wx = { fetched_at: '2026-10-14T00:00:00Z', current: { temp: 29, description: 'Partly cloudy' } };
  for (const how of ['reject', 'refused', 'empty']) {
    const fetcher = (u) => (/weather-proxy/.test(String(u)) ? (how === 'reject' ? Promise.reject(new TypeError('Failed to fetch')) : how === 'refused' ? Promise.resolve({ ok: false, status: 403 }) : Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) : Promise.resolve({ ok: false }));
    const app = await boot({ role: 'cleaner', hash: '#home', foldFetch: fetcher, handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { weather: wx }) }) });
    assert.match(app.els['v-home'].innerHTML, /class="H_wxa"[^>]*>[^]*29° partly cloudy/, how + ': the line is still there');
  }
});

// ------------------------------------------------------------------------------------------------ 5. Add a notice from Today
test('3.1.1 notices: Today has a visible Add a notice button for owner and admin; the form leads with Water and Power; the whole flow is three taps from Home', async () => {
  const h = async (role) => (await boot({ role, hash: '#home', handlers: baseHandlers(role) }));
  for (const role of ['owner', 'admin']) assert.match((await h(role)).els['v-home'].innerHTML, /<button class="btn btn-secondary btn-block H_addrow" type="button" data-act="notice-add-open"[^>]*>[^]*Add a notice<\/button>/, role);
  for (const role of ['cleaner', 'finance']) assert.doesNotMatch((await h(role)).els['v-home'].innerHTML, /H_addrow/, role + ' has no button');
  // water: tap 1 the button, tap 2 the title field (typing), tap 3 Add notice
  const w = await h('owner'); await w.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); const f = w.els['cs-body'].innerHTML;
  assert.ok(f.indexOf('data-kind="water"') > 0 && f.indexOf('data-kind="water"') < f.indexOf('data-kind="power"') && f.indexOf('data-kind="power"') < f.indexOf('id="n-title"'), 'Water and Power come first, then the title');
  assert.match(f, /data-kind="water" aria-pressed="true"/, 'Water is already chosen'); assert.match(f, new RegExp('id="n-date" type="date" value="' + TODAY + '"'), 'today is already the date');
  w.input('n-title', 'No water 9 am to 3 pm'); await w.click({ 'data-act': 'notice-add-save' });
  assert.deepEqual(w.calls.find((c) => c[0] === 'ops_notice_add_v1')[1], { p_property_id: 'prop-1', p_type: 'water', p_title: 'No water 9 am to 3 pm', p_date: TODAY, p_start_time: null, p_duration_hours: null, p_detail: null });
  const p = await h('admin'); await p.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); await p.click({ 'data-act': 'nkind', 'data-kind': 'power' }); assert.match(p.els['cs-body'].innerHTML, /data-kind="power" aria-pressed="true"/); assert.match(p.els['cs-body'].innerHTML, /Saved as a brownout on that day/);
  p.input('n-title', 'Brownout 1 to 4 pm'); await p.click({ 'data-act': 'notice-add-save' });
  assert.deepEqual(p.calls.find((c) => c[0] === 'calendar_day_flag_set_v1')[1], { p_property_id: 'prop-1', p_date: TODAY, p_kind: 'brownout', p_label: 'Brownout 1 to 4 pm' }); assert.equal(p.calls.filter((c) => c[0] === 'ops_notice_add_v1').length, 0, 'the notice call refuses power, so it is not used');
  assert.equal(p.els['cal-sheet'].getAttribute('aria-hidden'), 'true'); assert.equal(CS.H_powerProblem({ title: '', date: TODAY }), 'Add a short title, for example the hours.'); assert.equal(CS.H_powerProblem({ title: 'x'.repeat(61), date: TODAY }), 'Keep the title to 60 characters.');
  await w.click({ 'data-act': 'notice-add-open', 'data-date': TODAY }); assert.match(w.els['cs-body'].innerHTML, /Or another kind/);
});

// ------------------------------------------------------------------------------------------------ 6. More in two even columns
test('3.1.1 More: every group has a caps label; the groups are dealt into two stacks that end at about the same height; You closes the page under both', async () => {
  const labels = (h) => [...h.matchAll(/<div class="A_label">([^<]+)<\/div>/g)].map((m) => m[1]);
  for (const [role, cols] of [['cleaner', [['Search', 'How we do things', 'Cassy'], ['Appearance', 'Help', 'This phone']]], ['owner', [['Search', 'How we do things', 'Cassy', 'Admin'], ['Appearance', 'Help', 'This phone']]]]) {
    const h = (await boot({ role, hash: '#more', handlers: baseHandlers(role) })).els['v-more'].innerHTML;
    assert.equal((h.match(/class="H_cols"/g) || []).length, 1); assert.equal((h.match(/class="H_col"/g) || []).length, 2, 'two stacks (CSS makes it one under 600 px)');
    const parts = h.split('<div class="H_col">'), stack = (x) => labels(x.slice(0, x.indexOf('H_you') > 0 ? x.indexOf('H_you') : x.length));
    assert.deepEqual(stack(parts[1]), cols[0], role + ' left'); assert.deepEqual(stack(parts[2].slice(0, parts[2].indexOf('class="F_group H_you"'))), cols[1], role + ' right');
    assert.deepEqual(labels(h), [...cols[0], ...cols[1], 'You'], 'every group is labelled, in reading order'); assert.ok(h.indexOf('class="F_group H_you"') > h.lastIndexOf('H_col'), 'You is its own closing section'); assert.equal((h.match(/<div class="A_label">/g) || []).length, (h.match(/<nav class="card glass list"|<section class="card glass"|<div class="card glass A_prof"/g) || []).length, 'one label per card');
  }
  const css = read('styles.css'); assert.match(css, /\.H_cols \{ display: grid; gap: var\(--v5-gap\); grid-template-columns: minmax\(0, 1fr\); \}/); assert.match(css, /@media \(min-width: 37\.5rem\) \{\s*\.H_cols \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); align-items: start; \}/);
  assert.doesNotMatch(css, /#v-more \.stack > \.A_prof|#v-more \.stack \{ grid-template-columns: repeat\(2/, 'no row-aligned grid on More');
});

test('3.1.1 version: 3.1.1, cache v19, What is new names the new things for the right roles', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.1.1'); assert.match(read('app.js'), /version: '3\.1\.1'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v19'/); assert.match(read('README.md'), /cs-shell-v19/);
  const titles = (role) => CS.A_whatsNew(role, { notices: true }).map((i) => i.title);
  for (const r of ['cleaner', 'owner']) for (const t of ['Undo works every time', 'Earlier months', 'Cassy reply shows its progress', 'Better on a tablet']) assert.ok(titles(r).includes(t), r + ': ' + t);
  assert.ok(titles('owner').includes('Add a notice from Today')); assert.ok(!titles('cleaner').includes('Add a notice from Today')); assert.match(CS.A_whatsNew('cleaner', {}).find((i) => i.title === 'Earlier months').text, /not shown here/); assert.match(CS.A_whatsNew('owner', {}).find((i) => i.title === 'Earlier months').text, /admin dashboard/);
});

test('3.1.1 layout: the scroll area always clears the tab bar and the safe area; every wide stack uses the one 60 rem width; the month sits beside the next 14 days from 840 px', () => {
  const css = read('styles.css'); assert.match(css, /\.screen \{ padding: 0 var\(--gutter\) calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom\) \+ 24px\);/, 'bottom padding = tab bar + safe area + 24 px at every width');
  assert.match(css, /#v-more \.screen, #v-calendar \.screen, #v-search \.screen \{ max-width: 60rem; margin-left: auto; margin-right: auto; \}/); assert.match(css, /\.H_mod \{ max-width: 60rem; margin: 0 auto; \}/);
  assert.match(css, /#v-calendar \[data-F-tab="calendar"\] \{ display: grid; grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, 1fr\);/); assert.match(css, /\.H_calleft \{ position: sticky;/);
  assert.match(css, /\.A_body \{ display: block; column-count: 2; column-gap: var\(--v5-gap\);/); assert.match(css, /\.A_body > \* \{ break-inside: avoid; margin-bottom: var\(--v5-gap\); \}/);
  assert.match(read('app.js'), /var H_MORE_ORDERS = \[/);
});
