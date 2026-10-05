/* Cascade Staff - Payment Request pure helpers (SPEC-37 sections 7.A and 7.B). No DOM, no network.
   The server computes the money; everything here is display and request shaping. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CSPay = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MAX_EXTRA = 5000, MAX_LINES = 20;

  function peso(n) {
    var v = Math.round(Number(n) * 100) / 100;
    var s = (Math.abs(v) % 1 === 0 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-' : '') + '₱' + s;
  }
  function plain(n) { return peso(n).replace('₱', ''); } // 1,340 (the Telegram block uses bare numbers)
  function dateLabel(iso) { // 2026-10-02 -> Oct 2 Fri
    var a = String(iso).slice(0, 10).split('-'), d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2]));
    return MONTHS[+a[1] - 1] + ' ' + +a[2] + ' ' + DAYS[d.getUTCDay()];
  }
  function shortDate(iso) { var a = String(iso).slice(0, 10).split('-'); return MONTHS[+a[1] - 1] + ' ' + +a[2]; }
  function typeLabel(t) { return t === 'deep_clean' ? 'Deep clean' : t === 'mid_stay' ? 'Mid-stay clean' : 'Turnover'; }
  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  // An extra the staff member typed: description 3-500 characters, amount above 0 and up to 5,000.
  function parseExtra(e) {
    var d = String((e && e.description) || '').trim(), a = round2(String((e && e.amount) == null ? '' : e.amount).replace(/,/g, ''));
    if (d.length < 3 || d.length > 500) return null;
    if (!(a > 0) || a > MAX_EXTRA) return null;
    return { description: d, amount: a, receipt: !!(e && (e.receipt || e.receipt_path)), receipt_path: (e && e.receipt_path) || null };
  }
  function sessionAmount(s, transportOn) { return round2(Number(s.base) + (transportOn && s.transport != null ? Number(s.transport) : 0)); }

  // sel = { sessions: {id: {on, transport}}, claims: {id: bool}, extras: [{description, amount, receipt_path?}] }
  function chosen(cands, sel) {
    sel = sel || {};
    var sessions = ((cands && cands.sessions) || []).filter(function (s) { return sel.sessions && sel.sessions[s.id] && sel.sessions[s.id].on; })
      .map(function (s) { var on = !!sel.sessions[s.id].transport && s.transport != null; return { s: s, transport: on, amount: sessionAmount(s, on) }; });
    var claims = ((cands && cands.claims) || []).filter(function (c) { return sel.claims && sel.claims[c.id]; });
    var extras = ((sel.extras) || []).map(parseExtra).filter(Boolean);
    return { sessions: sessions, claims: claims, extras: extras };
  }
  function computeTotal(cands, sel) {
    var c = chosen(cands, sel), t = 0;
    c.sessions.forEach(function (x) { t += x.amount; });
    c.claims.forEach(function (x) { t += Number(x.amount); });
    c.extras.forEach(function (x) { t += x.amount; });
    return round2(t);
  }
  function lineCount(cands, sel) { var c = chosen(cands, sel); return c.sessions.length + c.claims.length + c.extras.length; }

  // The body of POST /functions/v1/notify-cleaner-payment (SPEC-37 5.2). receiptPaths maps extra index -> uploaded path.
  function buildPayload(cands, sel, key, receiptPaths) {
    var c = chosen(cands, sel);
    return {
      sessions: c.sessions.map(function (x) { return { id: x.s.id, transport: x.transport }; }),
      claim_ids: c.claims.map(function (x) { return x.id; }),
      extras: c.extras.map(function (x, i) {
        var o = { description: x.description, amount: x.amount };
        var p = (receiptPaths && receiptPaths[i]) || x.receipt_path; if (p) o.receipt_path = p;
        return o;
      }),
      idempotency_key: key
    };
  }

  // Honey's own shape (SPEC-37 section 6): a heading, one line per clean, Other expenses, Total. Bare numbers, as in her message.
  function reviewBlock(cands, sel) {
    var c = chosen(cands, sel), lines = [], total = computeTotal(cands, sel);
    if (c.sessions.length) {
      lines.push('Cleaning services');
      c.sessions.forEach(function (x) {
        var guest = x.s.guest ? ' (' + x.s.guest + ')' : '';
        var tail = x.transport ? ' (' + plain(x.s.base) + ' + ' + plain(x.s.transport) + ' transport)' : '';
        lines.push(dateLabel(x.s.date) + guest + ' = ' + plain(x.amount) + tail);
      });
    }
    if (c.claims.length || c.extras.length) {
      lines.push('Other expenses');
      c.claims.forEach(function (x) { lines.push(x.description + ' = ' + plain(x.amount) + (x.receipt === true ? ' · receipt below' : x.receipt === false ? ' · no receipt' : '')); });
      c.extras.forEach(function (x) { lines.push(x.description + ' = ' + plain(x.amount) + (x.receipt ? ' · receipt below' : ' · no receipt')); });
    }
    lines.push('Total: ' + peso(total));
    return { lines: lines, text: lines.join('\n'), total: total };
  }

  // One key per page load, reused on every retry, so a double tap or a bad signal never makes two requests.
  function newKey(cryptoObj) {
    var c = cryptoObj || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16); if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // The words after a send (SPEC-37 7.A). ok -> {ok:true, refresh:false}; the two taken reasons ask for a refreshed list.
  function resultMessage(res) {
    if (res && res.ok) return { ok: true, refresh: false, text: 'Sent. Finance has your request for ' + peso(res.total) + ' (Ref ' + String(res.ref || '').replace(/^CASCADE-/, '') + '). You will see it in OPS when it is paid.' };
    var r = (res && res.reason) || 'unknown';
    if (r === 'session_taken' || r === 'claim_taken') return { ok: false, refresh: true, text: 'One of these was already sent or paid. The list is refreshed - check and send again.' };
    if (r === 'card_failed') return { ok: false, refresh: false, text: 'Finance could not be reached, so nothing was sent. Try again in a few minutes.' };
    if (r === 'too_many_lines') return { ok: false, refresh: false, text: 'A request holds up to ' + MAX_LINES + ' lines. Send the older ones first, then make a second request.' };
    if (r === 'offline') return { ok: false, refresh: false, text: 'No connection, so nothing was sent. Try again when you have signal.' };
    return { ok: false, refresh: false, text: 'Nothing was sent (' + r + '). Tell Lloyd.' };
  }
  function requestStatus(r) {
    if (!r) return { label: '', tone: 'neutral' };
    if (r.status === 'paid') return { label: 'Paid ' + (r.paid_at ? shortDate(r.paid_at) : ''), tone: 'ok' };
    if (r.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
    if (r.status === 'paying') return { label: 'Being paid', tone: 'info' };
    return { label: 'Waiting for payment', tone: 'warn' };
  }

  // Photo size for the receipt upload: longest side 1600 px, never enlarged. The server caps a file at 5 MB.
  function fitSize(w, h, max) {
    max = max || 1600; var k = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }

  // ---- bank.html (SPEC-37 7.B, 7.C): only apps whose ids are verified are listed. None is verified yet, so none is offered.
  var BANK_APPS = {
    gcash: { name: 'GCash', pkg: 'com.globe.gcash.android', ios: 'gcash://', store: 'https://apps.apple.com/ph/app/gcash/id520020791', verified: false },
    bpi: { name: 'BPI', pkg: null, ios: null, store: null, verified: false },
    ownbank: { name: 'OwnBank', pkg: null, ios: null, store: null, verified: false }
  };
  function listedBankApps(table) { table = table || BANK_APPS; return Object.keys(table).filter(function (k) { return table[k].verified && table[k].pkg; }); }
  function playUrl(pkg) { return 'https://play.google.com/store/apps/details?id=' + pkg; }
  // Android intent link with the Play page as the fallback; null for an app that is not verified.
  function bankIntentUrl(key, table) {
    var a = (table || BANK_APPS)[key]; if (!a || !a.verified || !a.pkg) return null;
    return 'intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=' + a.pkg + ';S.browser_fallback_url=' + encodeURIComponent(playUrl(a.pkg)) + ';end';
  }

  return {
    peso: peso, plain: plain, dateLabel: dateLabel, shortDate: shortDate, typeLabel: typeLabel, parseExtra: parseExtra, sessionAmount: sessionAmount,
    chosen: chosen, computeTotal: computeTotal, lineCount: lineCount, buildPayload: buildPayload, reviewBlock: reviewBlock, newKey: newKey,
    resultMessage: resultMessage, requestStatus: requestStatus, fitSize: fitSize, BANK_APPS: BANK_APPS, listedBankApps: listedBankApps,
    bankIntentUrl: bankIntentUrl, MAX_EXTRA: MAX_EXTRA, MAX_LINES: MAX_LINES
  };
});
