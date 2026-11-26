// s143 lane A: the Staff shell for the Money release. rangeLabel, billsToday pass-through, the old payload drawn exactly as on base, bills card states A/B/C,
// the Money card and who sees it, routes, the css array loader, sw.js, the css rules and the demo stubs. Names are invented; the fixtures are read only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CS, D, read, root, boot, baseHandlers } from './_a_harness.mjs';

const fx = (f) => JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures', f), 'utf8'));
const NEW = fx('s143_today_bills_new.json'), OLD = fx('s143_today_bills_old.json').payload, EXP = fx('s143_expenses_screen.json');
const plain = (x) => JSON.parse(JSON.stringify(x));
const NOW = (iso) => new Date(iso + 'T04:30:00Z');
const homeOf = (today) => ({ error: null, data: { today, warnings: [], calendar: [], day_flags: [], weather: null, current_guest: null, next_guest: null, generated_at: today + 'T04:00:00Z' } });
async function today(role, payload, extra) {
  const day = (extra && extra.day) || '2026-11-26';
  const app = await boot({ role, hash: '#home', now: NOW(day), handlers: baseHandlers(role, Object.assign({ staff_home_v1: () => homeOf(day), today_bills_v1: () => ({ error: null, data: payload }) }, (extra && extra.h) || {})) });
  return { html: app.els['v-home'].innerHTML, app };
}
const card = (html) => { const i = html.indexOf('id="T_bills"'); if (i < 0) return ''; const j = html.indexOf('</section>', i); return html.slice(i, j); };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();

test('rangeLabel: real, assumed, month clamp, missing dates', () => {
  assert.equal(CS.rangeLabel('2026-10-21', '2026-11-21'), '21 Oct – 21 Nov');
  assert.equal(CS.rangeLabel('2026-10-21', '2026-11-21', true), '21 Oct – ~21 Nov');
  assert.equal(CS.rangeLabel('2026-01-31', '2026-02-28'), '31 Jan – 28 Feb');
  assert.equal(CS.rangeLabel('2026-01-31', '2026-02-28', true), '31 Jan – ~28 Feb');
  assert.equal(CS.rangeLabel('', '2026-02-28'), '');
  assert.equal(CS.rangeLabel('2026-01-31', null), '');
  assert.equal(CS.rangeLabel(undefined, undefined, true), '');
  assert.equal(CS.rangeLabel('2026-10-21T00:00:00Z', '2026-11-21T00:00:00Z'), '21 Oct – 21 Nov');
});

test('billsToday: the new keys pass through, per meter, and an old payload has none', () => {
  const a = CS.billsToday(NEW.A);
  assert.equal(a.v2, true);
  assert.equal(a.meters.electric.from, '2026-11-21'); assert.equal(a.meters.electric.fromAssumed, true); assert.equal(a.meters.electric.next, '2026-12-21');
  assert.equal(a.meters.water.fromAssumed, false);
  assert.equal(a.meters.water.last.status, 'paid'); assert.equal(a.meters.water.last.paid, 212); assert.equal(a.meters.water.last.paidOn, '2026-11-25'); assert.equal(a.meters.water.last.hasProof, true);
  assert.equal(a.meters.electric.last.toAssumed, true); assert.equal(a.meters.electric.last.est, 4269.51);
  assert.ok(Array.isArray(a.lastPaid));
  const e = a.due.find((x) => x.kind === 'electric'); assert.equal(e.from, '2026-10-21'); assert.equal(e.to, '2026-11-21'); assert.equal(e.toAssumed, true); assert.equal(e.paidOn, '');
  const o = CS.billsToday(OLD);
  assert.equal(o.v2, false); assert.equal(o.meters.electric.from, ''); assert.equal(o.meters.electric.last, null); assert.deepEqual(plain(o.lastPaid), []);
  assert.equal(CS.billsCycle(o), null, 'old payload: no cycle, the card keeps its old since logic');
  // junk in the new keys never throws
  const j = CS.billsToday({ since: '2026-11-21', electric: { php: 1, kwh: 1, cycle_from: 5, last_bill: [] }, water: { php: 1, m3: 1, last_bill: 'x' }, last_paid: [null, 3, { kind: 'zz' }] });
  assert.equal(j.meters.electric.last, null); assert.deepEqual(plain(j.lastPaid), []);
});

test('billLast: paid, assumed estimate, real To pay, skipped', () => {
  const m = (o) => ({ last: Object.assign({ from: '2026-10-21', to: '2026-11-21', toAssumed: false, status: 'due', est: 4269.51, paid: null }, o) });
  assert.deepEqual(plain(CS.billLast(m({ status: 'paid', paid: 212 }))), { range: '21 Oct – 21 Nov', tone: 'ok', text: '✓ Paid ₱212' });
  assert.deepEqual(plain(CS.billLast(m({ toAssumed: true }))), { range: '21 Oct – ~21 Nov', tone: 'due', text: '₱4,269.51 est.' });
  assert.equal(CS.billLast(m({})).text, 'To pay ₱4,269.51');
  assert.equal(CS.billLast(m({ status: 'skipped' })), null);
  assert.equal(CS.billLast({ last: null }), null);
});

// ---- the hard requirement: an old server payload draws exactly as on base ----
test('old payload: today bills card is byte-identical to the base build', async (t) => {
  const BASE = 'de559ca37b19e041354f3ba69d133bb5af4de2b7', dir = fs.mkdtempSync(path.join(os.tmpdir(), 's143-base-'));
  try {
    for (const f of ['app.js', 'lib.js', 'demo.js', 'pay/pay-lib.js']) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), execFileSync('git', ['show', BASE + ':' + f], { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
    }
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); return t.skip('base commit not in this clone: ' + String(e.message).split('\n')[0]); }
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true }); fs.copyFileSync(path.join(root, 'tests/_a_harness.mjs'), path.join(dir, 'tests/_a_harness.mjs'));
  try {
    const B = await import(pathToFileURL(path.join(dir, 'tests/_a_harness.mjs')).href);
    const bootOn = async (H, role) => { const app = await H.boot({ role, hash: '#home', now: NOW('2026-11-26'), handlers: H.baseHandlers(role, { staff_home_v1: () => homeOf('2026-11-26'), today_bills_v1: () => ({ error: null, data: OLD }) }) }); return app.els['v-home'].innerHTML; };
    for (const role of ['owner', 'admin', 'finance', 'cleaner']) {
      const oldHtml = card(await bootOn(B, role)), newHtml = card(await bootOn({ boot, baseHandlers }, role));
      assert.ok(oldHtml.length > 100, role + ': the base card drew'); assert.equal(newHtml, oldHtml, role + ': same HTML');
      assert.ok(!/MN_|data-money|Last bill|Set dates/.test(newHtml), role + ': no Money markup on an old payload');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('old payload: card carries no new markup and billRow keeps its old sub-lines', async () => {
  const { html } = await today('owner', OLD);
  assert.ok(card(html).includes('This bill so far'));
  assert.ok(!/MN_last|MN_row|MN_paidline/.test(card(html)));
  const row = CS.billsToday(OLD).due[0]; if (row) assert.ok(!/^Due /.test(CS.billRow(row, { today: '2026-11-26', last: '2026-11-19' }).sub));
});

// ---- bills card, states A / B / C ----
test('state A: since about, LAST BILL lines, a paid meter leaves To pay', async () => {
  const { html } = await today('owner', NEW.A, { day: NEW.today.A }); const t = text(card(html));
  assert.match(t, /Last bill/); assert.match(t, /21 Oct – 21 Nov/); assert.match(t, /✓ Paid ₱212/); assert.match(t, /~21 Nov/); assert.match(t, /₱4,269\.51 est\./);
  assert.match(t, /since about 21 Nov/);
  assert.match(t, /To pay/); assert.match(t, /Due 27th · estimate/); assert.match(t, /November · due 28th/);
  assert.ok(!/Water[^]*Pay Water/.test(card(html)), 'the paid water bill is not a To pay row');
  assert.ok(card(html).includes('href="#bills/pay/00000000-0000-4000-8000-000000000001"'), 'Pay keeps its route');
  assert.ok(!card(html).includes('Dates assumed'), 'A: water is real, so no assumed row');
});
test('state B: nothing to pay, the month paid rows come from last_paid', async () => {
  const { html } = await today('owner', NEW.B, { day: NEW.today.B }); const c = card(html), t = text(c);
  assert.ok(!c.includes('To pay'), 'no To pay list'); assert.ok(c.includes('MN_paidline'));
  assert.match(t, /November/); assert.match(t, /Internet ✓ Paid/); assert.match(t, /✓ Paid/);
  assert.ok(!c.includes('href="#bills/pay/'), 'nothing to pay');
});
test('state C: dates assumed, one sentence and a Set dates link', async () => {
  const { html } = await today('owner', NEW.C, { day: NEW.today.C }); const c = card(html);
  assert.ok(c.includes('Dates assumed (the 21st). Type the real ones from the bills.'));
  assert.ok(c.includes('href="#money/reading"') && c.includes('Set dates'));
  assert.match(text(c), /~21 Dec|~21 Nov/);
});
test('staff view of the new payload: no pay links, no Set dates, no Money card, no Log money', async () => {
  for (const role of ['cleaner', 'laundry']) {
    const { html } = await today(role, NEW.staff, { day: NEW.today.staff, h: { expenses_screen_v1: () => ({ error: null, data: EXP.new }) } });
    assert.ok(!html.includes('id="T_money"'), role + ': no Money card'); assert.ok(!/Log money/.test(html), role + ': no Log money');
    assert.ok(!html.includes('href="#money'), role); assert.ok(!card(html).includes('Set dates'), role); assert.ok(!card(html).includes('href="#bills/pay/'), role);
  }
});

// ---- the Money card ----
test('Money card: owner, admin and finance see it with the totals, the latest three rows and Log money; the Expenses card is gone', async () => {
  for (const role of ['owner', 'admin', 'finance']) {
    let asked = null;
    const { html } = await today(role, NEW.A, { day: NEW.today.A, h: { expenses_screen_v1: (a) => { asked = a; return { error: null, data: EXP.new }; } } });
    assert.equal(asked && asked.p_limit, 3, role + ': p_limit 3');
    const i = html.indexOf('id="T_money"'); assert.ok(i > 0, role + ': Money card'); assert.ok(!html.includes('E_today'), 'old Expenses card gone');
    const c = html.slice(i, html.indexOf('</section>', i)); assert.ok(c.includes('MN_tot')); assert.ok(c.includes('MN_hist'));
    assert.ok((c.match(/<li>/g) || []).length <= 3, 'latest three at most');
    assert.ok(c.includes('href="#expenses"'), 'See all'); if (EXP.new.can_write) assert.ok(c.includes('href="#money"') && c.includes('Log money'), role + ': Log money');
    assert.ok(html.indexOf('id="T_bills"') < i, 'Money card sits under the bills card');
  }
});
test('Money card: Log money only where the server says can_write; an error or old shape hides it', async () => {
  const ro = Object.assign({}, EXP.new, { can_write: false });
  const a = await today('finance', NEW.A, { day: NEW.today.A, h: { expenses_screen_v1: () => ({ error: null, data: ro }) } });
  assert.ok(a.html.includes('id="T_money"')); assert.ok(!/Log money/.test(a.html));
  const b = await today('owner', NEW.A, { day: NEW.today.A, h: { expenses_screen_v1: () => ({ error: { message: 'x' }, data: null }) } });
  assert.ok(!b.html.includes('id="T_money"'));
  const c = await today('owner', NEW.A, { day: NEW.today.A, h: { expenses_screen_v1: () => ({ error: null, data: EXP.old }) } });
  assert.ok(c.html.includes('id="T_money"'), 'the old expenses shape still draws, rows fall back to payee and label');
});

// ---- shell wiring ----
test('routes: #money, #money/reading and #money/reading/<kind> mount MN_Money with opts.sub', async () => {
  for (const [hash, sub] of [['#money', ''], ['#money/reading', 'reading'], ['#money/reading/water', 'reading/water']]) {
    const loaded = [], mounts = [];
    const winInit = (w) => { w.H_loadAsset = (m) => { loaded.push(m); w[m.global] = { mount(el, o) { mounts.push(o); }, unmount() {} }; return Promise.resolve(); }; };
    await boot({ role: 'finance', hash, winInit, handlers: baseHandlers('finance') });
    assert.equal(loaded.length, 1, hash); assert.equal(loaded[0].src, 'money/MN_money.js'); assert.deepEqual(plain(loaded[0].css), ['stock/I_stock.css', 'money/MN_money.css']); assert.equal(loaded[0].global, 'MN_Money');
    assert.equal(mounts.length, 1); assert.equal(mounts[0].sub, sub, hash); assert.equal(mounts[0].role, 'finance'); assert.equal(typeof mounts[0].client.rpc, 'function'); assert.equal(typeof mounts[0].navigate, 'function');
  }
  for (const hash of ['#bills/pay/abc', '#expenses/add']) { const l = []; await boot({ role: 'owner', hash, winInit: (w) => { w.H_loadAsset = (m) => { l.push(m.src); w[m.global] = { mount() {}, unmount() {} }; return Promise.resolve(); }; }, handlers: baseHandlers('owner') }); assert.ok(l.length >= 1, hash); assert.ok(l.some((x) => /bills|expenses/.test(x)), hash); }
});
test('routes: a cleaner never loads Money', async () => {
  const l = []; const app = await boot({ role: 'cleaner', hash: '#money', winInit: (w) => { w.H_loadAsset = (m) => { l.push(m.src); return Promise.resolve(); }; }, handlers: baseHandlers('cleaner') });
  assert.deepEqual(l, []); assert.equal(app.els['v-money'] ? app.els['v-money'].innerHTML : '', '');
});
test('modules table: money entry, and bills and expenses css arrays add the Inventory css', () => {
  const flat = read('app.js').replace(/\s+/g, ' ');
  assert.ok(flat.includes("money: { src: 'money/MN_money.js', css: ['stock/I_stock.css', 'money/MN_money.css'], global: 'MN_Money', title: 'Money', roles: ['owner', 'admin', 'finance'], demoClient: true }"));
  assert.match(flat, /bills: \{[^}]*css: \['stock\/I_stock\.css', 'bills\/BL_bills\.css'\]/); assert.match(flat, /expenses: \{[^}]*css: \['stock\/I_stock\.css', 'expenses\/E_expenses\.css'\]/);
});
test('H_domLoad: css as a string or an array makes one link each; a failed script removes them all', async () => {
  const src = read('app.js'), i = src.indexOf('function H_domLoad(m)'), j = src.indexOf('function H_loadModule'), fn = src.slice(i, j);
  const run = async (css, fail) => {
    const made = [], removed = [], doc = { createElement: (t) => { const o = { tag: t, parentNode: { removeChild: (x) => removed.push(x) } }; made.push(o); return o; }, head: { appendChild: (o) => { if (o.tag === 'script') setImmediate(() => (fail ? o.onerror() : o.onload())); } } };
    const load = vm.runInNewContext('(function(){ ' + fn + ' return H_domLoad; })()', { document: doc, Promise, Error, Array });
    let err = null; await load({ src: 'x.js', css }).catch((e) => { err = e; });
    return { links: made.filter((o) => o.tag === 'link').map((o) => o.href), n: made.length, removed: removed.length, err };
  };
  assert.deepEqual((await run('a.css')).links, ['a.css']);
  assert.deepEqual((await run(['stock/I_stock.css', 'money/MN_money.css'])).links, ['stock/I_stock.css', 'money/MN_money.css']);
  assert.deepEqual((await run(undefined)).links, []);
  const f = await run(['a.css', 'b.css'], true); assert.ok(f.err); assert.equal(f.removed, 3, 'script and both links removed');
});
test('shell: the money view exists, its tab marks nothing, and sign-out resets MN_Money', () => {
  const src = read('app.js'); assert.match(src, /VIEWS = \[[^\]]*'money'\]/); assert.match(src, /'E_Expenses', 'MN_Money'\]\.forEach/);
  assert.match(src, /v === 'bills' \|\| v === 'expenses' \|\| v === 'money' \? ''/); assert.match(src, /\^#\(home[^)]*\|money\)/);
});

// ---- sw.js, css, versions ----
test('sw.js: the money files are optional, the cache name moved, and the version matches', () => {
  const sw = read('sw.js'); assert.ok(sw.includes("'./money/MN_money.js'") && sw.includes("'./money/MN_money.css'"));
  const optional = sw.slice(sw.indexOf('OPTIONAL_URLS'), sw.indexOf('];', sw.indexOf('OPTIONAL_URLS'))); assert.ok(optional.includes('money/MN_money.js') && optional.includes('money/MN_money.css'));
  const v = JSON.parse(read('package.json')).version; assert.ok(read('app.js').includes("version = '" + v + "'") || read('app.js').includes(v));
  assert.match(sw, /CACHE_NAME = 'cs-shell-v84'/); assert.ok(read('app.js').includes("PC_SHELL = 'cs-shell-v84'"));
});
test('styles.css: the s143 rules exist, use tokens only, never wrap figures off-screen, and sit before the s110 block', () => {
  const css = read('styles.css'), at = css.indexOf('/* s143: Money on Today'), s110 = css.indexOf('/* ---- s110:');
  assert.ok(at > 0 && at < s110, 'before s110');
  const block = css.slice(at, s110);
  for (const c of ['MN_last', 'MN_ln', 'MN_lk', 'MN_ok', 'MN_due', 'MN_row', 'MN_set', 'MN_paidline', 'MN_head', 'MN_eye', 'MN_tot', 'MN_rev', 'MN_log', 'MN_amt', 'MN_hist']) assert.ok(block.includes('.' + c), c);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), 'no hex'); assert.ok(!/font(-size)?:[^;]*\d+(\.\d+)?px/.test(block), 'no px font sizes'); assert.ok(!/rgba?\(/.test(block), 'no raw colours');
  for (const m of block.matchAll(/gap:\s*([^;}]+)/g)) for (const v of m[1].match(/\d+px/g) || []) assert.ok(['0px', '4px', '8px', '12px', '16px', '24px'].includes(v), 'gap ' + v);
  assert.ok(!/E_today/.test(css), 'the old Expenses card rules are gone');
  const colours = [...block.matchAll(/(?:color|background)\s*:\s*([^;}]+)/g)].map((m) => m[1]); for (const c of colours) assert.ok(/var\(--v5-/.test(c) || /^(transparent|inherit|none)$/.test(c.trim()), 'token colour: ' + c);
  // narrow screens (390 px): every row is a flex or grid that wraps or shrinks; no fixed width wider than the screen
  assert.ok(!/(^|[^-])width:\s*[4-9]\d\dpx/.test(block)); assert.match(block, /\.MN_hist li \{[^}]*grid-template-columns: minmax\(3\.5rem, auto\) minmax\(0, 1fr\) auto/); assert.match(block, /\.MN_paidline \{[^}]*flex-wrap: wrap/);
});

// ---- demo stubs ----
function demoClient(role, day) { const c = D.client(role, NOW(day)); return c; }
async function rpc(c, name, args) { const r = await c.rpc(name, args); return r && r.data; }
test('demo: bill_reading_set_v1 previews without writing, saves, and refuses', async () => {
  const c = demoClient('owner', '2026-11-26');
  const before = await rpc(c, 'today_bills_v1', { p_property_id: 'p' });
  const pv = await rpc(c, 'bill_reading_set_v1', { p_property_id: 'p', p_kind: 'electric', p_reading_date: '2026-11-22', p_reading_value: 1234, p_preview: true });
  assert.equal(pv.ok, true); assert.equal(pv.preview, true); assert.ok(pv.estimate_php > 0); assert.ok(pv.next_reading);
  const mid = await rpc(c, 'today_bills_v1', { p_property_id: 'p' }); assert.deepEqual(plain(mid.electric), plain(before.electric), 'preview wrote nothing');
  assert.equal((await rpc(c, 'bill_reading_set_v1', { p_property_id: 'p', p_kind: 'gas', p_reading_date: '2026-11-22', p_preview: true })).reason, 'bad_kind');
  assert.equal((await rpc(c, 'bill_reading_set_v1', { p_property_id: 'p', p_kind: 'electric', p_reading_date: '2099-01-01', p_preview: true })).reason, 'reading_date_invalid');
  assert.equal((await rpc(c, 'bill_reading_set_v1', { p_property_id: 'p', p_kind: 'electric', p_reading_date: '2026-11-22', p_reading_value: -1, p_preview: true })).reason, 'reading_value_invalid');
  const sv = await rpc(c, 'bill_reading_set_v1', { p_property_id: 'p', p_kind: 'electric', p_reading_date: '2026-11-22', p_reading_value: 1234, p_preview: false });
  assert.equal(sv.ok, true); const after = await rpc(c, 'today_bills_v1', { p_property_id: 'p' });
  assert.equal(after.electric.cycle_from_assumed, false, 'saved: the date is real now');
  const staff = demoClient('cleaner', '2026-11-26'); assert.equal((await rpc(staff, 'bill_reading_set_v1', { p_property_id: 'p', p_kind: 'electric', p_reading_date: '2026-11-22', p_preview: true })).reason, 'not_authorized');
});
test('demo: today_bills_v1 keeps the old keys and adds the new ones; a cleaner gets none of the money keys', async () => {
  const o = await rpc(demoClient('owner', '2026-10-15'), 'today_bills_v1', { p_property_id: 'p' });
  assert.ok(/-21$/.test(o.since)); assert.ok(o.due.length > 0); assert.ok('cycle_from' in o.electric && 'next_reading' in o.water && Array.isArray(o.last_paid)); assert.ok(o.due.every((x) => x.status !== 'paid'), 'due keeps only due and paying');
  const s = await rpc(demoClient('cleaner', '2026-10-15'), 'today_bills_v1', { p_property_id: 'p' });
  assert.equal(s.can_pay_list, false); assert.deepEqual(plain(s.due), []); assert.ok(!('last_paid' in s)); assert.ok(!('last_bill' in s.electric));
});
test('demo: pay open and settle carry paid_on and method; refusals and the server band', async () => {
  const fresh = async () => { const c = demoClient('owner', '2026-11-26'), t = await rpc(c, 'today_bills_v1', { p_property_id: 'p' }), id = t.due.find((x) => x.kind === 'internet').id, open = await rpc(c, 'bill_pay_open_v1', { p_bill_id: id }); return { c, id, open }; };
  const settle = (f, proof) => rpc(f.c, 'bill_pay_settle_v1', { p_bill_id: f.id, p_proof: Object.assign({ amount: f.open.pay.amount_php, sha256: 'sha' + Math.random() }, proof) });
  let f = await fresh(); assert.equal(f.open.ok, true); assert.equal(f.open.pay.method_default, 'gcash'); assert.ok('reading_date' in f.open.bill && 'reading_date_assumed' in f.open.bill);
  assert.equal((await settle(f, { paid_on: 'nope' })).reason, 'paid_on_invalid'); assert.equal((await settle(f, { paid_on: '2099-01-01' })).reason, 'paid_on_invalid'); assert.equal((await settle(f, { method: 'barter' })).reason, 'bad_method');
  const est = f.open.pay.amount_php;
  assert.equal((await settle(f, { amount: est * 2.5 })).reason, 'confirm_amount', 'above 2x asks again'); assert.equal((await settle(f, { amount: est * 0.4 })).reason, 'confirm_amount', 'below 0.5x asks again');
  const ok = await settle(f, { amount: est * 1.4, paid_on: '2026-11-26', method: 'gcash' }); assert.equal(ok.ok, true, '1.4x is inside the 0.5x-2x band (the old 25% band would have asked)');
  const after = await rpc(f.c, 'today_bills_v1', { p_property_id: 'p' }); assert.ok(after.due.every((x) => x.id !== f.id), 'paid leaves due'); const lp = after.last_paid.find((x) => x.kind === 'internet'); assert.equal(lp.paid_on, '2026-11-26');
  f = await fresh(); const e = await rpc(f.c, 'bill_pay_open_v1', { p_bill_id: (await rpc(f.c, 'today_bills_v1', { p_property_id: 'p' })).due.find((x) => x.kind === 'electric').id });
  assert.equal(e.bill.reading_date_assumed, true);
});
test('demo: ?bills=A|B|C picks a frame of the mockup', async () => {
  const { createRequire } = await import('node:module'), req = createRequire(path.join(root, 'demo.js'));
  const frame = async (f) => { const cx = { self: { location: { search: '?demo&bills=' + f } }, module: { exports: {} }, require: req, Date, console, Math, JSON, Promise }; vm.runInNewContext(read('demo.js'), cx); return plain(await cx.module.exports.client('owner', NOW('2026-11-26')).rpc('today_bills_v1', { p_property_id: 'p' }).then((r) => r.data)); };
  const A = await frame('A'), B = await frame('B'), C = await frame('C');
  assert.equal(A.electric.cycle_from_assumed, true); assert.equal(A.water.cycle_from_assumed, false); assert.equal(A.water.last_bill.status, 'paid'); assert.ok(A.due.every((x) => x.kind !== 'water'));
  assert.deepEqual(B.due, []); assert.ok(B.last_paid.length >= 3); assert.equal(B.electric.cycle_from_assumed, false);
  assert.equal(C.electric.cycle_from_assumed && C.water.cycle_from_assumed, true); assert.ok(C.due.length >= 3); assert.equal(C.waiting_for, null);
});
