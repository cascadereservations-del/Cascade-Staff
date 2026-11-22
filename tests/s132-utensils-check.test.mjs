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
const escLine = html.split('\n').find(l => l.startsWith('const S120R_esc = '));
assert.ok(escLine, 'S120R_esc present');
const pure = new Function(escLine + '\n' + fnText('S120R_stepperHtml') + block + `\nreturn { ${names} };`)();

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

/* ── behaviour: the real card runtime (mount, paint, click, tick, load, restore, carry-over) against a small fake page ── */
const runtimeSrc = html.slice(html.indexOf('/* ── S132U: the list, the card, the send'), html.indexOf('/* ── state sync'));
assert.ok(runtimeSrc.length > 2000, 'S132U runtime present');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
function page(opts = {}) {
  const calls = [], saved = [], fetches = [], toasts = [], store = {};
  const state = { utensils: null, cleaningType: opts.type || 'turnover', checklist: {} };
  const mk = () => ({ hidden: false, className: '', id: '', innerHTML: '', textContent: '', children: [], l: {}, appendChild(c) { this.children.push(c); return c; }, addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }, setAttribute() {}, contains() { return false; }, querySelector() { return null; }, classList: { toggle() {} } });
  const document = { activeElement: null, createElement: mk };
  const nav = { onLine: opts.online !== false };
  const rpcQueue = (opts.rpc || []).slice();
  const rpc = async (name, body) => { calls.push({ name, body: JSON.parse(JSON.stringify(body)) }); return rpcQueue.shift() || { ok: true, data: { ok: true } }; };
  const fetchFn = async url => { fetches.push(url); if (opts.fetchFails) throw new Error('down'); return { ok: true, json: async () => (opts.rows !== undefined ? opts.rows : raw) }; };
  const lsJSON = (k, v) => { if (v === undefined) return store[k] === undefined ? null : JSON.parse(store[k]); store[k] = JSON.stringify(v); return true; };
  let n = 0;
  const heldWork = [];
  const fn = new Function('state', 'document', 'navigator', 'localStorage', 'lsJSON', 'SUPABASE_URL', 'PROPERTY_ID', 'EDGE_BASE', 'staffHeaders', 'fetch', 'fetchWithRetry', 'showToast', 'S120R_rpc', 'S120R_certainOffline', 'saveDraft', 'uuid', 'updateProgress', '_heldWork',
    escLine + '\n' + fnText('S120R_stepperHtml') + '\n' + html.split('\n').find(l => l.startsWith('function S120R_step(')) + '\n' + block + '\nlet _draftHold = false;\n' + runtimeSrc
    + '\nreturn { S132U_mount, S132U_load, S132U_paint, S132U_flush, S132U_restore, S132U_reportLines, S132U_state, items: () => _utItems };')(
    state, document, nav, { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, lsJSON, 'https://x', 'PROP', 'https://e', async () => ({}), fetchFn, async () => ({ json: async () => ({ urls: {} }) }), (m, k) => toasts.push(m),
    rpc, () => nav.onLine === false, () => saved.push(JSON.stringify(state.utensils)), () => 'uuid' + (++n), () => {}, heldWork);
  state.utensils = fn.S132U_state();
  const cb = Object.assign(mk(), { checked: false });
  const div = Object.assign(mk(), { classList: { toggle() {} } });
  const api = { ...fn, state, calls, saved, fetches, toasts, nav, cb, div, mountAgain() { const d = Object.assign(mk(), { classList: { toggle() {} } }), c = Object.assign(mk(), { checked: false }); fn.S132U_mount(d, {}, c); } };
  fn.S132U_mount(div, { id: 'check_7_6' }, cb);
  const wrap = div.children[0];
  api.wrap = wrap;
  api.click = (attrs, box) => { const btn = { disabled: false, dataset: attrs, closest: s => (s === '[data-ut]' && box ? { dataset: box } : null) }; wrap.l.click[0]({ target: { closest: s => (s === 'button' ? btn : null) } }); };
  api.tick = on => { cb.checked = on; cb.l.change.forEach(f => f()); };
  return api;
}

test('s132 L3 behaviour: All there ticks the step, sends nothing, even at Submit', async () => {
  const P = page(); await settle();
  assert.equal(P.wrap.hidden, false, 'the card shows once the list is read');
  P.click({ utAll: '1' });
  assert.equal(P.state.utensils.answer, 'all'); assert.equal(P.state.checklist.check_7_6, true); assert.equal(P.cb.checked, true);
  await P.S132U_flush(true);
  assert.equal(P.calls.length, 0);
  assert.deepEqual(P.S132U_reportLines(P.state.utensils), []);
});

test('s132 L3 behaviour: a stepper and Send makes one call with the exact payload', async () => {
  const P = page(); await settle();
  P.click({ utOpen: 'a' });
  P.click({ d: '1' }, { ut: 'missing', id: 'a' }); P.click({ d: '1' }, { ut: 'missing', id: 'a' }); P.click({ d: '1' }, { ut: 'broken', id: 'b' });
  assert.equal(P.state.utensils.answer, 'issues'); assert.equal(P.state.checklist.check_7_6, true);
  P.state.utensils.note = ' bent ';
  P.click({ utSend: '1' }); await settle();
  assert.equal(P.calls.length, 1);
  const c = P.calls[0];
  assert.equal(c.name, 'record_inventory_damage_v1');
  assert.deepEqual(c.body.p_rows, [{ item_id: 'a', qty: 2, reason: 'missing' }, { item_id: 'b', qty: 1, reason: 'broken' }]);
  assert.equal(c.body.p_property_id, 'PROP'); assert.equal(c.body.p_source, 'turnover'); assert.equal(c.body.p_add_to_list, true); assert.equal(c.body.p_note, 'bent');
  assert.match(c.body.p_idempotency_key, /^s132-utensils-uuid/);
  assert.equal(P.state.utensils.sent, true);
  P.click({ d: '1' }, { ut: 'missing', id: 'a' }); assert.equal(P.state.utensils.rows.a.missing, 2, 'counts are locked once sent');
});

test('s132 L3 behaviour: a reload restores a tried draft and resends with the SAME key', async () => {
  const P = page({ rpc: [{ ok: false, kind: 'retry', msg: 'no connection' }] }); await settle();
  P.click({ d: '1' }, { ut: 'missing', id: 'a' }); P.click({ utSend: '1' }); await settle();
  const first = P.calls[0].body.p_idempotency_key;
  const draft = { utensils: JSON.parse(P.saved[P.saved.length - 1]) };
  assert.equal(draft.utensils.tried, true); assert.equal(draft.utensils.key, first);
  const Q = page({ rpc: [{ ok: true, data: { ok: true, duplicate: true } }] }); await settle();
  Q.S132U_restore(draft); await settle();
  assert.equal(Q.calls.length, 1); assert.equal(Q.calls[0].body.p_idempotency_key, first, 'the same key goes again');
  assert.deepEqual(Q.calls[0].body.p_rows, [{ item_id: 'a', qty: 1, reason: 'missing' }]);
  assert.equal(Q.state.utensils.sent, true);
  const R = page(); await settle(); R.nav.onLine = false;
  R.S132U_restore({ utensils: { ...draft.utensils, waiting: true } }); await settle();
  assert.equal(R.calls.length, 0, 'offline: held, not sent');
});

/* Start fresh: carryOverSends and the stamp it reads, the real functions */
test('s132 L3 behaviour: Start fresh keeps a live send (key and counts) and drops a stale or never-tried one', () => {
  const body = fnText('S120R_sendFresh') + '\n' + html.split('\n').find(l => l.startsWith('const S120R_liveSend = ')) + '\n' + fnText('carryOverSends') + '\nreturn carryOverSends;';
  const run = u => {
    const state = { utensils: pure.S132U_newUtensils(), cleaningType: 'turnover' };
    const f = new Function('state', 'todayManila', 'S132U_migrate', 'S132U_tick', 'S120R_migrateRestock', 'S120R_migrateLinen', 'S120R_syncLinen', 'renderConfirmItems', 'S120R_refreshStatus', 'el', 'let _carryApplied = false;\n' + body)(
      state, () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }), d => ({ ...pure.S132U_newUtensils(), ...d.utensils }), () => {}, () => ({}), () => ({}), () => {}, () => {}, () => {}, () => null);
    return { kept: f({ utensils: u }), state };
  };
  const live = { answer: 'issues', rows: { a: { name: 'Fork', missing: 2, broken: 0 } }, key: 'K9', saved: true, tried: true, sendStartedAt: Date.now() - 1000 };
  const a = run(live); assert.equal(a.kept, true); assert.equal(a.state.utensils.key, 'K9');
  const old = run({ ...live, sendStartedAt: Date.now() - 3 * 86400000 }); assert.equal(old.kept, false); assert.equal(old.state.utensils.key, null);
  assert.equal(run({ ...live, sendStartedAt: null }).kept, false, 'no stamp, no carry-over');
  assert.equal(run({ ...live, tried: false, sent: false, waiting: false }).kept, false, 'never tried: not carried');
});

test('s132 L3 behaviour F1: over 30 lines, Submit sends nothing and the report names every count', async () => {
  const rows = []; for (let i = 0; i < 16; i++) rows.push({ id: 'i' + i, name: 'Item' + i, category: 'Kitchen utensils', is_active: true, is_consumable: false });
  const P = page({ rows }); await settle();
  for (let i = 0; i < 16; i++) { P.click({ d: '1' }, { ut: 'missing', id: 'i' + i }); P.click({ d: '1' }, { ut: 'broken', id: 'i' + i }); }
  assert.equal(P.state.utensils.answer, 'issues');
  P.click({ utSend: '1' }); await settle(); assert.equal(P.calls.length, 0, 'Send is refused locally');
  await P.S132U_flush(true); assert.equal(P.calls.length, 0, 'and Submit cannot send it');
  const lines = P.S132U_reportLines(P.state.utensils);
  assert.equal(lines.length, 1); assert.equal(lines[0].section, 'Kitchen');
  assert.match(lines[0].text, /Not recorded \(too many lines\)/); assert.match(lines[0].text, /Item0: 1 missing, 1 broken/); assert.match(lines[0].text, /Item15: 1 missing, 1 broken/);
  P.state.utensils.sent = true; assert.doesNotMatch(P.S132U_reportLines(P.state.utensils)[0].text, /too many/);
});

test('s132 L3 behaviour F2: a failed list read shows one muted line; an empty list shows nothing', async () => {
  const F = page({ fetchFails: true }); await settle();
  assert.equal(F.wrap.hidden, false); assert.match(F.wrap.children[1].textContent, /Could not load the utensils list/);
  assert.equal(F.wrap.children[0].innerHTML, '', 'no card, only the line'); assert.equal(F.wrap.children[1].className, 's120-status');
  const E = page({ rows: [] }); await settle();
  assert.equal(E.wrap.hidden, true); assert.equal(E.wrap.children[1].textContent, '');
  const O = page({ online: false }); await settle();
  assert.match(O.wrap.children[1].textContent, /Could not load/, 'no connection and no copy is the same');
  const W = page({ type: 'quick' }); await settle(); assert.equal(W.wrap.hidden, true, 'other cleaning types never show it');
});

test('s132 L3 behaviour F3: ticking the step or a phase Check all while the card shows means All there', async () => {
  const P = page(); await settle();
  P.tick(true);
  assert.equal(P.state.utensils.answer, 'all'); assert.equal(P.calls.length, 0);
  P.tick(false); assert.equal(P.state.utensils.answer, null, 'unticking lifts All there');
  P.click({ d: '1' }, { ut: 'missing', id: 'a' });
  P.tick(false); assert.equal(P.state.utensils.answer, 'issues'); assert.equal(P.cb.checked, true, 'counts keep the tick');
  const L = page(); await settle();
  L.click({ d: '1' }, { ut: 'missing', id: 'a' }); L.state.utensils.tried = true;
  L.tick(true); assert.equal(L.state.utensils.answer, 'issues', 'a send in flight is not overwritten');
  const N = page({ fetchFails: true }); await settle();
  N.tick(true); assert.equal(N.state.utensils.answer, null, 'no card on screen: the plain tick stands');
});

test('s132 L3 behaviour F4/F6: one list read per page; a failed read is tried again; the filter is a wildcard with an exact client test', async () => {
  const P = page(); await settle();
  P.mountAgain(); P.mountAgain(); await settle();
  assert.equal(P.fetches.length, 1, 're-renders do not fetch again');
  assert.match(P.fetches[0], /category=ilike\.\*kitchen%20utensils\*/);
  const F = page({ fetchFails: true }); await settle();
  F.mountAgain(); await settle(); assert.equal(F.fetches.length, 2, 'a failed read is retried on the next render');
  assert.deepEqual(P.items().map(i => i.id), ['a', 'b']);
  assert.deepEqual(pure.S132U_items([{ id: 'z', name: 'Kitchen utensils set', category: 'Kitchen utensils set', is_active: true, is_consumable: false }]), [], 'the wildcard rows are cut back to the exact group');
});
