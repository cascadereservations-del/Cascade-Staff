/* Cascade Staff - Add guest details, pure helpers (s77). No DOM, no network. The server (staff-guest-details) checks every field again;
   these only shape the request and turn its answers into plain sentences. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CSGuest = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_IMAGES = 4, MAX_TEXT = 6000;
  var ID_TYPES = [['passport', 'Passport'], ['drivers_license', "Driver's license"], ['national_id', 'National ID'], ['other', 'Other ID']];

  /** The stay uid from the page hash (#<uid>), or ''. */
  function uidFromHash(hash) {
    var s = String(hash || '').replace(/^#/, '');
    try { s = decodeURIComponent(s); } catch (e) { return ''; }
    return s.length > 0 && s.length <= 300 ? s : '';
  }

  /** s78: how the page was opened: ?for=id (the empty ID box), ?for=companion (Add a companion), else the general page. */
  function modeFromSearch(search) { var m = /[?&]for=(id|companion)(?:&|$)/.exec(String(search || '')); return m ? m[1] : ''; }

  /** What the person sees for a refusal or a failure: what happened, then what to do. */
  function errorText(status, code) {
    var t = {
      authentication_required: 'Sign in to the Staff app again, then open this page.',
      invalid_or_expired_session: 'Your sign-in expired. Open the Staff app, sign in, then try again.',
      staff_access_denied: 'Adding guest details is for the owner and admins.',
      stay_not_found: 'This stay is no longer on the calendar. Go back and refresh.',
      no_guest_record: 'This stay has no guest record yet, so there is nowhere to save. Add the guest in the dashboard first.',
      empty: 'Paste the guest’s text or add a photo first.',
      too_long: 'That text is too long. Paste only the part with the guest’s details.',
      too_many_images: 'Add up to ' + MAX_IMAGES + ' photos at a time.',
      image_too_large: 'One photo is too large. Try a smaller screenshot.',
      bad_image: 'One photo could not be read. Use a JPEG, PNG or WebP.',
      bad_field: 'One field does not look right. Check the phone and the email.',
      bad_name: 'A name does not look right. Use letters only, no ID numbers.',
      read_failed: 'The photos could not be read just now. Nothing was saved. Try again in a minute.',
      too_many_reads: 'Many reads ran in the last hour, so reading is paused for now. Nothing was saved. Try again later or type the details in the dashboard.'
    }[code];
    if (t) return t;
    if (status === 0) return 'No connection. Nothing was saved. Try again when you have signal.';
    return 'Something went wrong (' + (code || status) + '). Nothing new was saved.';
  }

  /** The review sheet's starting values from the server's proposal. Every ID photo starts kept; screenshots are never kept. */
  function sheetFrom(proposal, forOwnId) {
    var p = proposal || {}, ids = (p.ids || []).map(function (d) { return { image: d.image, name: d.name, id_type: d.id_type, own: !!d.own, on: true }; });
    // s78: a photo the reader could not place (kind "other") is offered unticked, so an ID it missed can still be kept by hand.
    // Opened from the empty ID box (forOwnId), such a photo starts as the guest's own ID; it still starts unticked.
    (p.images || []).forEach(function (k, i) {
      if (k === 'other' && !ids.some(function (d) { return d.image === i; })) ids.push({ image: i, name: '', id_type: 'other', own: !!forOwnId, on: false, unread: true });
    });
    // From the empty ID box with exactly one ID read: that photo is the guest's own (the person said so by where they tapped).
    // The server also proposes that ID's holder as a new companion when the name differs from the record; that row starts unticked.
    var ownRead = forOwnId && (p.ids || []).length === 1 ? ids[0] : null;
    if (ownRead) ownRead.own = true;
    return {
      phone: p.phone || '', email: p.email || '', guests: p.guests ? String(p.guests) : '', nationality: p.nationality || '',
      companions: (p.companions || []).map(function (n) { return { name: n, on: !(ownRead && n === ownRead.name) }; }),
      ids: ids
    };
  }
  /** The name an ID is saved under: the guest's own goes under the name on file (the server links it to the guest by that name),
      a companion's photo added on a companion row follows that row's name, else the name typed on the sheet. */
  function idName(d, sheet, ownName) {
    if (d.own) return String(ownName || '').trim();
    if (d.comp != null && sheet.companions[d.comp]) return String(sheet.companions[d.comp].name || '').trim();
    return String(d.name == null ? '' : d.name).trim();
  }
  /** What stops a save, in words, or ''. */
  function sheetProblem(sheet, ownName) {
    var kept = sheet.ids.filter(function (d) { return d.on && !(d.comp != null && sheet.companions[d.comp] && !sheet.companions[d.comp].on); });
    if (kept.some(function (d) { return !idName(d, sheet, ownName); })) return 'Type the name on each ID you keep, or untick it.';
    return '';
  }

  /** The save request. Guest count and nationality are shown in the sheet only: there is no safe place to save them yet, so they are never sent.
      images[i] is the {base64, mime} the page read for photo i; only kept ID photos are sent. */
  function saveBody(uid, sheet, images, ownName) {
    var trim = function (v) { return String(v == null ? '' : v).trim(); };
    var compOff = function (d) { return d.comp != null && sheet.companions[d.comp] && !sheet.companions[d.comp].on; }; // an unticked companion takes its photo with it
    return {
      action: 'save', uid: uid,
      phone: trim(sheet.phone) || null, email: trim(sheet.email) || null,
      companions: sheet.companions.filter(function (c) { return c.on && trim(c.name); }).map(function (c) { return trim(c.name); }),
      ids: sheet.ids.filter(function (d) { return d.on && images[d.image] && !compOff(d); }).map(function (d) { return { name: idName(d, sheet, ownName), id_type: d.id_type, image: images[d.image] }; })
    };
  }
  function hasAnything(body) {
    return !!(body.phone || body.email || body.companions.length || body.ids.length);
  }

  var WHAT = { companion: 'companion', id_photo: 'ID photo', profile: 'phone and ID details', email: 'email' };
  var WHY = { denied: 'not allowed for this account', changed: 'someone changed this guest meanwhile, so reload and try again', upload_failed: 'the photo did not upload', email_kept: 'an email is already on file, so it was kept', save_failed: 'it did not save' };
  /** The save answer as plain lines: what landed first, then what did not and why. */
  function resultLines(saved) {
    var ok = {}, lines = [], bad = [];
    (saved || []).forEach(function (s) { if (s.ok) ok[s.what] = (ok[s.what] || 0) + 1; else bad.push(s); });
    Object.keys(ok).forEach(function (k) { lines.push('Saved: ' + (ok[k] > 1 ? ok[k] + ' ' + WHAT[k] + 's' : WHAT[k] || k) + '.'); });
    bad.forEach(function (s) { lines.push('Not saved: ' + (WHAT[s.what] || s.what) + ' (' + (WHY[s.reason] || WHY.save_failed) + ').'); });
    return lines.length ? lines : ['Nothing needed saving. The record already had these details.'];
  }

  return { MAX_IMAGES: MAX_IMAGES, MAX_TEXT: MAX_TEXT, ID_TYPES: ID_TYPES, uidFromHash: uidFromHash, errorText: errorText, sheetFrom: sheetFrom, saveBody: saveBody, idName: idName, sheetProblem: sheetProblem, modeFromSearch: modeFromSearch, hasAnything: hasAnything, resultLines: resultLines };
});
