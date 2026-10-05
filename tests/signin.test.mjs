import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const CS = createRequire(import.meta.url)('../lib.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// A Storage stand-in: getItem/setItem/removeItem/key/length like the browser's.
function fakeStorage(init = {}, { throws = false } = {}) {
  const m = new Map(Object.entries(init));
  const guard = () => { if (throws) throw new Error('blocked'); };
  return {
    getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard(); m.set(k, String(v)); },
    removeItem: (k) => { guard(); m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
  };
}

const HONEY = { label: 'Honey', handle: 'honey@staff.cascade.invalid', kind: 'pin' };
const LLOYD = { label: 'Lloyd', handle: 'lloyd@example.com', kind: 'password' };

test('keypad: digits append up to four, back removes one, extra presses and non-digits change nothing', () => {
  let pin = '';
  for (const k of ['1', '2', '3']) pin = CS.keypadPress(pin, k);
  assert.equal(pin, '123');
  pin = CS.keypadPress(pin, 'back'); assert.equal(pin, '12');
  pin = CS.keypadPress(CS.keypadPress(pin, '3'), '4'); assert.equal(pin, '1234');
  assert.equal(CS.keypadPress(pin, '5'), '1234', 'a fifth digit is ignored');
  assert.equal(CS.keypadPress('', 'back'), '');
  assert.equal(CS.keypadPress('12', 'x'), '12');
  assert.equal(CS.keypadPress('12', '12'), '12');
  assert.equal(CS.keypadPress('12', 'clear'), '');
});

test('keypad input becomes the checklist password: pin 4242 -> 88884242 for slug@staff.cascade.invalid', () => {
  let pin = ''; for (const k of '4242') pin = CS.keypadPress(pin, k);
  assert.deepEqual(CS.signinCredentials(HONEY, pin), { email: 'honey@staff.cascade.invalid', password: '88884242' });
  assert.equal(CS.signinCredentials(HONEY, '424'), null, 'three digits are not a PIN yet');
  assert.equal(CS.signinCredentials(HONEY, ''), null);
  assert.equal(CS.signinCredentials(null, '4242'), null);
  assert.equal(CS.signinCredentials({ label: 'x', handle: '', kind: 'pin' }, '4242'), null);
});

test('password accounts send the password exactly as typed, e-mail as the handle; empty is not sent', () => {
  assert.deepEqual(CS.signinCredentials(LLOYD, 'Correct horse 9'), { email: 'lloyd@example.com', password: 'Correct horse 9' });
  assert.deepEqual(CS.signinCredentials(LLOYD, '1234'), { email: 'lloyd@example.com', password: '1234' }, 'no 8888 prefix on a mailbox account');
  assert.equal(CS.signinCredentials(LLOYD, ''), null);
});

test('kind routing: the staff.cascade.invalid domain is a PIN account, anything else a password account', () => {
  assert.equal(CS.signinKind('honey@staff.cascade.invalid'), 'pin');
  assert.equal(CS.signinKind('Honey@Staff.Cascade.Invalid'), 'pin');
  assert.equal(CS.signinKind('lloyd@gmail.com'), 'password');
  assert.equal(CS.signinKind('x@staff.cascade.invalid.evil.com'), 'password');
  assert.equal(CS.signinKind(''), 'password');
});

test('the RPC rows are cleaned: nameless or handle-less rows dropped, an unknown kind is worked out from the handle', () => {
  const rows = [
    { label: ' Honey ', handle: 'Honey@staff.cascade.invalid', kind: 'pin' },
    { label: 'Lloyd', handle: 'lloyd@example.com', kind: 'password' },
    { label: '', handle: 'ghost@staff.cascade.invalid', kind: 'pin' },
    { label: 'No handle', handle: '', kind: 'pin' },
    { label: 'Odd kind', handle: 'odd@staff.cascade.invalid', kind: 'admin' },
    null,
  ];
  const list = CS.signinList(rows);
  assert.deepEqual(list.map((r) => r.label), ['Honey', 'Lloyd', 'Odd kind']);
  assert.equal(list[0].handle, 'honey@staff.cascade.invalid');
  assert.equal(list[2].kind, 'pin');
  assert.deepEqual(CS.signinList(null), []);
  assert.deepEqual(CS.signinList({ error: 1 }), []);
});

test('typed fallback (list unavailable): a name becomes a PIN entry, an e-mail a password entry, junk is nothing', () => {
  assert.deepEqual(CS.typedEntry(' Mary Ann '), { label: 'Mary Ann', handle: 'mary.ann@staff.cascade.invalid', kind: 'pin' });
  assert.equal(CS.typedEntry('Marifel@Example.com').kind, 'password');
  assert.equal(CS.typedEntry('Marifel@Example.com').handle, 'marifel@example.com');
  assert.equal(CS.typedEntry(''), null);
  assert.equal(CS.typedEntry('!!!'), null);
});

test('trust toggle picks the storage: ON writes localStorage, OFF writes sessionStorage, and one session lives in one place', () => {
  const K = 'sb-abc-auth-token';
  const local = fakeStorage(), session = fakeStorage();
  let trusted = true;
  const a = CS.authStorage(local, session, () => trusted);

  a.setItem(K, 'S1');
  assert.deepEqual(local.dump(), { [K]: 'S1' }); assert.deepEqual(session.dump(), {});
  assert.equal(a.getItem(K), 'S1');

  trusted = false; a.setItem(K, 'S2'); // sign in again with the box off
  assert.deepEqual(session.dump(), { [K]: 'S2' }); assert.deepEqual(local.dump(), {}, 'the trusted copy is removed');
  assert.equal(a.getItem(K), 'S2');

  a.removeItem(K);
  assert.deepEqual(local.dump(), {}); assert.deepEqual(session.dump(), {});
  assert.equal(a.getItem(K), null);
});

test('the adapter reads a session the dashboard saved in localStorage, and survives storage that throws or is missing', () => {
  const K = 'sb-abc-auth-token';
  assert.equal(CS.authStorage(fakeStorage({ [K]: 'D' }), fakeStorage(), () => true).getItem(K), 'D');
  const broken = CS.authStorage(fakeStorage({}, { throws: true }), fakeStorage({}, { throws: true }), () => true);
  assert.equal(broken.getItem(K), null);
  assert.doesNotThrow(() => { broken.setItem(K, 'x'); broken.removeItem(K); });
  const none = CS.authStorage(null, null, () => false);
  assert.equal(none.getItem(K), null);
  assert.doesNotThrow(() => { none.setItem(K, 'x'); none.removeItem(K); });
});

test('after a reload the trust choice is read back from where the session is saved', () => {
  assert.equal(CS.trustedFromStorage(fakeStorage({ 'sb-abc-auth-token': 'x' }), fakeStorage()), true);
  assert.equal(CS.trustedFromStorage(fakeStorage(), fakeStorage({ 'sb-abc-auth-token': 'x' })), false);
  assert.equal(CS.trustedFromStorage(fakeStorage(), fakeStorage({ other: 'x' })), true);
  assert.equal(CS.trustedFromStorage(null, null), true);
  assert.equal(CS.trustedFromStorage(fakeStorage(), fakeStorage({}, { throws: true })), true);
});

test('remembered name: the last handle comes back only while it is still in the list; storage that throws is ignored', () => {
  const local = fakeStorage(), list = [HONEY, LLOYD];
  assert.equal(CS.recalledName(local, list), null);
  CS.rememberName(local, HONEY.handle);
  assert.equal(CS.recalledName(local, list), HONEY.handle);
  assert.equal(CS.recalledName(local, [LLOYD]), null, 'a removed account is not preselected');
  CS.rememberName(local, ''); assert.equal(CS.recalledName(local, list), HONEY.handle, 'an empty handle changes nothing');
  const broken = fakeStorage({}, { throws: true });
  assert.doesNotThrow(() => CS.rememberName(broken, HONEY.handle));
  assert.equal(CS.recalledName(broken, list), null);
  assert.doesNotThrow(() => CS.rememberName(null, HONEY.handle));
});

const ORIGIN = 'https://cascadereservations-del.github.io';
test('door URL: same origin opens in the frame, another origin or scheme opens externally', () => {
  assert.equal(CS.doorTarget('https://cascadereservations-del.github.io/Cascade-Manual/', ORIGIN), 'frame');
  assert.equal(CS.doorTarget('https://cascadereservations-del.github.io/cascade-admin-dashboard/#/today', ORIGIN), 'frame');
  assert.equal(CS.doorTarget('https://other.example.com/inventory/', ORIGIN), 'external');
  assert.equal(CS.doorTarget('https://t.me/c/3798341977', ORIGIN), 'external');
  assert.equal(CS.doorTarget('http://cascadereservations-del.github.io/x/', ORIGIN), 'external', 'a different scheme is a different origin');
  assert.equal(CS.doorTarget('javascript:alert(1)', ORIGIN), 'external');
  assert.equal(CS.doorTarget('not a url at all', 'null'), 'external');
  assert.deepEqual(CS.doorLink('manual', 'https://cascadereservations-del.github.io/Cascade-Manual/', ORIGIN), { href: '#door/manual', external: false });
  assert.deepEqual(CS.doorLink('x', 'https://t.me/c/1', ORIGIN), { href: 'https://t.me/c/1', external: true });
});

test('app.js wiring: the three doors are same-origin (so they frame), the rows use the door key, the frame view exists', () => {
  const app = read('app.js'), html = read('index.html');
  const doors = [...app.matchAll(/(checklist|dashboard|manual): \{ title: '[^']+', url: LINKS\.(\w+) \}/g)];
  assert.deepEqual(doors.map((m) => m[1]), ['checklist', 'dashboard', 'manual']);
  for (const m of doors) {
    const url = app.match(new RegExp(m[2] + ": '([^']+)'"))[1];
    assert.equal(CS.doorTarget(url, ORIGIN), 'frame', m[1]);
  }
  assert.ok(!/href: LINKS\.(checklist|dashboard|manual), external: true/.test(app), 'no door row opens a new tab any more');
  for (const k of ['checklist', 'dashboard', 'manual']) assert.match(app, new RegExp("door: '" + k + "'"));
  assert.match(html, /id="door-frame"/); assert.match(html, /id="door-back"/);
  assert.match(app, /VIEWS = \[[^\]]*'door'/);
});

test('Theme v2: deep bronze action, Raleway and Style Script loaded, no Inter, no teal action colour', () => {
  const css = read('styles.css');
  assert.match(css, /--primary: #7A5A2B;/); assert.match(css, /--primary: #D7B377;/);
  assert.match(css, /--bg: #F9F6F0;/); assert.match(css, /--bg: #130E09;/);
  assert.match(css, /--font-ui: "Raleway"/); assert.match(css, /--font-script: "Style Script"/);
  assert.doesNotMatch(css, /--primary: #146C70|--primary: #63C5C7/);
  for (const f of ['index.html', 'pay/index.html', 'quick/index.html']) {
    const h = read(f);
    assert.match(h, /family=Raleway:wght@400;500;600;700&family=Cormorant\+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Style\+Script&display=swap/, f);
    assert.doesNotMatch(h, /family=Inter/, f);
  }
});
