// Session 124, lane L3: a photo held at a reload and not uploaded blocks Submit, is named, and counts in photos_failed. Real Chromium against the real checklist page.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserSuite, closeBrowser, openPage, draftOf } from './s120_browser.mjs';

const t0 = await browserSuite(test, assert);
after(async () => { await closeBrowser(); });

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const submits = t => t.calls.filter(c => c.method === 'POST' && c.url.includes('/submit-cleaning') && !c.failed);
const server = () => ({ handler: (rec) => {
  if (rec.url.includes('/rest/v1/inventory_items')) return json([]);
  if (rec.url.includes('/functions/v1/upload-photo')) return json({ ok: true, path: 'p/' + Math.random(), signedUrl: 'https://drive.example.test/up-' + Math.random() });
  if (rec.url.includes('/rpc/')) return json({ ok: true });
  return null;
} });
const up = name => ({ name, url: 'https://drive.example.test/' + name, fileId: 'f-' + name, uploaded: true, status: 'done', idbId: null, slot: null, takenAt: null });
const five = prefix => [0, 1, 2, 3, 4].map(n => up(prefix + n + '.jpg'));
const restockOf = (over = {}) => ({ top: { id2: 2 }, kit: { a: 'no', n: null }, extras: {}, other: {}, elseText: '', none: false, saved: true, sent: true, tried: true, key: 'rk-test', failed: '', unavailable: false, ...over });
const linenOf = () => ({ answer: 'found', rows: [{ item_id: 'lin1', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk-test', sent: true, tried: true, failed: '', legacyNote: '', unavailable: false, waiting: false });
const base = { phase: 6, electricReading: '100', waterReading: '10', supplyLogSaved: true, restock: restockOf(), linen: linenOf(), confirmItems: { check_2_4: 'confirmed', check_7_5: 'issue' }, confirmNotes: { check_2_4: 'Bath Towel: stain came out', check_7_5: 'Smell by the bin' }, aftercleanPhotoMeta: five('a'),
  meterPhotoMeta: [up('m0.jpg'), up('m1.jpg')], precleanPhotoMeta: five('p'), bedroomPhotoMeta: [], kitchenPhotoMeta: [] };
async function open(over) {
  const t = await openPage({ draft: draftOf({ ...base, ...over }), answers: server() });
  await t.boot();
  await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
  await t.page.click('#btn-draft-resume');
  await t.page.waitForFunction(() => !document.getElementById('draft-modal').classList.contains('open'), null, { timeout: 15000 });
  return t;
}
const tap = t => t.page.evaluate(() => __s120.runPreSubmitFlush(true));
const statusText = t => t.page.evaluate(() => document.getElementById('submit-status')?.textContent || '');
const failedOf = t => JSON.parse(submits(t)[0].body).diagnostics.photos_failed;
const held = { issueFlags: { check_7_5: { note: 'Smell by the bin', photoUrl: '', photoFileId: '', photoHeld: true } }, conditionPhotoHeld: true };

t0('L3: a damage photo and a condition photo held at a reload stop the first Submit and name both', async () => {
  const t = await open(held);
  try {
    await tap(t);
    assert.equal(submits(t).length, 0, 'the first tap stops');
    const msg = await statusText(t);
    assert.ok(msg.includes('Retake these photos: Flush and smell-check the toilet, Condition.'), msg);
    assert.ok((await t.page.evaluate(() => document.getElementById('toast-area')?.textContent || '')).includes('Retake these photos'));
  } finally { await t.close(); }
});

t0('L3: after the stop a second tap sends and photos_failed counts the two photos', async () => {
  const t = await open(held);
  try {
    await tap(t);
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(failedOf(t), 2);
  } finally { await t.close(); }
});

t0('L3: one held photo names itself alone, and a retake clears the stop', async () => {
  const t = await open({ issueFlags: { check_7_5: { note: 'Smell by the bin', photoUrl: '', photoFileId: '', photoHeld: true } } });
  try {
    await tap(t);
    assert.ok((await statusText(t)).startsWith('Retake the Flush and smell-check the toilet photo.'), await statusText(t));
    assert.equal(submits(t).length, 0);
    const png = await t.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 700; const x = c.getContext('2d'); for (let i = 0; i < 500; i++) { x.fillStyle = `hsl(${i * 47 % 360},70%,${25 + i * 13 % 50}%)`; x.fillRect(i * 37 % 900, i * 91 % 700, 70, 50); } return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
    await t.page.setInputFiles('.issue-photo-input-check_7_5', [{ name: 'cap.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(png, 'base64') }]);
    await t.page.waitForFunction(() => __s120.state.issueFlags.check_7_5.photoUrl, null, { timeout: 30000 });
    await tap(t);
    await t.page.waitForSelector('#success-screen.visible', { timeout: 30000 });
    assert.equal(failedOf(t), 0);
  } finally { await t.close(); }
});

t0('L3: a held photo survives a second reload', async () => {
  const t = await open(held);
  try {
    await t.page.waitForTimeout(600);
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#draft-modal.open', { timeout: 15000 });
    const stored = JSON.parse(await t.stored());
    assert.equal(stored.issueFlags.check_7_5.photoHeld, true);
    assert.equal(stored.conditionPhotoHeld, true);
  } finally { await t.close(); }
});

t0('L3: the checklist service worker cache is ch-shell-v14-held-photos', () => {
  assert.match(readFileSync(new URL('../checklist/sw.js', import.meta.url), 'utf8'), /const CACHE_NAME = 'ch-shell-v14-held-photos';/);
});
