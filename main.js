const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { Downloader } = require('./src/downloader');
const { BinaryManager } = require('./src/binary-manager');

// Persistent settings store
const store = new Store({
  defaults: {
    outputFolder: path.join(app.getPath('downloads'), 'GrabTube'),
    maxConcurrent: 3,
    defaultFormat: 'best-mp4',
    embedMetadata: true,
    theme: 'dark'
  }
});

let mainWindow;
let downloader;
let binaryManager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0e27',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  // Initialize binary manager
  binaryManager = new BinaryManager(app.getPath('userData'));

  // Initialize downloader (will be ready once binaries are set)
  downloader = new Downloader(binaryManager);

  createWindow();

  // Check & download binaries on startup
  mainWindow.webContents.on('did-finish-load', async () => {
    mainWindow.webContents.send('app-status', { type: 'checking-binaries', message: 'Checking required components...' });

    try {
      const ready = await binaryManager.ensureBinaries((progress) => {
        mainWindow.webContents.send('app-status', { type: 'downloading-binaries', message: progress });
      });
      if (ready) {
        mainWindow.webContents.send('app-status', { type: 'ready', message: 'Ready to download!' });
      }
    } catch (err) {
      mainWindow.webContents.send('app-status', { type: 'error', message: `Setup failed: ${err.message}` });
    }
  });

  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC HANDLERS ────────────────────────────────────────────────────

function registerIpcHandlers() {
  // Window controls
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow.close());

  // Get video info
  ipcMain.handle('get-video-info', async (_event, url) => {
    try {
      const info = await downloader.getVideoInfo(url);
      return { success: true, data: info };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Start download
  ipcMain.handle('start-download', async (_event, options) => {
    const downloadId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    try {
      downloader.download({
        ...options,
        id: downloadId,
        outputFolder: options.outputFolder || store.get('outputFolder'),
        onProgress: (progress) => {
          mainWindow.webContents.send('download-progress', { id: downloadId, ...progress });
        },
        onComplete: (result) => {
          mainWindow.webContents.send('download-complete', { id: downloadId, ...result });
        },
        onError: (error) => {
          mainWindow.webContents.send('download-error', { id: downloadId, error: error.message || error });
        }
      });
      return { success: true, id: downloadId };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Cancel download
  ipcMain.handle('cancel-download', async (_event, downloadId) => {
    try {
      downloader.cancel(downloadId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Select output folder
  ipcMain.handle('select-output-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Download Folder'
    });
    if (!result.canceled && result.filePaths.length > 0) {
      store.set('outputFolder', result.filePaths[0]);
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false };
  });

  // Open folder in explorer
  ipcMain.handle('open-folder', async (_event, folderPath) => {
    shell.openPath(folderPath);
    return { success: true };
  });

  // Settings
  ipcMain.handle('get-settings', async () => {
    return {
      outputFolder: store.get('outputFolder'),
      maxConcurrent: store.get('maxConcurrent'),
      defaultFormat: store.get('defaultFormat'),
      embedMetadata: store.get('embedMetadata'),
      theme: store.get('theme')
    };
  });

  ipcMain.handle('save-settings', async (_event, settings) => {
    Object.entries(settings).forEach(([key, value]) => {
      store.set(key, value);
    });
    return { success: true };
  });
}
