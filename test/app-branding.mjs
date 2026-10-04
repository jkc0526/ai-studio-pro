import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const html = read('index.html');
const main = read('electron/main.js');
const packager = read('electron/build.mjs');
const sidebar = read('src/components/Sidebar.jsx');
const settings = read('src/components/SettingsModal.jsx');
const iconPath = path.join(root, 'public', 'studio-icon.ico');

assert.equal(pkg.build.productName, 'AI漫剧工作室', 'the installed app should use the requested product name');
assert.equal(lock.version, pkg.version, 'the npm lockfile version must match the application release');
assert.equal(lock.packages[''].version, pkg.version, 'the lockfile root package must match the application release');
assert.equal(pkg.build.appId, 'com.weavecanvas.desktop', 'updates must keep the existing app identity');
assert.equal(pkg.build.win.icon, 'public/studio-icon.ico', 'the Windows installer should use the new icon');
assert.match(html, /<title>AI漫剧工作室<\/title>/, 'browser and webview title should use the new name');
assert.match(html, /href="\/studio-icon\.svg"/, 'the browser tab should show the matching app icon');
assert.match(main, /title:\s*'AI漫剧工作室'/, 'the Electron window title should use the requested name');
assert.match(main, /icon:\s*path\.join\(APP_ROOT, 'dist', 'studio-icon\.ico'\)/,
  'the Electron window should show the packaged app icon');
assert.match(main, /app\.setPath\('userData',\s*resolveUserDataDirectory\(app\.getPath\('appData'\)\)\)/,
  'renaming the app must reopen the original package-name user-data folder when it exists');
assert.match(packager, /icon:\s*path\.join\(root, 'public', 'studio-icon\.ico'\)/,
  'the portable Windows build should use the same icon');
assert.match(packager, /name:\s*'AI漫剧工作室'/,
  'the portable Windows app should use the requested product name');
assert.match(sidebar, /src="\/studio-icon\.svg"/);
assert.match(sidebar, />AI漫剧工作室</);
assert.match(settings, /<b>AI漫剧工作室<\/b>/, 'the update card should show the new app name');

const icon = fs.readFileSync(iconPath);
assert.equal(icon.readUInt16LE(0), 0, 'icon reserved header must be zero');
assert.equal(icon.readUInt16LE(2), 1, 'icon type must be ICO');
assert.ok(icon.readUInt16LE(4) >= 1, 'ICO must contain at least one image size');

console.log('App branding tests passed');
