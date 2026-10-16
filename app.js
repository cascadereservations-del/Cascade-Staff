/* Cascade Staff - staff app and the official mobile admin side (SPEC-36, D-299.3, D-300). One page, hash routes:
   #signin, #home, #calendar (or #calendar/house to scroll to the guest card), #tasks (D-301), #payrates (owner and admin, D-301), #reply (owner and admin, s76), #more,
   #door/<key> (a same-origin door in a frame, D-304).
   Guest names, notes and ID photos live in memory for the open session only. Nothing personal is written to storage. */
(function () {
  'use strict';
  var CS = window.CS, P = window.CSPay, ICON = window.ICON, esc = CS.esc;
  var up = CS.framedParentTarget(window); // a folded sibling sent its top window "up": this page is the shell inside a frame, so send the parent home and stop
  if (up) { try { window.parent.location.replace(up); } catch (e) {} return; }
  var DEMO = !!(window.CSDemo && window.CSDemo.active); // ?demo: synthetic data, no Supabase client, no network, no storage (demo.js)
  function net() { return (DEMO ? window.CSDemo.fetch : window.fetch).apply(window, arguments); } // every call to an edge function or a signed photo goes through this
  if (!DEMO && !window.supabase) { // offline on a first visit: the shell is here, the client library is not
    document.getElementById('v-signin').classList.add('on');
    var e0 = document.getElementById('si-err'); e0.hidden = false; e0.textContent = 'Live information needs a connection. Open the app again when you have signal.';
    return;
  }

  // Public configuration: the publishable key is designed to ship to the browser (it is already in the checklist and the dashboard).
  var CFG = {
    url: 'https://qkgfhsdppslwunarczeq.supabase.co',
    key: 'sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj',
    propertyId: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd',
    version: '3.4.4'
  };
  var LINKS = {
    checklist: 'https://cascadereservations-del.github.io/CH-Cleaners-Checklist/',
    dashboard: 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/today',
    manual: 'https://cascadereservations-del.github.io/Cascade-Manual/',
    inventory: 'https://cascadereservations-del.github.io/CH_Inventory/', // retired signpost to the dashboard's Inventory tab (D-137); only a fallback
    guide: 'https://cascadereservations-del.github.io/Cascade-System-Guide/',
    quick: './quick/',
    tgOps: CS.tgLink('3798341977'), // {app: tg://..., web: https://t.me/c/...}; tgA() opens the app, the web page is the fallback
    tgFinance: CS.tgLink('3819352746'),
    pay: './pay/',
    cassyGpt: 'https://chatgpt.com/g/g-68ea0f232b248191b03136c9ff7122d9-cascade-hideaway-concierge'
  };
  // Doors (D-304.3): a door on this origin opens inside the app in a full-screen frame (one storage partition on iPhone Home Screen and
  // Android alike); a door on another origin would open externally. The frame is addressed by key, never by a URL in the hash.
  // D-324: a surface folded into this app (fold-manifest.json, read once at start) opens from its relative path; otherwise today's absolute
  // github.io URL. The admin guide has no absolute fallback: it exists only folded, so without it the door is simply not there.
  function doorDef(key) { var d = Object.prototype.hasOwnProperty.call(DOORS, key) ? DOORS[key] : null; return d && d.url ? d : null; }
  var DOORS = {
    checklist: { title: 'Cleaning checklist', url: LINKS.checklist },
    dashboard: { title: 'Admin dashboard', url: LINKS.dashboard },
    manual: { title: 'Cascade Manual', url: LINKS.manual },
    inventory: { title: 'Inventory', url: LINKS.inventory },
    guide: { title: 'System Guide', url: LINKS.guide },
    adminguide: { title: 'Admin guide', url: '' }
  };
  var FALLBACK = {}; Object.keys(DOORS).forEach(function (k) { FALLBACK[k] = DOORS[k].url; });
  var foldKnown = false; // false until fold-manifest.json has answered (or failed): until then the dashboard links are the in-app door, never the old stand-alone address
  function applyFold(manifest) { // pure over DOORS: folded relative url where the surface exists, else the fallback again
    var f = CS.foldedDoorUrls(manifest); foldKnown = true;
    Object.keys(DOORS).forEach(function (k) { DOORS[k].url = DEMO ? (CS.FOLD_DOORS[k][1]) : (f[k] || FALLBACK[k]); }); // demo: every door exists, none opens (route toasts)
  }
  // A door row only for a role that may have it and only if it has somewhere to go.
  function doorRow(key, icon, sub) { return doorDef(key) && CS.doorAllowed(key, state.access && state.access.role) ? row({ icon: icon, title: DOORS[key].title, sub: sub, door: key }) : ''; }

  // supabase-js default storage key on purpose: the dashboard on this origin is then signed in too (SPEC-36 section 5).
  // "Trust this device" (D-303.3): ON keeps the session in localStorage, OFF in sessionStorage only (CS.authStorage picks, key unchanged).
  function store(name) { if (DEMO) return null; try { return window[name]; } catch (e) { return null; } } // demo touches no storage
  var trustOn = CS.trustedFromStorage(store('localStorage'), store('sessionStorage'));
  var sb = DEMO ? window.CSDemo.client(window.CSDemo.role()) : window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    storage: CS.authStorage(store('localStorage'), store('sessionStorage'), function () { return trustOn; }) } });

  var state = { access: null, user: null, name: '', layout: null, payload: null, loadedAt: 0, loading: false, error: '', month: null, payHint: null, photos: {}, photoReq: {}, rot: {},
    notices: null, noticesAbsent: false, noticesLoading: false, noticeFilter: 'all', nadd: null, fbOpen: false, ratesMore: false, calTab: 'calendar', legendOpen: false, H_peekedCal: false, H_peekedTask: false, progress: null, progressAbsent: false, taskFilter: 'all', hubRoute: '', tasks: null, tasksErr: '', tasksLoading: false, showDone: false, lastDone: null, add: null, assignees: null, rates: null, ratesErr: '', rateForm: null, rateSaving: false, reply: null, bookings: null, bookingsDone: false, noticesDone: false, tasksDenied: false, noticesFailed: false, bookingsFailed: false, errorKind: '' };
  var $ = function (id) { return document.getElementById(id); };
  try { var lsLegend = store('localStorage'); state.legendOpen = !!lsLegend && lsLegend.getItem('cs_legend_open') === '1'; } catch (e) {} // F2: the legend's More stays as it was left
  var VIEWS = ['signin', 'home', 'calendar', 'tasks', 'payrates', 'more', 'door', 'reply', 'hub', 'weather', 'stock', 'manage', 'guests', 'inbox', 'search'];
  function pid() { return (state.access && state.access.property_ids && state.access.property_ids[0]) || CFG.propertyId; }
  function canReply() { return CS.canDraftReply(state.access && state.access.role); } // s82 decision 5: every signed-in staff role
  function canAddDetails() { return CS.canAddGuestDetails(state.access && state.access.role); } // the guest-details uploader stays owner and admin

  // ---------------------------------------------------------------- helpers
  function ext(href, inner, cls, extra) { return '<a class="' + (cls || '') + '" href="' + esc(href) + '" target="_blank" rel="noopener"' + (extra || '') + '>' + inner + '</a>'; }
  // Telegram links open the Telegram app (tg://); if this page is still showing ~1.2 s later the app did not open, so the web page opens.
  // Desktop keeps the plain https link in a new tab: its "Open Telegram Desktop?" prompt would race the fallback.
  var TG_APP = /android|iphone|ipad|ipod/i.test(navigator.userAgent || '');
  function tgA(link, inner, cls) {
    if (!TG_APP) return ext(link.web, inner, cls);
    return '<a class="' + (cls || '') + '" href="' + esc(link.app) + '" data-tgweb="' + esc(link.web) + '">' + inner + '</a>';
  }
  function row(opts) { // title and sub-title always on separate lines (D-300.7)
    if (opts.door) {
      var dl = CS.doorLink(opts.door, doorDef(opts.door).url, location.origin, trustOn); opts.href = dl.href; opts.external = dl.external;
      if ((opts.door === 'dashboard' || opts.door === 'inventory') && !foldKnown && CS.doorFramed(opts.door, state.layout, trustOn)) { opts.href = '#door/' + opts.door; opts.external = false; } // both live in the admin build // before the manifest answers: the in-app door, not a flash of the stand-alone address
    }
    var inner = '<span class="lead' + (opts.tile ? ' A_t-' + opts.tile : '') + '">' + ICON(opts.icon) + '</span><span class="mid"><span class="t">' + esc(opts.title) + '</span><span class="s"' + (opts.subId ? ' id="' + opts.subId + '"' : '') + '>' + esc(opts.sub || '') + '</span></span>' +
      (opts.count ? '<span class="count' + (opts.countCls ? ' ' + opts.countCls : '') + '" aria-label="' + esc(opts.count + (opts.countLabel || ' warnings')) + '">' + esc(opts.count) + '</span>' : '') +
      '<span class="chev">' + ICON(opts.external ? 'ext' : 'chev', opts.external ? 's16' : '') + '</span>';
    if (opts.tg) return tgA(opts.tg, inner, 'rowi');
    if (opts.href && opts.external) return ext(opts.href, inner, 'rowi');
    if (opts.href) return '<a class="rowi" href="' + esc(opts.href) + '"' + (opts.hint ? ' title="' + esc(opts.hint) + '"' : '') + '>' + inner + '</a>';
    return '<button class="rowi" type="button" id="' + esc(opts.id || '') + '">' + inner + '</button>';
  }
  // A_hubLink: a dashboard page by its route (admin/#/<route>), through the existing door frame when the role and the trust setting allow it.
  function A_hubLink(route) {
    if (!foldKnown && CS.A_hubRouteOk(route) && CS.doorFramed('dashboard', state.layout, trustOn) && CS.doorAllowed('dashboard', role())) return { href: '#door/dashboard/' + route, external: false };
    var d = doorDef('dashboard'); if (!d || !CS.A_hubRouteOk(route)) return null;
    if (CS.doorFramed('dashboard', state.layout, trustOn) && CS.doorTarget(d.url, location.origin) === 'frame') return { href: '#door/dashboard/' + route, external: false };
    return { href: CS.A_hubDoorUrl(d.url, route), external: true };
  }
  // ChatGPT refuses to be framed, so this is a plain link that opens in a new tab. Same roles as the Telegram Cassy rows beside it.
  function H_cassyGpt() { return row({ icon: 'sparkles', title: 'Open Cassy on ChatGPT', sub: 'Keep guest phone numbers and ID photos out of this chat', href: LINKS.cassyGpt, external: true }); }
  function pill(tone, icon, text) { return '<span class="pill p-' + tone + '">' + ICON(icon, 's16') + esc(text) + '</span>'; }
  function toneIcon(t) { return t === 'ok' ? 'check' : t === 'info' ? 'info' : 'clock'; }
  function appbar(o) {
    var left = o.back ? '<a class="iconbtn" href="' + esc(o.back) + '" aria-label="Back">' + ICON('back', 's24') + '</a>' : '';
    var mid = o.brand ? '<div class="brand"><b>C</b>ascade</div>' : '<h1 class="ttl">' + esc(o.title) + '</h1>';
    var right = o.refresh ? '<button class="iconbtn" type="button" data-act="refresh" aria-label="Refresh">' + ICON('refresh', 's24') + '</button>' : '';
    return '<header class="appbar">' + left + mid + right + '</header>';
  }
  function setView(name) {
    VIEWS.forEach(function (v) { $('v-' + v).classList.toggle('on', v === name); });
    $('tabbar').hidden = name === 'signin' || name === 'door' || !state.layout;
    var shellEl = $('app'); if (shellEl && shellEl.classList) shellEl.classList.toggle('F_nav', !$('tabbar').hidden); // the rail's room is kept only while the rail is there
  }
  // lane P: every link into pay/ carries the badge counts in its hash, even when they are zero (query first, then hash)
  function H_payUrl(page, query) { var n = state.tasks ? CS.taskDueCount(state.tasks.tasks, state.tasks.today) : 0; return LINKS.pay + (page || '') + (query || '') + '#tasks=' + n + '&cal=' + warnCount(); }
  function warnCount() { return state.payload ? (state.payload.warnings || []).length : 0; }
  function errBanner() {
    return state.error ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.error) + ' <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>' : '';
  }

  // ---------------------------------------------------------------- tab bar
  function renderTabs(current) {
    var staff = state.layout === 'staff', due = state.tasks ? CS.taskDueCount(state.tasks.tasks, state.tasks.today) : 0;
    var late = state.tasks ? state.tasks.tasks.some(function (t) { return t.status !== 'done' && CS.taskDue(t.due_at, state.tasks.today) === 'overdue'; }) : false; // red only when something is overdue
    var tabs = [['home', '#home', 'Today', 'house'], ['calendar', '#calendar', 'Calendar', 'calendar', warnCount()],
      ['tasks', '#tasks', 'Tasks', 'tasks', due], ['more', '#more', 'More', 'more']];
    $('tabbar').innerHTML = '<div class="H_railhead" aria-hidden="true"><b>C</b><span>' + esc(String(state.name || '').split(/\s+/)[0]) + '</span></div>' + tabs.map(function (t) {
      return '<a class="tab" href="' + esc(t[1]) + '"' + (t[0] === current ? ' aria-current="page"' : '') + '><span class="ico">' + ICON(t[3], 's24') + '</span>' + esc(t[2]) +
        (t[4] ? '<span class="badge' + (t[0] === 'tasks' && late ? ' bad' : '') + '" aria-label="' + t[4] + (t[0] === 'tasks' ? ' due' : ' warnings') + '">' + t[4] + '</span>' : '') + '</a>';
    }).join('');
  }

  // ---------------------------------------------------------------- Today card (home)
  function datesLine(g) {
    var ci = CS.dayLabel(g.checkin_date) + (CS.fmtTime(g.checkin_time) ? ' ' + CS.fmtTime(g.checkin_time) : '');
    var co = CS.dayLabel(g.checkout_date) + (CS.fmtTime(g.checkout_time) ? ' ' + CS.fmtTime(g.checkout_time) : '');
    var n = g.nights != null ? g.nights : CS.daysBetween(g.checkin_date, g.checkout_date);
    return ci + ' → ' + co + ' · ' + CS.plural(n, 'night');
  }
  // 3.1.1: a hand-added brownout is a day flag on the calendar (the notice call refuses power); it is merged into the notice list so it shows where it was added from
  var H_nm = { v: null, p: null, out: null };
  function A_notices() {
    var v = state.notices, p = state.payload; if (!v || !p) return v;
    if (H_nm.v !== v || H_nm.p !== p) H_nm = { v: v, p: p, out: CS.H_withFlags(v, p.day_flags, p.today) };
    return H_nm.out;
  }
  function A_houseT() { var v = A_notices(); return v ? v.times : CS.A_houseTimes(null); } // 12:00 noon / 2:00 pm, from notices_v1.house_times, one fallback in lib.js
  // The Today card (glass). Check-out time falls back to the house time, never a hard-coded one.
  function todayCard() {
    var p = state.payload, st = CS.todayCardState(p, p.today);
    if (!st.guest) return '<section class="card glass A_card F_span" aria-label="Today in the house"><span class="cap up">' + esc(st.label) + '</span><p class="sub">The house is free tonight. The next stay will show here.</p></section>';
    var g = st.guest, ret = CS.returningLabel(g, true), co = CS.fmtTime(g.checkout_time) || A_houseT().outLabel;
    return '<section class="card glass A_card F_span" aria-label="Today in the house"><div class="row-between"><span class="cap up">' + esc(st.label) + '</span>' + (st.pill ? pill(st.pill.tone, toneIcon(st.pill.tone), st.pill.text) : '') + '</div>' +
      '<h2 class="A_name">' + esc(g.guest_name || 'Guest') + '</h2>' + (ret ? '<div>' + pill('brand', 'repeat', ret) + '</div>' : '') +
      '<p class="sub num" style="margin:0">' + esc(CS.dayLabel(g.checkin_date) + ' → ' + CS.dayLabel(g.checkout_date) + ' · ' + CS.plural(g.nights != null ? g.nights : CS.daysBetween(g.checkin_date, g.checkout_date), 'night') + ' · out ' + co) + '</p>' +
      '<a class="A_more" href="#calendar/house">Open guest card' + ICON('chev', 's16') + '</a></section>';
  }
  // ---------------------------------------------------------------- the one notification pill (E_)
  // Everything that needs a person, counted once by CS.E_attention (pure, lib.js) and drawn in the slot the "Updated" chip used to hold.
  // The slot is reserved from the first paint (Loading), so nothing moves when the answer lands. It opens the "To look at" sheet.
  function A_openTasks() { return state.tasks ? state.tasks.tasks.filter(function (t) { return t.status !== 'done'; }) : []; }
  function A_clashList() { // days in the next 60 with two guests on one night
    var p = state.payload, out = [], i, d; if (!p) return out;
    for (i = 0; i < 60; i++) { d = CS.addDays(p.today, i); if (dayStatusOf(d).clash.length) out.push(d); } return out;
  }
  function E_input() {
    var p = state.payload, v = A_notices(), money = state.layout === 'admin';
    return { role: role(), today: p ? p.today : CS.manilaToday(), error: !!state.error, errorKind: state.errorKind || 'network',
      failed: { tasks: !!state.tasksErr && !state.tasksDenied, notices: state.noticesFailed, bookings: state.bookingsFailed }, lastAt: state.loadedAt ? new Date(state.loadedAt).toISOString() : '',
      ready: { payload: !!p, tasks: !!state.tasks || !!state.tasksErr, bookings: state.bookingsDone, notices: state.noticesDone || state.noticesAbsent },
      tasks: state.tasks ? state.tasks.tasks : [], clashDays: p && money ? A_clashList() : [], bookings: state.bookings, inbox: v ? v.inbox : null,
      warnings: p ? p.warnings || [] : [], notices: v ? v.list : [] };
  }
  function E_att() { return CS.E_attention(E_input()); }
  function E_pill(att) {
    var P = att.pill;
    return '<button class="A_chipglass E_pill" type="button" data-act="attn-open" aria-haspopup="dialog" aria-label="' + esc(P.aria) + '"><i class="E_dot E_' + P.dot + '"></i>' + ICON(P.glyph, 's16') +
      '<span class="E_lbl">' + esc(P.text) + '</span><span class="E_cnt">' + esc(P.short) + '</span></button>';
  }
  // Two fixed lines under the greeting (temperature and condition; rain chance or how old the reading is). The slot is always drawn, with the same height, so nothing jumps when the reading lands.
  function H_wxStrip(p) {
    var w = p && p.weather, c = w && w.current, ok = !!c && c.temp != null, rl = ok ? CS.rainLine(w) : null, l2 = 'Open the forecast';
    if (ok) { var old = w.fetched_at && CS.weatherStale(w); l2 = [rl ? rl.head + (rl.rest && !old ? ' · ' + rl.rest : '') : '', old ? 'as of ' + CS.clockLabel(w.fetched_at) : ''].filter(Boolean).join(' · '); }
    return '<a class="H_wxstrip" href="#weather" aria-label="Weather, open the forecast"><span class="l1">' + ICON('cloud', 's16') + '<span>' + esc(ok ? CS.H_weatherShort(c.temp, c.description, (window.innerWidth || 360) < 340) : 'Weather') + '</span></span><span class="l2">' + esc(l2 || 'Tap for the forecast') + '</span></a>';
  }
  // The photo header: wordmark, the pill, refresh, greeting, date and weather (as of HH:MM when the weather is old). Drawn before the first answer too.
  function A_hero() {
    var p = state.payload, nm = CS.greetingName(state.user);
    return '<div class="A_hero"><img src="img/house-hero.webp" alt="" width="720" height="480" fetchpriority="high"><div class="A_herobar"><span class="brand">Cascade</span><div class="A_herorow">' + E_pill(E_att()) +
      '<button class="A_chipglass" type="button" data-act="refresh" aria-label="Refresh">' + ICON('refresh', 's24') + '</button></div></div>' +
      '<div class="A_greet"><h1>' + esc(CS.greeting() + (nm ? ', ' + nm : '')) + '</h1><div class="cap">' + esc(CS.dayLong(p ? p.today : CS.manilaToday())) + '</div>' + H_wxStrip(p) + '</div></div>';
  }
  // Sign out lives on More only (a wet-hand mis-tap away from the tab bar); the footer says how fresh the screen is.
  function footerLine() { return '<div class="help F_span" style="text-align:center;margin-top:16px">Updated ' + esc(state.loadedAt ? CS.agoLabel(new Date(state.loadedAt).toISOString()) : 'just now') + ' · v' + CFG.version + '</div>'; }

  // The turnover: guest out, clean, guest in, against the 12:00 noon to 2:00 pm window. Slide (or tap) to start opens the checklist door; no second PIN from here.
  function A_slideStart() {
    var d = doorDef('checklist'); if (!d || !CS.doorAllowed('checklist', role())) return '';
    var dl = CS.doorLink('checklist', d.url, location.origin, trustOn);
    return '<a class="A_slide" data-slide href="' + esc(dl.href) + '"' + (dl.external ? ' target="_blank" rel="noopener"' : '') + ' data-primary="start-cleaning" aria-label="Start cleaning"><span class="knob">' + ICON('slide', 's24') + '</span><span class="txt">Start cleaning</span></a>';
  }
  function H_check(tone, word, text) {
    return '<div class="H_check H_t-' + tone + '"><span class="dot">' + ICON(tone === 'ok' ? 'check' : tone === 'warn' ? 'alert' : 'clock', 's16') + '</span><span class="k">' + esc(word) + '</span><b>' + esc(text) + '</b></div>';
  }
  // B1: the one primary button on Today, 56 px, per role. Cleaner on a turnover day: Start cleaning (the checklist door). Otherwise the most useful existing action.
  // Owner: Pay staff when a pay request is waiting, else the top attention item (opens the same "To look at" sheet as the pill).
  function A_primary(staff, turn) {
    var cls = 'btn btn-primary btn-block A_primary';
    if (staff) {
      if (!turn) return ''; // 3.4.1: no turnover, no primary button; the Cleaning fee row in the Work list already asks for it
      var go = A_slideStart(); if (go) return go;
      return LINKS.pay ? '<a class="' + cls + '" data-primary="cleaning-fee" href="' + esc(H_payUrl()) + '">Ask for the cleaning fee</a>' : '<a class="' + cls + '" data-primary="calendar" href="#calendar">Open the calendar</a>';
    }
    if (LINKS.pay && state.payWait > 0 && /^(owner|admin|finance)$/.test(role() || '')) return '<a class="' + cls + '" data-primary="pay-staff" href="' + esc(H_payUrl('admin.html')) + '">Pay staff</a>';
    var att = E_att();
    if (att.phase === 'items' && att.top) return '<button class="' + cls + '" type="button" data-primary="attention" data-act="attn-open" aria-haspopup="dialog">Review ' + esc(att.top.toLowerCase()) + '</button>';
    return '<a class="' + cls + '" data-primary="calendar" href="#calendar">Open the calendar</a>';
  }
  function A_turnoverCard(staff) {
    var p = state.payload, T = A_houseT(), clock = CS.A_turnoverClock(new Date(), T), ds = dayStatusOf(p.today), outToday = !!ds.out, inToday = !!ds.arrive;
    if (!outToday && !inToday) {
      var nx = staysOf().filter(function (st) { return st.checkout_date > p.today; })[0];
      var nextOut = nx ? 'Next guest out ' + CS.dayLabel(nx.checkout_date) + ', ' + T.outLabel + '.' : 'Nothing is booked to leave soon.';
      return '<section class="card glass A_card" aria-label="Turnover today"><span class="cap up">Turnover today</span><p class="sub" style="margin:0">No turnover today. ' + esc(nextOut) + '</p>' + A_primary(staff, false) + '</section>';
    }
    var win = clock.phase === 'window', closed = clock.phase === 'after';
    if (!staff) { // F4: the verdict. Three check rows with a glyph and a word; a row whose data is absent is not drawn.
      var rows = '', cl = CS.H_cleanLine(state.progress, clock), hl = CS.H_houseLine(A_notices(), p.today), raw = inToday ? H_readyRaw(ds.stay) : null, rd = CS.H_ready(raw, role());
      if (cl) rows += H_check(cl.tone, 'Clean', cl.text);
      if (rd) rows += H_check(CS.H_readyOk(rd) ? 'ok' : 'warn', 'Arrival', CS.H_readyLine(rd));
      if (hl) rows += H_check(hl.tone, 'House', hl.text);
      return '<section class="card glass A_card" aria-label="Turnover today"><div class="row-between"><span class="cap up">Turnover today</span></div><p class="strong H_tline" style="margin:0">' + esc('Today · out ' + T.outLabel + ' · in ' + T.inLabel) + '</p>' +
        (rows ? '<div class="H_checks">' + rows + '</div>' : '') + (rd && !CS.H_readyOk(rd) ? H_readyBlock(raw, ds.stay, true) : '') + A_primary(false, true) + '</section>';
    }
    var steps = '<div class="A_steps">' +
      '<div><span class="dot">' + ICON('logout', 's16') + '</span><span>Guest out</span><b>' + esc(outToday ? T.outLabel : 'None today') + '</b></div>' +
      '<div class="' + (win ? 'now' : '') + '"><span class="dot">' + ICON('sparkles', 's16') + '</span><span>Clean</span><b>' + esc(closed ? 'Closed' : win ? 'Until ' + CS.A_shortTime(T.check_in) : 'From ' + CS.A_shortTime(T.check_out)) + '</b></div>' +
      '<div><span class="dot">' + ICON('user', 's16') + '</span><span>Guest in</span><b>' + esc(inToday ? T.inLabel : 'None today') + '</b></div></div>';
    var title = [outToday ? 'Guest out ' + T.outLabel : '', inToday ? (ds.stay.guest_name || 'Guest') + ' in ' + T.inLabel : ''].filter(Boolean).join(' · ');
    return '<section class="card glass A_card" aria-label="Turnover today"><div class="row-between"><span class="cap up">Turnover today</span></div><p class="strong H_tline" style="margin:0">' + esc(title) + '</p>' +
      steps + '<p class="num H_until" style="margin:0">' + esc(CS.H_untilLine(clock, inToday)) + '</p>' + A_primary(true, true) + '</section>';
  }
  // MF1: the clean-done card (the checklist posts cs-clean-done). Primary leads straight into the pay request for that clean.
  function H_cleanDoneCard() {
    var c = state.cleanDone; if (!c) return '';
    if (Date.now() - c.at > 86400000) { state.cleanDone = null; return ''; }
    var ms = c.finishedAt && c.startedAt ? new Date(c.finishedAt).getTime() - new Date(c.startedAt).getTime() : NaN, mins = isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : 0;
    var took = mins ? (mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min') : '', ds = state.payload ? dayStatusOf(state.payload.today) : null, T = A_houseT();
    return '<section class="card glass A_card H_cleandone" id="H_cleandone" aria-label="Clean done"><h2 class="hd">' + esc('Clean done' + (took ? ' · ' + took : '')) + '</h2>' +
      (ds && ds.arrive ? '<p class="sub" style="margin:0">' + esc((ds.stay.guest_name || 'Guest') + ' in at ' + T.inLabel) + '</p>' : '') +
      '<p class="sub" style="margin:0">' + esc((c.issues ? CS.plural(c.issues, 'issue') + ' logged' : 'No issues logged') + ' · ' + CS.plural(c.photos, 'photo')) + '</p>' +
      '<a class="btn btn-primary btn-block" href="' + esc(H_payUrl('', c.id ? '?clean=' + encodeURIComponent(c.id) : '')) + '">Ask for the cleaning fee</a>' +
      '<button class="btn btn-ghost" type="button" data-act="clean-done-hide">Not now</button></section>';
  }
  // Notices card: reads notices_v1. Absent RPC = no card. While the first read is out, a reserved block holds the place.
  function A_noticesCard() {
    var v = A_notices();
    if (state.noticesAbsent) return '';
    var loading = !v && state.noticesLoading, items = v ? v.all.slice(0, 2) : [], body;
    if (!v) body = loading ? '<div class="skel" style="height:72px"></div>' : '<p class="sub" style="margin:0">No connection. <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></p>';
    else body = items.length ? '<div class="A_nlist">' + items.map(function (n) { var h = CS.H_noticeHead(n); return row({ icon: A_noticeIcon(n.type), tile: n.type, title: h.title, sub: h.sub, href: '#calendar/notices', hint: n.title + (n.sub ? ' · ' + n.sub : '') }); }).join('') + '</div>' : '<p class="sub" style="margin:0">No notices. Nothing to plan around.</p>';
    var mgr = CS.canSeeGuestContact(role()), add = mgr && v ? '<button class="btn btn-secondary btn-block H_addrow" type="button" data-act="notice-add-open" data-date="' + esc(state.payload.today) + '">' + ICON('plus', 's16') + 'Add a notice</button>' : '';
    return '<section class="card glass A_card A_noticecard' + (mgr ? ' H_mgr' : '') + '" aria-label="Notices"' + (loading ? ' aria-busy="true"' : '') + '><div class="A_head"><h2>Notices</h2>' + (v ? '<a href="#calendar/notices">' + (v.counts.all ? 'See all ' + v.counts.all : 'Open') + ICON('chev', 's16') + '</a>' : '') + '</div>' + body + add + '</section>';
  }
  function A_noticeIcon(type) { return type === 'house' ? 'house' : (CS.A_NOTICE_TYPES[type] || CS.A_NOTICE_TYPES.note).icon; }
  // F_: a label and its card travel as one grid item (F_group), so a two-column grid never splits them
  function A_navCard(label, rows, tiles) { return rows ? '<div class="F_group' + (tiles ? ' A_tiles' : '') + '"><div class="A_label">' + esc(label) + '</div><nav class="card glass list" aria-label="' + esc(label) + '">' + rows + '</nav></div>' : ''; }
  function renderHome() {
    var el = $('v-home');
    if (!state.payload) { el.innerHTML = A_hero() + '<div class="screen" style="min-height:0;padding-top:0"><div class="A_body">' + (state.error ? errBanner() : loadingBlock()) + '</div></div>'; return; }
    var staff = state.layout === 'staff', n = warnCount(), v = A_notices();
    var body;
    if (staff) {
      // Today, Turnover, the paid notice (under Turnover: Turnover and Slide to start never move when it lands), Notices, then the doors
      body = '<div class="A_body">' + errBanner() + todayCard() + A_turnoverCard(true) + H_cleanDoneCard() + '<div id="slot-paid-notice" class="A_slot" hidden></div>' + H_alertsCard() + A_noticesCard() +
        A_navCard('Work', row({ icon: 'cloud', title: 'Weather', sub: 'Today and the next few hours', href: '#weather' }) + doorRow('checklist', 'clip', 'Start or continue today’s turnover') +
          (LINKS.pay ? row({ icon: 'cash', title: 'Cleaning fee', sub: state.payHint || 'Ask for payment for your cleans and expenses', href: H_payUrl(), subId: 'pay-sub' }) : '') +
          row({ icon: 'calendar', title: 'Calendar', sub: 'Who is staying, who is next', href: '#calendar', count: n || '' }) +
          row({ icon: 'box', title: 'Inventory', sub: 'Stock levels and what to buy', href: '#stock' }) +
          (doorDef('manual') && CS.doorAllowed('manual', role()) ? row({ icon: 'book', title: 'House manual', sub: 'How we do things · when something breaks', door: 'manual' }) : '')) +
        A_navCard('Ask Cassy', row({ icon: 'chat', title: 'Cassy · OPS', sub: 'Report, ask, log an expense', tg: LINKS.tgOps, external: true }) + H_cassyGpt() +
          (canReply() ? row({ icon: 'sparkles', title: 'Cassy reply', sub: 'Draft a warm reply to a guest message', href: '#reply' }) : '') +
          row({ icon: 'help', title: 'Quick guide', sub: 'Two minutes on telling Cassy what happened', href: LINKS.quick })) + footerLine() + '</div>';
    } else {
      var bk = CS.bookingsToConfirmRow(role(), state.bookings, A_hubLink('bookings/inquiries')), inbox = v ? v.inbox : null;
      // only owner and admin have an inbox; the reserve is kept while notices load, and dropped on failure, when absent, and for finance
      // 3.2: the row opens the shell's own #inbox (which falls back to the dashboard's conversations page when the module is not shipped)
      var inboxShown = CS.canSeeGuestContact(role()) && !state.noticesAbsent && (v ? inbox != null : state.noticesLoading);
      body = '<div class="A_body">' + errBanner() + todayCard() + A_turnoverCard(false) + H_cleanDoneCard() + H_alertsCard() + A_noticesCard() +
        A_navCard('Guests and bookings', (bk ? row({ icon: 'clip', title: 'Bookings to confirm', sub: 'Open the pending bookings', href: bk.href, external: bk.external, count: bk.count, countLabel: bk.n === 1 ? ' booking to confirm' : ' bookings to confirm' }) : '') +
          row({ icon: 'calendar', title: 'Calendar', sub: 'Stays, blocked nights, notices', href: '#calendar', count: n || '' }) +
          '<div id="slot-inbox"' + (inboxShown ? '' : ' hidden') + (inboxShown && !v ? ' style="min-height:64px"' : '') + '>' + (inboxShown && v ? row({ icon: 'chat', title: 'Inbox', sub: inbox ? inbox + ' open' : 'No open messages', href: '#inbox', count: inbox || '', countLabel: ' open messages' }) : '') + '</div>' +
          (CS.canSeeGuestContact(role()) ? row({ icon: 'user', title: 'Guests', sub: 'Guest records, ID photos and notes', href: '#guests' }) : '') +
          (canReply() ? row({ icon: 'sparkles', title: 'Cassy reply', sub: 'Draft a warm reply to a guest message', href: '#reply' }) : ''), true) +
        A_navCard('Admin', row({ icon: 'dash', title: 'Admin hub', sub: 'Every dashboard page, in one list', href: '#hub' }) +
          (trustOn ? '' : '<div class="help doornote">Sign-in is kept only on trusted devices</div>') +
          (/^(owner|admin|finance)$/.test(role() || '') ? row({ icon: 'wallet', title: 'Pay staff', sub: 'Pay a request by QR, then add the proof', href: H_payUrl('admin.html') }) : '') +
          (CS.canEditRates(role()) ? row({ icon: 'cash', title: 'Pay rates', sub: 'What a clean and its transport pay', href: '#payrates' }) : '') +
          (CS.canEditRates(role()) ? row({ icon: 'dash', title: 'Manage', sub: 'Inquiries, expenses and key figures', href: '#manage' }) + row({ icon: 'star', title: 'Key figures', sub: 'How the house is doing', href: '#manage/kpis' }) : '') +
          row({ icon: 'box', title: 'Inventory', sub: 'Stock levels and usage', href: '#stock' }), true) + footerLine() + '</div>';
    }
    var keep = el.querySelector && el.querySelector('#slot-paid-notice'); if (keep && keep.parentNode) keep.parentNode.removeChild(keep);
    el.innerHTML = A_hero() + '<div class="screen" style="min-height:0;padding-top:0">' + body + '</div>';
    if (keep) { var fresh = el.querySelector('#slot-paid-notice'); if (fresh && fresh.parentNode) fresh.parentNode.replaceChild(keep, fresh); }
    // "You were paid" notice (pay/C_paid-notice.js): mounted once per slot node; the node is carried across redraws above and is new again after a sign-in.
    var paid = el.querySelector && el.querySelector('#slot-paid-notice');
    if (paid && !paid.__paidMounted && window.C_PaidNotice && state.access) { paid.__paidMounted = true; try { window.C_PaidNotice.mount(paid, { client: sb, demo: DEMO }); } catch (e) {} }
  }
  function loadingBlock() { return '<div class="stack" style="margin-top:16px"><div class="skel" style="height:40px;width:70%"></div><div class="skel" style="height:110px"></div><div class="skel" style="height:240px"></div></div>'; }

  // ---------------------------------------------------------------- guest card (Guest Calendar Info)
  function guestBlock(g, kind) {
    var label = kind === 'house' ? 'In the house' : 'Next arrival';
    var st = kind === 'house' ? pill('ok', 'check', g.checkin_date === state.payload.today ? 'Arrived today' : 'Checked in') : pill('info', 'info', 'Arrives ' + CS.dayLabel(g.checkin_date));
    var ret = CS.returningLabel(g, false), src = CS.sourceLabel(g.source), earlier = CS.earlierLine(g), withLine = CS.canSeeGuestContact(state.access && state.access.role) ? CS.companionsLine(g) : null; // D-319: owner/admin only, even if the server sent it
    var info = '<div class="card glass" id="' + (kind === 'house' ? 'house' : 'next') + '"><div class="row-between"><span class="cap up">' + label + '</span>' + st + '</div>' +
      '<h3 class="ttl" style="margin-top:8px">' + esc(g.guest_name || 'Guest') + '</h3>' + (withLine ? '<p class="sub" style="margin:2px 0 0">' + esc(withLine) + '</p>' : '') +
      '<div class="row-wrap" style="margin-top:6px">' + (ret ? pill('brand', 'repeat', ret) : '') + (src ? '<span class="pill p-neutral">' + esc(src) + '</span>' : '') + '</div>' +
      '<p class="sub num" style="margin:8px 0 0">' + esc(datesLine(g)) + '</p>' + (earlier ? '<p class="help num" style="margin:2px 0 0">' + esc(earlier) + '</p>' : '') + contactBlock(g) +
      H_readyBlock(g.arrival_ready, g, true) + (canAddDetails() && g.uid ? '<a class="btn btn-secondary btn-sm" href="./guest/#' + encodeURIComponent(g.uid) + '" style="margin-top:12px">' + ICON('idcard', 's16') + 'Add guest details</a>' : '') +
      (CS.canSeeGuestContact(role()) && /^[\w-]{1,64}$/.test(String(g.guest_id || '')) ? '<a class="btn btn-ghost btn-sm" href="#guests/' + encodeURIComponent(g.guest_id) + '" style="margin-top:12px">' + ICON('user', 's16') + 'Open guest</a>' : '') + '</div>'; // 3.2: when the payload carries the guest id
    var groups = CS.parseNotes(g.notes), notes = '';
    if (groups.length) {
      notes = '<div class="card glass"><h3 class="hd">Notes from earlier stays</h3><div style="margin-top:10px">' + groups.map(function (gr) {
        return '<div class="notegroup">' + (gr.date ? '<p class="help num" style="margin-bottom:4px">' + esc(CS.dayLabel(gr.date) + ' ' + gr.date.slice(0, 4)) + '</p>' : '') +
          '<ul class="notes">' + gr.points.map(function (p) { return '<li>' + ICON('note') + '<span>' + esc(p) + '</span></li>'; }).join('') + '</ul></div>';
      }).join('') + '</div></div>';
    } else if (g.repeat === true) {
      notes = '<div class="card"><h3 class="hd">Notes from earlier stays</h3><p class="sub" style="margin-top:8px">Nothing was noted last time.</p></div>';
    }
    // Owner/admin: the empty box opens Add guest details in ID mode (take or choose the guest's own ID photo; D-320.5).
    var addId = canAddDetails() && g.uid ? './guest/?for=id#' + encodeURIComponent(g.uid) : '';
    var idcard = '<div class="card glass"><h3 class="hd">Guest ID</h3><div style="margin-top:10px">' +
      (g.id_photo_path ? '<div class="idphoto" data-idpath="' + esc(g.id_photo_path) + '"><span class="help">Loading the photo…</span></div><p class="help" style="margin:10px 0 0">Check the face and the name against the guest at the door.</p>'
        : addId ? '<a class="idphoto empty idadd" href="' + esc(addId) + '">' + ICON('camera', 's24') + '<span><b>No ID photo yet.</b><br>Tap to take or choose a photo of the guest’s ID.</span></a>'
        : '<div class="idphoto empty">No ID photo to show for this guest.</div>') +
      (addId ? '<a class="btn btn-ghost btn-sm" href="./guest/?for=companion#' + encodeURIComponent(g.uid) + '" style="margin:8px 0 0 -12px">' + ICON('plus', 's16') + 'Add a companion</a>' +
        '<p class="help" style="margin:2px 0 0">Companions you add show in the admin guest page.</p>' : '') + '</div></div>';
    return info + notes + idcard;
  }

  // Phone, e-mail and Messenger (owner/admin only; the server sends nothing to cleaners, and the guard blocks it if it ever did).
  // Tap the value or Copy to copy it; Call dials; Messenger opens the guest's thread or the Page inbox.
  function contactBlock(g) {
    var c = CS.guestContact(g); if (!c) return '';
    var copyBtns = function (label, val) {
      return '<button class="ctval num" type="button" data-act="copy" data-copy="' + esc(val) + '" aria-label="' + esc('Copy ' + label.toLowerCase() + ' ' + val) + '">' + esc(val) + '</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-act="copy" data-copy="' + esc(val) + '" aria-label="' + esc('Copy ' + label.toLowerCase()) + '">Copy</button>';
    };
    var html = '<div class="ctbox">';
    if (c.phone) html += '<div class="ctrow"><span class="cap">Phone</span>' + copyBtns('Phone', c.phone) + (c.tel ? '<a class="btn btn-ghost btn-sm" href="' + esc(c.tel) + '" aria-label="' + esc('Call ' + c.phone) + '">Call</a>' : '') + '</div>';
    if (c.email) html += '<div class="ctrow"><span class="cap">Email</span>' + copyBtns('Email', c.email) + '</div>';
    if (c.messenger) html += '<div class="ctrow">' + ext(c.messenger, ICON('chat', 's16') + 'Open in Messenger', 'btn btn-secondary btn-sm') + '</div>';
    return html + '</div>';
  }
  // A short "Copied" note: visible for 2 s and read out by screen readers (polite). Made once, outside every redrawn view.
  var toastTimer = 0;
  // act = { act, task, text, label }: an inline button (Undo) beside the thumb; the toast then stays 5 s and takes taps.
  function toast(msg, act, sub) {
    var t = $('cs-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cs-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t);
      t.addEventListener('click', function (ev) { if (ev.target && ev.target.closest && ev.target.closest('.E_toastbtn')) return; clearTimeout(toastTimer); t.classList.remove('on'); t.classList.remove('E_hasact'); }); } // F23: a tap on the toast itself dismisses it
    if (act) { t.innerHTML = '<span>' + esc(msg) + (sub ? '<br><span class="help">' + esc(sub) + '</span>' : '') + '</span><button class="btn btn-ghost btn-sm E_toastbtn" type="button" data-act="' + esc(act.act) + '" data-task="' + esc(act.task) + '" aria-label="' + esc(act.label || act.text) + '">' + esc(act.text) + '</button>'; t.classList.add('E_hasact'); }
    else { t.innerHTML = ''; t.textContent = msg; t.classList.remove('E_hasact'); }
    t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); t.classList.remove('E_hasact'); t.textContent = ''; }, act ? 7000 : 2000);
  }

  // The ID photo comes from the private guest-id-photos bucket through a 5-minute signed URL made with the user's own session
  // (a storage policy lets staff read only the current and next guest's photo). It is fetched with no-store and shown from memory:
  // no download link, no disk cache, gone on reload.
  function loadIdPhotos(root) {
    root.querySelectorAll('[data-idpath]').forEach(function (box) {
      var path = box.getAttribute('data-idpath'), hit = state.photos[path];
      if (hit && Date.now() - hit.at < 30 * 60000) { putPhoto(box, hit.url); return; } // kept in memory for the session: reopening a card does not sign or download again
      var req = state.photoReq[path] || (state.photoReq[path] = sb.storage.from('guest-id-photos').createSignedUrl(path, 300).then(function (r) {
        if (r.error || !r.data) throw new Error('sign');
        return net(r.data.signedUrl, { cache: 'no-store', referrerPolicy: 'no-referrer' });
      }).then(function (res) { if (!res.ok) throw new Error('fetch'); return res.blob(); }).then(function (blob) {
        var old = state.photos[path]; if (old) URL.revokeObjectURL(old.url);
        var url = URL.createObjectURL(blob); state.photos[path] = { url: url, at: Date.now() }; delete state.photoReq[path]; return url;
      }, function (e) { delete state.photoReq[path]; throw e; })); // one request per path at a time
      req.then(function (url) { putPhoto(box, url); }).catch(function () {
        box.className = 'idphoto empty'; box.innerHTML = 'The photo could not be loaded. <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button>';
      });
    });
  }
  function putPhoto(box, url) {
    box.innerHTML = ''; var img = new Image(); img.decoding = 'async'; img.alt = 'Guest ID photo'; img.draggable = false;
    // An ID is a landscape card: one that loads taller than wide with no EXIF turn is shown turned 90 degrees (Rotate in the full-screen view fixes the rest).
    var turn = function () { var d = state.rot[url] || 0; box.classList.toggle('rot', d % 180 === 90); box.classList.toggle('r180', d === 180); box.style.setProperty('--deg', d + 'deg'); };
    if (state.rot[url] === undefined) img.addEventListener('load', function () { if (state.rot[url] === undefined && img.naturalWidth && img.naturalHeight > img.naturalWidth * 1.05) { state.rot[url] = 90; turn(); } });
    turn(); img.src = url;
    img.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    if (CS.canSeeGuestContact(role())) { var b = document.createElement('button'); b.type = 'button'; b.className = 'H_idbtn'; b.setAttribute('data-act', 'id-full'); b.setAttribute('aria-label', 'Show the ID photo full screen'); b.appendChild(img); box.appendChild(b); } else box.appendChild(img);
  }
  // Full screen: the same in-memory picture, no download, no new request. A tap on the picture or Close puts it away.
  function H_idRot(src) { return state.rot[src] || 0; }
  function H_idFull(src) {
    var o = $('H_idfull'); if (!o) { o = document.createElement('div'); o.id = 'H_idfull'; o.className = 'H_idfull'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Guest ID photo'); document.body.appendChild(o); }
    o.innerHTML = '<img alt="Guest ID photo" draggable="false" data-act="id-full-close"><div class="H_idbar"><button class="btn btn-secondary" type="button" data-act="id-rot">Rotate</button><button class="btn btn-secondary" type="button" data-act="id-full-close">' + ICON('close', 's16') + 'Close</button></div>';
    o.setAttribute('data-src', src); var im = o.querySelector('img'); if (im) { im.src = src; im.className = 'r' + H_idRot(src); } o.classList.add('on'); var cb = o.querySelector('button[data-act="id-full-close"]'); if (cb && cb.focus) cb.focus();
  }
  function H_idClose() { var o = $('H_idfull'); if (o && o.classList) { o.classList.remove('on'); o.innerHTML = ''; } }
  function dropPhotos() { Object.keys(state.photos).forEach(function (k) { URL.revokeObjectURL(state.photos[k].url); }); state.photos = {}; state.photoReq = {}; state.rot = {}; }

  // ---------------------------------------------------------------- Guest Calendar Info
  function monthState() {
    var t = state.payload.today, p = t.split('-');
    if (!state.month) state.month = { y: +p[0], m: +p[1] };
    return state.month;
  }
  function monthStep(d) { // the month d steps away, or null past the months the calendar offers
    var m = monthState(), y = m.y, mm = m.m + d;
    if (mm < 1) { mm = 12; y--; } if (mm > 12) { mm = 1; y++; }
    return CS.H_monthOk(y, mm, state.payload.today) ? { y: y, m: mm } : null; // 3.1.1: back a year
  }
  function shiftMonth(d, fade) {
    var n = monthStep(d); if (!n) return false;
    state.month = n; state.H_fade = !!fade; renderCalendar(); return true;
  }
  var FLAG_ICON = { brownout: 'zap', maintenance: 'wrench', deep_clean: 'sparkles', other: 'note' };
  var BLOCK_ICON = { brownout: 'zapoff', maintenance: 'wrench', deep_clean: 'sparkles', owner: 'house', direct: 'calendar' };
  // The merged stays (same guest on two rows = one stay, D-320), worked out once per payload.
  var staysMemo = { p: null, list: [] };
  function staysOf() { var p = state.payload; if (staysMemo.p !== p || staysMemo.v !== H_histV) staysMemo = { p: p, v: H_histV, list: CS.mergeStays(H_allCal()) }; return staysMemo.list; }
  function dayStatusOf(iso) { var p = state.payload; return CS.dayStatus(iso, H_allCal(), p.day_flags, p.warnings, staysOf()); }
  // 3.2 round 2 (owner and admin): the months before today-7 come from staff_calendar_history_v1, one call per month shown, kept in memory for the session only and dropped on sign-out.
  // Rows carry a first name and dates, nothing else. A missing RPC or a refusal turns the feature off for the session and the grid keeps the dashed "in the admin dashboard" behaviour.
  var H_hist = {}, H_histV = 0, H_histOff = false, H_occ = {}, H_occOff = false, H_calMemo = { p: null, v: -1, list: [] };
  function H_calReset() { H_hist = {}; H_histV++; H_histOff = false; H_occ = {}; H_occOff = false; H_calMemo = { p: null, v: -1, list: [] }; }
  function H_allCal() {
    var p = state.payload; if (H_calMemo.p === p && H_calMemo.v === H_histV) return H_calMemo.list;
    var from = CS.H_dataFrom(p.today), seen = {}, extra = [];
    Object.keys(H_hist).forEach(function (k) { var e = H_hist[k]; if (e.st === 'ok') e.rows.forEach(function (r) { if (r.checkout_date < from && !seen[r.uid]) { seen[r.uid] = 1; extra.push(r); } }); }); // a stay seen from two months is one stay; nothing the home read already holds
    H_calMemo = { p: p, v: H_histV, list: (p.calendar || []).concat(extra) }; return H_calMemo.list;
  }
  function H_ymKey(m) { return m.y + '-' + (m.m < 10 ? '0' : '') + m.m; }
  function H_monthEdges(m) { var ny = m.m === 12 ? m.y + 1 : m.y, nm = m.m === 12 ? 1 : m.m + 1; return { start: H_ymKey(m) + '-01', next: H_ymKey({ y: ny, m: nm }) + '-01', last: H_ymKey(m) + '-' + String(new Date(Date.UTC(m.y, m.m, 0)).getUTCDate()).padStart(2, '0') }; } // the history call is inclusive at both ends (last day); the metrics call is half-open (next)
  function H_histOk(iso) { var e = H_hist[iso.slice(0, 7)]; return !!e && e.st === 'ok'; }
  function H_histRow(s) { var id = String(s.source || '') + '-' + String(s.id || ''); return { uid: 'h-' + id, guest_name: String(s.first_name || ''), checkin_date: s.checkin, checkout_date: s.checkout, nights: s.nights, status: 'confirmed', source: s.source === 'direct' ? 'direct' : 'airbnb' }; }
  function H_calLoads(m) { // called after the calendar is drawn: at most one history call and one metrics call per month, never repeated for the session
    if (!CS.canSeeGuestContact(role()) || DEMO || !sb || !state.payload) return;
    var key = H_ymKey(m), e = H_monthEdges(m), gen = H_histGen;
    if (!H_histOff && e.start < CS.H_dataFrom(state.payload.today) && !H_hist[key]) {
      H_hist[key] = { st: 'loading', rows: [] };
      sb.rpc('staff_calendar_history_v1', { p_from: e.start, p_to: e.last }).then(function (r) {
        if (gen !== H_histGen) return;
        if (r.error) { if (CS.rpcMissing(r.error) || r.error.code === '42501' || /not_authorized/.test(r.error.message || '')) H_histOff = true; H_hist[key] = { st: 'fail', rows: [] }; }
        else if (!r.data || !Array.isArray(r.data.stays)) { H_histOff = true; H_hist[key] = { st: 'fail', rows: [] }; } // an answer without a stays list is not a history: keep the dashed behaviour
        else H_hist[key] = { st: 'ok', rows: r.data.stays.filter(function (s) { return s && s.checkin && s.checkout; }).map(H_histRow) };
      }).catch(function () { if (gen === H_histGen) H_hist[key] = { st: 'fail', rows: [] }; }).then(function () { if (gen !== H_histGen) return; H_histV++; if (state.layout && current === 'calendar') render('calendar'); });
    }
    if (!H_occOff && !H_occ[key]) {
      H_occ[key] = { st: 'loading', pct: null };
      sb.rpc('get_hospitality_metrics_v1', { p_property_id: pid(), p_start: e.start, p_end_exclusive: e.next }).then(function (r) {
        if (gen !== H_histGen) return;
        if (r.error) { if (CS.rpcMissing(r.error) || r.error.code === '42501') H_occOff = true; H_occ[key] = { st: 'fail', pct: null }; return; }
        var o = r.data && r.data.metrics && r.data.metrics.occupancy, v = o && o.value !== null && o.value !== undefined && isFinite(Number(o.value)) ? Math.round(Number(o.value)) : null;
        H_occ[key] = { st: v === null ? 'fail' : 'ok', pct: v };
      }).catch(function () { if (gen === H_histGen) H_occ[key] = { st: 'fail', pct: null }; }).then(function () { if (gen === H_histGen && state.layout && current === 'calendar') render('calendar'); });
    }
  }
  var H_histGen = 0;
  // The slot is drawn for owner and admin only, always the same height; the sentence appears when the figure is there and stays out when it is not.
  function H_bookedSlot(m) {
    if (!CS.canSeeGuestContact(role()) || DEMO) return '';
    var e = H_occ[H_ymKey(m)];
    return '<p class="help H_booked" data-booked="' + (e && e.st === 'ok' ? '1' : '0') + '">' + (e && e.st === 'ok' ? esc('Booked ' + e.pct + '% of nights') : '') + '</p>';
  }

  // The arrival / checkout halves (hotel-calendar style): the arriving stay fills the lower-right triangle, the stay checking out the upper-left one.
  // Each stay keeps one shade of the blue family (--v5-g1..g6) for its whole length, so a turnover day is two halves in two shades.
  function A_shadeOf(st) { return st ? CS.A_stayShade(staysOf().indexOf(st)) : ''; }
  function halves(ds) {
    var h = '';
    if (ds.out) h += '<span class="hx hx-out" style="' + A_shadeOf(ds.out) + '" aria-hidden="true"></span>';
    if (ds.arrive) h += '<span class="hx hx-in" style="' + A_shadeOf(ds.stay) + '" aria-hidden="true"></span>';
    return h;
  }
  // Looks told apart by pattern as well as colour: free = outlined, blocked = hatched with the reason glyph, booked = filled in the guest's shade
  // with the guest's name on every week row. Arrival and checkout days are half-filled; a clash is a red ring + glyph. Notice glyph squares sit top-right.
  var MARK_ICON = { power: 'zap', water: 'drop', rain: 'rain', deep_clean: 'sparkles', blocked: 'wrench', note: 'note' };
  var MARK_WORD = { power: 'Power', water: 'Water', rain: 'Rain', deep_clean: 'Deep clean', blocked: 'Maintenance', note: 'Note' };
  var monthHas = { turn: false, clash: false, marks: {} }; // the legend names only what this month shows
  function A_firstName(st) { return String((st && st.guest_name) || 'Guest').split(/\s+/)[0]; }
  function calendarGrid() {
    var p = state.payload, m = monthState(), cells = CS.monthGrid(m.y, m.m), view = A_notices();
    var dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(function (d) { return '<div class="dow" aria-hidden="true">' + d + '</div>'; }).join('');
    monthHas = { turn: false, clash: false, marks: {} };
    var info = cells.map(function (c) { return c.iso ? dayStatusOf(c.iso) : null; });
    var body = cells.map(function (c, i) {
      if (!c.iso) return '<div class="d off" aria-hidden="true"></div>';
      var ds = info[i], booked = ds.primary === 'booked', blk = ds.primary === 'blocked', col = i % 7, nodata = c.iso < CS.H_dataFrom(p.today) && ds.primary === 'free' && !ds.out && !H_histOk(c.iso);
      if (ds.turnover) monthHas.turn = true; if (ds.clash.length) monthHas.clash = true;
      var cls = 'd s-' + ds.primary + (nodata ? ' nodata' : '') + (c.iso < p.today ? ' past' : '') + (c.iso === p.today ? ' today' : '') + (booked ? ' stay' : '') + (booked && ds.cont ? ' cont' : '') + (blk ? ' blk' : '') +
        (ds.arrive ? ' arr' : '') + (ds.out ? ' dep' : '') + (ds.turnover ? ' turn' : '') + (ds.clash.length ? ' clash' : '');
      // the guest's name starts on the first night cell of the stay and again at the start of each week row; it runs along the bar
      var tag = '';
      if (booked && !ds.arrive) {
        var prev = i > 0 ? info[i - 1] : null, starts = col === 0 || !prev || prev.stay !== ds.stay || prev.arrive;
        if (starts) { var run = 1; while (col + run < 7 && info[i + run] && info[i + run].stay === ds.stay && !info[i + run].arrive) run++; tag = '<span class="A_tag" style="width:calc(' + run + '00% + ' + (run - 1) * 3 + 'px - 8px)">' + esc(A_firstName(ds.stay)) + '</span>'; }
      }
      if (booked && ds.arrive && !ds.cont) tag = '<span class="A_tag in" style="' + A_shadeOf(ds.stay) + '">' + esc(A_firstName(ds.stay)) + '</span>';
      var marks = CS.A_dayMarks(c.iso, view, ds.flags); marks.forEach(function (k) { monthHas.marks[k] = true; });
      var mk = marks.length ? '<span class="A_marks" aria-hidden="true">' + marks.map(function (k) { return '<span class="A_mk ' + k + '">' + ICON(MARK_ICON[k] || 'note', 's12') + '</span>'; }).join('') + '</span>' : '';
      var inner = halves(ds) + '<span class="n">' + (+c.iso.slice(8)) + '</span>' + tag +
        (blk && !ds.out ? '<span class="g">' + ICON(BLOCK_ICON[ds.block.block_reason] || 'lock', 's12') + '</span>' : '') +
        (ds.clash.length ? '<span class="cx" aria-hidden="true">' + ICON('alert', 's12') + '</span>' : '') + mk;
      var moves = CS.dayMoves(ds), night = booked ? (ds.arrive ? 'booked' : 'booked, ' + ds.why) : blk ? 'blocked, ' + ds.why : nodata ? 'no stay information here' : 'free', nd = CS.A_noticeDay(view, c.iso);
      var label = CS.dayLong(c.iso) + (c.iso === p.today ? ', today' : '') + (ds.turnover ? ', turnover' : '') + (moves ? ', ' + moves : '') + ', ' + night +
        (ds.clash.length ? ', clash with ' + ds.clash.map(function (s) { return s.guest_name || 'another guest'; }).join(', ') : '') +
        (ds.flags.filter(function (f) { return !CS.A_flagDup(f, nd); }).length ? '; ' + ds.flags.filter(function (f) { return !CS.A_flagDup(f, nd); }).map(function (f) { return CS.flagName(f.kind); }).join(', ') : '') + (nd.length ? '; ' + nd.map(function (x) { return x.title; }).join(', ') : '');
      return '<button class="' + cls + '" type="button" style="' + A_shadeOf(ds.out || ds.stay) + '" data-day="' + c.iso + '" aria-label="' + esc(label) + '" aria-haspopup="dialog">' + inner + '</button>';
    }).join('');
    return '<div class="cal" role="group" data-E-swipe="month" aria-label="' + esc(CS.monthTitle(m.y, m.m)) + '">' + dows + body + '</div>';
  }
  // F2: the legend is ONE row: Booked, Turnover, Blocked, Clash and a More chip that opens the rest inline (and is remembered). From 600 px all of it shows in one row.
  function legend() {
    var sw = function (css, t) { return '<span><i class="A_sw" style="' + css + '"></i>' + t + '</span>'; };
    var mk = function (k) { return '<span><i class="A_mk ' + k + ' A_sw" style="display:inline-flex;align-items:center;justify-content:center">' + ICON(MARK_ICON[k], 's12') + '</i>' + MARK_WORD[k] + '</span>'; };
    var open = !!state.legendOpen;
    return '<div class="A_legend H_legend" role="group" aria-label="Legend" data-open="' + (open ? '1' : '0') + '"><div class="H_row">' +
      sw('background:var(--v5-g1)', 'Booked') + sw('background:linear-gradient(135deg,var(--v5-g1) 50%,var(--v5-g3) 50%)', 'Turnover') +
      sw('background:repeating-linear-gradient(135deg,transparent 0 3px,var(--v5-cal-hatch) 3px 5px),var(--v5-cal-blocked)', 'Blocked') +
      sw('background:var(--v5-danger-w);box-shadow:inset 0 0 0 2px var(--v5-cal-clash-ring)', 'Clash') +
      '<button class="H_more" type="button" data-act="legend-more" aria-expanded="' + open + '" aria-controls="H_extra">More' + ICON('chevdown', 's16') + '</button></div>' +
      '<div class="H_extra" id="H_extra">' + sw('background:var(--v5-surf);border:1px solid var(--v5-cal-free-edge)', 'Free') + sw('background:var(--v5-surf);box-shadow:inset 0 0 0 2px var(--v5-gold)', 'Today') +
      Object.keys(MARK_ICON).filter(function (k) { return monthHas.marks[k]; }).map(mk).join('') + '</div></div>';
  }
  function H_legendSave() { var ls = store('localStorage'); try { if (ls) ls.setItem('cs_legend_open', state.legendOpen ? '1' : '0'); } catch (e) {} }
  function warnKey(w) { return w.kind + '|' + (w.title || '') + '|' + ((w.detail && w.detail.date) || ''); }
  function warningItems() {
    var p = state.payload, items = CS.orderWarnings(p.warnings).map(function (w) {
      var ico, body;
      if (w.kind === 'brownout') { var b = CS.brownoutText(w); ico = ICON('zap', '').replace('class="i"', 'class="i c-warn"'); body = '<span class="num"><b>' + esc(b.head) + '</b>' + (b.rest ? ' · ' + esc(b.rest) : '') + '</span>'; }
      else if (w.kind === 'inventory') { var l = CS.lowStockText(w); ico = ICON('box').replace('class="i"', 'class="i c-danger"'); body = '<span><b>' + esc(l.head) + '</b> · ' + esc(l.rest) + '</span>'; }
      else { ico = ICON(w.severity === 'alert' ? 'alert' : 'info').replace('class="i"', 'class="i ' + (w.severity === 'alert' ? 'c-danger' : 'c-warn') + '"'); body = '<span><b>System check</b> · ' + esc(w.title) + '</span>'; }
      return '<li><button class="wbtn" type="button" data-warn="' + esc(warnKey(w)) + '" aria-haspopup="dialog">' + ico + body + '<span class="chev">' + ICON('chev', 's16') + '</span></button></li>';
    });
    var r = CS.rainLine(p.weather);
    if (r) items.push('<li>' + ICON('rain').replace('class="i"', 'class="i c-info"') + '<span class="num"><b>' + esc(r.head) + '</b>' + (r.rest ? ' · ' + esc(r.rest) : '') + '</span></li>');
    return items;
  }
  function calTabs(cur) {
    var t = [['calendar', '#calendar', 'Calendar'], ['notices', '#calendar/notices', 'Notices']]; // tap only: the old sub-tab swipe is gone
    return '<nav class="A_tabs card glass" aria-label="View">' + t.map(function (x) { return '<a href="' + x[1] + '" data-act="cal-tab" data-tab="' + x[0] + '"' + (x[0] === cur ? ' aria-current="page"' : '') + '>' + x[2] + '</a>'; }).join('') + '</nav>';
  }
  // MF2: three chips (glyph and word, never colour alone) and, where something is missing, one 44 px action beside it. Owner and admin only, and only when the server sent the field.
  function H_readyBlock(raw, g, actions) {
    var r = CS.H_ready(raw, role()); if (!r) return '';
    var chips = CS.H_readyChips(r).map(function (c) { return pill(c.ok ? 'ok' : 'warn', c.ok ? 'check' : 'clock', c.word); }).join(''), acts = '';
    if (actions) {
      var bk = r.paid === false ? A_hubLink('bookings') : null;
      if (bk) acts += bk.external ? ext(bk.href, 'Open booking' + ICON('ext', 's16'), 'btn btn-ghost btn-sm') : '<a class="btn btn-ghost btn-sm" href="' + esc(bk.href) + '">Open booking</a>';
      if (r.id === false && g && g.uid && canAddDetails()) acts += '<a class="btn btn-ghost btn-sm" href="./guest/?for=id#' + encodeURIComponent(g.uid) + '">Add ID photo</a>';
      if (r.door_code === false) acts += tgA(LINKS.tgOps, ICON('chat', 's16') + 'Set the door code in Cassy', 'btn btn-ghost btn-sm');
    }
    return '<div class="H_ready" role="group" aria-label="Arrival checklist"><div class="row-wrap">' + chips + '</div>' + (acts ? '<div class="row-wrap">' + acts + '</div>' : '') + '</div>';
  }
  function H_readyRaw(st) { // the merged stay, or one of the rows behind it, may carry arrival_ready
    if (!st) return null; if (st.arrival_ready) return st.arrival_ready;
    var r = (st.rows || []).filter(function (x) { return x && x.arrival_ready; })[0]; if (r) return r.arrival_ready;
    var p = state.payload, g = [p && p.next_guest, p && p.current_guest].filter(function (x) { return x && x.arrival_ready && x.guest_name === st.guest_name && x.checkin_date === st.checkin_date; })[0];
    return g ? g.arrival_ready : null;
  }
  function H_noticeLink(u) { return '<a class="btn btn-ghost btn-sm" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Open the original notice' + ICON('ext', 's16') + '</a>'; }
  function H_agendaRow(a) {
    var st = a.st, nights = st.nights != null ? st.nights : CS.daysBetween(st.checkin_date, st.checkout_date), src = CS.sourceLabel(st.source);
    var lead = a.kind === 'arrive' ? 'Arrives ' + CS.dayShort(st.checkin_date) : 'Leaves ' + CS.dayShort(st.checkout_date);
    var ready = a.kind === 'arrive' ? CS.H_ready(H_readyRaw(st), role()) : null;
    var chips = ready ? '<span class="H_chips">' + CS.H_readyChips(ready).map(function (c) { return pill(c.ok ? 'ok' : 'warn', c.ok ? 'check' : 'clock', c.word); }).join('') + '</span>' : '';
    return '<button class="rowi H_arow" type="button" data-day="' + esc(a.day) + '" aria-haspopup="dialog"><span class="lead">' + ICON(a.kind === 'arrive' ? 'user' : 'logout') + '</span><span class="mid"><span class="t">' + esc(st.guest_name || 'Guest') + '</span>' +
      '<span class="s num">' + esc(lead + ' · ' + CS.plural(nights, 'night') + (src ? ' · ' + src : '')) + '</span>' + chips + '</span><span class="chev">' + ICON('chev') + '</span></button>';
  }
  // One screen: the month, then the next 14 days (arrivals and departures; the full Arriving next and In the house cards come first), blocked nights and warnings.
  function calCalendar() {
    var p = state.payload, m = monthState(), ng = p.next_guest, cg = p.current_guest;
    var prevOk = !!monthStep(-1), nextOk = !!monthStep(1), grid = calendarGrid();
    var same = function (st, g) { return !!g && st.guest_name === g.guest_name && st.checkin_date === g.checkin_date; };
    var rows = CS.H_agenda(staysOf(), p.today, 14, function (st) { return same(st, ng) || same(st, cg); });
    var html = '<div class="calhdr"><button class="iconbtn" type="button" data-act="prev" aria-label="Previous month"' + (prevOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('back', 's24') + '</button><h2 class="dlg" aria-live="polite">' + esc(CS.monthTitle(m.y, m.m)) + '</h2><button class="iconbtn" type="button" data-act="next" aria-label="Next month"' + (nextOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('chev', 's24') + '</button></div>' +
      H_bookedSlot(m) + legend() + grid + '<p class="help H_help" style="text-align:center;margin:8px 0 0">Tap a day for who is staying. Swipe for the next month.</p>' + H_olderLine(m, p.today);
    html = '<div class="H_calleft">' + html + '</div><div class="H_calright">';
    html += '<div class="sect" id="agenda"><h2 class="hd H_agendahd">Next 14 days</h2>';
    if (ng) html += '<div class="stack">' + guestBlock(ng, 'next') + '</div>'; else if (!cg && !rows.length) html += '<p class="sub" style="margin:0">Nothing is booked to arrive or leave in the next 14 days.</p>';
    if (cg) html += '<div class="stack">' + guestBlock(cg, 'house') + '</div>';
    if (rows.length) html += '<div class="card glass list" role="list">' + rows.map(H_agendaRow).join('') + '</div>';
    html += '</div>';
    var blocked = CS.blockedLines(p.calendar || [], p.today);
    if (blocked.length) {
      html += '<div class="sect"><span class="cap up">Blocked nights</span><ul class="wlist">' + blocked.map(function (l) {
        return '<li>' + ICON(l.extra ? 'alert' : 'lock').replace('class="i"', 'class="i ' + (l.extra ? 'c-warn' : 'c-fg2') + '"') + '<span class="num">' + esc(CS.blockedLineText(l)) + '</span></li>';
      }).join('') + '</ul></div>';
    }
    var wi = warningItems();
    html += '<div class="sect" id="warnings"><span class="cap up">Warnings</span>' + (wi.length ? '<ul class="wlist">' + wi.join('') + '</ul>' : '<div class="card glass"><p class="sub">No warnings today.</p></div>') + '</div>';
    return html + '</div>';
  }
  // The server sends stays from a week back. An earlier month shows what exists and says where the rest is; the days it cannot know are dashed, never "free".
  function H_olderLine(m, today) {
    var from = CS.H_dataFrom(today); if (m.y + '-' + (m.m < 10 ? '0' : '') + m.m + '-01' >= from) return ''; var he = H_hist[H_ymKey(m)]; if (he && he.st === 'ok') return ''; // the months before today-7 are loaded for owner and admin
    var l = CS.canSeeGuestContact(role()) ? A_hubLink('bookings/calendar') : null;
    return '<p class="help H_older" style="text-align:center;margin:6px 0 0">' + esc('Stays before ' + CS.dayLabel(from) + ' are ' + (l ? 'in the admin dashboard.' : 'not shown here.')) + '</p>' +
      (l ? '<div style="text-align:center">' + (l.external ? ext(l.href, 'Open the booking calendar' + ICON('ext', 's16'), 'btn btn-ghost btn-sm') : '<a class="btn btn-ghost btn-sm" href="' + esc(l.href) + '">Open the booking calendar</a>') + '</div>' : '');
  }
  // The Notices view: weather with the rain watch, power and water notices, house items (owner and admin), how to add one. Cleaners never get Tell the guest, Resolve or the House list.
  function A_noticeRow(n) {
    var tell = n.tell && CS.canSeeGuestContact(role());
    return '<section class="card glass A_nrow" aria-label="' + esc(n.title) + '"><div class="top"><span class="lead A_t-' + esc(n.type) + '">' + ICON(A_noticeIcon(n.type)) + '</span><div class="mid"><span class="t">' + esc(n.title) + '</span>' +
      (n.sub ? '<span class="s">' + esc(n.sub) + '</span>' : '') + (n.detail ? '<span class="A_det">' + esc(n.detail) + '</span>' : '') + '</div></div>' +
      (tell || n.date || n.url ? '<div class="acts">' + (tell ? '<button class="btn btn-secondary btn-sm" type="button" data-act="notice-tell" data-nkey="' + esc(n.key) + '">Tell the guest</button>' : '') +
        (n.url ? H_noticeLink(n.url) : '') +
        (n.date ? '<button class="btn btn-ghost btn-sm" type="button" data-act="notice-cal" data-date="' + esc(n.date) + '">Open on calendar</button>' : '') + '</div>' : '') + '</section>';
  }
  function A_houseRow(h) {
    var mgr = CS.canSeeGuestContact(role()), inv = h.kind === 'low_stock' ? A_hubLink('inventory') : null;
    var acts = (mgr && h.kind === 'finding' && h.id ? '<button class="btn btn-secondary btn-sm" type="button" data-act="notice-resolve" data-id="' + esc(h.id) + '">Resolve</button>' : '') +
      (h.kind === 'finding' ? '<a class="btn btn-ghost btn-sm" href="#tasks">Go to' + ICON('chev', 's16') + '</a>' : inv ? '<a class="btn btn-ghost btn-sm" href="' + esc(inv.href) + '"' + (inv.external ? ' target="_blank" rel="noopener"' : '') + '>Go to' + ICON('chev', 's16') + '</a>' : '');
    return '<div class="rowi" style="cursor:default;flex-wrap:wrap"><span class="lead A_t-house">' + ICON(h.kind === 'low_stock' ? 'box' : 'alert') + '</span><span class="mid"><span class="t">' + esc(h.title) + '</span>' + (h.detail ? '<span class="s">' + esc(h.detail) + '</span>' : '') + '</span>' +
      (acts ? '<div class="A_acts">' + acts + '</div>' : '') + '</div>';
  }
  // Where the notices come from: a plain link for every role (https facebook.com only, validated in lib), and an opt-in panel of the page's latest posts.
  var fbCarry = false; // true while renderCalendar is carrying the live frame node over: the new markup then holds an empty box, so no second request starts
  var SRC_WORD = { water: 'GSCWD', power: 'SOCOTECO II' };
  function A_sourceRow(kind, url) {
    return '<nav class="card glass list" aria-label="' + SRC_WORD[kind] + ' page"><a class="rowi" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><span class="lead">' + ICON('ext') + '</span><span class="mid"><span class="t">Check the ' + SRC_WORD[kind] + ' page</span><span class="s">Opens Facebook in a new tab</span></span><span class="chev">' + ICON('ext', 's16') + '</span></a></nav>';
  }
  // Never loaded by itself (data cost, and a third-party frame); never in demo; never cached by the service worker.
  function A_fbPanel(page) {
    if (!state.fbOpen) return '<button class="btn btn-secondary btn-block" type="button" data-act="fb-show">Show the latest GSCWD posts</button>';
    var carried = fbCarry;
    var cap = 'From GSCWD’s Facebook page.' + (CS.canSeeGuestContact(role()) ? ' To add one to the calendar, send the post link to Cassy.' : '');
    var body = '';
    if (DEMO) body = '<p class="sub" style="margin:0">Demo: the live posts are not loaded here.</p>';
    else { var url = CS.A_fbPluginUrl(page, Math.min(500, (window.innerWidth || 360) - 32)); if (url) body = '<div class="A_fbbox" id="A_fbbox">' + (carried ? '' : '<iframe title="Latest GSCWD posts" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" src="' + esc(url) + '"></iframe>') + '</div>'; }
    return '<div class="card glass A_card" aria-label="Latest GSCWD posts">' + body + '<p class="help" style="margin:0">' + esc(cap) + '</p><button class="btn btn-secondary" type="button" data-act="fb-hide">Hide</button></div>';
  }
  // The Notices weather card when notices_v1 has no weather: the Home reading (current conditions and its age only, never hourly bars or a rain watch), else a plain line. Both open the forecast.
  function H_wxCard() {
    var w = state.payload && state.payload.weather, c = w && w.current, chev = '<span class="chev">' + ICON('chev') + '</span>';
    if (c && c.temp != null) return '<section class="card glass A_card" aria-label="Weather"><a class="row-wrap H_wxlink" href="#weather" style="gap:14px" aria-label="Open the forecast"><span class="A_temp">' + Math.round(+c.temp) + '°</span><span class="mid"><span class="t">' + esc(c.description || 'Weather') + '</span><span class="s">' + (w.fetched_at ? 'as of ' + esc(CS.clockLabel(w.fetched_at)) + ' · ' : '') + 'tap for the forecast</span></span>' + chev + '</a></section>';
    return '<section class="card glass A_card" aria-label="Weather"><a class="row-wrap H_wxlink" href="#weather" style="gap:14px" aria-label="Open the forecast"><span class="mid"><span class="t">The forecast is not available right now</span><span class="s">It comes back by itself. Tap to open the forecast.</span></span>' + chev + '</a></section>';
  }
  function calNotices() {
    var v = A_notices();
    if (state.noticesAbsent) return '<div class="card glass"><p class="sub">Notices are not set up yet. Brownouts and the weather still show under Stays, in Warnings.</p><a class="btn btn-secondary btn-sm" href="#calendar/warnings" style="margin-top:10px">See warnings</a></div>';
    if (!v) return state.noticesLoading ? '<div class="stack"><div class="skel" style="height:120px"></div><div class="skel" style="height:96px"></div></div>' : '<div class="errbox" role="alert">' + ICON('alert') + '<span>No connection. <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>';
    var f = state.noticeFilter, filters = CS.A_noticeFilters(v), W = v.weather, html = '';
    if (!filters.some(function (x) { return x[0] === f; })) f = 'all';
    html += '<div class="A_filters" role="group" aria-label="Filter notices">' + filters.map(function (x) { return '<button class="chip" type="button" data-nfilter="' + x[0] + '" aria-pressed="' + (x[0] === f) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
    if (CS.canSeeGuestContact(role())) html += '<button class="btn btn-secondary btn-block H_addnotice" type="button" data-act="notice-add-open" data-date="' + esc(state.payload.today) + '">' + ICON('plus', 's16') + 'Add a notice</button>';
    if ((f === 'all' || f === 'weather') && W) {
      html += '<div class="A_label">Weather</div><section class="card glass A_card" aria-label="Weather"><a class="row-wrap H_wxlink" href="#weather" style="gap:14px" aria-label="Open the forecast"><span class="A_temp">' + W.temp + '°</span><span class="mid"><span class="t">' + esc(W.condition || 'Weather') + '</span>' +
        (W.watch ? '<span class="s">' + ICON('rain', 's16') + ' ' + esc(W.watch.text) + '</span>' : '<span class="s">' + (W.rain != null ? W.rain + '% chance of rain' : '') + (W.aqi != null ? ' · air quality ' + W.aqi : '') + '</span>') + '</span><span class="chev">' + ICON('chev') + '</span></a>' +
        (W.hours.length ? '<div class="A_hours" aria-label="Chance of rain by hour">' + W.hours.map(function (h) { return '<div><span>' + h.pct + '%</span><i style="height:' + Math.max(4, Math.round(h.pct * 0.6)) + 'px"></i><span>' + esc(h.label) + '</span></div>'; }).join('') + '</div>' : '') +
        (W.watch ? '<p class="sub" style="margin:0">Close the windows and bring in the laundry before the rain.</p>' : '') +
        '<p class="help" style="margin:0">' + esc(W.source ? W.source + ' forecast' : 'Forecast') + (W.fetched_at ? ' · as of ' + esc(CS.clockLabel(W.fetched_at)) : '') + '</p></section>';
    } else if ((f === 'all' || f === 'weather') && !W) html += '<div class="A_label">Weather</div>' + H_wxCard();
    [['power', 'Power'], ['water', 'Water']].forEach(function (g) {
      var rows = v.list.filter(function (n) { return n.group === g[0]; }), link = v.sources[g[0]];
      if ((f === 'all' || f === g[0]) && (rows.length || link)) html += '<div class="A_label">' + g[1] + '</div>' + rows.map(A_noticeRow).join('') + (link ? A_sourceRow(g[0], link) : '') + (g[0] === 'water' && link ? A_fbPanel(link) : '');
    });
    if (f === 'all') { var other = v.list.filter(function (n) { return n.group === 'other' || (n.group === 'weather' && n.key !== 'rain-watch'); }); if (other.length) html += '<div class="A_label">Other</div>' + other.map(A_noticeRow).join(''); }
    if (v.mgr && (f === 'all' || f === 'house')) html += '<div class="A_label">House</div>' + (v.house.length ? '<section class="card glass list" aria-label="House">' + v.house.map(A_houseRow).join('') + '</section>' : '<div class="card glass"><p class="sub">Nothing needs a person in the house.</p></div>');
    if (f !== 'weather' && f !== 'house' && !v.list.length && f === 'all' && !W) html += '<div class="card glass"><p class="sub">No notices right now.</p></div>';
    if (CS.canSeeGuestContact(role())) html += '<section class="card glass A_card" aria-label="Add a notice"><h2 class="hd">Add a notice</h2><p class="sub" style="margin:0">Saw an advisory from SOCOTECO II or GSCWD? Forward the post to Cassy in Telegram and tap Save. It shows here and on the calendar.</p>' +
      tgA(LINKS.tgOps, ICON('chat', 's16') + 'Open Cassy · OPS', 'btn btn-secondary btn-sm') + '</section>';
    return html;
  }
  var E_tabFocus = false;
  // The one-time peek of the month grid (24 px right and back over 360 ms, once per visit) tells a person the grid moves; a title fade shows a month swipe landed.
  function H_calHints(el) {
    var cal = el.querySelector && el.querySelector('.cal'); if (!cal || !cal.classList) return;
    if (state.H_fade) { state.H_fade = false; cal.classList.add('H_fade'); }
    else if (!state.H_peekedCal && state.calTab === 'calendar' && !E_reduced()) { state.H_peekedCal = true; cal.classList.add('H_peek'); }
  }
  function renderCalendar() {
    var el = $('v-calendar'), head = appbar({ title: 'Calendar', refresh: true }); // a tab screen: no Back arrow, like Tasks and More
    if (!state.payload) { el.innerHTML = head + '<div class="screen">' + (state.error ? errBanner() : loadingBlock()) + '</div>'; return; }
    var tab = state.calTab;
    var keepFb = state.fbOpen && tab === 'notices' && el.querySelector ? el.querySelector('#A_fbbox') : null; if (keepFb && keepFb.parentNode) keepFb.parentNode.removeChild(keepFb); else keepFb = null;
    fbCarry = !!keepFb;
    var inner = head + '<div class="screen">' + errBanner() + calTabs(tab) + '<div class="E_tabbody" data-F-tab="' + tab + '">' + (tab === 'notices' ? calNotices() : calCalendar()) + '<div class="help" style="text-align:center;margin-top:14px">Updated ' + esc(CS.agoLabel(state.payload.generated_at)) + '</div></div></div>';
    fbCarry = false;
    el.innerHTML = inner;
    if (E_tabFocus) { E_tabFocus = false; var ct = el.querySelector && el.querySelector('.A_tabs a[aria-current="page"]'); if (ct && ct.focus) ct.focus(); } // an arrow key moved the view: focus follows it
    if (keepFb) { var fresh = el.querySelector('#A_fbbox'); if (fresh && fresh.parentNode) fresh.parentNode.replaceChild(keepFb, fresh); }
    loadIdPhotos(el); H_calHints(el);
    if (tab === 'calendar') H_calLoads(monthState());
  }

  // ---------------------------------------------------------------- day and warning sheets (s77): the .sheet/.scrim pattern of the iOS hint.
  // One sheet element, made once; its content is redrawn from state.sheet so a reload under it keeps it current. The status line lives
  // outside the redrawn part so screen readers hear "Note added" and errors.
  function sheetEls() {
    var sh = $('cal-sheet');
    if (!sh) {
      var sc = document.createElement('div'); sc.className = 'scrim'; sc.id = 'cal-scrim'; sc.addEventListener('click', E_tryClose); document.body.appendChild(sc);
      sh = document.createElement('div'); sh.className = 'sheet calsheet'; sh.id = 'cal-sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
      sh.setAttribute('aria-labelledby', 'cs-h'); sh.setAttribute('aria-hidden', 'true');
      sh.innerHTML = '<div class="E_grab" aria-hidden="true"></div><div class="sr" id="cs-live" role="status" aria-live="polite"></div><div id="cs-body"></div>'; document.body.appendChild(sh);
    }
    return { sheet: sh, scrim: $('cal-scrim') };
  }
  function openSheet(kind, key) {
    var opener = document.activeElement;
    state.sheet = { kind: kind, key: key, view: current, opener: opener, form: { kind: 'brownout', label: '' }, busy: false, err: '', msg: '', missing: false };
    var e = sheetEls(); $('cs-live').textContent = ''; drawSheet();
    e.sheet.classList.add('on'); e.sheet.setAttribute('aria-hidden', 'false'); e.scrim.classList.add('on'); e.scrim.setAttribute('data-F-kind', kind);
    var appEl = $('app'); if (appEl && appEl.setAttribute) appEl.setAttribute('inert', ''); // the sheet says aria-modal: what is behind it cannot be tabbed to or read
    var h = kind === 'add' ? $('t-title') : kind === 'nadd' ? $('n-title') : $('cs-h'); if (h) h.focus();
  }
  function closeSheet() {
    var S = state.sheet; if (!S) return; state.sheet = null;
    var appEl = $('app'); if (appEl && appEl.removeAttribute) appEl.removeAttribute('inert');
    var e = sheetEls(), attr = S.kind === 'day' ? 'data-day' : S.kind === 'warn' ? 'data-warn' : 'data-act';
    e.sheet.classList.remove('on'); e.sheet.setAttribute('aria-hidden', 'true'); e.scrim.classList.remove('on');
    var want = S.kind === 'add' ? 'task-add-open' : S.kind === 'nadd' ? 'notice-add-open' : S.kind === 'news' ? 'whatsnew' : S.kind === 'attn' ? 'attn-open' : S.key;
    E_sheetReset(e.sheet, e.scrim);
    var back = Array.prototype.filter.call(document.querySelectorAll('[' + attr + ']'), function (b) { return b.getAttribute(attr) === want; })[0];
    if (back) back.focus(); else if (S.opener && S.opener.isConnected !== false && S.opener.focus && S.opener !== document.body) S.opener.focus(); // back to what opened it
  }
  // Escape and a tap on the scrim never throw away something typed: they say how to leave, and keep the focus where the person was typing
  function E_keep() {
    var S = state.sheet; if (!S) return; var ae = document.activeElement && document.activeElement.id;
    S.hint = 'Close with the Close button to discard what you typed.'; sheetLive(S.hint); drawSheet(); var f = ae ? $(ae) : null; if (f && f.focus) f.focus();
  }
  function E_tryClose() { if (!state.sheet) return; if (E_dirty()) E_keep(); else closeSheet(); }
  function sheetLive(msg) { var l = $('cs-live'); if (l) l.textContent = msg || ''; }
  function findWarn(key) { return ((state.payload && state.payload.warnings) || []).filter(function (w) { return warnKey(w) === key; })[0] || null; }
  function role() { return state.access && state.access.role; }
  function daySheet(S) {
    var p = state.payload, ds = dayStatusOf(S.key), canFlag = CS.canFlagDays(role());
    var old = S.key < CS.H_dataFrom(p.today) && ds.primary === 'free' && !ds.out && !ds.arrive && !H_histOk(S.key), prim = ds.primary === 'booked' ? pill('brand', 'house', 'Booked') : ds.primary === 'blocked' ? pill('neutral', 'lock', 'Blocked') : old ? pill('neutral', 'info', 'Not shown here') : pill('ok', 'check', 'Free');
    var html = '<h2 class="ttl" id="cs-h" tabindex="-1">' + esc(CS.dayLong(S.key)) + '</h2><div class="row-wrap" style="margin-top:8px">' + prim +
      (ds.turnover ? pill('info', 'repeat', 'Turnover') : '') + (ds.clash.length ? pill('danger', 'alert', 'Clash') : '') + '<span class="sub">' + esc(ds.why) + '</span></div>';
    var all = staysOf();
    var stayLine = function (st, what) {
      var src = CS.sourceLabel(st.source);
      return '<p class="sub num" style="margin:8px 0 0"><b>' + esc((st.guest_name || 'Guest') + ' ' + what) + '</b> · ' + esc(CS.stayDates(st) + (src ? ' · ' + src : '')) + '</p>' +
        (st.rows.length > 1 ? '<p class="help" style="margin:2px 0 0">' + esc(st.rows.length + ' bookings for this guest, shown as one stay') + '</p>' : '') +
        '';
    };
    if (ds.out) html += stayLine(ds.out, 'checks out');
    if (ds.stay) {
      html += stayLine(ds.stay, ds.arrive ? 'arrives' : 'is staying');
      if (ds.arrive) html += H_readyBlock(H_readyRaw(ds.stay), ds.stay, true);
      if (ds.block) html += '<p class="help" style="margin-top:4px">Also held on the calendar: ' + esc(ds.blockWhy) + '</p>';
    }
    if (ds.clash.length) html += '<div class="errbox" style="margin-top:10px">' + ICON('alert') + '<span>' + esc('Two different guests on this night: ' + ds.clash.map(function (s) { return (s.guest_name || 'Guest') + ' (' + CS.stayDates(s) + ')'; }).join(', ') + '. One booking needs to move.') + '</span></div>' +
      ds.clashIn.map(function (s) { return '<p class="sub num" style="margin:8px 0 0"><b>' + esc('Second arrival: ' + (s.guest_name || 'Guest')) + '</b> · ' + esc(CS.stayDates(s)) + '</p>'; }).join('');
    var nd = CS.A_noticeDay(A_notices(), S.key).filter(function (n) { return !n.fromFlag; }), T = A_houseT(); // a hand-added flag already has its own line under Also on this day
    if (nd.length) html += '<div class="cap up" style="margin:14px 0 6px">Notices</div><ul class="wlist">' + nd.map(function (n) {
      return '<li>' + ICON(A_noticeIcon(n.type)) + '<span style="flex:1"><b>' + esc(n.title) + '</b>' + (n.sub ? '<br><span class="help">' + esc(n.sub) + '</span>' : '') + (n.url ? '<br>' + H_noticeLink(n.url) : '') + '</span>' +
        (n.tell && CS.canSeeGuestContact(role()) ? '<button class="btn btn-secondary btn-sm" type="button" data-act="notice-tell" data-nkey="' + esc(n.key) + '">Tell the guest</button>' : '') + '</li>';
    }).join('') + '</ul>';
    html += '<div class="cap up" style="margin:14px 0 6px">Cleaning</div><p class="sub" style="margin:0">' + (ds.out || ds.arrive ? (ds.out ? esc((ds.out.guest_name || 'Guest') + ' out ' + T.outLabel) : '') + (ds.out && ds.arrive ? ', ' : '') + (ds.arrive ? esc((ds.stay.guest_name || 'Guest') + ' in ' + T.inLabel) : '') + '.' : 'No turnover this day.') + '</p>';
    if (canFlag && state.notices && !state.noticesAbsent) html += '<button class="btn btn-secondary btn-sm" type="button" data-act="notice-add-open" data-date="' + esc(S.key) + '" style="margin-top:8px">' + ICON('plus', 's16') + 'Add a notice</button>';
    var fl = ds.flags.filter(function (f) { return f.source === 'manual' || !CS.A_flagDup(f, nd); });
    if (fl.length) html += '<div class="cap up" style="margin:14px 0 6px">Also on this day</div>'; // an empty "Nothing else noted" took a line and told nobody anything
    html += fl.length ? '<ul class="wlist">' + fl.map(function (f) {
      var lbl = f.label && f.label !== CS.flagName(f.kind) ? ' · ' + esc(f.label) : '';
      return '<li>' + ICON(FLAG_ICON[f.kind] || 'note').replace('class="i"', 'class="i ' + (f.kind === 'brownout' ? 'c-warn' : 'c-fg2') + '"') + '<span style="flex:1"><b>' + esc(CS.flagName(f.kind)) + '</b>' + lbl +
        (f.source === 'auto' ? ' <span class="help">(added automatically)</span>' : '') + '</span>' +
        (canFlag && f.source === 'manual' && f.id ? '<button class="btn btn-ghost btn-sm" type="button" data-act="flag-clear" data-id="' + esc(f.id) + '"' + (S.busy ? ' disabled' : '') + ' aria-label="' + esc('Remove ' + CS.flagName(f.kind) + (f.label ? ': ' + f.label : '')) + '">Remove</button>' : '') + '</li>';
    }).join('') + '</ul>' : '';
    if (canFlag && S.missing) html += '<div class="cap up" style="margin:14px 0 6px">Add a note for this day</div><p class="help">Available after the next update.</p>';
    else if (canFlag && !S.formOpen) html += '<button class="btn btn-secondary btn-sm" type="button" data-act="dayform-open" style="margin-top:14px">' + ICON('plus', 's16') + 'Add a note for this day</button>'; // the form opens in place, so Close stays in reach
    else if (canFlag) {
      html += '<div class="cap up" style="margin:14px 0 6px">Add a note for this day</div>';
      html += '<div class="stack"><div class="field"><label for="df-kind">Kind</label><select class="sel" id="df-kind" style="max-width:none;text-align:left;text-align-last:left">' +
        CS.FLAG_KINDS.map(function (k) { return '<option value="' + k + '"' + (S.form.kind === k ? ' selected' : '') + '>' + esc(CS.flagName(k)) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="df-label">Short note (optional)</label><div class="input"><input id="df-label" maxlength="60" autocomplete="off" value="' + esc(S.form.label) + '" placeholder="Short note, no phone numbers or amounts"></div></div>' +
        '<button class="btn btn-primary" type="button" data-act="flag-save"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving…' : 'Add note') + '</button></div>';
    }
    return html;
  }
  function warnSheet(S) {
    var w = findWarn(S.key);
    if (!w) return '<h2 class="ttl" id="cs-h" tabindex="-1">Warning</h2><p class="sub" style="margin-top:8px">This warning has cleared.</p>';
    var info = CS.warningInfo(w, role()), html = '<h2 class="ttl" id="cs-h" tabindex="-1">' + esc(info.head) + '</h2><p class="sub" style="margin-top:8px">' + esc(info.meaning) + '</p>';
    var key = w.kind === 'verifier' ? CS.findingKey(w, state.tasks && state.tasks.tasks) : null;
    var task = key && state.tasks ? state.tasks.tasks.filter(function (t) { return t.source === 'verifier_findings' && t.id === key; })[0] : null;
    var details = info.details.concat(task && task.detail ? [task.detail] : []);
    if (details.length) html += '<ul class="notes" style="margin-top:10px">' + details.map(function (d) { return '<li>' + ICON('info') + '<span style="white-space:pre-line">' + esc(d) + '</span></li>'; }).join('') + '</ul>';
    var acts = '';
    if (w.kind === 'verifier' && info.resolvable) acts += key ? '<button class="btn btn-primary" type="button" data-act="warn-ack"' + (S.busy ? ' disabled' : '') + '>' + ICON('check', 's16') + (S.busy ? 'Saving…' : 'Mark as handled') + '</button>'
      : '<a class="btn btn-secondary" href="#tasks" data-act="sheet-close">Mark it in Tasks</a>';
    if (info.go) acts += info.go.external ? ext(info.go.href, esc(info.go.label) + ICON('ext', 's16'), 'btn btn-secondary', ' data-act="sheet-close"') : '<a class="btn btn-secondary" href="' + esc(info.go.href) + '" data-act="sheet-close">' + esc(info.go.label) + '</a>';
    if (acts) html += '<div class="row-wrap" style="margin-top:14px">' + acts + '</div>';
    if (w.kind === 'verifier' && info.resolvable && key) html += '<p class="help" style="margin-top:6px">It stays listed as seen until the next check finds it fixed.</p>';
    return html;
  }
  function drawSheet() {
    var S = state.sheet; if (!S || (!state.payload && S.kind !== 'attn')) return; // the pill's list can say "Loading" and "No connection" before there is a payload
    var e = sheetEls(), had = e.sheet.contains(document.activeElement);
    e.sheet.setAttribute('data-F-kind', S.kind); e.sheet.setAttribute('data-E-swipe', E_sheetTwin(S.kind)); // the pull-down's tap twin: the button with this data-act is on the sheet
    $('cs-body').innerHTML = E_sheetPage(S, (S.kind === 'attn' ? E_attnSheet() : S.kind === 'day' ? daySheet(S) : S.kind === 'add' ? addReminderCard() : S.kind === 'news' ? A_newsSheet() : S.kind === 'nadd' ? A_noticeAddForm() : S.kind === 'rate' ? A_rateConfirm() : S.kind === 'tour' ? H_tourSheet(S) : warnSheet(S)) +
      (S.err ? '<div class="errbox" style="margin-top:12px">' + ICON('alert') + '<span>' + esc(S.err) + '</span></div>' : '') +
      (S.msg ? '<div class="okbox" style="margin-top:12px">' + ICON('check') + '<span>' + esc(S.msg) + '</span></div>' : '') + (S.hint ? '<p class="help" role="status" style="margin:8px 0 0">' + esc(S.hint) + '</p>' : '') +
      '');
    if (had && !e.sheet.contains(document.activeElement)) { var h = $('cs-h'); if (h) h.focus(); }
  }
  // The day sheet's neighbour day: the same sheet, a new date. A note being typed is kept (the person closes or saves first).
  function H_dayGo(dir) {
    var S = state.sheet; if (!S || S.kind !== 'day' || !state.payload) return false;
    var d = CS.H_dayStep(S.key, dir, state.payload.today); if (!d) return false;
    if (E_dirty()) { S.hint = 'Add the note, or close this day, before moving to another one.'; sheetLive(S.hint); drawSheet(); return false; }
    S.key = d; S.formOpen = false; S.form.label = ''; S.err = ''; S.msg = ''; S.hint = ''; S.confirm = false;
    var a = d.split('-'); state.month = { y: +a[0], m: +a[1] };
    if (current === 'calendar') renderCalendar();
    drawSheet(); sheetLive(CS.dayLong(d)); E_vibe('tap');
    var b = $('cs-body'); if (b && b.classList && !E_reduced()) { b.classList.add('H_fade'); setTimeout(function () { b.classList.remove('H_fade'); }, 160); }
    return true;
  }
  // MF4: three cards, once per phone (cs_seen_v3), Skip at any time; also from More. Never in the demo's own start.
  var H_TOUR = [['Today', 'Today shows who is here and what is next.'],
    ['Calendar', 'Tap a day for who is staying. Swipe the grid left or right for the next month. The Notices tab has the weather, power and water.'], ['Tasks', '']];
  function H_tourSheet(S) {
    var i = S.step || 0, t = H_TOUR[i], last = i === H_TOUR.length - 1, txt = i === 2 ? 'Tap a task’s box when it is done, or swipe it left. ' + (state.layout === 'staff' ? 'Your cleaning fee is under Work on Today.' : 'Pay staff is under Admin on Today.') : t[1];
    return '<h2 class="ttl" id="cs-h" tabindex="-1">' + esc(t[0]) + '</h2><p class="sub" style="margin-top:8px">' + esc(txt) + '</p><p class="help" style="margin:8px 0 0">' + (i + 1) + ' of ' + H_TOUR.length + '</p>' +
      '<div class="row-wrap" style="margin-top:14px"><button class="btn btn-primary" type="button" data-act="tour-next">' + (last ? 'Done' : 'Next') + '</button>' + (last ? '' : '<button class="btn btn-ghost" type="button" data-act="tour-skip">Skip</button>') + '</div>';
  }
  function H_tourMaybe() {
    var delay = typeof window.H_TOUR_DELAY === 'number' ? window.H_TOUR_DELAY : 1500;
    setTimeout(function () {
      if (DEMO || !state.layout || state.sheet || ($('a2hs') && $('a2hs').classList.contains('on'))) return; // not over the Add to Home Screen hint: it starts on the next open
      var ls = store('localStorage'); try { if (!ls || ls.getItem('cs_seen_v3') === '1') return; ls.setItem('cs_seen_v3', '1'); } catch (e) { return; }
      openSheet('tour', 'tour-open'); state.sheet.step = 0; drawSheet();
    }, delay);
  }
  function A_newsSheet() {
    var items = CS.A_whatsNew(role(), { notices: !state.noticesAbsent && !!state.notices });
    return '<h2 class="ttl" id="cs-h" tabindex="-1">What’s new</h2><ul class="A_news" style="margin-top:8px">' + items.map(function (i) { return '<li>' + ICON('sparkles', 's16') + '<span><b>' + esc(i.title) + '</b><br><span class="sub">' + esc(i.text) + '</span></span></li>'; }).join('') + '</ul>';
  }
  function sheetCall(name, args, okMsg) {
    var S = state.sheet; if (!S || S.busy) return;
    S.busy = true; S.err = ''; S.msg = ''; drawSheet();
    sb.rpc(name, args).then(function (r) {
      if (r.error) throw r.error;
      if (r.data && r.data.ok === false) throw { message: r.data.error || 'not ok' };
      S.msg = okMsg; S.form.label = ''; sheetLive(okMsg); E_vibe('tap');
      return Promise.all([loadHome(), loadTasks()]);
    }).catch(function (e) {
      if (CS.rpcMissing(e)) { S.missing = true; sheetLive('Available after the next update.'); return; }
      S.err = e && e.code === '42501' ? 'Only an owner or admin can change this.' : 'That did not save. Check your signal and try again.'; sheetLive(S.err); E_vibe('error');
    }).then(function () { S.busy = false; if (state.sheet === S) drawSheet(); });
  }
  function flagSave() {
    var S = state.sheet; if (!S) return;
    sheetCall('calendar_day_flag_set_v1', { p_property_id: pid(), p_date: S.key, p_kind: S.form.kind, p_label: S.form.label.trim() || CS.flagName(S.form.kind) }, 'Note added.');
  }
  function warnAck() {
    var S = state.sheet, w = S && findWarn(S.key), key = w && CS.findingKey(w, state.tasks && state.tasks.tasks); if (!key) return;
    sheetCall('ack_verifier_finding_v1', { p_key: key }, 'Marked as handled.');
  }

  // ---------------------------------------------------------------- "To look at" sheet (E_): what the pill opens
  // One list, in the order of CS.E_attention: at most 3 rows a group, then "See all N". Every row is a real link or button; a tap closes the sheet first.
  function H_attnAck(key) {
    var w = findWarn(key), k = w && CS.findingKey(w, state.tasks && state.tasks.tasks); if (!k || !CS.canSeeGuestContact(role())) return;
    sb.rpc('ack_verifier_finding_v1', { p_key: k }).then(function (r) { if (r.error) throw r.error; toast('Marked as handled'); E_vibe('tap'); return Promise.all([loadHome(), loadTasks()]); })
      .catch(function () { E_vibe('error'); toast('That did not save. Check your signal and try again.'); });
  }
  function E_go(r) { // -> { tag, attrs, ext }
    var go = r.go, l;
    if (go.kind === 'tasks') return { tag: 'a', attrs: ' href="#tasks" data-act="attn-tasks" data-filter="' + esc(go.filter) + '"', ext: false };
    if (go.kind === 'day') return { tag: 'button', attrs: ' type="button" data-act="notice-cal" data-date="' + esc(go.date) + '"', ext: false };
    if (go.kind === 'bookings') { l = A_hubLink('bookings/inquiries') || { href: CS.INQUIRIES_URL, external: true }; }
    else if (go.kind === 'inbox') { l = { href: '#inbox', external: false }; } // 3.2: the shell's own Inbox
    else if (go.kind === 'inventory') { l = state.layout === 'admin' ? A_hubLink('inventory') : null; l = l || { href: '#calendar/warnings', external: false }; }
    else if (go.kind === 'warn') return { tag: 'button', attrs: ' type="button" data-warn="' + esc(go.key) + '"', ext: false };
    else l = { href: '#calendar/notices', external: false };
    if (!l) l = { href: '#home', external: false };
    return { tag: 'a', attrs: ' href="' + esc(l.href) + '" data-act="sheet-close"' + (l.external ? ' target="_blank" rel="noopener"' : ''), ext: !!l.external };
  }
  function E_rowHtml(r) {
    var g = E_go(r);
    var inner = '<' + g.tag + ' class="rowi"' + g.attrs + '><span class="lead' + (r.tile ? ' A_t-' + r.tile : '') + '">' + ICON(r.glyph) + '</span><span class="mid"><span class="t">' + esc(r.title) + '</span>' + (r.sub ? '<span class="s">' + esc(r.sub) + '</span>' : '') +
      '</span><span class="chev">' + ICON(g.ext ? 'ext' : 'chev', g.ext ? 's16' : '') + '</span></' + g.tag + '>';
    var isTask = r.go.kind === 'tasks' && typeof r.id === 'string' && r.id.indexOf(':') > 0, ver = isTask && r.id.indexOf('verifier_findings:') === 0;
    var off = isTask && state.H_offKey === r.id ? '<span class="help c-danger H_noconn H_attoff" role="status">No connection</span>' : '';
    if (isTask && !ver) return '<div class="H_attrow"><button class="chk H_chk" type="button" role="checkbox" aria-checked="false" aria-label="' + esc('Mark done: ' + r.title) + '" data-act="task-done" data-task="' + esc(r.id) + '">' + ICON('check', 's16') + '</button>' + inner + off + '</div>';
    if (ver) return '<div class="H_attrow H_stack">' + inner + '<button class="btn btn-ghost btn-sm" type="button" data-act="task-done" data-task="' + esc(r.id) + '" aria-label="' + esc('Mark as handled: ' + r.title) + '">' + ICON('check', 's16') + 'Mark as handled</button>' + off + '</div>';
    var w = r.go.kind === 'warn' ? findWarn(r.go.key) : null;
    if (w && w.kind === 'verifier' && CS.findingKey(w, state.tasks && state.tasks.tasks)) return '<div class="H_attrow H_stack">' + inner + '<button class="btn btn-ghost btn-sm" type="button" data-act="attn-ack" data-warn="' + esc(r.go.key) + '">' + ICON('check', 's16') + 'Mark as handled</button></div>';
    return inner;
  }
  var E_ALL = { risk: ['#tasks', 'blocks'], overdue: ['#tasks', 'due'], clash: ['#calendar', ''], warn: ['#calendar/warnings', ''], notice: ['#calendar/notices', ''] };
  function E_attnSheet() {
    var att = E_att(), S = state.sheet, staff = state.layout === 'staff', html;
    var at = state.loadedAt ? new Date(state.loadedAt).toISOString() : '';
    var help = att.partial ? 'Some items could not be loaded' : att.phase === 'offline' || att.phase === 'stale' ? (att.phase === 'offline' ? 'No connection' : 'Could not update') + (at ? ' · showing ' + CS.clockLabel(at) : '') : att.phase === 'loading' ? 'Loading' : 'Updated ' + (at ? CS.agoLabel(at) : 'just now');
    html = '<h2 class="ttl" id="cs-h" tabindex="-1">To look at</h2><div class="row-between" style="margin-top:4px"><span class="help">' + esc(help) + '</span>' +
      (att.phase === 'offline' || att.phase === 'stale' || att.partial ? '<button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button>' : '') + '</div>';
    if (att.phase === 'loading') return html + '<div class="skel" style="height:96px;margin-top:12px"></div>';
    if ((att.phase === 'offline' || att.phase === 'stale') && !state.payload) return html + '<div class="errbox" role="alert" style="margin-top:12px">' + ICON('alert') + '<span>' + (att.phase === 'offline' ? 'Live information needs a connection.' : 'Live information could not be updated.') + '</span></div>';
    if (att.empty) return html + '<div class="card glass empty" style="margin-top:12px"><div class="disc">' + ICON('checks') + '</div><h2 class="hd">Nothing to look at</h2><p>' +
      (staff ? 'Your tasks and today’s warnings are clear.' : 'Tasks, bookings, the inbox and warnings are all clear.') + '</p></div>';
    att.sections.forEach(function (sec) {
      html += '<div class="cap up" style="margin:14px 0 6px">' + esc(sec.label) + '</div><div class="card list">' + sec.shown.map(E_rowHtml).join('');
      if (sec.more) { var all = E_ALL[sec.key]; html += '<a class="rowi E_more" href="' + all[0] + '" data-act="' + (all[1] ? 'attn-tasks' : 'sheet-close') + '"' + (all[1] ? ' data-filter="' + all[1] + '"' : '') + '><span class="mid"><span class="t">See all ' + sec.more + '</span></span><span class="chev">' + ICON('chev') + '</span></a>'; }
      html += '</div>';
    });
    return html;
  }
  // A pull on the sheet is the same decision as its Cancel / Close button, so each sheet names its twin; a form with something typed in it never closes on a pull.
  // Close lives in a sticky header on every sheet (44 px, glyph + word, always in view); the bottom of a sheet carries only its own primary action
  // the title moves into the header row (title left, Close right); everything else is the body below it
  function E_sheetPage(S, html) {
    var m = /^<h2 class="ttl"[^>]*>[\s\S]*?<\/h2>/.exec(html), title = m ? m[0] : '';
    var ask = S.confirm ? '<div class="errbox" role="alert" style="margin-bottom:10px"><span>Discard what you typed?</span><span class="row-wrap" style="margin-top:6px"><button class="btn btn-secondary btn-sm" type="button" id="F_keep" data-act="discard-keep">Keep editing</button><button class="btn btn-primary btn-sm" type="button" data-act="' + E_sheetTwin(S.kind) + '">Discard</button></span></div>' : '';
    var day = S.kind === 'day' && state.payload, nav = function (dir, act, label, icon) { return '<button class="iconbtn H_daynav" type="button" data-act="' + act + '" aria-label="' + label + '"' + (CS.H_dayStep(S.key, dir, state.payload.today) ? '' : ' disabled') + '>' + ICON(icon, 's24') + '</button>'; };
    return '<div class="F_sheethead' + (day ? ' H_dayhead' : '') + '">' + (day ? nav(-1, 'day-prev', 'Previous day', 'back') : '') + title + (day ? nav(1, 'day-next', 'Next day', 'chev') : '') + '<button class="btn btn-secondary btn-sm F_close" type="button" data-F-close="1" data-act="' + E_sheetTwin(S.kind) + '">' + ICON('close', 's16') + 'Close</button></div>' + ask + html.slice(title.length);
  }
  function E_sheetTwin(kind) { return kind === 'tour' ? 'tour-skip' : kind === 'add' ? 'task-add-cancel' : kind === 'nadd' ? 'notice-add-cancel' : kind === 'rate' ? 'rate-back' : 'sheet-close'; }
  function E_dirty() {
    var S = state.sheet, a = state.add, b = state.nadd, f = state.rateForm; if (!S) return false;
    if (S.kind === 'add') return !!(a && (String(a.title).trim() || a.due || a.who || String(a.note).trim()));
    if (S.kind === 'nadd') return !!(b && (String(b.title).trim() || b.start || b.hours || String(b.detail).trim()));
    if (S.kind === 'rate') return false; // the confirm sheet restates what was typed on the screen behind it: Escape, the scrim and Close all just close it
    if (S.kind === 'day') { var fld = $('df-label'), live = fld && typeof fld.value === 'string' ? fld.value : ''; return !!(S.formOpen && (String(S.form.label).trim() || String(live).trim())); } // a note being typed on a day
    return false;
  }
  function E_sheetReset(sheet, scrim) { if (sheet && sheet.style) { sheet.style.transition = ''; sheet.style.transform = ''; } if (scrim && scrim.style) scrim.style.opacity = ''; }
  // The announce line (outside every redrawn view): only a refresh the person asked for is read out
  var E_say = false;
  function E_announce() { if (!E_say) return; E_say = false; var l = $('E_attn-live'), a = E_att(); if (l) l.textContent = a.say || ''; }

  // ---------------------------------------------------------------- haptics (E_): CS.E_buzz holds the guards; the choice is a switch on More
  function E_vibe(kind) { return CS.E_buzz(kind, { navigator: navigator, storage: store('localStorage'), doc: document }); }
  function E_canVibrate() { return 'vibrate' in navigator; }
  function E_reduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function E_vw() { return window.innerWidth || 360; }
  function E_netErr(e) { var m = String((e && e.message) || e || ''); return /fetch|network|load failed|offline|abort|request timed? ?out|timeout.{0,12}(?:fetch|request)|(?:fetch|request).{0,12}time ?out/i.test(m) || !!(e && e.status === 0); } // a server statement timeout is not "no connection"
  // F_: a sheet is a bottom sheet only below 600 px (37.5 rem, so a large text size gets the dialog sooner too); wider, it is a centred dialog or a side sheet and closes by its button, Escape or the scrim
  function F_bottomSheet() { try { return !(window.matchMedia && window.matchMedia('(min-width: 37.5rem)').matches); } catch (e) { return true; } }

  // ---------------------------------------------------------------- Tasks (D-301)
  // ONE list from tasks_list_v1: reminders, follow-ups, work orders, cleaning issues and open checks. The server limits it to the role
  // (owner and admin see all, everyone else sees their own, redacted) so this screen only draws it. Tap the box to finish a task; the
  // Undo line stays until the next action. Owner and admin can add a reminder.
  function manager() { return !!(state.tasks && state.tasks.manager); }
  function taskRow(t) {
    var done = t.status === 'done', due = CS.taskDue(t.due_at, state.tasks.today), key = t.source + ':' + t.id;
    var meta = [CS.taskKindLabel(t.kind)];
    if (t.due_at) meta.push(CS.taskDueLabel(t.due_at, state.tasks.today));
    if (!t.mine && manager()) meta.push(t.assignee_label ? 'for ' + t.assignee_label : 'unassigned');
    var flags = (t.mine ? pill('info', 'user', 'Yours') : '') + (t.blocks_arrival && !done ? pill('danger', 'alert', 'Blocks arrival') : '') +
      (CS.taskPriorityLabel(t.priority) && !done ? pill(t.priority === 'urgent' ? 'danger' : 'warn', 'alert', CS.taskPriorityLabel(t.priority)) : '');
    // Swipe left: a green "Done" underlay (an "Undo" one on a finished row). The underlay is a real button too, so the gesture is never the only way;
    // a system check (verifier) row never completes on a swipe: it only opens its "Mark as handled" button.
    var act = done ? 'task-undo' : 'task-done', ver = t.source === 'verifier_findings', uw = ver && !done ? 148 : 96, ul = done ? 'Undo' : ver ? 'Mark as handled' : 'Done';
    return '<div class="E_swipewrap" style="--E-w:' + uw + 'px"><div class="E_under ' + (done ? 'E_undo' : 'E_done') + '"><button class="E_underbtn" type="button" data-act="' + act + '" data-task="' + esc(key) + '" aria-label="' + esc(ul + ': ' + t.title) + '">' + ICON('check', 's24') + esc(ul) + '</button></div>' +
      '<div class="payrow taskrow' + (done ? ' off' : '') + '" data-E-swipe="' + act + '" data-E-verifier="' + (ver ? '1' : '') + '" data-E-w="' + uw + '" data-task="' + esc(key) + '"><button class="chk" type="button" role="checkbox" aria-checked="' + done + '" aria-label="' + esc((done ? 'Done: ' : 'Mark done: ') + t.title) + '" data-act="' + act + '" data-task="' + esc(key) + '">' + ICON('check', 's16') + '</button>' +
      '<div><div class="t"><span' + (done ? ' style="text-decoration:line-through;color:var(--fg-2)"' : '') + '>' + esc(t.title) + '</span></div>' +
      (t.detail ? '<span class="s" style="white-space:pre-line">' + esc(t.detail) + '</span>' : '') +
      '<span class="s' + (due === 'overdue' && !done ? ' c-danger' : '') + '">' + esc(meta.join(' · ')) + '</span>' + (state.H_offKey === key ? '<span class="s c-danger H_noconn" role="status">No connection</span>' : '') +
      (flags ? '<div class="row-wrap" style="margin-top:6px">' + flags + '</div>' : '') + '</div></div></div>';
  }
  function addReminderCard() {
    var a = state.add, opts = '<option value="">Anyone / nobody yet</option>' + (state.assignees || []).map(function (u) { return '<option value="' + esc(u.user_id) + '"' + (a.who === u.user_id ? ' selected' : '') + '>' + esc(u.label + ' (' + u.role + ')') + '</option>'; }).join('');
    return '<h2 class="ttl" id="cs-h" tabindex="-1">Add a reminder</h2><div class="stack" style="margin-top:10px">' +
      '<div class="field"><label for="t-title">What needs doing</label><div class="input"><input id="t-title" maxlength="200" value="' + esc(a.title) + '" autocomplete="off"></div></div>' +
      '<div class="field"><label for="t-due">Due (optional)</label><div class="input"><input id="t-due" type="date" value="' + esc(a.due) + '"></div></div>' +
      '<div class="field"><label for="t-who">For</label><select class="sel" id="t-who" style="max-width:none;text-align:left;text-align-last:left">' + opts + '</select></div>' +
      '<div class="field"><label for="t-note">Note (optional)</label><div class="input"><input id="t-note" maxlength="1000" value="' + esc(a.note) + '" autocomplete="off"></div></div>' +
      (a.err ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(a.err) + '</span></div>' : '') +
      '<div class="row-wrap"><button class="btn btn-primary" type="button" data-act="task-add-save"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Adding…' : 'Add reminder') + '</button><button class="btn btn-ghost" type="button" data-act="task-add-cancel">Cancel</button></div></div>';
  }
  function A_addDraw() { if (state.sheet && state.sheet.kind === 'add') drawSheet(); }
  // Filter chips for the task list: everything, mine, due (overdue or today), blocks the next arrival.
  function A_taskPass(t, f, today) {
    return f === 'mine' ? !!t.mine : f === 'due' ? (CS.taskDue(t.due_at, today) === 'overdue' || CS.taskDue(t.due_at, today) === 'today') : f === 'blocks' ? !!t.blocks_arrival : true;
  }
  function renderTasks() {
    var el = $('v-tasks'), head = appbar({ title: 'Tasks', refresh: true });
    if (!state.tasks) { el.innerHTML = head + '<div class="screen">' + (state.tasksErr ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.tasksErr) + ' <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>' : loadingBlock()) + '</div>'; return; }
    var T = state.tasks, tf = state.taskFilter, open = T.tasks.filter(function (t) { return t.status !== 'done'; });
    var groups = CS.taskGroups(T.tasks.filter(function (t) { return (state.showDone || t.status !== 'done') && A_taskPass(t, tf, T.today); }), T.today), body = '';
    var chips = [['all', 'All'], ['mine', 'Mine'], ['due', 'Due'], ['blocks', 'Blocks arrival']].map(function (x) {
      var n = open.filter(function (t) { return A_taskPass(t, x[0], T.today); }).length;
      return '<button class="chip" type="button" data-tfilter="' + x[0] + '" aria-pressed="' + (x[0] === tf) + '">' + x[1] + ' ' + n + '</button>';
    }).join('');
    body += '<div class="A_chk-row" role="group" aria-label="Filter reminders">' + chips + '</div>';
    if (state.lastDone) body += '<div class="okbox sr" role="status">' + ICON('check') + '<span>' + esc(state.lastDone.done ? 'Marked done: ' : 'Back on the list: ') + esc(state.lastDone.title) +
      (state.lastDone.source === 'verifier_findings' ? '' : ' <button class="btn btn-ghost btn-sm" type="button" data-act="task-' + (state.lastDone.done ? 'undo' : 'done') + '" data-task="' + esc(state.lastDone.source + ':' + state.lastDone.id) + '" tabindex="-1">' + (state.lastDone.done ? 'Undo' : 'Done again') + '</button>') + '</span></div>'; // read out for screen readers; the toast beside the thumb carries the visible Undo
    if (state.tasksErr) body += '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.tasksErr) + '</span></div>';
    if (manager()) body += '<button class="btn btn-secondary" type="button" data-act="task-add-open">' + ICON('plus', 's16') + 'Add a reminder</button>';
    if (!groups.length) body += '<div class="card glass empty"><div class="disc">' + ICON('checks') + '</div><h2 class="hd">Nothing to do</h2><p>' + (manager() ? 'Add a reminder, or wait for a cleaning issue or a check to land here.' : 'Nothing is waiting for you.') + '</p></div>';
    groups.forEach(function (g) { body += '<div><div class="cap up" style="margin-bottom:6px">' + esc(g.label) + ' (' + g.tasks.length + ')</div><div class="card list">' + g.tasks.map(taskRow).join('') + '</div></div>'; });
    body += '<button class="btn btn-ghost" type="button" data-act="tasks-toggle-done" aria-pressed="' + !!state.showDone + '">' + (state.showDone ? 'Hide done' : 'Show done (14 days)') + '</button>';
    el.innerHTML = head + '<div class="screen"><p class="sub" style="margin:0 0 4px">' + (manager() ? 'Everything that needs a person.' : 'What is yours to do.') + '</p><p class="help H_help" style="margin:0 0 12px">Swipe a task left to mark it done. Or tap its box.</p><div class="stack">' + body + '</div></div>';
    H_taskPeek();
  }
  // The first time Tasks opens, the first row peeks 32 px left over 240 ms and shows the Done underlay; never again once a swipe has worked on this phone (cs_swiped).
  function H_taskPeek() {
    if (state.H_peekedTask || current !== 'tasks' || E_reduced()) return;
    var ls = store('localStorage'); try { if (ls && ls.getItem('cs_swiped') === '1') { state.H_peekedTask = true; return; } } catch (e) {}
    var row = document.querySelector('#v-tasks .taskrow[data-E-swipe]'); if (!row || !row.style) return;
    state.H_peekedTask = true; var w = row.parentNode; if (w && w.classList) w.classList.add('E_live');
    E_tr(row, 120); row.style.transform = 'translateX(-32px)';
    setTimeout(function () { E_tr(row, 120); row.style.transform = ''; setTimeout(function () { if (w && w.classList && !w.classList.contains('E_open')) w.classList.remove('E_live'); }, 160); }, 360);
  }
  var H_tasksGen = 0, H_taskQ = {};
  // The writes for one task go out one after the other (done, then Undo), so the server sees them in the order the person tapped.
  function H_serial(key, fn) { var p = (H_taskQ[key] || Promise.resolve()).then(fn, fn); H_taskQ[key] = p.then(null, function () {}); return p; }
  function loadTasks() {
    if (!state.access) return Promise.resolve();
    state.tasksLoading = true; var gen = ++H_tasksGen; // 3.1.1: only the newest read counts. A slow read that started before an Undo must never land after the read that followed it
    return sb.rpc('tasks_list_v1', { p_property_id: pid(), p_include_done: state.showDone }).then(function (r) {
      if (gen !== H_tasksGen) return;
      if (r.error) throw r.error;
      var d = r.data; if (!d || d.ok === false) throw new Error('denied');
      CS.assertNoMoney(d.tasks || []);
      state.tasks = { manager: d.manager === true, today: d.today || CS.manilaToday(), tasks: d.tasks || [] }; state.tasksErr = ''; state.tasksDenied = false;
    }).catch(function (e) {
      if (gen !== H_tasksGen) return;
      state.tasksDenied = !!(e && e.message === 'denied');
      state.tasksErr = e && e.message === 'denied' ? 'Tasks are not available for this account.' : !E_netErr(e) ? (state.tasks ? 'Could not update. Showing the last update.' : 'Could not update.') : state.tasks ? 'Live information needs a connection. Showing the last update.' : 'Live information needs a connection.';
    }).then(function () { if (gen !== H_tasksGen) return; state.tasksLoading = false; if (state.layout && current !== 'door') { if (current === 'tasks') renderTasks(); else if (current === 'home') render('home'); renderTabs(current); } H_offlineSync(); }); // Home too: the pill waits for the tasks
  }
  function findTask(key) {
    var i = key.indexOf(':'), src = key.slice(0, i), id = key.slice(i + 1), list = state.tasks ? state.tasks.tasks : [];
    for (var k = 0; k < list.length; k++) if (list[k].source === src && list[k].id === id) return list[k];
    return null;
  }
  function E_undoAct(t, key, done) { return t.source === 'verifier_findings' ? null : { act: done ? 'task-undo' : 'task-done', task: key, text: done ? 'Undo' : 'Done again', label: (done ? 'Undo: ' : 'Done again: ') + t.title }; }
  function setTaskDone(key, done) {
    var t = findTask(key), L = state.lastDone;
    // The server hides a finished task once the list reloads, so Undo works from the remembered one.
    var restored = false; // 3.1.1: Undo after the reload has landed puts the remembered row back into the list at once, before any write
    if (!t && L && L.source + ':' + L.id === key) t = Object.assign({}, L.task || { source: L.source, id: L.id, title: L.title }, { status: done ? 'open' : 'done' });
    if (!t || t.status === (done ? 'done' : 'open')) return;
    if (navigator.onLine === false) { state.H_offKey = key; E_vibe('error'); if (current === 'tasks') renderTasks(); if (state.sheet && state.sheet.kind === 'attn') drawSheet(); return; } // MF8: no queue; the row says so under itself
    state.H_offKey = '';
    t.status = done ? 'done' : 'open';
    if (!done && state.tasks && !findTask(key)) { var at = L && typeof L.idx === 'number' ? Math.max(0, Math.min(L.idx, state.tasks.tasks.length)) : state.tasks.tasks.length; state.tasks.tasks.splice(at, 0, t); restored = true; }
    state.lastDone = { source: t.source, id: t.id, title: t.title, done: done, task: t, idx: state.tasks ? Math.max(0, state.tasks.tasks.indexOf(t)) : 0 }; state.tasksErr = ''; if (current === 'tasks') renderTasks(); renderTabs(current); if (state.sheet && state.sheet.kind === 'attn') drawSheet();
    E_vibe('tap'); // one buzz for the confirm; the same path whether the box, the underlay button or the swipe asked
    toast(done ? 'Marked done' : 'Back on the list', E_undoAct(t, key, done));
    var call = H_serial(key, function () { return t.source === 'verifier_findings' ? sb.rpc('ack_verifier_finding_v1', { p_key: t.id })
      : sb.rpc('task_set_done_v1', { p_property_id: pid(), p_source: t.source, p_id: t.id, p_done: done }); });
    var msg = '';
    call.then(function (r) { if (r.error) throw r.error; if (DEMO) toast(done ? 'Marked done' : 'Back on the list', E_undoAct(t, key, done), 'Demo: nothing was saved'); }).catch(function (e) { // demo: the real toast stays, the demo note is its sub-line
      t.status = done ? 'open' : 'done'; state.lastDone = null;
      if (restored && state.tasks) { var gone = state.tasks.tasks.indexOf(t); if (gone >= 0) state.tasks.tasks.splice(gone, 1); if (current === 'tasks') renderTasks(); } // the un-done write failed: the row goes out again
      msg = e && (e.code === '42501' || e.code === 'P0002') ? 'That task is not yours to change.' : 'That did not save. Check your signal and try again.'; E_vibe('error');
    }).then(function () { return loadTasks(); }).then(function () { if (msg) { toast(msg); if (current === 'tasks') renderTasks(); } }); // a failed save: the plain error replaces the Undo toast, the row is back
  }
  function openAdd() {
    state.add = { title: '', due: '', who: '', note: '', err: '', busy: false, key: 'rem-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)) };
    if (!state.assignees) sb.rpc('task_assignees_v1', { p_property_id: pid() }).then(function (r) { if (!r.error && r.data && r.data.staff) { state.assignees = r.data.staff; if (state.add) A_addDraw(); } });
    openSheet('add', 'add');
  }
  function saveAdd() {
    var a = state.add; if (!a || a.busy) return;
    var bad = CS.reminderProblem(a.title); if (bad) { a.err = bad; A_addDraw(); return; }
    a.busy = true; a.err = ''; A_addDraw();
    sb.rpc('task_add_reminder_v1', { p_property_id: pid(), p_title: a.title.trim(), p_due_at: CS.dueFromDate(a.due), p_assignee_user_id: a.who || null, p_note: a.note.trim() || null, p_idempotency_key: a.key }).then(function (r) {
      if (r.error) throw r.error;
      state.add = null; state.lastDone = null; closeSheet(); E_vibe('tap'); return loadTasks();
    }).catch(function (e) {
      a.busy = false; E_vibe('error'); a.err = e && e.code === '42501' ? 'Only the owner and admins can add reminders.' : e && e.code === '22023' && e.message ? e.message : 'That did not save. Check your signal and try again.'; A_addDraw();
    });
  }

  // ---------------------------------------------------------------- Pay rates (D-301, owner and admin)
  // One source: cleaner_rate_schedule. The staff app and payment requests read the row in force on the clean's date. This screen only
  // ADDS a dated row (admin_add_pay_rate_v1: append-only, audited); history is never changed.
  function renderPayRates() {
    var el = $('v-payrates'), head = appbar({ title: 'Pay rates', back: '#home', refresh: true });
    if (!state.rates) { el.innerHTML = head + '<div class="screen">' + (state.ratesErr ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.ratesErr) + ' <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>' : loadingBlock()) + '</div>'; return; }
    var R = state.rates, f = state.rateForm, earliest = CS.earliestRateStart(R.history, R.today), cur = R.in_force;
    var fld = function (id, label, val, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><div class="input"><input id="' + id + '" value="' + esc(val) + '" ' + (extra || '') + '></div></div>'; };
    el.innerHTML = head + '<div class="screen"><p class="sub" style="margin:0 0 12px">The staff app and payment requests use these rates. A request reads the rate in force on the date of the clean.</p><div class="stack">' +
      '<div class="card"><span class="cap up">In force today</span>' + (cur ? '<p class="strong num" style="margin:8px 0 0">' + esc(CS.rateLine(cur, P.peso)) + '</p><p class="help" style="margin:4px 0 0">Since ' + esc(CS.dayLabel(cur.effective_from) + ' ' + cur.effective_from.slice(0, 4)) + (cur.note ? ' · ' + esc(cur.note) : '') + '</p>' : '<p class="sub" style="margin-top:8px">No rate is in force today. Add one below.</p>') +
      (R.next ? '<p class="sub num" style="margin:10px 0 0">' + pill('info', 'clock', 'Scheduled') + ' ' + esc(CS.rateLine(R.next, P.peso)) + ' · starts ' + esc(CS.dayLabel(R.next.effective_from)) + '</p>' : '') + '</div>' +
      '<div class="card"><h2 class="hd">Add a new rate</h2><p class="help" style="margin:4px 0 10px">It starts on the date you pick. Earlier dates keep their rate; nothing is overwritten.</p><div class="stack">' +
      fld('r-from', 'Starts on', f.from, 'type="date" min="' + esc(earliest) + '"') +
      fld('r-regular', 'Per clean (PHP)', f.regular, 'inputmode="decimal" placeholder="' + esc(cur && cur.regular_rate != null ? cur.regular_rate : '') + '"') +
      fld('r-general', 'Per deep clean (PHP)', f.general, 'inputmode="decimal" placeholder="' + esc(cur && cur.general_rate != null ? cur.general_rate : '') + '"') +
      fld('r-transport', 'Transport (PHP, empty if included)', f.transport, 'inputmode="decimal" placeholder="included"') +
      fld('r-note', 'Why (kept in the audit history)', f.note, 'maxlength="500" autocomplete="off"') +
      '<div class="errbox" id="r-problem" role="alert" hidden></div>' +
      '<button class="btn btn-primary" type="button" data-act="rate-save" disabled>' + (state.rateSaving ? 'Saving…' : 'Add rate') + '</button><p class="help" style="margin:0;text-align:center">You will confirm before it saves.</p></div></div>' +
      '<div><div class="cap up" style="margin-bottom:6px">History</div><div class="card list">' + (R.history || []).slice(0, state.ratesMore ? undefined : 1).map(function (h) {
        return '<div class="rowi" style="cursor:default"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t num">' + esc(CS.dayLabel(h.effective_from) + ' ' + h.effective_from.slice(0, 4)) + '</span><span class="s num">' + esc(CS.rateLine(h, P.peso)) + (h.note ? ' · ' + esc(h.note) : '') + '</span></span></div>';
      }).join('') + '</div>' + ((R.history || []).length > 1 ? '<button class="btn btn-ghost" type="button" data-act="rates-more" aria-expanded="' + !!state.ratesMore + '" style="margin-top:6px">' + (state.ratesMore ? 'Hide earlier rates' : 'Show ' + CS.plural((R.history || []).length - 1, 'earlier rate')) + ICON(state.ratesMore ? 'back' : 'chevdown', 's16') + '</button>' : '') + '</div></div></div>';
    syncRate();
  }
  // The save button and the one-line reason follow the typed values without redrawing the form (a redraw would drop the keyboard).
  function syncRate() {
    var f = state.rateForm, R = state.rates; if (!f || !R) return;
    var bad = CS.rateProblem(f, CS.earliestRateStart(R.history, R.today), R.today), typed = !!(f.regular || f.general || f.transport || f.note), msg = f.err || (typed ? bad : '');
    var box = $('r-problem'); if (box) { box.hidden = !msg; box.innerHTML = msg ? ICON('alert') + '<span>' + esc(msg) + '</span>' : ''; }
    var b = document.querySelector('#v-payrates [data-act="rate-save"]'); if (b) b.disabled = !!bad || state.rateSaving;
  }
  function loadRates() {
    if (!state.access || !CS.canEditRates(state.access.role)) return Promise.resolve();
    return sb.rpc('admin_pay_rates_v1', { p_property_id: pid() }).then(function (r) {
      if (r.error) throw r.error;
      var d = r.data; if (!d || d.ok === false) throw new Error('denied');
      state.rates = d; state.ratesErr = '';
      if (!state.rateForm) state.rateForm = { from: CS.earliestRateStart(d.history, d.today), regular: '', general: '', transport: '', note: '', err: '', };
      else if (state.rateForm.from < CS.earliestRateStart(d.history, d.today)) state.rateForm.from = CS.earliestRateStart(d.history, d.today);
    }).catch(function (e) {
      state.ratesErr = e && (e.code === '42501' || e.message === 'denied') ? 'Only the owner and admins can see pay rates.' : CS.rpcMissing(e) ? 'Pay rates are available after the next update.' : 'Live information needs a connection.';
    }).then(function () { if (current === 'payrates') renderPayRates(); });
  }
  // Add rate: the button validates and opens a sheet that restates the rate, who it applies to and the start date. Only "Save rate" there sends anything.
  function A_rateOpen() {
    var f = state.rateForm, R = state.rates; if (!f || !R || state.rateSaving || !CS.canEditRates(role())) return;
    if (CS.rateProblem(f, CS.earliestRateStart(R.history, R.today), R.today)) { syncRate(); return; }
    openSheet('rate', 'rate-save');
  }
  function A_rateConfirm() {
    var a = CS.rateArgs(pid(), state.rateForm), row = { regular_rate: a.p_regular, general_rate: a.p_general, transport_rate: a.p_transport };
    return '<h2 class="ttl" id="cs-h" tabindex="-1">Save this rate?</h2><p class="strong num" style="margin:10px 0 0">' + esc(CS.rateLine(row, P.peso)) + '</p>' +
      '<p class="sub" style="margin:6px 0 0">Applies to every cleaner, for cleans on or after ' + esc(CS.dayLabel(a.p_effective_from) + ' ' + a.p_effective_from.slice(0, 4)) + '. Earlier dates keep their rate; nothing is overwritten.</p>' + (a.p_note ? '<p class="help" style="margin:6px 0 0">' + esc(a.p_note) + '</p>' : '') +
      '<div class="stack" style="margin-top:14px"><button class="btn btn-primary btn-block" type="button" data-act="rate-confirm">Save rate</button><button class="btn btn-ghost btn-block" type="button" data-act="rate-back">Go back</button></div>';
  }
  function saveRate() {
    var f = state.rateForm, R = state.rates; if (!f || !R || state.rateSaving || !CS.canEditRates(role())) return;
    closeSheet();
    if (CS.rateProblem(f, CS.earliestRateStart(R.history, R.today), R.today)) { syncRate(); return; }
    state.rateSaving = true; f.err = ''; syncRate();
    sb.rpc('admin_add_pay_rate_v1', CS.rateArgs(pid(), f)).then(function (r) {
      if (r.error) throw r.error;
      state.rateForm = null; state.rateSaving = false; E_vibe('tap'); return loadRates();
    }).catch(function (e) {
      state.rateSaving = false; E_vibe('error'); f.err = CS.rpcMissing(e) ? 'Available after the next update.' : e && e.code === '42501' ? 'Only the owner and admins can change pay rates.' : e && e.code === '22023' && e.message ? e.message : 'That did not save. Check your signal and try again.'; syncRate();
    });
  }

  // ---------------------------------------------------------------- Cassy reply (s76, owner and admin)
  // The guest's message (typed, or a screenshot shrunk here to a JPEG) goes to guest-reply-draft with the user's own session token; the
  // function re-checks the role. What the guest sent and the drafts live in memory for the open session only, never in storage.
  // #v-reply holds a persistent live region (#rp-live) and the redrawn body (#rp-body): announcements survive every redraw.
  var RP_NAME = { messenger: 'Messenger', airbnb: 'Airbnb' };
  function newReply() { return { step: 'pick', mode: 'text', text: '', name: '', platform: 'messenger', image: null, imageName: '', shrinking: false, busy: false, err: '', signout: false, result: null, copied: -1 }; }
  function rpErr(R) {
    return R.err ? '<div class="errbox" id="rp-err" role="alert" tabindex="-1">' + ICON('alert') + '<span>' + esc(R.err) + (R.signout ? ' <button class="btn btn-ghost btn-sm" type="button" data-act="signout">Sign out</button>' : '') + '</span></div>' : '';
  }
  function rpLive(msg) { var l = $('rp-live'); if (l) l.textContent = msg || ''; }
  function rpFocus(id) { var f = $(id); if (f && f.focus) f.focus(); }
  function rpPlatform(R) {
    return '<div class="field"><span class="lbl" id="rp-pl">Where did the guest write?</span><div class="seg" role="group" aria-labelledby="rp-pl">' +
      ['messenger', 'airbnb'].map(function (p) { return '<button class="btn btn-secondary" type="button" data-act="reply-platform" data-platform="' + p + '" aria-pressed="' + (R.platform === p) + '">' + RP_NAME[p] + '</button>'; }).join('') + '</div></div>';
  }
  // focus: 'heading' (the new screen's heading), 'error' (the error message), or nothing (the user is mid-typing).
  function renderReply(focus) {
    var el = $('rp-body'), R = state.reply || (state.reply = newReply()), head = appbar({ title: 'Cassy reply', back: '#home' }), body;
    if (R.step === 'done' && R.result && !R.busy) {
      var X = R.result, who = (X.guestName ? X.guestName + ' · ' : '') + RP_NAME[X.platform];
      body = rpErr(R) + '<div class="card"><h2 class="cap up" id="rp-h" tabindex="-1">Replying to · ' + esc(who) + '</h2><p class="rp-quote">' + esc(CS.clampText(X.guestText, 280)) + '</p></div>' +
        (X.header ? '<p class="sub" style="margin:0">' + esc(X.header) + '</p>' : '') +
        X.options.map(function (o, i) {
          return '<div class="card H_draft"><span class="cap up">' + esc(o.label || (X.options.length > 1 ? 'Reply ' + (i + 1) : 'Reply')) + '</span><p class="rp-reply">' + esc(o.text) + '</p>' +
            '<button class="btn btn-primary btn-block" type="button" data-act="reply-copy" data-i="' + i + '" style="margin-top:12px">' + (R.copied === i ? ICON('check', 's16') + 'Copied' : 'Copy') + '</button></div>';
        }).join('') +
        (X.platform === 'messenger' ? ext(CS.MESSENGER_INBOX, ICON('chat', 's16') + 'Open Messenger inbox', 'btn btn-secondary btn-block', R.copied >= 0 ? ' id="rp-inbox"' : ' id="rp-inbox" hidden') : '') +
        '<button class="btn btn-secondary btn-block" type="button" data-act="reply-reset">Start over</button>';
    } else if (R.step === 'pick' && !R.busy) {
      body = '<h2 class="dlg" id="rp-h" tabindex="-1">What did the guest send?</h2><div class="rp-pick">' +
        '<button class="btn btn-secondary rp-big" type="button" data-act="reply-mode" data-mode="text">' + ICON('chat', 's24') + 'Text</button>' +
        '<button class="btn btn-secondary rp-big" type="button" data-act="reply-mode" data-mode="image">' + ICON('image', 's24') + 'Screenshot</button></div>' +
        '<p class="help" style="margin:0">Cassy writes the drafts in her own voice. You copy one and send it yourself.</p>' +
        '<section class="card glass H_how" aria-label="How it goes"><h2 class="hd">How it goes</h2><ol class="H_steps"><li>Paste, or screenshot, the guest’s message.</li><li>Pick a draft.</li><li>Copy it, then paste it in Messenger.</li></ol></section>' +
        '<section class="card glass" aria-label="Common links"><h2 class="hd">Common links</h2><div class="stack" style="margin-top:8px">' + CS.COMMON_LINKS.map(function (l) {
          return '<div class="H_recent"><p class="sub" style="margin:0"><b>' + esc(l.label) + '</b><br><span class="num">' + esc(l.url.replace(/^https:\/\//, '')) + '</span></p><button class="btn btn-ghost btn-sm" type="button" data-act="copy" data-copy="' + esc(l.url) + '" aria-label="' + esc('Copy ' + l.label + ' link') + '">Copy</button></div>';
        }).join('') + '</div><p class="help" style="margin:8px 0 0">Copy a link, then paste it into your reply.</p></section>' +
        ((state.replyRecent || []).length ? '<section class="card glass" aria-label="Recent drafts"><h2 class="hd">Recent</h2><div class="stack" style="margin-top:8px">' + state.replyRecent.map(function (r, i) {
          return '<div class="H_recent"><p class="sub" style="margin:0"><b>' + esc(r.who) + '</b> · ' + esc(CS.clampText(r.text, 90)) + '</p><button class="btn btn-ghost btn-sm" type="button" data-act="reply-copy-recent" data-i="' + i + '">Copy</button></div>';
        }).join('') + '</div><p class="help" style="margin:8px 0 0">Kept on this screen only, until you leave the app.</p></section>' : '');
    } else {
      var shot = R.mode === 'image';
      body = (R.busy ? H_waitCard(R) : '') + rpErr(R) +
        (shot ? '<div class="field"><span class="lbl">Screenshot of the guest’s message</span><label class="btn btn-secondary btn-block rp-file">' + ICON('image', 's16') + (R.image ? 'Choose another' : 'Choose a screenshot') +
            '<input class="sr" id="rp-file" type="file" accept="image/*"' + (R.busy ? ' disabled' : '') + '></label>' + (R.shrinking ? '<p class="help" role="status" style="margin:0">Preparing the screenshot…</p>' : R.image ? '<div class="okbox">' + ICON('check') + '<span>Ready: ' + esc(R.imageName || 'screenshot') + '</span></div>' : '') + (R.busy && R.image ? '<img class="H_thumb" alt="The screenshot Cassy is reading" src="data:' + esc(R.image.mime) + ';base64,' + esc(R.image.base64) + '">' : '') + '</div>'
          : '<div class="field"><label for="rp-text">What the guest sent</label><textarea class="ta" id="rp-text" rows="7" maxlength="4000"' + (R.busy ? ' disabled' : '') + ' placeholder="Paste the guest’s message here">' + esc(R.text) + '</textarea></div>') +
        '<div class="field"><label for="rp-name">Guest name (optional)</label><div class="input"><input id="rp-name" maxlength="80" value="' + esc(R.name) + '" autocomplete="off"' + (R.busy ? ' disabled' : '') + '></div></div>' +
        rpPlatform(R) +
        '<button class="btn btn-primary btn-block" type="button" data-act="reply-send"' + (R.shrinking || R.busy ? ' disabled' : '') + '>' + (R.busy ? 'Writing…' : 'Write the reply') + '</button>' +
        (R.busy ? '' : '<button class="btn btn-ghost btn-block" type="button" data-act="reply-back">Back</button>');
    }
    el.innerHTML = head + '<div class="screen"><div class="stack">' + body + '</div></div>';
    if (focus === 'error') rpFocus('rp-err'); else if (focus === 'heading') rpFocus('rp-h');
  }
  // 3.1.1: while Cassy writes, a calm honest wait: the step advances on a timer, a bar that only moves if motion is allowed, the usual time, and Cancel.
  var H_rpSeq = 0, H_rpT = 0;
  function H_waitCard(R) {
    return '<div class="card glass H_wait" role="status"><h2 class="hd" id="rp-h" tabindex="-1">Cassy is writing</h2><p class="sub" id="rp-step" style="margin:6px 0 0">' + esc(CS.H_waitStep(Math.floor((Date.now() - (R.t0 || Date.now())) / 1000))) + '</p>' +
      '<div class="H_bar" aria-hidden="true"><i></i></div><p class="help" style="margin:8px 0 0">Usually 10 to 20 seconds. Please keep this screen open.</p><button class="btn btn-secondary" type="button" data-act="reply-cancel">Cancel</button></div>';
  }
  function H_rpTick(R) {
    clearTimeout(H_rpT); if (!R.busy || state.reply !== R) return;
    var el = $('rp-step'); if (el) el.textContent = CS.H_waitStep(Math.floor((Date.now() - R.t0) / 1000));
    H_rpT = setTimeout(function () { H_rpTick(R); }, 1000);
  }
  function readBlobAsBase64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader(); fr.onload = function () { res(String(fr.result).replace(/^data:[^,]*,/, '')); }; fr.onerror = function () { rej(new Error('read')); }; fr.readAsDataURL(blob);
    });
  }
  // The longest edge is capped at 1600 px and the picture re-encoded as a JPEG (quality .82): a phone screenshot becomes a few hundred KB.
  // JPEG has no alpha, so the canvas is filled white first: a transparent PNG must not turn black.
  function shrinkShot(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); res(img); }; img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); }; img.src = u;
    }).then(function (img) {
      var z = CS.shrinkSize(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'), cx; cv.width = z.w; cv.height = z.h;
      cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, z.w, z.h); cx.drawImage(img, 0, 0, z.w, z.h);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', 0.82); });
    }).then(function (blob) {
      if (blob.size > CS.REPLY_MAX_IMAGE_BYTES) throw new Error('large');
      return readBlobAsBase64(blob).then(function (b64) { return { base64: b64, mime: 'image/jpeg' }; });
    });
  }
  function pickShot(file) {
    var R = state.reply; if (!R || !file) return;
    R.err = ''; R.signout = false; R.image = null; R.imageName = ''; R.shrinking = true; renderReply(); rpLive('Preparing the screenshot');
    var failed = false;
    shrinkShot(file).then(function (img) { R.image = img; R.imageName = file.name || 'screenshot'; }).catch(function (e) {
      failed = true; R.err = CS.replyErrorText(0, e && e.message === 'large' ? 'image_too_large' : 'bad_image');
    }).then(function () {
      R.shrinking = false; if (current === 'reply' && state.reply === R) { renderReply(failed ? 'error' : ''); rpLive(failed ? '' : 'Screenshot ready'); }
    });
  }
  function sendReply() {
    var R = state.reply; if (!R || R.busy || R.shrinking) return;
    var bad = CS.replyProblem({ mode: R.mode, text: R.text, image: R.image });
    if (bad) { R.err = bad; R.signout = false; renderReply('error'); return; }
    var myId = ++H_rpSeq; R.reqId = myId; R.ctl = typeof AbortController === 'function' ? new AbortController() : null; R.t0 = Date.now(); R.busy = true; R.err = ''; R.signout = false; renderReply('heading'); rpLive('Cassy is writing'); window.scrollTo(0, 0); H_rpTick(R);
    var body = JSON.stringify(CS.replyBody({ mode: R.mode, text: R.text, image: R.image, guestName: R.name, platform: R.platform }));
    sb.auth.getSession().then(function (s) {
      var token = s.data && s.data.session && s.data.session.access_token; if (!token) return { status: 401, j: null };
      return net(CFG.url + '/functions/v1/guest-reply-draft', { signal: R.ctl ? R.ctl.signal : undefined, method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'application/json' }, body: body })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, j: j }; }); });
    }).catch(function () { return { status: 0, j: null }; }).then(function (o) {
      if (state.reply !== R || R.reqId !== myId) return; // signed out meanwhile, or the wait was cancelled: a late answer is ignored
      R.busy = false; clearTimeout(H_rpT);
      var X = o.status === 200 ? CS.replyResult(o.j) : null;
      if (X) { R.result = X; R.step = 'done'; R.copied = -1; R.err = ''; R.signout = false; state.replyRecent = [{ who: (X.guestName ? X.guestName + ' · ' : '') + RP_NAME[X.platform], text: X.options[0].text }].concat(state.replyRecent || []).slice(0, 3); }
      else { R.err = CS.replyErrorText(o.status === 200 ? 502 : o.status, o.j && o.j.error); R.signout = o.status === 401; if (o.status === 401 || o.status === 403) E_vibe('error'); }
      if (current === 'reply') { renderReply(X ? 'heading' : 'error'); rpLive(X ? 'The replies are ready' : ''); window.scrollTo(0, 0); }
    });
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).catch(function () { return copyFallback(t); });
    return copyFallback(t);
  }
  function copyFallback(t) {
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); ok ? res() : rej(new Error('copy'));
    });
  }
  var copyTimer = 0;
  // The button is changed in place (no redraw), so keyboard focus stays on it.
  function copyBtn(i) { return document.querySelector('#v-reply [data-act="reply-copy"][data-i="' + i + '"]'); }
  function copyReply(i) {
    var R = state.reply, t = R && R.result && R.result.replies[i]; if (t == null) return;
    copyText(t).then(function () {
      var b = copyBtn(i); R.copied = i; R.err = ''; if (b) b.innerHTML = ICON('check', 's16') + 'Copied'; rpLive('Copied'); var ib = $('rp-inbox'); if (ib) ib.hidden = false;
      clearTimeout(copyTimer); copyTimer = setTimeout(function () { if (R.copied === i) { R.copied = -1; var b2 = copyBtn(i); if (b2) b2.textContent = 'Copy'; rpLive(''); } }, 2000);
    }).catch(function () { R.err = 'Copy did not work on this phone. Press and hold the text to copy it.'; R.signout = false; if (current === 'reply') renderReply('error'); });
  }

  // ---------------------------------------------------------------- More
  // 3.1.1: every group on More has the same gold caps label and the same card; the groups are dealt into two independent column stacks (one stack under 600 px),
  // split where the two columns come out about the same height, so nothing sits beside a hole. DOM order is reading order: Search, How we do things, Cassy, Admin, Appearance, Help, This phone, then You.
  function H_moreGroups() {
    var theme = window.CSTheme.get(), plain = window.CSTheme.plainOn(), admin = state.layout !== 'staff';
    var chip = function (v, t) { return '<button class="chip" type="button" role="radio" data-theme="' + v + '" aria-checked="' + (theme === v) + '" aria-pressed="' + (theme === v) + '">' + t + '</button>'; };
    var g = [];
    g.push({ w: 2, id: 'search', html: A_navCard('Search', row({ icon: 'search', title: 'Search', sub: CS.canSeeGuestContact(role()) ? 'Tasks, guests and the manual' : 'Tasks and the manual', href: '#search' })) });
    g.push({ w: 5, id: 'how', html: A_navCard('How we do things', row({ icon: 'book', title: 'Cascade Manual', sub: 'How we do things', door: 'manual' }) + doorRow('guide', 'book', 'How the staff app and the house work') + row({ icon: 'help', title: 'Quick guide', sub: 'How to use Cassy in Telegram', href: LINKS.quick }) + doorRow('adminguide', 'lock', 'Owner and admin chapters')) });
    g.push({ w: 4, id: 'cassy', html: A_navCard('Cassy', (canReply() ? row({ icon: 'sparkles', title: 'Cassy reply', sub: 'Draft a warm reply to a guest message', href: '#reply' }) : '') +
      row({ icon: 'chat', title: 'Cassy · Telegram OPS', sub: 'Open in Telegram', tg: LINKS.tgOps, external: true }) + H_cassyGpt() + (admin ? row({ icon: 'wallet', title: 'Cassy · Telegram Finance', sub: 'Open in Telegram', tg: LINKS.tgFinance, external: true }) : '')) });
    if (admin) g.push({ w: 4, id: 'admin', html: A_navCard('Admin', row({ icon: 'dash', title: 'Admin hub', sub: 'Every dashboard page, in one list', href: '#hub' }) + (CS.canEditRates(role()) ? row({ icon: 'cash', title: 'Pay rates', sub: 'What a clean and its transport pay', href: '#payrates' }) : '') + row({ icon: 'box', title: 'Inventory', sub: 'Stock levels and usage', href: '#stock' })) });
    g.push({ w: 6, id: 'appearance', html: '<div class="F_group"><div class="A_label">Appearance</div><section class="card glass" aria-label="Appearance"><div class="row-wrap" role="radiogroup" aria-label="Theme">' + chip('auto', 'Automatic') + chip('light', 'Light') + chip('dark', 'Dark') + '</div>' +
      '<div class="A_switch" style="margin-top:10px"><span id="plain-label"><b>Plain bars</b> (no glass)</span><button class="sw" type="button" role="switch" data-act="plain" aria-checked="' + plain + '" aria-labelledby="plain-label"><i></i></button></div>' +
      '<p class="help" style="margin:4px 0 0">On by itself on slower phones. Easier to read in the sun.</p>' +
      (E_canVibrate() ? '<div class="A_switch" style="margin-top:10px"><span id="hap-label"><b>Vibrate on confirm</b></span><button class="sw" type="button" role="switch" data-act="haptics" aria-checked="' + CS.E_hapticsOn(store('localStorage')) + '" aria-labelledby="hap-label"><i></i></button></div>' +
        '<p class="help" style="margin:4px 0 0">A short buzz when something is saved or finished. Off saves nothing but the buzz.</p>' : '') + '</section></div>' });
    g.push({ w: 3, id: 'help', html: '<div class="F_group"><div class="A_label">Help</div><nav class="card glass list" aria-label="Help"><button class="rowi" type="button" data-act="whatsnew"><span class="lead">' + ICON('sparkles') + '</span><span class="mid"><span class="t">What’s new</span><span class="s">What changed in this version</span></span><span class="chev">' + ICON('chev') + '</span></button>' +
      '<button class="rowi" type="button" data-act="tour-open"><span class="lead">' + ICON('help') + '</span><span class="mid"><span class="t">Show the tour</span><span class="s">Three short cards on how the app works</span></span><span class="chev">' + ICON('chev') + '</span></button></nav></div>' });
    g.push({ w: 3, id: 'phone', html: '<div class="F_group"><div class="A_label">This phone</div>' + H_alertsSwitch() + '<section class="card glass" id="install-card" hidden aria-label="Install the app"><h2 class="hd">Install the app</h2><p class="sub" style="margin-top:6px">Put Cascade Staff on your Home Screen.</p><button class="btn btn-secondary" id="install-btn" type="button" style="margin-top:10px">' + ICON('plus', 's16') + 'Install</button>' +
      '<a class="btn btn-secondary" id="install-link" href="./install/" style="margin-top:10px" hidden>' + ICON('plus', 's16') + 'How to install</a></section></div>' });
    return g;
  }
  // the split that leaves the two stacks closest in height (weights are rows and cards, not pixels)
  function H_moreSplit(groups) {
    var total = groups.reduce(function (a, x) { return a + x.w; }, 0), best = 1, bestD = 1e9, run = 0;
    groups.forEach(function (x, i) { run += x.w; var d = Math.abs(total - 2 * run); if (i < groups.length - 1 && d < bestD) { bestD = d; best = i + 1; } });
    return best;
  }
  // In a browser the split is refined by what the groups really measure: every group goes into the first stack, is measured at the column width, and the order and the split that
  // leave the two stacks closest in height are used (all the orders read sensibly in one column too). Under 600 px the stacks follow each other, so nothing is moved.
  var H_MORE_ORDERS = [['search', 'how', 'cassy', 'admin', 'appearance', 'help', 'phone'], ['search', 'how', 'appearance', 'cassy', 'admin', 'help', 'phone'], ['search', 'appearance', 'how', 'cassy', 'admin', 'help', 'phone'], ['search', 'how', 'cassy', 'appearance', 'admin', 'help', 'phone']];
  function H_moreBalance() {
    var root = $('v-more'), cols = root && root.querySelectorAll ? root.querySelectorAll('.H_col') : []; if (cols.length !== 2 || F_bottomSheet()) return;
    var A = cols[0], B = cols[1], all = Array.prototype.slice.call(A.children).concat(Array.prototype.slice.call(B.children)), by = {}; all.forEach(function (g) { by[g.getAttribute('data-g')] = g; A.appendChild(g); });
    var h = {}, gap = 16; Object.keys(by).forEach(function (k) { h[k] = by[k].getBoundingClientRect().height; });
    var best = null;
    H_MORE_ORDERS.forEach(function (o, oi) {
      var ids = o.filter(function (k) { return by[k]; });
      for (var k = 1; k < ids.length; k++) {
        var side = function (list) { var v = list.filter(function (x) { return h[x] > 0; }); return v.reduce(function (a, x) { return a + h[x]; }, 0) + gap * Math.max(0, v.length - 1); };
        var d = Math.abs(side(ids.slice(0, k)) - side(ids.slice(k))); if (!best || d < best.d - 1) best = { d: d, ids: ids, k: k };
      }
    });
    if (best) best.ids.forEach(function (id, i) { (i < best.k ? A : B).appendChild(by[id]); });
  }
  window.addEventListener('resize', function () { if (current === 'more' && state.layout && !state.sheet) renderMore(); });
  function renderMore() {
    H_alStatus();
    var nm = state.name || 'You', roleName = state.access ? state.access.role : '', g = H_moreGroups(), k = H_moreSplit(g), col = function (a) { return '<div class="H_col">' + a.map(function (x) { return '<div class="H_g" data-g="' + x.id + '">' + x.html + '</div>'; }).join('') + '</div>'; };
    $('v-more').innerHTML = appbar({ title: 'More' }) + '<div class="screen"><div class="stack H_more">' +
      '<div class="H_cols">' + col(g.slice(0, k)) + col(g.slice(k)) + '</div>' +
      '<div class="F_group H_you"><div class="A_label">You</div><div class="card glass A_prof"><span class="av" aria-hidden="true">' + esc(CS.initialOf(nm)) + '</span><div class="mid"><span class="t">' + esc(nm) + '</span><span class="s">' + esc(roleName) + (trustOn ? ' · This phone is trusted' : '') + '</span></div>' +
        '<button class="btn btn-ghost E_signout" type="button" data-act="signout">' + ICON('logout', 's16') + 'Sign out</button>' +
        '<p class="help E_signhelp">Signs you out of the admin dashboard as well, on this phone.</p></div></div>' +
      '</div>' +
      '<div class="help" style="text-align:center;margin-top:16px">Cascade Staff v' + CFG.version + '</div></div>';
    syncInstall(); H_moreBalance();
  }
  // ---------------------------------------------------------------- Search (MF5): tasks and the manual for staff; guests too for owner and admin
  function H_manualLoad() {
    if (state.manualProbed) return; state.manualProbed = true; state.manualIdx = null;
    net('./manual/index.json', { cache: 'no-store' }).then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
      var idx = j ? CS.H_manualIndex(j) : []; state.manualIdx = idx.length ? idx : null; if (current === 'search') H_searchDraw();
    });
  }
  function renderSearch() {
    var mgr = CS.canSeeGuestContact(role());
    $('v-search').innerHTML = appbar({ title: 'Search', back: '#more' }) + '<div class="screen"><div class="stack"><div class="field"><label for="sr-q">' + (mgr ? 'Find a task, a guest or a manual page' : 'Find a task or a manual page') + '</label><div class="input"><input id="sr-q" type="search" autocomplete="off" maxlength="60" value="' + esc(state.H_q || '') + '"></div></div><div id="sr-res" aria-live="polite"></div></div></div>';
    H_manualLoad(); H_searchDraw();
  }
  function H_searchDraw() {
    var box = $('sr-res'); if (!box) return;
    var q = state.H_q || '', today = state.payload ? state.payload.today : CS.manilaToday();
    var R = CS.H_search(q, { tasks: state.tasks ? state.tasks.tasks : [], stays: state.payload ? staysOf() : [], manual: state.manualIdx || [] }, role()), html = '';
    var grp = function (label, rows) { return rows ? '<div><div class="cap up" style="margin-bottom:6px">' + esc(label) + '</div><div class="card glass list">' + rows + '</div></div>' : ''; };
    html += grp('Tasks', R.tasks.map(function (t) { return row({ icon: 'tasks', title: t.title, sub: t.due_at ? CS.taskDueLabel(t.due_at, state.tasks.today) : CS.taskKindLabel(t.kind), href: '#tasks' }); }).join(''));
    html += grp('Guests', R.guests.map(function (g) {
      var day = g.checkin_date >= today ? g.checkin_date : g.checkout_date >= today ? g.checkout_date : today;
      return '<button class="rowi" type="button" data-act="notice-cal" data-date="' + esc(day) + '"><span class="lead">' + ICON('user') + '</span><span class="mid"><span class="t">' + esc(g.guest_name || 'Guest') + '</span><span class="s num">' + esc(CS.stayDates(g)) + '</span></span><span class="chev">' + ICON('chev') + '</span></button>';
    }).join(''));
    html += grp('Manual', R.manual.map(function (m) { return row({ icon: 'book', title: m.title, sub: 'Open in the manual', href: '#door/manual/' + m.id }); }).join(''));
    if (q.trim().length < 2) html = '<p class="help" style="margin:0">Type two letters or more.</p>';
    else if (!html) html = '<p class="sub" style="margin:0">No match. Try a shorter word.</p>';
    box.innerHTML = html;
  }

  // ---------------------------------------------------------------- Modules (s82): weather, stock and manage are separate folders, loaded the first time their route opens
  var H_MODULES = {
    weather: { src: 'weather/W_weather.js', css: 'weather/W_weather.css', global: 'W_Weather', title: 'Weather', roles: null },
    stock:   { src: 'stock/I_stock.js',     css: 'stock/I_stock.css',     global: 'I_Stock',   title: 'Inventory', roles: ['owner', 'admin', 'cleaner', 'finance'] },
    manage:  { src: 'manage/N_manage.js',   css: 'manage/N_manage.css',   global: 'N_Manage',  title: 'Manage', roles: ['owner', 'admin'],
               deps: [{ src: 'manage/N_charts.js', css: 'manage/N_charts.css', global: 'N_CHARTS' }, { src: 'manage/N_bookings.js', css: 'manage/N_bookings.css', global: 'N_BOOKINGS' }, { src: 'manage/N_ops.js', css: 'manage/N_ops.css', global: 'N_OPS' }] }, // s89: the KPI charts and the Bookings / Ops tabs load with Manage
    guests:  { src: 'guests/G_guests.js',   css: 'guests/G_guests.css',   global: 'G_Guests',  title: 'Guests', roles: ['owner', 'admin'] },
    inbox:   { src: 'inbox/X_inbox.js',     css: 'inbox/X_inbox.css',     global: 'X_Inbox',   title: 'Inbox', roles: ['owner', 'admin'] }
  };
  var H_mod = { mounted: '', sub: '', n: 0, p: {} }, H_sub = '';
  function H_domLoad(m) { // a stylesheet (never waited for) and a script; a 404 on the script rejects
    return new Promise(function (res, rej) {
      var l = null; if (m.css) { l = document.createElement('link'); l.rel = 'stylesheet'; l.href = m.css; document.head.appendChild(l); }
      var sc = document.createElement('script'); sc.src = m.src; sc.onload = function () { res(); };
      sc.onerror = function () { [sc, l].forEach(function (t) { try { if (t && t.parentNode) t.parentNode.removeChild(t); } catch (e) {} }); rej(new Error('load')); }; // the next open starts clean
      document.head.appendChild(sc);
    });
  }
  function H_loadModule(key) {
    var m = H_MODULES[key]; if (H_mod.p[key]) return H_mod.p[key];
    var load = typeof window.H_loadAsset === 'function' ? window.H_loadAsset : H_domLoad; // tests replace the loader
    // s89: helper scripts (deps) load first; one that fails only hides its tab, the module still opens
    var deps = Promise.all((m.deps || []).map(function (d) { return window[d.global] ? null : load(d).catch(function () {}); })); // in parallel; one already loaded is never added twice
    var pr = H_mod.p[key] = (window[m.global] ? Promise.resolve() : deps.then(function () { return load(m); })).then(function () { if (!window[m.global] || typeof window[m.global].mount !== 'function') throw new Error('no module'); });
    pr.catch(function () { if (H_mod.p[key] === pr) delete H_mod.p[key]; }); // a failed load (offline, a 404) is never remembered: the next open retries
    return pr;
  }
  // 3.2: a module that keeps a list or a draft in memory (guests, inbox) drops it on sign-out and on an account switch; a throwing reset never blocks sign-out.
  function H_resetModules() { ['G_Guests', 'X_Inbox'].forEach(function (n) { try { var g = window[n]; if (g && typeof g.reset === 'function') g.reset(); } catch (e) { /* never block sign-out */ } }); }
  function H_unmount() {
    var k = H_mod.mounted; H_mod.mounted = ''; H_mod.sub = ''; H_mod.n++;
    var g = k && window[H_MODULES[k].global]; try { if (g && typeof g.unmount === 'function') g.unmount(); } catch (e) { /* never block navigation or sign-out */ }
  }
  // The folder is not shipped yet: weather goes to the Notices tab (which has the weather card), stock to the inventory door, manage to the admin hub.
  // 3.2: guests and inbox fall back to the same pages of the admin dashboard door (route() sends a role or setting that cannot open the door to #home).
  function H_fallback(key) {
    var fb = key === 'weather' ? '#calendar/notices' : key === 'stock' ? (doorDef('inventory') && CS.doorAllowed('inventory', role()) ? '#door/inventory' : '#home') : key === 'guests' ? '#door/dashboard/guests' : key === 'inbox' ? '#door/dashboard/guests/conversations' : (state.layout === 'admin' ? '#hub' : '#home');
    history.replaceState(null, '', fb); route();
  }
  // 3.2: what a module needs to subscribe to a push topic without touching pay/. The key comes from the server when asked (as pay/ does); the registration is the shell's own worker.
  function H_pushKey() {
    if (DEMO) return Promise.resolve(null);
    return sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token; if (!tok) return null;
      return net(CFG.url + '/functions/v1/notify-cleaner-payment', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'vapid_key' }) })
        .then(function (r) { return r.json(); }).then(function (j) { return j && j.ok && j.key ? j.key : null; });
    }).catch(function () { return null; });
  }
  function H_swReg() { // ready never settles when no worker registered (a blocked sw.js, a private window): give up after 4 seconds with null
    if (DEMO || !navigator.serviceWorker || !navigator.serviceWorker.ready) return Promise.resolve(null);
    return Promise.race([Promise.resolve(navigator.serviceWorker.ready), new Promise(function (r) { setTimeout(function () { r(null); }, 4000); })]).catch(function () { return null; });
  }
  function renderModule(key) {
    var m = H_MODULES[key], el = $('v-' + key), sub = H_sub;
    if (H_mod.mounted === key && H_mod.sub === sub) return; // a redraw of the same screen must not remount it
    if (H_mod.mounted) H_unmount();
    var token = ++H_mod.n;
    el.innerHTML = appbar({ title: m.title, back: '#home' }) + '<div class="screen"><div class="H_mod" id="H_mod-' + key + '"><div class="skel" style="height:120px"></div></div></div>';
    H_loadModule(key).then(function () {
      if (current !== key || token !== H_mod.n) return;
      var box = $('H_mod-' + key); if (!box) return; box.innerHTML = '';
      H_mod.mounted = key; H_mod.sub = sub;
      var bad = function () { if (H_mod.mounted === key) { H_mod.mounted = ''; H_mod.sub = ''; H_mod.n++; } if (current === key) H_fallback(key); };
      try { var mr = window[m.global].mount(box, { client: DEMO ? null : sb, demo: DEMO, role: role(), sub: sub, propertyId: pid(), houseTimes: A_houseT(), pushKey: H_pushKey, swReg: H_swReg, navigate: function (h) { location.hash = String(h).charAt(0) === '#' ? h : '#' + h; }, toast: toast, haptic: E_vibe }); if (mr && typeof mr.then === 'function') mr.then(null, bad); } catch (e) { bad(); } // a module that throws leaves a screen that works, not a blank one
    }, function () { if (current === key && token === H_mod.n) H_fallback(key); });
  }

  // ---------------------------------------------------------------- Alerts on this phone (3.2, every role)
  // Brownouts, water interruptions and rain during a brownout reach a phone only after one permission tap. The card on Home asks once, calmly; Not now keeps it away for 7 days
  // (a time stamp in localStorage, nothing else). Turn on asks the browser, subscribes through the pay/ push code (C_Push) and sends the topics with staff_push_subscribe_v1.
  // Before the server knows the topic 'notices' the call is retried without topics, so nothing breaks. More > This phone shows the same state as a switch.
  var H_TAP_EV = ['touch' + 'end', 'click']; // the first tap that carries the permission prompt (a gesture iOS accepts); built so the no-gesture-listeners guard stays about swipes
  var H_al = { busy: false, msg: '', on: null, loading: false, auto: false, tapDone: false }, H_tapFn = null, H_ALERT_OFF = 'cs_h_alerts_off', H_ALERT_BLOCKED = 'cs_h_alerts_blocked_later', H_ALERT_KEY = 'cs_h_alerts_later', H_ALERT_OLD = 'cs_alerts_later', H_ALERT_DAYS = 7;
  function H_alEnv() { return { navigator: navigator, window: window }; }
  function H_alSupport() { return DEMO || !window.C_Push ? 'unsupported' : window.C_Push.support(H_alEnv()); }
  // the first key name (cs_alerts_later) is read once and moved to the new one
  function H_alLater() { var ls = store('localStorage'), t = 0; try { t = ls ? Number(ls.getItem(H_ALERT_KEY)) || 0 : 0; if (ls && !t) { t = Number(ls.getItem(H_ALERT_OLD)) || 0; if (t) { ls.setItem(H_ALERT_KEY, String(t)); ls.removeItem(H_ALERT_OLD); } } } catch (e) { t = 0; } return t > 0 && Date.now() - t < H_ALERT_DAYS * 86400000; }
  function H_alertTopics() { return CS.canSeeGuestContact(role()) ? ['paid', 'inbox', 'notices'] : ['paid', 'notices']; }
  function H_alCardOn() { return !!state.access && H_alSupport() === 'ready' && window.Notification && window.Notification.permission === 'default' && !H_alLater(); }
  // 3.2.1: a person who switched alerts off on More is never auto-subscribed; the key is set by switching off, cleared by switching on
  function H_alOff() { var ls = store('localStorage'); try { return !!ls && ls.getItem(H_ALERT_OFF) === '1'; } catch (e) { return false; } }
  function H_alSetOff(v) { var ls = store('localStorage'); try { if (ls) { if (v) ls.setItem(H_ALERT_OFF, '1'); else ls.removeItem(H_ALERT_OFF); } } catch (e) { /* the choice is kept for this visit only */ } }
  function H_alBlockedLater() { var ls = store('localStorage'), t = 0; try { t = ls ? Number(ls.getItem(H_ALERT_BLOCKED)) || 0 : 0; } catch (e) { t = 0; } return t > 0 && Date.now() - t < H_ALERT_DAYS * 86400000; }
  // the steps to allow notifications again, by device: a denied permission can only be reset in the phone or browser settings
  function H_alBlockedSteps(ua) {
    ua = String(ua || '');
    if (/iphone|ipad|ipod/i.test(ua)) return 'Open Settings, then Notifications, then Cascade Staff, then turn on Allow Notifications.';
    if (/android/i.test(ua)) return 'Tap the icon left of the web address, then Permissions, then Notifications, then Allow. Then reload.';
    if (/chrome|edg\//i.test(ua)) return 'Click the icon left of the web address, then Site settings, then Notifications, then Allow. Then reload.';
    return 'Allow notifications for this site in your browser settings, then reload.';
  }
  function H_alBlockedCard() {
    return '<section class="card glass A_card H_alblocked" id="H_alblocked" aria-label="Alerts are off"><h2 class="hd">Alerts are off on this phone</h2><p class="sub" style="margin:0">This phone has blocked notifications, so pay notices, brownouts and rain will not reach you.</p><p class="help" style="margin:0">' + esc(H_alBlockedSteps(navigator.userAgent)) + '</p>' +
      '<div class="row-wrap H_alrow"><button class="btn btn-ghost" type="button" data-act="alerts-blocked-later">Hide for 7 days</button></div></section>';
  }
  function H_alertsCard() {
    if (state.access && H_alSupport() === 'blocked' && !H_alBlockedLater()) return H_alBlockedCard();
    if (!H_alCardOn()) return '';
    return '<section class="card glass A_card H_alerts" id="H_alerts" aria-label="Turn on alerts"><h2 class="hd">Turn on alerts</h2><p class="sub" style="margin:0">Brownouts, water interruptions and rain on the way.</p>' +
      (H_al.msg ? '<p class="help" role="status" style="margin:0">' + esc(H_al.msg) + '</p>' : '') +
      '<div class="row-wrap H_alrow"><button class="btn btn-primary" type="button" data-act="alerts-on"' + (H_al.busy ? ' disabled' : '') + '>' + (H_al.busy ? 'Turning on…' : 'Turn on') + '</button><button class="btn btn-ghost" type="button" data-act="alerts-later"' + (H_al.busy ? ' disabled' : '') + '>Not now</button></div></section>';
  }
  function H_alertsBlockedLater() { var ls = store('localStorage'); try { if (ls) ls.setItem(H_ALERT_BLOCKED, String(Date.now())); } catch (e) { /* it may come back sooner */ } render(); }
  function H_alertsLater() { H_alTapDisarm(); var ls = store('localStorage'); try { if (ls) ls.setItem(H_ALERT_KEY, String(Date.now())); } catch (e) { /* the card may come back sooner; nothing breaks */ } render(); }
  // The switch on More > This phone: hidden where alerts cannot work, a plain sentence where they are blocked, a switch where they can be turned on or off.
  function H_alertsSwitch() {
    var sp = H_alSupport(); if (sp === 'unsupported') return '';
    var words = sp === 'needs_install' || sp === 'blocked' ? window.C_Push.words(sp) : '', on = H_al.on === true;
    if (words) return '<section class="card glass H_alsw" aria-label="Alerts on this phone"><span class="t"><b>Alerts on this phone</b></span><p class="help" style="margin:4px 0 0">' + esc(words) + '</p></section>';
    return '<section class="card glass H_alsw" aria-label="Alerts on this phone"><div class="A_switch"><span id="al-label"><b>Alerts on this phone</b></span><button class="sw" type="button" role="switch" data-act="alerts-switch" aria-checked="' + on + '" aria-labelledby="al-label"' + (H_al.on === null || H_al.busy ? ' disabled' : '') + '><i></i></button></div>' +
      '<p class="help" style="margin:4px 0 0" role="status">' + esc(H_al.msg || (H_al.on === null ? 'Checking…' : on ? 'You will be told about pay notices, brownouts, water interruptions and rain on the way on this phone.' : 'Pay notices, brownouts, water interruptions and rain on the way.')) + '</p></section>';
  }
  function H_alStatus() { // is this phone subscribed? asked once per visit to More; a failure leaves the switch off
    if (H_alSupport() !== 'ready' || H_al.loading || H_al.on !== null) return;
    H_al.loading = true;
    window.C_Push.status({ client: sb, env: H_alEnv() }).then(function (st) { H_al.on = !!st && st.state === 'on'; }).catch(function () { H_al.on = false; }).then(function () { H_al.loading = false; if (current === 'more') renderMore(); });
  }
  function H_alAbsent(e) { return !!e && (e.code === 'PGRST202' || e.status === 404 || /not.?found|PGRST202/i.test(String(e.message || ''))); }
  function H_alTopicRefused(e) { return !!e && (e.code === '22023' || /topic/i.test(String(e.message || ''))); }
  function H_alertsEnable(quiet, fromTap) { // quiet: the automatic subscribe on a phone that already allows alerts; no card, no toast, no message
    if (H_al.busy || H_alSupport() !== 'ready') return Promise.resolve();
    H_al.busy = true; H_al.msg = ''; if (!quiet && !fromTap) { render(); if (current === 'more') renderMore(); }
    var P = window.C_Push, fail = function (sub, reason) { return Promise.resolve(!quiet && sub && sub.unsubscribe ? sub.unsubscribe() : null).catch(function () {}).then(function () { return { ok: false, reason: reason }; }); };
    return Promise.resolve(quiet ? 'granted' : window.Notification.requestPermission()).then(function (perm) {
      if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'blocked' : 'later' };
      return H_pushKey().then(function (key) {
        if (!key) return { ok: false, reason: 'not_configured' };
        return H_swReg().then(function (reg) {
          if (!reg || !reg.pushManager) return { ok: false, reason: 'failed' };
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: P.keyBytes(key) }).then(function (sub) {
            var a = P.args(sub, navigator.userAgent), full = Object.assign({}, a, { p_topics: H_alertTopics() });
            var done = function (res) { return res && !res.error && !(res.data && res.data.ok === false) ? { ok: true } : null; };
            return Promise.resolve(sb.rpc('staff_push_subscribe_v1', full)).then(function (res) {
              if (done(res)) return { ok: true };
              if (res && res.error && !H_alTopicRefused(res.error) && !H_alAbsent(res.error)) return fail(sub, 'failed');
              // the server does not know the topic (or the argument) yet: the same call without topics, the paid notice still works
              return Promise.resolve(sb.rpc('staff_push_subscribe_v1', a)).then(function (r2) { return done(r2) ? { ok: true } : fail(sub, r2 && r2.error && H_alAbsent(r2.error) ? 'not_configured' : 'failed'); });
            });
          });
        });
      });
    }).catch(function () { return { ok: false, reason: 'failed' }; }).then(function (out) {
      H_al.busy = false;
      if (quiet) { H_al.on = !!out.ok; if (current === 'more') renderMore(); return; }
      if (out.ok) { H_alSetOff(false); H_al.on = true; H_al.msg = ''; toast('Alerts are on'); E_vibe('tap'); }
      else if (out.reason === 'blocked') { H_al.on = false; H_al.msg = ''; toast('Alerts stay off. You can turn them on in your phone settings.'); }
      else if (out.reason === 'later') { var lsl = store('localStorage'); try { if (lsl) lsl.setItem(H_ALERT_KEY, String(Date.now())); } catch (e) { /* asked again next load */ } }
      else { H_al.on = false; H_al.msg = P.words(out.reason) || P.words('failed'); }
      render(); if (current === 'more') renderMore();
    });
  }
  function H_alertsDisable() {
    if (H_al.busy || H_alSupport() !== 'ready') return Promise.resolve();
    H_al.busy = true; H_al.msg = ''; renderMore();
    return window.C_Push.disable({ client: sb, env: H_alEnv() }).then(function (r) { if (r && r.ok) { H_al.on = false; H_alSetOff(true); toast('Alerts are off on this phone'); } else H_al.msg = window.C_Push.words('failed'); }).catch(function () { H_al.msg = window.C_Push.words('failed'); }).then(function () { H_al.busy = false; renderMore(); });
  }
  function H_alReset() { H_alTapDisarm(); H_al = { busy: false, msg: '', on: null, loading: false, auto: false, tapDone: false }; }
  function H_alTapDisarm() { if (!H_tapFn) return; H_TAP_EV.forEach(function (t) { document.removeEventListener(t, H_tapFn, true); }); H_tapFn = null; }
  // 3.2.1: after sign-in. Permission already granted: subscribe quietly (once per load) unless the person switched alerts off.
  // Never asked: the first tap anywhere carries the browser prompt (it needs a gesture). Blocked: Today shows how to allow it.
  function H_alAuto() {
    if (DEMO || !state.access || H_al.auto || H_alSupport() !== 'ready' || H_alOff() || !window.Notification) return;
    var perm = window.Notification.permission;
    if (perm === 'granted') {
      H_al.auto = true;
      window.C_Push.status({ client: sb, env: H_alEnv() }).then(function (st) { if (st && st.state === 'on') { H_al.on = true; return; } if (st && st.state === 'off') return H_alertsEnable(true); }).catch(function () {});
    } else if (perm === 'default' && !H_alLater() && !H_tapFn && !H_al.tapDone) {
      H_tapFn = function (ev) {
        var a = ev && ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null, act = a && a.getAttribute('data-act');
        H_alTapDisarm(); H_al.tapDone = true;
        if (act === 'alerts-on' || act === 'alerts-later') return; // the card's own buttons answer for themselves
        if (!H_alOff() && !H_alLater() && H_alSupport() === 'ready' && window.Notification.permission === 'default') H_alertsEnable(false, true);
      };
      H_TAP_EV.forEach(function (t) { document.addEventListener(t, H_tapFn, true); });
    }
  }
  // ---------------------------------------------------------------- Admin hub (owner, admin, finance): every dashboard page, in the groups of the admin home
  function renderHub() {
    var groups = CS.A_hubGroups(role());
    $('v-hub').innerHTML = appbar({ title: 'Admin hub', back: '#more' }) + '<div class="screen"><p class="sub" style="margin:0 0 12px">Every page of the admin dashboard. Each opens inside this app, already signed in.</p><div class="stack">' +
      groups.map(function (g) {
        return '<div class="A_hubgrp"><div class="A_label">' + esc(g.title) + '</div><nav class="card glass list" aria-label="' + esc(g.title) + '">' + g.items.map(function (i) {
          var l = A_hubLink(i.route); return l ? row({ icon: i.icon, title: i.title, sub: i.sub, href: l.href, external: l.external }) : '';
        }).join('') + '</nav></div>';
      }).join('') + '</div></div>';
  }
  // A_loadNotices: notices_v1, probed. A missing RPC hides the card and the tab content (not an error); a failed read keeps what we had.
  var H_nSeq = 0; // only the newest read counts: an older one that lands last must not put the null-weather card back
  function A_loadNotices() {
    if (!state.access) return Promise.resolve();
    state.noticesLoading = !state.notices && !state.noticesAbsent;
    var my = ++H_nSeq;
    return sb.rpc('notices_v1', { p_property_id: pid() }).then(function (r) {
      if (my !== H_nSeq) return;
      if (r.error) throw r.error;
      CS.assertNoMoney(r.data);
      var v = CS.A_noticesView(r.data, role(), state.payload ? state.payload.today : CS.manilaToday());
      if (!v) throw new Error('shape');
      state.notices = v; state.noticesAbsent = false; state.noticesFailed = false;
    }).catch(function (e) {
      if (my !== H_nSeq) return;
      if (CS.rpcMissing(e)) { state.noticesAbsent = true; state.notices = null; state.noticesFailed = false; } else state.noticesFailed = true; // a missing feature is not a failure; a failed read is
    }).then(function () { if (my !== H_nSeq) return; state.noticesLoading = false; state.noticesDone = true; if (state.layout && (current === 'home' || current === 'calendar')) render(current);
      if (state.notices && !state.notices.weather && !H_wxP && state.payload) H_wxFetch(); }); // self-heal: the server cache is over 60 minutes old, so ask for a fresh one once; the answer re-reads this card
  }
  var NADD_TYPES = [['water', 'Water interruption'], ['maintenance', 'Maintenance'], ['deep_clean', 'Deep cleaning'], ['note', 'Note']]; // a brownout is refused by the server
  function A_noticeAddForm() {
    var a = state.nadd;
    return '<h2 class="ttl" id="cs-h" tabindex="-1">Add a notice</h2><p class="help" style="margin:4px 0 0">No phone numbers, e-mails or amounts.</p><div class="stack" style="margin-top:10px">' +
      '<div class="field"><span class="lbl" id="n-kind-l">What kind of notice</span><div class="H_kinds" role="group" aria-labelledby="n-kind-l">' +
        [['water', 'Water', 'drop'], ['power', 'Power', 'zap']].map(function (k) { return '<button class="H_kind" type="button" data-act="nkind" data-kind="' + k[0] + '" aria-pressed="' + (a.type === k[0]) + '">' + ICON(k[2], 's24') + k[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="n-type">Or another kind</label><select class="sel" id="n-type" style="max-width:none;text-align:left;text-align-last:left"><option value=""' + (a.type === 'water' || a.type === 'power' ? ' selected' : '') + '>Choose, if not water or power</option>' + NADD_TYPES.filter(function (t) { return t[0] !== 'water'; }).map(function (t) { return '<option value="' + t[0] + '"' + (a.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="n-title">What is happening</label><div class="input"><input id="n-title" maxlength="80" value="' + esc(a.title) + '" autocomplete="off"></div></div>' +
      '<p class="help" style="margin:-6px 0 0">' + esc(a.type === 'power' ? 'Shows on the calendar. SOCOTECO II notices arrive by themselves. Put the hours in the title.' : CS.A_NOTICE_HINT) + '</p>' +
      '<div class="field"><label for="n-date">Date</label><div class="input"><input id="n-date" type="date" value="' + esc(a.date) + '"></div></div>' +
      '<div class="field"><label for="n-start">Starts (optional)</label><div class="input"><input id="n-start" type="time" value="' + esc(a.start) + '"></div></div>' +
      '<div class="field"><label for="n-hours">Lasts, in hours (optional)</label><div class="input"><input id="n-hours" inputmode="decimal" maxlength="4" value="' + esc(a.hours) + '"></div></div>' +
      '<div class="field"><label for="n-detail">Detail (optional)</label><div class="input"><input id="n-detail" maxlength="200" value="' + esc(a.detail) + '" autocomplete="off"></div></div>' +
      (a.err ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(a.err) + '</span></div>' : '') +
      '<div class="row-wrap"><button class="btn btn-primary" type="button" data-act="notice-add-save"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Saving…' : 'Add notice') + '</button><button class="btn btn-ghost" type="button" data-act="notice-add-cancel">Cancel</button></div></div>';
  }
  function A_noticeAddDraw() { if (state.sheet && state.sheet.kind === 'nadd') drawSheet(); }
  function A_noticeAddSave() {
    var a = state.nadd; if (!a || a.busy || !CS.canSeeGuestContact(role())) return;
    var power = a.type === 'power', bad = power ? CS.H_powerProblem(a) : CS.A_noticeAddProblem(a); if (bad) { a.err = bad; A_noticeAddDraw(); return; }
    a.busy = true; a.err = ''; A_noticeAddDraw();
    // Power is saved as a brownout flag on the day (the notice call refuses a power notice); the rest go through ops_notice_add_v1
    var call = power ? sb.rpc('calendar_day_flag_set_v1', { p_property_id: pid(), p_date: a.date, p_kind: 'brownout', p_label: String(a.title).trim().slice(0, 60) }) : sb.rpc('ops_notice_add_v1', CS.A_noticeAddArgs(pid(), a));
    call.then(function (r) {
      if (r.error) throw r.error;
      if (r.data && r.data.ok === false) throw { message: r.data.error || 'not ok', code: '22023' };
      state.nadd = null; closeSheet(); toast(power ? 'Marked on the calendar for that day.' : 'Notice added.'); E_vibe('tap'); return Promise.all([A_loadNotices(), power ? loadHome() : null]);
    }).catch(function (e) {
      a.busy = false; E_vibe('error');
      a.err = CS.rpcMissing(e) ? 'Available after the next update.' : CS.A_noticeAddError(e);
      A_noticeAddDraw();
    });
  }
  function A_noticeByKey(key) { var v = A_notices(); return v ? v.all.filter(function (n) { return n.key === key; })[0] || null : null; }

  // ---------------------------------------------------------------- data
  function loadAccess() {
    return sb.rpc('current_staff_access').then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }
  function signOutTo(msg) {
    clearTimeout(H_rpT); state.H_q = ''; state.H_offKey = ''; H_unmount(); H_resetModules(); H_histGen++; H_calReset(); H_alReset(); closeSheet(); dropPhotos(); state.replyRecent = []; state.cleanDone = null; state.payWait = 0; state.progress = null; state.progressAbsent = false; H_idClose(); state.reply = null; var rb = $('rp-body'); if (rb) rb.innerHTML = ''; rpLive(''); state.payload = null; state.bookings = null; state.bookingsDone = false; state.noticesDone = false; state.notices = null; state.noticesAbsent = false; state.nadd = null; state.fbOpen = false; state.tasks = null; state.access = null; state.layout = null; state.month = null; state.error = '';
    return sb.auth.signOut().catch(function () {}).then(function () { showSignin(msg); });
  }
  function showSignin(msg) {
    leaveDoor(); setView('signin'); history.replaceState(null, '', '#signin');
    var e = $('si-err'); e.hidden = !msg; e.innerHTML = msg ? ICON('alert') + '<span>' + esc(msg) + '</span>' : '';
    si.pin = ''; $('si-pass').value = ''; drawDots(msg);
    if (!si.loaded) { si.loaded = true; loadSigninList(); }
  }
  function loadHome(opts) {
    opts = opts || {};
    if (state.loading) return Promise.resolve();
    state.loading = true;
    var pid = (state.access && state.access.property_ids && state.access.property_ids[0]) || CFG.propertyId;
    return sb.rpc('staff_home_v1', { p_property_id: pid }).then(function (r) {
      if (r.error) {
        if (r.error.code === '42501' || /forbidden/i.test(r.error.message || '')) return signOutTo('Your access was turned off. Ask Lloyd.');
        throw r.error;
      }
      try { CS.assertNoMoney(r.data, { allowContact: CS.canSeeGuestContact(state.access && state.access.role) }); } catch (e) { state.payload = null; state.errorKind = 'blocked'; state.error = 'This page was blocked because the data carried an amount or a contact detail. Tell Lloyd.'; return; }
      if (!CS.canSeeGuestContact(state.access && state.access.role)) r.data.warnings = (r.data.warnings || []).filter(function (w) { return w.kind !== 'verifier'; });
      state.payload = r.data; state.loadedAt = Date.now(); state.error = ''; state.errorKind = '';
      H_wxP = null; refreshWeather(); loadPayHint(); loadBookingsToConfirm(); A_loadNotices(); H_loadProgress();
    }).catch(function (e) {
      state.errorKind = E_netErr(e) ? 'network' : 'server'; // "No connection" only when the network is the problem
      state.error = state.errorKind === 'network' ? (state.payload ? 'Live information needs a connection. Showing the last update.' : 'Live information needs a connection.') : (state.payload ? 'Could not update. Showing the last update.' : 'Could not update.');
    }).then(function () { state.loading = false; if (state.layout) render(); E_announce(); H_offlineSync(); });
  }
  // cleaning_progress_v1 (owner and admin): the "Clean" check of the Turnover card. Probed: a missing RPC hides the row, it is not an error.
  function H_loadProgress() {
    if (!CS.canSeeGuestContact(role()) || state.progressAbsent) return;
    sb.rpc('cleaning_progress_v1').then(function (r) {
      if (r.error) { if (CS.rpcMissing(r.error)) state.progressAbsent = true; state.progress = null; return; }
      state.progress = CS.H_progress(r.data, role());
    }).catch(function () { state.progress = null; }).then(function () { if (current === 'home' && state.layout) renderHome(); });
  }
  // weather-proxy refreshes its own cache. ONE request per loadHome, shared by the Home line and the Notices self-heal (a second caller gets the same promise).
  // When it answers, the Home reading and the Notices card are both redrawn from it. A refusal or a timeout leaves the reading as it was, and nothing retries.
  var H_wxP = null;
  function H_wxFetch() {
    if (H_wxP) return H_wxP;
    H_wxP = sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token; if (!tok) return null;
      return net(CFG.url + '/functions/v1/weather-proxy', { headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key }, cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; }).then(function (j) {
          if (!(j && j.current && j.current.temp != null)) return null;
          if (state.payload) {
            var c = j.current;
            state.payload.weather = { source: j.source || null, fetched_at: j.fetched_at || new Date().toISOString(), current: { temp: c.temp, emoji: c.emoji, description: c.description, rain_prob: c.rain_prob, today_high: c.today_high, today_low: c.today_low, humidity: c.humidity, uv_label: c.uv_label } };
            render();
          }
          return j;
        });
    }).catch(function () { return null; }).then(function (j) { if (j) A_loadNotices(); return j; });
    return H_wxP;
  }
  function refreshWeather() { if (CS.weatherStale(state.payload && state.payload.weather)) H_wxFetch(); }
  // Payment Request sub-line: how many cleans are ready. SPEC-37's RPC; silent while it is not deployed.
  function loadPayHint() {
    if (state.layout === 'admin' && LINKS.pay && /^(owner|admin|finance)$/.test(role() || '')) { // B1: how many pay requests wait for the owner (the primary button on Today)
      sb.rpc('staff_pay_admin_list_v1').then(function (r) { var d = r.data; if (r.error || !d || d.ok === false) return; state.payWait = (d.requests || []).filter(function (q) { return q.status === 'requested'; }).length; if (current === 'home' && state.layout) renderHome(); }).catch(function () {});
      return;
    }
    if (state.layout !== 'staff' || !LINKS.pay) return;
    sb.rpc('staff_pay_candidates_v1').then(function (r) {
      var d = r.data; if (r.error || !d || d.ok === false) return;
      var n = (d.sessions || []).length + (d.claims || []).length;
      state.payHint = n ? n + (n === 1 ? ' item ready to request' : ' items ready to request') : 'Nothing waiting to request';
      var s = $('pay-sub'); if (s) s.textContent = state.payHint;
    }).catch(function () {});
  }

  // Bookings to confirm (SPEC-44): owner/admin/finance only, refreshed when Home loads, no polling. Any error or a missing RPC hides the row (logged once).
  var bkWarned = false;
  function loadBookingsToConfirm() {
    if (state.layout !== 'admin' || !CS.canSeeBookingsToConfirm(state.access && state.access.role)) return;
    var fail = function (e) { state.bookings = null; state.bookingsDone = true; state.bookingsFailed = !CS.rpcMissing(e && e.code ? e : { message: String((e && e.message) || e || '') }); if (!bkWarned) { bkWarned = true; console.warn('bookings to confirm unavailable', e && e.message ? e.message : e); } };
    sb.rpc('staff_inquiry_payments_v1', { p_property_id: pid() }).then(function (r) {
      if (r.error) return fail(r.error);
      state.bookings = CS.bookingsToConfirmCount(r.data); state.bookingsFailed = false; // the count only; the payment rows are never kept
    }).catch(fail).then(function () { state.bookingsDone = true; if (current === 'home' && state.layout) render('home'); });
  }

  // ---------------------------------------------------------------- router
  function route() {
    var h = (location.hash || '').replace(/^#/, ''), parts = h.split('/'), v = parts[0] || 'home';
    if (!state.layout) return;
    if (v === 'notices') { history.replaceState(null, '', '#calendar/notices'); parts = ['calendar', 'notices']; v = 'calendar'; } // 3.2: the alerts open the Notices tab; #notices is its short name
    if (VIEWS.indexOf(v) < 0 || v === 'signin') v = 'home';
    if (v === 'door' && !(doorDef(parts[1]) && CS.doorFramed(parts[1], state.layout, trustOn) && CS.doorAllowed(parts[1], state.access && state.access.role))) v = 'home'; // role decides; the server stays the real gate
    if (v === 'payrates' && !CS.canEditRates(state.access && state.access.role)) v = 'home';
    if (v === 'reply' && !canReply()) v = 'home';
    if (v === 'hub' && state.layout !== 'admin') v = 'home';
    if (H_MODULES[v]) { if (H_MODULES[v].roles && H_MODULES[v].roles.indexOf(role()) < 0) v = 'home'; else H_sub = parts.slice(1).join('/'); } // the role is checked before anything is loaded
    if (v === 'calendar' && parts[1] === 'stays') { history.replaceState(null, '', '#calendar'); parts = ['calendar']; } // s82: Month and Stays are one screen
    if (v !== 'calendar' || CS.A_calTab(parts[1]) !== state.calTab) state.fbOpen = false; // the posts load only on a tap in the current visit to the Notices tab
    if (v === 'calendar') { var tab0 = CS.A_calTab(parts[1]); if (tab0 !== state.calTab) closeSheet(); state.calTab = tab0; }
    if (v === 'door' && DEMO) { toast('Demo: ' + doorDef(parts[1]).title + ' opens in the live app'); history.replaceState(null, '', '#home'); v = 'home'; } // a door would load a real app in the frame
    if (v === 'door') { doorKey = parts[1]; doorRoute = doorKey === 'dashboard' && CS.A_hubRouteOk(parts.slice(2).join('/')) ? parts.slice(2).join('/') : ''; doorAnchor = doorKey === 'manual' && /^[\w.-]{1,80}$/.test(parts[2] || '') ? parts[2] : ''; render('door'); window.scrollTo(0, 0); return; }
    leaveDoor(); render(v);
    if (v === 'calendar' && state.dayAfter) { var d1 = state.dayAfter; state.dayAfter = null; openSheet('day', d1); }
    var t = parts[1] && !H_MODULES[v] && $(parts[1]); if (t) t.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  }
  var current = 'home', doorKey = '', doorRoute = '', doorAnchor = '';
  function render(v) {
    v = v || current; current = v;
    if (H_mod.mounted && H_mod.mounted !== v) H_unmount();
    setView(v);
    if (v === 'door') { renderDoor(); return; }
    renderTabs(v === 'hub' || v === 'search' ? 'more' : v === 'weather' ? 'calendar' : v === 'stock' || v === 'manage' || v === 'guests' || v === 'inbox' ? '' : v); // B1: a sub-page marks no tab, never Today
    if (H_MODULES[v]) renderModule(v); else if (v === 'search') renderSearch(); else if (v === 'hub') renderHub(); else if (v === 'home') renderHome(); else if (v === 'calendar') renderCalendar(); else if (v === 'tasks') renderTasks(); else if (v === 'payrates') { renderPayRates(); if (!state.rates) loadRates(); } else if (v === 'reply') renderReply(); else if (v === 'more') renderMore();
    var typing = document.activeElement && /^(df-(label|kind)|t-(title|due|who|note)|n-(type|title|date|start|hours|detail))$/.test(document.activeElement.id || '');
    if (state.sheet) { if (v !== state.sheet.view) closeSheet(); else if (!typing) drawSheet(); }
  }
  // A door opens in the frame once per visit; coming back to the same door (a re-render) keeps the page where it is.
  function renderDoor() {
    var d = doorDef(doorKey), f = $('door-frame'); if (!d) return;
    var ttl = doorKey === 'checklist' ? H_doorTitle(d.title) : d.title;
    $('door-title').textContent = ttl; f.title = d.title;
    $('door-back').innerHTML = ICON('back', 's24') + 'Back'; $('door-done').hidden = doorKey !== 'checklist'; $('door-done').innerHTML = ICON('check', 's16') + 'Done';
    var tag = doorKey + '/' + doorRoute + '/' + doorAnchor;
    if (f.getAttribute('data-door') !== tag) { f.setAttribute('data-door', tag); setFrame(f, doorRoute ? CS.A_hubDoorUrl(d.url, doorRoute) : doorAnchor ? d.url.replace(/#.*$/, '') + '#' + doorAnchor : d.url); }
  }
  // MF1: the checklist's bar says which turnover it is ("Cleaning · Ana out 12:00 noon · Ben in 2:00 pm"); Done goes home, the clean-done card waits there.
  function H_doorTitle(fallback) {
    if (!state.payload) return fallback;
    var T = A_houseT(), ds = dayStatusOf(state.payload.today), parts = [];
    if (ds.out) parts.push((ds.out.guest_name || 'Guest') + ' out ' + T.outLabel); if (ds.arrive) parts.push((ds.stay.guest_name || 'Guest') + ' in ' + T.inLabel);
    return parts.length ? 'Cleaning · ' + parts.join(' · ') : fallback;
  }
  function leaveDoor() { var f = $('door-frame'); if (f && f.getAttribute('data-door')) { f.removeAttribute('data-door'); setFrame(f, 'about:blank'); if (state.layout) { loadHome(); loadTasks(); } } } // what was done inside the door may have changed the pill
  // location.replace on the frame's window: opening or closing a door adds no history entry (so Back is one press, not two).
  function setFrame(f, url) { try { f.contentWindow.location.replace(url); } catch (e) { f.src = url; } }
  function enter() {
    H_histGen++; H_calReset(); H_alReset(); H_resetModules(); // a new sign-in starts every module empty, whoever was here before
    state.layout = CS.layoutForRole(state.access.role);
    state.name = CS.deriveDisplayName(state.user);
    if (!/^#(home|calendar|tasks|payrates|reply|more|hub|weather|stock|manage|guests|inbox|notices|search)/.test(location.hash)) history.replaceState(null, '', '#home');
    route(); loadHome(); loadTasks(); maybeIosHint(); H_tourMaybe(); H_alAuto();
  }
  function boot() {
    sb.auth.getSession().then(function (s) {
      var sess = s.data && s.data.session;
      if (!sess) return showSignin('');
      state.user = sess.user;
      return loadAccess().then(function (access) {
        var v = CS.accessVerdict(access);
        if (!v.ok) return signOutTo(v.message);
        state.access = access; enter();
      });
    }).catch(function () { showSignin('No connection. Check your signal and open the app again.'); });
  }

  // ---------------------------------------------------------------- events
  // ---- sign-in screen (D-303.2, D-303.3): name dropdown from staff_signin_list_v1, then a PIN keypad or a password field ----
  var si = { list: [], entry: null, pin: '', busy: false, typed: false, loaded: false };
  var PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  $('si-pad').innerHTML = PAD.map(function (k) {
    if (!k) return '<span class="gap" aria-hidden="true"></span>';
    return k === 'back' ? '<button type="button" class="fn" data-key="back" aria-label="Delete the last digit">' + ICON('backspace', 's24') + '</button>'
      : '<button type="button" data-key="' + k + '">' + k + '</button>';
  }).join('');
  $('si-lock').innerHTML = ICON('lock').replace('class="i"', 'class="i" style="color:var(--fg-3)"');
  function drawDots(bad) {
    var d = $('si-dots'); d.setAttribute('aria-label', 'PIN, ' + si.pin.length + ' of 4 digits');
    Array.prototype.forEach.call(d.children, function (dot, i) { dot.className = i < si.pin.length ? 'on' : ''; });
    d.classList.remove('bad'); if (bad && si.entry && si.entry.kind === 'pin') { void d.offsetWidth; d.classList.add('bad'); }
  }
  function setEntry(entry) {
    si.entry = entry; si.pin = ''; $('si-pass').value = '';
    var pin = !!entry && entry.kind === 'pin', pw = !!entry && entry.kind === 'password';
    $('si-pinbox').hidden = !pin; $('si-passbox').hidden = !pw; $('si-go').hidden = !pw; $('si-topin').hidden = !(pw && entry.wasPin);
    $('si-pinlbl').textContent = entry && entry.label && !si.typed ? 'PIN for ' + entry.label : 'Your PIN';
    var e = $('si-err'); e.hidden = true; drawDots();
    if (pw && !si.typed) $('si-pass').focus();
  }
  function fillPicker() {
    var sel = $('si-who');
    $('si-pick').hidden = si.typed; $('si-typedbox').hidden = !si.typed;
    if (si.typed) { setEntry(CS.typedEntry($('si-typed').value)); return; }
    sel.innerHTML = '<option value="">Choose your name</option>' + si.list.map(function (r) { return '<option value="' + esc(r.handle) + '">' + esc(r.label) + '</option>'; }).join('');
    sel.disabled = false;
    var last = CS.recalledName(store('localStorage'), si.list);
    if (last) { sel.value = last; setEntry(si.list.filter(function (r) { return r.handle === last; })[0]); } else setEntry(null);
  }
  // 3.4.2: ?team=staff|admin install links. Staff sees only team 'staff' names; admin (and no link at all) sees everyone.
  var team = CS.resolveTeam(location.search, store('localStorage'));
  function loadSigninList() {
    return sb.rpc('staff_signin_list_v2').then(function (r) {
      if (r.error && CS.rpcMissing(r.error)) {
        // v2 not live yet: v1 rows carry no team, so signinList tags them admin. The admin link lists everyone; the staff link gets an
        // empty list and falls to the typed name, so it never shows an owner or admin name (a PIN admin like Marifel looks like staff in v1).
        return sb.rpc('staff_signin_list_v1');
      }
      return r;
    }).then(function (r) {
      if (r.error) throw r.error;
      var list = CS.signinForTeam(CS.signinList(r.data), team); if (!list.length) throw new Error('empty');
      si.list = list; si.typed = false;
    }).catch(function () { si.list = []; si.typed = true; si.loaded = false; }).then(fillPicker);
  }
  function submitSignin() {
    if (si.busy) return;
    var entry = si.entry, cred = CS.signinCredentials(entry, entry && entry.kind === 'pin' ? si.pin : $('si-pass').value);
    if (!cred) { showSignin(!entry ? 'Choose your name first.' : entry.kind === 'pin' ? 'Enter your 4-digit PIN.' : 'Type your password.'); return; }
    si.busy = true; $('si-go').disabled = true; trustOn = $('si-trust').checked;
    var bad = entry.kind === 'pin' ? 'That name or PIN is not right.' : 'That name or password is not right.';
    sb.auth.signInWithPassword(cred).then(function (r) {
      if (r.error) { var offline = /fetch|network/i.test(r.error.message || '') || r.error.status === 0; if (!offline) E_vibe('error'); showSignin(offline ? 'No connection.' : bad); return; }
      CS.rememberName(store('localStorage'), entry.handle);
      state.user = r.data.user;
      return loadAccess().then(function (access) {
        var v = CS.accessVerdict(access);
        if (!v.ok) return signOutTo(v.message);
        state.access = access; enter();
      });
    }).catch(function () { showSignin('No connection.'); }).then(function () { si.busy = false; $('si-go').disabled = false; });
  }
  $('si-who').addEventListener('change', function () {
    var h = this.value; setEntry(si.list.filter(function (r) { return r.handle === h; })[0] || null);
  });
  // Use a password instead / Use PIN: same name, other kind, this attempt only (a PIN entry may hold a mailbox password).
  $('si-topw').addEventListener('click', function () { if (si.entry && !si.busy) { setEntry(CS.signinAsKind(si.entry, 'password')); $('si-pass').focus(); } });
  $('si-topin').addEventListener('click', function () { if (si.entry && !si.busy) setEntry(CS.signinAsKind(si.entry, 'pin')); });
  $('si-typed').addEventListener('input', function () { setEntry(CS.typedEntry(this.value)); });
  $('si-pad').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-key]'); if (!b || si.busy) return;
    si.pin = CS.keypadPress(si.pin, b.getAttribute('data-key')); drawDots();
    if (si.pin.length === 4) submitSignin();
  });
  document.addEventListener('keydown', function (ev) { // a hardware keyboard works the pad too
    if (!$('v-signin').classList.contains('on') || $('si-pinbox').hidden || si.busy || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (/^\d$/.test(ev.key) || ev.key === 'Backspace') {
      if (ev.target && ev.target.tagName === 'INPUT') return;
      si.pin = CS.keypadPress(si.pin, ev.key === 'Backspace' ? 'back' : ev.key); drawDots(); if (si.pin.length === 4) submitSignin();
    }
  });
  $('signin-form').addEventListener('submit', function (ev) { ev.preventDefault(); submitSignin(); });
  $('door-back').addEventListener('click', function () { location.replace(location.pathname + location.search + '#home'); });
  $('door-done').addEventListener('click', function () { location.replace(location.pathname + location.search + '#home'); });
  // MF1: the checklist (same origin) posts cs-clean-done after a successful submit. The door closes and Home shows the clean-done card.
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data; if (!d || typeof d !== 'object' || d.type !== 'cs-clean-done' || ev.origin !== location.origin || state.layout !== 'staff' || current !== 'door' || doorKey !== 'checklist') return;
    var fr = $('door-frame'); if (!fr || !fr.contentWindow || ev.source !== fr.contentWindow) return; // only the open checklist frame may say it
    var n = function (x) { x = Math.floor(+x); return x >= 0 && x < 1000 ? x : 0; };
    state.cleanDone = { id: /^[\w-]{1,64}$/.test(String(d.session_id)) ? String(d.session_id) : '', startedAt: String(d.started_at || ''), finishedAt: String(d.finished_at || ''), issues: n(d.issues), photos: n(d.photos), at: Date.now() };
    location.hash = '#home'; route();
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act],[data-theme],[data-day],[data-warn],[data-nfilter],[data-tfilter]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (t.hasAttribute('data-F-close') && state.sheet && !state.sheet.confirm && E_dirty()) { state.sheet.confirm = true; drawSheet(); var kb = $('F_keep'); if (kb && kb.focus) kb.focus(); } // Close on a sheet with typing in it asks once
    else if (a === 'discard-keep') { if (state.sheet) { state.sheet.confirm = false; drawSheet(); var hh = $('cs-h'); if (hh && hh.focus) hh.focus(); } }
    else if (a === 'refresh') { if (current === 'home' && !state.loading) E_say = true; loadHome(); loadTasks(); if (current === 'payrates') loadRates(); }
    else if (a === 'attn-open') openSheet('attn', 'attn-open');
    else if (a === 'day-prev') H_dayGo(-1);
    else if (a === 'day-next') H_dayGo(1);
    else if (a === 'legend-more') { state.legendOpen = !state.legendOpen; H_legendSave(); var lg = t.closest && t.closest('.H_legend'); if (lg) { lg.setAttribute('data-open', state.legendOpen ? '1' : '0'); t.setAttribute('aria-expanded', String(state.legendOpen)); } }
    else if (a === 'tasks-toggle-done') { state.showDone = !state.showDone; loadTasks(); renderTasks(); }
    else if (a === 'attn-tasks') { var tf0 = t.getAttribute('data-filter'); if (/^(all|mine|due|blocks)$/.test(tf0 || '')) state.taskFilter = tf0; closeSheet(); }
    else if (a === 'dayform-open') { if (state.sheet) { state.sheet.formOpen = true; drawSheet(); var dk = $('df-kind'); if (dk) dk.focus(); } }
    else if (a === 'haptics') { CS.E_hapticsSet(!CS.E_hapticsOn(store('localStorage')), store('localStorage')); renderMore(); }
    else if (a === 'task-done' || a === 'task-undo') setTaskDone(t.getAttribute('data-task'), a === 'task-done');
    else if (a === 'task-add-open') openAdd();
    else if (a === 'task-add-cancel') { state.add = null; closeSheet(); }
    else if (a === 'plain') { window.CSTheme.setPlain(!window.CSTheme.plainOn()); renderMore(); }
    else if (a === 'whatsnew') openSheet('news', 'news');
    else if (a === 'fb-show') { state.fbOpen = true; renderCalendar(); }
    else if (a === 'fb-hide') { state.fbOpen = false; renderCalendar(); }
    else if (a === 'notice-add-open') { if (CS.canSeeGuestContact(role()) && state.notices && !state.noticesAbsent) { state.nadd = { type: 'water', title: '', date: t.getAttribute('data-date') || '', start: '', hours: '', detail: '', err: '', busy: false }; openSheet('nadd', 'notice-add-open'); } }
    else if (a === 'notice-add-cancel') { state.nadd = null; closeSheet(); }
    else if (a === 'notice-add-save') A_noticeAddSave();
    else if (a === 'notice-tell') { var nt = CS.canSeeGuestContact(role()) ? A_noticeByKey(t.getAttribute('data-nkey')) : null; var gm = nt ? CS.A_guestMessage(nt) : null; if (nt && !gm) toast('Check the notice text first.'); else if (gm) copyText(gm).then(function () { toast('Message copied. Paste it to the guest.'); E_vibe('tap'); }, function () { toast('Copy did not work on this phone.'); }); }
    else if (a === 'notice-cal') { var nd0 = t.getAttribute('data-date'), np = nd0.split('-'); if (CS.monthInRange(+np[0], +np[1], state.payload.today)) state.month = { y: +np[0], m: +np[1] }; state.calTab = 'calendar'; if (location.hash !== '#calendar') { closeSheet(); state.dayAfter = nd0; location.hash = '#calendar'; } else { render('calendar'); openSheet('day', nd0); state.sheet.view = 'calendar'; } } // from another screen the day sheet opens once the calendar has settled, so a Home redraw cannot close it
    else if (a === 'notice-resolve') { if (CS.canSeeGuestContact(role())) sb.rpc('ack_verifier_finding_v1', { p_key: t.getAttribute('data-id') }).then(function (r) { if (r.error) throw r.error; return A_loadNotices(); }).catch(function () { toast('That did not save. Check your signal and try again.'); }); }
    else if (t.hasAttribute('data-nfilter')) { state.noticeFilter = t.getAttribute('data-nfilter'); renderCalendar(); }
    else if (t.hasAttribute('data-tfilter')) { state.taskFilter = t.getAttribute('data-tfilter'); renderTasks(); }
    else if (a === 'task-add-save') saveAdd();
    else if (a === 'rate-save') A_rateOpen();
    else if (a === 'rate-confirm') saveRate();
    else if (a === 'rate-back') closeSheet();
    else if (a === 'rates-more') { state.ratesMore = !state.ratesMore; renderPayRates(); }
    else if (a === 'reply-mode') { var R1 = state.reply || (state.reply = newReply()); R1.mode = t.getAttribute('data-mode') === 'image' ? 'image' : 'text'; R1.step = 'form'; R1.err = ''; R1.signout = false; renderReply(); window.scrollTo(0, 0); if (R1.mode === 'text') rpFocus('rp-text'); }
    else if (a === 'reply-platform') { if (state.reply) { state.reply.platform = t.getAttribute('data-platform') === 'airbnb' ? 'airbnb' : 'messenger'; Array.prototype.forEach.call(document.querySelectorAll('#v-reply [data-act="reply-platform"]'), function (b) { b.setAttribute('aria-pressed', String(b === t)); }); } }
    else if (a === 'reply-send') sendReply();
    else if (a === 'reply-copy') copyReply(+t.getAttribute('data-i'));
    else if (a === 'reply-copy-recent') { var rr = (state.replyRecent || [])[+t.getAttribute('data-i')]; if (rr) copyText(rr.text).then(function () { toast('Copied'); }, function () { toast('Copy did not work on this phone.'); }); }
    else if (a === 'clean-done-hide') { state.cleanDone = null; if (current === 'home') renderHome(); }
    else if (a === 'tour-open') { openSheet('tour', 'tour-open'); state.sheet.step = 0; drawSheet(); }
    else if (a === 'tour-next') { var TS = state.sheet; if (TS && TS.kind === 'tour') { if ((TS.step || 0) >= H_TOUR.length - 1) closeSheet(); else { TS.step = (TS.step || 0) + 1; drawSheet(); } } }
    else if (a === 'tour-skip') closeSheet();
    else if (a === 'id-full') { var im = t.querySelector && t.querySelector('img'); if (im && CS.canSeeGuestContact(role())) H_idFull(im.src); }
    else if (a === 'id-rot') { var ro = $('H_idfull'), rs = ro && ro.getAttribute('data-src'), ri = ro && ro.querySelector('img'); if (rs && ri) { state.rot[rs] = (H_idRot(rs) + 90) % 360; ri.className = 'r' + state.rot[rs]; } }
    else if (a === 'id-full-close') H_idClose();
    else if (a === 'attn-ack') H_attnAck(t.getAttribute('data-warn'));
    else if (a === 'reply-back') { if (state.reply) { state.reply.step = 'pick'; state.reply.err = ''; state.reply.signout = false; } renderReply('heading'); }
    else if (a === 'reply-cancel') { var RC = state.reply; if (RC) { try { if (RC.ctl) RC.ctl.abort(); } catch (e) {} RC.busy = false; RC.reqId = ++H_rpSeq; clearTimeout(H_rpT); rpLive('Cancelled'); renderReply(RC.mode === 'text' ? '' : 'heading'); if (RC.mode === 'text') rpFocus('rp-text'); } }
    else if (a === 'nkind') { if (state.nadd) { state.nadd.type = t.getAttribute('data-kind') === 'power' ? 'power' : 'water'; state.nadd.err = ''; A_noticeAddDraw(); } }
    else if (a === 'reply-reset') { state.reply = newReply(); renderReply('heading'); rpLive(''); window.scrollTo(0, 0); }
    else if (a === 'alerts-on') H_alertsEnable();
    else if (a === 'alerts-later') H_alertsLater();
    else if (a === 'alerts-blocked-later') H_alertsBlockedLater();
    else if (a === 'alerts-switch') { if (H_al.on) H_alertsDisable(); else H_alertsEnable(); }
    else if (a === 'signout') { signOutTo(''); }
    else if (a === 'sheet-close') closeSheet();
    else if (a === 'copy') copyText(t.getAttribute('data-copy') || '').then(function () { toast('Copied'); }, function () { toast('Copy did not work on this phone. Press and hold the text to copy it.'); });
    else if (a === 'flag-save') flagSave();
    else if (a === 'flag-clear') sheetCall('calendar_day_flag_clear_v1', { p_property_id: pid(), p_id: t.getAttribute('data-id') }, 'Note removed.');
    else if (a === 'warn-ack') warnAck();
    else if (t.hasAttribute('data-day')) openSheet('day', t.getAttribute('data-day'));
    else if (t.hasAttribute('data-warn')) openSheet('warn', t.getAttribute('data-warn'));
    else if (a === 'prev') shiftMonth(-1);
    else if (a === 'next') shiftMonth(1);
    else if (t.hasAttribute('data-theme')) { window.CSTheme.set(t.getAttribute('data-theme')); renderMore(); }
  });
  // Reminder and pay-rate forms: remember what is typed (a refresh must not lose it) without redrawing under the keyboard.
  document.addEventListener('input', function (ev) {
    var id = ev.target && ev.target.id, a = state.add, f = state.rateForm;
    if (id === 'sr-q') { state.H_q = ev.target.value; H_searchDraw(); }
    if (state.sheet && id === 'df-label') state.sheet.form.label = ev.target.value; else if (state.sheet && id === 'df-kind') state.sheet.form.kind = ev.target.value;
    if (state.reply && id === 'rp-text') { state.reply.text = ev.target.value; state.reply.err = ''; } else if (state.reply && id === 'rp-name') state.reply.name = ev.target.value;
    var na = state.nadd; if (na && /^n-(type|title|date|start|hours|detail)$/.test(id || '')) { na[{ 'n-type': 'type', 'n-title': 'title', 'n-date': 'date', 'n-start': 'start', 'n-hours': 'hours', 'n-detail': 'detail' }[id]] = ev.target.value; na.err = ''; }
    if (a && id === 't-title') a.title = ev.target.value; else if (a && id === 't-due') a.due = ev.target.value; else if (a && id === 't-note') a.note = ev.target.value; else if (a && id === 't-who') a.who = ev.target.value;
    else if (f && /^r-(from|regular|general|transport|note)$/.test(id || '')) { f[id.slice(2)] = ev.target.value; f.err = ''; syncRate(); }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'rp-file') { var f0 = ev.target.files && ev.target.files[0]; if (f0) pickShot(f0); return; }
    if (ev.target && ev.target.id === 'n-type' && state.nadd) { if (ev.target.value) { state.nadd.type = ev.target.value; A_noticeAddDraw(); } return; }
    if (ev.target && ev.target.id === 'df-kind' && state.sheet) { state.sheet.form.kind = ev.target.value; return; }
    if (ev.target && ev.target.id === 't-who' && state.add) state.add.who = ev.target.value;
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { H_idClose(); if (state.sheet) E_tryClose(); } });
  // Telegram: the tg:// link opens the app. If the page is still in front ~1.2 s later the app did not open, so t.me opens instead.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-tgweb]'), web = a && a.getAttribute('data-tgweb'); if (!web) return;
    // An app chooser or "Open Telegram?" prompt blurs the page without hiding it: that counts as left too, so nothing opens twice.
    var left = false, gone = function (e) { if (e.type === 'blur' || document.visibilityState === 'hidden') left = true; };
    document.addEventListener('visibilitychange', gone); window.addEventListener('pagehide', gone); window.addEventListener('blur', gone);
    setTimeout(function () {
      document.removeEventListener('visibilitychange', gone); window.removeEventListener('pagehide', gone); window.removeEventListener('blur', gone);
      if (left || document.visibilityState !== 'visible') return;
      var w = window.open(web, '_blank'); if (w) { w.opener = null; return; }
      // Pop-up blocked: never navigate the app away; the link itself becomes the web link with a line saying so.
      a.setAttribute('href', web); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.removeAttribute('data-tgweb');
      if (!a.nextElementSibling || !a.nextElementSibling.classList.contains('tgnote')) a.insertAdjacentHTML('afterend', '<span class="help tgnote" role="status">Telegram did not open. Tap again to open it in the browser.</span>');
    }, 1200);
  });
  // Gestures (E_): four swipes, each through the one helper CS.E_drag, each with a visible tap twin on the same screen. The thresholds live in lib.js.
  var E_drag = CS.E_drag;
  function E_tr(el, ms) { if (el && el.style) el.style.transition = ms && !E_reduced() ? 'transform ' + ms + 'ms ease-out, opacity ' + ms + 'ms ease-out' : 'none'; }
  // G4. Slide to start cleaning: 70% of the travel, or a fast flick after 40% of it. The knob follows the finger 1:1 and returns over 200 ms.
  (function A_slideInit() {
    var t0 = 1, travel = function () { return t0; }; // measured once when the drag starts: a redrawn (detached) pill must never read 0 and commit
    E_drag(document, { sel: '[data-slide]', axis: 'x', vw: E_vw, reduced: E_reduced, start: function (a) { t0 = Math.max(1, a.offsetWidth - 56); },
      move: function (a, d) { var k = a.querySelector('.knob'); if (k) { E_tr(k, 0); k.style.transform = 'translateX(' + Math.max(0, Math.min(travel(a), d.dx)) + 'px)'; } },
      reached: function (a, d) { return d.dx >= travel(a) * 0.7; },
      onEdge: function () { E_vibe('edge'); },
      end: function (a, d) {
        var k = a.querySelector('.knob'), go = CS.E_slideCommit(Math.max(0, d.dx), travel(a), d.vx);
        if (k) { E_tr(k, 200); k.style.transform = ''; }
        if (go) { E_vibe('tap'); if (a.getAttribute('target') === '_blank') window.open(a.href, '_blank', 'noopener'); else location.hash = a.getAttribute('href'); }
      },
      cancel: function (a) { var k = a.querySelector('.knob'); if (k) { E_tr(k, 200); k.style.transform = ''; } } });
  })();
  // G2. Pull a bottom sheet down: the grab strip at its top, or its body when scrolled to the top. A form with something typed in it springs back.
  (function E_sheetPull() {
    var scrim = function () { return $('cal-scrim'); };
    E_drag(document, { sel: '#cal-sheet', axis: 'y', vw: E_vw, reduced: E_reduced,
      canStart: function (el, ev) { return !!state.sheet && F_bottomSheet() && !!(ev.target.closest && ev.target.closest('.E_grab, .F_sheethead')); }, // the whole 56 px header is the pull surface; a finger on the body is the body's to scroll
      move: function (el, d) {
        E_tr(el, 0); el.style.transform = 'translateY(' + CS.E_sheetFollow(d.dy) + 'px)';
        var sc = scrim(); if (sc && sc.style) sc.style.opacity = String(Math.max(0, 1 - Math.max(0, d.dy) / Math.max(1, el.offsetHeight || 400)));
      },
      reached: function (el, d) { return d.dy >= 80; },
      onEdge: function () { E_vibe('edge'); },
      end: function (el, d) {
        var S = state.sheet, wants = !!S && CS.E_sheetCommit(d.dy, d.vy), close = wants && !E_dirty();
        E_sheetReset(el, scrim()); // back to the stylesheet: it springs home over --v5-sheet-ms, or carries on out if the sheet closes
        if (wants && !close) E_keep(); // typed text: it springs back and says how to leave
        if (!close) return;
        if (S.kind === 'add') state.add = null; else if (S.kind === 'nadd') state.nadd = null;
        closeSheet();
      },
      cancel: function (el) { E_sheetReset(el, scrim()); } });
  })();
  // G3. Task row: swipe left to mark done (Undo on a finished row). a third of the row (110 px at most), or a fast flick, takes the same path as the box; a shorter swipe past
  // 48 px leaves the row open on its real button. A system check row only ever opens its "Mark as handled" button.
  (function E_taskSwipe() {
    var openW = function (el) { return parseInt(el.getAttribute('data-E-w'), 10) || 96; };
    function shut(el) { var w = el.parentNode; if (w && w.classList) { w.classList.remove('E_open'); setTimeout(function () { if (!w.classList.contains('E_open')) w.classList.remove('E_live'); }, 220); } E_tr(el, 200); el.style.transform = ''; }
    function shutAll(except) { Array.prototype.forEach.call(document.querySelectorAll('.E_swipewrap.E_open'), function (w) { var r = w.querySelector('.taskrow'); if (r && r !== except) shut(r); }); }
    E_drag(document, { sel: '.taskrow[data-E-swipe]', axis: 'x', vw: E_vw, reduced: E_reduced, edgeR: CS.E_EDGE_R_TASK,
      start: function (el) { shutAll(el); if (el.parentNode && el.parentNode.classList) el.parentNode.classList.add('E_live'); },
      move: function (el, d) { E_tr(el, 0); el.style.transform = 'translateX(' + (-CS.E_taskFollow(d.dx, openW(el))) + 'px)'; },
      reached: function (el, d) { return el.getAttribute('data-E-verifier') !== '1' && -d.dx >= CS.E_taskDist(el.offsetWidth || 360); },
      onEdge: function () { E_vibe('edge'); },
      end: function (el, d) {
        var ver = el.getAttribute('data-E-verifier') === '1', commit = CS.E_taskCommit(d.dx, el.offsetWidth || 360, d.vx);
        if (!ver && commit) { shut(el); try { var lsw = store('localStorage'); if (lsw) lsw.setItem('cs_swiped', '1'); } catch (e) {} setTaskDone(el.getAttribute('data-task'), el.getAttribute('data-E-swipe') === 'task-done'); }
        else if (commit || CS.E_taskOpens(d.dx)) { E_tr(el, 200); el.style.transform = ''; if (el.parentNode && el.parentNode.classList) el.parentNode.classList.add('E_open'); }
        else shut(el);
      },
      cancel: function (el) { shut(el); } });
    document.addEventListener('pointerdown', function (ev) { // a touch anywhere else closes an open row
      var w = ev.target && ev.target.closest ? ev.target.closest('.E_swipewrap') : null; if (!w || !w.classList || !w.classList.contains('E_open')) shutAll(null);
    });
  })();
  // G1. The month grid: swipe left for the next month, right for the previous one. The arrows above the grid are the tap twin. The sub-tabs (Calendar | Notices) are tap only.
  (function H_monthSwipe() {
    var dirOf = function (d) { return d.dx < 0 ? 1 : -1; };
    E_drag(document, { sel: '.cal', axis: 'x', vw: E_vw, reduced: E_reduced,
      canStart: function () { return current === 'calendar' && state.calTab === 'calendar' && !state.sheet && !!state.payload; },
      move: function (el, d) {
        var f = monthStep(dirOf(d)) ? CS.E_tabFollow(d.dx) : 0; E_tr(el, 0); el.style.transform = 'translateX(' + f + 'px)'; el.style.opacity = String(1 - 0.15 * Math.abs(f) / 96);
      },
      reached: function (el, d) { return !!monthStep(dirOf(d)) && CS.E_tabCommit(d.dx, el.offsetWidth || E_vw(), 0); },
      onEdge: function () { E_vibe('edge'); },
      end: function (el, d) {
        E_tr(el, 160); el.style.transform = ''; el.style.opacity = '';
        if (CS.E_tabCommit(d.dx, el.offsetWidth || E_vw(), d.vx) && shiftMonth(dirOf(d), true)) E_vibe('tap');
      },
      cancel: function (el) { E_tr(el, 160); el.style.transform = ''; el.style.opacity = ''; } });
    var hashOf = function (t) { return t === 'calendar' ? '#calendar' : '#calendar/' + t; };
    document.addEventListener('keydown', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('.A_tabs a[data-tab]') : null; if (!a || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
      var nb = CS.E_tabNeighbour(a.getAttribute('data-tab'), ev.key === 'ArrowRight' ? 1 : -1); if (!nb) return;
      ev.preventDefault(); E_tabFocus = true; location.hash = hashOf(nb);
    });
  })();
  // G5. The day sheet: swipe left for the next day, right for the previous one; the two arrows in its header are the tap twin. The body follows the finger, the title fades.
  (function H_daySwipe() {
    var dirOf = function (d) { return d.dx < 0 ? 1 : -1; }, body = function () { return $('cs-body'); };
    var rest = function (b, ms) { if (b) { E_tr(b, ms); b.style.transform = ''; b.style.opacity = ''; } };
    E_drag(document, { sel: '#cal-sheet', axis: 'x', vw: E_vw, reduced: E_reduced,
      canStart: function () { return !!state.sheet && state.sheet.kind === 'day' && !!state.payload; },
      move: function (el, d) {
        var b = body(), f = CS.H_dayStep(state.sheet.key, dirOf(d), state.payload.today) ? CS.E_tabFollow(d.dx) : 0; if (b) { E_tr(b, 0); b.style.transform = 'translateX(' + f + 'px)'; b.style.opacity = String(1 - 0.15 * Math.abs(f) / 96); }
      },
      reached: function (el, d) { return !!state.sheet && !!CS.H_dayStep(state.sheet.key, dirOf(d), state.payload.today) && CS.E_tabCommit(d.dx, el.offsetWidth || E_vw(), 0); },
      onEdge: function () { E_vibe('edge'); },
      end: function (el, d) { rest(body(), 160); if (CS.E_tabCommit(d.dx, el.offsetWidth || E_vw(), d.vx)) H_dayGo(dirOf(d), true); },
      cancel: function () { rest(body(), 160); } });
  })();
  window.addEventListener('hashchange', route);
  // MF8: no queue. A strip says the screen is the last one that loaded; a write tapped offline says so under its own row.
  function H_offlineSync() {
    var el = $('H_offline'); if (!el) return;
    var off = !!state.layout && current !== 'door' && (navigator.onLine === false || (!!state.error && state.errorKind === 'network' && !!state.payload));
    el.hidden = !off; if (off) el.textContent = 'No connection' + (state.loadedAt ? ' · showing ' + CS.clockLabel(new Date(state.loadedAt).toISOString()) : '');
    if (!off && state.H_offKey) { state.H_offKey = ''; if (current === 'tasks') renderTasks(); }
  }
  window.addEventListener('online', function () { H_offlineSync(); if (state.layout) { loadHome(); loadTasks(); } }); window.addEventListener('offline', H_offlineSync);
  window.addEventListener('scroll', function () { var b = document.querySelector('.view.on .appbar'); if (b) b.classList.toggle('scrolled', window.scrollY > 8); }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.layout && Date.now() - state.loadedAt > 60000) { loadHome(); loadTasks(); }
  });

  // ---------------------------------------------------------------- install: iOS hint once, Android install button
  var deferredPrompt = null;
  var ua = navigator.userAgent || '', isIOS = /iphone|ipad|ipod/i.test(ua), standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; syncInstall(); });
  window.addEventListener('appinstalled', function () { deferredPrompt = null; syncInstall(); });
  function syncInstall() {
    var card = $('install-card'), btn = $('install-btn'); if (!card) return;
    card.hidden = standalone; // no prompt and not an iPhone: the card still shows, and links to the install page (it says what this browser can do)
    var lnk = $('install-link'); if (lnk) lnk.hidden = !!(deferredPrompt || isIOS); if (btn) btn.hidden = !(deferredPrompt || isIOS);
    if (btn) btn.onclick = function () {
      if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; syncInstall(); }); }
      else showA2hs();
    };
  }
  function seen() { if (DEMO) return true; try { return !!localStorage.getItem('cs_a2hs_seen'); } catch (e) { return false; } }
  // Inside Messenger, Facebook, Instagram, Gmail and the like an iPhone cannot add to the Home Screen: show "Open in Safari" (this same address, ?team= kept) instead of the steps.
  var inApp = isIOS && CS.isInAppBrowser(ua);
  function showA2hs() {
    var link = CS.pageLink(location), b = inApp ? CS.openInBrowserLink(ua, link) : null;
    $('a2hs-steps').hidden = inApp; $('a2hs-inapp').hidden = !inApp;
    if (inApp) { $('a2hs-h').textContent = 'Open Cascade Staff in Safari'; $('a2hs-open').hidden = !b; if (b) { $('a2hs-open').href = b.href; $('a2hs-open').textContent = b.label; } $('a2hs-copy').setAttribute('data-copy', link); }
    $('a2hs-share').innerHTML = ICON('share'); $('a2hs-share2').innerHTML = ICON('share'); $('a2hs').classList.add('on'); $('a2hs').setAttribute('aria-hidden', 'false'); $('a2hs-scrim').classList.add('on'); }
  function hideA2hs() { $('a2hs').classList.remove('on'); $('a2hs').setAttribute('aria-hidden', 'true'); $('a2hs-scrim').classList.remove('on'); if (!DEMO) try { localStorage.setItem('cs_a2hs_seen', '1'); } catch (e) {} }
  function maybeIosHint() { if (isIOS && !standalone && !seen()) setTimeout(showA2hs, 800); }
  $('a2hs-ok').addEventListener('click', hideA2hs); $('a2hs-scrim').addEventListener('click', hideA2hs);

  if (!DEMO && 'serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  // Which sibling surfaces are folded into this deployment? Read once, network-first (no-store); 404 or offline-without-cache = none folded.
  if (DEMO) applyFold(null);
  else if (typeof window.fetch === 'function') window.fetch('./fold-manifest.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    .then(function (m) { applyFold(m); if (state.layout && current !== 'door') render(current); });
  if (!DEMO && typeof window.fetch !== 'function') applyFold(null);
  boot();
})();
