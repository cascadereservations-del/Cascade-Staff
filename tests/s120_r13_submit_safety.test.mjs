// Session 120, lane R13: Submit never loses photos quietly. A photo that did not upload stops the first tap and keeps the draft; the next tap sends the report and says how many photos are missing.
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
const submits = t => posts(t, '/submit-cleaning');
/* o.upload = 'ok' | 'fail' (read on every request, so a test can let the signal come back); o.holdPrev holds every /last-readings request in o.prevRoutes until the test fulfils them */
function server(o = {}) {
  return { handler: (rec, route) => {
    if (rec.url.includes('/rest/v1/inventory_items')) return json(rec.url.includes('is_consumable=eq.true') ? ITEMS : LINEN);
    if (rec.url.includes('/functions/v1/upload-photo')) return o.upload === 'fail' ? json({ ok: false }, 500) : json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() });
    if (rec.url.includes('/rpc/record_inventory_usage') || rec.url.includes('/rpc/record_linen_stains_v1')) return json({ ok: true });
    if (o.holdPrev && rec.url.includes('/last-readings')) { (o.prevRoutes ||= []).push(route); return 'held'; }
    return null;
  } };
}
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: false, tried: true, key: 'rk-test', failed: '', unavailable: false, legacy: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const linenOf = (over = {}) => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: false, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const quiet = (over = {}) => draftOf({ supplyLogSaved: true, restock: restockOf({ sent: true, waiting: false }), linen: linenOf({ sent: true, waiting: false }), confirmItems: { check_2_4: 'confirmed' }, confirmNotes: { check_2_4: 'Bath Towel: stain came out' }, ...over });
/* n after-clean photos held only in the phone storage (nothing uploaded yet) */
const held = n => quiet({ meterPhotoMeta: [null, null], precleanPhotoMeta: [], aftercleanPhotoMeta: Array.from({ length: n }, (_, i) => ({ name: 'a' + i + '.jpg', url: '', fileId: '', uploaded: false, status: 'queued', idbId: 'idb-a' + i, slot: null, takenAt: null })) });
const blobs = n => Array.from({ length: n }, (_, i) => 'idb-a' + i);

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
const until = (t, fn, arg, ms = 30000) => t.page.waitForFunction(fn, arg, { timeout: ms });
const toastText = t => t.page.evaluate(() => document.getElementById('toast-area')?.textContent || '');
const statusText = t => t.page.evaluate(() => document.getElementById('submit-status')?.textContent || '');
const tap = t => t.page.evaluate(() => __s120.runPreSubmitFlush(true));
const auto = t => t.page.evaluate(() => __s120.runPreSubmitFlush());
const successText = t => t.page.evaluate(() => document.querySelector('.success-telegram-note').textContent.trim());
/* the draft is resumed and every held photo has tried (and failed) its own upload */
async function resumeFailed(t, n) {
  await t.page.click('#btn-draft-resume'); await closed(t);
  await until(t, n => __s120.state.aftercleanPhotos.length === n && __s120.state.aftercleanPhotos.every(p => p.status === 'failed'), n);
}
async function jpeg(t) {
  const b64 = await t.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); for (let i = 0; i < 700; i++) { x.fillStyle = `hsl(${(i * 47) % 360},70%,${25 + (i * 13) % 50}%)`; x.fillRect((i * 37) % 900, (i * 91) % 700, 70, 50); } return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  return { name: 'cap.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
async function limitQuota(t, bytes) {
  const cdp = await t.ctx.newCDPSession(t.page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(t.url).origin, quotaSize: bytes });
}

const MSG3 = '3 photos did not upload. Check the signal and tap Submit to try again. If they still fail, the report goes without them.';
const MSG1 = '1 photo did not upload. Check the signal and tap Submit to try again. If it still fails, the report goes without it.';

/* ---- item 1 ---- */
t0('R13 item 1: three held photos and an upload that returns 500: the first tap sends no report and keeps the draft and the blobs; once the signal is back the second tap sends one report with all photos', async () => {
  const srv = { upload: 'fail' };
  const t = await open({ draft: held(3), blobs: blobs(3), server: srv });
  try {
    await resumeFailed(t, 3);
    await tap(t);
    assert.equal(submits(t).length, 0, 'no report on the first tap');
    assert.ok(await t.stored(), 'the draft is kept');
    assert.deepEqual(await t.blobIds(), ['idb-a0', 'idb-a1', 'idb-a2'], 'the blobs are kept');
    assert.ok((await toastText(t)).includes(MSG3), 'the toast says so: ' + await toastText(t));
    assert.equal(await statusText(t), MSG3, 'and so does the screen');
    assert.equal(await t.page.evaluate(() => document.getElementById('success-screen').classList.contains('visible')), false);
    srv.upload = 'ok';
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    const sent = submits(t);
    assert.equal(sent.length, 1, 'one report');
    assert.equal(JSON.parse(sent[0].body).diagnostics.photos_failed, 0, 'no photo is missing');
    assert.equal(await successText(t), 'Report + photos sent to Telegram OPS group');
  } finally { await t.close(); }
});

t0('R13 item 1: the upload keeps failing: the second tap sends one report without the photos, photos_failed is 3 and the success text says so', async () => {
  const t = await open({ draft: held(3), blobs: blobs(3), server: { upload: 'fail' } });
  try {
    await resumeFailed(t, 3);
    await t.page.evaluate(() => { window.parent = { postMessage: m => { window.__handBack = m; } }; });   // stands in for the shell that frames the page
    await tap(t);
    assert.equal(submits(t).length, 0);
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    const sent = submits(t);
    assert.equal(sent.length, 1, 'one report');
    assert.equal(JSON.parse(sent[0].body).diagnostics.photos_failed, 3);
    assert.equal(await t.page.evaluate(() => window.__handBack && window.__handBack.photos), 0, 'the shell is told no photo went with the report');
    assert.equal(await successText(t), 'Report sent. 3 photos could not be sent.');
  } finally { await t.close(); }
});

t0('R13 item 1: one photo says "1 photo" both ways, and an automatic run is never the second tap', async () => {
  const t = await open({ draft: held(1), blobs: blobs(1), server: { upload: 'fail' } });
  try {
    await resumeFailed(t, 1);
    await tap(t);
    assert.ok((await toastText(t)).includes(MSG1), 'singular wording: ' + await toastText(t));
    await auto(t);
    await auto(t);
    assert.equal(submits(t).length, 0, 'an automatic run does not send the report');
    assert.ok(await t.stored(), 'and the draft is still there');
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1);
    assert.equal(await successText(t), 'Report sent. 1 photo could not be sent.');
  } finally { await t.close(); }
});

/* ---- item 2 ---- */
const up = (name) => ({ name, url: 'https://drive.example.test/' + name, fileId: 'f-' + name, uploaded: true, status: 'done', idbId: null, slot: null, takenAt: null });
const dropped = name => ({ name, url: '', fileId: '', uploaded: false, status: 'queued', idbId: null, slot: null, takenAt: null });
const five = prefix => [0, 1, 2, 3, 4].map(n => up(prefix + n + '.jpg'));
const atLock = over => quiet({ phase: 6, electricReading: '100', waterReading: '10', meterPhotoMeta: [up('m0.jpg'), up('m1.jpg')], precleanPhotoMeta: five('p'), aftercleanPhotoMeta: five('a'), ...over });
async function resumedAtLockUp(draft) {
  const t = await open({ draft, server: { upload: 'ok' } });
  await t.page.click('#btn-draft-resume'); await closed(t);
  return t;
}
const cueOf = t => t.page.evaluate(() => ({ phase: __s120.state.phase, cue: document.getElementById('nav-cue').textContent, submitOff: document.getElementById('btn-submit').disabled || getComputedStyle(document.getElementById('btn-submit')).display === 'none' }));
t0('R13 item 2: Resume at Lock up with a dropped electric meter photo goes back to the first step, Submit cannot be reached and the cue names the photo', async () => {
  const t = await resumedAtLockUp(atLock({ meterPhotoMeta: [dropped('m0.jpg'), up('m1.jpg')] }));
  try {
    const c = await cueOf(t);
    assert.equal(c.phase, 1);
    assert.ok(c.cue.includes('electric meter photo'), c.cue);
    assert.equal(c.submitOff, true);
    assert.ok((await toastText(t)).includes('1 photo could not be kept. Please retake it.'));
  } finally { await t.close(); }
});
t0('R13 item 2: Resume at Lock up with a dropped pre-clean photo goes back to the first step and the cue names it', async () => {
  const t = await resumedAtLockUp(atLock({ precleanPhotoMeta: [up('p0.jpg'), up('p1.jpg'), up('p2.jpg'), up('p3.jpg'), dropped('p4.jpg')] }));
  try {
    const c = await cueOf(t);
    assert.equal(c.phase, 1);
    assert.ok(c.cue.includes('1 more pre-clean photo'), c.cue);
    assert.equal(c.submitOff, true);
  } finally { await t.close(); }
});
t0('R13 item 2: a dropped after-clean photo, with every earlier step complete (a mid-stay needs no kitchen photos), goes back to the Finish step and the cue names it', async () => {
  const t = await resumedAtLockUp(atLock({ cleaningType: 'mid_stay', confirmItems: { check_2_4: 'confirmed', check_7_5: 'confirmed', check_10_6: 'confirmed' }, aftercleanPhotoMeta: [up('a0.jpg'), up('a1.jpg'), up('a2.jpg'), dropped('a3.jpg')] }));
  try {
    const c = await cueOf(t);
    assert.equal(c.phase, 5, c.cue);
    assert.ok(c.cue.includes('1 more after-clean photo'), c.cue);
    assert.equal(c.submitOff, true);
  } finally { await t.close(); }
});
t0('R13 item 2: with nothing dropped the Resume stays at the step it was saved on', async () => {
  const t = await resumedAtLockUp(atLock());
  try { assert.equal((await cueOf(t)).phase, 6); } finally { await t.close(); }
});

/* ---- item 3 ---- */
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
t0('R13 item 3: storage stays full through the report; the carry key is gone after it, and once space is back a reload shows no key, no draft and no question', async () => {
  const t = await openPage({ answers: server({}) });
  try {
    await t.page.goto(t.s.url + '__blank', { waitUntil: 'domcontentloaded' });
    await seedCarry(t, 86400);
    await fillStorage(t, 400);   // room for the carry key, not for a draft
    await t.page.goto(t.s.url, { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => window.__s120 && window.__s120.state && window.__s120.state.restock, null, { timeout: 15000 });
    await t.page.waitForTimeout(700);
    assert.ok((await carryKey(t) || '').includes('rk-test'), 'the key is kept while no draft fits');
    assert.equal(await t.stored(), null, 'and no draft fits');
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(submits(t).length, 1);
    assert.equal(await carryKey(t), null, 'the report removed the carry key');
    await t.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fill')).forEach(k => localStorage.removeItem(k)));   // space is back
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => window.__s120 && window.__s120.state, null, { timeout: 15000 });
    await t.page.waitForTimeout(800);
    assert.equal(await carryKey(t), null, 'no key');
    assert.equal(await t.stored(), null, 'no draft');
    assert.equal(await t.page.evaluate(() => document.getElementById('draft-modal').classList.contains('open')), false, 'no Resume question');
    assert.equal(await t.page.evaluate(() => !!(__s120.state.restock && (__s120.state.restock.sent || __s120.state.restock.saved))), false, 'Restock is not marked saved or sent');
  } finally { await t.close(); }
});

/* ---- item 4 ---- */
t0('R13 item 4: a slow /last-readings and a second tap give one report', async () => {
  const srv = { holdPrev: true };
  const t = await open({ draft: quiet({ meterPhotoMeta: [null, null], precleanPhotoMeta: [] }), server: srv });
  try {
    await t.page.click('#btn-draft-resume'); await closed(t);
    await t.page.evaluate(() => { window.__first = __s120.runPreSubmitFlush(true); });
    for (let i = 0; i < 150 && !(srv.prevRoutes || []).length; i++) await t.page.waitForTimeout(100);
    assert.equal((srv.prevRoutes || []).length, 1, 'the first tap waits on /last-readings');
    await tap(t);   // the second tap while the first is still waiting
    await t.page.waitForTimeout(700);
    for (const r of srv.prevRoutes) await r.fulfill(json({}));
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    await t.page.waitForTimeout(500);
    assert.equal(submits(t).length, 1, 'one report');
  } finally { await t.close(); }
});

/* ---- items 5 and 6 ---- */
const toastBoxes = t => t.page.evaluate(() => Array.from(document.querySelectorAll('#toast-area .toast')).map(n => { const r = n.getBoundingClientRect(); return { text: n.textContent, left: r.left, right: r.right, width: innerWidth }; }));
t0('R13 item 5: at 320 px the "3 photos could not be kept" toast stays inside the screen', async () => {
  const t = await open({ draft: atLock({ meterPhotoMeta: [dropped('m0.jpg'), up('m1.jpg')], precleanPhotoMeta: [up('p0.jpg'), up('p1.jpg'), up('p2.jpg'), dropped('p3.jpg'), dropped('p4.jpg')] }), viewport: { width: 320, height: 640 }, server: { upload: 'ok' } });
  try {
    await t.page.click('#btn-draft-resume'); await closed(t);
    const b = (await toastBoxes(t)).find(x => x.text.includes('could not be kept'));
    assert.ok(b, 'the toast is showing');
    assert.ok(b.left >= 0 && b.right <= b.width, JSON.stringify(b));
  } finally { await t.close(); }
});
t0('R13 item 5 and 6: under a real quota limit four gallery photos show one keep-open toast, and it stays inside a 320 px screen', async () => {
  const t = await openBare({ server: { upload: 'fail' }, viewport: { width: 320, height: 640 } });
  try {
    await limitQuota(t, 1);
    const f = await jpeg(t);
    await t.page.setInputFiles('#afterclean-photo-file', [f, f, f, f]);
    await until(t, () => __s120.state.aftercleanPhotos.length === 4);
    const keep = (await toastBoxes(t)).filter(x => x.text === 'Keep this page open until the photo shows Uploaded.');
    assert.equal(keep.length, 1, 'one toast, not four');
    assert.ok(keep[0].left >= 0 && keep[0].right <= keep[0].width, JSON.stringify(keep[0]));
  } finally { await t.close(); }
});
