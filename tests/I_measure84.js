/* s84: run in the browser on tests/I_page.html?role=owner (javascript_tool) at 320 px wide. Walks group headers, Scan, the scan sheet,
   unknown code, new item, link picker, report sheet, item card and the price form. Prints problems only: horizontal scroll,
   anything past the right edge, tap targets under 44 px. Last run 2026-10-14 at 320 px: no problems. */
(async function () {
  var tick = function () { return new Promise(function (r) { setTimeout(r, 40); }); }, out = [], de = document.documentElement, host = document.getElementById('host');
  function audit(l) {
    if (de.scrollWidth > de.clientWidth) out.push(l + ': hscroll ' + de.scrollWidth + '>' + de.clientWidth);
    host.querySelectorAll('*').forEach(function (e) {
      if (e.closest('[inert]') && document.querySelector('[data-i-layer] .sheet')) return;
      var r = e.getBoundingClientRect(), cs = getComputedStyle(e); if (!r.width || !r.height || cs.display === 'none') return;
      if (r.right > de.clientWidth + 1) out.push(l + ': overflow ' + (e.className || e.tagName) + ' right=' + Math.round(r.right));
      if (e.matches('button,input,select,a[href]') && !e.closest('.sr') && (r.height < 44 || r.width < 44)) out.push(l + ': small target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (e.textContent.trim().slice(0, 18) || e.id));
    });
  }
  var click = function (s) { var e = host.querySelector(s); if (!e) { out.push('missing ' + s); return false; } e.click(); return true; };
  audit('list'); await tick();
  click('[data-act="scan"]'); await tick(); audit('scan sheet');
  var f = host.querySelector('#I_f_code'); f.value = 'nope-1'; f.dispatchEvent(new Event('input', { bubbles: true }));
  host.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await tick(); audit('unknown');
  click('[data-act="scan-new"]'); await tick(); audit('new item form');
  click('[data-act="back"]'); await tick(); click('[data-act="scan-pick"]'); await tick(); audit('pick');
  click('[data-act="close"]'); await tick();
  click('[data-act="report"]'); await tick(); audit('report'); click('[data-act="close"]'); await tick();
  click('[data-act="open"][data-id="d1"]'); await tick(); audit('card'); click('[data-kind="price"]'); await tick(); audit('price');
  return JSON.stringify({ w: innerWidth, problems: out });
})();
