import { app, BrowserWindow, ipcMain, clipboard, nativeImage, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;

function getAppIconPath(): string | undefined {
  const isMac = process.platform === 'darwin';
  const iconFile = isMac
    ? 'icon-mac.png'
    : process.platform === 'win32'
    ? 'icon.ico'
    : 'icon-win.png';
  const candidate = path.join(__dirname, '..', 'assets', 'icons', iconFile);
  return fs.existsSync(candidate) ? candidate : undefined;
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#18181b',
    icon: iconPath,
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const distIndex = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(distIndex)) {
      mainWindow.loadFile(distIndex);
    } else {
      mainWindow.loadURL('http://localhost:5173');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('window:set-always-on-top', (_event, flag: boolean) => {
    if (!mainWindow) return false;
    mainWindow.setAlwaysOnTop(Boolean(flag), 'floating');
    return mainWindow.isAlwaysOnTop();
  });

  ipcMain.handle('window:get-always-on-top', () => {
    if (!mainWindow) return false;
    return mainWindow.isAlwaysOnTop();
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return mainWindow.isMaximized();
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('clipboard:write-image', (_event, dataUrl: string) => {
    try {
      const img = nativeImage.createFromDataURL(dataUrl);
      if (img.isEmpty()) return false;
      clipboard.writeImage(img);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('clipboard:read-image', () => {
    try {
      const img = clipboard.readImage();
      if (img.isEmpty()) return null;
      return img.toDataURL();
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    'project:save',
    async (_event, payload: { data: Uint8Array; filePath?: string }) => {
      if (!mainWindow) return { saved: false };

      let targetPath = payload.filePath;
      if (!targetPath) {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: '保存 linRef 参考图工程',
          defaultPath: 'untitled.lref',
          filters: [{ name: 'linRef Project', extensions: ['lref'] }]
        });
        if (result.canceled || !result.filePath) {
          return { saved: false };
        }
        targetPath = result.filePath;
      }

      if (!targetPath.toLowerCase().endsWith('.lref')) {
        targetPath += '.lref';
      }

      await fs.promises.writeFile(targetPath, Buffer.from(payload.data));
      return { saved: true, filePath: targetPath };
    }
  );

  ipcMain.handle('project:open', async (_event, filePath?: string) => {
    if (!mainWindow) return { canceled: true };

    let targetPath = filePath;
    if (!targetPath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '打开 linRef 参考图工程',
        properties: ['openFile'],
        filters: [{ name: 'linRef Project', extensions: ['lref'] }]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }
      targetPath = result.filePaths[0];
    }

    const buffer = await fs.promises.readFile(targetPath);
    return {
      canceled: false,
      filePath: targetPath,
      data: new Uint8Array(buffer)
    };
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    const macIconPath = getAppIconPath();
    if (macIconPath) {
      const dockIcon = nativeImage.createFromPath(macIconPath);
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon);
      }
    }
  }
  registerIpcHandlers();
  createWindow();

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
