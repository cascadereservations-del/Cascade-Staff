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
      return { label: label, handle: handle, kind: kind, team: r.team === 'staff' ? 'staff' : 'admin' };
    }).filter(function (r) { return r.label && r.handle.indexOf('@') > 0; });
  }
  // Install links ?team=staff|admin (3.4.2). A valid param wins and is stored; else the stored value; else 'admin' (everyone, as before).
  var TEAM_KEY = 'cs-team';
  function teamValue(v) { return v === 'staff' || v === 'admin' ? v : null; }
  function resolveTeam(search, storage) {
    var m = /[?&]team=([^&#]*)/.exec(String(search || '')), t = m ? teamValue(decodeURIComponent(m[1])) : null;
    if (t) { try { storage.setItem(TEAM_KEY, t); } catch (e) {} return t; }
    try { t = teamValue(storage.getItem(TEAM_KEY)); } catch (e) {}
    return t || 'admin';
  }
  // The staff link shows only team 'staff' rows; 'admin' or anything else shows everyone.
  function signinForTeam(list, team) { return team === 'staff' ? (list || []).filter(function (r) { return r.team === 'staff'; }) : (list || []); }
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
    return s ? { email: entry.handle, password: staffAuthPassword(s) } : null; // a 4-digit value is padded too: a real password is 6+ characters
  }
  // "Use a password instead" / "Use PIN": the same handle for this attempt only. A PIN entry may really hold a mailbox password, so it must never lock the person out.
  // 'password' sends the typed value as-is, except an exactly-4-digit value is padded like a PIN; 'pin' goes back to 4 digits. The caller's entry is not changed, and a fresh pick starts from its own kind.
  function signinAsKind(entry, kind) {
    if (!entry || !entry.handle || (kind !== 'pin' && kind !== 'password')) return entry || null;
    var o = {}; for (var k in entry) o[k] = entry[k];
    o.kind = kind; o.wasPin = !!entry.wasPin || entry.kind === 'pin'; return o;
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
    manual: { layouts: ['staff', 'admin'], localKey: false },
    inventory: { layouts: ['admin'], localKey: true }, // the folded admin build reads the same localStorage session as the dashboard
    guide: { layouts: ['staff', 'admin'], localKey: false },
    adminguide: { layouts: ['admin'], localKey: false } // encrypted on its own; no session needed
  };
  // Who sees which door (D-324): role decides, the server stays the real gate. Order = order on the home screen.
  var ALL_ROLES = ['owner', 'admin', 'finance', 'cleaner', 'inspector', 'maintenance'];
  var DOOR_ROLES = {
    checklist: ALL_ROLES, manual: ALL_ROLES, guide: ALL_ROLES,
    dashboard: ['owner', 'admin', 'finance'],
    inventory: ['owner', 'admin'],
    adminguide: ['owner', 'admin']
  };
  var DOOR_ORDER = ['checklist', 'dashboard', 'manual', 'inventory', 'guide', 'adminguide'];
  function doorAllowed(key, role) { return Object.prototype.hasOwnProperty.call(DOOR_ROLES, key) && DOOR_ROLES[key].indexOf(role) >= 0; }
  function doorsForRole(role) { return DOOR_ORDER.filter(function (k) { return doorAllowed(k, role); }); }
  // Where each door lives once its surface is folded into this app: key -> [surface in fold-manifest.json, relative url].
  var FOLD_DOORS = {
    checklist: ['checklist', './checklist/'], dashboard: ['admin', './admin/#/today'], inventory: ['admin', './admin/#/inventory'],
    manual: ['manual', './manual/'], guide: ['guide', './guide/staff/'], adminguide: ['guide', './guide/admin/']
  };
  // fold-manifest.json -> {doorKey: relativeUrl} for the surfaces that were folded (null, 404 or junk = nothing folded).
  function foldedDoorUrls(manifest) {
    var out = {}, s = manifest && typeof manifest === 'object' && manifest.surfaces && typeof manifest.surfaces === 'object' ? manifest.surfaces : {};
    Object.keys(FOLD_DOORS).forEach(function (k) { var e = s[FOLD_DOORS[k][0]]; if (e && e.files > 0 && (k !== 'adminguide' || e.adminGuide === true)) out[k] = FOLD_DOORS[k][1]; });
    return out;
  }
  // A folded sibling that sends its TOP window "up" (../) would load the shell inside its own frame. If this window is framed by a
  // same-origin parent, return where that parent should go (its own path and query, so ?demo survives, at #home); else null.
  function framedParentTarget(win) {
    try {
      var par = win.parent;
      if (par && par !== win && par.location.origin === win.location.origin) return par.location.pathname + par.location.search + '#home';
    } catch (e) { /* cross-origin parent: leave it alone */ }
    return null;
  }
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
        if (keyTokens(k).some(function (t) { return MONEY_TOKEN.test(t); })) out.push(path + '.' + k + (k === 'paid' && /\.arrival_ready$/.test(path) && (typeof value[k] === 'boolean' || value[k] === null) ? '#bool' : ''));
        moneyKeys(value[k], path + '.' + k, out);
      });
    }
    return out;
  }
  // s77: owner and admin may receive the guest's phone and e-mail on the two guest cards, nowhere else. Money keys stay refused for
  // every role, and a contact key anywhere else (or for any other role) still blocks the page.
  var CONTACT_OK = /^\$\.(current_guest|next_guest)\.(phone|email)$/;
  var ARRIVAL_OK = /\.arrival_ready\.paid#bool$/; // s82: whether the balance is received, as true or false, for owner and admin; never an amount
  function canSeeGuestContact(role) { return role === 'owner' || role === 'admin'; }
  function assertNoMoney(payload, opts) {
    var allow = !!(opts && opts.allowContact);
    var bad = moneyKeys(payload).filter(function (p) { return !(allow && (CONTACT_OK.test(p) || ARRIVAL_OK.test(p))); });
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
  // "26-27 Oct" for the nights from 26 to 27 Oct, "26 Oct" for one night, "30 Oct-1 Nov" across a month
  function A_rangeLabel(a, b) { if (!a) return ''; if (!b || b === a) return dayLabel(a); var x = String(a).split('-'), y = String(b).split('-'); return x[1] === y[1] ? +x[2] + '-' + dayLabel(b) : dayLabel(a) + '-' + dayLabel(b); }
  function dayShort(iso) { return DAYS[weekdayIndex(iso)].slice(0, 3) + ' ' + dayLabel(iso); } // Thu 8 Oct
  function monthTitle(y, m) { return MONTHS[m - 1] + ' ' + y; }
  function monthShortYear(ym) { var a = String(ym).split('-'); return MONTHS[+a[1] - 1].slice(0, 3) + ' ' + a[0]; } // 2026-06 -> Jun 2026
  function greeting(now) { var h = manilaParts(now).h; return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  // '14:00:00' -> '2:00 pm'; '12:00:00' -> '12:00 noon'; null stays null.
  function fmtTime(t) {
    if (!t) return null;
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t)); if (!m) return null;
    var h = +m[1], min = m[2];
    if (h === 12 && min === '00') return '12:00 noon';
    var ap = h >= 12 ? 'pm' : 'am'; var h12 = h % 12 === 0 ? 12 : h % 12;
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
  // ---- stays (s78, D-320): one stay per guest, shown through its checkout day.
  // Two confirmed rows for the same guest are ONE stay when they chain under the exact same name (an extension), or overlap from
  // two channels (a direct booking and its Airbnb copy; there the name may be the other plus more words: "Bia" / "Bia Cruz").
  // The label row is the one with confirmed payment: direct first, then the Airbnb reservation.
  // ponytail: names only (the calendar rows carry no guest id); two different people with the same name back to back would merge.
  function nameKey(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function sameGuest(a, b) {
    var x = nameKey(a && a.guest_name), y = nameKey(b && b.guest_name);
    return !!x && !!y && (x === y || x.indexOf(y + ' ') === 0 || y.indexOf(x + ' ') === 0);
  }
  var PAID_RANK = { direct: 0, airbnb: 1 };
  function paidRank(r) { return Object.prototype.hasOwnProperty.call(PAID_RANK, r.source) ? PAID_RANK[r.source] : 2; }
  function mergeStays(rows) {
    var list = (rows || []).filter(function (r) { return r && r.status === 'confirmed' && r.checkin_date && r.checkout_date; })
      .sort(function (a, b) { return a.checkin_date < b.checkin_date ? -1 : a.checkin_date > b.checkin_date ? 1 : 0; });
    var groups = [];
    list.forEach(function (r) {
      // A merge must never hide a turnover or a clash: chained rows (one checks out the day the other checks in) join only on the
      // exact same name; overlapping rows join only across two channels (a direct booking and its Airbnb copy). Two rows from one
      // channel on the same nights stay apart and show as a clash.
      var g = groups.filter(function (x) {
        return x.rows.some(function (y) {
          if (r.checkin_date < y.checkout_date && r.checkout_date > y.checkin_date) return r.source !== y.source && sameGuest(y, r);
          return (r.checkin_date === y.checkout_date || r.checkout_date === y.checkin_date) && !!nameKey(r.guest_name) && nameKey(r.guest_name) === nameKey(y.guest_name);
        });
      })[0];
      if (g) { g.rows.push(r); if (r.checkout_date > g.to) g.to = r.checkout_date; } else groups.push({ from: r.checkin_date, to: r.checkout_date, rows: [r] });
    });
    return groups.map(function (g, i) {
      var best = g.rows.slice().sort(function (a, b) { return paidRank(a) - paidRank(b); })[0], s = {};
      Object.keys(best).forEach(function (k) { s[k] = best[k]; });
      s.checkin_date = g.from; s.checkout_date = g.to; s.nights = daysBetween(g.from, g.to); s.rows = g.rows;
      s.tone = i % 2; // neighbours alternate two looks so a turnover day shows two distinct halves
      return s;
    });
  }
  // What one calendar day holds. The night (checkin..checkout-1) gives the primary: booked > blocked > free. On top: the stay that
  // checks out this morning (out), whether the night's stay arrives today (arrive), a turnover (one guest out, another in) and a
  // clash (two different guests on the same night: a real overlap, shown red).
  function dayStatus(iso, rows, dayFlags, warnings, stays) {
    stays = stays || mergeStays(rows);
    var nights = stays.filter(function (s) { return iso >= s.checkin_date && iso < s.checkout_date; }), stay = nights[0] || null;
    var out = stays.filter(function (s) { return s.checkout_date === iso; })[0] || null;
    var blocks = (rows || []).filter(function (r) { return r.status === 'blocked' && iso >= r.checkin_date && iso < r.checkout_date; });
    var block = blocks[0] || null, primary = stay ? 'booked' : block ? 'blocked' : 'free', arrive = !!stay && stay.checkin_date === iso;
    return { primary: primary, stay: stay, block: block, blocks: blocks, blockWhy: blocksWhy(blocks), startsHere: arrive, cont: !!stay && addDays(iso, 1) < stay.checkout_date,
      arrive: arrive, out: out, turnover: !!(out && arrive), clash: nights.slice(1), clashIn: nights.slice(1).filter(function (s) { return s.checkin_date === iso; }),
      why: stay ? (stay.guest_name || 'Guest') : block ? blocksWhy(blocks) : 'Open for a booking', flags: flagsFor(iso, dayFlags, warnings) };
  }
  // The day in words for the cell's label and the sheet: "Ana checks out, Ben arrives".
  function dayMoves(ds) {
    var w = [];
    if (ds.out) w.push((ds.out.guest_name || 'Guest') + ' checks out');
    if (ds.arrive) w.push((ds.stay.guest_name || 'Guest') + ' arrives');
    (ds.clashIn || []).forEach(function (s) { w.push((s.guest_name || 'Guest') + ' arrives'); });
    return w.join(', ');
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
  // s79: "With: Ana, Ben (ID on file for 1 of 2)". Owner/admin only: the key is absent for cleaners, and so is the line.
  function companionsLine(g) {
    var c = g && g.companions;
    if (!Array.isArray(c) || !c.length) return null;
    var names = c.map(function (x) { return String((x && x.name) || '').trim(); }).filter(Boolean);
    if (!names.length) return null;
    var withId = c.filter(function (x) { return x && x.has_photo === true; }).length;
    return 'With: ' + names.join(', ') + ' (ID on file for ' + withId + ' of ' + c.length + ')';
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
  function lowStockParts(w) { var d = w.detail || {}; return { name: String(w.title || '').replace(/^Low stock:\s*/i, ''), qty: d.qty != null ? +d.qty : null, unit: d.unit || '', below: d.reorder_below != null ? +d.reorder_below : null }; }
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
  // 60 minutes: the same age at which notices_v1 stops sending its weather (SQL: c_at > now() - interval '60 minutes'). Never higher than the server rule.
  var WEATHER_STALE_MIN = 60;
  function weatherStale(weather, now) {
    if (!weather || !weather.fetched_at) return true;
    return ((now instanceof Date ? now.getTime() : (now == null ? Date.now() : now)) - new Date(weather.fetched_at).getTime()) > WEATHER_STALE_MIN * 60000;
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
  var TASK_GROUPS = [['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Coming up'], ['none', 'No due date'], ['done', 'Done recently']];
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
  // E_: the word on a priority pill ("high" is a raw value). Normal and low priority get no pill.
  function taskPriorityLabel(p) { return p === 'urgent' ? 'Urgent' : p === 'high' ? 'High priority' : ''; }
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
  // s82 decision 5: Cassy reply is open to every signed-in staff role. The guest-details uploader (ID photos, companions) stays owner and admin.
  function canDraftReply(role) { return ALL_ROLES.indexOf(role) >= 0; }
  function canAddGuestDetails(role) { return role === 'owner' || role === 'admin'; }
  // SPEC-44: pending direct bookings the host must confirm. Money roles only; cleaners, inspectors and maintenance never see the row or call the RPC.
  var INQUIRIES_URL = 'https://cascadereservations-del.github.io/cascade-admin-dashboard/#/bookings/inquiries';
  function canSeeBookingsToConfirm(role) { return role === 'owner' || role === 'admin' || role === 'finance'; }
  // staff_inquiry_payments_v1 returns an array of pending bookings. Anything else (error, null, {ok:false}) is 0, so the row hides.
  // A whole number passes through, so the stored count can go back through the same gate.
  function bookingsToConfirmCount(data) { return Array.isArray(data) ? data.length : (Number.isInteger(data) && data > 0 ? data : 0); }
  // E_: hubLink = the in-app door for bookings/inquiries ({href, external}); the old stand-alone dashboard URL is only the fallback when no dashboard is folded in.
  function bookingsToConfirmRow(role, data, hubLink) {
    var n = canSeeBookingsToConfirm(role) ? bookingsToConfirmCount(data) : 0;
    return n > 0 ? { count: n > 99 ? '99+' : String(n), n: n, href: hubLink && hubLink.href ? hubLink.href : INQUIRIES_URL, external: hubLink && hubLink.href ? !!hubLink.external : true } : null;
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
  // s82 H: the server returns options [{label, text}] (2 or 3); an older server returns replies [string]; the oldest a single draft. All three draw the same cards.
  function replyResult(j) {
    if (!j || j.ok !== true) return null;
    var opts = (Array.isArray(j.options) ? j.options : []).filter(function (o) { return o && typeof o.text === 'string' && o.text.trim(); })
      .map(function (o) { return { label: typeof o.label === 'string' ? o.label.trim().slice(0, 24) : '', text: o.text }; });
    if (!opts.length) {
      var many = (Array.isArray(j.replies) ? j.replies : []).filter(function (r) { return typeof r === 'string' && r.trim(); });
      if (!many.length && typeof j.draft === 'string' && j.draft.trim()) many = [j.draft];
      opts = many.map(function (t) { return { label: '', text: t }; });
    }
    if (!opts.length) return null;
    opts = opts.slice(0, 3);
    return { guestName: typeof j.guest_name === 'string' && j.guest_name ? j.guest_name : '', platform: j.platform === 'airbnb' ? 'airbnb' : 'messenger', guestText: String(j.guest_text == null ? '' : j.guest_text), header: typeof j.header === 'string' ? j.header : '',
      options: opts, replies: opts.map(function (o) { return o.text; }) };
  }
  function clampText(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

  // ---- install page (s80): which of five states the one-link install page shows ----------------------------------------------
  // A chat app's built-in browser (Messenger, Facebook, Instagram, Telegram on some phones, an Android WebView) cannot install anything. An iPhone
  // web view carries no "Safari/" token in its user agent, which is how it gives itself away.
  var INAPP_RE = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|FBSS|Messenger|Orca-Android|Instagram|Snapchat|MicroMessenger|Line\/|Telegram|GSA\/|; wv\)/i;
  var IOS_RE = /iPhone|iPad|iPod/i;
  function isInAppBrowser(ua) { ua = String(ua || ''); return INAPP_RE.test(ua) || (IOS_RE.test(ua) && !/Safari\//.test(ua)); }
  // e = { ua, standalone, installed, prompt (a beforeinstallprompt was caught), touchPoints }. -> installed | inapp | ios | prompt | unsupported
  function installState(e) {
    e = e || {}; var ua = String(e.ua || '');
    if (e.standalone || e.installed) return 'installed';
    if (isInAppBrowser(ua)) return 'inapp';
    if (IOS_RE.test(ua) || (/Macintosh/.test(ua) && e.touchPoints > 1)) return 'ios'; // iPadOS asks for the desktop site by default
    if (e.prompt) return 'prompt';
    return 'unsupported';
  }
  // The button that leaves a chat app's browser for the phone's own: Android opens Chrome (and falls back to the page itself), iPhone opens Safari.
  // null on a desktop or for a non-https address: the Copy link button is all there is then.
  function openInBrowserLink(ua, url) {
    var m = /^https:\/\/([^\s#]+)$/.exec(String(url || '')); if (!m) return null;
    if (/android/i.test(ua)) return { label: 'Open in Chrome', href: 'intent://' + m[1] + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(url) + ';end' };
    if (IOS_RE.test(ua)) return { label: 'Open in Safari', href: 'x-safari-https://' + m[1] };
    return null;
  }
  var INSTALL_URL = 'https://cascadereservations-del.github.io/Cascade-Staff/install/';
  // The two links staff paste into guest replies most often (3.4.3). Add a row here and the Cassy reply screen lists it.
  var COMMON_LINKS = [
    { label: 'Welcome guide', url: 'https://tinyurl.com/WelcomeToCascade' },
    { label: 'Direct booking site', url: 'https://tinyurl.com/Stay-at-Cascade' }
  ];
  // The page the person is on, as the Open-in-Safari / Copy link buttons should carry it: same address, ?team= kept, no fragment.
  function pageLink(loc) { return String(loc && loc.href || '').replace(/#.*$/, ''); }

  // ---- v5 shell (Lane A, s81). Everything new carries the A_ prefix. Pure; the screens in app.js only draw what these return. ------------------------
  // The house times: check-out 12:00 noon, check-in 2:00 pm (turnover window 12:00 to 2:00 pm). Read from notices_v1.house_times; this is the one fallback.
  var A_HOUSE_FALLBACK = { check_out: '12:00', check_in: '14:00' };
  function A_hhmm(t, fb) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m && +m[1] < 24 && +m[2] < 60 ? pad(+m[1]) + ':' + m[2] : fb; }
  function A_houseTimes(h) {
    var out = A_hhmm(h && h.check_out, A_HOUSE_FALLBACK.check_out), inn = A_hhmm(h && h.check_in, A_HOUSE_FALLBACK.check_in);
    if (+out.slice(0, 2) * 60 + +out.slice(3) >= +inn.slice(0, 2) * 60 + +inn.slice(3)) { out = A_HOUSE_FALLBACK.check_out; inn = A_HOUSE_FALLBACK.check_in; } // a window that runs backwards is junk
    return { check_out: out, check_in: inn, outLabel: fmtTime(out), inLabel: fmtTime(inn), outMin: +out.slice(0, 2) * 60 + +out.slice(3), inMin: +inn.slice(0, 2) * 60 + +inn.slice(3) };
  }
  // Where "now" (Manila) sits against the turnover window: before check-out, inside the window, or after check-in.
  function A_turnoverClock(now, houseTimes) {
    var t = A_houseTimes(houseTimes), p = manilaParts(now), m = p.h * 60 + p.min;
    var phase = m < t.outMin ? 'before' : m < t.inMin ? 'window' : 'after';
    return { phase: phase, minsToOut: Math.max(0, t.outMin - m), minsToIn: Math.max(0, t.inMin - m), times: t };
  }
  // 'noon', '2 pm', '2:30 pm': short enough for one line in a third of a phone
  function A_shortTime(hhmm) { var m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '')); if (!m) return ''; var h = +m[1]; if (h === 12 && m[2] === '00') return 'noon'; return (h % 12 === 0 ? 12 : h % 12) + (m[2] === '00' ? '' : ':' + m[2]) + ' ' + (h >= 12 ? 'pm' : 'am'); }
  function A_hm(mins) { var h = Math.floor(mins / 60), m = mins % 60; return h ? h + ' h ' + m + ' m' : m + ' m'; }
  function A_turnoverLine(clock, arrivesToday) {
    if (!arrivesToday) return 'No arrival today';
    if (clock.phase === 'after') return 'Check-in time has passed';
    return 'Next guest in ' + A_hm(clock.minsToIn);
  }

  // ---- notices_v1 (Lane B builds the RPC; the client reads it and trusts nothing) ----
  var A_NOTICE_TYPES = { power: { icon: 'zap', word: 'Power' }, water: { icon: 'drop', word: 'Water' }, rain: { icon: 'rain', word: 'Rain' },
    deep_clean: { icon: 'sparkles', word: 'Deep clean' }, blocked: { icon: 'lock', word: 'Blocked' }, note: { icon: 'note', word: 'Note' } };
  var A_NOTICE_SOURCE = { socoteco: 'SOCOTECO II', gscwd: 'GSCWD', manual: 'Added by hand', system: 'System' };
  var A_WEATHER_SOURCE = { pirate: 'Pirate Weather', google: 'Google Weather', 'open-meteo': 'Open-Meteo' };
  function A_hour12(iso) { var d = new Date(iso); if (isNaN(d.getTime())) return ''; var p = manilaParts(d); return (p.h % 12 === 0 ? 12 : p.h % 12) + (p.h >= 12 ? ' pm' : ' am'); }
  // '2 to 5 pm' when both ends share am or pm, '10 am to 2 pm' when they do not.
  function A_hourSpan(a, b) { if (!A_hour12(a) || !A_hour12(b)) return ''; var x = A_hour12(a).split(' '), y = A_hour12(b).split(' '); return x[1] === y[1] ? x[0] + ' to ' + y[0] + ' ' + y[1] : x.join(' ') + ' to ' + y.join(' '); }
  function A_titleHasTime(t) { return /\d{1,2}(:\d{2})? ?(am|pm)\b/i.test(String(t || '')); } // E_: the title already says the time, so the sub does not
  function A_timeRange(s, e) { var a = fmtTime(A_hhmm(s, null)), b = fmtTime(A_hhmm(e, null)); return a && b ? a + ' to ' + b : a || ''; }
  // The server filters by role; this filters again. A cleaner (any staff layout) never gets `house` or `inbox_open`, even if the payload carries them.
  function A_noticesView(raw, role, today) {
    if (!raw || typeof raw !== 'object' || raw.ok === false || Array.isArray(raw)) return null;
    var mgr = canSeeGuestContact(role), times = A_houseTimes(raw.house_times);
    var w = raw.weather && typeof raw.weather === 'object' ? raw.weather : null, weather = null;
    if (w && typeof w.temp_c === 'number') {
      weather = { source: A_WEATHER_SOURCE[w.source] || '', temp: Math.round(w.temp_c), condition: String(w.condition || ''), rain: typeof w.rain_chance_pct === 'number' ? Math.round(w.rain_chance_pct) : null,
        aqi: typeof w.aqi === 'number' ? Math.round(w.aqi) : null, fetched_at: w.fetched_at || null,
        hours: (Array.isArray(w.hourly) ? w.hourly : []).slice(0, 12).filter(function (h) { return h && h.time; }).map(function (h) { return { label: A_hour12(h.time), pct: typeof h.rain_chance_pct === 'number' ? Math.round(h.rain_chance_pct) : 0, mm: typeof h.mm === 'number' ? h.mm : 0 }; }),
        watch: null };
      var rw = w.rain_watch;
      if (rw && rw.from && rw.to && A_hourSpan(rw.from, rw.to)) weather.watch = { text: 'Rain watch, ' + A_hourSpan(rw.from, rw.to), peak: typeof rw.peak_pct === 'number' ? Math.round(rw.peak_pct) : null };
    }
    var list = [];
    if (weather && weather.watch) list.push({ key: 'rain-watch', type: 'rain', group: 'weather', title: weather.watch.text, sub: weather.watch.peak != null ? weather.watch.peak + '% chance today' : 'Showers likely',
      date: today || null, detail: 'Close the windows and bring in the laundry before the rain.', source: weather.source, tell: false });
    (Array.isArray(raw.notices) ? raw.notices : []).forEach(function (n) {
      if (!n || typeof n !== 'object' || !n.id || !n.title) return;
      var type = A_NOTICE_TYPES[n.type] ? n.type : 'note', date = /^\d{4}-\d{2}-\d{2}$/.test(String(n.date || '')) ? n.date : null;
      if (today && date && date < today) return;
      var src = A_NOTICE_SOURCE[n.source] || '';
      list.push({ key: 'n:' + n.id, id: String(n.id), type: type, group: type === 'power' || type === 'water' ? type : 'other', title: String(n.title), date: date, start: n.start_time || null, end: n.end_time || null,
        sub: [date ? dayShort(date) : '', A_titleHasTime(n.title) ? '' : A_timeRange(n.start_time, n.end_time), src].filter(Boolean).join(' · '), detail: n.detail ? String(n.detail) : '', source: src, raw: String(n.source || ''), url: H_noticeUrl(n.url), tell: canSeeGuestContact(role) && (type === 'power' || type === 'water' || type === 'rain') });
    });
    list.sort(function (a, b) { return (a.type === 'rain' && a.key === 'rain-watch' ? 0 : 1) - (b.type === 'rain' && b.key === 'rain-watch' ? 0 : 1) || String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.start || '').localeCompare(String(b.start || '')); });
    var house = mgr ? (Array.isArray(raw.house) ? raw.house : []).filter(function (h) { return h && (h.kind === 'low_stock' || h.kind === 'finding') && h.title; })
      .map(function (h) { return { key: 'h:' + h.kind + ':' + h.id, id: String(h.id || ''), kind: h.kind, type: 'house', group: 'house', title: String(h.title), sub: h.detail ? String(h.detail) : '', detail: h.detail ? String(h.detail) : '' }; }) : [];
    var srcs = raw.sources && typeof raw.sources === 'object' ? raw.sources : {};
    return { sources: { water: A_sourceUrl('water', srcs, 'water_page'), power: A_sourceUrl('power', srcs, 'power_page') }, times: times, weather: weather, list: list, house: house, all: list.concat(house), inbox: mgr && typeof raw.inbox_open === 'number' ? raw.inbox_open : null, mgr: mgr,
      counts: { all: list.length + house.length, weather: list.filter(function (x) { return x.group === 'weather'; }).length + (weather ? 1 : 0), power: list.filter(function (x) { return x.group === 'power'; }).length,
        water: list.filter(function (x) { return x.group === 'water'; }).length, house: house.length } };
  }
  // The two source pages are PINNED here. The setting behind notices_v1.sources is staff-writable, so it is never trusted: a payload value counts only when it
  // parses to https on www.facebook.com, m.facebook.com or facebook.com, with no query, no hash, no credentials, no port and exactly the pinned page's path
  // (case-insensitive, optional trailing slash). What is returned is always the pinned address itself, never the payload's spelling.
  var A_PINNED = { water: 'https://www.facebook.com/gscwaterdistrict/', power: 'https://www.facebook.com/socoteco2.EC/' };
  function A_facebookUrl(u, key) {
    if (!Object.prototype.hasOwnProperty.call(A_PINNED, key) || typeof u !== 'string' || u.length > 300 || u.indexOf('?') >= 0 || u.indexOf('#') >= 0) return null;
    try {
      var x = new URL(u), want = new URL(A_PINNED[key]).pathname.replace(/\/$/, '').toLowerCase();
      var ok = x.protocol === 'https:' && (x.hostname === 'www.facebook.com' || x.hostname === 'm.facebook.com' || x.hostname === 'facebook.com') && !x.username && !x.password && !x.port && !x.search && !x.hash && x.pathname.replace(/\/$/, '').toLowerCase() === want;
      return ok ? A_PINNED[key] : null;
    } catch (e) { return null; }
  }
  // A page whose entry is in the payload falls back to the pinned address when the value is not good; no sources at all (an older server) draws nothing.
  function A_sourceUrl(key, srcs, field) { var present = !!srcs && Object.prototype.hasOwnProperty.call(srcs, field); return A_facebookUrl(present ? srcs[field] : null, key) || (present ? A_PINNED[key] : null); }
  // Facebook's own Page Plugin for the water page: built only from a validated page URL, width capped at 500.
  function A_fbPluginUrl(page, width) {
    var p = A_facebookUrl(page, 'water'); if (!p) return null;
    var w = Math.max(180, Math.min(500, Math.round(+width) || 340));
    return 'https://www.facebook.com/plugins/page.php?href=' + encodeURIComponent(p) + '&tabs=timeline&width=' + w + '&height=600&small_header=true&adapt_container_width=true&hide_cover=true&show_facepile=false';
  }
  function A_noticeFilters(view) {
    var f = [['all', 'All ' + view.counts.all], ['weather', 'Weather'], ['power', 'Power'], ['water', 'Water']];
    if (view.mgr) f.push(['house', 'House']);
    return f;
  }
  // What the calendar draws on a day for notices: the notices dated that day plus the day's own brownout / deep-clean flags, one glyph per kind.
  function A_dayMarks(iso, view, flags) {
    var seen = {}, out = [];
    var add = function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } };
    ((view && view.list) || []).forEach(function (n) { if (n.date === iso && n.key !== 'rain-watch') add(n.type); });
    (flags || []).forEach(function (f) { if (f.date === iso || f.date == null) add(f.kind === 'brownout' ? 'power' : f.kind === 'deep_clean' ? 'deep_clean' : f.kind === 'maintenance' ? 'blocked' : 'note'); });
    return out.slice(0, 3);
  }
  function A_noticeDay(view, iso) { return ((view && view.list) || []).filter(function (n) { return n.date === iso && n.key !== 'rain-watch'; }); }
  // A ready-to-send, calm sentence for the guest (owner and admin only; it is copied, never sent by the app).
  function A_guestMessage(n) {
    var title = String((n && n.title) || 'a change');
    if (/\[hidden\]/i.test(title + ' ' + String((n && n.detail) || ''))) return null; // the server hid something in that text: check it before it reaches a guest
    var hasTime = /\d{1,2}(:\d{2})? ?(am|pm)\b/i.test(title), when = n && n.date ? ' on ' + dayShort(n.date) + (n.start && !hasTime ? ' ' + A_timeRange(n.start, n.end) : '') : '';
    return 'Hello, a quick note about your stay: ' + title + when + '. We will keep the house comfortable and tell you if anything changes.';
  }
  // a flag the notice of the same kind already says (an automatic brownout flag and the power notice) is said once
  function A_flagDup(flag, notices) { var t = flag.kind === 'brownout' ? 'power' : flag.kind === 'deep_clean' ? 'deep_clean' : ''; return !!t && (notices || []).some(function (n) { return n.type === t; }); }
  // ops_notice_add_v1: argument names are exactly p_type, p_title, p_date, p_start_time, p_duration_hours, p_detail, p_property_id.
  // The server is the real gate (it refuses phones, e-mails, amounts and a brownout); this only catches the empty and the oversize.
  function A_noticeAddProblem(f) {
    if (['water', 'maintenance', 'deep_clean', 'note'].indexOf(f.type) < 0) return 'Choose what kind of notice this is.';
    if (!String(f.title || '').trim()) return 'Add a short title.';
    if (String(f.title).trim().length > 80) return 'Keep the title to 80 characters.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''))) return 'Pick the date.';
    if (String(f.detail || '').length > 200) return 'Keep the detail to 200 characters.';
    var h = String(f.hours || '').trim(); if (h && !(+h > 0 && +h <= 72)) return 'Hours must be between 1 and 72.';
    return null;
  }
  function A_noticeAddArgs(propertyId, f) {
    var h = String(f.hours || '').trim();
    return { p_property_id: propertyId, p_type: f.type, p_title: String(f.title).trim(), p_date: f.date, p_start_time: f.start || null, p_duration_hours: h ? +h : null, p_detail: String(f.detail || '').trim() || null };
  }
  // the server's refusal, said plainly (its own words when short and clean, else a calm default)
  var A_NOTICE_HINT = 'Put the date in the date field. No phone numbers, e-mails or amounts in the text.';
  var A_REFUSALS = [['type_not_allowed', 'Choose water, maintenance, deep cleaning or note.'], ['title_length', 'Keep the title between 1 and 80 characters.'], ['detail_length', 'Keep the detail to 200 characters.'],
    ['contact_or_amount_not_allowed', A_NOTICE_HINT], ['date_out_of_range', 'Pick a date that is not too far from today.'], ['duration_out_of_range', 'Hours must be between 1 and 72.']];
  // The server's refusal said plainly. Only a refusal (22023 / P0001) is echoed; a known code becomes a plain sentence; anything else is a connection problem.
  function A_noticeAddError(e) {
    var code = e && e.code, msg = String((e && e.message) || '');
    if (code === '42501') return 'Only an owner or admin can add a notice.';
    if (code !== '22023' && code !== 'P0001') return 'No connection. Try again.';
    for (var i = 0; i < A_REFUSALS.length; i++) if (msg.indexOf(A_REFUSALS[i][0]) >= 0) return A_REFUSALS[i][1];
    return msg && msg.length <= 160 && !/[{}<>]|pgrst|sqlstate/i.test(msg) ? msg : 'The notice was not accepted. ' + A_NOTICE_HINT;
  }
  function A_plainRefusal(msg) { return A_noticeAddError({ code: '22023', message: msg }); }
  var A_CAL_TABS = ['calendar', 'notices']; // s82 H: Month and Stays are one screen; the segmented control is tap only (no swipe), these two are its tap twin and the arrow keys
  function A_calTab(part) { return part === 'notices' ? 'notices' : 'calendar'; }
  var A_SHADES = [1, 2, 3, 4, 6]; // tokens.css has --v5-g1..g4 and g6; g5 does not exist
  function A_stayShade(i) { var n = A_SHADES[((i % A_SHADES.length) + A_SHADES.length) % A_SHADES.length]; return '--A_g:var(--v5-g' + n + ');--A_gfg:var(--v5-g' + n + '-fg)'; }

  // ---- admin hub: every dashboard route, in the same groups as the admin home. Route strings are the real ones in the dashboard's routes.tsx. ----
  var A_ROLE_ACTIONS = { owner: ['manage_staff', 'read_finance', 'read_operations', 'manage_operations', 'manage_inventory', 'publish_rate_policy'], admin: ['manage_staff', 'read_finance', 'read_operations', 'manage_operations', 'manage_inventory', 'publish_rate_policy'],
    finance: ['read_finance', 'read_operations'] };
  // 6th field 'native' = the Staff app has this screen itself, for every role that sees the item: the hub hides it, the route stays valid for links (A_hubLink) and A_hubNative points at the screen.
  var A_HUB = [
    { title: 'Guests and bookings', sub: 'Reservations, guests and their messages', items: [['bookings', 'Bookings', 'Reservations and payments', 'clip', 'read_operations'], ['bookings/inquiries', 'Inquiries', 'Guests who asked and have not booked', 'chat', 'read_operations'],
      ['guests', 'Guests', 'Guest records', 'users', 'manage_operations'], ['guests/conversations', 'Conversations', 'Messages from guests', 'chat', 'manage_operations'], ['search', 'Search', 'Find a guest, booking or task', 'search', 'read_operations'],
      ['today', 'Today', 'The dashboard home', 'dash', 'read_operations', 'native'], ['bookings/calendar', 'Booking calendar', 'Every stay on one grid', 'calendar', 'read_operations', 'native']] },
    { title: 'Money', sub: 'Books, statements and prices', items: [['finance', 'Finance', 'What needs a decision', 'wallet', 'read_finance'], ['finance/transactions', 'Transactions', 'Money in and out', 'cash', 'read_finance'], ['finance/journals', 'Journals', 'Entries', 'book', 'read_finance'],
      ['finance/statements', 'Statements', 'Reports', 'clip', 'read_finance'], ['finance/reconciliation', 'Reconciliation', 'Match the bank', 'checks', 'read_finance'], ['finance/book', 'Account book', 'Every account', 'book', 'read_finance'],
      ['finance/setup', 'Accounting setup', 'Accounts and rules', 'wrench', 'read_finance'], ['pricing', 'Pricing', 'The rate card', 'cash', 'publish_rate_policy'], ['pricing/advisor', 'Price advisor', 'Suggestions only, never changes a price', 'sparkles', 'read_finance'], ['insights', 'Insights', 'How the house is doing', 'star', 'read_finance']] },
    { title: 'Stock and house', sub: 'Counts, purchases, cleaning and repairs', items: [['inventory/counts', 'Stock counts', 'Count the shelves', 'tasks', 'manage_inventory'], ['inventory/purchases', 'Purchases', 'What was bought', 'bag', 'read_operations'],
      ['operations', 'Cleaning', 'Turnovers and inspections', 'sparkles', 'read_operations'], ['operations/work-orders', 'Work orders', 'Repairs', 'wrench', 'read_operations'],
      ['inventory', 'Inventory', 'Stock levels and usage', 'box', 'read_operations', 'native'], ['operations/tasks', 'Tasks', 'Everything that needs a person', 'tasks', 'read_operations', 'native'], ['operations/notices', 'Notices', 'Brownouts, water and house notes', 'bell', 'read_operations', 'native']] },
    { title: 'Team and system', sub: 'Access, health and records', items: [['settings', 'Staff', 'Team and access', 'users', 'manage_staff'], ['settings/health', 'System health', 'Checks and findings', 'checks', 'read_operations'],
      ['settings/audit', 'Audit log', 'Who changed what', 'book', 'manage_staff'], ['settings/guest-contact', 'Guest contact', 'Who may see phones', 'lock', 'manage_staff'], ['settings/pay-rates', 'Pay rates', 'What a clean pays', 'cash', 'manage_staff', 'native']] }
  ];
  function A_hubRoutes() { var r = []; A_HUB.forEach(function (g) { g.items.forEach(function (i) { r.push(i[0]); }); }); return r; }
  function A_hubGroups(role) {
    var acts = Object.prototype.hasOwnProperty.call(A_ROLE_ACTIONS, role) ? A_ROLE_ACTIONS[role] : [];
    return A_HUB.map(function (g) { return { title: g.title, sub: g.sub, items: g.items.filter(function (i) { return !i[5] && acts.indexOf(i[4]) >= 0; }).map(function (i) { return { route: i[0], title: i[1], sub: i[2], icon: i[3] }; }) }; })
      .filter(function (g) { return g.items.length; });
  }
  // "Already in this app": the Staff screens that replaced hub pages. Each row shows only for a role that could see the page it replaced (Pay rates: owner and admin).
  function A_hubNative(role) {
    var acts = Object.prototype.hasOwnProperty.call(A_ROLE_ACTIONS, role) ? A_ROLE_ACTIONS[role] : [];
    return [['home', 'Today', 'The day at a glance', 'house', '#home', 'read_operations'], ['calendar', 'Calendar', 'Stays, the booking calendar and notices', 'calendar', '#calendar', 'read_operations'], ['tasks', 'Tasks', 'Everything that needs a person', 'tasks', '#tasks', 'read_operations'],
      ['stock', 'Inventory', 'Stock levels and usage', 'box', '#stock', 'read_operations'], ['payrates', 'Pay rates', 'What a clean pays', 'cash', '#payrates', 'manage_staff']]
      .filter(function (n) { return acts.indexOf(n[5]) >= 0; }).map(function (n) { return { key: n[0], title: n[1], sub: n[2], icon: n[3], href: n[4] }; });
  }
  function A_hubRouteOk(route) { return typeof route === 'string' && A_hubRoutes().indexOf(route) >= 0; }
  // base 'https://x/#/today' or './admin/#/today' + 'bookings/calendar' -> '.../#/bookings/calendar'; null for a route that is not in the list.
  function A_hubDoorUrl(base, route) { return A_hubRouteOk(route) ? String(base || '').replace(/#.*$/, '') + '#/' + route : null; }

  // ---- what's new: only what this person can use ----
  function A_whatsNew(role, flags) {
    flags = flags || {};
    var admin = layoutForRole(role) === 'admin', mgr = canSeeGuestContact(role), items = [
      ['Undo works every time', 'After you mark a task done, Undo brings it back, even on a slow connection.'],
      ['Earlier months', 'The calendar goes back a year. ' + (mgr ? 'Days before last week are dashed: older stays are in the admin dashboard.' : 'Days before last week are dashed: older stays are not shown here.')],
      ['Cassy reply shows its progress', 'While a reply is written you see the step, the usual time and a Cancel button.'],
      ['Better on a tablet', 'More now lays out in two even columns with a label on every group.'],
      ['Swipes that work', 'Swipe the month grid for the next month, a task left to mark it done, and pull a sheet down by its title bar to close it. Every swipe has a button too.'],
      ['One calendar', 'Month and Stays are one screen: the month, then the next 14 days. Notices is the other tab.'],
      ['Search', 'In More, find a task or a page of the manual.'], ['A short tour', 'In More, “Show the tour” plays three short cards.'],
      ['Plain bars', 'In More, switch glass off for a calmer, easier-to-read screen. It turns on by itself on slower phones.']];
    if (flags.notices) items.push(['Notices', 'Rain watch, brownouts and water interruptions show on Today and on the calendar. Tap the weather for the forecast.']);
    items.push(['Cassy reply', 'Draft a warm reply to a guest message. You get two or three drafts to pick from.']);
    items.push(['Common links', 'The Cassy reply screen lists the Welcome guide and the Direct booking site with a Copy button each.']);
    items.push(['Install on iPhone', 'Opened inside Messenger or Facebook, the app now shows Open in Safari. The Home Screen steps match the latest iPhone Safari.']);
    if (admin) items.push(['Manage, all in one place', 'Scan a receipt to fill in an expense, approve or void rows waiting for review, and see bookings and work orders without opening the dashboard.']);
    if (admin) items.push(['Clearer KPIs', 'Four headline numbers with a 12-month trend, last year beside each month, and the nights already booked ahead.']);
    items.push(['Cleaning fee', 'Ask for payment for your cleans and expenses. When you finish a clean, a card on Today takes you there.']);
    if (mgr) items.push(['Add a notice from Today', 'The Notices card has an Add a notice button. Water and Power are the first two choices.']);
    items.push(['Alerts turn on by themselves', 'Alerts now turn on by themselves when this phone allows them. If they are blocked, Today shows how to allow them.']);
    items.push(['Inventory at a glance', 'Each item says what it needs: a count, or a place on the shopping list. One tap records use or a count.']);
    items.push(['Suppliers and photos', 'Suppliers, price history and item photos are in Inventory.']);
    items.push(['Staff and admin sign-in links', 'Staff now have their own install link that lists only staff names at sign-in. The admin link still lists everyone.']);
    items.push(['Fewer kitchen photos', 'The kitchen photo card now asks for two photos, and Today shows no button on a day without a turnover.']);
    items.push(['A calmer look', 'Solid cards, one clear accent colour and an easier-to-read font. Today, Notices and Pay staff are easier to scan.']);
    if (admin) items.push(['Admin hub', 'More lists the dashboard pages the app does not have itself, in short groups.']);
    if (mgr) items.push(['Arrival checks', 'Each arriving guest shows whether the ID, the balance and the door code are in place.']);
    if (flags.notices && mgr) items.push(['Tell the guest', 'On a notice, copy a ready message to send to the guest yourself.']);
    return items.map(function (i) { return { title: i[0], text: i[1] }; });
  }

  // ================================================================ E_ streamline pass (s81, lane E) ================================================
  // ---- the one notification pill: what needs a person, counted once ----
  // Groups in priority order. n counts rows in the first six; notices are shown in the sheet but never counted (the Notices card carries them).
  var E_SECTIONS = [['risk', 'Turnover at risk'], ['overdue', 'Overdue'], ['due', 'Due today'], ['clash', 'Clash days'], ['confirm', 'To confirm'], ['pay', 'Pay staff'], ['review', 'To review'], ['inbox', 'Inbox'], ['warn', 'Warnings'], ['find', 'Findings'], ['stock', 'Low stock'], ['notice', 'Notices today and tomorrow']];
  var E_MAX_ROWS = 3;
  // "Brownout Fri 16 Oct, 1:00 to 4:00 pm": the one time format used everywhere (not the 24-hour "13:00, 3 h" of the Stays list)
  function E_brownTitle(w, b) {
    var d = w.detail || {}, m = /^(\d{1,2}):(\d{2})/.exec(String(d.time || '')), h = +d.hours, head = 'Brownout' + (d.date ? ' ' + dayShort(d.date) : '');
    if (!m) return b.head;
    var s = +m[1] * 60 + +m[2], e = h > 0 ? s + Math.round(h * 60) : null;
    var from = fmtTime(pad(+m[1]) + ':' + m[2]), to = e != null && e < 1440 ? fmtTime(pad(Math.floor(e / 60)) + ':' + pad(e % 60)) : '';
    if (!to) return head + ', ' + from;
    var sa = from.slice(-2), sb = to.slice(-2); return head + ', ' + (sa === sb ? from.slice(0, -3) : from) + ' to ' + to; // "1:00 to 4:00 pm", "10:00 am to 1:00 pm"
  }
  function E_warnKey(w) { return w.kind + '|' + (w.title || '') + '|' + ((w.detail && w.detail.date) || ''); }
  function E_dueSub(t, today) { var l = t.due_at ? taskDueLabel(t.due_at, today) : ''; return l; }
  // i = { role, today, error, lastAt, ready:{payload,tasks,bookings,notices}, tasks:[open or all tasks], clashDays:[iso], bookings:n, inbox:n|null, warnings:[], notices:[A_noticesView list] }
  // -> { phase: 'loading'|'clear'|'items'|'offline', n, top, topWord, tone, sections:[{key,label,rows,shown,more}], pill:{text,short,dot,glyph,aria}, empty }
  function E_attention(i) {
    i = i || {}; var role = i.role, today = i.today || manilaToday(), rd = i.ready || {};
    var money = layoutForRole(role) === 'admin', mgr = canSeeGuestContact(role), canBk = canSeeBookingsToConfirm(role);
    var by = { risk: [], overdue: [], due: [], clash: [], confirm: [], pay: [], review: [], inbox: [], warn: [], find: [], stock: [], notice: [] }, taken = {};
    (Array.isArray(i.tasks) ? i.tasks : []).forEach(function (t) {
      if (!t || t.status === 'done') return;
      var key = t.source + ':' + t.id, due = taskDue(t.due_at, today);
      if (t.blocks_arrival) { taken[key] = 1; by.risk.push({ group: 'risk', id: key, glyph: 'alert', title: t.title, sub: 'Blocks the next arrival' + (E_dueSub(t, today) ? ' · ' + E_dueSub(t, today) : ''), go: { kind: 'tasks', filter: 'blocks' } }); }
    });
    (Array.isArray(i.tasks) ? i.tasks : []).forEach(function (t) {
      if (!t || t.status === 'done' || taken[t.source + ':' + t.id] || taskDue(t.due_at, today) !== 'overdue') return;
      by.overdue.push({ group: 'overdue', id: t.source + ':' + t.id, glyph: 'alert', title: t.title, sub: E_dueSub(t, today), go: { kind: 'tasks', filter: 'due' } });
    });
    // due today is counted too, so the pill and the Tasks tab badge (overdue + due today) always agree
    (Array.isArray(i.tasks) ? i.tasks : []).forEach(function (t) {
      if (!t || t.status === 'done' || taken[t.source + ':' + t.id] || taskDue(t.due_at, today) !== 'today') return;
      by.due.push({ group: 'due', id: t.source + ':' + t.id, glyph: 'clock', title: t.title, sub: E_dueSub(t, today) || 'Due today', go: { kind: 'tasks', filter: 'due' } });
    });
    if (money && Array.isArray(i.clashes)) { // s91: one row per overlapping pair of bookings, from the app: { key, a, b, from, to (last night), nights, first (first clash night) }
      i.clashes.forEach(function (c) {
        if (!c || !c.key || typeof c.first !== 'string' || c.first < today || c.first > addDays(today, 59)) return;
        by.clash.push({ group: 'clash', id: c.key, glyph: 'alert', title: 'Clash: ' + c.a + ' and ' + c.b + ' overlap', sub: A_rangeLabel(c.from, c.to) + ' · ' + plural(c.nights, 'night') + ' · one booking needs to move', go: { kind: 'day', date: c.first }, when: c.first, near: c.first <= addDays(today, 3) });
      });
    } else if (money) {
      var seen = {}; (Array.isArray(i.clashDays) ? i.clashDays : []).slice().sort().forEach(function (d) {
        if (typeof d !== 'string' || d < today || d > addDays(today, 59) || seen[d]) return; seen[d] = 1;
        by.clash.push({ group: 'clash', id: d, glyph: 'alert', title: 'Two guests on ' + dayShort(d), sub: 'One booking needs to move', go: { kind: 'day', date: d }, when: d, near: d <= addDays(today, 3) });
      });
    }
    var bn = canBk ? bookingsToConfirmCount(i.bookings) : 0;
    if (bn > 0) by.confirm.push({ group: 'confirm', id: 'confirm', glyph: 'clip', n: bn, title: plural(bn, 'booking') + ' to confirm', sub: typeof i.oldest === 'string' && /^\d{4}-\d{2}-\d{2}/.test(i.oldest) ? 'Oldest waiting since ' + dayLabel(i.oldest.slice(0, 10)) : 'Open the pending bookings', go: { kind: 'bookings' } });
    // s91: pay requests waiting and transactions waiting for review (owner, admin, finance); each is one row with its count
    var pn = money && typeof i.pay === 'number' && i.pay > 0 ? Math.floor(i.pay) : 0, rn = money && typeof i.review === 'number' && i.review > 0 ? Math.floor(i.review) : 0;
    if (pn > 0) by.pay.push({ group: 'pay', id: 'pay', glyph: 'wallet', n: pn, title: plural(pn, 'pay request') + ' waiting', sub: 'Pay by QR, then add the proof', go: { kind: 'pay' } });
    if (rn > 0) by.review.push({ group: 'review', id: 'review', glyph: 'cash', n: rn, title: plural(rn, 'transaction') + ' to review', sub: 'Check each one, then approve', go: { kind: 'review' } });
    var inn = mgr && typeof i.inbox === 'number' && i.inbox > 0 ? Math.floor(i.inbox) : 0;
    if (inn > 0) by.inbox.push({ group: 'inbox', id: 'inbox', glyph: 'chat', n: inn, title: inn === 1 ? '1 open message' : inn + ' open messages', sub: 'Guests waiting for a reply', go: { kind: 'inbox' } });
    var brown = {};
    orderWarnings((Array.isArray(i.warnings) ? i.warnings : []).filter(function (w) { return w && w.kind && (w.kind !== 'verifier' || mgr); })).forEach(function (w) {
      if (w.kind === 'brownout') {
        var b = brownoutText(w), d = w.detail && w.detail.date; if (d) brown[d] = 1;
        if (i.info) return; // s91: on the Needs action board a brownout is information (Heads-up), not an action
        by.warn.push({ group: 'warn', id: E_warnKey(w), glyph: 'alert', word: 'Brownout' + (d ? ' ' + dayShort(d).split(' ')[0] : ''), title: E_brownTitle(w, b), sub: b.rest, go: { kind: 'notices' } });
      } else if (w.kind === 'inventory') {
        var l = lowStockText(w); by.warn.push({ group: 'warn', id: E_warnKey(w), glyph: 'alert', word: 'Low stock', title: 'Low stock · ' + l.rest, sub: 'Inventory', go: { kind: 'inventory' }, stock: lowStockParts(w) });
      } else by.warn.push({ group: 'warn', id: E_warnKey(w), glyph: 'info', word: 'System check', title: 'System check · ' + (w.title || ''), sub: 'Needs a person to look', go: { kind: 'warn', key: E_warnKey(w) } });
    });
    // s91: house items from notices_v1. The same finding or low-stock item can arrive as a payload warning too; a warning that already says it wins, so nothing is counted twice.
    var allW = Array.isArray(i.warnings) ? i.warnings : [], hasInv = allW.some(function (w) { return w && w.kind === 'inventory'; }), wvKeys = {};
    allW.forEach(function (w) { if (w && w.kind === 'verifier') { var k = findingKey(w, i.tasks); if (k) wvKeys[k] = 1; wvKeys['t:' + w.title] = 1; } });
    (mgr && Array.isArray(i.house) ? i.house : []).forEach(function (h) {
      if (!h || !h.title) return;
      if (h.kind === 'finding') { if (wvKeys[h.id] || wvKeys['t:' + h.title]) return; by.find.push({ group: 'find', id: h.id, glyph: 'alert', word: 'Finding', title: h.title, sub: h.detail || 'Needs a person to look', go: { kind: 'finding', key: h.id } }); }
      else if (h.kind === 'low_stock') { if (hasInv) return; by.stock.push({ group: 'stock', id: h.key || h.id, glyph: 'box', word: 'Low stock', title: h.title, sub: h.detail || 'Inventory', go: { kind: 'inventory' }, stock: { name: String(h.title).replace(/^Low stock:\s*/i, ''), text: h.detail ? String(h.detail) : '' } }); }
    });
    var tomorrow = addDays(today, 1);
    (Array.isArray(i.notices) ? i.notices : []).forEach(function (n) {
      if (!n || !n.date || (n.date !== today && n.date !== tomorrow)) return;
      if (n.type === 'power' && brown[n.date]) return; // the brownout warning already says it
      by.notice.push({ group: 'notice', id: n.key, glyph: (A_NOTICE_TYPES[n.type] || A_NOTICE_TYPES.note).icon, title: n.title, sub: n.sub || '', go: { kind: 'notices' } });
    });
    var counted = ['risk', 'overdue', 'due', 'clash', 'confirm', 'pay', 'review', 'inbox', 'warn', 'find', 'stock'], n = 0, first = null;
    counted.forEach(function (k) { n += by[k].length; if (!first && by[k].length) first = k; });
    var top = '', word = '', tone = 'ok';
    if (first) {
      var rs = by[first], c = rs.length;
      top = first === 'risk' ? 'Turnover at risk' : first === 'overdue' ? c + ' overdue' : first === 'due' ? c + ' due today' : first === 'clash' ? (c === 1 ? 'Clash day' : c + ' clash days') : first === 'confirm' ? rs[0].n + ' to confirm' : first === 'inbox' ? rs[0].n + ' in inbox' : rs[0].word;
      word = first === 'risk' ? (c === 1 ? '1 blocks arrival' : c + ' block arrival') : first === 'overdue' ? 'Overdue' : first === 'due' ? 'Due today' : first === 'due' ? 'Due today' : first === 'clash' ? (c === 1 ? 'Clash day' : 'Clash days') : first === 'confirm' ? 'To confirm' : first === 'inbox' ? 'In inbox' : rs[0].word;
      if (first === 'pay' || first === 'review') { word = first === 'pay' ? 'To pay' : 'To review'; top = rs[0].title; } else if (first === 'find' || first === 'stock') { word = first === 'find' ? 'Finding' : 'Low stock'; top = rs[0].title; }
      tone = first === 'risk' || first === 'overdue' || first === 'clash' ? 'danger' : 'warn';
    }
    var sections = E_SECTIONS.filter(function (s) { return by[s[0]].length; }).map(function (s) {
      var rows = by[s[0]]; return { key: s[0], label: s[1], rows: rows, shown: rows.slice(0, E_MAX_ROWS), more: rows.length > E_MAX_ROWS ? rows.length : 0 };
    });
    // a source this role depends on that failed (a missing feature is not a failure) means the pill cannot say All clear
    var fl = i.failed || {}, failed = !!fl.tasks || (money && (!!fl.notices || (canBk && !!fl.bookings)));
    var ready = !!rd.payload && !!rd.tasks && (!money || ((!canBk || !!rd.bookings) && !!rd.notices)), offlineKind = !i.errorKind || i.errorKind === 'network';
    var phase = i.error ? (offlineKind ? 'offline' : 'stale') : !ready ? 'loading' : failed && !n ? 'stale' : n ? 'items' : 'clear';
    var shown = n > 99 ? '99+' : String(n), pill;
    if (phase === 'loading') pill = { text: 'Loading', short: 'Loading', dot: 'idle', glyph: 'refresh', aria: 'Loading what needs attention' };
    else if (phase === 'offline') pill = { text: 'No connection', short: 'No connection', dot: 'idle', glyph: 'info', aria: 'No connection.' + (i.lastAt ? ' Showing the last update from ' + clockLabel(i.lastAt) + '.' : '') + ' Opens the list' };
    else if (phase === 'stale') pill = { text: 'Could not update', short: 'Could not update', dot: 'idle', glyph: 'info', aria: 'Could not update.' + (i.lastAt ? ' Showing the last update from ' + clockLabel(i.lastAt) + '.' : '') + ' Opens the list' };
    else if (phase === 'clear') pill = { text: 'All clear', short: 'All clear', dot: 'ok', glyph: 'check', aria: 'All clear. Nothing needs attention. Opens the list' };
    else pill = { text: (first === 'risk' && n === by.risk.length + by.overdue.length + by.due.length ? shown + (n === 1 ? ' task' : ' tasks') : shown) + ' · ' + word, short: shown + ' to look at', dot: tone === 'danger' ? 'bad' : 'warn', glyph: tone === 'danger' ? 'alert' : 'clock',
      aria: n === 1 ? '1 thing to look at: ' + top.toLowerCase() + '. Opens the list' : shown + ' things to look at. Most urgent: ' + top.toLowerCase() + '. Opens the list' };
    var empty = !sections.length;
    return { partial: failed && n > 0, phase: phase, n: n, top: top, topWord: word, tone: tone, sections: sections, pill: pill, empty: empty, say: phase === 'items' ? shown + (n === 1 ? ' thing' : ' things') + ' to look at' : phase === 'clear' ? 'All clear' : phase === 'offline' ? 'No connection' : phase === 'stale' ? 'Could not update' : '' };
  }

  // ================================================================ s91: the "Needs action" board on Home (owner, admin, finance) ================================================
  // Built from the same CS.E_attention result as the pill, so the two always agree: board.n === att.n (every row carries a weight = the items it stands for).
  // Tiers, most urgent first: 1 red (blocks the next arrival, overdue, a clash within 3 days), 2 a guest is waiting (inbox, then bookings to confirm),
  // 3 due today and later clashes, 4 information (pay, system checks, low stock, review). Soonest first inside a tier. Two or more system checks, or low-stock items, fold into one row.
  // At most 5 rows: with more, the first 4 and one "See all N" row that opens the attention sheet.
  function A_spanShort(a, b) { // '13:00','16:00' -> '1-4 pm'; '10:00','14:30' -> '10 am-2:30 pm'
    var x = /^(\d{1,2}):(\d{2})/.exec(String(a || '')), y = /^(\d{1,2}):(\d{2})/.exec(String(b || '')); if (!x) return '';
    function one(m, mer) { var h = +m[1] % 12 || 12; return h + (+m[2] ? ':' + m[2] : '') + (mer ? ' ' + (+m[1] >= 12 ? 'pm' : 'am') : ''); }
    if (!y) return one(x, true);
    return (+x[1] >= 12) === (+y[1] >= 12) ? one(x, false) + '-' + one(y, true) : one(x, true) + '-' + one(y, true);
  }
  function B_cap(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }
  function B_stockTitle(r) {
    var s = r.stock || {};
    if (s.qty != null) return B_cap(s.name) + ': ' + s.qty + (s.unit ? ' ' + s.unit : '') + ' left' + (s.below != null ? ' (reorder at ' + s.below + ')' : '');
    return B_cap(s.name || r.title) + (s.text ? ': ' + s.text : '');
  }
  function A_board(att) {
    var cand = [], finds = [], stocks = [], ix = 0; att = att || {};
    function add(o) { o.i = ix++; o.count = o.count || 0; cand.push(o); }
    (att.sections || []).forEach(function (s) {
      var r = s.rows || [], k = s.key; if (k === 'notice' || !r.length) return;
      r.forEach(function (x) {
        if (k === 'find' || (k === 'warn' && x.go && x.go.kind === 'warn')) finds.push(x);
        else if (k === 'stock' || (k === 'warn' && x.go && x.go.kind === 'inventory')) stocks.push(x);
      });
      if (k === 'risk') r.forEach(function (x) { add({ key: 'risk:' + x.id, group: 'risk', tier: 1, tone: 'bad', glyph: 'alert', title: 'At risk: ' + x.title, sub: x.sub || '', weight: 1, go: x.go }); });
      else if (k === 'overdue' || k === 'due') add({ key: k, group: k, tier: k === 'overdue' ? 1 : 3, tone: k === 'overdue' ? 'bad' : 'warn', glyph: k === 'overdue' ? 'alert' : 'clock', title: (k === 'overdue' ? 'Overdue: ' : 'Due today: ') + plural(r.length, 'task'),
        sub: r[0].title + (r.length > 1 ? ' and ' + (r.length - 1) + ' more' : ''), weight: r.length, go: { kind: 'tasks', filter: 'due' } });
      else if (k === 'clash') r.forEach(function (x) { add({ key: 'clash:' + x.id, group: 'clash', tier: x.near ? 1 : 3, tone: x.near ? 'bad' : 'warn', glyph: 'alert', title: x.title, sub: x.sub || '', when: x.when, weight: 1, go: x.go }); });
      else if (k === 'inbox') add({ key: 'inbox', group: 'inbox', tier: 2, tone: 'warn', glyph: 'chat', title: r[0].title, sub: r[0].sub, count: r[0].n, weight: 1, go: r[0].go });
      else if (k === 'confirm') add({ key: 'confirm', group: 'confirm', tier: 2.5, tone: 'warn', glyph: 'clip', title: r[0].title, sub: r[0].sub, count: r[0].n, weight: 1, go: r[0].go });
      else if (k === 'pay' || k === 'review') add({ key: k, group: k, tier: 4, tone: 'info', glyph: r[0].glyph, title: r[0].title, sub: r[0].sub, count: r[0].n, weight: 1, go: r[0].go });
      else if (k === 'warn') r.forEach(function (x) { if (!x.go || (x.go.kind !== 'warn' && x.go.kind !== 'inventory')) add({ key: 'warn:' + x.id, group: 'warn', tier: 3, tone: 'warn', glyph: x.glyph, title: x.title, sub: x.sub || '', weight: 1, go: x.go }); });
    });
    if (finds.length === 1) { var f = finds[0]; add({ key: f.group + ':' + f.id, group: f.group, tier: 4, tone: 'info', glyph: 'alert', title: String(f.title).replace(/^System check · /, ''), sub: 'Found by the nightly check', weight: 1, go: f.go, single: true }); }
    else if (finds.length) add({ key: 'find:all', group: 'find', tier: 4, tone: 'info', glyph: 'alert', title: finds.length + ' system checks', sub: 'Found by the nightly check', count: finds.length, weight: finds.length, go: { kind: 'finding', key: null } });
    if (stocks.length === 1) add({ key: stocks[0].group + ':' + stocks[0].id, group: 'stock', tier: 4, tone: 'info', glyph: 'box', title: B_stockTitle(stocks[0]), sub: 'Inventory', weight: 1, go: { kind: 'inventory' } });
    else if (stocks.length) add({ key: 'stock:all', group: 'stock', tier: 4, tone: 'info', glyph: 'box', title: stocks.length + ' items low', sub: stocks.slice(0, 2).map(function (x) { return (x.stock && x.stock.name) || x.title; }).map(B_cap).join(', ') + (stocks.length > 2 ? ' and ' + (stocks.length - 2) + ' more' : ''), count: stocks.length, weight: stocks.length, go: { kind: 'inventory' } });
    cand.sort(function (a, b) { return a.tier - b.tier || String(a.when || '~').localeCompare(String(b.when || '~')) || a.i - b.i; });
    var n = cand.reduce(function (a, r) { return a + r.weight; }, 0), rows = cand;
    if (cand.length > 5) {
      var rest = cand.slice(4), w = rest.reduce(function (a, r) { return a + r.weight; }, 0);
      rows = cand.slice(0, 4).concat([{ key: 'more', group: 'more', tier: 9, tone: 'info', glyph: 'tasks', title: 'See all ' + n, sub: w + ' more to look at', count: 0, weight: w, go: { kind: 'all' }, more: true }]);
    }
    return { n: n, rows: rows, top: rows.some(function (r) { return r.tier < 3; }) };
  }
  // The informational group: notices_v1 notices still in the future (a brownout or a water cut is information, not an action). gone = notice keys just closed.
  // Only a notice that has an id and was added by hand (manual or staff) can be closed, and only by an owner or admin.
  function A_heads(view, role, o) {
    o = o || {}; var gone = o.gone || {}, mgr = role === 'owner' || role === 'admin';
    return (view && Array.isArray(view.list) ? view.list : []).filter(function (n) { return !gone[n.key]; }).map(function (n) {
      return { key: n.key, id: n.id || '', type: n.type, title: n.title, sub: [n.date && n.date !== o.today ? dayShort(n.date) : '', A_spanShort(n.start, n.end), n.detail || n.source].filter(Boolean).join(' · '), detail: n.detail || '', date: n.date || null, url: n.url || null,
        closable: mgr && !!n.id && (n.raw === 'manual' || n.raw === 'staff') };
    });
  }

  // ================================================================ H_ shell pass (s82, lane H) ================================================
  // A notice link is only ever an https address with no credentials; anything else is dropped (the notice then links to its source page as before).
  function H_noticeUrl(u) {
    if (typeof u !== 'string' || u.length > 500) return null;
    try { var x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && x.hostname.indexOf('.') > 0 ? x.href : null; } catch (e) { return null; }
  }
  // F11: the row title is the kind and the day, the sub-line the time and the place, so a title stays on one line at 320 px.
  var H_HEADS = { power: 'Brownout', water: 'Water off' };
  function H_noticeHead(n) {
    var time = n && n.date && H_HEADS[n.type] ? A_timeRange(n.start, n.end) : '';
    if (!time) return { title: n ? String(n.title || '') : '', sub: n ? String(n.sub || '') : '' };
    return { title: H_HEADS[n.type] + ' · ' + dayShort(n.date), sub: [time, n.source].filter(Boolean).join(' · ') };
  }
  // F13: on a very small phone the weather line is "29° cloudy".
  function H_weatherShort(temp, desc, narrow) {
    var d = String(desc || '').toLowerCase().trim();
    if (narrow && d.indexOf(' ') > 0) d = d.split(/\s+/).pop();
    return Math.round(+temp) + '° ' + d;
  }
  // The "Next 14 days" list: stays that arrive or leave in the window, by the day that matters. skip(st) drops the stays already drawn as full cards.
  function H_agenda(stays, today, span, skip) {
    var end = addDays(today, span || 14), out = [];
    (stays || []).forEach(function (st) {
      if (!st || st.checkout_date < today || (skip && skip(st))) return;
      var arrives = st.checkin_date > today && st.checkin_date <= end, leaves = st.checkout_date >= today && st.checkout_date <= end;
      if (!arrives && !leaves && st.checkin_date !== today) return;
      var kind = st.checkin_date >= today ? 'arrive' : 'house', day = kind === 'arrive' ? st.checkin_date : st.checkout_date;
      out.push({ st: st, kind: kind, day: day });
    });
    return out.sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : String(a.st.guest_name || '') < String(b.st.guest_name || '') ? -1 : 1; });
  }
  // MF2: three booleans per stay, owner and admin only, and only when the server sent the field. Anything else is "no row".
  function H_ready(raw, role) {
    if (!canSeeGuestContact(role) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    // each of the three is true, false or null; null is "not known yet" and draws nothing at all (never as missing)
    var r = {}; ['id', 'paid', 'door_code'].forEach(function (k) { r[k] = typeof raw[k] === 'boolean' ? raw[k] : null; });
    return r.id === null && r.paid === null && r.door_code === null ? null : r;
  }
  function H_readyChips(r) {
    if (!r) return [];
    var out = []; if (r.id !== null) out.push({ key: 'id', ok: r.id, word: r.id ? 'ID on file' : 'No ID yet' });
    if (r.paid !== null) out.push({ key: 'paid', ok: r.paid, word: r.paid ? 'Balance received' : 'Balance due' });
    if (r.door_code !== null) out.push({ key: 'door_code', ok: r.door_code, word: r.door_code ? 'Door code set' : 'No door code' });
    return out;
  }
  function H_readyOk(r) { return !!r && H_readyChips(r).every(function (c) { return c.ok; }); }
  function H_readyLine(r) { return H_readyChips(r).map(function (c, i) { return i ? c.word.charAt(0).toLowerCase() + c.word.slice(1) : c.word; }).join(' · '); }
  // 1:42 pm (Manila)
  function H_clock12(iso) { var d = new Date(iso); if (isNaN(d.getTime())) return ''; var p = manilaParts(d); return (p.h % 12 === 0 ? 12 : p.h % 12) + ':' + pad(p.min) + ' ' + (p.h >= 12 ? 'pm' : 'am'); }
  // cleaning_progress_v1 (owner and admin): null = the feature or the answer is absent, so the row is hidden.
  function H_progress(raw, role) {
    if (!canSeeGuestContact(role) || !raw || typeof raw !== 'object' || raw.ok === false) return null;
    var a = raw.active;
    if (!a || typeof a !== 'object') return { active: null };
    var step = Math.floor(+a.step), of = Math.floor(+a.of);
    if (!(step >= 0) || !(of > 0)) return { active: null };
    return { active: { step: Math.min(step, of), of: of, label: typeof a.label === 'string' ? a.label.slice(0, 40) : '', name: typeof a.cleaner_name === 'string' ? a.cleaner_name.split(/\s+/)[0] : '', at: a.updated_at || a.started_at || null } };
  }
  // The "Clean" check row of the admin Turnover card. Fifteen minutes into the window with no progress it turns amber.
  function H_cleanLine(prog, clock) {
    if (!prog) return null;
    if (prog.active && prog.active.step >= prog.active.of) return { tone: 'ok', text: 'Clean finished' + (prog.active.at ? ' ' + H_clock12(prog.active.at) : '') }; // the last step was ticked
    if (prog.active) { var a = prog.active; return { tone: 'ok', text: (a.name ? a.name + ' · ' : '') + 'step ' + a.step + ' of ' + a.of + (a.at ? ' · ' + clockLabel(a.at) : '') }; }
    var late = !!clock && clock.phase !== 'before' && (clock.phase === 'after' || clock.times.inMin - clock.minsToIn - clock.times.outMin >= 15);
    return { tone: late ? 'warn' : 'idle', text: 'Not started' };
  }
  function H_houseLine(view, today) {
    if (!view) return null;
    var n = (view.list || []).filter(function (x) { return x.date === today && (x.type === 'power' || x.type === 'water') && x.key !== 'rain-watch'; })[0];
    if (!n) return { tone: 'ok', text: 'Clear' };
    var t = A_timeRange(n.start, n.end);
    return { tone: 'warn', text: (n.type === 'power' ? 'Brownout' : 'Water off') + (t ? ' ' + t : '') };
  }
  // F16: what the staff Turnover card says under the three steps.
  function H_untilLine(clock, arrivesToday) {
    if (clock.phase === 'after') return 'Checked in';
    if (clock.phase === 'window') return arrivesToday ? Math.floor(clock.minsToIn / 60) + ' h ' + (clock.minsToIn % 60) + ' min until check-in' : 'Clean until ' + A_shortTime(clock.times.check_in);
    return 'Clean from ' + A_shortTime(clock.times.check_out);
  }
  // MF5 search. Staff: tasks and the manual. Owner and admin: guests too. A cleaner is never handed a guest, whatever the caller passes.
  function H_manualIndex(raw) {
    var list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw.entries || raw.headings || raw.items || []) : [];
    return (Array.isArray(list) ? list : []).map(function (e) {
      var t = e && (e.title || e.heading || e.h), id = e && (e.id || e.anchor);
      return typeof t === 'string' && t.trim() && typeof id === 'string' && /^[\w.-]{1,80}$/.test(id) ? { title: t.trim().slice(0, 100), id: id } : null;
    }).filter(Boolean).slice(0, 400);
  }
  function H_search(query, src, role) {
    var q = String(query == null ? '' : query).trim().toLowerCase(), out = { tasks: [], guests: [], manual: [] };
    if (q.length < 2) return out;
    var has = function (t) { return String(t || '').toLowerCase().indexOf(q) >= 0; };
    out.tasks = (src.tasks || []).filter(function (t) { return t && t.status !== 'done' && (has(t.title) || has(t.detail)); }).slice(0, 5);
    out.manual = (src.manual || []).filter(function (h) { return has(h.title); }).slice(0, 5);
    if (canSeeGuestContact(role)) out.guests = (src.stays || []).filter(function (st) { return st && has(st.guest_name); }).slice(0, 5);
    return out;
  }
  // 3.1.1: how far the calendar goes. Ahead: the 60 days the server sends. Back: a year, so earlier months can be looked at (the server sends only the last 7 days of stays; older ones are in the dashboard).
  var H_DATA_BACK = 7;
  function H_monthOk(y, m, today) {
    var first = y + '-' + pad(m) + '-01', last = addDays(m === 12 ? (y + 1) + '-01-01' : y + '-' + pad(m + 1) + '-01', -1);
    return last >= addDays(today, -366) && first <= addDays(today, 60);
  }
  function H_dataFrom(today) { return addDays(today, -H_DATA_BACK); }
  // The day before / after in the day sheet; null at the edge of the months the calendar offers.
  function H_dayStep(iso, dir, today) {
    var d = addDays(iso, dir), a = d.split('-');
    return H_monthOk(+a[0], +a[1], today) ? d : null;
  }
  // The wait for a Cassy reply: honest steps on a timer (seconds since the tap).
  function H_waitStep(sec) { return sec < 4 ? 'Reading the message' : sec < 12 ? 'Writing the reply' : 'Almost there'; }
  // Manual brownout and maintenance day flags of the next 14 days, as notices, so a hand-added one shows in the list it was added from. Automatic flags already have their notice.
  function H_withFlags(view, flags, today) {
    if (!view || !Array.isArray(flags) || !today) return view;
    var end = addDays(today, 14), have = {}; (view.list || []).forEach(function (n) { have[n.type + '|' + n.date] = 1; });
    var extra = flags.filter(function (f) { return f && f.source === 'manual' && f.id && (f.kind === 'brownout' || f.kind === 'maintenance') && /^\d{4}-\d{2}-\d{2}$/.test(String(f.date || '')) && f.date >= today && f.date <= end; }).map(function (f) {
      var type = f.kind === 'brownout' ? 'power' : 'blocked'; if (have[type + '|' + f.date]) return null;
      return { key: 'f:' + f.id, id: String(f.id), type: type, group: type === 'power' ? 'power' : 'other', title: String(f.label || flagName(f.kind)), date: f.date, start: null, end: null, sub: dayShort(f.date) + ' · Added by hand', detail: '', source: 'Added by hand', tell: false, url: null, fromFlag: true };
    }).filter(Boolean);
    if (!extra.length) return view;
    var out = {}; Object.keys(view).forEach(function (k) { out[k] = view[k]; });
    out.list = (view.list || []).concat(extra).sort(function (a, b) { return (a.key === 'rain-watch' ? 0 : 1) - (b.key === 'rain-watch' ? 0 : 1) || String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.start || '').localeCompare(String(b.start || '')); });
    out.all = out.list.concat(view.house || []);
    out.counts = Object.assign({}, view.counts, { all: view.counts.all + extra.length, power: view.counts.power + extra.filter(function (x) { return x.group === 'power'; }).length });
    return out;
  }
  // A power notice is saved as a brownout on its day (the notice call refuses power): a short title and a date.
  function H_powerProblem(f) {
    if (!String(f.title || '').trim()) return 'Add a short title, for example the hours.';
    if (String(f.title).trim().length > 60) return 'Keep the title to 60 characters.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''))) return 'Pick the date.';
    return null;
  }

  // ---- haptics: three words, one guard. A silent no-op where navigator.vibrate is missing (iOS Safari), when switched off, or when the page is hidden. ----
  var E_PATTERNS = { tap: [10], error: [30, 60, 30], edge: [6] };
  var E_hapMem = true; // the switch for this page load; demo keeps only this (no storage)
  function E_hapticsOn(storage) {
    if (!E_hapMem) return false;
    try { return !(storage && storage.getItem('cs_haptics') === '0'); } catch (e) { return true; }
  }
  function E_hapticsSet(on, storage) { E_hapMem = !!on; try { if (storage) storage.setItem('cs_haptics', on ? '1' : '0'); } catch (e) { /* blocked storage: the choice lasts until the page closes */ } return E_hapMem; }
  // env = { navigator, storage, doc }; returns true only when a buzz was asked for
  function E_buzz(kind, env) {
    env = env || {}; var nav = env.navigator, p = Object.prototype.hasOwnProperty.call(E_PATTERNS, kind) ? E_PATTERNS[kind] : null;
    if (!p || !nav || !('vibrate' in nav) || typeof nav.vibrate !== 'function') return false;
    if (!E_hapticsOn(env.storage)) return false;
    if (env.doc && env.doc.visibilityState && env.doc.visibilityState !== 'visible') return false;
    try { nav.vibrate(p.slice()); return true; } catch (e) { return false; }
  }

  // ---- gestures: the numbers, then the one helper (E_drag) that every swipe goes through ----
  var E_EDGE = 24, E_EDGE_R_TASK = 12, E_LOCK = 10, E_RATIO = 1.0, E_WINDOW = 100; // s82 H: the browser has already arbitrated at 45 degrees (pan-y), so the lock is the same line; 12 px on the right edge for task rows
  var E_nowFn = function () { return Date.now(); };
  function E_setClock(fn) { E_nowFn = typeof fn === 'function' ? fn : function () { return Date.now(); }; } // tests freeze it
  function E_lockOf(dx, dy) { var ax = Math.abs(dx), ay = Math.abs(dy); return ax > E_LOCK && ax > E_RATIO * ay ? 'x' : ay > E_LOCK && ay > E_RATIO * ax ? 'y' : ''; }
  function E_inEdge(x, w, l, r) { return x < (l == null ? E_EDGE : l) || x > w - (r == null ? E_EDGE : r); }
  // px/ms over the last 100 ms of {t,x,y} samples (the pointerup sample is never in the list: a pause before lifting must not zero a deliberate swipe)
  function E_velocity(s) {
    var n = s.length; if (n < 2) return { vx: 0, vy: 0 };
    var last = s[n - 1], a = s[n - 2], k; for (k = n - 2; k >= 0; k--) { if (last.t - s[k].t <= E_WINDOW) a = s[k]; else break; }
    var dt = last.t - a.t; return dt > 0 ? { vx: (last.x - a.x) / dt, vy: (last.y - a.y) / dt } : { vx: 0, vy: 0 };
  }
  function E_tabFollow(dx) { return Math.max(-96, Math.min(96, dx * 0.6)); } // the content follows the finger at 0.6x, capped at 96 px
  // a fast flick commits only past a 48 px floor and only the way the finger went: a 13 px twitch or a drag flicked back is not a swipe
  function E_tabCommit(dx, w, vx) { return Math.abs(dx) >= Math.min(0.2 * w, 64) || (Math.abs(dx) >= 32 && Math.abs(vx) >= 0.3 && (vx < 0) === (dx < 0)); }
  function E_sheetFollow(dy) { return dy >= 0 ? dy : Math.max(-16, dy * 0.2); }
  function E_sheetCommit(dy, vy) { return dy >= 80 || (dy >= 40 && vy >= 0.4); }
  function E_taskFollow(dx, open) { var a = -dx; return a <= 0 ? 0 : a <= open ? a : open + (a - open) * 0.25; } // px the row has moved left
  function E_taskDist(w) { return Math.min(0.33 * w, 110); }
  function E_taskCommit(dx, w, vx) { return -dx >= E_taskDist(w) || (-dx >= 40 && -vx >= 0.35); }
  function E_taskOpens(dx) { return -dx > 48; }
  function E_slideCommit(dx, travel, vx) { return dx >= 0.7 * travel || (dx >= 0.4 * travel && vx >= 0.6); }
  // E_drag(root, o): pointer events only, first pointer only, no main-button-less starts. o = { sel, axis:'x'|'y', vw(), reduced(), canStart(el, ev),
  //   start(el), move(el, d), reached(el, d) -> bool (fires onEdge once per drag), onEdge(el, d), end(el, d), cancel(el) }.  d = { dx, dy, vx, vy }
  function E_drag(root, o) {
    var g = null, swallow = { el: null, until: 0 };
    function stamp(ev) { return typeof ev.timeStamp === 'number' ? ev.timeStamp : Date.now(); }
    function dOf(ev) { var dx = ev.clientX - g.x0, dy = ev.clientY - g.y0, v = E_velocity(g.s); return { dx: dx, dy: dy, vx: v.vx, vy: v.vy }; }
    function down(ev) {
      if (ev.pointerType === 'mouse') return; // swipes are for a finger or a pen: a mouse drag is selecting text, never a task done (the buttons are the mouse's way)
      swallow.el = null; // a new touch starts fresh: the click it makes is a real tap, never the tail of the last drag
      if (ev.button > 0) return;
      if (g) { if (ev.isPrimary === false) return; var old = g; g = null; if (old.lock && o.cancel) o.cancel(old.el); } // the dropped gesture hands its row or sheet back // a second finger is ignored; a new primary touch means the last pointerup was lost: start over
      var el = ev.target && ev.target.closest ? ev.target.closest(o.sel) : null; if (!el || (o.canStart && !o.canStart(el, ev))) return;
      if (o.axis === 'x' && E_inEdge(ev.clientX, o.vw ? o.vw() : 360, E_EDGE, o.edgeR == null ? E_EDGE : o.edgeR)) return;
      g = { el: el, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, lock: '', s: [{ t: stamp(ev), x: ev.clientX, y: ev.clientY }], edged: false, reduced: !!(o.reduced && o.reduced()) };
    }
    function move(ev) {
      if (!g || ev.pointerId !== g.id) return;
      g.s.push({ t: stamp(ev), x: ev.clientX, y: ev.clientY }); if (g.s.length > 12) g.s.shift();
      if (!g.lock) {
        var L = E_lockOf(ev.clientX - g.x0, ev.clientY - g.y0); if (!L) return;
        if (L !== o.axis) { g = null; return; } // the other direction is the page's to scroll
        g.lock = L; try { if (g.el.setPointerCapture && ev.pointerId != null) g.el.setPointerCapture(ev.pointerId); } catch (e) {}
        if (o.start) o.start(g.el);
      }
      var d = dOf(ev); if (o.move) o.move(g.el, d); // reduced motion keeps the 1:1 follow (a control that does not move under the finger feels broken); only release animations are dropped
      var over = o.reached ? !!o.reached(g.el, d) : false;
      if (over && !g.edged) { g.edged = true; if (o.onEdge) o.onEdge(g.el, d); } else if (!over) g.edged = false;
    }
    function up(ev) {
      if (!g || ev.pointerId !== g.id) return;
      var G = g; g = null; if (!G.lock) return;
      var d = { dx: ev.clientX - G.x0, dy: ev.clientY - G.y0 }, v = E_velocity(G.s); d.vx = v.vx; d.vy = v.vy; d.reduced = G.reduced; // the lift itself is not a velocity sample
      swallow = { el: G.el, until: E_nowFn() + 400 }; // the click that follows a drag is ours to swallow, for 400 ms at most
      if (G.el.isConnected === false) { if (o.cancel) o.cancel(G.el); return; } // the screen was redrawn under the finger: a stale node never commits
      if (o.end) o.end(G.el, d);
    }
    function cancel(ev) { if (!g || ev.pointerId !== g.id) return; var G = g; g = null; if (G.lock && o.cancel) o.cancel(G.el); }
    function click(ev) { if (swallow.el && E_nowFn() < swallow.until && swallow.el.contains && swallow.el.contains(ev.target)) { swallow.el = null; ev.preventDefault(); ev.stopPropagation(); } }
    root.addEventListener('pointerdown', down); root.addEventListener('pointermove', move); root.addEventListener('pointerup', up); root.addEventListener('pointercancel', cancel);
    root.addEventListener('click', click, true);
    return { down: down, move: move, up: up, cancel: cancel, busy: function () { return !!g; } };
  }
  // F_ the width class: chosen by the room there is (the layout width over the root text size, so a big text size lands in a narrower class), never by device or orientation.
  // The same thresholds are the rem media queries in styles.css: 22.5 rem (360 px), 37.5 rem (600 px), 52.5 rem (840 px).
  function F_widthClass(widthPx, rootPx) { var w = (+widthPx || 0) / (+rootPx > 0 ? +rootPx : 16); return w < 22.5 ? 'F_compact' : w < 37.5 ? 'F_phone' : w < 52.5 ? 'F_medium' : 'F_wide'; }
  // the order of the three calendar views, for the swipe and for the arrow keys; no wrap
  function E_tabNeighbour(cur, dir) { var i = A_CAL_TABS.indexOf(cur) + dir; return i < 0 || i >= A_CAL_TABS.length ? null : A_CAL_TABS[i]; }

  return {
    isInAppBrowser: isInAppBrowser, installState: installState, openInBrowserLink: openInBrowserLink, INSTALL_URL: INSTALL_URL, COMMON_LINKS: COMMON_LINKS, pageLink: pageLink,
    taskKindLabel: taskKindLabel, manilaDayOf: manilaDayOf, taskDue: taskDue, taskDueLabel: taskDueLabel, dueFromDate: dueFromDate, taskGroups: taskGroups,
    taskDueCount: taskDueCount, reminderProblem: reminderProblem, canEditRates: canEditRates, rateNum: rateNum, rateLine: rateLine,
    earliestRateStart: earliestRateStart, rateProblem: rateProblem, rateArgs: rateArgs,
    canSeeBookingsToConfirm: canSeeBookingsToConfirm, bookingsToConfirmCount: bookingsToConfirmCount, bookingsToConfirmRow: bookingsToConfirmRow, INQUIRIES_URL: INQUIRIES_URL,
    canDraftReply: canDraftReply, canAddGuestDetails: canAddGuestDetails, shrinkSize: shrinkSize, replyProblem: replyProblem, replyBody: replyBody, replyErrorText: replyErrorText, replyResult: replyResult, clampText: clampText,
    REPLY_MAX_IMAGE_BYTES: REPLY_MAX_IMAGE_BYTES, REPLY_MAX_EDGE: REPLY_MAX_EDGE,
    staffAuthPassword: staffAuthPassword, staffLoginEmail: staffLoginEmail, deriveDisplayName: deriveDisplayName, greetingName: greetingName,
    signinKind: signinKind, signinList: signinList, resolveTeam: resolveTeam, signinForTeam: signinForTeam, typedEntry: typedEntry, keypadPress: keypadPress, signinCredentials: signinCredentials, signinAsKind: signinAsKind,
    authStorage: authStorage, trustedFromStorage: trustedFromStorage, rememberName: rememberName, recalledName: recalledName, doorTarget: doorTarget, doorLink: doorLink, doorRule: doorRule, doorFramed: doorFramed, doorAllowed: doorAllowed, doorsForRole: doorsForRole, foldedDoorUrls: foldedDoorUrls, framedParentTarget: framedParentTarget, FOLD_DOORS: FOLD_DOORS,
    layoutForRole: layoutForRole, accessVerdict: accessVerdict, assertNoMoney: assertNoMoney, moneyKeys: moneyKeys,
    manilaToday: manilaToday, manilaParts: manilaParts, addDays: addDays, daysBetween: daysBetween, weekdayIndex: weekdayIndex,
    dayLabel: dayLabel, dayLong: dayLong, dayShort: dayShort, monthTitle: monthTitle, monthShortYear: monthShortYear, greeting: greeting,
    fmtTime: fmtTime, fmt24: fmt24, ordinal: ordinal, plural: plural, agoLabel: agoLabel, clockLabel: clockLabel,
    monthGrid: monthGrid, dayState: dayState, dayStatus: dayStatus, mergeStays: mergeStays, sameGuest: sameGuest, dayMoves: dayMoves, blockWhy: blockWhy, flagName: flagName, FLAG_KINDS: FLAG_KINDS, blockedLines: blockedLines, blockedLineText: blockedLineText,
    canFlagDays: canFlagDays, guestContact: guestContact, canSeeGuestContact: canSeeGuestContact, MESSENGER_INBOX: MESSENGER_INBOX, rpcMissing: rpcMissing, tgLink: tgLink, warningInfo: warningInfo, findingKey: findingKey, initialOf: initialOf, sourceLabel: sourceLabel, stayDates: stayDates, monthInRange: monthInRange,
    parseNotes: parseNotes, returningLabel: returningLabel, earlierLine: earlierLine, companionsLine: companionsLine, todayCardState: todayCardState,
    orderWarnings: orderWarnings, brownoutText: brownoutText, lowStockText: lowStockText, warningSummary: warningSummary,
    weatherLine: weatherLine, rainLine: rainLine, weatherStale: weatherStale, WEATHER_STALE_MIN: WEATHER_STALE_MIN, esc: esc,
    A_HOUSE_FALLBACK: A_HOUSE_FALLBACK, A_houseTimes: A_houseTimes, A_turnoverClock: A_turnoverClock, A_turnoverLine: A_turnoverLine, A_hm: A_hm, A_NOTICE_TYPES: A_NOTICE_TYPES, A_noticesView: A_noticesView, A_noticeFilters: A_noticeFilters, A_dayMarks: A_dayMarks, A_noticeDay: A_noticeDay, A_guestMessage: A_guestMessage, A_CAL_TABS: A_CAL_TABS, A_calTab: A_calTab, A_stayShade: A_stayShade, A_hubGroups: A_hubGroups, A_hubNative: A_hubNative, A_hubRoutes: A_hubRoutes, A_hubRouteOk: A_hubRouteOk, A_hubDoorUrl: A_hubDoorUrl, A_whatsNew: A_whatsNew, A_shortTime: A_shortTime, A_PINNED: A_PINNED, A_noticeAddError: A_noticeAddError, A_NOTICE_HINT: A_NOTICE_HINT, A_flagDup: A_flagDup, A_facebookUrl: A_facebookUrl, A_fbPluginUrl: A_fbPluginUrl, A_noticeAddProblem: A_noticeAddProblem, A_noticeAddArgs: A_noticeAddArgs, A_plainRefusal: A_plainRefusal, A_hour12: A_hour12, A_timeRange: A_timeRange,
    taskPriorityLabel: taskPriorityLabel, E_attention: E_attention, A_board: A_board, A_heads: A_heads, A_rangeLabel: A_rangeLabel, A_spanShort: A_spanShort, E_warnKey: E_warnKey, E_buzz: E_buzz, E_hapticsOn: E_hapticsOn, E_hapticsSet: E_hapticsSet, E_PATTERNS: E_PATTERNS,
    H_monthOk: H_monthOk, H_dataFrom: H_dataFrom, H_waitStep: H_waitStep, H_withFlags: H_withFlags, H_powerProblem: H_powerProblem, H_noticeUrl: H_noticeUrl, H_noticeHead: H_noticeHead, H_weatherShort: H_weatherShort, H_agenda: H_agenda, H_ready: H_ready, H_readyChips: H_readyChips, H_readyOk: H_readyOk, H_clock12: H_clock12, H_readyLine: H_readyLine, H_progress: H_progress, H_cleanLine: H_cleanLine, H_houseLine: H_houseLine, H_untilLine: H_untilLine, H_manualIndex: H_manualIndex, H_search: H_search, H_dayStep: H_dayStep,
    E_drag: E_drag, E_lockOf: E_lockOf, E_inEdge: E_inEdge, E_velocity: E_velocity, E_tabFollow: E_tabFollow, E_tabCommit: E_tabCommit, E_sheetFollow: E_sheetFollow, E_sheetCommit: E_sheetCommit,
    E_taskFollow: E_taskFollow, E_taskCommit: E_taskCommit, E_taskDist: E_taskDist, E_EDGE_R_TASK: E_EDGE_R_TASK, E_taskOpens: E_taskOpens, E_slideCommit: E_slideCommit, E_tabNeighbour: E_tabNeighbour, F_widthClass: F_widthClass, E_setClock: E_setClock
  };
});
