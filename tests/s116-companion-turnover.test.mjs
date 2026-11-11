// s116 (Staff 3.4.33): whose face is on the ID (id_photo_name), the face on Up next, and the turnover-today tag. Hand-computed expectations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow } from './_a_harness.mjs';

const GUEST = (o) => Object.assign({ guest_name: 'Joseph Ewing', checkin_date: '2026-10-13', checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 4, repeat: false, stay_count: 1, tier: null, notes: null, id_photo_path: 'g/1.jpg', id_face_box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3, src: 'model' } }, o || {});
const homeHtml = async (role, extra, cal) => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH(cal || [stayRow('Joseph Ewing', '2026-10-13', '2026-10-17')], extra) }) })).els['v-home'].innerHTML;
const calHtml = async (g) => (await boot({ role: 'owner', hash: '#calendar/house', handlers: baseHandlers('owner', { staff_home_v1: () => HOMEWITH([stayRow('Joseph Ewing', '2026-10-13', '2026-10-17')], { current_guest: g }) }) })).els['v-calendar'].innerHTML;

test('s116 CS.photoOwnerName: case and space insensitive; equal, empty or missing gives null', () => {
  const n = (a, b) => CS.photoOwnerName({ guest_name: a, id_photo_name: b });
  assert.equal(n('Joseph Ewing', 'Eliza Acaso'), 'Eliza Acaso');
  assert.equal(n('Joseph Ewing', '  Eliza   Acaso '), 'Eliza Acaso', 'trimmed, inner spaces collapsed');
  assert.equal(n('Joseph Ewing', 'joseph  EWING'), null);
  assert.equal(n('Joseph Ewing', ' Joseph Ewing '), null);
  assert.equal(n('Joseph Ewing', ''), null); assert.equal(n('Joseph Ewing', '   '), null); assert.equal(n('Joseph Ewing', null), null);
  assert.equal(CS.photoOwnerName({ guest_name: 'Joseph Ewing' }), null, 'key absent (old server)'); assert.equal(CS.photoOwnerName(null), null);
  assert.equal(CS.stayingLine({ guest_name: 'Joseph Ewing', id_photo_name: 'Eliza Acaso' }), 'Staying: Eliza Acaso');
  assert.equal(CS.idOfLine({ guest_name: 'Joseph Ewing', id_photo_name: 'Eliza Acaso' }), 'ID of Eliza Acaso, travelling with Joseph Ewing');
  assert.equal(CS.stayingLine({ guest_name: 'Joseph Ewing', id_photo_name: 'joseph ewing' }), null); assert.equal(CS.idOfLine({ guest_name: 'A', id_photo_name: 'a' }), null);
});

test('s116 Staying line: Today card, Up next and the calendar guest card when the photo name differs; nothing when equal or null', async () => {
  const cur = GUEST({ id_photo_name: 'Eliza Acaso' }), nxt = GUEST({ guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', id_photo_name: 'Mara Cruz' });
  for (const role of ['owner', 'cleaner']) {
    const h = await homeHtml(role, { current_guest: cur, next_guest: nxt });
    assert.match(h, /<h2 class="A_name">Joseph Ewing<\/h2>[\s\S]*?<p class="sub T_stay">Staying: Eliza Acaso<\/p>/, role);
    assert.match(h, /T_upnext[\s\S]*?<h3 class="T_nname">Ben Cruz<\/h3>[\s\S]*?<p class="sub T_stay">Staying: Mara Cruz<\/p>/, role);
    assert.equal((h.match(/class="sub T_stay"/g) || []).length, 2, role);
  }
  const cal = await calHtml(cur);
  assert.match(cal, /<h3 class="ttl">Joseph Ewing<\/h3>[\s\S]*?<p class="sub T_stay">Staying: Eliza Acaso<\/p>/);
  assert.match(cal, /<p class="help T_idof"[^>]*>ID of Eliza Acaso, travelling with Joseph Ewing<\/p>/);
  for (const same of [GUEST({ id_photo_name: 'joseph  ewing' }), GUEST({ id_photo_name: null }), GUEST()]) {
    assert.doesNotMatch(await homeHtml('owner', { current_guest: same }), /T_stay|Staying:/);
    assert.doesNotMatch(await calHtml(same), /T_stay|T_idof|ID of /);
  }
});

test('s116 Up next shows the 88 px face square Today shows (initial without a located face, nothing without a photo)', async () => {
  const cur = GUEST(), nxt = GUEST({ guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', id_photo_path: 'g/2.jpg' });
  for (const role of ['owner', 'cleaner']) {
    const h = await homeHtml(role, { current_guest: cur, next_guest: nxt });
    assert.match(h.slice(h.indexOf('T_upnext')), /<div class="T_who"><div class="T_id">[\s\S]*?(<button class="T_face"|<span class="T_face")[^>]*data-facepath="g\/2\.jpg"/, role);
    const up = h.slice(h.indexOf('T_upnext')), face = up.match(/<(button|span) class="T_face"[^>]*>/);
    assert.ok(face, 'face drawn: ' + role);
    if (role === 'owner') { assert.equal(face[1], 'button'); assert.match(face[0], /data-act="id-full"/); } else { assert.equal(face[1], 'span'); assert.doesNotMatch(face[0], /data-act/); }
  }
  const ph = await homeHtml('owner', { current_guest: cur, next_guest: Object.assign({}, nxt, { id_face_box: null }) });
  assert.match(ph.slice(ph.indexOf('T_upnext')), /<button class="T_face T_ph[^"]*" type="button" data-act="id-full" data-idpath="g\/2\.jpg"[^>]*>B<\/button>/);
  const none = await homeHtml('owner', { current_guest: cur, next_guest: Object.assign({}, nxt, { id_photo_path: null }) });
  assert.doesNotMatch(none.slice(none.indexOf('T_upnext')), /T_face/);
  assert.match(read('styles.css'), /\.T_face \{[^}]*width: 88px; height: 88px/);
});

test('s116 Turnover today tag: every role, only when a checkout is today; the Turnover card gets the accent outline', async () => {
  const out = [stayRow('Joseph Ewing', '2026-10-12', '2026-10-15')], cur = GUEST({ checkin_date: '2026-10-12', checkout_date: '2026-10-15', checkout_time: '11:00:00' });
  for (const role of ['owner', 'admin', 'finance', 'cleaner', 'laundry']) {
    const h = await homeHtml(role, { current_guest: cur }, out);
    const tag = h.match(/<p class="A_turntag"[\s\S]*?<\/p>/);
    assert.ok(tag, 'tag drawn: ' + role);
    assert.match(tag[0], /<span>Turnover today · out 11:00 am<\/span>/, role);
    assert.doesNotMatch(tag[0], /!/);
    if (role !== 'laundry') assert.match(h, /aria-label="Turnover today"[\s\S]*?(Today · out 11:00 am · in |Guest out 11:00 am)/, 'card shows the same out time as the tag: ' + role);
    assert.ok(h.indexOf('A_turntag') < h.indexOf('aria-label="Today in the house"'), 'tag sits above the Today card: ' + role);
    if (role !== 'laundry') assert.match(h, /class="card glass A_card A_turnnow" aria-label="Turnover today"/, role);
  }
  const noTime = await homeHtml('cleaner', { current_guest: Object.assign({}, cur, { checkout_time: null }) }, [stayRow('Joseph Ewing', '2026-10-12', '2026-10-15', { checkout_time: null })]);
  assert.match(noTime, /Turnover today · out 12:00 noon/, 'house time fallback');
  for (const role of ['owner', 'cleaner']) assert.doesNotMatch(await homeHtml(role, { current_guest: GUEST() }), /A_turntag|A_turnnow/, role);
});

test('s116 the demo carries a guest whose ID photo name differs; release is 3.4.33 / cs-shell-v58', () => {
  assert.match(read('demo.js'), /id_photo_name: 'Demo Companion One'/);
  assert.equal(JSON.parse(read('package.json')).version, '3.4.33'); assert.match(read('app.js'), /version: '3.4.33'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v58'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v58';/);
});
