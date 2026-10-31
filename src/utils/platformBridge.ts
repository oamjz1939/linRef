/**
 * Cross-platform bridge wrapping Electron IPC with browser fallbacks.
 */

export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
}

export function getPathForFile(file: File): string {
  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.getPathForFile === 'function') {
    try {
      return window.electronAPI.getPathForFile(file) || '';
    } catch {
      return '';
    }
  }
  return '';
}

export async function setAlwaysOnTop(flag: boolean): Promise<boolean> {
  if (window.electronAPI) {
    return window.electronAPI.setAlwaysOnTop(flag);
  }
  return flag;
}

export async function getAlwaysOnTop(): Promise<boolean> {
  if (window.electronAPI) {
    return window.electronAPI.getAlwaysOnTop();
  }
  return false;
}

export async function minimizeWindow(): Promise<void> {
  if (window.electronAPI) {
    await window.electronAPI.minimizeWindow();
  }
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  if (window.electronAPI) {
    return window.electronAPI.toggleMaximizeWindow();
  }
  return false;
}

export async function closeWindow(): Promise<void> {
  if (window.electronAPI) {
    await window.electronAPI.closeWindow();
  } else {
    window.close();
  }
}

export async function forceCloseWindow(): Promise<void> {
  if (window.electronAPI) {
    await window.electronAPI.forceCloseWindow();
  } else {
    window.close();
  }
}

export async function setDocumentDirty(dirty: boolean): Promise<boolean> {
  if (window.electronAPI) {
    return window.electronAPI.setDocumentDirty(dirty);
  }
  return dirty;
}

export function onRequestSaveAndClose(callback: () => void): () => void {
  if (window.electronAPI) {
    return window.electronAPI.onRequestSaveAndClose(callback);
  }
  return () => {};
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(parts[1] || '');
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Copy a PNG DataURL to system clipboard.
 */
export async function copyImageToClipboard(pngDataUrl: string): Promise<boolean> {
  if (window.electronAPI) {
    return window.electronAPI.writeClipboardImage(pngDataUrl);
  }

  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const blob = dataUrlToBlob(pngDataUrl);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }
  } catch {
    // Fallback failed
  }
  return false;
}

/**
 * Read an image from system clipboard as a DataURL.
 */
export async function readImageFromClipboard(): Promise<string | null> {
  if (window.electronAPI) {
    return window.electronAPI.readClipboardImage();
  }

  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          return await blobToDataUrl(blob);
        }
      }
    }
  } catch {
    // Ignore permission or unsupported errors
  }
  return null;
}

/**
 * Save .lref project archive bytes to disk or trigger browser download.
 */
export async function saveProjectFile(
  data: Uint8Array,
  filePath?: string
): Promise<{ saved: boolean; filePath?: string; error?: string }> {
  if (window.electronAPI) {
    return window.electronAPI.saveProject({ data, filePath });
  }

  try {
    const blob = new Blob([data as unknown as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath ? filePath.split(/[\\/]/).pop() || 'project.lref' : 'project.lref';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { saved: true, filePath: a.download };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { saved: false, error: errorMsg };
  }
}

/**
 * Open a .lref project archive from disk or via browser file picker.
 */
export async function openProjectFile(
  filePath?: string
): Promise<{ canceled: boolean; filePath?: string; data?: Uint8Array; error?: string }> {
  if (window.electronAPI) {
    return window.electronAPI.openProject(filePath);
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lref,application/zip,application/octet-stream';
    input.style.display = 'none';

    let settled = false;
    const finish = (result: { canceled: boolean; filePath?: string; data?: Uint8Array; error?: string }) => {
      if (settled) return;
      settled = true;
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
      resolve(result);
    };

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish({ canceled: true });
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        finish({
          canceled: false,
          filePath: file.name,
          data: new Uint8Array(buffer)
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        finish({ canceled: true, error: errorMsg });
      }
    };

    input.oncancel = () => {
      finish({ canceled: true });
    };

    document.body.appendChild(input);
    input.click();
  });
}

// Aliases for compatibility
export const writeClipboardImage = copyImageToClipboard;
export const readClipboardImage = readImageFromClipboard;
export const saveProject = saveProjectFile;
export const openProject = openProjectFile;

export const platformBridge = {
  isElectron,
  getPathForFile,
  setAlwaysOnTop,
  getAlwaysOnTop,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  forceCloseWindow,
  setDocumentDirty,
  onRequestSaveAndClose,
  copyImageToClipboard,
  writeClipboardImage,
  readImageFromClipboard,
  readClipboardImage,
  saveProjectFile,
  saveProject,
  openProjectFile,
  openProject,
  blobToDataUrl
};

export default platformBridge;
