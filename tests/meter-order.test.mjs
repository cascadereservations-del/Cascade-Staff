// Pins the stay-order meter check on the checklist (2026-10-27): a late report asks last-readings for its own
// check-out date and is checked against the stays either side, the same rule submit-cleaning enforces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../checklist/index.html', import.meta.url), 'utf8');

test('last-readings is asked for this stay\'s check-out date, and a newer ask wins', () => {
  assert.match(html, /last-readings\?property_id=\$\{encodeURIComponent\(PROPERTY_ID\)\}\$\{coParam\}/);
  assert.match(html, /if \(seq !== prevReadingsSeq\) return;/);
  assert.match(html, /addEventListener\('change', \(\) => \{ fetchPrevReadings\(\); \}\)/);
});

test('submit asks about a reading above the later stay as well as below the stay before (never refuses)', () => {
  assert.match(html, /is higher than the next stay \(\$\{m\.next\}\)\. Is the number right\?/);
  assert.match(html, /is lower than the last stay \(\$\{m\.prev\}\)\. Is the number right\?/);
  assert.doesNotMatch(html, /is lower than the last reading/);
});

test('the advisor line says the range when a later stay is already on file', () => {
  assert.match(html, /<p class="prev-range" id="prev-range" hidden><\/p>/);
  assert.match(html, /function renderPrevRange\(\)/);
});
