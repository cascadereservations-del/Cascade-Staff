/* Cascade Staff - admin "Pay staff" pure helpers (Lane C, s81). No DOM, no network, no storage, no logging.
   The static payout payload is handled here only to build the payable QR; it is never returned in a string that is rendered as text. */
(function (root, factory) {
  var req = typeof require !== 'undefined' ? require : null;
  var api = factory(root.C_QrPh || (req && req('./C_qrph.js')), root.C_QR || (req && req('./C_qr.js')), root.CSPay || (req && req('./pay-lib.js')));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C_PayAdmin = api;
})(typeof self !== 'undefined' ? self : this, function (QrPh, QR, P) {
  'use strict';

  // The payable QR (amount set, dynamic) and, for the fallback, the static one. Both as SVG markup; the payload strings stay in here.
  function C_qrs(staticPayload, total) {
    var dyn = QrPh.withAmount(staticPayload, total);
    var out = { dynamicSvg: QR.svg(QR.matrix(dyn), { label: 'QR code to pay ' + P.peso(total) }), staticSvg: QR.svg(QR.matrix(staticPayload), { label: 'QR code without an amount' }) };
    out.dynamicPng = function (canvas) { QR.paint(canvas, QR.matrix(dyn), 10, 4); };
    return out;
  }

  // The words for a refused call. Plain sentences, what happened and what to do.
  function C_refusal(res) {
    var r = (res && res.reason) || 'unknown';
    switch (r) {
      case 'not_authorized': return 'Paying staff is for the owner, admin and finance.';
      case 'not_paying': return 'This request is not being paid right now. Open it from the list again.';
      case 'not_open': return res.status === 'paying' ? 'Someone else is already paying this one.' : 'This request is already closed.';
      case 'being_paid': return (res.paying_by_name || 'Someone') + ' is paying this now.';
      case 'not_yours': return 'Only the person who started paying can stop it.';
      case 'not_your_payment': return 'Someone else is paying this one now, so you cannot mark it paid.';
      case 'money_may_be_sent': return 'They have already said the money was sent, so it cannot be taken over. Check with them.';
      case 'proof_already_sent': return 'A screenshot is already on this request, so it stays with you. Add the screenshot and mark it paid.';
      case 'sha_mismatch': return 'The screenshot changed after it was uploaded, so nothing was marked paid. Add it again.';
      case 'not_found': return 'That request no longer exists.';
      case 'bad_proof': return 'The screenshot, the amount or the reference is missing or not valid. Check all three and try again.';
      case 'no_stored_proof': return 'The screenshot did not finish uploading, so nothing was marked paid. Add it again.';
      case 'duplicate_proof': return 'This screenshot or reference was already used for request ' + (res.other_ref || 'another one') + ', so nothing changed. Add the screenshot for this payment.';
      case 'amount_mismatch': return 'The amount you typed (' + P.peso(res.typed) + ') is not the request (' + P.peso(res.total) + '). If the screenshot really shows ' + P.peso(res.typed) + ', tick the box and send again.';
      case 'already_paid': return 'One of the cleans was already paid another way, so nothing was marked paid. Ask Finance to cancel this request.';
      case 'session_taken': case 'claim_taken': return 'One of these was already requested or paid, so nothing was made. The list is refreshed.';
      case 'too_many_lines': return 'A request holds up to ' + P.MAX_LINES + ' lines. Untick some and pay the rest next.';
      case 'self': return 'You cannot pay your own request. Ask another admin.';
      case 'payee_not_allowed': return 'This person is not set up to be paid for cleans.';
      case 'offline': return 'No connection, so nothing was sent. Try again when you have signal.';
      default: return 'Nothing changed (' + r + ').';
    }
  }

  function C_reference(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  // The Mark as paid button is live only when all three are there (the server checks again).
  function C_ready(f) {
    var amt = Math.round(Number(String(f.amount == null ? '' : f.amount).replace(/,/g, '')) * 100) / 100, ref = C_reference(f.reference);
    return !!f.file && amt > 0 && ref.length >= 4 && ref.length <= 64;
  }
  function C_proof(path, sha256, amount, reference, override) {
    var o = { path: path, sha256: sha256, amount: Math.round(Number(String(amount).replace(/,/g, '')) * 100) / 100, reference: C_reference(reference) };
    if (override) o.override = true;
    return o;
  }
  function C_sha256Hex(arrayBuffer, subtle) {
    return (subtle || crypto.subtle).digest('SHA-256', arrayBuffer).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    });
  }
  // What the Copy button puts on the clipboard: the bare amount a bank field accepts.
  function C_copyAmount(total) { var x = Math.round(Number(total) * 100) / 100; return x % 1 === 0 ? String(x) : x.toFixed(2); }

  function C_lineText(l) {
    if (l.kind === 'clean') return P.dateLabel(l.date) + ' · ' + P.typeLabel(l.type) + ' · ' + P.peso(l.amount);
    return String(l.description || 'Expense') + ' · ' + P.peso(l.amount);
  }
  function C_status(r) {
    if (r.status === 'paid') return { label: 'Paid ' + (r.paid_at ? P.shortDate(r.paid_at) : ''), tone: 'ok', glyph: 'checks' };
    if (r.status === 'paying') return { label: 'Being paid' + (r.paying_by_name ? ' by ' + r.paying_by_name : ''), tone: 'info', glyph: 'info' };
    if (r.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral', glyph: 'minus' };
    return { label: 'Waiting for payment', tone: 'warn', glyph: 'clock' };
  }
  function C_isAbsent(err) { return !!err && (err.code === 'PGRST202' || err.status === 404 || /PGRST202|could not find the function/i.test(String(err.message || ''))); }

  return { qrs: C_qrs, refusal: C_refusal, reference: C_reference, ready: C_ready, proof: C_proof, sha256Hex: C_sha256Hex, copyAmount: C_copyAmount, lineText: C_lineText, status: C_status, isAbsent: C_isAbsent };
});
