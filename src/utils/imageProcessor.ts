import {
  ColorAdjustments,
  CurvePoint,
  DEFAULT_COLOR_ADJUSTMENTS,
  ImageCanvasNode,
  NormalizedCrop
} from '../types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clampByte(v: number): number {
  return clamp(Math.round(v), 0, 255);
}

/**
 * Normalize and deduplicate curve control points sorted by x ascending in [0, 255].
 */
export function normalizeCurvePoints(points: CurvePoint[]): CurvePoint[] {
  if (!points || points.length === 0) {
    return [
      { x: 0, y: 0 },
      { x: 255, y: 255 }
    ];
  }

  const clamped = points.map((p) => ({
    x: clamp(Math.round(p.x), 0, 255),
    y: clamp(Math.round(p.y), 0, 255)
  }));

  clamped.sort((a, b) => a.x - b.x);

  const deduped: CurvePoint[] = [];
  for (const pt of clamped) {
    if (deduped.length > 0 && deduped[deduped.length - 1].x === pt.x) {
      deduped[deduped.length - 1] = pt;
    } else {
      deduped.push(pt);
    }
  }

  if (deduped.length === 1) {
    const single = deduped[0];
    if (single.x === 0) {
      deduped.push({ x: 255, y: single.y });
    } else {
      deduped.unshift({ x: 0, y: single.y });
    }
  }

  return deduped;
}

/**
 * Build a 256-entry Look-Up Table (Uint8Array) from tone curve control points.
 * Uses linear interpolation for 2 points and Monotonic Cubic Hermite Spline (Fritsch-Carlson) for >= 3 points.
 */
export function buildCurveLUT(curvePoints: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  const pts = normalizeCurvePoints(curvePoints);
  const n = pts.length;

  const first = pts[0];
  const last = pts[n - 1];

  for (let x = 0; x <= first.x; x++) {
    lut[x] = clampByte(first.y);
  }
  for (let x = last.x; x <= 255; x++) {
    lut[x] = clampByte(last.y);
  }

  if (n === 2) {
    const dx = last.x - first.x;
    if (dx > 0) {
      for (let x = first.x; x <= last.x; x++) {
        const t = (x - first.x) / dx;
        lut[x] = clampByte(first.y + t * (last.y - first.y));
      }
    }
    return lut;
  }

  // Monotonic Cubic Hermite Spline (Fritsch-Carlson method)
  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const m: number[] = new Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    m[i] = dx[i] > 0 ? dy[i] / dx[i] : 0;
  }

  const tangents: number[] = new Array(n);
  tangents[0] = m[0];
  tangents[n - 1] = m[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangents[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / m[i];
      const beta = tangents[i + 1] / m[i];
      const hypot = Math.hypot(alpha, beta);
      if (hypot > 3) {
        const tau = 3 / hypot;
        tangents[i] = tau * alpha * m[i];
        tangents[i + 1] = tau * beta * m[i];
      }
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const h = dx[i];
    if (h <= 0) continue;

    for (let x = p0.x; x <= p1.x; x++) {
      const t = (x - p0.x) / h;
      const t2 = t * t;
      const t3 = t2 * t;

      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;

      const y = h00 * p0.y + h10 * h * tangents[i] + h01 * p1.y + h11 * h * tangents[i + 1];
      lut[x] = clampByte(y);
    }
  }

  return lut;
}

/**
 * Build a combined 256-entry LUT applying:
 * 1) Levels (black point, white point, gamma)
 * 2) Tone curve
 * 3) Brightness & Contrast
 * 4) Terminator mode (core shadow / light-dark boundary enhancement)
 */
export function buildCombinedLUT(adjustments: ColorAdjustments): Uint8Array {
  const curveLUT = buildCurveLUT(adjustments.curvePoints);
  const lut = new Uint8Array(256);

  const black = clamp(adjustments.levelsBlack, 0, 254);
  const white = clamp(adjustments.levelsWhite, black + 1, 255);
  const gamma = clamp(adjustments.levelsGamma, 0.2, 3.0);

  const brightnessOffset = (clamp(adjustments.brightness, -100, 100) / 100) * 128;
  const c = clamp(adjustments.contrast, -100, 100) * 2.55;
  const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));

  // Map terminatorThreshold (0..100) to luminance pivot (55..200)
  const thresholdPivot = 55 + (clamp(adjustments.terminatorThreshold, 0, 100) / 100) * 145;

  for (let i = 0; i < 256; i++) {
    // 1. Levels
    const normalized = clamp((i - black) / Math.max(1, white - black), 0, 1);
    const gammaCorrected = Math.pow(normalized, 1 / gamma) * 255;
    let v = clampByte(gammaCorrected);

    // 2. Tone curve
    v = curveLUT[v];

    // 3. Brightness & Contrast
    v = contrastFactor * (v + brightnessOffset - 128) + 128;
    v = clamp(v, 0, 255);

    // 4. Terminator mode (Core shadow / 明暗交界线强化)
    if (adjustments.terminatorMode) {
      const dist = v - thresholdPivot;
      // Steep S-curve around thresholdPivot + subtle posterized banding to highlight core shadow transition
      const steepness = 0.085;
      const sCurve = 1 / (1 + Math.exp(-steepness * dist));
      // Banding dip right at the terminator zone (|dist| < 18) to make the core shadow edge unmistakable
      const coreShadowDip = Math.exp(-(dist * dist) / (2 * 14 * 14)) * 38;
      const mapped = sCurve * 255 - coreShadowDip;
      // Quantize slightly into 12 tonal steps for clear value grouping while preserving smooth core shadow read
      const stepped = Math.round((clamp(mapped, 0, 255) / 255) * 12) * (255 / 12);
      v = clamp(mapped * 0.65 + stepped * 0.35, 0, 255);
    }

    lut[i] = clampByte(v);
  }

  return lut;
}

export function isDefaultAdjustments(adj: ColorAdjustments): boolean {
  if (
    adj.grayscale !== DEFAULT_COLOR_ADJUSTMENTS.grayscale ||
    adj.brightness !== DEFAULT_COLOR_ADJUSTMENTS.brightness ||
    adj.contrast !== DEFAULT_COLOR_ADJUSTMENTS.contrast ||
    adj.levelsBlack !== DEFAULT_COLOR_ADJUSTMENTS.levelsBlack ||
    adj.levelsWhite !== DEFAULT_COLOR_ADJUSTMENTS.levelsWhite ||
    Math.abs(adj.levelsGamma - DEFAULT_COLOR_ADJUSTMENTS.levelsGamma) > 0.001 ||
    adj.terminatorMode !== DEFAULT_COLOR_ADJUSTMENTS.terminatorMode
  ) {
    return false;
  }

  if (adj.curvePoints.length !== 2) return false;
  const [p0, p1] = adj.curvePoints;
  return p0.x === 0 && p0.y === 0 && p1.x === 255 && p1.y === 255;
}

/**
 * Transform normalized crop when the image is rotated 90 degrees clockwise.
 */
export function transformCropRotateCW(crop: NormalizedCrop): NormalizedCrop {
  return {
    x: clamp(1 - (crop.y + crop.height), 0, 1),
    y: clamp(crop.x, 0, 1),
    width: clamp(crop.height, 0.01, 1),
    height: clamp(crop.width, 0.01, 1)
  };
}

/**
 * Transform normalized crop when the image is rotated 90 degrees counter-clockwise.
 */
export function transformCropRotateCCW(crop: NormalizedCrop): NormalizedCrop {
  return {
    x: clamp(crop.y, 0, 1),
    y: clamp(1 - (crop.x + crop.width), 0, 1),
    width: clamp(crop.height, 0.01, 1),
    height: clamp(crop.width, 0.01, 1)
  };
}

/**
 * Transform normalized crop when the image is horizontally flipped.
 */
export function transformCropFlipX(crop: NormalizedCrop): NormalizedCrop {
  return {
    x: clamp(1 - (crop.x + crop.width), 0, 1),
    y: crop.y,
    width: crop.width,
    height: crop.height
  };
}

/**
 * Get the oriented pixel dimensions of an image after applying 90-degree rotation steps.
 */
export function getOrientedDimensions(
  naturalWidth: number,
  naturalHeight: number,
  rotation: 0 | 90 | 180 | 270
): { width: number; height: number } {
  if (rotation === 90 || rotation === 270) {
    return { width: naturalHeight, height: naturalWidth };
  }
  return { width: naturalWidth, height: naturalHeight };
}

function drawOrientedBaseCanvas(
  img: HTMLImageElement,
  rotation: 0 | 90 | 180 | 270,
  flipX: boolean
): HTMLCanvasElement {
  const natW = Math.max(1, img.naturalWidth || img.width || 1);
  const natH = Math.max(1, img.naturalHeight || img.height || 1);
  const { width: orientedW, height: orientedH } = getOrientedDimensions(natW, natH, rotation);

  const canvas = document.createElement('canvas');
  canvas.width = orientedW;
  canvas.height = orientedH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.save();
  ctx.translate(orientedW / 2, orientedH / 2);
  if (flipX) {
    ctx.scale(-1, 1);
  }
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -natW / 2, -natH / 2, natW, natH);
  ctx.restore();

  return canvas;
}

function applyColorAdjustmentsToCanvas(
  canvas: HTMLCanvasElement,
  adjustments: ColorAdjustments
): void {
  if (isDefaultAdjustments(adjustments)) return;

  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const lut = buildCombinedLUT(adjustments);
  const useGray = adjustments.grayscale || adjustments.terminatorMode;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (useGray) {
      // Rec.601 luma
      const lum = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
      const mapped = lut[lum];
      data[i] = mapped;
      data[i + 1] = mapped;
      data[i + 2] = mapped;
    } else {
      data[i] = lut[r];
      data[i + 1] = lut[g];
      data[i + 2] = lut[b];
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Render an image node with rotation, flipX, crop, and per-image color adjustments applied.
 */
export function renderProcessedImage(
  img: HTMLImageElement,
  node: Pick<ImageCanvasNode, 'rotation' | 'flipX' | 'crop' | 'adjustments'>
): HTMLCanvasElement {
  const orientedCanvas = drawOrientedBaseCanvas(img, node.rotation, node.flipX);
  const orientedW = orientedCanvas.width;
  const orientedH = orientedCanvas.height;

  const cropX = clamp(node.crop.x, 0, 0.99) * orientedW;
  const cropY = clamp(node.crop.y, 0, 0.99) * orientedH;
  const cropW = Math.max(1, clamp(node.crop.width, 0.01, 1 - node.crop.x) * orientedW);
  const cropH = Math.max(1, clamp(node.crop.height, 0.01, 1 - node.crop.y) * orientedH);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = Math.max(1, Math.round(cropW));
  outCanvas.height = Math.max(1, Math.round(cropH));

  const outCtx = outCanvas.getContext('2d');
  if (outCtx) {
    outCtx.drawImage(
      orientedCanvas,
      cropX,
      cropY,
      cropW,
      cropH,
      0,
      0,
      outCanvas.width,
      outCanvas.height
    );
  }

  applyColorAdjustmentsToCanvas(outCanvas, node.adjustments);
  return outCanvas;
}

/**
 * Render the oriented and color-adjusted full image without cropping (used for interactive crop overlay).
 */
export function renderOrientedUncroppedImage(
  img: HTMLImageElement,
  node: Pick<ImageCanvasNode, 'rotation' | 'flipX' | 'adjustments'>
): HTMLCanvasElement {
  const orientedCanvas = drawOrientedBaseCanvas(img, node.rotation, node.flipX);
  applyColorAdjustmentsToCanvas(orientedCanvas, node.adjustments);
  return orientedCanvas;
}
