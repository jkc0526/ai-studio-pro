import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/components/SettingsModal.jsx'), 'utf8');

assert.equal(packageJson.build?.win?.target?.[0]?.target, 'nsis',
  'Windows releases must use an auto-updatable NSIS installer');
assert.equal(packageJson.build?.publish?.[0]?.provider, 'github',
  'release artifacts should publish to GitHub Releases');
assert.equal(packageJson.build?.asar, true, 'application resources should be packed into app.asar');
assert.ok(packageJson.dependencies?.['electron-updater'], 'packaged app must contain electron-updater');
assert.ok(packageJson.scripts?.publish && packageJson.scripts.publish.includes('--publish always'),
  'the publish script should upload release artifacts');
assert.match(main, /preload:\s*path\.join\(__dirname, 'preload\.cjs'\)/,
  'the isolated preload should expose only updater IPC');
assert.match(preload, /weave-updates:check/);
assert.match(preload, /weave-updates:install/);
assert.match(settings, /检查更新/);
assert.match(settings, /重启并安装/);

const workflowPath = path.join(root, '.github', 'workflows', 'release.yml');
assert.ok(fs.existsSync(workflowPath), 'tagged releases should have an automated publish workflow');
const workflow = fs.readFileSync(workflowPath, 'utf8');
assert.match(workflow, /contents:\s*write/);
assert.match(workflow, /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
assert.match(workflow, /--publish always/);
assert.equal((main.match(/(?:async\s+)?function resolveDataDir\(/g) || []).length, 1,
  'only one data directory resolver should be defined');

console.log('GitHub release update configuration tests passed');
