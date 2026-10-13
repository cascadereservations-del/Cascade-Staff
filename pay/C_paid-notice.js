/* Cascade Staff - "You were paid" notice for the cleaner home (Lane C, s81).
   window.C_PaidNotice.mount(containerEl, { client, demo, now, storage }) fills the reserved #slot-paid-notice and unhides it; it stays hidden
   when there is nothing to say, when her newest paid request is older than 7 days, when she already tapped OK on it, or when the server
   function is absent (PGRST202 / 404): a missing feature is not an error state. Reads staff_pay_my_requests_v1, which returns only HER requests.
   Nothing is stored except the ref she dismissed (localStorage, guarded; the notice simply shows again if storage is blocked). */
(function (root, factory) {
  var api = factory(root.C_PaidText || (typeof require !== 'undefined' ? require('./C_paid-text.js') : null));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C_PaidNotice = api;
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  var SEEN_KEY = 'C_paid_seen', DAYS = 7;

  function C_esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Synthetic data for ?demo only. No real person, amount or reference.
  function C_demoRequest(nowMs) {
    var paid = new Date(nowMs - 3600 * 1000).toISOString();
    return { ref: 'DEMO0001', status: 'paid', total: 1235, paid_at: paid, bank_reference: '12345678', first_name: 'Honey', date_from: '2026-10-10', date_to: '2026-10-12', bank_label: 'MariBank' };
  }

  // The request to announce: her newest paid one inside the window, unless she already dismissed that ref.
  function C_pick(rows, nowMs, seenRef) {
    var best = null;
    (rows || []).forEach(function (r) {
      if (!r || r.status !== 'paid' || !r.paid_at) return;
      var t = Date.parse(r.paid_at);
      if (isNaN(t) || nowMs - t > DAYS * 86400000 || t - nowMs > 86400000) return;
      if (!best || t > Date.parse(best.paid_at)) best = r;
    });
    return best && best.ref !== seenRef ? best : null;
  }

  function C_html(r) {
    // Compact (E_): a tile, the amount and the day, two buttons. The full message opens in place on "Read the message"; the card is 128 px tall until then.
    return '<div class="C_notice" role="status"><span class="C_notice-ico" aria-hidden="true">' + (G.ICON ? G.ICON('checks', 's24') : '') + '</span>' +
      '<div class="C_notice-body"><div class="C_notice-head">' + C_esc(T.titleLine(r)) + '</div><div class="C_notice-line">' + C_esc(T.subLine(r)) + '</div></div>' +
      '<div class="C_notice-acts"><button class="btn btn-secondary C_notice-ok" type="button" data-C-ok="' + C_esc(r.ref) + '">OK, thank you</button>' +
      '<button class="btn btn-ghost C_notice-more" type="button" data-C-more="1" aria-expanded="false">Read the message</button></div>' +
      '<p class="C_notice-text" hidden>' + C_esc(T.noticeText(r)) + '</p></div>';
  }

  var G = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});
  function C_store(o) { try { return o.storage !== undefined ? o.storage : (typeof localStorage !== 'undefined' ? localStorage : null); } catch (e) { return null; } }
  function C_read(st) { try { return st ? st.getItem(SEEN_KEY) : null; } catch (e) { return null; } }
  function C_write(st, v) { try { if (st) st.setItem(SEEN_KEY, v); } catch (e) { /* blocked storage: the notice shows again next time */ } }

  function mount(el, o) {
    o = o || {};
    if (!el) return Promise.resolve(null);
    var nowMs = (o.now ? o.now() : Date.now()), st = C_store(o);
    function show(rows) {
      var r = C_pick(rows, nowMs, C_read(st));
      if (!r) { el.innerHTML = ''; el.hidden = true; return null; }
      el.innerHTML = C_html(r); el.hidden = false;
      if (el.addEventListener) el.addEventListener('click', function (ev) {
        var more = ev.target && ev.target.closest ? ev.target.closest('[data-C-more]') : null;
        if (more) { // expand or fold the full message in place
          var open = more.getAttribute('aria-expanded') !== 'true', txt = el.querySelector ? el.querySelector('.C_notice-text') : null;
          more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Hide the message' : 'Read the message'; if (txt) txt.hidden = !open;
          return;
        }
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-C-ok]') : null;
        if (!b) return;
        if (!o.demo) C_write(st, b.getAttribute('data-C-ok'));
        el.innerHTML = ''; el.hidden = true;
      });
      return r;
    }
    if (o.demo) return Promise.resolve(show([C_demoRequest(nowMs)]));
    if (!o.client || typeof o.client.rpc !== 'function') { el.hidden = true; return Promise.resolve(null); }
    return new Promise(function (ok) { ok(o.client.rpc('staff_pay_my_requests_v1')); }).then(function (res) {
      var d = res && res.data;
      if (!res || res.error || !d || d.ok === false) { el.hidden = true; return null; } // absent, denied or offline: the notice is optional
      return show(d.requests || []);
    }).catch(function () { el.hidden = true; return null; });
  }

  return { mount: mount, pick: C_pick, html: C_html, demoRequest: C_demoRequest, SEEN_KEY: SEEN_KEY, DAYS: DAYS };
});
