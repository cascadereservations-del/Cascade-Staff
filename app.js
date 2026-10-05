/* Cascade Staff - staff app and the official mobile admin side (SPEC-36, D-299.3, D-300). One page, hash routes:
   #signin, #home, #calendar (or #calendar/house to scroll to the guest card), #more.
   Guest names, notes and ID photos live in memory for the open session only. Nothing personal is written to storage. */
(function () {
  'use strict';
  var CS = window.CS, ICON = window.ICON, esc = CS.esc;
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
    version: '2.0.0'
  };
  var LINKS = {
    checklist: 'https://cascadereservations-del.github.io/CH-Cleaners-Checklist/',
    dashboard: 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/today',
    manual: 'https://cascadereservations-del.github.io/Cascade-Manual/',
    quick: './quick/',
    tgOps: 'https://t.me/c/3798341977',
    tgFinance: 'https://t.me/c/3819352746',
    pay: './pay/'
  };

  // supabase-js default storage key on purpose: the dashboard on this origin is then signed in too (SPEC-36 section 5).
  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  var state = { access: null, user: null, name: '', layout: null, payload: null, loadedAt: 0, loading: false, error: '', month: null, cassyOpen: true, payHint: null, photos: {} };
  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['signin', 'home', 'calendar', 'more'];

  // ---------------------------------------------------------------- helpers
  function ext(href, inner, cls, extra) { return '<a class="' + (cls || '') + '" href="' + esc(href) + '" target="_blank" rel="noopener"' + (extra || '') + '>' + inner + '</a>'; }
  function row(opts) { // title and sub-title always on separate lines (D-300.7)
    var inner = '<span class="lead">' + ICON(opts.icon) + '</span><span class="mid"><span class="t">' + esc(opts.title) + '</span><span class="s"' + (opts.subId ? ' id="' + opts.subId + '"' : '') + '>' + esc(opts.sub || '') + '</span></span>' +
      (opts.count ? '<span class="count" aria-label="' + esc(opts.count + ' warnings') + '">' + esc(opts.count) + '</span>' : '') +
      '<span class="chev">' + ICON(opts.external ? 'ext' : 'chev', opts.external ? 's16' : '') + '</span>';
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
    $('tabbar').hidden = name === 'signin' || !state.layout;
  }
  function warnCount() { return state.payload ? (state.payload.warnings || []).length : 0; }
  function errBanner() {
    return state.error ? '<div class="errbox" role="alert">' + ICON('alert') + '<span>' + esc(state.error) + ' <button class="btn btn-ghost btn-sm" type="button" data-act="refresh">Try again</button></span></div>' : '';
  }

  // ---------------------------------------------------------------- tab bar
  function renderTabs(current) {
    var staff = state.layout === 'staff';
    var tabs = staff
      ? [['home', '#home', 'Today', 'house'], ['calendar', '#calendar', 'Calendar', 'calendar', warnCount()], ['pay', LINKS.pay, 'Tasks', 'tasks'], ['more', '#more', 'More', 'more']]
      : [['home', '#home', 'Home', 'house'], ['calendar', '#calendar', 'Calendar', 'calendar', warnCount()], ['more', '#more', 'More', 'more']];
    $('tabbar').innerHTML = tabs.map(function (t) {
      return '<a class="tab" href="' + esc(t[1]) + '"' + (t[0] === current ? ' aria-current="page"' : '') + '><span class="ico">' + ICON(t[3], 's24') + '</span>' + esc(t[2]) +
        (t[4] ? '<span class="badge" aria-label="' + t[4] + ' warnings">' + t[4] + '</span>' : '') + '</a>';
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
    return '<a class="warnline" href="#calendar">' + ICON('alert') + '<span><b>' + esc(parts[0]) + '</b>' + (parts.length > 1 ? ' · ' + esc(parts.slice(1).join(' · ')) : '') + '</span><span class="chev">' + ICON('chev') + '</span></a>';
  }
  function greetBlock() {
    var w = CS.weatherLine(state.payload.weather, state.payload.today);
    var line = w || CS.dayLong(state.payload.today);
    var stale = state.payload.weather && state.payload.weather.fetched_at && CS.weatherStale(state.payload.weather) ? ' · as of ' + CS.clockLabel(state.payload.weather.fetched_at) : '';
    return '<div class="greet"><h1 class="dxl">' + esc(CS.greeting() + ', ' + state.name) + '</h1><div class="cap" style="margin-top:4px">' + esc(line + stale) + '</div></div>';
  }
  function footerLine() { return '<div class="help" style="text-align:center;margin-top:16px">v' + CFG.version + ' · <button class="btn btn-ghost btn-sm" type="button" data-act="signout" style="height:28px;padding:0 6px">Sign out</button></div>'; }

  function renderHome() {
    var el = $('v-home');
    if (!state.payload) { el.innerHTML = appbar({ brand: true }) + '<div class="screen">' + (state.error ? errBanner() : loadingBlock()) + '</div>'; return; }
    var staff = state.layout === 'staff', n = warnCount();
    var doors;
    if (staff) {
      doors = '<nav class="card list" aria-label="Staff">' +
        row({ icon: 'clip', title: 'Cleaning checklist', sub: 'Start or continue today’s turnover', href: LINKS.checklist, external: true }) +
        row({ icon: 'calendar', title: 'Guest Calendar Info', sub: 'Who is staying, who is next, warnings', href: '#calendar', count: n || '' }) +
        row({ icon: 'chat', title: 'Cassy · Telegram OPS', sub: 'Report, ask, log an expense', href: LINKS.tgOps, external: true }) +
        '<div class="subrow"><a class="btn btn-secondary btn-sm" href="' + LINKS.quick + '">' + ICON('book', 's16') + 'Quick guide</a>' +
        '<span class="help">Two minutes on telling Cassy what happened, asking her anything, and logging what you spent.</span></div>' +
        row({ icon: 'book', title: 'Cascade Manual', sub: 'How we do things', href: LINKS.manual, external: true }) +
        (LINKS.pay ? row({ icon: 'cash', title: 'Payment Request', sub: state.payHint || 'Ask for your cleaning pay', href: LINKS.pay, subId: 'pay-sub' }) : '') + '</nav>';
    } else {
      doors = '<nav class="card list" aria-label="Admin">' +
        row({ icon: 'dash', title: 'Admin dashboard', sub: 'Today, bookings, money, operations', href: LINKS.dashboard, external: true }) +
        row({ icon: 'calendar', title: 'Guest Calendar Info', sub: 'Stays, blocked nights, warnings', href: '#calendar', count: n || '' }) +
        '<button class="rowi" type="button" data-act="cassy" aria-expanded="' + state.cassyOpen + '"><span class="lead">' + ICON('chat') + '</span><span class="mid"><span class="t">Cassy</span><span class="s">Open in Telegram</span></span><span class="chev turn">' + ICON('chev') + '</span></button>' +
        '<div class="submenu" id="cassy-sub"' + (state.cassyOpen ? '' : ' hidden') + '><span class="cap">Open in Telegram</span>' +
        ext(LINKS.tgFinance, ICON('wallet', 's16') + 'Finance', 'chip') + ext(LINKS.tgOps, ICON('wrench', 's16') + 'OPS', 'chip') +
        '<a class="chip" href="' + LINKS.quick + '">' + ICON('book', 's16') + 'Quick guide</a></div>' +
        row({ icon: 'book', title: 'Cascade Manual', sub: 'Operations manual', href: LINKS.manual, external: true }) + '</nav>';
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
    var info = '<div class="card"' + (kind === 'house' ? ' id="house"' : '') + '><div class="row-between"><span class="cap up">' + label + '</span>' + st + '</div>' +
      '<h3 class="ttl" style="margin-top:8px">' + esc(g.guest_name || 'Guest') + '</h3>' +
      '<div class="row-wrap" style="margin-top:6px">' + (ret ? pill('brand', 'repeat', ret) : '') + (src ? '<span class="pill p-neutral">' + esc(src) + '</span>' : '') + '</div>' +
      '<p class="sub num" style="margin:8px 0 0">' + esc(datesLine(g)) + '</p>' + (earlier ? '<p class="help num" style="margin:2px 0 0">' + esc(earlier) + '</p>' : '') + '</div>';
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
  function calendarGrid() {
    var p = state.payload, m = monthState(), rows = p.calendar || [], cells = CS.monthGrid(m.y, m.m), idx = {};
    var bo = {}; (p.warnings || []).forEach(function (w) { if (w.kind === 'brownout' && w.detail && w.detail.date) bo[w.detail.date] = 1; });
    var stays = rows.filter(function (r) { return r.status === 'confirmed'; }); stays.forEach(function (r, i) { idx[r.uid] = i; });
    var dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(function (d) { return '<div class="dow" aria-hidden="true">' + d + '</div>'; }).join('');
    var body = cells.map(function (c) {
      if (!c.iso) return '<div class="d off"></div>';
      var ds = CS.dayState(c.iso, rows), cls = 'd' + (c.iso < p.today ? ' past' : '') + (c.iso === p.today ? ' today' : '') + (ds.stay ? ' stay' : '') + (ds.stay && ds.cont ? ' cont' : '') + (ds.blocked && !ds.stay ? ' blk' : '');
      var day = +c.iso.slice(8), inner = day + (ds.stay && ds.startsHere ? '<span class="ini">' + esc(CS.initialOf(ds.stay.guest_name)) + '</span>' : '') +
        (ds.blocked && !ds.stay ? '<span class="g">' + ICON('zapoff', 's12') + '</span>' : (bo[c.iso] ? '<span class="g bo">' + ICON('zap', 's12') + '</span>' : ''));
      var label = CS.dayLong(c.iso) + (ds.stay ? ', stay' : ds.blocked ? ', blocked' : '') + (bo[c.iso] ? ', brownout' : '');
      if (ds.stay) return '<button class="' + cls + '" type="button" data-stay="' + idx[ds.stay.uid] + '" aria-label="' + esc(label) + '">' + inner + '</button>';
      return '<div class="' + cls + '" role="gridcell" aria-label="' + esc(label) + '">' + inner + '</div>';
    }).join('');
    return '<div class="cal" role="grid" aria-label="' + esc(CS.monthTitle(m.y, m.m)) + '">' + dows + body + '</div>';
  }
  function warningItems() {
    var p = state.payload, items = CS.orderWarnings(p.warnings).map(function (w) {
      if (w.kind === 'brownout') { var b = CS.brownoutText(w); return '<li>' + ICON('zap', '').replace('class="i"', 'class="i c-warn"') + '<span class="num"><b>' + esc(b.head) + '</b>' + (b.rest ? ' · ' + esc(b.rest) : '') + '</span></li>'; }
      if (w.kind === 'inventory') { var l = CS.lowStockText(w); return '<li>' + ICON('box').replace('class="i"', 'class="i c-danger"') + '<span><b>' + esc(l.head) + '</b> · ' + esc(l.rest) + '</span></li>'; }
      return '<li>' + ICON(w.severity === 'alert' ? 'alert' : 'info').replace('class="i"', 'class="i ' + (w.severity === 'alert' ? 'c-danger' : 'c-warn') + '"') + '<span><b>System check</b> · ' + esc(w.title) + '</span></li>';
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
    var blocked = rows.filter(function (r) { return r.status === 'blocked' && r.checkout_date >= p.today; });
    var confirmedAll = rows.filter(function (r) { return r.status === 'confirmed'; });
    var html = appbar({ title: 'Guest Calendar Info', back: '#home', refresh: true }) + '<div class="screen">' + errBanner() +
      '<div class="calhdr"><button class="iconbtn" type="button" data-act="prev" aria-label="Previous month"' + (prevOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('back', 's24') + '</button><h2 class="dlg">' + esc(CS.monthTitle(m.y, m.m)) + '</h2><button class="iconbtn" type="button" data-act="next" aria-label="Next month"' + (nextOk ? '' : ' disabled style="opacity:.35"') + '>' + ICON('chev', 's24') + '</button></div>' +
      calendarGrid() +
      '<div class="legend"><span><i style="background:var(--primary-soft);border-bottom:3px solid var(--primary)"></i>Guest stay</span><span><i style="background:var(--muted);border:1px solid var(--border)"></i>Blocked</span><span><i style="box-shadow:inset 0 0 0 2px var(--primary);background:var(--card)"></i>Today</span></div>';
    html += '<div class="sect"><span class="cap up">In the house</span>' + (p.current_guest ? '<div class="stack">' + guestBlock(p.current_guest, 'house') + '</div>' : '<div class="card"><p class="sub">No guest in the house tonight.</p></div>') + '</div>';
    html += '<div class="sect"><span class="cap up">Next</span>' + (p.next_guest ? '<div class="stack">' + guestBlock(p.next_guest, 'next') + '</div>' : '<div class="card"><p class="sub">No arrival in the next 60 days.</p></div>') + '</div>';
    if (upcoming.length) {
      html += '<div class="sect"><span class="cap up">Coming up</span><div class="stack">' + upcoming.map(function (r) {
        var i = confirmedAll.indexOf(r), src = CS.sourceLabel(r.source);
        return '<div class="card staycard" id="stay-' + i + '"><div class="strong">' + esc(r.guest_name || 'Guest') + (src ? ' · ' + esc(src) : '') + '</div><div class="sub num" style="font-size:13px;line-height:18px">' + esc(CS.stayDates(r)) + '</div></div>';
      }).join('') + '</div></div>';
    }
    if (blocked.length) {
      html += '<div class="sect"><span class="cap up">Blocked nights</span><ul class="wlist">' + blocked.map(function (r) {
        return '<li>' + ICON('zapoff').replace('class="i"', 'class="i c-fg2"') + '<span class="num"><b>' + esc(CS.dayLabel(r.checkin_date) + ' to ' + CS.dayLabel(CS.addDays(r.checkout_date, -1))) + '</b> · Blocked</span></li>';
      }).join('') + '</ul></div>';
    }
    var wi = warningItems();
    html += '<div class="sect"><span class="cap up">Warnings</span>' + (wi.length ? '<ul class="wlist">' + wi.join('') + '</ul>' : '<div class="card"><p class="sub">No warnings today.</p></div>') + '</div>';
    html += '<div class="help" style="text-align:center;margin-top:14px">Updated ' + esc(CS.agoLabel(p.generated_at)) + '</div></div>';
    el.innerHTML = html; loadIdPhotos(el);
  }

  // ---------------------------------------------------------------- More
  function renderMore() {
    var theme = window.CSTheme.get(), staff = state.layout === 'staff';
    var chip = function (v, t) { return '<button class="chip" type="button" data-theme="' + v + '"' + (theme === v ? ' style="border-color:var(--primary);color:var(--primary)" aria-pressed="true"' : ' aria-pressed="false"') + '>' + t + '</button>'; };
    $('v-more').innerHTML = appbar({ title: 'More' }) + '<div class="screen"><div class="stack">' +
      '<div class="card list">' + row({ icon: 'book', title: 'Quick guide', sub: 'How to use Cassy in Telegram', href: LINKS.quick }) +
      (staff ? '' : row({ icon: 'wallet', title: 'Cassy · Telegram Finance', sub: 'Open in Telegram', href: LINKS.tgFinance, external: true })) + row({ icon: 'book', title: 'Cascade Manual', sub: 'How we do things', href: LINKS.manual, external: true }) + '</div>' +
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
    dropPhotos(); state.payload = null; state.access = null; state.layout = null; state.month = null; state.error = '';
    return sb.auth.signOut().catch(function () {}).then(function () { showSignin(msg); });
  }
  function showSignin(msg) {
    setView('signin'); history.replaceState(null, '', '#signin');
    var e = $('si-err'); e.hidden = !msg; e.innerHTML = msg ? ICON('alert') + '<span>' + esc(msg) + '</span>' : '';
    $('si-pin').value = '';
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
      try { CS.assertNoMoney(r.data); } catch (e) { state.payload = null; state.error = 'This page was blocked because the data carried an amount or a contact detail. Tell Lloyd.'; return; }
      state.payload = r.data; state.loadedAt = Date.now(); state.error = '';
      refreshWeather(); loadPayHint();
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

  // ---------------------------------------------------------------- router
  function route() {
    var h = (location.hash || '').replace(/^#/, ''), parts = h.split('/'), v = parts[0] || 'home';
    if (!state.layout) return;
    if (VIEWS.indexOf(v) < 0 || v === 'signin') v = 'home';
    render(v);
    var t = parts[1] && $(parts[1]); if (t) t.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
  }
  var current = 'home';
  function render(v) {
    v = v || current; current = v;
    setView(v); renderTabs(v);
    if (v === 'home') renderHome(); else if (v === 'calendar') renderCalendar(); else if (v === 'more') renderMore();
  }
  function enter() {
    state.layout = CS.layoutForRole(state.access.role);
    state.name = CS.deriveDisplayName(state.user);
    if (!/^#(home|calendar|more)/.test(location.hash)) history.replaceState(null, '', '#home');
    route(); loadHome(); maybeIosHint();
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
  $('si-lock').innerHTML = ICON('lock').replace('class="i"', 'class="i" style="color:var(--fg-3)"');
  $('signin-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = $('si-name').value, pin = $('si-pin').value, btn = $('si-go');
    if (!name.trim() || !pin) { showSignin('Type your name and PIN.'); return; }
    btn.disabled = true;
    sb.auth.signInWithPassword({ email: CS.staffLoginEmail(name), password: CS.staffAuthPassword(pin) }).then(function (r) {
      if (r.error) { var offline = /fetch|network/i.test(r.error.message || '') || r.error.status === 0; showSignin(offline ? 'No connection.' : 'That name or PIN is not right.'); return; }
      state.user = r.data.user;
      return loadAccess().then(function (access) {
        var v = CS.accessVerdict(access);
        if (!v.ok) return signOutTo(v.message);
        state.access = access; enter();
      });
    }).catch(function () { showSignin('No connection.'); }).then(function () { btn.disabled = false; });
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act],[data-stay],[data-theme]'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (a === 'refresh') { loadHome(); }
    else if (a === 'signout') { signOutTo(''); }
    else if (a === 'prev') shiftMonth(-1);
    else if (a === 'next') shiftMonth(1);
    else if (a === 'cassy') { state.cassyOpen = !state.cassyOpen; t.setAttribute('aria-expanded', state.cassyOpen); var s = $('cassy-sub'); if (s) s.hidden = !state.cassyOpen; }
    else if (t.hasAttribute('data-stay')) {
      var el = $('stay-' + t.getAttribute('data-stay')); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1400); }
    } else if (t.hasAttribute('data-theme')) { window.CSTheme.set(t.getAttribute('data-theme')); renderMore(); }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', function () { var b = document.querySelector('.view.on .appbar'); if (b) b.classList.toggle('scrolled', window.scrollY > 8); }, { passive: true });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.layout && Date.now() - state.loadedAt > 60000) loadHome();
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
