import { app, BrowserWindow, ipcMain, clipboard, nativeImage, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let isDocumentDirty = false;
let isForceClosing = false;
let isPromptingClose = false;
let isAppQuitting = false;

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

  mainWindow.on('close', async (e) => {
    // 强制关闭流程直接放行
    if (isForceClosing) {
      return;
    }
    // 无未保存改动直接放行
    if (!isDocumentDirty) {
      return;
    }

    // 拦截默认关闭动作
    e.preventDefault();

    // 避免重复触发弹窗导致多重对话框卡死
    if (isPromptingClose) {
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    isPromptingClose = true;

    try {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: '未保存的更改',
        message: '是否保存对当前工程的更改？',
        detail: '如果选择“不保存”，您所做的修改将会丢失。'
      });

      if (choice.response === 0) {
        // 用户选择保存：请求渲染进程组装数据并弹出系统保存对话框
        mainWindow.webContents.send('app:request-save-and-close');
      } else if (choice.response === 1) {
        // 用户选择不保存：立即强制销毁窗口或退出，不触发任何卸载阻塞
        isForceClosing = true;
        isDocumentDirty = false;
        if (isAppQuitting || process.platform !== 'darwin') {
          app.exit(0);
        } else {
          mainWindow.destroy();
        }
      } else {
        // 用户选择取消：重置退出标志，停留在画板中继续操作
        isAppQuitting = false;
      }
    } catch (err) {
      console.error('退出确认弹窗异常:', err);
    } finally {
      isPromptingClose = false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isForceClosing = false;
    isPromptingClose = false;
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

  ipcMain.handle('window:set-dirty', (_event, dirty: boolean) => {
    isDocumentDirty = Boolean(dirty);
    mainWindow?.setDocumentEdited?.(isDocumentDirty);
    return isDocumentDirty;
  });

  ipcMain.handle('window:force-close', () => {
    isForceClosing = true;
    isDocumentDirty = false;
    if (isAppQuitting || process.platform !== 'darwin') {
      app.exit(0);
    } else {
      mainWindow?.destroy();
    }
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

app.on('before-quit', () => {
  isAppQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
