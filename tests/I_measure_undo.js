/* s84 r2 (R2-1): run in the browser on tests/I_page.html at 320x640 (javascript_tool). Mounts the module with a mock client, makes one write and
   measures the undo bar against a 64 px fake tab bar. Measured 2026-10-15: owner (Count) and cleaner (Running low) both: top 442, bottom 508,
   left 16, right 304 of 320x640, tab bar top 576, in view, clear of the tab bar, Undo button 91x48, same position after scrolling. */
(async function () {
  var tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 100); }); }, host = document.getElementById('host'), out = [];
  document.documentElement.style.setProperty('--tabbar-h', '64px');
  var tb = document.createElement('nav'); tb.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:64px;background:#222;z-index:6'; document.body.appendChild(tb);
  var items = []; for (var i = 0; i < 30; i++) items.push({ id: 'i' + i, name: 'Item number ' + i, category: 'Bath', unit: 'rolls', qty: i % 7, reorderBelow: 3, consumable: true, active: true, purchaseUnit: 'pack', unitsPerPurchase: 12, par: 36, codes: [], countedAt: null });
  var client = { rpc: async function (n) { return n === 'get_inventory_catalogue_v1' ? { data: { items: items }, error: null } : n === 'reconcile_inventory_baseline_v1' ? { data: { ok: true, movementId: 'm1' }, error: null } : { data: { ok: true, id: 'sh1' }, error: null }; },
    from: function () { var q = { select: function () { return q; }, eq: function () { return q; }, in: function () { return q; }, order: function () { return q; }, limit: function () { return q; }, then: function (r) { return Promise.resolve({ data: [], error: null }).then(r); } }; return q; },
    auth: { getSession: async function () { return { data: { session: { user: { id: 'u1' } } } }; } } };
  async function one(role, kind) {
    window.I_Stock.unmount(); window.I_Stock.mount(host, { client: client, demo: false, role: role, sub: '', navigate: function () {}, toast: function () {}, haptic: function () {} }); await tick(300);
    host.querySelector('[data-act="open"]').click(); await tick(); host.querySelector('[data-kind="' + kind + '"]').click(); await tick();
    var sub = function () { host.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); };
    sub(); await tick(); if (kind === 'count') { sub(); } await tick(350); window.scrollTo(0, 500); await tick();
    var bar = host.querySelector('.I_undo'); if (!bar) { out.push(role + ': NO BAR'); return; }
    var r = bar.getBoundingClientRect(), t = tb.getBoundingClientRect();
    out.push(role + ': top ' + Math.round(r.top) + ' bottom ' + Math.round(r.bottom) + ' tabbar top ' + Math.round(t.top) + ' inView=' + (r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= document.documentElement.clientWidth) + ' clear=' + (r.bottom <= t.top));
  }
  await one('owner', 'count'); await one('cleaner', 'low');
  return JSON.stringify(out);
})();
