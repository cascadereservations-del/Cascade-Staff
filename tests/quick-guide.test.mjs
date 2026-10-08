import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'quick', 'index.html'), 'utf8');

test('every card on the landing opens a view that exists', () => {
  const slugs = [...html.matchAll(/class="tile[^"]*" href="#\/([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(slugs.length, 10);
  for (const s of slugs) assert.ok(html.includes('id="v-' + s + '"'), s);
});
test('the Telegram links carry the OPS and Finance ids with a web fallback', () => {
  for (const id of ['3798341977', '3819352746']) assert.ok(html.includes('href="https://t.me/c/' + id + '/1" data-tg="' + id + '"'));
  assert.ok(html.includes('tg://privatepost?channel='));
});
test('every FAQ cites its source file and none uses an exclamation word', () => {
  const faq = html.slice(html.indexOf('id="v-faq"'));
  const cards = (faq.match(/<section class="card faq-q">/g) || []).length;
  assert.ok(cards >= 10);
  assert.equal((faq.match(/<section class="card faq-q">\s*<!-- source: /g) || []).length, cards);
  assert.ok(!/Cassy<\/span>[^<]*!/.test(faq));
});
