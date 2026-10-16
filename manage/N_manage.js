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
  function deltaLine(cur, prev, key) { var r = deltaCore(cur, prev); r.tone = tone(key, r.dir); return r; }
  function deltaCore(cur, prev) {
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
  function validateExpense(f, list) {
    var e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.date = 'Choose the date of the expense.';
    if (parseAmount(f.amount) === null) e.amount = 'Enter the amount, more than zero, with at most two decimal places.';
    if (!catOk(f.category, list)) e.category = 'Choose a category.';
    if (!String(f.notes || '').trim()) e.notes = 'Say what it was for.';
    return e;
  }
  // The p_txn object has exactly the keys the dashboard's blank() draft carries for an expense; a scanned receipt adds its three optional keys.
  function expenseTxn(f, rc) {
    var t = { txn_type: 'expense', category: f.category, transaction_date: f.date, gross_amount: parseAmount(f.amount), payee_name: String(f.payee || '').trim(), notes: String(f.notes || '').trim(), or_number: '', reason: '' };
    if (rc && rc.path) { t.receipt_image_path = rc.path; if (typeof rc.confidence === 'number') t.ocr_confidence = rc.confidence; if (rc.raw) t.ocr_raw = rc.raw; }
    return t;
  }
  // ocr-receipt reply -> form values. Only values the form would accept are used; each returned key is marked "check this".
  function scanPrefill(r, list) {
    var f = {}, items = Array.isArray(r && r.line_items) ? r.line_items : [], d = items.map(function (i) { return i && str(i.description); }).filter(Boolean);
    if (r && r.amount != null && parseAmount(String(r.amount)) !== null) f.amount = parseAmount(String(r.amount));
    if (r && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) f.date = r.date;
    if (r && str(r.vendor)) f.payee = String(r.vendor).trim();
    if (r && catOk(r.category, list)) f.category = r.category;
    if (d.length) f.notes = d.slice(0, 3).join(', ') + (d.length > 3 ? ' and more' : '');
    return f;
  }
  var SCAN_LOW = 0.6; // below this the photo was hard to read
  // the plain, gracious decline line the host can paste into Messenger (no exclamation marks, no promises)
  function declineMessage(p, chip) {
    var first = String(p && p.guest_name || '').trim().split(/\s+/)[0] || 'there', dates = p && p.checkin_date && p.checkout_date ? ' from ' + fmtDate(p.checkin_date, 'long') + ' to ' + fmtDate(p.checkout_date, 'long') : '';
    var why = chip === 'Dates not available' ? ' because those dates are no longer available' : chip === 'No payment received' ? ' because we have not received the payment' : '';
    return 'Hello ' + first + ', thank you for your interest in Cascade Hideaway. I am sorry to let you know that we are unable to confirm your stay' + dates + why + '. If other dates would suit you, I would be glad to look at them with you. Warm regards, Cascade Hideaway';
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
      inquiries: [
        { id: 'n-demo-q1', booking_ref: 'DEMO0001', guest_name: 'Sample Guest D', checkin_date: d(5), checkout_date: d(7), pax: 2, expected_amount: '2500.00', comparison_id: 'n-demo-c1', candidate_amount: '2500.00', reference: 'DEMO1234', receipt_image_path: 'n/a', hold_expires_at: null },
        { id: 'n-demo-q2', booking_ref: 'DEMO0002', guest_name: 'Sample Guest E', checkin_date: d(12), checkout_date: d(15), pax: 3, expected_amount: '4100.00', comparison_id: null, candidate_amount: null, reference: null, receipt_image_path: null, hold_expires_at: null }
      ],
      txns: [
        { id: 'n-demo-t1', transaction_date: d(-1), txn_type: 'expense', category: 'supplies', gross_amount: '640.00', payee_name: 'Sample shop', notes: 'Sample: kitchen supplies', status: 'confirmed' },
        { id: 'n-demo-t2', transaction_date: d(-2), txn_type: 'income', category: 'direct_income', gross_amount: '5000.00', payee_name: null, notes: 'Sample: deposit', status: 'confirmed' }
      ],
      cats: [{ slug: 'cleaning', label: 'Cleaning', sort_order: 1 }, { slug: 'supplies', label: 'Supplies', sort_order: 2 }, { slug: 'utilities', label: 'Utilities', sort_order: 3 }, { slug: 'repairs', label: 'Repairs', sort_order: 4 }, { slug: 'other', label: 'Other', sort_order: 9 }],
      rq: function () { return { count: this.rqRows.length, total: this.rqRows.reduce(function (a, r) { return a + Number(r.gross_amount); }, 0).toFixed(2), truncated: false, rows: this.rqRows }; },
      rqRows: [{ id: 'n-demo-r1', transaction_date: d(-1), txn_type: 'expense', category: '', gross_amount: '1200.00', payee_name: 'Sample market', notes: 'Sample: scanned receipt', or_number: null, source: 'ocr', receipt_image_path: 'n/a', ocr_confidence: 0.5, created_at: d(-1) + 'T02:00:00Z' }],
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

  function loadTab(t, force) {
    if (t === 'today') { load('overview', force); load('inq', force); }
    else if (t === 'inquiries') load('inq', force);
    else if (t === 'money') { load('txns', force); load('rq', force); }
    else if (t === 'kpis') { load('kpi', force); loadSeries(force); }
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
      var sample = kind === 'overview' ? dd.overview : kind === 'inq' ? normalizePayments(dd.inquiries) : kind === 'txns' ? dd.txns : kind === 'rq' ? dd.rq() : kind === 'cats' ? dd.cats : { now: dd.metrics(per.start, per.endExclusive), prev: dd.metrics(cmp.start, cmp.endExclusive) };
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
    } else if (kind === 'rq') {
      callRpc('admin_review_queue_v1', { p_property_id: pid() }).then(done);
    } else if (kind === 'cats') {
      callRpc('expense_categories_v1', { p_property_id: pid() }).then(done);
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
      if (fin && fin.pendingReviewCount > 0) {
        var rqOff = S.d.rq && (S.d.rq.absent || S.d.rq.denied), rqTxt = count(fin.pendingReviewCount, 'transaction awaits review', 'transactions await review');
        rows += rqOff ? dashLink('finance', rqTxt, formatPHP(fin.pendingReviewAmount))
          : '<button class="N_row" type="button" data-n="tab" data-v="money"><span class="N_rowmid"><span class="N_rowt">' + esc(rqTxt) + '</span><span class="N_rows">' + esc(formatPHP(fin.pendingReviewAmount) + ' · Review in Money') + '</span></span><span class="N_chev" aria-hidden="true">›</span></button>';
      }
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

  function signOf(type) { return type === 'income' ? '+' : type === 'expense' ? '−' : ''; } // a transfer moves money between accounts: no sign
  function rqRows() { var q = S.d.rq; return q && q.ok && q.data && Array.isArray(q.data.rows) ? q.data.rows : []; }
  function rqOf(id) { var r = rqRows(); for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i]; return null; }
  function srcWords(src) { var k = String(src || '').toLowerCase(); return /ocr|scan|receipt/.test(k) ? 'a scanned receipt' : /telegram/.test(k) ? 'Telegram' : /manual|staff|app/.test(k) ? 'an entry in the app' : /email|mail/.test(k) ? 'an e-mail' : 'another source'; }
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
        return '<button class="N_row" type="button" data-n="rq-open" data-v="' + esc(r.id) + '"><span class="N_rowmid"><span class="N_rowt">' + esc(r.payee_name || r.notes || (r.category ? catName(r.category) : 'A transaction')) + '</span><span class="N_rows' + (lowConf(r.ocr_confidence) ? ' N_dn' : '') + '">' + esc(sub) + '</span></span><span class="N_amt N_num">' + signOf(r.txn_type) + esc(formatPHP(r.gross_amount)) + '</span><span class="N_chev" aria-hidden="true">›</span></button>';
      }).join('') + '</section>';
  }
  function viewMoney() {
    var t = S.d.txns || {}, out = '';
    if (!S.d.save || !S.d.save.absent) out += '<button class="btn btn-primary btn-block" type="button" data-n="exp-open">Log an expense</button>';
    else out += '<div class="N_note">Logging an expense is not available in this version of the app yet.</div>';
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
    out += chartsHtml(mNow, mPrev, !!prev);
    KPI_GROUPS.forEach(function (g) {
      var rows = g.keys.filter(function (key) { return mNow[key]; }); if (!rows.length) return;
      out += '<section class="N_card N_list" aria-label="' + esc(g.title) + '"><h3 class="N_h3 N_pad">' + esc(g.title) + '</h3>' + rows.map(function (key) {
        var m = mNow[key], dl = deltaLine(m, prev ? mPrev[key] : null, key), na = m.value === null || m.value === undefined;
        return '<div class="N_row N_static N_kpi"><span class="N_rowmid"><span class="N_rowt">' + esc(KPI_TITLE[key] || key) + '</span>' +
          (dl.text ? '<span class="N_rows' + (dl.tone === 'bad' ? ' N_dn' : dl.tone === 'good' ? ' N_gd' : '') + '">' + (dl.dir === 'up' ? '<span aria-hidden="true">▲</span> ' : dl.dir === 'down' ? '<span aria-hidden="true">▼</span> ' : '') + esc(dl.text) + '</span>' : '') +
          (m.coverage === 'missing' ? '<span class="N_rows">Not enough data yet</span>' : m.coverage === 'partial' ? '<span class="N_rows">Some of the data is still to come</span>' : '') + '</span>' +
          '<span class="N_val N_num' + (na ? ' N_na' : '') + '">' + esc(formatMetricValue(m)) + '</span></div>';
      }).join('') + '</section>';
    });
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
  function chipHtml(c) { return c ? '<span class="N_chipd N_' + c.dir + '"><span aria-hidden="true">' + c.glyph + '</span> ' + esc(c.text) + ' <span class="N_vs">vs before</span></span>' : '<span class="N_chipd N_flat N_vs">No comparison</span>'; }
  var HEADS = [['occupancy', 'Occupancy', 'occ', 'line'], ['accommodation_revenue', 'Accommodation revenue', 'rev', 'bars'], ['adr', 'Accommodation ADR', 'adr', 'line'], ['sold_nights', 'Sold nights', 'nights', 'bars']];
  function monthFigures(m) { return m.failed || (m.rev === null && m.occ === null) ? esc(monthTitle(m)) + ': No data' : esc(monthTitle(m)) + ': Revenue ' + (m.rev === null ? 'No data' : esc(formatPHP(String(m.rev)))) + ' · Occupancy ' + (m.occ === null ? 'No data' : esc(formatPercent(m.occ))); }
  function chartsHtml(mNow, mPrev, hasPrev) {
    var se = S.d.series || {};
    if (se.absent || se.denied || se.err) return ''; // old server or refused: the number rows below remain
    if (se.busy || !se.ok) return chartsSkeleton();
    if (se.v1) return chartsV1(se.v1);
    var series = se.series, out = '<div class="N_charts">';
    HEADS.forEach(function (h) {
      var m = mNow[h[0]]; if (!m) return;
      var vals = series.map(function (x) { return x[h[2]]; });
      out += '<section class="N_card N_hcard" aria-label="' + esc(h[1]) + '"><span class="N_hl">' + esc(h[1]) + '</span><span class="N_hv N_num">' + esc(formatMetricValue(m)) + '</span>' + chipHtml(hasPrev ? chipFor(m, mPrev[h[0]]) : null) +
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
      var last = ms[ms.length - 1], prev = ms.length > 1 ? ms[ms.length - 2] : null, ly = last.ly || null;
      var chg = function (a, b, pts) { a = nm(a); b = nm(b); if (a === null || b === null) return null; if (pts) return { v: a - b, unit: 'pt' }; return b === 0 ? null : (a - b) / Math.abs(b) * 100; };
      var tiles = [['revpar', 'RevPAR', 1], ['revenue', 'Revenue', 1], ['occupancy', 'Occupancy', 0], ['adr', 'ADR', 1]].filter(function (t) { return fin || !t[2]; }).map(function (t) {
        var k = t[0], v = nm(last[k]), pts = k === 'occupancy';
        return C.kpiTile({ title: t[1], value: v === null ? null : (pts ? C.formatPercent(v) : C.formatPHP(v)), spark: ms.map(function (m) { return nm(m[k]); }),
          deltaPrev: prev ? chg(last[k], prev[k], pts) : null, deltaYoY: ly ? chg(last[k], ly[k], pts) : null, goodWhen: 'up' });
      }).join('');
      out += '<p class="N_sub">' + esc(lab(last.month) + ' ' + String(last.month).slice(0, 4) + ', the last full month. Compared with the month before' + (ly ? ' and with the same month last year.' : '.')) + '</p><div class="N_tiles">' + tiles + '</div>';
      out += '<h3 class="N_h3 N_gap">Month by month</h3><p class="N_sub">' + esc(fin ? 'Bars are accommodation revenue.' : 'Bars are nights sold.') + '</p>' + C.monthBars({
        months: ms.map(function (m) { return { label: lab(m.month), value: fin ? nm(m.revenue) : nm(m.sold_nights), lastYear: m.ly ? (fin ? nm(m.ly.revenue) : nm(m.ly.sold_nights)) : null, occupancy: nm(m.occupancy) }; }),
        format: fin ? undefined : function (v) { return v + (v === 1 ? ' night' : ' nights'); } });
    }
    var pace = d.pace || [], unk = pace.reduce(function (a, p) { return a + (nm(p && p.ly_unknown_booking_date) || 0); }, 0);
    out += C.paceCard({ nextMonths: pace.map(function (p) { return { label: lab(p.month), booked: nm(p.otb_nights), bookedLastYear: nm(p.ly_otb_nights), capacity: nm(p.capacity_nights) }; }) });
    if (unk > 0) out += '<p class="N_foot">' + esc('Last year leaves out ' + count(unk, 'stay', 'stays') + ' with no booking date.') + '</p>';
    return out + '</div>';
  }

  // ---- sheets ----
  function field(id, label, control, err, mark) { return '<div class="N_field"><label class="N_lbl" for="' + id + '">' + esc(label) + (mark ? ' <span class="N_mark">check this</span>' : '') + '</label>' + control + (err ? '<p class="N_ferr" id="' + id + '-e" role="alert"><span aria-hidden="true">✕</span> ' + esc(err) + '</p>' : '') + '</div>'; }
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

  function catSelect(id, val) {
    return '<select class="N_select N_full" id="' + id + '" data-f="category"><option value=""' + (val ? '' : ' selected') + '>Choose a category</option>' + catList().map(function (c) { return '<option value="' + esc(c.slug) + '"' + (val === c.slug ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>';
  }
  // Scanning needs the s89 server release; its category list is the sign that the release is live (an older save would silently ignore the receipt).
  function scanAvailable() { return !!(S.demo || (S.d.cats && S.d.cats.ok && !(S.d.scan && S.d.scan.absent))); }
  function scanBlock(sh) {
    var busy = sh.scan === 'reading';
    return '<div class="N_scan"><button class="btn btn-secondary btn-block" type="button" data-n="scan-pick"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + esc(busy ? 'Reading the receipt…' : sh.receipt ? 'Scan another receipt' : 'Scan receipt') + '</button>' +
      '<input class="N_sr" id="N_xs" type="file" accept="image/*" data-f="scan" tabindex="-1" aria-label="Receipt photo">' +
      (sh.thumb ? '<img class="N_thumb" src="' + esc(sh.thumb) + '" alt="The receipt photo you took">' : '') +
      (sh.scanMsg ? '<p class="N_p" role="status">' + esc(sh.scanMsg) + '</p>' : '') +
      (sh.receipt && lowConf(sh.receipt.confidence) ? '<p class="N_ferr" role="alert"><span aria-hidden="true">!</span> The photo was hard to read. Please check every figure.</p>' : '') +
      (sh.receipt ? '<button class="N_link" type="button" data-n="scan-clear">Remove the photo</button>' : '') + '</div>';
  }
  function sheetHtml() {
    var sh = S.sheet; if (!sh) return '';
    if (sh.kind === 'inq') {
      var p = payOf(sh.id); if (!p) return '';
      var absentActs = S.d.confirm && S.d.confirm.absent;
      var body = '<dl class="N_dl"><dt>Dates</dt><dd>' + esc(fmtDate(p.checkin_date, 'weekday') + ' to ' + fmtDate(p.checkout_date, 'weekday') + ' · ' + count(nightsBetween(p.checkin_date, p.checkout_date), 'night', 'nights')) + '</dd>' +
        '<dt>Guests</dt><dd>' + esc(p.pax == null ? '—' : p.pax) + '</dd><dt>To receive</dt><dd class="N_num">' + esc(formatPHP(p.expected_amount)) + '</dd><dt>Payment</dt><dd>' + esc(paymentLine(p)) + '</dd>' +
        (p.hold_expires_at ? '<dt>Dates held until</dt><dd>' + esc(fmtDateTime(p.hold_expires_at)) + '</dd>' : '') + '<dt>Reference</dt><dd>' + esc(p.booking_ref || '—') + '</dd></dl>';
      if (p.receipt_image_path) {
        var ph = sh.photo || {};
        body += ph.state === 'ok' ? '<a href="' + esc(ph.url) + '" target="_blank" rel="noopener"><img class="N_photo" src="' + esc(ph.url) + '" alt="Receipt photo sent by the guest" referrerpolicy="no-referrer"></a>'
          : ph.state === 'err' ? '<p class="N_p">The receipt photo could not be opened. <button class="N_link" type="button" data-n="photo-retry">Try again</button></p>'
          : ph.state === 'none' ? '<p class="N_p">A receipt photo is on file.</p>' : '<p class="N_p" role="status">Opening the receipt photo…</p>';
      }
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
        db += '<p class="N_sub">Check this before you decline. The booking and its calendar entry are cancelled, and its income row is voided. The guest is not messaged yet. You can copy a polite message for them next.</p><dl class="N_dl"><dt>Guest</dt><dd>' + esc(pd.guest_name || 'A guest') + '</dd><dt>Dates</dt><dd>' + esc(fmtDate(pd.checkin_date, 'long') + ' to ' + fmtDate(pd.checkout_date, 'long')) + '</dd><dt>Reason</dt><dd>' + esc(declineReason(sh.chip, sh.text) || '') + '</dd></dl>' + sheetErr(sh) + btns('Decline request', 'dc-send', 'Back', 'dc-edit', sh.busy, true);
      }
      return sheetShell('Decline request', db);
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
        (rr.receipt_image_path ? '<p class="N_box">A receipt photo is attached.</p>' : '') + (lowConf(rr.ocr_confidence) ? '<p class="N_ferr" role="alert"><span aria-hidden="true">!</span> The receipt was hard to read. Please check every figure.</p>' : '') +
        field('N_rd', 'Date', '<input class="N_input" id="N_rd" type="date" data-f="date" value="' + esc(fr.date) + '"' + (er.date ? ' aria-invalid="true"' : '') + '>', er.date) +
        field('N_ra', 'Amount (PHP)', inp('N_ra', 'amount', fr.amount, 'inputmode="decimal"'), er.amount) +
        (isX ? field('N_rc', 'Category', catSelect('N_rc', fr.category), er.category) : '<p class="N_line">Category: ' + esc(rr.category ? catName(rr.category) : '—') + '</p>') +
        field('N_rn', 'What was it for?', inp('N_rn', 'notes', fr.notes)) + field('N_rp', 'Paid to', inp('N_rp', 'payee', fr.payee)) + field('N_ro', 'Receipt number (optional)', inp('N_ro', 'or_number', fr.or_number)) + sheetErr(sh) +
        '<div class="N_btns"><button class="btn btn-primary btn-block" type="button" data-n="rq-approve"' + (sh.busy ? ' disabled aria-busy="true"' : '') + '>' + esc(sh.busy ? 'Sending…' : 'Approve') + '</button>' +
        '<button class="btn btn-secondary btn-block" type="button" data-n="rq-void-start"' + (sh.busy ? ' disabled' : '') + '>Void…</button></div><button class="btn btn-ghost btn-block" type="button" data-n="sheet-close"' + (sh.busy ? ' disabled' : '') + '>Close</button>';
      return sheetShell('Review a transaction', rb);
    }
    if (sh.kind === 'expense') {
      var f2 = sh.f, e2 = sh.errs || {}, ck = sh.checks || {}, xb = '';
      if (sh.step === 'form') {
        if (scanAvailable()) xb += scanBlock(sh); else if (sh.scanMsg) xb += '<p class="N_p" role="status">' + esc(sh.scanMsg) + '</p>';
        xb += field('N_xd', 'Date', '<input class="N_input" id="N_xd" type="date" data-f="date" value="' + esc(f2.date) + '"' + (e2.date ? ' aria-invalid="true"' : '') + '>', e2.date, ck.date) +
          field('N_xa', 'Amount (PHP)', inp('N_xa', 'amount', f2.amount, 'inputmode="decimal"'), e2.amount, ck.amount) +
          field('N_xc', 'Category', catSelect('N_xc', f2.category), e2.category, ck.category) +
          field('N_xn', 'What was it for?', inp('N_xn', 'notes', f2.notes), e2.notes, ck.notes) + field('N_xp', 'Paid to (optional)', inp('N_xp', 'payee', f2.payee), '', ck.payee) + sheetErr(sh) + btns('Review', 'ex-review', 'Cancel', 'sheet-close');
      } else {
        xb += '<p class="N_sub">Check this before you save. It is counted in the books at once.</p><dl class="N_dl"><dt>Date</dt><dd>' + esc(fmtDate(f2.date, 'long')) + '</dd><dt>Amount</dt><dd class="N_num">' + esc(formatPHP(parseAmount(f2.amount))) + '</dd><dt>Category</dt><dd>' + esc(catName(f2.category)) + '</dd>' +
          '<dt>For</dt><dd>' + esc(f2.notes.trim()) + '</dd>' + (f2.payee.trim() ? '<dt>Paid to</dt><dd>' + esc(f2.payee.trim()) + '</dd>' : '') + (sh.receipt ? '<dt>Receipt</dt><dd>' + (sh.thumb ? '<img class="N_thumb" src="' + esc(sh.thumb) + '" alt="The receipt photo"> ' : '') + 'Receipt attached</dd>' : '') + '</dl>' + sheetErr(sh) + btns('Save expense', 'ex-send', 'Back', 'ex-edit', sh.busy);
      }
      return sheetShell('Log an expense', xb);
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
    if (S.thumbUrl && !(S.sheet && S.sheet.thumb === S.thumbUrl)) revokeThumb();
    if (EXT[S.tab] && extMod(S.tab)) { drawExt(extMod(S.tab)); return; }
    extStop();
    var body = S.tab === 'inquiries' ? viewInquiries() : S.tab === 'money' ? viewMoney() : S.tab === 'kpis' ? viewKpis() : viewToday();
    var live = S.notice ? '<div class="N_okbox" role="status">' + esc(S.notice) + '</div>' : '';
    S.el.innerHTML = '<div class="N_root">' + tabsHtml() + live + '<div class="N_body" role="tabpanel" aria-labelledby="N_tab_' + S.tab + '"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + body + '</div></div>' + sheetHtml();
    revealTab();
    if (S.sheet && S.sheet.focus !== false) { try { var h = S.el.querySelector('[data-n-focus]'); if (h && h.focus) h.focus(); } catch (e) { /* no focus in tests */ } S.sheet.focus = false; }
  }

  // ------------------------------------------------------------------------------------------------ actions
  function buzz(kind) { try { if (S.opts.haptic) S.opts.haptic(kind); } catch (e) { /* optional */ } }
  function tell(msg) { try { if (S.opts.toast) S.opts.toast(msg); } catch (e) { /* optional */ } }
  function refreshAfterWrite() { ['overview', 'inq', 'txns', 'kpi', 'rq'].forEach(function (k) { if (S.d[k]) S.d[k].ok = false; }); loadTab(S.tab, true); }

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

  function loadPhoto(sh, path) { // the guest's receipt photo, shown inline from a short-lived signed link (owner and admin may read the bucket)
    if (S.demo || !S.client || !S.client.storage) { sh.photo = { state: 'none' }; return; }
    sh.photo = { state: 'loading' }; var gen = S.gen, fail = function () { if (S && S.gen === gen && S.sheet === sh) { sh.photo = { state: 'err' }; draw(); } };
    try { Promise.resolve(S.client.storage.from('booking-receipts').createSignedUrl(path, 300)).then(function (r) { if (!S || S.gen !== gen || S.sheet !== sh) return; if (r && r.data && r.data.signedUrl) { sh.photo = { state: 'ok', url: r.data.signedUrl }; draw(); } else fail(); }, fail); } catch (e) { fail(); }
  }
  function openInq(id) { var p = payOf(id); S.sheet = { kind: 'inq', id: id, msg: '', focus: true }; if (p && p.receipt_image_path) loadPhoto(S.sheet, p.receipt_image_path); draw(); }
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
      s2.msg = 'Nothing was changed. Please check it and try again.'; draw();
    });
  }

  // ---- scan a receipt: shrink on the phone, read it on the server, prefill the form and mark every filled field
  var FN_TIMEOUT_MS = 60000;
  function callFn(name, body) { // client.functions.invoke adds the session token; a non-2xx answer carries the Response in error.context
    var st = S;
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { fin({ ok: false, status: 0, net: true }); }, FN_TIMEOUT_MS);
      st.timers = st.timers || []; st.timers.push(t);
      function fin(r) { if (done) return; done = true; clearTimeout(t); resolve(r); }
      try {
        Promise.resolve(st.client.functions.invoke(name, { body: body })).then(function (r) {
          r = r || {};
          if (!r.error) { var d = r.data; fin(d && d.ok === false ? { ok: false, status: 400, code: d.error, data: d } : { ok: true, status: 200, data: d }); return; }
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === 'function') { Promise.resolve(ctx.json()).then(function (j) { return j || {}; }, function () { return {}; }).then(function (j) { fin({ ok: false, status: ctx.status | 0, code: j && typeof j.error === 'string' ? j.error : undefined, data: j }); }); return; }
          fin({ ok: false, status: 0, net: true, error: r.error });
        }, function (e) { fin({ ok: false, status: 0, net: true, error: e }); });
      } catch (e) { fin({ ok: false, status: 0, net: true, error: e }); }
    });
  }
  // longest edge 1600 px, JPEG .8, white behind any transparency (the shell may pass its own helper as opts.shrinkImage)
  function shrinkReceipt(file) {
    if (S.opts.shrinkImage) return Promise.resolve(S.opts.shrinkImage(file));
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); res(img); }; img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); }; img.src = u;
    }).then(function (img) {
      var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight, 1)), cv = document.createElement('canvas'), cx;
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.8); });
    }).then(function (blob) {
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res({ base64: String(fr.result).replace(/^data:[^,]*,/, ''), mime: 'image/jpeg' }); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsDataURL(blob); });
    });
  }
  // the preview is a blob link, not a long data string in the page; draw() revokes it as soon as no open sheet shows it
  function setThumb(sh, img) {
    try { var bin = atob(img.base64), u8 = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); revokeThumb(); S.thumbUrl = sh.thumb = URL.createObjectURL(new Blob([u8], { type: img.mime })); }
    catch (e) { sh.thumb = null; }
  }
  function revokeThumb() { if (S && S.thumbUrl) { try { URL.revokeObjectURL(S.thumbUrl); } catch (e) { /* ok */ } S.thumbUrl = null; } }
  var DEMO_SCAN = { ok: true, receipt_path: 'n-demo/receipt.jpg', amount: '640.00', date: null, vendor: 'Sample shop', category: 'supplies', line_items: [{ description: 'Sample kitchen supplies', qty: 1, unit_cost: 640 }], confidence: 0.9 };
  function scanReceipt(file) {
    var sh = S.sheet; if (!sh || sh.kind !== 'expense' || !file || sh.scan === 'reading') return;
    sh.scan = 'reading'; sh.scanMsg = ''; sh.msg = ''; draw();
    var gen = S.gen, live = function () { return !!S && S.gen === gen && S.sheet === sh; }, stop = function (m) { sh.scan = 'failed'; sh.scanMsg = m; draw(); };
    shrinkReceipt(file).then(function (img) {
      if (!live()) return;
      if (!img || !img.base64 || img.base64.length > 8000000) { stop('That photo is too large. Take it again a little further back.'); return; }
      setThumb(sh, img);
      if (!online()) { stop(NO_CONNECTION + ' You can still fill the form in by hand.'); return; }
      return (S.demo ? Promise.resolve({ ok: true, status: 200, data: DEMO_SCAN }) : S.client && S.client.functions && typeof S.client.functions.invoke === 'function' ? callFn('ocr-receipt', { mode: 'extract', image_base64: img.base64, mime_type: img.mime }) : Promise.resolve({ ok: false, status: 404 })).then(function (r) {
        if (!live()) return;
        var d = r.data || {};
        if (r.ok && d.transaction_id) { // an older function added the photo to the review list by itself: do not log it twice
          S.d.scan = { absent: true }; sh.thumb = null; if (S.d.rq) S.d.rq.ok = false; load('rq', true);
          stop('This photo was added to Waiting for review. Approve it there instead of logging it again.'); return;
        }
        if (r.ok && d.receipt_path) {
          var cl = catList(), pre = scanPrefill(d, cl), ck = {}; Object.keys(pre).forEach(function (k) { sh.f[k] = pre[k]; ck[k] = true; });
          sh.checks = ck; sh.receipt = { path: d.receipt_path, confidence: typeof d.confidence === 'number' ? d.confidence : null,
            raw: d.raw && typeof d.raw === 'object' && JSON.stringify(d.raw).length <= 20000 ? d.raw : null };
          sh.scan = 'done'; sh.scanMsg = Object.keys(pre).length ? 'Read from the receipt. Please check the marked fields.' : 'The receipt is attached. Nothing could be read from it, so please fill the form in.'; sh.errs = {}; draw(); return;
        }
        if (d.error === 'ocr_failed' && d.receipt_path) { sh.receipt = { path: d.receipt_path, confidence: null, raw: null }; sh.scan = 'done'; sh.scanMsg = 'The receipt photo is attached, but it could not be read. Please fill the form in.'; draw(); return; }
        if (r.status === 404) { S.d.scan = { absent: true }; sh.thumb = null; stop('Scanning is not available in this version of the app yet. Please fill the form in by hand.'); return; }
        sh.thumb = null;
        stop(r.net ? 'The connection dropped before the receipt was read. Try the photo again, or fill the form in by hand.' : r.status === 401 || r.status === 403 ? 'Your account is not allowed to scan receipts.' : 'The receipt could not be read just now. You can still fill the form in by hand.');
      });
    }).then(null, function () { if (live()) stop('That photo could not be read. You can still fill the form in by hand.'); });
  }
  function copyText(text) {
    try { var cb = typeof navigator !== 'undefined' && navigator.clipboard; if (cb && typeof cb.writeText === 'function') return Promise.resolve(cb.writeText(text)).then(function () { return true; }, function () { return false; }); } catch (e) { /* fall through */ }
    return Promise.resolve(false);
  }
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
    var sh = S.sheet, p0 = payOf(sh.id); if (sh.step !== 'review') return;
    sendWrite('decline', 'staff_decline_direct_booking_v1', { p_booking_id: sh.id, p_reason: declineReason(sh.chip, sh.text) || '', p_idempotency_key: sh.key }, function (res, s2) {
      res = res || {};
      if (res.ok === true) { buzz('success'); tell(declineSentence(res)); S.notice = declineSentence(res); S.sheet = { kind: 'msg', guest: p0 && p0.guest_name, text: declineMessage(p0, sh.chip), copied: false, msg: '', focus: true }; if (S.demo) demoRemove(sh.id); refreshAfterWrite(); draw(); return; }
      s2.msg = declineSentence(res); s2.key = mintKey('decline'); s2.step = 'form'; draw();
    });
  }
  function demoRemove(id) { S.demoData.inquiries = S.demoData.inquiries.filter(function (r) { return r.id !== id; }); }
  function doExpenseSend() {
    var sh = S.sheet; if (sh.step !== 'review') return;
    var txn = expenseTxn(sh.f, sh.receipt);
    sendWrite('save', 'admin_save_transaction_v1', { p_property_id: pid(), p_txn: txn, p_idempotency_key: sh.key }, function (res, s2) { // features/finance/api.ts:121
      if (res && res.ok) { var m = 'Expense saved: ' + formatPHP(txn.gross_amount) + ', ' + catName(txn.category) + ', ' + fmtDate(txn.transaction_date, 'long') + '.'; buzz('success'); tell(m); S.notice = m; S.sheet = null; if (S.demo) S.demoData.txns.unshift({ id: 'n-demo-' + (S.demoData.txns.length + 1), transaction_date: txn.transaction_date, txn_type: 'expense', category: txn.category, gross_amount: txn.gross_amount, payee_name: txn.payee_name || null, notes: txn.notes, status: 'confirmed' }); refreshAfterWrite(); draw(); return; }
      s2.msg = 'The expense was not saved. Please check it and try again.'; s2.key = mintKey('txn'); s2.step = 'form'; draw();
    });
  }

  function onClick(ev) {
    if (!S) return; if (ev.target && ev.target.closest && ev.target.closest('[data-n-ext]')) return; // clicks inside Bookings or Ops belong to them
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-n]') : null; if (!t) return;
    var a = t.getAttribute('data-n'), v = t.getAttribute('data-v'), sh = S.sheet;
    if (t.disabled || t.getAttribute('aria-busy') === 'true') return;
    if (sh && sh.busy && (a === 'go' || a === 'tab' || a === 'refresh' || a === 'retry')) return; // a request is in flight: nothing may orphan its sheet
    if (a === 'go') { if (ev.preventDefault) ev.preventDefault(); S.sheet = null; S.opts.navigate('#door/dashboard/' + v); return; }
    if (a === 'tab') { setTab(v, true); return; }
    if (a === 'retry') { loadTab(['today', 'inquiries', 'money', 'kpis'].indexOf(v) >= 0 ? v : S.tab, true); return; }
    if (a === 'refresh') { S.notice = ''; loadTab(S.tab, true); return; }
    S.notice = '';
    if (a === 'mon') { S.monSel = +v; draw(); return; }
    if (a === 'tbl') { S.showTable = !S.showTable; draw(); return; }
    if (a === 'inq-open') return openInq(v);
    if (a === 'exp-open') { S.sheet = { kind: 'expense', step: 'form', key: mintKey('txn'), busy: false, msg: '', errs: {}, focus: true, checks: {}, scan: '', f: { date: manilaToday(), amount: '', category: '', notes: '', payee: '' } }; draw(); if (!S.d.cats) load('cats', false); return; }
    if (a === 'rq-open') return openReview(v);
    if (!sh) return;
    if (a === 'sheet-close') { if (sh.busy) return; S.sheet = null; draw(); return; }
    if (a === 'sheet-back') { if (sh.busy) return; if (sh.kind === 'review' && sh.step === 'void') { sh.step = 'form'; sh.msg = ''; sh.errs = {}; sh.focus = true; draw(); return; } if (sh.kind === 'confirm' || sh.kind === 'decline') { S.sheet = { kind: 'inq', id: sh.id, msg: '', focus: true }; } else S.sheet = null; draw(); return; }
    if (a === 'cf-start') return startConfirm();
    if (a === 'cf-review') { sh.errs = validateConfirm(sh.f, payOf(sh.id)); sh.msg = ''; if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the items marked below.'; draw(); return; } sh.step = 'review'; sh.focus = true; draw(); return; }
    if (a === 'cf-edit' || a === 'dc-edit' || a === 'ex-edit') { if (sh.busy) return; sh.step = 'form'; sh.msg = ''; sh.focus = true; draw(); return; }
    if (a === 'cf-send') return doConfirmSend();
    if (a === 'dc-start') { S.sheet = { kind: 'decline', id: sh.id, step: 'form', key: mintKey('decline'), busy: false, msg: '', chip: null, text: '', focus: true }; draw(); return; }
    if (a === 'dc-chip') { sh.chip = sh.chip === v ? null : v; sh.msg = ''; draw(); return; }
    if (a === 'dc-review') { if (!declineReason(sh.chip, sh.text)) { sh.msg = 'Choose or write a reason first.'; draw(); return; } sh.step = 'review'; sh.msg = ''; sh.focus = true; draw(); return; }
    if (a === 'dc-send') return doDeclineSend();
    if (a === 'photo-retry') { var pq = payOf(sh.id); if (pq && pq.receipt_image_path) { loadPhoto(sh, pq.receipt_image_path); draw(); } return; }
    if (a === 'scan-pick') { try { var fi = S.el.querySelector('#N_xs'); if (fi && fi.click) fi.click(); } catch (e) { /* no picker in tests */ } return; }
    if (a === 'scan-clear') { sh.receipt = null; sh.thumb = null; sh.checks = {}; sh.scan = ''; sh.scanMsg = ''; draw(); return; }
    if (a === 'rq-approve') return doReview('approve');
    if (a === 'rq-void-start') { sh.step = 'void'; sh.msg = ''; sh.errs = {}; sh.focus = true; draw(); return; }
    if (a === 'rq-void-send') return doReview('void');
    if (a === 'msg-copy') { copyText(sh.text).then(function (ok) { if (!S || S.sheet !== sh) return; sh.copied = ok; sh.msg = ok ? '' : 'This phone would not copy it. Press and hold the text above, then choose Copy.'; draw(); }); return; }
    if (a === 'ex-review') { if (sh.scan === 'reading') return; sh.errs = validateExpense(sh.f); sh.msg = ''; if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the items marked below.'; draw(); return; } sh.step = 'review'; sh.focus = true; draw(); return; }
    if (a === 'ex-send') return doExpenseSend();
  }
  function onInput(ev) {
    if (!S) return; var t = ev.target; if (!t || !t.getAttribute) return; var f = t.getAttribute('data-f'); if (!f) return;
    if (f === 'period') { var v = t.value; if (!PRESETS.some(function (p) { return p[0] === v; })) return; S.period = v; ls('set', 'cs_n_period', v); S.d.kpi = {}; draw(); load('kpi', true); return; }
    if (t.closest && t.closest('[data-n-ext]')) return;
    var sh = S.sheet; if (!sh) return;
    if (f === 'scan') { scanReceipt(t.files && t.files[0]); return; }
    var val = t.type === 'checkbox' ? !!t.checked : t.value;
    if ((sh.kind === 'decline' || sh.kind === 'msg') && f === 'text') { sh.text = val; return; }
    if (sh.kind === 'review' && f === 'reason') { sh.reason = val; return; }
    if (sh.checks && sh.checks[f]) delete sh.checks[f];
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
    var today = manilaToday(), sub = tabOk(opts.sub) ? opts.sub : null, stored = ls('get', 'cs_n_tab'), sp = ls('get', 'cs_n_period');
    S = { el: el, opts: opts, client: opts.client, demo: !!opts.demo, role: opts.role, gen: ++N_gen, today: today, d: {}, sheet: null, notice: '', loadedAt: 0,
      tab: sub || (tabOk(stored) ? stored : 'today'), period: PRESETS.some(function (p) { return p[0] === sp; }) ? sp : 'mtd', demoData: demoData(today) };
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
    revokeThumb(); extStop(); (S.timers || []).forEach(function (t) { clearTimeout(t); });
    N_gen++; S = null; // a late reply finds no state and is dropped
  }

  var api = {
    mount: mount, unmount: unmount,
    _setRpcTimeout: function (ms) { RPC_TIMEOUT_MS = ms; },
    _setSeriesConcurrency: function (n) { SERIES_CONCURRENCY = n; },
    _setClock: function (fn) { clock = fn || function () { return Date.now(); }; },
    lib: { lastMonths: lastMonths, buildSeries: buildSeries, chipFor: chipFor, canManage: canManage, manilaToday: manilaToday, addDays: addDays, nightsBetween: nightsBetween, fmtDate: fmtDate, fmtDateTime: fmtDateTime, toCentavos: toCentavos, fromCentavos: fromCentavos, formatPHP: formatPHP, formatPercent: formatPercent, formatNumber: formatNumber,
      formatMetricValue: formatMetricValue, parseAmount: parseAmount, periodPreset: periodPreset, comparablePeriod: comparablePeriod, compareMode: compareMode, pctDelta: pctDelta, fmtDeltaPct: fmtDeltaPct, deltaLine: deltaLine,
      normalizePayments: normalizePayments, paymentLine: paymentLine, validateConfirm: validateConfirm, confirmArgs: confirmArgs, confirmSentence: confirmSentence, declineSentence: declineSentence, declineReason: declineReason,
      validateExpense: validateExpense, expenseTxn: expenseTxn, normalizeCats: normalizeCats, scanPrefill: scanPrefill, declineMessage: declineMessage, tone: tone, isMissing: isMissing, isDenied: isDenied, isOffline: isOffline, plainError: plainError, PRESETS: PRESETS, METHODS: METHODS, EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, KPI_GROUPS: KPI_GROUPS, NO_CONNECTION: NO_CONNECTION }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.N_Manage = api;
})();
