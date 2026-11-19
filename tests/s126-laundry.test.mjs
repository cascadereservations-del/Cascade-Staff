// s126 (Staff 3.4.41): the laundry role sees only Today and Inventory. Every other role is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const ROLES = ['owner', 'admin', 'finance', 'cleaner', 'inspector', 'maintenance'];
const home = (role, hash = '#home', extra) => boot({ role, hash, handlers: baseHandlers(role, Object.assign({ staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17', { checkin_time: '14:00', checkout_time: '12:00' })]) }, extra || {})) });
const OVERDUE = { tasks_list_v1: () => ({ error: null, data: { ok: true, manager: false, today: TODAY, tasks: [{ id: 't1', source: 'tasks', title: 'Wash the curtains', status: 'open', due_at: '2026-10-13T01:00:00Z', kind: 'task' }] } }) };

test('s126 tab bar: laundry has Today and Inventory; every other role keeps the five tabs', () => {
  assert.deepEqual(CS.tabKeys('laundry'), ['home', 'stock']);
  for (const r of ROLES) assert.deepEqual(CS.tabKeys(r), ['home', 'calendar', 'tasks', 'kpis', 'more'], r);
});

test('s126 route rule: laundry lands on Today for hidden screens; the guest card, Notices, weather, stock and supply stay; other roles are untouched', () => {
  for (const v of ['kpis', 'more', 'hub', 'search', 'tasks', 'reply']) assert.equal(CS.laundryView('laundry', v, ''), 'home', v);
  assert.equal(CS.laundryView('laundry', 'calendar', ''), 'home'); assert.equal(CS.laundryView('laundry', 'calendar', 'warnings'), 'home'); assert.equal(CS.laundryView('laundry', 'calendar', 'stays'), 'home');
  for (const sub of ['house', 'next', 'notices']) assert.equal(CS.laundryView('laundry', 'calendar', sub), 'calendar', sub);
  for (const v of ['home', 'stock', 'supply', 'weather']) assert.equal(CS.laundryView('laundry', v, ''), v, v);
  for (const r of ROLES.concat(['', null, undefined])) for (const v of ['kpis', 'more', 'hub', 'search', 'tasks', 'reply', 'calendar', 'home']) assert.equal(CS.laundryView(r, v, ''), v, r + ' ' + v);
});

test('s126 Today for laundry: no hazard strip, tier guide or Shortcuts; Sign out above the footer; the rest stays', async () => {
  const h = (await home('laundry')).els['v-home'].innerHTML;
  assert.doesNotMatch(h, /Shortcuts|T_tiers|U_bar|aria-label="Work"|aria-label="Ask Cassy"|Cassy · OPS|House manual/);
  assert.match(h, /Guests/); assert.match(h, /id="K_inv"/); assert.match(h, /aria-label="Notices"/);
  const out = h.indexOf('data-act="signout"'), foot = h.indexOf('Updated ');
  assert.ok(out > 0 && foot > out, 'the Sign out row sits just above the footer line');
  assert.match(h, /<nav class="card glass list F_span" aria-label="Account"><button class="rowi" type="button" data-act="signout">[\s\S]*?<span class="t">Sign out<\/span><span class="s">[^<]*<\/span>/);
  for (const r of ['cleaner', 'owner']) { const o = (await home(r)).els['v-home'].innerHTML; assert.match(o, /Shortcuts/, r); assert.doesNotMatch(o, /data-act="signout"/, r + ': Sign out stays on More'); }
});

test('s126 router: laundry typed or stale links to hidden screens render Today; a cleaner still gets the screen', async () => {
  for (const hash of ['#kpis', '#more', '#hub', '#search', '#tasks', '#reply', '#calendar', '#calendar/warnings']) {
    const e = (await home('laundry', hash)).els; assert.match(e['v-home'].innerHTML, /K_inv/, hash + ' shows Today');
    for (const v of ['kpis', 'more', 'hub', 'search', 'tasks', 'reply']) assert.equal(e['v-' + v] ? e['v-' + v].innerHTML : '', '', hash + ' draws no ' + v);
    assert.doesNotMatch(e['v-calendar'] ? e['v-calendar'].innerHTML : '', /A_tabs/, hash);
  }
  assert.match((await home('cleaner', '#tasks')).els['v-tasks'].innerHTML, /\S/, 'a cleaner keeps Tasks');
  assert.match((await home('cleaner', '#more')).els['v-more'].innerHTML, /Sign out/, 'a cleaner keeps More');
  assert.match((await home('cleaner', '#calendar')).els['v-calendar'].innerHTML, /A_tabs/, 'a cleaner keeps the Calendar tab strip');
});

test('s126 laundry kept screens: the guest card and Notices draw, with no tab strip and no link to the hidden Calendar tab', async () => {
  for (const hash of ['#calendar/house', '#calendar/next', '#calendar/notices']) {
    const c = (await home('laundry', hash)).els['v-calendar'].innerHTML; assert.match(c, /\S/, hash); assert.doesNotMatch(c, /A_tabs|data-act="cal-tab"|data-act="notice-cal"/, hash);
  }
});

test('s126 laundry pill: an overdue task is not counted (its link would land on Today); a cleaner still sees it', async () => {
  const lbl = async (r) => ((await home(r, '#home', OVERDUE)).els['v-home'].innerHTML.match(/<span class="E_lbl">([^<]*)</) || [])[1];
  assert.match(await lbl('cleaner'), /overdue/i); assert.doesNotMatch(await lbl('laundry'), /overdue/i);
});

test('s126 laundry words: the tour and What\'s new name no tab she lacks; the tour is one card; other roles keep both lists', () => {
  const n = CS.A_whatsNew('laundry', { notices: true }); assert.equal(n.length, 1); assert.match(n[0].text, /Today and Inventory/); assert.doesNotMatch(JSON.stringify(n), /Calendar|Tasks|More|Search/);
  for (const r of ['cleaner', 'owner']) assert.ok(CS.A_whatsNew(r, {}).length > 10, r);
  assert.match(read('app.js'), /function H_tourSteps\(\) \{ return CS\.isLaundry\(role\(\)\) \? \[\['Today'/);
});

test('s126 release: 3.4.41 with cs-shell-v66', () => {
  assert.match(read('app.js'), /version: '3\.4\.41'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v66'/); assert.match(read('package.json'), /"version": "3\.4\.41"/); assert.match(read('README.md'), /cs-shell-v66/);
});
