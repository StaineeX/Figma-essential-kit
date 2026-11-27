// Teste do encoder: gera QR, rasteriza e decodifica com jsQR.
// Uso: node test.js <pasta com node_modules/jsqr>
const path = require('path');
const jsQR = require(path.join(process.argv[2], 'node_modules', 'jsqr'));
const QR = require('./code.js');

function decode(m) {
  const S = 4, Q = 4, n = m.length, w = (n + Q * 2) * S;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const my = Math.floor(y / S) - Q, mx = Math.floor(x / S) - Q;
      if (my >= 0 && my < n && mx >= 0 && mx < n && m[my][mx]) px.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    }
  const r = jsQR(px, w, w);
  return r && r.data;
}

let fail = 0, versions = new Set();
const cases = ['a', 'https://figma.com', 'Olá, ação ✓ 😀', 'x'.repeat(100), 'y'.repeat(400), 'z'.repeat(1200), 'w'.repeat(2300)];
for (const t of cases)
  for (const e of ['L', 'M', 'Q', 'H']) {
    let m;
    try { m = QR.encode(t, e); } catch (err) { console.log('skip', e, t.length, err.message); continue; }
    versions.add((m.length - 17) / 4);
    const got = decode(m);
    if (got !== t) { fail++; console.log('FAIL', e, t.slice(0, 20), 'len', t.length, 'ver', (m.length - 17) / 4); }
  }
console.log('versões testadas:', [...versions].sort((a, b) => a - b).join(','));
console.log(fail ? `${fail} falhas` : 'OK');
process.exit(fail ? 1 : 0);
