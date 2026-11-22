// Lane I red-on-broken-code proof (not a test file). For each mutation: copy stock/I_stock.js with ONE deliberate bug,
// run every tests/I_*.test.mjs against the copy (I_STOCK_SRC) and list the tests that went red. A mutation that leaves
// the suite green means a test does not guard what it claims. Run: node tests/I_red.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { here } from './I_harness.mjs';

const src = fs.readFileSync(path.join(here, '..', 'stock', 'I_stock.js'), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)); // a Windows checkout may hold CRLF
const M = [
  ['cleaner keeps and shows cost', [["if (canPrice(role)) { it.cost = num(raw.unitCost);", "{ it.cost = num(raw.unitCost);"], ["(canPrice(m) && it.cost != null ?", "(it.cost != null ?"]]],
  ['count arg renamed', [["p_counted_qty: parseQty", "p_count_qty: parseQty"]]],
  ['usage_key renamed', [["usage_key: key }]", "usage_id: key }]"]]],
  ['new key on every build', [["a.sig = sig; a.key = ke.key;", "a.sig = sig; a.key = newKey(a.kind);"]]],
  ['date taken from UTC not Manila', [["new Date(ms + 8 * 3600000)", "new Date(ms)"]]],
  ['submit never disabled while sending', [["(a.sending ? ' disabled' : '')", "''"]]],
  ['offline guard removed', [["if (!online()) { a.err = 'offline'; drawLayer(); return; }", ""]]],
  ['refused keeps the action', [["if (a.err === 'refused') {", "if (false) {"]]],
  ['demo calls the network', [["if (me.demo) { toast(rep ? 'Demo only, nothing was sent.' : DEMO_NOTE); finish(); return; }", ""], ["if (!M.demo && !(K.items", "if (true || !(K.items"]]],
  ['finance sees Count it', [["if (kind === 'count') return I_FLAGS.count && canCount(m) && !M.denied.count;", "if (kind === 'count') return I_FLAGS.count && m !== 'owner' && m !== 'admin' && m !== 'cleaner' || !M.denied.count;"]]],
  ['failed probe shows sample rows', [["else me.loadErr = errKind(r && r.error, online()) === 'offline' ? 'offline' : 'unavailable';", "else { K.items = demoItems().map(function (x) { return normalize(x, me.role); }); }"]]],
  ['shopping read selects a cost column', [["reason,status,proposed_by,proposed_at'", "reason,status,proposed_by,proposed_at,estimated_cost'"]]],
  ['duplicate declaration', [["  function fmt(n)", "  function esc(s) { return s; }\n  function fmt(n)"]]],
  ['close allowed while sending', [["if (!M || (M.act && M.act.sending)) return;", "if (!M) return;"], ["if (a.sending) return; // nothing", "if (false) return; // nothing"]]],
  ['no reload after failure', [["{ me.loading = false; load(); } // the write may have landed", "{ } // the write may have landed"]]],
  ['usage default off', [["var I_FLAGS = { count: true, usage: true };", "var I_FLAGS = { count: true, usage: false };"]]],
  ['cleaner count refusal shows an error box', [["if (a.err === 'refused' && a.kind === 'count' && !canManage(me.role)) {", "if (false) {"]]],
  ['cleaner walk refusal says ask the owner', [["var m = canManage(me.role) ? ERR.refused : ERR.missing;", "var m = ERR.refused;"]]],
  ['count default off', [["var I_FLAGS = { count: true, usage: true };", "var I_FLAGS = { count: false, usage: true };"]]],
  ['write does not stale the list', [["K.at = 0; // any write", "// any write"]]],
  ['key never expires', [[" || nowMs() - ke.at > 600000", ""]]],
  ['syntax error', [["function canManage(role) {", "function canManage(role) { ((("]]],
  ['cached list shown to another role', [["if (K.role !== opts.role) {", "if (false) {"]]],
  ['cleaner reads last counted', [["!canManage(me.role) || me.itemInfo[id]", "me.itemInfo[id]"]]],
  ['mark bought drops the list id', [["shopId: r.id }, fromShop: true", "shopId: null }, fromShop: true"]]],
  ['level bar against the wrong scale', [["it.qty / (it.reorder * 2)", "it.qty / it.reorder"]]],
  ['admin link for everyone', [["(canManage(m) ? '<p class=\"help I_more\">", "(true ? '<p class=\"help I_more\">"]]],
  ['sheet role dialog dropped', [['role="dialog" aria-modal="true" ', '']]],
  ['cleaner can pick Finance by a hand-made click', [["=== 'finance' && canPrice(M.role) && !K.noFinance", "=== 'finance' && !K.noFinance"]]],
  ['cleaner can link a barcode', [["return K.v84 && canManage(m) && !M.denied.link;", "return K.v84 && !M.denied.link;"]]],
  ['attach key renamed', [["p_item_id: it.id } }", "p_id: it.id } }"]]],
  ['price key renamed', [["p_unit_cost: c } }", "p_cost: c } }"]]],
  ['create key renamed', [["p_format: format || null, p_idempotency_key: key", "p_format: format || null, p_key: key"]]],
  ['report body renamed', [["body: { kind: v.rkind, to: v.to }", "body: { type: v.rkind, to: v.to }"]]],
  ['report function renamed', [["invoke: 'inventory-report', body: { kind: v.rkind", "invoke: 'inventory_report', body: { kind: v.rkind"]]],
  ['report hold ignored', [["if (rep) K.cool[a.vals.rkind + '|' + a.vals.to] = nowMs();", ""]]],
  ['hidden actions return on re-mount', [["denied: K.denied,", "denied: {},"]]],
  ['camera left on at close', [["stopCam(); K.scanned = null;", "K.scanned = null;"], ["if (!a) { stopCam(); box.innerHTML", "if (!a) { box.innerHTML"]]],
  ['camera left on at unmount', [["stopCam(); if (root.document && root.document.removeEventListener", "if (root.document && root.document.removeEventListener"]]],
  ['camera left on at match', [["stopCam(); // the camera is off before anything else", ""], ["if (!a) { stopCam(); box.innerHTML", "if (!a) { box.innerHTML"]]],
  ['camera ignores the page going away', [["if (M && root.document && root.document.hidden && M.cam) pauseCam();", ""]]],
  ['camera polls every frame', [["tickCam(cam); }, 250);", "tickCam(cam); }, 16);"]]],
  ['front camera', [["facingMode: 'environment'", "facingMode: 'user'"]]],
  ['refusal reads as a crash', [["a.camState = e && /NotAllowed|Security|Permission/i.test(String(e.name || e.message)) ? 'denied' : 'failed';", "a.camState = 'failed';"]]],
  ['last typed code forgotten', [["K.lastCode = code; // a typo", "K.lastCode = ''; // a typo"]]],
  ['taken code not explained', [["if (why === 'code_taken')", "if (false)"]]],
  ['Low first groups unsorted', [["gs.sort(function (a, b) { return worst(a) - worst(b) || (b.out + b.low) - (a.out + a.low) || a.cat.localeCompare(b.cat); });", "gs.sort(function (a, b) { return a.cat.localeCompare(b.cat); });"]]],
  ['group header drops the low count', [[`(g.low ? '' + gi('alert', 's16') + ' ' + g.low + ' low' : '')`, "''"]]],
  ['category chip draws a header', [["K.chip.indexOf('c:') !== 0); })", "true); })"]]],
  ['Scan button on an old catalogue', [[`(K.v84 ? '<button class="chip I_scanbtn"`, `(true ? '<button class="chip I_scanbtn"`]]],
  ['header counts the Out items twice', [["(g.low ? '' + gi('alert', 's16') + ' ' + g.low + ' low' : '')", "(g.low ? '' + gi('alert', 's16') + ' ' + (g.low + g.out) + ' low' : '')"]]],
  ['Consumables rows sorted by level', [["if (chip === 'cons') gs.forEach(function (g) { g.rows.sort(byName); });", ""]]],
  ['camera asked after the sheet closed', [["if (!cam.on || me.dead) return null; // closed while", "// closed while"]]],
  ['no supported formats reads as a failure', [["if (!f.length) { me.cam = null; cam.on = false; a.camState = 'none'; typingRedraw(); return null; }", ""]]],
  ['typing focus lost when the camera goes live', [["if (typing) refocus('I_f_code');", ""]]],
  ['cleaner can unlink', [["if (kind === 'unlink') return K.v84 && canManage(m) && !M.denied.unlink;", "if (kind === 'unlink') return K.v84 && !M.denied.unlink;"]]],
  ['unlink key renamed', [["p_code: a.code } }", "p_barcode: a.code } }"]]],
  ['undo bar never expires', [["(nowMs() - u.at < UNDO_BAR_MS || (M.undoHold === u.id))", "true"]]],
  ['undo count wrong RPC', [["{ fn: 'inventory_undo_v1', args: { p_movement_id: d.movementId, p_purchase_id: null } }", "{ fn: 'inventory_undo', args: { p_movement_id: d.movementId, p_purchase_id: null } }"]]],
  ['undo asks no question', [["if (a.kind === 'undo') return head(a.entry.confirm)", "if (a.kind === 'undo' && false) return head(a.entry.confirm)"]]],
  ['running low shown when already listed', [["&& !(it && (K.shop || []).some(function (r) { return r.itemId === it.id; }));", ";"]]],
  ['running low quantity always one', [["return Math.max(1, Math.ceil(Math.max(target - it.qty, 0) / (it.perPack || 1)));", "return 1;"]]],
  ['bought re-sends finished lines', [["if (d.received) return null; a.cur = r.id;", "a.cur = r.id;"]]],
  ['bought key regenerated on retry', [["a.keys[r.id], manilaToday(nowMs()))", "newKey('recv'), manilaToday(nowMs()))"]]],
  ['bought for finance', [["if (kind === 'bought') return canManage(m) && !M.denied.bought", "if (kind === 'bought') return canPrice(m) && !M.denied.bought"]]],
  ['walk writes on Same as before', [["a.same[a.ids[a.i]] = 1; walkNext(a);", "a.same[a.ids[a.i]] = 1; a.vals.qty = a.vals.qty; walkSubmit(a);"]]],
  ['needs a count ignores the clock', [["nowMs() - Date.parse(it.counted) > 30 * 86400000", "false"]]],
  ['walk for a cleaner', [["if (kind === 'count') return I_FLAGS.count && canCount(m) && !M.denied.count;", "if (kind === 'count') return I_FLAGS.count && !M.denied.count;"]]],
  ['history shows price to a cleaner', [["canPrice(M.role) && lb.unit_cost != null", "lb.unit_cost != null"]]],
  ['history wrong RPC key', [["rpc('inventory_item_history_v1', { p_item_id: id })", "rpc('inventory_item_history_v1', { p_id: id })"]]],
  ['suggestion without the 1.5', [["* 1.5 * 100) / 100", "* 1 * 100) / 100"]]],
  ['suggestion with too few cleans', [["!(u.cleans_30d >= 5) || !(num(u.per_clean) > 0)", "!(num(u.per_clean) > 0)"]]],
  ['recent list never capped', [["ids: [String(id)].concat(recentRead().filter(function (x) { return x !== String(id); })).slice(0, 5) }", "ids: [String(id)].concat(recentRead().filter(function (x) { return x !== String(id); })) }"], ["o.ids.map(String).slice(0, 5) : []", "o.ids.map(String) : []"]]],
  ['recent kept across roles', [["o.role === K.role &&", "true &&"]]],
  ['recent not cleared on role change', [["if (prevRole !== null) recentClear(); }", "}"]]],
  ['new item undo leaves its code stuck', [["if (a.code) { e.confirm = 'Remove ' + cnm + ' and free code '", "if (false) { e.confirm = 'Remove ' + cnm + ' and free code '"]]],
  ['undo all re-asks finished lines', [["filter(function (e) { return e && !e.undone; })", "filter(Boolean)"]]],
  ['walk key per item only', [["var kk = it.id + '|' + n;", "var kk = it.id;"]]],
  ['first count undo wording', [["(snap && snap.controlled === false && !snap.learns ? ' It stays counted in the app.' : '')", "''"]]],
  ['bought recon says try again', [["a.err === 'recon' || a.err === 'short' ? ERR[a.err] : 'Try again.'", "'Try again.'"]]],
  ['history server words', [["counted: 'Counted', received:", "counted: 'Count', received:"]]],
  ['last bought without unit', [["esc(uq(lb.qty, unitOf(it)))", "esc(fmt(lb.qty))"]]],
  ['bought list not re-read', [["drawLayer(); loadShop(); return; } // the list is re-read first", "drawLayer(); return; } // the list is re-read first"]]],
  ['already received unmapped', [["body.reason === 'already_received'", "body.reason === 'never'"]]],
  ['count group only under headers', [["(allowed('count') ? '<div class=\"I_foot\"><button class=\"btn btn-ghost I_gcount\"", "(header && allowed('count') ? '<div class=\"I_foot\"><button class=\"btn btn-ghost I_gcount\""]]],
  ['stepper allows zero use', [["return fmt(Math.max(allowZero ? 0 : 1, n));", "return fmt(Math.max(0, n));"]]],
  ['bought done screen loses its rows', [["if (a.step !== 'pick' && a.rows) return a.rows; return", "return"]]],
  ['toast over the undo bar', [["if (a.kind === 'undo' || K.undos[0] === u0 || (K.undos[0] && K.undos[0].call && K.denied[K.undos[0].call.fn])) toast(msg);", "toast(msg);"]]],
  ['undo all depends on the 20 entry list', [["return e && !e.undone; })", "return e && K.undos.indexOf(e) >= 0; })"]]],
  ['unit plural dropped', [["if (Math.abs(n) === 1) return /s$/i.test(w) && !/ss$/i.test(w) ? w.slice(0, -1) : w;", "if (Math.abs(n) === 1) return w;"]]],
  ['icons back to text glyphs', [["function gi(name, size) { return root.ICON ? root.ICON(name, size) : ''; }", "function gi(name, size) { return '&#9650;'; }"]]],
  ['count group back to a secondary button under the card', [["<div class=\"I_foot\"><button class=\"btn btn-ghost I_gcount\"", "<div class=\"I_foot\"><button class=\"btn btn-secondary I_gcount\""]]],
  ['chips wrap again', [['<div class="I_chips" role="group"', '<div class="row-wrap I_chips" role="group"']]],
  ['not_open reads as try again', [[" || body.reason === 'not_open')", ")"]]],
  // s86 D-client-stock
  ['cleaner sees last price', [["if (money && it.lastPrice != null)", "if (it.lastPrice != null)"], ["if (canPrice(role)) { it.cost = num(raw.unitCost); it.lastPrice = num(raw.lastPrice);", "{ it.cost = num(raw.unitCost); it.lastPrice = num(raw.lastPrice);"]]],
  ['cleaner reads lastPrice and priceUp', [["if (canPrice(role)) { it.cost = num(raw.unitCost); it.lastPrice = num(raw.lastPrice); it.priceUp = num(raw.priceUp); }", "{ it.cost = num(raw.unitCost); it.lastPrice = num(raw.lastPrice); it.priceUp = num(raw.priceUp); }"]]],
  ['photo sent before the person confirms', [["createObjectURL(b) : null; a.focused = false; drawLayer();", "createObjectURL(b) : null; a.focused = false; drawLayer(); commit(a);"]]],
  ['upload failure still sets the photo', [["if (u && u.error) throw u.error;\n      if (!u || !u.data || u.data.ok === false || !u.data.path) throw { message: 'failed', data: u && u.data || {} };", "if (!u || !u.data || !u.data.path) u = { data: { path: 'items/x/y.webp' } };"]]],
  ['photo undo ignores before', [["var pb = 'before' in d ?", "var pb = false ?"]]],
  ['photo path not remembered', [["a.newPath = u.data.path;", ""]]],
  ['signed links not kept', [["        puSave();\n", ""], ["{ K.pu[u.data.path] = { url: u.data.signedUrl, at: nowMs() }; puSave(); }", "{ K.pu[u.data.path] = { url: u.data.signedUrl, at: nowMs() }; }"]]],
  ['mint undo dropped', [["if (mu) pushUndoEntry(mu);", ""]]],
  ['labels send hidden items', [["return a.sel && a.sel[i.id] && vis[i.id]; })", "return a.sel && a.sel[i.id]; })"]]],
  ['supplier id not passed', [["if (v.supplierId) args.p_supplier_id", "if (false) args.p_supplier_id"]]],
  ['pick without preferredId', [["preferredId: pit && pit.supplier && pit.supplier.id || null, ", ""]]],
  ['ctx undo ignores the item', [["itemId: o && o.itemId ? String(o.itemId) : null,", "itemId: null,"]]],
  ['ctx undo leaves the open card stale', [["if (M && M.act && M.act.kind === 'menu' && e.itemId && M.act.itemId === e.itemId) drawLayer(); else drawUndo();", "drawUndo();"]]],
  ['Cassy hold removed', [["nowMs() - K.catAt < 30000", "nowMs() - K.catAt < 0"]]],
  ['failed sort holds the next', [["if (a.kind === 'sort') K.catAt = 0; //", "//"]]],
  ['remaining waiting hidden', [["var more = remaining > 0 ? '. ' + remaining + ' more are waiting' : '';", "var more = '';"]]],
  ['rename skips inactive items', [[".concat(Object.keys(K.inactiveCat || {}).filter(function (id) { return K.inactiveCat[id] === a.from; }))", ""]]],
  ['location patch always sent', [["if ('location' in v && String(v.location || '').trim() !== String(it.location || ''))", "if ('location' in v)"]]],
  ['search ignores location', [["&& String(i.location || '').toLowerCase().indexOf(s) < 0) return false;", ") return false;"]]],
  // s132 L2: the Update sheet calls, the history rows and the refusals (each pattern is one line of stock/I_stock.js)
  ['damage reason always broken', [["reason: v.what === 'missing' ? 'missing' : 'broken' }", "reason: 'broken' }"]]],
  ['damage booking dropped', [["p_booking_id: stay ? booking || null : null,", "p_booking_id: null,"]]],
  ['damage stay words dropped', [["nt = (nt ? nt + ' ' : '') + 'During a guest stay.'", "nt = nt"]]],
  ['damage source renamed', [["p_source: 'update', p_note: nt", "p_source: 'staff', p_note: nt"]]],
  ['damage rows key renamed', [["p_rows: [row], p_photo_path", "p_row: [row], p_photo_path"]]],
  ['linen outcome ignored', [["outcome: v.now === 'needs_replacing' || v.now === 'replaced' ? v.now : 'cleaned'", "outcome: 'cleaned'"]]],
  ['linen date dropped', [["p_session_date: today, p_logged_by: 'staff'", "p_session_date: null, p_logged_by: 'staff'"]]],
  ['linen property key renamed', [["{ p_property: pid, p_session_date", "{ p_property_id: pid, p_session_date"]]],
  ['bought staff sends packs as units', [["qty_units: Math.round(packs * (it.perPack || 1) * 100) / 100", "qty_units: packs"]]],
  ['bought receipt path dropped', [["c.args.p_receipt_path = path || null;", ""]]],
  ['bought staff sent the owner call', [["if (!canManage(M.role)) return { fn: 'inventory_receipt_manual_v1'", "if (false) return { fn: 'inventory_receipt_manual_v1'"]]],
  ['history usage sign', [["var minus = c.kind === 'received' ? '+' : '-';", "var minus = '+';"]]],
  ['history cleaned shows an arrow', [["if (c.kind === 'cleaned') {", "if (false) {"]]],
  ['history live shape ignored', [["else if (qn != null && isFinite(qn) && (c.source === 'usage'", "else if (false && (c.source === 'usage'"]]],
  ['refused Update save goes silent', [["if (a.err === 'refused' && a.upd && UKINDS[a.kind]) { toast(ERR.refused); return drawLayer(); }", ""]]],
  ['server word rows_invalid unmapped', [["rows_invalid: 'rowsBad', ", ""]]],
  ['server word item_not_found unmapped', [["item_not_found: 'itemGone', ", "item_not_found: 'other', "]]],
  ['server word forbidden unmapped', [["forbidden: 'refused', ", ""]]],
  ['server word bad_line unmapped', [["bad_line: 'rowsBad' }", "}"]]],
  ['isLinen exact match', [["/^linen/i.test(String(it.category || '').trim())", "it.category === 'Linen'"]]],
  ['shop Mark bought button for staff', [["r.itemId && canManage(M.role) && allowed('recv', itemById(r.itemId)) ? '<button", "r.itemId && allowed('recv', itemById(r.itemId)) ? '<button"]]],
  ['shop Mark bought click for staff', [["!r.itemId || !canManage(M.role) || !allowed('recv'", "!r.itemId || !allowed('recv'"]]],
  ['image error redraws while typing', [["&& !sheetTyping()) drawLayer(); return; }", ") drawLayer(); return; }"]]],
  ['cost per pack hidden', [["if (!a || a.kind !== 'recv' || !canManage(M.role)) return '';", "return '';"]]],
  ['cost per pack shown to staff', [["a.kind !== 'recv' || !canManage(M.role)) return '';", "a.kind !== 'recv') return '';"]]]
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'I_red-'));
let bad = 0;
const only = process.argv[2]; // optional: run only the mutations whose name contains this text
let ran = 0; // mutations this run actually tried; zero means a bad filter, not a clean pass
const shard = (process.env.I_RED_SHARD || '').split('/').map(Number); // optional i/n: run every n-th mutation, so n runners can share the work
for (const [mi, [name, edits]] of M.entries()) {
  if (only && !name.includes(only)) continue;
  if (shard.length === 2 && mi % shard[1] !== shard[0] % shard[1]) continue;
  ran++;
  let s = src;
  for (const [a, b] of edits) { if (!s.includes(a)) { console.log('SKIP (pattern not found): ' + name + ' :: ' + a.slice(0, 50)); bad++; s = null; break; } s = s.replace(a, b); }
  if (s == null) continue;
  const f = path.join(dir, 'I_stock.mut.js'); fs.writeFileSync(f, s);
  const r = spawnSync(process.execPath, ['--test', path.join(here, 'I_rpc.test.mjs'), path.join(here, 'I_roles.test.mjs'), path.join(here, 'I_flow.test.mjs'), path.join(here, 'I_guard.test.mjs'), path.join(here, 'I_photo.test.mjs'), path.join(here, 'I_labels.test.mjs'), path.join(here, 'I_details.test.mjs'), path.join(here, 'I_bought-supplier.test.mjs'), path.join(here, 'I_categorise.test.mjs'), path.join(here, 'I_fix.test.mjs'), path.join(here, 'I_group.test.mjs'), path.join(here, 'I_scan.test.mjs'), path.join(here, 'I_card.test.mjs'), path.join(here, 'I_report.test.mjs'), path.join(here, 'I_undo.test.mjs'), path.join(here, 'I_running-low.test.mjs'), path.join(here, 'I_bought.test.mjs'), path.join(here, 'I_count-walk.test.mjs'), path.join(here, 'I_history.test.mjs'), path.join(here, 'I_recent.test.mjs'), path.join(here, 'I_round2.test.mjs'), path.join(here, 'I_staff.test.mjs'), path.join(here, 'I_b2.test.mjs'), path.join(here, 's132-update.test.mjs')], { env: Object.assign({}, process.env, { I_STOCK_SRC: f }), encoding: 'utf8', timeout: 60000 });
  const red = [...(r.stdout || '').matchAll(/^\s*✖ ((?:I_[-\w]+|s132) .+?) \(\d+(?:\.?\d+)?ms\)/gm)].map((m) => m[1].trim()).filter((v, i, a) => a.indexOf(v) === i);
  const hung = !!(r.error && r.error.code === 'ETIMEDOUT');
  const ok = hung || (r.status !== 0 && red.length > 0);
  if (!ok) bad++;
  console.log((ok ? 'RED  ' : 'GREEN(!) ') + name + ' -> ' + (hung ? 'suite hangs (caught)' : red.length ? red.length + ' failing: ' + red.slice(0, 3).join(' | ') : 'no failing test'));
}

// s132 L3: the Kitchen utensils card in checklist/index.html. Same idea: ONE bug per copy, the card's test file must go red (S132U_SRC points it at the copy).
const csrc = fs.readFileSync(path.join(here, '..', 'checklist', 'index.html'), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const C = [
  ['utensils key regenerated on retry', [["if (!U.key) U.key = 's132-utensils-' + uuid();", "U.key = 's132-utensils-' + uuid();"]]],
  ['utensils source renamed', [["p_source: 'turnover', p_note: S132U_note(U)", "p_source: 'update', p_note: S132U_note(U)"]]],
  ['utensils not added to the list', [["p_add_to_list: true, p_source: 'turnover'", "p_add_to_list: false, p_source: 'turnover'"]]],
  ['utensils lasting-only filter dropped', [["r.is_active !== false && r.is_consumable === false &&", "r.is_active !== false &&"]]],
  ['utensils unknown flag counts as lasting', [["r.is_consumable === false && S132U_GROUP_RE", "r.is_consumable !== true && S132U_GROUP_RE"]]],
  ['utensils inactive items shown', [["r.is_active !== false && r.is_consumable === false", "r.is_consumable === false"]]],
  ['utensils group test loosened', [["const S132U_GROUP_RE = /^kitchen utensils$/i;", "const S132U_GROUP_RE = /kitchen|linen/i;"]]],
  ['utensils duplicate not counted as sent', [["else if (r.ok) { U.sent = true;", "else if (r.ok && !(r.data && r.data.duplicate)) { U.sent = true;"]]],
  ['utensils never locks while trying', [["if (!S120R_certainOffline()) U.tried = true;", ""]]],
  ['utensils All there sends a call', [["U.saved && !U.sent && !U.failed && U.answer === 'issues'", "U.saved && !U.sent && !U.failed"], ["if (!rows.length || rows.length > S132U_MAX_ROWS) return { ok: true, noop: true };", "if (rows.length > S132U_MAX_ROWS) return { ok: true, noop: true };"]]],
  ['utensils Submit does not send typed counts', [["if (atSubmit && S132U_active() && U.answer === 'issues' && !U.saved", "if (false && U.answer === 'issues' && !U.saved"]]],
  ['utensils Submit flush removed', [["await S132U_flush(true); }   // s132 L3", "}   // s132 L3"]]],
  ['utensils old tick no longer kept', [["if (d.checklist && d.checklist.check_7_6) out.answer = 'all';", ""]]],
  ['utensils step on every cleaning type', [["utensils: true, only: ['turnover', 'deep_clean'],", "utensils: true,"]]],
  ['utensils photo not lazy', [['width="40" height="40" loading="lazy"', 'width="40" height="40"']]],
  ['utensils rows not capped', [["const S132U_MAX_ROWS = 30;", "const S132U_MAX_ROWS = 3000;"]]],
  ['utensils carry-over ignores the card', [["S120R_liveSend(draft.linen) || S120R_liveSend(draft.utensils);", "S120R_liveSend(draft.linen);"]]]
];
const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'I_red_c-'));
for (const [name, edits] of C) {
  if (only && !name.includes(only)) continue;
  ran++;
  let s = csrc;
  for (const [a, b] of edits) { if (!s.includes(a)) { console.log('SKIP (pattern not found): ' + name + ' :: ' + a.slice(0, 50)); bad++; s = null; break; } s = s.replace(a, () => b); }
  if (s == null) continue;
  const f = path.join(cdir, 'index.mut.html'); fs.writeFileSync(f, s);
  const r = spawnSync(process.execPath, ['--test', path.join(here, 's132-utensils-check.test.mjs')], { env: Object.assign({}, process.env, { S132U_SRC: f }), encoding: 'utf8', timeout: 60000 });
  const red = [...(r.stdout || '').matchAll(/^s*✖ (s132 L3 .+?) (d+(?:.?d+)?ms)/gm)].map((m) => m[1].trim()).filter((v, i, a) => a.indexOf(v) === i);
  const ok = r.status !== 0 && (red.length > 0 || /✖|not ok/.test(r.stdout || ''));
  if (!ok) bad++;
  console.log((ok ? 'RED  ' : 'GREEN(!) ') + name + ' -> ' + (red.length ? red.length + ' failing: ' + red.slice(0, 2).join(' | ') : ok ? 'suite fails' : 'no failing test'));
}
if (!ran) { console.log('no mutation ran (check the name filter or I_RED_SHARD)'); process.exit(1); }
console.log(bad ? bad + ' mutation(s) not caught' : 'every mutation was caught');
process.exit(bad ? 1 : 0);
