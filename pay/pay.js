/* Cascade Staff - Payment Request page (SPEC-37 7.A). Three steps on one page: pick, review, status.
   The server computes the money; the total on screen is display only. Reads staff_pay_candidates_v1 (SPEC-37 section 4) and sends
   through the notify-cleaner-payment function. Staff see their own pay here, never guest money. Nothing is stored in the browser. */
(function () {
  'use strict';
  var CS = window.CS, P = window.CSPay, ICON = window.ICON, esc = CS.esc;
  var CFG = { url: 'https://qkgfhsdppslwunarczeq.supabase.co', key: 'sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj', propertyId: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd' };
  var $ = function (id) { return document.getElementById(id); };
  var root = $('pay');
  if (!window.supabase) { root.innerHTML = shell('Payment Request', '<div class="errbox">' + ICON('alert') + '<span>Live information needs a connection. Open the app again when you have signal.</span></div>'); return; }
  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  // One key per submission: kept across retries of a failed send, renewed after an ok (see CSPay.keyKeeper).
  var K = P.keyKeeper();
  var S = { step: 'pick', cands: null, sel: null, err: '', note: '', sending: false, draftOpen: false, askedOnce: false, askOpen: false, draft: { description: '', amount: '', file: null }, result: null, loadErr: '' };

  function shell(title, inner, back) {
    return '<header class="appbar"><a class="iconbtn" href="' + (back || '../#home') + '" aria-label="Back">' + ICON('back', 's24') + '</a><h1 class="ttl">' + esc(title) + '</h1></header><div class="screen">' + inner + '</div>' +
      '<nav class="tabbar" aria-label="Primary"><a class="tab" href="../#home"><span class="ico">' + ICON('house', 's24') + '</span>Today</a><a class="tab" href="../#calendar"><span class="ico">' + ICON('calendar', 's24') + '</span>Calendar</a>' +
      '<a class="tab" href="../#tasks"><span class="ico">' + ICON('tasks', 's24') + '</span>Tasks</a><a class="tab" href="../#more"><span class="ico">' + ICON('more', 's24') + '</span>More</a></nav>';
  }

  function freshSel(c) {
    var sel = { sessions: {}, claims: {}, extras: S.sel ? S.sel.extras : [] };
    (c.sessions || []).forEach(function (s) { sel.sessions[s.id] = { on: true, transport: false }; });
    (c.claims || []).forEach(function (x) { sel.claims[x.id] = true; });
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
      });
    }).catch(function () { S.loadErr = 'offline'; });
  }

  // ---------------------------------------------------------------- pick
  function missingBlock() {
    var m = (S.cands.missing_reports || []);
    if (!m.length) return '';
    return '<div class="infobox">' + ICON('clip') + '<span><b>' + esc(m.map(P.shortDate).join(', ')) + ' ' + (m.length === 1 ? 'check-out has' : 'check-outs have') + ' no report yet.</b> Submit the cleaning checklist first to request pay for ' + (m.length === 1 ? 'it' : 'them') + '.</span></div>';
  }
  function cleanRow(s) {
    var st = S.sel.sessions[s.id] || { on: false, transport: false }, amt = P.sessionAmount(s, st.on && st.transport);
    var opt = s.transport != null ? '<div class="opt"><button class="sw" type="button" role="switch" aria-checked="' + !!st.transport + '" data-sw="' + esc(s.id) + '"><i aria-hidden="true"></i>+' + esc(P.peso(s.transport)) + ' transport</button><span class="help">' + (st.transport ? 'added for this clean' : 'off') + '</span></div>' : '';
    return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!st.on + '" aria-label="' + esc(P.dateLabel(s.date) + ' clean') + '" data-ses="' + esc(s.id) + '">' + ICON('check', 's16') + '</button>' +
      '<div><div class="t"><span>' + esc(P.dateLabel(s.date) + ' · ' + P.typeLabel(s.type)) + '</span><span class="val">' + esc(P.peso(amt)) + '</span></div><span class="s">Base ' + esc(P.peso(s.base)) + (s.guest ? ' · ' + esc(s.guest) + ' checked out' : '') + '</span>' + opt + '</div></div>';
  }
  function claimRow(c) {
    return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!S.sel.claims[c.id] + '" aria-label="' + esc(c.description) + '" data-clm="' + esc(c.id) + '">' + ICON('check', 's16') + '</button>' +
      '<div><div class="t"><span>' + esc(c.description) + '</span><span class="val">' + esc(P.peso(c.amount)) + '</span></div><span class="s">Expense · ' + esc(P.shortDate(c.date)) + '</span></div></div>';
  }
  function extraRow(e, i) {
    var x = P.parseExtra(e);
    return '<div class="payrow"><span class="lead" style="width:24px;height:24px">' + ICON('plus', 's16') + '</span><div><div class="t"><span>' + esc(e.description) + '</span><span class="val">' + esc(x ? P.peso(x.amount) : '') + '</span></div>' +
      '<span class="s">' + (e.file ? 'Receipt photo: ' + esc(e.file.name || 'photo') : 'No receipt photo') + '</span>' +
      '<div class="opt"><button class="btn btn-ghost btn-sm" type="button" data-rmx="' + i + '" style="padding:0;height:28px">Remove</button></div></div></div>';
  }
  function draftForm() {
    var d = S.draft;
    return '<div class="expform"><div class="field"><label for="x-d">What did you buy?</label><div class="input"><input id="x-d" maxlength="500" value="' + esc(d.description) + '" placeholder="Trash bags"></div></div>' +
      '<div class="field"><label for="x-a">Amount</label><div class="input"><span>PHP</span><input id="x-a" inputmode="decimal" value="' + esc(d.amount) + '" placeholder="120"></div></div>' +
      '<div class="row-wrap"><button class="btn btn-secondary btn-sm" type="button" data-act="photo">' + ICON('camera', 's16') + (d.file ? 'Change photo' : 'Receipt photo (optional)') + '</button>' + (d.file ? '<span class="help">' + esc(d.file.name || 'photo') + '</span>' : '<span class="help">Helps Finance check it</span>') + '</div>' +
      '<div class="row-wrap"><button class="btn btn-primary btn-sm" type="button" data-act="addx">Add expense</button><button class="btn btn-ghost btn-sm" type="button" data-act="cancelx">Cancel</button></div>' +
      (S.err && S.step === 'pick' ? '<div class="field"><div class="err">' + ICON('xcircle', 's16') + esc(S.err) + '</div></div>' : '') + '</div>';
  }
  function history() {
    var rs = (S.cands.requests || []).slice(0, 5);
    if (!rs.length) return '';
    return '<div><div class="cap up" style="margin-bottom:6px">Your requests</div><div class="card list">' + rs.map(function (r) {
      var st = P.requestStatus(r);
      return '<div class="rowi" style="cursor:default"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t num">' + esc(P.peso(r.total)) + '</span><span class="s num">Ref ' + esc(String(r.ref || '').replace(/^CASCADE-/, '')) + (r.created_at ? ' · sent ' + esc(P.shortDate(r.created_at)) : '') + '</span></span>' +
        '<span class="pill p-' + st.tone + '">' + ICON(st.tone === 'ok' ? 'checks' : st.tone === 'warn' ? 'clock' : st.tone === 'info' ? 'info' : 'minus', 's16') + esc(st.label) + '</span></div>';
    }).join('') + '</div></div>';
  }
  function renderPick() {
    var c = S.cands, hasRows = (c.sessions || []).length || (c.claims || []).length;
    var total = P.computeTotal(c, S.sel), lines = P.lineCount(c, S.sel), over = lines > P.MAX_LINES;
    var inner = '<div class="stack">' +
      (hasRows ? '<div><div class="cap up" style="margin-bottom:6px">Not yet paid</div><div class="card list">' + (c.sessions || []).map(cleanRow).join('') + (c.claims || []).map(claimRow).join('') + '</div></div>'
        : '<div class="card empty"><div class="disc">' + ICON('checks') + '</div><h2 class="hd">Nothing waiting</h2><p>Cleans you have reported and not been paid for will show here.</p></div>') +
      missingBlock() +
      '<div><div class="cap up" style="margin-bottom:6px">Other expenses</div><div class="card list">' + (S.sel.extras || []).map(extraRow).join('') +
      (S.draftOpen ? draftForm() : '<div class="payrow single"><button class="btn btn-ghost" type="button" data-act="openx" style="justify-content:flex-start;padding:0;height:36px">' + ICON('plus') + 'Add other expense</button></div>') + '</div></div>' +
      history() + '</div>' +
      '<div class="sticky"><div class="total"><span class="cap up">Total to request</span><span class="amt num">' + esc(P.peso(total)) + '</span></div>' +
      (over ? '<div class="errbox">' + ICON('alert') + '<span>A request holds up to ' + P.MAX_LINES + ' lines. Untick some and send the rest in a second request.</span></div>' : '') +
      '<button class="btn btn-primary btn-block" type="button" data-act="review"' + (total > 0 && !over ? '' : ' disabled') + '>Review request' + ICON('chev') + '</button></div>';
    root.innerHTML = shell('Payment Request', inner) + '<input type="file" id="x-file" accept="image/*" capture="environment" hidden>';
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
      var msg = { signin: 'Sign in to the Staff app first, then open Payment Request.', denied: 'Payment Request is for the cleaning team.', notready: 'Payment Request is not switched on yet. Ask Lloyd.', offline: 'Live information needs a connection.' }[S.loadErr];
      root.innerHTML = shell('Payment Request', '<div class="errbox">' + ICON('alert') + '<span>' + esc(msg) + '</span></div>' + (S.loadErr === 'signin' ? '<a class="btn btn-primary btn-block" href="../#signin" style="margin-top:12px">Sign in</a>' : '<button class="btn btn-secondary" type="button" data-act="retry" style="margin-top:12px">Try again</button>'));
      return;
    }
    if (!S.cands) { root.innerHTML = shell('Payment Request', '<div class="stack" style="margin-top:16px"><div class="skel" style="height:180px"></div><div class="skel" style="height:120px"></div></div>'); return; }
    if (S.step === 'review') renderReview(); else if (S.step === 'status') renderStatus(); else renderPick();
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
      return fetch(CFG.url + '/functions/v1/upload-photo', { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'image/jpeg', 'x-cascade-file-name': 'receipt.jpg', 'x-cascade-property-id': CFG.propertyId, 'x-cascade-submission-id': key }, body: blob });
    }).then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok || !j.path) throw new Error('upload'); extra.receipt_path = j.path; return true; }).catch(function () { return false; });
  }
  function send() {
    if (S.sending) return;
    if (noPhotoCount() && !S.askedOnce) { S.askedOnce = true; S.askOpen = true; renderReview(); return; }
    S.sending = true; S.err = ''; S.askOpen = false; renderReview();
    sb.auth.getSession().then(function (s) {
      var token = s.data && s.data.session && s.data.session.access_token; if (!token) throw new Error('signin');
      var failed = [], key = K.forSelection(S.cands, S.sel);
      return Promise.all(S.sel.extras.map(function (e) { return upload(e, token, key).then(function (ok) { if (!ok) failed.push(e.description); }); })).then(function () {
        var body = P.buildPayload(S.cands, S.sel, key);
        return fetch(CFG.url + '/functions/v1/notify-cleaner-payment', { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'http_' + r.status }; }); })
          .then(function (j) { return { j: j, failed: failed }; });
      });
    }).catch(function () { return { j: { ok: false, reason: 'offline' }, failed: [] }; }).then(function (o) {
      S.sending = false; var m = P.resultMessage(o.j); K.settle(o.j);
      if (m.ok) { S.result = m; S.note = o.failed.length ? 'The receipt photo for ' + o.failed.join(', ') + ' did not upload; tell Finance.' : ''; S.sel.extras = []; S.askedOnce = false; return load().then(function () { go('status'); }); }
      if (m.refresh) return load().then(function () { S.step = 'pick'; S.err = ''; render(); renderPickNotice(m.text); });
      S.err = m.text;
      renderReview();
    });
  }
  function renderPickNotice(t) { var s = root.querySelector('.stack'); if (s) s.insertAdjacentHTML('afterbegin', '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(t) + '</span></div>'); }

  // ---------------------------------------------------------------- events
  root.addEventListener('input', function (ev) { var t = ev.target; if (t.id === 'x-d') S.draft.description = t.value; if (t.id === 'x-a') S.draft.amount = t.value; });
  root.addEventListener('change', function (ev) {
    if (ev.target.id === 'x-file' && ev.target.files && ev.target.files[0]) { S.draft.file = ev.target.files[0]; S.draftOpen = true; render(); }
  });
  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button,[data-ses],[data-clm],[data-sw]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (t.hasAttribute('data-ses')) { var id = t.getAttribute('data-ses'); S.sel.sessions[id].on = !S.sel.sessions[id].on; render(); }
    else if (t.hasAttribute('data-clm')) { var cid = t.getAttribute('data-clm'); S.sel.claims[cid] = !S.sel.claims[cid]; render(); }
    else if (t.hasAttribute('data-sw')) { var sid = t.getAttribute('data-sw'); S.sel.sessions[sid].transport = !S.sel.sessions[sid].transport; render(); }
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
