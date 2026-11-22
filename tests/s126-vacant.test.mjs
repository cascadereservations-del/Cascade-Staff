// s126 (Staff 3.4.41, D-388): an empty night gets its own "No guest tonight" card; the next guest sits below it, labelled as next, never under that label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: '2026-10-13', checkout_date: '2026-10-17', checkin_time: '14:00', checkout_time: '12:00', nights: 4, repeat: false, stay_count: 1, tier: 'first', notes: null, id_photo_path: null }, o || {});
const NXT = GUEST({ guest_name: 'Ben Cruz', checkin_date: '2026-10-17', checkout_date: '2026-10-19', nights: 2 });
const today = async (role, extra) => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ben Cruz', '2026-10-17', '2026-10-19')], extra) }) })).els['v-home'].innerHTML;
const VACANT = /<section class="card A_card F_span V_free"[\s\S]*?<\/section>/;
const ROLES = ['owner', 'admin', 'finance', 'inspector', 'cleaner', 'maintenance', 'laundry'];

test('s126 vacant: the state helper keeps house and arriving as they were; next and none no longer label a guest card "No guest tonight"', () => {
  const cur = GUEST(), arr = GUEST({ guest_name: 'Ben Cruz', checkin_date: TODAY });
  const h = CS.todayCardState({ current_guest: cur, next_guest: NXT }, TODAY), a = CS.todayCardState({ current_guest: null, next_guest: arr }, TODAY);
  assert.deepEqual([h.kind, h.label, h.pill.text], ['house', 'Today · in the house', 'Checked in']);
  assert.deepEqual([a.kind, a.label, a.pill.text], ['arriving', 'Today · arriving', 'Arrives today']);
  const n = CS.todayCardState({ current_guest: null, next_guest: NXT }, TODAY);
  assert.equal(n.kind, 'next'); assert.equal(n.label, 'Next guest · arrives Sat 17 Oct'); assert.equal(n.pill.text, 'In 2 days');
  assert.doesNotMatch(n.label, /No guest tonight/);
  const z = CS.todayCardState({ current_guest: null, next_guest: null }, TODAY); assert.equal(z.kind, 'none'); assert.equal(z.guest, null);
});

test('s126 vacant: kind next draws the vacant card, then the next guest in a separate card labelled with the date (every role)', async () => {
  for (const role of ROLES) {
    const h = await today(role, { current_guest: null, next_guest: NXT });
    const v = h.match(VACANT); assert.ok(v, role + ': vacant card drawn');
    assert.match(v[0], /<h2 class="V_title">No guest tonight<\/h2>/, role); assert.match(v[0], /aria-hidden="true"/, role + ': the moon is decoration');
    assert.doesNotMatch(v[0], /Ben Cruz/, role + ': no guest name inside the vacant card');
    const rest = h.replace(VACANT, ''); assert.match(rest, /Ben Cruz/, role + ': the next guest is drawn outside it');
    const card = rest.match(/<section class="card glass A_card F_span T_card[^"]*"[^>]*>[\s\S]*?<\/section>/)[0];
    assert.match(card, /Ben Cruz/, role); assert.match(card, /T_lbl">Next guest · arrives Sat 17 Oct</, role + ': labelled next, with the date');
    assert.doesNotMatch(card, /No guest tonight/, role + ': the old label is gone'); assert.ok(h.indexOf('V_free') < h.indexOf('Next guest · arrives'), role + ': vacant card first');
  }
});

test('s126 vacant: kind none draws the vacant card and no guest card', async () => {
  for (const role of ['owner', 'cleaner', 'laundry']) {
    const h = await today(role, { current_guest: null, next_guest: null });
    assert.match(h, VACANT, role); assert.match(h, /<h2 class="V_title">No guest tonight<\/h2>/, role); assert.match(h.match(VACANT)[0], /no next stay is booked yet/, role);
    assert.doesNotMatch(h, /T_card|Next guest · arrives|Open guest card/, role + ': no guest card');
  }
});

test('s126 vacant: kinds house and arriving draw no vacant card', async () => {
  for (const role of ['owner', 'cleaner', 'laundry']) {
    assert.doesNotMatch(await today(role, { current_guest: GUEST(), next_guest: NXT }), /V_free|No guest tonight/, role + ' house');
    assert.doesNotMatch(await today(role, { current_guest: null, next_guest: GUEST({ guest_name: 'Ben Cruz', checkin_date: TODAY }) }), /V_free|No guest tonight/, role + ' arriving');
  }
});

test('s126 vacant: laundry gets the vacant card; its next-guest card has no phone, e-mail, ID photo or money, and a payload that carries them is still blocked', async () => {
  const h = await today('laundry', { current_guest: null, next_guest: NXT });
  assert.match(h, VACANT); assert.match(h, /Ben Cruz/); assert.match(h, /T_lbl">Next guest · arrives Sat 17 Oct</);
  assert.doesNotMatch(h, /tel:|mailto:|data-facepath|data-idpath|ID photo|₱|PHP/i);
  const rich = GUEST({ guest_name: 'Ben Cruz', checkin_date: '2026-10-17', phone: '+639171234567', email: 'ben@guest.example', id_photo_path: 'ids/ben.jpg', total_payout: 5000, amount: 5000 });
  const g = await today('laundry', { current_guest: null, next_guest: rich });
  assert.doesNotMatch(g, /tel:|mailto:|ids\/ben|₱|PHP|\+639|ben@guest|Ben Cruz/i, 'the existing money and contact guard still stops the whole page');
});

test('s126 vacant: the style is calm, in tokens, and the card is not drawn from a hand-written heading in the old place', () => {
  const css = read('styles.css'), app = read('app.js');
  assert.match(css, /\.card\.V_free \{[^}]*border: 1px dashed var\(--v5-line-2\)/); assert.doesNotMatch(css.slice(css.indexOf('.card.V_free')), /animation|transition|--v5-bad|--v5-warn/);
  assert.doesNotMatch(app, /The house is free tonight/); assert.doesNotMatch(read('lib.js'), /kind: 'next'[^\n]*No guest tonight/);
});
