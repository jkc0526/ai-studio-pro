export function createUpdaterController({ autoUpdater, app, platform, send = () => {} }) {
  let status = { state: 'idle' };
  let downloaded = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  const publish = (next) => {
    status = next;
    send(next);
    return next;
  };

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }));
  autoUpdater.on('update-available', (info = {}) => {
    downloaded = false;
    publish({ state: 'downloading', version: info.version || '' });
  });
  autoUpdater.on('update-not-available', (info = {}) => {
    downloaded = false;
    publish({ state: 'up-to-date', version: info.version || '' });
  });
  autoUpdater.on('download-progress', (progress = {}) => publish({
    state: 'downloading',
    percent: Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0))),
  }));
  autoUpdater.on('update-downloaded', (info = {}) => {
    downloaded = true;
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
    install() {
      if (!downloaded) return publish({ state: 'error', message: '更新尚未下载完成' });
      autoUpdater.quitAndInstall(false, true);
      return status;
    },
  };
}
