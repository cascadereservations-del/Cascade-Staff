/* Cascade System Guide - progressive enhancement.
   Every chapter reads with JavaScript off. Storage keys start with csg: and every access is wrapped. */
(function () {
  'use strict'
  var doc = document
  var root = doc.documentElement
  var PREFIX = 'csg:'

  function $(s, c) { return (c || doc).querySelector(s) }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)) }
  function get(k) { try { return localStorage.getItem(PREFIX + k) } catch (e) { return null } }
  function put(k, v) { try { localStorage.setItem(PREFIX + k, v) } catch (e) { /* storage blocked: fine */ } }
  function getJSON(k, d) {
    var s = get(k)
    if (s === null) return d
    try { return JSON.parse(s) } catch (e) { return d }
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }
  function isNum(v) { return v !== null && v !== undefined && String(v).trim() !== '' && isFinite(Number(v)) }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }
  function typing(t) { return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) }

  /* ---------- theme ---------- */
  function initTheme() {
    var btn = $('#csg-theme')
    var modes = ['auto', 'light', 'dark']
    var mode = get('theme')
    if (modes.indexOf(mode) < 0) mode = 'auto'
    function apply() {
      if (mode === 'auto') root.removeAttribute('data-theme')
      else root.setAttribute('data-theme', mode)
      if (btn) {
        var label = mode.charAt(0).toUpperCase() + mode.slice(1)
        btn.setAttribute('aria-label', 'Colour theme: ' + label + '. Tap to change.')
        var t = $('.hd-label', btn)
        if (t) t.textContent = label
      }
    }
    apply()
    if (btn) btn.addEventListener('click', function () {
      mode = modes[(modes.indexOf(mode) + 1) % modes.length]
      put('theme', mode)
      apply()
    })
    var pr = $('#csg-print')
    if (pr) pr.addEventListener('click', function () { window.print() })
  }

  /* ---------- role chips (staff build) ---------- */
  var setRole = function () {}
  function initRoles() {
    var bar = $('.role-bar')
    if (!bar) return
    var chips = $$('[data-role]', bar)
    var status = $('.role-status', bar)
    var names = { all: 'all chapters', cleaner: 'cleaner chapters', office: 'office chapters' }
    setRole = function (r, save) {
      if (!names[r]) r = 'all'
      $$('[data-roles]').forEach(function (n) {
        var t = (n.getAttribute('data-roles') || '').split(/[\s,]+/)
        var hide = r !== 'all' && t.indexOf('all') < 0 && t.indexOf(r) < 0
        if (hide) n.setAttribute('data-role-hidden', '')
        else n.removeAttribute('data-role-hidden')
      })
      chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-role') === r)) })
      if (status) status.textContent = 'Showing ' + names[r] + '.'
      if (save) put('role', r)
    }
    chips.forEach(function (c) { c.addEventListener('click', function () { setRole(c.getAttribute('data-role'), true) }) })
    setRole(get('role') || 'all', false)
  }

  /* ---------- walkthrough ---------- */
  function initWalkthroughs() {
    $$('.walkthrough').forEach(function (wt) {
      var steps = Array.prototype.filter.call(wt.children, function (c) { return c.classList.contains('wt-step') })
      if (!steps.length) return
      var n = steps.length
      var id = wt.id
      var done = id ? getJSON('wt:' + id, []) : []
      if (!Array.isArray(done)) done = []
      var cur = 0
      wt.classList.add('is-enhanced')

      var head = el('div', 'wt-head')
      var count = el('p', 'wt-count')
      count.setAttribute('aria-live', 'polite')
      var bar = el('div', 'wt-bar')
      bar.setAttribute('role', 'progressbar')
      bar.setAttribute('aria-valuemin', '1')
      bar.setAttribute('aria-valuemax', String(n))
      bar.setAttribute('aria-label', 'Walkthrough progress')
      var fill = el('span')
      bar.appendChild(fill)
      var dots = el('ol', 'wt-dots')
      var dotBtns = steps.map(function (s, i) {
        var li = el('li')
        var b = el('button', 'wt-dot', String(i + 1))
        b.type = 'button'
        b.setAttribute('aria-label', 'Go to step ' + (i + 1) + ' of ' + n + ': ' + (s.getAttribute('data-title') || ''))
        b.addEventListener('click', function () { show(i) })
        li.appendChild(b)
        dots.appendChild(li)
        return b
      })
      head.appendChild(count)
      head.appendChild(bar)
      head.appendChild(dots)
      wt.insertBefore(head, steps[0])

      var nav = el('div', 'wt-nav')
      var prev = el('button', 'btn', 'Previous')
      var doneBtn = el('button', 'btn')
      var next = el('button', 'btn primary', 'Next')
      prev.type = doneBtn.type = next.type = 'button'
      var spacer = el('span', 'spacer')
      nav.appendChild(prev)
      nav.appendChild(doneBtn)
      nav.appendChild(spacer)
      nav.appendChild(next)
      wt.appendChild(nav)

      function save() { if (id) put('wt:' + id, JSON.stringify(done)) }
      function render() {
        steps.forEach(function (s, i) { s.classList.toggle('is-current', i === cur) })
        var doneCount = done.length
        count.textContent = 'Step ' + (cur + 1) + ' of ' + n + (doneCount ? ' - ' + doneCount + ' done' : '')
        fill.style.width = ((cur + 1) / n * 100) + '%'
        bar.setAttribute('aria-valuenow', String(cur + 1))
        dotBtns.forEach(function (b, i) {
          if (i === cur) b.setAttribute('aria-current', 'step')
          else b.removeAttribute('aria-current')
          b.classList.toggle('is-done', done.indexOf(i) > -1)
        })
        prev.disabled = cur === 0
        next.disabled = cur === n - 1
        var isDone = done.indexOf(cur) > -1
        doneBtn.setAttribute('aria-pressed', String(isDone))
        doneBtn.textContent = isDone ? 'Done - tap to undo' : 'Mark step done'
      }
      function show(x, keepView) {
        var i = typeof x === 'number' ? x : steps.indexOf(x)
        if (i < 0 || i >= n) return
        cur = i
        render()
        if (!keepView && wt.getBoundingClientRect().top < 0) wt.scrollIntoView({ block: 'start' })
      }
      prev.addEventListener('click', function () { show(cur - 1) })
      next.addEventListener('click', function () { show(cur + 1) })
      doneBtn.addEventListener('click', function () {
        var at = done.indexOf(cur)
        if (at > -1) done.splice(at, 1)
        else done.push(cur)
        save()
        render()
      })
      wt.addEventListener('keydown', function (e) {
        if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
        if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault() }
        else if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault() }
      })
      wt._csgShow = function (x) { show(x, true) }
      render()
    })
  }

  /* ---------- annotated screenshots (the numbered legend is written by the build) ---------- */
  function initAnnotated() {
    $$('figure.annotated').forEach(function (fig) {
      var spots = $$('.hotspot', fig)
      var media = $('img', fig) || $('.shot-missing', fig)
      if (!spots.length || !media) return
      var frame = el('div', 'annotated-frame')
      media.parentNode.insertBefore(frame, media)
      frame.appendChild(media)
      var pop = null
      var active = null
      function close() {
        if (pop) { pop.remove(); pop = null }
        if (active) { active.setAttribute('aria-expanded', 'false'); active.classList.remove('is-active'); active = null }
      }
      function open(pin, s, x, y) {
        close()
        active = pin
        pin.setAttribute('aria-expanded', 'true')
        pin.classList.add('is-active')
        pop = el('div', 'pop')
        pop.setAttribute('role', 'dialog')
        pop.setAttribute('aria-label', s.getAttribute('data-title') || 'Screen area')
        pop.appendChild(el('strong', '', (pin.textContent + '. ') + (s.getAttribute('data-title') || '')))
        var body = el('div')
        body.innerHTML = s.innerHTML
        pop.appendChild(body)
        var who = s.getAttribute('data-who')
        var undo = s.getAttribute('data-undo')
        if (who) pop.appendChild(el('p', 'pop-meta', 'Who can use it: ' + who))
        if (undo === 'yes') pop.appendChild(el('p', 'pop-meta', 'You can undo this.'))
        else if (undo === 'no') pop.appendChild(el('p', 'pop-meta', 'You cannot undo this.'))
        var x2 = el('button', 'pop-close', '×')
        x2.type = 'button'
        x2.setAttribute('aria-label', 'Close')
        x2.addEventListener('click', function (e) { e.stopPropagation(); close(); pin.focus() })
        pop.appendChild(x2)
        pop.addEventListener('click', function (e) { e.stopPropagation() })
        pop.style.left = x + '%'
        pop.style.transform = x < 30 ? 'translateX(-10%)' : x > 70 ? 'translateX(-90%)' : 'translateX(-50%)'
        if (y > 55) pop.style.bottom = (100 - y) + '%'; else pop.style.top = y + '%'
        pop.style.marginTop = y > 55 ? '0' : '18px'
        pop.style.marginBottom = y > 55 ? '18px' : '0'
        frame.appendChild(pop)
      }
      spots.forEach(function (s, i) {
        var xr = s.getAttribute('data-x')
        var yr = s.getAttribute('data-y')
        if (!isNum(xr) || !isNum(yr)) return // no position yet: the legend alone carries it
        var x = clamp(Number(xr), 0, 100)
        var y = clamp(Number(yr), 0, 100)
        var num = s.getAttribute('data-n') || String(i + 1)
        var pin = el('button', 'pin', num)
        pin.type = 'button'
        pin.style.left = x + '%'
        pin.style.top = y + '%'
        pin.setAttribute('aria-expanded', 'false')
        pin.setAttribute('aria-label', 'Point ' + num + ': ' + (s.getAttribute('data-title') || ''))
        pin.addEventListener('click', function (e) {
          e.stopPropagation()
          if (active === pin) close(); else open(pin, s, x, y)
        })
        frame.appendChild(pin)
      })
      doc.addEventListener('click', close)
      doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) close() })
    })
  }

  /* ---------- Telegram cards (the who / danger lines are written by the build) ---------- */
  function initTg() {
    $$('.tg-card').forEach(function (card) {
      var btns = $$('.tg-btn', card)
      var res = $$('.tg-result', card)
      if (!btns.length || !res.length) return
      card.classList.add('is-enhanced')
      res.forEach(function (r) { r.hidden = true })
      btns.forEach(function (b, i) {
        b.setAttribute('aria-expanded', 'false')
        b.addEventListener('click', function () {
          var wasOpen = b.getAttribute('aria-expanded') === 'true'
          btns.forEach(function (x) { x.setAttribute('aria-expanded', 'false') })
          res.forEach(function (r) { r.hidden = true })
          if (!wasOpen && res[i]) { b.setAttribute('aria-expanded', 'true'); res[i].hidden = false }
        })
      })
    })
  }

  /* ---------- decision trees ---------- */
  function initDtree() {
    $$('.dtree').forEach(function (t) {
      var nodes = $$('.dt-node', t)
      if (!nodes.length) return
      var map = {}
      nodes.forEach(function (n) { map[n.getAttribute('data-node')] = n })
      var start = map.start || nodes[0]
      var current = start
      var trail = []
      t.classList.add('is-enhanced')
      var nav = el('div', 'dt-nav')
      var back = el('button', 'btn', 'Back')
      var again = el('button', 'btn', 'Start over')
      back.type = again.type = 'button'
      nav.appendChild(back)
      nav.appendChild(again)
      t.appendChild(nav)
      function show(focus) {
        nodes.forEach(function (n) { n.classList.toggle('is-current', n === current) })
        back.disabled = !trail.length
        again.disabled = current === start && !trail.length
        if (focus) { current.setAttribute('tabindex', '-1'); current.focus({ preventScroll: true }) }
      }
      t.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-go]') : null
        if (!b || !t.contains(b)) return
        var to = map[b.getAttribute('data-go')]
        if (!to) return
        trail.push(current)
        current = to
        show(true)
      })
      back.addEventListener('click', function () { if (trail.length) { current = trail.pop(); show(true) } })
      again.addEventListener('click', function () { trail = []; current = start; show(true) })
      show(false)
    })
  }

  /* ---------- checklists ---------- */
  function initChecklists() {
    $$('.checklist').forEach(function (ul) {
      var boxes = $$('input[type=checkbox]', ul)
      if (!boxes.length) return
      var id = ul.id
      var saved = id ? getJSON('ck:' + id, []) : []
      if (!Array.isArray(saved)) saved = []
      var count = el('p', 'ck-count')
      count.setAttribute('aria-live', 'polite')
      ul.parentNode.insertBefore(count, ul.nextSibling)
      function update() {
        var list = []
        boxes.forEach(function (b, i) { if (b.checked) list.push(i) })
        if (id) put('ck:' + id, JSON.stringify(list))
        count.textContent = list.length + ' of ' + boxes.length + ' done'
        count.classList.toggle('is-all', list.length === boxes.length)
      }
      boxes.forEach(function (b, i) {
        if (saved.indexOf(i) > -1) b.checked = true
        b.addEventListener('change', update)
      })
      update()
    })
  }

  /* ---------- glossary tooltips ---------- */
  function initGlossary() {
    var terms = $$('.term')
    if (!terms.length) return
    var G = {}
    var gEl = $('#glossary')
    if (gEl) { try { G = JSON.parse(gEl.textContent) } catch (e) { G = {} } }
    var tip = el('div', 'term-tip')
    tip.id = 'csg-tip'
    tip.setAttribute('role', 'tooltip')
    tip.hidden = true
    doc.body.appendChild(tip)
    var cur = null
    var pinned = false
    function hide() {
      tip.hidden = true
      if (cur) cur.removeAttribute('aria-describedby')
      cur = null
      pinned = false
    }
    function show(t) {
      var g = G[t.getAttribute('data-term')]
      var def = (g && g.def) || t.getAttribute('data-def')
      if (!def) return
      if (cur && cur !== t) cur.removeAttribute('aria-describedby')
      cur = t
      tip.textContent = ''
      tip.appendChild(el('strong', '', (g && g.term) || t.textContent))
      tip.appendChild(doc.createTextNode(def))
      tip.hidden = false
      t.setAttribute('aria-describedby', 'csg-tip')
      var r = t.getBoundingClientRect()
      var w = tip.offsetWidth
      var h = tip.offsetHeight
      var left = clamp(r.left, 8, Math.max(8, window.innerWidth - w - 8))
      var top = r.bottom + 8
      if (top + h > window.innerHeight - 8 && r.top - h - 8 > 8) top = r.top - h - 8
      tip.style.left = left + 'px'
      tip.style.top = top + 'px'
    }
    terms.forEach(function (t) {
      if (t.getAttribute('title')) { t.setAttribute('data-def', t.getAttribute('title')); t.removeAttribute('title') }
      t.tabIndex = 0
      t.addEventListener('mouseenter', function () { if (!pinned) show(t) })
      t.addEventListener('mouseleave', function () { if (!pinned) hide() })
      t.addEventListener('focus', function () { if (!pinned) show(t) })
      t.addEventListener('blur', hide)
      t.addEventListener('click', function (e) {
        e.stopPropagation()
        if (cur === t && pinned) { hide(); return }
        show(t)
        pinned = true
      })
    })
    doc.addEventListener('click', function () { if (cur) hide() })
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cur) hide() })
    window.addEventListener('scroll', function () { if (cur) hide() }, { passive: true })
  }

  /* ---------- reveal a link target that is hidden by a role filter or a walkthrough step ---------- */
  function reveal(id) {
    var t = id ? doc.getElementById(id) : null
    if (!t) return null
    if (t.closest('[data-role-hidden]')) setRole('all', true)
    var st = t.closest('.wt-step')
    if (st) {
      var w = st.closest('.walkthrough')
      if (w && w._csgShow) w._csgShow(st)
    }
    return t
  }
  function decodeHash() {
    var h = location.hash.slice(1)
    try { return decodeURIComponent(h) } catch (e) { return h }
  }
  function initHash() {
    window.addEventListener('hashchange', function () {
      var t = reveal(decodeHash())
      if (t) t.scrollIntoView()
    })
    if (location.hash) {
      var t = reveal(decodeHash())
      if (t) t.scrollIntoView()
    }
  }

  /* ---------- search ---------- */
  function initSearch() {
    var box = $('#csg-search')
    var input = $('#csg-search-input')
    var list = $('#csg-results')
    if (!box || !input || !list) return
    var idx = []
    var iEl = $('#search-index')
    if (iEl) { try { idx = JSON.parse(iEl.textContent) } catch (e) { idx = [] } }
    var RANK = { chapter: 0, section: 1, step: 2, button: 3, hotspot: 4, term: 5 }
    var LABEL = { chapter: 'Chapter', section: 'Section', step: 'Step', button: 'Button', hotspot: 'Screen area', term: 'Term' }
    var results = []
    var sel = 0
    var opener = null

    function words() { return input.value.toLowerCase().split(/\s+/).filter(Boolean) }
    function run() {
      var w = words()
      if (!w.length) return []
      var out = []
      idx.forEach(function (e) {
        var t = String(e.t).toLowerCase()
        var hay = t + ' ' + String(e.d || '').toLowerCase()
        for (var i = 0; i < w.length; i++) if (hay.indexOf(w[i]) < 0) return
        var pos = t.indexOf(w[0])
        var score = (RANK[e.k] === undefined ? 6 : RANK[e.k]) * 10 + (pos === 0 ? 0 : pos > 0 ? 3 : 6)
        out.push({ e: e, s: score })
      })
      out.sort(function (a, b) { return a.s - b.s || a.e.t.length - b.e.t.length })
      return out.slice(0, 30).map(function (o) { return o.e })
    }
    function marked(parent, text, w) {
      var lower = text.toLowerCase()
      var hits = []
      w.forEach(function (x) {
        var i = lower.indexOf(x)
        if (i > -1) hits.push([i, i + x.length])
      })
      hits.sort(function (a, b) { return a[0] - b[0] })
      var pos = 0
      hits.forEach(function (h) {
        if (h[0] < pos) return
        parent.appendChild(doc.createTextNode(text.slice(pos, h[0])))
        parent.appendChild(el('mark', '', text.slice(h[0], h[1])))
        pos = h[1]
      })
      parent.appendChild(doc.createTextNode(text.slice(pos)))
    }
    function render() {
      list.textContent = ''
      var w = words()
      results = run()
      sel = 0
      if (!w.length || !results.length) {
        var li = el('li', 'search-hint', w.length ? 'Nothing found. Try one short word.' : 'Type to search chapters, steps, buttons and terms.')
        li.setAttribute('aria-live', 'polite')
        list.appendChild(li)
        input.removeAttribute('aria-activedescendant')
        return
      }
      results.forEach(function (e, i) {
        var li = el('li')
        li.id = 'csg-opt-' + i
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', String(i === 0))
        li.appendChild(el('span', 'sr-kind', LABEL[e.k] || e.k))
        var t = el('span')
        marked(t, e.t, w)
        li.appendChild(t)
        if (e.d) li.appendChild(el('span', 'sr-def', e.d))
        else if (e.c && e.k !== 'chapter') li.appendChild(el('span', 'sr-in', 'in ' + e.c))
        li.addEventListener('click', function () { go(e) })
        list.appendChild(li)
      })
      input.setAttribute('aria-activedescendant', 'csg-opt-0')
    }
    function move(d) {
      if (!results.length) return
      var items = $$('[role=option]', list)
      items[sel].setAttribute('aria-selected', 'false')
      sel = (sel + d + results.length) % results.length
      items[sel].setAttribute('aria-selected', 'true')
      items[sel].scrollIntoView({ block: 'nearest' })
      input.setAttribute('aria-activedescendant', items[sel].id)
    }
    function open() {
      opener = doc.activeElement
      box.hidden = false
      root.classList.add('search-open')
      input.value = ''
      render()
      input.focus()
    }
    function close() {
      box.hidden = true
      root.classList.remove('search-open')
      if (opener && opener.focus) opener.focus()
    }
    function go(e) {
      close()
      if (!e || !e.h) return
      var t = reveal(e.h)
      if (location.hash === '#' + e.h) { if (t) t.scrollIntoView() } else location.hash = '#' + e.h
    }
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-controls', 'csg-results')
    input.setAttribute('aria-expanded', 'true')
    list.setAttribute('role', 'listbox')
    input.addEventListener('input', render)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { move(1); e.preventDefault() }
      else if (e.key === 'ArrowUp') { move(-1); e.preventDefault() }
      else if (e.key === 'Enter') { go(results[sel]); e.preventDefault() }
      else if (e.key === 'Tab') e.preventDefault()
    })
    box.addEventListener('click', function (e) { if (e.target === box) close() })
    var btn = $('#csg-search-btn')
    if (btn) btn.addEventListener('click', open)
    doc.addEventListener('keydown', function (e) {
      if (!box.hidden && e.key === 'Escape') { close(); e.preventDefault(); return }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (box.hidden) open(); else close()
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && box.hidden && !typing(e.target)) {
        e.preventDefault()
        open()
      }
    })
  }

  /* ---------- contents drawer (phones) ---------- */
  function initToc() {
    var toc = $('#csg-toc')
    var btn = $('#csg-menu')
    var back = $('.toc-backdrop')
    if (!toc || !btn) return
    function setOpen(o) {
      root.classList.toggle('toc-open', o)
      btn.setAttribute('aria-expanded', String(o))
      if (back) back.hidden = !o
      if (o) { var a = $('a', toc); if (a) a.focus() } else if (doc.activeElement && toc.contains(doc.activeElement)) btn.focus()
    }
    btn.addEventListener('click', function () { setOpen(!root.classList.contains('toc-open')) })
    if (back) back.addEventListener('click', function () { setOpen(false) })
    toc.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a') && root.classList.contains('toc-open')) setOpen(false)
    })
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('toc-open')) setOpen(false)
    })
  }

  /* ---------- scrollspy ---------- */
  function initSpy() {
    var toc = $('#csg-toc')
    if (!toc) return
    var links = {}
    $$('a[href^="#"]', toc).forEach(function (a) { links[a.getAttribute('href').slice(1)] = a })
    var heads = $$('#csg-main [id]').filter(function (h) { return links[h.id] })
    if (!heads.length) return
    var ticking = false
    var lastId = null
    function update() {
      ticking = false
      var active = null
      heads.forEach(function (h) {
        if (h.offsetParent === null && h.getClientRects().length === 0) return
        if (h.getBoundingClientRect().top <= 120) active = h
      })
      var id = active ? active.id : heads[0].id
      if (id === lastId) return
      lastId = id
      $$('.is-active', toc).forEach(function (n) { n.classList.remove('is-active'); n.removeAttribute('aria-current') })
      var a = links[id]
      a.classList.add('is-active')
      a.setAttribute('aria-current', 'location')
      var ch = a.closest('.toc-ch')
      if (ch) ch.classList.add('is-active')
      var r = a.getBoundingClientRect()
      var nr = toc.getBoundingClientRect()
      if (toc.scrollHeight > toc.clientHeight && r.height) {
        if (r.top < nr.top + 8) toc.scrollTop -= nr.top + 8 - r.top
        else if (r.bottom > nr.bottom - 8) toc.scrollTop += r.bottom - nr.bottom + 8
      }
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update) }
    }, { passive: true })
    update()
  }

  /* ---------- go ---------- */
  ;[initTheme, initRoles, initWalkthroughs, initAnnotated, initTg, initDtree, initChecklists,
    initGlossary, initSearch, initToc, initSpy, initHash].forEach(function (f) {
    try { f() } catch (e) { if (window.console) console.error(f.name, e) }
  })
})()
