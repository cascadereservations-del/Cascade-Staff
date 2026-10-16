// Lane K (s90): the Booking calendar view on the Calendar screen (calendar/K_bookcal.js), a port of the admin Booking calendar page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { boot, baseHandlers, HOMEWITH, stayRow, TODAY, root } from './_a_harness.mjs';

const K = createRequire(import.meta.url)('../calendar/K_bookcal.js');
const ROWS = [
  stayRow('Ana Reyes', '2026-10-12', '2026-10-17'),
  stayRow('Ben Cruz', '2026-10-17', '2026-10-20', { source: 'airbnb' }),
  { guest_name: null, checkin_date: '2026-10-22', checkout_date: '2026-10-24', status: 'blocked', source: 'airbnb' },
];
const handlers = (role) => baseHandlers(role, { staff_home_v1: () => HOMEWITH(ROWS) });
const mem = (init) => { const o = Object.assign({ cs_seen_v3: '1' }, init || {}); return { o, ls: { getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } } }; };
const open = (role, init) => { const s = mem(init); return boot({ role, hash: '#calendar', ls: s.ls, winInit: (w) => { w.K_BookCal = K; w.H_loadAsset = () => Promise.resolve(); }, handlers: handlers(role) }).then((app) => Object.assign(app, { store: s.o })); };
const html = (app) => app.els['v-calendar'].innerHTML;

test('K option appears for every role and starts on the month grid', async () => {
  for (const role of ['owner', 'admin', 'cleaner', 'finance']) {
    const app = await open(role); await app.flush();
    assert.match(html(app), /class="K_view[^"]*"[^]*data-view="month" aria-pressed="true"[^]*data-view="bookings" aria-pressed="false"/, role);
    assert.match(html(app), /class="cal"/, role + ': grid');
    assert.doesNotMatch(html(app), /K_root/, role);
  }
});

test('K switching renders the booking view with chips, turnover and the legend', async () => {
  const app = await open('admin'); await app.click({ 'data-act': 'cal-view', 'data-view': 'bookings' });
  const h = html(app);
  assert.match(h, /class="K_root"/); assert.doesNotMatch(h, /class="cal"/);
  assert.match(h, /data-view="bookings" aria-pressed="true"/);
  assert.match(h, /data-day="2026-10-12"[^>]*data-source="direct"/); assert.match(h, /data-day="2026-10-17"[^>]*data-source="airbnb"/);
  assert.match(h, /Turnover/); assert.match(h, /aria-label="Legend"/); assert.match(h, /data-state="blocked"/);
  assert.match(h, /Ana Reyes/, 'owner/admin see the full name');
});

test('K the choice persists per device and comes back on the next boot; month goes back to the grid', async () => {
  const app = await open('owner'); await app.click({ 'data-act': 'cal-view', 'data-view': 'bookings' });
  assert.equal(app.store.cs_cal_view, 'bookings');
  const again = await open('owner', { cs_cal_view: 'bookings' }); await again.flush(); assert.match(html(again), /class="K_root"/);
  await again.click({ 'data-act': 'cal-view', 'data-view': 'month' }); assert.equal(again.store.cs_cal_view, 'month'); assert.match(html(again), /class="cal"/);
});

test('K a storage that throws changes nothing', async () => {
  const ls = { getItem: (k) => { if (k === 'cs_seen_v3') return '1'; throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  const app = await boot({ role: 'cleaner', hash: '#calendar', ls, winInit: (w) => { w.K_BookCal = K; w.H_loadAsset = () => Promise.resolve(); }, handlers: handlers('cleaner') });
  await app.click({ 'data-act': 'cal-view', 'data-view': 'bookings' }); assert.match(html(app), /class="K_root"/);
});

test('K cleaners see first names only and no contact data', async () => {
  const app = await open('cleaner', { cs_cal_view: 'bookings' }); await app.flush();
  const h = /<div class="K_root"[^]*?<ul class="K_legend"[^]*?<\/ul>/.exec(html(app))[0]; // the new view only; the existing agenda is unchanged
  assert.match(h, /K_nm">Ana</); assert.doesNotMatch(h, /Reyes|Cruz/);
  assert.doesNotMatch(h, /\+63|@|guest_phone|guest_email|tel:|mailto:/);
});

test('K the module is loaded on demand; a failed load keeps the month grid', async () => {
  const loaded = [];
  const app = await boot({ role: 'admin', hash: '#calendar', ls: mem({ cs_cal_view: 'bookings' }).ls, winInit: (w) => { w.H_loadAsset = (m) => { loaded.push(m.src, m.css); return Promise.reject(new Error('404')); }; }, handlers: handlers('admin') });
  await app.flush(); assert.deepEqual(loaded, ['calendar/K_bookcal.js', 'calendar/K_bookcal.css']);
  assert.match(html(app), /class="cal"/); assert.doesNotMatch(html(app), /skel"[^>]*height:300px/);
});

test('K pure render: conflict, tap targets, rem text, files shipped', () => {
  const stays = [{ guest_name: 'Cy', checkin_date: '2026-10-05', checkout_date: '2026-10-08', source: 'direct', status: 'confirmed' }, { guest_name: 'Di', checkin_date: '2026-10-06', checkout_date: '2026-10-09', source: 'airbnb', status: 'confirmed' }];
  const h = K.render({ y: 2026, m: 10, today: TODAY, stays, rows: stays, full: false });
  assert.match(h, /data-state="conflict"/); assert.match(h, /Two guests on one night/);
  const css = fs.readFileSync(root + '/calendar/K_bookcal.css', 'utf8');
  assert.match(css, /\.K_chip \{[^}]*min-height: 44px/); assert.match(css, /\.K_root \{[^}]*touch-action: pan-y pinch-zoom/, 'a finger swipe is not taken by the browser'); assert.match(fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8'), /\.K_view button \{[^}]*min-height: 44px/, 'the switch is styled before the module loads'); assert.doesNotMatch(css, /font-size:\s*\d+px/);
  const sw = fs.readFileSync(root + '/sw.js', 'utf8'); assert.match(sw, /\.\/calendar\/K_bookcal\.js/); assert.match(sw, /\.\/calendar\/K_bookcal\.css/);
});

test('K swipe works on the booking view, the failed load says so and a second tap retries', async () => {
  assert.match(fs.readFileSync(root + '/app.js', 'utf8'), /sel: '\.cal, \.K_root'/);
  let ok = false, n = 0;
  const app = await boot({ role: 'admin', hash: '#calendar', ls: mem({ cs_cal_view: 'bookings' }).ls, winInit: (w) => { w.H_loadAsset = () => { n++; if (!ok) return Promise.reject(new Error('404')); w.K_BookCal = K; return Promise.resolve(); }; }, handlers: handlers('admin') });
  await app.flush(); assert.match(html(app), /class="cal"/); assert.match(html(app), /could not load, so the month is shown/);
  ok = true; await app.click({ 'data-act': 'cal-view', 'data-view': 'bookings' });
  assert.equal(n, 2); assert.match(html(app), /class="K_root"/); assert.doesNotMatch(html(app), /could not load/);
});
