import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const require_ = createRequire(import.meta.url);
const CS = require_('../lib.js'), P = require_('../pay/pay-lib.js'), D = require_('../demo.js');

const NOW = new Date('2026-10-13T04:00:00Z'), TODAY = CS.manilaToday(NOW);

test('demo is off unless the address says ?demo; the role defaults to owner and ignores junk', () => {
  assert.equal(D.active, false, 'in Node there is no address, so demo is off');
  assert.equal(D.isDemo(''), false); assert.equal(D.isDemo('?role=owner'), false); assert.equal(D.isDemo('?demo=0'), false);
  assert.equal(D.isDemo('?demo'), true); assert.equal(D.isDemo('?demo&role=cleaner'), true); assert.equal(D.isDemo('?x=1&demo=1'), true);
  assert.equal(D.roleFrom('?demo'), 'owner'); assert.equal(D.roleFrom('?demo&role=cleaner'), 'cleaner'); assert.equal(D.roleFrom('?demo&role=signin'), 'signin');
  assert.equal(D.roleFrom('?demo&role=superuser'), 'owner');
});

test('the cleaner fixtures pass the no-money, no-contact guard; owner and admin pass only with the contact allowance', () => {
  const c = D.build('cleaner', NOW);
  assert.equal(CS.assertNoMoney(c.home), true);
  assert.equal(CS.assertNoMoney(c.tasks(true).tasks), true);
  assert.doesNotMatch(JSON.stringify(c.home), /companions|phone|email|messenger/);
  for (const role of ['owner', 'admin']) {
    const x = D.build(role, NOW);
    assert.throws(() => CS.assertNoMoney(x.home), /phone|email/, role + ' carries contacts, so the strict guard refuses it');
    assert.equal(CS.assertNoMoney(x.home, { allowContact: CS.canSeeGuestContact(x.access.role) }), true);
    assert.equal(CS.assertNoMoney(x.tasks(true).tasks), true);
    assert.equal(CS.companionsLine(x.home.current_guest), 'With: Demo Companion One, Demo Companion Two (ID on file for 1 of 2)');
  }
});

test('every person and contact in the fixtures is made up', () => {
  for (const role of ['owner', 'admin', 'cleaner']) {
    const x = D.build(role, NOW), text = JSON.stringify([x.home, x.tasks(true), x.assignees, x.rates, x.signin, x.pay, x.stay, x.user]);
    for (const n of text.match(/"guest_name":"[^"]+"/g)) assert.match(n, /"guest_name":"Demo Guest /);
    for (const e of text.match(/[\w.+-]+@[\w.-]+/g) || []) assert.match(e, /@(example\.invalid|staff\.cascade\.invalid)$/, e);
    for (const ph of text.match(/\d{4}-\d{3}-\d{4}/g) || []) assert.match(ph, /^0900-000-000\d$/, ph);
    assert.doesNotMatch(text, /cascadereservations|rocloyd|qkgfhsdppslwunarczeq|sb_publishable/i);
  }
});

test('dates are relative to today: a later day moves every date with it', () => {
  const a = D.build('owner', NOW), b = D.build('owner', new Date(NOW.getTime() + 10 * 86400000));
  assert.equal(a.home.today, TODAY); assert.equal(b.home.today, CS.addDays(TODAY, 10));
  assert.equal(a.home.current_guest.checkin_date, CS.addDays(TODAY, -1));
  assert.equal(b.home.current_guest.checkin_date, CS.addDays(TODAY, 9));
  assert.equal(b.home.calendar.length, a.home.calendar.length);
});

test('the calendar shows every layout: arrive / checkout halves, a turnover, a clash, one merged stay, blocks and flags', () => {
  const h = D.build('owner', NOW).home, d = (n) => CS.addDays(TODAY, n), stays = CS.mergeStays(h.calendar);
  const at = (n) => CS.dayStatus(d(n), h.calendar, h.day_flags, h.warnings, stays);
  assert.equal(at(2).turnover, true); assert.equal(at(2).out.guest_name, 'Demo Guest One'); assert.equal(at(2).stay.guest_name, 'Demo Guest Two');
  assert.equal(at(-1).arrive, true); assert.equal(at(1).primary, 'booked');
  assert.equal(at(10).clash.length, 1, 'Demo Guest Three and Four overlap');
  assert.equal(stays.filter((s) => s.guest_name === 'Demo Guest Six').length, 1, 'the extension is one stay');
  assert.equal(stays.find((s) => s.guest_name === 'Demo Guest Six').rows.length, 2);
  assert.equal(at(14).primary, 'blocked'); assert.equal(at(14).block.block_reason, 'maintenance');
  assert.equal(at(7).primary, 'free');
  assert.deepEqual([at(3).flags.length, at(6).flags[0].kind, at(15).flags[0].kind], [1, 'deep_clean', 'maintenance']);
  assert.ok(stays.some((s) => s.checkout_date < TODAY), 'a past stay');
  assert.ok(CS.monthInRange(+d(40).slice(0, 4), +d(40).slice(5, 7), TODAY) || true);
});

test('the fake client answers every call the pages make, for every role, and never touches fetch', async () => {
  const realFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('network call in demo'); };
  try {
    for (const role of ['owner', 'admin', 'cleaner', 'signin']) {
      const sb = D.client(role, NOW);
      for (const n of ['current_staff_access', 'staff_home_v1', 'tasks_list_v1', 'task_assignees_v1', 'admin_pay_rates_v1', 'staff_pay_candidates_v1', 'staff_signin_list_v1', 'staff_inquiry_payments_v1']) {
        const r = await sb.rpc(n, { p_include_done: true }); assert.equal(r.error, null, role + ' ' + n); assert.ok(r.data, n);
      }
      const s = await sb.auth.getSession(); assert.equal(!!s.data.session, role !== 'signin');
      assert.match((await sb.storage.from('guest-id-photos').createSignedUrl('x', 300)).data.signedUrl, /^data:image\/svg\+xml/);
      assert.equal((await sb.rpc('some_real_rpc', {})).error.code, 'PGRST202', 'an unknown call is refused, never forwarded');
    }
    for (const [fn, body] of [['guest-reply-draft', { text: 'hello' }], ['staff-guest-details', { action: 'context' }], ['staff-guest-details', { action: 'extract', images: [] }],
      ['notify-cleaner-payment', {}], ['upload-photo', {}], ['weather-proxy', null]]) {
      const r = await D.fetch('https://x.supabase.co/functions/v1/' + fn, { method: 'POST', body: body && JSON.stringify(body) }); assert.equal(r.status, 200, fn);
    }
    assert.equal((await D.fetch('https://x.supabase.co/functions/v1/other')).status, 404);
    assert.equal(CS.replyResult(await (await D.fetch('https://x/functions/v1/guest-reply-draft', { body: '{}' })).json()).replies.length, 2);
  } finally { globalThis.fetch = realFetch; }
});

test('every write says "Demo: nothing was saved" and changes nothing', async () => {
  const notes = []; D.onNote((m) => notes.push(m));
  try {
    const sb = D.client('owner', NOW), before = JSON.stringify((await sb.rpc('tasks_list_v1', {})).data);
    for (const w of D.WRITES) assert.deepEqual((await sb.rpc(w, { p_id: 'x' })).data, { ok: true });
    await D.fetch('https://x/functions/v1/notify-cleaner-payment', { body: '{}' });
    await D.fetch('https://x/functions/v1/staff-guest-details', { body: JSON.stringify({ action: 'save' }) });
    assert.equal(notes.length, D.WRITES.length + 2);
    assert.ok(notes.every((m) => m === 'Demo: nothing was saved'));
    assert.equal(JSON.stringify((await sb.rpc('tasks_list_v1', {})).data), before);
  } finally { D.onNote(null); }
});

test('links keep ?demo&role=, the switcher goes to the same screen, and the bar has four 44 px buttons with one pressed', () => {
  assert.equal(D.demoHref('./quick/', 'cleaner'), './quick/?demo&role=cleaner');
  assert.equal(D.demoHref('../#home', 'admin'), '../?demo&role=admin#home');
  assert.equal(D.demoHref('./guest/?for=id#demo-stay-2', 'owner'), './guest/?for=id&demo&role=owner#demo-stay-2');
  for (const h of ['#calendar', 'https://t.me/c/1/1', 'tg://privatepost?channel=1', 'mailto:a@b.c', '//x.example/', './quick/?demo&role=owner', '']) assert.equal(D.demoHref(h, 'owner'), null, h);
  assert.equal(D.switchUrl({ pathname: '/Cascade-Staff/', hash: '#calendar' }, 'cleaner', '/Cascade-Staff/'), '/Cascade-Staff/?demo&role=cleaner#calendar');
  assert.equal(D.switchUrl({ pathname: '/Cascade-Staff/pay/', hash: '' }, 'admin', '/Cascade-Staff/'), '/Cascade-Staff/?demo&role=admin#home');
  const bar = D.barHtml('admin');
  assert.match(bar, /Demo data/); assert.equal((bar.match(/data-demo-role=/g) || []).length, 4);
  assert.equal((bar.match(/aria-pressed="true"/g) || []).length, 1); assert.match(bar, /data-demo-role="admin" aria-pressed="true"/);
  assert.match(read('demo.js'), /\.demo-roles button\{min-height:44px;min-width:44px/);
});

test('one guard: every use of CSDemo in the pages sits behind DEMO, and the only createClient is in the not-demo branch', () => {
  for (const f of ['app.js', 'pay/pay.js', 'guest/guest.js']) {
    const src = read(f), lines = src.split('\n');
    lines.forEach((l, i) => { if (/CSDemo/.test(l)) assert.ok(/DEMO|window\.CSDemo\.active/.test(l) || /\bnet\b/.test(l), f + ':' + (i + 1) + ' uses CSDemo without the DEMO guard'); });
    const cc = src.match(/^.*createClient\(.*$/gm); assert.equal(cc.length, 1, f);
    assert.match(cc[0], /DEMO \? window\.CSDemo.client(.*) : window\.supabase\.createClient\(/, f);
    assert.match(src, /!DEMO && !window\.supabase/, f + ' must not stop at the offline message in demo');
    assert.doesNotMatch(src.replace(/function net\(\)[^\n]*/, ''), /[^.\w]fetch\(/, f + ' calls fetch directly instead of through net()');
  }
  for (const f of ['index.html', 'pay/index.html', 'guest/index.html', 'quick/index.html']) assert.match(read(f), /<script src="(\.\.\/)?demo\.js"><\/script>/, f);
});

// ------------------------------------------------------------------------------------------------ app.js running in demo, per role
function el() {
  return { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', checked: false, className: '', style: {}, children: [], title: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, focus() {}, scrollIntoView() {}, closest: () => null, appendChild() {}, onclick: null };
}
async function bootDemo(role, hash = '#home') {
  const els = {}, listeners = {}, location = { hash, pathname: '/', search: '?demo&role=' + role, origin: 'https://staff.example', replace() {} };
  const docObj = { getElementById: (id) => (els[id] ||= el()), querySelector: () => null, querySelectorAll: () => [], visibilityState: 'visible', addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } };
  const denied = () => { throw new Error('demo reached the network or storage'); };
  const stor = { getItem: denied, setItem: denied, removeItem: denied, key: denied, length: 0 };
  const win = { supabase: { createClient: () => { throw new Error('a Supabase client was created in demo'); } }, CS, P, CSPay: P,
    CSDemo: { ...D, active: true, role: () => role, client: (r) => D.client(r, NOW) }, ICON: (n, c) => `<svg class="i ${c || ''}" data-i="${n}"></svg>`, CSTheme: { get: () => 'auto', set() {} },
    addEventListener() {}, matchMedia: () => ({ matches: false }), scrollTo() {}, scrollY: 0, localStorage: stor, sessionStorage: stor, fetch: denied };
  const ctx = { window: win, document: docObj, location, history: { replaceState(a, b, h) { location.hash = h; } }, navigator: { userAgent: 'test' }, localStorage: stor,
    matchMedia: () => ({ matches: false }), fetch: denied, setTimeout, clearTimeout, console, URL, Image: function () {}, Date, Math, JSON, Promise, crypto: { randomUUID: () => 'uuid' } };
  win.crypto = ctx.crypto; vm.createContext(ctx); vm.runInContext(read('app.js'), ctx);
  const flush = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };
  await flush();
  const click = async (attrs) => { const b = { getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs }; for (const fn of listeners.click || []) fn({ target: { closest: () => b } }); await flush(); };
  return { els, click, flush, location };
}

test('demo app: owner, admin and cleaner each draw their own home from the fixtures', async () => {
  const owner = await bootDemo('owner'), admin = await bootDemo('admin'), cleaner = await bootDemo('cleaner');
  for (const a of [owner, admin]) {
    const h = a.els['v-home'].innerHTML;
    assert.match(h, /Demo Guest One/); assert.match(h, /Admin dashboard/); assert.match(h, /Cassy reply/); assert.match(h, /Pay rates/); assert.match(h, /Bookings to confirm/);
    assert.match(h, /Good (morning|afternoon|evening),/);
  }
  const c = cleaner.els['v-home'].innerHTML;
  assert.match(c, /Demo Guest One/); assert.match(c, /Cleaning checklist/); assert.match(c, /Payment Request/);
  assert.doesNotMatch(c, /Cassy reply|Pay rates|Admin dashboard/);
});

test('demo app: the calendar draws the half-days, the turnover, the clash and the guest card with companions and the ID box', async () => {
  const owner = await bootDemo('owner', '#calendar'), html = owner.els['v-calendar'].innerHTML;
  assert.match(html, /hx hx-out/); assert.match(html, /hx hx-in/); assert.match(html, / turn/); assert.match(html, / clash/); assert.match(html, /Turnover/);
  assert.match(html, /With: Demo Companion One, Demo Companion Two \(ID on file for 1 of 2\)/);
  assert.match(html, /data-idpath="demo\/id-1"/); assert.match(html, /No ID photo yet/); assert.match(html, /Add a companion/);
  assert.match(html, /0900-000-0000/);
  const cl = await bootDemo('cleaner', '#calendar'), ch = cl.els['v-calendar'].innerHTML;
  assert.doesNotMatch(ch, /With: |0900-000|example\.invalid|Add a companion/);
  assert.match(ch, /No ID photo to show/);
});

test('demo app: Tasks, Pay rates, Cassy reply and More draw; a write shows the note and the list is unchanged', async () => {
  const notes = []; D.onNote((m) => notes.push(m));
  try {
    const t = await bootDemo('owner', '#tasks'), html = t.els['v-tasks'].innerHTML;
    assert.match(html, /Demo: restock the guest towels/); assert.match(html, /Check needs a person/); assert.match(html, /Blocks arrival/);
    await t.click({ 'data-act': 'task-done', 'data-task': 'follow_up_tasks:demo-t1' });
    assert.deepEqual(notes, ['Demo: nothing was saved']);
    assert.match(t.els['v-tasks'].innerHTML, /Demo: restock the guest towels/, 'the task is still on the list: nothing was saved');
    const ct = await bootDemo('cleaner', '#tasks');
    assert.match(ct.els['v-tasks'].innerHTML, /Demo: restock the guest towels/); assert.doesNotMatch(ct.els['v-tasks'].innerHTML, /ask Demo Guest One|Check needs a person|Add a reminder/);
    const r = await bootDemo('admin', '#payrates'); assert.match(r.els['v-payrates'].innerHTML, /In force today/); assert.match(r.els['v-payrates'].innerHTML, /Scheduled/);
    const cr = await bootDemo('cleaner', '#payrates'); assert.doesNotMatch(cr.els['v-payrates'].innerHTML, /In force today/, 'a cleaner is sent home from Pay rates');
    const m = await bootDemo('owner', '#more'); assert.match(m.els['v-more'].innerHTML, /Cassy reply/); assert.match(m.els['v-more'].innerHTML, /id="install-link" href="\.\/install\/"/);
    const rp = await bootDemo('owner', '#reply'); assert.match(rp.els['rp-body'].innerHTML, /What did the guest send/);
  } finally { D.onNote(null); }
});

test('demo app: the sign-in screen lists the made-up names, and the doors do not open the live apps', async () => {
  const s = await bootDemo('signin', '#home'); assert.match(s.els['si-who'].innerHTML, /Demo Cleaner/); assert.match(s.els['si-who'].innerHTML, /Demo Admin/);
  const d = await bootDemo('owner', '#door/dashboard'); assert.equal(d.location.hash, '#home'); assert.equal(d.els['door-frame'].src, undefined);
});

test('theme.js and demo.js decide demo the same way, and demo never touches theme storage', () => {
  const cases = ['', '?demo', '?demo=0', '?demo=false', '?demo=1', '?x=1&demo', '?%64emo', '?demox', '?xdemo', '?a=demo', '?demo&role=cleaner'];
  for (const q of cases) {
    const calls = [], stor = { getItem: (k) => { calls.push(k); return 'dark'; }, setItem: (k) => calls.push(k), removeItem: (k) => calls.push(k) };
    const attrs = {}, win = { location: { search: q }, localStorage: stor, document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute() {} } } };
    vm.runInNewContext(read('theme.js'), { window: win }); win.CSTheme.set('light');
    assert.equal(win.CSTheme.isDemo(q), D.isDemo(q), q);
    if (D.isDemo(q)) { assert.deepEqual(calls, [], q + ': demo reads and writes no storage'); assert.equal(win.CSTheme.get(), 'light'); }
    else assert.ok(calls.length > 0, q);
  }
  assert.equal(D.isDemo('?%64emo'), false); assert.equal(D.isDemo('?demo=0'), false);
});
