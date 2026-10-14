// Lane I (s84 1b, Q7): Recent items. localStorage key cs_I_recent, ids only, per role, hidden when empty or when the store throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, item } from './I_harness.mjs';

const many = () => ({ items: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x, n) => item(x, 'Item ' + x.toUpperCase(), n === 0 ? 0 : 20, 3, { codes: [] })) });
const store = (init) => { const m = new Map(init ? [['cs_I_recent', JSON.stringify(init)]] : []); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const make = async (role = 'owner', ls) => { const e = await setup({ role, client: mockClient({ catalogue: many() }) }); if (ls) e.win.localStorage = ls; return e; };
const names = (e) => [...(/I_recent[\s\S]*?<\/div>/.exec(e.html()) || [''])[0].matchAll(/data-id="(\w+)"/g)].map((m) => m[1]);

test('I_recent nothing is shown, and no slot is drawn, before the first card is opened', async () => {
  const e = await make('owner', store());
  await e.mount('');
  assert.doesNotMatch(e.html(), /I_recent/);
});

test('I_recent the last five cards, newest first, capped at five, with level glyph and word; a tap opens the card', async () => {
  const ls = store(); const e = await make('owner', ls);
  await e.mount('');
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) { await e.open(id); await e.act('close'); }
  assert.deepEqual(names(e), ['g', 'f', 'e', 'd', 'c']);
  assert.match(e.html(), /Recent/);
  await e.open('a'); await e.act('close'); // an older one moves to the front
  assert.deepEqual(names(e), ['a', 'g', 'f', 'e', 'd']);
  assert.match(e.html(), /Item A <span aria-hidden="true">✕<\/span> Out/); assert.match(e.html(), /Item G <span aria-hidden="true">✓<\/span> OK/);
  await e.act('open', { 'data-id': 'e' });
  assert.match(e.sheet(), /Item E/);
  assert.deepEqual(JSON.parse(ls.m.get('cs_I_recent')).ids.length, 5);
  assert.equal([...ls.m.keys()].join(), 'cs_I_recent'); // nothing else is stored, ids only
  assert.deepEqual(Object.keys(JSON.parse(ls.m.get('cs_I_recent'))).sort(), ['ids', 'role']);
});

test('I_recent it survives a restart for the same role', async () => {
  const ls = store({ role: 'owner', ids: ['c', 'b'] });
  const e = await make('owner', ls); await e.mount('');
  assert.deepEqual(names(e), ['c', 'b']);
});

test('I_recent a role switch clears it, both inside a visit and after a restart', async () => {
  const ls = store(); const e = await make('owner', ls);
  await e.mount(''); await e.open('b'); await e.act('close');
  assert.deepEqual(names(e), ['b']);
  e.unmount();
  e.win.I_Stock.mount(e.root, { client: mockClient({ catalogue: many() }), demo: false, role: 'cleaner', sub: '', navigate() {}, toast() {}, haptic() {} });
  assert.equal(ls.m.has('cs_I_recent'), false);
  assert.doesNotMatch(e.html(), /I_recent/);
  const stale = store({ role: 'owner', ids: ['b'] });
  const c = await make('cleaner', stale); await c.mount('');
  assert.doesNotMatch(c.html(), /I_recent/);
});

test('I_recent an item that left the catalogue is dropped silently', async () => {
  const e = await make('owner', store({ role: 'owner', ids: ['gone', 'b', 'also-gone'] })); await e.mount('');
  assert.deepEqual(names(e), ['b']);
  const none = await make('owner', store({ role: 'owner', ids: ['gone'] })); await none.mount('');
  assert.doesNotMatch(none.html(), /I_recent/);
});

test('I_recent a store that throws (private mode) leaves the feature hidden, not broken', async () => {
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const e = await make('owner', boom); await e.mount('');
  await e.open('b'); assert.match(e.sheet(), /Item B/); await e.act('close');
  assert.doesNotMatch(e.html(), /I_recent/);
  const none = await make('owner'); await none.mount(''); await none.open('b');
  assert.match(none.sheet(), /Item B/); // no store at all
  const junk = await make('owner', store()); junk.win.localStorage.setItem('cs_I_recent', '{not json'); await junk.mount('');
  assert.doesNotMatch(junk.html(), /I_recent/);
});

test('I_recent a cleaner gets her own list, names and levels only, no money', async () => {
  const e = await make('cleaner', store()); await e.mount(''); await e.open('b'); await e.act('close');
  assert.deepEqual(names(e), ['b']);
  assert.doesNotMatch(e.html(), /₱|PHP|cost|price/i);
});
