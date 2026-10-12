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
  var ROLES = ['owner', 'admin', 'cleaner'], VIEWS = ['owner', 'admin', 'cleaner', 'signin'];
  var NOTE = 'Demo: nothing was saved';

  // ---- the one guard -----------------------------------------------------------------------------------------------------
  function isDemo(search) {
    try { var p = new URLSearchParams(String(search || '')); return p.has('demo') && !/^(0|false|no|off)$/i.test(p.get('demo') || ''); } catch (e) { return false; }
  }
  function roleFrom(search) {
    try { var r = new URLSearchParams(String(search || '')).get('role'); return VIEWS.indexOf(r) >= 0 ? r : 'owner'; } catch (e) { return 'owner'; }
  }
  var active = isDemo(root.location && root.location.search);

  // ---- links: keep ?demo&role= on every in-app link so a click never leaves demo mode ---------------------------------------
  // null = leave the link alone (an anchor on the page, another site, a tg: or mailto: link, or already a demo link).
  function demoHref(href, role) {
    href = String(href == null ? '' : href);
    if (!href || href.charAt(0) === '#' || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
    var h = href.indexOf('#'), hash = h >= 0 ? href.slice(h) : '', rest = h >= 0 ? href.slice(0, h) : href;
    if (/[?&]demo(=|&|$)/.test(rest)) return null;
    return rest + (rest.indexOf('?') >= 0 ? '&' : '?') + 'demo&role=' + role + hash;
  }
  // Where the role switcher goes: the same screen on the app root, else the app home.
  function switchUrl(loc, role, rootPath) {
    var onRoot = loc.pathname === rootPath || loc.pathname === rootPath + 'index.html';
    return rootPath + '?demo&role=' + role + (onRoot ? loc.hash || '' : '#home');
  }
  var LABEL = { owner: 'Owner', admin: 'Admin', cleaner: 'Cleaner', signin: 'Sign in' };
  function barHtml(role) {
    return '<span class="pill p-brand demo-pill">Demo data</span><div class="demo-roles" role="group" aria-label="View as">' +
      VIEWS.map(function (v) { return '<button type="button" data-demo-role="' + v + '" aria-pressed="' + (v === role) + '">' + LABEL[v] + '</button>'; }).join('') + '</div>';
  }

  // ---- a calm "nothing was saved" note: the same element the app uses for Copied (id cs-toast) -------------------------------
  var timer = 0, hook = null; // hook: tests listen for the note
  function toast(msg) {
    if (hook) hook(msg || NOTE);
    var doc = root.document; if (!doc) return;
    var t = doc.getElementById('cs-toast');
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
  function build(role, now) {
    var r = role === 'cleaner' || role === 'admin' ? role : 'owner', admin = r !== 'cleaner', today = CS.manilaToday(now), stamp = (now instanceof Date ? now : new Date()).toISOString();
    var d = function (n) { return CS.addDays(today, n); }, at = function (n, hm) { return d(n) + 'T' + hm + ':00+08:00'; };
    var guest = function (o) { // the server sends a cleaner no companions, phone, e-mail or Messenger link
      if (!admin) { delete o.companions; delete o.phone; delete o.email; delete o.messenger; }
      return o;
    };
    var g1 = guest({ uid: 'demo-stay-1', guest_name: 'Demo Guest One', checkin_date: d(-1), checkout_date: d(2), checkin_time: '14:00:00', checkout_time: '11:00:00', nights: 3, source: 'airbnb',
      repeat: true, stay_count: 2, earlier_stays: [{ month: d(-120).slice(0, 7), nights: 2 }], notes: d(-120) + ': Special request: extra pillows | Courtesy: late check-out was offered',
      id_photo_path: 'demo/id-1', companions: [{ name: 'Demo Companion One', has_photo: true }, { name: 'Demo Companion Two', has_photo: false }],
      phone: '0900-000-0000', email: 'demo.guest.one@example.invalid', messenger: {} });
    var g2 = guest({ uid: 'demo-stay-2', guest_name: 'Demo Guest Two', checkin_date: d(2), checkout_date: d(5), checkin_time: '15:00:00', checkout_time: '11:00:00', nights: 3, source: 'direct',
      repeat: false, stay_count: 1, earlier_stays: [], notes: null, id_photo_path: null, companions: [], phone: '0900-000-0001', email: 'demo.guest.two@example.invalid' });
    var row = function (name, a, b, src) { return { guest_name: name, checkin_date: d(a), checkout_date: d(b), status: 'confirmed', source: src }; };
    var block = function (a, b, why, label) { return { guest_name: null, checkin_date: d(a), checkout_date: d(b), status: 'blocked', source: 'manual', block_reason: why, block_label: label }; };
    var home = {
      today: today, generated_at: stamp,
      weather: { fetched_at: stamp, current: { temp: 29, emoji: '', description: 'Partly cloudy', rain_prob: 40, today_high: 32, today_low: 26, humidity: 70, uv_label: 'High' } },
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
      home: home,
      tasks: function (includeDone) { return { ok: true, manager: admin, today: today, tasks: all.filter(function (t) { return (includeDone || t.status !== 'done') && (admin || mine(t)); }) }; },
      assignees: { ok: true, staff: [{ user_id: 'demo-u-1', label: 'Demo Cleaner', role: 'cleaner' }, { user_id: 'demo-u-2', label: 'Demo Admin', role: 'admin' }] },
      rates: { ok: true, today: today,
        in_force: { effective_from: d(-90), regular_rate: 400, general_rate: 800, transport_rate: 100, note: 'Demo rate' },
        next: { effective_from: d(30), regular_rate: 420, general_rate: 840, transport_rate: 100, note: 'Demo rate change' },
        history: [{ effective_from: d(30), regular_rate: 420, general_rate: 840, transport_rate: 100, note: 'Demo rate change' }, { effective_from: d(-90), regular_rate: 400, general_rate: 800, transport_rate: 100, note: 'Demo rate' },
          { effective_from: d(-400), regular_rate: 350, general_rate: 700, transport_rate: null, note: 'Demo first rate' }] },
      signin: [{ label: 'Demo Cleaner', handle: 'demo.cleaner@staff.cascade.invalid', kind: 'pin' }, { label: 'Demo Admin', handle: 'demo.admin@example.invalid', kind: 'password' }, { label: 'Demo Owner', handle: 'demo.owner@example.invalid', kind: 'password' }],
      pay: { ok: true, sessions: [{ id: 'demo-s1', date: d(-3), type: 'turnover', base: 400, transport: 100, guest: 'Demo Guest Zero' }, { id: 'demo-s2', date: d(-1), type: 'deep_clean', base: 800, transport: null }],
        claims: [{ id: 'demo-c1', date: d(-2), description: 'Demo: dish soap for the kitchen', amount: 35 }], missing_reports: [d(-6)],
        requests: [{ total: 450, ref: 'CASCADE-DEMO001', created_at: d(-9) + 'T10:00:00Z', status: 'paid', paid_at: d(-8) + 'T10:00:00Z' }] },
      stay: { guest_name: 'Demo Guest One', checkin: d(-1), checkout: d(2) }
    };
  }

  // ---- the stand-in for the Supabase client: same four calls the pages make, answered from the fixtures ---------------------------
  var WRITES = ['calendar_day_flag_set_v1', 'calendar_day_flag_clear_v1', 'ack_verifier_finding_v1', 'task_set_done_v1', 'task_add_reminder_v1', 'admin_add_pay_rate_v1'];
  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
  function client(role, now) {
    var view = VIEWS.indexOf(role) >= 0 ? role : 'owner', D = function () { return build(view, now); };
    var done = function (data) { return Promise.resolve({ data: clone(data), error: null }); };
    function rpc(name, args) {
      var X = D();
      if (WRITES.indexOf(name) >= 0) { toast(NOTE); return done({ ok: true }); } // nothing changes; the next read returns the same fixtures
      switch (name) {
        case 'current_staff_access': return done(X.access);
        case 'staff_home_v1': return done(X.home);
        case 'tasks_list_v1': return done(X.tasks(!!(args && args.p_include_done)));
        case 'task_assignees_v1': return done(X.assignees);
        case 'admin_pay_rates_v1': return done(X.rates);
        case 'staff_pay_candidates_v1': return done(X.pay);
        case 'staff_signin_list_v1': return done(X.signin);
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
          var m = /demo\.(cleaner|admin|owner)@/.exec(String((cred && cred.email) || '')), next = m ? m[1] : 'owner';
          if (root.location && root.document) { root.location.replace(switchUrl(root.location, next, rootPath()) .replace(/#.*$/, '') + '#home'); return new Promise(function () {}); }
          view = next; return Promise.resolve({ data: { user: D().user }, error: null });
        }
      },
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
      var said = (body && body.text) || 'Hi! Is an early check-in possible tomorrow? We land at 9 in the morning.';
      return reply(200, { ok: true, guest_name: (body && body.guest_name) || 'Demo Guest One', platform: body && body.platform === 'airbnb' ? 'airbnb' : 'messenger', guest_text: said, header: 'Two drafts for you. Copy one and send it yourself.',
        replies: ['Good morning, and thank you for letting us know. Check-in starts at 2 in the afternoon. If the house is ready sooner, we will tell you, and your bags are welcome here from the morning.',
          'Thank you for the message. We cannot promise an early check-in yet, and we will confirm the morning after the cleaning is done. Your bags are welcome from 9 if you arrive first.'] });
    }
    if (name === 'staff-guest-details') {
      var on = { name: 'Demo Guest One', phone: '', email: '', id_on_file: false, companions: [] }, act = body && body.action;
      if (act === 'extract') return reply(200, { ok: true, stay: X.stay, on_file: on, proposal: { phone: '0900-000-0000', email: 'demo.guest.one@example.invalid', guests: 2, nationality: 'Demo', companions: ['Demo Companion One'], ids: [], images: ((body && body.images) || []).map(function () { return 'other'; }) } });
      if (act === 'save') { toast(NOTE); return reply(200, { ok: true, saved: [] }); }
      return reply(200, { ok: true, stay: X.stay, on_file: on });
    }
    if (name === 'notify-cleaner-payment') { toast(NOTE); return reply(200, { ok: true, total: 0, ref: 'CASCADE-DEMO0001' }); }
    if (name === 'upload-photo') return reply(200, { ok: true, path: 'demo/receipt.jpg' });
    if (name === 'weather-proxy') return reply(200, { source: 'demo', fetched_at: new Date().toISOString(), current: X.home.weather.current });
    return reply(404, { error: 'not part of the demo' });
  }

  // ---- the page furniture: a "Demo data" pill and a role switcher on every screen -------------------------------------------------
  var STYLE = '.demo-bar{position:sticky;top:0;z-index:40;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px;padding:2px 8px;background:var(--card);border-bottom:1px solid var(--border-strong)}' +
    '.demo-roles{display:flex;flex-wrap:wrap;gap:4px}.demo-roles button{min-height:44px;min-width:44px;padding:0 8px;border-radius:var(--r-md);border:1px solid var(--border);background:var(--muted);color:var(--fg);font:600 13px/18px var(--font-ui);cursor:pointer}' +
    '.demo-roles button[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:var(--primary-fg)}.demo-on .appbar{top:var(--demo-h,52px)}';
  var scriptDir = ''; try { if (root.document && root.document.currentScript) scriptDir = new URL('./', root.document.currentScript.src).pathname; } catch (e) {}
  function rootPath() { return scriptDir || '/'; }

  function mount() {
    var doc = root.document; if (!doc || !active || doc.getElementById('demo-bar')) return;
    var role = roleFrom(root.location.search), st = doc.createElement('style'), bar = doc.createElement('div');
    st.textContent = STYLE; doc.head.appendChild(st);
    bar.id = 'demo-bar'; bar.className = 'demo-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Demo controls'); bar.innerHTML = barHtml(role);
    doc.body.insertBefore(bar, doc.body.firstChild); doc.documentElement.classList.add('demo-on');
    var size = function () { doc.documentElement.style.setProperty('--demo-h', bar.offsetHeight + 'px'); }; size(); root.addEventListener('resize', size);
    bar.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-demo-role]'); if (!b) return;
      root.location.assign(switchUrl(root.location, b.getAttribute('data-demo-role'), rootPath()));
    });
    // every in-app link keeps ?demo&role=, including the ones the app draws later
    var fix = function () { Array.prototype.forEach.call(doc.querySelectorAll('a[href]'), function (a) { var h = demoHref(a.getAttribute('href'), role); if (h) a.setAttribute('href', h); }); }, queued = false;
    fix();
    new MutationObserver(function () { if (queued) return; queued = true; (root.requestAnimationFrame || root.setTimeout)(function () { queued = false; fix(); }); }).observe(doc.body, { childList: true, subtree: true });
  }
  if (active && root.document) { if (root.document.body) mount(); else root.document.addEventListener('DOMContentLoaded', mount); }

  return {
    active: active, ROLES: ROLES, VIEWS: VIEWS, NOTE: NOTE, WRITES: WRITES, isDemo: isDemo, roleFrom: roleFrom, role: function () { return roleFrom(root.location && root.location.search); },
    onNote: function (fn) { hook = fn; }, demoHref: demoHref, switchUrl: switchUrl, barHtml: barHtml, build: build, client: client, fetch: demoFetch, toast: toast, idPlaceholder: idPlaceholder
  };
});
