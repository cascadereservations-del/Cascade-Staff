// Lane C guards: duplicate names, parse tests for every file this lane added or touched, the BANK_APPS rule, and the payout-QR hygiene rules
// (no real QR in the repo, no storage / cache / console in the code that handles the payload). Static, no clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const payFiles = fs.readdirSync(path.join(root, 'pay'));
const js = payFiles.filter((f) => f.endsWith('.js')), html = payFiles.filter((f) => f.endsWith('.html')), css = payFiles.filter((f) => f.endsWith('.css'));
const laneJs = js.filter((f) => f.startsWith('C_'));

test('guard: no duplicate top-level function / var / const names across the pay scripts, and every new global is C_-prefixed', () => {
  const seen = new Map();
  for (const f of js) {
    for (const m of read('pay/' + f).matchAll(/^(?:async\s+)?(?:function|var|let|const)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!seen.has(m[1]), `${m[1]} is declared at top level in both ${seen.get(m[1])} and ${f}`); seen.set(m[1], f);
    }
  }
  const globals = new Set();
  for (const f of laneJs) for (const m of read('pay/' + f).matchAll(/else root\.(\w+)\s*=\s*api/g)) { assert.match(m[1], /^C_/, `${f} exports ${m[1]}`); assert.ok(!globals.has(m[1]), 'duplicate global ' + m[1]); globals.add(m[1]); }
  assert.deepEqual([...globals].sort(), ['C_PaidNotice', 'C_PaidText', 'C_PayAdmin', 'C_Push', 'C_QR', 'C_QrPh']);
});

test('guard: no duplicate test names across this lane\'s test files', () => {
  const names = new Map();
  for (const f of fs.readdirSync(path.join(root, 'tests')).filter((x) => /^C_.*\.test\.mjs$/.test(x))) {
    for (const m of read('tests/' + f).matchAll(/^test\(\s*(['"`])(.*?)\1/gm)) { assert.ok(!names.has(m[2]), `"${m[2]}" is in ${names.get(m[2])} and ${f}`); names.set(m[2], f); }
  }
  assert.ok(names.size > 30);
});

test('parse: every pay script compiles; every inline script in the pay pages compiles; every script src exists; the css is balanced', () => {
  for (const f of js) assert.doesNotThrow(() => new vm.Script(read('pay/' + f), { filename: f }), f);
  for (const f of html) {
    const src = read('pay/' + f);
    assert.match(src, /^<!doctype html>/i, f);
    for (const m of src.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new vm.Script(m[1], { filename: f }), f);
    for (const m of src.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) if (!/^https:/.test(m[1])) assert.ok(fs.existsSync(path.join(root, 'pay', m[1])), `${f} loads missing ${m[1]}`);
    for (const m of src.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) if (!/^https:/.test(m[1])) assert.ok(fs.existsSync(path.join(root, 'pay', m[1])), `${f} links missing ${m[1]}`);
  }
  for (const f of css) { const c = read('pay/' + f).replace(/\/\*[\s\S]*?\*\//g, ''); assert.equal((c.match(/\{/g) || []).length, (c.match(/\}/g) || []).length, f); }
  assert.match(read('pay/admin.html'), /C_admin-lib\.js[\s\S]*C_admin\.js/); assert.match(read('pay/index.html'), /C_paid-text\.js[\s\S]*C_push\.js[\s\S]*pay\.js/);
});

test('css: every colour is a v5 token; the one literal is the white QR quiet zone the QR standard requires', () => {
  const c = read('pay/C_pay.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const hexes = [...c.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(hexes, ['#FFFFFF'], 'the only literal is --v5-qr-paper, the white a QR needs behind it');
  assert.match(c, /--v5-qr-paper:\s*#FFFFFF/); assert.match(c, /\.C_qrframe\s*\{[^}]*background:\s*var\(--v5-qr-paper\)/);
  assert.doesNotMatch(c, /\brgba?\(|\bhsla?\(/, 'no literal colour functions either');
  assert.ok((c.match(/var\(--v5-/g) || []).length > 70);
  const n = read('pay/C_notice.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(n, /#[0-9a-fA-F]{3,8}|rgba?\(|:root|body/, 'the notice sheet is tokens only and touches nothing global');
  assert.ok(/^\s*\.C_/m.test(n) && n.split('}').filter((r) => r.trim() && !/^\s*@media/.test(r) && !/^\s*\.C_/.test(r.trim())).length === 0, 'every rule in the notice sheet is a .C_ rule');
  for (const m of c.matchAll(/font(?:-size)?:\s*[^;]*?\b(\d+)px/g)) assert.ok(+m[1] >= 12 || /line|\//.test(m[0]), 'text under 12px: ' + m[0]);
});

test('BANK_APPS: BPI first with the current package and App Store page, GCash second, everything unverified, the old package nowhere', () => {
  const P = req('../pay/pay-lib.js');
  assert.deepEqual(Object.keys(P.BANK_APPS).slice(0, 2), ['bpi', 'gcash']);
  assert.deepEqual(JSON.parse(JSON.stringify(P.BANK_APPS.bpi)), { name: 'BPI', pkg: 'com.bpi.ng.app', ios: null, store: 'https://apps.apple.com/ph/app/bpi/id6443950982', verified: false });
  assert.equal(P.BANK_APPS.gcash.pkg, 'com.globe.gcash.android'); assert.equal(P.BANK_APPS.gcash.verified, false);
  for (const a of Object.values(P.BANK_APPS)) assert.equal(a.verified, false);
  for (const f of payFiles) assert.doesNotMatch(read('pay/' + f), /com\.bpi\.ng\.mobilebanking/, f);
  // once Lloyd flips it, BPI is listed first, opens by package with the Play page as the fallback, and an iPhone goes to the App Store page
  const flipped = { ...JSON.parse(JSON.stringify(P.BANK_APPS)), bpi: { ...P.BANK_APPS.bpi, verified: true } };
  assert.deepEqual(P.listedBankApps(flipped), ['bpi']);
  const u = P.bankIntentUrl('bpi', flipped);
  assert.ok(u.includes('package=com.bpi.ng.app;')); assert.ok(u.includes('S.browser_fallback_url=' + encodeURIComponent('https://play.google.com/store/apps/details?id=com.bpi.ng.app')));
  assert.match(read('pay/bank.html'), /ios \? \(a\.ios \|\| a\.store\)/);
  // the page URL carries only ?app=<key>: no amount, no account
  assert.doesNotMatch(read('pay/C_admin.js'), /bank\.html\?app=[^'"]*(?:amount|account|total)/i);
});

test('payout QR hygiene: no real QR Ph string in the lane\'s files, and no storage, cache, console or address-bar use where the payload is handled', () => {
  for (const f of [...payFiles.map((x) => 'pay/' + x), ...fs.readdirSync(path.join(root, 'tests')).map((x) => 'tests/' + x)]) {
    if (!fs.statSync(path.join(root, f)).isFile()) continue;
    const src = read(f);
    for (const m of src.matchAll(/0002010102(?:11|12)[0-9A-Za-z.]{20,}/g)) assert.match(m[0], /ZZ/, `${f}: a payload-looking string that is not synthetic`);
    for (const line of src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ''))) if (/com\.p2pqrpay/.test(line) && !/^\s*(\*|\/\*)/.test(line)) assert.match(line, /ZZ|C_QrPh|withAmount|expect|assert|demo|DEMO/i, `${f}: ${line.trim().slice(0, 80)}`);
  }
  for (const f of ['C_admin.js', 'C_admin-lib.js', 'C_qrph.js', 'C_qr.js']) {
    const src = read('pay/' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|\bcaches\b|console\.|location\.(?:hash|search)\s*=|history\.(?:push|replace)State/, f);
  }
  // the page asks for no caching and leaks no referrer
  assert.match(read('pay/admin.html'), /name="referrer" content="no-referrer"/);
});

test('pay pages: no Google Fonts, tokens.css before styles.css, the v5 theme-color pair, no inline control height under 44px', () => {
  for (const f of html) {
    const src = read('pay/' + f);
    assert.doesNotMatch(src, /fonts\.googleapis|fonts\.gstatic/, f);
    assert.ok(src.indexOf('../tokens.css') > 0 && src.indexOf('../tokens.css') < src.indexOf('../styles.css'), f + ': tokens.css first');
    assert.match(src, /name="theme-color" content="#EEF1F4" media="\(prefers-color-scheme: light\)"/, f); assert.match(src, /name="theme-color" content="#0B1420" media="\(prefers-color-scheme: dark\)"/, f);
  }
  for (const f of js) for (const m of read('pay/' + f).matchAll(/style="[^"]*height:\s*(\d+)px/g)) assert.ok(+m[1] >= 44 || /skel|disc/.test(m[0]) || +m[1] > 60, `${f}: inline height ${m[1]}px`);
  assert.doesNotMatch(read('pay/pay.js'), /data-rmx[^>]*height:28px/);
  assert.match(read('pay/C_pay.css'), /\.btn-sm\s*\{[^}]*min-height:\s*var\(--v5-touch\)/);
  for (const f of js) assert.doesNotMatch(read('pay/' + f), /(?:11:00|3:00) ?(?:am|pm)|11 ?am|3 ?pm/i, f);
});
