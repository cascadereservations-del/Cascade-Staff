// Lane N charts (s89 L3): pure functions that return HTML/SVG strings. No DOM, no clock, no dependencies.
// Colours live in N_charts.css (tokens only). Every figure is passed in; nothing is computed from the real time.
(function () {
  'use strict';
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; }); }
  function group(n) { var s = String(Math.abs(Math.round(n))), o = ''; while (s.length > 3) { o = ',' + s.slice(-3) + o; s = s.slice(0, -3); } return s + o; }

  // PHP money: no decimals from 1,000 up, two decimals below (dropped when whole). Not a number -> em dash.
  function formatPHP(v) {
    v = num(v); if (v === null) return '—';
    var a = Math.abs(v), big = a >= 1000, body = big ? group(a) : (a % 1 === 0 ? String(a) : a.toFixed(2));
    return (v < 0 && (big ? Math.round(a) : a) !== 0 ? '−' : '') + '₱' + body;
  }
  // A change as text, always signed. unit '%' (relative change) or 'pt' (percentage points).
  function formatDelta(v, unit) {
    v = num(v); if (v === null) return '—';
    var d = Math.round(Math.abs(v) * 10) / 10, sign = d === 0 ? '' : (v > 0 ? '+' : '−');
    return sign + (Number.isInteger(d) ? String(d) : d.toFixed(1)) + (unit === 'pt' ? ' pt' : '%');
  }
  function formatPoints(v) { return formatDelta(v, 'pt'); }
  function formatPercent(v) { v = num(v); return v === null ? '—' : (Math.round(v * 10) / 10) + '%'; }

  // Sparkline: area + line; null = gap; a lone point = a dot. Zero floor so 60-61-60 does not look volatile.
  function spark(vals) {
    var W = 120, H = 32, mn = Infinity, mx = -Infinity; vals = vals || [];
    vals.forEach(function (v) { v = num(v); if (v !== null) { if (v < mn) mn = v; if (v > mx) mx = v; } });
    var dot = function (p) { return '<path class="C_sdot" d="M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' h0.01"/>'; }; // zero-length round-cap stroke: a dot that stays round when the svg is stretched
    var open = '<svg class="C_spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">';
    if (mn === Infinity) return open + '</svg>';
    mn = Math.min(0, mn); var span = mx - mn, segs = [], cur = [];
    vals.forEach(function (v, i) {
      v = num(v);
      if (v === null) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push({ x: vals.length > 1 ? 2 + (W - 4) * i / (vals.length - 1) : W / 2, y: span > 0 ? H - 4 - (H - 8) * ((v - mn) / span) : H / 2 });
    });
    if (cur.length) segs.push(cur);
    return open + segs.map(function (sg) {
      if (sg.length === 1) return dot(sg[0]);
      var d = sg.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
      return '<path class="C_sarea" d="' + d + ' L' + sg[sg.length - 1].x.toFixed(1) + ' ' + H + ' L' + sg[0].x.toFixed(1) + ' ' + H + ' Z"/><path class="C_sline" d="' + d + '"/>' + (sg === segs[segs.length - 1] && num(vals[vals.length - 1]) !== null ? dot(sg[sg.length - 1]) : '');
    }).join('') + '</svg>';
  }

  // d: number (relative %) or {v, unit}. Colour by meaning via goodWhen; neutral and zero are grey. null -> no chip.
  function chip(d, label, goodWhen) {
    var v, unit = '%'; if (d && typeof d === 'object') { v = num(d.v); unit = d.unit || '%'; } else v = num(d);
    if (v === null) return '';
    var cls = 'C_flat', glyph = '■';
    if (v !== 0) {
      glyph = v > 0 ? '▲' : '▼';
      if (goodWhen === 'up') cls = v > 0 ? 'C_good' : 'C_bad'; else if (goodWhen === 'down') cls = v < 0 ? 'C_good' : 'C_bad';
    }
    var txt = formatDelta(v, unit);
    return '<span class="C_chip ' + cls + '" aria-label="' + esc(label + ': ' + (v === 0 ? 'unchanged' : (v > 0 ? 'up ' : 'down ') + txt.replace(/^[+−]/, ''))) + '"><span aria-hidden="true">' + glyph + '</span> ' + esc(txt) + ' <span class="C_vs">' + esc(label) + '</span></span>';
  }

  // kpiTile({title, value, unit, spark, deltaPrev, deltaYoY, prevLabel, yoyLabel, goodWhen}) -> HTML; the labels name the compared period ("vs Aug"). A string value is shown as given (pre-formatted).
  function kpiTile(o) {
    o = o || {}; var gw = o.goodWhen === 'up' || o.goodWhen === 'down' ? o.goodWhen : 'neutral', val;
    if (typeof o.value === 'number') val = num(o.value) === null ? '—' : String(Math.round(o.value * 10) / 10);
    else val = o.value == null || o.value === '' ? '—' : String(o.value);
    var chips = chip(o.deltaPrev, o.prevLabel || 'vs previous', gw) + chip(o.deltaYoY, o.yoyLabel || 'vs last year', gw);
    return '<article class="C_tile C_' + gw + '"><h3 class="C_title">' + esc(o.title) + '</h3>' +
      '<p class="C_val"><span class="C_num">' + esc(val) + '</span>' + (o.unit ? '<span class="C_unit"> ' + esc(o.unit) + '</span>' : '') + '</p>' +
      (chips ? '<p class="C_chips">' + chips + '</p>' : '') + spark(o.spark) + '</article>';
  }

  // monthBars({months:[{label, title, value, lastYear, occupancy}], format, sel}) -> figure: bars, faint grid, occupancy line, tap/hover caption (role=status), hidden table.
  // sel = highlighted month (default newest); the host re-renders on a hit button's data-n="mon". Text is HTML, never svg text, so it does not stretch.
  function monthBars(o) {
    o = o || {}; var months = o.months || [], fmt = typeof o.format === 'function' ? o.format : formatPHP, n = months.length;
    if (!n) return '<figure class="C_fig"><p class="C_empty">No monthly data yet.</p></figure>';
    var W = 360, H = 140, top = 22, bot = 4, ph = H - top - bot, mx = 0, svg = '', rows = '', labs = '', hits = '', caps = [], bestI = -1, best = -Infinity, pts = [];
    var sel = typeof o.sel === 'number' && o.sel >= 0 && o.sel < n ? Math.floor(o.sel) : n - 1;
    months.forEach(function (m) { [num(m.value), num(m.lastYear)].forEach(function (v) { if (v !== null && v > mx) mx = v; }); }); var hasMax = mx > 0; if (!hasMax) mx = 1;
    var slot = W / n, bw = slot * 0.56, yAt = function (f) { return (top + ph * (1 - f)).toFixed(1); };
    [1, 2 / 3, 1 / 3].forEach(function (f) { svg += '<line class="C_grid" x1="0" x2="' + W + '" y1="' + yAt(f) + '" y2="' + yAt(f) + '"/>'; });
    svg += '<line class="C_base" x1="0" x2="' + W + '" y1="' + yAt(0) + '" y2="' + yAt(0) + '"/>';
    months.forEach(function (m, i) {
      var v = num(m.value), ly = num(m.lastYear), oc = num(m.occupancy), x = slot * i + (slot - bw) / 2, cx = slot * i + slot / 2, ttl = m.title || m.label, txt;
      if (v !== null && v > 0 && v > best) { best = v; bestI = i; }
      if (v !== null && v > 0) { var h = Math.max(1.5, ph * v / mx); svg += '<rect class="C_bar' + (i === sel ? ' C_on' : '') + '" x="' + x.toFixed(1) + '" y="' + (top + ph - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3"/>'; }
      if (ly !== null && ly > 0) { var hl = Math.max(1.5, ph * ly / mx); svg += '<rect class="C_ly" x="' + (x - 3).toFixed(1) + '" y="' + (top + ph - hl - 1.5).toFixed(1) + '" width="' + (bw + 6).toFixed(1) + '" height="3" rx="1.5"/>'; }
      if (oc !== null) pts.push({ x: cx, y: top + ph * (1 - Math.min(100, Math.max(0, oc)) / 100), i: i }); else pts.push(null);
      labs += '<span' + (i === sel ? ' class="C_on"' : '') + '>' + esc(String(m.label == null ? '' : m.label).slice(0, 3)) + '</span>';
      txt = ttl + ': ' + (v === null ? 'No data' : fmt(v)) + (ly === null ? '' : ' · same month last year ' + fmt(ly)) + (oc === null ? '' : ' · occupancy ' + formatPercent(oc));
      caps.push(txt);
      hits += '<button class="C_hit" type="button" data-n="mon" data-v="' + i + '" aria-pressed="' + (i === sel) + '" aria-label="' + esc(txt) + '"></button>';
      rows += '<tr><th scope="row">' + esc(ttl) + '</th><td>' + (v === null ? 'No data' : esc(fmt(v))) + '</td><td>' + (ly === null ? 'No data' : esc(fmt(ly))) + '</td><td>' + (oc === null ? 'No data' : esc(formatPercent(oc))) + '</td></tr>';
    });
    var seg = [], cur = []; pts.forEach(function (p) { if (p) cur.push(p); else { if (cur.length) seg.push(cur); cur = []; } }); if (cur.length) seg.push(cur);
    seg.forEach(function (sg) { if (sg.length > 1) svg += '<path class="C_oline" d="' + sg.map(function (p, j) { return (j ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ') + '"/>'; });
    pts.forEach(function (p) { if (p) svg += '<circle class="C_occ' + (p.i === sel ? ' C_on' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (p.i === sel ? 4 : 3) + '"/>'; });
    var summary = n + (n === 1 ? " month" : " months") + (bestI >= 0 ? '. Highest: ' + (months[bestI].title || months[bestI].label) + ', ' + fmt(best) : '. No figures yet') + '. A short line marks the same month last year; dots show occupancy.';
    return '<figure class="C_fig"><div class="C_plot">' + (hasMax ? '<span class="C_max" aria-hidden="true">' + esc(fmt(mx)) + '</span>' : '') + '<svg class="C_bars" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(summary) + '" focusable="false">' + svg + '</svg>' +
      '<div class="C_hits" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' + hits + '</div></div><div class="C_labs" aria-hidden="true">' + labs + '</div>' +
      '<p class="C_cap" role="status" aria-live="polite">' + esc(caps[sel]) + '</p>' +
      '<figcaption class="C_key"><span class="C_k">Revenue</span><span class="C_k C_kly">Same month last year</span><span class="C_k C_kocc">Occupancy (0-100%)</span></figcaption>' +
      '<table class="C_sr"><caption>Monthly figures</caption><thead><tr><th scope="col">Month</th><th scope="col">This year</th><th scope="col">Last year</th><th scope="col">Occupancy</th></tr></thead><tbody>' + rows + '</tbody></table></figure>';
  }

  // paceCard({nextMonths:[{label, booked, bookedLastYear, capacity}]}) -> nights on the books; marker = same point last year.
  function paceCard(o) {
    var ms = (o && o.nextMonths) || [], head = '<section class="C_pace"><h3 class="C_title">On the books</h3>';
    if (!ms.length) return head + '<p class="C_empty">No upcoming months yet.</p></section>';
    var rows = ms.map(function (m) {
      var b = num(m.booked), ly = num(m.bookedLastYear), cap = num(m.capacity) > 0 ? num(m.capacity) : null;
      var pct = function (v) { return v === null || cap === null ? null : Math.min(100, Math.max(0, v / cap * 100)); };
      var pb = pct(b), pl = pct(ly), diff = b !== null && ly !== null ? b - ly : null;
      var txt = (b === null ? 'No data' : b + (cap ? ' of ' + cap : '') + ' nights') + (diff === null ? '' : ', ' + (diff === 0 ? 'level with last year' : Math.abs(diff) + (diff > 0 ? ' ahead of' : ' behind') + ' last year'));
      var cls = diff === null || diff === 0 ? 'C_flat' : diff > 0 ? 'C_good' : 'C_bad';
      return '<li class="C_prow"><span class="C_pl">' + esc(m.label) + '</span>' +
        '<span class="C_track" role="img" aria-label="' + esc(m.label + ': ' + txt) + '"><span class="C_fill" style="width:' + (pb === null ? '0' : pb.toFixed(1)) + '%"></span>' + (pl === null ? '' : '<span class="C_mark" style="left:' + pl.toFixed(1) + '%"></span>') + '</span>' +
        '<span class="C_pv ' + cls + '">' + esc(b === null ? '—' : b + (diff === null || diff === 0 ? '' : ' (' + (diff > 0 ? '+' : '−') + Math.abs(diff) + ')')) + '</span></li>';
    }).join('');
    return head + '<ul class="C_plist">' + rows + '</ul><p class="C_note">Nights booked. The line marks the same point last year.</p></section>';
  }

  var api = { kpiTile: kpiTile, monthBars: monthBars, paceCard: paceCard, sparkline: spark, formatPHP: formatPHP, formatDelta: formatDelta, formatPoints: formatPoints, formatPercent: formatPercent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.N_CHARTS = api;
})();
