/* Cascade Staff - bills (s127; s143 pay form in the Inventory Update skin, with the day paid, the way paid and the period covered on a new server). Two screens opened from Today: pay a bill (#bills/pay/<id>) and edit its details (#bills/edit/<kind>[/<bill id>]).
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
      case 'paid_on_invalid': return 'The day you paid cannot be after today or before the reading date on the bill. Check the two dates.'; // s143
      case 'bad_method': return 'Choose how you paid: GCash, Bank or Cash.'; // s143
      case 'reading_date_required': return 'Enter the meter reading date shown on the bill.'; // s131
      case 'reading_date_invalid': if (/^\d{4}-\d{2}-\d{2}$/.test(String(res.before || ''))) return 'The reading date must be before ' + res.before + ', the reading date of a later bill that is already paid. Check the date on the bill.'; // s131b
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(res.after || ''))) return 'The reading date must be after ' + res.after + ', the reading date of the last bill, and not in the future. Check the date on the bill.'; // s143
        return 'The reading date must be after the last bill’s reading date, no earlier than the month before this bill, and not in the future. Check the date on the bill.';
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
  // s143: methodOk / paidOnOk apply only when the sheet carries them (a new server); an old server's sheet has neither and behaves as before.
  function methodOk(m) { return /^(gcash|bank|cash)$/.test(String(m || '')); }
  function paidOnOk(s) { return dateOk(s.paidOn, s.today) && (!s.meter || !dateOk(s.readDate) || s.paidOn >= s.readDate); }
  function payReady(s) {
    if (!(s && s.file && amountOf(s.amountText) != null && !s.busy && (!s.meter || (dateOk(s.readDate, s.today) && readingOf(s.readVal).ok)))) return false;
    if (s.paidOn !== undefined && !paidOnOk(s)) return false;
    return !s.needMethod || methodOk(s.method);
  }
  // What settle sends. confirmed is true only when this very amount was already shown the "well above or below" message.
  // rd (meter bills only): {date, value}; reading_value is left out when nothing was typed.
  // extra (a new server only): {paid_on, method}. reading_value is never sent from the pay form (the Reading date form owns it).
  function proofPayload(up, amount, confirmedFor, rd, extra) {
    var p = { path: up.path, sha256: up.sha256, amount: amount, confirmed: confirmedFor != null && confirmedFor === amount };
    if (extra) { if (extra.paid_on) p.paid_on = extra.paid_on; if (extra.method) p.method = extra.method; }
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
  // s143 helpers (pure).
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var KIND = { electric: ['Electricity', '⚡'], water: ['Water', '💧'], internet: ['Internet', '🌐'], netflix: ['Subscription', '📺'] };
  var CATEGORY = { electric: 'Utilities', water: 'Utilities', internet: 'Internet', netflix: 'Subscription' }; // the server's category by kind (CONTRACT)
  function shortDay(iso) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? (+m[2]) + ' ' + MON[+m[1] - 1] : ''; }
  // "21 Oct – 21 Nov", "21 Oct – ~21 Nov" when the end is assumed; '' when either end is missing. The shell's CS.rangeLabel is used when it exists.
  function rangeText(from, to, assumed) { var a = shortDay(from), b = shortDay(to); return a && b ? a + ' – ' + (assumed ? '~' : '') + b : ''; }
  function kindWord(b) { return (KIND[b && b.kind] || [String((b && b.label) || 'Bill').split(/[ (]/)[0] || 'Bill'])[0]; }
  function kindEm(b) { return (KIND[b && b.kind] || [0, '🧾'])[1]; }
  // "Water (Gensan Water District)" to "Water · Gensan Water District"
  function subLabel(label) { return String(label || '').replace(/\s*\(([^)]*)\)\s*$/, ' · $1'); }
  // The reading date the sheet starts on: the server's (labelled assumed when it says so), else the old default (the 21st of the billed month); never after today.
  function readPrefill(b, today) {
    var d = b && /^\d{4}-\d{2}-\d{2}$/.test(String(b.reading_date || '')) ? b.reading_date : defaultReadDate(b && b.period, today);
    if (today && d > today) d = today;
    return { date: d, assumed: !!(b && b.reading_date && b.reading_date_assumed === true) };
  }
  function srvNew(d) { return !!(d && d.pay && d.pay.method_default !== undefined); } // the new bill_pay_open_v1 carries pay.method_default; the old one does not
  // The over-band question (outside half to twice the estimate), worked out from the estimate, never from the server's words.
  function overBandCopy(amount, est) {
    var a = Number(amount), e = Number(est);
    if (!(e > 0) || !(a > 0)) return 'Check the amount on the bill, then confirm.';
    if (a > 2 * e) return peso(a) + ' is more than twice the estimate. Check the bill, then confirm.';
    if (a < e / 2) return peso(a) + ' is less than half the estimate. Check the bill, then confirm.';
    return peso(a) + ' is far from the estimate of ' + peso(e) + '. Check the bill, then confirm.';
  }
  function matchesEstimate(amount, est) { return amount != null && Number(est) > 0 && Math.abs(Number(amount) - Number(est)) < 0.005; }
  // Which parts the pay sheet draws: Edit only when the server said can_edit; the rows of Pay to only for what is set.
  function sheetParts(d) {
    var p = (d && d.pay) || {};
    return { edit: !!(d && d.can_edit), name: !!p.payee_name, number: !!p.number, note: !!p.note, editable: p.amount_editable === true };
  }
  var lib = { rangeText: rangeText, kindWord: kindWord, subLabel: subLabel, readPrefill: readPrefill, srvNew: srvNew, overBandCopy: overBandCopy, matchesEstimate: matchesEstimate, methodOk: methodOk, paidOnOk: paidOnOk, CATEGORY: CATEGORY, refusal: refusal, failure: failure, amountOf: amountOf, payReady: payReady, proofPayload: proofPayload, dateOk: dateOk, readingOf: readingOf, defaultReadDate: defaultReadDate, monthName: monthName, changedKeys: changedKeys, sheetParts: sheetParts, UNKNOWN: UNKNOWN };

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
      S.newSrv = srvNew(d); S.readAssumed = false; // s143: the new server also sends the bill's period, reading date (maybe assumed), the day paid and the way paid; the old one draws the old sheet
      if (S.newSrv) { var pre = S.meter ? readPrefill(d.bill, S.today) : { date: '', assumed: false }; S.readDate = pre.date; S.readDate0 = pre.date; S.readAssumed = pre.assumed; S.paidOn = S.today; S.needMethod = true; S.method = methodOk(d.pay.method_default) ? d.pay.method_default : ''; }
      if (S.o.setTitle) S.o.setTitle('Pay ' + d.bill.label); renderPay();
    }));
  }
  function amtHelp(text, est) { return amountOf(text) == null ? BAD_AMOUNT : 'Starts at the estimate, ' + peso(est) + '. Billers often add a PHP 10 fee, so type what the receipt says.'; }
  // s143: the Inventory-style sheet (frame 6) for a new server; an old server keeps the sheet it had.
  var rangeLabel = typeof CS.rangeLabel === 'function' ? CS.rangeLabel : rangeText;
  function estOf(d) { return Number(d.bill.estimate_php) > 0 ? Number(d.bill.estimate_php) : Number(d.pay.amount_php) || 0; }
  function amountNow() { return sheetParts(S.d).editable ? amountOf(S.amountText) : Number(S.d.pay.amount_php); }
  function coversText() { var b = S.d.bill; if (!S.meter || !b.from) return ''; var ok = dateOk(S.readDate); return rangeLabel(b.from, ok ? S.readDate : b.to, ok ? S.readAssumed && S.readDate === S.readDate0 : b.to_assumed === true); }
  function amtHelpNew() { var a = amountOf(S.amountText); return a == null ? BAD_AMOUNT : matchesEstimate(a, estOf(S.d)) ? 'Matches the estimate (' + peso(estOf(S.d)) + ').' : ''; }
  function flowHtml() { var a = amountOf(S.amountText); if (!sheetParts(S.d).editable || a == null || matchesEstimate(a, estOf(S.d))) return ''; return '<div class="I_flow"><div class="I_fn"><b>' + esc(peso(estOf(S.d))) + '</b><small>estimate</small></div><span class="I_farr" aria-hidden="true">→</span><div class="I_fn I_fto"><b>' + esc(peso(a)) + '</b><small>you pay</small></div></div>'; }
  function confirmHtml() { var a = amountNow(); return S.confirmedFor != null && S.confirmedFor === a ? '<div class="MN_row" role="status"><span>ℹ️ ' + esc(overBandCopy(a, S.confirmEst)) + '</span></div>' : ''; }
  function coversHtml() { var c = coversText(); return c ? '<div class="MN_covers">📆 <span>This payment covers <b>' + esc(c) + '</b></span></div>' : ''; }
  function saveLabel() { if (S.busy) return 'Saving…'; var a = amountNow(), w = kindWord(S.d.bill).toLowerCase(); return (S.confirmedFor != null && S.confirmedFor === a ? 'Yes, mark ' + w + ' paid' : 'Mark ' + w + ' paid') + (a == null ? '' : ' · ' + peso(a)); }
  function copyRow(text, act, what) { return '<div class="MN_copy"><span>' + esc(text) + '</span><button class="btn btn-ghost btn-sm" type="button" data-bact="' + act + '" aria-label="Copy the ' + esc(what) + '">Copy</button></div>'; }
  function renderPay() { if (S.newSrv) renderPayNew(); else renderPayOld(); }
  function renderPayNew() {
    var d = S.d, p = d.pay, b = d.bill, parts = sheetParts(d), dis = S.busy ? ' disabled' : '';
    var band = '<div class="I_band"><button class="btn btn-ghost I_bk" type="button" data-bact="cancel" aria-label="Not now, back to Today"' + dis + '><span aria-hidden="true">‹</span></button><div class="I_bandt"><h2 class="hd I_sht" id="BL_t" tabindex="-1">🧾 Pay a bill</h2><p class="I_bsub">' + esc(subLabel(b.label)) + '</p></div><span class="I_bigem" aria-hidden="true">' + kindEm(b) + '</span></div>';
    var to = '<div class="field"><div class="BL_hd"><label class="BL_pl">Pay to' + (parts.name ? ' · ' + esc(p.payee_name) : '') + '</label>' + (parts.name ? '<button class="btn btn-ghost btn-sm" type="button" data-bact="copy-name">Copy name</button>' : '') +
      (parts.edit ? '<a class="BL_edit" href="#bills/edit/' + esc(b.kind) + '/' + esc(b.id) + '" aria-label="' + esc('Edit ' + b.label + ' details') + '">Edit</a>' : '') + '</div>' +
      (parts.number ? copyRow(p.number, 'copy-number', p.number_label || 'number') : '') + (parts.note ? copyRow('Note: ' + p.note, 'copy-note', 'note') : '') +
      (parts.number || parts.note ? '' : '<p class="help">No payment details are saved yet.</p>') + '<span class="help BL_copied" role="status">' + esc(S.copied || '') + '</span></div>';
    var amt = parts.editable ? '<div class="field"><label for="BL_amt">Amount paid</label><div class="input I_money MN_amount"><b aria-hidden="true">₱</b><input id="BL_amt" inputmode="decimal" autocomplete="off" value="' + esc(S.amountText) + '"' + dis + '></div></div>' :
      '<div class="field"><span class="lbl">Amount to pay</span><div class="input I_money MN_amount"><b aria-hidden="true">₱</b><span class="MN_fixed">' + esc(two(Number(p.amount_php) || 0)) + '</span></div></div>';
    var helpRow = '<div class="MN_helprow"><span class="help" id="BL_amthelp">' + esc(parts.editable ? amtHelpNew() : '') + '</span><button class="btn btn-ghost btn-sm" type="button" data-bact="copy-amount">Copy amount</button></div>';
    var asm = S.meter && S.readAssumed && S.readDate === S.readDate0;
    var dates = '<div class="MN_cover MN_stack"><div class="field"><label for="BL_paid">Paid on</label><div class="input"><input id="BL_paid" type="date" max="' + esc(S.today) + '" value="' + esc(S.paidOn) + '"' + dis + '></div></div>' +
      (S.meter ? '<div class="field"><label for="BL_rdate">Reading date on bill' + (asm ? ' (assumed)' : '') + '</label><div class="input"><input id="BL_rdate" type="date" max="' + esc(S.today) + '" value="' + esc(S.readDate) + '"' + dis + '></div>' +
        (asm ? '<p class="help" id="BL_rhelp">Assumed from the usual day. Change it to the date printed on the bill.</p>' : '') + '</div>' : '') + '</div>';
    var how = '<div class="field"><label id="BL_mlbl">How you paid</label><div class="MN_chips" role="group" aria-labelledby="BL_mlbl">' + [['gcash', 'GCash'], ['bank', 'Bank'], ['cash', 'Cash']].map(function (m) { return '<button class="btn btn-secondary I_pk" type="button" data-bact="method" data-v="' + m[0] + '" aria-pressed="' + (S.method === m[0]) + '"' + dis + '>' + m[1] + '</button>'; }).join('') + '</div></div>';
    var shot = '<div class="field"><label>Payment screenshot · <span class="MN_req">required</span></label><div class="MN_photo"><button class="btn btn-secondary" type="button" data-bact="cam"' + dis + '>' + ICON('camera', 's16') + (S.file ? 'Retake' : 'Take a photo') + '</button><button class="btn btn-secondary" type="button" data-bact="pick"' + dis + '>' + ICON('image', 's16') + (S.file ? 'Choose another' : 'Choose a photo') + '</button></div>' +
      '<p class="help">' + esc(S.file ? 'Screenshot added.' : 'Add the screenshot after you have paid. The bill is marked paid only with it.') + '</p></div>';
    var skip = S.askSkip ? box('info', 'Skip ' + b.label + ' for this month? Nothing will be logged.') + '<div class="row-wrap"><button class="btn btn-secondary" type="button" data-bact="skip-yes"' + dis + '>Yes, skip it</button><button class="btn btn-ghost" type="button" data-bact="skip-no">Keep it</button></div>'
      : '<button class="btn btn-ghost btn-sm BL_skip" type="button" data-bact="skip-ask"' + dis + '>Not paying this month</button>';
    var later = '<div class="stack"><button class="btn btn-ghost" type="button" data-bact="cancel" style="width:100%"' + dis + '>Not now</button>' + skip + '</div>';
    draw('<div class="I_sheet MN_page I_uf"><form data-i-form class="I_uform I_hue_cnt" novalidate>' + band + to + amt + helpRow + '<div data-i-flow>' + flowHtml() + '</div><div data-i-confirm>' + confirmHtml() + '</div>' + dates + '<div data-i-covers>' + coversHtml() + '</div>' + how + shot + (S.msg ? box(S.msgKind || 'err', S.msg) : '') +
      '<button class="btn btn-block I_save" type="button" id="BL_done" data-bact="settle"' + (payNow() ? '' : ' disabled') + '>' + esc(saveLabel()) + '</button><p class="help I_sfoot">Locked once paid. A correction needs the admin.</p></form></div>' + later +
      '<input type="file" id="BL_file" accept="image/*" hidden><input type="file" id="BL_cam" accept="image/*" capture="environment" hidden>');
  }
  function renderPayOld() {
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
    draw('<div class="stack">' + amountBox + to + meter + proof + '<button class="btn btn-primary btn-block" type="button" id="BL_done" data-bact="settle"' + (payNow() ? '' : ' disabled') + '>' + ICON('checks') + (S.busy ? 'Saving…' : 'Mark as paid') + '</button>' + later + '</div><input type="file" id="BL_file" accept="image/*" hidden>');
  }
  function settle() {
    var d = S.d, parts = sheetParts(d), amount = parts.editable ? amountOf(S.amountText) : Number(d.pay.amount_php);
    if (S.busy || !payNow()) return;
    // s and file are this sheet and this screenshot: after the upload nothing may be read from S, which can by then be another bill's sheet.
    var s = S, file = S.file, o = S.o; S.busy = true; S.msg = ''; renderPay();
    var up = s.up ? Promise.resolve(s.up) : Promise.resolve().then(function () { return o.upload(file); }).then(function (u) { if (s.file === file) s.up = u; return u; });
    up.then(function (u) { return S === s && s.file === file ? call('bill_pay_settle_v1', { p_bill_id: s.id, p_proof: proofPayload(u, amount, s.confirmedFor, s.meter ? { date: s.readDate, value: s.readVal } : null, s.newSrv ? { paid_on: s.paidOn, method: s.method } : null) }) : { ok: false, reason: 'unknown' }; }, function () { return { ok: false, reason: 'upload' }; }).then(live(function (r) {
      S.busy = false;
      if (r.ok) { if (S.o.haptic) try { S.o.haptic('tap'); } catch (e) { /* no buzz */ } if (S.o.onChange) S.o.onChange(); return stop('Logged as an expense under ' + (S.newSrv ? CATEGORY[S.d.bill.kind] || 'Utilities' : 'Utilities') + '.', 'ok', r.reading_warn === true ? 'The reading on the bill is far from the meter log. Check that it was typed right.' : ''); }
      if (r.reason === 'already_paid' || r.reason === 'not_payer' || r.reason === 'not_found' || r.reason === 'not_authorized') { if (S.o.onChange) S.o.onChange(); return stop(say(r)); }
      if (r.reason === 'confirm_amount') { S.confirmedFor = amount; S.confirmEst = Number(r.estimate_php) > 0 ? Number(r.estimate_php) : S.newSrv ? estOf(S.d) : 0; if (S.newSrv) S.msg = ''; else { S.msgKind = 'info'; S.msg = refusal(r); } return renderPay(); }
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
    else if (a === 'cam') { var cf = S.o.box.querySelector('#BL_cam'); if (cf) cf.click(); }
    else if (a === 'method') { S.method = t.getAttribute('data-v') || ''; var chips = S.o.box.querySelectorAll ? S.o.box.querySelectorAll('[data-bact="method"]') : []; if (!chips.length) renderPay(); else { for (var i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', String(chips[i].getAttribute('data-v') === S.method)); liveUpdate(); } }
    else if (COPY[a]) copy(a);
    else if (a === 'settle') settle(); else if (a === 'cancel') step('bill_pay_cancel_v1', 'Put back on the list.');
    else if (a === 'skip-ask') { S.askSkip = true; renderPay(); } else if (a === 'skip-no') { S.askSkip = false; renderPay(); }
    else if (a === 'skip-yes') step('bill_pay_skip_v1', 'Skipped for this month. Nothing was logged.');
    else if (a === 'save') save();
  }
  // The Mark as paid state from the full sheet state (amount, screenshot, meter reading date): every input handler uses this one.
  function payNow() { return payReady({ file: S.file, amountText: sheetParts(S.d).editable ? S.amountText : String(Number(S.d.pay.amount_php) || 0), busy: S.busy, meter: S.meter, readDate: S.readDate, readVal: S.readVal, today: S.today, paidOn: S.paidOn, method: S.method, needMethod: S.needMethod }); }
  // The button, and on a new server the help line, the estimate row, the over-band question and the covers line, follow what is typed without a redraw (the keyboard stays up).
  function liveUpdate() {
    var q = function (sel) { return S.o.box.querySelector ? S.o.box.querySelector(sel) : null; }, bt = q('#BL_done');
    if (bt) { bt.disabled = !payNow(); if (S.newSrv && !S.busy) bt.textContent = saveLabel(); }
    if (!S.newSrv) return;
    var h = q('#BL_amthelp'), fl = q('[data-i-flow]'), cf = q('[data-i-confirm]'), cv = q('[data-i-covers]');
    if (h && sheetParts(S.d).editable) h.textContent = amtHelpNew(); if (fl) fl.innerHTML = flowHtml(); if (cf) cf.innerHTML = confirmHtml(); if (cv) cv.innerHTML = coversHtml();
  }
  function onInput(ev) {
    var t = ev.target; if (!S || S.end) return;
    if (t.id === 'BL_amt') { S.amountText = t.value; S.confirmedFor = null; if (!S.newSrv) { var h = S.o.box.querySelector('#BL_amthelp'); if (h) h.textContent = amtHelp(t.value, Number(S.d.pay.amount_php) || 0); } liveUpdate(); }
    else if (t.id === 'BL_rdate' || t.id === 'BL_rval') { if (t.id === 'BL_rdate') S.readDate = t.value; else S.readVal = t.value; liveUpdate(); }
    else if (t.id === 'BL_paid') { S.paidOn = t.value; liveUpdate(); }
    else if (t.getAttribute && t.getAttribute('data-key')) { S.vals[t.getAttribute('data-key')] = t.value; var s = S.o.box.querySelector('#BL_save'); if (s) s.disabled = S.busy || !Object.keys(changedKeys(S.d, S.vals)).length; }
  }
  function onChange(ev) { var t = ev.target; if (S && (t.id === 'BL_file' || t.id === 'BL_cam') && t.files && t.files[0]) { S.file = t.files[0]; S.up = null; S.confirmedFor = null; S.msg = ''; renderPay(); } }

  function onSubmit(ev) { if (ev && ev.preventDefault) ev.preventDefault(); if (S && S.mode === 'pay' && S.d && !S.end && S.newSrv) settle(); }
  function mount(el, o) {
    unmount();
    var parts = String(o.sub || '').split('/'), mode = parts[0];
    if (!(mode === 'pay' && parts[1]) && !(mode === 'edit' && /^(electric|water|internet|netflix)$/.test(parts[1] || ''))) { if (o.navigate) o.navigate('#home'); return; }
    S = { g: ++G, o: Object.assign({}, o, { box: el }), mode: mode, id: mode === 'pay' ? parts[1] : '', kind: mode === 'edit' ? parts[1] : '', from: mode === 'edit' ? parts[2] || '' : '', d: null, file: null, up: null, amountText: '', confirmedFor: null, busy: false, msg: '', msgKind: 'err', askSkip: false, end: false, copied: '', vals: {} };
    el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onChange); el.addEventListener('submit', onSubmit); S.el = el;
    if (o.client && o.client.rpc) { if (mode === 'pay') openPay(); else openEdit(); } else stop('Bills need a connection. Open the app again when you have signal.');
  }
  function unmount() { if (S && S.el) { S.el.removeEventListener('click', onClick); S.el.removeEventListener('input', onInput); S.el.removeEventListener('change', onChange); S.el.removeEventListener('submit', onSubmit); } S = null; G++; }
  W.BL_Bills = { mount: mount, unmount: unmount, reset: unmount, lib: lib };
})();
