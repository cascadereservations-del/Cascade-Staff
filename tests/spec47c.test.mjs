// SPEC-47c (Staff 3.4.14): Today card layout. Face beside name + chip only, one time line, initial placeholder until the face is located. Hand-computed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, boot, HOMEWITH, baseHandlers, TODAY, el } from './_a_harness.mjs';

const BOX = { x: 0.1, y: 0.2, w: 0.2, h: 0.4, src: 'vision' };
const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-16', checkout_time: '12:00', checkin_time: '14:00', nights: 1, tier: 'regular', tier_line: 'Late check-out when free; a long benefits line that must run the full card width', notes: null, notable: [], id_photo_path: 'g/1.jpg' }, o || {});
const home = async (g, role = 'admin') => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([], { next_guest: g }) }) })).els['v-home'].innerHTML;

test('header: the face is inside the name row; the benefits line, the time line and the link are outside it', async () => {
  const h = await home(GUEST({ id_face_box: BOX }));
  const who = /<div class="T_who">([\s\S]*?)<\/div><button class="T_face"[^>]*><\/button><\/div>/.exec(h);
  assert.ok(who, 'T_who = name column then the face, then closes');
  assert.match(who[1], /^<div class="T_id"><div class="T_namerow"><h2 class="A_name">Ana Reyes<\/h2>/); assert.doesNotMatch(who[1], /T_line/);
  const after = h.slice(h.indexOf(who[0]) + who[0].length);
  assert.ok(after.indexOf('T_when') >= 0 && after.indexOf('T_when') < after.indexOf('T_gtk') && after.indexOf('T_gtk') < after.indexOf('T_line'), 'order: time line, Good to know, then the benefits line');
  assert.ok(after.indexOf('T_line') < after.indexOf('A_more'));
});
test('one time line: key time strong, then the dates and nights; month said once; 2 months kept; Out for a guest in the house', async () => {
  assert.match(await home(GUEST()), /<p class="sub num T_when"><strong class="A_key">In 2:00 pm<\/strong> · 15 → 16 Oct · 1 night<\/p>/);
  assert.match(await home(GUEST({ checkout_date: '2026-11-02', nights: 18 })), /<strong class="A_key">In 2:00 pm<\/strong> · 15 Oct → 2 Nov · 18 nights<\/p>/);
  const inHouse = (await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { current_guest: GUEST({ checkin_date: '2026-10-13', checkout_date: '2026-10-17', nights: 4 }) }) }) })).els['v-home'].innerHTML;
  assert.match(inHouse, /<strong class="A_key">Out 17 Oct, 12:00 noon<\/strong> · 4 nights<\/p>/); assert.doesNotMatch(inHouse, /T_dates/);
});
test('placeholder: null box and src none give the initial on the tier class, never the ID; no tier = neutral; no photo = nothing', async () => {
  for (const [tier, cls] of [['returning', ' T_returning'], ['regular', ' T_regular'], ['vip', ' T_vip'], [null, '']]) {
    const h = await home(GUEST({ tier, id_face_box: null, guest_name: '  élodie' }));
    assert.match(h, new RegExp('<button class="T_face T_ph' + cls + '" type="button" data-act="id-full" data-idpath="g/1.jpg" aria-label="Show the ID photo full screen">É</button>')); assert.doesNotMatch(h, /data-facepath/);
  }
  assert.match(await home(GUEST({ id_face_box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, src: 'none' } }), 'cleaner'), /<span class="T_face T_ph T_regular" aria-hidden="true">A<\/span>/);
  assert.match(await home(GUEST({ id_face_box: undefined })), /T_ph/); assert.match(await home(GUEST({ guest_name: null })), /aria-label="Show the ID photo full screen">G<\/button>/);
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

test('untiered returning guest: the older Returning pill is inside the name row, not under the header', async () => {
  const h = await home(GUEST({ tier: null, tier_line: null, repeat: true, stay_count: 3, id_face_box: BOX }));
  const row = /<div class="T_namerow">([\s\S]*?)<\/div><\/div><button class="T_face"/.exec(h); assert.ok(row, 'name row closes right before the face');
  assert.match(row[1], /<h2 class="A_name">Ana Reyes<\/h2><span class="pill p-tier-returning">/); assert.match(row[1], /Returning · 3rd stay/);
  assert.equal((h.match(/Returning · 3rd stay/g) || []).length, 1, 'shown once');
});
test('owner tap on the initial loads the photo once and opens the full view; the cleaner gets a bare span', async () => {
  let signs = 0; const full = el(), attrs = {}; full.setAttribute = (k, x) => { attrs[k] = x; }; full.getAttribute = (k) => attrs[k] || null; full.querySelector = () => ({ className: '', textContent: '' });
  class U extends URL { static createObjectURL() { return 'blob:c/1'; } static revokeObjectURL() {} }
  const boot1 = (role) => boot({ role, hash: '#home', els: { H_idfull: full }, ctxExtra: { URL: U },
    storage: { from: () => ({ createSignedUrl: () => { signs++; return Promise.resolve({ data: { signedUrl: 'https://signed.test/x' }, error: null }); } }) },
    foldFetch: (u) => Promise.resolve(/signed/.test(String(u)) ? { ok: true, blob: () => Promise.resolve({}) } : { ok: false }),
    handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([], { next_guest: GUEST({ id_face_box: null }) }) }) });
  const app = await boot1('owner'); await app.flush();
  assert.match(app.els['v-home'].innerHTML, /<button class="T_face T_ph T_regular" type="button" data-act="id-full" data-idpath="g\/1.jpg"/); assert.doesNotMatch(app.els['v-home'].innerHTML, /data-facepath/); assert.equal(signs, 0, 'rendering downloads nothing');
  const btn = { getAttribute: (k) => (k === 'data-act' ? 'id-full' : k === 'data-idpath' ? 'g/1.jpg' : null), hasAttribute: (k) => k === 'data-act', querySelector: () => null };
  for (const fn of app.listeners.click || []) fn({ target: { closest: () => btn } });
  await new Promise((r) => setTimeout(r, 30)); assert.equal(signs, 1, 'one photo load'); assert.equal(attrs['data-src'], 'blob:c/1', 'the full view opened on the loaded photo');
  const cl = await boot1('cleaner'); assert.match(cl.els['v-home'].innerHTML, /<span class="T_face T_ph T_regular" aria-hidden="true">A<\/span>/); assert.doesNotMatch(cl.els['v-home'].innerHTML, /data-idpath/);
});
test('time line breaks only at the middle dots: every number is joined to its unit', async () => {
  const h = await home(GUEST({ checkout_date: '2026-11-02', nights: 18 })); const line = /<p class="sub num T_when">([\s\S]*?)<\/p>/.exec(h)[1];
  const txt = line.replace(/<[^>]+>/g, ''); assert.deepEqual(txt.split(' · '), ['In 2:00 pm', '15 Oct → 2 Nov', '18 nights']); assert.doesNotMatch(txt.replace(/ · /g, ''), / /, 'no plain space left inside a segment');
});
