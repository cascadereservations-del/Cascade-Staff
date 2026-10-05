import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../pay/pay-lib.js');

const cands = {
  sessions: [
    { id: 's1', date: '2026-10-02', type: 'turnover', base: 500, transport: 150, guest: 'Ana' },
    { id: 's2', date: '2026-10-04', type: 'turnover', base: 500, transport: 150 },
    { id: 's0', date: '2026-09-16', type: 'turnover', base: 650, transport: null }
  ],
  claims: [{ id: 'c1', date: '2026-09-28', description: '2 pcs KitKat for the guest', amount: 40 }]
};

test('total = chosen cleans + transport toggles + claims + valid extras', () => {
  const sel = { sessions: { s1: { on: true, transport: true }, s2: { on: true, transport: false } }, claims: { c1: true }, extras: [{ description: 'Trash bags', amount: '120' }] };
  assert.equal(P.computeTotal(cands, sel), 650 + 500 + 40 + 120);
  assert.equal(P.lineCount(cands, sel), 4);
  assert.equal(P.computeTotal(cands, {}), 0);
});

test('a transport toggle on a clean whose rate has none (the 650 era) adds nothing: no double pay', () => {
  const sel = { sessions: { s0: { on: true, transport: true } } };
  assert.equal(P.computeTotal(cands, sel), 650);
  assert.deepEqual(P.buildPayload(cands, sel, 'k').sessions, [{ id: 's0', transport: false }]);
});

test('an unticked clean is ignored even with its transport switch on', () => {
  assert.equal(P.computeTotal(cands, { sessions: { s1: { on: false, transport: true } } }), 0);
});

test('extras: description 3-500 characters, amount above 0 and up to 5,000, else dropped', () => {
  assert.equal(P.parseExtra({ description: 'ab', amount: 10 }), null);
  assert.equal(P.parseExtra({ description: 'x'.repeat(501), amount: 10 }), null);
  assert.equal(P.parseExtra({ description: 'Trash bags', amount: 0 }), null);
  assert.equal(P.parseExtra({ description: 'Trash bags', amount: 5000.01 }), null);
  assert.equal(P.parseExtra({ description: 'Trash bags', amount: 'abc' }), null);
  assert.deepEqual(P.parseExtra({ description: ' Trash bags ', amount: '1,250.5' }), { description: 'Trash bags', amount: 1250.5, receipt: false, receipt_path: null });
  assert.equal(P.computeTotal(cands, { extras: [{ description: 'ok thing', amount: 100 }, { description: 'x', amount: 100 }] }), 100);
});

test('payload matches the SPEC-37 request body and carries a receipt path when there is one', () => {
  const sel = { sessions: { s1: { on: true, transport: true } }, claims: { c1: true }, extras: [{ description: 'Dish soap', amount: 85 }, { description: 'Bleach', amount: 60 }] };
  const body = P.buildPayload(cands, sel, 'key-12345678', { 1: 'prop/user/sub/photo.jpg' });
  assert.deepEqual(body, {
    sessions: [{ id: 's1', transport: true }], claim_ids: ['c1'],
    extras: [{ description: 'Dish soap', amount: 85 }, { description: 'Bleach', amount: 60, receipt_path: 'prop/user/sub/photo.jpg' }],
    idempotency_key: 'key-12345678'
  });
});

test('the idempotency key is a uuid and the retry reuses the one made at load', () => {
  const k = P.newKey();
  assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const sel = { sessions: { s1: { on: true, transport: false } } };
  assert.equal(P.buildPayload(cands, sel, k).idempotency_key, P.buildPayload(cands, sel, k).idempotency_key);
  const fallback = P.newKey({ getRandomValues: (b) => b.fill(7) }); // no randomUUID: still a v4 shape
  assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('review block uses the shape Honey already writes', () => {
  const sel = { sessions: { s1: { on: true, transport: true }, s2: { on: true, transport: false } }, claims: {}, extras: [{ description: 'KitKat x2', amount: 40 }] };
  const r = P.reviewBlock(cands, sel);
  assert.equal(r.text, [
    'Cleaning services',
    'Oct 2 Fri (Ana) = 650 (500 + 150 transport)',
    'Oct 4 Sun = 500',
    'Other expenses',
    'KitKat x2 = 40 · no receipt',
    'Total: ₱1,190'
  ].join('\n'));
  assert.equal(r.total, 1190);
  assert.equal(P.reviewBlock(cands, { claims: { c1: true } }).text, 'Other expenses\n2 pcs KitKat for the guest = 40\nTotal: ₱40');
});

test('money formatting and labels', () => {
  assert.equal(P.peso(1340), '₱1,340'); assert.equal(P.peso(40), '₱40'); assert.equal(P.peso(1250.5), '₱1,250.50'); assert.equal(P.peso(0), '₱0');
  assert.equal(P.dateLabel('2026-09-30'), 'Sep 30 Wed'); assert.equal(P.shortDate('2026-10-05T01:00:00Z'), 'Oct 5');
  assert.equal(P.typeLabel('deep_clean'), 'Deep clean'); assert.equal(P.typeLabel('mid_stay'), 'Mid-stay clean'); assert.equal(P.typeLabel('turnover'), 'Turnover');
});

test('result messages follow SPEC-37 7.A', () => {
  assert.equal(P.resultMessage({ ok: true, ref: 'ABCD1234', total: 1340 }).text, 'Sent. Finance has your request for ₱1,340 (Ref ABCD1234). You will see it in OPS when it is paid.');
  assert.equal(P.resultMessage({ ok: true, ref: 'CASCADE-ABCD1234', total: 40 }).text.includes('(Ref ABCD1234)'), true);
  for (const r of ['session_taken', 'claim_taken']) { const m = P.resultMessage({ ok: false, reason: r }); assert.equal(m.refresh, true); assert.match(m.text, /already sent or paid/); }
  assert.match(P.resultMessage({ ok: false, reason: 'card_failed' }).text, /Finance could not be reached/);
  assert.match(P.resultMessage({ ok: false, reason: 'weird' }).text, /Nothing was sent \(weird\)\. Tell Lloyd\./);
  assert.match(P.resultMessage({ ok: false, reason: 'too_many_lines' }).text, /20 lines/);
  assert.equal(P.resultMessage(null).ok, false);
});

test('request status labels', () => {
  assert.deepEqual(P.requestStatus({ status: 'requested' }), { label: 'Waiting for payment', tone: 'warn' });
  assert.deepEqual(P.requestStatus({ status: 'paying' }), { label: 'Being paid', tone: 'info' });
  assert.deepEqual(P.requestStatus({ status: 'paid', paid_at: '2026-10-05T07:12:00Z' }), { label: 'Paid Oct 5', tone: 'ok' });
  assert.deepEqual(P.requestStatus({ status: 'cancelled' }), { label: 'Cancelled', tone: 'neutral' });
});

test('photo size: longest side 1600, never enlarged', () => {
  assert.deepEqual(P.fitSize(4000, 3000), { w: 1600, h: 1200 });
  assert.deepEqual(P.fitSize(800, 600), { w: 800, h: 600 });
});

test('bank page: no unverified app is listed or linked; a verified one builds the intent with the Play fallback', () => {
  assert.deepEqual(P.listedBankApps(), []);
  for (const k of Object.keys(P.BANK_APPS)) assert.equal(P.bankIntentUrl(k), null, k);
  assert.equal(P.bankIntentUrl('nope'), null);
  const table = { demo: { name: 'Demo', pkg: 'com.example.demo', verified: true } };
  assert.deepEqual(P.listedBankApps(table), ['demo']);
  const u = P.bankIntentUrl('demo', table);
  assert.ok(u.startsWith('intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.example.demo;'));
  assert.ok(u.includes('S.browser_fallback_url=' + encodeURIComponent('https://play.google.com/store/apps/details?id=com.example.demo')));
  assert.ok(u.endsWith(';end'));
});
