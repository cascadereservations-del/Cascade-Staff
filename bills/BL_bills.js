/* Cascade Staff - bills (s127). Two screens opened from Today: pay a bill (#bills/pay/<id>) and edit its details (#bills/edit/<kind>[/<bill id>]).
   The server decides who may do what (bill_pay_* needs approve_payment, bill_schedule_* needs manage_staff); this file only draws what it is told.
   Money is logged only by bill_pay_settle_v1, only after a screenshot is added, and a refusal or an unknown answer never says "logged".
   The screenshot upload and the bare-amount helper are the staff pay page's own (CSPay.uploadPhoto via mount option upload, C_PayAdmin.copyAmount). */
(function () {
  'use strict';
  var W = window, CS = W.CS, esc = CS.esc, peso = CS.billPeso, ICON = W.ICON;
  var UNKNOWN = 'This may not be logged yet. Check the card before paying again.'; // network failure, a missing function or a reason this file does not know
  var OPENFAIL = 'This bill could not be opened. Check your connection and try again.', STEPFAIL = 'That did not go through. Check your connection and try again.';
  var BAD_AMOUNT = 'Enter the amount on the receipt, between ₱1 and ₱100,000.'; // 100000 is the server's ceiling (bill_pay_settle_v1)
  var KEYS = ['payee_name', 'number', 'note', 'amount_php', 'remind_day'];

  // ---------------------------------------------------------------- pure helpers (BL_Bills.lib)
  // A refusal to a sentence. ctx: {edit: true} for the Edit screen, {labels: {number: 'GCash number'}} to name a field.
  function refusal(res, ctx) {
    ctx = ctx || {}; var r = res && res.reason, who = String((res && res.name) || '').trim();
    switch (r) {
      case 'not_authorized': return ctx.edit ? 'Editing bill details is for the owner and admin.' : 'Paying bills is for the owner, admin and finance.';
      case 'not_found': return 'This bill is no longer on the list.';
      case 'already_paid': return 'This bill is already logged as paid.';
      case 'paying_by_other': case 'not_payer': return (who || 'Someone else') + ' is paying this now.';
      case 'duplicate_proof': return 'This screenshot was already used for another payment. Add the one for this bill.';
      case 'confirm_amount': {
        var read = Number(res.read), est = Number(res.estimate_php);
        if (res.read == null || res.estimate_php == null || !(est > 0)) return 'Check the amount on the receipt, then tap Mark as paid again to log it.';
        return peso(read) + ' is well ' + (read > est ? 'above' : 'below') + ' the estimate of ' + peso(est) + '. Check the receipt, then tap Mark as paid again to log it.';
      }
      case 'bad_amount': return BAD_AMOUNT;
      case 'reading_date_required': return 'Enter the meter reading date shown on the bill.'; // s131
      case 'reading_date_invalid': return 'The reading date must be after the last bill’s reading date, no earlier than the month before this bill, and not in the future. Check the date on the bill.';
      case 'older_bill_open': return 'Log the older bill of this meter first (pay it or skip it), then this one.'; // s131
      case 'bad_proof': return 'The screenshot or the amount is missing or not valid. Add the screenshot again and check the amount.';
      case 'no_stored_proof': return 'The screenshot did not finish uploading, so nothing was logged. Add it again.';
      case 'sha_mismatch': return 'The screenshot changed after it was uploaded, so nothing was logged. Add it again.';
      case 'no_proof': return 'No screenshot is saved for this bill.';
      case 'bad_kind': return 'This bill is not set up.';
      case 'bad_patch': return 'Nothing was saved. Check the details and try again.';
      case 'bad_key': return 'That detail cannot be changed here.';
      case 'bad_value': return 'Check the ' + (((ctx.labels || {})[res.key]) || 'detail you changed').toLowerCase() + '. It was not accepted.';
      default: return ctx.edit ? 'Nothing was saved. Check your connection and try again.' : ctx.act === 'open' ? OPENFAIL : ctx.act === 'step' ? STEPFAIL : UNKNOWN;
    }
  }
  // A thrown error or an rpc error to an answer {ok:false, reason}. A ledger conflict (SQLSTATE 55000) arrives as a plain sentence and is shown as it is.
  function failure(err) { return err && err.code === '55000' && err.message ? { ok: false, sentence: String(err.message) } : { ok: false, reason: 'unknown' }; }
  // "2,140", "2140.50", "₱2,140" and "2140.5" are amounts; "1,2,3", empty, under ₱1, negatives and more than the server's 100,000 are not.
  function amountOf(text) { var t = String(text == null ? '' : text).replace(/\s/g, '').replace(/^(₱|php)/i, ''); if (!/\d/.test(t) || !/^(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d{1,2})?$/.test(t)) return null; var v = Math.round(parseFloat(t.replace(/,/g, '')) * 100) / 100; return v >= 1 && v <= 100000 ? v : null; }
  // Mark as paid is on only with a screenshot, a good amount and nothing in flight.
  // s131: an electric or water bill (s.meter) also needs the meter reading date on the bill (a real day, not after today); the present reading is optional but must be a number when typed.
  function dateOk(d, today) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(Date.parse(d + 'T00:00:00Z')).toISOString().slice(0, 10) === d && (!today || d <= today); }
  function readingOf(text) { var t = String(text == null ? '' : text).replace(/[\s,]/g, ''); if (t === '') return { ok: true, v: null }; return /^\d{1,7}(?:\.\d{1,2})?$/.test(t) ? { ok: true, v: Number(t) } : { ok: false, v: null }; }
  function payReady(s) { return !!(s && s.file && amountOf(s.amountText) != null && !s.busy && (!s.meter || (dateOk(s.readDate, s.today) && readingOf(s.readVal).ok))); }
  // What settle sends. confirmed is true only when this very amount was already shown the "well above or below" message.
  // rd (meter bills only): {date, value}; reading_value is left out when nothing was typed.
  function proofPayload(up, amount, confirmedFor, rd) {
    var p = { path: up.path, sha256: up.sha256, amount: amount, confirmed: confirmedFor != null && confirmedFor === amount };
    if (rd) { p.reading_date = rd.date; var v = readingOf(rd.value); if (v.ok && v.v != null) p.reading_value = v.v; }
    return p;
  }
  // "2026-11" to "November"
  function monthName(period) { var m = /^(\d{4})-(\d{2})/.exec(String(period || '')); return m ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] || '' : ''; }
  // The date the meter reading is dated by default: the 21st of the billed month, never after today.
  function defaultReadDate(period, today) { var m = /^(\d{4}-\d{2})/.exec(String(period || '')), d = m ? m[1] + '-21' : today; return today && d > today ? today : d; }
  // Only what changed: a text trimmed, a number as a number. Nothing changed gives {}.
  function changedKeys(orig, now) {
    var out = {}; orig = orig || {}; now = now || {};
    KEYS.forEach(function (k) {
      if (!(k in now)) return;
      var a = orig[k], b = now[k];
      if (k === 'amount_php' || k === 'remind_day') { var n = String(b == null ? '' : b).replace(/[,\s]/g, ''); if (n === '' ? a == null : (isFinite(Number(n)) && Number(n) === Number(a))) return; out[k] = n === '' ? null : Number(n); }
      else { var t = String(b == null ? '' : b).trim(); if (t === String(a == null ? '' : a).trim()) return; out[k] = t; }
    });
    return out;
  }
  // Which parts the pay sheet draws: Edit only when the server said can_edit; the rows of Pay to only for what is set.
  function sheetParts(d) {
    var p = (d && d.pay) || {};
    return { edit: !!(d && d.can_edit), name: !!p.payee_name, number: !!p.number, note: !!p.note, editable: p.amount_editable === true };
  }
  var lib = { refusal: refusal, failure: failure, amountOf: amountOf, payReady: payReady, proofPayload: proofPayload, dateOk: dateOk, readingOf: readingOf, defaultReadDate: defaultReadDate, monthName: monthName, changedKeys: changedKeys, sheetParts: sheetParts, UNKNOWN: UNKNOWN };

  // ---------------------------------------------------------------- the screens
  var S = null, G = 0;
  function two(n) { return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function nav(h) { if (S && S.o.navigate) S.o.navigate(h); }
  function back() { nav(S && S.from ? '#bills/pay/' + S.from : '#home'); }
  // o: when the screen is left before the answer comes, the Today card is still refreshed (the sheet is gone; the card is not)
  function live(fn, o) { var g = S && S.g; return function () { if (S && S.g === g) return fn.apply(null, arguments); if (o && o.onChange) o.onChange(); }; }
  function call(name, args) { return Promise.resolve().then(function () { return S.o.client.rpc(name, args); }).then(function (r) { return r && r.error ? failure(r.error) : (r && r.data) || { ok: false, reason: 'unknown' }; }, failure); }
  function say(res, ctx) { return res.sentence || refusal(res, ctx); }

  function draw(inner) { if (S) S.o.box.innerHTML = '<div class="BL_page">' + inner + '</div>'; }
  function box(kind, text) { var ic = kind === 'ok' ? 'checks' : kind === 'err' ? 'alert' : 'info'; return '<div class="' + kind + 'box" role="' + (kind === 'err' ? 'alert' : 'status') + '">' + ICON(ic) + '<span>' + esc(text) + '</span></div>'; }
  function stop(text, kind, extra) { // an end state: one message (and a second, softer one) and the way back to Today
    S.end = true; draw('<div class="stack">' + box(kind || 'err', text) + (extra ? box('info', extra) : '') + '</div><div class="sticky"><button class="btn btn-primary btn-block" type="button" data-bact="home">Back to Today</button></div>');
  }
  function kv(k, v, act, btn) { return '<div class="BL_kv"><span class="cap BL_k">' + esc(k) + '</span><b>' + esc(v) + '</b><button class="btn btn-secondary btn-sm" type="button" data-bact="' + act + '">' + ICON('clip', 's16') + esc(btn) + '</button></div>'; }

  // ---- pay
  function openPay() {
    draw('<div class="skel" style="height:320px;margin-top:16px"></div>');
    call('bill_pay_open_v1', { p_bill_id: S.id }).then(live(function (d) {
      if (!d.ok || !d.bill || !d.pay) { if (d.reason === 'already_paid' && S.o.onChange) S.o.onChange(); return stop(say(d, { act: 'open' })); }
      S.d = d; S.amountText = d.pay.amount_editable ? two(Number(d.pay.amount_php) || 0) : String(Number(d.pay.amount_php) || 0);
      S.meter = d.bill.kind === 'electric' || d.bill.kind === 'water'; S.today = CS.manilaToday(); S.readDate = S.meter ? defaultReadDate(d.bill.period, S.today) : ''; S.readVal = ''; // s131: a meter bill carries its reading date
      if (S.o.setTitle) S.o.setTitle('Pay ' + d.bill.label); renderPay();
    }));
  }
  function amtHelp(text, est) { return amountOf(text) == null ? BAD_AMOUNT : 'Starts at the estimate, ' + peso(est) + '. Billers often add a PHP 10 fee, so type what the receipt says.'; }
  function renderPay() {
    var d = S.d, p = d.pay, b = d.bill, parts = sheetParts(d), est = Number(p.amount_php) || 0;
    var amountBox = '<div class="C_amountbox"><div class="cap up">' + esc(parts.editable ? 'Estimated bill' : 'Amount to pay ' + b.label) + '</div><div class="C_amount num">' + esc(peso(est)) + '</div>' +
      '<button class="btn btn-secondary btn-sm" type="button" data-bact="copy-amount">' + ICON('clip', 's16') + 'Copy amount</button><span class="help BL_copied" role="status">' + esc(S.copied || '') + '</span></div>';
    var rows = (parts.name ? kv('Name', p.payee_name, 'copy-name', 'Copy name') : '') + (parts.number ? kv(p.number_label || 'Account number', p.number, 'copy-number', 'Copy number') : '') + (parts.note ? kv('Note to send', p.note, 'copy-note', 'Copy note') : '');
    var to = '<div class="card"><div class="BL_hd"><div class="cap up">Pay to</div>' + (parts.edit ? '<a class="BL_edit" href="#bills/edit/' + esc(b.kind) + '/' + esc(b.id) + '" aria-label="' + esc('Edit ' + b.label + ' details') + '">Edit</a>' : '') + '</div>' +
      '<div class="stack">' + (rows || '<p class="help" style="margin:0">No payment details are saved yet.</p>') + '</div></div>';
    var shot = S.file ? '<div class="row-wrap BL_shot"><span class="BL_thumb" aria-hidden="true">' + ICON('camera', 's24') + '</span><div class="BL_shotx"><span class="help">Screenshot added</span><button class="btn btn-secondary btn-sm" type="button" data-bact="pick"' + (S.busy ? ' disabled' : '') + '>Change screenshot</button></div></div>'
      : '<div class="row-wrap"><button class="btn btn-secondary" type="button" data-bact="pick">' + ICON('camera', 's16') + 'Add the screenshot</button></div>';
    var meter = S.meter ? '<div class="card"><div class="BL_when"><b>' + esc(b.label + (monthName(b.period) ? ' · ' + monthName(b.period) + ' bill' : '')) + '</b><span class="help BL_est">' + esc('est. ' + peso(est)) + '</span></div><div class="stack" style="margin-top:12px">' +
      '<div class="field"><label for="BL_rdate">Meter reading date on the bill</label><div class="input"><input id="BL_rdate" type="date" max="' + esc(S.today) + '" value="' + esc(S.readDate) + '"' + (S.busy ? ' disabled' : '') + ' aria-describedby="BL_rhelp"></div></div>' +
      '<div class="field"><label for="BL_rval">Present reading on the bill (optional)</label><div class="input"><input id="BL_rval" inputmode="decimal" autocomplete="off" placeholder="' + (b.kind === 'water' ? 'm³' : 'kWh') + '" value="' + esc(S.readVal) + '"' + (S.busy ? ' disabled' : '') + '></div></div>' +
      '<p class="help" id="BL_rhelp" style="margin:0">' + esc('Readings after this date start the next bill. The app warns when the reading is far from the meter log.') + '</p></div></div>' : '';
    var field = parts.editable ? '<div class="field"><label for="BL_amt">Amount on the receipt</label><div class="input"><span>PHP</span><input id="BL_amt" inputmode="decimal" autocomplete="off" value="' + esc(S.amountText) + '"' + (S.busy ? ' disabled' : '') + '></div><p class="help" id="BL_amthelp" style="margin:0">' + esc(amtHelp(S.amountText, est)) + '</p></div>' : '';
    var proof = '<div class="card"><div class="cap up">After you have paid</div><p class="help" style="margin:6px 0 10px">Add the payment screenshot. The bill is marked paid only with it.</p><div class="stack">' + shot + field +
      (S.msg ? box(S.msgKind || 'err', S.msg) : '') + '</div></div>';
    var skip = S.askSkip ? box('info', 'Skip ' + b.label + ' for this month? Nothing will be logged.') + '<div class="row-wrap"><button class="btn btn-secondary" type="button" data-bact="skip-yes"' + (S.busy ? ' disabled' : '') + '>Yes, skip it</button><button class="btn btn-ghost" type="button" data-bact="skip-no">Keep it</button></div>'
      : '<button class="btn btn-ghost btn-sm BL_skip" type="button" data-bact="skip-ask"' + (S.busy ? ' disabled' : '') + '>Not paying this month</button>';
    var later = '<div class="stack"><button class="btn btn-ghost" type="button" data-bact="cancel" style="width:100%"' + (S.busy ? ' disabled' : '') + '>Not now</button>' + skip + '</div>';
    draw('<div class="stack">' + amountBox + to + meter + proof + '<button class="btn btn-primary btn-block" type="button" id="BL_done" data-bact="settle"' + (payReady({ file: S.file, amountText: parts.editable ? S.amountText : String(est), busy: S.busy, meter: S.meter, readDate: S.readDate, readVal: S.readVal, today: S.today }) ? '' : ' disabled') + '>' + ICON('checks') + (S.busy ? 'Saving…' : 'Mark as paid') + '</button>' + later + '</div><input type="file" id="BL_file" accept="image/*" hidden>');
  }
  function settle() {
    var d = S.d, parts = sheetParts(d), amount = parts.editable ? amountOf(S.amountText) : Number(d.pay.amount_php);
    if (S.busy || !payReady({ file: S.file, amountText: parts.editable ? S.amountText : String(amount), busy: false, meter: S.meter, readDate: S.readDate, readVal: S.readVal, today: S.today })) return;
    // s and file are this sheet and this screenshot: after the upload nothing may be read from S, which can by then be another bill's sheet.
    var s = S, file = S.file, o = S.o; S.busy = true; S.msg = ''; renderPay();
    var up = s.up ? Promise.resolve(s.up) : Promise.resolve().then(function () { return o.upload(file); }).then(function (u) { if (s.file === file) s.up = u; return u; });
    up.then(function (u) { return S === s && s.file === file ? call('bill_pay_settle_v1', { p_bill_id: s.id, p_proof: proofPayload(u, amount, s.confirmedFor, s.meter ? { date: s.readDate, value: s.readVal } : null) }) : { ok: false, reason: 'unknown' }; }, function () { return { ok: false, reason: 'upload' }; }).then(live(function (r) {
      S.busy = false;
      if (r.ok) { if (S.o.haptic) try { S.o.haptic('tap'); } catch (e) { /* no buzz */ } if (S.o.onChange) S.o.onChange(); return stop('Logged as an expense under Utilities.', 'ok', r.reading_warn === true ? 'The reading on the bill is far from the meter log. Check that it was typed right.' : ''); }
      if (r.reason === 'already_paid' || r.reason === 'not_payer' || r.reason === 'not_found' || r.reason === 'not_authorized') { if (S.o.onChange) S.o.onChange(); return stop(say(r)); }
      if (r.reason === 'confirm_amount') { S.confirmedFor = amount; S.msgKind = 'info'; S.msg = refusal(r); return renderPay(); }
      if (r.reason === 'duplicate_proof') { S.file = null; S.up = null; S.confirmedFor = null; }
      if (r.reason === 'no_stored_proof' || r.reason === 'sha_mismatch') S.up = null;
      S.msgKind = 'err'; S.msg = r.reason === 'upload' ? 'The screenshot could not be sent, so nothing was logged. Add it again.' : say(r);
      if (S.msg === UNKNOWN && S.o.onChange) S.o.onChange(); // the answer is unknown: show the real state on the card before anyone pays again
      renderPay();
    }, o));
  }
  function step(name, okText) {
    if (S.busy) return; var o = S.o; S.busy = true; S.askSkip = false; S.msg = ''; renderPay();
    call(name, { p_bill_id: S.id }).then(live(function (r) {
      S.busy = false; if (S.o.onChange) S.o.onChange();
      if (r.ok) { if (S.o.toast) S.o.toast(okText); return nav('#home'); }
      stop(say(r, { act: 'step' }));
    }, o));
  }
  var COPY = { 'copy-amount': ['Amount', function () { var C = W.C_PayAdmin, p = S.d.pay; return C && C.copyAmount ? C.copyAmount(sheetParts(S.d).editable && amountOf(S.amountText) ? amountOf(S.amountText) : p.amount_php) : String(p.amount_php); }],
    'copy-name': ['Name', function () { return S.d.pay.payee_name; }], 'copy-number': ['Number', function () { return S.d.pay.number; }], 'copy-note': ['Note', function () { return S.d.pay.note; }] };
  function copy(act) {
    var c = COPY[act], text = c[1](), say1 = function (t) { S.copied = t; var h = S.o.box.querySelectorAll ? S.o.box.querySelectorAll('.BL_copied') : []; for (var i = 0; i < h.length; i++) h[i].textContent = t; };
    var fail = function () { say1('Copy did not work. Press and hold the text to copy it.'); };
    if (W.navigator && W.navigator.clipboard && W.navigator.clipboard.writeText) W.navigator.clipboard.writeText(text).then(function () { say1(c[0] + ' copied'); }, fail); else fail();
  }

  // ---- edit
  var LABELS = { payee_name: 'Payee name', number: 'Number', note: 'Note to send', amount_php: 'Amount each month', remind_day: 'Remind on day' };
  function openEdit() {
    draw('<div class="skel" style="height:320px;margin-top:16px"></div>');
    call('bill_schedule_get_v1', { p_property_id: S.o.propertyId, p_kind: S.kind }).then(live(function (d) {
      if (!d.ok) return stop(say(d, { edit: true }));
      S.d = d; S.vals = { payee_name: d.payee_name, number: d.number, note: d.note, amount_php: d.amount_php, remind_day: d.remind_day };
      if (S.o.setTitle) S.o.setTitle('Edit ' + d.label + ' details'); renderEdit();
    }));
  }
  function fld(id, label, val, mode, pre) { return '<div class="field"><label for="BL_e_' + id + '">' + esc(label) + '</label><div class="input">' + (pre ? '<span>' + pre + '</span>' : '') + '<input id="BL_e_' + id + '" data-key="' + id + '" autocomplete="off"' + (mode ? ' inputmode="' + mode + '"' : '') + ' value="' + esc(val == null ? '' : val) + '"></div></div>'; }
  function renderEdit() {
    var d = S.d, dirty = Object.keys(changedKeys(d, S.vals)).length > 0;
    draw('<div class="stack"><div class="card"><div class="stack">' + fld('payee_name', LABELS.payee_name, S.vals.payee_name) + fld('number', d.number_label || 'Account number', S.vals.number, 'tel') + fld('note', 'Note to send (the month is added for you)', S.vals.note) +
      (d.amount_fixed ? fld('amount_php', LABELS.amount_php, S.vals.amount_php, 'decimal', 'PHP') : '') + fld('remind_day', LABELS.remind_day, S.vals.remind_day, 'numeric') +
      '<p class="help" style="margin:0">Used from the next payment. Payments already logged keep the details used then.</p>' + (S.msg ? box('err', S.msg) : '') + '</div></div></div>' +
      '<div class="sticky"><button class="btn btn-primary btn-block" type="button" id="BL_save" data-bact="save"' + (dirty && !S.busy ? '' : ' disabled') + '>' + (S.busy ? 'Saving…' : 'Save') + '</button><button class="btn btn-ghost" type="button" data-bact="back" style="width:100%">Cancel</button></div>');
  }
  function save() {
    var patch = changedKeys(S.d, S.vals); if (S.busy || !Object.keys(patch).length) return;
    S.busy = true; S.msg = ''; renderEdit();
    var labels = Object.assign({}, LABELS, { number: S.d.number_label || 'Account number' });
    call('bill_schedule_set_v1', { p_property_id: S.o.propertyId, p_kind: S.kind, p_patch: patch }).then(live(function (r) {
      S.busy = false;
      if (r.ok) { if (S.o.toast) S.o.toast('Saved. Used from the next payment.'); return back(); }
      S.msg = say(r, { edit: true, labels: labels }); renderEdit();
    }));
  }

  // ---- mount
  function onClick(ev) {
    var w = S && ev.target.closest ? ev.target.closest('.input') : null; if (w && w.querySelector) { var inp = w.querySelector('input'); if (inp && inp !== ev.target) inp.focus(); } // the whole box focuses its input, the PHP prefix too
    var t = ev.target.closest ? ev.target.closest('[data-bact]') : null; if (!t || !S) return; var a = t.getAttribute('data-bact');
    if (a === 'home') nav('#home'); else if (a === 'back') back();
    else if (a === 'pick') { var f = S.o.box.querySelector('#BL_file'); if (f) f.click(); }
    else if (COPY[a]) copy(a);
    else if (a === 'settle') settle(); else if (a === 'cancel') step('bill_pay_cancel_v1', 'Put back on the list.');
    else if (a === 'skip-ask') { S.askSkip = true; renderPay(); } else if (a === 'skip-no') { S.askSkip = false; renderPay(); }
    else if (a === 'skip-yes') step('bill_pay_skip_v1', 'Skipped for this month. Nothing was logged.');
    else if (a === 'save') save();
  }
  // The Mark as paid state from the full sheet state (amount, screenshot, meter reading date): every input handler uses this one.
  function payNow() { return payReady({ file: S.file, amountText: S.d.pay.amount_editable ? S.amountText : String(Number(S.d.pay.amount_php) || 0), busy: S.busy, meter: S.meter, readDate: S.readDate, readVal: S.readVal, today: S.today }); }
  function onInput(ev) {
    var t = ev.target; if (!S || S.end) return;
    if (t.id === 'BL_amt') { S.amountText = t.value; S.confirmedFor = null; var h = S.o.box.querySelector('#BL_amthelp'); if (h) h.textContent = amtHelp(t.value, Number(S.d.pay.amount_php) || 0); var b = S.o.box.querySelector('#BL_done'); if (b) b.disabled = !payNow(); }
    else if (t.id === 'BL_rdate' || t.id === 'BL_rval') { if (t.id === 'BL_rdate') S.readDate = t.value; else S.readVal = t.value; var rb = S.o.box.querySelector('#BL_done'); if (rb) rb.disabled = !payNow(); }
    else if (t.getAttribute && t.getAttribute('data-key')) { S.vals[t.getAttribute('data-key')] = t.value; var s = S.o.box.querySelector('#BL_save'); if (s) s.disabled = S.busy || !Object.keys(changedKeys(S.d, S.vals)).length; }
  }
  function onChange(ev) { var t = ev.target; if (S && t.id === 'BL_file' && t.files && t.files[0]) { S.file = t.files[0]; S.up = null; S.confirmedFor = null; S.msg = ''; renderPay(); } }

  function mount(el, o) {
    unmount();
    var parts = String(o.sub || '').split('/'), mode = parts[0];
    if (!(mode === 'pay' && parts[1]) && !(mode === 'edit' && /^(electric|water|internet|netflix)$/.test(parts[1] || ''))) { if (o.navigate) o.navigate('#home'); return; }
    S = { g: ++G, o: Object.assign({}, o, { box: el }), mode: mode, id: mode === 'pay' ? parts[1] : '', kind: mode === 'edit' ? parts[1] : '', from: mode === 'edit' ? parts[2] || '' : '', d: null, file: null, up: null, amountText: '', confirmedFor: null, busy: false, msg: '', msgKind: 'err', askSkip: false, end: false, copied: '', vals: {} };
    el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onChange); S.el = el;
    if (o.client && o.client.rpc) { if (mode === 'pay') openPay(); else openEdit(); } else stop('Bills need a connection. Open the app again when you have signal.');
  }
  function unmount() { if (S && S.el) { S.el.removeEventListener('click', onClick); S.el.removeEventListener('input', onInput); S.el.removeEventListener('change', onChange); } S = null; G++; }
  W.BL_Bills = { mount: mount, unmount: unmount, reset: unmount, lib: lib };
})();
