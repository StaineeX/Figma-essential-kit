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

test('labels the reference output by its 5 mm bleed', () => {
  assert.match(html, /<option value="reference">5 mm · igual ao modelo<\/option>/);
});

test('starts with the primary action disabled until frames are available', () => {
  assert.match(html, /id="exportButton"[^>]*disabled/);
});
