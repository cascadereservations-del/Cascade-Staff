/* Cascade Staff - demo mode (s80). Open any page with ?demo (and &role=owner|admin|cleaner|signin) and the app runs on the synthetic data below:
   no Supabase client is ever created, nothing goes over the network, nothing is written to storage, every write says "Demo: nothing was saved".
   For design review: a reviewer who cannot sign in with a PIN can still see every layout.
   ONE guard: CSDemo.active (true only when the address has ?demo). Without it this file does nothing; every call site tests that one flag.
   Pure functions (fixtures, the fake client) work in Node too, so tests/demo.test.mjs can run them. Loaded after lib.js. */
(function (root, factory) {
  var api = factory(root, typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.CS);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CSDemo = api;
})(typeof self !== 'undefined' ? self : this, function (root, CS) {
  'use strict';
  var ROLES = ['owner', 'admin', 'finance', 'cleaner', 'laundry'], VIEWS = ['owner', 'admin', 'finance', 'cleaner', 'laundry', 'signin'], BAR = ['owner', 'admin', 'cleaner', 'laundry', 'signin']; // s127: finance opens by address (?demo&role=finance); the bar keeps its five buttons
  var NOTE = 'Demo: nothing was saved';

  // ---- the one guard -----------------------------------------------------------------------------------------------------
  function isDemo(search) {
    var m = /[?&]demo(?:=([^&]*))?(?:&|$)/.exec(String(search || '')); return !!m && !/^(0|false|no|off)$/i.test(m[1] || ''); // identical to isDemo in theme.js
  }
  function roleFrom(search) {
    try { var r = new URLSearchParams(String(search || '')).get('role'); return VIEWS.indexOf(r) >= 0 ? r : 'owner'; } catch (e) { return 'owner'; }
  }
  // ?demo&empty = no guest in the house tonight (the next guest stays); ?demo&empty=none = no next guest either. Without ?demo it is always '' (s126).
  function emptyFrom(search) {
    try { if (!isDemo(search)) return ''; var v = new URLSearchParams(String(search || '')).get('empty'); return v == null ? '' : v === 'none' ? 'none' : 'next'; } catch (e) { return ''; }
  }
  var active = isDemo(root.location && root.location.search);

  // ---- links: keep ?demo&role= on every in-app link so a click never leaves demo mode ---------------------------------------
  // null = leave the link alone (an anchor on the page, another site, a tg: or mailto: link, or already a demo link).
  function demoHref(href, role, keep) {
    href = String(href == null ? '' : href);
    if (!href || href.charAt(0) === '#' || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
    var h = href.indexOf('#'), hash = h >= 0 ? href.slice(h) : '', rest = h >= 0 ? href.slice(0, h) : href;
    if (/[?&]demo(=|&|$)/.test(rest)) return null;
    return rest + (rest.indexOf('?') >= 0 ? '&' : '?') + 'demo&role=' + role + (keep || '') + hash;
  }
  // Where the role switcher goes: the same screen on the app root, else the app home.
  function switchUrl(loc, role, rootPath) {
    var onRoot = loc.pathname === rootPath || loc.pathname === rootPath + 'index.html';
    return rootPath + '?demo&role=' + role + (onRoot ? loc.hash || '' : '#home');
  }
  var LABEL = { owner: 'Owner', admin: 'Admin', finance: 'Finance', cleaner: 'Cleaner', laundry: 'Laundry', signin: 'Sign in' };
  function barHtml(role) {
    return '<span class="pill p-brand demo-pill">Demo data</span><div class="demo-roles" role="group" aria-label="View as">' +
      BAR.map(function (v) { return '<button type="button" data-demo-role="' + v + '" aria-pressed="' + (v === role) + '">' + LABEL[v] + '</button>'; }).join('') + '</div>';
  }

  // ---- a calm "nothing was saved" note: the same element the app uses for Copied (id cs-toast) -------------------------------
  var timer = 0, hook = null; // hook: tests listen for the note
  function toast(msg) {
    if (hook) hook(msg || NOTE);
    var doc = root.document; if (!doc) return;
    var t = doc.getElementById('cs-toast');
    if (t && t.classList && t.classList.contains('E_hasact')) return; // an Undo toast keeps its words and its full time; the app adds the demo note itself
    if (!t) { t = doc.createElement('div'); t.id = 'cs-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); doc.body.appendChild(t); }
    t.textContent = msg || NOTE; t.classList.add('on');
    clearTimeout(timer); timer = setTimeout(function () { t.classList.remove('on'); t.textContent = ''; }, 2500);
  }

  // ---- a placeholder ID card, drawn inline (never a real document) ----------------------------------------------------------
  function idPlaceholder() {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" rx="14" fill="#E9E1D2"/><text x="18" y="34" font-family="sans-serif" font-size="14" font-weight="700" fill="#6B5D48">DEMO ID - NOT A REAL DOCUMENT</text>' +
      '<rect x="18" y="52" width="86" height="108" rx="8" fill="#CFC3AD"/><circle cx="61" cy="94" r="21" fill="#B5A68B"/><path d="M26 160c4-32 70-32 70 0z" fill="#B5A68B"/>' +
      '<rect x="124" y="60" width="170" height="12" rx="6" fill="#CFC3AD"/><rect x="124" y="86" width="130" height="12" rx="6" fill="#CFC3AD"/><rect x="124" y="112" width="150" height="12" rx="6" fill="#CFC3AD"/><rect x="124" y="138" width="90" height="12" rx="6" fill="#CFC3AD"/></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // ---- fixtures: every date is relative to today (Manila), every name and number is made up ------------------------------------
  function build(role, now, empty) {
    var r = role === 'cleaner' || role === 'admin' || role === 'laundry' || role === 'finance' ? role : 'owner', admin = r !== 'cleaner' && r !== 'laundry', today = CS.manilaToday(now), stamp = (now instanceof Date ? now : new Date()).toISOString();
    var d = function (n) { return CS.addDays(today, n); }, at = function (n, hm) { return d(n) + 'T' + hm + ':00+08:00'; };
    var guest = function (o) { // the server sends a cleaner no phone, e-mail or Messenger link; companions go to every staff role (s129, D-390)
      if (!admin) { delete o.phone; delete o.email; delete o.messenger; }
      return o;
    };
    var g1 = guest({ uid: 'demo-stay-1', guest_name: 'Demo Guest One', checkin_date: d(-1), checkout_date: d(2), checkin_time: '14:00:00', checkout_time: '12:00:00', nights: 3, source: 'airbnb',
      repeat: true, stay_count: 2, earlier_stays: [{ month: d(-120).slice(0, 7), nights: 2 }], notes: noteSeed(today).g1,
      tier: 'returning', id_photo_path: 'demo/id-1', id_photo_name: 'Demo Companion One', companions: [{ name: 'Demo Companion One', has_photo: true }, { name: 'Demo Companion Two', has_photo: false }],
      phone: '0900-000-0000', email: 'demo.guest.one@example.invalid', messenger: {} });
    var g2 = guest({ uid: 'demo-stay-2', guest_name: 'Demo Guest Two', checkin_date: d(2), checkout_date: d(5), checkin_time: '14:00:00', checkout_time: '12:00:00', nights: 3, source: 'direct',
      repeat: true, tier: 'vip', stay_count: 8, earlier_stays: [], notes: noteSeed(today).g2 + ' || ' + d(-9) + ': Turnover report: Faucet is leaking in the CR', id_photo_path: null, companions: [{ name: 'Demo Companion Three', has_photo: false }], phone: '0900-000-0001', email: 'demo.guest.two@example.invalid' });
    g1.staying = { names: 'Demo Guest One, Demo Companion One', source: 'staff', suggestion: null, version: 1, guest_count: null, booked_guests: 2 }; // s119: sample staying data (names typed by staff; the next stay has only a Cassy suggestion)
    g2.staying = { names: '', source: null, suggestion: 'Demo Guest Two, Demo Companion Three', version: 0, guest_count: 2, booked_guests: 3 };
    if (admin) { g1.guest_id = '00000000-0000-4000-8000-0000000000d1'; g2.guest_id = '00000000-0000-4000-8000-0000000000d2'; } // s120: the Guests tile links to the guest page (the demo guest page knows these two ids)
    if (admin) { g1.arrival_ready = { id: true, paid: true, door_code: true }; g2.arrival_ready = { id: false, paid: false, door_code: true }; }
    var row = function (name, a, b, src) { return { guest_name: name, checkin_date: d(a), checkout_date: d(b), status: 'confirmed', source: src }; };
    var block = function (a, b, why, label) { return { guest_name: null, checkin_date: d(a), checkout_date: d(b), status: 'blocked', source: 'manual', block_reason: why, block_label: label }; };
    var home = {
      today: today, generated_at: stamp,
      weather: { fetched_at: stamp, current: { temp: 29, emoji: '', description: 'Partly cloudy', rain_prob: 40, today_high: 32, today_low: 26, humidity: 70, uv_label: 'High', feels_like: 39, code: 2, wind_gust_kph: 36, uv_index: 9 }, aqi: 112,
        hourly: (function () { // s110: sample hours for the Today strip and warnings (feels-like 39 is a caution only, UV 9 and air quality 112 raise the haze row)
          var t0 = Math.ceil((now instanceof Date ? now : new Date()).getTime() / 3600000) * 3600000, out = [], i;
          for (i = 0; i < 14; i++) { var wet = i >= 4 && i <= 6; out.push({ time: new Date(t0 + i * 3600000).toISOString(), rain_chance_pct: wet ? 60 + i * 3 : 10 + (i % 4) * 5, temp: 30 - (i > 6 ? i - 6 : 0), code: wet ? 61 : 2, mm: wet ? 1.4 : 0 }); }
          return out;
        })() },
      current_guest: g1, next_guest: g2,
      calendar: [row('Demo Guest Zero', -8, -5, 'airbnb'), row('Demo Guest One', -1, 2, 'airbnb'), row('Demo Guest Two', 2, 5, 'direct'),
        row('Demo Guest Three', 9, 12, 'airbnb'), row('Demo Guest Four', 10, 13, 'direct'), row('Demo Guest Six', 18, 20, 'direct'), row('Demo Guest Six', 20, 22, 'direct'),
        block(14, 16, 'maintenance', 'Maintenance'), block(24, 26, 'owner', 'Owner stay')],
      day_flags: [{ date: d(3), kind: 'brownout', label: 'Brownout', source: 'auto', id: null }, { date: d(6), kind: 'deep_clean', label: 'Deep clean', source: 'manual', id: 'demo-flag-1' },
        { date: d(15), kind: 'maintenance', label: 'Aircon service', source: 'manual', id: 'demo-flag-2' }],
      warnings: [{ kind: 'brownout', title: 'Brownout', severity: 'warn', detail: { date: d(3), time: '13:00', hours: 3, grid_line: 'Feeder 0', posted_by: 'Demo' } },
        { kind: 'inventory', title: 'Low stock: Demo towels', severity: 'warn', detail: { qty: 4, unit: 'pcs', reorder_below: 6 } },
        { kind: 'verifier', title: 'Demo check: Airbnb block runs past the last guest night', severity: 'alert', key: 'V1m:demo', detail: { check_id: 'V1m' } }]
    };
    if (empty) { // s126: an empty night for the vacant card; the stays leave the calendar too, so nothing else says someone is in the house
      home.current_guest = null; home.calendar = home.calendar.filter(function (x) { return x.guest_name !== 'Demo Guest One'; });
      if (empty === 'none') { home.next_guest = null; home.calendar = home.calendar.filter(function (x) { return x.guest_name !== 'Demo Guest Two'; }); }
    }
    if (!admin) home.warnings = home.warnings.filter(function (w) { return w.kind !== 'verifier'; }); // the server sends a cleaner no system checks
    // notices_v1 (Lane B builds it): house times 12:00 noon / 2:00 pm, weather with a rain watch, power and water notices, house items and the inbox count for owner and admin only.
    var hr = function (h, pct, mm) { return { time: at(0, (h < 10 ? '0' : '') + h + ':00'), rain_chance_pct: pct, mm: mm, code: pct > 50 ? 61 : 2 }; };
    var notices = { generated_at: stamp, role: r, house_times: { check_out: '12:00', check_in: '14:00' },
      weather: { source: 'open-meteo', fetched_at: stamp, temp_c: 29, condition: 'Partly cloudy', code: 2, rain_chance_pct: 70, aqi: 42,
        hourly: [hr(10, 10, 0), hr(11, 20, 0), hr(12, 30, 0), hr(13, 40, 0), hr(14, 70, 1.2), hr(15, 80, 2.4), hr(16, 70, 1.6), hr(17, 40, 0.2), hr(18, 20, 0)], rain_watch: { from: at(0, '14:00'), to: at(0, '17:00'), peak_pct: 80 } },
      notices: [{ id: 'demo-n1', type: 'power', title: 'Brownout 1:00 to 4:00 pm', date: d(3), start_time: '13:00', end_time: '16:00', duration_hours: 3, source: 'socoteco', detail: 'San Isidro feeder · line maintenance' },
        { id: 'demo-n2', type: 'water', title: 'No water 9:00 am to 3:00 pm', date: d(5), start_time: '09:00', end_time: '15:00', duration_hours: 6, source: 'gscwd', detail: 'Pipe repair. Fill the water drums the day before.', url: 'https://www.facebook.com/gscwaterdistrict/posts/demo' },
        { id: 'demo-n3', type: 'deep_clean', title: 'Deep clean', date: d(6), start_time: null, end_time: null, duration_hours: null, source: 'manual', detail: null }],
      house: admin ? [{ kind: 'low_stock', id: 'demo-towels', title: 'Low stock: Demo towels, 4 left', detail: 'Reorder below 6' }, { kind: 'finding', id: 'V1m:demo', title: 'System check', detail: 'Airbnb block runs past the last guest night' }] : [],
      inbox_open: admin ? 2 : null, sources: { water_page: 'https://www.facebook.com/gscwaterdistrict/', power_page: 'https://www.facebook.com/socoteco2.EC/' } };
    var task = function (o) {
      return Object.assign({ source: 'follow_up_tasks', kind: 'reminder', detail: null, priority: 'normal', status: 'open', due_at: null, assignee_id: null, assignee_label: null, mine: false,
        created_at: at(-2, '09:00'), completed_at: null, version: 1, blocks_arrival: false }, o);
    };
    var all = [
      task({ id: 'demo-t1', title: 'Demo: restock the guest towels', detail: 'Check the linen cupboard.', due_at: at(0, '17:00'), assignee_id: 'demo-u-1', assignee_label: 'Demo Cleaner', mine: r === 'cleaner' }),
      task({ id: 'demo-t2', kind: 'cleaning_issue', title: 'Demo: shower drain is slow', priority: 'high', due_at: at(-1, '17:00'), blocks_arrival: true }),
      task({ id: 'demo-t3', kind: 'work_order', title: 'Demo: replace the hallway bulb', due_at: at(4, '12:00') }),
      task({ id: 'demo-t4', kind: 'guest_follow_up', title: 'Demo: ask Demo Guest One about the late check-out', assignee_id: 'demo-u-2', assignee_label: 'Demo Admin' }),
      task({ source: 'verifier_findings', id: 'V1m:demo', kind: 'verifier', title: 'Demo check: Airbnb block runs past the last guest night', priority: 'high', detail: 'Demo finding. Nothing here is real.' }),
      task({ id: 'demo-t5', title: 'Demo: wash the pool-side cushions', status: 'done', completed_at: at(-1, '10:00') })
    ];
    var mine = function (t) { return t.mine || (!t.assignee_id && t.kind !== 'guest_follow_up' && t.kind !== 'verifier'); };
    return {
      role: r,
      access: { role: r, disabled: false, session_current: true, property_ids: ['demo-property'] },
      user: { id: 'demo-user-' + r, email: 'demo.' + r + '@example.invalid', user_metadata: { display_name: 'Demo ' + r.charAt(0).toUpperCase() + r.slice(1) } },
      home: home, notices: notices,
      tasks: function (includeDone) { return { ok: true, manager: admin, today: today, tasks: all.filter(function (t) { return (includeDone || t.status !== 'done') && (admin || mine(t)); }) }; },
      assignees: { ok: true, staff: [{ user_id: 'demo-u-1', label: 'Demo Cleaner', role: 'cleaner' }, { user_id: 'demo-u-2', label: 'Demo Admin', role: 'admin' }] },
      rates: { ok: true, today: today,
        in_force: { effective_from: d(-90), regular_rate: 400, general_rate: 800, transport_rate: 100, note: 'Demo rate' },
        next: { effective_from: d(30), regular_rate: 420, general_rate: 840, transport_rate: 100, note: 'Demo rate change' },
        history: [{ effective_from: d(30), regular_rate: 420, general_rate: 840, transport_rate: 100, note: 'Demo rate change' }, { effective_from: d(-90), regular_rate: 400, general_rate: 800, transport_rate: 100, note: 'Demo rate' },
          { effective_from: d(-400), regular_rate: 350, general_rate: 700, transport_rate: null, note: 'Demo first rate' }] },
      signin: [{ label: 'Demo Cleaner', handle: 'demo.cleaner@staff.cascade.invalid', kind: 'pin' }, { label: 'Demo Laundry', handle: 'demo.laundry@staff.cascade.invalid', kind: 'pin' }, { label: 'Demo Admin', handle: 'demo.admin@example.invalid', kind: 'password' }, { label: 'Demo Owner', handle: 'demo.owner@example.invalid', kind: 'password' }],
      pay: { ok: true, reports_owed: [{ date: '2026-10-14', ref: 'DEMO0002', status: 'paid' }, { date: '2026-10-17', ref: 'DEMO0002', status: 'paid' }, { date: '2026-10-19', ref: 'DEMO0002', status: 'paid' }], sessions: [{ id: 'demo-s1', date: d(-3), type: 'turnover', base: 400, transport: 100, guest: 'Demo Guest Zero' }, { id: 'demo-s2', date: d(-1), type: 'deep_clean', base: 800, transport: null }],
        claims: [{ id: 'demo-c1', date: d(-2), description: 'Demo: dish soap for the kitchen', amount: 35 }], missing_reports: [d(-6)], advance: [{ checkout_date: d(0), base: 400, transport: 100 }, { checkout_date: d(1), base: 400, transport: null }],
        requests: [{ total: 450, ref: 'CASCADE-DEMO001', created_at: d(-9) + 'T10:00:00Z', status: 'paid', paid_at: d(-8) + 'T10:00:00Z' }] },
      stay: { guest_name: 'Demo Guest One', checkin: d(-1), checkout: d(2) },
      kpi: kpiFixture(r, today),
      items: [['d1', 'Toilet paper', 'Bathroom', 'rolls', true], ['d2', 'Hand soap', 'Bathroom', 'bottles', true], ['d3', 'Water bottles', 'Kitchen', 'bottles', true], ['d4', 'Coffee sachets', 'Kitchen', 'sachets', true], ['d5', 'Garbage bags', 'Cleaning', 'pcs', true], ['d6', 'Bath towels', 'Linen', 'pcs', false]]
        .map(function (x) { return { id: x[0], name: x[1], category: x[2], unit: x[3], consumable: x[4], active: true, qty: 12 }; })
    };
  }
  // s134: expenses_screen_v1 as the contract says (SPEC 6). p_limit 0 is the summary only (the Today card). Memory only: nothing is ever saved.
  function expensesFixture(today, args) {
    var d = function (n) { return CS.addDays(today, n); }, ym = today.slice(0, 7), month = ym + '-01', summary = !!(args && args.p_limit === 0);
    var rows = [
      { id: 'dx1', date: d(0), amount: '540.00', category: 'supplies', label: 'Supplies', payee: 'Sample hardware', notes: 'Light bulbs and tape', status: 'confirmed', chip: 'receipt', has_receipt: true, locked: false, amount_locked: false, stock: null, lookalike_id: null, created_at: d(0) + 'T02:00:00Z', receipt_ref: { kind: 'txn', id: 'dx1', mime: 'image/jpeg' }, receipt_can: { add: false, replace: true, remove: true } },
      { id: 'dx2', date: d(-1), amount: '1200.00', category: 'cleaning', label: 'Cleaning', payee: 'Sample cleaner', notes: 'Cleaning fee', status: 'confirmed', chip: 'staff_pay', has_receipt: false, locked: true, amount_locked: true, stock: null, lookalike_id: null, created_at: d(-1) + 'T02:00:00Z', receipt_ref: null, receipt_can: { add: false, replace: false, remove: false } },
      { id: 'dx3', date: d(-2), amount: '3420.00', category: 'supplies', label: 'Supplies', payee: 'Sample market', notes: 'Stock bought', status: 'confirmed', chip: 'stock', has_receipt: false, locked: false, amount_locked: true, stock: { lines: 4, items: 4 }, lookalike_id: null, created_at: d(-2) + 'T02:00:00Z', receipt_ref: null, receipt_can: { add: true, replace: false, remove: false } },
      { id: 'dx4', date: d(-3), amount: '540.00', category: 'supplies', label: 'Supplies', payee: 'Sample hardware', notes: 'From Telegram', status: 'pending_review', chip: 'telegram', has_receipt: false, locked: false, amount_locked: false, stock: null, lookalike_id: 'dx1', created_at: d(-3) + 'T02:00:00Z', receipt_ref: null, receipt_can: { add: true, replace: false, remove: false } },
      { id: 'dx5', date: d(-4), amount: '1850.00', category: 'utilities', label: 'Utilities', payee: 'Demo power company', notes: 'Electric bill', status: 'confirmed', chip: 'bill', has_receipt: true, locked: true, amount_locked: true, stock: null, lookalike_id: null, created_at: d(-4) + 'T02:00:00Z', receipt_ref: { kind: 'bill', id: 'demo-bill-1', mime: 'image/jpeg' }, receipt_can: { add: false, replace: false, remove: false } },
      { id: 'dx6', date: d(-5), amount: '800.00', category: 'supplies', label: 'Supplies', payee: 'Demo shop', notes: 'Stock bought, some items not priced', status: 'pending_review', chip: 'stock', has_receipt: false, locked: false, amount_locked: true, stock: { lines: 3, items: 3 }, s134_incomplete: true, lookalike_id: null, lookalike: null, created_at: d(-5) + 'T02:00:00Z', receipt_ref: null, receipt_can: { add: false, replace: false, remove: false } }];
    // newest first by (created_at, id), the cursor the server pages on (p_before + p_before_id)
    rows.sort(function (a, b) { return a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : (a.created_at < b.created_at ? 1 : -1); });
    var paged = args && args.p_before ? rows.filter(function (r) { return r.created_at < args.p_before || (r.created_at === args.p_before && (!args.p_before_id || r.id < args.p_before_id)); }) : rows, lim = args && args.p_limit > 0 ? args.p_limit : 100, more = paged.length > lim;
    rows = paged.slice(0, lim).map(function (r) { var bill = r.chip === 'bill'; // s143: who paid, how, the period a bill covers and a plain title
      return Object.assign({}, r, { title: bill ? 'Electricity bill' : r.notes, by: bill ? 'Zz Finance' : 'Zz Ana', method: bill ? 'gcash' : null, covers: bill ? { from: CS.addDays(r.date, -35), to: CS.addDays(r.date, -4) } : null }); });
    var cats = [{ slug: 'supplies', label: 'Supplies' }, { slug: 'cleaning', label: 'Cleaning' }, { slug: 'utilities', label: 'Utilities' }, { slug: 'maintenance', label: 'Maintenance' }, { slug: 'other', label: 'Other' }];
    return { ok: true, month: month, total: 7010, count: 4, prev_total: 41200, basis: 47413, basis_months: [d(-90).slice(0, 7), d(-30).slice(0, 7)], pending: { count: 2, total: 1340 }, pending_all: { count: 2, total: 1340 },
      by_category: [{ category: 'supplies', label: 'Supplies', txn_type: 'expense', total: 3960, count: 2 }, { category: 'utilities', label: 'Utilities', txn_type: 'expense', total: 1850, count: 1 }, { category: 'cleaning', label: 'Cleaning', txn_type: 'expense', total: 1200, count: 1 }],
      rows: summary ? [] : rows, unpriced: { count: 0, items: [] }, unlinked: 2, categories: cats, can_write: true, more: summary ? false : more };
  }
  // s110: kpi_tab_v1 as the contract says. The admin key is ABSENT for every role but owner and admin (demo has no finance view).
  function kpiFixture(r, today) {
    var k = { ok: true, month: today.slice(0, 7) + '-01',
      // s111 rev 2: use per DAY between readings; nights booked from the calendar (same 22 as the Admin occupancy below)
      utility: { kwh_month: 412, kwh_per_day: 13.7, m3_month: 13.2, m3_per_day: 0.44, nights_booked: 22, nights_in_month: 30,
        last_reading: { recorded_at: today + 'T02:00:00Z', delta_kwh: 38.2, days: 3, kwh_per_day: 12.7, delta_m3: 1.3, m3_per_day: 0.43, flag: null },
        per_stay: [[14.2, 0.45, 3], [18.4, 0.52, 2], [12.6, 0.38, 4], [24.1, 0.7, 1], [16, 0.5, 3], [13.3, 0.41, 5], [15.1, 0.47, 2], [12.7, 0.43, 3]].map(function (v, i) { var d = CS.addDays(today, -3 * (7 - i)); return { checkout_date: d, from: CS.addDays(d, -v[2]), to: d, recorded_at: d + 'T04:00:00Z', days: v[2], kwh: Math.round(v[0] * v[2] * 10) / 10, kwh_per_day: v[0], m3: Math.round(v[1] * v[2] * 100) / 100, m3_per_day: v[1] }; }),
        per_month: [[38, 1.2, 4], [41, 1.3, 5], [36, 1.1, 3], [0, 0, 0], [44, 1.4, 6], [39, 1.2, 4], [146, 1.5, 2], [42, 1.3, 4], [0, 0, 0], [40, 1.2, 5], [45, 1.32, 4], [41, 1.3, 5]] // s113: per stay over about 3 nights; one outlier month (146 kWh, a meter misread) to show the outlier marker
          .map(function (v, i, all) { var m = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 - (all.length - 1 - i), 1)); return { month: m.toISOString().slice(0, 7), stays: v[2], kwh: v[0] ? v[0] * v[2] : null, m3: v[1] ? Math.round(v[1] * v[2] * 100) / 100 : null, kwh_per_stay: v[0] || null, m3_per_stay: v[1] || null, kwh_per_day: v[0] ? (v[0] > 100 ? 13.6 : Math.round(v[0] / 3 * 10) / 10) : null, m3_per_day: v[1] ? Math.round(v[1] / 3 * 100) / 100 : null }; }),
        brownouts: { count: 2, hours: 9 }, water_cuts: { count: 1, hours: 5 }, internet_cuts: { count: 1, hours: 2 } },
      inventory: { low_now: 5, restocks_month: 3, turnovers_month: 9,
        per_turnover: [{ item_id: 'd1', name: 'Toilet paper', used_per_turnover: 2.1, usual: 2 }, { item_id: 'd3', name: 'Water bottles', used_per_turnover: 4.6, usual: 4 }, { item_id: 'd4', name: 'Coffee sachets', used_per_turnover: 3, usual: 4 }],
        runs_out: [{ item_id: 'd2', name: 'Hand soap', days_left: 4 }, { item_id: 'd5', name: 'Garbage bags', days_left: 21 }] } };
    if (r === 'owner' || r === 'admin') k.admin = { rate: { php_per_kwh: 11.25, effective_from: CS.addDays(today, -20), source: 'auto', source_url: 'https://www.facebook.com/socoteco2.EC/' }, last_reading_cost: 429.75, kpi_source: 'ledger', kpi_ledger_from: today.slice(0, 7), month_kwh_cost: 4635, supplies_month: 4950, supply_cost_per_turnover: 550, cleaning_pay_month: 6300,
      net_month: 38420, revenue_month: 61900, costs_month: 23480, occupancy: 0.73, sold_nights: 22, sellable_nights: 30, adr: 2814, direct_share: 0.41,
      target: { net_target: 30000, costs_basis: 24100, revenue_needed: 54100, adr: 2814, nights_in_month: 30, nights_on_books: 22, needed_occupancy: 0.64, needed_adr: 2459, set_by: null, set_at: CS.addDays(today, -6) + 'T03:00:00Z' } };
    s127(k, r, today);
    return k;
  }
  // s127: utility bills, usage by month and by guest, as the contract says (docs/s127/CONTRACT.md). Invented names, hand-set numbers at the demo rate of 11.25. Money only in `admin`.
  function cycleOf(today) { // the 21st to the 21st that holds today
    var m0 = today.slice(0, 8) + '01', from = +today.slice(8, 10) >= 21 ? today.slice(0, 8) + '21' : CS.addDays(m0, -1).slice(0, 8) + '21', to = +today.slice(8, 10) >= 21 ? CS.addDays(m0, 31).slice(0, 8) + '21' : today.slice(0, 8) + '21';
    return { from: from, to: to, dim: CS.daysBetween(from, to), last: CS.addDays(today, -1) };
  }
  function s127(k, r, today) {
    var cy = cycleOf(today), days = Math.max(1, CS.daysBetween(cy.from, cy.last)), mk = function (n) { return new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7); };
    var KWH = [372, 380, null, 349, 380, 338], M3 = [5.9, 5.8, null, 6.2, 8.9, 5.5], chg = function (a, i) { for (var j = i - 1; j >= 0; j--) if (a[j] != null) return a[i] != null ? Math.round((a[i] / a[j] - 1) * 100) : null; return null; };
    k.utility.usage_months = KWH.map(function (v, i) { var now = i === KWH.length - 1; return { month: mk(i - (KWH.length - 1)), kwh: v, m3: M3[i], kwh_change_pct: chg(KWH, i), m3_change_pct: chg(M3, i), forecast: now, kwh_so_far: now ? 214 : null, m3_so_far: now ? 3.5 : null }; });
    // per guest night (Addendum 1): hand-set guest nights, the current month over what is used so far, the change against the previous month that has a figure
    var GN = [19, 21, 0, 21, 22, 12];
    var perN = function (a, so, dp) { return a.map(function (v, i) { var u = i === a.length - 1 ? so : v; return u != null && GN[i] > 0 ? Math.round(u / GN[i] * Math.pow(10, dp)) / Math.pow(10, dp) : null; }); };
    var PK = perN(KWH, 214, 1), PM = perN(M3, 3.5, 2);
    k.utility.usage_months.forEach(function (m, i) { m.guest_nights = GN[i]; m.kwh_per_night = PK[i]; m.m3_per_night = PM[i]; m.kwh_night_change_pct = chg(PK, i); m.m3_night_change_pct = chg(PM, i); });
    if (!k.admin) return;
    var stay = function (n, name, tier, nights, kwh, m3, path, box) { return { from: CS.addDays(CS.addDays(today, -n), -nights), to: CS.addDays(today, -n), nights: nights, kwh: kwh, m3: m3, cost_php: Math.round(kwh * 1125) / 100, guest_name: name, tier: tier, id_photo_path: path, id_face_box: box }; };
    var box = { x: 0.056, y: 0.26, w: 0.27, h: 0.54, src: 'v' };
    k.admin.bills = {
      electric: { cycle_from: cy.from, cycle_to: cy.to, days: days, days_in_cycle: cy.dim, kwh: 383, rate: 11.25, fixed_php: 5.6, so_far_php: 4314.35, forecast_kwh: 409, forecast_php: 4606.85, per_day_kwh: 13.2, per_day_php: 148.5, last_reading_at: cy.last + 'T02:00:00Z' },
      water: { cycle_from: cy.from, cycle_to: cy.to, days: days, m3: 7.2, so_far_php: 212, forecast_m3: 7.7, forecast_php: 212, per_day_m3: 0.25, min_php: 212, min_m3: 10, next_php: 23.05, next_upto: 20 } };
    k.admin.rate.checked_at = today + 'T01:00:00Z'; k.admin.rate.effective_from = today.slice(0, 8) + '01'; k.admin.rate_year_avg = 10.78;
    k.admin.rate_history = [11.25, 11.8, 11.65, 9.59, 11.16, 10].map(function (v, i, a) { return { month: mk(-i), php_per_kwh: v, change_pct: i < a.length - 1 ? Math.round((v / a[i + 1] - 1) * 1000) / 10 : null }; });
    k.admin.water_rate = { min_php: 212, min_m3: 10, next_php: 23.05, next_upto: 20, source_url: 'https://gensanwater.gov.ph/water-rates/' };
    k.admin.stays = [stay(1, 'Demo Guest One', 'returning', 1, 10, 0.11, 'demo/id-1', box), stay(2, 'Demo Guest Two', 'vip', 1, 11, 0.21, 'demo/id-1', box), stay(6, 'Demo Guest Three', null, 2, 37, 0.72, 'demo/id-1', null), stay(8, 'Demo Guest Four', 'regular', 4, 37, 0.22, null, null), stay(12, 'Demo Guest Five', null, 3, 25, 0.57, null, null)];
  }

  // s130: the demo notes, one source for the guest card (build), the Edit notes screen (G_guests) and Add guest details. g1 is legacy free text with line breaks; g2 has 8 notes:
  // every level, a suggestion, an addressed note and a long one.
  function noteSeed(today) {
    var d = function (n) { return CS.addDays(today, n); };
    return {
      g1: ['Likes the room cool, AC at 24', 'Allergic to feather pillows, please use the foam ones', 'Arriving late on the first night, around 10 pm'].join('\n'),
      g2: CS.serializeNotes([
        { date: d(-100), mark: 3, text: 'Severe shellfish allergy. No seafood snacks in the welcome tray.' },
        { date: d(-20), mark: 2, text: 'Asked for the quiet side: switch the hallway light off by 9 pm.' },
        { date: d(-20), mark: 2, suggestion: true, text: 'A full-length mirror near the door would help.' },
        { date: d(-100), mark: 1, text: 'Likes two extra pillows and the AC at 24.' },
        { date: d(-20), mark: 0, text: 'Arrived late, around 10 pm. Self check-in went fine.' },
        { date: d(-100), mark: 0, text: 'Travels for work, usually three nights. Books direct after the first Airbnb stay and pays by GCash when booking.' },
        { date: d(-200), mark: 0, text: 'First stay. Left the unit very tidy.' },
        { date: d(-200), mark: 0, suggestion: true, text: 'The shower drain was slow.', addressed: true, addressedOn: d(-100) }
      ])
    };
  }

  // ---- the stand-in for the Supabase client: same four calls the pages make, answered from the fixtures ---------------------------
  var WRITES = ['admin_save_transaction_v2', 'expense_void_v1', 'expense_receipt_set_v1', 'admin_review_transaction_v1', 'calendar_day_flag_set_v1', 'calendar_day_flag_clear_v1', 'ack_verifier_finding_v1', 'task_set_done_v1', 'task_add_reminder_v1', 'admin_add_pay_rate_v1', 'ops_notice_add_v1', 'ops_notice_close_v1',
    'record_inventory_usage', 'record_inventory_receipt_v1', 'inventory_receipt_confirm_v1', 'inventory_receipt_undo_v1', 'inventory_receipt_cancel_v1', 'inventory_item_photo_set_v1', 'utility_rate_set_v1', 'admin_resolve_report_block_v1', 'admin_request_meter_resend_v1', 'kpi_target_set_v1']; // s110: stock, rate and meter-check writes say "nothing was saved"
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
  function admin_(v) { return v === 'owner' || v === 'admin'; }
  function client(role, now, empty) {
    var view = VIEWS.indexOf(role) >= 0 ? role : 'owner', D = function () { return build(view, now, empty == null ? emptyFrom(root.location && root.location.search) : empty); }, doneSet = {}, acked = {}, closed = {}; // doneSet: this page load only, so a task marked done leaves the list and Undo brings it back, like the live app
    var done = function (data) { return Promise.resolve({ data: clone(data), error: null }); };
    // s127: the bills of the demo. Invented names and numbers, kept in memory for this page load. Refusals can be seen: a second payment with the same demo screenshot is a duplicate,
    // and an amount more than a quarter away from the estimate asks once. Owner, admin and finance may pay; only owner and admin may edit.
    var BS = (/[?&]bills=([ABC])(?:&|$)/.exec(String(root.location && root.location.search || '')) || [0, ''])[1], assumed = { electric: BS !== 'B', water: BS === 'C' }, rdate = {}, usedShot = {};
    // s143: a reading date is the day on the paper bill. addMonths keeps the anchor day and clamps at month end (31 Jan -> 28 Feb).
    var addMonths = function (iso, n) { var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1, d = +iso.slice(8, 10), last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m + n, Math.min(d, last))).toISOString().slice(0, 10); };
    var mSince = function (today) { var c = cycleOf(today); return new Date(Date.UTC(+c.from.slice(0, 4), +c.from.slice(5, 7) - 2, 21)).toISOString().slice(0, 10); }; // the day the open cycle began (the older demo's "since")
    var mTo = function (kind, today) { return rdate[kind] || mSince(today); };
    var bills = null, mayPay = view === 'owner' || view === 'admin' || view === 'finance', mayEdit = view === 'owner' || view === 'admin';
    var SCHED = { electric: { label: 'Electricity', payee_name: 'Zz Power Co', number_label: 'Account number', number: 'Account ••••••', note: 'Electricity', amount_php: null, remind_day: 27, amount_fixed: false },
      water: { label: 'Water', payee_name: 'Zz Water Co', number_label: 'Account number', number: 'Account ••••••', note: 'Water', amount_php: null, remind_day: 28, amount_fixed: false },
      internet: { label: 'Internet', payee_name: 'Zz Internet Co', number_label: 'GCash number', number: '09•• ••• ••••', note: 'Internet', amount_php: 1500, remind_day: 27, amount_fixed: true },
      netflix: { label: 'Streaming', payee_name: 'Zz Stream Co', number_label: 'Account number', number: 'Account ••••••', note: 'Streaming', amount_php: 449, remind_day: 10, amount_fixed: true } };
    var me = 'Demo ' + view.charAt(0).toUpperCase() + view.slice(1);
    function seedBills(today) {
      if (bills) return bills; var ago = new Date(Date.parse(today + 'T04:00:00Z') - 10 * 86400000).toISOString();
      var mk = function (id, kind, est, due, isEst, o) { return Object.assign({ id: 'demo-bill-' + id, kind: kind, label: SCHED[kind].label, period: (kind === 'electric' || kind === 'water' ? cycleOf(today).from : today).slice(0, 7), status: 'due', estimate_php: est, paid_php: null, is_estimate: isEst, due_day: due, paying_by_name: null, paid_by_name: null, paid_at: null }, o || {}); };
      var list = [mk('e', 'electric', 2140, 27, true), mk('w', 'water', 430, 30, true, { status: 'paying', paying_by_name: 'Zz Payer' }), mk('i', 'internet', 1500, 28, false), mk('n', 'netflix', 449, 10, false, { status: 'paid', paid_php: 449, paid_by_name: 'Zz Finance', paid_at: ago })];
      var pay = function (b) { b.status = 'paid'; b.paying_by_name = null; b.paid_php = b.estimate_php; b.paid_by_name = 'Zz Finance'; b.paid_at = ago; };
      if (BS === 'A') pay(list[1]); if (BS === 'B') list.forEach(pay);
      if (BS === 'C') list.forEach(function (b) { b.status = 'due'; b.paying_by_name = null; b.paid_php = null; b.paid_by_name = null; b.paid_at = null; });
      list.forEach(function (b) { b.paid_on = b.paid_at ? b.paid_at.slice(0, 10) : null; if (b.kind === 'electric' || b.kind === 'water') { b.to = mTo(b.kind, today); b.from = addMonths(b.to, -1); b.to_assumed = assumed[b.kind]; } else { b.from = null; b.to = null; b.to_assumed = false; } });
      return (bills = list);
    }
    function ent(b) { return Object.assign({}, b, { can_pay: mayPay && (b.status === 'due' || (b.status === 'paying' && b.paying_by_name === me)) }); }
    function billList(today) { return seedBills(today).map(ent); }
    function billCall(name, a, today) {
      var list = seedBills(today), b = list.filter(function (x) { return x.id === a.p_bill_id; })[0];
      if (/^bill_pay_|^bill_proof/.test(name)) { if (!mayPay) return { ok: false, reason: 'not_authorized' }; if (!b) return { ok: false, reason: 'not_found' }; }
      if (name === 'bill_proof_v1') return b.status === 'paid' ? { ok: true, path: 'demo/proof.jpg' } : { ok: false, reason: 'no_proof' };
      if (name === 'bill_pay_open_v1') {
        if (b.status === 'paid') return { ok: false, reason: 'already_paid', bill: ent(b) }; if (b.status === 'paying' && b.paying_by_name !== me) return { ok: false, reason: 'paying_by_other', name: b.paying_by_name };
        b.status = 'paying'; b.paying_by_name = me; var sc = SCHED[b.kind], month = new Date(b.period + '-01T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
        var meterB = b.kind === 'electric' || b.kind === 'water';
        return { ok: true, bill: Object.assign(ent(b), { reading_date: meterB ? b.to : null, reading_date_assumed: meterB ? b.to_assumed : false }), pay: { payee_name: sc.payee_name, number_label: sc.number_label, number: sc.number, note: sc.note + ', ' + month, amount_php: b.estimate_php, amount_editable: b.is_estimate, method_default: 'gcash' }, can_edit: mayEdit };
      }
      if (name === 'bill_pay_cancel_v1' || name === 'bill_pay_skip_v1') {
        if (b.status === 'paid') return { ok: false, reason: 'already_paid' }; if (b.status === 'paying' && b.paying_by_name !== me) return { ok: false, reason: 'not_payer', name: b.paying_by_name }; toast(NOTE);
        if (name === 'bill_pay_skip_v1') bills = bills.filter(function (x) { return x !== b; }); else { b.status = 'due'; b.paying_by_name = null; } return { ok: true, bill: ent(b) };
      }
      if (name === 'bill_pay_settle_v1') {
        var p = a.p_proof || {}; if (b.status === 'paid') return { ok: false, reason: 'already_paid', bill: ent(b) }; if (b.paying_by_name !== me) return { ok: false, reason: 'not_payer', name: b.paying_by_name };
        var meter = b.kind === 'electric' || b.kind === 'water', today1 = CS.manilaToday(), prev = CS.addDays(today1, -40);
        if (p.paid_on != null && (!/^\d{4}-\d{2}-\d{2}$/.test(p.paid_on) || p.paid_on > today1 || (meter && p.paid_on < (p.reading_date || b.to || '')))) return { ok: false, reason: 'paid_on_invalid' };
        if (p.method != null && ['gcash', 'bank', 'cash', 'card', 'other'].indexOf(p.method) < 0) return { ok: false, reason: 'bad_method' };
        if (meter && !p.reading_date && b.to_assumed) return { ok: false, reason: 'reading_date_required' }; if (meter && p.reading_date && (!/^\d{4}-\d{2}-\d{2}$/.test(p.reading_date) || p.reading_date > today1 || p.reading_date <= prev)) return { ok: false, reason: 'reading_date_invalid' };
        if (!(p.amount > 0)) return { ok: false, reason: 'bad_amount' }; if (usedShot[p.sha256]) return { ok: false, reason: 'duplicate_proof' };
        if ((p.amount < b.estimate_php * 0.5 || p.amount > b.estimate_php * 2) && p.confirmed !== true) return { ok: false, reason: 'confirm_amount', read: p.amount, estimate_php: b.estimate_php };
        usedShot[p.sha256] = 1; b.status = 'paid'; b.paid_php = p.amount; b.paid_by_name = me; b.paid_at = new Date().toISOString(); b.paid_on = p.paid_on || today1; b.method = p.method || null; if (meter && p.reading_date) { b.to = p.reading_date; b.to_assumed = false; assumed[b.kind] = false; rdate[b.kind] = p.reading_date; } toast(NOTE); return Object.assign({ ok: true, bill: ent(b), paid_php: p.amount }, meter && p.reading_value != null && Math.abs(p.reading_value - (b.kind === 'electric' ? 4655 : 48)) > (b.kind === 'electric' ? 30 : 3) ? { reading_warn: true } : {});
      }
      if (!mayEdit) return { ok: false, reason: 'not_authorized' }; var c = SCHED[a.p_kind]; if (!c) return { ok: false, reason: 'bad_kind' };
      if (name === 'bill_schedule_get_v1') return Object.assign({ ok: true, kind: a.p_kind }, c);
      var keys = Object.keys(a.p_patch || {}), bad = keys.filter(function (k) { return ['payee_name', 'number', 'note', 'amount_php', 'remind_day'].indexOf(k) < 0; })[0]; if (bad) return { ok: false, reason: 'bad_key', key: bad };
      var rd = a.p_patch.remind_day; if (rd != null && !(rd >= 1 && rd <= 28)) return { ok: false, reason: 'bad_value', key: 'remind_day' };
      keys.forEach(function (k) { c[k] = a.p_patch[k]; }); toast(NOTE); return { ok: true, kind: a.p_kind, changed: keys };
    }
    // s143: bill_reading_set_v1, the contract's refusals and shapes (tests/fixtures/s143_pay_open.json reading_set). The target is the oldest bill of the kind that is not paid; none open = a new cycle row.
    function readingSet(a, today) {
      if (!mayPay) return { ok: false, reason: 'not_authorized' }; if (a.p_kind !== 'electric' && a.p_kind !== 'water') return { ok: false, reason: 'bad_kind' };
      var list = seedBills(today), open = list.filter(function (x) { return x.kind === a.p_kind && x.status !== 'paid'; })[0], d = a.p_reading_date, from = open ? open.from : mTo(a.p_kind, today);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return { ok: false, reason: 'reading_date_invalid', before: today };
      if (d > today) return { ok: false, reason: 'reading_date_invalid', before: today }; if (d <= from) return { ok: false, reason: 'reading_date_invalid', after: from };
      if (a.p_reading_value != null && !(Number(a.p_reading_value) >= 0)) return { ok: false, reason: 'reading_value_invalid' };
      var est = Math.round((a.p_kind === 'electric' ? 4270 : 212) * Math.max(1, CS.daysBetween(from, d)) / 30), out = { ok: true, bill_id: open ? open.id : 'demo-bill-new-' + a.p_kind, period: d.slice(0, 7), from: from, to: d, estimate_php: est, next_reading: addMonths(d, 1), reading_warn: null, preview: a.p_preview === true };
      if (a.p_preview === true) return out;
      if (!open) { open = { id: out.bill_id, kind: a.p_kind, label: SCHED[a.p_kind].label, period: out.period, status: 'due', estimate_php: est, paid_php: null, is_estimate: true, due_day: 27, paying_by_name: null, paid_by_name: null, paid_at: null, paid_on: null, from: from }; list.push(open); }
      open.to = d; open.to_assumed = false; open.estimate_php = est; open.period = out.period; assumed[a.p_kind] = false; rdate[a.p_kind] = d; toast(NOTE); return out;
    }
    function rpc(name, args) {
      var X = D();
      if (name === 'task_set_done_v1' && args && args.p_id) doneSet[args.p_id] = !!args.p_done; // memory only: nothing is ever saved
      if (name === 'ack_verifier_finding_v1' && args && args.p_key) acked[args.p_key] = 1; if (name === 'ops_notice_close_v1' && args && args.p_id) closed[args.p_id] = 1; // memory only, so the reload drops the row
      if (name === 'inventory_receipt_manual_v1') { toast(NOTE); return done({ ok: true, draft_id: 'demo-manual', purchase_count: 1, new_items: [] }); } // the answer carries the entry id, so the demo shows Undo too
      if (name === 'save_guest_profile_v1') return done({ ok: true, version: ((args && args.p_expected_version) || 0) + 1 }); // s130: a note save works in the demo (the Edit notes screen keeps the text in memory), and the version moves on
      if (WRITES.indexOf(name) >= 0) { toast(NOTE); return done({ ok: true }); }
      switch (name) {
        case 'current_staff_access': return done(X.access);
        case 'staff_home_v1': X.home.warnings = X.home.warnings.filter(function (w) { return !(w.kind === 'verifier' && acked[w.key]); }); return done(X.home);
        case 'notices_v1': X.notices.house = X.notices.house.filter(function (h) { return !(h.kind === 'finding' && acked[h.id]); }); X.notices.notices = X.notices.notices.filter(function (n) { return !closed[n.id]; }); return done(X.notices);
        case 'set_guest_photo_rotation_v1': return done({ ok: true, path: args && args.p_path, rotation: args && args.p_rotation }); // s91: memory only, like every demo write
        case 'cleaning_progress_v1': return done(admin_(view) ? { ok: true, active: { step: 4, of: 9, label: 'Bathroom', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), cleaner_name: 'Demo Cleaner' } } : { ok: false });
        case 'tasks_list_v1': { var tl = X.tasks(true), inc = !!(args && args.p_include_done); tl.tasks = tl.tasks.map(function (t) { return doneSet[t.id] === undefined ? t : Object.assign({}, t, { status: doneSet[t.id] ? 'done' : 'open' }); }).filter(function (t) { return inc || t.status !== 'done'; }); return done(tl); }
        case 'task_assignees_v1': return done(X.assignees);
        case 'admin_pay_rates_v1': return done(X.rates);
        case 'staff_pay_candidates_v1': return done(X.pay);
        case 'staff_signin_list_v1': return done(X.signin);
        case 'kpi_tab_v1': return done(X.kpi);
        case 'expenses_screen_v1': return done(admin_(view) || view === 'finance' ? expensesFixture(X.home.today, args) : { ok: false, error: 'forbidden' });
        case 'today_bills_v1': { // s131: the cycle stays open from the last bill's reading date (the 21st a month back) until the next bill is entered; staff who may not pay get one check row instead of the list
          var cb = cycleOf(X.home.today), sy = +cb.from.slice(0, 4), sm = +cb.from.slice(5, 7), since = new Date(Date.UTC(sy, sm - 2, 21)).toISOString().slice(0, 10), mon = new Date(Date.UTC(sy, sm - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
          var all = billList(X.home.today), meterOut = function (kind, php, use) { // s143: cycle_from, next_reading and the last bill of the meter (only for those who may pay)
            var cf = mTo(kind, X.home.today), lb = all.filter(function (x) { return x.kind === kind; })[0], o = Object.assign({ php: php }, use, { cycle_from: cf, cycle_from_assumed: assumed[kind], next_reading: addMonths(cf, 1) });
            if (mayPay && lb) o.last_bill = { id: lb.id, period: lb.period, from: lb.from, to: lb.to, to_assumed: lb.to_assumed, usage: kind === 'electric' ? 331 : 7.2, estimate_php: lb.estimate_php, paid_php: lb.paid_php, paid_on: lb.paid_on || null, paid_by_name: lb.paid_by_name, status: lb.status, has_proof: lb.status === 'paid' };
            return o; };
          var out = { since: since, water_since: since, waiting_for: mon, water_waiting_for: mon, can_pay_list: mayPay, check_bills: !mayPay, last_reading_at: cb.last + 'T02:00:00Z', electric: meterOut('electric', 4621, { kwh: 383 }), water: meterOut('water', 212, { m3: 7.2 }), due: mayPay ? all.filter(function (x) { return x.status !== 'paid'; }) : [] };
          if (mayPay) out.last_paid = all.filter(function (x) { return x.status === 'paid'; }).map(function (x) { return { kind: x.kind, period: x.period, paid_php: x.paid_php, paid_on: x.paid_on }; });
          if (BS) { out.waiting_for = null; out.water_waiting_for = null; out.since = mTo('electric', X.home.today); out.water_since = mTo('water', X.home.today); } // a mockup frame: the Money keys carry the cycle, nothing waits
          return done(out); }
        case 'bill_reading_set_v1': return done(readingSet(args || {}, X.home.today));
        case 'bill_pay_open_v1': case 'bill_pay_settle_v1': case 'bill_pay_cancel_v1': case 'bill_pay_skip_v1': case 'bill_proof_v1': case 'bill_schedule_get_v1': case 'bill_schedule_set_v1': return done(billCall(name, args || {}, X.home.today));
        case 'get_inventory_catalogue_v1': return done({ ok: true, items: X.items });
        case 'admin_report_blocks_v1': return admin_(view) ? done([{ reading_id: 'demo-reading-1', session_id: 'demo-s1', cleaner_name: 'Demo Cleaner', checkout_date: CS.addDays(X.home.today, -1), recorded_at: X.home.today + 'T02:00:00Z', typed_electric: 4310, typed_water: 812, prev_electric: 4272, prev_water: 805, photo_electric: 4301, photo_water: 812, photo_note_electric: 'Last digit unclear', photo_note_water: null, photo_path_electric: null, photo_path_water: null, resend_requested_at: null }]) : Promise.resolve({ data: null, error: { code: '42501', message: 'not authorized' } });
        case 'inventory_receipt_draft_v1': return done({ ok: true, draft: { id: args && args.p_draft_id || 'demo-draft', vendor: 'Demo Hardware', purchased_on: X.home.today, receipt_path: 'demo/receipt.jpg', status: 'draft', lines: [
          { line_no: 1, description: 'TOILET TISSUE 12S', qty: 2, match: { item_id: 'd1', name: 'Toilet paper', unit: 'rolls', photo_path: null } },
          { line_no: 2, description: 'LIQ HAND SOAP 500ML', qty: 3, match: { item_id: 'd2', name: 'Hand soap', unit: 'bottles', photo_path: null } },
          { line_no: 3, description: 'SCENTED CANDLE VANILLA', qty: 1, match: null }] } });
        case 'inventory_receipt_confirm_v1': return done({ ok: true, purchase_count: (args && args.p_lines || []).filter(function (l) { return !l.skip; }).length, new_items: [], undo_token: 'demo-undo' });
        case 'staff_inquiry_payments_v1': return done([{}, {}]); // a count of two pending bookings; the rows themselves are never shown
        default: return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'not part of the demo' } });
      }
    }
    var session = function () { return Promise.resolve({ data: { session: view === 'signin' ? null : { access_token: 'demo', user: D().user } } }); };
    return {
      demo: true, rpc: rpc,
      auth: {
        getSession: session,
        signOut: function () { view = 'signin'; return Promise.resolve({ error: null }); },
        // any sign-in works in the demo: the name picked decides the role, and the page reloads as that role
        signInWithPassword: function (cred) {
          var m = /demo\.(cleaner|laundry|finance|admin|owner)@/.exec(String((cred && cred.email) || '')), next = m ? m[1] : 'owner';
          if (root.location && root.document) { root.location.replace(switchUrl(root.location, next, rootPath()) .replace(/#.*$/, '') + '#home'); return new Promise(function () {}); }
          view = next; return Promise.resolve({ data: { user: D().user }, error: null });
        }
      },
      functions: { invoke: function (name, o) {
        toast(NOTE); // memory only: the demo reads no receipt and stores no photo
        var mode = o && o.body && o.body.mode; // s134: the receipt modes of Expenses
        if (name === 'ocr-receipt' && mode === 'attach') return Promise.resolve({ data: { ok: true, receipt_path: 'demo/receipt.jpg', sha256: 'demo', mime: 'image/jpeg', suggest: { amount: 640, date: null, vendor: 'Sample shop', category: 'supplies', line_items: [], confidence: 0.9 }, stock_hint: { count: 0, names: [] } }, error: null });
        if (name === 'ocr-receipt' && mode === 'sign') return Promise.resolve({ data: { ok: true, links: ((o && o.body && o.body.ids) || []).reduce(function (m, k) { m[k] = { url: idPlaceholder(), kind: 'txn', mime: 'image/jpeg' }; return m; }, {}) }, error: null });
        return Promise.resolve({ data: name === 'ocr-receipt' ? { ok: true, draft_id: 'demo-draft' } : { ok: true, path: 'demo/photo.jpg' }, error: null });
      } },
      storage: { from: function () { return { createSignedUrl: function () { return Promise.resolve({ data: { signedUrl: idPlaceholder() }, error: null }); } }; } }
    };
  }

  // ---- fetch: the edge functions the pages call, answered locally. A data: address is the placeholder picture (no network). --------
  function reply(status, o) { return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(o); } }); }
  function demoFetch(url, init) {
    url = String(url);
    if (/^data:/i.test(url)) return typeof root.fetch === 'function' ? root.fetch(url) : reply(200, {});
    var fn = /\/functions\/v1\/([\w-]+)/.exec(url), name = fn && fn[1], body = null, X = build('owner');
    try { body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (e) { body = null; }
    if (name === 'guest-reply-draft') {
      var said = (body && body.text) || 'Hi po, is an early check-in possible tomorrow? We land at 9 in the morning.';
      return reply(200, { ok: true, guest_name: (body && body.guest_name) || 'Demo Guest One', platform: body && body.platform === 'airbnb' ? 'airbnb' : 'messenger', guest_text: said, header: 'Three drafts for you. Copy one and send it yourself.',
        options: [{ label: 'Short', text: 'Hello, check-in starts at 2 in the afternoon. We will tell you if the house is ready sooner.' }, { label: 'Warm', text: 'Good morning, and thank you for letting us know. Check-in starts at 2 in the afternoon. If the house is ready sooner, we will tell you, and your bags are welcome here from the morning.' }, { label: 'With details', text: 'Thank you for the message. We cannot promise an early check-in yet, and we will confirm the morning after the cleaning is done. Your bags are welcome from 9 if you arrive first, and there is shade and water on the porch.' }],
        replies: ['Good morning, and thank you for letting us know. Check-in starts at 2 in the afternoon. If the house is ready sooner, we will tell you, and your bags are welcome here from the morning.',
          'Thank you for the message. We cannot promise an early check-in yet, and we will confirm the morning after the cleaning is done. Your bags are welcome from 9 if you arrive first.'] });
    }
    if (name === 'staff-guest-details') {
      var on = { name: 'Demo Guest One', phone: '', email: '', id_on_file: false, companions: [], guest_id: '00000000-0000-4000-8000-0000000000d1', stay_preferences: noteSeed(CS.manilaToday(new Date())).g1 }, act = body && body.action; // guest_id and stay_preferences are demo-only: the live context does not send them yet
      if (act === 'extract') return reply(200, { ok: true, stay: X.stay, on_file: on, proposal: { phone: '0900-000-0000', email: 'demo.guest.one@example.invalid', guests: 2, nationality: 'Demo', companions: ['Demo Companion One'], ids: [], images: ((body && body.images) || []).map(function () { return 'other'; }) } });
      if (act === 'save') { toast(NOTE); return reply(200, { ok: true, saved: [] }); }
      return reply(200, { ok: true, stay: X.stay, on_file: on });
    }
    if (name === 'notify-cleaner-payment') { toast(NOTE); return reply(200, { ok: true, total: 0, ref: 'CASCADE-DEMO0001' }); }
    if (name === 'upload-photo') return reply(200, { ok: true, path: 'demo/receipt.jpg' });
    if (/manual\/index\.json/.test(url)) return reply(200, [{ title: 'Aircon does not cool', id: 'aircon' }, { title: 'Hot water heater', id: 'heater' }, { title: 'Brownout: what to do', id: 'brownout' }]);
    if (name === 'weather-proxy') {
      var lat = Number(body && body.lat), lon = Number(body && body.lon), here = !!body && body.lat != null && isFinite(lat) && isFinite(lon); // "Here" is a POST body, never a query string
      return reply(200, { source: 'demo', fetched_at: new Date().toISOString(), current: X.home.weather.current, // s112: the same answer, labelled with the place it is for
        place: here ? { label: 'Near you', lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, kind: 'here' } : { label: 'Cascade, Bria Homes, General Santos', lat: 6.1545, lon: 125.1852, kind: 'cascade' } });
    }
    return reply(404, { error: 'not part of the demo' });
  }

  // ---- s112: the demo has no real GPS. The Weather "Here" tab asks this instead: a made-up spot about 3 km from the house, answered after a short pause.
  var geo = { getCurrentPosition: function (ok) { setTimeout(function () { ok({ coords: { latitude: 6.13187, longitude: 125.16422, accuracy: 40 }, timestamp: Date.now() }); }, 300); } };

  // ---- the page furniture: a "Demo data" pill and a role switcher on every screen -------------------------------------------------
  var STYLE = '.demo-bar{position:sticky;top:0;z-index:40;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px;padding:2px 8px;background:var(--card);border-bottom:1px solid var(--border-strong)}' +
    '.demo-roles{display:flex;flex-wrap:wrap;gap:4px}.demo-bar{flex-wrap:nowrap}.demo-bar .pill{min-height:26px;padding:0 6px;flex:none}.demo-roles{flex-wrap:nowrap;gap:2px;overflow-x:auto;max-width:100vw;min-width:0}.demo-roles button{flex:none;white-space:nowrap;min-height:44px;min-width:44px;padding:0 5px;border-radius:var(--r-md);border:1px solid var(--border);background:var(--muted);color:var(--fg);font:600 13px/18px var(--font-ui);cursor:pointer}' +
    '.demo-roles button[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:var(--primary-fg)}.demo-on .appbar{top:var(--demo-h,52px)}';
  var scriptDir = ''; try { if (root.document && root.document.currentScript) scriptDir = new URL('./', root.document.currentScript.src).pathname; } catch (e) {}
  function rootPath() { return scriptDir || '/'; }

  function mount() {
    var doc = root.document; if (!doc || !active || doc.getElementById('demo-bar')) return;
    var role = roleFrom(root.location.search), em = emptyFrom(root.location.search), keep = em ? '&empty' + (em === 'none' ? '=none' : '') : '', st = doc.createElement('style'), bar = doc.createElement('div');
    st.textContent = STYLE; doc.head.appendChild(st);
    bar.id = 'demo-bar'; bar.className = 'demo-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Demo controls'); bar.innerHTML = barHtml(role);
    doc.body.insertBefore(bar, doc.body.firstChild); doc.documentElement.classList.add('demo-on');
    var size = function () { doc.documentElement.style.setProperty('--demo-h', bar.offsetHeight + 'px'); }; size(); root.addEventListener('resize', size);
    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-demo-role]'); if (!b) return;
      root.location.assign(switchUrl(root.location, b.getAttribute('data-demo-role'), rootPath()));
    });
    // every in-app link keeps ?demo&role=, including the ones the app draws later
    var fix = function () { Array.prototype.forEach.call(doc.querySelectorAll('a[href]'), function (a) { var h = demoHref(a.getAttribute('href'), role, keep); if (h) a.setAttribute('href', h); }); }, queued = false;
    fix();
    new MutationObserver(function () { if (queued) return; queued = true; (root.requestAnimationFrame || root.setTimeout)(function () { queued = false; fix(); }); }).observe(doc.body, { childList: true, subtree: true });
  }
  if (active && root.document) { if (root.document.body) mount(); else root.document.addEventListener('DOMContentLoaded', mount); }

  return {
    active: active, ROLES: ROLES, VIEWS: VIEWS, NOTE: NOTE, WRITES: WRITES, isDemo: isDemo, roleFrom: roleFrom, emptyFrom: emptyFrom, role: function () { return roleFrom(root.location && root.location.search); },
    onNote: function (fn) { hook = fn; }, demoHref: demoHref, switchUrl: switchUrl, barHtml: barHtml, build: build, noteSeed: noteSeed, client: client, fetch: demoFetch, toast: toast, idPlaceholder: idPlaceholder, geo: geo
  };
});
