/* Cascade Staff - one-link install page (s80). One URL to send in Telegram or Messenger; the page works out what this browser can do:
   in-app browser (cannot install) | Android / desktop Chromium (one Install button) | iPhone Safari (three pictures) | already installed | other.
   No sign-in, no personal data, nothing fetched from any server. The decision itself is CS.installState (pure, tested). */
(function () {
  'use strict';
  var CS = window.CS, ICON = window.ICON, esc = CS.esc, root = document.getElementById('inst');
  var ua = navigator.userAgent || '';
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var link = location.origin + location.pathname; // this page, without a query or hash: what Copy link copies
  var deferred = null, installed = false, phase = 'idle'; // phase: idle | installing | done (the one-tap install on Android and desktop)
  var copied = '', copyTimer = 0;

  function state() { return CS.installState({ ua: ua, standalone: standalone, installed: installed, prompt: !!deferred, touchPoints: navigator.maxTouchPoints || 0 }); }

  // ---- the three iPhone pictures: simple inline drawings, the thing to tap is drawn in the brand colour ----
  var SHARE_ICO = '<path class="ink hi2" d="M12 3v9M8.5 6.5 12 3l3.5 3.5M7 10H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>';
  var PICS = {
    share: '<svg class="pic" viewBox="0 0 240 88" role="img" aria-label="The bottom bar of Safari. The Share button, a square with an arrow pointing up, is in the middle and is marked."><rect class="box" x="1" y="22" width="238" height="64" rx="14"/>' +
      '<path class="ink" d="m30 54-6 5 6 5"/><path class="ink" d="m66 54 6 5-6 5"/>' +
      '<circle class="hi" cx="120" cy="58" r="22"/><g transform="translate(108 46)">' + SHARE_ICO + '</g>' +
      '<rect class="ink" x="166" y="50" width="16" height="16" rx="3"/><circle class="ink" cx="214" cy="58" r="2"/><circle class="ink" cx="206" cy="58" r="2"/><circle class="ink" cx="222" cy="58" r="2"/>' +
      '<text x="120" y="14" text-anchor="middle" class="tx-hi">Tap Share</text></svg>',
    add: '<svg class="pic" viewBox="0 0 240 112" role="img" aria-label="A list of choices. The row Add to Home Screen, with a plus sign, is marked."><rect class="box" x="1" y="1" width="238" height="110" rx="14"/>' +
      '<text x="18" y="29">Copy</text><path d="M1 40h238" stroke="var(--border)"/>' +
      '<text x="18" y="61">Add to Reading List</text>' +
      '<rect class="hi" x="6" y="72" width="228" height="34" rx="10"/><text x="18" y="94" class="tx-hi">Add to Home Screen</text>' +
      '<rect class="ink hi2" x="204" y="80" width="18" height="18" rx="4"/><path class="ink hi2" d="M213 84v10M208 89h10"/></svg>',
    ok: '<svg class="pic" viewBox="0 0 240 88" role="img" aria-label="The top of the Add to Home Screen box. The word Add, top right, is marked."><rect class="box" x="1" y="1" width="238" height="86" rx="14"/>' +
      '<text x="18" y="30">Cancel</text><text x="120" y="30" text-anchor="middle" style="font-weight:600;fill:var(--fg)">Add to Home Screen</text>' +
      '<rect class="hi" x="188" y="12" width="46" height="26" rx="13"/><text x="211" y="30" text-anchor="middle" class="tx-hi">Add</text>' +
      '<rect class="ink" x="18" y="50" width="28" height="28" rx="7"/><text x="58" y="68" style="fill:var(--fg)">Cascade Staff</text></svg>'
  };

  var head = '<header class="head"><h1 class="word"><b>C</b>ascade</h1><div class="cap up" style="margin-top:8px">Staff</div><div class="hair" aria-hidden="true"></div></header>';
  function copyBtn() {
    return '<button class="btn btn-secondary btn-block" type="button" data-act="copy">' + (copied ? ICON('check', 's16') + esc(copied) : ICON('clip', 's16') + 'Copy link') + '</button>';
  }
  function openApp() { return '<a class="btn btn-primary btn-block big" href="../?source=pwa">Open Cascade Staff</a>'; }

  function view() {
    var st = state(), body;
    if (phase === 'installing') {
      body = '<div class="card" role="status"><h2 class="hd">Installing</h2><p class="sub" style="margin-top:6px">Cascade Staff is going onto this phone. This takes a few seconds.</p><div class="skel" style="height:8px;margin-top:12px"></div></div>';
    } else if (phase === 'done' || st === 'installed') {
      body = '<div class="okbox" role="status">' + ICON('checks') + '<span><b>Cascade Staff is on this phone.</b></span></div>' +
        '<p class="sub" style="text-align:center;margin:0">' + (phase === 'done' ? 'Installed. Look for the Cascade icon with your apps, or open it now.' : 'Open it from your Home Screen or apps list any time.') + '</p>' + openApp();
    } else if (st === 'inapp') {
      var b = CS.openInBrowserLink(ua, link), which = /android/i.test(ua) ? 'Chrome' : /iphone|ipad|ipod/i.test(ua) ? 'Safari' : 'Chrome or Safari';
      body = '<div class="infobox">' + ICON('info') + '<span><b>This browser cannot install apps.</b> It is the one built into Messenger, Facebook or a similar app. Open this page in ' + which + ' and the install step appears.</span></div>' +
        '<div class="row-actions">' + (b ? '<a class="btn btn-primary btn-block big" href="' + esc(b.href) + '">' + ICON('ext', 's16') + esc(b.label) + '</a>' : '') + copyBtn() + '</div>' +
        '<p class="help" style="text-align:center;margin:0">' + (b ? 'If that does not open, tap Copy link, open ' + which + ' and paste it in the address bar.' : 'Tap Copy link, then paste it in ' + which + '.') + '</p>';
    } else if (st === 'prompt') {
      body = '<div class="card"><h2 class="hd">Put Cascade Staff on this phone</h2><p class="sub" style="margin-top:6px">One tap. It opens like an app, with no address bar, and keeps you signed in.</p></div>' +
        '<button class="btn btn-primary btn-block big" type="button" data-act="install">' + ICON('plus', 's16') + 'Install</button>';
    } else if (st === 'ios') {
      body = '<div class="card"><h2 class="hd">Put Cascade Staff on your iPhone</h2><p class="sub" style="margin-top:6px">Three taps in Safari. Use Safari, not the browser inside another app.</p></div>' +
        '<ol class="isteps">' +
        '<li class="istep"><span class="inum" aria-hidden="true">1</span><div><h2>Tap the Share button</h2>' + PICS.share + '</div></li>' +
        '<li class="istep"><span class="inum" aria-hidden="true">2</span><div><h2>Choose Add to Home Screen</h2>' + PICS.add + '<p class="help" style="margin:6px 0 0">Scroll the list down a little if you do not see it.</p></div></li>' +
        '<li class="istep"><span class="inum" aria-hidden="true">3</span><div><h2>Tap Add</h2>' + PICS.ok + '</div></li></ol>' +
        '<p class="help" style="text-align:center;margin:0">Then open Cascade Staff from your Home Screen.</p>' + copyBtn();
    } else {
      body = '<div class="infobox">' + ICON('info') + '<span><b>This browser cannot install apps.</b> Copy the link and open it in Chrome on Android or Safari on iPhone.</span></div>' + copyBtn() +
        '<p class="help" style="text-align:center;margin:0">You can also use the app in this browser without installing it. <a href="../">Open Cascade Staff</a></p>';
    }
    return head + body;
  }
  function draw() { root.innerHTML = view(); }

  // Copy: the clipboard API when there is one, a hidden textarea when not. The button says what happened.
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).catch(function () { return fallback(t); });
    return fallback(t);
  }
  function fallback(t) {
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); ok ? res() : rej(new Error('copy'));
    });
  }
  function later(msg) { copied = msg; draw(); clearTimeout(copyTimer); copyTimer = setTimeout(function () { copied = ''; draw(); }, 2500); }

  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (a === 'copy') copyText(link).then(function () { later('Link copied'); }, function () { later('Press and hold the address to copy it'); });
    else if (a === 'install' && deferred) {
      var p = deferred; deferred = null; p.prompt();
      p.userChoice.then(function (c) {
        if (c && c.outcome === 'accepted') { phase = 'installing'; draw(); setTimeout(function () { if (phase === 'installing') { phase = 'done'; draw(); } }, 8000); } else draw();
      }, draw);
    }
  });
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; draw(); });
  window.addEventListener('appinstalled', function () { deferred = null; installed = true; phase = 'done'; draw(); });
  // An app installed earlier (needs related_applications in the manifest): offer Open instead of Install.
  if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps().then(function (a) { if (a && a.length) { installed = true; draw(); } }).catch(function () {});

  // The service worker makes the page installable and puts the shell in the cache; sw.js sits one folder up and its scope is the app.
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('../sw.js').catch(function () {}); });
  draw();
})();
