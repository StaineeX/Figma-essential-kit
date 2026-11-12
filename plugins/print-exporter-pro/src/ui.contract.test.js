const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');

test('exposes the core print export controls', () => {
  for (const label of [
    'Print Exporter Pro',
    'O que exportar',
    'Seleção',
    'Página atual',
    'Modo de cor',
    'CMYK',
    'RGB',
    'Bleed',
    'Marcas de corte',
    'Exportar PDF',
  ]) {
    assert.match(html, new RegExp(label));
  }
});

test('contains presets and the controller message contract', () => {
  for (const preset of ['screen', 'press', 'printer']) {
    assert.match(html, new RegExp(`data-preset="${preset}"`));
  }
  for (const message of ['SELECTION_STATE', 'REFRESH_SELECTION', 'SET_SCOPE', 'EXPORT', 'EXPORT_PROGRESS', 'EXPORT_RESULT', 'EXPORT_ERROR']) {
    assert.match(html, new RegExp(message));
  }
});

test('offers the most used print sizes', () => {
  for (const size of ['frame', 'A3', 'A4', 'A5', 'A6', 'Letter', 'card', 'flyer', 'folder', 'square', 'story', 'reference', 'custom']) {
    assert.match(html, new RegExp(`<option value="${size}"`));
  }
});

test('starts with the primary action disabled until frames are available', () => {
  assert.match(html, /id="exportButton"[^>]*disabled/);
});
