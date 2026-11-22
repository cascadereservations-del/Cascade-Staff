// The related-test selector (scripts/test-related.mjs) behind npm run test:related / test:changed / test:affected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTests, loadTests } from '../scripts/test-related.mjs';

const T = (file, text) => ({ file: 'tests/' + file, text });
const fake = [
  T('a.test.mjs', "readFileSync('../checklist/index.html')"),
  T('b.test.mjs', "import { x } from './I_harness.mjs'"),
  T('c.test.mjs', "assert.match(sw, /const CACHE_NAME = 'ch-shell-v1';/)"),
  T('d.test.mjs', "readFileSync('../stock/other.js')"),
  T('e.test.mjs', "const pkg = JSON.parse(readFileSync('../package.json'))"),
];
const helpers = [{ file: 'tests/I_harness.mjs', text: "readFileSync('../stock/I_stock.js')" }];

test('a changed file selects the tests that name its path', () => {
  assert.deepEqual(selectTests(['checklist/index.html'], fake, helpers), ['tests/a.test.mjs']);
  assert.deepEqual(selectTests(['stock\\other.js'], fake, helpers), ['tests/d.test.mjs'], 'Windows separators are read the same');
});

test('a harness a test imports carries the change one level to that test', () => {
  assert.deepEqual(selectTests(['stock/I_stock.js'], fake, helpers), ['tests/b.test.mjs']);
});

test('a generic basename alone (index.html) never selects by name', () => {
  assert.deepEqual(selectTests(['guest/index.html'], fake, helpers), []);
});

test('a changed test selects itself; an unknown test selects nothing; nothing maps = empty', () => {
  assert.deepEqual(selectTests(['tests/d.test.mjs'], fake, helpers), ['tests/d.test.mjs']);
  assert.deepEqual(selectTests(['tests/nope.test.mjs'], fake, helpers), []);
  assert.deepEqual(selectTests(['docs/notes.md'], fake, helpers), []);
  assert.deepEqual(selectTests([], fake, helpers), []);
});

test('app.js, sw.js or package.json also select every test that pins a version or the cache name', () => {
  assert.deepEqual(selectTests(['checklist/sw.js'], fake, helpers), ['tests/c.test.mjs', 'tests/e.test.mjs']);
  assert.deepEqual(selectTests(['app.js'], fake, helpers), ['tests/c.test.mjs', 'tests/e.test.mjs']);
  assert.ok(selectTests(['package.json'], fake, helpers).includes('tests/c.test.mjs'));
});

test('on the real repo: stock/I_stock.js reaches the I_* tests and s132-update; checklist/index.html reaches the checklist tests', () => {
  const tests = loadTests(), helpersReal = loadTests(undefined, true);
  const stock = selectTests(['stock/I_stock.js'], tests, helpersReal);
  assert.ok(stock.includes('tests/s132-update.test.mjs'));
  assert.ok(stock.includes('tests/I_flow.test.mjs') && stock.includes('tests/I_rpc.test.mjs'));
  const chk = selectTests(['checklist/index.html'], tests, helpersReal);
  for (const f of ['s132-utensils-check', 's120_restock_linen', 's120_checklist_dom', 's121_hero_glass']) assert.ok(chk.includes(`tests/${f}.test.mjs`), f);
  assert.ok(!chk.includes('tests/I_flow.test.mjs'), 'stock tests are not checklist tests');
  const sw = selectTests(['checklist/sw.js'], tests, helpersReal);
  for (const f of ['s120_restock_linen', 's121_hero_glass', 's121_restock_defaults', 's124_held_photos']) assert.ok(sw.includes(`tests/${f}.test.mjs`), 'cache name pin: ' + f);
});
