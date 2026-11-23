/* Cascade Staff - native Inventory screen (lane I, session 82). Plain script, no build step.
   Mounted by the shell as window.I_Stock.mount(el, { client, demo, role, sub, navigate, toast, haptic, propertyId? }).
   Money rule: a cleaner never sees or keeps a cost. normalize() never reads unitCost for any role but owner/admin/finance.
   Every write: a confirm step, one idempotency key per confirmed set of values (kept across a retry), a disabled button while
   sending, a toast, a refreshed list. Offline is an inline line, never a queue. */
(function (root) {
  'use strict';

  var PROPERTY_ID = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'; // same constant as the shell's CFG.propertyId; opts.propertyId wins
  var DEMO_NOTE = 'Demo only, nothing was saved.';
  var LEARNS = 'This count keeps usage learning. Telegram /count still works for this item.';
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
  function canCount(role) { return role === 'owner' || role === 'admin' || role === 'cleaner' || role === 'laundry'; } // s85: the cleaner counts too; s132: laundry recounts; the server decides (42501 hides Count for the visit)
  function canEdit(role) { return canManage(role) || role === 'cleaner'; } // s124: the cleaner edits details and sets a new price blind; the server decides
  function canUse(role) { return canUpdate(role); } // s132: every Update role sees Used up; record_inventory_usage accepts submit_cleaning or report_supply (s110), so a refused Update save toasts the plain refusal and keeps the form with the typed values (Revision 1)
  function canUpdate(role) { return role === 'owner' || role === 'admin' || role === 'cleaner' || role === 'laundry'; } // s132: the one Update button; finance, inspector and maintenance do not get it
  function manilaToday(ms) { return new Date(ms + 8 * 3600000).toISOString().slice(0, 10); }
  function dateLabel(iso) { var a = String(iso || '').slice(0, 10).split('-'); return a.length === 3 && +a[1] ? MONTHS[+a[1] - 1] + ' ' + +a[2] : ''; }
  function manilaLabel(iso) { var t = Date.parse(iso); return dateLabel(isNaN(t) ? iso : manilaToday(t)); } // s124: a timestamp shows on its Manila day (17:30 UTC is already tomorrow there)
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
      updatedAt: raw.updatedAt ? String(raw.updatedAt) : null, updatedBy: raw.updatedBy ? String(raw.updatedBy).split(' ')[0] : null, updatedKind: raw.updatedKind ? String(raw.updatedKind) : null, // s124: who last changed the item (first name), from the latest change row
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
  var UNCAT = 'Uncategorised', CASSY = '__cassy', NEWCAT = '__new', PHOTO_MAX = 1048576, NEW_UNDO_MS = 1800000; // s125: a new item can be taken back for 30 minutes
  function normalizeCatalogue(data, role) {
    var list = data && data.items;
    if (!Array.isArray(list)) return null;
    return list.map(function (r) { return normalize(r, role); }).filter(function (i) { return i.active && i.name; });
  }
  function level(it) { if (it.qty != null && it.qty <= 0) return 'out'; if (it.reorder != null && it.qty != null && it.qty <= it.reorder) return 'low'; return 'ok'; }
  var LEVELS = { out: { word: 'Out', glyph: 'xcircle' }, low: { word: 'Low', glyph: 'alert' }, ok: { word: 'OK', glyph: 'check' } };
  var RANK = { out: 0, low: 1, ok: 2 };
  function byName(a, b) { return a.name.localeCompare(b.name); }
  // s132 (Lloyd 2026-11-23): groups run in update order. Groups that are mostly consumables come first, then the
  // groups that change most often; the slowest movers sit last so nobody scrolls past them to update.
  // A group not in the list goes after the listed ones of its kind, by name.
  var TURN_ORDER = ['toiletries', 'cleaning supplies', 'kitchen supplies', 'pantry', 'linen', 'kitchen utensils', 'bathroom & utility', 'bedroom / sleeping area', 'appliances', 'living area'];
  function groupOrder(items) {
    var by = {};
    (items || []).forEach(function (i) { var g = by[i.category] || (by[i.category] = { n: 0, c: 0 }); g.n++; if (i.consumable) g.c++; });
    var rank = function (cat) { var t = TURN_ORDER.indexOf(String(cat || '').trim().toLowerCase()); return t < 0 ? TURN_ORDER.length : t; };
    var tier = function (cat) { var g = by[cat]; return g && g.c * 2 >= g.n && g.c > 0 ? 0 : 1; };
    return function (a, b) { return tier(a) - tier(b) || rank(a) - rank(b) || String(a).localeCompare(String(b)); };
  }
  function summary(items) { var low = 0, out = 0; items.forEach(function (i) { var l = level(i); if (l === 'out') out++; else if (l === 'low') low++; }); return { low: low + out, out: out }; }
  // s107 B9: Low, To count (only when something needs counting), All, Consumables, then the categories; each carries its count.
  function chipsFor(items, needN) {
    var cats = {}, list = [{ k: 'low', t: 'Low', n: summary(items).low }];
    if (needN) list.push({ k: 'need', t: 'To count', n: needN });
    list.push({ k: 'all', t: 'All', n: items.length }, { k: 'cons', t: 'Consumables', n: items.filter(function (i) { return i.consumable; }).length });
    items.forEach(function (i) { cats[i.category] = (cats[i.category] || 0) + 1; });
    Object.keys(cats).sort(groupOrder(items)).forEach(function (c) { list.push({ k: 'c:' + c, t: c, n: cats[c] }); });
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
  // All / Consumables: groups in update order (groupOrder), rows by name. A category chip is one group (the screen draws no header for it).
  function groupsFor(items, chip, q) {
    var rows = visible(items, chip, q), by = {}, order = [];
    rows.forEach(function (i) { if (!by[i.category]) { by[i.category] = { cat: i.category, rows: [], low: 0, out: 0 }; order.push(i.category); } var g = by[i.category], l = level(i); g.rows.push(i); if (l === 'out') g.out++; else if (l === 'low') g.low++; });
    var gs = order.map(function (c) { return by[c]; });
    var worst = function (g) { return g.out ? 0 : g.low ? 1 : 2; };
    if (chip === 'low') gs.sort(function (a, b) { return worst(a) - worst(b) || (b.out + b.low) - (a.out + a.low) || a.cat.localeCompare(b.cat); });
    else { var go = groupOrder(items); gs.sort(function (a, b) { return go(a.cat, b.cat); }); }
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
    nochange: 'Nothing has changed yet.',
    changedSince: 'Someone changed it after you. Count or edit it again.',
    tooLate: 'This can no longer be undone here. Count the item to correct it.',
    changeGone: 'This can no longer be undone here. Edit it again to correct it.',
    already: 'Someone already marked this as bought. The list is refreshed.',
    photofail: 'That photo could not be prepared. Try another one.',
    photobig: 'That photo is too large to send. Try one taken a little further away.',
    optfetch: 'The picture could not be fetched. Try again, or take a photo yourself.',
    wait: 'Cassy has just sorted. Please wait half a minute and try again.',
    labelsend: 'The label sheet was not sent. Try again. No new codes will be made.',
    createRefused: 'You cannot add items yet. Ask the owner.',
    createStays: 'It was used or changed since, so it stays. Ask the owner to remove it.',
    createLate: 'This can no longer be undone here. Ask the owner to remove it.',
    createGone: 'It was already removed.',
    consumable: 'This item gets used up, so it cannot be marked broken. Choose Used up instead.',
    linen: 'Towels and sheets are reported as stained or damaged. Choose that instead.',
    qty: 'Enter a whole number from 1 to 99.',
    rowsBad: 'That entry could not be read. Reload and try again.',
    sourceBad: 'That entry could not be sent from here. Reload and try again.',
    stockMoved: 'The stock changed while you were here. Reload and try again.',
    itemGone: 'That item is no longer on the list. Reload and try again.'
  };
  var REPORTS = [{ k: 'order', t: 'Order list', s: 'the order list' }, { k: 'all', t: 'All items', s: 'the full item list' }, { k: 'consumables', t: 'Consumables', s: 'the consumables list' }, { k: 'low', t: 'Low stock', s: 'the low-stock list' }, { k: 'misc', t: 'Miscellaneous', s: 'the miscellaneous list' }];
  var COOL_MS = 30000; // a sent report cannot be sent again to the same group for 30 seconds

  // Argument builders: the exact RPC names and keys the dashboard uses (api.ts). `vals` are the strings from the form, already validated.
  function countCall(it, v, key, dflt) {
    return { fn: 'reconcile_inventory_baseline_v1', args: { p_item_id: it.id, p_counted_qty: parseQty(v.qty, true), p_note: noteOf(v.note, dflt), p_idempotency_key: key } };
  }
  function noteOf(n, dflt) { var t = String(n || '').trim().slice(0, 200); return t.length >= 3 ? t : dflt || 'Counted in the staff app'; } // the server needs 3 characters
  function usageCall(pid, it, v, key, today) {
    return { fn: 'record_inventory_usage', args: { p_property_id: pid, p_session_date: today, p_logged_by: null, p_notes: String(v.note || '').trim().slice(0, 200) || 'Logged in the staff app', p_rows: [{ item_id: it.id, used_qty: parseQty(v.qty), usage_key: key }] } };
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
  // s86 4.6 / s124: Edit details. Only the keys that changed are sent (name, levels, kept in, unit, category), one patch, one call. An empty Kept in is sent as '' (the server stores null).
  function levelsCall(it, v) {
    var r = String(v.reorder || '').trim(), p = String(v.par || '').trim(), rn = r === '' ? null : parseQty(r, true), pn = p === '' ? null : parseQty(p, true), patch = {};
    if ('name' in v && String(v.name || '').trim() !== it.name) patch.name = String(v.name || '').trim();
    if (rn !== it.reorder) patch.reorder_below = rn;
    if (pn !== it.par) patch.par_qty = pn;
    if ('location' in v && String(v.location || '').trim() !== String(it.location || '')) patch.location = String(v.location || '').trim();
    if ('unit' in v && String(v.unit || '').trim() !== it.unit) patch.unit = String(v.unit || '').trim();
    if ('category' in v && String(v.category || '').trim() !== it.category) patch.category = String(v.category || '').trim();
    return { fn: 'inventory_item_update_v1', args: { p_item_id: it.id, p_patch: patch } };
  }
  // s86 4.4 / 4.5 / 4.6 / 9.5: exact RPC names and keys from SPEC-inventory-db 2.7 and 3.2.
  function setUsualCall(optId) { return { fn: 'inventory_item_option_set_usual_v1', args: { p_option_id: optId } }; }
  function changeUndoCall(id) { return { fn: 'inventory_item_change_undo_v1', args: { p_change_id: id } }; } // s124: one undo for details, price and photo, whoever made the change
  function photoSetCall(itemId, path) { return { fn: 'inventory_item_photo_set_v1', args: { p_item_id: itemId, p_path: path } }; }
  function recatCall(pid, ids, cat) { return { fn: 'inventory_items_recategorize_v1', args: { p_property_id: pid, p_item_ids: ids, p_category: cat } }; }
  function mintCall(pid, ids) { return { fn: 'inventory_code_mint_v1', args: { p_property_id: pid, p_item_ids: ids } }; }
  function labelsCall(ids) { return { invoke: 'inventory-report', body: { kind: 'labels', to: 'finance', item_ids: ids } }; }
  // s125: the same call for everyone. The keys are only name, category, unit, consumable, reorder_below, qty, location (a cleaner may send nothing else; no price, no par_qty); p_code is the manager's scan only.
  function createCall(pid, v, code, format, key) {
    var cat = String(v.category || '').trim(), item = { name: String(v.name || '').trim(), category: cat === CASSY ? UNCAT : cat === NEWCAT ? String(v.newcat || '').trim() : cat, unit: String(v.unit || '').trim() || 'pc', consumable: v.cons === 'yes' };
    if (String(v.reorder || '').trim() !== '') item.reorder_below = parseQty(v.reorder, true);
    if (String(v.qty || '').trim() !== '') item.qty = parseQty(v.qty, true);
    if (String(v.location || '').trim() !== '') item.location = String(v.location).trim();
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
      d('d11', 'Light bulbs', 'Maintenance', 'pieces', 3, 2, false, 150), d('d12', 'Drinking water', 'Kitchen', 'gallons', 1, 2, true, 40),
      d('d13', 'Drinking glass', 'Kitchen utensils', 'pcs', 6, null, false, 35), d('d14', 'Rice cooker', 'Appliances', 'pc', 1, null, false, 1850), d('d15', 'Coffee (3-in-1)', 'Kitchen supplies', 'sachets', 18, 10, true, 6)
    ].map(function (r) { if (r.id === 'd13') r.photo = DEMO_PIC_PATH; return r; }); // d13 has a picture, the rest show their emoji
  }
  var DEMO_PIC_PATH = 'demo/glass.webp', DEMO_PIC = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#cfe3f1"/><path d="M30 24h36l-4 48H34z" fill="#ffffff" fill-opacity="0.85" stroke="#7fa9c8" stroke-width="3"/></svg>');
  function demoShop() { return [{ id: 's1', item_id: 'd3', item_name: 'Hand soap', quantity: 6, purchase_unit: 'bottles', reason: 'Last one used today', status: 'proposed', proposed_at: '2026-10-12T02:00:00Z', proposed_by: 'someone' }, { id: 's2', item_id: 'd1', item_name: 'Toilet paper', quantity: 2, purchase_unit: 'pack', reason: '', status: 'approved', proposed_at: '2026-10-11T02:00:00Z', proposed_by: 'someone' }]; }

  /* ------------------------------------------------------------------ screen */
  var K = { items: null, shop: null, q: '', chip: 'low', role: null, at: 0, keys: {}, v84: false, lastCode: '', cool: {}, scanned: null, denied: {}, noFinance: false, undos: [], uidn: 0, hasCounted: false, quick: null, pu: {}, opt: {}, badImg: {}, sm: null, sup: null, catAt: 0, hasLoc: false, viewInit: false, cart: null, optBad: {}, pend: {} }; // denied: actions the server refused or lacks, hidden for the whole visit (a re-mount keeps them) // survives unmount: the list shows at once while it refreshes
  var M = null; // the live mount

  function mount(el, opts) {
    unmount();
    opts = opts || {};
    var prevRole = K.role;
    if (K.role !== opts.role) { K.role = opts.role; K.items = null; K.shop = null; K.q = ''; K.chip = 'low'; K.at = 0; K.keys = {}; K.v84 = false; K.lastCode = ''; K.cool = {}; K.scanned = null; K.denied = {}; K.noFinance = false; K.undos = []; K.hasCounted = false; K.sup = null; K.hasLoc = false; K.catAt = 0; K.usual = null; K.usualP = null; K.opt = {}; K.badImg = {}; K.cart = null; K.optBad = {}; K.pend = {}; if (prevRole !== null) recentClear(); } // a cached list is never shown to another role
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
    if (M.demo) { K.pu[DEMO_PIC_PATH] = { url: DEMO_PIC, at: nowMs() }; K.items = demoItems().map(function (r) { return normalize(r, M.role); }); K.shop = normalizeShop(demoShop(), null); K.v84 = true; K.hasCounted = true; }
    else if (M.client && M.client.auth && M.client.auth.getSession) { try { M.client.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; M.uid = s && s.user ? s.user.id : null; }, function () {}); } catch (e) { /* no uid: rows read "Asked by staff" */ } }
    if (M.demo) o8Demo();
    var goShop = false;
    if (opts.low) { K.viewInit = true; K.chip = 'low'; viewSave(false); } // s117: the folded Warnings row opens Items on Low for this entry only, over any saved view
    else if (!K.viewInit) { K.viewInit = true; var vw = ssGet('cs_I_view'); if (vw && vw.role === K.role) { if (/^(low|need|all|cons|out|c:.{1,80})$/.test(String(vw.chip))) K.chip = vw.chip; if (vw.tab === 'shopping' && !M.sub) { M.sub = 'shopping'; goShop = true; } } } // s107 B14: the last tab and chip come back once per visit
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
    }).then(function () { if (me.dead) return; me.loading = false; draw(); loadShop(); signPhotos(); o8Reqs(); });
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
    return '<span class="I_th" aria-hidden="true">' + (u && !K.badImg[u] ? '<img data-uimg="1" src="' + esc(u) + '" alt="" width="48" height="48" loading="lazy" decoding="async">' : '<span class="I_emo">' + itemEmoji(it) + '</span>') + '</span>';
  }
  function photoBlock(it) {
    var u = photoUrl(it);
    return u && !K.badImg[u] ? '<div class="I_photo I_ph96"><img data-uimg="1" src="' + esc(u) + '" alt="' + esc(it.name) + '" loading="lazy" decoding="async"></div>' : '<div class="I_photo I_ph96 I_phem" aria-hidden="true">' + itemEmoji(it) + '</div>';
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
  function siteOf(u) { var h = /^https:\/\/([^\/]+)/i.exec(u || ''); h = h ? h[1].replace(/^www\./, '') : ''; return h === 'shopsuki.ph' ? 'Shopsuki' : h === 'shopee.ph' ? 'Shopee' : h === 'mandauefoam.ph' ? 'Mandaue Foam' : h === 'myhanabishi.com' ? 'Hanabishi' : h || 'the shop'; }
  function normOpts(list) {
    return (Array.isArray(list) ? list : []).filter(function (o) { return o && o.id && o.title; }).map(function (o) {
      return { id: String(o.id), supplier: String(o.supplier || ''), title: String(o.title), brand: o.brand ? String(o.brand) : '', packLabel: o.pack_label ? String(o.pack_label) : '',
        image: o8Pic(o.image_url) || '', link: o8Link(o.source_url) || '',
        supplierId: o.supplier_id ? String(o.supplier_id) : '', packSize: num(o.pack_size), usual: !!o.usual, preferred: o.preferred === true, available: o.available === false ? false : o.available === true ? true : null, price: num(o.price) };
    });
  }
  function demoOptions(id) {
    var d = { d1: [['o1', 'Demo Mart', 'Softly Bath Tissue 12 rolls', 'Softly', 210, true], ['o2', 'Demo Mart', 'Cloud Bath Tissue 12 rolls', 'Cloud', 195, true], ['o3', 'Demo Mart', 'Plush Bath Tissue 8 rolls', 'Plush', 160, false]],
      d5: [['o4', 'Demo Mart', 'Strong Trash Bags Large 10s', 'Strong', 230, true], ['o5', 'Demo Mart', 'Strong Trash Bags XL 10s', 'Strong', 260, true]] }[id] || [];
    return d.map(function (x, n) { return { id: x[0], supplier: x[1], title: x[2], brand: x[3], packLabel: '', image: '', link: '', usual: n === 0, preferred: x[0] === 'o2', available: x[5], price: canPrice(M.role) ? x[4] : null }; });
  }
  function loadOptions(id) {
    o8Reqs(); var me = M, c0 = K.opt[id]; if (!me || (c0 && nowMs() - c0.at < 60000) || K.denied.inventory_item_options_v1) return Promise.resolve(); // kept across mounts (the shell re-mounts on every sub-route change), read again after a minute
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
  function sheetTyping() { var d = root.document, ae = d && d.activeElement, sh = M && M.el && M.el.querySelector ? M.el.querySelector('.sheet') : null; return !!(ae && sh && sh.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName || '')); } // a failed picture must not redraw the sheet under a thumb that is typing
  function onImgErr(ev) { var t = ev && ev.target; if (M && t && t.getAttribute && t.getAttribute('data-uimg')) { K.badImg[t.getAttribute('src')] = 1; drawList(); if (M.act && !M.act.sending && (M.act.kind === 'menu' || M.act.kind === 'update' || UKINDS[M.act.kind]) && !sheetTyping()) drawLayer(); return; } /* s132: a picture that will not load becomes the emoji */ if (M && t && t.getAttribute && t.getAttribute('data-oimg')) { K.badImg[t.getAttribute('src')] = 1; if (M.act && (M.act.kind === 'menu' || M.act.kind === 'o8list')) drawLayer(); } }
  function optionsBlock(it) {
    var st = K.opt[it.id]; if (!st || !st.list) return ''; var ed = o8On(); if (!st.list.length && !ed) return '';
    var money = canPrice(M.role), mng = canManage(M.role), sorted = optSort(st.list, money), main = sorted.filter(function (o) { return o.usual; }), rest = sorted.filter(function (o) { return !o.usual; });
    var btn = function (act, id, text) { return '<button class="btn btn-ghost I_undobtn" type="button" data-act="' + act + '" data-id="' + esc(id) + '">' + text + '</button>'; };
    var one = function (o, other) {
      var sub = [o.brand, o.supplier, o.packLabel].filter(Boolean).join(' · ');
      return '<div class="I_opt"><span class="I_oth">' + (o.image && !K.badImg[o.image] ? '<img src="' + esc(o.image) + '" alt="' + esc(o.title) + '" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-oimg="1">' : gi('image', 's16')) + '</span>' +
        '<div class="I_ob"><p class="I_ot">' + esc(o.title) + (o.usual ? ' <span class="I_usual">Usual</span>' : '') + (o.preferred ? ' <span class="I_pref">' + gi('star', 's16') + 'Preferred</span>' : '') + '</p>' + (sub ? '<p class="help">' + esc(sub) + '</p>' : '') +
        (money && o.price != null ? '<p class="help num">' + esc(peso(o.price)) + '</p>' : '') + (o.available === false ? '<p class="help I_oos">Out of stock</p>' : '') +
        '<div class="I_obt">' + (o.link ? '<a class="btn btn-ghost I_undobtn" href="' + esc(o.link) + '" target="_blank" rel="noopener noreferrer">View on ' + esc(siteOf(o.link)) + '</a>' : '') +
        (other && mng && !o.usual && allowed('optusual') ? btn('opt-usual', o.id, 'Make usual') : '') + (mng && o.image && allowed('photo') ? btn('opt-photo', o.id, 'Use as item photo') : '') +
        (ed ? '<button class="btn btn-ghost I_undobtn" type="button" data-act="o8-edit" data-id="' + esc(o.id) + '" aria-label="Edit ' + esc(o.title) + '">Edit</button>' + (o.usual ? '' : '<button class="btn btn-ghost I_undobtn" type="button" data-act="o8-del" data-id="' + esc(o.id) + '" aria-label="Remove ' + esc(o.title) + '">Remove</button>') : '') + '</div></div></div>';
    };
    return '<div class="I_opts" role="group" aria-label="Options"><h3 class="I_opth">Options</h3>' + main.map(function (o) { return one(o, false); }).join('') +
      (rest.length ? '<details class="I_other"' + (main.length ? '' : ' open') + '><summary>Other options (' + rest.length + ')</summary>' + rest.map(function (o) { return one(o, true); }).join('') + '</details>' : '') +
      (ed ? '<button class="btn btn-secondary btn-block I_o8add" type="button" data-act="o8-add">' + gi('plus', 's16') + ' Add a product</button>' + o8Wait(it) : '') + '</div>';
  }
  function renderOptUsual(a, it) {
    var o = optById(a.itemId, a.optId); if (!o) return null;
    return head('Make this the usual for ' + it.name + '?') + '<form data-i-form><p class="I_conf">' + esc(o.title) + (o.supplier ? ' from ' + esc(o.supplier) : '') + (canPrice(M.role) && o.price != null ? ' at ' + esc(peso(o.price)) : '') + '. Shopping lists and Add low items will use it.</p>' + actions(a, 'Yes, make it usual') + '</form>';
  }
  /* ---- s108 product requests: any staff user can add, change or remove a product under an item; owner and admin apply at once or approve.
     Server: inventory_option_request_v1 / _requests_v1 / _decide_v1 / _cancel_v1. A missing RPC (PGRST202 or 404) hides every control here for the visit (K.denied.o8). */
  var O8_WORD = { add: 'New product', edit: 'Change', delete: 'Remove' };
  var O8_LBL = [['title', 'Name'], ['brand', 'Brand'], ['pack_label', 'Pack'], ['pack_size', 'Pieces per pack'], ['supplier_id', 'Shop'], ['price', 'Price'], ['source_url', 'Link'], ['image_url', 'Photo'], ['available', 'In stock']];
  function o8On() { return !!M && !M.denied.o8 && (M.demo || !!M.client); }
  function o8T(s) { return String(s == null ? '' : s).trim(); }
  // A link on one of the allowed hosts, https only. Shopee links lose their query (tracking); the host is lower-cased. Returns null when it is not allowed.
  function o8Url(s, hosts) {
    var m = /^https:\/\/([A-Za-z0-9.-]+)(\/[^?#\s"'<>]*)?(\?[^#\s"'<>]*)?(#\S*)?$/.exec(o8T(s)); if (!m) return null;
    var host = m[1].toLowerCase().replace(/^www\./, ''); if (hosts.indexOf(host) < 0) return null;
    var out = 'https://' + host + (m[2] || '/') + (host === 'shopee.ph' ? '' : m[3] || '');
    return out.length <= 500 ? out : null;
  }
  var O8_LINK = ['shopsuki.ph', 'shopee.ph', 'mandauefoam.ph', 'myhanabishi.com'], O8_PIC = ['cdn.shopify.com', 'down-ph.img.susercontent.com'];
  function o8Link(s) { return o8Url(s, O8_LINK); }
  function o8Pic(s) { return o8Url(s, O8_PIC); }
  function o8Reqlist() { return K.req && M && K.req.role === M.role ? K.req.list : []; }
  function o8Pending() { return o8Reqlist().filter(function (r) { return r.status === 'pending'; }); } // the one selector for the badge, the pill and the list
  function o8Count() { return o8On() && canManage(M.role) ? o8Pending().length : 0; }
  function o8Mine(itemId) { return o8Pending().filter(function (r) { return r.mine && r.itemId === itemId; }); }
  function o8ReqBy(id) { return o8Reqlist().filter(function (r) { return r.id === id; })[0] || null; }
  function normReqs(list) {
    return (Array.isArray(list) ? list : []).filter(function (r) { return r && r.id; }).map(function (r) {
      return { id: String(r.id), itemId: String(r.item_id || ''), item: String(r.item || ''), optionId: r.option_id ? String(r.option_id) : null, optionTitle: r.option_title ? String(r.option_title) : '', action: String(r.action || ''),
        payload: r.payload && typeof r.payload === 'object' ? r.payload : {}, status: String(r.status || 'pending'), note: r.note ? String(r.note) : '', requester: r.requester ? String(r.requester) : '', mine: r.mine === true,
        at: r.requested_at ? String(r.requested_at) : '', current: r.current && typeof r.current === 'object' ? r.current : null };
    });
  }
  function o8Demo() {
    var own = canManage(M.role);
    K.req = { role: M.role, ok: true, at: nowMs(), busy: false, list: own ? [{ id: 'dq1', itemId: 'd1', item: 'Toilet paper', optionId: null, optionTitle: '', action: 'add', status: 'pending', note: 'Cheaper per roll', requester: 'Demo staff', mine: false, at: '2026-10-30T02:00:00Z', current: null,
      payload: { title: 'Plush Bath Tissue 12 rolls', brand: 'Plush', pack_label: '12 rolls', pack_size: 12, price: 175, source_url: 'https://shopsuki.ph/products/plush-12', supplier_id: 'demo-sup', available: true } }] : [] };
    K.o8sup = { pid: M.pid, at: nowMs(), rows: [{ id: 'demo-sup', name: 'Demo Mart', active: true }] };
  }
  function o8Redraw() {
    if (!M) return;
    var top = q('[data-i-top]'); if (top) top.innerHTML = renderTop(route());
    var a = M.act; if (a && !a.sending && (a.kind === 'menu' || (a.kind === 'o8list' && !a.dec))) drawLayer();
  }
  // Reads the pending requests (all of them for owner/admin, the caller's own for everyone else). A failure with "missing" is the probe that hides the feature.
  function o8Reqs(force) {
    var me = M; if (!me || me.demo || !me.client || me.denied.o8 || !online()) return Promise.resolve();
    var s0 = K.req && K.req.role === me.role ? K.req : null;
    if (s0 && (s0.busy || (!force && nowMs() - s0.at < 30000))) return Promise.resolve();
    var s = K.req = { role: me.role, list: s0 ? s0.list : [], at: nowMs(), busy: true, ok: !!(s0 && s0.ok) };
    return Promise.resolve().then(function () { return me.client.rpc('inventory_option_requests_v1', { p_property_id: me.pid, p_status: 'pending' }); }).then(function (r) {
      if (r && r.error) throw r.error;
      if (!r || !r.data || r.data.ok === false) throw { message: 'failed' };
      s.list = normReqs(r.data.requests); s.ok = true; s.busy = false; s.at = nowMs(); if (M === me) o8Redraw();
    }).catch(function (e) {
      s.busy = false; s.at = nowMs();
      var k = errKind(e, online()); if (k === 'missing' || k === 'refused') me.denied.o8 = true; // the SQL release is not applied yet (or no access): no controls, no message
      if (M === me) o8Redraw();
    });
  }
  function typing() { var d = root.document, n = d && d.activeElement; return !!(n && /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)); }
  function o8Sups() {
    var me = M, c = K.o8sup; if (!me) return Promise.resolve(null);
    if (c && c.pid === me.pid && c.rows && (me.demo || nowMs() - c.at < 300000)) return Promise.resolve(c.rows);
    if (me.demo || !me.client) return Promise.resolve(null);
    return Promise.resolve().then(function () { return me.client.rpc('inventory_supplier_list_v1', { p_property_id: me.pid }); }).then(function (r) {
      if (r && r.error) throw r.error;
      var l = r && r.data && Array.isArray(r.data.suppliers) ? r.data.suppliers : null; if (!l) throw { message: 'failed' };
      K.o8sup = { pid: me.pid, at: nowMs(), rows: l.filter(function (x) { return x && x.id && x.name; }).map(function (x) { return { id: String(x.id), name: String(x.name), active: x.active !== false }; }) };
      var a = M && M.act; if (M === me && a && (a.kind === 'o8form' || a.kind === 'o8list' || (a.kind === 'create' && !typing()))) drawLayer();
      return K.o8sup.rows;
    }).catch(function () { K.o8sup = { pid: me.pid, at: nowMs(), rows: null, bad: true }; var a = M && M.act; if (M === me && a && a.kind === 'o8form') drawLayer(); return null; });
  }
  function o8SupName(id) {
    var rows = K.o8sup && K.o8sup.rows || [], f = rows.filter(function (x) { return x.id === id; })[0]; if (f) return f.name;
    var n = ''; Object.keys(K.opt).some(function (k) { var l = K.opt[k] && K.opt[k].list; return l && l.some(function (o) { if (o.supplierId === id) { n = o.supplier; return true; } return false; }); });
    return n || 'another shop';
  }
  function o8Val(k, v) {
    if (v == null || v === '') return 'none';
    if (k === 'supplier_id') return o8SupName(String(v));
    if (k === 'available') return v === false || v === 'false' ? 'Out of stock' : 'In stock';
    if (k === 'price') return peso(v);
    if (k === 'pack_size') return fmt(v);
    if (k === 'source_url') return siteOf(String(v));
    if (k === 'image_url') return 'Photo link';
    return String(v);
  }
  function o8Diff(r) {
    var p = r.payload || {}, c = r.current || {}, rows = [];
    if (r.action === 'delete') return '<dl class="I_dl">' + row('Product', esc(r.optionTitle || c.title || 'This product')) + '</dl>';
    O8_LBL.forEach(function (L) {
      var k = L[0]; if (!(k in p)) return;
      var nv = o8Val(k, p[k]);
      if (k === 'source_url' && p[k] && /^https:\/\//i.test(String(p[k]))) nv = '<a href="' + esc(p[k]) + '" target="_blank" rel="noopener noreferrer">View on ' + esc(siteOf(String(p[k]))) + '</a>'; else nv = esc(nv);
      rows.push(row(L[1], r.action === 'edit' ? esc(o8Val(k, c[k])) + ' → ' + nv : nv));
    });
    return rows.length ? '<dl class="I_dl">' + rows.join('') + '</dl>' : '';
  }
  function o8Thumb(r) {
    var u = r.action === 'delete' ? (r.current || {}).image_url : r.payload.image_url;
    u = o8Pic(u); return u && !K.badImg[u] ? '<img class="I_rth" src="' + esc(u) + '" alt="" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-oimg="1">' : '';
  }
  // The text of an error from the server: the codes the SQL names, in plain words.
  function o8Why(e) {
    var m = String(e && e.message || ''), k = errKind(e, online());
    if (k === 'missing' || k === 'refused' || k === 'offline') return { err: k };
    if (/usual_option/.test(m)) return { err: 'o8', msg: 'The usual product cannot be removed. Make another product the usual one first.' };
    if (/duplicate_option/.test(m)) return { err: 'o8', msg: 'That product is already in the list.' };
    if (/option_gone/.test(m)) return { err: 'o8', msg: 'That product is no longer there. The list is refreshed.', refresh: true };
    if (/not_pending/.test(m)) return { err: 'o8', msg: 'That request was already handled. The list is refreshed.', refresh: true };
    if (/price_not_allowed/.test(m)) return { err: 'o8', msg: 'Prices are for the owner and finance only.' };
    if (e && e.code === 'P0002') return { err: 'o8', msg: 'That item or request is no longer there. The list is refreshed.', refresh: true };
    if (e && e.code === '22023' && m && m.length < 140) return { err: 'o8', msg: m.charAt(0).toUpperCase() + m.slice(1).replace(/\.?$/, '.') };
    return { err: 'other' };
  }
  function o8FormVals(o) {
    if (!o) return { title: '', brand: '', packLabel: '', packSize: '', supplierId: '', link: '', photo: '', price: '', avail: '1', note: '' };
    return { title: o.title, brand: o.brand, packLabel: o.packLabel, packSize: o.packSize != null ? fmt(o.packSize) : '', supplierId: o.supplierId || '', link: o.link, photo: o.image,
      price: canPrice(M.role) && o.price != null ? fmt(o.price) : '', avail: o.available === false ? '0' : '1', note: '' };
  }
  // The payload of a form: every field checked the way the server checks it; an edit sends only what changed (a cleared optional field is null). A price key exists only for owner/admin/finance.
  function o8Payload(a) {
    var v = a.vals, o = a.orig, add = a.action === 'add', p = {}, money = canPrice(M.role);
    var diff = function (k) { return add ? o8T(v[k]) !== '' : o8T(v[k]) !== o8T(o[k]); };
    var title = o8T(v.title); if (!title || title.length > 160) return { msg: 'Add a product name of up to 160 characters.' };
    if (add || diff('title')) p.title = title;
    if (o8T(v.brand).length > 60) return { msg: 'The brand can be up to 60 characters.' };
    if (diff('brand')) p.brand = o8T(v.brand) || null;
    if (o8T(v.packLabel).length > 40) return { msg: 'The size can be up to 40 characters.' };
    if (diff('packLabel')) p.pack_label = o8T(v.packLabel) || null;
    if (o8T(v.packSize) !== '') { var ps = parseQty(v.packSize); if (ps == null || ps >= 100000) return { msg: 'Pieces per pack must be a number above 0.' }; }
    if (diff('packSize')) p.pack_size = o8T(v.packSize) === '' ? null : parseQty(v.packSize);
    if (!o8T(v.supplierId)) return { msg: 'Choose the shop it is sold at.' };
    if (add || diff('supplierId')) p.supplier_id = o8T(v.supplierId);
    var lk = o8Link(v.link); if (!lk) return { msg: 'Add the product link. It must be an https link from shopsuki.ph, shopee.ph, mandauefoam.ph or myhanabishi.com.' };
    var olk = add ? '' : o8Link(o.link) || o8T(o.link);
    if (add || lk !== olk) p.source_url = lk;
    if (o8T(v.photo) !== '') { var pu = o8Pic(v.photo); if (!pu) return { msg: 'The photo link must be an https image on cdn.shopify.com or down-ph.img.susercontent.com.' }; var opu = add ? '' : o8Pic(o.photo) || o8T(o.photo); if (add || pu !== opu) p.image_url = pu; }
    else if (!add && o8T(o.photo) !== '') p.image_url = null;
    if (money && o8T(v.price) !== '' && parseQty(v.price) == null) return { msg: 'The price must be a number above 0.' };
    if (money && diff('price')) p.price = o8T(v.price) === '' ? null : parseQty(v.price);
    if (add || v.avail !== o.avail) p.available = v.avail === '1';
    if (!add && !Object.keys(p).length) return { msg: 'Nothing has changed yet.' };
    return { payload: p };
  }
  function o8Render(a) {
    if (a.kind === 'o8list') return o8RenderList(a);
    var it = itemById(a.itemId); if (!it) return null;
    var mng = canManage(M.role), v = a.vals || {};
    if (a.kind === 'o8del') return head('Remove ' + a.title + '?', it.name) + '<form data-i-form><p class="I_conf">' + (mng ? 'It is taken off the options of this item.' : 'An admin will check the request before it is removed.') + '</p>' + actions(a, mng ? 'Yes, remove it' : 'Yes, ask to remove it') + '</form>';
    var rows = K.o8sup && K.o8sup.rows, sel;
    if (rows) sel = selectField('supplierId', 'Shop', [['', 'Choose a shop']].concat(rows.filter(function (x) { return x.active || x.id === v.supplierId; }).map(function (x) { return [x.id, x.name]; })), v.supplierId);
    else sel = '<div class="field"><span class="lbl">Shop</span><p class="help">' + (K.o8sup && K.o8sup.bad ? 'The shops could not be loaded. Close this and open it again.' : 'Loading the shops…') + '</p></div>';
    return head(a.action === 'add' ? 'Add a product' : 'Edit product', it.name) + '<form data-i-form novalidate>' +
      textField('title', 'Product name', v.title, 'maxlength="160"') + textField('brand', 'Brand', v.brand, 'maxlength="60"') + textField('packLabel', 'Size or pack label', v.packLabel, 'maxlength="40"') +
      textField('packSize', 'Pieces per pack (optional)', v.packSize, 'inputmode="decimal"') + sel +
      textField('link', 'Product link', v.link, 'inputmode="url" autocapitalize="off" maxlength="500"') + '<p class="help">A link from shopsuki.ph, shopee.ph, mandauefoam.ph or myhanabishi.com.</p>' +
      textField('photo', 'Photo link (optional)', v.photo, 'inputmode="url" autocapitalize="off" maxlength="500"') +
      (canPrice(M.role) ? textField('price', 'Price in PHP (optional)', v.price, 'inputmode="decimal"') : '') +
      '<div class="field"><button class="chip I_choice" type="button" data-act="o8-avail" aria-pressed="' + (v.avail === '1') + '">' + (v.avail === '1' ? gi('check', 's16') + ' ' : '') + 'In stock</button></div>' +
      textField('note', 'Note (optional)', v.note, 'maxlength="500"') + actions(a, mng ? 'Save' : 'Send for approval') + '</form>';
  }
  function o8Card(a, r) {
    var d = a.dec && a.dec.id === r.id ? a.dec : null, h = '<div class="I_req"><p class="I_ot">' + esc(O8_WORD[r.action] || 'Change') + ' · ' + esc(r.item) + '</p><p class="help">' + esc((r.requester || 'Staff') + (dateLabel(r.at) ? ' · ' + dateLabel(r.at) : '')) + '</p>' +
      (r.note ? '<p class="help">' + esc(r.note) + '</p>' : '') + o8Thumb(r) + o8Diff(r);
    if (!d) return h + '<div class="I_obt"><button class="btn btn-primary" type="button" data-act="o8-approve" data-id="' + esc(r.id) + '">Approve</button><button class="btn btn-secondary" type="button" data-act="o8-reject" data-id="' + esc(r.id) + '">Reject</button></div></div>';
    return h + '<form data-i-form>' + (d.mode === 'approve' ? (r.action !== 'delete' && canPrice(M.role) ? textField('dprice', 'Price in PHP (optional)', a.vals.dprice, 'inputmode="decimal"') + '<p class="help">Keep it, or change it before you approve.</p>' : '') : textField('dnote', 'Note for the requester (optional)', a.vals.dnote, 'maxlength="500"')) +
      actions(a, d.mode === 'approve' ? 'Approve' : 'Reject') + '</form></div>';
  }
  function o8RenderList(a) {
    var l = o8Pending();
    return head('Requests', l.length ? l.length + ' waiting for you' : 'Nothing is waiting for approval.') + (a.dec ? '' : errBox(a)) +
      '<div class="I_reqs">' + l.map(function (r) { return o8Card(a, r); }).join('') + '</div><div class="I_btns"><button class="btn btn-ghost btn-block" type="button" data-act="close">Close</button></div>';
  }
  function o8Menu(itemId) { M.act = newMenu(itemId); drawLayer(); }
  function o8Back(a) {
    if (a.kind === 'o8list') { if (a.dec) { a.dec = null; a.err = null; drawLayer(); return; } return closeSheet(); }
    o8Menu(a.itemId);
  }
  function o8Click(act, t, a) {
    if (a && a.sending) return;
    var id = attr(t, 'data-id');
    if (act === 'back') return o8Back(a);
    if (act === 'o8-reqs') { if (!o8On() || !canManage(M.role) || M.act) return; M.act = { kind: 'o8list', vals: { dprice: '', dnote: '' }, dec: null }; drawLayer(); o8Sups(); o8Reqs(true); return; }
    if (act === 'o8-cancel') return o8Cancel(id);
    if (!a) return;
    if (a.kind === 'menu' && a.itemId && o8On()) {
      if (act === 'o8-add') { M.act = { kind: 'o8form', itemId: a.itemId, action: 'add', optId: null, orig: null, vals: o8FormVals(null) }; drawLayer(); o8Sups(); return; }
      if (act === 'o8-edit') { var o = optById(a.itemId, id); if (!o) return; var fv = o8FormVals(o); M.act = { kind: 'o8form', itemId: a.itemId, action: 'edit', optId: o.id, orig: Object.assign({}, fv), vals: fv }; drawLayer(); o8Sups(); return; }
      if (act === 'o8-del') { var od = optById(a.itemId, id); if (!od) return; M.act = { kind: 'o8del', itemId: a.itemId, optId: od.id, title: od.title }; drawLayer(); return; }
    }
    if (a.kind === 'o8form' && act === 'o8-avail') { a.vals.avail = a.vals.avail === '1' ? '0' : '1'; a.err = null; drawLayer(); return; }
    if (a.kind === 'o8list' && (act === 'o8-approve' || act === 'o8-reject')) {
      var r = o8ReqBy(id); if (!r) return; var pp = r.payload.price;
      a.dec = { id: r.id, mode: act === 'o8-approve' ? 'approve' : 'reject' }; a.vals = { dprice: pp != null ? fmt(pp) : '', dnote: '' }; a.err = null; a.focused = true; drawLayer(); return;
    }
  }
  function o8Submit(a) {
    if (a.kind === 'o8list') return a.dec ? o8Decide(a) : undefined;
    var action = a.kind === 'o8del' ? 'delete' : a.action, payload = {}, note = a.kind === 'o8form' ? o8T(a.vals.note) : '';
    if (a.kind === 'o8form') { var c = o8Payload(a); if (!c.payload) { a.err = 'o8'; a.msg = c.msg; return drawLayer(); } payload = c.payload; }
    var me = M;
    if (me.demo) { toast(DEMO_NOTE); return o8Menu(a.itemId); }
    if (!online()) { a.err = 'offline'; return drawLayer(); }
    if (!me.client) { a.err = 'missing'; return drawLayer(); }
    var sig = JSON.stringify(['o8', action, a.itemId, a.optId || null, payload, note]), ke = K.keys[sig]; // one key per set of values, kept across a retry; a changed form gets a new one
    if (!ke || nowMs() - ke.at > 600000) ke = K.keys[sig] = { key: newKey('opt'), at: nowMs() };
    a.sending = true; a.err = null; drawLayer();
    Promise.resolve().then(function () { return me.client.rpc('inventory_option_request_v1', { p_item_id: a.itemId, p_action: action, p_option_id: a.optId || null, p_payload: payload, p_note: note || null, p_idempotency_key: ke.key }); }).then(function (r) {
      if (me.dead) return;
      if (r && r.error) throw r.error;
      if (!r || !r.data || r.data.ok === false) throw { message: 'failed' };
      a.sending = false; delete K.keys[sig];
      var applied = r.data.applied === true;
      toast(applied ? 'Saved.' : 'Sent for approval. An admin will check it.');
      if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (e) { /* no haptics */ } }
      if (applied) { delete K.opt[a.itemId]; K.usual = null; K.usualAt = 0; }
      o8Menu(a.itemId); if (applied) loadOptions(a.itemId); o8Reqs(true);
    }).catch(function (e) {
      if (me.dead) return;
      a.sending = false; var w = o8Why(e);
      if (w.err === 'missing' || w.err === 'refused') { me.denied.o8 = true; toast(ERR[w.err]); o8Menu(a.itemId); return o8Redraw(); }
      a.err = w.err; a.msg = w.msg || '';
      if (w.refresh) { delete K.opt[a.itemId]; loadOptions(a.itemId); o8Reqs(true); }
      drawLayer();
    });
  }
  function o8Decide(a) {
    var r = o8ReqBy(a.dec.id), me = M; if (!r) { a.dec = null; return drawLayer(); }
    var approve = a.dec.mode === 'approve', ov = null;
    if (approve && r.action !== 'delete' && canPrice(M.role) && o8T(a.vals.dprice) !== '') {
      var n = parseQty(a.vals.dprice); if (n == null) { a.err = 'o8'; a.msg = 'The price must be a number above 0.'; return drawLayer(); }
      if (r.payload.price == null || n !== Number(r.payload.price)) ov = { price: n };
    }
    if (me.demo) { toast(DEMO_NOTE); a.dec = null; return drawLayer(); }
    if (!online()) { a.err = 'offline'; return drawLayer(); }
    a.sending = true; a.err = null; drawLayer();
    Promise.resolve().then(function () { return me.client.rpc('inventory_option_request_decide_v1', { p_request_id: r.id, p_decision: approve ? 'approve' : 'reject', p_payload_override: ov, p_note: approve ? null : o8T(a.vals.dnote) || null }); }).then(function (res) {
      if (me.dead) return;
      if (res && res.error) throw res.error;
      if (!res || !res.data || res.data.ok === false) throw { message: 'failed' };
      a.sending = false; a.dec = null; a.err = null;
      K.req.list = K.req.list.filter(function (x) { return x.id !== r.id; }); delete K.opt[r.itemId]; K.usual = null; K.usualAt = 0;
      toast(approve ? 'Approved.' : 'Rejected.');
      if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (e) { /* no haptics */ } }
      o8Redraw(); drawLayer(); o8Reqs(true);
    }).catch(function (e) {
      if (me.dead) return;
      a.sending = false; var w = o8Why(e);
      if (w.err === 'missing' || w.err === 'refused') { me.denied.o8 = true; toast(ERR[w.err]); M.act = null; draw(); return; }
      a.err = w.err; a.msg = w.msg || ''; if (w.refresh) { a.dec = null; o8Reqs(true); }
      drawLayer();
    });
  }
  function o8Cancel(id) {
    var me = M, r = o8ReqBy(id); if (!me || !r || !r.mine || (K.o8busy && K.o8busy[id])) return;
    if (me.demo) { toast(DEMO_NOTE); return; }
    if (!online()) { toast(ERR.offline); return; }
    K.o8busy = K.o8busy || {}; K.o8busy[id] = 1;
    Promise.resolve().then(function () { return me.client.rpc('inventory_option_request_cancel_v1', { p_request_id: id }); }).then(function (res) {
      if (res && res.error) throw res.error;
      if (!res || !res.data || res.data.ok === false) throw { message: 'failed' };
      toast('Request cancelled.');
    }).catch(function (e) {
      var w = o8Why(e); if (w.err === 'missing' || w.err === 'refused') me.denied.o8 = true;
      toast(w.err === 'o8' ? w.msg : ERR[w.err] || ERR.other);
    }).then(function () { delete K.o8busy[id]; return o8Reqs(true); }).then(function () { if (M === me) o8Redraw(); });
  }
  function o8Wait(it) {
    var wl = o8Mine(it.id); if (!wl.length) return '';
    return '<div class="I_wait" role="group" aria-label="Waiting for approval"><h3 class="I_opth">Waiting for approval</h3>' + wl.map(function (r) {
      var nm = r.action === 'add' ? r.payload.title : r.optionTitle;
      return '<div class="I_wrow"><p class="I_wt">' + esc(O8_WORD[r.action] + (nm ? ': ' + nm : '')) + '</p><button class="btn btn-ghost I_undobtn" type="button" data-act="o8-cancel" data-id="' + esc(r.id) + '" aria-label="Cancel the request: ' + esc(O8_WORD[r.action] + (nm ? ' ' + nm : '')) + '">Cancel</button></div>';
    }).join('') + '</div>';
  }
  function relPrev(a) { if (a && a.prev && root.URL && root.URL.revokeObjectURL) { try { root.URL.revokeObjectURL(a.prev); } catch (e) { /* gone already */ } } if (a) a.prev = null; }
  // Cross-origin read of an option picture; anything that goes wrong is one plain line.
  function fetchPicture(url) {
    if (typeof root.fetch !== 'function') throw { photo: 'optfetch' };
    return Promise.resolve().then(function () { return root.fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }); }).then(function (r) { if (!r || !r.ok) throw 0; return r.blob(); }).then(null, function () { throw { photo: 'optfetch' }; });
  }
  function onChange(ev) { var t = ev.target; if (M && t && (t.id === 'I_photo_in' || t.id === 'I_photo_pick')) photoPicked(ev); else if (M && t && (t.id === 'I_up_in' || t.id === 'I_up_pick')) updPhotoPicked(ev); else if (M && t && (t.id === 'I_np_in' || t.id === 'I_np_pick')) newPhoto(ev); }
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
    if (canManage(M.role) && o8On()) b('o8-reqs', 'Requests' + (o8Count() ? ' ' + o8Count() : ''));
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
    if (o8Count()) pills += pl('o8-reqs', 'x', 'note', o8Count() + (o8Count() === 1 ? ' request' : ' requests'), 'I_pinfo');
    h += '<div class="I_pills" role="group" aria-label="Stock status">' + pills + '</div>';
    // s107 B4: the search and the filter chips stay under the app bar while the list scrolls
    h += '<div class="I_find"><div class="I_srow' + (allowed('create') ? ' I_srow3' : '') + '"><div class="field"><label class="sr" for="I_q">Search items</label><div class="input"><input id="I_q" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(K.q) + '" placeholder="Search items"></div></div>' +
      (K.v84 ? '<button class="chip I_scanbtn" type="button" data-act="scan" aria-label="Scan a barcode">' + gi('camera') + '</button>' : '') +
      (allowed('create') ? '<button class="btn btn-primary btn-sm I_addbtn" type="button" data-act="add-new">' + gi('plus', 's16') + ' Add item</button>' : '') + '</div>';
    h += '<div class="I_chips" role="group" aria-label="Show">' + cs.map(function (c) { return '<button class="chip" type="button" data-act="chip" data-k="' + esc(c.k) + '" aria-pressed="' + (K.chip === c.k) + '">' + esc(c.k.indexOf('c:') === 0 ? groupName(c.t) : c.t) + ' <span class="I_cn">' + c.n + '</span></button>'; }).join('') +
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
    if (!gs.length) h += '<div class="empty"><p class="hd">' + (K.q ? (allowed('create') ? 'No item called "' + esc(K.q.trim()) + '". Tap Add item to add it.' : 'Nothing matches that search.') : K.chip === 'low' ? 'Nothing is running low.' : K.chip === 'need' ? 'Everything has been counted lately.' : 'Nothing to show here.') + '</p>' + (K.chip !== 'all' || K.q ? '<button class="btn btn-secondary" type="button" data-act="showall">Show all items</button>' : '') + '</div>';
    else h += gs.map(function (g, n) { return renderGroup(g, n, K.chip.indexOf('c:') !== 0); }).join('');
    box.innerHTML = (K.q ? '' : renderRecent()) + h; // s107 B1: Recent only while the search box is empty
  }
  function renderGroup(g, n, header) {
    var note = g.out || g.low ? '<span class="I_ghn">' + (g.out ? '' + gi('xcircle', 's16') + ' ' + g.out + ' out' : '') + (g.out && g.low ? ', ' : '') + (g.low ? '' + gi('alert', 's16') + ' ' + g.low + ' low' : '') + '</span>' : '';
    return '<section class="I_grp"' + (header ? ' aria-labelledby="I_gh_' + n + '"' : '') + '>' + (header ? '<h3 class="I_gh" id="I_gh_' + n + '"><span>' + esc(groupName(g.cat)) + '</span>' + note + '</h3>' : '') + '<div class="card list I_list">' + g.rows.map(renderRow).join('') + (allowed('count') ? '<div class="I_foot"><button class="btn btn-ghost I_gcount" type="button" data-act="walk" data-cat="' + esc(g.cat) + '" aria-label="Count this group, ' + esc(g.cat) + '">Count this group</button></div>' : '') + '</div></section>';
  }
  function renderFail(kind) {
    return '<div class="empty I_fail" role="alert"><p class="hd">' + (kind === 'offline' ? 'No connection' : 'Inventory is not available right now') + '</p>' +
      '<p class="help">' + (kind === 'offline' ? 'Check your signal, then try again.' : 'Nothing is wrong with your account. Try again in a moment.') + '</p><button class="btn btn-primary" type="button" data-act="retry">Try again</button></div>';
  }
  function levelBadge(it) { var l = level(it), L = LEVELS[l]; return '<span class="I_lv I_' + l + '">' + gi(L.glyph, 's16') + ' ' + L.word + '</span>'; }
  // The most common action for this row, one tap from the list: the cleaner records use, an owner adds a low item to the shopping list, anyone allowed counts.
  function quickFor(it) {
    var lv = level(it);
    if (allowed('update')) return { kind: 'update', t: 'Update' }; // s132: one Update button for owner, admin, cleaner and laundry
    if (allowed('used')) return lv !== 'ok' && allowed('low', it) ? { kind: 'low', t: lv === 'out' ? 'It is out' : 'Running low' } : { kind: 'used', t: 'Use' }; // s107 B8: a cleaner who sees it low says so; otherwise records use
    if (lv !== 'ok' && canManage(M.role) && allowed('low', it)) return { kind: 'low', t: 'Add to list' };
    if (allowed('count')) return { kind: 'count', t: 'Count' };
    if (lv !== 'ok' && allowed('low', it)) return { kind: 'low', t: lv === 'out' ? 'It is out' : 'Running low' };
    return null;
  }
  // 'Low · 4 of 12 rolls': the level in a word and a glyph, then the amount; below the reorder level it is shown against that level.
  function amountText(it) {
    if (it.qty == null) return 'Not counted';
    return level(it) !== 'ok' && it.reorder != null ? fmt(it.qty) + ' of ' + uq(it.reorder, it.unit) : uq(it.qty, it.unit);
  }
  function levelWord(it) { var L = LEVELS[level(it)]; return '<span class="I_lw I_' + level(it) + '">' + gi(L.glyph, 's16') + ' ' + L.word + '</span>'; }
  function renderRow(it) {
    var p = tilePct(it), qa = quickFor(it), listed = (K.shop || []).some(function (r) { return r.itemId === it.id; }), tags = '';
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
    box.innerHTML = '<div class="scrim on" data-act="close"></div><div class="sheet on I_sheet' + ((a.kind === 'menu' && !a.shopId) || a.kind === 'update' ? ' I_sheetm' : '') + (UKINDS[a.kind] ? ' I_uf I_hue_' + UOPT[a.kind].hue : '') + (a.kind === 'create' ? ' I_new' : '') + '" role="dialog" aria-modal="true" aria-labelledby="I_sh_t">' + body + '</div>';
    [main1, main2].forEach(function (n) { n && n.setAttribute && n.setAttribute('inert', ''); });
    if (!a.focused) { a.focused = true; var h = q('#I_sh_t'); if (h && h.focus) h.focus(); }
    bindVideo();
  }
  function refocus(id) { var n = M && M.el.querySelector && M.el.querySelector('#' + id); if (n && n.focus) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* not a text box */ } } }
  function head(title, sub) { return '<h2 class="hd I_sht" id="I_sh_t" tabindex="-1">' + esc(title) + '</h2>' + (sub ? '<p class="help">' + esc(sub) + '</p>' : ''); }
  function row(label, val) { return '<div class="I_kv"><dt>' + label + '</dt><dd>' + val + '</dd></div>'; }
  function errBox(a) {
    if (!a.err) return '';
    var t = a.err === 'taken' ? 'That code is already linked to ' + (a.takenName || 'another item') + '.' : a.err === 'o8' ? a.msg : ERR[a.err] || ERR.other;
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
    if (a.kind === 'undo') return head(a.entry.confirm) + '<form data-i-form>' + errBox(a) + actions(a, goneErr(a) ? 'Close' : 'Yes, undo it') + '</form>';
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
    if (/^o8/.test(a.kind)) return o8Render(a);
    var it = itemOf(a); if (!it) return null;
    var v = a.vals || {}, m = M.role, h;
    if (a.kind === 'history') return renderHistory(a, it);
    if (a.kind === 'photo' || a.kind === 'photoremove') return renderPhoto(a, it);
    if (a.kind === 'optusual') return renderOptUsual(a, it);
    if (a.kind === 'unlink') return head('Unlink code ' + shortCode(a.code) + ' from ' + it.name + '?') + '<form data-i-form><p class="I_conf">Scanning this code will no longer open ' + esc(it.name) + '.</p>' + actions(a, 'Yes, unlink it') + '</form>';
    if (a.kind === 'low') return head(canManage(M.role) ? 'Add ' + it.name + ' to the shopping list?' : 'Tell the owner ' + it.name + (level(it) === 'out' ? ' is out?' : ' is running low?')) + '<form data-i-form><p class="I_conf">It goes on the shopping list for ' + esc(uq(lowQty(it), it.purchaseUnit || unitOf(it))) + '.</p>' + actions(a, canManage(M.role) ? 'Yes, add it' : 'Yes, tell them') + '</form>';
    if (a.kind === 'link') return head('Link code ' + shortCode(a.code) + ' to ' + it.name + '?') + '<form data-i-form><p class="I_conf">Scanning this code will open ' + esc(it.name) + '.</p>' + actions(a, 'Yes, link it') + '</form>';
    if (a.kind === 'menu') {
      var info = M.itemInfo[it.id], shopRows = (K.shop || []).filter(function (r) { return r.itemId === it.id; }), cover = it.cover != null ? fmt(it.cover) + ' days' : it.coverEst != null ? 'about ' + fmt(it.coverEst) + ' days (an estimate)' : '', lasts = it.cover != null ? fmt(it.cover) : it.coverEst != null ? fmt(it.coverEst) : null;
      var ac = menuActions(it, a), listedQ = shopRows.map(function (r) { return r.qty != null ? uq(r.qty, r.unit || '') : ''; }).filter(Boolean).join(', ');
      // s107 B6: the title and Close stay at the top of the sheet; the level, the one action for this role and the options come before the details
      h = '<div class="F_sheethead I_sh"><h2 class="hd I_sht" id="I_sh_t" tabindex="-1">' + esc(it.name) + '</h2><button class="btn btn-secondary btn-sm F_close" type="button" data-act="close">' + gi('close', 's16') + 'Close</button></div>' +
        '<div class="I_hero">' + photoBlock(it) + '<div class="I_herob"><p class="help I_cat">' + esc(it.category + (it.consumable ? ' · consumable' : '')) + '</p>' +
        '<p class="I_lvline">' + (it.qty == null ? '' : levelBadge(it) + ' ') + esc(amountText(it)) + (lasts != null ? ' · lasts about ' + esc(lasts) + ' days' : '') + '</p>' + updLine(it) +
        (M.denied.shop || !shopRows.length ? '' : '<p class="I_onlist">' + gi('bag', 's16') + ' On the list' + (listedQ ? ', ' + esc(listedQ) : '') + '</p>') + '</div></div>' +
        (a.note || (K.note && K.note.id === it.id) ? '<div class="okbox" role="status"><span>' + esc(a.note || K.note.text) + '</span></div>' : '') + errBox(a) +
        '<div class="I_actbar">' + ac.chosen.map(function (c, n) { return actBtn(c, n === 0 ? 'btn-primary' : 'btn-secondary'); }).join('') + '</div>' + photoRow(it) + lastChange(it) + pendLine(it) + optionsBlock(it) +
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
    if (a.kind === 'update') return renderUpdate(a, it);
    if (UKINDS[a.kind]) return renderUpdForm(a, it);
    var c = a.step === 'confirm';
    if (a.kind === 'shop') {
      var sq = parseQty(v.qty);
      return head(c ? 'Add ' + uq(sq, it.purchaseUnit || unitOf(it)) + ' of ' + it.name + ' to the shopping list?' : 'Add to shopping list: ' + it.name, c ? null : 'The owner will see this request.') + '<form data-i-form>' +
        (c ? (v.note ? '<p class="I_conf">' + esc(v.note) + '</p>' : '') : stepper('qty', 'How many (' + esc(it.purchaseUnit || unitOf(it)) + ')', v.qty, false) + textField('note', 'Note (optional)', v.note || '', 'maxlength="200"') + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter a number such as 1 or 2.</span></div>' : '')) +
        actions(a, c ? 'Yes, add it' : 'Continue') + '</form>';
    }
    if (a.kind === 'price') {
      var pc = String(v.cost || '').trim() === '' ? null : parseQty(v.cost), blind = !canPrice(M.role); // s124: a role without prices types a new one and never sees an amount
      return head(c ? (blind ? 'Save the new price for ' + it.name + '?' : pc == null ? 'Clear the price of ' + it.name + '?' : 'Set the price of ' + it.name + ' to PHP ' + pesoNum(pc) + '?') : 'Change price: ' + it.name, c ? null : 'Enter what one costs.') + '<form data-i-form>' +
        (c ? '<p class="I_conf">Only the owner, admin and finance can see prices.</p>' : (blind ? textField('cost', 'New price each (PHP)', v.cost || '', 'inputmode="decimal"') + '<p class="help">Prices stay private. You will not see the current price.</p>' : textField('cost', 'Price per ' + esc(unitOf(it)) + ' in PHP (leave empty to clear)', v.cost || '', 'inputmode="decimal"')) + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' Enter a number such as 95 or 95.50.</span></div>' : '')) +
        actions(a, c ? 'Yes, save it' : 'Continue') + '</form>';
    }
    if (a.kind === 'levels') {
      return head(c ? 'Save the details for ' + it.name + '?' : 'Edit details: ' + it.name, c ? null : 'Leave a box empty to clear it.') + '<form data-i-form>' +
        (c ? detailsDiff(it, v)
          : textField('name', 'Name', v.name != null ? v.name : it.name, 'maxlength="80" required') + levelsSuggest(a, it) + textField('reorder', 'Reorder at (' + esc(unitOf(it)) + ')', v.reorder || '', 'inputmode="decimal"') + textField('par', 'Buy up to (' + esc(unitOf(it)) + ')', v.par || '', 'inputmode="decimal"') + detailsFields(it, v) + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' ' + esc(a.bad === 'levels' ? ERR.levels : a.bad === 'nochange' ? ERR.nochange : a.bad === 'name' ? 'The name needs 2 to 80 characters.' : 'Enter numbers such as 12 or 2.5.') + '</span></div>' : '')) +
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
    var locs = {}, units = UNITS.slice(), cats = categories(M.role === 'cleaner');
    (K.items || []).forEach(function (i) { if (i.location) locs[i.location] = 1; });
    if (units.indexOf(it.unit) < 0 && it.unit) units.unshift(it.unit);
    if (cats.indexOf(it.category) < 0) cats.unshift(it.category);
    return (K.hasLoc ? '<div class="field"><label for="I_f_location">Kept in (optional)</label><div class="input"><input id="I_f_location" list="I_locs" autocomplete="off" maxlength="60" placeholder="Hall cabinet" value="' + esc(v.location || '') + '"></div><datalist id="I_locs">' + Object.keys(locs).sort().map(function (l) { return '<option value="' + esc(l) + '"></option>'; }).join('') + '</datalist></div>' : '') +
      selectField('unit', 'Unit', units.map(function (u) { return [u, u]; }), v.unit != null ? v.unit : it.unit) + selectField('category', 'Category', cats.map(function (c) { return [c, c]; }), v.category != null ? v.category : it.category);
  }
  // s124: the check step as old -> new rows, only for what changed (the same keys levelsCall sends)
  function detailsDiff(it, v) {
    var p = levelsCall(it, v).args.p_patch, rows = [];
    var one = function (label, oldT, newT) { rows.push('<dt>' + label + '</dt><dd>' + (oldT ? '<s>' + esc(oldT) + '</s> → ' : '') + esc(newT) + '</dd>'); };
    var qo = function (n) { return n == null ? '' : uq(n, it.unit); }, qn = function (n) { return n == null ? 'Not set' : uq(n, p.unit != null ? p.unit : it.unit); };
    if ('name' in p) one('Name', it.name, p.name);
    if ('reorder_below' in p) one('Reorder at', qo(it.reorder), qn(p.reorder_below));
    if ('par_qty' in p) one('Buy up to', qo(it.par), qn(p.par_qty));
    if ('location' in p) one('Kept in', it.location, p.location === '' ? 'Cleared' : p.location);
    if ('unit' in p) one('Unit', it.unit, p.unit);
    if ('category' in p) one('Category', it.category, p.category);
    return '<dl class="I_diff">' + rows.join('') + '</dl>';
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
  function categories(existingOnly) { var c = {}; (K.items || []).forEach(function (i) { c[i.category] = 1; }); if (!existingOnly) c.Miscellaneous = 1; return Object.keys(c).sort(); } // s124: a cleaner may only pick a category already in use

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
  /* ---- s125 Add item (D-386): one sheet for every role that sees Stock. The item is saved at once with a 30 minute Undo; nobody approves it.
     Photo and products go after the item, one call each. A failure of either never undoes the item: the card says what did not save and offers Try again. */
  var NI_LINK = ['shopsuki.ph', 'shopee.ph']; // a product link on a new item: the server takes these two shops only
  var NI_ORDER = ['name', 'category', 'newcat', 'unit', 'qty', 'reorder', 'location', 'p1_name', 'p1_shop', 'p1_link', 'p2_name', 'p2_shop', 'p2_link', 'p3_name', 'p3_shop', 'p3_link'];
  function newItemAct(code, format, mode, q) {
    var mng = canManage(M.role), a = { kind: 'create', step: 'form', code: code || null, format: format || null, mode: mode || null, more: false, blob: null, prev: null, errs: null,
      vals: { name: String(q || '').trim().slice(0, 80), category: mng && catOK() ? CASSY : '', newcat: '', unit: 'pc', cons: 'no', qty: '', reorder: '', location: '', np: 1 } };
    a.v0 = JSON.stringify(a.vals); return a;
  }
  function createDirty(a) { return !!a.blob || JSON.stringify(a.vals) !== a.v0; }
  function dupOf(name) { var t = String(name || '').trim().toLowerCase(); return t ? (K.items || []).filter(function (i) { return i.name.trim().toLowerCase() === t; })[0] || null : null; }
  function dupHtml(a) {
    var d = dupOf(a.vals.name) || (a.err === 'exists' && a.takenId ? itemById(a.takenId) : null);
    if (!d) return a.err === 'exists' ? '<div class="I_dup"><span>An item with that name is already on the list.</span></div>' : '';
    return '<div class="I_dup"><span><b>' + esc(d.name) + '</b> is already on the list. Is it the same?</span><button class="btn btn-secondary btn-sm" type="button" data-act="open-taken" data-id="' + esc(d.id) + '">Open ' + esc(d.name) + '</button></div>';
  }
  function niProds(v) { // the product rows the person started: any of name, shop or link filled in
    var out = [], n, np = Math.max(1, Math.min(3, +v.np || 1));
    for (n = 1; n <= np; n++) { var t = o8T(v['p' + n + '_name']), s = o8T(v['p' + n + '_shop']), l = o8T(v['p' + n + '_link']); if (t || s || l) out.push({ n: n, name: t, shop: s, link: l }); }
    return out;
  }
  function createErrs(a) { // null when the form may go to the check step; else the messages, whether More details must open, and the first field to focus
    var v = a.vals, e = {}, more = false, nm = o8T(v.name), cat = o8T(v.category), un = o8T(v.unit);
    var mark = function (k, msg, inMore) { e[k] = msg; if (inMore) more = true; };
    if (nm.length < 2) mark('name', 'Type a name, at least 2 letters.'); else if (nm.length > 80) mark('name', 'The name can be up to 80 characters.'); else if (dupOf(nm)) mark('name', 'That name is already on the list.');
    if (!cat) mark('category', 'Choose a category.'); else if (cat === NEWCAT) { var nc = o8T(v.newcat); if (!nc) mark('newcat', 'Type the new category.'); else if (nc.length > 60) mark('newcat', 'The category can be up to 60 characters.'); }
    if (!un) mark('unit', 'Choose a unit.'); else if (un.length > 20) mark('unit', 'The unit can be up to 20 characters.');
    if (!optQty(v.qty)) mark('qty', 'Enter a number such as 12 or 2.5.');
    if (!optQty(v.reorder)) mark('reorder', 'Enter a number such as 12 or 2.5.', true);
    if (o8T(v.location).length > 60) mark('location', 'Up to 60 characters.', true);
    if (o8On()) niProds(v).forEach(function (p) {
      var k = 'p' + p.n + '_';
      if (!p.name) mark(k + 'name', 'Type the product name.', true); else if (p.name.length > 160) mark(k + 'name', 'The product name can be up to 160 characters.', true);
      if (!p.shop) mark(k + 'shop', 'Choose a shop.', true);
      if (p.link && !o8Url(p.link, NI_LINK)) mark(k + 'link', 'The link must be from shopsuki.ph or shopee.ph.', true);
    });
    var first = NI_ORDER.filter(function (k) { return k in e; })[0];
    return first ? { errs: e, more: more, first: first } : null;
  }
  function createContinue(a) {
    var r = createErrs(a);
    if (r) { a.errs = r.errs; if (r.more) a.more = true; drawLayer(); refocus('I_f_' + r.first); return; }
    a.errs = null; a.step = 'confirm'; a.err = null; a.focused = false; drawLayer();
  }
  function nf(id, label, val, extra, err, help) {
    var eid = 'I_e_' + id, h = help ? 'I_h_' + id : '', d = [h, err ? eid : ''].filter(Boolean).join(' ');
    return '<div class="field"><label for="I_f_' + id + '">' + label + '</label><div class="input"><input id="I_f_' + id + '" autocomplete="off" ' + (extra || '') + (err ? ' aria-invalid="true"' : '') + (d ? ' aria-describedby="' + d + '"' : '') + ' value="' + esc(val) + '"></div>' +
      (err ? '<p class="err" id="' + eid + '">' + esc(err) + '</p>' : '') + (help ? '<p class="help" id="' + h + '">' + help + '</p>' : '') + '</div>';
  }
  function ns(id, label, opts, val, err) {
    return '<div class="field"><label for="I_f_' + id + '">' + label + '</label><div class="input"><select id="I_f_' + id + '"' + (err ? ' aria-invalid="true" aria-describedby="I_e_' + id + '"' : '') + '>' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>' + (err ? '<p class="err" id="I_e_' + id + '">' + esc(err) + '</p>' : '') + '</div>';
  }
  function niHead(title, close, a) {
    return '<div class="F_sheethead I_sh"><h2 class="hd I_sht" id="I_sh_t" tabindex="-1">' + esc(title) + '</h2>' + (close ? '<button class="btn btn-secondary btn-sm F_close" type="button" data-act="close"' + (a.sending ? ' disabled' : '') + '>' + gi('close', 's16') + 'Close</button>' : '') + '</div>';
  }
  function niCat(v) { var c = o8T(v.category); return c === CASSY ? 'Cassy will choose' : c === NEWCAT ? o8T(v.newcat) + ' (new)' : c; }
  function niProdsHtml(a) {
    if (!o8On()) return '';
    var v = a.vals, er = a.errs || {}, np = Math.max(1, Math.min(3, +v.np || 1)), rows = K.o8sup && K.o8sup.rows, h = '<h3 class="I_hh">Products you buy</h3>', n;
    for (n = 1; n <= np; n++) {
      var k = 'p' + n + '_', shop = rows
        ? ns(k + 'shop', 'Shop', [['', 'Choose a shop']].concat(rows.filter(function (x) { return x.active || x.id === v[k + 'shop']; }).map(function (x) { return [x.id, x.name]; })), v[k + 'shop'] || '', er[k + 'shop'])
        : '<div class="field"><span class="lbl">Shop</span><p class="help">' + (K.o8sup && K.o8sup.bad ? 'The shops could not be loaded. Close this and open it again.' : 'Loading the shops…') + '</p></div>';
      h += '<div class="I_prod">' + nf(k + 'name', 'Product name', v[k + 'name'] || '', 'maxlength="160"', er[k + 'name']) + shop + nf(k + 'link', 'Link (optional)', v[k + 'link'] || '', 'inputmode="url" autocapitalize="off" maxlength="500" placeholder="https://shopsuki.ph/..."', er[k + 'link']) + '</div>';
    }
    return h + (np < 3 ? '<button class="btn btn-secondary btn-block" type="button" data-act="prod-add">' + gi('plus', 's16') + ' Add another product</button>' : '');
  }
  function niDiff(a) {
    var v = a.vals, un = o8T(v.unit), rows = [], r = function (l, h) { rows.push('<dt>' + l + '</dt><dd>' + h + '</dd>'); }, ps = niProds(v);
    if (a.blob) r('Photo', 'Ready');
    r('Category', esc(niCat(v))); r('Unit', esc(un));
    if (o8T(v.qty) !== '') r('Here now', esc(uq(parseQty(v.qty, true), un)));
    if (o8T(v.reorder) !== '') r('Reorder at', esc(uq(parseQty(v.reorder, true), un)));
    if (v.cons === 'yes') r('Consumable', 'Yes');
    if (o8T(v.location)) r('Kept in', esc(o8T(v.location)));
    if (a.code) r('Barcode', esc(a.code));
    if (ps.length) r('Products', ps.map(function (p) { return esc(p.name + ' · ' + o8SupName(p.shop)); }).join('<br>'));
    return '<dl class="I_diff">' + rows.join('') + '</dl>';
  }
  function niErrBox(a) {
    if (!a.err || a.err === 'exists') return '';
    var t = a.err === 'offline' || a.err === 'other' ? 'Could not add it. Nothing was lost. Check the signal and try again.' : ERR[a.err] || ERR.other;
    return '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc(t) + '</span></div>';
  }
  function renderCreate(a) {
    var v = a.vals, er = a.errs || {}, mng = canManage(M.role), nm = o8T(v.name);
    if (a.discard) return niHead('Throw away this new item?', false, a) + '<form data-i-form class="I_form"><p class="I_conf">What you typed will be lost.</p><div class="I_btns"><button class="btn btn-primary btn-block" type="submit">Yes, throw it away</button><button class="btn btn-secondary btn-block" type="button" data-act="back">Keep editing</button></div></form>';
    if (a.step === 'confirm') return niHead('Add ' + nm + '?', false, a) + '<form data-i-form class="I_form">' + niErrBox(a) + niDiff(a) +
      (o8T(v.qty) !== '' ? '<p class="I_conf">Counted now: ' + esc(v.qty) + '. ' + (v.cons === 'yes' ? LEARNS : 'After this, ' + esc(nm) + ' is counted in the app. Telegram /count will skip it.') + '</p>' : '') +
      '<div class="I_btns"><button class="btn btn-primary btn-block" type="submit"' + (a.sending ? ' disabled' : '') + '>' + (a.sending ? 'Adding…' : 'Yes, add it') + '</button><button class="btn btn-secondary btn-block" type="button" data-act="back"' + (a.sending ? ' disabled' : '') + '>Back</button></div></form>';
    var locs = {}, copts = [], units = UNITS.slice();
    (K.items || []).forEach(function (i) { if (i.location) locs[i.location] = 1; if (i.unit && units.indexOf(i.unit) < 0) units.push(i.unit); });
    if (v.unit && units.indexOf(v.unit) < 0) units.push(v.unit);
    copts.push(mng && catOK() ? [CASSY, 'Let Cassy choose'] : ['', 'Choose a category']);
    categories(!mng).forEach(function (c) { copts.push([c, c]); });
    if (mng) copts.push([NEWCAT, 'New category…']);
    var has = !!a.blob, photo = '<div class="I_photorow" role="group" aria-labelledby="I_photolead">' + (a.prev ? '<div class="I_photo I_ph96"><img src="' + esc(a.prev) + '" alt="Preview of the new photo"></div>' : '') + '<p class="I_photolead" id="I_photolead">' + (has ? 'Photo ready' : 'Add photo (optional)') + '</p><div class="I_grid2">' +
      '<label class="btn btn-secondary btn-block I_filebtn">' + gi('camera', 's16') + (has ? 'Retake' : 'Take a photo') + '<input class="sr" id="I_np_in" type="file" accept="image/*" capture="environment" aria-label="' + (has ? 'Retake the photo with the camera' : 'Take a photo with the camera') + '"></label>' +
      '<label class="btn btn-secondary btn-block I_filebtn">' + gi('image', 's16') + (has ? 'Choose another' : 'Choose a photo') + '<input class="sr" id="I_np_pick" type="file" accept="image/*" aria-label="' + (has ? 'Choose another photo from your phone' : 'Choose a photo from your phone') + '"></label></div>' +
      (a.photoErr ? '<p class="err" role="alert">' + esc(ERR[a.photoErr] || ERR.photofail) + '</p>' : '') + '</div>';
    return niHead('New item', true, a) + '<form data-i-form class="I_form" novalidate>' + niErrBox(a) + photo +
      nf('name', 'Name', v.name, 'maxlength="80" required aria-required="true"', er.name, null) + '<div id="I_dup" role="status">' + dupHtml(a) + '</div>' +
      ns('category', 'Category', copts, v.category || '', er.category) + (v.category === NEWCAT ? nf('newcat', 'New category name', v.newcat || '', 'maxlength="60"', er.newcat) : '') +
      ns('unit', 'Unit', units.map(function (u) { return [u, u]; }), v.unit || '', er.unit) +
      nf('qty', 'How many are here now? (optional)', v.qty || '', 'inputmode="decimal"', er.qty) +
      '<details class="I_det"' + (a.more ? ' open' : '') + '><summary data-act="more-toggle">More details (optional)</summary><div class="I_form">' +
      nf('reorder', 'Reorder at', v.reorder || '', 'inputmode="decimal"', er.reorder, 'It shows Low at this number.') +
      (K.hasLoc ? nf('location', 'Kept in', v.location || '', 'list="I_locs" maxlength="60" placeholder="Hall cabinet"', er.location) + '<datalist id="I_locs">' + Object.keys(locs).sort().map(function (l) { return '<option value="' + esc(l) + '"></option>'; }).join('') + '</datalist>' : '') +
      ns('cons', 'Is it a consumable?', [['no', 'No'], ['yes', 'Yes']], v.cons || 'no') + niProdsHtml(a) + '</div></details>' +
      '<div class="I_btns"><button class="btn btn-primary btn-block" type="submit">Continue</button></div></form>';
  }
  function niProvisional(id, a) {
    var v = a.vals, cat = o8T(v.category);
    return normalize({ id: id, name: o8T(v.name), category: cat === CASSY ? UNCAT : cat === NEWCAT ? o8T(v.newcat) : cat, unit: o8T(v.unit) || 'pc', qty: o8T(v.qty) === '' ? null : parseQty(v.qty, true), reorderBelow: o8T(v.reorder) === '' ? null : parseQty(v.reorder, true),
      consumable: v.cons === 'yes', active: true, location: o8T(v.location), codes: a.code ? [a.code] : [], updatedKind: 'created' }, M.role);
  }
  // After the create landed: the item is on the list, its card opens, then photo and products go up one call each.
  function createOpen(a, id) {
    var me = M, nm = o8T(a.vals.name);
    if (!itemById(id)) K.items = (K.items || []).concat([niProvisional(id, a)]);
    K.pend[id] = { name: nm, blob: a.blob || null, photoDone: !a.blob, busy: false, prods: niProds(a.vals).map(function (p) {
      var pl = { title: p.name, supplier_id: p.shop, available: true }; if (p.link) pl.source_url = o8Url(p.link, NI_LINK);
      return { payload: pl, key: newKey('opt', a.key + '-p' + p.n), done: false };
    }) };
    relPrev(a); a.prev = null; a.dirtyOK = true;
    K.note = { id: id, text: nm + ' added.' }; // the shell re-mounts on the route change, so the note lives in K until the card closes
    go('#stock/item/' + id, 'item/' + id, id);
    addFollow(id);
  }
  // Photo, then each product, one call each; whatever fails stays in K.pend[id] for Try again. Never rejects.
  function addFollow(id) {
    var me = M, p = K.pend[id]; if (!me || !p || p.busy) return Promise.resolve();
    p.busy = true; var card = function () { if (M === me && M.act && M.act.itemId === id) drawLayer(); }; card();
    var chain = Promise.resolve();
    if (!p.photoDone && p.blob) chain = chain.then(function () {
      var pa = { blob: p.blob, itemId: id };
      return uploadAndSet(pa).then(function (r) { if (r && r.error) throw r.error; if (r && r.data && r.data.ok === false) throw 0; p.photoDone = true; p.blob = null; var i0 = itemById(id); if (i0 && pa.newPath) i0.photo = pa.newPath; });
    }).then(null, function () { /* the card offers Try again */ });
    p.prods.forEach(function (pr) {
      chain = chain.then(function () {
        if (pr.done) return;
        return Promise.resolve().then(function () { return me.client.rpc('inventory_option_request_v1', { p_item_id: id, p_action: 'add', p_option_id: null, p_payload: pr.payload, p_note: null, p_idempotency_key: pr.key }); }).then(function (r) {
          if (r && r.error) throw r.error; if (r && r.data && r.data.ok === false) throw 0; pr.done = true;
        });
      }).then(null, function () { /* the card offers Try again */ });
    });
    return chain.then(function () {
      p.busy = false;
      if (p.prods.some(function (x) { return x.done; })) { delete K.opt[id]; K.usual = null; K.usualAt = 0; if (M === me) { loadOptions(id); o8Reqs(true); } }
      if (p.photoDone && p.prods.every(function (x) { return x.done; })) delete K.pend[id];
      card();
    });
  }
  function pendLine(it) {
    var p = K.pend[it.id]; if (!p) return '';
    var w = [], np = p.prods.filter(function (x) { return !x.done; }).length;
    if (!p.photoDone) w.push('the photo did not upload'); if (np) w.push(np === 1 ? 'a product did not save' : np + ' products did not save');
    if (!w.length) return '';
    return '<p class="help I_last" role="status">' + esc(p.name) + ' was added, but ' + esc(w.join(' and ')) + '. <button class="btn btn-ghost I_undobtn" type="button" data-act="add-retry" data-id="' + esc(it.id) + '"' + (p.busy ? ' disabled' : '') + '>' + gi('refresh', 's16') + ' Try again</button></p>';
  }
  function newPhoto(ev) {
    var t = ev.target, f = t && t.files && t.files[0], me = M, a = me && me.act; if (!f || !a || a.kind !== 'create' || a.sending) return;
    Promise.resolve().then(function () { return resizePhoto(f); }).then(function (b) {
      if (M !== me || me.act !== a) return;
      relPrev(a); a.blob = b; a.prev = root.URL && root.URL.createObjectURL ? root.URL.createObjectURL(b) : null; a.photoErr = null; drawLayer(); refocus('I_np_pick');
    }, function (e) { if (M !== me || me.act !== a) return; a.photoErr = e && e.photo || 'photofail'; drawLayer(); });
    try { t.value = ''; } catch (x) { /* the same file can be chosen again */ }
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
    if (!listed && allowed('low', it)) add('low', canManage(m) ? 'Add to list' : level(it) === 'out' ? 'It is out' : 'Running low');
    if (allowed('update')) add('update', 'Update');
    if (!allowed('update') && allowed('count')) add('count', 'Count it');
    if (!allowed('update') && allowed('used')) add('used', 'Record use');
    if (allowed('levels')) add('levels', 'Edit details');
    if (allowed('price')) add('price', 'Change price');
    if (!allowed('update') && allowed('recv', it)) add('recv', 'Stock received');
    if (allowed('link')) add('link', 'Link a barcode', 'begin-link');
    if (!listed && allowed('shop')) add('shop', 'Add to shopping list');
    if (it.photo && allowed('photo')) add('photorem', 'Remove photo', 'photo-remove');
    if (canManage(m) && supOK() && root.I_Suppliers.openItemSuppliers) add('itemsup', 'Suppliers for this item', 'item-sup');
    if (allowed('history')) { add('history', 'History', 'history-open'); all.history.wide = true; }
    var pri = allowed('update') ? ['update', 'low', 'shop'] : canManage(m) ? (lv !== 'ok' ? ['low', 'count', 'recv'] : ['count', 'recv', 'low']) : allowed('used') ? ['used', 'low', 'count'] : canPrice(m) ? ['price', 'low', 'shop'] : ['low', 'count', 'shop'];
    if (a && a.scanned && !allowed('update')) pri.unshift(canManage(m) ? 'count' : canPrice(m) ? 'price' : 'low');
    var chosen = [];
    pri.forEach(function (k) { if (all[k] && chosen.indexOf(k) < 0 && chosen.length < 3) chosen.push(k); });
    if (!chosen.length) order.some(function (k) { if (!all[k].file) { chosen.push(k); return true; } return false; });
    return { chosen: chosen.map(function (k) { return all[k]; }), rest: order.filter(function (k) { return chosen.indexOf(k) < 0; }).map(function (k) { return all[k]; }) };
  }
  // s116 lane B: the photo row sits under the main buttons, camera and gallery side by side (the gallery input has no capture, so the phone offers stored photos).
  function photoRow(it) {
    if (!allowed('photo')) return '';
    var has = !!it.photo, lead = has ? 'Change photo' : 'Add photo';
    return '<div class="I_photorow" role="group" aria-labelledby="I_photolead"><p class="I_photolead" id="I_photolead">' + lead + '</p><div class="I_grid2">' +
      '<label class="btn btn-secondary btn-block I_filebtn">' + gi('camera', 's16') + (has ? 'Retake' : 'Take a photo') + '<input class="sr" id="I_photo_in" type="file" accept="image/*" capture="environment" aria-label="' + (has ? 'Retake the photo with the camera' : 'Take a photo with the camera') + '"></label>' +
      '<label class="btn btn-secondary btn-block I_filebtn">' + gi('image', 's16') + (has ? 'Choose another' : 'Choose a photo') + '<input class="sr" id="I_photo_pick" type="file" accept="image/*" aria-label="' + (has ? 'Choose another photo from your phone' : 'Choose a photo from your phone') + '"></label></div></div>';
  }
  function actBtn(c, cls) {
    return '<button class="btn ' + cls + (c.wide ? ' I_wide' : '') + ' btn-block" type="button" data-act="' + c.act + '" data-kind="' + c.kind + '">' + c.text + '</button>';
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
      (r.status === 'approved' && r.itemId && canManage(M.role) && allowed('recv', itemById(r.itemId)) ? '<button class="btn btn-primary btn-block" type="button" data-act="shop-bought">Mark bought</button>' : '') +
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
    if (act === 'add-retry') { var rid = attr(t, 'data-id'); if (K.pend[rid]) addFollow(rid); return; }
    if (act === 'open') return go('#stock/item/' + attr(t, 'data-id'), 'item/' + attr(t, 'data-id'), attr(t, 'data-id'));
    if (act === 'shop-open') { if (!canManage(M.role)) return; M.act = { kind: 'menu', shopId: attr(t, 'data-id') }; drawLayer(); return; }
    if (act === 'add-new') { if (!allowed('create') || (M.act && M.act.sending)) return; M.act = newItemAct(null, null, null, K.q); drawLayer(); o8Sups(); return; }
    var a = M.act;
    if (act === 'close') return closeSheet();
    if (act === 'undo') { var ue = undoById(attr(t, 'data-id')); if (!ue || (a && a.sending) || K.denied[ue.call.fn]) return; M.act = { kind: 'undo', entry: ue, step: 'confirm' }; drawLayer(); return; }
    if (act.indexOf('o8-') === 0 || (a && act === 'back' && /^o8/.test(a.kind))) return o8Click(act, t, a);
    if (!a) return;
    if (a.sending) return; // nothing, not even Close, while a write is in flight
    if (act === 'al-tick') { if (a.kind !== 'addlow') return; var tl = a.lines.filter(function (l) { return l.itemId === attr(t, 'data-id'); })[0]; if (tl && !tl.ok) { tl.on = !tl.on; if (!tl.on) tl.fail = false; a.bad = false; drawLayer(); } return; }
    if (act === 'more-toggle') { if (a.kind === 'create') a.more = !a.more; return; } // the browser opens or closes the details itself; this keeps the state for a redraw
    if (act === 'prod-add') { if (a.kind === 'create') { a.vals.np = Math.min(3, (+a.vals.np || 1) + 1); a.more = true; drawLayer(); refocus('I_f_p' + a.vals.np + '_name'); } return; }
    if (act === 'begin') return begin(attr(t, 'data-kind'));
    if (act === 'upd-pick') { if (a.kind === 'update') begin(attr(t, 'data-kind'), true); return; }
    if (act === 'upd-set') { if (UKINDS[a.kind]) { a.vals[attr(t, 'data-f')] = attr(t, 'data-v'); a.err = null; a.bad = false; a.focused = true; drawLayer(); } return; }
    if (act === 'upd-sw') { if (UKINDS[a.kind]) { var sf = attr(t, 'data-f'); a.vals[sf] = a.vals[sf] === 'yes' || (sf === 'list' && a.vals[sf] !== 'no') ? 'no' : 'yes'; a.err = null; a.focused = true; drawLayer(); } return; }
    if (act === 'upd-note') { if (UKINDS[a.kind]) { var nv = attr(t, 'data-v'); a.vals.note = a.vals.note === nv ? '' : nv; if (a.kind === 'brk' && nv === 'Guest broke it') a.vals.stay = a.vals.note === nv ? 'yes' : 'no'; a.err = null; a.focused = true; drawLayer(); } return; }
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
    if (act === 'history-open') { if ((a.kind !== 'menu' && a.kind !== 'update') || !a.itemId || !allowed('history')) return; var ha = M.act = { kind: 'history', itemId: a.itemId, state: 'loading' }; drawLayer(); fetchHistory(a.itemId, function (d) { if (!M || M.act !== ha) return; if (d) { ha.state = 'ok'; ha.data = d; } else if (K.denied.inventory_item_history_v1) { M.act = newMenu(ha.itemId); toast(ERR.missing); } else ha.state = 'err'; drawLayer(); }); return; }
    if (act === 'use-sugg') { if (a.kind === 'levels' && a.sugg) { a.vals.par = String(a.sugg); a.err = null; a.bad = false; a.focused = false; drawLayer(); } return; }
    if (act === 'begin-link') { if (allowed('link') && a.itemId) openScan(a.itemId); return; }
    if (act === 'cam-start') { startCam(); return; }
    if (act === 'open-taken') { var tid = attr(t, 'data-id'); stopCam(); K.scanned = tid; return go('#stock/item/' + tid, 'item/' + tid, tid); }
    if (act === 'scan-pick') { if (allowed('link')) { a.phase = 'pick'; a.vals = { find: '' }; a.focused = false; drawLayer(); } return; }
    if (act === 'scan-new') { if (allowed('create') && canManage(M.role)) { M.act = newItemAct(a.code, a.format, a.mode); drawLayer(); o8Sups(); } return; }
    if (act === 'pick') { if (a.phase !== 'pick' || !allowed('link')) return; M.act = { kind: 'link', step: 'confirm', pickId: attr(t, 'data-id'), code: a.code, format: a.format, mode: a.mode, fromPick: true }; drawLayer(); return; }
    if (act === 'rep-kind') { a.vals.rkind = attr(t, 'data-k'); a.bad = false; drawLayer(); return; }
    if (act === 'rep-to') { a.vals.to = attr(t, 'data-to') === 'finance' && canPrice(M.role) && !K.noFinance ? 'finance' : 'ops'; a.bad = false; drawLayer(); return; }
    if (act === 'back') { if (a.upd && UKINDS[a.kind]) { relPrev(a); a.blob = null; a.upPath = null; a.kind = 'update'; a.vals = null; a.step = null; a.err = null; a.bad = false; a.focused = false; drawLayer(); return; } if (/^(scan|link|create|report|undo|bought|unlink|history|photo|photoremove|optusual|cconfirm|labels|tidy|rename|sort|addlow|copytext)$/.test(a.kind)) return flowBack(a); if (a.kind === 'shopset') { a.kind = 'menu'; a.step = null; a.err = null; drawLayer(); } else if (a.fromShop && a.step !== 'confirm') { M.act = null; drawLayer(); } else if (a.step === 'confirm' && a.kind !== 'low') { a.step = 'form'; a.err = null; drawLayer(); } else if (a.shopId) { a.kind = 'menu'; a.err = null; drawLayer(); } else { a.kind = 'menu'; a.vals = null; a.step = null; a.err = null; a.bad = false; drawLayer(); } return; }
    if (act === 'step') { a.vals = a.vals || {}; var f = attr(t, 'data-f'); a.vals[f] = stepQty(a.vals[f], +attr(t, 'data-d'), attr(t, 'data-z') === '1'); a.err = null; a.bad = false; if (a.kind === 'count') { var sit = itemOf(a); a.chg = !!sit && countChanged(a, sit); } drawLayer(); var nb = q('[data-act="step"][data-f="' + f + '"][data-d="' + attr(t, 'data-d') + '"]'); if (nb && nb.focus) nb.focus(); return; }
    if (act === 'shop-bought') { var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!r || !r.itemId || !canManage(M.role) || !allowed('recv', itemById(r.itemId))) return; M.act = { kind: 'recv', itemId: r.itemId, step: 'form', vals: { packs: fmt(r.qty || 1), supplier: K.sup ? K.sup.name : '', supplierId: K.sup && K.sup.id || '', cost: '', shopId: r.id }, fromShop: true }; drawLayer(); return; }
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
    var ca = M.act; // s125: Close is the only exit of the Add item sheet and asks before it throws typed input away
    if (ca && ca.kind === 'create' && !ca.dirtyOK) { if (ca.discard) { ca.discard = false; ca.focused = false; drawLayer(); return; } if (createDirty(ca)) { ca.discard = true; ca.focused = false; drawLayer(); return; } }
    relPrev(M.act);
    stopCam(); K.scanned = null; K.quick = null; K.note = null;
    var id = M.act && M.act.itemId, wsaved = 0;
    if (M.act && M.act.kind === 'walk' && M.act.step !== 'summary') { wsaved = Object.keys(M.act.saved).length; if (wsaved) toast(wsaved + (wsaved === 1 ? ' item saved' : ' items saved') + '. The rest were not changed.'); }
    M.act = null;
    if (route().itemId) { M.sub = ''; if (M.opts.navigate) M.opts.navigate('#stock'); }
    if (M) { drawLayer(); if (id) { var b = q('[data-id="' + id + '"]'); if (b && b.focus) b.focus(); } if (wsaved) load(); }
  }
  function allowed(kind, it) {
    var m = M.role;
    if (kind === 'count') return I_FLAGS.count && canCount(m) && !M.denied.count;
    if (kind === 'update') return canUpdate(m) && !M.denied.update;
    if (kind === 'used') return I_FLAGS.usage && canUse(m) && !M.denied.used;
    if (kind === 'brk') return canUpdate(m) && !M.denied.brk && !(it && (it.consumable || isLinen(it)));
    if (kind === 'lin') return canUpdate(m) && !M.denied.lin && !(it && (it.consumable || !isLinen(it)));
    if (kind === 'recv') return canUpdate(m) && !M.denied.recv; // controlled items too since 1b: record_inventory_receipt_v1 writes their movement
    if (kind === 'bought') return canManage(m) && !M.denied.bought && K.shop && K.shop.length > 0;
    if (kind === 'addlow') return canManage(m) && !M.denied.shop && !!K.items && !!K.shop; // owner and admin only, like the other shopping row actions
    if (kind === 'shop') return !M.denied.shop;
    if (kind === 'low') return !M.denied.low && !M.denied.shop && !(it && (K.shop || []).some(function (r) { return r.itemId === it.id; }));
    if (kind === 'price') return K.v84 && (canPrice(m) || m === 'cleaner') && !M.denied.price;
    if (kind === 'levels') return K.v84 && canEdit(m) && !M.denied.levels;
    if (kind === 'link') return K.v84 && canManage(m) && !M.denied.link;
    if (kind === 'history') return K.v84 && !M.demo && !K.denied.inventory_item_history_v1;
    if (kind === 'unlink') return K.v84 && canManage(m) && !M.denied.unlink;
    if (kind === 'create') return (canManage(m) || m === 'cleaner' || m === 'inspector') && K.v84 && !M.denied.create && !!K.items; // s125: every role that sees Stock; the server decides (a refusal hides the button for the visit)
    if (kind === 'report') return !M.denied.report;
    if (kind === 'optusual') return canManage(m) && !M.denied.optusual;
    if (kind === 'photo') return !M.denied.photo; // every role (D-330 answer 1); the server decides
    if (kind === 'labels') return canManage(m) && !M.denied.labels && !!K.items;
    if (kind === 'sort') return canManage(m) && !M.denied.sort && !M.denied.cat;
    if (kind === 'tidy') return canManage(m) && !!K.items && !(M.denied.rename && (M.denied.sort || M.denied.cat));
    return false;
  }
  function begin(kind, fromUpd) {
    if (!allowed(kind, itemById(M.act.itemId))) return;
    var a = M.act, it = itemById(a.itemId), defaults = { update: {}, count: { qty: it && it.qty != null ? fmt(it.qty) : '0', note: '' }, used: { qty: '1', note: '' }, brk: { what: 'broken', qty: '1', note: '', stay: 'no', list: 'yes' }, lin: { what: 'stained', qty: '1', now: 'cleaned', note: '' },
      recv: { packs: '1', total: '', date: '', note: '', supplier: K.sup ? K.sup.name : '', supplierId: K.sup && K.sup.id || '', shopId: a.shopId || '' }, shop: { qty: '1', note: '' },
      low: {}, price: { cost: it && it.cost != null && canPrice(M.role) ? fmt(it.cost) : '' }, levels: { name: it ? it.name : '', reorder: it && it.reorder != null ? fmt(it.reorder) : '', par: it && it.par != null ? fmt(it.par) : '', location: it ? it.location : '', unit: it ? it.unit : '', category: it ? it.category : '' } };
    relPrev(a); a.blob = null; a.upPath = null; a.photoErr = null; a.chg = false; a.upd = !!fromUpd;
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
      if (UKINDS[M.act.kind]) { // s132: a typed number moves the picture and the Save words, and a changed count asks why
        if (M.act.kind === 'count' && id === 'I_f_qty') { var cit = itemOf(M.act), ch = !!cit && countChanged(M.act, cit); if (ch !== !!M.act.chg) { M.act.chg = ch; drawLayer(); refocus('I_f_qty'); return; } }
        if (id === 'I_f_qty' || id === 'I_f_packs') updLive(M.act);
      }
      if (id === 'I_f_find') { drawLayer(); refocus(id); } // the pick list follows what is typed
      if (M.act.kind === 'create') {
        if (M.act.errs) delete M.act.errs[id.slice(4)];
        if (id === 'I_f_name') { var dn = q('#I_dup'); if (dn) dn.innerHTML = dupHtml(M.act); }
        if (id === 'I_f_cons') M.act.consTouched = true;
        if ((id === 'I_f_category' || id === 'I_f_newcat') && !M.act.consTouched && GROUP_CONS[String(ev.target.value).trim()] != null) M.act.vals.cons = GROUP_CONS[String(ev.target.value).trim()]; // s132: a utensil or appliance starts as lasting, kitchen supplies as used up
        if (id === 'I_f_category' || (id === 'I_f_newcat' && GROUP_CONS[String(ev.target.value).trim()] != null)) { drawLayer(); refocus(id); }
      }
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
    if (a.kind === 'used' || a.kind === 'shop') return parseQty(v.qty) != null && String(v.note || '').length <= 200;
    if (a.kind === 'brk' || a.kind === 'lin') return wholeQty(v.qty) != null && String(v.note || '').length <= 200;
    if (a.kind === 'recv') return parseQty(v.packs) != null && (String(v.total || '').trim() === '' || parseQty(v.total, true) != null) && (String(v.cost || '').trim() === '' || parseQty(v.cost) != null) && (!v.date || /^\d{4}-\d{2}-\d{2}$/.test(String(v.date))) && String(v.note || '').length <= 200;
    if (a.kind === 'price') return String(v.cost || '').trim() === '' ? canPrice(M.role) : parseQty(v.cost) != null; // blind: the cleaner cannot clear a price
    if (a.kind === 'levels') return (!('name' in v) || (String(v.name || '').trim().length >= 2 && String(v.name).trim().length <= 80)) && optQty(v.reorder) && optQty(v.par) && !(String(v.reorder || '').trim() !== '' && String(v.par || '').trim() !== '' && parseQty(v.par, true) < parseQty(v.reorder, true)) &&
      (!('location' in v) || String(v.location || '').trim().length <= 60) && (!('unit' in v) || (String(v.unit || '').trim() !== '' && String(v.unit).trim().length <= 20)) && (!('category' in v) || String(v.category || '').trim() !== '') && !!itemOf(a) && Object.keys(levelsCall(itemOf(a), v).args.p_patch).length > 0;
    if (a.kind === 'rename') { var to = String(v.to || '').trim(); return to.length >= 1 && to.length <= 60 && to !== a.from; }
    if (a.kind === 'labels') return labelIds(a).length > 0;
    if (a.kind === 'create') { var nm = String(v.name || '').trim(); return nm.length >= 2 && nm.length <= 80 && String(v.category || '').trim() !== '' && String(v.unit || '').trim().length <= 20 && optQty(v.qty) && optQty(v.reorder); }
    if (a.kind === 'report') return coolLeft(v) === 0;
    return true;
  }
  // s124: which message the Edit details form shows: the Buy up to rule, the name length, or nothing changed
  function levelsBad(a) {
    var v = a.vals, it = itemOf(a), nm = String(v.name || '').trim();
    if (optQty(v.reorder) && optQty(v.par) && String(v.reorder || '').trim() !== '' && String(v.par || '').trim() !== '' && parseQty(v.par, true) < parseQty(v.reorder, true)) return 'levels';
    if ('name' in v && (nm.length < 2 || nm.length > 80)) return 'name';
    if (it && optQty(v.reorder) && optQty(v.par) && !Object.keys(levelsCall(it, v).args.p_patch).length) return 'nochange';
    return true;
  }
  function goneErr(a) { return a.err === 'tooLate' || a.err === 'changeGone' || a.err === 'changedSince' || a.err === 'createStays' || a.err === 'createLate' || a.err === 'createGone' || (a.kind === 'undo' && a.err === 'exists' && !!(a.entry && a.entry.change)); } // the Undo can no longer happen: the button becomes Close
  function onSubmit(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var a = M && M.act; if (!a || a.sending || a.kind === 'menu') return;
    if (a.kind === 'create' && a.discard) { a.dirtyOK = true; return closeSheet(); }
    if (a.kind === 'undo' && goneErr(a)) return closeSheet();
    if (a.kind === 'cconfirm') return cconfirmDone(a, true);
    if (/^o8/.test(a.kind)) return o8Submit(a);
    if (a.kind === 'tidy' || (a.kind === 'photo' && a.step !== 'confirm')) return;
    if (a.kind === 'walk') return walkSubmit(a);
    if (a.kind === 'bought') return boughtSubmit(a);
    if (a.kind === 'addlow') return addLowSubmit(a);
    if (a.kind === 'copytext') return closeSheet();
    if (a.kind === 'scan') { if (a.phase === 'look') handleCode((a.vals || {}).code, null); return; }
    if (a.kind === 'create' && a.step !== 'confirm') return createContinue(a);
    if (UKINDS[a.kind]) { if (!valid(a)) { a.bad = true; drawLayer(); return; } a.bad = false; return commit(a); } // s132: the Update forms save in one tap; the button says what happens and Undo takes it back
    if (a.step !== 'confirm') { if (!valid(a)) { a.bad = a.kind === 'levels' ? levelsBad(a) : true; drawLayer(); return; } a.bad = false; a.step = 'confirm'; a.err = null; a.focused = false; drawLayer(); return; }
    commit(a);
  }

  /* ---- the write */
  function build(a) {
    var it = itemOf(a), today = manilaToday(nowMs()), sig = JSON.stringify([a.kind, a.itemId || a.pickId || a.shopId, a.vals, a.status, a.code, a.entry && a.entry.id]);
    var ke = K.keys[sig]; // one key per set of values, kept even if the sheet is reopened; dropped on success; forgotten after 10 minutes (a write that landed unseen must not replay a later identical one)
    if (!ke || nowMs() - ke.at > 600000) ke = K.keys[sig] = { key: newKey(a.kind), at: nowMs() };
    a.sig = sig; a.key = ke.key;
    if (a.kind === 'count') return countCall(it, a.vals, a.key, 'Recount');
    if (a.kind === 'used') return usageCall(M.pid, it, a.vals, a.key, today);
    if (a.kind === 'brk') return { exec: function () { return updExec(a, function (path) { return damageCall(M.pid, it, a.vals, a.key, path, bookingNow()); }); } };
    if (a.kind === 'lin') return { exec: function () { return updExec(a, function (path) { return linenCall(M.pid, it, a.vals, a.key, path, today); }); } };
    if (a.kind === 'recv') return a.blob ? { exec: function () { return updExec(a, function (path) { return boughtCall(it, a.vals, a.key, today, path); }); } } : boughtCall(it, a.vals, a.key, today, null);
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
  var DONE = { count: function (it) { return 'Counted. ' + it.name + ' is saved.'; }, used: function () { return 'Logged. Thank you.'; }, recv: function (it) { return 'Stock received for ' + it.name + '.'; }, brk: function (it, a) { return (a.vals.what === 'missing' ? 'Marked missing: ' : 'Marked broken: ') + it.name + '.'; }, lin: function (it) { return 'Saved for ' + it.name + '. Thank you.'; }, shop: function () { return 'Added to the shopping list.'; }, shopset: function (it, a) { return a.status === 'approved' ? 'Approved.' : 'Removed from the list.'; },
    undo: function () { return 'Undone.'; }, unlink: function () { return 'Unlinked.'; }, low: function () { return 'Passed on. Thank you.'; }, link: function (it) { return 'Linked. Scanning it now opens ' + it.name + '.'; }, price: function (it) { return 'Price saved for ' + it.name + '.'; }, levels: function (it, a) { var p = levelsCall(it, a.vals || {}).args.p_patch, det = Object.keys(p).some(function (k) { return k !== 'reorder_below' && k !== 'par_qty'; }); return (det ? 'Details' : 'Levels') + ' saved for ' + (p.name || it.name) + '.'; },
    create: function (it, a) { return 'Added ' + String(a.vals.name).trim() + '.'; }, report: function (it, a) { return 'Sent to the ' + (a.vals.to === 'finance' ? 'Finance' : 'OPS') + ' group.'; },
    photo: function (it) { return 'Photo saved for ' + it.name + '.'; }, photoremove: function (it) { return 'Photo removed from ' + it.name + '.'; }, optusual: function (it) { return 'Usual option saved for ' + it.name + '.'; }, labels: function () { return 'Label sheet sent to the Finance group.'; },
    rename: function (it, a) { var n = (a.res && a.res.moved || []).length; return 'Moved ' + n + (n === 1 ? ' item' : ' items') + ' into ' + (mergeTarget(a.from, a.vals.to) || String(a.vals.to).trim()) + '.'; },
    sort: function (it, a) { var n = (a.res && a.res.results || []).length, more = a.res && a.res.remaining > 0 ? ' ' + a.res.remaining + ' more are waiting. Sort again in a moment.' : ''; return (n ? 'Cassy sorted ' + n + (n === 1 ? ' item.' : ' items.') : 'Nothing was moved. Anything Cassy was unsure about stays in Uncategorised.') + more; } };
  function bodyOf(e) { try { return e && e.context && typeof e.context.json === 'function' ? Promise.resolve(e.context.json()).catch(function () { return null; }) : null; } catch (x) { return null; } }
  var NEWK = { used: 1, brk: 1, lin: 1, unlink: 1, low: 1, link: 1, price: 1, levels: 1, create: 1, report: 1, undo: 1, photo: 1, photoremove: 1, optusual: 1, labels: 1, rename: 1, sort: 1 }; // actions that hide for the visit when the server says "not here"
  function commit(a) {
    var me = M, it = itemOf(a) || { name: a.rowName || (a.entry && a.entry.name) || '' }, call = build(a), rep = a.kind === 'report', snap = it && { name: it.name, qty: it.qty, cost: it.cost, reorder: it.reorder, par: it.par, controlled: it.controlled, learns: it.consumable && it.active, location: it.location, unit: it.unit, category: it.category, photo: it.photo };
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
      if (r && r.data && (r.data.ok === false || r.data.error) && !(a.kind === 'undo' && !a.entry.change && !a.entry.v2 && r.data.reason === 'not_found')) throw { message: 'failed', data: r.data };
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
      if (a.kind === 'undo' && a.entry.kind === 'create') { K.items = (K.items || []).filter(function (i) { return i.id !== a.entry.itemId; }); delete K.pend[a.entry.itemId]; }
      if (a.kind === 'create' && a.res.item_id) { createOpen(a, String(a.res.item_id)); load(); return; }
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
    if (why === 'item_not_found' && !UKINDS[a.kind]) { a.err = 'other'; return drawLayer(); }
    if (why === 'code_taken') { a.err = 'taken'; a.takenId = body.item_id || null; a.takenName = body.item_name || (itemById(body.item_id) || {}).name || ''; return drawLayer(); }
    if (why === 'name_exists' && a.kind === 'create' && a.lost && body.item_id) { delete K.keys[a.sig]; a.res = {}; createOpen(a, String(body.item_id)); load(); return; } // A4: our own earlier send landed and its answer was lost: the item is added, no Undo line
    if (why === 'name_exists') { if (a.kind === 'create') { a.step = 'form'; a.focused = false; } a.err = 'exists'; a.takenId = body.item_id || null; a.takenName = (itemById(body.item_id) || {}).name || ''; return drawLayer(); }
    if (why === 'bad_code') { a.err = 'badcode'; return drawLayer(); }
    if (a.kind === 'undo' && a.entry.kind === 'create' && a.entry.change && (why === 'too_late' || why === 'changed_since' || why === 'already_undone' || why === 'not_found' || why === 'not_yours' || why === 'stock_moved')) { a.err = why === 'changed_since' ? 'createStays' : why === 'already_undone' || why === 'not_found' ? 'createGone' : 'createLate'; K.undos = K.undos.filter(function (u) { return u !== a.entry; }); return drawLayer(); }
    if (a.kind === 'undo' && (why === 'too_late' || why === 'not_yours' || why === 'stock_moved' || (a.entry.v2 && (why === 'not_allowed' || why === 'already_undone' || why === 'not_found')) || (a.entry.change && (why === 'already_undone' || why === 'not_found' || why === 'changed_since')))) { a.err = why === 'changed_since' ? 'changedSince' : a.entry.change && why !== 'not_yours' && why !== 'stock_moved' ? 'changeGone' : 'tooLate'; K.undos = K.undos.filter(function (u) { return u !== a.entry; }); return drawLayer(); }
    if (why === 'finance_only') { K.noFinance = true; a.vals.to = 'ops'; a.step = 'form'; a.err = 'financeOnly'; return drawLayer(); }
    a.err = UKINDS[a.kind] && UWORDS[why] ? UWORDS[why] : errKind(e, online()); // s132: the server's plain refusal reasons
    if (a.kind === 'create' && (a.err === 'offline' || (a.err === 'other' && !why && !(e && (e.code || e.status || (e.context && e.context.status)))))) a.lost = true; // A4: only a lost answer (no network, or no server answer at all) may replay as already added; a 4xx or any server answer never does
    var dk = a.kind === 'undo' ? a.entry.call.fn : a.kind === 'photoremove' ? 'photo' : a.kind;
    if (a.err === 'missing' && NEWK[a.kind]) { me.denied[dk] = true; if (a.kind === 'sort') me.denied.cat = true; if (a.itemId && !rep && a.kind !== 'create') { a.kind = a.upd ? 'update' : 'menu'; a.vals = null; a.step = null; } else me.act = null; a.err = null; toast(ERR.missing); if (rep || !a.itemId) draw(); return drawLayer(); } // not here yet: hide it, no error box
    if (!rep && (a.err === 'offline' || a.err === 'other')) { me.loading = false; load(); } // the write may have landed: look again
    if (a.err === 'refused' && a.upd && UKINDS[a.kind]) { toast(ERR.refused); return drawLayer(); } // s132: a refused Update save says so (toast and the line in the form); the typed values stay, nothing is hidden
    if (a.err === 'refused' && a.kind === 'count' && !canManage(me.role)) { me.denied.count = true; a.kind = 'menu'; a.vals = null; a.step = null; a.err = null; toast(ERR.missing); return drawLayer(); } // s85: the count release is not applied yet for staff: hide Count for the visit, no error box
    if (a.err === 'refused') { // the server decides: calm line, and the action goes away
      me.denied[dk] = true;
      if (a.kind === 'shopset') { a.kind = 'menu'; }
      else if (a.itemId && !rep && a.kind !== 'create') { a.kind = a.upd ? 'update' : 'menu'; a.vals = null; a.step = null; }
      else { var m = a.kind === 'create' ? ERR.createRefused : ERR[a.err]; me.act = null; toast(m); }
      if (rep || a.kind === 'create') draw();
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
  var CHANGE_WORD = { damage: 'Broken or missing', linen: 'Stained or damaged', counted: 'Counted', received: 'Received', used: 'Used', broken: 'Broken', missing: 'Missing', stained: 'Stained', damaged: 'Damaged', cleaned: 'Cleaned, back in use', adjusted: 'Adjusted', reconcile: 'Counted', receipt: 'Received', adjustment: 'Adjusted', usage: 'Used', undo: 'Undo', telegram_count: 'Telegram count' };
  var FIELD_WORD = { name: 'Name', category: 'Category', unit: 'Unit', reorder_below: 'Reorder at', par_qty: 'Buy up to', location: 'Kept in' };
  // s124: one history row, three columns (when, what, who). Details and price rows come from the change log; a price shows amounts only to roles that may see prices.
  function histRow(c, it) {
    var w, d = '', f = c.fields && typeof c.fields === 'object' ? c.fields : {}, nv = function (x) { return x == null || x === '' ? 'not set' : typeof x === 'number' ? fmt(x) : String(x); };
    if (c.kind === 'details') {
      w = 'Details';
      d = Object.keys(f).filter(function (k) { return FIELD_WORD[k]; }).map(function (k) { var b = f[k] || {}; return FIELD_WORD[k] + ' ' + (b.before == null || b.before === '' ? '' : nv(b.before) + ' ') + '→ ' + nv(b.after); }).join(' · ');
    } else if (c.kind === 'price') {
      w = 'Price changed'; var uc = f.unit_cost;
      if (canPrice(M.role) && uc && typeof uc === 'object') d = (uc.before == null ? '' : phpText(uc.before) + ' ') + '→ ' + (uc.after == null ? 'not set' : phpText(uc.after));
    } else if (c.kind === 'photo') w = 'Photo changed';
    else {
      w = CHANGE_WORD[c.kind] || String(c.kind || 'Change').replace(/^./, function (x) { return x.toUpperCase(); });
      var qn = c.qty == null || c.qty === '' ? null : Number(c.qty), hasBA = c.before != null && c.after != null, ba = hasBA ? fmt(c.before) + ' → ' + fmt(c.after) : '';
      if (c.kind === 'cleaned') { d = qn != null && isFinite(qn) ? uq(qn, unitOf(it)) : ''; } // linen back in use: the count did not move (before = after)
      else if (qn != null && isFinite(qn) && (c.source === 'usage' || c.source === 'receipt' || c.source === 'damage' || c.source === 'linen')) { // the live shape: a usage or receipt line carries qty only; a damage or linen row carries qty and the counts
        var minus = c.kind === 'received' ? '+' : '-'; d = minus + uq(qn, unitOf(it)) + (hasBA ? ' (' + ba + ')' : '');
      } else d = (c.before == null ? '' : fmt(c.before) + ' ') + '→ ' + (c.after == null ? '' : fmt(c.after)) + ' ' + unitWord(Number(c.after), unitOf(it));
      if (c.before == null && c.after == null && qn == null) d = '';
    }
    return '<li><span class="I_hwhen">' + esc(manilaLabel(c.at)) + '</span><span class="I_hwhat"><b>' + (SOURCE_EM[c.source] ? '<em class="I_hsrc" aria-hidden="true">' + SOURCE_EM[c.source] + '</em> ' : '') + esc(w) + '</b>' + (d ? '<span>' + esc(d.trim()) + '</span>' : '') + (c.note ? '<span class="I_hnote">' + esc(String(c.note).trim().slice(0, 200)) + '</span>' : '') + '</span><span class="I_hwho">' + (c.who ? esc(String(c.who).split(' ')[0]) : '') + '</span></li>';
  }
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
    body += ch.length ? '<ul class="I_hist">' + ch.map(function (c) { return histRow(c, it); }).join('') + '</ul>' : '<p class="help">No changes recorded yet.</p>';
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
      var e = undoFor({ kind: 'count', vals: a.vals }, it, r && r.data || {}, { qty: it.qty, controlled: it.controlled, learns: it.consumable && it.active }); if (e) pushUndoEntry(e);
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
      (a.flash ? '<div class="okbox" role="status">' + gi('check') + '<span>' + esc(a.flash) + '</span></div>' : '') + (it.controlled || (it.consumable && it.active) ? '' : '<p class="help">The first count here moves this item to counting in the app.</p>') + errBox(a) +
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

  /* ---- s132 the Update sheet: one button on the item, the options this kind of item allows, one short form each.
     Used up (consumable), Broken or missing (lasting), Stained or damaged (linen), Bought and Recount (all). Every form saves in one tap, says on the button what happens, and can be undone for 15 minutes. */
  var UE = { use: '\u{1F4E4}', brk: '\u{1F6E0}️', lin: '\u{1F9FA}', buy: '\u{1F6D2}', cnt: '\u{1F522}', bkn: '\u{1F4A5}', mis: '❓', stn: '\u{1F7E4}', dmg: '✂️', cln: '✨', rep: '\u{1F501}', ok: '✅', cam: '\u{1F4F7}', rcp: '\u{1F9FE}', stay: '\u{1F6CF}️', shop: '\u{1F6D2}', info: 'ℹ️', store: '\u{1F3EC}', cook: '\u{1F373}', edit: '✏️' };
  var UOPT = {
    used: { hue: 'use', em: UE.use, t: 'Used up', s: 'Took some out for a stay' },
    brk: { hue: 'brk', em: UE.brk, t: 'Broken or missing', s: 'Broke, chipped, worn out or lost' },
    lin: { hue: 'lin', em: UE.lin, t: 'Stained or damaged', s: 'Stain, tear, burn or bleach spot' },
    recv: { hue: 'buy', em: UE.buy, t: 'Bought', s: 'Adds to stock' },
    count: { hue: 'cnt', em: UE.cnt, t: 'Recount', s: 'Set the real number on hand' }
  };
  var UKINDS = { used: 1, brk: 1, lin: 1, recv: 1, count: 1 };
  var UPICKS = {
    used: [[UE.stay, 'For a guest stay'], ['\u{1F9FD}', 'Cleaning'], ['\u{1F464}', 'Staff use']],
    brk: [['\u{1F64B}', 'Guest broke it'], ['\u{1F4A6}', 'Dropped while washing'], ['\u{1F50D}', 'Not found at turnover']],
    lin: [['\u{1F484}', 'Makeup'], ['\u{1FA78}', 'Blood'], ['\u{1F9F4}', 'Bleach spot'], ['\u{1F64B}', 'Guest did it']],
    count: [[UE.bkn, 'One broke'], [UE.cln, 'Found extra'], ['\u{1F4DD}', 'Not logged before']]
  };
  var ULABEL = { used: 'Note (optional)', brk: 'Note (optional)', lin: 'Note (optional)', recv: 'Note (optional)', count: 'Why is it different? (optional)' };
  var UWORDS = { consumable_item: 'consumable', linen_item: 'linen', qty_invalid: 'qty', not_allowed: 'refused', rows_invalid: 'rowsBad', source_invalid: 'sourceBad', stock_moved: 'stockMoved', item_not_found: 'itemGone', forbidden: 'refused', bad_line: 'rowsBad' }; // the server's refusal reasons, answered in plain words by ERR; inventory_receipt_manual_v1 refuses with {error:'forbidden'} or 'bad_line'; stock_moved is no s132 write's answer, kept as a fallback for the older undo paths
  var SOURCE_EM = { count: UE.cnt, usage: UE.use, receipt: UE.buy, damage: UE.brk, linen: UE.lin, edit: UE.edit };
  var GROUP_CONS = { 'Kitchen supplies': 'yes', 'Kitchen utensils': 'no', 'Appliances': 'no' }; // the group sets the Is it a consumable? default on a new item
  var GROUP_EM = { 'Kitchen supplies': '☕', 'Kitchen utensils': '\u{1F37D}️', 'Appliances': '\u{1F50C}' };
  // The emoji that stands for an item when it has no picture (or the picture will not load): by name, then by group.
  var NAME_EM = [[/rice cooker|cooker/i, '\u{1F35A}'], [/coffee|kape|nescaf/i, '☕'], [/water|gallon/i, '\u{1F4A7}'], [/soap|shampoo|conditioner|body wash/i, '\u{1F9F4}'], [/tissue|toilet|paper roll/i, '\u{1F9FB}'], [/towel/i, '\u{1F6C1}'],
    [/sheet|pillow|blanket|duvet|linen/i, '\u{1F6CF}️'], [/glass|cup|mug/i, '\u{1F95B}'], [/plate|bowl|dish/i, '\u{1F37D}️'], [/spoon|fork|knife|utensil/i, '\u{1F944}'], [/pot|pan|wok|kettle/i, '\u{1F372}'],
    [/bulb|lamp/i, '\u{1F4A1}'], [/trash|garbage/i, '\u{1F5D1}️'], [/sponge|cleaner|detergent|bleach/i, '\u{1F9FD}']];
  function itemEmoji(it) {
    var n = String(it && it.name || ''), i;
    for (i = 0; i < NAME_EM.length; i++) if (NAME_EM[i][0].test(n)) return NAME_EM[i][1];
    return GROUP_EM[it && it.category] ? GROUP_EM[it.category] : it && it.category === 'Linen' ? '\u{1F6CF}️' : '\u{1F4E6}';
  }
  function groupName(c) { return (GROUP_EM[c] ? GROUP_EM[c] + ' ' : '') + c; }
  function isLinen(it) { return !!it && /^linen/i.test(String(it.category || '').trim()); } // the server tests lower(btrim(category)) like 'linen%'
  // Which options this item shows: used up things, lasting things, linen. Bought and Recount are always there.
  function updKinds(it) { return it.consumable ? ['used', 'recv', 'count'] : isLinen(it) ? ['lin', 'recv', 'count'] : ['brk', 'recv', 'count']; }
  // The picture first (the signed link of the item's photo), the emoji only when there is none or it did not load.
  function visual(it, cls) {
    var u = photoUrl(it);
    if (u && !K.badImg[u]) return '<span class="' + cls + ' I_hasph" aria-hidden="true"><img data-uimg="1" src="' + esc(u) + '" alt="" loading="lazy" decoding="async"></span>';
    return '<span class="' + cls + '" aria-hidden="true">' + itemEmoji(it) + '</span>';
  }
  function tilePct(it) { var p = barPct(it); return p != null ? p : it.qty == null ? null : it.qty > 0 ? 100 : 0; } // a tile with no reorder level still shows a bar: full when there is stock
  function bookingNow() { var b = M && M.opts && M.opts.bookingId; try { b = typeof b === 'function' ? b() : b; } catch (e) { b = null; } return b ? String(b) : null; } // the stay in house now, when the shell tells us
  function noteText(v, dflt) { var t = String(v && v.note || '').trim().slice(0, 200); return t || dflt || null; }
  function wholeQty(s) { var n = parseQty(s); return n != null && n === Math.floor(n) && n <= 99 ? n : null; } // damage and linen rows are whole pieces, 1 to 99

  // The calls. Names, keys and reasons are the s132 contract.
  function damageCall(pid, it, v, key, path, booking) {
    var row = { item_id: it.id, qty: wholeQty(v.qty), reason: v.what === 'missing' ? 'missing' : 'broken' }, nt = noteText(v), stay = v.stay === 'yes';
    if (nt) row.note = nt;
    if (stay && !booking) nt = (nt ? nt + ' ' : '') + 'During a guest stay.'; // no stay to point at: the words carry it
    return { fn: 'record_inventory_damage_v1', args: { p_property_id: pid, p_rows: [row], p_photo_path: path || null, p_booking_id: stay ? booking || null : null, p_add_to_list: v.list !== 'no', p_source: 'update', p_note: nt, p_idempotency_key: key } };
  }
  function linenCall(pid, it, v, key, path, today) {
    var row = { item_id: it.id, outcome: v.now === 'needs_replacing' || v.now === 'replaced' ? v.now : 'cleaned', qty: wholeQty(v.qty), reason: v.what === 'damaged' ? 'damaged' : 'stained' }, nt = noteText(v);
    if (nt) row.note = nt;
    return { fn: 'record_linen_stains_v1', args: { p_property: pid, p_session_date: today, p_logged_by: 'staff', p_idempotency_key: key, p_rows: [row], p_photo_path: path || null } };
  }
  // Bought: staff add the units and the admin gets the money task (manual receipt); the owner and admin write the receipt with a cost per pack.
  function boughtCall(it, v, key, today, path) {
    var packs = parseQty(v.packs), total = String(v.total || '').trim() === '' ? null : parseQty(v.total, true), nt = noteText(v);
    if (!canManage(M.role)) return { fn: 'inventory_receipt_manual_v1', args: { p_lines: [{ item_id: it.id, new_item: null, qty_units: Math.round(packs * (it.perPack || 1) * 100) / 100 }], p_purchased_on: today, p_vendor: null, p_idempotency_key: key, p_total_paid: total, p_receipt_path: path || null, p_note: nt } };
    var c = receiptCall(it, { packs: v.packs, cost: total != null && packs ? String(Math.round(total / packs * 100) / 100) : '', supplier: v.supplier, supplierId: v.supplierId, shopId: v.shopId }, key, /^\d{4}-\d{2}-\d{2}$/.test(String(v.date || '')) ? v.date : today);
    c.args.p_receipt_path = path || null; c.args.p_note = nt;
    return c;
  }
  // The picture or receipt goes up first (upload-photo writes no row), then the one write; a retry keeps the uploaded path.
  function updExec(a, mk) {
    var me = M;
    return Promise.resolve().then(function () {
      if (!a.blob || a.upPath) return a.upPath || null;
      return blobBase64(a.blob).then(function (b64) { return me.client.functions.invoke('upload-photo', { body: { purpose: 'inventory', propertyId: me.pid, itemId: a.itemId, fileData: b64, mimeType: a.blob.type || 'image/webp' } }); }).then(function (u) {
        if (u && u.error) throw u.error;
        if (!u || !u.data || u.data.ok === false || !u.data.path) throw { message: 'failed', data: u && u.data || {} };
        a.upPath = u.data.path; return a.upPath;
      });
    }).then(function (path) { var c = mk(path); return me.client.rpc(c.fn, c.args); });
  }
  function updPhotoPicked(ev) {
    var t = ev.target, f = t && t.files && t.files[0], me = M, a = me && me.act; if (!f || !a || !UKINDS[a.kind] || a.sending) return;
    Promise.resolve().then(function () { return resizePhoto(f); }).then(function (b) {
      if (M !== me || me.act !== a) return;
      relPrev(a); a.blob = b; a.upPath = null; a.prev = root.URL && root.URL.createObjectURL ? root.URL.createObjectURL(b) : null; a.photoErr = null; drawLayer(); refocus('I_up_pick');
    }, function (e) { if (M !== me || me.act !== a) return; a.photoErr = e && e.photo || 'photofail'; drawLayer(); });
    try { t.value = ''; } catch (x) { /* the same file can be chosen again */ }
  }

  // What the form will do, worked out from what is typed: the units that move, the amount after, and the words on the Save button.
  function updUnits(a, it) {
    var v = a.vals || {};
    if (a.kind === 'recv') { var p = parseQty(v.packs); return p == null ? null : Math.round(p * (it.perPack || 1) * 100) / 100; }
    return parseQty(v.qty, a.kind === 'count');
  }
  function updAfter(a, it) {
    var n = updUnits(a, it), q0 = it.qty == null ? 0 : it.qty, v = a.vals || {};
    if (n == null) return null;
    if (a.kind === 'count') return n;
    if (a.kind === 'recv') return Math.round((q0 + n) * 100) / 100;
    if (a.kind === 'lin' && (v.now || 'cleaned') === 'cleaned') return q0;
    return Math.max(0, Math.round((q0 - n) * 100) / 100);
  }
  function saveText(a, it) {
    var v = a.vals || {}, n = updUnits(a, it), w = n == null ? '' : fmt(n), o;
    if (a.kind === 'count') return 'Save count';
    if (n == null) return 'Save';
    if (a.kind === 'used') return 'Save · ' + w + ' used';
    if (a.kind === 'brk') return 'Save · ' + w + (v.what === 'missing' ? ' missing' : ' broken');
    if (a.kind === 'lin') { o = v.now || 'cleaned'; return 'Save · ' + w + (v.what === 'damaged' ? ' damaged' : ' stained') + ', ' + (o === 'cleaned' ? 'cleaned' : o === 'replaced' ? 'replaced' : 'needs replacing'); }
    return 'Save · +' + w + ' ' + unitWord(n, unitOf(it));
  }
  function flowInner(a, it) {
    var af = updAfter(a, it), now = it.qty, cnt = a.kind === 'count', top = it.reorder > 0 ? it.reorder * 2 : Math.max(now || 0, af || 0, 1);
    var pct = function (x) { return Math.max(0, Math.min(100, Math.round((x || 0) / top * 100))); };
    return '<div class="I_flow"><div class="I_fn"><b>' + (now == null ? '?' : esc(fmt(now))) + '</b><small>' + (cnt ? 'app says' : 'now') + '</small></div><span class="I_farr" aria-hidden="true">→</span>' +
      '<div class="I_fn I_fto"><b>' + (af == null ? '?' : esc(fmt(af))) + '</b><small>' + (cnt ? 'you counted' : 'after') + '</small></div>' +
      '<span class="I_fbar" aria-hidden="true"><i style="width:' + pct(af) + '%"></i>' + (it.reorder > 0 ? '<em></em>' : '') + '</span></div>';
  }
  // A typed number changes the picture and the Save words in place, so the keyboard stays up.
  function updLive(a) {
    var it = itemOf(a); if (!it || !UKINDS[a.kind]) return;
    var f = q('[data-i-flow]'); if (f) f.innerHTML = flowInner(a, it);
    var s = q('[data-i-save]'); if (s && !a.sending) s.textContent = saveText(a, it);
    var pp = q('[data-i-perpack]'); if (pp) pp.textContent = perPackText(a, it);
  }
  // Owner and admin see what one pack cost under the total (the staff form has no prices shown back).
  function perPackText(a, it) {
    if (!a || a.kind !== 'recv' || !canManage(M.role)) return '';
    var v = a.vals || {}, pk = parseQty(v.packs), tt = String(v.total || '').trim() === '' ? null : parseQty(v.total, true);
    return pk && tt != null && tt > 0 ? '₱' + (Math.round(tt / pk * 100) / 100).toFixed(2) + ' per ' + (it && it.purchaseUnit || 'pack') : '';
  }
  function storePicks(it) {
    var seen = {}, list = [], add = function (n) { n = String(n || '').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; list.push(n); } };
    if (it.supplier) add(it.supplier.name);
    if (K.sup) add(K.sup.name);
    var st = K.opt[it.id]; if (st && st.list) st.list.forEach(function (o) { add(o.supplier); });
    return list.slice(0, 3).map(function (n) { return [UE.store, n]; });
  }
  function noteField(a, it) {
    var v = a.vals || {}, picks = a.kind === 'recv' ? storePicks(it) : UPICKS[a.kind] || [];
    return '<div class="field"><label for="I_f_note">' + esc(ULABEL[a.kind] || 'Note (optional)') + '</label>' + (picks.length ? '<div class="I_picks" role="group" aria-label="Quick notes">' + picks.map(function (p) {
      return '<button class="chip I_pk" type="button" data-act="upd-note" data-v="' + esc(p[1]) + '" aria-pressed="' + (String(v.note || '').trim() === p[1]) + '">' + esc(p[0]) + ' ' + esc(p[1]) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="input"><input id="I_f_note" autocomplete="off" maxlength="200" placeholder="Add a note" value="' + esc(v.note || '') + '"></div></div>';
  }
  function segField(a, id, label, opts) {
    var v = a.vals || {};
    return '<div class="field"><span class="lbl">' + esc(label) + '</span><div class="I_seg" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button class="I_segb" type="button" data-act="upd-set" data-f="' + id + '" data-v="' + o[0] + '" aria-pressed="' + ((v[id] || opts[0][0]) === o[0]) + '"><span aria-hidden="true">' + o[1] + '</span><b>' + esc(o[2]) + '</b><small>' + esc(o[3]) + '</small></button>'; }).join('') + '</div></div>';
  }
  function switchRow(a, id, em, title, sub, on) {
    return '<button class="I_sw" type="button" role="switch" aria-checked="' + on + '" data-act="upd-sw" data-f="' + id + '"><span class="I_swe" aria-hidden="true">' + em + '</span><span class="I_swt"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span><i class="I_swk" aria-hidden="true"></i></button>';
  }
  function photoField(a, lead, em, what) {
    var has = !!a.blob;
    return '<div class="field I_upf"><span class="lbl">' + esc(lead) + '</span>' + (a.prev ? '<div class="I_photo I_ph96"><img src="' + esc(a.prev) + '" alt="Preview of the ' + esc(what) + '"></div>' : '') + '<div class="I_grid2">' +
      '<label class="btn btn-secondary btn-block I_filebtn"><span aria-hidden="true">' + em + '</span> ' + (has ? 'Retake' : 'Take a photo') + '<input class="sr" id="I_up_in" type="file" accept="image/*" capture="environment" aria-label="' + (has ? 'Retake the ' + what + ' with the camera' : 'Take a ' + what + ' with the camera') + '"></label>' +
      '<label class="btn btn-secondary btn-block I_filebtn">' + gi('image', 's16') + (has ? 'Choose another' : 'Choose a photo') + '<input class="sr" id="I_up_pick" type="file" accept="image/*" aria-label="Choose a ' + esc(what) + ' from your phone"></label></div>' +
      (a.photoErr ? '<p class="err" role="alert">' + esc(ERR[a.photoErr] || ERR.photofail) + '</p>' : '') + '</div>';
  }
  function updBand(a, it) {
    var o = UOPT[a.kind];
    return '<div class="I_band"><button class="btn btn-ghost I_bk" type="button" data-act="back"' + (a.sending ? ' disabled' : '') + ' aria-label="Back to the options"><span aria-hidden="true">‹</span></button><div class="I_bandt"><h2 class="hd I_sht" id="I_sh_t" tabindex="-1">' + o.em + ' ' + esc(o.t) + '</h2><p class="I_bsub">' + esc(it.name) + '</p></div>' + visual(it, 'I_bigem') + '</div>';
  }
  function updSave(a, it, foot) {
    return errBox(a) + (a.bad ? '<div class="field"><span class="err">' + gi('alert', 's16') + ' ' + esc(updBadText(a)) + '</span></div>' : '') +
      '<button class="btn btn-block I_save" type="submit" data-i-save' + (a.sending ? ' disabled' : '') + '>' + esc(a.sending ? 'Saving…' : saveText(a, it)) + '</button>' + (foot ? '<p class="help I_sfoot">' + esc(foot) + '</p>' : '');
  }
  function updBadText(a) {
    var v = a.vals || {};
    if (a.kind === 'brk' || a.kind === 'lin') return 'Enter a whole number from 1 to 99.';
    if (a.kind === 'recv' && String(v.total || '').trim() !== '' && parseQty(v.total, true) == null) return 'Enter the amount paid, such as 180 or 180.50.';
    if (a.kind === 'recv' && String(v.date || '') !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v.date))) return 'Choose the date you bought it.';
    return a.kind === 'recv' ? 'Enter a number such as 1 or 2.' : 'Enter a number such as 2 or 2.5.';
  }
  function renderUpdate(a, it) {
    var kinds = updKinds(it).filter(function (k) { return allowed(k, it); }), more = [];
    ['levels', 'low', 'price'].forEach(function (k) { if (allowed(k, it)) more.push({ kind: k, text: k === 'levels' ? UE.edit + ' Edit details' : k === 'low' ? '⚠️ ' + (level(it) === 'out' ? 'It is out' : 'Running low') : '₱ Price' }); });
    var hist = allowed('history');
    return '<div class="F_sheethead I_sh"><h2 class="hd I_sht" id="I_sh_t" tabindex="-1">Update</h2><button class="btn btn-secondary btn-sm F_close" type="button" data-act="close">' + gi('close', 's16') + 'Close</button></div>' +
      '<div class="I_hero I_uhero">' + visual(it, 'I_bigem I_herop') + '<div class="I_herob"><b class="I_uname">' + esc(it.name) + '</b><p class="help">' + esc(it.category + ' · ' + (it.qty == null ? 'Not counted' : uq(it.qty, it.unit) + ' on hand')) + '</p><span class="I_kind">' + (it.consumable ? '☕ Gets used up' : UE.cook + ' Lasts') + '</span></div></div>' + errBox(a) +
      '<div class="I_opts" role="group" aria-label="What happened">' + kinds.map(function (k) {
        var o = UOPT[k]; return '<button class="I_opt I_hue_' + o.hue + '" type="button" data-act="upd-pick" data-kind="' + k + '"><span class="I_ob" aria-hidden="true">' + o.em + '</span><span class="I_opt_t"><b>' + esc(o.t) + '</b><small>' + esc(o.s) + '</small></span><span class="I_chev" aria-hidden="true">›</span></button>'; }).join('') + '</div>' +
      (more.length || hist ? '<div class="I_umore">' + more.map(function (c) { return '<button class="btn btn-secondary" type="button" data-act="begin" data-kind="' + c.kind + '">' + c.text + '</button>'; }).join('') + (hist ? '<button class="btn btn-secondary" type="button" data-act="history-open">\u{1F558} History</button>' : '') + '</div>' : '');
  }
  function renderUpdForm(a, it) {
    var v = a.vals || {}, k = a.kind, body = '', unit = unitOf(it), foot = 'Undo for 15 minutes after saving';
    if (k === 'used') {
      body = stepper('qty', 'How many (' + esc(unit) + ')?', v.qty, false) + '<div data-i-flow>' + flowInner(a, it) + '</div>' + noteField(a, it);
    } else if (k === 'brk') {
      body = segField(a, 'what', 'What happened?', [['broken', UE.bkn, 'Broken', 'chipped or worn out'], ['missing', UE.mis, 'Missing', 'lost or not found']]) + stepper('qty', 'How many (' + esc(unit) + ')?', v.qty, false) + '<div data-i-flow>' + flowInner(a, it) + '</div>' +
        photoField(a, 'Photo (optional)', UE.cam, 'photo') + noteField(a, it) +
        switchRow(a, 'stay', UE.stay, 'During a guest stay', 'Turns on when you pick "Guest broke it". The admin decides any charge.', v.stay === 'yes') +
        switchRow(a, 'list', UE.shop, 'Add a replacement to the shopping list', 'The admin gets a follow-up task with the photo and note.', v.list !== 'no');
    } else if (k === 'lin') {
      var n = wholeQty(v.qty) || 1, q0 = it.qty == null ? 0 : it.qty, lower = fmt(Math.max(0, q0 - n)), o = v.now || 'cleaned';
      body = segField(a, 'what', 'What happened?', [['stained', UE.stn, 'Stained', 'makeup, rust, blood'], ['damaged', UE.dmg, 'Damaged', 'torn, burnt, bleached']]) + stepper('qty', 'How many (' + esc(unit) + ')?', v.qty, false) +
        '<div class="field"><span class="lbl">What now?</span><div class="I_outs" role="group" aria-label="What now">' + [['cleaned', UE.cln, 'Cleaned, back in use', 'Stock stays ' + fmt(q0)], ['needs_replacing', UE.rep, 'Needs replacing', fmt(q0) + ' → ' + lower + ', admin gets a task to buy one'], ['replaced', UE.ok, 'Already replaced', fmt(q0) + ' → ' + lower + ', no task']].map(function (r) {
          return '<button class="I_out" type="button" data-act="upd-set" data-f="now" data-v="' + r[0] + '" aria-pressed="' + (o === r[0]) + '"><span class="I_oe" aria-hidden="true">' + r[1] + '</span><span class="I_opt_t"><b>' + esc(r[2]) + '</b><small>' + esc(r[3]) + '</small></span><i class="I_oi" aria-hidden="true"></i></button>'; }).join('') + '</div></div>' +
        photoField(a, 'Photo (optional)', UE.cam, 'photo') + noteField(a, it);
    } else if (k === 'recv') {
      var pu = it.purchaseUnit || 'pack', pk = parseQty(v.packs), mng = canManage(M.role);
      body = stepper('packs', 'How many packs?', v.packs, false) + '<p class="help I_packn">1 ' + esc(pu) + ' = ' + esc(uq(it.perPack || 1, unit)) + '</p>' + '<div data-i-flow>' + flowInner(a, it) + '</div>' +
        '<div class="field"><label for="I_f_total">Total paid</label><div class="input I_money"><b aria-hidden="true">₱</b><input id="I_f_total" inputmode="decimal" autocomplete="off" placeholder="0" value="' + esc(v.total || '') + '"></div><p class="help I_perpack" data-i-perpack>' + esc(perPackText(a, it)) + '</p></div>' +
        photoField(a, 'Receipt (optional)', UE.rcp, 'receipt') + (mng ? supplierField(a) + textField('date', 'Date', v.date || '', 'type="date"') : '') + noteField(a, it) +
        (mng ? '' : '<div class="I_info"><span aria-hidden="true">' + UE.info + '</span><span>Stock goes up now. The admin gets a task with the amount and the receipt and records the money.</span></div>');
      foot = mng ? 'Undo for 15 minutes after saving' : 'Undo for 24 hours after saving';
    } else {
      body = stepper('qty', 'How many are there now (' + esc(unit) + ')?', v.qty, true) + '<div data-i-flow>' + flowInner(a, it) + '</div>' + (a.chg ? noteField(a, it) : '') +
        (it.controlled ? '' : '<p class="help I_sfoot">' + esc(it.consumable && it.active ? LEARNS : 'After this, ' + it.name + ' is counted in the app. Telegram /count will skip it.') + '</p>');
    }
    return updBand(a, it) + '<form data-i-form class="I_uform">' + body + updSave(a, it, foot) + '</form>';
  }
  // A count is "changed" when the typed number is not what the app says; only then does it ask why.
  function countChanged(a, it) { var n = parseQty((a.vals || {}).qty, true); return n != null && it.qty != null && n !== it.qty; }

  /* ---- undo (s84 1b): every successful write leaves a bar for 10 s and a line on the card for 15 min, for the person who made it */
  var UNDO_BAR_MS = 10000, UNDO_LINE_MS = 900000;
  function undoById(id) { return K.undos.filter(function (u) { return u.id === id; })[0] || null; }
  function undoFor(a, it, d, snap) {
    var id = 'u' + (++K.uidn), n = it.name, e = { id: id, itemId: it.id || null, name: n, at: nowMs(), kind: a.kind }, v = a.vals || {};
    if (a.kind === 'count' && d.movementId) {
      var cn = parseQty(v.qty, true); e.say = 'Counted ' + n + ': ' + fmt(cn); e.line = 'counted ' + fmt(cn);
      e.confirm = 'Put ' + n + ' back to ' + (snap && snap.qty != null ? fmt(snap.qty) : 'its old amount') + '?' + (snap && snap.controlled === false && !snap.learns ? ' It stays counted in the app.' : ''); e.call = { fn: 'inventory_undo_v1', args: { p_movement_id: d.movementId, p_purchase_id: null } };
    } else if (a.kind === 'used') {
      var un = parseQty(v.qty); e.say = 'Logged ' + uq(un, unitOf(it)) + ' of ' + n + ' as used'; e.line = 'logged ' + fmt(un) + ' as used'; e.confirm = 'Put the ' + uq(un, unitOf(it)) + ' of ' + n + ' back?';
      e.call = { fn: 'undo_inventory_usage_v1', args: { p_usage_key: a.key } }; e.v2 = true;
    } else if (a.kind === 'brk' && d.report_id) {
      var bn = wholeQty(v.qty); e.say = 'Marked ' + fmt(bn) + (v.what === 'missing' ? ' missing: ' : ' broken: ') + n; e.line = 'marked ' + fmt(bn) + (v.what === 'missing' ? ' missing' : ' broken'); e.confirm = 'Put the ' + fmt(bn) + ' of ' + n + ' back?';
      e.call = { fn: 'undo_inventory_damage_v1', args: { p_report_id: d.report_id } }; e.v2 = true;
    } else if (a.kind === 'lin') {
      var ln = wholeQty(v.qty); e.say = 'Saved ' + fmt(ln) + (v.what === 'damaged' ? ' damaged: ' : ' stained: ') + n; e.line = 'reported ' + fmt(ln) + (v.what === 'damaged' ? ' damaged' : ' stained'); e.confirm = 'Take back the ' + (v.what === 'damaged' ? 'damaged' : 'stained') + ' report for ' + n + '?';
      e.call = { fn: 'undo_linen_stain_v1', args: { p_idempotency_key: a.key } }; e.v2 = true;
    } else if (a.kind === 'recv' && d.draft_id && !canManage(M.role)) {
      e.say = 'Received ' + n; e.line = 'received stock'; e.confirm = 'Take the stock you just added to ' + n + ' back out?'; e.call = { fn: 'inventory_receipt_undo_v1', args: { p_draft_id: d.draft_id } }; e.ttl = 86400000; // the staff receipt keeps its 24 hours
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
    } else if (a.kind === 'create' && d.item_id) { // the update_v1 {active:false} entry below is the pre-s125 fallback; the change_id block after the chain replaces it whenever change_id is present
      var cnm = String(v.name || '').trim(); e.itemId = d.item_id; e.name = cnm; e.say = 'Added ' + cnm; e.line = 'added this item'; e.confirm = 'Remove ' + cnm + ' again?'; e.call = { fn: 'inventory_item_update_v1', args: { p_item_id: d.item_id, p_patch: { active: false } } }; e.ttl = NEW_UNDO_MS;
      if (a.code) { e.confirm = 'Remove ' + cnm + ' and free code ' + shortCode(a.code) + '?'; e.next = e.call; e.call = { fn: 'inventory_code_detach_v1', args: { p_property_id: M.pid, p_code: a.code } }; } // the code goes first, so it is free to use again
    } else if ((a.kind === 'shop' || a.kind === 'low') && d.id) {
      var gone = level(it) === 'out'; e.say = a.kind === 'low' ? n + (gone ? ' flagged as out' : ' flagged as running low') : 'Added ' + n + ' to the shopping list'; e.line = a.kind === 'low' ? (gone ? 'said it is out' : 'said it is running low') : 'added it to the shopping list'; e.confirm = 'Take ' + n + ' off the shopping list?';
      e.call = { fn: 'save_shopping_item_v1', args: { p_property_id: M.pid, p_item: { id: d.id, status: 'cancelled' }, p_idempotency_key: newKey('undo') } };
    } else if (a.kind === 'levels' && snap) {
      var up = { reorder_below: snap.reorder == null ? null : snap.reorder, par_qty: snap.par == null ? null : snap.par }, was = levelsCall(it, v).args.p_patch, more = false;
      if ('name' in was) { up.name = snap.name; more = true; }
      if ('location' in was) { up.location = snap.location || ''; more = true; } if ('unit' in was) { up.unit = snap.unit; more = true; } if ('category' in was) { up.category = snap.category; more = true; }
      e.say = (more ? 'Details saved for ' : 'Levels saved for ') + (was.name || n); e.line = more ? 'changed the details' : 'changed the levels'; e.confirm = 'Put the ' + (more ? 'details' : 'levels') + ' of ' + n + ' back as they were?';
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
    if (/^(price|levels|photo|photoremove|create)$/.test(a.kind) && d.change_id) { // s124: the server keeps the change, so Undo is one call for every role; a price is never named
      e.call = changeUndoCall(d.change_id); e.change = true; delete e.more;
      if (a.kind === 'create' && a.code) e.next = { fn: 'inventory_code_detach_v1', args: { p_property_id: M.pid, p_code: a.code } }; // Undo runs first, so a refusal never frees the code
      else delete e.next;
      if (a.kind === 'price') e.confirm = 'Put the price of ' + n + ' back as it was?';
    } else if (a.kind === 'price' && !canPrice(M.role)) return null; // a role without prices knows no old amount to put back
    return e;
  }
  function pushUndo(a, it, d, snap) {
    var e = undoFor(a, it, d, snap); if (!e) return;
    K.undos.unshift(e); if (K.undos.length > 20) K.undos.length = 20;
    drawUndo();
  }
  function pushUndoEntry(e) { K.undos.unshift(e); if (K.undos.length > 20) K.undos.length = 20; }
  function ago(ms) { var m = Math.floor(ms / 60000); return m < 1 ? 'just now' : m + ' min ago'; }
  function lastEntry(it) { return K.undos.filter(function (u) { return u.itemId === it.id && nowMs() - u.at < (u.ttl || UNDO_LINE_MS) && !K.denied[u.call.fn]; })[0]; }
  // s124: "Updated Nov 19 by Honey" under the level; the Last change line replaces it while that shows
  function updLine(it) {
    if (!it.updatedBy || lastEntry(it)) return '';
    var d = manilaLabel(it.updatedAt);
    return '<p class="I_upd">' + gi('clock', 's16') + (it.updatedKind === 'created' ? ' Added ' : ' Updated ') + (d ? esc(d) + ' ' : '') + 'by ' + esc(it.updatedBy) + '</p>';
  }
  function lastChange(it) {
    var e = lastEntry(it);
    return e ? '<p class="help I_last">' + (e.kind === 'create' ? 'Added by you ' : 'Last change: ' + esc(e.line) + ' by you, ') + ago(nowMs() - e.at) + '. <button class="btn btn-ghost I_undobtn" type="button" data-act="undo" data-id="' + e.id + '">' + gi('refresh', 's16') + ' Undo</button></p>' : '';
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
    if (a.kind === 'create') { if (a.discard) { a.discard = false; a.focused = false; drawLayer(); return; } if (a.step === 'confirm') { a.step = 'form'; a.err = null; a.takenId = null; drawLayer(); return; } if (!a.code) return closeSheet(); a.kind = 'scan'; a.phase = 'unknown'; a.err = null; a.sg = null; drawLayer(); return; }
    if (a.kind === 'link') { a.kind = 'scan'; a.err = null; a.takenId = null; if (a.fromPick) { a.phase = 'pick'; a.vals = { find: '' }; drawLayer(); return; } return enterLook(a); }
    if (a.phase === 'pick') { a.phase = 'unknown'; drawLayer(); return; }
    if (a.phase === 'unknown') return enterLook(a);
    return closeSheet();
  }
  function toast(msg) { say(msg); if (M && M.opts.toast) M.opts.toast(msg); }
  function finish() { if (!M) return; if (M.act && M.act.kind === 'optusual') { M.act = newMenu(M.act.itemId); drawLayer(); drawUndo(); return; } var fromShop = M.act && (M.act.shopId || M.act.fromShop); if (fromShop) { M.act = null; drawLayer(); draw(); } else closeSheet(); }

  root.I_Stock = { mount: mount, unmount: unmount, lib: {
    esc: esc, canPrice: canPrice, groupsFor: groupsFor, groupOrder: groupOrder, codeIndex: codeIndex, I_codeIndex: codeIndex, normCode: normCode, validCode: validCode, attachCall: attachCall, priceCall: priceCall, levelsCall: levelsCall, createCall: createCall, reportCall: reportCall, REPORTS: REPORTS, normalize: normalize, normalizeCatalogue: normalizeCatalogue, level: level, summary: summary, chipsFor: chipsFor, visible: visible, barPct: barPct, parseQty: parseQty, stepQty: stepQty,
    newKey: newKey, errKind: errKind, ERR: ERR, countCall: countCall, usageCall: usageCall, receiptCall: receiptCall, shopAddCall: shopAddCall, shopSetCall: shopSetCall, normalizeShop: normalizeShop,
    fitSize: fitSize, phpText: phpText, photoSetCall: photoSetCall, recatCall: recatCall, mintCall: mintCall, labelsCall: labelsCall,
    manilaToday: manilaToday, demoItems: demoItems, PROPERTY_ID: PROPERTY_ID, canManage: canManage, canUse: canUse, state: function () { return M; }, /* test seam: the open state, so a test can put a role on a sheet the UI never opens for it */
    normOpts: normOpts, normReqs: normReqs, o8Link: o8Link, o8Pic: o8Pic, setUsualCall: setUsualCall, optSort: optSort, chipsFor: chipsFor,
    itemEmoji: itemEmoji, updKinds: updKinds, UOPT: UOPT, damageCall: damageCall, linenCall: linenCall, boughtCall: boughtCall, saveText: saveText, canUpdate: canUpdate, isLinen: isLinen, tilePct: tilePct, groupName: groupName, wholeQty: wholeQty,
    lowItems: lowItems, shopLines: shopLines, shopText: shopText, shopLayout: shopLayout, unitPrice: unitPrice, wrapText: wrapText, longDate: longDate
  } };
})(typeof window !== 'undefined' ? window : this);
