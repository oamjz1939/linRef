export interface Point {
  x: number;
  y: number;
}

/**
 * Normalized crop rectangle in [0, 1] coordinate space of the oriented image.
 * Default (uncropped): { x: 0, y: 0, width: 1, height: 1 }
 */
export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Control point on the tone curve, both x (input) and y (output) in [0, 255].
 */
export interface CurvePoint {
  x: number;
  y: number;
}

export interface ColorAdjustments {
  /** 一键黑白（单图灰阶开关） */
  grayscale: boolean;
  /** 亮度 (-100 ~ 100) */
  brightness: number;
  /** 对比度 (-100 ~ 100) */
  contrast: number;
  /** 色阶黑场 (0 ~ 254) */
  levelsBlack: number;
  /** 色阶白场 (1 ~ 255) */
  levelsWhite: number;
  /** 色阶灰场 Gamma (0.2 ~ 3.0) */
  levelsGamma: number;
  /** 明暗交界线强化提取模式 */
  terminatorMode: boolean;
  /** 明暗交界线阈值/强度 (0 ~ 100) */
  terminatorThreshold: number;
  /** 曲线控制点，x 范围 [0, 255]，y 范围 [0, 255] */
  curvePoints: CurvePoint[];
}

export interface BaseCanvasNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface ImageCanvasNode extends BaseCanvasNode {
  type: 'image';
  name: string;
  /** Base64 Data URL or Blob URL of the original image */
  src: string;
  /** Original image pixel dimensions */
  naturalWidth: number;
  naturalHeight: number;
  /** Cumulative 90-degree rotation: 0, 90, 180, 270 */
  rotation: 0 | 90 | 180 | 270;
  /** Single-image horizontal mirror flip */
  flipX: boolean;
  /** Normalized crop in oriented space */
  crop: NormalizedCrop;
  /** Per-image color and tone adjustments */
  adjustments: ColorAdjustments;
}

export interface TextCanvasNode extends BaseCanvasNode {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
}

export type CanvasNode = ImageCanvasNode | TextCanvasNode;

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
  /** 全局视口水平镜像翻转 */
  flipHorizontal: boolean;
}

export interface SnapLine {
  orientation: 'vertical' | 'horizontal';
  position: number; // world X for vertical, world Y for horizontal
  start: number;
  end: number;
}

export interface ProjectFileMeta {
  version: string;
  createdAt: string;
  updatedAt: string;
  viewport: ViewportState;
  canvasLocked: boolean;
  /** 全局便签文字大小（px） */
  noteFontSize?: number;
  nodes: Array<
    | (Omit<ImageCanvasNode, 'src'> & { assetPath: string; mimeType: string })
    | TextCanvasNode
  >;
}

export const DEFAULT_COLOR_ADJUSTMENTS: ColorAdjustments = {
  grayscale: false,
  brightness: 0,
  contrast: 0,
  levelsBlack: 0,
  levelsWhite: 255,
  levelsGamma: 1.0,
  terminatorMode: false,
  terminatorThreshold: 50,
  curvePoints: [
    { x: 0, y: 0 },
    { x: 255, y: 255 }
  ]
};

export const DEFAULT_CROP: NormalizedCrop = {
  x: 0,
  y: 0,
  width: 1,
  height: 1
};
