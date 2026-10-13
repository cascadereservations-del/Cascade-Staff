/* Run in the browser on tests/I_page.html (javascript_tool). Walks list, item sheet, each form and confirm, shopping; reports problems only. */
(async function () {
  var out = [], tick = function () { return new Promise(function (r) { setTimeout(r, 30); }); };
  function audit(label) {
    var de = document.documentElement;
    if (de.scrollWidth > de.clientWidth) out.push(label + ': horizontal scroll ' + de.scrollWidth + '>' + de.clientWidth);
    var layer = document.querySelector('[data-i-layer] .sheet'), scope = document.getElementById('host');
    scope.querySelectorAll('*').forEach(function (e) {
      if (e.closest('[inert]') && layer) return;
      var cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return;
      var own = Array.prototype.some.call(e.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
      if (own && parseFloat(cs.fontSize) < 13 && !e.closest('.sr')) out.push(label + ': font ' + cs.fontSize + ' on "' + e.textContent.trim().slice(0, 24) + '"');
      if (e.matches('button, input, a[href], .I_row[data-act]') && !e.closest('.sr') && (r.height < 44 || r.width < 44) && e.type !== 'hidden') out.push(label + ': target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (e.textContent.trim().slice(0, 20) || e.id || e.className));
      if (r.right > de.clientWidth + 1 && r.width) out.push(label + ': overflows right ' + (e.className || e.tagName));
    });
  }
  var host = document.getElementById('host'), click = function (sel) { var e = host.querySelector(sel); if (!e) { out.push('missing ' + sel); return false; } e.click(); return true; };
  audit('list'); await tick();
  click('[data-act="open"][data-id="d1"]'); await tick(); audit('sheet-menu');
  if (host.querySelector('[data-kind="count"]')) { click('[data-kind="count"]'); await tick(); audit('count'); host.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await tick(); audit('count-confirm'); click('[data-act="back"]'); click('[data-act="back"]'); await tick(); }
  if (host.querySelector('[data-kind="used"]')) { click('[data-kind="used"]'); await tick(); audit('used'); host.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await tick(); audit('used-confirm'); click('[data-act="back"]'); click('[data-act="back"]'); await tick(); }
  if (host.querySelector('[data-kind="recv"]')) { click('[data-kind="recv"]'); await tick(); audit('recv'); click('[data-act="back"]'); await tick(); }
  click('[data-kind="shop"]'); await tick(); audit('shop'); click('[data-act="back"]'); await tick();
  click('.scrim'); await tick();
  click('[data-act="tab"][data-to="shopping"]'); await tick(); audit('shopping');
  var sr = host.querySelector('[data-act="shop-open"]'); if (sr) { sr.click(); await tick(); audit('shop-sheet'); }
  return JSON.stringify({ w: innerWidth, theme: document.documentElement.getAttribute('data-theme'), problems: out });
})();
