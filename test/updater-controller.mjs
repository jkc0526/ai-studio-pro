import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdaterController } from '../electron/updaterController.js';

function fakeUpdater() {
  const updater = new EventEmitter();
  updater.checkCalls = 0;
  updater.downloadCalls = 0;
  updater.installCalls = 0;
  updater.checkForUpdates = async () => { updater.checkCalls += 1; return {}; };
  updater.downloadUpdate = async () => { updater.downloadCalls += 1; return []; };
  updater.quitAndInstall = () => { updater.installCalls += 1; };
  return updater;
}

const updater = fakeUpdater();
const events = [];
const controller = createUpdaterController({
  autoUpdater: updater,
  app: { isPackaged: true },
  platform: 'win32',
  send: (event) => events.push(event),
});

await controller.check();
assert.equal(updater.checkCalls, 1, 'manual check should call the GitHub updater');
assert.equal(events.at(-1).state, 'checking', 'checking status should be shown in the app');
assert.equal(updater.autoDownload, true, 'available releases should download after a user-initiated check');

updater.emit('update-available', { version: '0.7.7' });
assert.equal(events.at(-1).state, 'downloading');

updater.emit('download-progress', { percent: 46.7 });
assert.equal(events.at(-1).state, 'downloading');
assert.equal(events.at(-1).percent, 47, 'download progress should be rounded for display');

updater.emit('update-downloaded', { version: '0.7.7' });
assert.equal(events.at(-1).state, 'downloaded');
await controller.install();
assert.equal(updater.installCalls, 1, 'install action should restart into the downloaded update');

const devUpdater = fakeUpdater();
const devEvents = [];
const devController = createUpdaterController({
  autoUpdater: devUpdater,
  app: { isPackaged: false },
  platform: 'win32',
  send: (event) => devEvents.push(event),
});
await devController.check();
assert.equal(devUpdater.checkCalls, 0, 'development builds must not query production releases');
assert.equal(devEvents.at(-1).state, 'unavailable');

console.log('updater controller tests passed');
