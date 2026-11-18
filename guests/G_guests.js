/* Cascade Staff 3.2, lane G: Guests. A phone screen for the owner and admins: find a guest, read the record, change it, add details from
   a chat or a photo, replace or remove an ID photo. Mounted by the shell: G_Guests.mount(el, { client, demo, role, sub, propertyId, navigate,
   toast, haptic }) and G_Guests.unmount(). Routes: #guests (list) and #guests/<guest_id> (the record), both arrive as opts.sub.
   Reads and writes use what the admin dashboard uses (features/guests/api.ts): the guests and guest_profile_details tables, the RPCs
   list_guest_companions_v1, save_guest_profile_v1 (patch + expected version + reason), save_guest_companion_v1, delete_guest_companion_v1,
   the private bucket guest-id-photos (signed URLs), and the staff-guest-details function (context / extract / save / replace_id / remove_id).
   Guest data lives in memory for this screen only. Nothing is written to localStorage, sessionStorage or the cache.
   Every feature that depends on something the server may not have yet (the stay lists, the function's new actions) hides itself when it is
   absent; it is never an error box. No build step. Every top-level name is G_ or inside this closure. */
(function (root) {
  'use strict';

  var G_FALLBACK_PROPERTY = '6ae230f4-c189-4547-84b1-cb6e0b2cc9bd'; // same constant as app.js CFG.propertyId; the shell passes opts.propertyId
  var G_FN = 'staff-guest-details';
  var G_BUCKET = 'guest-id-photos';
  var G_PAGE = 40, G_SOON_DAYS = 14, G_BDAY_DAYS = 30, G_MAX_IMAGES = 4, G_MAX_TEXT = 6000;
  var G_REASON_EDIT = 'Updated in the Staff app', G_REASON_PHOTO = 'ID photo changed in the Staff app', G_REASON_COMP = 'Companion changed in the Staff app';
  var G_ID_TYPES = [['passport', 'Passport'], ['drivers_license', 'Driver’s license'], ['national_id', 'National ID'], ['other', 'Other ID']];
  var G_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var G_NO_CONN = 'No connection, so nothing was sent. Check your signal and tap again.';
  var G_LOST = 'The connection dropped, so this may have saved. Check the page before trying again.', G_COPY = 'Copy anything you need, then tap Cancel to see the latest details.';
  var G_SEL = 'id,name,phone,email,tier,total_stays,last_stay_date,guest_profile_details(id_on_file,birthday,contact_number,vip),guest_companions(id_photo_path)'; // companions: only whether a photo exists, read by G_idState; never drawn
  var G_COMP_COLS = 'id,name,id_type,id_photo_path'; // never id_number, notes or contact_number
  var G_PROFILE_COLS = 'guest_id,preferred_channel,language,stay_preferences,tags,vip,vip_reason,version,contact_number,birthday,id_on_file'; // never id_number

  var G_clock = function () { return Date.now(); };
  var S = null, G_seq = 0;
  // Photo links live for the sign-in session only, in memory (never written to storage): a path keeps its signed URL until 5 minutes before it
  // expires, so reopening a guest neither signs nor downloads again. G_rot is the per-session turn (0/90/180/270) of a path; G_reset clears both.
  var G_SIGN_SEC = 300, G_TTL = 30 * 60000, G_epoch = 0, G_cache = {}, G_inflight = {}, G_rot = {}, G_rotSaved = {}, G_rotTimers = {}, G_rotBusy = {}; // G_rotBusy: path -> { next } while that photo's call is out; module level, so leaving and coming back cannot start a second call
  function G_cached(path) { var h = G_cache[path]; return h && h.exp > Date.now() ? h.url : ''; }
  function G_drop(path) { var h = G_cache[path]; if (h) { try { root.URL.revokeObjectURL(h.url); } catch (e) { /* nothing to free */ } } delete G_cache[path]; }
  function G_sign(client, path) {
    var u = G_cached(path); if (u) return Promise.resolve({ url: u });
    if (G_inflight[path]) return G_inflight[path];
    var ep = G_epoch, p = Promise.resolve(client.storage.from(G_BUCKET).createSignedUrl(path, G_SIGN_SEC)).then(function (r) { return r; }, function (e) { return { data: null, error: e || { message: 'network' } }; }).then(function (r) {
      if (r.error || !r.data || !r.data.signedUrl) throw new Error('sign');
      return root.fetch(r.data.signedUrl, { cache: 'no-store', referrerPolicy: 'no-referrer' }); // like app.js: no browser HTTP cache, shown from a memory blob
    }).then(function (res) { if (!res.ok) throw new Error('fetch'); return res.blob(); }).then(function (blob) {
      if (ep !== G_epoch) return { url: '' }; // signed out while downloading: never stored in the next session
      G_drop(path); var url = root.URL.createObjectURL(blob); G_cache[path] = { url: url, exp: Date.now() + G_TTL }; return { url: url };
    }).then(function (o) { if (G_inflight[path] === p) delete G_inflight[path]; return o; }, function () { if (G_inflight[path] === p) delete G_inflight[path]; return { url: '' }; });
    G_inflight[path] = p; return p;
  }
  function G_reset() { G_unmount(); G_epoch++; Object.keys(G_cache).forEach(G_drop); G_cache = {}; G_inflight = {}; G_rot = {}; G_rotSaved = {}; Object.keys(G_rotTimers).forEach(function (k) { clearTimeout(G_rotTimers[k]); }); G_rotTimers = {}; G_rotBusy = {}; }

  // ------------------------------------------------------------------------------------------------ pure helpers (tested)
  function G_esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function G_pad(n) { return (n < 10 ? '0' : '') + n; }
  function G_iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + G_pad(d.getUTCMonth() + 1) + '-' + G_pad(d.getUTCDate()); }
  function G_utc(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function G_today(ms) { return G_iso((ms == null ? G_clock() : ms) + 8 * 3600000); } // Asia/Manila is UTC+8 with no daylight saving
  function G_addDays(iso, n) { return G_iso(G_utc(iso) + n * 86400000); }
  function G_date(iso) { if (!iso) return ''; var p = String(iso).split('-'); return +p[2] + ' ' + G_MON[+p[1] - 1] + (p[0] ? ' ' + p[0] : ''); }
  function G_dayMon(iso) { if (!iso) return ''; var p = String(iso).split('-'); return +p[2] + ' ' + G_MON[+p[1] - 1]; }
  /** The same pattern the dashboard builds (guestSearchPattern): filter grammar becomes a word break, names, phones and e-mails survive. */
  function G_searchPattern(q) {
    var words = String(q == null ? '' : q).slice(0, 120).replace(/[^\p{L}\p{N}\s@+.'-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    return words.length ? '%' + words.join('%') + '%' : null;
  }
  /** Days from `today` to the next birthday (0 = today); null for no valid date. A 29 Feb birthday counts on 1 Mar in other years. */
  function G_daysToBirthday(bday, today) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(bday || '')); if (!m) return null;
    var t = G_utc(today), y = new Date(t).getUTCFullYear(), mo = +m[2] - 1, d = +m[3], next = Date.UTC(y, mo, d);
    if (mo === 1 && d === 29 && new Date(next).getUTCMonth() !== 1) next = Date.UTC(y, 2, 1);
    if (next < t) { next = Date.UTC(y + 1, mo, d); if (mo === 1 && d === 29 && new Date(next).getUTCMonth() !== 1) next = Date.UTC(y + 1, 2, 1); }
    return Math.round((next - t) / 86400000);
  }
  /** stays: [{guest_id, checkin_date, checkout_date}] -> { guestId: { state:'in'|'arr', from, to } }. In house wins over arriving. */
  function G_stayMap(rows, today) {
    var out = {}, soon = G_addDays(today, G_SOON_DAYS);
    (rows || []).forEach(function (r) {
      if (!r || !r.guest_id || !r.checkin_date || !r.checkout_date) return;
      var st = null;
      if (r.checkin_date < today && r.checkout_date >= today) st = 'in';
      else if (r.checkin_date >= today && r.checkin_date <= soon) st = 'arr';
      if (!st) return;
      var cur = out[r.guest_id];
      if (!cur || (st === 'in' && cur.state !== 'in') || (st === cur.state && r.checkin_date < cur.from)) out[r.guest_id] = { state: st, from: r.checkin_date, to: r.checkout_date };
    });
    return out;
  }
  function G_tagsFromText(t) {
    var out = [];
    String(t == null ? '' : t).split(/[,\n;]/).forEach(function (x) { x = x.replace(/\s+/g, ' ').trim().toLowerCase(); if (x && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  function G_sameList(a, b) { a = a || []; b = b || []; return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
  /** Checks the form the same way the dashboard does (validateProfilePatch) before anything is sent. Returns a sentence or ''. */
  function G_check(form, reason, today, tagMax) {
    var r = String(reason == null ? '' : reason).trim();
    if (r.length < 3 || r.length > 500) return 'Add a reason of 3 to 500 characters.';
    if (form.birthday) {
      var v = String(form.birthday), d = new Date(v + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !isFinite(d.getTime()) || G_iso(d.getTime()) !== v || v > today) return 'Enter a birthday that is a real date and not in the future.';
    }
    if (form.tags && (form.tags.length > 20 || form.tags.some(function (t) { return t.length > (tagMax || 50); }))) return 'Use up to 20 tags, each at most ' + (tagMax || 50) + ' characters.';
    if (form.stay_preferences && form.stay_preferences.length > 4000) return 'Keep the preferences within 4,000 characters.';
    if (form.vip_reason && form.vip_reason.length > 4000) return 'Keep the VIP note within 4,000 characters.';
    if (form.contact_number && form.contact_number.length > 40) return 'That phone number is too long.';
    return '';
  }
  var G_LABEL = { contact_number: 'phone', birthday: 'birthday', stay_preferences: 'preferences', tags: 'tags', vip: 'VIP', vip_reason: 'VIP note' };
  /** Only the keys that changed, so a save never rewrites a field the person did not touch. */
  function G_patch(orig, form) {
    var p = {}, o = orig || {};
    function txt(k) { var a = String(o[k] == null ? '' : o[k]).trim(), b = String(form[k] == null ? '' : form[k]).trim(); if (a !== b) p[k] = b === '' ? null : b; }
    txt('contact_number'); txt('birthday'); txt('stay_preferences'); txt('vip_reason');
    if (!G_sameList((o.tags || []).map(function (t) { return String(t).trim().toLowerCase(); }), form.tags || [])) p.tags = form.tags || [];
    if (!!o.vip !== !!form.vip) p.vip = !!form.vip;
    return p;
  }
  function G_names(p) { return Object.keys(p).map(function (k) { return G_LABEL[k] || k; }); }
  function G_toks(n) { return String(n == null ? '' : n).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean); }
  /** A name read from an ID matches the guest when every word of the shorter name is in the longer one. */
  function G_sameName(a, b) {
    var x = G_toks(a), y = G_toks(b); if (!x.length || !y.length) return false;
    var s = x.length <= y.length ? x : y, l = x.length <= y.length ? y : x;
    return s.every(function (t) { return l.indexOf(t) >= 0; });
  }
  function G_exact(a, b) { return G_toks(a).join(' ') === G_toks(b).join(' '); }
  /** A failure as a sentence: what happened, then what to do. */
  function G_errText(status, code) {
    var t = {
      authentication_required: 'Your sign-in ended. Open the Staff app again, then try again.',
      invalid_or_expired_session: 'Your sign-in ended. Open the Staff app again, then try again.',
      staff_access_denied: 'This is for the owner and the admins.',
      guest_not_found: 'This guest is no longer on file. Go back to the list.',
      empty: 'Paste the guest’s message or add a photo first.',
      too_long: 'That text is too long. Paste only the part with the guest’s details.',
      too_many_images: 'Up to ' + G_MAX_IMAGES + ' photos at a time.',
      image_too_large: 'That photo is too large. Take it again or choose a smaller one.',
      bad_image: 'That file is not a photo we can use. Try a JPEG, PNG or WebP photo.',
      too_many_reads: 'Too many photos and messages were read this hour. Try again in a little while.',
      read_failed: 'The message could not be read. Try again, or fill the details in by hand.',
      bad_field: 'One of the details is not in a form we can save. Check the phone, birthday and tags.',
      bad_reason: 'Add a reason of 3 to 500 characters.',
      bad_name: 'A name is missing or has numbers in it.',
      companion_not_found: 'That person is no longer on this guest’s record.',
      changed: 'Someone else changed this guest.',
      denied: 'You do not have permission to save this.'
    };
    if (code && t[code]) return t[code];
    if (status === 401) return t.authentication_required;
    if (status === 403) return t.staff_access_denied;
    if (status === 429) return t.too_many_reads;
    if (status === 413) return t.image_too_large;
    if (status === 0) return G_NO_CONN;
    return 'That did not work. Nothing was changed. Tap again in a moment.';
  }
  /** A PostgREST / RPC error as a sentence. */
  function G_rpcText(err) {
    if (!err) return '';
    var c = String(err.code || ''), m = String(err.message || '');
    if (c === '40001' || /stale version/i.test(m)) return G_errText(0, 'changed');
    if (c === '42501' || /permission|not authorized/i.test(m)) return G_errText(0, 'denied');
    if (c === '22023' && /birthday/i.test(m)) return 'Enter a birthday that is not in the future.';
    if (c === '22023' && /reason/i.test(m)) return G_errText(0, 'bad_reason');
    if (c === 'P0002') return G_errText(0, 'guest_not_found');
    return 'That did not save. Nothing was changed. Tap again in a moment.';
  }
  /** Absent means the server does not have it yet (PostgREST says PGRST202 / 42883 for a missing function, 404 for a missing route). */
  function G_absent(err) { if (!err) return false; var c = String(err.code || ''); return c === 'PGRST202' || c === '42883' || c === '42P01' || c === 'PGRST205' || err.status === 404; }
  function G_saveLines(saved) {
    var L = { companion: 'Companion added.', id_photo: 'ID photo saved.', id_photo_removed: 'ID photo removed.', profile: 'Details saved.', email: 'Email saved.' };
    var W = { denied: '% not allowed', changed: '% changed by someone else', save_failed: 'did not save', upload_failed: 'did not upload', email_kept: '% kept: an email is already on file' }; // % is was, or were for the details
    var N = { companion: 'The companion', id_photo: 'The ID photo', id_photo_removed: 'Removing the ID photo', profile: 'The details', email: 'The email' };
    return (saved || []).map(function (s) { return s.ok ? (L[s.what] || 'Saved.') : (N[s.what] || 'One item') + ' ' + (W[s.reason] || 'did not save').replace('%', s.what === 'profile' ? 'were' : 'was') + '.'; });
  }
  /** One short sentence for a person's stay, for the list rows. */
  function G_stayLine(g, st, today) {
    if (st && st.state === 'in') return 'In house until ' + G_dayMon(st.to);
    if (st && st.state === 'arr') return st.from === today ? 'Arrives today' : 'Arrives ' + G_dayMon(st.from);
    return g.last_stay_date ? (g.last_stay_date > today ? 'Next stay ' : 'Last stay ') + G_date(g.last_stay_date) : 'No stay yet'; // s120: a date still ahead is the next stay, not the last
  }
  // s120 (D-373): guests on a stay are 1 to 3 (booking-terms: the unit holds up to 3). The shown number follows the contract order: staff correction, booked number, then 1 + companions.
  var G_MIN_GUESTS = 1, G_MAX_GUESTS = 3, G_REASON_COUNT = 'Guest count changed in the Staff app';
  // Same rule as CS.goodToKnow in lib.js (Today): only a number counts, rounded, 1 to 3. A value over 3 is shown as 3 and is never a staff correction.
  function G_clampGuests(n) { if (typeof n !== 'number') return null; n = Math.round(n); return n >= G_MIN_GUESTS ? Math.min(G_MAX_GUESTS, n) : null; }
  function G_stayRange(a, b) { var x = String(a || '').split('-'), y = String(b || '').split('-'); return x[1] === y[1] ? +x[2] + ' → ' + G_dayMon(b) : G_dayMon(a) + ' → ' + G_dayMon(b); }
  /** The staff_guest_stay_v1 answer as the card's state; null when the server sent no stay (or the old shape). fallback is 1 + companions on file. */
  function G_stayFrom(d, fallback) {
    if (!d || typeof d !== 'object' || !d.uid || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.checkin_date || ''))) return null;
    var count = G_clampGuests(d.guest_count), booked = G_clampGuests(d.booked_guests), base = count != null ? count : booked != null ? booked : G_clampGuests(fallback) || 1;
    return { uid: String(d.uid), checkin_date: d.checkin_date, checkout_date: d.checkout_date || d.checkin_date, booked: booked, count: count, base: base, draft: base, version: +d.version > 0 ? Math.round(+d.version) : 0, busy: false, msg: '', err: '', key: null, keyN: null };
  }
  function G_stayKey() { var c = root.crypto; return 'guests-' + (c && c.randomUUID ? c.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)); }
  function G_initial(n) { var s = String(n || '').trim(); return s ? s.charAt(0).toUpperCase() : '?'; }
  function G_detailOf(r) { var d = r && r.guest_profile_details; return Array.isArray(d) ? d[0] || {} : d || {}; }

  // ------------------------------------------------------------------------------------------------ plumbing
  function G_noop() {}
  function G_val(id) { var e = S && S.el && S.el.querySelector('#' + id); return e ? e.value : ''; }
  function G_chk(id) { var e = S && S.el && S.el.querySelector('#' + id); return !!(e && e.checked); }
  function G_live(tok) { return S && S.token === tok; }
  // The one redraw rule (s120 U5): whatever staff typed in the open details form or the Add from text box is read into state first, and the field that had focus gets it back with its caret, so no late answer can wipe a field.
  function G_paint() {
    if (!S || !S.el) return;
    var a = G_activeField(), id = a && a.id, from = a && a.selectionStart, to = a && a.selectionEnd;
    G_keepForm();
    S.el.innerHTML = G_html(); G_title();
    var e = id && G_q(id); if (!e || !e.focus) return;
    try { e.focus({ preventScroll: true }); if (from != null && e.setSelectionRange) e.setSelectionRange(from, to); } catch (x) { /* a field type with no caret (a date) keeps focus only */ }
  }
  // Only a field that is drawn right now is read, so a form or sheet that has not been drawn yet (just opened, vip just ticked) keeps its state. Reading changes state and nothing else: no check, no close.
  function G_keepForm() {
    if (!S.d || S.view !== 'detail') return;
    var A = S.add;
    if (S.addComp && G_q('G_newc')) S.newc = G_val('G_newc');
    if (S.edit && G_q('G_f_phone')) G_readEdit();
    if (A && A.sheet && G_q('G_r_phone')) G_syncSheet();
    else if (A && A.step === 'input' && G_q('G_text')) A.text = G_val('G_text');
  }
  function G_activeField() { var d = S && S.el && (S.el.ownerDocument || root.document), a = d && d.activeElement; return a && a.id && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && G_q(a.id) === a ? a : null; }
  // The app bar owns the screen's one heading: while the edit form is open it reads Edit details, otherwise the module's own title (the shell restores it on an empty string).
  function G_title() { var t = S.view === 'detail' && S.edit ? 'Edit details' : ''; if (S.ttl !== t) { S.ttl = t; S.setTitle(t); } }
  function G_q(id) { return S && S.el && S.el.querySelector ? S.el.querySelector('#' + id) : null; }
  function G_focus(id) { var e = S && S.el && S.el.querySelector && S.el.querySelector('#' + id); if (e && e.focus) e.focus(); }
  // For an answer that arrives later: it never pulls focus off a field staff are typing in (the message is still drawn, and its box announces itself).
  function G_focusLate(id) { if (!G_activeField()) G_focus(id); }
  function G_one(q) { return Promise.resolve(q).then(function (r) { return r; }, function (e) { return { data: null, error: e || { message: 'network', network: true } }; }); }
  // s120 U7: a write whose answer never came (no HTTP status, no database code) may have happened, unless the phone is certainly offline. A conflict and a lost answer both leave the page untrusted (G_stale).
  function G_offline() { var n = root.navigator; return !!n && n.onLine === false; }
  function G_noAnswer(err) { return !!err && !err.code && !(err.status > 0); }
  function G_lost(err) { return G_noAnswer(err) && !G_offline(); }
  function G_rpcStale(err) { var c = String(err.code || ''), m = String(err.message || ''); return c === '40001' || /stale version/i.test(m) ? G_errText(0, 'changed') : c === 'P0002' && /companion not found/i.test(m) ? G_errText(0, 'companion_not_found') : G_lost(err) ? G_LOST : ''; } // a missing guest (P0002) keeps its own sentence in G_rpcText
  function G_fnStale(o) {
    var j = o.j || {}, e = j.error;
    if (e === 'changed' || e === 'companion_not_found') return G_errText(o.status, e);
    return (j.saved || []).some(function (x) { return x && !x.ok && x.reason === 'changed'; }) ? G_errText(0, 'changed') : o.lost ? G_LOST : '';
  }
  // s120 U6: one write or reload at a time on a guest's page. While one runs, every control that would start another is disabled (G_off), and the click handler asks the same question, so a late tap does nothing and nothing is queued.
  // S.rot (a photo turn, 1 while more taps can still merge into its one call, 2 once the call is out) is a write too; rotOk lets the Rotate button itself take a merging tap.
  function G_run(rotOk) { var D = S && S.d, A = S && S.add; return !!(S && (S.busy || S.cbusy || (S.rot && !rotOk) || (D && (D.loading || (D.stay && D.stay.busy))) || (A && (A.step === 'reading' || A.step === 'saving')))); }
  function G_off(rotOk) { return G_run(rotOk) ? ' disabled' : ''; }
  function G_rotOk() { return !!S && S.rot === 1 && S.rotPath === S.fullPath; }
  function G_lock() { return !!(S.busy || (S.add && S.add.step === 'saving')); } // the form's own save is running: its fields cannot take new text
  var G_ACTS = /^(edit|edit-cancel|vip|save-edit|add-open|add-cancel|add-back|read|save-add|comp-on|id-on|id-yes|detail-retry|stay-save|add-comp|remove-photo|remove-comp|remove-photo-yes|remove-comp-yes|full-rot|rm-shot)$/, G_NOFORM = /^(detail-retry|remove-photo|remove-comp|remove-photo-yes|remove-comp-yes|full-rot)$/; // with a form open, photos and reloads are off too
  /** An rpc call that never throws: { data, error }. */
  function G_rpc(name, args, cols, client) { // client: a write that outlives its page (a queued photo turn) passes the one it was tapped on, because S is null once Guests is left
    try { var q = (client || S.client).rpc(name, args); if (cols && q && typeof q.select === 'function') q = q.select(cols); return Promise.resolve(q).then(function (r) { return r || { data: null, error: { message: 'no answer' } }; }, function (e) { return { data: null, error: { message: String(e && e.message || e), network: true } }; }); }
    catch (e) { return Promise.resolve({ data: null, error: { message: 'no client', network: true } }); }
  }
  /** The staff-guest-details function: { status, j }. Status 0 is no connection. 207 comes back as success with ok:false inside. */
  function G_call(body) {
    if (!S.client || !S.client.functions || typeof S.client.functions.invoke !== 'function') return Promise.resolve({ status: 0, j: {} });
    var p; try { p = Promise.resolve(S.client.functions.invoke(G_FN, { body: body })); } catch (e) { p = Promise.reject(e); }
    return p.then(function (r) {
      if (r && r.error) return G_httpErr(r.error);
      return { status: 200, j: (r && r.data) || {} };
    }, function (e) { return G_httpErr(e); });
  }
  function G_httpErr(e) {
    var ctx = e && e.context;
    if (ctx && typeof ctx.status === 'number') {
      var st = ctx.status;
      return Promise.resolve(typeof ctx.json === 'function' ? ctx.json() : null).then(function (j) { return { status: st, j: j || {} }; }, function () { return { status: st, j: {} }; });
    }
    return { status: 0, j: {}, lost: !G_offline() }; // a network failure: the answer never arrived, so the write may have happened unless the phone is certainly offline
  }
  function G_shrink(file) {
    return new Promise(function (res, rej) {
      var u = root.URL.createObjectURL(file), img = new root.Image();
      img.onload = function () { root.URL.revokeObjectURL(u); res(img); }; img.onerror = function () { root.URL.revokeObjectURL(u); rej(new Error('image')); }; img.src = u;
    }).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h, 1)), cv = root.document.createElement('canvas'), cx;
      cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      var data = cv.toDataURL('image/jpeg', 0.85); // the re-encode also drops location data
      return { base64: data.replace(/^data:[^,]*,/, ''), mime: 'image/jpeg', src: data };
    });
  }

  // ------------------------------------------------------------------------------------------------ views
  function G_html() {
    if (!S) return '';
    if (S.role !== 'owner' && S.role !== 'admin') return '<div class="G_root"><div class="infobox G_note" role="status">' + G_glyph('i') + '<span>Guests are for the owner and the admins.</span></div></div>';
    var body = S.gid ? G_detailHtml() : G_listHtml();
    return '<div class="G_root">' + body + (S.full ? G_fullHtml() : '') + '</div>';
  }
  // s120: the one tier chip of the Staff app (CS.tierBadge: tier and total stays, a glyph per tier, "First stay"). The hand-set VIP flag is a separate concept; when it is on and the tier is vip, one badge only.
  function G_tierChip(tier, stays, manualVip) {
    var r = root.CS && root.CS.tierBadge ? root.CS.tierBadge({ tier: tier, stay_count: stays }) : null;
    return !r || (r.tier === 'vip' && manualVip) ? '' : '<span class="T_chip T_c-' + r.tier + '">' + (root.ICON ? root.ICON(r.icon, 's16') : '') + '<span>' + G_esc(r.text) + '</span></span>';
  }
  function G_glyph(k) { return '<span class="G_gl" aria-hidden="true">' + ({ i: 'ℹ', ok: '✓', no: '!', x: '×', star: '★', cake: '✦' }[k] || '') + '</span>'; }
  function G_pill(tone, icon, text) { return '<span class="pill p-' + tone + '">' + (root.ICON ? root.ICON(icon, 's16') : '') + G_esc(text) + '</span>'; }
  // One ID rule, the one Today uses (s_arrival_ready_v1.id): the profile flag is true, or any companion has an ID photo. profile and comps are null when they are unknown (not loaded, read failed);
  // the answer is then true or null, never false, and null draws no pill. The list reads the companion photo flags with its rows (guest_companions): an array is known, anything else is passed as null. Only the two approved pills exist.
  function G_idState(profile, comps) {
    if (profile && profile.id_on_file === true) return true;
    if (comps && comps.some(function (c) { return c && c.id_photo_path; })) return true;
    return profile && comps ? false : null;
  }
  function G_idPill(state) { return state === true ? G_pill('ok', 'check', 'ID on file') : state === false ? G_pill('warn', 'idcard', 'No ID yet') : ''; }
  function G_err(msg, id) { return msg ? '<div class="errbox G_note" role="alert" id="' + (id || 'G_err') + '" tabindex="-1">' + G_glyph('no') + '<span>' + G_esc(msg) + '</span></div>' : ''; }
  function G_chev() { return root.ICON ? root.ICON('chev') : '›'; }

  // ---- list
  function G_listHtml() {
    var L = S.list, chips = [['recent', 'Recent']];
    if (L.stays.ok) chips.push(['in', 'In house'], ['arr', 'Arriving']);
    return '<div class="field G_search"><label for="G_q">Find a guest</label><div class="input"><input id="G_q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" maxlength="120" placeholder="Name, phone or email" value="' + G_esc(L.q) + '"></div></div>' +
      '<div class="G_chips" role="group" aria-label="Show">' + chips.map(function (c) {
        return '<button class="chip G_chip" type="button" data-act="filter" data-v="' + c[0] + '" aria-pressed="' + (L.filter === c[0]) + '">' + G_esc(c[1]) + '</button>';
      }).join('') + '</div><div id="G_results" aria-live="polite">' + G_resultsHtml() + '</div>';
  }
  function G_resultsHtml() {
    var L = S.list, today = G_today();
    if (L.err) return G_err(L.err) + '<button class="btn btn-secondary" type="button" data-act="list-retry">Try again</button>';
    if (L.loading && !L.rows.length) return '<div class="skel G_sk"></div><div class="skel G_sk"></div><div class="skel G_sk"></div>';
    if (!L.rows.length) return '<p class="G_empty">' + G_esc(L.filter === 'in' ? 'Nobody is in the house right now.' : L.filter === 'arr' ? 'No arrivals in the next ' + G_SOON_DAYS + ' days.' : L.q.trim() ? 'No guest matches. Try a shorter name.' : 'No guests yet.') + '</p>';
    var rows = L.rows.map(function (g) {
      var d = G_detailOf(g), flags = [], bd = G_daysToBirthday(d.birthday, today);
      flags.push(G_tierChip(g.tier, g.total_stays, d.vip));
      flags.push(G_idPill(G_idState(d, Array.isArray(g.guest_companions) ? g.guest_companions : null)));
      if (!g.phone && !g.email && !d.contact_number) flags.push('<span class="pill p-warn">' + G_glyph('no') + 'No contact</span>');
      if (d.vip) flags.push('<span class="pill p-brand">' + G_glyph('star') + 'VIP</span>');
      if (bd !== null && bd <= G_BDAY_DAYS) flags.push('<span class="pill p-info">' + G_glyph('cake') + (bd === 0 ? 'Birthday today' : 'Birthday in ' + bd + (bd === 1 ? ' day' : ' days')) + '</span>');
      return '<a class="rowi G_row" href="#guests/' + G_esc(g.id) + '"><span class="lead" aria-hidden="true">' + G_esc(G_initial(g.name)) + '</span><span class="mid"><span class="t">' + G_esc(g.name || 'Guest') + '</span><span class="s">' +
        G_esc(G_stayLine(g, L.stays.map[g.id], today)) + '</span>' + (flags.filter(Boolean).length ? '<span class="G_flags">' + flags.join('') + '</span>' : '') + '</span><span class="chev" aria-hidden="true">' + G_chev() + '</span></a>';
    }).join('');
    return '<nav class="card glass list" aria-label="Guests">' + rows + '</nav>' +
      (L.more ? '<button class="btn btn-secondary btn-block" type="button" data-act="more"' + (L.loading ? ' disabled' : '') + '>' + (L.loading ? 'Loading…' : 'Show more guests') + '</button>' : '') +
      (L.total ? '<p class="help G_count">' + G_esc('Showing ' + L.rows.length + ' of ' + L.total + '.') + '</p>' : '');
  }

  // ---- detail
  function G_ic(n) { return root.ICON ? root.ICON(n, 's16') : ''; }
  function G_heroLine(g, st, today) {
    if (st) return st.checkin_date < today ? 'In the house until ' + G_dayMon(st.checkout_date) : st.checkin_date === today ? 'Arrives today' : 'Next stay ' + G_date(st.checkin_date);
    return g.last_stay_date ? (g.last_stay_date > today ? 'Next stay ' : 'Last stay ') + G_date(g.last_stay_date) : 'No stay yet';
  }
  function G_detailHtml() {
    var D = S.d;
    var back = '<a class="btn btn-ghost G_back" href="#guests">‹ All guests</a>';
    var notice = S.msg ? '<div class="okbox G_note" role="status" id="G_msg" tabindex="-1">' + G_glyph('ok') + '<span>' + S.msg.map(G_esc).join('<br>') + '</span></div>' : '';
    if (D.loading) return back + '<div class="skel G_sk G_tall"></div><div class="skel G_sk"></div><div class="skel G_sk"></div>';
    if (D.err) return back + notice + G_err(S.err, 'G_serr') + G_err(D.err) + '<button class="btn btn-secondary" type="button" data-act="detail-retry"' + G_off() + '>Try again</button>'; // a removal that went through stays said even when the reload after it failed
    if (S.add) return G_addHtml();
    var g = D.guest, p = D.details || {}, today = G_today(), bd = G_daysToBirthday(p.birthday, today);
    var phone = p.contact_number || g.phone || '';
    var own = G_ownComp(), noComp = D.compAbsent || D.cErr;
    var name = '<h2 class="G_name" id="G_h" tabindex="-1">' + G_esc(g.name || 'Guest') + '</h2>';
    if (S.edit) return '<div class="G_detail">' + back + notice + G_err(S.err) + name + G_editHtml() + '</div>'; // mockup 4: the name and the form, nothing else
    var idChip = G_idPill(G_idState(D.detailsOk ? p : null, D.compAbsent || D.cErr ? null : D.companions));
    var canAdd = !!(D.feat && D.feat.guest_id && D.feat.preferences);
    var addOk = !!D.detailsOk, idBlock = noComp ? '' : '<div class="cap up G_cap">Guest ID</div>' + (own ? '<div class="G_frame' + (own.id_photo_path ? '' : ' G_noid') + '">' + G_idPhoto(own, true) + '</div>' + G_idControls(own) :
      '<div class="G_frame G_noid"><span class="G_none">No ID photo yet</span></div>' + (canAdd && addOk ? '<div class="G_btns"><button class="btn btn-primary btn-sm" type="button" data-act="add-open"' + G_off() + '>' + G_ic('camera') + 'Add ID photo</button></div>' : ''));
    var head = '<div class="G_hero">' + idBlock + name + '<p class="G_line">' + G_esc(G_heroLine(g, D.stay, today)) + '</p>' +
      (bd !== null && bd <= G_BDAY_DAYS ? '<p class="G_line">' + G_glyph('cake') + G_esc(bd === 0 ? 'Birthday today' : 'Birthday in ' + bd + (bd === 1 ? ' day' : ' days')) + '</p>' : '') +
      '<div class="G_chipsrow">' + idChip + (p.vip ? '<span class="pill p-brand">' + G_glyph('star') + 'VIP</span>' : '') + G_tierChip(g.tier, g.total_stays, p.vip) + '</div>' +
      (D.detailsOk ? '<button class="btn btn-secondary btn-sm" type="button" data-act="edit"' + G_off() + '>Edit details</button>' : '<p class="help" role="status">The details could not load, so they cannot be changed yet.</p><button class="btn btn-secondary btn-sm" type="button" data-act="detail-retry"' + G_off() + '>Try again</button>') + '</div>'; // never an edit form without the version it was read at
    // The Add button has its slot from the first paint: the function probe decides whether it is shown, never whether space is kept.
    var addSlot = '<div class="G_slot">' + (canAdd && addOk ? '<button class="btn btn-secondary btn-block" type="button" data-act="add-open"' + G_off() + '>' + G_ic('image') + 'Add from text, screenshot or photo</button>' : '') + '</div>';
    return '<div class="G_detail">' + back + notice + G_err(S.err) + head + G_stayHtml() + G_infoHtml(g, p, phone, D.detailsOk) + G_companionsHtml() + addSlot + '</div>';
  }
  function G_row(label, value, edit) {
    var tag = edit ? 'button class="G_frm" type="button" data-act="edit"' + G_off() : 'div class="G_frm"';
    return '<div class="G_fr"><' + tag + '><span class="G_fl">' + label + '</span><span class="G_fv">' + value + '</span>' + (edit ? '<span class="chev" aria-hidden="true">' + G_chev() + '</span>' : '') + '</' + (edit ? 'button' : 'div') + '></div>';
  }
  function G_infoHtml(g, p, phone, canEdit) {
    var tags = (p.tags || []).map(function (t) { return '<span class="pill p-neutral">' + G_esc(t) + '</span>'; }).join(''), none = function (t) { return '<span class="G_none">' + t + '</span>'; };
    var filled = [p.birthday, (p.tags || []).length, p.vip].filter(Boolean).length;
    var call = phone ? '<a class="btn btn-ghost btn-sm G_call" href="tel:' + G_esc(String(phone).replace(/[^\d+]/g, '')) + '" aria-label="' + G_esc('Call ' + phone) + '">Call</a>' : '';
    return '<div class="cap up G_cap">Guest</div><div class="card list G_group">' +
      '<div class="G_frwrap">' + G_row('Contact number', phone ? G_esc(phone) : none(canEdit ? 'Add' : 'Not on file'), canEdit) + call + '</div>' +
      G_row('Email', g.email ? '<a class="G_tel" href="mailto:' + G_esc(g.email) + '">' + G_esc(g.email) + '</a>' : none('Not on file'), false) +
      G_row('Notes', p.stay_preferences ? '<span class="G_pre">' + G_esc(p.stay_preferences) + '</span>' : none(canEdit ? 'Add' : 'Could not load'), canEdit) +
      '</div>' +
      '<details class="card list G_group G_opt"><summary><span class="G_fl">More details</span><span class="G_cnt">' + filled + ' of 3 filled</span><span class="chev turn" aria-hidden="true">' + G_chev() + '</span></summary>' +
      G_row('Birthday', p.birthday ? G_esc(G_date(p.birthday)) : none('Not on file'), false) + G_row('Tags', tags ? '<span class="G_tags">' + tags + '</span>' : none('None'), false) +
      G_row('VIP', p.vip ? G_glyph('star') + 'Yes' + (p.vip_reason ? ' · ' + G_esc(p.vip_reason) : '') : 'No', false) + '</details>';
  }
  function G_field(id, label, value, attrs, hint) {
    return '<div class="field"><label for="' + id + '">' + G_esc(label) + '</label><div class="input"><input id="' + id + '" value="' + G_esc(value) + '" autocomplete="off" ' + (attrs || '') + (G_lock() ? ' readonly' : '') + '></div>' + (hint ? '<span class="help">' + G_esc(hint) + '</span>' : '') + '</div>';
  }
  function G_editHtml() {
    var E = S.edit, busy = S.busy;
    return '<div class="card G_card G_form">' + G_err(E.err, 'G_eerr') +
      G_field('G_f_phone', 'Contact number', E.contact_number, 'inputmode="tel" maxlength="40"') +
      G_field('G_f_bday', 'Birthday', E.birthday, 'type="date" max="' + G_today() + '"') +
      '<div class="field"><label for="G_f_pref">Notes</label><textarea class="ta" id="G_f_pref" rows="4" maxlength="4000"' + (G_lock() ? ' readonly' : '') + ' placeholder="Allergies, a quiet room, a late arrival">' + G_esc(E.stay_preferences) + '</textarea></div>' +
      G_field('G_f_tags', 'Tags', E.tags, 'maxlength="400"', 'Separate tags with commas.') +
      '<div class="G_vip"><button class="chk" type="button" id="G_f_vip" role="checkbox" aria-checked="' + !!E.vip + '" aria-label="VIP guest" data-act="vip"' + (G_lock() ? ' disabled' : '') + '>' + (root.ICON ? root.ICON('check', 's16') : '') + '</button><span>VIP guest</span></div>' +
      (E.vip ? G_field('G_f_vipr', 'VIP note', E.vip_reason, 'maxlength="500"') : '') +
      G_field('G_f_reason', 'Reason for the change', E.reason, 'maxlength="500"', 'Kept in the guest’s history. Change it if you like.') +
      '<div class="G_btns"><button class="btn btn-primary" type="button" data-act="save-edit"' + (busy || S.d.stale ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save changes') + '</button><button class="btn btn-ghost" type="button" data-act="edit-cancel"' + (busy ? ' disabled' : '') + '>Cancel</button></div></div>';
  }

  // ---- companions and ID photos
  function G_ownComp() { var D = S.d, l = D.companions || [], i; for (i = 0; i < l.length; i++) if (G_exact(l[i].name, D.guest.name)) return l[i]; return null; }
  function G_idPhoto(c, hero) {
    var D = S.d, url = G_cached(c.id_photo_path);
    if (!c.id_photo_path) return '<span class="G_none">No ID photo yet</span>';
    return url ? '<button class="G_photo' + G_rotCls(c.id_photo_path) + '" type="button" data-act="full" data-id="' + G_esc(c.id) + '" data-path="' + G_esc(c.id_photo_path) + '" aria-label="Open the ID photo of ' + G_esc(c.name) + ' full screen"><img class="G_img" src="' + G_esc(url) + '" loading="lazy" decoding="async" alt="ID photo of ' + G_esc(c.name) + '">' + (hero ? '<span class="G_exp" aria-hidden="true">' + (root.ICON ? root.ICON('ext', 's16') : '⤢') + '</span>' : '') + '</button>' :
      '<button class="btn btn-secondary btn-sm" type="button" data-act="show-id" data-id="' + G_esc(c.id) + '">' + (D.urlBusy === c.id ? 'Opening…' : 'Show ID photo') + '</button>';
  }
  // Replace, remove and the confirm step for one person; the guest's own record has no Remove person.
  function G_idControls(c) {
    var D = S.d, own = G_exact(c.name, D.guest.name), conf = S.confirm && S.confirm.id === c.id ? S.confirm.kind : '';
    var pick = function (label, act, primary) {
      return '<label class="btn ' + (primary ? 'btn-primary' : 'btn-secondary') + ' btn-sm G_pick">' + (primary ? G_ic('camera') : '') + label + '<input class="sr" type="file" accept="image/*" data-pick="' + act + '" data-id="' + G_esc(c.id) + '"' + G_off() + ' aria-label="' + G_esc(label + ' for ' + c.name) + '"></label>';
    };
    if (S.cbusy === c.id) return '<p class="help" role="status">Working…</p>';
    return conf === 'remove-photo' ? G_confirm('Remove this ID photo? The file is deleted by the clean-up job later.', 'remove-photo-yes', c.id, 'Remove photo') :
      conf === 'remove-comp' ? G_confirm('Remove ' + c.name + ' from this record, with the ID photo?', 'remove-comp-yes', c.id, 'Remove person') :
      '<div class="G_btns">' + (D.feat && D.feat.replace_id ? pick(c.id_photo_path ? 'Replace photo' : 'Add ID photo', 'replace', !c.id_photo_path) : '') + (c.id_photo_path && D.feat && D.feat.remove_id ? '<button class="btn btn-ghost btn-sm" type="button" data-act="remove-photo" data-id="' + G_esc(c.id) + '"' + G_off() + '>Remove photo</button>' : '') +
      (!own ? '<button class="btn btn-ghost btn-sm" type="button" data-act="remove-comp" data-id="' + G_esc(c.id) + '"' + G_off() + '>Remove person</button>' : '') + '</div>';
  }
  function G_companionsHtml() {
    var D = S.d;
    if (D.compAbsent) return '';
    var cap = '<div class="cap up G_cap">People and ID photos</div>';
    if (D.cErr) return cap + '<div class="card G_card">' + G_err('No connection, so the people and ID photos could not load.', 'G_cerr') + '<button class="btn btn-secondary" type="button" data-act="detail-retry"' + G_off() + '>Try again</button></div>';
    var own = G_ownComp(), list = (D.companions || []).filter(function (c) { return c !== own; });
    var rows = list.map(function (c) {
      var open = S.cOpen === c.id || S.cbusy === c.id || (S.confirm && S.confirm.id === c.id);
      return '<div class="G_fr"><button class="G_frm" type="button" data-act="comp-open" data-id="' + G_esc(c.id) + '" aria-expanded="' + !!open + '"><span class="G_fl">' + G_esc(c.name) + '</span><span class="G_fv">' +
        (c.id_photo_path ? G_pill('ok', 'check', 'ID on file') : G_pill('warn', 'idcard', 'No ID yet')) + '</span><span class="chev" aria-hidden="true">' + G_chev() + '</span></button></div>' +
        (open ? '<div class="G_comp">' + (c.id_type ? '<span class="G_none">' + G_esc(G_typeName(c.id_type)) + '</span>' : '') + G_idPhoto(c) + G_idControls(c) + '</div>' : '');
    }).join('');
    var addOpen = S.addComp || S.cbusy === 'new';
    return cap + '<div class="card list G_group G_person">' + rows + G_err(S.cerr, 'G_cerr') +
      '<div class="G_fr"><button class="G_frm G_addrow" type="button" data-act="comp-add-open" aria-expanded="' + !!addOpen + '">' + G_ic('plus') + 'Add a companion</button></div>' +
      (addOpen ? '<div class="field G_addcomp"><label for="G_newc">Full name</label><div class="G_inline"><div class="input"><input id="G_newc" maxlength="80" placeholder="Full name" autocomplete="off" value="' + G_esc(S.newc) + '"' + (S.cbusy === 'new' ? ' readonly' : '') + '></div><button class="btn btn-secondary" type="button" data-act="add-comp"' + G_off() + '>Add</button></div></div>' : '') + '</div>';
  }
  // ---- This stay (s120): the number of guests on the guest's current or next stay, from staff_guest_stay_v1 (D-373). Absent or null from the server: no card.
  function G_bookedText(st) { return st.booked != null ? 'Booked for ' + st.booked + (st.draft !== st.booked ? ', staying ' + st.draft : '') : ''; }
  function G_svHtml(st) { var ch = st.draft !== st.base || st.busy; return G_canSave(st) || st.busy ? '<button class="btn btn-primary btn-sm" type="button" data-act="stay-save"' + G_off() + '>' + (st.busy ? 'Saving…' : 'Save') + '</button>' + (ch ? '<button class="btn btn-ghost btn-sm" type="button" data-act="stay-undo"' + (st.busy ? ' disabled' : '') + '>Cancel</button>' : '') : ''; }
  function G_stmHtml(st) { return st.err ? '<p class="G_stm G_ster" role="alert" id="G_stmsg" tabindex="-1">' + G_esc(st.err) + '</p>' : st.msg ? '<p class="G_stm" role="status" id="G_stmsg" tabindex="-1">' + G_esc(st.msg) + '</p>' : ''; }
  function G_stayInner(st) {
    var n = st.draft;
    var btn = function (id, act, label, glyph, off) { return '<button class="G_stb" id="' + id + '" type="button" data-act="' + act + '" aria-label="' + label + '"' + (off ? ' aria-disabled="true"' : '') + '>' + glyph + '</button>'; };
    return '<div class="cap up G_cap" id="G_stay" tabindex="-1">' + (st.checkin_date > G_today() ? 'Next stay' : 'This stay') + '</div><div class="card list G_group G_stay">' +
      '<div class="G_fr"><div class="G_frm"><span class="G_fl">Dates</span><span class="G_fv num">' + G_esc(G_stayRange(st.checkin_date, st.checkout_date)) + '</span></div></div>' +
      '<div class="G_fr"><div class="G_frm"><span class="G_cl" id="G_gl">Number of guests<small id="G_gbk">' + G_esc(G_bookedText(st)) + '</small></span><span class="G_st" role="group" aria-labelledby="G_gl">' +
        btn('G_gdec', 'stay-dec', 'Fewer guests', '−', n <= G_MIN_GUESTS || st.busy) + '<output id="G_gout" aria-live="polite">' + n + '</output>' + btn('G_ginc', 'stay-inc', 'More guests', '+', n >= G_MAX_GUESTS || st.busy) + '</span></div></div>' +
      '<div class="G_sv" id="G_sv">' + G_svHtml(st) + '</div><div id="G_stm">' + G_stmHtml(st) + '</div></div>';
  }
  function G_stayHtml() { var st = S.d.stay; return st ? '<section class="G_staywrap" id="G_staywrap">' + G_stayInner(st) + '</section>' : ''; }
  // Redraws only the card (More details and the rest of the page stay as they are); the whole page when the card is not on screen.
  function G_stayPaint() { var w = G_q('G_staywrap'), st = S.d && S.d.stay; if (w && st) { w.innerHTML = G_stayInner(st); G_lockPage(); } else G_paint(); }
  // The card is redrawn alone, so the other controls of the page are switched here (a count save running turns them off, and its end turns them on).
  function G_lockPage() { var off = G_run(), offRot = G_run(G_rotOk()); Array.prototype.forEach.call(S.el.querySelectorAll('[data-act], [data-pick]'), function (n) { var a = n.getAttribute('data-act'); if (n.getAttribute('data-pick') || G_ACTS.test(a)) n.disabled = a === 'full-rot' ? offRot : off; }); } // with the form open the card is not drawn: G_paint keeps the typed text and the focus
  // A stepper tap changes the number, the two buttons, the booked line and the Save row in place, so the live region keeps speaking and nothing else on the page is redrawn.
  function G_stayLive(st) {
    var o = G_q('G_gout'), dec = G_q('G_gdec'), inc = G_q('G_ginc'), bk = G_q('G_gbk'), sv = G_q('G_sv'), mg = G_q('G_stm'); if (!o || !dec || !inc || !bk || !sv || !mg) return false;
    var off = function (b, on) { if (on) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); };
    o.textContent = String(st.draft); off(dec, st.draft <= G_MIN_GUESTS); off(inc, st.draft >= G_MAX_GUESTS);
    bk.textContent = G_bookedText(st); sv.innerHTML = G_svHtml(st); mg.innerHTML = G_stmHtml(st); return true;
  }
  function G_confirm(text, act, id, label) {
    return '<div class="G_ask" role="group" aria-label="Please confirm"><p class="help">' + G_esc(text) + '</p><div class="G_btns"><button class="btn btn-danger btn-sm" type="button" data-act="' + act + '" data-id="' + G_esc(id) + '"' + G_off() + '>' + G_esc(label) + '</button><button class="btn btn-secondary btn-sm" type="button" data-act="confirm-no">Keep it</button></div></div>';
  }
  function G_typeName(t) { for (var i = 0; i < G_ID_TYPES.length; i++) if (G_ID_TYPES[i][0] === t) return G_ID_TYPES[i][1]; return 'ID'; }
  function G_rotCls(path) { var d = G_rot[path] || 0; return d ? ' G_r' + d : ''; }
  function G_fullHtml() {
    return '<div class="G_full" role="dialog" aria-modal="true" aria-label="ID photo"><button class="btn btn-secondary G_x" type="button" data-act="full-close" id="G_fullx">Close</button><button class="btn btn-secondary G_rotbtn" type="button" data-act="full-rot"' + G_off(G_rotOk()) + '>Rotate</button><span class="G_rotst" role="status" aria-live="polite">' + G_esc(S.rotMsg || '') + '</span><img class="G_img' + G_rotCls(S.fullPath) + '" src="' + G_esc(S.full) + '" alt="ID photo, full screen"></div>';
  }

  // ---- add from text, screenshot or photo
  function G_addHtml() {
    var A = S.add, D = S.d, g = D.guest, f = D.details || {};
    var head = '<div class="card glass G_card"><div class="card-head"><h3>Add details</h3></div><p class="G_line">' + G_esc(g.name) + '</p></div>';
    if (A.step === 'done') {
      return head + '<div class="okbox G_note" role="status" id="G_msg" tabindex="-1">' + G_glyph('ok') + '<span>' + A.lines.map(G_esc).join('<br>') + '</span></div>' +
        '<button class="btn btn-primary btn-block" type="button" data-act="add-done">Back to the guest</button>';
    }
    if (A.step === 'review' || A.step === 'saving') return head + G_reviewHtml();
    var busy = A.step === 'reading';
    var shots = A.images.map(function (im, i) {
      return '<div class="G_shot"><img src="' + G_esc(im.src) + '" alt="Photo ' + (i + 1) + '"><button class="btn btn-secondary btn-sm" type="button" data-act="rm-shot" data-i="' + i + '" aria-label="Remove photo ' + (i + 1) + '"' + G_off() + '>Remove</button></div>';
    }).join('');
    var room = A.images.length + A.preparing < G_MAX_IMAGES;
    return head + G_err(A.err, 'G_aerr') +
      '<div class="field"><label for="G_text">Guest’s message (optional)</label><textarea class="ta" id="G_text" rows="6" maxlength="' + G_MAX_TEXT + '" placeholder="Paste what the guest sent: names, phone, allergies, a birthday">' + G_esc(A.text) + '</textarea></div>' +
      '<div class="field"><span class="lbl">Photos (optional)</span>' + (shots ? '<div class="G_shots">' + shots + '</div>' : '') +
      (room ? '<div class="G_btns"><label class="btn btn-secondary G_pick">Take a photo<input class="sr" type="file" accept="image/*" capture="environment" data-pick="shot" aria-label="Take a photo"' + G_off() + '></label>' +
        '<label class="btn btn-secondary G_pick">Choose photos<input class="sr" type="file" accept="image/*" multiple data-pick="shot" aria-label="Choose photos"' + G_off() + '></label></div>' : '') +
      (A.preparing ? '<p class="help" role="status">Preparing the photos…</p>' : '<p class="help">Chat screenshots and ID photos, up to ' + G_MAX_IMAGES + '. Screenshots are read and then dropped. Only an ID photo you keep is stored.</p>') + '</div>' +
      '<button class="btn btn-primary btn-block" type="button" data-act="read"' + (busy || A.preparing ? ' disabled' : '') + '>' + (busy ? 'Reading…' : 'Read the details') + '</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-act="add-cancel"' + (busy ? ' disabled' : '') + '>Cancel</button>' +
      '<p class="help G_center">Nothing is saved until you check the details and tap Save.</p>';
  }
  function G_ownNeedsYes(d, guestName) { return d.own && d.readName && !G_sameName(d.readName, guestName); }
  function G_reviewHtml() {
    var A = S.add, s = A.sheet, g = S.d.guest, f = S.d.details || {}, busy = A.step === 'saving', ro = busy ? ' readonly' : '', dis = busy ? ' disabled' : '';
    var comps = s.companions.length ? '<div class="card list G_list">' + s.companions.map(function (c, i) {
      return '<div class="G_chkrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!c.on + '" aria-label="' + G_esc('Add ' + (c.name || 'this person')) + '" data-act="comp-on" data-i="' + i + '"' + dis + '>' + (root.ICON ? root.ICON('check', 's16') : '') + '</button>' +
        '<div class="input"><input id="G_cn' + i + '" value="' + G_esc(c.name) + '" aria-label="Companion name" maxlength="80"' + ro + '></div></div>';
    }).join('') + '</div>' : '';
    var ids = s.ids.length ? '<div class="card list G_list">' + s.ids.map(function (d, i) {
      var im = A.images[d.image];
      return '<div class="G_chkrow G_idrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!d.on + '" aria-label="Keep this ID photo" data-act="id-on" data-i="' + i + '"' + dis + '>' + (root.ICON ? root.ICON('check', 's16') : '') + '</button>' +
        (im ? '<img class="G_idimg" src="' + G_esc(im.src) + '" alt="ID photo">' : '') + '<div class="G_idform">' +
        '<div class="input"><select id="G_io' + i + '" aria-label="Whose ID" data-act-change="id-own" data-i="' + i + '"' + dis + '><option value="own"' + (d.own ? ' selected' : '') + '>' + G_esc('The guest (' + g.name + ')') + '</option><option value="comp"' + (d.own ? '' : ' selected') + '>A companion</option></select></div>' +
        (d.own ? '' : '<div class="input"><input id="G_in' + i + '" value="' + G_esc(d.name) + '" aria-label="Name on the ID" maxlength="80"' + ro + '></div>') +
        (G_ownNeedsYes(d, g.name) ? '<p class="help">' + G_esc('The ID reads ' + d.readName + '.') + '</p><div class="G_vip"><button class="chk" type="button" role="checkbox" aria-checked="' + !!d.yes + '" data-act="id-yes" data-i="' + i + '"' + dis + ' aria-label="' + G_esc('Yes, this is ' + g.name) + '">' + (root.ICON ? root.ICON('check', 's16') : '') + '</button><span>' + G_esc('Yes, this is ' + g.name) + '</span></div>' : '') +
        '<div class="input"><select id="G_it' + i + '" aria-label="ID type"' + dis + '>' + G_ID_TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === d.id_type ? ' selected' : '') + '>' + G_esc(t[1]) + '</option>'; }).join('') + '</select></div></div></div>';
    }).join('') + '</div>' : '';
    return G_err(A.err, 'G_aerr') + '<h3 class="G_h3" id="G_rh" tabindex="-1">Check before saving</h3><p class="help">Fix anything that is wrong. Empty fields are left as they are.</p>' +
      G_field('G_r_phone', 'Phone', s.phone, 'inputmode="tel" maxlength="20"', f.contact_number && s.phone && s.phone !== f.contact_number ? 'Replaces ' + f.contact_number + ' on file.' : '') +
      G_field('G_r_email', 'Email', s.email, 'inputmode="email" maxlength="120"' + (g.email ? ' disabled' : ''), g.email ? 'An email is already on file. It is kept.' : '') +
      '<div class="field"><label for="G_r_pref">Preferences to add</label><textarea class="ta" id="G_r_pref" rows="3" maxlength="600"' + ro + '>' + G_esc(s.stay_preferences) + '</textarea>' +
        (A.noDetails ? '' : '<span class="help">' + (f.stay_preferences ? 'Added under what is already noted.' : 'Nothing is noted yet.') + '</span>') + '</div>' +
      G_field('G_r_bday', 'Birthday', s.birthday, 'type="date" max="' + G_today() + '"', f.birthday && s.birthday && s.birthday !== f.birthday ? 'Replaces ' + G_date(f.birthday) + ' on file.' : '') +
      G_field('G_r_tags', 'Tags to add', s.tags, 'maxlength="400"', 'Separate tags with commas. Tags on file stay.') +
      (s.guests || s.nationality ? '<div class="infobox G_note">' + G_glyph('i') + '<span>' + G_esc([s.guests ? 'The message says ' + s.guests + (s.guests === '1' ? ' guest.' : ' guests.') : '', s.nationality ? 'Nationality: ' + s.nationality + '.' : ''].filter(Boolean).join(' ')) + ' For your information. It is not saved.</span></div>' : '') +
      (comps ? '<div class="cap up G_cap">Companions to add</div>' + comps : '') + (ids ? '<div class="cap up G_cap">ID photos to keep</div>' + ids : '') +
      G_field('G_r_reason', 'Reason for the change', s.reason, 'maxlength="500"', 'Kept in the guest’s history.') +
      '<button class="btn btn-primary btn-block" type="button" data-act="save-add"' + (busy || S.d.stale ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save to the guest record') + '</button>' +
      (S.d.stale || A.landed ? '<button class="btn btn-ghost btn-block" type="button" data-act="add-cancel">Cancel</button>' : '<button class="btn btn-ghost btn-block" type="button" data-act="add-back"' + (busy ? ' disabled' : '') + '>Back</button>');
  }
  /** The model's proposal as an editable sheet. */
  function G_sheetFrom(p, guestName) {
    p = p || {};
    return {
      phone: p.phone || '', email: p.email || '', stay_preferences: p.stay_preferences || '', birthday: p.birthday || '', tags: (p.tags || []).join(', '),
      guests: p.guests ? String(p.guests) : '', nationality: p.nationality || '', reason: G_REASON_EDIT,
      companions: (p.companions || []).map(function (n) { return { name: n, on: true }; }),
      ids: (p.ids || []).map(function (d) { return { image: d.image, readName: d.name, name: d.own ? '' : d.name, id_type: d.id_type, own: !!d.own, on: true, yes: !!d.own }; })
    };
  }
  /** Reads the sheet's fields back from the screen. */
  function G_syncSheet() {
    var A = S.add, s = A && A.sheet; if (!s) return;
    s.phone = G_val('G_r_phone'); if (!S.d.guest.email) s.email = G_val('G_r_email');
    s.stay_preferences = G_val('G_r_pref'); s.birthday = G_val('G_r_bday'); s.tags = G_val('G_r_tags'); s.reason = G_val('G_r_reason');
    s.companions.forEach(function (c, i) { var v = G_val('G_cn' + i); if (v !== '' || S.el.querySelector('#G_cn' + i)) c.name = v; });
    s.ids.forEach(function (d, i) {
      var o = S.el.querySelector('#G_io' + i), n = S.el.querySelector('#G_in' + i), t = S.el.querySelector('#G_it' + i);
      if (o) d.own = o.value === 'own'; if (n) d.name = n.value; if (t) d.id_type = t.value;
    });
  }
  /** What the sheet would send, or { error }. The server checks every field again. */
  function G_addBody(guestId, s, images, guestName, version) {
    var tags = G_tagsFromText(s.tags);
    for (var i = 0; i < s.ids.length; i++) {
      var d = s.ids[i]; if (!d.on) continue;
      if (!d.own && !String(d.name).trim()) return { error: 'Type the name on each companion’s ID, or untick it.' };
      if (G_ownNeedsYes(d, guestName) && !d.yes) return { error: 'Tick “Yes, this is ' + guestName + '” for the ID that reads ' + d.readName + ', or choose A companion.' };
    }
    for (var j = 0; j < s.companions.length; j++) if (s.companions[j].on && !String(s.companions[j].name).trim()) return { error: 'Type each companion’s name, or untick the empty one.' };
    var body = { action: 'save', guest_id: guestId, reason: String(s.reason || '').trim() || G_REASON_EDIT };
    if (version != null) body.expected_version = version;
    if (String(s.phone).trim()) body.phone = String(s.phone).trim();
    if (String(s.email).trim()) body.email = String(s.email).trim();
    if (String(s.stay_preferences).trim()) body.stay_preferences = String(s.stay_preferences).trim();
    if (s.birthday) body.birthday = s.birthday;
    if (tags.length) body.tags = tags;
    var comps = s.companions.filter(function (c) { return c.on && String(c.name).trim(); }).map(function (c) { return String(c.name).trim(); });
    if (comps.length) body.companions = comps;
    var ids = s.ids.filter(function (d) { return d.on && images[d.image]; }).map(function (d) {
      return { name: d.own ? guestName : String(d.name).trim(), id_type: d.id_type, image: { base64: images[d.image].base64, mime: images[d.image].mime } };
    });
    if (ids.length) body.ids = ids;
    var has = ['phone', 'email', 'stay_preferences', 'birthday', 'tags', 'companions', 'ids'].some(function (k) { return body[k] != null; });
    return has ? { body: body } : { error: 'There is nothing to save. Fill a field or keep a photo, or tap Back.' };
  }

  // ------------------------------------------------------------------------------------------------ data
  function G_scoped(q) { return S.pid ? q.eq('property_id', S.pid) : q; }
  function G_loadStays() {
    var tok = S.token, today = G_today(), L = S.list;
    var read = function (table) {
      var q = S.client.from(table).select('guest_id,checkin_date,checkout_date').eq('status', 'confirmed').gte('checkout_date', today).not('guest_id', 'is', null).limit(300);
      return Promise.resolve(G_scoped(q)).then(function (r) { return r && !r.error ? r.data || [] : null; }, function () { return null; });
    };
    return Promise.all([read('airbnb_reservations'), read('booking_inquiries')]).then(function (rs) {
      if (!G_live(tok)) return;
      if (rs[0] && rs[1]) { L.stays = { ok: true, map: G_stayMap(rs[0].concat(rs[1]), today) }; } // either read failing hides both chips: half a list would mislead
      if (S.view === 'list') G_paint();
    });
  }
  function G_loadList(append) {
    var L = S.list, tok = S.token, ids = null;
    if (L.filter === 'in' || L.filter === 'arr') ids = Object.keys(L.stays.map).filter(function (k) { return L.stays.map[k].state === L.filter; });
    var pat = G_searchPattern(L.q);
    L.err = '';
    if ((L.q.trim() && !pat) || (ids && !ids.length)) { L.rows = []; L.total = 0; L.more = false; L.loading = false; G_paintResults(); return Promise.resolve(); }
    L.loading = true; G_paintResults();
    var off = append ? L.rows.length : 0, ticket = ++L.ticket;
    var q = S.client.from('guests').select(G_SEL, { count: 'exact' }).eq('is_active', true);
    if (S.pid) q = q.eq('property_id', S.pid);
    if (pat) q = q.or('name.ilike.' + pat + ',phone.ilike.' + pat + ',email.ilike.' + pat);
    if (ids) q = q.in('id', ids);
    q = q.order('last_stay_date', { ascending: false, nullsFirst: false }).order('id').range(off, off + G_PAGE - 1);
    return Promise.resolve(q).then(function (r) { return r; }, function (e) { return { data: null, error: e || { message: 'network' } }; }).then(function (r) {
      if (!G_live(tok) || ticket !== L.ticket) return; // a newer search has started
      L.loading = false;
      if (!r || r.error) { L.err = 'No connection, so the guest list could not load.'; if (!append) L.rows = []; }
      else { L.rows = append ? L.rows.concat(r.data || []) : r.data || []; L.total = r.count == null ? L.rows.length : r.count; L.more = L.rows.length < L.total; }
      G_paintResults();
    });
  }
  function G_paintResults() { var box = S && S.el && S.el.querySelector && S.el.querySelector('#G_results'); if (box) box.innerHTML = G_resultsHtml(); else G_paint(); }

  function G_loadDetail() {
    var tok = S.token, id = S.gid, prev = (S.d && S.d.stay) || S.stayKept, D = S.d = { loading: true, err: '', guest: null, details: null, companions: [], compAbsent: false, feat: null, urls: {}, urlBusy: '', stay: null };
    S.stayKept = prev || null; // so a reload that fails still hands the count draft to Try again
    S.cOpen = ''; S.addComp = false; S.edit = null; S.add = null; S.msg = null; S.err = ''; S.cerr = ''; S.confirm = null; S.cbusy = ''; G_paint();
    var one = G_one;
    return Promise.all([
      one(S.client.from('guests').select('id,name,phone,email,tier,total_stays,last_stay_date,property_id').eq('id', id).maybeSingle()),
      one(S.client.from('guest_profile_details').select(G_PROFILE_COLS).eq('guest_id', id).maybeSingle()),
      G_rpc('list_guest_companions_v1', { p_guest_id: id }, G_COMP_COLS),
      G_call({ action: 'context', guest_id: id }),
      G_rpc('staff_guest_stay_v1', { p_property: S.pid || G_FALLBACK_PROPERTY, p_guest_id: id })
    ]).then(function (rs) {
      if (!G_live(tok) || S.d !== D) return;
      D.loading = false;
      var g = rs[0], p = rs[1], c = rs[2], f = rs[3];
      if (g.error) { D.err = 'No connection, so this guest could not load.'; G_paint(); return; }
      if (!g.data) { D.err = G_errText(404, 'guest_not_found'); G_paint(); return; }
      D.guest = g.data; D.details = p.error ? null : p.data || null; D.detailsOk = !p.error;
      if (c.error) { if (G_absent(c.error)) D.compAbsent = true; else D.cErr = true; }
      else D.companions = G_comps(c.data); // the ID number is dropped here, never shown
      // The function answers with the keys it understands; an older deployment answers 400 and the new actions stay hidden.
      D.feat = f.status === 200 && f.j && f.j.features ? f.j.features : f.status === 0 ? { guest_id: true, preferences: true, replace_id: true, remove_id: true } : null;
      var sr = rs[4], own = G_ownComp(); // s120: a missing function, an error or null leaves the card out, never an error line
      D.stay = sr && !sr.error && sr.data ? G_stayFrom(Array.isArray(sr.data) ? sr.data[0] : sr.data, 1 + D.companions.filter(function (x) { return x !== own; }).length) : null;
      if (D.stay) S.stayKept = null; // a failed reload leaves it for Try again (the returns above); a loaded page is the new baseline
      if (prev && D.stay && D.stay.uid === prev.uid && prev.draft !== prev.base) { D.stay.draft = prev.draft; D.stay.key = prev.key; D.stay.keyN = prev.keyN; } // a reload of the same stay (a photo removal, a retry) keeps the number staff set and not yet saved
      G_paint(); if (S.seg === 'stay' && D.stay) G_showStay(); else G_focus('G_h');
      S.seg = ''; // the stay segment applies to the first open only; a reload after Add from text or a retry opens the top
      G_loadRot(D.companions.map(function (x) { return x.id_photo_path; }).filter(Boolean), tok);
    });
  }
  // #guests/<id>/stay (the Today Guests tile): the card is scrolled to and focused; its own scroll margins keep it clear of the app bar and the tab bar.
  function G_comps(rows) { return (rows || []).map(function (x) { return { id: x.id, name: x.name, id_type: x.id_type || null, id_photo_path: x.id_photo_path || null }; }); }
  function G_showStay() { var e = G_q('G_stay'); if (!e) return; if (e.focus) e.focus({ preventScroll: true }); if (e.scrollIntoView) e.scrollIntoView({ block: 'start' }); }
  // s91: saved turns (owner/admin) come in one batched call and win over the auto guess; a missing function or an error leaves the auto guess alone.
  function G_loadRot(paths, tok) {
    var need = paths.filter(function (p) { return G_rotSaved[p] === undefined; }); if (!need.length) return;
    var ep = G_epoch;
    G_rpc('staff_photo_rotation_v1', { p_paths: need.slice(0, 50) }).then(function (r) {
      if (ep !== G_epoch || !G_live(tok) || r.error || !Array.isArray(r.data)) return;
      var any = false;
      r.data.forEach(function (x) { if (x && x.path && x.rotation != null && [0, 90, 180, 270].indexOf(Number(x.rotation)) >= 0) { G_rotSaved[x.path] = G_rot[x.path] = Number(x.rotation); any = true; } });
      if (any) G_rotApply();
    });
  }
  // A late answer turns the photos already on screen in place; the page is not redrawn, so a focused stepper button and an open More details stay as they are.
  function G_rotApply() {
    var list = S && S.el && S.el.querySelectorAll ? S.el.querySelectorAll('[data-path]') : []; if (!list) return;
    Array.prototype.forEach.call(list, function (n) {
      var d = G_rot[n.getAttribute('data-path')] || 0, cl = n.classList; if (!cl) return;
      [90, 180, 270].forEach(function (k) { if (k === d) cl.add('G_r' + k); else cl.remove('G_r' + k); });
    });
  }

  // ------------------------------------------------------------------------------------------------ actions
  function G_openEdit() {
    if (!S.d.detailsOk) return;
    var p = S.d.details || {};
    S.edit = { contact_number: p.contact_number || S.d.guest.phone || '', birthday: p.birthday || '', stay_preferences: p.stay_preferences || '', tags: (p.tags || []).join(', '), vip: !!p.vip, vip_reason: p.vip_reason || '', reason: G_REASON_EDIT, err: '' };
    S.msg = null; S.err = ''; G_paint(); G_focus('G_f_phone');
  }
  function G_readEdit() {
    var E = S.edit;
    E.contact_number = G_val('G_f_phone'); E.birthday = G_val('G_f_bday'); E.stay_preferences = G_val('G_f_pref'); E.tags = G_val('G_f_tags');
    if (E.vip && G_q('G_f_vipr')) E.vip_reason = G_val('G_f_vipr'); E.reason = G_val('G_f_reason');
  }
  function G_saveEdit() {
    if (!S.d.detailsOk || S.d.stale) return; // no version to send, or the page is out of date until Cancel reloads it
    G_readEdit();
    var E = S.edit, p = S.d.details || {}, tok = S.token;
    var form = { contact_number: E.contact_number, birthday: E.birthday, stay_preferences: E.stay_preferences, tags: G_tagsFromText(E.tags), vip: E.vip, vip_reason: E.vip ? E.vip_reason : '' };
    var bad = G_check(form, E.reason, G_today());
    if (bad) { E.err = bad; G_paint(); G_focus('G_eerr'); return; }
    var base = {}; Object.keys(p).forEach(function (k) { base[k] = p[k]; }); base.contact_number = p.contact_number || S.d.guest.phone || ''; // the shown phone is the baseline, so an untouched phone is not rewritten
    var patch = G_patch(base, form);
    if (!E.vip && p.vip_reason && !('vip_reason' in patch)) patch.vip_reason = null; // turning VIP off clears its note
    if (!Object.keys(patch).length) { S.edit = null; S.msg = ['Nothing was changed.']; G_paint(); return; }
    S.busy = true; E.err = ''; G_paint();
    G_rpc('save_guest_profile_v1', { p_guest_id: S.gid, p_patch: patch, p_expected_version: p.version == null ? null : p.version, p_reason: E.reason.trim() }).then(function (r) {
      if (!G_live(tok)) return;
      S.busy = false;
      if (r.error) { var sm = G_rpcStale(r.error); if (sm) { G_stale(sm); return; } E.err = G_noAnswer(r.error) ? G_NO_CONN : G_rpcText(r.error); G_paint(); G_focusLate('G_eerr'); return; }
      var nv = r.data && r.data.version != null ? r.data.version : (p.version == null ? 1 : p.version + 1);
      var next = {}; Object.keys(p).forEach(function (k) { next[k] = p[k]; });
      Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
      next.version = nv; next.guest_id = S.gid; S.d.details = next;
      S.edit = null; S.msg = ['Saved. Changed: ' + G_names(patch).join(', ') + '.']; S.haptic('ok'); S.toast('Saved'); G_paint(); G_focus('G_msg');
    });
  }
  // After a conflict or an answer that never came, what is on screen can no longer be trusted. A form that is open locks Save and keeps its text until Cancel reloads the page; with none open the page reloads at once and keeps the sentence.
  function G_stale(msg) {
    var D = S.d, E = S.edit, A = S.add; S.busy = false; S.cbusy = '';
    if (E) { D.stale = true; E.err = msg + ' ' + G_COPY; G_paint(); G_focusLate('G_eerr'); }
    else if (A) { D.stale = true; A.step = 'review'; A.err = msg + ' ' + G_COPY; G_paint(); G_focusLate('G_aerr'); }
    else { G_loadDetail(); S.err = msg; }
  }
  function G_openAdd() { if (!S.d.detailsOk) return; S.add = { step: 'input', text: '', images: [], preparing: 0, err: '', sheet: null, lines: [] }; S.msg = null; G_paint(); G_focus('G_text'); }
  function G_closeAdd(reload) { var had = S.add; S.add = null; if (had) { had.images = []; had.text = ''; had.sheet = null; } if (reload) G_loadDetail(); else G_paint(); }
  function G_addFiles(list) {
    var A = S.add, tok = S.token; if (!A) return;
    A.text = G_val('G_text') || A.text;
    var files = Array.prototype.slice.call(list || [], 0, Math.max(0, G_MAX_IMAGES - A.images.length - A.preparing));
    if (list && list.length > files.length) A.err = G_errText(400, 'too_many_images'); else A.err = '';
    files.forEach(function (f) {
      A.preparing++;
      G_shrink(f).then(function (im) { if (G_live(tok) && S.add === A) A.images.push(im); }, function () { if (G_live(tok) && S.add === A) A.err = G_errText(400, 'bad_image'); })
        .then(function () { if (G_live(tok) && S.add === A) { A.preparing--; G_paint(); } });
    });
    G_paint();
  }
  function G_read() {
    var A = S.add, tok = S.token; if (!A) return;
    A.text = (G_val('G_text') || A.text || '').trim();
    if (!A.text && !A.images.length) { A.err = G_errText(400, 'empty'); G_paint(); G_focus('G_aerr'); return; }
    A.step = 'reading'; A.err = ''; G_paint();
    G_call({ action: 'extract', guest_id: S.gid, text: A.text || null, images: A.images.map(function (im) { return { base64: im.base64, mime: im.mime }; }) }).then(function (o) {
      if (!G_live(tok) || S.add !== A) return;
      if (o.status !== 200 || !o.j.ok) { A.step = 'input'; A.err = G_errText(o.status, o.j.error); G_paint(); G_focusLate('G_aerr'); return; }
      A.sheet = G_sheetFrom(o.j.proposal, S.d.guest.name); A.step = 'review'; G_paint(); G_focus('G_rh');
    });
  }
  var G_DETAIL_KEYS = ['phone', 'email', 'stay_preferences', 'birthday', 'tags'];
  function G_saveAdd() {
    var A = S.add, tok = S.token; if (!A || S.d.stale) return;
    if (!S.d.detailsOk) { A.err = 'The details could not load, so nothing can be saved yet. Cancel, then tap Try again.'; G_paint(); G_focus('G_aerr'); return; } // never a details write without the version it was read at
    G_syncSheet();
    var out = G_addBody(S.gid, A.sheet, A.images, S.d.guest.name, S.d.details && !A.noDetails ? S.d.details.version : null); // after the details saved once, a retry sends none and no version, so it cannot conflict with its own save
    var bad = out.error || (out.body && G_check({ birthday: out.body.birthday, tags: out.body.tags, stay_preferences: out.body.stay_preferences }, out.body.reason, G_today(), 30));
    if (bad) { A.err = bad; G_paint(); G_focus('G_aerr'); return; }
    var sentDetails = G_DETAIL_KEYS.some(function (k) { return out.body[k] != null; });
    var sentIds = A.sheet.ids.filter(function (d) { return d.on && A.images[d.image]; }); // the photos in the body, in order: the server answers one id_photo item for each
    A.step = 'saving'; A.err = ''; G_paint();
    G_call(out.body).then(function (o) {
      if (!G_live(tok) || S.add !== A) return;
      var done = (o.status === 200 || o.status === 207) && o.j.saved, sm = G_fnStale(o);
      var pf = done && o.j.saved.some(function (x) { return x && x.what === 'profile' && !x.ok; });
      if (done && o.j.ok && !pf) {
        A.lines = G_saveLines(o.j.saved); if (!A.lines.length) A.lines = ['Nothing new to save.']; A.images = []; A.text = ''; A.sheet = null; // the photos leave memory once saved or refused
        A.step = 'done'; S.haptic('ok'); G_paint(); G_focus('G_msg'); return;
      }
      if (done) { A.landed = A.landed || o.j.saved.some(function (x) { return x && x.ok; }); // something is on the record: Back would re-send it, so leaving reloads the page
        // something did not save: back to the review with the sheet and photos, the failed items listed. A photo that saved is unticked by its place; companions stay ticked, because the server matches a name it already has and adds nobody twice.
        var sv = o.j.saved, idv = sv.filter(function (x) { return x && x.what === 'id_photo'; }), ln = G_saveLines(sv).join(' ');
        if (idv.length === sentIds.length) sentIds.forEach(function (d, i) { if (idv[i].ok) d.on = false; }); // a count that does not match leaves every photo ticked: nothing is lost
        if (!pf && (!sentDetails || o.j.saved.some(function (x) { return x && x.what === 'profile' && x.ok; }))) { // the details are done or were never sent: the retry carries none
          var em = A.sheet.email, emFail = sv.some(function (x) { return x && x.what === 'email' && !x.ok && x.reason !== 'email_kept'; }); // a failed email stays in the field, and goes again
          A.noDetails = true; G_DETAIL_KEYS.forEach(function (k) { A.sheet[k] = ''; }); if (emFail) A.sheet.email = em; S.el.innerHTML = ''; // the redraw reads drawn fields back into the sheet (G_keepForm), so the old ones go first
        }
        S.haptic('warn'); A.step = 'review';
        if (sm) G_stale(ln); else { A.err = ln; G_paint(); G_focusLate('G_aerr'); }
        return;
      }
      if (sm) { G_stale(sm); return; }
      A.step = 'review'; A.err = G_errText(o.status, o.j.error); G_paint(); G_focusLate('G_aerr');
    });
  }
  function G_saveRot(path, d) {
    var tok = S.token, ep = G_epoch, cl = S.client, seq = S.rotSeq = (S.rotSeq || 0) + 1;
    var say = function (m) { if (S && G_live(tok) && seq === S.rotSeq) { S.rotMsg = m; G_paint(); G_focus('G_fullx'); } };
    // A turn is a write from the tap to the answer (G_run reads S.rot). Debounced: quick taps send one write of the last value (the server cannot commit them out of order); once it is out, taps are refused, so two calls are never in flight.
    S.rot = 1; S.rotPath = path;
    var fin = function (r) {
      if (G_live(tok)) S.rot = 0; // success, a refusal and a lost answer all end here
      if (r.error || !r.data || r.data.ok === false) return say('Could not save');
      if (ep === G_epoch) G_rotSaved[path] = d; say('Saved for everyone');
    };
    clearTimeout(G_rotTimers[path]);
    G_rotTimers[path] = setTimeout(function () {
      delete G_rotTimers[path]; if (ep !== G_epoch) return;
      if (G_live(tok)) { S.rot = 2; G_paint(); }
      G_rotCall(path, d, ep, fin, cl);
    }, 600);
  }
  // One call per photo path at a time, across pages: a call that is out keeps only the latest value waiting, and sends it once after the answer.
  function G_rotCall(path, d, ep, fin, cl) {
    var b = G_rotBusy[path]; if (b) { b.next = { d: d, fin: fin, cl: cl }; return; }
    b = G_rotBusy[path] = { next: null };
    G_rpc('set_guest_photo_rotation_v1', { p_path: path, p_rotation: d }, null, cl).then(function (r) {
      var n = b.next; if (G_rotBusy[path] === b) delete G_rotBusy[path];
      if (n && ep === G_epoch) G_rotCall(path, n.d, ep, n.fin, n.cl); // the waiting turn goes out now; the page that tapped it keeps its lock until then
      fin(r);
    });
  }
  function G_showId(id) {
    var D = S.d, c = D.companions.filter(function (x) { return x.id === id; })[0], tok = S.token; if (!c || !c.id_photo_path || D.urlBusy) return;
    if (S.demo) { S.cerr = 'Demo only. No ID photos are stored.'; G_paint(); return; }
    D.urlBusy = id; G_paint();
    G_sign(S.client, c.id_photo_path).then(function (r) {
      if (!G_live(tok)) return;
      D.urlBusy = '';
      if (!r.url) S.cerr = 'The ID photo could not be opened. Tap again in a moment.'; else S.cerr = '';
      G_paint();
    });
  }
  function G_photoChange(id, file) {
    var tok = S.token, D = S.d, gid = S.gid; if (!file || G_run() || S.edit || S.add) return;
    S.cbusy = id; S.cerr = ''; S.confirm = null; G_paint();
    G_shrink(file).then(function (im) {
      if (!G_live(tok)) return null; // left the page while the photo was being made ready: nothing is sent
      return G_call({ action: 'replace_id', guest_id: gid, companion_id: id, image: { base64: im.base64, mime: im.mime }, reason: G_REASON_PHOTO });
    }, function () { return { status: 400, j: { error: 'bad_image' } }; }).then(function (o) {
      if (!o || !G_live(tok)) return;
      var sm = G_fnStale(o);
      if ((o.status === 200 || o.status === 207) && o.j.saved) {
        S.haptic(o.j.ok ? 'ok' : 'warn'); G_forget(D, id);
        if (sm) { // a conflict: the page reloads through the stale path; the green box keeps only what saved, and the conflict is said in the red one
          var kept = G_saveLines(o.j.saved.filter(function (x) { return x && (x.ok || x.reason !== 'changed'); }));
          G_stale(sm); S.msg = kept.length ? kept : null; return;
        }
        S.msg = G_saveLines(o.j.saved);
        if (o.j.ok || o.j.saved.some(function (x) { return x && x.what === 'id_photo' && x.ok; })) { G_refreshCompanions(); return; } // the busy mark stays on until the list is read again
      } else if (sm) { G_stale(sm); return; } else S.cerr = G_errText(o.status, o.j.error);
      S.cbusy = ''; G_paint();
    });
  }
  function G_removePhoto(id) {
    var tok = S.token, D = S.d; S.cbusy = id; S.cerr = ''; S.confirm = null; G_paint();
    G_call({ action: 'remove_id', guest_id: S.gid, companion_id: id, reason: G_REASON_PHOTO }).then(function (o) {
      if (!G_live(tok)) return;
      var sm = G_fnStale(o);
      if ((o.status === 200 || o.status === 207) && o.j.saved) {
        G_forget(D, id);
        if (sm) { // a conflict: stale result first, the green box keeps only what saved (same as Replace)
          var kept = G_saveLines(o.j.saved.filter(function (x) { return x && (x.ok || x.reason !== 'changed'); }));
          G_stale(sm); S.msg = kept.length ? kept : null; return;
        }
        S.msg = G_saveLines(o.j.saved);
        if (o.j.saved.some(function (x) { return x.what === 'profile'; })) { var m = S.msg; G_loadDetail(); S.msg = m; return; } // the ID flag changed too: reload so "ID: On file" is current; no form can be open while this runs
        if (o.j.ok) { G_refreshCompanions(); return; }
      } else if (sm) { G_stale(sm); return; } else S.cerr = G_errText(o.status, o.j.error);
      S.cbusy = ''; G_paint();
    });
  }
  function G_forget(D, id) { // a replaced or removed photo must not come back from the cache
    var c = D.companions.filter(function (x) { return x.id === id; })[0]; delete D.urls[id];
    if (c && c.id_photo_path) { G_drop(c.id_photo_path); delete G_rot[c.id_photo_path]; delete G_rotSaved[c.id_photo_path]; }
  }
  function G_refreshCompanions() {
    var tok = S.token, D = S.d;
    return G_rpc('list_guest_companions_v1', { p_guest_id: S.gid }, G_COMP_COLS).then(function (c) {
      if (!G_live(tok)) return;
      S.cbusy = '';
      if (!c.error) { D.cErr = false; D.companions = G_comps(c.data); } else if (!G_absent(c.error)) D.cErr = true;
      G_paint(); G_focusLate('G_msg');
    });
  }
  function G_addComp() {
    var name = G_val('G_newc').replace(/\s+/g, ' ').trim(), tok = S.token, D = S.d;
    if (name.length < 2 || /\d{4,}/.test(name)) { S.cerr = 'Type the companion’s full name.'; G_paint(); G_focus('G_newc'); return; }
    var had = G_howMany(D.companions, name);
    S.cbusy = 'new'; S.cerr = ''; G_paint();
    G_rpc('save_guest_companion_v1', { p_guest_id: S.gid, p_companion_id: null, p_patch: { name: name }, p_expected_version: null, p_reason: G_REASON_COMP }).then(function (r) {
      if (!G_live(tok)) return;
      if (r.error) {
        var sm = G_rpcStale(r.error);
        if (sm === G_LOST) { G_checkAdded(name, had, tok); return; }
        if (sm) { G_stale(sm); return; }
        S.cbusy = ''; S.cerr = G_noAnswer(r.error) ? G_NO_CONN : G_rpcText(r.error); G_paint(); return;
      }
      S.msg = [name + ' was added.']; S.addComp = false; S.newc = ''; G_refreshCompanions();
    });
  }
  function G_howMany(list, name) { return (list || []).filter(function (x) { return G_exact(x.name, name); }).length; }
  // The add may have happened although the answer was lost: read the people again. More people with that name than before means it did, and the field clears; the same number keeps the name (also when the name was already on file).
  // When the re-read fails too, nobody knows: the page goes stale (it reloads, and Add stays out of reach until a reload works), so a second tap can never add twice.
  function G_checkAdded(name, had, tok) {
    var D = S.d;
    G_rpc('list_guest_companions_v1', { p_guest_id: S.gid }, G_COMP_COLS).then(function (c) {
      if (!G_live(tok)) return;
      if (c.error) { S.newc = ''; G_stale(G_LOST); return; }
      S.cbusy = ''; D.cErr = false; D.companions = G_comps(c.data);
      var added = G_howMany(D.companions, name) > had;
      if (added) { S.msg = [name + ' was added.']; S.addComp = false; S.newc = ''; } else S.cerr = G_LOST;
      G_paint(); G_focusLate(added ? 'G_msg' : 'G_cerr');
    });
  }
  function G_removeComp(id) {
    var tok = S.token; S.cbusy = id; S.cerr = ''; S.confirm = null; G_paint();
    G_rpc('delete_guest_companion_v1', { p_companion_id: id, p_reason: G_REASON_COMP }).then(function (r) {
      if (!G_live(tok)) return;
      if (r.error) { var sm = G_rpcStale(r.error); if (sm) { G_stale(sm); return; } S.cbusy = ''; S.cerr = G_noAnswer(r.error) ? G_NO_CONN : G_rpcText(r.error); G_paint(); return; }
      S.msg = ['The person was removed. Their ID photo is cleared by the clean-up job.']; delete S.d.urls[id]; G_refreshCompanions();
    });
  }

  // ---- This stay: stepper and save (s120, D-373). Same pattern as the Today stay save: one key per draft, the version it was read at, plain offline text.
  var G_GONE = 'This stay is no longer on the calendar.';
  // Answers that prove the save did not run (the function refused it). Any other error, including a 5xx, a gateway error or a dropped connection, may have saved.
  var G_REFUSED = ['42501', '22023'];
  function G_gtext(n) { return n + (n === 1 ? ' guest' : ' guests'); }
  // Save is offered after a change, and also while the stay holds no count and no booked number: the shown 1 is then only a guess, and a tap confirms it.
  function G_canSave(st) { return st.draft !== st.base || (st.count == null && st.booked == null); }
  function G_stayStep(by) {
    var st = S.d && S.d.stay; if (!st || st.busy) return;
    var n = st.draft + by; if (n < G_MIN_GUESTS || n > G_MAX_GUESTS) return;
    st.draft = n; st.err = ''; st.msg = '';
    if (!G_stayLive(st)) { G_paint(); G_focus(by > 0 ? 'G_ginc' : 'G_gdec'); }
  }
  function G_stayUndo() { var st = S.d && S.d.stay; if (!st || st.busy) return; st.draft = st.base; st.err = ''; st.msg = ''; if (!G_stayLive(st)) G_paint(); G_focus('G_ginc'); }
  function G_stayDone(st, msg, isErr) { st.busy = false; st.msg = isErr ? '' : msg; st.err = isErr ? msg : ''; G_stayPaint(); G_focusLate('G_stmsg'); }
  /** The card as the server holds it now, or null (nothing, an error, or the screen moved on). */
  function G_stayRead(tok, fallback) {
    return G_rpc('staff_guest_stay_v1', { p_property: S.pid || G_FALLBACK_PROPERTY, p_guest_id: S.gid }).then(function (q) {
      return G_live(tok) && !q.error && q.data ? G_stayFrom(Array.isArray(q.data) ? q.data[0] : q.data, fallback) : null;
    });
  }
  var G_OTHER = 'The card now shows a different stay from the one you changed. Check its number before you save again.';
  var G_GONE_NEXT = 'The stay you changed is no longer on the calendar. This card now shows the next stay.';
  /** After a write that may have saved: reads the card again, then hands it to ok(fresh) or none(). A different stay on the card is said plainly, never described as the one saved (a gone stay says it in its own words). */
  function G_stayAfter(tok, D, st, gone, ok, none) {
    G_stayRead(tok, st.base).then(function (fresh) {
      if (!G_live(tok)) return;
      if (fresh && fresh.uid !== st.uid && !gone) { D.stay = fresh; G_stayDone(fresh, G_OTHER, true); return; }
      if (fresh) ok(fresh); else none();
    });
  }
  function G_staySave() {
    var D = S.d, st = D && D.stay; if (!st || st.busy || !G_canSave(st)) return;
    var n = st.draft, tok = S.token, onChange = S.onChange, said = function (g) { return 'Saved. ' + G_gtext(g) + '.'; };
    if (S.demo) { st.base = st.count = n; st.version += 1; st.key = null; st.keyN = null; S.haptic('ok'); G_stayDone(st, said(n) + ' Demo only, nothing was sent.'); return; }
    if (!S.client || (root.navigator && root.navigator.onLine === false)) { G_stayDone(st, 'Needs a connection. Nothing was saved, and what you set is still here.', true); return; }
    if (!st.key || st.keyN !== n) { st.key = G_stayKey(); st.keyN = n; }
    st.busy = true; st.err = ''; st.msg = ''; G_stayPaint();
    G_rpc('set_stay_guest_count_v1', { p_property: S.pid || G_FALLBACK_PROPERTY, p_uid: st.uid, p_count: n, p_expected_version: st.version || 0, p_reason: G_REASON_COUNT, p_idempotency_key: st.key }).then(function (r) {
      var e = r.error, c = e && String(e.code || ''), stale = !!e && (c === '40001' || /stale version/i.test(String(e.message || ''))), gone = c === 'P0002';
      var refused = !!e && !stale && !gone && (G_REFUSED.indexOf(c) >= 0 || G_absent(e));
      // The server moved, or may have: Today reads again. Once per save, on success, replay, a conflict, a gone stay and any answer that cannot prove nothing changed, even when the person has left this page.
      if (!refused) { try { onChange(); } catch (x) { /* a refresh that fails must not break the save */ } }
      if (!G_live(tok)) return;
      if (stale) { // someone else moved it: show the number now on file, keep nothing of ours
        G_stayAfter(tok, D, st, false,
          function (fresh) { D.stay = fresh; G_stayDone(fresh, 'This stay was updated by someone else. It now shows ' + G_gtext(fresh.base) + '. Set it again if it is still wrong.', true); },
          function () { st.draft = st.base; G_stayDone(st, 'This stay was updated by someone else, and the latest count could not load. Reload the page to see it.', true); });
        return;
      }
      if (gone) { // the stay left the calendar: read the card again; with no stay left the card goes and the page says why
        G_stayAfter(tok, D, st, true, function (fresh) { D.stay = fresh; G_stayDone(fresh, fresh.uid !== st.uid ? G_GONE_NEXT : G_GONE, true); }, function () { D.stay = null; S.err = G_GONE; G_paint(); G_focusLate('G_err'); });
        return;
      }
      if (refused) { G_stayDone(st, (G_absent(e) ? 'Changing the number of guests is not available yet.' : c === '42501' ? 'You are not allowed to change this.' : 'Choose 1, 2 or 3 guests.') + ' Nothing was changed.', true); return; }
      if (e) { // a 5xx, a gateway error or a dropped answer may have saved: read the card again, and keep the key and the number so a second tap is safe
        G_stayAfter(tok, D, st, false,
          function (fresh) { fresh.key = st.key; fresh.keyN = st.keyN; fresh.draft = n; D.stay = fresh; G_stayDone(fresh, 'The save could not be confirmed. On file now: ' + G_gtext(fresh.base) + '. If that is not what you set, tap Save again.', true); }, // the stepper still shows the number staff set, so the message names the number on file
          function () { G_stayDone(st, 'The save could not be confirmed, and the card could not be read again. Check your signal, then tap Save again. Saving twice does not count twice.', true); });
        return;
      }
      var j = r.data || {}, got = G_clampGuests(j.guest_count) || n, ver = +j.version > 0 ? Math.round(+j.version) : st.version + 1;
      var settle = function (t, g, v, moved) { t.base = t.count = g; t.draft = g; t.version = v; t.key = null; t.keyN = null; S.haptic('ok'); G_stayDone(t, moved ? 'Your save went through earlier, and the number has since changed to ' + G_gtext(g) + '. The card shows what is on file now.' : said(g)); };
      if (j.replay === true) { // an earlier try already saved this: read the card again so what is shown is what the server holds
        G_stayAfter(tok, D, st, false, function (fresh) { D.stay = fresh; settle(fresh, fresh.base, fresh.version, fresh.base !== n); }, function () { settle(st, got, ver); });
        return;
      }
      settle(st, got, ver);
    });
  }

  // ------------------------------------------------------------------------------------------------ events
  function G_idx(t) { return +t.getAttribute('data-i'); }
  function G_onClick(ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('[data-act]'); if (!S || !t) return;
    var a = t.getAttribute('data-act'), id = t.getAttribute('data-id'), A = S.add;
    if (G_ACTS.test(a) && G_run(a === 'full-rot' && G_rotOk()) || G_NOFORM.test(a) && (S.edit || A)) return; // one write or reload at a time; nothing is queued
    if (a === 'filter') { var v = t.getAttribute('data-v'); if (S.list.filter !== v) { S.list.filter = v; G_paint(); G_loadList(false); } }
    else if (a === 'more') G_loadList(true);
    else if (a === 'list-retry') G_loadList(false);
    else if (a === 'detail-retry') G_loadDetail();
    else if (a === 'stay-dec') G_stayStep(-1);
    else if (a === 'stay-inc') G_stayStep(1);
    else if (a === 'stay-undo') G_stayUndo();
    else if (a === 'stay-save') G_staySave();
    else if (a === 'comp-open') { S.cOpen = S.cOpen === id ? '' : id; G_paint(); }
    else if (a === 'comp-add-open') { if (S.addComp && G_q('G_newc')) S.newc = G_val('G_newc'); S.addComp = !S.addComp; G_paint(); if (S.addComp) G_focus('G_newc'); }
    else if (a === 'edit') G_openEdit();
    else if (a === 'edit-cancel') { S.edit = null; if (S.d.stale) G_loadDetail(); else G_paint(); }
    else if (a === 'vip') { G_readEdit(); S.edit.vip = !S.edit.vip; G_paint(); G_focus('G_f_vip'); }
    else if (a === 'save-edit') G_saveEdit();
    else if (a === 'show-id') G_showId(id);
    else if (a === 'full') { var fc = S.d.companions.filter(function (x) { return x.id === id; })[0]; S.fullPath = fc ? fc.id_photo_path : ''; S.full = (fc && G_cached(fc.id_photo_path)) || null; G_paint(); G_focus('G_fullx'); }
    else if (a === 'full-rot') { if (S.fullPath) { var rp = S.fullPath, rd = G_rot[rp] = ((G_rot[rp] || 0) + 90) % 360; S.rotMsg = ''; G_saveRot(rp, rd); G_paint(); G_focus('G_fullx'); } }
    else if (a === 'full-close') { S.full = null; G_paint(); }
    else if (a === 'remove-photo') { S.confirm = { id: id, kind: 'remove-photo' }; G_paint(); }
    else if (a === 'remove-comp') { S.confirm = { id: id, kind: 'remove-comp' }; G_paint(); }
    else if (a === 'confirm-no') { S.confirm = null; G_paint(); }
    else if (a === 'remove-photo-yes') G_removePhoto(id);
    else if (a === 'remove-comp-yes') G_removeComp(id);
    else if (a === 'add-comp') G_addComp();
    else if (a === 'add-open') G_openAdd();
    else if (a === 'add-cancel') { if (A && !S.d.stale && !A.landed && (A.text || A.images.length || G_val('G_text')) && root.confirm && !root.confirm('Leave without reading? What you pasted will be dropped.')) return; G_closeAdd(!!S.d.stale || !!(A && A.landed)); }
    else if (a === 'add-done') G_closeAdd(true);
    else if (a === 'add-back') { if (A) { G_syncSheet(); A.step = 'input'; A.err = ''; G_paint(); } }
    else if (a === 'rm-shot' && A) { A.images.splice(G_idx(t), 1); A.err = ''; G_paint(); }
    else if (a === 'read') G_read();
    else if (a === 'save-add') G_saveAdd();
    else if (A && A.sheet) {
      G_syncSheet();
      if (a === 'comp-on') { var c = A.sheet.companions[G_idx(t)]; c.on = !c.on; G_paint(); }
      else if (a === 'id-on') { var d = A.sheet.ids[G_idx(t)]; d.on = !d.on; G_paint(); }
      else if (a === 'id-yes') { var y = A.sheet.ids[G_idx(t)]; y.yes = !y.yes; G_paint(); }
    }
  }
  function G_onChange(ev) {
    var t = ev.target; if (!S || !t || !t.getAttribute) return;
    var pick = t.getAttribute('data-pick');
    if (pick === 'shot') { if (!G_run()) G_addFiles(t.files); t.value = ''; } // while a read or a save runs the photos stay as they are: the proposal points at them by place
    else if (pick === 'replace') { G_photoChange(t.getAttribute('data-id'), t.files && t.files[0]); t.value = ''; }
    else if (t.getAttribute('data-act-change') === 'id-own' && S.add && S.add.sheet) { G_syncSheet(); var d = S.add.sheet.ids[G_idx(t)]; if (d && !d.own) d.yes = false; G_paint(); }
  }
  var G_timer = null;
  function G_onInput(ev) {
    var t = ev.target; if (!S || !t) return;
    if (t.id === 'G_q') {
      S.list.q = t.value;
      if (G_timer) clearTimeout(G_timer);
      G_timer = setTimeout(function () { G_timer = null; if (S && S.view === 'list') G_loadList(false); }, 300);
    } else if (t.id === 'G_text' && S.add) S.add.text = t.value;
  }
  function G_onKey(ev) { if (S && S.full && ev.key === 'Escape') { S.full = null; G_paint(); } }

  // ------------------------------------------------------------------------------------------------ mount
  var G_DEMO_IDS = ['00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2'];
  function G_demoRows() { // built at mount so the dates sit around today
    var t = G_today(), at = function (n) { return G_iso(Date.parse(t + 'T00:00:00Z') + n * 86400000); };
    return [
      { id: G_DEMO_IDS[0], name: 'Demo Guest One', tier: 'returning', total_stays: 2, last_stay_date: at(-1), phone: '0900-000-0000', guest_profile_details: { id_on_file: true, birthday: null, vip: false }, guest_companions: [{ id_photo_path: 'demo/id-1.jpg' }, { id_photo_path: null }],
        stay: { uid: 'demo-stay-1', checkin_date: at(-1), checkout_date: at(2), booked_guests: 2, guest_count: null, version: 0 },
        people: [{ id: 'demo-c1', name: 'Demo Guest One', id_type: null, id_photo_path: 'demo/id-1.jpg' }, { id: 'demo-c2', name: 'Demo Companion', id_type: null, id_photo_path: null }] },
      { id: G_DEMO_IDS[1], name: 'Demo Guest Two', tier: 'vip', total_stays: 8, last_stay_date: at(2), guest_profile_details: { id_on_file: false, birthday: null, vip: true }, guest_companions: [{ id_photo_path: null }],
        stay: { uid: 'demo-stay-2', checkin_date: at(2), checkout_date: at(5), booked_guests: 3, guest_count: 2, version: 1 },
        people: [{ id: 'demo-c3', name: 'Demo Friend', id_type: null, id_photo_path: null }] }
    ];
  }
  function G_mount(el, opts) {
    G_unmount();
    opts = opts || {};
    var parts = String(opts.sub || '').split('/'), sub = parts[0], uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sub) ? sub.toLowerCase() : '';
    S = {
      el: el, client: opts.client || null, demo: !!opts.demo, role: opts.role, pid: opts.propertyId || null, token: ++G_seq, gid: uuid, view: uuid ? 'detail' : 'list', seg: uuid && parts[1] === 'stay' ? 'stay' : '', ttl: '',
      setTitle: typeof opts.setTitle === 'function' ? opts.setTitle : G_noop, onChange: typeof opts.onChange === 'function' ? opts.onChange : G_noop,
      nav: typeof opts.navigate === 'function' ? opts.navigate : G_noop, toast: typeof opts.toast === 'function' ? opts.toast : G_noop, haptic: typeof opts.haptic === 'function' ? opts.haptic : G_noop,
      list: { q: '', filter: 'recent', rows: [], total: 0, more: false, loading: false, err: '', ticket: 0, stays: { ok: false, map: {} } },
      d: null, cOpen: '', addComp: false, newc: '', edit: null, add: null, msg: null, err: '', cerr: '', confirm: null, cbusy: '', busy: false, full: null
    };
    if (S.role !== 'owner' && S.role !== 'admin') { G_paint(); return; }
    el.addEventListener('click', G_onClick); el.addEventListener('change', G_onChange); el.addEventListener('input', G_onInput); el.addEventListener('keydown', G_onKey); el.addEventListener('load', G_onImg, true); el.addEventListener('error', G_onImgErr, true);
    if (S.demo || !S.client) {
      if (!S.demo) { el.innerHTML = '<div class="G_root">' + G_err('No connection, so Guests could not open.') + '</div>'; return; }
      var DEMO = G_demoRows(); S.list.rows = DEMO; S.list.total = DEMO.length;
      if (uuid) { // invented people and the feature flags, so every block shows: Guest ID (with and without a photo), Add ID photo, People, Add from text. Nothing here touches storage.
        var g = DEMO.filter(function (x) { return x.id === uuid; })[0], ppl = g ? g.people : [];
        S.d = { loading: false, err: g ? '' : G_errText(404, 'guest_not_found'), guest: g, details: g ? g.guest_profile_details : null, detailsOk: true, companions: ppl, compAbsent: false, feat: { guest_id: true, preferences: true, replace_id: true, remove_id: true }, urls: {}, urlBusy: '', stay: g ? G_stayFrom(g.stay, ppl.length) : null };
      }
      G_paint(); if (uuid && S.seg === 'stay' && S.d.stay) G_showStay(); S.seg = ''; return;
    }
    if (uuid) G_loadDetail();
    else { G_paint(); G_loadStays(); G_loadList(false); }
  }
  // An ID is a landscape card: a photo that loads taller than wide with no EXIF turn is shown turned 270 degrees unless a turn was saved for it (the Rotate button fixes the rest; owner/admin saves it).
  function G_onImg(ev) {
    var im = ev && ev.target, b = im && im.closest && im.closest('[data-path]'), path = b && b.getAttribute('data-path');
    if (!path || !im.naturalWidth || G_rot[path] !== undefined || im.naturalHeight <= im.naturalWidth * 1.05) return;
    G_rot[path] = 270; if (b.classList) b.classList.add('G_r270'); // counter-clockwise (s91): the clockwise guess was upside down on a real phone
  }
  function G_onImgErr(ev) { // a photo that will not show: forget it so the Show ID photo button comes back
    var im = ev && ev.target, b = im && im.closest && im.closest('[data-path]'), path = b && b.getAttribute('data-path');
    if (path && S) { G_drop(path); G_paint(); }
  }
  function G_unmount() {
    if (!S) return;
    var el = S.el; if (G_timer) { clearTimeout(G_timer); G_timer = null; }
    try { el.removeEventListener('click', G_onClick); el.removeEventListener('change', G_onChange); el.removeEventListener('input', G_onInput); el.removeEventListener('keydown', G_onKey); el.removeEventListener('load', G_onImg, true); el.removeEventListener('error', G_onImgErr, true); } catch (e) { /* the screen is going away */ }
    S.token = -1; S = null; // guest data, signed photo links and chosen photos leave memory here
  }

  root.G_Guests = {
    mount: G_mount, unmount: G_unmount, reset: G_reset, _setClock: function (f) { G_clock = f; },
    _t: { searchPattern: G_searchPattern, daysToBirthday: G_daysToBirthday, stayMap: G_stayMap, tagsFromText: G_tagsFromText, check: G_check, patch: G_patch, sameName: G_sameName,
      errText: G_errText, rpcText: G_rpcText, absent: G_absent, saveLines: G_saveLines, stayLine: G_stayLine, stayFrom: G_stayFrom, sheetFrom: G_sheetFrom, addBody: G_addBody, today: G_today },
    _state: function () { return S; }, _onImg: G_onImg, _onImgErr: G_onImgErr
  };
})(typeof window !== 'undefined' ? window : this);
