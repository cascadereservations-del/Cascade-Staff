/* Cascade Staff - service-worker push handlers (Lane C, s81). Loaded by the shell sw.js with  importScripts('pay/C_push-sw.js');
   Shows the notification the server sent and opens the app when it is tapped. The lock screen NEVER shows an amount: whatever the payload
   carries, a body with a currency mark or a long number is replaced by a plain sentence. Nothing here caches, stores or fetches anything. */
(function () {
  'use strict';
  var C_FALLBACK_TITLE = 'Cascade Staff';
  var C_FALLBACK_BODY = 'Open Cascade Staff for the details.';

  // Any currency marker next to digits (PHP 1,235, ₱1,235, P500, 500 pesos, 500 php) or a run of 4 or more digits: the lock screen says no amount.
  var C_AMOUNT = /(?:PHP|Php|php|₱|\bP)\s*\d|\d[\d,.]*\s*(?:[Pp]esos?\b|PHP|Php|php|₱)|\d[\d,]{3,}/;
  function C_safeBody(b) {
    var s = String(b == null ? '' : b).slice(0, 240);
    return C_AMOUNT.test(s) ? C_FALLBACK_BODY : (s || C_FALLBACK_BODY);
  }
  function C_safeTitle(t) {
    var s = String(t == null ? '' : t).slice(0, 80);
    return C_AMOUNT.test(s) || !s ? C_FALLBACK_TITLE : s;
  }
  function C_parse(e) {
    try { return e.data ? e.data.json() : {}; } catch (err) { return {}; }
  }
  function C_target(d) {
    // Only a path inside this app: never an address from the payload.
    var u = String(d && d.url || './#home');
    return /^(?:\.\/|\/)[^:]*$/.test(u) && u.indexOf('//') < 0 ? u : './#home';
  }

  self.addEventListener('push', function (event) {
    var d = C_parse(event);
    var opts = {
      body: C_safeBody(d.body),
      tag: String(d.tag || 'cascade-paid').slice(0, 40),
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: C_target(d) }
    };
    if (d.tag === 'inbox') opts.renotify = true; // a second guest message under the same tag must buzz again; the paid notice is untouched
    event.waitUntil(self.registration.showNotification(C_safeTitle(d.title), opts));
  });

  self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var url = C_target(event.notification.data);
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) { try { if ('navigate' in list[i]) list[i].navigate(url); } catch (e) { /* focus is enough */ } return list[i].focus(); }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : null;
    }));
  });
})();
