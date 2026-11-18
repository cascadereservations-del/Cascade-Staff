// s120 Lane U (Staff 3.4.36): the Today Guests tile link, the guest count display order, and the first-stay chip. The guest page card is tested in G_guests.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CS, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const GID = '0a1b2c3d-0000-4000-8000-000000000001';
const GUEST = (o) => Object.assign({ uid: 'stay-1', guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 2, repeat: false, stay_count: 1, tier: 'first', tier_line: null, notes: null, id_photo_path: null, guest_id: GID }, o || {});
const home = async (cur, role = 'owner') => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: cur, next_guest: null }) }) })).els['v-home'].innerHTML;
const tile = (h) => (/<a class="T_tile T_tap"[\s\S]*?<\/a>/.exec(h) || [''])[0];

test('Guests tile is a link to the guest page for owner and admin, with the chevron and a count label', async () => {
  for (const role of ['owner', 'admin']) {
    const h = await home(GUEST({ staying: { names: '', version: 0, guest_count: 2, booked_guests: 3 } }), role), a = tile(h);
    assert.match(a, new RegExp('href="#guests/' + GID + '/stay"'), role); assert.match(a, /Guests/); assert.match(a, /class="chev"/); assert.match(a, /2 guests/);
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

test('goodToKnow idKnown reads the same whether staff_home_v1 sends guest_id or not (live shape: the key is absent for now)', () => {
  const live = { guest_name: 'Ana Reyes', id_photo_path: null, arrival_ready: null }; // production today: no guest_id key at all
  assert.equal('guest_id' in live, false);
  assert.deepEqual([CS.goodToKnow(live, true).idKnown, CS.goodToKnow(live, true).id], [true, false], 'absent key: the old behaviour, a No ID yet pill');
  assert.equal(CS.goodToKnow({ ...live, guest_id: GID }, true).idKnown, true, 'present');
  assert.equal(CS.goodToKnow({ ...live, guest_id: null }, true).idKnown, false, 'explicitly unlinked: says nothing');
  assert.equal(CS.goodToKnow({ ...live, guest_id: GID, id_photo_path: 'p/a.jpg' }, true).id, true);
});

test('live-shape Today payload: no guest_id keeps the plain Guests tile; with guest_id the tile links to the stay card', async () => {
  const noKey = GUEST({}); delete noKey.guest_id;
  const h = await home(noKey); assert.equal(tile(h), ''); assert.match(h, /Guests<\/span>/);
  assert.match(tile(await home(GUEST({ staying: { names: '', version: 0, guest_count: 2, booked_guests: 3 } }))), /href="#guests\/[0-9a-f-]{36}\/stay"/);
});

test('shell: the guest module gets onChange and setTitle; a saved count refreshes Today, so the tile and the names version are new', async () => {
  let seen = null, ver = 1, cnt = 2;
  const payload = () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: GUEST({ staying: { names: '', version: ver, guest_count: cnt, booked_guests: 3 } }), next_guest: null });
  const rs = [];
  const app = await boot({ role: 'owner', hash: '#guests/' + GID + '/stay', winInit: (w) => { w.H_loadAsset = () => Promise.resolve(); w.G_Guests = { mount: (b, o) => { seen = o; } }; },
    handlers: baseHandlers('owner', { staff_home_v1: payload, set_stay_staying_v1: (a) => { rs.push(a); return { error: null, data: { ok: true, version: ver + 1 } }; } }) });
  assert.equal(typeof seen.onChange, 'function'); assert.equal(typeof seen.setTitle, 'function'); assert.equal(seen.sub, GID + '/stay');
  const before = app.calls.filter((c) => c[0] === 'staff_home_v1').length;
  cnt = 3; ver = 5; seen.onChange(); await app.flush(); // the guest page saved: the server now holds 3 guests at version 5
  assert.equal(app.calls.filter((c) => c[0] === 'staff_home_v1').length, before + 1, 'Today was read again');
  app.location.hash = '#home'; for (const f of app.winListeners.hashchange || []) f(); await app.flush();
  assert.match(tile(app.els['v-home'].innerHTML), /3 guests/);
  await app.click({ 'data-act': 'stay-open', 'data-uid': 'stay-1' }); app.input('stay-names', 'Ana Reyes, Bo Cruz'); await app.click({ 'data-act': 'stay-save' });
  assert.equal(rs[0].p_expected_version, 5, 'the names save uses the version read after the count save: no 40001');
});

test('demo names save keeps guest_count and booked_guests on the staying object', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /g\.staying = Object\.assign\(\{\}, g\.staying, \{ names: use\.join/);
});
