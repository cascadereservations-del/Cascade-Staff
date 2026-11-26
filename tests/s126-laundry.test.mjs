// s126 (Staff 3.4.41): the laundry role sees only Today and Inventory. Every other role is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY, NOTICES_RAW } from './_a_harness.mjs';

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

test('s126 release: 3.4.57 with cs-shell-v84', () => {
  assert.match(read('app.js'), /version: '3.4.57'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v84'/); assert.match(read('package.json'), /"version": "3.4.57"/); assert.match(read('README.md'), /cs-shell-v84/);
});

// ---- fix round 1
const FAILHOME = { staff_home_v1: () => ({ error: { message: 'boom' }, data: null }) };
const mem = (init) => { const m = new Map(Object.entries(init || {})); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const tour = async (role, init) => { const ls = mem(init); const app = await boot({ role, hash: '#home', tour: true, tourDelay: 0, ls, handlers: baseHandlers(role) }); await app.flush(); await new Promise((r) => setTimeout(r, 20)); return { app, ls }; };

test('s126 r1 sign out: laundry can sign out when Today failed to load; a cleaner in the same state cannot', async () => {
  const l = (await boot({ role: 'laundry', hash: '#home', handlers: baseHandlers('laundry', FAILHOME) })).els['v-home'].innerHTML;
  assert.match(l, /data-act="signout"/);
  const c = (await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', FAILHOME) })).els['v-home'].innerHTML;
  assert.doesNotMatch(c, /data-act="signout"/);
});

test('s126 r1 redirect: a hidden hash is replaced by #home (once); kept screens keep their hash; a cleaner keeps hers', async () => {
  for (const hash of ['#more', '#tasks', '#calendar', '#calendar/warnings']) assert.equal((await home('laundry', hash)).location.hash, '#home', hash);
  for (const hash of ['#calendar/notices', '#calendar/house']) assert.equal((await home('laundry', hash)).location.hash, hash, hash);
  assert.equal((await home('cleaner', '#tasks')).location.hash, '#tasks');
});

test('s126 r1 links: laundry sees every warning in the sheet and no See all row; a cleaner keeps See all and #calendar/warnings', async () => {
  const W = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'power', key: 'w' + i, title: 'Warning ' + i, date: TODAY }));
  const sheet = async (role) => { const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([], { warnings: W(9) }) }) }); await app.click({ 'data-act': 'attn-open' }); return app.els['cs-body'].innerHTML; };
  const l = await sheet('laundry');
  for (let i = 0; i < 9; i++) assert.match(l, new RegExp('Warning ' + i + '<'), 'laundry sheet lists warning ' + i);
  assert.doesNotMatch(l, /E_more|See all|#calendar\/warnings/, 'no See all row for laundry');
  const c = await sheet('cleaner');
  assert.match(c, /<a class="rowi E_more" href="#calendar\/warnings"[^>]*><span class="mid"><span class="t">See all 9</, 'a cleaner keeps See all 9 to Warnings');
  assert.doesNotMatch(c, /Warning 8</, 'a cleaner sees only the first rows');
});

test('s126 r1 links: "Notices are not set up" gives laundry a plain card with no link; a cleaner keeps See warnings to #calendar/warnings', async () => {
  const absent = { notices_v1: () => ({ error: { code: 'PGRST202', message: 'Could not find the function' }, data: null }) };
  const page = async (role) => { const app = await boot({ role, hash: '#calendar/notices', handlers: baseHandlers(role, absent) }); return app.els['v-calendar'].innerHTML; };
  const l = await page('laundry');
  assert.match(l, /<div class="card glass"><p class="sub">Notices are not set up yet\. Brownouts and the weather still show on Today\.<\/p><\/div>/);
  assert.doesNotMatch(l, /href=|See warnings|Stays|Warnings/, 'no link, no screen she cannot open');
  const c = await page('cleaner');
  assert.match(c, /Notices are not set up yet\. Brownouts and the weather still show under Stays, in Warnings\./); assert.match(c, /<a class="btn btn-secondary btn-sm" href="#calendar\/warnings"[^>]*>See warnings<\/a>/);
});

test('s126 r1 pill: a failed tasks read never says "Could not update" for laundry; a cleaner still does', async () => {
  const bad = { tasks_list_v1: () => ({ error: { message: 'boom' }, data: null }) };
  const lbl = async (r) => ((await home(r, '#home', bad)).els['v-home'].innerHTML.match(/<span class="E_lbl">([^<]*)</) || [])[1] || '';
  assert.doesNotMatch(await lbl('laundry'), /Could not update|could not/i);
  assert.match(await lbl('cleaner'), /Could not|update/i);
});

test('s126 r1 tour: laundry sees it once under her own key even when cs_seen_v3 is set; a cleaner with cs_seen_v3 does not', async () => {
  const a = await tour('laundry', { cs_seen_v3: '1' });
  assert.equal(a.app.els['cal-sheet'].getAttribute('aria-hidden'), 'false'); assert.match(a.app.els['cs-body'].innerHTML, /1 of 1/); assert.equal(a.ls.getItem('cs_seen_laundry_v1'), '1'); assert.equal(a.ls.getItem('cs_seen_v3'), '1');
  const b = await tour('laundry', { cs_seen_v3: '1', cs_seen_laundry_v1: '1' }); assert.notEqual(b.app.els['cal-sheet'] && b.app.els['cal-sheet'].getAttribute('aria-hidden'), 'false', 'not a second time');
  const c = await tour('cleaner', { cs_seen_v3: '1' }); assert.notEqual(c.app.els['cal-sheet'] && c.app.els['cal-sheet'].getAttribute('aria-hidden'), 'false'); assert.equal(c.ls.getItem('cs_seen_laundry_v1'), null);
});

const ANA = { guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-17', id_photo_path: 'ids/ana.jpg' };
const staffHomeOf = (g) => ({ staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: g, next_guest: Object.assign({}, g, { checkin_date: '2026-10-18', checkout_date: '2026-10-20' }) }), notices_v1: () => ({ error: null, data: NOTICES_RAW({ role: 'laundry' }) }) });
const PAGES = [['#calendar/house', /In the house/], ['#calendar/next', /Next arrival/], ['#calendar/notices', /Brownout 1:00 to 4:00 pm/]];

test('s126 r1 privacy (a): a payload that carries a phone, e-mail or amount is refused for laundry on the three kept screens; only the blocked banner shows', async () => {
  for (const [hash, extra] of PAGES.flatMap((p) => [{ phone: '+639171234567' }, { email: 'ana@guest.example' }, { total_payout: 5000 }, { amount: 5000 }].map((x) => [p[0], x]))) { // one dirty key at a time: contact alone must be refused too
    const c = (await home('laundry', hash, staffHomeOf(Object.assign({}, extra, ANA)))).els['v-calendar'].innerHTML;
    assert.match(c, /This page was blocked because the data carried an amount or a contact detail/, hash + ' ' + Object.keys(extra));
    assert.doesNotMatch(c, /Ana Reyes|In the house|Next arrival|tel:|mailto:|ana@guest|₱|PHP|\+63/, hash + ': nothing of the payload is drawn');
  }
});

test('s126 r1 privacy (b): a clean payload really draws the guest card and Notices for laundry, with no tel:, mailto:, peso or +63 (the ID photo stays: D-302)', async () => {
  for (const [hash, heading] of PAGES) {
    const c = (await home('laundry', hash, staffHomeOf(ANA))).els['v-calendar'].innerHTML;
    assert.match(c, heading, hash + ' draws its content'); assert.doesNotMatch(c, /This page was blocked/, hash);
    assert.doesNotMatch(c, /tel:|mailto:|₱|PHP|\+63/, hash);
    if (hash !== '#calendar/notices') assert.match(c, /Ana Reyes/, hash + ' names the guest');
  }
  assert.match((await home('laundry', '#calendar/house', staffHomeOf(ANA))).els['v-calendar'].innerHTML, /data-idpath="ids\/ana\.jpg"/, 'every staff account gets the ID photo (D-302)');
});
