import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importLegacyDataDirectory, resolveUserDataDirectory } from '../electron/dataMigration.js';

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

  const appData = path.join(root, 'app-data');
  const previousUserData = path.join(appData, 'weave-canvas');
  const renamedUserData = path.join(appData, 'WeaveCanvas');
  fs.mkdirSync(path.join(previousUserData, 'data'), { recursive: true });
  fs.mkdirSync(path.join(renamedUserData, 'data'), { recursive: true });
  fs.writeFileSync(path.join(previousUserData, 'data', 'weave.db'), 'previous projects');
  fs.writeFileSync(path.join(renamedUserData, 'data', 'weave.db'), 'new empty database');
  assert.equal(resolveUserDataDirectory(appData), previousUserData,
    'an existing database under the original package-name directory must be reopened after rebranding');
  assert.equal(fs.readFileSync(path.join(previousUserData, 'data', 'weave.db'), 'utf8'), 'previous projects');
  assert.equal(fs.readFileSync(path.join(renamedUserData, 'data', 'weave.db'), 'utf8'), 'new empty database',
    'selecting the original data directory must leave the renamed directory untouched');

  const renamedOnlyAppData = path.join(root, 'renamed-only-app-data');
  const renamedOnlyUserData = path.join(renamedOnlyAppData, 'WeaveCanvas');
  fs.mkdirSync(path.join(renamedOnlyUserData, 'data'), { recursive: true });
  fs.writeFileSync(path.join(renamedOnlyUserData, 'data', 'weave.db'), 'renamed install projects');
  assert.equal(resolveUserDataDirectory(renamedOnlyAppData), renamedOnlyUserData,
    'users who only have data under the renamed folder must keep using it');

  const freshAppData = path.join(root, 'fresh-app-data');
  assert.equal(resolveUserDataDirectory(freshAppData), path.join(freshAppData, 'weave-canvas'),
    'fresh installs should use a stable package-name directory');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('packaged data migration tests passed');
