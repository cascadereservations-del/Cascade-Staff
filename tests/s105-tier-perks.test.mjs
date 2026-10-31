// s105 SPEC-46 section 1: tier ribbon and perks checklist on the Today card, plus the weather head fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const GUEST = (o) => Object.assign({ guest_name: 'Ana Reyes', checkin_date: '2026-10-13', checkout_date: '2026-10-17', checkout_time: '12:00', checkin_time: '14:00', nights: 4, repeat: true, stay_count: 3,
  tier: 'returning', tier_line: 'Server line', notes: null, id_photo_path: null }, o || {});
const home = async (role, extra) => (await boot({ role, hash: '#home', handlers: baseHandlers(role, { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-13', '2026-10-17')], extra) }) })).els['v-home'].innerHTML;

test('CS.tierPerks: null and unknown tiers give none; each tier is cumulative, capped at 4, ID line only with an ID', () => {
  const T = 'Welcome treat: local coffee sachets and a snack', E1 = 'First hour of early check-in or late check-out free, if the calendar allows', E2 = 'Up to 2 hours early or late free, if the calendar allows', P = 'Set saved preferences before arrival (pillows, AC temperature)', ID = 'No need to ask for ID again, one is on file';
  assert.deepEqual(CS.tierPerks(null), []); assert.deepEqual(CS.tierPerks('gold', { id: true }), []);
  assert.deepEqual(CS.tierPerks('returning', { id: false }), [T, E1], 'no ID on file: the ID line is skipped');
  assert.deepEqual(CS.tierPerks('returning', { id: true }), [ID, T, E1]);
  assert.deepEqual(CS.tierPerks('regular', { id: true }), [ID, T, E2, P], 'the 2 hour line replaces the 1 hour line');
  assert.deepEqual(CS.tierPerks('regular', { id: false }), [T, E2, P]);
  assert.deepEqual(CS.tierPerks('vip', { id: true }), [T, E2, P, 'Handwritten welcome note'], 'over 4 lines: the ID line goes first');
  assert.deepEqual(CS.tierPerks('vip', { phase: 'house' }), [E2, 'Mid-stay refresh, any stay length', 'First call on the dates they ask about']);
  assert.deepEqual(CS.tierPerks('returning', { phase: 'house', id: true }), [E1]);
  for (const t of ['returning', 'regular', 'vip']) for (const ph of ['arrival', 'house']) for (const l of CS.tierPerks(t, { phase: ph, id: true })) assert.doesNotMatch(l, /!|\d+%|PHP|discount|\$/i, 'no exclamation, price or discount');
});

test('CS.tierRibbon: words and ordinal per tier, none for a first stay or an unknown tier', () => {
  assert.deepEqual(CS.tierRibbon({ tier: 'returning', stay_count: 3 }), { tier: 'returning', icon: 'repeat', text: 'Welcome back · 3rd stay' });
  assert.equal(CS.tierRibbon({ tier: 'regular', stay_count: 5 }).text, 'Regular guest · 5th stay'); assert.equal(CS.tierRibbon({ tier: 'vip', stay_count: 8 }).text, 'VIP guest · 8th stay');
  assert.equal(CS.tierRibbon({ tier: 'vip' }).text, 'VIP guest', 'no count: no ordinal');
  assert.equal(CS.tierRibbon({ tier: null, repeat: false, stay_count: 1 }), null); assert.equal(CS.tierRibbon({ tier: 'gold' }), null); assert.equal(CS.tierRibbon(null), null);
});

test('Today card: ribbon per tier at the top, said once, perks for every role; none for a first stay; arriving says Prepare before arrival', async () => {
  for (const [tier, n, word] of [['returning', 3, 'Welcome back'], ['regular', 5, 'Regular guest'], ['vip', 8, 'VIP guest']]) {
    const h = await home('cleaner', { current_guest: GUEST({ tier, stay_count: n }) });
    assert.match(h, new RegExp('aria-label="Today in the house"><div class="T_ribbon p-tier-' + tier + '" role="note">'), tier + ': the ribbon opens the card');
    assert.equal((h.split(word).length - 1), 1, tier + ': tier wording once'); assert.doesNotMatch(h, /pill p-tier-|T_line/);
    assert.match(h, /aria-label="Perks to give"/); assert.doesNotMatch(h, /Server line/, 'the server line is only a fallback');
  }
  const first = await home('cleaner', { current_guest: GUEST({ tier: null, repeat: false, stay_count: 1 }) });
  assert.doesNotMatch(first, /T_ribbon|T_perks/);
  const arr = await home('cleaner', { current_guest: null, next_guest: GUEST({ checkin_date: TODAY, tier: 'regular', stay_count: 4, id_photo_path: 'g/1.jpg' }) });
  assert.match(arr, /T_ribbon p-tier-regular/); assert.match(arr, /aria-label="Prepare before arrival"/); assert.match(arr, /No need to ask for ID again, one is on file/); assert.match(arr, /Set saved preferences before arrival/);
  assert.doesNotMatch(arr, /tel:/, 'a cleaner sees perks but no phone');
});

test('weather: a watch or hourly peak replaces the daily rain percentage (no 40% beside 80%)', () => {
  const p = { weather: { fetched_at: new Date().toISOString(), current: { temp: 29, description: 'Rain', rain_prob: 40, today_high: 32, today_low: 26 } } };
  const v = { weather: { watch: { text: 'Rain watch, 2 to 5 pm', peak: 80 }, hours: [{ label: '3 pm', pct: 80 }] } };
  assert.equal(CS.wxCard(p, v).head, ''); assert.equal(CS.wxCard(p, null).head, 'Rain 40% today', 'no rain warning: the daily chance stays');
});
