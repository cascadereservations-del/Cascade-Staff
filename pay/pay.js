/* Cascade Staff - Payment Request page (SPEC-37 7.A). Three steps on one page: pick, review, status.
   The server computes the money; the total on screen is display only. Reads staff_pay_candidates_v1 (SPEC-37 section 4) and sends
   through the notify-cleaner-payment function. Staff see their own pay here, never guest money. Nothing is stored in the browser. */
(function () {
  'use strict';
  var CS = window.CS, P = window.CSPay, ICON = window.ICON, esc = CS.esc;
  var CFG = { url: 'https://qkgfhsdppslwunarczeq.supabase.co', key: 'sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj', propertyId: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd' };
  var $ = function (id) { return document.getElementById(id); };
  var DEMO = !!(window.CSDemo && window.CSDemo.active); // ?demo: synthetic data, no Supabase client, no network, no storage (demo.js)
  function net() { return (DEMO ? window.CSDemo.fetch : window.fetch).apply(window, arguments); }
  var root = $('pay');
  if (!DEMO && !window.supabase) { root.innerHTML = shell('Cleaning fee', '<div class="errbox">' + ICON('alert') + '<span>Live information needs a connection. Open the app again when you have signal.</span></div>'); return; }
  var sb = DEMO ? window.CSDemo.client('cleaner') : window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  // One key per submission: kept across retries of a failed send, renewed after an ok (see CSPay.keyKeeper).
  var K = DEMO ? P.keyKeeper(undefined, null) : P.keyKeeper(); // demo: the in-flight key is kept in memory only
  var S = { step: 'pick', cands: null, sel: null, err: '', note: '', sending: false, draftOpen: false, askedOnce: false, askOpen: false, draft: { description: '', amount: '', file: null }, result: null, loadErr: '', mine: null, clean: P.P_param(typeof location !== 'undefined' ? location.search : '', 'clean'), pushState: null, pushMsg: '' };

  function shell(title, inner, back) { return P.P_shell(title, inner, { back: back, icon: ICON, esc: esc, hash: P.P_hash(window) }).replace(' aria-current="page"', ''); } // B3: a pay page is not "Today", so no tab is marked
  function dm(iso) { return CS.dayLabel(String(iso).slice(0, 10)); } // B3: "15 Oct", the shell's own style
  function ds(iso) { return CS.dayShort(String(iso).slice(0, 10)); } // "Fri 2 Oct"
  P.P_wireBack(window);

  function freshSel(c) { // D-350: transport starts on wherever the rate has one
    var sel = { sessions: {}, claims: {}, extras: S.sel ? S.sel.extras : [], advance: {} };
    var only = S.clean && (c.sessions || []).some(function (s) { return s.id === S.clean; }) ? S.clean : null; // MF1: ?clean=<session_id> ticks that clean (and no other clean); an unknown id ticks all, as before
    (c.sessions || []).forEach(function (s) { sel.sessions[s.id] = { on: !only || s.id === only, transport: s.transport != null }; });
    (c.claims || []).forEach(function (x) { sel.claims[x.id] = true; });
    (c.advance || []).forEach(function (a) { sel.advance[a.checkout_date] = { on: false, transport: a.transport != null }; });
    return sel;
  }
  function load() {
    return sb.auth.getSession().then(function (r) {
      if (!r.data || !r.data.session) { S.loadErr = 'signin'; return; }
      return sb.rpc('staff_pay_candidates_v1').then(function (res) {
        if (res.error) { S.loadErr = res.error.code === 'PGRST202' ? 'notready' : /not_authorized|42501/.test((res.error.message || '') + res.error.code) ? 'denied' : 'offline'; return; }
        var d = res.data;
        if (!d || d.ok === false) { S.loadErr = d && d.reason === 'not_authorized' ? 'denied' : 'offline'; return; }
        S.loadErr = ''; S.cands = d; S.sel = freshSel(d);
        // Lane C: HER requests with their steps and bank reference. A missing RPC (site ahead of the database) keeps the older list.
        return sb.rpc('staff_pay_my_requests_v1').then(function (m) { S.mine = m && !m.error && m.data && m.data.ok ? m.data.requests : null; }, function () { S.mine = null; });
      });
    }).catch(function () { S.loadErr = 'offline'; });
  }

  // ---------------------------------------------------------------- pick
  // s99e (D-350): the sub-line is the sum she is asking for; transport starts on wherever the rate has one.
  function subLine(base, tr, on) { return P.peso(base) + ' cleaning' + (on && tr != null ? ' + ' + P.peso(tr) + ' transport' : ''); }
  function trOpt(tr, on, attr, key, day) {
    if (tr == null) return '';
    var lbl = 'I paid for transport (+' + P.peso(tr) + ')';
    return '<div class="opt"><button class="sw P_tr" type="button" role="switch" aria-checked="' + !!on + '" aria-label="' + esc(lbl + ' for ' + day) + '" ' + attr + '="' + esc(key) + '"><span>' + esc(lbl) + '</span><i aria-hidden="true"></i></button></div>';
  }
  function advRow(a) {
    var st = S.sel.advance[a.checkout_date] || { on: false, transport: a.transport != null }, amt = P.sessionAmount({ base: a.base, transport: a.transport }, st.transport);
    return '<div class="payrow' + (st.on ? '' : ' off') + '"><button class="chk" type="button" role="checkbox" aria-checked="' + !!st.on + '" aria-label="' + esc(ds(a.checkout_date) + ' turnover, no report yet') + '" data-adv="' + esc(a.checkout_date) + '">' + ICON('check', 's16') + '</button>' +
      '<div><div class="t"><span>' + esc(ds(a.checkout_date) + ' · Turnover') + '</span><span class="val">' + esc(P.peso(amt)) + '</span></div><span class="s">' + esc(subLine(a.base, a.transport, st.transport) + ' · report not sent') + '</span>' + trOpt(a.transport, st.transport, 'data-advsw', a.checkout_date, ds(a.checkout_date)) + '</div></div>';
  }
  function missingBlock() {
    // s99d: a server that sends cands.advance lets her include check-outs with no report yet; an older one keeps the "send the report first" note
    if (Array.isArray(S.cands.advance)) {
      if (!S.cands.advance.length) return '';
      return '<div><h2 class="P_h">Cleans with no report yet</h2><p class="help P_hh">Not ticked yet. Tick to be paid now and send the report after.</p><div class="card list">' + S.cands.advance.map(advRow).join('') + '</div><p class="help">Please still send each report - the app will remind you.' + (S.pushState && S.pushState !== 'on' && S.pushState !== 'hidden' ? ' Turn on notifications to get a reminder.' : '') + '</p></div>';
    }
    var m = (S.cands.missing_reports || []);
    if (!m.length) return '';
    return '<div class="infobox">' + ICON('clip') + '<span>' + esc(m.map(dm).join(', ')) + ': send the cleaning report first, then you can ask for pay.</span></div>';
  }
  function cleanRow(s) {
    var st = S.sel.sessions[s.id] || { on: false, transport: false }, amt = P.sessionAmount(s, st.transport);
    return '<div class="payrow' + (st.on ? '' : ' off') + '"><button class="chk" type="button" role="checkbox" aria-checked="' + !!st.on + '" aria-label="' + esc(ds(s.date) + ' clean') + '" data-ses="' + esc(s.id) + '">' + ICON('check', 's16') + '</button>' +
      '<div><div class="t"><span>' + esc(ds(s.date) + ' · ' + P.typeLabel(s.type)) + '</span><span class="val">' + esc(P.peso(amt)) + '</span></div><span class="s">' + esc(subLine(s.base, s.transport, st.transport)) + (s.guest ? ' · ' + esc(s.guest) + ' checked out' : '') + '</span>' + trOpt(s.transport, st.transport, 'data-sw', s.id, ds(s.date)) + '</div></div>';
  }
  function claimRow(c) {
    return '<div class="payrow' + (S.sel.claims[c.id] ? '' : ' off') + '"><button class="chk" type="button" role="checkbox" aria-checked="' + !!S.sel.claims[c.id] + '" aria-label="' + esc(c.description) + '" data-clm="' + esc(c.id) + '">' + ICON('check', 's16') + '</button>' +
      '<div><div class="t"><span>' + esc(c.description) + '</span><span class="val">' + esc(P.peso(c.amount)) + '</span></div><span class="s">Expense · ' + esc(dm(c.date)) + '</span></div></div>';
  }
  function extraRow(e, i) {
    var x = P.parseExtra(e);
    return '<div class="payrow"><span class="lead" style="width:24px;height:24px">' + ICON('plus', 's16') + '</span><div><div class="t"><span>' + esc(e.description) + '</span><span class="val">' + esc(x ? P.peso(x.amount) : '') + '</span></div>' +
      '<span class="s">' + (e.file ? 'Receipt photo: ' + esc(e.file.name || 'photo') : 'No receipt photo') + '</span>' +
      '<div class="opt"><button class="btn btn-ghost btn-sm" type="button" data-rmx="' + i + '" style="padding:0 8px">Remove</button></div></div></div>';
  }
  function draftForm() {
    var d = S.draft;
    return '<div class="expform"><div class="field"><label for="x-d">What did you buy?</label><div class="input"><input id="x-d" maxlength="500" value="' + esc(d.description) + '" placeholder="Trash bags"></div></div>' +
      '<div class="field"><label for="x-a">Amount</label><div class="input"><span>PHP</span><input id="x-a" inputmode="decimal" value="' + esc(d.amount) + '" placeholder="120"></div></div>' +
      '<div class="row-wrap"><button class="btn btn-secondary btn-sm" type="button" data-act="photo">' + ICON('camera', 's16') + (d.file ? 'Change photo' : 'Receipt photo (optional)') + '</button>' + (d.file ? '<span class="help">' + esc(d.file.name || 'photo') + '</span>' : '<span class="help">Helps Finance check it</span>') + '</div>' +
      '<div class="row-wrap"><button class="btn btn-primary btn-sm" type="button" data-act="addx">Add expense</button><button class="btn btn-ghost btn-sm" type="button" data-act="cancelx">Cancel</button></div>' +
      (S.err && S.step === 'pick' ? '<div class="field"><div class="err">' + ICON('xcircle', 's16') + esc(S.err) + '</div></div>' : '') + '</div>';
  }
  // Lane C: Requested -> Paying -> Paid, each a glyph and a word, with her request ref and (once paid) the bank's reference.
  function C_stepper(status) {
    var T = window.C_PaidText, st = T.steps(status);
    if (st.cancelled) return '<span class="pill p-neutral">' + ICON('minus', 's16') + 'Cancelled</span>';
    var glyph = { done: 'check', next: 'minus' };
    return '<span class="C_steps" role="list">' + st.steps.map(function (x, i) {
      var g = x.state === 'now' ? (x.key === 'paid' ? 'checks' : x.key === 'paying' ? 'send' : 'clock') : glyph[x.state];
      return (i ? '<span class="C_step-sep" aria-hidden="true"></span>' : '') + '<span class="C_step" role="listitem" data-state="' + x.state + '">' + ICON(g, 's16') + esc(x.label) + '</span>';
    }).join('') + '</span>';
  }
  function history() {
    var rs = (S.mine || S.cands.requests || []).slice(0, 5);
    var slot = '<div id="C_push-slot"></div>';
    if (!rs.length) return slot;
    return '<div><h2 class="P_h">Your requests</h2><div class="card list">' + rs.map(function (r) {
      var ahead = (r.lines || []).filter(function (l) { return l && l.kind === 'advance'; }).map(function (l) { return '<span class="s C_ahead">' + esc(window.C_PaidText.advanceLine(l)) + '</span>'; }).join('');
      var bank = r.status === 'paid' && r.bank_reference ? ' · Bank ref ' + esc(window.C_PaidText.reference({ bank_reference: r.bank_reference })) : '';
      return '<div class="rowi" style="cursor:default"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t num">' + esc(P.peso(r.total)) + '</span><span class="s num C_ref">Ref ' + esc(String(r.ref || '').replace(/^CASCADE-/, '')) + (r.created_at ? ' · sent ' + esc(dm(r.created_at)) : '') + (r.status === 'paid' && r.paid_at ? ' · paid ' + esc(dm(r.paid_at)) : '') + bank + '</span>' + ahead + C_stepper(r.status) + (r.status === 'requested' || r.status === 'paying' ? '<span class="help P_expect">Usually paid the same day. You will see "You were paid" here.</span>' : '') + '</span></div>';
    }).join('') + '</div></div>' + slot;
  }
  // s99e: one card for every report she still owes, paid ahead or not, with the one way to start it
  function reportsCard() {
    var by = {};
    ((S.cands && S.cands.reports_owed) || []).forEach(function (r) { if (r && r.date) by[String(r.date).slice(0, 10)] = r.status === 'paid' ? 'already paid' : 'pay requested'; });
    (Array.isArray(S.cands.advance) ? S.cands.advance : []).forEach(function (a) { var k = String(a.checkout_date).slice(0, 10); if (!by[k]) by[k] = 'not paid yet'; });
    var ks = Object.keys(by).sort();
    if (!ks.length) return '';
    return '<div class="card P_reports"><h2 class="P_h">Reports to send</h2><ul class="P_rl">' + ks.map(function (k) { return '<li>' + esc(ds(k) + ' · ' + by[k]) + '</li>'; }).join('') + '</ul><a class="btn btn-secondary btn-block" href="../#door/checklist">Start a cleaning report</a></div>';
  }
  function renderPick() {
    var c = S.cands, sess = c.sessions || [], claims = c.claims || [], hasAdv = Array.isArray(c.advance) && c.advance.length;
    var total = P.computeTotal(c, S.sel), lines = P.lineCount(c, S.sel), over = lines > P.MAX_LINES, can = total > 0 && !over;
    var inner = '<div class="stack P_pick"><p class="help P_sub">Tick what you want to be paid for, then send.</p>' + reportsCard() +
      (sess.length ? '<div><h2 class="P_h">Cleans to be paid</h2><div class="card list">' + sess.map(cleanRow).join('') + '</div></div>' : '') +
      missingBlock() +
      (sess.length || claims.length || hasAdv ? '' : '<div class="card empty"><div class="disc">' + ICON('checks') + '</div><p>Nothing to be paid yet. Cleans and expenses show here after you send their report.</p></div>') +
      '<div><h2 class="P_h">Expenses</h2><div class="card list">' + claims.map(claimRow).join('') + (S.sel.extras || []).map(extraRow).join('') +
      (S.draftOpen ? draftForm() : '<div class="payrow single"><button class="btn btn-ghost" type="button" data-act="openx" style="justify-content:flex-start;padding:0;height:36px">' + ICON('plus') + 'Add an expense</button></div>') + '</div></div>' +
      history() + '</div>' +
      '<div class="sticky P_bar"><div class="total"><span class="P_lbl">You will ask for<span class="P_cnt">' + esc(P.P_plural(lines, 'item')) + '</span></span><span class="amt num">' + esc(P.peso(total)) + '</span></div>' +
      (over ? '<div class="errbox">' + ICON('alert') + '<span>A request holds up to ' + P.MAX_LINES + ' lines. Untick some and send the rest in a second request.</span></div>' : '') +
      '<button class="btn btn-primary btn-block" type="button" data-act="review"' + (can ? '' : ' disabled') + '>Check and send' + ICON('chev') + '</button>' +
      (can || over ? '' : '<p class="help P_hint">Tick at least one line.</p>') + '</div>';
    root.innerHTML = shell('Cleaning fee', inner) + '<input type="file" id="x-file" accept="image/*" capture="environment" hidden>';
  }

  // ---------------------------------------------------------------- review
  function noPhotoCount() { return P.chosen(S.cands, S.sel).extras.filter(function (x) { return !x.receipt; }).length; }
  function renderReview() {
    var r = P.reviewBlock(S.cands, S.sel), html = r.lines.map(function (l, i) {
      return (l === 'Cleaning services' || l === 'Other expenses' || /^Total:/.test(l)) ? '<b>' + esc(l) + '</b>' : esc(l);
    }).join('\n');
    var inner = '<div class="stack"><div class="card"><div class="cap up">What Finance will see</div><div class="inset block" style="margin-top:10px">' + html + '</div>' +
      '<p class="help" style="margin:10px 0 0">The same shape as your usual message. Finance also gets your payout QR with ' + esc(P.peso(r.total)) + ' already set.</p></div>' +
      '<div class="card list"><div class="rowi" style="cursor:default"><span class="lead">' + ICON('send') + '</span><span class="mid"><span class="t">Goes to Telegram Finance</span><span class="s">Lloyd or Marifel pays and confirms there</span></span></div>' +
      '<div class="rowi" style="cursor:default"><span class="lead">' + ICON('chat') + '</span><span class="mid"><span class="t">You hear back in OPS</span><span class="s">A PAID post with the date, and a Received button for you</span></span></div></div>' +
      (S.askOpen ? '<div class="infobox">' + ICON('camera') + '<span><b>A receipt photo helps Finance check this expense.</b> Add one, or send without it.</span></div><div class="row-wrap"><button class="btn btn-secondary" type="button" data-act="back">' + ICON('camera', 's16') + 'Add photo</button><button class="btn btn-ghost" type="button" data-act="sendnow">Send without</button></div>' : '') +
      (S.err ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(S.err) + '</span></div>' : '') + '</div>' +
      '<div class="sticky"><div class="total"><span class="cap up">Total</span><span class="amt num">' + esc(P.peso(r.total)) + '</span></div>' +
      '<button class="btn btn-primary btn-block" type="button" data-act="send"' + (S.sending ? ' disabled' : '') + '>' + ICON('send') + (S.sending ? 'Sending…' : 'Send to Finance') + '</button>' +
      '<button class="btn btn-ghost" type="button" data-act="back" style="width:100%"' + (S.sending ? ' disabled' : '') + '>Back to the list</button></div>';
    root.innerHTML = shell('Review request', inner, '#back');
    var b = root.querySelector('.appbar a'); b.addEventListener('click', function (e) { e.preventDefault(); go('pick'); });
  }

  // ---------------------------------------------------------------- status
  function renderStatus() {
    var m = S.result, inner = '<div class="stack">' + (m ? '<div class="' + (m.ok ? 'okbox' : 'errbox') + '" role="status">' + ICON(m.ok ? 'checks' : 'alert') + '<span>' + esc(m.text) + (S.note ? ' ' + esc(S.note) : '') + '</span></div>' : '') + history() + '</div>' +
      '<div class="sticky"><button class="btn btn-secondary btn-block" type="button" data-act="new">' + ICON('plus') + 'New request</button></div>';
    root.innerHTML = shell('Your requests', inner);
  }

  function go(step) { S.step = step; S.err = ''; render(); window.scrollTo(0, 0); }
  function render() {
    if (S.loadErr) {
      var msg = { signin: 'Sign in to the Staff app first, then open Cleaning fee.', denied: 'Your pay is for the cleaning team.', notready: 'Your pay is not switched on yet. Ask Lloyd.', offline: 'Live information needs a connection.' }[S.loadErr];
      root.innerHTML = shell('Cleaning fee', '<div class="errbox">' + ICON('alert') + '<span>' + esc(msg) + '</span></div>' + (S.loadErr === 'signin' ? '<a class="btn btn-primary btn-block" href="../#signin" style="margin-top:12px">Sign in</a>' : '<button class="btn btn-secondary" type="button" data-act="retry" style="margin-top:12px">Try again</button>'));
      return;
    }
    if (!S.cands) { root.innerHTML = shell('Cleaning fee', '<div class="stack" style="margin-top:16px"><div class="skel" style="height:180px"></div><div class="skel" style="height:120px"></div></div>'); return; }
    if (S.step === 'review') renderReview(); else if (S.step === 'status') renderStatus(); else renderPick();
    if (S.step !== 'review') C_pushRefresh();
  }

  // ---------------------------------------------------------------- receipt photo and send
  function readFileAsImage(file) {
    return new Promise(function (res, rej) { var u = URL.createObjectURL(file), img = new Image(); img.onload = function () { URL.revokeObjectURL(u); res(img); }; img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); }; img.src = u; });
  }
  function toJpeg(file) {
    return readFileAsImage(file).then(function (img) {
      var z = P.fitSize(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'); cv.width = z.w; cv.height = z.h;
      cv.getContext('2d').drawImage(img, 0, 0, z.w, z.h);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.82); });
    });
  }
  function upload(extra, token, key) {
    if (!extra.file || extra.receipt_path) return Promise.resolve(true);
    return toJpeg(extra.file).then(function (blob) {
      return net(CFG.url + '/functions/v1/upload-photo', { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'image/jpeg', 'x-cascade-file-name': 'receipt.jpg', 'x-cascade-property-id': CFG.propertyId, 'x-cascade-submission-id': key }, body: blob });
    }).then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok || !j.path) throw new Error('upload'); extra.receipt_path = j.path; return true; }).catch(function () { return false; });
  }
  // F_: one short buzz when the request has been sent (CS.E_buzz is a silent no-op where vibration is missing, off, or in demo storage-less mode)
  function F_tap() { try { CS.E_buzz('tap', { navigator: navigator, storage: DEMO ? null : window.localStorage, doc: document }); } catch (e) {} }
  function send() {
    if (S.sending) return;
    if (noPhotoCount() && !S.askedOnce) { S.askedOnce = true; S.askOpen = true; renderReview(); return; }
    S.sending = true; S.err = ''; S.askOpen = false; renderReview();
    var sentTotal = P.computeTotal(S.cands, S.sel), demoTotal = DEMO ? sentTotal : 0, advDates = P.chosen(S.cands, S.sel).advance.map(function (x) { return x.a.checkout_date; });
    sb.auth.getSession().then(function (s) {
      var token = s.data && s.data.session && s.data.session.access_token; if (!token) throw new Error('signin');
      var failed = [], key = K.forSelection(S.cands, S.sel);
      return Promise.all(S.sel.extras.map(function (e) { return upload(e, token, key).then(function (ok) { if (!ok) failed.push(e.description); }); })).then(function () {
        var body = P.buildPayload(S.cands, S.sel, key);
        return net(CFG.url + '/functions/v1/notify-cleaner-payment', { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'http_' + r.status }; }); })
          .then(function (j) { if (DEMO && j && j.ok) j.total = demoTotal; return { j: j, failed: failed }; });
      });
    }).catch(function () { return { j: { ok: false, reason: 'offline' }, failed: [] }; }).then(function (o) {
      S.sending = false; var m = P.resultMessage(o.j); K.settle(o.j);
      // an old server drops the advance key: its total then differs from ours, so say so instead of promising lines it never took
      if (m.ok && advDates.length) m.text += Math.abs(Number(o.j.total) - sentTotal) < 0.005 ? ' Send the cleaning report for ' + advDates.map(dm).join(', ') + ' when you can.' : ' Finance received only part of this request. Please tell Lloyd.';
      if (m.ok) { F_tap(); S.result = m; S.note = o.failed.length ? 'The receipt photo for ' + o.failed.join(', ') + ' did not upload; tell Finance.' : ''; S.sel.extras = []; S.askedOnce = false; S.clean = ''; return load().then(function () { go('status'); }); }
      if (m.refresh) return load().then(function () { S.step = 'pick'; S.err = ''; render(); renderPickNotice(m.text); });
      S.err = m.text;
      renderReview();
    });
  }
  function renderPickNotice(t) { var s = root.querySelector('.stack'); if (s) s.insertAdjacentHTML('afterbegin', '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(t) + '</span></div>'); }

  // ---------------------------------------------------------------- Lane C: "Tell me on this phone when I am paid"
  // The slot is the last thing in the page body, so filling it later moves nothing above it. Hidden when the browser, the server key or the RPC is missing.
  function C_pushCall(body) {
    return sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token; if (!tok) throw new Error('signin');
      return net(CFG.url + '/functions/v1/notify-cleaner-payment', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }).then(function (r) { return r.json(); });
  }
  function C_pushPaint() {
    var slot = $('C_push-slot'); if (!slot) return;
    var st = S.pushState;
    if (!st || st === 'hidden') { slot.innerHTML = ''; return; }
    var K = window.C_Push, on = st === 'on';
    slot.innerHTML = '<div class="card C_push">' +
      (st === 'off' || st === 'on'
        ? '<button class="sw" type="button" role="switch" aria-checked="' + on + '" data-C-push="1"><i aria-hidden="true"></i>' + esc(K.words('off')) + '</button><span class="help">' + esc(on ? K.words('on') : 'A short message, with no amount on the lock screen.') + '</span>'
        : '<span class="help">' + ICON('bell', 's16') + ' ' + esc(K.words(st)) + '</span>') +
      (S.pushMsg ? '<span class="help" role="alert">' + esc(S.pushMsg) + '</span>' : '') + '</div>';
  }
  function C_pushRefresh() {
    if (DEMO || !window.C_Push || !$('C_push-slot')) return;
    if (S.pushState) { C_pushPaint(); return; } // already probed: just redraw the slot
    window.C_Push.status({ client: sb }).then(function (r) { S.pushState = r.state; C_pushPaint(); if (S.step === 'pick' && S.pushState !== 'on' && S.pushState !== 'hidden' && S.cands && (S.cands.advance || []).length) render(); }, function () { S.pushState = 'hidden'; });
  }
  root.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-C-push]'); if (!b || DEMO || !window.C_Push) return;
    var K = window.C_Push, on = S.pushState === 'on'; S.pushMsg = '';
    (on ? K.disable({ client: sb }) : K.enable({ client: sb, call: C_pushCall })).then(function (r) {
      if (r.ok) S.pushState = on ? 'off' : 'on';
      else S.pushMsg = K.words(r.reason === 'not_configured' ? 'not_configured' : r.reason === 'blocked' ? 'blocked' : 'failed');
      C_pushPaint();
    });
  });

  // ---------------------------------------------------------------- events
  root.addEventListener('input', function (ev) { var t = ev.target; if (t.id === 'x-d') S.draft.description = t.value; if (t.id === 'x-a') S.draft.amount = t.value; });
  root.addEventListener('change', function (ev) {
    if (ev.target.id === 'x-file' && ev.target.files && ev.target.files[0]) { S.draft.file = ev.target.files[0]; S.draftOpen = true; render(); }
  });
  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button,[data-ses],[data-clm],[data-sw],[data-adv],[data-advsw]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (t.hasAttribute('data-ses')) { var id = t.getAttribute('data-ses'); S.sel.sessions[id].on = !S.sel.sessions[id].on; render(); }
    else if (t.hasAttribute('data-clm')) { var cid = t.getAttribute('data-clm'); S.sel.claims[cid] = !S.sel.claims[cid]; render(); }
    else if (t.hasAttribute('data-sw')) { var sid = t.getAttribute('data-sw'); S.sel.sessions[sid].transport = !S.sel.sessions[sid].transport; render(); }
    else if (t.hasAttribute('data-adv') || t.hasAttribute('data-advsw')) { var ad = t.getAttribute('data-adv') || t.getAttribute('data-advsw'), as = S.sel.advance[ad] || (S.sel.advance[ad] = { on: false, transport: ((S.cands.advance || []).filter(function (a) { return a.checkout_date === ad; })[0] || {}).transport != null }); if (t.hasAttribute('data-adv')) as.on = !as.on; else as.transport = !as.transport; render(); }
    else if (t.hasAttribute('data-rmx')) { S.sel.extras.splice(+t.getAttribute('data-rmx'), 1); render(); }
    else if (a === 'openx') { S.draftOpen = true; render(); }
    else if (a === 'cancelx') { S.draftOpen = false; S.draft = { description: '', amount: '', file: null }; S.err = ''; render(); }
    else if (a === 'photo') { var f = $('x-file'); if (f) f.click(); }
    else if (a === 'addx') {
      var x = P.parseExtra({ description: S.draft.description, amount: S.draft.amount });
      if (!x) { S.err = 'Type what you bought (3 letters or more) and an amount up to ' + P.peso(P.MAX_EXTRA) + '.'; render(); return; }
      S.sel.extras.push({ description: x.description, amount: x.amount, file: S.draft.file });
      S.draft = { description: '', amount: '', file: null }; S.draftOpen = false; S.err = ''; render();
    }
    else if (a === 'review') go('review');
    else if (a === 'back') { S.askOpen = false; go('pick'); }
    else if (a === 'send') send();
    else if (a === 'sendnow') { S.askedOnce = true; S.askOpen = false; send(); }
    else if (a === 'new') { S.result = null; S.note = ''; go('pick'); }
    else if (a === 'retry') { S.loadErr = ''; S.cands = null; render(); load().then(render); }
  });

  render();
  load().then(render);
  var bar = function () { var b = document.querySelector('.appbar'); if (b) b.classList.toggle('scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', bar, { passive: true });
})();
