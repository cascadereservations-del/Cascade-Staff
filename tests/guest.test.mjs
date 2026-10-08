import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const G = createRequire(import.meta.url)('../guest/guest-lib.js');

test('uid comes from the hash, decoded; junk is empty', () => {
  assert.equal(G.uidFromHash('#1418fb94e984-99c4%40airbnb.com'), '1418fb94e984-99c4@airbnb.com');
  assert.equal(G.uidFromHash('#cascade-direct-bd29'), 'cascade-direct-bd29');
  assert.equal(G.uidFromHash(''), '');
  assert.equal(G.uidFromHash('#%E0%A4%A'), '');
});

test('the sheet starts from the proposal with every ID photo kept', () => {
  const s = G.sheetFrom({ phone: '09171234567', email: null, guests: 3, nationality: 'Filipino', companions: ['Carla Dizon'], ids: [{ image: 1, name: 'Ana Reyes', id_type: 'passport', own: true }] });
  assert.deepEqual(s, { phone: '09171234567', email: '', guests: '3', nationality: 'Filipino', companions: [{ name: 'Carla Dizon', on: true }], ids: [{ image: 1, name: 'Ana Reyes', id_type: 'passport', own: true, on: true }] });
  assert.deepEqual(G.sheetFrom(null).ids, []);
});

test('save body sends only kept ID photos and ticked companions; screenshots never leave', () => {
  const images = [{ base64: 'SHOT', mime: 'image/jpeg', src: 'data:' }, { base64: 'ID1', mime: 'image/jpeg', src: 'data:' }, { base64: 'ID2', mime: 'image/jpeg', src: 'data:' }];
  const sheet = { phone: ' 0917 ', email: '', guests: '2', nationality: '', companions: [{ name: 'Carla', on: true }, { name: 'Dan', on: false }, { name: ' ', on: true }],
    ids: [{ image: 1, name: 'Ana Reyes', id_type: 'passport', on: true }, { image: 2, name: 'Eve Lim', id_type: 'other', on: false }] };
  const b = G.saveBody('u1', sheet, images);
  assert.deepEqual(b, { action: 'save', uid: 'u1', phone: '0917', email: null, companions: ['Carla'],
    ids: [{ name: 'Ana Reyes', id_type: 'passport', image: { base64: 'ID1', mime: 'image/jpeg', src: 'data:' } }] });
  assert.ok(!JSON.stringify(b).includes('SHOT'));
  assert.equal(G.hasAnything(b), true);
  assert.equal(G.hasAnything(G.saveBody('u1', { phone: '', email: '', guests: '3', nationality: 'Filipino', companions: [], ids: [] }, [])), false); // shown, never saved
});

test('result lines say what landed, then what did not and why', () => {
  assert.deepEqual(G.resultLines([{ what: 'companion', ok: true }, { what: 'companion', ok: true }, { what: 'id_photo', ok: true }, { what: 'email', ok: false, reason: 'email_kept' }]),
    ['Saved: 2 companions.', 'Saved: ID photo.', 'Not saved: email (an email is already on file, so it was kept).']);
  assert.deepEqual(G.resultLines([]), ['Nothing needed saving. The record already had these details.']);
});

test('error text: known codes, offline, and a fallback that names the code', () => {
  assert.match(G.errorText(403, 'staff_access_denied'), /owner and admins/);
  assert.match(G.errorText(0, undefined), /No connection/);
  assert.match(G.errorText(500, 'weird'), /weird/);
  assert.match(G.errorText(429, 'too_many_reads'), /paused/);
  for (const c of ['no_guest_record', 'read_failed', 'bad_field', 'too_many_reads']) assert.doesNotMatch(G.errorText(400, c), /!/);
});

// s78 (D-320.5): the empty ID box, IDs added by hand, companions with an optional ID photo.
test('mode comes from ?for=id or ?for=companion', () => {
  assert.equal(G.modeFromSearch('?for=id'), 'id');
  assert.equal(G.modeFromSearch('?x=1&for=companion'), 'companion');
  assert.equal(G.modeFromSearch('?for=idx'), '');
  assert.equal(G.modeFromSearch(''), '');
});

test('from the empty ID box: one ID read is the guest own; an unread photo is offered unticked; chat screenshots never', () => {
  const p = { ids: [{ image: 0, name: 'Angeleen Cruz', id_type: 'national_id', own: false }], images: ['id', 'other', 'chat'], companions: ['Angeleen Cruz', 'Carla'] };
  const s = G.sheetFrom(p, true);
  assert.deepEqual(s.ids.map((d) => [d.image, d.own, d.on, !!d.unread]), [[0, true, true, false], [1, true, false, true]]);
  assert.equal(G.sheetFrom(p).ids[0].own, false, 'the general page keeps the server answer');
  assert.deepEqual(s.companions.map((c) => c.on), [false, true], 'the own ID holder is not also added as a companion');
  assert.equal(G.sheetFrom(p).companions[0].on, true);
});

test('save body: own ID goes under the name on file, a companion photo under its row; an unticked companion takes its photo', () => {
  const images = [{ base64: 'A' }, { base64: 'B' }, { base64: 'C' }];
  const sheet = { phone: '', email: '', companions: [{ name: ' Carla Dizon ', on: true }, { name: 'Dan', on: false }],
    ids: [{ image: 0, name: 'ANGELEEN M CRUZ', id_type: 'passport', own: true, on: true },
      { image: 1, name: '', id_type: 'other', own: false, on: true, comp: 0 },
      { image: 2, name: '', id_type: 'other', own: false, on: true, comp: 1 }] };
  assert.equal(G.sheetProblem(sheet, 'Angel Cruz'), '');
  const b = G.saveBody('u1', sheet, images, 'Angel Cruz');
  assert.deepEqual(b.ids.map((d) => [d.name, d.image.base64]), [['Angel Cruz', 'A'], ['Carla Dizon', 'B']]);
  assert.deepEqual(b.companions, ['Carla Dizon']);
  const bad = { phone: '', email: '', companions: [], ids: [{ image: 0, name: ' ', id_type: 'other', own: false, on: true }] };
  assert.match(G.sheetProblem(bad, 'X'), /Type the name/);
  assert.equal(G.sheetProblem({ ...bad, ids: [{ ...bad.ids[0], on: false }] }, 'X'), '', 'an unticked photo needs no name');
});
