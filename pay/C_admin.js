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
    var list = [{ id: 'demo-1', ref: 'DEMO0001', status: 'requested', payee_name: 'Honey', total: 1235, created_at: '2026-10-13T02:00:00Z', has_qr: true, lines: [{ kind: 'clean', date: '2026-10-10', type: 'turnover', amount: 500 }, { kind: 'clean', date: '2026-10-12', type: 'deep_clean', amount: 735 }] }];
    return {
      auth: { getSession: function () { return Promise.resolve({ data: { session: { access_token: 'demo', user: { id: 'demo-me' } } } }); } },
      rpc: function (name, a) {
        if (name === 'staff_pay_admin_list_v1') return Promise.resolve({ data: { ok: true, requests: list }, error: null });
        if (name === 'staff_pay_payout_qr_v1') return Promise.resolve({ data: { ok: true, id: a.p_request_id, ref: 'DEMO0001', status: 'requested', payee_name: 'Honey', total: 1235, payout_qrph: DEMO_STATIC }, error: null });
        if (name === 'staff_pay_admin_step_v1') return Promise.resolve({ data: { ok: true, status: a.p_step === 'pay' ? 'paying' : 'requested' }, error: null });
        if (name === 'staff_pay_admin_settle_v1') return Promise.resolve({ data: { ok: true, status: 'paid' }, error: null });
        return Promise.resolve({ data: null, error: { code: 'PGRST202' } });
      }
    };
  }
  if (!DEMO && !window.supabase) { root.innerHTML = shell('Pay staff', '<div class="errbox">' + ICON('alert') + '<span>Live information needs a connection. Open the app again when you have signal.</span></div>'); return; }
  var sb = DEMO ? demoClient() : window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  var S = { me: null, listMsg: '', confirmTake: '', sentMarked: false, view: 'list', list: null, loadErr: '', req: null, qr: null, noQr: false, showStatic: false, form: { file: null, amount: '', reference: '', override: false, uploaded: null }, busy: false, msg: '', msgOk: false, copied: '' };

  function shell(title, inner, back) {
    return '<header class="appbar"><a class="iconbtn" href="' + (back || '../#home') + '" aria-label="Back">' + ICON('back', 's24') + '</a><h1 class="ttl">' + esc(title) + '</h1></header><div class="screen">' + inner + '</div>' +
      '<nav class="tabbar" aria-label="Primary"><a class="tab" href="../#home"><span class="ico">' + ICON('house', 's24') + '</span>Today</a><a class="tab" href="../#calendar"><span class="ico">' + ICON('calendar', 's24') + '</span>Calendar</a>' +
      '<a class="tab" href="../#tasks"><span class="ico">' + ICON('tasks', 's24') + '</span>Tasks</a><a class="tab" href="../#more"><span class="ico">' + ICON('more', 's24') + '</span>More</a></nav>';
  }
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
    }).catch(function (e) { S.loadErr = e && e.message === 'signin' ? 'signin' : 'offline'; });
  }
  // Who may press Pay: a requested row, or a paying row this signed-in person started. Anyone else's (or Telegram's) paying row has no Pay button.
  function theirs(r) { return r.status === 'paying' && !(S.me && r.paying_by_user_id === S.me); }
  function row(r) {
    var st = A.status(r), open = (r.status === 'requested' || r.status === 'paying') && !theirs(r), other = theirs(r), who = r.paying_by_name || 'Someone';
    if (other) {
      return '<div class="rowi C_row" style="cursor:default"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t">' + esc(r.payee_name) + ' · <span class="num">' + esc(P.peso(r.total)) + '</span></span>' +
        '<span class="s num">Ref ' + esc(r.ref) + '</span></span></div>' +
        '<div class="C_rowstatus"><span class="pill p-info">' + ICON('info', 's16') + esc(who) + ' is paying this now.</span>' +
        (r.sent_said_at ? '<p class="help" role="alert">' + esc(who) + ' may already have sent this. Ask ' + esc(who) + ' before doing anything.</p>' :
        S.confirmTake === r.id
          ? '<p class="help" role="alert">Check with ' + esc(who) + ' first. Only one person should send the money.</p><div class="row-wrap"><button class="btn btn-primary btn-sm" type="button" data-act="takeover" data-id="' + esc(r.id) + '">Yes, I am paying it</button><button class="btn btn-ghost btn-sm" type="button" data-act="takecancel">Cancel</button></div>'
          : '<div class="row-wrap"><button class="btn btn-secondary btn-sm" type="button" data-act="takeover-ask" data-id="' + esc(r.id) + '">I am paying it instead</button></div>') + '</div>';
    }
    return '<div class="rowi C_row" style="cursor:default"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t">' + esc(r.payee_name) + ' · <span class="num">' + esc(P.peso(r.total)) + '</span></span>' +
      '<span class="s num">Ref ' + esc(r.ref) + (r.created_at ? ' · sent ' + esc(P.shortDate(r.created_at)) : '') + '</span></span>' +
      (open ? '<button class="btn btn-primary btn-sm" type="button" data-act="pay" data-id="' + esc(r.id) + '">Pay</button>' : '<span class="pill p-' + st.tone + '">' + ICON(st.glyph, 's16') + esc(st.label) + '</span>') + '</div>' +
      (open ? '<div class="C_rowstatus"><span class="pill p-' + st.tone + '">' + ICON(st.glyph, 's16') + esc(st.label) + '</span></div>' : '');
  }
  function renderList() {
    var open = (S.list || []).filter(function (r) { return r.status === 'requested' || r.status === 'paying'; }), paid = (S.list || []).filter(function (r) { return r.status === 'paid'; });
    var inner = '<div class="stack">' + (S.listMsg ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(S.listMsg) + '</span></div>' : '') +
      (open.length ? '<div><div class="cap up" style="margin-bottom:6px">Waiting to be paid</div><div class="card list">' + open.map(row).join('') + '</div></div>'
        : '<div class="card empty"><div class="disc">' + ICON('checks') + '</div><h2 class="hd">Nothing to pay</h2><p>Requests from the cleaning team show here.</p></div>') +
      (paid.length ? '<div><div class="cap up" style="margin-bottom:6px">Paid in the last 14 days</div><div class="card list">' + paid.map(row).join('') + '</div></div>' : '') + '</div>';
    root.innerHTML = shell('Pay staff', inner);
  }

  // ---------------------------------------------------------------- pay one request
  function openPay(id) {
    var r = (S.list || []).filter(function (x) { return x.id === id; })[0]; if (!r || theirs(r)) return;
    S.listMsg = ''; S.req = r; S.view = 'pay'; S.msg = ''; S.copied = ''; S.form = { file: null, amount: String(A.copyAmount(r.total)), reference: '', override: false, uploaded: null }; clearSecrets();
    root.innerHTML = shell('Pay ' + r.payee_name, '<div class="skel" style="height:320px;margin-top:16px"></div>', '#back');
    // Claim the payment FIRST. If the server says someone else has it, nothing is drawn: no QR, no Mark as paid.
    function backToList(res) { S.listMsg = A.refusal(res); S.view = 'list'; clearSecrets(); return loadList().then(render); }
    return sb.rpc('staff_pay_admin_step_v1', { p_request_id: id, p_step: 'pay' }).then(function (s) {
      var d = s.data;
      if (s.error || !d || d.ok === false) return backToList(d || { reason: 'offline' });
      S.req.status = 'paying'; S.req.paying_by_user_id = d.paying_by_user_id || S.me; S.sentMarked = !!S.req.sent_said_at; redrawCard(id);
      return sb.rpc('staff_pay_payout_qr_v1', { p_request_id: id }).then(function (res) {
        var q = res.data;
        if (res.error || !q || q.ok === false) return backToList(q || { reason: A.isAbsent(res.error) ? 'unknown' : 'offline' });
        if (q.payout_qrph) { try { S.qr = A.qrs(q.payout_qrph, q.total); S.qr.total = q.total; } catch (e) { S.qr = null; S.noQr = true; S.msg = 'The saved QR could not be read, so use the account you usually pay.'; } }
        else S.noQr = true;
        q.payout_qrph = null; // not kept on the response either
        renderPay();
      });
    }).catch(function () { S.msg = A.refusal({ reason: 'offline' }); renderPay(); });
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
    root.innerHTML = shell('Paid', '<div class="stack"><div class="okbox" role="status">' + ICON('checks') + '<span>Marked paid. ' + esc(S.req.payee_name) + ' is told by message, in Telegram and in the app.</span></div></div>' +
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
  function settle() {
    if (S.busy || !A.ready(S.form)) return;
    S.busy = true; S.msg = ''; renderPay();
    token().then(function (tok) {
      return uploadProof(S.form.file, tok).then(function (up) {
        return sb.rpc('staff_pay_admin_settle_v1', { p_request_id: S.req.id, p_proof: A.proof(up.path, up.sha256, S.form.amount, S.form.reference, S.form.override === 'on') }).then(function (res) {
          S.busy = false;
          var d = res.data;
          if (res.error || !d) { S.msg = A.refusal({ reason: 'offline' }); S.msgOk = false; return renderPay(); }
          if (d.ok) { S.view = 'done'; notifyPaid(tok, S.req.id); return renderDone(); }
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
    var b = ev.target.closest('.appbar a'); if (b && S.view !== 'list') { ev.preventDefault(); clearSecrets(); S.view = 'list'; loadList().then(render); }
  });
  window.addEventListener('pagehide', function () { clearSecrets(); S.form = { file: null, amount: '', reference: '', override: false, uploaded: null }; root.innerHTML = ''; });

  function render() {
    if (S.loadErr) {
      var msg = { signin: 'Sign in to the Staff app first, then open Pay staff.', denied: 'Paying staff is for the owner, admin and finance.', notready: 'Pay staff is not switched on yet. Ask Lloyd.', offline: 'No connection.' }[S.loadErr];
      root.innerHTML = shell('Pay staff', '<div class="errbox">' + ICON('alert') + '<span>' + esc(msg) + '</span></div>' + (S.loadErr === 'signin' ? '<a class="btn btn-primary btn-block" href="../#signin" style="margin-top:12px">Sign in</a>' : S.loadErr === 'offline' ? '<button class="btn btn-secondary" type="button" data-act="retry" style="margin-top:12px">Try again</button>' : ''));
      return;
    }
    if (!S.list) { root.innerHTML = shell('Pay staff', '<div class="stack" style="margin-top:16px"><div class="skel" style="height:96px"></div><div class="skel" style="height:96px"></div></div>'); return; }
    if (S.view === 'list') renderList();
  }
  render();
  loadList().then(render);
})();
