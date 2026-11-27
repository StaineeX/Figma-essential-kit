// QR Code Nativo — gera QR code com formas nativas do Figma (sem SVG).
// Encoder: modo byte (UTF-8), versões 1–40, máscara escolhida por penalidade.

const QR = (() => {
  const ECL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };
  const ECL_FORMAT = { L: 1, M: 0, Q: 3, H: 2 };
  const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (ver, e) =>
    Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(deg) {
    const r = new Array(deg).fill(0);
    r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < deg) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => (r[i] ^= gfMul(c, f)));
    }
    return r;
  }

  function encode(text, ecl = 'M') {
    const e = ECL_INDEX[ecl];
    const bytes = Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));

    let ver = 1, capBits = 0;
    for (; ver <= 40; ver++) {
      capBits = dataCodewords(ver, e) * 8;
      if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= capBits) break;
    }
    if (ver > 40) throw new Error('Texto longo demais para um QR code.');

    // Bits de dados
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // ECC + intercalação
    const numBlocks = NUM_BLOCKS[e][ver];
    const eccLen = ECC_PER_BLOCK[e][ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const numShort = numBlocks - (raw % numBlocks);
    const shortLen = Math.floor(raw / numBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++)
      blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]); });

    // Matriz
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
        }
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2;
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++)
              setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }

    const drawFormat = (mask) => {
      const d = (ECL_FORMAT[ecl] << 3) | mask;
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
      setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
      setF(8, size - 8, true);
    };
    drawFormat(0);

    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3), c = Math.floor(i / 3);
        setF(a, c, bit(b, i)); setF(c, a, bit(b, i));
      }
    }

    for (let i = 0, right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
          if (!fn[y][x] && i < codewords.length * 8) {
            m[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
    }

    const MASKS = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (k) => {
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++)
          if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x];
    };
    const penalty = () => {
      let p = 0, dark = 0;
      const lines = [];
      for (let i = 0; i < size; i++) {
        lines.push(m[i].map(Number).join(''));
        lines.push(m.map((r) => Number(r[i])).join(''));
      }
      for (const l of lines) {
        for (const run of l.match(/0{5,}|1{5,}/g) || []) p += run.length - 2;
        p += 40 * ((l.match(/(?=10111010000|00001011101)/g) || []).length);
      }
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          if (m[y][x]) dark++;
          if (x < size - 1 && y < size - 1 &&
              m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
        }
      const total = size * size;
      return p + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    };

    let best = 0, bestP = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(k); drawFormat(k);
      const p = penalty();
      if (p < bestP) { bestP = p; best = k; }
      applyMask(k);
    }
    applyMask(best); drawFormat(best);
    return m;
  }

  return { encode };
})();

if (typeof module !== 'undefined') module.exports = QR;

// ---------------- Plugin Figma ----------------

if (typeof figma !== 'undefined') {
  figma.showUI(__html__, { width: 300, height: 400 });

  const hex = (h) => {
    const n = parseInt(h.replace('#', ''), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  };
  const QUIET = 4;

  function build({ text, style, size, fg, bg, ecl }) {
    const matrix = QR.encode(text, ecl);
    const n = matrix.length;
    const u = size / (n + QUIET * 2); // tamanho de um módulo
    const fill = [{ type: 'SOLID', color: hex(fg) }];

    const frame = figma.createFrame();
    frame.name = 'QR Code — ' + style;
    frame.resize(size, size);
    frame.fills = bg ? [{ type: 'SOLID', color: hex(bg) }] : [];

    const shapes = [];
    const rect = (x, y, w, h, radius) => {
      const r = figma.createRectangle();
      r.resize(w, h);
      r.x = x; r.y = y;
      r.cornerRadius = radius;
      r.fills = fill;
      frame.appendChild(r);
      shapes.push(r);
      return r;
    };
    const px = (i) => (i + QUIET) * u;

    // Olhos (padrões localizadores) — desenhados à parte nos estilos não quadrados
    const eyes = [[0, 0], [n - 7, 0], [0, n - 7]];
    const inEye = (x, y) => eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7);
    if (style !== 'quadrado') {
      const [outerR, innerR] = style === 'pontos' ? [u * 2.5, u * 1.5] : [u * 1.75, u * 0.9];
      for (const [ex, ey] of eyes) {
        const outer = rect(px(ex), px(ey), 7 * u, 7 * u, outerR);
        const hole = rect(px(ex + 1), px(ey + 1), 5 * u, 5 * u, Math.max(outerR - u, 0));
        shapes.splice(shapes.indexOf(outer), 2);
        shapes.push(figma.subtract([outer, hole], frame));
        rect(px(ex + 2), px(ey + 2), 3 * u, 3 * u, innerR);
      }
    }

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!matrix[y][x] || (style !== 'quadrado' && inEye(x, y))) continue;
        if (style === 'quadrado') {
          // Junta módulos escuros vizinhos na linha em um retângulo só
          let run = 1;
          while (x + run < n && matrix[y][x + run]) run++;
          rect(px(x), px(y), run * u, u, 0);
          x += run - 1;
        } else if (style === 'pontos') {
          const d = u * 0.9;
          const c = figma.createEllipse();
          c.resize(d, d);
          c.x = px(x) + (u - d) / 2; c.y = px(y) + (u - d) / 2;
          c.fills = fill;
          frame.appendChild(c);
          shapes.push(c);
        } else {
          rect(px(x), px(y), u, u, u * 0.35);
        }
      }
    }

    figma.group(shapes, frame).name = 'Módulos';
    const c = figma.viewport.center;
    frame.x = Math.round(c.x - size / 2);
    frame.y = Math.round(c.y - size / 2);
    figma.currentPage.appendChild(frame);
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);
    return n;
  }

  figma.ui.onmessage = (msg) => {
    if (msg.type !== 'create') return;
    if (!msg.text) return figma.notify('Digite um texto ou URL.', { error: true });
    try {
      const n = build(msg);
      figma.notify(`QR code criado (${n}×${n} módulos).`);
    } catch (err) {
      figma.notify(err.message, { error: true });
    }
  };
}
