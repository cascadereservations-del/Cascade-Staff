/* Cascade Staff 3.4.53 (s134): Expenses. One place to see what the month cost, log an expense, and keep its receipt. Owner, admin and finance only.
   Reads expenses_screen_v1 and writes admin_save_transaction_v2, expense_void_v1, admin_review_transaction_v1 and expense_receipt_set_v1; receipts go through the
   ocr-receipt function (modes attach, sign, supply) and never through a client storage call. A signed link lives only in the open row sheet: it is not logged,
   stored or cached. The expense form lives here and nowhere else (Manage opens #expenses/add).
   Mounted by the shell: window.E_Expenses.mount(el, { client, demo, role, sub, propertyId, navigate, toast, haptic, onChange }). Plain script, no build step. */
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};

  // ------------------------------------------------------------------------------------------------ pure helpers (tested)
  var FALLBACK_PROPERTY = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'; // same constant as app.js CFG.propertyId
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MAX_FILE = 5 * 1024 * 1024, MAX_B64 = 8000000, SCAN_LOW = 0.6; // SCAN_LOW: a scan below this was hard to read (same as the old Manage form)
  var CHIPS = { bill: 'Bill', staff_pay: 'Staff pay', refund: 'Refund', stock: 'Stock', telegram: 'Telegram', receipt: 'Receipt', manual: 'Manual' }; // ML-28: only these chips are drawn
  var FILTERS = [['all', 'All', null], ['stock', 'Stock', 'stock'], ['bill', 'Bills', 'bill'], ['staff_pay', 'Staff pay', 'staff_pay'], ['manual', 'Manual', 'manual'], ['telegram', 'Telegram', 'telegram'], ['receipt', 'Receipt', 'receipt']];
  var CAT_ICON = { cleaning: 'sparkles', supplies: 'box', utilities: 'zap', internet: 'zap', maintenance: 'wrench', subscription: 'note' };
  var FALLBACK_CATS = ['cleaning', 'supplies', 'utilities', 'internet', 'subscription', 'maintenance', 'furnishing', 'cohost_fee', 'guest_refund', 'airbnb_adjustment', 'loan', 'other'];
  var NO_CONNECTION = 'No connection, so nothing was sent.';
  var DROPPED = 'The connection dropped before an answer came. Tap again; a repeat is safe.';
  var M = {
    tooBig: 'That file is over 5 MB.', wrongType: 'Use a photo or a PDF.', pdf: 'Attached. A PDF can’t be read - fill in the fields.',
    route: 'Did this go into stock? Add it in Inventory instead', removeAsk: 'Remove this receipt? The file is kept.', foot: 'One receipt per expense. PDF up to 5 MB.',
    match: 'Receipt matches this row', staffProof: 'Proof is in Pay staff', billProof: 'Payment screenshot from Bills', lockedGen: 'This entry was made somewhere else. Only the category and notes can change here.',
    handFail: 'Couldn’t open this in Inventory.', late: 'The date can’t be later than tomorrow.', inInv: 'This receipt is already in Inventory.', again: 'Attach the receipt again.', loadFail: 'The expenses could not be loaded. Try again in a moment.', forbidden: 'This page is not open to your account.'
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function str(v) { return typeof v === 'string' && v.trim() !== '' ? v : null; }
  var clock = function () { return Date.now(); };
  function manilaToday(ms) { var d = new Date((ms == null ? clock() : ms) + 8 * 3600000); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function monthOf(s) { var m = /^(\d{4})-(\d{2})/.exec(String(s || '')); return m ? m[1] + '-' + m[2] : null; }
  function monthShift(ym, n) { var p = String(ym).split('-'), t = (+p[0]) * 12 + (+p[1] - 1) + n; return Math.floor(t / 12) + '-' + pad2((t % 12) + 1); }
  function monthName(ym) { var p = String(ym || '').split('-'); return MONL[(+p[1] || 1) - 1] || ''; }
  function monthShort(ym) { var p = String(ym || '').split('-'); return MON[(+p[1] || 1) - 1] || ''; }
  function addDay(iso, n) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return ''; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function fmtLong(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? DOW[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] + ' ' + (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] : '—'; }
  function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] : '—'; }
  function dayLabel(iso, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '';
    var u = Date.UTC(+m[1], +m[2] - 1, +m[3]), t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today || '')), tu = t ? Date.UTC(+t[1], +t[2] - 1, +t[3]) : NaN, diff = Math.round((tu - u) / 86400000);
    if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday';
    return DOW[new Date(u).getUTCDay()] + ' ' + (+m[3]) + ' ' + MON[+m[2] - 1];
  }
  function toC(v) {
    if (v === null || v === undefined || v === '') return null;
    var s = typeof v === 'number' ? v.toFixed(2) : String(v).trim(); if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var neg = s.charAt(0) === '-', p = s.replace('-', '').split('.'), c = Number(p[0]) * 100 + Number(((p[1] || '') + '00').slice(0, 2));
    return neg ? -c : c;
  }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // "₱1,250.00"; whole rounds to a whole peso ("₱38,420")
  function peso(v, whole) {
    var c = toC(v); if (c === null) return '—'; if (whole) c = Math.round(c / 100) * 100;
    var neg = c < 0; c = Math.abs(c); return (neg ? '-' : '') + '₱' + group(Math.floor(c / 100)) + (whole ? '' : '.' + pad2(c % 100));
  }
  // a typed amount ("5,073" or "PHP 5073.5") to "5073.50"; null when not above zero or with more than two decimals
  function parseAmount(text) {
    var t = String(text == null ? '' : text).replace(/[,\s]|^(PHP|₱)/gi, ''); if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    var c = toC(t); return c > 0 ? (c / 100).toFixed(2) : null;
  }
  function chipLabel(c) { return Object.prototype.hasOwnProperty.call(CHIPS, c) ? CHIPS[c] : 'Manual'; }
  function chipKey(c) { return Object.prototype.hasOwnProperty.call(CHIPS, c) ? c : 'manual'; }
  function needsReview(r) { return !!r && r.status === 'pending_review'; }
  function titleOf(r) { return str(r && r.payee) || str(r && r.label) || 'Expense'; }
  function catList(list) {
    var out = [], seen = {}, src = Array.isArray(list) && list.length ? list : FALLBACK_CATS.map(function (c) { return { slug: c, label: c.replace(/_/g, ' ') }; });
    src.forEach(function (c) { var s = c && str(c.slug); if (!s || s === 'unaccounted' || seen[s]) return; seen[s] = 1; out.push({ slug: s, label: str(c.label) || s.replace(/_/g, ' ') }); });
    return out;
  }
  function catLabel(slug, list) { var l = catList(list); for (var i = 0; i < l.length; i++) if (l[i].slug === slug) return l[i].label; return String(slug || 'Other').replace(/_/g, ' '); }
  function catOk(slug, list) { return catList(list).some(function (c) { return c.slug === slug; }); }
  function validateExpense(f, cats, today) {
    var e = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.date = 'Choose the date of the expense.'; else if (today && f.date > addDay(today, 1)) e.date = M.late; // the server allows Manila tomorrow, never later
    if (parseAmount(f.amount) === null) e.amount = 'Enter the amount, more than zero, with at most two decimal places.';
    if (!catOk(f.category, cats)) e.category = 'Choose a category.';
    if (!String(f.notes || '').trim()) e.notes = 'Say what it was for.';
    return e;
  }
  // The create payload. Receipt fields ride only on a create (an edit never sends them: the server refuses with use_receipt_control).
  function expenseTxn(f, rc) {
    var t = { txn_type: 'expense', category: f.category, transaction_date: f.date, gross_amount: parseAmount(f.amount), payee_name: String(f.payee || '').trim(), notes: String(f.notes || '').trim(), or_number: '', reason: '' };
    if (rc && rc.path) { t.receipt_image_path = rc.path; if (typeof rc.confidence === 'number') t.ocr_confidence = rc.confidence; if (rc.raw) t.ocr_raw = rc.raw; }
    return t;
  }
  // The edit payload: only what changed, plus id and the reason. An amount-locked (stock) or locked row sends only category and notes.
  function editPayload(r, f, reason) {
    var p = { id: r.id }, t = function (v) { return String(v == null ? '' : v).trim(); };
    if (!r.locked && !r.amount_locked) { // a stock row follows Inventory: date, amount and payee are read-only there
      if (f.date && f.date !== r.date) p.transaction_date = f.date;
      if (parseAmount(f.amount) !== null && toC(parseAmount(f.amount)) !== toC(r.amount)) p.gross_amount = parseAmount(f.amount);
      if (t(f.payee) !== t(r.payee)) p.payee_name = t(f.payee);
    }
    if (f.category && f.category !== r.category) p.category = f.category;
    if (t(f.notes) !== t(r.notes)) p.notes = t(f.notes);
    p.reason = t(reason);
    return p;
  }
  function changedKeys(p) { return Object.keys(p).filter(function (k) { return k !== 'id' && k !== 'reason'; }); }
  // The amount-only suggestion: the receipt's amount against the row's. null when nothing to say (no amount read, or an amount nobody may change).
  function suggestion(row, sug) {
    if (!row || !sug || sug.amount == null) return null; var a = parseAmount(String(sug.amount)); if (a === null) return null;
    if (row.amount_locked || row.locked) return null;
    return toC(a) === toC(row.amount) ? { same: true, amount: a } : { same: false, amount: a };
  }
  function suggestPrefill(s) {
    var f = {}; if (!s || typeof s !== 'object') return f;
    if (s.amount != null && parseAmount(String(s.amount)) !== null) f.amount = parseAmount(String(s.amount));
    if (/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) f.date = s.date;
    if (str(s.vendor)) f.payee = String(s.vendor).trim();
    var items = Array.isArray(s.line_items) ? s.line_items.map(function (i) { return i && str(i.description); }).filter(Boolean) : [];
    if (items.length) f.notes = items.slice(0, 3).join(', ') + (items.length > 3 ? ' and more' : '');
    if (str(s.category)) f.category = s.category;
    return f;
  }
  function refText(ref) {
    if (typeof ref === 'string') return ref.trim() || 'another expense';
    if (ref && typeof ref === 'object') { var bits = [ref.chip ? chipLabel(ref.chip) : '', ref.date ? fmtDate(ref.date) : '', ref.amount != null ? '(' + peso(ref.amount) + ')' : ''].filter(Boolean); return bits.join(' ') || 'another expense'; }
    return 'another expense';
  }
  function dupMsg(ref) { return 'This receipt is already on ' + refText(ref) + '.'; }
  // a file before any upload: PDFs and images only, a PDF up to 5 MB (an image is shrunk later). Returns an error sentence or ''.
  function fileCheck(file) {
    if (!file) return M.wrongType; var mt = String(file.type || '').toLowerCase(), nm = String(file.name || '').toLowerCase();
    var pdf = mt === 'application/pdf' || (!mt && /\.pdf$/.test(nm)), img = /^image\//.test(mt);
    if (!pdf && !img) return M.wrongType; if (pdf && Number(file.size) > MAX_FILE) return M.tooBig; if (img && Number(file.size) > 25 * 1024 * 1024) return M.tooBig;
    return '';
  }
  function isPdf(file) { var mt = String(file && file.type || '').toLowerCase(); return mt === 'application/pdf' || (!mt && /\.pdf$/i.test(String(file && file.name || ''))); }
  // "average of Aug to Oct", "average of the last 3 months"
  function basisText(months) {
    if (Array.isArray(months) && months.length) { var f = monthShort(monthOf(months[0])), l = monthShort(monthOf(months[months.length - 1])); return 'average of ' + (months.length > 1 && f !== l ? f + ' to ' + l : f); }
    if (typeof months === 'number' && months > 0) return 'average of the last ' + months + ' months';
    return '';
  }
  // The routing line is for roles that hold report_supply (owner and admin, not finance), on the Add sheet only, with a receipt attached.
  function canRoute(role) { return role === 'owner' || role === 'admin'; }
  function routeVisible(role, sh) {
    if (!canRoute(role) || !sh || sh.kind !== 'add' || !sh.rc || !sh.rc.path) return false;
    var n = sh.stockHint && Number(sh.stockHint.count); return (n >= 1) || (sh.f && sh.f.category === 'supplies');
  }
  function nudgeFor(cat) {
    if (cat === 'utilities' || cat === 'internet' || cat === 'subscription') return 'Pay scheduled bills in Bills';
    if (cat === 'cleaning') return 'Pay staff through Pay staff';
    if (cat === 'supplies') return 'If this went into stock, use Inventory > Bought';
    return '';
  }
  // day groups for the list: [{date, total, rows}] newest first, in the order the server sent them
  function dayGroups(rows) {
    var out = [], idx = {};
    (rows || []).forEach(function (r) { var d = String(r.date || '').slice(0, 10); if (!(d in idx)) { idx[d] = out.length; out.push({ date: d, total: 0, rows: [] }); } var g = out[idx[d]]; g.rows.push(r); g.total += toC(r.amount) || 0; });
    return out;
  }
  function expenseCats(byCat) { return (Array.isArray(byCat) ? byCat : []).filter(function (c) { return c && (c.txn_type == null || c.txn_type === 'expense') && toC(c.total) > 0; }).sort(function (a, b) { return toC(b.total) - toC(a.total); }); }
  function lookText(r, rows) {
    var l = r && r.lookalike; if (!l && r && r.lookalike_id) { for (var i = 0; i < (rows || []).length; i++) if (rows[i].id === r.lookalike_id) { l = rows[i]; break; } }
    if (!r || !(r.lookalike || r.lookalike_id)) return ''; if (!l) return 'Looks like another entry';
    return 'Looks like ' + chipLabel(l.chip) + ' ' + fmtDate(l.date) + ' (' + peso(l.amount) + ')';
  }
  function receiptWords(res) {
    var c = res && (res.error || res.reason);
    switch (c) {
      case 'locked': return 'This receipt is kept in ' + (str(res.where) || 'another screen') + '. Open it there.';
      case 'duplicate_receipt': return dupMsg(res.ref || res.on || res.where);
      case 'receipt_in_use': return M.inInv;
      case 'bad_path': case 'no_file': case 'no_upload_record': return M.again;
      case 'void': return 'This expense was voided, so its receipt cannot change.';
      case 'not_found': return 'This expense is no longer on the list.';
      case 'forbidden': case 'not_authorized': return 'Your account is not allowed to change receipts.';
      case 'reason_required': return 'Write a short reason, at least three letters.';
      default: return 'The receipt could not be saved. Check your connection and try again.';
    }
  }
  function saveWords(res) {
    var c = res && (res.error || res.reason), m = str(res && res.message);
    if (c === 'forbidden' || c === 'not_authorized') return 'Your account is not allowed to do this.';
    if (c === 'duplicate_receipt') return dupMsg(res.ref);
    if (c === 'locked') return 'This entry is locked. Only the category and notes can change here.';
    if (c === 'use_receipt_control') return 'Use the receipt buttons to change a receipt.';
    if (c === 'receipt_in_use') return M.inInv;
    if (c === 'bad_path' || c === 'no_file' || c === 'no_upload_record') return M.again;
    if (c === 'amount_locked') return 'This amount comes from Inventory. Change the price there.';
    if (c === 'future_date') return M.late;
    return m || 'Nothing was saved. Check the details and try again.';
  }
  function errCode(e) { return e && (e.code || (e.error && e.error.code)) || ''; }
  function errMsg(e) { return String((e && (e.message || (e.error && e.error.message))) || e || ''); }
  function isOffline(e) { return /failed to fetch|networkerror|network request failed|load failed|timeout|fetch failed/i.test(errMsg(e)) || (e && e.status === 0); }
  function isDenied(e) { return String(errCode(e)) === '42501' || (e && (e.status === 401 || e.status === 403)) || /not authori|permission denied/i.test(errMsg(e)); }
  function isMissing(e) { var c = String(errCode(e)); return c === 'PGRST202' || c === '42883' || (e && e.status === 404) || /could not find the function|does not exist|schema cache/i.test(errMsg(e)); }
  function plainError(e) {
    if (isOffline(e)) return DROPPED; if (isDenied(e)) return 'Your account is not allowed to do this.';
    if (isMissing(e)) return 'This is not available in this version of the app yet.';
    if (String(errCode(e)) === '23505') return 'This receipt is already on another expense.';
    if ((String(errCode(e)) === '22023' || String(errCode(e)) === 'P0002') && errMsg(e)) return errMsg(e);
    return 'The server did not answer clearly. Check the list before you try again.';
  }

  // ------------------------------------------------------------------------------------------------ state
  var S = null, G = 0, HELD = null, CARRY = null; // CARRY: the look-alike prompt that has to survive the remount when a save leaves #expenses/add (taken by the next mount within 10 s)
 // HELD: the form, the receipt and the preview kept while the person is in Inventory (cleared by any mount except #expenses/add/back)
  function ic(n, s) { try { return typeof W.ICON === 'function' ? (W.ICON(n, s || 's20') || '') : ''; } catch (e) { return ''; } }
  function pid() { return (S && S.opts.propertyId) || FALLBACK_PROPERTY; }
  function online() { try { return !(typeof navigator !== 'undefined' && navigator.onLine === false); } catch (e) { return true; } }
  function newKey(prefix) {
    if (S && S.opts.newKey) return S.opts.newKey(prefix);
    var hex = ''; try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { var a = new Uint8Array(16); crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) hex += pad2(a[i].toString(16)).slice(-2); } } catch (e) { hex = ''; }
    while (hex.length < 32) hex += Math.floor(Math.random() * 16).toString(16);
    return prefix + '-' + hex;
  }
  function tell(m) { try { if (S && S.opts.toast) S.opts.toast(m); } catch (e) { /* ok */ } }
  function buzz(k) { try { if (S && S.opts.haptic) S.opts.haptic(k); } catch (e) { /* ok */ } }
  function changed() { try { if (S && S.opts.onChange) S.opts.onChange(); } catch (e) { /* ok */ } }
  function live(gen, sh) { return !!S && S.gen === gen && (sh === undefined || S.sheet === sh); }

  var RPC_TIMEOUT_MS = 30000, FN_TIMEOUT_MS = 60000;
  function callRpc(name, args) {
    var st = S;
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { fin({ data: null, error: { message: 'timeout' } }); }, RPC_TIMEOUT_MS);
      st.timers = st.timers || []; st.timers.push(t);
      function fin(r) { if (done) return; done = true; clearTimeout(t); resolve(r); }
      try { Promise.resolve(st.client.rpc(name, args)).then(function (r) { fin(r || { data: null, error: null }); }, function (e) { fin({ data: null, error: e || { message: 'failed to fetch' } }); }); }
      catch (e) { fin({ data: null, error: e }); }
    });
  }
  function callFn(name, body) {
    var st = S;
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { fin({ ok: false, status: 0, net: true }); }, FN_TIMEOUT_MS);
      st.timers = st.timers || []; st.timers.push(t);
      function fin(r) { if (done) return; done = true; clearTimeout(t); resolve(r); }
      try {
        if (!st.client || !st.client.functions || typeof st.client.functions.invoke !== 'function') { fin({ ok: false, status: 404 }); return; }
        Promise.resolve(st.client.functions.invoke(name, { body: body })).then(function (r) {
          r = r || {};
          if (!r.error) { var d = r.data; fin(d && d.ok === false ? { ok: false, status: 400, code: d.error, data: d } : { ok: true, status: 200, data: d }); return; }
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === 'function') { Promise.resolve(ctx.json()).then(function (j) { return j || {}; }, function () { return {}; }).then(function (j) { fin({ ok: false, status: ctx.status | 0, code: j && typeof j.error === 'string' ? j.error : undefined, data: j }); }); return; }
          fin({ ok: false, status: 0, net: true, error: r.error });
        }, function (e) { fin({ ok: false, status: 0, net: true, error: e }); });
      } catch (e) { fin({ ok: false, status: 0, net: true, error: e }); }
    });
  }

  // ------------------------------------------------------------------------------------------------ data
  function rowOf(id) { var rows = (S.data && S.data.rows) || []; for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
  function load(more) {
    if (!S) return; if (!S.client) { S.err = 'offline'; draw(); return; }
    var gen = S.gen, args = { p_property_id: pid(), p_month: S.month + '-01', p_limit: 100, p_filter: S.chip === 'all' ? null : S.chip };
    if (more && S.data && S.data.rows && S.data.rows.length) { var last = S.data.rows[S.data.rows.length - 1]; args.p_before = last.created_at || null; args.p_before_id = last.id || null; } // (created_at, id) is the cursor: two rows can share a created_at
    if (!more) { S.loading = true; S.err = ''; draw(); }
    callRpc('expenses_screen_v1', args).then(function (res) {
      if (!live(gen)) return; S.loading = false;
      var d = res.data; if (res.error || !d) { S.err = isOffline(res.error) ? 'offline' : isDenied(res.error) ? 'forbidden' : 'error'; draw(); return; }
      if (d.ok === false) { S.err = d.error === 'forbidden' ? 'forbidden' : 'error'; draw(); return; }
      if (more && S.data) { var seen = {}; S.data.rows.forEach(function (r) { seen[r.id] = 1; }); (d.rows || []).forEach(function (r) { if (!seen[r.id]) S.data.rows.push(r); }); S.data.more = !!d.more; }
      else { S.data = d; S.allReview = false; S.unp = false; }
      S.err = ''; draw();
    });
  }
  function refresh() { if (S) { S.loadedAt = Date.now(); load(false); changed(); } }

  // a signed link for the open row only; never stored beyond the sheet, never logged
  function signLinks(ids) {
    var chunks = [], out = {}, i; for (i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
    return chunks.reduce(function (p, ch) {
      return p.then(function () { return callFn('ocr-receipt', { mode: 'sign', property_id: pid(), ids: ch }).then(function (r) { if (r.ok && r.data && r.data.links) Object.keys(r.data.links).forEach(function (k) { out[k] = r.data.links[k]; }); }); });
    }, Promise.resolve()).then(function () { return out; });
  }
  function loadLink(sh) {
    var r = rowOf(sh.id); if (!r || !r.has_receipt || !r.receipt_ref) { sh.link = null; return; }
    var gen = S.gen; sh.link = { state: 'loading' }; sh.linkTry = (sh.linkTry || 0) + 1;
    signLinks([r.id]).then(function (links) {
      if (!live(gen, sh)) return; var l = links[r.id];
      sh.link = l && /^https:\/\//.test(String(l.url || '')) ? { state: 'ok', url: String(l.url), mime: l.mime || (r.receipt_ref && r.receipt_ref.mime) || null } : { state: 'none' }; draw();
    }, function () { if (live(gen, sh)) { sh.link = { state: 'none' }; draw(); } });
  }

  // ------------------------------------------------------------------------------------------------ receipts
  function readFileBase64(file) {
    if (S.opts.readFile) return Promise.resolve(S.opts.readFile(file));
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res({ base64: String(fr.result).replace(/^data:[^,]*,/, ''), mime: 'application/pdf' }); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsDataURL(file); });
  }
  // longest edge 1600 px, JPEG .8; the shell may pass its own helper as opts.shrinkImage. A PDF is never shrunk.
  function shrinkReceipt(file) {
    if (S.opts.shrinkImage) return Promise.resolve(S.opts.shrinkImage(file));
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); res(img); }; img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); }; img.src = u;
    }).then(function (img) {
      var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight, 1)), cv = document.createElement('canvas'), cx;
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.8); });
    }).then(function (blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res({ base64: String(fr.result).replace(/^data:[^,]*,/, ''), mime: 'image/jpeg' }); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsDataURL(blob); }); });
  }
  function makeThumb(img) {
    try { if (typeof atob !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) return null; var bin = atob(img.base64), u8 = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return URL.createObjectURL(new Blob([u8], { type: img.mime })); } catch (e) { return null; }
  }
  function revoke(u) { if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ok */ } } }
  function attachWords(r) {
    if (r.net) return 'The connection dropped before the receipt was saved. Try again.';
    if (r.status === 413 || r.code === 'too_large' || r.code === 'file_too_large') return M.tooBig;
    if (r.status === 415 || r.code === 'unsupported_type' || r.code === 'unsupported_image_type') return M.wrongType;
    if (r.status === 404) return 'Receipts are not available in this version of the app yet.';
    if (r.status === 401 || r.status === 403) return 'Your account is not allowed to add receipts.';
    return 'The receipt could not be saved just now. Try again.';
  }
  // file to the server: Promise<{ok, pdf, d, thumb, msg}>. Checks first, shrinks an image, never shrinks a PDF.
  function uploadReceipt(file) {
    var bad = fileCheck(file); if (bad) return Promise.resolve({ ok: false, msg: bad });
    if (!online()) return Promise.resolve({ ok: false, msg: NO_CONNECTION });
    var pdf = isPdf(file);
    return (pdf ? readFileBase64(file) : shrinkReceipt(file)).then(function (img) {
      if (!img || !img.base64) return { ok: false, msg: 'That file could not be read. Try again.' };
      if (img.base64.length > MAX_B64) return { ok: false, msg: pdf ? M.tooBig : 'That photo is too large. Take it again a little further back.' };
      var mime = pdf ? 'application/pdf' : (img.mime || 'image/jpeg');
      return callFn('ocr-receipt', { mode: 'attach', file_base64: img.base64, mime_type: mime }).then(function (r) {
        var d = r.data || {};
        if (r.ok && d.receipt_path) return { ok: true, pdf: pdf || d.unread === 'pdf', d: d, thumb: pdf ? null : makeThumb(img) };
        return { ok: false, msg: attachWords(r) };
      });
    }, function () { return { ok: false, msg: 'That file could not be read. Try again.' }; });
  }
  function pickFile(file) {
    var sh = S.sheet; S.chooser = false; if (!sh || sh.busy || sh.upl) return;
    if (sh.kind === 'add') {
      var gen = S.gen; sh.upl = true; sh.msg = ''; sh.scanMsg = ''; draw();
      uploadReceipt(file).then(function (r) {
        if (!live(gen, sh)) { revoke(r.thumb); return; } sh.upl = false;
        if (!r.ok) { revoke(r.thumb); sh.msg = r.msg; draw(); return; }
        revoke(sh.thumb); sh.thumb = r.thumb; sh.pdf = r.pdf;
        var d = r.d, raw = d.suggest && typeof d.suggest === 'object' && JSON.stringify(d.suggest).length <= 20000 ? d.suggest : null;
        sh.rc = { path: d.receipt_path, mime: d.mime || (r.pdf ? 'application/pdf' : 'image/jpeg'), sha256: d.sha256 || null, confidence: d.suggest && typeof d.suggest.confidence === 'number' ? d.suggest.confidence : null, raw: raw };
        sh.stockHint = d.stock_hint && Number(d.stock_hint.count) >= 1 ? { count: Number(d.stock_hint.count), names: Array.isArray(d.stock_hint.names) ? d.stock_hint.names : [] } : null;
        var pre = r.pdf ? {} : suggestPrefill(d.suggest), ck = {}; Object.keys(pre).forEach(function (k) { if (k === 'category' && !catOk(pre[k], S.data && S.data.categories)) return; sh.f[k] = pre[k]; ck[k] = true; });
        sh.checks = ck;
        sh.scanMsg = r.pdf ? M.pdf : Object.keys(ck).length ? 'Read from the receipt. Please check the marked fields.' : 'The receipt is attached. Nothing could be read from it, so please fill the form in.';
        sh.errs = {}; draw();
      });
      return;
    }
    if (sh.kind === 'detail') { attachToRow(sh, file); return; }
  }
  function receiptSet(sh, row, path, reason, done) {
    callRpc('expense_receipt_set_v1', { p_property_id: pid(), p_id: row.id, p_path: path, p_reason: reason }).then(function (res) { done(res); });
  }
  function attachToRow(sh, file) {
    var row = rowOf(sh.id); if (!row) return; var gen = S.gen, replacing = !!row.has_receipt;
    sh.upl = true; sh.msg = ''; sh.sug = null; draw();
    uploadReceipt(file).then(function (r) {
      if (!live(gen, sh)) { revoke(r.thumb); return; }
      revoke(r.thumb);
      if (!r.ok) { sh.upl = false; sh.msg = r.msg; draw(); return; }
      var d = r.d;
      receiptSet(sh, row, d.receipt_path, replacing ? 'Receipt replaced' : 'Receipt added', function (res) {
        if (!live(gen, sh)) return; sh.upl = false; var x = res.data;
        if (res.error) { sh.msg = plainError(res.error); draw(); return; }
        if (!x || x.ok !== true) { sh.msg = receiptWords(x); draw(); return; }
        row.has_receipt = x.has_receipt !== false; if (x.receipt_ref) row.receipt_ref = x.receipt_ref; sh.link = null; sh.pdfNote = r.pdf ? M.pdf : '';
        sh.sug = r.pdf ? null : (d.suggest || null); buzz('success'); tell(replacing ? 'Receipt replaced.' : 'Receipt added.'); refreshRows(); loadLink(sh); draw();
      });
    });
  }
  function refreshRows() { if (!S || !S.client) return; var gen = S.gen; callRpc('expenses_screen_v1', { p_property_id: pid(), p_month: S.month + '-01', p_limit: 100, p_filter: S.chip === 'all' ? null : S.chip }).then(function (res) { if (!live(gen) || res.error || !res.data || res.data.ok === false) return; S.data = res.data; if (S.sheet && S.sheet.kind === 'detail' && !rowOf(S.sheet.id)) S.sheet = null; draw(); }); changed(); }

  // ------------------------------------------------------------------------------------------------ writes
  function write(name, args, onOk, opts) {
    var sh = S.sheet; if (!sh || sh.busy) return; sh.msg = '';
    if (!online()) { sh.msg = NO_CONNECTION; draw(); return; }
    sh.busy = true; draw(); var gen = S.gen;
    callRpc(name, args).then(function (res) {
      if (!live(gen)) return; sh.busy = false;
      if (res.error) { sh.msg = plainError(res.error); draw(); return; }
      var x = res.data; if (x && x.ok === false) { sh.msg = (opts && opts.words ? opts.words(x) : saveWords(x)); sh.key = newKey(sh.keyPrefix || 'exp'); if (opts && opts.fail) opts.fail(sh, x); draw(); return; }
      onOk(x || {}, sh);
    });
  }
  function doReviewAdd() {
    var sh = S.sheet, cats = S.data && S.data.categories; sh.errs = validateExpense(sh.f, cats, S.today);
    if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the items marked below.'; draw(); return; }
    sh.msg = ''; sh.step = 'review'; draw();
  }
  function doAdd() {
    var sh = S.sheet, cats = S.data && S.data.categories; if (sh.step !== 'review') { doReviewAdd(); return; }
    sh.errs = validateExpense(sh.f, cats, S.today);
    if (Object.keys(sh.errs).length) { sh.step = 'form'; sh.msg = 'Please fix the items marked below.'; draw(); return; }
    sh.keyPrefix = 'exp-add';
    write('admin_save_transaction_v2', { p_property_id: pid(), p_txn: expenseTxn(sh.f, sh.rc), p_idempotency_key: sh.key }, function (x, sh0) {
      buzz('success');
      if (x.lookalike && x.lookalike.id && x.id) { // the question has to outlive the move off #expenses/add: it is carried through the remount
        var q = { kind: 'same', id: x.id, look: x.lookalike, key: newKey('exp-void'), keyPrefix: 'exp-void', reason: '', msg: '' };
        revoke(sh0.thumb); S.sheet = q; S.chooser = false; if (S.opts.sub && /^add/.test(S.opts.sub)) CARRY = { sheet: q, at: clock() }; leaveAddRoute(); refresh(); draw(); return;
      }
      closeSheet(); refresh(); tell('Saved.');
    }, { fail: function (s0) { s0.step = 'form'; } });
  }
  function doEdit() {
    var sh = S.sheet, r = rowOf(sh.id); if (!r) return; var e = {};
    if (!r.locked && !r.amount_locked) { if (!/^\d{4}-\d{2}-\d{2}$/.test(sh.f.date || '')) e.date = 'Choose the date of the expense.'; else if (sh.f.date > addDay(S.today, 1)) e.date = M.late; if (parseAmount(sh.f.amount) === null) e.amount = 'Enter the amount, more than zero, with at most two decimal places.'; }
    if (!catOk(sh.f.category, S.data && S.data.categories)) e.category = 'Choose a category.';
    if (String(sh.reason || '').trim().length < 3) e.reason = 'Say why you are changing it, at least three letters.';
    sh.errs = e; if (Object.keys(e).length) { sh.msg = 'Please fix the items marked below.'; draw(); return; }
    var p = editPayload(r, sh.f, sh.reason); if (!changedKeys(p).length) { sh.msg = 'Nothing was changed.'; draw(); return; }
    sh.keyPrefix = 'exp-edit';
    write('admin_save_transaction_v2', { p_property_id: pid(), p_txn: p, p_idempotency_key: sh.key }, function () { buzz('success'); tell('Saved.'); S.sheet = { kind: 'detail', id: r.id }; refresh(); draw(); });
  }
  function doSuggest() {
    var sh = S.sheet, r = rowOf(sh.id), s = r && suggestion(r, sh.sug); if (!s || s.same) return;
    sh.keyPrefix = 'exp-amt'; sh.key = sh.key || newKey('exp-amt');
    write('admin_save_transaction_v2', { p_property_id: pid(), p_txn: { id: r.id, gross_amount: s.amount, reason: 'Amount from receipt' }, p_idempotency_key: sh.key }, function () { sh.sug = null; sh.key = null; buzz('success'); tell('Amount updated.'); refresh(); draw(); });
  }
  function doVoid(reasonOverride, sameAs, afterMsg) {
    var sh = S.sheet, reason = String(reasonOverride || sh.reason || '').trim();
    if (reason.length < 3) { sh.errs = { reason: 'Write a short reason, at least three letters.' }; sh.msg = 'Please fix the items marked below.'; draw(); return; }
    var args = { p_property_id: pid(), p_id: sh.id, p_reason: reason }; if (sameAs) args.p_same_as = sameAs;
    write('expense_void_v1', args, function () { buzz('success'); closeSheet(); tell(afterMsg || 'Voided.'); refresh(); });
  }
  // Count it: the row as shown, with any change to the amount, category or what it was for sent in p_edits (a reason is required whenever there is an edit).
  function doCount() {
    var sh = S.sheet, r = rowOf(sh.id); if (!r || sh.busy) return; var f = sh.f || {}, edits = {}, t = function (v) { return String(v == null ? '' : v).trim(); };
    if (!(r.amount_locked || r.locked)) {
      var a = parseAmount(f.amount); if (a === null) { sh.errs = { amount: 'Enter the amount, more than zero, with at most two decimal places.' }; sh.msg = 'Please fix the items marked below.'; draw(); return; }
      if (toC(a) !== toC(r.amount)) edits.gross_amount = a;
    }
    if (f.category && f.category !== r.category && catOk(f.category, S.data && S.data.categories)) edits.category = f.category;
    if (t(f.notes) !== t(r.notes)) edits.notes = t(f.notes);
    write('admin_review_transaction_v1', { p_property_id: pid(), p_id: sh.id, p_action: 'approve', p_edits: edits, p_reason: Object.keys(edits).length ? 'Edited while counting' : null }, function () { buzz('success'); closeSheet(); tell('Counted.'); refresh(); });
  }
  function doRemoveReceipt() {
    var sh = S.sheet, r = rowOf(sh.id); if (!r) return; var reason = String(sh.reason || '').trim();
    if (reason.length < 3 || reason.length > 200) { sh.errs = { reason: 'Write a short reason, 3 to 200 letters.' }; sh.msg = 'Please fix the items marked below.'; draw(); return; }
    if (!online()) { sh.msg = NO_CONNECTION; draw(); return; }
    sh.busy = true; draw(); var gen = S.gen;
    receiptSet(sh, r, null, reason, function (res) {
      if (!live(gen)) return; sh.busy = false; var x = res.data;
      if (res.error) { sh.msg = plainError(res.error); draw(); return; }
      if (!x || x.ok !== true) { sh.msg = receiptWords(x); draw(); return; }
      r.has_receipt = false; r.receipt_ref = null; buzz('success'); tell('Receipt removed.'); S.sheet = { kind: 'detail', id: r.id }; refreshRows(); draw();
    });
  }

  // ------------------------------------------------------------------------------------------------ sheets
  function openSheet(sh) { S.sheet = sh; S.chooser = false; draw(); }
  function leaveAddRoute() { if (S && S.opts.sub && /^add/.test(S.opts.sub)) { S.opts.sub = ''; try { if (S.opts.navigate) S.opts.navigate('#expenses'); } catch (e) { /* ok */ } } }
  function closeSheet() { if (S.sheet) { revoke(S.sheet.thumb); } CARRY = null; S.sheet = null; S.chooser = false; draw(); leaveAddRoute(); }
  function blankForm() { return { date: S.today, amount: '', category: '', payee: '', notes: '' }; }
  function openAdd(chooser) {
    S.sheet = { kind: 'add', f: blankForm(), errs: {}, checks: {}, rc: null, thumb: null, pdf: false, stockHint: null, key: newKey('exp-add'), keyPrefix: 'exp-add', msg: '', busy: false, upl: false, step: 'form' };
    S.chooser = !!chooser; draw();
  }
  function restoreHeld() {
    var h = HELD; HELD = null; if (!h) return false;
    S.sheet = { kind: 'add', f: h.f, errs: {}, checks: h.checks || {}, rc: h.rc, thumb: h.thumb, pdf: !!h.pdf, stockHint: h.stockHint, key: h.key, keyPrefix: 'exp-add', msg: '', busy: false, upl: false, scanMsg: h.scanMsg || '', step: 'form' };
    return true;
  }
  function clearHeld() { if (HELD) { revoke(HELD.thumb); HELD = null; } try { if (W.CS_receiptHand && W.CS_receiptHand.from === 'expenses') W.CS_receiptHand = null; } catch (e) { /* ok */ } }
  function doRoute() {
    var sh = S.sheet; if (!routeVisible(S.role, sh)) return;
    HELD = { f: sh.f, rc: sh.rc, thumb: sh.thumb, pdf: sh.pdf, stockHint: sh.stockHint, checks: sh.checks, key: sh.key, scanMsg: sh.scanMsg };
    sh.thumb = null; // the preview now belongs to HELD
    try { W.CS_receiptHand = { path: HELD.rc.path, mime: HELD.rc.mime, from: 'expenses' }; } catch (e) { /* ok */ }
    S.sheet = null; S.chooser = false; var nav = S.opts.navigate; if (nav) nav('#supply');
  }

  function fld(id, label, control, err, mark) { return '<div class="E_field"><label class="E_lbl" for="' + id + '">' + esc(label) + (mark ? ' <span class="E_mark">check this</span>' : '') + '</label>' + control + (err ? '<p class="E_ferr" id="' + id + '-e" role="alert">' + esc(err) + '</p>' : '') + '</div>'; }
  function inp(id, f, val, extra) { return '<input class="E_input" id="' + id + '" data-f="' + f + '" value="' + esc(val) + '" autocomplete="off" ' + (extra || '') + '>'; }
  function catSelect(id, val) {
    return '<select class="E_input E_sel" id="' + id + '" data-f="category"><option value=""' + (val ? '' : ' selected') + '>Choose a category</option>' + catList(S.data && S.data.categories).map(function (c) { return '<option value="' + esc(c.slug) + '"' + (val === c.slug ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>';
  }
  function shell(title, body, closeAct) {
    return '<div class="E_scrim" data-e="' + (closeAct || 'close') + '" aria-hidden="true"></div><div class="E_sheet" role="dialog" aria-modal="true" aria-labelledby="E_sh"><div class="E_grab" aria-hidden="true"></div>' +
      '<div class="E_sh"><h2 class="E_h" id="E_sh" tabindex="-1">' + esc(title) + '</h2><button class="E_x" type="button" data-e="' + (closeAct || 'close') + '" aria-label="Close">' + ic('close', 's20') + '</button></div>' + body + '</div>';
  }
  function errBox(sh) { return sh.msg ? '<div class="E_err" role="alert">' + esc(sh.msg) + '</div>' : ''; }
  function btnPair(pl, pa, sl, sa, busy, danger, off) {
    return '<div class="E_btns"><button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' btn-block" type="button" data-e="' + pa + '"' + (busy ? ' disabled aria-busy="true"' : off ? ' disabled' : '') + '>' + esc(busy ? 'Sending…' : pl) + '</button>' +
      (sl ? '<button class="btn btn-secondary btn-block" type="button" data-e="' + sa + '"' + (busy ? ' disabled' : '') + '>' + esc(sl) + '</button>' : '') + '</div>';
  }
  function receiptTile(sh) {
    var pdf = sh.pdf; return '<div class="E_rblock"><span class="E_th E_big' + (pdf ? ' E_pdf' : '') + '" aria-hidden="true">' + (pdf ? ic('note', 's24') : sh.thumb ? '<img src="' + esc(sh.thumb) + '" alt="">' : ic('image', 's24')) + '</span>' +
      '<div class="E_col"><b class="E_t">' + esc(pdf ? 'Receipt attached (PDF)' : 'Receipt attached') + '</b><div class="E_two"><button class="btn btn-secondary" type="button" data-e="chooser">Change</button><button class="btn btn-secondary" type="button" data-e="rc-clear">Remove</button></div></div></div>';
  }
  function lowConf(c) { return typeof c === 'number' && c < SCAN_LOW; }
  function formBody(sh, edit) {
    var r = edit ? rowOf(sh.id) : null, lock = !!(r && (r.locked || r.amount_locked)), amtLock = !!(r && (r.amount_locked || r.locked)), f = sh.f, e = sh.errs || {}, ck = sh.checks || {}, h = '';
    h += fld('E_date', 'Date', inp('E_date', 'date', f.date, 'type="date" max="' + esc(addDay(S.today, 1)) + '"' + (lock ? ' disabled' : '')), e.date, ck.date);
    h += fld('E_amt', 'Amount (PHP)', amtLock ? '<div class="E_input E_ro" id="E_amt">' + esc(peso(r.amount)) + '</div>' + (r && r.amount_locked && !r.locked ? '<p class="E_nudge">Change the price in Inventory</p>' : '') : inp('E_amt', 'amount', f.amount, 'inputmode="decimal" placeholder="0.00"'), e.amount, ck.amount);
    h += fld('E_cat', 'Category', catSelect('E_cat', f.category), e.category, ck.category);
    var nd = nudgeFor(f.category); if (nd) h += '<p class="E_nudge">' + esc(nd) + '</p>';
    h += fld('E_notes', 'What was it for?', inp('E_notes', 'notes', f.notes), e.notes, ck.notes);
    h += fld('E_payee', edit ? 'Paid to' : 'Paid to (optional)', inp('E_payee', 'payee', f.payee, lock ? 'disabled' : ''), e.payee, ck.payee);
    if (edit) h += fld('E_why', 'Why the change?', inp('E_why', 'reason', sh.reason || '', 'placeholder="A few words"'), e.reason);
    return h;
  }
  function sheetAdd(sh) {
    var h = errBox(sh);
    if (sh.step === 'review') return shell('Add expense', h + addReview(sh));
    h += sh.rc ? receiptTile(sh) : '<button class="E_scan btn btn-secondary" type="button" data-e="chooser"' + (sh.upl ? ' disabled aria-busy="true"' : '') + '>' + ic('camera', 's20') + esc(sh.upl ? 'Reading the receipt…' : 'Scan or upload receipt') + '</button>';
    if (sh.scanMsg) h += '<p class="E_nudge" role="status">' + esc(sh.scanMsg) + '</p>';
    if (sh.rc && lowConf(sh.rc.confidence)) h += '<p class="E_ferr" role="alert">The photo was hard to read. Please check every figure.</p>';
    if (routeVisible(S.role, sh)) h += '<button class="E_route" type="button" data-e="route"><span>' + esc(M.route) + '</span>' + ic('chev', 's16') + '</button>';
    h += formBody(sh, false) + btnPair('Review and save', 'review-add', 'Cancel', 'close', sh.busy);
    return shell('Add expense', h);
  }
  // the check step: counted in the books at once, so the person reads it back before it is saved
  function addReview(sh) {
    var f = sh.f, h = '<p class="E_sub">Check this before you save. It is counted in the books at once.</p>';
    h += kv('Date', esc(fmtLong(f.date)), true) + kv('Amount', '<b>' + esc(peso(parseAmount(f.amount))) + '</b>') + kv('Category', esc(catLabel(f.category, S.data && S.data.categories))) + kv('For', esc(String(f.notes || '').trim())) + (String(f.payee || '').trim() ? kv('Paid to', esc(String(f.payee).trim())) : '');
    if (sh.rc) h += kv('Receipt', (sh.thumb && !sh.pdf ? '<span class="E_th" aria-hidden="true"><img src="' + esc(sh.thumb) + '" alt=""></span> ' : '') + esc(sh.pdf ? 'Receipt attached (PDF)' : 'Receipt attached'));
    return h + btnPair('Save expense', 'save', 'Back', 'add-back', sh.busy);
  }
  function sheetEdit(sh) { return shell('Edit expense', errBox(sh) + formBody(sh, true) + btnPair('Save changes', 'edit-save', 'Cancel', 'to-detail', sh.busy)); }
  function kv(k, v, first) { return '<div class="E_kv' + (first ? ' E_first' : '') + '"><span>' + esc(k) + '</span><span>' + v + '</span></div>'; }
  function linkBlock(sh, r, view) {
    var can = view ? {} : r.receipt_can || {}, l = sh.link || {}, pdf = (l.mime || (r.receipt_ref && r.receipt_ref.mime) || '') === 'application/pdf', tile;
    if (!r.has_receipt) return can.add ? '<button class="E_addrcp" type="button" data-e="chooser"' + (sh.upl ? ' disabled aria-busy="true"' : '') + '>' + ic('paperclip', 's16') + esc(sh.upl ? 'Saving the receipt…' : 'Add receipt') + '</button>' : '';
    if (pdf) tile = '<span class="E_th E_big E_pdf" aria-hidden="true">' + ic('note', 's24') + '</span>';
    else tile = l.state === 'ok' ? '<img class="E_img" src="' + esc(l.url) + '" alt="Receipt">' : '<span class="E_th E_big" aria-hidden="true">' + ic('image', 's24') + '</span>';
    var open = l.state === 'ok' ? '<a class="E_th E_big E_tile" href="' + esc(l.url) + '" target="_blank" rel="noopener" aria-label="View receipt">' + tile + '</a>' : '<span class="E_tile">' + tile + '</span>';
    var btns = '';
    if (can.replace || can.remove) btns = '<div class="E_two">' + (can.replace ? '<button class="btn btn-secondary" type="button" data-e="chooser"' + (sh.upl ? ' disabled' : '') + '>Replace</button>' : '') + (can.remove ? '<button class="btn btn-secondary" type="button" data-e="rc-ask"' + (sh.upl ? ' disabled' : '') + '>Remove</button>' : '') + '</div>';
    return '<div class="E_rblock">' + open + '<div class="E_col"><b class="E_t">' + esc(pdf ? 'Receipt (PDF)' : 'Receipt') + '</b>' + (l.state === 'loading' ? '<span class="E_sub">Loading…</span>' : l.state === 'none' ? '<span class="E_sub">The picture could not be opened.</span>' : '') + btns + '</div></div>';
  }
  function sheetDetail(sh) {
    var r = rowOf(sh.id); if (!r) return '';
    var h = errBox(sh), pend = needsReview(r), kind = r.receipt_ref && r.receipt_ref.kind;
    h += '<div class="E_money">' + esc(peso(r.amount)) + '</div>';
    h += kv('Date', esc(fmtDate(r.date)), true) + kv('Category', esc(catLabel(r.category, S.data && S.data.categories))) + (str(r.payee) ? kv('Paid to', esc(r.payee)) : '') + (str(r.notes) ? kv('Notes', esc(r.notes)) : '') + kv('Added by', '<span class="E_pill">' + esc(chipLabel(r.chip)) + '</span>');
    if (r.stock) h += kv('Source', esc('Stock bought · ' + Number(r.stock.lines) + (Number(r.stock.lines) === 1 ? ' line' : ' lines'))) + '<button class="E_link" type="button" data-e="go-items">See the items in Inventory</button>';
    var lk = !pend && lookText(r, S.data && S.data.rows); if (lk) h += '<p class="E_sub E_lookm">' + esc(lk) + '</p>';
    if (r.amount_locked && !r.locked) h += '<p class="E_nudge">Change the price in Inventory</p>';
    if (r.locked) {
      var staff = r.chip === 'staff_pay', bill = r.chip === 'bill';
      h += '<div class="E_lockbar">' + ic('lock', 's16') + '<span>' + esc(staff ? M.staffProof : bill ? M.billProof : M.lockedGen) + '</span></div>';
      var pu = payUrl(); if (staff && pu) h += '<a class="btn btn-secondary btn-block" href="' + esc(pu) + '">Open Pay staff</a>';
      if (bill) h += '<button class="btn btn-secondary btn-block" type="button" data-e="go-bills" data-id="' + esc(r.id) + '">Open in Bills</button>';
    }
    if (!(r.locked && r.chip === 'staff_pay')) h += '<span class="E_rowsep">Receipt</span>' + linkBlock(sh, r);
    if (sh.pdfNote) h += '<p class="E_nudge" role="status">' + esc(sh.pdfNote) + '</p>';
    var s = suggestion(r, sh.sug);
    if (s) h += s.same ? '<p class="E_nudge" role="status">' + esc(M.match) + '</p>' : '<button class="E_suggest" type="button" data-e="sug"' + (sh.busy ? ' disabled' : '') + '><span>' + esc('Receipt says ' + peso(s.amount) + ', this row says ' + peso(r.amount)) + '</span><b>Use receipt amount</b></button>';
    h += '<div class="E_btns">';
    if (pend && S.data && S.data.can_write) h += '<button class="btn btn-primary btn-block" type="button" data-e="review">Review</button>';
    if (S.data && S.data.can_write) h += '<button class="btn btn-secondary btn-block" type="button" data-e="edit">Edit</button>' + (r.locked ? '' : '<button class="btn btn-secondary btn-block" type="button" data-e="void-ask">Void</button>');
    h += '</div>';
    void kind; return shell(titleOf(r), h);
  }
  function sheetReview(sh) {
    var r = rowOf(sh.id); if (!r) return ''; var look = r.lookalike || (r.lookalike_id && rowOf(r.lookalike_id)), f = sh.f || {}, e = sh.errs || {}, amtLock = !!(r.amount_locked || r.locked), off = sh.busy || (!amtLock && parseAmount(f.amount) === null);
    var h = errBox(sh) + linkBlock(sh, r, true) + '<p class="E_sub">' + esc(fmtDate(r.date) + ' · ' + chipLabel(r.chip)) + '</p>';
    var lt = lookText(r, S.data && S.data.rows); if (lt) h += '<p class="E_look">' + esc(lt) + '</p>';
    h += fld('E_ramt', 'Amount (PHP)', amtLock ? '<div class="E_input E_ro" id="E_ramt">' + esc(peso(r.amount)) + '</div>' : inp('E_ramt', 'amount', f.amount, 'inputmode="decimal" placeholder="0.00"'), e.amount) + fld('E_rcat', 'Category', catSelect('E_rcat', f.category), e.category) + fld('E_rnotes', 'What was it for?', inp('E_rnotes', 'notes', f.notes), e.notes);
    h += '<button class="E_opt" type="button" data-e="count"' + (off ? ' disabled' : '') + '>' + ic('check', 's20') + 'Count it</button>';
    if (look) h += '<button class="E_opt" type="button" data-e="same-as"' + (sh.busy ? ' disabled' : '') + '>' + ic('note', 's20') + esc('Same purchase as ' + refText(look)) + '</button>';
    h += '<button class="E_opt" type="button" data-e="not-cost"' + (sh.busy ? ' disabled' : '') + '>' + ic('x', 's20') + 'Not a cost</button>';
    return shell('Needs review', h + '<div class="E_btns"><button class="btn btn-secondary btn-block" type="button" data-e="to-detail">Back</button></div>');
  }
  function sheetVoid(sh) {
    var r = rowOf(sh.id); if (!r) return '';
    return shell('Void this expense?', errBox(sh) + '<p class="E_sub">' + esc(titleOf(r) + ' · ' + peso(r.amount)) + '</p><p class="E_sub">' + esc('This takes ' + peso(r.amount) + ' out of ' + monthName(monthOf(r.date)) + '’s costs. It can be restored from the dashboard’s audit history.') + '</p>' + fld('E_why', 'Why?', inp('E_why', 'reason', sh.reason || '', 'placeholder="A few words"'), (sh.errs || {}).reason) +
      btnPair('Void expense', 'void-go', 'Keep it', 'to-detail', sh.busy, true, String(sh.reason || '').trim().length < 3));
  }
  function sheetRm(sh) {
    return shell('Remove this receipt?', errBox(sh) + '<p class="E_sub">' + esc(M.removeAsk) + '</p>' + fld('E_why', 'Why?', inp('E_why', 'reason', sh.reason || '', 'placeholder="A few words"'), (sh.errs || {}).reason) +
      btnPair('Remove receipt', 'rc-go', 'Keep it', 'to-detail', sh.busy, true, String(sh.reason || '').trim().length < 3));
  }
  function sheetSame(sh) {
    var l = sh.look || {}, ref = refText(l);
    return shell('Saved', errBox(sh) + '<div class="E_same"><b>' + esc('Saved. Same as ' + ref + '?') + '</b><span>Counting both would double the cost.</span></div>' + btnPair('Yes, same purchase', 'same-yes', 'No, keep both', 'close', sh.busy));
  }
  function chooserHtml() {
    var inpA = function (acc, cap) { return '<input class="E_file" type="file" data-e="file" accept="' + acc + '"' + (cap ? ' capture="environment"' : '') + '>'; };
    return '<div class="E_scrim E_scrim2" data-e="chooser-x" aria-hidden="true"></div><div class="E_sheet E_chooser" role="dialog" aria-modal="true" aria-label="Add a receipt"><div class="E_grab" aria-hidden="true"></div><h2 class="E_h">Add a receipt</h2>' +
      '<label class="E_opt">' + ic('camera', 's20') + 'Take photo' + inpA('image/*', true) + '</label><label class="E_opt">' + ic('image', 's20') + 'Choose photo or PDF' + inpA('image/*,application/pdf', false) + '</label>' +
      '<p class="E_sub">' + esc(M.foot) + '</p><button class="btn btn-secondary btn-block" type="button" data-e="chooser-x">Cancel</button></div>';
  }

  // ------------------------------------------------------------------------------------------------ screen
  function rowHtml(r, cats) {
    var cl = catLabel(r.category, cats), icon = CAT_ICON[r.category] || 'wallet', lk = !needsReview(r) && lookText(r, S.data && S.data.rows);
    return '<div class="E_lr" role="button" tabindex="0" data-e="open" data-id="' + esc(r.id) + '"><span class="E_ic" aria-hidden="true">' + ic(icon, 's20') + '</span><span><span class="E_t">' + esc(titleOf(r)) + '</span><span class="E_sub">' + esc(cl + ' · ' + chipLabel(r.chip)) + (r.has_receipt ? ' <span class="E_clip" aria-label="Has a receipt">' + ic('paperclip', 's16') + '</span>' : '') + '</span>' + (lk ? '<span class="E_sub E_lookm">' + esc(lk) + '</span>' : '') + '</span><span class="E_a"><b>' + esc(peso(r.amount)) + '</b>' + (r.locked ? '<span class="E_lock" aria-label="Locked">' + ic('lock', 's16') + '</span>' : '') + '</span></div>';
  }
  function viewScreen() {
    var d = S.data, h = '', cur = S.month === monthOf(S.today);
    h += '<div class="E_stepper"><button type="button" data-e="prev" aria-label="Previous month">' + ic('back', 's20') + '</button><span>' + esc(monthName(S.month) + ' ' + S.month.slice(0, 4)) + '</span><button type="button" data-e="next" aria-label="Next month"' + (cur ? ' disabled' : '') + '>' + ic('chev', 's20') + '</button></div>';
    if (S.err && !d) return h + '<div class="E_card"><p class="E_p">' + esc(S.err === 'forbidden' ? M.forbidden : S.err === 'offline' ? 'No connection. Check your signal and try again.' : M.loadFail) + '</p>' + (S.err === 'forbidden' ? '' : '<button class="btn btn-secondary btn-block" type="button" data-e="retry">Try again</button>') + '</div>';
    if (!d) return h + '<div class="E_card E_load" aria-busy="true"><p class="E_sub">Loading…</p></div>';
    var cats = d.categories, total = toC(d.total) || 0, basis = toC(d.basis), pend = d.pending || { count: 0, total: 0 };
    h += '<div class="E_card"><span class="E_eyebrow">Spent this month</span><div class="E_num">' + esc(peso(d.total, true)) + '</div>';
    if (basis) h += '<div class="E_meter" aria-hidden="true"><i style="width:' + Math.min(100, Math.round(total / basis * 100)) + '%"></i></div>';
    if (basis) h += '<p class="E_sub">' + esc('Usual month ' + peso(d.basis, true) + (basisText(d.basis_months) ? ' (' + basisText(d.basis_months) + ')' : '')) + '</p>';
    if (d.prev_total != null) h += '<p class="E_sub">' + esc('Last month ' + peso(d.prev_total, true)) + '</p>';
    if (Number(pend.count) > 0) h += '<button class="E_warnline" type="button" data-e="to-review">' + esc(pend.count + ' waiting for review · ' + peso(pend.total, true) + ' not counted yet') + '</button>';
    if (Number(d.unlinked) > 0) h += '<p class="E_sub E_unl">' + esc(Number(d.unlinked) + (Number(d.unlinked) === 1 ? ' stock purchase is' : ' stock purchases are') + ' not in the expenses yet.') + '</p>';
    h += '</div>';
    var bc = expenseCats(d.by_category);
    if (bc.length) {
      var top = S.allCats ? bc : bc.slice(0, 5), rest = bc.length - top.length;
      h += '<div class="E_card"><span class="E_eyebrow">By category</span>' + top.map(function (c, i) {
        var pc = total > 0 ? Math.round((toC(c.total) || 0) / total * 100) : 0;
        return '<div class="E_cat' + (i === 0 ? ' E_first' : '') + (S.cat === c.category ? ' E_on' : '') + '" role="button" tabindex="0" data-e="cat" data-id="' + esc(c.category) + '"><span class="E_nm">' + esc(c.label || catLabel(c.category, cats)) + '</span><span class="E_am">' + esc(peso(c.total, true)) + '</span><span class="E_bar"><b><i style="width:' + Math.min(100, pc) + '%"></i></b><em>' + pc + '%</em></span></div>';
      }).join('') + (rest > 0 ? '<button class="E_foldline" type="button" data-e="more-cats"><span>' + esc('Other categories (' + rest + ')') + '</span>' + ic('chev', 's16') + '</button>' : '') + '</div>';
    }
    var rows = d.rows || [], pendRows = rows.filter(needsReview), list = rows.filter(function (r) { return !needsReview(r) && (!S.cat || r.category === S.cat); });
    var unp = d.unpriced && Number(d.unpriced.count) > 0 ? d.unpriced : null;
    if (pendRows.length || unp) {
      var shown = S.allReview ? pendRows : pendRows.slice(0, 3);
      h += '<div class="E_card" id="E_review"><div class="E_secthead"><span class="E_eyebrow">Needs review</span>' + (pendRows.length > 3 && !S.allReview ? '<button class="E_link" type="button" data-e="see-all">' + esc('See all (' + (pend.count || pendRows.length) + ')') + '</button>' : '') + '</div>';
      h += shown.map(function (r, i) {
        var lt = lookText(r, rows);
        return '<div class="E_rv' + (i === 0 ? ' E_first' : '') + '" role="button" tabindex="0" data-e="open" data-id="' + esc(r.id) + '"><span class="E_t">' + esc(titleOf(r)) + '</span><span class="E_a">' + esc(peso(r.amount)) + '</span><span class="E_sub">' + esc(fmtDate(r.date) + ' · ' + chipLabel(r.chip)) + '</span>' + (lt ? '<span class="E_look">' + esc(lt) + '</span>' : '') + '</div>';
      }).join('');
      if (unp) {
        h += '<button class="E_foldline" type="button" data-e="unp" aria-expanded="' + (S.unp ? 'true' : 'false') + '"><span>' + esc(unp.count + (Number(unp.count) === 1 ? ' stock purchase has' : ' stock purchases have') + ' no price') + '</span>' + ic('chev', 's16') + '</button>';
        if (S.unp) h += '<div class="E_unp">' + (Array.isArray(unp.items) ? unp.items : []).slice(0, 20).map(function (it) { return '<p class="E_sub">' + esc(typeof it === 'string' ? it : str(it && (it.name || it.label)) || 'Stock item') + '</p>'; }).join('') + '<button class="E_link" type="button" data-e="go-stock">Open Inventory</button></div>';
      }
      h += '</div>';
    }
    h += '<div class="E_chips" role="group" aria-label="Filter">' + FILTERS.map(function (f) { return '<button class="E_chip' + (S.chip === f[0] ? ' E_on' : '') + '" type="button" data-e="chip" data-id="' + f[0] + '" aria-pressed="' + (S.chip === f[0]) + '">' + esc(f[1]) + '</button>'; }).join('') + '</div>';
    if (S.chip === 'review') h += '<button class="E_chip E_on E_catx" type="button" data-e="chip" data-id="all">Needs review ×</button>';
    if (S.chip === 'review' && d.pending_all && Number(d.pending_all.count) > Number(pend.count)) h += '<p class="E_sub E_more_rv">' + esc((Number(d.pending_all.count) - Number(pend.count)) + ' more waiting in earlier months.') + '</p>';
    if (S.cat) h += '<button class="E_chip E_on E_catx" type="button" data-e="cat-x">' + esc(catLabel(S.cat, cats)) + ' ×</button>';
    if (!list.length && !pendRows.length) h += '<div class="E_empty"><p class="E_p">' + esc('No expenses logged for ' + monthName(S.month) + ' yet.') + '</p></div>';
    else h += dayGroups(list).map(function (g) { return '<div class="E_day"><span>' + esc(dayLabel(g.date, S.today)) + '</span><span>' + esc(peso(g.total / 100, true)) + '</span></div>' + g.rows.map(function (r) { return rowHtml(r, cats); }).join(''); }).join('');
    if (d.more) h += '<button class="btn btn-secondary btn-block E_more" type="button" data-e="more">Show more</button>';
    if (d.can_write) h += '<div class="E_sticky"><button class="btn btn-primary" type="button" data-e="add">Add expense</button><button class="btn btn-secondary" type="button" data-e="scan">Scan receipt</button></div>';
    return h;
  }
  function draw() {
    if (!S) return;
    var sh = S.sheet, body = viewScreen(), sheet = '';
    if (sh) sheet = sh.kind === 'add' ? sheetAdd(sh) : sh.kind === 'edit' ? sheetEdit(sh) : sh.kind === 'detail' ? sheetDetail(sh) : sh.kind === 'review' ? sheetReview(sh) : sh.kind === 'void' ? sheetVoid(sh) : sh.kind === 'rm' ? sheetRm(sh) : sh.kind === 'same' ? sheetSame(sh) : '';
    S.el.innerHTML = '<div class="E_page">' + body + '</div>' + sheet + (S.chooser ? chooserHtml() : '');
  }

  // ------------------------------------------------------------------------------------------------ events
  function nav(h) { if (S && S.opts.navigate) S.opts.navigate(h); }
  // The external Pay staff page (the same link the Today shortcut uses), given by the shell. '' when the app has none.
  function payUrl() { try { var u = S && S.opts.payUrl; u = typeof u === 'function' ? u() : u; return typeof u === 'string' ? u : ''; } catch (e) { return ''; } }
  // A bill row opens its own Bills screen when the receipt reference names the bill; otherwise Today.
  function billTarget(r) { var ref = r && r.receipt_ref, id = ref && ref.kind === 'bill' && str(ref.id); return id ? '#bills/pay/' + encodeURIComponent(id) : '#home'; }
  function startReview(r) {
    var c = toC(r.amount), s2 = { kind: 'review', id: r.id, msg: '', busy: false, errs: {}, key: newKey('exp-rev'), keyPrefix: 'exp-rev', f: { amount: c > 0 ? (c / 100).toFixed(2) : '', category: r.category || '', notes: r.notes || '' } };
    S.sheet = s2; S.chooser = false; draw(); loadLink(s2);
  }
  function startEdit(r) { openSheet({ kind: 'edit', id: r.id, f: { date: r.date, amount: toC(r.amount) != null ? (toC(r.amount) / 100).toFixed(2) : '', category: r.category, payee: r.payee || '', notes: r.notes || '' }, reason: '', errs: {}, checks: {}, key: newKey('exp-edit'), keyPrefix: 'exp-edit', msg: '', busy: false }); }
  function onClick(ev) {
    if (!S) return; var t = ev.target, node = t && t.closest ? t.closest('[data-e]') : null; if (!node) return;
    var act = node.getAttribute('data-e'), id = node.getAttribute('data-id'), sh = S.sheet;
    if (act === 'file') return;
    if (ev.preventDefault && act !== 'chooser') { /* labels with files must keep their default */ }
    switch (act) {
      case 'prev': S.month = monthShift(S.month, -1); S.data = null; S.cat = null; load(false); return;
      case 'next': if (S.month < monthOf(S.today)) { S.month = monthShift(S.month, 1); S.data = null; S.cat = null; load(false); } return;
      case 'retry': load(false); return;
      case 'chip': S.chip = id; S.data = null; load(false); return;
      case 'cat': S.cat = S.cat === id ? null : id; draw(); return;
      case 'cat-x': S.cat = null; draw(); return;
      case 'more-cats': S.allCats = true; draw(); return;
      case 'more': load(true); return;
      case 'see-all': S.allReview = true; draw(); return;
      case 'unp': S.unp = !S.unp; draw(); return;
      case 'go-stock': nav('#supply'); return;
      case 'go-items': closeSheet(); nav('#stock'); return;
      case 'to-review': { var el = S.el.querySelector ? S.el.querySelector('#E_review') : null; if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'start' }); } catch (e) { /* ok */ } } return; }
      case 'add': openAdd(false); return;
      case 'scan': openAdd(true); return;
      case 'open': { var r = rowOf(id); if (!r) return; var s2 = { kind: 'detail', id: r.id, msg: '', busy: false }; S.sheet = s2; S.chooser = false; draw(); loadLink(s2); return; }
      case 'close': closeSheet(); return;
      case 'chooser': S.chooser = true; draw(); return;
      case 'chooser-x': S.chooser = false; draw(); return;
      case 'rc-clear': if (sh && sh.kind === 'add') { revoke(sh.thumb); sh.thumb = null; sh.rc = null; sh.pdf = false; sh.stockHint = null; sh.scanMsg = ''; sh.checks = {}; draw(); } return;
      case 'route': doRoute(); return;
      case 'review-add': doReviewAdd(); return;
      case 'add-back': if (sh && sh.kind === 'add') { sh.step = 'form'; sh.msg = ''; draw(); } return;
      case 'save': doAdd(); return;
      case 'edit': { var r2 = sh && rowOf(sh.id); if (r2) startEdit(r2); return; }
      case 'edit-save': doEdit(); return;
      case 'to-detail': { var r3 = sh && rowOf(sh.id); if (r3) { var s3 = { kind: 'detail', id: r3.id, msg: '', busy: false }; S.sheet = s3; draw(); loadLink(s3); } else { closeSheet(); } return; }
      case 'sug': doSuggest(); return;
      case 'review': { var r4 = sh && rowOf(sh.id); if (r4) startReview(r4); return; }
      case 'count': doCount(); return;
      case 'same-as': { var rr = sh && rowOf(sh.id), lk = rr && (rr.lookalike || (rr.lookalike_id && rowOf(rr.lookalike_id))); if (rr && lk) doVoid('Same purchase as ' + refText(lk), lk.id || rr.lookalike_id, 'Marked as the same purchase.'); return; }
      case 'not-cost': doVoid('Not a cost', null, 'Removed from the costs.'); return;
      case 'void-ask': if (sh) { S.sheet = { kind: 'void', id: sh.id, reason: '', errs: {}, msg: '', busy: false, key: newKey('exp-void'), keyPrefix: 'exp-void' }; draw(); } return;
      case 'void-go': doVoid(); return;
      case 'rc-ask': if (sh) { S.sheet = { kind: 'rm', id: sh.id, reason: '', errs: {}, msg: '', busy: false }; draw(); } return;
      case 'rc-go': doRemoveReceipt(); return;
      case 'same-yes': { var lk2 = sh && sh.look; if (lk2) { sh.reason = 'Same purchase as ' + refText(lk2); var ssh = sh; ssh.id = sh.id; doVoid(sh.reason, lk2.id, 'Marked as the same purchase.'); } return; }
      case 'go-bills': { var rb = rowOf(id); closeSheet(); nav(billTarget(rb)); return; }
      default: return;
    }
  }
  function onInput(ev) {
    if (!S || !S.sheet) return; var t = ev.target; if (!t) return;
    if (ev.type === 'change' && t.getAttribute && t.getAttribute('data-e') === 'file') { var file = t.files && t.files[0]; if (file) pickFile(file); try { t.value = ''; } catch (e) { /* ok */ } return; }
    var f = t.getAttribute && t.getAttribute('data-f'); if (!f) return; var sh = S.sheet, v = t.value;
    var qs = function (a) { return S.el && S.el.querySelector ? S.el.querySelector('[data-e="' + a + '"]') : null; }, off = function (a, v2) { var b = qs(a); if (b) b.disabled = v2; };
    if (f === 'reason') { sh.reason = v; var go = sh.kind === 'void' ? 'void-go' : sh.kind === 'rm' ? 'rc-go' : ''; if (go) off(go, String(v).trim().length < 3); return; }
    if (sh.f) {
      sh.f[f] = v; if (sh.checks) delete sh.checks[f]; if (sh.errs) delete sh.errs[f];
      if (sh.kind === 'review' && f === 'amount') { var rr = rowOf(sh.id); off('count', !!sh.busy || (!(rr && (rr.amount_locked || rr.locked)) && parseAmount(v) === null)); }
      if (f === 'category' && ev.type === 'change') draw();
    }
  }

  // ------------------------------------------------------------------------------------------------ mount
  function mount(el, opts) {
    opts = opts || {}; if (S) unmount();
    if (!/^(owner|admin|finance)$/.test(String(opts.role || ''))) { if (opts.navigate) opts.navigate('#home'); return; }
    var sub = String(opts.sub || ''), back = sub === 'add/back', carry = CARRY; CARRY = null;
    if (!back) clearHeld();
    S = { el: el, opts: opts, client: opts.client, role: opts.role, gen: ++G, today: manilaToday(), month: monthOf(manilaToday()), chip: 'all', cat: null, data: null, err: '', sheet: null, chooser: false, timers: [] };
    S.onClick = onClick; S.onInput = onInput;
    el.addEventListener('click', S.onClick); el.addEventListener('input', S.onInput); el.addEventListener('change', S.onInput);
    el.addEventListener('submit', function (e) { if (e && e.preventDefault) e.preventDefault(); });
    if (sub === 'review') S.chip = 'review'; // the Today card's "n to review": the server's needs-review filter
    if (back) restoreHeld(); else if (carry && !sub && clock() - carry.at < 10000) S.sheet = carry.sheet; else if (sub === 'add') openAdd(false);
    draw(); load(false);
  }
  function unmount() {
    if (!S) return;
    try { S.el.removeEventListener('click', S.onClick); S.el.removeEventListener('input', S.onInput); S.el.removeEventListener('change', S.onInput); } catch (e) { /* ok */ }
    if (S.sheet) revoke(S.sheet.thumb); (S.timers || []).forEach(function (t) { clearTimeout(t); }); G++; S = null; // HELD survives: the person is in Inventory
  }
  function reset() { unmount(); clearHeld(); CARRY = null; }

  var api = {
    mount: mount, unmount: unmount, reset: reset,
    _held: function () { return HELD; },
    _setRpcTimeout: function (ms) { RPC_TIMEOUT_MS = ms; }, _setClock: function (fn) { clock = fn || function () { return Date.now(); }; },
    lib: { esc: esc, peso: peso, parseAmount: parseAmount, toC: toC, monthOf: monthOf, monthShift: monthShift, monthName: monthName, fmtDate: fmtDate, dayLabel: dayLabel, chipLabel: chipLabel, chipKey: chipKey, needsReview: needsReview, titleOf: titleOf, catList: catList, catLabel: catLabel,
      validateExpense: validateExpense, expenseTxn: expenseTxn, editPayload: editPayload, changedKeys: changedKeys, suggestion: suggestion, suggestPrefill: suggestPrefill, refText: refText, dupMsg: dupMsg, fileCheck: fileCheck, isPdf: isPdf, basisText: basisText,
      canRoute: canRoute, routeVisible: routeVisible, nudgeFor: nudgeFor, dayGroups: dayGroups, expenseCats: expenseCats, lookText: lookText, receiptWords: receiptWords, saveWords: saveWords, plainError: plainError, FILTERS: FILTERS, MESSAGES: M, MAX_FILE: MAX_FILE, manilaToday: manilaToday }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.E_Expenses = api;
})();
