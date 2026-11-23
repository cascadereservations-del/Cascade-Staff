// s133: s132 reused .I_opt/.I_opts/.I_ob (product options) and .I_out (the Out status pill) for the Update sheet.
// The later rules won, so product names were squeezed into a 44 px circle and the Out pill became a 64 px full-width block.
// Guard: a single-class .I_* rule that sets layout (display, width, flex, grid) is declared only once in I_stock.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../stock/I_stock.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('s133: no .I_* class gets two layout rules', () => {
  const seen = {};
  for (const r of css.matchAll(/(^|\})\s*(\.I_[A-Za-z0-9_]+)\s*\{([^}]*)\}/g)) {
    if (/display|width|flex|grid/.test(r[3])) (seen[r[2]] = seen[r[2]] || []).push(r[3].trim().slice(0, 60));
  }
  const dup = Object.entries(seen).filter(([, v]) => v.length > 1);
  assert.deepEqual(dup, [], 'declared twice: ' + dup.map(([k]) => k).join(', '));
});

test('s133: the Update sheet uses its own class names', () => {
  for (const c of ['.I_uopts', '.I_uopt', '.I_uob', '.I_uopt_t', '.I_uouts', '.I_uout']) assert.match(css, new RegExp('\\' + c + '[ \\[{]'), c);
  assert.match(css, /\.I_out \{ background: var\(--v5-danger-w\)/, 'the Out pill keeps its pill rule');
  assert.match(css, /\.I_ob \{ min-width: 0; flex: 1; \}/, 'the option body stays flexible');
});
