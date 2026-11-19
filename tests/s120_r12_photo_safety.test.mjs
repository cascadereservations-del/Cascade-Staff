// Session 120, lane R12: a photo the cleaner took is either uploaded, or still held, or the cleaner is told to retake it. A report that succeeded stays finished.
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
/* o.upload = 'ok' | 'fail' | 'first-held' (the first upload request waits until o.releaseFirst() is called, the rest are answered); o.held lists routes waiting */
function server(o = {}) {
  return { handler: (rec, route) => {
    if (rec.url.includes('/rest/v1/inventory_items')) return json(rec.url.includes('is_consumable=eq.true') ? ITEMS : LINEN);
    if (rec.url.includes('/functions/v1/upload-photo')) {
      const okBody = json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() });
      if (o.upload === 'first-held' && !o.firstSeen) { o.firstSeen = true; o.releaseFirst = () => route.fulfill(okBody); return 'held'; }
      return o.upload === 'fail' ? json({ ok: false }, 500) : okBody;
    }
    if (rec.url.includes('/rpc/record_restock_v1') || rec.url.includes('/rpc/record_linen_stains_v1')) return json({ ok: true });
    if (o.holdAuth && rec.url.includes('/auth/v1/token')) { o.authRoute = route; return 'held'; }
    return null;
  } };
}
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: false, tried: true, key: 'rk-test', failed: '', unavailable: false, legacy: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const linenOf = (over = {}) => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: false, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const quiet = (over = {}) => draftOf({ supplyLogSaved: true, restock: restockOf({ sent: true, waiting: false }), linen: linenOf({ sent: true, waiting: false }), confirmItems: { check_2_4: 'confirmed' }, confirmNotes: { check_2_4: 'Bath Towel: stain came out' }, ...over });

async function open(opts = {}) {
  const t = await openPage({ ...opts, answers: server(opts.server) });
  await t.boot();
  await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
  return t;
}
async function openBare(opts = {}) {
  const t = await openPage({ ...opts, answers: server(opts.server) });
  await t.boot();
  await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
  return t;
}
const closed = t => t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
const flag = (t, k, v) => t.page.evaluate(([k, v]) => { window[k] = v; }, [k, v]);
const until = (t, fn, arg, ms = 20000) => t.page.waitForFunction(fn, arg, { timeout: ms });
const toastText = t => t.page.evaluate(() => document.getElementById('toast-area')?.textContent || '');
async function jpeg(t) {
  const b64 = await t.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); for (let i = 0; i < 700; i++) { x.fillStyle = `hsl(${(i * 47) % 360},70%,${25 + (i * 13) % 50}%)`; x.fillRect((i * 37) % 900, (i * 91) % 700, 70, 50); } return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  return { name: 'cap.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
/* a real quota limit on the page origin: a blob write now aborts with QuotaExceededError */
async function limitQuota(t, bytes) {
  const cdp = await t.ctx.newCDPSession(t.page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(t.url).origin, quotaSize: bytes });
}
/* a REAL readwrite transaction on the blob store, kept busy for ms: everything else on the store waits behind it */
const holdStore = (t, ms) => t.page.evaluate(ms => {
  window.__held = (async () => {
    const db = await new Promise(ok => { const r = indexedDB.open('ch_photos_v1', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos'); r.onsuccess = () => ok(r.result); });
    const os = db.transaction('photos', 'readwrite').objectStore('photos'), end = Date.now() + ms;
    const tick = () => { if (Date.now() < end) os.get('__none').onsuccess = tick; };
    tick();
  })();
  return true;
}, ms);

/* ---- item 1: a slow read after Resume never loses a photo ---- */
async function resumedUploadsAll(t, srv) {
  await t.page.click('#btn-draft-resume');
  await closed(t);
  // the photos upload on their own (no flush yet): a read that gave up must have fallen back to the bytes in memory
  await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].uploaded && __s120.state.precleanPhotos.filter(p => p.uploaded).length === 3, null, 30000);
  assert.equal(uploads(t).length, 3, 'all three photos went up');
  await t.page.evaluate(() => { window.__flushDone = __s120.runPreSubmitFlush(true); });
  await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
  assert.equal(posts(t, '/functions/v1/submit-cleaning').length, 1, 'one report');
  assert.equal(uploads(t).length, 3, 'no photo was sent twice');
}
t0('R12 item 1: a blob read that takes 4 s after Resume uploads all 3 photos and one report goes', async () => {
  const srv = { upload: 'ok' };
  const t = await open({ draft: quiet(), blobs: BLOBS, server: srv });
  try { await flag(t, '__slowRead', 4000); await resumedUploadsAll(t, srv); } finally { await t.close(); }
});
t0('R12 item 1: a real readwrite transaction held open on the store (it blocks reads) loses no photo and one report goes', async () => {
  const srv = { upload: 'ok' };
  const t = await open({ draft: quiet(), blobs: BLOBS, server: srv });
  try { await flag(t, '__holdReal', 4500); await resumedUploadsAll(t, srv); } finally { await t.close(); }
});

/* ---- item 2: a photo held only in memory is never lost without a word ---- */
t0('R12 item 2: under a real quota limit a new section photo and a new meter photo say to keep the page open; after a reload and Resume both slots are empty and the cleaner is told', async () => {
  const t = await openBare({ server: { upload: 'fail' } });
  try {
    await limitQuota(t, 1);
    await t.page.setInputFiles('#afterclean-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.aftercleanPhotos.length === 1);
    assert.ok((await toastText(t)).includes('Keep this page open until the photo shows Uploaded.'), 'the section photo says so');
    await t.page.evaluate(() => { document.getElementById('toast-area').innerHTML = ''; });
    await t.page.setInputFiles('#meter-photo-0-cap', await jpeg(t));
    await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].status === 'failed' && __s120.state.aftercleanPhotos[0].status === 'failed');
    assert.ok((await toastText(t)).includes('Keep this page open until the photo shows Uploaded.'), 'the meter photo says so');
    assert.deepEqual(await t.blobIds(), [], 'neither photo is in the phone storage');
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
    await t.page.click('#btn-draft-resume');
    await closed(t);
    assert.equal(await t.page.evaluate(() => __s120.state.aftercleanPhotos.length), 0, 'the section slot is empty');
    assert.equal(await t.page.evaluate(() => __s120.state.meterPhotos[0]), null, 'the meter slot is empty');
    assert.equal(await t.page.evaluate(() => __s120.K_afterPhotosOk()), false, 'the after-clean minimum asks again');
    const said = await toastText(t);
    assert.ok(said.includes('Retake these photos: ') && said.includes('Electric meter') && said.includes('After-cleaning'), 'the cleaner is told: ' + said);
    assert.equal(said.includes('Session resumed'), false);
    const d = parse(await t.stored());
    assert.deepEqual([d.meterPhotoMeta[0], d.aftercleanPhotoMeta.length], [null, 0], 'the saved draft no longer holds them');
  } finally { await t.close(); }
});

const rec = (n, idbId) => ({ name: 'a' + n + '.jpg', url: '', fileId: '', uploaded: false, status: 'queued', idbId, slot: null, takenAt: null });
const five = lost => draftOf({ meterPhotoMeta: [null, null], precleanPhotoMeta: [], aftercleanPhotoMeta: [0, 1, 2, 3, 4].map(n => rec(n, n < lost ? null : 'idb-a' + n)) });
t0('R12 item 2: five after-clean photos with one that was only in memory leave four and the minimum asks again; with all five stored it does not', async () => {
  const t = await open({ draft: five(1), blobs: ['idb-a1', 'idb-a2', 'idb-a3', 'idb-a4'].slice(0, 4).map(id => id), server: { upload: 'fail' } });
  try {
    await t.page.click('#btn-draft-resume'); await closed(t);
    assert.equal(await t.page.evaluate(() => __s120.state.aftercleanPhotos.length), 4);
    assert.equal(await t.page.evaluate(() => __s120.K_afterPhotosOk()), false, 'four is under the minimum');
    assert.ok((await toastText(t)).includes('Retake the After-cleaning photo.'));
  } finally { await t.close(); }
  const u = await open({ draft: five(0), blobs: ['idb-a0', 'idb-a1', 'idb-a2', 'idb-a3', 'idb-a4'], server: { upload: 'fail' } });
  try {
    await u.page.click('#btn-draft-resume'); await closed(u);
    assert.equal(await u.page.evaluate(() => __s120.K_afterPhotosOk()), true, 'five stored photos meet the minimum');
    assert.ok((await toastText(u)).includes('Session resumed'));
  } finally { await u.close(); }
});

t0('R12 item 2: a stored blob that cannot be read still fails the Resume (today\'s path), no photo is dropped', async () => {
  const t = await open({ draft: quiet(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    const before = await t.stored();
    await flag(t, '__failGet', true);
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('could not be restored'), null, { timeout: 15000 });
    assert.equal(await t.stored(), before, 'the draft is as it was');
  } finally { await t.close(); }
});

/* ---- item 3: a kept carry key is removed once a stored draft holds the keys, and not before ---- */
function fillStorage(t, leave) {
  return t.page.evaluate(leave => {
    const made = [];
    for (const n of [200000, 20000, 2000, 200, 20, 2, 1]) { for (;;) { const k = 'fill' + made.length; try { localStorage.setItem(k, 'x'.repeat(n)); made.push([k, n]); } catch { break; } } }
    let freed = 0;
    while (freed < leave && made.length) { const [k, n] = made.pop(); localStorage.removeItem(k); freed += n + k.length; }
    for (let n = freed - leave - 10; n > 0; n--) { try { localStorage.setItem('fillback', 'x'.repeat(n)); break; } catch { /* a little less */ } }
    return freed;
  }, leave);
}
const seedCarry = (t, expiresIn) => t.page.evaluate(([carry, exp]) => {
  localStorage.setItem('ch_staff_session_v1', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + exp, user: { id: 'u-test', email: 'test.cleaner@example.test', user_metadata: { display_name: 'Test Cleaner' } } }));
  localStorage.setItem('ch_s120_carry', carry);
}, [JSON.stringify({ restock: restockOf({ sent: true, waiting: false }), linen: linenOf({ sent: true, waiting: false }), supplyLogSaved: true }), expiresIn]);
const carryKey = t => t.page.evaluate(() => localStorage.getItem('ch_s120_carry'));

t0('R12 item 3: with storage full the carry key stays; once space is back a save removes it; after the report and a reload there is no draft, no question and Restock is not marked sent', async () => {
  const t = await openPage({ answers: server({}) });
  try {
    await t.page.goto(t.s.url + '__blank', { waitUntil: 'domcontentloaded' });
    await seedCarry(t, 86400);
    await fillStorage(t, 400);   // room for the carry key, not for a draft
    await t.page.goto(t.s.url, { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => window.__s120 && window.__s120.state && window.__s120.state.restock, null, { timeout: 15000 });
    await t.page.waitForTimeout(700);
    assert.ok((await carryKey(t) || '').includes('rk-test'), 'the key is kept while no draft fits');
    await t.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fill')).forEach(k => localStorage.removeItem(k)));   // space is back
    assert.equal(await t.page.evaluate(() => __s120.saveDraft()), true, 'a save sticks');
    assert.equal(await carryKey(t), null, 'and it removes the carry key');
    assert.ok((await t.stored()).includes('rk-test'), 'the stored draft holds the keys');
    await t.page.evaluate(() => { window.__flushDone = __s120.runPreSubmitFlush(true); });
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(await t.stored(), null, 'the report cleared the draft');
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
    await t.page.waitForTimeout(800);
    assert.equal(await t.page.evaluate(() => document.getElementById('draft-modal').classList.contains('open')), false, 'no Resume question');
    assert.equal(await t.stored(), null, 'no draft was written');
    assert.equal(await t.page.evaluate(() => !!(__s120.state.restock && (__s120.state.restock.sent || __s120.state.restock.saved))), false, 'Restock is not marked saved or sent');
  } finally { await t.close(); }
});

t0('R12 item 3: a save that runs before the carry key was applied does not remove it', async () => {
  const srv = { holdAuth: true };
  const t = await openPage({ answers: server(srv) });
  try {
    await t.page.goto(t.s.url + '__blank', { waitUntil: 'domcontentloaded' });
    await seedCarry(t, 10);   // about to expire: the page refreshes the session first, and boot waits for that answer
    await t.page.goto(t.s.url, { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
    await t.page.waitForFunction(() => true);
    for (let i = 0; i < 100 && !srv.authRoute; i++) await t.page.waitForTimeout(100);
    assert.ok(srv.authRoute, 'boot is waiting for the session refresh');
    assert.equal(await t.page.evaluate(() => __s120.saveDraft()), true, 'a save sticks before the carry was applied');
    assert.ok((await carryKey(t) || '').includes('rk-test'), 'and the carry key is still there');
    await srv.authRoute.fulfill(json({ access_token: 'a2', refresh_token: 'r2', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, token_type: 'bearer', user: { id: 'u-test', email: 'test.cleaner@example.test', user_metadata: { display_name: 'Test Cleaner' } } }));
    await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });   // that save stored a draft, so boot asks the Resume question instead of reading the key
    assert.ok((await carryKey(t) || '').includes('rk-test'), 'the carry key is still there after boot');
  } finally { await t.close(); }
});

/* ---- item 4: a late save never brings a submitted draft back ---- */
t0('R12 item 4: a capture-time upload that finishes after the report does not bring the draft back; after a reload there is no draft and no question', async () => {
  const srv = { upload: 'first-held' };
  const t = await open({ draft: quiet(), blobs: BLOBS, server: srv });
  try {
    await t.page.click('#btn-draft-resume'); await closed(t);
    for (let i = 0; i < 150 && !srv.releaseFirst; i++) await t.page.waitForTimeout(100);   // the first upload is on its way and waits
    assert.ok(srv.releaseFirst, 'the first upload is waiting');
    await t.page.evaluate(() => { window.__flushDone = __s120.runPreSubmitFlush(true); });
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(await t.stored(), null, 'the report cleared the draft');
    await srv.releaseFirst();   // the slow upload answers now
    await t.page.waitForTimeout(1500);
    assert.equal(await t.stored(), null, 'the late upload wrote no draft');
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
    await t.page.waitForTimeout(600);
    assert.equal(await t.page.evaluate(() => document.getElementById('draft-modal').classList.contains('open')), false, 'no Resume question');
    assert.equal(await t.stored(), null);
  } finally { await t.close(); }
});

/* ---- item 5: at the time limit the write is cancelled ---- */
t0('R12 item 5: a write that waits behind a busy store past the limit is cancelled, so no blob is stored later', async () => {
  const t = await openBare({ server: { upload: 'ok' } });
  try {
    await holdStore(t, 4500);
    await t.page.setInputFiles('#bedroom-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.bedroomPhotos[0] && __s120.state.bedroomPhotos[0].status === 'done', null, 30000);
    assert.equal(await t.page.evaluate(() => __s120.state.bedroomPhotos[0].idbId), null, 'it was kept in memory');
    await t.page.waitForTimeout(3000);   // the busy store is free by now: a late write would land here
    assert.deepEqual(await t.blobIds(), [], 'no blob was stored late');
  } finally { await t.close(); }
});

t0('R12 item 5: an open that answers after the limit does not write the photo late either', async () => {
  const t = await openBare({ server: { upload: 'ok' } });
  try {
    await flag(t, '__slowOpen', 4500);
    await t.page.setInputFiles('#bedroom-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.bedroomPhotos[0] && __s120.state.bedroomPhotos[0].status === 'done', null, 30000);
    assert.equal(await t.page.evaluate(() => __s120.state.bedroomPhotos[0].idbId), null, 'it was kept in memory');
    await t.page.waitForTimeout(3500);   // the open has answered by now: a late write would land here
    assert.deepEqual(await t.blobIds(), [], 'no blob was stored late');
  } finally { await t.close(); }
});

/* ---- item 6: an open that never answers is not remembered ---- */
t0('R12 item 6: an open that hangs once, then works, stores the next photo', async () => {
  const t = await openBare({ server: { upload: 'fail' } });
  try {
    await flag(t, '__hangOpen', 1);
    await t.page.setInputFiles('#bedroom-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.bedroomPhotos.length === 1);
    assert.equal(await t.page.evaluate(() => __s120.state.bedroomPhotos[0].idbId), null, 'the first one was kept in memory');
    await t.page.setInputFiles('#bedroom-photo-cap', await jpeg(t));
    await until(t, () => __s120.state.bedroomPhotos.length === 2);
    const id = await t.page.evaluate(() => __s120.state.bedroomPhotos[1].idbId);
    assert.ok(id, 'the second one has a stored blob');
    assert.deepEqual(await t.blobIds(), [id], 'and it is in the store');
  } finally { await t.close(); }
});
