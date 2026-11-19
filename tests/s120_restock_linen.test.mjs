// Session 120, lane R: the linen check and the restock sheet. The real S120R block and the send functions from index.html run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holdSnippet, resumeSnippet } from './s120_page_snippets.mjs';

const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const NL = String.fromCharCode(10);
const fnText = name => {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  return html.slice(s, html.indexOf('\n}\n', s) + 3);
};
const block = html.slice(html.indexOf('/* S120R:BEGIN'), html.indexOf('/* S120R:END */'));

// the live consumables (read 2026-11-18, names only)
const names = ['Coffee (3-in-1)', 'Bottled Water', 'Tea', 'Sugar & Creamer Sticks', 'Toiletries (toothbrush, toothpaste, soap)', 'Bathroom tissue', 'Kitchen towel',
  'Body Wash', 'Hand Soap', 'Shampoo (Palmolive)', 'Laundry Detergent', 'Dishwashing Liquid (Joy)', 'Insect Spray', 'Garbage Bags (Large)'];
const ITEMS = names.map((name, n) => ({ id: 'id' + n, name, category: 'x' }));
const idOf = nm => ITEMS.find(i => i.name === nm).id;

const pure = new Function(block + '\nreturn { S120R_classify, S120R_restockMissing, S120R_restockRows, S120R_linenComplete, S120R_linenResult, S120R_migrateLinen, S120R_migrateRestock, S120R_newRestock, S120R_newLinen, S120R_reportLines, S120R_failKind, S120R_step, S120R_linenRows, S120R_LINEN_RE, S120R_unitLine, S120R_OUTCOMES };')();

test('s120R: the sheet groups every live consumable exactly once, in the order the brief names', () => {
  const c = pure.S120R_classify(ITEMS);
  assert.deepEqual(c.top.map(i => i.name), ['Bottled Water', 'Coffee (3-in-1)', 'Tea', 'Sugar & Creamer Sticks', 'Bathroom tissue']);   // s121: detergent left the main rows
  assert.ok(c.other.some(i => i.name === 'Laundry Detergent'));
  assert.equal(c.kit.name, 'Toiletries (toothbrush, toothpaste, soap)');
  assert.deepEqual(c.chips.map(i => i.name), ['Kitchen towel']);
  assert.equal(c.top.length + 1 + c.chips.length + c.other.length, ITEMS.length);
  assert.ok(c.other.some(i => i.name === 'Body Wash') && !c.other.some(i => i.name === 'Tea'));
});

test('s121 R6: the sheet starts at the standard amounts, so a fresh sheet is complete and only a number over the stock blocks Save', () => {
  const c = pure.S120R_classify(ITEMS);
  const rs = pure.S120R_newRestock();
  assert.deepEqual(pure.S120R_restockMissing(rs, c, 'turnover'), [], 'the defaults are the answers');
  assert.deepEqual(pure.S120R_restockMissing(pure.S120R_newRestock(), c, 'emergency'), [], 'an emergency visit is exempt');
  const none = pure.S120R_newRestock(); none.none = true;
  assert.deepEqual(pure.S120R_restockMissing(none, c, 'mid_stay'), [], 'nothing used is an answer for a mid-stay');
  assert.deepEqual(pure.S120R_restockMissing(none, c, 'turnover'), [], 'a standard sheet is complete for any other type');
});

test('s120R: rows sent are positive amounts only, one usage_key per session and item, no ml', () => {
  const c = pure.S120R_classify(ITEMS);
  const rs = pure.S120R_newRestock(); rs.key = 'K1';
  c.top.forEach(i => { rs.top[i.id] = 0; });
  rs.top[idOf('Tea')] = 2; rs.top[idOf('Bottled Water')] = 4;
  rs.kit = { a: 'yes', n: 3 };
  rs.extras[idOf('Kitchen towel')] = 1;
  rs.other[idOf('Body Wash')] = 1; rs.other[idOf('Hand Soap')] = 0;
  const rows = pure.S120R_restockRows(rs, c);
  assert.deepEqual(rows.map(r => [r.item_id, r.used_qty]).sort(), [[idOf('Bottled Water'), 4], [idOf('Body Wash'), 1], [idOf('Kitchen towel'), 1], [idOf('Tea'), 2], [idOf('Toiletries (toothbrush, toothpaste, soap)'), 3]].sort());
  assert.ok(rows.every(r => r.usage_key === 's120-K1-' + r.item_id && Object.keys(r).sort().join() === 'item_id,usage_key,used_qty'));
  rs.kit = { a: 'no', n: null };
  assert.ok(!pure.S120R_restockRows(rs, c).some(r => r.item_id === c.kit.id), 'No sends nothing for the kit');
  rs.none = true;
  assert.deepEqual(pure.S120R_restockRows(rs, c, 'mid_stay'), [], 'nothing used, mid-stay: no rows');
  assert.ok(pure.S120R_restockRows(rs, c, 'turnover').length > 0, 'R3 item 6: nothing-used is a mid-stay answer only');
});

test('s120R: the stepper starts from a dash (+ gives 1, - gives 0) and stops at 0 and 99', () => {
  assert.equal(pure.S120R_step(null, 1, 99), 1);
  assert.equal(pure.S120R_step(null, -1, 99), 0);
  assert.equal(pure.S120R_step(0, -1, 99), 0);
  assert.equal(pure.S120R_step(99, 1, 99), 99);
});

test('s120R: linen result and generated note', () => {
  const L = pure.S120R_newLinen();
  assert.equal(pure.S120R_linenResult(L).state, null);
  L.answer = 'none';
  assert.deepEqual(pure.S120R_linenResult(L), { state: 'confirmed', note: '' });
  L.answer = 'found';
  assert.equal(pure.S120R_linenResult(L).state, null, 'found with no rows is not an answer');
  L.rows = [{ item_id: 'a', name: 'Bath Towel', qty: 2, outcome: 'cleaned' }, { item_id: 'b', name: 'Fitted Sheet (Q)', qty: 1, outcome: null }];
  assert.equal(pure.S120R_linenComplete(L), false, 'one row without an outcome');
  L.rows[1].outcome = 'replaced';
  assert.deepEqual(pure.S120R_linenResult(L), { state: 'issue', note: 'Linen stains. Replaced now: Fitted Sheet (Q). Stain came out: Bath Towel x2.' });
  L.rows[1].outcome = 'cleaned';
  assert.equal(pure.S120R_linenResult(L).state, 'confirmed');
  assert.ok(pure.S120R_linenResult(L).note.includes('Bath Towel x2') && pure.S120R_linenResult(L).note.includes('Fitted Sheet (Q)'));
  assert.deepEqual(pure.S120R_linenRows(L), [{ item_id: 'a', qty: 2, outcome: 'cleaned' }, { item_id: 'b', qty: 1, outcome: 'cleaned' }]);
});

test('s120R: linen names match the live non-consumable pieces and not a mug', () => {
  for (const n of ['Quilted Mattress Protector (Q)', 'Fitted Sheet (S)', 'Duvet Cover (Q)', 'Comforter (Q)', 'Bath Towel', 'Square Pillow (Big)', 'Pillow Case (Rect)', 'Sofa Cover', 'Throw Pillowcase', 'Floor mat', 'Bath rug']) assert.ok(pure.S120R_LINEN_RE.test(n), n);
  assert.ok(!pure.S120R_LINEN_RE.test('Wall Clock'));
});

test('s120R: old drafts migrate and nothing already saved is sent twice', () => {
  assert.equal(pure.S120R_migrateLinen({ confirmItems: { check_2_4: 'confirmed' } }).answer, 'none');
  const old = pure.S120R_migrateLinen({ confirmItems: { check_2_4: 'issue' }, confirmNotes: { check_2_4: 'wine on pillowcase' } });
  assert.deepEqual([old.answer, old.legacyNote], ['legacy', 'wine on pillowcase']);
  assert.deepEqual(pure.S120R_linenResult(old), { state: 'issue', note: 'wine on pillowcase' }, 'the typed note still reaches the report');
  assert.equal(pure.S120R_migrateLinen({}).answer, null);
  const rs = pure.S120R_migrateRestock({ supplyLogSaved: true });
  assert.deepEqual([rs.saved, rs.sent, rs.none, rs.legacy], [true, true, false, true], 'the old sheet already wrote it, and it is not "nothing used": we do not know what it held');
  const fresh = pure.S120R_migrateRestock({});
  assert.deepEqual([fresh.saved, fresh.sent], [false, false]);
  const kept = pure.S120R_migrateRestock({ restock: { top: { a: 2 }, kit: { a: 'yes', n: 1 }, saved: true, sent: false, key: 'k' } });
  assert.deepEqual([kept.top.a, kept.kit.n, kept.saved, kept.sent, kept.key], [2, 1, true, false, 'k']);
  const lin = pure.S120R_migrateLinen({ linen: { answer: 'found', rows: [{ item_id: 'x', name: 'Bath Towel', qty: 1, outcome: 'cleaned' }], key: 'lk', sent: false } });
  assert.deepEqual([lin.rows.length, lin.key, lin.sent], [1, 'lk', false]);
});

test('s120R: a send that failed for a reason the server gave stops retrying; a lost connection keeps retrying', () => {
  assert.equal(pure.S120R_failKind(0), 'retry');
  assert.equal(pure.S120R_failKind(503), 'retry');
  assert.equal(pure.S120R_failKind(401), 'retry');
  assert.equal(pure.S120R_failKind(400), 'refused');
  assert.equal(pure.S120R_failKind(403), 'refused');
});

test('s120R: report lines carry the something-else text and any refused send, and nothing else', () => {
  assert.deepEqual(pure.S120R_reportLines(null, null), []);
  const lines = pure.S120R_reportLines({ failed: 'unknown linen item' }, { elseText: ' chocolates ', failed: '' });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { section: 'Restock', text: 'Restock, something else: chocolates' });
  assert.equal(lines[1].section, 'Linen', 'the linen refusal is not filed under Restock');
  assert.ok(lines[1].text.startsWith('Linen stock was not updated'));
});

/* ---- sending: offline keeps everything, online sends once with the same key, a replay is harmless ---- */
function sender() {
  const calls = [];
  let mode = 'offline';
  const state = { cleaningType: 'turnover', linen: null, restock: null, supplyLogSaved: false, confirmItems: {}, confirmNotes: {}, issueFlags: {} };
  const els = {};
  const el = id => (id === 'cleaningDate' ? { value: '2026-11-18' } : id === 'cleanerName' ? { value: 'Kay' } : (els[id] = els[id] || { classList: { add() {}, remove() {} } }));
  const fetch = async (url, opt) => {
    calls.push({ url, body: JSON.parse(opt.body) });
    if (mode === 'offline') throw new TypeError('Failed to fetch');
    if (mode === 'refuse') return { ok: false, status: 400, text: async () => JSON.stringify({ message: 'unknown linen item' }) };
    return { ok: true, status: 200, text: async () => '{}' };
  };
  return { calls, state, set mode(m) { mode = m; }, el, fetch };
}

/* the real send functions from index.html, with the page's globals stubbed */
const SEND_FNS = ['S120R_rpc', 'S120R_sendLinen', 'S120R_sendRestock', 'S120R_flushAll', 'S120R_flushOnce', 'S120R_commit', 'S120R_refreshStatus', 'S120R_fetchItems', 'S120R_loadItems', 'S120R_unsave', 'S120R_onRestockClick', 'S120R_saveRestock'];
function harness(t, items, opts = {}) {
  const log = { bar: 0, toasts: [], saves: 0, renders: 0 };
  let n = 0;
  const fn = new Function('state', 'el', 'fetch', 'staffHeaders', 'uuid', 'todayManila', 'saveDraft', 'SUPABASE_URL', 'PROPERTY_ID', 'log', 'cache',
    block + NL + holdSnippet(html) + NL + SEND_FNS.concat(opts.fns || []).map(fnText).join(NL) + NL
    + 'let _susItems = ' + JSON.stringify(items) + ', _susLoaded = false;\n'
    + 'const fetchWithRetry = (u, o) => fetch(u, o);\n'
    + 'const lsJSON = (k, v) => { if (v === undefined) return cache[k] || null; cache[k] = v; };\n'
    + 'const updateBottomBar = () => { log.bar++; }; const closeSupplyUsageSheet = () => {}; const showToast = (m) => { log.toasts.push(m); };\n'
    + 'function S120R_renderRestock() { log.renders++; }\n'
    + 'return { flush: S120R_flushAll, save: S120R_saveRestock, click: S120R_onRestockClick, setCtx: S120R_setCtx, normCtx: S120R_normCtx, unsave: S120R_unsave, commit: S120R_commit, refresh: S120R_refreshStatus, typeChanged: typeof S120R_typeChanged === "function" ? S120R_typeChanged : null, items: () => _susItems };');
  return fn(t.state, t.el, t.fetch, async () => ({}), () => 'uuid-' + (++n), () => '2026-11-18', () => { log.saves++; }, 'https://x.test', 'prop-1', log, opts.cache || {});
}
const linenFound = () => ({ answer: 'found', rows: [{ item_id: 'i1', name: 'Bath Towel', qty: 1, outcome: 'needs_replacing' }], key: null, sent: false, tried: false, failed: '', legacyNote: '', unavailable: false });
const restockSaved = () => Object.assign(pure.S120R_newRestock(), { saved: true });

test('s120R: offline the linen and restock stay in the draft, then send once with one key each; a second flush sends nothing', async () => {
  const t = sender();
  const h = harness(t, ITEMS);
  t.state.linen = linenFound();
  const rs = t.state.restock = restockSaved();
  const cls = pure.S120R_classify(ITEMS);
  cls.top.forEach(i => { rs.top[i.id] = 0; }); rs.top[idOf('Tea')] = 2; rs.kit = { a: 'no', n: null };

  t.mode = 'offline';
  let r = await h.flush(false);
  assert.deepEqual(r.pending, ['linen check', 'restock'], 'both are still unsent and say so');
  assert.equal(t.state.linen.sent, false); assert.equal(rs.sent, false);
  assert.equal(t.state.linen.answer, 'found', 'nothing was lost');
  const linenKey = t.state.linen.key, restockKey = rs.key;
  assert.ok(linenKey && restockKey, 'the keys are minted once and kept in the draft');

  t.mode = 'online';
  r = await h.flush(false);
  assert.deepEqual(r.pending, []);
  assert.deepEqual([t.state.linen.sent, rs.sent], [true, true]);
  const linenCall = t.calls.filter(c => c.url.endsWith('/rpc/record_linen_stains_v1')).pop();
  assert.equal(linenCall.body.p_idempotency_key, linenKey, 'the retry used the same key');
  assert.deepEqual(linenCall.body.p_rows, [{ item_id: 'i1', qty: 1, outcome: 'needs_replacing' }]);
  const useCall = t.calls.filter(c => c.url.endsWith('/rpc/record_restock_v1')).pop();
  assert.deepEqual(useCall.body.p_rows, [{ item_id: idOf('Tea'), used_qty: 2, usage_key: 's120-' + restockKey + '-' + idOf('Tea') }]);
  assert.equal(useCall.body.p_session_date, '2026-11-18');
  const before = t.calls.length;
  await h.flush(false);
  assert.equal(t.calls.length, before, 'sent sets are never sent again');
});

test('s120R: a send the server refuses is reported, and Submit gets one more try (item 4)', async () => {
  const t = sender();
  const h = harness(t, []);
  t.state.linen = linenFound();
  t.state.linen.rows[0].outcome = 'replaced';
  t.mode = 'refuse';
  const r = await h.flush(false);
  assert.deepEqual(r.pending, [], 'a refusal does not block the submit');
  assert.equal(t.state.linen.failed, 'unknown linen item');
  assert.ok(pure.S120R_reportLines(t.state.linen, null)[0].text.includes('unknown linen item'), 'and it reaches the report');
  const n = t.calls.length;
  await h.flush(false);
  assert.equal(t.calls.length, n, 'a normal flush does not hammer a refused set');
  t.mode = 'online';
  await h.flush(false, true);
  assert.equal(t.calls.length, n + 1, 'at Submit the failed set is tried once more');
  assert.deepEqual([t.state.linen.sent, t.state.linen.failed], [true, ''], 'and a good answer clears the sticky failure');
});

test('s120R: item 1 - a saved Restock with no list is never sent and never counts as answered', async () => {
  const t = sender(); t.mode = 'online';
  const h = harness(t, []);
  const rs = t.state.restock = restockSaved();
  const r = await h.flush(false);   // no list, no cache
  assert.deepEqual(r.pending, ['restock']);
  assert.equal(rs.sent, false); assert.equal(t.calls.filter(c => c.url.includes('record_restock_v1')).length, 0);
  // Save on an empty list is refused outright
  const rs2 = t.state.restock = pure.S120R_newRestock();
  await h.save(false);
  assert.equal(rs2.saved, false); assert.equal(t.state.supplyLogSaved, false);
  // a saved sheet whose answers are all zero sends nothing and is not marked sent
  const h2 = harness(t, ITEMS);
  const rs3 = t.state.restock = restockSaved();
  pure.S120R_classify(ITEMS).top.forEach(i => { rs3.top[i.id] = 0; }); rs3.kit = { a: 'no', n: null };
  t.calls.length = 0;
  await h2.flush(false);
  assert.equal(t.calls.length, 0); assert.equal(rs3.sent, false);
});

test('s120R: item 1 - a saved sheet that lost its answers un-saves before anything is sent', async () => {
  const t = sender(); t.mode = 'online';
  const h = harness(t, ITEMS);
  h.setCtx(h.normCtx({ ok: true, stock: [], remembered: {}, upkeep_due: { dish_soap: true, dish_sponge: false }, next_tier: null }));
  const rs = t.state.restock = restockSaved();   // saved, but a due dish question was never answered
  t.state.supplyLogSaved = true;
  const r = await h.flush(false);
  assert.ok(r.unanswered.some(x => /dish soap/i.test(x)), JSON.stringify(r.unanswered));
  assert.deepEqual([rs.saved, t.state.supplyLogSaved, rs.sent], [false, false, false]);
  assert.equal(t.calls.length, 0);
});

test('s120R: item 3 - two flushes at once make one call (a double tap, or online plus Submit)', async () => {
  const t = sender(); t.mode = 'online';
  const h = harness(t, ITEMS);
  t.state.linen = linenFound();
  const [a, b] = await Promise.all([h.flush(false), h.flush(false)]);
  assert.equal(t.calls.filter(c => c.url.includes('record_linen_stains_v1')).length, 1);
  assert.deepEqual([a.pending, b.pending], [[], []], 'neither run reports a false failure');
  assert.equal(t.state.linen.sent, true);
});

test('s120R: item 3 - the RPC goes through fetchWithRetry (timeout) and sends are queued one at a time', () => {
  assert.match(fnText('S120R_rpc'), /await fetchWithRetry\(/);
  assert.match(html, /let _s120rQueue = Promise\.resolve\(\)/);
});

test('s120R: item 5 - only a real answer change un-saves Restock; the folds do not', () => {
  const t = sender();
  const h = harness(t, ITEMS);
  const rs = t.state.restock = restockSaved(); t.state.supplyLogSaved = true;
  const box = { dataset: { k: 'top', id: idOf('Tea') } };
  const press = (dataset, id = '') => h.click({ target: { closest: sel => (sel === 'button' ? { dataset, id, disabled: false, closest: () => box } : null) } });
  press({}, 's120-other-toggle');
  assert.equal(rs.saved, true, 'the Other items fold is not an answer');
  assert.equal(rs.otherOpen, true);
  press({ else: '1' });
  assert.equal(rs.saved, true, 'nor is opening Something else');
  press({ d: '1' });
  assert.deepEqual([rs.top[idOf('Tea')], rs.saved, t.state.supplyLogSaved], [1, false, false], 'a count change is');
});

test('s120R: item 5 - un-saving clears the failure and the saved flag; Submit is gated on a saved Restock', () => {
  const t = sender();
  const h = harness(t, ITEMS);
  const rs = t.state.restock = restockSaved(); rs.failed = 'old'; t.state.supplyLogSaved = true;
  h.unsave(rs);
  assert.deepEqual([rs.saved, rs.failed, t.state.supplyLogSaved], [false, '', false]);
  assert.match(html, /case 6: return isPhase4Valid\(\) && K_gatedOk\(6\) && \(state\.cleaningType === 'emergency' \|\| state\.supplyLogSaved\)/);
  assert.match(fnText('runPreSubmitFlush'), /!state\.supplyLogSaved/);
});

test('s120R: item 10 - No stains and the list-unavailable answer are marked sent only when Submit really proceeds', () => {
  const t = sender();
  const h = harness(t, ITEMS);
  t.state.linen = { answer: 'none', rows: [], key: null, sent: false, tried: false, failed: '', legacyNote: '', unavailable: false };
  assert.equal(t.state.linen.sent, false, 'answering does not mark it sent');
  h.commit();
  assert.equal(t.state.linen.sent, true);
  const U = t.state.linen = linenFound(); U.unavailable = true;
  h.commit();
  assert.equal(U.sent, true, 'the list-unavailable answer needs no RPC and is final at Submit');
  assert.equal(t.calls.length, 0);
});

test('s120R: the unit line reads "Counted in ..." and says nothing for an unknown unit', () => {
  assert.equal(pure.S120R_unitLine('bottle'), 'Counted in bottles');
  assert.equal(pure.S120R_unitLine('box'), 'Counted in boxes');
  assert.equal(pure.S120R_unitLine('pcs'), 'Counted in pieces');
  assert.equal(pure.S120R_unitLine(''), '');
});

test('s120R: the page wires it in: draft keeps linen and restock, Submit flushes first and waits for the online event, the shell cache is bumped', () => {
  assert.match(html, /linen:\s+state\.linen,/);
  assert.match(html, /restock:\s+state\.restock \|\| null,/, 'R5: the key is always written, so a draft without it is known to be from the older sheet');
  assert.match(html, /sent = await S120R_flushAll\(false, true\);/);
  assert.match(fnText('runPreSubmitFlush'), /state\.pendingPreSubmit = true;/, 'item 2: Submit remembers it stopped');
  assert.match(fnText('runPreSubmitFlush'), /submit-status/, 'item 2: and says so on screen, not only in a toast');
  assert.match(fnText('S120R_resumePreSubmit'), /state\.pendingPreSubmit[\s\S]*?runPreSubmitFlush\(\)/, 'item 2: the online event runs it again');
  assert.match(html, /window\.addEventListener\('online', \(\) => \{ S120R_flushAll\(true\); \}\);/);
  assert.match(html, /const DRAFT_VERSION\s+= 5;/, 'old drafts are migrated, not discarded');
  assert.ok(!/LIQUID_ML_PER_UNIT|QUICK_ITEM_NAMES/.test(html), 'item 14: dead constants are gone');
  const sw = readFileSync(new URL('../checklist/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE_NAME = 'ch-shell-v12-restock-defaults';/);
});


/* ================= Lane R3 (s120): polish ================= */

test('R3 item 3: normal linen lines are muted; only a failed or refused send is red', () => {
  const t = sender(); const h = harness(t, ITEMS);
  const L = t.state.linen = pure.S120R_newLinen(); t.state.restock = pure.S120R_newRestock();
  const n = t.el('s120-linen-status');
  L.answer = 'found'; h.refresh();
  assert.equal(n.textContent, 'Tap a piece to start.'); assert.ok(!/warn/.test(n.className), 'start line is muted');
  L.rows = [{ item_id: 'i1', name: 'Bath Towel', qty: 1, outcome: null }]; h.refresh();
  assert.equal(n.textContent, 'Choose what happened to every piece to continue.'); assert.ok(!/warn/.test(n.className));
  L.rows[0].outcome = 'replaced'; h.refresh();
  assert.match(n.textContent, /^Kept on this phone\. Not sent yet/); assert.ok(!/warn/.test(n.className), 'kept-on-phone is muted');
  L.failed = 'unknown linen item'; h.refresh();
  assert.ok(/warn/.test(n.className), 'a refused send stays red');
});

test('R3 item 4: after a send fails for lack of connection the card says it will send when the connection returns, and stays locked', async () => {
  const t = sender(); t.mode = 'offline';
  const h = harness(t, ITEMS);
  t.state.linen = linenFound(); t.state.linen.rows[0].outcome = 'replaced';
  const rs = t.state.restock = restockSaved();
  const cls = pure.S120R_classify(ITEMS);
  cls.top.forEach(i => { rs.top[i.id] = 0; }); rs.top[idOf('Tea')] = 2; rs.kit = { a: 'no', n: null };
  await h.flush(false);
  assert.equal(rs.tried, true, 'answers stay locked');
  const n = t.el('s120-restock-status');
  assert.ok(!/Sending now/.test(n.textContent), 'not "Sending now" once the send has failed: ' + n.textContent);
  assert.match(n.textContent, /will send when the connection returns/i);
  assert.ok(!/warn/.test(n.className), 'waiting for a connection is not a fault');
  const ln = t.el('s120-linen-status');
  assert.ok(!/Sending now/.test(ln.textContent) && /sends when you submit/i.test(ln.textContent), 'linen waits for Submit, not for the connection: ' + ln.textContent);
  assert.equal(t.state.linen.tried, true);
  t.mode = 'online'; await h.flush(false);
  assert.equal(n.textContent, 'Saved and sent.');
});

test('R3 item 6: Save sets nothing-used from the button used; a type other than mid-stay unsaves it', async () => {
  const t = sender(); t.mode = 'online';
  const h = harness(t, ITEMS, { fns: ['S120R_typeChanged'] });
  t.state.cleaningType = 'mid_stay';
  const rs = t.state.restock = pure.S120R_newRestock();
  await h.save(true);
  assert.deepEqual([rs.none, rs.saved], [true, true]);
  const c = pure.S120R_classify(ITEMS); c.top.forEach(i => { rs.top[i.id] = 0; }); rs.kit = { a: 'no', n: null }; rs.saved = false;
  await h.save(false);
  assert.equal(rs.none, false, 'Save is not "nothing used"');
  rs.none = true; rs.saved = true; t.state.supplyLogSaved = true;
  t.state.cleaningType = 'turnover'; h.typeChanged('turnover');
  assert.deepEqual([rs.none, rs.saved, t.state.supplyLogSaved], [false, false, false], 'unsaved');
  rs.none = true; rs.saved = true; t.state.supplyLogSaved = true; t.state.cleaningType = 'mid_stay'; h.typeChanged('mid_stay');
  assert.deepEqual([rs.none, rs.saved], [true, true], 'staying on mid-stay keeps it');
});

test('R3 item 7: a locked sheet is resent as it stands, even if a row is no longer answered', async () => {
  const t = sender(); t.mode = 'online';
  const h = harness(t, ITEMS);
  const rs = t.state.restock = restockSaved(); rs.tried = true; rs.key = 'K9'; pure.S120R_classify(ITEMS).top.forEach(i => { rs.top[i.id] = 0; }); rs.kit = { a: 'no', n: null }; rs.top[idOf('Tea')] = 2;   // Save writes every answer; only Tea was above 0
  t.state.supplyLogSaved = true;
  const r = await h.flush(false);
  assert.deepEqual(r.unanswered, [], 'a locked sheet is not un-saved');
  assert.equal(rs.saved, true);
  const call = t.calls.find(c => c.url.endsWith('record_restock_v1'));
  assert.deepEqual(call.body.p_rows, [{ item_id: idOf('Tea'), used_qty: 2, usage_key: 's120-K9-' + idOf('Tea') }], 'same answers, same key');
  assert.equal(rs.sent, true);
});

test('R3 item 8: coming back online reruns Submit only when the report could be submitted; otherwise the cue shows', () => {
  const run = (valid, already = false, isSubmitting = false) => {
    const out = { flush: 0, cue: 0 };
    const state = { pendingPreSubmit: true, isSubmitting, submissionId: 's1' };
    const fn = new Function('state', 'isPhaseValid', 'PHASE_COUNT', 'runPreSubmitFlush', 'S94_renderCue', 'localStorage', 'SUBMITTED_IDS_KEY', 'setTimeout',
      holdSnippet(html) + NL + fnText('S120R_resumePreSubmit') + '\nreturn S120R_resumePreSubmit;');
    fn(state, () => valid, 6, () => { out.flush++; }, () => { out.cue++; }, { getItem: () => JSON.stringify(already ? ['s1'] : []) }, 'k', f => f())();
    return { out, state };
  };
  let r = run(true); assert.deepEqual([r.out.flush, r.state.pendingPreSubmit], [1, false]);
  r = run(false); assert.deepEqual([r.out.flush, r.out.cue, r.state.pendingPreSubmit], [0, 1, false], 'cleared, cue shown, nothing flushed');
  r = run(true, true); assert.equal(r.out.flush, 0, 'a report already sent is not resubmitted');
  r = run(true, false, true); assert.deepEqual([r.out.flush, r.state.pendingPreSubmit], [0, true], 'a submit in progress is left alone');
  assert.match(html, /addEventListener\('online'[\s\S]{0,400}S120R_resumePreSubmit\(\)/);
});

test('R3 item 10: Submit says it is sending and cannot be tapped twice until the send returns, on every path', async () => {
  const mk = flush => {
    const els = { 'submit-status': { className: '', textContent: '' }, 'btn-submit': { disabled: false } };
    const state = { cleaningType: 'turnover', supplyLogSaved: true, pendingPreSubmit: false, meterPhotos: [], precleanPhotos: [], aftercleanPhotos: [], bedroomPhotos: [], kitchenPhotos: [] };
    let release, proceeded = 0;
    const gate = new Promise((res, rej) => { release = v => (v instanceof Error ? rej(v) : res(v)); });
    const fn = new Function('state', 'el', 'showToast', 'S120R_flushAll', 'updateBottomBar', 'proceedWithSubmission', 'showFlushOverlay', 'enqueuePhotoUpload', 'uploadPhotoRecord', 'updateFlushOverlay', 'hideFlushOverlay', 'isPhaseValid', 'PHASE_COUNT', 'S120R_certainOffline',
      html.slice(html.indexOf('/* S120R14:BEGIN'), html.indexOf('/* S120R14:END */')) + NL + 'let _preSubmitRunning = false;' + NL + holdSnippet(html) + NL + fnText('runPreSubmitFlush') + '\nreturn runPreSubmitFlush;');
    const go = fn(state, id => els[id], () => {}, () => gate, () => { els['btn-submit'].disabled = false; }, () => { proceeded++; }, () => {}, () => {}, () => {}, () => {}, () => {}, () => true, 6, () => true);
    return { els, go, release, proceeded: () => proceeded };
  };
  for (const [name, result] of [['unanswered', { pending: [], unanswered: ['Tea'] }], ['pending', { pending: ['restock'], unanswered: [] }]]) {
    const m = mk(); const p = m.go();
    assert.equal(m.els['submit-status'].textContent, 'Sending linen and restock…', name + ': says what it is doing');
    assert.equal(m.els['btn-submit'].disabled, true, name + ': Submit is off while it sends');
    m.release(result); await p;
    assert.equal(m.els['btn-submit'].disabled, false, name + ': Submit is back');
    assert.ok(m.els['submit-status'].textContent && !/^Sending linen/.test(m.els['submit-status'].textContent), name + ': the refusal text replaces it');
  }
  const ok = mk(); const p2 = ok.go(); ok.release({ pending: [], unanswered: [] }); await p2;
  assert.equal(ok.proceeded(), 1);
  assert.ok(!/^Sending linen/.test(ok.els['submit-status'].textContent), 'the sending line does not linger');
  const bad = mk(); const p3 = bad.go().catch(() => {}); bad.release(new Error('x')); await p3;
  assert.equal(bad.els['btn-submit'].disabled, false, 'a failed flush does not leave Submit dead');
  assert.ok(!/^Sending linen/.test(bad.els['submit-status'].textContent));
});

test('R3 item 9: the submit modal counts the stain photo only when linen is Issue Found', () => {
  const count = (flags, linenState) => new Function('state', fnText('S120R_issueFlagCount') + '\nreturn S120R_issueFlagCount();')({ issueFlags: flags, confirmItems: { check_2_4: linenState } });
  assert.equal(count({ check_2_4: { photoData: 'x' } }, 'confirmed'), 0, 'a photo alone is not an issue');
  assert.equal(count({ check_2_4: { photoData: 'x' } }, null), 0);
  assert.equal(count({ check_2_4: { note: 'n' }, check_7_5: { note: 'm' } }, 'issue'), 2);
  assert.equal(count({ check_2_4: { photoData: 'x' }, check_7_5: { note: 'm' } }, 'confirmed'), 1);
  assert.match(html, /const issueCount = S120R_issueFlagCount\(\) \+/);
});

test('R3 item 11: the Restock sheet shows the approved wording', () => {
  const listEl = { innerHTML: '', closest: () => null, scrollTop: 0 };
  const els = { 'sus-list': listEl, 'sus-save-btn': {}, 'sus-none-btn': {}, 'sus-status': {} };
  const state = { restock: Object.assign(pure.S120R_newRestock(), { extraOpen: true }), cleaningType: 'turnover' };
  const f = new Function('state', 'el', 'esc', 'document', '_susItems',
    block + NL + ['S120R_focusKey', 'S120R_focusBack', 'S120R_renderRestock'].map(fnText).join(NL) + '\nreturn S120R_renderRestock;')(state, id => els[id], s => String(s), { activeElement: null }, ITEMS.map(i => Object.assign({ unit: 'pc' }, i)));
  f();
  assert.ok(listEl.innerHTML.includes('Anything extra'));
  assert.ok(listEl.innerHTML.includes('Other extras'));
  assert.ok(listEl.innerHTML.includes('These are the standard amounts. Change a number only if you used a different amount.'));
  assert.ok(listEl.innerHTML.includes('Optional. Refills, cans and bags, only if you opened one.'));
  assert.ok(listEl.innerHTML.includes('Other items'));
});

test('R3 item 11: the linen heading is the approved wording', () => {
  for (const s of ['Which piece is stained?', 'Tap each one. Tap again if another of the same piece ended differently.']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('Tap the stained piece. Tap it again for a second row.'), 'the old line is gone');
});

test('R3 items 1 and 2 (source guard only; layout is measured in a browser by the orchestrator)', () => {
  const rule = sel => { const m = new RegExp('\\n' + sel.replace(/[.#]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(html); assert.ok(m, sel); return m[1]; };
  assert.match(rule('.sus-step-btn'), /width:\s*44px;\s*height:\s*44px/);
  assert.match(rule('.sus-close'), /width:\s*44px;\s*height:\s*44px/);
  assert.match(rule('.sus-optional-toggle'), /min-height:\s*44px/);
  assert.match(html, /\.s120-linen \.issue-photo-btn\s*\{[^}]*min-height:\s*44px/);
  assert.match(html, /\.confirm-item > \.s120-linen[^{]*\{[^}]*padding:[^}]*var\(--space-5\)/);
});

test('R3 item 12: the server refusing a reused key (different rows) is a refusal with a plain message, not a retry', async () => {
  assert.equal(pure.S120R_failKind(400), 'refused');
  const t = sender(); t.mode = 'reused'; t.fetch0 = t.fetch;
  const real = t.fetch;
  t.fetch = async (url, opt) => { t.calls.push({ url, body: JSON.parse(opt.body) }); return { ok: false, status: 400, text: async () => JSON.stringify({ message: 'idempotency_key_reused', code: '22023' }) }; };
  const h = harness(t, ITEMS);
  t.state.linen = linenFound();
  const r = await h.flush(false);
  assert.deepEqual(r.pending, [], 'a refusal is not retried');
  const msg = t.state.linen.failed;
  assert.ok(msg && !/idempotency|_/.test(msg), 'plain words, no code: ' + msg);
  assert.match(msg, /different answers/i);
  assert.ok(pure.S120R_reportLines(t.state.linen, null)[0].text.includes(msg), 'and the report carries it');
  assert.equal(t.state.linen.tried, false);
  void real;
});

test('s120R: a send redraws the linen card, so its controls show locked without a reload', async () => {
  const t = sender();
  let repaints = 0;
  const base = t.el, status = { closest: () => ({ _s120Repaint: () => { repaints++; } }) };
  t.el = id => (id === 's120-linen-status' ? status : base(id));
  const h = harness(t, ITEMS);
  t.state.linen = linenFound();
  t.mode = 'online';
  await h.flush(false);
  assert.equal(t.state.linen.sent, true);
  assert.ok(repaints >= 1, 'the card was redrawn after the send');
});
