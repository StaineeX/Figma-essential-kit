import test from 'node:test';
import assert from 'node:assert/strict';

import { clampByte, formatFileSize, refineAlpha } from '../src/image-utils.mjs';

test('clampByte keeps channel values inside the byte range', () => {
  assert.equal(clampByte(-4), 0);
  assert.equal(clampByte(128.6), 129);
  assert.equal(clampByte(300), 255);
});

test('refineAlpha changes only alpha and preserves RGB values', () => {
  const imageData = { data: new Uint8ClampedArray([10, 20, 30, 64, 40, 50, 60, 192]) };
  const refined = refineAlpha(imageData, 100);

  assert.deepEqual(Array.from(refined.data), [10, 20, 30, 32, 40, 50, 60, 224]);
});

test('formatFileSize gives readable units', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(1024), '1 KB');
  assert.equal(formatFileSize(1024 * 1024 * 2.5), '2.5 MB');
});

