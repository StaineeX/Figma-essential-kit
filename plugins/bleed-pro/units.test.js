const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'code.ts'), 'utf8');

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} is not close to ${expected}`);
}

function loadConversionHelpers() {
  const start = source.indexOf('function unitToInches');
  const end = source.indexOf('function checkConfig');
  assert.ok(start >= 0 && end > start, 'conversion helpers must exist in code.ts');
  const snippet = source
    .slice(start, end)
    .replace(/:\s*(Unit|number|Sides|Config)/g, '');
  return vm.runInNewContext(`(() => { ${snippet}; return { unitToInches, unitToPx, convertUnitValue }; })()`);
}

test('converts mm and cm to the same physical pixels at a given art scale', () => {
  const { unitToPx } = loadConversionHelpers();

  closeTo(unitToPx(10, 'mm', 254), 100);
  closeTo(unitToPx(1, 'cm', 72), 72 / 2.54);
  closeTo(unitToPx(72, 'px', 72), 72);
});

test('changes displayed units without changing physical size', () => {
  const { convertUnitValue } = loadConversionHelpers();

  closeTo(convertUnitValue(10, 'mm', 'cm', 300), 1);
  closeTo(convertUnitValue(1, 'cm', 'mm', 300), 10);
  closeTo(convertUnitValue(25.4, 'mm', 'px', 300), 300);
});
