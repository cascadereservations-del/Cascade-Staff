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
  var TABS = ['today', 'inquiries', 'money', 'kpis', 'bookings', 'ops'];
  var TAB_LABEL = { today: 'Today', inquiries: 'Inquiries', money: 'Money', kpis: 'KPIs', bookings: 'Bookings', ops: 'Ops' };
  var EXT = { bookings: 'N_BOOKINGS', ops: 'N_OPS' }; // other lanes' modules: shown only when their script is loaded
  function extMod(t) { var g = typeof window !== 'undefined' ? window : null, m = g && EXT[t] ? g[EXT[t]] : null; return m && typeof m.mount === 'function' ? m : null; }
  function tabOk(t) { return TABS.indexOf(t) >= 0 && (!EXT[t] || !!extMod(t)); }
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
  // "1–17 Sep", "Sep" (whole month), "1 Sep – 17 Oct"; a year is added when it differs from the current period's year. Same dates as the sentence at the top of the page.
  function shortRange(a, bEx, refYear) {
    var e = addDays(bEx, -1), sp = a.split('-'), ep = e.split('-'), sm = MON[+sp[1] - 1], em = MON[+ep[1] - 1], yr = +sp[0] !== refYear || +ep[0] !== refYear ? ' ' + ep[0] : '', t;
    if (+sp[2] === 1 && bEx.slice(8) === '01' && sp[1] === ep[1]) t = sm; // one whole month
    else if (sp[1] === ep[1] && sp[0] === ep[0]) t = +sp[2] === +ep[2] ? +sp[2] + ' ' + sm : +sp[2] + '–' + +ep[2] + ' ' + sm;
    else t = +sp[2] + ' ' + sm + ' – ' + +ep[2] + ' ' + em;
    return t + yr;
  }
  // insights-page.tsx:587 picks the comparison mode this way
  function compareMode(key) { return ['ytd', 'prev-year', 'qtd', 'prev-quarter'].indexOf(key) >= 0 ? 'year' : 'month'; }
  // insights-page.tsx:62 pctDelta and :65 fmtDeltaPct
  function pctDelta(cur, prior) { return isFinite(cur) && isFinite(prior) && prior !== 0 ? ((cur - prior) / Math.abs(prior)) * 100 : null; }
  function fmtDeltaPct(v) { return v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(0) + '%'; }
  function num(v) { return v === null || v === undefined ? NaN : Number(v); } // dates/money.ts decimalToNumber: null is "not available", never 0
  // The delta line under one KPI: occupancy-like percent units show points (insights-page.tsx:147), everything else a percent change.
  // Colour follows meaning, not direction: a falling cancellation rate is good news; lead time and length of stay are neither good nor bad.
  var POLARITY = { cancellation_rate: 'down', booking_lead_time: 'neutral', average_length_of_stay: 'neutral' };
  function tone(key, dir) { var pol = POLARITY[key] || 'up'; return !dir || pol === 'neutral' ? '' : (dir === pol ? 'good' : 'bad'); }
  function deltaLine(cur, prev, key, lbl) { var r = deltaCore(cur, prev, lbl); r.tone = tone(key, r.dir); return r; }
  function deltaCore(cur, prev, lbl) { lbl = lbl || 'Before'; // lbl: "vs 1–17 Sep" names the compared period; the default keeps the old wording
    if (!cur || !prev || prev.value === null || prev.value === undefined) return { text: prev ? lbl + ': not available' : '', dir: '' };
    var c = num(cur.value), p = num(prev.value), before = lbl + ': ' + formatMetricValue(prev);
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

  // ---- 3.1.1 charts: the last six full calendar months, as the same [start, end) arguments the prev-month preset builds ----
  function lastMonths(today, n) {
    var p = today.split('-'), y = +p[0], m = +p[1] - 1, out = [], first = function (yy, mm) { return isoOf(Date.UTC(yy, mm, 1)); };
    for (var i = n; i >= 1; i--) { var st = first(y, m - i); out.push({ month: st.slice(0, 7), start: st, endExclusive: first(y, m - i + 1), label: MON[new Date(utc(st)).getUTCMonth()] }); }
    return out;
  }
  function monthTitle(mo) { var y = mo.month.slice(0, 4); return mo.label + ' ' + y; }
  // The series is built only from what the server answered: a failed month or a null value is a gap (null), never zero.
  function metricNum(res, key) { var m = res && res.metrics && res.metrics[key]; return m && m.value !== null && m.value !== undefined && isFinite(Number(m.value)) ? Number(m.value) : null; }
  function buildSeries(months, answers) {
    return months.map(function (mo, i) {
      var a = answers[i];
      return { month: mo.month, label: mo.label, start: mo.start, endExclusive: mo.endExclusive, failed: !a,
        rev: metricNum(a, 'accommodation_revenue'), occ: metricNum(a, 'occupancy'), adr: metricNum(a, 'adr'), nights: metricNum(a, 'sold_nights'),
        raw: { rev: a && a.metrics ? a.metrics.accommodation_revenue : null, occ: a && a.metrics ? a.metrics.occupancy : null } };
    });
  }
  // headline chip: glyph + word + figure, from the same two metric results the number rows use
  function chipFor(cur, prev) {
    if (!cur || !prev || cur.value === null || cur.value === undefined || prev.value === null || prev.value === undefined) return null;
    var c = num(cur.value), p = num(prev.value); if (!isFinite(c) || !isFinite(p)) return null;
    var v, unit;
    if (cur.unit === 'percent') { v = c - p; unit = ' pts'; } else { v = pctDelta(c, p); unit = '%'; if (v === null) return null; }
    var r = Math.round(Math.abs(v));
    if (r === 0) return { dir: 'flat', glyph: '–', text: 'Flat' };
    return v > 0 ? { dir: 'up', glyph: '▲', text: 'Up ' + r + unit } : { dir: 'down', glyph: '▼', text: 'Down ' + r + unit };
  }

  // ---- inquiries: confirm-model.ts ----
  function str(v) { return typeof v === 'string' && v.trim() !== '' ? v : null; }
  function amountStr(v) { return (typeof v === 'string' || typeof v === 'number') ? (toCentavos(v) === null ? null : String(v)) : null; }
  function normalizePayments(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (o) {
      o = o || {}; var id = str(o.id); if (!id) return;
      out.push({ id: id, booking_ref: str(o.booking_ref), guest_name: str(o.guest_name), checkin_date: str(o.checkin_date), checkout_date: str(o.checkout_date), pax: typeof o.pax === 'number' ? o.pax : null,
        expected_amount: amountStr(o.expected_amount), comparison_id: str(o.comparison_id), candidate_amount: amountStr(o.candidate_amount), reference: str(o.reference), receipt_image_path: str(o.receipt_image_path), hold_expires_at: str(o.hold_expires_at),
        // confirm flow (3.4.54): null means the server is old and did not send the field, so the old single list and old words apply
        receipt_sent: typeof o.receipt_sent === 'boolean' ? o.receipt_sent : null, receipt_at: str(o.receipt_at), contact_channel: o.contact_channel === 'messenger' || o.contact_channel === 'email' || o.contact_channel === 'none' ? o.contact_channel : null });
    });
    return out;
  }
  function hasReceipt(p) { return !!(p && p.comparison_id); }
  // ---- confirm flow (3.4.54): the words and rules the Needs you card, the Inquiries groups and the request sheet share ----
  var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var GUEST_SITE = 'https://tinyurl.com/Stay-at-Cascade'; // the booking-site address the guest e-mails and chat replies already use (SITE_URL in the edge repo's facts.ts); no new address
  function legacyRow(p) { return !p || p.receipt_sent === null; }
  function isSent(p) { return !!p && (p.receipt_sent === true || (p.receipt_sent === null && hasReceipt(p))); }
  function fmtDay(iso) { if (!iso) return '—'; var d = new Date(utc(iso)); return d.getUTCDate() + ' ' + MONTH_LONG[d.getUTCMonth()]; } // "4 December"
  function fmtDayMail(iso) { var d = new Date(utc(iso)); return DOW[d.getUTCDay()] + ', ' + MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); } // "Fri, Dec 4": the confirmation e-mail's date format
  function manilaParts(ts) { var ms = Date.parse(ts); if (!isFinite(ms)) return null; var d = new Date(ms + 8 * 3600000), h = d.getUTCHours(); return { ms: ms, dow: DOW[d.getUTCDay()], time: (h % 12 || 12) + ':' + pad2(d.getUTCMinutes()) + ' ' + (h >= 12 ? 'pm' : 'am'), day: isoOf(ms + 8 * 3600000) }; }
  function fmtTimeOnly(ts) { var q = manilaParts(ts); return q ? q.time : '—'; }
  function fmtHoldAt(ts) { var q = manilaParts(ts); return q ? q.dow + ' ' + q.time : '—'; } // "Tue 3:00 pm"
  function holdEnded(ts, now) { var ms = Date.parse(ts); return isFinite(ms) && ms <= (now == null ? clock() : now); }
  // under a minute "just now", under an hour "{n} min ago", under a day "{n} h ago", else the date and time. The clock is injected.
  function agoWords(ts, now) {
    var ms = Date.parse(ts); if (!isFinite(ms)) return ''; var d = (now == null ? clock() : now) - ms;
    if (d < 60000) return 'just now'; if (d < 3600000) return Math.floor(d / 60000) + ' min ago'; if (d < 86400000) return Math.floor(d / 3600000) + ' h ago'; return fmtDateTime(ts);
  }
  function groupRef(r) { var t = String(r == null ? '' : r).replace(/\s+/g, ''); return t.replace(/(.{4})(?=.)/g, '$1 '); } // 1234 5678 9012
  // the receipt against the amount to receive. Null when no receipt was sent; unread when the photo gave no amount (never a zero).
  function receiptCmp(p) {
    if (!isSent(p)) return null;
    var r = p.candidate_amount === null ? null : toCentavos(p.candidate_amount), e = p.expected_amount === null ? null : toCentavos(p.expected_amount);
    if (r === null || r <= 0) return { kind: 'unread' };
    if (e === null) return { kind: 'known', amt: r, diff: 0 };
    var d = r - e; return { kind: d === 0 ? 'ok' : d < 0 ? 'short' : 'over', amt: r, diff: Math.abs(d) };
  }
  function cents(c) { return formatPHP(fromCentavos(c)); }
  function nw(t) { return '<span class="N_nw">' + esc(t) + '</span>'; }
  function paymentLine(p) {
    if (!hasReceipt(p)) return 'No receipt yet';
    var parts = ['Receipt on file']; if (p.candidate_amount !== null) parts.push(formatPHP(p.candidate_amount)); if (p.reference) parts.push('ref ...' + p.reference.slice(-4));
    return parts.join(' · ');
  }
  var METHODS = [['messenger_gcash', 'GCash via Messenger'], ['gcash_qr', 'GCash QR'], ['bank', 'Bank'], ['cash', 'Cash'], ['other', 'Other']];
  function methodLabel(v) { for (var i = 0; i < METHODS.length; i++) if (METHODS[i][0] === v) return METHODS[i][1]; return v; }
  function validateConfirm(f, payment) {
    var e = {}, receipt = hasReceipt(payment);
    if (receipt && !f.checked) e.checked = 'Tick the box once you have seen the payment in our account.';
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
  // channel: the list row's contact_channel. Known: the new words ("4 December", who is told how). Null (an old server): today's words.
  function confirmSentence(r, channel) {
    r = r || {};
    switch (r.outcome) {
      case 'confirmed':
        if (channel === 'email' || channel === 'messenger' || channel === 'none') return 'Booking confirmed for ' + (r.guest_name || 'the guest') + (r.checkin && r.checkout ? ', ' + fmtDay(r.checkin) + ' to ' + fmtDay(r.checkout) : '') + '.' + (channel === 'none' ? ' Message the guest yourself.' : ' The guest is being told ' + (channel === 'email' ? 'by e-mail.' : 'on Messenger.'));
        return 'Booking confirmed for ' + (r.guest_name || 'the guest') + (r.checkin && r.checkout ? ', ' + fmtDate(r.checkin, 'long') + ' to ' + fmtDate(r.checkout, 'long') : '') + '.';
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
  // told: 'email' | 'messenger' | 'duplicate' when the server sends (or deliberately does not send) the message; null keeps today's words
  function declineSentence(r, told, name) {
    r = r || {};
    if (r.ok === true) {
      var who = r.guest_name || name, base = 'Request declined' + (who ? ' for ' + who : '') + '.';
      return told === 'email' ? base + ' The guest is being told by e-mail.' : told === 'messenger' ? base + ' The guest is being told on Messenger.' : told === 'duplicate' ? base + ' No message was sent.' : base;
    }
    switch (r.outcome) {
      case 'invalid_state': return 'This booking is no longer waiting for a decision. Nothing was changed.';
      case 'note_required': return 'Choose or write a reason first.';
      case 'denied': return 'Your account is not allowed to decline bookings.';
      default: return 'Nothing was declined. Please try again.';
    }
  }
  // chips in the contract's order, each with the reason_code it sends. A text-only reason sends 'other'.
  var DECLINE_CHIPS = [['dates', 'Dates not available'], ['payment', 'No payment received'], ['guest_cancel', 'Guest asked to cancel'], ['duplicate', 'Duplicate request']];
  function chipLabel(code, receiptSent) { if (code === 'payment' && receiptSent) return 'Payment did not arrive'; for (var i = 0; i < DECLINE_CHIPS.length; i++) if (DECLINE_CHIPS[i][0] === code) return DECLINE_CHIPS[i][1]; return null; }
  function declineReason(chip, text, receiptSent) { var t = String(text || '').trim(); return [chip ? chipLabel(chip, receiptSent) : null, t].filter(Boolean).join(': ') || null; }
  function reasonCode(chip) { return chipLabel(chip, false) ? chip : 'other'; }

  // ---- expense: transactions-page.tsx:38 CATEGORIES.expense and :47 blank() ----
  var EXPENSE_CATEGORIES = ['cleaning', 'supplies', 'utilities', 'internet', 'subscription', 'maintenance', 'furnishing', 'cohost_fee', 'guest_refund', 'airbnb_adjustment', 'loan', 'other']; // used only until expense_categories_v1 answers
  function catLabel(c) { return String(c).replace(/_/g, ' '); }
  // expense_categories_v1 rows -> [{slug,label}] in the server's order; 'unaccounted' is never offered
  function normalizeCats(rows) {
    var out = [], seen = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) { var slug = r && str(r.slug); if (!slug || slug === 'unaccounted' || seen[slug]) return; seen[slug] = 1; out.push({ slug: slug, label: str(r.label) || catLabel(slug) }); });
    return out;
  }
  function fallbackCats() { return EXPENSE_CATEGORIES.map(function (c) { return { slug: c, label: catLabel(c) }; }); }
  function catList() { var c = S && S.d.cats; var l = c && c.ok ? normalizeCats(c.data) : []; return l.length ? l : fallbackCats(); }
  function catOk(slug, list) { return (list || catList()).some(function (c) { return c.slug === slug; }); }
  function catName(slug) { var l = catList(); for (var i = 0; i < l.length; i++) if (l[i].slug === slug) return l[i].label; return catLabel(slug); }
  var SCAN_LOW = 0.6; // below this the photo was hard to read
  // The guest's decline text, R1.6 of PLAN-confirm-flow.md. The server sends the same words (golden strings: tests/fixtures/guest-decline-golden.json,
  // copied to the edge repo). The staff note is never part of it. 'duplicate' sends nothing, so it has no text.
  // channel 'email' says "to this e-mail"; anything else (Messenger, or no channel on file) says "here in the chat".
  // Lloyd 2026-11-24: every "Reply" that opens a sentence reads "Please reply".
  function declineMessage(p, code, receiptSent, channel) {
    if (code === 'duplicate') return '';
    var first = String(p && p.guest_name || '').trim().split(/\s+/)[0] || 'there', dates = p && p.checkin_date && p.checkout_date ? fmtDayMail(p.checkin_date) + ' to ' + fmtDayMail(p.checkout_date) : 'your dates';
    var here = channel === 'email' ? 'to this e-mail' : 'here in the chat', thanks = 'Thank you for choosing Cascade Hideaway. ';
    var refund = receiptSent ? 'If you already sent a payment, please reply ' + here + ' with the GCash name and number it came from, and we will return it in full.' : null, paras;
    var more = 'We would still love to host you. Please reply ' + here + ' with other dates that suit you, or see what is open at ' + GUEST_SITE + ', and we will gladly check them for you.';
    if (code === 'dates') paras = [thanks + 'We are sorry: ' + dates + ' are no longer available, so we could not confirm this request.', refund, more];
    else if (code === 'payment' && !receiptSent) paras = [thanks + 'We held ' + dates + ' for you, but the payment did not reach us in time, so the hold has ended and this request is closed.', 'Still planning to come? Please reply ' + here + ' and, if the dates are still open, we will gladly hold them for you again. You can also check dates at ' + GUEST_SITE + '.'];
    else if (code === 'payment') paras = [thanks + 'We could not find the payment for ' + dates + ' in our account, so we could not confirm this request.', 'If the payment did leave your account, please reply ' + here + ' with the GCash name and number it came from. We will trace it and return it in full.', 'Once that is sorted, we would be glad to hold the dates for you again if they are still open.'];
    else if (code === 'guest_cancel') paras = ['As you asked, we have cancelled your request for ' + dates + '. Nothing more is needed from you.', refund, 'You are welcome any time. When new dates come up, reply ' + here + ' or visit ' + GUEST_SITE + '.'];
    else paras = [thanks + 'We are sorry, we could not confirm your request for ' + dates + '.', refund, more];
    return 'Hello ' + first + ',\n\n' + paras.filter(Boolean).join('\n\n') + '\n\nWarm regards,\nCascade Hideaway\nHotel Comfort. Home Warmth. 🌿';
  }
  function declineTold(channel, code) { return code === 'duplicate' ? 'duplicate' : channel === 'email' || channel === 'messenger' ? channel : null; }

  // ---- s135: the "Guest guide" card on the KPIs tab (staff_guide_usage_v1, owner and admin). Every figure is the server's; this only trims to the top five and formats. ----
  var GG_DAYS = 30;
  var GG_FUNNEL = [['verify_start', 'Started verifying'], ['verify_ok', 'Verified a stay'], ['checklist_done', 'Finished the checklist']]; // the real ordered steps; bars are shares of the first
  var GG_SIDE = [['browse_guest', 'Browsed without verifying'], ['message_sent', 'Sent a message']]; // not steps of the funnel: plain rows, no bars
  function ggInt(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  function ggNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function ggList(v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function ggTop(rows, key, n) { return rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) { return b.r[key] !== a.r[key] ? b.r[key] - a.r[key] : a.i - b.i; }).slice(0, n).map(function (x) { return x.r; }); }
  function ggLabel(s) { var t = String(s == null ? '' : s).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Other'; }
  // plain staff words for what guests tapped; the guide sends the slug, staff read the sentence. An unknown slug is cleaned (ggLabel), never shown raw.
  var GG_TAPS = { wifi_copy: 'Copied the wifi password', map_open: 'Opened a map', checklist_item: 'Ticked a checklist item', guide_open: 'Opened the guide', search_empty: 'Searched and found nothing' };
  function ggTapLabel(slug) { return Object.prototype.hasOwnProperty.call(GG_TAPS, slug) ? GG_TAPS[slug] : ggLabel(slug); }
  var ggSeen = false;   // staff_guide_usage_v1 has answered OK once in this page session: only then may a later failure draw the "could not be loaded" card
  var ggAbsent = false; // staff_guide_usage_v1 known missing on this server: probed once per session, like the Inbox's guideKnown. Refresh or Try again probes again.
  function ggSeconds(v) { var n = Math.round(Number(v)); if (!isFinite(n) || n <= 0) return '0 s'; if (n < 60) return n + ' s'; var m = Math.floor(n / 60), s = n % 60; return m + ' min' + (s ? ' ' + s + ' s' : ''); }
  // one number per day for the sparkline, zero for a day with no rows, so a quiet week reads as quiet and not as a shorter chart
  function ggDense(byDay, today, days) { // the `days` Manila dates ending at Manila today (never derived from the server's since, which is a UTC timestamp)
    var map = {}; ggList(byDay).forEach(function (r) { var k = String(r.day || '').slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(k)) map[k] = (map[k] || 0) + ggInt(r.events); });
    var out = [], i; for (i = days - 1; i >= 0; i--) out.push(map[addDays(today, -i)] || 0);
    return out;
  }
  function ggModel(raw, days, today) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var f = raw.funnel && typeof raw.funnel === 'object' ? raw.funnel : {};
    var m = { since: String(raw.since || '').slice(0, 10), days: days || GG_DAYS, devices: ggInt(raw.devices), verified: ggInt(raw.verified_stays), opens: ggInt(raw.opens),
      sections: ggTop(ggList(raw.sections).map(function (s) { return { label: ggLabel(s.section), views: ggInt(s.views), devices: ggInt(s.devices), avg: ggSeconds(s.avg_seconds) }; }), 'views', 5),
      taps: ggTop(ggList(raw.top_taps).map(function (t) { var tg = String(t.target == null ? '' : t.target), lb = tg ? ggTapLabel(tg) : '', wh = t.section ? ggLabel(t.section) : ''; return { target: tg, label: lb, where: wh && lb.toLowerCase().indexOf(wh.toLowerCase()) < 0 ? wh : '', taps: ggInt(t.taps), devices: ggInt(t.devices) }; }).filter(function (t) { return t.target; }), 'taps', 5),
      funnel: GG_FUNNEL.map(function (p) { return { key: p[0], label: p[1], n: ggInt(f[p[0]]) }; }),
      side: GG_SIDE.map(function (p) { return { key: p[0], label: p[1], n: ggInt(f[p[0]]) }; }),
      searches: ggTop(ggList(raw.searches_without_result).map(function (s) { return { target: String(s.target == null ? '' : s.target), n: ggInt(s.n) }; }).filter(function (s) { return s.target; }), 'n', 5) };
    m.perDay = ggDense(raw.by_day, /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? today : manilaToday(), m.days);
    m.sent = ggInt(f.message_sent);
    m.empty = !m.devices && !m.opens && !m.verified;
    return m;
  }
  // s136: "Guests who used the guide" inside the More fold (staff_guide_guests_v1, owner and admin). Loaded when the fold is opened, never before.
  var GGG_SHOW = 10;     // rows shown before "Show all"
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // a guide thread id the inbox can open (#inbox/guide:<uuid>)
  var gggAbsent = false; // staff_guide_guests_v1 known missing on this server: probed once per session, cleared by Try again / Refresh and by _resetGuideKnown
  function gggDates(ci, co) { // "24\u201327 Nov", "30 Nov \u2013 2 Dec", one date when there is no separate check-out; '' when unknown (never a made-up date)
    var re = /^\d{4}-\d{2}-\d{2}$/, a = re.test(String(ci || '')) ? String(ci) : '', b = re.test(String(co || '')) ? String(co) : '';
    if (!a) return b ? fmtDate(b) : ''; if (!b || b === a) return fmtDate(a);
    return a.slice(0, 7) === b.slice(0, 7) ? String(+a.slice(8, 10)) + '\u2013' + fmtDate(b) : fmtDate(a) + ' \u2013 ' + fmtDate(b);
  }
  function gggModel(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var list = ggList(raw.guests).map(function (g) {
      var q = g.first_seen ? manilaParts(g.first_seen) : null, lb = String(g.guest_label == null ? '' : g.guest_label).replace(/\s+/g, ' ').trim();
      return { id: g.thread_id == null ? '' : String(g.thread_id), label: lb || 'Guest', dates: gggDates(g.checkin_date, g.checkout_date), first: q ? fmtDate(q.day) : '', opens: ggInt(g.opens), checklist: g.checklist_done === true, messaged: g.messaged === true };
    });
    var m = { guests: list, total: Math.max(ggInt(raw.total), list.length), single: raw.single_property === true };
    m.empty = m.single || !list.length; if (m.empty) m.total = 0;
    return m;
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
    if (writing && String(errCode(e)) === '23505') return 'That receipt photo is already saved on another expense.';
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
      // receipt_sent and receipt_at are relative to the injected clock, so the demo always reads "12 min ago"
      inquiries: [
        { id: 'n-demo-q1', booking_ref: 'DEMO0001', guest_name: 'Sample Guest D', checkin_date: d(5), checkout_date: d(8), pax: 2, expected_amount: '2500.00', comparison_id: 'n-demo-c1', candidate_amount: '2500.00', reference: 'DEMO12345678', receipt_image_path: 'n/a', hold_expires_at: new Date(clock() + 26 * 3600000).toISOString(), receipt_sent: true, receipt_at: new Date(clock() - 12 * 60000).toISOString(), contact_channel: 'email' },
        { id: 'n-demo-q3', booking_ref: 'DEMO0003', guest_name: 'Sample Guest F', checkin_date: d(9), checkout_date: d(12), pax: 2, expected_amount: '4100.00', comparison_id: 'n-demo-c3', candidate_amount: '3600.00', reference: 'DEMO55556666', receipt_image_path: 'n/a', hold_expires_at: new Date(clock() + 30 * 3600000).toISOString(), receipt_sent: true, receipt_at: new Date(clock() - 40 * 60000).toISOString(), contact_channel: 'messenger' },
        { id: 'n-demo-q4', booking_ref: 'DEMO0004', guest_name: 'Sample Guest G', checkin_date: d(14), checkout_date: d(17), pax: 4, expected_amount: '4100.00', comparison_id: 'n-demo-c4', candidate_amount: null, reference: null, receipt_image_path: 'n/a', hold_expires_at: null, receipt_sent: true, receipt_at: new Date(clock() - 2 * 3600000).toISOString(), contact_channel: 'none' },
        { id: 'n-demo-q2', booking_ref: 'DEMO0002', guest_name: 'Sample Guest E', checkin_date: d(18), checkout_date: d(21), pax: 3, expected_amount: '4100.00', comparison_id: null, candidate_amount: null, reference: null, receipt_image_path: null, hold_expires_at: new Date(clock() + 20 * 3600000).toISOString(), receipt_sent: false, receipt_at: null, contact_channel: 'email' }
      ],
      waiting: { waiting: 1, oldest_at: new Date(clock() - 3 * 3600000).toISOString() },
      txns: [
        { id: 'n-demo-t1', transaction_date: d(-1), txn_type: 'expense', category: 'supplies', gross_amount: '640.00', payee_name: 'Sample shop', notes: 'Sample: kitchen supplies', status: 'confirmed' },
        { id: 'n-demo-t2', transaction_date: d(-2), txn_type: 'income', category: 'direct_income', gross_amount: '5000.00', payee_name: null, notes: 'Sample: deposit', status: 'confirmed' }
      ],
      cats: [{ slug: 'cleaning', label: 'Cleaning', sort_order: 1 }, { slug: 'supplies', label: 'Supplies', sort_order: 2 }, { slug: 'utilities', label: 'Utilities', sort_order: 3 }, { slug: 'repairs', label: 'Repairs', sort_order: 4 }, { slug: 'other', label: 'Other', sort_order: 9 }],
      rq: function () { return { count: this.rqRows.length, total: this.rqRows.reduce(function (a, r) { return a + Number(r.gross_amount); }, 0).toFixed(2), truncated: false, rows: this.rqRows }; },
      rqRows: [{ id: 'n-demo-r1', transaction_date: d(-1), txn_type: 'expense', category: '', gross_amount: '1200.00', payee_name: 'Sample market', notes: 'Sample: scanned receipt', or_number: null, source: 'ocr', receipt_image_path: 'n/a', ocr_confidence: 0.5, created_at: d(-1) + 'T02:00:00Z' },
        { id: 'n-demo-r2', transaction_date: d(-5), txn_type: 'expense', category: 'supplies', gross_amount: '800.00', payee_name: 'Demo shop', notes: 'Stock bought, some items not priced', or_number: null, source: 'stock', receipt_image_path: null, ocr_confidence: null, s134_incomplete: true, created_at: d(-5) + 'T02:00:00Z' }],
      guests: function () { // staff_guide_guests_v1 sample (invented names)
        var gs = [['Guest A.', -3, 0, -4, 14, true, true], ['Guest B.', -9, -7, -10, 9, true, false], ['Guest C.', -14, -12, -15, 3, false, true], ['Guest D.', -20, -18, -20, 1, false, false]];
        return { total: gs.length, guests: gs.map(function (g, i) { return { thread_id: 'n-demo-g' + (i + 1), guest_label: g[0], checkin_date: d(g[1]), checkout_date: d(g[2]), first_seen: d(g[3]) + 'T02:00:00Z', last_seen: d(g[2]) + 'T02:00:00Z', opens: g[4], checklist_done: g[5], messaged: g[6] }; }) };
      },
      guide: function () { // staff_guide_usage_v1 sample, 30 days
        return { since: d(-29), devices: 14, verified_stays: 5, opens: 41,
          by_day: [0, 3, 5, 8, 12, 20, 29].map(function (k) { return { day: d(-k), devices: 1 + k % 4, events: 4 + k }; }),
          sections: [{ section: 'wifi', views: 33, devices: 12, avg_seconds: 18 }, { section: 'checklist', views: 21, devices: 7, avg_seconds: 95 }, { section: 'house_rules', views: 12, devices: 9, avg_seconds: 41 }, { section: 'nearby', views: 9, devices: 5, avg_seconds: 62 }, { section: 'delivery', views: 7, devices: 4, avg_seconds: 27 }, { section: 'contact', views: 2, devices: 2, avg_seconds: 8 }],
          top_taps: [{ target: 'wifi_copy', section: 'wifi', taps: 24, devices: 11 }, { target: 'map_open', section: 'nearby', taps: 9, devices: 4 }, { target: 'checklist_item', section: 'checklist', taps: 8, devices: 5 }],
          funnel: { verify_start: 9, verify_ok: 5, browse_guest: 7, checklist_done: 3, message_sent: 4 },
          searches_without_result: [{ target: 'jollibee', n: 3 }, { target: 'pizza', n: 2 }] };
      },
      seriesV1: function () {
        var y = +today.slice(0, 4), m = +today.slice(5, 7) - 1, months = [], pace = [], i, mo, cap = 30;
        for (i = 12; i >= 0; i--) {
          mo = new Date(Date.UTC(y, m - i, 1));
          var k = 12 - i, occ = 50 + k * 2, adr = 1800 + k * 40, sold = Math.round(cap * occ / 100), lo = occ - 6, la = adr - 120;
          months.push({ month: isoOf(mo.getTime()), capacity_nights: cap, sold_nights: sold, occupancy: occ, adr: adr, revpar: occ * adr / 100, revenue: sold * adr, coverage: { occupancy: 'complete', adr: 'complete', revpar: 'complete', revenue: 'complete' },
            ly: i >= 1 && i <= 8 ? { occupancy: lo, adr: la, revpar: lo * la / 100, revenue: Math.round(cap * lo / 100) * la, capacity_nights: cap, sold_nights: Math.round(cap * lo / 100) } : null });
        }
        for (i = 0; i < 3; i++) pace.push({ month: isoOf(Date.UTC(y, m + i, 1)), capacity_nights: 30, otb_nights: 18 - i * 5, ly_otb_nights: 15 - i * 5, ly_unknown_booking_date: 0, ly_asof: today });
        return { propertyId: 'demo', definition: 'metrics.v1', financeVisible: true, asOf: today, months: months, pace: pace };
      },
      series: function (months) { return months.map(function (mo, i) { var f = 1 + i * 0.06; return { metrics: {
        occupancy: { value: String(Math.min(95, 52 + i * 4)), unit: 'percent' }, accommodation_revenue: { value: (24000 * f).toFixed(2), unit: 'PHP' },
        adr: { value: (2000 + i * 90).toFixed(2), unit: 'PHP' }, sold_nights: { value: String(12 + i), unit: 'night' } } }; }); },
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
    if (!tabOk(t)) t = 'today';
    S.tab = t; ls('set', 'cs_n_tab', t); S.sheet = null;
    if (replace) { try { history.replaceState(null, '', t === 'today' ? '#manage' : '#manage/' + t); } catch (e) { /* no history in tests */ } }
    draw(); loadTab(t, false);
  }

  // The two lists the Needs you card reads live: older than a minute they are read again when the tab is shown or the app comes back (the overview keeps five).
  var LIVE = { inq: true, waiting: true }, LIVE_MS = 60000;
  function normalizeWaiting(raw) {
    var o = Array.isArray(raw) ? raw[0] : raw; if (!o || typeof o !== 'object') return { waiting: 0, oldest_at: null };
    var n = Number(o.waiting); return { waiting: isFinite(n) && n > 0 ? Math.floor(n) : 0, oldest_at: str(o.oldest_at) };
  }
  function loadTab(t, force) {
    if (t === 'today') { load('overview', force); load('inq', force); load('waiting', force); }
    else if (t === 'inquiries') load('inq', force);
    else if (t === 'money') { load('txns', force); load('rq', force); }
    else if (t === 'kpis') { load('kpi', force); loadSeries(force); if (canManage(S.role)) load('gg', force); if (canManage(S.role) && S.ggOpen) load('ggg', force); }
  }
  // One get_hospitality_series_v1 call (13 months: twelve full ones and the running month) when the server has it and the chart module is loaded;
  // otherwise the older way: six monthly get_hospitality_metrics_v1 calls, two at a time. Kept in memory for the session.
  var SERIES_CONCURRENCY = 2;
  function chartsLib() { return typeof window !== 'undefined' && window.N_CHARTS && typeof window.N_CHARTS.kpiTile === 'function' ? window.N_CHARTS : null; }
  function loadSeries(force) {
    var st = S.d.series || (S.d.series = {}); if (st.busy) return;
    if (st.ok && !force && clock() - (st.at || 0) <= 5 * 60000) return;
    var months = lastMonths(S.today, 6), gen = S.gen, answers = new Array(months.length), next = 0, active = 0, absent = false, denied = false;
    st.busy = true; st.err = false; st.months = months; draw();
    var finish = function () {
      if (!S || S.gen !== gen) return; st.busy = false; st.absent = absent; st.denied = denied; st.v1 = null;
      if (!absent && !denied) { st.series = buildSeries(months, answers); st.ok = true; st.at = clock(); } else { st.ok = false; }
      draw();
    };
    var v1ok = function (d) { st.busy = false; st.absent = false; st.denied = false; st.v1 = d; st.ok = true; st.at = clock(); draw(); };
    if (S.demo) { Promise.resolve().then(function () { if (!S || S.gen !== gen) return; if (chartsLib()) v1ok(S.demoData.seriesV1()); else { answers = S.demoData.series(months); finish(); } }); return; }
    if (!S.client || !online()) { Promise.resolve().then(function () { st.busy = false; st.ok = false; st.err = true; draw(); }); return; }
    var pump = function () {
      if (!S || S.gen !== gen) return;
      while (active < SERIES_CONCURRENCY && next < months.length) {
        (function (i) {
          active++;
          callRpc('get_hospitality_metrics_v1', { p_property_id: pid(), p_start: months[i].start, p_end_exclusive: months[i].endExclusive }).then(function (r) {
            active--;
            if (r.error) { if (isMissing(r.error)) absent = true; else if (isDenied(r.error)) denied = true; } else answers[i] = r.data;
            if (next >= months.length && active === 0) finish(); else pump();
          });
        })(next++);
      }
    };
    if (!S.v1Absent && chartsLib()) {
      callRpc('get_hospitality_series_v1', { p_property_id: pid(), p_months: 13 }).then(function (r) {
        if (!S || S.gen !== gen) return;
        if (!r.error && r.data && Array.isArray(r.data.months)) { v1ok(r.data); return; }
        if (r.error && isMissing(r.error)) S.v1Absent = true; // the release is not live yet: the old six calls, and no second try this visit
        pump();
      });
      return;
    }
    pump();
  }
  function stale() { return clock() - (S.loadedAt || 0) > 5 * 60000; }

  // load(kind): each kind has its own state { ok, data, err, absent, busy }. A missing RPC sets absent and hides that section.
  function load(kind, force) {
    S.today = manilaToday(); // a screen opened past midnight uses today's periods
    var st = S.d[kind] || (S.d[kind] = {}); if (st.busy) return;
    if (kind === 'gg' && ggAbsent && !S.ggProbe && !S.demo) { st.absent = true; st.ok = false; return; } // only the person's own Refresh / Try again probes again
    if (kind === 'ggg' && gggAbsent && !S.gggProbe && !S.demo) { st.absent = true; st.ok = false; return; }
    if (kind === 'ggg') S.gggProbe = false;
    if (kind === 'gg') S.ggProbe = false; if (st.ok && !force && (LIVE[kind] ? clock() - (st.at || 0) <= LIVE_MS : kind === 'ggg' ? clock() - (st.at || 0) <= 5 * 60000 : !stale())) return; // guests: its own five minutes, not the page-wide loadedAt
    st.busy = true; st.err = ''; var gen = S.gen, key = kind === 'kpi' ? S.period : '';
    draw();
    var done = function (res) {
      if (!S || S.gen !== gen) return; st.busy = false;
      if (res.error) { if (isMissing(res.error)) { st.absent = true; st.ok = false; if (kind === 'gg' && !S.demo) ggAbsent = true; if (kind === 'ggg' && !S.demo) gggAbsent = true; } else if (isDenied(res.error)) { st.denied = true; st.ok = false; } else { st.err = plainError(res.error, false); st.ok = false; } }
      else { if (kind === 'gg') { ggAbsent = false; ggSeen = true; } if (kind === 'ggg') gggAbsent = false; st.ok = true; st.absent = false; st.denied = false; st.data = res.data; st.at = clock(); S.loadedAt = clock(); }
      if (kind === 'kpi' && key !== S.period) { st.ok = false; loadTab('kpis', true); return; }
      draw();
    };
    if (S.demo) { // built-in sample, no network
      var dd = S.demoData, per = periodPreset(S.period, S.today), cmp = comparablePeriod(per, compareMode(S.period));
      var sample = kind === 'overview' ? dd.overview : kind === 'inq' ? normalizePayments(dd.inquiries) : kind === 'waiting' ? normalizeWaiting(dd.waiting) : kind === 'txns' ? dd.txns : kind === 'rq' ? dd.rq() : kind === 'cats' ? dd.cats : kind === 'gg' ? dd.guide() : kind === 'ggg' ? dd.guests() : { now: dd.metrics(per.start, per.endExclusive), prev: dd.metrics(cmp.start, cmp.endExclusive) };
      Promise.resolve().then(function () { done({ data: sample, error: null }); }); return;
    }
    if (!online() || !S.client) { Promise.resolve().then(function () { done({ data: null, error: { message: 'failed to fetch' } }); }); return; }
    if (kind === 'overview') {
      callRpc('get_admin_overview_v1', { p_property_id: pid() }).then(done); // admin-dashboard features/today/api.ts:31
    } else if (kind === 'inq') {
      callRpc('staff_inquiry_payments_v1', { p_property_id: pid() }).then(function (r) { done(r.error ? r : { data: normalizePayments(r.data), error: null }); }); // features/bookings/confirm-api.ts:13
    } else if (kind === 'waiting') {
      callRpc('concierge_waiting_v1', {}).then(function (r) { done(r.error ? r : { data: normalizeWaiting(r.data), error: null }); }); // 42501 for anyone but owner or admin: treated as "not shown"
    } else if (kind === 'txns') {
      var q; // features/finance/api.ts:36-45 the default list: not void, not hidden, not the Airbnb mirror rows; limited to the newest ten
      try {
        q = S.client.from('transactions').select('id, transaction_date, txn_type, category, status, source, gross_amount, payee_name, notes, created_at').eq('property_id', pid())
          .neq('status', 'void').is('hidden_at', null).not('source', 'in', '("airbnb","airbnb_email")').order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).limit(10);
      } catch (e) { done({ data: null, error: e }); return; }
      Promise.resolve(q).then(function (r) { done(r || { data: null, error: { message: 'failed to fetch' } }); }, function (e) { done({ data: null, error: e }); });
    } else if (kind === 'rq') {
      callRpc('admin_review_queue_v1', { p_property_id: pid() }).then(done);
    } else if (kind === 'cats') {
      callRpc('expense_categories_v1', { p_property_id: pid() }).then(done);
    } else if (kind === 'gg') {
      callRpc('staff_guide_usage_v1', { p_days: GG_DAYS }).then(done); // guide v8: a missing function sets absent and the card never draws
    } else if (kind === 'ggg') {
      callRpc('staff_guide_guests_v1', { p_days: GG_DAYS }).then(done); // lazily, when the More fold opens
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

  // ---- "Needs you" (R1.8): the first card of Manage > Today. One list, one order, only the receipt row carries the gold bar. ----
  function srcState(st) { if (!st) return 'wait'; if (st.absent) return 'absent'; if (st.denied) return 'denied'; if (st.err) return 'err'; return st.data !== undefined && st.data !== null ? 'ok' : 'wait'; }
  function rowBtn(cls, act, v, title, sub, tag) {
    var inner = '<span class="N_rowmid"><span class="N_rowt">' + esc(title) + '</span>' + (sub ? '<span class="N_rows">' + esc(sub) + '</span>' : '') + '</span><span class="N_chev" aria-hidden="true">›</span>';
    return tag === 'a' ? '<a class="N_row' + cls + '" href="' + esc(v) + '" data-n="' + act + '" data-v="' + esc(v) + '">' + inner + '</a>' : '<button class="N_row' + cls + '" type="button" data-n="' + act + '" data-v="' + esc(v) + '">' + inner + '</button>';
  }
  function byNewestReceipt(a, b) { var x = Date.parse(a.receipt_at), y = Date.parse(b.receipt_at); x = isFinite(x) ? x : -Infinity; y = isFinite(y) ? y : -Infinity; return y === x ? 0 : y > x ? 1 : -1; }
  function byHold(a, b) { var x = Date.parse(a.hold_expires_at), y = Date.parse(b.hold_expires_at); x = isFinite(x) ? x : Infinity; y = isFinite(y) ? y : Infinity; return x === y ? 0 : x > y ? 1 : -1; }
  function stable(list, cmp) { return list.map(function (r, i) { return [r, i]; }).sort(function (a, b) { return cmp(a[0], b[0]) || a[1] - b[1]; }).map(function (x) { return x[0]; }); }
  function sentRows() { var iq = S.d.inq; return stable(((iq && iq.data) || []).filter(function (p) { return !legacyRow(p) && p.receipt_sent === true; }), byNewestReceipt); }
  function waitRows() { var iq = S.d.inq; return stable(((iq && iq.data) || []).filter(function (p) { return !legacyRow(p) && p.receipt_sent === false; }), byHold); }
  // an inquiry row (receipts, guests waiting, requests waiting for payment) is never folded under "Show more"; the String object carries the mark
  function inqRow(html) { var o = new String(html); o.inq = true; return o; }
  function needsRows(ov, iq, wt) {
    var out = [], fin = ov && ov.finance, now = clock();
    if (iq) {
      var all = iq.data || [];
      if (all.some(legacyRow)) { if (all.length) out.push(inqRow(rowBtn('', 'tab', 'inquiries', count(all.length, 'inquiry waiting', 'inquiries waiting'), 'Confirm or decline'))); }
      else {
        var sent = sentRows(), newest = sent.length && sent[0].receipt_at ? agoWords(sent[0].receipt_at, now) : '';
        if (sent.length) out.push(inqRow(rowBtn(' N_due', 'needs-sent', sent.length === 1 ? sent[0].id : '', count(sent.length, 'receipt to check', 'receipts to check'), newest ? 'Newest sent ' + newest : 'Tap to confirm or decline')));
      }
    }
    if (wt && wt.waiting > 0) out.push(inqRow(rowBtn('', 'nav', '#inbox', count(wt.waiting, 'guest waiting for a reply', 'guests waiting for a reply'), wt.oldest_at ? 'Waiting since ' + (manilaParts(wt.oldest_at) && manilaParts(wt.oldest_at).day === manilaToday(now) ? fmtTimeOnly(wt.oldest_at) : fmtDateTime(wt.oldest_at)) : '', 'a')));
    var row8 = null;
    if (iq && !(iq.data || []).some(legacyRow)) {
      var wr = waitRows();
      if (wr.length) {
        var ended = wr.some(function (p) { return p.hold_expires_at && holdEnded(p.hold_expires_at, now); }), next = wr.filter(function (p) { return p.hold_expires_at && !holdEnded(p.hold_expires_at, now); })[0];
        row8 = { first: ended, html: inqRow(rowBtn('', 'tab', 'inquiries', count(wr.length, 'request waiting for payment', 'requests waiting for payment'), ended ? 'A hold has ended. Confirm or decline it.' : 'Nothing to do yet' + (next ? ' · next hold ends ' + fmtHoldAt(next.hold_expires_at) : ''))) };
      }
    }
    if (row8 && row8.first) out.push(row8.html);
    if (ov) {
      var r = ov.readiness || {};
      if (r.blockingWorkOrders > 0) out.push(dashLink('operations/work-orders', count(r.blockingWorkOrders, 'work order blocks arrival', 'work orders block arrival'), 'Opens the dashboard'));
      if (fin && fin.paymentReviewCount > 0) out.push(dashLink('finance', count(fin.paymentReviewCount, 'payment to review', 'payments to review'), 'Opens the dashboard'));
      if (fin && fin.pendingReviewCount > 0) {
        var rqOff = S.d.rq && (S.d.rq.absent || S.d.rq.denied), rqTxt = count(fin.pendingReviewCount, 'transaction awaits review', 'transactions await review');
        out.push(rqOff ? dashLink('finance', rqTxt, formatPHP(fin.pendingReviewAmount)) : rowBtn('', 'tab', 'money', rqTxt, formatPHP(fin.pendingReviewAmount) + ' · Review in Money'));
      }
      if (fin && fin.unpaidCleanerFees > 0) out.push('<a class="N_row" href="./pay/admin.html"><span class="N_rowmid"><span class="N_rowt">' + esc(count(fin.unpaidCleanerFees, 'cleaning fee unpaid', 'cleaning fees unpaid')) + '</span><span class="N_rows">Opens Pay staff</span></span><span class="N_chev" aria-hidden="true">›</span></a>');
      if (ov.lowStock && ov.lowStock.length) out.push(dashLink('inventory', count(ov.lowStock.length, 'item low on stock', 'items low on stock'), 'Opens the dashboard'));
    }
    if (row8 && !row8.first) out.push(row8.html);
    return out;
  }
  function needsCard() {
    var ovS = S.d.overview, iqS = S.d.inq, wtS = S.d.waiting, st = [srcState(ovS), srcState(iqS), srcState(wtS)];
    var anyOk = st.indexOf('ok') >= 0, anyErr = st.indexOf('err') >= 0, pending = st.indexOf('wait') >= 0, body;
    var rows = needsRows(st[0] === 'ok' ? ovS.data || {} : null, st[1] === 'ok' ? iqS : null, st[2] === 'ok' ? wtS.data : null);
    if (!anyOk && anyErr && !pending) body = '<div class="N_pad">' + stateBox(st[0] === 'err' ? ovS : st[1] === 'err' ? iqS : wtS, 'Today', 'today') + '</div>';
    else {
      var shown = rows;
      var inqN = rows.filter(function (x) { return x.inq; }).length, slots = Math.max(0, 4 - inqN), ovN = rows.length - inqN;
      if (rows.length > 5 && ovN - slots >= 2 && !S.needsOpen) {
        var seen = 0; shown = rows.filter(function (x) { return x.inq || ++seen <= slots; }).map(String);
        shown.push('<button class="N_row" type="button" data-n="needs-more" aria-expanded="false"><span class="N_rowmid"><span class="N_rowt">' + esc('Show ' + (ovN - slots) + ' more') + '</span></span><span class="N_chev" aria-hidden="true">⌄</span></button>');
      }
      var fail = st[1] === 'err' ? 'Requests could not be loaded' : st[0] === 'err' ? 'Other items could not be loaded' : st[2] === 'err' ? 'Guest replies could not be loaded' : '';
      if (fail) shown = shown.concat(rowBtn('', 'retry', 'today', fail, 'Try again'));
      body = shown.length ? shown.join('') : pending ? '<p class="N_p N_pad N_wait">Checking…</p>' : '<p class="N_p N_pad">All clear. Nothing needs you right now.</p>';
    }
    return '<section class="N_card N_list" aria-labelledby="N_t3"><h3 class="N_h3 N_pad" id="N_t3">Needs you</h3>' + body + '</section>';
  }

  function viewToday() {
    var ov = S.d.overview || {}, out = needsCard();
    if (ov.absent || ov.denied) out += stateBox(ov, 'Today', 'today');
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
      if (o.finance === null) out += '<p class="N_foot">Money figures are not available for your role.</p>';
    }
    return out;
  }

  // ---- Inquiries (R1.2): receipt sent first (gold bar), then waiting for payment. An old server (no receipt_sent) keeps today's single list. ----
  function stayCardOld(p) {
    var nights = p.checkin_date && p.checkout_date ? nightsBetween(p.checkin_date, p.checkout_date) : null;
    return '<button class="N_card N_tap" type="button" data-n="inq-open" data-v="' + esc(p.id) + '" aria-label="' + esc('Open request from ' + (p.guest_name || 'a guest')) + '">' +
      '<span class="N_cardtop"><span class="N_name">' + esc(p.guest_name || 'A guest') + '</span>' + (hasReceipt(p) ? pill('ok', 'Receipt') : pill('warn', 'No receipt')) + '</span>' +
      '<span class="N_line">' + esc(fmtDate(p.checkin_date, 'weekday') + ' to ' + fmtDate(p.checkout_date, 'weekday') + (nights !== null ? ' · ' + count(nights, 'night', 'nights') : '')) + '</span>' +
      '<span class="N_line N_num">To receive ' + esc(formatPHP(p.expected_amount)) + '</span>' +
      '<span class="N_line">' + esc(paymentLine(p)) + '</span></button>';
  }
  function holdLine(p, now) { return !p.hold_expires_at ? 'No hold' : (holdEnded(p.hold_expires_at, now) ? 'Hold ended ' : 'Held until ') + fmtHoldAt(p.hold_expires_at); }
  function stayCard(p) {
    var now = clock(), cmp = receiptCmp(p), nights = p.checkin_date && p.checkout_date ? nightsBetween(p.checkin_date, p.checkout_date) : null, name = p.guest_name || 'A guest';
    var toRecv = p.expected_amount === null ? null : formatPHP(p.expected_amount), l3, l4 = '';
    if (cmp) {
      if (cmp.kind === 'ok') l3 = nw(toRecv) + ' ' + nw('· receipt matches');
      else if (cmp.kind === 'short' || cmp.kind === 'over') l3 = nw(toRecv + ' to receive') + ' ' + nw('· receipt ' + cents(cmp.diff) + (cmp.kind === 'short' ? ' short' : ' over'));
      else l3 = nw(toRecv ? toRecv + ' to receive' : 'Amount not known') + ' ' + nw('· check the photo');
      if (p.receipt_at) l4 = '<span class="N_line">Sent ' + esc(agoWords(p.receipt_at, now)) + '</span>';
    }
    return '<button class="N_card N_tap N_go' + (cmp ? ' N_due' : '') + '" type="button" data-n="inq-open" data-v="' + esc(p.id) + '" aria-label="' + esc('Open request from ' + name + (cmp ? ', receipt sent' : ', waiting for payment')) + '">' +
      '<span class="N_name">' + esc(name) + '</span>' +
      '<span class="N_line">' + nw(fmtDate(p.checkin_date, 'weekday') + ' to ' + fmtDate(p.checkout_date, 'weekday')) + (nights !== null ? ' ' + nw('· ' + count(nights, 'night', 'nights')) : '') + '</span>' +
      (cmp ? '<span class="N_line N_num">' + l3 + '</span>' + l4 : '<span class="N_line">' + esc(holdLine(p, now)) + '</span>') + '<span class="N_chev" aria-hidden="true">›</span></button>';
  }
  function viewInquiries() {
    var iq = S.d.inq || {}, box = stateBox(iq, 'Inquiries', 'inquiries');
    if (box) return box;
    var rows = iq.data || [], foot = '<p class="N_foot"><a class="N_link" href="#door/dashboard/bookings/inquiries" data-n="go" data-v="bookings/inquiries">Open all inquiries in the dashboard</a></p>';
    if (!rows.length) return '<div class="N_note">No requests are waiting for a decision.</div>';
    if (rows.some(legacyRow)) return '<p class="N_sub">' + esc(count(rows.length, 'request is', 'requests are') + ' waiting. Tap one to confirm or decline it.') + '</p>' + rows.map(stayCardOld).join('') + foot;
    var sent = sentRows(), wait = waitRows(), out = '';
    if (sent.length) out += '<h3 class="N_h3 N_gap">' + esc('Receipt sent · ' + sent.length) + '</h3>' + sent.map(stayCard).join('');
    if (wait.length) out += '<h3 class="N_h3 N_gap">' + esc('Waiting for payment · ' + wait.length) + '</h3>' + wait.map(stayCard).join('');
    return out + foot;
  }

  function signOf(type) { return type === 'income' ? '+' : type === 'expense' ? '−' : ''; } // a transfer moves money between accounts: no sign
  function rqRows() { var q = S.d.rq; return q && q.ok && q.data && Array.isArray(q.data.rows) ? q.data.rows : []; }
  function rqOf(id) { var r = rqRows(); for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i]; return null; }
  function srcWords(src) { var k = String(src || '').toLowerCase(); return /ocr|scan|receipt/.test(k) ? 'a scanned receipt' : /telegram/.test(k) ? 'Telegram' : /manual|staff|app/.test(k) ? 'an entry in the app' : /email|mail/.test(k) ? 'an e-mail' : 'another source'; }
  // s134: a stock row whose amount is not fully priced. Same words as the Expenses screen (E_expenses.js M.incomplete); a test pins the match.
  var INCOMPLETE = 'Amount incomplete - price the rest in Inventory';
  function rqIncomplete(r) { return !!r && r.s134_incomplete === true; }
  function refusalWords(res) {
    var c = res && (res.error || res.reason), w = res && res.where;
    if (c === 'amount_incomplete') return INCOMPLETE;
    if (c === 'amount_locked') return 'That amount follows Inventory. Change the price in Inventory.';
    if (c === 'system_category') return 'This category is set by the system and can’t be picked here.';
    if (c === 'locked' && w === 'Pay staff') return 'This category is set by Pay staff.';
    if (c === 'locked') return 'This entry is locked. Only the category and notes can change here.';
    return null;
  }
  function lowConf(c) { return typeof c === 'number' && c < SCAN_LOW; }
  function rqHtml() {
    var q = S.d.rq || {}; if (q.absent || q.denied) return '';
    if (q.err) return '<div class="N_err" role="alert"><span>The review list could not be loaded.</span><button class="btn btn-secondary btn-sm" type="button" data-n="retry" data-v="money">Try again</button></div>';
    if (!q.ok) return '';
    var rows = rqRows(), d = q.data || {};
    if (!rows.length) return '<p class="N_foot">Nothing is waiting for your review.</p>';
    var total = typeof d.count === 'number' ? d.count : rows.length; // count is the number of rows; total is a sum of pesos
    return '<section class="N_card N_list" aria-labelledby="N_rq"><h3 class="N_h3 N_pad" id="N_rq">' + esc('Waiting for your review (' + total + ')') + '</h3>' +
      (d.truncated || total > rows.length ? '<p class="N_sub N_pad">' + esc('Showing ' + rows.length + ' of ' + total + '. The rest appear as you clear these.') + '</p>' : '') + rows.map(function (r) {
        var sub = fmtDate(r.transaction_date, 'weekday') + ' · ' + (r.category ? catName(r.category) : 'No category yet') + (r.receipt_image_path ? ' · Receipt photo' : '') + (lowConf(r.ocr_confidence) ? ' · Hard to read, please check' : '');
        return '<button class="N_row" type="button" data-n="rq-open" data-v="' + esc(r.id) + '"><span class="N_rowmid"><span class="N_rowt">' + esc(r.payee_name || r.notes || (r.category ? catName(r.category) : 'A transaction')) + '</span><span class="N_rows' + (lowConf(r.ocr_confidence) ? ' N_dn' : '') + '">' + esc(sub) + '</span>' + (rqIncomplete(r) ? '<span class="N_rows E_inc N_inc">' + esc(INCOMPLETE) + '</span>' : '') + '</span><span class="N_amt N_num">' + signOf(r.txn_type) + esc(formatPHP(r.gross_amount)) + '</span><span class="N_chev" aria-hidden="true">›</span></button>';
      }).join('') + '</section>';
  }
  function viewMoney() {
    var t = S.d.txns || {}, out = '';
    out += '<a class="btn btn-primary btn-block" href="#expenses/add">Log an expense</a>'; // s134: the one expense form lives in #expenses (expenses/E_expenses.js)
    out += rqHtml();
    var box = stateBox(t, 'The transaction list', 'money');
    out += '<h3 class="N_h3 N_gap">Latest 10 transactions</h3>';
    if (box) out += box;
    else if (!(t.data || []).length) out += '<div class="N_note">No transactions yet.</div>';
    else out += '<section class="N_card N_list">' + t.data.map(function (r) {
      return '<div class="N_row N_static"><span class="N_rowmid"><span class="N_rowt">' + esc(r.payee_name || r.notes || catLabel(r.category)) + '</span><span class="N_rows">' + esc(fmtDate(r.transaction_date, 'weekday') + ' · ' + catLabel(r.category) + (r.txn_type === 'transfer' ? ' · transfer' : '') + (r.status && r.status !== 'confirmed' ? ' · ' + catLabel(r.status) : '')) + '</span></span><span class="N_amt N_num">' + signOf(r.txn_type) + esc(formatPHP(r.gross_amount)) + '</span></div>';
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
    var box = stateBox(k, 'KPIs', 'kpis'); if (box) return out + (k.busy || (!k.ok && !k.err && !k.absent && !k.denied) ? chartsSkeleton() : '') + box;
    var now = k.data && k.data.now, prev = k.data && k.data.prev, mNow = (now && now.metrics) || {}, mPrev = (prev && prev.metrics) || {};
    var cl = cmp.endExclusive > cmp.start ? 'vs ' + shortRange(cmp.start, cmp.endExclusive, +per.start.slice(0, 4)) : ''; // the 1st of a period compares an empty window: keep the default wording
    out += chartsHtml(mNow, mPrev, !!prev, cl);
    KPI_GROUPS.forEach(function (g) {
      var rows = g.keys.filter(function (key) { return mNow[key]; }); if (!rows.length) return;
      out += '<section class="N_card N_list" aria-label="' + esc(g.title) + '"><h3 class="N_h3 N_pad">' + esc(g.title) + '</h3>' + rows.map(function (key) {
        var m = mNow[key], dl = deltaLine(m, prev ? mPrev[key] : null, key, cl), na = m.value === null || m.value === undefined;
        return '<div class="N_row N_static N_kpi"><span class="N_rowmid"><span class="N_rowt">' + esc(KPI_TITLE[key] || key) + '</span>' +
          (dl.text ? '<span class="N_rows' + (dl.tone === 'bad' ? ' N_dn' : dl.tone === 'good' ? ' N_gd' : '') + '">' + (dl.dir === 'up' ? '<span aria-hidden="true">▲</span> ' : dl.dir === 'down' ? '<span aria-hidden="true">▼</span> ' : '') + esc(dl.text) + '</span>' : '') +
          (m.coverage === 'missing' ? '<span class="N_rows">Not enough data yet</span>' : m.coverage === 'partial' ? '<span class="N_rows">Some of the data is still to come</span>' : '') + '</span>' +
          '<span class="N_val N_num' + (na ? ' N_na' : '') + '">' + esc(formatMetricValue(m)) + '</span></div>';
      }).join('') + '</section>';
    });
    out += ggHtml();
    if (now && now.blockedNights > 0) out += '<p class="N_foot">' + esc(count(now.blockedNights, 'calendar-blocked night is', 'calendar-blocked nights are') + ' unexplained and still count as sellable, so occupancy may read low.') + '</p>';
    out += '<p class="N_foot"><a class="N_link" href="#door/dashboard/insights" data-n="go" data-v="insights">Desk tools: full KPIs in the dashboard</a></p>';
    return out;
  }

  // ---- 3.1.1 chart cards (inline SVG and CSS only; every figure is a server figure) ----
  function chartsSkeleton() {
    return '<div class="N_charts" aria-hidden="true">' + [1, 2, 3, 4].map(function () { return '<div class="N_card N_hcard N_skel"></div>'; }).join('') + '<div class="N_card N_wide N_skel"></div></div>';
  }
  function sparkPoints(vals, W, H, mode) { // x evenly spaced, y scaled to the series max; null = gap
    var mx = -Infinity, mn = Infinity; vals.forEach(function (v) { if (v !== null) { if (v > mx) mx = v; if (v < mn) mn = v; } });
    if (mode === 'pct') { mn = 0; mx = 100; } else if (mode === 'zero') { mn = Math.min(0, mn); } // a percent runs 0-100, money has a zero floor: 60-61-60 must not look volatile
    var span = mx - mn;
    return vals.map(function (v, i) { return v === null ? null : { x: vals.length > 1 ? 2 + (W - 4) * i / (vals.length - 1) : W / 2, y: span > 0 ? H - 4 - (H - 8) * ((v - mn) / span) : H / 2, v: v, i: i }; }); // a line trend uses the series' own range
  }
  function sparkLine(vals, mode) {
    var W = 120, H = 32, pts = sparkPoints(vals, W, H, mode), segs = [], cur = [];
    pts.forEach(function (p) { if (p) cur.push(p); else { if (cur.length) segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
    return '<svg class="N_spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + segs.map(function (sg) {
      var d = sg.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
      return '<path class="N_sarea" d="' + d + ' L' + sg[sg.length - 1].x.toFixed(1) + ' ' + H + ' L' + sg[0].x.toFixed(1) + ' ' + H + ' Z"/><path class="N_sline" d="' + d + '"/>';
    }).join('') + '</svg>';
  }
  function sparkBars(vals) {
    var W = 120, H = 32, n = vals.length, mx = 0; vals.forEach(function (v) { if (v !== null && v > mx) mx = v; }); if (mx <= 0) mx = 1;
    var bw = W / n * 0.62;
    return '<svg class="N_spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + vals.map(function (v, i) {
      if (v === null || v <= 0) return ''; var h = Math.max(1.5, (H - 2) * (v / mx)), x = W / n * i + (W / n - bw) / 2;
      return '<rect class="N_sbar" x="' + x.toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"/>';
    }).join('') + '</svg>';
  }
  function chipHtml(c, lbl) { return c ? '<span class="N_chipd N_' + c.dir + '"><span aria-hidden="true">' + c.glyph + '</span> ' + esc(c.text) + ' <span class="N_vs">' + esc(lbl || 'vs before') + '</span></span>' : '<span class="N_chipd N_flat N_vs">No comparison</span>'; }
  var HEADS = [['occupancy', 'Occupancy', 'occ', 'line'], ['accommodation_revenue', 'Accommodation revenue', 'rev', 'bars'], ['adr', 'Accommodation ADR', 'adr', 'line'], ['sold_nights', 'Sold nights', 'nights', 'bars']];
  function monthFigures(m) { return m.failed || (m.rev === null && m.occ === null) ? esc(monthTitle(m)) + ': No data' : esc(monthTitle(m)) + ': Revenue ' + (m.rev === null ? 'No data' : esc(formatPHP(String(m.rev)))) + ' · Occupancy ' + (m.occ === null ? 'No data' : esc(formatPercent(m.occ))); }
  function chartsHtml(mNow, mPrev, hasPrev, cl) {
    var se = S.d.series || {};
    if (se.absent || se.denied || se.err) return ''; // old server or refused: the number rows below remain
    if (se.busy || !se.ok) return chartsSkeleton();
    if (se.v1) return chartsV1(se.v1);
    var series = se.series, out = '<div class="N_charts">';
    HEADS.forEach(function (h) {
      var m = mNow[h[0]]; if (!m) return;
      var vals = series.map(function (x) { return x[h[2]]; });
      out += '<section class="N_card N_hcard" aria-label="' + esc(h[1]) + '"><span class="N_hl">' + esc(h[1]) + '</span><span class="N_hv N_num">' + esc(formatMetricValue(m)) + '</span>' + chipHtml(hasPrev ? chipFor(m, mPrev[h[0]]) : null, cl) +
        (vals.some(function (v) { return v !== null; }) ? (h[3] === 'line' ? sparkLine(vals, h[0] === 'occupancy' ? 'pct' : 'zero') : sparkBars(vals)) + '<span class="N_hs">Last 6 months</span>' : '<span class="N_hs">No data for the last 6 months</span>') + '</section>';
    });
    // the wide card
    var W = 600, H = 160, col = W / 6, mxR = 0; series.forEach(function (x) { if (x.rev !== null && x.rev > mxR) mxR = x.rev; }); if (mxR <= 0) mxR = 1;
    var sel = S.monSel; if (sel == null || sel < 0 || sel > 5) { sel = -1; for (var i = series.length - 1; i >= 0; i--) if (!series[i].failed && (series[i].rev !== null || series[i].occ !== null)) { sel = i; break; } if (sel < 0) sel = 5; }
    var grid = [0.25, 0.5, 0.75, 1].map(function (f) { return '<line class="N_grid" x1="0" x2="' + W + '" y1="' + (H - H * f).toFixed(1) + '" y2="' + (H - H * f).toFixed(1) + '"/>'; }).join('');
    var bars = series.map(function (x, i) { if (x.rev === null || x.rev <= 0) return ''; // no bar for a gap, zero or negative: the caption and table give the figure
       var h = Math.max(2, (H - 6) * (x.rev / mxR)); return '<rect class="N_bar' + (i === sel ? ' N_on' : '') + '" x="' + (col * i + col * 0.2).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + (col * 0.6).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="5"/>'; }).join('');
    var pts = series.map(function (x, i) { return x.occ === null ? null : { x: col * i + col / 2, y: H - 8 - (H - 16) * Math.min(100, Math.max(0, x.occ)) / 100, i: i }; });
    var segs = [], cur = []; pts.forEach(function (p) { if (p) cur.push(p); else { if (cur.length) segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
    var line = segs.filter(function (sg) { return sg.length > 1; }).map(function (sg) { return '<path class="N_oline" d="' + sg.map(function (p, j) { return (j ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ') + '"/>'; }).join('');
    var dots = pts.map(function (p) { return p ? '<circle class="N_odot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.5"/>' : ''; }).join('');
    var hits = series.map(function (x, i) { return '<button class="N_hit" type="button" data-n="mon" data-v="' + i + '" aria-pressed="' + (i === sel) + '" aria-label="' + esc(monthFigures(x).replace(/<[^>]+>/g, '')) + '"></button>'; }).join('');
    var labels = series.map(function (x, i) { return '<button class="N_mlab' + (i === sel ? ' N_on' : '') + '" type="button" data-n="mon" data-v="' + i + '" tabindex="-1" aria-hidden="true">' + esc(x.label) + '</button>'; }).join('');
    out += '<section class="N_card N_wide" aria-labelledby="N_ch1"><h3 class="N_h3" id="N_ch1">Last 6 months</h3><p class="N_sub">Full calendar months, newest on the right. Bars are accommodation revenue; dots are occupancy.</p>' +
      '<div class="N_plot"><svg class="N_svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Bar chart of accommodation revenue for the last six months with occupancy dots. The same figures are in the table.">' + grid + bars + line + dots + '</svg><div class="N_hits">' + hits + '</div></div>' +
      '<div class="N_mlabs" aria-hidden="true">' + labels + '</div>' +
      '<p class="N_cap" role="status" aria-live="polite">' + monthFigures(series[sel]) + '</p>' +
      '<button class="N_link N_tbtn" type="button" data-n="tbl" aria-expanded="' + !!S.showTable + '">' + (S.showTable ? 'Hide the table' : 'Show as a table') + '</button>' +
      (S.showTable ? '<div class="N_tw"><table class="N_table"><thead><tr><th scope="col">Month</th><th scope="col">Revenue</th><th scope="col">Occupancy</th></tr></thead><tbody>' + series.map(function (x) {
        return '<tr><th scope="row">' + esc(monthTitle(x)) + '</th><td class="N_num">' + (x.rev === null ? 'No data' : esc(formatPHP(String(x.rev)))) + '</td><td class="N_num">' + (x.occ === null ? 'No data' : esc(formatPercent(x.occ))) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '') + '</section></div>';
    return out;
  }

  // get_hospitality_series_v1 -> four headline tiles for the last full month, twelve-month bars with last year behind them, and the pace card.
  // Every figure is the server's; the only maths here are the two comparisons (points for occupancy, percent for the rest), hidden when either side is missing.
  function chartsV1(d) {
    var C = chartsLib(); if (!C) return '';
    var cur = S.today.slice(0, 7), fin = d.financeVisible !== false, nm = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
    var ms = (d.months || []).filter(function (m) { return m && String(m.month).slice(0, 7) < cur; }); // the running month is partial, so it is not drawn as a month
    var lab = function (iso) { return MON[new Date(utc(String(iso).slice(0, 10))).getUTCMonth()]; };
    var out = '<div class="N_v1">';
    if (!ms.length) out += '<div class="N_note">Not enough data yet.</div>';
    else {
      var last = ms[ms.length - 1], prev = ms.length > 1 ? ms[ms.length - 2] : null, ly = last.ly || null, ly0 = +String(last.month).slice(0, 4);
      var mlab = function (mo) { var y = +String(mo).slice(0, 4); return lab(mo) + (y === ly0 ? '' : ' ' + y); }; // "Aug", or "Dec 2025" across a year
      var chg = function (a, b, pts) { a = nm(a); b = nm(b); if (a === null || b === null) return null; if (pts) return { v: a - b, unit: 'pt' }; return b === 0 ? null : (a - b) / Math.abs(b) * 100; };
      var tiles = [['revpar', 'RevPAR', 1], ['revenue', 'Revenue', 1], ['occupancy', 'Occupancy', 0], ['adr', 'ADR', 1]].filter(function (t) { return fin || !t[2]; }).map(function (t) {
        var k = t[0], v = nm(last[k]), pts = k === 'occupancy';
        return C.kpiTile({ title: t[1], value: v === null ? null : (pts ? C.formatPercent(v) : C.formatPHP(v)), spark: ms.map(function (m) { return nm(m[k]); }),
          deltaPrev: prev ? chg(last[k], prev[k], pts) : null, deltaYoY: ly ? chg(last[k], ly[k], pts) : null, goodWhen: 'up',
          prevLabel: prev ? 'vs ' + mlab(prev.month) : '', yoyLabel: 'vs ' + lab(last.month) + ' ' + (ly0 - 1) });
      }).join('');
      out += '<p class="N_sub">' + esc(lab(last.month) + ' ' + String(last.month).slice(0, 4) + ', the last full month. Compared with the month before' + (ly ? ' and with the same month last year.' : '.')) + '</p><div class="N_tiles">' + tiles + '</div>';
      out += '<h3 class="N_h3 N_gap">Month by month</h3><p class="N_sub">' + esc((fin ? 'Bars are accommodation revenue.' : 'Bars are nights sold.') + ' Tap a month for its figures.') + '</p>' + C.monthBars({ sel: S.monSel, // clamped inside monthBars: a stored index from the 6-month chart never points past the list
        months: ms.map(function (m) { return { label: lab(m.month), title: lab(m.month) + ' ' + String(m.month).slice(0, 4), value: fin ? nm(m.revenue) : nm(m.sold_nights), lastYear: m.ly ? (fin ? nm(m.ly.revenue) : nm(m.ly.sold_nights)) : null, occupancy: nm(m.occupancy) }; }),
        format: fin ? undefined : function (v) { return v + (v === 1 ? ' night' : ' nights'); } });
    }
    var pace = d.pace || [], unk = pace.reduce(function (a, p) { return a + (nm(p && p.ly_unknown_booking_date) || 0); }, 0);
    out += C.paceCard({ nextMonths: pace.map(function (p) { return { label: lab(p.month), booked: nm(p.otb_nights), bookedLastYear: nm(p.ly_otb_nights), capacity: nm(p.capacity_nights) }; }) });
    if (unk > 0) out += '<p class="N_foot">' + esc('Last year leaves out ' + count(unk, 'stay', 'stays') + ' with no booking date.') + '</p>';
    return out + '</div>';
  }

  // s135: the Guest guide card. Nothing is drawn while it loads, when the server does not have staff_guide_usage_v1 yet, or when the account may not read it.
  function ggRow(label, n) { return '<div class="N_row N_static N_kpi"><span class="N_rowmid"><span class="N_rowt">' + esc(label) + '</span></span><span class="N_val N_num">' + esc(ggNum(n)) + '</span></div>'; }
  function gggRow(g, i) {
    var bits = [(g.first ? 'First opened ' + g.first + ' · ' : '') + (g.opens === 1 ? '1 open' : ggNum(g.opens) + ' opens')]; if (g.checklist) bits.push('✓ Checklist'); if (g.messaged) bits.push('✉ Messaged');
    var mid = '<span class="N_rowmid"><span class="N_rowt">' + esc(g.label + (g.dates ? ' · ' + g.dates : '')) + '</span><span class="N_rows N_ggmeta">' + bits.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</span></span>';
    // a messaged guest has a thread in the inbox: the row opens it (approved mockup). The DOM carries the row index only, never the thread id; the click looks the id up in the model.
    return g.messaged ? '<button class="N_row" type="button" data-n="ggg-open" data-v="' + i + '">' + mid + '<span class="N_chev" aria-hidden="true">›</span></button>' : '<div class="N_row N_static">' + mid + '</div>';
  }
  function gggHtml() { // the guests block of the More fold: nothing when the server lacks the function or the account may not read it
    var st = S.d.ggg; if (!st || st.absent || st.denied) return '';
    var t = 'Guests who used the guide';
    if (st.ok) {
      var m = gggModel(st.data); if (!m) return '';
      if (m.empty) return '<h4 class="N_h4" id="N_ggg" tabindex="-1">' + esc(t + ' (0)') + '</h4><p class="N_sub">' + esc('No guest has signed in to the guide in the last 30 days.') + '</p>';
      var shown = S.gggAll ? m.guests : m.guests.slice(0, GGG_SHOW);
      return '<h4 class="N_h4" id="N_ggg" tabindex="-1">' + esc(t + ' (' + ggNum(m.total) + ')') + '</h4><div class="N_ggguests">' + shown.map(gggRow).join('') +
        (m.total > shown.length ? '<button class="N_row" type="button" data-n="ggg-all"><span class="N_rowmid"><span class="N_rowt">' + esc('Show all (' + ggNum(m.total) + ')') + '</span></span><span class="N_chev" aria-hidden="true">\u2304</span></button>' : '') + '</div>';
    }
    if (st.err) return '<h4 class="N_h4" id="N_ggg">' + esc(t) + '</h4><div class="N_err" role="alert"><span>' + esc('The guest list could not be loaded.') + '</span><button class="btn btn-secondary btn-sm" type="button" data-n="ggg-retry">Try again</button></div>';
    return '<h4 class="N_h4" id="N_ggg">' + esc(t) + '</h4><div class="N_note" role="status">Loading\u2026</div>';
  }
  function ggHtml() {
    var g = S.d.gg; if (!g || g.absent || g.denied || !canManage(S.role)) return '';
    var head = '<section class="N_card N_gg" aria-labelledby="N_gg1"><div class="N_ggtop"><h3 class="N_h3" id="N_gg1">Guest guide</h3>';
    if (g.err) return ggSeen ? head + '</div><div class="N_err" role="alert"><span>' + esc('The guest guide figures could not be loaded.') + '</span><button class="btn btn-secondary btn-sm" type="button" data-n="retry" data-v="kpis">Try again</button></div></section>' : ''; // before the first good answer, a failure draws nothing
    if (!g.ok) return '';
    var m = ggModel(g.data, GG_DAYS, S.today); if (!m) return '';
    var out = head + '<p class="N_sub">' + esc('Last ' + m.days + ' days.') + '</p></div>';
    if (m.empty) return out + '<p class="N_sub">' + esc('No guide visits in this time yet.') + '</p></section>';
    out += '<div class="N_ggrows">' + ggRow('Devices', m.devices) + ggRow('Opens', m.opens) + '</div>';
    if (m.perDay.length > 1 && m.perDay.some(function (v) { return v > 0; })) {
      var total = m.perDay.reduce(function (a, v) { return a + v; }, 0);
      out += '<div class="N_ggspark"><span class="N_hs">' + esc('Guide actions per day. ' + ggNum(total) + ' in all.') + '</span>' + sparkLine(m.perDay, 'zero') + '</div>';
    }
    var top = m.funnel.reduce(function (a, s) { return s.n > a ? s.n : a; }, 0), first = m.funnel[0].n || top;
    out += '<h4 class="N_h4">What guests do</h4><ol class="N_ggfun">' + m.funnel.map(function (s) {
      return '<li><span class="N_ggl">' + esc(s.label) + '</span><span class="N_ggv N_num">' + esc(ggNum(s.n)) + '</span><span class="N_ggbar" aria-hidden="true" style="--w:' + (first ? Math.min(100, Math.round(s.n / first * 100)) : 0) + '%"></span></li>'; }).join('') + '</ol>' +
      '<ul class="N_gglist">' + m.side.map(function (s) { return '<li><span class="N_ggl">' + esc(s.label) + '</span><span class="N_ggv N_num">' + esc(ggNum(s.n)) + '</span></li>'; }).join('') + '</ul>';
    var more = '';
    if (m.sections.length) more += '<h4 class="N_h4">Top sections</h4><ul class="N_gglist">' + m.sections.map(function (s) {
      return '<li><span class="N_ggl">' + esc(s.label) + '</span><span class="N_ggv N_num">' + esc(ggNum(s.views) + (s.views === 1 ? ' view' : ' views') + ' · ' + s.avg + ' avg') + '</span></li>'; }).join('') + '</ul>';
    if (m.taps.length) more += '<h4 class="N_h4">Top taps</h4><ul class="N_gglist">' + m.taps.map(function (t) {
      return '<li><span class="N_ggl">' + esc(t.label) + (t.where ? ' <span class="N_ggw">' + esc(t.where) + '</span>' : '') + '</span><span class="N_ggv N_num">' + esc(ggNum(t.taps) + (t.taps === 1 ? ' tap' : ' taps')) + '</span></li>'; }).join('') + '</ul>';
    if (m.searches.length) more += '<h4 class="N_h4">Delivery searches with no result</h4><ul class="N_gglist">' + m.searches.map(function (s) {
      return '<li><span class="N_ggl">' + esc(s.target) + '</span><span class="N_ggv N_num">' + esc(ggNum(s.n) + (s.n === 1 ? ' time' : ' times')) + '</span></li>'; }).join('') + '</ul>';
    var gs = S.d.ggg; // the fold is drawn while guests may still load: not once the server is known to lack the function or the account may not read it (also after a remount: the module remembers the absent answer, the new state has none yet)
    if (more || !((gs && (gs.absent || gs.denied)) || (!gs && gggAbsent && !S.gggProbe && !S.demo))) out += '<details class="N_ggmore" data-n-fold="gg"' + (S.ggOpen ? ' open' : '') + '><summary class="N_ggsum">More: guests, sections, taps, searches</summary>' + gggHtml() + more + '</details>';
    return out + '</section>';
  }

  // ---- sheets ----
  function field(id, label, control, err, mark) { return '<div class="N_field"><label class="N_lbl" for="' + id + '">' + esc(label) + (mark ? ' <span class="N_mark">check this</span>' : '') + '</label>' + control + (err ? '<p class="N_ferr" id="' + id + '-e" role="alert"><span aria-hidden="true">✕</span> ' + esc(err) + '</p>' : '') + '</div>'; }
  function inp(id, f, val, extra) { return '<input class="N_input" id="' + id + '" data-f="' + f + '" value="' + esc(val) + '" autocomplete="off" ' + (extra || '') + '>'; }
  var DEMO_RECEIPT = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420"><rect width="300" height="420" fill="#f4f1ea"/><text x="150" y="60" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#333">Sample receipt</text><text x="150" y="120" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#555">GCash transfer</text><text x="150" y="200" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#222">PHP 2,500.00</text><text x="150" y="260" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#777">Ref 1234 5678 9012</text><text x="150" y="380" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#999">Sample only</text></svg>');
  function sheetShell(title, body, bar, close) {
    return '<div class="N_scrim" aria-hidden="true"></div><div class="N_sheet" role="dialog" aria-modal="true" aria-labelledby="N_sh"><div class="N_grab" aria-hidden="true"></div><div class="N_hd"><h2 class="N_h" id="N_sh" tabindex="-1" data-n-focus="1">' + esc(title) + '</h2>' +
      (close ? '<button class="btn btn-ghost btn-sm N_closeb" type="button" data-n="' + close.act + '">' + esc(close.label) + '</button>' : '') + '</div><div class="N_shb">' + body + '</div>' + (bar || '') + '</div>';
  }
  // The sticky bar: an optional line, then the secondary button first and the primary last (the primary moves first on a very narrow bar).
  function actBar(sub, secLabel, secAct, priLabel, priAct, busy, danger) {
    return '<div class="N_act">' + (sub ? '<p class="N_sub">' + esc(sub) + '</p>' : '') + '<div class="N_act2"><button class="btn btn-secondary btn-block" type="button" data-n="' + secAct + '"' + (busy ? ' disabled' : '') + '>' + esc(secLabel) + '</button>' +
      (priLabel ? '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' btn-block" type="button" data-n="' + priAct + '"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + esc(busy ? 'Sending…' : priLabel) + '</button>' : '') + '</div></div>';
  }
  function receiptBox(p) {
    var e = (S.photos && S.photos[p.id]) || {}, dash = '<a class="N_link" href="#door/dashboard/bookings/inquiries" data-n="go" data-v="bookings/inquiries">Open the request in the dashboard</a>';
    if (e.state === 'ok') return '<button class="N_rcpt" type="button" data-n="photo-zoom" aria-label="View the receipt full size"><img class="N_photo" src="' + esc(e.url) + '" alt="Receipt photo sent by the guest" referrerpolicy="no-referrer"><span class="N_rcz">View full size</span></button>';
    if (e.state === 'err') return '<div class="N_rcpt N_msgbox"><p class="N_p">The receipt photo could not be opened.</p><button class="btn btn-secondary btn-sm" type="button" data-n="photo-retry">Try again</button></div>';
    if (e.state === 'none') return '<div class="N_rcpt N_msgbox"><p class="N_p">The receipt photo cannot be shown on this device.</p>' + dash + '</div>';
    return '<div class="N_rcpt N_msgbox" role="status">Opening the receipt photo…</div>';
  }
  function payOf(id) { var rows = (S.d.inq && S.d.inq.data) || []; for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
  function sheetErr(sh) { return sh.msg ? '<div class="N_err" role="alert"><span>' + esc(sh.msg) + '</span></div>' : ''; }
  function stayLine(p) { return (p.guest_name || 'A guest') + ', ' + fmtDate(p.checkin_date, 'long') + ' to ' + fmtDate(p.checkout_date, 'long'); }
  function btns(primaryLabel, primaryAct, secondLabel, secondAct, busy, danger) {
    return '<div class="N_btns"><button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' btn-block" type="button" data-n="' + primaryAct + '"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + esc(busy ? 'Sending…' : primaryLabel) + '</button>' +
      '<button class="btn btn-secondary btn-block" type="button" data-n="' + secondAct + '"' + (busy ? ' disabled' : '') + '>' + esc(secondLabel) + '</button></div>';
  }

  function catSelect(id, val) {
    return '<select class="N_select N_full" id="' + id + '" data-f="category"><option value=""' + (val ? '' : ' selected') + '>Choose a category</option>' + catList().map(function (c) { return '<option value="' + esc(c.slug) + '"' + (val === c.slug ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>';
  }
  function sheetHtml() {
    var sh = S.sheet; if (!sh) return '';
    if (sh.kind === 'inq') {
      var p = payOf(sh.id); if (!p) return '';
      var absentActs = S.d.confirm && S.d.confirm.absent, cmp = receiptCmp(p), now = clock(), nights = p.checkin_date && p.checkout_date ? nightsBetween(p.checkin_date, p.checkout_date) : null;
      if (sh.zoom) {
        var zi = (S.photos && S.photos[p.id]) || {};
        return sheetShell('Receipt', '<div class="N_zoom' + (sh.z200 ? ' N_z2' : '') + '">' + (zi.state === 'ok' ? '<button class="N_zbtn" type="button" data-n="photo-fit" aria-pressed="' + (!!sh.z200) + '" aria-label="Receipt photo, ' + (sh.z200 ? 'now at 200 percent. Switch to fit width' : 'fit to width. Switch to 200 percent') + '"><img class="N_photo" src="' + esc(zi.url) + '" alt="" referrerpolicy="no-referrer"></button>' : '<p class="N_p N_pad" role="status">Opening the receipt photo…</p>') + '</div>' + sheetErr(sh),
          actBar('', 'Back to the request', 'photo-unzoom'), { label: 'Back to the request', act: 'photo-unzoom' });
      }
      var body = '<p class="N_sub">' + esc(fmtDate(p.checkin_date, 'weekday') + ' to ' + fmtDate(p.checkout_date, 'weekday') + (nights !== null ? ' · ' + count(nights, 'night', 'nights') : '') + (p.pax == null ? '' : ' · ' + count(p.pax, 'guest', 'guests'))) + '</p>';
      if (p.receipt_image_path) body += receiptBox(p);
      if (cmp) {
        body += '<p>' + (cmp.kind === 'ok' ? pill('ok', 'Amounts match') : cmp.kind === 'short' || cmp.kind === 'over' ? pill('warn', 'Receipt is ' + cents(cmp.diff) + (cmp.kind === 'short' ? ' short' : ' over')) : '<span class="N_chipd">Amount not read. Check the photo.</span>') + '</p>';
      } else if (p.receipt_image_path) body += '<p class="N_info">The amount could not be read from the receipt. Check the photo.</p>';
      else body += '<p class="N_info">' + esc(!p.hold_expires_at ? 'No receipt yet.' : holdEnded(p.hold_expires_at, now) ? 'No receipt yet. The hold ended ' + fmtHoldAt(p.hold_expires_at) + '.' : 'No receipt yet. The dates are held until ' + fmtHoldAt(p.hold_expires_at) + '.') + '</p>';
      body += '<dl class="N_dl"><dt>To receive</dt><dd class="N_num N_nw">' + esc(formatPHP(p.expected_amount)) + '</dd>' + (cmp && cmp.kind !== 'unread' ? '<dt>Receipt shows</dt><dd class="N_num N_nw">' + esc(cents(cmp.amt)) + '</dd>' : '') +
        (cmp && p.reference ? '<dt>Reference</dt><dd class="N_num">' + esc(groupRef(p.reference)) + '</dd>' : '') + (cmp && p.receipt_at ? '<dt>Receipt sent</dt><dd>' + esc(agoWords(p.receipt_at, now)) + '</dd>' : '') +
        (cmp && p.hold_expires_at ? '<dt>Dates held until</dt><dd>' + esc((holdEnded(p.hold_expires_at, now) ? 'Hold ended ' : '') + fmtHoldAt(p.hold_expires_at)) + '</dd>' : '') + '<dt>Booking</dt><dd>' + esc(p.booking_ref || '—') + '</dd></dl>' + sheetErr(sh);
      var bar = absentActs ? '<div class="N_act"><div class="N_note">Deciding on a request is not available in this version of the app yet.</div></div>'
        : actBar(cmp ? 'Confirm sends the guest their stay details. Decline releases the dates and tells the guest.' : 'Paid another way? Confirm records the payment and tells the guest.', 'Decline', 'dc-start', 'Confirm booking', 'cf-start');
      return sheetShell(p.guest_name || 'Request', body, bar, { label: 'Close', act: 'sheet-close' });
    }
    if (sh.kind === 'confirm') {
      var pc = payOf(sh.id); if (!pc) return ''; var f = sh.f, e = sh.errs || {}, rc = hasReceipt(pc), b = '', cc = receiptCmp(pc), ch = pc.contact_channel;
      if (sh.step === 'form') {
        b += '<p class="N_sub">' + esc((pc.guest_name || 'A guest') + ', ' + fmtDay(pc.checkin_date) + ' to ' + fmtDay(pc.checkout_date) + '. Dates are rechecked when you confirm.') + '</p>';
        if (cc) {
          if (cc.kind === 'unread') b += '<p class="N_info">The amount could not be read from the receipt. Check the photo and type it.</p>';
          else b += '<div class="N_info"><dl class="N_dl"><dt>Receipt shows</dt><dd class="N_num N_nw">' + esc(cents(cc.amt)) + '</dd>' + (pc.reference ? '<dt>Reference</dt><dd class="N_num">' + esc(groupRef(pc.reference)) + '</dd>' : '') + '</dl></div>';
          if (cc.kind === 'short' || cc.kind === 'over') b += '<p class="N_warnb"><span aria-hidden="true">!</span> ' + esc('The receipt shows ' + cents(cc.amt) + '. That is ' + cents(cc.diff) + (cc.kind === 'short' ? ' less than' : ' more than') + ' the ' + formatPHP(pc.expected_amount) + ' to receive.') + '</p>';
        } else if (rc) b += '<p class="N_info">' + esc(paymentLine(pc)) + '</p>';
        if (!rc) b += '<fieldset class="N_fs"><legend class="N_lbl">How was it paid?</legend>' + METHODS.map(function (m) { return '<label class="N_chk"><input type="radio" name="N_method" data-f="method" value="' + m[0] + '"' + (f.method === m[0] ? ' checked' : '') + '> <span>' + esc(m[1]) + '</span></label>'; }).join('') + '</fieldset>';
        var amtF = field('N_amt', 'Amount received (PHP)', inp('N_amt', 'amount', f.amount, 'inputmode="decimal"' + (e.amount ? ' aria-invalid="true" aria-describedby="N_amt-e"' : '')), e.amount, cc && cc.kind === 'unread');
        var refF = (rc ? !pc.reference : f.method !== 'cash') ? field('N_ref', 'Payment reference', inp('N_ref', 'reference', f.reference, e.reference ? 'aria-invalid="true" aria-describedby="N_ref-e"' : ''), e.reference) : '';
        b += rc ? amtF + refF : refF + amtF; // receipt path: amount first; paid another way keeps method, reference, amount, note
        if (!rc) b += field('N_note', f.method === 'cash' ? 'Note (needed for cash)' : 'Note (optional)', '<textarea class="N_input N_ta" id="N_note" data-f="note" rows="2">' + esc(f.note) + '</textarea>', e.note);
        if (rc) b += '<div class="N_field"><label class="N_chk"><input type="checkbox" data-f="checked"' + (f.checked ? ' checked' : '') + '> <span>I saw this payment in our GCash or bank account</span></label>' + (e.checked ? '<p class="N_ferr" role="alert"><span aria-hidden="true">✕</span> ' + esc(e.checked) + '</p>' : '') + '</div>';
        b += sheetErr(sh);
        return sheetShell('Confirm booking', b, actBar('', 'Back', 'sheet-back', 'Review', 'cf-review'));
      }
      var amt = parseAmount(f.amount), mth = rc ? 'GCash via Messenger (receipt on file)' : methodLabel(f.method), ref = (rc && pc.reference ? pc.reference : f.reference || '').trim(), exp = pc.expected_amount === null ? null : toCentavos(pc.expected_amount), got = amt === null ? null : toCentavos(amt);
      var diff = exp !== null && got !== null && exp !== got ? got - exp : 0;
      b += '<p class="N_sub">Check these before you confirm. This cannot be undone here.</p><dl class="N_dl"><dt>Guest</dt><dd>' + esc(pc.guest_name || 'A guest') + '</dd><dt>Dates</dt><dd>' + esc(fmtDay(pc.checkin_date) + ' to ' + fmtDay(pc.checkout_date)) + '</dd>' +
        '<dt>Amount received</dt><dd class="N_num N_nw">' + esc(formatPHP(amt)) + '</dd>' + (diff ? '<dt>Difference</dt><dd>' + pill('warn', cents(Math.abs(diff)) + (diff < 0 ? ' short' : ' over')) + '</dd>' : '') + '<dt>Paid by</dt><dd>' + esc(mth) + '</dd>' + (ref ? '<dt>Reference</dt><dd class="N_num">' + esc(groupRef(ref)) + '</dd>' : '') + (String(f.note || '').trim() ? '<dt>Note</dt><dd>' + esc(f.note.trim()) + '</dd>' : '') + '</dl>' +
        '<p class="N_info">' + esc(ch === 'email' ? 'The guest will be told by e-mail: the address, parking, the ID request and how to pay the balance.' : ch === 'messenger' ? 'The guest will be told on Messenger: the address, parking, the ID request and how to pay the balance.' : ch === 'none' ? 'No e-mail or Messenger is on file for this guest. Nothing is sent. Message them yourself after you confirm.' : 'The guest is messaged when you confirm.') + '</p>' + sheetErr(sh);
      return sheetShell('Confirm booking', b, actBar('', 'Back', 'cf-edit', 'Confirm booking', 'cf-send', sh.busy));
    }
    if (sh.kind === 'decline') {
      var pd = payOf(sh.id); if (!pd) return ''; var db = '', rs = pd.receipt_sent === true, dch = pd.contact_channel, dcode = reasonCode(sh.chip);
      if (sh.step === 'form') {
        db += '<p class="N_sub">' + esc((pd.guest_name || 'A guest') + ', ' + fmtDay(pd.checkin_date) + ' to ' + fmtDay(pd.checkout_date) + '.') + '</p>';
        if (rs) db += '<p class="N_warnb"><span aria-hidden="true">!</span> A receipt was sent for this request. If the money did arrive, please send it back to the guest. The app does not refund.</p>';
        db += '<div class="N_field"><span class="N_lbl" id="N_why">Why?</span><div class="N_chips" role="group" aria-labelledby="N_why">' +
          DECLINE_CHIPS.map(function (r) { return '<button class="N_chip" type="button" data-n="dc-chip" data-v="' + esc(r[0]) + '" aria-pressed="' + (sh.chip === r[0]) + '">' + esc(chipLabel(r[0], rs)) + '</button>'; }).join('') + '</div></div>' +
          field('N_dtxt', 'Note for our records (optional)', '<textarea class="N_input N_ta" id="N_dtxt" data-f="text" rows="2" aria-describedby="N_dtxt-h">' + esc(sh.text) + '</textarea><p class="N_help" id="N_dtxt-h">The guest never sees this note.</p>') + sheetErr(sh);
        return sheetShell('Decline request', db, actBar('', 'Back', 'sheet-back', 'Review', 'dc-review'));
      }
      var told = declineTold(dch, dcode);
      db += '<p class="N_sub">Check this before you decline. The dates are released and the income row is voided. This cannot be undone here.</p><dl class="N_dl"><dt>Guest</dt><dd>' + esc(pd.guest_name || 'A guest') + '</dd><dt>Dates</dt><dd>' + esc(fmtDay(pd.checkin_date) + ' to ' + fmtDay(pd.checkout_date)) + '</dd><dt>Reason</dt><dd>' + esc(declineReason(sh.chip, sh.text, rs) || '') + '</dd></dl>' +
        '<p class="N_info">' + esc(told === 'duplicate' ? 'No message is sent for a duplicate request.' : told === 'email' ? 'The guest will be told by e-mail now. A copy appears in the OPS chat.' : told === 'messenger' ? 'The guest will be told on Messenger now. A copy appears in the OPS chat.' : dch === 'none' ? 'No e-mail or Messenger is on file. Nothing is sent. You can copy a message for them next.' : 'The guest is not messaged yet. You can copy a polite message for them next.') + '</p>' +
        (dcode === 'duplicate' ? '' : '<details><summary class="N_link">Read the message</summary><p class="N_info N_pl">' + esc(declineMessage(pd, dcode, rs, dch)) + '</p></details>') +
        (rs ? '<p class="N_warnb"><span aria-hidden="true">!</span> A receipt was sent. Refund the guest if the money arrived.</p>' : '') + sheetErr(sh);
      return sheetShell('Decline request', db, actBar('', 'Back', 'dc-edit', 'Decline request', 'dc-send', sh.busy, true));
    }
    if (sh.kind === 'msg') {
      return sheetShell('Message the guest', '<p class="N_sub">The request is declined. The guest has not been told yet. Copy this line, read it through, and send it in the conversation.</p>' +
        field('N_msg', 'Message for ' + (sh.guest || 'the guest'), '<textarea class="N_input N_ta" id="N_msg" data-f="text" rows="7">' + esc(sh.text) + '</textarea>') +
        (sh.copied ? '<div class="N_okbox" role="status">Copied. Paste it into the conversation.</div>' : '') + sheetErr(sh) +
        '<div class="N_btns"><button class="btn btn-primary btn-block" type="button" data-n="msg-copy">' + (sh.copied ? 'Copy again' : 'Copy message') + '</button><button class="btn btn-secondary btn-block" type="button" data-n="sheet-close">Done</button></div>');
    }
    if (sh.kind === 'review') {
      var rr = rqOf(sh.id); if (!rr) return ''; var fr = sh.f, er = sh.errs || {}, rb = '', isX = rr.txn_type === 'expense';
      if (sh.step === 'void') {
        rb += '<p class="N_sub">' + esc((rr.payee_name || rr.notes || 'This transaction') + ', ' + formatPHP(rr.gross_amount) + '. Voiding takes it out of the books. The reason is kept in the audit trail.') + '</p>' +
          field('N_rvr', 'Why is it being voided?', '<textarea class="N_input N_ta" id="N_rvr" data-f="reason" rows="3">' + esc(sh.reason) + '</textarea>', er.reason) + sheetErr(sh) + btns('Void it', 'rq-void-send', 'Back', 'sheet-back', sh.busy, true);
        return sheetShell('Void a transaction', rb);
      }
      rb += '<p class="N_sub">' + esc('Added ' + fmtDate(rr.transaction_date, 'long') + (rr.source ? ' from ' + srcWords(rr.source) : '') + '. Check it, change what is wrong, then approve or void it.') + '</p>' +
        (rqIncomplete(rr) ? '<p class="N_info E_inc N_inc" role="status">' + esc(INCOMPLETE) + '</p>' : '') + (rr.receipt_image_path ? '<p class="N_info">A receipt photo is attached.</p>' : '') + (lowConf(rr.ocr_confidence) ? '<p class="N_ferr" role="alert"><span aria-hidden="true">!</span> The receipt was hard to read. Please check every figure.</p>' : '') +
        field('N_rd', 'Date', '<input class="N_input" id="N_rd" type="date" data-f="date" value="' + esc(fr.date) + '"' + (er.date ? ' aria-invalid="true"' : '') + '>', er.date) +
        field('N_ra', 'Amount (PHP)', inp('N_ra', 'amount', fr.amount, 'inputmode="decimal"'), er.amount) +
        (isX ? field('N_rc', 'Category', catSelect('N_rc', fr.category), er.category) : '<p class="N_line">Category: ' + esc(rr.category ? catName(rr.category) : '—') + '</p>') +
        field('N_rn', 'What was it for?', inp('N_rn', 'notes', fr.notes)) + field('N_rp', 'Paid to', inp('N_rp', 'payee', fr.payee)) + field('N_ro', 'Receipt number (optional)', inp('N_ro', 'or_number', fr.or_number)) + sheetErr(sh) +
        '<div class="N_btns"><button class="btn btn-primary btn-block" type="button" data-n="rq-approve"' + (sh.busy || rqIncomplete(rr) ? ' disabled' : '') + (sh.busy ? ' aria-busy="true"' : '') + '>' + esc(sh.busy ? 'Sending…' : 'Approve') + '</button>' +
        '<button class="btn btn-secondary btn-block" type="button" data-n="rq-void-start"' + (sh.busy ? ' disabled' : '') + '>Void…</button></div><button class="btn btn-ghost btn-block" type="button" data-n="sheet-close"' + (sh.busy ? ' disabled' : '') + '>Close</button>';
      return sheetShell('Review a transaction', rb);
    }
    return '';
  }

  function tabsHtml() {
    var hide = {}; // a tab whose only data source is missing is hidden
    if (S.d.inq && S.d.inq.absent) hide.inquiries = true;
    var vis = TABS.filter(function (t) { return !hide[t] && tabOk(t); });
    return '<div class="N_seg' + (vis.length > 4 ? ' N_seg6' : '') + '" role="tablist" aria-label="Manage"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + vis.map(function (t) {
      return '<button class="N_tab" type="button" role="tab" id="N_tab_' + t + '" aria-selected="' + (S.tab === t) + '" data-n="tab" data-v="' + t + '">' + TAB_LABEL[t] + '</button>';
    }).join('') + '</div>';
  }
  function revealTab() { try { var a = S.el.querySelector('.N_seg6 [aria-selected="true"]'); if (a && a.scrollIntoView) a.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) { /* courtesy */ } }
  function extStop() { var x = S && S.ext; if (!S) return; S.ext = null; if (x && x.obs) { try { x.obs.disconnect(); } catch (e) { /* ok */ } } if (x && x.mod && typeof x.mod.unmount === 'function') { try { x.mod.unmount(); } catch (e) { /* never block */ } } }
  // Bookings and Ops are other lanes' modules. They draw into their own box, so a late reload of another tab must not wipe them.
  function drawExt(mod) {
    if (S.ext && S.ext.tab === S.tab && S.el.querySelector && S.el.querySelector('[data-n-ext]')) return;
    extStop();
    S.el.innerHTML = '<div class="N_root">' + tabsHtml() + '<div class="N_body" role="tabpanel" aria-labelledby="N_tab_' + S.tab + '"><div id="N_ext" data-n-ext="' + S.tab + '"></div></div></div>';
    revealTab(); var host = S.el.querySelector ? S.el.querySelector('[data-n-ext]') : null; S.ext = { tab: S.tab, mod: mod }; if (!host) return;
    if (typeof MutationObserver !== 'undefined') { // the tab strip is inert while the module has a sheet open
      var seg = S.el.querySelector('.N_seg'), watch = function () {
        var open = !!host.querySelector('[role="dialog"], .O_sheet, .B_sheet'); if (!seg) return;
        if (open) { seg.setAttribute('inert', ''); seg.setAttribute('aria-hidden', 'true'); } else { seg.removeAttribute('inert'); seg.removeAttribute('aria-hidden'); }
      };
      try { S.ext.obs = new MutationObserver(watch); S.ext.obs.observe(host, { childList: true, subtree: true }); } catch (e) { /* ok */ }
    }
    try { mod.mount(host, { client: S.client, demo: S.demo, role: S.role, access: { role: S.role, property_ids: [pid()] }, propertyId: pid(), sub: null, embedded: true, navigate: S.opts.navigate, toast: S.opts.toast, haptic: S.opts.haptic }); }
    catch (e) { host.innerHTML = '<div class="N_note">This part could not open just now. Try again in a moment.</div>'; }
  }
  function draw() {
    if (!S) return;
    if (EXT[S.tab] && extMod(S.tab)) { drawExt(extMod(S.tab)); return; }
    extStop();
    var sg = S.sheet; if (sg && sg.id && !sg.busy && (sg.kind === 'inq' || sg.kind === 'confirm' || sg.kind === 'decline') && S.d.inq && S.d.inq.ok === true && !payOf(sg.id)) { S.sheet = null; S.notice = 'This booking is no longer waiting for a decision. Nothing was changed.'; } // never leave the page inert with no sheet
    var keepSum = false; try { var ae = typeof document !== 'undefined' ? document.activeElement : null; keepSum = !!(ae && ae.classList && ae.classList.contains('N_ggsum') && S.el.contains && S.el.contains(ae)); } catch (e) { /* no focus in tests */ } // the swap below replaces the summary the person is on
    var body = S.tab === 'inquiries' ? viewInquiries() : S.tab === 'money' ? viewMoney() : S.tab === 'kpis' ? viewKpis() : viewToday();
    var live = S.notice ? '<div class="N_okbox" role="status">' + esc(S.notice) + '</div>' : '';
    S.el.innerHTML = '<div class="N_root">' + tabsHtml() + live + '<div class="N_body" role="tabpanel" aria-labelledby="N_tab_' + S.tab + '"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + body + '</div></div>' + sheetHtml();
    revealTab();
    if (keepSum && !S.ggRefocus) S.ggRefocus = 'sum';
    if (S.ggRefocus) { var rk = S.ggRefocus; S.ggRefocus = ''; try { var rf0 = S.el.querySelector(rk === 'sum' ? '.N_ggsum' : '#N_ggg'); if (rf0 && rf0.focus) rf0.focus(); } catch (e) { /* no focus in tests */ } } // the redraw replaced the control the person used: focus goes back to the fold, or to the list heading after Show all
    if (!S.sheet && S.pend) { var pk = Object.keys(S.pend); S.pend = null; pk.forEach(function (k) { load(k, true); }); } // a refresh skipped under a sheet is read once it closes
    if (S.sheet && S.sheet.refocus) { var rf = S.sheet.refocus; S.sheet.refocus = null; try { var rb = S.el.querySelector('[data-n="' + rf + '"]'); if (rb && rb.focus) rb.focus(); } catch (e) { /* no focus in tests */ } return; }
    if (S.sheet && S.sheet.focus !== false) { try { var h = S.el.querySelector('[data-n-focus]'); if (h && h.focus) h.focus(); } catch (e) { /* no focus in tests */ } S.sheet.focus = false; }
  }

  // ------------------------------------------------------------------------------------------------ actions
  function buzz(kind) { try { if (S.opts.haptic) S.opts.haptic(kind); } catch (e) { /* optional */ } }
  function tell(msg) { try { if (S.opts.toast) S.opts.toast(msg); } catch (e) { /* optional */ } }
  function refreshAfterWrite() { ['overview', 'inq', 'waiting', 'txns', 'kpi', 'rq'].forEach(function (k) { if (S.d[k]) S.d[k].ok = false; }); loadTab(S.tab, true); }

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
        else if (sheetObj.kind === 'review' && (String(errCode(res.error)) === '22023' || String(errCode(res.error)) === 'P0002')) { sheetObj.msg = reviewWords(errMsg(res.error)); if (sheetObj.msg === 'This was already done.') refreshAfterWrite(); }
        else sheetObj.msg = plainError(res.error, true);
        draw(); return;
      }
      onData(res.data, sheetObj);
    };
    if (S.demo) { Promise.resolve().then(function () { settle({ data: onDemo(name), error: null }); }); return; }
    callRpc(name, args).then(settle);
  }
  function onDemo(name) { return name === 'staff_decline_direct_booking_v1' ? { ok: true, outcome: 'declined' } : name === 'staff_confirm_direct_booking_v1' ? { ok: true, outcome: 'confirmed' } : { ok: true }; }

  // One entry per booking for the session: S.photos[id] = { state, url, at }. A signed link lives 300 s, so an entry under 240 s old is reused and an older one is signed again.
  var PHOTO_FRESH = 240000;
  function ensurePhoto(id, path, force) {
    if (!S.photos) S.photos = {};
    if (S.demo) { S.photos[id] = { state: 'ok', url: DEMO_RECEIPT, at: clock() }; return; }
    if (!S.client || !S.client.storage) { S.photos[id] = { state: 'none' }; return; }
    var cur = S.photos[id]; if (!force && cur && cur.state === 'ok' && clock() - cur.at < PHOTO_FRESH) return;
    var mine = S.photos[id] = { state: 'loading' }, gen = S.gen, done = function (e) { if (!S || S.gen !== gen || S.photos[id] !== mine) return; S.photos[id] = e; draw(); }, fail = function () { done({ state: 'err' }); };
    try { Promise.resolve(S.client.storage.from('booking-receipts').createSignedUrl(path, 300)).then(function (r) { if (r && r.data && r.data.signedUrl) done({ state: 'ok', url: r.data.signedUrl, at: clock() }); else fail(); }, fail); } catch (e) { fail(); }
  }
  function openInq(id) { var p = payOf(id); S.sheet = { kind: 'inq', id: id, msg: '', focus: true }; if (p && p.receipt_image_path) ensurePhoto(id, p.receipt_image_path); draw(); }
  function openReview(id) {
    var r = rqOf(id); if (!r) return; var c = toCentavos(r.gross_amount);
    S.sheet = { kind: 'review', id: id, step: 'form', busy: false, msg: '', errs: {}, reason: '', focus: true,
      f: { date: r.transaction_date || '', amount: c !== null && c > 0 ? fromCentavos(c) : '', category: r.txn_type === 'expense' ? (catOk(r.category) ? r.category : '') : (r.category || ''), payee: r.payee_name || '', notes: r.notes || '', or_number: r.or_number || '' } };
    draw(); if (!S.d.cats) load('cats', false);
  }
  function validateReview(f, r) {
    var e = {}; if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.date = 'Choose the date.';
    if (parseAmount(f.amount) === null) e.amount = 'Enter the amount, more than zero, with at most two decimal places.';
    if (r.txn_type === 'expense' && !catOk(f.category)) e.category = 'Choose a category.';
    return e;
  }
  // Only what the person changed goes to the server (the server wants a reason for any edit). Amounts compare in centavos, text trimmed, null equals empty.
  function changedEdits(f, r) {
    var e = {}, t = function (v) { return String(v == null ? '' : v).trim(); };
    if (f.date !== r.transaction_date) e.transaction_date = f.date;
    if (parseAmount(f.amount) !== null && toCentavos(parseAmount(f.amount)) !== toCentavos(r.gross_amount)) e.gross_amount = parseAmount(f.amount);
    if (t(f.payee) !== t(r.payee_name)) e.payee_name = t(f.payee);
    if (t(f.notes) !== t(r.notes)) e.notes = t(f.notes);
    if (t(f.or_number) !== t(r.or_number)) e.or_number = t(f.or_number);
    if (r.txn_type === 'expense' && f.category !== t(r.category)) e.category = f.category;
    return e;
  }
  // The server's refusals for a review, in plain sentences
  function reviewWords(msg) {
    msg = String(msg || '');
    return /not waiting for review|not pending|already/i.test(msg) ? 'This was already done.' : /reason/i.test(msg) ? 'Write a short reason, at least three letters.' : /amount/i.test(msg) ? 'Enter the amount, more than zero.' : /future/i.test(msg) ? 'The date cannot be in the future.' : /date/i.test(msg) ? 'Choose the date.' : /categor/i.test(msg) ? 'Choose a category.' : 'The server could not accept this. Please check it and try again.';
  }
  function doReview(action) {
    var sh = S.sheet, r = rqOf(sh.id); if (!r) return; var f = sh.f, edits = {};
    if (action === 'approve' && rqIncomplete(r)) { sh.msg = INCOMPLETE; draw(); return; }
    if (action === 'approve') {
      sh.errs = validateReview(f, r); if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the items marked below.'; draw(); return; }
      edits = changedEdits(f, r);
    } else if (String(sh.reason || '').trim().length < 3) { sh.errs = { reason: 'Write a short reason, at least three letters.' }; sh.msg = 'Please fix the items marked below.'; draw(); return; }
    sendWrite('review', 'admin_review_transaction_v1', { p_property_id: pid(), p_id: sh.id, p_action: action, p_edits: edits, p_reason: action === 'void' ? sh.reason.trim() : Object.keys(edits).length ? 'Edited in Manage before approving' : null }, function (res, s2) {
      if (res && res.ok === true) { // the list changes only now that the server has said yes
        var q = S.d.rq && S.d.rq.data; if (q && Array.isArray(q.rows)) { q.rows = q.rows.filter(function (x) { return x.id !== sh.id; }); if (typeof q.count === 'number') q.count = Math.max(0, q.count - 1); }
        if (S.demo) S.demoData.rqRows = S.demoData.rqRows.filter(function (x) { return x.id !== sh.id; });
        var m = action === 'approve' ? 'Approved: ' + formatPHP('gross_amount' in edits ? edits.gross_amount : r.gross_amount) + (('category' in edits ? edits.category : r.category) ? ', ' + catName('category' in edits ? edits.category : r.category) : '') + '.' : 'Voided: ' + formatPHP(r.gross_amount) + '.';
        buzz('success'); tell(m); S.notice = m; S.sheet = null; refreshAfterWrite(); draw(); return;
      }
      if (res && (res.error || res.reason) === 'amount_incomplete') { var cur = rqOf(sh.id); if (cur) cur.s134_incomplete = true; } // the server knows better than the list: show the cue, disable Approve
      s2.msg = refusalWords(res) || 'Nothing was changed. Please check it and try again.'; draw();
    });
  }

  function copyText(text) {
    try { var cb = typeof navigator !== 'undefined' && navigator.clipboard; if (cb && typeof cb.writeText === 'function') return Promise.resolve(cb.writeText(text)).then(function () { return true; }, function () { return false; }); } catch (e) { /* fall through */ }
    return Promise.resolve(false);
  }
  function startConfirm() {
    var p = payOf(S.sheet.id), rc = hasReceipt(p);
    S.sheet = { kind: 'confirm', id: p.id, step: 'form', key: mintKey('confirm'), busy: false, msg: '', errs: {}, focus: true,
      f: { checked: false, method: 'messenger_gcash', reference: '', amount: rc || receiptCmp(p) ? (receiptCmp(p) && receiptCmp(p).kind !== 'unread' ? fromCentavos(receiptCmp(p).amt) : '') : (p.expected_amount ? fromCentavos(toCentavos(p.expected_amount)) : ''), note: '' } }; // the receipt path never pre-fills the expected amount
    draw();
  }
  function fill(res, p) { var o = {}; for (var k in res) o[k] = res[k]; if (p) { if (!o.guest_name) o.guest_name = p.guest_name; if (!o.checkin) o.checkin = p.checkin_date; if (!o.checkout) o.checkout = p.checkout_date; } return o; }
  function doConfirmSend() {
    var sh = S.sheet, p = payOf(sh.id); if (sh.step !== 'review') return; // a write only ever follows the review step
    sendWrite('confirm', 'staff_confirm_direct_booking_v1', confirmArgs(sh.id, sh.f, p, sh.key), function (res, s2) {
      res = res || {};
      if (res.ok === true && res.outcome === 'confirmed') { var cs = confirmSentence(fill(res, p), p && p.contact_channel); buzz('success'); tell(cs); S.notice = cs; S.sheet = null; if (S.demo) demoRemove(sh.id); refreshAfterWrite(); draw(); return; }
      s2.msg = confirmSentence(res, p && p.contact_channel); s2.key = mintKey('confirm'); // a readable answer: the next try is a new decision
      if (res.outcome === 'conflict' || res.outcome === 'invalid_state') refreshAfterWrite();
      s2.step = 'form'; draw();
    });
  }
  function doDeclineSend() {
    var sh = S.sheet, p0 = payOf(sh.id); if (sh.step !== 'review') return;
    var rs = !!p0 && p0.receipt_sent === true, code = reasonCode(sh.chip), ch = p0 ? p0.contact_channel : null, args = { p_booking_id: sh.id, p_reason: declineReason(sh.chip, sh.text, rs) || '', p_idempotency_key: sh.key };
    if (p0 && !legacyRow(p0)) args.p_reason_code = code; // an old server has only the three-argument form
    sendWrite('decline', 'staff_decline_direct_booking_v1', args, function (res, s2) {
      res = res || {};
      if (res.ok === true) {
        var told = declineTold(ch, code), ds = declineSentence(res, told, p0 && p0.guest_name); buzz('success'); tell(ds); S.notice = ds;
        S.sheet = told ? null : { kind: 'msg', guest: p0 && p0.guest_name, text: declineMessage(p0, code, rs, ch), copied: false, msg: '', focus: true };
        if (S.demo) demoRemove(sh.id); refreshAfterWrite(); draw(); return;
      }
      s2.msg = declineSentence(res, null, p0 && p0.guest_name); s2.key = mintKey('decline'); s2.step = 'form'; draw();
    });
  }
  function demoRemove(id) { S.demoData.inquiries = S.demoData.inquiries.filter(function (r) { return r.id !== id; }); }

  function onToggle(ev) { // <details> toggle does not bubble: listened to in the capture phase. Only a real change of state counts (a redraw re-opens the fold without a person).
    if (!S || !ev || !ev.target || !ev.target.getAttribute || ev.target.getAttribute('data-n-fold') !== 'gg') return;
    var open = !!ev.target.open; if (open === !!S.ggOpen) return;
    S.ggOpen = open; if (!open) return;
    var st = S.d.ggg; if (st && (st.absent || st.denied)) return;
    S.ggRefocus = 'sum'; load('ggg', false);
    S.ggRefocus = ''; // set only so the draw inside load() puts focus back on the summary; a cached open or a remembered absent answer draws nothing and must not leave it set for a later, unrelated draw
  }
  function onClick(ev) {
    if (!S) return; if (ev.target && ev.target.closest && ev.target.closest('[data-n-ext]')) return; // clicks inside Bookings or Ops belong to them
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-n]') : null; if (!t) return;
    var a = t.getAttribute('data-n'), v = t.getAttribute('data-v'), sh = S.sheet;
    if (t.disabled || t.getAttribute('aria-busy') === 'true') return;
    if (sh && sh.busy && (a === 'go' || a === 'tab' || a === 'refresh' || a === 'retry')) return; // a request is in flight: nothing may orphan its sheet
    if (a === 'go') { if (ev.preventDefault) ev.preventDefault(); S.sheet = null; S.opts.navigate('#door/dashboard/' + v); return; }
    if (a === 'tab') { setTab(v, true); return; }
    if (a === 'retry') { S.ggProbe = true; loadTab(['today', 'inquiries', 'money', 'kpis'].indexOf(v) >= 0 ? v : S.tab, true); return; }
    if (a === 'ggg-retry') { S.gggProbe = true; load('ggg', true); return; }
    if (a === 'ggg-open') { var gm = S.d.ggg && S.d.ggg.ok ? gggModel(S.d.ggg.data) : null, gr = gm ? gm.guests[+v] : null; if (gr && gr.messaged && UUID_RE.test(gr.id) && S.opts.navigate) { if (ev.preventDefault) ev.preventDefault(); S.sheet = null; S.opts.navigate('#inbox/guide:' + gr.id.toLowerCase()); } return; }
    if (a === 'ggg-all') { S.gggAll = true; S.ggRefocus = 'list'; draw(); return; }
    if (a === 'refresh') { S.notice = ''; S.ggProbe = true; S.gggProbe = true; loadTab(S.tab, true); return; }
    S.notice = '';
    if (a === 'mon') { S.monSel = +v; draw(); return; }
    if (a === 'tbl') { S.showTable = !S.showTable; draw(); return; }
    if (a === 'inq-open') return openInq(v);
    if (a === 'rq-open') return openReview(v);
    if (a === 'needs-sent') { setTab('inquiries', true); if (v && payOf(v)) openInq(v); return; }
    if (a === 'needs-more') { S.needsOpen = true; draw(); return; }
    if (a === 'nav') { if (ev.preventDefault) ev.preventDefault(); S.sheet = null; S.opts.navigate(v); return; }
    if (!sh) return;
    if (a === 'sheet-close') { if (sh.busy) return; S.sheet = null; draw(); return; }
    if (a === 'sheet-back') { if (sh.busy) return; if (sh.kind === 'review' && sh.step === 'void') { sh.step = 'form'; sh.msg = ''; sh.errs = {}; sh.focus = true; draw(); return; } if (sh.kind === 'confirm' || sh.kind === 'decline') { S.sheet = { kind: 'inq', id: sh.id, msg: '', focus: true }; var pb = payOf(sh.id); if (pb && pb.receipt_image_path) ensurePhoto(sh.id, pb.receipt_image_path); } else S.sheet = null; draw(); return; }
    if (a === 'cf-start') return startConfirm();
    if (a === 'cf-review') { sh.errs = validateConfirm(sh.f, payOf(sh.id)); sh.msg = ''; if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the marked items.'; draw(); return; } sh.step = 'review'; sh.focus = true; draw(); return; }
    if (a === 'cf-edit' || a === 'dc-edit' || a === 'ex-edit') { if (sh.busy) return; sh.step = 'form'; sh.msg = ''; sh.focus = true; draw(); return; }
    if (a === 'cf-send') return doConfirmSend();
    if (a === 'dc-start') { S.sheet = { kind: 'decline', id: sh.id, step: 'form', key: mintKey('decline'), busy: false, msg: '', chip: null, text: '', focus: true }; draw(); return; }
    if (a === 'dc-chip') { sh.chip = sh.chip === v ? null : v; sh.msg = ''; draw(); return; }
    if (a === 'dc-review') { var pr = payOf(sh.id); if (!declineReason(sh.chip, sh.text, !!pr && pr.receipt_sent === true)) { sh.msg = 'Choose or write a reason first.'; draw(); return; } sh.step = 'review'; sh.msg = ''; sh.focus = true; draw(); return; }
    if (a === 'dc-send') return doDeclineSend();
    if (a === 'photo-retry') { var pq = payOf(sh.id); if (pq && pq.receipt_image_path) { ensurePhoto(sh.id, pq.receipt_image_path, true); draw(); } return; }
    if (a === 'photo-zoom') { var pz = payOf(sh.id), ez = S.photos[sh.id]; sh.zoom = true; sh.z200 = false; if (pz && pz.receipt_image_path && (!ez || ez.state !== 'ok' || clock() - ez.at >= PHOTO_FRESH)) ensurePhoto(sh.id, pz.receipt_image_path, true); sh.focus = true; draw(); return; }
    if (a === 'photo-unzoom') { sh.zoom = false; sh.focus = true; draw(); return; }
    if (a === 'photo-fit') { sh.z200 = !sh.z200; sh.refocus = 'photo-fit'; draw(); return; }
    if (a === 'rq-approve') return doReview('approve');
    if (a === 'rq-void-start') { sh.step = 'void'; sh.msg = ''; sh.errs = {}; sh.focus = true; draw(); return; }
    if (a === 'rq-void-send') return doReview('void');
    if (a === 'msg-copy') { copyText(sh.text).then(function (ok) { if (!S || S.sheet !== sh) return; sh.copied = ok; sh.msg = ok ? '' : 'This phone would not copy it. Press and hold the text above, then choose Copy.'; draw(); }); return; }
  }
  // an image that will not load (an expired link, a bad file): the photo box shows the failed state with its retry button
  function onImgError(ev) {
    var t = ev && ev.target; if (!S || !t || !t.classList || !t.classList.contains('N_photo') || !S.sheet || S.sheet.kind !== 'inq') return;
    var e = S.photos && S.photos[S.sheet.id]; if (e && e.state === 'ok' && e.url !== DEMO_RECEIPT) { S.photos[S.sheet.id] = { state: 'err' }; draw(); }
  }
  function onInput(ev) {
    if (!S) return; var t = ev.target; if (!t || !t.getAttribute) return; var f = t.getAttribute('data-f'); if (!f) return;
    if (f === 'period') { var v = t.value; if (!PRESETS.some(function (p) { return p[0] === v; })) return; S.period = v; ls('set', 'cs_n_period', v); S.d.kpi = {}; draw(); load('kpi', true); return; }
    if (t.closest && t.closest('[data-n-ext]')) return;
    var sh = S.sheet; if (!sh) return;
    var val = t.type === 'checkbox' ? !!t.checked : t.value;
    if ((sh.kind === 'decline' || sh.kind === 'msg') && f === 'text') { sh.text = val; return; }
    if (sh.kind === 'review' && f === 'reason') { sh.reason = val; return; }
    if (sh.checks && sh.checks[f]) delete sh.checks[f];
    if (sh.f && f in sh.f) { sh.f[f] = val; if (f === 'method') { sh.errs = {}; draw(); } }
  }

  function onVisible() {
    var doc = (typeof document !== 'undefined') ? document : null;
    if (!S || !doc || doc.visibilityState !== 'visible') return;
    if (S.sheet) return; // never under an open sheet
    var now = clock();
    // Only the inquiries list and the waiting count go stale at a minute (load() applies LIVE_MS); the overview and every other tab keep the five-minute rule (R1.8).
    if (S.tab === 'today') { load('inq'); load('waiting'); var ov = S.d.overview || {}; if (!ov.ok || now - (ov.at || 0) > 5 * 60000) load('overview', true); }
    else if (S.tab === 'inquiries') load('inq');
    else if (now - (S.loadedAt || 0) > 5 * 60000) loadTab(S.tab, true);
  }

  // ------------------------------------------------------------------------------------------------ mount / unmount
  function mount(el, opts) {
    opts = opts || {};
    if (S) unmount();
    if (!canManage(opts.role)) { if (opts.navigate) opts.navigate('#home'); return; }
    var today = manilaToday(), sub = tabOk(opts.sub) ? opts.sub : null, stored = ls('get', 'cs_n_tab'), sp = ls('get', 'cs_n_period');
    S = { el: el, opts: opts, client: opts.client, demo: !!opts.demo, role: opts.role, gen: ++N_gen, today: today, d: {}, sheet: null, notice: '', loadedAt: 0, photos: {},
      tab: sub || (tabOk(stored) ? stored : 'today'), period: PRESETS.some(function (p) { return p[0] === sp; }) ? sp : 'mtd', demoData: demoData(today) };
    if (!S.demo && !S.client) { ['overview', 'inq', 'waiting', 'txns', 'kpi'].forEach(function (k) { S.d[k] = { err: 'No connection.' }; }); }
    S.onClick = onClick; S.onInput = onInput; S.onVis = onVisible; S.onErr = onImgError;
    el.addEventListener('click', S.onClick); el.addEventListener('input', S.onInput); el.addEventListener('change', S.onInput);
    el.addEventListener('error', S.onErr, true); S.onToggle = onToggle; el.addEventListener('toggle', S.onToggle, true);
    el.addEventListener('submit', function (e) { if (e && e.preventDefault) e.preventDefault(); });
    try { if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    draw(); if (S.demo || S.client) loadTab(S.tab, true);
  }
  function unmount() {
    if (!S) return;
    try { S.el.removeEventListener && S.el.removeEventListener('toggle', S.onToggle, true); } catch (e) { /* ok */ }
    try { S.el.removeEventListener && S.el.removeEventListener('click', S.onClick); S.el.removeEventListener && S.el.removeEventListener('input', S.onInput); S.el.removeEventListener && S.el.removeEventListener('change', S.onInput); S.el.removeEventListener && S.el.removeEventListener('error', S.onErr, true); } catch (e) { /* ok */ }
    try { if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    extStop(); (S.timers || []).forEach(function (t) { clearTimeout(t); });
    N_gen++; S = null; // a late reply finds no state and is dropped
  }

  var api = {
    mount: mount, unmount: unmount,
    _setRpcTimeout: function (ms) { RPC_TIMEOUT_MS = ms; },
    _setSeriesConcurrency: function (n) { SERIES_CONCURRENCY = n; },
    // R1.8: the shell or a push may say a list changed; the next look is a fresh read, and nothing is read under an open sheet.
    refresh: function (kind) { if (!S || (S.sheet && S.sheet.busy)) return; if (kind === 'inq' || kind === 'waiting') { if (S.sheet) { (S.pend || (S.pend = {}))[kind] = true; if (S.d[kind]) S.d[kind].at = 0; } else load(kind, true); } }, // under a sheet: mark stale and read when it closes; ok is left alone so the list never shows Loading
    _resetGuideKnown: function () { ggAbsent = false; ggSeen = false; gggAbsent = false; if (S) { delete S.d.ggg; S.ggOpen = false; S.gggAll = false; } }, // the shell may call this on sign-out; a new session probes again
    _setClock: function (fn) { clock = fn || function () { return Date.now(); }; },
    lib: { lastMonths: lastMonths, buildSeries: buildSeries, chipFor: chipFor, canManage: canManage, manilaToday: manilaToday, addDays: addDays, nightsBetween: nightsBetween, fmtDate: fmtDate, fmtDateTime: fmtDateTime, toCentavos: toCentavos, fromCentavos: fromCentavos, formatPHP: formatPHP, formatPercent: formatPercent, formatNumber: formatNumber,
      formatMetricValue: formatMetricValue, parseAmount: parseAmount, periodPreset: periodPreset, comparablePeriod: comparablePeriod, compareMode: compareMode, pctDelta: pctDelta, fmtDeltaPct: fmtDeltaPct, deltaLine: deltaLine,
      normalizePayments: normalizePayments, paymentLine: paymentLine, validateConfirm: validateConfirm, confirmArgs: confirmArgs, confirmSentence: confirmSentence, declineSentence: declineSentence, declineReason: declineReason,
      guestGuide: { guests: gggModel, guestDates: gggDates, tapLabel: ggTapLabel, model: ggModel, dense: ggDense, seconds: ggSeconds, label: ggLabel, DAYS: GG_DAYS }, normalizeCats: normalizeCats, declineMessage: declineMessage, agoWords: agoWords, receiptCmp: receiptCmp, groupRef: groupRef, tone: tone, isMissing: isMissing, isDenied: isDenied, isOffline: isOffline, plainError: plainError, PRESETS: PRESETS, METHODS: METHODS, EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, refusalWords: refusalWords, INCOMPLETE: INCOMPLETE, KPI_GROUPS: KPI_GROUPS, NO_CONNECTION: NO_CONNECTION }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.N_Manage = api;
})();
