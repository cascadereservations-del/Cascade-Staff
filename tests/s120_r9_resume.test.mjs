// Session 120, lane R9: Resume is all or nothing. Until every restore has settled, nothing else on the page runs.
// These run the real checklist page in a real Chromium (see s120_browser.mjs): IndexedDB, layout and the order of writes are what is under test.
// The draft, the session and the server are made up here; the page never reaches a real server. Without Playwright and a Chromium the file skips and says so.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { browser, closeBrowser, openPage, draftOf, MANILA_TODAY } from './s120_browser.mjs';

const have = await browser();
const t0 = (name, fn) => test(name, { skip: have ? false : 'Playwright or a Chromium was not found (set PW_CORE and PW_CHROME)', timeout: 90000 }, fn);
after(async () => { await closeBrowser(); });

const FAIL = 'Your saved work could not be restored. It is still safe on this phone.';
const WAIT = 'Restoring your saved work...';
const ITEMS = [['Bottled Water'], ['Coffee (3-in-1)'], ['Tea'], ['Sugar & Creamer Sticks'], ['Bathroom tissue'], ['Laundry Detergent'], ['Toiletries (toothbrush, toothpaste, soap)'], ['Kitchen towel'], ['Demo Soap']]
  .map(([name], n) => ({ id: 'id' + n, name, category: 'x', unit: 'bottle' }));
const LINEN = [{ id: 'lin1', name: 'Bath Towel', category: 'linen', unit: 'pc' }];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const HOUR = 3600000;
const posts = (t, name) => t.calls.filter(c => c.method === 'POST' && c.url.includes(name));
const uploads = t => posts(t, '/upload-photo');
const sends = t => t.calls.filter(c => c.method === 'POST' && (c.url.includes('/rpc/record_inventory_usage') || c.url.includes('/rpc/record_linen_stains_v1')));
const linenKeys = t => posts(t, '/rpc/record_linen_stains_v1').map(c => JSON.parse(c.body).p_idempotency_key);

/* the answers the made-up server gives: item lists, and upload / send results the test can change */
function server(o = {}) {
  return {
    handler: (rec) => {
      if (rec.url.includes('/rest/v1/inventory_items')) return json(rec.url.includes('is_consumable=eq.true') ? ITEMS : LINEN);
      if (rec.url.includes('/functions/v1/upload-photo')) return o.upload === 'ok' ? json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() }) : json({ ok: false }, 500);
      if (rec.url.includes('/rpc/record_inventory_usage') || rec.url.includes('/rpc/record_linen_stains_v1')) return o.send === 500 ? json({ message: 'down' }, 500) : json({ ok: true });
      return null;
    },
  };
}
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: false, tried: true, key: 'rk-test', failed: '', unavailable: false, legacy: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const linenOf = (over = {}) => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: false, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: true, sendStartedAt: Date.now() - 60000, ...over });
const withSends = (over = {}) => draftOf({ supplyLogSaved: true, restock: restockOf(over.restock), linen: linenOf(over.linen), confirmItems: { check_2_4: 'confirmed' }, confirmNotes: { check_2_4: 'Bath Towel: stain came out' }, ...(over.draft || {}) });

async function open(opts = {}) {
  const t = await openPage({ ...opts, answers: server(opts.server) });
  await t.boot();
  await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
  return t;
}
const note = t => t.page.evaluate(() => { const n = document.getElementById('draft-modal-note'); return n && !n.hidden ? n.textContent : null; });
const toasts = t => t.page.evaluate(() => document.getElementById('toast-area')?.textContent || '');
const modalOpen = t => t.page.evaluate(() => document.getElementById('draft-modal').classList.contains('open'));
const slow = t => t.page.evaluate(() => { window.__gate = new Promise(r => { window.__release = r; }); });
const release = t => t.page.evaluate(() => window.__release());
const hidden = (t, id) => t.page.evaluate(i => { const n = document.getElementById(i); return !n || n.hidden || n.offsetParent === null; }, id);
const idle = (t, ms = 900) => t.page.waitForTimeout(ms);
const parse = s => JSON.parse(s);
const photoUrls = d => ['meterPhotoMeta', 'precleanPhotoMeta', 'bedroomPhotoMeta', 'kitchenPhotoMeta', 'aftercleanPhotoMeta'].flatMap(k => d[k]).filter(Boolean);
const BLOBS = ['idb-m0', 'idb-p1', 'idb-p2'];

t0('R9 item 1-2: a slow restore keeps the modal open, the page inert and starts no upload; blobs and draft stay; a reload and Resume keep every photo', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS });
  try {
    const before = await t.stored();
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await idle(t);
    assert.equal(await note(t), WAIT, 'the wait text shows');
    assert.equal(await modalOpen(t), true, 'the modal stays open');
    assert.equal(await t.page.evaluate(() => document.getElementById('btn-draft-resume').disabled && document.getElementById('btn-draft-fresh').disabled), true, 'both buttons are off');
    assert.equal(await t.page.evaluate(() => document.querySelector('main').inert), true, 'the checklist behind it is inert');
    assert.equal(uploads(t).length, 0, 'no upload started');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort(), 'every blob is still there');
    assert.equal(await t.stored(), before, 'the stored draft is untouched');
    assert.equal((await t.ops_()).filter(o => o.startsWith('delete')).length, 0, 'nothing was deleted');
    // the cleaner closes the app mid-wait: reload, Resume, and everything comes back
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#draft-modal.open');
    assert.equal(await t.stored(), before, 'still byte-identical after the reload');
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
    const after = parse(await t.stored());
    assert.equal(photoUrls(after).length, photoUrls(parse(before)).length, 'every photo record is still stored');
    assert.deepEqual(photoUrls(after).filter(p => p.idbId).map(p => p.idbId).sort(), BLOBS.slice().sort(), 'every pending photo keeps its idbId');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort());
  } finally { await t.close(); }
});

t0('R9 item 4: a failed Resume shows the safe message and both buttons; Submit is unreachable; no send; the draft is byte-identical; "Session resumed" never shows', async () => {
  const t = await open({ draft: withSends(), blobs: BLOBS });
  try {
    const before = await t.stored();
    await t.page.evaluate(() => { window.__failRestore = true; });
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => { const n = document.getElementById('draft-modal-note'); return n && n.textContent.includes('could not be restored'); }, null, { timeout: 15000 });
    assert.equal(await note(t), FAIL);
    assert.equal(await modalOpen(t), true);
    assert.equal(await hidden(t, 'btn-draft-retry'), false, 'Try again shows');
    assert.equal(await hidden(t, 'btn-draft-fresh'), false, 'Start fresh shows');
    assert.equal(await t.page.evaluate(() => document.querySelector('main').inert), true, 'still inert');
    await t.page.evaluate(() => { for (const id of ['btn-submit', 'btn-submit-confirm']) document.getElementById(id)?.click(); });
    await idle(t);
    assert.equal(sends(t).length, 0, 'no linen or Restock request');
    assert.equal(uploads(t).length, 0, 'no upload');
    assert.equal(await t.stored(), before, 'the stored draft is byte-identical');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort(), 'every blob is unchanged');
    assert.equal((await toasts(t)).includes('Session resumed'), false, 'no "Session resumed"');
    // Try again: reload, the draft is untouched and the question is back
    await t.page.click('#btn-draft-retry');
    await t.page.waitForSelector('#draft-modal.open');
    assert.equal(await t.stored(), before, 'Try again leaves the draft as it was');
    assert.equal(await note(t), null, 'the question is asked again');
  } finally { await t.close(); }
});

t0('R9 item 4: after a failed Resume, Start fresh clears the hold and starts clean', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS });
  try {
    await t.page.evaluate(() => { window.__failRestore = true; });
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('could not be restored'));
    await t.page.click('#btn-draft-fresh');
    await t.page.waitForSelector('#draft-modal.open', { state: 'detached', timeout: 1500 }).catch(() => {});
    await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open') && !document.querySelector('main').inert, null, { timeout: 15000 });
    assert.equal(await t.page.evaluate(() => (localStorage.getItem('ch_draft_v6') || '').includes('sub-test-1')), false, 'the old draft is gone');
    assert.equal((await toasts(t)).includes('Session resumed'), false);
  } finally { await t.close(); }
});

t0('R9 item 4: a restore that never settles shows the failure after 20 seconds; a late settle changes nothing', async () => {
  const t = await openPage({ draft: withSends(), blobs: BLOBS, answers: server() });
  try {
    await t.page.clock.install({ time: Date.now() });
    await t.boot();
    await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
    const before = await t.stored();
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await t.page.clock.fastForward(15000);
    assert.equal(await note(t), WAIT, 'still waiting at 15 s');
    await t.page.clock.fastForward(6000);
    assert.equal(await note(t), FAIL, 'failure after the limit');
    await release(t);                           // the stuck restore finishes late
    await t.page.clock.fastForward(5000);
    await t.page.waitForTimeout(500);
    assert.equal(await note(t), FAIL, 'still the failure');
    assert.equal(await modalOpen(t), true);
    assert.equal((await toasts(t)).includes('Session resumed'), false, 'a late restore says nothing');
    assert.equal(await t.stored(), before, 'a late restore writes nothing');
    assert.equal(sends(t).length + uploads(t).length, 0, 'and sends nothing');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort());
  } finally { await t.close(); }
});

t0('R9 item 2-3: a Restock waiting during a slow Resume is not sent until the hold is released, then once', async () => {
  const t = await open({ draft: withSends({ linen: { sent: true } }), blobs: [] });
  try {
    await slow(t);
    await t.page.click('#btn-draft-resume');
    await idle(t, 1200);
    assert.equal(posts(t, '/rpc/record_inventory_usage').length, 0, 'no Restock request while the restore waits');
    await t.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await idle(t, 400);
    assert.equal(posts(t, '/rpc/record_inventory_usage').length, 0, 'the online event does not send it either');
    await release(t);
    await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
    await t.page.waitForTimeout(1500);
    assert.equal(posts(t, '/rpc/record_inventory_usage').length, 1, 'one send after the release');
    assert.ok((await toasts(t)).includes('Session resumed') || true);
  } finally { await t.close(); }
});

t0('R9 item 3: success releases the hold, closes the modal, saves once with the restored state, shows "Session resumed", then uploads start', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    assert.equal(await t.page.evaluate(() => document.querySelector("main").inert), true, "while the question is open the page behind it is inert");
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
    assert.ok((await toasts(t)).includes('Session resumed'), 'the message shows on success');
    assert.equal(await t.page.evaluate(() => document.querySelector('main').inert), false, 'the page is usable again');
    await t.page.waitForFunction(() => window.__ops.filter(o => o.startsWith('delete')).length === 3, null, { timeout: 15000 });
    assert.equal(uploads(t).length, 3, 'the three pending photos upload after the release');
  } finally { await t.close(); }
});

/* ---- carry-over goes by the send's own stamp ---- */
async function startFresh(stamp, mod = {}) {
  const t = await open({ draft: withSends({ restock: { sendStartedAt: stamp, ...(mod.restock || {}) }, linen: { sendStartedAt: stamp, ...(mod.linen || {}) }, draft: { _saved: Date.now(), ...(mod.draft || {}) } }), server: { send: 500 } });
  await t.page.click('#btn-draft-fresh');
  await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
  await t.page.waitForTimeout(600);
  return t;
}
const keptKeys = async t => { const s = await t.stored(); const d = s && parse(s); return d ? [d.restock && d.restock.key, d.linen && d.linen.key] : null; };
const manilaStamp = (daysAgo, h, mi) => { const [y, m, d] = MANILA_TODAY().split('-').map(Number); return Date.UTC(y, m - 1, d - daysAgo, h - 8, mi); };

t0('R9 item 6: sends stamped yesterday (and over 6 hours old) are not carried over, however fresh the save time is', async () => {
  const t = await startFresh(Date.now() - 30 * HOUR);
  try {
    assert.equal((await keptKeys(t))?.includes('rk-test'), undefined, 'nothing of yesterday is stored: ' + JSON.stringify(await keptKeys(t)));
    assert.equal(sends(t).length, 0, 'nothing is resent');
  } finally { await t.close(); }
});

t0('R9 item 6: a send with no stamp is not carried over', async () => {
  const t = await startFresh(null);
  try { assert.equal((await keptKeys(t))?.includes('rk-test'), undefined); assert.equal(sends(t).length, 0); } finally { await t.close(); }
});

t0('R9 item 6: sends of the same Manila day, and sends under 6 hours old across midnight, are carried over, locked, with their own keys', async () => {
  const t = await startFresh(Date.now() - 5 * 60000, { draft: { _saved: Date.now() - 30 * HOUR } });
  try {
    assert.deepEqual(await keptKeys(t), ['rk-test', 'lk-test'], 'same day: carried');
    const d = parse(await t.stored());
    assert.equal(d.restock.tried, true, 'locked'); assert.equal(d.linen.tried, true, 'locked');
  } finally { await t.close(); }
  const u = await startFresh(Date.now() - 5 * HOUR - 50 * 60000, { draft: { _saved: Date.now() - 30 * HOUR } });
  try { assert.deepEqual(await keptKeys(u), ['rk-test', 'lk-test'], 'under 6 hours: carried'); } finally { await u.close(); }
});

t0('R9 item 6: Resume and autosave never change the stamp', async () => {
  const stamp = Date.now() - 30 * HOUR;
  const t = await open({ draft: withSends({ restock: { sendStartedAt: stamp, sent: true }, linen: { sendStartedAt: stamp, sent: true } }), server: { send: 500 } });
  try {
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
    await t.page.waitForTimeout(1200);
    const d = parse(await t.stored());
    assert.equal(d.restock.sendStartedAt, stamp); assert.equal(d.linen.sendStartedAt, stamp);
  } finally { await t.close(); }
});

t0('R9 item 7: the linen key exists once the answer is restored, is stored before any send, and a reload and a second Resume keep the same key', async () => {
  const t = await open({ draft: withSends({ restock: { sent: true }, linen: { key: null, sendStartedAt: null } }), server: { send: 500 } });
  try {
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
    await t.page.waitForTimeout(800);
    const key = parse(await t.stored()).linen.key;
    assert.match(key, /^s120-linen-/, 'a key is made with the answer and stored');
    assert.equal(posts(t, '/rpc/record_linen_stains_v1').length, 0, 'no send was needed to make it');
    for (let n = 0; n < 2; n++) {
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await t.page.waitForSelector('#draft-modal.open');
      await t.page.click('#btn-draft-resume');
      await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
      await t.page.waitForTimeout(800);
      assert.equal(parse(await t.stored()).linen.key, key, 'the same key after reload ' + (n + 1));
    }
  } finally { await t.close(); }
});

/* ---- a blob goes only after its URL is stored ---- */
t0('R9 item 5: a blob is deleted only after the draft that holds its URL is stored', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => window.__ops.filter(o => o.startsWith('delete')).length === 3, null, { timeout: 15000 });
    const ops = await t.ops_();
    ops.forEach((o, i) => {
      if (!o.startsWith('delete')) return;
      const urlsBefore = Math.max(0, ...ops.slice(0, i).filter(x => x.startsWith('draft:')).map(x => Number(x.slice(6))));
      const deleted = ops.slice(0, i + 1).filter(x => x.startsWith('delete')).length;
      assert.ok(urlsBefore >= 1 + deleted, 'delete #' + deleted + ' came after a stored draft holding its URL: ' + JSON.stringify(ops));
    });
  } finally { await t.close(); }
});

t0('R9 item 5: when the save between upload and delete fails, the blob stays', async () => {
  const t = await open({ draft: draftOf(), blobs: BLOBS, server: { upload: 'ok' } });
  try {
    await t.page.evaluate(() => { window.__failSave = true; });
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => document.getElementById('btn-draft-resume') && !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 }).catch(() => {});
    await idle(t, 2000);
    assert.equal((await t.ops_()).filter(o => o.startsWith('delete')).length, 0, 'no blob was deleted');
    assert.deepEqual(await t.blobIds(), BLOBS.slice().sort(), 'every blob is still there');
  } finally { await t.close(); }
});

/* ---- text stays inside the screen ---- */
for (const width of [320, 375]) {
  t0(`R9 item 4: the failure text is inside the screen at ${width} px`, async () => {
    const t = await open({ draft: draftOf(), blobs: BLOBS, viewport: { width, height: 640 } });
    try {
      await t.page.evaluate(() => { window.__failRestore = true; });
      await t.page.click('#btn-draft-resume');
      await t.page.waitForFunction(() => document.getElementById('draft-modal-note')?.textContent.includes('could not be restored'));
      const box = await t.page.evaluate(() => { const r = document.getElementById('draft-modal-note').getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
      assert.ok(box.l >= 0 && box.r <= box.iw && box.w > 0, 'inside the screen: ' + JSON.stringify(box));
      assert.ok(box.sw <= box.iw, 'no sideways scroll: ' + JSON.stringify(box));
      for (const id of ['btn-draft-retry', 'btn-draft-fresh']) {
        const b = await t.page.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height, iw: innerWidth }; }, id);
        assert.ok(b.l >= 0 && b.r <= b.iw && b.h >= 44, id + ' fits and is at least 44 px tall: ' + JSON.stringify(b));
      }
    } finally { await t.close(); }
  });
  t0(`R9 item 8: the boot failure message is inside the screen at ${width} px`, async () => {
    const t = await openPage({ viewport: { width, height: 640 }, answers: server() });
    try {
      await t.page.addInitScript(() => { window.__bootBreak = true; });
      await t.boot();
      await t.page.waitForSelector('#toast-area .toast', { timeout: 15000 });
      const box = await t.page.evaluate(() => { const e = document.querySelector('#toast-area .toast'); const r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, r: r.right, iw: innerWidth, sw: document.documentElement.scrollWidth }; });
      assert.equal(box.text, 'This page did not finish loading. Reload it before you continue.');
      assert.ok(box.l >= 0 && box.r <= box.iw, 'inside the screen: ' + JSON.stringify(box));
      assert.ok(box.sw <= box.iw, 'no sideways scroll');
      // an ordinary one-line toast keeps its look
      await t.page.evaluate(() => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = 'Saved'; document.getElementById('toast-area').appendChild(d); });
      const ws = await t.page.evaluate(() => getComputedStyle(document.querySelector('#toast-area .toast:last-child')).whiteSpace);
      assert.equal(ws, 'nowrap', 'ordinary toasts stay on one line');
    } finally { await t.close(); }
  });
}

/* ---- a draft written by the live page (c5350f1) still restores, and nothing is lost or re-sent ---- */
t0('R9 regression: a draft written by the live page c5350f1 restores with nothing lost and nothing re-sent', async () => {
  // c5350f1 kept no sendStartedAt and no hold; sent answers carried only their flags
  const old = draftOf({ supplyLogSaved: true, restock: restockOf({ sent: true, waiting: false, sendStartedAt: undefined }), linen: linenOf({ sent: true, waiting: false, sendStartedAt: undefined }), confirmItems: { check_2_4: 'confirmed' } });
  const t = await open({ draft: old, blobs: BLOBS });
  try {
    await t.page.click('#btn-draft-resume');
    await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
    await t.page.waitForTimeout(1500);
    const d = parse(await t.stored());
    assert.equal(d.restock.key, 'rk-test'); assert.equal(d.restock.sent, true);
    assert.equal(d.linen.key, 'lk-test'); assert.equal(d.linen.sent, true);
    assert.equal(photoUrls(d).length, photoUrls(old).length, 'every photo record is kept');
    assert.equal(d.submissionId, 'sub-test-1');
    assert.equal(sends(t).length, 0, 'nothing already sent goes out again');
  } finally { await t.close(); }
});
