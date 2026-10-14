/* Run in the browser on tests/X_page.html at 320x640 (javascript_tool). Reports numbers and problems for the list and for a thread with draft options open.
   Rules: no horizontal scroll, every visible button and link at least 44 px tall, no visible text under 12 px. */
(async function () {
  var tick = function () { return new Promise(function (r) { setTimeout(r, 60); }); }, res = {};
  function audit(label) {
    var de = document.documentElement, root = document.querySelector('.X_root'), bad = [], n = 0, minH = 999, minFont = 999;
    root.querySelectorAll('*').forEach(function (e) {
      var cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || e.closest('[hidden]') || e.closest('.X_sr')) return;
      var own = Array.prototype.some.call(e.childNodes, function (x) { return x.nodeType === 3 && x.textContent.trim(); });
      if (own) { var f = parseFloat(cs.fontSize); minFont = Math.min(minFont, f); if (f < 12) bad.push('font ' + f + ' on "' + e.textContent.trim().slice(0, 24) + '"'); }
      if (e.matches('button, a[href]') && !e.closest('.X_row') ) { n++; minH = Math.min(minH, r.height); if (r.height < 44) bad.push('target ' + Math.round(r.height) + 'px "' + e.textContent.trim().slice(0, 24) + '"'); }
      if (e.matches('.X_row')) { n++; minH = Math.min(minH, r.height); if (r.height < 44) bad.push('row ' + Math.round(r.height) + 'px'); }
    });
    res[label] = { viewport: innerWidth + 'x' + innerHeight, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, hscroll: de.scrollWidth > 320, targets: n, minTargetHeight: Math.round(minH), minFontPx: minFont, problems: bad };
  }
  var host = document.getElementById('host'), click = function (sel) { var e = host.querySelector(sel); if (!e) { res['missing ' + sel] = true; return false; } e.click(); return true; };
  await tick(); click('[data-xa="filter"][data-v="all"]'); await tick(); audit('list');
  click('[data-xa="open"][data-v="demo-1"]'); await tick();
  window.X_Inbox.unmount(); window.X_Inbox.mount(host, { client: null, demo: true, role: 'owner', sub: 'demo-1', houseTimes: { check_out: '12:00', check_in: '14:00' }, navigate: function () {}, toast: function () {}, haptic: function () {} }); await tick();
  click('[data-xa="draft"]'); await tick(); audit('thread with draft options');
  var comp = document.querySelector('.X_comp').getBoundingClientRect(); res.composer = { height: Math.round(comp.height), viewportShare: Math.round(comp.height / innerHeight * 100) + '%' };
  return JSON.stringify(res);
})();
