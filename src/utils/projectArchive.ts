import JSZip from 'jszip';
import {
  CanvasNode,
  DEFAULT_COLOR_ADJUSTMENTS,
  DEFAULT_CROP,
  ImageCanvasNode,
  ProjectFileMeta,
  ViewportState
} from '../types';

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string; ext: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid Data URL format');
  }
  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  let ext = 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
  else if (mimeType.includes('webp')) ext = 'webp';
  else if (mimeType.includes('gif')) ext = 'gif';

  return { bytes, mimeType, ext };
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
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
      const { bytes, mimeType, ext } = dataUrlToBytes(node.src);
      const assetPath = `images/${node.id}.${ext}`;
      imagesFolder?.file(`${node.id}.${ext}`, bytes);

      const { src: _unusedSrc, ...rest } = node;
      metaNodes.push({
        ...rest,
        assetPath,
        mimeType
      });
    } else {
      metaNodes.push({ ...node });
    }
  }

  const now = new Date().toISOString();
  const meta: ProjectFileMeta = {
    version: '1.2.5',
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
