/* Cascade Staff - Report consumption and Report supply (s110, D-358). Mounted by the shell as window.S110_Supply.mount(el, { client, demo, role, sub, propertyId, navigate, toast }).
   sub 'use'  : consumable items with steppers -> record_inventory_usage (same rows the cleaning checklist writes).
   sub ''     : receipt photo or file -> ocr-receipt {mode:'supply'} -> inventory_receipt_draft_v1 -> review every line -> inventory_receipt_confirm_v1 (+ Undo).
   Money rule: nothing here reads or draws a price, cost or total, whatever the draft carries. Plain ES5, no build step. Pure helpers are on S110_Supply.lib for the tests. */
(function (root) {
  'use strict';
  var PHOTO_MAX = 1048576, PHOTO_HUGE = 20 * 1048576, RECEIPT_SIDE = 1600, CATS = ['Uncategorised'];
  var SHOP_HOSTS = /^https:\/\/(cdn\.shopify\.com|down-ph\.img\.susercontent\.com)\//i; // the allow-list the item options already use (I_Stock o8Pic)

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gi(name, size) { return root.ICON ? root.ICON(name, size) : ''; }
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }
  function qtyOf(s, allowZero) { var t = String(s == null ? '' : s).trim().replace(',', '.'); if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null; var n = parseFloat(t); return n > 0 || (allowZero && n === 0) ? n : null; }
  function stepQty(s, dir) { var n = num(s); if (n == null) n = 0; return fmt(Math.max(0, Math.round((n + dir) * 100) / 100)); }
  function manilaToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
  function newKey(kind) { var r = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); return 'stk-' + kind + '-' + String(r).replace(/-/g, ''); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function picUrl(s) { var t = String(s == null ? '' : s).trim(); return SHOP_HOSTS.test(t) && t.length <= 500 ? t : ''; }
  function fitSize(w, h, max) { var s = Math.min(1, max / Math.max(w, h)); return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }; }

  // The catalogue as this screen needs it: active items only; no price key is ever read.
  function normItems(data) {
    var list = data && Array.isArray(data.items) ? data.items : null; if (!list) return null;
    return list.filter(function (r) { return r && r.id && r.name && r.active !== false; }).map(function (r) {
      return { id: String(r.id), name: String(r.name), unit: String(r.unit || ''), category: String(r.category || 'Other'), consumable: !!r.consumable, purchaseUnit: r.purchaseUnit ? String(r.purchaseUnit) : '', perPack: num(r.unitsPerPurchase) || 1 };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function usageRows(items, qtys, keys) {
    var out = [];
    items.forEach(function (it) { var q = qtyOf(qtys[it.id]); if (q != null) out.push({ item_id: it.id, used_qty: q, usage_key: keys[it.id] || (keys[it.id] = newKey('use')) }); });
    return out;
  }
  function usageCall(pid, rows, today) { return { fn: 'record_inventory_usage', args: { p_property_id: pid, p_session_date: today, p_logged_by: null, p_notes: 'Logged in the staff app', p_rows: rows } }; }
  function draftLines(d) {
    var list = d && Array.isArray(d.lines) ? d.lines : [];
    return list.map(function (l, i) {
      var m = l && l.match && l.match.item_id ? { id: String(l.match.item_id), name: String(l.match.name || ''), unit: String(l.match.unit || '') } : null, q = num(l && l.qty);
      return { no: l && l.line_no != null ? l.line_no : i + 1, text: String((l && l.description) || ''), qty: q != null && q > 0 ? fmt(q) : '1', rcpt: q != null && q > 0 ? q : 1, matchId: m ? m.id : '', mode: m ? 'match' : 'unset', itemId: m ? m.id : '', itemName: m ? m.name : '', unit: m ? m.unit : '',
        nw: { name: String((l && l.description) || '').slice(0, 80), category: CATS[0], unit: 'pc', cons: 'yes' }, link: '', blob: null, prev: '', err: '' };
    });
  }
  // Review -> the p_lines the server takes. null + a message per line when something is unfinished.
  function confirmLines(lines) {
    var out = [], bad = {}, kept = 0;
    lines.forEach(function (l) {
      if (l.mode === 'skip') { out.push({ line_no: l.no, item_id: null, new_item: null, qty_units: 1, skip: true }); return; }
      var q = qtyOf(l.qty);
      if (q == null) { bad[l.no] = 'Enter how many.'; return; }
      if (l.mode === 'new') {
        var name = String(l.nw.name || '').trim();
        if (name.length < 2) { bad[l.no] = 'Give the new item a name.'; return; }
        out.push({ line_no: l.no, item_id: null, new_item: { name: name.slice(0, 80), category: String(l.nw.category || CATS[0]), unit: String(l.nw.unit || '').trim() || 'pc', is_consumable: l.nw.cons === 'yes' }, qty_units: q, skip: false }); kept++; return;
      }
      if ((l.mode === 'match' || l.mode === 'item') && l.itemId) { out.push({ line_no: l.no, item_id: l.itemId, new_item: null, qty_units: q, skip: false }); kept++; return; }
      bad[l.no] = 'Pick the item, add it as new, or skip this line.';
    });
    if (Object.keys(bad).length) return { lines: null, bad: bad };
    if (!kept) return { lines: null, bad: {}, none: true };
    return { lines: out, bad: {} };
  }
  function confirmCall(draftId, lines, purchasedOn, key) { return { fn: 'inventory_receipt_confirm_v1', args: { p_draft_id: draftId, p_lines: lines, p_purchased_on: purchasedOn || null, p_idempotency_key: key } }; }
  function undoCall(draftId) { return { fn: 'inventory_receipt_undo_v1', args: { p_draft_id: draftId } }; }
  function cancelCall(draftId) { return { fn: 'inventory_receipt_cancel_v1', args: { p_draft_id: draftId } }; }
  // Supply without a photo: the server takes UNITS (not packs), needs report_supply only, writes no price and no finance row (contracts.md, Amendment 1).
  function manualCall(it, qtyUnits, key, today) { return { fn: 'inventory_receipt_manual_v1', args: { p_lines: [{ item_id: it.id, new_item: null, qty_units: qtyUnits }], p_purchased_on: today, p_vendor: null, p_idempotency_key: key } }; }
  // A matched item with a pack size: the receipt counts packs, the stock counts units. Returns the units to prefill and the words that show the sum.
  function packInfo(it, rcpt) {
    var per = it && it.perPack > 1 ? it.perPack : 1, pu = (it && it.purchaseUnit) || 'pack', units = Math.round(rcpt * per * 100) / 100, unit = (it && it.unit) || 'units';
    return { packed: per > 1, per: per, units: units, unit: unit, text: per > 1 ? rcpt + ' ' + (rcpt === 1 ? pu : pu + (/(s|x|z|ch|sh)$/i.test(pu) ? 'es' : 's')) + ' of ' + per + ' = ' + fmt(units) + ' ' + (units === 1 || /s$/i.test(unit) ? unit : unit + (/(x|z|ch|sh)$/i.test(unit) ? 'es' : 's')) : '' };
  }
  // confirm's new_items: [{line_no, item_id}] (or a bare list of ids in line order); item id by line number.
  function newItemIds(res, lines) {
    var out = {}, ni = res && res.new_items;
    if (!Array.isArray(ni)) return out;
    var newLines = lines.filter(function (l) { return l.new_item; });
    ni.forEach(function (x, i) { if (x && typeof x === 'object' && x.line_no != null && x.item_id) out[x.line_no] = String(x.item_id); else if (typeof x === 'string' && newLines[i]) out[newLines[i].line_no] = x; });
    return out;
  }
  function errText(e, res) {
    var code = (res && res.error) || '';
    if (code === 'not_draft') return 'This receipt was already added. Nothing more to do.';
    if (code === 'forbidden' || (e && (e.code === '42501' || /denied|forbidden/i.test(String(e.message || ''))))) return 'Your account cannot do this. Ask Lloyd.';
    if (code === 'not_found') return 'This receipt is no longer open. Start again with a new photo.';
    if (code === 'no_lines') return 'Keep at least one line.';
    if (code === 'bad_line') return 'One line needs another look' + (res && res.line_no != null ? ' (line ' + res.line_no + ')' : '') + '. Check it and try again.';
    if (e && /fetch|network|offline/i.test(String(e.message || ''))) return 'No connection. Nothing was saved. Try again when you have signal.';
    return 'That was not saved. Try again in a moment. If it keeps happening, tell Lloyd.';
  }

  /* ---------------------------------------------------------------- photos (resize, base64) */
  function canvasBlob(c, type, q) { return new Promise(function (res) { try { c.toBlob(function (b) { res(b || null); }, type, q); } catch (e) { res(null); } }); }
  function resizeImage(file, side, max) {
    var d = root.document, mk = root.createImageBitmap;
    if (!mk || !d || !d.createElement) return Promise.reject({ photo: 'photofail' });
    if (file && file.size > PHOTO_HUGE) return Promise.reject({ photo: 'photohuge' }); // refused before it is decoded: a 20 MB+ photo can exhaust a phone's memory
    return Promise.resolve().then(function () { return mk.call(root, file); }).then(function (bm) {
      var z = fitSize(bm.width, bm.height, side), c = d.createElement('canvas'), free = function () { c.width = c.height = 0; }; // the canvas bitmap is released as soon as the blob exists
      c.width = z.w; c.height = z.h; c.getContext('2d').drawImage(bm, 0, 0, z.w, z.h); if (bm.close) { try { bm.close(); } catch (e) { /* closed already */ } }
      return canvasBlob(c, 'image/jpeg', 0.8).then(function (b) {
        if (!b) { free(); throw { photo: 'photofail' }; }
        if (b.size <= max) { free(); return b; }
        return canvasBlob(c, 'image/jpeg', 0.6).then(function (b2) { free(); if (!b2 || b2.size > max) throw { photo: 'photobig' }; return b2; });
      });
    }, function () { throw { photo: 'photofail' }; });
  }
  function blobBase64(b) {
    return Promise.resolve(b.arrayBuffer()).then(function (buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return root.btoa(s); });
  }
  var PHOTO_ERR = { photofail: 'That photo could not be prepared. Try another one.', photobig: 'That photo is too large. Try one taken a little further away.', photohuge: 'That photo is too large to open. Choose a smaller one, or take it again.', optfetch: 'The picture could not be fetched. Try again, or take a photo yourself.', notimage: 'Please choose a photo of the receipt, not a PDF.' };

  /* ---------------------------------------------------------------- the screen */
  var S = null;
  function mount(el, opts) {
    unmount(); opts = opts || {};
    S = { el: el, opts: opts, role: opts.role, client: opts.client || null, pid: opts.propertyId, use: opts.sub === 'use', items: null, load: 'loading', step: opts.sub === 'use' ? 'list' : 'start', qtys: {}, keys: {}, find: '', msg: '', busy: false,
      draft: null, lines: [], listeners: [], dead: false, confirmKey: newKey('rcpt'), result: null, photoNote: '', man: { itemId: '', qty: '1', key: '' } };
    var on = function (t, fn) { el.addEventListener(t, fn); S.listeners.push([t, fn]); };
    on('click', onClick); on('input', onInput); on('change', onChange); on('submit', onSubmit);
    draw(); loadItems();
    return S;
  }
  function unmount() {
    if (!S) return; cancelDraft(S); S.listeners.forEach(function (l) { try { S.el.removeEventListener(l[0], l[1]); } catch (e) { /* gone */ } });
    S.lines.forEach(function (l) { relPrev(l); }); relRcpt(S); S.dead = true; S = null;
  }
  function reset() { /* nothing is kept between visits */ }
  // Leaving the review (Cancel, back, another tab) frees the draft. Fire and forget; the draft also expires on its own. Never while a confirm is in flight.
  function cancelDraft(me) {
    if (!me || me.step !== 'review' || me.busy || !me.draft || !me.client) return;
    me.step = 'cancelled'; var c = cancelCall(me.draft.id);
    try { Promise.resolve(me.client.rpc(c.fn, c.args)).then(null, function () {}); } catch (e) { /* the draft expires on its own */ }
  }
  // s111: the receipt photo stays in memory (an object URL, never uploaded again or saved) while its lines are checked; a tap opens the shared zoom viewer.
  function relRcpt(me) { if (me && me.rcpt && root.URL && root.URL.revokeObjectURL) { try { root.URL.revokeObjectURL(me.rcpt); } catch (e) { /* gone */ } } if (me) me.rcpt = ''; }
  function keepRcpt(me, b) { relRcpt(me); try { me.rcpt = b && root.URL && root.URL.createObjectURL ? root.URL.createObjectURL(b) : ''; } catch (e) { me.rcpt = ''; } return b; }
  function rcptBox() {
    return S.rcpt ? '<div class="S_rcpt"><button class="S_rcptb" type="button" data-sact="rcpt-zoom" aria-label="Zoom the receipt photo"><img src="' + esc(S.rcpt) + '" alt="The receipt photo" draggable="false"></button><span class="K_sub">Tap the receipt to zoom in.</span></div>' : '';
  }
  function relPrev(l) { if (l && l.prev && root.URL && root.URL.revokeObjectURL) { try { root.URL.revokeObjectURL(l.prev); } catch (e) { /* gone */ } } if (l) l.prev = ''; }
  function say(t) { if (S && S.opts.toast) S.opts.toast(t); }
  function attr(t, n) { return t && t.getAttribute ? t.getAttribute(n) : null; }

  function loadItems() {
    var me = S; if (!me || !me.client) { if (me) { me.load = 'error'; draw(); } return; }
    Promise.resolve().then(function () { return me.client.rpc('get_inventory_catalogue_v1', { p_property_id: me.pid }); }).then(function (r) {
      if (S !== me) return;
      var items = r && !r.error ? normItems(r.data) : null;
      if (!items) { me.load = r && r.error && (r.error.code === '42501') ? 'forbidden' : 'error'; draw(); return; }
      me.items = items; me.load = 'ready';
      var cats = {}; items.forEach(function (i) { cats[i.category] = 1; }); me.cats = Object.keys(cats).sort(); if (me.cats.indexOf(CATS[0]) < 0) me.cats.unshift(CATS[0]);
      if (!me.use && !me.man.itemId && items[0]) me.man.itemId = items[0].id;
      draw();
    }, function () { if (S === me) { me.load = 'error'; draw(); } });
  }

  function field(id, label, val, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><div class="input"><input id="' + id + '" autocomplete="off" ' + (extra || '') + ' value="' + esc(val) + '"></div></div>'; }
  function selectOpts(opts, val) { return opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function stepper(id, val, label) {
    return '<div class="S_step" role="group" aria-label="' + esc(label) + '"><button class="S_stepb" type="button" data-sact="dec" data-id="' + esc(id) + '" aria-label="' + esc('One less ' + label) + '">' + gi('minus', 's16') + '</button>' +
      '<input class="S_qty" id="S_q_' + esc(id) + '" data-q="' + esc(id) + '" inputmode="decimal" autocomplete="off" aria-label="' + esc(label) + '" value="' + esc(val) + '">' +
      '<button class="S_stepb" type="button" data-sact="inc" data-id="' + esc(id) + '" aria-label="' + esc('One more ' + label) + '">' + gi('plus', 's16') + '</button></div>';
  }
  function head(title, sub) { return '<div class="S_head"><h2 class="hd">' + esc(title) + '</h2>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>'; }
  function thanks(text) { return '<p class="S_thanks" role="status">' + gi('sparkles', 's16') + '<span>' + esc(text) + '</span></p>'; }
  function errLine() { return S.msg ? '<p class="K_sub K_bad" role="alert">' + esc(S.msg) + '</p>' : ''; }

  function useList() {
    var q = S.find.trim().toLowerCase(), items = (S.items || []).filter(function (i) { return i.consumable && (!q || i.name.toLowerCase().indexOf(q) >= 0); });
    if (!items.length) return '<p class="sub">' + esc(q ? 'No item matches. Try a shorter word.' : 'No consumable items yet.') + '</p>';
    return '<div class="card glass K_lines S_list">' + items.map(function (i) {
      return '<div class="S_row"><span class="S_name"><b>' + esc(i.name) + '</b><span>' + esc(i.unit || '') + '</span></span>' + stepper(i.id, S.qtys[i.id] || '0', i.name) + '</div>';
    }).join('') + '</div>';
  }
  function drawUse() {
    if (S.step === 'done') return head('Recorded', 'What you used is now off the shelf count.') + thanks(S.result) + '<a class="btn btn-primary btn-block" href="#home">Done</a>';
    var n = usageRows(S.items || [], S.qtys, {}).length;
    return head('Report consumption', 'Add what you used. Leave the rest at 0.') + '<div class="field S_find"><label for="S_find">Find an item</label><div class="input"><input id="S_find" type="search" autocomplete="off" value="' + esc(S.find) + '"></div></div>' +
      '<div data-s-list>' + useList() + '</div>' + errLine() +
      '<div class="K_btns"><button class="btn btn-primary btn-block" type="button" data-sact="use-save"' + (S.busy || !n ? ' disabled' : '') + '>' + (S.busy ? 'Saving…' : n ? 'Record ' + plural(n, 'item') : 'Record') + '</button></div>';
  }

  function lineCard(l) {
    var it = l.itemId && (S.items || []).filter(function (x) { return x.id === l.itemId; })[0], bad = S.bad && S.bad[l.no];
    var what = l.mode === 'skip' ? '<span class="pill p-info">Skipped</span>' : l.mode === 'new' ? '<span class="pill p-ok">New item</span>' : it ? '<span class="pill p-ok">' + gi('check', 's16') + esc(it.name) + '</span>' : '<span class="pill p-warn">' + gi('alert', 's16') + 'No match yet</span>';
    var h = '<section class="card glass S_line" data-line="' + esc(l.no) + '"><div class="S_line-h"><b>' + esc(l.text || 'Item') + '</b><span class="K_sub">' + esc('on the receipt') + '</span></div><div class="S_line-m">' + what + '</div>';
    if (l.mode !== 'skip') {
      var unit = l.mode === 'new' ? String(l.nw.unit || '').trim() : it ? it.unit : '', pk = l.mode !== 'new' && it ? packInfo(it, l.rcpt) : null, lab = unit ? 'How many ' + unit : 'How many';
      h += '<div class="S_line-q"><span class="K_lab">' + esc(lab) + '</span>' + stepper('L' + l.no, l.qty, lab + ' for ' + (l.text || 'this line')) + '</div>';
      if (pk && pk.packed) h += '<p class="K_sub">' + esc(pk.text + (num(l.qty) !== pk.units ? ' · adding ' + l.qty + ' ' + pk.unit : '')) + '</p>';
    }
    if (l.mode === 'pick') h += '<div class="field"><label for="S_pick_' + esc(l.no) + '">Which item is it?</label><div class="input"><select id="S_pick_' + esc(l.no) + '" data-pick="' + esc(l.no) + '"><option value="">Choose an item</option>' + selectOpts((S.items || []).map(function (x) { return [x.id, x.name]; }), l.itemId) + '</select></div></div>';
    if (l.mode === 'new') {
      var n = l.nw;
      h += field('S_nn_' + l.no, 'Name', n.name, 'data-nw="name" data-line="' + esc(l.no) + '" maxlength="80"') +
        '<div class="field"><label for="S_nc_' + esc(l.no) + '">Category</label><div class="input"><select id="S_nc_' + esc(l.no) + '" data-nw="category" data-line="' + esc(l.no) + '">' + selectOpts((S.cats || CATS).map(function (c) { return [c, c]; }), n.category) + '</select></div></div>' +
        field('S_nu_' + l.no, 'Unit (pc, roll, bottle)', n.unit, 'data-nw="unit" data-line="' + esc(l.no) + '" maxlength="20"') +
        '<div class="field"><label for="S_ny_' + esc(l.no) + '">Used up by guests or cleaners?</label><div class="input"><select id="S_ny_' + esc(l.no) + '" data-nw="cons" data-line="' + esc(l.no) + '">' + selectOpts([['yes', 'Yes, it gets used up'], ['no', 'No, it stays in the house']], n.cons) + '</select></div></div>' +
        '<div class="S_photo">' + (l.prev ? '<img src="' + esc(l.prev) + '" alt="' + esc('Photo of ' + n.name) + '">' : '<span class="K_sub">No photo yet</span>') +
        '<label class="btn btn-secondary btn-sm S_file">' + gi('camera', 's16') + 'Add a photo<input type="file" accept="image/*" data-sfile="item" data-line="' + esc(l.no) + '" class="sr"></label></div>' +
        field('S_nl_' + l.no, 'Or use the photo from a product link (optional)', l.link, 'inputmode="url" autocapitalize="off" data-link="1" data-line="' + esc(l.no) + '" maxlength="500"') +
        '<button class="btn btn-ghost btn-sm" type="button" data-sact="link-use" data-line="' + esc(l.no) + '">Use that photo</button>' + (l.err ? '<p class="K_sub K_bad" role="alert">' + esc(l.err) + '</p>' : '');
    }
    if (bad) h += '<p class="K_sub K_bad" role="alert">' + esc(bad) + '</p>';
    h += '<div class="K_btns">' + (l.mode === 'pick' ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-sact="line-pick" data-line="' + esc(l.no) + '">' + (l.matchId || l.itemId ? 'Change item' : 'Pick item') + '</button>') +
      (l.mode === 'new' ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-sact="line-new" data-line="' + esc(l.no) + '">New item</button>') +
      (l.mode === 'skip' ? '<button class="btn btn-ghost btn-sm" type="button" data-sact="line-keep" data-line="' + esc(l.no) + '">Keep this line</button>' : '<button class="btn btn-ghost btn-sm" type="button" data-sact="line-skip" data-line="' + esc(l.no) + '">Skip</button>') + '</div></section>';
    return h;
  }
  function drawSupply() {
    var st = S.step;
    if (S.load === 'error' || S.load === 'forbidden') return head('Report supply') + '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc(S.load === 'forbidden' ? 'This page is not open to your account. Ask Lloyd.' : 'The item list could not be loaded. Try again in a moment.') + '</span></div>';
    if (st === 'start') {
      return head('Report supply', 'A photo of the receipt is enough. We will read it, and you check each line.') +
        '<div class="S_start"><label class="btn btn-primary btn-block S_file">' + gi('camera', 's24') + 'Take a photo of the receipt<input type="file" accept="image/*" capture="environment" data-sfile="receipt" class="sr"></label>' +
        '<label class="btn btn-secondary btn-block S_file">' + gi('image', 's24') + 'Choose a photo or file<input type="file" accept="image/*" data-sfile="receipt" class="sr"></label>' +
        '<button class="btn btn-ghost btn-block" type="button" data-sact="manual">Enter it by hand instead</button></div>' + errLine();
    }
    if (st === 'reading') return head('Reading the receipt', 'One moment.') + '<div class="skel" style="height:96px"></div><p class="help" role="status">This can take up to half a minute.</p>';
    if (st === 'manual') {
      var m = S.man, mit = (S.items || []).filter(function (x) { return x.id === m.itemId; })[0], mlab = mit && mit.unit ? 'How many ' + mit.unit : 'How many';
      return head('Enter it by hand', 'Pick the item and how many came in. Count single ' + (mit && mit.unit ? mit.unit : 'units') + ', not packs.') + '<div class="field"><label for="S_mi">Item</label><div class="input"><select id="S_mi" data-man="item">' + selectOpts((S.items || []).map(function (x) { return [x.id, x.name]; }), m.itemId) + '</select></div></div>' +
        '<div class="S_line-q"><span class="K_lab">' + esc(mlab) + '</span>' + stepper('M', m.qty, mlab) + '</div>' +
        (mit && mit.purchaseUnit && mit.perPack > 1 ? '<p class="K_sub">' + esc('One ' + mit.purchaseUnit + ' is ' + mit.perPack + ' ' + (mit.unit || 'units') + '.') + '</p>' : '') + errLine() +
        '<div class="K_btns"><button class="btn btn-primary btn-block" type="button" data-sact="man-save"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving…' : 'Add to stock') + '</button><button class="btn btn-ghost btn-block" type="button" data-sact="to-start">Back</button></div>';
    }
    if (st === 'review' || st === 'saving') {
      var d = S.draft || {};
      return head('Check each line', [d.vendor ? String(d.vendor) : '', d.purchased_on ? String(d.purchased_on) : ''].filter(Boolean).join(' · ') || 'Match each line to an item in the house.') +
        rcptBox() + (S.lines.length ? S.lines.map(lineCard).join('') : '<p class="sub">No lines were found on this receipt. You can enter it by hand.</p>') + errLine() +
        '<div class="K_btns"><button class="btn btn-primary btn-block" type="button" data-sact="confirm"' + (S.busy || !S.lines.length ? ' disabled' : '') + '>' + (S.busy ? 'Adding…' : 'Add to stock') + '</button><button class="btn btn-ghost btn-block" type="button" data-sact="cancel"' + (S.busy ? ' disabled' : '') + '>Cancel</button></div>';
    }
    if (st === 'done') {
      return head('Added to stock') + thanks(S.result) + (S.photoNote ? '<p class="K_sub">' + esc(S.photoNote) + '</p>' : '') + errLine() +
        '<div class="K_btns">' + (S.canUndo ? '<button class="btn btn-secondary btn-block" type="button" data-sact="undo"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Undoing…' : 'Undo') + '</button>' : '') + '<a class="btn btn-primary btn-block" href="#home">Done</a></div>';
    }
    if (st === 'undone') return head('Undone') + thanks('The stock is back as it was. You can add the receipt again if you need to.') + '<a class="btn btn-primary btn-block" href="#home">Done</a>';
    return '';
  }
  function draw() {
    if (!S) return;
    var body = S.load === 'loading' && !S.items ? '<div class="skel" style="height:120px"></div>' : S.use ? (S.load === 'ready' ? drawUse() : head('Report consumption') + '<div class="errbox" role="alert">' + gi('alert') + '<span>' + esc('The item list could not be loaded. Try again in a moment.') + '</span></div>') : drawSupply();
    S.el.innerHTML = '<div class="K_wrap S_wrap">' + body + '<div class="sr" role="status" aria-live="polite" data-s-live></div></div>';
  }
  function drawList() { var box = S.el.querySelector && S.el.querySelector('[data-s-list]'); if (box) box.innerHTML = useList(); else draw(); }

  /* ---------------------------------------------------------------- events */
  function lineOf(no) { return S.lines.filter(function (l) { return String(l.no) === String(no); })[0] || null; }
  function onInput(ev) {
    var t = ev.target; if (!S || !t) return;
    var id = t.id || '', q = attr(t, 'data-q'), nw = attr(t, 'data-nw'), ln = attr(t, 'data-line');
    if (id === 'S_find') { S.find = t.value; drawList(); return; }
    if (q) { setQty(q, t.value); return; }
    if (nw && ln) { var l = lineOf(ln); if (l) l.nw[nw] = t.value; return; }
    if (attr(t, 'data-link') && ln) { var l2 = lineOf(ln); if (l2) l2.link = t.value; }
  }
  function repack(l) { var it = l.itemId && (S.items || []).filter(function (x) { return x.id === l.itemId; })[0]; if (it) l.qty = fmt(packInfo(it, l.rcpt).units); }
  function setQty(id, v) { if (id === 'M') { S.man.qty = v; S.man.key = ''; } // a changed amount is a new entry, so it gets a new key
    else if (/^L/.test(id)) { var l = lineOf(id.slice(1)); if (l) l.qty = v; } else S.qtys[id] = v; }
  function getQty(id) { return id === 'M' ? S.man.qty : /^L/.test(id) ? (lineOf(id.slice(1)) || {}).qty : S.qtys[id]; }
  function onChange(ev) {
    var t = ev.target; if (!S || !t) return;
    var kind = attr(t, 'data-sfile'), ln = attr(t, 'data-line'), nw = attr(t, 'data-nw'), pk = attr(t, 'data-pick'), mn = attr(t, 'data-man');
    if (kind === 'receipt') { var f = t.files && t.files[0]; if (f) receiptPicked(f); return; }
    if (kind === 'item') { var f2 = t.files && t.files[0], l = lineOf(ln); if (f2 && l) itemPhoto(l, function () { return f2; }); return; }
    if (nw && ln) { var l3 = lineOf(ln); if (l3) l3.nw[nw] = t.value; return; }
    if (pk) { var l4 = lineOf(pk); if (l4) { l4.itemId = t.value; l4.mode = t.value ? 'item' : 'pick'; if (t.value) repack(l4); if (S.bad) delete S.bad[l4.no]; draw(); } return; }
    if (mn === 'item') { S.man.itemId = t.value; S.man.key = ''; draw(); }
  }
  function onSubmit(ev) { if (ev && ev.preventDefault) ev.preventDefault(); }
  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-sact]') : null; if (!S || !t) return;
    var act = attr(t, 'data-sact'), id = attr(t, 'data-id'), ln = attr(t, 'data-line'), l = ln != null ? lineOf(ln) : null;
    if (act === 'inc' || act === 'dec') { var nv = stepQty(getQty(id), act === 'inc' ? 1 : -1); setQty(id, nv); if (S.use) { drawList(); updateSave(); } else draw(); return; }
    if (act === 'use-save') { saveUse(); return; }
    if (act === 'manual') { S.step = 'manual'; S.msg = ''; draw(); return; }
    if (act === 'rcpt-zoom') { if (S.rcpt && root.CSZoom) root.CSZoom.open(S.rcpt, { alt: 'The receipt photo', opener: t }); return; }
    if (act === 'to-start') { S.step = 'start'; S.msg = ''; draw(); return; }
    if (act === 'man-save') { saveManual(); return; }
    if (!l && /^(line-|link-)/.test(act || '')) return;
    if (act === 'line-pick') { l.mode = 'pick'; draw(); return; }
    if (act === 'line-new') { l.mode = 'new'; l.qty = fmt(l.rcpt); if (S.bad) delete S.bad[l.no]; draw(); return; }
    if (act === 'line-skip') { l.mode = 'skip'; if (S.bad) delete S.bad[l.no]; draw(); return; }
    if (act === 'line-keep') { l.mode = l.matchId ? 'match' : 'unset'; if (l.matchId) { l.itemId = l.matchId; repack(l); } draw(); return; }
    if (act === 'link-use') { var u = picUrl(l.link); if (!u) { l.err = 'The photo link must be an https image on cdn.shopify.com or down-ph.img.susercontent.com.'; draw(); return; } l.err = ''; itemPhoto(l, function () { return fetchPicture(u); }); return; }
    if (act === 'confirm') { confirm(); return; }
    if (act === 'cancel') { if (S.busy) return; cancelDraft(S); if (S.opts.navigate) S.opts.navigate('#home'); return; }
    if (act === 'undo') { undo(); return; }
  }
  function updateSave() { var b = S.el.querySelector && S.el.querySelector('[data-sact="use-save"]'); if (!b) { draw(); return; } var n = usageRows(S.items || [], S.qtys, {}).length; b.textContent = n ? 'Record ' + plural(n, 'item') : 'Record'; b.disabled = !n || S.busy; }

  function fetchPicture(url) {
    if (typeof root.fetch !== 'function') return Promise.reject({ photo: 'optfetch' });
    return Promise.resolve().then(function () { return root.fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }); }).then(function (r) { if (!r || !r.ok) throw 0; return r.blob(); }).then(null, function () { throw { photo: 'optfetch' }; });
  }
  function itemPhoto(l, get) {
    var me = S; l.err = '';
    Promise.resolve().then(get).then(function (f) { return resizeImage(f, 800, PHOTO_MAX); }).then(function (b) {
      if (S !== me) return; relPrev(l); l.blob = b; try { l.prev = root.URL && root.URL.createObjectURL ? root.URL.createObjectURL(b) : ''; } catch (e) { l.prev = ''; } draw();
    }, function (e) { if (S === me) { l.err = PHOTO_ERR[e && e.photo] || PHOTO_ERR.photofail; draw(); } });
  }

  /* ---------------------------------------------------------------- the writes */
  function saveUse() {
    var me = S; if (!me || me.busy) return;
    var rows = usageRows(me.items || [], me.qtys, me.keys); if (!rows.length) return;
    var c = usageCall(me.pid, rows, manilaToday()); me.busy = true; me.msg = ''; draw();
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (S !== me) return; me.busy = '';
      if (!r || r.error || (r.data && r.data.ok === false)) { me.busy = false; me.msg = errText(r && r.error, r && r.data); draw(); return; }
      me.busy = false; me.step = 'done'; me.result = 'Thank you. ' + plural(rows.length, 'item') + ' recorded.'; say('Recorded'); draw();
    }, function (e) { if (S === me) { me.busy = false; me.msg = errText(e); draw(); } });
  }
  function saveManual() {
    var me = S; if (!me || me.busy) return;
    var it = (me.items || []).filter(function (x) { return x.id === me.man.itemId; })[0], qty = qtyOf(me.man.qty);
    if (!it || qty == null) { me.msg = 'Pick the item and how many came in.'; draw(); return; }
    me.man.key = me.man.key || newKey('man'); var c = manualCall(it, qty, me.man.key, manilaToday()); me.busy = true; me.msg = ''; draw(); // the same key on a retry: the entry is recorded once
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (S !== me) return; me.busy = false;
      if (!r || r.error || !r.data || r.data.ok === false) { me.msg = errText(r && r.error, r && r.data); draw(); return; }
      var did = r.data.draft_id ? String(r.data.draft_id) : ''; // the answer carries the entry's id, which is what Undo needs
      me.draft = did ? { id: did } : null; me.step = 'done'; me.canUndo = !!did; me.result = 'Thank you. ' + qty + ' ' + (it.unit || 'units') + ' of ' + it.name + ' added to stock.'; say('Added to stock'); draw();
    }, function (e) { if (S === me) { me.busy = false; me.msg = errText(e); draw(); } });
  }
  function receiptPicked(file) {
    var me = S; if (!me || me.step === 'reading') return;
    if (/pdf/i.test(String(file.type || '')) || /\.pdf$/i.test(String(file.name || ''))) { me.msg = PHOTO_ERR.notimage; draw(); return; }
    me.step = 'reading'; me.msg = ''; draw();
    resizeImage(file, RECEIPT_SIDE, 2 * PHOTO_MAX).then(function (b) { return keepRcpt(me, b); }).then(blobBase64).then(function (b64) {
      return me.client.functions.invoke('ocr-receipt', { body: { mode: 'supply', image_base64: b64, mime_type: 'image/jpeg' } });
    }).then(function (r) {
      if (S !== me) return;
      var st = r && r.error && r.error.context && r.error.context.status;
      if (st === 429 || (r && r.data && r.data.error === 'daily_limit')) throw { limit: true };
      var id = r && !r.error && r.data && r.data.ok !== false ? r.data.draft_id : null;
      if (!id) throw { read: true };
      return me.client.rpc('inventory_receipt_draft_v1', { p_draft_id: id }).then(function (d) {
        if (S !== me) return;
        if (!d || d.error || !d.data || d.data.ok === false) throw { read: true };
        me.draft = d.data.draft || {}; me.draft.id = me.draft.id || id; me.lines = draftLines(me.draft); me.lines.forEach(function (l) { if (l.matchId) { l.itemId = l.matchId; repack(l); } }); me.bad = null; me.confirmKey = newKey('rcpt'); me.step = 'review'; draw();
      });
    }).then(null, function (e) {
      if (S !== me) return; me.step = 'start'; relRcpt(me);
      me.msg = e && e.photo ? PHOTO_ERR[e.photo] : e && e.limit ? 'Receipts have been read enough times today. Enter it by hand instead.' : e && e.read ? 'The receipt could not be read. Try a clearer photo, or enter it by hand.' : errText(e); draw();
    });
  }
  function confirm() {
    var me = S; if (!me || me.busy || !me.draft || me.step !== 'review') return; // a second press after Added to stock is ignored
    var built = confirmLines(me.lines);
    if (!built.lines) { me.bad = built.bad; me.msg = built.none ? 'Every line is skipped. Keep at least one, or cancel.' : 'A few lines need a choice first.'; draw(); return; }
    me.bad = null; me.msg = ''; me.busy = true; draw();
    var c = confirmCall(me.draft.id, built.lines, me.draft.purchased_on, me.confirmKey);
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (S !== me) return;
      if (!r || r.error || !r.data || r.data.ok === false) { me.busy = false; me.msg = errText(r && r.error, r && r.data); draw(); return; }
      var res = r.data, n = res.purchase_count != null ? res.purchase_count : built.lines.filter(function (x) { return !x.skip; }).length;
      me.busy = false; me.step = 'done'; me.canUndo = true; me.lines.forEach(relPrev); me.result = 'Thank you. ' + plural(n, 'line') + ' added to stock. The owner will see the receipt to check.'; say('Added to stock');
      draw(); return uploadNewPhotos(me, res, built.lines);
    }, function (e) { if (S === me) { me.busy = false; me.msg = errText(e); draw(); } });
  }
  // After the items exist: each new item's photo goes up through the item-photo pipeline (upload-photo, then inventory_item_photo_set_v1). A failure never undoes the stock.
  function uploadNewPhotos(me, res, lines) {
    var ids = newItemIds(res, lines), todo = me.lines.filter(function (l) { return l.mode === 'new' && l.blob; }), failed = [];
    if (!todo.length) return Promise.resolve();
    return todo.reduce(function (p, l) {
      return p.then(function () {
        var itemId = ids[l.no]; if (!itemId) { failed.push(l.nw.name); return; }
        return blobBase64(l.blob).then(function (b64) { return me.client.functions.invoke('upload-photo', { body: { purpose: 'inventory', propertyId: me.pid, itemId: itemId, fileData: b64, mimeType: l.blob.type || 'image/jpeg' } }); }).then(function (u) {
          if (!u || u.error || !u.data || u.data.ok === false || !u.data.path) throw 0;
          return me.client.rpc('inventory_item_photo_set_v1', { p_item_id: itemId, p_path: u.data.path });
        }).then(function (r) { if (!r || r.error || (r.data && r.data.ok === false)) throw 0; }).then(null, function () { failed.push(l.nw.name); });
      });
    }, Promise.resolve()).then(function () {
      if (S !== me) return;
      if (failed.length) { me.photoNote = 'The photo for ' + failed.join(', ') + ' could not be added. You can add it from Inventory.'; draw(); }
    });
  }
  function undo() {
    var me = S; if (!me || me.busy || !me.draft || me.step !== 'done' || !me.canUndo) return; me.busy = true; me.msg = ''; draw();
    var c = undoCall(me.draft.id);
    Promise.resolve().then(function () { return me.client.rpc(c.fn, c.args); }).then(function (r) {
      if (S !== me) return; me.busy = false;
      if (!r || r.error || (r.data && r.data.ok === false)) {
        var uc = r && r.data && r.data.error, UNDO = { stock_moved: 'Some of it is already used, so it cannot be undone here. Tell Lloyd what to change.', already_reviewed: 'The owner has already checked this receipt. Ask Lloyd to change it.', not_confirmed: 'This receipt was never added, so there is nothing to undo.' };
        me.msg = UNDO[uc] || 'The undo did not go through. Ask Lloyd to take a look.'; if (UNDO[uc]) me.canUndo = false; draw(); return;
      }
      me.step = 'undone'; me.canUndo = false; say('Undone'); draw();
    }, function () { if (S === me) { me.busy = false; me.msg = 'No connection. The undo did not go through.'; draw(); } });
  }

  root.S110_Supply = { mount: mount, unmount: unmount, reset: reset, lib: {
    esc: esc, normItems: normItems, usageRows: usageRows, usageCall: usageCall, draftLines: draftLines, confirmLines: confirmLines, confirmCall: confirmCall, undoCall: undoCall, cancelCall: cancelCall, manualCall: manualCall, packInfo: packInfo, cancelDraft: cancelDraft,
    newItemIds: newItemIds, picUrl: picUrl, stepQty: stepQty, qtyOf: qtyOf, errText: errText, newKey: newKey, fitSize: fitSize
  } };
})(typeof window !== 'undefined' ? window : this);
