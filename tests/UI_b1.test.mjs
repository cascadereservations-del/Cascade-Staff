// UI Phase B1 (s85): Today. One primary button per role and day type; a sub-page marks no tab; shorter hero; owner tiles at 768.
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, boot, baseHandlers, HOMEWITH, stayRow, ACCESS } from './_a_harness.mjs';

const TODAY = '2026-10-15';
const turnover = () => HOMEWITH([stayRow('Ana', '2026-10-12', TODAY), stayRow('Ben', TODAY, '2026-10-18')]);
const quiet = () => HOMEWITH([]);
const prim = (h) => [...h.matchAll(/data-primary="([a-z-]+)"/g)].map((m) => m[1]);
const home = async (role, home, extra) => { const app = await boot({ role, hash: '#home', handlers: baseHandlers(role, Object.assign({ staff_home_v1: home }, extra || {})) }); return app.els['v-home'].innerHTML; };

test('cleaner on a turnover day: one primary, Start cleaning, the existing checklist door', async () => {
  const h = await home('cleaner', turnover);
  assert.deepEqual(prim(h), ['start-cleaning']);
  assert.match(h, /<a class="A_slide" data-slide href="[^"]+"[^>]*data-primary="start-cleaning"[^>]*>[^]*Start cleaning/);
});

test('cleaner on a quiet day: one primary, not the checklist', async () => {
  const h = await home('cleaner', quiet);
  assert.equal(prim(h).length, 1); assert.notEqual(prim(h)[0], 'start-cleaning');
});

test('owner: one primary on either day type; Pay staff when a request waits, else the attention item or the calendar', async () => {
  for (const day of [turnover, quiet]) { const h = await home('owner', day); assert.equal(prim(h).length, 1); assert.doesNotMatch(h, /start-cleaning/); }
  const ov = (extra) => baseHandlers('owner', Object.assign({ staff_home_v1: quiet }, extra));
  const mk = async (extra) => (await boot({ role: 'owner', hash: '#home', handlers: ov(extra)})).els['v-home'].innerHTML;
  const waiting = await mk({ staff_pay_admin_list_v1: () => ({ error: null, data: { ok: true, requests: [{ id: 'r1', status: 'requested' }] } }) });
  const none = await mk({ staff_pay_admin_list_v1: () => ({ error: null, data: { ok: true, requests: [{ id: 'r1', status: 'paid' }] } }) });
  assert.ok(prim(none).length === 1 && prim(none)[0] !== 'pay-staff');
  assert.deepEqual(prim(waiting), ['pay-staff']); assert.match(waiting, /data-primary="pay-staff" href="[^"]*admin\.html[^"]*">Pay staff</);
});

test('owner primary rule in the source: pay request first, then the top attention item', () => {
  const s = read('app.js'), f = s.slice(s.indexOf('function A_primary'), s.indexOf('function A_turnoverCard'));
  assert.ok(f.indexOf('pay-staff') < f.indexOf('attn-open'));
  assert.match(f, /state\.payWait > 0/);
});

test('a sub-page marks no tab; Today, Calendar, Tasks and More still do', async () => {
  const s = read('app.js'); assert.match(s, /v === 'stock' \|\| v === 'manage' \|\| v === 'guests' \|\| v === 'inbox' \? '' : v/);
  const tabs = async (hash) => { const app = await boot({ role: 'owner', hash, handlers: baseHandlers('owner') }); return app.els.tabbar.innerHTML; };
  assert.doesNotMatch(await tabs('#stock'), /aria-current/);
  assert.match(await tabs('#home'), /aria-current="page"><span class="ico">[^]*Today/);
  assert.match(await tabs('#more'), /aria-current="page"[^>]*>[^]*More/);
});

test('css: hero shorter, primary 56 px, owner tiles from 48 rem', () => {
  const c = read('styles.css');
  assert.match(c, /#v-home \.A_hero \{ min-height: 9\.5rem;/); assert.match(c, /\.A_primary, \.A_card \.A_primary \{ min-height: 56px;/);
  assert.match(c, /@media \(min-width: 48rem\) \{\s*\.A_body > \.F_group\.A_tiles \{ column-span: all; \}[^]*grid-template-columns: repeat\(2/);
  const s = read('app.js'); assert.equal((s.match(/, true\) \+/g) || []).length >= 1, true); assert.match(s, /class="F_group' \+ \(tiles \? ' A_tiles' : ''\)/);
});
