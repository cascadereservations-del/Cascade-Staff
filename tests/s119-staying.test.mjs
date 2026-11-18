// s119 (Staff 3.4.27): one tier chip that cannot contradict itself, tier on the name, and the staying line with its sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, D, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const GUEST = (o) => Object.assign({ uid: 'stay-1', guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 2, repeat: true, stay_count: 2, tier: 'returning', tier_line: null, notes: null, id_photo_path: null }, o || {});
const home = async (cur, nxt, role = 'cleaner') => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: cur, next_guest: nxt || null }) }) })).els['v-home'].innerHTML;
const labels = (h) => (h.match(/First stay|Returning[^<]*|Regular[^<]*|VIP[^<]*/g) || []);

test('the contradiction: tier first / repeat false with 2 stays, and the inverse, gives exactly ONE label', async () => {
  for (const [g, want] of [[{ tier: 'first', repeat: false, stay_count: 2, tier_line: 'Returning from the 2nd stay' }, 'Returning · 2nd stay'], [{ tier: 'returning', repeat: true, stay_count: 1, tier_line: 'First stay' }, 'Returning · 1st stay'], [{ tier: null, repeat: false, stay_count: 5 }, 'Returning · 5th stay']]) {
    const h = await home(GUEST(g));
    assert.deepEqual(labels(h), [want], JSON.stringify(g));
    assert.doesNotMatch(h, /T_line|Returning from the|Returning guest/, 'the server benefits text is not drawn');
  }
  assert.equal(CS.tierBadge({ tier: 'first', repeat: false, stay_count: 2 }).tier, 'returning', 'the stay number wins over a stale first tier');
});

test('chip texts per tier and the name styling', async () => {
  for (const [g, text, cls, nm] of [[{ tier: 'first', repeat: false, stay_count: 1 }, 'First stay', 'T_c-first', ''], [{ stay_count: 2 }, 'Returning · 2nd stay', 'T_c-returning', ''], [{ tier: 'regular', stay_count: 5 }, 'Regular · 5 stays', 'T_c-regular', ' nm3'], [{ tier: 'vip', stay_count: 12 }, 'VIP · 12 stays', 'T_c-vip', ' nm4']]) {
    const h = await home(GUEST(g));
    assert.match(h, new RegExp('<h2 class="A_name' + nm + '">Ana Reyes</h2></div><span class="T_chip ' + cls + '" role="note"><svg[^>]*></svg><span>' + text + '</span></span>'));
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
  assert.match(app, /sb\.rpc\('set_stay_staying_v1', \{ p_property: pid\(\), p_uid: a\.uid, p_names: names\.join\(', '\), p_source: 'staff', p_expected_version: a\.version, p_reason: [^,]+, p_idempotency_key: a\.key \}\)/);
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
  assert.equal(JSON.parse(read('package.json')).version, '3.4.27'); assert.match(read('app.js'), /version: '3\.4\.27'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v52'/);
});
