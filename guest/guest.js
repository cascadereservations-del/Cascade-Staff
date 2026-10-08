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
  var uid = G.uidFromHash(location.hash), mode = G.modeFromSearch(location.search); // s78: 'id' from the empty ID box, 'companion' from Add a companion
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
  // s78: one photo added on the review sheet (the guest's own ID, or a companion's). It is not read by the model: the person types
  // or confirms the name, and only the name and ID type are saved with it (D-291).
  function addIdPhoto(file, entry) {
    if (!file) return;
    if (S.images.length + S.preparing >= G.MAX_IMAGES) { S.err = G.errorText(400, 'too_many_images'); render('gd-err'); return; }
    syncSheet(); S.preparing++; render();
    shrink(file).then(function (im) { S.images.push(im); entry.image = S.images.length - 1; if (S.sheet) S.sheet.ids.push(entry); })
      .catch(function () { S.err = G.errorText(400, 'bad_image'); }).then(function () { S.preparing--; render(); });
  }
  function photoButtons(id, multiple) {
    return '<div class="row-wrap">' +
      '<label class="btn btn-secondary">' + ICON('camera', 's16') + 'Take a photo<input class="sr" id="' + id + '-cam" data-pick="' + id + '" type="file" accept="image/*" capture="environment"></label>' +
      '<label class="btn btn-secondary">' + ICON('image', 's16') + 'Choose photos<input class="sr" id="' + id + '" data-pick="' + id + '" type="file" accept="image/*"' + (multiple ? ' multiple' : '') + '></label></div>';
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
    var idMode = mode === 'id';
    var textField = '<div class="field"><label for="gd-text">Guest’s message (optional)</label><textarea class="ta" id="gd-text" rows="6" maxlength="' + G.MAX_TEXT + '" placeholder="Paste what the guest sent: names, phone, email, how many are coming">' + esc(S.text) + '</textarea></div>';
    // s78: Take a photo (the camera) or Choose photos (the library); opened from the empty ID box, the photo comes first.
    var photos = '<div class="field"><span class="lbl">' + (idMode ? 'Photo of the guest’s ID' : 'Photos (optional)') + '</span>' + (shots ? '<div class="gd-shots">' + shots + '</div>' : '') +
      (S.images.length + S.preparing < G.MAX_IMAGES ? photoButtons('gd-file', true) : '') +
      (S.preparing ? '<p class="help" role="status" style="margin:0">Preparing the photos…</p>' : '<p class="help" style="margin:0">' + (idMode ? 'Only the name and the ID type are read from an ID. ' : 'ID photos and chat screenshots, up to ' + G.MAX_IMAGES + '. Screenshots are read and then dropped.') + '</p>') + '</div>';
    return stayCard() + errBox() + (idMode ? photos + textField : textField + photos) +
      '<button class="btn btn-primary btn-block" type="button" data-act="read"' + (busy || S.preparing ? ' disabled' : '') + '>' + (busy ? 'Reading…' : 'Read the details') + '</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-act="manual"' + (busy || S.preparing ? ' disabled' : '') + '>Fill in by hand instead</button>' +
      '<p class="help" style="margin:0">Nothing is saved until you check the details and tap Save.</p>';
  }
  function input(id, label, value, attrs, hint) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><div class="input"><input id="' + id + '" value="' + esc(value) + '" autocomplete="off" ' + (attrs || '') + '></div>' + (hint ? '<span class="help">' + esc(hint) + '</span>' : '') + '</div>';
  }
  function renderReview() {
    var s = S.sheet, f = S.ctx.on_file, busy = S.step === 'saving';
    var phoneHint = f.phone && s.phone && s.phone !== f.phone ? 'Replaces ' + f.phone + ' on file.' : '';
    var emailHint = f.email ? 'An email is already on file (' + f.email + '). It is kept.' : '';
    var room = S.images.length + S.preparing < G.MAX_IMAGES;
    // s78: companions can be added by hand, each with an optional ID photo (taken or chosen; not read, the row's name goes with it).
    var comps = '<div><div class="cap up" style="margin-bottom:6px">Companions to add</div>' + (s.companions.length ? '<div class="card list">' + s.companions.map(function (c, i) {
      var hasId = s.ids.some(function (d) { return d.comp === i; });
      return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!c.on + '" aria-label="' + esc('Add ' + (c.name || 'this companion')) + '" data-comp="' + i + '">' + ICON('check', 's16') + '</button>' +
        '<div class="stack" style="gap:6px"><div class="input"><input data-cname="' + i + '" value="' + esc(c.name) + '" aria-label="Companion name" placeholder="Full name" maxlength="80"></div>' +
        (!hasId && room ? '<label class="btn btn-ghost btn-sm" style="align-self:flex-start;margin-left:-12px">' + ICON('camera', 's16') + 'Add ID photo<input class="sr" data-addid="comp:' + i + '" type="file" accept="image/*" aria-label="' + esc('Add an ID photo for ' + (c.name || 'this companion')) + '"></label>' : '') + '</div></div>';
    }).join('') + '</div>' : '') +
      '<button class="btn btn-secondary btn-block" type="button" data-act="add-comp" style="margin-top:8px">' + ICON('plus', 's16') + 'Add a companion</button></div>';
    var ids = '<div><div class="cap up" style="margin-bottom:6px">ID photos to keep</div>' + (s.ids.length ? '<div class="card list">' + s.ids.map(function (d, i) {
      var im = S.images[d.image], comp = d.comp != null ? s.companions[d.comp] : null;
      var who = comp ? '<span class="help">' + esc('ID of ' + (comp.name || 'the companion above') + '.') + '</span>'
        : '<div class="input"><select data-idown="' + i + '" aria-label="Whose ID"><option value="own"' + (d.own ? ' selected' : '') + '>' + esc('The guest (' + (f.name || 'on file') + ')') + '</option><option value="comp"' + (d.own ? '' : ' selected') + '>A companion</option></select></div>' +
          (d.own ? '' : '<div class="input"><input data-idname="' + i + '" value="' + esc(d.name) + '" aria-label="Name on the ID" placeholder="Name on the ID" maxlength="80"></div>') +
          // the read name differs from the record: say what the ID reads and ask for an explicit yes before it becomes the guest's own
          (G.ownNeedsYes(d) ? '<p class="help" style="margin:0">' + esc('ID reads: ' + d.readName) + '</p><div class="payrow single" style="padding:0;border:0;display:flex;gap:8px;align-items:center">' +
            '<button class="chk" type="button" role="checkbox" aria-checked="' + !!d.ownYes + '" data-ownyes="' + i + '" aria-label="' + esc('Yes, this is ' + (f.name || 'the guest')) + '">' + ICON('check', 's16') + '</button>' +
            '<span class="help" style="color:var(--fg)">' + esc('Yes, this is ' + (f.name || 'the guest')) + '</span></div>' : '');
      return '<div class="payrow"><button class="chk" type="button" role="checkbox" aria-checked="' + !!d.on + '" aria-label="Keep this ID photo" data-idk="' + i + '">' + ICON('check', 's16') + '</button>' +
        '<div class="gd-id">' + (im ? '<img src="' + im.src + '" alt="ID photo">' : '<span></span>') + '<div class="stack" style="gap:8px">' + who +
        '<div class="input"><select data-idtype="' + i + '" aria-label="ID type">' + G.ID_TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === d.id_type ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('') + '</select></div>' +
        '<span class="help">' + (d.unread ? 'Not read as an ID. Tick it to keep it as one. ' : '') + (d.own ? 'The guest’s own ID. It shows on the guest card.' : 'Saved as a companion’s ID.') + '</span></div></div></div>';
    }).join('') + '</div>' : '') +
      // one own ID at a time: a second own photo would leave the first behind in storage
      (room && !s.ids.some(function (d) { return d.on && d.own; }) ? '<div style="margin-top:8px"><span class="help">The guest’s own ID</span>' + photoButtons('gd-ownid', false) + '</div>' : '') +
      (S.preparing ? '<p class="help" role="status" style="margin:4px 0 0">Preparing the photo…</p>' : '') + '</div>';
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
      S.ctx = o.j; S.step = 'input';
      if (mode === 'companion') { manual(); S.sheet.companions.push({ name: '', on: true }); render('gd-h'); return; }
      render();
    });
  }
  function read() {
    S.text = ($('gd-text') || {}).value || S.text;
    if (!S.text.trim() && !S.images.length) { S.err = G.errorText(400, 'empty'); render('gd-err'); return; }
    S.step = 'reading'; S.err = ''; render();
    call({ action: 'extract', uid: uid, text: S.text.trim() || null, images: S.images.map(function (im) { return { base64: im.base64, mime: im.mime }; }) }).then(function (o) {
      if (o.status !== 200 || !o.j.ok) { S.step = 'input'; S.err = G.errorText(o.status, o.j.error); render('gd-err'); return; }
      S.ctx = { stay: o.j.stay, on_file: o.j.on_file };
      S.sheet = G.sheetFrom(o.j.proposal, mode === 'id');
      if (S.ctx.on_file.email) S.sheet.email = '';
      S.step = 'review'; render('gd-h'); window.scrollTo(0, 0);
    });
  }
  // s78: straight to the review sheet with nothing read: type a phone, add companions, add ID photos by hand.
  function manual() { S.text = ($('gd-text') || {}).value || S.text; S.sheet = G.sheetFrom(null); S.err = ''; S.step = 'review'; }
  function syncSheet() {
    var s = S.sheet; if (!s) return;
    var v = function (id) { var e = $(id); return e ? e.value : ''; };
    s.phone = v('gd-phone'); s.email = S.ctx.on_file.email ? '' : v('gd-email'); 
    root.querySelectorAll('[data-cname]').forEach(function (e) { s.companions[+e.getAttribute('data-cname')].name = e.value; });
    root.querySelectorAll('[data-idname]').forEach(function (e) { s.ids[+e.getAttribute('data-idname')].name = e.value; });
    root.querySelectorAll('[data-idtype]').forEach(function (e) { s.ids[+e.getAttribute('data-idtype')].id_type = e.value; });
    root.querySelectorAll('[data-idown]').forEach(function (e) { s.ids[+e.getAttribute('data-idown')].own = e.value === 'own'; });
  }
  function save() {
    syncSheet();
    var problem = G.sheetProblem(S.sheet, S.ctx.on_file.name); if (problem) { S.err = problem; render('gd-err'); return; }
    var body = G.saveBody(uid, S.sheet, S.images, S.ctx.on_file.name);
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
  root.addEventListener('change', function (ev) {
    var t = ev.target, pick = t.getAttribute('data-pick'), add = t.getAttribute('data-addid');
    if (t.getAttribute('data-idown') !== null) { syncSheet(); render(); return; }
    if (pick === 'gd-file') addFiles(t.files);
    else if (pick === 'gd-ownid') addIdPhoto(t.files && t.files[0], { name: '', id_type: 'other', own: true, on: true });
    else if (add) addIdPhoto(t.files && t.files[0], { name: '', id_type: 'other', own: false, on: true, comp: +add.split(':')[1] });
    else return;
    t.value = '';
  });
  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button'); if (!t) return;
    var a = t.getAttribute('data-act');
    if (t.hasAttribute('data-rm')) { S.images.splice(+t.getAttribute('data-rm'), 1); S.err = ''; render(); }
    else if (t.hasAttribute('data-comp')) { syncSheet(); var c = S.sheet.companions[+t.getAttribute('data-comp')]; c.on = !c.on; render(); }
    else if (t.hasAttribute('data-ownyes')) { syncSheet(); var y = S.sheet.ids[+t.getAttribute('data-ownyes')]; y.ownYes = !y.ownYes; render(); }
    else if (t.hasAttribute('data-idk')) { syncSheet(); var d = S.sheet.ids[+t.getAttribute('data-idk')]; d.on = !d.on; render(); }
    else if (a === 'read') read();
    else if (a === 'manual') { manual(); render('gd-h'); }
    else if (a === 'add-comp') { syncSheet(); S.sheet.companions.push({ name: '', on: true }); render(); var ins = root.querySelectorAll('[data-cname]'); if (ins.length) ins[ins.length - 1].focus(); }
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
