/* Cascade Staff - money (s143). Two screens: the Log money options (#money) and the Reading date form (#money/reading[/<kind>]).
   The options sheet only sends the person to the right form (bills, expenses, stock, staff pay). The reading form runs bill_reading_set_v1 with p_preview = true by itself
   whenever the meter and the date are good (nothing is written, the estimate is shown), and the save bar then saves. The server decides who may; this file only draws what it is told.
   Every refusal is a plain sentence and what was typed stays on screen. Mounted by the shell: window.MN_Money.mount(el, { client, propertyId, sub, navigate, toast, haptic, onChange, payUrl }). */
(function () {
  'use strict';
  var W = window, CS = W.CS, esc = CS.esc, peso = CS.billPeso, ICON = W.ICON;
  var NET = 'That did not go through. Check your connection and try again.';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WARN = 'The reading is far from the meter log. Check that it was typed right.';
  var KINDS = { electric: { word: 'Electricity', em: '⚡' }, water: { word: 'Water', em: '💧' } };

  // ---------------------------------------------------------------- pure helpers (MN_Money.lib)
  function dateOk(d, today) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(Date.parse(d + 'T00:00:00Z')).toISOString().slice(0, 10) === d && (!today || d <= today); }
  function shortDay(iso) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? (+m[2]) + ' ' + MON[+m[1] - 1] : ''; }
  // "21 Nov – 19 Dec" ("~19 Dec" when the end is assumed); '' when either end is missing
  function rangeText(from, to, assumed) { var a = shortDay(from), b = shortDay(to); return a && b ? a + ' – ' + (assumed ? '~' : '') + b : ''; }
  function kindFromSub(sub) { var p = String(sub || '').split('/'); return p[0] === 'reading' && KINDS[p[1]] ? p[1] : ''; }
  // The reading value is optional: blank is fine, otherwise a number from 0 to 9,999,999 (up to two decimals).
  function valueOf(text) { var t = String(text == null ? '' : text).trim().replace(/,/g, ''); if (t === '') return { ok: true, value: null }; if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, value: null }; var n = Number(t); return n >= 0 && n <= 9999999 ? { ok: true, value: n } : { ok: false, value: null }; }
  function readingReady(s) { return !!(s && KINDS[s.kind] && dateOk(s.date, s.today) && valueOf(s.valueText).ok && !s.busy); }
  function readingPayload(propertyId, kind, date, valueText, preview) { return { p_property_id: propertyId, p_kind: kind, p_reading_date: date, p_reading_value: valueOf(valueText).value, p_preview: !!preview }; }
  // The date the form starts on, for one meter's entry of today_bills_v1:
  //  1. the open bill's end date is only assumed (last_bill.to_assumed, or cycle_from_assumed on a payload with no last bill): start on it, labelled assumed;
  //  2. else the server's next reading when it is not in the future (assumed);
  //  3. else today. A date in the future is never offered.
  function readingStart(entry, today) {
    var lb = entry && entry.last_bill;
    if (lb && lb.to_assumed === true && lb.status !== 'paid' && dateOk(lb.to, today)) return { date: lb.to, assumed: true };
    if (!lb && entry && entry.cycle_from_assumed === true && dateOk(entry.cycle_from, today)) return { date: entry.cycle_from, assumed: true };
    var n = entry && entry.next_reading; if (dateOk(n, today)) return { date: n, assumed: true };
    return { date: today, assumed: false };
  }
  // The last reading date for a meter tile: the bill's start when its end is only assumed, else its end; the cycle start when there is no last bill. '' when unknown.
  function lastReading(entry) {
    var lb = entry && entry.last_bill;
    if (lb) { var d = lb.to_assumed === true ? lb.from : lb.to; if (dateOk(d)) return d; }
    return entry && entry.cycle_from_assumed !== true && dateOk(entry.cycle_from) ? entry.cycle_from : '';
  }
  function ordinal(n) { n = Math.floor(Number(n)); if (!(n > 0)) return ''; var t = n % 100, s = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); return n + s; }
  // The open bills a person can pay from the picker: can_pay rows, due or being paid, kept in the server's order.
  function payable(payload) { var due = payload && Array.isArray(payload.due) ? payload.due : []; return due.filter(function (b) { return b && b.id && b.can_pay === true; }).map(function (b) { return { id: String(b.id), kind: b.kind, label: String(b.label || b.kind || 'Bill'), due_day: b.due_day, estimate_php: b.estimate_php == null ? null : Number(b.estimate_php), paying_by_name: b.paying_by_name || '' }; }); }
  function billEm(kind) { return { electric: '⚡', water: '💧', internet: '🌐', netflix: '📺' }[kind] || '🧾'; }
  var BILLWORD = { electric: 'Electricity', water: 'Water', internet: 'Internet', netflix: 'Subscription' };
  // "Electricity, Internet, Subscription due" for the Pay a bill row; '' when none
  function dueWords(list) { var seen = {}, out = []; (list || []).forEach(function (b) { var w = BILLWORD[b.kind] || String(b.label || 'Bill').split(/[ (]/)[0]; if (!seen[w]) { seen[w] = 1; out.push(w); } }); return out.length ? out.join(', ') + ' due' : ''; }
  // "₱7,010 so far · 3 bills to pay"; a part that is not known yet is left out
  function heroLine(total, count) {
    var out = []; if (total != null && isFinite(Number(total))) out.push('₱' + Math.round(Number(total)).toLocaleString('en-PH') + ' so far');
    if (count != null) out.push(count === 0 ? 'no bills to pay' : count + (count === 1 ? ' bill' : ' bills') + ' to pay');
    return out.join(' · ');
  }
  // A refusal (or a network failure) to one plain sentence. Every date is "d Mon".
  function refusal(res) {
    var r = res && res.reason;
    switch (r) {
      case 'not_authorized': return 'Setting reading dates is for the owner, admin and finance.';
      case 'bad_kind': return 'Choose Electricity or Water.';
      case 'reading_date_invalid':
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(res.after || ''))) return 'The reading date must be after ' + shortDay(res.after) + ', the day of the last reading, and not in the future. Check the date on the bill.';
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(res.before || ''))) return 'The reading date must be before ' + shortDay(res.before) + ', the day of the next reading. Check the date on the bill.';
        return 'That reading date does not fit. Check the date on the bill.';
      case 'reading_value_invalid': return 'The reading looks wrong. Enter the number on the meter, or leave it empty.';
      case 'already_paid': return 'This bill is already paid, so its reading date is locked. A correction needs the admin.';
      case 'older_bill_open': return 'An older bill is still open. Pay or skip it first, then set this reading date.';
      case 'paying_by_other': return 'Someone else is paying this bill now. Set the reading date once they finish.';
      default: return res && res.sentence ? String(res.sentence) : NET;
    }
  }
  // What the preview draws: the covered days, the estimate, and whether to warn (reading_warn is a boolean: only true warns).
  function previewView(r) {
    if (!r || r.ok !== true) return null;
    return { from: shortDay(r.from), to: shortDay(r.to), est: Number(r.estimate_php) > 0 ? '₱' + Math.round(Number(r.estimate_php)).toLocaleString('en-PH') : '', warn: r.reading_warn === true };
  }
  var lib = { dateOk: dateOk, shortDay: shortDay, rangeText: rangeText, kindFromSub: kindFromSub, valueOf: valueOf, readingReady: readingReady, readingPayload: readingPayload, readingStart: readingStart, lastReading: lastReading, ordinal: ordinal, payable: payable, billEm: billEm, dueWords: dueWords, heroLine: heroLine, refusal: refusal, previewView: previewView, WARN: WARN };

  // ---------------------------------------------------------------- the screens
  var S = null, G = 0;
  function nav(h) { if (S && S.o.navigate) S.o.navigate(h); }
  function live(fn) { var g = S && S.g; return function () { if (S && S.g === g) return fn.apply(null, arguments); }; }
  function later(fn, ms) { if (typeof setTimeout === 'function') return setTimeout(fn, ms); fn(); return 0; }
  function call(name, args) {
    return Promise.resolve().then(function () { return S.o.client.rpc(name, args); }).then(function (r) {
      if (r && r.error) return r.error.code === '55000' && r.error.message ? { ok: false, sentence: String(r.error.message) } : { ok: false, reason: 'unknown' };
      return (r && r.data) || { ok: false, reason: 'unknown' };
    }, function () { return { ok: false, reason: 'unknown' }; });
  }
  // The Pay staff page, given by the shell as a function or a string (read the same way E_Expenses reads it). '' when the app has none.
  function payUrl() { try { var u = S && S.o.payUrl; u = typeof u === 'function' ? u() : u; return typeof u === 'string' && u && !/^\s*javascript:/i.test(u) ? u : ''; } catch (e) { return ''; } }
  function draw(inner) { if (S) S.o.box.innerHTML = '<div class="I_sheet MN_page I_uf">' + inner + '</div>'; }
  function box(kind, text) { var ic = kind === 'ok' ? 'checks' : kind === 'err' ? 'alert' : 'info'; return '<div class="' + kind + 'box" role="' + (kind === 'err' ? 'alert' : 'status') + '">' + ICON(ic) + '<span>' + esc(text) + '</span></div>'; }
  function band(hue, title, sub, em, back) { return '<div class="I_band ' + hue + '"><button class="btn btn-ghost I_bk" type="button" data-mact="' + back + '" aria-label="Back"><span aria-hidden="true">‹</span></button><div class="I_bandt"><h2 class="hd I_sht" id="MN_t" tabindex="-1">' + esc(title) + '</h2><p class="I_bsub">' + esc(sub) + '</p></div><span class="I_bigem" aria-hidden="true">' + em + '</span></div>'; }
  // One coloured option row (a button, or a link when href is given); badge is a count, drawn only when it is above zero.
  function opt(hue, em, title, sub, act, data, badge, href) {
    var inner = '<span class="I_uob" aria-hidden="true">' + em + '</span><span class="I_uopt_t"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' + (badge > 0 ? '<span class="MN_cnt" aria-label="' + esc(act === 'staff' ? badge + ' waiting' : 'due ' + badge) + '">' + badge + '</span>' : '') + '<span class="I_chev" aria-hidden="true">›</span>';
    return href ? '<a class="I_uopt ' + hue + '" href="' + esc(href) + '">' + inner + '</a>' : '<button class="I_uopt ' + hue + '" type="button" data-mact="' + act + '"' + (data || '') + '>' + inner + '</button>';
  }

  // Frame 5: Log money. The line under the month fills in as the two reads come back; a read that fails just leaves its part out.
  function renderOptions() {
    var n = S.bills ? S.bills.length : null, month = MONL[+S.today.slice(5, 7) - 1] || '', line = heroLine(S.total, n);
    var payBill = n == null ? 'Pick the bill you are paying' : n === 0 ? 'Nothing is due right now' : dueWords(S.bills);
    draw('<div class="F_sheethead I_sh"><h2 class="hd I_sht" id="MN_t" tabindex="-1">Log money</h2><button class="btn btn-secondary btn-sm F_close" type="button" data-mact="home">✕ Close</button></div>' +
      '<div class="I_hero I_uhero"><span class="I_bigem" aria-hidden="true">₱</span><div class="I_herob"><b class="I_uname">' + esc(month) + '</b><p class="help">' + esc(line || 'What did you pay?') + '</p></div></div>' +
      (S.msg ? box('info', S.msg) : '') +
      '<div class="I_uopts">' + opt('I_hue_cnt', '🧾', 'Pay a bill', payBill, 'bills', '', n || 0) + opt('I_hue_buy', '🛒', 'Bought stock', 'Scan a receipt or pick the item', 'stock') +
      opt('I_hue_use', '💸', 'Other expense', 'Repairs, fees, anything else', 'other') + opt('I_hue_lin', '👤', 'Pay staff', 'Cleaning fees and extras', 'staff', '', Number(S.o.payWait) || 0, payUrl()) + '</div>' +
      '<div class="I_umore"><button class="btn btn-secondary" type="button" data-mact="reading">📅 Reading date</button><button class="btn btn-secondary" type="button" data-mact="all">🕘 See all</button></div>');
  }
  function renderBills() {
    var list = S.bills, body;
    if (list == null) body = S.billsErr ? box('info', S.billsErr) : '<p class="help" role="status">Loading the bills…</p>';
    else if (!list.length) body = box('info', S.billsErr || 'No bills are waiting to be paid right now.');
    else body = '<div class="I_uopts">' + list.map(function (b) { return opt('I_hue_cnt', billEm(b.kind), b.label, (b.estimate_php ? peso(b.estimate_php) + ' · ' : '') + (b.due_day ? 'due the ' + b.due_day + 'th' : 'open') + (b.paying_by_name ? ' · ' + b.paying_by_name + ' is paying' : ''), 'bill', ' data-id="' + esc(b.id) + '"'); }).join('') + '</div>';
    draw(band('I_hue_cnt', '🧾 Pay a bill', 'Pick the bill', '🧾', 'options') + body);
  }
  // Frame 9: Reading date
  function entryOf(k) { return S.bd && S.bd[k] ? S.bd[k] : null; }
  function tiles() {
    return '<div class="I_seg" role="group" aria-label="Meter">' + Object.keys(KINDS).map(function (k) {
      var last = lastReading(entryOf(k));
      return '<button class="I_segb" type="button" data-mact="kind" data-v="' + k + '" aria-pressed="' + (S.kind === k) + '"' + (S.busy ? ' disabled' : '') + '><span aria-hidden="true">' + KINDS[k].em + '</span><b>' + KINDS[k].word + '</b>' + (last ? '<small>last ' + esc(shortDay(last)) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function previewHtml() {
    var v = previewView(S.preview), h = '';
    if (!v) return S.previewing ? '<p class="help" role="status">Checking the estimate…</p>' : '';
    if (v.from && v.to) h += '<div class="I_flow" role="status"><div class="I_fn"><b>' + esc(v.from) + '</b><small>from</small></div><span class="I_farr" aria-hidden="true">→</span><div class="I_fn I_fto"><b>' + esc(v.to) + '</b><small>' + esc('to' + (v.est ? ' · est. ' + v.est : '')) + '</small></div></div>';
    if (v.warn) h += box('info', WARN);
    var nth = ordinal(S.date.slice(8, 10)); if (nth) h += '<div class="I_info">ℹ From now on the app expects the ' + esc(nth) + ' each month, until you set a new date.</div>';
    return h;
  }
  function saveLabel() { return S.busy ? 'Saving…' : dateOk(S.date) ? 'Set ' + shortDay(S.date) + ' as the reading date' : 'Set the reading date'; }
  function canSave() { return !!S.preview && !S.previewing && readingReady(snap()); }
  function renderReading() {
    var k = S.kind, dis = S.busy ? ' disabled' : '', asm = S.assumed && S.date === S.date0;
    draw('<form data-i-form class="I_uform I_hue_cnt MN_form" novalidate>' + band('I_hue_cnt', '📅 Reading date', 'From the paper bill', '📅', 'options') + tiles() +
      '<div class="field"><label for="MN_date">Reading date on the bill' + (asm ? ' (assumed)' : '') + '</label><div class="input"><input id="MN_date" type="date" max="' + esc(S.today) + '" value="' + esc(S.date) + '"' + dis + '></div>' +
      (asm ? '<p class="help MN_assumed">Assumed from the usual day. Change it to the date printed on the bill.</p>' : '') + '</div>' +
      '<div class="field"><label for="MN_val">Present reading (optional)</label><div class="input"><input id="MN_val" inputmode="decimal" autocomplete="off" value="' + esc(S.valueText) + '"' + dis + '>' + (k ? '<span>' + (k === 'water' ? 'm³' : 'kWh') + '</span>' : '') + '</div></div>' +
      (S.msg ? box(S.msgKind || 'err', S.msg) : '') + '<div data-i-preview>' + previewHtml() + '</div>' +
      '<button class="btn btn-block I_save" type="submit" id="MN_go" data-mact="go"' + (canSave() ? '' : ' disabled') + '>' + esc(saveLabel()) + '</button><p class="help I_sfoot">Locked once the bill is paid. A correction needs the admin.</p></form>');
  }
  // Redraw after an answer came back, keeping the cursor where the person left it.
  function redraw() {
    var d = W.document, a = d && d.activeElement, id = a && a.id, s0 = a && a.selectionStart, s1 = a && a.selectionEnd;
    renderReading();
    if (id && S && S.o.box.querySelector) { var n = S.o.box.querySelector('#' + id); if (n && n.focus) { try { n.focus(); if (s0 != null && n.type !== 'date') n.setSelectionRange(s0, s1); } catch (e) { /* no cursor */ } } }
  }
  function snap() { return { kind: S.kind, date: S.date, today: S.today, valueText: S.valueText, busy: S.busy }; }
  function stale() { S.preview = null; S.msg = ''; S.previewing = false; S.seq++; }
  function sync() { var q = S.o.box.querySelector ? S.o.box : null, b = q && q.querySelector('#MN_go'); if (b) { b.disabled = !canSave(); b.textContent = saveLabel(); } var p = q && q.querySelector('[data-i-preview]'); if (p) p.innerHTML = previewHtml(); }

  // The preview runs by itself when the meter and the date are good; nothing is written.
  function autoPreview() {
    if (!S || S.end || !readingReady(snap())) return;
    var seq = ++S.seq; S.previewing = true; S.msg = ''; S.preview = null; sync();
    call('bill_reading_set_v1', readingPayload(S.o.propertyId, S.kind, S.date, S.valueText, true)).then(live(function (r) {
      if (S.seq !== seq) return; S.previewing = false;
      if (!r || r.ok !== true) { S.preview = null; S.msg = refusal(r); S.msgKind = 'err'; } else { S.preview = r; S.msg = ''; }
      redraw();
    }));
  }
  function go() {
    if (!S || !canSave()) return;
    S.busy = true; S.msg = ''; renderReading();
    call('bill_reading_set_v1', readingPayload(S.o.propertyId, S.kind, S.date, S.valueText, false)).then(live(function (r) {
      S.busy = false;
      if (!r || r.ok !== true) { S.preview = null; S.msg = refusal(r); S.msgKind = 'err'; return redraw(); }
      S.end = true; if (S.o.onChange) S.o.onChange(); if (S.o.haptic) S.o.haptic('success');
      var cov = rangeText(r.from, r.to, false);
      draw('<div class="stack">' + box('ok', 'Saved. ' + KINDS[S.kind].word + ' now runs ' + (cov || 'to the new date') + (Number(r.estimate_php) > 0 ? ', about ₱' + Math.round(Number(r.estimate_php)).toLocaleString('en-PH') : '') + '.') + '</div><div class="sticky"><button class="btn btn-primary btn-block" type="button" data-mact="home">Back to Today</button></div>');
      if (S.o.toast) S.o.toast('Reading date saved');
    }));
  }
  // One read of today_bills_v1 serves the options (how many bills), the picker and the reading form (the tiles and the start date).
  function loadBills(done) {
    call('today_bills_v1', { p_property_id: S.o.propertyId }).then(live(function (d) {
      var ok = d && d.ok !== false;
      S.bd = ok ? d : null; S.bills = ok ? payable(d) : null; S.billsErr = ok ? '' : 'The bills could not be loaded. Check your connection and try again.'; S.bdDone = true;
      if (done) done();
    }));
  }
  function loadTotal() {
    call('expenses_screen_v1', { p_property_id: S.o.propertyId, p_month: S.today.slice(0, 7) + '-01', p_limit: 1, p_filter: null }).then(live(function (d) {
      if (d && d.ok !== false && d.total != null && isFinite(Number(d.total))) { S.total = Number(d.total); if (S.view === 'options') renderOptions(); }
    }));
  }
  // Pick the start date for the chosen meter from what was read, then preview it.
  function startFor() {
    if (!S.kind || S.edited) return;
    var st = S.bd ? readingStart(entryOf(S.kind), S.today) : { date: S.today, assumed: false };
    S.date = S.date0 = st.date; S.assumed = st.assumed; S.preview = null; S.msg = '';
    if (S.view === 'reading') { renderReading(); autoPreview(); }
  }
  function show(view, kind) {
    S.view = view;
    if (view === 'options') { S.end = false; S.msg = ''; renderOptions(); if (!S.bdDone) loadBills(function () { if (S.view === 'options') renderOptions(); }); if (S.total == null) loadTotal(); }
    else if (view === 'bills') { renderBills(); if (!S.bdDone) loadBills(function () { if (S.view === 'bills') renderBills(); }); }
    else {
      S.kind = kind || S.kind || ''; S.date = S.date0 = S.today; S.assumed = false; S.preview = null; S.msg = ''; S.edited = false; S.previewing = false; S.seq++; renderReading();
      if (S.bdDone) startFor(); else loadBills(function () { if (S.view === 'reading') { if (S.kind) startFor(); else renderReading(); } });
    }
  }
  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-mact]') : null; if (!t || !S || (S.busy && t.getAttribute('data-mact') !== 'x')) return;
    var a = t.getAttribute('data-mact');
    if (a === 'home') nav('#home'); else if (a === 'options') { if (S.view === 'options' || S.end) nav('#home'); else { nav('#money'); show('options'); } }
    else if (a === 'bills') show('bills'); else if (a === 'bill') nav('#bills/pay/' + t.getAttribute('data-id'));
    else if (a === 'stock') nav('#stock'); else if (a === 'other') nav('#expenses/other'); else if (a === 'all') nav('#expenses');
    else if (a === 'staff') { S.msg = 'Pay staff is not available here right now.'; renderOptions(); } // a button only when the shell has no Pay staff link; never the rate editor
    else if (a === 'reading') { nav('#money/reading'); show('reading'); }
    else if (a === 'kind') { S.kind = t.getAttribute('data-v') || ''; S.edited = false; stale(); S.date = S.date0 = S.today; S.assumed = false; renderReading(); startFor(); }
    else if (a === 'go') go();
  }
  function onInput(ev) {
    var t = ev.target; if (!S || S.end || S.view !== 'reading') return;
    if (t.id === 'MN_date') { S.date = t.value; S.edited = true; stale(); sync(); autoPreview(); }
    else if (t.id === 'MN_val') { S.valueText = t.value; stale(); sync(); if (S.pt && typeof clearTimeout === 'function') clearTimeout(S.pt); S.pt = later(function () { if (S && S.view === 'reading') autoPreview(); }, 400); }
  }
  function onSubmit(ev) { if (ev && ev.preventDefault) ev.preventDefault(); if (S && S.view === 'reading') go(); }
  function mount(el, o) {
    unmount();
    var sub = String(o.sub || ''), reading = sub === 'reading' || sub.indexOf('reading/') === 0;
    if (sub && !reading) { if (o.navigate) o.navigate('#money'); sub = ''; }
    S = { g: ++G, o: Object.assign({}, o, { box: el }), view: '', kind: '', date: '', date0: '', assumed: false, valueText: '', today: CS.manilaToday(), preview: null, previewing: false, seq: 0, msg: '', msgKind: 'err', busy: false, end: false, edited: false, bills: null, bd: null, bdDone: false, billsErr: '', total: null, pt: 0 };
    el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('submit', onSubmit); S.el = el;
    if (!(o.client && o.client.rpc)) { draw(box('err', 'Money needs a connection. Open the app again when you have signal.')); return; }
    if (reading) show('reading', kindFromSub(sub)); else show('options');
  }
  function unmount() { if (S && S.el) { S.el.removeEventListener('click', onClick); S.el.removeEventListener('input', onInput); S.el.removeEventListener('submit', onSubmit); if (S.pt && typeof clearTimeout === 'function') clearTimeout(S.pt); } S = null; G++; }
  W.MN_Money = { mount: mount, unmount: unmount, reset: unmount, lib: lib };
})();
