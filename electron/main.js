import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const isPackaged = app.isPackaged;

/** 数据目录：优先放在程序同级（绿色便携），不可写则退到用户数据目录 */
function resolveDataDir() {
  if (process.env.WEAVE_DATA_DIR) return process.env.WEAVE_DATA_DIR;
  // 开发模式：用项目里的 data 目录，和命令行启动共用同一份数据
  if (!isPackaged) return path.join(APP_ROOT, 'data');
  const portable = path.join(path.dirname(process.execPath), 'WeaveCanvas-data');
  try {
    fs.mkdirSync(portable, { recursive: true });
    fs.accessSync(portable, fs.constants.W_OK);
    return portable;
  } catch {
    const fallback = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

let mainWindow = null;
let serverInfo = null;

async function boot() {
  const dataDir = resolveDataDir();
  process.env.WEAVE_DATA_DIR = dataDir;
  process.env.WEAVE_DIST_DIR = path.join(APP_ROOT, 'dist');
  fs.mkdirSync(path.join(dataDir, 'outputs'), { recursive: true });

  try {
    // 必须在设置好数据目录之后再加载服务端（db.js 在导入时就确定数据目录）
    const { startServer } = await import('../server/index.js');
    serverInfo = await startServer({ port: Number(process.env.WEAVE_PORT) || 8787 });
  } catch (err) {
    dialog.showErrorBox('WeaveCanvas 启动失败', `本地服务无法启动：${err.stack || err.message}`);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: 'WeaveCanvas · AI 漫剧创作流水线',
    backgroundColor: '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
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
