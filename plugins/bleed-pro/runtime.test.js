const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('manifest points to a present, syntactically valid runtime', () => {
  const root = __dirname;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const runtime = path.join(root, manifest.main);

  assert.equal(Object.hasOwn(manifest, 'isTool'), false);
  assert.equal(fs.existsSync(runtime), true);
  execFileSync(process.execPath, ['--check', runtime], { stdio: 'pipe' });
});
