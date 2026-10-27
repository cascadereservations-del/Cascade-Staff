// s99e (D-350): the Cleaning fee screen made plain. Renders the real pay/pay.js in the fake browser and asserts order, wording, one primary,
// the sum in each row, transport on by default, and the sticky-bar CSS rules. Every number is worked out by hand in the comments.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FakeEl, fire, load, plain, target, until } from './C_dom-harness.mjs';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../pay/pay-lib.js');
const css = fs.readFileSync(new URL('../pay/C_pay.css', import.meta.url), 'utf8');

const BASE = { ok: true, payee_name: 'Honey', requests: [], missing_reports: [],
  sessions: [{ id: 's-1', date: '2026-10-24', type: 'turnover', base: 500, transport: 150 }, { id: 's-2', date: '2026-10-26', type: 'deep_clean', base: 800, transport: null }],
  claims: [{ id: 'c-1', date: '2026-10-24', description: '2pcs KitKat', amount: 50 }],
  reports_owed: [{ date: '2026-10-19', ref: 'R1', status: 'paid' }],
  advance: [{ checkout_date: '2026-10-22', base: 500, transport: 150 }, { checkout_date: '2026-10-17', base: 500, transport: null }] };

function boot(cands, sent = []) {
  const els = { pay: new FakeEl('pay'), 'C_push-slot': new FakeEl('C_push-slot') };
  const ctx = {
    console, setTimeout, setImmediate, Promise, JSON, Math, Object, Array, String, Number, Error, isNaN, parseInt, encodeURIComponent, crypto: globalThis.crypto,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Image: class {}, File: class {}, navigator: { userAgent: 'test' }, sessionStorage: null, location: { search: '', hash: '' },
    document: { getElementById: (id) => els[id] || null, querySelector: () => null, createElement: () => ({}) }, scrollY: 0, scrollTo() {},
    fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return { json: async () => ({ ok: true, total: 0, ref: 'CASCADE-AAAA0001' }) }; },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) }, rpc: async (n) => (n === 'staff_pay_candidates_v1' ? { data: cands, error: null } : { data: null, error: { code: 'PGRST202' } }) }) },
  };
  ctx.self = ctx; ctx.window = ctx; ctx.addEventListener = () => {};
  load(['icons.js', 'lib.js', 'pay/pay-lib.js', 'pay/C_paid-text.js'], ctx);
  ctx.C_Push = { status: async () => ({ state: 'hidden' }), words: (x) => x };
  els.pay.querySelector = () => ({ addEventListener() {}, insertAdjacentHTML() {} });
  load(['pay/pay.js'], ctx);
  return { root: els.pay };
}
const ready = async (b) => { await until(() => /Expenses/.test(b.root.innerHTML), 'pick'); return b.root.innerHTML; };
const idx = (h, t) => { const i = h.indexOf(t); assert.ok(i >= 0, 'missing ' + t); return i; };

test('sections run Reports to send, Cleans to be paid, Cleans with no report yet, Expenses, with sentence-case headings and the new sub-line', async () => {
  const h = await ready(boot(BASE));
  const order = ['Reports to send', 'Cleans to be paid', 'Cleans with no report yet', 'Expenses'].map((t) => idx(h, '<h2 class="P_h">' + t + '</h2>'));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(h, /Tick what you want to be paid for, then send\./);
  assert.doesNotMatch(h, /cap up/, 'no uppercase headings on the pick step');
  assert.match(h, /Not ticked yet\. Tick to be paid now and send the report after\./);
  assert.match(h, /<h1 class="ttl">Cleaning fee<\/h1>/);
});

test('Reports to send lists every owed date once, paid ahead and not paid, sorted, with one secondary button; the claim moved to Expenses', async () => {
  const h = await ready(boot(BASE));
  const card = /<div class="card P_reports">[\s\S]*?<\/div>/.exec(h)[0];
  assert.deepEqual([...card.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]), ['Sat 17 Oct · not paid yet', 'Mon 19 Oct · already paid', 'Thu 22 Oct · not paid yet']);
  assert.match(card, /<a class="btn btn-secondary btn-block" href="\.\.\/#door\/checklist">Start a cleaning report<\/a>/);
  assert.ok(idx(h, 'data-clm="c-1"') > idx(h, '<h2 class="P_h">Expenses</h2>'), 'claims sit in the Expenses card');
  assert.ok(idx(h, 'data-clm="c-1"') > idx(h, 'data-adv="2026-10-22"'));
  assert.ok(idx(h, 'Add an expense') > idx(h, 'data-clm="c-1"'));
});

test('no card when nothing is owed; the empty state and the old-server box use the plain words', async () => {
  const none = await ready(boot({ ...BASE, reports_owed: [], advance: [], sessions: [], claims: [] }));
  assert.doesNotMatch(none, /Reports to send/); assert.match(none, /Nothing to be paid yet\. Cleans and expenses show here after you send their report\./);
  assert.match(none, /Tick at least one line\./); assert.match(none, /data-act="review" disabled/);
  const old = await ready(boot({ ...BASE, advance: undefined, reports_owed: [], missing_reports: ['2026-10-19', '2026-10-22'] }));
  assert.match(old, /19 Oct, 22 Oct: send the cleaning report first, then you can ask for pay\./); assert.doesNotMatch(old, /Cleans with no report yet/);
});

test('exactly one primary button on the pick step, and the sticky bar words', async () => {
  const h = await ready(boot(BASE));
  assert.equal((h.match(/btn-primary/g) || []).length, 1);
  assert.match(h, /<div class="sticky P_bar">/); assert.match(h, /You will ask for<span class="P_cnt">3 items<\/span>/); assert.match(h, /data-act="review">Check and send/);
  assert.doesNotMatch(h, /Tick at least one line/, 'only shown at zero');
  const one = await ready(boot({ ...BASE, sessions: [BASE.sessions[1]], claims: [], advance: [] })); // one clean, 800
  assert.match(one, /1 item</);
});

test('each row says the sum: 500 cleaning + 150 transport, 500 cleaning when off or no rate, report not sent on the no-report rows; unticked rows are off', async () => {
  const b = boot(BASE), h = await ready(b);
  assert.match(h, /<span class="s">₱500 cleaning \+ ₱150 transport<\/span>/); assert.match(h, /<span class="val">₱650<\/span>/);
  assert.match(h, /<span class="s">₱800 cleaning<\/span>/);
  assert.match(h, /₱500 cleaning \+ ₱150 transport · report not sent/); assert.match(h, /<span class="s">₱500 cleaning · report not sent<\/span>/);
  assert.match(h, /<span>I paid for transport \(\+₱150\)<\/span>/); assert.doesNotMatch(h, /Transport \+/);
  assert.match(h, /<div class="payrow off"><button class="chk"[^>]*data-adv="2026-10-22"/, 'no-report rows start unticked and dimmed');
  assert.doesNotMatch(h, /<div class="payrow off"><button class="chk"[^>]*data-ses=/, 'ticked clean rows are not dimmed');
  await fire(b.root, 'click', { target: target({ 'data-sw': 's-1' }) });
  const off = b.root.innerHTML;
  assert.match(off, /<span class="s">₱500 cleaning<\/span>/); assert.doesNotMatch(off, /₱500 cleaning \+ ₱150 transport<\/span><div class="opt"><button class="sw P_tr" type="button" role="switch" aria-checked="false"/);
  assert.match(off, /aria-checked="false" aria-label="I paid for transport \(\+₱150\) for Sat 24 Oct" data-sw="s-1"/);
});

test('D-350: transport starts on for every clean and no-report row that has a rate; total and payload follow it; she can still switch it off', async () => {
  const sent = [], b = boot(BASE, sent), h = await ready(b);
  assert.match(h, /aria-checked="true"[^>]*data-sw="s-1"/); assert.match(h, /aria-checked="true"[^>]*data-advsw="2026-10-22"/);
  assert.match(h, /class="amt num">₱1,500</); // 650 + 800 + 50 = 1500
  await fire(b.root, 'click', { target: target({ 'data-adv': '2026-10-22' }) }); // + 650
  assert.match(b.root.innerHTML, /class="amt num">₱2,150</);
  const sel = { sessions: { 's-1': { on: true, transport: true } }, claims: {}, extras: [], advance: {} };
  assert.deepEqual(plain(P.buildPayload(BASE, sel, 'k').sessions), [{ id: 's-1', transport: true }]);
  await fire(b.root, 'click', { target: target({ 'data-advsw': '2026-10-22' }) }); // 2150 - 150 = 2000
  assert.match(b.root.innerHTML, /class="amt num">₱2,000</);
  const t = target({ 'data-act': 'review' }), c = t.closest; t.closest = (sel2) => c(sel2) || (sel2.includes('button') ? t : null);
  await fire(b.root, 'click', { target: t });
  const t2 = target({ 'data-act': 'send' }), c2 = t2.closest; t2.closest = (sel2) => c2(sel2) || (sel2.includes('button') ? t2 : null);
  await fire(b.root, 'click', { target: t2 }); await until(() => sent.length === 1, 'sent');
  assert.deepEqual(plain(sent[0].sessions), [{ id: 's-1', transport: true }, { id: 's-2', transport: false }]);
  assert.deepEqual(plain(sent[0].advance), [{ checkout_date: '2026-10-22', transport: false }]);
});

test('the sticky total is solid with a top border, and the list ends clear of it', () => {
  assert.match(css, /\.sticky\.P_bar \{[^}]*background: var\(--v5-surf\)[^}]*border-top: 1px solid var\(--v5-line\)[^}]*box-shadow: var\(--v5-shadow-card\)/);
  assert.match(css, /\.P_pick \{ padding-bottom: 9rem; \}/);
});
