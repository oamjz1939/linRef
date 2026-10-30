import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
  getAlwaysOnTop: () => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  writeClipboardImage: (dataUrl: string) => Promise<boolean>;
  readClipboardImage: () => Promise<string | null>;
  saveProject: (payload: {
    data: Uint8Array;
    filePath?: string;
  }) => Promise<{ saved: boolean; filePath?: string }>;
  openProject: (
    filePath?: string
  ) => Promise<{ canceled: boolean; filePath?: string; data?: Uint8Array }>;
}

const api: ElectronAPI = {
  setAlwaysOnTop: (flag: boolean) => ipcRenderer.invoke('window:set-always-on-top', flag),
  getAlwaysOnTop: () => ipcRenderer.invoke('window:get-always-on-top'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  writeClipboardImage: (dataUrl: string) => ipcRenderer.invoke('clipboard:write-image', dataUrl),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  saveProject: (payload: { data: Uint8Array; filePath?: string }) =>
    ipcRenderer.invoke('project:save', payload),
  openProject: (filePath?: string) => ipcRenderer.invoke('project:open', filePath)
};

contextBridge.exposeInMainWorld('electronAPI', api);
