import { describe, it, expect } from 'vitest';
import {
  buildCurveLUT,
  buildCombinedLUT,
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
import { exportProjectToLref, importProjectFromLref } from '../projectArchive';
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
});
