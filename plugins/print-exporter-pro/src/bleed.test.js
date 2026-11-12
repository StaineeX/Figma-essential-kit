const test = require('node:test');
const assert = require('node:assert/strict');
const { makePrintPdf, normalizeSettings } = require('./code.js');

const MM = 72 / 25.4;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} != ${b}`);

// Simula o Figma e grava cada camada criada na folha temporária.
function mockFigma() {
  const layers = [];
  const node = (extra) => ({
    ...extra,
    resize(w, h) { this.width = w; this.height = h; },
    rescale(s) { this.width *= s; this.height *= s; this.scale = (this.scale || 1) * s; },
    remove() { this.removed = true; },
  });
  let sheet;
  global.figma = {
    createFrame() {
      const created = node({
        type: 'FRAME',
        appendChild(child) { child.parent = this; layers.push(child); },
        exportAsync() { return new Uint8Array([1]); },
      });
      sheet = sheet || created; // o primeiro frame é a folha; os outros, molduras
      return created;
    },
    createRectangle() { return node({ type: 'RECTANGLE' }); },
  };
  // Converte posições de dentro das molduras para coordenadas da folha.
  const flatten = () => {
    for (const l of layers) {
      if (l.parent && l.parent !== sheet) { l.x += l.parent.x; l.y += l.parent.y; }
    }
  };
  return { layers, sheet: () => sheet, flatten };
}

function frame(width, height, extra = {}) {
  const clone = () => ({ width, height, rescale(s) { this.width *= s; this.height *= s; }, remove() {} });
  return { type: 'FRAME', width, height, fills: [], children: [], clone, rescale() {}, ...extra };
}

for (const [label, settings, w, h, expectW, expectH] of [
  ['mesmo do frame 5 mm (96 px/pol)', { pageSize: 'frame', bleed: 5 }, 610, 845, 610 * 0.75, 845 * 0.75],
  ['A4 3 mm', { pageSize: 'A4', bleed: 3 }, 210 * 2, 297 * 2, 210 * MM, 297 * MM],
  ['cartão deitado 2 mm', { pageSize: 'card', bleed: 2 }, 900, 500, 90 * MM, 50 * MM],
  ['personalizado 5 mm', { pageSize: 'custom', customWidth: 150, customHeight: 300, bleed: 5 }, 300, 600, 150 * MM, 300 * MM],
]) {
  test(`sangria cobre a área exata e marcas tocam o corte: ${label}`, async () => {
    const { layers, sheet, flatten } = mockFigma();
    const src = frame(w, h, { fills: [{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1 } }] });
    try {
      await makePrintPdf(src, normalizeSettings({ ...settings, cropMarks: true }));
    } finally { delete global.figma; }
  flatten();

    const bleed = settings.bleed * MM;
    const extra = 4.525 * MM;
    const margin = bleed + extra;
    close(sheet().width, expectW + 2 * margin, 'largura da folha');
    close(sheet().height, expectH + 2 * margin, 'altura da folha');

    const bg = layers.find((l) => l.name === 'Fundo estendido para sangria');
    assert.ok(bg, 'fundo estendido existe');
    close(bg.x, 0, 'fundo começa na borda da folha (x)');
    close(bg.y, 0, 'fundo começa na borda da folha (y)');
    close(bg.width, sheet().width, 'fundo cobre a folha inteira (largura)');
    close(bg.height, sheet().height, 'fundo cobre a folha inteira (altura)');
    assert.deepEqual(bg.fills[0].color, { r: 0, g: 0.5, b: 1 }, 'fundo usa a cor da prancheta');

    const art = layers.find((l) => !l.name);
    close(art.x, margin, 'arte posicionada no corte (x)');
    close(art.width, expectW, 'arte no tamanho final');

    // Marcas pretas: 8 traços, cada um com uma ponta exatamente na linha de corte.
    const marks = layers.filter((l) => l.name === 'Marca de corte');
    assert.equal(marks.length, 8);
    const trimX = [margin, margin + expectW];
    const trimY = [margin, margin + expectH];
    for (const m of marks) {
      const horizontal = m.width > m.height;
      if (horizontal) {
        assert.ok(trimX.some((x) => Math.abs(m.x - x) < 0.01 || Math.abs(m.x + m.width - x) < 0.01), 'traço horizontal encosta no corte');
        assert.ok(Math.abs(m.x) < 0.01 || Math.abs(m.x + m.width - sheet().width) < 0.01, 'traço vai até a borda da folha');
      } else {
        assert.ok(trimY.some((y) => Math.abs(m.y - y) < 0.01 || Math.abs(m.y + m.height - y) < 0.01), 'traço vertical encosta no corte');
        assert.ok(Math.abs(m.y) < 0.01 || Math.abs(m.y + m.height - sheet().height) < 0.01, 'traço vai até a borda da folha');
      }
    }
  });
}

test('fundo em imagem do frame também vai até a borda da folha', async () => {
  const { layers, flatten } = mockFigma();
  const image = { type: 'IMAGE', imageHash: 'abc', scaleMode: 'FILL' };
  try {
    await makePrintPdf(frame(794, 1123, { fills: [image] }), normalizeSettings({ pageSize: 'A4', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  flatten();
  const bg = layers.find((l) => l.name === 'Fundo estendido para sangria');
  assert.ok(bg, 'fundo estendido existe');
  assert.deepEqual(bg.fills, [image]);
  close(bg.width, 210 * MM + 2 * (5 + 4.525) * MM, 'A4 + sangria + área das marcas');
});

test('sangria espelhada: 8 molduras cobrem tudo fora do corte, sem ampliar a arte', async () => {
  const { layers, sheet, flatten } = mockFigma();
  try {
    await makePrintPdf(frame(1200, 400), normalizeSettings({ pageSize: 'frame', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  const mirrors = layers.filter((l) => l.name === 'Espelho');
  const clips = layers.filter((l) => l.name === 'Sangria espelhada');
  const leftClipX = Math.min(...clips.map((c) => c.x));
  flatten();
  assert.equal(clips.length, 8, '4 lados + 4 cantos');
  const W = sheet().width, H = sheet().height;
  const m = (5 + 4.525) * MM, w = 900, h = 300; // 1200 × 400 px a 96 px/pol
  const area = clips.reduce((sum, c) => sum + c.width * c.height, 0);
  close(area, W * H - w * h, 'molduras cobrem exatamente a folha fora do corte');
  for (const c of clips) assert.equal(c.clipsContent, true);
  for (const mir of mirrors) {
    const [[sx], [, sy]] = mir.relativeTransform;
    assert.ok(Math.abs(sx) === 1 && Math.abs(sy) === 1, 'espelho sem ampliar');
    assert.ok(sx === -1 || sy === -1, 'refletido em pelo menos um eixo');
  }
  // Lado esquerdo: espelho refletido exatamente na linha de corte (x = m).
  const left = mirrors.find((mir) => mir.relativeTransform[0][0] === -1 && mir.relativeTransform[1][1] === 1 && mir.parent.x === leftClipX);
  close(left.parent.x + left.relativeTransform[0][2], m, 'eixo do espelho = corte esquerdo');
});

test('elementos que passam da borda vão até a borda da folha', async () => {
  const { layers, sheet, flatten } = mockFigma();
  try {
    await makePrintPdf(frame(610, 845), normalizeSettings({ pageSize: 'frame', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  flatten();
  const bleed = 5 * MM;
  const extra = 4.525 * MM;
  const clip = layers.find((l) => l.name === 'Sangria');
  assert.equal(clip.clipsContent, true, 'moldura recorta');
  close(clip.x, 0, 'moldura começa na borda da folha');
  close(clip.width, sheet().width, 'moldura = folha inteira');
  const art = layers.find((l) => !l.name);
  assert.equal(art.parent, clip, 'arte dentro da moldura');
  assert.equal(art.clipsContent, false, 'arte não recorta mais no corte');
  assert.equal(sheet().clipsContent, false);
});

test('cópia do Bleed Pro é exportada como está, sem guias e na medida certa', async () => {
  const guides = { name: 'SANGRIA • NÃO EDITAR', visible: true };
  const calls = [];
  const copy = {
    type: 'FRAME', width: 960, height: 480, children: [guides],
    exportAsync(options) { calls.push({ options, guidesVisible: guides.visible }); return new Uint8Array([1]); },
  };
  const result = await makePrintPdf(copy, normalizeSettings({ bleed: 5, cropMarks: true }));
  assert.equal(result.raster, true);
  close(result.widthPt, 720, '960 px (96 px/pol) = 720 pt = 10 pol');
  assert.equal(calls[0].guidesVisible, false, 'guias escondidas na exportação');
  close(calls[0].options.constraint.value, 300 / 96, '300 dpi');
  assert.equal(guides.visible, true, 'guias voltam depois');
});

test('API printkit: lê ppi e nome das guias gravados pelo Bleed Pro', async () => {
  const guides = { name: 'GUIAS', visible: true };
  const calls = [];
  const sheetData = { version: 1, source: 'bleed-pro', ppi: 72, guides: 'GUIAS' };
  const copy = {
    type: 'FRAME', width: 720, height: 360, children: [guides],
    getSharedPluginData: (ns, key) => (ns === 'printkit' && key === 'sheet' ? JSON.stringify(sheetData) : ''),
    exportAsync(options) { calls.push(guides.visible); return new Uint8Array([1]); },
  };
  const result = await makePrintPdf(copy, normalizeSettings({}));
  close(result.widthPt, 720, 'ppi 72 do Bleed Pro: 720 px = 720 pt');
  assert.deepEqual(calls, [false], 'guias nomeadas pela API escondidas');
  assert.equal(guides.visible, true);
});

test('API printkit com corte: tira guias/marcas do Bleed Pro e põe as marcas do Exporter', async () => {
  const { layers, sheet } = mockFigma();
  const guides = { name: 'SANGRIA • NÃO EDITAR', visible: true };
  const bpMarks = { name: 'MARCAS DE CORTE • IMPRESSÃO', visible: true };
  const seen = [];
  const data = { version: 1, ppi: 96, guides: guides.name, marks: bpMarks.name, trim: { x: 40, y: 40, width: 400, height: 600 } };
  const copy = {
    type: 'FRAME', width: 480, height: 680, children: [guides, bpMarks],
    getSharedPluginData: () => JSON.stringify(data),
    clone() { seen.push([guides.visible, bpMarks.visible]); return { rescale() {}, remove() {} }; },
  };
  try {
    await makePrintPdf(copy, normalizeSettings({}));
  } finally { delete global.figma; }
  assert.deepEqual(seen, [[false, false]], 'guias e marcas do Bleed Pro escondidas na exportação');
  assert.equal(guides.visible && bpMarks.visible, true, 'voltam depois');
  close(sheet().width, 360, '480 px a 96 px/pol = 360 pt');
  const marks = layers.filter((l) => l.name === 'Marca de corte');
  assert.equal(marks.length, 8);
  const x0 = 30, x1 = 330; // corte em pt
  for (const m of marks.filter((l) => l.width > l.height)) {
    assert.ok([x0, x1].some((x) => Math.abs(m.x - x) < 0.01 || Math.abs(m.x + m.width - x) < 0.01), 'encosta no corte');
  }
});

test('A5: área útil 148 × 210 mm e sangria de 5 mm por fora; marcas só pretas', async () => {
  const { layers, sheet, flatten } = mockFigma();
  const pxPerMm = 96 / 25.4;
  try {
    await makePrintPdf(frame(148 * pxPerMm, 210 * pxPerMm), normalizeSettings({ pageSize: 'A5', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  flatten();
  const extra = 4.525 * MM;
  const art = layers.find((l) => !l.name);
  close(art.width / MM, 148, 'largura útil A5 (mm)');
  close(art.height / MM, 210, 'altura útil A5 (mm)');
  close((art.x - extra) / MM, 5, 'sangria de 5 mm à esquerda, fora da área útil');
  close((sheet().width - extra - (art.x + art.width)) / MM, 5, 'sangria de 5 mm à direita, fora da área útil');
  const marks = layers.filter((l) => /Marca de corte/.test(l.name || ''));
  assert.equal(marks.length, 8, 'só as 8 marcas pretas, sem contorno branco');
  for (const m of marks) assert.deepEqual(m.fills[0].color, { r: 0, g: 0, b: 0 });
});

test('espelho leva só camadas que encostam na borda: logo/texto perto da borda ficam fora', async () => {
  const { layers } = mockFigma();
  const kids = () => {
    const list = [
      { name: 'fundo', x: 0, y: 0, width: 1200, height: 400 },
      { name: 'onda', x: 0, y: 340, width: 1200, height: 60 },
      { name: 'logo', x: 20, y: 100, width: 80, height: 200 },
    ];
    return list.map((k) => ({ ...k, remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); } }));
  };
  const clone = () => {
    const c = { width: 1200, height: 400, rescale(s) { this.width *= s; this.height *= s; for (const k of this.children) { k.x *= s; k.y *= s; k.width *= s; k.height *= s; } }, remove() {} };
    c.children = kids().map((k) => Object.assign(k, { parent: c }));
    return c;
  };
  try {
    await makePrintPdf({ type: 'FRAME', width: 1200, height: 400, fills: [], children: [], clone, rescale() {} },
      normalizeSettings({ pageSize: 'frame', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  const mirrors = layers.filter((l) => l.name === 'Espelho');
  const names = (t) => mirrors.find((m) => m.relativeTransform[0][0] === t[0] && m.relativeTransform[1][1] === t[1] && t[2](m.parent)).children.map((k) => k.name);
  const minX = Math.min(...mirrors.map((m) => m.parent.x));
  const minY = Math.min(...mirrors.map((m) => m.parent.y));
  const maxY = Math.max(...mirrors.map((m) => m.parent.y));
  assert.deepEqual(names([-1, 1, (p) => p.x === minX]), ['fundo', 'onda'], 'esquerda: sem o logo');
  assert.deepEqual(names([1, -1, (p) => p.y === minY]), ['fundo'], 'topo: só o fundo');
  assert.deepEqual(names([1, -1, (p) => p.y === maxY]), ['fundo', 'onda'], 'base: fundo e onda');
});
