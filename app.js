/* Cascade Staff - staff app and the official mobile admin side (SPEC-36, D-299.3, D-300). One page, hash routes:
   #signin, #home, #calendar (or #calendar/house to scroll to the guest card), #tasks (D-301), #payrates (owner and admin, D-301), #reply (owner and admin, s76), #more,
   #door/<key> (a same-origin door in a frame, D-304).
   Guest names, notes and ID photos live in memory for the open session only. Nothing personal is written to storage. */
(function () {
  'use strict';
  var CS = window.CS, P = window.CSPay, ICON = window.ICON, esc = CS.esc;
  if (!window.supabase) { // offline on a first visit: the shell is here, the client library is not
    document.getElementById('v-signin').classList.add('on');
    var e0 = document.getElementById('si-err'); e0.hidden = false; e0.textContent = 'Live information needs a connection. Open the app again when you have signal.';
    return;
  }

  // Public configuration: the publishable key is designed to ship to the browser (it is already in the checklist and the dashboard).
  var CFG = {
    url: 'https://qkgfhsdppslwunarczeq.supabase.co',
    key: 'sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj',
    propertyId: '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd',
    version: '2.4.0'
  };
  var LINKS = {
    checklist: 'https://cascadereservations-del.github.io/CH-Cleaners-Checklist/',
    dashboard: 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/today',
    manual: 'https://cascadereservations-del.github.io/Cascade-Manual/',
    quick: './quick/',
    tgOps: CS.tgLink('3798341977'), // {app: tg://..., web: https://t.me/c/...}; tgA() opens the app, the web page is the fallback
    tgFinance: CS.tgLink('3819352746'),
    pay: './pay/'
  };
  // Doors (D-304.3): a door on this origin opens inside the app in a full-screen frame (one storage partition on iPhone Home Screen and
  // Android alike); a door on another origin would open externally. The frame is addressed by key, never by a URL in the hash.
  function doorDef(key) { return Object.prototype.hasOwnProperty.call(DOORS, key) ? DOORS[key] : null; }
  var DOORS = {
    checklist: { title: 'Cleaning checklist', url: LINKS.checklist },
    dashboard: { title: 'Admin dashboard', url: LINKS.dashboard },
    manual: { title: 'Cascade Manual', url: LINKS.manual }
  };

  // supabase-js default storage key on purpose: the dashboard on this origin is then signed in too (SPEC-36 section 5).
  // "Trust this device" (D-303.3): ON keeps the session in localStorage, OFF in sessionStorage only (CS.authStorage picks, key unchanged).
  function store(name) { try { return window[name]; } catch (e) { return null; } }
  var trustOn = CS.trustedFromStorage(store('localStorage'), store('sessionStorage'));
  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    storage: CS.authStorage(store('localStorage'), store('sessionStorage'), function () { return trustOn; }) } });

  var state = { access: null, user: null, name: '', layout: null, payload: null, loadedAt: 0, loading: false, error: '', month: null, cassyOpen: true, payHint: null, photos: {},
    tasks: null, tasksErr: '', tasksLoading: false, showDone: false, lastDone: null, add: null, assignees: null, rates: null, ratesErr: '', rateForm: null, rateSaving: false, reply: null, bookings: null };
  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['signin', 'home', 'calendar', 'tasks', 'payrates', 'more', 'door', 'reply'];
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
    var inner = '<span class="lead">' + ICON(opts.icon) + '</span><span class="mid"><span class="t">' + esc(opts.title) + '</span><span class="s"' + (opts.subId ? ' id="' + opts.subId + '"' : '') + '>' + esc(opts.sub || '') + '</span></span>' +
      (opts.count ? '<span class="count" aria-label="' + esc(opts.count + (opts.countLabel || ' warnings')) + '">' + esc(opts.count) + '</span>' : '') +
      '<span class="chev">' + ICON(opts.external ? 'ext' : 'chev', opts.external ? 's16' : '') + '</span>';
    if (opts.tg) return tgA(opts.tg, inner, 'rowi');
    if (opts.href && opts.external) return ext(opts.href, inner, 'rowi');
    if (opts.href) return '<a class="rowi" href="' + esc(opts.href) + '">' + inner + '</a>';
    return '<button class="rowi" type="button" id="' + esc(opts.id || '') + '">' + inner + '</button>';
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
  }
  function warnCount() { return state.payload ? (state.payload.warnings || []).length : 0; }
  function errBanner() {
    return state.error ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.error) + ' <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>' : '';
  }

  // ---------------------------------------------------------------- tab bar
  function renderTabs(current) {
    var staff = state.layout === 'staff', due = state.tasks ? CS.taskDueCount(state.tasks.tasks, state.tasks.today) : 0;
    var tabs = [['home', '#home', staff ? 'Today' : 'Home', 'house'], ['calendar', '#calendar', 'Calendar', 'calendar', warnCount()],
      ['tasks', '#tasks', 'Tasks', 'tasks', due], ['more', '#more', 'More', 'more']];
    $('tabbar').innerHTML = tabs.map(function (t) {
      return '<a class="tab" href="' + esc(t[1]) + '"' + (t[0] === current ? ' aria-current="page"' : '') + '><span class="ico">' + ICON(t[3], 's24') + '</span>' + esc(t[2]) +
        (t[4] ? '<span class="badge" aria-label="' + t[4] + (t[0] === 'tasks' ? ' due' : ' warnings') + '">' + t[4] + '</span>' : '') + '</a>';
    }).join('');
  }

  // ---------------------------------------------------------------- Today card (home)
  function datesLine(g) {
    var ci = CS.dayLabel(g.checkin_date) + (CS.fmtTime(g.checkin_time) ? ' ' + CS.fmtTime(g.checkin_time) : '');
    var co = CS.dayLabel(g.checkout_date) + (CS.fmtTime(g.checkout_time) ? ' ' + CS.fmtTime(g.checkout_time) : '');
    var n = g.nights != null ? g.nights : CS.daysBetween(g.checkin_date, g.checkout_date);
    return ci + ' → ' + co + ' · ' + CS.plural(n, 'night');
  }
  function todayCard(openLink) {
    var p = state.payload, st = CS.todayCardState(p, p.today);
    if (!st.guest) return '<div class="card"><span class="cap up">' + esc(st.label) + '</span><p class="sub" style="margin-top:8px">The house is free tonight. The next stay will show here.</p></div>';
    var g = st.guest, ret = CS.returningLabel(g, true);
    var co = CS.fmtTime(g.checkout_time);
    var head = '<div class="row-between"><span class="cap up">' + esc(st.label) + '</span>' + (st.pill ? pill(st.pill.tone, toneIcon(st.pill.tone), st.pill.text) : '') + '</div>' +
      '<div class="row-wrap" style="margin-top:8px"><h2 class="ttl">' + esc(g.guest_name || 'Guest') + '</h2>' + (ret ? pill('brand', 'repeat', ret) : '') + '</div>' +
      '<p class="sub num" style="margin:4px 0 0">' + esc(CS.dayLabel(g.checkin_date) + ' → ' + CS.dayLabel(g.checkout_date) + ' · ' + CS.plural(g.nights != null ? g.nights : CS.daysBetween(g.checkin_date, g.checkout_date), 'night') + (co ? ' · check-out ' + co : '')) + '</p>';
    if (openLink) return '<div class="card">' + head + '<a class="btn btn-ghost btn-sm" href="#calendar/house" style="margin:8px 0 0 -12px">Open guest card' + ICON('chev', 's16') + '</a></div>';
    return '<a class="card" href="#calendar/house" style="display:block;color:inherit;text-decoration:none">' + head + '</a>';
  }
  function warnLine() {
    var s = CS.warningSummary(state.payload.warnings);
    if (!s.count) return '<a class="warnline calm" href="#calendar">' + ICON('check') + '<span><b>No warnings today</b></span><span class="chev">' + ICON('chev') + '</span></a>';
    var parts = s.text.split(' · ');
    return '<a class="warnline" href="#calendar/warnings">' + ICON('alert') + '<span><b>' + esc(parts[0]) + '</b>' + (parts.length > 1 ? ' · ' + esc(parts.slice(1).join(' · ')) : '') + '</span><span class="chev">' + ICON('chev') + '</span></a>';
  }
  function greetBlock() {
    var w = CS.weatherLine(state.payload.weather, state.payload.today);
    var line = w || CS.dayLong(state.payload.today);
    var stale = state.payload.weather && state.payload.weather.fetched_at && CS.weatherStale(state.payload.weather) ? ' · as of ' + CS.clockLabel(state.payload.weather.fetched_at) : '';
    return '<div class="greet"><h1 class="dxl"><span class="script">' + esc(CS.greeting() + (CS.greetingName(state.user) ? ',' : '')) + '</span> ' + esc(CS.greetingName(state.user)) + '</h1><div class="cap" style="margin-top:4px">' + esc(line + stale) + '</div></div>';
  }
  function footerLine() { return '<div class="help" style="text-align:center;margin-top:16px">v' + CFG.version + ' · <button class="btn btn-ghost btn-sm" type="button" data-act="signout" style="height:28px;padding:0 6px">Sign out</button></div>'; }

  function renderHome() {
    var el = $('v-home');
    if (!state.payload) { el.innerHTML = appbar({ brand: true }) + '<div class="screen">' + (state.error ? errBanner() : loadingBlock()) + '</div>'; return; }
    var staff = state.layout === 'staff', n = warnCount();
    var doors, bk = staff ? null : CS.bookingsToConfirmRow(state.access && state.access.role, state.bookings);
    if (staff) {
      doors = '<nav class="card list" aria-label="Staff">' +
        row({ icon: 'clip', title: 'Cleaning checklist', sub: 'Start or continue today’s turnover', door: 'checklist' }) +
        row({ icon: 'calendar', title: 'Guest Calendar Info', sub: 'Who is staying, who is next, warnings', href: '#calendar', count: n || '' }) +
        row({ icon: 'chat', title: 'Cassy · Telegram OPS', sub: 'Report, ask, log an expense', tg: LINKS.tgOps, external: true }) +
        '<div class="subrow"><a class="btn btn-secondary btn-sm" href="' + LINKS.quick + '">' + ICON('book', 's16') + 'Quick guide</a>' +
        '<span class="help">Two minutes on telling Cassy what happened, asking her anything, and logging what you spent.</span></div>' +
        row({ icon: 'book', title: 'Cascade Manual', sub: 'How we do things', door: 'manual' }) +
        (LINKS.pay ? row({ icon: 'cash', title: 'Payment Request', sub: state.payHint || 'Ask for your cleaning pay', href: LINKS.pay, subId: 'pay-sub' }) : '') + '</nav>';
    } else {
      doors = '<nav class="card list" aria-label="Admin">' +
        (bk ? row({ icon: 'clip', title: 'Bookings to confirm', sub: 'Open the pending bookings', href: bk.href, external: true, count: bk.count, countLabel: bk.n === 1 ? ' booking to confirm' : ' bookings to confirm' }) : '') +
        row({ icon: 'dash', title: 'Admin dashboard', sub: 'Today, bookings, money, operations', door: 'dashboard' }) +
        (trustOn ? '' : '<div class="help doornote">Sign-in is kept only on trusted devices</div>') +
        (CS.canEditRates(state.access && state.access.role) ? row({ icon: 'cash', title: 'Pay rates', sub: 'What a clean and its transport pay', href: '#payrates' }) : '') +
        (canReply() ? row({ icon: 'sparkles', title: 'Cassy reply', sub: 'Draft a warm reply to a guest message', href: '#reply' }) : '') +
        row({ icon: 'calendar', title: 'Guest Calendar Info', sub: 'Stays, blocked nights, warnings', href: '#calendar', count: n || '' }) +
        '<button class="rowi" type="button" data-act="cassy" aria-expanded="' + state.cassyOpen + '"><span class="lead">' + ICON('chat') + '</span><span class="mid"><span class="t">Cassy</span><span class="s">Finance, OPS and the quick guide</span></span><span class="chev turn">' + ICON('chev') + '</span></button>' +
        '<div class="submenu" id="cassy-sub"' + (state.cassyOpen ? '' : ' hidden') + '>' +
        tgA(LINKS.tgFinance, ICON('wallet', 's16') + 'Finance', 'chip') + tgA(LINKS.tgOps, ICON('wrench', 's16') + 'OPS', 'chip') +
        '<a class="chip" href="' + LINKS.quick + '">' + ICON('book', 's16') + 'Quick guide</a></div>' +
        row({ icon: 'book', title: 'Cascade Manual', sub: 'Operations manual', door: 'manual' }) + '</nav>';
    }
    el.innerHTML = appbar({ brand: true, refresh: true }) + '<div class="screen">' + errBanner() + greetBlock() +
      '<div class="stack">' + todayCard(staff) + warnLine() + doors + '</div>' + footerLine() + '</div>';
  }
  function loadingBlock() { return '<div class="stack" style="margin-top:16px"><div class="skel" style="height:40px;width:70%"></div><div class="skel" style="height:110px"></div><div class="skel" style="height:240px"></div></div>'; }

  // ---------------------------------------------------------------- guest card (Guest Calendar Info)
  function guestBlock(g, kind) {
    var label = kind === 'house' ? 'In the house' : 'Next arrival';
    var st = kind === 'house' ? pill('ok', 'check', g.checkin_date === state.payload.today ? 'Arrived today' : 'Checked in') : pill('info', 'info', 'Arrives ' + CS.dayLabel(g.checkin_date));
    var ret = CS.returningLabel(g, false), src = CS.sourceLabel(g.source), earlier = CS.earlierLine(g);
    var info = '<div class="card" id="' + (kind === 'house' ? 'house' : 'next') + '"><div class="row-between"><span class="cap up">' + label + '</span>' + st + '</div>' +
      '<h3 class="ttl" style="margin-top:8px">' + esc(g.guest_name || 'Guest') + '</h3>' +
      '<div class="row-wrap" style="margin-top:6px">' + (ret ? pill('brand', 'repeat', ret) : '') + (src ? '<span class="pill p-neutral">' + esc(src) + '</span>' : '') + '</div>' +
      '<p class="sub num" style="margin:8px 0 0">' + esc(datesLine(g)) + '</p>' + (earlier ? '<p class="help num" style="margin:2px 0 0">' + esc(earlier) + '</p>' : '') + contactBlock(g) +
      (canReply() && g.uid ? '<a class="btn btn-secondary btn-sm" href="./guest/#' + encodeURIComponent(g.uid) + '" style="margin-top:12px">' + ICON('idcard', 's16') + 'Add guest details</a>' : '') + '</div>';
    var groups = CS.parseNotes(g.notes), notes = '';
    if (groups.length) {
      notes = '<div class="card"><h3 class="hd">Notes from earlier stays</h3><div style="margin-top:10px">' + groups.map(function (gr) {
        return '<div class="notegroup">' + (gr.date ? '<p class="help num" style="margin-bottom:4px">' + esc(CS.dayLabel(gr.date) + ' ' + gr.date.slice(0, 4)) + '</p>' : '') +
          '<ul class="notes">' + gr.points.map(function (p) { return '<li>' + ICON('note') + '<span>' + esc(p) + '</span></li>'; }).join('') + '</ul></div>';
      }).join('') + '</div></div>';
    } else if (g.repeat === true) {
      notes = '<div class="card"><h3 class="hd">Notes from earlier stays</h3><p class="sub" style="margin-top:8px">Nothing was noted last time.</p></div>';
    }
    var idcard = '<div class="card"><h3 class="hd">Guest ID</h3><div style="margin-top:10px">' +
      (g.id_photo_path ? '<div class="idphoto" data-idpath="' + esc(g.id_photo_path) + '"><span class="help">Loading the photo…</span></div><p class="help" style="margin:10px 0 0">Check the face and the name against the guest at the door.</p>'
        : '<div class="idphoto empty">No ID photo to show for this guest.</div>') + '</div></div>';
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
  function toast(msg) {
    var t = $('cs-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cs-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); t.textContent = ''; }, 2000);
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
        return fetch(r.data.signedUrl, { cache: 'no-store', referrerPolicy: 'no-referrer' });
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
  function dayStatusOf(iso) { var p = state.payload; return CS.dayStatus(iso, p.calendar || [], p.day_flags, p.warnings); }
  // Three primary looks that differ by pattern, not only colour: free = outlined card, blocked = hatched with the reason icon,
  // booked = filled with the brand bar. Secondary flags sit top-right as small icons. Every day opens the day sheet.
  function calendarGrid() {
    var p = state.payload, m = monthState(), cells = CS.monthGrid(m.y, m.m);
    var dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(function (d) { return '<div class="dow" aria-hidden="true">' + d + '</div>'; }).join('');
    var body = cells.map(function (c) {
      if (!c.iso) return '<div class="d off" aria-hidden="true"></div>';
      var ds = dayStatusOf(c.iso), booked = ds.primary === 'booked', blk = ds.primary === 'blocked';
      var cls = 'd s-' + ds.primary + (c.iso < p.today ? ' past' : '') + (c.iso === p.today ? ' today' : '') + (booked ? ' stay' : '') + (booked && ds.cont ? ' cont' : '') + (blk ? ' blk' : '');
      var fl = ds.flags.length ? '<span class="fl" aria-hidden="true">' + ds.flags.slice(0, 3).map(function (f) { return ICON(FLAG_ICON[f.kind] || 'note', 's12'); }).join('') + '</span>' : '';
      var inner = '<span class="n">' + (+c.iso.slice(8)) + '</span>' + (booked && ds.startsHere ? '<span class="ini">' + esc(CS.initialOf(ds.stay.guest_name)) + '</span>' : '') +
        (blk ? '<span class="g">' + ICON(BLOCK_ICON[ds.block.block_reason] || 'lock', 's12') + '</span>' : '') + fl;
      var label = CS.dayLong(c.iso) + (c.iso === p.today ? ', today' : '') + ', ' + (booked ? 'booked, ' + ds.why : blk ? 'blocked, ' + ds.why : 'free') +
        (ds.flags.length ? '; ' + ds.flags.map(function (f) { return CS.flagName(f.kind); }).join(', ') : '');
      return '<button class="' + cls + '" type="button" data-day="' + c.iso + '" aria-label="' + esc(label) + '" aria-haspopup="dialog">' + inner + '</button>';
    }).join('');
    return '<div class="cal" role="group" aria-label="' + esc(CS.monthTitle(m.y, m.m)) + '">' + dows + body + '</div>';
  }
  function legend() {
    var it = function (cls, t) { return '<span><i class="lg ' + cls + '"></i>' + t + '</span>'; };
    var fi = function (k) { return '<span>' + ICON(FLAG_ICON[k], 's12') + CS.flagName(k) + '</span>'; };
    return '<div class="legend">' + it('lg-free', 'Free') + it('lg-blk', 'Blocked') + it('lg-booked', 'Booked') + it('lg-today', 'Today') + '</div>' +
      '<div class="legend legend2">' + CS.FLAG_KINDS.map(fi).join('') + '<span class="help">Tap a day for details</span></div>';
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
  function renderCalendar() {
    var el = $('v-calendar');
    if (!state.payload) { el.innerHTML = appbar({ title: 'Guest Calendar Info', back: '#home', refresh: true }) + '<div class="screen">' + (state.error ? errBanner() : loadingBlock()) + '</div>'; return; }
    var p = state.payload, m = monthState(), rows = p.calendar || [];
    var prevOk = CS.monthInRange(m.m === 1 ? m.y - 1 : m.y, m.m === 1 ? 12 : m.m - 1, p.today), nextOk = CS.monthInRange(m.m === 12 ? m.y + 1 : m.y, m.m === 12 ? 1 : m.m + 1, p.today);
    var upcoming = rows.filter(function (r) { return r.status === 'confirmed' && r.checkout_date >= p.today; }).slice(0, 10);
    var blocked = CS.blockedLines(rows, p.today);
    var confirmedAll = rows.filter(function (r) { return r.status === 'confirmed'; });
    var html = appbar({ title: 'Guest Calendar Info', back: '#home', refresh: true }) + '<div class="screen">' + errBanner() +
      '<div class="calhdr"><button class="iconbtn" type="button" data-act="prev" aria-label="Previous month"' + (prevOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('back', 's24') + '</button><h2 class="dlg">' + esc(CS.monthTitle(m.y, m.m)) + '</h2><button class="iconbtn" type="button" data-act="next" aria-label="Next month"' + (nextOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('chev', 's24') + '</button></div>' +
      calendarGrid() +
      legend();
    html += '<div class="sect"><span class="cap up">In the house</span>' + (p.current_guest ? '<div class="stack">' + guestBlock(p.current_guest, 'house') + '</div>' : '<div class="card"><p class="sub">No guest in the house tonight.</p></div>') + '</div>';
    html += '<div class="sect"><span class="cap up">Next</span>' + (p.next_guest ? '<div class="stack">' + guestBlock(p.next_guest, 'next') + '</div>' : '<div class="card"><p class="sub">No arrival in the next 60 days.</p></div>') + '</div>';
    if (upcoming.length) {
      html += '<div class="sect"><span class="cap up">Coming up</span><div class="stack">' + upcoming.map(function (r) {
        var i = confirmedAll.indexOf(r), src = CS.sourceLabel(r.source);
        return '<div class="card staycard" id="stay-' + i + '"><div class="strong">' + esc(r.guest_name || 'Guest') + (src ? ' · ' + esc(src) : '') + '</div><div class="sub num" style="font-size:13px;line-height:18px">' + esc(CS.stayDates(r)) + '</div></div>';
      }).join('') + '</div></div>';
    }
    if (blocked.length) {
      html += '<div class="sect"><span class="cap up">Blocked nights</span><ul class="wlist">' + blocked.map(function (l) {
        return '<li>' + ICON(l.extra ? 'alert' : 'lock').replace('class="i"', 'class="i ' + (l.extra ? 'c-warn' : 'c-fg2') + '"') + '<span class="num">' + esc(CS.blockedLineText(l)) + '</span></li>';
      }).join('') + '</ul></div>';
    }
    var wi = warningItems();
    html += '<div class="sect" id="warnings"><span class="cap up">Warnings</span>' + (wi.length ? '<ul class="wlist">' + wi.join('') + '</ul>' : '<div class="card"><p class="sub">No warnings today.</p></div>') + '</div>';
    html += '<div class="help" style="text-align:center;margin-top:14px">Updated ' + esc(CS.agoLabel(p.generated_at)) + '</div></div>';
    el.innerHTML = html; loadIdPhotos(el);
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
      sh.innerHTML = '<div class="sr" id="cs-live" role="status" aria-live="polite"></div><div id="cs-body"></div>'; document.body.appendChild(sh);
    }
    return { sheet: sh, scrim: $('cal-scrim') };
  }
  function openSheet(kind, key) {
    state.sheet = { kind: kind, key: key, form: { kind: 'brownout', label: '' }, busy: false, err: '', msg: '', missing: false };
    var e = sheetEls(); $('cs-live').textContent = ''; drawSheet();
    e.sheet.classList.add('on'); e.sheet.setAttribute('aria-hidden', 'false'); e.scrim.classList.add('on');
    var h = $('cs-h'); if (h) h.focus();
  }
  function closeSheet() {
    var S = state.sheet; if (!S) return; state.sheet = null;
    var e = sheetEls(), attr = S.kind === 'day' ? 'data-day' : 'data-warn';
    e.sheet.classList.remove('on'); e.sheet.setAttribute('aria-hidden', 'true'); e.scrim.classList.remove('on');
    var back = Array.prototype.filter.call(document.querySelectorAll('[' + attr + ']'), function (b) { return b.getAttribute(attr) === S.key; })[0];
    if (back) back.focus();
  }
  function sheetLive(msg) { var l = $('cs-live'); if (l) l.textContent = msg || ''; }
  function findWarn(key) { return ((state.payload && state.payload.warnings) || []).filter(function (w) { return warnKey(w) === key; })[0] || null; }
  function role() { return state.access && state.access.role; }
  function daySheet(S) {
    var p = state.payload, ds = dayStatusOf(S.key), canFlag = CS.canFlagDays(role());
    var prim = ds.primary === 'booked' ? pill('brand', 'house', 'Booked') : ds.primary === 'blocked' ? pill('neutral', 'lock', 'Blocked') : pill('ok', 'check', 'Free');
    var html = '<h2 class="ttl" id="cs-h" tabindex="-1">' + esc(CS.dayLong(S.key)) + '</h2><div class="row-wrap" style="margin-top:8px">' + prim + '<span class="sub">' + esc(ds.why) + '</span></div>';
    if (ds.stay) {
      var all = (p.calendar || []).filter(function (r) { return r.status === 'confirmed'; }), src = CS.sourceLabel(ds.stay.source);
      html += '<p class="sub num" style="margin:8px 0 0">' + esc(CS.stayDates(ds.stay) + (src ? ' · ' + src : '')) + '</p>' +
        (ds.stay.checkout_date >= p.today ? '<button class="btn btn-ghost btn-sm" type="button" data-stay="' + all.indexOf(ds.stay) + '" style="margin:4px 0 0 -12px">Show the stay' + ICON('chev', 's16') + '</button>' : '');
      if (ds.block) html += '<p class="help" style="margin-top:4px">Also held on the calendar: ' + esc(ds.blockWhy) + '</p>';
    }
    html += '<div class="cap up" style="margin:14px 0 6px">Also on this day</div>';
    html += ds.flags.length ? '<ul class="wlist">' + ds.flags.map(function (f) {
      var lbl = f.label && f.label !== CS.flagName(f.kind) ? ' · ' + esc(f.label) : '';
      return '<li>' + ICON(FLAG_ICON[f.kind] || 'note').replace('class="i"', 'class="i ' + (f.kind === 'brownout' ? 'c-warn' : 'c-fg2') + '"') + '<span style="flex:1"><b>' + esc(CS.flagName(f.kind)) + '</b>' + lbl +
        (f.source === 'auto' ? ' <span class="help">(added automatically)</span>' : '') + '</span>' +
        (canFlag && f.source === 'manual' && f.id ? '<button class="btn btn-ghost btn-sm" type="button" data-act="flag-clear" data-id="' + esc(f.id) + '"' + (S.busy ? ' disabled' : '') + ' aria-label="' + esc('Remove ' + CS.flagName(f.kind) + (f.label ? ': ' + f.label : '')) + '">Remove</button>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="help">Nothing else noted.</p>';
    if (canFlag) {
      html += '<div class="cap up" style="margin:14px 0 6px">Add a note for this day</div>';
      if (S.missing) html += '<p class="help">Available after the next update.</p>';
      else html += '<div class="stack"><div class="field"><label for="df-kind">Kind</label><select class="sel" id="df-kind" style="max-width:none;text-align:left;text-align-last:left">' +
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
    var S = state.sheet; if (!S || !state.payload) return;
    var e = sheetEls(), had = e.sheet.contains(document.activeElement);
    $('cs-body').innerHTML = (S.kind === 'day' ? daySheet(S) : warnSheet(S)) +
      (S.err ? '<div class="errbox" style="margin-top:12px">' + ICON('alert') + '<span>' + esc(S.err) + '</span></div>' : '') +
      (S.msg ? '<div class="okbox" style="margin-top:12px">' + ICON('check') + '<span>' + esc(S.msg) + '</span></div>' : '') +
      '<button class="btn btn-ghost btn-block" type="button" data-act="sheet-close" style="margin-top:12px">Close</button>';
    if (had && !e.sheet.contains(document.activeElement)) { var h = $('cs-h'); if (h) h.focus(); }
  }
  function sheetCall(name, args, okMsg) {
    var S = state.sheet; if (!S || S.busy) return;
    S.busy = true; S.err = ''; S.msg = ''; drawSheet();
    sb.rpc(name, args).then(function (r) {
      if (r.error) throw r.error;
      if (r.data && r.data.ok === false) throw { message: r.data.error || 'not ok' };
      S.msg = okMsg; S.form.label = ''; sheetLive(okMsg);
      return Promise.all([loadHome(), loadTasks()]);
    }).catch(function (e) {
      if (CS.rpcMissing(e)) { S.missing = true; sheetLive('Available after the next update.'); return; }
      S.err = e && e.code === '42501' ? 'Only an owner or admin can change this.' : 'That did not save. Check your signal and try again.'; sheetLive(S.err);
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
      ((t.priority === 'urgent' || t.priority === 'high') && !done ? pill(t.priority === 'urgent' ? 'danger' : 'warn', 'alert', t.priority) : '');
    return '<div class="payrow taskrow' + (done ? ' off' : '') + '"><button class="chk" type="button" role="checkbox" aria-checked="' + done + '" aria-label="' + esc((done ? 'Done: ' : 'Mark done: ') + t.title) + '" data-act="' + (done ? 'task-undo' : 'task-done') + '" data-task="' + esc(key) + '">' + ICON('check', 's16') + '</button>' +
      '<div><div class="t"><span' + (done ? ' style="text-decoration:line-through;color:var(--fg-2)"' : '') + '>' + esc(t.title) + '</span></div>' +
      (t.detail ? '<span class="s" style="white-space:pre-line">' + esc(t.detail) + '</span>' : '') +
      '<span class="s' + (due === 'overdue' && !done ? ' c-danger' : '') + '">' + esc(meta.join(' · ')) + '</span>' +
      (flags ? '<div class="row-wrap" style="margin-top:6px">' + flags + '</div>' : '') + '</div></div>';
  }
  function addReminderCard() {
    var a = state.add, opts = '<option value="">Anyone / nobody yet</option>' + (state.assignees || []).map(function (u) { return '<option value="' + esc(u.user_id) + '"' + (a.who === u.user_id ? ' selected' : '') + '>' + esc(u.label + ' (' + u.role + ')') + '</option>'; }).join('');
    return '<div class="card"><h2 class="hd">Add a reminder</h2><div class="stack" style="margin-top:10px">' +
      '<div class="field"><label for="t-title">What needs doing</label><div class="input"><input id="t-title" maxlength="200" value="' + esc(a.title) + '" autocomplete="off"></div></div>' +
      '<div class="field"><label for="t-due">Due (optional)</label><div class="input"><input id="t-due" type="date" value="' + esc(a.due) + '"></div></div>' +
      '<div class="field"><label for="t-who">For</label><select class="sel" id="t-who" style="max-width:none;text-align:left;text-align-last:left">' + opts + '</select></div>' +
      '<div class="field"><label for="t-note">Note (optional)</label><div class="input"><input id="t-note" maxlength="1000" value="' + esc(a.note) + '" autocomplete="off"></div></div>' +
      (a.err ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(a.err) + '</span></div>' : '') +
      '<div class="row-wrap"><button class="btn btn-primary" type="button" data-act="task-add-save"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Adding…' : 'Add reminder') + '</button><button class="btn btn-ghost" type="button" data-act="task-add-cancel">Cancel</button></div></div></div>';
  }
  function renderTasks() {
    var el = $('v-tasks'), head = appbar({ title: 'Tasks', refresh: true });
    if (!state.tasks) { el.innerHTML = head + '<div class="screen">' + (state.tasksErr ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.tasksErr) + ' <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>' : loadingBlock()) + '</div>'; return; }
    var T = state.tasks, groups = CS.taskGroups(T.tasks.filter(function (t) { return state.showDone || t.status !== 'done'; }), T.today), body = '';
    if (state.lastDone) body += '<div class="okbox" role="status">' + ICON('check') + '<span>' + esc(state.lastDone.done ? 'Marked done: ' : 'Back on the list: ') + esc(state.lastDone.title) +
      (state.lastDone.source === 'verifier_findings' ? '' : ' <button class="btn btn-ghost btn-sm" type="button" data-act="task-' + (state.lastDone.done ? 'undo' : 'done') + '" data-task="' + esc(state.lastDone.source + ':' + state.lastDone.id) + '">' + (state.lastDone.done ? 'Undo' : 'Done again') + '</button>') + '</span></div>';
    if (state.tasksErr) body += '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.tasksErr) + '</span></div>';
    if (manager()) body += state.add ? addReminderCard() : '<button class="btn btn-secondary" type="button" data-act="task-add-open">' + ICON('plus', 's16') + 'Add a reminder</button>';
    if (!groups.length) body += '<div class="card empty"><div class="disc">' + ICON('checks') + '</div><h2 class="hd">Nothing to do</h2><p>' + (manager() ? 'Add a reminder, or wait for a cleaning issue or a check to land here.' : 'Nothing is waiting for you.') + '</p></div>';
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
    }).then(function () { state.tasksLoading = false; if (state.layout && current !== 'door') { if (current === 'tasks') renderTasks(); renderTabs(current); } });
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
    var call = t.source === 'verifier_findings' ? sb.rpc('ack_verifier_finding_v1', { p_key: t.id })
      : sb.rpc('task_set_done_v1', { p_property_id: pid(), p_source: t.source, p_id: t.id, p_done: done });
    var msg = '';
    call.then(function (r) { if (r.error) throw r.error; }).catch(function (e) {
      t.status = done ? 'open' : 'done'; state.lastDone = null;
      msg = e && (e.code === '42501' || e.code === 'P0002') ? 'That task is not yours to change.' : 'That did not save. Check your signal and try again.';
    }).then(function () { return loadTasks(); }).then(function () { if (msg) { state.tasksErr = msg; renderTasks(); } });
  }
  function openAdd() {
    state.add = { title: '', due: '', who: '', note: '', err: '', busy: false, key: 'rem-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)) };
    if (!state.assignees) sb.rpc('task_assignees_v1', { p_property_id: pid() }).then(function (r) { if (!r.error && r.data && r.data.staff) { state.assignees = r.data.staff; if (state.add) renderTasks(); } });
    renderTasks(); var t = $('t-title'); if (t) t.focus();
  }
  function saveAdd() {
    var a = state.add; if (!a || a.busy) return;
    var bad = CS.reminderProblem(a.title); if (bad) { a.err = bad; renderTasks(); return; }
    a.busy = true; a.err = ''; renderTasks();
    sb.rpc('task_add_reminder_v1', { p_property_id: pid(), p_title: a.title.trim(), p_due_at: CS.dueFromDate(a.due), p_assignee_user_id: a.who || null, p_note: a.note.trim() || null, p_idempotency_key: a.key }).then(function (r) {
      if (r.error) throw r.error;
      state.add = null; state.lastDone = null; return loadTasks();
    }).catch(function (e) {
      a.busy = false; a.err = e && e.code === '42501' ? 'Only the owner and admins can add reminders.' : e && e.code === '22023' && e.message ? e.message : 'That did not save. Check your signal and try again.'; renderTasks();
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
      '<button class="btn btn-primary" type="button" data-act="rate-save" disabled>' + (state.rateSaving ? 'Saving…' : 'Save new rate') + '</button></div></div>' +
      '<div><div class="cap up" style="margin-bottom:6px">History</div><div class="card list">' + (R.history || []).map(function (h) {
        return '<div class="rowi" style="cursor:default"><span class="lead">' + ICON('cash') + '</span><span class="mid"><span class="t num">' + esc(CS.dayLabel(h.effective_from) + ' ' + h.effective_from.slice(0, 4)) + '</span><span class="s num">' + esc(CS.rateLine(h, P.peso)) + (h.note ? ' · ' + esc(h.note) : '') + '</span></span></div>';
      }).join('') + '</div></div></div></div>';
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
      state.ratesErr = e && (e.code === '42501' || e.message === 'denied') ? 'Only the owner and admins can see pay rates.' : 'Live information needs a connection.';
    }).then(function () { if (current === 'payrates') renderPayRates(); });
  }
  function saveRate() {
    var f = state.rateForm, R = state.rates; if (!f || !R || state.rateSaving) return;
    if (CS.rateProblem(f, CS.earliestRateStart(R.history, R.today), R.today)) { syncRate(); return; }
    state.rateSaving = true; f.err = ''; syncRate();
    sb.rpc('admin_add_pay_rate_v1', CS.rateArgs(pid(), f)).then(function (r) {
      if (r.error) throw r.error;
      state.rateForm = null; state.rateSaving = false; return loadRates();
    }).catch(function (e) {
      state.rateSaving = false; f.err = e && e.code === '42501' ? 'Only the owner and admins can change pay rates.' : e && e.code === '22023' && e.message ? e.message : 'That did not save. Check your signal and try again.'; syncRate();
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
      return fetch(CFG.url + '/functions/v1/guest-reply-draft', { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'application/json' }, body: body })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, j: j }; }); });
    }).catch(function () { return { status: 0, j: null }; }).then(function (o) {
      if (state.reply !== R) return; // signed out meanwhile
      R.busy = false;
      var X = o.status === 200 ? CS.replyResult(o.j) : null;
      if (X) { R.result = X; R.step = 'done'; R.copied = -1; R.err = ''; R.signout = false; }
      else { R.err = CS.replyErrorText(o.status === 200 ? 502 : o.status, o.j && o.j.error); R.signout = o.status === 401; }
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
    var theme = window.CSTheme.get(), staff = state.layout === 'staff';
    var chip = function (v, t) { return '<button class="chip" type="button" data-theme="' + v + '"' + (theme === v ? ' style="border-color:var(--primary);color:var(--primary)" aria-pressed="true"' : ' aria-pressed="false"') + '>' + t + '</button>'; };
    $('v-more').innerHTML = appbar({ title: 'More' }) + '<div class="screen"><div class="stack">' +
      '<div class="card list">' + (canReply() ? row({ icon: 'sparkles', title: 'Cassy reply', sub: 'Draft a warm reply to a guest message', href: '#reply' }) : '') + row({ icon: 'book', title: 'Quick guide', sub: 'How to use Cassy in Telegram', href: LINKS.quick }) +
      (staff ? '' : row({ icon: 'wallet', title: 'Cassy · Telegram Finance', sub: 'Open in Telegram', tg: LINKS.tgFinance, external: true })) + row({ icon: 'book', title: 'Cascade Manual', sub: 'How we do things', door: 'manual' }) + '</div>' +
      '<div class="card"><h2 class="hd">Appearance</h2><div class="row-wrap" style="margin-top:10px">' + chip('auto', 'Automatic') + chip('light', 'Light') + chip('dark', 'Dark') + '</div></div>' +
      '<div class="card" id="install-card" hidden><h2 class="hd">Install the app</h2><p class="sub" style="margin-top:6px">Put Cascade Staff on your Home Screen.</p><button class="btn btn-secondary" id="install-btn" type="button" style="margin-top:10px">' + ICON('plus', 's16') + 'Install</button></div>' +
      '<div class="card"><h2 class="hd">Signed in as ' + esc(state.name) + '</h2><p class="sub" style="margin-top:4px">' + esc(state.access ? state.access.role : '') + '</p><button class="btn btn-secondary" type="button" data-act="signout" style="margin-top:10px">' + ICON('logout', 's16') + 'Sign out</button>' +
      '<p class="help" style="margin-top:8px">Signs you out of the admin dashboard as well, on this phone.</p></div></div>' +
      '<div class="help" style="text-align:center;margin-top:16px">Cascade Staff v' + CFG.version + '</div></div>';
    syncInstall();
  }

  // ---------------------------------------------------------------- data
  function loadAccess() {
    return sb.rpc('current_staff_access').then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }
  function signOutTo(msg) {
    closeSheet(); dropPhotos(); state.reply = null; var rb = $('rp-body'); if (rb) rb.innerHTML = ''; rpLive(''); state.payload = null; state.bookings = null; state.access = null; state.layout = null; state.month = null; state.error = '';
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
      state.payload = r.data; state.loadedAt = Date.now(); state.error = '';
      refreshWeather(); loadPayHint(); loadBookingsToConfirm();
    }).catch(function () {
      state.error = state.payload ? 'Live information needs a connection. Showing the last update.' : 'Live information needs a connection.';
    }).then(function () { state.loading = false; if (state.layout) render(); });
  }
  // weather-proxy refreshes its own cache; if it rejects the user's token, the line simply says "as of HH:MM".
  function refreshWeather() {
    var w = state.payload && state.payload.weather;
    if (!CS.weatherStale(w)) return;
    sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token; if (!tok) return;
      return fetch(CFG.url + '/functions/v1/weather-proxy', { headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key }, cache: 'no-store' })
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
    var fail = function (e) { state.bookings = null; if (!bkWarned) { bkWarned = true; console.warn('bookings to confirm unavailable', e && e.message ? e.message : e); } };
    sb.rpc('staff_inquiry_payments_v1', { p_property_id: pid() }).then(function (r) {
      if (r.error) return fail(r.error);
      state.bookings = CS.bookingsToConfirmCount(r.data); // the count only; the payment rows are never kept
    }).catch(fail).then(function () { if (current === 'home' && state.layout) renderHome(); });
  }

  // ---------------------------------------------------------------- router
  function route() {
    var h = (location.hash || '').replace(/^#/, ''), parts = h.split('/'), v = parts[0] || 'home';
    if (!state.layout) return;
    if (VIEWS.indexOf(v) < 0 || v === 'signin') v = 'home';
    if (v === 'door' && !(doorDef(parts[1]) && CS.doorFramed(parts[1], state.layout, trustOn))) v = 'home';
    if (v === 'payrates' && !CS.canEditRates(state.access && state.access.role)) v = 'home';
    if (v === 'reply' && !canReply()) v = 'home';
    if (v === 'door') { doorKey = parts[1]; render('door'); window.scrollTo(0, 0); return; }
    leaveDoor(); render(v);
    var t = parts[1] && $(parts[1]); if (t) t.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  }
  var current = 'home', doorKey = '';
  function render(v) {
    v = v || current; current = v;
    setView(v);
    if (v === 'door') { renderDoor(); return; }
    renderTabs(v);
    if (v === 'home') renderHome(); else if (v === 'calendar') renderCalendar(); else if (v === 'tasks') renderTasks(); else if (v === 'payrates') { renderPayRates(); if (!state.rates) loadRates(); } else if (v === 'reply') renderReply(); else if (v === 'more') renderMore();
    var typing = document.activeElement && /^df-(label|kind)$/.test(document.activeElement.id || '');
    if (state.sheet) { if (v !== 'calendar') closeSheet(); else if (!typing) drawSheet(); }
  }
  // A door opens in the frame once per visit; coming back to the same door (a re-render) keeps the page where it is.
  function renderDoor() {
    var d = doorDef(doorKey), f = $('door-frame'); if (!d) return;
    $('door-title').textContent = d.title; f.title = d.title;
    $('door-back').innerHTML = ICON('back', 's24') + 'Back';
    if (f.getAttribute('data-door') !== doorKey) { f.setAttribute('data-door', doorKey); f.src = d.url; }
  }
  function leaveDoor() { var f = $('door-frame'); if (f && f.getAttribute('data-door')) { f.removeAttribute('data-door'); f.src = 'about:blank'; } }
  function enter() {
    state.layout = CS.layoutForRole(state.access.role);
    state.name = CS.deriveDisplayName(state.user);
    if (!/^#(home|calendar|tasks|payrates|reply|more)/.test(location.hash)) history.replaceState(null, '', '#home');
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
      if (r.error) { var offline = /fetch|network/i.test(r.error.message || '') || r.error.status === 0; showSignin(offline ? 'No connection.' : bad); return; }
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
    var t = ev.target.closest('[data-act],[data-stay],[data-theme],[data-day],[data-warn]'); if (!t || t.getAttribute('data-act') === 'tasks-showdone') return;
    var a = t.getAttribute('data-act');
    if (a === 'refresh') { loadHome(); loadTasks(); if (current === 'payrates') loadRates(); }
    else if (a === 'task-done' || a === 'task-undo') setTaskDone(t.getAttribute('data-task'), a === 'task-done');
    else if (a === 'task-add-open') openAdd();
    else if (a === 'task-add-cancel') { state.add = null; renderTasks(); }
    else if (a === 'task-add-save') saveAdd();
    else if (a === 'rate-save') saveRate();
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
    else if (a === 'cassy') { state.cassyOpen = !state.cassyOpen; t.setAttribute('aria-expanded', state.cassyOpen); var s = $('cassy-sub'); if (s) s.hidden = !state.cassyOpen; }
    else if (t.hasAttribute('data-stay')) {
      closeSheet(); var el = $('stay-' + t.getAttribute('data-stay')); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1400); }
    } else if (t.hasAttribute('data-theme')) { window.CSTheme.set(t.getAttribute('data-theme')); renderMore(); }
  });
  // Reminder and pay-rate forms: remember what is typed (a refresh must not lose it) without redrawing under the keyboard.
  document.addEventListener('input', function (ev) {
    var id = ev.target && ev.target.id, a = state.add, f = state.rateForm;
    if (state.sheet && id === 'df-label') state.sheet.form.label = ev.target.value; else if (state.sheet && id === 'df-kind') state.sheet.form.kind = ev.target.value;
    if (state.reply && id === 'rp-text') { state.reply.text = ev.target.value; state.reply.err = ''; } else if (state.reply && id === 'rp-name') state.reply.name = ev.target.value;
    if (a && id === 't-title') a.title = ev.target.value; else if (a && id === 't-due') a.due = ev.target.value; else if (a && id === 't-note') a.note = ev.target.value; else if (a && id === 't-who') a.who = ev.target.value;
    else if (f && /^r-(from|regular|general|transport|note)$/.test(id || '')) { f[id.slice(2)] = ev.target.value; f.err = ''; syncRate(); }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'rp-file') { var f0 = ev.target.files && ev.target.files[0]; if (f0) pickShot(f0); return; }
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
    card.hidden = standalone || !(deferredPrompt || isIOS);
    if (btn) btn.onclick = function () {
      if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function () { deferredPrompt = null; syncInstall(); }); }
      else showA2hs();
    };
  }
  function seen() { try { return !!localStorage.getItem('cs_a2hs_seen'); } catch (e) { return false; } }
  function showA2hs() { $('a2hs-share').innerHTML = ICON('share'); $('a2hs').classList.add('on'); $('a2hs').setAttribute('aria-hidden', 'false'); $('a2hs-scrim').classList.add('on'); }
  function hideA2hs() { $('a2hs').classList.remove('on'); $('a2hs').setAttribute('aria-hidden', 'true'); $('a2hs-scrim').classList.remove('on'); try { localStorage.setItem('cs_a2hs_seen', '1'); } catch (e) {} }
  function maybeIosHint() { if (isIOS && !standalone && !seen()) setTimeout(showA2hs, 800); }
  $('a2hs-ok').addEventListener('click', hideA2hs); $('a2hs-scrim').addEventListener('click', hideA2hs);

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  boot();
})();
