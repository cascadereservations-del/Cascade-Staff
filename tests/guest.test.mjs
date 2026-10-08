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
  assert.deepEqual(b, { action: 'save', uid: 'u1', phone: '0917', email: null, guests: 2, nationality: null, companions: ['Carla'],
    ids: [{ name: 'Ana Reyes', id_type: 'passport', image: { base64: 'ID1', mime: 'image/jpeg', src: 'data:' } }] });
  assert.ok(!JSON.stringify(b).includes('SHOT'));
  assert.equal(G.hasAnything(b), true);
  assert.equal(G.hasAnything(G.saveBody('u1', { phone: '', email: '', guests: '', nationality: '', companions: [], ids: [] }, [])), false);
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
  for (const c of ['no_guest_record', 'read_failed', 'bad_field']) assert.doesNotMatch(G.errorText(400, c), /!/);
});
