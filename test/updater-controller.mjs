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
  fetchImpl: async (url) => ({
    ok: true,
    async json() {
      assert.equal(url, 'https://api.github.com/repos/jkc0526/ai-studio-pro/releases?per_page=10');
      return [
        { tag_name: 'v0.7.12', name: 'WeaveCanvas v0.7.12', body: '更新十二', published_at: '2026-09-29T00:00:00Z' },
        { tag_name: 'v0.7.11', name: 'WeaveCanvas v0.7.11', body: '更新十一', published_at: '2026-09-28T00:00:00Z' },
        { tag_name: 'v0.7.10', name: 'WeaveCanvas v0.7.10', body: '更新十', published_at: '2026-09-27T00:00:00Z' },
        { tag_name: 'v0.7.9', name: 'WeaveCanvas v0.7.9', body: '旧版本', published_at: '2026-09-26T00:00:00Z' },
        { tag_name: 'v0.8.0-beta', name: '测试版', body: '预览', prerelease: true },
        { tag_name: 'v0.7.13', name: '草稿', body: '草稿', draft: true },
      ];
    },
  }),
});

await controller.check();
assert.equal(updater.checkCalls, 1, 'manual check should call the GitHub updater');
assert.equal(events.at(-1).state, 'checking', 'checking status should be shown in the app');
assert.equal(updater.autoDownload, false, 'checking for an update must not start its download');

updater.emit('update-available', { version: '0.7.7' });
assert.equal(events.at(-1).state, 'available', 'a found update should wait for a separate download action');
assert.equal(updater.downloadCalls, 0, 'finding an update must not download it automatically');
await controller.download();
assert.equal(updater.downloadCalls, 1, 'the second user action should start downloading the update');
assert.equal(events.at(-1).state, 'downloading');

updater.emit('download-progress', { percent: 46.7 });
assert.equal(events.at(-1).state, 'downloading');
assert.equal(events.at(-1).percent, 47, 'download progress should be rounded for display');

updater.emit('update-downloaded', { version: '0.7.7' });
assert.equal(events.at(-1).state, 'downloaded');
await controller.install();
assert.equal(updater.installCalls, 1, 'install action should restart into the downloaded update');

const recentReleases = await controller.getRecentReleases();
assert.deepEqual(recentReleases.map((release) => release.version), ['v0.7.12', 'v0.7.11', 'v0.7.10'],
  'the settings view should receive the three newest published stable releases');
assert.deepEqual(recentReleases.map((release) => release.notes), ['更新十二', '更新十一', '更新十']);

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
