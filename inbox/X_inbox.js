/* Cascade Staff 3.2, lane X: Inbox. A native Messenger inbox for owner and admin: the list of Cassy conversations, the thread, a reply with the
   window countdown, a Cassy draft, "Let Cassy answer again", and a "tell me on this phone" switch. Reads and writes the SAME server data as the
   dashboard's Conversations page (admin-dashboard/app/src/features/guests/conversations-*.ts), through the same RPCs and Edge Functions.
   Telegram keeps running in parallel. Mounted by the shell: window.X_Inbox.mount(el, { client, demo, role, sub, propertyId, navigate, toast,
   haptic, pushKey, swReg }) at #inbox (sub '') and #inbox/<psid> (sub = psid); the shell re-mounts on a hash change.
   Guest text lives in memory only: nothing here writes it to storage, a log or a URL (the psid is the one thing in the hash).
   Only localStorage key: cs_x_filter. No build step; plain script; every top-level name is inside this closure. */
(function () {
  'use strict';

  // ------------------------------------------------------------------------------------------------ constants and pure helpers (tested)
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var HOUR = 3600000, DAY = 86400000;
  var REPLY_WINDOW_HOURS = 168;                    // conversations-window.ts:11 - 7 days with Meta's Human Agent tag; host-reply logic.ts:13 enforces it again
  var WINDOW_MS = REPLY_WINDOW_HOURS * HOUR;
  var MAX_TEXT = 1900;                             // host-reply logic.ts:14
  var NEAR_LIMIT = 1700, HISTORY_CAP = 32;         // count shows from 1,700; the server keeps 32 turns (logic.ts:15)
  var DRAFT_MAX = 4000;                            // guest-reply-draft logic.ts MAX_TEXT
  var HOST_HOLD_DAYS = 30;                         // D-317, messenger.ts HOST_HOLD_MS
  var HOST_SIGNOFF = /\n\n— .{1,40}, Cascade Hideaway\s*$/; // conversations-window.ts:9
  var MESSENGER_THREAD = 'https://www.facebook.com/messages/t/';
  var PAGE_INBOX = 'https://business.facebook.com/latest/inbox/all'; // lib.js MESSENGER_INBOX, used when window.CS is not there
  var RPC_TIMEOUT_MS = 30000, LIST_EVERY = 60000, THREAD_EVERY = 30000;
  var PSID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
  var DROPPED = 'The connection dropped before an answer came.';
  var NOT_SENT_OFFLINE = 'You are offline, so nothing was sent.';
  var CHECK_FIRST = 'Check Messenger before sending again.';

  var clock = function () { return Date.now(); };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function canUse(role) { return role === 'owner' || role === 'admin'; }
  function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }

  // Asia/Manila is UTC+8 with no daylight saving
  function manilaParts(ms) { var d = new Date(ms + 8 * HOUR); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
  function fmtTime(ms) { var p = manilaParts(ms), h12 = p.h % 12 || 12; return h12 + ':' + pad2(p.mi) + ' ' + (p.h >= 12 ? 'pm' : 'am'); }
  function fmtStamp(ts) { var ms = Date.parse(ts); if (!isFinite(ms)) return ''; var p = manilaParts(ms); return p.d + ' ' + MON[p.mo] + ', ' + fmtTime(ms); }
  function dayKey(ms) { var p = manilaParts(ms); return p.y * 10000 + p.mo * 100 + p.d; }
  function fmtListTime(ts, nowMs) { // today: the time; yesterday: the word; older: the date
    var ms = Date.parse(ts); if (!isFinite(ms)) return '';
    if (dayKey(ms) === dayKey(nowMs)) return fmtTime(ms);
    if (dayKey(ms) === dayKey(nowMs - DAY)) return 'Yesterday';
    var p = manilaParts(ms); return p.d + ' ' + MON[p.mo];
  }

  // ---- the reply window: a port of conversations-window.ts (pinned to its fixture cases in tests) ----
  function replyWindow(history, nowMs, windowMs) {
    var last = 0, w = windowMs == null ? WINDOW_MS : windowMs, list = isArr(history) ? history : [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i]; if (!t || t.role !== 'guest') continue;
      var ms = Date.parse(t.at); if (isFinite(ms) && ms > last) last = ms;
    }
    if (!last) return { open: false, lastGuestAt: null, closesAt: null, msLeft: 0 };
    var left = Math.max(0, last + w - nowMs);
    return { open: left > 0, lastGuestAt: new Date(last).toISOString(), closesAt: new Date(last + w).toISOString(), msLeft: left };
  }
  function windowLeft(msLeft) {
    if (msLeft <= 0) return null;
    var mins = Math.max(1, Math.floor(msLeft / 60000)), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (d > 0) return h ? d + ' d ' + h + ' h' : d + ' d';
    if (h > 0) return m ? h + ' h ' + m + ' min' : h + ' h';
    return m + ' min';
  }
  function windowSentence(msLeft) { var l = windowLeft(msLeft); return l ? 'You can reply for ' + l + ' more' : 'The reply window has closed'; }
  function windowLastHour(msLeft) { return msLeft > 0 && msLeft < HOUR; }
  function speakerOf(t) { if (t.role === 'guest') return 'guest'; return HOST_SIGNOFF.test(t.text == null ? '' : String(t.text)) ? 'host' : 'cassy'; }
  function turnRisk(t) { var re = t && t.route && t.route.re; return t && t.role === 'guest' && typeof re === 'string' && re && re !== 'routine' ? re : null; }
  function buildTimeline(history, handoffs) {
    var pending = (isArr(handoffs) ? handoffs.slice() : []).sort(function (a, b) { return Date.parse(a.created_at) - Date.parse(b.created_at); }), out = [];
    function flushBefore(ms) { while (pending.length && Date.parse(pending[0].created_at) < ms) { var h = pending.shift(); out.push({ kind: 'handoff', handoff: h, key: 'h-' + h.id }); } }
    (isArr(history) ? history : []).filter(function (t) { return t && typeof t.text === 'string'; }).forEach(function (t, i) {
      var ms = Date.parse(t.at); if (isFinite(ms)) flushBefore(ms);
      out.push({ kind: 'turn', turn: t, key: 't-' + i });
    });
    pending.forEach(function (h) { out.push({ kind: 'handoff', handoff: h, key: 'h-' + h.id }); });
    return out;
  }
  function newestOpenHandoff(handoffs) {
    var open = (isArr(handoffs) ? handoffs : []).filter(function (h) { return h && h.status === 'open'; });
    return open.length ? open.reduce(function (a, b) { return Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a; }) : null;
  }

  // ---- conversation state chips: glyph + words, never colour alone ----
  function holdLeft(untilTs, nowMs) { var u = Date.parse(untilTs); return isFinite(u) && u > nowMs ? u - nowMs : 0; }
  function daysLeftWords(ms) { var d = Math.ceil(ms / DAY); return d <= 1 ? (ms < DAY ? 'less than a day left' : '1 day left') : d + ' days left'; }
  function stateChips(openHandoffs, humanUntil, nowMs) {
    var out = [], hold = holdLeft(humanUntil, nowMs);
    if (openHandoffs > 0) out.push({ k: 'needs', glyph: '●', word: 'Needs you' });
    if (hold > 0) out.push({ k: 'hold', glyph: '◐', word: 'You are handling', extra: daysLeftWords(hold) });
    if (!out.length) out.push({ k: 'cassy', glyph: '○', word: 'Cassy is answering' });
    return out;
  }
  function normRow(r) {
    if (!r || typeof r.psid !== 'string' || !PSID_RE.test(r.psid)) return null;
    return { psid: r.psid, psid_short: String(r.psid_short || ''), guest_name: r.guest_name ? String(r.guest_name) : null, updated_at: r.updated_at || null, last_role: r.last_role || null,
      last_text: r.last_text == null ? '' : String(r.last_text), last_guest_at: r.last_guest_at || null, open_handoffs: Math.max(0, +r.open_handoffs || 0), human_until: r.human_until || null, last_risk: r.last_risk || null };
  }
  function normThread(t) {
    if (!t || typeof t !== 'object') return null;
    return { psid: String(t.psid || ''), psid_short: String(t.psid_short || ''), guest_name: t.guest_name ? String(t.guest_name) : null, updated_at: t.updated_at || null, human_until: t.human_until || null, last_risk: t.last_risk || null,
      history: isArr(t.history) ? t.history.filter(function (x) { return x && (x.role === 'guest' || x.role === 'bot'); }) : [], handoffs: isArr(t.handoffs) ? t.handoffs.filter(function (x) { return x && x.id; }) : [] };
  }
  function displayName(o) { return (o && o.guest_name) || 'Guest ' + (o && o.psid_short ? o.psid_short : ''); }
  // QoL: the chats that need the host come first, then the newest. Stable for equal rows.
  function sortRows(rows) {
    return (isArr(rows) ? rows : []).map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      var an = a.r.open_handoffs > 0 ? 1 : 0, bn = b.r.open_handoffs > 0 ? 1 : 0; if (an !== bn) return bn - an;
      var at = Date.parse(a.r.updated_at) || 0, bt = Date.parse(b.r.updated_at) || 0; return bt !== at ? bt - at : a.i - b.i;
    }).map(function (x) { return x.r; });
  }
  // QoL: "closes in N" on a list row, only when the window is open and under a day from closing (the rows that are about to slip away)
  function rowWindowChip(lastGuestAt, nowMs) {
    if (!lastGuestAt) return null;
    var w = replyWindow([{ role: 'guest', at: lastGuestAt }], nowMs);
    return w.open && w.msLeft < DAY ? { k: 'wclose', glyph: '◔', word: 'Reply window closes in ' + windowLeft(w.msLeft) } : null;
  }
  // QoL: quick replies. They only fill the box. House times come from the shell's setting; the fallback is defined here once (12:00 noon out, 2:00 pm in).
  var HOUSE_FALLBACK = (typeof window !== 'undefined' && window.CS && window.CS.A_HOUSE_FALLBACK) || { check_out: '12:00', check_in: '14:00' }; // the literal exists only for node tests; the shell's lib.js defines it once
  function clock12(hhmm) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); if (!m || +m[1] > 23 || +m[2] > 59) return null; var h = +m[1]; if (h === 12 && m[2] === '00') return '12:00 noon'; return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'pm' : 'am'); }
  function quickReplies(ht) {
    var out = clock12(ht && ht.check_out) || clock12(HOUSE_FALLBACK.check_out), inn = clock12(ht && ht.check_in) || clock12(HOUSE_FALLBACK.check_in);
    return [
      { label: 'Checking now', text: 'Thank you for your message. We are checking and will reply shortly.' },
      { label: 'Check-in time', text: 'Check-in starts at ' + inn + '. If you would like to arrive earlier, we will check and come back to you.' },
      { label: 'Check-out time', text: 'Check-out is at ' + out + '. If you would like a later time, we will check and come back to you.' }
    ];
  }

  // The newest run of guest messages (guests send three short ones in a row), the text Cassy drafts an answer to. Last 4,000 characters at most.
  function lastGuestText(history) {
    var list = isArr(history) ? history : [], end = list.length - 1;
    while (end >= 0 && !(list[end] && list[end].role === 'guest' && typeof list[end].text === 'string' && list[end].text.trim())) end--;
    if (end < 0) return '';
    var start = end; while (start > 0 && list[start - 1] && list[start - 1].role === 'guest' && typeof list[start - 1].text === 'string' && list[start - 1].text.trim()) start--;
    var s = list.slice(start, end + 1).map(function (t) { return t.text.trim(); }).join('\n');
    return s.length > DRAFT_MAX ? s.slice(s.length - DRAFT_MAX) : s;
  }
  // After an answer we could not read: is our reply already in the thread? (a host turn newer than sinceMs whose words start with what we sent)
  function repliedAlready(history, text, sinceMs) {
    var want = String(text || '').trim(), list = isArr(history) ? history : [];
    for (var i = list.length - 1; i >= 0; i--) {
      var t = list[i]; if (!t || t.role !== 'bot') continue;
      var ms = Date.parse(t.at); if (isFinite(ms) && ms >= sinceMs - 10 * 60000 && speakerOf(t) === 'host' && String(t.text).indexOf(want) === 0) return true;
    }
    return false;
  }

  // ---- host-reply refusals in plain words: host-reply logic.ts and conversations-api.ts:44 REPLY_ERRORS ----
  var SEND_NOTHING = {
    authentication_required: 'Sign in again, then send. Nothing was sent.',
    invalid_or_expired_session: 'Your session expired. Sign in again, then send. Nothing was sent.',
    staff_access_denied: 'Only an owner or admin can reply to guests from here. Nothing was sent.',
    explicit_send_required: 'The reply was not sent. Tap Send reply to send it.',
    invalid_text: 'Write a reply first. Nothing was sent.',
    text_too_long: 'The reply is too long for one Messenger message. Shorten it. Nothing was sent.',
    invalid_psid: 'This conversation could not be found. Nothing was sent.',
    invalid_handoff_id: 'That handoff could not be found. Refresh and try again. Nothing was sent.',
    thread_not_found: 'This conversation no longer exists. Nothing was sent.',
    handoff_not_found: 'That handoff no longer exists. Refresh and try again. Nothing was sent.',
    handoff_not_open: 'Someone already answered this handoff. Nothing was sent. The conversation was refreshed.',
    duplicate_reply: 'This exact reply was just sent, so nothing was sent again. The conversation was refreshed.',
    reply_window_closed: 'The reply window has closed. Nothing was sent. Reply from the Page inbox in Messenger instead.',
    messenger_refused: 'Messenger did not accept the reply, so nothing was sent and nothing was marked. Try again in a minute.',
    host_reply_unavailable: 'Sending is not available right now. Nothing was sent.'
  };
  // A result {status, code, net}: what to tell the host and whether the reply might have reached the guest.
  function sendOutcome(r) {
    if (r.net) return { maybe: true, text: 'The connection dropped before an answer came, so the reply may have been sent. ' + CHECK_FIRST };
    if (r.code && SEND_NOTHING[r.code]) return { maybe: false, text: SEND_NOTHING[r.code], refresh: r.code === 'handoff_not_open' || r.code === 'duplicate_reply' || r.code === 'reply_window_closed' || r.code === 'thread_not_found' || r.code === 'handoff_not_found' };
    if (r.status >= 500) return { maybe: true, text: 'The server did not answer properly, so the reply may have been sent. ' + CHECK_FIRST };
    if (r.status === 401 || r.status === 403) return { maybe: false, text: 'Your session expired or this account may not reply. Sign in again, then send. Nothing was sent.' };
    return { maybe: false, text: 'The reply was not sent.' };
  }
  // guest-reply-api.ts:31 ERRORS: the draft is read-only, so every failure says nothing was sent and a repeat is safe
  var DRAFT_ERR = {
    authentication_required: 'Sign in again, then try once more.', invalid_or_expired_session: 'Your session expired. Sign in again, then try once more.',
    staff_access_denied: 'Only owner and admin accounts can draft guest replies.', empty: 'There is no guest message to answer.',
    too_long: 'That guest message is too long to draft from.', no_guest_message: 'No guest message could be found to answer.',
    draft_failed: 'Cassy could not write a draft just now. Please try again in a minute.'
  };
  function draftError(r) {
    if (r.net) return DROPPED + ' Nothing was sent. You can ask for the draft again.';
    if (r.code && DRAFT_ERR[r.code]) return DRAFT_ERR[r.code];
    if (r.status === 401) return DRAFT_ERR.invalid_or_expired_session; if (r.status === 403) return DRAFT_ERR.staff_access_denied;
    return 'Cassy could not draft a reply this time. Please try again in a minute.';
  }
  // 1 to 3 options: response.options [{label,text}], else response.replies [text]
  function draftOptions(d) {
    var out = [];
    if (d && isArr(d.options)) d.options.forEach(function (o) { if (o && typeof o.text === 'string' && o.text.trim() && out.length < 3) out.push({ label: String(o.label || 'Draft'), text: o.text.trim() }); });
    if (!out.length && d && isArr(d.replies)) d.replies.forEach(function (t, i) { if (typeof t === 'string' && t.trim() && out.length < 3) out.push({ label: i ? 'Short' : 'Warm', text: t.trim() }); });
    return out;
  }
  function resumeOutcome(res) {
    var d = res && res.data;
    if (res && res.error) return { ok: false, text: isMissing(res.error) ? 'This is not on the server yet. Nothing changed.' : isDenied(res.error) ? 'Your account is not allowed to do this. Nothing changed.' : isOffline(res.error) ? DROPPED + ' Nothing changed. Tap again; a repeat is safe.' : 'That did not work, so nothing changed. Try again.' };
    if (d && d.ok === true) return { ok: true };
    if (d && d.outcome === 'denied') return { ok: false, text: 'Your account is not allowed to do this. Nothing changed.' };
    if (d && d.outcome === 'not_found') return { ok: false, text: 'This conversation no longer exists. Nothing changed.' };
    return { ok: false, text: 'That did not work, so nothing changed. Try again.' };
  }

  // ---- errors from the data layer ----
  function errText(e) { return String(e && (e.message || e.details || e.code) || ''); }
  function isMissing(e) { return !!e && (e.code === 'PGRST202' || e.status === 404 || /PGRST202|could not find the function|not.?found/i.test(errText(e))); }
  function isDenied(e) { return !!e && (e.code === '42501' || e.status === 401 || e.status === 403 || /only an owner|permission denied|not authori|jwt|42501/i.test(errText(e))); }
  function isOffline(e) { return !!e && !isDenied(e) && !isMissing(e) && (e.status === 0 || e.name === 'FunctionsFetchError' || /timeout|failed to fetch|network|load failed|abort/i.test(errText(e))); }

  // ---- links ----
  function threadUrl(psid) { return PSID_RE.test(String(psid || '')) ? MESSENGER_THREAD + encodeURIComponent(psid) : null; }
  function pageInboxUrl() { try { if (typeof window !== 'undefined' && window.CS && typeof window.CS.MESSENGER_INBOX === 'string') return window.CS.MESSENGER_INBOX; } catch (e) { /* use the constant */ } return PAGE_INBOX; }

  // ---- push (the card at the top of the list) ----
  function pushSupport() { // 'unsupported' | 'needs_install' (iPhone outside the Home Screen app) | 'blocked' | 'ready' - the same cases as pay/C_push.js
    var nav = typeof navigator !== 'undefined' ? navigator : {}, win = typeof window !== 'undefined' ? window : {};
    var ios = /iphone|ipad|ipod/i.test(String(nav.userAgent || ''));
    var standalone = !!(nav.standalone || (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches));
    if (ios && !standalone) return 'needs_install';
    if (!('serviceWorker' in nav) || !('PushManager' in win) || !('Notification' in win)) return 'unsupported';
    if (win.Notification && win.Notification.permission === 'denied') return 'blocked';
    return 'ready';
  }
  function keyBytes(k) {
    if (k && typeof k !== 'string') return k; // already bytes
    var s = String(k).replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4);
    var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
  function b64u(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  // pay/C_push.js:34 C_args plus the topic: the arguments of staff_push_subscribe_v1
  function subscribeArgs(sub, userAgent) {
    var j = sub.toJSON ? sub.toJSON() : {}, k = j.keys || {};
    return { p_endpoint: sub.endpoint, p_p256dh: k.p256dh || (sub.getKey ? b64u(sub.getKey('p256dh')) : ''), p_auth: k.auth || (sub.getKey ? b64u(sub.getKey('auth')) : ''), p_user_agent: String(userAgent || '').slice(0, 200), p_topics: ['inbox'] };
  }
  var PUSH_WORDS = {
    off: 'Tell me on this phone when a guest writes', on: 'You will be told on this phone when a guest writes',
    needs_install: 'To get a message on this phone, add Cascade Staff to your Home Screen first, then open it from there.',
    blocked: 'Messages are blocked for this app. Turn them on in your phone settings, then come back.',
    failed: 'That did not work, so nothing changed. Try again.', not_configured: 'Phone messages are not switched on yet. Ask Lloyd.',
    lock: 'The lock screen will say only "A guest wrote on Messenger". It never shows a name or a message.'
  };

  // ------------------------------------------------------------------------------------------------ demo data (no network)
  function demoData(nowMs) {
    var iso = function (agoMin) { return new Date(nowMs - agoMin * 60000).toISOString(); };
    var h1 = [{ role: 'guest', text: 'Hi, is early check-in possible tomorrow?', at: iso(95) }, { role: 'bot', text: 'Check-in starts at 2:00 pm. Let me ask the host about earlier.', at: iso(94) }, { role: 'guest', text: 'We land at 9 am, so anything earlier helps.', at: iso(40) }];
    var h2 = [{ role: 'guest', text: 'What is the wifi password?', at: iso(60 * 20) }, { role: 'bot', text: 'The wifi name and password are on the card by the door and in your guide.', at: iso(60 * 20 - 1) }];
    var h3 = [{ role: 'guest', text: 'Can we extend one night?', at: iso(60 * 30) }, { role: 'bot', text: 'Yes, we can look at that.\n\n— Sample Host, Cascade Hideaway', at: iso(60 * 29) }];
    var h4 = [{ role: 'guest', text: 'Thank you for the stay.', at: iso(60 * 24 * 9) }, { role: 'bot', text: 'We hope to host you again.', at: iso(60 * 24 * 9 - 2) }];
    var mk = function (psid, short, name, hist, hand, until, risk) { return { psid: psid, psid_short: short, guest_name: name, updated_at: hist[hist.length - 1].at, human_until: until, last_risk: risk || null, history: hist, handoffs: hand }; };
    var threads = [
      mk('demo-1', 'a1b2c3d4', 'Sample Guest A', h1, [{ id: 'demo-h1', status: 'open', risk: 'priority', guest_text: h1[2].text, sent_text: null, resolved_by: null, resolved_at: null, created_at: iso(39) }], null, 'priority'),
      mk('demo-2', 'b2c3d4e5', 'Sample Guest B', h2, [], null),
      mk('demo-3', 'c3d4e5f6', 'Sample Guest C', h3, [], new Date(nowMs + 29 * DAY).toISOString()),
      mk('demo-4', 'd4e5f6a7', 'Sample Guest D', h4, [], null)
    ];
    return { threads: threads };
  }
  function rowOf(t) { var last = t.history[t.history.length - 1], lg = replyWindow(t.history, clock()).lastGuestAt; return { psid: t.psid, psid_short: t.psid_short, guest_name: t.guest_name, updated_at: t.updated_at, last_role: last ? last.role : null, last_text: last ? last.text.slice(0, 160) : '', last_guest_at: lg, open_handoffs: t.handoffs.filter(function (h) { return h.status === 'open'; }).length, human_until: t.human_until, last_risk: t.last_risk }; }

  // ------------------------------------------------------------------------------------------------ mounted module
  var S = null, X_gen = 0; // state of the mounted instance; null when not mounted
  var drafts = {};         // QoL: unsent reply text per conversation, in memory only, so a draft survives a trip to the list and back (a reload or a refusal clears it)
  var pushKnown = null;    // the push card's state after the first probe (F11); cleared by reset()
  var keep = null;         //the last list read, kept in memory for two minutes so a list -> thread -> list trip paints at once (cleared on a role refusal and by reset() at sign-out)

  function ls(op, k, v) { try { var s = (typeof localStorage !== 'undefined') ? localStorage : null; if (!s) return null; return op === 'get' ? s.getItem(k) : s.setItem(k, v); } catch (e) { return null; } }
  function online() { try { return !(typeof navigator !== 'undefined' && navigator.onLine === false); } catch (e) { return true; } }
  function visible() { try { return !(typeof document !== 'undefined' && document.visibilityState === 'hidden'); } catch (e) { return true; } }
  function buzz(k) { try { if (S && S.opts.haptic) S.opts.haptic(k); } catch (e) { /* no haptics */ } }
  function tell(m) { try { if (S && S.opts.toast) S.opts.toast(m); } catch (e) { /* no toast */ } }
  function nowMs() { return clock(); }
  function setText(v) { // the one place the reply text changes; mirrors it into the in-memory drafts (max 20 chats)
    S.c.text = String(v == null ? '' : v);
    if (!S.psid) return;
    if (S.c.text) { delete drafts[S.psid]; drafts[S.psid] = S.c.text; var k = Object.keys(drafts); while (k.length > 20) delete drafts[k.shift()]; } else delete drafts[S.psid];
  }

  // One call with a 30 second limit. Resolves, never throws; a late answer is ignored. kind 'rpc' -> {data,error}; kind 'fn' -> {ok,data,status,code,net}.
  function withTimeout(start) {
    var st = S;
    return new Promise(function (resolve) {
      var done = false, t = setTimeout(function () { fin({ timeout: true }); }, RPC_TIMEOUT_MS);
      st.timers.push(t);
      function fin(r) { if (done) return; done = true; clearTimeout(t); var i = st.timers.indexOf(t); if (i >= 0) st.timers.splice(i, 1); resolve(r); }
      try { start(fin); } catch (e) { fin({ thrown: e }); }
    });
  }
  function callRpc(name, args) {
    var st = S;
    return withTimeout(function (fin) { Promise.resolve(st.client.rpc(name, args)).then(function (r) { fin(r || { data: null, error: null }); }, function (e) { fin({ data: null, error: e || { message: 'failed to fetch' } }); }); })
      .then(function (r) { return r.timeout ? { data: null, error: { message: 'timeout' } } : r.thrown ? { data: null, error: r.thrown } : r; });
  }
  // Edge Functions go through the shell client (client.functions.invoke adds the session token and key). A non-2xx answer carries the Response in error.context.
  function callFn(name, body) {
    var st = S;
    return withTimeout(function (fin) {
      Promise.resolve(st.client.functions.invoke(name, { body: body })).then(function (r) {
        r = r || {};
        if (!r.error) { var d = r.data; fin(d && d.ok === false ? { ok: false, status: 400, code: d.error, data: d } : { ok: true, status: 200, data: d }); return; }
        var ctx = r.error.context;
        if (ctx && typeof ctx.json === 'function') { Promise.resolve(ctx.json()).then(function (j) { return j || {}; }, function () { return {}; }).then(function (j) { fin({ ok: false, status: ctx.status | 0, code: j && typeof j.error === 'string' ? j.error : undefined, data: j }); }); return; }
        fin({ ok: false, status: 0, net: true, error: r.error });
      }, function (e) { fin({ ok: false, status: 0, net: true, error: e }); });
    }).then(function (r) { return r.timeout || r.thrown ? { ok: false, status: 0, net: true } : r; });
  }

  // ---- drawing: a skeleton once, then named regions (so a poll never touches the box you are typing in) ----
  var SKELETON = '<div class="X_root" data-xr="root" data-x-view="list">' +
    '<section class="X_listpane" aria-label="Conversations"><div data-xr="list"></div><div data-xr="push"></div></section>' +
    '<section class="X_threadpane" aria-label="Conversation"><div data-xr="thead"></div><div data-xr="msgs"></div>' +
    '<div class="X_comp" data-xr="compwrap" hidden><div data-xr="cwin"></div><div data-xr="ctext"></div><div data-xr="cquick"></div><div data-xr="cmsg"></div><div data-xr="cdraft"></div><div data-xr="cfoot"></div></div></section>' +
    '<div data-xr="sheet"></div><div class="X_sr" data-xr="live" role="status" aria-live="polite"></div></div>';
  function region(name) { return S && S.el.querySelector ? S.el.querySelector('[data-xr="' + name + '"]') : null; }
  function put(name, html) { var k = region(name); if (k) k.innerHTML = html; }
  function say(m) { put('live', esc(m)); }
  function focusSel(sel) { try { var k = S.el.querySelector(sel); if (k && k.focus) k.focus(); } catch (e) { /* focus is a courtesy */ } }

  function btn(act, label, cls, extra) { return '<button type="button" class="btn ' + (cls || 'btn-secondary') + ' X_btn" data-xa="' + act + '"' + (extra || '') + '>' + label + '</button>'; }
  function chip(c) { return '<span class="X_chip X_' + c.k + '"><span aria-hidden="true">' + c.glyph + '</span> ' + esc(c.word) + (c.extra ? ' <span class="X_chipx">' + esc(c.extra) + '</span>' : '') + '</span>'; }
  function note(kind, text, extra) { return '<div class="X_note X_' + kind + '" role="' + (kind === 'bad' ? 'alert' : 'status') + '">' + esc(text) + (extra || '') + '</div>'; }
  function msgLinks(psid) {
    var u = S && S.demo ? null : threadUrl(psid), out = '';
    if (u) out += '<a class="btn btn-secondary X_btn" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Open in Messenger</a>';
    return out + '<a class="btn btn-ghost X_btn" href="' + esc(pageInboxUrl()) + '" target="_blank" rel="noopener noreferrer">Open the Page inbox</a>';
  }

  // -- list --
  function visibleRows() { var rows = sortRows(S.list.rows || []); return S.filter === 'needs' ? rows.filter(function (r) { return r.open_handoffs > 0; }) : rows; }
  function drawList() {
    var L = S.list, now = nowMs(), rows = L.rows, needN = rows ? rows.filter(function (r) { return r.open_handoffs > 0; }).length : 0, h = '';
    h += '<div class="X_bar"><h1 class="X_h" tabindex="-1" data-xfocus>Inbox</h1><div class="X_barr">' + (L.at ? '<span class="X_sub">Updated ' + esc(fmtTime(L.at)) + '</span>' : '') + btn('refresh', 'Refresh', 'btn-ghost', S.busy ? ' disabled' : '') + '</div></div>';
    if (rows) {
      h += '<div class="X_seg" role="group" aria-label="Show">' +
        '<button type="button" class="X_tab" aria-pressed="' + (S.filter === 'needs') + '" data-xa="filter" data-v="needs">Needs you (' + needN + ')</button>' +
        '<button type="button" class="X_tab" aria-pressed="' + (S.filter === 'all') + '" data-xa="filter" data-v="all">All (' + rows.length + ')</button></div>';
    }
    if (L.stale && rows) h += note('warn', 'Could not refresh just now. Showing what was read at ' + (L.at ? fmtTime(L.at) : 'the last read') + '.');
    if (!rows) {
      if (L.loading) h += '<div class="X_skel" aria-hidden="true"></div><div class="X_skel" aria-hidden="true"></div><div class="X_skel" aria-hidden="true"></div>';
      else if (L.denied) h += '<div class="X_card"><h2 class="X_h3">The inbox is for owner and admin</h2><p class="X_p">Your account cannot read guest conversations.</p></div>';
      else if (L.absent) h += '<div class="X_card"><h2 class="X_h3">The inbox is not on the server yet</h2><p class="X_p">You can read the same conversations in the dashboard.</p>' + btn('dash', 'Open the conversations in the dashboard', 'btn-primary') + '</div>';
      else h += '<div class="X_card"><h2 class="X_h3">No connection</h2><p class="X_p">' + esc(L.offline ? 'You are offline, or the connection dropped.' : 'The conversations could not be read.') + '</p>' + btn('refresh', 'Try again', 'btn-primary') + '</div>';
    } else {
      var vis = visibleRows();
      if (!rows.length) h += '<div class="X_card"><h2 class="X_h3">No Messenger conversations yet</h2><p class="X_p">A chat appears here after a guest messages the Page.</p></div>';
      else if (!vis.length) h += '<div class="X_card"><h2 class="X_h3">Nothing needs you</h2><p class="X_p">Cassy is answering the rest.</p>' + btn('filter', 'Show all conversations', 'btn-secondary', ' data-v="all"') + '</div>';
      else h += '<ul class="X_rows" aria-label="Conversations">' + vis.map(function (r) { return rowHtml(r, now); }).join('') + '</ul>';
      h += '<p class="X_sub X_foot">' + msgLinksInline() + '</p>';
    }
    put('list', h);
  }
  function msgLinksInline() { return '<a class="X_link" href="' + esc(pageInboxUrl()) + '" target="_blank" rel="noopener noreferrer">Open the Page inbox</a>'; }
  function rowHtml(r, now) {
    var cs = stateChips(r.open_handoffs, r.human_until, now), cur = S.psid === r.psid, wc = rowWindowChip(r.last_guest_at, now); if (wc) cs.push(wc);
    var prev = r.last_text ? (r.last_role === 'guest' ? '' : 'Reply: ') + r.last_text : 'No messages stored';
    return '<li><button type="button" class="X_row' + (cur ? ' X_cur' : '') + '" data-xa="open" data-v="' + esc(r.psid) + '"' + (cur ? ' aria-current="true"' : '') + '>' +
      '<span class="X_rowtop"><span class="X_name">' + esc(displayName(r)) + '</span><span class="X_time">' + esc(fmtListTime(r.updated_at, now)) + '</span></span>' +
      '<span class="X_prev">' + esc(prev) + '</span><span class="X_chips">' + cs.map(chip).join('') + '</span></button></li>';
  }

  // -- thread --
  function drawThreadHead() {
    var T = S.thread, h = '';
    if (!S.psid) { put('thead', '<div class="X_empty" data-x-wide-only><h2 class="X_h3">Pick a conversation</h2><p class="X_p">The chat opens here.</p></div>'); return; }
    var d = T.data, now = nowMs();
    h += '<div class="X_back">' + btn('back', '‹ All conversations', 'btn-ghost') + '</div>';
    if (!d) {
      if (T.loading) h += '<div class="X_skel" aria-hidden="true"></div><div class="X_skel" aria-hidden="true"></div>';
      else if (T.notFound) h += '<div class="X_card"><h2 class="X_h3">This conversation no longer exists</h2><p class="X_p">It may have been cleared. Go back to the list.</p></div>';
      else if (T.denied) h += '<div class="X_card"><h2 class="X_h3">The inbox is for owner and admin</h2></div>';
      else h += '<div class="X_card"><h2 class="X_h3">No connection</h2><p class="X_p">This conversation could not be read.</p>' + btn('refresh', 'Try again', 'btn-primary') + '</div>';
      put('thead', h); return;
    }
    var open = d.handoffs.filter(function (x) { return x.status === 'open'; }).length, cs = stateChips(open, d.human_until, now), hold = holdLeft(d.human_until, now) > 0;
    h += '<div class="X_thtop"><h2 class="X_h" tabindex="-1" data-xfocus>' + esc(displayName(d)) + '</h2><span class="X_sub">Messenger ' + esc(d.psid_short) + '</span></div>';
    h += '<div class="X_chips">' + cs.map(chip).join('') + '</div>';
    h += '<div class="X_actions">' + msgLinks(d.psid) + (hold ? btn('resume', 'Let Cassy answer again', 'btn-secondary', S.busy ? ' disabled' : '') : '') + btn('refresh', 'Refresh', 'btn-ghost', S.busy ? ' disabled' : '') + '</div>';
    if (T.stale) h += note('warn', 'Could not refresh just now. Showing what was read at ' + (T.at ? fmtTime(T.at) : 'the last read') + '.');
    put('thead', h);
  }
  function handoffCard(hf) {
    var open = hf.status === 'open';
    var h = '<li class="X_hand X_hand_' + esc(hf.status) + '"><div class="X_handtop"><span class="X_chip ' + (open ? 'X_needs' : 'X_cassy') + '"><span aria-hidden="true">' + (open ? '●' : '○') + '</span> ' + (open ? 'Needs you' : 'Handoff ' + esc(hf.status)) + '</span>' +
      '<span class="X_sub">' + esc(fmtStamp(hf.created_at)) + '</span></div>';
    if (open) h += '<p class="X_p">Cassy handed this chat to you.' + (hf.risk ? ' Reason: ' + esc(hf.risk) + '.' : '') + '</p>';
    else if (hf.status === 'sent' && hf.resolved_by) h += '<p class="X_p">Answered by ' + esc(hf.resolved_by) + (hf.resolved_at ? ', ' + esc(fmtStamp(hf.resolved_at)) : '') + '.</p>';
    return h + '</li>';
  }
  function drawMsgs() {
    var d = S.thread.data; if (!S.psid || !d) { put('msgs', ''); return; }
    var items = buildTimeline(d.history, d.handoffs), h = '';
    if (d.history.length >= HISTORY_CAP) h += '<p class="X_cap">Older messages are in Messenger.</p>';
    if (!items.length) h += '<p class="X_p X_pad">No messages stored for this guest.</p>';
    h += '<ol class="X_msgs" aria-label="Messages">' + items.map(function (it) {
      if (it.kind === 'handoff') return handoffCard(it.handoff);
      var t = it.turn, who = speakerOf(t), risk = turnRisk(t), label = who === 'guest' ? 'Guest' : who === 'host' ? 'Host' : 'Cassy', ms = Date.parse(t.at);
      return '<li class="X_msg X_' + who + '"><div class="X_bub"><div class="X_who"><span>' + label + '</span><span>' + (isFinite(ms) ? esc(fmtTime(ms)) : '') + '</span>' + (risk ? '<span class="X_chip X_needs"><span aria-hidden="true">▲</span> ' + esc(risk) + '</span>' : '') + '</div><p class="X_txt">' + esc(t.text) + '</p></div></li>';
    }).join('') + '</ol>';
    put('msgs', h);
  }

  // -- composer --
  function winOf() { var d = S.thread.data; return d ? replyWindow(d.history, nowMs()) : { open: false, msLeft: 0, lastGuestAt: null, closesAt: null }; }
  function drawCompWin() {
    var d = S.thread.data; if (!d) { put('cwin', ''); return; }
    var w = winOf(), warn = windowLastHour(w.msLeft);
    var h = '<p class="X_win' + (warn ? ' X_warnt' : '') + '" id="X_win"><span aria-hidden="true">' + (warn ? '▲' : '◔') + '</span> ' + esc(windowSentence(w.msLeft)) + '</p>';
    if (!w.open) h += '<div class="X_note X_warn">' + esc(w.lastGuestAt ? 'Messenger accepts a reply only for a while after the guest\'s last message. That time ended ' + fmtStamp(w.closesAt) + '.' : 'This guest has no message on record.') + ' Reply from the Page inbox in Messenger, or wait for the guest to write again.<div class="X_actions">' + msgLinks(d.psid) + '</div></div>';
    put('cwin', h);
  }
  function drawCompText() {
    var d = S.thread.data; if (!d) { put('ctext', ''); return; }
    var w = winOf(); S.winOpen = w.open;
    put('ctext', '<label class="X_lbl" for="X_text">Reply to ' + esc(d.guest_name || 'guest') + '</label><textarea id="X_text" class="X_ta" data-xf="text" maxlength="' + MAX_TEXT + '" rows="3" aria-describedby="X_win"' + (w.open && !S.busy ? '' : ' disabled') + ' placeholder="Write the reply. Your first name is added at the end.">' + esc(S.c.text) + '</textarea>');
  }
  function drawCompQuick() {
    var show = S.thread.data && winOf().open, h = '';
    if (show) h = '<div class="X_quick" role="group" aria-label="Quick replies. They only fill the box.">' + quickReplies(S.opts.houseTimes).map(function (q, i) { return btn('quick', esc(q.label), 'btn-ghost', ' data-v="' + i + '"' + (S.busy || S.c.pending ? ' disabled' : '')); }).join('') + '</div>';
    put('cquick', h);
  }
  function drawCompMsg() {
    var m = S.c.msg, h = '';
    if (m) h = note(S.c.msgKind || 'bad', m, S.c.msgLinks ? '<div class="X_actions">' + msgLinks(S.psid) + '</div>' : '');
    put('cmsg', h);
  }
  function drawCompDraft() {
    var c = S.c, h = '';
    if (c.drafting) h = '<div class="X_note X_info" role="status">Cassy is writing options. Nothing is sent.</div>';
    else if (c.draftErr) h = note('bad', c.draftErr);
    else if (c.options) {
      h = '<div class="X_opts"><p class="X_sub">Pick one to put it in the box. You can still change it. Nothing is sent from here.</p>' + c.options.map(function (o, i) {
        return '<div class="X_opt"><strong class="X_optl">' + esc(o.label) + '</strong><p class="X_p X_pre">' + esc(o.text) + '</p>' + btn('pick', c.text.trim() && c.text.trim() !== o.text ? 'Replace my text with this' : 'Use this', 'btn-secondary', ' data-v="' + i + '"') + '</div>';
      }).join('') + btn('draft-close', 'Close the options', 'btn-ghost') + '</div>';
    }
    put('cdraft', h);
  }
  function syncComp() { drawCompWin(); drawCompFoot(); if (S.thread.data && winOf().open !== S.winOpen) { drawCompText(); drawCompQuick(); } }
  function canCompose() { var d = S.thread.data; return !!d && winOf().open && !S.c.pending; }
  function drawCompFoot() {
    var d = S.thread.data; if (!d) { put('cfoot', ''); return; }
    var c = S.c, len = c.text.length, w = winOf(), open = newestOpenHandoff(d.handoffs), hasGuest = !!lastGuestText(d.history), h = '';
    if (open) h += '<label class="X_chk"><input type="checkbox" data-xf="mark"' + (c.mark ? ' checked' : '') + (S.busy ? ' disabled' : '') + '> This answers the open handoff (' + esc(fmtStamp(open.created_at)) + ')</label>';
    h += '<div class="X_foot2">' + (len >= NEAR_LIMIT ? '<span class="X_count' + (len >= MAX_TEXT - 50 ? ' X_warnt' : '') + '" aria-live="polite">' + len + ' of ' + MAX_TEXT + ' characters</span>' : '<span></span>');
    h += '<span class="X_btns">' + btn('draft', 'Cassy draft', 'btn-secondary', !w.open || !hasGuest || c.drafting || S.busy || c.pending ? ' disabled' : '') + btn('review', 'Review and send', 'btn-primary', !w.open || !c.text.trim() || len > MAX_TEXT || S.busy || c.pending ? ' disabled' : '') + '</span></div>';
    put('cfoot', h);
  }
  function drawComposer() {
    var show = !!(S.psid && S.thread.data);
    var w = region('compwrap'); if (w) w.hidden = !show;
    drawCompWin(); drawCompText(); drawCompQuick(); drawCompMsg(); drawCompDraft(); drawCompFoot();
  }

  // -- sheet: review before send, and the confirm before "Let Cassy answer again" --
  function drawSheet() {
    var sh = S.sheet, d = S.thread.data, h = '';
    if (sh && d) {
      var box;
      if (sh.kind === 'review') {
        var open = newestOpenHandoff(d.handoffs);
        box = '<h2 class="X_h3" id="X_sh" tabindex="-1" data-xfocus>Check before you send</h2><p class="X_sub">To ' + esc(displayName(d)) + ' on Messenger. This is the exact text.</p>' +
          '<blockquote class="X_quote">' + esc(S.c.text.trim()) + '</blockquote><p class="X_sub">Your first name and Cascade Hideaway are added at the end.</p>' +
          (open && S.c.mark ? '<p class="X_sub">This also marks the open handoff as answered.</p>' : '') +
          '<div class="X_note X_warn">You are replying as the host. Cassy stays quiet in this chat for ' + HOST_HOLD_DAYS + ' days.</div>' +
          (sh.msg ? note('bad', sh.msg) : '') +
          '<div class="X_btns2">' + btn('edit', 'Edit', 'btn-secondary', S.busy ? ' disabled' : '') + btn('send', S.busy ? 'Sending' : 'Send reply', 'btn-primary', S.busy ? ' disabled aria-busy="true"' : '') + '</div>';
      } else {
        box = '<h2 class="X_h3" id="X_sh" tabindex="-1" data-xfocus>Let Cassy answer again</h2><p class="X_p">Cassy will answer ' + esc(displayName(d)) + ' again from their next message. Your reply and this conversation stay as they are.</p>' +
          (sh.msg ? note('bad', sh.msg) : '') + '<div class="X_btns2">' + btn('sheet-x', 'Cancel', 'btn-secondary', S.busy ? ' disabled' : '') + btn('resume-go', S.busy ? 'Working' : 'Let Cassy answer again', 'btn-primary', S.busy ? ' disabled aria-busy="true"' : '') + '</div>';
      }
      h = '<div class="X_scrim" data-xa="sheet-x"></div><div class="X_sheet" role="dialog" aria-modal="true" aria-labelledby="X_sh">' + box + '</div>';
    }
    put('sheet', h);
  }

  // -- push card --
  function drawPush() {
    var p = S.push, st = p.state, h = '';
    if (!st || st === 'hidden') { put('push', ''); return; }
    var on = st === 'on';
    h = '<div class="X_card X_pushcard"><div class="X_pushtop"><div><h2 class="X_h3">' + esc(on ? PUSH_WORDS.on : PUSH_WORDS.off) + '</h2>' +
      '<p class="X_sub"><span aria-hidden="true">' + (on ? '●' : '○') + '</span> ' + (on ? 'On' : 'Off') + '</p></div>';
    if (st === 'on' || st === 'off') h += '<button type="button" class="btn ' + (on ? 'btn-secondary' : 'btn-primary') + ' X_btn" data-xa="push" aria-pressed="' + on + '"' + (p.busy ? ' disabled aria-busy="true"' : '') + '>' + (on ? 'Turn off' : 'Turn on') + '</button>';
    h += '</div>';
    if (st === 'needs_install' || st === 'blocked') h += '<p class="X_p">' + esc(PUSH_WORDS[st]) + '</p>';
    else h += '<p class="X_sub">' + esc(PUSH_WORDS.lock) + '</p>';
    if (p.msg) h += note('bad', p.msg);
    put('push', h + '</div>');
  }

  function setView() { var r = region('root'); if (r && r.setAttribute) r.setAttribute('data-x-view', S.psid ? 'thread' : 'list'); }
  function drawAll() { setView(); drawList(); drawPush(); drawThreadHead(); drawMsgs(); drawComposer(); drawSheet(); }

  // ------------------------------------------------------------------------------------------------ loading
  function loadList(quiet) {
    var st = S, L = S.list, gen = S.gen;
    if (L.busy) return Promise.resolve();
    L.busy = true; if (!L.rows && !quiet) { L.loading = true; drawList(); }
    var done = function (rows, err) {
      if (!S || S.gen !== gen) return;
      L.busy = false; L.loading = false;
      if (rows) { L.rows = rows; L.at = nowMs(); L.stale = false; L.denied = L.absent = L.offline = false; keep = { rows: rows, at: L.at, role: st.role }; }
      else if (err && isDenied(err)) { L.rows = null; L.denied = true; L.absent = L.offline = false; drafts = {}; keep = null; } // a refusal drops everything read before it
      else if (L.rows) { L.stale = true; }
      else { L.denied = !!(err && isDenied(err)); if (L.denied) { drafts = {}; keep = null; } L.absent = !!(err && isMissing(err)); L.offline = !!(err && isOffline(err)) || !online(); }
      drawList();
    };
    if (S.demo) return Promise.resolve().then(function () { done(S.demoThreads.map(rowOf)); });
    if (!S.client || !online()) { done(null, { message: 'offline' }); return Promise.resolve(); }
    return callRpc('concierge_conversations_v1', { p_limit: 50 }).then(function (res) { // conversations-api.ts:25
      if (res.error) { done(null, res.error); return; }
      done(isArr(res.data) ? res.data.map(normRow).filter(Boolean) : []);
    });
  }
  function loadThread(quiet) {
    if (!S.psid) return Promise.resolve();
    var T = S.thread, psid = S.psid, gen = S.gen;
    if (T.busy) return Promise.resolve();
    T.busy = true; if (!T.data && !quiet) { T.loading = true; drawThreadHead(); }
    var done = function (data, err, missing) {
      if (!S || S.gen !== gen || S.psid !== psid) return;
      T.busy = false; T.loading = false;
      if (data) {
        var first = !T.data, sig = data.history.length + '|' + (data.history.length ? data.history[data.history.length - 1].at : '') + '|' + data.handoffs.map(function (h) { return h.id + h.status; }).join(',') + '|' + data.human_until;
        T.data = data; T.at = nowMs(); T.stale = false; T.notFound = T.denied = false;
        var changed = sig !== T.sig; T.sig = sig;
        if (changed || first) { drawThreadHead(); drawMsgs(); drawCompWin(); drawCompFoot(); if (first) { drawComposer(); scrollEnd(); } }
        else drawThreadHead();
        syncComp(); // the box is rebuilt only when it must change (the window opened or closed): never under your fingers
        if (S.c.pending) { // an uncertain send: this read settles it. Sending stays off until then.
          if (repliedAlready(data.history, S.c.pending.text, S.c.pending.since)) { setText(''); S.c.msg = 'Your reply is in the conversation, so it was sent.'; S.c.msgKind = 'ok'; S.c.msgLinks = false; S.c.options = null; S.c.pending = null; drawCompText(); drawCompMsg(); drawCompDraft(); }
          else S.c.pending = null; // not on record: the message above stays, sending is allowed again
          drawCompQuick(); drawCompFoot();
        }
      } else if (missing) { T.data = null; T.notFound = true; drawThreadHead(); drawMsgs(); drawComposer(); }
      else if (T.data) { T.stale = true; drawThreadHead(); }
      else { T.denied = !!(err && isDenied(err)); if (T.denied) { drafts = {}; keep = null; } drawThreadHead(); }
    };
    if (S.demo) return Promise.resolve().then(function () { var t = S.demoThreads.filter(function (x) { return x.psid === psid; })[0]; if (t) done(normThread(JSON.parse(JSON.stringify(t)))); else done(null, null, true); });
    if (!S.client || !online()) { done(null, { message: 'offline' }); return Promise.resolve(); }
    return callRpc('concierge_thread_v1', { p_psid: psid }).then(function (res) { // conversations-api.ts:29
      if (res.error) { done(null, res.error); return; }
      var t = normThread(res.data); if (!t) done(null, null, true); else done(t);
    });
  }
  function scrollEnd() { try { if (typeof window !== 'undefined' && window.scrollTo && typeof document !== 'undefined' && document.documentElement) window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) { /* no scrolling in tests */ } }

  // one 30 second tick: the thread every time, the list every 60 seconds; paused while the page is hidden or a write is in flight
  function schedule() { if (!S) return; if (S.tick) clearTimeout(S.tick); S.tick = setTimeout(onTick, THREAD_EVERY); if (S.tick && S.tick.unref) S.tick.unref(); }
  function onTick() {
    if (!S) return; S.tick = null;
    if (!visible()) return; // paused; the visibility handler restarts it
    if (!S.busy) {
      if (S.psid) { loadThread(true); syncComp(); }
      if (nowMs() - (S.list.at || 0) >= LIST_EVERY - 5000) loadList(true);
    }
    schedule();
  }
  function onVis() {
    if (!S) return;
    if (!visible()) { if (S.tick) { clearTimeout(S.tick); S.tick = null; } return; }
    if (!S.busy) { loadList(true); if (S.psid) loadThread(true); }
    schedule();
  }
  function refreshAll() { if (S.busy) return; loadList(true); if (S.psid) loadThread(true); }

  // ------------------------------------------------------------------------------------------------ writes
  function setBusy(v) { S.busy = v; drawSheet(); drawCompFoot(); drawCompText(); drawThreadHead(); drawList(); }

  function doSend() {
    var c = S.c, d = S.thread.data, sh = S.sheet; if (S.busy || !sh || sh.kind !== 'review' || !d) return;
    var text = c.text.trim(); if (!text || text.length > MAX_TEXT) return;
    if (!S.demo && !online()) { sh.msg = NOT_SENT_OFFLINE; drawSheet(); return; }
    var open = newestOpenHandoff(d.handoffs), body = { action: 'send', psid: d.psid, text: text }; // host-reply logic.ts:92 - handoff_id only when there is an open one and it is ticked
    if (open && c.mark) body.handoff_id = open.id;
    var gen = S.gen, since = nowMs(); sh.msg = ''; setBusy(true);
    var finish = function (r) {
      if (!S || S.gen !== gen) return;
      if (r.ok) {
        var recorded = r.data && r.data.recorded !== false;
        if (recorded) { d.history = d.history.concat([{ role: 'bot', text: String(r.data.sent_text || text), at: new Date(nowMs()).toISOString() }]); S.thread.sig = null; }
        d.human_until = new Date(nowMs() + HOST_HOLD_DAYS * DAY).toISOString();
        if (body.handoff_id) d.handoffs = d.handoffs.map(function (h) { return h.id === body.handoff_id ? Object.assign({}, h, { status: 'sent' }) : h; });
        setText(''); c.options = null; c.draftErr = ''; c.pending = null; c.msg = recorded ? '' : 'The reply was sent, but it could not be saved in the conversation history. It is in Messenger.'; c.msgKind = recorded ? '' : 'warn'; c.msgLinks = !recorded;
        S.sheet = null; S.busy = false; buzz('success'); tell('Reply sent. Cassy stays quiet in this chat for ' + HOST_HOLD_DAYS + ' days.'); say('Reply sent');
        drawAll(); scrollEnd(); focusSel('#X_text');
        if (S.demo) { var t = S.demoThreads.filter(function (x) { return x.psid === d.psid; })[0]; if (t) { t.history = d.history.slice(); t.human_until = d.human_until; t.handoffs = d.handoffs.map(function (h) { return Object.assign({}, h); }); t.updated_at = new Date(nowMs()).toISOString(); } }
        S.thread.sig = null; loadList(true); loadThread(true); return;
      }
      var o = sendOutcome(r);
      S.busy = false; S.sheet = null; c.msg = o.text; c.msgKind = o.maybe ? 'warn' : 'bad'; c.msgLinks = o.maybe || r.code === 'reply_window_closed'; c.pending = o.maybe ? { text: text, since: since } : null;
      buzz('error'); drawAll();
      if (o.maybe || o.refresh) { S.thread.sig = null; loadThread(true); loadList(true); } // read what is on record so the host sees whether it went out
    };
    if (S.demo) { Promise.resolve().then(function () { finish({ ok: true, data: { ok: true, sent_text: text + '\n\n— Sample Host, Cascade Hideaway', recorded: true, handoff_marked: !!body.handoff_id } }); }); return; }
    callFn('host-reply', body).then(finish);
  }

  function doDraft() {
    var c = S.c, d = S.thread.data; if (S.busy || c.drafting || c.pending || !d || !winOf().open) return;
    var text = lastGuestText(d.history); if (!text) return;
    if (!S.demo && !online()) { c.draftErr = 'You are offline. Nothing was sent. Try again when you are back online.'; drawCompDraft(); return; }
    var gen = S.gen, psid = S.psid, body = { text: text, platform: 'messenger' };
    if (d.guest_name) body.guest_name = d.guest_name.slice(0, 80);
    c.drafting = true; c.draftErr = ''; c.options = null; drawCompDraft(); drawCompFoot();
    var finish = function (r) {
      if (!S || S.gen !== gen || S.psid !== psid) return;
      c.drafting = false;
      if (r.ok) { var o = draftOptions(r.data); if (o.length) c.options = o; else c.draftErr = DRAFT_ERR.draft_failed; } else c.draftErr = draftError(r);
      drawCompDraft(); drawCompFoot(); if (c.options) say(c.options.length + ' draft options ready');
    };
    if (S.demo) { Promise.resolve().then(function () { finish({ ok: true, data: { options: [{ label: 'Short', text: 'Thank you for asking. We will confirm early check-in as soon as we can.' }, { label: 'Warm', text: 'Thank you for telling us. We will do our best to have the room ready for you early and will let you know soon.' }] } }); }); return; }
    callFn('guest-reply-draft', body).then(finish); // guest-reply-api.ts:55 - text, guest_name, platform
  }

  function doResume() {
    var sh = S.sheet, d = S.thread.data; if (S.busy || !sh || sh.kind !== 'resume' || !d) return;
    if (!S.demo && !online()) { sh.msg = 'You are offline, so nothing changed.'; drawSheet(); return; }
    var gen = S.gen, psid = d.psid; sh.msg = ''; setBusy(true);
    var finish = function (res) {
      if (!S || S.gen !== gen) return;
      var o = resumeOutcome(res);
      S.busy = false;
      if (o.ok) {
        S.sheet = null; d.human_until = null; buzz('success'); tell('Cassy will answer this guest again from their next message.'); say('Cassy will answer again');
        if (S.demo) { var t = S.demoThreads.filter(function (x) { return x.psid === psid; })[0]; if (t) t.human_until = null; }
        S.thread.sig = null; drawAll(); focusSel('[data-xfocus]'); loadThread(true); loadList(true); return;
      }
      sh.msg = o.text; buzz('error'); drawSheet(); drawThreadHead(); drawList();
    };
    if (S.demo) { Promise.resolve().then(function () { finish({ data: { ok: true, outcome: 'resumed' } }); }); return; }
    callRpc('concierge_resume_cassy_v1', { p_psid: psid }).then(finish); // conversations-api.ts:40
  }

  // ---- push: probe, enable, disable ----
  var DUMMY_ENDPOINT = 'https://probe.invalid/x';
  function setPush(st) { S.push.state = st; pushKnown = st; }
  function pushProbe() {
    if (S.demo || !S.client || !S.opts.swReg || !S.opts.pushKey) return;
    if (pushKnown !== null) { S.push.state = pushKnown; drawPush(); return; } // read once per session: a trip list -> thread -> list does not repeat the probe
    var sup = pushSupport(), gen = S.gen;
    if (sup === 'unsupported') return;
    // The server must know staff_push_unsubscribe_topic_v1 (release s82_inbox_push): a harmless call for an endpoint that does not exist. Missing function = old server = no card.
    callRpc('staff_push_unsubscribe_topic_v1', { p_endpoint: DUMMY_ENDPOINT, p_topic: 'inbox' }).then(function (res) {
      if (!S || S.gen !== gen) return;
      if (res.error && (isMissing(res.error) || isDenied(res.error))) { pushKnown = 'hidden'; return; } // old server: no card, whatever the phone says
      if (sup === 'needs_install' || sup === 'blocked') { setPush(sup); drawPush(); return; } // only a server that has the feature may show these
      return Promise.resolve(S.opts.swReg()).then(function (reg) { return reg && reg.pushManager ? reg.pushManager.getSubscription() : null; }).then(function (sub) {
        if (!S || S.gen !== gen) return;
        if (!sub) { setPush('off'); drawPush(); return; }
        return Promise.resolve(S.client.from('staff_push_subscriptions').select('topics').eq('endpoint', sub.endpoint).limit(1)).then(function (r) {
          if (!S || S.gen !== gen) return;
          var row = r && r.data && r.data[0]; setPush(row && isArr(row.topics) && row.topics.indexOf('inbox') >= 0 ? 'on' : 'off'); drawPush();
        });
      });
    }).catch(function () { if (S && S.gen === gen) { S.push.state = 'hidden'; drawPush(); } });
  }
  function pushToggle() {
    var p = S.push; if (p.busy || (p.state !== 'on' && p.state !== 'off')) return;
    if (!online()) { p.msg = NOT_SENT_OFFLINE.replace('nothing was sent', 'nothing changed'); drawPush(); return; }
    var gen = S.gen; p.busy = true; p.msg = ''; drawPush();
    var fail = function (reason) { if (!S || S.gen !== gen) return; S.push.busy = false; if (reason === 'absent') S.push.state = 'hidden'; else S.push.msg = reason === 'blocked' ? PUSH_WORDS.blocked : reason === 'not_configured' ? PUSH_WORDS.not_configured : PUSH_WORDS.failed; if (reason === 'blocked') S.push.state = 'blocked'; drawPush(); };
    var nav = typeof navigator !== 'undefined' ? navigator : {};
    if (p.state === 'on') { // off: remove the inbox topic only; a paid-notice subscription on the same phone stays
      Promise.resolve(S.opts.swReg()).then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
        if (!sub) return { data: { ok: true } };
        return callRpc('staff_push_unsubscribe_topic_v1', { p_endpoint: sub.endpoint, p_topic: 'inbox' });
      }).then(function (res) {
        if (!S || S.gen !== gen) return;
        if (res.error || (res.data && res.data.ok === false)) { fail('failed'); return; }
        S.push.busy = false; setPush('off'); drawPush(); say('Messages from the inbox are off on this phone');
      }).catch(function () { fail('failed'); });
      return;
    }
    var sup = pushSupport(); if (sup !== 'ready') { S.push.busy = false; S.push.state = sup; drawPush(); return; }
    // permission first, straight from the tap (iPhone only allows the question there), then the key, then the subscription
    var win = typeof window !== 'undefined' ? window : {};
    Promise.resolve(win.Notification.requestPermission()).then(function (perm) {
      if (perm !== 'granted') return Promise.reject('blocked');
      return Promise.resolve(S && S.opts.pushKey()).then(function (key) {
        if (!key) return Promise.reject('not_configured');
        return Promise.resolve(S.opts.swReg()).then(function (reg) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }); });
      });
    }).then(function (sub) {
      if (!S || S.gen !== gen) return;
      return callRpc('staff_push_subscribe_v1', subscribeArgs(sub, nav.userAgent)).then(function (res) { // C_push.js:70 arguments plus p_topics
        if (!S || S.gen !== gen) return;
        if (res.error) return fail(isMissing(res.error) ? 'absent' : 'failed'); // PGRST202 also covers "no such argument p_topics": an old server hides the card
        if (res.data && res.data.ok === false) return fail('failed');
        S.push.busy = false; setPush('on'); buzz('success'); drawPush(); say('You will be told on this phone when a guest writes');
      });
    }).catch(function (e) { fail(e === 'blocked' || e === 'not_configured' ? e : 'failed'); });
  }

  // ------------------------------------------------------------------------------------------------ events
  function go(hash) { if (S && S.opts.navigate) S.opts.navigate(hash); }
  function resetCompose() { S.c = { text: (S.psid && drafts[S.psid]) || '', msg: '', msgKind: '', msgLinks: false, drafting: false, draftErr: '', options: null, mark: true, pending: null }; }

  function onClick(ev) {
    if (!S) return; var t = ev.target && ev.target.closest ? ev.target.closest('[data-xa]') : null; if (!t) return;
    var a = t.getAttribute('data-xa'), v = t.getAttribute('data-v');
    if (t.disabled || t.getAttribute('aria-busy') === 'true') return;
    if (S.busy && (a === 'open' || a === 'back' || a === 'refresh' || a === 'filter' || a === 'dash' || a === 'sheet-x' || a === 'edit' || a === 'push' || a === 'resume' || a === 'review' || a === 'draft' || a === 'quick' || a === 'pick')) return; // a write is in flight: nothing may orphan it
    if (a === 'open') { if (ev.preventDefault) ev.preventDefault(); if (PSID_RE.test(v || '')) go('#inbox/' + encodeURIComponent(v)); return; }
    if (a === 'back') { go('#inbox'); return; }
    if (a === 'dash') { go('#door/dashboard/guests/conversations'); return; }
    if (a === 'refresh') { refreshAll(); return; }
    if (a === 'filter') { S.filter = v === 'all' ? 'all' : 'needs'; ls('set', 'cs_x_filter', S.filter); drawList(); return; }
    if (a === 'push') { pushToggle(); return; }
    if (a === 'resume') { S.sheet = { kind: 'resume', msg: '' }; drawSheet(); focusSel('[data-xfocus]'); return; }
    if (a === 'resume-go') { doResume(); return; }
    if (a === 'review') {
      if (!canCompose() || !S.c.text.trim() || S.c.text.trim().length > MAX_TEXT) return;
      S.c.msg = ''; S.c.msgKind = ''; S.c.msgLinks = false; drawCompMsg(); S.sheet = { kind: 'review', msg: '' }; drawSheet(); focusSel('#X_sh'); return;
    }
    if (a === 'edit' || a === 'sheet-x') { S.sheet = null; drawSheet(); focusSel('#X_text'); return; }
    if (a === 'send') { doSend(); return; }
    if (a === 'draft') { doDraft(); return; }
    if (a === 'quick') { // fills the box and nothing else: a second tap on Review and send is still needed
      var qs = quickReplies(S.opts.houseTimes), q = qs[+v]; if (!q || !canCompose()) return;
      setText((S.c.text.trim() ? S.c.text.replace(/\s+$/, '') + '\n\n' : '') + q.text); if (S.c.text.length > MAX_TEXT) setText(S.c.text.slice(0, MAX_TEXT));
      S.c.msg = ''; drawCompText(); drawCompMsg(); drawCompFoot(); focusSel('#X_text'); return;
    }
    if (a === 'draft-close') { S.c.options = null; S.c.draftErr = ''; drawCompDraft(); return; }
    if (a === 'pick') {
      var src = S.c.options, o = src && src[+v]; if (!o || !o.text || S.c.pending) return;
      setText(String(o.text).slice(0, MAX_TEXT)); S.c.msg = ''; S.c.options = null; S.c.draftErr = '';
      drawCompText(); drawCompMsg(); drawCompDraft(); drawCompFoot(); focusSel('#X_text'); return;
    }
  }
  function onInput(ev) {
    if (!S) return; var t = ev.target; if (!t || !t.getAttribute) return; var f = t.getAttribute('data-xf'); if (!f) return;
    if (f === 'text') { setText(t.value); drawCompFoot(); return; } // the box itself is not redrawn
    if (f === 'mark') { S.c.mark = !!t.checked; }
  }
  function onKey(ev) {
    if (!S || !S.sheet) return;
    if (ev.key === 'Escape') { if (!S.busy) { S.sheet = null; drawSheet(); } return; }
    if (ev.key === 'Tab') { // keep focus inside the open sheet
      try {
        var k = S.el.querySelectorAll ? S.el.querySelectorAll('[data-xr="sheet"] button:not([disabled])') : []; if (!k.length) return;
        var first = k[0], last = k[k.length - 1], act = typeof document !== 'undefined' ? document.activeElement : null;
        if (ev.shiftKey && (act === first || !act)) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && act === last) { ev.preventDefault(); first.focus(); }
      } catch (e) { /* never block typing */ }
    }
  }

  // ------------------------------------------------------------------------------------------------ mount / unmount
  function mount(el, opts) {
    opts = opts || {};
    if (S) unmount();
    if (!canUse(opts.role)) { if (opts.navigate) opts.navigate('#home'); return; }
    var sub = String(opts.sub || ''); try { sub = decodeURIComponent(sub); } catch (e) { sub = ''; }
    var f = ls('get', 'cs_x_filter'), now = nowMs();
    S = { el: el, opts: opts, client: opts.client, demo: !!opts.demo, role: opts.role, gen: ++X_gen, psid: PSID_RE.test(sub) ? sub : '', filter: f === 'all' ? 'all' : 'needs', busy: false, sheet: null, timers: [], tick: null,
      list: { rows: null, at: 0, busy: false, loading: false, stale: false }, thread: { data: null, at: 0, busy: false, loading: false, sig: null }, push: { state: 'hidden', busy: false, msg: '' }, c: null };
    resetCompose();
    if (S.demo) S.demoThreads = demoData(now).threads;
    if (!S.demo && keep && keep.role === opts.role && now - keep.at < 120000) { S.list.rows = keep.rows; S.list.at = keep.at; } // not stale: stale only comes from a failed read
    S.onClick = onClick; S.onInput = onInput; S.onKey = onKey; S.onVis = onVis;
    el.innerHTML = SKELETON;
    el.addEventListener('click', S.onClick); el.addEventListener('input', S.onInput); el.addEventListener('change', S.onInput); el.addEventListener('keydown', S.onKey);
    S.onSubmit = function (e) { if (e && e.preventDefault) e.preventDefault(); }; el.addEventListener('submit', S.onSubmit);
    try { if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    drawAll();
    if (S.demo || S.client) { loadList(false); if (S.psid) loadThread(false); pushProbe(); } else { S.list.loading = false; drawList(); if (S.psid) drawThreadHead(); }
    schedule();
  }
  function unmount() {
    if (!S) return;
    try { S.el.removeEventListener && ['click', 'input', 'change', 'keydown', 'submit'].forEach(function (t, i) { S.el.removeEventListener(t, [S.onClick, S.onInput, S.onInput, S.onKey, S.onSubmit][i]); }); } catch (e) { /* ok */ }
    try { if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', S.onVis); } catch (e) { /* ok */ }
    if (S.tick) clearTimeout(S.tick);
    S.timers.forEach(function (t) { clearTimeout(t); });
    X_gen++; S = null; // a late reply finds no state and is dropped; the typed text goes with it (memory only)
  }

  var api = {
    mount: mount, unmount: unmount,
    _setClock: function (fn) { clock = fn || function () { return Date.now(); }; },
    _setRpcTimeout: function (ms) { RPC_TIMEOUT_MS = ms; },
    reset: function () { keep = null; drafts = {}; pushKnown = null; }, // the shell calls this on sign-out
    _clearKeep: function () { keep = null; }, _clearDrafts: function () { drafts = {}; },
    lib: { replyWindow: replyWindow, windowLeft: windowLeft, windowSentence: windowSentence, windowLastHour: windowLastHour, speakerOf: speakerOf, turnRisk: turnRisk, buildTimeline: buildTimeline, newestOpenHandoff: newestOpenHandoff,
      stateChips: stateChips, sortRows: sortRows, rowWindowChip: rowWindowChip, quickReplies: quickReplies, clock12: clock12, daysLeftWords: daysLeftWords, lastGuestText: lastGuestText, repliedAlready: repliedAlready, sendOutcome: sendOutcome, draftError: draftError, draftOptions: draftOptions, resumeOutcome: resumeOutcome,
      threadUrl: threadUrl, subscribeArgs: subscribeArgs, pushSupport: pushSupport, fmtTime: fmtTime, fmtStamp: fmtStamp, fmtListTime: fmtListTime, canUse: canUse, esc: esc,
      REPLY_WINDOW_HOURS: REPLY_WINDOW_HOURS, MAX_TEXT: MAX_TEXT, HISTORY_CAP: HISTORY_CAP, SEND_NOTHING: SEND_NOTHING }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.X_Inbox = api;
})();
