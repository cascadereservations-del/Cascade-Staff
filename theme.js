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
  // Plain bars (v5): glass off. A_plainAuto decides by itself when the phone cannot blur, is slow, saves data or asks for less transparency / more contrast.
  // The More toggle overrides it: 'on' / 'off' kept in localStorage under cascade-plain (memory in ?demo). Same no-flash rule: decided here, before first paint.
  var PKEY = 'cascade-plain', pmem = null;
  function A_plainAuto(env) {
    env = env || {};
    var nav = env.navigator || {}, conn = nav.connection || {};
    if (env.supportsBlur === false) return true;
    if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 3) return true;
    if (conn.saveData === true) return true;
    return !!(env.reducedTransparency || env.moreContrast);
  }
  function A_plainEnv() {
    var m = function (q) { try { return !!(root.matchMedia && root.matchMedia(q).matches); } catch (e) { return false; } };
    var blur = true; try { blur = !!(root.CSS && root.CSS.supports && (root.CSS.supports('backdrop-filter', 'blur(1px)') || root.CSS.supports('-webkit-backdrop-filter', 'blur(1px)'))); } catch (e) {}
    return { navigator: root.navigator, supportsBlur: blur, reducedTransparency: m('(prefers-reduced-transparency: reduce)'), moreContrast: m('(prefers-contrast: more)') };
  }
  function plainChoice() { if (demo) return pmem; try { var v = root.localStorage.getItem(PKEY); return v === 'on' || v === 'off' ? v : null; } catch (e) { return null; } }
  function plainOn() { var c = plainChoice(); return c ? c === 'on' : A_plainAuto(A_plainEnv()); }
  function applyPlain() { if (plainOn()) el.setAttribute('data-plain', '1'); else el.removeAttribute('data-plain'); }
  function setPlain(on) {
    var v = on === null ? null : on ? 'on' : 'off';
    if (demo) pmem = v; else try { if (v) root.localStorage.setItem(PKEY, v); else root.localStorage.removeItem(PKEY); } catch (e) {}
    applyPlain();
  }
  root.CSTheme = { get: get, set: set, isDemo: isDemo, plainOn: plainOn, setPlain: setPlain, plainChoice: plainChoice, A_plainAuto: A_plainAuto };
  var t = get(); if (t !== 'auto') el.setAttribute('data-theme', t);
  applyPlain();
})(window);
