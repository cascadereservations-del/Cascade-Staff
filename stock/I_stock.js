/* Cascade Staff - native Inventory screen (lane I, session 82). Plain script, no build step.
   Mounted by the shell as window.I_Stock.mount(el, { client, demo, role, sub, navigate, toast, haptic, propertyId? }).
   Money rule: a cleaner never sees or keeps a cost. normalize() never reads unitCost for any role but owner/admin/finance.
   Every write: a confirm step, one idempotency key per confirmed set of values (kept across a retry), a disabled button while
   sending, a toast, a refreshed list. Offline is an inline line, never a queue. */
(function (root) {
  'use strict';

  var PROPERTY_ID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'; // same constant as the shell's CFG.propertyId; opts.propertyId wins
  var DEMO_NOTE = 'Demo only, nothing was saved.';
  // Owner decision 2026-10-13: counts move to the app (a first count is one-way); Used some stays off (it would double the checklist supply log). Read once; the test hook is window.I_STOCK_FLAGS.
  var I_FLAGS = { count: true, usage: false };
  if (root.I_STOCK_FLAGS) { I_FLAGS.count = !!root.I_STOCK_FLAGS.count; I_FLAGS.usage = !!root.I_STOCK_FLAGS.usage; }

  /* ------------------------------------------------------------------ pure helpers (exported as I_Stock.lib) */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = typeof v === 'number' ? v : (v == null || v === '' ? NaN : parseFloat(v)); return isFinite(n) ? n : null; }
  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
  function canManage(role) { return role === 'owner' || role === 'admin'; }
  function canPrice(role) { return role === 'owner' || role === 'admin' || role === 'finance'; } // the server sends unitCost only to these three
  function canUse(role) { return role === 'cleaner'; } // record_inventory_usage needs submit_cleaning
  function manilaToday(ms) { return new Date(ms + 8 * 3600000).toISOString().slice(0, 10); }
  function dateLabel(iso) { var a = String(iso || '').slice(0, 10).split('-'); return a.length === 3 && +a[1] ? MONTHS[+a[1] - 1] + ' ' + +a[2] : ''; }
  function peso(n) { var v = Math.round(Number(n) * 100) / 100; return '₱' + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // One catalogue row to the shape the screen keeps. unitCost is read ONLY for owner/admin; for anyone else the key is never touched.
  function normalize(raw, role) {
    var it = {
      id: String(raw.id), name: String(raw.name || ''), category: String(raw.category || 'Other'), unit: String(raw.unit || ''),
      qty: num(raw.qty), reorder: num(raw.reorderBelow), consumable: !!raw.consumable, active: raw.active !== false,
      purchaseUnit: raw.purchaseUnit ? String(raw.purchaseUnit) : null, perPack: num(raw.unitsPerPurchase) || 1,
      cover: num(raw.coverageDays), coverEst: num(raw.estCoverageDays), controlled: !!raw.movementControlled,
      counted: raw.countedAt ? String(raw.countedAt) : null, par: num(raw.par), codes: Array.isArray(raw.codes) ? raw.codes.map(String) : []
    };
    if (canPrice(role)) it.cost = num(raw.unitCost);
    return it;
  }
  function normalizeCatalogue(data, role) {
    var list = data && data.items;
    if (!Array.isArray(list)) return null;
    return list.map(function (r) { return normalize(r, role); }).filter(function (i) { return i.active && i.name; });
  }
  function level(it) { if (it.qty != null && it.qty <= 0) return 'out'; if (it.reorder != null && it.qty != null && it.qty <= it.reorder) return 'low'; return 'ok'; }
  var LEVELS = { out: { word: 'Out', glyph: '✕' }, low: { word: 'Low', glyph: '▲' }, ok: { word: 'OK', glyph: '✓' } };
  var RANK = { out: 0, low: 1, ok: 2 };
  function byName(a, b) { return a.name.localeCompare(b.name); }
  function summary(items) { var low = 0, out = 0; items.forEach(function (i) { var l = level(i); if (l === 'out') out++; else if (l === 'low') low++; }); return { low: low + out, out: out }; }
  function chipsFor(items) {
    var cats = {}, list = [{ k: 'low', t: 'Low first' }, { k: 'all', t: 'All' }, { k: 'cons', t: 'Consumables' }];
    items.forEach(function (i) { cats[i.category] = 1; });
    Object.keys(cats).sort().forEach(function (c) { list.push({ k: 'c:' + c, t: c }); });
    return list;
  }
  // Needs a count (s84 1b): a consumable never counted in the app, or not for 30 days. Only meaningful when the catalogue says when (countedAt).
  function needsCount(it) { return !!(K.hasCounted && it.consumable && (!it.counted || nowMs() - Date.parse(it.counted) > 30 * 86400000)); }
  function visible(items, chip, q) {
    var s = String(q || '').trim().toLowerCase(), out = items.filter(function (i) {
      if (s && i.name.toLowerCase().indexOf(s) < 0) return false;
      if (chip === 'cons') return i.consumable;
      if (chip === 'need') return needsCount(i);
      if (chip.indexOf('c:') === 0) return i.category === chip.slice(2);
      return true;
    });
    return chip === 'all' || chip === 'need' || chip.indexOf('c:') === 0 ? out.sort(byName) : out.sort(function (a, b) { return RANK[level(a)] - RANK[level(b)] || byName(a, b); });
  }
  // Groups for the list (s84). Low first: worst group first (an Out, then a Low, then all OK), then more Out+Low, then name; inside a group Out, Low, OK, name.
  // All / Consumables: groups by category name, rows by name. A category chip is one group (the screen draws no header for it).
  function groupsFor(items, chip, q) {
    var rows = visible(items, chip, q), by = {}, order = [];
    rows.forEach(function (i) { if (!by[i.category]) { by[i.category] = { cat: i.category, rows: [], low: 0, out: 0 }; order.push(i.category); } var g = by[i.category], l = level(i); g.rows.push(i); if (l === 'out') g.out++; else if (l === 'low') g.low++; });
    var gs = order.map(function (c) { return by[c]; });
    var worst = function (g) { return g.out ? 0 : g.low ? 1 : 2; };
    if (chip === 'low') gs.sort(function (a, b) { return worst(a) - worst(b) || (b.out + b.low) - (a.out + a.low) || a.cat.localeCompare(b.cat); });
    else gs.sort(function (a, b) { return a.cat.localeCompare(b.cat); });
    if (chip === 'cons') gs.forEach(function (g) { g.rows.sort(byName); });
    return gs;
  }
  // Barcodes (s84): printable ASCII, no spaces, 1 to 128 characters (the server check). Spaces typed inside a code are dropped.
  function normCode(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }
  function validCode(c) { return /^[!-~]{1,128}$/.test(c); }
  function codeIndex(items) { var m = {}; (items || []).forEach(function (i) { (i.codes || []).forEach(function (c) { m[normCode(c)] = i.id; }); }); return m; }
  function shortCode(c) { return c.length > 14 ? c.slice(0, 12) + '…' : c; }
  function barPct(it) { return it.reorder == null || it.reorder <= 0 || it.qty == null ? null : Math.max(0, Math.min(100, Math.round(it.qty / (it.reorder * 2) * 100))); } // the tick sits at 50 = the reorder point

  // Quantity the person typed: digits with at most two decimals (a comma counts as the point). null when it is not one.
  function parseQty(s, allowZero) {
    var t = String(s == null ? '' : s).trim().replace(',', '.');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
    var n = parseFloat(t);
    return n > 0 || (allowZero && n === 0) ? n : null;
  }
  function stepQty(s, dir, allowZero) {
    var n = num(String(s).replace(',', '.')); if (n == null) n = 0;
    n = Math.round((n + dir) * 100) / 100;
    return fmt(Math.max(allowZero ? 0 : 1, n));
  }
  function newKey(kind, rnd) { // 16 to 160 characters; random, never the clock
    var r = rnd || (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    return 'stk-' + kind + '-' + String(r).replace(/-/g, '');
  }
  function errKind(e, online) {
    if (online === false) return 'offline';
    if (!e) return 'other';
    var code = String(e.code || ''), msg = String(e.message || ''), st = e.status || (e.context && e.context.status);
    if (code === '42501' || st === 401 || st === 403 || /not authori[sz]ed|permission denied|access denied|denied/i.test(msg)) return 'refused';
    if (code === 'PGRST202' || code === '42883' || st === 404 || /could not find the function|does not exist/i.test(msg)) return 'missing';
    if (/insufficient stock/i.test(msg)) return 'short';
    if (/reconciliation required/i.test(msg)) return 'recon';
    if (!code && !st && (e.name === 'TypeError' || e.name === 'FunctionsFetchError' || /failed to fetch|network|load failed|fetch/i.test(msg))) return 'offline';
    return 'other';
  }
  var ERR = {
    offline: 'No connection, so nothing was sent.',
    refused: 'This is not available to you. Ask the owner if you need it.',
    missing: 'This is not available right now.',
    short: 'There is less on hand than that. Try a smaller amount.',
    recon: 'This item needs a fresh count first. Please tell the owner.',
    other: 'That did not go through. Try again in a moment.',
    badcode: 'That does not look like a barcode. Check the digits under it.',
    nocam: 'The camera is off for this app. You can type the code instead.',
    camfail: 'The camera did not start. You can type the code instead.',
    exists: 'An item with that name already exists.',
    financeOnly: 'Finance lists are not open to you right now. The OPS list has no prices.',
    levels: 'Buy up to should be the same as or more than the reorder level.',
    tooLate: 'This can no longer be undone here. Count the item to correct it.'
  };
  var REPORTS = [{ k: 'order', t: 'Order list', s: 'the order list' }, { k: 'all', t: 'All items', s: 'the full item list' }, { k: 'consumables', t: 'Consumables', s: 'the consumables list' }, { k: 'low', t: 'Low stock', s: 'the low-stock list' }, { k: 'misc', t: 'Miscellaneous', s: 'the miscellaneous list' }];
  var COOL_MS = 30000; // a sent report cannot be sent again to the same group for 30 seconds

  // Argument builders: the exact RPC names and keys the dashboard uses (api.ts). `vals` are the strings from the form, already validated.
  function countCall(it, v, key) {
    return { fn: 'reconcile_inventory_baseline_v1', args: { p_item_id: it.id, p_counted_qty: parseQty(v.qty, true), p_note: noteOf(v.note), p_idempotency_key: key } };
  }
  function noteOf(n) { var t = String(n || '').trim().slice(0, 200); return t.length >= 3 ? t : 'Counted in the staff app'; } // the server needs 3 characters
  function usageCall(pid, it, v, key, today) {
    return { fn: 'record_inventory_usage', args: { p_property_id: pid, p_session_date: today, p_logged_by: null, p_notes: 'Logged in the staff app', p_rows: [{ item_id: it.id, used_qty: parseQty(v.qty), usage_key: key }] } };
  }
  function receiptCall(it, v, key, today) {
    var cost = String(v.cost || '').trim() === '' ? null : parseQty(v.cost), sup = String(v.supplier || '').trim().slice(0, 80);
    return { fn: 'record_inventory_receipt_v1', args: { p_item_id: it.id, p_packs: parseQty(v.packs), p_unit_cost: cost, p_supplier: sup || null, p_purchased_at: today, p_receipt_path: null, p_shopping_list_id: v.shopId || null, p_idempotency_key: key } };
  }
  // s84: barcode, price, levels, new item, report. Exact names and keys from SPEC-inventory 3.5 and 4.1.
  function attachCall(pid, it, code, format) { return { fn: 'inventory_code_attach_v1', args: { p_property_id: pid, p_code: code, p_format: format || null, p_item_id: it.id } }; }
  function priceCall(it, v) { var c = String(v.cost || '').trim() === '' ? null : parseQty(v.cost); return { fn: 'inventory_item_price_set_v1', args: { p_item_id: it.id, p_unit_cost: c } }; }
  function levelsCall(it, v) { var r = String(v.reorder || '').trim(), p = String(v.par || '').trim(); return { fn: 'inventory_item_update_v1', args: { p_item_id: it.id, p_patch: { reorder_below: r === '' ? null : parseQty(r, true), par_qty: p === '' ? null : parseQty(p, true) } } }; }
  function createCall(pid, v, code, format, key) {
    var item = { name: String(v.name || '').trim(), category: String(v.category || '').trim(), unit: String(v.unit || '').trim() || 'pc', consumable: v.cons === 'yes' };
    if (String(v.reorder || '').trim() !== '') item.reorder_below = parseQty(v.reorder, true);
    if (String(v.qty || '').trim() !== '') item.qty = parseQty(v.qty, true);
    return { fn: 'inventory_item_create_v1', args: { p_property_id: pid, p_item: item, p_code: code || null, p_format: format || null, p_idempotency_key: key } };
  }
  function reportCall(v) { return { invoke: 'inventory-report', body: { kind: v.rkind, to: v.to } }; }
  function optQty(s) { return String(s == null ? '' : s).trim() === '' || parseQty(s, true) != null; }
  function shopAddCall(pid, it, v, key) {
    return { fn: 'save_shopping_item_v1', args: { p_property_id: pid, p_item: { item_id: it.id, item_name: it.name, quantity: parseQty(v.qty), purchase_unit: it.purchaseUnit, reason: String(v.note || '').trim().slice(0, 200) || null }, p_idempotency_key: key } };
  }
  function shopSetCall(pid, row, status, key) {
    return { fn: 'save_shopping_item_v1', args: { p_property_id: pid, p_item: { id: row.id, status: status }, p_idempotency_key: key } };
  }
  function normalizeShop(rows, uid) {
    return (rows || []).filter(function (r) { return r && (r.status === 'proposed' || r.status === 'approved'); }).map(function (r) {
      return { id: String(r.id), itemId: r.item_id || null, name: String(r.item_name || ''), qty: num(r.quantity), unit: r.purchase_unit ? String(r.purchase_unit) : '', note: r.reason ? String(r.reason) : '', status: r.status, at: String(r.proposed_at || ''), mine: !!(uid && r.proposed_by && r.proposed_by === uid) };
    });
  }

  /* ------------------------------------------------------------------ demo sample (no network) */
  function demoItems() {
    var d = function (id, name, cat, unit, qty, re, cons, cost, pu, pp) { return { id: id, name: name, category: cat, unit: unit, qty: qty, reorderBelow: re, consumable: cons, active: true, unitCost: cost, purchaseUnit: pu || null, unitsPerPurchase: pp || 1, estCoverageDays: re ? Math.round(qty / re * 10) : null, par: re && cons ? re * 2 : null, countedAt: id === 'd1' ? '2026-10-02T03:00:00Z' : id === 'd2' || id === 'd4' ? '2026-10-10T03:00:00Z' : id === 'd6' ? '2026-08-01T03:00:00Z' : null, codes: id === 'd1' ? ['4800000000011'] : id === 'd3' ? ['4800000000028'] : [] }; };
    return [
      d('d1', 'Toilet paper', 'Bathroom', 'rolls', 4, 12, true, 18, 'pack', 12), d('d2', 'Bath towels', 'Linen', 'pieces', 14, 10, false, 220),
      d('d3', 'Hand soap', 'Bathroom', 'bottles', 0, 3, true, 95), d('d4', 'Dish soap', 'Kitchen', 'bottles', 5, 2, true, 80),
      d('d5', 'Trash bags', 'Cleaning', 'rolls', 2, 4, true, 60, 'pack', 4), d('d6', 'Coffee pods', 'Kitchen', 'pods', 36, 20, true, 14),
      d('d7', 'Bed sheets (queen)', 'Linen', 'sets', 6, 4, false, 650), d('d8', 'Floor cleaner', 'Cleaning', 'bottles', 3, 2, true, 120),
      d('d9', 'Shampoo sachets', 'Bathroom', 'sachets', 40, 24, true, 6), d('d10', 'Sponges', 'Cleaning', 'pieces', 9, 6, true, 15),
      d('d11', 'Light bulbs', 'Maintenance', 'pieces', 3, 2, false, 150), d('d12', 'Drinking water', 'Kitchen', 'gallons', 1, 2, true, 40)
    ];
  }
  function demoShop() { return [{ id: 's1', item_id: 'd3', item_name: 'Hand soap', quantity: 6, purchase_unit: 'bottles', reason: 'Last one used today', status: 'proposed', proposed_at: '2026-10-12T02:00:00Z', proposed_by: 'someone' }, { id: 's2', item_id: 'd1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: '', status: 'approved', proposed_at: '2026-10-11T02:00:00Z', proposed_by: 'someone' }]; }

  /* ------------------------------------------------------------------ screen */
  var K = { items: null, shop: null, q: '', chip: 'low', role: null, at: 0, keys: {}, v84: false, lastCode: '', cool: {}, scanned: null, denied: {}, noFinance: false, undos: [], uidn: 0, hasCounted: false }; // denied: actions the server refused or lacks, hidden for the whole visit (a re-mount keeps them) // survives unmount: the list shows at once while it refreshes
  var M = null; // the live mount

  function mount(el, opts) {
    unmount();
    opts = opts || {};
    var prevRole = K.role;
    if (K.role !== opts.role) { K.role = opts.role; K.items = null; K.shop = null; K.q = ''; K.chip = 'low'; K.at = 0; K.keys = {}; K.v84 = false; K.lastCode = ''; K.cool = {}; K.scanned = null; K.denied = {}; K.noFinance = false; K.undos = []; K.hasCounted = false; if (prevRole !== null) recentClear(); } // a cached list is never shown to another role
    M = {
      el: el, opts: opts, role: opts.role, demo: !!opts.demo, client: opts.client || null, pid: opts.propertyId || PROPERTY_ID,
      sub: String(opts.sub || ''), act: null, hist: {}, denied: K.denied, uid: null, loadErr: null, shopErr: null, loading: false, offlineStale: false, itemInfo: {}, listeners: []
    };
    el.innerHTML = '<div class="I_wrap"><div data-i-top></div><div data-i-list></div><div data-i-undo class="I_undoslot"></div><div data-i-layer></div><div class="I_live sr" role="status" aria-live="polite" data-i-live></div></div>';
    var on = function (type, fn) { el.addEventListener(type, fn); M.listeners.push([type, fn]); };
    on('click', onClick); on('input', onInput); on('submit', onSubmit); on('keydown', onKey); on('focusin', onFocus); on('focusout', onBlur);
    M.vis = function () { if (M && root.document && root.document.hidden && M.cam) pauseCam(); };
    if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', M.vis);
    if (M.demo) { K.items = demoItems().map(function (r) { return normalize(r, M.role); }); K.shop = normalizeShop(demoShop(), null); K.v84 = true; K.hasCounted = true; }
    else if (M.client && M.client.auth && M.client.auth.getSession) { try { M.client.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; M.uid = s && s.user ? s.user.id : null; }, function () {}); } catch (e) { /* no uid: rows read "Asked by staff" */ } }
    draw();
    if (!M.demo && !(K.items && K.at && nowMs() - K.at < 60000)) load(); // a fresh list for this role is kept when only the sub-route changed
    else if (!M.demo) loadShopSoon();
    return M;
  }
  function unmount() {
    if (!M) return;
    M.listeners.forEach(function (l) { M.el.removeEventListener && M.el.removeEventListener(l[0], l[1]); });
    if (M.undoT && root.clearTimeout) root.clearTimeout(M.undoT);
    stopCam(); if (root.document && root.document.removeEventListener && M.vis) root.document.removeEventListener('visibilitychange', M.vis);
    M.dead = true; M = null;
  }

  function q(sel) { return M && M.el.querySelector(sel); }
  function say(t) { var n = q('[data-i-live]'); if (n) n.textContent = t; }
  function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  function nowMs() { return Date.now(); }

  /* ---- loading */
  function load() {
    if (!M || M.loading) return;
    var me = M; me.loading = true;
    if (!online()) { me.loading = false; if (K.items) { me.offlineStale = true; } else me.loadErr = 'offline'; draw(); return; }
    if (!me.client) { me.loading = false; me.loadErr = 'missing'; draw(); return; }
    me.loadErr = null; me.offlineStale = false;
    Promise.resolve().then(function () { return me.client.rpc('get_inventory_catalogue_v1', { p_property_id: me.pid }); }).then(function (r) {
      if (me.dead) return;
      var items = r && !r.error ? normalizeCatalogue(r.data, me.role) : null;
      if (items) { K.items = items; K.v84 = r.data.items.some(function (x) { return x && 'codes' in x; }); K.hasCounted = r.data.items.some(function (x) { return x && 'countedAt' in x; }); K.at = nowMs(); me.loadErr = null; me.offlineStale = false; }
      else if (K.items) me.offlineStale = true;
      else me.loadErr = errKind(r && r.error, online()) === 'offline' ? 'offline' : 'unavailable';
    }, function (e) {
      if (me.dead) return;
      if (K.items) me.offlineStale = true; else me.loadErr = errKind(e, online()) === 'offline' ? 'offline' : 'unavailable';
    }).then(function () { if (me.dead) return; me.loading = false; draw(); loadShop(); });
  }
  function loadShopSoon() { var me = M; if (me && !K.shop) loadShop(); }
  function loadShop() {
    var me = M; if (!me || me.demo || !me.client || me.loadErr) return;
    var run = function () { return me.client.from('inventory_shopping_list').select('id,item_id,item_name,quantity,purchase_unit,reason,status,proposed_by,proposed_at').eq('property_id', me.pid).in('status', ['proposed', 'approved']).order('proposed_at', { ascending: false }).limit(100); };
    Promise.resolve().then(run).then(function (r) {
      if (me.dead) return;
      if (r && !r.error) { K.shop = normalizeShop(r.data, me.uid); me.shopErr = null; } else me.shopErr = true;
      draw();
    }, function () { if (!me.dead) { me.shopErr = true; draw(); } });
  }
  function loadLastCount(id) {
    var me = M; if (!me || me.demo || !me.client || !canManage(me.role) || me.itemInfo[id]) return;
    me.itemInfo[id] = { lastCounted: undefined };
    Promise.resolve().then(function () { return me.client.from('inventory_stock_movements').select('kind,created_at').eq('item_id', id).eq('kind', 'reconcile').order('sequence_no', { ascending: false }).limit(1); }).then(function (r) {
      if (me.dead) return;
      var row = r && !r.error && r.data && r.data[0];
      me.itemInfo[id] = { lastCounted: row ? String(row.created_at) : null, done: true };
      if (me.act && me.act.itemId === id) drawLayer();
    }, function () { /* the line stays out */ });
  }

  /* ---- drawing */
  function itemById(id) { return (K.items || []).filter(function (i) { return i.id === id; })[0] || null; }
  function newMenu(id) { recentAdd(id); var scanned = K.scanned === id; return { kind: 'menu', itemId: id, scanned: scanned }; } // scanned: the right action first
  // Recent items (s84 1b, Q7): the last 5 cards opened, ids only, in localStorage key cs_I_recent. Private mode or a blocked store simply hides it.
  function recentRead() {
    try { var ls = root.localStorage; if (!ls) return []; var o = JSON.parse(ls.getItem('cs_I_recent') || 'null'); return o && o.role === K.role && Array.isArray(o.ids) ? o.ids.map(String).slice(0, 5) : []; } catch (e) { return []; }
  }
  function recentAdd(id) { try { var ls = root.localStorage; if (ls) ls.setItem('cs_I_recent', JSON.stringify({ role: K.role, ids: [String(id)].concat(recentRead().filter(function (x) { return x !== String(id); })).slice(0, 5) })); } catch (e) { /* no store: no recent list */ } }
  function recentClear() { try { if (root.localStorage) root.localStorage.removeItem('cs_I_recent'); } catch (e) { /* nothing to clear */ } }
  function renderRecent() {
    var items = recentRead().map(itemById).filter(Boolean); // an item that left the catalogue is dropped silently
    return items.length ? '<div class="I_recent" role="group" aria-label="Recent items"><span class="I_rl">Recent</span>' + items.map(function (i) { var L = LEVELS[level(i)]; return '<button class="chip I_rc" type="button" data-act="open" data-id="' + esc(i.id) + '">' + esc(i.name) + ' <span aria-hidden="true">' + L.glyph + '</span> ' + L.word + '</button>'; }).join('') + '</div>' : '';
  }
  function route() {
    var m = /^item\/(.+)$/.exec(M.sub);
    return { shopping: M.sub === 'shopping', itemId: m ? m[1] : null };
  }
  function draw() {
    if (!M) return;
    var rt = route(), top = q('[data-i-top]');
    if (!top) return;
    top.innerHTML = renderTop(rt);
    drawList();
    // an item route opens its sheet once the catalogue is here
    if (rt.itemId && K.items && (!M.act || (M.act.itemId !== rt.itemId && M.act.kind !== 'undo'))) { var it = itemById(rt.itemId); if (it) { M.act = newMenu(rt.itemId); loadLastCount(rt.itemId); } }
    if (!rt.itemId && M.act && M.act.itemId) M.act = null;
    drawLayer(); drawUndo();
  }
  function renderTop(rt) {
    var h = '', n = K.shop ? K.shop.length : 0;
    h += '<div class="seg I_tabs" role="group" aria-label="Inventory views">' +
      '<button class="btn btn-secondary" type="button" data-act="tab" data-to="" aria-pressed="' + !rt.shopping + '">Items</button>' +
      '<button class="btn btn-secondary" type="button" data-act="tab" data-to="shopping" aria-pressed="' + rt.shopping + '">Shopping list' + (n ? ' ' + n : '') + '</button></div>';
    if (rt.shopping) return h;
    if (K.items) {
      var s = summary(K.items), needN = canManage(M.role) ? K.items.filter(needsCount).length : 0;
      h += '<section class="card glass I_sum ' + (s.low ? 'I_sumlow' : 'I_sumok') + '" aria-label="Stock summary"><span class="I_g" aria-hidden="true">' + (s.low ? LEVELS.low.glyph : LEVELS.ok.glyph) + '</span><div><div class="I_sumt">' +
        (s.low ? s.low + (s.low === 1 ? ' item low' : ' items low') : 'Stock is fine') + '</div>' + (s.out ? '<div class="help">' + s.out + (s.out === 1 ? ' is' : ' are') + ' out</div>' : '') + (needN ? '<button class="btn btn-ghost I_needbtn" type="button" data-act="chip" data-k="need"><span aria-hidden="true">▲</span> ' + needN + ' need a count</button>' : '') + '</div></section>';
      h += renderRecent();
      h += '<div class="I_srow"><div class="field"><label for="I_q">Search items</label><div class="input"><input id="I_q" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(K.q) + '" placeholder="Toilet paper"></div></div>' +
        (K.v84 ? '<button class="btn btn-secondary I_scanbtn" type="button" data-act="scan"><span aria-hidden="true">▥</span> Scan</button>' : '') + '</div>';
      h += '<div class="row-wrap I_chips" role="group" aria-label="Show">' + (function () { var cs = chipsFor(K.items); if (needN) cs.splice(3, 0, { k: 'need', t: 'Needs a count' }); return cs; })().map(function (c) { return '<button class="chip" type="button" data-act="chip" data-k="' + esc(c.k) + '" aria-pressed="' + (K.chip === c.k) + '">' + esc(c.t) + '</button>'; }).join('') + '</div>';
    }
    return h;
  }
  function drawList() {
    var box = q('[data-i-list]'); if (!box) return;
    var rt = route();
    if (rt.shopping) { box.innerHTML = renderShop(); return; }
    if (!K.items) {
      box.innerHTML = M.loadErr ? renderFail(M.loadErr) : '<p class="help I_load" role="status">Loading the stock list…</p>';
      return;
    }
    var gs = groupsFor(K.items, K.chip, K.q), h = '';
    if (M.offlineStale) h += '<div class="note soon" role="status"><span>No connection. This is the last list we have.</span></div>';
    if (!gs.length) h += '<div class="empty"><p>' + (K.q ? 'Nothing matches that search.' : 'Nothing to show here.') + '</p>' + (K.chip !== 'all' || K.q ? '<button class="btn btn-secondary" type="button" data-act="showall">Show all items</button>' : '') + '</div>';
    else h += gs.map(function (g, n) { return renderGroup(g, n, K.chip.indexOf('c:') !== 0); }).join('');
    if (!M.denied.report) h += '<button class="btn btn-secondary btn-block I_repbtn" type="button" data-act="report">Send a report</button>';
    box.innerHTML = h;
  }
  function renderGroup(g, n, header) {
    var note = g.out || g.low ? '<span class="I_ghn">' + (g.out ? '<span aria-hidden="true">✕</span> ' + g.out + ' out' : '') + (g.out && g.low ? ', ' : '') + (g.low ? '<span aria-hidden="true">▲</span> ' + g.low + ' low' : '') + '</span>' : '';
    return '<section class="I_grp"' + (header ? ' aria-labelledby="I_gh_' + n + '"' : '') + '>' + (header ? '<h3 class="I_gh" id="I_gh_' + n + '"><span>' + esc(g.cat) + '</span>' + note + '</h3>' : '') + '<div class="card list I_list">' + g.rows.map(renderRow).join('') + '</div>' + (header && allowed('count') ? '<button class="btn btn-secondary I_gcount" type="button" data-act="walk" data-cat="' + esc(g.cat) + '" aria-label="Count this group, ' + esc(g.cat) + '">Count this group</button>' : '') + '</section>';
  }
  function renderFail(kind) {
    return '<div class="empty I_fail" role="alert"><p class="hd">' + (kind === 'offline' ? 'No connection' : 'Inventory is not available right now') + '</p>' +
      '<p class="help">' + (kind === 'offline' ? 'Check your signal, then try again.' : 'Nothing is wrong with your account. Try again in a moment.') + '</p><button class="btn btn-primary" type="button" data-act="retry">Try again</button></div>';
  }
  function levelBadge(it) { var l = level(it), L = LEVELS[l]; return '<span class="I_lv I_' + l + '"><span aria-hidden="true">' + L.glyph + '</span> ' + L.word + '</span>'; }
  function renderRow(it) {
    var p = barPct(it);
    return '<button class="rowi I_row" type="button" data-act="open" data-id="' + esc(it.id) + '"><span class="mid"><span class="t">' + esc(it.name) + '</span>' +
      '<span class="s">' + (it.qty == null ? 'Not counted' : fmt(it.qty) + ' ' + esc(it.unit)) + (it.reorder != null ? ' · reorder at ' + fmt(it.reorder) : '') + '</span>' +
      (p == null ? '' : '<span class="I_bar I_b' + level(it) + '" aria-hidden="true"><i style="width:' + p + '%"></i><b></b></span>') + '</span>' + levelBadge(it) + '</button>';
  }
  function renderShop() {
    var h = '';
    if (M.shopErr && !K.shop) return '<div class="empty" role="alert"><p class="hd">The shopping list is not available right now</p><button class="btn btn-primary" type="button" data-act="retry">Try again</button></div>';
    if (!K.shop) return '<p class="help I_load" role="status">Loading the shopping list…</p>';
    if (!K.shop.length) return '<div class="empty"><p>Nothing is on the shopping list.</p><p class="help">Open an item and choose Add to shopping list.</p></div>';
    if (allowed('bought')) h += '<button class="btn btn-primary btn-block I_boughtbtn" type="button" data-act="bought-open">Bought some of these</button>';
    h += '<div class="card list I_list">' + K.shop.map(function (r) {
      var who = r.mine ? 'You asked' : 'Asked by staff', when = dateLabel(r.at);
      var tag = canManage(M.role) ? 'button' : 'div';
      return '<' + tag + ' class="rowi I_row"' + (tag === 'button' ? ' type="button" data-act="shop-open" data-id="' + esc(r.id) + '"' : '') + '><span class="mid"><span class="t">' + esc(r.name) + '</span><span class="s">' + (r.qty != null ? fmt(r.qty) + ' ' + esc(r.unit || '') : '') + ' · ' + who + (when ? ', ' + when : '') + '</span>' +
        (r.note ? '<span class="s">' + esc(r.note) + '</span>' : '') + '</span><span class="I_lv ' + (r.status === 'approved' ? 'I_ok' : 'I_low') + '"><span aria-hidden="true">' + (r.status === 'approved' ? '✓' : '○') + '</span> ' + (r.status === 'approved' ? 'Approved' : 'Asked') + '</span></' + tag + '>';
    }).join('') + '</div>';
    return h;
  }

  /* ---- the sheet */
  function drawLayer() { drawLayer0(); drawUndo(); }
  function drawLayer0() {
    var box = q('[data-i-layer]'), main1 = q('[data-i-top]'), main2 = q('[data-i-list]'); if (!box) return;
    var a = M.act;
    if (!a) { stopCam(); box.innerHTML = ''; [main1, main2].forEach(function (n) { n && n.removeAttribute && n.removeAttribute('inert'); }); return; }
    if (a.kind === 'scan' && a.phase === 'look') { var sg = [a.camState, a.err, a.note, a.takenId].join('|'); if (a.sg === sg && box.innerHTML) { bindVideo(); return; } a.sg = sg; } else a.sg = null; // a camera preview is not redrawn under the person's thumb
    var body = a.shopId && a.kind === 'menu' ? renderShopSheet(a) : renderSheet(a);
    if (body == null) { stopCam(); M.act = null; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="scrim on" data-act="close"></div><div class="sheet on I_sheet" role="dialog" aria-modal="true" aria-labelledby="I_sh_t">' + body + '</div>';
    [main1, main2].forEach(function (n) { n && n.setAttribute && n.setAttribute('inert', ''); });
    if (!a.focused) { a.focused = true; var h = q('#I_sh_t'); if (h && h.focus) h.focus(); }
    bindVideo();
  }
  function refocus(id) { var n = M && M.el.querySelector && M.el.querySelector('#' + id); if (n && n.focus) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* not a text box */ } } }
  function head(title, sub) { return '<h2 class="hd I_sht" id="I_sh_t" tabindex="-1">' + esc(title) + '</h2>' + (sub ? '<p class="help">' + esc(sub) + '</p>' : ''); }
  function row(label, val) { return '<div class="I_kv"><dt>' + label + '</dt><dd>' + val + '</dd></div>'; }
  function errBox(a) {
    if (!a.err) return '';
    var t = a.err === 'taken' ? 'That code is already linked to ' + (a.takenName || 'another item') + '.' : ERR[a.err] || ERR.other;
    return '<div class="errbox" role="alert"><span aria-hidden="true">▲</span><span>' + esc(t) + '</span></div>' +
      (a.takenId ? '<button class="btn btn-secondary btn-block" type="button" data-act="open-taken" data-id="' + esc(a.takenId) + '">Open ' + esc(a.takenName || 'it') + '</button>' : '');
  }
  function selectField(id, label, opts, val) { return '<div class="field"><label for="I_f_' + id + '">' + label + '</label><div class="input"><select id="I_f_' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div></div>'; }
  function itemOf(a) { return itemById(a.pickId || a.itemId); }
  function stepper(id, label, val, allowZero) {
    return '<div class="field"><label for="I_f_' + id + '">' + label + '</label><div class="I_step"><button class="btn btn-secondary I_sb" type="button" data-act="step" data-f="' + id + '" data-d="-1" data-z="' + (allowZero ? 1 : 0) + '" aria-label="One less">−</button>' +
      '<div class="input"><input id="I_f_' + id + '" inputmode="decimal" autocomplete="off" value="' + esc(val) + '"></div><button class="btn btn-secondary I_sb" type="button" data-act="step" data-f="' + id + '" data-d="1" data-z="' + (allowZero ? 1 : 0) + '" aria-label="One more">+</button></div></div>';
  }
  function textField(id, label, val, extra) { return '<div class="field"><label for="I_f_' + id + '">' + label + '</label><div class="input"><input id="I_f_' + id + '" autocomplete="off" ' + (extra || '') + ' value="' + esc(val) + '"></div></div>'; }
  function actions(a, yes, extraBack) {
    return '<div class="I_btns">' + errBox(a) + '<button class="btn btn-primary btn-block" type="submit"' + (a.sending ? ' disabled' : '') + '>' + esc(a.sending ? 'Sending…' : yes) + '</button>' +
      '<button class="btn btn-secondary btn-block" type="button" data-act="back"' + (a.sending ? ' disabled' : '') + '>' + (extraBack || (a.step === 'confirm' ? 'Back' : 'Cancel')) + '</button></div>';
  }
  function unitOf(it) { return it.unit || 'units'; }
  function renderSheet(a) {
    if (a.kind === 'shopset') {
      return head((a.status === 'approved' ? 'Approve ' : 'Remove ') + a.rowName + (a.status === 'approved' ? '?' : ' from the list?')) + '<form data-i-form>' + actions(a, a.status === 'approved' ? 'Yes, approve it' : 'Yes, remove it') + '</form>';
    }
    if (a.kind === 'undo') return head(a.entry.confirm) + '<form data-i-form>' + (a.err === 'tooLate' ? errBox(a) : '') + (a.err === 'tooLate' ? '' : errBox(a)) + actions(a, a.err === 'tooLate' ? 'Close' : 'Yes, undo it') + '</form>';
    if (a.kind === 'walk') return renderWalk(a);
    if (a.kind === 'bought') return renderBought(a);
    if (a.kind === 'scan') return renderScan(a);
    if (a.kind === 'report') return renderReport(a);
    if (a.kind === 'create') return renderCreate(a);
    var it = itemOf(a); if (!it) return null;
    var v = a.vals || {}, m = M.role, h;
    if (a.kind === 'history') return renderHistory(a, it);
    if (a.kind === 'unlink') return head('Unlink code ' + shortCode(a.code) + ' from ' + it.name + '?') + '<form data-i-form><p class="I_conf">Scanning this code will no longer open ' + esc(it.name) + '.</p>' + actions(a, 'Yes, unlink it') + '</form>';
    if (a.kind === 'low') return head('Tell the owner ' + it.name + ' is running low?') + '<form data-i-form><p class="I_conf">It goes on the shopping list for ' + esc(fmt(lowQty(it)) + ' ' + (it.purchaseUnit || unitOf(it))) + '.</p>' + actions(a, 'Yes, tell them') + '</form>';
    if (a.kind === 'link') return head('Link code ' + shortCode(a.code) + ' to ' + it.name + '?') + '<form data-i-form><p class="I_conf">Scanning this code will open ' + esc(it.name) + '.</p>' + actions(a, 'Yes, link it') + '</form>';
    if (a.kind === 'menu') {
      var info = M.itemInfo[it.id], shopN = (K.shop || []).filter(function (r) { return r.itemId === it.id; }).length, cover = it.cover != null ? fmt(it.cover) + ' days' : it.coverEst != null ? 'about ' + fmt(it.coverEst) + ' days (an estimate)' : '';
      h = head(it.name, it.category + (it.consumable ? ' · consumable' : '')) + '<p class="I_lvline">' + levelBadge(it) + '</p><dl class="I_dl">' +
        row('On hand', it.qty == null ? 'Not counted' : esc(fmt(it.qty) + ' ' + it.unit)) + row('Reorder at', it.reorder == null ? 'Not set' : esc(fmt(it.reorder) + ' ' + it.unit)) +
        (K.v84 && (it.consumable || it.par != null) ? row('Buy up to', it.par != null ? esc(fmt(it.par) + ' ' + it.unit) : it.reorder != null ? esc('2 x reorder level (' + fmt(it.reorder * 2) + ')') : 'Not set') : '') +
        (K.v84 && canManage(m) ? row('Barcodes', it.codes.length ? it.codes.length + ' linked' : 'None linked') + (allowed('unlink') ? it.codes.map(function (c) { return row('Code', esc(c) + ' <button class="btn btn-ghost I_undobtn" type="button" data-act="unlink" data-code="' + esc(c) + '" aria-label="Unlink code ' + esc(c) + '">Unlink</button>'); }).join('') : '') : '') +
        (canManage(m) && info && info.done ? row('Last counted', info.lastCounted ? esc(dateLabel(info.lastCounted)) : 'Not counted in the app yet') : '') +
        (cover ? row('Lasts', esc(cover)) : '') + (canPrice(m) && it.cost != null ? row('Unit cost', esc(peso(it.cost))) : '') + '</dl>' +
        lastChange(it) + (M.denied.shop ? '' : shopN ? '<p class="help">Already on the shopping list.</p>' : '') + (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') + errBox(a) +
        '<div class="I_btns">' + menuButtons(it, a) +
        '<button class="btn btn-ghost btn-block" type="button" data-act="close">Close</button></div>' +
        (canManage(m) ? '<p class="help I_more"><a href="#door/inventory" data-act="admin">Full inventory in the admin dashboard</a></p>' : '');
      return h;
    }
    var c = a.step === 'confirm';
    if (a.kind === 'count') {
      var n = parseQty(v.qty, true), d = n == null || it.qty == null ? null : Math.round((n - it.qty) * 100) / 100;
      return head(c ? 'Set ' + it.name + ' to ' + fmt(n) + '?' : 'Count ' + it.name, c ? null : 'Count what is in the storeroom.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Now ' + (it.qty == null ? 'not counted' : esc(fmt(it.qty) + ' ' + it.unit)) + (d != null ? ', a change of ' + (d > 0 ? '+' : '') + fmt(d) : '') + '.</p>' + (it.controlled ? '' : '<p class="I_conf">After this, ' + esc(it.name) + ' is counted in the app. Telegram /count will skip it.</p>')
          : stepper('qty', 'Counted (' + esc(unitOf(it)) + ')', v.qty, true) + textField('note', 'Note (optional)', v.note || '', 'maxlength="200" placeholder="Where you counted"') + (a.bad ? '<div class="field"><span class="err">▲ Enter a number such as 12 or 2.5.</span></div>' : '')) +
        actions(a, c ? 'Yes, set it' : 'Continue') + '</form>';
    }
    if (a.kind === 'used') {
      var u = parseQty(v.qty);
      return head(c ? 'Log ' + fmt(u) + ' ' + unitOf(it) + ' of ' + it.name + ' as used?' : 'Used some ' + it.name, c ? null : 'How much did you use?') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Today’s date will be recorded.</p>' : stepper('qty', 'Used (' + esc(unitOf(it)) + ')', v.qty, false) + (a.bad ? '<div class="field"><span class="err">▲ Enter a number such as 1 or 2.5.</span></div>' : '')) +
        actions(a, c ? 'Yes, log it' : 'Continue') + '</form>';
    }
    if (a.kind === 'recv') {
      var pk = parseQty(v.packs), pu = it.purchaseUnit || it.unit || 'pack', add = pk == null ? null : Math.round(pk * it.perPack * 100) / 100;
      return head(c ? 'Add ' + fmt(add) + ' ' + unitOf(it) + ' of ' + it.name + '?' : 'Stock received: ' + it.name, c ? null : 'Enter what arrived.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">' + esc(fmt(pk) + ' ' + pu + (it.perPack !== 1 ? ' x ' + fmt(it.perPack) + ' ' + unitOf(it) : '')) + (v.supplier ? ' from ' + esc(v.supplier) : '') + '. On hand goes to ' + esc(it.qty == null ? fmt(add) : fmt(it.qty + add)) + ' ' + esc(unitOf(it)) + '.</p>'
          : stepper('packs', 'How many (' + esc(pu) + ')', v.packs, false) + textField('supplier', 'Supplier (optional)', v.supplier || '', 'maxlength="80"') + textField('cost', 'Cost per ' + esc(pu) + ' in PHP (optional)', v.cost || '', 'inputmode="decimal"') +
            (a.bad ? '<div class="field"><span class="err">▲ Enter numbers such as 2 or 150.50.</span></div>' : '')) + actions(a, c ? 'Yes, add it' : 'Continue') + '</form>';
    }
    if (a.kind === 'shop') {
      var sq = parseQty(v.qty);
      return head(c ? 'Add ' + fmt(sq) + ' ' + (it.purchaseUnit || unitOf(it)) + ' of ' + it.name + ' to the shopping list?' : 'Add to shopping list: ' + it.name, c ? null : 'The owner will see this request.') + '<form data-i-form>' +
        (c ? (v.note ? '<p class="I_conf">' + esc(v.note) + '</p>' : '') : stepper('qty', 'How many (' + esc(it.purchaseUnit || unitOf(it)) + ')', v.qty, false) + textField('note', 'Note (optional)', v.note || '', 'maxlength="200"') + (a.bad ? '<div class="field"><span class="err">▲ Enter a number such as 1 or 2.</span></div>' : '')) +
        actions(a, c ? 'Yes, add it' : 'Continue') + '</form>';
    }
    if (a.kind === 'price') {
      var pc = String(v.cost || '').trim() === '' ? null : parseQty(v.cost);
      return head(c ? (pc == null ? 'Clear the price of ' + it.name + '?' : 'Set the price of ' + it.name + ' to PHP ' + pesoNum(pc) + '?') : 'Change price: ' + it.name, c ? null : 'Enter what one costs.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Only the owner, admin and finance can see prices.</p>' : textField('cost', 'Price per ' + esc(unitOf(it)) + ' in PHP (leave empty to clear)', v.cost || '', 'inputmode="decimal"') + (a.bad ? '<div class="field"><span class="err">▲ Enter a number such as 95 or 95.50.</span></div>' : '')) +
        actions(a, c ? 'Yes, save it' : 'Continue') + '</form>';
    }
    if (a.kind === 'levels') {
      return head(c ? 'Save the levels for ' + it.name + '?' : 'Edit levels: ' + it.name, c ? null : 'Leave a box empty to clear it.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Reorder at ' + esc(String(v.reorder || '').trim() === '' ? 'not set' : v.reorder) + '. Buy up to ' + esc(String(v.par || '').trim() === '' ? 'not set' : v.par) + '.</p>'
          : levelsSuggest(a, it) + textField('reorder', 'Reorder at (' + esc(unitOf(it)) + ')', v.reorder || '', 'inputmode="decimal"') + textField('par', 'Buy up to (' + esc(unitOf(it)) + ')', v.par || '', 'inputmode="decimal"') + (a.bad ? '<div class="field"><span class="err">▲ ' + esc(a.bad === 'levels' ? ERR.levels : 'Enter numbers such as 12 or 2.5.') + '</span></div>' : '')) +
        actions(a, c ? 'Yes, save them' : 'Continue') + '</form>';
    }
    return null;
  }
  function pesoNum(n) { return fmt(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function categories() { var c = {}; (K.items || []).forEach(function (i) { c[i.category] = 1; }); c.Miscellaneous = 1; return Object.keys(c).sort(); }

  /* ---- scan, new item, report sheets (s84) */
  function renderScan(a) {
    var m = M.role, code = a.code, cs = a.camState;
    if (a.phase === 'unknown') {
      var can = canManage(m) && (allowed('link') || allowed('create'));
      return head('This code is not linked yet') + '<p class="I_conf I_code">' + esc(code) + '</p>' + (can ? '<p class="help">Link it to an item you already have, or add a new item.</p>' : '<p class="help">Ask the owner to link it. The code is ' + esc(code) + '.</p>') +
        '<div class="I_btns">' + (can && allowed('link') ? '<button class="btn btn-primary btn-block" type="button" data-act="scan-pick">Link to an item</button>' : '') + (can && allowed('create') ? '<button class="btn ' + (allowed('link') ? 'btn-secondary' : 'btn-primary') + ' btn-block" type="button" data-act="scan-new">New item</button>' : '') +
        '<button class="btn btn-secondary btn-block" type="button" data-act="back">Scan again</button><button class="btn btn-ghost btn-block" type="button" data-act="close">Close</button></div>';
    }
    if (a.phase === 'pick') {
      var f = String((a.vals || {}).find || '').trim().toLowerCase(), list = (K.items || []).filter(function (i) { return !f || i.name.toLowerCase().indexOf(f) >= 0; }).sort(byName).slice(0, 8);
      return head('Link code ' + shortCode(code) + ' to which item?') + textField('find', 'Search items', (a.vals || {}).find || '', 'type="search" enterkeyhint="search"') +
        (list.length ? '<div class="card list I_list">' + list.map(function (i) { return '<button class="rowi I_row" type="button" data-act="pick" data-id="' + esc(i.id) + '"><span class="mid"><span class="t">' + esc(i.name) + '</span><span class="s">' + esc(i.category) + '</span></span></button>'; }).join('') + '</div>' : '<p class="help">Nothing matches that search.</p>') +
        '<div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Back</button></div>';
    }
    var link = a.mode === 'link', it = link ? itemById(a.itemId) : null, cam = '';
    if (cs === 'starting' || cs === 'live') cam = '<div class="I_cam"><video class="I_video" data-i-video playsinline muted autoplay aria-label="Camera view"></video></div><p class="help" role="status">Hold the barcode inside the picture.</p>';
    else if (cs === 'denied') cam = '<div class="note soon" role="status"><span>' + esc(ERR.nocam) + '</span></div>';
    else if (cs === 'failed') cam = '<div class="note soon" role="status"><span>' + esc(ERR.camfail) + '</span></div>';
    else if (cs === 'paused') cam = '<p class="help" role="status">The camera is paused.</p><button class="btn btn-secondary btn-block" type="button" data-act="cam-start">Start the camera</button>';
    else if (cs === 'none') cam = '<p class="help" role="status">This phone cannot read barcodes. You can type the code instead.</p>';
    return head(link && it ? 'Link a barcode to ' + it.name : 'Scan a barcode', link ? 'Scan or type the code on the pack.' : 'Scan it to open the item.') + cam + (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') +
      '<form data-i-form>' + textField('code', 'Type the code under the barcode', (a.vals || {}).code || '', 'autocapitalize="off" spellcheck="false" autocorrect="off"') + errBox(a) +
      '<div class="I_btns"><button class="btn btn-primary btn-block" type="submit">Look it up</button><button class="btn btn-secondary btn-block" type="button" data-act="back">Close</button></div></form>';
  }
  function renderCreate(a) {
    var v = a.vals || {}, c = a.step === 'confirm', cats = categories();
    return head(c ? 'Add ' + String(v.name || '').trim() + ' as a new item?' : 'New item', c ? null : 'Code ' + shortCode(a.code) + ' will be linked to it.') + '<form data-i-form>' +
      (c ? '<p class="I_conf">' + esc(v.category) + ', counted in ' + esc(String(v.unit || '').trim() || 'pc') + (v.cons === 'yes' ? ', a consumable' : '') + '.</p><p class="I_conf">Code ' + esc(a.code) + ' will be linked to it.</p>' +
          (String(v.qty || '').trim() !== '' ? '<p class="I_conf">Counted now: ' + esc(v.qty) + '. After this, ' + esc(String(v.name).trim()) + ' is counted in the app. Telegram /count will skip it.</p>' : '') +
          (String(v.reorder || '').trim() !== '' ? '<p class="I_conf">Reorder at ' + esc(v.reorder) + '.</p>' : '')
        : textField('name', 'Name', v.name || '', 'maxlength="80"') + selectField('category', 'Category', [['', 'Choose one']].concat(cats.map(function (x) { return [x, x]; })), v.category || '') +
          textField('unit', 'Unit', v.unit || '', 'maxlength="20"') + selectField('cons', 'Is it a consumable?', [['no', 'No'], ['yes', 'Yes']], v.cons || 'no') +
          textField('qty', 'Counted now (optional)', v.qty || '', 'inputmode="decimal"') + textField('reorder', 'Reorder at (optional)', v.reorder || '', 'inputmode="decimal"') +
          (a.bad ? '<div class="field"><span class="err">▲ Give it a name and a category. Numbers such as 12 or 2.5.</span></div>' : '')) +
      errBoxIf(a, c) + actions(a, c ? 'Yes, add it' : 'Continue') + '</form>';
  }
  function errBoxIf(a, c) { return c ? errBox(a) : ''; }
  function coolLeft(v) { var t = K.cool[v.rkind + '|' + v.to]; return t && nowMs() - t < COOL_MS ? COOL_MS - (nowMs() - t) : 0; }
  function renderReport(a) {
    var v = a.vals, c = a.step === 'confirm', pick = REPORTS.filter(function (r) { return r.k === v.rkind; })[0], fin = v.to === 'finance', money = canPrice(M.role);
    if (c) return head('Send ' + pick.s + ' to the ' + (fin ? 'Finance' : 'OPS') + ' group?') + '<form data-i-form>' + (money ? '<p class="I_conf">' + (fin ? 'Prices are included.' : 'No prices are shown.') + '</p>' : '') + actions(a, 'Yes, send it') + '</form>';
    return head('Send a report', 'A PDF list goes to Telegram.') + '<form data-i-form><div class="I_pickrows" role="group" aria-label="Which list">' +
      REPORTS.map(function (r) { return '<button class="chip I_choice" type="button" data-act="rep-kind" data-k="' + r.k + '" aria-pressed="' + (v.rkind === r.k) + '">' + (v.rkind === r.k ? '<span aria-hidden="true">✓</span> ' : '') + esc(r.t) + '</button>'; }).join('') + '</div>' +
      (money && !K.noFinance ? '<div class="I_pickrows" role="group" aria-label="Send to"><button class="chip I_choice" type="button" data-act="rep-to" data-to="finance" aria-pressed="' + fin + '">' + (fin ? '<span aria-hidden="true">✓</span> ' : '') + 'Finance group (with prices)</button><button class="chip I_choice" type="button" data-act="rep-to" data-to="ops" aria-pressed="' + !fin + '">' + (!fin ? '<span aria-hidden="true">✓</span> ' : '') + 'OPS group (no prices)</button></div>' : '<p class="help">It goes to the OPS group.</p>') +
      (a.bad ? '<div class="field"><span class="err">▲ That list was just sent. Please wait half a minute.</span></div>' : '') + actions(a, 'Continue') + '</form>';
  }
  // The action buttons of the item card. A scanned card puts the most useful action for the role first (owner/admin count, finance price, cleaner shopping list).
  function menuButtons(it, a) {
    var m = M.role, b = function (kind, text, primary, act) { return '<button class="btn ' + (primary ? 'btn-primary' : 'btn-secondary') + ' btn-block" type="button" data-act="' + (act || 'begin') + '" data-kind="' + kind + '">' + text + '</button>'; };
    var list = [], listed = (K.shop || []).some(function (r) { return r.itemId === it.id; });
    if (allowed('low')) list.push(listed ? ['lowdone', 0, ''] : ['low', canManage(m) ? 0 : 1, 'Running low']);
    if (allowed('count')) list.push(['count', 1, 'Count it']);
    if (allowed('used')) list.push(['used', 1, 'Used some']);
    if (allowed('price')) list.push(['price', 0, 'Change price']);
    if (allowed('recv', it)) list.push(['recv', 0, 'Stock received']);
    if (allowed('levels')) list.push(['levels', 0, 'Edit levels']);
    if (allowed('link')) list.push(['link', 0, 'Link a barcode']);
    if (allowed('shop')) list.push(['shop', 0, 'Add to shopping list']);
    if (allowed('history')) list.push(['history', 0, 'History']);
    if (a && a.scanned) { var want = canManage(m) ? 'count' : canPrice(m) ? 'price' : 'low', at = -1; list.forEach(function (x, i) { if (x[0] === want) at = i; }); if (at >= 0) { list.unshift(list.splice(at, 1)[0]); list.forEach(function (y, i) { y[1] = i === 0 ? 1 : 0; }); } }
    return list.map(function (x) { return x[0] === 'lowdone' ? '<button class="btn btn-secondary btn-block" type="button" disabled><span aria-hidden="true">✓</span> On the shopping list</button>' : x[0] === 'admin' ? x[2] : x[0] === 'link' ? b('link', x[2], 0, 'begin-link') : x[0] === 'history' ? b('history', x[2], 0, 'history-open') : b(x[0], x[2], x[1]); }).join('');
  }
  // Running low (s84 1b): the amount to buy back to par (or 2 x reorder level), in packs; 1 when it cannot be worked out.
  function lowQty(it) {
    var target = it.par != null ? it.par : it.reorder != null ? it.reorder * 2 : null;
    if (target == null || it.qty == null) return 1;
    return Math.max(1, Math.ceil(Math.max(target - it.qty, 0) / (it.perPack || 1)));
  }
  function renderShopSheet(a) {
    var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!r) return null;
    return head(r.name, (r.qty != null ? fmt(r.qty) + ' ' + (r.unit || '') : '') + ' · ' + (r.status === 'approved' ? 'Approved' : 'Asked')) + (r.note ? '<p>' + esc(r.note) + '</p>' : '') + (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') + errBox(a) +
      '<div class="I_btns">' + (r.status === 'proposed' && !M.denied.shopset ? '<button class="btn btn-primary btn-block" type="button" data-act="shop-do" data-do="approved">Approve</button>' : '') +
      (r.status === 'approved' && r.itemId && allowed('recv', itemById(r.itemId)) ? '<button class="btn btn-primary btn-block" type="button" data-act="shop-bought">Mark bought</button>' : '') +
      (M.denied.shopset ? '' : '<button class="btn btn-secondary btn-block" type="button" data-act="shop-do" data-do="rejected">Remove from the list</button>') + '<button class="btn btn-ghost btn-block" type="button" data-act="close">Close</button></div>';
  }

  /* ---- events */
  function attr(t, name) { return t && t.getAttribute ? t.getAttribute(name) : null; }
  function onClick(ev) {
    if (!M) return;
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null; if (!t) return;
    var act = attr(t, 'data-act'), a0 = M.act;
    if (act === 'admin') { if (ev.preventDefault) ev.preventDefault(); M.opts.navigate && M.opts.navigate('#door/inventory'); return; }
    if (act === 'tab') return go(attr(t, 'data-to') ? '#stock/' + attr(t, 'data-to') : '#stock', attr(t, 'data-to') || '');
    if (act === 'chip') { K.chip = attr(t, 'data-k'); draw(); return; }
    if (act === 'showall') { K.chip = 'all'; K.q = ''; draw(); return; }
    if (act === 'bought-open') { if (!allowed('bought') || (M.act && M.act.sending)) return; M.act = { kind: 'bought', step: 'pick', sel: {}, vals: {}, keys: {}, done: {} }; drawLayer(); return; }
    if (act === 'walk') { if (a0 && a0.sending) return; return walkStart(attr(t, 'data-cat')); }
    if (act === 'scan') { if (M.act && M.act.sending) return; return openScan(null); }
    if (act === 'report') { if (!allowed('report') || (M.act && M.act.sending)) return; M.act = { kind: 'report', step: 'form', vals: { rkind: 'order', to: 'ops' } }; drawLayer(); return; }
    if (act === 'retry') { M.loadErr = null; M.shopErr = null; M.loading = false; if (!K.items) draw(); load(); return; }
    if (act === 'open') return go('#stock/item/' + attr(t, 'data-id'), 'item/' + attr(t, 'data-id'), attr(t, 'data-id'));
    if (act === 'shop-open') { if (!canManage(M.role)) return; M.act = { kind: 'menu', shopId: attr(t, 'data-id') }; drawLayer(); return; }
    var a = M.act;
    if (act === 'close') return closeSheet();
    if (act === 'undo') { var ue = undoById(attr(t, 'data-id')); if (!ue || (a && a.sending) || K.denied[ue.call.fn]) return; M.act = { kind: 'undo', entry: ue, step: 'confirm' }; drawLayer(); return; }
    if (!a) return;
    if (a.sending) return; // nothing, not even Close, while a write is in flight
    if (act === 'begin') return begin(attr(t, 'data-kind'));
    if (act === 'w-same') { if (a.kind === 'walk' && a.step === 'item') { a.same[a.ids[a.i]] = 1; walkNext(a); } return; }
    if (act === 'w-stop') { if (a.kind === 'walk') { a.step = 'summary'; a.err = null; if (Object.keys(a.saved).length) load(); drawLayer(); } return; }
    if (act === 'b-tick') { var bid = attr(t, 'data-id'); if (a.kind !== 'bought' || a.step !== 'pick') return; if (a.sel[bid]) delete a.sel[bid]; else { var br = shopRowBy(bid); a.sel[bid] = 1; if (a.vals['packs_' + bid] == null) a.vals['packs_' + bid] = fmt(br && br.qty || 1); } a.bad = false; drawLayer(); return; }
    if (act === 'b-undoall') { if (a.kind === 'bought' && a.step === 'done') { a.step = 'undoconfirm'; a.err = null; drawLayer(); } return; }
    if (act === 'unlink') { var uc = attr(t, 'data-code'); if (!allowed('unlink') || !a.itemId || !uc) return; M.act = { kind: 'unlink', itemId: a.itemId, code: uc, step: 'confirm' }; drawLayer(); return; }
    if (act === 'history-open') { if (a.kind !== 'menu' || !a.itemId || !allowed('history')) return; var ha = M.act = { kind: 'history', itemId: a.itemId, state: 'loading' }; drawLayer(); fetchHistory(a.itemId, function (d) { if (!M || M.act !== ha) return; if (d) { ha.state = 'ok'; ha.data = d; } else if (K.denied.inventory_item_history_v1) { M.act = newMenu(ha.itemId); toast(ERR.missing); } else ha.state = 'err'; drawLayer(); }); return; }
    if (act === 'use-sugg') { if (a.kind === 'levels' && a.sugg) { a.vals.par = String(a.sugg); a.err = null; a.bad = false; a.focused = false; drawLayer(); } return; }
    if (act === 'begin-link') { if (allowed('link') && a.itemId) openScan(a.itemId); return; }
    if (act === 'cam-start') { startCam(); return; }
    if (act === 'open-taken') { var tid = attr(t, 'data-id'); stopCam(); K.scanned = tid; return go('#stock/item/' + tid, 'item/' + tid, tid); }
    if (act === 'scan-pick') { if (allowed('link')) { a.phase = 'pick'; a.vals = { find: '' }; a.focused = false; drawLayer(); } return; }
    if (act === 'scan-new') { if (allowed('create')) { M.act = { kind: 'create', step: 'form', code: a.code, format: a.format, mode: a.mode, vals: { name: '', category: '', unit: 'pc', cons: 'no', qty: '', reorder: '' } }; drawLayer(); } return; }
    if (act === 'pick') { if (a.phase !== 'pick' || !allowed('link')) return; M.act = { kind: 'link', step: 'confirm', pickId: attr(t, 'data-id'), code: a.code, format: a.format, mode: a.mode, fromPick: true }; drawLayer(); return; }
    if (act === 'rep-kind') { a.vals.rkind = attr(t, 'data-k'); a.bad = false; drawLayer(); return; }
    if (act === 'rep-to') { a.vals.to = attr(t, 'data-to') === 'finance' && canPrice(M.role) && !K.noFinance ? 'finance' : 'ops'; a.bad = false; drawLayer(); return; }
    if (act === 'back') { if (/^(scan|link|create|report|undo|bought|unlink|history)$/.test(a.kind)) return flowBack(a); if (a.kind === 'shopset') { a.kind = 'menu'; a.step = null; a.err = null; drawLayer(); } else if (a.fromShop && a.step !== 'confirm') { M.act = null; drawLayer(); } else if (a.step === 'confirm' && a.kind !== 'low') { a.step = 'form'; a.err = null; drawLayer(); } else if (a.shopId) { a.kind = 'menu'; a.err = null; drawLayer(); } else { a.kind = 'menu'; a.vals = null; a.step = null; a.err = null; a.bad = false; drawLayer(); } return; }
    if (act === 'step') { a.vals = a.vals || {}; var f = attr(t, 'data-f'); a.vals[f] = stepQty(a.vals[f], +attr(t, 'data-d'), attr(t, 'data-z') === '1'); a.err = null; drawLayer(); var nb = q('[data-act="step"][data-f="' + f + '"][data-d="' + attr(t, 'data-d') + '"]'); if (nb && nb.focus) nb.focus(); return; }
    if (act === 'shop-bought') { var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!r || !r.itemId || !allowed('recv', itemById(r.itemId))) return; M.act = { kind: 'recv', itemId: r.itemId, step: 'form', vals: { packs: fmt(r.qty || 1), supplier: '', cost: '', shopId: r.id }, fromShop: true }; drawLayer(); return; }
    if (act === 'shop-do') { var rr = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!rr) return; a.kind = 'shopset'; a.status = attr(t, 'data-do'); a.step = 'confirm'; a.rowName = rr.name; drawLayer(); return; }
  }
  function go(hash, sub, itemId) {
    M.sub = sub; M.act = itemId ? newMenu(itemId) : null;
    if (M.opts.navigate) M.opts.navigate(hash);
    if (M) { draw(); if (itemId) loadLastCount(itemId); }
  }
  function closeSheet() {
    if (!M || (M.act && M.act.sending)) return;
    stopCam(); K.scanned = null;
    var id = M.act && M.act.itemId, wsaved = 0;
    if (M.act && M.act.kind === 'walk' && M.act.step !== 'summary') { wsaved = Object.keys(M.act.saved).length; if (wsaved) toast(wsaved + (wsaved === 1 ? ' item saved' : ' items saved') + '. The rest were not changed.'); }
    M.act = null;
    if (route().itemId) { M.sub = ''; if (M.opts.navigate) M.opts.navigate('#stock'); }
    if (M) { drawLayer(); if (id) { var b = q('[data-id="' + id + '"]'); if (b && b.focus) b.focus(); } if (wsaved) load(); }
  }
  function allowed(kind, it) {
    var m = M.role;
    if (kind === 'count') return I_FLAGS.count && canManage(m) && !M.denied.count;
    if (kind === 'used') return I_FLAGS.usage && canUse(m) && !M.denied.used;
    if (kind === 'recv') return canManage(m) && !M.denied.recv; // controlled items too since 1b: record_inventory_receipt_v1 writes their movement
    if (kind === 'bought') return canManage(m) && !M.denied.bought && K.shop && K.shop.length > 0;
    if (kind === 'shop') return !M.denied.shop;
    if (kind === 'low') return !M.denied.low && !M.denied.shop && !(it && (K.shop || []).some(function (r) { return r.itemId === it.id; }));
    if (kind === 'price') return K.v84 && canPrice(m) && !M.denied.price;
    if (kind === 'levels') return K.v84 && canManage(m) && !M.denied.levels;
    if (kind === 'link') return K.v84 && canManage(m) && !M.denied.link;
    if (kind === 'history') return K.v84 && !M.demo && !K.denied.inventory_item_history_v1;
    if (kind === 'unlink') return K.v84 && canManage(m) && !M.denied.unlink;
    if (kind === 'create') return K.v84 && canManage(m) && !M.denied.create;
    if (kind === 'report') return !M.denied.report;
    return false;
  }
  function begin(kind) {
    if (!allowed(kind, itemById(M.act.itemId))) return;
    var a = M.act, it = itemById(a.itemId), defaults = { count: { qty: it && it.qty != null ? fmt(it.qty) : '0', note: '' }, used: { qty: '1' }, recv: { packs: '1', supplier: '', cost: '' }, shop: { qty: '1', note: '' },
      low: {}, price: { cost: it && it.cost != null ? fmt(it.cost) : '' }, levels: { reorder: it && it.reorder != null ? fmt(it.reorder) : '', par: it && it.par != null ? fmt(it.par) : '' } };
    a.kind = kind; a.step = kind === 'low' ? 'confirm' : 'form'; a.vals = defaults[kind]; a.err = null; a.bad = false; a.key = null; a.sig = null; a.focused = false; drawLayer();
    if (kind === 'levels' && allowed('history')) fetchHistory(a.itemId, function (d) { if (M && M.act === a && a.kind === 'levels') { a.sugg = d ? suggestBuyUp(itemById(a.itemId), d) : null; drawLayer(); } });
  }
  function onInput(ev) {
    if (!M) return;
    var id = ev.target && ev.target.id; if (!id) return;
    if (id === 'I_q') { K.q = ev.target.value; drawList(); return; }
    if (id.indexOf('I_f_') === 0 && M.act && M.act.vals) {
      M.act.vals[id.slice(4)] = ev.target.value; M.act.err = null;
      if (id === 'I_f_find') { drawLayer(); refocus(id); } // the pick list follows what is typed
    }
  }
  function onKey(ev) { if (M && ev.key === 'Escape' && M.act) { closeSheet(); } }
  function valid(a) {
    var v = a.vals || {};
    if (a.kind === 'count') return parseQty(v.qty, true) != null;
    if (a.kind === 'used' || a.kind === 'shop') return parseQty(v.qty) != null;
    if (a.kind === 'recv') return parseQty(v.packs) != null && (String(v.cost || '').trim() === '' || parseQty(v.cost) != null);
    if (a.kind === 'price') return String(v.cost || '').trim() === '' || parseQty(v.cost) != null;
    if (a.kind === 'levels') return optQty(v.reorder) && optQty(v.par) && !(String(v.reorder || '').trim() !== '' && String(v.par || '').trim() !== '' && parseQty(v.par, true) < parseQty(v.reorder, true));
    if (a.kind === 'create') { var nm = String(v.name || '').trim(); return nm.length >= 2 && nm.length <= 80 && String(v.category || '').trim() !== '' && String(v.unit || '').trim().length <= 20 && optQty(v.qty) && optQty(v.reorder); }
    if (a.kind === 'report') return coolLeft(v) === 0;
    return true;
  }
  function onSubmit(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var a = M && M.act; if (!a || a.sending || a.kind === 'menu') return;
    if (a.kind === 'walk') return walkSubmit(a);
    if (a.kind === 'bought') return boughtSubmit(a);
    if (a.kind === 'scan') { if (a.phase === 'look') handleCode((a.vals || {}).code, null); return; }
    if (a.step !== 'confirm') { if (!valid(a)) { a.bad = a.kind === 'levels' && optQty(a.vals.reorder) && optQty(a.vals.par) ? 'levels' : true; drawLayer(); return; } a.bad = false; a.step = 'confirm'; a.err = null; a.focused = false; drawLayer(); return; }
    commit(a);
  }

  /* ---- the write */
  function build(a) {
    var it = itemOf(a), today = manilaToday(nowMs()), sig = JSON.stringify([a.kind, a.itemId || a.pickId || a.shopId, a.vals, a.status, a.code, a.entry && a.entry.id]);
    var ke = K.keys[sig]; // one key per set of values, kept even if the sheet is reopened; dropped on success; forgotten after 10 minutes (a write that landed unseen must not replay a later identical one)
    if (!ke || nowMs() - ke.at > 600000) ke = K.keys[sig] = { key: newKey(a.kind), at: nowMs() };
    a.sig = sig; a.key = ke.key;
    if (a.kind === 'count') return countCall(it, a.vals, a.key);
    if (a.kind === 'used') return usageCall(M.pid, it, a.vals, a.key, today);
    if (a.kind === 'recv') return receiptCall(it, a.vals, a.key, today);
    if (a.kind === 'shop') return shopAddCall(M.pid, it, a.vals, a.key);
    if (a.kind === 'low') return shopAddCall(M.pid, it, { qty: fmt(lowQty(it)), note: 'Running low (from the staff app)' }, a.key);
    if (a.kind === 'undo') return a.entry.call;
    if (a.kind === 'unlink') return { fn: 'inventory_code_detach_v1', args: { p_property_id: M.pid, p_code: a.code } };
    if (a.kind === 'link') return attachCall(M.pid, it, a.code, a.format);
    if (a.kind === 'price') return priceCall(it, a.vals);
    if (a.kind === 'levels') return levelsCall(it, a.vals);
    if (a.kind === 'create') return createCall(M.pid, a.vals, a.code, a.format, a.key);
    if (a.kind === 'report') return reportCall(a.vals);
    var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0];
    return shopSetCall(M.pid, r, a.status, a.key);
  }
  var DONE = { count: function (it) { return 'Counted. ' + it.name + ' is saved.'; }, used: function () { return 'Logged. Thank you.'; }, recv: function (it) { return 'Stock received for ' + it.name + '.'; }, shop: function () { return 'Added to the shopping list.'; }, shopset: function (it, a) { return a.status === 'approved' ? 'Approved.' : 'Removed from the list.'; },
    undo: function () { return 'Undone.'; }, unlink: function () { return 'Unlinked.'; }, low: function () { return 'Passed on. Thank you.'; }, link: function (it) { return 'Linked. Scanning it now opens ' + it.name + '.'; }, price: function (it) { return 'Price saved for ' + it.name + '.'; }, levels: function (it) { return 'Levels saved for ' + it.name + '.'; },
    create: function (it, a) { return 'Added ' + String(a.vals.name).trim() + '.'; }, report: function (it, a) { return 'Sent to the ' + (a.vals.to === 'finance' ? 'Finance' : 'OPS') + ' group.'; } };
  function bodyOf(e) { try { return e && e.context && typeof e.context.json === 'function' ? Promise.resolve(e.context.json()).catch(function () { return null; }) : null; } catch (x) { return null; } }
  var NEWK = { unlink: 1, low: 1, link: 1, price: 1, levels: 1, create: 1, report: 1, undo: 1 }; // actions that hide for the visit when the server says "not here"
  function commit(a) {
    var me = M, it = itemOf(a) || { name: a.rowName || (a.entry && a.entry.name) || '' }, call = build(a), rep = a.kind === 'report', snap = it && { qty: it.qty, cost: it.cost, reorder: it.reorder, par: it.par };
    if (me.demo) { toast(rep ? 'Demo only, nothing was sent.' : DEMO_NOTE); finish(); return; }
    if (!online()) { a.err = 'offline'; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    if (!rep) K.at = 0; // any write makes the list stale, whichever mount sees the answer
    a.sending = true; a.err = null; a.takenId = null; drawLayer();
    var run = call.invoke
      ? function () { return me.client.functions && me.client.functions.invoke ? me.client.functions.invoke(call.invoke, { body: call.body }) : Promise.reject({ status: 404 }); }
      : function () { return me.client.rpc(call.fn, call.args); };
    Promise.resolve().then(run).then(function (r) {
      if (me.dead) return;
      if (r && r.error) throw r.error;
      if (r && r.data && (r.data.ok === false || r.data.error)) throw { message: 'failed', data: r.data };
      a.sending = false; delete K.keys[a.sig];
      if (rep) K.cool[a.vals.rkind + '|' + a.vals.to] = nowMs();
      var msg = DONE[a.kind](it, a);
      if (a.kind === 'undo') K.undos = K.undos.filter(function (u) { return u !== a.entry; }); else pushUndo(a, it, r && r.data || {}, snap);
      toast(msg); if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (e) { /* no haptics */ } }
      finish(); if (!rep) load();
    }).catch(function (e) {
      if (me.dead) return;
      Promise.resolve(e && e.data ? e.data : bodyOf(e)).then(function (body) { if (!me.dead) fail(me, a, e, body, rep); });
    });
  }
  function fail(me, a, e, body, rep) {
    var why = body && (body.reason || body.error);
    a.sending = false;
    if (why === 'code_taken') { a.err = 'taken'; a.takenId = body.item_id || null; a.takenName = body.item_name || (itemById(body.item_id) || {}).name || ''; return drawLayer(); }
    if (why === 'name_exists') { a.err = 'exists'; a.takenId = body.item_id || null; a.takenName = (itemById(body.item_id) || {}).name || ''; return drawLayer(); }
    if (why === 'bad_code') { a.err = 'badcode'; return drawLayer(); }
    if (a.kind === 'undo' && (why === 'too_late' || why === 'not_yours' || why === 'stock_moved')) { a.err = 'tooLate'; K.undos = K.undos.filter(function (u) { return u !== a.entry; }); return drawLayer(); }
    if (why === 'finance_only') { K.noFinance = true; a.vals.to = 'ops'; a.step = 'form'; a.err = 'financeOnly'; return drawLayer(); }
    a.err = errKind(e, online());
    var dk = a.kind === 'undo' ? a.entry.call.fn : a.kind;
    if (a.err === 'missing' && NEWK[a.kind]) { me.denied[dk] = true; if (a.itemId && !rep && a.kind !== 'create') { a.kind = 'menu'; a.vals = null; a.step = null; } else me.act = null; a.err = null; toast(ERR.missing); if (rep) drawList(); return drawLayer(); } // not here yet: hide it, no error box
    if (!rep && (a.err === 'offline' || a.err === 'other')) { me.loading = false; load(); } // the write may have landed: look again
    if (a.err === 'refused') { // the server decides: calm line, and the action goes away
      me.denied[dk] = true;
      if (a.kind === 'shopset') { a.kind = 'menu'; }
      else if (a.itemId && !rep && a.kind !== 'create') { a.kind = 'menu'; a.vals = null; a.step = null; }
      else { var m = ERR[a.err]; me.act = null; toast(m); }
      if (rep) drawList();
    }
    drawLayer();
  }

  /* ---- Item history and a suggested Buy up to (s84 1b, Q3) */
  function fetchHistory(id, cb) {
    var me = M; if (!me || me.demo || !me.client) return cb(null);
    if (me.hist[id]) return cb(me.hist[id]);
    Promise.resolve().then(function () { return me.client.rpc('inventory_item_history_v1', { p_item_id: id }); }).then(function (r) {
      if (me.dead) return;
      if (r && r.error) throw r.error;
      if (!r || !r.data || r.data.ok === false) throw { message: 'failed' };
      me.hist[id] = r.data; cb(r.data);
    }).catch(function (e) { if (me.dead) return; if (errKind(e, online()) === 'missing') K.denied.inventory_item_history_v1 = true; cb(null); });
  }
  // Average use per clean x cleans in the last 14 days x 1.5, rounded up to a whole pack. Only with 5 or more cleans of evidence.
  function suggestBuyUp(it, h) {
    var u = h && h.usage; if (!it || !u || !(u.cleans_30d >= 5) || !(num(u.per_clean) > 0) || !(num(u.cleans_14d) > 0)) return null;
    var packs = Math.ceil(Math.round(num(u.per_clean) * num(u.cleans_14d) * 1.5 * 100) / 100 / (it.perPack || 1));
    return Math.round(packs * (it.perPack || 1) * 100) / 100;
  }
  function levelsSuggest(a, it) {
    return a.sugg ? '<p class="help I_sugg">Suggested: buy up to ' + esc(fmt(a.sugg)) + ' <button class="btn btn-secondary I_undobtn" type="button" data-act="use-sugg">Use ' + esc(fmt(a.sugg)) + '</button></p>' : '';
  }
  var CHANGE_WORD = { reconcile: 'Counted', receipt: 'Received', adjustment: 'Adjusted', usage: 'Used', undo: 'Undo', telegram_count: 'Telegram count' };
  function renderHistory(a, it) {
    var h = head(it.name + ': history', it.category);
    if (a.state === 'loading') return h + '<p class="help I_load" role="status">Loading…</p><div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Back</button></div>';
    if (a.state !== 'ok') return h + '<div class="errbox" role="alert"><span aria-hidden="true">▲</span><span>' + esc(ERR.other) + '</span></div><div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Back</button></div>';
    var d = a.data, u = d.usage || {}, pc = num(u.per_clean), body = '<h3 class="I_hh">Use per clean</h3>';
    if (!(u.cleans_30d >= 5) || !(pc > 0)) body += '<p class="help">Not enough cleans yet to tell.</p>';
    else {
      body += '<p class="I_conf">About ' + esc(fmt(pc)) + ' ' + esc(unitOf(it)) + ' per clean, over ' + esc(String(u.cleans_30d)) + ' cleans in the last 30 days.</p>';
      if (it.qty > 0) body += '<p class="help">About ' + esc(String(Math.max(1, Math.round(it.qty / (pc * u.cleans_30d / 30))))) + ' days left at the current booking pace (an estimate).</p>';
    }
    body += '<h3 class="I_hh">Last changes</h3>';
    var ch = Array.isArray(d.changes) ? d.changes.slice(0, 10) : [];
    body += ch.length ? '<ul class="I_blines">' + ch.map(function (c) { var w = CHANGE_WORD[c.kind] || String(c.kind || 'Change').replace(/^./, function (x) { return x.toUpperCase(); }); return '<li>' + esc(dateLabel(c.at)) + ' · ' + esc(w) + ' ' + esc(c.before == null ? '' : fmt(c.before)) + ' → ' + esc(c.after == null ? '' : fmt(c.after)) + (c.who ? ' · ' + esc(String(c.who).split(' ')[0]) : '') + '</li>'; }).join('') + '</ul>' : '<p class="help">No changes recorded yet.</p>';
    var lb = d.last_bought;
    body += '<h3 class="I_hh">Last bought</h3>' + (lb && lb.at ? '<p class="I_conf">' + esc(dateLabel(lb.at)) + (lb.qty != null ? ', ' + esc(fmt(lb.qty)) : '') + (canPrice(M.role) && lb.unit_cost != null ? ', PHP ' + esc(pesoNum(lb.unit_cost)) + ' each' : '') + '</p>' : '<p class="help">No purchase recorded yet.</p>');
    return h + body + '<div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Back</button></div>';
  }

  /* ---- Count a group (s84 1b, Q2): one item per screen, nothing is written without a tap on Next */
  function walkIt(a) { return itemById(a.ids[a.i]); }
  function walkVals(a) { var it = walkIt(a); a.vals = { qty: it && it.qty != null ? fmt(it.qty) : '0' }; a.err = null; a.bad = false; }
  function walkStart(cat) {
    if (!allowed('count') || !K.items) return;
    var g = groupsFor(K.items, K.chip, K.q).filter(function (x) { return x.cat === cat; })[0]; if (!g || !g.rows.length) return;
    M.act = { kind: 'walk', cat: cat, ids: g.rows.map(function (r) { return r.id; }), i: 0, step: 'item', saved: {}, same: {}, keys: {} }; walkVals(M.act); drawLayer();
  }
  function walkNext(a, flash) {
    a.i++; a.flash = null;
    if (a.i >= a.ids.length) { a.step = 'summary'; if (Object.keys(a.saved).length) { K.at = 0; load(); } } else { walkVals(a); a.flash = flash || null; }
    drawLayer();
  }
  function walkSubmit(a) {
    if (a.sending) return;
    if (a.step === 'summary') return closeSheet();
    var me = M, it = walkIt(a), n = parseQty(a.vals.qty, true);
    if (!it || n == null) { a.bad = true; drawLayer(); return; }
    if (me.demo) { a.saved[it.id] = { before: it.qty, after: n }; toast(DEMO_NOTE); walkNext(a, '✓ Saved'); return; }
    if (!online()) { a.err = 'offline'; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    a.keys[it.id] = a.keys[it.id] || newKey('count');
    var c = countCall(it, { qty: a.vals.qty, note: 'Group count in the staff app' }, a.keys[it.id]);
    a.sending = true; a.err = null; drawLayer();
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (me.dead) return;
      if (r && r.error) throw r.error;
      if (r && r.data && r.data.ok === false) throw { message: 'failed' };
      a.sending = false; delete a.keys[it.id]; K.at = 0;
      var e = undoFor({ kind: 'count', vals: a.vals }, it, r && r.data || {}, { qty: it.qty }); if (e) pushUndoEntry(e);
      a.saved[it.id] = { before: it.qty, after: n, undo: e };
      walkNext(a, '✓ Saved');
    }).catch(function (e) {
      if (me.dead) return;
      a.sending = false; a.err = errKind(e, online());
      if (a.err === 'refused') { K.denied.count = true; var m = ERR.refused; me.act = null; toast(m); draw(); return; }
      drawLayer();
    });
  }
  function renderWalk(a) {
    if (a.step === 'summary') {
      var ids = Object.keys(a.saved), same = Object.keys(a.same).length, big = ids.filter(function (id) { var s = a.saved[id]; return s.before > 0 && Math.abs(s.after - s.before) > s.before / 2; });
      return head(ids.length ? 'Counting done' : 'Nothing was changed', a.cat) + '<p class="I_conf">' + ids.length + ' counted, ' + same + ' the same' + (big.length ? ', ' + big.length + ' changed by more than half' : '') + '.</p>' +
        (a.i < a.ids.length ? '<p class="help">The rest were not changed.</p>' : '') +
        (big.length ? '<dl class="I_dl">' + big.map(function (id) { var s = a.saved[id], it = itemById(id); return row('<span aria-hidden="true">▲</span> ' + esc(it ? it.name : ''), esc(fmt(s.before) + ' → ' + fmt(s.after)) + (s.undo && !K.denied[s.undo.call.fn] ? ' <button class="btn btn-ghost I_undobtn" type="button" data-act="undo" data-id="' + s.undo.id + '"><span aria-hidden="true">↶</span> Undo</button>' : '')); }).join('') + '</dl>' : '') +
        '<div class="I_btns"><button class="btn btn-primary btn-block" type="button" data-act="close">Close</button></div>';
    }
    var it = walkIt(a); if (!it) return null;
    var last = a.i === a.ids.length - 1;
    return head('Item ' + (a.i + 1) + ' of ' + a.ids.length, a.cat) + '<p class="I_wname">' + esc(it.name) + '</p><p class="help">' + esc(it.unit) + ' · ' + (it.counted ? 'Last counted ' + esc(dateLabel(it.counted)) : 'Not counted in the app yet') + '</p>' +
      '<form data-i-form>' + stepper('qty', 'Counted (' + esc(unitOf(it)) + ')', a.vals.qty, true) + (a.bad ? '<div class="field"><span class="err">▲ Enter a number such as 12 or 2.5.</span></div>' : '') +
      (a.flash ? '<div class="okbox" role="status"><span>' + esc(a.flash) + '</span></div>' : '') + (it.controlled ? '' : '<p class="help">The first count here moves this item to counting in the app.</p>') + errBox(a) +
      '<div class="I_btns"><button class="btn btn-primary btn-block" type="submit"' + (a.sending ? ' disabled' : '') + '>' + (a.sending ? 'Saving…' : last ? 'Finish' : 'Next') + '</button>' +
      '<button class="btn btn-secondary btn-block" type="button" data-act="w-same"' + (a.sending ? ' disabled' : '') + '>Same as before</button><button class="btn btn-ghost btn-block" type="button" data-act="w-stop"' + (a.sending ? ' disabled' : '') + '>Stop here</button></div></form>';
  }

  /* ---- Bought some of these (s84 1b, Q5): tick, check once, then one receipt per line, one at a time */
  function shopRowBy(id) { return (K.shop || []).filter(function (x) { return x.id === id; })[0] || null; }
  function boughtRows() { return (K.shop || []).filter(function (r) { return r.itemId && itemById(r.itemId); }); }
  function boughtPicked(a) { return boughtRows().filter(function (r) { return a.sel[r.id]; }); }
  function boughtValid(a) {
    var rows = boughtPicked(a); if (!rows.length) return false;
    return rows.every(function (r) { return parseQty(a.vals['packs_' + r.id]) != null && (!canPrice(M.role) || String(a.vals['cost_' + r.id] || '').trim() === '' || parseQty(a.vals['cost_' + r.id]) != null); });
  }
  function boughtLine(r, a) {
    var it = itemById(r.itemId), pk = parseQty(a.vals['packs_' + r.id]), add = Math.round(pk * it.perPack * 100) / 100, pu = it.purchaseUnit || it.unit || 'pack';
    return '<li><strong>' + esc(it.name) + '</strong>: ' + esc(fmt(pk) + ' ' + pu + (it.perPack !== 1 ? ' = ' + fmt(add) + ' ' + unitOf(it) : '')) + ', on hand ' + esc(it.qty == null ? 'not counted' : fmt(it.qty)) + ' → ' + esc(fmt((it.qty || 0) + add)) + (r.status === 'proposed' ? ' <span class="help">(approved first)</span>' : '') + '</li>';
  }
  function renderBought(a) {
    var rows = boughtRows(), picked = boughtPicked(a), nDone = picked.filter(function (r) { return a.done[r.id] && a.done[r.id].received; }).length;
    if (a.step === 'done') return head(nDone + (nDone === 1 ? ' item added' : ' items added'), 'Stock is up to date.') + '<ul class="I_blines">' + picked.map(function (r) { return boughtLine(r, a); }).join('') + '</ul>' + errBox(a) +
      '<div class="I_btns">' + (picked.some(function (r) { return a.done[r.id] && a.done[r.id].undo && !K.denied.inventory_undo_v1; }) ? '<button class="btn btn-secondary btn-block" type="button" data-act="b-undoall"><span aria-hidden="true">↶</span> Undo all</button>' : '') + '<button class="btn btn-primary btn-block" type="button" data-act="close">Close</button></div>';
    if (a.step === 'undoconfirm') return head('Undo all ' + nDone + ' receipts?', 'Each one is taken back out, newest first.') + '<form data-i-form>' + actions(a, 'Yes, undo them all') + '</form>';
    if (a.step === 'confirm') {
      var failed = a.failId && shopRowBy(a.failId), left = picked.length - nDone;
      return head('Add these to the stock?') + '<form data-i-form><ul class="I_blines">' + picked.map(function (r) { return boughtLine(r, a); }).join('') + '</ul>' +
        (a.err && failed ? '<div class="errbox" role="alert"><span aria-hidden="true">▲</span><span>' + esc(nDone + ' of ' + picked.length + ' added. ' + failed.name + ' did not go through. ' + (a.err === 'offline' ? ERR.offline : 'Try again.')) + '</span></div>' : errBox(a)) +
        actions(a, a.err && nDone ? 'Try again' : 'Yes, add them') + '</form>';
    }
    return head('Bought some of these', 'Tick what you bought.') + '<form data-i-form>' + (rows.length ? '' : '<p class="help">Nothing on the list can be added yet.</p>') + rows.map(function (r) {
      var on = !!a.sel[r.id], it = itemById(r.itemId), pu = it.purchaseUnit || it.unit || 'pack';
      return '<div class="I_brow"><button class="btn btn-secondary btn-block I_tick" type="button" data-act="b-tick" data-id="' + esc(r.id) + '" aria-pressed="' + on + '"><span aria-hidden="true">' + (on ? '✓' : '○') + '</span> ' + esc(r.name) + (r.status === 'proposed' ? ' <span class="help">Waiting for approval</span>' : '') + '</button>' +
        (on ? stepper('packs_' + r.id, 'How many (' + esc(pu) + ')', a.vals['packs_' + r.id], false) + (canPrice(M.role) ? textField('cost_' + r.id, 'Price per ' + esc(pu) + ' in PHP (optional)', a.vals['cost_' + r.id] || '', 'inputmode="decimal"') : '') : '') + '</div>';
    }).join('') + (a.bad ? '<div class="field"><span class="err">▲ Tick at least one, and enter numbers such as 2 or 150.50.</span></div>' : '') + actions(a, 'Check them', 'Cancel') + '</form>';
  }
  function boughtSubmit(a) {
    if (a.sending) return;
    if (a.step === 'pick') { if (!boughtValid(a)) { a.bad = true; drawLayer(); return; } a.bad = false; boughtPicked(a).forEach(function (r) { a.keys[r.id] = a.keys[r.id] || newKey('recv'); a.keys[r.id + 'a'] = a.keys[r.id + 'a'] || newKey('appr'); }); a.step = 'confirm'; a.err = null; drawLayer(); return; }
    if (a.step === 'done') return closeSheet();
    var me = M, rows = boughtPicked(a);
    if (me.demo) { toast(DEMO_NOTE); closeSheet(); return; }
    if (!online()) { a.err = 'offline'; a.failId = null; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    K.at = 0; a.sending = true; a.err = null; a.failId = null; drawLayer();
    var chk = function (r) { if (r && r.error) throw r.error; if (r && r.data && (r.data.ok === false || r.data.error)) throw { message: 'failed', data: r.data }; return r; };
    var chain = Promise.resolve();
    if (a.step === 'undoconfirm') {
      var es = rows.map(function (r) { return a.done[r.id] && a.done[r.id].undo; }).filter(Boolean).reverse(), n = 0;
      es.forEach(function (e) { chain = chain.then(function () { a.cur = e; return me.client.rpc(e.call.fn, e.call.args); }).then(chk).then(function () { n++; K.undos = K.undos.filter(function (u) { return u !== e; }); }); });
      chain.then(function () { if (me.dead) return; a.sending = false; toast('Undone.'); closeSheet(); load(); }).catch(function (e) {
        if (me.dead) return; a.sending = false; Promise.resolve(e && e.data ? e.data : bodyOf(e)).then(function (body) {
          var why = body && (body.reason || body.error); a.err = why === 'too_late' || why === 'not_yours' || why === 'stock_moved' ? 'tooLate' : errKind(e, online());
          if (a.err === 'refused' || a.err === 'missing') { K.denied.inventory_undo_v1 = true; a.step = 'done'; }
          load(); drawLayer();
        });
      });
      return;
    }
    rows.forEach(function (r) {
      chain = chain.then(function () {
        var d = a.done[r.id] = a.done[r.id] || {}; if (d.received) return null; a.cur = r.id;
        var it = itemById(r.itemId), p = Promise.resolve();
        if (r.status === 'proposed' && !d.approved) p = p.then(function () { var c = shopSetCall(me.pid, r, 'approved', a.keys[r.id + 'a']); return me.client.rpc(c.fn, c.args); }).then(chk).then(function () { d.approved = true; });
        return p.then(function () {
          var c = receiptCall(it, { packs: a.vals['packs_' + r.id], cost: canPrice(me.role) ? a.vals['cost_' + r.id] : '', supplier: '', shopId: r.id }, a.keys[r.id], manilaToday(nowMs()));
          return me.client.rpc(c.fn, c.args);
        }).then(chk).then(function (res) {
          var dd = res.data || {}; d.received = dd;
          if (dd.movementId || dd.purchaseId) { var e = { id: 'u' + (++K.uidn), itemId: it.id, name: it.name, at: nowMs(), kind: 'recv', say: 'Received ' + it.name, line: 'received stock', confirm: 'Take the stock you just added to ' + it.name + ' back out?', call: { fn: 'inventory_undo_v1', args: { p_movement_id: dd.movementId || null, p_purchase_id: dd.purchaseId || null } } }; d.undo = e; pushUndoEntry(e); }
        });
      });
    });
    chain.then(function () { if (me.dead) return; a.sending = false; a.step = 'done'; a.err = null; toast('Stock added.'); if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (x) { /* no haptics */ } } load(); drawLayer(); }).catch(function (e) {
      if (me.dead) return; a.sending = false; a.failId = a.cur;
      Promise.resolve(e && e.data ? e.data : bodyOf(e)).then(function (body) {
        if (me.dead) return; a.err = errKind(e, online());
        if (a.err === 'refused' || a.err === 'missing') { K.denied.bought = true; var m = ERR[a.err]; me.act = null; toast(m); load(); draw(); return; }
        if (a.err === 'offline' || a.err === 'other') { me.loading = false; load(); }
        drawLayer();
      });
    });
  }

  /* ---- undo (s84 1b): every successful write leaves a bar for 10 s and a line on the card for 15 min, for the person who made it */
  var UNDO_BAR_MS = 10000, UNDO_LINE_MS = 900000;
  function undoById(id) { return K.undos.filter(function (u) { return u.id === id; })[0] || null; }
  function undoFor(a, it, d, snap) {
    var id = 'u' + (++K.uidn), n = it.name, e = { id: id, itemId: it.id || null, name: n, at: nowMs(), kind: a.kind }, v = a.vals || {};
    if (a.kind === 'count' && d.movementId) {
      var cn = parseQty(v.qty, true); e.say = 'Counted ' + n + ': ' + fmt(cn); e.line = 'counted ' + fmt(cn);
      e.confirm = 'Put ' + n + ' back to ' + (snap && snap.qty != null ? fmt(snap.qty) : 'its old amount') + '?'; e.call = { fn: 'inventory_undo_v1', args: { p_movement_id: d.movementId, p_purchase_id: null } };
    } else if (a.kind === 'recv' && (d.movementId || d.purchaseId)) {
      e.say = 'Received ' + n; e.line = 'received stock'; e.confirm = 'Take the stock you just added to ' + n + ' back out?';
      e.call = { fn: 'inventory_undo_v1', args: { p_movement_id: d.movementId || null, p_purchase_id: d.purchaseId || null } };
    } else if (a.kind === 'price') {
      var b = 'before' in d ? num(d.before) : snap && snap.cost != null ? snap.cost : null;
      e.say = 'Price saved for ' + n; e.line = 'changed the price'; e.confirm = b == null ? 'Clear the price of ' + n + ' again?' : 'Put the price of ' + n + ' back to PHP ' + pesoNum(b) + '?';
      e.call = { fn: 'inventory_item_price_set_v1', args: { p_item_id: it.id, p_unit_cost: b } };
    } else if (a.kind === 'link' && a.code) {
      e.say = 'Linked a barcode to ' + n; e.line = 'linked a barcode'; e.confirm = 'Unlink code ' + shortCode(a.code) + ' from ' + n + '?'; e.call = { fn: 'inventory_code_detach_v1', args: { p_property_id: M.pid, p_code: a.code } };
    } else if (a.kind === 'unlink' && a.code) {
      e.say = 'Unlinked a barcode from ' + n; e.line = 'unlinked a barcode'; e.confirm = 'Link code ' + shortCode(a.code) + ' to ' + n + ' again?'; e.call = attachCall(M.pid, it, a.code, null);
    } else if (a.kind === 'create' && d.item_id) {
      var cnm = String(v.name || '').trim(); e.itemId = d.item_id; e.name = cnm; e.say = 'Added ' + cnm; e.line = 'added this item'; e.confirm = 'Remove ' + cnm + ' again?'; e.call = { fn: 'inventory_item_update_v1', args: { p_item_id: d.item_id, p_patch: { active: false } } };
    } else if ((a.kind === 'shop' || a.kind === 'low') && d.id) {
      e.say = a.kind === 'low' ? n + ' flagged as running low' : 'Added ' + n + ' to the shopping list'; e.line = a.kind === 'low' ? 'said it is running low' : 'added it to the shopping list'; e.confirm = 'Take ' + n + ' off the shopping list?';
      e.call = { fn: 'save_shopping_item_v1', args: { p_property_id: M.pid, p_item: { id: d.id, status: 'cancelled' }, p_idempotency_key: newKey('undo') } };
    } else if (a.kind === 'levels' && snap) {
      e.say = 'Levels saved for ' + n; e.line = 'changed the levels'; e.confirm = 'Put the levels of ' + n + ' back as they were?';
      e.call = { fn: 'inventory_item_update_v1', args: { p_item_id: it.id, p_patch: { reorder_below: snap.reorder == null ? null : snap.reorder, par_qty: snap.par == null ? null : snap.par } } };
    } else return null;
    return e;
  }
  function pushUndo(a, it, d, snap) {
    var e = undoFor(a, it, d, snap); if (!e) return;
    K.undos.unshift(e); if (K.undos.length > 20) K.undos.length = 20;
    drawUndo();
  }
  function pushUndoEntry(e) { K.undos.unshift(e); if (K.undos.length > 20) K.undos.length = 20; }
  function ago(ms) { var m = Math.floor(ms / 60000); return m < 1 ? 'just now' : m + ' min ago'; }
  function lastChange(it) {
    var e = K.undos.filter(function (u) { return u.itemId === it.id && nowMs() - u.at < UNDO_LINE_MS && !K.denied[u.call.fn]; })[0];
    return e ? '<p class="help I_last">Last change: ' + esc(e.line) + ' by you, ' + ago(nowMs() - e.at) + '. <button class="btn btn-ghost I_undobtn" type="button" data-act="undo" data-id="' + e.id + '"><span aria-hidden="true">↶</span> Undo</button></p>' : '';
  }
  function drawUndo() {
    var box = q('[data-i-undo]'); if (!box) return;
    var e = K.undos.filter(function (u) { return !K.denied[u.call.fn] && (nowMs() - u.at < UNDO_BAR_MS || (M.undoHold === u.id)); })[0];
    if (!e || M.act) { box.innerHTML = ''; return; } // a sheet is open: the card shows the Last change line instead
    box.innerHTML = '<div class="I_undo" role="status"><span class="I_undot">' + esc(e.say) + '</span><button class="btn btn-secondary I_undob" type="button" data-act="undo" data-id="' + e.id + '"><span aria-hidden="true">↶</span> Undo</button></div>';
    if (M.undoT && root.clearTimeout) root.clearTimeout(M.undoT);
    if (root.setTimeout && M.undoHold !== e.id) { var me = M; M.undoT = root.setTimeout(function () { if (M === me) drawUndo(); }, Math.max(0, UNDO_BAR_MS - (nowMs() - e.at)) + 1); }
  }
  function onFocus(ev) { var t = ev.target; if (M && t && attr(t, 'data-act') === 'undo') { var e = undoById(attr(t, 'data-id')); if (e) M.undoHold = e.id; } }
  function onBlur(ev) { var t = ev.target; if (M && M.undoHold && t && attr(t, 'data-act') === 'undo') { var e = undoById(M.undoHold); M.undoHold = null; if (e) e.at = nowMs() - UNDO_BAR_MS + 3000; drawUndo(); } } // leaving the button gives it 3 more seconds

  /* ---- scan (s84): BarcodeDetector where the phone has it, always a typed code */
  var WANT = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
  function camOK() { return !!(root.BarcodeDetector && typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
  function stopTracks(st) { try { if (st && st.getTracks) st.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* already stopped */ } }
  function bindVideo() {
    var c = M && M.cam, v = c && c.stream && q('[data-i-video]'); if (!v) return;
    if (v.srcObject !== c.stream) v.srcObject = c.stream;
    if (v.play) { try { var p = v.play(); if (p && p.catch) p.catch(function () { /* autoplay blocked: the picture still shows once tapped */ }); } catch (e) { /* no play */ } }
  }
  function stopCam() {
    var c = M && M.cam; if (!c) return;
    c.on = false; M.cam = null;
    if (c.timer && root.clearInterval) root.clearInterval(c.timer);
    stopTracks(c.stream);
    var v = q('[data-i-video]'); if (v) v.srcObject = null;
  }
  function pauseCam() { stopCam(); var a = M && M.act; if (a && a.kind === 'scan' && a.phase === 'look') { a.camState = 'paused'; drawLayer(); } }
  function startCam() {
    var me = M, a = me && me.act; if (!a || a.kind !== 'scan' || me.cam) return;
    if (!camOK()) { a.camState = 'none'; drawLayer(); return; }
    var cam = me.cam = { on: true, stream: null, timer: null, busy: false, det: null };
    a.camState = 'starting'; drawLayer();
    Promise.resolve().then(function () { return root.BarcodeDetector.getSupportedFormats ? root.BarcodeDetector.getSupportedFormats() : WANT; }).then(function (sup) {
      if (!cam.on || me.dead) return null; // closed while the formats were being read: no camera request at all
      var f = WANT.filter(function (x) { return (sup || WANT).indexOf(x) >= 0; });
      if (!f.length) { me.cam = null; cam.on = false; a.camState = 'none'; typingRedraw(); return null; }
      cam.det = new root.BarcodeDetector(f.length ? { formats: f } : undefined);
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    }).then(function (stream) {
      if (!cam.on || me.dead) { stopTracks(stream); return; }
      cam.stream = stream; a.camState = 'live';
      cam.timer = root.setInterval(function () { tickCam(cam); }, 250); // not every frame
      typingRedraw();
    }, function (e) {
      if (!cam.on || me.dead) return;
      me.cam = null; cam.on = false;
      a.camState = e && /NotAllowed|Security|Permission/i.test(String(e.name || e.message)) ? 'denied' : 'failed'; typingRedraw();
    });
  }
  // A redraw while the person is typing the code must not drop the keyboard (L3).
  function typingRedraw() { var d = root.document, typing = !!(d && d.activeElement && d.activeElement.id === 'I_f_code'); drawLayer(); if (typing) refocus('I_f_code'); }
  function tickCam(cam) {
    if (!cam.on || cam.busy || !M || M.cam !== cam) return;
    var v = q('[data-i-video]'); if (!v) return;
    cam.busy = true;
    Promise.resolve().then(function () { return cam.det.detect(v); }).then(function (res) {
      cam.busy = false;
      if (cam.on && M && M.cam === cam && res && res[0] && res[0].rawValue) handleCode(res[0].rawValue, res[0].format);
    }, function () { cam.busy = false; });
  }
  function enterLook(a) {
    a.kind = 'scan'; a.phase = 'look'; a.err = null; a.note = null; a.takenId = null; a.sg = null; a.vals = { code: K.lastCode || '' }; a.focused = false; a.camState = undefined;
    drawLayer(); startCam();
  }
  function openScan(itemId) {
    K.scanned = null;
    M.act = { kind: 'scan', mode: itemId ? 'link' : 'find', itemId: itemId || undefined };
    enterLook(M.act);
  }
  function handleCode(raw, format) {
    var a = M && M.act; if (!a || a.kind !== 'scan' || a.phase !== 'look') return;
    var code = normCode(raw);
    if (!validCode(code)) { a.err = 'badcode'; drawLayer(); return; }
    K.lastCode = code; // a typo is fixed, not retyped
    stopCam(); // the camera is off before anything else
    var hit = codeIndex(K.items)[code], f = format && /^[a-z0-9_]{2,20}$/.test(format) ? format : null;
    a.code = code; a.format = f; a.err = null; a.takenId = null;
    if (a.mode === 'link') {
      if (hit === a.itemId) { a.note = 'That code is already linked to this item.'; a.camState = 'paused'; a.sg = null; return drawLayer(); }
      if (hit) { var o = itemById(hit); a.err = 'taken'; a.takenId = hit; a.takenName = o ? o.name : ''; a.camState = 'paused'; a.sg = null; return drawLayer(); }
      M.act = { kind: 'link', step: 'confirm', pickId: a.itemId, itemId: a.itemId, code: code, format: f, mode: 'link' }; return drawLayer();
    }
    if (hit && itemById(hit)) { K.scanned = hit; return go('#stock/item/' + hit, 'item/' + hit, hit); }
    a.phase = 'unknown'; a.camState = undefined; a.focused = false; drawLayer();
  }
  function flowBack(a) {
    if (a.kind === 'unlink' || a.kind === 'history') { M.act = newMenu(a.itemId); drawLayer(); return; }
    if (a.kind === 'bought') { if (a.step === 'confirm') { a.step = 'pick'; a.err = null; drawLayer(); return; } if (a.step === 'undoconfirm') { a.step = 'done'; a.err = null; drawLayer(); return; } return closeSheet(); }
    if (a.kind === 'undo') { M.act = route().itemId ? newMenu(route().itemId) : null; drawLayer(); return; }
    if (a.kind === 'report') { if (a.step === 'confirm') { a.step = 'form'; a.err = null; drawLayer(); return; } return closeSheet(); }
    if (a.kind === 'create') { if (a.step === 'confirm') { a.step = 'form'; a.err = null; a.takenId = null; drawLayer(); return; } a.kind = 'scan'; a.phase = 'unknown'; a.err = null; a.sg = null; drawLayer(); return; }
    if (a.kind === 'link') { a.kind = 'scan'; a.err = null; a.takenId = null; if (a.fromPick) { a.phase = 'pick'; a.vals = { find: '' }; drawLayer(); return; } return enterLook(a); }
    if (a.phase === 'pick') { a.phase = 'unknown'; drawLayer(); return; }
    if (a.phase === 'unknown') return enterLook(a);
    return closeSheet();
  }
  function toast(msg) { say(msg); if (M && M.opts.toast) M.opts.toast(msg); }
  function finish() { if (!M) return; var fromShop = M.act && (M.act.shopId || M.act.fromShop); if (fromShop) { M.act = null; drawLayer(); draw(); } else closeSheet(); }

  root.I_Stock = { mount: mount, unmount: unmount, lib: {
    esc: esc, canPrice: canPrice, groupsFor: groupsFor, codeIndex: codeIndex, I_codeIndex: codeIndex, normCode: normCode, validCode: validCode, attachCall: attachCall, priceCall: priceCall, levelsCall: levelsCall, createCall: createCall, reportCall: reportCall, REPORTS: REPORTS, normalize: normalize, normalizeCatalogue: normalizeCatalogue, level: level, summary: summary, chipsFor: chipsFor, visible: visible, barPct: barPct, parseQty: parseQty, stepQty: stepQty,
    newKey: newKey, errKind: errKind, ERR: ERR, countCall: countCall, usageCall: usageCall, receiptCall: receiptCall, shopAddCall: shopAddCall, shopSetCall: shopSetCall, normalizeShop: normalizeShop,
    manilaToday: manilaToday, demoItems: demoItems, PROPERTY_ID: PROPERTY_ID, canManage: canManage, canUse: canUse
  } };
})(typeof window !== 'undefined' ? window : this);
