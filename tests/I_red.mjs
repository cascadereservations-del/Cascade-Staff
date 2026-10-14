// Lane I red-on-broken-code proof (not a test file). For each mutation: copy stock/I_stock.js with ONE deliberate bug,
// run every tests/I_*.test.mjs against the copy (I_STOCK_SRC) and list the tests that went red. A mutation that leaves
// the suite green means a test does not guard what it claims. Run: node tests/I_red.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { here } from './I_harness.mjs';

const src = fs.readFileSync(path.join(here, '..', 'stock', 'I_stock.js'), 'utf8');
const M = [
  ['cleaner keeps and shows cost', [["if (canPrice(role)) it.cost = num(raw.unitCost);", "it.cost = num(raw.unitCost);"], ["(canPrice(m) && it.cost != null ?", "(it.cost != null ?"]]],
  ['count sent without a confirm step', [["if (a.step !== 'confirm') { if (!valid(a))", "if (false) { if (!valid(a))"]]],
  ['count arg renamed', [["p_counted_qty: parseQty", "p_count_qty: parseQty"]]],
  ['usage_key renamed', [["usage_key: key }]", "usage_id: key }]"]]],
  ['new key on every build', [["a.sig = sig; a.key = ke.key;", "a.sig = sig; a.key = newKey(a.kind);"]]],
  ['date taken from UTC not Manila', [["new Date(ms + 8 * 3600000)", "new Date(ms)"]]],
  ['submit never disabled while sending', [["(a.sending ? ' disabled' : '')", "''"]]],
  ['offline guard removed', [["if (!online()) { a.err = 'offline'; drawLayer(); return; }", ""]]],
  ['refused keeps the action', [["if (a.err === 'refused') {", "if (false) {"]]],
  ['demo calls the network', [["if (me.demo) { toast(rep ? 'Demo only, nothing was sent.' : DEMO_NOTE); finish(); return; }", ""], ["if (!M.demo && !(K.items", "if (true || !(K.items"]]],
  ['cleaner sees Count it', [["if (kind === 'count') return I_FLAGS.count && canManage(m) && !M.denied.count;", "if (kind === 'count') return !M.denied.count;"]]],
  ['failed probe shows sample rows', [["else me.loadErr = errKind(r && r.error, online()) === 'offline' ? 'offline' : 'unavailable';", "else { K.items = demoItems().map(function (x) { return normalize(x, me.role); }); }"]]],
  ['shopping read selects a cost column', [["reason,status,proposed_by,proposed_at'", "reason,status,proposed_by,proposed_at,estimated_cost'"]]],
  ['duplicate declaration', [["  function fmt(n)", "  function esc(s) { return s; }\n  function fmt(n)"]]],
  ['close allowed while sending', [["if (!M || (M.act && M.act.sending)) return;", "if (!M) return;"], ["if (a.sending) return; // nothing", "if (false) return; // nothing"]]],
  ['short note sent as typed', [["return t.length >= 3 ? t : 'Counted in the staff app';", "return t || 'Counted in the staff app';"]]],
  ['controlled item refused again', [["if (kind === 'recv') return canManage(m) && !M.denied.recv;", "if (kind === 'recv') return canManage(m) && !M.denied.recv && !(it && it.controlled);"]]],
  ['no reload after failure', [["{ me.loading = false; load(); } // the write may have landed", "{ } // the write may have landed"]]],
  ['count default off', [["var I_FLAGS = { count: true, usage: false };", "var I_FLAGS = { count: false, usage: false };"]]],
  ['one-way warning dropped', [["After this, ' + esc(it.name)", "Done, ' + esc(it.name)"]]],
  ['write does not stale the list', [["K.at = 0; // any write", "// any write"]]],
  ['key never expires', [[" || nowMs() - ke.at > 600000", ""]]],
  ['syntax error', [["function canManage(role) {", "function canManage(role) { ((("]]],
  ['listeners left on unmount', [["M.el.removeEventListener && M.el.removeEventListener(l[0], l[1]);", ""]]],
  ['cached list shown to another role', [["if (K.role !== opts.role) {", "if (false) {"]]],
  ['cleaner reads last counted', [["!canManage(me.role) || me.itemInfo[id]", "me.itemInfo[id]"]]],
  ['mark bought drops the list id', [["shopId: r.id }, fromShop: true", "shopId: null }, fromShop: true"]]],
  ['level bar against the wrong scale', [["it.qty / (it.reorder * 2)", "it.qty / it.reorder"]]],
  ['admin link for everyone', [["(canManage(m) ? '<p class=\"help I_more\">", "(true ? '<p class=\"help I_more\">"]]],
  ['sheet role dialog dropped', [['role="dialog" aria-modal="true" ', '']]],
  ['cleaner can pick Finance by a hand-made click', [["=== 'finance' && canPrice(M.role) && !K.noFinance", "=== 'finance' && !K.noFinance"]]],
  ['cleaner sees Change price', [["return K.v84 && canPrice(m) && !M.denied.price;", "return K.v84 && !M.denied.price;"]]],
  ['finance can edit levels', [["return K.v84 && canManage(m) && !M.denied.levels;", "return K.v84 && !M.denied.levels;"]]],
  ['cleaner can link a barcode', [["return K.v84 && canManage(m) && !M.denied.link;", "return K.v84 && !M.denied.link;"]]],
  ['attach key renamed', [["p_item_id: it.id } }", "p_id: it.id } }"]]],
  ['price key renamed', [["p_unit_cost: c } }", "p_cost: c } }"]]],
  ['create key renamed', [["p_format: format || null, p_idempotency_key: key", "p_format: format || null, p_key: key"]]],
  ['report body renamed', [["body: { kind: v.rkind, to: v.to }", "body: { type: v.rkind, to: v.to }"]]],
  ['report function renamed', [["invoke: 'inventory-report'", "invoke: 'inventory_report'"]]],
  ['report hold ignored', [["if (rep) K.cool[a.vals.rkind + '|' + a.vals.to] = nowMs();", ""]]],
  ['missing function not hidden', [["var NEWK = { link: 1, price: 1, levels: 1, create: 1, report: 1 };", "var NEWK = {};"]]],
  ['hidden actions return on re-mount', [["denied: K.denied,", "denied: {},"]]],
  ['camera left on at close', [["stopCam(); K.scanned = null;", "K.scanned = null;"], ["if (!a) { stopCam(); box.innerHTML", "if (!a) { box.innerHTML"]]],
  ['camera left on at unmount', [["stopCam(); if (root.document && root.document.removeEventListener", "if (root.document && root.document.removeEventListener"]]],
  ['camera left on at match', [["stopCam(); // the camera is off before anything else", ""], ["if (!a) { stopCam(); box.innerHTML", "if (!a) { box.innerHTML"]]],
  ['camera ignores the page going away', [["if (M && root.document && root.document.hidden && M.cam) pauseCam();", ""]]],
  ['camera polls every frame', [["tickCam(cam); }, 250);", "tickCam(cam); }, 16);"]]],
  ['front camera', [["facingMode: 'environment'", "facingMode: 'user'"]]],
  ['refusal reads as a crash', [["a.camState = e && /NotAllowed|Security|Permission/i.test(String(e.name || e.message)) ? 'denied' : 'failed';", "a.camState = 'failed';"]]],
  ['scanned card keeps the old order', [["if (a && a.scanned) {", "if (false) {"]]],
  ['last typed code forgotten', [["K.lastCode = code; // a typo", "K.lastCode = ''; // a typo"]]],
  ['taken code not explained', [["if (why === 'code_taken')", "if (false)"]]],
  ['Low first groups unsorted', [["gs.sort(function (a, b) { return worst(a) - worst(b) || (b.out + b.low) - (a.out + a.low) || a.cat.localeCompare(b.cat); });", "gs.sort(function (a, b) { return a.cat.localeCompare(b.cat); });"]]],
  ['group header drops the low count', [["var hot = g.low + g.out,", "var hot = 0,"]]],
  ['category chip draws a header', [["K.chip.indexOf('c:') !== 0); })", "true); })"]]],
  ['Scan button on an old catalogue', [[`(K.v84 ? '<button class="btn btn-secondary I_scanbtn"`, `(true ? '<button class="btn btn-secondary I_scanbtn"`]]],
  ['header counts the Out items twice', [["(g.low ? '<span aria-hidden=\"true\">▲</span> ' + g.low + ' low' : '')", "(g.low ? '<span aria-hidden=\"true\">▲</span> ' + (g.low + g.out) + ' low' : '')"]]],
  ['Consumables rows sorted by level', [["if (chip === 'cons') gs.forEach(function (g) { g.rows.sort(byName); });", ""]]],
  ['camera asked after the sheet closed', [["if (!cam.on || me.dead) return null; // closed while", "// closed while"]]],
  ['no supported formats reads as a failure', [["if (!f.length) { me.cam = null; cam.on = false; a.camState = 'none'; typingRedraw(); return null; }", ""]]],
  ['typing focus lost when the camera goes live', [["if (typing) refocus('I_f_code');", ""]]],
  ['cleaner can unlink', [["if (kind === 'unlink') return K.v84 && canManage(m) && !M.denied.unlink;", "if (kind === 'unlink') return K.v84 && !M.denied.unlink;"]]],
  ['unlink key renamed', [["args: { p_property_id: M.pid, p_code: a.code } };\n", "args: { p_property_id: M.pid, p_barcode: a.code } };\n"]]],
  ['undo bar never expires', [["(nowMs() - u.at < UNDO_BAR_MS || (M.undoHold === u.id))", "true"]]],
  ['undo line never expires', [["nowMs() - u.at < UNDO_LINE_MS &&", ""]]],
  ['undo count wrong RPC', [["{ fn: 'inventory_undo_v1', args: { p_movement_id: d.movementId, p_purchase_id: null } }", "{ fn: 'inventory_undo', args: { p_movement_id: d.movementId, p_purchase_id: null } }"]]],
  ['undo asks no question', [["if (a.kind === 'undo') return head(a.entry.confirm)", "if (a.kind === 'undo' && false) return head(a.entry.confirm)"]]],
  ['running low shown when already listed', [["&& !(it && (K.shop || []).some(function (r) { return r.itemId === it.id; }));", ";"]]],
  ['running low quantity always one', [["return Math.max(1, Math.ceil(Math.max(target - it.qty, 0) / (it.perPack || 1)));", "return 1;"]]],
  ['bought re-sends finished lines', [["if (d.received) return null; a.cur = r.id;", "a.cur = r.id;"]]],
  ['bought key regenerated on retry', [["a.keys[r.id] = a.keys[r.id] || newKey('recv');", "a.keys[r.id] = newKey('recv');"]]],
  ['bought for finance', [["if (kind === 'bought') return canManage(m) && !M.denied.bought", "if (kind === 'bought') return canPrice(m) && !M.denied.bought"]]],
  ['walk writes on Same as before', [["a.same[a.ids[a.i]] = 1; walkNext(a);", "a.same[a.ids[a.i]] = 1; a.vals.qty = a.vals.qty; walkSubmit(a);"]]],
  ['walk key per call', [["a.keys[it.id] = a.keys[it.id] || newKey('count');", "a.keys[it.id] = newKey('count');"]]],
  ['needs a count ignores the clock', [["nowMs() - Date.parse(it.counted) > 30 * 86400000", "false"]]],
  ['walk for a cleaner', [["if (kind === 'count') return I_FLAGS.count && canManage(m) && !M.denied.count;", "if (kind === 'count') return I_FLAGS.count && !M.denied.count;"]]],
  ['history shows price to a cleaner', [["canPrice(M.role) && lb.unit_cost != null", "lb.unit_cost != null"]]],
  ['history wrong RPC key', [["{ p_item_id: id }); }).then(function (r) {", "{ p_id: id }); }).then(function (r) {"]]],
  ['suggestion without the 1.5', [["* 1.5 * 100) / 100", "* 1 * 100) / 100"]]],
  ['suggestion with too few cleans', [["!(u.cleans_30d >= 5) || !(num(u.per_clean) > 0)", "!(num(u.per_clean) > 0)"]]],
  ['recent list never capped', [["ids: [String(id)].concat(recentRead().filter(function (x) { return x !== String(id); })).slice(0, 5) }", "ids: [String(id)].concat(recentRead().filter(function (x) { return x !== String(id); })) }"]]],
  ['recent kept across roles', [["o.role === K.role &&", "true &&"]]],
  ['recent not cleared on role change', [["if (prevRole !== null) recentClear(); }", "}"]]],
  ['stepper allows zero use', [["return fmt(Math.max(allowZero ? 0 : 1, n));", "return fmt(Math.max(0, n));"]]]
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'I_red-'));
let bad = 0;
for (const [name, edits] of M) {
  let s = src;
  for (const [a, b] of edits) { if (!s.includes(a)) { console.log('SKIP (pattern not found): ' + name + ' :: ' + a.slice(0, 50)); bad++; s = null; break; } s = s.replace(a, b); }
  if (s == null) continue;
  const f = path.join(dir, 'I_stock.mut.js'); fs.writeFileSync(f, s);
  const r = spawnSync(process.execPath, ['--test', path.join(here, 'I_rpc.test.mjs'), path.join(here, 'I_roles.test.mjs'), path.join(here, 'I_flow.test.mjs'), path.join(here, 'I_guard.test.mjs'), path.join(here, 'I_fix.test.mjs'), path.join(here, 'I_group.test.mjs'), path.join(here, 'I_scan.test.mjs'), path.join(here, 'I_card.test.mjs'), path.join(here, 'I_report.test.mjs'), path.join(here, 'I_undo.test.mjs'), path.join(here, 'I_running-low.test.mjs'), path.join(here, 'I_bought.test.mjs'), path.join(here, 'I_count-walk.test.mjs'), path.join(here, 'I_history.test.mjs'), path.join(here, 'I_recent.test.mjs')], { env: Object.assign({}, process.env, { I_STOCK_SRC: f }), encoding: 'utf8', timeout: 60000 });
  const red = [...(r.stdout || '').matchAll(/^\s*✖ (I_\w+ [^\n(]+?) \(/gm)].map((m) => m[1].trim()).filter((v, i, a) => a.indexOf(v) === i);
  const hung = !!(r.error && r.error.code === 'ETIMEDOUT');
  const ok = hung || (r.status !== 0 && red.length > 0);
  if (!ok) bad++;
  console.log((ok ? 'RED  ' : 'GREEN(!) ') + name + ' -> ' + (hung ? 'suite hangs (caught)' : red.length ? red.length + ' failing: ' + red.slice(0, 3).join(' | ') : 'no failing test'));
}
console.log(bad ? bad + ' mutation(s) not caught' : 'every mutation was caught');
process.exit(bad ? 1 : 0);
