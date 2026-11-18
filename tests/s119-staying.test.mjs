// s119 (Staff 3.4.34): one tier chip that cannot contradict itself, tier on the name, and the staying line with its sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, D, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const GUEST = (o) => Object.assign({ uid: 'stay-1', guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 2, repeat: true, stay_count: 2, tier: 'returning', tier_line: null, notes: null, id_photo_path: null }, o || {});
const home = async (cur, nxt, role = 'cleaner') => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: cur, next_guest: nxt || null }) }) })).els['v-home'].innerHTML;
const labels = (h) => (h.slice(0, h.indexOf('T_tiers') < 0 ? h.length : h.indexOf('T_tiers')).replace(/<p class="sub T_prog">[^<]*<\/p>/g, '').match(/First stay|Returning[^<]*|Regular[^<]*|VIP[^<]*/g) || []); // the Guest tiers card below lists every tier

test('the contradiction: tier first / repeat false with 2 stays, and the inverse, gives exactly ONE label', async () => {
  for (const [g, want] of [[{ tier: 'first', repeat: false, stay_count: 2, tier_line: 'Returning from the 2nd stay' }, 'Returning · 2nd stay'], [{ tier: 'returning', repeat: true, stay_count: 1, tier_line: 'First stay' }, 'Returning'], [{ tier: null, repeat: false, stay_count: 5 }, 'Returning · 5th stay']]) {
    const h = await home(GUEST(g));
    assert.deepEqual(labels(h), [want], JSON.stringify(g));
    assert.doesNotMatch(h, /T_line|Returning from the|Returning guest/, 'the server benefits text is not drawn');
  }
  assert.equal(CS.tierBadge({ tier: 'first', repeat: false, stay_count: 2 }).tier, 'returning', 'the stay number wins over a stale first tier');
});

test('chip texts per tier and the name styling', async () => {
  for (const [g, text, cls, nm] of [[{ tier: 'first', repeat: false, stay_count: 1 }, 'First stay', 'T_c-first', ''], [{ stay_count: 2 }, 'Returning · 2nd stay', 'T_c-returning', ''], [{ tier: 'regular', stay_count: 5 }, 'Regular · 5th stay', 'T_c-regular', ' nm3'], [{ tier: 'vip', stay_count: 12 }, 'VIP · 12th stay', 'T_c-vip', ' nm4']]) {
    const h = await home(GUEST(g));
    assert.match(h, new RegExp('<h2 class="A_name' + nm + '">Ana Reyes</h2></div><button class="T_chip ' + cls + '" type="button" data-act="tiers-open" data-tier="' + cls.slice(4) + '"><svg[^>]*></svg><span>' + text + '</span><span class="sr">, open the guest tiers guide</span></button>'));
    assert.doesNotMatch(h, /T_ribbon/);
  }
  const css = read('styles.css');
  assert.match(css, /\.nm4 \{[^}]*\}/); assert.match(css, /@supports \(background-clip: text\)[^\n]*\.nm4/); assert.match(css, /prefers-contrast: more[\s\S]*?\.nm3, \.nm4/); assert.match(css, /forced-colors: active[\s\S]*?CanvasText/);
  assert.doesNotMatch(/\.T_chip \{[^}]*\}/.exec(css)[0], /gradient|animation/);
});

test('stayingView: states from the payload; absent staying draws nothing', async () => {
  const v = (g) => CS.stayingView(GUEST(g), TODAY);
  assert.equal(v({}), null, 'key absent'); assert.equal(v({ staying: null }), null); assert.equal(CS.stayingView(GUEST({ uid: null, staying: { names: 'A' } }), TODAY), null, 'no uid, nothing to send');
  assert.equal(v({ staying: { names: '', suggestion: 'Bo Cruz, Cy Cruz', version: 0 } }).mode, 'empty');
  assert.deepEqual(v({ staying: { names: ' Ana Reyes ', version: 3 } }), { mode: 'booker', names: ['Ana Reyes'], suggestion: [], version: 3, tonight: true, uid: 'stay-1', booker: 'Ana Reyes' });
  assert.equal(v({ staying: { names: 'Ana Reyes, Bo Cruz' } }).mode, 'with'); assert.equal(v({ staying: { names: 'Bo Cruz; Cy Cruz, bo cruz' } }).names.length, 2);
  assert.equal(v({ staying: { names: ['Bo Cruz'] } }).mode, 'other');
  assert.equal(CS.stayingView(GUEST({ checkin_date: '2026-10-10', staying: { names: 'A' } }), TODAY).tonight, false);
  const none = await home(GUEST({}));
  assert.doesNotMatch(none, /Add who is staying|S_who|stay-open/, 'older server: no link, no block');
});

test('Today card staying line: empty link, booker only, with others, booked for someone else', async () => {
  const empty = await home(GUEST({ staying: { names: '', source: null, suggestion: null, version: 0 } }));
  assert.match(empty, /<button class="S_lnk" type="button" data-act="stay-open" data-uid="stay-1">[\s\S]*?Add who is staying<\/button>/); assert.doesNotMatch(empty, /S_who/);
  const only = await home(GUEST({ staying: { names: 'Ana Reyes', version: 1 } }));
  assert.match(only, /<b>Staying:<\/b> Ana Reyes/); assert.match(only, /Change who is staying/);
  const withO = await home(GUEST({ staying: { names: 'Ana Reyes, Bo Cruz', version: 1 } }));
  assert.match(withO, /<b>Staying tonight:<\/b> Ana Reyes, Bo Cruz/);
  const later = await home(GUEST({ checkin_date: '2026-10-13', staying: { names: 'Ana Reyes, Bo Cruz', version: 1 } }));
  assert.match(later, /<b>Staying:<\/b> Ana Reyes, Bo Cruz/, 'not the first night: Staying');
  const other = await home(GUEST({ staying: { names: 'Bo Cruz, Cy Cruz', version: 1 } }));
  assert.match(other, /Booked by Ana Reyes[\s\S]*?Not staying[\s\S]*?Staying tonight[\s\S]*?S_av on[\s\S]*?Bo Cruz[\s\S]*?Staying<\/span>[\s\S]*?Cy Cruz/);
  const up = await home(GUEST({ checkin_date: '2026-10-10' }), GUEST({ uid: 'stay-2', guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', staying: { names: '', version: 0 } }));
  assert.match(up.slice(up.indexOf('T_upnext')), /data-uid="stay-2"[\s\S]*?Add who is staying/, 'the Up next card has its own link');
});

test('the sheet calls the two RPCs with the agreed arguments; the demo sends nothing; offline keeps what was typed', () => {
  const app = read('app.js');
  assert.match(app, /sb\.rpc\('set_stay_staying_v1', \{ p_property: pid\(\), p_uid: a\.uid, p_names: names\.join\(', '\), p_source: CS\.canSeeGuestContact\(role\(\)\) \? 'admin' : 'staff', p_expected_version: a\.version, p_reason: [^,]+, p_idempotency_key: a\.key \}\)/);
  assert.match(app, /sb\.rpc\('confirm_stay_staying_suggestion_v1', \{ p_property: pid\(\), p_uid: a\.uid, p_accept: !!accept, p_expected_version: a\.version, p_reason:/);
  assert.match(app, /if \(DEMO\) \{[\s\S]{0,500}?done\('Demo only\. Nothing is saved\.'\)[\s\S]{0,80}?return;\s*\}\s*a\.busy = true/, 'the demo returns before any rpc');
  assert.match(app, /navigator\.onLine === false\) \{ a\.err = offline/);
  assert.match(app, /Cassy read this in the guest message[\s\S]*?Use these[\s\S]*?Not right[\s\S]*?Nothing is saved until you choose/);
  const css = read('styles.css').slice(read('styles.css').indexOf('s119 v4'));
  for (const c of ['S_lnk', 'S_line', 'S_person']) assert.match(new RegExp('\\.' + c + ' \\{[^}]*\\}').exec(css)[0], /min-height: var\(--touch, 44px\)/, c);
});

test('demo: sample staying data on both stays; release pins', async () => {
  const r = await D.client('owner', new Date('2026-10-15T04:30:00Z')).rpc('staff_home_v1');
  assert.match(r.data.current_guest.staying.names, /Demo Guest One/); assert.equal(r.data.next_guest.staying.names, ''); assert.match(r.data.next_guest.staying.suggestion, /Demo Guest Two/);
  assert.equal(JSON.parse(read('package.json')).version, '3.4.34'); assert.match(read('app.js'), /version: '3.4.34'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v59'/);
});

// ---- fix round: roles, error mapping, length, hostile text
const STAYING = (names, sug, v) => ({ names, source: 'staff', suggestion: sug || null, version: v == null ? 1 : v });
let UU = 0; const open = async (role, g, handlers) => boot({ ctxExtra: { crypto: { randomUUID: () => 'uuid' + (++UU) } }, role, hash: '#home', handlers: baseHandlers(role, Object.assign({ staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: g }) }, handlers || {})) });

test('only owner, admin, inspector and cleaner get the link and the sheet; other roles read the names', async () => {
  for (const r of ['owner', 'admin', 'inspector', 'cleaner']) assert.equal(CS.canEditStaying(r), true, r);
  for (const r of ['laundry', 'finance', 'guest', null, undefined, '']) assert.equal(CS.canEditStaying(r), false, String(r));
  const h = (await open('laundry', GUEST({ staying: STAYING('Ana Reyes, Bo Cruz') }))).els['v-home'].innerHTML;
  assert.match(h, /<b>Staying tonight:<\/b> Ana Reyes, Bo Cruz/); assert.doesNotMatch(h, /stay-open|S_lnk/);
  assert.doesNotMatch((await open('laundry', GUEST({ staying: STAYING('') }))).els['v-home'].innerHTML, /Add who is staying|stay-open/);
});

test('p_source is admin for owner and admin, staff for the rest', async () => {
  for (const [role, want] of [['owner', 'admin'], ['admin', 'admin'], ['inspector', 'staff'], ['cleaner', 'staff']]) {
    const app = await open(role, GUEST({ staying: STAYING('Ana Reyes') }), { set_stay_staying_v1: () => ({ error: null, data: { ok: true } }) });
    await app.click({ 'data-act': 'stay-open', 'data-uid': 'stay-1' }); app.input('stay-names', 'Ana Reyes, Bo Cruz'); await app.click({ 'data-act': 'stay-save' });
    assert.equal(app.calls.filter((c) => c[0] === 'set_stay_staying_v1')[0][1].p_source, want, role);
  }
});

test('hostile name and suggestion are escaped in the card, the sheet input and the suggestion', async () => {
  const evil = '<img src=x onerror=alert(1)>', quo = 'O"Neil & "Sons"';
  const app = await open('cleaner', GUEST({ staying: STAYING(evil + ', ' + quo, evil + ', ' + quo, 2) }));
  const card = app.els['v-home'].innerHTML; assert.doesNotMatch(card, /<img src=x/); assert.match(card, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(card, /O&quot;Neil &amp; &quot;Sons&quot;/);
  await app.click({ 'data-act': 'stay-open', 'data-uid': 'stay-1' });
  const sheet = app.els['cs-body'].innerHTML; assert.doesNotMatch(sheet, /<img src=x/);
  assert.match(sheet, /<input id="stay-names"[^>]*value="&lt;img src=x onerror=alert\(1\)&gt;, O&quot;Neil &amp; &quot;Sons&quot;"/);
  assert.match(sheet, /S_sgv">&lt;img src=x onerror=alert\(1\)&gt;, O&quot;Neil &amp; &quot;Sons&quot;<\/div>/);
});

test('error mapping: each server answer gets its calm sentence', () => {
  const t = (e) => CS.stayErrorText(e);
  assert.equal(t({ message: 'no_pending_suggestion' }), 'That suggestion is no longer there.');
  assert.equal(t({ message: 'names_too_long' }), 'Names can be up to 300 characters.');
  assert.equal(t({ message: 'x', code: 'P0002' }), 'This stay is no longer on the calendar.'); assert.equal(t({ message: 'stay_not_found' }), 'This stay is no longer on the calendar.');
  assert.equal(t({ message: 'names_contact', code: '22023' }), 'Please leave phone numbers and e-mail addresses out. Type names only.');
  assert.match(t({ message: 'idempotency_key_reused', code: '22023' }), /try saving again/); assert.equal(t({ message: 'boom' }), null); assert.equal(t(null), null);
  for (const s of ['no_pending_suggestion', 'names_contact', 'stay_not_found']) assert.doesNotMatch(t({ message: s }), /!/);
});

test('driving the sheet: no pending suggestion reloads home; contact refused; unknown error is not a signal problem; key renews with new names; length is checked', async () => {
  let homeCalls = 0, mode = 'ok';
  const app = await open('cleaner', GUEST({ staying: STAYING('Ana Reyes', 'Bo Cruz', 1) }), {
    staff_home_v1: () => { homeCalls++; return HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: GUEST({ staying: STAYING('Ana Reyes, Server Name', null, 5) }) }); },
    confirm_stay_staying_suggestion_v1: () => ({ error: null, data: { ok: false, error: 'no_pending_suggestion', names: 'Ana Reyes', version: 5 } }),
    set_stay_staying_v1: () => (mode === 'contact' ? { error: { message: 'names_contact', code: '22023' }, data: null } : mode === 'boom' ? { error: { message: 'internal', code: 'XX000' }, data: null } : { error: { message: 'version mismatch', code: '40001' }, data: null }) });
  await app.click({ 'data-act': 'stay-open', 'data-uid': 'stay-1' }); const before = homeCalls;
  await app.click({ 'data-act': 'stay-use' });
  assert.match(app.els['cs-body'].innerHTML, /That suggestion is no longer there\./); assert.ok(homeCalls > before, 'home reloaded'); assert.doesNotMatch(app.els['cs-body'].innerHTML, /S_sg"/, 'the sheet refreshed without the suggestion');
  mode = 'contact'; app.input('stay-names', 'Ana Reyes, 0917 555 1234'); await app.click({ 'data-act': 'stay-save' });
  assert.match(app.els['cs-body'].innerHTML, /leave phone numbers and e-mail addresses out/);
  mode = 'boom'; await app.click({ 'data-act': 'stay-save' }); assert.match(app.els['cs-body'].innerHTML, /Please try again in a moment/); assert.doesNotMatch(app.els['cs-body'].innerHTML, /Check your signal/);
  mode = 'stale'; app.input('stay-names', 'Typed Name'); await app.click({ 'data-act': 'stay-save' });
  assert.match(app.els['cs-body'].innerHTML, /Someone changed this just now/); assert.match(app.els['cs-body'].innerHTML, /value="Ana Reyes, Server Name"/, 'the input shows the server names after a stale reload');
  const sets = app.calls.filter((c) => c[0] === 'set_stay_staying_v1').map((c) => c[1]);
  assert.equal(sets[0].p_idempotency_key, sets[1].p_idempotency_key, 'same names retried keep the key'); assert.notEqual(sets[1].p_idempotency_key, sets[2].p_idempotency_key, 'different names get a new key');
  const n = app.calls.length; app.input('stay-names', Array.from({ length: 9 }, (_, i) => 'Name' + i).join(', ')); await app.click({ 'data-act': 'stay-save' });
  assert.match(app.els['cs-body'].innerHTML, /Up to 8 names/); assert.equal(app.calls.slice(n).filter((c) => c[0] === 'set_stay_staying_v1').length, 0, 'too many names never reach the server');
  assert.equal(CS.stayNamesProblem(['a'.repeat(61)]), 'Each name can be up to 60 characters.'); assert.match(CS.stayNamesProblem(Array.from({ length: 8 }, () => 'x'.repeat(50))), /up to 300 characters/); assert.equal(CS.stayNamesProblem(['Ana', 'Bo']), null);
});
