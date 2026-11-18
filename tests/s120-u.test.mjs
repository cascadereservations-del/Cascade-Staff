// s120 Lane U (Staff 3.4.36): the Today Guests tile link, the guest count display order, and the first-stay chip. The guest page card is tested in G_guests.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const GID = '0a1b2c3d-0000-4000-8000-000000000001';
const GUEST = (o) => Object.assign({ uid: 'stay-1', guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 2, repeat: false, stay_count: 1, tier: 'first', tier_line: null, notes: null, id_photo_path: null, guest_id: GID }, o || {});
const home = async (cur, role = 'owner') => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: cur, next_guest: null }) }) })).els['v-home'].innerHTML;
const tile = (h) => (/<a class="T_tile T_tap"[\s\S]*?<\/a>/.exec(h) || [''])[0];

test('Guests tile is a link to the guest page for owner and admin, with the chevron and a count label', async () => {
  for (const role of ['owner', 'admin']) {
    const h = await home(GUEST({ staying: { names: '', version: 0, guest_count: 2, booked_guests: 3 } }), role), a = tile(h);
    assert.match(a, new RegExp('href="#guests/' + GID + '"'), role); assert.match(a, /Guests/); assert.match(a, /class="chev"/); assert.match(a, /2 guests/);
  }
});

test('Guests tile stays a plain tile for a cleaner, and for a stay with no guest id', async () => {
  assert.equal(tile(await home(GUEST({}), 'cleaner')), '');
  assert.equal(tile(await home(GUEST({ guest_id: null }), 'owner')), '');
  assert.equal(tile(await home(GUEST({ guest_id: 'not-an-id' }), 'owner')), '');
  assert.match(await home(GUEST({}), 'cleaner'), /Guests<\/span>/);
});

test('first-stay card carries one tier chip and no duplicate label', async () => {
  const h = await home(GUEST({}));
  const head = h.slice(0, h.indexOf('T_tiers') < 0 ? h.length : h.indexOf('T_tiers')).replace(/<p class="sub T_prog">[^<]*<\/p>/g, '');
  assert.equal((head.match(/First stay/g) || []).length, 1);
});

test('goodToKnow display order: staff count, booked number, then 1 + companions', () => {
  const g = (o) => CS.goodToKnow(Object.assign({ guest_name: 'Ana Reyes', companions: [{ name: 'Bo' }, { name: 'Cy' }] }, o), true).guests;
  assert.equal(g({}), 3, 'fallback 1 + companions');
  assert.equal(g({ staying: { booked_guests: 2 } }), 2, 'booked beats the fallback');
  assert.equal(g({ staying: { booked_guests: 2, guest_count: 1 } }), 1, 'staff count beats booked');
  assert.equal(g({ guest_count: 2, staying: { booked_guests: 3 } }), 2, 'top level staff count');
  assert.equal(g({ staying: { guest_count: 0, booked_guests: null } }), 3, 'zero and null are not counts');
  assert.equal(CS.goodToKnow({ guest_name: 'Ana', num_guests: 2 }, false).guests, 2, 'older field still works for every role');
});
