/* Cascade Staff - pure helpers (no DOM, no network). Loaded as a classic script in the browser (window.CS) and
   required by node --test (module.exports). Every date here is a Manila calendar date as 'YYYY-MM-DD'. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- sign-in rules (copied from CH-Cleaners-Checklist/index.html:5060-5080) -------------------------------------
  var STAFF_DOMAIN = 'staff.cascade.invalid';
  var STAFF_PIN_PREFIX = '8888';
  var STAFF_PIN_RE = /^\d{4}$/;
  // 4 digits get the prefix (Supabase Auth wants 8 characters); a mailbox owner's or admin's own password is sent as typed.
  function staffAuthPassword(pin) { var p = String(pin == null ? '' : pin); return STAFF_PIN_RE.test(p) ? STAFF_PIN_PREFIX + p : p; }
  function staffLoginEmail(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (v.indexOf('@') >= 0) return v.toLowerCase();
    var slug = v.normalize('NFKD').replace(/[^ -~]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
    return slug + '@' + STAFF_DOMAIN;
  }
  // The checklist reads display_name; the dashboard reads name. Cover both, then the e-mail's local part.
  function deriveDisplayName(user) {
    user = user || {};
    var um = user.user_metadata || {}, am = user.app_metadata || {};
    var meta = um.display_name || am.display_name || um.name;
    if (meta) return String(meta).trim();
    var local = String(user.email || '').split('@')[0];
    var spaced = local.replace(/[._]+/g, ' ').trim();
    return spaced.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) || 'Staff';
  }

  // Greeting name: the profile's display first name only. An e-mail/handle fallback is never greeted (returns '').
  function greetingName(user) {
    user = user || {};
    var um = user.user_metadata || {}, am = user.app_metadata || {};
    var meta = um.display_name || am.display_name || um.name;
    var w = meta ? String(meta).trim().split(/\s+/)[0] : '';
    var email = String(user.email || '').toLowerCase(), local = email.split('@')[0];
    // a handle-like first word (digits, @ . _) or the e-mail local part is not a name; PIN staff slugs are real first names
    if (!w || /[\d@._]/.test(w)) return '';
    if (w.toLowerCase() === local && !/@staff\.cascade\.invalid$/.test(email)) return '';
    return w;
  }

  // ---- sign-in screen (D-303.2, D-303.3) ------------------------------------------------------------------------------
  var LAST_SIGNIN_KEY = 'cs_last_signin';
  // 'pin' for the checklist accounts (slug@staff.cascade.invalid, password '8888' + 4 digits); anything else is a mailbox password account.
  function signinKind(handle) { return /@staff\.cascade\.invalid$/i.test(String(handle || '').trim()) ? 'pin' : 'password'; }
  // The rows of staff_signin_list_v1() -> [{label, handle, kind}]. Rows without a name or a handle are dropped; the kind is trusted
  // only when it is one of the two known values, else it is worked out from the handle.
  function signinList(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (r) {
      r = r || {};
      var handle = String(r.handle == null ? '' : r.handle).trim().toLowerCase(), label = String(r.label == null ? '' : r.label).trim();
      var kind = r.kind === 'pin' || r.kind === 'password' ? r.kind : signinKind(handle);
      return { label: label, handle: handle, kind: kind };
    }).filter(function (r) { return r.label && r.handle.indexOf('@') > 0; });
  }
  // Fallback when the list cannot load: a typed name or e-mail still signs in the old way.
  function typedEntry(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return null;
    var handle = staffLoginEmail(t);
    return handle.charAt(0) === '@' ? null : { label: t, handle: handle, kind: signinKind(handle) };
  }
  // The on-screen keypad: a digit appends (at most 4), 'back' removes the last, 'clear' empties.
  function keypadPress(pin, key) {
    var p = String(pin == null ? '' : pin);
    if (key === 'back') return p.slice(0, -1);
    if (key === 'clear') return '';
    return /^\d$/.test(String(key)) && p.length < 4 ? p + key : p;
  }
  // The pair sent to Supabase Auth, or null while the secret is not complete (a PIN needs exactly 4 digits, a password anything).
  function signinCredentials(entry, secret) {
    if (!entry || !entry.handle) return null;
    var s = String(secret == null ? '' : secret);
    if (entry.kind === 'pin') return STAFF_PIN_RE.test(s) ? { email: entry.handle, password: staffAuthPassword(s) } : null;
    return s ? { email: entry.handle, password: s } : null;
  }
  // supabase-js storage adapter. Default storage key on purpose (the dashboard on this origin reads the same one). "Trust this device"
  // ON writes localStorage (persisted); OFF writes sessionStorage (gone when the browser session ends). Reads look in both, and a write
  // clears the other side so one session never lives in two places. Storage can be missing or throw (private mode): every call is guarded.
  function authStorage(local, session, isTrusted) {
    function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
    function put(s, k, v) { try { if (s) s.setItem(k, v); } catch (e) {} }
    function del(s, k) { try { if (s) s.removeItem(k); } catch (e) {} }
    return {
      getItem: function (k) { var v = get(session, k); return v != null ? v : get(local, k); },
      setItem: function (k, v) { var on = isTrusted(); put(on ? local : session, k, v); del(on ? session : local, k); },
      removeItem: function (k) { del(local, k); del(session, k); }
    };
  }
  // After a reload: was the live session saved as untrusted (sessionStorage)? Then keep refreshing it there.
  function trustedFromStorage(local, session) {
    try { for (var i = 0; session && i < session.length; i++) if (/^sb-.+-auth-token$/.test(session.key(i))) return false; } catch (e) {}
    return true;
  }
  function rememberName(storage, handle) { try { if (handle) storage.setItem(LAST_SIGNIN_KEY, String(handle)); } catch (e) {} }
  function recalledName(storage, list) {
    var h = null; try { h = storage.getItem(LAST_SIGNIN_KEY); } catch (e) {}
    return h && (list || []).some(function (r) { return r.handle === h; }) ? h : null;
  }

  // ---- doors (D-304.3) --------------------------------------------------------------------------------------------------
  // A door on this origin opens inside the app (same-origin frame, one storage partition on iPhone Home Screen and Android);
  // a door on another origin, or not http(s), opens externally.
  function doorTarget(url, origin) {
    try { var u = new URL(url, origin); return /^https?:$/.test(u.protocol) && u.origin === origin ? 'frame' : 'external'; } catch (e) { return 'external'; }
  }
  // Which doors exist, who may open them in the frame, and whether the door reads supabase-js's localStorage session (the dashboard).
  // A localStorage door only works in the frame while "Trust this device" is ON; OFF keeps the session in sessionStorage, so it opens
  // externally instead. Looked up by own property only: #door/constructor, #door/__proto__ and #door/toString are nothing.
  var DOOR_RULES = {
    checklist: { layouts: ['staff', 'admin'], localKey: false },
    dashboard: { layouts: ['admin'], localKey: true },
    manual: { layouts: ['staff', 'admin'], localKey: false }
  };
  function doorRule(key) { return Object.prototype.hasOwnProperty.call(DOOR_RULES, key) ? DOOR_RULES[key] : null; }
  function doorFramed(key, layout, trusted) {
    var r = doorRule(key);
    return !!r && r.layouts.indexOf(layout) >= 0 && (!r.localKey || !!trusted);
  }
  // The row link for a door: an in-app route (#door/<key>) for a frame door, the URL itself for an external one.
  function doorLink(key, url, origin, trusted) {
    var r = doorRule(key);
    return doorTarget(url, origin) === 'frame' && r && (!r.localKey || trusted) ? { href: '#door/' + key, external: false } : { href: url, external: true };
  }

  // ---- roles ---------------------------------------------------------------------------------------------------------
  var ADMIN_ROLES = ['owner', 'admin', 'finance'];
  var STAFF_ROLES = ['cleaner', 'inspector', 'maintenance'];
  function layoutForRole(role) {
    if (ADMIN_ROLES.indexOf(role) >= 0) return 'admin';
    if (STAFF_ROLES.indexOf(role) >= 0) return 'staff';
    return null; // unknown role: stay on the sign-in screen
  }
  // current_staff_access() -> {ok, message}. null = no profile; disabled or a revoked session = turned off.
  function accessVerdict(access) {
    if (!access) return { ok: false, message: 'This account has no staff profile. Ask Lloyd.' };
    if (access.disabled || access.session_current === false) return { ok: false, message: 'Your access was turned off. Ask Lloyd.' };
    if (!layoutForRole(access.role)) return { ok: false, message: 'This account has no staff profile. Ask Lloyd.' };
    return { ok: true, message: '' };
  }

  // ---- "no guest money" belt and braces (D-289) ---------------------------------------------------------------------
  // The client refuses to render a payload that carries a money or contact KEY. Keys are matched as whole words so a key like
  // "grid_line" or "feels_like" is fine while "total_amount", "guest_phone" or "deposit" is not.
  var MONEY_TOKEN = /^(amount|deposit|total|phone|mobile|contact|email|price|fee|payout|cost|balance|refund|paid)s?$/;
  function keyTokens(key) {
    return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }
  function moneyKeys(value, path, out) {
    out = out || []; path = path || '$';
    if (Array.isArray(value)) { value.forEach(function (v, i) { moneyKeys(v, path + '[' + i + ']', out); }); return out; }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (k) {
        if (keyTokens(k).some(function (t) { return MONEY_TOKEN.test(t); })) out.push(path + '.' + k);
        moneyKeys(value[k], path + '.' + k, out);
      });
    }
    return out;
  }
  // s77: owner and admin may receive the guest's phone and e-mail on the two guest cards, nowhere else. Money keys stay refused for
  // every role, and a contact key anywhere else (or for any other role) still blocks the page.
  var CONTACT_OK = /^\$\.(current_guest|next_guest)\.(phone|email)$/;
  function canSeeGuestContact(role) { return role === 'owner' || role === 'admin'; }
  function assertNoMoney(payload, opts) {
    var allow = !!(opts && opts.allowContact);
    var bad = moneyKeys(payload).filter(function (p) { return !(allow && CONTACT_OK.test(p)); });
    if (bad.length) throw new Error('payload carries money or contact keys: ' + bad.join(', '));
    return true;
  }

  // ---- dates (Manila) -------------------------------------------------------------------------------------------------
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function manilaParts(now) {
    var d = new Date((now instanceof Date ? now : new Date(now == null ? Date.now() : now)).getTime() + 8 * 3600 * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function manilaToday(now) { var p = manilaParts(now); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }
  function utc(iso) { var a = String(iso).slice(0, 10).split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]); }
  function isoOf(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(iso, n) { return isoOf(utc(iso) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function weekdayIndex(iso) { return new Date(utc(iso)).getUTCDay(); } // 0 = Sunday
  function dayLabel(iso) { var a = String(iso).split('-'); return +a[2] + ' ' + MONTHS[+a[1] - 1].slice(0, 3); } // 5 Oct
  function dayLong(iso) { var a = String(iso).split('-'); return DAYS[weekdayIndex(iso)] + ' ' + +a[2] + ' ' + MONTHS[+a[1] - 1]; } // Monday 5 October
  function dayShort(iso) { return DAYS[weekdayIndex(iso)].slice(0, 3) + ' ' + dayLabel(iso); } // Thu 8 Oct
  function monthTitle(y, m) { return MONTHS[m - 1] + ' ' + y; }
  function monthShortYear(ym) { var a = String(ym).split('-'); return MONTHS[+a[1] - 1].slice(0, 3) + ' ' + a[0]; } // 2026-06 -> Jun 2026
  function greeting(now) { var h = manilaParts(now).h; return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  // '14:00:00' -> '2:00 PM'; '12:00:00' -> '12:00 noon'; null stays null.
  function fmtTime(t) {
    if (!t) return null;
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t)); if (!m) return null;
    var h = +m[1], min = m[2];
    if (h === 12 && min === '00') return '12:00 noon';
    var ap = h >= 12 ? 'PM' : 'AM'; var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + min + ' ' + ap;
  }
  function fmt24(t) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? pad(+m[1]) + ':' + m[2] : null; }
  function ordinal(n) {
    var v = n % 100, s = ['th', 'st', 'nd', 'rd'];
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function agoLabel(iso, now) {
    var s = Math.max(0, Math.round(((now instanceof Date ? now.getTime() : (now == null ? Date.now() : now)) - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return plural(Math.round(s / 60), 'min') + ' ago';
    if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
    return plural(Math.round(s / 86400), 'day') + ' ago';
  }
  function clockLabel(iso) { var p = manilaParts(new Date(iso)); return pad(p.h) + ':' + pad(p.min); }

  // ---- month grid (Monday first) ---------------------------------------------------------------------------------------
  // Returns [{iso|null}] with leading blanks so index % 7 is the weekday column (Mo = 0).
  function monthGrid(y, m) {
    var first = y + '-' + pad(m) + '-01';
    var lead = (weekdayIndex(first) + 6) % 7;
    var next = m === 12 ? (y + 1) + '-01-01' : y + '-' + pad(m + 1) + '-01';
    var n = daysBetween(first, next), cells = [], i;
    for (i = 0; i < lead; i++) cells.push({ iso: null });
    for (i = 0; i < n; i++) cells.push({ iso: addDays(first, i) });
    while (cells.length % 7) cells.push({ iso: null });
    return cells;
  }
  // Classify one day against the calendar rows. A stay holds the nights checkin..checkout-1; the check-out day is free.
  function dayState(iso, rows) {
    var out = { stay: null, blocked: false, cont: false, startsHere: false };
    (rows || []).forEach(function (r) {
      if (iso < r.checkin_date || iso >= r.checkout_date) return;
      if (r.status === 'blocked') out.blocked = true;
      else if (r.status === 'confirmed' && !out.stay) {
        out.stay = r; out.startsHere = iso === r.checkin_date; out.cont = addDays(iso, 1) < r.checkout_date;
      }
    });
    return out;
  }
  // ---- calendar day status (s77 contract): one primary per night, booked > blocked > free, plus any number of secondary flags.
  // dayFlags is payload.day_flags; when the payload has none (older SQL) brownouts come from the warnings as before.
  var FLAG_KINDS = ['brownout', 'maintenance', 'deep_clean', 'other'];
  var FLAG_NAME = { brownout: 'Brownout', maintenance: 'Maintenance', deep_clean: 'Deep cleaning', other: 'Note' };
  function blockWhy(r) { var l = r && String(r.block_label || '').trim(); return l || 'Blocked'; }
  // Every reason on a night held by more than one block, each once: "Direct booking BD296460 · Maintenance".
  function blocksWhy(list) { var out = []; (list || []).forEach(function (r) { var w = blockWhy(r); if (out.indexOf(w) < 0) out.push(w); }); return out.length > 1 ? out.filter(function (w) { return w !== 'Blocked'; }).join(' · ') : out[0] || ''; }
  function flagsFor(iso, dayFlags, warnings) {
    if (Array.isArray(dayFlags)) return dayFlags.filter(function (f) { return f && f.date === iso && FLAG_KINDS.indexOf(f.kind) >= 0; });
    return (warnings || []).filter(function (w) { return w.kind === 'brownout' && w.detail && w.detail.date === iso; })
      .map(function () { return { date: iso, kind: 'brownout', label: 'Brownout', source: 'auto', id: null }; });
  }
  function dayStatus(iso, rows, dayFlags, warnings) {
    var s = dayState(iso, rows), blocks = (rows || []).filter(function (r) { return r.status === 'blocked' && iso >= r.checkin_date && iso < r.checkout_date; });
    var block = blocks[0] || null, primary = s.stay ? 'booked' : block ? 'blocked' : 'free';
    return { primary: primary, stay: s.stay, block: block, blocks: blocks, blockWhy: blocksWhy(blocks), startsHere: s.startsHere, cont: s.cont,
      why: s.stay ? (s.stay.guest_name || 'Guest') : block ? blocksWhy(blocks) : 'Open for a booking', flags: flagsFor(iso, dayFlags, warnings) };
  }
  function flagName(kind) { return FLAG_NAME[kind] || 'Note'; }
  // "Blocked nights" list: the nights a block holds with no confirmed stay on them, said with the reason.
  // A block that mirrors a stay (Airbnb copy of a direct booking) shows only its extra nights, e.g. one night after checkout.
  function nightsWord(n) { return n === 1 ? 'one night' : n === 2 ? 'two nights' : n + ' nights'; }
  function blockedLines(rows, today) {
    var stays = (rows || []).filter(function (r) { return r.status === 'confirmed'; }), out = [];
    function stayOn(d) { for (var i = 0; i < stays.length; i++) if (d >= stays[i].checkin_date && d < stays[i].checkout_date) return stays[i]; return null; }
    (rows || []).filter(function (r) { return r.status === 'blocked' && r.checkout_date > (today || ''); }).forEach(function (r) {
      var segs = [], cur = null, covered = 0, d;
      for (d = r.checkin_date; d < r.checkout_date; d = addDays(d, 1)) {
        if (stayOn(d)) { covered++; cur = null; continue; }
        if (cur && addDays(cur.to, 1) === d) cur.to = d; else { cur = { from: d, to: d }; segs.push(cur); }
      }
      if (!segs.length) { out.push({ from: r.checkin_date, to: addDays(r.checkout_date, -1), why: blockWhy(r), note: 'same nights as the stay', extra: false }); return; }
      segs.forEach(function (sg) {
        var n = daysBetween(sg.from, sg.to) + 1, note = '';
        if (covered) {
          var after = stays.some(function (st) { return st.checkout_date === sg.from; }), before = stays.some(function (st) { return st.checkin_date === addDays(sg.to, 1); });
          note = after ? nightsWord(n) + ' after checkout' : before ? nightsWord(n) + ' before check-in' : '';
        }
        out.push({ from: sg.from, to: sg.to, why: blockWhy(r), note: note, extra: !!covered });
      });
    });
    return out.sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
  }
  function blockedLineText(l) {
    return (l.from === l.to ? dayLabel(l.from) : dayLabel(l.from) + ' to ' + dayLabel(l.to)) + ' · ' + l.why + (l.note ? ' · ' + l.note : '');
  }
  function canFlagDays(role) { return role === 'owner' || role === 'admin'; }
  // A missing RPC (not deployed yet): PostgREST says PGRST202, or the gateway answers 404.
  function rpcMissing(err) { return !!err && (err.code === 'PGRST202' || err.status === 404 || err.code === '404' || /could not find the function/i.test(err.message || '')); }

  // Guest card contact (owner/admin payload only): what to show, or null when the payload has none of it.
  // Messenger opens the guest's thread when the payload has one, else the Page inbox; only an https thread URL is used.
  var MESSENGER_INBOX = 'https://business.facebook.com/latest/inbox/all';
  function guestContact(g) {
    if (!g) return null;
    var phone = String(g.phone == null ? '' : g.phone).trim(), email = String(g.email == null ? '' : g.email).trim();
    var m = g.messenger && typeof g.messenger === 'object' ? g.messenger : null, tel = phone.replace(/[^\d+]/g, '');
    var out = { phone: phone || null, tel: tel.replace(/\D/g, '').length >= 5 ? 'tel:' + tel : null, email: email || null,
      messenger: m ? (/^https:\/\/[^\s"'<>]+$/i.test(String(m.thread_url || '')) ? m.thread_url : MESSENGER_INBOX) : null };
    return out.phone || out.email || out.messenger ? out : null;
  }

  // Telegram: the app link first (tg://), the t.me web page as the fallback when the app does not open.
  function tgLink(channelId, post) {
    var id = String(channelId).replace(/\D/g, ''), p = post != null && post !== '' ? String(post).replace(/\D/g, '') : '1'; // Telegram documents post= as required for privatepost
    return { app: 'tg://privatepost?channel=' + id + (p ? '&post=' + p : ''), web: 'https://t.me/c/' + id + (p ? '/' + p : '') };
  }

  // What a warning means in plain words, where to go to fix it, and whether it can be marked handled here.
  var DASH = 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/';
  var CHECKS = [
    [/airbnb block runs past/i, 'Our Airbnb block covers nights with no guest. Unblocking those nights on Airbnb opens them for sale again.', 'Bookings calendar', 'bookings/calendar'],
    [/overlap/i, 'Two confirmed stays share at least one night, so one guest may have no room. Moving or cancelling one booking clears it.', 'Bookings calendar', 'bookings/calendar'],
    [/no calendar block/i, 'A booking is confirmed but its nights are still open on a booking calendar. Blocking those nights keeps a second guest from taking them.', 'Bookings calendar', 'bookings/calendar'],
    [/calendar hold/i, 'Nights are held on the calendar with no live booking behind them. Releasing the hold opens them for sale again.', 'Bookings calendar', 'bookings/calendar'],
    [/ledger/i, 'The same money appears more than once in the ledger, so totals may read high until the copy is removed.', 'Finance transactions', 'finance/transactions'],
    [/clean/i, 'A guest has checked out and no cleaning is logged for that turnover yet.', 'Operations', 'operations'],
    [/\bID\b/, 'A guest arrives soon and no ID photo is on file yet. The guest card shows what is there.', 'the guest card', '#calendar/next']
  ];
  // The safe facts L2 sends with a system check (ref, first name, dates, a count), as short lines.
  function factLines(f) {
    if (!f || typeof f !== 'object') return [];
    var span = function (a, b) { return a && b ? dayLabel(a) + ' to ' + dayLabel(b) : a ? dayLabel(a) : ''; }, out = [];
    if (f.guest_first) out.push('Guest: ' + f.guest_first);
    if (f.ref) out.push('Booking ' + f.ref);
    if (f.from) out.push('Stay: ' + span(f.from, f.to));
    if (f.block_from) out.push('Calendar block: ' + span(f.block_from, f.block_to));
    if (f.n != null && isFinite(+f.n)) out.push(plural(+f.n, 'case') + ' found');
    return out;
  }
  function warningInfo(w, role) {
    var admin = role === 'owner' || role === 'admin' || role === 'finance', d = (w && w.detail) || {}, out = { head: '', meaning: '', details: [], go: null, resolvable: false };
    if (w.kind === 'brownout') {
      var b = brownoutText(w); out.head = b.head; out.details = b.rest ? b.rest.split(' · ') : [];
      out.meaning = 'SOCOTECO has scheduled a power interruption. A charged EcoFlow and a short note to the guest ahead of time keep the stay comfortable.';
      if (admin) out.go = { label: 'Go to Notices', href: DASH + 'operations/notices', external: true };
      return out;
    }
    if (w.kind === 'inventory') {
      var l = lowStockText(w); out.head = l.head; out.details = [l.rest];
      out.meaning = 'This item is below its reorder level. A restock before the next turnover keeps the house ready.';
      if (admin) out.go = { label: 'Go to Inventory', href: DASH + 'inventory', external: true };
      return out;
    }
    out.head = 'System check'; out.details = [w.title].concat(factLines(w.facts), d.check_id ? ['Check ' + d.check_id] : [], d.status === 'acknowledged' || w.acknowledged === true ? ['Marked as seen, not fixed yet'] : []);
    out.meaning = 'An automatic check found something that needs a person.';
    for (var i = 0; i < CHECKS.length; i++) if (CHECKS[i][0].test(w.title || '') || (i === 0 && d.check_id === 'V1m')) {
      out.meaning = CHECKS[i][1];
      var internal = CHECKS[i][3].charAt(0) === '#';
      if (internal || admin) out.go = { label: 'Go to ' + CHECKS[i][2], href: internal ? CHECKS[i][3] : DASH + CHECKS[i][3], external: !internal };
      break;
    }
    if (!out.go && admin) out.go = { label: 'Go to System health', href: DASH + 'settings/health', external: true };
    out.resolvable = (role === 'owner' || role === 'admin') && d.status !== 'acknowledged' && w.acknowledged !== true;
    return out;
  }
  // The finding key for ack_verifier_finding_v1: from the warning when the payload carries it, else the matching Tasks row.
  function findingKey(w, tasks) {
    if (w.key) return w.key; if (w.detail && w.detail.key) return w.detail.key;
    var cid = w.detail && w.detail.check_id; // finding keys start with "<check_id>:"
    var hit = (tasks || []).filter(function (t) { return t.source === 'verifier_findings' && t.title === w.title && t.status !== 'done' && (!cid || String(t.id).indexOf(cid + ':') === 0); });
    return hit.length === 1 ? hit[0].id : null;
  }

  // Guest initial for the bar; Airbnb first names only, never more.
  function initialOf(name) { var s = String(name || '').trim(); return s ? s.charAt(0).toUpperCase() : ''; }
  function sourceLabel(src) { return src === 'airbnb' ? 'Airbnb' : src === 'direct' ? 'Direct' : src === 'manual' ? 'Manual' : ''; }
  function stayDates(r) {
    var a = dayLabel(r.checkin_date) + ' → ' + dayLabel(r.checkout_date);
    var n = r.nights != null ? r.nights : daysBetween(r.checkin_date, r.checkout_date);
    return a + ' · ' + plural(n, 'night');
  }
  // Month range that holds data: 7 days back to 60 forward (the RPC window).
  function monthInRange(y, m, today) {
    var first = y + '-' + pad(m) + '-01';
    var last = addDays(m === 12 ? (y + 1) + '-01-01' : y + '-' + pad(m + 1) + '-01', -1);
    return last >= addDays(today, -7) && first <= addDays(today, 60);
  }

  // ---- guest card helpers ---------------------------------------------------------------------------------------------
  // Notes are one text field "YYYY-MM-DD: point | point || YYYY-MM-DD: point" (the dashboard's ImportantNotes parses it too).
  var PRIORITY = [[/security|incident|complaint|damage|dispute|concern/i, 0], [/special request|requested/i, 1], [/courtesy|benefit|goodwill|complimentary/i, 2], [/early check|late check|checkout/i, 3]];
  function pointPriority(p) { for (var i = 0; i < PRIORITY.length; i++) if (PRIORITY[i][0].test(p)) return PRIORITY[i][1]; return 4; }
  function parseNotes(text) {
    if (!text) return [];
    return String(text).split(' || ').map(function (chunk) {
      var m = /^(\d{4}-\d{2}-\d{2}):\s*([\s\S]*)$/.exec(chunk);
      var points = (m ? m[2] : chunk).split(' | ').map(function (p) { return p.trim(); }).filter(Boolean);
      points = points.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) { return pointPriority(a.p) - pointPriority(b.p) || a.i - b.i; }).map(function (x) { return x.p; });
      return { date: m ? m[1] : null, points: points };
    }).filter(function (g) { return g.points.length; });
  }
  // Returning pill text, or null when the guest is unknown or on a first stay.
  function returningLabel(g, compact) {
    if (!g || g.repeat !== true) return null;
    var tail = g.stay_count ? ' · ' + ordinal(g.stay_count) + ' stay' : '';
    return (compact ? 'Returning' : 'Returning guest') + tail;
  }
  function earlierLine(g) {
    var e = (g && g.earlier_stays) || [];
    if (!e.length) return null;
    return 'Earlier stays: ' + e.map(function (s) { return monthShortYear(s.month) + (s.nights != null ? ' · ' + plural(s.nights, 'night') : ''); }).join(', ');
  }
  // What the Today card says about the stay: in the house, arriving today, or nobody.
  function todayCardState(payload, today) {
    var cur = payload && payload.current_guest, nxt = payload && payload.next_guest;
    if (cur) return { kind: 'house', guest: cur, label: 'Today · in the house', pill: { tone: 'ok', text: cur.checkin_date === today ? 'Arrived today' : 'Checked in' } };
    if (nxt && nxt.checkin_date === today) return { kind: 'arriving', guest: nxt, label: 'Today · arriving', pill: { tone: 'info', text: 'Arrives today' } };
    if (nxt) return { kind: 'next', guest: nxt, label: 'No guest tonight', pill: { tone: 'neutral', text: 'Next ' + dayLabel(nxt.checkin_date) } };
    return { kind: 'none', guest: null, label: 'No guest tonight', pill: null };
  }

  // ---- warnings ---------------------------------------------------------------------------------------------------------
  // Order: brownouts, then red findings, then low stock, then the other findings; weather is added by the screen, last.
  function warningRank(w) {
    if (w.kind === 'brownout') return 0;
    if (w.kind === 'verifier' && w.severity === 'alert') return 1;
    if (w.kind === 'inventory') return 2;
    return 3;
  }
  function orderWarnings(list) {
    return (list || []).map(function (w, i) { return { w: w, i: i }; })
      .sort(function (a, b) { return warningRank(a.w) - warningRank(b.w) || a.i - b.i; }).map(function (x) { return x.w; });
  }
  function brownoutText(w) {
    var d = w.detail || {}, t = fmt24(d.time);
    var head = 'Brownout ' + (d.date ? dayShort(d.date) : '') + (t ? ' ' + t : '') + (d.hours ? ', ' + (+d.hours) + ' h' : '');
    var bits = [];
    if (w.title && !/^brownout\b/i.test(w.title)) bits.push(w.title);
    if (d.grid_line) bits.push('feeder ' + d.grid_line);
    if (d.posted_by) bits.push('posted by ' + d.posted_by);
    return { head: head.replace(/\s+/g, ' ').trim(), rest: bits.join(' · ') };
  }
  function lowStockText(w) {
    var d = w.detail || {};
    var name = String(w.title || '').replace(/^Low stock:\s*/i, '');
    var qty = d.qty != null ? ', ' + (+d.qty) + (d.unit ? ' ' + d.unit : '') : '';
    var below = d.reorder_below != null ? ' (reorder below ' + (+d.reorder_below) + ')' : '';
    return { head: 'Low stock', rest: name + qty + below };
  }
  // One line for the home screen: "3 warnings · brownouts 11 and 15 Oct · low stock".
  function warningSummary(list) {
    var n = (list || []).length;
    if (!n) return { count: 0, text: 'No warnings today' };
    var bo = list.filter(function (w) { return w.kind === 'brownout' && w.detail && w.detail.date; }).map(function (w) { return w.detail.date; });
    var parts = [];
    if (bo.length) {
      var days = bo.map(function (d) { return +d.split('-')[2]; });
      var mon = MONTHS[+bo[0].split('-')[1] - 1].slice(0, 3);
      parts.push((bo.length === 1 ? 'brownout ' : 'brownouts ') + (days.length > 1 ? days.slice(0, -1).join(', ') + ' and ' + days[days.length - 1] : days[0]) + ' ' + mon);
    }
    if (list.some(function (w) { return w.kind === 'inventory'; })) parts.push('low stock');
    var v = list.filter(function (w) { return w.kind === 'verifier'; }).length;
    if (v) parts.push(plural(v, 'system check'));
    return { count: n, text: plural(n, 'warning') + (parts.length ? ' · ' + parts.join(' · ') : '') };
  }
  function weatherLine(weather, today) {
    var c = weather && weather.current;
    if (!c || c.temp == null) return null;
    var t = Math.round(+c.temp) + '°' + (c.description ? ' ' + String(c.description).toLowerCase() : '');
    return (today ? dayLong(today) + ' · ' : '') + t;
  }
  function rainLine(weather) {
    var c = weather && weather.current;
    if (!c || c.rain_prob == null) return null;
    var hi = c.today_high != null ? Math.round(+c.today_high) : null, lo = c.today_low != null ? Math.round(+c.today_low) : null;
    return { head: 'Rain ' + Math.round(+c.rain_prob) + '% today', rest: hi != null && lo != null ? lo + ' to ' + hi + '°' : '' };
  }
  function weatherStale(weather, now) {
    if (!weather || !weather.fetched_at) return true;
    return ((now instanceof Date ? now.getTime() : (now == null ? Date.now() : now)) - new Date(weather.fetched_at).getTime()) > 90 * 60000;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---- tasks (D-301) ----------------------------------------------------------------------------------------------------
  // tasks_list_v1 returns ONE list over reminders, follow-ups, work orders, cleaning issues and open checks. The server already
  // limits and redacts it for the role; these helpers only group and word it.
  var TASK_KIND_LABEL = { reminder: 'Reminder', guest_follow_up: 'Guest follow-up', system: 'System task', cleaning_issue: 'Cleaning issue', guest_report: 'Guest report', work_order: 'Work order', verifier: 'Check needs a person' };
  function taskKindLabel(kind) { return Object.prototype.hasOwnProperty.call(TASK_KIND_LABEL, kind) ? TASK_KIND_LABEL[kind] : 'Task'; }
  // The Manila day of a timestamp; null when there is none or it does not parse (never "today").
  function manilaDayOf(ts) { if (!ts) return null; var t = new Date(ts).getTime(); return isFinite(t) ? manilaToday(new Date(t)) : null; }
  function taskDue(dueAt, today) { var d = manilaDayOf(dueAt); return d === null ? 'none' : d < today ? 'overdue' : d === today ? 'today' : 'later'; }
  // "Was due 4 Oct", "Due today 3:00 PM", "Due 9 Oct". A due time of exactly 00:00 Manila means "that day", so no time is shown.
  function taskDueLabel(dueAt, today) {
    var d = manilaDayOf(dueAt); if (d === null) return '';
    var p = manilaParts(new Date(dueAt)), time = p.h === 0 && p.min === 0 ? null : fmtTime(pad(p.h) + ':' + pad(p.min));
    var day = d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : dayLabel(d);
    return (d < today ? 'Was due ' + dayLabel(d) : 'Due ' + day) + (time ? ' ' + time : '');
  }
  // The date input of a reminder form -> the instant for 00:00 Manila that day. null when empty or not a date.
  function dueFromDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
    var t = Date.parse(iso + 'T00:00:00+08:00'); return isFinite(t) ? new Date(t).toISOString() : null;
  }
  var TASK_GROUPS = [['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Coming up'], ['none', 'No date'], ['done', 'Done recently']];
  var PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
  // Open tasks by due state (overdue first), then the done ones. Empty groups are left out. Inside a group: due time, priority, age.
  function taskGroups(tasks, today) {
    var by = {}; TASK_GROUPS.forEach(function (g) { by[g[0]] = []; });
    (Array.isArray(tasks) ? tasks : []).forEach(function (t) { by[t.status === 'done' ? 'done' : taskDue(t.due_at, today)].push(t); });
    function cmp(a, b) {
      var da = a.due_at || '9999', db = b.due_at || '9999';
      return da < db ? -1 : da > db ? 1 : ((PRIORITY_RANK[a.priority] == null ? 2 : PRIORITY_RANK[a.priority]) - (PRIORITY_RANK[b.priority] == null ? 2 : PRIORITY_RANK[b.priority])) ||
        (String(a.created_at) < String(b.created_at) ? -1 : 1);
    }
    return TASK_GROUPS.map(function (g) { return { key: g[0], label: g[1], tasks: by[g[0]].sort(cmp) }; }).filter(function (g) { return g.tasks.length > 0; });
  }
  // The number on the Tasks tab: open tasks that are overdue or due today.
  function taskDueCount(tasks, today) {
    return (Array.isArray(tasks) ? tasks : []).filter(function (t) { var s = taskDue(t.due_at, today); return t.status !== 'done' && (s === 'overdue' || s === 'today'); }).length;
  }
  function reminderProblem(title) {
    var t = String(title == null ? '' : title).trim();
    return t.length < 3 ? 'Give the reminder a short title.' : t.length > 200 ? 'Keep the title under 200 characters.' : '';
  }

  // ---- pay rates (D-301) ------------------------------------------------------------------------------------------------
  // cleaner_rate_schedule is the one source; this screen only ADDS a dated row through admin_add_pay_rate_v1 (owner and admin).
  function canEditRates(role) { return role === 'owner' || role === 'admin'; }
  // Unknown stays null, never 0.
  function rateNum(v) { if (v == null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; }
  // "₱500 per clean · ₱1,000 per deep clean · ₱150 transport when ticked". peso is the formatter (CSPay.peso).
  function rateLine(r, peso) {
    var reg = rateNum(r && r.regular_rate), gen = rateNum(r && r.general_rate), tr = rateNum(r && r.transport_rate);
    if (gen === null) gen = reg;
    return (reg === null ? '-' : peso(reg)) + ' per clean · ' + (gen === null ? '-' : peso(gen)) + ' per deep clean · ' + (tr === null ? 'transport included' : peso(tr) + ' transport when ticked');
  }
  // The earliest start the server accepts: the day after the latest row if that row starts today or later, else today.
  function earliestRateStart(history, today) {
    var latest = null; (Array.isArray(history) ? history : []).forEach(function (h) { if (h && h.effective_from && (latest === null || h.effective_from > latest)) latest = h.effective_from; });
    return latest !== null && latest >= today ? addDays(latest, 1) : today;
  }
  // Mirrors admin_add_pay_rate_v1's checks. '' = fine, else the sentence to show. i = {from, regular, general, transport, note} as typed.
  function rateProblem(i, earliest, today) {
    function money(s) { var t = String(s == null ? '' : s).replace(/,/g, '').trim(); return t === '' ? NaN : Number(t); }
    function fee(n, max) { return isFinite(n) && n >= 1 && n <= max && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6; }
    var reg = money(i.regular), gen = money(i.general), trText = String(i.transport == null ? '' : i.transport).trim(), tr = money(i.transport), note = String(i.note == null ? '' : i.note).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(i.from || ''))) return 'Pick the date the new rate starts.';
    if (i.from < earliest) return 'A new rate starts on ' + earliest + ' or later: history is never changed.';
    if (i.from > addDays(today, 366)) return 'The start date is more than a year away.';
    if (!fee(reg, 10000)) return 'The cleaning fee is between 1 and 10,000.';
    if (!fee(gen, 10000)) return 'The deep clean fee is between 1 and 10,000.';
    if (trText !== '' && tr !== 0 && !fee(tr, 2000)) return 'The transport fee is between 1 and 2,000, or leave it empty when the fee already includes transport.';
    if (note.length < 3) return 'Say why (a few words), for the audit history.';
    if (note.length > 500) return 'Keep the note under 500 characters.';
    return '';
  }
  // The RPC arguments for a typed form (transport empty or 0 -> null: the fee already includes it).
  function rateArgs(propertyId, i) {
    function money(s) { var t = String(s == null ? '' : s).replace(/,/g, '').trim(); return t === '' ? null : Number(t); }
    var tr = money(i.transport);
    return { p_property_id: propertyId, p_effective_from: i.from, p_regular: money(i.regular), p_general: money(i.general), p_transport: tr === 0 ? null : tr, p_note: String(i.note == null ? '' : i.note).trim() };
  }

  // ---- Cassy reply (s76): owner and admin draft warm guest replies from pasted text or a screenshot ---------------------------
  // The drafts carry prices and booking terms, so the button is owner and admin only; the function re-checks (403 staff_access_denied).
  var REPLY_MAX_TEXT = 4000, REPLY_MAX_IMAGE_BYTES = 4000000, REPLY_MAX_EDGE = 1600, REPLY_NAME_MAX = 80;
  function canDraftReply(role) { return role === 'owner' || role === 'admin'; }
  // SPEC-44: pending direct bookings the host must confirm. Money roles only; cleaners, inspectors and maintenance never see the row or call the RPC.
  var INQUIRIES_URL = 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/bookings/inquiries';
  function canSeeBookingsToConfirm(role) { return role === 'owner' || role === 'admin' || role === 'finance'; }
  // staff_inquiry_payments_v1 returns an array of pending bookings. Anything else (error, null, {ok:false}) is 0, so the row hides.
  // A whole number passes through, so the stored count can go back through the same gate.
  function bookingsToConfirmCount(data) { return Array.isArray(data) ? data.length : (Number.isInteger(data) && data > 0 ? data : 0); }
  function bookingsToConfirmRow(role, data) {
    var n = canSeeBookingsToConfirm(role) ? bookingsToConfirmCount(data) : 0;
    return n > 0 ? { count: n > 99 ? '99+' : String(n), n: n, href: INQUIRIES_URL } : null;
  }
  // Longest edge capped at max, aspect kept, never enlarged, never 0.
  function shrinkSize(w, h, max) {
    max = max || REPLY_MAX_EDGE; w = Math.max(1, Math.round(Number(w) || 0)); h = Math.max(1, Math.round(Number(h) || 0));
    var long = Math.max(w, h); if (long <= max) return { w: w, h: h };
    var k = max / long; return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  // '' = fine, else the sentence to show before anything is sent. i = {mode: 'text'|'image', text, image: {base64, mime}|null}
  function replyProblem(i) {
    i = i || {};
    if (i.mode === 'image') return i.image && i.image.base64 ? '' : 'Choose a screenshot first.';
    var t = String(i.text == null ? '' : i.text).trim();
    return !t ? 'Paste what the guest sent first.' : t.length > REPLY_MAX_TEXT ? 'That message is longer than 4,000 characters. Paste just the guest’s latest messages.' : '';
  }
  // The request body for guest-reply-draft: exactly one of text or image, guest_name null when empty, platform messenger unless airbnb.
  function replyBody(i) {
    i = i || {}; var name = String(i.guestName == null ? '' : i.guestName).trim().slice(0, REPLY_NAME_MAX);
    var b = i.mode === 'image' ? { image: { base64: String(i.image && i.image.base64 || ''), mime: i.image && i.image.mime || 'image/jpeg' } } : { text: String(i.text == null ? '' : i.text).trim() };
    b.guest_name = name || null; b.platform = i.platform === 'airbnb' ? 'airbnb' : 'messenger';
    return b;
  }
  // Error code (or status, or 'network') -> one warm sentence. Never shows the raw code.
  var REPLY_ERRORS = {
    empty: 'Paste what the guest sent first.',
    both: 'Send either the text or a screenshot, not both.',
    too_long: 'That message is longer than 4,000 characters. Paste just the guest’s latest messages.',
    bad_image: 'That picture could not be read. Try another screenshot, or paste the text instead.',
    bad_json: 'That did not send properly. Try again.',
    invalid_or_expired_session: 'Your sign-in has run out. Sign out, then sign in again.',
    staff_access_denied: 'Only owner and admin accounts can draft guest replies.',
    image_too_large: 'That picture is too large. Try a smaller screenshot, or paste the text instead.',
    no_guest_message: 'No guest message could be found in that. Try a clearer screenshot, or paste the text instead.',
    draft_failed: 'Cassy could not write a draft just now. Wait a moment and try again.',
    network: 'No connection. Check your signal and try again.'
  };
  var REPLY_STATUS = { 401: 'invalid_or_expired_session', 403: 'staff_access_denied', 413: 'image_too_large', 422: 'no_guest_message', 502: 'draft_failed' };
  function replyErrorText(status, code) {
    var k = REPLY_ERRORS[code] ? code : REPLY_STATUS[status] || (status === 0 || status == null ? 'network' : '');
    return REPLY_ERRORS[k] || 'That did not work. Try again in a moment.';
  }
  // A 200 body -> what the screen draws, or null when the shape is wrong (the screen then says draft_failed).
  function replyResult(j) {
    if (!j || j.ok !== true || !Array.isArray(j.replies)) return null;
    var replies = j.replies.filter(function (r) { return typeof r === 'string' && r.trim(); });
    if (!replies.length) return null;
    return { guestName: typeof j.guest_name === 'string' && j.guest_name ? j.guest_name : '', platform: j.platform === 'airbnb' ? 'airbnb' : 'messenger', guestText: String(j.guest_text == null ? '' : j.guest_text), header: typeof j.header === 'string' ? j.header : '', replies: replies.slice(0, 2) };
  }
  function clampText(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

  return {
    taskKindLabel: taskKindLabel, manilaDayOf: manilaDayOf, taskDue: taskDue, taskDueLabel: taskDueLabel, dueFromDate: dueFromDate, taskGroups: taskGroups,
    taskDueCount: taskDueCount, reminderProblem: reminderProblem, canEditRates: canEditRates, rateNum: rateNum, rateLine: rateLine,
    earliestRateStart: earliestRateStart, rateProblem: rateProblem, rateArgs: rateArgs,
    canSeeBookingsToConfirm: canSeeBookingsToConfirm, bookingsToConfirmCount: bookingsToConfirmCount, bookingsToConfirmRow: bookingsToConfirmRow, INQUIRIES_URL: INQUIRIES_URL,
    canDraftReply: canDraftReply, shrinkSize: shrinkSize, replyProblem: replyProblem, replyBody: replyBody, replyErrorText: replyErrorText, replyResult: replyResult, clampText: clampText,
    REPLY_MAX_IMAGE_BYTES: REPLY_MAX_IMAGE_BYTES, REPLY_MAX_EDGE: REPLY_MAX_EDGE,
    staffAuthPassword: staffAuthPassword, staffLoginEmail: staffLoginEmail, deriveDisplayName: deriveDisplayName, greetingName: greetingName,
    signinKind: signinKind, signinList: signinList, typedEntry: typedEntry, keypadPress: keypadPress, signinCredentials: signinCredentials,
    authStorage: authStorage, trustedFromStorage: trustedFromStorage, rememberName: rememberName, recalledName: recalledName, doorTarget: doorTarget, doorLink: doorLink, doorRule: doorRule, doorFramed: doorFramed,
    layoutForRole: layoutForRole, accessVerdict: accessVerdict, assertNoMoney: assertNoMoney, moneyKeys: moneyKeys,
    manilaToday: manilaToday, manilaParts: manilaParts, addDays: addDays, daysBetween: daysBetween, weekdayIndex: weekdayIndex,
    dayLabel: dayLabel, dayLong: dayLong, dayShort: dayShort, monthTitle: monthTitle, monthShortYear: monthShortYear, greeting: greeting,
    fmtTime: fmtTime, fmt24: fmt24, ordinal: ordinal, plural: plural, agoLabel: agoLabel, clockLabel: clockLabel,
    monthGrid: monthGrid, dayState: dayState, dayStatus: dayStatus, blockWhy: blockWhy, flagName: flagName, FLAG_KINDS: FLAG_KINDS, blockedLines: blockedLines, blockedLineText: blockedLineText,
    canFlagDays: canFlagDays, guestContact: guestContact, canSeeGuestContact: canSeeGuestContact, MESSENGER_INBOX: MESSENGER_INBOX, rpcMissing: rpcMissing, tgLink: tgLink, warningInfo: warningInfo, findingKey: findingKey, initialOf: initialOf, sourceLabel: sourceLabel, stayDates: stayDates, monthInRange: monthInRange,
    parseNotes: parseNotes, returningLabel: returningLabel, earlierLine: earlierLine, todayCardState: todayCardState,
    orderWarnings: orderWarnings, brownoutText: brownoutText, lowStockText: lowStockText, warningSummary: warningSummary,
    weatherLine: weatherLine, rainLine: rainLine, weatherStale: weatherStale, esc: esc
  };
});
