/* Cascade Staff - money (s143). Two screens: the Log money options (#money) and the Reading date form (#money/reading[/<kind>]).
   The options sheet only sends the person to the right form (bills, expenses, stock, staff pay). The reading form calls bill_reading_set_v1
   twice: once with p_preview = true (nothing is written, the estimate is shown), then to save. The server decides who may; this file only draws what it is told.
   Every refusal is a plain sentence and what was typed stays on screen. */
(function () {
  'use strict';
  var W = window, CS = W.CS, esc = CS.esc, peso = CS.billPeso, ICON = W.ICON;
  var NET = 'That did not go through. Check your connection and try again.';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
  // The date the form starts on: the server's next reading when it is not in the future, else today. assumed is true when it came from the server's guess.
  function readingStart(entry, today) { var n = entry && entry.next_reading; if (dateOk(n) && n <= today) return { date: n, assumed: true }; return { date: today, assumed: false }; }
  // The open bills a person can pay from the picker: can_pay rows, due or being paid, kept in the server's order.
  function payable(payload) { var due = payload && Array.isArray(payload.due) ? payload.due : []; return due.filter(function (b) { return b && b.id && b.can_pay === true; }).map(function (b) { return { id: String(b.id), kind: b.kind, label: String(b.label || b.kind || 'Bill'), due_day: b.due_day, estimate_php: b.estimate_php == null ? null : Number(b.estimate_php), paying_by_name: b.paying_by_name || '' }; }); }
  function billEm(kind) { return { electric: '⚡', water: '💧', internet: '🌐', netflix: '📺' }[kind] || '🧾'; }
  // A refusal (or a network failure) to one plain sentence.
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
      default: return res && res.sentence ? String(res.sentence) : NET;
    }
  }
  // The preview lines under the form: what the saved date would cover and cost.
  function previewLines(r) {
    var out = [], cov = rangeText(r && r.from, r && r.to, false);
    if (cov) out.push({ k: 'This bill covers', v: cov });
    if (r && Number(r.estimate_php) > 0) out.push({ k: 'Estimate', v: '₱' + Math.round(Number(r.estimate_php)).toLocaleString('en-PH') });
    if (r && dateOk(r.next_reading)) out.push({ k: 'Next reading', v: '~' + shortDay(r.next_reading) });
    if (r && r.reading_warn) out.push({ k: 'Check', v: String(r.reading_warn) });
    return out;
  }
  var lib = { dateOk: dateOk, shortDay: shortDay, rangeText: rangeText, kindFromSub: kindFromSub, valueOf: valueOf, readingReady: readingReady, readingPayload: readingPayload, readingStart: readingStart, payable: payable, billEm: billEm, refusal: refusal, previewLines: previewLines };

  // ---------------------------------------------------------------- the screens
  var S = null, G = 0;
  function nav(h) { if (S && S.o.navigate) S.o.navigate(h); }
  function live(fn) { var g = S && S.g; return function () { if (S && S.g === g) return fn.apply(null, arguments); }; }
  function call(name, args) {
    return Promise.resolve().then(function () { return S.o.client.rpc(name, args); }).then(function (r) {
      if (r && r.error) return r.error.code === '55000' && r.error.message ? { ok: false, sentence: String(r.error.message) } : { ok: false, reason: 'unknown' };
      return (r && r.data) || { ok: false, reason: 'unknown' };
    }, function () { return { ok: false, reason: 'unknown' }; });
  }
  function draw(inner) { if (S) S.o.box.innerHTML = '<div class="I_sheet MN_page I_uf">' + inner + '</div>'; }
  function box(kind, text) { var ic = kind === 'ok' ? 'checks' : kind === 'err' ? 'alert' : 'info'; return '<div class="' + kind + 'box" role="' + (kind === 'err' ? 'alert' : 'status') + '">' + ICON(ic) + '<span>' + esc(text) + '</span></div>'; }
  function band(hue, title, sub, em, back) { return '<div class="I_band ' + hue + '"><button class="btn btn-ghost I_bk" type="button" data-mact="' + back + '" aria-label="Back"><span aria-hidden="true">‹</span></button><div class="I_bandt"><h2 class="hd I_sht" id="MN_t" tabindex="-1">' + esc(title) + '</h2><p class="I_bsub">' + esc(sub) + '</p></div><span class="I_bigem" aria-hidden="true">' + em + '</span></div>'; }
  function opt(hue, em, title, sub, act, data) { return '<button class="I_uopt ' + hue + '" type="button" data-mact="' + act + '"' + (data || '') + '><span class="I_uob" aria-hidden="true">' + em + '</span><span class="I_uopt_t"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span><span class="I_chev" aria-hidden="true">›</span></button>'; }

  // Frame 5: Log money
  function renderOptions() {
    draw(band('I_hue_cnt', '＋ Log money', 'What did you pay?', '💰', 'home') +
      '<div class="I_uopts">' + opt('I_hue_cnt', '🧾', 'Pay a bill', 'Electricity, water, internet, Netflix', 'bills') + opt('I_hue_buy', '📦', 'Bought stock', 'Supplies for the house', 'stock') +
      opt('I_hue_use', '🧺', 'Other expense', 'Anything else you paid for', 'other') + opt('I_hue_cnt', '👤', 'Pay staff', 'Cleaning and transport pay', 'staff') + '</div>' +
      '<div class="I_umore"><button class="btn btn-secondary" type="button" data-mact="reading">📆 Reading date</button><button class="btn btn-secondary" type="button" data-mact="all">See all</button></div>');
  }
  function renderBills() {
    var list = S.bills, body;
    if (list == null) body = '<p class="help" role="status">Loading the bills…</p>';
    else if (!list.length) body = box('info', S.billsErr || 'No bills are waiting to be paid right now.');
    else body = '<div class="I_uopts">' + list.map(function (b) { return opt('I_hue_cnt', billEm(b.kind), b.label, (b.estimate_php ? peso(b.estimate_php) + ' · ' : '') + (b.due_day ? 'due the ' + b.due_day + 'th' : 'open') + (b.paying_by_name ? ' · ' + b.paying_by_name + ' is paying' : ''), 'bill', ' data-id="' + esc(b.id) + '"'); }).join('') + '</div>';
    draw(band('I_hue_cnt', '🧾 Pay a bill', 'Pick the bill', '🧾', 'options') + body);
  }
  // Frame 9: Reading date
  function kindChips() { return '<div class="MN_chips" role="group" aria-labelledby="MN_klbl">' + Object.keys(KINDS).map(function (k) { return '<button class="btn btn-secondary I_pk" type="button" data-mact="kind" data-v="' + k + '" aria-pressed="' + (S.kind === k) + '"' + (S.busy ? ' disabled' : '') + '>' + KINDS[k].em + ' ' + KINDS[k].word + '</button>'; }).join('') + '</div>'; }
  function previewHtml() {
    var p = S.preview; if (!p) return '';
    return '<div class="I_flow MN_covers" role="status">' + previewLines(p).map(function (l) { return '<div class="I_fn"><small>' + esc(l.k) + '</small><b>' + esc(l.v) + '</b></div>'; }).join('') + '</div>';
  }
  function saveLabel() { return S.busy ? 'Working…' : S.preview ? 'Save reading date' : 'See the estimate'; }
  function renderReading() {
    var k = S.kind, dis = S.busy ? ' disabled' : '', asm = S.assumed && S.date === S.date0;
    draw('<form data-i-form class="I_uform I_hue_cnt MN_cnt" novalidate>' + band('I_hue_cnt', '📆 Reading date', k ? KINDS[k].word + ' meter' : 'Which meter?', k ? KINDS[k].em : '📆', 'options') +
      '<div class="field"><label id="MN_klbl">Meter</label>' + kindChips() + '</div>' +
      '<div class="field"><label for="MN_date">Reading date on the bill' + (asm ? ' (assumed)' : '') + '</label><div class="input"><input id="MN_date" type="date" max="' + esc(S.today) + '" value="' + esc(S.date) + '"' + dis + '></div>' +
      (asm ? '<p class="help MN_assumed">Assumed from the usual day. Change it to the date printed on the bill.</p>' : '') + '</div>' +
      '<div class="field"><label for="MN_val">Meter reading (optional)</label><div class="input"><input id="MN_val" inputmode="decimal" autocomplete="off" value="' + esc(S.valueText) + '"' + dis + '></div></div>' +
      (S.msg ? box(S.msgKind || 'err', S.msg) : '') + '<div data-i-preview>' + previewHtml() + '</div>' +
      '<button class="btn btn-block I_save" type="button" id="MN_go" data-mact="go"' + (readingReady(snap()) ? '' : ' disabled') + '>' + esc(saveLabel()) + '</button><p class="help I_sfoot">Locked once the bill is paid. A correction needs the admin.</p></form>');
  }
  function snap() { return { kind: S.kind, date: S.date, today: S.today, valueText: S.valueText, busy: S.busy }; }
  function stale() { S.preview = null; S.msg = ''; }
  function sync() { var b = S.o.box.querySelector ? S.o.box.querySelector('#MN_go') : null; if (b) { b.disabled = !readingReady(snap()); b.textContent = saveLabel(); } var p = S.o.box.querySelector ? S.o.box.querySelector('[data-i-preview]') : null; if (p) p.innerHTML = previewHtml(); }

  function go() {
    if (!S || !readingReady(snap())) return;
    var saving = !!S.preview;
    S.busy = true; S.msg = ''; renderReading();
    call('bill_reading_set_v1', readingPayload(S.o.propertyId, S.kind, S.date, S.valueText, !saving)).then(live(function (r) {
      S.busy = false;
      if (!r || r.ok !== true) { S.preview = null; S.msg = refusal(r); S.msgKind = 'err'; return renderReading(); }
      if (!saving) { S.preview = r; return renderReading(); }
      S.end = true; if (S.o.onChange) S.o.onChange(); if (S.o.haptic) S.o.haptic('success');
      var cov = rangeText(r.from, r.to, false);
      draw('<div class="stack">' + box('ok', 'Saved. ' + KINDS[S.kind].word + ' now runs ' + (cov || 'to the new date') + (Number(r.estimate_php) > 0 ? ', about ₱' + Math.round(Number(r.estimate_php)).toLocaleString('en-PH') : '') + '.') + '</div><div class="sticky"><button class="btn btn-primary btn-block" type="button" data-mact="home">Back to Today</button></div>');
      if (S.o.toast) S.o.toast('Reading date saved');
    }));
  }
  function loadBills() {
    call('today_bills_v1', { p_property_id: S.o.propertyId }).then(live(function (d) { S.bills = d && d.ok !== false ? payable(d) : []; if (d && d.ok === false) S.billsErr = 'The bills could not be loaded. Check your connection and try again.'; if (S.view === 'bills') renderBills(); }));
  }
  function loadStart() {
    call('today_bills_v1', { p_property_id: S.o.propertyId }).then(live(function (d) {
      if (S.edited || !S.kind || !d || d.ok === false) return;
      var st = readingStart(d[S.kind], S.today); S.date = S.date0 = st.date; S.assumed = st.assumed; if (S.view === 'reading') renderReading();
    }));
  }
  function show(view, kind) {
    S.view = view;
    if (view === 'options') { S.end = false; renderOptions(); }
    else if (view === 'bills') { S.bills = S.bills || null; renderBills(); if (S.bills == null) loadBills(); }
    else { S.kind = kind || S.kind || ''; S.date = S.date0 = S.today; S.assumed = false; S.preview = null; S.msg = ''; S.edited = false; renderReading(); if (S.kind) loadStart(); }
  }
  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-mact]') : null; if (!t || !S || (S.busy && t.getAttribute('data-mact') !== 'x')) return;
    var a = t.getAttribute('data-mact');
    if (a === 'home') nav('#home'); else if (a === 'options') { if (S.view === 'options' || S.end) nav('#home'); else { nav('#money'); show('options'); } }
    else if (a === 'bills') show('bills'); else if (a === 'bill') nav('#bills/pay/' + t.getAttribute('data-id'));
    else if (a === 'stock') nav('#stock'); else if (a === 'other') nav('#expenses/other'); else if (a === 'all') nav('#expenses');
    else if (a === 'staff') { if (S.o.payUrl) { if (W.open) W.open(S.o.payUrl, '_blank', 'noopener'); } else nav('#payrates'); }
    else if (a === 'reading') { nav('#money/reading'); show('reading'); }
    else if (a === 'kind') { S.kind = t.getAttribute('data-v') || ''; S.edited = false; stale(); S.date = S.date0 = S.today; S.assumed = false; renderReading(); loadStart(); }
    else if (a === 'go') go();
  }
  function onInput(ev) {
    var t = ev.target; if (!S || S.end) return;
    if (t.id === 'MN_date') { S.date = t.value; S.edited = true; stale(); sync(); } else if (t.id === 'MN_val') { S.valueText = t.value; stale(); sync(); }
  }
  function onSubmit(ev) { if (ev && ev.preventDefault) ev.preventDefault(); if (S && S.view === 'reading') go(); }
  function mount(el, o) {
    unmount();
    var sub = String(o.sub || ''), reading = sub === 'reading' || sub.indexOf('reading/') === 0;
    if (sub && !reading) { if (o.navigate) o.navigate('#money'); sub = ''; }
    S = { g: ++G, o: Object.assign({}, o, { box: el }), view: '', kind: '', date: '', date0: '', assumed: false, valueText: '', today: CS.manilaToday(), preview: null, msg: '', msgKind: 'err', busy: false, end: false, edited: false, bills: null, billsErr: '' };
    el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('submit', onSubmit); S.el = el;
    if (!(o.client && o.client.rpc)) { draw(box('err', 'Money needs a connection. Open the app again when you have signal.')); return; }
    if (reading) show('reading', kindFromSub(sub)); else show('options');
  }
  function unmount() { if (S && S.el) { S.el.removeEventListener('click', onClick); S.el.removeEventListener('input', onInput); S.el.removeEventListener('submit', onSubmit); } S = null; G++; }
  W.MN_Money = { mount: mount, unmount: unmount, reset: unmount, lib: lib };
})();
