// Run only the tests related to some changed files (no dependencies).
//   node scripts/test-related.mjs <file> [<file> ...]       the files you name        (npm run test:related -- <files>)
//   node scripts/test-related.mjs --changed                  git diff HEAD + untracked (npm run test:changed)
//   node scripts/test-related.mjs --affected                 git diff origin/main...HEAD, else the merge-base (npm run test:affected; fetch is the caller's job)
//   --list prints the selection and runs nothing.
// A test is related when its text names the changed file's path or its basename; a changed test file selects itself.
// A change to app.js, sw.js or package.json also selects every test that pins a version or the cache name.
// The full `npm test` is still the gate before a push.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERIC = new Set(['index.html', 'index.js', 'package.json', 'README.md']);   // too common to match by name alone
const VERSION_FILES = new Set(['app.js', 'sw.js', 'package.json']);
const VERSION_PIN = /CACHE_NAME|package\.json|APP_VERSION|\b3\.\d+\.\d+\b/;

const norm = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

/* tests: [{ file: 'tests/x.test.mjs', text }]. helpers: the other files in tests/ (harnesses, page snippets) in the same shape: a test that names a
   harness is related to everything the harness loads, one level deep. changed: repo-relative paths. Returns the selected test files, sorted. */
export function selectTests(changed, tests, helpers = []) {
  const out = new Set();
  const all = [...changed];
  for (const raw of changed) {
    const p = norm(raw), base = basename(p);
    if (/^tests\/[^/]+\.test\.mjs$/.test(p)) continue;
    for (const h of helpers) if (h.text.includes(p) || (!GENERIC.has(base) && h.text.includes(base))) all.push(h.file);
  }
  for (const raw of all) {
    const p = norm(raw); if (!p) continue;
    const base = basename(p);
    const isTest = /^tests\/[^/]+\.test\.mjs$/.test(p);
    if (isTest) { if (tests.some(t => t.file === p)) out.add(p); continue; }
    for (const t of tests) {
      if (t.text.includes(p) || (!GENERIC.has(base) && t.text.includes(base))) out.add(t.file);
    }
    if (VERSION_FILES.has(base)) tests.filter(t => VERSION_PIN.test(t.text)).forEach(t => out.add(t.file));
  }
  return [...out].sort();
}

export function loadTests(root = ROOT, helpers = false) {
  const dir = join(root, 'tests');
  const pick = helpers ? f => /\.(mjs|js|ts|html)$/.test(f) && !/\.test\.mjs$/.test(f) : f => /\.test\.mjs$/.test(f);
  return readdirSync(dir).filter(pick).map(f => ({ file: 'tests/' + f, text: readFileSync(join(dir, f), 'utf8') }));
}

const git = (...a) => { const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.split('\n').map(s => s.trim()).filter(Boolean) : null; };

export function changedFiles(mode) {
  if (mode === 'changed') return [...new Set([...(git('diff', '--name-only', 'HEAD') || []), ...(git('ls-files', '--others', '--exclude-standard') || [])])];
  let r = git('diff', '--name-only', 'origin/main...HEAD');
  if (!r) { const mb = git('merge-base', 'origin/main', 'HEAD'); r = mb && mb[0] ? git('diff', '--name-only', mb[0], 'HEAD') : null; }
  if (!r) { console.log('test-related: no origin/main to compare with (git fetch first); nothing selected'); return []; }
  return r;
}

function main(argv) {
  const list = argv.includes('--list');
  const args = argv.filter(a => a !== '--list');
  let changed;
  if (args[0] === '--changed') changed = changedFiles('changed');
  else if (args[0] === '--affected') changed = changedFiles('affected');
  else changed = args.map(a => norm(resolve(a)).startsWith(norm(ROOT) + '/') ? norm(resolve(a)).slice(norm(ROOT).length + 1) : norm(a));
  const sel = selectTests(changed, loadTests(), loadTests(ROOT, true));
  if (!sel.length) { console.log('test-related: no test maps to ' + (changed.length ? changed.join(', ') : 'any changed file') + '; nothing run'); return 0; }
  console.log('test-related: ' + sel.length + ' test file(s) for ' + changed.length + ' changed file(s):\n  ' + sel.join('\n  '));
  if (list) return 0;
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...sel], { cwd: ROOT, stdio: 'inherit' });
  return r.status == null ? 1 : r.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
