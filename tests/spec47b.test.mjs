// SPEC-47b (Staff 3.4.13): the face on the Today card is an 88 px rounded square on the RIGHT, zoomed on the server's face box. Hand-computed values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, TODAY } from './_a_harness.mjs';

const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.01, (m || '') + ' ' + a + ' vs ' + b);
const BOX = { x: 0.1, y: 0.2, w: 0.2, h: 0.4, src: 'vision' }; // 1000 x 600 stored photo: 200 x 240 px box, scale 88/240
const S = 88 / 240;
const CASES = [ // [rot, left, top] computed by hand: the box centre must land on (44, 44) in the frame
  [0, -29.3333, -44], [90, -161.3333, 44], [180, -249.3333, -88], [270, -117.3333, -176],
];
for (const [rot, left, top] of CASES) {
  test('faceFrame turn ' + rot + ': the face box fills the 88 px frame, centred', () => {
    const f = CS.faceFrame(BOX, 1000, 600, rot, 88);
    near(f.scale, S, 'scale'); near(f.w, 1000 * S, 'w'); near(f.h, 600 * S, 'h'); near(f.left, left, 'left'); near(f.top, top, 'top'); assert.equal(f.fallback, false);
  });
}
test('faceFrame fallback: no box, src none, or bad numbers = 2.2x cover around 22% / 45% of the upright photo, never the whole ID', () => {
  for (const b of [null, undefined, { x: 0.1, y: 0.1, w: 0.2, h: 0.2, src: 'none' }, { x: null, y: 0, w: 0.2, h: 0.2 }, { x: 0.1, y: 0.1, w: 0, h: 0.2 }]) {
    const f = CS.faceFrame(b, 1000, 600, 0, 88); assert.equal(f.fallback, true);
    near(f.scale, 2.2 * 88 / 600, 'scale'); near(f.w, 322.6667, 'w'); near(f.h, 193.6, 'h'); near(f.left, -26.9867, 'left'); near(f.top, -43.12, 'top');
    assert.ok(f.w > 88 * 3, 'zoomed well past the frame, not fitted');
  }
  const r = CS.faceFrame(null, 1000, 600, 90, 88); near(r.left, -64.5333, 'left'); near(r.top, -36.6667, 'top'); // the x offset clamps at 0 so the frame stays covered
});
test('faceFrame: a box at the very edge is clamped so no blank shows; unusable input returns null', () => {
  const f = CS.faceFrame({ x: 0.9, y: 0.7, w: 0.1, h: 0.3, src: 'vision' }, 1000, 600, 0, 88); // right/bottom corner: scale 88/180, image 488.9 x 293.3
  near(f.left, 88 - 1000 * 88 / 180, 'left clamps to the far edge'); near(f.top, 88 - 600 * 88 / 180, 'top clamps to the far edge');
  assert.equal(CS.faceFrame(BOX, 0, 600, 0, 88), null); assert.equal(CS.faceFrame(BOX, 1000, 600, 45, 88), null); assert.equal(CS.faceFrame(BOX, 1000, 600, 0, 0), null);
});

const html = (app) => app.els['v-home'].innerHTML;
const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-12-31', checkout_time: '12:00', checkin_time: '14:00', tier: 'regular', tier_line: null, notes: null, notable: [], id_photo_path: 'g/1.jpg' }, o || {});
test('Today card: the face is the LAST child of the guest header (right side) and carries the box; absent box still reserves the square', async () => {
  const withBox = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { next_guest: GUEST({ id_face_box: BOX }) }) }) });
  const h = html(withBox); const who = /<div class="T_who">([\s\S]*?)<p class="A_key/.exec(h)[1];
  assert.ok(who.indexOf('T_id') < who.indexOf('T_face'), 'name block first, face after it (right)');
  assert.match(who, /<button class="T_face" type="button" data-act="id-full" data-facepath="g\/1.jpg" data-facebox="\[0\.1,0\.2,0\.2,0\.4,&quot;v&quot;\]" aria-label="Show the ID photo full screen"><\/button><\/div>/);
  const cl = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([], { next_guest: GUEST({}) }) }) });
  assert.match(html(cl), /<span class="T_face" data-facepath="g\/1.jpg"><\/span><\/div>/); assert.doesNotMatch(html(cl), /<button class="T_face"/);
  const none = await boot({ role: 'admin', hash: '#home', handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([], { next_guest: GUEST({ id_photo_path: null }) }) }) });
  assert.doesNotMatch(html(none), /T_face/);
});
test('css: 88 px rounded square, 12 px radius, positioned img, no object-fit; app: alt, no drag, contextmenu blocked on img and box', () => {
  const css = read('styles.css'); const rule = /\.T_face \{[^}]*\}/.exec(css)[0];
  assert.match(rule, /width: 88px; height: 88px;/); assert.match(rule, /border-radius: 12px/); assert.match(rule, /overflow: hidden/); assert.doesNotMatch(rule, /50%/);
  assert.match(/\.T_face img \{[^}]*\}/.exec(css)[0], /position: absolute/); assert.doesNotMatch(/\.T_face img \{[^}]*\}/.exec(css)[0], /object-fit/);
  const src = read('app.js'); assert.match(src, /var A_FACE_PX = 88/); assert.match(src, /img\.alt = 'Guest photo from ID'/); assert.match(src, /box\.addEventListener\('contextmenu'/);
});
