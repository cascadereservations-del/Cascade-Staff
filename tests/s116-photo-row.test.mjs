// s116 lane B: the item card shows Take a photo and Choose a photo directly under the main buttons, not under More.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item, NOW } from './I_harness.mjs';

const P1 = 'items/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp';
const NEWP = 'items/55555555-5555-4555-8555-555555555555/66666666-6666-4666-8666-666666666666.webp';
const URLN = 'https://stay.example/storage/v1/object/sign/inventory-photos/' + NEWP + '?token=bbb';
const raw = () => ({ items: [item('i1', 'Toilet paper', 4, 12, { photo: P1 }), item('i2', 'Hand soap', 0, 3, { category: 'Kitchen' })], sourceAsOf: NOW });
const upload = (b) => (b.action === 'sign' ? { data: { ok: true, urls: {} }, error: null } : { data: { ok: true, path: NEWP, signedUrl: URLN }, error: null });
const make = (role, o = {}) => setup({ role, doc: {}, client: mockClient({ catalogue: raw(), rpc: { inventory_item_photo_set_v1: () => ({ data: { ok: true, before: null }, error: null }), ...(o.rpc || {}) }, fn: { 'upload-photo': upload } }) });
const FILE = { name: 'IMG_1.jpg', size: 3200000 };
const more = (h) => (/I_moreb[\s\S]*$/.exec(h) || [''])[0];

for (const role of ['owner', 'cleaner', 'laundry', 'finance']) {
  test('s116 photo row: ' + role + ' sees both buttons under the main actions, one with capture, one without', async () => {
    const e = await make(role); await e.mount(''); await e.open('i2');
    const h = e.sheet();
    const cam = /<input[^>]*id="I_photo_in"[^>]*>/.exec(h), pick = /<input[^>]*id="I_photo_pick"[^>]*>/.exec(h);
    assert.ok(cam && pick, 'both inputs');
    assert.match(cam[0], /capture="environment"/); assert.doesNotMatch(pick[0], /capture/);
    assert.match(cam[0], /aria-label="[^"]+"/); assert.match(pick[0], /aria-label="[^"]+"/);
    assert.match(h, /Take a photo/); assert.match(h, /Choose a photo/); assert.match(h, /Add photo/);
    assert.ok(h.indexOf('I_actbar') < h.indexOf('I_photorow'));
    assert.doesNotMatch(more(h), /I_photo_in|I_photo_pick|Add photo/);
  });
}

test('s116 photo row: wording changes to Change photo / Retake / Choose another when the item has a photo; Remove photo stays under More', async () => {
  const e = await make('owner'); await e.mount(''); await e.open('i1');
  const h = e.sheet();
  assert.match(h, /Change photo/); assert.match(h, /Retake/); assert.match(h, /Choose another/);
  assert.match(more(h), /Remove photo/); assert.doesNotMatch(more(h), /I_photo_pick/);
});

test('s116 photo row: absent when the photo action is denied (R7 missing)', async () => {
  const e = await make('owner', { rpc: { inventory_item_photo_set_v1: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await e.mount(''); await e.open('i2'); await e.change('I_photo_in', [FILE]); await e.submit();
  await e.open('i2'); assert.doesNotMatch(e.sheet(), /I_photorow|I_photo_in|I_photo_pick/);
});

test('s116 photo row: both inputs start the same photo flow', async () => {
  for (const id of ['I_photo_in', 'I_photo_pick']) {
    const e = await make('owner'); await e.mount(''); await e.open('i2');
    await e.change(id, [FILE]); await e.submit();
    assert.equal(e.client.fnCalls('upload-photo').filter((c) => !c[2].action).length, 1, id);
    assert.equal(e.client.rpcCalls('inventory_item_photo_set_v1').length, 1, id);
  }
});
