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
  const art = { width, height, rescale(s) { this.width *= s; this.height *= s; }, remove() {} };
  return { type: 'FRAME', width, height, fills: [], children: [], clone: () => art, ...extra };
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
    close(bg.x, extra, 'fundo começa na linha da sangria (x)');
    close(bg.y, extra, 'fundo começa na linha da sangria (y)');
    close(bg.width, expectW + 2 * bleed, 'fundo cobre largura + 2 sangrias');
    close(bg.height, expectH + 2 * bleed, 'fundo cobre altura + 2 sangrias');
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

test('fundo em imagem do frame também é estendido até a sangria', async () => {
  const { layers, flatten } = mockFigma();
  const image = { type: 'IMAGE', imageHash: 'abc', scaleMode: 'FILL' };
  try {
    await makePrintPdf(frame(794, 1123, { fills: [image] }), normalizeSettings({ pageSize: 'A4', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  flatten();
  const bg = layers.find((l) => l.name === 'Fundo estendido para sangria');
  assert.ok(bg, 'fundo estendido existe');
  assert.deepEqual(bg.fills, [image]);
  close(bg.width, 210 * MM + 10 * MM, 'A4 + 5 mm de cada lado');
});

test('sem cor de fundo, estende a camada mais de baixo cobrindo toda a sangria', async () => {
  const { layers, flatten } = mockFigma();
  const photo = { name: 'foto', type: 'RECTANGLE', x: 50, y: 50, width: 400, height: 300, visible: true, rescale() {} };
  photo.clone = () => ({ ...photo, name: undefined, rescale(s) { this.width *= s; this.height *= s; } });
  const src = frame(610, 845, { children: [photo] });
  try {
    await makePrintPdf(src, normalizeSettings({ pageSize: 'frame', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  flatten();
  const bleed = 5 * MM;
  const extra = 4.525 * MM;
  const bg = layers.find((l) => l.name === 'Fundo estendido para sangria');
  assert.ok(bg, 'fundo estendido existe');
  assert.ok(bg.x <= extra + 0.01 && bg.y <= extra + 0.01, 'cobre o canto superior esquerdo da sangria');
  assert.ok(bg.x + bg.width >= extra + 610 * 0.75 + 2 * bleed - 0.01, 'cobre a sangria direita');
  assert.ok(bg.y + bg.height >= extra + 845 * 0.75 + 2 * bleed - 0.01, 'cobre a sangria inferior');
});

test('elementos que passam da borda entram na sangria; recorte fica no limite da sangria', async () => {
  const { layers, sheet, flatten } = mockFigma();
  try {
    await makePrintPdf(frame(610, 845), normalizeSettings({ pageSize: 'frame', bleed: 5, cropMarks: true }));
  } finally { delete global.figma; }
  flatten();
  const bleed = 5 * MM;
  const extra = 4.525 * MM;
  const clip = layers.find((l) => l.name === 'Sangria');
  assert.equal(clip.clipsContent, true, 'moldura recorta');
  close(clip.x, extra, 'moldura começa na linha da sangria');
  close(clip.width, 610 * 0.75 + 2 * bleed, 'moldura = tamanho final + 2 sangrias');
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
