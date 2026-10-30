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

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
