/* Cascade Staff - QR Ph payload builder (Lane C, s81). Runs on the device: the static payout payload never leaves the phone
   screen it is shown on, is never stored, cached or logged. Pure functions, no DOM, no network, no storage.
   Static QR Ph (InstaPay P2P): tag 01 = 11, no tag 54. A payable QR is the same payload with tag 01 = 12 (dynamic), tag 54 = the
   amount (two decimals, no thousands separator) in EMV tag order, and tag 63 recomputed: CRC-16/CCITT-FALSE
   (poly 0x1021, init 0xFFFF, no reflection, no xor-out) over everything up to and including "6304". */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C_QrPh = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function C_crc16(s) {
    var c = 0xFFFF, i, j;
    for (i = 0; i < s.length; i++) {
      var b = s.charCodeAt(i);
      if (b > 0x7F) throw new Error('qrph: not ASCII');
      c ^= b << 8;
      for (j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return ('0000' + c.toString(16).toUpperCase()).slice(-4);
  }

  // Top-level TLV: [{id:'00', value:'01'}, ...]. Throws on any malformed length, so a corrupt payload is refused, never guessed at.
  function C_parse(s) {
    if (typeof s !== 'string' || s.length < 12 || s.length > 512) throw new Error('qrph: bad payload');
    var out = [], i = 0;
    while (i < s.length) {
      var id = s.substr(i, 2), ln = s.substr(i + 2, 2);
      if (!/^[0-9]{2}$/.test(id) || !/^[0-9]{2}$/.test(ln)) throw new Error('qrph: bad tag');
      var n = +ln, v = s.substr(i + 4, n);
      if (v.length !== n) throw new Error('qrph: short value');
      out.push({ id: id, value: v });
      i += 4 + n;
    }
    return out;
  }
  function C_serialize(tags) {
    return tags.map(function (t) { return t.id + ('0' + t.value.length).slice(-2) + t.value; }).join('');
  }

  // A payload is usable when it starts 000201, ends with a tag 63 whose CRC matches, and carries the QR Ph merchant tag 27.
  function C_validate(s) {
    var t = C_parse(s), last = t[t.length - 1];
    if (t[0].id !== '00' || t[0].value !== '01') throw new Error('qrph: not an EMV QR');
    if (last.id !== '63' || last.value.length !== 4) throw new Error('qrph: no CRC tag');
    if (C_crc16(s.slice(0, -4)) !== last.value.toUpperCase()) throw new Error('qrph: CRC does not match');
    return t;
  }

  function C_amountText(amount) {
    var a = Math.round(Number(amount) * 100) / 100;
    if (!(a > 0) || a > 9999999.99) throw new Error('qrph: bad amount');
    return a.toFixed(2);
  }

  // Static payload + amount -> payable payload. Tag 01 -> 12, tag 54 set (replacing any), tag 63 rebuilt.
  function C_withAmount(staticPayload, amount) {
    var tags = C_validate(staticPayload).filter(function (t) { return t.id !== '54' && t.id !== '63'; });
    var amt = C_amountText(amount);
    tags.forEach(function (t) { if (t.id === '01') t.value = '12'; });
    var at = tags.length;
    for (var i = 0; i < tags.length; i++) if (+tags[i].id > 54) { at = i; break; }
    tags.splice(at, 0, { id: '54', value: amt });
    var body = C_serialize(tags) + '6304';
    return body + C_crc16(body);
  }

  // What a scanner would read, for tests and for the screen's own self-check before a QR is shown.
  function C_decode(payload) {
    var t = C_validate(payload), m = {};
    t.forEach(function (x) { m[x.id] = x.value; });
    return { initiation: m['01'], amount: m['54'] == null ? null : m['54'], country: m['58'], currency: m['53'], crc: m['63'], tags: t.map(function (x) { return x.id; }) };
  }

  return { crc16: C_crc16, parse: C_parse, serialize: C_serialize, validate: C_validate, withAmount: C_withAmount, decode: C_decode, amountText: C_amountText };
});
