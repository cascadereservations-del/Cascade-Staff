/* Cascade Staff 3.4.4, lane K: the Booking calendar view. A native port of the admin dashboard's Booking calendar page
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
  function K_colours(stays) {
    var list = stays.slice().sort(function (a, b) { return a.checkin_date < b.checkin_date ? -1 : a.checkin_date > b.checkin_date ? 1 : a.checkout_date < b.checkout_date ? -1 : 1; }), got = new Map(), done = [];
    list.forEach(function (st) {
      var used = {}, c = Math.floor(K_utc(st.checkin_date) / 86400000) % NCOL, i;
      done.forEach(function (o) { if (o.st.checkin_date <= st.checkout_date && st.checkin_date <= o.st.checkout_date) used[o.c] = 1; });
      for (i = 0; i < NCOL && used[c]; i++) c = (c + 1) % NCOL;
      got.set(st, c); done.push({ st: st, c: c });
    });
    return function (st) { return got.has(st) ? got.get(st) + 1 : 0; };
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
    var colour = K_colours(stays);
    return function (d) {
      var e = by[d] || { stays: [], blocks: [] };
      return { colour: colour, stays: e.stays, blocks: e.blocks, conflict: e.stays.length >= 2, turn: e.stays.some(function (a) { return a.checkin_date === d; }) && (outBy[d] || []).length > 0 };
    };
  }
  function K_chip(st, d, conflict, full, colour, names) {
    var blocked = st.status === 'blocked', state = blocked ? 'blocked' : conflict ? 'conflict' : 'booked', who = blocked ? 'Blocked' : K_name(st, full, names);
    var word = st.source === 'direct' ? 'Direct booking' : 'Airbnb stay';
    var title = blocked ? 'Blocked (not a stay)' : who + ' · ' + word + (conflict ? ' · overlaps another guest' : '');
    return '<button class="K_chip" type="button" data-day="' + d + '" data-state="' + state + '" data-col="' + (blocked ? 0 : colour(st)) + '" data-source="' + (st.source === 'direct' ? 'direct' : 'airbnb') + '" aria-haspopup="dialog" title="' + K_esc(title) + '" aria-label="' + K_esc(d + ': ' + title + (st.checkin_date === d ? ', checks in' : '')) + '">' +
      (st.checkin_date === d ? '<span aria-hidden="true">→ </span>' : '') + (conflict && !blocked ? '<span aria-hidden="true">! </span>' : '') + '<span class="K_nm">' + K_esc(who) + '</span></button>';
  }
  function K_items(info, d, full, names) { return info.stays.map(function (st) { return K_chip(st, d, info.conflict, full, info.colour, names); }).concat(info.blocks.map(function (b) { return K_chip(b, d, false, full, info.colour, names); })); }
  function K_legend(show) {
    var li = function (cls, t) { return '<li><span class="K_sw ' + cls + '" aria-hidden="true"></span>' + t + '</li>'; };
    return '<ul class="K_legend" aria-label="Legend">' + li('guest', 'Each guest has their own colour') + li('blocked', 'Blocked (not a stay)') + (show.conflict ? li('conflict', 'Two guests on one night') : '') + (show.turn ? li('turn', 'Turnover day') : '') + '<li>Arrow marks the check-in day.</li></ul>';
  }
  function K_render(o) {
    var y = o.y, m = o.m, ym = y + '-' + K_pad(m), first = ym + '-01', info = K_days(o), full = !!o.full, names = full ? o.names : null, today = o.today || '';
    var lead = (K_dow(first) + 6) % 7, start = K_add(first, -lead), days = [], i;
    for (i = 0; i < 42; i++) days.push(K_add(start, i));
    var inMonth = days.filter(function (d) { return d.slice(0, 7) === ym; }).map(function (d) { var x = info(d); x.d = d; return x; });
    var show = { conflict: inMonth.some(function (x) { return x.conflict; }), turn: inMonth.some(function (x) { return x.turn; }) };
    var busy = inMonth.filter(function (x) { return x.stays.length || x.blocks.length; });
    var agenda = '<ul class="K_agenda" aria-label="Month agenda">' + (busy.length ? busy.map(function (x) {
      return '<li class="K_arow' + (x.turn ? ' K_turn' : '') + (x.d === today ? ' K_today' : '') + '"><div class="K_ad">' + DAYN[K_dow(x.d)] + ' ' + (+x.d.slice(8)) + (x.turn ? '<small>Turnover</small>' : '') + '</div><ul class="K_chips">' +
        K_items(x, x.d, full, names).map(function (c) { return '<li>' + c + '</li>'; }).join('') + '</ul></li>';
    }).join('') : '<li class="K_none">No stays or blocked nights this month.</li>') + '</ul>';
    var grid = '<div class="K_grid" role="group" aria-label="Calendar grid"><div class="K_dows" aria-hidden="true">' + MON.map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div><div class="K_cells">' + days.map(function (d) {
      var x = info(d), its = K_items(x, d, full, names), inM = d.slice(0, 7) === ym;
      return '<div class="K_cell' + (inM ? '' : ' K_off') + (d === today ? ' K_today' : '') + (x.turn ? ' K_turn' : '') + '"><div class="K_n"><span>' + (+d.slice(8)) + '</span>' + (x.turn ? '<small>Turnover</small>' : '') + '</div>' +
        its.slice(0, 3).join('') + (its.length > 3 ? '<span class="K_more">+' + (its.length - 3) + ' more</span>' : '') + '</div>';
    }).join('') + '</div></div>';
    return '<div class="K_root" data-E-swipe="month">' + agenda + grid + K_legend(show) + '</div>';
  }
  var api = { render: K_render, colours: K_colours, days: K_days };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.K_BookCal = api;
})(typeof window !== 'undefined' ? window : this);
