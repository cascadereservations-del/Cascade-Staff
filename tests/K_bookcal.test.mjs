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

// s91: full names and one colour per guest, no A/D letters.
const S = (name, a, b, extra) => Object.assign({ guest_name: name, checkin_date: a, checkout_date: b, status: 'confirmed', source: 'airbnb' }, extra || {});
test('K s91 no A/D badge markup; source stays in the label only', () => {
  const st = [S('Joseph', '2026-10-05', '2026-10-08'), S('Angeleen Luz Villanueva', '2026-10-10', '2026-10-12', { source: 'direct' })];
  const h = K.render({ y: 2026, m: 10, today: TODAY, stays: st, rows: st, full: true });
  assert.doesNotMatch(h, /K_src|data-shade/); assert.doesNotMatch(h, />[AD]<\/span><span class="K_nm"/);
  assert.match(h, /Airbnb stay/); assert.match(h, /Direct booking/); assert.doesNotMatch(h, /A = Airbnb|D = Direct/);
  assert.match(h, /own colour/);
});

test('K s91 admin gets the full name for an Airbnb row with a first name; cleaner keeps the first name', () => {
  const st = K_stays();
  const names = [{ checkin_date: '2026-10-05', name: 'Joseph Dela Cruz' }, { checkin_date: '2026-10-09', name: 'Dale Other' }];
  const a = K.render({ y: 2026, m: 10, today: TODAY, stays: st, rows: st, full: true, names });
  assert.match(a, /K_nm">Joseph Dela Cruz</); assert.match(a, /K_nm">Dale</, 'a different first name is never swapped in');
  const c = K.render({ y: 2026, m: 10, today: TODAY, stays: st, rows: st, full: false, names });
  assert.match(c, /K_nm">Joseph</); assert.doesNotMatch(c, /Dela Cruz/);
});
const K_stays = () => [S('Joseph', '2026-10-05', '2026-10-08'), S('Dale', '2026-10-08', '2026-10-10')];

test('K s91 the shell reads full names from the guest record for owner and admin only', async () => {
  const q = (data, log, t) => { const o = { select: () => o, eq: () => o, gte: () => o, lte: () => o, not: () => o, in: () => o, limit: () => o, then: (f, g) => Promise.resolve({ error: null, data }).then(f, g) }; log.push(t); return o; };
  const run = async (role) => {
    const log = [], rows = [stayRow('Nicole', '2026-10-12', '2026-10-17', { source: 'airbnb' })];
    const app = await boot({ role, hash: '#calendar', ls: mem({ cs_cal_view: 'bookings' }).ls, handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH(rows) }),
      winInit: (w) => { w.K_BookCal = K; w.H_loadAsset = () => Promise.resolve(); const cc = w.supabase.createClient; w.supabase.createClient = (...a) => { const sb = cc(...a); sb.from = (t) => q(t === 'guests' ? [{ id: 'g1', name: 'Nicole Aniero' }] : [{ guest_id: 'g1', checkin_date: '2026-10-12' }], log, t); return sb; }; } });
    await app.flush(); return { h: html(app), log };
  };
  const a = await run('admin'); assert.match(a.h, /K_nm">Nicole Aniero</); assert.deepEqual(a.log, ['airbnb_reservations', 'guests']);
  const c = await run('cleaner'); assert.match(c.h, /K_nm">Nicole</); assert.doesNotMatch(c.h, /Aniero/); assert.deepEqual(c.log, []);
});

test('K s91 touching or overlapping stays never share a colour; all colours exist for light and dark', () => {
  const st = [];
  for (let i = 0; i < 12; i++) st.push(S('G' + i, '2026-10-' + String(1 + i * 2).padStart(2, '0'), '2026-10-' + String(3 + i * 2).padStart(2, '0')));
  st.push(S('Over', '2026-10-02', '2026-10-06'));
  const col = K.colours(st);
  for (const x of st) for (const y of st) if (x !== y && x.checkin_date <= y.checkout_date && y.checkin_date <= x.checkout_date) assert.notEqual(col(x), col(y), x.guest_name + '/' + y.guest_name);
  const used = new Set(st.map(col)); assert.ok(used.size >= 4 && [...used].every((n) => n >= 1 && n <= 8));
  const tok = fs.readFileSync(root + '/tokens.css', 'utf8'), css = fs.readFileSync(root + '/calendar/K_bookcal.css', 'utf8');
  for (let n = 1; n <= 8; n++) { assert.equal(tok.split('--v5-k' + n + ':').length - 1, 3, 'k' + n + ' in light, dark media and dark theme'); assert.match(css, new RegExp('data-col="' + n + '"|\.K_chip \{[^}]*--v5-k1')); }
  const hex = (name, i) => tok.split('--v5-' + name + ': ')[i].slice(0, 7);
  const lum = (h) => { const c = [1, 3, 5].map((j) => parseInt(h.slice(j, j + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  for (let n = 1; n <= 8; n++) for (const i of [1, 2, 3]) { const a = lum(hex('k' + n, i)), b = lum(hex('k' + n + '-fg', i)); assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, 'k' + n + ' set ' + i); }
});
