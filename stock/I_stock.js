/* Cascade Staff - native Inventory screen (lane I, session 82). Plain script, no build step.
   Mounted by the shell as window.I_Stock.mount(el, { client, demo, role, sub, navigate, toast, haptic, propertyId? }).
   Money rule: a cleaner never sees or keeps a cost. normalize() never reads unitCost for any role but owner/admin.
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
      cover: num(raw.coverageDays), coverEst: num(raw.estCoverageDays), controlled: !!raw.movementControlled
    };
    if (canManage(role)) it.cost = num(raw.unitCost);
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
    var code = String(e.code || ''), msg = String(e.message || ''), st = e.status;
    if (code === '42501' || st === 401 || st === 403 || /not authori[sz]ed|permission denied|access denied|denied/i.test(msg)) return 'refused';
    if (code === 'PGRST202' || code === '42883' || st === 404 || /could not find the function|does not exist/i.test(msg)) return 'missing';
    if (/insufficient stock/i.test(msg)) return 'short';
    if (/reconciliation required/i.test(msg)) return 'recon';
    if (!code && !st && (e.name === 'TypeError' || /failed to fetch|network|load failed|fetch/i.test(msg))) return 'offline';
    return 'other';
  }
  var ERR = {
    offline: 'No connection, so nothing was sent.',
    refused: 'This is not available to you. Ask the owner if you need it.',
    missing: 'This is not available right now.',
    short: 'There is less on hand than that. Try a smaller amount.',
    recon: 'This item needs a fresh count first. Please tell the owner.',
    other: 'That did not go through. Try again in a moment.'
  };

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
    var d = function (id, name, cat, unit, qty, re, cons, cost, pu, pp) { return { id: id, name: name, category: cat, unit: unit, qty: qty, reorderBelow: re, consumable: cons, active: true, unitCost: cost, purchaseUnit: pu || null, unitsPerPurchase: pp || 1, estCoverageDays: re ? Math.round(qty / re * 10) : null }; };
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
  var K = { items: null, shop: null, q: '', chip: 'low', role: null, at: 0, keys: {} }; // survives unmount: the list shows at once while it refreshes
  var M = null; // the live mount

  function mount(el, opts) {
    unmount();
    opts = opts || {};
    if (K.role !== opts.role) { K.role = opts.role; K.items = null; K.shop = null; K.q = ''; K.chip = 'low'; K.at = 0; K.keys = {}; } // a cached list is never shown to another role
    M = {
      el: el, opts: opts, role: opts.role, demo: !!opts.demo, client: opts.client || null, pid: opts.propertyId || PROPERTY_ID,
      sub: String(opts.sub || ''), act: null, denied: {}, uid: null, loadErr: null, shopErr: null, loading: false, offlineStale: false, itemInfo: {}, listeners: []
    };
    el.innerHTML = '<div class="I_wrap"><div data-i-top></div><div data-i-list></div><div data-i-layer></div><div class="I_live sr" role="status" aria-live="polite" data-i-live></div></div>';
    var on = function (type, fn) { el.addEventListener(type, fn); M.listeners.push([type, fn]); };
    on('click', onClick); on('input', onInput); on('submit', onSubmit); on('keydown', onKey);
    if (M.demo) { K.items = demoItems().map(function (r) { return normalize(r, M.role); }); K.shop = normalizeShop(demoShop(), null); }
    else if (M.client && M.client.auth && M.client.auth.getSession) { try { M.client.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; M.uid = s && s.user ? s.user.id : null; }, function () {}); } catch (e) { /* no uid: rows read "Asked by staff" */ } }
    draw();
    if (!M.demo && !(K.items && K.at && nowMs() - K.at < 60000)) load(); // a fresh list for this role is kept when only the sub-route changed
    else if (!M.demo) loadShopSoon();
    return M;
  }
  function unmount() {
    if (!M) return;
    M.listeners.forEach(function (l) { M.el.removeEventListener && M.el.removeEventListener(l[0], l[1]); });
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
      if (items) { K.items = items; K.at = nowMs(); me.loadErr = null; me.offlineStale = false; }
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
    if (rt.itemId && K.items && (!M.act || M.act.itemId !== rt.itemId)) { var it = itemById(rt.itemId); if (it) { M.act = { kind: 'menu', itemId: rt.itemId }; loadLastCount(rt.itemId); } }
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
      h += '<div class="field"><label for="I_q">Search items</label><div class="input"><input id="I_q" type="search" autocomplete="off" enterkeyhint="search" value="' + esc(K.q) + '" placeholder="Toilet paper"></div></div>';
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
    var rows = visible(K.items, K.chip, K.q), h = '';
    if (M.offlineStale) h += '<div class="note soon" role="status"><span>No connection. This is the last list we have.</span></div>';
    if (!rows.length) h += '<div class="empty"><p>' + (K.q ? 'Nothing matches that search.' : 'Nothing to show here.') + '</p>' + (K.chip !== 'all' || K.q ? '<button class="btn btn-secondary" type="button" data-act="showall">Show all items</button>' : '') + '</div>';
    else h += '<div class="card list I_list">' + rows.map(renderRow).join('') + '</div>';
    box.innerHTML = h;
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
    if (!a) { box.innerHTML = ''; [main1, main2].forEach(function (n) { n && n.removeAttribute && n.removeAttribute('inert'); }); return; }
    var body = a.shopId && a.kind === 'menu' ? renderShopSheet(a) : renderSheet(a);
    if (body == null) { M.act = null; box.innerHTML = ''; return; }
    box.innerHTML = '<div class="scrim on" data-act="close"></div><div class="sheet on I_sheet" role="dialog" aria-modal="true" aria-labelledby="I_sh_t">' + body + '</div>';
    [main1, main2].forEach(function (n) { n && n.setAttribute && n.setAttribute('inert', ''); });
    if (!a.focused) { a.focused = true; var h = q('#I_sh_t'); if (h && h.focus) h.focus(); }
  }
  function head(title, sub) { return '<h2 class="hd I_sht" id="I_sh_t" tabindex="-1">' + esc(title) + '</h2>' + (sub ? '<p class="help">' + esc(sub) + '</p>' : ''); }
  function row(label, val) { return '<div class="I_kv"><dt>' + label + '</dt><dd>' + val + '</dd></div>'; }
  function errBox(a) { return a.err ? '<div class="errbox" role="alert"><span aria-hidden="true">▲</span><span>' + esc(ERR[a.err] || ERR.other) + '</span></div>' : ''; }
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
    var it = itemById(a.itemId); if (!it) return null;
    var v = a.vals || {}, m = M.role, h;
    if (a.kind === 'menu') {
      var info = M.itemInfo[it.id], shopN = (K.shop || []).filter(function (r) { return r.itemId === it.id; }).length, cover = it.cover != null ? fmt(it.cover) + ' days' : it.coverEst != null ? 'about ' + fmt(it.coverEst) + ' days (an estimate)' : '';
      h = head(it.name, it.category + (it.consumable ? ' · consumable' : '')) + '<p class="I_lvline">' + levelBadge(it) + '</p><dl class="I_dl">' +
        row('On hand', it.qty == null ? 'Not counted' : esc(fmt(it.qty) + ' ' + it.unit)) + row('Reorder at', it.reorder == null ? 'Not set' : esc(fmt(it.reorder) + ' ' + it.unit)) +
        (canManage(m) && info && info.done ? row('Last counted', info.lastCounted ? esc(dateLabel(info.lastCounted)) : 'Not counted in the app yet') : '') +
        (cover ? row('Lasts', esc(cover)) : '') + (canManage(m) && it.cost != null ? row('Unit cost', esc(peso(it.cost))) : '') + '</dl>' +
        (M.denied.shop ? '' : shopN ? '<p class="help">Already on the shopping list.</p>' : '') + (a.note ? '<div class="okbox" role="status"><span>' + esc(a.note) + '</span></div>' : '') + errBox(a) +
        '<div class="I_btns">' +
        (allowed('count') ? '<button class="btn btn-primary btn-block" type="button" data-act="begin" data-kind="count">Count it</button>' : '') +
        (allowed('used') ? '<button class="btn btn-primary btn-block" type="button" data-act="begin" data-kind="used">Used some</button>' : '') +
        (allowed('recv', it) ? '<button class="btn btn-secondary btn-block" type="button" data-act="begin" data-kind="recv">Stock received</button>' : canManage(m) && it.controlled ? '<p class="help I_more"><a href="#door/inventory" data-act="admin">Receive this one in the admin dashboard</a></p>' : '') +
        (allowed('shop') ? '<button class="btn btn-secondary btn-block" type="button" data-act="begin" data-kind="shop">Add to shopping list</button>' : '') +
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
    return null;
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
    if (act === 'retry') { M.loadErr = null; M.shopErr = null; M.loading = false; if (!K.items) draw(); load(); return; }
    if (act === 'open') return go('#stock/item/' + attr(t, 'data-id'), 'item/' + attr(t, 'data-id'), attr(t, 'data-id'));
    if (act === 'shop-open') { if (!canManage(M.role)) return; M.act = { kind: 'menu', shopId: attr(t, 'data-id') }; drawLayer(); return; }
    var a = M.act;
    if (act === 'close') return closeSheet();
    if (!a) return;
    if (a.sending) return; // nothing, not even Close, while a write is in flight
    if (act === 'begin') return begin(attr(t, 'data-kind'));
    if (act === 'back') { if (a.kind === 'shopset') { a.kind = 'menu'; a.step = null; a.err = null; drawLayer(); } else if (a.fromShop && a.step !== 'confirm') { M.act = null; drawLayer(); } else if (a.step === 'confirm') { a.step = 'form'; a.err = null; drawLayer(); } else if (a.shopId) { a.kind = 'menu'; a.err = null; drawLayer(); } else { a.kind = 'menu'; a.vals = null; a.step = null; a.err = null; a.bad = false; drawLayer(); } return; }
    if (act === 'step') { a.vals = a.vals || {}; var f = attr(t, 'data-f'); a.vals[f] = stepQty(a.vals[f], +attr(t, 'data-d'), attr(t, 'data-z') === '1'); a.err = null; drawLayer(); var nb = q('[data-act="step"][data-f="' + f + '"][data-d="' + attr(t, 'data-d') + '"]'); if (nb && nb.focus) nb.focus(); return; }
    if (act === 'shop-bought') { var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!r || !r.itemId || !allowed('recv', itemById(r.itemId))) return; M.act = { kind: 'recv', itemId: r.itemId, step: 'form', vals: { packs: fmt(r.qty || 1), supplier: '', cost: '', shopId: r.id }, fromShop: true }; drawLayer(); return; }
    if (act === 'shop-do') { var rr = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0]; if (!rr) return; a.kind = 'shopset'; a.status = attr(t, 'data-do'); a.step = 'confirm'; a.rowName = rr.name; drawLayer(); return; }
  }
  function go(hash, sub, itemId) {
    M.sub = sub; M.act = itemId ? { kind: 'menu', itemId: itemId } : null;
    if (M.opts.navigate) M.opts.navigate(hash);
    if (M) { draw(); if (itemId) loadLastCount(itemId); }
  }
  function closeSheet() {
    if (!M || (M.act && M.act.sending)) return;
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
    return false;
  }
  function begin(kind) {
    if (!allowed(kind, itemById(M.act.itemId))) return;
    var a = M.act, it = itemById(a.itemId), defaults = { count: { qty: it && it.qty != null ? fmt(it.qty) : '0', note: '' }, used: { qty: '1' }, recv: { packs: '1', supplier: '', cost: '' }, shop: { qty: '1', note: '' } };
    a.kind = kind; a.step = 'form'; a.vals = defaults[kind]; a.err = null; a.bad = false; a.key = null; a.sig = null; a.focused = false; drawLayer();
  }
  function onInput(ev) {
    if (!M) return;
    var id = ev.target && ev.target.id; if (!id) return;
    if (id === 'I_q') { K.q = ev.target.value; drawList(); return; }
    if (id.indexOf('I_f_') === 0 && M.act && M.act.vals) { M.act.vals[id.slice(4)] = ev.target.value; M.act.err = null; }
  }
  function onKey(ev) { if (M && ev.key === 'Escape' && M.act) { closeSheet(); } }
  function valid(a) {
    var v = a.vals || {};
    if (a.kind === 'count') return parseQty(v.qty, true) != null;
    if (a.kind === 'used' || a.kind === 'shop') return parseQty(v.qty) != null;
    if (a.kind === 'recv') return parseQty(v.packs) != null && (String(v.cost || '').trim() === '' || parseQty(v.cost) != null);
    return true;
  }
  function onSubmit(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var a = M && M.act; if (!a || a.sending || a.kind === 'menu') return;
    if (a.step !== 'confirm') { if (!valid(a)) { a.bad = true; drawLayer(); return; } a.bad = false; a.step = 'confirm'; a.err = null; a.focused = false; drawLayer(); return; }
    commit(a);
  }

  /* ---- the write */
  function build(a) {
    var it = itemById(a.itemId), today = manilaToday(nowMs()), sig = JSON.stringify([a.kind, a.itemId || a.shopId, a.vals, a.status]);
    var ke = K.keys[sig]; // one key per set of values, kept even if the sheet is reopened; dropped on success; forgotten after 10 minutes (a write that landed unseen must not replay a later identical one)
    if (!ke || nowMs() - ke.at > 600000) ke = K.keys[sig] = { key: newKey(a.kind), at: nowMs() };
    a.sig = sig; a.key = ke.key;
    if (a.kind === 'count') return countCall(it, a.vals, a.key);
    if (a.kind === 'used') return usageCall(M.pid, it, a.vals, a.key, today);
    if (a.kind === 'recv') return receiptCall(it, a.vals, a.key, today);
    if (a.kind === 'shop') return shopAddCall(M.pid, it, a.vals, a.key);
    var r = (K.shop || []).filter(function (x) { return x.id === a.shopId; })[0];
    return shopSetCall(M.pid, r, a.status, a.key);
  }
  var DONE = { count: function (it) { return 'Counted. ' + it.name + ' is saved.'; }, used: function () { return 'Logged. Thank you.'; }, recv: function (it) { return 'Stock received for ' + it.name + '.'; }, shop: function () { return 'Added to the shopping list.'; }, shopset: function (it, a) { return a.status === 'approved' ? 'Approved.' : 'Removed from the list.'; } };
  function commit(a) {
    var me = M, it = itemById(a.itemId) || { name: a.rowName || '' }, call = build(a);
    if (me.demo) { toast(DEMO_NOTE); finish(); return; }
    if (!online()) { a.err = 'offline'; drawLayer(); return; }
    if (!me.client) { a.err = 'missing'; drawLayer(); return; }
    K.at = 0; // any write makes the list stale, whichever mount sees the answer
    a.sending = true; a.err = null; drawLayer();
    Promise.resolve().then(function () { return me.client.rpc(call.fn, call.args); }).then(function (r) {
      if (me.dead) return;
      if (r && r.error) throw r.error;
      if (r && r.data && r.data.ok === false) throw { message: 'failed' };
      a.sending = false; delete K.keys[a.sig];
      var msg = DONE[a.kind](it, a);
      toast(msg); if (me.opts.haptic) { try { me.opts.haptic('success'); } catch (e) { /* no haptics */ } }
      finish(); load();
    }).catch(function (e) {
      if (me.dead) return;
      a.sending = false; a.err = errKind(e, online());
      if (a.err === 'offline' || a.err === 'other') { me.loading = false; load(); } // the write may have landed: look again
      if (a.err === 'refused') { // the server decides: calm line, and the action goes away
        var gone = { count: 'count', used: 'used', recv: 'recv', shop: 'shop', shopset: 'shopset' }[a.kind]; me.denied[gone] = true;
        if (a.kind === 'shopset') { a.kind = 'menu'; } else { a.kind = 'menu'; a.vals = null; a.step = null; }
      }
      drawLayer();
    });
  }
  function toast(msg) { say(msg); if (M && M.opts.toast) M.opts.toast(msg); }
  function finish() { if (!M) return; var fromShop = M.act && (M.act.shopId || M.act.fromShop); if (fromShop) { M.act = null; drawLayer(); draw(); } else closeSheet(); }

  root.I_Stock = { mount: mount, unmount: unmount, lib: {
    esc: esc, normalize: normalize, normalizeCatalogue: normalizeCatalogue, level: level, summary: summary, chipsFor: chipsFor, visible: visible, barPct: barPct, parseQty: parseQty, stepQty: stepQty,
    newKey: newKey, errKind: errKind, ERR: ERR, countCall: countCall, usageCall: usageCall, receiptCall: receiptCall, shopAddCall: shopAddCall, shopSetCall: shopSetCall, normalizeShop: normalizeShop,
    manilaToday: manilaToday, demoItems: demoItems, PROPERTY_ID: PROPERTY_ID, canManage: canManage, canUse: canUse
  } };
})(typeof window !== 'undefined' ? window : this);
