// s120 Lane U (Staff 3.4.37): the Today Guests tile link, the guest count display order, and the first-stay chip. The guest page card is tested in G_guests.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CS, boot, el, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

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
  const owner = { ...live, guest_id: null, arrival_ready: { id: false, paid: null, door_code: null } }; // the owner/admin shape for a stay with no guest record
  assert.deepEqual([CS.goodToKnow(owner, true).idKnown, CS.goodToKnow(owner, true).id], [false, false], 'unlinked with arrival_ready.id false: no pill');
  assert.equal(CS.goodToKnow({ ...owner, guest_id: GID }, true).idKnown, true, 'linked, same arrival_ready: No ID yet may show');
  assert.equal(CS.goodToKnow({ ...owner, arrival_ready: { id: true } }, true).idKnown, true, 'unlinked but the server says the ID is on file');
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

const COUNTED = { names: '', version: 1, guest_count: 2, booked_guests: 3 };
const tiles = (h) => (h.match(/class="T_tile T_tap"/g) || []).length;
const upnext = (h) => h.slice(h.indexOf('T_upnext'));

test('Guests tile: with a count and a guest id, owner and admin get the link and cleaner, laundry and finance a plain tile', async () => {
  for (const role of ['owner', 'admin']) assert.equal(tiles(await home(GUEST({ staying: COUNTED }), role)), 1, role);
  for (const role of ['cleaner', 'laundry', 'finance']) {
    const h = await home(GUEST({ staying: COUNTED }), role);
    assert.equal(tiles(h), 0, role); assert.match(h, /<span class="T_tk">Guests<\/span><span class="T_tv num"><span class="T_fact">[^]*?2 guests/, role + ': the count is there, as a plain tile');
    assert.doesNotMatch(h, /href="#guests\//, role);
  }
});

test('Up next for the same guest as the current stay is a plain tile; a different guest keeps the link', async () => {
  const OTHER = '0a1b2c3d-0000-4000-8000-000000000002';
  const both = async (nextId) => (await boot({ role: 'owner', hash: '#home', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')],
    { current_guest: GUEST({ staying: COUNTED }), next_guest: GUEST({ uid: 'stay-2', guest_id: nextId, checkin_date: '2026-10-20', checkout_date: '2026-10-22', staying: COUNTED }) }) }) })).els['v-home'].innerHTML;
  const same = await both(GID), other = await both(OTHER);
  assert.match(same, /T_upnext/); assert.equal(tiles(same), 1, 'only the current stay links'); assert.equal(tiles(upnext(same)), 0); assert.match(upnext(same), /<span class="T_tk">Guests<\/span>/);
  assert.equal(tiles(other), 2); assert.equal(tiles(upnext(other)), 1);
});

test('shell: setTitle from a module changes the app bar title, and an empty string puts the module title back', async () => {
  let seen = null; const ttl = { textContent: 'Guests' };
  await boot({ role: 'owner', hash: '#guests', els: { 'v-guests': Object.assign(el(), { querySelector: (q) => (q === '.ttl' ? ttl : null) }) },
    winInit: (w) => { w.H_loadAsset = () => Promise.resolve(); w.G_Guests = { mount: (b, o) => { seen = o; } }; }, handlers: baseHandlers('owner') });
  seen.setTitle('Edit details'); assert.equal(ttl.textContent, 'Edit details');
  seen.setTitle(''); assert.equal(ttl.textContent, 'Guests');
});

test('demo: saving who is staying keeps the guest count and the booked number, so the Guests tile still reads the same (run, not grepped)', async () => {
  const app = await boot({ role: 'owner', hash: '#home', demo: true, handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: GUEST({ staying: { names: 'Ana Reyes', version: 1, guest_count: 2, booked_guests: 3 } }), next_guest: null }) }) });
  assert.match(tile(app.els['v-home'].innerHTML), /2 guests/);
  await app.click({ 'data-act': 'stay-open', 'data-uid': 'stay-1' }); app.input('stay-names', 'Ana Reyes, Bo Cruz'); await app.click({ 'data-act': 'stay-save' });
  assert.equal(app.calls.filter((c) => c[0] === 'set_stay_staying_v1').length, 0, 'the demo sends nothing');
  const h = app.els['v-home'].innerHTML;
  assert.match(h, /Ana Reyes, Bo Cruz/, 'the demo applied the new names'); assert.match(tile(h), /2 guests/, 'the count survived the names save');
});

test('the calendar guest card has no Open guest button in this release, even for owner and admin when the payload carries a guest id', async () => {
  for (const role of ['owner', 'admin']) for (const id of [GID, 'g-77']) {
    const cal = await boot({ role, hash: '#calendar/house', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-12', TODAY)], { current_guest: GUEST({ guest_id: id, uid: 'u1', checkin_date: '2026-10-12', checkout_date: TODAY }) }) }) });
    const h = cal.els['v-calendar'].innerHTML; assert.match(h, /id="house"/, role); assert.doesNotMatch(h, /Open guest|href="#guests\//, role + ' ' + id);
  }
});
