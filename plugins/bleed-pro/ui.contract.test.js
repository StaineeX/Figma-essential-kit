const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');

test('offers physical millimeter and centimeter units for both margin groups', () => {
  assert.match(html, /<select id="unit"[\s\S]*<option value="mm">mm<\/option>[\s\S]*<option value="cm"/);
  assert.match(html, /Sangria externa/);
  assert.match(html, /Margem interna de segurança/);
});

test('acknowledges each download before the plugin continues exporting', () => {
  assert.match(html, /download-ack/);
  assert.match(html, /post\(\{type:'download-ack',job:m\.job/);
});

test('uses native controls for the regular Figma plugin manifest', () => {
  assert.doesNotMatch(html, /<fig-(content|group|field|options|input-number|switch|button|footer)\b/);
  for (const control of ['select id="unit"', 'input id="basePpi"', 'input id="dpi"', 'input id="marks"', 'button id="apply"']) {
    assert.match(html, new RegExp(`<${control}`));
  }
});

test('sangria não usa imagem esticada nem fundo branco (origem das linhas brancas)', () => {
  const code = require('node:fs').readFileSync(require('node:path').join(__dirname, 'code.js'), 'utf8');
  assert.doesNotMatch(html, /edge-request|paddedBorder/);
  assert.doesNotMatch(code, /createImage|edge-request|PREENCHER MANUALMENTE/);
});
