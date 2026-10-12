/* Cascade Staff - theme switch. Loaded in <head> before first paint so a saved choice never flashes. Same key as the mockups. */
(function (root) {
  // The one demo rule, identical to isDemo in demo.js (tests/demo.test.mjs checks they agree): the bare key `demo` in the raw query, not demo=0/false/no/off.
  function isDemo(s) { var m = /[?&]demo(?:=([^&]*))?(?:&|$)/.exec(String(s || '')); return !!m && !/^(0|false|no|off)$/i.test(m[1] || ''); }
  var KEY = 'cascade-theme', demo = isDemo(root.location.search), mem = 'auto', el = root.document.documentElement;
  function get() { if (demo) return mem; try { var t = root.localStorage.getItem(KEY); return t === 'dark' || t === 'light' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function set(t) {
    if (demo) mem = t === 'dark' || t === 'light' ? t : 'auto'; // ?demo: kept in memory for this page, never read from or written to storage
    else try { if (t === 'dark' || t === 'light') root.localStorage.setItem(KEY, t); else root.localStorage.removeItem(KEY); } catch (e) {}
    if (t === 'dark' || t === 'light') el.setAttribute('data-theme', t); else el.removeAttribute('data-theme');
  }
  root.CSTheme = { get: get, set: set, isDemo: isDemo };
  var t = get(); if (t !== 'auto') el.setAttribute('data-theme', t);
})(window);
