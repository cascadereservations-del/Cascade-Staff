// Lane C: the payout QR is built on the device. Every payload here is SYNTHETIC (built below, "ZZ" account): no real QR Ph string
// exists in this repo. Frozen inputs only; nothing reads a clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const Q = req('../pay/C_qrph.js');
const QR = req('../pay/C_qr.js');

const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
function staticPayload(extra) { // tag 27 = QR Ph merchant account (com.p2pqrpay), no amount, tag 01 = 11
  const m27 = tlv('00', 'com.p2pqrpay') + tlv('01', 'ZZTESTPHZZZ') + tlv('02', '99964403') + tlv('03', '9990000111122223');
  const body = tlv('00', '01') + tlv('01', '11') + tlv('27', m27) + tlv('52', '6016') + tlv('53', '608') + (extra || '') + tlv('58', 'PH') + tlv('59', 'ZZ TEST PAYEE') + tlv('60', 'TESTCITY') + '6304';
  return body + Q.crc16(body);
}

test('CRC-16/CCITT-FALSE known vector: "123456789" is 29B1', () => {
  assert.equal(Q.crc16('123456789'), '29B1');
  assert.equal(Q.crc16(''), 'FFFF');
});

test('round trip: a synthetic static payload parses, its CRC recomputes to the original, and it re-serialises byte for byte', () => {
  const s = staticPayload();
  const tags = Q.validate(s); // throws on a bad CRC
  assert.equal(tags[tags.length - 1].value, s.slice(-4));
  assert.equal(Q.crc16(s.slice(0, -4)), s.slice(-4));
  assert.equal(Q.serialize(Q.parse(s)), s);
  assert.deepEqual(tags.map((t) => t.id), ['00', '01', '27', '52', '53', '58', '59', '60', '63']);
  assert.ok(s.includes('ZZTESTPHZZZ') && s.includes('ZZ TEST PAYEE'), 'the fixture is synthetic');
});

test('withAmount: tag 01 becomes 12, tag 54 carries the amount in tag order, the CRC is valid', () => {
  const d = Q.withAmount(staticPayload(), 1235);
  const dec = Q.decode(d); // decode validates the CRC
  assert.equal(dec.initiation, '12');
  assert.equal(dec.amount, '1235.00');
  assert.deepEqual(dec.tags, ['00', '01', '27', '52', '53', '54', '58', '59', '60', '63']);
  assert.equal(d.slice(-8, -4), '6304');
  assert.equal(Q.crc16(d.slice(0, -4)), d.slice(-4));
  assert.equal(Q.decode(staticPayload()).initiation, '11');
  assert.equal(Q.decode(staticPayload()).amount, null, 'the static payload has no amount');
});

test('amount text: two decimals, no thousands separator, rounded to the centavo; bad amounts refused', () => {
  assert.equal(Q.amountText(1235), '1235.00');
  assert.equal(Q.amountText(1234567.5), '1234567.50');
  assert.equal(Q.amountText(0.1 + 0.2), '0.30');
  assert.equal(Q.amountText('40'), '40.00');
  for (const bad of [0, -5, NaN, Infinity, 'x', null, 10000000]) assert.throws(() => Q.amountText(bad), /bad amount/);
});

test('an amount already in the static payload is replaced, never doubled', () => {
  const withOld = staticPayload(tlv('54', '5.00'));
  const dec = Q.decode(Q.withAmount(withOld, 250.5));
  assert.equal(dec.amount, '250.50');
  assert.equal(dec.tags.filter((t) => t === '54').length, 1);
});

test('a corrupt or truncated payload is refused, never guessed at', () => {
  const s = staticPayload();
  const flipped = s.slice(0, 20) + (s[20] === 'A' ? 'B' : 'A') + s.slice(21);
  assert.throws(() => Q.withAmount(flipped, 100), /CRC/);
  assert.throws(() => Q.withAmount(s.slice(0, -2), 100));
  assert.throws(() => Q.withAmount('', 100));
  assert.throws(() => Q.withAmount(null, 100));
  assert.throws(() => Q.withAmount('x'.repeat(600), 100));
  assert.throws(() => Q.withAmount(s.replace(/^000201/, '000202'), 100), /not an EMV/);
});

// ---- a small decoder, written separately from the encoder's placement code: it reads the matrix the way a scanner does
function decodeMatrix(m) {
  const size = m.size, ver = m.version, mod = (x, y) => (m.get(x, y) ? 1 : 0);
  // format info: read the 15 bits around the top-left finder and match the mask
  let fmt = 0; for (let n = 0; n <= 5; n++) fmt |= mod(8, n) << n; fmt |= mod(8, 7) << 6; fmt |= mod(8, 8) << 7; fmt |= mod(7, 8) << 8;
  for (let n = 9; n < 15; n++) fmt |= mod(14 - n, 8) << n;
  const word = (fmt ^ 0x5412), level = word >> 13, mask = (word >> 10) & 7;
  assert.equal(level, 0, 'error correction level M');
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (m.isFunction(x, y)) continue;
      const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        x * y % 2 + x * y % 3 === 0, (x * y % 2 + x * y % 3) % 2 === 0, ((x + y) % 2 + x * y % 3) % 2 === 0][mask];
      bits.push(mod(x, y) ^ (inv ? 1 : 0));
    }
  }
  const cw = []; for (let i = 0; i + 8 <= bits.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; cw.push(v); }
  // de-interleave using the standard block layout for level M
  const EC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26], NB = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13];
  const raw = Math.floor(((16 * ver + 128) * ver + 64 - (ver >= 2 ? (25 * (Math.floor(ver / 7) + 2) - 10) * (Math.floor(ver / 7) + 2) - 55 : 0) - (ver >= 7 ? 36 : 0)) / 8);
  const nb = NB[ver], eb = EC[ver], shortLen = Math.floor(raw / nb) - eb, numShort = nb - raw % nb;
  const blocks = Array.from({ length: nb }, (_, b) => ({ data: [], ecc: [], len: shortLen + (b < numShort ? 0 : 1) }));
  let p = 0;
  for (let i = 0; i < shortLen + 1; i++) blocks.forEach((b) => { if (i < b.len) b.data.push(cw[p++]); });
  for (let i = 0; i < eb; i++) blocks.forEach((b) => { b.ecc.push(cw[p++]); });
  // Reed-Solomon check with an independent GF(256) (log tables): every syndrome of data+ecc must be zero
  const exp = new Array(512), log = new Array(256); let x = 1; for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  blocks.forEach((b) => {
    const word2 = b.data.concat(b.ecc);
    for (let s = 0; s < eb; s++) { let acc = 0; for (const c of word2) acc = (c === 0 ? 0 : (acc === 0 ? 0 : exp[log[acc] + s])) ^ c; assert.equal(acc, 0, 'RS syndrome ' + s); }
  });
  const data = blocks.flatMap((b) => b.data);
  const bs = data.flatMap((v) => Array.from({ length: 8 }, (_, k) => (v >> (7 - k)) & 1));
  const rd = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bs.shift(); return v; };
  assert.equal(rd(4), 4, 'byte mode'); const len = rd(ver < 10 ? 8 : 16);
  return Buffer.from(Array.from({ length: len }, () => rd(8))).toString('utf8');
}

test('the encoded QR decodes back to the payload (format bits, mask, de-interleave, Reed-Solomon, byte mode)', () => {
  const pay = Q.withAmount(staticPayload(), 1235);
  const m = QR.matrix(pay);
  assert.equal(decodeMatrix(m), pay);
  assert.ok(m.version >= 5 && m.version <= 10, 'a payout payload is a mid-size symbol');
  for (const t of ['A', 'hello world 12345', 'x'.repeat(200), 'Pesos ₱1,235 and ñ']) assert.equal(decodeMatrix(QR.matrix(t)), t);
});

test('known vector: version 1 level M "HELLO WORLD" as bytes has the three finder patterns and the dark module', () => {
  const m = QR.matrix('HELLO WORLD'); // 11 bytes, version 1 (17 byte capacity at M)
  assert.equal(m.version, 1); assert.equal(m.size, 21);
  for (const [cx, cy] of [[3, 3], [17, 3], [3, 17]]) {
    assert.equal(m.get(cx, cy), true); assert.equal(m.get(cx + 2, cy), false); assert.equal(m.get(cx + 3, cy), true);
  }
  assert.equal(m.get(8, 13), true, 'the always-dark module');
  assert.throws(() => QR.matrix('x'.repeat(3000)), /too long/);
});

test('svg: one path, a quiet zone of 4 modules, no external reference', () => {
  const svg = QR.svg(QR.matrix('abc'), { label: 'Pay QR' });
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.match(svg, /aria-label="Pay QR"/);
  assert.doesNotMatch(svg, /href|http:\/\/(?!www\.w3\.org)|<script|<image/);
});
