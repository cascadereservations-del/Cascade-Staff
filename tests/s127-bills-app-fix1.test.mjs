// s127 lane U fix round 1: the pay sheet driven through its real handlers (fake box, fake rpc). Names are invented ("Zz"); every expected value is written by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { CS, read, boot, baseHandlers } from './_a_harness.mjs';

const win = { CS, ICON: (n) => '<svg data-i="' + n + '"></svg>' }; win.window = win;
vm.runInContext(read('bills/BL_bills.js'), vm.createContext(win));
const BL = win.BL_Bills, L = BL.lib;
const plain = (x) => JSON.parse(JSON.stringify(x));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const OPEN = { ok: true, bill: { id: 'b', label: 'Electricity', kind: 'electric' }, pay: { amount_php: 2140, amount_editable: true, payee_name: 'Zz Power', number: '123', note: 'Bill', number_label: 'Account number' }, can_edit: false };
const CONFIRM = { ok: false, reason: 'confirm_amount', read: 9000, estimate_php: 2140 };

async function sheet(rpc) {
  const h = {}, nodes = { '#BL_done': { disabled: false }, '#BL_amthelp': { textContent: '' }, '#BL_file': { click() {} } };
  const box = { innerHTML: '', addEventListener: (t, f) => { h[t] = f; }, removeEventListener() {}, querySelector: (s) => nodes[s] || null, querySelectorAll: () => [] };
  const calls = [], st = { changes: 0, box, calls, h, nodes };
  const o = { box, sub: 'pay/b', propertyId: 'p', client: { rpc: (n, a) => { calls.push([n, plain(a)]); return Promise.resolve(rpc(n, a)).then((d) => ({ error: null, data: d })); } }, upload: async (f) => ({ path: 'cleaning/' + f.name, sha256: 'a'.repeat(64) }), onChange() { st.changes++; }, navigate() {}, toast() {} };
  BL.mount(box, o); await flush();
  st.file = async (name) => { h.change({ target: { id: 'BL_file', files: [{ name }] } }); await flush(); };
  st.type = async (v) => { h.input({ target: { id: 'BL_amt', value: v, getAttribute: () => null } }); await flush(); };
  st.click = async (act) => { h.click({ target: { closest: (s) => (s === '[data-bact]' ? { getAttribute: () => act } : null) } }); await flush(); };
  st.bodies = () => calls.filter((c) => c[0] === 'bill_pay_settle_v1').map((c) => c[1].p_proof);
  return st;
}

test('fix 2: the pay sheet keeps the approved order with every button in the page flow: amount, Pay to, screenshot, Mark as paid, Not now, Not paying this month', async () => {
  const s = await sheet((n) => (n === 'bill_pay_open_v1' ? OPEN : { ok: true }));
  const h = s.box.innerHTML;
  assert.ok(!h.includes('class="sticky"'), 'no sticky footer can cover Add the screenshot');
  const at = ['Copy amount', 'Pay to', 'After you have paid', 'Add the screenshot', 'Mark as paid', 'Not now', 'Not paying this month'].map((t) => h.indexOf(t));
  assert.ok(at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])), at.join(','));
  BL.unmount();
});
test('fix 3: confirmed is sent only for the same screenshot and the same amount the warning was shown for', async () => {
  const s = await sheet((n) => (n === 'bill_pay_open_v1' ? OPEN : CONFIRM));
  await s.file('one.jpg'); await s.type('9,000'); await s.click('settle');
  assert.deepEqual(s.bodies().map((b) => [b.amount, b.confirmed]), [[9000, false]]);
  await s.click('settle'); assert.equal(s.bodies()[1].confirmed, true, 'same proof, same amount');
  await s.file('two.jpg'); await s.click('settle'); assert.equal(s.bodies()[2].confirmed, false, 'a new screenshot is a new proof'); assert.equal(s.bodies()[2].path, 'cleaning/two.jpg');
  await s.click('settle'); assert.equal(s.bodies()[3].confirmed, true, 'warned again for the new proof, then confirmed');
  await s.type('9,100'); await s.click('settle'); assert.equal(s.bodies()[4].confirmed, false, 'a changed amount is asked again');
  await s.type('9,000'); await s.click('settle'); assert.equal(s.bodies()[5].confirmed, false, 'changing the amount and back clears the earlier yes');
  BL.unmount();
});
test('fix 3: after duplicate_proof the screenshot is gone and a later one is not pre-confirmed', async () => {
  let n = 0; const s = await sheet((name) => (name === 'bill_pay_open_v1' ? OPEN : ++n === 1 ? CONFIRM : n === 2 ? { ok: false, reason: 'duplicate_proof' } : CONFIRM));
  await s.file('one.jpg'); await s.type('9000'); await s.click('settle'); await s.click('settle');
  assert.match(s.box.innerHTML, /already used for another payment/); assert.match(s.box.innerHTML, /Add the screenshot/); assert.match(s.box.innerHTML, /id="BL_done"[^>]*disabled/);
  await s.file('three.jpg'); await s.click('settle'); assert.equal(s.bodies()[2].confirmed, false);
  BL.unmount();
});
test('fix 4 and 5: an unknown answer on Mark as paid refreshes the card and says it may not be logged; a known refusal does not', async () => {
  const s = await sheet((n) => { if (n === 'bill_pay_open_v1') return OPEN; throw new Error('offline'); });
  await s.file('a.jpg'); await s.click('settle');
  assert.equal(s.changes, 1); assert.match(s.box.innerHTML, /This may not be logged yet\. Check the card before paying again\./);
  BL.unmount();
  const k = await sheet((n) => (n === 'bill_pay_open_v1' ? OPEN : { ok: false, reason: 'bad_amount' }));
  await k.file('a.jpg'); await k.click('settle'); assert.equal(k.changes, 0); assert.match(k.box.innerHTML, /between ₱1 and ₱100,000\./);
  BL.unmount();
});
test('fix 5: a failed open and a failed Not now or skip say their own sentence', async () => {
  const o = await sheet(() => { throw new Error('offline'); });
  assert.match(o.box.innerHTML, /This bill could not be opened\. Check your connection and try again\./); assert.doesNotMatch(o.box.innerHTML, /may not be logged/);
  BL.unmount();
  const s = await sheet((n) => { if (n === 'bill_pay_open_v1') return OPEN; throw new Error('offline'); });
  await s.click('cancel'); assert.match(s.box.innerHTML, /That did not go through\. Check your connection and try again\./); assert.doesNotMatch(s.box.innerHTML, /may not be logged/);
  BL.unmount();
  const k = await sheet((n) => { if (n === 'bill_pay_open_v1') return OPEN; throw new Error('offline'); });
  await k.click('skip-ask'); await k.click('skip-yes'); assert.match(k.box.innerHTML, /That did not go through\./);
  BL.unmount();
});
test('fix 8: leaving the sheet while Mark as paid is in flight still refreshes the card when the answer arrives', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const s = await sheet((n) => (n === 'bill_pay_open_v1' ? OPEN : gate));
  await s.file('a.jpg'); await s.click('settle'); assert.equal(s.changes, 0);
  BL.unmount(); release({ ok: true }); await flush();
  assert.equal(s.changes, 1);
});
test('fix 6: the amount field takes 2,140 / 2140.50 / ₱2,140 and refuses .50, 1,2,3, empty, zero, negatives and over 100,000 with one sentence', async () => {
  assert.equal(L.amountOf('2,140'), 2140); assert.equal(L.amountOf('2140.50'), 2140.5); assert.equal(L.amountOf('₱2,140'), 2140); assert.equal(L.amountOf('.50'), null); assert.equal(L.amountOf('0.99'), null); assert.equal(L.amountOf('1'), 1); assert.equal(L.amountOf('100,000'), 100000);
  for (const bad of ['1,2,3', '12,34', '', '  ', '0', '0.00', '-5', '-2,140', '100,000.01', '1,000,00', '2140.']) assert.equal(L.amountOf(bad), null, JSON.stringify(bad));
  const s = await sheet((n) => (n === 'bill_pay_open_v1' ? OPEN : { ok: true }));
  await s.type('1,2,3'); assert.equal(s.nodes['#BL_amthelp'].textContent, 'Enter the amount on the receipt, between ₱1 and ₱100,000.');
  await s.type('2,140'); assert.match(s.nodes['#BL_amthelp'].textContent, /^Starts at the estimate, ₱2,140\./);
  BL.unmount();
  assert.equal(L.refusal({ reason: 'bad_amount' }), 'Enter the amount on the receipt, between ₱1 and ₱100,000.');
  assert.equal(L.refusal({ reason: 'confirm_amount', read: 9000, estimate_php: null }), 'Check the amount on the receipt, then tap Mark as paid again to log it.');
  assert.doesNotMatch(L.refusal({ reason: 'confirm_amount', read: 9000, estimate_php: 0 }), /₱0/);
});
test('fix 7: a tap anywhere in the input box (the PHP prefix, the padding) focuses its input', async () => {
  const s = await sheet((n) => (n === 'bill_pay_open_v1' ? OPEN : { ok: true }));
  let focused = 0; const inp = { focus() { focused++; } }, prefix = {}, wrap = { querySelector: () => inp };
  s.h.click({ target: Object.assign(prefix, { closest: (q) => (q === '.input' ? wrap : null) }) });
  assert.equal(focused, 1);
  s.h.click({ target: Object.assign(inp, { closest: (q) => (q === '.input' ? wrap : null) }) });
  assert.equal(focused, 1, 'a tap on the input itself is left alone');
  BL.unmount();
});
test('fix 1: a paid bill screenshot is signed from cleaning-photos, where payment proofs are stored', async () => {
  const buckets = [], storage = { from: (b) => { buckets.push(b); return { createSignedUrl: () => Promise.resolve({ error: null, data: { signedUrl: 'https://files.example/zz.jpg' } }) }; } };
  const app = await boot({ role: 'owner', hash: '#home', storage, handlers: baseHandlers('owner', { bill_proof_v1: () => ({ error: null, data: { ok: true, path: 'bills/zz.jpg' } }) }) });
  await app.click({ 'data-act': 'bill-proof', 'data-id': 'b2' }); await app.flush();
  assert.deepEqual(buckets, ['cleaning-photos']);
});

// review 2: a slow upload must never settle another bill.
test('review 2: an upload that finishes after the payer opened another bill settles nothing', async () => {
  const s = await sheet((n) => (n === 'bill_pay_open_v1' ? OPEN : { ok: true }));
  let release; const held = new Promise((r) => { release = r; });
  BL.unmount();
  const calls = [], box = s.box, h = s.h;
  const mk = (sub, upload) => ({ box, sub, propertyId: 'p', client: { rpc: (n, a) => { calls.push([n, plain(a)]); return Promise.resolve({ error: null, data: n === 'bill_pay_open_v1' ? Object.assign({}, OPEN, { bill: { id: sub.slice(4), label: 'Zz', kind: 'internet' } }) : { ok: true } }); } }, upload, onChange() {}, navigate() {}, toast() {} });
  BL.mount(box, mk('pay/A', () => held)); await flush();
  h.change({ target: { id: 'BL_file', files: [{ name: 'a.jpg' }] } }); await flush();
  h.click({ target: { closest: (q) => (q === '[data-bact]' ? { getAttribute: () => 'settle' } : null) } }); await flush();
  assert.match(box.innerHTML, /id="BL_amt"[^>]* disabled/, 'amount is locked while saving'); assert.match(box.innerHTML, /data-bact="pick" disabled/, 'screenshot is locked while saving');
  BL.unmount(); BL.mount(box, mk('pay/B', async () => ({ path: 'cleaning/b.jpg', sha256: 'b'.repeat(64) }))); await flush();
  release({ path: 'cleaning/a.jpg', sha256: 'a'.repeat(64) }); await flush();
  assert.deepEqual(calls.filter((c) => c[0] === 'bill_pay_settle_v1'), [], 'no bill is settled with the old upload');
  h.change({ target: { id: 'BL_file', files: [{ name: 'b.jpg' }] } }); await flush();
  h.click({ target: { closest: (q) => (q === '[data-bact]' ? { getAttribute: () => 'settle' } : null) } }); await flush();
  assert.deepEqual(calls.filter((c) => c[0] === 'bill_pay_settle_v1').map((c) => [c[1].p_bill_id, c[1].p_proof.path]), [['B', 'cleaning/b.jpg']], 'bill B settles only with its own screenshot');
  BL.unmount();
});
