// s129 (Staff 3.4.46, D-390): "Who is staying" fills itself from the guest record: booker, typed names, record companions.
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
  assert.equal(view({ guest_name: '', staying: ST(''), companions: C('Bo Cruz') }).main, null);
  assert.equal(view({ guest_name: '   ', staying: ST('') }).mode, 'empty');
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

test('release pins: 3.4.46 and cs-shell-v71', () => {
  assert.equal(JSON.parse(read('package.json')).version, '3.4.46'); assert.match(read('app.js'), /version: '3\.4\.46'/); assert.match(read('sw.js'), /CACHE_NAME = 'cs-shell-v71'/); assert.match(read('app.js'), /var PC_SHELL = 'cs-shell-v71';/);
});
