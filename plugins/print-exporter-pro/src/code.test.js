const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectTopLevelFrames,
  exportPlannedFrames,
  makePrintPdf,
  printGeometry,
  cropMarkSegments,
  normalizeSettings,
  planExports,
  safeFileName,
  validateSettings,
} = require('./code.js');

test('rejects export with no frames', () => {
  const errors = validateSettings(normalizeSettings({}), 0);

  assert.deepEqual(errors, ['Selecione pelo menos um frame para exportar.']);
});

test('rejects non-numeric and negative bleed', () => {
  assert.deepEqual(
    validateSettings(normalizeSettings({ bleed: 'abc' }), 1),
    ['O bleed precisa ser um número maior ou igual a zero.'],
  );
  assert.deepEqual(
    validateSettings(normalizeSettings({ bleed: -1 }), 1),
    ['O bleed precisa ser um número maior ou igual a zero.'],
  );
});

test('keeps only top-level exportable frames for the page scope', () => {
  const page = { type: 'PAGE' };
  const nested = { id: 'nested', type: 'FRAME', name: 'Nested', parent: { type: 'FRAME' } };
  const topLevel = { id: 'top', type: 'FRAME', name: 'Top', parent: page };
  const component = { id: 'component', type: 'COMPONENT', name: 'Component', parent: page };
  const rectangle = { id: 'rectangle', type: 'RECTANGLE', name: 'Not exportable', parent: page };

  assert.deepEqual(collectTopLevelFrames([nested, topLevel, component, rectangle]), [topLevel, component]);
});

test('creates safe deterministic file names', () => {
  assert.equal(safeFileName('Capa: frente / final?', 0), 'Capa-frente-final');
  assert.equal(safeFileName('   ', 2), 'frame-3');
});

test('plans one pdf per frame in stable order', () => {
  const nodes = [
    { id: 'a', type: 'FRAME', name: 'Capa A' },
    { id: 'b', type: 'FRAME', name: 'Capa B' },
  ];

  assert.deepEqual(planExports(nodes, normalizeSettings({ colorMode: 'RGB', bleed: 4 })), [
    { nodeId: 'a', fileName: 'Capa A.pdf', colorMode: 'RGB', bleed: 4, cropMarks: true },
    { nodeId: 'b', fileName: 'Capa B.pdf', colorMode: 'RGB', bleed: 4, cropMarks: true },
  ]);
});

test('adds a numeric suffix when frame names repeat', () => {
  const nodes = [
    { id: 'a', type: 'FRAME', name: 'FIGAI Prancheta' },
    { id: 'b', type: 'FRAME', name: 'FIGAI Prancheta' },
    { id: 'c', type: 'FRAME', name: 'FIGAI Prancheta' },
  ];

  assert.deepEqual(
    planExports(nodes, normalizeSettings({})).map((item) => item.fileName),
    ['FIGAI Prancheta.pdf', 'FIGAI Prancheta (2).pdf', 'FIGAI Prancheta (3).pdf'],
  );
});

test('avoids case-insensitive, pre-suffixed, and Windows-reserved filename collisions', () => {
  const nodes = [
    { id: 'a', type: 'FRAME', name: 'Foo' },
    { id: 'b', type: 'FRAME', name: 'Foo' },
    { id: 'c', type: 'FRAME', name: 'Foo (2)' },
    { id: 'd', type: 'FRAME', name: 'foo' },
    { id: 'e', type: 'FRAME', name: 'CON' },
  ];

  assert.deepEqual(
    planExports(nodes, normalizeSettings({})).map((item) => item.fileName),
    ['Foo.pdf', 'Foo (2).pdf', 'Foo (2) (2).pdf', 'foo (3).pdf', 'CON (2).pdf'],
  );
});

test('continues exporting after one frame fails', async () => {
  const nodes = [
    { id: 'a', type: 'FRAME', name: 'A' },
    { id: 'b', type: 'FRAME', name: 'B' },
    { id: 'c', type: 'FRAME', name: 'C' },
  ];
  const plan = planExports(nodes, normalizeSettings({}));
  const progress = [];

  const result = await exportPlannedFrames(
    nodes,
    plan,
    async (node) => {
      if (node.id === 'b') throw new Error('Falha simulada');
      return new Uint8Array([1, 2, 3]);
    },
    (current, total) => progress.push([current, total]),
  );

  assert.deepEqual(result.files.map((file) => file.name), ['A.pdf', 'C.pdf']);
  assert.deepEqual(result.failed, [{ name: 'B.pdf', message: 'Falha simulada' }]);
  assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
});

test('matches the exact 20 x 7 cm reference size when the source frame is oversized', () => {
  const frameWidthPt = (200 / 25.4) * 72;
  const frameHeightPt = (70 / 25.4) * 72;
  const geometry = printGeometry(frameWidthPt * (4 / 3), frameHeightPt * (4 / 3), normalizeSettings({
    pageSize: 'reference',
    bleed: 5,
    cropMarks: true,
  }));

  assert.ok(Math.abs(geometry.widthPt - frameWidthPt) < 0.001);
  assert.ok(Math.abs(geometry.heightPt - frameHeightPt) < 0.001);
  assert.ok(Math.abs(geometry.contentScale - 0.75) < 0.001);
  assert.ok(Math.abs(geometry.pageWidthPt - 620.9291338582677) < 0.001);
  assert.ok(Math.abs(geometry.pageHeightPt - 252.42519685039372) < 0.001);
});

test('uses a custom page size in mm and rejects missing or mismatched sizes', () => {
  const mm = 72 / 25.4;
  const geometry = printGeometry(100 * mm, 50 * mm, normalizeSettings({
    pageSize: 'custom', customWidth: 200, customHeight: 100, bleed: 0, cropMarks: false,
  }));
  assert.ok(Math.abs(geometry.widthPt - 200 * mm) < 0.001);
  assert.ok(Math.abs(geometry.contentScale - 2) < 0.001);
  assert.deepEqual(
    validateSettings(normalizeSettings({ pageSize: 'custom', customWidth: '' }), 1),
    ['Informe largura e altura personalizadas maiores que zero.'],
  );
});

test('standard sizes follow the frame orientation and reject other proportions', async () => {
  const mm = 72 / 25.4;
  const portrait = printGeometry(210, 297, normalizeSettings({ pageSize: 'A4', bleed: 0, cropMarks: false }));
  assert.ok(Math.abs(portrait.widthPt - 210 * mm) < 0.001);
  const landscape = printGeometry(90, 50, normalizeSettings({ pageSize: 'card', bleed: 0, cropMarks: false }));
  assert.ok(Math.abs(landscape.widthPt - 90 * mm) < 0.001);
  await assert.rejects(
    makePrintPdf({ type: 'FRAME', width: 610, height: 845 }, normalizeSettings({ pageSize: 'A4', bleed: 5 })),
    /mesma proporção de 210 × 297 mm/,
  );
});

test('exports the sheet as a 300 dpi PNG by default, vector PDF only on request', async () => {
  const calls = [];
  global.figma = {
    createFrame() {
      return {
        appendChild(child) { child.parent = this; },
        resize(w, h) { this.width = w; this.height = h; },
        exportAsync(options) { calls.push(options); return new Uint8Array([1]); },
        remove() {},
      };
    },
    createRectangle() { return { resize() {}, remove() {} }; },
  };
  const node = { type: 'FRAME', width: 72, height: 72, fills: [], children: [], clone: () => ({ remove() {}, rescale() {} }) };
  try {
    const raster = await makePrintPdf(node, normalizeSettings({ bleed: 0, cropMarks: true }));
    assert.equal(raster.raster, true);
    assert.equal(calls[0].format, 'PNG');
    assert.ok(Math.abs(calls[0].constraint.value - 300 / 72) < 1e-9);
    await makePrintPdf(node, normalizeSettings({ bleed: 0, cropMarks: true, quality: 'vector' }));
    assert.equal(calls[1].format, 'PDF');
  } finally {
    delete global.figma;
  }
});

test('crop marks run from the trim corner to the page edge, over the artwork', () => {
  const geometry = printGeometry(100, 50, normalizeSettings({ bleed: 5, cropMarks: true }));
  const { marginPt: m, pageWidthPt: W, pageHeightPt: H, widthPt: w, heightPt: h } = geometry;
  assert.equal(w, 75, '100 px do Figma (96 px/pol) = 75 pt');
  const marks = cropMarkSegments(geometry);
  assert.equal(marks.length, 8);
  assert.deepEqual(marks[0], [[0, m], [m, m]]);
  assert.deepEqual(marks[1], [[m + w, m], [W, m]]);
  assert.deepEqual(marks[7], [[m + w, m + h], [m + w, H]]);
});

test('keeps 5 mm physical bleed when exporting an oversized 20 x 7 frame', async () => {
  let createdFrame;
  const artwork = {
    rescale(scale) { this.scale = scale; },
    remove() { this.removed = true; },
  };
  const node = {
    type: 'FRAME',
    width: (200 / 25.4) * 96,
    height: (70 / 25.4) * 96,
    fills: [],
    children: [],
    clone() { return artwork; },
  };
  global.figma = {
    createFrame() {
      createdFrame = {
        appendChild(child) { child.parent = this; },
        resize(width, height) { this.resizeArgs = [width, height]; },
        exportAsync() { return new Uint8Array([1]); },
        remove() { this.removed = true; },
      };
      return createdFrame;
    },
    createRectangle() {
      return {
        resize() {},
        remove() { this.removed = true; },
      };
    },  };

  try {
    await makePrintPdf(node, normalizeSettings({ pageSize: 'reference', bleed: 5, cropMarks: true }));
  } finally {
    delete global.figma;
  }

  assert.ok(Math.abs(createdFrame.resizeArgs[0] - 620.9291338582677) < 0.001);
  assert.ok(Math.abs(createdFrame.resizeArgs[1] - 252.42519685039372) < 0.001);
  assert.ok(Math.abs(artwork.scale - 0.75) < 0.001);
});
