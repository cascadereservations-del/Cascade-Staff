// Lane H, release 3.2.0 round 2 (s84): past months on the calendar grid and the booked-nights figure, owner and admin only.
// The harness freezes the clock at 2026-10-15 (12:30 Manila): the home read covers from 2026-10-08.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, boot, HOMEWITH, baseHandlers, stayRow } from './_a_harness.mjs';

const HIST = 'staff_calendar_history_v1', MET = 'get_hospitality_metrics_v1';
const S = (o) => Object.assign({ source: 'airbnb', id: 'a1', checkin: '2026-09-10', checkout: '2026-09-13', nights: 3, status: 'completed', first_name: 'Maria' }, o);
const hist = (stays) => ({ error: null, data: { from: '2026-09-01', to: '2026-10-01', stays } });
const occ = (v) => ({ error: null, data: { metrics: { occupancy: { value: v }, sold_nights: { value: 18 } } } });
const mk = (role, over) => baseHandlers(role, Object.assign({ staff_home_v1: () => HOMEWITH([stayRow('Ben Cruz', '2026-10-14', '2026-10-17')]) }, over || {}));
const prev = async (app) => { await app.click({ 'data-act': 'prev' }); await app.flush(); };
const cal = (app) => app.els['v-calendar'].innerHTML;
const calls = (app, n) => app.calls.filter((c) => c[0] === n);

test('3.2 r2 history: one call per month shown with the exact name and argument keys, cached for the session', async () => {
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: mk('admin', { [HIST]: () => hist([S()]), [MET]: () => occ('61.9') }) }); await app.flush();
  assert.deepEqual(calls(app, HIST).map((c) => c[1]), [{ p_from: '2026-10-01', p_to: '2026-10-31' }], 'this month starts before today-7, so it is asked for too');
  assert.deepEqual(calls(app, MET).map((c) => c[1]), [{ p_property_id: 'prop-1', p_start: '2026-10-01', p_end_exclusive: '2026-11-01' }]);
  await prev(app);
  assert.deepEqual(calls(app, HIST).map((c) => c[1]).pop(), { p_from: '2026-09-01', p_to: '2026-09-30' }); assert.deepEqual(Object.keys(calls(app, HIST)[1][1]), ['p_from', 'p_to']);
  assert.deepEqual(Object.keys(calls(app, MET)[1][1]), ['p_property_id', 'p_start', 'p_end_exclusive']); assert.deepEqual(calls(app, MET)[1][1], { p_property_id: 'prop-1', p_start: '2026-09-01', p_end_exclusive: '2026-10-01' });
  await app.click({ 'data-act': 'next' }); await app.flush(); await prev(app); await app.click({ 'data-act': 'next' }); await app.flush();
  assert.equal(calls(app, HIST).length, 2, 'going back and forth asks for no month twice'); assert.equal(calls(app, MET).length, 2);
});

test('3.2 r2 history: a past stay is drawn like a current one with the first name only; days are no longer dashed; the dashboard line goes; money and contact never reach the page', async () => {
  const row = S({ guest_name: 'Maria Santos', phone: '+63 917 000 1111', host_payout: 4321, accommodation_total: 5000 });
  const app = await boot({ role: 'owner', hash: '#calendar', handlers: mk('owner', { [HIST]: () => hist([row]), [MET]: () => occ('61.9') }) }); await app.flush(); await prev(app);
  const h = cal(app);
  assert.match(h, /data-day="2026-09-10" aria-label="[^"]*Maria arrives, booked"/); assert.match(h, /A_tag[^>]*>Maria</, 'the name runs along the bar'); assert.match(h, /hx hx-in/, 'the arrival half-day'); assert.match(h, /class="d s-free past dep"[^>]*data-day="2026-09-13"/, 'the checkout half-day');
  assert.doesNotMatch(h, /nodata/, 'no dashed day in a month that was loaded'); assert.doesNotMatch(h, /H_older|Stays before/); assert.doesNotMatch(h, /Santos|917|4321|5000|payout/);
  assert.match(h, /<p class="help H_booked" data-booked="1">Booked 62% of nights<\/p>/);
  const sheet = await boot({ role: 'owner', hash: '#calendar', handlers: mk('owner', { [HIST]: () => hist([row]), [MET]: () => occ('61.9') }) }); await sheet.flush(); await prev(sheet); await sheet.click({ 'data-day': '2026-09-11' });
  assert.doesNotMatch(sheet.els['cs-body'].innerHTML, /Not shown here|Santos|917/); assert.match(sheet.els['cs-body'].innerHTML, /Maria/);
});

test('3.2 r2 history: a stay that two months both return is one stay (no clash), and nothing from the home read is doubled', async () => {
  const both = S({ id: 'x', checkin: '2026-08-30', checkout: '2026-09-03', nights: 4, first_name: 'Lia' });
  const app = await boot({ role: 'admin', hash: '#calendar', handlers: mk('admin', { [HIST]: () => hist([both, S({ id: 'in-window', checkin: '2026-10-05', checkout: '2026-10-09', first_name: 'Pia' })]), [MET]: () => occ('50') }) }); await app.flush();
  assert.doesNotMatch(cal(app), /Pia/, 'a stay that ends inside the home read is the home read\'s job'); await prev(app); await prev(app);
  assert.doesNotMatch(cal(app), /class="d [^"]*clash/, 'one stay seen twice is not a clash'); assert.match(cal(app), /Lia/);
});

test('3.2 r2 probe-and-hide: a missing RPC, a refusal, an answer with no stays list and a failed call all keep today\'s dashed behaviour and the dashboard line; no retry loop', async () => {
  const cases = { missing: () => ({ error: { code: 'PGRST202', message: 'Could not find the function' }, data: null }), notAuth: () => ({ error: { code: '42501', message: 'not_authorized' }, data: null }), noList: () => ({ error: null, data: { ok: true } }), range: () => ({ error: { code: '22023', message: 'range_too_large' }, data: null }), boom: () => Promise.reject(new Error('offline')) };
  for (const [name, fn] of Object.entries(cases)) {
    const app = await boot({ role: 'admin', hash: '#calendar', handlers: mk('admin', { [HIST]: fn, [MET]: () => occ('61.9') }) }); await app.flush(); await prev(app); await prev(app); await app.flush();
    assert.match(cal(app), /nodata/, name + ': dashed'); assert.match(cal(app), /Stays before 8 Oct are/, name + ': the line stays'); assert.doesNotMatch(cal(app), /class="[^"]*error|errbox/, name + ': no error box');
    assert.ok(calls(app, HIST).length <= 3, name + ': at most one call per month, no loop (' + calls(app, HIST).length + ')');
    if (name === 'missing' || name === 'notAuth' || name === 'noList') assert.equal(calls(app, HIST).length, 1, name + ': the first answer turns the feature off for the session');
  }
});

test('3.2 r2 booked %: shown near the month title, hidden on failure or missing RPC, the slot is always reserved so the grid does not move', async () => {
  const slot = (h) => /<p class="help H_booked" data-booked="(\d)">([^<]*)<\/p>/.exec(h);
  const ok = await boot({ role: 'admin', hash: '#calendar', handlers: mk('admin', { [HIST]: () => hist([]), [MET]: () => occ('61.9') }) }); await ok.flush();
  assert.deepEqual(slot(cal(ok)).slice(1), ['1', 'Booked 62% of nights']); assert.ok(cal(ok).indexOf('H_booked') > cal(ok).indexOf('class="dlg"') && cal(ok).indexOf('H_booked') < cal(ok).indexOf('class="cal"'), 'between the title and the grid');
  for (const [name, fn] of Object.entries({ failed: () => ({ error: { code: 'XX000', message: 'boom' }, data: null }), absent: () => ({ error: { code: 'PGRST202', message: 'x' }, data: null }), denied: () => ({ error: { code: '42501', message: 'x' }, data: null }), nullValue: () => occ(null), junk: () => ({ error: null, data: null }) })) {
    const app = await boot({ role: 'admin', hash: '#calendar', handlers: mk('admin', { [HIST]: () => hist([]), [MET]: fn }) }); await app.flush();
    assert.deepEqual(slot(cal(app)).slice(1), ['0', ''], name + ': the slot is there and empty'); assert.doesNotMatch(cal(app), /Booked \d+%/);
  }
  assert.match(read('styles.css'), /\.H_booked \{ min-height: 1\.5rem;/, 'a reserved height');
  const loading = await boot({ role: 'admin', hash: '#calendar', handlers: mk('admin', { [HIST]: () => new Promise(() => {}), [MET]: () => new Promise(() => {}) }) }); assert.ok(slot(cal(loading)), 'the slot is there before any answer');
});

test('3.2 r2 roles: a cleaner and finance make zero calls to either RPC and get no slot and no change to the grid', async () => {
  for (const role of ['cleaner', 'finance']) {
    const app = await boot({ role, hash: '#calendar', handlers: mk(role, { [HIST]: () => hist([S()]), [MET]: () => occ('61.9') }) }); await app.flush(); await prev(app); await prev(app);
    assert.equal(calls(app, HIST).length + calls(app, MET).length, 0, role + ': no calls'); assert.doesNotMatch(cal(app), /H_booked|Maria/); assert.match(cal(app), /nodata/); assert.match(cal(app), /Stays before 8 Oct are not shown here/);
  }
});

test('3.2 r2 sign-out: the in-memory history and figures are cleared on sign-out and on a new sign-in', () => {
  const src = read('app.js');
  assert.match(src, /H_unmount\(\); H_resetModules\(\); H_histGen\+\+; H_calReset\(\);/); assert.match(src, /function enter\(\) \{\s+H_histGen\+\+; H_calReset\(\);/);
  assert.match(src, /function H_calReset\(\) \{ H_hist = \{\}; H_histV\+\+; H_histOff = false; H_occ = \{\}; H_occOff = false;/);
  assert.match(src, /if \(gen !== H_histGen\) return;/, 'an answer that lands after sign-out is dropped');
});
