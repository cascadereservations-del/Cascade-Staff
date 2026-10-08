import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const CS = createRequire(import.meta.url)('../lib.js');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('role gate: owner, admin and finance only', () => {
  for (const r of ['owner', 'admin', 'finance']) assert.equal(CS.canSeeBookingsToConfirm(r), true, r);
  for (const r of ['cleaner', 'inspector', 'maintenance', 'guest', '', null, undefined]) assert.equal(CS.canSeeBookingsToConfirm(r), false, String(r));
});

test('count: an array is its length, anything else is 0', () => {
  assert.equal(CS.bookingsToConfirmCount([{}, {}, {}]), 3);
  for (const bad of [null, undefined, {}, { ok: false }, 'x', 5]) assert.equal(CS.bookingsToConfirmCount(bad), 0);
});

test('row shows with N > 0 for a money role and links to the admin Inquiries page', () => {
  const r = CS.bookingsToConfirmRow('admin', [{}, {}]);
  assert.deepEqual({ n: r.n, count: r.count }, { n: 2, count: '2' });
  assert.equal(r.href, 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/bookings/inquiries');
  assert.equal(CS.bookingsToConfirmRow('finance', [{}]).count, '1');
  assert.equal(CS.bookingsToConfirmRow('owner', new Array(150).fill({})).count, '99+');
});

test('row hidden at 0, on error shapes, and for staff roles', () => {
  assert.equal(CS.bookingsToConfirmRow('owner', []), null);
  assert.equal(CS.bookingsToConfirmRow('owner', null), null);
  assert.equal(CS.bookingsToConfirmRow('owner', { ok: false }), null);
  for (const r of ['cleaner', 'inspector', 'maintenance']) assert.equal(CS.bookingsToConfirmRow(r, [{}, {}]), null);
});

test('the RPC call sits behind the role gate and the admin layout, so a cleaner never calls it', () => {
  const m = app.match(/function loadBookingsToConfirm\(\) \{\r?\n([^\r\n]*)\r?\n/);
  assert.ok(m, 'loader found');
  assert.match(m[1], /state\.layout !== 'admin'/);
  assert.match(m[1], /!CS\.canSeeBookingsToConfirm\(/);
  assert.match(m[1], /return;/);
  assert.equal(app.split('staff_inquiry_payments_v1').length - 1, 1, 'one call site');
});
