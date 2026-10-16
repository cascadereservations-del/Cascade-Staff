/* Cascade Staff s89, lane L6: Ops. Phone-native work orders (list, create, mark done, reopen) and next-turnover cleaning readiness (read only).
   Same database and same server paths as the React dashboard (admin-dashboard/app/src/features/operations/api.ts and features/today/api.ts):
     work orders  read  = from('work_orders') under RLS (read_operations)         api.ts fetchWorkOrders
                  write = rpc save_work_order_v1 (manage_maintenance, audited)    api.ts saveWorkOrder
     readiness    read  = rpc get_admin_overview_v1 + cleaning_sessions + cleaning_verification_evidence (RLS read_operations)
   Business rules stay on the server (version check, resolution note, role check). The client only formats and checks the form.
   Mounted by the shell: window.N_OPS.mount(el, { client, access, propertyId?, demo?, navigate?, toast?, haptic?, newKey? }).
   access is the shell's state.access ({ role, property_ids }). Nothing is stored in the browser. No build step; every top-level name is inside this closure. */
(function () {
  'use strict';

  // ------------------------------------------------------------------------------------------------ pure helpers (tested)
  var FALLBACK_PROPERTY = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'; // same constant as app.js CFG.propertyId
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // capabilities.ts ROLE_ACTIONS: read_operations is every role; manage_maintenance is owner, admin, maintenance.
  var READ_ROLES = ['owner', 'admin', 'finance', 'inspector', 'cleaner', 'maintenance'];
  var WRITE_ROLES = ['owner', 'admin', 'maintenance'];
  var PRIORITIES = ['low', 'normal', 'high', 'urgent'];
  var PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
  var AREAS = ['Bedroom', 'Bathroom', 'Kitchen', 'Living area', 'Outdoor', 'Utilities', 'Other'];
  var STATUS_LABEL = { open: 'Open', in_progress: 'In progress', awaiting_external: 'Waiting on someone', resolved: 'Done', cancelled: 'Cancelled' };
  var NO_CONNECTION = 'No connection, so nothing was sent.';
  var DROPPED = 'The connection dropped before an answer came. Check the list before you try again.';
  var AREA_RE = /^Area: ([^\n]{1,40})(?:\n\n|\n|$)/;

  var clock = function () { return Date.now(); };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function roleOf(access) { return access && typeof access.role === 'string' ? access.role : ''; }
  function canRead(access) { return READ_ROLES.indexOf(roleOf(access)) >= 0; }
  function canWrite(access) { return WRITE_ROLES.indexOf(roleOf(access)) >= 0; }
  function isoOf(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function utc(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function manilaToday(ms) { return isoOf((ms == null ? clock() : ms) + 8 * 3600000); } // Asia/Manila is UTC+8, no daylight saving
  function addDays(iso, n) { return isoOf(utc(iso) + n * 86400000); }
  function fmtDate(iso) { if (!iso) return '—'; var d = new Date(utc(iso)); return DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }
  function relDay(iso, today) { if (iso === today) return 'Today'; if (iso === addDays(today, 1)) return 'Tomorrow'; if (iso === addDays(today, -1)) return 'Yesterday'; return fmtDate(iso); }
  function fmtDateTime(ts) { // Manila wall clock, "13 Oct, 2:30 pm"
    var ms = Date.parse(ts); if (!isFinite(ms)) return '—';
    var d = new Date(ms + 8 * 3600000), h = d.getUTCHours();
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ', ' + (h % 12 || 12) + ':' + pad2(d.getUTCMinutes()) + ' ' + (h >= 12 ? 'pm' : 'am');
  }
  function count(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // "Open 3 days", "Open 5 hours", "Open today": age from created_at (or resolved_at for a finished one)
  function ageText(ts, now) {
    var ms = Date.parse(ts); if (!isFinite(ms)) return '';
    var mins = Math.max(0, Math.floor(((now == null ? clock() : now) - ms) / 60000));
    if (mins < 60) return 'just now';
    if (mins < 1440) return count(Math.floor(mins / 60), 'hour', 'hours');
    return count(Math.floor(mins / 1440), 'day', 'days');
  }
  function prioRank(p) { var i = PRIORITIES.indexOf(p); return i < 0 ? 1 : i; }
  // Blocking first, then urgent to low, then oldest first: the order a person would work the list.
  function sortOrders(rows) {
    return rows.slice().sort(function (a, b) {
      return (b.blocks_arrival ? 1 : 0) - (a.blocks_arrival ? 1 : 0) || prioRank(b.priority) - prioRank(a.priority) || Date.parse(a.created_at) - Date.parse(b.created_at);
    });
  }
  function isOpen(w) { return w.status !== 'resolved' && w.status !== 'cancelled'; }
  function areaOf(desc) { var m = AREA_RE.exec(String(desc || '')); return m ? m[1] : ''; }
  function noteOf(desc) { return String(desc || '').replace(AREA_RE, '').trim(); }
  // The table has no area column, so the area travels as the first line of the description ("Area: Kitchen").
  function buildDescription(area, note) {
    var n = String(note || '').trim(), a = AREAS.indexOf(area) >= 0 ? area : '';
    return (a ? 'Area: ' + a + (n ? '\n\n' : '') : '') + n;
  }
  function validateNew(f) {
    var e = {}, t = String(f.title || '').trim();
    if (t.length < 3) e.title = 'Write a short title, at least 3 letters.';
    if (t.length > 120) e.title = 'Keep the title under 120 letters.';
    if (PRIORITIES.indexOf(f.priority) < 0) e.priority = 'Choose a priority.';
    if (String(f.note || '').length > 1000) e.note = 'Keep the note under 1000 letters.';
    return e;
  }
  // p_order for a new work order: the keys save_work_order_v1 reads on insert
  function newOrder(f) {
    return { source_kind: 'manual', title: String(f.title).trim(), description: buildDescription(f.area, f.note), priority: f.priority, blocks_arrival: !!f.blocks };
  }
  // p_order to finish one: id + expected_version make the server reject a stale edit; a resolution note is required by the server too
  function doneOrder(w, resolution) { return { id: w.id, expected_version: w.version, status: 'resolved', resolution: String(resolution || '').trim() }; }
  function reopenOrder(w) { return { id: w.id, expected_version: w.version, status: 'open' }; }
  function workOrderCall(propertyId, order, key) { return { p_property_id: propertyId, p_order: order, p_idempotency_key: key }; }

  // readiness copy, from get_admin_overview_v1 readiness.state (today-page.tsx ReadinessCard)
  var READY_TEXT = { ready: 'Ready', not_ready: 'Not ready', unknown: 'Not known yet', awaiting_review: 'Cleaned, waiting for your review', overdue: 'No cleaning report yet' };
  function readyKind(state) { return state === 'ready' ? 'ok' : (state === 'not_ready' || state === 'overdue') ? 'bad' : 'warn'; }
  var OUTCOME_TEXT = { ready: 'Ready', not_ready: 'Not ready', override_ready: 'Ready by override', reviewed: 'Reviewed', follow_up_required: 'Follow-up needed', resolved: 'Resolved' };
  function outcomeText(o) { return OUTCOME_TEXT[o] || (o ? String(o).replace(/_/g, ' ') : ''); }
  // Inspector result = the newest human review across the session's evidence rows; with none, say so rather than guess from the advisory result.
  function inspectorResult(evidence) {
    var best = null;
    (evidence || []).forEach(function (ev) { ((ev && ev.reviews) || []).forEach(function (r) { if (r && r.outcome && (!best || Date.parse(r.reviewed_at) > Date.parse(best.reviewed_at))) best = r; }); });
    if (best) return { kind: best.outcome === 'follow_up_required' ? 'warn' : 'ok', text: outcomeText(best.outcome), at: best.reviewed_at, reason: best.reason || '' };
    return { kind: 'warn', text: (evidence && evidence.length) ? 'Not reviewed yet' : 'No inspection on file', at: null, reason: '' };
  }
  function pctText(v) { var n = Number(v); return v == null || v === '' || !isFinite(n) ? '—' : Math.round(n) + '%'; }

  // ---- errors in plain words (same classes as N_manage)
  function errCode(e) { return e && (e.code || (e.error && e.error.code)) || ''; }
  function errMsg(e) { return String((e && (e.message || (e.error && e.error.message))) || e || ''); }
  function isMissing(e) { var c = String(errCode(e)), m = errMsg(e); return c === 'PGRST202' || c === '42883' || c === '42P01' || c === 'PGRST205' || (e && e.status === 404) || /could not find the function|does not exist|schema cache/i.test(m); }
  function isDenied(e) { var c = String(errCode(e)), m = errMsg(e); return c === '42501' || (e && (e.status === 401 || e.status === 403)) || /not authori|permission denied|denied/i.test(m); }
  function isOffline(e) { return /failed to fetch|networkerror|network request failed|load failed|timeout|fetch failed/i.test(errMsg(e)) || (e && e.status === 0); }
  function isStale(e) { return String(errCode(e)) === '40001' || /stale version/i.test(errMsg(e)); }
  function plainError(e, writing) {
    if (isOffline(e)) return writing ? DROPPED : 'No connection.';
    if (isDenied(e)) return 'Your account is not allowed to do this.';
    if (isStale(e)) return 'Someone else changed this work order. The list is refreshed; look again and retry.';
    if (writing && String(errCode(e)) === '22023' && errMsg(e)) return errMsg(e);
    return writing ? 'The server did not answer clearly. Check the list before you try again.' : 'This could not be loaded.';
  }

  // ------------------------------------------------------------------------------------------------ demo sample
  function demoData(today) {
    var at = function (n) { return new Date(clock() - n * 3600000).toISOString(); };
    return {
      orders: [
        { id: 'o-demo-1', title: 'Sample: bathroom tap drips', description: 'Area: Bathroom\n\nSlow drip, worse at night.', priority: 'high', blocks_arrival: true, status: 'open', created_at: at(70), updated_at: at(70), version: 1, resolution: null, resolved_at: null },
        { id: 'o-demo-2', title: 'Sample: replace hallway bulb', description: 'Area: Living area', priority: 'low', blocks_arrival: false, status: 'open', created_at: at(5), updated_at: at(5), version: 1, resolution: null, resolved_at: null },
        { id: 'o-demo-3', title: 'Sample: gate latch tightened', description: null, priority: 'normal', blocks_arrival: false, status: 'resolved', created_at: at(200), updated_at: at(30), version: 3, resolution: 'Tightened and tested.', resolved_at: at(30) }
      ],
      ready: { today: today, nextArrival: { guest: 'Sample Guest', checkin: addDays(today, 1) }, readiness: { state: 'awaiting_review', blockingWorkOrders: 1, nextCheckin: addDays(today, 1), lastCheckout: today, daysOverdue: null,
        lastCleaning: { id: 'c-demo-1', cleanedAt: at(3), cleaner: 'Sample cleaner', complete: true, completionPct: '96', issues: 1 }, review: null },
        session: { completion_pct: '96', is_complete: true, incomplete_reasons: null, issue_count: 1, total_photo_count: 14, cleaned_at: at(3) }, evidence: [] }
    };
  }

  // ------------------------------------------------------------------------------------------------ mounted module
  var S = null, N_gen = 0;
  var RPC_TIMEOUT_MS = 30000;
  function newKeyDefault(prefix) {
    var hex = '';
    try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { var a = new Uint8Array(16); crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) hex += pad2(a[i].toString(16)).slice(-2); } } catch (e) { hex = ''; }
    while (hex.length < 32) hex += Math.floor(Math.random() * 16).toString(16);
    return prefix + '-' + hex; // 35 chars: inside the RPC's 16..160 range
  }
  function mintKey(prefix) { return (S && S.opts.newKey ? S.opts.newKey : newKeyDefault)(prefix); }
  function pid() { var a = S && S.opts.access; return (S && S.opts.propertyId) || (a && a.property_ids && a.property_ids[0]) || FALLBACK_PROPERTY; }
  function online() { try { return !(typeof navigator !== 'undefined' && navigator.onLine === false); } catch (e) { return true; } }
  function timed(p) { // a hung request settles as a dropped connection after 30 s; a late answer is ignored
    var st = S;
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { fin({ data: null, error: { message: 'timeout' } }); }, RPC_TIMEOUT_MS);
      st.timers = st.timers || []; st.timers.push(t);
      function fin(r) { if (done) return; done = true; clearTimeout(t); resolve(r); }
      try { Promise.resolve(p()).then(function (r) { fin(r || { data: null, error: null }); }, function (e) { fin({ data: null, error: e || { message: 'failed to fetch' } }); }); }
      catch (e) { fin({ data: null, error: e }); }
    });
  }
  function callRpc(name, args) { return timed(function () { return S.client.rpc(name, args); }); }

  // ---- loads
  function loadOrders(force) {
    var st = S.d.orders || (S.d.orders = {}); if (st.busy || (st.ok && !force)) return;
    st.busy = true; st.err = ''; var gen = S.gen; draw();
    var fin = function (res) {
      if (!S || S.gen !== gen) return; st.busy = false;
      if (res.error) { st.ok = false; st.missing = isMissing(res.error); st.denied = isDenied(res.error); st.err = plainError(res.error, false); }
      else { st.ok = true; st.missing = false; st.denied = false; st.rows = res.data || []; }
      draw();
    };
    if (S.demo) { Promise.resolve().then(function () { fin({ data: S.demoData.orders.slice(), error: null }); }); return; }
    timed(function () { // dashboard fetchWorkOrders, newest 200
      return S.client.from('work_orders').select('*').eq('property_id', pid()).order('blocks_arrival', { ascending: false }).order('created_at', { ascending: true }).limit(200);
    }).then(fin);
  }
  function loadReady(force) {
    var st = S.d.ready || (S.d.ready = {}); if (st.busy || (st.ok && !force)) return;
    st.busy = true; st.err = ''; var gen = S.gen; draw();
    var fin = function (res) {
      if (!S || S.gen !== gen) return; st.busy = false;
      if (res.error) { st.ok = false; st.denied = isDenied(res.error); st.err = plainError(res.error, false); } else { st.ok = true; st.denied = false; st.data = res.data; }
      draw();
    };
    if (S.demo) { Promise.resolve().then(function () { fin({ data: S.demoData.ready, error: null }); }); return; }
    callRpc('get_admin_overview_v1', { p_property_id: pid() }).then(function (r) { // today/api.ts:31
      if (r.error || !r.data) return fin(r);
      var o = r.data, lc = o.readiness && o.readiness.lastCleaning, out = { today: o.today, nextArrival: o.nextArrival, readiness: o.readiness || {}, session: null, evidence: [] };
      if (!lc || !lc.id) return fin({ data: out, error: null });
      var sel = function (table, cols, col) { return timed(function () { return S.client.from(table).select(cols).eq(col, lc.id).limit(20); }); };
      Promise.all([
        timed(function () { return S.client.from('cleaning_sessions').select('id, cleaned_at, completion_pct, is_complete, incomplete_reasons, issue_count, total_photo_count').eq('id', lc.id).limit(1); }),
        sel('cleaning_verification_evidence', 'id, evidence_kind, advisory_result, reviews:cleaning_verification_reviews(outcome, reason, reviewed_at)', 'cleaning_session_id')
      ]).then(function (a) { // the overview already answered; a detail that fails leaves its rows as "not known", never as zero
        out.session = !a[0].error && a[0].data && a[0].data[0] ? a[0].data[0] : null; out.sessionFailed = !!a[0].error;
        out.evidence = !a[1].error && a[1].data ? a[1].data : []; out.evidenceFailed = !!a[1].error;
        fin({ data: out, error: null });
      });
    });
  }

  // ---- views
  function pill(kind, text) { return '<span class="O_pill O_' + kind + '">' + esc(text) + '</span>'; }
  function stateBox(st, label, retry) {
    if (st.busy && !st.ok) return '<div class="O_note" role="status">Loading ' + esc(label) + '…</div>';
    if (st.missing) return '<div class="O_note">' + esc(label.charAt(0).toUpperCase() + label.slice(1)) + ' is not available in this version of the app yet.</div>';
    if (st.denied) return '<div class="O_note">Your account is not allowed to see ' + esc(label) + '.</div>';
    if (st.err) return '<div class="O_err" role="alert"><span>' + esc(st.err) + '</span><button class="btn btn-secondary" type="button" data-o="' + retry + '">Try again</button></div>';
    return '';
  }
  function tabsHtml() {
    return '<div class="O_seg" role="tablist" aria-label="Ops"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + [['orders', 'Work orders'], ['ready', 'Cleaning']].map(function (t) {
      return '<button class="O_tab" type="button" role="tab" id="O_tab_' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '" data-o="tab" data-v="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }
  function orderRow(w) {
    var ar = areaOf(w.description), done = !isOpen(w);
    var sub = [PRIORITY_LABEL[w.priority] || w.priority, ar, done ? (STATUS_LABEL[w.status] + (w.resolved_at ? ' ' + ageText(w.resolved_at) + ' ago' : '')) : 'Open ' + ageText(w.created_at)].filter(Boolean).join(' · ');
    return '<button class="O_row" type="button" data-o="open" data-v="' + esc(w.id) + '"><span class="O_rowmid"><span class="O_rowt">' + esc(w.title) + '</span><span class="O_rows">' + esc(sub) + '</span></span>' +
      (w.blocks_arrival && !done ? pill('bad', 'Blocks arrival') : '') + '<span class="O_chev" aria-hidden="true">›</span></button>';
  }
  function viewOrders() {
    var st = S.d.orders || {}, bx = stateBox(st, 'work orders', 'retry');
    var head = '<div class="O_bar"><div class="O_chips" role="group" aria-label="Show">' + [['open', 'Open'], ['done', 'Done']].map(function (f) {
      return '<button class="O_chip" type="button" aria-pressed="' + (S.filter === f[0]) + '" data-o="filter" data-v="' + f[0] + '">' + f[1] + '</button>';
    }).join('') + '</div>' + (S.write ? '<button class="btn btn-primary" type="button" data-o="new">New work order</button>' : '') + '</div>';
    if (bx && !st.rows) return head + bx;
    var rows = sortOrders((st.rows || []).filter(function (w) { return S.filter === 'open' ? isOpen(w) : !isOpen(w); }));
    if (S.filter === 'done') rows.sort(function (a, b) { return Date.parse(b.updated_at) - Date.parse(a.updated_at); });
    var list = rows.length ? '<section class="O_card O_list" aria-label="Work orders">' + rows.map(orderRow).join('') + '</section>'
      : '<div class="O_note">' + (S.filter === 'open' ? 'Nothing is open. The house has no repair waiting.' : 'No finished work orders yet.') + '</div>';
    return head + (bx || '') + list + (S.write ? '' : '<p class="O_p">You can read work orders. Owner, admin and maintenance can change them.</p>');
  }
  function viewReady() {
    var st = S.d.ready || {}, bx = stateBox(st, 'cleaning readiness', 'retry');
    if (!st.ok) return bx || '<div class="O_note">Loading cleaning readiness…</div>';
    var d = st.data, r = d.readiness || {}, rs = r.state || 'unknown', lc = r.lastCleaning, s = d.session, today = d.today || S.today;
    var na = d.nextArrival, nextIn = (na && na.checkin) || r.nextCheckin;
    var txt = rs === 'overdue' && r.daysOverdue != null ? 'No cleaning report, ' + count(r.daysOverdue, 'day', 'days') + ' overdue' : READY_TEXT[rs] || READY_TEXT.unknown;
    var out = '<section class="O_card" aria-labelledby="O_r1"><h3 class="O_h3" id="O_r1">Next turnover</h3><p>' + pill(readyKind(rs), txt) + '</p><dl class="O_dl">' +
      '<dt>Next check-in</dt><dd>' + (nextIn ? esc(relDay(nextIn, today) + (na && na.guest ? ', ' + na.guest : '')) : 'None booked') + '</dd>' +
      '<dt>Blocking work orders</dt><dd>' + (r.blockingWorkOrders > 0 ? '<button class="O_link" type="button" data-o="tab" data-v="orders">' + esc(String(r.blockingWorkOrders)) + ', see the list</button>' : '0') + '</dd></dl></section>';
    if (!lc) return bx + out + '<div class="O_note">No cleaning session on file for the last checkout.</div>';
    var ins = inspectorResult(d.evidence), rv = r.review;
    var pct = s ? s.completion_pct : lc.completionPct, done = s ? s.is_complete : lc.complete, issues = s ? s.issue_count : lc.issues;
    out += '<section class="O_card" aria-labelledby="O_r2"><h3 class="O_h3" id="O_r2">Last cleaning</h3><dl class="O_dl">' +
      '<dt>Cleaned</dt><dd>' + esc(fmtDateTime(lc.cleanedAt)) + (lc.cleaner ? ', ' + esc(lc.cleaner) : '') + '</dd>' +
      '<dt>Checklist</dt><dd>' + (pct == null ? 'Not known' : esc(pctText(pct)) + (done === false ? ' · not complete' : done ? ' · complete' : '')) + '</dd>' +
      '<dt>Issues noted</dt><dd>' + (issues == null ? 'Not known' : esc(String(issues))) + '</dd>' +
      '<dt>Photos</dt><dd>' + (s && s.total_photo_count != null ? esc(String(s.total_photo_count)) : (st.data.sessionFailed ? 'Could not load' : 'Not known')) + '</dd>' +
      '<dt>Inspector</dt><dd>' + (st.data.evidenceFailed ? 'Could not load' : pill(ins.kind, ins.text) + (ins.at ? ' <span class="O_rows">' + esc(fmtDateTime(ins.at)) + '</span>' : '')) + (ins.reason ? '<span class="O_rows O_blk">' + esc(ins.reason) + '</span>' : '') + '</dd>' +
      '<dt>Your readiness review</dt><dd>' + (rv ? esc(outcomeText(rv.outcome) + ', ' + fmtDateTime(rv.reviewedAt)) + (rv.reason ? '<span class="O_rows O_blk">' + esc(rv.reason) + '</span>' : '') : 'Not reviewed yet') + '</dd></dl></section>';
    return bx + out + '<p class="O_p">Read only. Decide readiness in the dashboard.</p>';
  }

  // ---- sheets
  function field(id, label, control, err) { return '<div class="O_field"><label class="O_lbl" for="' + id + '">' + esc(label) + '</label>' + control + (err ? '<p class="O_ferr" id="' + id + '-e" role="alert"><span aria-hidden="true">✕</span> ' + esc(err) + '</p>' : '') + '</div>'; }
  function shell(title, body) { return '<div class="O_scrim" aria-hidden="true"></div><div class="O_sheet" role="dialog" aria-modal="true" aria-labelledby="O_sh"><div class="O_grab" aria-hidden="true"></div><h2 class="O_h" id="O_sh" tabindex="-1" data-o-focus="1">' + esc(title) + '</h2>' + body + '</div>'; }
  function orderOf(id) { var rows = (S.d.orders && S.d.orders.rows) || []; for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }
  function sheetErr(sh) { return sh.msg ? '<div class="O_err" role="alert"><span>' + esc(sh.msg) + '</span></div>' : ''; }
  function btns(label, act, busy, second, secondAct) {
    return '<div class="O_btns"><button class="btn btn-primary btn-block" type="button" data-o="' + act + '"' + (busy ? ' disabled aria-busy="true"' : '') + '>' + esc(busy ? 'Sending…' : label) + '</button>' +
      '<button class="btn btn-secondary btn-block" type="button" data-o="' + (secondAct || 'close') + '"' + (busy ? ' disabled' : '') + '>' + esc(second || 'Cancel') + '</button></div>';
  }
  function sheetHtml() {
    var sh = S.sheet; if (!sh) return '';
    if (sh.kind === 'new') {
      var f = sh.f, e = sh.errs || {};
      return shell('New work order',
        field('O_title', 'What needs doing', '<input class="O_input" id="O_title" data-f="title" value="' + esc(f.title) + '" maxlength="120" autocomplete="off"' + (e.title ? ' aria-invalid="true" aria-describedby="O_title-e"' : '') + '>', e.title) +
        field('O_area', 'Area', '<select class="O_select" id="O_area" data-f="area"><option value="">Not sure</option>' + AREAS.map(function (a) { return '<option' + (f.area === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select>') +
        '<fieldset class="O_fs"><legend class="O_lbl">Priority</legend><div class="O_chips">' + PRIORITIES.map(function (p) { return '<button class="O_chip" type="button" aria-pressed="' + (f.priority === p) + '" data-o="prio" data-v="' + p + '">' + PRIORITY_LABEL[p] + '</button>'; }).join('') + '</div></fieldset>' +
        field('O_note', 'Note (optional)', '<textarea class="O_input O_ta" id="O_note" data-f="note" rows="3" maxlength="1000">' + esc(f.note) + '</textarea>', e.note) +
        '<label class="O_chk"><input type="checkbox" data-f="blocks"' + (f.blocks ? ' checked' : '') + '> Blocks the next arrival</label>' +
        sheetErr(sh) + btns('Save work order', 'new-send', sh.busy));
    }
    var w = orderOf(sh.id); if (!w) return '';
    var ar = areaOf(w.description), nt = noteOf(w.description);
    var dl = '<dl class="O_dl"><dt>Status</dt><dd>' + esc(STATUS_LABEL[w.status] || w.status) + '</dd><dt>Priority</dt><dd>' + esc(PRIORITY_LABEL[w.priority] || w.priority) + '</dd>' +
      (ar ? '<dt>Area</dt><dd>' + esc(ar) + '</dd>' : '') + '<dt>Opened</dt><dd>' + esc(fmtDateTime(w.created_at) + ' · ' + ageText(w.created_at)) + '</dd>' +
      (w.blocks_arrival && isOpen(w) ? '<dt>Arrival</dt><dd>' + pill('bad', 'Blocks arrival') + '</dd>' : '') +
      (w.resolution ? '<dt>Result</dt><dd>' + esc(w.resolution) + '</dd>' : '') + '</dl>' + (nt ? '<p class="O_box">' + esc(nt) + '</p>' : '');
    if (sh.kind === 'done') {
      return shell('Mark done', '<p class="O_p">' + esc(w.title) + '</p>' + field('O_res', 'What was done', '<textarea class="O_input O_ta" id="O_res" data-f="resolution" rows="3" maxlength="500">' + esc(sh.resolution) + '</textarea>', sh.err) +
        sheetErr(sh) + btns('Mark done', 'done-send', sh.busy, 'Back', 'back'));
    }
    var act = '';
    if (S.write) act = isOpen(w) ? '<button class="btn btn-primary btn-block" type="button" data-o="done-start">Mark done</button>' : (w.status === 'resolved' ? '<button class="btn btn-secondary btn-block" type="button" data-o="reopen"' + (sh.busy ? ' disabled aria-busy="true"' : '') + '>' + (sh.busy ? 'Sending…' : 'Reopen') + '</button>' : '');
    return shell(w.title, dl + sheetErr(sh) + '<div class="O_btns">' + act + '<button class="btn btn-secondary btn-block" type="button" data-o="close"' + (sh.busy ? ' disabled' : '') + '>Close</button></div>');
  }
  function draw() {
    if (!S) return;
    var body = S.tab === 'ready' ? viewReady() : viewOrders();
    var live = S.notice ? '<div class="O_okbox" role="status">' + esc(S.notice) + '</div>' : '';
    S.el.innerHTML = '<div class="O_root">' + tabsHtml() + live + '<div class="O_body" role="tabpanel" aria-labelledby="O_tab_' + S.tab + '"' + (S.sheet ? ' inert aria-hidden="true"' : '') + '>' + body + '</div></div>' + sheetHtml();
    if (S.sheet && S.sheet.focus !== false) { try { var h = S.el.querySelector('[data-o-focus]'); if (h && h.focus) h.focus(); } catch (e) { /* no focus in tests */ } S.sheet.focus = false; }
  }

  // ---- actions
  function buzz(k) { try { if (S.opts.haptic) S.opts.haptic(k); } catch (e) { /* optional */ } }
  function tell(m) { try { if (S.opts.toast) S.opts.toast(m); } catch (e) { /* optional */ } }
  // One write. A dropped connection keeps the key (a repeat is safe); a readable answer replaces it.
  function send(order, key, okMsg, onFail) {
    var sh = S.sheet; if (!sh || sh.busy || !S.write) return;
    sh.msg = '';
    if (!online()) { sh.msg = NO_CONNECTION; draw(); return; }
    sh.busy = true; draw();
    var gen = S.gen;
    var settle = function (res) {
      if (!S || S.gen !== gen) return; sh.busy = false;
      if (res.error || !res.data || res.data.ok !== true) {
        var e = res.error || { message: 'unclear' };
        sh.msg = isMissing(e) ? 'This is not available in this version of the app yet.' : plainError(e, true);
        if (!isOffline(e)) { sh.key = mintKey('wo'); if (onFail) onFail(); }
        if (isStale(e)) { S.sheet = null; loadOrders(true); S.notice = sh.msg; }
        draw(); return;
      }
      buzz('success'); tell(okMsg); S.notice = okMsg; S.sheet = null; loadOrders(true); draw();
    };
    if (S.demo) { Promise.resolve().then(function () { applyDemo(order); settle({ data: { ok: true }, error: null }); }); return; }
    callRpc('save_work_order_v1', workOrderCall(pid(), order, key)).then(settle);
  }
  function applyDemo(o) {
    var rows = S.demoData.orders;
    if (!o.id) { rows.unshift({ id: 'o-demo-' + (rows.length + 1), title: o.title, description: o.description, priority: o.priority, blocks_arrival: o.blocks_arrival, status: 'open', created_at: new Date(clock()).toISOString(), updated_at: new Date(clock()).toISOString(), version: 1, resolution: null, resolved_at: null }); return; }
    rows.forEach(function (w) { if (w.id === o.id) { w.status = o.status; w.version++; if (o.resolution) w.resolution = o.resolution; w.resolved_at = o.status === 'resolved' ? new Date(clock()).toISOString() : null; } });
  }
  function onClick(ev) {
    if (!S) return; var t = ev.target && ev.target.closest ? ev.target.closest('[data-o]') : null; if (!t) return;
    var a = t.getAttribute('data-o'), v = t.getAttribute('data-v'), sh = S.sheet;
    if (t.disabled || t.getAttribute('aria-busy') === 'true') return;
    if (sh && sh.busy) return; // a request is in flight: nothing may orphan its sheet
    if (a === 'tab') { S.tab = v === 'ready' ? 'ready' : 'orders'; S.sheet = null; S.notice = ''; draw(); if (S.tab === 'ready') loadReady(false); else loadOrders(false); return; }
    if (a === 'retry') { S.notice = ''; if (S.tab === 'ready') loadReady(true); else loadOrders(true); return; }
    if (a === 'filter') { S.filter = v === 'done' ? 'done' : 'open'; draw(); return; }
    S.notice = '';
    if (a === 'open') { if (orderOf(v)) { S.sheet = { kind: 'order', id: v, msg: '', focus: true }; draw(); } return; }
    if (a === 'new') { if (!S.write) return; S.sheet = { kind: 'new', key: mintKey('wo'), busy: false, msg: '', errs: {}, focus: true, f: { title: '', area: '', priority: 'normal', note: '', blocks: false } }; draw(); return; }
    if (!sh) return;
    if (a === 'close') { S.sheet = null; draw(); return; }
    if (a === 'back') { S.sheet = { kind: 'order', id: sh.id, msg: '', focus: true }; draw(); return; }
    if (a === 'prio') { if (sh.f) { sh.f.priority = v; draw(); } return; }
    if (a === 'new-send') { sh.errs = validateNew(sh.f); if (Object.keys(sh.errs).length) { sh.msg = 'Please fix the item marked below.'; draw(); return; } send(newOrder(sh.f), sh.key, 'Work order saved: ' + String(sh.f.title).trim() + '.'); return; }
    if (a === 'done-start') { S.sheet = { kind: 'done', id: sh.id, key: mintKey('wo'), busy: false, msg: '', err: '', resolution: '', focus: true }; draw(); return; }
    if (a === 'done-send') { var w = orderOf(sh.id); if (!w) return; if (String(sh.resolution).trim().length < 3) { sh.err = 'Write what was done, at least 3 letters.'; sh.msg = 'Please fix the item marked below.'; draw(); return; } send(doneOrder(w, sh.resolution), sh.key, 'Marked done: ' + w.title + '.'); return; }
    if (a === 'reopen') { var w2 = orderOf(sh.id); if (!w2) return; sh.key = sh.key || mintKey('wo'); send(reopenOrder(w2), sh.key, 'Reopened: ' + w2.title + '.'); return; }
  }
  function onInput(ev) {
    if (!S || !S.sheet) return; var t = ev.target; if (!t || !t.getAttribute) return; var f = t.getAttribute('data-f'); if (!f) return;
    var val = t.type === 'checkbox' ? !!t.checked : t.value, sh = S.sheet;
    if (sh.kind === 'done' && f === 'resolution') { sh.resolution = val; return; }
    if (sh.f && f in sh.f) sh.f[f] = val;
  }
  function onVisible() {
    var doc = (typeof document !== 'undefined') ? document : null;
    if (!S || !doc || doc.visibilityState !== 'visible' || S.sheet || clock() - S.loadedAt < 5 * 60000) return;
    S.loadedAt = clock(); if (S.tab === 'ready') loadReady(true); else loadOrders(true);
  }

  function mount(el, opts) {
    opts = opts || {};
    if (S) unmount();
    if (!canRead(opts.access)) { if (opts.navigate) opts.navigate('#home'); return; }
    S = { el: el, opts: opts, client: opts.client, demo: !!opts.demo, gen: ++N_gen, today: manilaToday(), d: {}, sheet: null, notice: '', tab: opts.sub === 'ready' ? 'ready' : 'orders', filter: 'open',
      write: canWrite(opts.access), loadedAt: clock(), demoData: demoData(manilaToday()) };
    if (!S.demo && !S.client) { S.d.orders = { err: 'No connection.' }; S.d.ready = { err: 'No connection.' }; }
    S.onClick = onClick; S.onInput = onInput; S.onVis = onVisible;
    el.addEventListener('click', S.onClick); el.addEventListener('input', S.onInput); el.addEventListener('change', S.onInput);
    el.addEventListener('submit', function (e) { if (e && e.preventDefault) e.preventDefault(); });
    try { if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    draw();
    if (S.demo || S.client) { if (S.tab === 'ready') loadReady(true); else loadOrders(true); }
  }
  function unmount() {
    if (!S) return;
    try { S.el.removeEventListener('click', S.onClick); S.el.removeEventListener('input', S.onInput); S.el.removeEventListener('change', S.onInput); } catch (e) { /* ok */ }
    try { if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    (S.timers || []).forEach(function (t) { clearTimeout(t); });
    N_gen++; S = null; // a late reply finds no state and is dropped
  }

  var api = {
    mount: mount, unmount: unmount,
    _setClock: function (fn) { clock = fn || function () { return Date.now(); }; },
    _setRpcTimeout: function (ms) { RPC_TIMEOUT_MS = ms; },
    lib: { canRead: canRead, canWrite: canWrite, ageText: ageText, sortOrders: sortOrders, isOpen: isOpen, areaOf: areaOf, noteOf: noteOf, buildDescription: buildDescription, validateNew: validateNew,
      newOrder: newOrder, doneOrder: doneOrder, reopenOrder: reopenOrder, workOrderCall: workOrderCall, inspectorResult: inspectorResult, readyKind: readyKind, plainError: plainError, isStale: isStale, fmtDateTime: fmtDateTime, esc: esc }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.N_OPS = api;
})();
