// Session 120, lane R15: a retake of a damage or condition photo is not covered by the earlier upload; a held one is counted on Resume; one automatic run when the signal returns.
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
const submits = t => t.calls.filter(c => c.method === 'POST' && c.url.includes('/submit-cleaning') && !c.failed);
/* o.upload = 'ok' | 'fail', o.restock = 'ok' | 'fail', o.down (every request dropped), o.failPost (the report POST dropped) and o.hook are read on every request */
function server(o = {}) {
  return { handler: (rec, route) => {
    if (o.down) { rec.failed = true; route.abort('internetdisconnected'); return 'held'; }
    if (o.failPost && rec.url.includes('/submit-cleaning')) { rec.failed = true; route.abort('connectionreset'); return 'held'; }
    if (o.hook) { const r = o.hook(rec, route); if (r) return r; }
    if (rec.url.includes('/rest/v1/inventory_items')) return json(rec.url.includes('is_consumable=eq.true') ? ITEMS : LINEN);
    if (rec.url.includes('/functions/v1/upload-photo')) return o.upload === 'fail' ? json({ ok: false }, 500) : json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() });
    if (rec.url.includes('/rpc/record_restock_v1')) return o.restock === 'fail' ? json({ message: 'down' }, 500) : json({ ok: true });
    if (rec.url.includes('/rpc/record_linen_stains_v1')) return json({ ok: true });
    return null;
  } };
}
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: false, tried: true, key: 'rk-test', failed: '', unavailable: false, ...over });
const linenOf = (over = {}) => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: true, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: false, ...over });
const nothing = (over = {}) => draftOf({ supplyLogSaved: true, restock: restockOf({ sent: true, waiting: false }), linen: linenOf(), confirmItems: { check_2_4: 'confirmed' }, meterPhotoMeta: [null, null], precleanPhotoMeta: [], aftercleanPhotoMeta: [], ...over });

const up = name => ({ name, url: 'https://drive.example.test/' + name, fileId: 'f-' + name, uploaded: true, status: 'done', idbId: null, slot: null, takenAt: null });
const five = prefix => [0, 1, 2, 3, 4].map(n => up(prefix + n + '.jpg'));
/* a report that could be submitted as it stands (so the automatic run on the online event is due) */
const LOCK = { phase: 6, electricReading: '100', waterReading: '10', confirmNotes: { check_2_4: 'Bath Towel: stain came out' }, meterPhotoMeta: [up('m0.jpg'), up('m1.jpg')], precleanPhotoMeta: five('p'), aftercleanPhotoMeta: five('a') };
async function open(opts = {}) {
  const srv = opts.srv || {};
  const t = await openPage({ draft: nothing(opts.over), answers: server(srv) });
  t.srv = srv;
  await t.boot();
  await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
  return t;
}
const closed = t => t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
const resume = async t => { await t.page.click('#btn-draft-resume'); await closed(t); };
const until = (t, fn, arg, ms = 30000) => t.page.waitForFunction(fn, arg, { timeout: ms });
const tap = t => t.page.evaluate(() => __s120.runPreSubmitFlush(true));
const statusText = t => t.page.evaluate(() => document.getElementById('submit-status')?.textContent || '');
const toastText = t => t.page.evaluate(() => document.getElementById('toast-area')?.textContent || '');
const successText = t => t.page.evaluate(() => document.querySelector('.success-telegram-note').textContent.trim());
/* a different picture for each seed, so two captures never have the same bytes */
async function jpeg(t, seed = 0) {
  const b64 = await t.page.evaluate(seed => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); for (let i = 0; i < 700; i++) { x.fillStyle = `hsl(${(i * 47 + seed * 83) % 360},70%,${25 + (i * 13 + seed * 7) % 50}%)`; x.fillRect((i * 37 + seed * 11) % 900, (i * 91 + seed * 5) % 700, 70, 50); } return c.toDataURL('image/jpeg', 0.9).split(',')[1]; }, seed);
  return { name: 'cap.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
const MSG1 = '1 photo did not upload. Check the signal and tap Submit to try again. If it still fails, the report goes without it.';
const issueInput = '.issue-photo-input-check_7_5';
const KINDS = {
  damage: { input: issueInput, key: 'issue_check_7_5', data: () => __s120.state.issueFlags.check_7_5 && __s120.state.issueFlags.check_7_5.photoData, url: () => __s120.state.issueFlags.check_7_5 && __s120.state.issueFlags.check_7_5.photoUrl, fid: () => __s120.state.issueFlags.check_7_5 && __s120.state.issueFlags.check_7_5.photoFileId },
  condition: { input: '#conditionPhoto', key: 'section_condition', data: () => __s120.state.conditionPhotoData, url: () => __s120.state.conditionPhotoUrl, fid: () => __s120.state.conditionPhotoFileId },
};
const uploadCalls = t => t.calls.filter(c => c.url.includes('/upload-photo')).length;

for (const [kind, K] of Object.entries(KINDS)) {
  t0(`R15 item 1 (${kind}): a retake whose upload fails does not keep the old upload: the first tap stops, the draft is kept, and the report never carries the old URL`, async () => {
    const t = await open({ srv: { upload: 'ok' } });
    try {
      await resume(t);
      await t.page.setInputFiles(K.input, [await jpeg(t, 1)]);
      await until(t, '(' + K.url + ')()');
      const old = await t.page.evaluate(K.url);
      t.srv.upload = 'fail';
      await t.page.setInputFiles(K.input, [await jpeg(t, 2)]);
      await until(t, '(' + K.data + ')()');
      assert.equal(await t.page.evaluate(K.url) || null, null, 'the old URL is cleared when the retake is stored');
      assert.equal(await t.page.evaluate(K.fid) || null, null, 'and so is the old file id');
      await t.page.waitForTimeout(800);
      await tap(t);
      assert.equal(await statusText(t), MSG1);
      assert.equal(submits(t).length, 0, 'the first tap stops');
      assert.ok(await t.stored(), 'the draft is kept');
      await tap(t);
      await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
      const body = submits(t)[0].body;
      assert.ok(!body.includes(old), 'the report never carries the old URL');
      assert.equal(JSON.parse(body).photos[K.key], undefined, 'no photo of this kind went');
      assert.equal(JSON.parse(body).diagnostics.photos_failed, 1);
      assert.equal(await successText(t), 'Report sent. 1 photo could not be sent.');
    } finally { await t.close(); }
  });
  t0(`R15 item 1 (${kind}): the first upload still in flight, the retake fails, the first then lands: the retake stays not uploaded and the tap stops`, async () => {
    let first = null, n = 0;
    const srv = { upload: 'ok', hook: (rec, route) => { if (rec.url.includes('/upload-photo') && ++n === 1) { first = route; return 'held'; } return null; } };
    const t = await open({ srv });
    try {
      await resume(t);
      await t.page.setInputFiles(K.input, [await jpeg(t, 1)]);
      for (let i = 0; i < 100 && !first; i++) await t.page.waitForTimeout(100);
      assert.ok(first, 'the first upload is out');
      srv.upload = 'fail';
      await t.page.setInputFiles(K.input, [await jpeg(t, 2)]);
      for (let i = 0; i < 300 && uploadCalls(t) < 2; i++) await t.page.waitForTimeout(100);   // the first, and the retake's one (a 500 is not retried)
      await t.page.waitForTimeout(800);
      await first.fulfill(json({ ok: true, path: 'p/first', signedUrl: 'https://drive.example.test/first' }));
      await t.page.waitForTimeout(800);
      assert.equal(await t.page.evaluate(K.url) || null, null, 'the late first upload did not become the retake');
      assert.ok(await t.page.evaluate(K.data), 'the retake is still held');
      await tap(t);
      assert.equal(await statusText(t), MSG1);
      assert.equal(submits(t).length, 0);
    } finally { await t.close(); }
  });
}

t0('R15 item 2: a damage photo and a condition photo that did not upload, then a reload and Resume: the message counts 2 and the damage note survives', async () => {
  const t = await open({ srv: { upload: 'fail' }, over: { confirmItems: { check_2_4: 'confirmed', check_7_5: 'issue' }, confirmNotes: { check_7_5: '' }, issueFlags: { check_7_5: { note: '', photoUrl: '', photoFileId: '' } } } });
  try {
    await resume(t);
    await t.page.setInputFiles(issueInput, [await jpeg(t, 1)]);
    await t.page.setInputFiles('#conditionPhoto', [await jpeg(t, 2)]);
    await until(t, () => __s120.state.issueFlags.check_7_5 && __s120.state.issueFlags.check_7_5.photoData && __s120.state.conditionPhotoData);
    await t.page.evaluate(() => { const n = document.getElementById('conf-note-check_7_5'); n.value = 'Cracked tile by the door'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await t.page.waitForTimeout(600);
    const stored = JSON.parse(await t.stored());
    assert.equal(stored.issueFlags.check_7_5.photoHeld, true);
    assert.equal(stored.conditionPhotoHeld, true);
    assert.ok(!JSON.stringify(stored).includes('data:image'), 'the photo bytes are not stored');
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
    await resume(t);
    assert.ok((await toastText(t)).includes('2 photos could not be kept. Please retake them.'), await toastText(t));
    assert.equal(await t.page.evaluate(() => __s120.state.issueFlags.check_7_5.note), 'Cracked tile by the door');
    assert.equal(await t.page.evaluate(() => !!__s120.state.issueFlags.check_7_5.photoData), false);
    // the marker goes with the photo: nothing is held now, so the next stored draft carries none
    const again = JSON.parse(await t.stored());
    assert.equal(again.issueFlags.check_7_5.photoHeld, undefined);
    assert.equal(again.conditionPhotoHeld, undefined);
  } finally { await t.close(); }
});
t0('R15 item 2: an old draft without the marker and an uploaded damage photo restore without the message', async () => {
  const t = await open({ over: { issueFlags: { check_7_5: { note: 'old', photoUrl: 'https://drive.example.test/x.jpg', photoFileId: 'f-x' } } } });
  try {
    await resume(t);
    assert.ok((await toastText(t)).includes('Session resumed'), await toastText(t));
    assert.equal(await t.page.evaluate(() => __s120.state.issueFlags.check_7_5.photoUrl), 'https://drive.example.test/x.jpg');
  } finally { await t.close(); }
});
t0('R15 item 2: photos that uploaded leave no marker', async () => {
  const t = await open({ srv: { upload: 'ok' } });
  try {
    await resume(t);
    await t.page.setInputFiles(issueInput, [await jpeg(t, 1)]);
    await t.page.setInputFiles('#conditionPhoto', [await jpeg(t, 2)]);
    await until(t, () => __s120.state.issueFlags.check_7_5.photoUrl && __s120.state.conditionPhotoUrl);
    await t.page.waitForTimeout(300);
    const stored = JSON.parse(await t.stored());
    assert.equal(stored.issueFlags.check_7_5.photoHeld, undefined);
    assert.equal(stored.conditionPhotoHeld, undefined);
  } finally { await t.close(); }
});

t0('R15 follow-up: an uploaded condition photo survives a reload and Resume and goes with the report', async () => {
  const t = await open({ srv: { upload: 'ok' } });
  try {
    await resume(t);
    await t.page.setInputFiles('#conditionPhoto', [await jpeg(t, 1)]);
    await until(t, () => __s120.state.conditionPhotoUrl);
    const url = await t.page.evaluate(() => __s120.state.conditionPhotoUrl);
    await t.page.waitForTimeout(300);
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
    await resume(t);
    assert.equal(await t.page.evaluate(() => __s120.state.conditionPhotoUrl), url);
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.ok(submits(t)[0].body.includes(url), 'the report carries the condition photo');
  } finally { await t.close(); }
});

t0('R15 item 3: restock failing, tap, tap, the report POST fails, the signal drops, Retry, a new photo, the signal returns and the upload fails: no report until a further tap, and the message stays', async () => {
  const srv = { upload: 'ok', restock: 'fail' };
  const t = await open({ srv, over: { supplyLogSaved: true, restock: restockOf({ sent: false, waiting: true }), ...LOCK } });
  try {
    await resume(t);
    await t.page.evaluate(() => document.querySelectorAll('.confirm-btn[data-state="confirmed"]').forEach(b => b.click()));   // every Confirm & Leave line answered, so the report could be submitted as it stands
    await tap(t);   // restock stop
    srv.failPost = true;
    await tap(t);   // the report goes; the POST fails
    await until(t, () => /Retry/.test(document.getElementById('btn-submit').textContent) && __s120.state.pendingOnlineRetry, null, 60000);
    assert.equal(submits(t).length, 0);
    srv.failPost = false; srv.down = true; await t.ctx.setOffline(true);
    await tap(t);   // Retry while offline
    assert.equal(await t.page.evaluate(() => __s120.state.pendingPreSubmit), true, 'the offline Retry left an automatic run waiting');
    await t.page.setInputFiles('#afterclean-photo-file', [await jpeg(t, 3)]);
    await until(t, () => __s120.state.aftercleanPhotos.length === 6 && __s120.state.aftercleanPhotos[5].status === 'failed');
    srv.down = false; srv.upload = 'fail'; await t.ctx.setOffline(false);
    await until(t, m => (document.getElementById('submit-status')?.textContent || '') === m, MSG1, 60000);
    await t.page.waitForTimeout(4000);
    assert.equal(submits(t).length, 0, 'no report went on its own');
    assert.equal(await statusText(t), MSG1, 'the message is still on screen');
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1);
  } finally { await t.close(); }
});
