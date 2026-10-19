/* Cascade Staff - the sentences that tell a staff member she was paid (Lane C, s81). Pure, no DOM, no network.
   The Edge Function has the same sentences (notify-cleaner-payment/paid-text.ts); both are tested against the same golden strings.
   The lock-screen push never carries an amount. Calm, plain, no exclamation marks. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C_PaidText = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function C_dayShort(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? '' : iso));
    return m ? (MON[+m[2] - 1] || m[2]) + ' ' + (+m[3]) : String(iso == null ? '' : iso);
  }
  // A timestamp's day as the house reads it: Manila (UTC+8, no daylight saving).
  function C_manilaDay(iso) {
    var t = Date.parse(iso); if (isNaN(t)) return '';
    return C_dayShort(new Date(t + 8 * 3600 * 1000).toISOString());
  }
  function C_range(from, to) {
    var a = C_dayShort(from), b = C_dayShort(to == null ? from : to);
    if (!a) return '';
    return !b || a === b ? a : a + ' to ' + b;
  }
  function C_php(n) {
    var x = Math.round(Number(n) * 100) / 100;
    return 'PHP ' + (x % 1 === 0 ? x.toFixed(0) : x.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  // The bank's own reference in groups of four; the request ref when the bank gave none.
  function C_reference(n) {
    var r = String(n.bank_reference == null ? '' : n.bank_reference).replace(/[^A-Za-z0-9]/g, '');
    if (r) return r.replace(/(.{4})(?=.)/g, '$1 ');
    return n.ref ? 'CASCADE-' + n.ref : '';
  }
  function C_account(n) { return n.bank_label && String(n.bank_label).trim() ? 'your ' + String(n.bank_label).trim() + ' account' : 'your account'; }

  // s94: "14 Oct" style for the pay-ahead sentences, and the line for a paid-ahead turnover.
  function C_dm(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? '' : iso)); return m ? (+m[3]) + ' ' + (MON[+m[2] - 1] || m[2]) : String(iso == null ? '' : iso); }
  function C_advanceLine(l) { return C_dm(l.date || l.checkout_date) + ' turnover' + (l.guest ? ' - ' + l.guest : '') + ' (paid ahead, report owed)'; }
  function C_list(dates) { var d = dates.map(C_dm); return d.length < 2 ? d.join('') : d.slice(0, -1).join(', ') + ' and ' + d[d.length - 1]; }
  // rows: [{date, status}] (or bare date strings, read as paid). Paid: "You were paid ahead"; a request still waiting is not yet paid, so it only says the report is owed.
  function C_owedText(rows) {
    var paid = [], open = [];
    rows.forEach(function (r) { if (typeof r === 'string') paid.push(r); else (r.status === 'paid' ? paid : open).push(r.date); });
    var out = [];
    if (paid.length) out.push('You were paid ahead for ' + C_list(paid) + '. Please still send the cleaning report for ' + (paid.length === 1 ? 'it' : 'each') + '.');
    if (open.length) out.push('Please send the cleaning report for ' + C_list(open) + '. ' + (open.length === 1 ? 'Its' : 'Their') + ' pay was set up before the report.');
    return out.join(' ');
  }

  var C_PUSH_TITLE = 'Your payment has been sent';
  function C_pushBody(n) {
    var r = C_range(n.date_from, n.date_to);
    return 'Hi ' + n.first_name + ', your pay' + (r ? ' for ' + r : '') + ' is on its way to ' + C_account(n) + '. Open Cascade Staff for the details. Thank you for your care with the house.';
  }
  function C_noticeText(n) {
    var r = C_range(n.date_from, n.date_to), ref = C_reference(n);
    return 'Hi ' + n.first_name + ', we have sent ' + C_php(n.total) + ' to ' + C_account(n) + (r ? ' for your work on ' + r : '') + '.' + (ref ? ' Reference: ' + ref + '.' : '') +
      (n.reports_owed && n.reports_owed.length ? ' Paid ahead - please still send the report for ' + n.reports_owed.map(C_dm).join(', ') + '.' : '') +
      ' Please let us know if anything looks different on your side. Thank you for your care with the house. Marifel & The Cascade Team';
  }
  // The short line on her home: "Paid PHP 1,235 · Oct 15 · ref …5678". The tail is the last four characters of the bank's reference.
  function C_homeLine(n) {
    var ref = String(n.bank_reference == null ? '' : n.bank_reference).replace(/[^A-Za-z0-9]/g, '');
    return 'Paid ' + C_php(n.total) + ' · ' + C_manilaDay(n.paid_at) + (ref ? ' · ref …' + ref.slice(-4) : n.ref ? ' · ref …' + String(n.ref).slice(-4) : '');
  }
  // E_ (streamline pass): the compact card on her home. Title "You were paid ₱1,235", sub "Oct 13 · ref …5678". The amount is her own pay.
  function C_titleLine(n) {
    var x = Math.round(Number(n.total) * 100) / 100;
    return 'You were paid \u20B1' + (x % 1 === 0 ? x.toFixed(0) : x.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function C_subLine(n) {
    var ref = String(n.bank_reference == null ? '' : n.bank_reference).replace(/[^A-Za-z0-9]/g, '');
    return C_manilaDay(n.paid_at) + (ref ? ' \u00B7 ref \u2026' + ref.slice(-4) : n.ref ? ' \u00B7 ref \u2026' + String(n.ref).slice(-4) : '');
  }
  // Requested -> Paying -> Paid. Glyph + word, never colour alone. A cancelled request is its own word, not a step.
  function C_steps(status) {
    if (status === 'cancelled') return { cancelled: true, steps: [] };
    var order = ['requested', 'paying', 'paid'], at = Math.max(0, order.indexOf(status));
    return {
      cancelled: false,
      steps: [{ key: 'requested', label: 'Requested' }, { key: 'paying', label: 'Paying' }, { key: 'paid', label: 'Paid' }]
        .map(function (s, i) { return { key: s.key, label: s.label, state: i < at ? 'done' : i === at ? 'now' : 'next' }; })
    };
  }
  return { dm: C_dm, advanceLine: C_advanceLine, owedText: C_owedText, dayShort: C_dayShort, manilaDay: C_manilaDay, range: C_range, php: C_php, reference: C_reference, pushTitle: C_PUSH_TITLE, pushBody: C_pushBody, noticeText: C_noticeText, homeLine: C_homeLine, titleLine: C_titleLine, subLine: C_subLine, steps: C_steps };
});
