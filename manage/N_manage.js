/* Cascade Staff 3.1, lane N: Manage. Phone-native admin core screens (Today, Inquiries, Money, KPIs) for owner and admin.
   Reads and writes the SAME database through the SAME RPCs as the React dashboard (admin-dashboard/app/src), so both stay in sync by construction.
   Call shapes are copied from the dashboard call sites quoted next to each call. Business rules stay on the server; the only client logic is
   formatting, form checks and the period maths that the dashboard also does in the browser (periodPreset, comparablePeriod, pctDelta).
   Mounted by the shell: window.N_Manage.mount(el, { client, demo, role, sub, navigate, toast, haptic, propertyId? }).
   Only localStorage keys: cs_n_tab, cs_n_period. No build step; plain script; every top-level name is N_ or inside this closure. */
(function () {
  'use strict';

  // ------------------------------------------------------------------------------------------------ pure helpers (tested)
  var FALLBACK_PROPERTY = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'; // same constant as app.js CFG.propertyId; the shell may pass opts.propertyId
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var TABS = ['today', 'inquiries', 'money', 'kpis'];
  var TAB_LABEL = { today: 'Today', inquiries: 'Inquiries', money: 'Money', kpis: 'KPIs' };
  var NO_CONNECTION = 'No connection, so nothing was sent.';
  var DROPPED = 'The connection dropped before an answer came. Tap again; a repeat is safe.';

  var clock = function () { return Date.now(); };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function canManage(role) { return role === 'owner' || role === 'admin'; }

  function isoOf(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function utc(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function manilaToday(ms) { return isoOf((ms == null ? clock() : ms) + 8 * 3600000); } // Asia/Manila is UTC+8 with no daylight saving
  function addDays(iso, n) { return isoOf(utc(iso) + n * 86400000); }
  function nightsBetween(a, b) { return Math.max(0, Math.round((utc(b) - utc(a)) / 86400000)); }
  function fmtDate(iso, style) {
    if (!iso) return '—';
    var d = new Date(utc(iso)), s = d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
    if (style === 'long') return s + ' ' + d.getUTCFullYear();
    if (style === 'weekday') return DOW[d.getUTCDay()] + ' ' + s;
    return s;
  }
  function fmtDateTime(ts) { // Manila wall clock, "13 Oct, 2:30 pm"
    var ms = Date.parse(ts); if (!isFinite(ms)) return '—';
    var d = new Date(ms + 8 * 3600000), h = d.getUTCHours(), ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 || 12;
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ', ' + h12 + ':' + pad2(d.getUTCMinutes()) + ' ' + ap;
  }
  function relDay(iso, today) {
    if (iso === today) return 'Today'; if (iso === addDays(today, 1)) return 'Tomorrow'; if (iso === addDays(today, -1)) return 'Yesterday';
    return fmtDate(iso, 'weekday');
  }

  // money: decimal strings, integer centavos (same contract as dashboard lib/money.ts)
  function toCentavos(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = typeof v === 'number' ? v.toFixed(2) : String(v).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var neg = s.charAt(0) === '-', parts = s.replace('-', '').split('.'), cents = Number(parts[0]) * 100 + Number(((parts[1] || '') + '00').slice(0, 2));
    return neg ? -cents : cents;
  }
  function fromCentavos(c) { var neg = c < 0, a = Math.abs(c); return (neg ? '-' : '') + Math.floor(a / 100) + '.' + pad2(a % 100); }
  var PHP = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  function formatPHP(v) { var c = toCentavos(v); if (c === null) return '—'; return PHP ? PHP.format(c / 100) : 'PHP ' + (c / 100).toFixed(2); }
  function formatPercent(v, digits) { if (v === null || v === undefined || v === '') return '—'; var n = Number(v); return isFinite(n) ? n.toFixed(digits == null ? 1 : digits) + '%' : '—'; }
  function formatNumber(v, digits) {
    if (v === null || v === undefined || v === '') return '—'; var n = Number(v); if (!isFinite(n)) return '—';
    return n.toLocaleString('en-PH', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
  }
  // admin-dashboard/app/src/components/data/kpi-card.tsx:15 formatMetricValue
  function formatMetricValue(m) {
    if (!m || m.value === null || m.value === undefined) return 'Not available';
    if (m.unit === 'PHP') return formatPHP(m.value);
    if (m.unit === 'percent') return formatPercent(m.value);
    return formatNumber(m.value, m.unit === 'day' ? 1 : 0);
  }
  // a typed amount ("5,073" or "PHP 5073.5") -> "5073.50"; null when not above zero or more than two decimals (confirm-model.ts:67 parseAmount)
  function parseAmount(text) {
    var clean = String(text == null ? '' : text).replace(/[,\s]|^(PHP|₱)/gi, '');
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
    var c = toCentavos(clean); return c !== null && c > 0 ? fromCentavos(c) : null;
  }

  // periods: admin-dashboard/app/src/lib/dates.ts periodPreset / comparablePeriod, ported with UTC calendar maths (Manila dates are plain calendar dates)
  var PRESETS = [['mtd', 'Month to date'], ['qtd', 'Quarter to date'], ['ytd', 'Year to date'], ['prev-month', 'Previous month'], ['prev-quarter', 'Previous quarter'], ['prev-year', 'Previous year'], ['last30', 'Last 30 nights'], ['last90', 'Last 90 nights']];
  function periodPreset(key, today) {
    var p = today.split('-'), y = +p[0], m = +p[1] - 1, d = +p[2], first = function (yy, mm) { return isoOf(Date.UTC(yy, mm, 1)); };
    switch (key) {
      case 'mtd': return { key: key, start: first(y, m), endExclusive: today, label: d > 1 ? 'Month to date (' + (d - 1) + ' of ' + new Date(Date.UTC(y, m + 1, 0)).getUTCDate() + ' nights elapsed)' : 'Month to date' };
      case 'ytd': return { key: key, start: y + '-01-01', endExclusive: today, label: 'Year to date' };
      case 'last30': return { key: key, start: addDays(today, -30), endExclusive: today, label: 'Last 30 nights' };
      case 'last90': return { key: key, start: addDays(today, -90), endExclusive: today, label: 'Last 90 nights' };
      case 'prev-month': return { key: key, start: first(y, m - 1), endExclusive: first(y, m), label: 'Previous month' };
      case 'qtd': return { key: key, start: first(y, Math.floor(m / 3) * 3), endExclusive: today, label: 'Quarter to date' };
      case 'prev-quarter': { var q = Math.floor(m / 3) * 3; return { key: key, start: first(y, q - 3), endExclusive: first(y, q), label: 'Previous quarter' }; }
      case 'prev-year': return { key: key, start: (y - 1) + '-01-01', endExclusive: y + '-01-01', label: 'Previous year' };
      default: return periodPreset('mtd', today);
    }
  }
  function comparablePeriod(per, mode) {
    var s = per.start.split('-'), len = nightsBetween(per.start, per.endExclusive);
    var start = mode === 'month' ? isoOf(Date.UTC(+s[0], +s[1] - 2, +s[2])) : isoOf(Date.UTC(+s[0] - 1, +s[1] - 1, +s[2]));
    return { key: per.key + '-cmp-' + mode, start: start, endExclusive: addDays(start, len), label: 'Same elapsed period, previous ' + mode };
  }
  // insights-page.tsx:587 picks the comparison mode this way
  function compareMode(key) { return ['ytd', 'prev-year', 'qtd', 'prev-quarter'].indexOf(key) >= 0 ? 'year' : 'month'; }
  // insights-page.tsx:62 pctDelta and :65 fmtDeltaPct
  function pctDelta(cur, prior) { return isFinite(cur) && isFinite(prior) && prior !== 0 ? ((cur - prior) / Math.abs(prior)) * 100 : null; }
  function fmtDeltaPct(v) { return v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(0) + '%'; }
  function num(v) { return v === null || v === undefined ? NaN : Number(v); } // dates/money.ts decimalToNumber: null is "not available", never 0
  // The delta line under one KPI: occupancy-like percent units show points (insights-page.tsx:147), everything else a percent change.
  function deltaLine(cur, prev) {
    if (!cur || !prev || prev.value === null || prev.value === undefined) return { text: prev ? 'Before: not available' : '', dir: '' };
    var c = num(cur.value), p = num(prev.value), before = 'Before: ' + formatMetricValue(prev);
    if (!isFinite(c) || !isFinite(p)) return { text: before, dir: '' };
    var change;
    if (cur.unit === 'percent') { var pts = c - p; change = (pts >= 0 ? '+' : '') + pts.toFixed(0) + ' pts'; if (Math.abs(pts) < 0.5) change = ''; return { text: before + (change ? ' · ' + change : ''), dir: !change ? '' : pts > 0 ? 'up' : 'down' }; }
    var pc = pctDelta(c, p); if (pc === null) return { text: before, dir: '' };
    return { text: before + ' · ' + fmtDeltaPct(pc), dir: Math.round(pc) === 0 ? '' : pc > 0 ? 'up' : 'down' };
  }
  // insights-page.tsx:44 ORDER and :31 DEFS (titles). Groups are a phone layout only; every metric is one of the dashboard's twelve.
  var KPI_GROUPS = [
    { title: 'Stays', keys: ['occupancy', 'sold_nights', 'future_booked_nights', 'average_length_of_stay'] },
    { title: 'Revenue', keys: ['accommodation_revenue', 'adr', 'revpar'] },
    { title: 'Money', keys: ['cash_received', 'expected_payout'] },
    { title: 'Guests', keys: ['returning_guest_rate', 'cancellation_rate', 'booking_lead_time'] }
  ];
  var KPI_TITLE = { occupancy: 'Occupancy', adr: 'Accommodation ADR', revpar: 'RevPAR', accommodation_revenue: 'Accommodation revenue', cash_received: 'Cash received', expected_payout: 'Expected payout', sold_nights: 'Sold nights', future_booked_nights: 'Future booked nights', average_length_of_stay: 'Average length of stay', returning_guest_rate: 'Returning-guest rate', cancellation_rate: 'Cancellation rate', booking_lead_time: 'Booking lead time' };

  // ---- inquiries: confirm-model.ts ----
  function str(v) { return typeof v === 'string' && v.trim() !== '' ? v : null; }
  function amountStr(v) { return (typeof v === 'string' || typeof v === 'number') ? (toCentavos(v) === null ? null : String(v)) : null; }
  function normalizePayments(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (o) {
      o = o || {}; var id = str(o.id); if (!id) return;
      out.push({ id: id, booking_ref: str(o.booking_ref), guest_name: str(o.guest_name), checkin_date: str(o.checkin_date), checkout_date: str(o.checkout_date), pax: typeof o.pax === 'number' ? o.pax : null,
        expected_amount: amountStr(o.expected_amount), comparison_id: str(o.comparison_id), candidate_amount: amountStr(o.candidate_amount), reference: str(o.reference), receipt_image_path: str(o.receipt_image_path), hold_expires_at: str(o.hold_expires_at) });
    });
    return out;
  }
  function hasReceipt(p) { return !!(p && p.comparison_id); }
  function paymentLine(p) {
    if (!hasReceipt(p)) return 'No receipt yet';
    var parts = ['Receipt on file']; if (p.candidate_amount !== null) parts.push(formatPHP(p.candidate_amount)); if (p.reference) parts.push('ref ...' + p.reference.slice(-4));
    return parts.join(' · ');
  }
  var METHODS = [['messenger_gcash', 'GCash via Messenger'], ['gcash_qr', 'GCash QR'], ['bank', 'Bank'], ['cash', 'Cash'], ['other', 'Other']];
  function methodLabel(v) { for (var i = 0; i < METHODS.length; i++) if (METHODS[i][0] === v) return METHODS[i][1]; return v; }
  function validateConfirm(f, payment) {
    var e = {}, receipt = hasReceipt(payment);
    if (receipt && !f.checked) e.checked = 'Tick the box once you have checked the money arrived.';
    if (parseAmount(f.amount) === null) e.amount = 'Enter the amount received, more than zero, with at most two decimal places.';
    var needsRef = receipt ? !payment.reference : f.method !== 'cash';
    if (needsRef && !String(f.reference || '').trim()) e.reference = 'Enter the payment reference.';
    if (!receipt && f.method === 'cash' && !String(f.note || '').trim()) e.note = 'Add a short note about the cash, for example who handed it over.';
    return e;
  }
  // confirm-model.ts:98 confirmArgs: the argument keys are the RPC's, in the dashboard's order
  function confirmArgs(bookingId, f, payment, key) {
    var receipt = hasReceipt(payment), method = receipt ? 'messenger_gcash' : f.method;
    var reference = String(receipt && payment.reference ? payment.reference : (f.reference || '')).trim();
    return { p_booking_id: bookingId, p_method: method, p_reference: reference === '' || (!receipt && method === 'cash') ? null : reference, p_amount: parseAmount(f.amount),
      p_note: String(f.note || '').trim() === '' ? null : String(f.note).trim(), p_comparison_id: receipt ? payment.comparison_id : null, p_idempotency_key: key };
  }
  function confirmSentence(r) {
    r = r || {};
    switch (r.outcome) {
      case 'confirmed': return 'Booking confirmed for ' + (r.guest_name || 'the guest') + (r.checkin && r.checkout ? ', ' + fmtDate(r.checkin, 'long') + ' to ' + fmtDate(r.checkout, 'long') : '') + '.';
      case 'conflict': return 'These dates clash with another stay, so nothing was confirmed.';
      case 'invalid_state': return 'This booking is no longer waiting for a decision. Nothing was changed.';
      case 'reference_reused': return 'That payment reference was already used for booking ' + (r.prior_ref || 'another booking') + ', so nothing was confirmed.';
      case 'amount_required': return 'Enter the amount received, more than zero.';
      case 'reference_required': return 'Enter the payment reference.';
      case 'note_required': return 'Add a short note about the cash, for example who handed it over.';
      case 'not_linked': return 'Your account is not linked to a staff profile that can confirm bookings.';
      case 'denied': return 'Your account is not allowed to confirm bookings.';
      default: return 'Nothing was confirmed. Please try again.';
    }
  }
  function declineSentence(r) {
    r = r || {};
    if (r.ok === true) return 'Request declined' + (r.guest_name ? ' for ' + r.guest_name : '') + '.';
    switch (r.outcome) {
      case 'invalid_state': return 'This booking is no longer waiting for a decision. Nothing was changed.';
      case 'note_required': return 'Choose or write a reason first.';
      case 'denied': return 'Your account is not allowed to decline bookings.';
      default: return 'Nothing was declined. Please try again.';
    }
  }
  var DECLINE_REASONS = ['Dates not available', 'No payment received', 'Guest asked to cancel', 'Duplicate request'];
  function declineReason(chip, text) { var t = String(text || '').trim(); return [chip, t].filter(Boolean).join(': ') || null; }

  // ---- expense: transactions-page.tsx:38 CATEGORIES.expense and :47 blank() ----
  var EXPENSE_CATEGORIES = ['cleaning', 'supplies', 'utilities', 'internet', 'subscription', 'maintenance', 'furnishing', 'cohost_fee', 'guest_refund', 'airbnb_adjustment', 'loan', 'other'];
  function catLabel(c) { return String(c).replace(/_/g, ' '); }
  function validateExpense(f) {
    var e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.date = 'Choose the date of the expense.';
    if (parseAmount(f.amount) === null) e.amount = 'Enter the amount, more than zero, with at most two decimal places.';
    if (EXPENSE_CATEGORIES.indexOf(f.category) < 0) e.category = 'Choose a category.';
    if (!String(f.notes || '').trim()) e.notes = 'Say what it was for.';
    return e;
  }
  // The p_txn object has exactly the keys the dashboard's blank() draft carries for an expense.
  function expenseTxn(f) {
    return { txn_type: 'expense', category: f.category, transaction_date: f.date, gross_amount: parseAmount(f.amount), payee_name: String(f.payee || '').trim(), notes: String(f.notes || '').trim(), or_number: '', reason: '' };
  }

  // ---- errors: plain words ----
  function errCode(e) { return e && (e.code || (e.error && e.error.code)) || ''; }
  function errMsg(e) { return String((e && (e.message || (e.error && e.error.message))) || e || ''); }
  function isMissing(e) { var c = String(errCode(e)), m = errMsg(e); return c === 'PGRST202' || c === '42883' || c === '42P01' || c === 'PGRST205' || e && e.status === 404 || /could not find the function|does not exist|schema cache/i.test(m); }
  function isDenied(e) { var c = String(errCode(e)), m = errMsg(e); return c === '42501' || e && (e.status === 401 || e.status === 403) || /not authori|permission denied/i.test(m); }
  function isOffline(e) { var m = errMsg(e); return /failed to fetch|networkerror|network request failed|load failed|timeout|fetch failed/i.test(m) || (e && e.status === 0); }
  function plainError(e, writing) {
    if (isOffline(e)) return writing ? DROPPED : 'No connection.'; // NO_CONNECTION is only for a request that was never sent
    if (isDenied(e)) return 'Your account is not allowed to do this.';
    if (writing && (String(errCode(e)) === '22023' || String(errCode(e)) === 'P0002') && errMsg(e)) return errMsg(e); // the server's own reason (escaped when drawn)
    return writing ? 'The server did not answer clearly. Check the list before you try again.' : 'This could not be loaded.';
  }

  // ------------------------------------------------------------------------------------------------ demo sample (no network)
  function demoData(today) {
    var d = function (n) { return addDays(today, n); };
    return {
      overview: { today: today, sourceAsOf: null, calendarSync: null,
        currentStays: [{ kind: 'direct', id: 'n-demo-s1', guest: 'Sample Guest A', checkin: d(-1), checkout: d(2) }],
        arrivals: [], departures: [{ kind: 'direct', id: 'n-demo-s1', guest: 'Sample Guest B', checkin: d(-3), checkout: today }],
        nextArrival: { kind: 'direct', id: 'n-demo-s2', guest: 'Sample Guest C', checkin: d(1), checkout: d(3), daysUntil: 1 },
        readiness: { state: 'awaiting_review', lastCleaning: null, review: null, blockingWorkOrders: 0, lastCheckout: today, nextCheckin: d(1), daysOverdue: null },
        blockingWorkOrders: [], lowStock: [{ id: 'n-demo-i1', name: 'Sample item', qty: '2', unit: 'pcs', reorderBelow: '4', out: false }], followUps: [], handoffs: [],
        finance: { pendingReviewCount: 1, pendingReviewAmount: '1200.00', paymentReviewCount: 0, unpaidCleanerFees: 2 }, notices: [], actions: [] },
      inquiries: [
        { id: 'n-demo-q1', booking_ref: 'DEMO0001', guest_name: 'Sample Guest D', checkin_date: d(5), checkout_date: d(7), pax: 2, expected_amount: '2500.00', comparison_id: 'n-demo-c1', candidate_amount: '2500.00', reference: 'DEMO1234', receipt_image_path: 'n/a', hold_expires_at: null },
        { id: 'n-demo-q2', booking_ref: 'DEMO0002', guest_name: 'Sample Guest E', checkin_date: d(12), checkout_date: d(15), pax: 3, expected_amount: '4100.00', comparison_id: null, candidate_amount: null, reference: null, receipt_image_path: null, hold_expires_at: null }
      ],
      txns: [
        { id: 'n-demo-t1', transaction_date: d(-1), txn_type: 'expense', category: 'supplies', gross_amount: '640.00', payee_name: 'Sample shop', notes: 'Sample: kitchen supplies', status: 'confirmed' },
        { id: 'n-demo-t2', transaction_date: d(-2), txn_type: 'income', category: 'direct_income', gross_amount: '5000.00', payee_name: null, notes: 'Sample: deposit', status: 'confirmed' }
      ],
      metrics: function (start, end) { // a flat sample so every period renders; the "before" period is a little lower
        var f = start < d(-40) ? 0.9 : 1, mk = function (key, unit, v) { return { key: key, value: v === null ? null : String((v * f).toFixed(unit === 'PHP' ? 2 : 1)), unit: unit, coverage: 'complete', periodStart: start, periodEndExclusive: end }; };
        var m = {}; [['occupancy', 'percent', 62], ['sold_nights', 'night', 14], ['future_booked_nights', 'night', 9], ['average_length_of_stay', 'day', 2.5], ['accommodation_revenue', 'PHP', 31000], ['adr', 'PHP', 2214], ['revpar', 'PHP', 1372],
          ['cash_received', 'PHP', 28000], ['expected_payout', 'PHP', 6000], ['returning_guest_rate', 'percent', 12], ['cancellation_rate', 'percent', 5], ['booking_lead_time', 'day', 18]].forEach(function (r) { m[r[0]] = mk(r[0], r[1], r[2]); });
        return { propertyId: 'demo', periodStart: start, periodEndExclusive: end, sourceAsOf: null, financeVisible: true, blockedNights: 0, metrics: m };
      }
    };
  }

  // ------------------------------------------------------------------------------------------------ mounted module
  var S = null, N_gen = 0; // state of the mounted instance; null when not mounted

  function ls(op, k, v) { try { var s = (typeof localStorage !== 'undefined') ? localStorage : null; if (!s) return null; return op === 'get' ? s.getItem(k) : s.setItem(k, v); } catch (e) { return null; } }
  function newKeyDefault(prefix) {
    var hex = '';
    try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { var a = new Uint8Array(16); crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) hex += pad2(a[i].toString(16)).slice(-2); } } catch (e) { hex = ''; }
    while (hex.length < 32) hex += Math.floor(Math.random() * 16).toString(16);
    return prefix + '-' + hex; // 41 chars: inside the RPCs' 16..120 range
  }
  function mintKey(prefix) { return (S && S.opts.newKey ? S.opts.newKey : newKeyDefault)(prefix); }
  function pid() { return (S && S.opts.propertyId) || FALLBACK_PROPERTY; }
  function online() { try { return !(typeof navigator !== 'undefined' && navigator.onLine === false); } catch (e) { return true; } }

  // one RPC call with the exact name and argument keys; resolves {data,error} and never throws
  var RPC_TIMEOUT_MS = 30000;
  // A hung request must not keep a sheet busy for ever: after 30 s it settles as a dropped connection (a late answer is ignored).
  function callRpc(name, args) {
    var st = S;
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { fin({ data: null, error: { message: 'timeout' } }); }, RPC_TIMEOUT_MS);
      st.timers = st.timers || []; st.timers.push(t);
      function fin(r) { if (done) return; done = true; clearTimeout(t); resolve(r); }
      try { Promise.resolve(st.client.rpc(name, args)).then(function (r) { fin(r || { data: null, error: null }); }, function (e) { fin({ data: null, error: e || { message: 'failed to fetch' } }); }); }
      catch (e) { fin({ data: null, error: e }); }
    });
  }

  function setTab(t, replace) {
    if (TABS.indexOf(t) < 0) t = 'today';
    S.tab = t; ls('set', 'cs_n_tab', t); S.sheet = null;
    if (replace) { try { history.replaceState(null, '', t === 'today' ? '#manage' : '#manage/' + t); } catch (e) { /* no history in tests */ } }
    draw(); loadTab(t, false);
  }

  function loadTab(t, force) {
    if (t === 'today') { load('overview', force); load('inq', force); }
    else if (t === 'inquiries') load('inq', force);
    else if (t === 'money') load('txns', force);
    else if (t === 'kpis') load('kpi', force);
  }
  function stale() { return clock() - (S.loadedAt || 0) > 5 * 60000; }

  // load(kind): each kind has its own state { ok, data, err, absent, busy }. A missing RPC sets absent and hides that section.
  function load(kind, force) {
    S.today = manilaToday(); // a screen opened past midnight uses today's periods
    var st = S.d[kind] || (S.d[kind] = {}); if (st.busy) return; if (st.ok && !force && !stale()) return;
    st.busy = true; st.err = ''; var gen = S.gen, key = kind === 'kpi' ? S.period : '';
    draw();
    var done = function (res) {
      if (!S || S.gen !== gen) return; st.busy = false;
      if (res.error) { if (isMissing(res.error)) { st.absent = true; st.ok = false; } else if (isDenied(res.error)) { st.denied = true; st.ok = false; } else { st.err = plainError(res.error, false); st.ok = false; } }
      else { st.ok = true; st.absent = false; st.denied = false; st.data = res.data; S.loadedAt = clock(); }
      if (kind === 'kpi' && key !== S.period) { st.ok = false; loadTab('kpis', true); return; }
      draw();
    };
    if (S.demo) { // built-in sample, no network
      var dd = S.demoData, per = periodPreset(S.period, S.today), cmp = comparablePeriod(per, compareMode(S.period));
      var sample = kind === 'overview' ? dd.overview : kind === 'inq' ? normalizePayments(dd.inquiries) : kind === 'txns' ? dd.txns : { now: dd.metrics(per.start, per.endExclusive), prev: dd.metrics(cmp.start, cmp.endExclusive) };
      Promise.resolve().then(function () { done({ data: sample, error: null }); }); return;
    }
    if (!online() || !S.client) { Promise.resolve().then(function () { done({ data: null, error: { message: 'failed to fetch' } }); }); return; }
    if (kind === 'overview') {
      callRpc('get_admin_overview_v1', { p_property_id: pid() }).then(done); // admin-dashboard features/today/api.ts:31
    } else if (kind === 'inq') {
      callRpc('staff_inquiry_payments_v1', { p_property_id: pid() }).then(function (r) { done(r.error ? r : { data: normalizePayments(r.data), error: null }); }); // features/bookings/confirm-api.ts:13
    } else if (kind === 'txns') {
      var q; // features/finance/api.ts:36-45 the default list: not void, not hidden, not the Airbnb mirror rows; limited to the newest ten
      try {
        q = S.client.from('transactions').select('id, transaction_date, txn_type, category, status, source, gross_amount, payee_name, notes, created_at').eq('property_id', pid())
          .neq('status', 'void').is('hidden_at', null).not('source', 'in', '("airbnb","airbnb_email")').order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).limit(10);
      } catch (e) { done({ data: null, error: e }); return; }
      Promise.resolve(q).then(function (r) { done(r || { data: null, error: { message: 'failed to fetch' } }); }, function (e) { done({ data: null, error: e }); });
    } else if (kind === 'kpi') {
      var p1 = periodPreset(S.period, S.today), p2 = comparablePeriod(p1, compareMode(S.period));
      var get = function (p) { return callRpc('get_hospitality_metrics_v1', { p_property_id: pid(), p_start: p.start, p_end_exclusive: p.endExclusive }); }; // features/insights/api.ts:9
      Promise.all([get(p1), get(p2)]).then(function (rs) { done(rs[0].error ? rs[0] : { data: { now: rs[0].data, prev: rs[1].error ? null : rs[1].data }, error: null }); });
    }
  }

  // ---------------------------------------------------------------------------------------------- views (string templates)
  function glyph(kind) { return kind === 'ok' ? '✓' : kind === 'warn' ? '!' : kind === 'bad' ? '✕' : '•'; }
  function pill(kind, text) { return '<span class="N_pill N_' + kind + '"><span aria-hidden="true">' + glyph(kind) + '</span> ' + esc(text) + '</span>'; }
  function head(title, sub) { return '<h2 class="N_h">' + esc(title) + '</h2>' + (sub ? '<p class="N_sub">' + esc(sub) + '</p>' : ''); }
  function stateBox(st, what, tab) {
    if (st.absent) return '<div class="N_note">' + esc(what) + ' is not available in this version of the app yet.</div>';
    if (st.denied) return '<div class="N_note">Your account is not allowed to see ' + esc(what.toLowerCase()) + '. Ask the owner if you need it.</div>';
    if (st.err) return '<div class="N_err" role="alert"><span>' + esc(st.err) + '</span><button class="btn btn-secondary btn-sm" type="button" data-n="retry" data-v="' + tab + '">Try again</button></div>';
    if (st.busy || !st.ok) return '<div class="N_note" role="status">Loading…</div>';
    return '';
  }
  function dashLink(route, text, sub) {
    return '<a class="N_row" href="#door/dashboard/' + route + '" data-n="go" data-v="' + route + '"><span class="N_rowmid"><span class="N_rowt">' + esc(text) + '</span>' + (sub ? '<span class="N_rows">' + esc(sub) + '</span>' : '') + '</span><span class="N_chev" aria-hidden="true">›</span></a>';
  }
  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function viewToday() {
    var ov = S.d.overview || {}, iq = S.d.inq || {}, out = '';
    var box = stateBox(ov, 'Today', 'today');
    if (box) out += box;
    if (ov.ok) {
      var o = ov.data || {}, today = o.today || S.today, names = function (a) { return (a || []).map(function (s) { return s.guest || 'A guest'; }).join(', '); };
      out += '<section class="N_card" aria-labelledby="N_t1"><h3 class="N_h3" id="N_t1">' + esc(fmtDate(today, 'weekday')) + '</h3><dl class="N_dl">';
      out += '<dt>Arriving today</dt><dd>' + (o.arrivals && o.arrivals.length ? esc(names(o.arrivals)) : 'Nobody') + '</dd>';
      out += '<dt>Leaving today</dt><dd>' + (o.departures && o.departures.length ? esc(names(o.departures)) : 'Nobody') + '</dd>';
      out += '<dt>In the house</dt><dd>' + (o.currentStays && o.currentStays.length ? esc(names(o.currentStays)) : 'Nobody') + '</dd>';
      var na = o.nextArrival; out += '<dt>Next arrival</dt><dd>' + (na ? esc((na.guest || 'A guest') + ', ' + relDay(na.checkin, today)) : 'None booked') + '</dd>';
      out += '</dl></section>';
      var r = o.readiness || {}, rs = r.state || 'unknown', kind = rs === 'ready' ? 'ok' : (rs === 'not_ready' || rs === 'overdue') ? 'bad' : 'warn';
      var rtext = rs === 'overdue' && r.daysOverdue != null ? 'No cleaning report, ' + count(r.daysOverdue, 'day', 'days') + ' overdue' : { ready: 'Ready', not_ready: 'Not ready', unknown: 'Not known yet', awaiting_review: 'Cleaned, awaiting your review' }[rs] || 'Not known yet';
      out += '<section class="N_card" aria-labelledby="N_t2"><h3 class="N_h3" id="N_t2">Property readiness</h3><p>' + pill(kind, rtext) + '</p>';
      if (r.blockingWorkOrders > 0) out += '<p class="N_p">' + esc(count(r.blockingWorkOrders, 'work order blocks', 'work orders block') + ' the next arrival.') + '</p>';
      out += '</section>';
      // what needs a decision
      var rows = '', fin = o.finance, nIq = iq.ok ? (iq.data || []).length : (o.actions || []).filter(function (a) { return a.kind === 'inquiry'; }).length;
      if (nIq > 0) rows += '<button class="N_row" type="button" data-n="tab" data-v="inquiries"><span class="N_rowmid"><span class="N_rowt">' + esc(count(nIq, 'inquiry waiting', 'inquiries waiting')) + '</span><span class="N_rows">Confirm or decline</span></span><span class="N_chev" aria-hidden="true">›</span></button>';
      if (fin && fin.paymentReviewCount > 0) rows += dashLink('finance', count(fin.paymentReviewCount, 'payment to review', 'payments to review'), 'Opens the dashboard');
      if (fin && fin.pendingReviewCount > 0) rows += dashLink('finance', count(fin.pendingReviewCount, 'transaction awaits review', 'transactions await review'), formatPHP(fin.pendingReviewAmount));
      if (fin && fin.unpaidCleanerFees > 0) rows += '<a class="N_row" href="./pay/admin.html"><span class="N_rowmid"><span class="N_rowt">' + esc(count(fin.unpaidCleanerFees, 'cleaning fee unpaid', 'cleaning fees unpaid')) + '</span><span class="N_rows">Opens Pay staff</span></span><span class="N_chev" aria-hidden="true">›</span></a>';
      if (r.blockingWorkOrders > 0) rows += dashLink('operations/work-orders', count(r.blockingWorkOrders, 'work order blocks arrival', 'work orders block arrival'), 'Opens the dashboard');
      if (o.lowStock && o.lowStock.length) rows += dashLink('inventory', count(o.lowStock.length, 'item low on stock', 'items low on stock'), 'Opens the dashboard');
      out += '<section class="N_card N_list" aria-labelledby="N_t3"><h3 class="N_h3 N_pad" id="N_t3">Needs a decision</h3>' + (rows || '<p class="N_p N_pad">Nothing is waiting for a decision.</p>') + '</section>';
      if (fin === null) out += '<p class="N_foot">Money figures are not available for your role.</p>';
    }
    return out;
  }

  function stayCard(p) {
    var nights = p.checkin_date && p.checkout_date ? nightsBetween(p.checkin_date, p.checkout_date) : null;
    return '<button class="N_card N_tap" type="button" data-n="inq-open" data-v="' + esc(p.id) + '" aria-label="' + esc('Open request from ' + (p.guest_name || 'a guest')) + '">' +
      '<span class="N_cardtop"><span class="N_name">' + esc(p.guest_name || 'A guest') + '</span>' + (hasReceipt(p) ? pill('ok', 'Receipt') : pill('warn', 'No receipt')) + '</span>' +
      '<span class="N_line">' + esc(fmtDate(p.checkin_date, 'weekday') + ' to ' + fmtDate(p.checkout_date, 'weekday') + (nights !== null ? ' · ' + count(nights, 'night', 'nights') : '')) + '</span>' +
      '<span class="N_line N_num">To receive ' + esc(formatPHP(p.expected_amount)) + '</span>' +
      '<span class="N_line">' + esc(paymentLine(p)) + '</span></button>';
  }
  function viewInquiries() {
    var iq = S.d.inq || {}, box = stateBox(iq, 'Inquiries', 'inquiries');
    if (box) return box;
    var rows = iq.data || [];
    if (!rows.length) return '<div class="N_note">No requests are waiting for a decision.</div>';
    return '<p class="N_sub">' + esc(count(rows.length, 'request is', 'requests are') + ' waiting. Tap one to confirm or decline it.') + '</p>' + rows.map(stayCard).join('') +
      '<p class="N_foot"><a class="N_link" href="#door/dashboard/bookings/inquiries" data-n="go" data-v="bookings/inquiries">Open all inquiries in the dashboard</a></p>';
  }

  function viewMoney() {
    var t = S.d.txns || {}, out = '';
    if (!S.d.save || !S.d.save.absent) out += '<button class="btn btn-primary btn-block" type="button" data-n="exp-open">Log an expense</button>';
    else out += '<div class="N_note">Logging an expense is not available in this version of the app yet.</div>';
    var box = stateBox(t, 'The transaction list', 'money');
    out += '<h3 class="N_h3 N_gap">Latest 10 transactions</h3>';
    if (box) out += box;
    else if (!(t.data || []).length) out += '<div class="N_note">No transactions yet.</div>';
    else out += '<section class="N_card N_list">' + t.data.map(function (r) {
      var inc = r.txn_type === 'income', sign = inc ? '+' : r.txn_type === 'expense' ? '−' : '−';
      return '<div class="N_row N_static"><span class="N_rowmid"><span class="N_rowt">' + esc(r.payee_name || r.notes || catLabel(r.category)) + '</span><span class="N_rows">' + esc(fmtDate(r.transaction_date, 'weekday') + ' · ' + catLabel(r.category) + (r.status && r.status !== 'confirmed' ? ' · ' + catLabel(r.status) : '')) + '</span></span><span class="N_amt N_num">' + sign + esc(formatPHP(r.gross_amount)) + '</span></div>';
    }).join('') + '</section>';
    out += '<p class="N_foot"><a class="N_link" href="#door/dashboard/finance/transactions" data-n="go" data-v="finance/transactions">Open all transactions in the dashboard</a></p>';
    return out;
  }

  function viewKpis() {
    var k = S.d.kpi || {}, per = periodPreset(S.period, S.today), cmp = comparablePeriod(per, compareMode(S.period));
    var out = '<div class="N_kbar"><label class="N_lbl" for="N_period">Period</label><select id="N_period" class="N_select" data-f="period">' +
      PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === S.period ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select>' +
      '<button class="btn btn-secondary" type="button" data-n="refresh"' + (k.busy ? ' disabled' : '') + '>Refresh</button></div>';
    out += '<p class="N_sub">' + esc(per.label + ': ' + fmtDate(per.start, 'long') + ' to ' + fmtDate(per.endExclusive, 'long') + ' (end day not counted). Compared with ' + fmtDate(cmp.start, 'long') + ' to ' + fmtDate(cmp.endExclusive, 'long') + '.') + '</p>';
    var box = stateBox(k, 'KPIs', 'kpis'); if (box) return out + box;
    var now = k.data && k.data.now, prev = k.data && k.data.prev, mNow = (now && now.metrics) || {}, mPrev = (prev && prev.metrics) || {};
    KPI_GROUPS.forEach(function (g) {
      var rows = g.keys.filter(function (key) { return mNow[key]; }); if (!rows.length) return;
      out += '<section class="N_card N_list" aria-label="' + esc(g.title) + '"><h3 class="N_h3 N_pad">' + esc(g.title) + '</h3>' + rows.map(function (key) {
        var m = mNow[key], dl = deltaLine(m, prev ? mPrev[key] : null), na = m.value === null || m.value === undefined;
        return '<div class="N_row N_static N_kpi"><span class="N_rowmid"><span class="N_rowt">' + esc(KPI_TITLE[key] || key) + '</span>' +
          (dl.text ? '<span class="N_rows' + (dl.dir === 'down' ? ' N_dn' : '') + '">' + (dl.dir === 'up' ? '<span aria-hidden="true">▲</span> ' : dl.dir === 'down' ? '<span aria-hidden="true">▼</span> ' : '') + esc(dl.text) + '</span>' : '') +
          (m.coverage && m.coverage !== 'complete' ? '<span class="N_rows">' + esc(m.coverage + ' coverage') + '</span>' : '') + '</span>' +
          '<span class="N_val N_num' + (na ? ' N_na' : '') + '">' + esc(formatMetricValue(m)) + '</span></div>';
      }).join('') + '</section>';
    });
    if (now && now.blockedNights > 0) out += '<p class="N_foot">' + esc(count(now.blockedNights, 'calendar-blocked night is', 'calendar-blocked nights are') + ' unexplained and still count as sellable, so occupancy may read low.') + '</p>';
    out += '<p class="N_foot"><a class="N_link" href="#door/dashboard/insights" data-n="go" data-v="insights">Open full KPIs in the dashboard</a></p>';
    return out;
  }

  // ---- sheets ----
  function field(id, label, control, err) { return '<div class="N_field"><label class="N_lbl" for="' + id + '">' + esc(label) + '</label>' + control + (err ? '<p class="N_ferr" id="' + id + '-e" role="alert"><span aria-hidden="true">✕</span> ' + esc(err) + '</p>' : '') + '</div>'; }
  function inp(id, f, val, extra) { return '<input class="N_input" id="' + id + '" data-f="' + f + '" value="' + esc(val) + '" autocomplete="off" ' + (extra || '') + '>'; }
  function sheetShell(title, body) {
    return '<div class="N_scrim" aria-hidden="true"></div><div class="N_sheet" role="dialog" aria-modal="true" aria-labelledby="N_sh"><div class="N_grab" aria-hidden="true"></div><h2 class="N_h" id="N_sh" tabindex="-1" data-n-focus="1">' + esc(title) + '</h2>' + body + '</div>';
  }
  function payOf(id) { var rows = (S.d.inq && S.d.inq.data) || []; for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
  function sheetErr(sh) { return sh.msg ? '<div class="N_err" role="alert"><span>' + esc(sh.msg) + '</span></div>' : ''; }
  function stayLine(p) { return (p.guest_name || 'A guest') + ', ' + fmtDate(p.checkin_date, 'long') + ' to ' + fmtDate(p.checkout_date, 'long'); }
  function btns(primaryLabel, primaryAct, secondLabel, secondAct, busy, danger) {
    return '<div class="N_btns"><button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' btn-block" type="button" data-n="' + primaryAct + '"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + esc(busy ? 'Sending…' : primaryLabel) + '</button>' +
      '<button class="btn btn-secondary btn-block" type="button" data-n="' + secondAct + '"' + (busy ? ' disabled' : '') + '>' + esc(secondLabel) + '</button></div>';
  }

  function sheetHtml() {
    var sh = S.sheet; if (!sh) return '';
    if (sh.kind === 'inq') {
      var p = payOf(sh.id); if (!p) return '';
      var absentActs = S.d.confirm && S.d.confirm.absent;
      var body = '<dl class="N_dl"><dt>Dates</dt><dd>' + esc(fmtDate(p.checkin_date, 'weekday') + ' to ' + fmtDate(p.checkout_date, 'weekday') + ' · ' + count(nightsBetween(p.checkin_date, p.checkout_date), 'night', 'nights')) + '</dd>' +
        '<dt>Guests</dt><dd>' + esc(p.pax == null ? '—' : p.pax) + '</dd><dt>To receive</dt><dd class="N_num">' + esc(formatPHP(p.expected_amount)) + '</dd><dt>Payment</dt><dd>' + esc(paymentLine(p)) + '</dd>' +
        (p.hold_expires_at ? '<dt>Dates held until</dt><dd>' + esc(fmtDateTime(p.hold_expires_at)) + '</dd>' : '') + '<dt>Reference</dt><dd>' + esc(p.booking_ref || '—') + '</dd></dl>';
      if (p.receipt_image_path) body += '<p class="N_p">A receipt photo is on file. <a class="N_link" href="#door/dashboard/bookings/inquiries" data-n="go" data-v="bookings/inquiries">See it in the dashboard</a>.</p>';
      body += sheetErr(sh);
      body += absentActs ? '<div class="N_note">Deciding on a request is not available in this version of the app yet.</div>' : '<div class="N_btns"><button class="btn btn-primary btn-block" type="button" data-n="cf-start">Confirm booking</button><button class="btn btn-secondary btn-block" type="button" data-n="dc-start">Decline</button></div>';
      return sheetShell(p.guest_name || 'Request', body + '<button class="btn btn-ghost btn-block" type="button" data-n="sheet-close">Close</button>');
    }
    if (sh.kind === 'confirm') {
      var pc = payOf(sh.id); if (!pc) return ''; var f = sh.f, e = sh.errs || {}, rc = hasReceipt(pc), b = '';
      if (sh.step === 'form') {
        b += '<p class="N_sub">' + esc(stayLine(pc)) + '. Dates are rechecked when you confirm.</p><p class="N_box">' + esc(paymentLine(pc)) + '</p>';
        if (rc) b += '<div class="N_field"><label class="N_chk"><input type="checkbox" data-f="checked"' + (f.checked ? ' checked' : '') + '> <span>I checked the money arrived</span></label>' + (e.checked ? '<p class="N_ferr" role="alert"><span aria-hidden="true">✕</span> ' + esc(e.checked) + '</p>' : '') + '</div>';
        else b += '<fieldset class="N_fs"><legend class="N_lbl">How was it paid?</legend>' + METHODS.map(function (m) { return '<label class="N_chk"><input type="radio" name="N_method" data-f="method" value="' + m[0] + '"' + (f.method === m[0] ? ' checked' : '') + '> <span>' + esc(m[1]) + '</span></label>'; }).join('') + '</fieldset>';
        if (rc ? !pc.reference : f.method !== 'cash') b += field('N_ref', 'Payment reference', inp('N_ref', 'reference', f.reference, e.reference ? 'aria-invalid="true" aria-describedby="N_ref-e"' : ''), e.reference);
        b += field('N_amt', 'Amount received (PHP)', inp('N_amt', 'amount', f.amount, 'inputmode="decimal"' + (e.amount ? ' aria-invalid="true" aria-describedby="N_amt-e"' : '')), e.amount);
        if (!rc) b += field('N_note', f.method === 'cash' ? 'Note (needed for cash)' : 'Note (optional)', '<textarea class="N_input N_ta" id="N_note" data-f="note" rows="2">' + esc(f.note) + '</textarea>', e.note);
        b += sheetErr(sh) + btns('Review', 'cf-review', 'Back', 'sheet-back');
      } else {
        var amt = parseAmount(f.amount), mth = rc ? 'GCash via Messenger (receipt on file)' : methodLabel(f.method), ref = (rc && pc.reference ? pc.reference : f.reference || '').trim();
        b += '<p class="N_sub">Check these before you confirm. This cannot be undone here. The guest is messaged when you confirm.</p><dl class="N_dl"><dt>Guest</dt><dd>' + esc(pc.guest_name || 'A guest') + '</dd><dt>Dates</dt><dd>' + esc(fmtDate(pc.checkin_date, 'long') + ' to ' + fmtDate(pc.checkout_date, 'long')) + '</dd>' +
          '<dt>Amount received</dt><dd class="N_num">' + esc(formatPHP(amt)) + '</dd><dt>Paid by</dt><dd>' + esc(mth) + '</dd>' + (ref ? '<dt>Reference</dt><dd>' + esc(ref) + '</dd>' : '') + (String(f.note || '').trim() ? '<dt>Note</dt><dd>' + esc(f.note.trim()) + '</dd>' : '') + '</dl>' +
          sheetErr(sh) + btns('Confirm booking', 'cf-send', 'Back', 'cf-edit', sh.busy);
      }
      return sheetShell('Confirm booking', b);
    }
    if (sh.kind === 'decline') {
      var pd = payOf(sh.id); if (!pd) return ''; var db = '';
      if (sh.step === 'form') {
        db += '<p class="N_sub">' + esc(stayLine(pd)) + '.</p><div class="N_field"><span class="N_lbl" id="N_why">Why?</span><div class="N_chips" role="group" aria-labelledby="N_why">' +
          DECLINE_REASONS.map(function (r) { return '<button class="N_chip" type="button" data-n="dc-chip" data-v="' + esc(r) + '" aria-pressed="' + (sh.chip === r) + '">' + esc(r) + '</button>'; }).join('') + '</div></div>' +
          field('N_dtxt', 'Anything to add (optional)', '<textarea class="N_input N_ta" id="N_dtxt" data-f="text" rows="2">' + esc(sh.text) + '</textarea>') + sheetErr(sh) + btns('Review', 'dc-review', 'Back', 'sheet-back');
      } else {
        db += '<p class="N_sub">Check this before you decline. The booking and its calendar entry are cancelled, and its income row is voided. The guest is not messaged from here.</p><dl class="N_dl"><dt>Guest</dt><dd>' + esc(pd.guest_name || 'A guest') + '</dd><dt>Dates</dt><dd>' + esc(fmtDate(pd.checkin_date, 'long') + ' to ' + fmtDate(pd.checkout_date, 'long')) + '</dd><dt>Reason</dt><dd>' + esc(declineReason(sh.chip, sh.text) || '') + '</dd></dl>' + sheetErr(sh) + btns('Decline request', 'dc-send', 'Back', 'dc-edit', sh.busy, true);
      }
      return sheetShell('Decline request', db);
    }
    if (sh.kind === 'expense') {
      var f2 = sh.f, e2 = sh.errs || {}, xb = '';
      if (sh.step === 'form') {
        xb += field('N_xd', 'Date', '<input class="N_input" id="N_xd" type="date" data-f="date" value="' + esc(f2.date) + '"' + (e2.date ? ' aria-invalid="true"' : '') + '>', e2.date) +
          field('N_xa', 'Amount (PHP)', inp('N_xa', 'amount', f2.amount, 'inputmode="decimal"'), e2.amount) +
          field('N_xc', 'Category', '<select class="N_select N_full" id="N_xc" data-f="category">' + EXPENSE_CATEGORIES.map(function (c) { return '<option value="' + c + '"' + (f2.category === c ? ' selected' : '') + '>' + esc(catLabel(c)) + '</option>'; }).join('') + '</select>', e2.category) +
          field('N_xn', 'What was it for?', inp('N_xn', 'notes', f2.notes), e2.notes) + field('N_xp', 'Paid to (optional)', inp('N_xp', 'payee', f2.payee)) + sheetErr(sh) + btns('Review', 'ex-review', 'Cancel', 'sheet-close');
      } else {
        xb += '<p class="N_sub">Check this before you save. It is counted in the books at once.</p><dl class="N_dl"><dt>Date</dt><dd>' + esc(fmtDate(f2.date, 'long')) + '</dd><dt>Amount</dt><dd class="N_num">' + esc(formatPHP(parseAmount(f2.amount))) + '</dd><dt>Category</dt><dd>' + esc(catLabel(f2.category)) + '</dd>' +
          '<dt>For</dt><dd>' + esc(f2.notes.trim()) + '</dd>' + (f2.payee.trim() ? '<dt>Paid to</dt><dd>' + esc(f2.payee.trim()) + '</dd>' : '') + '</dl>' + sheetErr(sh) + btns('Save expense', 'ex-send', 'Back', 'ex-edit', sh.busy);
      }
      return sheetShell('Log an expense', xb);
    }
    return '';
  }

  function tabsHtml() {
    var hide = {}; // a tab whose only data source is missing is hidden
    if (S.d.inq && S.d.inq.absent) hide.inquiries = true;
    return '<div class="N_seg" role="tablist" aria-label="Manage"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + TABS.filter(function (t) { return !hide[t]; }).map(function (t) {
      return '<button class="N_tab" type="button" role="tab" id="N_tab_' + t + '" aria-selected="' + (S.tab === t) + '" data-n="tab" data-v="' + t + '">' + TAB_LABEL[t] + '</button>';
    }).join('') + '</div>';
  }
  function draw() {
    if (!S) return;
    var body = S.tab === 'inquiries' ? viewInquiries() : S.tab === 'money' ? viewMoney() : S.tab === 'kpis' ? viewKpis() : viewToday();
    var live = S.notice ? '<div class="N_okbox" role="status">' + esc(S.notice) + '</div>' : '';
    S.el.innerHTML = '<div class="N_root">' + tabsHtml() + live + '<div class="N_body" role="tabpanel" aria-labelledby="N_tab_' + S.tab + '"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + body + '</div></div>' + sheetHtml();
    if (S.sheet && S.sheet.focus !== false) { try { var h = S.el.querySelector('[data-n-focus]'); if (h && h.focus) h.focus(); } catch (e) { /* no focus in tests */ } S.sheet.focus = false; }
  }

  // ------------------------------------------------------------------------------------------------ actions
  function buzz(kind) { try { if (S.opts.haptic) S.opts.haptic(kind); } catch (e) { /* optional */ } }
  function tell(msg) { try { if (S.opts.toast) S.opts.toast(msg); } catch (e) { /* optional */ } }
  function refreshAfterWrite() { ['overview', 'inq', 'txns', 'kpi'].forEach(function (k) { if (S.d[k]) S.d[k].ok = false; }); loadTab(S.tab, true); }

  // After the server answered something we can read (an outcome), the key is replaced; after a dropped connection it is kept for a safe retry.
  function sendWrite(prefixName, name, args, onData) {
    var sh = S.sheet; if (!sh || sh.busy) return;
    sh.msg = '';
    if (!online()) { sh.msg = NO_CONNECTION; draw(); return; }
    sh.busy = true; draw();
    var gen = S.gen, sheetObj = sh;
    var settle = function (res) {
      if (!S || S.gen !== gen) return; sheetObj.busy = false;
      if (res.error) {
        if (isMissing(res.error)) { S.d[prefixName] = { absent: true }; sheetObj.msg = 'This is not available in this version of the app yet.'; }
        else sheetObj.msg = plainError(res.error, true);
        draw(); return;
      }
      onData(res.data, sheetObj);
    };
    if (S.demo) { Promise.resolve().then(function () { settle({ data: onDemo(name), error: null }); }); return; }
    callRpc(name, args).then(settle);
  }
  function onDemo(name) { return name === 'staff_decline_direct_booking_v1' ? { ok: true, outcome: 'declined' } : name === 'staff_confirm_direct_booking_v1' ? { ok: true, outcome: 'confirmed' } : { ok: true }; }

  function openInq(id) { S.sheet = { kind: 'inq', id: id, msg: '', focus: true }; draw(); }
  function startConfirm() {
    var p = payOf(S.sheet.id), rc = hasReceipt(p);
    S.sheet = { kind: 'confirm', id: p.id, step: 'form', key: mintKey('confirm'), busy: false, msg: '', errs: {}, focus: true,
      f: { checked: false, method: 'messenger_gcash', reference: '', amount: p.expected_amount ? fromCentavos(toCentavos(p.expected_amount)) : '', note: '' } };
    draw();
  }
  function doConfirmSend() {
    var sh = S.sheet, p = payOf(sh.id); if (sh.step !== 'review') return; // a write only ever follows the review step
    sendWrite('confirm', 'staff_confirm_direct_booking_v1', confirmArgs(sh.id, sh.f, p, sh.key), function (res, s2) {
      res = res || {};
      if (res.ok === true && res.outcome === 'confirmed') { buzz('success'); tell(confirmSentence(res)); S.notice = confirmSentence(res); S.sheet = null; if (S.demo) demoRemove(sh.id); refreshAfterWrite(); draw(); return; }
      s2.msg = confirmSentence(res); s2.key = mintKey('confirm'); // a readable answer: the next try is a new decision
      if (res.outcome === 'conflict' || res.outcome === 'invalid_state') refreshAfterWrite();
      s2.step = 'form'; draw();
    });
  }
  function doDeclineSend() {
    var sh = S.sheet; if (sh.step !== 'review') return;
    sendWrite('decline', 'staff_decline_direct_booking_v1', { p_booking_id: sh.id, p_reason: declineReason(sh.chip, sh.text) || '', p_idempotency_key: sh.key }, function (res, s2) {
      res = res || {};
      if (res.ok === true) { buzz('success'); tell(declineSentence(res)); S.notice = declineSentence(res); S.sheet = null; if (S.demo) demoRemove(sh.id); refreshAfterWrite(); draw(); return; }
      s2.msg = declineSentence(res); s2.key = mintKey('decline'); s2.step = 'form'; draw();
    });
  }
  function demoRemove(id) { S.demoData.inquiries = S.demoData.inquiries.filter(function (r) { return r.id !== id; }); }
  function doExpenseSend() {
    var sh = S.sheet; if (sh.step !== 'review') return;
    var txn = expenseTxn(sh.f);
    sendWrite('save', 'admin_save_transaction_v1', { p_property_id: pid(), p_txn: txn, p_idempotency_key: sh.key }, function (res, s2) { // features/finance/api.ts:121
      if (res && res.ok) { var m = 'Expense saved: ' + formatPHP(txn.gross_amount) + ', ' + catLabel(txn.category) + ', ' + fmtDate(txn.transaction_date, 'long') + '.'; buzz('success'); tell(m); S.notice = m; S.sheet = null; if (S.demo) S.demoData.txns.unshift({ id: 'n-demo-' + (S.demoData.txns.length + 1), transaction_date: txn.transaction_date, txn_type: 'expense', category: txn.category, gross_amount: txn.gross_amount, payee_name: txn.payee_name || null, notes: txn.notes, status: 'confirmed' }); refreshAfterWrite(); draw(); return; }
      s2.msg = 'The expense was not saved. Please check it and try again.'; s2.key = mintKey('txn'); s2.step = 'form'; draw();
    });
  }

  function onClick(ev) {
    if (!S) return; var t = ev.target && ev.target.closest ? ev.target.closest('[data-n]') : null; if (!t) return;
    var a = t.getAttribute('data-n'), v = t.getAttribute('data-v'), sh = S.sheet;
    if (t.disabled || t.getAttribute('aria-busy') === 'true') return;
    if (sh && sh.busy && (a === 'go' || a === 'tab' || a === 'refresh' || a === 'retry')) return; // a request is in flight: nothing may orphan its sheet
    if (a === 'go') { if (ev.preventDefault) ev.preventDefault(); S.sheet = null; S.opts.navigate('#door/dashboard/' + v); return; }
    if (a === 'tab') { setTab(v, true); return; }
    if (a === 'retry') { var m = { today: 'today', inquiries: 'inquiries', money: 'money', kpis: 'kpis' }; loadTab(m[v] || S.tab, true); return; }
    if (a === 'refresh') { S.notice = ''; loadTab(S.tab, true); return; }
    S.notice = '';
    if (a === 'inq-open') return openInq(v);
    if (a === 'exp-open') { S.sheet = { kind: 'expense', step: 'form', key: mintKey('txn'), busy: false, msg: '', errs: {}, focus: true, f: { date: manilaToday(), amount: '', category: 'other', notes: '', payee: '' } }; draw(); return; }
    if (!sh) return;
    if (a === 'sheet-close') { if (sh.busy) return; S.sheet = null; draw(); return; }
    if (a === 'sheet-back') { if (sh.busy) return; if (sh.kind === 'confirm' || sh.kind === 'decline') { S.sheet = { kind: 'inq', id: sh.id, msg: '', focus: true }; } else S.sheet = null; draw(); return; }
    if (a === 'cf-start') return startConfirm();
    if (a === 'cf-review') { sh.errs = validateConfirm(sh.f, payOf(sh.id)); sh.msg = ''; if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the items marked below.'; draw(); return; } sh.step = 'review'; sh.focus = true; draw(); return; }
    if (a === 'cf-edit' || a === 'dc-edit' || a === 'ex-edit') { if (sh.busy) return; sh.step = 'form'; sh.msg = ''; sh.focus = true; draw(); return; }
    if (a === 'cf-send') return doConfirmSend();
    if (a === 'dc-start') { S.sheet = { kind: 'decline', id: sh.id, step: 'form', key: mintKey('decline'), busy: false, msg: '', chip: null, text: '', focus: true }; draw(); return; }
    if (a === 'dc-chip') { sh.chip = sh.chip === v ? null : v; sh.msg = ''; draw(); return; }
    if (a === 'dc-review') { if (!declineReason(sh.chip, sh.text)) { sh.msg = 'Choose or write a reason first.'; draw(); return; } sh.step = 'review'; sh.msg = ''; sh.focus = true; draw(); return; }
    if (a === 'dc-send') return doDeclineSend();
    if (a === 'ex-review') { sh.errs = validateExpense(sh.f); sh.msg = ''; if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the items marked below.'; draw(); return; } sh.step = 'review'; sh.focus = true; draw(); return; }
    if (a === 'ex-send') return doExpenseSend();
  }
  function onInput(ev) {
    if (!S) return; var t = ev.target; if (!t || !t.getAttribute) return; var f = t.getAttribute('data-f'); if (!f) return;
    if (f === 'period') { var v = t.value; if (!PRESETS.some(function (p) { return p[0] === v; })) return; S.period = v; ls('set', 'cs_n_period', v); S.d.kpi = {}; draw(); load('kpi', true); return; }
    var sh = S.sheet; if (!sh) return;
    var val = t.type === 'checkbox' ? !!t.checked : t.value;
    if (sh.kind === 'decline' && f === 'text') { sh.text = val; return; }
    if (sh.f && f in sh.f) { sh.f[f] = val; if (f === 'method') { sh.errs = {}; draw(); } }
  }

  function onVisible() {
    var doc = (typeof document !== 'undefined') ? document : null;
    if (!S || !doc || doc.visibilityState !== 'visible') return;
    if (S.sheet && S.sheet.busy) return;
    if (clock() - (S.loadedAt || 0) > 5 * 60000 && !S.sheet) loadTab(S.tab, true); // refresh on return after five minutes; never under an open sheet
  }

  // ------------------------------------------------------------------------------------------------ mount / unmount
  function mount(el, opts) {
    opts = opts || {};
    if (S) unmount();
    if (!canManage(opts.role)) { if (opts.navigate) opts.navigate('#home'); return; }
    var today = manilaToday(), sub = TABS.indexOf(opts.sub) >= 0 ? opts.sub : null, stored = ls('get', 'cs_n_tab'), sp = ls('get', 'cs_n_period');
    S = { el: el, opts: opts, client: opts.client, demo: !!opts.demo, role: opts.role, gen: ++N_gen, today: today, d: {}, sheet: null, notice: '', loadedAt: 0,
      tab: sub || (TABS.indexOf(stored) >= 0 ? stored : 'today'), period: PRESETS.some(function (p) { return p[0] === sp; }) ? sp : 'mtd', demoData: demoData(today) };
    if (!S.demo && !S.client) { ['overview', 'inq', 'txns', 'kpi'].forEach(function (k) { S.d[k] = { err: 'No connection.' }; }); }
    S.onClick = onClick; S.onInput = onInput; S.onVis = onVisible;
    el.addEventListener('click', S.onClick); el.addEventListener('input', S.onInput); el.addEventListener('change', S.onInput);
    el.addEventListener('submit', function (e) { if (e && e.preventDefault) e.preventDefault(); });
    try { if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    draw(); if (S.demo || S.client) loadTab(S.tab, true);
  }
  function unmount() {
    if (!S) return;
    try { S.el.removeEventListener && S.el.removeEventListener('click', S.onClick); S.el.removeEventListener && S.el.removeEventListener('input', S.onInput); S.el.removeEventListener && S.el.removeEventListener('change', S.onInput); } catch (e) { /* ok */ }
    try { if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    (S.timers || []).forEach(function (t) { clearTimeout(t); });
    N_gen++; S = null; // a late reply finds no state and is dropped
  }

  var api = {
    mount: mount, unmount: unmount,
    _setRpcTimeout: function (ms) { RPC_TIMEOUT_MS = ms; },
    _setClock: function (fn) { clock = fn || function () { return Date.now(); }; },
    lib: { canManage: canManage, manilaToday: manilaToday, addDays: addDays, nightsBetween: nightsBetween, fmtDate: fmtDate, fmtDateTime: fmtDateTime, toCentavos: toCentavos, fromCentavos: fromCentavos, formatPHP: formatPHP, formatPercent: formatPercent, formatNumber: formatNumber,
      formatMetricValue: formatMetricValue, parseAmount: parseAmount, periodPreset: periodPreset, comparablePeriod: comparablePeriod, compareMode: compareMode, pctDelta: pctDelta, fmtDeltaPct: fmtDeltaPct, deltaLine: deltaLine,
      normalizePayments: normalizePayments, paymentLine: paymentLine, validateConfirm: validateConfirm, confirmArgs: confirmArgs, confirmSentence: confirmSentence, declineSentence: declineSentence, declineReason: declineReason,
      validateExpense: validateExpense, expenseTxn: expenseTxn, isMissing: isMissing, isDenied: isDenied, isOffline: isOffline, plainError: plainError, PRESETS: PRESETS, METHODS: METHODS, EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, KPI_GROUPS: KPI_GROUPS, NO_CONNECTION: NO_CONNECTION }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.N_Manage = api;
})();
