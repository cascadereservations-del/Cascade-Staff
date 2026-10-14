// Lane I (s84): Send a report. Exact function name and body keys, who sees which destination, the 30 s hold, probe-and-hide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mockClient, CATALOGUE } from './I_harness.mjs';

const make = (role, o = {}) => setup({ role, client: mockClient({ catalogue: CATALOGUE, ...o }) });
const pick = async (e, kind, to) => { await e.act('rep-kind', { 'data-k': kind }); if (to) await e.act('rep-to', { 'data-to': to }); };
const httpErr = (status, body) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => body } } });

test('I_report the button sits at the foot of the Items view for every role, and not on the shopping view', async () => {
  for (const role of ['owner', 'admin', 'cleaner', 'finance']) {
    const e = await make(role); await e.mount('');
    assert.match(e.html(), /data-act="report"/, role);
  }
  const s = await make('owner'); await s.mount('shopping');
  assert.doesNotMatch(s.html(), /data-act="report"/);
});

test('I_report the sheet lists the five reports', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('report');
  for (const t of ['Order list', 'All items', 'Consumables', 'Low stock', 'Miscellaneous']) assert.match(e.sheet(), new RegExp(t));
  assert.equal([...e.sheet().matchAll(/data-act="rep-kind"/g)].length, 5);
});

test('I_report owner, admin and finance choose Finance (with prices) or OPS (no prices); a cleaner sees OPS only and no radio', async () => {
  for (const role of ['owner', 'admin', 'finance']) {
    const e = await make(role); await e.mount(''); await e.act('report');
    assert.match(e.sheet(), /Finance group \(with prices\)/, role); assert.match(e.sheet(), /OPS group \(no prices\)/, role);
  }
  const c = await make('cleaner'); await c.mount(''); await c.act('report');
  assert.doesNotMatch(c.sheet(), /Finance|prices|rep-to/); assert.match(c.sheet(), /OPS group/);
  await c.act('rep-to', { 'data-to': 'finance' }); // a hand-made click cannot pick Finance
  await c.act('rep-kind', { 'data-k': 'low' }); await c.submit();
  assert.doesNotMatch(c.sheet(), /Finance|price/i);
  await c.submit();
  assert.deepEqual({ ...c.client.fnCalls('inventory-report')[0][2] }, { kind: 'low', to: 'ops' });
});

test('I_report confirm names the list and the group, nothing is sent before it, then functions.invoke with {kind, to}', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('report');
  await pick(e, 'low', 'ops'); await e.submit();
  assert.match(e.sheet(), /Send the low-stock list to the OPS group\?/); assert.match(e.sheet(), /No prices are shown/);
  assert.equal(e.client.fnCalls().length, 0);
  await e.submit();
  const c = e.client.fnCalls('inventory-report');
  assert.equal(c.length, 1);
  assert.deepEqual(Object.keys(c[0][2]).sort(), ['kind', 'to']);
  assert.deepEqual({ ...c[0][2] }, { kind: 'low', to: 'ops' });
  assert.match(e.toasts[e.toasts.length - 1], /^Sent to the OPS group\.$/);
  assert.equal(e.client.rpcCalls('get_inventory_catalogue_v1').length, 1); // a report changes no stock: no reload
});

test('I_report Finance send: the confirm says prices are included, every kind keeps its own key', async () => {
  const e = await make('finance'); await e.mount('');
  for (const [k, said] of [['order', 'the order list'], ['all', 'the full item list'], ['consumables', 'the consumables list'], ['misc', 'the miscellaneous list']]) {
    await e.act('report'); await pick(e, k, 'finance'); await e.submit();
    assert.match(e.sheet(), new RegExp('Send ' + said + ' to the Finance group\\?')); assert.match(e.sheet(), /Prices are included/);
    await e.submit();
    assert.deepEqual({ ...e.client.fnCalls('inventory-report').pop()[2] }, { kind: k, to: 'finance' });
  }
});

test('I_report the same list to the same group is held for 30 seconds, then allowed (frozen clock)', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('report'); await pick(e, 'low', 'ops'); await e.submit(); await e.submit();
  await e.act('report'); await pick(e, 'low', 'ops'); await e.submit();
  assert.match(e.sheet(), /just sent\. Please wait half a minute/);
  await pick(e, 'low', 'finance'); await e.submit(); // another group is not held
  assert.match(e.sheet(), /Send the low-stock list to the Finance group\?/);
  await e.act('back'); await pick(e, 'low', 'ops');
  e.advance(31000); await e.submit();
  assert.match(e.sheet(), /to the OPS group\?/);
  await e.submit();
  assert.equal(e.client.fnCalls('inventory-report').filter((c) => c[2].to === 'ops').length, 2);
});

test('I_report probe-and-hide: a 404 from the function removes the button for the visit and shows a calm toast', async () => {
  const e = await make('owner', { fn: { 'inventory-report': () => httpErr(404, null) } });
  await e.mount(''); await e.act('report'); await e.submit(); await e.submit();
  assert.match(e.toasts[e.toasts.length - 1], /not available right now/);
  assert.doesNotMatch(e.html(), /data-act="report"/);
  assert.doesNotMatch(e.sheet(), /errbox/);
});

test('I_report finance_only (403) takes the Finance choice away and keeps the report available', async () => {
  const e = await make('owner', { fn: { 'inventory-report': (b) => (b.to === 'finance' ? httpErr(403, { ok: false, error: 'finance_only' }) : { data: { ok: true }, error: null }) } });
  await e.mount(''); await e.act('report'); await pick(e, 'order', 'finance'); await e.submit(); await e.submit();
  assert.match(e.sheet(), /Finance lists are not open to you right now\. The OPS list has no prices/);
  assert.doesNotMatch(e.sheet(), /Finance group \(with prices\)/);
  assert.match(e.html(), /data-act="report"/);
  await e.submit(); await e.submit();
  assert.deepEqual({ ...e.client.fnCalls('inventory-report').pop()[2] }, { kind: 'order', to: 'ops' });
});

test('I_report a plain refusal (401) hides the button; a dropped connection says so and can be retried', async () => {
  const a = await make('cleaner', { fn: { 'inventory-report': () => httpErr(401, null) } });
  await a.mount(''); await a.act('report'); await a.submit(); await a.submit();
  assert.doesNotMatch(a.html(), /data-act="report"/);
  const b = await make('cleaner', { fn: { 'inventory-report': () => ({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } }) } });
  await b.mount(''); await b.act('report'); await b.submit(); await b.submit();
  assert.match(b.sheet(), /No connection, so nothing was sent/);
  assert.match(b.html(), /data-act="report"/);
});

test('I_report offline sends nothing', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('report'); await e.submit();
  e.nav.onLine = false; await e.submit();
  assert.equal(e.client.fnCalls().length, 0); assert.match(e.sheet(), /No connection/);
});

test('I_report demo: no call, a plain note', async () => {
  const e = await setup({ role: 'owner', demo: true });
  await e.mount(''); await e.act('report'); await e.submit(); await e.submit();
  assert.equal(e.toasts[e.toasts.length - 1], 'Demo only, nothing was sent.');
});

test('I_report Back steps out one level and Escape closes', async () => {
  const e = await make('owner'); await e.mount(''); await e.act('report'); await e.submit();
  assert.match(e.sheet(), /Send the order list/);
  await e.act('back'); assert.match(e.sheet(), /Which list/);
  await e.key('Escape'); assert.equal(e.sheet(), '');
});
