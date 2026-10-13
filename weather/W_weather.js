/* Cascade Staff - the full weather screen (s82 lane W). Plain script, no build step, no chart library, no canvas.
   Mounted by the shell: W_Weather.mount(el, { client, demo, role, sub, navigate, toast, haptic }) and W_Weather.unmount().
   Data: the weather-proxy Edge Function through client.functions.invoke. The last good answer is kept in localStorage 'cs_w_wx'.
   Every top-level name carries the W_ prefix. Not built here: tides, typhoon tracking, phone-location mode. */
(function (root) {
  'use strict';

  var W_KEY = 'cs_w_wx';
  var W_FRESH_MS = 15 * 60000;          // refetch on return to the screen after this long
  var W_OLD_MS = 3 * 3600000;           // older than this shows "offline copy"
  var W_GUST_KPH = 62, W_RAIN_PCT = 70, W_HOURS_SHOWN = 24, W_LOOKAHEAD = 6;
  var W_LAT = 6.12, W_LNG = 125.17;     // the house to two decimals (the server asks for 6.1164, 125.1716); no pin is sent to Windy
  var W_TIMEOUT_MS = 15000;             // a call that has not answered by then counts as failed
  var W_PARTS = ['hero', 'alerts', 'hours', 'days', 'sun', 'map', 'src'];
  var W_HOUSE = { out: 12 * 60, inn: 14 * 60 }; // fallback turnover window, noon to 2:00 pm; the shell may pass opts.houseTimes
  var W_LAYERS = [['rain', 'Rain'], ['wind', 'Wind'], ['temp', 'Temp']];
  var W_SOURCES = { pirate_weather: 'PirateWeather', google_weather: 'Google Weather', open_meteo: 'Open-Meteo', google: 'Google Weather', demo: 'Sample data' };
  var W_COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  var W_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---------- small pure helpers ----------
  function W_esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function W_num(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function W_round(v) { var n = W_num(v); return n == null ? null : Math.round(n); }
  function W_pad(n) { return (n < 10 ? '0' : '') + n; }
  function W_manila(ms) { var d = new Date(ms + 8 * 3600000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() }; }
  function W_clock(ms) { var p = W_manila(ms); return W_pad(p.h) + ':' + W_pad(p.mi); }
  function W_hourWord(ms) { var h = W_manila(ms).h; return ((h % 12) || 12) + (h < 12 ? ' am' : ' pm'); }
  function W_isDayHour(ms) { var h = W_manila(ms).h; return h >= 6 && h < 18; }
  function W_compass(deg) { var n = W_num(deg); return n == null ? '' : W_COMPASS[Math.round((((n % 360) + 360) % 360) / 22.5) % 16]; }

  /** Thresholds, one place. */
  function W_aqiWord(aqi) {
    var n = W_num(aqi); if (n == null) return null;
    if (n <= 50) return 'Good'; if (n <= 100) return 'Moderate'; if (n <= 150) return 'Poor for sensitive people';
    if (n <= 200) return 'Poor'; if (n <= 300) return 'Very poor'; return 'Hazardous';
  }
  function W_uvWord(uv) {
    var n = W_num(uv); if (n == null) return null;
    if (n <= 2) return 'Low'; if (n <= 5) return 'Moderate'; if (n <= 7) return 'High'; if (n <= 10) return 'Very high'; return 'Extreme';
  }
  /** A condition sentence to a WMO code, same reading as the server (used only when a payload carries no code). */
  function W_textToCode(desc) {
    var d = String(desc == null ? '' : desc).toLowerCase(); if (!d) return null;
    if (d.indexOf('thunder') >= 0 || d.indexOf('storm') >= 0) return 95;
    if (d.indexOf('drizzle') >= 0) return 51;
    if (d.indexOf('heavy rain') >= 0) return 65;
    if (d.indexOf('shower') >= 0) return 80;
    if (d.indexOf('rain') >= 0) return 63;
    if (d.indexOf('fog') >= 0 || d.indexOf('mist') >= 0) return 45;
    if (d.indexOf('mostly cloudy') >= 0 || d.indexOf('overcast') >= 0) return 3;
    if (d.indexOf('partly cloudy') >= 0) return 2;
    if (d.indexOf('mainly clear') >= 0 || d.indexOf('mostly clear') >= 0) return 1;
    if (d.indexOf('cloudy') >= 0) return 3;
    if (d.indexOf('clear') >= 0 || d.indexOf('sunny') >= 0) return 0;
    return null;
  }
  /** WMO code to a scene group. Wind turns clear or partly cloudy into 'windy'. */
  function W_group(code, wind, gust) {
    var c = W_num(code), g = 'neutral';
    if (c != null) {
      if (c === 0 || c === 1) g = 'clear'; else if (c === 2) g = 'partly'; else if (c === 3) g = 'overcast';
      else if (c >= 95) g = 'storm'; else if (c === 45 || c === 48) g = 'fog';
      else if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) g = 'rain'; else g = 'overcast';
    }
    if ((g === 'clear' || g === 'partly') && ((W_num(gust) || 0) >= 45 || (W_num(wind) || 0) >= 30)) g = 'windy';
    return g;
  }
  function W_groupWord(g) { return { clear: 'Clear', partly: 'Partly cloudy', overcast: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog', windy: 'Windy', neutral: 'Cloudy' }[g] || 'Cloudy'; }

  /** "5:47 AM" to minutes after midnight; null when unreadable. */
  function W_minutesOf(text) {
    var m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i.exec(String(text == null ? '' : text)); if (!m || (m[2] == null && !m[3])) return null;
    var h = +m[1], mi = m[2] == null ? 0 : +m[2]; if (m[3]) { h = h % 12; if (m[3].toLowerCase() === 'pm') h += 12; }
    return h * 60 + mi;
  }
  function W_hhmm(text) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  /** The house turnover window, as minutes after midnight (Manila). opts.houseTimes = { check_out:'12:00', check_in:'14:00' } when the shell has it. */
  function W_window(houseTimes) {
    var a = houseTimes && W_hhmm(houseTimes.check_out), b = houseTimes && W_hhmm(houseTimes.check_in);
    return a != null && b != null && b > a ? { out: a, inn: b } : W_HOUSE;
  }
  function W_inTurnover(nowMs, houseTimes) { var p = W_manila(nowMs), t = p.h * 60 + p.mi, w = W_window(houseTimes); return t >= w.out && t < w.inn; }

  // ---------- parse: any payload (new, or the old 12-hour / 5-day one) to one screen model; null when there is nothing to show ----------
  function W_parse(raw, nowMs, cacheAt) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { return null; } }
    var c = raw && raw.current; if (!c || typeof c !== 'object' || W_num(c.temp) == null) return null;
    var m = { raw: raw, temp: W_round(c.temp), feels: W_round(c.feels_like), desc: c.description ? String(c.description) : '', humidity: W_round(c.humidity),
      wind: W_round(c.wind_kph), gust: W_round(c.wind_gust_kph), windDir: W_num(c.wind_dir), uv: W_round(c.uv_index), uvLabel: c.uv_label ? String(c.uv_label) : null,
      pressure: W_round(c.pressure_mb), visibility: W_num(c.visibility), aqi: W_round(raw.aqi), hi: W_round(c.today_high), lo: W_round(c.today_low),
      sunrise: c.sunrise ? String(c.sunrise) : null, sunset: c.sunset ? String(c.sunset) : null, rainNow: W_round(c.rain_prob),
      source: raw.source ? String(raw.source) : null, hourlySource: raw.hourly_source ? String(raw.hourly_source) : null };
    m.code = W_num(c.code); if (m.code == null) m.code = W_num(raw.code); if (m.code == null) m.code = W_textToCode(m.desc);
    var fetched = Date.parse(raw.fetched_at || ''); m.fetchedMs = isFinite(fetched) ? fetched : (W_num(cacheAt) || nowMs);
    m.ageMs = Math.max(0, nowMs - m.fetchedMs); m.offlineCopy = m.ageMs > W_OLD_MS;
    // day or night: the server's flag, else sunrise / sunset, else 06:00 to 18:00
    if (typeof c.is_day === 'boolean') m.isDay = c.is_day;
    else { var rise = W_minutesOf(m.sunrise), set = W_minutesOf(m.sunset), p = W_manila(nowMs), t = p.h * 60 + p.mi; m.isDay = rise != null && set != null ? t >= rise && t < set : p.h >= 6 && p.h < 18; }
    // hours still ahead, soonest first, at most 24
    var hrs = [], rows = Array.isArray(raw.hourly) ? raw.hourly : [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], ms = Date.parse(r && r.time); if (!isFinite(ms) || ms + 3600000 <= nowMs) continue;
      hrs.push({ ms: ms, pct: W_round(r.rain_chance_pct), temp: W_round(r.temp), code: W_num(r.code), mm: W_num(r.mm) });
    }
    hrs.sort(function (a, b) { return a.ms - b.ms; }); m.hours = hrs.slice(0, W_HOURS_SHOWN);
    m.nowMs = nowMs;
    var next = m.hours.slice(0, W_LOOKAHEAD), mx = null, thunderSoon = false;
    next.forEach(function (h) { if (h.pct != null && (mx == null || h.pct > mx)) mx = h.pct; if (h.code != null && h.code >= 95) thunderSoon = true; });
    m.rain6 = mx; m.thunderSoon = thunderSoon;
    // days
    var fc = Array.isArray(raw.forecast) ? raw.forecast : [], days = [], k, tp = W_manila(nowMs), todayMs = Date.parse(tp.y + '-' + W_pad(tp.mo) + '-' + W_pad(tp.d) + 'T00:00:00+08:00');
    for (k = 0; k < fc.length; k++) {
      var d = fc[k]; if (!d || W_num(d.high) == null || W_num(d.low) == null) continue;
      var dayMs = Date.parse(String(d.date || '') + 'T00:00:00+08:00');
      var diff = isFinite(dayMs) ? Math.round((dayMs - todayMs) / 86400000) : null;
      if (diff != null && diff < 0) continue; // a day that is over
      var label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff != null ? W_DOW[W_manila(dayMs).dow] : (d.label ? String(d.label) : '');
      days.push({ label: label, high: W_round(d.high), low: W_round(d.low), code: W_num(d.code) != null ? W_num(d.code) : W_textToCode(d.description), desc: d.description ? String(d.description) : '',
        rain: W_round(d.rain_prob), fh: W_round(d.feels_like_high), fl: W_round(d.feels_like_low), wind: W_round(d.wind_kph), gust: W_round(d.wind_gust_kph),
        uv: W_round(d.uv_index), uvLabel: d.uv_label ? String(d.uv_label) : null, sunrise: d.sunrise ? String(d.sunrise) : null, sunset: d.sunset ? String(d.sunset) : null });
    }
    m.days = days.slice(0, 7);
    var rw = raw.rain_watch; m.rainWatch = rw && isFinite(Date.parse(rw.from)) && isFinite(Date.parse(rw.to)) && Date.parse(rw.to) > nowMs ? { from: Date.parse(rw.from), to: Date.parse(rw.to), peak: W_round(rw.peak_pct) } : null;
    return m;
  }

  /** The alert lines: thunder, strong gusts, rain likely. Each has a kind, a glyph name and plain words. Calm voice, never colour alone. */
  function W_alerts(m, houseTimes) {
    var out = [];
    if (!m) return out;
    var live = !m.offlineCopy; // an old copy cannot say what the sky is doing now: only the hours still ahead count
    if (live && m.code != null && m.code >= 95) out.push({ kind: 'thunder', glyph: 'zap', text: 'Thunderstorms are nearby. It is safest to stay indoors and keep appliances unplugged.' });
    else if (m.thunderSoon) out.push({ kind: 'thunder', glyph: 'zap', text: 'Thunderstorms are possible in the next few hours. It is wise to stay close to shelter.' });
    if (live && m.gust != null && m.gust >= W_GUST_KPH) out.push({ kind: 'gust', glyph: 'alert', text: 'Strong gusts of ' + m.gust + ' km/h. Loose items outside are best secured.' });
    if (m.rain6 != null && m.rain6 >= W_RAIN_PCT) out.push({ kind: 'rain', glyph: 'rain', text: 'Rain is likely in the next 6 hours (' + m.rain6 + '%).' });
    var rainy = out.some(function (a) { return a.kind === 'rain' || a.kind === 'thunder'; }) || !!m.rainWatch;
    if (rainy && W_inTurnover(m.nowMs, houseTimes)) out.push({ kind: 'turnover', glyph: 'house', text: 'Close the windows and bring in the laundry before the rain.' });
    return out;
  }

  // ---------- the built-in sample (demo mode only): relative to the clock it is given, so it never looks old ----------
  function W_sample(nowMs) {
    var base = Math.floor(nowMs / 3600000) * 3600000, hours = [], i;
    for (i = 0; i < 30; i++) {
      var ms = base + i * 3600000, h = W_manila(ms).h, wet = i >= 5 && i <= 7;
      hours.push({ time: new Date(ms).toISOString(), rain_chance_pct: wet ? 70 + (i - 5) * 5 : (i % 5 === 0 ? 25 : 10), mm: wet ? 1.8 : 0, code: wet ? 63 : (h >= 6 && h < 18 ? 2 : 1), temp: Math.round(28 + 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI)) });
    }
    var fc = [], codes = [2, 63, 3, 61, 2, 0, 80], hi = [32, 30, 31, 29, 32, 33, 31], lo = [25, 25, 25, 24, 25, 25, 24];
    for (i = 0; i < 7; i++) {
      var dm = nowMs + i * 86400000, p = W_manila(dm);
      fc.push({ date: p.y + '-' + W_pad(p.mo) + '-' + W_pad(p.d), label: i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : W_DOW[p.dow]), high: hi[i], low: lo[i], code: codes[i], description: W_groupWord(W_group(codes[i], 0, 0)),
        feels_like_high: hi[i] + 4, feels_like_low: lo[i] + 1, rain_prob: [40, 80, 30, 65, 20, 5, 55][i], wind_kph: 14 + i, wind_gust_kph: 28 + i, uv_index: [7, 5, 6, 4, 8, 9, 6][i], uv_label: W_uvWord([7, 5, 6, 4, 8, 9, 6][i]), sunrise: '5:47 AM', sunset: '5:51 PM' });
    }
    var rows = hours.slice(0, 24), wetRows = rows.filter(function (r) { return r.rain_chance_pct >= W_RAIN_PCT; });
    return { source: 'demo', hourly_source: 'demo', fetched_at: new Date(nowMs).toISOString(), code: 2, aqi: 42, location: 'General Santos City, PH',
      current: { temp: 29, feels_like: 34, description: 'Partly cloudy', code: 2, is_day: W_isDayHour(nowMs), humidity: 78, wind_kph: 14, wind_gust_kph: 28, wind_dir: 70, uv_index: 7, uv_label: 'High', pressure_mb: 1009, visibility: 9.5,
        sunrise: '5:47 AM', sunset: '5:51 PM', today_high: 32, today_low: 25, rain_prob: 40 },
      hourly: hours, forecast: fc,
      rain_watch: wetRows.length ? { from: wetRows[0].time, to: new Date(Date.parse(wetRows[wetRows.length - 1].time) + 3600000).toISOString(), peak_pct: Math.max.apply(null, wetRows.map(function (r) { return r.rain_chance_pct; })) } : null };
  }

  // ---------- drawing ----------
  var W_CLOUD = 'M9 24.5a5.5 5.5 0 0 1-.4-11 7.5 7.5 0 0 1 14.6 1.6 4.7 4.7 0 0 1-.7 9.4z';
  function W_cloud(dx, dy, cls) { return '<path class="W_cloud ' + (cls || '') + '" transform="translate(' + dx + ' ' + dy + ')" d="' + W_CLOUD + '"/>'; }
  /** The picture for a group, on a 32 x 32 grid. Colours come from the W_ classes (tokens only). */
  function W_art(g, night) {
    var sun = '<circle class="W_sun" cx="16" cy="16" r="6"/><path class="W_ray" d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M25.2 6.8l-2.1 2.1M8.9 23.1l-2.1 2.1"/>';
    var moon = '<path class="W_moon" d="M21 4a12 12 0 1 0 8 20 10 10 0 0 1-8-20z"/>';
    var stars = '<circle class="W_star" cx="6" cy="7" r="1"/><circle class="W_star" cx="12" cy="3" r="1"/><circle class="W_star" cx="27" cy="12" r="1"/>';
    switch (g) {
      case 'clear': return night ? moon + stars : sun;
      case 'partly': return (night ? '<path class="W_moon" d="M14 3a7 7 0 1 0 6 11 6 6 0 0 1-6-11z"/>' : '<circle class="W_sun" cx="12" cy="11" r="5"/><path class="W_ray" d="M12 2v2M3 11h2M5.6 4.6l1.4 1.4M18.4 4.6L17 6"/>') + W_cloud(2, 3);
      case 'rain': return W_cloud(0, -4) + '<path class="W_drop" d="M11 24l-1.5 4M17 24l-1.5 4M23 24l-1.5 4"/>';
      case 'storm': return W_cloud(0, -5, 'W_dark') + '<path class="W_bolt" d="M17 17l-6 8h5l-2 6 8-10h-5z"/>';
      case 'fog': return W_cloud(0, -5) + '<path class="W_fogline" d="M5 23h22M9 28h14"/>';
      case 'windy': return (night ? moon : sun) + '<path class="W_gust" d="M3 22h16a3 3 0 1 1-3 3M3 27h9"/>';
      default: return W_cloud(6, -4, 'W_far') + W_cloud(0, 1);
    }
  }
  function W_svg(g, night, cls, label) { return '<svg class="W_ico ' + (cls || '') + '" viewBox="0 0 32 32" ' + (label ? 'role="img" aria-label="' + W_esc(label) + '"' : 'aria-hidden="true"') + ' focusable="false">' + W_art(g, night) + '</svg>'; }
  function W_glyph(name) { return typeof root.ICON === 'function' ? root.ICON(name, 's16') : ''; }

  function W_section(title, inner, id) { return '<section class="W_sec" aria-labelledby="' + id + '"><h2 class="A_label" id="' + id + '">' + W_esc(title) + '</h2>' + inner + '</section>'; }

  function W_hero(m, S) {
    var g = W_group(m.code, m.wind, m.gust), tone = m.isDay ? 'day' : 'night';
    var asOf = 'as of ' + W_clock(m.fetchedMs) + (m.offlineCopy ? ' · offline copy' : '');
    var cond = m.desc || W_groupWord(g);
    var chips = [];
    function chip(k, v, s) { chips.push('<div class="W_chip"><span class="W_k">' + W_esc(k) + '</span><span class="W_v">' + W_esc(v) + '</span>' + (s ? '<span class="W_s">' + W_esc(s) + '</span>' : '') + '</div>'); }
    if (m.feels != null) chip('Feels like', m.feels + '°');
    if (m.humidity != null) chip('Humidity', m.humidity + '%');
    if (m.wind != null) chip('Wind', m.wind + ' km/h', m.windDir != null ? 'from ' + W_compass(m.windDir) : '');
    if (m.gust != null) chip('Gusts', m.gust + ' km/h');
    if (m.rain6 != null) chip('Rain next 6 h', m.rain6 + '%', 'chance');
    if (m.uv != null) chip('UV today', String(m.uv), m.uvLabel || W_uvWord(m.uv));
    if (m.aqi != null) chip('Air quality', String(m.aqi), W_aqiWord(m.aqi));
    var hl = m.hi != null && m.lo != null ? '<span class="W_hl">High ' + m.hi + '° · Low ' + m.lo + '°</span>' : '';
    return '<section class="card glass W_hero" data-tone="' + tone + '" data-group="' + g + '" aria-label="Weather now">' +
      '<div class="W_scene" aria-hidden="true">' + W_svg(g, !m.isDay, 'W_big') + '</div>' +
      '<div class="W_head"><span class="W_place">General Santos</span><span class="W_asof">' + W_esc(asOf) + '</span></div>' +
      '<div class="W_main"><span class="W_temp">' + m.temp + '°</span><span class="W_cond">' + W_esc(cond) + '</span>' + hl + '</div>' +
      (S.failed ? '<p class="W_note">Could not refresh. Showing the saved forecast.</p>' : '') +
      (chips.length ? '<div class="W_chips">' + chips.join('') + '</div>' : '') + '</section>';
  }

  function W_alertBlock(m, houseTimes) {
    var list = W_alerts(m, houseTimes), html = list.map(function (a) {
      return '<div class="W_alert W_' + a.kind + '" role="status"><span class="W_ag" aria-hidden="true">' + W_glyph(a.glyph) + '</span><span>' + W_esc(a.text) + '</span></div>';
    }).join('');
    if (m.rainWatch) {
      var rw = m.rainWatch;
      html += '<div class="card glass W_watch"><span class="W_ag" aria-hidden="true">' + W_glyph('rain') + '</span><div><b>Rain watch</b><p>From ' + W_hourWord(rw.from) + ' to ' + W_hourWord(rw.to) + (rw.peak != null ? ', up to ' + rw.peak + '% chance.' : '.') + '</p></div></div>';
    }
    return html ? '<div class="W_alerts">' + html + '</div>' : '';
  }

  function W_hoursBlock(m) {
    if (!m.hours.length) return '';
    var items = m.hours.map(function (h, i) {
      var g = W_group(h.code != null ? h.code : m.code, 0, 0);
      return '<li class="W_h"><span class="W_ht">' + (i === 0 && h.ms <= m.nowMs ? 'Now' : W_hourWord(h.ms)) + '</span>' + W_svg(g, !W_isDayHour(h.ms), '', W_groupWord(g)) + (h.temp != null ? '<span class="W_hd">' + h.temp + '°</span>' : '') +
        '<span class="W_hr">' + (h.pct != null && h.pct >= 20 ? h.pct + '%' : '&nbsp;') + '</span></li>';
    }).join('');
    return W_section('Next 24 hours', '<div class="card glass W_stripcard"><ul class="W_strip" role="list" tabindex="0" aria-label="Next 24 hours, scroll sideways">' + items + '</ul></div>', 'W_t_hours');
  }

  function W_daysBlock(m, open) {
    if (!m.days.length) return '';
    var min = Math.min.apply(null, m.days.map(function (d) { return d.low; })), max = Math.max.apply(null, m.days.map(function (d) { return d.high; })), span = Math.max(1, max - min);
    var rows = m.days.map(function (d, i) {
      var g = W_group(d.code, 0, 0), on = !!open[i], more = [];
      if (d.fl != null && d.fh != null) more.push(['Feels like', d.fl + '° to ' + d.fh + '°']);
      if (d.wind != null) more.push(['Wind', d.wind + ' km/h']);
      if (d.gust != null) more.push(['Gusts', d.gust + ' km/h']);
      if (d.uv != null) more.push(['UV', d.uv + (d.uvLabel ? ' · ' + d.uvLabel : '')]);
      if (d.sunrise) more.push(['Sunrise', d.sunrise]);
      if (d.sunset) more.push(['Sunset', d.sunset]);
      var left = Math.round((d.low - min) / span * 100), wid = Math.max(6, Math.round((d.high - d.low) / span * 100));
      var main = '<span class="W_dn">' + W_esc(d.label) + '</span><span class="W_di">' + W_svg(g, false) + '<span class="W_dr">' + (d.rain != null ? d.rain + '%' : '&nbsp;') + '</span></span>' +
        '<span class="W_lo">' + d.low + '°</span><span class="W_bar" aria-hidden="true"><i style="left:' + left + '%;width:' + wid + '%"></i></span><span class="W_hi">' + d.high + '°</span>';
      var label = d.label + ', ' + W_groupWord(g) + ', low ' + d.low + ', high ' + d.high + (d.rain != null ? ', rain ' + d.rain + ' percent' : '');
      var btn = more.length ? '<button type="button" class="W_day" data-w-day="' + i + '" aria-expanded="' + on + '" aria-label="' + W_esc(label) + '">' + main + '</button>'
        : '<div class="W_day W_flat" role="group" aria-label="' + W_esc(label) + '">' + main + '</div>';
      var det = more.length ? '<dl class="W_more"' + (on ? '' : ' hidden') + '>' + more.map(function (r) { return '<div><dt>' + W_esc(r[0]) + '</dt><dd>' + W_esc(r[1]) + '</dd></div>'; }).join('') + '</dl>' : '';
      return '<li class="W_dli">' + btn + det + '</li>';
    }).join('');
    return W_section(m.days.length + ' days', '<div class="card glass W_dcard"><ul class="W_days" role="list">' + rows + '</ul></div>', 'W_t_days');
  }

  function W_sunBlock(m) {
    var rows = [];
    function row(k, v) { rows.push('<div><dt>' + W_esc(k) + '</dt><dd>' + W_esc(v) + '</dd></div>'); }
    if (m.sunrise) row('Sunrise', m.sunrise);
    if (m.sunset) row('Sunset', m.sunset);
    if (m.uv != null) row('UV index', m.uv + ' · ' + (m.uvLabel || W_uvWord(m.uv)));
    if (m.aqi != null) row('Air quality', m.aqi + ' · ' + W_aqiWord(m.aqi));
    if (m.pressure != null) row('Pressure', m.pressure + ' hPa');
    if (m.visibility != null) row('Visibility', m.visibility + ' km');
    return rows.length ? W_section('Sun and air', '<div class="card glass"><dl class="W_facts">' + rows.join('') + '</dl></div>', 'W_t_sun') : '';
  }

  function W_mapUrl(layer) {
    return 'https://embed.windy.com/embed2.html?lat=' + W_LAT + '&lon=' + W_LNG + '&zoom=8&level=surface&overlay=' + layer +
      '&product=ecmwf&menu=&message=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1';
  }
  function W_mapBlock(S) {
    var btns = W_LAYERS.map(function (l) { return '<button type="button" class="chip W_layer" data-w-layer="' + l[0] + '" aria-pressed="' + (S.layer === l[0]) + '">' + l[1] + '</button>'; }).join('');
    var body = S.mapOn
      ? '<iframe class="W_map" title="Live weather map (Windy), ' + W_esc(S.layer) + '" src="' + W_esc(W_mapUrl(S.layer)) + '" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin"></iframe>'
      : '<button type="button" class="btn btn-secondary W_load" data-w-map="1">Load the live map</button><p class="help W_data">The live map uses mobile data.</p>';
    return W_section('Live map', '<div class="card glass W_mapcard"><div class="W_layers" role="group" aria-label="Map layer">' + btns + '</div>' + body + '</div>', 'W_t_map');
  }

  function W_sourceBlock(m, S) {
    var src = W_SOURCES[m.source] || 'the weather service', parts = ['Forecast: ' + src];
    if (m.hourlySource && W_SOURCES[m.hourlySource] && W_SOURCES[m.hourlySource] !== src) parts.push('hourly: ' + W_SOURCES[m.hourlySource]);
    if (m.aqi != null && m.source !== 'demo') parts.push('air quality: Open-Meteo');
    return '<div class="W_src"><p class="help">' + W_esc(parts.join(' · ') + ' · as of ' + W_clock(m.fetchedMs) + (m.offlineCopy ? ' (offline copy)' : '')) + '</p>' +
      (S.demo ? '' : '<button type="button" class="btn btn-ghost" data-w-refresh="1"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Refreshing' : 'Refresh') + '</button>') + '</div>';
  }

  /** The screen in named parts. Each part is rewritten only when its markup changed, so the map, the focus and the announced alerts stay put. */
  function W_parts(S) {
    var m = S.model, o = {}, n; for (n = 0; n < W_PARTS.length; n++) o[W_PARTS[n]] = '';
    if (!m) {
      o.hero = S.busy && !S.failed ? '<div class="card glass W_empty" role="status"><p class="sub">Loading the forecast.</p></div>'
        : '<div class="card glass W_empty" role="status"><p class="W_big2">No connection</p><p class="sub">The forecast could not be loaded.</p><button type="button" class="btn btn-primary" data-w-retry="1">Try again</button></div>';
      return o;
    }
    o.hero = W_hero(m, S); o.alerts = W_alertBlock(m, S.houseTimes); o.hours = W_hoursBlock(m); o.days = W_daysBlock(m, S.open); o.sun = W_sunBlock(m); o.map = W_mapBlock(S); o.src = W_sourceBlock(m, S);
    return o;
  }
  function W_page(S) { var o = W_parts(S); return '<div class="W_wrap">' + W_PARTS.map(function (k) { return '<div class="W_part" data-w-part="' + k + '">' + o[k] + '</div>'; }).join('') + '</div>'; }

  // ---------- the screen ----------
  var W_S = null;
  function W_nowMs() { return Date.now(); }
  function W_store(fn) { try { return fn(root.localStorage); } catch (e) { return null; } }

  function W_render() {
    var S = W_S; if (!S || S.dead) return;
    S.model = S.raw ? W_parse(S.raw, W_nowMs(), S.cacheAt) : null;
    if (!S.built) { S.el.innerHTML = '<div class="W_wrap">' + W_PARTS.map(function (k) { return '<div class="W_part" data-w-part="' + k + '"></div>'; }).join('') + '</div>'; S.built = true; S.parts = {}; S.last = {}; }
    var o = W_parts(S);
    W_PARTS.forEach(function (k) {
      if (S.last[k] === o[k]) return;
      var node = S.parts[k] || (S.parts[k] = S.el.querySelector('[data-w-part="' + k + '"]')); if (!node) return;
      var strip = k === 'hours' && node.querySelector ? node.querySelector('.W_strip') : null, left = strip ? strip.scrollLeft : 0;
      node.innerHTML = o[k]; S.last[k] = o[k];
      if (left && node.querySelector) { var s2 = node.querySelector('.W_strip'); if (s2) s2.scrollLeft = left; }
    });
    if (S.focusSel) { var f = S.el.querySelector(S.focusSel); if (f && !f.disabled) { f.focus(); S.focusSel = null; } } // the tapped control was rewritten: give focus back
  }

  function W_load() {
    var S = W_S; if (!S || S.demo) return;
    if (!S.client || !S.client.functions || typeof S.client.functions.invoke !== 'function') { S.failed = true; W_render(); return; }
    if (S.busy) return;
    S.busy = true; W_render();
    var tok = S.req = (S.req || 0) + 1, timer = null;
    var done = function (ok, data) {
      if (W_S !== S || S.dead || S.req !== tok) return;
      S.req = tok + 1; if (timer) clearTimeout(timer);
      S.busy = false; S.lastTry = W_nowMs();
      if (ok && W_parse(data, W_nowMs())) {
        S.raw = typeof data === 'string' ? JSON.parse(data) : data; S.cacheAt = W_nowMs(); S.failed = false; S.lastOk = S.cacheAt;
        W_store(function (ls) { ls.setItem(W_KEY, JSON.stringify({ at: S.cacheAt, j: S.raw })); });
      } else S.failed = true;
      W_render();
      if (S.failed && S.raw && S.manual && S.toast) S.toast('Could not refresh. Showing the saved forecast.');
      S.manual = false;
    };
    var p; try { p = Promise.resolve(S.client.functions.invoke('weather-proxy')); } catch (e) { p = Promise.reject(e); }
    timer = S.timer = setTimeout(function () { done(false); }, S.timeoutMs);
    p.then(function (r) { done(!!(r && !r.error && r.data), r && r.data); }, function () { done(false); });
  }

  function W_click(ev) {
    var S = W_S; if (!S || S.dead || !ev || !ev.target || !ev.target.closest) return;
    var t = ev.target.closest('[data-w-day],[data-w-layer],[data-w-map],[data-w-retry],[data-w-refresh]'); if (!t) return;
    var v;
    if ((v = t.getAttribute('data-w-day')) != null) {
      var on = S.open[+v] = !S.open[+v], more = t.nextElementSibling;
      if (t.setAttribute && more) { t.setAttribute('aria-expanded', String(on)); more.hidden = !on; S.last.days = W_daysBlock(S.model, S.open); } // in place: focus and scroll stay
      else W_render();
    }
    else if ((v = t.getAttribute('data-w-layer')) != null) { S.layer = v; S.focusSel = '[data-w-layer="' + v + '"]'; W_render(); }
    else if (t.getAttribute('data-w-map') != null) { S.mapOn = true; W_render(); }
    else if (t.getAttribute('data-w-retry') != null) { S.failed = false; W_load(); }
    else if (t.getAttribute('data-w-refresh') != null) { S.manual = true; S.focusSel = '[data-w-refresh="1"]'; W_load(); }
  }

  function W_visible() {
    var S = W_S; if (!S || S.dead || S.demo || (root.document && root.document.hidden)) return;
    if (!S.lastOk || W_nowMs() - S.lastOk >= W_FRESH_MS) W_load();
    else W_render(); // the clock moves: "as of", the hours still ahead
  }

  function mount(el, opts) {
    opts = opts || {}; unmount();
    var S = W_S = { el: el, client: opts.client || null, demo: !!opts.demo, toast: opts.toast || null, houseTimes: opts.houseTimes || null, timeoutMs: opts.timeoutMs > 0 ? opts.timeoutMs : W_TIMEOUT_MS, raw: null, cacheAt: null, failed: false, busy: false,
      open: {}, layer: 'rain', mapOn: false, dead: false, lastOk: 0, model: null, manual: false };
    S.clickFn = W_click; el.addEventListener('click', S.clickFn);
    if (root.document && root.document.addEventListener) { S.visFn = W_visible; root.document.addEventListener('visibilitychange', S.visFn); }
    if (S.demo) { S.raw = W_sample(W_nowMs()); S.cacheAt = W_nowMs(); W_render(); return; } // the sample only: no network, no storage
    var c = W_store(function (ls) { return JSON.parse(ls.getItem(W_KEY) || 'null'); });
    if (c && c.j && W_parse(c.j, W_nowMs(), c.at)) { S.raw = c.j; S.cacheAt = W_num(c.at); }
    W_render(); W_load();
  }
  function unmount() {
    var S = W_S; if (!S) return;
    S.dead = true; if (S.timer) clearTimeout(S.timer); try { S.el.removeEventListener('click', S.clickFn); } catch (e) { /* element already gone */ }
    if (S.visFn && root.document && root.document.removeEventListener) root.document.removeEventListener('visibilitychange', S.visFn);
    W_S = null;
  }

  var api = { mount: mount, unmount: unmount, lib: { parse: W_parse, alerts: W_alerts, sample: W_sample, group: W_group, aqiWord: W_aqiWord, uvWord: W_uvWord, textToCode: W_textToCode,
    compass: W_compass, inTurnover: W_inTurnover, mapUrl: W_mapUrl, page: W_page, KEY: W_KEY, GUST: W_GUST_KPH, RAIN: W_RAIN_PCT } };
  root.W_Weather = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
