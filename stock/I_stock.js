/* Cascade Staff - native Inventory screen (lane I, session 82). Plain script, no build step.
   Mounted by the shell as window.I_Stock.mount(el, { client, demo, role, sub, navigate, toast, haptic, propertyId? }).
   Money rule: a cleaner never sees or keeps a cost. normalize() never reads unitCost for any role but owner/admin/finance.
   Every write: a confirm step, one idempotency key per confirmed set of values (kept across a retry), a disabled button while
   sending, a toast, a refreshed list. Offline is an inline line, never a queue. */
(function (root) {
  'use strict';

  var PROPERTY_ID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'; // same constant as the shell's CFG.propertyId; opts.propertyId wins
  var DEMO_NOTE = 'Demo only, nothing was saved.';
  // Owner decision 2026-10-13: counts move to the app (a first count is one-way). s85: Used some is on for the cleaner (Lloyd: staff had no way to update the amount or record use). Read once; the test hook is window.I_STOCK_FLAGS.
  var I_FLAGS = { count: true, usage: true };
  if (root.I_STOCK_FLAGS) { I_FLAGS.count = !!root.I_STOCK_FLAGS.count; I_FLAGS.usage = !!root.I_STOCK_FLAGS.usage; }

  /* ------------------------------------------------------------------ pure helpers (exported as I_Stock.lib) */
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function gi(name, size) { return root.ICON ? root.ICON(name, size) : ''; } // the shell's Lucide ICON(), 20 px unless a size class is given
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = typeof v === 'number' ? v : (v == null || v === '' ? NaN : parseFloat(v)); return isFinite(n) ? n : null; }
  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
  // Unit word for a count: 1 roll, 2 rolls. Units are free text and may be stored either way (rolls, pack), so one strips a trailing s and the rest add one.
  // ponytail: short units (kg, ml, pc, box) are left as typed; irregular plurals are not handled, add when a real unit needs it.
  function unitWord(n, u) { var w = String(u == null ? '' : u).trim(); if (!/^[A-Za-z]{4,}$/.test(w)) return w; if (Math.abs(n) === 1) return /s$/i.test(w) && !/ss$/i.test(w) ? w.slice(0, -1) : w; return /s$/i.test(w) ? w : w + 's'; }
  function uq(n, u) { return fmt(n) + ' ' + unitWord(Number(n), u); }
  function canManage(role) { return role === 'owner' || role === 'admin'; }
  function canPrice(role) { return role === 'owner' || role === 'admin' || role === 'finance'; } // the server sends unitCost only to these three
  function canCount(role) { return role === 'owner' || role === 'admin' || role === 'cleaner'; } // s85: the cleaner counts too; the server decides (42501 hides Count for the visit)
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
      counted: raw.countedAt ? String(raw.countedAt) : null, par: num(raw.par), codes: Array.isArray(raw.codes) ? raw.codes.map(String) : [],
      photo: raw.photo ? String(raw.photo) : null, location: raw.location ? String(raw.location) : '',
      supplier: raw.supplier && raw.supplier.name ? { id: raw.supplier.id ? String(raw.supplier.id) : null, name: String(raw.supplier.name), location: raw.supplier.location ? String(raw.supplier.location) : '' } : null // s86: name and place for every role, never a price
    };
    if (canPrice(role)) { it.cost = num(raw.unitCost); it.lastPrice = num(raw.lastPrice); it.priceUp = num(raw.priceUp); }
    return it;
  }
  // s86 photos: the long side is capped at 800 px with the aspect kept; a small picture is never enlarged.
  function fitSize(w, h, max) {
    var m = max || 800, s = Math.min(1, m / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function phpText(n) { var v = Math.round(Number(n) * 100) / 100; return 'PHP ' + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var UNITS = ['pc', 'piece', 'roll', 'bottle', 'pack', 'sachet', 'box', 'pair', 'set', 'kg', 'g', 'L', 'mL'];
  var UNCAT = 'Uncategorised', CASSY = '__cassy', PHOTO_MAX = 1048576;
  function normalizeCatalogue(data, role) {
    var list = data && data.items;
    if (!Array.isArray(list)) return null;
    return list.map(function (r) { return normalize(r, role); }).filter(function (i) { return i.active && i.name; });
  }
  function level(it) { if (it.qty != null && it.qty <= 0) return 'out'; if (it.reorder != null && it.qty != null && it.qty <= it.reorder) return 'low'; return 'ok'; }
  var LEVELS = { out: { word: 'Out', glyph: 'xcircle' }, low: { word: 'Low', glyph: 'alert' }, ok: { word: 'OK', glyph: 'check' } };
  var RANK = { out: 0, low: 1, ok: 2 };
  function byName(a, b) { return a.name.localeCompare(b.name); }
  function summary(items) { var low = 0, out = 0; items.forEach(function (i) { var l = level(i); if (l === 'out') out++; else if (l === 'low') low++; }); return { low: low + out, out: out }; }
  // s107 B9: Low, To count (only when something needs counting), All, Consumables, then the categories; each carries its count.
  function chipsFor(items, needN) {
    var cats = {}, list = [{ k: 'low', t: 'Low', n: summary(items).low }];
    if (needN) list.push({ k: 'need', t: 'To count', n: needN });
    list.push({ k: 'all', t: 'All', n: items.length }, { k: 'cons', t: 'Consumables', n: items.filter(function (i) { return i.consumable; }).length });
    items.forEach(function (i) { cats[i.category] = (cats[i.category] || 0) + 1; });
    Object.keys(cats).sort().forEach(function (c) { list.push({ k: 'c:' + c, t: c, n: cats[c] }); });
    return list;
  }
  // Needs a count (s84 1b): a consumable never counted in the app, or not for 30 days. Only meaningful when the catalogue says when (countedAt).
  function needsCount(it) { return !!(K.hasCounted && it.consumable && (!it.counted || nowMs() - Date.parse(it.counted) > 30 * 86400000)); }
  function visible(items, chip, q) {
    var s = String(q || '').trim().toLowerCase(), out = items.filter(function (i) {
      if (s && i.name.toLowerCase().indexOf(s) < 0 && String(i.location || '').toLowerCase().indexOf(s) < 0) return false;
      if (chip === 'cons') return i.consumable;
      if (chip === 'out') return level(i) === 'out';
      if (chip === 'need') return needsCount(i);
      if (chip.indexOf('c:') === 0) return i.category === chip.slice(2);
      return true;
    });
    return chip === 'all' || chip === 'need' || chip === 'out' || chip.indexOf('c:') === 0 ? out.sort(byName) : out.sort(function (a, b) { return RANK[level(a)] - RANK[level(b)] || byName(a, b); });
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
    tooLate: 'This can no longer be undone here. Count the item to correct it.',
    already: 'Someone already marked this as bought. The list is refreshed.',
    photofail: 'That photo could not be prepared. Try another one.',
    photobig: 'That photo is too large to send. Try one taken a little further away.',
    optfetch: 'The picture could not be fetched. Try again, or take a photo yourself.',
    wait: 'Cassy has just sorted. Please wait half a minute and try again.',
    labelsend: 'The label sheet was not sent. Try again. No new codes will be made.'
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
    var args = { p_item_id: it.id, p_packs: parseQty(v.packs), p_unit_cost: cost, p_supplier: sup || null, p_purchased_at: today, p_receipt_path: null, p_shopping_list_id: v.shopId || null, p_idempotency_key: key };
    if (v.supplierId) args.p_supplier_id = v.supplierId; // s86 R: the picked supplier; the text name stays for the old path
    return { fn: 'record_inventory_receipt_v1', args: args };
  }
  // s84: barcode, price, levels, new item, report. Exact names and keys from SPEC-inventory 3.5 and 4.1.
  function attachCall(pid, it, code, format) { return { fn: 'inventory_code_attach_v1', args: { p_property_id: pid, p_code: code, p_format: format || null, p_item_id: it.id } }; }
  function priceCall(it, v) { var c = String(v.cost || '').trim() === '' ? null : parseQty(v.cost); return { fn: 'inventory_item_price_set_v1', args: { p_item_id: it.id, p_unit_cost: c } }; }
  // s86 4.6: Edit details. Levels always go; kept in, unit and category go only when they changed (one patch, one call). An empty Kept in is sent as '' (the server stores null).
  function levelsCall(it, v) {
    var r = String(v.reorder || '').trim(), p = String(v.par || '').trim(), patch = { reorder_below: r === '' ? null : parseQty(r, true), par_qty: p === '' ? null : parseQty(p, true) };
    if ('location' in v && String(v.location || '').trim() !== String(it.location || '')) patch.location = String(v.location || '').trim();
    if ('unit' in v && String(v.unit || '').trim() !== it.unit) patch.unit = String(v.unit || '').trim();
    if ('category' in v && String(v.category || '').trim() !== it.category) patch.category = String(v.category || '').trim();
    return { fn: 'inventory_item_update_v1', args: { p_item_id: it.id, p_patch: patch } };
  }
  // s86 4.4 / 4.5 / 4.6 / 9.5: exact RPC names and keys from SPEC-inventory-db 2.7 and 3.2.
  function setUsualCall(optId) { return { fn: 'inventory_item_option_set_usual_v1', args: { p_option_id: optId } }; }
  function photoSetCall(itemId, path) { return { fn: 'inventory_item_photo_set_v1', args: { p_item_id: itemId, p_path: path } }; }
  function recatCall(pid, ids, cat) { return { fn: 'inventory_items_recategorize_v1', args: { p_property_id: pid, p_item_ids: ids, p_category: cat } }; }
  function mintCall(pid, ids) { return { fn: 'inventory_code_mint_v1', args: { p_property_id: pid, p_item_ids: ids } }; }
  function labelsCall(ids) { return { invoke: 'inventory-report', body: { kind: 'labels', to: 'finance', item_ids: ids } }; }
  function createCall(pid, v, code, format, key) {
    var item = { name: String(v.name || '').trim(), category: String(v.category || '').trim() === CASSY ? UNCAT : String(v.category || '').trim(), unit: String(v.unit || '').trim() || 'pc', consumable: v.cons === 'yes' };
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
  var K = { items: null, shop: null, q: '', chip: 'low', role: null, at: 0, keys: {}, v84: false, lastCode: '', cool: {}, scanned: null, denied: {}, noFinance: false, undos: [], uidn: 0, hasCounted: false, quick: null, pu: {}, opt: {}, badImg: {}, sm: null, sup: null, catAt: 0, hasLoc: false, viewInit: false, cart: null, optBad: {} }; // denied: actions the server refused or lacks, hidden for the whole visit (a re-mount keeps them) // survives unmount: the list shows at once while it refreshes
  var M = null; // the live mount

  function mount(el, opts) {
    unmount();
    opts = opts || {};
    var prevRole = K.role;
    if (K.role !== opts.role) { K.role = opts.role; K.items = null; K.shop = null; K.q = ''; K.chip = 'low'; K.at = 0; K.keys = {}; K.v84 = false; K.lastCode = ''; K.cool = {}; K.scanned = null; K.denied = {}; K.noFinance = false; K.undos = []; K.hasCounted = false; K.sup = null; K.hasLoc = false; K.catAt = 0; K.usual = null; K.usualP = null; K.opt = {}; K.badImg = {}; K.cart = null; K.optBad = {}; if (prevRole !== null) recentClear(); } // a cached list is never shown to another role
    M = {
      el: el, opts: opts, role: opts.role, demo: !!opts.demo, client: opts.client || null, pid: opts.propertyId || PROPERTY_ID,
      sub: String(opts.sub || ''), act: null, hist: {}, denied: K.denied, uid: null, loadErr: null, shopErr: null, loading: false, offlineStale: false, itemInfo: {}, listeners: []
    };
    el.innerHTML = '<div class="I_wrap"><div class="I_top" data-i-top></div><div class="I_lbox" data-i-list></div><div data-i-undo class="I_undoslot"></div><div data-i-layer></div><div class="I_live sr" role="status" aria-live="polite" data-i-live></div></div>';
    var on = function (type, fn) { el.addEventListener(type, fn); M.listeners.push([type, fn]); };
    on('click', onClick); on('change', onChange); on('input', onInput); on('submit', onSubmit); on('keydown', onKey); on('focusin', onFocus); on('focusout', onBlur);
    M.el.addEventListener('error', onImgErr, true); M.listeners.push(['error', onImgErr, true]); // a picture that will not load is replaced by the placeholder (error does not bubble: capture)
    M.vis = function () { if (M && root.document && root.document.hidden && M.cam) pauseCam(); };
    if (root.document && root.document.addEventListener) root.document.addEventListener('visibilitychange', M.vis);
    if (M.demo) { K.items = demoItems().map(function (r) { return normalize(r, M.role); }); K.shop = normalizeShop(demoShop(), null); K.v84 = true; K.hasCounted = true; }
    else if (M.client && M.client.auth && M.client.auth.getSession) { try { M.client.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; M.uid = s && s.user ? s.user.id : null; }, function () {}); } catch (e) { /* no uid: rows read "Asked by staff" */ } }
    var goShop = false;
    if (!K.viewInit) { K.viewInit = true; var vw = ssGet('cs_I_view'); if (vw && vw.role === K.role) { if (/^(low|need|all|cons|out|c:.{1,80})$/.test(String(vw.chip))) K.chip = vw.chip; if (vw.tab === 'shopping' && !M.sub) { M.sub = 'shopping'; goShop = true; } } } // s107 B14: the last tab and chip come back once per visit
    ensureSuppliers(); draw();
    if (goShop && opts.navigate) opts.navigate('#stock/shopping');
    if (!M.demo && !(K.items && K.at && nowMs() - K.at < 60000)) load(); // a fresh list for this role is kept when only the sub-route changed
    else if (!M.demo) loadShopSoon();
    return M;
  }
  function unmount() {
    if (!M) return;
    M.listeners.forEach(function (l) { M.el.removeEventListener && M.el.removeEventListener(l[0], l[1], l[2]); });
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
      if (items) { K.inactiveCat = {}; r.data.items.forEach(function (x) { if (x && x.active === false && x.id) K.inactiveCat[String(x.id)] = String(x.category || ''); }); K.items = items; K.v84 = r.data.items.some(function (x) { return x && 'codes' in x; }); K.hasCounted = r.data.items.some(function (x) { return x && 'countedAt' in x; }); K.hasLoc = r.data.items.some(function (x) { return x && 'location' in x; }); K.at = nowMs(); me.loadErr = null; me.offlineStale = false; }
      else if (K.items) me.offlineStale = true;
      else me.loadErr = errKind(r && r.error, online()) === 'offline' ? 'offline' : 'unavailable';
    }, function (e) {
      if (me.dead) return;
      if (K.items) me.offlineStale = true; else me.loadErr = errKind(e, online()) === 'offline' ? 'offline' : 'unavailable';
    }).then(function () { if (me.dead) return; me.loading = false; draw(); loadShop(); signPhotos(); });
  }
  function loadShopSoon() { var me = M; if (me && !K.shop) loadShop(); }
  function loadShop() {
    var me = M; if (!me || me.demo || !me.client || me.loadErr) return Promise.resolve();
    var run = function () { return me.client.from('inventory_shopping_list').select('id,item_id,item_name,quantity,purchase_unit,reason,status,proposed_by,proposed_at').eq('property_id', me.pid).in('status', ['proposed', 'approved']).order('proposed_at', { ascending: false }).limit(100); };
    return Promise.resolve().then(run).then(function (r) {
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

  /* ---- photos (s86 4.4): the bucket is private; the catalogue holds a storage path, upload-photo signs it for display */
  var SIGN_STALE = 6 * 86400000; // a signed link lasts 7 days
  // Signed links are kept on the phone with their time, so an app launch does not re-sign and re-download every thumbnail.
  function puLoad() { if (K.puRead) return; K.puRead = true; try { var o = JSON.parse(root.localStorage.getItem('I_pu_v1') || 'null'); if (o) Object.keys(o).forEach(function (p) { if (o[p] && typeof o[p].url === 'string' && nowMs() - o[p].at < SIGN_STALE && !K.pu[p]) K.pu[p] = o[p]; }); } catch (e) { /* no store: sign again */ } }
  function puSave() { try { var o = {}; Object.keys(K.pu).forEach(function (p) { if (nowMs() - K.pu[p].at < SIGN_STALE) o[p] = K.pu[p]; }); root.localStorage.setItem('I_pu_v1', JSON.stringify(o)); } catch (e) { /* private mode */ } }
  function photoUrl(it) { puLoad(); var c = it && it.photo && K.pu[it.photo]; return c && nowMs() - c.at < SIGN_STALE ? c.url : ''; }
  function signPhotos() {
    var me = M; if (!me || me.demo || !me.client || !me.client.functions || !me.client.functions.invoke || K.denied.sign || !K.items) return;
    var seen = {}, paths = [];
    K.items.forEach(function (i) { if (i.photo && !seen[i.photo] && !photoUrl(i)) { seen[i.photo] = 1; paths.push(i.photo); } });
    for (var n = 0; n < paths.length; n += 200) (function (chunk) {
      Promise.resolve().then(function () { return me.client.functions.invoke('upload-photo', { body: { purpose: 'inventory', action: 'sign', propertyId: me.pid, paths: chunk } }); }).then(function (r) {
        if (r && r.error) throw r.error;
        var urls = r && r.data && r.data.urls; if (!urls) return;
        Object.keys(urls).forEach(function (p) { if (typeof urls[p] === 'string') K.pu[p] = { url: urls[p], at: nowMs() }; });
        puSave();
        if (!me.dead && M === me) drawList(); // rows only: a card or file picker that is open is left alone
      }).catch(function (e) { var k = errKind(e, online()); if (k === 'missing' || k === 'refused') K.denied.sign = true; /* thumbnails stay as placeholders */ });
    })(paths.slice(n, n + 200));
  }
  function thumb(it) {
    var u = photoUrl(it);
    return '<span class="I_th" aria-hidden="true">' + (u ? '<img src="' + esc(u) + '" alt="" width="48" height="48" loading="lazy" decoding="async">' : gi('image', 's16')) + '</span>';
  }
  function photoBlock(it) {
    var u = photoUrl(it);
    return u ? '<div class="I_photo I_ph96"><img src="' + esc(u) + '" alt="' + esc(it.name) + '" loading="lazy" decoding="async"></div>' : '';
  }
  // Resize on the phone: longest side 800 px, WebP 0.72 (JPEG 0.75 where WebP is missing), over 1 MB once more at 0.6, else refused.
  function canvasBlob(c, type, q) { return new Promise(function (res) { try { c.toBlob(function (b) { res(b || null); }, type, q); } catch (e) { res(null); } }); }
  function resizePhoto(file) {
    var d = root.document, mk = root.createImageBitmap;
    if (!mk || !d || !d.createElement) return Promise.reject({ photo: 'photofail' });
    return Promise.resolve().then(function () { return mk.call(root, file); }).then(function (bm) {
      var z = fitSize(bm.width, bm.height, 800), c = d.createElement('canvas');
      c.width = z.w; c.height = z.h; c.getContext('2d').drawImage(bm, 0, 0, z.w, z.h); if (bm.close) { try { bm.close(); } catch (e) { /* already closed */ } }
      return canvasBlob(c, 'image/webp', 0.72).then(function (b) { return b && b.type === 'image/webp' ? b : canvasBlob(c, 'image/jpeg', 0.75); }).then(function (b) {
        if (!b) throw { photo: 'photofail' };
        if (b.size <= PHOTO_MAX) return b;
        return canvasBlob(c, b.type, 0.6).then(function (b2) { if (!b2) throw { photo: 'photofail' }; if (b2.size > PHOTO_MAX) throw { photo: 'photobig' }; return b2; });
      });
    }, function () { throw { photo: 'photofail' }; });
  }
  function blobBase64(b) {
    return Promise.resolve(b.arrayBuffer()).then(function (buf) {
      var u = new Uint8Array(buf), s = '';
      for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
      return root.btoa(s);
    });
  }
  // upload-photo (no row is written), then the photo is set on the item. A failed upload never reaches the second call.
  function uploadAndSet(a) {
    var me = M;
    return blobBase64(a.blob).then(function (b64) {
      return me.client.functions.invoke('upload-photo', { body: { purpose: 'inventory', propertyId: me.pid, itemId: a.itemId, fileData: b64, mimeType: a.blob.type || 'image/webp' } });
    }).then(function (u) {
      if (u && u.error) throw u.error;
      if (!u || !u.data || u.data.ok === false || !u.data.path) throw { message: 'failed', data: u && u.data || {} };
      if (u.data.signedUrl) { K.pu[u.data.path] = { url: u.data.signedUrl, at: nowMs() }; puSave(); }
      a.newPath = u.data.path;
      var c = photoSetCall(a.itemId, u.data.path);
      return me.client.rpc(c.fn, c.args);
    });
  }
  function photoPicked(ev) {
    var t = ev.target, f = t && t.files && t.files[0]; if (!M || !f) return;
    var it = itemById(M.act && M.act.itemId); if (!it || (M.act && M.act.sending)) return;
    photoRun(it, function () { return f; });
    try { t.value = ''; } catch (x) { /* the same file can be chosen again */ }
  }
  // The one add-photo path: get a file (picked, or fetched from an option), resize it, ask for confirmation. Upload and R7 happen only on Yes (uploadAndSet).
  function photoRun(it, getFile) {
    var a = M.act = { kind: 'photo', itemId: it.id, step: 'prep' }; drawLayer();
    Promise.resolve().then(getFile).then(resizePhoto).then(function (b) {
      if (!M || M.act !== a) return;
      a.blob = b; a.step = 'confirm'; a.prev = root.URL && root.URL.createObjectURL ? root.URL.createObjectURL(b) : null; a.focused = false; drawLayer();
    }, function (e) { if (!M || M.act !== a) return; a.step = 'bad'; a.err = e && e.photo || 'photofail'; drawLayer(); });
  }
  /* ---- s106 item options (Shopsuki): brand/size choices for one item, read from inventory_item_options_v1; hidden when the SQL is not there yet */
  function siteOf(u) { var h = /^https:\/\/([^\/]+)/i.exec(u || ''); h = h ? h[1].replace(/^www\./, '') : ''; return h === 'shopsuki.ph' ? 'Shopsuki' : h === 'shopee.ph' ? 'Shopee' : h || 'the shop'; }
  function normOpts(list) {
    return (Array.isArray(list) ? list : []).filter(function (o) { return o && o.id && o.title; }).map(function (o) {
      return { id: String(o.id), supplier: String(o.supplier || ''), title: String(o.title), brand: o.brand ? String(o.brand) : '', packLabel: o.pack_label ? String(o.pack_label) : '',
        image: /^https:\/\/[^\s"'<>]+$/i.test(String(o.image_url || '')) ? String(o.image_url) : '', link: /^https:\/\/[^\s"'<>]+$/i.test(String(o.source_url || '')) ? String(o.source_url) : '',
        usual: !!o.usual, preferred: o.preferred === true, available: o.available === false ? false : o.available === true ? true : null, price: num(o.price) };
    });
  }
  function demoOptions(id) {
    var d = { d1: [['o1', 'Demo Mart', 'Softly Bath Tissue 12 rolls', 'Softly', 210, true], ['o2', 'Demo Mart', 'Cloud Bath Tissue 12 rolls', 'Cloud', 195, true], ['o3', 'Demo Mart', 'Plush Bath Tissue 8 rolls', 'Plush', 160, false]],
      d5: [['o4', 'Demo Mart', 'Strong Trash Bags Large 10s', 'Strong', 230, true], ['o5', 'Demo Mart', 'Strong Trash Bags XL 10s', 'Strong', 260, true]] }[id] || [];
    return d.map(function (x, n) { return { id: x[0], supplier: x[1], title: x[2], brand: x[3], packLabel: '', image: '', link: '', usual: n === 0, preferred: x[0] === 'o2', available: x[5], price: canPrice(M.role) ? x[4] : null }; });
  }
  function loadOptions(id) {
    var me = M, c0 = K.opt[id]; if (!me || (c0 && nowMs() - c0.at < 60000) || K.denied.inventory_item_options_v1) return Promise.resolve(); // kept across mounts (the shell re-mounts on every sub-route change), read again after a minute
    if (me.demo) { K.opt[id] = { list: demoOptions(id), at: nowMs() }; redrawMenu(id); return Promise.resolve(); }
    if (!me.client || !online()) return Promise.resolve();
    K.opt[id] = { list: null, at: nowMs() };
    return Promise.resolve().then(function () { return me.client.rpc('inventory_item_options_v1', { p_item_id: id }); }).then(function (r) {
      if (r && r.error) throw r.error;
      if (!r || !r.data || r.data.ok === false) throw { message: 'failed' };
      K.opt[id] = { list: normOpts(r.data.options), at: nowMs() }; redrawMenu(id);
    }).catch(function (e) {
      delete K.opt[id]; K.optBad[id] = nowMs(); // read again the next time the card opens (the shopping list waits a minute)
      if (errKind(e, online()) === 'missing') K.denied.inventory_item_options_v1 = true; // the SQL release is not applied yet: no section, no message
    });
  }
  function redrawMenu(id) { if (M && M.act && M.act.kind === 'menu' && M.act.itemId === id) drawLayer(); }
  function optById(itemId, id) { var st = M && K.opt[itemId]; return st && st.list ? st.list.filter(function (o) { return o.id === id; })[0] || null : null; }
  function onImgErr(ev) { var t = ev && ev.target; if (M && t && t.getAttribute && t.getAttribute('data-oimg')) { K.badImg[t.getAttribute('src')] = 1; if (M.act && M.act.kind === 'menu') drawLayer(); } }
  function optionsBlock(it) {
    var st = K.opt[it.id]; if (!st || !st.list || !st.list.length) return '';
    var money = canPrice(M.role), mng = canManage(M.role), sorted = optSort(st.list, money), main = sorted.filter(function (o) { return o.usual; }), rest = sorted.filter(function (o) { return !o.usual; });
    var btn = function (act, id, text) { return '<button class="btn btn-ghost I_undobtn" type="button" data-act="' + act + '" data-id="' + esc(id) + '">' + text + '</button>'; };
    var one = function (o, other) {
      var sub = [o.brand, o.supplier, o.packLabel].filter(Boolean).join(' · ');
      return '<div class="I_opt"><span class="I_oth">' + (o.image && !K.badImg[o.image] ? '<img src="' + esc(o.image) + '" alt="' + esc(o.title) + '" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-oimg="1">' : gi('image', 's16')) + '</span>' +
        '<div class="I_ob"><p class="I_ot">' + esc(o.title) + (o.usual ? ' <span class="I_usual">Usual</span>' : '') + (o.preferred ? ' <span class="I_pref">' + gi('star', 's16') + 'Preferred</span>' : '') + '</p>' + (sub ? '<p class="help">' + esc(sub) + '</p>' : '') +
        (money && o.price != null ? '<p class="help num">' + esc(peso(o.price)) + '</p>' : '') + (o.available === false ? '<p class="help I_oos">Out of stock</p>' : '') +
        '<div class="I_obt">' + (o.link ? '<a class="btn btn-ghost I_undobtn" href="' + esc(o.link) + '" target="_blank" rel="noopener noreferrer">View on ' + esc(siteOf(o.link)) + '</a>' : '') +
        (other && mng && !o.usual && allowed('optusual') ? btn('opt-usual', o.id, 'Make usual') : '') + (other && mng && o.image && allowed('photo') ? btn('opt-photo', o.id, 'Use as item photo') : '') + '</div></div></div>';
    };
    return '<div class="I_opts" role="group" aria-label="Options"><h3 class="I_opth">Options</h3>' + main.map(function (o) { return one(o, false); }).join('') +
      (rest.length ? '<details class="I_other"' + (main.length ? '' : ' open') + '><summary>Other options (' + rest.length + ')</summary>' + rest.map(function (o) { return one(o, true); }).join('') + '</details>' : '') + '</div>';
  }
  function renderOptUsual(a, it) {
    var o = optById(a.itemId, a.optId); if (!o) return null;
    return head('Make this the usual for ' + it.name + '?') + '<form data-i-form><p class="I_conf">' + esc(o.title) + (o.supplier ? ' from ' + esc(o.supplier) : '') + (canPrice(M.role) && o.price != null ? ' at ' + esc(peso(o.price)) : '') + '. Shopping lists and Add low items will use it.</p>' + actions(a, 'Yes, make it usual') + '</form>';
  }
  function relPrev(a) { if (a && a.prev && root.URL && root.URL.revokeObjectURL) { try { root.URL.revokeObjectURL(a.prev); } catch (e) { /* gone already */ } } if (a) a.prev = null; }
  // Cross-origin read of an option picture; anything that goes wrong is one plain line.
  function fetchPicture(url) {
    if (typeof root.fetch !== 'function') throw { photo: 'optfetch' };
    return Promise.resolve().then(function () { return root.fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }); }).then(function (r) { if (!r || !r.ok) throw 0; return r.blob(); }).then(null, function () { throw { photo: 'optfetch' }; });
  }
  function onChange(ev) { var t = ev.target; if (M && t && t.id === 'I_photo_in') photoPicked(ev); }
  // s107 B7: usual first, then preferred, then in stock, then cheapest (price roles) or by title (everyone else).
  function optSort(list, money) {
    var av = function (o) { return o.available === true ? 0 : o.available === null ? 1 : 2; };
    return list.map(function (o, n) { return { o: o, n: n }; }).sort(function (x, y) {
      var a = x.o, b = y.o, pa = money && a.price != null ? a.price : null, pb = money && b.price != null ? b.price : null;
      return (b.usual ? 1 : 0) - (a.usual ? 1 : 0) || (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || av(a) - av(b) ||
        (money ? (pa == null ? 1 : 0) - (pb == null ? 1 : 0) || (pa != null && pb != null ? pa - pb : 0) : a.title.localeCompare(b.title)) || x.n - y.n;
    }).map(function (x) { return x.o; });
  }

  /* ---- suppliers module (lane D-client-sup): loaded once, hidden for the visit when it is missing */
  function supOK() { return K.sm === 'ok' && !!(root.I_Suppliers && root.I_Suppliers.pick); }
  function ensureSuppliers() {
    if (K.sm === 'ok' || K.sm === 'none' || K.sm === 'loading') return;
    if (root.I_Suppliers && typeof root.I_Suppliers.pick === 'function') { K.sm = 'ok'; return; }
    var d = root.document; if (!d || !d.createElement) { K.sm = 'none'; return; }
    K.sm = 'loading';
    var host = d.head || d.documentElement, done = function (ok) { K.sm = ok && root.I_Suppliers && typeof root.I_Suppliers.pick === 'function' ? 'ok' : 'none'; if (M && !M.dead) draw(); };
    try {
      var l = d.createElement('link'); l.rel = 'stylesheet'; l.href = 'stock/I_suppliers.css'; host.appendChild(l);
      var s = d.createElement('script'); s.src = 'stock/I_suppliers.js'; s.onload = function () { done(true); }; s.onerror = function () { done(false); }; host.appendChild(s);
    } catch (e) { K.sm = 'none'; }
  }
  // The context I_Suppliers is given (SPEC 4.0). confirm and undo are this module's own, so the bar, the timers and the focus rules stay one implementation.
  function supCtx() {
    var me = M;
    return { client: me.client, role: me.role, propertyId: me.pid, esc: esc, toast: toast, nowMs: nowMs, haptic: function (k) { if (me.opts.haptic) { try { me.opts.haptic(k); } catch (e) { /* no haptics */ } } },
      confirm: function (text) { return new Promise(function (res) { var prev = M && M.act; if (!M) return res(false); M.act = { kind: 'cconfirm', text: String(text), res: res, prev: prev || null, step: 'confirm' }; drawLayer(); }); },
      undo: function (label, fn, o) { var e = { id: 'u' + (++K.uidn), itemId: o && o.itemId ? String(o.itemId) : null, name: label, at: nowMs(), kind: 'sup', say: String(label), line: String(label), confirm: 'Undo: ' + label + '?', call: { fn: 'sup_undo', args: {}, exec: fn } }; pushUndoEntry(e); if (M && M.act && M.act.kind === 'menu' && e.itemId && M.act.itemId === e.itemId) drawLayer(); else drawUndo(); } };
  }
  function cconfirmDone(a, yes) { if (M && M.act === a) { M.act = a.prev; drawLayer(); } if (a.res) { var r = a.res; a.res = null; r(!!yes); } }
  // One Supplier field: the picker button when the module is here, the old text box when it is not (or when the picker returned nothing).
  function supplierField(a) {
    var v = a.vals || {};
    if (supOK() && !a.textSup) return '<div class="field"><span class="lbl">Supplier</span><button class="btn btn-secondary btn-block I_supbtn" type="button" data-act="pick-sup">' + gi('bag', 's16') + ' ' + esc(v.supplier || 'Choose a supplier') + '</button></div>';
    return textField('supplier', 'Supplier (optional)', v.supplier || '', 'maxlength="80"');
  }
  function pickSupplier(a) {
    var sup = root.I_Suppliers; if (!supOK() || a.picking) { if (!a.picking) { a.textSup = true; drawLayer(); } return; }
    a.picking = true;
    var pid = a.itemId || (a.rows && a.rows[0] && a.rows[0].itemId) || null, pit = pid ? itemById(pid) : null;
    Promise.resolve().then(function () { return sup.pick(supCtx(), { itemId: pid, preferredId: pit && pit.supplier && pit.supplier.id || null, selectedId: (a.vals || {}).supplierId || (K.sup && K.sup.id) || null }); }).then(function (r) {
      a.picking = false; if (!M || M.act !== a) return;
      if (r && r.id) { a.vals.supplierId = r.id; a.vals.supplier = r.name; if (r.created) a.supCreated = r.id; K.sup = { id: r.id, name: r.name }; } else a.textSup = true;
      a.focused = true; drawLayer();
    }, function () { a.picking = false; if (M && M.act === a) { a.textSup = true; drawLayer(); } });
  }
  function rememberSupplier(vals) { var n = String(vals.supplier || '').trim(); if (vals.supplierId || n) K.sup = { id: vals.supplierId || null, name: n }; }

  /* ---- drawing */
  function itemById(id) { return (K.items || []).filter(function (i) { return i.id === id; })[0] || null; }
  function newMenu(id) { recentAdd(id); var scanned = K.scanned === id; return { kind: 'menu', itemId: id, scanned: scanned }; } // scanned: the right action first
  // s107: the view (tab, chip) and the in-cart ticks are kept for the visit only (session store); a blocked store simply starts fresh.
  function ssGet(k) { try { var st = root.sessionStorage; return st ? JSON.parse(st.getItem(k) || 'null') : null; } catch (e) { return null; } }
  function ssSet(k, v) { try { var st = root.sessionStorage; if (st) st.setItem(k, JSON.stringify(v)); } catch (e) { /* no store: nothing is remembered */ } }
  function viewSave(tab) { ssSet('cs_I_view', { role: K.role, tab: tab ? 'shopping' : '', chip: K.chip }); }
  function cartRead() { if (!K.cart) { var o = ssGet('cs_I_cart'); K.cart = {}; if (o && o.role === K.role && Array.isArray(o.ids)) o.ids.forEach(function (id) { K.cart[String(id)] = 1; }); } return K.cart; }
  function cartSave() { ssSet('cs_I_cart', { role: K.role, ids: Object.keys(K.cart || {}) }); }
  // Recent items (s84 1b, Q7): the last 5 cards opened, ids only, in localStorage key cs_I_recent. Private mode or a blocked store simply hides it.
  function recentRead() {
    try { var ls = root.localStorage; if (!ls) return []; var o = JSON.parse(ls.getItem('cs_I_recent') || 'null'); return o && o.role === K.role && Array.isArray(o.ids) ? o.ids.map(String).slice(0, 5) : []; } catch (e) { return []; }
  }
  function recentAdd(id) { try { var ls = root.localStorage; if (ls) ls.setItem('cs_I_recent', JSON.stringify({ role: K.role, ids: [String(id)].concat(recentRead().filter(function (x) { return x !== String(id); })).slice(0, 5) })); } catch (e) { /* no store: no recent list */ } }
  function recentClear() { try { if (root.localStorage) root.localStorage.removeItem('cs_I_recent'); } catch (e) { /* nothing to clear */ } }
  function renderRecent() { // s107 B1: one line that scrolls sideways; the level is a glyph, the word is in the name of the button
    var items = recentRead().map(itemById).filter(Boolean); // an item that left the catalogue is dropped silently
    return items.length ? '<div class="I_recent" role="group" aria-label="Recent items"><span class="I_rl">Recent</span>' + items.map(function (i) { var L = LEVELS[level(i)]; return '<button class="chip I_rc" type="button" data-act="open" data-id="' + esc(i.id) + '" aria-label="' + esc(i.name + ', ' + L.word) + '"><span class="I_rn">' + esc(i.name) + '</span>' + gi(L.glyph, 's16') + '</button>'; }).join('') + '</div>' : '';
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
    if (rt.itemId && K.items && (!M.act || (M.act.itemId !== rt.itemId && M.act.kind !== 'undo'))) { var it = itemById(rt.itemId); if (it) { M.act = newMenu(rt.itemId); loadLastCount(rt.itemId); loadOptions(rt.itemId); applyQuick(); } }
    if (!rt.itemId && M.act && M.act.itemId) M.act = null;
    drawLayer(); drawUndo();
  }
  // The More menu (s107 B2): the actions that are not needed every minute. Nothing in it when nothing is available.
  function menuHtml(rt) {
    var bs = [], b = function (act, text, extra) { bs.push('<button class="btn btn-ghost I_mb" type="button" data-act="' + act + '"' + (extra || '') + '>' + text + '</button>'); };
    if (rt.shopping) { if (K.shop && K.shop.length) { b('shop-share', 'Share as text'); b('shop-image', 'Save as image'); if (allowed('report')) b('report', 'PDF to Telegram', ' data-k="order"'); } }
    else if (K.items) { if (addLowCount()) b('addlow-open', 'Add low items to the shopping list'); if (allowed('tidy')) b('tidy', 'Tidy categories'); if (!M.denied.report) b('report', 'Send a report'); if (allowed('labels')) b('labels', 'Print QR labels'); }
    return bs.length ? '<details class="I_menu"><summary class="btn btn-ghost I_mbtn" aria-label="More inventory actions">' + gi('more') + '</summary><div class="I_menuin">' + bs.join('') + '</div></details>' : '';
  }
  function renderTop(rt) {
    var n = K.shop ? K.shop.length : 0;
    var h = '<div class="I_head"><div class="seg I_tabs" role="group" aria-label="Inventory views">' +
      '<button class="btn btn-secondary" type="button" data-act="tab" data-to="" aria-pressed="' + !rt.shopping + '">Items</button>' +
      '<button class="btn btn-secondary" type="button" data-act="tab" data-to="shopping" aria-pressed="' + rt.shopping + '">Shopping list' + (n ? ' ' + n : '') + '</button></div>' + menuHtml(rt) + '</div>';
    if (rt.shopping || !K.items) return h;
    var s = summary(K.items), needN = allowed('count') ? K.items.filter(needsCount).length : 0, cs = chipsFor(K.items, needN);
    if (K.chip !== 'out' && K.chip !== 'suppliers' && !cs.some(function (c) { return c.k === K.chip; })) K.chip = 'low'; // a chip that no longer exists (nothing left to count) falls back
    // s107 B3: one row of status pills (glyph, word and number, never colour alone); each is a filter or the Shopping list
    var pl = function (act, k, glyph, text, tone) { return '<button class="chip I_pill ' + tone + '" type="button" data-act="' + act + '" data-' + (act === 'tab' ? 'to' : 'k') + '="' + k + '">' + gi(glyph, 's16') + ' ' + text + '</button>'; };
    var pills = '';
    if (s.low) pills += pl('chip', 'low', 'alert', s.low + ' low', 'I_pwarn');
    if (s.out) pills += pl('chip', 'out', 'xcircle', s.out + ' out', 'I_pbad');
    if (needN) pills += pl('chip', 'need', 'note', needN + ' to count', 'I_pinfo');
    if (!s.low && !needN) pills = '<span class="chip I_pill I_pok">' + gi('check', 's16') + ' Stock is fine</span>' + pills;
    if (n) pills += pl('tab', 'shopping', 'bag', n + ' on list', 'I_pinfo');
    h += '<div class="I_pills" role="group" aria-label="Stock status">' + pills + '</div>';
    // s107 B4: the search and the filter chips stay under the app bar while the list scrolls
    h += '<div class="I_find"><div class="I_srow"><div class="field"><label class="sr" for="I_q">Search items</label><div class="input"><input id="I_q" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(K.q) + '" placeholder="Search items"></div></div>' +
      (K.v84 ? '<button class="chip I_scanbtn" type="button" data-act="scan" aria-label="Scan a barcode">' + gi('camera') + '</button>' : '') + '</div>';
    h += '<div class="I_chips" role="group" aria-label="Show">' + cs.map(function (c) { return '<button class="chip" type="button" data-act="chip" data-k="' + esc(c.k) + '" aria-pressed="' + (K.chip === c.k) + '">' + esc(c.t) + ' <span class="I_cn">' + c.n + '</span></button>'; }).join('') +
      (supOK() ? '<button class="chip" type="button" data-act="chip" data-k="suppliers" aria-pressed="' + (K.chip === 'suppliers') + '">' + gi('bag', 's16') + ' Suppliers</button>' : '') + '</div></div>';
    return h;
  }
  function drawList() {
    var box = q('[data-i-list]'); if (!box) return;
    var rt = route();
    if (rt.shopping) {
      box.innerHTML = renderShop();
      if (K.shop && K.shop.length) {
        if (wantUsual() && !(K.usual && nowMs() - K.usualAt < 300000)) { var me0 = M; usualP().then(function (u) { if (M === me0 && route().shopping && K.usual === u) drawList(); }); } // the shop names and subtotals follow the Usual map once it is here
        shopOptsLoad();
      }
      return;
    }
    if (!K.items) {
      box.innerHTML = M.loadErr ? renderFail(M.loadErr) : '<p class="help I_load" role="status">Loading the stock list…</p>';
      return;
    }
    if (K.chip === 'suppliers') {
      if (supOK() && root.I_Suppliers.mountList) { box.innerHTML = '<div data-i-suphost></div>'; var sh = q('[data-i-suphost]'); try { root.I_Suppliers.mountList(sh, supCtx()); } catch (e) { box.innerHTML = '<p class="help">' + esc(ERR.missing) + '</p>'; } return; }
      K.chip = 'low';
    }
    var gs = groupsFor(K.items, K.chip, K.q), h = '';
    if (M.offlineStale) h += '<div class="note soon" role="status"><span>No connection. This is the last list we have.</span></div>';
    if (!gs.length) h += '<div class="empty"><p class="hd">' + (K.q ? 'Nothing matches that search.' : K.chip === 'low' ? 'Nothing is running low.' : K.chip === 'need' ? 'Everything has been counted lately.' : 'Nothing to show here.') + '</p>' + (K.chip !== 'all' || K.q ? '<button class="btn btn-secondary" type="button" data-act="showall">Show all items</button>' : '') + '</div>';
    else h += gs.map(function (g, n) { return renderGroup(g, n, K.chip.indexOf('c:') !== 0); }).join('');
    box.innerHTML = (K.q ? '' : renderRecent()) + h; // s107 B1: Recent only while the search box is empty
  }
  function renderGroup(g, n, header) {
    var note = g.out || g.low ? '<span class="I_ghn">' + (g.out ? '' + gi('xcircle', 's16') + ' ' + g.out + ' out' : '') + (g.out && g.low ? ', ' : '') + (g.low ? '' + gi('alert', 's16') + ' ' + g.low + ' low' : '') + '</span>' : '';
    return '<section class="I_grp"' + (header ? ' aria-labelledby="I_gh_' + n + '"' : '') + '>' + (header ? '<h3 class="I_gh" id="I_gh_' + n + '"><span>' + esc(g.cat) + '</span>' + note + '</h3>' : '') + '<div class="card list I_list">' + g.rows.map(renderRow).join('') + (allowed('count') ? '<div class="I_foot"><button class="btn btn-ghost I_gcount" type="button" data-act="walk" data-cat="' + esc(g.cat) + '" aria-label="Count this group, ' + esc(g.cat) + '">Count this group</button></div>' : '') + '</div></section>';
  }
  function renderFail(kind) {
    return '<div class="empty I_fail" role="alert"><p class="hd">' + (kind === 'offline' ? 'No connection' : 'Inventory is not available right now') + '</p>' +
      '<p class="help">' + (kind === 'offline' ? 'Check your signal, then try again.' : 'Nothing is wrong with your account. Try again in a moment.') + '</p><button class="btn btn-primary" type="button" data-act="retry">Try again</button></div>';
  }
  function levelBadge(it) { var l = level(it), L = LEVELS[l]; return '<span class="I_lv I_' + l + '">' + gi(L.glyph, 's16') + ' ' + L.word + '</span>'; }
  // The most common action for this row, one tap from the list: the cleaner records use, an owner adds a low item to the shopping list, anyone allowed counts.
  function quickFor(it) {
    var lv = level(it);
    if (allowed('used')) return lv !== 'ok' && allowed('low', it) ? { kind: 'low', t: 'Running low' } : { kind: 'used', t: 'Use' }; // s107 B8: a cleaner who sees it low says so; otherwise records use
    if (lv !== 'ok' && canManage(M.role) && allowed('low', it)) return { kind: 'low', t: 'Add to list' };
    if (allowed('count')) return { kind: 'count', t: 'Count' };
    if (lv !== 'ok' && allowed('low', it)) return { kind: 'low', t: 'Running low' };
    return null;
  }
  // 'Low · 4 of 12 rolls': the level in a word and a glyph, then the amount; below the reorder level it is shown against that level.
  function amountText(it) {
    if (it.qty == null) return 'Not counted';
    return level(it) !== 'ok' && it.reorder != null ? fmt(it.qty) + ' of ' + uq(it.reorder, it.unit) : uq(it.qty, it.unit);
  }
  function levelWord(it) { var L = LEVELS[level(it)]; return '<span class="I_lw I_' + level(it) + '">' + gi(L.glyph, 's16') + ' ' + L.word + '</span>'; }
  function renderRow(it) {
    var p = barPct(it), qa = quickFor(it), listed = (K.shop || []).some(function (r) { return r.itemId === it.id; }), tags = '';
    if (allowed('count') && needsCount(it)) tags += '<span class="I_tg I_tagc">' + gi('note', 's16') + '<span class="sr">Needs a count</span></span>';
    if (listed) tags += '<span class="I_tg I_tagl">' + gi('bag', 's16') + '<span class="sr">On the list</span></span>';
    return '<div class="I_it"><button class="rowi I_row I_irow" type="button" data-act="open" data-id="' + esc(it.id) + '">' + thumb(it) + '<span class="mid"><span class="t">' + esc(it.name) + '</span>' +
      '<span class="s I_s2"><span class="I_s2t">' + (it.qty == null ? '' : levelWord(it) + ' · ') + esc(amountText(it)) + '</span>' + tags + '</span>' +
      (p == null ? '' : '<span class="I_bar I_b' + level(it) + '" aria-hidden="true"><i style="width:' + p + '%"></i><b></b></span>') + '</span></button>' +
      (qa ? '<button class="btn btn-ghost I_qa" type="button" data-act="quick" data-kind="' + qa.kind + '" data-id="' + esc(it.id) + '" aria-label="' + esc(qa.t + ', ' + it.name) + '">' + esc(qa.t) + '</button>' : '') + '</div>';
  }
  // s107 B10-B13: the shopping list by shop, with a subtotal for the roles that see prices, an in-cart tick per row, a link to the usual option and one sticky Bought button.
  function shopGroupName(r) {
    var it = r.itemId ? itemById(r.itemId) : null, us = M.demo ? demoUsual() : (wantUsual() ? K.usual : null), u = us && r.itemId && us[r.itemId];
    return (u && u.supplier) || (it && it.supplier && it.supplier.name) || 'No shop set';
  }
  function shopLink(r) {
    var st = r.itemId && K.opt[r.itemId], u = st && st.list ? st.list.filter(function (o) { return o.usual && o.link; })[0] : null;
    return u ? u.link : '';
  }
  function shopRowHtml(r, inCart) {
    var who = r.mine ? 'You asked' : 'Asked by staff', when = dateLabel(r.at), tag = canManage(M.role) ? 'button' : 'div', link = shopLink(r), nm = esc(r.name);
    return '<div class="I_it I_sit' + (inCart ? ' I_incart' : '') + '"><' + tag + ' class="rowi I_row I_shrow"' + (tag === 'button' ? ' type="button" data-act="shop-open" data-id="' + esc(r.id) + '"' : '') + '><span class="mid"><span class="t">' + nm + '</span><span class="s">' + (r.qty != null ? esc(uq(r.qty, r.unit || '')) : '') + ' · ' + who + (when ? ', ' + when : '') + '</span>' +
      (r.note ? '<span class="s">' + esc(r.note) + '</span>' : '') + '</span><span class="I_lv ' + (r.status === 'approved' ? 'I_ok' : 'I_low') + '">' + gi(r.status === 'approved' ? 'check' : 'clock', 's16') + ' ' + (r.status === 'approved' ? 'Approved' : 'Asked') + '</span></' + tag + '>' +
      '<div class="I_sact">' + (link ? '<a class="btn btn-ghost I_shopa" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" aria-label="Open ' + nm + ' in ' + esc(siteOf(link)) + '">' + gi('ext', 's16') + '</a>' : '') +
      '<button class="btn btn-ghost I_cart" type="button" data-act="cart" data-id="' + esc(r.id) + '" aria-pressed="' + !!inCart + '" aria-label="In cart, ' + nm + '">' + gi('check', 's16') + '</button></div></div>';
  }
  function renderShop() {
    var h = '';
    if (M.shopErr && !K.shop) return '<div class="empty" role="alert"><p class="hd">The shopping list is not available right now</p><button class="btn btn-primary" type="button" data-act="retry">Try again</button></div>';
    if (!K.shop) return '<p class="help I_load" role="status">Loading the shopping list…</p>';
    if (!K.shop.length) return addLowButton('') + '<div class="empty"><p>Nothing is on the shopping list.</p><p class="help">Open an item and choose Add to shopping list.</p></div>';
    var cart = cartRead(), money = canPrice(M.role), live = {}, by = {}, order = [], us = M.demo ? demoUsual() : (wantUsual() ? K.usual : null) || {};
    K.shop.forEach(function (r) { live[r.id] = 1; });
    Object.keys(cart).forEach(function (id) { if (!live[id]) delete cart[id]; }); // a row that left the list (bought, removed) drops its tick
    K.shop.forEach(function (r) {
      var nm = shopGroupName(r), g = by[nm] || (by[nm] = { name: nm, rows: [], tot: 0, unk: false }); if (g.rows.length === 0) order.push(nm); g.rows.push(r);
      if (money) { var it = r.itemId ? itemById(r.itemId) : null, pr = it ? unitPrice(it, us[it.id] || null) : null; if (r.qty != null && pr != null) g.tot += r.qty * pr; else g.unk = true; } // the shopLines arithmetic
    });
    order.sort(function (a, b) { return (a === 'No shop set') - (b === 'No shop set') || a.localeCompare(b); });
    h += addLowButton('I_albtn');
    h += order.map(function (nm, n) {
      var g = by[nm], sub = money && g.tot > 0 ? ' · ' + peso(Math.round(g.tot * 100) / 100) + (g.unk ? ' so far' : '') : '';
      var rows = g.rows.filter(function (r) { return !cart[r.id]; }).concat(g.rows.filter(function (r) { return cart[r.id]; })); // ticked rows sink to the bottom of their shop
      return '<section class="I_grp" aria-labelledby="I_sg_' + n + '"><h3 class="I_gh" id="I_sg_' + n + '">' + esc(nm + ' · ' + plural(g.rows.length, 'item', 'items') + sub) + '</h3><div class="card list I_list">' + rows.map(function (r) { return shopRowHtml(r, !!cart[r.id]); }).join('') + '</div></section>';
    }).join('');
    if (allowed('bought')) { var nt = boughtRows().filter(function (r) { return cart[r.id]; }).length; h += '<div class="sticky I_stk"><button class="btn btn-primary btn-block I_boughtbtn" type="button" data-act="bought-open">' + (nt ? 'Bought these (' + nt + ')' : 'Bought some of these') + '</button></div>'; }
    return h;
  }
  // Each listed item's options are read once (the K.opt cache) so a row can offer its usual shop link; a failed read is not retried for a minute and never loops.
  function shopOptsLoad() {
    var me = M, seen = {}, go = [];
    if (!me || K.denied.inventory_item_options_v1) return;
    (K.shop || []).forEach(function (r) {
      if (!r.itemId || seen[r.itemId]) return; seen[r.itemId] = 1;
      var c = K.opt[r.itemId], bad = K.optBad[r.itemId];
      if (!(c && nowMs() - c.at < 60000) && !(bad && nowMs() - bad < 60000)) go.push(r.itemId);
    });
    if (!go.length) return;
    Promise.all(go.map(function (id) { return loadOptions(id); })).then(function () { if (M === me && route().shopping) drawList(); });
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
    box.innerHTML = '<div class="scrim on" data-act="close"></div><div class="sheet on I_sheet' + (a.kind === 'menu' && !a.shopId ? ' I_sheetm' : '') + '" role="dialog" aria-modal="true" aria-labelledby="I_sh_t">' + body + '</div>';
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
    return '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc(t) + '</span></div>' +
      (a.takenId ? '<button class="btn btn-secondary btn-block" type="button" data-act="open-taken" data-id="' + esc(a.takenId) + '">Open ' + esc(a.takenName || 'it') + '</button>' : '');
  }
  function selectField(id, label, opts, val) { return '<div class="field"><label for="I_f_' + id + '">' + label + '</label><div class="input"><select id="I_f_' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div></div>'; }
  function itemOf(a) { return itemById(a.pickId || a.itemId); }
  function stepper(id, label, val, allowZero) {
    return '<div class="field"><label for="I_f_' + id + '">' + label + '</label><div class="I_step"><button class="btn btn-secondary I_sb" type="button" data-act="step" data-f="' + id + '" data-d="-1" data-z="' + (allowZero ? 1 : 0) + '" aria-label="One less">' + gi('minus') + '</button>' +
      '<div class="input"><input id="I_f_' + id + '" inputmode="decimal" autocomplete="off" value="' + esc(val) + '"></div><button class="btn btn-secondary I_sb" type="button" data-act="step" data-f="' + id + '" data-d="1" data-z="' + (allowZero ? 1 : 0) + '" aria-label="One more">' + gi('plus') + '</button></div></div>';
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
    if (a.kind === 'cconfirm') return head(a.text) + '<form data-i-form>' + actions(a, 'Yes') + '</form>';
    if (a.kind === 'labels') return renderLabels(a);
    if (a.kind === 'tidy') return renderTidy(a);
    if (a.kind === 'rename') return renderRename(a);
    if (a.kind === 'sort') return renderSort(a);
    if (a.kind === 'walk') return renderWalk(a);
    if (a.kind === 'bought') return renderBought(a);
    if (a.kind === 'scan') return renderScan(a);
    if (a.kind === 'report') return renderReport(a);
    if (a.kind === 'addlow') return renderAddLow(a);
    if (a.kind === 'copytext') return renderCopy(a);
    if (a.kind === 'create') return renderCreate(a);
    var it = itemOf(a); if (!it) return null;
    var v = a.vals || {}, m = M.role, h;
    if (a.kind === 'history') return renderHistory(a, it);
    if (a.kind === 'photo' || a.kind === 'photoremove') return renderPhoto(a, it);
    if (a.kind === 'optusual') return renderOptUsual(a, it);
    if (a.kind === 'unlink') return head('Unlink code ' + shortCode(a.code) + ' from ' + it.name + '?') + '<form data-i-form><p class="I_conf">Scanning this code will no longer open ' + esc(it.name) + '.</p>' + actions(a, 'Yes, unlink it') + '</form>';
    if (a.kind === 'low') return head(canManage(M.role) ? 'Add ' + it.name + ' to the shopping list?' : 'Tell the owner ' + it.name + ' is running low?') + '<form data-i-form><p class="I_conf">It goes on the shopping list for ' + esc(uq(lowQty(it), it.purchaseUnit || unitOf(it))) + '.</p>' + actions(a, canManage(M.role) ? 'Yes, add it' : 'Yes, tell them') + '</form>';
    if (a.kind === 'link') return head('Link code ' + shortCode(a.code) + ' to ' + it.name + '?') + '<form data-i-form><p class="I_conf">Scanning this code will open ' + esc(it.name) + '.</p>' + actions(a, 'Yes, link it') + '</form>';
    if (a.kind === 'menu') {
      var info = M.itemInfo[it.id], shopRows = (K.shop || []).filter(function (r) { return r.itemId === it.id; }), cover = it.cover != null ? fmt(it.cover) + ' days' : it.coverEst != null ? 'about ' + fmt(it.coverEst) + ' days (an estimate)' : '', lasts = it.cover != null ? fmt(it.cover) : it.coverEst != null ? fmt(it.coverEst) : null;
      var ac = menuActions(it, a), listedQ = shopRows.map(function (r) { return r.qty != null ? uq(r.qty, r.unit || '') : ''; }).filter(Boolean).join(', ');
      // s107 B6: the title and Close stay at the top of the sheet; the level, the one action for this role and the options come before the details
      h = '<div class="F_sheethead I_sh"><h2 class="hd I_sht" id="I_sh_t" tabindex="-1">' + esc(it.name) + '</h2><button class="btn btn-secondary btn-sm F_close" type="button" data-act="close">' + gi('close', 's16') + 'Close</button></div>' +
        '<div class="I_hero">' + photoBlock(it) + '<div class="I_herob"><p class="help I_cat">' + esc(it.category + (it.consumable ? ' · consumable' : '')) + '</p>' +
        '<p class="I_lvline">' + (it.qty == null ? '' : levelBadge(it) + ' ') + esc(amountText(it)) + (lasts != null ? ' · lasts about ' + esc(lasts) + ' days' : '') + '</p>' +
        (M.denied.shop || !shopRows.length ? '' : '<p class="I_onlist">' + gi('bag', 's16') + ' On the list' + (listedQ ? ', ' + esc(listedQ) : '') + '</p>') + '</div></div>' +
        (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') + errBox(a) +
        '<div class="I_actbar">' + ac.chosen.map(function (c, n) { return actBtn(c, n === 0 ? 'btn-primary' : 'btn-secondary'); }).join('') + '</div>' + lastChange(it) + optionsBlock(it) +
        '<details class="I_det" open><summary>Details</summary><dl class="I_dl">' +
        row('On hand', it.qty == null ? 'Not counted' : esc(uq(it.qty, it.unit))) + row('Reorder at', it.reorder == null ? 'Not set' : esc(uq(it.reorder, it.unit))) + (it.location ? row('Kept in', esc(it.location)) : '') + whereRow(it) +
        (K.v84 && (it.consumable || it.par != null) ? row('Buy up to', it.par != null ? esc(uq(it.par, it.unit)) : it.reorder != null ? esc('2 x reorder level (' + fmt(it.reorder * 2) + ')') : 'Not set') : '') +
        (K.v84 && canManage(m) ? row('Barcodes', it.codes.length ? it.codes.length + ' linked' : 'None linked') + (allowed('unlink') ? it.codes.map(function (c) { return row('Code', esc(c) + ' <button class="btn btn-ghost I_undobtn" type="button" data-act="unlink" data-code="' + esc(c) + '" aria-label="Unlink code ' + esc(c) + '">Unlink</button>'); }).join('') : '') : '') +
        (canManage(m) && info && info.done ? row('Last counted', info.lastCounted ? esc(dateLabel(info.lastCounted)) : 'Not counted in the app yet') : '') +
        (cover ? row('Lasts', esc(cover)) : '') + (canPrice(m) && it.cost != null ? row('Unit cost', esc(peso(it.cost))) : '') + '</dl></details>' +
        (ac.rest.length ? '<div class="I_moreb"><h3 class="I_hh">More</h3><div class="I_grid2">' + ac.rest.map(function (c) { return actBtn(c, 'btn-secondary'); }).join('') + '</div></div>' : '') +
        (canManage(m) ? '<p class="help I_more"><a href="#door/inventory" data-act="admin">Full inventory in the admin dashboard</a></p>' : '');
      return h;
    }
    var c = a.step === 'confirm';
    if (a.kind === 'count') {
      var n = parseQty(v.qty, true), d = n == null || it.qty == null ? null : Math.round((n - it.qty) * 100) / 100;
      return head(c ? 'Set ' + it.name + ' to ' + fmt(n) + '?' : 'Count ' + it.name, c ? null : 'Count what is in the storeroom.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Now ' + (it.qty == null ? 'not counted' : esc(uq(it.qty, it.unit))) + (d != null ? ', a change of ' + (d > 0 ? '+' : '') + fmt(d) : '') + '.</p>' + (it.controlled ? '' : '<p class="I_conf">After this, ' + esc(it.name) + ' is counted in the app. Telegram /count will skip it.</p>')
          : stepper('qty', 'Counted (' + esc(unitOf(it)) + ')', v.qty, true) + textField('note', 'Note (optional)', v.note || '', 'maxlength="200" placeholder="Where you counted"') + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter a number such as 12 or 2.5.</span></div>' : '')) +
        actions(a, c ? 'Yes, set it' : 'Continue') + '</form>';
    }
    if (a.kind === 'used') {
      var u = parseQty(v.qty);
      return head(c ? 'Log ' + uq(u, unitOf(it)) + ' of ' + it.name + ' as used?' : 'Record use: ' + it.name, c ? null : 'How much did you use?') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Today’s date will be recorded.</p>' : stepper('qty', 'Used (' + esc(unitOf(it)) + ')', v.qty, false) + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter a number such as 1 or 2.5.</span></div>' : '')) +
        actions(a, c ? 'Yes, log it' : 'Continue') + '</form>';
    }
    if (a.kind === 'recv') {
      var pk = parseQty(v.packs), pu = it.purchaseUnit || it.unit || 'pack', add = pk == null ? null : Math.round(pk * it.perPack * 100) / 100;
      return head(c ? 'Add ' + uq(add, unitOf(it)) + ' of ' + it.name + '?' : 'Stock received: ' + it.name, c ? null : 'Enter what arrived.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">' + esc(uq(pk, pu) + (it.perPack !== 1 ? ' x ' + uq(it.perPack, unitOf(it)) : '')) + (v.supplier ? ' from ' + esc(v.supplier) : '') + '. On hand goes to ' + esc(it.qty == null ? uq(add, unitOf(it)) : uq(it.qty + add, unitOf(it))) + '.</p>'
          : supplierField(a) + stepper('packs', 'How many (' + esc(pu) + ')', v.packs, false) + textField('cost', 'Cost per ' + esc(pu) + ' in PHP (optional)', v.cost || '', 'inputmode="decimal"') +
            (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter numbers such as 2 or 150.50.</span></div>' : '')) + actions(a, c ? 'Yes, add it' : 'Continue') + '</form>';
    }
    if (a.kind === 'shop') {
      var sq = parseQty(v.qty);
      return head(c ? 'Add ' + uq(sq, it.purchaseUnit || unitOf(it)) + ' of ' + it.name + ' to the shopping list?' : 'Add to shopping list: ' + it.name, c ? null : 'The owner will see this request.') + '<form data-i-form>' +
        (c ? (v.note ? '<p class="I_conf">' + esc(v.note) + '</p>' : '') : stepper('qty', 'How many (' + esc(it.purchaseUnit || unitOf(it)) + ')', v.qty, false) + textField('note', 'Note (optional)', v.note || '', 'maxlength="200"') + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter a number such as 1 or 2.</span></div>' : '')) +
        actions(a, c ? 'Yes, add it' : 'Continue') + '</form>';
    }
    if (a.kind === 'price') {
      var pc = String(v.cost || '').trim() === '' ? null : parseQty(v.cost);
      return head(c ? (pc == null ? 'Clear the price of ' + it.name + '?' : 'Set the price of ' + it.name + ' to PHP ' + pesoNum(pc) + '?') : 'Change price: ' + it.name, c ? null : 'Enter what one costs.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Only the owner, admin and finance can see prices.</p>' : textField('cost', 'Price per ' + esc(unitOf(it)) + ' in PHP (leave empty to clear)', v.cost || '', 'inputmode="decimal"') + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter a number such as 95 or 95.50.</span></div>' : '')) +
        actions(a, c ? 'Yes, save it' : 'Continue') + '</form>';
    }
    if (a.kind === 'levels') {
      return head(c ? 'Save the details for ' + it.name + '?' : 'Edit details: ' + it.name, c ? null : 'Leave a box empty to clear it.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Reorder at ' + esc(String(v.reorder || '').trim() === '' ? 'not set' : v.reorder) + '. Buy up to ' + esc(String(v.par || '').trim() === '' ? 'not set' : v.par) + '.</p>' + detailsChanges(it, v)
          : levelsSuggest(a, it) + textField('reorder', 'Reorder at (' + esc(unitOf(it)) + ')', v.reorder || '', 'inputmode="decimal"') + textField('par', 'Buy up to (' + esc(unitOf(it)) + ')', v.par || '', 'inputmode="decimal"') + detailsFields(it, v) + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' ' + esc(a.bad === 'levels' ? ERR.levels : 'Enter numbers such as 12 or 2.5.') + '</span></div>' : '')) +
        actions(a, c ? 'Yes, save them' : 'Continue') + '</form>';
    }
    return null;
  }
  // Where to buy: the shop and its place for every role; the last price (with a pack figure) and the price-up mark for finance-capable roles only.
  function whereRow(it) {
    var s = it.supplier; if (!s) return '';
    var money = canPrice(M.role), t = esc(s.name) + (s.location ? ', ' + esc(s.location) : '');
    if (money && it.lastPrice != null) t += ', last ' + esc(phpText(it.lastPrice)) + ' each' + (it.perPack > 1 ? ' (' + esc(phpText(it.lastPrice * it.perPack)) + ' a ' + esc(it.purchaseUnit || 'pack') + ' of ' + esc(fmt(it.perPack)) + ')' : '');
    if (money && it.priceUp != null && it.priceUp > 0) t += ' <span class="I_up"><span aria-hidden="true">' + gi('alert', 's16') + '</span> Price up ' + esc(fmt(it.priceUp)) + '%</span>';
    return row('Where to buy', money && supOK() && root.I_Suppliers.openPriceHistory ? '<button class="btn btn-ghost I_whereb" type="button" data-act="pricehist">' + t + '</button>' : t);
  }
  // Edit details (s86 4.6): where it is kept (with the places already used), the unit, the category.
  function detailsFields(it, v) {
    var locs = {}, units = UNITS.slice(), cats = categories();
    (K.items || []).forEach(function (i) { if (i.location) locs[i.location] = 1; });
    if (units.indexOf(it.unit) < 0 && it.unit) units.unshift(it.unit);
    if (cats.indexOf(it.category) < 0) cats.unshift(it.category);
    return (K.hasLoc ? '<div class="field"><label for="I_f_location">Kept in (optional)</label><div class="input"><input id="I_f_location" list="I_locs" autocomplete="off" maxlength="60" placeholder="Hall cabinet" value="' + esc(v.location || '') + '"></div><datalist id="I_locs">' + Object.keys(locs).sort().map(function (l) { return '<option value="' + esc(l) + '"></option>'; }).join('') + '</datalist></div>' : '') +
      selectField('unit', 'Unit', units.map(function (u) { return [u, u]; }), v.unit != null ? v.unit : it.unit) + selectField('category', 'Category', cats.map(function (c) { return [c, c]; }), v.category != null ? v.category : it.category);
  }
  function detailsChanges(it, v) {
    var out = [];
    if (K.hasLoc && 'location' in v && String(v.location || '').trim() !== it.location) out.push(String(v.location || '').trim() === '' ? 'Kept in: cleared' : 'Kept in: ' + String(v.location).trim());
    if ('unit' in v && String(v.unit || '').trim() !== it.unit) out.push('Unit: ' + String(v.unit).trim());
    if ('category' in v && String(v.category || '').trim() !== it.category) out.push('Category: ' + String(v.category).trim());
    return out.length ? '<p class="I_conf">' + esc(out.join('. ')) + '.</p>' : '';
  }
  function pesoNum(n) { return fmt(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function catOK() { return !K.denied.cat; } // Let Cassy choose hides for the visit when inventory-categorise is not there
  function categories() { var c = {}; (K.items || []).forEach(function (i) { c[i.category] = 1; }); c.Miscellaneous = 1; return Object.keys(c).sort(); }

  /* ---- photo, labels, tidy categories, Cassy (s86 4.4 - 4.6, 9.5) */
  function renderPhoto(a, it) {
    if (a.kind === 'photoremove') return head('Remove the photo of ' + it.name + '?') + '<form data-i-form>' + actions(a, 'Yes, remove it') + '</form>';
    if (a.step === 'prep') return head('Getting the photo ready') + '<p class="help I_load" role="status">One moment.</p><div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Cancel</button></div>';
    if (a.step === 'bad') return head('Photo of ' + it.name) + errBox(a) + '<div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Back</button></div>';
    var kb = a.blob && a.blob.size ? Math.max(1, Math.round(a.blob.size / 1024)) : null;
    return head('Use this photo for ' + it.name + '?', kb ? 'About ' + kb + ' KB after resizing.' : null) + '<form data-i-form>' + (a.prev ? '<div class="I_photo"><img src="' + esc(a.prev) + '" alt="Preview of the new photo"></div>' : '') + actions(a, 'Yes, use it') + '</form>';
  }
  function noCode(i) { return !i.codes.length; }
  function hasLabel(i) { return i.codes.some(function (c) { return /^CH-/.test(c); }); }
  function labelPool(a) { return (K.items || []).filter(function (i) { return noCode(i) || (a.withLabel && hasLabel(i)); }).sort(byName); }
  function labelRows(a) { return labelPool(a).filter(function (i) { return !a.cat || i.category === a.cat; }); }
  function labelIds(a) { var vis = {}; labelRows(a).forEach(function (i) { vis[i.id] = 1; }); return (K.items || []).filter(function (i) { return a.sel && a.sel[i.id] && vis[i.id]; }).map(function (i) { return i.id; }); } // only what is shown under the filter is sent
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function renderLabels(a) {
    var ids = labelIds(a), mint = ids.filter(function (id) { return noCode(itemById(id)); }).length;
    if (a.step === 'confirm') {
      return head(mint ? 'Make QR codes for ' + plural(mint, 'item', 'items') + ' and send a label sheet to the Finance group?' : 'Send a label sheet for ' + plural(ids.length, 'item', 'items') + ' to the Finance group?') + '<form data-i-form>' +
        (mint && ids.length > mint ? '<p class="I_conf">' + plural(ids.length - mint, 'item already has', 'items already have') + ' a label and ' + (ids.length - mint === 1 ? 'is' : 'are') + ' included.</p>' : '') +
        '<p class="help">Scanning a printed label opens the item. Nothing is charged and no prices are on the sheet.</p>' + errBox(a) + actions(a, mint ? 'Yes, make and send' : 'Yes, send it') + '</form>';
    }
    var none = (K.items || []).filter(noCode).length, pool = labelPool(a), rows = labelRows(a), cats = {}, hasAny = (K.items || []).some(hasLabel);
    pool.forEach(function (i) { cats[i.category] = 1; });
    var allOn = rows.length > 0 && rows.every(function (i) { return a.sel[i.id]; });
    return head('Print QR labels', plural(none, 'item has', 'items have') + ' no barcode.') + '<form data-i-form>' +
      (Object.keys(cats).length > 1 ? '<div class="I_pickrows" role="group" aria-label="Category">' + [''].concat(Object.keys(cats).sort()).map(function (c) { return '<button class="chip I_choice" type="button" data-act="lab-cat" data-k="' + esc(c) + '" aria-pressed="' + (a.cat === c) + '">' + (a.cat === c ? gi('check', 's16') + ' ' : '') + esc(c || 'All') + '</button>'; }).join('') + '</div>' : '') +
      (hasAny ? '<button class="chip I_choice" type="button" data-act="lab-has" aria-pressed="' + !!a.withLabel + '">' + (a.withLabel ? gi('check', 's16') + ' ' : '') + 'Also items that already have a label</button>' : '') +
      (rows.length ? '<button class="btn btn-ghost I_undobtn" type="button" data-act="lab-all">' + (allOn ? 'Untick these' : 'Tick all of these') + '</button>' : '<p class="help">Every item here already has a barcode.</p>') +
      rows.map(function (i) { var on = !!a.sel[i.id]; return '<button class="btn btn-secondary btn-block I_tick" type="button" data-act="lab-tick" data-id="' + esc(i.id) + '" aria-pressed="' + on + '">' + gi(on ? 'check' : 'plus', 's16') + ' ' + esc(i.name) + '</button>'; }).join('') +
      '<p class="help" role="status">' + plural(ids.length, 'item', 'items') + ' ticked.</p>' + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Tick at least one item.</span></div>' : '') + actions(a, 'Continue') + '</form>';
  }
  // The label sheet: mint the codes (items that already have a code are skipped by the server), then send the sheet. The mint has its own Undo the moment it lands.
  function detachCall(code) { return { fn: 'inventory_code_detach_v1', args: { p_property_id: M.pid, p_code: code } }; }
  function mintUndo(minted) {
    var codes = minted.map(function (x) { return x && x.code; }).filter(Boolean); if (!codes.length) return null;
    return { id: 'u' + (++K.uidn), itemId: null, name: '', at: nowMs(), kind: 'labels', say: 'Made ' + plural(codes.length, 'QR code', 'QR codes'), line: 'made QR codes', confirm: 'Remove the ' + plural(codes.length, 'QR code', 'QR codes') + ' just made?', call: detachCall(codes[0]), more: codes.slice(1).map(detachCall) };
  }
  function labelsExec(a) {
    var me = M, ids = labelIds(a), c = mintCall(me.pid, ids);
    return Promise.resolve(me.client.rpc(c.fn, c.args)).then(function (r) {
      if (r && r.error) throw r.error;
      if (!r || !r.data || r.data.ok === false) throw { message: 'failed', data: r && r.data || {} };
      a.mintedDone = true;
      var mu = mintUndo(Array.isArray(r.data.minted) ? r.data.minted : []); if (mu) pushUndoEntry(mu);
      var l = labelsCall(ids);
      return me.client.functions.invoke(l.invoke, { body: l.body });
    }).then(function (r2) { if (r2 && r2.error) throw r2.error; if (r2 && r2.data && r2.data.ok === false) throw { message: 'failed', data: r2.data }; return r2; });
  }
  function catCounts() { var by = {}; (K.items || []).forEach(function (i) { by[i.category] = (by[i.category] || 0) + 1; }); return by; }
  function mergeTarget(from, to) { var t = String(to || '').trim().toLowerCase(), hit = null; Object.keys(catCounts()).forEach(function (c) { if (c !== from && c.toLowerCase() === t) hit = c; }); return hit; }
  function groupBefore(moved) { var order = [], by = {}; moved.forEach(function (m) { var b = String(m.before); if (!by[b]) { by[b] = { before: b, ids: [] }; order.push(b); } by[b].ids.push(m.id); }); return order.map(function (b) { return by[b]; }); }
  function renderTidy() {
    var by = catCounts(), cats = Object.keys(by).sort(), un = by[UNCAT] || 0;
    return head('Tidy categories', 'Rename a category. Give it the name of another and the two are merged.') +
      (allowed('sort') && un ? '<div class="I_btns"><button class="btn btn-primary btn-block" type="button" data-act="sort">' + gi('sparkles', 's16') + ' Sort uncategorised items (' + un + ')</button></div>' : '') +
      '<div class="card list I_list">' + cats.map(function (c) { return '<div class="rowi I_row"><span class="mid"><span class="t">' + esc(c) + '</span><span class="s">' + plural(by[c], 'item', 'items') + '</span></span>' + (M.denied.rename ? '' : '<button class="btn btn-ghost I_qa" type="button" data-act="rename" data-cat="' + esc(c) + '" aria-label="Rename ' + esc(c) + '">Rename</button>') + '</div>'; }).join('') + '</div>' +
      '<div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="close">Close</button></div>';
  }
  function renderRename(a) {
    var v = a.vals, to = String(v.to || '').trim(), n = catCounts()[a.from] || 0, tgt = mergeTarget(a.from, to);
    if (a.step === 'confirm') return head(tgt ? 'Move ' + plural(n, 'item', 'items') + ' from ' + a.from + ' into ' + tgt + '?' : 'Rename ' + a.from + ' to ' + to + '?') + '<form data-i-form>' + (tgt ? '<p class="I_conf">' + esc(tgt) + ' already exists, so the two become one.</p>' : '<p class="I_conf">' + plural(n, 'item', 'items') + ' move with it.</p>') + errBox(a) + actions(a, tgt ? 'Yes, move them' : 'Yes, rename it') + '</form>';
    return head('Rename ' + a.from) + '<form data-i-form>' + textField('to', 'New name', v.to != null ? v.to : a.from, 'maxlength="60"') + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Type a different name, up to 60 characters.</span></div>' : '') + actions(a, 'Continue') + '</form>';
  }
  function renderSort(a) {
    var n = catCounts()[UNCAT] || 0;
    return head('Let Cassy sort ' + plural(n, 'item', 'items') + '?') + '<form data-i-form><p class="I_conf">Cassy moves each one to the closest category you already have. Anything she is not sure about stays in Uncategorised.</p>' + errBox(a) + actions(a, 'Yes, sort them') + '</form>';
  }
  function catUndo(results, remaining) {
    var more = remaining > 0 ? '. ' + remaining + ' more are waiting' : '';
    var e = { id: 'u' + (++K.uidn), itemId: null, name: '', at: nowMs(), kind: 'sort' };
    if (results.length === 1) {
      var r = results[0]; e.say = 'Cassy put ' + r.name + ' in ' + r.after + more; e.line = 'sorted it into ' + r.after; e.confirm = 'Put ' + r.name + ' back in ' + r.before + '?';
      e.call = { fn: 'inventory_item_update_v1', args: { p_item_id: r.item_id, p_patch: { category: r.before } } }; return e;
    }
    var gr = groupBefore(results.map(function (x) { return { id: x.item_id, before: x.before }; }));
    e.say = 'Cassy sorted ' + results.length + ' items' + more; e.line = 'sorted items'; e.confirm = 'Put the ' + results.length + ' items back where they were?';
    e.call = recatCall(M.pid, gr[0].ids, gr[0].before); e.more = gr.slice(1).map(function (g) { return recatCall(M.pid, g.ids, g.before); }); return e;
  }
  // A new item left on "Let Cassy choose": ask inventory-categorise once. Any failure leaves it in Uncategorised; a missing function hides the option for the visit.
  function cassyOne(itemId) {
    var me = M; if (!me || me.demo || !me.client || !me.client.functions || !me.client.functions.invoke || K.denied.cat) return;
    Promise.resolve().then(function () { return me.client.functions.invoke('inventory-categorise', { body: { item_id: itemId } }); }).then(function (r) {
      if (r && r.error) throw r.error;
      var res = r && r.data && Array.isArray(r.data.results) && r.data.results[0]; if (!res) return;
      pushUndoEntry(catUndo([res])); K.at = 0; if (M) { drawUndo(); say('Cassy put ' + res.name + ' in ' + res.after + '.'); load(); }
    }).catch(function (e) { var k = errKind(e, online()); if (k === 'missing' || k === 'refused') K.denied.cat = true; });
  }

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
      (c ? '<p class="I_conf">' + esc(v.category === CASSY ? 'Cassy will choose the category' : v.category) + ', counted in ' + esc(String(v.unit || '').trim() || 'pc') + (v.cons === 'yes' ? ', a consumable' : '') + '.</p><p class="I_conf">Code ' + esc(a.code) + ' will be linked to it.</p>' +
          (String(v.qty || '').trim() !== '' ? '<p class="I_conf">Counted now: ' + esc(v.qty) + '. After this, ' + esc(String(v.name).trim()) + ' is counted in the app. Telegram /count will skip it.</p>' : '') +
          (String(v.reorder || '').trim() !== '' ? '<p class="I_conf">Reorder at ' + esc(v.reorder) + '.</p>' : '')
        : textField('name', 'Name', v.name || '', 'maxlength="80"') + selectField('category', 'Category', (catOK() ? [[CASSY, 'Let Cassy choose']] : [['', 'Choose one']]).concat(cats.map(function (x) { return [x, x]; })), v.category || (catOK() ? CASSY : '')) +
          textField('unit', 'Unit', v.unit || '', 'maxlength="20"') + selectField('cons', 'Is it a consumable?', [['no', 'No'], ['yes', 'Yes']], v.cons || 'no') +
          textField('qty', 'Counted now (optional)', v.qty || '', 'inputmode="decimal"') + textField('reorder', 'Reorder at (optional)', v.reorder || '', 'inputmode="decimal"') +
          (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Give it a name and a category. Numbers such as 12 or 2.5.</span></div>' : '')) +
      errBoxIf(a, c) + actions(a, c ? 'Yes, add it' : 'Continue') + '</form>';
  }
  function errBoxIf(a, c) { return c ? errBox(a) : ''; }
  function coolLeft(v) { var t = K.cool[v.rkind + '|' + v.to]; return t && nowMs() - t < COOL_MS ? COOL_MS - (nowMs() - t) : 0; }
  function renderReport(a) {
    var v = a.vals, c = a.step === 'confirm', pick = REPORTS.filter(function (r) { return r.k === v.rkind; })[0], fin = v.to === 'finance', money = canPrice(M.role);
    if (c) return head('Send ' + pick.s + ' to the ' + (fin ? 'Finance' : 'OPS') + ' group?') + '<form data-i-form>' + (money ? '<p class="I_conf">' + (fin ? 'Prices are included.' : 'No prices are shown.') + '</p>' : '') + actions(a, 'Yes, send it') + '</form>';
    return head('Send a report', 'A PDF list goes to Telegram.') + '<form data-i-form><div class="I_pickrows" role="group" aria-label="Which list">' +
      REPORTS.map(function (r) { return '<button class="chip I_choice" type="button" data-act="rep-kind" data-k="' + r.k + '" aria-pressed="' + (v.rkind === r.k) + '">' + (v.rkind === r.k ? '' + gi('check', 's16') + ' ' : '') + esc(r.t) + '</button>'; }).join('') + '</div>' +
      (money && !K.noFinance ? '<div class="I_pickrows" role="group" aria-label="Send to"><button class="chip I_choice" type="button" data-act="rep-to" data-to="finance" aria-pressed="' + fin + '">' + (fin ? '' + gi('check', 's16') + ' ' : '') + 'Finance group (with prices)</button><button class="chip I_choice" type="button" data-act="rep-to" data-to="ops" aria-pressed="' + !fin + '">' + (!fin ? '' + gi('check', 's16') + ' ' : '') + 'OPS group (no prices)</button></div>' : '<p class="help">It goes to the OPS group.</p>') +
      (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' That list was just sent. Please wait half a minute.</span></div>' : '') + actions(a, 'Continue') + '</form>';
  }
  // The actions of the item card (s107 B6). One primary for the role, up to two beside it, everything else under More. Listed items show a status line instead of an add button.
  // A scanned card puts the most useful action for the role first (owner/admin count, finance price, cleaner shopping list).
  function menuActions(it, a) {
    var m = M.role, listed = (K.shop || []).some(function (r) { return r.itemId === it.id; }), lv = level(it), all = {}, order = [];
    var add = function (kind, text, act, file) { all[kind] = { kind: kind, text: text, act: act || 'begin', file: !!file }; order.push(kind); };
    if (!listed && allowed('low', it)) add('low', canManage(m) ? 'Add to list' : 'Running low');
    if (allowed('count')) add('count', 'Count it');
    if (allowed('used')) add('used', 'Record use');
    if (allowed('price')) add('price', 'Change price');
    if (allowed('recv', it)) add('recv', 'Stock received');
    if (allowed('levels')) add('levels', 'Edit details');
    if (allowed('link')) add('link', 'Link a barcode', 'begin-link');
    if (!listed && allowed('shop')) add('shop', 'Add to shopping list');
    if (allowed('photo')) add('photo', it.photo ? 'Change photo' : 'Add photo', null, true);
    if (it.photo && allowed('photo')) add('photorem', 'Remove photo', 'photo-remove');
    if (canManage(m) && supOK() && root.I_Suppliers.openItemSuppliers) add('itemsup', 'Suppliers for this item', 'item-sup');
    if (allowed('history')) add('history', 'History', 'history-open');
    var pri = canManage(m) ? (lv !== 'ok' ? ['low', 'count', 'recv'] : ['count', 'recv', 'low']) : allowed('used') ? ['used', 'low', 'count'] : canPrice(m) ? ['price', 'low', 'shop'] : ['low', 'count', 'shop'];
    if (a && a.scanned) pri.unshift(canManage(m) ? 'count' : canPrice(m) ? 'price' : 'low');
    var chosen = [];
    pri.forEach(function (k) { if (all[k] && chosen.indexOf(k) < 0 && chosen.length < 3) chosen.push(k); });
    if (!chosen.length) order.some(function (k) { if (!all[k].file) { chosen.push(k); return true; } return false; });
    return { chosen: chosen.map(function (k) { return all[k]; }), rest: order.filter(function (k) { return chosen.indexOf(k) < 0; }).map(function (k) { return all[k]; }) };
  }
  function actBtn(c, cls) {
    if (c.file) return '<label class="btn btn-secondary btn-block I_filebtn"><input class="sr" id="I_photo_in" type="file" accept="image/*" capture="environment">' + c.text + '</label>';
    return '<button class="btn ' + cls + ' btn-block" type="button" data-act="' + c.act + '" data-kind="' + c.kind + '">' + c.text + '</button>';
  }
  // Running low (s84 1b): the amount to buy back to par (or 2 x reorder level), in packs; 1 when it cannot be worked out.
  function lowQty(it) {
    var target = it.par != null ? it.par : it.reorder != null ? it.reorder * 2 : null;
    if (target == null || it.qty == null) return 1;
    return Math.max(1, Math.ceil(Math.max(target - it.qty, 0) / (it.perPack || 1)));
  }
  function renderShopSheet(a) {
    var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!r) return null;
    return head(r.name, (r.qty != null ? uq(r.qty, r.unit || '') : '') + ' · ' + (r.status === 'approved' ? 'Approved' : 'Asked')) + (r.note ? '<p>' + esc(r.note) + '</p>' : '') + (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') + errBox(a) +
      '<div class="I_btns">' + (r.status === 'proposed' && !M.denied.shopset ? '<button class="btn btn-primary btn-block" type="button" data-act="shop-do" data-do="approved">Approve</button>' : '') +
      (r.status === 'approved' && r.itemId && allowed('recv', itemById(r.itemId)) ? '<button class="btn btn-primary btn-block" type="button" data-act="shop-bought">Mark bought</button>' : '') +
      (M.denied.shopset ? '' : '<button class="btn btn-secondary btn-block" type="button" data-act="shop-do" data-do="rejected">Remove from the list</button>') + '<button class="btn btn-ghost btn-block" type="button" data-act="close">Close</button></div>';
  }

  /* ---- events */
  function attr(t, name) { return t && t.getAttribute ? t.getAttribute(name) : null; }
  function onClick(ev) {
    if (!M) return;
    var mo = M.el.querySelector ? M.el.querySelector('.I_menu[open]') : null; // the More menu closes on any tap but its own button
    if (mo && !(ev.target && ev.target.closest && ev.target.closest('summary'))) mo.removeAttribute('open');
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null; if (!t) return;
    var act = attr(t, 'data-act'), a0 = M.act;
    if (act === 'admin') { if (ev.preventDefault) ev.preventDefault(); M.opts.navigate && M.opts.navigate('#door/inventory'); return; }
    if (act === 'tab') { viewSave(!!attr(t, 'data-to')); return go(attr(t, 'data-to') ? '#stock/' + attr(t, 'data-to') : '#stock', attr(t, 'data-to') || ''); }
    if (act === 'chip') { K.chip = attr(t, 'data-k'); viewSave(false); draw(); return; }
    if (act === 'showall') { K.chip = 'all'; K.q = ''; viewSave(false); draw(); return; }
    if (act === 'cart') { var cid = attr(t, 'data-id'), cr = cartRead(); if (cr[cid]) delete cr[cid]; else cr[cid] = 1; cartSave(); drawList(); return; } // s107 B11: a local tick, nothing is sent
    if (act === 'bought-open') { if (!allowed('bought') || (M.act && M.act.sending)) return; var pre = {}, pv = {}, cr2 = cartRead(); boughtRows().forEach(function (r) { if (cr2[r.id]) { pre[r.id] = 1; pv['packs_' + r.id] = fmt(r.qty || 1); } }); M.act = { kind: 'bought', step: 'pick', sel: pre, vals: pv, keys: {}, done: {} }; drawLayer(); loadShop(); return; } // the list is re-read first: a row someone else bought drops out
    if (act === 'walk') { if (a0 && a0.sending) return; return walkStart(attr(t, 'data-cat')); }
    if (act === 'scan') { if (M.act && M.act.sending) return; return openScan(null); }
    if (act === 'report') { if (!allowed('report') || (M.act && M.act.sending)) return; var rk = attr(t, 'data-k'); M.act = { kind: 'report', step: 'form', vals: { rkind: REPORTS.some(function (r) { return r.k === rk; }) ? rk : 'order', to: 'ops' } }; drawLayer(); return; }
    if (act === 'addlow-open') return addLowOpen();
    if (act === 'shop-share') { if (M.act && M.act.sending) return; return shareText(); }
    if (act === 'shop-image') { if (M.act && M.act.sending) return; return saveImage(); }
    if (act === 'tidy') { if (!allowed('tidy') || (M.act && M.act.sending)) return; M.act = { kind: 'tidy' }; drawLayer(); return; }
    if (act === 'labels') { if (!allowed('labels') || (M.act && M.act.sending)) return; var lsel = {}; (K.items || []).filter(noCode).forEach(function (i) { lsel[i.id] = 1; }); M.act = { kind: 'labels', step: 'form', sel: lsel, cat: '', withLabel: false }; drawLayer(); return; }
    if (act === 'retry') { M.loadErr = null; M.shopErr = null; M.loading = false; if (!K.items) draw(); load(); return; }
    if (act === 'quick') { var qid = attr(t, 'data-id'), qk = attr(t, 'data-kind'); if (!itemById(qid) || M.act) return; K.quick = { id: qid, kind: qk, at: nowMs() }; go('#stock/item/' + qid, 'item/' + qid, qid); applyQuick(true); return; } // the card opens straight on the form; Back returns to the card
    if (act === 'open') return go('#stock/item/' + attr(t, 'data-id'), 'item/' + attr(t, 'data-id'), attr(t, 'data-id'));
    if (act === 'shop-open') { if (!canManage(M.role)) return; M.act = { kind: 'menu', shopId: attr(t, 'data-id') }; drawLayer(); return; }
    var a = M.act;
    if (act === 'close') return closeSheet();
    if (act === 'undo') { var ue = undoById(attr(t, 'data-id')); if (!ue || (a && a.sending) || K.denied[ue.call.fn]) return; M.act = { kind: 'undo', entry: ue, step: 'confirm' }; drawLayer(); return; }
    if (!a) return;
    if (a.sending) return; // nothing, not even Close, while a write is in flight
    if (act === 'al-tick') { if (a.kind !== 'addlow') return; var tl = a.lines.filter(function (l) { return l.itemId === attr(t, 'data-id'); })[0]; if (tl && !tl.ok) { tl.on = !tl.on; if (!tl.on) tl.fail = false; a.bad = false; drawLayer(); } return; }
    if (act === 'begin') return begin(attr(t, 'data-kind'));
    if (act === 'opt-usual') { var ou = a.kind === 'menu' && a.itemId ? optById(a.itemId, attr(t, 'data-id')) : null; if (ou && !ou.usual && canManage(M.role) && allowed('optusual')) { var pu0 = (K.opt[a.itemId].list || []).filter(function (x) { return x.usual; })[0] || null; M.act = { kind: 'optusual', itemId: a.itemId, optId: ou.id, prev: pu0 ? { id: pu0.id, title: pu0.title } : null, step: 'confirm' }; drawLayer(); } return; }
    if (act === 'opt-photo') { var op = a.kind === 'menu' && a.itemId ? optById(a.itemId, attr(t, 'data-id')) : null, oit = itemById(a.itemId); if (op && op.image && oit && canManage(M.role) && allowed('photo')) photoRun(oit, function () { return fetchPicture(op.image); }); return; }
    if (act === 'photo-remove') { if (a.kind === 'menu' && a.itemId && allowed('photo')) { M.act = { kind: 'photoremove', itemId: a.itemId, step: 'confirm' }; drawLayer(); } return; }
    if (act === 'pick-sup') { if (a.kind === 'recv' || a.kind === 'bought') pickSupplier(a); return; }
    if (act === 'pricehist' || act === 'item-sup') { var sit = a.kind === 'menu' ? itemById(a.itemId) : null, fnm = act === 'pricehist' ? 'openPriceHistory' : 'openItemSuppliers'; if (sit && supOK() && root.I_Suppliers[fnm]) { try { root.I_Suppliers[fnm](supCtx(), sit); } catch (e) { toast(ERR.missing); } } return; }
    if (act === 'rename') { if (a.kind === 'tidy' && !M.denied.rename) { var rf = attr(t, 'data-cat'); M.act = { kind: 'rename', step: 'form', from: rf, vals: { to: rf } }; drawLayer(); } return; }
    if (act === 'sort') { if (a.kind === 'tidy' && allowed('sort')) { M.act = { kind: 'sort', step: 'confirm' }; drawLayer(); } return; }
    if (act === 'lab-tick') { if (a.kind === 'labels') { var lid = attr(t, 'data-id'); if (a.sel[lid]) delete a.sel[lid]; else a.sel[lid] = 1; a.bad = false; drawLayer(); } return; }
    if (act === 'lab-all') { if (a.kind === 'labels') { var vis = labelRows(a), allOn = vis.every(function (i) { return a.sel[i.id]; }); vis.forEach(function (i) { if (allOn) delete a.sel[i.id]; else a.sel[i.id] = 1; }); a.bad = false; drawLayer(); } return; }
    if (act === 'lab-cat') { if (a.kind === 'labels') { a.cat = attr(t, 'data-k') || ''; drawLayer(); } return; }
    if (act === 'lab-has') { if (a.kind === 'labels') { a.withLabel = !a.withLabel; drawLayer(); } return; }
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
    if (act === 'scan-new') { if (allowed('create')) { M.act = { kind: 'create', step: 'form', code: a.code, format: a.format, mode: a.mode, vals: { name: '', category: catOK() ? CASSY : '', unit: 'pc', cons: 'no', qty: '', reorder: '' } }; drawLayer(); } return; }
    if (act === 'pick') { if (a.phase !== 'pick' || !allowed('link')) return; M.act = { kind: 'link', step: 'confirm', pickId: attr(t, 'data-id'), code: a.code, format: a.format, mode: a.mode, fromPick: true }; drawLayer(); return; }
    if (act === 'rep-kind') { a.vals.rkind = attr(t, 'data-k'); a.bad = false; drawLayer(); return; }
    if (act === 'rep-to') { a.vals.to = attr(t, 'data-to') === 'finance' && canPrice(M.role) && !K.noFinance ? 'finance' : 'ops'; a.bad = false; drawLayer(); return; }
    if (act === 'back') { if (/^(scan|link|create|report|undo|bought|unlink|history|photo|photoremove|optusual|cconfirm|labels|tidy|rename|sort|addlow|copytext)$/.test(a.kind)) return flowBack(a); if (a.kind === 'shopset') { a.kind = 'menu'; a.step = null; a.err = null; drawLayer(); } else if (a.fromShop && a.step !== 'confirm') { M.act = null; drawLayer(); } else if (a.step === 'confirm' && a.kind !== 'low') { a.step = 'form'; a.err = null; drawLayer(); } else if (a.shopId) { a.kind = 'menu'; a.err = null; drawLayer(); } else { a.kind = 'menu'; a.vals = null; a.step = null; a.err = null; a.bad = false; drawLayer(); } return; }
    if (act === 'step') { a.vals = a.vals || {}; var f = attr(t, 'data-f'); a.vals[f] = stepQty(a.vals[f], +attr(t, 'data-d'), attr(t, 'data-z') === '1'); a.err = null; drawLayer(); var nb = q('[data-act="step"][data-f="' + f + '"][data-d="' + attr(t, 'data-d') + '"]'); if (nb && nb.focus) nb.focus(); return; }
    if (act === 'shop-bought') { var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!r || !r.itemId || !allowed('recv', itemById(r.itemId))) return; M.act = { kind: 'recv', itemId: r.itemId, step: 'form', vals: { packs: fmt(r.qty || 1), supplier: K.sup ? K.sup.name : '', supplierId: K.sup && K.sup.id || '', cost: '', shopId: r.id }, fromShop: true }; drawLayer(); return; }
    if (act === 'shop-do') { var rr = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!rr) return; a.kind = 'shopset'; a.status = attr(t, 'data-do'); a.step = 'confirm'; a.rowName = rr.name; drawLayer(); return; }
  }
  function applyQuick(keep) {
    var p = K.quick; if (!p) return;
    if (nowMs() - p.at > 3000) { K.quick = null; return; }
    if (M && M.act && M.act.kind === 'menu' && M.act.itemId === p.id) { if (!keep) K.quick = null; begin(p.kind); }
  }
  function go(hash, sub, itemId) {
    M.sub = sub; M.act = itemId ? newMenu(itemId) : null;
    if (M.opts.navigate) M.opts.navigate(hash);
    if (M) { draw(); if (itemId) { loadLastCount(itemId); loadOptions(itemId); } }
  }
  function closeSheet() {
    if (!M || (M.act && M.act.sending)) return;
    if (M.act && M.act.kind === 'cconfirm') { cconfirmDone(M.act, false); return; }
    relPrev(M.act);
    stopCam(); K.scanned = null; K.quick = null;
    var id = M.act && M.act.itemId, wsaved = 0;
    if (M.act && M.act.kind === 'walk' && M.act.step !== 'summary') { wsaved = Object.keys(M.act.saved).length; if (wsaved) toast(wsaved + (wsaved === 1 ? ' item saved' : ' items saved') + '. The rest were not changed.'); }
    M.act = null;
    if (route().itemId) { M.sub = ''; if (M.opts.navigate) M.opts.navigate('#stock'); }
    if (M) { drawLayer(); if (id) { var b = q('[data-id="' + id + '"]'); if (b && b.focus) b.focus(); } if (wsaved) load(); }
  }
  function allowed(kind, it) {
    var m = M.role;
    if (kind === 'count') return I_FLAGS.count && canCount(m) && !M.denied.count;
    if (kind === 'used') return I_FLAGS.usage && canUse(m) && !M.denied.used;
    if (kind === 'recv') return canManage(m) && !M.denied.recv; // controlled items too since 1b: record_inventory_receipt_v1 writes their movement
    if (kind === 'bought') return canManage(m) && !M.denied.bought && K.shop && K.shop.length > 0;
    if (kind === 'addlow') return canManage(m) && !M.denied.shop && !!K.items && !!K.shop; // owner and admin only, like the other shopping row actions
    if (kind === 'shop') return !M.denied.shop;
    if (kind === 'low') return !M.denied.low && !M.denied.shop && !(it && (K.shop || []).some(function (r) { return r.itemId === it.id; }));
    if (kind === 'price') return K.v84 && canPrice(m) && !M.denied.price;
    if (kind === 'levels') return K.v84 && canManage(m) && !M.denied.levels;
    if (kind === 'link') return K.v84 && canManage(m) && !M.denied.link;
    if (kind === 'history') return K.v84 && !M.demo && !K.denied.inventory_item_history_v1;
    if (kind === 'unlink') return K.v84 && canManage(m) && !M.denied.unlink;
    if (kind === 'create') return K.v84 && canManage(m) && !M.denied.create;
    if (kind === 'report') return !M.denied.report;
    if (kind === 'optusual') return canManage(m) && !M.denied.optusual;
    if (kind === 'photo') return !M.denied.photo; // every role (D-330 answer 1); the server decides
    if (kind === 'labels') return canManage(m) && !M.denied.labels && !!K.items;
    if (kind === 'sort') return canManage(m) && !M.denied.sort && !M.denied.cat;
    if (kind === 'tidy') return canManage(m) && !!K.items && !(M.denied.rename && (M.denied.sort || M.denied.cat));
    return false;
  }
  function begin(kind) {
    if (!allowed(kind, itemById(M.act.itemId))) return;
    var a = M.act, it = itemById(a.itemId), defaults = { count: { qty: it && it.qty != null ? fmt(it.qty) : '0', note: '' }, used: { qty: '1' }, recv: { packs: '1', supplier: K.sup ? K.sup.name : '', supplierId: K.sup && K.sup.id || '', cost: '' }, shop: { qty: '1', note: '' },
      low: {}, price: { cost: it && it.cost != null ? fmt(it.cost) : '' }, levels: { reorder: it && it.reorder != null ? fmt(it.reorder) : '', par: it && it.par != null ? fmt(it.par) : '', location: it ? it.location : '', unit: it ? it.unit : '', category: it ? it.category : '' } };
    a.kind = kind; a.step = kind === 'low' ? 'confirm' : 'form'; a.vals = defaults[kind]; a.err = null; a.bad = false; a.key = null; a.sig = null; a.focused = false; drawLayer();
    if (kind === 'levels' && allowed('history')) fetchHistory(a.itemId, function (d) { if (M && M.act === a && a.kind === 'levels') { a.sugg = d ? suggestBuyUp(itemById(a.itemId), d) : null; drawLayer(); } });
  }
  function onInput(ev) {
    if (!M) return;
    var id = ev.target && ev.target.id; if (!id) return;
    if (id === 'I_q') { K.q = ev.target.value; drawList(); return; }
    if (id.indexOf('I_f_') === 0 && M.act && M.act.vals) {
      M.act.vals[id.slice(4)] = ev.target.value; M.act.err = null;
      if (id === 'I_f_supplier') M.act.vals.supplierId = '';
      if (id === 'I_f_find') { drawLayer(); refocus(id); } // the pick list follows what is typed
    }
  }
  function onKey(ev) {
    if (!M || ev.key !== 'Escape') return;
    var mo = M.el.querySelector ? M.el.querySelector('.I_menu[open]') : null;
    if (mo && !M.act) { mo.removeAttribute('open'); return; }
    if (M.act) closeSheet();
  }
  function valid(a) {
    var v = a.vals || {};
    if (a.kind === 'count') return parseQty(v.qty, true) != null;
    if (a.kind === 'used' || a.kind === 'shop') return parseQty(v.qty) != null;
    if (a.kind === 'recv') return parseQty(v.packs) != null && (String(v.cost || '').trim() === '' || parseQty(v.cost) != null);
    if (a.kind === 'price') return String(v.cost || '').trim() === '' || parseQty(v.cost) != null;
    if (a.kind === 'levels') return optQty(v.reorder) && optQty(v.par) && !(String(v.reorder || '').trim() !== '' && String(v.par || '').trim() !== '' && parseQty(v.par, true) < parseQty(v.reorder, true)) &&
      (!('location' in v) || String(v.location || '').trim().length <= 60) && (!('unit' in v) || (String(v.unit || '').trim() !== '' && String(v.unit).trim().length <= 20)) && (!('category' in v) || String(v.category || '').trim() !== '');
    if (a.kind === 'rename') { var to = String(v.to || '').trim(); return to.length >= 1 && to.length <= 60 && to !== a.from; }
    if (a.kind === 'labels') return labelIds(a).length > 0;
    if (a.kind === 'create') { var nm = String(v.name || '').trim(); return nm.length >= 2 && nm.length <= 80 && String(v.category || '').trim() !== '' && String(v.unit || '').trim().length <= 20 && optQty(v.qty) && optQty(v.reorder); }
    if (a.kind === 'report') return coolLeft(v) === 0;
    return true;
  }
  function onSubmit(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var a = M && M.act; if (!a || a.sending || a.kind === 'menu') return;
    if (a.kind === 'undo' && a.err === 'tooLate') return closeSheet();
    if (a.kind === 'cconfirm') return cconfirmDone(a, true);
    if (a.kind === 'tidy' || (a.kind === 'photo' && a.step !== 'confirm')) return;
    if (a.kind === 'walk') return walkSubmit(a);
    if (a.kind === 'bought') return boughtSubmit(a);
    if (a.kind === 'addlow') return addLowSubmit(a);
    if (a.kind === 'copytext') return closeSheet();
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
    if (a.kind === 'photo') return { exec: function () { return uploadAndSet(a); } };
    if (a.kind === 'photoremove') return photoSetCall(a.itemId, null);
    if (a.kind === 'optusual') return setUsualCall(a.optId);
    if (a.kind === 'rename') return recatCall(M.pid, (K.items || []).filter(function (i) { return i.category === a.from; }).map(function (i) { return i.id; }).concat(Object.keys(K.inactiveCat || {}).filter(function (id) { return K.inactiveCat[id] === a.from; })), mergeTarget(a.from, a.vals.to) || String(a.vals.to).trim());
    if (a.kind === 'labels') return { exec: function () { return labelsExec(a); } };
    if (a.kind === 'sort') return { invoke: 'inventory-categorise', body: { all: true } };
    var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0];
    return shopSetCall(M.pid, r, a.status, a.key);
  }
  var DONE = { count: function (it) { return 'Counted. ' + it.name + ' is saved.'; }, used: function () { return 'Logged. Thank you.'; }, recv: function (it) { return 'Stock received for ' + it.name + '.'; }, shop: function () { return 'Added to the shopping list.'; }, shopset: function (it, a) { return a.status === 'approved' ? 'Approved.' : 'Removed from the list.'; },
    undo: function () { return 'Undone.'; }, unlink: function () { return 'Unlinked.'; }, low: function () { return 'Passed on. Thank you.'; }, link: function (it) { return 'Linked. Scanning it now opens ' + it.name + '.'; }, price: function (it) { return 'Price saved for ' + it.name + '.'; }, levels: function (it, a) { return (detailsChanges(it, a.vals || {}) ? 'Details' : 'Levels') + ' saved for ' + it.name + '.'; },
    create: function (it, a) { return 'Added ' + String(a.vals.name).trim() + '.'; }, report: function (it, a) { return 'Sent to the ' + (a.vals.to === 'finance' ? 'Finance' : 'OPS') + ' group.'; },
    photo: function (it) { return 'Photo saved for ' + it.name + '.'; }, photoremove: function (it) { return 'Photo removed from ' + it.name + '.'; }, optusual: function (it) { return 'Usual option saved for ' + it.name + '.'; }, labels: function () { return 'Label sheet sent to the Finance group.'; },
    rename: function (it, a) { var n = (a.res && a.res.moved || []).length; return 'Moved ' + n + (n === 1 ? ' item' : ' items') + ' into ' + (mergeTarget(a.from, a.vals.to) || String(a.vals.to).trim()) + '.'; },
    sort: function (it, a) { var n = (a.res && a.res.results || []).length, more = a.res && a.res.remaining > 0 ? ' ' + a.res.remaining + ' more are waiting. Sort again in a moment.' : ''; return (n ? 'Cassy sorted ' + n + (n === 1 ? ' item.' : ' items.') : 'Nothing was moved. Anything Cassy was unsure about stays in Uncategorised.') + more; } };
  function bodyOf(e) { try { return e && e.context && typeof e.context.json === 'function' ? Promise.resolve(e.context.json()).catch(function () { return null; }) : null; } catch (x) { return null; } }
  var NEWK = { used: 1, unlink: 1, low: 1, link: 1, price: 1, levels: 1, create: 1, report: 1, undo: 1, photo: 1, photoremove: 1, optusual: 1, labels: 1, rename: 1, sort: 1 }; // actions that hide for the visit when the server says "not here"
  function commit(a) {
    var me = M, it = itemOf(a) || { name: a.rowName || (a.entry && a.entry.name) || '' }, call = build(a), rep = a.kind === 'report', snap = it && { qty: it.qty, cost: it.cost, reorder: it.reorder, par: it.par, controlled: it.controlled, location: it.location, unit: it.unit, category: it.category, photo: it.photo };
    if (me.demo) { toast(rep ? 'Demo only, nothing was sent.' : DEMO_NOTE); finish(); return; }
    if (!online()) { a.err = 'offline'; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    if (a.kind === 'sort') { if (K.catAt && nowMs() - K.catAt < 30000) { a.err = 'wait'; drawLayer(); return; } K.catAt = nowMs(); } // Cassy is asked at most once every 30 seconds
    if (!rep) K.at = 0; // any write makes the list stale, whichever mount sees the answer
    a.sending = true; a.err = null; a.takenId = null; drawLayer();
    var run = call.exec
      ? function () { return Promise.resolve(call.exec()).then(function (r0) { return r0 && (r0.data || r0.error) ? r0 : { data: { ok: true }, error: null }; }); }
      : call.invoke
      ? function () { return me.client.functions && me.client.functions.invoke ? me.client.functions.invoke(call.invoke, { body: call.body }) : Promise.reject({ status: 404 }); }
      : function () { return me.client.rpc(call.fn, call.args); };
    Promise.resolve().then(a.kind === 'undo' && (a.entry.next || a.entry.more) ? function () { return (a.entry.next ? [a.entry.next] : []).concat(a.entry.more || []).reduce(function (p, nx) { return p.then(function (r1) { if (r1 && r1.error) throw r1.error; if (r1 && r1.data && r1.data.ok === false) throw { message: 'failed', data: r1.data }; return me.client.rpc(nx.fn, nx.args); }); }, run()); } : run).then(function (r) {
      if (me.dead) return;
      if (r && r.error) throw r.error;
      if (r && r.data && (r.data.ok === false || r.data.error) && !(a.kind === 'undo' && r.data.reason === 'not_found')) throw { message: 'failed', data: r.data };
      a.sending = false; delete K.keys[a.sig]; a.res = r && r.data || {};
      if (rep) K.cool[a.vals.rkind + '|' + a.vals.to] = nowMs();
      if (a.kind === 'photo' || a.kind === 'photoremove') { var pit = itemById(a.itemId); if (pit) pit.photo = a.kind === 'photo' ? a.newPath || pit.photo : null; relPrev(a); }
      var od = r && r.data, oid = a.kind === 'undo' ? a.entry.itemId : a.itemId;
      if (od && Array.isArray(od.options) && oid) { K.opt[oid] = { list: normOpts(od.options), at: nowMs() }; K.usual = null; K.usualAt = 0; } // the usual option moved: the list redraws, and the Usual supplier map is read again
      if (a.kind === 'recv') rememberSupplier(a.vals);
      if (a.kind === 'create' && a.vals.category === CASSY && a.res.item_id) cassyOne(a.res.item_id);
      var msg = DONE[a.kind](it, a);
      var u0 = K.undos[0]; if (a.kind === 'undo') K.undos = K.undos.filter(function (u) { return u !== a.entry; }); else pushUndo(a, it, r && r.data || {}, snap);
      if (a.kind === 'undo' || K.undos[0] === u0 || (K.undos[0] && K.undos[0].call && K.denied[K.undos[0].call.fn])) toast(msg); // the Undo bar says the same, so no toast over it; no bar (Undo refused this visit) = toast
      if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (e) { /* no haptics */ } }
      finish(); if (!rep) load();
    }).catch(function (e) {
      if (me.dead) return;
      Promise.resolve(e && e.data ? e.data : bodyOf(e)).then(function (body) { if (!me.dead) fail(me, a, e, body, rep); });
    });
  }
  function fail(me, a, e, body, rep) {
    var why = body && (body.reason || body.error);
    a.sending = false;
    if (a.kind === 'sort') K.catAt = 0; // a sort that did not happen does not hold the next one
    if (a.mintedDone) { a.err = 'labelsend'; return drawLayer(); } // the codes exist; only the sheet is missing
    if (why === 'item_not_found') { a.err = 'other'; return drawLayer(); }
    if (why === 'code_taken') { a.err = 'taken'; a.takenId = body.item_id || null; a.takenName = body.item_name || (itemById(body.item_id) || {}).name || ''; return drawLayer(); }
    if (why === 'name_exists') { a.err = 'exists'; a.takenId = body.item_id || null; a.takenName = (itemById(body.item_id) || {}).name || ''; return drawLayer(); }
    if (why === 'bad_code') { a.err = 'badcode'; return drawLayer(); }
    if (a.kind === 'undo' && (why === 'too_late' || why === 'not_yours' || why === 'stock_moved')) { a.err = 'tooLate'; K.undos = K.undos.filter(function (u) { return u !== a.entry; }); return drawLayer(); }
    if (why === 'finance_only') { K.noFinance = true; a.vals.to = 'ops'; a.step = 'form'; a.err = 'financeOnly'; return drawLayer(); }
    a.err = errKind(e, online());
    var dk = a.kind === 'undo' ? a.entry.call.fn : a.kind === 'photoremove' ? 'photo' : a.kind;
    if (a.err === 'missing' && NEWK[a.kind]) { me.denied[dk] = true; if (a.kind === 'sort') me.denied.cat = true; if (a.itemId && !rep && a.kind !== 'create') { a.kind = 'menu'; a.vals = null; a.step = null; } else me.act = null; a.err = null; toast(ERR.missing); if (rep || !a.itemId) draw(); return drawLayer(); } // not here yet: hide it, no error box
    if (!rep && (a.err === 'offline' || a.err === 'other')) { me.loading = false; load(); } // the write may have landed: look again
    if (a.err === 'refused' && a.kind === 'count' && !canManage(me.role)) { me.denied.count = true; a.kind = 'menu'; a.vals = null; a.step = null; a.err = null; toast(ERR.missing); return drawLayer(); } // s85: the count release is not applied yet for staff: hide Count for the visit, no error box
    if (a.err === 'refused') { // the server decides: calm line, and the action goes away
      me.denied[dk] = true;
      if (a.kind === 'shopset') { a.kind = 'menu'; }
      else if (a.itemId && !rep && a.kind !== 'create') { a.kind = 'menu'; a.vals = null; a.step = null; }
      else { var m = ERR[a.err]; me.act = null; toast(m); }
      if (rep) draw();
    }
    drawLayer();
  }

  /* ---- s106 shopping tools: Add low items, Share as text, Save as image, PDF to Telegram */
  var SYSFONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var PNG_INK = '#14202E', PNG_INK2 = '#4A5563', PNG_LINE = '#E2DBD0', PNG_BG = '#FFFFFF'; // the light values of tokens.css (--v5-ink, --v5-ink-2, --v5-line, --v5-surf): a shared picture reads the same in either theme
  function nav() { return typeof navigator !== 'undefined' ? navigator : (root.navigator || null); }
  function longDate(iso) { var a = String(iso || '').slice(0, 10).split('-'); return a.length === 3 && +a[1] ? +a[2] + ' ' + MONTHS[+a[1] - 1] + ' ' + a[0] : ''; }
  function packOf(it, opt) { var s = opt ? num(opt.packSize) : null; return s != null && s > 0 ? s : (it.perPack || 1); }
  // PHP for one of the item's own purchase units (what a list quantity is counted in): the quoted pack price spread over the pack, else a unit price x units per purchase; null when nothing is priced. Only roles that already hold prices ever have an opt or a lastPrice/cost.
  function unitPrice(it, opt) {
    var per = it.perPack || 1, qd = opt ? num(opt.quoted) : null;
    if (qd != null && qd > 0) return qd * per / packOf(it, opt);
    var u = opt && num(opt.lastUnit) != null ? num(opt.lastUnit) : it.lastPrice != null ? it.lastPrice : it.cost != null ? it.cost : null;
    return u == null ? null : u * per;
  }
  function packLabel(opt) { return opt ? (opt.label || (num(opt.packSize) > 1 ? 'pack of ' + fmt(opt.packSize) : '')) : ''; }
  // Low and Out items that are not on the open list yet, each with the amount to buy back up to Buy-up-to: rounded up to whole Usual packs (else the item's own pack), then counted in the item's own purchase units, which is what save_shopping_item_v1 takes.
  // No Buy-up-to (or no count), or packs that are not a whole number of purchase units: the Running low rule, lowQty. Out first, then by name.
  function lowItems(items, shop, usual) {
    var on = {}; (shop || []).forEach(function (r) { if (r.itemId) on[r.itemId] = 1; });
    return (items || []).filter(function (i) { return level(i) !== 'ok' && !on[i.id]; }).sort(function (a, b) { return (level(a) === 'out' ? 0 : 1) - (level(b) === 'out' ? 0 : 1) || a.name.localeCompare(b.name); }).map(function (i) {
      var opt = usual && usual[i.id] || null, qty = lowQty(i);
      if (i.par != null && i.qty != null) {
        var per = i.perPack || 1, ps = packOf(i, opt), need = Math.round(Math.max(i.par - i.qty, 0) * 100) / 100, q = Math.round(Math.max(1, Math.ceil(need / ps)) * ps / per * 100) / 100;
        if (q % 1 === 0) qty = q;
      }
      return { itemId: i.id, name: i.name, qty: qty, unit: i.purchaseUnit || unitOf(i), pu: i.purchaseUnit || null, opt: opt, price: unitPrice(i, opt) };
    });
  }
  // The shopping list as text: title, one line per open row, a total for the roles that see prices. rows are normalizeShop rows.
  function shopLines(rows, o) {
    var money = canPrice(o.role), tot = 0, unk = false, list = [];
    (rows || []).forEach(function (r) {
      var it = (o.items || []).filter(function (i) { return i.id === r.itemId; })[0] || null, opt = it && o.usual && o.usual[it.id] || null, u = r.unit || (it && it.unit) || '', paren = '', p = null;
      if (money && it) {
        p = unitPrice(it, opt);
        var lb = packLabel(opt) || (opt && opt.supplier) || '', at = p != null ? 'PHP ' + pesoNum(p) + (u ? ' a ' + unitWord(1, u) : '') : '';
        paren = lb && at ? lb + ' @ ' + at : lb || at;
      }
      if (money) { if (r.qty != null && p != null) tot += r.qty * p; else unk = true; }
      list.push(r.name + (r.qty != null ? ' — ' + uq(r.qty, u).trim() : '') + (paren ? ' (' + paren + ')' : ''));
    });
    return { title: 'Cascade shopping list · ' + longDate(o.today), rows: list, total: money && list.length ? (unk ? 'Total: some prices unknown' : 'Total: PHP ' + pesoNum(Math.round(tot * 100) / 100)) : '' };
  }
  function shopText(rows, o) { var d = shopLines(rows, o); return [d.title, ''].concat(d.rows.map(function (s) { return '☐ ' + s; }), d.total ? ['', d.total] : []).join('\n'); }
  // A word wider than the line is cut into pieces that fit (a long title or product name never runs off the picture).
  function wrapText(measure, font, text, maxW) {
    var out = [], cur = '';
    function cut(w) { while (w.length > 1 && measure(font, w) > maxW) { var n = w.length - 1; while (n > 1 && measure(font, w.slice(0, n)) > maxW) n--; out.push(w.slice(0, n)); w = w.slice(n); } return w; }
    String(text).split(' ').forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (cur && measure(font, t) > maxW) { out.push(cur); t = w; }
      cur = measure(font, t) > maxW ? cut(t) : t;
    });
    if (cur) out.push(cur);
    return out;
  }
  // The picture: positions only, so it can be tested without a canvas. measure(font, text) gives a width in px.
  function shopLayout(measure, d, W) {
    var pad = 56, box = 32, gap = 20, f1 = '700 44px ' + SYSFONT, f2 = '600 34px ' + SYSFONT, f3 = '700 36px ' + SYSFONT, ops = [], y = pad + 44;
    wrapText(measure, f1, d.title, W - 2 * pad).forEach(function (l, n) { y = pad + 44 + n * 54; ops.push({ t: 'text', s: l, x: pad, y: y, font: f1, c: PNG_INK }); });
    y += 28; ops.push({ t: 'rule', x: pad, y: y, w: W - 2 * pad, c: PNG_LINE }); y += 36;
    d.rows.forEach(function (s) {
      var ls = wrapText(measure, f2, s, W - 2 * pad - box - gap);
      ops.push({ t: 'box', x: pad, y: y + 2, size: box, c: PNG_INK2 });
      ls.forEach(function (l, n) { ops.push({ t: 'text', s: l, x: pad + box + gap, y: y + 30 + n * 44, font: f2, c: PNG_INK }); });
      y += ls.length * 44 + 22;
    });
    if (d.total) { y += 6; ops.push({ t: 'rule', x: pad, y: y, w: W - 2 * pad, c: PNG_LINE }); y += 52; ops.push({ t: 'text', s: d.total, x: pad, y: y, font: f3, c: PNG_INK }); y += 12; }
    return { width: W, height: y + pad, ops: ops };
  }
  function shopImageBlob(d, cb) {
    var doc = root.document, c = doc && doc.createElement ? doc.createElement('canvas') : null, g = c && c.getContext ? c.getContext('2d') : null;
    if (!g) return cb(new Error('no canvas'));
    c.width = 1080; c.height = 64;
    var lay = shopLayout(function (font, s) { g.font = font; return g.measureText(s).width; }, d, 1080);
    c.width = lay.width; c.height = lay.height; // sizing the canvas clears it; everything is drawn after
    g.fillStyle = PNG_BG; g.fillRect(0, 0, lay.width, lay.height); g.textBaseline = 'alphabetic';
    lay.ops.forEach(function (o) {
      if (o.t === 'text') { g.font = o.font; g.fillStyle = o.c; g.fillText(o.s, o.x, o.y); }
      else if (o.t === 'rule') { g.fillStyle = o.c; g.fillRect(o.x, o.y, o.w, 2); }
      else { g.strokeStyle = o.c; g.lineWidth = 3; g.strokeRect(o.x, o.y, o.size, o.size); }
    });
    c.toBlob(function (b) { cb(b ? null : new Error('no picture'), b); }, 'image/png');
  }
  // A phone that can share files gets the share sheet; anything else gets a download. Resolves 'shared', 'cancelled', 'failed' (the share sheet itself broke: the caller shows the picture to press and hold) or 'downloaded'.
  function shopImageOut(blob, name) {
    var n = nav(), F = root.File, file = null, doc = root.document;
    try { file = F ? new F([blob], name, { type: 'image/png' }) : null; } catch (e) { file = null; }
    function download() {
      var U = root.URL, a = doc.createElement('a'), url = U.createObjectURL(blob);
      a.href = url; a.download = name; if (doc.body && doc.body.appendChild) doc.body.appendChild(a); a.click(); if (a.remove) a.remove();
      if (root.setTimeout) root.setTimeout(function () { U.revokeObjectURL(url); }, 4000); else U.revokeObjectURL(url);
      return 'downloaded';
    }
    if (file && n && typeof n.canShare === 'function' && typeof n.share === 'function' && n.canShare({ files: [file] })) {
      return Promise.resolve(n.share({ files: [file], title: 'Cascade shopping list' })).then(function () { return 'shared'; }, function (e) { return e && e.name === 'AbortError' ? 'cancelled' : 'failed'; });
    }
    return Promise.resolve(download());
  }
  function wantUsual() { return !!M && !M.demo && (canManage(M.role) || canPrice(M.role)); }
  function demoUsual() { return { d5: { itemId: 'd5', supplier: 'Demo Mart', label: 'pack of 4', packSize: 4, quoted: 230, lastUnit: null }, d1: { itemId: 'd1', supplier: 'Demo Mart', label: 'pack of 12', packSize: 12, quoted: 210, lastUnit: null } }; }
  // The Usual supplier options, read once and kept five minutes. Resolves {} when they cannot be read: the tools then go without pack details, never fail.
  function usualP() {
    if (M && M.demo) return Promise.resolve(demoUsual());
    if (K.usual && nowMs() - K.usualAt < 300000) return Promise.resolve(K.usual);
    if (K.usualP) return K.usualP;
    var me = M;
    if (!wantUsual() || !me.client || !supOK() || !root.I_Suppliers.usualMap || !online()) return Promise.resolve({});
    K.usualP = Promise.resolve().then(function () { return root.I_Suppliers.usualMap(supCtx()); }).then(function (m) { K.usual = m || {}; K.usualAt = nowMs(); K.usualP = null; return K.usual; }, function () { K.usualP = null; K.usual = {}; K.usualAt = nowMs() - 240000; return {}; }); // a failed read is retried after a minute, not on every redraw
    return K.usualP;
  }
  function addLowCount() { return allowed('addlow') ? lowItems(K.items, K.shop, M.demo ? demoUsual() : K.usual).length : 0; }
  function addLowButton(cls) { return addLowCount() ? '<button class="btn btn-secondary btn-block ' + cls + '" type="button" data-act="addlow-open">' + gi('plus', 's16') + ' Add low items to the shopping list</button>' : ''; }
  function shopCtx(usual) { return { role: M.role, items: K.items || [], usual: usual || K.usual || {}, today: manilaToday(nowMs()) }; }
  function shareText() {
    if (!K.shop || !K.shop.length) return;
    usualP().then(function (usual) {
      if (!M) return;
      var text = shopText(K.shop, shopCtx(usual)), n = nav();
      if (n && typeof n.share === 'function') return Promise.resolve(n.share({ text: text })).then(null, function (e) { if (!(e && e.name === 'AbortError')) return copyText(text); });
      return copyText(text);
    });
  }
  function copyText(text) {
    var n = nav();
    if (n && n.clipboard && typeof n.clipboard.writeText === 'function') return Promise.resolve(n.clipboard.writeText(text)).then(function () { toast('Copied'); }, function () { showCopy(text); });
    showCopy(text);
  }
  function showCopy(text) { if (!M) return; M.act = { kind: 'copytext', text: text }; drawLayer(); var t = q('#I_copy'); try { if (t && t.select) t.select(); } catch (e) { /* the person selects by hand */ } }
  function saveImage() {
    if (!K.shop || !K.shop.length) return;
    usualP().then(function (usual) {
      if (!M) return;
      var d = shopLines(K.shop, shopCtx(usual)), name = 'cascade-shopping-' + manilaToday(nowMs()) + '.png';
      shopImageBlob(d, function (err, blob) {
        if (err || !M) { if (M) toast('The picture could not be made. Try again.'); return; }
        shopImageOut(blob, name).then(function (how) {
          if (!M) return;
          if (how === 'downloaded') toast('Picture saved to your downloads.');
          else if (how === 'failed') { var iu = root.URL.createObjectURL(blob); M.act = { kind: 'copytext', img: iu, prev: iu }; drawLayer(); } // relPrev revokes it when the sheet closes
        }, function () { if (M) toast('The picture could not be saved. Try again.'); });
      });
    });
  }
  function addLowOpen() {
    if (!allowed('addlow') || (M.act && M.act.sending)) return;
    var a = M.act = { kind: 'addlow', step: 'load', lines: [], vals: {} };
    drawLayer();
    Promise.all([usualP(), loadShop()]).then(function (got) { // the list is read again first: a row added since the last read must not be added twice
      if (!M || M.act !== a) return;
      a.lines = lowItems(K.items, K.shop, got[0]).map(function (l) { l.on = true; l.key = addLowKey(l); return l; });
      a.step = 'pick'; drawLayer();
    });
  }
  // One key per item and amount, kept across sheet reopens, dropped on that line's success and forgotten after 10 minutes (as the other write keys).
  function addLowKey(l) { var k = 'addlow|' + l.itemId + '|' + l.qty, ke = K.keys[k]; if (!ke || nowMs() - ke.at > 600000) ke = K.keys[k] = { key: newKey('low'), at: nowMs() }; return ke.key; }
  function alLine(l, money) {
    var bits = [uq(l.qty, l.unit)];
    if (l.opt) bits.push([l.opt.supplier, packLabel(l.opt), l.opt.preferred === true ? 'Preferred' : ''].filter(Boolean).join(' · '));
    if (money && l.price != null) bits.push('PHP ' + pesoNum(l.price) + ' a ' + unitWord(1, l.unit || 'pack'));
    return bits.filter(Boolean).join(' · ');
  }
  function renderAddLow(a) {
    if (a.step === 'load') return head('Add low items to the shopping list?', 'Checking pack sizes…') + '<div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Cancel</button></div>';
    if (!a.lines.length) return head('Nothing to add', 'Every low item is already on the shopping list.') + '<div class="I_btns"><button class="btn btn-primary btn-block" type="button" data-act="close">Close</button></div>';
    var money = canPrice(M.role), n = a.lines.filter(function (l) { return l.on && !l.ok; }).length, bad = a.lines.filter(function (l) { return l.fail; }), added = a.lines.filter(function (l) { return l.ok; }).length;
    return head('Add low items to the shopping list?', 'Quantity is the Buy up to level less what is on hand, in whole packs.') + '<form data-i-form>' + a.lines.map(function (l) {
      return '<div class="I_brow"><button class="btn btn-secondary btn-block I_tick" type="button" data-act="al-tick" data-id="' + esc(l.itemId) + '" aria-pressed="' + (!!l.on || !!l.ok) + '"' + (l.ok || a.sending ? ' disabled' : '') + '>' + gi(l.on || l.ok ? 'check' : 'plus', 's16') + ' ' + esc(l.name) + (l.ok ? ' <span class="help">Added</span>' : '') + '</button>' +
        '<p class="help">' + esc(alLine(l, money)) + '</p></div>';
    }).join('') + (bad.length ? '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc(added + ' added. Not added: ' + bad.map(function (l) { return l.name; }).join(', ') + '. Try again to send only those.') + '</span></div>' : errBox(a)) +
      (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Tick at least one item.</span></div>' : '') + actions(a, bad.length ? 'Try again' : 'Add ' + n + (n === 1 ? ' item' : ' items'), 'Cancel') + '</form>';
  }
  function addLowSubmit(a) {
    if (a.sending || a.step === 'load' || !a.lines.length) return;
    var me = M, rows = a.lines.filter(function (l) { return l.on && !l.ok; });
    if (!rows.length) { a.bad = true; drawLayer(); return; }
    a.bad = false;
    if (me.demo) { toast(DEMO_NOTE); closeSheet(); return; }
    if (!online()) { a.err = 'offline'; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    K.at = 0; a.sending = true; a.err = null; drawLayer();
    var chain = Promise.resolve(), kinds = [];
    rows.forEach(function (l) {
      chain = chain.then(function () {
        var c = shopAddCall(me.pid, { id: l.itemId, name: l.name, purchaseUnit: l.pu }, { qty: fmt(l.qty), note: 'Running low (from the staff app)' }, l.key); // from the line itself: an item dropped from the catalogue since must not freeze the sheet
        return Promise.resolve(me.client.rpc(c.fn, c.args)).then(function (r) {
          if (r && r.error) throw r.error;
          if (r && r.data && (r.data.ok === false || r.data.error)) throw { message: 'failed', data: r.data };
          l.ok = r && r.data || {}; l.fail = false; delete K.keys['addlow|' + l.itemId + '|' + l.qty];
        }).then(null, function (e) { l.fail = true; kinds.push(errKind(e, online())); });
      });
    });
    chain.then(function () {
      if (me.dead) return;
      a.sending = false;
      var okRows = a.lines.filter(function (l) { return l.ok; }), left = a.lines.filter(function (l) { return !l.ok && l.on; });
      if (okRows.length) setBatchUndo(a, okRows);
      load(); // always: a write that landed (even on a failed call) shows in the list
      if (!left.length) { if (!a.undo) toast('Added ' + okRows.length + (okRows.length === 1 ? ' item' : ' items') + ' to the shopping list.'); if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (x) { /* no haptics */ } } closeSheet(); return; }
      if (!okRows.length && (kinds[0] === 'refused' || kinds[0] === 'missing')) { me.denied.shop = true; me.act = null; toast(ERR[kinds[0]]); drawLayer(); draw(); return; }
      if (!okRows.length) a.err = kinds[0] === 'offline' ? 'offline' : 'other';
      drawLayer();
    });
  }
  // One Undo for the whole batch: each created row is cancelled with the existing save_shopping_item_v1 shape, its own key.
  function setBatchUndo(a, okRows) {
    var ids = okRows.map(function (l) { return l.ok.id; }).filter(Boolean); if (!ids.length) return;
    if (a.undo) K.undos = K.undos.filter(function (u) { return u !== a.undo; });
    var calls = ids.map(function (id) { return { fn: 'save_shopping_item_v1', args: { p_property_id: M.pid, p_item: { id: id, status: 'cancelled' }, p_idempotency_key: newKey('undo') } }; }), n = ids.length;
    a.undo = { id: 'u' + (++K.uidn), itemId: null, name: '', at: nowMs(), kind: 'addlow', say: 'Added ' + n + (n === 1 ? ' item' : ' items') + ' to the shopping list', line: 'added items to the shopping list', confirm: 'Take the ' + n + (n === 1 ? ' item' : ' items') + ' you just added off the shopping list?', call: calls[0], more: calls.slice(1) };
    pushUndoEntry(a.undo);
  }
  function renderCopy(a) {
    if (a.img) return head('Save the picture', 'Press and hold the picture to save it.') + '<div class="field"><img src="' + esc(a.img) + '" alt="Shopping list picture" style="width:100%;height:auto"></div><div class="I_btns"><button class="btn btn-primary btn-block" type="button" data-act="close">Close</button></div>';
    return head('Copy the list', 'Press and hold the text, then choose Copy.') + '<div class="field"><label for="I_copy">Shopping list</label><div class="input"><textarea id="I_copy" rows="8" readonly>' + esc(a.text) + '</textarea></div></div><div class="I_btns"><button class="btn btn-primary btn-block" type="button" data-act="close">Close</button></div>';
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
  var CHANGE_WORD = { counted: 'Counted', received: 'Received', used: 'Used', adjusted: 'Adjusted', reconcile: 'Counted', receipt: 'Received', adjustment: 'Adjusted', usage: 'Used', undo: 'Undo', telegram_count: 'Telegram count' };
  function renderHistory(a, it) {
    var h = head(it.name + ': history', it.category);
    if (a.state === 'loading') return h + '<p class="help I_load" role="status">Loading…</p><div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Back</button></div>';
    if (a.state !== 'ok') return h + '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc(ERR.other) + '</span></div><div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-act="back">Back</button></div>';
    var d = a.data, u = d.usage || {}, pc = num(u.per_clean), body = '<h3 class="I_hh">Use per clean</h3>';
    if (!(u.cleans_30d >= 5) || !(pc > 0)) body += '<p class="help">Not enough cleans yet to tell.</p>';
    else {
      body += '<p class="I_conf">About ' + esc(uq(pc, unitOf(it))) + ' per clean, over ' + esc(String(u.cleans_30d)) + ' cleans in the last 30 days.</p>';
      if (it.qty > 0) body += '<p class="help">About ' + esc(String(Math.max(1, Math.round(it.qty / (pc * u.cleans_30d / 30))))) + ' days left at the current booking pace (an estimate).</p>';
    }
    body += '<h3 class="I_hh">Last changes</h3>';
    var ch = Array.isArray(d.changes) ? d.changes.slice(0, 10) : [];
    body += ch.length ? '<ul class="I_blines">' + ch.map(function (c) { var w = CHANGE_WORD[c.kind] || String(c.kind || 'Change').replace(/^./, function (x) { return x.toUpperCase(); }); return '<li>' + esc(dateLabel(c.at)) + ' · ' + esc(w) + ' ' + esc(c.before == null ? '' : fmt(c.before)) + ' → ' + esc(c.after == null ? '' : fmt(c.after)) + (c.who ? ' · ' + esc(String(c.who).split(' ')[0]) : '') + '</li>'; }).join('') + '</ul>' : '<p class="help">No changes recorded yet.</p>';
    var lb = d.last_bought;
    body += '<h3 class="I_hh">Last bought</h3>' + (lb && lb.at ? '<p class="I_conf">' + esc(dateLabel(lb.at)) + (lb.qty != null ? ', ' + esc(uq(lb.qty, unitOf(it))) : '') + (canPrice(M.role) && lb.unit_cost != null ? ', PHP ' + esc(pesoNum(lb.unit_cost)) + ' each' : '') + '</p>' : '<p class="help">No purchase recorded yet.</p>');
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
    if (me.demo) { a.saved[it.id] = { before: it.qty, after: n }; toast(DEMO_NOTE); walkNext(a, 'Saved'); return; }
    if (!online()) { a.err = 'offline'; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    var kk = it.id + '|' + n; a.keys[kk] = a.keys[kk] || newKey('count'); // one key per item and value: a changed value after an unseen landed write is a new count
    var c = countCall(it, { qty: a.vals.qty, note: 'Group count in the staff app' }, a.keys[kk]);
    a.sending = true; a.err = null; drawLayer();
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (me.dead) return;
      if (r && r.error) throw r.error;
      if (r && r.data && r.data.ok === false) throw { message: 'failed' };
      a.sending = false; delete a.keys[kk]; K.at = 0;
      var e = undoFor({ kind: 'count', vals: a.vals }, it, r && r.data || {}, { qty: it.qty, controlled: it.controlled }); if (e) pushUndoEntry(e);
      a.saved[it.id] = { before: it.qty, after: n, undo: e };
      walkNext(a, 'Saved');
    }).catch(function (e) {
      if (me.dead) return;
      a.sending = false; a.err = errKind(e, online());
      if (a.err === 'refused') { K.denied.count = true; var m = canManage(me.role) ? ERR.refused : ERR.missing; me.act = null; toast(m); draw(); return; }
      if (a.err === 'offline' || a.err === 'other') { me.loading = false; load(); } // the count may have landed: look again
      drawLayer();
    });
  }
  function renderWalk(a) {
    if (a.step === 'summary') {
      var ids = Object.keys(a.saved), same = Object.keys(a.same).length, big = ids.filter(function (id) { var s = a.saved[id]; return s.before > 0 && Math.abs(s.after - s.before) > s.before / 2; });
      return head(ids.length ? 'Counting done' : 'Nothing was changed', a.cat) + '<p class="I_conf">' + ids.length + ' counted, ' + same + ' the same' + (big.length ? ', ' + big.length + ' changed by more than half' : '') + '.</p>' +
        (a.i < a.ids.length ? '<p class="help">The rest were not changed.</p>' : '') +
        (big.length ? '<dl class="I_dl">' + big.map(function (id) { var s = a.saved[id], it = itemById(id); return row('' + gi('alert', 's16') + ' ' + esc(it ? it.name : ''), esc(fmt(s.before) + ' → ' + fmt(s.after)) + (s.undo && !K.denied[s.undo.call.fn] ? ' <button class="btn btn-ghost I_undobtn" type="button" data-act="undo" data-id="' + s.undo.id + '">' + gi('refresh', 's16') + ' Undo</button>' : '')); }).join('') + '</dl>' : '') +
        '<div class="I_btns"><button class="btn btn-primary btn-block" type="button" data-act="close">Close</button></div>';
    }
    var it = walkIt(a); if (!it) return null;
    var last = a.i === a.ids.length - 1;
    return head('Item ' + (a.i + 1) + ' of ' + a.ids.length, a.cat) + '<p class="I_wname">' + esc(it.name) + '</p>' + (it.location ? '<p class="help I_kept">Kept in ' + esc(it.location) + '</p>' : '') + '<p class="help">' + esc(it.unit) + ' · ' + (it.counted ? 'Last counted ' + esc(dateLabel(it.counted)) : 'Not counted in the app yet') + '</p>' +
      '<form data-i-form>' + stepper('qty', 'Counted (' + esc(unitOf(it)) + ')', a.vals.qty, true) + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter a number such as 12 or 2.5.</span></div>' : '') +
      (a.flash ? '<div class="okbox" role="status">' + gi('check') + '<span>' + esc(a.flash) + '</span></div>' : '') + (it.controlled ? '' : '<p class="help">The first count here moves this item to counting in the app.</p>') + errBox(a) +
      '<div class="I_btns"><button class="btn btn-primary btn-block" type="submit"' + (a.sending ? ' disabled' : '') + '>' + (a.sending ? 'Saving…' : last ? 'Finish' : 'Next') + '</button>' +
      '<button class="btn btn-secondary btn-block" type="button" data-act="w-same"' + (a.sending ? ' disabled' : '') + '>Same as before</button><button class="btn btn-ghost btn-block" type="button" data-act="w-stop"' + (a.sending ? ' disabled' : '') + '>Stop here</button></div></form>';
  }

  /* ---- Bought some of these (s84 1b, Q5): tick, check once, then one receipt per line, one at a time */
  function shopRowBy(id) { return (K.shop || []).filter(function (x) { return x.id === id; })[0] || null; }
  function boughtRows() { return (K.shop || []).filter(function (r) { return r.itemId && itemById(r.itemId); }); }
  function boughtPicked(a) { if (a.step !== 'pick' && a.rows) return a.rows; return boughtRows().filter(function (r) { return a.sel[r.id]; }); }
  function boughtValid(a) {
    var rows = boughtPicked(a); if (!rows.length) return false;
    return rows.every(function (r) { return parseQty(a.vals['packs_' + r.id]) != null && (!canPrice(M.role) || String(a.vals['cost_' + r.id] || '').trim() === '' || parseQty(a.vals['cost_' + r.id]) != null); });
  }
  function boughtLine(r, a) {
    var it = itemById(r.itemId), pk = parseQty(a.vals['packs_' + r.id]), add = Math.round(pk * it.perPack * 100) / 100, pu = it.purchaseUnit || it.unit || 'pack';
    return '<li><strong>' + esc(it.name) + '</strong>: ' + esc(uq(pk, pu) + (it.perPack !== 1 ? ' = ' + uq(add, unitOf(it)) : '')) + (a.step === 'done' || a.step === 'undoconfirm' ? '' : ', on hand ' + esc(it.qty == null ? 'not counted' : fmt(it.qty)) + ' → ' + esc(fmt((it.qty || 0) + add))) + (r.status === 'proposed' ? ' <span class="help">(approved first)</span>' : '') + '</li>';
  }
  function renderBought(a) {
    var rows = boughtRows(), picked = boughtPicked(a), nDone = picked.filter(function (r) { return a.done[r.id] && a.done[r.id].received; }).length;
    if (a.step === 'done') return head(nDone + (nDone === 1 ? ' item added' : ' items added'), 'Stock is up to date.') + '<ul class="I_blines">' + picked.map(function (r) { return boughtLine(r, a); }).join('') + '</ul>' + errBox(a) +
      '<div class="I_btns">' + (picked.some(function (r) { return a.done[r.id] && a.done[r.id].undo && !K.denied.inventory_undo_v1; }) ? '<button class="btn btn-secondary btn-block" type="button" data-act="b-undoall">' + gi('refresh', 's16') + ' Undo all</button>' : '') + '<button class="btn btn-primary btn-block" type="button" data-act="close">Close</button></div>';
    if (a.step === 'undoconfirm') return head('Undo all ' + nDone + ' receipts?', 'Each one is taken back out, newest first.') + '<form data-i-form>' + actions(a, 'Yes, undo them all') + '</form>';
    if (a.step === 'confirm') {
      var failed = a.failId && shopRowBy(a.failId), left = picked.length - nDone;
      return head('Add these to the stock?') + '<form data-i-form>' + supplierField(a) + '<ul class="I_blines">' + picked.map(function (r) { return boughtLine(r, a); }).join('') + '</ul>' +
        (a.err && failed ? '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc(nDone + ' of ' + picked.length + ' added. ' + failed.name + ' did not go through. ' + (a.err === 'offline' ? ERR.offline : a.err === 'recon' || a.err === 'short' ? ERR[a.err] : 'Try again.')) + '</span></div>' : errBox(a)) +
        actions(a, a.err && nDone ? 'Try again' : 'Yes, add them') + '</form>';
    }
    return head('Bought some of these', 'Tick what you bought.') + '<form data-i-form>' + errBoxIf(a, a.err === 'already') + (rows.length ? '' : '<p class="help">Nothing on the list can be added yet.</p>') + rows.map(function (r) {
      var on = !!a.sel[r.id], it = itemById(r.itemId), pu = it.purchaseUnit || it.unit || 'pack';
      return '<div class="I_brow"><button class="btn btn-secondary btn-block I_tick" type="button" data-act="b-tick" data-id="' + esc(r.id) + '" aria-pressed="' + on + '">' + gi(on ? 'check' : 'plus', 's16') + ' ' + esc(r.name) + (r.status === 'proposed' ? ' <span class="help">Waiting for approval</span>' : '') + '</button>' +
        (on ? stepper('packs_' + r.id, 'How many (' + esc(pu) + ')', a.vals['packs_' + r.id], false) + (canPrice(M.role) ? textField('cost_' + r.id, 'Price per ' + esc(pu) + ' in PHP (optional)', a.vals['cost_' + r.id] || '', 'inputmode="decimal"') : '') : '') + '</div>';
    }).join('') + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Tick at least one, and enter numbers such as 2 or 150.50.</span></div>' : '') + actions(a, 'Check them', 'Cancel') + '</form>';
  }
  function boughtSubmit(a) {
    if (a.sending) return;
    if (a.step === 'pick') { if (a.err === 'already') a.err = null; if (!boughtValid(a)) { a.bad = true; drawLayer(); return; } a.bad = false; a.rows = boughtPicked(a); if (a.vals.supplier === undefined && K.sup) { a.vals.supplier = K.sup.name; a.vals.supplierId = K.sup.id || ''; } a.rows.forEach(function (r) { a.keys[r.id] = a.keys[r.id] || newKey('recv'); a.keys[r.id + 'a'] = a.keys[r.id + 'a'] || newKey('appr'); }); a.step = 'confirm'; a.err = null; drawLayer(); return; }
    if (a.step === 'done') return closeSheet();
    var me = M, rows = boughtPicked(a);
    if (me.demo) { toast(DEMO_NOTE); closeSheet(); return; }
    if (!online()) { a.err = 'offline'; a.failId = null; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    K.at = 0; a.sending = true; a.err = null; a.failId = null; drawLayer();
    var chk = function (r) { if (r && r.error) throw r.error; if (r && r.data && (r.data.ok === false || r.data.error)) throw { message: 'failed', data: r.data }; return r; };
    var chain = Promise.resolve();
    if (a.step === 'undoconfirm') {
      var es = rows.map(function (r) { return a.done[r.id] && a.done[r.id].undo; }).filter(function (e) { return e && !e.undone; }).reverse(), n = 0; // an entry already undone is not asked again
      es.forEach(function (e) { chain = chain.then(function () { a.cur = e; return me.client.rpc(e.call.fn, e.call.args); })
.then(function (r) { return r && r.data && r.data.reason === 'not_found' ? r : chk(r); }).then(function () { n++; e.undone = true; K.undos = K.undos.filter(function (u) { return u !== e; }); }); });
      if (a.supCreated) chain = chain.then(function () { return Promise.resolve(me.client.rpc('inventory_supplier_save_v1', { p_property_id: me.pid, p_supplier: { id: a.supCreated, active: false } })).then(null, function () { /* the supplier stays; nothing else depends on it */ }); }); // a supplier made for this trip stops being offered
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
          var c = receiptCall(it, { packs: a.vals['packs_' + r.id], cost: canPrice(me.role) ? a.vals['cost_' + r.id] : '', supplier: a.vals.supplier || '', supplierId: a.vals.supplierId || '', shopId: r.id }, a.keys[r.id], manilaToday(nowMs()));
          return me.client.rpc(c.fn, c.args);
        }).then(chk).then(function (res) {
          var dd = res.data || {}; d.received = dd;
          if (dd.movementId || dd.purchaseId) { var e = { id: 'u' + (++K.uidn), itemId: it.id, name: it.name, at: nowMs(), kind: 'recv', say: 'Received ' + it.name, line: 'received stock', confirm: 'Take the stock you just added to ' + it.name + ' back out?', call: { fn: 'inventory_undo_v1', args: { p_movement_id: dd.movementId || null, p_purchase_id: dd.purchaseId || null } } }; d.undo = e; pushUndoEntry(e); }
        });
      });
    });
    chain.then(function () { if (me.dead) return; rememberSupplier(a.vals); a.sending = false; a.step = 'done'; a.err = null; toast('Stock added.'); if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (x) { /* no haptics */ } } load(); drawLayer(); }).catch(function (e) {
      if (me.dead) return; a.sending = false; a.failId = a.cur;
      Promise.resolve(e && e.data ? e.data : bodyOf(e)).then(function (body) {
        if (me.dead) return;
        if (body && (body.reason === 'already_received' || body.reason === 'not_open')) { a.err = 'already'; a.step = 'pick'; a.rows = null; a.failId = null; loadShop(); drawLayer(); return; }
        a.err = errKind(e, online());
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
      e.confirm = 'Put ' + n + ' back to ' + (snap && snap.qty != null ? fmt(snap.qty) : 'its old amount') + '?' + (snap && snap.controlled === false ? ' It stays counted in the app.' : ''); e.call = { fn: 'inventory_undo_v1', args: { p_movement_id: d.movementId, p_purchase_id: null } };
    } else if (a.kind === 'used' && usedMovement(d)) {
      var un = parseQty(v.qty); e.say = 'Logged ' + uq(un, unitOf(it)) + ' of ' + n + ' as used'; e.line = 'logged ' + fmt(un) + ' as used'; e.confirm = 'Put the ' + uq(un, unitOf(it)) + ' of ' + n + ' back?';
      e.call = { fn: 'inventory_undo_v1', args: { p_movement_id: usedMovement(d), p_purchase_id: null } };
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
      if (a.code) { e.confirm = 'Remove ' + cnm + ' and free code ' + shortCode(a.code) + '?'; e.next = e.call; e.call = { fn: 'inventory_code_detach_v1', args: { p_property_id: M.pid, p_code: a.code } }; } // the code goes first, so it is free to use again
    } else if ((a.kind === 'shop' || a.kind === 'low') && d.id) {
      e.say = a.kind === 'low' ? n + ' flagged as running low' : 'Added ' + n + ' to the shopping list'; e.line = a.kind === 'low' ? 'said it is running low' : 'added it to the shopping list'; e.confirm = 'Take ' + n + ' off the shopping list?';
      e.call = { fn: 'save_shopping_item_v1', args: { p_property_id: M.pid, p_item: { id: d.id, status: 'cancelled' }, p_idempotency_key: newKey('undo') } };
    } else if (a.kind === 'levels' && snap) {
      var up = { reorder_below: snap.reorder == null ? null : snap.reorder, par_qty: snap.par == null ? null : snap.par }, was = levelsCall(it, v).args.p_patch, more = false;
      if ('location' in was) { up.location = snap.location || ''; more = true; } if ('unit' in was) { up.unit = snap.unit; more = true; } if ('category' in was) { up.category = snap.category; more = true; }
      e.say = (more ? 'Details saved for ' : 'Levels saved for ') + n; e.line = more ? 'changed the details' : 'changed the levels'; e.confirm = 'Put the ' + (more ? 'details' : 'levels') + ' of ' + n + ' back as they were?';
      e.call = { fn: 'inventory_item_update_v1', args: { p_item_id: it.id, p_patch: up } };
    } else if (a.kind === 'photo' || a.kind === 'photoremove') {
      var pb = 'before' in d ? (d.before == null ? null : String(d.before)) : snap && snap.photo != null ? snap.photo : null;
      if (a.kind === 'photoremove' && pb == null) return null;
      e.say = a.kind === 'photo' ? 'Photo saved for ' + n : 'Photo removed from ' + n; e.line = a.kind === 'photo' ? 'changed the photo' : 'removed the photo';
      e.confirm = pb == null ? 'Remove the new photo of ' + n + ' again?' : 'Put the old photo of ' + n + ' back?'; e.call = photoSetCall(it.id, pb);
    } else if (a.kind === 'optusual') {
      if (!a.prev) return null; // nothing was usual before: there is no call that clears it
      e.say = 'Usual option saved for ' + n; e.line = 'changed the usual option'; e.confirm = 'Make ' + a.prev.title + ' usual again?'; e.call = setUsualCall(a.prev.id);
    } else if (a.kind === 'rename' && d.moved && d.moved.length) {
      var gr = groupBefore(d.moved); e.itemId = null; e.name = ''; e.say = 'Moved ' + d.moved.length + (d.moved.length === 1 ? ' item' : ' items') + ' into ' + (mergeTarget(a.from, v.to) || String(v.to).trim()); e.line = 'moved items';
      e.confirm = 'Put the ' + d.moved.length + (d.moved.length === 1 ? ' item' : ' items') + ' back in ' + (gr.length === 1 ? gr[0].before : 'their old categories') + '?';
      e.call = recatCall(M.pid, gr[0].ids, gr[0].before); e.more = gr.slice(1).map(function (g) { return recatCall(M.pid, g.ids, g.before); });
    } else if (a.kind === 'sort' && d.results && d.results.length) {
      return catUndo(d.results, d.remaining);
    } else return null;
    return e;
  }
  function usedMovement(d) { var m = d.movementId || (d.movementIds && d.movementIds[0]) || (d.movements && d.movements[0] && (typeof d.movements[0] === 'string' ? d.movements[0] : d.movements[0].movementId || d.movements[0].id)); return m || null; } // record_inventory_usage writes through the ledger; no id in the answer = no Undo
  function pushUndo(a, it, d, snap) {
    var e = undoFor(a, it, d, snap); if (!e) return;
    K.undos.unshift(e); if (K.undos.length > 20) K.undos.length = 20;
    drawUndo();
  }
  function pushUndoEntry(e) { K.undos.unshift(e); if (K.undos.length > 20) K.undos.length = 20; }
  function ago(ms) { var m = Math.floor(ms / 60000); return m < 1 ? 'just now' : m + ' min ago'; }
  function lastChange(it) {
    var e = K.undos.filter(function (u) { return u.itemId === it.id && nowMs() - u.at < UNDO_LINE_MS && !K.denied[u.call.fn]; })[0];
    return e ? '<p class="help I_last">Last change: ' + esc(e.line) + ' by you, ' + ago(nowMs() - e.at) + '. <button class="btn btn-ghost I_undobtn" type="button" data-act="undo" data-id="' + e.id + '">' + gi('refresh', 's16') + ' Undo</button></p>' : '';
  }
  function drawUndo() {
    var box = q('[data-i-undo]'); if (!box) return;
    var e = K.undos.filter(function (u) { return !K.denied[u.call.fn] && (nowMs() - u.at < UNDO_BAR_MS || (M.undoHold === u.id)); })[0];
    if (!e || M.act) { box.innerHTML = ''; return; } // a sheet is open: the card shows the Last change line instead
    box.innerHTML = '<div class="I_undo" role="status"><span class="I_undot">' + esc(e.say) + '</span><button class="btn btn-secondary I_undob" type="button" data-act="undo" data-id="' + e.id + '">' + gi('refresh', 's16') + ' Undo</button></div>';
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
    if (a.kind === 'addlow' || a.kind === 'copytext') return closeSheet();
    if (a.kind === 'cconfirm') { cconfirmDone(a, false); return; }
    if (a.kind === 'photo' || a.kind === 'photoremove') { relPrev(a); M.act = newMenu(a.itemId); drawLayer(); return; }
    if (a.kind === 'labels') { if (a.step === 'confirm') { a.step = 'form'; a.err = null; drawLayer(); return; } return closeSheet(); }
    if (a.kind === 'rename') { if (a.step === 'confirm') { a.step = 'form'; a.err = null; drawLayer(); return; } M.act = { kind: 'tidy' }; drawLayer(); return; }
    if (a.kind === 'sort') { M.act = { kind: 'tidy' }; drawLayer(); return; }
    if (a.kind === 'tidy') return closeSheet();
    if (a.kind === 'unlink' || a.kind === 'history' || a.kind === 'optusual') { M.act = newMenu(a.itemId); drawLayer(); return; }
    if (a.kind === 'bought') { if (a.step === 'confirm') { a.step = 'pick'; a.rows = null; a.err = null; drawLayer(); return; } if (a.step === 'undoconfirm') { a.step = 'done'; a.err = null; drawLayer(); return; } return closeSheet(); }
    if (a.kind === 'undo') { M.act = route().itemId ? newMenu(route().itemId) : null; drawLayer(); return; }
    if (a.kind === 'report') { if (a.step === 'confirm') { a.step = 'form'; a.err = null; drawLayer(); return; } return closeSheet(); }
    if (a.kind === 'create') { if (a.step === 'confirm') { a.step = 'form'; a.err = null; a.takenId = null; drawLayer(); return; } a.kind = 'scan'; a.phase = 'unknown'; a.err = null; a.sg = null; drawLayer(); return; }
    if (a.kind === 'link') { a.kind = 'scan'; a.err = null; a.takenId = null; if (a.fromPick) { a.phase = 'pick'; a.vals = { find: '' }; drawLayer(); return; } return enterLook(a); }
    if (a.phase === 'pick') { a.phase = 'unknown'; drawLayer(); return; }
    if (a.phase === 'unknown') return enterLook(a);
    return closeSheet();
  }
  function toast(msg) { say(msg); if (M && M.opts.toast) M.opts.toast(msg); }
  function finish() { if (!M) return; if (M.act && M.act.kind === 'optusual') { M.act = newMenu(M.act.itemId); drawLayer(); drawUndo(); return; } var fromShop = M.act && (M.act.shopId || M.act.fromShop); if (fromShop) { M.act = null; drawLayer(); draw(); } else closeSheet(); }

  root.I_Stock = { mount: mount, unmount: unmount, lib: {
    esc: esc, canPrice: canPrice, groupsFor: groupsFor, codeIndex: codeIndex, I_codeIndex: codeIndex, normCode: normCode, validCode: validCode, attachCall: attachCall, priceCall: priceCall, levelsCall: levelsCall, createCall: createCall, reportCall: reportCall, REPORTS: REPORTS, normalize: normalize, normalizeCatalogue: normalizeCatalogue, level: level, summary: summary, chipsFor: chipsFor, visible: visible, barPct: barPct, parseQty: parseQty, stepQty: stepQty,
    newKey: newKey, errKind: errKind, ERR: ERR, countCall: countCall, usageCall: usageCall, receiptCall: receiptCall, shopAddCall: shopAddCall, shopSetCall: shopSetCall, normalizeShop: normalizeShop,
    fitSize: fitSize, phpText: phpText, photoSetCall: photoSetCall, recatCall: recatCall, mintCall: mintCall, labelsCall: labelsCall,
    manilaToday: manilaToday, demoItems: demoItems, PROPERTY_ID: PROPERTY_ID, canManage: canManage, canUse: canUse,
    normOpts: normOpts, setUsualCall: setUsualCall, optSort: optSort, chipsFor: chipsFor,
    lowItems: lowItems, shopLines: shopLines, shopText: shopText, shopLayout: shopLayout, unitPrice: unitPrice, wrapText: wrapText, longDate: longDate
  } };
})(typeof window !== 'undefined' ? window : this);
