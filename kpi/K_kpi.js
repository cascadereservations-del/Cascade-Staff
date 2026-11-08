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

  // Bars: a height in percent of the tallest, never under 8 so a small value still shows. `hi` marks a stay above 125% of the average.
  function barHeights(values) {
    var v = (values || []).map(num).filter(function (x) { return x != null; }), max = Math.max.apply(null, v.concat([0])), avg = v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : 0;
    return v.map(function (x) { return { value: x, pct: max > 0 ? Math.max(8, Math.round(x / max * 100)) : 8, hi: v.length > 2 && avg > 0 && x > avg * 1.25 }; });
  }
  // Used per turnover against the usual: the bar is scaled to the largest figure on the list; over = more than 110% of usual.
  function usageRows(rows) {
    var list = (rows || []).map(function (r) { return { name: String((r && r.name) || ''), used: num(r && r.used_per_turnover), usual: num(r && r.usual) }; }).filter(function (r) { return r.name && r.used != null; });
    var scale = Math.max.apply(null, list.map(function (r) { return Math.max(r.used, r.usual || 0); }).concat([0]));
    return list.map(function (r) { r.pct = scale > 0 ? Math.max(4, Math.round(r.used / scale * 100)) : 4; r.over = r.usual != null && r.usual > 0 && r.used > r.usual * 1.1; r.overPct = r.usual > 0 ? Math.round((r.used / r.usual - 1) * 100) : 0; return r; });
  }
  function daysTone(d) { return d != null && d <= 5 ? 'bad' : d != null && d <= 10 ? 'warn' : 'ok'; }
  function rateCost(kwh, rate) { var k = num(kwh), r = num(rate); return k != null && r != null ? k * r : null; }

  // One kpi_tab_v1 payload to what the screen draws. `admin` survives only for owner, admin and finance; anything else is dropped here, before any drawing.
  function normalize(raw, role) {
    if (!raw || typeof raw !== 'object' || raw.ok === false) return null;
    var u = raw.utility || {}, inv = raw.inventory || {}, lr = u.last_reading && typeof u.last_reading === 'object' ? u.last_reading : null;
    var out = {
      month: String(raw.month || ''),
      utility: { kwh: num(u.kwh_month), nights: num(u.nights_month), perNight: num(u.kwh_per_night),
        last: lr ? { at: lr.recorded_at || null, delta: num(lr.delta_kwh), nights: num(lr.nights), perNight: num(lr.kwh_per_night), flag: lr.flag ? String(lr.flag) : '' } : null,
        stays: barHeights((u.per_stay || []).map(function (s) { return s && s.kwh_per_night; })),
        stayDates: (u.per_stay || []).map(function (s) { return s && s.checkout_date ? String(s.checkout_date) : ''; }),
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
  var memory = { seg: 'utility' }; // the segment survives a re-mount in the same visit

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
  function reset() { memory.seg = 'utility'; }

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
  function utilityPanel(d) {
    var u = d.utility, days = daysIn(d.month), full = u.nights != null ? Math.round(u.nights / days * 100) : null, h = '';
    h += '<h2 class="K_h">Utility · this month</h2><div class="K_grid2">' +
      stat('Electricity', u.kwh != null ? fmt(u.kwh, 0) + ' kWh' : 'No reading yet', u.perNight != null ? fmt(u.perNight) + ' kWh per night' : 'Per night once a stay is read') +
      stat('Nights booked', u.nights != null ? String(u.nights) : 'None yet', u.nights != null ? 'of ' + days + ' · ' + full + '% full' : '') + '</div>';
    if (u.last) {
      var l = u.last, bits = [];
      if (l.delta != null) bits.push(fmt(l.delta) + ' kWh' + (l.nights ? ' over ' + plural(l.nights, 'night') : ''));
      if (l.perNight != null) bits.push(fmt(l.perNight) + ' kWh a night');
      h += '<div class="card glass K_note" id="K_last"><span class="K_lab">Last meter reading' + (l.at ? ' · ' + esc(dateLabel(l.at)) : '') + '</span><p class="K_p">' + esc(bits.join(' · ') || 'Recorded') + '</p>' + (l.flag ? '<p class="K_sub K_warn">' + gi('alert', 's16') + ' This reading is being checked.</p>' : '') + '</div>';
    }
    if (u.stays.length) {
      var hi = u.stays.filter(function (b) { return b.hi; }).sort(function (a, b) { return b.value - a.value; })[0];
      h += '<div class="card glass K_chart" id="K_stays"><div class="K_chart-h"><b>kWh per night, last ' + u.stays.length + ' stays</b></div><div class="K_bars" role="img" aria-label="' + esc('kWh per night for the last ' + u.stays.length + ' stays: ' + u.stays.map(function (b) { return fmt(b.value); }).join(', ')) + '">' +
        u.stays.map(function (b) { return '<span class="K_bar' + (b.hi ? ' K_bar-hi' : '') + '" style="height:' + b.pct + '%"></span>'; }).join('') + '</div>' +
        '<p class="K_sub">' + esc(hi ? 'The gold bar used more than usual: ' + fmt(hi.value) + ' kWh a night.' : 'No stay stood out from the others.') + '</p></div>';
    }
    h += '<div class="card glass K_lines">' + lineRow('zap', 'warn', 'Brownouts', 'Feeder notices', String(u.brownouts.count), u.brownouts.count ? fmt(u.brownouts.hours, 0) + ' h total' : 'none') +
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
    var l = d.utility.last, lastTxt = l && l.delta != null ? (a.lastCost != null ? 'About ' + peso(a.lastCost) + ' for ' + fmt(l.delta) + ' kWh' + (l.nights ? ' over ' + plural(l.nights, 'night') : '') + ', at ' + (rate ? pesoRate(rate.php) : 'the latest rate') + ' per kWh.' : fmt(l.delta) + ' kWh in the last report. The cost needs a rate on file.') : 'No consumption report yet.';
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
    if ('adr' in a) tiles += stat('Average rate', a.adr != null ? peso(a.adr) : 'Not yet', a.adr != null ? 'per night' : '');
    if ('direct' in a) tiles += stat('Direct bookings', pctOf(a.direct), a.direct != null ? 'of nights, no Airbnb fee' : '');
    return h + (tiles ? '<div class="K_grid2" id="K_glance">' + tiles + '</div>' : '');
  }
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
    return '<div class="K_ph">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(label + ' meter photo') + '" loading="lazy" decoding="async">' : '<span class="K_sub">' + esc(path ? 'Photo loading' : 'No photo') + '</span>') + '</div>';
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
    if (id === 'K_f_php') S.vals.php = t.value; else if (id === 'K_f_from') S.vals.from = t.value; else if (id === 'K_f_rnote') S.vals.rnote = t.value;
    else if (fix) { var f = S.vals['fix:' + attr(t, 'data-id')]; if (f) f[fix] = t.value; }
  }
  function blockOf(id) { return (S.blocks || []).filter(function (b) { return b.id === id; })[0] || null; }
  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-kact]') : null; if (!S || !t) return;
    var act = attr(t, 'data-kact'), id = attr(t, 'data-id'), b;
    if (act === 'seg') { var s = attr(t, 'data-seg'); if (s === 'admin' && !isAdminRole(S.role)) return; S.seg = s; memory.seg = s; draw(); return; }
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

  root.K_Kpi = { mount: mount, unmount: unmount, reset: reset, lib: {
    esc: esc, normalize: normalize, barHeights: barHeights, usageRows: usageRows, daysTone: daysTone, rateCost: rateCost, monthLabel: monthLabel, daysIn: daysIn, isAdminRole: isAdminRole, canSetRate: canSetRate,
    normBlocks: normBlocks, correctionProblem: correctionProblem, blockCall: blockCall, resendCall: resendCall, rateCall: rateCall, rateProblem: rateProblem, errKind: errKind, peso: peso, pesoRate: pesoRate
  } };
})(typeof window !== 'undefined' ? window : this);
