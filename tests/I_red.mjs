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
  ['cleaner keeps and shows cost', [["if (canManage(role)) it.cost = num(raw.unitCost);", "it.cost = num(raw.unitCost);"], ["(canManage(m) && it.cost != null ?", "(it.cost != null ?"]]],
  ['count sent without a confirm step', [["if (a.step !== 'confirm') { if (!valid(a))", "if (false) { if (!valid(a))"]]],
  ['count arg renamed', [["p_counted_qty: parseQty", "p_count_qty: parseQty"]]],
  ['usage_key renamed', [["usage_key: key }]", "usage_id: key }]"]]],
  ['new key on every build', [["a.key = K.keys[sig] || (K.keys[sig] = newKey(a.kind));", "a.key = newKey(a.kind);"]]],
  ['date taken from UTC not Manila', [["new Date(ms + 8 * 3600000)", "new Date(ms)"]]],
  ['submit never disabled while sending', [["(a.sending ? ' disabled' : '')", "''"]]],
  ['offline guard removed', [["if (!online()) { a.err = 'offline'; drawLayer(); return; }", ""]]],
  ['refused keeps the action', [["me.denied[gone] = true;", ""]]],
  ['demo calls the network', [["if (me.demo) { toast(DEMO_NOTE); finish(); return; }", ""], ["if (!M.demo && !(K.items", "if (true || !(K.items"]]],
  ['cleaner sees Count it', [["if (kind === 'count') return I_FLAGS.count && canManage(m) && !M.denied.count;", "if (kind === 'count') return !M.denied.count;"]]],
  ['failed probe shows sample rows', [["else me.loadErr = errKind(r && r.error, online()) === 'offline' ? 'offline' : 'unavailable';", "else { K.items = demoItems().map(function (x) { return normalize(x, me.role); }); }"]]],
  ['shopping read selects a cost column', [["reason,status,proposed_by,proposed_at'", "reason,status,proposed_by,proposed_at,estimated_cost'"]]],
  ['duplicate declaration', [["  function fmt(n)", "  function esc(s) { return s; }\n  function fmt(n)"]]],
  ['close allowed while sending', [["if (!M || (M.act && M.act.sending)) return;", "if (!M) return;"], ["if (a.sending) return; // nothing", "if (false) return; // nothing"]]],
  ['short note sent as typed', [["return t.length >= 3 ? t : 'Counted in the staff app';", "return t || 'Counted in the staff app';"]]],
  ['controlled item can receive', [["&& !(it && it.controlled);", ";"]]],
  ['no reload after failure', [["{ me.loading = false; load(); } // the write may have landed", "{ }"]]],
  ['syntax error', [["function canManage(role) {", "function canManage(role) { ((("]]],
  ['listeners left on unmount', [["M.el.removeEventListener && M.el.removeEventListener(l[0], l[1]);", ""]]],
  ['cached list shown to another role', [["if (K.role !== opts.role) {", "if (false) {"]]],
  ['cleaner reads last counted', [["!canManage(me.role) || me.itemInfo[id]", "me.itemInfo[id]"]]],
  ['mark bought drops the list id', [["shopId: r.id }, fromShop: true", "shopId: null }, fromShop: true"]]],
  ['level bar against the wrong scale', [["it.qty / (it.reorder * 2)", "it.qty / it.reorder"]]],
  ['admin link for everyone', [["(canManage(m) ? '<p class=\"help I_more\">", "(true ? '<p class=\"help I_more\">"]]],
  ['sheet role dialog dropped', [['role="dialog" aria-modal="true" ', '']]],
  ['stepper allows zero use', [["return fmt(Math.max(allowZero ? 0 : 1, n));", "return fmt(Math.max(0, n));"]]]
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'I_red-'));
let bad = 0;
for (const [name, edits] of M) {
  let s = src;
  for (const [a, b] of edits) { if (!s.includes(a)) { console.log('SKIP (pattern not found): ' + name + ' :: ' + a.slice(0, 50)); bad++; s = null; break; } s = s.replace(a, b); }
  if (s == null) continue;
  const f = path.join(dir, 'I_stock.mut.js'); fs.writeFileSync(f, s);
  const r = spawnSync(process.execPath, ['--test', path.join(here, 'I_rpc.test.mjs'), path.join(here, 'I_roles.test.mjs'), path.join(here, 'I_flow.test.mjs'), path.join(here, 'I_guard.test.mjs'), path.join(here, 'I_fix.test.mjs')], { env: Object.assign({}, process.env, { I_STOCK_SRC: f }), encoding: 'utf8' });
  const red = [...(r.stdout || '').matchAll(/^\s*✖ (I_\w+ [^\n(]+?) \(/gm)].map((m) => m[1].trim()).filter((v, i, a) => a.indexOf(v) === i);
  const ok = r.status !== 0 && red.length > 0;
  if (!ok) bad++;
  console.log((ok ? 'RED  ' : 'GREEN(!) ') + name + ' -> ' + (red.length ? red.length + ' failing: ' + red.slice(0, 3).join(' | ') : 'no failing test'));
}
console.log(bad ? bad + ' mutation(s) not caught' : 'every mutation was caught');
process.exit(bad ? 1 : 0);
