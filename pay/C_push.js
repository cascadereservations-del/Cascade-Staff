/* Cascade Staff - "Tell me on this phone when I am paid" (Lane C, s81). window.C_Push: the logic behind the toggle in the pay screens.
   Probe first, hide on any missing piece: no browser support, no VAPID key on the server (function answers push_not_configured), no RPC
   (PGRST202 / 404). The VAPID public key comes from the server at the moment of subscribing, never from this file.
   The subscription's endpoint and keys go to the server through staff_push_subscribe_v1 and are never kept here. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C_Push = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 'unsupported' | 'needs_install' (iPhone outside the home-screen app) | 'blocked' (permission denied) | 'ready'
  function C_support(env) {
    env = env || {};
    var nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {}), win = env.window || (typeof window !== 'undefined' ? window : {});
    var hasSw = 'serviceWorker' in nav, hasPush = 'PushManager' in win, hasNote = 'Notification' in win;
    var ios = /iphone|ipad|ipod/i.test(String(nav.userAgent || ''));
    var standalone = !!(nav.standalone || (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches));
    if (ios && !standalone) return 'needs_install';
    if (!hasSw || !hasPush || !hasNote) return 'unsupported';
    if (win.Notification && win.Notification.permission === 'denied') return 'blocked';
    return 'ready';
  }

  function C_keyBytes(b64u) {
    var s = String(b64u).replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4);
    var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
  function C_b64u(buf) {
    var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // The four arguments of staff_push_subscribe_v1, from a PushSubscription (toJSON keys, else getKey).
  function C_args(sub, userAgent) {
    var j = sub.toJSON ? sub.toJSON() : {}, k = j.keys || {};
    var p256dh = k.p256dh || (sub.getKey ? C_b64u(sub.getKey('p256dh')) : ''), auth = k.auth || (sub.getKey ? C_b64u(sub.getKey('auth')) : '');
    return { p_endpoint: sub.endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: String(userAgent || '').slice(0, 200) };
  }
  function C_absent(err) { return !!err && (err.code === 'PGRST202' || err.status === 404 || /not.?found|PGRST202/i.test(String(err.message || ''))); }

  // Is the toggle available at all, and is it on for this phone? { state: 'hidden'|'off'|'on'|'needs_install'|'blocked' }
  function status(o) {
    var s = C_support(o.env);
    if (s === 'unsupported') return Promise.resolve({ state: 'hidden' });
    if (s === 'needs_install' || s === 'blocked') return Promise.resolve({ state: s });
    var nav = (o.env && o.env.navigator) || navigator;
    return nav.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return { state: 'off' };
      return Promise.resolve(o.client.from('staff_push_subscriptions').select('id').eq('endpoint', sub.endpoint).limit(1)).then(function (r) {
        if (r && r.error) return C_absent(r.error) ? { state: 'hidden' } : { state: 'off' };
        return { state: r && r.data && r.data.length ? 'on' : 'off' };
      });
    }).catch(function () { return { state: 'hidden' }; });
  }

  // Ask the server for the public key. o.call(body) POSTs to notify-cleaner-payment with the session and resolves to the parsed JSON.
  function C_serverKey(o) {
    return Promise.resolve(o.call({ action: 'vapid_key' })).then(function (j) { return j && j.ok && j.key ? j.key : null; }).catch(function () { return null; });
  }

  function enable(o) {
    var env = o.env || {}, win = env.window || window, nav = env.navigator || navigator;
    var s = C_support(env); if (s !== 'ready') return Promise.resolve({ ok: false, reason: s });
    return C_serverKey(o).then(function (key) {
      if (!key) return { ok: false, reason: 'not_configured' };
      return win.Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') return { ok: false, reason: 'blocked' };
        return nav.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: C_keyBytes(key) }).then(function (sub) {
            return Promise.resolve(o.client.rpc('staff_push_subscribe_v1', C_args(sub, nav.userAgent))).then(function (res) {
              if (res && res.error) { return sub.unsubscribe().catch(function () {}).then(function () { return { ok: false, reason: C_absent(res.error) ? 'not_configured' : 'failed' }; }); }
              if (res && res.data && res.data.ok === false) { return sub.unsubscribe().catch(function () {}).then(function () { return { ok: false, reason: 'failed' }; }); }
              return { ok: true };
            });
          });
        });
      });
    }).catch(function () { return { ok: false, reason: 'failed' }; });
  }

  function disable(o) {
    var nav = (o.env && o.env.navigator) || navigator;
    return nav.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return { ok: true };
      var endpoint = sub.endpoint;
      return Promise.resolve(o.client.from('staff_push_subscriptions').delete().eq('endpoint', endpoint)).then(function () { return sub.unsubscribe(); }).then(function () { return { ok: true }; });
    }).catch(function () { return { ok: false, reason: 'failed' }; });
  }

  // The words next to the switch, by state. No exclamation marks.
  function C_words(state) {
    return {
      off: 'Tell me on this phone when I am paid', on: 'You will be told on this phone when you are paid',
      needs_install: 'To get a message on this phone, add Cascade Staff to your Home Screen first, then open it from there.',
      blocked: 'Messages are blocked for this app. Turn them on in your phone settings, then come back.',
      failed: 'That did not work, so nothing changed. Try again.', not_configured: 'Phone messages are not switched on yet. Ask Lloyd.'
    }[state] || '';
  }

  return { support: C_support, keyBytes: C_keyBytes, args: C_args, status: status, enable: enable, disable: disable, words: C_words };
});
