/* Cascade Staff 3.4.6, lane K: the Booking calendar view. A native port of the admin dashboard's Booking calendar page
   (admin-dashboard/app/src/features/bookings/calendar-page.tsx): the same chips (one colour per stay from an eight-colour palette, no A/D letters; arrow on the check-in day,
   hatched Blocked, red for two guests on one night), a Turnover day marker and the same legend. A day-by-day list on a phone and a
   month grid from 600 px, exactly as the admin page does. Pure: K_BookCal.render(opts) returns HTML; the shell draws it and handles the taps
   (every chip is a data-day button, so a tap opens the shell's own day sheet). It reads only what the Calendar already loaded
   (merged stays and calendar rows): no request, no phone or e-mail, and a first name only unless opts.full (owner and admin).
   opts: { y, m, today, stays (merged), rows (calendar rows, blocks included), full, names }. names (owner/admin only) = [{ checkin_date, name }] full names from the guest records;
   the calendar rows of an Airbnb stay carry a first name only, so a stay takes the full name whose check-in matches and whose first word is the same. */
(function (root) {
  'use strict';
  var MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var NCOL = 8; // k1..k8 in tokens.css, each with a light and a dark value
  function K_esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function K_pad(n) { return (n < 10 ? '0' : '') + n; }
  function K_utc(iso) { var a = iso.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]); }
  function K_add(iso, n) { var d = new Date(K_utc(iso) + n * 86400000); return d.getUTCFullYear() + '-' + K_pad(d.getUTCMonth() + 1) + '-' + K_pad(d.getUTCDate()); }
  function K_dow(iso) { return new Date(K_utc(iso)).getUTCDay(); }
  // One colour per stay: start from the check-in day (stable when earlier months load), then step on past any colour a stay that
  // overlaps or touches this one (a turnover day) already holds. Eight colours, so a free one always exists in practice.
  // One colour per GUEST, so every booking and night of the same person looks the same. The key is a guest id when the stay carries one, else the name
  // (trimmed, spaces collapsed, lower-case; the full name for owner/admin, the first name for a cleaner, so two different guests with one first name may share a colour for a cleaner).
  // An empty name or "Guest" never merges: each such stay keeps its own colour. Guests are placed in first-check-in order, each avoiding the colours of OTHER guests whose
  // stays are within 14 days of any of theirs (if eight colours are not enough: only those that touch or overlap).
  function K_colours(stays, keyOf) {
    var by = {}, order = [];
    stays.slice().sort(function (a, b) { return a.checkin_date < b.checkin_date ? -1 : a.checkin_date > b.checkin_date ? 1 : a.checkout_date < b.checkout_date ? -1 : 1; }).forEach(function (st, i) {
      var k = keyOf ? keyOf(st) : '', g;
      k = k && k !== 'guest' ? k : '#' + i; g = by[k];
      if (!g) { g = by[k] = { stays: [], c: 0 }; order.push(g); }
      g.stays.push(st);
    });
    var done = [];
    order.forEach(function (g) {
      var c0 = Math.floor(K_utc(g.stays[0].checkin_date) / 86400000) % NCOL, pick = null;
      [14, 0].some(function (gap) {
        var used = {}, i; done.forEach(function (o) { if (o.stays.some(function (x) { return g.stays.some(function (y) { return x.checkin_date <= K_add(y.checkout_date, gap) && y.checkin_date <= K_add(x.checkout_date, gap); }); })) used[o.c] = 1; });
        for (i = 0; i < NCOL; i++) if (!used[(c0 + i) % NCOL]) { pick = (c0 + i) % NCOL; return true; }
        return false;
      });
      g.c = pick == null ? c0 : pick; done.push(g);
    });
    var map = new Map(); order.forEach(function (g) { g.stays.forEach(function (st) { map.set(st, g.c + 1); }); });
    return function (st) { return map.has(st) ? map.get(st) : 0; };
  }
  function K_first(n) { return String(n || '').trim().split(/\s+/)[0]; }
  function K_name(st, full, names) {
    var n = String((st && st.guest_name) || '').trim(); if (!n) return 'Guest'; if (!full) return K_first(n);
    var f = K_first(n).toLowerCase();
    (names || []).some(function (e) { // a full name from the guest record, when it starts with the same first name and the check-in is the stay's (or one of its rows')
      var ok = e && e.name && K_first(e.name).toLowerCase() === f && e.name.length > n.length && ((st.rows || [st]).some(function (r) { return r.checkin_date === e.checkin_date; }) || st.checkin_date === e.checkin_date);
      if (ok) n = String(e.name).trim(); return ok;
    });
    return n;
  }
  // What each night holds: stays on it, blocks only where no stay is (a block that mirrors a stay is the same night twice), conflict, turnover.
  function K_days(o) {
    var stays = o.stays || [], rows = o.rows || [], by = {}, outBy = {};
    stays.forEach(function (st) { var d; for (d = st.checkin_date; d < st.checkout_date; d = K_add(d, 1)) (by[d] = by[d] || { stays: [], blocks: [] }).stays.push(st); (outBy[st.checkout_date] = outBy[st.checkout_date] || []).push(st); });
    rows.filter(function (r) { return r && r.status === 'blocked' && r.checkin_date && r.checkout_date; }).forEach(function (r) {
      var d; for (d = r.checkin_date; d < r.checkout_date; d = K_add(d, 1)) { var e = (by[d] = by[d] || { stays: [], blocks: [] }); if (!e.stays.length && !e.blocks.length) e.blocks.push(r); }
    });
    var full = !!o.full, names = full ? o.names : null;
    var colour = K_colours(stays, function (st) {
      var id = st.guest_id || (st.rows || []).map(function (r) { return r.guest_id; }).filter(Boolean)[0];
      return id ? 'id:' + id : K_name(st, full, names).replace(/\s+/g, ' ').trim().toLowerCase();
    });
    return function (d) {
      var e = by[d] || { stays: [], blocks: [] };
      return { colour: colour, stays: e.stays, blocks: e.blocks, conflict: e.stays.length >= 2, turn: e.stays.some(function (a) { return a.checkin_date === d; }) && (outBy[d] || []).length > 0 };
    };
  }
  function K_dl(iso) { return DAYN[K_dow(iso)] + ' ' + (+iso.slice(8)); }
  function K_nights(a, b) { return Math.round((K_utc(b) - K_utc(a)) / 86400000); }
  // A run = one stay (or one blocked stretch) over consecutive nights: { it, from, to (last night), conflict, blocked }.
  function K_runs(info, days) {
    var open = new Map(), out = [], prev = null;
    days.forEach(function (d) {
      var x = info(d);
      x.stays.concat(x.blocks).forEach(function (it) {
        var r = open.get(it);
        if (r && r.to === prev) r.to = d; else { r = { it: it, from: d, to: d, conflict: false, blocked: it.status === 'blocked' }; open.set(it, r); out.push(r); }
        if (x.conflict && !r.blocked) r.conflict = true;
      });
      prev = d;
    });
    return out;
  }
  // One bar or row: the arrow only where the stay checks in, "!" where it overlaps another guest (its own colour stays), the name once.
  function K_chip(r, d, full, colour, names, cls, meta) {
    var st = r.it, blocked = r.blocked, who = blocked ? 'Blocked' : K_name(st, full, names), word = st.source === 'direct' ? 'Direct booking' : 'Airbnb stay';
    var title = blocked ? 'Blocked (not a stay)' : who + ' · ' + word + (r.conflict ? ' · overlaps another guest' : '');
    return '<button class="' + cls + '" type="button" data-day="' + d + '" data-state="' + (blocked ? 'blocked' : r.conflict ? 'conflict' : 'booked') + '" data-col="' + (blocked ? 0 : colour(st)) + '" data-source="' + (st.source === 'direct' ? 'direct' : 'airbnb') + '" aria-haspopup="dialog" title="' + K_esc(title) + '" aria-label="' + K_esc(d + ': ' + title + (st.checkin_date === d ? ', checks in' : '')) + '"' + (r.style ? ' style="' + r.style + '"' : '') + '>' +
      (st.checkin_date === d ? '<span aria-hidden="true">→</span>' : '') + (r.conflict ? '<span aria-hidden="true">!</span>' : '') + '<span class="K_nm">' + K_esc(who) + '</span>' + (meta ? '<span class="K_meta">' + K_esc(meta) + '</span>' : '') + '</button>';
  }
  function K_legend(show) {
    var li = function (cls, t) { return '<li><span class="K_sw ' + cls + '" aria-hidden="true"></span>' + t + '</li>'; };
    return '<ul class="K_legend" aria-label="Legend">' + li('guest', 'Each guest has their own colour') + li('blocked', 'Blocked (not a stay)') + (show.conflict ? li('conflict', 'Two guests on one night') : '') + (show.turn ? li('turn', 'Turnover day') : '') + '<li>Arrow marks the check-in day.</li></ul>';
  }
  function K_render(o) {
    var y = o.y, m = o.m, ym = y + '-' + K_pad(m), first = ym + '-01', info = K_days(o), full = !!o.full, names = full ? o.names : null, today = o.today || '';
    var lead = (K_dow(first) + 6) % 7, start = K_add(first, -lead), days = [], i;
    for (i = 0; i < 42; i++) days.push(K_add(start, i));
    var mdays = days.filter(function (d) { return d.slice(0, 7) === ym; }), inMonth = mdays.map(function (d) { var x = info(d); x.d = d; return x; });
    var show = { conflict: inMonth.some(function (x) { return x.conflict; }), turn: inMonth.some(function (x) { return x.turn; }) }, colour = info(first).colour;
    // phone: one row per stay (or blocked stretch), then one row per stretch of nights two guests share
    var rows = K_runs(info, mdays).map(function (r) {
      var st = r.it, co = r.blocked ? K_add(r.to, 1) : st.checkout_date, n = K_nights(r.blocked ? r.from : st.checkin_date, co);
      return { d: r.from, turn: !r.blocked && st.checkin_date === r.from && info(r.from).turn, html: K_chip(r, r.from, full, colour, names, 'K_chip', '→ ' + K_dl(co) + ' · ' + n + (n === 1 ? ' night' : ' nights')) };
    }), cl = null;
    inMonth.forEach(function (x) {
      if (!x.conflict) { cl = null; return; }
      if (!cl) { cl = { d: x.d, from: x.d, to: x.d, who: [], clash: 1 }; rows.push(cl); }
      cl.to = x.d; x.stays.forEach(function (s) { var w = K_name(s, full, names); if (cl.who.indexOf(w) < 0) cl.who.push(w); });
    });
    rows.forEach(function (r) {
      if (r.clash) r.html = '<button class="K_chip" type="button" data-day="' + r.from + '" data-state="conflict" data-col="0" aria-haspopup="dialog" aria-label="' + K_esc(r.from + ': clash, ' + r.who.join(' and ') + ' on the same night') + '"><span aria-hidden="true">!</span><span class="K_nm">' + K_esc('Clash: ' + r.who.join(' and ')) + '</span><span class="K_meta">' + K_esc(K_dl(r.from) + (r.to > r.from ? ' to ' + K_dl(r.to) : '')) + '</span></button>';
    });
    rows.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.clash ? 1 : 0) - (b.clash ? 1 : 0); });
    var agenda = '<ul class="K_agenda" aria-label="Month agenda">' + (rows.length ? rows.map(function (r) {
      return '<li class="K_arow' + (r.turn ? ' K_turn' : '') + (r.d === today ? ' K_today' : '') + '"><div class="K_ad">' + K_dl(r.d) + (r.turn ? '<small>Turnover</small>' : '') + '</div><div class="K_chips">' + r.html + '</div></li>';
    }).join('') : '<li class="K_none">No stays or blocked nights this month.</li>') + '</ul>';
    // tablet and up: each week is a grid row; a stay is one bar across its nights, the name once per week
    var weeks = '', w;
    for (w = 0; w < 6; w++) {
      var wd = days.slice(w * 7, w * 7 + 7), lanes = [], bars = '';
      K_runs(info, wd).forEach(function (r) {
        var c0 = wd.indexOf(r.from), c1 = wd.indexOf(r.to), l = 0;
        while (lanes[l] != null && lanes[l] >= c0) l++;
        lanes[l] = c1;
        r.style = 'grid-column:' + (c0 + 1) + '/span ' + (c1 - c0 + 1) + ';grid-row:' + (l + 2);
        bars += K_chip(r, r.from, full, colour, names, 'K_bar', null);
      });
      weeks += '<div class="K_wk" style="grid-template-rows:2.25rem repeat(' + Math.max(lanes.length, 1) + ',auto)">' + wd.map(function (d, ci) {
        var x = info(d), inM = d.slice(0, 7) === ym;
        return '<div class="K_cell' + (inM ? '' : ' K_off') + (d === today ? ' K_today' : '') + (x.turn ? ' K_turn' : '') + '" style="grid-column:' + (ci + 1) + ';grid-row:1/-1"><button class="K_dn" type="button" data-day="' + d + '" aria-haspopup="dialog" aria-label="' + d + '"><span>' + (+d.slice(8)) + '</span>' + (x.turn ? '<small>Turnover</small>' : '') + '</button></div>';
      }).join('') + bars + '</div>';
    }
    var grid = '<div class="K_grid" role="group" aria-label="Calendar grid"><div class="K_dows" aria-hidden="true">' + MON.map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div>' + weeks + '</div>';
    return '<div class="K_root" data-E-swipe="month">' + agenda + grid + K_legend(show) + '</div>';
  }
  var api = { render: K_render, colours: K_colours, days: K_days };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.K_BookCal = api;
})(typeof window !== 'undefined' ? window : this);
