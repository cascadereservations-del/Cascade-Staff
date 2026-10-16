import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const CS = createRequire(import.meta.url)('../lib.js');

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  messengerAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/450.0.0.0.0;]',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/450.0.0.0;FBBV/1;FBDV/iPhone15,2]',
  messengerIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Messenger/450.0.0 [FBAN/MessengerForiOS]',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 330.0.0.0',
  webviewIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90',
  androidWebview: 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  ipadDesktopUa: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
};

test('install state: Android and desktop Chromium with a caught prompt show the one Install button', () => {
  assert.equal(CS.installState({ ua: UA.androidChrome, prompt: true }), 'prompt');
  assert.equal(CS.installState({ ua: UA.desktopChrome, prompt: true }), 'prompt');
});

test('install state: no prompt on a browser that cannot install falls to the copy-link page', () => {
  assert.equal(CS.installState({ ua: UA.desktopFirefox }), 'unsupported');
  assert.equal(CS.installState({ ua: UA.androidChrome, prompt: false }), 'unsupported');
  assert.equal(CS.installState({ ua: UA.ipadDesktopUa, touchPoints: 0 }), 'unsupported', 'a desktop Safari is not an iPad');
  assert.equal(CS.installState(), 'unsupported');
});

test('install state: Messenger, Facebook, Instagram and web views are in-app browsers, even when a prompt exists', () => {
  for (const k of ['messengerAndroid', 'facebookIos', 'messengerIos', 'instagramIos', 'webviewIos', 'androidWebview']) {
    assert.equal(CS.installState({ ua: UA[k], prompt: true }), 'inapp', k);
    assert.equal(CS.isInAppBrowser(UA[k]), true, k);
  }
  for (const k of ['safariIos', 'chromeIos', 'androidChrome', 'desktopChrome']) assert.equal(CS.isInAppBrowser(UA[k]), false, k);
  assert.equal(CS.installState({ ua: 'Mozilla/5.0 (Linux; Android 14) Telegram-Android/10.0' }), 'inapp');
});

test('install state: iPhone Safari, iPhone Chrome and an iPad asking for the desktop site get the three-step picture guide', () => {
  assert.equal(CS.installState({ ua: UA.safariIos }), 'ios');
  assert.equal(CS.installState({ ua: UA.chromeIos }), 'ios');
  assert.equal(CS.installState({ ua: UA.ipadDesktopUa, touchPoints: 5 }), 'ios');
});

test('install state: standalone or an installed app wins over everything', () => {
  assert.equal(CS.installState({ ua: UA.safariIos, standalone: true }), 'installed');
  assert.equal(CS.installState({ ua: UA.androidChrome, prompt: true, installed: true }), 'installed');
  assert.equal(CS.installState({ ua: UA.messengerAndroid, standalone: true }), 'installed');
});

test('Open in Chrome / Safari: Android gets an intent with the page as the fallback, iPhone x-safari-https, a desktop nothing', () => {
  const u = CS.INSTALL_URL;
  assert.equal(u, 'https://cascadereservations-del.github.io/Cascade-Staff/install/');
  const a = CS.openInBrowserLink(UA.messengerAndroid, u);
  assert.equal(a.label, 'Open in Chrome');
  assert.equal(a.href, 'intent://cascadereservations-del.github.io/Cascade-Staff/install/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(u) + ';end');
  const i = CS.openInBrowserLink(UA.facebookIos, u);
  assert.deepEqual(i, { label: 'Open in Safari', href: 'x-safari-https://cascadereservations-del.github.io/Cascade-Staff/install/' });
  assert.equal(CS.openInBrowserLink(UA.desktopChrome, u), null);
  assert.equal(CS.openInBrowserLink(UA.androidChrome, 'http://x/y'), null);
  assert.equal(CS.openInBrowserLink(UA.androidChrome, ''), null);
});

test('the install page, the manifest and the service worker agree', () => {
  const html = read('install/index.html'), js = read('install/install.js');
  assert.match(html, /<link rel="manifest" href="\.\.\/manifest\.webmanifest">/);
  assert.match(html, /<script src="\.\.\/lib\.js">/); assert.match(html, /<script src="\.\.\/theme\.js">/);
  assert.match(js, /var link = CS\.INSTALL_URL \+/); assert.match(js, /min-height:44px/);
  assert.match(js, /serviceWorker\.register\('\.\.\/sw\.js'\)/);
  assert.match(html, /<script src="\.\.\/theme\.js">/); assert.match(js, /var link = CS\.INSTALL_URL \+/); assert.match(js, /min-height:44px/);
  assert.match(js, /beforeinstallprompt/); assert.match(js, /appinstalled/); assert.match(js, /getInstalledRelatedApps/);
  assert.doesNotMatch(js + html, /supabase|\/rest\/v1|functions\/v1|sessionStorage|setItem/i, 'no data, no writes on the install page (it only reads the cs-team choice)');
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.prefer_related_applications, false);
  assert.deepEqual(m.related_applications, [{ platform: 'webapp', url: 'https://cascadereservations-del.github.io/Cascade-Staff/manifest.webmanifest' }]);
  assert.equal(m.scope, '/Cascade-Staff/');
  const sw = read('sw.js');
  assert.match(sw, /CACHE_NAME = 'cs-shell-v31'/);
  for (const f of ['./install/', './install/index.html', './install/install.js', './demo.js']) assert.ok(sw.includes("'" + f + "'"), f + ' is precached');
  assert.match(read('app.js'), /version: '3.4.6'/);
});

test('the in-app install card links to the install page when there is no prompt and no iPhone', () => {
  const app = read('app.js');
  assert.match(app, /id="install-link" href="\.\/install\/"/);
  assert.match(app, /card\.hidden = standalone;/);
  assert.match(app, /lnk\.hidden = !!\(deferredPrompt \|\| isIOS\)/);
});

test('the install page runs in a stub browser for each state without throwing', () => {
  const states = [['messengerAndroid', /Open in Chrome/, /cannot install apps/], ['facebookIos', /Open in Safari/, /Copy link/], ['safariIos', /Tap Share/, /Add to Home Screen/],
    ['desktopFirefox', /Copy link/, /cannot install apps/]];
  for (const [k, a, b] of states) {
    const el = { innerHTML: '', addEventListener() {} };
    const win = { addEventListener() {}, matchMedia: () => ({ matches: false }), CS, ICON: (n) => `<i data-i="${n}"></i>` };
    const ctx = { window: win, matchMedia: win.matchMedia, document: { getElementById: () => el }, navigator: { userAgent: UA[k], maxTouchPoints: 0 }, location: { origin: 'https://x.example', pathname: '/Cascade-Staff/install/' } };
    vm.createContext(ctx); vm.runInContext(read('install/install.js'), ctx);
    assert.match(el.innerHTML, a, k); assert.match(el.innerHTML, b, k);
  }
});

test('3.4.3: common links live in lib.js and the Cassy pick screen copies them; pageLink keeps ?team= and drops the fragment', () => {
  assert.deepEqual(CS.COMMON_LINKS.map((l) => l.url), ['https://tinyurl.com/WelcomeToCascade', 'https://tinyurl.com/Stay-at-Cascade']);
  assert.match(read('app.js'), /aria-label="Common links"[^]*CS\.COMMON_LINKS[^]*data-act="copy" data-copy=/);
  assert.equal(CS.pageLink({ href: 'https://x.test/Cascade-Staff/?team=staff#home' }), 'https://x.test/Cascade-Staff/?team=staff');
  assert.equal(CS.openInBrowserLink('Mozilla/5.0 (iPhone) FBAN/Messenger', CS.pageLink({ href: 'https://x.test/a/?team=staff#h' })).href, 'x-safari-https://x.test/a/?team=staff');
});

test('3.4.3: iPhone in-app browsers get Open in Safari, the steps are the iOS 26 ones, and install/ keeps the team', () => {
  const app = read('app.js'), idx = read('index.html'), ij = read('install/install.js'), ih = read('install/index.html');
  assert.match(app, /var inApp = isIOS && CS\.isInAppBrowser\(ua\)/); assert.match(app, /CS\.openInBrowserLink\(ua, link\)/);
  assert.match(idx, /id="a2hs-inapp"/); assert.match(idx, /Open as Web App/); assert.match(ij, /Open as Web App/);
  assert.match(ij, /\?team=/); assert.match(ij, /cs-team/); assert.match(ih, /"\.\.\/manifest-"\+t\+"\.webmanifest"/);
});

test('3.4.3: every page names the logo favicon and the files exist', () => {
  for (const p of ['index.html', 'install/index.html', 'guest/index.html', 'pay/index.html', 'quick/index.html', 'checklist/index.html', 'manual/index.html', 'guide/index.html', 'admin/index.html']) assert.match(read(p), /favicon-32\.png/, p);
  for (const f of ['icons/favicon-32.png', 'checklist/icons/favicon-32.png', 'icons/icon-512-maskable.png']) assert.ok(fs.existsSync(new URL('../' + f, import.meta.url)), f);
  assert.match(read('manifest.webmanifest'), /"purpose": "maskable"/);
});
