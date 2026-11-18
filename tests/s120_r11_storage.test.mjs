// Session 120, lane R11: phone storage that hangs or is full. No photo storage call waits forever or loses a photo silently.
// Real Chromium against the real checklist page (see s120_browser.mjs). The draft, the session and the server are made up; nothing leaves the machine.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { browserSuite, closeBrowser, openPage, draftOf } from './s120_browser.mjs';

const t0 = await browserSuite(test, assert);
after(async () => { await closeBrowser(); });

const ITEMS = [['Bottled Water'], ['Coffee (3-in-1)'], ['Tea'], ['Sugar & Creamer Sticks'], ['Bathroom tissue'], ['Laundry Detergent'], ['Toiletries (toothbrush, toothpaste, soap)'], ['Kitchen towel'], ['Demo Soap']]
  .map(([name], n) => ({ id: 'id' + n, name, category: 'x', unit: 'bottle' }));
const LINEN = [{ id: 'lin1', name: 'Bath Towel', category: 'linen', unit: 'pc' }];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const BLOBS = ['idb-m0', 'idb-p1', 'idb-p2'];
const parse = s => JSON.parse(s);
const posts = (t, name) => t.calls.filter(c => c.method === 'POST' && c.url.includes(name));
const uploads = t => posts(t, '/upload-photo');
function server(o = {}) {
  return { handler: rec => {
    if (rec.url.includes('/rest/v1/inventory_items')) return json(rec.url.includes('is_consumable=eq.true') ? ITEMS : LINEN);
    if (rec.url.includes('/functions/v1/upload-photo')) return o.upload === 'ok' ? json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() }) : json({ ok: false }, 500);
    if (rec.url.includes('/rpc/record_inventory_usage') || rec.url.includes('/rpc/record_linen_stains_v1')) return json({ ok: true });
    return null;
  } };
}
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: false, tried: true, key: 'rk-test', failed: '', unavailable: false, legacy: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const linenOf = (over = {}) => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: false, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const withSends = (over = {}) => draftOf({ supplyLogSaved: true, restock: restockOf(over.restock), linen: linenOf(over.linen), confirmItems: { check_2_4: 'confirmed' }, confirmNotes: { check_2_4: 'Bath Towel: stain came out' }, ...(over.draft || {}) });
const quiet = () => withSends({ restock: { sent: true, waiting: false }, linen: { sent: true, waiting: false } });
const freshDraft = () => withSends({ restock: { sendStartedAt: Date.now() - 5 * 60000 }, linen: { sendStartedAt: Date.now() - 5 * 60000 }, draft: { _saved: Date.now() } });

async function open(opts = {}) {
  const t = await openPage({ ...opts, answers: server(opts.server) });
  await t.boot();
  await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
  return t;
}
/* a page with no saved draft */
async function openBare(opts = {}) {
  const t = await openPage({ ...opts, answers: server(opts.server) });
  await t.boot();
  await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
  return t;
}
const stored = t => t.stored();
const closed = t => t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
const flag = (t, k, v) => t.page.evaluate(([k, v]) => { window[k] = v; }, [k, v]);
const until = (t, fn, arg, ms = 20000) => t.page.waitForFunction(fn, arg, { timeout: ms });
async function jpeg(t) {
  const b64 = await t.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); for (let i = 0; i < 700; i++) { x.fillStyle = `hsl(${(i * 47) % 360},70%,${25 + (i * 13) % 50}%)`; x.fillRect((i * 37) % 900, (i * 91) % 700, 70, 50); } return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  return { name: 'cap.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
/* a real quota limit on the page origin: a blob write now aborts with QuotaExceededError */
async function limitQuota(t, bytes) {
  const cdp = await t.ctx.newCDPSession(t.page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(t.url).origin, quotaSize: bytes });
}
const resumedAndFailed = async t => { await t.page.click('#btn-draft-resume'); await closed(t); await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].status === 'failed'); };

/* ---- item 1: a delete that never settles does not block the report ---- */
t0('R11 item 1: when a blob delete never settles, every photo uploads, one report goes and the success screen shows', async () => {
  const srv = { upload: 'fail' };
  const t = await open({ draft: quiet(), blobs: BLOBS, server: srv });
  try {
    await resumedAndFailed(t);
    await until(t, () => __s120.state.precleanPhotos.filter(p => p.status === 'failed').length === 2);
    const before = uploads(t).length;
    srv.upload = 'ok';
    await flag(t, '__hangTx', 'write');
    await t.page.evaluate(() => { window.__flushDone = __s120.runPreSubmitFlush(true); });
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(posts(t, '/functions/v1/submit-cleaning').length, 1, 'exactly one report');
    assert.equal(await t.page.evaluate(() => !document.getElementById('flush-overlay')?.classList.contains('visible')), true, 'the Uploading photos overlay is gone');
    assert.equal(uploads(t).length - before, 3, 'all three photos were uploaded first');
  } finally { await t.close(); }
});

/* ---- item 2: full or hung storage never loses a new photo ---- */
t0('R11 item 2: with the storage over its quota a new section photo still appears and uploads', async () => {
  const t = await openBare({ server: { upload: 'ok' } });
  try {
    await limitQuota(t, 1);
    await t.page.setInputFiles('#bedroom-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.bedroomPhotos.length === 1);
    await until(t, () => __s120.state.bedroomPhotos[0].status === 'done');
    assert.equal(uploads(t).length, 1, 'the photo went up from memory');
    assert.equal(await t.page.evaluate(() => document.querySelectorAll('#bedroom-photo-list .photo-thumb-wrap, .photo-thumb-wrap').length >= 1), true, 'a thumbnail is on the page');
    assert.deepEqual(await t.blobIds(), [], 'nothing was stored in the phone storage');
  } finally { await t.close(); }
});

t0('R11 item 2: with the storage over its quota a new meter photo leaves Processing and uploads', async () => {
  const t = await openBare({ server: { upload: 'ok' } });
  try {
    await limitQuota(t, 1);
    await t.page.setInputFiles('#meter-photo-0-cap', await jpeg(t));
    await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].status === 'done');
    assert.equal(uploads(t).length >= 1, true, 'the photo went up from memory');
    assert.equal(await t.page.evaluate(() => document.body.innerText.includes('Processing')), false, 'no Processing text is left');
    assert.equal(await t.page.evaluate(() => __s120.state.meterPhotos[0].idbId), null, 'it never had a stored blob');
  } finally { await t.close(); }
});

for (const [kind, input, group] of [['section', '#bedroom-photo-cap', 'bedroomPhotos'], ['meter', '#meter-photo-0-cap', 'meterPhotos']]) {
  t0(`R11 item 2: a ${kind} photo whose blob write never settles still appears and uploads`, async () => {
    const t = await openBare({ server: { upload: 'ok' } });
    try {
      await flag(t, '__hangTx', 'write');
      await t.page.setInputFiles(input, await jpeg(t));
      await until(t, g => __s120.state[g][0] && __s120.state[g][0].status === 'done', group);
      assert.equal(await t.page.evaluate(g => __s120.state[g][0].idbId, group), null);
      assert.equal(await t.page.evaluate(() => document.body.innerText.includes('Processing')), false);
    } finally { await t.close(); }
  });
}

t0('R11 item 2: an upload whose blob read never settles uses the copy in memory', async () => {
  const t = await openBare({ server: { upload: 'ok' } });
  try {
    await flag(t, '__hangTx', 'read');
    await t.page.setInputFiles('#bedroom-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.bedroomPhotos[0] && __s120.state.bedroomPhotos[0].status === 'done');
    assert.equal(uploads(t).length, 1);
  } finally { await t.close(); }
});

/* ---- item 4: carried send keys survive full storage ---- */
/* fills localStorage until a write fails, then frees `leave` characters again */
function fillStorage(t, leave) {
  return t.page.evaluate(leave => {
    const made = [];
    for (const n of [200000, 20000, 2000, 200, 20, 2, 1]) { for (;;) { const k = 'fill' + made.length; try { localStorage.setItem(k, 'x'.repeat(n)); made.push([k, n]); } catch { break; } } }
    let freed = 0;
    while (freed < leave && made.length) { const [k, n] = made.pop(); localStorage.removeItem(k); freed += n + k.length; }
    // put back all but `leave` characters of what was freed
    for (let n = freed - leave - 10; n > 0; n--) { try { localStorage.setItem('fillback', 'x'.repeat(n)); break; } catch { /* a little less */ } }
    return freed;
  }, leave);
}
t0('R11 item 4: with localStorage full, the carry key is kept until a draft holds the keys, so a reload still has them', async () => {
  const t = await openPage({ answers: server({}) });
  try {
    await t.page.goto(t.s.url + '__blank', { waitUntil: 'domcontentloaded' });
    const carry = JSON.stringify({ restock: restockOf(), linen: linenOf(), supplyLogSaved: true });
    await t.page.evaluate(carry => {
      localStorage.setItem('ch_staff_session_v1', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: 'u-test', email: 'test.cleaner@example.test', user_metadata: { display_name: 'Test Cleaner' } } }));
      localStorage.setItem('ch_s120_carry', carry);
    }, carry);
    await fillStorage(t, 400);   // room for the carry key, not for a draft
    for (let i = 0; i < 2; i++) {
      await t.page.goto(t.s.url, { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
      await t.page.waitForTimeout(700);
      const kept = await t.page.evaluate(() => localStorage.getItem('ch_s120_carry'));
      assert.ok(kept && kept.includes('rk-test') && kept.includes('lk-test'), 'load ' + (i + 1) + ': the keys are still in the carry key: ' + kept);
      assert.equal(await t.page.evaluate(() => __s120.state.restock && __s120.state.restock.key), 'rk-test', 'and the page has them too');
    }
  } finally { await t.close(); }
});

t0('R11 item 4 and 5: Start fresh with no room for the carry key keeps the draft and says so; on the second tap, with space back, it starts fresh', async () => {
  const t = await open({ draft: freshDraft(), blobs: BLOBS, server: {} });
  try {
    const before = await stored(t);
    await t.page.evaluate(() => { window.__fullCarry = 'always'; });
    await t.page.click('#btn-draft-fresh');
    await t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('not enough space'), null, { timeout: 15000 });
    assert.equal(await stored(t), before, 'the draft is as it was');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort(), 'no blob was deleted');
    assert.equal(await t.page.evaluate(() => document.getElementById('draft-modal').classList.contains('open')), true, 'the modal stays open');
    await t.page.evaluate(() => { window.__fullCarry = null; });
    await t.page.click('#btn-draft-fresh');
    await closed(t);
    await t.page.waitForFunction(() => (localStorage.getItem('ch_draft_v6') || '').includes('rk-test'), null, { timeout: 15000 });
    assert.equal(parse(await stored(t)).restock.key, 'rk-test', 'the keys were carried into the new draft');
    assert.equal(await t.page.evaluate(() => localStorage.getItem('ch_s120_carry')), null, 'the carry key is used up');
    await t.page.waitForTimeout(500);
    assert.deepEqual(await t.blobIds(), [], 'the old draft blobs were swept');
  } finally { await t.close(); }
});

t0('R11 item 5: after a failed Resume the refused Start fresh also works on the second tap', async () => {
  const t = await open({ draft: freshDraft(), blobs: BLOBS, server: {} });
  try {
    await t.page.evaluate(() => { window.__failRestore = true; window.__fullCarry = 'always'; });
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('could not be restored'), null, { timeout: 15000 });
    await t.page.click('#btn-draft-fresh');
    await t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('not enough space'), null, { timeout: 15000 });
    await t.page.evaluate(() => { window.__fullCarry = null; });
    await t.page.click('#btn-draft-fresh');
    await t.page.waitForFunction(() => (localStorage.getItem('ch_draft_v6') || '').includes('rk-test'), null, { timeout: 15000 });
    assert.equal(parse(await stored(t)).restock.key, 'rk-test');
  } finally { await t.close(); }
});

/* ---- item 6: a late delete never brings a submitted draft back ---- */
async function submittedThenLate(t) {
  await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
  assert.equal(await stored(t), null, 'the report cleared the draft');
  await t.page.waitForTimeout(4500);   // past the 3 s limit and the slow delete
  assert.equal(await stored(t), null, 'no late save brought the draft back');
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
  await t.page.waitForTimeout(500);
  assert.equal(await t.page.evaluate(() => document.getElementById('draft-modal').classList.contains('open')), false, 'no Resume session question after a reload');
}
t0('R11 item 6: a delete that settles after the report succeeded does not bring the draft back (the save after a failed delete)', async () => {
  const t = await open({ draft: quiet(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    await flag(t, '__hangTx', 'write');
    await t.page.click('#btn-draft-resume'); await closed(t);
    await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].uploaded && __s120.state.precleanPhotos.filter(p => p.uploaded).length === 3);
    await t.page.evaluate(() => { window.__flushDone = __s120.runPreSubmitFlush(true); });
    await submittedThenLate(t);
  } finally { await t.close(); }
});

t0('R11 item 6: the late sweep of a kept blob does not bring the draft back either', async () => {
  const t = await open({ draft: quiet(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    await flag(t, '__failDelete', 'throw');
    await t.page.click('#btn-draft-resume'); await closed(t);
    await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].uploaded && __s120.state.precleanPhotos.filter(p => p.uploaded).length === 3);
    await t.page.waitForTimeout(500);
    await t.page.evaluate(() => { window.__failDelete = null; window.__slowComplete = 1500; });
    // a save that sticks starts the sweep; its deletes finish 1.5 s later, after the report has gone
    await t.page.evaluate(() => { __s120.saveDraft(); window.__flushDone = __s120.runPreSubmitFlush(true); });
    await submittedThenLate(t);
  } finally { await t.close(); }
});

/* a double tap on Start fresh runs it once */
t0('R11 item 5: two taps at once on Start fresh run it once', async () => {
  const t = await open({ draft: freshDraft(), blobs: BLOBS, server: {} });
  try {
    await t.page.evaluate(() => { const b = document.getElementById('btn-draft-fresh'); b.click(); b.click(); });
    await closed(t);
    await t.page.waitForTimeout(500);
    assert.equal(await t.page.evaluate(() => window.__drafts.length), 1, 'one save of the new draft');
  } finally { await t.close(); }
});

/* a transaction that aborts (the quota case on a real phone) fires abort and no error */
t0('R11 item 2: a blob write that aborts on its own still leaves the photo in memory, uploaded', async () => {
  const t = await openBare({ server: { upload: 'ok' } });
  try {
    await flag(t, '__abortPut', true);
    const t0ms = Date.now();
    await t.page.setInputFiles('#bedroom-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.bedroomPhotos[0] && __s120.state.bedroomPhotos[0].status === 'done');
    assert.ok(Date.now() - t0ms < 2900, 'it did not wait for the time limit');
    assert.equal(uploads(t).length, 1);
  } finally { await t.close(); }
});
