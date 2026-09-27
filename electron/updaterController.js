const RELEASES_URL = 'https://api.github.com/repos/jkc0526/ai-studio-pro/releases?per_page=10';

export function createUpdaterController({ autoUpdater, app, platform, send = () => {}, fetchImpl = globalThis.fetch }) {
  let status = { state: 'idle' };
  let downloaded = false;
  let updateAvailable = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  const publish = (next) => {
    status = next;
    send(next);
    return next;
  };

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }));
  autoUpdater.on('update-available', (info = {}) => {
    downloaded = false;
    updateAvailable = true;
    publish({ state: 'available', version: info.version || '' });
  });
  autoUpdater.on('update-not-available', (info = {}) => {
    downloaded = false;
    updateAvailable = false;
    publish({ state: 'up-to-date', version: info.version || '' });
  });
  autoUpdater.on('download-progress', (progress = {}) => publish({
    state: 'downloading',
    percent: Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0))),
  }));
  autoUpdater.on('update-downloaded', (info = {}) => {
    downloaded = true;
    updateAvailable = false;
    publish({ state: 'downloaded', version: info.version || '' });
  });
  autoUpdater.on('error', (error) => publish({
    state: 'error', message: String(error?.message || error || '更新检查失败'),
  }));

  return {
    async check() {
      if (!app.isPackaged || platform !== 'win32') {
        return publish({ state: 'unavailable', message: '自动更新仅适用于已安装的 Windows 版本' });
      }
      publish({ state: 'checking' });
      try {
        await autoUpdater.checkForUpdates();
        return status;
      } catch (error) {
        return publish({ state: 'error', message: String(error?.message || error || '更新检查失败') });
      }
    },
    getStatus: () => status,
    async getRecentReleases() {
      if (typeof fetchImpl !== 'function') throw new Error('无法连接 GitHub 获取更新内容');
      const response = await fetchImpl(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`GitHub 更新记录请求失败（${response.status}）`);
      const releases = await response.json();
      if (!Array.isArray(releases)) return [];
      return releases
        .filter((release) => !release.draft && !release.prerelease && release.tag_name)
        .slice(0, 3)
        .map((release) => ({
          version: release.tag_name,
          name: release.name || release.tag_name,
          notes: String(release.body || '').trim() || '暂无更新说明',
          publishedAt: release.published_at || '',
        }));
    },
    async download() {
      if (!updateAvailable) return publish({ state: 'error', message: '请先检查是否有可用更新' });
      publish({ state: 'downloading', version: status.version || '' });
      try {
        await autoUpdater.downloadUpdate();
        return status;
      } catch (error) {
        return publish({ state: 'error', message: String(error?.message || error || '更新下载失败') });
      }
    },
    install() {
      if (!downloaded) return publish({ state: 'error', message: '更新尚未下载完成' });
      autoUpdater.quitAndInstall(false, true);
      return status;
    },
  };
}
