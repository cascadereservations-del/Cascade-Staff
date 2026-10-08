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
      bad_field: 'One field does not look right. Check the phone, email and number of guests.',
      bad_name: 'A name does not look right. Use letters only, no ID numbers.',
      read_failed: 'The photos could not be read just now. Nothing was saved. Try again in a minute.'
    }[code];
    if (t) return t;
    if (status === 0) return 'No connection. Nothing was saved. Try again when you have signal.';
    return 'Something went wrong (' + (code || status) + '). Nothing new was saved.';
  }

  /** The review sheet's starting values from the server's proposal. Every ID photo starts kept; screenshots are never kept. */
  function sheetFrom(proposal) {
    var p = proposal || {};
    return {
      phone: p.phone || '', email: p.email || '', guests: p.guests ? String(p.guests) : '', nationality: p.nationality || '',
      companions: (p.companions || []).map(function (n) { return { name: n, on: true }; }),
      ids: (p.ids || []).map(function (d) { return { image: d.image, name: d.name, id_type: d.id_type, own: !!d.own, on: true }; })
    };
  }

  /** The save request. images[i] is the {base64, mime} the page read for photo i; only kept ID photos are sent. */
  function saveBody(uid, sheet, images) {
    var trim = function (v) { return String(v == null ? '' : v).trim(); };
    return {
      action: 'save', uid: uid,
      phone: trim(sheet.phone) || null, email: trim(sheet.email) || null,
      guests: trim(sheet.guests) ? Number(trim(sheet.guests)) : null, nationality: trim(sheet.nationality) || null,
      companions: sheet.companions.filter(function (c) { return c.on && trim(c.name); }).map(function (c) { return trim(c.name); }),
      ids: sheet.ids.filter(function (d) { return d.on && images[d.image]; }).map(function (d) { return { name: trim(d.name), id_type: d.id_type, image: images[d.image] }; })
    };
  }
  function hasAnything(body) {
    return !!(body.phone || body.email || body.guests || body.nationality || body.companions.length || body.ids.length);
  }

  var WHAT = { companion: 'companion', id_photo: 'ID photo', profile: 'phone and notes', email: 'email' };
  var WHY = { denied: 'not allowed for this account', changed: 'someone changed this guest meanwhile, so reload and try again', upload_failed: 'the photo did not upload', email_kept: 'an email is already on file, so it was kept', save_failed: 'it did not save' };
  /** The save answer as plain lines: what landed first, then what did not and why. */
  function resultLines(saved) {
    var ok = {}, lines = [], bad = [];
    (saved || []).forEach(function (s) { if (s.ok) ok[s.what] = (ok[s.what] || 0) + 1; else bad.push(s); });
    Object.keys(ok).forEach(function (k) { lines.push('Saved: ' + (ok[k] > 1 ? ok[k] + ' ' + WHAT[k] + 's' : WHAT[k] || k) + '.'); });
    bad.forEach(function (s) { lines.push('Not saved: ' + (WHAT[s.what] || s.what) + ' (' + (WHY[s.reason] || WHY.save_failed) + ').'); });
    return lines.length ? lines : ['Nothing needed saving. The record already had these details.'];
  }

  return { MAX_IMAGES: MAX_IMAGES, MAX_TEXT: MAX_TEXT, ID_TYPES: ID_TYPES, uidFromHash: uidFromHash, errorText: errorText, sheetFrom: sheetFrom, saveBody: saveBody, hasAnything: hasAnything, resultLines: resultLines };
});
