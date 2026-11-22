// s132 lane L3 (D-396): the Kitchen utensils check card. The real S132U block and send functions from checklist/index.html run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = process.env.S132U_SRC || new URL('../checklist/index.html', import.meta.url);   // I_red.mjs points this at a mutated copy
const html = readFileSync(SRC, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const fnText = name => {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  return html.slice(s, html.indexOf('\n}\n', s) + 3);
};
const block = html.slice(html.indexOf('/* S132U:BEGIN'), html.indexOf('/* S132U:END */'));
assert.ok(block.length > 500, 'S132U block present');
const names = 'S132U_items,S132U_newUtensils,S132U_migrate,S132U_problems,S132U_rows,S132U_settle,S132U_locked,S132U_args,S132U_failText,S132U_summary,S132U_reportLines,S132U_status,S132U_cardHtml,S132U_emoji';
const pure = new Function(fnText('S120R_stepperHtml') + block + `\nreturn { ${names} };`)();

const raw = [
  { id: 'a', name: 'Dinner fork', category: 'Kitchen utensils', unit: 'pc', qty_on_hand: 8, photo_path: 'items/a.webp', is_active: true, is_consumable: false },
  { id: 'b', name: 'Soup spoon', category: ' kitchen UTENSILS ', unit: 'pc', qty_on_hand: 6, photo_path: null, is_active: true, is_consumable: false },
  { id: 'c', name: 'Dish soap', category: 'Kitchen utensils', unit: 'btl', qty_on_hand: 2, is_active: true, is_consumable: true },
  { id: 'd', name: 'Old pan', category: 'Kitchen utensils', qty_on_hand: 1, is_active: false, is_consumable: false },
  { id: 'e', name: 'Towel', category: 'Linen', qty_on_hand: 4, is_active: true, is_consumable: false },
  { id: 'f', name: 'Unknown flag', category: 'Kitchen utensils', qty_on_hand: 4, is_active: true },
  { id: 'a', name: 'Dinner fork', category: 'Kitchen utensils', qty_on_hand: 8, is_active: true, is_consumable: false },
];

test('s132 L3: only active, lasting items of the Kitchen utensils group, once each, with the expected count', () => {
  const it = pure.S132U_items(raw);
  assert.deepEqual(it.map(i => i.id), ['a', 'b']);
  assert.equal(it[0].qty, 8); assert.equal(it[0].photo, 'items/a.webp'); assert.equal(it[1].photo, null);
  assert.deepEqual(pure.S132U_items(null), []);
});

test('s132 L3: the call is exactly the contract, source turnover, add to list, key passed through', () => {
  const U = pure.S132U_newUtensils();
  U.rows = { a: { name: 'Dinner fork', missing: 2, broken: 1 }, b: { name: 'Soup spoon', missing: 0, broken: 3 } }; U.note = ' chipped ';
  const a = pure.S132U_args('P1', U, 'K1');
  assert.deepEqual(Object.keys(a).sort(), ['p_add_to_list', 'p_booking_id', 'p_idempotency_key', 'p_note', 'p_photo_path', 'p_property_id', 'p_rows', 'p_source']);
  assert.equal(a.p_source, 'turnover'); assert.equal(a.p_add_to_list, true); assert.equal(a.p_idempotency_key, 'K1'); assert.equal(a.p_note, 'chipped');
  assert.deepEqual(a.p_rows, [{ item_id: 'a', qty: 2, reason: 'missing' }, { item_id: 'a', qty: 1, reason: 'broken' }, { item_id: 'b', qty: 3, reason: 'broken' }]);
  assert.equal(pure.S132U_args('P1', pure.S132U_newUtensils(), 'K').p_note, null);
});

test('s132 L3: any count makes the answer issues; clearing them lifts it; All there stays while nothing is wrong', () => {
  const U = pure.S132U_newUtensils();
  U.answer = 'all'; assert.equal(pure.S132U_settle(U), 'all');
  U.rows = { a: { name: 'x', missing: 1, broken: 0 } }; assert.equal(pure.S132U_settle(U), 'issues');
  U.rows = {}; assert.equal(pure.S132U_settle(U), null);
});

test('s132 L3: old drafts. A ticked check_7_6 becomes All there and sends nothing; an untouched one stays empty', () => {
  const m = pure.S132U_migrate({ checklist: { check_7_6: true } });
  assert.equal(m.answer, 'all'); assert.equal(m.key, null); assert.equal(m.saved, false); assert.equal(m.sent, false);
  assert.deepEqual(pure.S132U_rows(m), []); assert.deepEqual(pure.S132U_reportLines(m), []);
  assert.equal(pure.S132U_migrate({ checklist: {} }).answer, null);
  assert.equal(pure.S132U_migrate(null).answer, null);
  const n = pure.S132U_migrate({ utensils: { answer: 'issues', rows: { a: { name: 'f', missing: 2, broken: 0, junk: 1 }, z: { missing: 0, broken: 0 } }, key: 'K', saved: true, tried: true, sendStartedAt: 5 } });
  assert.equal(n.answer, 'issues'); assert.deepEqual(Object.keys(n.rows), ['a']); assert.equal(n.key, 'K'); assert.equal(n.tried, true);
});

test('s132 L3: tried, sent and waiting lock the counts; a fresh card is open', () => {
  const U = pure.S132U_newUtensils();
  assert.equal(pure.S132U_locked(U), false);
  U.tried = true; assert.equal(pure.S132U_locked(U), true);
  U.tried = false; U.sent = true; assert.equal(pure.S132U_locked(U), true);
});

test('s132 L3: the card html. Photo first and lazy, emoji fallback, All there, locked controls', () => {
  const items = pure.S132U_items(raw), U = pure.S132U_newUtensils();
  let h = pure.S132U_cardHtml(U, items, { 'items/a.webp': 'https://x/y.webp' }, {});
  assert.match(h, /<img src="https:\/\/x\/y\.webp" alt="" width="40" height="40" loading="lazy"/);
  assert.match(h, /data-ut-all="1"/); assert.match(h, /expected 8/);
  assert.equal((h.match(/<img/g) || []).length, 1, 'the item with no photo shows the emoji');
  h = pure.S132U_cardHtml(U, items, { 'items/a.webp': 'https://x/y.webp' }, { 'https://x/y.webp': true });
  assert.ok(!/<img/.test(h), 'a link that failed to load falls back to the emoji');
  U.rows = { a: { name: 'Dinner fork', missing: 2, broken: 0 } }; U.open = 'a'; pure.S132U_settle(U);
  h = pure.S132U_cardHtml(U, items, {}, {});
  assert.match(h, /data-ut-send="1"/); assert.match(h, /s132-ut-note/); assert.match(h, /data-ut="missing" data-id="a"/); assert.match(h, /2 missing/);
  U.tried = true; h = pure.S132U_cardHtml(U, items, {}, {});
  assert.ok(!/data-ut-send/.test(h), 'no Send while locked'); assert.match(h, /s132-ut-note"[^>]* disabled/);
});

test('s132 L3: more than 30 lines is blocked locally', () => {
  const U = pure.S132U_newUtensils();
  for (let i = 0; i < 16; i++) U.rows['i' + i] = { name: 'n' + i, missing: 1, broken: 1 };
  pure.S132U_settle(U);
  assert.equal(pure.S132U_rows(U).length, 32);
  assert.match(pure.S132U_cardHtml(U, [], {}, {}), /data-ut-send="1" disabled/);
});

test('s132 L3: the report carries a send that did not go, and says recorded when it did', () => {
  const U = pure.S132U_newUtensils(); U.rows = { a: { name: 'Fork', missing: 2, broken: 1 } }; pure.S132U_settle(U);
  assert.deepEqual(pure.S132U_reportLines(U), [], 'nothing saved, nothing to report');
  U.saved = true; assert.match(pure.S132U_reportLines(U)[0].text, /Fork: 2 missing, 1 broken.*Not confirmed as recorded/);
  U.failed = 'an item is linen'; assert.match(pure.S132U_reportLines(U)[0].text, /Not recorded \(an item is linen\)/);
  U.failed = ''; U.sent = true; assert.match(pure.S132U_reportLines(U)[0].text, /Recorded\./);
});

// the real send functions, with fakes
function rig(responses, opts = {}) {
  const calls = [], saved = [], held = [];
  const state = { utensils: pure.S132U_newUtensils(), cleaningType: 'turnover' };
  state.utensils.rows = { a: { name: 'Fork', missing: 2, broken: 0 } };
  state.utensils.answer = 'issues'; state.utensils.saved = true;
  const rpc = async (name, body) => { calls.push({ name, body: JSON.parse(JSON.stringify(body)) }); const r = responses.shift(); return typeof r === 'function' ? r() : r; };
  const body = [fnText('S132U_send'), fnText('S132U_flush'), fnText('S132U_flushOnce')].join('\n');
  const fn = new Function('state', 'S120R_rpc', 'S120R_certainOffline', 'saveDraft', 'uuid', 'PROPERTY_ID', 'S132U_paint', 'S132U_active', 'S132U_state', '_heldWork',
    block + '\nlet _draftHold = false;\nlet _utQueue = Promise.resolve();\n' + body + '\nreturn { S132U_send, S132U_flush, S132U_flushOnce };');
  let n = 0;
  const api = fn(state, rpc, () => !!opts.offline, () => saved.push(JSON.stringify(state.utensils)), () => 'uuid' + (++n), 'PROP', () => {}, () => true, () => state.utensils, held);
  return { state, calls, saved, api, held };
}
const ok = { ok: true, data: { ok: true } };

test('s132 L3: one call, one key, kept across a retry; sent on success', async () => {
  const R = rig([{ ok: false, kind: 'retry', msg: 'no connection' }, ok]);
  await R.api.S132U_flush(false);
  const U = R.state.utensils;
  assert.equal(R.calls.length, 1); assert.equal(U.waiting, true); assert.equal(U.tried, true); assert.equal(U.sent, false); assert.match(U.key, /^s132-utensils-uuid/);
  assert.ok(U.sendStartedAt > 0, 'the send stamp is stored for carry-over');
  const key = U.key;
  await R.api.S132U_flush(false);
  assert.equal(R.calls.length, 2); assert.equal(R.calls[1].body.p_idempotency_key, key, 'a retry reuses the key');
  assert.equal(R.calls[0].name, 'record_inventory_damage_v1'); assert.equal(R.calls[0].body.p_source, 'turnover'); assert.equal(R.calls[0].body.p_add_to_list, true);
  assert.equal(U.sent, true); assert.equal(U.waiting, false);
  await R.api.S132U_flush(false);
  assert.equal(R.calls.length, 2, 'no double send once sent');
});

test('s132 L3: duplicate:true counts as sent; ok:false from the server is a refusal that waits for a change', async () => {
  const R = rig([{ ok: true, data: { ok: true, duplicate: true } }]);
  await R.api.S132U_flush(false); assert.equal(R.state.utensils.sent, true);
  const Q = rig([{ ok: true, data: { ok: false, reason: 'linen_item' } }]);
  await Q.api.S132U_flush(false);
  assert.equal(Q.state.utensils.sent, false); assert.match(Q.state.utensils.failed, /linen/); assert.equal(Q.state.utensils.tried, false);
  await Q.api.S132U_flush(false); assert.equal(Q.calls.length, 1, 'a refusal is not sent again until something changes');
  const P = rig([{ ok: false, kind: 'refused', msg: 'not_allowed' }]);
  await P.api.S132U_flush(false); assert.match(P.state.utensils.failed, /may not report/); assert.equal(P.state.utensils.tried, false);
});

test('s132 L3: All there sends nothing; offline before the first try does not lock the counts', async () => {
  const R = rig([]); R.state.utensils.rows = {}; R.state.utensils.answer = 'all'; R.state.utensils.saved = true;
  await R.api.S132U_flush(true); assert.equal(R.calls.length, 0);
  const O = rig([{ ok: false, kind: 'retry', msg: 'no connection' }], { offline: true });
  await O.api.S132U_flush(false);
  assert.equal(O.state.utensils.tried, false); assert.equal(O.state.utensils.waiting, true);
});

test('s132 L3: Submit sends counts that were typed but never sent; the flush never throws', async () => {
  const R = rig([ok]); R.state.utensils.saved = false;
  const r = await R.api.S132U_flush(true);
  assert.equal(R.calls.length, 1); assert.equal(r.sent, true);
  const T = rig([() => { throw new Error('boom'); }]);
  const t = await T.api.S132U_flush(true); assert.equal(t.sent, false);
});

test('s132 L3: the wiring in the page. Turnover and deep clean only, Submit flush non-blocking, draft and carry-over keep the card', () => {
  assert.match(html, /id: 'check_7_6'[^\n]*utensils: true, only: \['turnover', 'deep_clean'\]/);
  assert.match(html, /if \(item\.utensils\) S132U_mount\(div, item, cb\);/);
  assert.match(html, /utensils:\s+state\.utensils \|\| null/);
  assert.match(html, /S132U_restore\(draft\);/);
  assert.match(html, /S120R_liveSend\(draft\.utensils\)/);
  assert.match(html, /S132U_reportLines\(state\.utensils\)/);
  assert.match(html, /S120R_liveSend\(draft\.linen\) \|\| S120R_liveSend\(draft\.utensils\)/, 'a live utensils send is carried over a reset');
  assert.match(fnText('runPreSubmitFlush'), /S132U_flush\(true\)/);
  assert.ok((html.match(/K_only\(KITCHEN_ITEMS\)/g) || []).length >= 5, 'every list that reads the kitchen items filters by type');
});
