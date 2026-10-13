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
    version: '3.0.0'
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
    pay: './pay/'
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
  function applyFold(manifest) { // pure over DOORS: folded relative url where the surface exists, else the fallback again
    var f = CS.foldedDoorUrls(manifest);
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

  var state = { access: null, user: null, name: '', layout: null, payload: null, loadedAt: 0, loading: false, error: '', month: null, payHint: null, photos: {},
    notices: null, noticesAbsent: false, noticesLoading: false, noticeFilter: 'all', nadd: null, fbOpen: false, ratesMore: false, calTab: 'month', taskFilter: 'all', hubRoute: '', tasks: null, tasksErr: '', tasksLoading: false, showDone: false, lastDone: null, add: null, assignees: null, rates: null, ratesErr: '', rateForm: null, rateSaving: false, reply: null, bookings: null, bookingsDone: false, noticesDone: false };
  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['signin', 'home', 'calendar', 'tasks', 'payrates', 'more', 'door', 'reply', 'hub'];
  function pid() { return (state.access && state.access.property_ids && state.access.property_ids[0]) || CFG.propertyId; }
  function canReply() { return CS.canDraftReply(state.access && state.access.role); }

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
    if (opts.door) { var dl = CS.doorLink(opts.door, doorDef(opts.door).url, location.origin, trustOn); opts.href = dl.href; opts.external = dl.external; }
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
    var d = doorDef('dashboard'); if (!d || !CS.A_hubRouteOk(route)) return null;
    if (CS.doorFramed('dashboard', state.layout, trustOn) && CS.doorTarget(d.url, location.origin) === 'frame') return { href: '#door/dashboard/' + route, external: false };
    return { href: CS.A_hubDoorUrl(d.url, route), external: true };
  }
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
  function warnCount() { return state.payload ? (state.payload.warnings || []).length : 0; }
  function errBanner() {
    return state.error ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.error) + ' <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>' : '';
  }

  // ---------------------------------------------------------------- tab bar
  function renderTabs(current) {
    var staff = state.layout === 'staff', due = state.tasks ? CS.taskDueCount(state.tasks.tasks, state.tasks.today) : 0;
    var late = state.tasks ? state.tasks.tasks.some(function (t) { return t.status !== 'done' && CS.taskDue(t.due_at, state.tasks.today) === 'overdue'; }) : false; // red only when something is overdue
    var tabs = [['home', '#home', staff ? 'Today' : 'Home', 'house'], ['calendar', '#calendar', 'Calendar', 'calendar', warnCount()],
      ['tasks', '#tasks', 'Tasks', 'tasks', due], ['more', '#more', 'More', 'more']];
    $('tabbar').innerHTML = tabs.map(function (t) {
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
  function A_notices() { return state.notices; }
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
    return { role: role(), today: p ? p.today : CS.manilaToday(), error: !!state.error, lastAt: state.loadedAt ? new Date(state.loadedAt).toISOString() : '',
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
  // The photo header: wordmark, the pill, refresh, greeting, date and weather (as of HH:MM when the weather is old). Drawn before the first answer too.
  function A_hero() {
    var p = state.payload, c = p && p.weather && p.weather.current, nm = CS.greetingName(state.user), stale = p && p.weather && p.weather.fetched_at && CS.weatherStale(p.weather) ? ' · as of ' + CS.clockLabel(p.weather.fetched_at) : '';
    var wx = c && c.temp != null ? ICON('cloud', 's16') + esc(Math.round(+c.temp) + '° ' + String(c.description || '').toLowerCase() + stale) : '';
    return '<div class="A_hero"><img src="img/house-hero.webp" alt="" width="720" height="480" fetchpriority="high"><div class="A_herobar"><span class="brand">Cascade</span><div class="A_herorow">' + E_pill(E_att()) +
      '<button class="A_chipglass" type="button" data-act="refresh" aria-label="Refresh">' + ICON('refresh', 's24') + '</button></div></div>' +
      '<div class="A_greet"><h1>' + esc(CS.greeting() + (nm ? ', ' + nm : '')) + '</h1><div class="cap">' + esc(CS.dayLong(p ? p.today : CS.manilaToday())) + (wx ? '<span aria-hidden="true">·</span>' + wx : '') + '</div></div></div>';
  }
  // Sign out lives on More only (a wet-hand mis-tap away from the tab bar); the footer says how fresh the screen is.
  function footerLine() { return '<div class="help F_span" style="text-align:center;margin-top:16px">Updated ' + esc(state.loadedAt ? CS.agoLabel(new Date(state.loadedAt).toISOString()) : 'just now') + ' · v' + CFG.version + '</div>'; }

  // The turnover: guest out, clean, guest in, against the 12:00 noon to 2:00 pm window. Slide (or tap) to start opens the checklist door; no second PIN from here.
  function A_slideStart() {
    var d = doorDef('checklist'); if (!d || !CS.doorAllowed('checklist', role())) return '';
    var dl = CS.doorLink('checklist', d.url, location.origin, trustOn);
    return '<a class="A_slide" data-slide href="' + esc(dl.href) + '"' + (dl.external ? ' target="_blank" rel="noopener"' : '') + ' aria-label="Start cleaning"><span class="knob">' + ICON('slide', 's24') + '</span><span class="txt">Slide to start cleaning</span></a>';
  }
  function A_turnoverCard(staff) {
    var p = state.payload, T = A_houseT(), clock = CS.A_turnoverClock(new Date(), T), ds = dayStatusOf(p.today), outToday = !!ds.out, inToday = !!ds.arrive;
    if (!outToday && !inToday) {
      var nx = staysOf().filter(function (st) { return st.checkout_date > p.today; })[0];
      var nextOut = nx ? 'Next guest out ' + CS.dayLabel(nx.checkout_date) + ', ' + T.outLabel + '.' : 'Nothing is booked to leave soon.';
      return '<section class="card glass A_card" aria-label="Turnover today"><span class="cap up">Turnover today</span><p class="sub" style="margin:0">No turnover today. ' + esc(nextOut) + '</p></section>';
    }
    var win = clock.phase === 'window', closed = clock.phase === 'after';
    var steps = '<div class="A_steps">' +
      '<div><span class="dot">' + ICON('logout', 's16') + '</span><span>Guest out</span><b>' + esc(outToday ? T.outLabel : 'None today') + '</b></div>' +
      '<div class="' + (win ? 'now' : '') + '"><span class="dot">' + ICON('sparkles', 's16') + '</span><span>Clean</span><b>' + esc(closed ? 'Closed' : win ? 'Until ' + CS.A_shortTime(T.check_in) : 'From ' + CS.A_shortTime(T.check_out)) + '</b></div>' +
      '<div><span class="dot">' + ICON('user', 's16') + '</span><span>Guest in</span><b>' + esc(inToday ? T.inLabel : 'None today') + '</b></div></div>';
    return '<section class="card glass A_card" aria-label="Turnover today"><div class="row-between"><span class="cap up">Turnover today</span><span class="sub num" style="font-size:15px">' + esc(CS.A_turnoverLine(clock, inToday)) + '</span></div>' +
      steps + (staff ? A_slideStart() : '') + '</section>';
  }
  // Notices card: reads notices_v1. Absent RPC = no card. While the first read is out, a reserved block holds the place.
  function A_noticesCard() {
    var v = A_notices();
    if (state.noticesAbsent) return '';
    var loading = !v && state.noticesLoading, items = v ? v.all.slice(0, 2) : [], body;
    if (!v) body = loading ? '<div class="skel" style="height:72px"></div>' : '<p class="sub" style="margin:0">No connection. <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></p>';
    else body = items.length ? '<div class="A_nlist">' + items.map(function (n) { return row({ icon: A_noticeIcon(n.type), tile: n.type, title: n.title, sub: n.sub, href: '#calendar/notices', hint: n.title + (n.sub ? ' · ' + n.sub : '') }); }).join('') + '</div>' : '<p class="sub" style="margin:0">No notices. Nothing to plan around.</p>';
    return '<section class="card glass A_card A_noticecard" aria-label="Notices"' + (loading ? ' aria-busy="true"' : '') + '><div class="A_head"><h2>Notices</h2>' + (v ? '<a href="#calendar/notices">' + (v.counts.all ? 'See all ' + v.counts.all : 'Open') + ICON('chev', 's16') + '</a>' : '') + '</div>' + body + '</section>';
  }
  function A_noticeIcon(type) { return type === 'house' ? 'house' : (CS.A_NOTICE_TYPES[type] || CS.A_NOTICE_TYPES.note).icon; }
  // F_: a label and its card travel as one grid item (F_group), so a two-column grid never splits them
  function A_navCard(label, rows) { return rows ? '<div class="F_group"><div class="A_label">' + esc(label) + '</div><nav class="card glass list" aria-label="' + esc(label) + '">' + rows + '</nav></div>' : ''; }
  function renderHome() {
    var el = $('v-home');
    if (!state.payload) { el.innerHTML = A_hero() + '<div class="screen" style="min-height:0;padding-top:0"><div class="A_body">' + (state.error ? errBanner() : loadingBlock()) + '</div></div>'; return; }
    var staff = state.layout === 'staff', n = warnCount(), v = A_notices();
    var body;
    if (staff) {
      // Today, Turnover, the paid notice (under Turnover: Turnover and Slide to start never move when it lands), Notices, then the doors
      body = '<div class="A_body">' + errBanner() + todayCard() + A_turnoverCard(true) + '<div id="slot-paid-notice" class="A_slot" hidden></div>' + A_noticesCard() +
        A_navCard('Work', doorRow('checklist', 'clip', 'Start or continue today’s turnover') +
          (LINKS.pay ? row({ icon: 'cash', title: 'Ask for your pay', sub: state.payHint || 'Ask for your cleaning pay', href: LINKS.pay, subId: 'pay-sub' }) : '') +
          row({ icon: 'calendar', title: 'Calendar', sub: 'Who is staying, who is next', href: '#calendar', count: n || '' })) +
        A_navCard('Ask Cassy', row({ icon: 'chat', title: 'Cassy · OPS', sub: 'Report, ask, log an expense', tg: LINKS.tgOps, external: true }) +
          row({ icon: 'help', title: 'Quick guide', sub: 'Two minutes on telling Cassy what happened', href: LINKS.quick })) + footerLine() + '</div>';
    } else {
      var bk = CS.bookingsToConfirmRow(role(), state.bookings, A_hubLink('bookings/inquiries')), conv = A_hubLink('guests/conversations'), inbox = v ? v.inbox : null;
      // only owner and admin have an inbox; the reserve is kept while notices load, and dropped on failure, when absent, and for finance
      var inboxShown = !!conv && CS.canSeeGuestContact(role()) && !state.noticesAbsent && (v ? inbox != null : state.noticesLoading);
      body = '<div class="A_body">' + errBanner() + todayCard() + A_turnoverCard(false) + A_noticesCard() +
        A_navCard('Guests and bookings', (bk ? row({ icon: 'clip', title: 'Bookings to confirm', sub: 'Open the pending bookings', href: bk.href, external: bk.external, count: bk.count, countLabel: bk.n === 1 ? ' booking to confirm' : ' bookings to confirm' }) : '') +
          row({ icon: 'calendar', title: 'Calendar', sub: 'Stays, blocked nights, notices', href: '#calendar', count: n || '' }) +
          '<div id="slot-inbox"' + (inboxShown ? '' : ' hidden') + (inboxShown && !v ? ' style="min-height:64px"' : '') + '>' + (inboxShown && v ? row({ icon: 'chat', title: 'Inbox', sub: inbox ? inbox + ' open' : 'No open messages', href: conv.href, external: conv.external, count: inbox || '', countLabel: ' open messages' }) : '') + '</div>' +
          (canReply() ? row({ icon: 'sparkles', title: 'Cassy reply', sub: 'Draft a warm reply to a guest message', href: '#reply' }) : '')) +
        A_navCard('Admin', row({ icon: 'dash', title: 'Admin dashboard', sub: 'Today, bookings, money, operations', door: 'dashboard' }) +
          (trustOn ? '' : '<div class="help doornote">Sign-in is kept only on trusted devices</div>') +
          (/^(owner|admin|finance)$/.test(role() || '') ? row({ icon: 'wallet', title: 'Pay staff', sub: 'Pay a request by QR, then add the proof', href: './pay/admin.html' }) : '') +
          (CS.canEditRates(role()) ? row({ icon: 'cash', title: 'Pay rates', sub: 'What a clean and its transport pay', href: '#payrates' }) : '') + doorRow('inventory', 'box', 'Stock levels and usage')) + footerLine() + '</div>';
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
      (canReply() && g.uid ? '<a class="btn btn-secondary btn-sm" href="./guest/#' + encodeURIComponent(g.uid) + '" style="margin-top:12px">' + ICON('idcard', 's16') + 'Add guest details</a>' : '') + '</div>';
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
    var addId = canReply() && g.uid ? './guest/?for=id#' + encodeURIComponent(g.uid) : '';
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
  function toast(msg, act) {
    var t = $('cs-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cs-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    if (act) { t.innerHTML = '<span>' + esc(msg) + '</span><button class="btn btn-ghost btn-sm E_toastbtn" type="button" data-act="' + esc(act.act) + '" data-task="' + esc(act.task) + '" aria-label="' + esc(act.label || act.text) + '">' + esc(act.text) + '</button>'; t.classList.add('E_hasact'); }
    else { t.textContent = msg; t.classList.remove('E_hasact'); }
    t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); t.classList.remove('E_hasact'); t.textContent = ''; }, act ? 5000 : 2000);
  }

  // The ID photo comes from the private guest-id-photos bucket through a 5-minute signed URL made with the user's own session
  // (a storage policy lets staff read only the current and next guest's photo). It is fetched with no-store and shown from memory:
  // no download link, no disk cache, gone on reload.
  function loadIdPhotos(root) {
    root.querySelectorAll('[data-idpath]').forEach(function (box) {
      var path = box.getAttribute('data-idpath'), hit = state.photos[path];
      if (hit && Date.now() - hit.at < 4 * 60000) { putPhoto(box, hit.url); return; }
      sb.storage.from('guest-id-photos').createSignedUrl(path, 300).then(function (r) {
        if (r.error || !r.data) throw new Error('sign');
        return net(r.data.signedUrl, { cache: 'no-store', referrerPolicy: 'no-referrer' });
      }).then(function (res) { if (!res.ok) throw new Error('fetch'); return res.blob(); }).then(function (blob) {
        if (hit) URL.revokeObjectURL(hit.url);
        var url = URL.createObjectURL(blob); state.photos[path] = { url: url, at: Date.now() }; putPhoto(box, url);
      }).catch(function () {
        box.className = 'idphoto empty'; box.innerHTML = 'The photo could not be loaded. <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button>';
      });
    });
  }
  function putPhoto(box, url) {
    box.innerHTML = ''; var img = new Image(); img.src = url; img.alt = 'Guest ID photo'; img.draggable = false;
    img.addEventListener('contextmenu', function (e) { e.preventDefault(); }); box.appendChild(img);
  }
  function dropPhotos() { Object.keys(state.photos).forEach(function (k) { URL.revokeObjectURL(state.photos[k].url); }); state.photos = {}; }

  // ---------------------------------------------------------------- Guest Calendar Info
  function monthState() {
    var t = state.payload.today, p = t.split('-');
    if (!state.month) state.month = { y: +p[0], m: +p[1] };
    return state.month;
  }
  function shiftMonth(d) {
    var m = monthState(), y = m.y, mm = m.m + d;
    if (mm < 1) { mm = 12; y--; } if (mm > 12) { mm = 1; y++; }
    if (!CS.monthInRange(y, mm, state.payload.today)) return;
    state.month = { y: y, m: mm }; renderCalendar();
  }
  var FLAG_ICON = { brownout: 'zap', maintenance: 'wrench', deep_clean: 'sparkles', other: 'note' };
  var BLOCK_ICON = { brownout: 'zapoff', maintenance: 'wrench', deep_clean: 'sparkles', owner: 'house', direct: 'calendar' };
  // The merged stays (same guest on two rows = one stay, D-320), worked out once per payload.
  var staysMemo = { p: null, list: [] };
  function staysOf() { var p = state.payload; if (staysMemo.p !== p) staysMemo = { p: p, list: CS.mergeStays(p.calendar || []) }; return staysMemo.list; }
  function dayStatusOf(iso) { var p = state.payload; return CS.dayStatus(iso, p.calendar || [], p.day_flags, p.warnings, staysOf()); }
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
      var ds = info[i], booked = ds.primary === 'booked', blk = ds.primary === 'blocked', col = i % 7;
      if (ds.turnover) monthHas.turn = true; if (ds.clash.length) monthHas.clash = true;
      var cls = 'd s-' + ds.primary + (c.iso < p.today ? ' past' : '') + (c.iso === p.today ? ' today' : '') + (booked ? ' stay' : '') + (booked && ds.cont ? ' cont' : '') + (blk ? ' blk' : '') +
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
      var moves = CS.dayMoves(ds), night = booked ? (ds.arrive ? 'booked' : 'booked, ' + ds.why) : blk ? 'blocked, ' + ds.why : 'free', nd = CS.A_noticeDay(view, c.iso);
      var label = CS.dayLong(c.iso) + (c.iso === p.today ? ', today' : '') + (ds.turnover ? ', turnover' : '') + (moves ? ', ' + moves : '') + ', ' + night +
        (ds.clash.length ? ', clash with ' + ds.clash.map(function (s) { return s.guest_name || 'another guest'; }).join(', ') : '') +
        (ds.flags.filter(function (f) { return !CS.A_flagDup(f, nd); }).length ? '; ' + ds.flags.filter(function (f) { return !CS.A_flagDup(f, nd); }).map(function (f) { return CS.flagName(f.kind); }).join(', ') : '') + (nd.length ? '; ' + nd.map(function (x) { return x.title; }).join(', ') : '');
      return '<button class="' + cls + '" type="button" style="' + A_shadeOf(ds.out || ds.stay) + '" data-day="' + c.iso + '" aria-label="' + esc(label) + '" aria-haspopup="dialog">' + inner + '</button>';
    }).join('');
    return '<div class="cal" role="group" aria-label="' + esc(CS.monthTitle(m.y, m.m)) + '">' + dows + body + '</div>';
  }
  // Legend chips ABOVE the grid; they wrap onto a second row on a narrow phone (nothing scrolls sideways).
  function legend() {
    var sw = function (css, t) { return '<span><i class="A_sw" style="' + css + '"></i>' + t + '</span>'; };
    var mk = function (k) { return '<span><i class="A_mk ' + k + ' A_sw" style="display:inline-flex;align-items:center;justify-content:center">' + ICON(MARK_ICON[k], 's12') + '</i>' + MARK_WORD[k] + '</span>'; };
    return '<div class="A_legend" role="group" aria-label="Legend">' +
      sw('background:var(--v5-surf);border:1px solid var(--v5-cal-free-edge)', 'Free') + sw('background:var(--v5-g1)', 'Booked') +
      sw('background:repeating-linear-gradient(135deg,transparent 0 3px,var(--v5-cal-hatch) 3px 5px),var(--v5-cal-blocked)', 'Blocked') +
      (monthHas.turn ? sw('background:linear-gradient(135deg,var(--v5-g1) 50%,var(--v5-g3) 50%)', 'Turnover') : '') +
      (monthHas.clash ? sw('background:var(--v5-danger-w);box-shadow:inset 0 0 0 2px var(--v5-cal-clash-ring)', 'Clash') : '') +
      sw('background:var(--v5-surf);box-shadow:inset 0 0 0 2px var(--v5-gold)', 'Today') +
      Object.keys(MARK_ICON).filter(function (k) { return monthHas.marks[k]; }).map(mk).join('') + '</div>';
  }
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
    var t = [['month', '#calendar', 'Month'], ['stays', '#calendar/stays', 'Stays'], ['notices', '#calendar/notices', 'Notices']];
    return '<nav class="A_tabs card glass" aria-label="View">' + t.map(function (x) { return '<a href="' + x[1] + '" data-act="cal-tab" data-tab="' + x[0] + '"' + (x[0] === cur ? ' aria-current="page"' : '') + '>' + x[2] + '</a>'; }).join('') + '</nav>';
  }
  function calMonth() {
    var p = state.payload, m = monthState();
    var prevOk = CS.monthInRange(m.m === 1 ? m.y - 1 : m.y, m.m === 1 ? 12 : m.m - 1, p.today), nextOk = CS.monthInRange(m.m === 12 ? m.y + 1 : m.y, m.m === 12 ? 1 : m.m + 1, p.today);
    var grid = calendarGrid();
    return '<div class="calhdr"><button class="iconbtn" type="button" data-act="prev" aria-label="Previous month"' + (prevOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('back', 's24') + '</button><h2 class="dlg">' + esc(CS.monthTitle(m.y, m.m)) + '</h2><button class="iconbtn" type="button" data-act="next" aria-label="Next month"' + (nextOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('chev', 's24') + '</button></div>' +
      legend() + grid + '<p class="help" style="text-align:center;margin-top:10px">Tap a day to see who is staying and what is planned.</p>';
  }
  function calStays() {
    var p = state.payload, rows = p.calendar || [];
    var confirmedAll = staysOf(), upcoming = confirmedAll.filter(function (r) { return r.checkout_date >= p.today; }).slice(0, 10), blocked = CS.blockedLines(rows, p.today), html = '';
    // the guest card carries its own IN THE HOUSE / NEXT ARRIVAL cap; the section cap only labels the empty cards, which have none
    html += '<div class="sect">' + (p.current_guest ? '<div class="stack">' + guestBlock(p.current_guest, 'house') + '</div>' : '<span class="cap up">In the house</span><div class="card glass"><p class="sub">No guest in the house tonight.</p></div>') + '</div>';
    html += '<div class="sect">' + (p.next_guest ? '<div class="stack">' + guestBlock(p.next_guest, 'next') + '</div>' : '<span class="cap up">Next arrival</span><div class="card glass"><p class="sub">No arrival in the next 60 days.</p></div>') + '</div>';
    if (upcoming.length) {
      html += '<div class="sect"><span class="cap up">Coming up</span><div class="stack">' + upcoming.map(function (r) {
        var i = confirmedAll.indexOf(r), src = CS.sourceLabel(r.source), joined = r.rows.length > 1 ? r.rows.length + ' bookings shown as one stay' : '';
        return '<div class="card glass staycard" id="stay-' + i + '" style="' + CS.A_stayShade(i).replace(/--A_g:var\(([^)]+)\);.*/, 'border-left:6px solid var($1)') + '"><div class="strong">' + esc(r.guest_name || 'Guest') + (src ? ' · ' + esc(src) : '') + '</div><div class="sub num" style="font-size:15px;line-height:20px">' + esc(CS.stayDates(r)) + '</div>' +
          (joined ? '<div class="help">' + esc(joined) + '</div>' : '') + '</div>';
      }).join('') + '</div></div>';
    }
    if (blocked.length) {
      html += '<div class="sect"><span class="cap up">Blocked nights</span><ul class="wlist">' + blocked.map(function (l) {
        return '<li>' + ICON(l.extra ? 'alert' : 'lock').replace('class="i"', 'class="i ' + (l.extra ? 'c-warn' : 'c-fg2') + '"') + '<span class="num">' + esc(CS.blockedLineText(l)) + '</span></li>';
      }).join('') + '</ul></div>';
    }
    var wi = warningItems();
    html += '<div class="sect" id="warnings"><span class="cap up">Warnings</span>' + (wi.length ? '<ul class="wlist">' + wi.join('') + '</ul>' : '<div class="card glass"><p class="sub">No warnings today.</p></div>') + '</div>';
    return html;
  }
  // The Notices view: weather with the rain watch, power and water notices, house items (owner and admin), how to add one. Cleaners never get Tell the guest, Resolve or the House list.
  function A_noticeRow(n) {
    var tell = n.tell && CS.canSeeGuestContact(role());
    return '<section class="card glass A_nrow" aria-label="' + esc(n.title) + '"><div class="top"><span class="lead A_t-' + esc(n.type) + '">' + ICON(A_noticeIcon(n.type)) + '</span><div class="mid"><span class="t">' + esc(n.title) + '</span>' +
      (n.sub ? '<span class="s">' + esc(n.sub) + '</span>' : '') + (n.detail ? '<span class="A_det">' + esc(n.detail) + '</span>' : '') + '</div></div>' +
      (tell || n.date ? '<div class="acts">' + (tell ? '<button class="btn btn-secondary btn-sm" type="button" data-act="notice-tell" data-nkey="' + esc(n.key) + '">Tell the guest</button>' : '') +
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
  function calNotices() {
    var v = A_notices();
    if (state.noticesAbsent) return '<div class="card glass"><p class="sub">Notices are not set up yet. Brownouts and the weather still show under Stays, in Warnings.</p><a class="btn btn-secondary btn-sm" href="#calendar/warnings" style="margin-top:10px">See warnings</a></div>';
    if (!v) return state.noticesLoading ? '<div class="stack"><div class="skel" style="height:120px"></div><div class="skel" style="height:96px"></div></div>' : '<div class="errbox" role="alert">' + ICON('alert') + '<span>No connection. <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>';
    var f = state.noticeFilter, filters = CS.A_noticeFilters(v), W = v.weather, html = '';
    if (!filters.some(function (x) { return x[0] === f; })) f = 'all';
    html += '<div class="A_filters" role="group" aria-label="Filter notices">' + filters.map(function (x) { return '<button class="chip" type="button" data-nfilter="' + x[0] + '" aria-pressed="' + (x[0] === f) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
    if ((f === 'all' || f === 'weather') && W) {
      html += '<div class="A_label">Weather</div><section class="card glass A_card" aria-label="Weather"><div class="row-wrap" style="gap:14px"><span class="A_temp">' + W.temp + '°</span><span class="mid"><span class="t">' + esc(W.condition || 'Weather') + '</span>' +
        (W.watch ? '<span class="s">' + ICON('rain', 's16') + ' ' + esc(W.watch.text) + '</span>' : '<span class="s">' + (W.rain != null ? W.rain + '% chance of rain' : '') + (W.aqi != null ? ' · air quality ' + W.aqi : '') + '</span>') + '</span></div>' +
        (W.hours.length ? '<div class="A_hours" aria-label="Chance of rain by hour">' + W.hours.map(function (h) { return '<div><span>' + h.pct + '%</span><i style="height:' + Math.max(4, Math.round(h.pct * 0.6)) + 'px"></i><span>' + esc(h.label) + '</span></div>'; }).join('') + '</div>' : '') +
        (W.watch ? '<p class="sub" style="margin:0">Close the windows and bring in the laundry before the rain.</p>' : '') +
        '<p class="help" style="margin:0">' + esc(W.source ? W.source + ' forecast' : 'Forecast') + (W.fetched_at ? ' · as of ' + esc(CS.clockLabel(W.fetched_at)) : '') + '</p></section>';
    } else if ((f === 'all' || f === 'weather') && !W) html += '<div class="A_label">Weather</div><div class="card glass"><p class="sub">The forecast is not available right now. It comes back by itself.</p></div>';
    [['power', 'Power'], ['water', 'Water']].forEach(function (g) {
      var rows = v.list.filter(function (n) { return n.group === g[0]; }), link = v.sources[g[0]];
      if ((f === 'all' || f === g[0]) && (rows.length || link)) html += '<div class="A_label">' + g[1] + '</div>' + rows.map(A_noticeRow).join('') + (link ? A_sourceRow(g[0], link) : '') + (g[0] === 'water' && link ? A_fbPanel(link) : '');
    });
    if (f === 'all') { var other = v.list.filter(function (n) { return n.group === 'other' || (n.group === 'weather' && n.key !== 'rain-watch'); }); if (other.length) html += '<div class="A_label">Other</div>' + other.map(A_noticeRow).join(''); }
    if (v.mgr && (f === 'all' || f === 'house')) html += '<div class="A_label">House</div>' + (v.house.length ? '<section class="card glass list" aria-label="House">' + v.house.map(A_houseRow).join('') + '</section>' : '<div class="card glass"><p class="sub">Nothing needs a person in the house.</p></div>');
    if (f !== 'weather' && f !== 'house' && !v.list.length && f === 'all' && !W) html += '<div class="card glass"><p class="sub">No notices right now.</p></div>';
    if (CS.canSeeGuestContact(role())) html += '<section class="card glass A_card" aria-label="Add a notice"><h2 class="hd">Add a notice</h2><p class="sub" style="margin:0">Saw an advisory from SOCOTECO II or GSCWD? Forward the post to Cassy in Telegram and tap Save. It shows here and on the calendar.</p>' +
      ('<button class="btn btn-primary btn-sm" type="button" data-act="notice-add-open" data-date="' + esc(state.payload.today) + '">' + ICON('plus', 's16') + 'Add a notice</button>') +
      tgA(LINKS.tgOps, ICON('chat', 's16') + 'Open Cassy · OPS', 'btn btn-secondary btn-sm') + '</section>';
    return html;
  }
  var E_tabFocus = false;
  function renderCalendar() {
    var el = $('v-calendar'), head = appbar({ title: 'Calendar', refresh: true }); // a tab screen: no Back arrow, like Tasks and More
    if (!state.payload) { el.innerHTML = head + '<div class="screen">' + (state.error ? errBanner() : loadingBlock()) + '</div>'; return; }
    var tab = state.calTab;
    var keepFb = state.fbOpen && tab === 'notices' && el.querySelector ? el.querySelector('#A_fbbox') : null; if (keepFb && keepFb.parentNode) keepFb.parentNode.removeChild(keepFb); else keepFb = null;
    fbCarry = !!keepFb;
    var inner = head + '<div class="screen">' + errBanner() + calTabs(tab) + '<div class="E_tabbody" data-E-swipe="cal-tab" data-F-tab="' + tab + '">' + (tab === 'stays' ? calStays() : tab === 'notices' ? calNotices() : calMonth()) + '<div class="help" style="text-align:center;margin-top:14px">Updated ' + esc(CS.agoLabel(state.payload.generated_at)) + '</div></div></div>';
    fbCarry = false;
    el.innerHTML = inner;
    if (E_tabFocus) { E_tabFocus = false; var ct = el.querySelector && el.querySelector('.A_tabs a[aria-current="page"]'); if (ct && ct.focus) ct.focus(); } // an arrow key moved the view: focus follows it
    if (keepFb) { var fresh = el.querySelector('#A_fbbox'); if (fresh && fresh.parentNode) fresh.parentNode.replaceChild(keepFb, fresh); }
    loadIdPhotos(el);
  }

  // ---------------------------------------------------------------- day and warning sheets (s77): the .sheet/.scrim pattern of the iOS hint.
  // One sheet element, made once; its content is redrawn from state.sheet so a reload under it keeps it current. The status line lives
  // outside the redrawn part so screen readers hear "Note added" and errors.
  function sheetEls() {
    var sh = $('cal-sheet');
    if (!sh) {
      var sc = document.createElement('div'); sc.className = 'scrim'; sc.id = 'cal-scrim'; sc.addEventListener('click', closeSheet); document.body.appendChild(sc);
      sh = document.createElement('div'); sh.className = 'sheet calsheet'; sh.id = 'cal-sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
      sh.setAttribute('aria-labelledby', 'cs-h'); sh.setAttribute('aria-hidden', 'true');
      sh.innerHTML = '<div class="E_grab" aria-hidden="true"></div><div class="sr" id="cs-live" role="status" aria-live="polite"></div><div id="cs-body"></div>'; document.body.appendChild(sh);
    }
    return { sheet: sh, scrim: $('cal-scrim') };
  }
  function openSheet(kind, key) {
    state.sheet = { kind: kind, key: key, form: { kind: 'brownout', label: '' }, busy: false, err: '', msg: '', missing: false };
    var e = sheetEls(); $('cs-live').textContent = ''; drawSheet();
    e.sheet.classList.add('on'); e.sheet.setAttribute('aria-hidden', 'false'); e.scrim.classList.add('on');
    var h = kind === 'add' ? $('t-title') : kind === 'nadd' ? $('n-title') : $('cs-h'); if (h) h.focus();
  }
  function closeSheet() {
    var S = state.sheet; if (!S) return; state.sheet = null;
    var e = sheetEls(), attr = S.kind === 'day' ? 'data-day' : S.kind === 'warn' ? 'data-warn' : 'data-act';
    e.sheet.classList.remove('on'); e.sheet.setAttribute('aria-hidden', 'true'); e.scrim.classList.remove('on');
    var want = S.kind === 'add' ? 'task-add-open' : S.kind === 'nadd' ? 'notice-add-open' : S.kind === 'news' ? 'whatsnew' : S.kind === 'attn' ? 'attn-open' : S.key;
    E_sheetReset(e.sheet, e.scrim);
    var back = Array.prototype.filter.call(document.querySelectorAll('[' + attr + ']'), function (b) { return b.getAttribute(attr) === want; })[0];
    if (back) back.focus();
  }
  function sheetLive(msg) { var l = $('cs-live'); if (l) l.textContent = msg || ''; }
  function findWarn(key) { return ((state.payload && state.payload.warnings) || []).filter(function (w) { return warnKey(w) === key; })[0] || null; }
  function role() { return state.access && state.access.role; }
  function daySheet(S) {
    var p = state.payload, ds = dayStatusOf(S.key), canFlag = CS.canFlagDays(role());
    var prim = ds.primary === 'booked' ? pill('brand', 'house', 'Booked') : ds.primary === 'blocked' ? pill('neutral', 'lock', 'Blocked') : pill('ok', 'check', 'Free');
    var html = '<h2 class="ttl" id="cs-h" tabindex="-1">' + esc(CS.dayLong(S.key)) + '</h2><div class="row-wrap" style="margin-top:8px">' + prim +
      (ds.turnover ? pill('info', 'repeat', 'Turnover') : '') + (ds.clash.length ? pill('danger', 'alert', 'Clash') : '') + '<span class="sub">' + esc(ds.why) + '</span></div>';
    var all = staysOf();
    var stayLine = function (st, what) {
      var src = CS.sourceLabel(st.source);
      return '<p class="sub num" style="margin:8px 0 0"><b>' + esc((st.guest_name || 'Guest') + ' ' + what) + '</b> · ' + esc(CS.stayDates(st) + (src ? ' · ' + src : '')) + '</p>' +
        (st.rows.length > 1 ? '<p class="help" style="margin:2px 0 0">' + esc(st.rows.length + ' bookings for this guest, shown as one stay') + '</p>' : '') +
        (st.checkout_date >= p.today ? '<button class="btn btn-ghost btn-sm" type="button" data-stay="' + all.indexOf(st) + '" style="margin:4px 0 0 -12px">Show the stay' + ICON('chev', 's16') + '</button>' : '');
    };
    if (ds.out) html += stayLine(ds.out, 'checks out');
    if (ds.stay) {
      html += stayLine(ds.stay, ds.arrive ? 'arrives' : 'is staying');
      if (ds.block) html += '<p class="help" style="margin-top:4px">Also held on the calendar: ' + esc(ds.blockWhy) + '</p>';
    }
    if (ds.clash.length) html += '<div class="errbox" style="margin-top:10px">' + ICON('alert') + '<span>' + esc('Two different guests on this night: ' + ds.clash.map(function (s) { return (s.guest_name || 'Guest') + ' (' + CS.stayDates(s) + ')'; }).join(', ') + '. One booking needs to move.') + '</span></div>' +
      ds.clashIn.map(function (s) { return '<p class="sub num" style="margin:8px 0 0"><b>' + esc('Second arrival: ' + (s.guest_name || 'Guest')) + '</b> · ' + esc(CS.stayDates(s)) + '</p>'; }).join('');
    var nd = CS.A_noticeDay(A_notices(), S.key), T = A_houseT();
    if (nd.length) html += '<div class="cap up" style="margin:14px 0 6px">Notices</div><ul class="wlist">' + nd.map(function (n) {
      return '<li>' + ICON(A_noticeIcon(n.type)) + '<span style="flex:1"><b>' + esc(n.title) + '</b>' + (n.sub ? '<br><span class="help">' + esc(n.sub) + '</span>' : '') + '</span>' +
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
    $('cs-body').innerHTML = (S.kind === 'attn' ? E_attnSheet() : S.kind === 'day' ? daySheet(S) : S.kind === 'add' ? addReminderCard() : S.kind === 'news' ? A_newsSheet() : S.kind === 'nadd' ? A_noticeAddForm() : S.kind === 'rate' ? A_rateConfirm() : warnSheet(S)) +
      (S.err ? '<div class="errbox" style="margin-top:12px">' + ICON('alert') + '<span>' + esc(S.err) + '</span></div>' : '') +
      (S.msg ? '<div class="okbox" style="margin-top:12px">' + ICON('check') + '<span>' + esc(S.msg) + '</span></div>' : '') +
      (S.kind === 'add' || S.kind === 'nadd' || S.kind === 'rate' ? '' : '<button class="btn btn-ghost btn-block" type="button" data-act="sheet-close" style="margin-top:12px">Close</button>');
    if (had && !e.sheet.contains(document.activeElement)) { var h = $('cs-h'); if (h) h.focus(); }
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
  function E_go(r) { // -> { tag, attrs, ext }
    var go = r.go, l;
    if (go.kind === 'tasks') return { tag: 'a', attrs: ' href="#tasks" data-act="attn-tasks" data-filter="' + esc(go.filter) + '"', ext: false };
    if (go.kind === 'day') return { tag: 'button', attrs: ' type="button" data-act="notice-cal" data-date="' + esc(go.date) + '"', ext: false };
    if (go.kind === 'bookings') { l = A_hubLink('bookings/inquiries') || { href: CS.INQUIRIES_URL, external: true }; }
    else if (go.kind === 'inbox') { l = A_hubLink('guests/conversations'); }
    else if (go.kind === 'inventory') { l = state.layout === 'admin' ? A_hubLink('inventory') : null; l = l || { href: '#calendar/warnings', external: false }; }
    else if (go.kind === 'warn') return { tag: 'button', attrs: ' type="button" data-warn="' + esc(go.key) + '"', ext: false };
    else l = { href: '#calendar/notices', external: false };
    if (!l) l = { href: '#home', external: false };
    return { tag: 'a', attrs: ' href="' + esc(l.href) + '" data-act="sheet-close"' + (l.external ? ' target="_blank" rel="noopener"' : ''), ext: !!l.external };
  }
  function E_rowHtml(r) {
    var g = E_go(r);
    return '<' + g.tag + ' class="rowi"' + g.attrs + '><span class="lead' + (r.tile ? ' A_t-' + r.tile : '') + '">' + ICON(r.glyph) + '</span><span class="mid"><span class="t">' + esc(r.title) + '</span>' + (r.sub ? '<span class="s">' + esc(r.sub) + '</span>' : '') +
      '</span><span class="chev">' + ICON(g.ext ? 'ext' : 'chev', g.ext ? 's16' : '') + '</span></' + g.tag + '>';
  }
  var E_ALL = { risk: ['#tasks', 'blocks'], overdue: ['#tasks', 'due'], clash: ['#calendar', ''], warn: ['#calendar/warnings', ''], notice: ['#calendar/notices', ''] };
  function E_attnSheet() {
    var att = E_att(), S = state.sheet, staff = state.layout === 'staff', html;
    var at = state.loadedAt ? new Date(state.loadedAt).toISOString() : '';
    var help = att.phase === 'offline' ? 'No connection' + (at ? ' · showing ' + CS.clockLabel(at) : '') : att.phase === 'loading' ? 'Loading' : 'Updated ' + (at ? CS.agoLabel(at) : 'just now');
    html = '<h2 class="ttl" id="cs-h" tabindex="-1">To look at</h2><div class="row-between" style="margin-top:4px"><span class="help">' + esc(help) + '</span>' +
      (att.phase === 'offline' ? '<button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button>' : '') + '</div>';
    if (att.phase === 'loading') return html + '<div class="skel" style="height:96px;margin-top:12px"></div>';
    if (att.phase === 'offline' && !state.payload) return html + '<div class="errbox" role="alert" style="margin-top:12px">' + ICON('alert') + '<span>Live information needs a connection.</span></div>';
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
  function E_sheetTwin(kind) { return kind === 'add' ? 'task-add-cancel' : kind === 'nadd' ? 'notice-add-cancel' : kind === 'rate' ? 'rate-back' : 'sheet-close'; }
  function E_dirty() {
    var S = state.sheet, a = state.add, b = state.nadd, f = state.rateForm; if (!S) return false;
    if (S.kind === 'add') return !!(a && (String(a.title).trim() || a.due || a.who || String(a.note).trim()));
    if (S.kind === 'nadd') return !!(b && (String(b.title).trim() || b.start || b.hours || String(b.detail).trim()));
    if (S.kind === 'rate') return !!(f && (f.regular || f.general || f.transport || f.note));
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
      '<span class="s' + (due === 'overdue' && !done ? ' c-danger' : '') + '">' + esc(meta.join(' · ')) + '</span>' +
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
      (state.lastDone.source === 'verifier_findings' ? '' : ' <button class="btn btn-ghost btn-sm" type="button" data-act="task-' + (state.lastDone.done ? 'undo' : 'done') + '" data-task="' + esc(state.lastDone.source + ':' + state.lastDone.id) + '">' + (state.lastDone.done ? 'Undo' : 'Done again') + '</button>') + '</span></div>'; // read out for screen readers; the toast beside the thumb carries the visible Undo
    if (state.tasksErr) body += '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.tasksErr) + '</span></div>';
    if (manager()) body += '<button class="btn btn-secondary" type="button" data-act="task-add-open">' + ICON('plus', 's16') + 'Add a reminder</button>';
    if (!groups.length) body += '<div class="card glass empty"><div class="disc">' + ICON('checks') + '</div><h2 class="hd">Nothing to do</h2><p>' + (manager() ? 'Add a reminder, or wait for a cleaning issue or a check to land here.' : 'Nothing is waiting for you.') + '</p></div>';
    groups.forEach(function (g) { body += '<div><div class="cap up" style="margin-bottom:6px">' + esc(g.label) + ' (' + g.tasks.length + ')</div><div class="card list">' + g.tasks.map(taskRow).join('') + '</div></div>'; });
    body += '<label class="trust"><input type="checkbox" data-act="tasks-showdone"' + (state.showDone ? ' checked' : '') + '> Show what was done in the last 14 days</label>';
    el.innerHTML = head + '<div class="screen"><p class="sub" style="margin:0 0 12px">' + (manager() ? 'Everything that needs a person. Tap the box when it is done.' : 'What is yours to do. Tap the box when it is done.') + '</p><div class="stack">' + body + '</div></div>';
  }
  function loadTasks() {
    if (!state.access) return Promise.resolve();
    state.tasksLoading = true;
    return sb.rpc('tasks_list_v1', { p_property_id: pid(), p_include_done: state.showDone }).then(function (r) {
      if (r.error) throw r.error;
      var d = r.data; if (!d || d.ok === false) throw new Error('denied');
      CS.assertNoMoney(d.tasks || []);
      state.tasks = { manager: d.manager === true, today: d.today || CS.manilaToday(), tasks: d.tasks || [] }; state.tasksErr = '';
    }).catch(function (e) {
      state.tasksErr = e && e.message === 'denied' ? 'Tasks are not available for this account.' : state.tasks ? 'Live information needs a connection. Showing the last update.' : 'Live information needs a connection.';
    }).then(function () { state.tasksLoading = false; if (state.layout && current !== 'door') { if (current === 'tasks') renderTasks(); else if (current === 'home') render('home'); renderTabs(current); } }); // Home too: the pill waits for the tasks
  }
  function findTask(key) {
    var i = key.indexOf(':'), src = key.slice(0, i), id = key.slice(i + 1), list = state.tasks ? state.tasks.tasks : [];
    for (var k = 0; k < list.length; k++) if (list[k].source === src && list[k].id === id) return list[k];
    return null;
  }
  function setTaskDone(key, done) {
    var t = findTask(key), L = state.lastDone;
    // The server hides a finished task once the list reloads, so Undo works from the remembered one.
    if (!t && L && L.source + ':' + L.id === key) t = { source: L.source, id: L.id, title: L.title, status: done ? 'open' : 'done' };
    if (!t || t.status === (done ? 'done' : 'open')) return;
    t.status = done ? 'done' : 'open'; state.lastDone = { source: t.source, id: t.id, title: t.title, done: done }; state.tasksErr = ''; renderTasks(); renderTabs('tasks');
    E_vibe('tap'); // one buzz for the confirm; the same path whether the box, the underlay button or the swipe asked
    toast(done ? 'Marked done' : 'Back on the list', t.source === 'verifier_findings' ? null : { act: done ? 'task-undo' : 'task-done', task: key, text: done ? 'Undo' : 'Done again', label: (done ? 'Undo: ' : 'Done again: ') + t.title });
    var call = t.source === 'verifier_findings' ? sb.rpc('ack_verifier_finding_v1', { p_key: t.id })
      : sb.rpc('task_set_done_v1', { p_property_id: pid(), p_source: t.source, p_id: t.id, p_done: done });
    var msg = '';
    call.then(function (r) { if (r.error) throw r.error; }).catch(function (e) {
      t.status = done ? 'open' : 'done'; state.lastDone = null;
      msg = e && (e.code === '42501' || e.code === 'P0002') ? 'That task is not yours to change.' : 'That did not save. Check your signal and try again.'; E_vibe('error');
    }).then(function () { return loadTasks(); }).then(function () { if (msg) { state.tasksErr = msg; renderTasks(); } });
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
    if (R.busy) {
      body = '<div class="card" role="status"><h2 class="hd" id="rp-h" tabindex="-1">Cassy is writing</h2><p class="sub" style="margin-top:6px">This takes a few seconds. Please keep this screen open.</p><div class="skel" style="height:96px;margin-top:12px"></div></div>';
    } else if (R.step === 'done' && R.result) {
      var X = R.result, who = (X.guestName ? X.guestName + ' · ' : '') + RP_NAME[X.platform];
      body = rpErr(R) + '<div class="card"><h2 class="cap up" id="rp-h" tabindex="-1">Replying to · ' + esc(who) + '</h2><p class="rp-quote">' + esc(CS.clampText(X.guestText, 280)) + '</p></div>' +
        (X.header ? '<p class="sub" style="margin:0">' + esc(X.header) + '</p>' : '') +
        X.replies.map(function (r, i) {
          return '<div class="card"><span class="cap up">' + (X.replies.length > 1 ? 'Reply ' + (i + 1) : 'Reply') + '</span><p class="rp-reply">' + esc(r) + '</p>' +
            '<button class="btn btn-primary btn-block" type="button" data-act="reply-copy" data-i="' + i + '" style="margin-top:12px">' + (R.copied === i ? ICON('check', 's16') + 'Copied' : 'Copy') + '</button></div>';
        }).join('') +
        '<button class="btn btn-secondary btn-block" type="button" data-act="reply-reset">Start over</button>';
    } else if (R.step === 'pick') {
      body = '<h2 class="dlg" id="rp-h" tabindex="-1">What did the guest send?</h2><div class="rp-pick">' +
        '<button class="btn btn-secondary rp-big" type="button" data-act="reply-mode" data-mode="text">' + ICON('chat', 's24') + 'Text</button>' +
        '<button class="btn btn-secondary rp-big" type="button" data-act="reply-mode" data-mode="image">' + ICON('image', 's24') + 'Screenshot</button></div>' +
        '<p class="help" style="margin:0">Cassy writes the drafts in her own voice. You copy one and send it yourself.</p>';
    } else {
      var shot = R.mode === 'image';
      body = rpErr(R) +
        (shot ? '<div class="field"><span class="lbl">Screenshot of the guest’s message</span><label class="btn btn-secondary btn-block rp-file">' + ICON('image', 's16') + (R.image ? 'Choose another' : 'Choose a screenshot') +
            '<input class="sr" id="rp-file" type="file" accept="image/*"></label>' + (R.shrinking ? '<p class="help" role="status" style="margin:0">Preparing the screenshot…</p>' : R.image ? '<div class="okbox">' + ICON('check') + '<span>Ready: ' + esc(R.imageName || 'screenshot') + '</span></div>' : '') + '</div>'
          : '<div class="field"><label for="rp-text">What the guest sent</label><textarea class="ta" id="rp-text" rows="7" maxlength="4000" placeholder="Paste the guest’s message here">' + esc(R.text) + '</textarea></div>') +
        '<div class="field"><label for="rp-name">Guest name (optional)</label><div class="input"><input id="rp-name" maxlength="80" value="' + esc(R.name) + '" autocomplete="off"></div></div>' +
        rpPlatform(R) +
        '<button class="btn btn-primary btn-block" type="button" data-act="reply-send"' + (R.shrinking ? ' disabled' : '') + '>Write the reply</button>' +
        '<button class="btn btn-ghost btn-block" type="button" data-act="reply-back">Back</button>';
    }
    el.innerHTML = head + '<div class="screen"><div class="stack">' + body + '</div></div>';
    if (focus === 'error') rpFocus('rp-err'); else if (focus === 'heading') rpFocus('rp-h');
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
    R.busy = true; R.err = ''; R.signout = false; renderReply('heading'); rpLive('Cassy is writing'); window.scrollTo(0, 0);
    var body = JSON.stringify(CS.replyBody({ mode: R.mode, text: R.text, image: R.image, guestName: R.name, platform: R.platform }));
    sb.auth.getSession().then(function (s) {
      var token = s.data && s.data.session && s.data.session.access_token; if (!token) return { status: 401, j: null };
      return net(CFG.url + '/functions/v1/guest-reply-draft', { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'application/json' }, body: body })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, j: j }; }); });
    }).catch(function () { return { status: 0, j: null }; }).then(function (o) {
      if (state.reply !== R) return; // signed out meanwhile
      R.busy = false;
      var X = o.status === 200 ? CS.replyResult(o.j) : null;
      if (X) { R.result = X; R.step = 'done'; R.copied = -1; R.err = ''; R.signout = false; }
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
      var b = copyBtn(i); R.copied = i; R.err = ''; if (b) b.innerHTML = ICON('check', 's16') + 'Copied'; rpLive('Copied');
      clearTimeout(copyTimer); copyTimer = setTimeout(function () { if (R.copied === i) { R.copied = -1; var b2 = copyBtn(i); if (b2) b2.textContent = 'Copy'; rpLive(''); } }, 2000);
    }).catch(function () { R.err = 'Copy did not work on this phone. Press and hold the text to copy it.'; R.signout = false; if (current === 'reply') renderReply('error'); });
  }

  // ---------------------------------------------------------------- More
  function renderMore() {
    var theme = window.CSTheme.get(), staff = state.layout === 'staff', plain = window.CSTheme.plainOn(), admin = !staff;
    var chip = function (v, t) { return '<button class="chip" type="button" role="radio" data-theme="' + v + '" aria-checked="' + (theme === v) + '" aria-pressed="' + (theme === v) + '">' + t + '</button>'; };
    var nm = state.name || 'You', roleName = state.access ? state.access.role : '';
    $('v-more').innerHTML = appbar({ title: 'More' }) + '<div class="screen"><div class="stack">' +
      '<div class="card glass A_prof"><span class="av" aria-hidden="true">' + esc(CS.initialOf(nm)) + '</span><div class="mid"><span class="t">' + esc(nm) + '</span><span class="s">' + esc(roleName) + (trustOn ? ' · This phone is trusted' : '') + '</span></div>' +
        '<button class="btn btn-secondary E_signout" type="button" data-act="signout">' + ICON('logout', 's16') + 'Sign out</button>' +
        '<p class="help E_signhelp">Signs you out of the admin dashboard as well, on this phone.</p></div>' +
      '<nav class="card glass list" aria-label="What’s new"><button class="rowi" type="button" data-act="whatsnew"><span class="lead">' + ICON('sparkles') + '</span><span class="mid"><span class="t">What’s new</span><span class="s">What changed in this version</span></span><span class="chev">' + ICON('chev') + '</span></button></nav>' +
      '<section class="card" aria-label="Appearance"><h2 class="hd">Appearance</h2><div class="row-wrap" role="radiogroup" aria-label="Theme" style="margin-top:10px">' + chip('auto', 'Automatic') + chip('light', 'Light') + chip('dark', 'Dark') + '</div>' +
      '<div class="A_switch" style="margin-top:10px"><span id="plain-label"><b>Plain bars</b> (no glass)</span><button class="sw" type="button" role="switch" data-act="plain" aria-checked="' + plain + '" aria-labelledby="plain-label"><i></i></button></div>' +
      '<p class="help" style="margin:4px 0 0">On by itself on slower phones. Easier to read in the sun.</p>' +
      (E_canVibrate() ? '<div class="A_switch" style="margin-top:10px"><span id="hap-label"><b>Vibrate on confirm</b></span><button class="sw" type="button" role="switch" data-act="haptics" aria-checked="' + CS.E_hapticsOn(store('localStorage')) + '" aria-labelledby="hap-label"><i></i></button></div>' +
        '<p class="help" style="margin:4px 0 0">A short buzz when something is saved or finished. Off saves nothing but the buzz.</p>' : '') + '</section>' +
      A_navCard('Cassy', (canReply() ? row({ icon: 'sparkles', title: 'Cassy reply', sub: 'Draft a warm reply to a guest message', href: '#reply' }) : '') + row({ icon: 'help', title: 'Quick guide', sub: 'How to use Cassy in Telegram', href: LINKS.quick }) +
        row({ icon: 'chat', title: 'Cassy · Telegram OPS', sub: 'Open in Telegram', tg: LINKS.tgOps, external: true }) + (admin ? row({ icon: 'wallet', title: 'Cassy · Telegram Finance', sub: 'Open in Telegram', tg: LINKS.tgFinance, external: true }) : '')) +
      A_navCard('Reference', row({ icon: 'book', title: 'House manual', sub: 'How we do things', door: 'manual' }) + doorRow('guide', 'book', 'How the staff app and the house work') + doorRow('adminguide', 'lock', 'Owner and admin chapters')) +
      (admin ? A_navCard('Admin', row({ icon: 'dash', title: 'Admin hub', sub: 'Every dashboard page, in one list', href: '#hub' }) + (CS.canEditRates(role()) ? row({ icon: 'cash', title: 'Pay rates', sub: 'What a clean and its transport pay', href: '#payrates' }) : '') + doorRow('inventory', 'box', 'Stock levels and usage')) : '') +
      '<div class="F_group"><div class="A_label">This phone</div><section class="card" id="install-card" hidden aria-label="Install the app"><h2 class="hd">Install the app</h2><p class="sub" style="margin-top:6px">Put Cascade Staff on your Home Screen.</p><button class="btn btn-secondary" id="install-btn" type="button" style="margin-top:10px">' + ICON('plus', 's16') + 'Install</button>' +
        '<a class="btn btn-secondary" id="install-link" href="./install/" style="margin-top:10px" hidden>' + ICON('plus', 's16') + 'How to install</a></section></div>' +
      '</div>' +
      '<div class="help" style="text-align:center;margin-top:16px">Cascade Staff v' + CFG.version + '</div></div>';
    syncInstall();
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
  function A_loadNotices() {
    if (!state.access) return Promise.resolve();
    state.noticesLoading = !state.notices && !state.noticesAbsent;
    return sb.rpc('notices_v1', { p_property_id: pid() }).then(function (r) {
      if (r.error) throw r.error;
      CS.assertNoMoney(r.data);
      var v = CS.A_noticesView(r.data, role(), state.payload ? state.payload.today : CS.manilaToday());
      if (!v) throw new Error('shape');
      state.notices = v; state.noticesAbsent = false;
    }).catch(function (e) {
      if (CS.rpcMissing(e)) { state.noticesAbsent = true; state.notices = null; }
    }).then(function () { state.noticesLoading = false; state.noticesDone = true; if (state.layout && (current === 'home' || current === 'calendar')) render(current); });
  }
  var NADD_TYPES = [['water', 'Water interruption'], ['maintenance', 'Maintenance'], ['deep_clean', 'Deep cleaning'], ['note', 'Note']]; // a brownout is refused by the server
  function A_noticeAddForm() {
    var a = state.nadd;
    return '<h2 class="ttl" id="cs-h" tabindex="-1">Add a notice</h2><p class="help" style="margin:4px 0 0">No phone numbers, e-mails or amounts.</p><div class="stack" style="margin-top:10px">' +
      '<div class="field"><label for="n-type">Kind</label><select class="sel" id="n-type" style="max-width:none;text-align:left;text-align-last:left">' + NADD_TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (a.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="n-title">What is happening</label><div class="input"><input id="n-title" maxlength="80" value="' + esc(a.title) + '" autocomplete="off"></div></div>' +
      '<p class="help" style="margin:-6px 0 0">' + esc(CS.A_NOTICE_HINT) + '</p>' +
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
    var bad = CS.A_noticeAddProblem(a); if (bad) { a.err = bad; A_noticeAddDraw(); return; }
    a.busy = true; a.err = ''; A_noticeAddDraw();
    sb.rpc('ops_notice_add_v1', CS.A_noticeAddArgs(pid(), a)).then(function (r) {
      if (r.error) throw r.error;
      if (r.data && r.data.ok === false) throw { message: r.data.error || 'not ok', code: '22023' };
      state.nadd = null; closeSheet(); toast('Notice added.'); E_vibe('tap'); return A_loadNotices();
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
    closeSheet(); dropPhotos(); state.reply = null; var rb = $('rp-body'); if (rb) rb.innerHTML = ''; rpLive(''); state.payload = null; state.bookings = null; state.bookingsDone = false; state.noticesDone = false; state.notices = null; state.noticesAbsent = false; state.nadd = null; state.fbOpen = false; state.tasks = null; state.access = null; state.layout = null; state.month = null; state.error = '';
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
      try { CS.assertNoMoney(r.data, { allowContact: CS.canSeeGuestContact(state.access && state.access.role) }); } catch (e) { state.payload = null; state.error = 'This page was blocked because the data carried an amount or a contact detail. Tell Lloyd.'; return; }
      if (!CS.canSeeGuestContact(state.access && state.access.role)) r.data.warnings = (r.data.warnings || []).filter(function (w) { return w.kind !== 'verifier'; });
      state.payload = r.data; state.loadedAt = Date.now(); state.error = '';
      refreshWeather(); loadPayHint(); loadBookingsToConfirm(); A_loadNotices();
    }).catch(function () {
      state.error = state.payload ? 'Live information needs a connection. Showing the last update.' : 'Live information needs a connection.';
    }).then(function () { state.loading = false; if (state.layout) render(); E_announce(); });
  }
  // weather-proxy refreshes its own cache; if it rejects the user's token, the line simply says "as of HH:MM".
  function refreshWeather() {
    var w = state.payload && state.payload.weather;
    if (!CS.weatherStale(w)) return;
    sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token; if (!tok) return;
      return net(CFG.url + '/functions/v1/weather-proxy', { headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key }, cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; }).then(function (j) {
          if (j && j.current && j.current.temp != null && state.payload) {
            var c = j.current;
            state.payload.weather = { source: j.source || null, fetched_at: j.fetched_at || new Date().toISOString(), current: { temp: c.temp, emoji: c.emoji, description: c.description, rain_prob: c.rain_prob, today_high: c.today_high, today_low: c.today_low, humidity: c.humidity, uv_label: c.uv_label } };
            render();
          }
        });
    }).catch(function () {});
  }
  // Payment Request sub-line: how many cleans are ready. SPEC-37's RPC; silent while it is not deployed.
  function loadPayHint() {
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
    var fail = function (e) { state.bookings = null; state.bookingsDone = true; if (!bkWarned) { bkWarned = true; console.warn('bookings to confirm unavailable', e && e.message ? e.message : e); } };
    sb.rpc('staff_inquiry_payments_v1', { p_property_id: pid() }).then(function (r) {
      if (r.error) return fail(r.error);
      state.bookings = CS.bookingsToConfirmCount(r.data); // the count only; the payment rows are never kept
    }).catch(fail).then(function () { state.bookingsDone = true; if (current === 'home' && state.layout) render('home'); });
  }

  // ---------------------------------------------------------------- router
  function route() {
    var h = (location.hash || '').replace(/^#/, ''), parts = h.split('/'), v = parts[0] || 'home';
    if (!state.layout) return;
    if (VIEWS.indexOf(v) < 0 || v === 'signin') v = 'home';
    if (v === 'door' && !(doorDef(parts[1]) && CS.doorFramed(parts[1], state.layout, trustOn) && CS.doorAllowed(parts[1], state.access && state.access.role))) v = 'home'; // role decides; the server stays the real gate
    if (v === 'payrates' && !CS.canEditRates(state.access && state.access.role)) v = 'home';
    if (v === 'reply' && !canReply()) v = 'home';
    if (v === 'hub' && state.layout !== 'admin') v = 'home';
    if (v !== 'calendar' || CS.A_calTab(parts[1]) !== state.calTab) state.fbOpen = false; // the posts load only on a tap in the current visit to the Notices tab
    if (v === 'calendar') { var tab0 = CS.A_calTab(parts[1]); if (tab0 !== state.calTab) closeSheet(); state.calTab = tab0; }
    if (v === 'door' && DEMO) { toast('Demo: ' + doorDef(parts[1]).title + ' opens in the live app'); history.replaceState(null, '', '#home'); v = 'home'; } // a door would load a real app in the frame
    if (v === 'door') { doorKey = parts[1]; doorRoute = doorKey === 'dashboard' && CS.A_hubRouteOk(parts.slice(2).join('/')) ? parts.slice(2).join('/') : ''; render('door'); window.scrollTo(0, 0); return; }
    leaveDoor(); render(v);
    var t = parts[1] && $(parts[1]); if (t) t.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  }
  var current = 'home', doorKey = '', doorRoute = '';
  function render(v) {
    v = v || current; current = v;
    setView(v);
    if (v === 'door') { renderDoor(); return; }
    renderTabs(v === 'hub' ? 'more' : v);
    if (v === 'hub') renderHub(); else if (v === 'home') renderHome(); else if (v === 'calendar') renderCalendar(); else if (v === 'tasks') renderTasks(); else if (v === 'payrates') { renderPayRates(); if (!state.rates) loadRates(); } else if (v === 'reply') renderReply(); else if (v === 'more') renderMore();
    var typing = document.activeElement && /^(df-(label|kind)|t-(title|due|who|note)|n-(type|title|date|start|hours|detail))$/.test(document.activeElement.id || '');
    if (state.sheet) { if (v !== (state.sheet.kind === 'attn' ? 'home' : state.sheet.kind === 'add' ? 'tasks' : state.sheet.kind === 'rate' ? 'payrates' : state.sheet.kind === 'news' ? 'more' : 'calendar')) closeSheet(); else if (!typing) drawSheet(); }
  }
  // A door opens in the frame once per visit; coming back to the same door (a re-render) keeps the page where it is.
  function renderDoor() {
    var d = doorDef(doorKey), f = $('door-frame'); if (!d) return;
    $('door-title').textContent = d.title; f.title = d.title;
    $('door-back').innerHTML = ICON('back', 's24') + 'Back';
    var tag = doorKey + '/' + doorRoute;
    if (f.getAttribute('data-door') !== tag) { f.setAttribute('data-door', tag); setFrame(f, doorRoute ? CS.A_hubDoorUrl(d.url, doorRoute) : d.url); }
  }
  function leaveDoor() { var f = $('door-frame'); if (f && f.getAttribute('data-door')) { f.removeAttribute('data-door'); setFrame(f, 'about:blank'); } }
  // location.replace on the frame's window: opening or closing a door adds no history entry (so Back is one press, not two).
  function setFrame(f, url) { try { f.contentWindow.location.replace(url); } catch (e) { f.src = url; } }
  function enter() {
    state.layout = CS.layoutForRole(state.access.role);
    state.name = CS.deriveDisplayName(state.user);
    if (!/^#(home|calendar|tasks|payrates|reply|more|hub)/.test(location.hash)) history.replaceState(null, '', '#home');
    route(); loadHome(); loadTasks(); maybeIosHint();
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
    $('si-pinbox').hidden = !pin; $('si-passbox').hidden = !pw; $('si-go').hidden = !pw;
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
  function loadSigninList() {
    return sb.rpc('staff_signin_list_v1').then(function (r) {
      if (r.error) throw r.error;
      var list = CS.signinList(r.data); if (!list.length) throw new Error('empty');
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
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act],[data-stay],[data-theme],[data-day],[data-warn],[data-nfilter],[data-tfilter]'); if (!t || t.getAttribute('data-act') === 'tasks-showdone') return;
    var a = t.getAttribute('data-act');
    if (a === 'refresh') { if (current === 'home') E_say = true; loadHome(); loadTasks(); if (current === 'payrates') loadRates(); }
    else if (a === 'attn-open') openSheet('attn', 'attn-open');
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
    else if (a === 'notice-cal') { var nd0 = t.getAttribute('data-date'), np = nd0.split('-'); if (CS.monthInRange(+np[0], +np[1], state.payload.today)) state.month = { y: +np[0], m: +np[1] }; state.calTab = 'month'; if (location.hash !== '#calendar') location.hash = '#calendar'; else render('calendar'); openSheet('day', nd0); }
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
    else if (a === 'reply-back') { if (state.reply) { state.reply.step = 'pick'; state.reply.err = ''; state.reply.signout = false; } renderReply('heading'); }
    else if (a === 'reply-reset') { state.reply = newReply(); renderReply('heading'); rpLive(''); window.scrollTo(0, 0); }
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
    else if (t.hasAttribute('data-stay')) {
      closeSheet(); var el = $('stay-' + t.getAttribute('data-stay')); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1400); }
    } else if (t.hasAttribute('data-theme')) { window.CSTheme.set(t.getAttribute('data-theme')); renderMore(); }
  });
  // Reminder and pay-rate forms: remember what is typed (a refresh must not lose it) without redrawing under the keyboard.
  document.addEventListener('input', function (ev) {
    var id = ev.target && ev.target.id, a = state.add, f = state.rateForm;
    if (state.sheet && id === 'df-label') state.sheet.form.label = ev.target.value; else if (state.sheet && id === 'df-kind') state.sheet.form.kind = ev.target.value;
    if (state.reply && id === 'rp-text') { state.reply.text = ev.target.value; state.reply.err = ''; } else if (state.reply && id === 'rp-name') state.reply.name = ev.target.value;
    var na = state.nadd; if (na && /^n-(type|title|date|start|hours|detail)$/.test(id || '')) { na[{ 'n-type': 'type', 'n-title': 'title', 'n-date': 'date', 'n-start': 'start', 'n-hours': 'hours', 'n-detail': 'detail' }[id]] = ev.target.value; na.err = ''; }
    if (a && id === 't-title') a.title = ev.target.value; else if (a && id === 't-due') a.due = ev.target.value; else if (a && id === 't-note') a.note = ev.target.value; else if (a && id === 't-who') a.who = ev.target.value;
    else if (f && /^r-(from|regular|general|transport|note)$/.test(id || '')) { f[id.slice(2)] = ev.target.value; f.err = ''; syncRate(); }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'rp-file') { var f0 = ev.target.files && ev.target.files[0]; if (f0) pickShot(f0); return; }
    if (ev.target && ev.target.id === 'n-type' && state.nadd) { state.nadd.type = ev.target.value; return; }
    if (ev.target && ev.target.id === 'df-kind' && state.sheet) { state.sheet.form.kind = ev.target.value; return; }
    if (ev.target && ev.target.id === 't-who' && state.add) state.add.who = ev.target.value;
    else if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-act') === 'tasks-showdone') { state.showDone = ev.target.checked; loadTasks(); renderTasks(); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && state.sheet) closeSheet(); });
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
  function E_tr(el, ms) { if (el && el.style) el.style.transition = ms ? 'transform ' + ms + 'ms ease-out, opacity ' + ms + 'ms ease-out' : 'none'; }
  // G4. Slide to start cleaning: 70% of the travel, or a fast flick after 40%. The knob follows the finger 1:1 and returns over 200 ms.
  (function A_slideInit() {
    var travel = function (a) { return Math.max(1, a.offsetWidth - 56); };
    E_drag(document, { sel: '[data-slide]', axis: 'x', vw: E_vw, reduced: E_reduced,
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
      canStart: function (el, ev) { return !!state.sheet && F_bottomSheet() && (!!(ev.target.closest && ev.target.closest('.E_grab')) || !el.scrollTop); },
      move: function (el, d) {
        E_tr(el, 0); el.style.transform = 'translateY(' + CS.E_sheetFollow(d.dy) + 'px)';
        var sc = scrim(); if (sc && sc.style) sc.style.opacity = String(Math.max(0, 1 - Math.max(0, d.dy) / Math.max(1, el.offsetHeight || 400)));
      },
      reached: function (el, d) { return d.dy >= 96; },
      onEdge: function () { E_vibe('edge'); },
      end: function (el, d) {
        var S = state.sheet, close = !!S && CS.E_sheetCommit(d.dy, d.vy) && !E_dirty();
        E_sheetReset(el, scrim()); // back to the stylesheet: it springs home over --v5-sheet-ms, or carries on out if the sheet closes
        if (!close) return;
        if (S.kind === 'add') state.add = null; else if (S.kind === 'nadd') state.nadd = null;
        closeSheet();
      },
      cancel: function (el) { E_sheetReset(el, scrim()); } });
  })();
  // G3. Task row: swipe left to mark done (Undo on a finished row). 40% of the row, or a fast flick, takes the same path as the box; a shorter swipe past
  // 48 px leaves the row open on its real button. A system check row only ever opens its "Mark as handled" button.
  (function E_taskSwipe() {
    var openW = function (el) { return parseInt(el.getAttribute('data-E-w'), 10) || 96; };
    function shut(el) { var w = el.parentNode; if (w && w.classList) { w.classList.remove('E_open'); setTimeout(function () { if (!w.classList.contains('E_open')) w.classList.remove('E_live'); }, 220); } E_tr(el, 200); el.style.transform = ''; }
    function shutAll(except) { Array.prototype.forEach.call(document.querySelectorAll('.E_swipewrap.E_open'), function (w) { var r = w.querySelector('.taskrow'); if (r && r !== except) shut(r); }); }
    E_drag(document, { sel: '.taskrow[data-E-swipe]', axis: 'x', vw: E_vw, reduced: E_reduced,
      start: function (el) { shutAll(el); if (el.parentNode && el.parentNode.classList) el.parentNode.classList.add('E_live'); },
      move: function (el, d) { E_tr(el, 0); el.style.transform = 'translateX(' + (-CS.E_taskFollow(d.dx, openW(el))) + 'px)'; },
      reached: function (el, d) { return el.getAttribute('data-E-verifier') !== '1' && -d.dx >= 0.4 * (el.offsetWidth || 360); },
      onEdge: function () { E_vibe('edge'); },
      end: function (el, d) {
        var ver = el.getAttribute('data-E-verifier') === '1', commit = CS.E_taskCommit(d.dx, el.offsetWidth || 360, d.vx);
        if (!ver && commit) { shut(el); setTaskDone(el.getAttribute('data-task'), el.getAttribute('data-E-swipe') === 'task-done'); }
        else if (commit || CS.E_taskOpens(d.dx)) { E_tr(el, 200); el.style.transform = ''; if (el.parentNode && el.parentNode.classList) el.parentNode.classList.add('E_open'); }
        else shut(el);
      },
      cancel: function (el) { shut(el); } });
    document.addEventListener('pointerdown', function (ev) { // a touch anywhere else closes an open row
      var w = ev.target && ev.target.closest ? ev.target.closest('.E_swipewrap') : null; if (!w || !w.classList || !w.classList.contains('E_open')) shutAll(null);
    });
  })();
  // G1. Calendar views: swipe left or right between Month, Stays and Notices; the three tabs above are the tap twin and the arrow keys move between them.
  (function E_tabSwipe() {
    var hashOf = function (t) { return t === 'month' ? '#calendar' : '#calendar/' + t; };
    E_drag(document, { sel: '.E_tabbody', axis: 'x', vw: E_vw, reduced: E_reduced,
      canStart: function (el, ev) { return current === 'calendar' && !(ev.target.closest && ev.target.closest('.A_filters,.A_hours,iframe,input,select,textarea')); },
      move: function (el, d) {
        var has = !!CS.E_tabNeighbour(state.calTab, d.dx < 0 ? 1 : -1), f = has ? CS.E_tabFollow(d.dx) : 0;
        E_tr(el, 0); el.style.transform = 'translateX(' + f + 'px)'; el.style.opacity = String(1 - 0.15 * Math.abs(f) / 48);
      },
      end: function (el, d) {
        E_tr(el, 160); el.style.transform = ''; el.style.opacity = '';
        var nb = CS.E_tabNeighbour(state.calTab, d.dx < 0 ? 1 : -1);
        if (nb && CS.E_tabCommit(d.dx, el.offsetWidth || E_vw(), d.vx)) location.hash = hashOf(nb); // no slide-in: the new view is simply there
      },
      cancel: function (el) { E_tr(el, 160); el.style.transform = ''; el.style.opacity = ''; } });
    document.addEventListener('keydown', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('.A_tabs a[data-tab]') : null; if (!a || (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight')) return;
      var nb = CS.E_tabNeighbour(a.getAttribute('data-tab'), ev.key === 'ArrowRight' ? 1 : -1); if (!nb) return;
      ev.preventDefault(); E_tabFocus = true; location.hash = hashOf(nb);
    });
  })();
  window.addEventListener('hashchange', route);
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
  function showA2hs() { $('a2hs-share').innerHTML = ICON('share'); $('a2hs').classList.add('on'); $('a2hs').setAttribute('aria-hidden', 'false'); $('a2hs-scrim').classList.add('on'); }
  function hideA2hs() { $('a2hs').classList.remove('on'); $('a2hs').setAttribute('aria-hidden', 'true'); $('a2hs-scrim').classList.remove('on'); if (!DEMO) try { localStorage.setItem('cs_a2hs_seen', '1'); } catch (e) {} }
  function maybeIosHint() { if (isIOS && !standalone && !seen()) setTimeout(showA2hs, 800); }
  $('a2hs-ok').addEventListener('click', hideA2hs); $('a2hs-scrim').addEventListener('click', hideA2hs);

  if (!DEMO && 'serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  // Which sibling surfaces are folded into this deployment? Read once, network-first (no-store); 404 or offline-without-cache = none folded.
  if (DEMO) applyFold(null);
  else if (typeof window.fetch === 'function') window.fetch('./fold-manifest.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    .then(function (m) { applyFold(m); if (state.layout && current !== 'door') render(current); });
  boot();
})();
