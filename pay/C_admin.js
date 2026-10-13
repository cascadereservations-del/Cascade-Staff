/* Cascade Staff - admin "Pay staff" (Lane C, s81). Owner, admin and finance pay a staff payment request from a bank app by QR Ph:
   the payout QR is fetched for ONE open request (staff_pay_payout_qr_v1), the amount is set on this device (C_QrPh), the QR is drawn big enough
   to scan, then the admin adds the payment screenshot and the request is marked PAID by staff_pay_admin_settle_v1 only with that screenshot.
   The payout payload lives in this closure only: never in storage, a cache, the URL, the console or the page text. Leaving the view clears it. */
(function () {
  'use strict';
  var CS = window.CS, P = window.CSPay, A = window.C_PayAdmin, ICON = window.ICON, esc = CS.esc;
  var CFG = { url: 'https://qkgfhsdppslwunarczeq.supabase.co', key: 'sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj', propertyId: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd' };
  var $ = function (id) { return document.getElementById(id); };
  var DEMO = !!(window.CSDemo && window.CSDemo.active);
  var root = $('C_pay_admin');
  var BANK_PAGE = 'bank.html', FIRST_APP = Object.keys(P.BANK_APPS)[0]; // BPI is first in the table; bank.html decides whether it may be offered

  // ?demo: synthetic list and a made-up static payload (a ZZ account that is not a payment), no network, no storage.
  var DEMO_STATIC = (function () {
    var t = function (i, v) { return i + ('0' + v.length).slice(-2) + v; };
    var b = t('00', '01') + t('01', '11') + t('27', t('00', 'com.p2pqrpay') + t('01', 'ZZTESTPHZZZ') + t('02', '99964403') + t('03', '9990000111122223')) + t('52', '6016') + t('53', '608') + t('58', 'PH') + t('59', 'ZZ DEMO PAYEE') + t('60', 'DEMOCITY') + '6304';
    return b + window.C_QrPh.crc16(b);
  })();
  function demoClient() {
    var list = [{ id: 'demo-1', ref: 'DEMO0001', status: 'requested', payee_name: 'Honey', total: 1235, created_at: '2026-10-13T02:00:00Z', has_qr: true, lines: [{ kind: 'clean', date: '2026-10-10', type: 'turnover', amount: 500 }, { kind: 'clean', date: '2026-10-12', type: 'deep_clean', amount: 735 }] },
      { id: 'demo-0', ref: 'DEMO0000', status: 'paid', payee_name: 'Honey', total: 900, created_at: '2026-10-08T02:00:00Z', paid_at: '2026-10-09T04:00:00Z', paid_by_name: 'Marifel', has_qr: true, lines: [] }];
    var unreq = [{ payee_user_id: 'demo-u2', payee_name: 'Marites', has_qr: true, total: 1340, sessions: [{ id: 'demo-us1', date: '2026-10-11', type: 'turnover', base: 500, transport: 100 }, { id: 'demo-us2', date: '2026-10-12', type: 'deep_clean', base: 735, transport: null }], claims: [{ id: 'demo-uc1', date: '2026-10-12', description: 'Trash bags', amount: 105, receipt: true }] }];
    return {
      auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'demo', user: { id: 'demo-me' } } } }); } },
      rpc: function (name, a) {
        if (name === 'staff_pay_admin_list_v1') return Promise.resolve({ data: { ok: true, requests: list, unrequested: unreq }, error: null });
        if (name === 'staff_pay_admin_create_v1') { var u = unreq.splice(0, 1)[0]; list.unshift({ id: 'demo-2', ref: 'DEMO0002', status: 'requested', payee_name: u ? u.payee_name : 'Marites', total: u ? u.total : 0, created_at: '2026-10-13T02:00:00Z', has_qr: true, lines: [] }); return Promise.resolve({ data: { ok: true, id: 'demo-2', ref: 'DEMO0002' }, error: null }); }
        if (name === 'staff_pay_payout_qr_v1') { var q = list.filter(function (x) { return x.id === a.p_request_id; })[0] || list[0]; return Promise.resolve({ data: { ok: true, id: q.id, ref: q.ref, status: 'requested', payee_name: q.payee_name, total: q.total, payout_qrph: DEMO_STATIC }, error: null }); }
        if (name === 'staff_pay_admin_step_v1') return Promise.resolve({ data: { ok: true, status: a.p_step === 'pay' ? 'paying' : 'requested' }, error: null });
        if (name === 'staff_pay_admin_settle_v1') return Promise.resolve({ data: { ok: true, status: 'paid' }, error: null });
        return Promise.resolve({ data: null, error: { code: 'PGRST202' } });
      }
    };
  }
  if (!DEMO && !window.supabase) { root.innerHTML = shell('Pay staff', '<div class="errbox">' + ICON('alert') + '<span>Live information needs a connection. Open the app again when you have signal.</span></div>'); return; }
  var sb = DEMO ? demoClient() : window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  var S = { listNote: '', unreq: null, u: null, K: P.keyKeeper(undefined, null), me: null, listMsg: '', confirmTake: '', sentMarked: false, view: 'list', list: null, loadErr: '', req: null, qr: null, noQr: false, showStatic: false, form: { file: null, amount: '', reference: '', override: false, uploaded: null }, busy: false, msg: '', msgOk: false, copied: '' };

  function shell(title, inner, back) { return P.P_shell(title, inner, { back: back, icon: ICON, esc: esc, hash: P.P_hash(window) }); } // F7: the app's own bar and tab bar, badges from the hash
  P.P_wireBack(window);
  function net() { return (DEMO ? function () { return Promise.resolve({ json: function () { return Promise.resolve({ ok: true, path: 'demo/path', sha256: new Array(65).join('d') }); } }); } : window.fetch).apply(window, arguments); }
  function token() { return sb.auth.getSession().then(function (s) { var t = s.data && s.data.session && s.data.session.access_token; if (!t) throw new Error('signin'); S.me = (s.data.session.user && s.data.session.user.id) || S.me; return t; }); }
  function clearSecrets() { S.qr = null; S.noQr = false; S.showStatic = false; }

  // ---------------------------------------------------------------- list
  function loadList() {
    return token().then(function () { return sb.rpc('staff_pay_admin_list_v1'); }).then(function (res) {
      if (res.error) { S.loadErr = A.isAbsent(res.error) ? 'notready' : /42501|not_authorized/.test(String(res.error.code) + String(res.error.message)) ? 'denied' : 'offline'; return; }
      var d = res.data;
      if (!d || d.ok === false) { S.loadErr = d && d.reason === 'not_authorized' ? 'denied' : 'offline'; return; }
      S.loadErr = ''; S.list = d.requests || [];
      S.unreq = Array.isArray(d.unrequested) ? d.unrequested : null; // P_: absent on the older server, so the NOT YET REQUESTED group is simply not drawn
    }).catch(function (e) { S.loadErr = e && e.message === 'signin' ? 'signin' : 'offline'; });
  }
  // Who may press Pay: a requested row, or a paying row this signed-in person started. Anyone else's (or Telegram's) paying row has no Pay button.
  function theirs(r) { return r.status === 'paying' && !(S.me && r.paying_by_user_id === S.me); }
  function row(r) {
    var st = A.status(r), other = theirs(r), who = r.paying_by_name || 'Someone';
    if (other) {
      return '<div class="rowi C_row" style="cursor:default"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t">' + esc(r.payee_name) + ' · <span class="num">' + esc(P.peso(r.total)) + '</span></span>' +
        '<span class="s num">Ref ' + esc(r.ref) + '</span></span></div>' +
        '<div class="C_rowstatus"><span class="pill p-info">' + ICON('info', 's16') + esc(who) + ' is paying this now.</span>' +
        (r.sent_said_at ? '<p class="help" role="alert">' + esc(who) + ' may already have sent this. Ask ' + esc(who) + ' before doing anything.</p>' :
        S.confirmTake === r.id
          ? '<p class="help" role="alert">Check with ' + esc(who) + ' first. Only one person should send the money.</p><div class="row-wrap"><button class="btn btn-primary btn-sm" type="button" data-act="takeover" data-id="' + esc(r.id) + '">Yes, I am paying it</button><button class="btn btn-ghost btn-sm" type="button" data-act="takecancel">Cancel</button></div>'
          : '<div class="row-wrap"><button class="btn btn-secondary btn-sm" type="button" data-act="takeover-ask" data-id="' + esc(r.id) + '">I am paying it instead</button></div>') + '</div>';
    }
    // the whole card is the button (F15); the status pill sits under it
    return '<button type="button" class="rowi C_row" data-act="pay" data-id="' + esc(r.id) + '"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t">' + esc(r.payee_name) + ' · <span class="num">' + esc(P.peso(r.total)) + '</span></span>' +
      '<span class="s num">Ref ' + esc(r.ref) + (r.created_at ? ' · sent ' + esc(P.shortDate(r.created_at)) : '') + '</span></span><span class="P_go">Pay ›</span></button>' +
      '<div class="C_rowstatus"><span class="pill p-' + st.tone + '">' + ICON(st.glyph, 's16') + esc(st.label) + '</span></div>';
  }
  // PAID RECENTLY: date, ref and who paid. Not tappable: it is a record, so "did I already pay her?" has an answer.
  function paidRow(r) {
    var by = r.paid_by_name || r.paying_by_name;
    return '<div class="rowi C_row" style="cursor:default"><span class="lead">' + ICON('checks') + '</span><span class="mid"><span class="t">' + esc(r.payee_name) + ' · <span class="num">' + esc(P.peso(r.total)) + '</span></span>' +
      '<span class="s num">' + (r.paid_at ? 'Paid ' + esc(P.shortDate(r.paid_at)) + ' · ' : '') + 'Ref ' + esc(r.ref) + (by ? ' · by ' + esc(by) : '') + '</span></span></div>';
  }
  function unreqRow(u) {
    var n = (u.sessions || []).length, m = (u.claims || []).length, bits = [];
    if (n) bits.push(P.P_plural(n, 'clean'));
    if (m) bits.push(P.P_plural(m, 'expense'));
    return '<button type="button" class="rowi C_row" data-act="unreq" data-id="' + esc(u.payee_user_id) + '"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t">' + esc(u.payee_name) + ' · <span class="num">' + esc(P.peso(u.total)) + '</span></span>' +
      '<span class="s">' + esc(bits.join(' · ')) + ' · not requested yet</span></span><span class="P_go">Review ›</span></button>';
  }
  function group(title, rows) { return '<div class="P_group"><div class="cap up">' + title + '</div><div class="card list">' + rows + '</div></div>'; }
  function renderList() {
    var open = (S.list || []).filter(function (r) { return r.status === 'requested' || r.status === 'paying'; }), paid = (S.list || []).filter(function (r) { return r.status === 'paid'; });
    var un = (S.unreq || []).filter(function (u) { return (u.sessions || []).length + (u.claims || []).length > 0; });
    var inner = '<div class="stack">' + (S.listMsg ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(S.listMsg) + '</span></div>' : '') + (S.listNote ? '<div class="okbox" role="status">' + ICON('checks') + '<span>' + esc(S.listNote) + '</span></div>' : '') +
      (open.length || un.length || paid.length ? (open.length ? group('To pay', open.map(row).join('')) : '') + (un.length ? group('Not yet requested', un.map(unreqRow).join('')) : '') + (paid.length ? group('Paid recently', paid.map(paidRow).join('')) : '')
        : '<div class="card empty"><div class="disc">' + ICON('checks') + '</div><h2 class="hd">Nothing to pay right now</h2><p>Unpaid cleans appear here as soon as a report is sent.</p></div>') + '</div>';
    root.innerHTML = shell('Pay staff', inner);
  }

  // ---------------------------------------------------------------- pay ahead: one staff member's unpaid work that is in no request yet
  function uCands() { return { sessions: S.u.p.sessions || [], claims: S.u.p.claims || [] }; }
  function openUnreq(uid) {
    var p = (S.unreq || []).filter(function (x) { return x.payee_user_id === uid; })[0]; if (!p) return;
    var sel = { sessions: {}, claims: {}, extras: [] };
    (p.sessions || []).forEach(function (s) { sel.sessions[s.id] = { on: true, transport: false }; });
    (p.claims || []).forEach(function (c) { sel.claims[c.id] = true; });
    S.listMsg = ''; S.listNote = ''; S.u = { p: p, sel: sel, busy: false, msg: '' }; S.view = 'unreq'; renderUnreq();
  }
  function renderUnreq() {
    var U = S.u, p = U.p, c = uCands(), total = P.computeTotal(c, U.sel), lines = P.lineCount(c, U.sel), over = lines > P.MAX_LINES;
    var cleans = (p.sessions || []).map(function (s) {
      var st = U.sel.sessions[s.id] || { on: false, transport: false }, amt = P.sessionAmount(s, st.on && st.transport);
      var opt = s.transport != null ? '<div class="opt"><button class="sw P_tr" type="button" role="switch" aria-checked="' + !!st.transport + '" aria-label="' + esc('Add ' + P.peso(s.transport) + ' transport for ' + P.dateLabel(s.date)) + '" data-act="u-sw" data-id="' + esc(s.id) + '"><span>Transport +' + esc(P.peso(s.transport)) + '</span><i aria-hidden="true"></i></button></div>' : '';
      return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!st.on + '" aria-label="' + esc(P.dateLabel(s.date) + ' clean') + '" data-act="u-ses" data-id="' + esc(s.id) + '">' + ICON('check', 's16') + '</button>' +
        '<div><div class="t"><span>' + esc(P.dateLabel(s.date) + ' · ' + P.typeLabel(s.type)) + '</span><span class="val">' + esc(P.peso(amt)) + '</span></div><span class="s">Base ' + esc(P.peso(s.base)) + '</span>' + opt + '</div></div>';
    }).join('');
    var claims = (p.claims || []).map(function (x) {
      return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!U.sel.claims[x.id] + '" aria-label="' + esc(x.description) + '" data-act="u-clm" data-id="' + esc(x.id) + '">' + ICON('check', 's16') + '</button>' +
        '<div><div class="t"><span>' + esc(x.description) + '</span><span class="val">' + esc(P.peso(x.amount)) + '</span></div><span class="s">Expense · ' + esc(P.shortDate(x.date)) + (x.receipt ? ' · receipt saved' : '') + '</span></div></div>';
    }).join('');
    var inner = '<div class="stack"><p class="help P_sub">' + esc(p.payee_name) + ' has not asked for this yet. Tick what you want to pay now.</p>' +
      '<div class="P_group"><div class="cap up">Unpaid work</div><div class="card list">' + cleans + claims + '</div></div>' +
      (p.has_qr === false ? '<div class="infobox">' + ICON('info') + '<span>' + esc(p.payee_name) + ' has not saved a payout QR yet. You can still pay her usual account and add the screenshot.</span></div>' : '') +
      (over ? '<div class="errbox">' + ICON('alert') + '<span>A request holds up to ' + P.MAX_LINES + ' lines. Untick some and pay the rest next.</span></div>' : '') +
      (U.msg ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(U.msg) + '</span></div>' : '') + '</div>' +
      '<div class="sticky"><div class="total"><span class="cap up">Total to pay</span><span class="amt num">' + esc(P.peso(total)) + '</span></div>' +
      '<button class="btn btn-primary btn-block" type="button" data-act="u-pay"' + (total > 0 && !over && !U.busy ? '' : ' disabled') + '>' + ICON('cash') + (U.busy ? 'Making the request…' : 'Pay now') + '</button></div>';
    root.innerHTML = shell('Pay ' + p.payee_name, inner, '#back');
  }
  function createRequest() {
    var U = S.u; if (!U || U.busy) return;
    var c = uCands(), ch = P.chosen(c, U.sel); if (!ch.sessions.length && !ch.claims.length) return;
    var key = S.K.forSelection(c, U.sel); U.busy = true; U.msg = ''; renderUnreq();
    token().then(function () {
      return sb.rpc('staff_pay_admin_create_v1', { p_payee_user_id: U.p.payee_user_id, p_sessions: ch.sessions.map(function (x) { return { id: x.s.id, transport: x.transport }; }), p_claim_ids: ch.claims.map(function (x) { return x.id; }), p_idempotency_key: key });
    }).then(function (res) {
      U.busy = false; var d = res.data, left = S.u !== U || S.view !== 'unreq'; // left: the view was closed while the call was in flight, so this answer only refreshes the list
      if (res.error || !d) {
        if (left) return loadList().then(render);
        U.msg = A.isAbsent(res.error) ? 'Paying ahead is not switched on yet. Ask Lloyd.' : res.error && (/42501|not_authorized/.test(String(res.error.code) + String(res.error.message)) || res.error.status === 403) ? A.refusal({ reason: 'not_authorized' }) : A.refusal({ reason: 'offline' }); return renderUnreq();
      }
      if (d.ok === false) {
        if (left) return loadList().then(render);
        if (d.reason === 'session_taken' || d.reason === 'claim_taken') { S.view = 'list'; S.listMsg = A.refusal(d); S.listNote = ''; return loadList().then(render); }
        U.msg = A.refusal(d); return renderUnreq();
      }
      S.K.settle(d);
      return loadList().then(function () { // straight on into the normal Pay flow for the new request
        if (S.u !== U || S.view !== 'unreq') return render(); // left meanwhile: the request exists, the list shows it, nothing is opened
        if (!S.loadErr && (S.list || []).some(function (x) { return x.id === d.id; })) return openPay(d.id);
        S.view = 'list'; S.listMsg = ''; S.listNote = 'Request ' + (d.ref || '') + ' was made. Open it from To pay.'; render();
      });
    }).catch(function (e) { U.busy = false; if (S.u !== U || S.view !== 'unreq') return loadList().then(render); U.msg = e && e.message === 'signin' ? 'Sign in to the Staff app first.' : A.refusal({ reason: 'offline' }); renderUnreq(); });
  }

  // ---------------------------------------------------------------- pay one request
  var payTok = 0; // each openPay call owns the screen until another starts: a late answer from an older call is dropped
  function openPay(id) {
    var tok = ++payTok, live = function () { return tok === payTok; };
    var r = (S.list || []).filter(function (x) { return x.id === id; })[0]; if (!r || theirs(r)) return;
    S.listMsg = ''; S.listNote = ''; S.req = r; S.view = 'pay'; S.msg = ''; S.copied = ''; S.form = { file: null, amount: String(A.copyAmount(r.total)), reference: '', override: false, uploaded: null }; clearSecrets();
    root.innerHTML = shell('Pay ' + r.payee_name, '<div class="skel" style="height:320px;margin-top:16px"></div>', '#back');
    // Claim the payment FIRST. If the server says someone else has it, nothing is drawn: no QR, no Mark as paid.
    function backToList(res) { if (!live()) return; S.listNote = ''; S.listMsg = A.refusal(res); S.view = 'list'; clearSecrets(); return loadList().then(render); }
    return sb.rpc('staff_pay_admin_step_v1', { p_request_id: id, p_step: 'pay' }).then(function (s) {
      var d = s.data; if (!live()) return;
      if (s.error || !d || d.ok === false) return backToList(d || { reason: 'offline' });
      r.status = 'paying'; r.paying_by_user_id = d.paying_by_user_id || S.me; S.sentMarked = !!r.sent_said_at; redrawCard(id);
      return sb.rpc('staff_pay_payout_qr_v1', { p_request_id: id }).then(function (res) {
        var q = res.data; if (!live()) { if (q) q.payout_qrph = null; return; }
        if (res.error || !q || q.ok === false) return backToList(q || { reason: A.isAbsent(res.error) ? 'unknown' : 'offline' });
        if (q.payout_qrph) { try { S.qr = A.qrs(q.payout_qrph, q.total); S.qr.total = q.total; } catch (e) { S.qr = null; S.noQr = true; S.msg = 'The saved QR could not be read, so use the account you usually pay.'; } }
        else S.noQr = true;
        q.payout_qrph = null; // not kept on the response either
        renderPay();
      });
    }).catch(function () { if (!live()) return; S.msg = A.refusal({ reason: 'offline' }); renderPay(); });
  }
  // From the first Save QR, Open bank app, Copy amount or picked screenshot the money may be on its way: say so to the server once, so a take-over or a
  // Telegram cancel is refused from then on. The payer can still step back with "I have not sent it".
  function markSent() {
    if (!S.req || S.sentMarked) return;
    S.sentMarked = true;
    sb.rpc('staff_pay_admin_step_v1', { p_request_id: S.req.id, p_step: 'sent' }).then(function (s) {
      var d = s.data;
      if (s.error || !d || d.ok === false) { S.sentMarked = false; if (d && (d.reason === 'not_yours' || d.reason === 'not_paying')) { S.msg = A.refusal(d); S.msgOk = false; renderPay(); } return; }
      S.req.sent_said_at = S.req.sent_said_at || 'now'; renderPay();
    }, function () { S.sentMarked = false; });
  }
  // Keep the Telegram Finance card in step (it names the Staff-app payer and drops the buttons, or gets them back). Best effort, never blocks the screen.
  function redrawCard(id) {
    if (DEMO) return;
    token().then(function (tok) { return net(CFG.url + '/functions/v1/notify-cleaner-payment', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'card', request_id: id }) }); }).catch(function () {});
  }
  function takeOver(id) {
    S.confirmTake = '';
    return sb.rpc('staff_pay_admin_step_v1', { p_request_id: id, p_step: 'takeover' }).then(function (s) {
      var d = s.data;
      if (s.error || !d || d.ok === false) { S.listMsg = A.refusal(d || { reason: 'offline' }); return loadList().then(render); }
      var r = (S.list || []).filter(function (x) { return x.id === id; })[0]; if (r) { r.paying_by_user_id = S.me; r.status = 'paying'; }
      S.listMsg = ''; return openPay(id);
    }).catch(function () { S.listMsg = A.refusal({ reason: 'offline' }); render(); });
  }
  function bankLink() { return BANK_PAGE + '?app=' + encodeURIComponent(FIRST_APP); }
  function renderPay() {
    var r = S.req, total = Number(r.total);
    var amountBlock = '<div class="C_amountbox"><div class="cap up">Amount to pay ' + esc(r.payee_name) + '</div><div class="C_amount num">' + esc(P.peso(total)) + '</div>' +
      '<button class="btn btn-secondary btn-sm" type="button" data-act="copyamt">' + ICON('clip', 's16') + 'Copy amount</button><span class="help" role="status">' + esc(S.copied) + '</span></div>';
    var qrBlock = S.qr
      ? '<div class="C_qrbox"><div class="C_qrframe">' + (S.showStatic ? S.qr.staticSvg : S.qr.dynamicSvg) + '</div><p class="help" style="text-align:center">' +
        (S.showStatic ? 'This QR has no amount. Type ' + esc(P.peso(total)) + ' in your bank app.' : 'Scan with your bank app. The amount is already set.') + '</p></div>' +
        '<div class="row-wrap C_actions">' + (S.showStatic ? '' : '<button class="btn btn-secondary" type="button" data-act="saveqr">' + ICON('share', 's16') + 'Save QR to phone</button>') +
        '<a class="btn btn-secondary" data-act="bank" href="' + esc(bankLink()) + '" target="_blank" rel="noopener">' + ICON('bank', 's16') + 'Open bank app</a></div>' +
        '<p class="help">Pay in your bank app with the QR saved to your gallery, then delete the QR photo from your phone.</p>' +
        '<details class="C_fallback"><summary>If your bank ignores the amount</summary><div class="stack">' +
        '<p class="help">Some banks scan the QR but leave the amount empty. Use the QR with no amount and type the amount yourself.</p>' +
        '<button class="btn btn-secondary" type="button" data-act="togglestatic">' + (S.showStatic ? 'Show the QR with the amount' : 'Show the QR without an amount') + '</button>' +
        '<div class="C_amountbox"><div class="C_amount num">' + esc(P.peso(total)) + '</div><button class="btn btn-secondary btn-sm" type="button" data-act="copyamt">' + ICON('clip', 's16') + 'Copy amount</button>' +
        '<button class="btn btn-secondary btn-sm" type="button" data-act="copyref">' + ICON('clip', 's16') + 'Copy reference</button></div></div></details>'
      : '<div class="infobox">' + ICON('info') + '<span>' + (S.noQr ? esc(r.payee_name) + '\'s payout QR is not saved yet. Pay her usual account for the amount above, then add the screenshot.' : esc(S.msg || 'The QR could not be loaded. Go back and try again.')) + '</span></div>' +
        '<div class="row-wrap C_actions"><a class="btn btn-secondary" data-act="bank" href="' + esc(bankLink()) + '" target="_blank" rel="noopener">' + ICON('bank', 's16') + 'Open bank app</a>' +
        '<button class="btn btn-secondary btn-sm" type="button" data-act="copyref">' + ICON('clip', 's16') + 'Copy reference</button></div>';
    var f = S.form;
    var proof = '<div class="card"><div class="cap up">After you have paid</div><p class="help" style="margin:6px 0 10px">Add the payment screenshot. The request is marked paid only with it.</p>' +
      '<div class="row-wrap"><button class="btn btn-secondary" type="button" data-act="pickfile">' + ICON('camera', 's16') + (f.file ? 'Change screenshot' : 'Add the screenshot') + '</button>' + (f.file ? '<span class="help">' + esc(f.file.name || 'screenshot') + '</span>' : '') + '</div>' +
      '<div class="field"><label for="C_amt">Amount shown in the screenshot</label><div class="input"><span>PHP</span><input id="C_amt" inputmode="decimal" value="' + esc(f.amount) + '"></div></div>' +
      '<div class="field"><label for="C_ref">Reference number from the screenshot</label><div class="input"><input id="C_ref" autocomplete="off" autocapitalize="characters" value="' + esc(f.reference) + '" placeholder="Reference"></div></div>' +
      (f.override ? '<label class="C_check"><input type="checkbox" id="C_ovr"' + (f.override === 'on' ? ' checked' : '') + '> The amount in the screenshot is right</label>' : '') +
      (S.msg ? '<div class="' + (S.msgOk ? 'okbox' : 'errbox') + '" role="alert">' + ICON(S.msgOk ? 'checks' : 'alert') + '<span>' + esc(S.msg) + '</span></div>' : '') + '</div>';
    var inner = '<div class="stack">' + amountBlock + qrBlock + proof + '</div>' +
      '<div class="sticky"><button class="btn btn-primary btn-block" type="button" id="C_done" data-act="settle"' + (A.ready(f) && !S.busy ? '' : ' disabled') + '>' + ICON('checks') + (S.busy ? 'Saving…' : 'Mark as paid') + '</button>' +
      (S.sentMarked ? '<p class="help" id="C_sentnote" role="status">Marked as sent, so nobody else can take this over. If you have not sent it, tap I have not sent it.</p>' : '') +
      '<button class="btn btn-ghost" type="button" data-act="unpay" style="width:100%"' + (S.busy ? ' disabled' : '') + '>' + (S.sentMarked ? 'I have not sent it' : 'I am not paying this now') + '</button></div>' +
      '<input type="file" id="C_file" accept="image/*" hidden>';
    root.innerHTML = shell('Pay ' + r.payee_name, inner, '#back');
  }
  function renderDone() {
    clearSecrets();
    var r = S.req, f = S.form, amt = Number(String(f.amount).replace(/,/g, '')), ref = A.reference(f.reference);
    root.innerHTML = shell('Paid', '<div class="stack"><div class="okbox" role="status">' + ICON('checks') + '<span>Marked paid. ' + esc(r.payee_name) + ' is told by message, in Telegram and in the app.</span></div>' +
      '<div><div class="cap up" style="margin-bottom:6px">What was recorded</div><div class="card P_rec">' +
      '<div class="row"><span>Paid to</span><b>' + esc(r.payee_name) + '</b></div><div class="row"><span>Amount</span><b>' + esc(P.peso(amt)) + '</b></div>' +
      '<div class="row"><span>Request</span><b>' + esc(r.ref) + '</b></div><div class="row"><span>Bank reference</span><b>' + esc(ref) + '</b></div><div class="row"><span>Screenshot</span><b>Saved</b></div></div>' +
      '<p class="help" style="margin-top:8px">The phone alert says a payment was sent and never shows the amount.</p></div></div>' +
      '<div class="sticky"><button class="btn btn-primary btn-block" type="button" data-act="tolist">Back to the list</button></div>', '#back');
  }

  // ---------------------------------------------------------------- screenshot, upload, settle
  function toJpegBlob(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(u);
        var z = P.fitSize(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'); cv.width = z.w; cv.height = z.h;
        cv.getContext('2d').drawImage(img, 0, 0, z.w, z.h);
        cv.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); };
      img.src = u;
    });
  }
  function uploadProof(file, tok) {
    if (S.form.uploaded) return Promise.resolve(S.form.uploaded);
    var key = P.newKey();
    return toJpegBlob(file).then(function (blob) {
      return blob.arrayBuffer().then(function (buf) { return A.sha256Hex(buf).then(function (sha) {
        return net(CFG.url + '/functions/v1/upload-photo', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key, 'Content-Type': 'image/jpeg', 'x-cascade-file-name': 'payment-proof.jpg', 'x-cascade-property-id': CFG.propertyId, 'x-cascade-submission-id': key }, body: blob })
          .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok || !j.path) throw new Error('upload'); if (!j.sha256) throw new Error('nosha'); S.form.uploaded = { path: j.path, sha256: j.sha256 }; return S.form.uploaded; });
      }); });
    });
  }
  // F_: one short buzz after a successful settle (silent no-op where vibration is missing or switched off; nothing stored in demo)
  function F_tap() { try { CS.E_buzz('tap', { navigator: navigator, storage: window.CSDemo && window.CSDemo.active ? null : window.localStorage, doc: document }); } catch (e) {} }
  function settle() {
    if (S.busy || !A.ready(S.form)) return;
    S.busy = true; S.msg = ''; renderPay();
    token().then(function (tok) {
      return uploadProof(S.form.file, tok).then(function (up) {
        return sb.rpc('staff_pay_admin_settle_v1', { p_request_id: S.req.id, p_proof: A.proof(up.path, up.sha256, S.form.amount, S.form.reference, S.form.override === 'on') }).then(function (res) {
          S.busy = false;
          var d = res.data;
          if (res.error || !d) { S.msg = A.refusal({ reason: 'offline' }); S.msgOk = false; return renderPay(); }
          if (d.ok) { S.view = 'done'; F_tap(); notifyPaid(tok, S.req.id); return renderDone(); }
          if (d.reason === 'amount_mismatch') S.form.override = S.form.override || 'ask';
          if (d.reason === 'no_stored_proof') S.form.uploaded = null;
          S.msg = A.refusal(d); S.msgOk = false; renderPay();
        });
      });
    }).catch(function (e) { S.busy = false; S.msg = e && e.message === 'nosha' ? 'Pay staff is not fully switched on yet. Ask Lloyd.' : 'The screenshot could not be sent, so nothing was marked paid. Add it again.'; S.msgOk = false; renderPay(); });
  }
  // The database trigger already asks for the notice; this second ask is harmless (the notice is claimed once) and covers a trigger that cannot reach the function.
  function notifyPaid(tok, id) {
    if (DEMO) return;
    net(CFG.url + '/functions/v1/notify-cleaner-payment', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'paid', request_id: id }) }).catch(function () {});
  }

  // ---------------------------------------------------------------- small actions
  function copy(text, label) {
    function done() { S.copied = label + ' copied'; var h = root.querySelectorAll('.help[role="status"]'); for (var i = 0; i < h.length; i++) h[i].textContent = S.copied; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { S.copied = 'Copy did not work. Type it in.'; });
    else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { /* the amount is on screen to type */ } document.body.removeChild(t); }
  }
  function saveQr() {
    if (!S.qr) return;
    var cv = document.createElement('canvas'); S.qr.dynamicPng(cv);
    cv.toBlob(function (blob) {
      if (!blob) return;
      var file = new File([blob], 'cascade-pay-' + S.req.ref + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file] }).catch(function () {}); return; }
      var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(u); }, 10000);
    }, 'image/png');
  }
  function unpay() {
    var id = S.req.id;
    clearSecrets();
    var go = function () { S.view = 'list'; return loadList().then(renderList); };
    if (S.req.status === 'paying') return sb.rpc('staff_pay_admin_step_v1', { p_request_id: id, p_step: 'not_sent' }).then(function (s) { if (s.data && s.data.ok === false) S.listMsg = A.refusal(s.data); else redrawCard(id); return go(); }, go);
    return go();
  }

  root.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'C_amt') S.form.amount = t.value; else if (t.id === 'C_ref') S.form.reference = t.value; else if (t.id === 'C_ovr') S.form.override = t.checked ? 'on' : 'ask'; else return;
    var b = $('C_done'); if (b) b.disabled = !(A.ready(S.form) && !S.busy);
  });
  root.addEventListener('change', function (ev) {
    if (ev.target.id === 'C_file' && ev.target.files && ev.target.files[0]) { S.form.file = ev.target.files[0]; S.form.uploaded = null; markSent(); renderPay(); }
  });
  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (a === 'pay') openPay(t.getAttribute('data-id'));
    else if (a === 'unreq') openUnreq(t.getAttribute('data-id'))
    else if (a === 'u-ses') { var us = S.u.sel.sessions[t.getAttribute('data-id')]; us.on = !us.on; renderUnreq(); }
    else if (a === 'u-sw') { var uw = S.u.sel.sessions[t.getAttribute('data-id')]; uw.transport = !uw.transport; renderUnreq(); }
    else if (a === 'u-clm') { var uc = t.getAttribute('data-id'); S.u.sel.claims[uc] = !S.u.sel.claims[uc]; renderUnreq(); }
    else if (a === 'u-pay') createRequest();
    else if (a === 'takeover-ask') { S.confirmTake = t.getAttribute('data-id'); renderList(); }
    else if (a === 'takecancel') { S.confirmTake = ''; renderList(); }
    else if (a === 'takeover') takeOver(t.getAttribute('data-id'));
    else if (a === 'copyamt') { markSent(); copy(A.copyAmount(S.req.total), 'Amount'); }
    else if (a === 'bank') markSent();
    else if (a === 'copyref') copy('CASCADE-' + S.req.ref, 'Reference');
    else if (a === 'saveqr') { markSent(); saveQr(); }
    else if (a === 'togglestatic') { S.showStatic = !S.showStatic; renderPay(); }
    else if (a === 'pickfile') { var f = $('C_file'); if (f) f.click(); }
    else if (a === 'settle') settle();
    else if (a === 'unpay') unpay();
    else if (a === 'tolist') { S.view = 'list'; S.loadErr = ''; S.list = null; render(); loadList().then(render); }
    else if (a === 'retry') { S.loadErr = ''; S.list = null; render(); loadList().then(render); }
  });
  root.addEventListener('click', function (ev) { // the app bar Back inside a pay view returns to the list, not out of the page
    var b = ev.target.closest('.appbar a'); if (b && S.view !== 'list') { ev.preventDefault(); if (S.u && S.u.busy && S.view === 'unreq') return; /* the request is being made: stay until it answers */ clearSecrets(); S.view = 'list'; loadList().then(render); }
  });
  window.addEventListener('pagehide', function () { clearSecrets(); S.form = { file: null, amount: '', reference: '', override: false, uploaded: null }; root.innerHTML = ''; });

  function render() {
    if (S.loadErr) {
      var msg = { signin: 'Sign in to the Staff app first, then open Pay staff.', denied: 'Paying staff is for the owner, admin and finance.', notready: 'Pay staff is not switched on yet. Ask Lloyd.', offline: 'No connection.' }[S.loadErr];
      root.innerHTML = shell('Pay staff', '<div class="errbox">' + ICON('alert') + '<span>' + esc(msg) + '</span></div>' + (S.loadErr === 'signin' ? '<a class="btn btn-primary btn-block" href="../#signin" style="margin-top:12px">Sign in</a>' : S.loadErr === 'offline' ? '<button class="btn btn-secondary" type="button" data-act="retry" style="margin-top:12px">Try again</button>' : ''));
      return;
    }
    if (!S.list) { root.innerHTML = shell('Pay staff', '<div class="stack" style="margin-top:16px"><div class="skel" style="height:96px"></div><div class="skel" style="height:96px"></div></div>'); return; }
    if (S.view === 'list') renderList(); else if (S.view === 'unreq' && S.u) renderUnreq();
  }
  render();
  loadList().then(render);
})();
