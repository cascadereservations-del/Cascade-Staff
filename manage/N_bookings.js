/* Cascade Staff, lane L5: Bookings. Phone-native list (Upcoming | Current | Past) and detail sheet.
   Same data as the React dashboard bookings page (admin-dashboard/app/src/features/bookings/api.ts fetchStays): tables airbnb_reservations,
   booking_inquiries and calendar_events, merged the way model.ts mergeStays merges them. Read-only. Confirm and decline of a waiting direct
   request stay in Manage > Inquiries (staff_confirm_direct_booking_v1 / staff_decline_direct_booking_v1 live there); this screen links to it.
   Roles: owner, admin, finance read all three tables and see amounts. Anyone else reads calendar_events only (RLS read_operations) and sees
   no money, notes, contact data or guest counts. Guest phone/email columns are never selected.
   Mounted by the shell: window.N_BOOKINGS.mount(el, { client, access, propertyId?, demo?, navigate? }). No build step. */
(function () {
  'use strict';
  var FALLBACK_PROPERTY = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var SEGS = ['upcoming', 'current', 'past'];
  var SEG_LABEL = { upcoming: 'Upcoming', current: 'Current', past: 'Past' };
  var MONEY_ROLES = ['owner', 'admin', 'finance'];
  var clock = function () { return Date.now(); };

  // ---- pure helpers (tested)
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isoOf(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function utc(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function manilaToday(ms) { return isoOf((ms == null ? clock() : ms) + 8 * 3600000); }
  function addDays(iso, n) { return isoOf(utc(iso) + n * 86400000); }
  function nightsBetween(a, b) { return Math.max(0, Math.round((utc(b) - utc(a)) / 86400000)); }
  function fmtDate(iso, style) {
    if (!iso) return '—';
    var d = new Date(utc(iso)), s = d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
    return style === 'long' ? s + ' ' + d.getUTCFullYear() : style === 'weekday' ? DOW[d.getUTCDay()] + ' ' + s : s;
  }
  function toCentavos(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = typeof v === 'number' ? v.toFixed(2) : String(v).trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var neg = s.charAt(0) === '-', p = s.replace('-', '').split('.'), c = Number(p[0]) * 100 + Number(((p[1] || '') + '00').slice(0, 2));
    return neg ? -c : c;
  }
  var PHP = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
  function formatPHP(v) { var c = toCentavos(v); if (c === null) return '—'; return PHP ? PHP.format(c / 100) : 'PHP ' + (c / 100).toFixed(2); }

  function roleOf(access) { return typeof access === 'string' ? access : (access && access.role) || ''; }
  function canSeeMoney(access) { return MONEY_ROLES.indexOf(roleOf(access)) >= 0; }
  function canDecide(access) { var r = roleOf(access); return r === 'owner' || r === 'admin'; } // Manage > Inquiries is owner/admin only

  function inquiryState(s) { return s === 'pending' || s === 'inquiry' ? 'pending' : s === 'confirmed' || s === 'completed' ? 'confirmed' : s === 'cancelled' || s === 'declined' ? 'cancelled' : 'unknown'; }
  function resState(s) { return s === 'confirmed' || s === 'completed' ? 'confirmed' : s === 'cancelled' ? 'cancelled' : 'unknown'; }

  // rows: { res:[], inq:[], cal:[] }; money=false builds from calendar rows only. Blocked and cancelled calendar rows are not bookings.
  function buildBookings(rows, money) {
    var res = rows.res || [], inq = rows.inq || [], cal = (rows.cal || []).filter(function (c) { return c.status !== 'cancelled' && c.status !== 'blocked' && c.checkin_date && c.checkout_date; });
    var out = [], used = {}, byLink = {}, byDates = {};
    cal.forEach(function (c) { if (c.linked_reservation_id) byLink[c.linked_reservation_id] = c; var k = c.source + '|' + c.checkin_date + '|' + c.checkout_date; (byDates[k] = byDates[k] || []).push(c); });
    function matchCal(id, source, ci, co) {
      var c = byLink[id];
      if (!c) { var l = byDates[source + '|' + ci + '|' + co] || []; for (var i = 0; i < l.length; i++) if (!used[l[i].id]) { c = l[i]; break; } }
      if (c) used[c.id] = 1;
      return c || null;
    }
    if (money) {
      res.forEach(function (r) {
        if (!r.checkin_date || !r.checkout_date) return;
        var c = matchCal(r.id, 'airbnb', r.checkin_date, r.checkout_date);
        out.push({ key: 'airbnb:' + r.id, kind: 'airbnb', id: r.id, code: r.confirmation_code || '', guest: r.guest_name || 'Unknown guest', pax: r.guest_count == null ? null : r.guest_count,
          checkin: r.checkin_date, checkout: r.checkout_date, nights: nightsBetween(r.checkin_date, r.checkout_date), state: resState(r.status), amount: r.guest_paid == null ? null : String(r.guest_paid),
          paid: r.guest_paid != null, payout: r.payout_date ? 'recorded' : r.host_payout != null ? 'expected' : 'unknown', payoutDate: r.payout_date || null, due: null, notes: '', synced: !!c, receipt: false });
      });
      inq.forEach(function (i) {
        if (!i.checkin_date || !i.checkout_date) return;
        var c = matchCal(i.id, 'direct', i.checkin_date, i.checkout_date), st = inquiryState(i.status);
        out.push({ key: 'direct:' + i.id, kind: 'direct', id: i.id, code: 'DIR-' + String(i.id).slice(0, 8).toUpperCase(), guest: i.guest_name || 'Unknown guest', pax: i.pax == null ? null : i.pax,
          checkin: i.checkin_date, checkout: i.checkout_date, nights: nightsBetween(i.checkin_date, i.checkout_date), state: st, amount: i.total_amount == null ? null : String(i.total_amount),
          // deposit_amount is the fee DUE; only a receipt or a confirmation means money arrived (model.ts mergeStays)
          paid: !!i.receipt_image_path || st === 'confirmed', payout: 'na', payoutDate: null, due: i.deposit_amount == null ? null : String(i.deposit_amount), notes: i.notes || '', synced: !!c, receipt: !!i.receipt_image_path });
      });
    }
    cal.forEach(function (c) {
      if (used[c.id]) return;
      var k = c.source === 'airbnb' ? 'airbnb' : c.source === 'direct' ? 'direct' : 'calendar';
      out.push({ key: 'cal:' + c.id, kind: k, id: c.id, code: '', guest: c.guest_name || 'Calendar reservation', pax: null, checkin: c.checkin_date, checkout: c.checkout_date,
        nights: nightsBetween(c.checkin_date, c.checkout_date), state: 'confirmed', amount: null, paid: null, payout: 'na', payoutDate: null, due: null, notes: '', synced: true, receipt: false, calOnly: true });
    });
    return out;
  }
  function segmentOf(b, today) { return b.checkout <= today ? 'past' : b.checkin > today ? 'upcoming' : 'current'; }
  function filterBookings(list, seg, q, today, showCancelled) {
    var s = String(q || '').trim().toLowerCase();
    var out = list.filter(function (b) {
      if (segmentOf(b, today) !== seg) return false;
      if (b.state === 'cancelled' && !showCancelled) return false;
      return !s || b.guest.toLowerCase().indexOf(s) >= 0;
    });
    out.sort(function (a, b) { return seg === 'past' ? (a.checkin < b.checkin ? 1 : a.checkin > b.checkin ? -1 : 0) : (a.checkin < b.checkin ? -1 : a.checkin > b.checkin ? 1 : 0); });
    return out;
  }
  function counts(list, today, q, showCancelled) { var c = {}; SEGS.forEach(function (s) { c[s] = filterBookings(list, s, q, today, showCancelled).length; }); return c; }
  function sourceLabel(b) { return b.kind === 'airbnb' ? 'Airbnb' : b.kind === 'direct' ? 'Direct' : 'Calendar'; }
  function statusOf(b, today) {
    if (b.state === 'cancelled') return { kind: 'bad', text: 'Cancelled' };
    if (b.state === 'pending') return { kind: 'warn', text: 'Waiting for decision' };
    if (b.state === 'confirmed') return { kind: 'ok', text: b.checkout <= today ? 'Completed' : 'Confirmed' };
    return { kind: 'warn', text: 'Status unknown' };
  }
  function paymentText(b) {
    if (b.calOnly || b.paid === null) return 'Not on file';
    if (b.kind === 'airbnb') return (b.paid ? 'Paid through Airbnb' : 'Guest payment not reported') + (b.payout === 'recorded' ? '; payout received ' + fmtDate(b.payoutDate, 'long') : b.payout === 'expected' ? '; payout expected' : '');
    if (b.state === 'cancelled') return 'Not applicable';
    return b.paid ? (b.state === 'pending' ? 'Receipt uploaded, waiting for review' : 'Reservation fee received') : 'Reservation fee not recorded yet';
  }
  function companions(b) { return b.pax == null ? null : Math.max(0, b.pax - 1); }
  // [label, value] pairs for the detail sheet; money rows only when allowed
  function detailRows(b, money, today) {
    var rows = [['Dates', fmtDate(b.checkin, 'weekday') + ' to ' + fmtDate(b.checkout, 'weekday') + ' · ' + b.nights + (b.nights === 1 ? ' night' : ' nights')], ['Source', sourceLabel(b)], ['Status', statusOf(b, today).text]];
    if (money && b.pax != null) rows.push(['Guests', b.pax + (b.pax === 1 ? ' guest' : ' guests') + ' · ' + companions(b) + (companions(b) === 1 ? ' companion' : ' companions')]);
    if (money) {
      rows.push(['Payment', paymentText(b)]);
      if (b.amount != null) rows.push([b.kind === 'airbnb' ? 'Guest paid' : 'Total', formatPHP(b.amount)]);
      if (b.due != null) rows.push(['Reservation fee due', formatPHP(b.due)]);
      if (b.code) rows.push(['Code', b.code]);
      if (b.notes) rows.push(['Notes', b.notes]);
    }
    rows.push(['Calendar', b.synced ? 'On the calendar' : 'Not on the calendar']);
    return rows;
  }

  // ---- errors
  function errCode(e) { return e && (e.code || (e.error && e.error.code)) || ''; }
  function errMsg(e) { return String((e && (e.message || (e.error && e.error.message))) || e || ''); }
  function isDenied(e) { return String(errCode(e)) === '42501' || (!!e && (e.status === 401 || e.status === 403)) || /not authori|permission denied/i.test(errMsg(e)); }
  function isOffline(e) { return /failed to fetch|networkerror|network request failed|load failed|timeout|fetch failed/i.test(errMsg(e)) || (!!e && e.status === 0); }

  // ---- demo (no network)
  function demoRows(today) {
    var d = function (n) { return addDays(today, n); };
    return { res: [{ id: 'b-demo-1', confirmation_code: 'DEMOAB1', status: 'confirmed', guest_name: 'Sample Guest A', guest_count: 2, checkin_date: d(-1), checkout_date: d(2), guest_paid: '9000.00', host_payout: '8500.00', payout_date: null },
      { id: 'b-demo-2', confirmation_code: 'DEMOAB2', status: 'confirmed', guest_name: 'Sample Guest B', guest_count: 4, checkin_date: d(-9), checkout_date: d(-6), guest_paid: '12000.00', host_payout: '11000.00', payout_date: d(-5) }],
      inq: [{ id: 'b-demo-3-0000', guest_name: 'Sample Guest C', checkin_date: d(6), checkout_date: d(8), pax: 3, total_amount: '5000.00', deposit_amount: '2500.00', status: 'pending', receipt_image_path: null, notes: 'Sample note' }], cal: [] };
  }

  // ---- mounted instance
  var S = null, gen = 0;
  function online() { try { return !(typeof navigator !== 'undefined' && navigator.onLine === false); } catch (e) { return true; } }
  function pid() { return (S && S.opts.propertyId) || FALLBACK_PROPERTY; }
  function query(table, cols) {
    var q;
    try { q = S.client.from(table).select(cols).eq('property_id', pid()).order('checkin_date', { ascending: false }).limit(500); } catch (e) { return Promise.resolve({ data: null, error: e }); }
    return Promise.resolve(q).then(function (r) { return r || { data: null, error: { message: 'failed to fetch' } }; }, function (e) { return { data: null, error: e || { message: 'failed to fetch' } }; });
  }
  var COLS = {
    res: 'id, confirmation_code, status, guest_name, guest_count, checkin_date, checkout_date, guest_paid, host_payout, payout_date',
    inq: 'id, guest_name, checkin_date, checkout_date, pax, total_amount, deposit_amount, status, receipt_image_path, notes',
    cal: 'id, uid, source, checkin_date, checkout_date, guest_name, status, linked_reservation_id'
  };
  var TABLE = { res: 'airbnb_reservations', inq: 'booking_inquiries', cal: 'calendar_events' };
  function load(force) {
    var L = S.load; if (L.busy) return; if (L.ok && !force) return;
    L.busy = true; L.err = ''; L.denied = false; var g = S.gen; S.today = manilaToday(); draw();
    var done = function (rows, errs) {
      if (!S || S.gen !== g) return; L.busy = false;
      var bad = errs.filter(Boolean), good = errs.length - bad.length;
      if (bad.length && !good) { if (bad.every(isDenied)) L.denied = true; else L.err = bad.some(isOffline) ? 'No connection.' : 'Bookings could not be loaded.'; L.ok = false; }
      else { L.ok = true; L.partial = bad.length > 0; L.list = buildBookings(rows, S.money); }
      draw();
    };
    if (S.demo) { Promise.resolve().then(function () { done(demoRows(S.today), [null]); }); return; }
    if (!S.client || !online()) { Promise.resolve().then(function () { done({}, [{ message: 'failed to fetch' }]); }); return; }
    var keys = S.money ? ['res', 'inq', 'cal'] : ['cal'];
    Promise.all(keys.map(function (k) { return query(TABLE[k], COLS[k]); })).then(function (rs) {
      var rows = {}, errs = [];
      rs.forEach(function (r, i) { rows[keys[i]] = r.error ? [] : (r.data || []); errs.push(r.error || null); });
      done(rows, errs);
    });
  }

  // ---- views
  function glyph(k) { return k === 'ok' ? '✓' : k === 'warn' ? '!' : k === 'bad' ? '✕' : '•'; }
  function pill(k, t) { return '<span class="B_pill B_' + k + '"><span aria-hidden="true">' + glyph(k) + '</span> ' + esc(t) + '</span>'; }
  function stateBox() {
    var L = S.load;
    if (L.denied) return '<div class="B_note" role="status">Your account is not allowed to see bookings. Ask the owner if you need them.</div>';
    if (L.err) return '<div class="B_err" role="alert"><span>' + esc(L.err) + '</span><button class="btn btn-secondary btn-sm" type="button" data-b="retry">Try again</button></div>';
    if (L.busy || !L.ok) return '<div class="B_note" role="status">Loading…</div>';
    return '';
  }
  function card(b) {
    var st = statusOf(b, S.today), pax = S.money && b.pax != null ? ' · ' + b.pax + (b.pax === 1 ? ' guest' : ' guests') : '';
    return '<button class="B_card B_tap" type="button" data-b="open" data-v="' + esc(b.key) + '" aria-label="' + esc('Open booking for ' + b.guest) + '">' +
      '<span class="B_top"><span class="B_name">' + esc(b.guest) + '</span><span class="B_badge">' + esc(sourceLabel(b)) + '</span></span>' +
      '<span class="B_line">' + esc(fmtDate(b.checkin, 'weekday') + ' to ' + fmtDate(b.checkout, 'weekday') + ' · ' + b.nights + (b.nights === 1 ? ' night' : ' nights') + pax) + '</span>' +
      '<span class="B_top">' + pill(st.kind, st.text) + (S.money && b.amount != null ? '<span class="B_amt">' + esc(formatPHP(b.amount)) + '</span>' : '') + '</span></button>';
  }
  function listHtml() {
    var box = stateBox(); if (box) return box;
    var rows = filterBookings(S.load.list, S.seg, S.q, S.today, S.showCancelled);
    var partial = S.load.partial ? '<div class="B_note" role="status">Some bookings could not be loaded, so this list may be incomplete.</div>' : '';
    if (!rows.length) return partial + '<div class="B_note">' + esc(S.q ? 'No booking matches that name.' : S.seg === 'upcoming' ? 'No upcoming bookings.' : S.seg === 'current' ? 'No guest is staying right now.' : 'No past bookings.') + '</div>';
    return partial + rows.map(card).join('');
  }
  function segHtml() {
    var c = S.load.ok ? counts(S.load.list, S.today, S.q, S.showCancelled) : null;
    return '<div class="B_seg" role="tablist" aria-label="Bookings"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + SEGS.map(function (s) {
      return '<button class="B_tab" type="button" role="tab" id="B_tab_' + s + '" aria-selected="' + (S.seg === s) + '" data-b="seg" data-v="' + s + '">' + SEG_LABEL[s] + (c ? ' <span class="B_cnt">' + c[s] + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function sheetHtml() {
    if (!S.sheet) return '';
    var b = null, l = S.load.list || []; for (var i = 0; i < l.length; i++) if (l[i].key === S.sheet) b = l[i];
    if (!b) return '';
    var st = statusOf(b, S.today);
    var dl = detailRows(b, S.money, S.today).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
    var act = b.kind === 'direct' && b.state === 'pending' && !b.calOnly && S.canDecide ? '<p class="B_p">This request is waiting for a decision.</p><button class="btn btn-primary btn-block" type="button" data-b="inq">Review in Inquiries</button>' : '';
    return '<div class="B_scrim" aria-hidden="true" data-b="close"></div><div class="B_sheet" role="dialog" aria-modal="true" aria-labelledby="B_sh"><div class="B_grab" aria-hidden="true"></div>' +
      '<h2 class="B_h" id="B_sh" tabindex="-1" data-b-focus="1">' + esc(b.guest) + '</h2><div class="B_sub">' + pill(st.kind, st.text) + ' <span class="B_badge">' + esc(sourceLabel(b)) + '</span></div>' +
      '<dl class="B_dl">' + dl + '</dl><div class="B_btns">' + act + '<button class="btn btn-secondary btn-block" type="button" data-b="close">Close</button></div></div>';
  }
  function draw() {
    if (!S) return;
    var inert = S.sheet ? ' inert aria-hidden="true"' : '', ok = S.load.ok;
    S.el.innerHTML = '<div class="B_root"><h2 class="B_h">Bookings</h2>' + segHtml() +
      '<div class="B_tools"' + inert + '><label class="B_lbl" for="B_q">Search by guest name</label><input class="B_input" id="B_q" data-f="q" type="search" value="' + esc(S.q) + '" autocomplete="off">' +
      (ok ? '<button class="B_chip" type="button" data-b="canc" aria-pressed="' + S.showCancelled + '">Show cancelled</button>' : '') + '</div>' +
      '<div class="B_body" role="tabpanel" aria-labelledby="B_tab_' + S.seg + '" data-b-list="1"' + inert + '>' + listHtml() + '</div></div>' + sheetHtml();
    if (S.sheet && S.focus) { try { var h = S.el.querySelector('[data-b-focus]'); if (h && h.focus) h.focus(); } catch (e) { /* no focus in tests */ } S.focus = false; }
  }

  function onClick(ev) {
    if (!S) return; var t = ev.target && ev.target.closest ? ev.target.closest('[data-b]') : null; if (!t) return;
    var a = t.getAttribute('data-b'), v = t.getAttribute('data-v');
    if (a === 'seg') { if (SEGS.indexOf(v) < 0) return; S.seg = v; S.sheet = null; draw(); return; }
    if (a === 'retry') { load(true); return; }
    if (a === 'canc') { S.showCancelled = !S.showCancelled; draw(); return; }
    if (a === 'open') { S.sheet = v; S.focus = true; draw(); return; }
    if (a === 'close') { S.sheet = null; draw(); return; }
    if (a === 'inq') { S.sheet = null; if (S.opts.navigate) S.opts.navigate('#manage/inquiries'); }
  }
  function onInput(ev) {
    if (!S) return; var t = ev.target; if (!t || !t.getAttribute || t.getAttribute('data-f') !== 'q') return;
    S.q = t.value; // redraw only the list so the keyboard stays open
    var l = null; try { l = S.el.querySelector('[data-b-list]'); } catch (e) { l = null; }
    if (l) { l.innerHTML = listHtml(); var sg = S.el.querySelector('.B_seg'); if (sg) sg.outerHTML = segHtml(); } else draw();
  }
  function onKey(ev) { if (S && S.sheet && ev && ev.key === 'Escape') { S.sheet = null; draw(); } }

  function mount(el, opts) {
    opts = opts || {}; if (S) unmount();
    var access = opts.access;
    S = { el: el, opts: opts, client: opts.client, demo: !!opts.demo, money: canSeeMoney(access), canDecide: canDecide(access), gen: ++gen, today: manilaToday(), seg: 'upcoming', q: '', showCancelled: false, sheet: null, focus: false, load: {} };
    S.onClick = onClick; S.onInput = onInput; S.onKey = onKey;
    el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('keydown', onKey);
    draw(); load(true);
  }
  function unmount() {
    if (!S) return;
    try { S.el.removeEventListener('click', S.onClick); S.el.removeEventListener('input', S.onInput); S.el.removeEventListener('keydown', S.onKey); } catch (e) { /* ok */ }
    gen++; S = null;
  }

  var api = { mount: mount, unmount: unmount, _setClock: function (fn) { clock = fn || function () { return Date.now(); }; },
    lib: { buildBookings: buildBookings, segmentOf: segmentOf, filterBookings: filterBookings, counts: counts, statusOf: statusOf, paymentText: paymentText, detailRows: detailRows, sourceLabel: sourceLabel,
      canSeeMoney: canSeeMoney, canDecide: canDecide, companions: companions, manilaToday: manilaToday, formatPHP: formatPHP, fmtDate: fmtDate, esc: esc, isDenied: isDenied, isOffline: isOffline } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.N_BOOKINGS = api;
})();
