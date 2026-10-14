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

  // A key names ONE submission: it is kept across retries of a send that failed (so a double tap or a bad signal never makes two
  // requests) and dropped once the server says ok, so the next request is a new submission, not a replay of the last. A changed
  // selection is not a retry either, so it gets a new key. Receipt paths are not part of the selection (they upload under the key).
  function newKey(cryptoObj) {
    var c = cryptoObj || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16); if (c && c.getRandomValues) c.getRandomValues(b); else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // The key is also written to sessionStorage under the selection signature (try/catch, it may be missing or throw): a reload after a
  // lost reply, then the same lines entered again, must not make a second request. Spent on ok (settle); extras-only requests have no
  // session or claim for the server to refuse the second time, so the key is their only guard. storage: pass null to turn it off.
  var STORE_KEY = 'cs-pay-inflight';
  function keyKeeper(cryptoObj, storage) {
    var key = null, sig = null;
    var st = storage;
    if (st === undefined) { try { st = typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch (e) { st = null; } }
    function read() { try { var m = st && JSON.parse(st.getItem(STORE_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } }
    function write(m) { try { if (st) st.setItem(STORE_KEY, JSON.stringify(m)); } catch (e) { /* no storage: the in-memory key still guards this page */ } }
    return {
      forSelection: function (cands, sel) {
        var c = chosen(cands, sel);
        var s = JSON.stringify([c.sessions.map(function (x) { return [x.s.id, x.transport]; }), c.claims.map(function (x) { return x.id; }),
          c.extras.map(function (x) { return [x.description, x.amount]; })]);
        if (!key || s !== sig) {
          var m = read();
          key = typeof m[s] === 'string' && m[s] ? m[s] : newKey(cryptoObj); sig = s;
          m[s] = key; write(m);
        }
        return key;
      },
      settle: function (res) {
        if (res && res.ok) { var m = read(); if (sig) delete m[sig]; write(m); key = null; sig = null; } // sent (or already sent): the key is spent
      }
    };
  }

  // The words after a send (SPEC-37 7.A). ok -> {ok:true, refresh:false}; the two taken reasons ask for a refreshed list.
  // replay:true means the server already had this submission: say "already sent" with the ORIGINAL ref, never a fresh success.
  function resultMessage(res) {
    if (res && res.ok && res.replay) return { ok: true, replay: true, refresh: false, text: 'This request was already sent, so nothing new was made. Finance has it for ' + peso(res.total) + ' (Ref ' + String(res.ref || '').replace(/^CASCADE-/, '') + '). You will see it in OPS when it is paid.' };
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

  // ---- P_ (s84): the pay-rates form has unsaved edits when any typed field is filled. The date and the error line are not edits.
  // app.js (not this lane) asks once before leaving the screen or closing the confirm sheet while this is true; Cancel keeps the edits.
  function P_rateDirty(f) { return !!(f && (f.regular || f.general || f.transport || f.note)); }

  // ---- P_ (s82 lane P): the shared chrome of both pay pages, so they look like the rest of the app (F7). Strings only; the caller passes ICON and esc.
  // Badge counts and "I came from the app" travel in the URL hash the shell links with: pay/#tasks=2&cal=2 (a hash with either key means the link was the shell's).
  function P_hashCounts(hash) {
    var o = { tasks: 0, cal: 0 };
    String(hash || '').replace(/^#/, '').split('&').forEach(function (p) { var kv = p.split('='); if ((kv[0] === 'tasks' || kv[0] === 'cal') && /^\d{1,3}$/.test(kv[1] || '')) o[kv[0]] = +kv[1]; });
    return o;
  }
  function P_fromShell(hash) { return /(^#|&)(tasks|cal)=/.test(String(hash || '')); }
  // The pages send "no-referrer", so document.referrer is empty even from the app: the hash is the second witness.
  function P_backIsHistory(referrer, origin, hash, histLen) {
    if (!(histLen > 1)) return false;
    var r = String(referrer || ''), o = String(origin || '');
    return (!!o && !!r && (r === o || r.indexOf(o + '/') === 0)) || P_fromShell(hash);
  }
  function P_tabs(hash, ICON, esc) {
    var n = P_hashCounts(hash);
    var tabs = [['home', '../#home', 'Today', 'house', 0, ''], ['calendar', '../#calendar', 'Calendar', 'calendar', n.cal, ' warnings'], ['tasks', '../#tasks', 'Tasks', 'tasks', n.tasks, ' due'], ['more', '../#more', 'More', 'more', 0, '']];
    return tabs.map(function (t) {
      return '<a class="tab" href="' + t[1] + '"' + (t[0] === 'home' ? ' aria-current="page"' : '') + '><span class="ico">' + ICON(t[3], 's24') + '</span>' + esc(t[2]) +
        (t[4] ? '<span class="badge" aria-label="' + t[4] + t[5] + '">' + t[4] + '</span>' : '') + '</a>';
    }).join('');
  }
  // back: an in-page href (e.g. "#back") that the page handles itself; left out, Back is the app's home or the browser's Back (P_wireBack).
  function P_shell(title, inner, o) {
    o = o || {}; var ICON = o.icon, esc = o.esc;
    return '<header class="appbar"><a class="iconbtn" href="' + esc(o.back || '../#home') + '" aria-label="Back"' + (o.back ? '' : ' data-p-back="1"') + '>' + ICON('back', 's24') + '</a><h1 class="ttl">' + esc(title) + '</h1></header>' +
      '<div class="screen">' + inner + '</div><nav class="tabbar" aria-label="Primary">' + P_tabs(o.hash, ICON, esc) + '</nav>';
  }
  function P_wireBack(win) {
    var d = win && win.document; if (!d || !d.addEventListener) return;
    d.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest && ev.target.closest('a[data-p-back]');
      if (!a || ev.defaultPrevented) return; // a page that handled Back itself (inside a pay view) has already prevented it
      var l = win.location || {}, h = win.history || {};
      if (P_backIsHistory(d.referrer, l.origin, l.hash, h.length)) { ev.preventDefault(); h.back(); }
    });
  }
  function P_param(search, name) { var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(String(search || '')); try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } }
  function P_hash(win) { try { return (win && win.location && win.location.hash) || ''; } catch (e) { return ''; } }
  function P_plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }

  return {
    P_rateDirty: P_rateDirty, P_hashCounts: P_hashCounts, P_fromShell: P_fromShell, P_backIsHistory: P_backIsHistory, P_tabs: P_tabs, P_shell: P_shell, P_wireBack: P_wireBack, P_param: P_param, P_hash: P_hash, P_plural: P_plural,
    peso: peso, plain: plain, dateLabel: dateLabel, shortDate: shortDate, typeLabel: typeLabel, parseExtra: parseExtra, sessionAmount: sessionAmount,
    chosen: chosen, computeTotal: computeTotal, lineCount: lineCount, buildPayload: buildPayload, reviewBlock: reviewBlock, newKey: newKey, keyKeeper: keyKeeper,
    resultMessage: resultMessage, requestStatus: requestStatus, fitSize: fitSize,
    MAX_EXTRA: MAX_EXTRA, MAX_LINES: MAX_LINES
  };
});
