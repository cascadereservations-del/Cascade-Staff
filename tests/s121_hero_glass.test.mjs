// Session 121 (D-384): the step hero card is a clearer frosted panel. Static CSS checks plus a contrast measure over all 7 header photos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browser, browserSuite, closeBrowser } from './s120_browser.mjs';

const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const sw = readFileSync(new URL('../checklist/sw.js', import.meta.url), 'utf8');
const rule = /@supports \(\(backdrop-filter: blur\(6px\)\) or \(-webkit-backdrop-filter: blur\(6px\)\)\) \{\n  html\.K_folded \.phase-header\.K_hasimg \.K_panel \{([^}]*)\}/.exec(html);

test('the glass panel has the prefixed blur, a rim, and sits inside @supports', () => {
  assert.ok(rule, 'glass rule not found');
  assert.match(rule[1], /-webkit-backdrop-filter: blur\(14px\) saturate\(1\.25\)/);
  assert.match(rule[1], /(?<!-webkit-)backdrop-filter: blur\(14px\) saturate\(1\.25\)/);
  assert.match(rule[1], /border: 1px solid rgba\(249,246,240,0\.20\)/);
});
test('without blur support the solid .84 base stays, and reduced transparency gets a solid panel', () => {
  assert.match(html, /html\.K_folded \.phase-header \.K_panel \{[^}]*background: rgba\(22,13,6,0\.84\)/);
  assert.match(html, /@media \(prefers-reduced-transparency: reduce\) \{\n  html\.K_folded \.phase-header\.K_hasimg \.K_panel \{ background: rgba\(20,12,5,0\.94\); -webkit-backdrop-filter: none; backdrop-filter: none;/);
});
test('the service worker cache name changed so phones refresh', () => {
  assert.match(sw, /const CACHE_NAME = 'ch-shell-v15-utensils';/);
});

const run = await browserSuite(test, assert);
run('white tagline stays at 5:1 or better on the worst area of all 7 step photos at 320 and 375 px', async () => {
  const [top, bottom] = [...rule[1].matchAll(/rgba\(20,12,5,([0-9.]+)\)/g)].map(m => Number(m[1]));
  assert.ok(top === 0.6 && bottom === 0.44, 'tint alphas ' + top + ' / ' + bottom);
  const photos = {};   // the page server only serves checklist/, so the photos go in as data URLs
  for (const n of ['living', 'tv-wall', 'laundry', 'bed', 'bathroom', 'room', 'entrance']) photos[n] = 'data:image/webp;base64,' + readFileSync(new URL('../guide/img/standard/' + n + '.webp', import.meta.url)).toString('base64');
  const s = await browser();
  const ctx = await s.b.newContext({ viewport: { width: 400, height: 400 } });
  const pg = await ctx.newPage();
  await pg.goto(s.url + '__blank');
  const rows = await pg.evaluate(async ({ photos, top, bottom }) => {
    const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const lum = c => .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const over = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
    const out = [];
    for (const [n, src] of Object.entries(photos)) for (const W of [320, 375]) for (const H of [176, 230]) {
      const im = new Image(); im.src = src; await im.decode();
      const sc = Math.max(W / im.naturalWidth, H / im.naturalHeight), dw = im.naturalWidth * sc, dh = im.naturalHeight * sc;
      const full = document.createElement('canvas'); full.width = W; full.height = H; full.getContext('2d').drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const sm = document.createElement('canvas'); sm.width = Math.ceil(W / 12); sm.height = Math.ceil(H / 12);
      const sx = sm.getContext('2d', { willReadFrequently: true }); sx.drawImage(full, 0, 0, sm.width, sm.height);
      const d = sx.getImageData(0, 0, sm.width, sm.height).data;
      const scrim = y => { const t = 1 - y / H, st = [[0, .82], [.55, .38], [1, .04]]; for (let i = 1; i < st.length; i++) if (t <= st[i][0]) { const [a0, v0] = st[i - 1], [a1, v1] = st[i]; return v0 + (v1 - v0) * (t - a0) / (a1 - a0); } return .04; };
      const pt = Math.max(H * .22, H - 31 - 128);   // the panel is at most 128px tall and ends above the progress bar
      let w = 99;
      for (let by = Math.floor(pt / 12); by <= Math.floor((H - 31) / 12); by++) for (let bx = 1; bx <= Math.floor((W - 68) / 12); bx++) {
        const i = (by * sm.width + bx) * 4, y = by * 12 + 6, k = Math.min(1, Math.max(0, (y - pt) / (H - 31 - pt)));
        let c = [d[i], d[i + 1], d[i + 2]]; c = over([18, 10, 4], scrim(y), c); c = over([20, 12, 5], top + (bottom - top) * k, c);
        w = Math.min(w, cr(over([244, 236, 226], .94, c), c), cr([249, 246, 240], c));
      }
      out.push({ n, W, H, w: +w.toFixed(2) });
    }
    return out;
  }, { photos, top, bottom });
  await ctx.close();
  assert.equal(rows.length, 28);
  const worst = rows.reduce((a, b) => (b.w < a.w ? b : a));
  assert.ok(worst.w >= 5, 'worst ' + JSON.stringify(worst));
});
test.after(async () => { await closeBrowser(); });
