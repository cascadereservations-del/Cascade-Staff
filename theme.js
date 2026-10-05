/* Cascade Staff - theme switch. Loaded in <head> before first paint so a saved choice never flashes. Same key as the mockups. */
(function (root) {
  var KEY = 'cascade-theme', el = root.document.documentElement;
  function get() { try { var t = root.localStorage.getItem(KEY); return t === 'dark' || t === 'light' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function set(t) {
    try { if (t === 'dark' || t === 'light') root.localStorage.setItem(KEY, t); else root.localStorage.removeItem(KEY); } catch (e) {}
    if (t === 'dark' || t === 'light') el.setAttribute('data-theme', t); else el.removeAttribute('data-theme');
  }
  root.CSTheme = { get: get, set: set };
  var t = get(); if (t !== 'auto') el.setAttribute('data-theme', t);
})(window);
