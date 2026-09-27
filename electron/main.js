import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
import { createUpdaterController } from './updaterController.js';
import { importLegacyDataDirectory } from './dataMigration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const isPackaged = app.isPackaged;

// 固定到旧产品名对应的目录，改品牌后继续使用原有配置、数据库和生成素材。
app.setPath('userData', path.join(app.getPath('appData'), 'WeaveCanvas'));

let mainWindow = null;
let serverInfo = null;
const { autoUpdater } = electronUpdater;
const updater = createUpdaterController({
  autoUpdater,
  app,
  platform: process.platform,
  send: (status) => mainWindow?.webContents.send('weave-updates:status', status),
});

ipcMain.handle('weave-updates:get-version', () => app.getVersion());
ipcMain.handle('weave-updates:get-status', () => updater.getStatus());
ipcMain.handle('weave-updates:get-recent-releases', () => updater.getRecentReleases());
ipcMain.handle('weave-updates:check', () => updater.check());
ipcMain.handle('weave-updates:download', () => updater.download());
ipcMain.handle('weave-updates:install', () => updater.install());

async function resolveDataDir() {
  if (process.env.WEAVE_DATA_DIR) return process.env.WEAVE_DATA_DIR;
  if (!isPackaged) return path.join(APP_ROOT, 'data');

  // Keep user data outside the install directory so NSIS updates cannot replace it.
  const target = path.join(app.getPath('userData'), 'data');
  if (fs.existsSync(path.join(target, 'weave.db'))) return target;

  const legacySidecar = path.join(path.dirname(process.execPath), 'WeaveCanvas-data');
  if (fs.existsSync(path.join(legacySidecar, 'weave.db'))) {
    importLegacyDataDirectory(legacySidecar, target);
    return target;
  }

  const choice = await dialog.showMessageBox({
    type: 'question',
    title: '导入旧版数据',
    message: '首次启动。若你之前使用过绿色版，请先关闭旧版，再导入原来的 WeaveCanvas-data 文件夹；全新用户可直接创建空白工作区。',
    buttons: ['选择旧数据目录', '新建空白工作区'],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice.response === 0) {
    const selected = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (!selected.canceled && selected.filePaths[0]) {
      try {
        importLegacyDataDirectory(selected.filePaths[0], target);
        await dialog.showMessageBox({ type: 'info', message: '旧版项目、配置和生成素材已导入。原数据目录仍保留。' });
      } catch (error) {
        await dialog.showMessageBox({ type: 'error', title: '导入失败', message: error.message });
      }
    }
  }
  return target;
}

async function boot() {
  const dataDir = await resolveDataDir();
  process.env.WEAVE_DATA_DIR = dataDir;
  process.env.WEAVE_DIST_DIR = path.join(APP_ROOT, 'dist');
  fs.mkdirSync(path.join(dataDir, 'outputs'), { recursive: true });

  try {
    // 必须在设置好数据目录之后再加载服务端（db.js 在导入时就确定数据目录）
    const { startServer } = await import('../server/index.js');
    serverInfo = await startServer({ port: Number(process.env.WEAVE_PORT) || 8787 });
  } catch (err) {
    dialog.showErrorBox('AI漫剧工作室启动失败', `本地服务无法启动：${err.stack || err.message}`);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: 'AI漫剧工作室',
    icon: path.join(APP_ROOT, 'dist', 'studio-icon.ico'),
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  await mainWindow.loadURL(serverInfo.url);

  // 新窗口 / 外链走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 单实例
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          { label: '打开数据目录', click: () => shell.openPath(process.env.WEAVE_DATA_DIR || APP_ROOT) },
          { label: '打开输出目录', click: () => shell.openPath(path.join(process.env.WEAVE_DATA_DIR || APP_ROOT, 'outputs')) },
          { type: 'separator' },
          { role: 'quit', label: '退出' },
        ],
      },
      { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }, { role: 'resetZoom', label: '重置缩放' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
      { label: '帮助', submenu: [{ label: '使用说明', click: () => shell.openExternal('https://www.liblib.tv/') }] },
    ]));
    boot();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
  });

  app.on('window-all-closed', () => {
    if (serverInfo?.server) serverInfo.server.close();
    app.quit();
  });
}
