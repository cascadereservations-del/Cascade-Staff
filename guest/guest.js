/* Cascade Staff - Add guest details (s77). Owner and admin only; the staff-guest-details function checks the role again.
   Three steps on one page: paste text or add photos -> read -> review and save. Opened from the guest card as ./guest/#<stay uid>.
   Guest details, screenshots and ID photos live in JS memory for this page only: nothing goes to localStorage, sessionStorage or the
   cache (the service worker never caches /functions/v1/). Only an ID photo kept in the review sheet is stored, in the private bucket. */
(function () {
  'use strict';
  var CS = window.CS, G = window.CSGuest, ICON = window.ICON, esc = CS.esc;
  var CFG = { url: 'https://qkgfhsdppslwunarczeq.supabase.co', key: 'sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj' };
  var $ = function (id) { return document.getElementById(id); };
  var root = $('gd');
  var uid = G.uidFromHash(location.hash);
  if (!window.supabase) { root.innerHTML = shell('<div class="errbox">' + ICON('alert') + '<span>Live information needs a connection. Open the app again when you have signal.</span></div>'); return; }
  // Same session as the Staff app: the default key and the "Trust this device" storage choice (D-303.3).
  function store(name) { try { return window[name]; } catch (e) { return null; } }
  var trustOn = CS.trustedFromStorage(store('localStorage'), store('sessionStorage'));
  var sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    storage: CS.authStorage(store('localStorage'), store('sessionStorage'), function () { return trustOn; }) } });

  // step: load | input | reading | review | saving | done
  var S = { step: 'load', err: '', ctx: null, text: '', images: [], preparing: 0, sheet: null, result: null };

  function shell(inner) {
    return '<header class="appbar"><a class="iconbtn" href="../#calendar" aria-label="Back">' + ICON('back', 's24') + '</a><h1 class="ttl">Add guest details</h1></header><div class="screen"><div class="stack">' + inner + '</div></div>' +
      '<nav class="tabbar" aria-label="Primary"><a class="tab" href="../#home"><span class="ico">' + ICON('house', 's24') + '</span>Today</a><a class="tab" href="../#calendar"><span class="ico">' + ICON('calendar', 's24') + '</span>Calendar</a>' +
      '<a class="tab" href="../#tasks"><span class="ico">' + ICON('tasks', 's24') + '</span>Tasks</a><a class="tab" href="../#more"><span class="ico">' + ICON('more', 's24') + '</span>More</a></nav>';
  }
  function call(body) {
    return sb.auth.getSession().then(function (s) {
      var token = s.data && s.data.session && s.data.session.access_token; if (!token) return { status: 401, j: { error: 'authentication_required' } };
      return fetch(CFG.url + '/functions/v1/staff-guest-details', { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, j: j || {} }; }); });
    }).catch(function () { return { status: 0, j: {} }; });
  }

  // ---------------------------------------------------------------- photos: shrunk to 1600 px JPEG in memory (the re-encode also drops location data)
  function shrink(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); res(img); }; img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); }; img.src = u;
    }).then(function (img) {
      var z = CS.shrinkSize(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas'), cx; cv.width = z.w; cv.height = z.h;
      cx = cv.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, z.w, z.h); cx.drawImage(img, 0, 0, z.w, z.h);
      var data = cv.toDataURL('image/jpeg', 0.85);
      return { base64: data.replace(/^data:[^,]*,/, ''), mime: 'image/jpeg', src: data };
    });
  }
  function addFiles(list) {
    var files = Array.prototype.slice.call(list || [], 0, Math.max(0, G.MAX_IMAGES - S.images.length - S.preparing));
    if (list && list.length > files.length) S.err = G.errorText(400, 'too_many_images');
    files.forEach(function (f) {
      S.preparing++;
      shrink(f).then(function (im) { S.images.push(im); }).catch(function () { S.err = G.errorText(400, 'bad_image'); })
        .then(function () { S.preparing--; render(); });
    });
    render();
  }

  // ---------------------------------------------------------------- views
  function errBox() { return S.err ? '<div class="errbox" role="alert" id="gd-err" tabindex="-1">' + ICON('alert') + '<span>' + esc(S.err) + '</span></div>' : ''; }
  function stayCard() {
    var c = S.ctx, st = c.stay, f = c.on_file;
    var known = [f.phone ? 'phone' : '', f.email ? 'email' : '', f.id_on_file ? 'ID on file' : '', f.companions.length ? f.companions.length + ' companion' + (f.companions.length === 1 ? '' : 's') : ''].filter(Boolean);
    return '<div class="card"><span class="cap up">Guest record</span><h2 class="ttl" style="margin-top:6px">' + esc(f.name || st.guest_name || 'Guest') + '</h2>' +
      '<p class="sub num" style="margin:6px 0 0">' + esc(CS.dayLabel(st.checkin) + ' → ' + CS.dayLabel(st.checkout)) + '</p>' +
      '<p class="help" style="margin:6px 0 0">' + esc(known.length ? 'On file: ' + known.join(', ') + '.' : 'Nothing on file yet.') + '</p></div>';
  }
  function renderInput() {
    var busy = S.step === 'reading';
    var shots = S.images.map(function (im, i) {
      return '<div class="gd-shot"><img src="' + im.src + '" alt="Photo ' + (i + 1) + '"><button class="btn btn-secondary btn-sm" type="button" data-rm="' + i + '" aria-label="Remove photo ' + (i + 1) + '">' + ICON('x', 's16') + '</button></div>';
    }).join('');
    return stayCard() + errBox() +
      '<div class="field"><label for="gd-text">Guest’s message (optional)</label><textarea class="ta" id="gd-text" rows="6" maxlength="' + G.MAX_TEXT + '" placeholder="Paste what the guest sent: names, phone, email, how many are coming">' + esc(S.text) + '</textarea></div>' +
      '<div class="field"><span class="lbl">Photos (optional)</span>' + (shots ? '<div class="gd-shots">' + shots + '</div>' : '') +
      (S.images.length + S.preparing < G.MAX_IMAGES ? '<label class="btn btn-secondary btn-block">' + ICON('camera', 's16') + 'Add photos<input class="sr" id="gd-file" type="file" accept="image/*" multiple></label>' : '') +
      (S.preparing ? '<p class="help" role="status" style="margin:0">Preparing the photos…</p>' : '<p class="help" style="margin:0">ID photos and chat screenshots, up to ' + G.MAX_IMAGES + '. Screenshots are read and then dropped.</p>') + '</div>' +
      '<button class="btn btn-primary btn-block" type="button" data-act="read"' + (busy || S.preparing ? ' disabled' : '') + '>' + (busy ? 'Reading…' : 'Read the details') + '</button>' +
      '<p class="help" style="margin:0">Nothing is saved until you check the details and tap Save.</p>';
  }
  function input(id, label, value, attrs, hint) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><div class="input"><input id="' + id + '" value="' + esc(value) + '" autocomplete="off" ' + (attrs || '') + '></div>' + (hint ? '<span class="help">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function renderReview() {
    var s = S.sheet, f = S.ctx.on_file, busy = S.step === 'saving';
    var phoneHint = f.phone && s.phone && s.phone !== f.phone ? 'Replaces ' + f.phone + ' on file.' : '';
    var emailHint = f.email ? 'An email is already on file (' + f.email + '). It is kept.' : '';
    var comps = s.companions.length ? '<div><div class="cap up" style="margin-bottom:6px">Companions to add</div><div class="card list">' + s.companions.map(function (c, i) {
      return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!c.on + '" aria-label="Add ' + esc(c.name) + '" data-comp="' + i + '">' + ICON('check', 's16') + '</button>' +
        '<div class="input"><input data-cname="' + i + '" value="' + esc(c.name) + '" aria-label="Companion name"></div></div>';
    }).join('') + '</div></div>' : '';
    var ids = s.ids.length ? '<div><div class="cap up" style="margin-bottom:6px">ID photos to keep</div><div class="card list">' + s.ids.map(function (d, i) {
      var im = S.images[d.image];
      return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!d.on + '" aria-label="Keep this ID photo" data-idk="' + i + '">' + ICON('check', 's16') + '</button>' +
        '<div class="gd-id">' + (im ? '<img src="' + im.src + '" alt="ID photo">' : '<span></span>') + '<div class="stack" style="gap:8px">' +
        '<div class="input"><input data-idname="' + i + '" value="' + esc(d.name) + '" aria-label="Name on the ID"></div>' +
        '<div class="input"><select data-idtype="' + i + '" aria-label="ID type">' + G.ID_TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === d.id_type ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</select></div>' +
        '<span class="help">' + (d.own ? 'The guest’s own ID. It shows on the guest card.' : 'Saved as a companion’s ID.') + '</span></div></div></div>';
    }).join('') + '</div></div>' : '';
    return stayCard() + errBox() + '<h2 class="hd" id="gd-h" tabindex="-1">Check before saving</h2><p class="help" style="margin:0">Fix anything that is wrong. Empty fields are left as they are.</p>' +
      input('gd-phone', 'Phone', s.phone, 'inputmode="tel" maxlength="20"', phoneHint) +
      input('gd-email', 'Email', s.email, 'inputmode="email" maxlength="120"' + (f.email ? ' disabled' : ''), emailHint) +
      (s.guests || s.nationality ? '<div class="infobox">' + ICON('info') + '<span>' + esc([s.guests ? 'The message says ' + s.guests + ' guest' + (s.guests === '1' ? '' : 's') + '.' : '', s.nationality ? 'Nationality: ' + s.nationality + '.' : ''].filter(Boolean).join(' ')) +
        ' This is for your information and is not saved.</span></div>' : '') +
      comps + ids +
      '<button class="btn btn-primary btn-block" type="button" data-act="save"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save to the guest record') + '</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-act="again"' + (busy ? ' disabled' : '') + '>Back</button>';
  }
  function renderDone() {
    return stayCard() + '<div class="' + (S.result.ok ? 'okbox' : 'infobox') + '" role="status" id="gd-h" tabindex="-1">' + ICON(S.result.ok ? 'check' : 'info') + '<span>' + S.result.lines.map(esc).join('<br>') + '</span></div>' +
      '<a class="btn btn-primary btn-block" href="../#calendar">Back to the guest card</a>' +
      '<button class="btn btn-ghost btn-block" type="button" data-act="more">Add more details</button>';
  }
  function render(focus) {
    var body;
    if (S.step === 'load') body = S.err ? errBox() + '<button class="btn btn-secondary" type="button" data-act="retry">Try again</button>' : '<div class="skel" style="height:110px"></div><div class="skel" style="height:200px"></div>';
    else if (S.step === 'review' || S.step === 'saving') body = renderReview();
    else if (S.step === 'done') body = renderDone();
    else body = renderInput();
    root.innerHTML = shell(body);
    var el = focus && $(focus); if (el) el.focus();
  }

  // ---------------------------------------------------------------- actions
  function load() {
    S.step = 'load'; S.err = ''; render();
    if (!uid) { S.err = G.errorText(404, 'stay_not_found'); render(); return; }
    call({ action: 'context', uid: uid }).then(function (o) {
      if (o.status !== 200 || !o.j.ok) { S.err = G.errorText(o.status, o.j.error); render('gd-err'); return; }
      S.ctx = o.j; S.step = 'input'; render();
    });
  }
  function read() {
    S.text = ($('gd-text') || {}).value || S.text;
    if (!S.text.trim() && !S.images.length) { S.err = G.errorText(400, 'empty'); render('gd-err'); return; }
    S.step = 'reading'; S.err = ''; render();
    call({ action: 'extract', uid: uid, text: S.text.trim() || null, images: S.images.map(function (im) { return { base64: im.base64, mime: im.mime }; }) }).then(function (o) {
      if (o.status !== 200 || !o.j.ok) { S.step = 'input'; S.err = G.errorText(o.status, o.j.error); render('gd-err'); return; }
      S.ctx = { stay: o.j.stay, on_file: o.j.on_file };
      S.sheet = G.sheetFrom(o.j.proposal);
      if (S.ctx.on_file.email) S.sheet.email = '';
      S.step = 'review'; render('gd-h'); window.scrollTo(0, 0);
    });
  }
  function syncSheet() {
    var s = S.sheet; if (!s) return;
    var v = function (id) { var e = $(id); return e ? e.value : ''; };
    s.phone = v('gd-phone'); s.email = S.ctx.on_file.email ? '' : v('gd-email'); 
    root.querySelectorAll('[data-cname]').forEach(function (e) { s.companions[+e.getAttribute('data-cname')].name = e.value; });
    root.querySelectorAll('[data-idname]').forEach(function (e) { s.ids[+e.getAttribute('data-idname')].name = e.value; });
    root.querySelectorAll('[data-idtype]').forEach(function (e) { s.ids[+e.getAttribute('data-idtype')].id_type = e.value; });
  }
  function save() {
    syncSheet();
    var body = G.saveBody(uid, S.sheet, S.images);
    if (!G.hasAnything(body)) { S.err = 'There is nothing to save. Fill a field or keep a photo, or tap Back.'; render('gd-err'); return; }
    S.step = 'saving'; S.err = ''; render();
    call(body).then(function (o) {
      if ((o.status === 200 || o.status === 207) && o.j.saved) {
        S.result = { ok: o.j.ok, lines: G.resultLines(o.j.saved) };
        S.images = []; S.text = ''; S.sheet = null; // the photos leave memory once they are saved or refused
        S.step = 'done'; render('gd-h'); window.scrollTo(0, 0); return;
      }
      S.step = 'review'; S.err = G.errorText(o.status, o.j.error); render('gd-err');
    });
  }

  root.addEventListener('input', function (ev) { if (ev.target.id === 'gd-text') S.text = ev.target.value; });
  root.addEventListener('change', function (ev) { if (ev.target.id === 'gd-file') { addFiles(ev.target.files); ev.target.value = ''; } });
  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (t.hasAttribute('data-rm')) { S.images.splice(+t.getAttribute('data-rm'), 1); S.err = ''; render(); }
    else if (t.hasAttribute('data-comp')) { syncSheet(); var c = S.sheet.companions[+t.getAttribute('data-comp')]; c.on = !c.on; render(); }
    else if (t.hasAttribute('data-idk')) { syncSheet(); var d = S.sheet.ids[+t.getAttribute('data-idk')]; d.on = !d.on; render(); }
    else if (a === 'read') read();
    else if (a === 'save') save();
    else if (a === 'again') { S.step = 'input'; S.err = ''; S.sheet = null; render(); }
    else if (a === 'more') { S.step = 'load'; S.result = null; load(); }
    else if (a === 'retry') load();
  });
  window.addEventListener('hashchange', function () { uid = G.uidFromHash(location.hash); S.images = []; S.text = ''; load(); });

  load();
  var bar = function () { var b = document.querySelector('.appbar'); if (b) b.classList.toggle('scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', bar, { passive: true });
})();
