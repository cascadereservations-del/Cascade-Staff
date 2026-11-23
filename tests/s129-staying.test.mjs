// s129 (Staff 3.4.47, D-390): "Who is staying" fills itself from the guest record: booker, typed names, record companions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, D, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const GUEST = (o) => Object.assign({ uid: 'stay-1', guest_name: 'Ana Reyes', checkin_date: TODAY, checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 2, repeat: true, stay_count: 2, tier: 'returning', tier_line: null, notes: null, id_photo_path: null }, o || {});
const ST = (names, v) => ({ names, source: 'staff', suggestion: null, version: v == null ? 1 : v });
const C = (...n) => n.map((x) => ({ name: x, has_photo: false }));
const view = (g) => CS.stayingView(GUEST(g), TODAY);
const home = async (cur, role = 'cleaner', nxt = null) => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: cur, next_guest: nxt }) }) })).els['v-home'].innerHTML;
const block = (h) => { const i = h.indexOf('<div class="S_who'); return i < 0 ? '' : h.slice(i, h.indexOf('</div>', i) + 6); };

test('A: nothing typed - the booker is highlighted, the record companions follow, no Add link', () => {
  const v = view({ staying: ST(''), companions: C('Bo Cruz', 'Cy Cruz') });
  assert.equal(v.main, 'Ana Reyes'); assert.deepEqual(v.others, ['Bo Cruz', 'Cy Cruz']); assert.equal(v.bookerLine, null); assert.equal(v.mode, 'booker');
  assert.deepEqual(view({ staying: ST('') }).others, [], 'no companions on record: nothing below');
});

test('B: typed names include the booker (case and spacing ignored) - booker highlighted, typed others then record companions, no repeats', () => {
  const v = view({ staying: ST('  ana   REYES , Bo Cruz'), companions: C('bo  cruz', 'Cy Cruz', 'ANA reyes') });
  assert.equal(v.main, 'Ana Reyes', 'the booker as on the record'); assert.deepEqual(v.others, ['Bo Cruz', 'Cy Cruz']); assert.equal(v.bookerLine, null);
});

test('C: typed names without the booker - first typed highlighted, the rest and the companions follow, the booker has its own line and is not repeated', () => {
  const v = view({ staying: ST('Bo Cruz, Cy Cruz'), companions: C('cy cruz', 'Di Cruz', 'ana reyes') });
  assert.equal(v.main, 'Bo Cruz'); assert.deepEqual(v.others, ['Cy Cruz', 'Di Cruz']); assert.equal(v.bookerLine, 'Ana Reyes'); assert.equal(v.mode, 'other');
  assert.equal(view({ staying: ST('Bo Cruz') }).bookerLine, 'Ana Reyes');
});

test('D: no booker name and nothing typed gives no main name; the link shows for editors only', async () => {
  assert.equal(view({ guest_name: '   ', staying: ST('') }).mode, 'empty');
  assert.equal(view({ guest_name: '', staying: ST(''), companions: [] }).mode, 'empty', 'empty = no booker, nothing typed and no companions');
  const nobody = { guest_name: '', staying: ST('') };
  assert.match(await home(GUEST(nobody), 'cleaner'), /data-act="stay-open"[^>]*>[\s\S]*?Add who is staying/);
  const ro = await home(GUEST(nobody), 'laundry'); assert.doesNotMatch(ro, /Add who is staying|S_who|stay-open/);
  const typedNoBooker = view({ guest_name: '', staying: ST('Bo Cruz, Cy Cruz') });
  assert.equal(typedNoBooker.main, 'Bo Cruz'); assert.deepEqual(typedNoBooker.others, ['Cy Cruz']); assert.equal(typedNoBooker.bookerLine, null, 'no booker, no Booker line');
});

test('companions absent (server not yet changed), null or malformed: the block shows the booker / typed names only, no error', async () => {
  for (const c of [undefined, null, 'x', {}, [null, {}, { name: '  ' }]]) assert.deepEqual(view({ staying: ST('Ana Reyes, Bo Cruz'), companions: c }).others, ['Bo Cruz'], String(JSON.stringify(c)));
  const h = await home(GUEST({ staying: ST('') }));
  assert.match(h, /<span class="S_main">Ana Reyes<\/span><button class="S_chg"/); assert.doesNotMatch(h, /S_sub/);
});

test('labels: Companion for one name, Companions for several; Staying tonight only on the arrival day; Booker line', async () => {
  const one = block(await home(GUEST({ staying: ST(''), companions: C('Bo Cruz') })));
  assert.match(one, /<span class="S_k">Staying tonight<\/span><span class="S_main">Ana Reyes<\/span><p class="S_sub"><b>Companion:<\/b> Bo Cruz<\/p><button class="S_chg" type="button" data-act="stay-open" data-uid="stay-1" aria-label="Change who is staying">Change<\/button>/);
  const many = block(await home(GUEST({ checkin_date: '2026-10-13', staying: ST(''), companions: C('Bo Cruz', 'Cy Cruz') })));
  assert.match(many, /<span class="S_k">Staying<\/span>/); assert.match(many, /<b>Companions:<\/b> Bo Cruz, Cy Cruz<\/p>/);
  const other = block(await home(GUEST({ staying: ST('Bo Cruz, Cy Cruz'), companions: C('Di Cruz') })));
  assert.match(other, /<span class="S_main">Bo Cruz<\/span><p class="S_sub"><b>Companions:<\/b> Cy Cruz, Di Cruz<\/p><p class="S_sub"><b>Booker:<\/b> Ana Reyes<\/p>/);
  assert.match(other, /^<div class="S_who" role="group" aria-label="Who is staying">/);
});

test('read-only roles see the block and the companions with no Change control; editors get it', async () => {
  const g = GUEST({ staying: ST(''), companions: C('Bo Cruz') });
  for (const r of ['laundry', 'finance']) { const b = block(await home(g, r)); assert.match(b, /Companion:<\/b> Bo Cruz/, r); assert.doesNotMatch(b, /S_chg|stay-open/, r); assert.match(b, /^<div class="S_who S_ro"/, r); }
  for (const r of ['owner', 'admin', 'inspector', 'cleaner']) assert.match(block(await home(g, r)), /<button class="S_chg" type="button" data-act="stay-open" data-uid="stay-1" aria-label="Change who is staying">Change<\/button>/, r);
});

test('every name is escaped, in the main line, the companions and the booker', async () => {
  const b = block(await home(GUEST({ guest_name: 'Ana <b>Reyes</b>', staying: ST('Bo <i>Cruz</i>'), companions: C('Cy <script>x</script>') })));
  assert.doesNotMatch(b, /<i>|<b>Reyes|<script/); assert.match(b, /Bo &lt;i&gt;Cruz&lt;\/i&gt;/); assert.match(b, /Cy &lt;script&gt;x&lt;\/script&gt;/); assert.match(b, /Ana &lt;b&gt;Reyes&lt;\/b&gt;/);
});

test('the Up next card draws the same block (case A with the demo companion)', async () => {
  const up = await home(GUEST({ checkin_date: '2026-10-10', staying: ST('') }), 'cleaner', GUEST({ uid: 'stay-2', guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', staying: ST('', 0), companions: C('Dee Cruz') }));
  assert.match(up.slice(up.indexOf('T_upnext')), /<span class="S_k">Staying<\/span><span class="S_main">Ben Cruz<\/span><p class="S_sub"><b>Companion:<\/b> Dee Cruz<\/p><button class="S_chg" type="button" data-act="stay-open" data-uid="stay-2"/);
});

test('the Change control still opens the sheet prefilled with the typed names only (not the record companions)', async () => {
  const app = await boot({ role: 'cleaner', hash: '#home', handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { current_guest: GUEST({ staying: ST('Bo Cruz', 3), companions: C('Cy Cruz') }) }) }) });
  await app.click({ 'data-act': 'stay-open', 'data-uid': 'stay-1' });
  assert.match(app.els['cs-body'].innerHTML, /<input id="stay-names"[^>]*value="Bo Cruz"/);
});

test('demo: every role keeps the companions; phone, e-mail and Messenger still go only to admin-side roles; case B now, case A next', async () => {
  const now = new Date('2026-10-15T04:30:00Z');
  for (const role of ['owner', 'admin', 'cleaner', 'laundry', 'finance']) {
    const d = (await D.client(role, now).rpc('staff_home_v1')).data, c = d.current_guest, n = d.next_guest;
    assert.deepEqual(c.companions.map((x) => x.name), ['Demo Companion One', 'Demo Companion Two'], role); assert.deepEqual(n.companions.map((x) => x.name), ['Demo Companion Three'], role);
    const vc = CS.stayingView(c, d.today), vn = CS.stayingView(n, d.today);
    assert.equal(vc.main, 'Demo Guest One'); assert.deepEqual(vc.others, ['Demo Companion One', 'Demo Companion Two'], 'case B'); assert.equal(vn.main, 'Demo Guest Two'); assert.deepEqual(vn.others, ['Demo Companion Three'], 'case A');
  }
  for (const role of ['cleaner', 'laundry']) { const c = (await D.client(role, now).rpc('staff_home_v1')).data.current_guest; assert.ok(!('phone' in c) && !('email' in c) && !('messenger' in c), role); }
});

test('CSS: the staying block wraps long names, the Change control has its own column and a 56 x 44 tap box, no nowrap, dead classes gone', () => {
  const css = read('styles.css'), rule = (sel) => new RegExp('(?:^|\\n)' + sel.replace(/[.>+ ]/g, (c) => '\\' + c) + ' \\{([^}]*)\\}').exec(css);
  const chg = rule('.S_chg')[1]; assert.match(chg, /min-width: 56px/); assert.match(chg, /min-height: var\(--touch, 44px\)/); assert.match(chg, /grid-column: 3/); assert.match(chg, /text-decoration: underline/); assert.doesNotMatch(chg, /position: absolute/);
  assert.match(rule('.S_main')[1], /overflow-wrap: anywhere/); assert.match(rule('.S_main')[1], /background: var\(--v5-fill/); assert.match(rule('.S_sub')[1], /overflow-wrap: anywhere/);
  assert.match(rule('.S_who')[1], /grid-template-columns: 36px minmax\(0, 1fr\) auto/); assert.match(rule('.S_who.S_ro')[1], /grid-template-columns: 36px minmax\(0, 1fr\)/);
  for (const c of ['S_who', 'S_k', 'S_main', 'S_sub', 'S_chg']) assert.doesNotMatch(rule('.' + c)[1], /nowrap/, c);
  for (const dead of ['S_line', 'S_person', 'S_mk', 'S_n']) assert.doesNotMatch(css, new RegExp('\\.' + dead + '[ ,.{]'), dead + ' has no user left');
  const app = read('app.js'); assert.doesNotMatch(app, /S_person|S_mk|class="S_line"/);
});

test('release pins: 3.4.52 and cs-shell-v77', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.52'); assert.match(read('app.js'), /version: '3.4.52'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v77'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v77';/);
});

test('F2: no booker name, nothing typed, companions on record - the first companion is highlighted, the rest follow, no Add link', async () => {
  const v = view({ guest_name: '', staying: ST(''), companions: C('Bo Cruz', 'Cy Cruz') });
  assert.equal(v.main, 'Bo Cruz'); assert.deepEqual(v.others, ['Cy Cruz']); assert.equal(v.bookerLine, null); assert.notEqual(v.mode, 'empty');
  const g = GUEST({ guest_name: '', staying: ST(''), companions: C('Bo Cruz', 'Cy Cruz') });
  const ed = block(await home(g, 'cleaner')); assert.match(ed, /<span class="S_main">Bo Cruz<\/span>/); assert.match(ed, /Companion:<\/b> Cy Cruz/); assert.match(ed, /S_chg/);
  assert.doesNotMatch(await home(g, 'cleaner'), /Add who is staying/);
  const ro = block(await home(g, 'laundry')); assert.match(ro, /^<div class="S_who S_ro"/); assert.match(ro, /<span class="S_main">Bo Cruz<\/span>/); assert.doesNotMatch(ro, /S_chg|stay-open/);
});

test('F1: the ID photo owner is a companion on record - no second "Staying:" line, the name appears once, the booker is the highlighted name (Today and Up next)', async () => {
  const mk = (o) => GUEST(Object.assign({ id_photo_name: 'Eliza Acaso', staying: ST(''), companions: C('Eliza Acaso') }, o || {}));
  for (const r of ['cleaner', 'owner']) {
    const t = await home(mk(), r);
    assert.doesNotMatch(t, /Staying: Eliza/, r); assert.equal(t.split('Eliza Acaso').length - 1, 1, r + ' today: name once'); assert.match(block(t), /<span class="S_main">Ana Reyes<\/span>/, r);
    const up = await home(GUEST({ checkin_date: '2026-10-10' }), r, mk({ uid: 'stay-2', guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19' }));
    const u = up.slice(up.indexOf('T_upnext')); assert.doesNotMatch(u, /Staying: Eliza/, r); assert.equal(u.split('Eliza Acaso').length - 1, 1, r + ' up next: name once'); assert.match(u, /<span class="S_main">Ben Cruz<\/span>/, r);
  }
});

test('F1: with g.staying absent (older SQL payload) the owner line still draws', async () => {
  const h = await home(GUEST({ id_photo_name: 'Eliza Acaso', staying: undefined }));
  assert.match(h, /Staying: Eliza Acaso/); assert.doesNotMatch(h, /S_who/);
});

test('F3: the Inventory supply receipt-line card keeps its own align-items (the global .S_line rule is gone)', () => {
  const k = read('kpi/K_kpi.css'); assert.match(k, /\.S_line \{[^}]*align-items: center;/);
  assert.match(k, /\.S_line \{[^}]*font: 400 var\(--v5-t-body\)\/1\.4 var\(--font-ui\);/); assert.match(k, /\.S_line \{[^}]*overflow-wrap: anywhere;/);
});

test('R1-1: the Calendar next-arrival card still says who is staying when the ID is a companion ID and nothing is typed; typed names hide it (old rule)', async () => {
  const cal = async (g, role) => (await boot({ role, hash: '#calendar', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', TODAY, '2026-10-17')], { next_guest: g }) }) })).els['v-calendar'].innerHTML;
  const n = (h) => (h.match(/Staying: Eliza Acaso/g) || []).length;
  for (const role of ['cleaner', 'owner']) {
    assert.equal(n(await cal(GUEST({ id_photo_name: 'Eliza Acaso', staying: ST(''), companions: C('Eliza Acaso') }), role)), 1, role);
    assert.equal(n(await cal(GUEST({ id_photo_name: 'Eliza Acaso', staying: ST('Bo Cruz'), companions: C('Eliza Acaso') }), role)), 0, role + ' typed names');
  }
});

// s129 round 3: the ID photo owner's name shows exactly once on a guest card (the Staying block or the owner line, never neither, never both)
const OWN = (o) => GUEST(Object.assign({ guest_name: 'Joseph Ewing', id_photo_name: 'Eliza Acaso', staying: ST('') }, o || {}));
const count = (h, s) => h.split(s).length - 1;
const upnext = async (g, role) => { const h = await home(GUEST({ checkin_date: '2026-10-10' }), role, Object.assign(g, { uid: 'stay-2', checkin_date: '2026-10-17', checkout_date: '2026-10-19' })); return h.slice(h.indexOf('T_upnext')); };

test('R3-1: Today, cleaner, companions key absent, photo owner not in the block - "Staying: Eliza Acaso" appears once and the block highlights the booker', async () => {
  const t = await home(OWN(), 'cleaner');
  assert.equal(count(t, 'Staying: Eliza Acaso'), 1); assert.equal(count(t, 'Eliza Acaso'), 1); assert.match(block(t), /<span class="S_main">Joseph Ewing<\/span>/);
});

test('R3-2: Up next card, same case - the owner line draws once', async () => {
  const u = await upnext(OWN({ guest_name: 'Joseph Ewing' }), 'cleaner');
  assert.equal(count(u, 'Staying: Eliza Acaso'), 1); assert.equal(count(u, 'Eliza Acaso'), 1); assert.match(u, /<span class="S_main">Joseph Ewing<\/span>/);
});

test('R3-3: owner role, photo owner is a companion on record - no owner line, the name appears once', async () => {
  const t = await home(OWN({ companions: C('Eliza Acaso') }), 'owner');
  assert.equal(count(t, 'Staying: Eliza Acaso'), 0); assert.equal(count(t, 'Eliza Acaso'), 1);
});

test('R3-4: photo owner differing only in case and spacing from a companion counts as shown - no owner line', async () => {
  const t = await home(OWN({ id_photo_name: 'eliza  acaso', companions: C('Eliza Acaso') }), 'cleaner');
  assert.doesNotMatch(t, /Staying: /i); assert.equal(count(t.toLowerCase().replace(/\s+/g, ' '), 'eliza acaso'), 1);
});

test('R3-5: typed names include the photo owner - no owner line, the name appears once', async () => {
  const t = await home(OWN({ staying: ST('Eliza Acaso') }), 'cleaner');
  assert.equal(count(t, 'Staying: Eliza Acaso'), 0); assert.equal(count(t, 'Eliza Acaso'), 1);
});
