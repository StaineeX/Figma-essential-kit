const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('blocks network access with the Figma manifest sentinel', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

  assert.deepEqual(manifest.networkAccess.allowedDomains, ['none']);
});
