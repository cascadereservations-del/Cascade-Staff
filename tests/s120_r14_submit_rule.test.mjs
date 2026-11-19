// Session 120, lane R14: one Submit rule for every photo. A photo that did not upload goes missing only after the cleaner was told about that photo, and a report is never blocked for good.
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
const posts = (t, name) => t.calls.filter(c => c.method === 'POST' && c.url.includes(name));
const submits = t => posts(t, '/submit-cleaning').filter(c => !c.failed);   // a request the made-up network dropped never reached the server
/* o.upload = 'ok' | 'fail', o.restock = 'ok' | 'fail' and o.down (no signal at all: every request is dropped) are read on every request, so a test can let the signal come back */
function server(o = {}) {
  return { handler: (rec, route) => {
    if (o.down) { rec.failed = true; route.abort('internetdisconnected'); return 'held'; }
    if (rec.url.includes('/rest/v1/inventory_items')) return json(rec.url.includes('is_consumable=eq.true') ? ITEMS : LINEN);
    if (rec.url.includes('/functions/v1/upload-photo')) return o.upload === 'fail' ? json({ ok: false }, 500) : json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() });
    if (rec.url.includes('/rpc/record_restock_v1')) return o.restock === 'fail' ? json({ message: 'down' }, 500) : json({ ok: true });
    if (rec.url.includes('/rpc/record_linen_stains_v1')) return json({ ok: true });
    return null;
  } };
}
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: false, tried: true, key: 'rk-test', failed: '', unavailable: false, legacy: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const linenOf = (over = {}) => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: false, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const quiet = (over = {}) => draftOf({ supplyLogSaved: true, restock: restockOf({ sent: true, waiting: false }), linen: linenOf({ sent: true, waiting: false }), confirmItems: { check_2_4: 'confirmed' }, confirmNotes: { check_2_4: 'Bath Towel: stain came out' }, ...over });
const held = n => quiet({ meterPhotoMeta: [null, null], precleanPhotoMeta: [], aftercleanPhotoMeta: Array.from({ length: n }, (_, i) => ({ name: 'a' + i + '.jpg', url: '', fileId: '', uploaded: false, status: 'queued', idbId: 'idb-a' + i, slot: null, takenAt: null })) });
const nothing = () => quiet({ meterPhotoMeta: [null, null], precleanPhotoMeta: [], aftercleanPhotoMeta: [] });
const blobs = n => Array.from({ length: n }, (_, i) => 'idb-a' + i);
const up = name => ({ name, url: 'https://drive.example.test/' + name, fileId: 'f-' + name, uploaded: true, status: 'done', idbId: null, slot: null, takenAt: null });
const dropped = name => ({ name, url: '', fileId: '', uploaded: false, status: 'queued', idbId: null, slot: null, takenAt: null });
const five = prefix => [0, 1, 2, 3, 4].map(n => up(prefix + n + '.jpg'));
const atLock = over => quiet({ phase: 6, electricReading: '100', waterReading: '10', meterPhotoMeta: [up('m0.jpg'), up('m1.jpg')], precleanPhotoMeta: five('p'), aftercleanPhotoMeta: five('a'), ...over });

async function open(opts = {}) {
  const t = await openPage({ ...opts, answers: server(opts.server) });
  await t.boot();
  await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
  return t;
}
const closed = t => t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
const until = (t, fn, arg, ms = 30000) => t.page.waitForFunction(fn, arg, { timeout: ms });
const toastText = t => t.page.evaluate(() => document.getElementById('toast-area')?.textContent || '');
const statusText = t => t.page.evaluate(() => document.getElementById('submit-status')?.textContent || '');
const tap = t => t.page.evaluate(() => __s120.runPreSubmitFlush(true));
const successText = t => t.page.evaluate(() => document.querySelector('.success-telegram-note').textContent.trim());
const resume = async t => { await t.page.click('#btn-draft-resume'); await closed(t); };
async function jpeg(t) {
  const b64 = await t.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); for (let i = 0; i < 700; i++) { x.fillStyle = `hsl(${(i * 47) % 360},70%,${25 + (i * 13) % 50}%)`; x.fillRect((i * 37) % 900, (i * 91) % 700, 70, 50); } return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  return { name: 'cap.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
const photosIn = (t, i = 0) => JSON.parse(submits(t)[i].body).photos;
const count = o => Object.values(o).reduce((n, a) => n + a.length, 0);
const MSG = n => n === 1 ? '1 photo did not upload. Check the signal and tap Submit to try again. If it still fails, the report goes without it.'
  : n + ' photos did not upload. Check the signal and tap Submit to try again. If they still fail, the report goes without them.';
const RESTOCK_MSG = 'Not sent yet: restock. Tap Submit again to send the report without it. The host will be told.';

/* ---- item 1: Resume never shows two steps ---- */
const activePhases = t => t.page.evaluate(() => Array.from(document.querySelectorAll('.phase.active')).map(n => n.id));
async function resumedAtLockUp(draft) {
  const t = await open({ draft, server: { upload: 'ok' } });
  await resume(t);
  await t.page.waitForTimeout(400);   // longer than every 20 ms step timer, so a late one has run
  return t;
}
t0('R14 item 1: a memory-only meter photo saved at Lock up: Resume shows exactly one step and a real click on the meter capture control works', async () => {
  const t = await resumedAtLockUp(atLock({ meterPhotoMeta: [dropped('m0.jpg'), up('m1.jpg')] }));
  try {
    assert.equal(await t.page.evaluate(() => __s120.state.phase), 1);
    assert.deepEqual(await activePhases(t), ['phase-1']);
    await t.page.click('#meter-photo-0-btn', { timeout: 10000 });
    const [chooser] = await Promise.all([t.page.waitForEvent('filechooser', { timeout: 10000 }), t.page.click('#pcs-take', { timeout: 10000 })]);
    assert.ok(chooser, 'the click reached the control');
  } finally { await t.close(); }
});
t0('R14 item 1: a memory-only after-clean photo saved at Lock up: Resume shows exactly one step and a real click on the after-clean capture control works', async () => {
  const t = await resumedAtLockUp(atLock({ cleaningType: 'mid_stay', confirmItems: { check_2_4: 'confirmed', check_7_5: 'confirmed', check_10_6: 'confirmed' }, aftercleanPhotoMeta: [up('a0.jpg'), up('a1.jpg'), up('a2.jpg'), dropped('a3.jpg')] }));
  try {
    assert.equal(await t.page.evaluate(() => __s120.state.phase), 5);
    assert.deepEqual(await activePhases(t), ['phase-5']);
    const [chooser] = await Promise.all([t.page.waitForEvent('filechooser', { timeout: 10000 }), t.page.click('#afterclean-photo-cap', { timeout: 10000 })]);
    assert.ok(chooser, 'the click reached the control');
  } finally { await t.close(); }
});

/* ---- item 2: one rule, one record per photo ---- */
t0('R14 item 2: a photo tells once. Three fail, the first tap stops and says 3; a fourth photo that also fails stops the next tap and says 1; the third tap sends the report without the four', async () => {
  const srv = { upload: 'fail' };
  const t = await open({ draft: held(3), blobs: blobs(3), server: srv });
  try {
    await resume(t);
    await until(t, () => __s120.state.aftercleanPhotos.length === 3 && __s120.state.aftercleanPhotos.every(p => p.status === 'failed'));
    await tap(t);
    assert.equal(await statusText(t), MSG(3));
    assert.equal(submits(t).length, 0);
    const f = await jpeg(t);
    await t.page.setInputFiles('#afterclean-photo-file', [f]);
    await until(t, () => __s120.state.aftercleanPhotos.length === 4 && __s120.state.aftercleanPhotos.every(p => p.status === 'failed'));
    await tap(t);
    assert.equal(await statusText(t), MSG(1), 'only the photo not yet told about is counted');
    assert.equal(submits(t).length, 0, 'the new photo gets its own stop');
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1);
    assert.equal(JSON.parse(submits(t)[0].body).diagnostics.photos_failed, 4);
    assert.equal(await successText(t), 'Report sent. 4 photos could not be sent.');
  } finally { await t.close(); }
});
t0('R14 item 2: a stop message shown by an automatic run counts as telling, and an automatic run never sends past a stop', async () => {
  const t = await open({ draft: held(2), blobs: blobs(2), server: { upload: 'fail' } });
  try {
    await resume(t);
    await until(t, () => __s120.state.aftercleanPhotos.length === 2 && __s120.state.aftercleanPhotos.every(p => p.status === 'failed'));
    await t.page.evaluate(() => __s120.runPreSubmitFlush());
    assert.equal(await statusText(t), MSG(2));
    await t.page.evaluate(() => __s120.runPreSubmitFlush());
    assert.equal(submits(t).length, 0, 'an automatic run does not send, even for photos it already told about');
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1, 'the first tap after the stop sends');
    assert.equal(await successText(t), 'Report sent. 2 photos could not be sent.');
  } finally { await t.close(); }
});
t0('R14 item 2 and 6: restock and photos both failing: the first stop shows both messages, restock first, and the second tap sends one report', async () => {
  const srv = { upload: 'fail', restock: 'fail' };
  const t = await open({ draft: held(2), blobs: blobs(2), server: srv });
  try {
    await t.page.evaluate(() => { /* the restock of this draft was never sent */ });
    await resume(t);
    await t.page.evaluate(() => { const R = __s120.state.restock; R.sent = false; R.tried = true; R.waiting = true; });
    await until(t, () => __s120.state.aftercleanPhotos.length === 2 && __s120.state.aftercleanPhotos.every(p => p.status === 'failed'));
    await tap(t);
    const said = await statusText(t);
    assert.equal(said, RESTOCK_MSG + ' ' + MSG(2), said);
    assert.ok(said.indexOf('restock') < said.indexOf('photos did not upload'), 'restock first');
    assert.equal(submits(t).length, 0);
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1, 'two taps, one report');
    assert.equal(JSON.parse(submits(t)[0].body).diagnostics.photos_failed, 2);
  } finally { await t.close(); }
});

/* ---- item 3: the online retry goes through the flush ---- */
t0('R14 item 3: no signal, tap, tap, the report fails to send, the signal returns and uploads work: one report with all 3 photos, none missing, normal success text', async () => {
  const srv = { upload: 'ok' };
  const t = await open({ draft: held(3), blobs: blobs(3), server: srv });
  try {
    await resume(t);
    await until(t, () => __s120.state.aftercleanPhotos.length === 3 && __s120.state.aftercleanPhotos.every(p => p.uploaded));
    // put the three photos back as held: the signal went away before they could go
    await t.page.evaluate(() => __s120.state.aftercleanPhotos.forEach(p => { p.uploaded = false; p.status = 'failed'; p.url = ''; p.fileId = ''; p._blob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' }); }));
    srv.down = true; await t.ctx.setOffline(true);
    await tap(t);
    assert.equal(await statusText(t), MSG(3));
    await tap(t);
    await until(t, () => !!document.getElementById('btn-submit') && /Retry/.test(document.getElementById('btn-submit').textContent), null, 60000);
    assert.equal(submits(t).length, 0, 'the report did not reach the server');
    srv.down = false; await t.ctx.setOffline(false);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 60000 });
    assert.equal(submits(t).length, 1, 'one report');
    assert.equal(count(photosIn(t)), 3, 'all three photos are in it');
    assert.equal(JSON.parse(submits(t)[0].body).diagnostics.photos_failed, 0);
    assert.equal(await successText(t), 'Report + photos sent to Telegram OPS group');
  } finally { await t.close(); }
});
t0('R14 item 3: no signal, tap, tap, the signal returns but the uploads still fail: the retry already told the cleaner, so the report goes without the 3 photos and says so', async () => {
  const srv = { upload: 'ok' };
  const t = await open({ draft: held(3), blobs: blobs(3), server: srv });
  try {
    await resume(t);
    await until(t, () => __s120.state.aftercleanPhotos.length === 3 && __s120.state.aftercleanPhotos.every(p => p.uploaded));
    await t.page.evaluate(() => __s120.state.aftercleanPhotos.forEach(p => { p.uploaded = false; p.status = 'failed'; p.url = ''; p.fileId = ''; p._blob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' }); }));
    srv.down = true; await t.ctx.setOffline(true);
    await tap(t);
    await tap(t);
    await until(t, () => /Retry/.test(document.getElementById('btn-submit').textContent), null, 60000);
    srv.down = false; srv.upload = 'fail'; await t.ctx.setOffline(false);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 60000 });
    assert.equal(submits(t).length, 1, 'one report');
    assert.equal(JSON.parse(submits(t)[0].body).diagnostics.photos_failed, 3);
    assert.equal(await successText(t), 'Report sent. 3 photos could not be sent.');
  } finally { await t.close(); }
});
t0('R14 item 3: the report fails offline, a photo is added, the signal returns and the upload fails: no report, the draft and the blob are kept and the message shows; the next tap sends and the screen says what is missing', async () => {
  const srv = { upload: 'fail' };
  const t = await open({ draft: nothing(), server: srv });
  try {
    await resume(t);
    srv.down = true; await t.ctx.setOffline(true);
    await tap(t);
    await until(t, () => /Retry/.test(document.getElementById('btn-submit').textContent), null, 60000);
    const f = await jpeg(t);
    await t.page.setInputFiles('#afterclean-photo-file', [f]);
    await until(t, () => __s120.state.aftercleanPhotos.length === 1 && __s120.state.aftercleanPhotos[0].status === 'failed');
    srv.down = false; srv.upload = 'fail'; await t.ctx.setOffline(false);
    await until(t, m => (document.getElementById('submit-status')?.textContent || '') === m, MSG(1), 60000);
    assert.equal(submits(t).length, 0, 'no report');
    assert.ok(await t.stored(), 'the draft is kept');
    assert.equal((await t.blobIds()).length, 1, 'and so is the blob');
    assert.ok((await toastText(t)).includes(MSG(1)));
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1);
    assert.equal(await successText(t), 'Report sent. 1 photo could not be sent.');
  } finally { await t.close(); }
});
t0('R14 item 3: a retry that fires while a run is out, or while a Resume holds the draft, still runs afterwards', async () => {
  const t = await open({ draft: nothing(), server: { upload: 'ok' } });
  try {
    // the Resume question is open: the draft is held
    await t.page.evaluate(() => { window.__s120.state.pendingOnlineRetry = true; window.dispatchEvent(new Event('online')); });
    await t.page.waitForTimeout(1600);
    assert.equal(submits(t).length, 0, 'nothing sent while the draft is held');
    await resume(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1, 'the held retry ran once the Resume was done');
  } finally { await t.close(); }
});

/* ---- item 4: damage and condition photos ---- */
const issueInput = '.issue-photo-input-check_7_5';
t0('R14 item 4: a damage photo and a condition photo that cannot upload stop the first tap, and once the signal is back one report carries both', async () => {
  const srv = { upload: 'fail' };
  const t = await open({ draft: nothing(), server: srv });
  try {
    await resume(t);
    const f = await jpeg(t);
    await t.page.setInputFiles(issueInput, [f]);
    await t.page.setInputFiles('#conditionPhoto', [f]);
    await until(t, () => __s120.state.issueFlags.check_7_5 && __s120.state.issueFlags.check_7_5.photoData && __s120.state.conditionPhotoData);
    await t.page.waitForTimeout(500);
    await tap(t);
    assert.equal(await statusText(t), MSG(2));
    assert.equal(submits(t).length, 0);
    srv.upload = 'ok';
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1);
    const ph = photosIn(t);
    assert.equal(ph.issue_check_7_5.length, 1, 'the damage photo is in the report');
    assert.equal(ph.section_condition.length, 1, 'the condition photo is in the report');
    assert.equal(JSON.parse(submits(t)[0].body).diagnostics.photos_failed, 0);
    assert.equal(await successText(t), 'Report + photos sent to Telegram OPS group');
  } finally { await t.close(); }
});
t0('R14 item 4: damage and condition photos that keep failing: the second tap sends, photos_failed is 2 and the text says so', async () => {
  const t = await open({ draft: nothing(), server: { upload: 'fail' } });
  try {
    await resume(t);
    const f = await jpeg(t);
    await t.page.setInputFiles(issueInput, [f]);
    await t.page.setInputFiles('#conditionPhoto', [f]);
    await until(t, () => __s120.state.issueFlags.check_7_5 && __s120.state.issueFlags.check_7_5.photoData && __s120.state.conditionPhotoData);
    await t.page.waitForTimeout(500);
    await tap(t);
    assert.equal(submits(t).length, 0);
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1);
    assert.equal(JSON.parse(submits(t)[0].body).diagnostics.photos_failed, 2);
    assert.equal(count(photosIn(t)), 0, 'neither photo is in it');
    assert.equal(await successText(t), 'Report sent. 2 photos could not be sent.');
  } finally { await t.close(); }
});

/* ---- item 5: the hand-back counts what was sent ---- */
t0('R14 item 5: a slow report POST while a photo finishes uploading: the shell is told the photos that were in the report, not the state after it', async () => {
  const held_ = { route: null };
  const t = await open({ draft: quiet({ meterPhotoMeta: [null, null], precleanPhotoMeta: [], aftercleanPhotoMeta: [up('a0.jpg')] }), server: { upload: 'ok' } });
  try {
    await t.page.evaluate(() => { window.parent = { postMessage: m => { window.__handBack = m; } }; });
    await resume(t);
    // the report goes with one photo; a second photo finishes during the POST
    t.answers.handler = (rec, route) => {
      if (rec.url.includes('/submit-cleaning')) { held_.route = route; return 'held'; }
      return server({ upload: 'ok' }).handler(rec, route);
    };
    await t.page.evaluate(() => { window.__run = __s120.runPreSubmitFlush(true); });
    for (let i = 0; i < 150 && !held_.route; i++) await t.page.waitForTimeout(100);
    assert.ok(held_.route, 'the report POST is out');
    await t.page.evaluate(() => { __s120.state.aftercleanPhotos.push({ name: 'late.jpg', url: 'https://drive.example.test/late.jpg', fileId: 'f-late', uploaded: true, status: 'done', idbId: null }); });
    await held_.route.fulfill(json({ ok: true }));
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(count(photosIn(t)), 1);
    assert.equal(await t.page.evaluate(() => window.__handBack && window.__handBack.photos), 1, 'one photo went with the report');
  } finally { await t.close(); }
});
