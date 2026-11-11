/* Cascade Staff - KPIs tab (s110, D-358). Mounted by the shell as window.K_Kpi.mount(el, { client, demo, role, propertyId, navigate, toast }).
   Utility and Inventory for every role; Admin (rates, costs, meter checks) for owner, admin and finance. Data: kpi_tab_v1 (docs/s110/contracts.md).
   Money rule: the `admin` key is read ONLY for owner, admin and finance and drawn only on the Admin segment. A cleaner or laundry payload that carries it is ignored.
   Plain ES5, no build step. Pure helpers are exported on K_Kpi.lib so tests/s110-kpi-inventory.test.mjs can run them in Node. */
(function (root) {
  'use strict';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var ADMIN = ['owner', 'admin', 'finance'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gi(name, size) { return root.ICON ? root.ICON(name, size) : ''; }
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function fmt(n, d) { var k = Math.pow(10, d == null ? 1 : d), v = Math.round(Number(n) * k) / k; return String(v); }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function peso(n) { var v = Math.round(Number(n)); return '₱' + group(v); }
  function pesoRate(n) { return '₱' + Number(n).toFixed(2); }
  function isAdminRole(role) { return ADMIN.indexOf(role) >= 0; }
  function canSetRate(role) { return role === 'owner' || role === 'admin'; }

  function monthParts(month) { var m = /^(\d{4})-(\d{2})/.exec(String(month || '')); return m ? { y: +m[1], m: +m[2] } : null; }
  function monthLabel(month) { var p = monthParts(month); return p && p.m >= 1 && p.m <= 12 ? MONTHS[p.m - 1] + ' ' + p.y : ''; }
  function daysIn(month) { var p = monthParts(month); return p ? new Date(Date.UTC(p.y, p.m, 0)).getUTCDate() : 30; }
  function dateLabel(iso) { var p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return p ? MONTHS[+p[2] - 1].slice(0, 3) + ' ' + +p[3] : ''; }
  function plural(n, one, many) { return n + ' ' + (Math.abs(n) === 1 ? one : many || one + 's'); }

  // Used per turnover against the usual: the bar is scaled to the largest figure on the list; over = more than 110% of usual.
  function usageRows(rows) {
    var list = (rows || []).map(function (r) { return { name: String((r && r.name) || ''), used: num(r && r.used_per_turnover), usual: num(r && r.usual) }; }).filter(function (r) { return r.name && r.used != null; });
    var scale = Math.max.apply(null, list.map(function (r) { return Math.max(r.used, r.usual || 0); }).concat([0]));
    return list.map(function (r) { r.pct = scale > 0 ? Math.max(4, Math.round(r.used / scale * 100)) : 4; r.over = r.usual != null && r.usual > 0 && r.used > r.usual * 1.1; r.overPct = r.usual > 0 ? Math.round((r.used / r.usual - 1) * 100) : 0; return r; });
  }
  function monthShort(m) { var p = monthParts(m); return p && p.m >= 1 && p.m <= 12 ? MONTHS[p.m - 1].slice(0, 3) + ' ' + p.y : ''; }
  function dayMonth(iso) { var p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return p ? +p[3] + ' ' + MONTHS[+p[2] - 1].slice(0, 3) : ''; }
  function prevMonth(month) { var p = monthParts(month); if (!p) return ''; var y = p.m === 1 ? p.y - 1 : p.y, m = p.m === 1 ? 12 : p.m - 1; return y + '-' + (m < 10 ? '0' : '') + m; }

  /* s113, the chart standard (docs/s113/contract.md B, C, F): plain inline SVG line charts. The plot is a 0..100 viewBox drawn with preserveAspectRatio="none";
     every label, dot and value is HTML placed by percent outside the scaled SVG, so text never stretches. The s111 bars hung from the top because their class
     .K_bar is also the booking calendar's bar (calendar/K_bookcal.css: align-self: start; min-height: 2rem), loaded on every screen; the chart classes are KU_ now. */
  var PLOT = { top: 0, bottom: 100, height: 100, pad: 4 };
  // the smallest 1, 2, 2.5 or 5 x 10^n at or above v
  function niceMax(v) {
    v = Number(v); if (!(v > 0) || !isFinite(v)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)); if (p * 10 <= v) p *= 10; if (p > v) p /= 10;
    var c = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < c.length; i++) { var x = Math.round(c[i] * p * 1e9) / 1e9; if (x >= v - 1e-9) return x; }
    return 10 * p;
  }
  // ticks for a niceMax value: 4 steps for 1 and 2 x 10^n, 5 for 2.5 and 5 x 10^n, so every tick is a round number and there are 3-4 gridlines between 0 and the top
  function ticksFor(max) {
    var p = Math.pow(10, Math.floor(Math.log(max) / Math.LN10)), m = Math.round(max / p * 100) / 100, n = m === 2.5 || m === 5 ? 5 : 4, out = [];
    for (var k = 0; k <= n; k++) out.push(Math.round(k * max / n * 1e6) / 1e6);
    return out;
  }
  // linear-interpolated percentile of the numbers in vals (nulls skipped); null for none
  function percentile(vals, q) {
    var s = (vals || []).map(num).filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; }); if (!s.length) return null;
    var i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }
  function median(vals) { return percentile(vals, 0.5); }
  function yOf(v, max) { return PLOT.bottom - v / max * PLOT.height; }
  function xOf(i, n) { return n <= 1 ? 50 : PLOT.pad + i * (100 - 2 * PLOT.pad) / (n - 1); }
  function r2(v) { return Math.round(v * 100) / 100; }
  // values (null = gap) -> points on the plot. o.max fixes the top (the 12-month chart); a value above it is drawn at the top edge and marked over.
  function lineModel(vals, o) {
    o = o || {}; var list = (vals || []).map(num), have = list.filter(function (v) { return v != null; });
    var max = o.max != null ? o.max : niceMax(Math.max.apply(null, have.concat([0])));
    var pts = list.map(function (v, i) { var x = r2(xOf(i, list.length)); return v == null ? { i: i, x: x, v: null, y: null } : { i: i, x: x, v: v, y: r2(yOf(Math.min(v, max), max)), over: v > max }; });
    var segs = [], cur = []; pts.forEach(function (p) { if (p.v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); }); if (cur.length) segs.push(cur);
    return { max: max, ticks: ticksFor(max), pts: pts, segs: segs, n: have.length };
  }
  // the use per day between readings: y from 0 to nice(largest); the shaded usual range is the middle half (25th-75th percentile); labels on the latest and the highest point
  function dayModel(vals) {
    var m = lineModel(vals), live = m.pts.filter(function (p) { return p.v != null; });
    if (!live.length) return m;
    var p25 = percentile(vals, 0.25), p75 = percentile(vals, 0.75), last = live[live.length - 1], hi = live.reduce(function (a, b) { return b.v > a.v ? b : a; }, live[0]);
    m.band = { lo: p25, hi: p75, y0: r2(yOf(p25, m.max)), y1: r2(yOf(p75, m.max)) }; m.latest = last.i; m.highest = hi.i;
    return m;
  }
  // the average per stay, 12 months: top = nice(max(85th percentile x 1.4, the latest value)) so one outlier month does not flatten the rest; typical = the median
  function monthModel(vals, latestIdx) {
    var have = (vals || []).map(num).filter(function (v) { return v != null; }); if (!have.length) return lineModel(vals);
    var latest = latestIdx != null && num(vals[latestIdx]) != null ? num(vals[latestIdx]) : have[have.length - 1];
    var m = lineModel(vals, { max: niceMax(Math.max(percentile(have, 0.85) * 1.4, latest)) }), typ = median(have);
    m.typical = { v: typ, y: r2(yOf(Math.min(typ, m.max), m.max)) }; m.overs = m.pts.filter(function (p) { return p.over; }).map(function (p) { return p.i; });
    return m;
  }
  // x labels: at most 4 (first, last, two between), each index once
  function xPick(n) { if (n <= 0) return []; var out = [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1]; return out.filter(function (x, i) { return out.indexOf(x) === i; }); }
  function pathOf(seg) { return seg.map(function (p) { return p.x + ',' + p.y; }).join(' '); }
  function areaOf(seg) { return 'M' + seg[0].x + ',' + PLOT.bottom + ' L' + pathOf(seg).replace(/ /g, ' L') + ' L' + seg[seg.length - 1].x + ',' + PLOT.bottom + ' Z'; }
  var VE = ' vector-effect="non-scaling-stroke"';
  // o: { id, title, tabs, unit, dec, model, aria(p) -> words per point, values: [index] labelled, x: [{ i, text, em }], em: index, key, summary, caption, foot }
  function lineChart(o) {
    var m = o.model, d = o.dec, h = '<div class="card glass K_chart KU_chart" id="' + esc(o.id) + '"><div class="K_chart-h"><b>' + esc(o.title) + '</b></div>' + (o.tabs || '');
    if (!m.n) return h + '<p class="K_sub">' + esc(o.empty || 'No readings yet.') + '</p>' + (o.foot || '') + '</div>';
    var svg = '<svg class="KU_svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      m.ticks.map(function (t) { var y = r2(yOf(t, m.max)); return '<line class="' + (t === 0 ? 'KU_base' : 'KU_grid') + '" x1="0" x2="100" y1="' + y + '" y2="' + y + '"' + VE + '></line>'; }).join('') +
      (m.band ? '<rect class="KU_band"' + VE + ' x="0" width="100" y="' + m.band.y1 + '" height="' + r2(Math.max(0.6, m.band.y0 - m.band.y1)) + '"></rect>' : '') +
      (m.typical ? '<line class="KU_typ" x1="0" x2="100" y1="' + m.typical.y + '" y2="' + m.typical.y + '"' + VE + '></line>' : '') +
      m.segs.filter(function (s) { return s.length > 1; }).map(function (s) { return (o.area === false ? '' : '<path class="KU_area" d="' + areaOf(s) + '"></path>') + '<polyline class="KU_line" points="' + pathOf(s) + '"' + VE + '></polyline>'; }).join('') + '</svg>';
    var dots = m.pts.filter(function (p) { return p.v != null; }).map(function (p) {
      return '<span class="KU_pt' + (p.i === o.em ? ' KU_pt-em' : '') + (p.over ? ' KU_pt-over' : '') + '" style="left:' + p.x + '%;top:' + p.y + '%" role="img" aria-label="' + esc(o.aria(p)) + '"></span>';
    }).join('');
    var lab = (o.values || []).filter(function (i, k, a) { return a.indexOf(i) === k && m.pts[i] && m.pts[i].v != null; }).map(function (i) {
      var p = m.pts[i], other = (o.values || []).filter(function (j) { return j !== i && m.pts[j] && m.pts[j].v != null; })[0], q = other != null ? m.pts[other] : null;
      var below = !p.over && i === o.em && q && Math.abs(q.x - p.x) < 16 && Math.abs(q.y - p.y) < 14 && p.y < 80; // the latest steps under its dot when the highest one sits close beside it
      return '<span class="KU_val' + (i === o.em ? ' KU_val-em' : '') + (below ? ' KU_val-below' : '') + (p.x > 80 ? ' KU_val-r' : p.x < 20 ? ' KU_val-l' : '') + '" style="left:' + p.x + '%;top:' + p.y + '%" aria-hidden="true">' + esc((p.over ? '↑ ' : '') + fmt(p.v, d)) + '</span>';
    }).join('');
    h += (o.key ? '<p class="KU_key" aria-hidden="true">' + o.key + '</p>' : '') +
      '<div class="KU_fig" role="group" aria-label="' + esc(o.summary) + '"><div class="KU_yax" aria-hidden="true">' + m.ticks.map(function (t) { return '<span style="top:' + r2(yOf(t, m.max)) + '%">' + esc(fmt(t, d)) + '</span>'; }).join('') + '</div>' +
      '<div class="KU_plot">' + svg + dots + lab + '</div></div>' +
      '<div class="KU_xax" aria-hidden="true">' + o.x.map(function (x) { var p = m.pts[x.i]; return '<span class="KU_x' + (p.x < 15 ? ' KU_x0' : p.x > 85 ? ' KU_xn' : '') + (x.em ? ' KU_xem' : '') + '" style="left:' + p.x + '%">' + esc(x.text) + '</span>'; }).join('') + '</div>' +
      '<p class="K_cap">' + esc(o.caption) + '</p>' + (o.foot || '') + '</div>';
    return h;
  }
  // a tiny trend line for a tile: no axis, the latest point dotted
  function spark(vals, label) {
    var m = lineModel(vals); if (m.n < 2) return '';
    var live = m.pts.filter(function (p) { return p.v != null; }), last = live[live.length - 1];
    return '<span class="KU_spark" role="img" aria-label="' + esc(label) + '"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      m.segs.filter(function (s) { return s.length > 1; }).map(function (s) { return '<polyline class="KU_line" points="' + pathOf(s) + '"' + VE + '></polyline>'; }).join('') + '</svg><i style="left:' + last.x + '%;top:' + last.y + '%"></i></span>';
  }
  // the change chip: plain words first, the colour only repeats them (lower use reads ok, higher reads warn); within 5% is "about the same"
  function change(now, prev) {
    var a = num(now), b = num(prev); if (a == null || b == null || b <= 0) return null;
    var pct = Math.round((a / b - 1) * 100);
    return Math.abs(pct) < 5 ? { dir: 'same', pct: 0 } : { dir: pct < 0 ? 'down' : 'up', pct: Math.abs(pct) };
  }
  function chip(c, monthName) {
    if (!c) return '';
    return '<span class="KU_chip KU_chip-' + c.dir + '">' + esc(c.dir === 'same' ? 'about the same as ' + monthName : c.dir + ' ' + c.pct + '% vs ' + monthName) + '</span>';
  }
  // the ring gauge: an SVG circle of circumference 100, so the dash is the percent
  function ring(pct) {
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    return '<span class="KU_ring" aria-hidden="true"><svg viewBox="0 0 36 36" focusable="false"><circle class="KU_ring-t" cx="18" cy="18" r="15.9155"></circle>' + (p ? '<circle class="KU_ring-f" cx="18" cy="18" r="15.9155" stroke-dasharray="' + p + ' 100" transform="rotate(-90 18 18)"></circle>' : '') + '</svg><b>' + p + '%</b></span>';
  }
  function segTabs(act, label, on, list) {
    return '<div class="K_seg" role="tablist" aria-label="' + esc(label) + '">' + list.map(function (s) { return '<button class="K_seg-b" type="button" role="tab" data-kact="' + act + '" data-' + (act === 'day' ? 'kunit' : act) + '="' + s[0] + '" aria-selected="' + (on === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div>';
  }
  function daysTone(d) { return d != null && d <= 5 ? 'bad' : d != null && d <= 10 ? 'warn' : 'ok'; }
  function rateCost(kwh, rate) { var k = num(kwh), r = num(rate); return k != null && r != null ? k * r : null; }

  // One kpi_tab_v1 payload to what the screen draws. `admin` survives only for owner, admin and finance; anything else is dropped here, before any drawing.
  function normalize(raw, role) {
    if (!raw || typeof raw !== 'object' || raw.ok === false) return null;
    var u = raw.utility || {}, inv = raw.inventory || {}, lr = u.last_reading && typeof u.last_reading === 'object' ? u.last_reading : null;
    var out = {
      month: String(raw.month || ''),
      // s111 rev 2: use per DAY between readings (a reading covers every day since the previous one, not only the guest nights); nights booked come from the calendar (= Admin occupancy)
      utility: { kwh: num(u.kwh_month), perDay: num(u.kwh_per_day), m3: num(u.m3_month), m3PerDay: num(u.m3_per_day), booked: num(u.nights_booked), monthNights: num(u.nights_in_month),
        last: lr ? { at: lr.recorded_at || null, delta: num(lr.delta_kwh), days: num(lr.days), perDay: num(lr.kwh_per_day), m3: num(lr.delta_m3), m3PerDay: num(lr.m3_per_day), flag: lr.flag ? String(lr.flag) : '' } : null,
        perMonth: (Array.isArray(u.per_month) ? u.per_month : []).filter(function (r) { return r && monthParts(r.month); }).map(function (r) { return { month: String(r.month).slice(0, 7), stays: num(r.stays) || 0, kwh: num(r.kwh_per_stay), m3: num(r.m3_per_stay), kwhDay: num(r.kwh_per_day), m3Day: num(r.m3_per_day) }; }).slice(-12),
        perStay: (Array.isArray(u.per_stay) ? u.per_stay : []).filter(function (s) { return s && typeof s === 'object'; }).map(function (s) { return { date: String(s.checkout_date || s.recorded_at || '').slice(0, 10), days: num(s.days), kwh: num(s.kwh_per_day), m3: num(s.m3_per_day) }; }).slice(-8),
        brownouts: { count: num(u.brownouts && u.brownouts.count) || 0, hours: num(u.brownouts && u.brownouts.hours) || 0 },
        water: { count: num(u.water_cuts && u.water_cuts.count) || 0, hours: num(u.water_cuts && u.water_cuts.hours) || 0 },
        internet: u.internet_cuts && typeof u.internet_cuts === 'object' ? { count: num(u.internet_cuts.count) || 0, hours: num(u.internet_cuts.hours) || 0 } : null }, // null: an older server, so no row
      inventory: { low: num(inv.low_now), restocks: num(inv.restocks_month), turnovers: num(inv.turnovers_month), usage: usageRows(inv.per_turnover),
        runsOut: (inv.runs_out || []).map(function (r) { return { name: String((r && r.name) || ''), days: num(r && r.days_left) }; }).filter(function (r) { return r.name && r.days != null; }).slice(0, 3) },
      admin: null
    };
    if (isAdminRole(role) && raw.admin && typeof raw.admin === 'object') {
      var a = raw.admin, rt = a.rate && typeof a.rate === 'object' ? a.rate : null;
      out.admin = { rate: rt && num(rt.php_per_kwh) != null ? { php: num(rt.php_per_kwh), from: rt.effective_from || '', source: rt.source || '', url: /^https:\/\//.test(String(rt.source_url || '')) ? String(rt.source_url) : '' } : null,
        lastCost: num(a.last_reading_cost), monthCost: num(a.month_kwh_cost), supplies: num(a.supplies_month), perTurnover: num(a.supply_cost_per_turnover), cleaning: num(a.cleaning_pay_month) };
      // Amendment 1: the month at a glance. A key that is absent draws nothing; a key that is present but empty draws "Not yet". Kept only here, inside the admin role check.
      var has = function (k) { return Object.prototype.hasOwnProperty.call(a, k); };
      if (has('net_month')) out.admin.net = { net: num(a.net_month), revenue: has('revenue_month') ? num(a.revenue_month) : null, costs: has('costs_month') ? num(a.costs_month) : null };
      if (has('occupancy')) out.admin.occupancy = { pct: num(a.occupancy), sold: num(a.sold_nights), sellable: num(a.sellable_nights) };
      if (has('adr')) out.admin.adr = num(a.adr);
      if (has('direct_share')) out.admin.direct = num(a.direct_share);
      if (a.target && typeof a.target === 'object') { var tg = a.target; out.admin.target = { net: num(tg.net_target) || 0, costs: num(tg.costs_basis), need: num(tg.revenue_needed), adr: num(tg.adr), monthNights: num(tg.nights_in_month), onBooks: num(tg.nights_on_books), occ: num(tg.needed_occupancy), needAdr: num(tg.needed_adr), at: tg.set_at || '' }; }
    }
    return out;
  }
  function stateMsg(kind) {
    return { forbidden: 'This page is not open to your account. Ask Lloyd.', offline: 'No connection. Check your signal and try again.', error: 'The figures could not be loaded. Try again in a moment.', missing: 'Key figures are not available in this version yet.' }[kind] || 'The figures could not be loaded.';
  }
  function errKind(e) { var c = e && (e.code || ''), m = String((e && e.message) || ''); if (c === '42501' || /denied|forbidden|not authorized/i.test(m)) return 'forbidden'; if (c === 'PGRST202' || c === '42883' || /could not find the function/i.test(m)) return 'missing'; if (/fetch|network|offline/i.test(m)) return 'offline'; return 'error'; }

  // Meter checks (admin_report_blocks_v1): the same rows the admin dashboard card shows.
  function normBlocks(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(function (r) { return r && r.reading_id; }).map(function (r) {
      return { id: String(r.reading_id), cleaner: r.cleaner_name ? String(r.cleaner_name) : '', checkout: r.checkout_date ? String(r.checkout_date) : '', at: r.recorded_at || '',
        typedE: num(r.typed_electric), typedW: num(r.typed_water), prevE: num(r.prev_electric), prevW: num(r.prev_water), photoE: num(r.photo_electric), photoW: num(r.photo_water),
        pathE: r.photo_path_electric ? String(r.photo_path_electric) : '', pathW: r.photo_path_water ? String(r.photo_path_water) : '',
        reason: r.reason ? String(r.reason) : '', asked: r.resend_requested_at || '' };
    });
  }
  function correctionProblem(row, e, w) {
    var en = num(String(e == null ? '' : e).trim()), wn = num(String(w == null ? '' : w).trim());
    if (en == null || wn == null) return 'Enter both the electric and the water number.';
    if (row.prevE != null && en < row.prevE) return 'The electric number cannot be below the last reading.';
    if (row.prevW != null && wn < row.prevW) return 'The water number cannot be below the last reading.';
    return null;
  }
  function blockCall(id, action, e, w, note) { return { fn: 'admin_resolve_report_block_v1', args: { p_reading_id: id, p_action: action, p_electric: e == null ? null : num(e), p_water: w == null ? null : num(w), p_note: String(note || '').trim() || null } }; }
  function resendCall(id, note) { return { fn: 'admin_request_meter_resend_v1', args: { p_reading_id: id, p_note: String(note || '').trim() || null } }; }
  function rateCall(php, from, note) { return { fn: 'utility_rate_set_v1', args: { p_php_per_kwh: num(php), p_effective_from: from, p_note: String(note || '').trim() || null } }; }
  function rateProblem(php, from) {
    var n = num(String(php == null ? '' : php).trim().replace(',', '.'));
    if (n == null || n <= 0 || n >= 100) return 'Enter the rate in pesos per kWh, for example 11.25.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) return 'Choose the date the rate starts.';
    return null;
  }

  /* ---------------------------------------------------------------- the screen */
  var S = null; // the live mount
  var memory = { seg: 'utility', avg: 'kwh', day: 'kwh' }; // the segment survives a re-mount in the same visit

  function manilaToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function mount(el, opts) {
    unmount();
    opts = opts || {};
    S = { el: el, opts: opts, role: opts.role, client: opts.client || null, pid: opts.propertyId, data: null, state: 'loading', seg: memory.seg, blocks: null, blocksOk: false, vals: {}, rate: null, busy: '', msg: {}, photos: {}, listeners: [], dead: false };
    if (S.seg === 'admin' && !isAdminRole(S.role)) S.seg = 'utility';
    var on = function (t, fn) { el.addEventListener(t, fn); S.listeners.push([t, fn]); };
    on('click', onClick); on('input', onInput); on('submit', onSubmit);
    draw(); load();
    return S;
  }
  function unmount() { if (!S) return; S.listeners.forEach(function (l) { try { S.el.removeEventListener(l[0], l[1]); } catch (e) { /* gone already */ } }); S.dead = true; S = null; }
  function reset() { memory.seg = 'utility'; memory.avg = 'kwh'; memory.day = 'kwh'; }

  function load() {
    var me = S; if (!me || !me.client) { if (me) { me.state = 'missing'; draw(); } return; }
    me.state = me.data ? 'ready' : 'loading';
    Promise.resolve().then(function () { return me.client.rpc('kpi_tab_v1', { p_property_id: me.pid, p_month: null }); }).then(function (r) {
      if (S !== me) return;
      if (r && r.error) { me.state = errKind(r.error); draw(); return; }
      var d = normalize(r && r.data, me.role);
      if (!d) { me.state = r && r.data && r.data.error === 'forbidden' ? 'forbidden' : 'error'; draw(); return; }
      me.data = d; me.state = 'ready'; draw();
      if (isAdminRole(me.role)) loadBlocks();
    }, function (e) { if (S === me) { me.state = errKind(e); draw(); } });
  }
  function loadBlocks() {
    var me = S; if (!me || !me.client) return;
    Promise.resolve().then(function () { return me.client.rpc('admin_report_blocks_v1', { p_property_id: me.pid }); }).then(function (r) {
      if (S !== me) return;
      if (!r || r.error) { me.blocksOk = false; me.blocks = null; draw(); return; } // finance, or an older server: the card stays away
      me.blocks = normBlocks(r.data); me.blocksOk = true; draw(); signBlocks();
    }, function () { if (S === me) { me.blocksOk = false; draw(); } });
  }
  // Photos: private bucket cleaning-photos, signed for 15 minutes, exactly like the admin dashboard card. A photo that will not sign leaves a plain note; the card still works.
  function signBlocks() {
    var me = S; if (!me || !me.blocks || !me.client || !me.client.storage) return;
    var paths = []; me.blocks.forEach(function (b) { [b.pathE, b.pathW].forEach(function (p) { if (p && !me.photos[p] && paths.indexOf(p) < 0) paths.push(p); }); });
    if (!paths.length) return;
    Promise.resolve().then(function () { return me.client.storage.from('cleaning-photos').createSignedUrls(paths, 900); }).then(function (r) {
      if (S !== me) return;
      ((r && r.data) || []).forEach(function (s) { if (s && s.path && s.signedUrl && /^(https:|data:image\/)/.test(s.signedUrl)) me.photos[s.path] = s.signedUrl; });
      draw();
    }, function () { /* photos are a help, not a gate */ });
  }

  function stat(label, value, sub, tone) {
    return '<div class="card glass K_stat"><span class="K_lab">' + esc(label) + '</span><span class="K_val">' + esc(value) + '</span>' + (sub ? '<span class="K_sub' + (tone ? ' K_' + tone : '') + '">' + esc(sub) + '</span>' : '') + '</div>';
  }
  function lineRow(icon, tone, title, sub, big, small) {
    return '<div class="K_line"><span class="K_ic K_ic-' + tone + '" aria-hidden="true">' + gi(icon, 's16') + '</span><span class="K_mid"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span><span class="K_end"><b>' + esc(big) + '</b><span>' + esc(small) + '</span></span></div>';
  }
  var EW = [['kwh', 'Electricity'], ['m3', 'Water']];
  function unitOf(kind) { return kind === 'm3' ? 'm\u00b3' : 'kWh'; }
  // Chart C: average use per stay in each of the last 12 months, a line with gaps for months with no reading. One outlier month is drawn at the top edge with an up
  // arrow and its true value, and named under the chart; the typical line is the median. Months on x every 3rd, the current month bold.
  function avgCard(u, month) {
    var rows = u.perMonth; if (!rows.length) return '';
    var hasW = rows.some(function (r) { return r.m3 != null; }), kind = hasW && memory.avg === 'm3' ? 'm3' : 'kwh', unit = unitOf(kind), d = kind === 'm3' ? 2 : 1, cur = String(month).slice(0, 7);
    if (!rows.some(function (r) { return r.month === cur; })) cur = rows[rows.length - 1].month;
    var em = rows.map(function (r) { return r.month; }).indexOf(cur), now = rows[em], bits = [], n = rows.length;
    if (now.kwh != null) bits.push(fmt(now.kwh, 1) + ' kWh');
    if (now.m3 != null) bits.push(fmt(now.m3, 2) + ' m³');
    var sum = now.stays && bits.length ? 'This month: ' + bits.join(' and ') + ' per stay over ' + plural(now.stays, 'stay') + '.' : 'No stay has been read this month yet.';
    var vals = rows.map(function (r) { return r[kind]; }), m = monthModel(vals, em), word = kind === 'm3' ? 'water' : 'electricity';
    var xs = rows.map(function (r, i) { return { i: i, text: MONTHS[monthParts(r.month).m - 1].slice(0, 3), em: i === em }; }).filter(function (x) { return (n - 1 - x.i) % 3 === 0 || x.em; });
    var odd = (m.overs || []).map(function (i) { return '<p class="K_sub KU_odd">' + gi('alert', 's16') + '<span>' + esc(fmt(vals[i], d) + ' ' + unit + ' in ' + MONTHS[monthParts(rows[i].month).m - 1] + ': unusually high, check that month’s readings.') + '</span></p>'; }).join('');
    return lineChart({ id: 'K_avg', title: 'Average per stay, last 12 months, ' + unit, dec: d, model: m, em: em, area: false, // gaps would cut the area into blocks
      tabs: hasW ? segTabs('avg', 'Average per stay', kind, EW) : '',
      aria: function (p) { var r = rows[p.i]; return monthShort(r.month) + ': ' + fmt(p.v, d) + ' ' + unit + ' per stay, ' + plural(r.stays, 'stay') + (p.over ? ', unusually high' : '') + (p.i === em ? ', this month' : ''); },
      values: [em].concat(m.overs || []), x: xs,
      key: m.typical ? '<i class="KU_ktyp"></i>' + esc('typical ' + fmt(m.typical.v, d) + ' ' + unit) : '',
      summary: 'Average ' + word + ' per stay, last 12 months, ' + unit + '. ' + (now[kind] != null ? 'This month ' + fmt(now[kind], d) + '. ' : '') + (m.typical ? 'Typical ' + fmt(m.typical.v, d) + '.' : ''),
      caption: 'Each point is the average per stay in that month. The dashed line is the typical month. A month with no reading is a gap.', foot: odd + '<p class="K_sub" id="K_avg-sum">' + esc(sum) + '</p>' });
  }
  // Chart B: use per day between the last 8 counted readings, a line with a soft area; the shaded band is the usual range (middle half of the 8); no average line.
  function dayCard(u) {
    var rows = u.perStay; if (!rows.length) return '';
    var hasW = rows.some(function (r) { return r.m3 != null; }), kind = hasW && memory.day === 'm3' ? 'm3' : 'kwh', unit = unitOf(kind), d = kind === 'm3' ? 2 : 1;
    var vals = rows.map(function (r) { return r[kind]; }), m = dayModel(vals), name = function (i) { return rows[i].date ? dayMonth(rows[i].date) : 'Reading ' + (i + 1); };
    return lineChart({ id: 'K_day', title: 'Use per day, last ' + plural(rows.length, 'reading') + ', ' + unit, dec: d, model: m, em: m.latest,
      tabs: hasW ? segTabs('day', 'Use per day between readings', kind, EW) : '',
      aria: function (p) { var r = rows[p.i]; return name(p.i) + ': ' + fmt(p.v, d) + ' ' + unit + ' a day' + (r.days ? ' over ' + plural(r.days, 'day') : '') + (p.i === m.latest ? ', latest reading' : '') + (p.i === m.highest && p.i !== m.latest ? ', highest' : ''); },
      values: m.latest != null ? [m.latest, m.highest] : [], x: xPick(rows.length).map(function (i) { return { i: i, text: name(i), em: i === m.latest }; }),
      key: m.band ? '<i class="KU_kband"></i>' + esc('usual ' + fmt(m.band.lo, d) + ' to ' + fmt(m.band.hi, d) + ' ' + unit) : '',
      summary: (kind === 'm3' ? 'Water' : 'Electricity') + ' per day, last ' + plural(rows.length, 'reading') + ', ' + unit + '. ' + (m.latest != null ? 'Latest ' + fmt(vals[m.latest], d) + ' on ' + name(m.latest) + '. ' : '') + (m.band ? 'Usual range ' + fmt(m.band.lo, d) + ' to ' + fmt(m.band.hi, d) + '.' : ''),
      caption: 'Each point is the use since the previous reading, divided by the days in between. The shaded band is the usual range.' });
  }
  // A tile: small caps label, big number and unit, one line of context, the change chip, a sparkline where it fits
  function tile(id, label, big, unit, ctx, extra) {
    return '<div class="card glass KU_tile" id="' + id + '"><span class="K_lab">' + esc(label) + '</span><span class="KU_big"><b>' + esc(big) + '</b>' + (unit ? '<span>' + esc(unit) + '</span>' : '') + '</span>' +
      (ctx ? '<span class="K_sub">' + esc(ctx) + '</span>' : '') + (extra || '') + '</div>';
  }
  function cmpWord(c) { return !c ? '' : c.dir === 'same' ? 'about the same as' : c.dir === 'down' ? 'lower than' : 'higher than'; }
  function utilityPanel(d) {
    var u = d.utility, nm = u.monthNights != null ? u.monthNights : daysIn(d.month), h = '', pm = prevMonth(d.month);
    var prev = u.perMonth.filter(function (r) { return r.month === pm; })[0] || null, pName = pm ? MONTHS[monthParts(pm).m - 1] : '';
    var cE = change(u.perDay, prev && prev.kwhDay), cW = change(u.m3PerDay, prev && prev.m3Day), last8 = function (k) { return u.perStay.map(function (r) { return r[k]; }); };
    h += '<h2 class="K_h">Utility · this month</h2><div class="K_grid2 KU_tiles">' +
      tile('K_tE', 'Electricity', u.perDay != null ? fmt(u.perDay) : u.kwh != null ? fmt(u.kwh, 0) : 'No reading', u.perDay != null ? 'kWh a day' : u.kwh != null ? 'kWh' : '',
        u.perDay != null ? (u.kwh != null ? fmt(u.kwh, 0) + ' kWh used this month' : '') : 'A day figure needs two readings', chip(cE, pName) + spark(last8('kwh'), 'Electricity per day, last readings')) +
      (u.m3 != null || u.m3PerDay != null ? tile('K_tW', 'Water', u.m3PerDay != null ? fmt(u.m3PerDay, 2) : fmt(u.m3, 1), u.m3PerDay != null ? 'm³ a day' : 'm³',
        u.m3PerDay != null ? (u.m3 != null ? fmt(u.m3, 1) + ' m³ used this month' : '') : 'A day figure needs two readings', chip(cW, pName) + spark(last8('m3'), 'Water per day, last readings')) : '') +
      '<div class="card glass KU_tile KU_tile-ring" id="K_tN"><span class="K_lab">Nights booked</span>' + (u.booked != null && nm > 0 ? '<span class="KU_ringrow">' + ring(u.booked / nm * 100) + '<span class="K_sub">' + esc(u.booked + ' of ' + nm + ' nights') + '</span></span>' : '<span class="KU_big"><b>Not yet</b></span>') + '</div>';
    if (u.last) {
      var l = u.last, over = l.days ? ' over ' + plural(l.days, 'day') : '', lines = [];
      if (l.delta != null) lines.push(fmt(l.delta) + ' kWh' + over);
      if (l.perDay != null) lines.push(fmt(l.perDay) + ' kWh a day');
      if (l.m3 != null) lines.push(fmt(l.m3, 2) + ' m³' + over + (l.m3PerDay != null ? ' · ' + fmt(l.m3PerDay, 2) + ' m³ a day' : ''));
      h += '<div class="card glass KU_tile" id="K_last"><span class="K_lab">Last reading</span><span class="KU_big"><b>' + esc(l.at ? dayMonth(l.at) : 'Recorded') + '</b></span>' +
        lines.map(function (x) { return '<span class="K_sub">' + esc(x) + '</span>'; }).join('') + (l.flag ? '<span class="K_sub K_warn">' + gi('alert', 's16') + ' This reading is being checked.</span>' : '') + '</div>';
    }
    h += '</div>';
    var means = [cE ? 'Electricity is ' + cmpWord(cE) + ' last month.' : '', cW ? 'Water is ' + cmpWord(cW) + ' last month.' : ''].filter(Boolean).join(' ');
    if (means) h += '<p class="KU_means" id="K_means"><b>What this means</b> ' + esc(means) + '</p>';
    h += dayCard(u) + avgCard(u, d.month) + '<div class="card glass K_lines">' + lineRow('zap', 'warn', 'Brownouts', 'Feeder notices', String(u.brownouts.count), u.brownouts.count ? fmt(u.brownouts.hours, 0) + ' h total' : 'none') +
      lineRow('drop', 'info', 'Water interruptions', 'GSCWD notices', String(u.water.count), u.water.count ? fmt(u.water.hours, 0) + ' h total' : 'none') +
      (u.internet ? lineRow('wifioff', 'purple', 'Internet outages', 'From notices', String(u.internet.count), u.internet.count ? fmt(u.internet.hours, 0) + ' h total' : 'none') : '') + '</div>';
    return h;
  }
  function inventoryPanel(d) {
    var v = d.inventory, h = '<h2 class="K_h">Inventory · this month</h2><div class="K_grid3">' +
      '<div class="K_mini' + (v.low ? ' K_mini-bad' : '') + '"><b>' + esc(v.low != null ? v.low : '0') + '</b><span>Low now</span></div>' +
      '<div class="K_mini"><b>' + esc(v.restocks != null ? v.restocks : '0') + '</b><span>Restocks</span></div>' +
      '<div class="K_mini"><b>' + esc(v.turnovers != null ? v.turnovers : '0') + '</b><span>Turnovers</span></div></div>';
    if (v.usage.length) {
      var worst = v.usage.filter(function (r) { return r.over; }).sort(function (a, b) { return b.overPct - a.overPct; })[0];
      h += '<div class="card glass K_chart" id="K_usage"><div class="K_chart-h"><b>Used per turnover vs usual</b></div><div class="K_use">' + v.usage.map(function (r) {
        return '<div class="K_use-row"><span>' + esc(r.name) + '</span><span class="K_track"><span class="K_fill' + (r.over ? ' K_fill-hi' : '') + '" style="width:' + r.pct + '%"></span></span><span class="K_use-n">' + esc(fmt(r.used) + (r.usual != null ? ' / ' + fmt(r.usual) : '')) + '</span></div>';
      }).join('') + '</div><p class="K_sub">' + esc(worst ? 'Gold is above the usual amount. ' + worst.name + ' ran ' + worst.overPct + '% over.' : 'Everything is close to the usual amount.') + '</p></div>';
    }
    if (v.runsOut.length) {
      h += '<div class="card glass K_lines" id="K_runs"><div class="K_line K_line-h"><b>Runs out first</b><span>Days left</span></div>' + v.runsOut.map(function (r) {
        return '<div class="K_line K_line-s"><span>' + esc(r.name) + '</span><b class="K_t-' + daysTone(r.days) + '">' + esc(plural(Math.round(r.days), 'day')) + '</b></div>';
      }).join('') + '</div>';
    }
    return h;
  }
  function adminPanel(d) {
    var a = d.admin, role = S.role, h = '';
    if (!a) return '<div class="card glass K_note"><p class="K_p">' + esc('The money figures are not available yet.') + '</p></div>';
    var rate = a.rate;
    h += monthGlance(a) + '<h2 class="K_h">Electricity cost</h2><div class="K_money" id="K_rate"><span class="K_lab">Latest SOCOTECO II rate</span>' +
      '<span class="K_big">' + esc(rate ? pesoRate(rate.php) + ' per kWh' : 'No rate on file') + '</span>' +
      '<span class="K_sub">' + esc(rate ? 'From ' + dateLabel(rate.from) + (rate.source === 'auto' ? ' · read from the SOCOTECO II post' : rate.source === 'manual' ? ' · entered by hand' : '') : 'Add the rate to see what a reading costs.') + '</span>' +
      (rate && rate.url ? '<a class="K_link" href="' + esc(rate.url) + '" target="_blank" rel="noopener">See the source</a>' : '') + '</div>';
    var l = d.utility.last, lastTxt = l && l.delta != null ? (a.lastCost != null ? 'About ' + peso(a.lastCost) + ' for ' + fmt(l.delta) + ' kWh' + (l.days ? ' over ' + plural(l.days, 'day') : '') + ', at ' + (rate ? pesoRate(rate.php) : 'the latest rate') + ' per kWh.' : fmt(l.delta) + ' kWh in the last report. The cost needs a rate on file.') : 'No consumption report yet.';
    h += '<div class="card glass K_note" id="K_lastcost"><span class="K_lab">Last reported consumption</span><p class="K_p">' + esc(lastTxt) + '</p></div>';
    if (canSetRate(role)) h += rateForm();
    h += '<h2 class="K_h">Money in utility and stock</h2><div class="card glass K_lines">' + [
      ['Electricity this month (estimate)', a.monthCost], ['Supplies bought', a.supplies], ['Supply cost per turnover', a.perTurnover], ['Cleaning pay', a.cleaning]
    ].map(function (r) { return '<div class="K_line K_line-s"><span>' + esc(r[0]) + '</span><b>' + esc(r[1] != null ? peso(r[1]) : 'Not yet') + '</b></div>'; }).join('') + '</div>';
    if (canSetRate(role)) h += '<a class="btn btn-secondary btn-block" href="#manage/kpis">' + gi('star', 's16') + 'Open the full key figures</a>';
    return h + metersCard();
  }
  function pctOf(v) { return v != null ? Math.round(v * 100) + '%' : 'Not yet'; }
  // The month at a glance (Admin.dc.html): the net card, then occupancy, average rate and direct bookings. Only the parts the server sent.
  function monthGlance(a) {
    var h = '';
    if (a.net) {
      var n = a.net, bits = [n.revenue != null ? 'Revenue ' + peso(n.revenue) : '', n.costs != null ? 'costs ' + peso(n.costs) : ''].filter(Boolean);
      h += '<div class="K_money" id="K_net"><span class="K_lab">Net this month so far</span><span class="K_big">' + esc(n.net != null ? peso(n.net) : 'Not yet') + '</span><span class="K_sub">' + esc(bits.join(' · ') || 'Revenue and costs are not in yet.') + '</span></div>';
    }
    var tiles = '';
    if (a.occupancy) { var o = a.occupancy; tiles += stat('Occupancy', pctOf(o.pct), o.pct != null && o.sold != null && o.sellable != null ? o.sold + ' of ' + o.sellable + ' nights' : '', o.pct != null && o.sold != null && o.sellable != null ? 'ok' : ''); }
    if ('adr' in a) tiles += stat('Average rate', a.adr != null ? peso(a.adr) : 'Not yet', a.adr != null ? 'a night, on average' : '');
    if ('direct' in a) tiles += stat('Direct bookings', pctOf(a.direct), a.direct != null ? 'of nights, no Airbnb fee' : '');
    return h + (tiles ? '<div class="K_grid2" id="K_glance">' + tiles + '</div>' : '') + targetCard(a.target);
  }
  // s111 rev 2: the Target card under Average rate. The owner sets a monthly net target (0 = break-even); the server works out the revenue needed from the
  // last 3 months' costs and what that means in occupancy at the average rate, or in rate for the nights already booked. Unknown parts read "Not enough data yet".
  var NED = 'Not enough data yet';
  function targetLines(t) {
    if (!t) return null;
    var goal = t.net > 0 ? peso(t.net) + ' net' : 'Break-even', parts = [];
    if (t.need == null) return { goal: goal, line: NED + '.', basis: 'Costs basis: ' + (t.costs != null ? 'average of the last 3 months, ' + peso(t.costs) : NED.toLowerCase()) + '.' };
    parts.push(t.occ == null || t.adr == null ? 'occupancy: ' + NED.toLowerCase() : t.occ > 1 ? 'more nights than the month has at ' + peso(t.adr) + ' a night before Airbnb fees' : 'about ' + Math.round(t.occ * 100) + '% occupancy at ' + peso(t.adr) + ' a night before Airbnb fees');
    parts.push(t.needAdr == null || !t.onBooks ? 'a rate for the booked nights: ' + NED.toLowerCase() : peso(t.needAdr) + ' a night for the ' + plural(t.onBooks, 'night') + ' already booked');
    var sum = t.costs != null ? ' (' + peso(t.costs) + ' costs + ' + peso(t.net) + ' target)' : '';
    return { goal: goal, line: 'To reach ' + peso(t.need) + ' in revenue this month' + sum + ': ' + parts.join(', or ') + '.', basis: 'Costs basis: ' + (t.costs != null ? 'average of the last 3 months, ' + peso(t.costs) : NED.toLowerCase()) + '.' };
  }
  function targetCard(t) {
    if (!t) return '';
    var L = targetLines(t), m = S.msg.tgt || '';
    return '<div class="card glass K_note" id="K_target"><span class="K_lab">Target this month</span><span class="K_val">' + esc(L.goal) + '</span><p class="K_p">' + esc(L.line) + '</p><p class="K_sub">' + esc(L.basis) + '</p>' +
      (canSetRate(S.role) ? (S.tgt ? targetForm() : '<button class="btn btn-secondary" type="button" data-kact="tgt-open">' + gi('star', 's16') + 'Set target</button>') : '') + (m ? '<p class="K_sub K_ok" role="status">' + esc(m) + '</p>' : '') + '</div>';
  }
  function targetForm() {
    return '<form class="K_form K_tform" data-kform="tgt" novalidate><div class="field"><label for="K_f_tgt">Monthly net target, pesos</label><div class="input"><input id="K_f_tgt" inputmode="decimal" autocomplete="off" value="' + esc(S.vals.tgt || '') + '"></div></div>' +
      '<p class="K_sub">0 means break-even: income covers the costs. Centavos are kept, up to 2 decimals.</p>' + (S.tgt.err ? '<p class="K_sub K_bad" role="alert">' + esc(S.tgt.err) + '</p>' : '') +
      '<div class="K_btns"><button class="btn btn-primary" type="submit"' + (S.busy === 'tgt' ? ' disabled' : '') + '>' + (S.busy === 'tgt' ? 'Saving…' : 'Save the target') + '</button><button class="btn btn-ghost" type="button" data-kact="tgt-close">Cancel</button></div></form>';
  }
  function targetProblem(v) {
    var s = String(v == null ? '' : v).trim().replace(/[₱,\s]/g, ''), n = s === '' ? null : num(s);
    if (n == null || n < 0 || n > 10000000 || !/^\d*(\.\d{0,2})?$/.test(s)) return 'Enter an amount from 0 to 10,000,000 pesos, up to 2 decimals. 0 means break-even.';
    return null;
  }
  function targetCall(pid, v) { return { fn: 'kpi_target_set_v1', args: { p_property_id: pid, p_monthly_net_target: num(String(v).trim().replace(/[₱,\s]/g, '')) } }; } // kpi_target_set_v1 keeps 2 dp (numeric(12,2)); targetProblem refuses more, so nothing is rounded here
  function rateForm() {
    var f = S.vals, m = S.msg.rate || '', open = S.rate;
    if (!open) return '<button class="btn btn-secondary btn-block" type="button" data-kact="rate-open">' + gi('cash', 's16') + 'Update rate</button>' + (m ? '<p class="K_sub K_ok" role="status">' + esc(m) + '</p>' : '');
    return '<form class="card glass K_form" data-kform="rate" novalidate><h3 class="K_fh">Update the rate</h3>' +
      '<div class="field"><label for="K_f_php">Pesos per kWh</label><div class="input"><input id="K_f_php" inputmode="decimal" autocomplete="off" value="' + esc(f.php || '') + '"></div></div>' +
      '<div class="field"><label for="K_f_from">Starts on</label><div class="input"><input id="K_f_from" type="date" value="' + esc(f.from || manilaToday()) + '"></div></div>' +
      '<div class="field"><label for="K_f_rnote">Note (optional)</label><div class="input"><input id="K_f_rnote" autocomplete="off" maxlength="120" value="' + esc(f.rnote || '') + '"></div></div>' +
      (S.rate.err ? '<p class="K_sub K_bad" role="alert">' + esc(S.rate.err) + '</p>' : '') +
      '<div class="K_btns"><button class="btn btn-primary" type="submit"' + (S.busy === 'rate' ? ' disabled' : '') + '>' + (S.busy === 'rate' ? 'Saving…' : 'Save the rate') + '</button><button class="btn btn-ghost" type="button" data-kact="rate-close">Cancel</button></div></form>';
  }
  function photoBox(label, path) {
    var url = path && S.photos[path];
    return '<div class="K_ph">' + (url ? '<button class="K_phb" type="button" data-kact="zoom" data-path="' + esc(path) + '" data-alt="' + esc(label + ' meter photo') + '" aria-label="' + esc('Zoom the ' + label.toLowerCase() + ' meter photo') + '"><img src="' + esc(url) + '" alt="' + esc(label + ' meter photo') + '" loading="lazy" decoding="async" draggable="false"></button>' :'<span class="K_sub">' + esc(path ? 'Photo loading' : 'No photo') + '</span>') + '</div>';
  }
  function metersCard() {
    if (!S.blocksOk) return '';
    var rows = S.blocks || [];
    var h = '<h2 class="K_h">Meter checks</h2>';
    if (!rows.length) return h + '<div class="card glass K_note" id="K_meters"><p class="K_p">' + gi('check', 's16') + ' No meter readings need a look. Thank you.</p></div>';
    return h + '<div id="K_meters" class="K_meters">' + rows.map(function (b) {
      var fix = S.vals['fix:' + b.id], pair = function (name, typed, photo) { return '<div class="K_pair"><span>' + name + '</span><b>' + esc(typed != null ? fmt(typed, 2) : '–') + '</b><span class="K_sub">' + esc('Photo reads ' + (photo != null ? fmt(photo, 2) : 'unclear')) + '</span></div>'; };
      var head = b.reason === 'meter_order' ? 'Meter number out of order' : 'Typed numbers and photos do not match';
      return '<section class="card glass K_meter" data-block="' + esc(b.id) + '"><h3 class="K_fh">' + esc(head) + '</h3><p class="K_sub">' + esc([b.cleaner ? 'Reported by ' + b.cleaner.split(/\s+/)[0] : '', b.checkout ? 'stay ending ' + dateLabel(b.checkout) : ''].filter(Boolean).join(' · ')) + '</p>' +
        '<div class="K_pairs">' + pair('Electric typed', b.typedE, b.photoE) + pair('Water typed', b.typedW, b.photoW) + '</div>' +
        '<div class="K_phs">' + photoBox('Electric', b.pathE) + photoBox('Water', b.pathW) + '</div>' +
        (b.asked ? '<p class="K_sub K_ok">' + esc('A new photo was asked for on ' + dateLabel(b.asked) + '.') + '</p>' : '') +
        (S.msg['b:' + b.id] ? '<p class="K_sub K_bad" role="alert">' + esc(S.msg['b:' + b.id]) + '</p>' : '') +
        (fix ? '<div class="K_fixrow"><div class="field"><label for="K_fe_' + esc(b.id) + '">Electric</label><div class="input"><input id="K_fe_' + esc(b.id) + '" data-fix="e" data-id="' + esc(b.id) + '" inputmode="decimal" autocomplete="off" value="' + esc(fix.e) + '"></div></div>' +
          '<div class="field"><label for="K_fw_' + esc(b.id) + '">Water</label><div class="input"><input id="K_fw_' + esc(b.id) + '" data-fix="w" data-id="' + esc(b.id) + '" inputmode="decimal" autocomplete="off" value="' + esc(fix.w) + '"></div></div></div>' +
          '<div class="K_btns"><button class="btn btn-primary" type="button" data-kact="fix-save" data-id="' + esc(b.id) + '"' + (S.busy === b.id ? ' disabled' : '') + '>Save the corrected numbers</button><button class="btn btn-ghost" type="button" data-kact="fix-close" data-id="' + esc(b.id) + '">Cancel</button></div>'
          : '<div class="K_btns"><button class="btn btn-secondary" type="button" data-kact="typed-ok" data-id="' + esc(b.id) + '"' + (S.busy === b.id ? ' disabled' : '') + '>Typed numbers are right</button>' +
            '<button class="btn btn-secondary" type="button" data-kact="fix-open" data-id="' + esc(b.id) + '">Correct the numbers</button>' +
            (S.noResend ? '' : '<button class="btn btn-ghost" type="button" data-kact="resend" data-id="' + esc(b.id) + '"' + (S.busy === b.id ? ' disabled' : '') + '>Ask for a new photo</button>') + '</div>') + '</section>';
    }).join('') + '</div>';
  }

  function draw() {
    if (!S) return;
    var d = S.data, adm = isAdminRole(S.role), seg = S.seg, body;
    var segs = [['utility', 'Utility'], ['inventory', 'Inventory']].concat(adm ? [['admin', 'Admin']] : []);
    var head = '<div class="K_head"><div class="K_head-r"><span class="K_month">' + esc(d ? monthLabel(d.month) : '') + '</span></div>' +
      '<div class="K_seg' + (segs.length === 3 ? ' K_seg3' : '') + '" role="tablist" aria-label="Key figures">' + segs.map(function (s) {
        return '<button class="K_seg-b" type="button" role="tab" data-kact="seg" data-seg="' + s[0] + '" aria-selected="' + (seg === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div></div>';
    if (S.state === 'loading' && !d) body = '<div class="skel" style="height:120px"></div><div class="skel" style="height:96px"></div>';
    else if (!d) body = '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc(stateMsg(S.state)) + (S.state === 'error' || S.state === 'offline' ? ' <button class="btn btn-ghost btn-sm" type="button" data-kact="retry">Try again</button>' : '') + '</span></div>';
    else body = seg === 'admin' && adm ? adminPanel(d) : seg === 'inventory' ? inventoryPanel(d) : utilityPanel(d);
    S.el.innerHTML = '<div class="K_wrap">' + head + '<div class="K_body" role="tabpanel">' + body + '</div><div class="sr" role="status" aria-live="polite" data-k-live></div></div>';
  }

  /* ---------------------------------------------------------------- events */
  function attr(t, n) { return t && t.getAttribute ? t.getAttribute(n) : null; }
  function say(t) { if (S && S.opts.toast) S.opts.toast(t); }
  function onInput(ev) {
    var t = ev.target; if (!S || !t) return;
    var id = t.id || '', fix = attr(t, 'data-fix');
    if (id === 'K_f_php') S.vals.php = t.value; else if (id === 'K_f_from') S.vals.from = t.value; else if (id === 'K_f_rnote') S.vals.rnote = t.value; else if (id === 'K_f_tgt') S.vals.tgt = t.value;
    else if (fix) { var f = S.vals['fix:' + attr(t, 'data-id')]; if (f) f[fix] = t.value; }
  }
  function blockOf(id) { return (S.blocks || []).filter(function (b) { return b.id === id; })[0] || null; }
  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-kact]') : null; if (!S || !t) return;
    var act = attr(t, 'data-kact'), id = attr(t, 'data-id'), b;
    if (act === 'seg') { var s = attr(t, 'data-seg'); if (s === 'admin' && !isAdminRole(S.role)) return; S.seg = s; memory.seg = s; draw(); return; }
    if (act === 'avg') { memory.avg = attr(t, 'data-avg') === 'm3' ? 'm3' : 'kwh'; draw(); return; }
    if (act === 'day') { memory.day = attr(t, 'data-kunit') === 'm3' ? 'm3' : 'kwh'; draw(); return; }
    if (act === 'zoom') { var src = S.photos[attr(t, 'data-path')]; if (src && root.CSZoom) root.CSZoom.open(src, { alt: attr(t, 'data-alt') || 'Meter photo', opener: t }); return; }
    if (act === 'tgt-open') { if (!canSetRate(S.role)) return; var tg0 = S.data && S.data.admin && S.data.admin.target; S.tgt = { err: '' }; S.vals.tgt = tg0 && tg0.net ? String(tg0.net) : ''; draw(); return; }
    if (act === 'tgt-close') { S.tgt = null; draw(); return; }
    if (act === 'retry') { S.state = 'loading'; draw(); load(); return; }
    if (act === 'rate-open') { if (!canSetRate(S.role)) return; S.rate = { err: '' }; S.vals.php = S.data && S.data.admin && S.data.admin.rate ? String(S.data.admin.rate.php) : ''; S.vals.from = manilaToday(); draw(); return; }
    if (act === 'rate-close') { S.rate = null; draw(); return; }
    if (act === 'fix-open') { b = blockOf(id); if (b) { S.vals['fix:' + id] = { e: b.photoE != null ? String(b.photoE) : '', w: b.photoW != null ? String(b.photoW) : '' }; draw(); } return; }
    if (act === 'fix-close') { delete S.vals['fix:' + id]; delete S.msg['b:' + id]; draw(); return; }
    if (act === 'typed-ok') { blockRun(id, blockCall(id, 'typed_is_right', null, null, ''), 'Kept the typed numbers.'); return; }
    if (act === 'fix-save') {
      b = blockOf(id); var f = S.vals['fix:' + id]; if (!b || !f) return;
      var prob = correctionProblem(b, f.e, f.w); if (prob) { S.msg['b:' + id] = prob; draw(); return; }
      blockRun(id, blockCall(id, 'correct_numbers', f.e, f.w, ''), 'Saved the corrected numbers.'); return;
    }
    if (act === 'resend') { blockRun(id, resendCall(id, ''), 'Asked for a new photo.', true); return; }
  }
  function blockRun(id, call, ok, keep) {
    var me = S; if (!me || me.busy) return; me.busy = id; delete me.msg['b:' + id]; draw();
    Promise.resolve().then(function () { return me.client.rpc(call.fn, call.args); }).then(function (r) {
      if (S !== me) return; me.busy = '';
      var bad = !r || r.error || (r.data && r.data.ok === false);
      if (bad) {
        if (r && r.error && errKind(r.error) === 'missing' && call.fn === 'admin_request_meter_resend_v1') me.noResend = true;
        me.msg['b:' + id] = r && r.data && r.data.message ? String(r.data.message) : r && r.error && errKind(r.error) === 'missing' ? 'This is not available yet.' : 'The server did not accept this. Nothing was changed.'; draw(); return;
      }
      delete me.vals['fix:' + id];
      if (keep) { var b = blockOf(id); if (b) b.asked = new Date().toISOString(); } else me.blocks = (me.blocks || []).filter(function (x) { return x.id !== id; });
      say(ok); draw();
    }, function () { if (S === me) { me.busy = ''; me.msg['b:' + id] = 'No connection. Nothing was changed.'; draw(); } });
  }
  function onSubmit(ev) {
    var f = ev.target && ev.target.closest ? ev.target.closest('[data-kform]') : ev.target; if (ev.preventDefault) ev.preventDefault();
    if (S && S.tgt && !S.busy && attr(f, 'data-kform') === 'tgt') { targetSubmit(); return; }
    if (!S || !S.rate || S.busy || attr(f, 'data-kform') !== 'rate') return;
    var me = S, prob = rateProblem(me.vals.php, me.vals.from); if (prob) { me.rate.err = prob; draw(); return; }
    var c = rateCall(String(me.vals.php).replace(',', '.'), me.vals.from, me.vals.rnote);
    me.busy = 'rate'; me.rate.err = ''; draw();
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (S !== me) return; me.busy = '';
      if (!r || r.error || (r.data && r.data.ok === false)) { me.rate.err = r && r.data && r.data.error === 'invalid_rate' ? 'That rate is not in range. Check the number.' : 'The rate was not saved. Try again.'; draw(); return; }
      me.rate = null; me.msg.rate = 'Rate saved. The costs below use it.'; say('Rate saved'); load();
    }, function () { if (S === me) { me.busy = ''; me.rate.err = 'No connection. The rate was not saved.'; draw(); } });
  }

  function targetSubmit() {
    var me = S; if (!canSetRate(me.role)) return;
    var prob = targetProblem(me.vals.tgt); if (prob) { me.tgt.err = prob; draw(); return; }
    var c = targetCall(me.pid, me.vals.tgt); me.busy = 'tgt'; me.tgt.err = ''; draw();
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (S !== me) return; me.busy = '';
      if (!r || r.error || (r.data && r.data.ok === false)) { var e = r && r.data && r.data.error; me.tgt.err = e === 'invalid_target' ? 'That amount is not in range. Check the number.' : e === 'forbidden' ? 'Only the owner or an admin can set the target.' : 'The target was not saved. Try again.'; draw(); return; }
      me.tgt = null; me.msg.tgt = 'Target saved.'; say('Target saved'); load();
    }, function () { if (S === me) { me.busy = ''; me.tgt.err = 'No connection. The target was not saved.'; draw(); } });
  }

  root.K_Kpi = { mount: mount, unmount: unmount, reset: reset, lib: {
    esc: esc, normalize: normalize, niceMax: niceMax, ticksFor: ticksFor, percentile: percentile, median: median, lineModel: lineModel, dayModel: dayModel, monthModel: monthModel, xPick: xPick, change: change, prevMonth: prevMonth, yOf: yOf, PLOT: PLOT, targetLines: targetLines, targetProblem: targetProblem, targetCall: targetCall, usageRows: usageRows, daysTone: daysTone, rateCost: rateCost, monthLabel: monthLabel, daysIn: daysIn, isAdminRole: isAdminRole, canSetRate: canSetRate,
    normBlocks: normBlocks, correctionProblem: correctionProblem, blockCall: blockCall, resendCall: resendCall, rateCall: rateCall, rateProblem: rateProblem, errKind: errKind, peso: peso, pesoRate: pesoRate
  } };
})(typeof window !== 'undefined' ? window : this);
