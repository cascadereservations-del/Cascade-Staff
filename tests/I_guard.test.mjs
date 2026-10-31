// Lane I: parse test, duplicate-name guard, one new global, CSS stays inside the I_ prefix and the shell's own classes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { here, srcPath, setup } from './I_harness.mjs';

const js = fs.readFileSync(srcPath, 'utf8');
const css = fs.readFileSync(path.join(here, '..', 'stock', 'I_stock.css'), 'utf8');

test('I_guard parse: the script compiles and the stylesheet braces balance', () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'I_stock.js' }));
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
  assert.ok(!/<\/?script/i.test(js));
});

test('I_guard no top-level name is declared twice inside the module', () => {
  const names = [...js.matchAll(/^  (?:function|var) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(names.length > 40, 'found the module-level declarations');
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dup, []);
});

test('I_guard the only global the module adds is I_Stock (mount, unmount, lib)', async () => {
  const e = await setup({ role: 'cleaner' });
  assert.deepEqual(Object.keys(e.win).filter((k) => !['crypto', 'ICON', 'I_STOCK_FLAGS', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'].includes(k)), ['I_Stock']);
  assert.deepEqual(Object.keys(e.win.I_Stock).sort(), ['lib', 'mount', 'unmount']);
});

test('I_guard css: every selector begins with the I_ prefix or sits under it', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...stripped.matchAll(/(^|\})\s*([^{}]+)\{/g)].flatMap((m) => m[2].split(',').map((s) => s.trim()));
  assert.ok(selectors.length > 20);
  for (const s of selectors) assert.match(s, /^(div)?\.I_|^\.I_/, 'selector outside the lane prefix: ' + s);
});

test('I_guard css uses tokens only: no hex colour and no px font size under 13', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  for (const m of css.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)) assert.ok(+m[1] >= 13, m[0]);
});

test('I_guard the script reads no localStorage and holds no secret-looking value', () => {
  assert.doesNotMatch(js, /indexedDB/);
  for (const line of js.split(/\r?\n/).filter((l) => /sessionStorage/.test(l))) assert.match(line, /function ss(Get|Set)/, 'sessionStorage is read only in ssGet and ssSet: ' + line.trim().slice(0, 60)); // s107
  for (const m of js.matchAll(/ss(?:Get|Set)\('([^']+)'/g)) assert.match(m[1], /^cs_I_(view|cart)$/, 'only the view and the in-cart ticks are kept for the visit');
  for (const line of js.split(/\r?\n/).filter((l) => /localStorage/.test(l))) assert.match(line, /cs_I_recent|I_pu_v1|puLoad|puSave/, 'localStorage is only for the recent-items key and the photo link cache: ' + line.trim().slice(0, 60));
  assert.doesNotMatch(js, /payout_qrph|service_role|eyJ[A-Za-z0-9_-]{20,}/);
});

test('I_guard no user-facing exclamation mark and no emoji in the strings', () => {
  const strings = [...js.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).filter((s) => /[A-Za-z]{3}/.test(s));
  for (const s of strings) assert.doesNotMatch(s, /[A-Za-z]!( |$)/, s);
  assert.doesNotMatch(js, /[\u{1F300}-\u{1FAFF}]/u);
});
