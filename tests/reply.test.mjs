import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const CS = createRequire(import.meta.url)('../lib.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('role gate: owner and admin only; cleaner, inspector, maintenance, finance and nothing are shut out', () => {
  for (const r of ['owner', 'admin']) assert.equal(CS.canDraftReply(r), true);
  for (const r of ['cleaner', 'inspector', 'maintenance', 'finance', 'guest', '', null, undefined]) assert.equal(CS.canDraftReply(r), false, String(r));
});

test('shrink: longest edge capped at 1600, aspect kept, small pictures untouched, never zero', () => {
  assert.deepEqual(CS.shrinkSize(3200, 1600), { w: 1600, h: 800 });
  assert.deepEqual(CS.shrinkSize(1170, 2532), { w: 739, h: 1600 }); // a phone screenshot
  assert.deepEqual(CS.shrinkSize(1600, 1600), { w: 1600, h: 1600 });
  assert.deepEqual(CS.shrinkSize(800, 600), { w: 800, h: 600 });
  assert.deepEqual(CS.shrinkSize(100000, 10), { w: 1600, h: 1 });
  assert.deepEqual(CS.shrinkSize(0, 0), { w: 1, h: 1 });
  for (const [w, h] of [[4032, 3024], [1170, 2532], [5000, 700], [700, 5000]]) {
    const z = CS.shrinkSize(w, h);
    assert.ok(Math.max(z.w, z.h) <= 1600);
    assert.ok(Math.abs(z.w / z.h - w / h) / (w / h) < 0.01, 'aspect ' + w + 'x' + h);
  }
});

test('problems before sending: empty, too long, no screenshot', () => {
  assert.match(CS.replyProblem({ mode: 'text', text: '   ' }), /Paste what the guest sent/);
  assert.match(CS.replyProblem({ mode: 'text', text: 'x'.repeat(4001) }), /4,000/);
  assert.equal(CS.replyProblem({ mode: 'text', text: 'x'.repeat(4000) }), '');
  assert.equal(CS.replyProblem({ mode: 'text', text: ' Hello ' }), '');
  assert.match(CS.replyProblem({ mode: 'image', image: null }), /screenshot/);
  assert.equal(CS.replyProblem({ mode: 'image', image: { base64: 'QUJD', mime: 'image/jpeg' } }), '');
});

test('body: text sends text only, image sends image only, name is null when empty, platform defaults to messenger', () => {
  const t = CS.replyBody({ mode: 'text', text: '  Is the pool open?  ', guestName: ' Ana ', platform: 'airbnb' });
  assert.deepEqual(t, { text: 'Is the pool open?', guest_name: 'Ana', platform: 'airbnb' });
  assert.equal('image' in t, false);
  const i = CS.replyBody({ mode: 'image', image: { base64: 'QUJD', mime: 'image/jpeg' }, text: 'left over', guestName: '' });
  assert.deepEqual(i, { image: { base64: 'QUJD', mime: 'image/jpeg' }, guest_name: null, platform: 'messenger' });
  assert.equal('text' in i, false);
  assert.equal(CS.replyBody({ mode: 'text', text: 'hi', platform: 'whatsapp' }).platform, 'messenger');
  assert.equal(CS.replyBody({ mode: 'text', text: 'hi', guestName: 'n'.repeat(200) }).guest_name.length, 80);
});

test('every error code gets its own warm sentence: no raw code, no exclamation mark, no Unfortunately', () => {
  const cases = [[400, 'empty'], [400, 'both'], [400, 'too_long'], [400, 'bad_image'], [400, 'bad_json'], [401, 'invalid_or_expired_session'], [403, 'staff_access_denied'],
    [413, 'image_too_large'], [422, 'no_guest_message'], [502, 'draft_failed']];
  const seen = new Set();
  for (const [status, code] of cases) {
    const s = CS.replyErrorText(status, code);
    assert.ok(s.length > 20 && /[.]$/.test(s), code);
    assert.ok(!s.includes('_'), 'raw code leaked: ' + code);
    assert.ok(!/!|unfortunately/i.test(s), code);
    seen.add(s);
  }
  assert.equal(seen.size, cases.length, 'one distinct sentence per code');
  assert.equal(CS.replyErrorText(403, 'staff_access_denied'), 'Only owner and admin accounts can draft guest replies.');
  assert.match(CS.replyErrorText(0, 'network'), /No connection/);
  assert.match(CS.replyErrorText(0, undefined), /No connection/); // fetch threw: status 0
  assert.equal(CS.replyErrorText(403, undefined), CS.replyErrorText(403, 'staff_access_denied')); // status alone is enough
  assert.equal(CS.replyErrorText(502, 'something_new'), CS.replyErrorText(502, 'draft_failed'));
  assert.match(CS.replyErrorText(500, 'boom'), /Try again/);
});

test('a 200 body becomes what the screen draws; a wrong shape is null', () => {
  const ok = { ok: true, guest_name: 'Ana', platform: 'airbnb', guest_text: 'Is breakfast included?', header: 'Two options', replies: ['One', 'Two', 'Three'] };
  assert.deepEqual(CS.replyResult(ok), { guestName: 'Ana', platform: 'airbnb', guestText: 'Is breakfast included?', header: 'Two options', replies: ['One', 'Two'] });
  assert.equal(CS.replyResult({ ...ok, guest_name: null }).guestName, '');
  assert.equal(CS.replyResult({ ...ok, platform: 'x' }).platform, 'messenger');
  for (const bad of [null, {}, { ok: false }, { ok: true }, { ok: true, replies: [] }, { ok: true, replies: ['  ', 3] }]) assert.equal(CS.replyResult(bad), null);
});

test('clamp keeps the guest text short and on one line', () => {
  assert.equal(CS.clampText('a\n\n  b   c', 50), 'a b c');
  const c = CS.clampText('word '.repeat(100), 280);
  assert.ok(c.length <= 280 && c.endsWith('…'));
});

test('wiring: the reply view is gated by role in the route, the home and More rows, and posts to the function with a bearer token', () => {
  const app = read('app.js'), html = read('index.html'), sw = read('sw.js');
  assert.match(app, /if \(v === 'reply' && !canReply\(\)\) v = 'home'/);
  assert.equal((app.match(/canReply\(\) \? row\(/g) || []).length, 2, 'home and More');
  assert.match(app, /\/functions\/v1\/guest-reply-draft'.*Authorization: 'Bearer ' \+ token/);
  assert.match(html, /id="v-reply"/);
  assert.match(app, /VIEWS = \[[^\]]*'reply'/);
  // the service worker never touches a POST or a function call
  assert.match(sw, /request\.method !== 'GET'\) return/);
  assert.match(sw, /'\/functions\/v1\/'/);
});
