import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  buildCurveLUT,
  buildCombinedLUT,
  buildMonotoneCubicSpline,
  evaluateMonotoneCubicSpline,
  drawOrientedBaseCanvas,
  renderProcessedImage,
  transformCropRotateCW,
  transformCropRotateCCW,
  transformCropFlipX,
  getOrientedDimensions
} from '../imageProcessor';
import {
  computeSnapPosition,
  computeGridLayout,
  computeFitViewport
} from '../layoutAndSnap';
import {
  exportProjectToLref,
  importProjectFromLref,
  imageSourceToBytes,
  getExtensionFromMimeType
} from '../projectArchive';
import { getPathForFile, platformBridge } from '../platformBridge';
import {
  CanvasNode,
  DEFAULT_COLOR_ADJUSTMENTS,
  DEFAULT_CROP,
  ImageCanvasNode,
  ViewportState
} from '../../types';

describe('imageProcessor', () => {
  it('buildCurveLUT generates identity LUT for default 2-point curve', () => {
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 255, y: 255 }
    ]);
    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it('buildCurveLUT handles 3+ control points with monotonic cubic spline within [0, 255]', () => {
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 64, y: 40 },
      { x: 192, y: 220 },
      { x: 255, y: 255 }
    ]);
    expect(lut[0]).toBe(0);
    expect(lut[64]).toBe(40);
    expect(lut[192]).toBe(220);
    expect(lut[255]).toBe(255);
    // Ensure monotonic increase for strictly increasing control points
    for (let i = 1; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(255);
    }
  });

  it('buildMonotoneCubicSpline handles single control point and empty array', () => {
    const singleSpline = buildMonotoneCubicSpline([{ x: 100, y: 50 }]);
    expect(singleSpline(0)).toBe(50);
    expect(singleSpline(128)).toBe(50);
    expect(singleSpline(255)).toBe(50);

    const emptySpline = buildMonotoneCubicSpline([]);
    expect(emptySpline(0)).toBe(0);
    expect(emptySpline(128)).toBe(128);
    expect(emptySpline(255)).toBe(255);
  });

  it('evaluateMonotoneCubicSpline matches buildCurveLUT across all 256 entries', () => {
    const pts = [
      { x: 0, y: 10 },
      { x: 60, y: 30 },
      { x: 180, y: 210 },
      { x: 255, y: 245 }
    ];
    const lut = buildCurveLUT(pts);
    for (let x = 0; x < 256; x++) {
      expect(lut[x]).toBe(Math.max(0, Math.min(255, Math.round(evaluateMonotoneCubicSpline(pts, x)))));
    }
  });

  it('buildCombinedLUT applies levels, brightness, contrast, and terminator mode', () => {
    const lut = buildCombinedLUT({
      ...DEFAULT_COLOR_ADJUSTMENTS,
      levelsBlack: 20,
      levelsWhite: 235,
      brightness: 10,
      contrast: 20,
      terminatorMode: true,
      terminatorThreshold: 50
    });
    expect(lut).toHaveLength(256);
    // Below black point should map near 0
    expect(lut[0]).toBeLessThan(15);
    // Above white point should map near 255
    expect(lut[255]).toBeGreaterThan(240);
  });

  it('transforms normalized crop coordinates accurately across 90deg rotations and horizontal flip', () => {
    const initialCrop = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    let crop = initialCrop;
    // 4 clockwise rotations should return to original crop
    for (let i = 0; i < 4; i++) {
      crop = transformCropRotateCW(crop);
    }
    expect(crop.x).toBeCloseTo(initialCrop.x, 5);
    expect(crop.y).toBeCloseTo(initialCrop.y, 5);
    expect(crop.width).toBeCloseTo(initialCrop.width, 5);
    expect(crop.height).toBeCloseTo(initialCrop.height, 5);

    // CW followed by CCW should return to original crop
    const cwThenCcw = transformCropRotateCCW(transformCropRotateCW(initialCrop));
    expect(cwThenCcw.x).toBeCloseTo(initialCrop.x, 5);
    expect(cwThenCcw.y).toBeCloseTo(initialCrop.y, 5);

    // Double horizontal flip returns to original
    const doubleFlip = transformCropFlipX(transformCropFlipX(initialCrop));
    expect(doubleFlip.x).toBeCloseTo(initialCrop.x, 5);
    expect(doubleFlip.width).toBeCloseTo(initialCrop.width, 5);
  });

  it('getOrientedDimensions swaps width and height for 90 and 270 degrees', () => {
    expect(getOrientedDimensions(800, 600, 0)).toEqual({ width: 800, height: 600 });
    expect(getOrientedDimensions(800, 600, 90)).toEqual({ width: 600, height: 800 });
    expect(getOrientedDimensions(800, 600, 180)).toEqual({ width: 800, height: 600 });
    expect(getOrientedDimensions(800, 600, 270)).toEqual({ width: 600, height: 800 });
  });

  it('drawOrientedBaseCanvas and renderProcessedImage support targetCanvas reuse', () => {
    const mockCtx = {
      clearRect: () => {},
      save: () => {},
      scale: () => {},
      translate: () => {},
      rotate: () => {},
      drawImage: () => {},
      restore: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: () => {}
    };
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => mockCtx
    } as unknown as HTMLCanvasElement;

    const mockImg = {
      width: 200,
      height: 100,
      naturalWidth: 200,
      naturalHeight: 100
    } as unknown as HTMLImageElement;

    const oriented = drawOrientedBaseCanvas(mockImg, 90, false, mockCanvas);
    expect(oriented).toBe(mockCanvas);
    expect(mockCanvas.width).toBe(100);
    expect(mockCanvas.height).toBe(200);

    const processed = renderProcessedImage(
      mockImg,
      {
        rotation: 0,
        flipX: false,
        crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
        adjustments: DEFAULT_COLOR_ADJUSTMENTS
      },
      mockCanvas
    );
    expect(processed).toBe(mockCanvas);
    expect(mockCanvas.width).toBe(100);
    expect(mockCanvas.height).toBe(50);
  });
});

describe('layoutAndSnap', () => {
  it('computeSnapPosition snaps moving box edges and centers to nearby boxes', () => {
    const otherBoxes = [{ id: 'b1', x: 100, y: 100, width: 200, height: 150 }];
    // Moving box left edge at 96 (within 8px of 100) and top edge at 253 (within 8px of 250 bottom edge)
    const res = computeSnapPosition(
      { x: 96, y: 253, width: 120, height: 100 },
      otherBoxes,
      8
    );
    expect(res.x).toBe(100);
    expect(res.y).toBe(250);
    expect(res.snapLines.length).toBe(2);
  });

  it('computeGridLayout arranges nodes without overlap while preserving aspect ratio', () => {
    const nodes: CanvasNode[] = [
      {
        id: '1',
        type: 'image',
        name: 'a.png',
        src: '',
        naturalWidth: 400,
        naturalHeight: 200,
        x: 0,
        y: 0,
        width: 400,
        height: 200,
        zIndex: 1,
        rotation: 0,
        flipX: false,
        crop: DEFAULT_CROP,
        adjustments: DEFAULT_COLOR_ADJUSTMENTS
      },
      {
        id: '2',
        type: 'image',
        name: 'b.png',
        src: '',
        naturalWidth: 200,
        naturalHeight: 200,
        x: 10,
        y: 10,
        width: 200,
        height: 200,
        zIndex: 2,
        rotation: 0,
        flipX: false,
        crop: DEFAULT_CROP,
        adjustments: DEFAULT_COLOR_ADJUSTMENTS
      }
    ];

    const layout = computeGridLayout(nodes, { gap: 20 });
    const box1 = layout.get('1')!;
    const box2 = layout.get('2')!;
    expect(box1).toBeDefined();
    expect(box2).toBeDefined();
    // Aspect ratios preserved (box1 is 2:1, box2 is 1:1)
    expect(box1.width / box1.height).toBeCloseTo(2, 1);
    expect(box2.width / box2.height).toBeCloseTo(1, 1);
  });

  it('computeFitViewport centers all nodes inside viewport bounds', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'n1',
        type: 'text',
        text: 'Hello',
        x: 100,
        y: 100,
        width: 400,
        height: 200,
        fontSize: 16,
        color: '#fff',
        backgroundColor: '#000',
        zIndex: 1
      }
    ];
    const vp = computeFitViewport(nodes, 1000, 800, 50, true);
    expect(vp.flipHorizontal).toBe(true);
    expect(vp.scale).toBeGreaterThan(0);
    // Center of node (300, 200) mapped to screen center (500, 400)
    expect(300 * vp.scale + vp.x).toBeCloseTo(500, 2);
    expect(200 * vp.scale + vp.y).toBeCloseTo(400, 2);
  });
});

describe('projectArchive (.lref roundtrip)', () => {
  it('exports and imports nodes, image binary data, adjustments, crop, and viewport', async () => {
    // 1x1 transparent PNG base64
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const sampleNodes: CanvasNode[] = [
      {
        id: 'img_test_1',
        type: 'image',
        name: 'sample.png',
        src: tinyPng,
        naturalWidth: 100,
        naturalHeight: 80,
        x: 45,
        y: 60,
        width: 100,
        height: 80,
        zIndex: 1,
        rotation: 90,
        flipX: true,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        adjustments: {
          ...DEFAULT_COLOR_ADJUSTMENTS,
          grayscale: true,
          terminatorMode: true,
          terminatorThreshold: 62,
          curvePoints: [
            { x: 0, y: 10 },
            { x: 128, y: 140 },
            { x: 255, y: 250 }
          ]
        }
      },
      {
        id: 'txt_test_2',
        type: 'text',
        text: '光影结构笔记',
        x: 200,
        y: 120,
        width: 180,
        height: 70,
        fontSize: 18,
        color: '#ffffff',
        backgroundColor: '#1e293b',
        zIndex: 2
      }
    ];

    const viewport: ViewportState = {
      x: 120,
      y: -40,
      scale: 1.25,
      flipHorizontal: true
    };

    const bytes = await exportProjectToLref(sampleNodes, viewport, true, 22);
    expect(bytes.byteLength).toBeGreaterThan(100);

    const restored = await importProjectFromLref(bytes);
    expect(restored.canvasLocked).toBe(true);
    expect(restored.noteFontSize).toBe(22);
    expect(restored.viewport).toEqual(viewport);
    expect(restored.nodes).toHaveLength(2);

    const imgNode = restored.nodes[0] as ImageCanvasNode;
    expect(imgNode.type).toBe('image');
    expect(imgNode.src).toBe(tinyPng);
    expect(imgNode.rotation).toBe(90);
    expect(imgNode.flipX).toBe(true);
    expect(imgNode.crop).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(imgNode.adjustments.grayscale).toBe(true);
    expect(imgNode.adjustments.terminatorMode).toBe(true);
    expect(imgNode.adjustments.terminatorThreshold).toBe(62);
    expect(imgNode.adjustments.curvePoints).toHaveLength(3);
  });

  it('getExtensionFromMimeType correctly maps MIME types to extensions', () => {
    expect(getExtensionFromMimeType('image/jpeg')).toBe('jpg');
    expect(getExtensionFromMimeType('image/jpg')).toBe('jpg');
    expect(getExtensionFromMimeType('image/png')).toBe('png');
    expect(getExtensionFromMimeType('image/webp')).toBe('webp');
    expect(getExtensionFromMimeType('image/gif')).toBe('gif');
    expect(getExtensionFromMimeType('image/svg+xml')).toBe('svg');
    expect(getExtensionFromMimeType('image/bmp')).toBe('bmp');
    expect(getExtensionFromMimeType('unknown/custom')).toBe('png');
  });

  it('imageSourceToBytes decodes valid data URLs correctly', async () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await imageSourceToBytes(tinyPng);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.mimeType).toBe('image/png');
  });

  it('imageSourceToBytes handles data URLs with parameters, newlines, and whitespace', async () => {
    const dirtyDataUrl =
      'data:image/jpeg;charset=utf-8;base64,\r\n /9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA= \n';
    const result = await imageSourceToBytes(dirtyDataUrl);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.mimeType).toContain('jpeg');
  });

  it('imageSourceToBytes handles non-base64 percent-encoded data URLs', async () => {
    const svgData = 'data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E';
    const result = await imageSourceToBytes(svgData);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.mimeType).toBe('image/svg+xml');
  });

  it('imageSourceToBytes throws for invalid image source', async () => {
    await expect(imageSourceToBytes('')).rejects.toThrow();
    await expect(imageSourceToBytes('invalid-protocol://foo')).rejects.toThrow();
  });

  it('exportProjectToLref tolerates single image node failure without aborting entire project save', async () => {
    const validPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const nodesWithBroken: CanvasNode[] = [
      {
        id: 'broken_img',
        type: 'image',
        name: 'corrupted.png',
        src: 'invalid-source-that-cannot-be-fetched',
        naturalWidth: 100,
        naturalHeight: 100,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        rotation: 0,
        flipX: false,
        crop: DEFAULT_CROP,
        adjustments: DEFAULT_COLOR_ADJUSTMENTS
      },
      {
        id: 'valid_img',
        type: 'image',
        name: 'valid.png',
        src: validPng,
        naturalWidth: 50,
        naturalHeight: 50,
        x: 120,
        y: 0,
        width: 50,
        height: 50,
        zIndex: 2,
        rotation: 0,
        flipX: false,
        crop: DEFAULT_CROP,
        adjustments: DEFAULT_COLOR_ADJUSTMENTS
      },
      {
        id: 'note_1',
        type: 'text',
        text: 'Save test note',
        x: 200,
        y: 0,
        width: 100,
        height: 50,
        fontSize: 14,
        color: '#fff',
        backgroundColor: '#000',
        zIndex: 3
      }
    ];

    const vp: ViewportState = { x: 0, y: 0, scale: 1, flipHorizontal: false };
    const bytes = await exportProjectToLref(nodesWithBroken, vp, false);
    expect(bytes.byteLength).toBeGreaterThan(50);

    const restored = await importProjectFromLref(bytes);
    // The valid image and text note should be restored, while the corrupted image is safely omitted
    expect(restored.nodes).toHaveLength(2);
    expect(restored.nodes.map((n) => n.id)).toEqual(['valid_img', 'note_1']);
  });

  it('exportProjectToLref stores image binary with STORE compression', async () => {
    const fakeDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const imageNode: ImageCanvasNode = {
      id: 'store_test_img',
      type: 'image',
      name: 'store_test.png',
      naturalWidth: 100,
      naturalHeight: 100,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 1,
      rotation: 0,
      flipX: false,
      crop: DEFAULT_CROP,
      adjustments: DEFAULT_COLOR_ADJUSTMENTS,
      src: fakeDataUrl
    };

    const bytes = await exportProjectToLref([imageNode], { x: 0, y: 0, scale: 1, flipHorizontal: false }, false);
    const zip = await JSZip.loadAsync(bytes);
    const metaEntry = zip.file('meta.json');
    expect(metaEntry).not.toBeNull();
    const imageEntry = zip.file('images/store_test_img.png');
    expect(imageEntry).not.toBeNull();
  });

  it('platformBridge exports required methods and excludes redundant aliases', () => {
    expect(typeof platformBridge.isElectron).toBe('function');
    expect(typeof platformBridge.getPathForFile).toBe('function');
    expect(typeof platformBridge.copyImageToClipboard).toBe('function');
    expect(typeof platformBridge.readImageFromClipboard).toBe('function');
    expect(typeof platformBridge.saveProjectFile).toBe('function');
    expect(typeof platformBridge.openProjectFile).toBe('function');
    // Redundant aliases should not exist on platformBridge object
    expect((platformBridge as any).writeClipboardImage).toBeUndefined();
    expect((platformBridge as any).readClipboardImage).toBeUndefined();
    expect((platformBridge as any).saveProject).toBeUndefined();
    expect((platformBridge as any).openProject).toBeUndefined();
  });

  it('platformBridge getPathForFile falls back gracefully when window.electronAPI is missing or throws', () => {
    const dummyFile = new File(['test'], 'sample.lref');
    const path = getPathForFile(dummyFile);
    expect(path).toBe('');

    // Mocking window.electronAPI on globalThis
    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      electronAPI: {
        getPathForFile: (f: File) => `/custom/absolute/path/${f.name}`
      }
    };
    expect(getPathForFile(dummyFile)).toBe('/custom/absolute/path/sample.lref');

    // Clean up
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  });
});
