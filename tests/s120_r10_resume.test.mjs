// Session 120, lane R10: the fixes from the Opus browser review of Resume (R9), and the tests that make the mutants of R9 die.
// Real Chromium against the real checklist page (see s120_browser.mjs). The draft, the session and the server are made up; nothing leaves the machine.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { browserSuite, closeBrowser, openPage, draftOf, MANILA_TODAY } from './s120_browser.mjs';

const t0 = await browserSuite(test, assert);   // no Chromium = a failing test, unless S120_ALLOW_NO_BROWSER=1
after(async () => { await closeBrowser(); });

const FAIL = 'Your saved work could not be restored. It is still safe on this phone.';
const ITEMS = [['Bottled Water'], ['Coffee (3-in-1)'], ['Tea'], ['Sugar & Creamer Sticks'], ['Bathroom tissue'], ['Laundry Detergent'], ['Toiletries (toothbrush, toothpaste, soap)'], ['Kitchen towel'], ['Demo Soap']]
  .map(([name], n) => ({ id: 'id' + n, name, category: 'x', unit: 'bottle' }));
const LINEN = [{ id: 'lin1', name: 'Bath Towel', category: 'linen', unit: 'pc' }];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const HOUR = 3600000;
const BLOBS = ['idb-m0', 'idb-p1', 'idb-p2'];
const parse = s => JSON.parse(s);
const posts = (t, name) => t.calls.filter(c => c.method === 'POST' && c.url.includes(name));
const uploads = t => posts(t, '/upload-photo');
const sends = t => t.calls.filter(c => c.method === 'POST' && (c.url.includes('/rpc/record_inventory_usage') || c.url.includes('/rpc/record_linen_stains_v1')));
const photoMetas = d => ['meterPhotoMeta', 'precleanPhotoMeta', 'bedroomPhotoMeta', 'kitchenPhotoMeta', 'aftercleanPhotoMeta'].flatMap(k => d[k]).filter(Boolean);

/* the made-up server: o.upload = 'ok' | anything else (fails), o.send = 500 | anything else (ok). The caller may change o while the page runs. */
function server(o = {}) {
  return { handler: rec => {
    if (rec.url.includes('/rest/v1/inventory_items')) return json(rec.url.includes('is_consumable=eq.true') ? ITEMS : LINEN);
    if (rec.url.includes('/functions/v1/upload-photo')) return o.upload === 'ok' ? json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() }) : json({ ok: false }, 500);
    if (rec.url.includes('/rpc/record_inventory_usage') || rec.url.includes('/rpc/record_linen_stains_v1')) return o.send === 500 ? json({ message: 'down' }, 500) : json({ ok: true });
    return null;
  } };
}
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: false, tried: true, key: 'rk-test', failed: '', unavailable: false, legacy: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const linenOf = (over = {}) => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: false, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const withSends = (over = {}) => draftOf({ supplyLogSaved: true, restock: restockOf(over.restock), linen: linenOf(over.linen), confirmItems: { check_2_4: 'confirmed' }, confirmNotes: { check_2_4: 'Bath Towel: stain came out' }, ...(over.draft || {}) });
/* no send is waiting: Restock and linen are both already sent */
const quiet = (over = {}) => withSends({ restock: { sent: true, waiting: false, ...(over.restock || {}) }, linen: { sent: true, waiting: false, ...(over.linen || {}) }, draft: over.draft });

async function open(opts = {}) {
  const t = await openPage({ ...opts, answers: server(opts.server) });
  if (opts.clock) await t.page.clock.install({ time: opts.clock });
  await t.boot();
  await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
  return t;
}
const stored = t => t.stored();
const closed = t => t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
const failed = t => t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('could not be restored'), null, { timeout: 15000 });
const note = t => t.page.evaluate(() => { const n = document.getElementById('draft-modal-note'); return n && !n.hidden ? n.textContent : null; });
const slow = t => t.page.evaluate(() => { window.__gate = new Promise(r => { window.__release = r; }); });
const release = t => t.page.evaluate(() => window.__release());
const flag = (t, k, v) => t.page.evaluate(([k, v]) => { window[k] = v; }, [k, v]);
const idle = (t, ms = 900) => t.page.waitForTimeout(ms);
const deletes = async t => (await t.ops_()).filter(o => o.startsWith('delete'));
const until = (t, fn, arg) => t.page.waitForFunction(fn, arg, { timeout: 15000 });

/* ---- item 1: a storage error is not a missing photo ---- */
for (const how of ['__failOpen', '__failGet']) {
  t0(`R10 item 1: when the blob store ${how === '__failOpen' ? 'will not open' : 'cannot be read'}, Resume fails and touches nothing; a healthy reload and Resume uploads every photo`, async () => {
    const srv = { upload: 'ok' };
    const t = await open({ draft: draftOf(), blobs: BLOBS, server: srv });
    try {
      const before = await stored(t);
      await flag(t, how, true);
      await t.page.click('#btn-draft-resume');
      await failed(t);
      assert.equal(await note(t), FAIL, 'the failure view shows');
      await flag(t, how, false);
      assert.equal(await stored(t), before, 'the stored draft is byte-identical, every pending photo still names its blob');
      assert.deepEqual(await t.blobIds(), BLOBS.slice().sort(), 'every blob is still there');
      assert.equal((await deletes(t)).length, 0, 'nothing was deleted');
      assert.equal(uploads(t).length, 0, 'nothing was uploaded');
      assert.equal(parse(before).meterPhotoMeta[0].idbId, 'idb-m0');
      // a healthy reload: the same draft, Resume works, and every photo goes up
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await t.page.waitForSelector('#draft-modal.open');
      assert.equal(await stored(t), before, 'the reload found the draft as it was');
      await t.page.click('#btn-draft-resume');
      await closed(t);
      await until(t, () => window.__ops.filter(o => o.startsWith('delete')).length === 3);
      assert.equal(uploads(t).length, 3, 'all three pending photos uploaded');
      assert.deepEqual(await t.blobIds(), [], 'and their blobs are gone once the URLs are stored');
    } finally { await t.close(); }
  });
}

t0('R10 item 1 (R12 item 2): a blob that is confirmed absent empties only that photo slot and says so; Resume still succeeds', async () => {
  const t = await open({ draft: draftOf(), blobs: ['idb-p1', 'idb-p2'], server: { upload: 'ok' } });   // idb-m0 is not in the store
  try {
    await t.page.click('#btn-draft-resume');
    await closed(t);
    await until(t, () => window.__ops.filter(o => o.startsWith('delete')).length === 2);
    const d = parse(await stored(t));
    assert.equal(d.meterPhotoMeta[0], null, 'the photo with no blob is gone from the draft');
    assert.equal(await t.page.evaluate(() => __s120.state.meterPhotos[0]), null, 'and from its slot, so the meter step asks for it again');
    assert.equal(await t.page.evaluate(() => document.getElementById('toast-area').textContent.includes('1 photo could not be kept. Please retake it.')), true, 'the cleaner is told');
    assert.equal(await t.page.evaluate(() => document.getElementById('toast-area').textContent.includes('Session resumed')), false);
    assert.equal(photoMetas(d).filter(p => p.url).length, 3, 'p1, p2 and the already uploaded p3 hold URLs');
  } finally { await t.close(); }
});

/* ---- item 2: a failed blob delete never blocks the report ---- */
for (const mode of ['throw', 'abort']) {
  t0(`R10 item 2: when a blob delete ${mode}s, the pre-submit upload finishes, one report goes and the success screen shows`, async () => {
    const srv = { upload: 'fail' };
    const t = await open({ draft: quiet(), blobs: BLOBS, server: srv });
    try {
      await t.page.click('#btn-draft-resume');
      await closed(t);
      await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].status === 'failed' && __s120.state.precleanPhotos.filter(p => p.status === 'failed').length === 2);
      const before = uploads(t).length;
      srv.upload = 'ok';
      await flag(t, '__failDelete', mode);
      await t.page.evaluate(() => { window.__flushDone = __s120.runPreSubmitFlush(true); });
      await t.page.waitForSelector('#success-screen.visible', { timeout: 20000 });
      assert.equal(posts(t, '/functions/v1/submit-cleaning').length, 1, 'exactly one report');
      assert.equal(await t.page.evaluate(() => !document.getElementById('flush-overlay')?.classList.contains('visible')), true, 'the Uploading photos overlay is gone');
      assert.equal(uploads(t).length - before, 3, 'all three photos were uploaded first');
    } finally { await t.close(); }
  });
}

/* ---- item 3: nothing is written to the server during the hold ---- */
t0('R10 item 3: a slow Resume reports no progress and leaves ch_phase alone; the restored phase is reported once after the release', async () => {
  const t = await open({ draft: draftOf({ phase: 2 }), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    await t.page.evaluate(() => localStorage.setItem('ch_phase', '0'));
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await idle(t, 1000);
    assert.equal(posts(t, 'cleaning_progress_set_v1').length, 0, 'no progress request during the hold');
    assert.equal(await t.page.evaluate(() => localStorage.getItem('ch_phase')), '0', 'ch_phase is unchanged during the hold');
    await release(t);
    await closed(t);
    await until(t, () => localStorage.getItem('ch_phase') === '2');
    await idle(t, 500);
    const p = posts(t, 'cleaning_progress_set_v1');
    assert.equal(p.length, 1, 'one progress request after the release');
    assert.equal(parse(p[0].body).p_step, 3, 'step 3 = phase 2');
  } finally { await t.close(); }
});

t0('R10 item 3: a failed Resume reports nothing and leaves ch_phase as it was', async () => {
  const t = await open({ draft: draftOf({ phase: 2 }), blobs: BLOBS });
  try {
    await t.page.evaluate(() => { localStorage.setItem('ch_phase', '0'); window.__failRestore = true; });
    await t.page.click('#btn-draft-resume');
    await failed(t);
    await idle(t, 800);
    assert.equal(posts(t, 'cleaning_progress_set_v1').length, 0, 'no progress request');
    assert.equal(await t.page.evaluate(() => localStorage.getItem('ch_phase')), '0', 'ch_phase is unchanged');
  } finally { await t.close(); }
});

/* ---- item 4: tests for the mutants R9 let live ---- */
const noneRecord = (over = {}) => ({ name: 'm0.jpg', url: '', fileId: '', uploaded: false, status: 'failed', idbId: null, slot: null, takenAt: null, ...over });
/* s120R12: a record with no blob is dropped on restore, so a failed photo during a slow Resume is made in the page: an uploaded meter photo that is turned into one that failed with its bytes in memory */
const doneRecord = () => noneRecord({ url: 'https://drive.example.test/m0.jpg', fileId: 'f-m0', uploaded: true, status: 'done' });
const forceFailed = t => t.page.evaluate(() => { const p = __s120.state.meterPhotos[0]; p.uploaded = false; p.status = 'failed'; p.url = null; p.fileId = null; p._blob = new Blob([new Uint8Array(64).fill(7)], { type: 'image/jpeg' }); });

t0('R10 H4: the online event during a slow Resume does not requeue a failed photo until the hold is released', async () => {
  const t = await open({ draft: draftOf({ meterPhotoMeta: [doneRecord(), null] }), blobs: BLOBS });   // the meter photo needs no read, so it is back at once; the section photos keep the restore slow
  try {
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await until(t, () => __s120.state.meterPhotos[0]);
    await forceFailed(t);
    await t.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await idle(t, 500);
    assert.equal(await t.page.evaluate(() => __s120.state.meterPhotos[0].status), 'failed', 'not requeued while the draft is held');
    assert.equal(uploads(t).length, 0, 'no upload');
    await release(t);
    await closed(t);
  } finally { await t.close(); }
});

t0('R10 H5: the check of an already uploaded meter photo waits for the release, then asks once', async () => {
  const up = noneRecord({ url: 'https://drive.example.test/m0.jpg', fileId: 'f-m0', uploaded: true, status: 'done' });
  const t = await open({ draft: draftOf({ meterPhotoMeta: [up, null] }), blobs: BLOBS });
  try {
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].uploaded);
    await idle(t, 600);
    assert.equal(posts(t, '/functions/v1/verify-meter-photo').length, 0, 'no meter check while the draft is held');
    await release(t);
    await closed(t);
    await idle(t, 800);
    assert.equal(posts(t, '/functions/v1/verify-meter-photo').length, 1, 'one check after the release');
  } finally { await t.close(); }
});

t0('R10 H6: the resumed pre-submit run is queued during the hold and runs once after it', async () => {
  const t = await open({ draft: quiet(), blobs: BLOBS });
  try {
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await idle(t, 400);
    assert.equal(await t.page.evaluate(() => { __s120.state.pendingPreSubmit = true; __s120.S120R_resumePreSubmit(); return __s120.state.pendingPreSubmit; }), true, 'still pending: nothing ran during the hold');
    await release(t);
    await closed(t);
    await until(t, () => __s120.state.pendingPreSubmit === false);
  } finally { await t.close(); }
});

t0('R10 H8: the first save after a Resume holds the restored state; held work (a requeued failed photo) runs after it', async () => {
  const t = await open({ draft: draftOf({ meterPhotoMeta: [doneRecord(), null] }), blobs: BLOBS });
  try {
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await until(t, () => __s120.state.meterPhotos[0]);
    await forceFailed(t);
    await t.page.evaluate(() => window.dispatchEvent(new Event('online')));   // waits in the held work
    await release(t);
    await closed(t);
    const first = parse(await t.page.evaluate(() => window.__drafts[0]));
    assert.equal(first.meterPhotoMeta[0].status, 'failed', 'the release save was written before the held requeue ran');
  } finally { await t.close(); }
});

t0('R10 D3: when the save after an upload fails, the photo keeps naming its blob, and the blob goes after the next save that sticks', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    await flag(t, '__failSave', true);
    await t.page.click('#btn-draft-resume');
    await idle(t, 2500);
    assert.equal((await deletes(t)).length, 0, 'no blob is deleted while saves fail');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort());
    await flag(t, '__failSave', false);
    assert.equal(await t.page.evaluate(() => __s120.saveDraft()), true, 'a save sticks');
    await until(t, () => window.__ops.filter(o => o.startsWith('delete')).length === 3);
    assert.deepEqual(await t.blobIds(), [], 'every blob is deleted, none is left behind');
    const ops = await t.ops_();
    ops.forEach((o, i) => { if (o.startsWith('delete')) assert.ok(ops.slice(0, i).some(x => x.startsWith('draft:') && Number(x.slice(6)) >= 3), 'a delete came after a stored draft holding the URLs: ' + JSON.stringify(ops)); });
  } finally { await t.close(); }
});

async function jpeg(t) {
  const b64 = await t.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); for (let i = 0; i < 700; i++) { x.fillStyle = `hsl(${(i * 47) % 360},70%,${25 + (i * 13) % 50}%)`; x.fillRect((i * 37) % 900, (i * 91) % 700, 70, 50); } return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  return { name: 'cap.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
const resumed = async t => { await t.page.click('#btn-draft-resume'); await closed(t); await until(t, () => __s120.state.meterPhotos[0] && __s120.state.meterPhotos[0].status === 'failed'); };

t0('R10 D4: a meter retake deletes the old blob only after a save that sticks', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS, server: { upload: 'fail' } });
  try {
    await resumed(t);
    await flag(t, '__failSave', true);
    await t.page.setInputFiles('#meter-photo-0-cap', await jpeg(t));
    await until(t, () => __s120.state.meterPhotos[0].idbId && __s120.state.meterPhotos[0].idbId !== 'idb-m0');
    await idle(t, 600);
    assert.equal((await deletes(t)).includes('delete:idb-m0'), false, 'the old blob stays while the save fails');
    assert.ok((await t.blobIds()).includes('idb-m0'));
    // with saves working, the next retake deletes the blob it replaces, and only after the draft was stored
    await flag(t, '__failSave', false);
    const before = await t.page.evaluate(() => __s120.state.meterPhotos[0].idbId);
    await t.page.setInputFiles('#meter-photo-0-cap', await jpeg(t));
    await until(t, id => __s120.state.meterPhotos[0].idbId !== id, before);
    await until(t, id => window.__ops.includes('delete:' + id), before);
    const ops = await t.ops_(), at = ops.indexOf('delete:' + before);
    assert.ok(ops.slice(0, at).some(o => o.startsWith('draft:')), 'a draft was stored before the delete: ' + JSON.stringify(ops));
  } finally { await t.close(); }
});

t0('R10 D5: removing a section photo deletes its blob only after a save that sticks', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS, server: { upload: 'fail' } });
  try {
    await resumed(t);
    await flag(t, '__failSave', true);
    await t.page.evaluate(() => document.querySelector('[title="Tap the photo to remove it"]').click());
    await idle(t, 600);
    assert.equal((await deletes(t)).includes('delete:idb-p1'), false, 'the blob stays while the save fails');
    assert.ok((await t.blobIds()).includes('idb-p1'));
    await flag(t, '__failSave', false);
    await t.page.evaluate(() => document.querySelector('[title="Tap the photo to remove it"]').click());   // the next photo (p2)
    await until(t, () => window.__ops.includes('delete:idb-p2'));
    const ops = await t.ops_();
    assert.ok(ops.slice(0, ops.indexOf('delete:idb-p2')).some(o => o.startsWith('draft:')), 'a draft was stored before the delete: ' + JSON.stringify(ops));
  } finally { await t.close(); }
});

/* the stamp is the send's own time: set once, stored before the request goes out, never moved by a later try */
for (const [which, rpc] of [['linen', 'record_linen_stains_v1'], ['restock', 'record_inventory_usage']]) {
  const draftFor = stamp => which === 'linen'
    ? quiet({ restock: {}, linen: { sent: false, tried: true, waiting: false, sendStartedAt: stamp } })
    : quiet({ restock: { sent: false, tried: true, waiting: true, sendStartedAt: stamp } });
  const fire = t => which === 'linen' ? t.page.evaluate(() => __s120.S120R_flushAll(false, false)) : Promise.resolve();   // a Restock goes out by itself once the hold is released

  t0(`R10 S: the ${which} stamp of an earlier try is kept by a later try, in the request's draft and after it`, async () => {
    const old = Date.now() - 3 * HOUR;
    const t = await open({ draft: draftFor(old), blobs: [] });
    try {
      await t.page.click('#btn-draft-resume'); await closed(t);
      await fire(t);
      await until(t, () => window.__atSend.some(a => a.url.includes('/rpc/record_')));
      await idle(t, 800);
      const at = parse(await t.page.evaluate(() => window.__atSend.find(a => a.url.includes('/rpc/record_')).draft));
      assert.equal(at[which].sendStartedAt, old, 'the request left with the old stamp stored');
      assert.equal(parse(await stored(t))[which].sendStartedAt, old, 'and it is still the old stamp afterwards');
      assert.equal(posts(t, rpc).length, 1);
    } finally { await t.close(); }
  });

  t0(`R10 S: the first ${which} try stores its stamp and lock before the request goes out`, async () => {
    const t = await open({ draft: draftFor(null), blobs: [] });
    try {
      const start = Date.now();
      await t.page.click('#btn-draft-resume'); await closed(t);
      await fire(t);
      await until(t, () => window.__atSend.some(a => a.url.includes('/rpc/record_')));
      const at = parse(await t.page.evaluate(() => window.__atSend.find(a => a.url.includes('/rpc/record_')).draft));
      assert.ok(at[which].sendStartedAt >= start - 5000 && at[which].sendStartedAt <= Date.now(), 'the stamp was already stored when the request left: ' + at[which].sendStartedAt);
      assert.equal(at[which].tried, true, 'locked');
      assert.equal(at[which].waiting, false, 'no longer waiting');
    } finally { await t.close(); }
  });
}

/* carry-over by the send's own stamp, with the page's clock fixed so the answer does not depend on the hour the test runs */
const manila = (days, h, mi) => { const [y, m, d] = MANILA_TODAY().split('-').map(Number); return Date.UTC(y, m - 1, d + days, h - 8, mi); };
async function freshAt(now, stamp) {
  const t = await open({ clock: now, draft: withSends({ restock: { sendStartedAt: stamp }, linen: { sendStartedAt: stamp }, draft: { _saved: now } }), server: { send: 500 } });
  await t.page.click('#btn-draft-fresh');
  await closed(t);
  await t.page.waitForTimeout(600);
  return t;
}
const keptKey = async t => { const s = await stored(t); const d = s && parse(s); return d && d.restock ? [d.restock.key, d.linen && d.linen.key] : null; };

t0('R10 S6: a send of an earlier Manila day that is over 6 hours old (19 hours) is not carried over', async () => {
  const t = await freshAt(manila(0, 15, 0), manila(-1, 20, 0));
  try { assert.notDeepEqual(await keptKey(t), ['rk-test', 'lk-test']); assert.equal(sends(t).length, 0); } finally { await t.close(); }
});
t0('R10 S7: a send of the same Manila day is carried over even when it is over 6 hours old (13 hours)', async () => {
  const t = await freshAt(manila(0, 15, 0), manila(0, 2, 0));
  try { assert.deepEqual(await keptKey(t), ['rk-test', 'lk-test']); } finally { await t.close(); }
});
t0('R10 S6/S7: across midnight a send 5 hours 50 minutes old is carried over, one 6 hours 10 minutes old is not', async () => {
  const a = await freshAt(manila(0, 1, 0), manila(-1, 19, 10));
  try { assert.deepEqual(await keptKey(a), ['rk-test', 'lk-test']); } finally { await a.close(); }
  const b = await freshAt(manila(0, 1, 20), manila(-1, 19, 10));
  try { assert.notDeepEqual(await keptKey(b), ['rk-test', 'lk-test']); } finally { await b.close(); }
});

/* ---- item 5: Start fresh with the storage full ---- */
const freshDraft = () => withSends({ restock: { sendStartedAt: Date.now() - 5 * 60000 }, linen: { sendStartedAt: Date.now() - 5 * 60000 }, draft: { _saved: Date.now() } });
t0('R10 item 5: Start fresh after a failed Resume with the storage full (the carry key fits only once the draft is gone) still carries the sends', async () => {
  const t = await open({ draft: freshDraft(), blobs: BLOBS, server: { send: 500 } });
  try {
    await t.page.evaluate(() => { window.__failRestore = true; window.__fullCarry = 'until-cleared'; });
    await t.page.click('#btn-draft-resume');
    await failed(t);
    await t.page.click('#btn-draft-fresh');
    await t.page.waitForFunction(() => (localStorage.getItem('ch_draft_v6') || '').includes('rk-test'), null, { timeout: 15000 });
    assert.deepEqual(await keptKey(t), ['rk-test', 'lk-test'], 'the keys came back after the reload');
    assert.equal(await t.page.evaluate(() => localStorage.getItem('ch_s120_carry')), null, 'the carry key is used up');
  } finally { await t.close(); }
});

t0('R10 item 5: when the carry key cannot be stored at all, nothing is lost: the draft stays and the cleaner is told', async () => {
  const t = await open({ draft: freshDraft(), blobs: BLOBS, server: { send: 500 } });
  try {
    const before = await stored(t);
    await t.page.evaluate(() => { window.__failRestore = true; window.__fullCarry = 'always'; });
    await t.page.click('#btn-draft-resume');
    await failed(t);
    await t.page.click('#btn-draft-fresh');
    await t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('not enough space'), null, { timeout: 15000 });
    assert.equal(await stored(t), before, 'the draft is as it was');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort(), 'no blob was deleted');
    assert.equal(await t.page.evaluate(() => document.getElementById('draft-modal').classList.contains('open')), true, 'the modal stays open');
  } finally { await t.close(); }
});

/* ---- item 6: an uploaded photo whose blob could not be deleted ---- */
for (const reload of [false, true]) t0(`R10 item 6${reload ? ' (R11 item 3: after a reload)' : ''}: a failed delete keeps the id in the stored draft; the next save that sticks deletes the blob and clears the id`, async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    await flag(t, '__failDelete', 'throw');
    await t.page.click('#btn-draft-resume');
    await closed(t);
    await until(t, () => window.__atSend.filter(a => a.url.includes('/upload-photo')).length === 3);
    await idle(t, 1200);
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort(), 'no blob could be deleted');
    const d = parse(await stored(t));
    const withBoth = photoMetas(d).filter(p => p.url && p.idbId);
    assert.equal(withBoth.length, 3, 'each uploaded photo holds its URL and still names its blob: ' + JSON.stringify(photoMetas(d)));
    if (reload) {   // R11 item 3: a reload must not forget the blobs of uploaded photos: Resume keeps their ids, so the save after it sweeps them
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await t.page.waitForSelector('#draft-modal.open');
      await t.page.click('#btn-draft-resume');
      await closed(t);
    }
    await flag(t, '__failDelete', null);
    assert.equal(await t.page.evaluate(() => __s120.saveDraft()), true);
    await t.page.waitForFunction(() => !(localStorage.getItem('ch_draft_v6') || '').match(/"idbId":"idb-/), null, { timeout: 15000 });
    assert.deepEqual(await t.blobIds(), [], 'the blobs are gone');
  } finally { await t.close(); }
});

/* ---- items 7 and 8: disabled look and focus ---- */
const rgb = c => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const scheme of ['light', 'dark']) {
  t0(`R10 item 7: the disabled buttons look disabled in the ${scheme} setting: muted, no pointer, readable`, async () => {
    const t = await open({ draft: draftOf(), blobs: BLOBS });
    try {
      await t.page.emulateMedia({ colorScheme: scheme });
      const live = id => t.page.evaluate(i => { const s = getComputedStyle(document.getElementById(i)); return { bg: s.backgroundColor, color: s.color, cursor: s.cursor, opacity: s.opacity, disabled: document.getElementById(i).disabled }; }, id);
      const enabled = await live('btn-draft-resume');
      await slow(t);
      await t.page.click('#btn-draft-resume');
      await t.page.waitForFunction(() => document.getElementById('btn-draft-resume').disabled);
      // Under load the colours are read mid-transition otherwise; the settled colours are what the cleaner sees.
      await t.page.evaluate(() => Promise.allSettled(document.getAnimations().map(a => a.finished)));
      const off = await live('btn-draft-resume'), offFresh = await live('btn-draft-fresh');
      for (const b of [off, offFresh]) {
        assert.equal(b.disabled, true);
        assert.equal(b.cursor, 'default', 'no pointer on a button that does nothing');
        assert.equal(b.opacity, '1', 'muted by colour, not by fading the primary colour');
        assert.ok(ratio(b.color, b.bg) >= 4.5, 'the text stays readable: ' + JSON.stringify(b));
      }
      assert.notEqual(off.bg, enabled.bg, 'the disabled Resume no longer has the primary colour');
      assert.equal(enabled.cursor, 'pointer');
      await release(t);
    } finally { await t.close(); }
  });
}

t0('R10 item 8: focus goes to the safe main button, Resume on the question and Try again on failure, never Start fresh', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS });
  try {
    const active = () => t.page.evaluate(() => document.activeElement && document.activeElement.id);
    await t.page.waitForFunction(() => document.getElementById('draft-modal').contains(document.activeElement));
    assert.equal(await active(), 'btn-draft-resume', 'Enter on the question must not discard the draft');
    await t.page.evaluate(() => { window.__failRestore = true; });
    await t.page.click('#btn-draft-resume');
    await failed(t);
    await t.page.waitForFunction(() => document.getElementById('draft-modal').contains(document.activeElement));
    assert.equal(await active(), 'btn-draft-retry', 'Enter on the failure view must not discard the draft');
  } finally { await t.close(); }
});
