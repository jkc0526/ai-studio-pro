import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importLegacyDataDirectory } from '../electron/dataMigration.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-data-migration-'));
try {
  const legacy = path.join(root, 'legacy', 'WeaveCanvas-data');
  const target = path.join(root, 'user-data', 'data');
  fs.mkdirSync(path.join(legacy, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'weave.db'), 'legacy database');
  fs.writeFileSync(path.join(legacy, 'outputs', 'shot.mp4'), 'generated output');

  assert.equal(importLegacyDataDirectory(legacy, target), true);
  assert.equal(fs.readFileSync(path.join(target, 'weave.db'), 'utf8'), 'legacy database');
  assert.equal(fs.readFileSync(path.join(target, 'outputs', 'shot.mp4'), 'utf8'), 'generated output');
  assert.equal(fs.existsSync(legacy), true, 'migration must preserve the original data directory');
  assert.equal(importLegacyDataDirectory(legacy, target), false,
    'migration must not overwrite data already present in the new location');

  assert.throws(() => importLegacyDataDirectory(path.join(root, 'missing'), path.join(root, 'other')),
    /weave\.db/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('packaged data migration tests passed');
