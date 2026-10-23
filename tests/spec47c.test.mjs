// SPEC-47c (Staff 3.4.14): Today card layout. Face beside name + chip only, one time line, initial placeholder until the face is located. Hand-computed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, boot, HOMEWITH, baseHandlers, TODAY } from './_a_harness.mjs';

const BOX = { x: 0.1, y: 0.2, w: 0.2, h: 0.4, src: 'vision' };
const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-16', checkout_time: '12:00', checkin_time: '14:00', nights: 1, tier: 'regular', tier_line: 'Late check-out when free; a long benefits line that must run the full card width', notes: null, notable: [], id_photo_path: 'g/1.jpg' }, o || {});
const home = async (g, role = 'admin') => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([], { next_guest: g }) }) })).els['v-home'].innerHTML;

test('header: the face is inside the name row; the benefits line, the time line and the link are outside it', async () => {
  const h = await home(GUEST({ id_face_box: BOX }));
  const who = /<div class="T_who">([\s\S]*?)<\/div><button class="T_face"[^>]*><\/button><\/div>/.exec(h);
  assert.ok(who, 'T_who = name column then the face, then closes');
  assert.match(who[1], /^<div class="T_id"><div class="T_namerow"><h2 class="A_name">Ana Reyes<\/h2>/); assert.doesNotMatch(who[1], /T_line/);
  const after = h.slice(h.indexOf(who[0]) + who[0].length);
  assert.ok(after.indexOf('T_line') >= 0 && after.indexOf('T_line') < after.indexOf('T_when'), 'benefits line is under the header, before the time line');
  assert.ok(after.indexOf('T_when') < after.indexOf('A_more'));
});
test('one time line: key time strong, then the dates and nights; month said once; 2 months kept; Out for a guest in the house', async () => {
  assert.match(await home(GUEST()), /<p class="sub num T_when"><strong class="A_key">In 2:00 pm<\/strong> · 15 → 16 Oct · 1 night<\/p>/);
  assert.match(await home(GUEST({ checkout_date: '2026-11-02', nights: 18 })), /<strong class="A_key">In 2:00 pm<\/strong> · 15 Oct → 2 Nov · 18 nights<\/p>/);
  const inHouse = (await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { current_guest: GUEST({ checkin_date: '2026-10-13', checkout_date: '2026-10-17', nights: 4 }) }) }) })).els['v-home'].innerHTML;
  assert.match(inHouse, /<strong class="A_key">Out 12:00 noon<\/strong> · 13 → 17 Oct · 4 nights<\/p>/); assert.doesNotMatch(inHouse, /T_dates/);
});
test('placeholder: null box and src none give the initial on the tier class, never the ID; no tier = neutral; no photo = nothing', async () => {
  for (const [tier, cls] of [['returning', ' T_returning'], ['regular', ' T_regular'], ['vip', ' T_vip'], [null, '']]) {
    const h = await home(GUEST({ tier, id_face_box: null, guest_name: '  élodie' }));
    assert.match(h, new RegExp('<span class="T_face T_ph' + cls + '" aria-hidden="true">É</span>')); assert.doesNotMatch(h, /data-facepath|<button class="T_face"/);
  }
  assert.match(await home(GUEST({ id_face_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, src: 'none' } }), 'cleaner'), /<span class="T_face T_ph T_regular" aria-hidden="true">A<\/span>/);
  assert.match(await home(GUEST({ id_face_box: undefined })), /T_ph/); assert.match(await home(GUEST({ guest_name: null })), /aria-hidden="true">G<\/span>/);
  assert.doesNotMatch(await home(GUEST({ id_photo_path: null })), /T_face/);
});
test('face for vision: the photo box carries data-facepath and the box; the cleaner gets the picture only', async () => {
  assert.match(await home(GUEST({ id_face_box: BOX })), /<button class="T_face" type="button" data-act="id-full" data-facepath="g\/1.jpg" data-facebox="\[0\.1,0\.2,0\.2,0\.4,&quot;v&quot;\]"/);
  assert.match(await home(GUEST({ id_face_box: BOX }), 'cleaner'), /<span class="T_face" data-facepath="g\/1.jpg" data-facebox=/);
});
test('turnover card with no turnover: one line under the label', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { current_guest: GUEST({ checkin_date: '2026-10-13', checkout_date: '2026-10-17' }) }) }) });
  assert.match(app.els['v-home'].innerHTML, /<span class="cap up">Turnover today<\/span><p class="sub" style="margin:0">None today · nothing booked to leave soon<\/p>/); // the next-out form is pinned in shell-v5 (19 Oct, 12:00 noon)
});
test('css: tier-coloured placeholder in the same 88 px slot, 10 px rhythm, name one step smaller and fluid, key time 500 weight', () => {
  const css = read('styles.css');
  assert.match(css, /\.T_ph \{[^}]*font: 500 2rem\/1 var\(--v5-font-display\)/); assert.match(css, /\.T_ph\.T_vip \{ background: var\(--v5-tier-vip-w\); color: var\(--v5-tier-vip-t\); \}/);
  assert.match(css, /\.A_card\.T_card \{ row-gap: 10px; padding-bottom: 8px; \}/); assert.match(css, /\.A_card\.T_card \.A_name \{ font-size: clamp\(1\.375rem, 1\.3075rem \+ 0\.3vw, 1\.54rem\); line-height: 1\.2; \}/);
  assert.match(css, /strong\.A_key \{ font-weight: 500;/);
});
