// Cross-check of pay/C_qr.js against the independent npm "qrcode" 1.5.4 module (the one the Edge Functions already use).
// Run by hand, not by `node --test` (it needs deno and the module in deno's cache):
//   deno run --cached-only -A tests/C_qr-crosscheck.deno.ts
// For every payload length 1..N it builds the symbol with C_qr (level M), then asks "qrcode" (forced byte mode, which C_qr always uses) for the SAME version, level and mask and
// requires every module to be identical. It also reports how often the automatic mask choice agrees with the library.
// @ts-ignore esm build, same URL as supabase/functions/_shared/cascade-core/qrph.ts
import QRCode from 'https://esm.sh/qrcode@1.5.4?target=denonext';
import { createRequire } from 'node:module';

const Q = createRequire(import.meta.url)('../pay/C_qr.js');
const MAX = Number(Deno.args[0] ?? 520);
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
let same = 0, maskAgree = 0, versions = new Set<number>();
for (let n = 1; n <= MAX; n++) {
  let t = '';
  for (let i = 0; i < n; i++) t += String.fromCharCode(32 + (rnd() % 95)); // printable ASCII, like a QR Ph payload
  const m = Q.matrix(t);
  const lib = QRCode.create([{ data: t, mode: 'byte' }], { errorCorrectionLevel: 'M', maskPattern: m.mask });
  if (lib.version !== m.version || lib.modules.size !== m.size) throw new Error(`length ${n}: version ${m.version} vs ${lib.version}`);
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
    if (m.get(x, y) !== (lib.modules.get(y, x) === 1)) throw new Error(`length ${n}: module ${x},${y} differs`);
  }
  same++; versions.add(m.version);
  if (QRCode.create([{ data: t, mode: 'byte' }], { errorCorrectionLevel: 'M' }).maskPattern === m.mask) maskAgree++;
}
console.log(`C_qr matches qrcode 1.5.4 module for module: ${same} payloads (lengths 1..${MAX}), versions ${Math.min(...versions)}..${Math.max(...versions)}; automatic mask equal in ${maskAgree}`);
