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
      par: num(raw.par), codes: Array.isArray(raw.codes) ? raw.codes.map(String) : []
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
  function visible(items, chip, q) {
    var s = String(q || '').trim().toLowerCase(), out = items.filter(function (i) {
      if (s && i.name.toLowerCase().indexOf(s) < 0) return false;
      if (chip === 'cons') return i.consumable;
      if (chip.indexOf('c:') === 0) return i.category === chip.slice(2);
      return true;
    });
    return chip === 'all' || chip.indexOf('c:') === 0 ? out.sort(byName) : out.sort(function (a, b) { return RANK[level(a)] - RANK[level(b)] || byName(a, b); });
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
    financeOnly: 'Prices go to the Finance group only. Choose the OPS group instead.',
    levels: 'Buy up to should be the same as or more than the reorder level.'
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
    var d = function (id, name, cat, unit, qty, re, cons, cost, pu, pp) { return { id: id, name: name, category: cat, unit: unit, qty: qty, reorderBelow: re, consumable: cons, active: true, unitCost: cost, purchaseUnit: pu || null, unitsPerPurchase: pp || 1, estCoverageDays: re ? Math.round(qty / re * 10) : null, par: re && cons ? re * 2 : null, codes: id === 'd1' ? ['4800000000011'] : id === 'd3' ? ['4800000000028'] : [] }; };
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
  var K = { items: null, shop: null, q: '', chip: 'low', role: null, at: 0, keys: {}, v84: false, lastCode: '', cool: {}, scanned: null }; // survives unmount: the list shows at once while it refreshes
  var M = null; // the live mount

  function mount(el, opts) {
    unmount();
    opts = opts || {};
    if (K.role !== opts.role) { K.role = opts.role; K.items = null; K.shop = null; K.q = ''; K.chip = 'low'; K.at = 0; K.keys = {}; K.v84 = false; K.lastCode = ''; K.cool = {}; K.scanned = null; } // a cached list is never shown to another role
    M = {
      el: el, opts: opts, role: opts.role, demo: !!opts.demo, client: opts.client || null, pid: opts.propertyId || PROPERTY_ID,
      sub: String(opts.sub || ''), act: null, denied: {}, uid: null, loadErr: null, shopErr: null, loading: false, offlineStale: false, itemInfo: {}, listeners: []
    };
    el.innerHTML = '<div class="I_wrap"><div data-i-top></div><div data-i-list></div><div data-i-layer></div><div class="I_live sr" role="status" aria-live="polite" data-i-live></div></div>';
    var on = function (type, fn) { el.addEventListener(type, fn); M.listeners.push([type, fn]); };
    on('click', onClick); on('input', onInput); on('submit', onSubmit); on('keydown', onKey);
    M.vis = function () { if (M && root.document && root.document.hidden && M.cam) pauseCam(); };
    if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', M.vis);
    if (M.demo) { K.items = demoItems().map(function (r) { return normalize(r, M.role); }); K.shop = normalizeShop(demoShop(), null); K.v84 = true; }
    else if (M.client && M.client.auth && M.client.auth.getSession) { try { M.client.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; M.uid = s && s.user ? s.user.id : null; }, function () {}); } catch (e) { /* no uid: rows read "Asked by staff" */ } }
    draw();
    if (!M.demo && !(K.items && K.at && nowMs() - K.at < 60000)) load(); // a fresh list for this role is kept when only the sub-route changed
    else if (!M.demo) loadShopSoon();
    return M;
  }
  function unmount() {
    if (!M) return;
    M.listeners.forEach(function (l) { M.el.removeEventListener && M.el.removeEventListener(l[0], l[1]); });
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
      if (items) { K.items = items; K.v84 = r.data.items.some(function (x) { return x && 'codes' in x; }); K.at = nowMs(); me.loadErr = null; me.offlineStale = false; }
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
  function newMenu(id) { var scanned = K.scanned === id; if (scanned) K.scanned = null; return { kind: 'menu', itemId: id, scanned: scanned }; } // scanned: the right action first
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
    if (rt.itemId && K.items && (!M.act || M.act.itemId !== rt.itemId)) { var it = itemById(rt.itemId); if (it) { M.act = newMenu(rt.itemId); loadLastCount(rt.itemId); } }
    if (!rt.itemId && M.act && M.act.itemId) M.act = null;
    drawLayer();
  }
  function renderTop(rt) {
    var h = '', n = K.shop ? K.shop.length : 0;
    h += '<div class="seg I_tabs" role="group" aria-label="Inventory views">' +
      '<button class="btn btn-secondary" type="button" data-act="tab" data-to="" aria-pressed="' + !rt.shopping + '">Items</button>' +
      '<button class="btn btn-secondary" type="button" data-act="tab" data-to="shopping" aria-pressed="' + rt.shopping + '">Shopping list' + (n ? ' ' + n : '') + '</button></div>';
    if (rt.shopping) return h;
    if (K.items) {
      var s = summary(K.items);
      h += '<section class="card glass I_sum ' + (s.low ? 'I_sumlow' : 'I_sumok') + '" aria-label="Stock summary"><span class="I_g" aria-hidden="true">' + (s.low ? LEVELS.low.glyph : LEVELS.ok.glyph) + '</span><div><div class="I_sumt">' +
        (s.low ? s.low + (s.low === 1 ? ' item low' : ' items low') : 'Stock is fine') + '</div>' + (s.out ? '<div class="help">' + s.out + (s.out === 1 ? ' is' : ' are') + ' out</div>' : '') + '</div></section>';
      h += '<div class="I_srow"><div class="field"><label for="I_q">Search items</label><div class="input"><input id="I_q" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(K.q) + '" placeholder="Toilet paper"></div></div>' +
        (K.v84 ? '<button class="btn btn-secondary I_scanbtn" type="button" data-act="scan"><span aria-hidden="true">▥</span> Scan</button>' : '') + '</div>';
      h += '<div class="row-wrap I_chips" role="group" aria-label="Show">' + chipsFor(K.items).map(function (c) { return '<button class="chip" type="button" data-act="chip" data-k="' + esc(c.k) + '" aria-pressed="' + (K.chip === c.k) + '">' + esc(c.t) + '</button>'; }).join('') + '</div>';
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
    var hot = g.low + g.out, note = hot ? '<span class="I_ghn"><span aria-hidden="true">▲</span> ' + hot + ' low' + (g.out ? ', ' + g.out + ' out' : '') + '</span>' : '';
    return '<section class="I_grp"' + (header ? ' aria-labelledby="I_gh_' + n + '"' : '') + '>' + (header ? '<h3 class="I_gh" id="I_gh_' + n + '"><span>' + esc(g.cat) + '</span>' + note + '</h3>' : '') + '<div class="card list I_list">' + g.rows.map(renderRow).join('') + '</div></section>';
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
    h += '<div class="card list I_list">' + K.shop.map(function (r) {
      var who = r.mine ? 'You asked' : 'Asked by staff', when = dateLabel(r.at);
      var tag = canManage(M.role) ? 'button' : 'div';
      return '<' + tag + ' class="rowi I_row"' + (tag === 'button' ? ' type="button" data-act="shop-open" data-id="' + esc(r.id) + '"' : '') + '><span class="mid"><span class="t">' + esc(r.name) + '</span><span class="s">' + (r.qty != null ? fmt(r.qty) + ' ' + esc(r.unit || '') : '') + ' · ' + who + (when ? ', ' + when : '') + '</span>' +
        (r.note ? '<span class="s">' + esc(r.note) + '</span>' : '') + '</span><span class="I_lv ' + (r.status === 'approved' ? 'I_ok' : 'I_low') + '"><span aria-hidden="true">' + (r.status === 'approved' ? '✓' : '○') + '</span> ' + (r.status === 'approved' ? 'Approved' : 'Asked') + '</span></' + tag + '>';
    }).join('') + '</div>';
    return h;
  }

  /* ---- the sheet */
  function drawLayer() {
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
    if (a.kind === 'scan') return renderScan(a);
    if (a.kind === 'report') return renderReport(a);
    if (a.kind === 'create') return renderCreate(a);
    var it = itemOf(a); if (!it) return null;
    var v = a.vals || {}, m = M.role, h;
    if (a.kind === 'link') return head('Link code ' + shortCode(a.code) + ' to ' + it.name + '?') + '<form data-i-form><p class="I_conf">Scanning this code will open ' + esc(it.name) + '.</p>' + actions(a, 'Yes, link it') + '</form>';
    if (a.kind === 'menu') {
      var info = M.itemInfo[it.id], shopN = (K.shop || []).filter(function (r) { return r.itemId === it.id; }).length, cover = it.cover != null ? fmt(it.cover) + ' days' : it.coverEst != null ? 'about ' + fmt(it.coverEst) + ' days (an estimate)' : '';
      h = head(it.name, it.category + (it.consumable ? ' · consumable' : '')) + '<p class="I_lvline">' + levelBadge(it) + '</p><dl class="I_dl">' +
        row('On hand', it.qty == null ? 'Not counted' : esc(fmt(it.qty) + ' ' + it.unit)) + row('Reorder at', it.reorder == null ? 'Not set' : esc(fmt(it.reorder) + ' ' + it.unit)) +
        (K.v84 && (it.consumable || it.par != null) ? row('Buy up to', it.par != null ? esc(fmt(it.par) + ' ' + it.unit) : it.reorder != null ? esc('2 x reorder level (' + fmt(it.reorder * 2) + ')') : 'Not set') : '') +
        (K.v84 && canManage(m) ? row('Barcodes', it.codes.length ? it.codes.length + ' linked' : 'None linked') : '') +
        (canManage(m) && info && info.done ? row('Last counted', info.lastCounted ? esc(dateLabel(info.lastCounted)) : 'Not counted in the app yet') : '') +
        (cover ? row('Lasts', esc(cover)) : '') + (canPrice(m) && it.cost != null ? row('Unit cost', esc(peso(it.cost))) : '') + '</dl>' +
        (M.denied.shop ? '' : shopN ? '<p class="help">Already on the shopping list.</p>' : '') + (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') + errBox(a) +
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
      return head(c ? (pc == null ? 'Clear the price of ' + it.name + '?' : 'Set the price of ' + it.name + ' to PHP ' + pesoNum(pc) + '?') : 'Change price: ' + it.name, c ? null : 'The price paid for one ' + unitOf(it) + '.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Only the owner, admin and finance can see prices.</p>' : textField('cost', 'Price per ' + esc(unitOf(it)) + ' in PHP (leave empty to clear)', v.cost || '', 'inputmode="decimal"') + (a.bad ? '<div class="field"><span class="err">▲ Enter a number such as 95 or 95.50.</span></div>' : '')) +
        actions(a, c ? 'Yes, save it' : 'Continue') + '</form>';
    }
    if (a.kind === 'levels') {
      return head(c ? 'Save the levels for ' + it.name + '?' : 'Edit levels: ' + it.name, c ? null : 'Leave a box empty to clear it.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Reorder at ' + esc(String(v.reorder || '').trim() === '' ? 'not set' : v.reorder) + '. Buy up to ' + esc(String(v.par || '').trim() === '' ? 'not set' : v.par) + '.</p>'
          : textField('reorder', 'Reorder at (' + esc(unitOf(it)) + ')', v.reorder || '', 'inputmode="decimal"') + textField('par', 'Buy up to (' + esc(unitOf(it)) + ')', v.par || '', 'inputmode="decimal"') + (a.bad ? '<div class="field"><span class="err">▲ ' + esc(a.bad === 'levels' ? ERR.levels : 'Enter numbers such as 12 or 2.5.') + '</span></div>' : '')) +
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
    else if (cs === 'none') cam = '<p class="help" role="status">This phone cannot read a barcode here. Type the code under it.</p>';
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
      (money && !M.noFinance ? '<div class="I_pickrows" role="group" aria-label="Send to"><button class="chip I_choice" type="button" data-act="rep-to" data-to="finance" aria-pressed="' + fin + '">' + (fin ? '<span aria-hidden="true">✓</span> ' : '') + 'Finance group (with prices)</button><button class="chip I_choice" type="button" data-act="rep-to" data-to="ops" aria-pressed="' + !fin + '">' + (!fin ? '<span aria-hidden="true">✓</span> ' : '') + 'OPS group (no prices)</button></div>' : '<p class="help">It goes to the OPS group.</p>') +
      (a.bad ? '<div class="field"><span class="err">▲ That list was just sent. Please wait half a minute.</span></div>' : '') + actions(a, 'Continue') + '</form>';
  }
  // The action buttons of the item card. A scanned card puts the most useful action for the role first (owner/admin count, finance price, cleaner shopping list).
  function menuButtons(it, a) {
    var m = M.role, b = function (kind, text, primary, act) { return '<button class="btn ' + (primary ? 'btn-primary' : 'btn-secondary') + ' btn-block" type="button" data-act="' + (act || 'begin') + '" data-kind="' + kind + '">' + text + '</button>'; };
    var list = [];
    if (allowed('count')) list.push(['count', 1, 'Count it']);
    if (allowed('used')) list.push(['used', 1, 'Used some']);
    if (allowed('price')) list.push(['price', 0, 'Change price']);
    if (allowed('recv', it)) list.push(['recv', 0, 'Stock received']);
    else if (canManage(m) && it.controlled) list.push(['admin', 0, '<p class="help I_more"><a href="#door/inventory" data-act="admin">Receive this one in the admin dashboard</a></p>']);
    if (allowed('levels')) list.push(['levels', 0, 'Edit levels']);
    if (allowed('link')) list.push(['link', 0, 'Link a barcode']);
    if (allowed('shop')) list.push(['shop', 0, 'Add to shopping list']);
    if (a && a.scanned) { var want = canManage(m) ? 'count' : canPrice(m) ? 'price' : 'shop', at = -1; list.forEach(function (x, i) { if (x[0] === want) at = i; }); if (at > 0) { list.unshift(list.splice(at, 1)[0]); list.forEach(function (y, i) { y[1] = i === 0 ? 1 : 0; }); } }
    return list.map(function (x) { return x[0] === 'admin' ? x[2] : x[0] === 'link' ? b('link', x[2], 0, 'begin-link') : b(x[0], x[2], x[1]); }).join('');
  }
  function renderShopSheet(a) {
    var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!r) return null;
    return head(r.name, (r.qty != null ? fmt(r.qty) + ' ' + (r.unit || '') : '') + ' · ' + (r.status === 'approved' ? 'Approved' : 'Asked')) + (r.note ? '<p>' + esc(r.note) + '</p>' : '') + (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') + errBox(a) +
      '<div class="I_btns">' + (r.status === 'proposed' && !M.denied.shopset ? '<button class="btn btn-primary btn-block" type="button" data-act="shop-do" data-do="approved">Approve</button>' : '') +
      (r.status === 'approved' && r.itemId && allowed('recv', itemById(r.itemId)) ? '<button class="btn btn-primary btn-block" type="button" data-act="shop-bought">Mark bought</button>' : r.status === 'approved' && r.itemId && itemById(r.itemId) && itemById(r.itemId).controlled ? '<p class="help I_more"><a href="#door/inventory" data-act="admin">Receive this one in the admin dashboard</a></p>' : '') +
      (M.denied.shopset ? '' : '<button class="btn btn-secondary btn-block" type="button" data-act="shop-do" data-do="rejected">Remove from the list</button>') + '<button class="btn btn-ghost btn-block" type="button" data-act="close">Close</button></div>';
  }

  /* ---- events */
  function attr(t, name) { return t && t.getAttribute ? t.getAttribute(name) : null; }
  function onClick(ev) {
    if (!M) return;
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null; if (!t) return;
    var act = attr(t, 'data-act');
    if (act === 'admin') { if (ev.preventDefault) ev.preventDefault(); M.opts.navigate && M.opts.navigate('#door/inventory'); return; }
    if (act === 'tab') return go(attr(t, 'data-to') ? '#stock/' + attr(t, 'data-to') : '#stock', attr(t, 'data-to') || '');
    if (act === 'chip') { K.chip = attr(t, 'data-k'); draw(); return; }
    if (act === 'showall') { K.chip = 'all'; K.q = ''; draw(); return; }
    if (act === 'scan') { if (M.act && M.act.sending) return; return openScan(null); }
    if (act === 'report') { if (!allowed('report') || (M.act && M.act.sending)) return; M.act = { kind: 'report', step: 'form', vals: { rkind: 'order', to: 'ops' } }; drawLayer(); return; }
    if (act === 'retry') { M.loadErr = null; M.shopErr = null; M.loading = false; if (!K.items) draw(); load(); return; }
    if (act === 'open') return go('#stock/item/' + attr(t, 'data-id'), 'item/' + attr(t, 'data-id'), attr(t, 'data-id'));
    if (act === 'shop-open') { if (!canManage(M.role)) return; M.act = { kind: 'menu', shopId: attr(t, 'data-id') }; drawLayer(); return; }
    var a = M.act;
    if (act === 'close') return closeSheet();
    if (!a) return;
    if (a.sending) return; // nothing, not even Close, while a write is in flight
    if (act === 'begin') return begin(attr(t, 'data-kind'));
    if (act === 'begin-link') { if (allowed('link') && a.itemId) openScan(a.itemId); return; }
    if (act === 'cam-start') { startCam(); return; }
    if (act === 'open-taken') { var tid = attr(t, 'data-id'); stopCam(); K.scanned = tid; return go('#stock/item/' + tid, 'item/' + tid, tid); }
    if (act === 'scan-pick') { if (allowed('link')) { a.phase = 'pick'; a.vals = { find: '' }; a.focused = false; drawLayer(); } return; }
    if (act === 'scan-new') { if (allowed('create')) { M.act = { kind: 'create', step: 'form', code: a.code, format: a.format, mode: a.mode, vals: { name: '', category: '', unit: 'pc', cons: 'no', qty: '', reorder: '' } }; drawLayer(); } return; }
    if (act === 'pick') { if (a.phase !== 'pick' || !allowed('link')) return; M.act = { kind: 'link', step: 'confirm', pickId: attr(t, 'data-id'), code: a.code, format: a.format, mode: a.mode, fromPick: true }; drawLayer(); return; }
    if (act === 'rep-kind') { a.vals.rkind = attr(t, 'data-k'); a.bad = false; drawLayer(); return; }
    if (act === 'rep-to') { a.vals.to = attr(t, 'data-to') === 'finance' && !M.noFinance ? 'finance' : 'ops'; a.bad = false; drawLayer(); return; }
    if (act === 'back') { if (/^(scan|link|create|report)$/.test(a.kind)) return flowBack(a); if (a.kind === 'shopset') { a.kind = 'menu'; a.step = null; a.err = null; drawLayer(); } else if (a.fromShop && a.step !== 'confirm') { M.act = null; drawLayer(); } else if (a.step === 'confirm') { a.step = 'form'; a.err = null; drawLayer(); } else if (a.shopId) { a.kind = 'menu'; a.err = null; drawLayer(); } else { a.kind = 'menu'; a.vals = null; a.step = null; a.err = null; a.bad = false; drawLayer(); } return; }
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
    var id = M.act && M.act.itemId;
    M.act = null;
    if (route().itemId) { M.sub = ''; if (M.opts.navigate) M.opts.navigate('#stock'); }
    if (M) { drawLayer(); if (id) { var b = q('[data-id="' + id + '"]'); if (b && b.focus) b.focus(); } }
  }
  function allowed(kind, it) {
    var m = M.role;
    if (kind === 'count') return I_FLAGS.count && canManage(m) && !M.denied.count;
    if (kind === 'used') return I_FLAGS.usage && canUse(m) && !M.denied.used;
    if (kind === 'recv') return canManage(m) && !M.denied.recv && !(it && it.controlled);
    if (kind === 'shop') return !M.denied.shop;
    if (kind === 'price') return K.v84 && canPrice(m) && !M.denied.price;
    if (kind === 'levels') return K.v84 && canManage(m) && !M.denied.levels;
    if (kind === 'link') return K.v84 && canManage(m) && !M.denied.link;
    if (kind === 'create') return K.v84 && canManage(m) && !M.denied.create;
    if (kind === 'report') return !M.denied.report;
    return false;
  }
  function begin(kind) {
    if (!allowed(kind, itemById(M.act.itemId))) return;
    var a = M.act, it = itemById(a.itemId), defaults = { count: { qty: it && it.qty != null ? fmt(it.qty) : '0', note: '' }, used: { qty: '1' }, recv: { packs: '1', supplier: '', cost: '' }, shop: { qty: '1', note: '' },
      price: { cost: it && it.cost != null ? fmt(it.cost) : '' }, levels: { reorder: it && it.reorder != null ? fmt(it.reorder) : '', par: it && it.par != null ? fmt(it.par) : '' } };
    a.kind = kind; a.step = 'form'; a.vals = defaults[kind]; a.err = null; a.bad = false; a.key = null; a.sig = null; a.focused = false; drawLayer();
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
    if (a.kind === 'scan') { if (a.phase === 'look') handleCode((a.vals || {}).code, null); return; }
    if (a.step !== 'confirm') { if (!valid(a)) { a.bad = a.kind === 'levels' && optQty(a.vals.reorder) && optQty(a.vals.par) ? 'levels' : true; drawLayer(); return; } a.bad = false; a.step = 'confirm'; a.err = null; a.focused = false; drawLayer(); return; }
    commit(a);
  }

  /* ---- the write */
  function build(a) {
    var it = itemOf(a), today = manilaToday(nowMs()), sig = JSON.stringify([a.kind, a.itemId || a.pickId || a.shopId, a.vals, a.status, a.code]);
    var ke = K.keys[sig]; // one key per set of values, kept even if the sheet is reopened; dropped on success; forgotten after 10 minutes (a write that landed unseen must not replay a later identical one)
    if (!ke || nowMs() - ke.at > 600000) ke = K.keys[sig] = { key: newKey(a.kind), at: nowMs() };
    a.sig = sig; a.key = ke.key;
    if (a.kind === 'count') return countCall(it, a.vals, a.key);
    if (a.kind === 'used') return usageCall(M.pid, it, a.vals, a.key, today);
    if (a.kind === 'recv') return receiptCall(it, a.vals, a.key, today);
    if (a.kind === 'shop') return shopAddCall(M.pid, it, a.vals, a.key);
    if (a.kind === 'link') return attachCall(M.pid, it, a.code, a.format);
    if (a.kind === 'price') return priceCall(it, a.vals);
    if (a.kind === 'levels') return levelsCall(it, a.vals);
    if (a.kind === 'create') return createCall(M.pid, a.vals, a.code, a.format, a.key);
    if (a.kind === 'report') return reportCall(a.vals);
    var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0];
    return shopSetCall(M.pid, r, a.status, a.key);
  }
  var DONE = { count: function (it) { return 'Counted. ' + it.name + ' is saved.'; }, used: function () { return 'Logged. Thank you.'; }, recv: function (it) { return 'Stock received for ' + it.name + '.'; }, shop: function () { return 'Added to the shopping list.'; }, shopset: function (it, a) { return a.status === 'approved' ? 'Approved.' : 'Removed from the list.'; },
    link: function (it) { return 'Linked. Scanning it now opens ' + it.name + '.'; }, price: function (it) { return 'Price saved for ' + it.name + '.'; }, levels: function (it) { return 'Levels saved for ' + it.name + '.'; },
    create: function (it, a) { return 'Added ' + String(a.vals.name).trim() + '.'; }, report: function (it, a) { return 'Sent to the ' + (a.vals.to === 'finance' ? 'Finance' : 'OPS') + ' group.'; } };
  function bodyOf(e) { try { return e && e.context && typeof e.context.json === 'function' ? Promise.resolve(e.context.json()).catch(function () { return null; }) : null; } catch (x) { return null; } }
  var NEWK = { link: 1, price: 1, levels: 1, create: 1, report: 1 }; // actions that hide for the visit when the server says "not here"
  function commit(a) {
    var me = M, it = itemOf(a) || { name: a.rowName || '' }, call = build(a), rep = a.kind === 'report';
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
    if (why === 'finance_only') { me.noFinance = true; a.vals.to = 'ops'; a.step = 'form'; a.err = 'financeOnly'; return drawLayer(); }
    a.err = errKind(e, online());
    if (!rep && (a.err === 'offline' || a.err === 'other')) { me.loading = false; load(); } // the write may have landed: look again
    if (a.err === 'refused' || (a.err === 'missing' && NEWK[a.kind])) { // the server decides: calm line, and the action goes away
      me.denied[a.kind] = true;
      if (a.kind === 'shopset') { a.kind = 'menu'; }
      else if (a.itemId && !rep && a.kind !== 'create') { a.kind = 'menu'; a.vals = null; a.step = null; }
      else { var m = ERR[a.err]; me.act = null; toast(m); }
    }
    drawLayer();
  }

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
      var f = WANT.filter(function (x) { return (sup || WANT).indexOf(x) >= 0; });
      cam.det = new root.BarcodeDetector(f.length ? { formats: f } : undefined);
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    }).then(function (stream) {
      if (!cam.on || me.dead) { stopTracks(stream); return; }
      cam.stream = stream; a.camState = 'live';
      cam.timer = root.setInterval(function () { tickCam(cam); }, 250); // not every frame
      drawLayer();
    }, function (e) {
      if (!cam.on || me.dead) return;
      me.cam = null; cam.on = false;
      a.camState = e && /NotAllowed|Security|Permission/i.test(String(e.name || e.message)) ? 'denied' : 'failed'; drawLayer();
    });
  }
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
    stopCam();
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
