// Lane F (adaptive pass): fluid type and spacing, the width classes, the rail / grid / dialog scoping, reserved heights, the 44 px rule in every class.
// The formulas are evaluated here (rem = 16 px, the browser default), so a wrong number fails without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CS, read, boot, HOMEWITH, baseHandlers, stayRow, TODAY } from './_a_harness.mjs';

const tokens = read('tokens.css'), css = read('styles.css'), payCss = read('pay/C_pay.css'), noticeCss = read('pay/C_notice.css');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const tok = (name) => { const m = new RegExp('--v5-' + name + ':\\s*(clamp\\([^;]*\\));').exec(tokens); assert.ok(m, name + ' is a clamp()'); return m[1]; };
// clamp(min, a rem + b vw, max) | clamp(12px, 0.75rem, 14px) at a viewport width, in px
const len = (s, w) => { s = s.trim(); let m = /^([\d.]+)rem$/.exec(s); if (m) return +m[1] * 16; m = /^([\d.]+)px$/.exec(s); if (m) return +m[1]; m = /^([\d.]+)vw$/.exec(s); if (m) return +m[1] * w / 100; throw new Error('length ' + s); };
function evalClamp(c, w) {
  const parts = /^clamp\(([^,]+),\s*(.+),\s*([^,]+)\)$/.exec(c.trim()); assert.ok(parts, c);
  const mid = parts[2].split('+').map((x) => len(x, w)).reduce((a, b) => a + b, 0);
  return Math.min(len(parts[3], w), Math.max(len(parts[1], w), mid));
}
const WIDTHS = [320, 360, 412, 600, 768, 1024, 1280];
const TYPE = { display: [36, 44], section: [24, 30], num: [22, 28], body: [17, 19], 2: [15, 17], label: [13, 14], min: [13, 13] };

test('F_ type tokens: rem + vw clamp(), exactly today\'s px at 360, growing to their maximum by 1024, never under 12 px, monotonic', () => {
  for (const [name, [base, max]] of Object.entries(TYPE)) {
    const c = tok('t-' + name); assert.match(c, /^clamp\([\d.]+rem, [\d.]+rem \+ [\d.]+vw, [\d.]+rem\)$/, name);
    const v = WIDTHS.map((w) => evalClamp(c, w));
    assert.ok(Math.abs(v[1] - base) < 0.1, name + ' at 360 is ' + v[1] + ', today is ' + base);
    assert.ok(Math.abs(evalClamp(c, 1024) - max) < 0.1 && evalClamp(c, 1600) === max * 1, name + ' reaches ' + max + ' by 1024 and holds');
    for (let i = 1; i < v.length; i++) assert.ok(v[i] >= v[i - 1] - 1e-9, name + ' never shrinks as the screen grows: ' + v.join(', '));
    assert.ok(Math.min(...v) >= 13, name + ' is never under 13 px (s82 F3): ' + v.join(', '));
  }
  assert.equal(evalClamp(tok('t-min'), 320), 13, 'the floor is 13 px');
  const chrome = tok('t-chrome'); assert.equal(evalClamp(chrome, 360), 13); assert.equal(evalClamp(chrome, 1280), 13, 'tab labels are capped chrome and follow the text size only up to 14 px'); assert.equal(chrome, 'clamp(13px, 0.8125rem, 14px)');
});

test('F_ spacing and radius tokens follow the same method: 16 / 14 / 16 / 24 at 360, gentle growth, fixed minimums, the sheet radius and targets do not scale', () => {
  const at = (n, w) => evalClamp(tok(n), w);
  assert.equal(Math.round(at('gutter', 360) * 10) / 10, 16); assert.equal(Math.round(at('gutter', 1024)), 32); assert.equal(at('gutter', 320), 16, 'fixed minimum: 16 px, no shrink under 360');
  assert.equal(Math.round(at('gap', 360)), 14); assert.equal(Math.round(at('gap', 1024)), 20); assert.equal(Math.round(at('pad', 360)), 16); assert.equal(Math.round(at('pad', 1024)), 20);
  assert.match(tokens, /--v5-r-sm: 8px; --v5-r-md: 12px; --v5-r-card: 16px;/); /* s85: the radius scale is fixed 8 / 12 / 16 / 999, 24 on sheets */
  assert.match(tokens, /--v5-r-sheet: 24px;/); assert.match(tokens, /--v5-touch: 44px;/); assert.match(tokens, /--v5-press-ms: 160ms;/);
  for (const n of ['gutter', 'gap', 'pad']) { let last = 0; for (const w of WIDTHS) { const x = at(n, w); assert.ok(x >= last - 1e-9, n); last = x; } }
});

test('F_ text: no px font size is left in styles.css, pay/C_pay.css or pay/C_notice.css; the root follows the user\'s own text size; no px root anywhere', () => {
  for (const [f, s] of [['styles.css', css], ['pay/C_pay.css', payCss], ['pay/C_notice.css', noticeCss]]) {
    const body = strip(s), left = [];
    for (const m of body.matchAll(/font-size:\s*([^;}]+)/g)) if (/\d\s*px/.test(m[1])) left.push(m[0]);
    for (const m of body.matchAll(/(?:^|[;{\s])font:\s*([^;}]+)/g)) { const v = m[1].replace(/\/\s*[^\s;]+/g, ''); if (/\d\s*px/.test(v)) left.push(m[0]); } // the size part of the shorthand (a px line-height beside a fixed box is checked below)
    assert.deepEqual(left, [], f + ' still locks a text size in px');
  }
  const pxLines = (strip(css).match(/\/[\d.]+px var\(--font-ui\)/g) || []).length; assert.ok(pxLines <= 3, 'only the three centred counters keep a px line-height beside their fixed box: ' + pxLines);
  assert.match(css, /html \{ font-size: 100%; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; \}/);
  assert.doesNotMatch(strip(css), /html\s*\{[^}]*font-size:\s*\d+px/); assert.doesNotMatch(strip(css), /(?:^|\n)\s*:root\s*\{[^}]*font-size:\s*\d+px/);
  assert.doesNotMatch(read('app.js'), /documentElement\.style\.fontSize|style\.fontSize\s*=/, 'the root size is never changed from script');
  assert.match(css, /body \{ font: 400 var\(--v5-t-body\)\//); assert.doesNotMatch(css, /font-size:\s*(?:1[0-9]|2[0-9]|3[0-9])px/);
});

test('F_ text: sizes between the seven steps use the same curve inline: equal to today at 360, growing at most 12 percent, never smaller than today', () => {
  const m = [...strip(css).matchAll(/clamp\(([\d.]+)rem, ([\d.]+)rem \+ ([\d.]+)vw, ([\d.]+)rem\)/g)].filter((x) => +x[1] > 0.7 && !/--v5-t-/.test(x[0]));
  assert.ok(m.length > 20, 'converted sizes found: ' + m.length);
  for (const x of m) { const c = x[0], base = +x[1] * 16, v360 = evalClamp(c, 360), v1024 = evalClamp(c, 1024);
    if (!/^clamp\([\d.]+rem, [\d.]+rem \+ [\d.]+vw, [\d.]+rem\)$/.test(c)) continue;
    assert.ok(Math.abs(v360 - base) < 0.08, c + ' is ' + v360 + ' at 360, expected ' + base); assert.ok(v1024 <= base * 1.12 + 0.01 && v1024 >= base, c); }
});

test('F_ 200 percent text: a control grows instead of clipping (min-height, not height), the photo header grows with its text, nothing but the Notices rows and the wordmark truncates', () => {
  const b = strip(css);
  for (const sel of ['\\.chip', '\\.btn', '\\.btn-sm', '\\.input', '\\.pill']) assert.doesNotMatch(b, new RegExp('(?:^|\\n|\\})\\s*' + sel + ' \\{[^}]*(?<!min-)\\bheight:\\s*(?:var\\(--touch\\)|44px|26px)'), sel + ' has a fixed height');
  assert.match(payCss, /\.btn \{ min-height: var\(--v5-touch\)/); assert.match(payCss, /\.btn-block \{ min-height: 52px;/);
  assert.match(b, /\.A_hero \{ width: 100%; height: auto; min-height: 252px; display: flex; flex-direction: column; \}/); assert.match(b, /\.A_greet \{ position: static; margin-top: auto;/);
  const nowrap = [...b.matchAll(/([^{}]+)\{[^}]*white-space:\s*nowrap[^}]*\}/g)].map((x) => x[1].trim()).filter((s) => !/^\.sr$|\.okbox\.sr/.test(s));
  const allowed = /A_noticecard|\.appbar \.ttl|\.doorbar \.ttl|A_herobar \.brand|E_pill|\.pill|\.A_steps b|\.A_tag|\.A_legend|\.A_chipglass|\.cal|\.tgbtn|\.tab|\.chip|\.A_slide|\.A_chk|\.btn|\.A_filters|\.A_mk|\.badge|\.count|\.toast|\.ctval|\.lead|\.A_switch|\.seg|\.sw|\.A_prof|\.dots|\.A_hours|\.A_greet|\.H_railhead|\.H_offline/;
  assert.deepEqual(nowrap.filter((s) => !allowed.test(s)), [], 'an unexpected no-wrap rule');
});

test('F_ width classes: the thresholds are rem (22.5 / 37.5 / 52.5), a bigger text size lands in a narrower class, and the names are by width only', () => {
  assert.deepEqual([319, 359, 360, 599, 600, 839, 840, 1280].map((w) => CS.F_widthClass(w)), ['F_compact', 'F_compact', 'F_phone', 'F_phone', 'F_medium', 'F_medium', 'F_wide', 'F_wide']);
  assert.equal(CS.F_widthClass(840, 16), 'F_wide'); assert.equal(CS.F_widthClass(840, 20), 'F_medium', 'a 20 px root text size: 840 px is only 42 rem');
  assert.equal(CS.F_widthClass(600, 28), 'F_compact');
  const b = strip(css), queries = [...b.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim());
  for (const q of ['(max-width: 22.4375rem)', '(min-width: 37.5rem)', '(min-width: 52.5rem)', '(min-width: 52.5rem), (min-width: 37.5rem) and (max-height: 30rem)', '(max-height: 30rem) and (orientation: landscape)']) assert.ok(queries.includes(q), 'media query ' + q);
  assert.deepEqual(queries.filter((q) => /orientation/.test(q) && !/max-height/.test(q)), [], 'never orientation alone');
  assert.deepEqual(queries.filter((q) => /device|pointer: coarse|hover: none/.test(q)), [], 'never by device type');
  assert.match(css, /F_compact {2}under 360 px/); assert.match(css, /F_medium {3}600 to 839 px/); assert.match(css, /F_wide {5}840 px and up/);
});

// the rules inside one media block (the first with exactly this query), as text
const block = (q) => { const s = strip(css), i = s.indexOf('@media ' + q + ' {'); assert.ok(i >= 0, q); let d = 0, j = s.indexOf('{', i); const st = j; for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } return s.slice(st + 1, j); };
const outsideF = () => { let s = strip(css); const i = s.indexOf('F_ adaptive pass (s81'); s = s.slice(i); for (;;) { const k = s.indexOf('@media'); if (k < 0) break; let d = 0, j = s.indexOf('{', k); for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } s = s.slice(0, k) + s.slice(j + 1); } return s; };

test('F_ scoping: the card grid, the dialogs, the rail and the side sheets exist only inside their width class; the base rules stay the phone layout', () => {
  const medium = block('(min-width: 37.5rem)'), rail = block('(min-width: 52.5rem), (min-width: 37.5rem) and (max-height: 30rem)'), wide = block('(min-width: 52.5rem)'), base = outsideF();
  const grid = block('(min-width: 42rem)'); assert.match(grid, /\.A_body \{ display: block; column-count: 2;/, 'two columns start at 42 rem (672 px), not 600'); assert.doesNotMatch(grid, /#v-more \.stack/, '3.1.1: More has its own two independent stacks (H_cols), not a row-aligned grid'); assert.match(grid, /\.A_body > \.F_span/); assert.doesNotMatch(medium, /grid-template-columns: repeat\(2/, 'the 37.5 rem block keeps the bar and the dialogs only');
  assert.match(medium, /translate\(-50%, -50%\)/); assert.match(medium, /width: min\(36rem, calc\(100% - 2 \* var\(--gutter\)\)\)/); assert.match(medium, /max-height: 85dvh/); assert.match(medium, /\.E_grab \{ display: none; \}/);
  assert.match(medium, /\.tabbar \{ max-width: 30rem; \}/);
  assert.match(rail, /\.tabbar \{ left: 0; right: auto; top: 0; bottom: 0; width: var\(--v5-nav-w\)/); assert.match(rail, /flex-direction: column/); assert.match(rail, /#app\.F_nav \{ padding-left: var\(--v5-nav-w\); \}/);
  assert.match(wide, /data-F-kind="day"\], \.sheet\[data-F-kind="attn"\] \{[^}]*right: 0; top: 0; bottom: 0; width: min\(26rem, 40vw\)/); assert.doesNotMatch(wide, /data-F-tab="stays"/, 'the Stays screen is gone (s82)');
  for (const x of [/grid-template-columns: repeat\(2/, /translate\(-50%/, /width: var\(--v5-nav-w\)/, /data-F-kind/, /flex-direction: column; justify-content: flex-start/]) assert.doesNotMatch(base, x, 'not in the base rules: ' + x);
  assert.doesNotMatch(block('(max-width: 22.4375rem)'), /grid-template-columns: repeat\(2|translate\(-50%|flex-direction: column/, 'the compact class is the phone column, tighter');
  assert.match(block('(max-width: 22.4375rem)'), /\.cal \.d \{ padding: 2px 3px; \}/); assert.doesNotMatch(block('(max-width: 22.4375rem)'), /min-height: (?:[0-3]\d)px/, 'a cell may be narrow, never short');
  assert.match(css, /\.cal \.d \{ aspect-ratio: 1; min-height: 44px;/, 'the month cell keeps its 44 px floor in every class');
});

test('F_ reserved heights are unchanged and per-class boxes are CSS only: Notices 216, pill slot 124-184 x 44, hero 252, grabber 56, aspect-ratio crops, no JS width read', () => {
  assert.match(css, /\.A_noticecard \{ height: 216px; overflow: hidden; align-content: start; \}/);
  assert.match(css, /button\.A_chipglass\.E_pill \{ width: auto; min-width: 124px; max-width: 184px; height: var\(--touch\);/);
  assert.match(css, /\.A_hero \{ min-height: clamp\(12\.5rem, 32vh, 15\.75rem\); \}/); assert.match(css, /\.E_grab \{ position: sticky; top: 0; z-index: 3; height: 28px;/);
  assert.match(block('(min-width: 37.5rem)'), /\.A_hero \{ aspect-ratio: 16 \/ 7; max-height: max\(15\.75rem, 34vh\); \}/); assert.match(block('(min-width: 52.5rem)'), /\.A_hero \{ aspect-ratio: 21 \/ 8; \}/);
  assert.match(block('(max-height: 30rem) and (orientation: landscape)'), /\.A_hero \{ aspect-ratio: auto; min-height: 9\.5rem;/);
  assert.match(read('index.html'), /class="A_bg"[^>]*><img [^>]*width="240" height="160"/); assert.match(read('app.js'), /<img src="img\/house-hero\.webp" alt="" width="720" height="480"/);
  assert.doesNotMatch(read('app.js'), /innerWidth\s*[<>]=?\s*\d{3}/, 'no layout is picked by reading the width in script');
});

test('F_ targets: every rule that ends in an interactive class keeps 44 px (or the touch token) in every width class; the rail tab and the warning rows too', () => {
  const interactive = ['.btn', '.btn-sm', '.chip', '.iconbtn', '.sw', '.ctval', '.tab', '.trust', '.rowi', '.A_chipglass', '.doorbar .back', '.pad button', '.wbtn', '.A_tabs a', '.E_underbtn', '.E_toastbtn'];
  const seen = new Set(), bad = [];
  for (const m of strip(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) for (const s of m[1].split(',').map((x) => x.trim())) {
    const hit = interactive.find((c) => s === c || s.endsWith(' ' + c)); if (!hit) continue;
    for (const d of m[2].matchAll(/(?:^|[;\s])((?:min-)?height):\s*([^;]+)/g)) { seen.add(hit); const v = d[2].trim(), px = /^(\d+(?:\.\d+)?)px$/.exec(v); if (!(v === 'var(--touch)' || v === 'var(--v5-touch)' || (px && +px[1] >= 44) || (d[1] === 'height' && v === 'auto'))) bad.push(s + ' { ' + d[1] + ': ' + v + ' }'); }
  }
  assert.deepEqual(bad, []); assert.ok(seen.has('.tab') && seen.has('.wbtn') && seen.has('.btn'), 'the check found them: ' + [...seen].join(' '));
  assert.match(block('(min-width: 52.5rem), (min-width: 37.5rem) and (max-height: 30rem)'), /\.tab \{ flex: 0 0 auto; width: 100%; min-height: var\(--touch\);/);
});

test('F_ the door frame uses the whole window in every class, inside the safe area; the page head carries viewport-fit=cover with no zoom lock; the rail is first in the Tab order', () => {
  const b = strip(css);
  assert.match(b, /\.doorbar, \.doorframe \{ max-width: none; \}/); // an iframe is a replaced element: "width: auto" gives it 300 x 150. Resolve the cascade of every .doorframe rule outside a media query and demand an explicit width AND height.
  const eff = {}; for (const m of b.replace(/@media[^{]+\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').map((x) => x.trim()).includes('.doorframe')) for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) eff[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
  assert.ok(eff.width && eff.width !== 'auto', 'the door frame has an explicit width, got ' + eff.width); assert.ok(eff.height && eff.height !== 'auto', 'and an explicit height, got ' + eff.height);
  assert.match(eff.width, /100%/); assert.match(eff.height, /100%/); assert.equal(eff.position, 'fixed'); assert.ok(!/max-width: 480px/.test(eff['max-width'] || ''), 'no phone-width cap');
  for (const f of ['index.html', 'pay/index.html', 'pay/admin.html', 'quick/index.html', 'install/index.html', 'guest/index.html']) { const h = read(f), v = /<meta name="viewport" content="([^"]*)"/.exec(h); assert.ok(v, f); assert.match(v[1], /viewport-fit=cover/, f); assert.doesNotMatch(v[1], /user-scalable|maximum-scale/, f); }
  const html = read('index.html'); assert.ok(html.indexOf('id="tabbar"') < html.indexOf('id="v-home"'), 'the tab bar (the rail on a wide screen) comes first in the markup, so Tab reaches it first');
  assert.match(read('app.js'), /shellEl\.classList\.toggle\('F_nav', !\$\('tabbar'\)\.hidden\)/);
  for (const sel of ['.tabbar', '.A_herobar', '.appbar', '.sheet', '.doorbar']) assert.match(b, new RegExp(sel.replace('.', '\\.') + '[^{]*\\{[^}]*env\\(safe-area-inset-(?:left|right)'), sel + ' respects the side insets');
});

// ------------------------------------------------------------------------------------------------ behaviour in the classes
const T = (o) => Object.assign({ source: 'follow_up_tasks', id: 'a', kind: 'reminder', title: 'Water the plants', priority: 'normal', status: 'open', due_at: '2026-10-12T09:00:00Z', mine: true, blocks_arrival: false, detail: null, assignee_label: null, created_at: '2026-10-01T00:00:00Z' }, o);
const drive = (app, surface, pts, pick) => { const fire = (t, ev) => (app.listeners[t] || []).forEach((f) => f(ev)); const target = { closest: (s) => pick(s, surface) };
  pts.forEach((p, i) => { const ev = { clientX: p[1], clientY: p[2], pointerId: 1, timeStamp: p[0], button: 0 }; if (i === 0) fire('pointerdown', Object.assign(ev, { target })); else fire(i === pts.length - 1 ? 'pointerup' : 'pointermove', ev); }); };
const surf = (x) => Object.assign({ style: {}, offsetWidth: 360, offsetHeight: 400, scrollTop: 0, parentNode: { classList: { add() {}, remove() {}, contains: () => false }, style: {} }, classList: { add() {}, remove() {}, contains: () => false }, getAttribute: () => null, setAttribute() {}, querySelector: () => null, contains(t) { return t === this; }, setPointerCapture() {} }, x || {});

test('F_ sheets: a bottom sheet below 600 px pulls down to close; from 600 px it is a dialog that does not pull and closes by its button, Escape or the scrim', async () => {
  const open = async (w) => { const app = await boot({ role: 'admin', hash: '#calendar', width: w, handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-14', '2026-10-17')]) }) }); await app.click({ 'data-day': '2026-10-16' }); return app; };
  const pull = (app) => { const sh = app.els['cal-sheet']; drive(app, sh, [[0, 180 + 0, 300], [30, 180, 340], [60, 180, 380], [90, 180, 410], [400, 180, 410]], (s) => (s === '#cal-sheet' ? sh : s === '.E_grab, .F_sheethead' ? {} : null)); };
  const shut = (app) => app.els['cal-sheet'].getAttribute('aria-hidden') === 'true';
  for (const w of [320, 360, 599]) { const a = await open(w); pull(a); assert.ok(shut(a), 'pulled shut at ' + w); }
  for (const w of [600, 768, 1024, 1280]) {
    const a = await open(w); pull(a); assert.ok(!shut(a), 'a dialog is not pulled at ' + w); assert.equal(a.els['cal-sheet'].style.transform || '', '', 'and nothing was written to it');
    for (const fn of a.listeners.keydown || []) fn({ key: 'Escape', target: { closest: () => null } }); assert.ok(shut(a), 'Escape closes it at ' + w);
    const b = await open(w); await b.click({ 'data-act': 'sheet-close' }); assert.ok(shut(b), 'the button closes it at ' + w);
  }
  assert.equal(CS.F_widthClass(599), 'F_phone');
});

test('F_ gestures and haptics keep working in every class: the calendar swipe, the task swipe and the slide at 360, 768 and 1280 px wide', async () => {
  const FOLD = { schema: 1, surfaces: { admin: { files: 84 }, checklist: { files: 8 }, manual: { files: 16 }, guide: { files: 48, adminGuide: true } } };
  for (const width of [360, 768, 1280]) {
    const tab = await boot({ role: 'admin', hash: '#calendar', width, handlers: baseHandlers('admin', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-14', '2026-10-17')]) }) });
    const body = surf({ offsetWidth: width }); drive(tab, body, [[0, width - 80, 300], [100, width - 80 - Math.round(width * 0.15), 302], [200, width - 80 - Math.round(width * 0.4), 302], [260, width - 80 - Math.round(width * 0.4), 302]], (s, el) => (s === '.cal, .K_root' ? el : null));
    assert.match(tab.els['v-calendar'].innerHTML, /<h2 class="dlg"[^>]*>November 2026</, 'month swipe at ' + width);
    const done = new Set(), calls = [];
    const task = await boot({ role: 'admin', hash: '#tasks', width, nav: { vibrate: (p) => { calls.push(p); return true; } }, handlers: baseHandlers('admin', { tasks_list_v1: () => ({ error: null, data: { ok: true, manager: true, today: TODAY, tasks: [T({})].filter((t) => !done.has(t.id)) } }), task_set_done_v1: (a) => { done.add(a.p_id); return { error: null, data: { ok: true } }; } }) });
    const row = surf({ offsetWidth: Math.min(width, 736), getAttribute: (k) => ({ 'data-task': 'follow_up_tasks:a', 'data-E-swipe': 'task-done', 'data-E-w': '96' })[k] ?? null });
    drive(task, row, [[0, width - 100, 200], [60, width - 160, 201], [120, width - 100 - Math.round(Math.min(width, 736) * 0.5), 201], [500, width - 100 - Math.round(Math.min(width, 736) * 0.5), 201]], (s, el) => (s === '.taskrow[data-E-swipe]' ? el : null));
    await task.flush(); assert.equal(task.calls.filter((c) => c[0] === 'task_set_done_v1').length, 1, 'task swipe at ' + width); assert.ok(calls.some((p) => p[0] === 10), 'and its confirm buzz at ' + width);
    const home = await boot({ role: 'cleaner', hash: '#home', width, fold: FOLD, handlers: baseHandlers('cleaner', { staff_home_v1: () => HOMEWITH([stayRow('Ana Reyes', '2026-10-12', TODAY), stayRow('Ben Cruz', TODAY, '2026-10-18')]) }) });
    const knob = { style: {} }, a = surf({ offsetWidth: 300, querySelector: () => knob, getAttribute: (k) => (k === 'href' ? '#door/checklist' : null) });
    drive(home, a, [[0, 60, 10], [100, 150, 12], [200, 290, 12], [300, 290, 12]], (s, el) => (s === '[data-slide]' ? el : null)); assert.equal(home.location.hash, '#door/checklist', 'slide at ' + width);
  }
});

test('F_ pay haptics: "request sent" and "settled" each call CS.E_buzz(\'tap\') once, in one line, with no change to the payment logic', () => {
  const pay = read('pay/pay.js'), adm = read('pay/C_admin.js');
  for (const [name, s] of [['pay.js', pay], ['C_admin.js', adm]]) { assert.match(s, /function F_tap\(\) \{ try \{ CS\.E_buzz\('tap', \{ navigator: navigator, storage: /, name); assert.equal((s.match(/\bF_tap\(\)/g) || []).length, 2, name + ': defined once, called once'); }
  assert.match(pay, /if \(m\.ok\) \{ F_tap\(\); S\.result = m;/); assert.match(adm, /if \(d\.ok\) \{ S\.view = 'done'; F_tap\(\); notifyPaid\(tok, S\.req\.id\); return renderDone\(\); \}/);
  assert.match(adm, /window\.CSDemo && window\.CSDemo\.active \? null : window\.localStorage/); assert.match(pay, /DEMO \? null : window\.localStorage/);
});
