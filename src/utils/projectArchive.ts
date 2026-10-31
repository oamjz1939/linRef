import JSZip from 'jszip';
import {
  CanvasNode,
  DEFAULT_COLOR_ADJUSTMENTS,
  DEFAULT_CROP,
  ImageCanvasNode,
  ProjectFileMeta,
  ViewportState
} from '../types';

export function getExtensionFromMimeType(mimeType: string): string {
  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
  if (cleanMime.includes('jpeg') || cleanMime.includes('jpg')) return 'jpg';
  if (cleanMime.includes('webp')) return 'webp';
  if (cleanMime.includes('gif')) return 'gif';
  if (cleanMime.includes('svg')) return 'svg';
  if (cleanMime.includes('bmp')) return 'bmp';
  return 'png';
}

/**
 * Modern, robust conversion from image source (data: URL, blob: URL, etc.) to binary Uint8Array.
 * Uses browser-native fetch() for C++ stream processing without V8 string memory limits,
 * with safe base64 decoding fallback.
 */
export async function imageSourceToBytes(
  src: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!src || typeof src !== 'string') {
    throw new Error('Image source is empty or invalid');
  }

  // 1. 优先使用浏览器原生 fetch 流式解析（C++层解析 data: 与 blob: 协议，天然兼容换行符、MIME 复杂参数）
  if (typeof fetch === 'function') {
    try {
      const res = await fetch(src);
      if (res.ok || res.type === 'opaque' || res.status === 0 || res.status === 200) {
        const blob = await res.blob();
        const arrayBuf = await blob.arrayBuffer();
        let mimeType = blob.type;
        if (!mimeType && src.startsWith('data:')) {
          const match = src.slice(5, 50).match(/^([^;]+)/);
          if (match) mimeType = match[1];
        }
        return {
          bytes: new Uint8Array(arrayBuf),
          mimeType: mimeType || 'image/png'
        };
      }
    } catch {
      // fetch 在某些受限环境或特殊协议下失败时，进入下方轻量级回退机制
    }
  }

  // 2. Data URL 轻量级回退机制
  if (src.startsWith('data:')) {
    const commaIndex = src.indexOf(',');
    if (commaIndex !== -1) {
      const metaPart = src.slice(5, commaIndex);
      const dataPart = src.slice(commaIndex + 1);
      const mimeType = metaPart.split(';')[0].trim() || 'image/png';
      const isBase64 = /;base64/i.test(metaPart);

      if (isBase64) {
        if (typeof Buffer !== 'undefined') {
          const buf = Buffer.from(dataPart, 'base64');
          return {
            bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
            mimeType
          };
        }
        const cleaned = dataPart.replace(/[\r\n\s]/g, '');
        const binary = atob(cleaned);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return { bytes, mimeType };
      } else {
        const decoded = decodeURIComponent(dataPart);
        const bytes = new TextEncoder().encode(decoded);
        return { bytes, mimeType };
      }
    }
  }

  throw new Error('Unsupported image source format');
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  if (typeof Buffer !== 'undefined') {
    return `data:${mimeType};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`;
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Serialize the entire project (nodes, images, adjustments, viewport, lock state) into a .lref ZIP archive.
 */
export async function exportProjectToLref(
  nodes: CanvasNode[],
  viewport: ViewportState,
  canvasLocked: boolean,
  noteFontSize?: number
): Promise<Uint8Array> {
  const zip = new JSZip();
  const imagesFolder = zip.folder('images');

  const metaNodes: ProjectFileMeta['nodes'] = [];

  for (const node of nodes) {
    if (node.type === 'image') {
      try {
        const { bytes, mimeType } = await imageSourceToBytes(node.src);
        const ext = getExtensionFromMimeType(mimeType);
        const filename = `${node.id}.${ext}`;
        const assetPath = `images/${filename}`;
        imagesFolder?.file(filename, bytes);

        const { src: _unusedSrc, ...rest } = node;
        metaNodes.push({
          ...rest,
          assetPath,
          mimeType
        });
      } catch (err) {
        console.warn(`[projectArchive] 导出图片节点 ${node.id} 失败，已跳过该图片:`, err);
      }
    } else {
      metaNodes.push({ ...node });
    }
  }

  const now = new Date().toISOString();
  const meta: ProjectFileMeta = {
    version: '1.3.0',
    createdAt: now,
    updatedAt: now,
    viewport,
    canvasLocked,
    ...(typeof noteFontSize === 'number' ? { noteFontSize } : {}),
    nodes: metaNodes
  };

  zip.file('meta.json', JSON.stringify(meta, null, 2));
  return await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

/**
 * Parse a .lref ZIP archive back into live CanvasNodes and ViewportState.
 */
export async function importProjectFromLref(
  data: ArrayBuffer | Uint8Array | Blob
): Promise<{
  nodes: CanvasNode[];
  viewport: ViewportState;
  canvasLocked: boolean;
  noteFontSize?: number;
}> {
  const zip = await JSZip.loadAsync(data);
  const metaFile = zip.file('meta.json');
  if (!metaFile) {
    throw new Error('Invalid .lref file: missing meta.json');
  }

  const metaText = await metaFile.async('string');
  const meta = JSON.parse(metaText) as ProjectFileMeta;

  const nodes: CanvasNode[] = [];

  for (const item of meta.nodes) {
    if (item.type === 'image') {
      if (!item.assetPath) {
        continue;
      }
      const imgFile = zip.file(item.assetPath);
      if (!imgFile) {
        continue;
      }
      const bytes = await imgFile.async('uint8array');
      const src = bytesToDataUrl(bytes, item.mimeType || 'image/png');

      const { assetPath: _ap, mimeType: _mt, ...rest } = item;
      const imageNode: ImageCanvasNode = {
        ...rest,
        src,
        rotation: rest.rotation ?? 0,
        flipX: rest.flipX ?? false,
        crop: rest.crop ?? { ...DEFAULT_CROP },
        adjustments: {
          ...DEFAULT_COLOR_ADJUSTMENTS,
          ...(rest.adjustments || {}),
          curvePoints: rest.adjustments?.curvePoints?.length
            ? rest.adjustments.curvePoints.map((p) => ({ ...p }))
            : DEFAULT_COLOR_ADJUSTMENTS.curvePoints.map((p) => ({ ...p }))
        }
      };
      nodes.push(imageNode);
    } else if (item.type === 'text') {
      nodes.push({ ...item });
    }
  }

  return {
    nodes,
    viewport: meta.viewport ?? { x: 0, y: 0, scale: 1, flipHorizontal: false },
    canvasLocked: Boolean(meta.canvasLocked),
    noteFontSize: typeof meta.noteFontSize === 'number' ? meta.noteFontSize : undefined
  };
}
