/* Cascade Staff - Inventory suppliers, supplier picker and price history (s86 lane D-client-sup). Plain script, no build step.
   Exposes window.I_Suppliers = { mountList(host, ctx), pick(ctx, {itemId, selectedId, preferredId?}), openPriceHistory(ctx, item), openItemSuppliers(ctx, item), lib }.
   ctx = { client, role, propertyId, esc, toast, confirm(text) -> Promise<bool>, undo(label, fn), haptic, nowMs }.
   undo fn: returns a promise that resolves on success and rejects when the server refuses.
   Privacy: the server decides (R1 sends a cleaner only id, name, location, maps_url, active). This file also never reads or draws anything else for a cleaner.
   Every RPC probes and hides: PGRST202 / 404 means the feature is not live yet, never an error box. */
(function (root) {
  'use strict';

  var PAY = [['cash', 'Cash'], ['gcash', 'GCash'], ['maya', 'Maya'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['cod', 'Cash on delivery'], ['online', 'Online']];
  var PAYW = {}; PAY.forEach(function (p) { PAYW[p[0]] = p[1]; });
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var K = { missing: false, cache: null, listMissing: false }; // per visit: R1 missing hides the picker; cache = { pid, at, rows }
  var CACHE_MS = 60000;

  /* ---------------------------------------------------------------- pure helpers */
  function esc0(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function E(ctx) { return (ctx && ctx.esc) || esc0; }
  function gi(n, size) { return root.ICON ? root.ICON(n, size) : ''; }
  function isManage(role) { return role === 'owner' || role === 'admin'; }
  function canPrice(role) { return role === 'owner' || role === 'admin' || role === 'finance'; }
  function num(v) { var n = typeof v === 'number' ? v : (v == null || v === '' ? NaN : parseFloat(v)); return isFinite(n) ? n : null; }
  function money(v) { var n = num(v); if (n == null) return ''; var r = Math.round(n * 100) / 100, s = (Math.abs(r - Math.round(r)) < 0.005 ? String(Math.round(r)) : r.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return 'PHP ' + s; }
  function nowMs(ctx) { return ctx && typeof ctx.nowMs === 'function' ? ctx.nowMs() : Date.now(); }
  // The house is in Manila (UTC+8, no daylight saving): shift, then read the UTC parts. The year shows only when it is not this year.
  function fmtDate(iso, now) {
    var t = typeof iso === 'number' ? iso : Date.parse(iso); if (!isFinite(t)) return '';
    var d = new Date(t + 8 * 3600000), n = new Date((now || t) + 8 * 3600000);
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + (d.getUTCFullYear() !== n.getUTCFullYear() ? ' ' + d.getUTCFullYear() : '');
  }
  function errKind(e, online) {
    if (online === false) return 'offline';
    if (!e) return 'other';
    var code = String(e.code || ''), msg = String(e.message || ''), st = e.status || (e.context && e.context.status);
    if (code === '42501' || st === 401 || st === 403 || /not authori[sz]ed|permission denied|access denied|denied/i.test(msg)) return 'refused';
    if (code === 'PGRST202' || code === '42883' || st === 404 || /could not find the function|does not exist/i.test(msg)) return 'missing';
    if (!code && !st && (e.name === 'TypeError' || e.name === 'FunctionsFetchError' || /failed to fetch|network|load failed|fetch/i.test(msg))) return 'offline';
    return 'other';
  }
  var ERR = {
    offline: 'No connection, so nothing was sent.',
    refused: 'This sign-in is not allowed to do that.',
    missing: 'This is not available yet.',
    other: 'That did not go through. Please try again.'
  };
  function online() { var n = root.navigator; return !(n && n.onLine === false); }
  function newKey(kind) {
    var r = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return 'sup-' + kind + '-' + String(r).replace(/-/g, '');
  }
  function call(ctx, name, args) {
    return Promise.resolve(ctx.client.rpc(name, args)).then(function (r) { if (r && r.error) throw r.error; return r ? r.data : null; });
  }
  function count(v) { return Array.isArray(v) ? v.length : (num(v) || 0); }

  // A supplier as the screen holds it. Without `full` (the cleaner) only the five keys that R1 sends survive, whatever else arrives.
  function normSupplier(r, full) {
    r = r || {};
    var o = { id: r.id, name: String(r.name || ''), location: r.location || '', maps_url: /^https:\/\//.test(r.maps_url || '') ? r.maps_url : '', active: r.active !== undefined ? r.active !== false : r.is_active !== false };
    if (!full) return o;
    o.phone = r.phone || ''; o.payment = r.payment || r.payment_method || ''; o.notes = r.notes || ''; o.items = count(r.items); o.last_bought_at = r.last_bought_at || null;
    return o;
  }
  function normList(data, full) {
    var rows = (data && data.suppliers) || [];
    return rows.map(function (r) { return normSupplier(r, full); }).filter(function (s) { return s.id; });
  }
  // Picker order: the item's usual supplier first, then the most recently bought from, then by name. Inactive ones are left out.
  function orderPicker(rows, preferredId) {
    return rows.filter(function (s) { return s.active; }).sort(function (a, b) {
      if (preferredId) { if (a.id === preferredId && b.id !== preferredId) return -1; if (b.id === preferredId && a.id !== preferredId) return 1; }
      var ta = a.last_bought_at ? Date.parse(a.last_bought_at) : -1, tb = b.last_bought_at ? Date.parse(b.last_bought_at) : -1;
      if (ta !== tb) return tb - ta;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
  }
  // Sparkline: price per unit over time, oldest at the left. rows arrive newest first (R6).
  function sparkPoints(rows, w, h) {
    w = w || 280; h = h || 80;
    var pts = (rows || []).map(function (r) { return { at: r.at, t: Date.parse(r.at), v: num(r.unit_price), supplier: r.supplier || '' }; }).filter(function (p) { return isFinite(p.t) && p.v != null; }).reverse();
    pts.sort(function (a, b) { return a.t - b.t; });
    if (!pts.length) return { points: [], path: '' };
    var padX = 10, padY = 12, t0 = pts[0].t, t1 = pts[pts.length - 1].t, lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
    var r1 = function (n) { return Math.round(n * 10) / 10; };
    pts.forEach(function (p, i) {
      p.x = r1(pts.length === 1 ? w / 2 : t1 > t0 ? padX + (p.t - t0) / (t1 - t0) * (w - 2 * padX) : padX + i / (pts.length - 1) * (w - 2 * padX));
      p.y = r1(hi > lo ? padY + (1 - (p.v - lo) / (hi - lo)) * (h - 2 * padY) : h / 2);
    });
    return { points: pts, path: pts.map(function (p) { return p.x + ',' + p.y; }).join(' ') };
  }
  // "Cheaper last time at KCC": another supplier whose last price per unit is lower than the last price paid.
  function cheaperLast(d) {
    if (!d) return null;
    var rows = d.rows || [], last = num(d.stats && d.stats.last); if (last == null && rows[0]) last = num(rows[0].unit_price);
    var mine = rows[0] ? rows[0].supplier_id : null, best = null;
    if (last == null) return null;
    (d.by_supplier || []).forEach(function (s) {
      var p = num(s.last_unit_price); if (p == null || s.supplier_id === mine || !(p < last)) return;
      if (!best || p < best.price) best = { name: s.name, price: p };
    });
    return best;
  }
  function statsLine(st) {
    if (!st) return '';
    var a = [];
    if (num(st.last) != null) a.push('Last ' + money(st.last));
    if (num(st.avg_180d) != null) a.push('6-month average ' + money(st.avg_180d));
    if (num(st.min_365d) != null) a.push('lowest in a year ' + money(st.min_365d));
    return a.join(' · ');
  }
  var SRC = { app: 'Added in the app', telegram: 'From a Telegram receipt', old: 'Earlier record' };

  /* ---------------------------------------------------------------- the sheet engine (one overlay per sheet, on the page body) */
  function openSheet(o) {
    var doc = root.document, el = doc.createElement('div'), s = { el: el, closed: false, focused: false };
    el.className = 'S_layer';
    s.draw = function () {
      if (s.closed) return;
      el.innerHTML = '<div class="scrim on" data-s-act="close"></div><div class="sheet on S_sheet" role="dialog" aria-modal="true" aria-labelledby="S_sh_t">' + o.render(s) + '</div>';
      if (!s.focused) { s.focused = true; var h = el.querySelector('#S_sh_t'); if (h && h.focus) h.focus(); }
    };
    s.refocus = function (id) { var n = el.querySelector('#' + id); if (n && n.focus) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* not a text box */ } } };
    s.close = function (r) {
      if (s.closed) return; s.closed = true;
      try { doc.body.removeChild(el); } catch (e) { /* already gone */ }
      if (o.onClose) o.onClose(r);
    };
    el.addEventListener('click', function (ev) {
      var t = ev.target, b = t && t.closest ? t.closest('[data-s-act]') : null; if (!b) return;
      var act = b.getAttribute('data-s-act'); if (act === 'close') return s.close();
      if (b.tagName === 'A') return; // links (Map, Call) follow themselves
      o.act(act, b, s);
    });
    el.addEventListener('submit', function (ev) { if (ev.preventDefault) ev.preventDefault(); if (o.submit) o.submit(s); });
    var inp = function (ev) { var t = ev.target; if (t && t.id && o.input) o.input(t.id.replace(/^S_f_/, ''), t.value, s); };
    el.addEventListener('input', inp); el.addEventListener('change', inp);
    el.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') s.close(); });
    doc.body.appendChild(el);
    s.draw();
    return s;
  }
  function head(ctx, title, sub) { var e = E(ctx); return '<h2 class="hd S_sht" id="S_sh_t" tabindex="-1">' + e(title) + '</h2>' + (sub ? '<p class="help">' + e(sub) + '</p>' : ''); }
  function errBox(ctx, key) { return key ? '<div class="errbox" role="alert">' + gi('alert') + '<span>' + E(ctx)(ERR[key] || key) + '</span></div>' : ''; }
  function field(ctx, id, label, val, extra) { var e = E(ctx); return '<div class="field"><label for="S_f_' + id + '">' + e(label) + '</label><div class="input"><input id="S_f_' + id + '" autocomplete="off" ' + (extra || '') + ' value="' + e(val) + '"></div></div>'; }
  function payField(ctx, val) {
    var e = E(ctx);
    return '<div class="field"><label for="S_f_payment">How you pay</label><div class="input"><select id="S_f_payment"><option value="">Not set</option>' + PAY.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === val ? ' selected' : '') + '>' + e(p[1]) + '</option>'; }).join('') + '</select></div></div>';
  }
  function say(ctx, m) { if (ctx.toast) ctx.toast(m); }
  function buzz(ctx, k) { if (ctx.haptic) { try { ctx.haptic(k || 'ok'); } catch (e) { /* no haptics here */ } } }

  /* ---------------------------------------------------------------- supplier list (R1) */
  function loadList(ctx) {
    var full = canPrice(ctx.role);
    return call(ctx, 'inventory_supplier_list_v1', { p_property_id: ctx.propertyId }).then(function (d) { return normList(d, full); });
  }
  function validate(v) {
    var name = String(v.name || '').trim(), ph = String(v.phone || '').trim(), loc = String(v.location || '').trim(), mu = String(v.maps_url || '').trim(), nt = String(v.notes || '').trim(), errs = {};
    if (name.length < 2 || name.length > 80) errs.name = 'Use a name of 2 to 80 characters.';
    if (ph && !/^[0-9+() -]{7,20}$/.test(ph)) errs.phone = 'Use digits, spaces, + ( ) or -, 7 to 20 characters.';
    if (loc.length > 120) errs.location = 'Keep this under 120 characters.';
    if (mu && !/^https:\/\/[^ ]{5,300}$/.test(mu)) errs.maps_url = 'A map link starts with https:// and has no spaces.';
    if (nt.length > 500) errs.notes = 'Keep this under 500 characters.';
    return { ok: !Object.keys(errs).length, errs: errs, vals: { name: name, phone: ph, location: loc, maps_url: mu, payment: v.payment || '', notes: nt } };
  }
  function fieldErr(errs, k) { return errs[k] ? '<p class="err" role="alert">' + gi('alert', 's16') + '<span>' + esc0(errs[k]) + '</span></p>' : ''; }

  function mountList(host, ctx) {
    if (host.__sOff) host.__sOff();
    var full = canPrice(ctx.role), canAdd = full, e = E(ctx);
    var S = { phase: 'load', rows: [], err: null, more: false };
    function row(s, dim) {
      var meta = [];
      if (s.location) meta.push(e(s.location));
      if (full) {
        if (s.payment) meta.push(e(PAYW[s.payment] || s.payment));
        meta.push(e(s.items + (s.items === 1 ? ' item' : ' items') + (s.last_bought_at ? ', last bought ' + fmtDate(s.last_bought_at, nowMs(ctx)) : '')));
      }
      return '<button class="rowi S_row" type="button" data-s-act="open" data-id="' + e(s.id) + '"><span class="S_rt"><span class="t">' + e(s.name) + (dim ? ' <span class="S_tag">Not in use</span>' : '') + '</span><span class="s">' + (meta.join(' · ') || (full ? '' : 'No place listed')) + '</span></span>' + gi('chev') + '</button>';
    }
    function draw() {
      var act = S.rows.filter(function (s) { return s.active; }), off = full ? S.rows.filter(function (s) { return !s.active; }) : [];
      var body;
      if (S.phase === 'load') body = '<p class="help S_load" role="status">Loading suppliers…</p>';
      else if (S.phase === 'missing') body = '<p class="help" role="status">Suppliers are not available yet.</p>';
      else if (S.phase === 'err') body = errBox(ctx, S.err) + '<button class="btn btn-secondary" type="button" data-s-act="retry">Try again</button>';
      else {
        body = act.length ? '<div class="card list S_list">' + act.map(function (s) { return row(s); }).join('') + '</div>' : '<p class="help">' + (full ? 'No suppliers yet. Add one when you next buy something.' : 'No shops are listed yet.') + '</p>';
        if (off.length) body += '<button class="btn btn-ghost S_more" type="button" data-s-act="more" aria-expanded="' + (S.more ? 'true' : 'false') + '">Not used any more (' + off.length + ')</button>' + (S.more ? '<div class="card list S_list">' + off.map(function (s) { return row(s, true); }).join('') + '</div>' : '');
      }
      host.innerHTML = '<div class="S_wrap"><div class="S_head"><h2 class="S_h">Suppliers</h2>' + (canAdd && S.phase === 'ok' ? '<button class="btn btn-secondary S_new" type="button" data-s-act="new">' + gi('plus', 's16') + ' New supplier</button>' : '') + '</div>' + body + '</div>';
    }
    function load() {
      S.phase = S.rows.length ? S.phase : 'load'; if (!S.rows.length) draw();
      return loadList(ctx).then(function (rows) { S.rows = rows; S.phase = 'ok'; K.cache = null; draw(); }, function (er) {
        var k = errKind(er, online()); if (k === 'missing') { S.phase = 'missing'; K.missing = true; } else { S.phase = S.rows.length ? 'ok' : 'err'; S.err = k; if (S.rows.length) say(ctx, ERR[k]); } draw();
      });
    }
    function find(id) { return S.rows.filter(function (s) { return s.id === id; })[0]; }
    function onClick(ev) {
      var t = ev.target, b = t && t.closest ? t.closest('[data-s-act]') : null; if (!b) return;
      var act = b.getAttribute('data-s-act');
      if (act === 'retry') return load();
      if (act === 'more') { S.more = !S.more; return draw(); }
      if (act === 'new' && canAdd) return supplierForm(ctx, null, load);
      if (act === 'open') { var s = find(b.getAttribute('data-id')); if (s) supplierCard(ctx, s, load); }
    }
    host.addEventListener('click', onClick);
    host.__sOff = function () { host.removeEventListener('click', onClick); host.__sOff = null; };
    load();
    return { refresh: load, destroy: function () { if (host.__sOff) host.__sOff(); } };
  }

  /* ---------------------------------------------------------------- supplier card (read-only for a cleaner) */
  function supplierCard(ctx, sup, onChange) {
    var full = canPrice(ctx.role), e = E(ctx), S = { items: null, itemsErr: null, hide: false };
    function itemsHtml() {
      if (!full || S.hide) return '';
      if (S.itemsErr) return '<h3 class="S_hh">Items bought here</h3><p class="help">' + e(ERR[S.itemsErr] || ERR.other) + '</p>';
      if (!S.items) return '<h3 class="S_hh">Items bought here</h3><p class="help" role="status">Loading…</p>';
      if (!S.items.length) return '<h3 class="S_hh">Items bought here</h3><p class="help">Nothing bought here yet.</p>';
      return '<h3 class="S_hh">Items bought here</h3><ul class="S_il">' + S.items.map(function (i) {
        var p = [];
        if (num(i.last_unit_price) != null) p.push(money(i.last_unit_price) + ' each');
        if (num(i.last_pack_price) != null) p.push(money(i.last_pack_price) + ' a pack' + (num(i.pack_size) > 1 ? ' of ' + num(i.pack_size) : ''));
        return '<li><span class="t">' + e(i.name) + '</span><span class="s">' + e(p.join(' · ') + (i.last_at ? (p.length ? ', ' : '') + fmtDate(i.last_at, nowMs(ctx)) : '')) + '</span></li>';
      }).join('') + '</ul>';
    }
    function render() {
      var tel = sup.phone ? String(sup.phone).replace(/[^0-9+]/g, '') : '';
      var btns = '';
      if (full && tel) btns += '<a class="btn btn-secondary S_act" data-s-act="call" href="tel:' + e(tel) + '">Call</a>';
      if (sup.maps_url) btns += '<a class="btn btn-secondary S_act" data-s-act="map" href="' + e(sup.maps_url) + '" target="_blank" rel="noopener noreferrer">' + gi('ext', 's16') + ' Map</a>';
      var dl = '';
      if (full) {
        if (sup.payment) dl += '<div class="I_kv"><dt>How you pay</dt><dd>' + e(PAYW[sup.payment] || sup.payment) + '</dd></div>';
        if (sup.phone) dl += '<div class="I_kv"><dt>Number</dt><dd>' + e(sup.phone) + '</dd></div>';
        if (sup.notes) dl += '<div class="I_kv"><dt>Notes</dt><dd>' + e(sup.notes) + '</dd></div>';
      }
      return head(ctx, sup.name, sup.location ? sup.location : (full ? '' : 'No place listed')) +
        (sup.active ? '' : '<p class="help"><span class="S_tag">Not in use</span> This supplier is not used any more.</p>') +
        (btns ? '<div class="S_btns">' + btns + '</div>' : '') + (dl ? '<dl class="I_dl">' + dl + '</dl>' : '') + itemsHtml() +
        (full ? '<div class="I_btns"><button class="btn btn-secondary btn-block" type="button" data-s-act="edit">Edit</button><button class="btn btn-secondary btn-block" type="button" data-s-act="' + (sup.active ? 'stop' : 'again') + '">' + (sup.active ? 'Stop using' : 'Use again') + '</button></div>' : '') +
        '<div class="I_btns"><button class="btn btn-ghost btn-block" type="button" data-s-act="close">Close</button></div>';
    }
    var sh = openSheet({
      render: render,
      act: function (act, b, s) {
        if (act === 'edit') { s.close(); return supplierForm(ctx, sup, onChange); }
        if (act === 'stop' || act === 'again') {
          var on = act === 'again';
          ctx.confirm(on ? 'Use ' + sup.name + ' again?' : 'Stop using ' + sup.name + '? It stays in your old records and you can use it again.').then(function (yes) {
            if (!yes) return;
            return saveSupplier(ctx, { id: sup.id, active: on }, null).then(function (r) {
              if (!r.ok) return say(ctx, ERR.other);
              buzz(ctx); say(ctx, on ? sup.name + ' is in use again.' : 'Stopped using ' + sup.name + '.');
              var prev = r.before && Object.keys(r.before).length ? r.before : { active: !on };
              ctx.undo((on ? 'Used again: ' : 'Stopped using: ') + sup.name, function () { return undoSave(ctx, sup.id, prev); });
              s.close(); if (onChange) onChange();
            }, function (er) { say(ctx, ERR[errKind(er, online())] || ERR.other); });
          });
        }
      }
    });
    if (full) {
      call(ctx, 'inventory_supplier_detail_v1', { p_supplier_id: sup.id }).then(function (d) { S.items = (d && d.items) || []; sh.draw(); }, function (er) {
        var k = errKind(er, online()); if (k === 'missing') S.hide = true; else S.itemsErr = k; sh.draw();
      });
    }
    return sh;
  }
  // R2 with the same idempotency key per unchanged set of values (kept across a retry).
  var KEYS = {};
  function saveSupplier(ctx, payload, keyId) {
    var sig = JSON.stringify(payload), k = KEYS[sig]; if (!k) k = KEYS[sig] = newKey(keyId || 'save');
    return call(ctx, 'inventory_supplier_save_v1', { p_property_id: ctx.propertyId, p_supplier: payload, p_idempotency_key: k }).then(function (r) { delete KEYS[sig]; K.cache = null; return r || { ok: false }; });
  }
  function undoSave(ctx, id, before) {
    var p = { id: id }; Object.keys(before || {}).forEach(function (k) { p[k] = before[k]; });
    return call(ctx, 'inventory_supplier_save_v1', { p_property_id: ctx.propertyId, p_supplier: p, p_idempotency_key: newKey('undo') }).then(function (r) { K.cache = null; if (!r || !r.ok) throw new Error('undo refused'); return true; });
  }

  /* ---------------------------------------------------------------- add / edit form (R2) */
  function supplierForm(ctx, sup, onChange) {
    var e = E(ctx), isNew = !sup, V = sup ? { name: sup.name, phone: sup.phone || '', location: sup.location || '', maps_url: sup.maps_url || '', payment: sup.payment || '', notes: sup.notes || '' } : { name: '', phone: '', location: '', maps_url: '', payment: '', notes: '' };
    var S = { errs: {}, err: null, sending: false, reuse: null };
    function render() {
      return head(ctx, isNew ? 'New supplier' : 'Edit ' + sup.name) +
        '<form novalidate>' + field(ctx, 'name', 'Name', V.name, 'maxlength="80"') + fieldErr(S.errs, 'name') +
        field(ctx, 'phone', 'Phone number', V.phone, 'inputmode="tel" maxlength="20"') + fieldErr(S.errs, 'phone') +
        field(ctx, 'location', 'Where (shop and floor)', V.location, 'maxlength="120"') + fieldErr(S.errs, 'location') +
        field(ctx, 'maps_url', 'Map link', V.maps_url, 'inputmode="url" placeholder="https://"') + fieldErr(S.errs, 'maps_url') +
        payField(ctx, V.payment) +
        '<div class="field"><label for="S_f_notes">Notes</label><div class="input"><textarea id="S_f_notes" rows="3" maxlength="500">' + e(V.notes) + '</textarea></div></div>' + fieldErr(S.errs, 'notes') +
        '<div class="I_btns">' + errBox(ctx, S.err) +
        (S.reuse ? '<p class="help" role="status">' + e(S.reuse.name) + ' was stopped earlier.</p><button class="btn btn-secondary btn-block" type="button" data-s-act="reuse">Use again</button>' : '') +
        '<button class="btn btn-primary btn-block" type="submit"' + (S.sending ? ' disabled' : '') + '>' + (S.sending ? 'Saving…' : (isNew ? 'Add supplier' : 'Save')) + '</button>' +
        '<button class="btn btn-secondary btn-block" type="button" data-s-act="close">Cancel</button></div></form>';
    }
    function done(s, r, label, undoFn) {
      buzz(ctx); say(ctx, label); if (undoFn) ctx.undo(label, undoFn); s.close(); if (onChange) onChange();
    }
    return openSheet({
      render: render,
      input: function (k, v) { if (k in V) V[k] = v; },
      act: function (act, b, s) {
        if (act === 'reuse' && S.reuse) {
          var id = S.reuse.id;
          saveSupplier(ctx, { id: id, active: true }, null).then(function (r) { if (r.ok) done(s, r, 'Using ' + V.name.trim() + ' again.', function () { return undoSave(ctx, id, { active: false }); }); }, function (er) { S.err = errKind(er, online()); s.draw(); });
        }
      },
      submit: function (s) {
        if (S.sending) return;
        var v = validate(V); S.errs = v.errs; S.err = null; S.reuse = null;
        if (!v.ok) return s.draw();
        var payload = {}, label;
        if (isNew) {
          payload.name = v.vals.name;
          ['phone', 'location', 'maps_url', 'payment', 'notes'].forEach(function (k) { if (v.vals[k]) payload[k] = v.vals[k]; });
          label = 'Added ' + v.vals.name + '.';
        } else {
          payload.id = sup.id;
          ['name', 'phone', 'location', 'maps_url', 'payment', 'notes'].forEach(function (k) { var now = v.vals[k], was = sup[k] || ''; if (now !== was) payload[k] = now === '' ? null : now; });
          if (Object.keys(payload).length === 1) { S.err = 'Nothing changed yet.'; return s.draw(); }
          label = 'Saved ' + v.vals.name + '.';
        }
        var go = function () {
          S.sending = true; s.draw();
          return saveSupplier(ctx, payload, isNew ? 'new' : 'edit').then(function (r) {
            S.sending = false;
            if (r.ok) {
              var sid = r.supplier_id || sup && sup.id;
              if (isNew) return done(s, r, label, function () { return undoSave(ctx, sid, { active: false }); });
              return done(s, r, label, function () { return undoSave(ctx, sup.id, r.before || {}); });
            }
            if (r.reason === 'name_exists') { if (r.active === false) S.reuse = { id: r.supplier_id, name: v.vals.name }; else S.err = 'A supplier with that name is already in your list.'; }
            else S.err = 'other';
            s.draw();
          }, function (er) { S.sending = false; S.err = errKind(er, online()); s.draw(); });
        };
        if (isNew) return go();
        ctx.confirm('Save changes to ' + sup.name + '?').then(function (yes) { if (yes) go(); });
      }
    });
  }

  /* ---------------------------------------------------------------- picker */
  function pick(ctx, o) {
    o = o || {};
    if (!canPrice(ctx.role) || K.missing || !ctx.client) return Promise.resolve(null); // a cleaner never buys; a missing R1 sends the caller back to the text field
    var e = E(ctx), hit = K.cache && K.cache.pid === ctx.propertyId && nowMs(ctx) - K.cache.at < CACHE_MS ? Promise.resolve(K.cache.rows) : loadList(ctx).then(function (rows) { K.cache = { pid: ctx.propertyId, at: nowMs(ctx), rows: rows }; return rows; });
    return hit.then(function (rows) {
      return new Promise(function (resolve) {
        var list = orderPicker(rows, o.preferredId), S = { phase: 'list', find: '', err: null, sending: false, reuse: null, name: '' }, settled = false;
        function fin(v, s) { if (settled) return; settled = true; resolve(v); if (s) s.close(); }
        function render() {
          if (S.phase === 'new') {
            return head(ctx, 'New supplier', 'Just the name for now. You can add the rest later.') +
              '<form novalidate>' + field(ctx, 'name', 'Name', S.name, 'maxlength="80"') + (S.nameErr ? '<p class="err" role="alert">' + gi('alert', 's16') + '<span>' + e(S.nameErr) + '</span></p>' : '') +
              '<div class="I_btns">' + errBox(ctx, S.err) +
              (S.reuse ? '<p class="help" role="status">' + e(S.reuse.name) + ' was stopped earlier.</p><button class="btn btn-secondary btn-block" type="button" data-s-act="reuse">Use again</button>' : '') +
              '<button class="btn btn-primary btn-block" type="submit"' + (S.sending ? ' disabled' : '') + '>' + (S.sending ? 'Adding…' : 'Add and use') + '</button>' +
              '<button class="btn btn-secondary btn-block" type="button" data-s-act="back">Back</button></div></form>';
          }
          var shown = S.find ? list.filter(function (s) { return s.name.toLowerCase().indexOf(S.find.toLowerCase()) >= 0; }) : list;
          return head(ctx, 'Supplier', 'Where did you buy this?') +
            (list.length > 8 ? field(ctx, 'find', 'Find a supplier', S.find) : '') +
            '<div class="card list S_list">' + shown.map(function (s) {
              var sel = s.id === o.selectedId, pre = s.id === o.preferredId;
              return '<button class="rowi S_row" type="button" data-s-act="choose" data-id="' + e(s.id) + '" aria-pressed="' + (sel ? 'true' : 'false') + '"><span class="S_rt"><span class="t">' + e(s.name) + '</span><span class="s">' + e((s.location ? s.location + ' · ' : '') + (s.last_bought_at ? 'last bought ' + fmtDate(s.last_bought_at, nowMs(ctx)) : 'not bought from yet')) + '</span></span>' +
                (pre ? '<span class="S_tag">' + gi('star', 's16') + ' Preferred</span>' : '') + (sel ? '<span class="S_tag">' + gi('check', 's16') + ' Selected</span>' : '') + '</button>';
            }).join('') +
            '<button class="rowi S_row S_newrow" type="button" data-s-act="new"><span class="S_rt"><span class="t">' + gi('plus', 's16') + ' New supplier…</span></span></button></div>' +
            '<div class="I_btns"><button class="btn btn-ghost btn-block" type="button" data-s-act="close">Cancel</button></div>';
        }
        function created(r, s, name) {
          var id = r.supplier_id; K.cache = null;
          fin({ id: id, name: name, created: !!r.created }, s);
        }
        openSheet({
          render: render,
          onClose: function () { fin(null); },
          input: function (k, v, s) { if (k === 'find') { S.find = v; s.draw(); s.refocus('S_f_find'); } else if (k === 'name') S.name = v; },
          act: function (act, b, s) {
            if (act === 'choose') { var id = b.getAttribute('data-id'), row = list.filter(function (x) { return x.id === id; })[0]; if (row) fin({ id: row.id, name: row.name, created: false }, s); }
            else if (act === 'new') { S.phase = 'new'; s.focused = false; s.draw(); s.refocus('S_f_name'); }
            else if (act === 'back') { S.phase = 'list'; S.err = null; S.reuse = null; S.nameErr = null; s.focused = false; s.draw(); }
            else if (act === 'reuse' && S.reuse) {
              var rid = S.reuse.id, rn = S.reuse.name;
              saveSupplier(ctx, { id: rid, active: true }, null).then(function (r) { if (r.ok) { buzz(ctx); fin({ id: rid, name: rn, created: false }, s); } }, function (er) { S.err = errKind(er, online()); s.draw(); });
            }
          },
          submit: function (s) {
            if (S.sending) return;
            var name = S.name.trim(); S.err = null; S.reuse = null;
            if (name.length < 2 || name.length > 80) { S.nameErr = 'Use a name of 2 to 80 characters.'; return s.draw(); }
            S.nameErr = null; S.sending = true; s.draw();
            // Created only now, at the confirm tap, never while typing or on Cancel.
            saveSupplier(ctx, { name: name }, 'pick').then(function (r) {
              S.sending = false;
              if (r.ok) { buzz(ctx); return created({ supplier_id: r.supplier_id, created: true }, s, name); }
              if (r.reason === 'name_exists') {
                if (r.active === false) { S.reuse = { id: r.supplier_id, name: name }; return s.draw(); }
                var ex = rows.filter(function (x) { return x.id === r.supplier_id; })[0];
                say(ctx, 'That supplier is already in your list. Using it.');
                return created({ supplier_id: r.supplier_id, created: false }, s, ex ? ex.name : name);
              }
              S.err = 'other'; s.draw();
            }, function (er) { S.sending = false; S.err = errKind(er, online()); s.draw(); });
          }
        });
      });
    }, function (er) { if (errKind(er, online()) === 'missing') K.missing = true; return null; });
  }

  /* ---------------------------------------------------------------- price history (R6) */
  function openPriceHistory(ctx, item) {
    if (!canPrice(ctx.role) || !item || !item.id) return null;
    var e = E(ctx), S = { phase: 'load', d: null, err: null, pt: null };
    function spark() {
      var sp = sparkPoints(S.d.rows, 280, 80);
      if (!sp.points.length) return '';
      var sel = S.pt != null ? sp.points[S.pt] : null;
      return '<div class="S_spark"><svg viewBox="0 0 280 80" width="100%" role="img" aria-label="Price per unit over time, oldest on the left">' +
        (sp.points.length > 1 ? '<polyline class="S_line" fill="none" points="' + sp.path + '"/>' : '') +
        sp.points.map(function (p, i) { return '<circle class="S_dot' + (i === S.pt ? ' S_dot-on' : '') + '" cx="' + p.x + '" cy="' + p.y + '" r="' + (i === S.pt ? 5 : 3.5) + '" tabindex="0" role="button" data-s-act="pt" data-i="' + i + '" aria-label="' + e(fmtDate(p.at, nowMs(ctx)) + ', ' + money(p.v) + ' each' + (p.supplier ? ' at ' + p.supplier : '')) + '"/>'; }).join('') + '</svg>' +
        '<p class="S_cap" role="status">' + (sel ? e(fmtDate(sel.at, nowMs(ctx)) + ': ' + money(sel.v) + ' each' + (sel.supplier ? ' at ' + sel.supplier : '')) : 'Tap a dot to see the price.') + '</p></div>';
    }
    function body() {
      var d = S.d;
      if (S.phase === 'load') return '<p class="help S_load" role="status">Loading prices…</p>';
      if (S.phase === 'err') return errBox(ctx, S.err) + '<button class="btn btn-secondary" type="button" data-s-act="retry">Try again</button>';
      if (!d.rows || !d.rows.length) return '<p class="help">No prices recorded yet. They appear when you mark items Bought or apply a receipt in Telegram.</p>';
      var ch = cheaperLast(d), line = statsLine(d.stats), unit = d.units_per_purchase;
      return (d.jump ? '<p class="S_up" role="status"><span aria-hidden="true">▲</span> Price up ' + e(d.jump.pct) + '%' + (num(d.jump.base) != null ? ' on the usual ' + e(money(d.jump.base)) : '') + '</p>' : '') +
        (line ? '<p class="S_stats">' + e(line) + '</p>' : '') +
        (ch ? '<p class="S_cheap">' + gi('check', 's16') + ' Cheaper last time at ' + e(ch.name) + ': ' + e(money(ch.price)) + ' each</p>' : '') +
        spark() +
        '<ul class="S_hl">' + d.rows.map(function (r) {
          var packs = num(r.pack_price) != null && num(unit) > 1 ? money(r.pack_price) + ' a pack of ' + num(unit) : '';
          return '<li class="S_hr"><span class="S_hd">' + e(fmtDate(r.at, nowMs(ctx))) + '</span><span class="S_hm">' + e((r.supplier || 'No supplier named') + ' · ' + (num(r.qty) != null ? num(r.qty) + (d.unit ? ' ' + d.unit : '') : '')) + '</span>' +
            '<span class="S_hp">' + e(money(r.unit_price)) + ' each' + (packs ? '<br>' + e(packs) : '') + '</span><span class="S_src">' + e(SRC[r.source] || SRC.old) + '</span></li>';
        }).join('') + '</ul>';
    }
    var sh = openSheet({
      render: function () { return head(ctx, item.name || 'Price history', 'Price history') + body() + '<div class="I_btns"><button class="btn btn-ghost btn-block" type="button" data-s-act="close">Close</button></div>'; },
      act: function (act, b, s) {
        if (act === 'pt') { S.pt = parseInt(b.getAttribute('data-i'), 10); s.draw(); }
        if (act === 'retry') load();
      }
    });
    function load() {
      S.phase = 'load'; sh.draw();
      call(ctx, 'inventory_price_history_v1', { p_item_id: item.id }).then(function (d) { S.d = d || {}; S.phase = 'ok'; sh.draw(); }, function (er) {
        var k = errKind(er, online()); if (k === 'missing') { sh.close(); return say(ctx, 'Price history is not available yet.'); }
        S.phase = 'err'; S.err = k; sh.draw();
      });
    }
    load();
    return sh;
  }

  /* ---------------------------------------------------------------- suppliers for one item (R3 read, R4 / R5 write; owner and admin) */
  function openItemSuppliers(ctx, item) {
    if (!isManage(ctx.role) || !item || !item.id) return null;
    var e = E(ctx), S = { phase: 'load', links: [], err: null, edit: null, sending: false, V: {} };
    function linkOf(id) { return S.links.filter(function (l) { return l.supplier_id === id; })[0]; }
    function packText(l) {
      var a = [];
      if (l.pack_label) a.push(l.pack_label);
      if (num(l.pack_size) != null) a.push(num(l.pack_size) + ' per pack');
      if (num(l.last_unit_price) != null) a.push('last ' + money(l.last_unit_price) + ' each'); else if (num(l.quoted_pack_price) != null) a.push('Quoted ' + money(l.quoted_pack_price) + ' a pack');
      return a.join(' · ');
    }
    function render() {
      if (S.edit) {
        var l = linkOf(S.edit);
        return head(ctx, l.name, 'Pack details for ' + (item.name || 'this item')) +
          '<form novalidate>' + field(ctx, 'pack_label', 'Pack label', S.V.pack_label || '', 'maxlength="40" placeholder="pack of 12"') +
          field(ctx, 'pack_size', 'Units in a pack here', S.V.pack_size || '', 'inputmode="decimal"') +
          field(ctx, 'quoted', 'Quoted price for a pack (PHP)', S.V.quoted || '', 'inputmode="decimal"') +
          (S.formErr ? '<p class="err" role="alert">' + gi('alert', 's16') + '<span>' + e(S.formErr) + '</span></p>' : '') +
          '<div class="I_btns">' + errBox(ctx, S.err) + '<button class="btn btn-primary btn-block" type="submit"' + (S.sending ? ' disabled' : '') + '>Save</button><button class="btn btn-secondary btn-block" type="button" data-s-act="back">Back</button></div></form>';
      }
      var inner;
      if (S.phase === 'load') inner = '<p class="help S_load" role="status">Loading…</p>';
      else if (S.phase === 'err') inner = errBox(ctx, S.err) + '<button class="btn btn-secondary" type="button" data-s-act="retry">Try again</button>';
      else inner = (S.links.length ? '<ul class="S_il">' + S.links.map(function (l) {
        return '<li class="S_lk"><span class="t">' + e(l.name) + '</span><span class="s">' + e(packText(l)) + '</span><div class="S_lb">' +
          '<button class="btn btn-secondary" type="button" data-s-act="pref" data-id="' + e(l.supplier_id) + '" aria-pressed="' + (l.preferred ? 'true' : 'false') + '">' + gi('star', 's16') + ' ' + (l.preferred ? 'Preferred' : 'Make preferred') + '</button>' +
          '<button class="btn btn-secondary" type="button" data-s-act="pack" data-id="' + e(l.supplier_id) + '">Edit pack</button>' +
          '<button class="btn btn-ghost" type="button" data-s-act="unlink" data-id="' + e(l.supplier_id) + '">Remove</button></div></li>';
      }).join('') + '</ul>' : '<p class="help">No supplier is listed for this item yet.</p>') + '<button class="btn btn-secondary btn-block" type="button" data-s-act="add">' + gi('plus', 's16') + ' Add a supplier</button>';
      return head(ctx, 'Suppliers for this item', item.name) + inner + '<div class="I_btns">' + (S.phase === 'ok' ? errBox(ctx, S.err) : '') + '<button class="btn btn-ghost btn-block" type="button" data-s-act="close">Close</button></div>';
    }
    function link(supId, patch, label, undoFn) {
      return call(ctx, 'inventory_item_supplier_link_v1', { p_item_id: item.id, p_supplier_id: supId, p_link: patch }).then(function (r) {
        if (!r || !r.ok) throw new Error('refused'); buzz(ctx); say(ctx, label); if (undoFn) ctx.undo(label, function () { return undoFn(r.before); }); return r;
      });
    }
    function relink(supId, before) {
      var p = {}; ['pack_label', 'pack_size', 'quoted_pack_price', 'preferred'].forEach(function (k) { if (before && k in before) p[k] = before[k]; });
      return call(ctx, 'inventory_item_supplier_link_v1', { p_item_id: item.id, p_supplier_id: supId, p_link: p }).then(function (r) { if (!r || !r.ok) throw new Error('undo refused'); return true; });
    }
    function unlinkUndo(supId) { return call(ctx, 'inventory_item_supplier_unlink_v1', { p_item_id: item.id, p_supplier_id: supId }).then(function (r) { if (!r || !r.ok) throw new Error('undo refused'); return true; }); }
    function fail(s, er) { S.sending = false; S.err = errKind(er, online()); s.draw(); }
    function load(s) {
      S.phase = 'load'; s.draw();
      call(ctx, 'inventory_supplier_list_v1', { p_property_id: ctx.propertyId }).then(function (d) {
        var sups = normList(d, true);
        return Promise.all(sups.map(function (sp) {
          return call(ctx, 'inventory_supplier_detail_v1', { p_supplier_id: sp.id }).then(function (x) { return ((x && x.items) || []).filter(function (i) { return i.item_id === item.id; }).map(function (i) { return { supplier_id: sp.id, name: sp.name, preferred: !!i.preferred, pack_label: i.pack_label, pack_size: i.pack_size, quoted_pack_price: i.quoted_pack_price, last_unit_price: i.last_unit_price, times: i.times }; }); }, function () { return []; });
        }));
      }).then(function (parts) { S.links = [].concat.apply([], parts); S.links.sort(function (a, b) { return (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || (a.name < b.name ? -1 : 1); }); S.phase = 'ok'; s.draw(); }, function (er) {
        var k = errKind(er, online()); if (k === 'missing') { s.close(); return say(ctx, 'Supplier details are not available yet.'); }
        S.phase = 'err'; S.err = k; s.draw();
      });
    }
    var sh = openSheet({
      render: render,
      input: function (k, v) { S.V[k] = v; },
      act: function (act, b, s) {
        var id = b.getAttribute('data-id'), l = id ? linkOf(id) : null; S.err = null;
        if (act === 'retry') return load(s);
        if (act === 'back') { S.edit = null; S.formErr = null; s.focused = false; return s.draw(); }
        if (act === 'pack' && l) { S.edit = id; S.V = { pack_label: l.pack_label || '', pack_size: l.pack_size == null ? '' : String(num(l.pack_size)), quoted: l.quoted_pack_price == null ? '' : String(num(l.quoted_pack_price)) }; S.formErr = null; s.focused = false; return s.draw(); }
        if (act === 'pref' && l) {
          var prev = S.links.filter(function (x) { return x.preferred && x.supplier_id !== id; })[0], on = !l.preferred;
          return ctx.confirm((on ? 'Make ' + l.name + ' the usual supplier for ' : 'Stop ' + l.name + ' being the usual supplier for ') + (item.name || 'this item') + '?').then(function (yes) {
            if (!yes) return;
            return link(id, { preferred: on }, on ? l.name + ' is now the usual supplier.' : l.name + ' is no longer the usual supplier.', function (before) {
              if (on && prev) return relink(prev.supplier_id, { preferred: true });
              return relink(id, before || { preferred: !on });
            }).then(function () { return load(s); }, function (er) { fail(s, er); });
          });
        }
        if (act === 'unlink' && l) {
          return ctx.confirm('Remove ' + l.name + ' from ' + (item.name || 'this item') + '? Past purchases stay as they are.').then(function (yes) {
            if (!yes) return;
            return call(ctx, 'inventory_item_supplier_unlink_v1', { p_item_id: item.id, p_supplier_id: id }).then(function (r) {
              if (!r || !r.ok) throw new Error('refused');
              if (!r.removed) { say(ctx, l.name + ' was only bought from, not listed.'); return load(s); }
              buzz(ctx); say(ctx, 'Removed ' + l.name + '.'); ctx.undo('Removed ' + l.name, function () { return relink(id, r.before); }); return load(s);
            }).catch(function (er) { fail(s, er); });
          });
        }
        if (act === 'add') {
          return pick(ctx, { itemId: item.id }).then(function (p) {
            if (!p) return;
            if (linkOf(p.id)) return say(ctx, p.name + ' is already listed here.');
            return link(p.id, { preferred: false }, 'Added ' + p.name + '.', function (before) { return before ? relink(p.id, before) : unlinkUndo(p.id); }).then(function () { return load(s); }, function (er) { fail(s, er); });
          });
        }
      },
      submit: function (s) {
        if (S.sending || !S.edit) return;
        var id = S.edit, l = linkOf(id), V = S.V, patch = {}, lab = String(V.pack_label || '').trim(), sz = String(V.pack_size || '').trim(), q = String(V.quoted || '').trim();
        S.formErr = null;
        if (lab.length > 40) S.formErr = 'Keep the pack label under 40 characters.';
        else if (sz && !(num(sz) > 0 && num(sz) < 100000)) S.formErr = 'Units in a pack must be more than 0.';
        else if (q && !(num(q) > 0 && num(q) < 1000000)) S.formErr = 'A quoted price must be more than 0.';
        if (S.formErr) return s.draw();
        if (lab !== (l.pack_label || '')) patch.pack_label = lab || null;
        if (sz !== (l.pack_size == null ? '' : String(num(l.pack_size)))) patch.pack_size = sz ? num(sz) : null;
        if (q !== (l.quoted_pack_price == null ? '' : String(num(l.quoted_pack_price)))) patch.quoted_pack_price = q ? num(q) : null;
        if (!Object.keys(patch).length) { S.formErr = 'Nothing changed yet.'; return s.draw(); }
        ctx.confirm('Save pack details for ' + l.name + '?').then(function (yes) {
          if (!yes) return;
          S.sending = true; s.draw();
          return link(id, patch, 'Saved pack details for ' + l.name + '.', function (before) { return before ? relink(id, before) : unlinkUndo(id); }).then(function () { S.sending = false; S.edit = null; s.focused = false; return load(s); }, function (er) { fail(s, er); });
        });
      }
    });
    load(sh);
    return sh;
  }

  root.I_Suppliers = {
    mountList: mountList, pick: pick, openPriceHistory: openPriceHistory, openItemSuppliers: openItemSuppliers,
    lib: { money: money, fmtDate: fmtDate, sparkPoints: sparkPoints, cheaperLast: cheaperLast, statsLine: statsLine, orderPicker: orderPicker, normSupplier: normSupplier, validate: validate, errKind: errKind, canPrice: canPrice, isManage: isManage, reset: function () { K.missing = false; K.cache = null; KEYS = {}; } }
  };
})(typeof window !== 'undefined' ? window : this);
