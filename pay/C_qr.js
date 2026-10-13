/* Cascade Staff - QR encoder (Lane C, s81). Own implementation, written for this app: byte mode, error correction M, versions 1 to 40,
   automatic mask choice. No dependency, no network. The algorithm follows ISO/IEC 18004; the tables are the standard ones for level M.
   Verified against the independent npm "qrcode" 1.5.4 module: tests/C_qr-crosscheck.deno.ts compares the module matrix for every length.
   C_QR.matrix(text) -> { size, version, mask, get(x, y) }   C_QR.svg(m, opts) -> SVG markup   C_QR.paint(canvas, m, px, quiet) */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.C_QR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // level M, index = version (1..40)
  var ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  var FORMAT_BITS_M = 0;

  function C_alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var r = [6];
    for (var pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }
  function C_rawModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      result -= (25 * na - 10) * na - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function C_dataCodewords(ver) { return Math.floor(C_rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]; }

  // GF(256) with 0x11D
  function C_gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 255; }
  function C_rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (var i2 = 0; i2 < deg; i2++) {
      for (var j = 0; j < r.length; j++) { r[j] = C_gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = C_gfMul(root, 2);
    }
    return r;
  }
  function C_rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= C_gfMul(c, f); });
    });
    return r;
  }

  function C_utf8(text) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(text));
    var s = unescape(encodeURIComponent(text)), o = []; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i)); return o;
  }

  function C_codewords(bytes, ver) {
    var bits = [];
    function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = C_dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var data = []; for (var i = 0; i < bits.length; i += 8) { var v = 0; for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; data.push(v); }
    // split into blocks, append ECC, interleave
    var nb = NUM_BLOCKS[ver], eb = ECC_PER_BLOCK[ver], raw = Math.floor(C_rawModules(ver) / 8);
    var shortLen = Math.floor(raw / nb) - eb, numShort = nb - raw % nb, div = C_rsDivisor(eb), blocks = [], k2 = 0;
    for (var b = 0; b < nb; b++) {
      var len = shortLen + (b < numShort ? 0 : 1), d = data.slice(k2, k2 + len); k2 += len;
      var ecc = C_rsRemainder(d, div);
      if (b < numShort) d.push(0); // placeholder so data columns line up
      blocks.push(d.concat(ecc));
    }
    var out = [];
    for (var col = 0; col < blocks[0].length; col++) {
      blocks.forEach(function (blk, bi) { if (col !== shortLen || bi >= numShort) out.push(blk[col]); });
    }
    return out;
  }

  function C_build(bytes, ver, maskForced) {
    var size = ver * 4 + 17, mod = [], fn = [], i, j;
    for (i = 0; i < size; i++) { mod.push(new Uint8Array(size)); fn.push(new Uint8Array(size)); }
    function setF(x, y, d) { mod[y][x] = d ? 1 : 0; fn[y][x] = 1; }
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = C_alignPositions(ver), na = ap.length;
    for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    function drawFormat(mask) {
      var data = (FORMAT_BITS_M << 3) | mask, rem = data;
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412, bit = function (n) { return ((bits >>> n) & 1) !== 0; }, n;
      for (n = 0; n <= 5; n++) setF(8, n, bit(n));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (n = 9; n < 15; n++) setF(14 - n, 8, bit(n));
      for (n = 0; n < 8; n++) setF(size - 1 - n, 8, bit(n));
      for (n = 8; n < 15; n++) setF(8, size - 15 + n, bit(n));
      setF(8, size - 8, true);
    }
    drawFormat(0); // reserve
    if (ver >= 7) {
      var rem = ver; for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bt = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, b2 = Math.floor(i / 3);
        setF(a, b2, bt); setF(b2, a, bt);
      }
    }
    // data placement
    var cw = C_codewords(bytes, ver), k = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && k < cw.length * 8) { mod[y][x] = (cw[k >>> 3] >>> (7 - (k & 7))) & 1; k++; }
      }
    }
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break; default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) mod[y][x] ^= 1;
      }
    }
    function penalty() {
      var res = 0, y, x, run, c;
      function lineScore(get) {
        var s = 0, n, r = 1, p = get(0);
        for (n = 1; n < size; n++) { var v = get(n); if (v === p) { r++; if (r === 5) s += 3; else if (r > 5) s++; } else { r = 1; p = v; } }
        return s;
      }
      for (y = 0; y < size; y++) res += lineScore(function (n) { return mod[y][n]; });
      for (x = 0; x < size; x++) res += lineScore(function (n) { return mod[n][x]; });
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) res += 3; }
      var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      function hits(get) {
        var s = 0; for (var st = 0; st + 11 <= size; st++) {
          var a = true, b = true; for (var t = 0; t < 11; t++) { var v = get(st + t); if (v !== pat1[t]) a = false; if (v !== pat2[t]) b = false; }
          if (a) s += 40; if (b) s += 40;
        } return s;
      }
      for (y = 0; y < size; y++) res += hits(function (n) { return mod[y][n]; });
      for (x = 0; x < size; x++) res += hits(function (n) { return mod[n][x]; });
      var dark = 0; for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += mod[y][x];
      var pct = dark * 100 / (size * size);
      res += Math.floor(Math.abs(pct - 50) / 5) * 10;
      return res;
    }
    var best = maskForced == null ? 0 : maskForced, bestPen = Infinity;
    if (maskForced == null) {
      for (var m = 0; m < 8; m++) { applyMask(m); drawFormat(m); var p = penalty(); if (p < bestPen) { best = m; bestPen = p; } applyMask(m); }
    }
    applyMask(best); drawFormat(best);
    return { size: size, version: ver, mask: best, get: function (x, y) { return x >= 0 && y >= 0 && x < size && y < size && mod[y][x] === 1; }, isFunction: function (x, y) { return fn[y][x] === 1; } };
  }

  // The smallest version that holds the text at level M. Throws for text that does not fit (a payout payload is far below the limit).
  function C_matrix(text, maskForced) {
    var bytes = C_utf8(String(text));
    for (var ver = 1; ver <= 40; ver++) {
      var need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= C_dataCodewords(ver) * 8) return C_build(bytes, ver, maskForced);
    }
    throw new Error('qr: text too long');
  }

  // Dark modules as one SVG path: crisp at any size, small, no raster. quiet = blank modules around the code (4 per the standard).
  function C_svg(m, o) {
    o = o || {}; var q = o.quiet == null ? 4 : o.quiet, n = m.size + 2 * q, d = '', x, y;
    for (y = 0; y < m.size; y++) for (x = 0; x < m.size; x++) if (m.get(x, y)) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' + (o.label || 'QR code') + '">' +
      '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  function C_paint(canvas, m, px, quiet) {
    var q = quiet == null ? 4 : quiet, n = m.size + 2 * q, ctx = canvas.getContext('2d');
    canvas.width = canvas.height = n * px;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
    for (var y = 0; y < m.size; y++) for (var x = 0; x < m.size; x++) if (m.get(x, y)) ctx.fillRect((x + q) * px, (y + q) * px, px, px);
  }

  return { matrix: C_matrix, svg: C_svg, paint: C_paint, dataCodewords: C_dataCodewords };
});
