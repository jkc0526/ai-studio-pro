const { app, BrowserWindow, shell, session, ipcMain, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// Ensure persistent data directory exists
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const MEDIA_DIR = path.join(app.getPath('userData'), 'media');
const STORE_FILE = path.join(app.getPath('userData'), 'data', 'secure-store.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Set environment variable for server to use
process.env.AI_STUDIO_DATA_DIR = DATA_DIR;
process.env.AI_STUDIO_MEDIA_DIR = MEDIA_DIR;

let mainWindow = null;
let serverStarted = false;
let updateInfo = null;
let downloadProgress = 0;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}


function startServer() {
  try {
    require('./server');
    serverStarted = true;
    console.log('Server module loaded successfully');
  } catch (err) {
    console.error('Failed to start server:', err.message);
  }
}

function waitForServer(callback, retries = 30) {
  const net = require('net');
  const socket = new net.Socket();
  socket.setTimeout(500);
  socket.on('connect', () => {
    socket.destroy();
    callback(true);
  });
  socket.on('error', () => {
    socket.destroy();
    if (retries > 0) {
      setTimeout(() => waitForServer(callback, retries - 1), 500);
    } else {
      callback(false);
    }
  });
  socket.on('timeout', () => {
    socket.destroy();
    if (retries > 0) {
      setTimeout(() => waitForServer(callback, retries - 1), 500);
    } else {
      callback(false);
    }
  });
  socket.connect(3000, '127.0.0.1');
}

function isUpdateFeedConfigured() {
  try {
    const pkg = require('./package.json');
    const url = pkg && pkg.build && pkg.build.win && pkg.build.win.publish && pkg.build.win.publish.url;
    return app.isPackaged && !!url && url.indexOf('your-update-server.com') === -1;
  } catch (err) {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'AI Studio Pro',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:main',
      persistStorage: true,
      cache: true
    }
  });

  mainWindow.loadURL('http://localhost:3000');

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('file://')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // After window loads, auto-check for updates (silent)
  mainWindow.webContents.once('did-finish-load', () => {
    // Delay to not block initial render
    setTimeout(() => {
      if (isUpdateFeedConfigured()) {
        autoUpdater.checkForUpdates().catch(() => {});
      } else {
        console.log('Auto-update check skipped: no update feed configured.');
      }
    }, 3000);
  });
}

/* ==================== Auto Updater ==================== */
// Disable auto-download; let user decide
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  updateInfo = info;
  if (mainWindow) {
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    });
  }
});

autoUpdater.on('update-not-available', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update-not-available', { currentVersion: app.getVersion() });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', {
      version: info.version
    });
  }
});

autoUpdater.on('download-progress', (progress) => {
  downloadProgress = progress.percent;
  if (mainWindow) {
    mainWindow.webContents.send('download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  }
});

autoUpdater.on('error', (error) => {
  console.error('Auto-update error:', error);
  if (mainWindow) {
    mainWindow.webContents.send('update-error', { message: error.message || String(error) });
  }
});

/* ==================== IPC Handlers ==================== */
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, hasUpdate: !!result?.updateInfo, version: result?.updateInfo?.version || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('install-update', () => {
  // This will quit the app and install the update
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 100);
  return { success: true };
});

ipcMain.handle('get-api-key', () => {
  try {
    if (!fs.existsSync(STORE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
    if (!raw || !raw.apiKey) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(raw.apiKey, 'base64'));
  } catch (err) {
    console.error('Failed to read API key:', err.message);
    return null;
  }
});

ipcMain.handle('save-api-key', (_event, key) => {
  try {
    const value = String(key || '').trim();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage is not available');
      const encrypted = safeStorage.encryptString(value).toString('base64');
      fs.writeFileSync(STORE_FILE, JSON.stringify({ apiKey: encrypted }));
    } else if (fs.existsSync(STORE_FILE)) {
      fs.unlinkSync(STORE_FILE);
    }
    return true;
  } catch (err) {
    console.error('Failed to save API key:', err.message);
    return false;
  }
});

/* ==================== App Lifecycle ==================== */
app.whenReady().then(() => {
  if (!gotTheLock) return;
  startServer();

  waitForServer((success) => {
    if (success) {
      createWindow();
    } else {
      console.error('Server failed to start');
      createWindow();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Server will be cleaned up automatically
});
