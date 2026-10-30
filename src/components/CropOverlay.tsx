import React, { useState, useEffect, useRef } from 'react';
import {
  ImageCanvasNode,
  NormalizedCrop,
  ViewportState,
  DEFAULT_CROP
} from '../types';
import { Check, RotateCcw, X, Crop } from 'lucide-react';

export interface CropOverlayProps {
  /** Image node being cropped */
  node: ImageCanvasNode;
  /** Current viewport state for coordinate mapping */
  viewport?: ViewportState;
  /** Optional controlled draft crop */
  draftCrop?: NormalizedCrop;
  /** Optional callback when draft crop changes while dragging */
  onChangeCrop?: (crop: NormalizedCrop) => void;
  /** Confirm crop with final NormalizedCrop */
  onConfirm: (crop: NormalizedCrop) => void;
  /** Reset to full uncropped image */
  onReset?: () => void;
  /** Cancel crop mode */
  onCancel: () => void;
}

type HandleType =
  | 'move'
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export const CropOverlay: React.FC<CropOverlayProps> = ({
  node,
  viewport = { x: 0, y: 0, scale: 1, flipHorizontal: false },
  draftCrop: controlledCrop,
  onChangeCrop,
  onConfirm,
  onReset,
  onCancel
}) => {
  const [internalCrop, setInternalCrop] = useState<NormalizedCrop>(
    controlledCrop ?? node.crop ?? DEFAULT_CROP
  );

  useEffect(() => {
    if (controlledCrop) {
      setInternalCrop(controlledCrop);
    }
  }, [controlledCrop]);

  useEffect(() => {
    setInternalCrop(controlledCrop ?? node.crop ?? DEFAULT_CROP);
  }, [node.id]);

  const crop = controlledCrop ?? internalCrop;

  const updateCrop = (next: NormalizedCrop) => {
    setInternalCrop(next);
    if (onChangeCrop) {
      onChangeCrop(next);
    }
  };

  // Compute full uncropped image bounding box in world coordinates based on node's current cropped box
  const prevCrop = node.crop || DEFAULT_CROP;
  const fullWorldWidth = node.width / Math.max(0.05, prevCrop.width);
  const fullWorldHeight = node.height / Math.max(0.05, prevCrop.height);
  const fullWorldX = node.x - prevCrop.x * fullWorldWidth;
  const fullWorldY = node.y - prevCrop.y * fullWorldHeight;

  const screenWidth = fullWorldWidth * viewport.scale;
  const screenHeight = fullWorldHeight * viewport.scale;
  const screenLeft = viewport.flipHorizontal
    ? window.innerWidth - (fullWorldX * viewport.scale + viewport.x) - screenWidth
    : fullWorldX * viewport.scale + viewport.x;
  const screenTop = fullWorldY * viewport.scale + viewport.y;

  const dragStateRef = useRef<{
    handle: HandleType;
    startClientX: number;
    startClientY: number;
    startCrop: NormalizedCrop;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm(crop);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [crop, onConfirm, onCancel]);

  const startHandleDrag = (
    e: React.PointerEvent<HTMLElement>,
    handle: HandleType
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCrop: { ...crop }
    };
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const st = dragStateRef.current;
    if (!st) return;
    e.stopPropagation();

    const rawDx = (e.clientX - st.startClientX) / Math.max(1, screenWidth);
    const dx = viewport.flipHorizontal ? -rawDx : rawDx;
    const dy = (e.clientY - st.startClientY) / Math.max(1, screenHeight);

    const minSize = 0.05;
    let { x, y, width, height } = st.startCrop;
    const right = x + width;
    const bottom = y + height;

    switch (st.handle) {
      case 'move': {
        x = clamp(x + dx, 0, 1 - width);
        y = clamp(y + dy, 0, 1 - height);
        break;
      }
      case 'nw': {
        const nextX = clamp(x + dx, 0, right - minSize);
        const nextY = clamp(y + dy, 0, bottom - minSize);
        width = right - nextX;
        height = bottom - nextY;
        x = nextX;
        y = nextY;
        break;
      }
      case 'ne': {
        const nextRight = clamp(right + dx, x + minSize, 1);
        const nextY = clamp(y + dy, 0, bottom - minSize);
        width = nextRight - x;
        height = bottom - nextY;
        y = nextY;
        break;
      }
      case 'se': {
        const nextRight = clamp(right + dx, x + minSize, 1);
        const nextBottom = clamp(bottom + dy, y + minSize, 1);
        width = nextRight - x;
        height = nextBottom - y;
        break;
      }
      case 'sw': {
        const nextX = clamp(x + dx, 0, right - minSize);
        const nextBottom = clamp(bottom + dy, y + minSize, 1);
        width = right - nextX;
        height = nextBottom - y;
        x = nextX;
        break;
      }
      case 'n': {
        const nextY = clamp(y + dy, 0, bottom - minSize);
        height = bottom - nextY;
        y = nextY;
        break;
      }
      case 's': {
        const nextBottom = clamp(bottom + dy, y + minSize, 1);
        height = nextBottom - y;
        break;
      }
      case 'w': {
        const nextX = clamp(x + dx, 0, right - minSize);
        width = right - nextX;
        x = nextX;
        break;
      }
      case 'e': {
        const nextRight = clamp(right + dx, x + minSize, 1);
        width = nextRight - x;
        break;
      }
    }

    updateCrop({ x, y, width, height });
  };

  const onHandlePointerUp = () => {
    dragStateRef.current = null;
  };

  const handleReset = () => {
    const resetVal: NormalizedCrop = { x: 0, y: 0, width: 1, height: 1 };
    updateCrop(resetVal);
    if (onReset) {
      onReset();
    }
  };

  const cropBoxLeft = screenLeft + crop.x * screenWidth;
  const cropBoxTop = screenTop + crop.y * screenHeight;
  const cropBoxWidth = crop.width * screenWidth;
  const cropBoxHeight = crop.height * screenHeight;

  return (
    <div
      className="app-no-drag"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1500,
        backgroundColor: 'rgba(9, 9, 11, 0.55)',
        userSelect: 'none'
      }}
    >
      {/* Full image reference ghost frame */}
      <div
        style={{
          position: 'absolute',
          left: screenLeft,
          top: screenTop,
          width: screenWidth,
          height: screenHeight,
          border: '1px dashed rgba(161, 161, 170, 0.45)',
          pointerEvents: 'none'
        }}
      />

      {/* Interactive Crop Box */}
      <div
        onPointerDown={(e) => startHandleDrag(e, 'move')}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        style={{
          position: 'absolute',
          left: cropBoxLeft,
          top: cropBoxTop,
          width: cropBoxWidth,
          height: cropBoxHeight,
          border: '2px solid #38bdf8',
          boxShadow: '0 0 0 9999px rgba(9, 9, 11, 0.62)',
          cursor: 'move',
          touchAction: 'none'
        }}
      >
        {/* Rule of Thirds Grid Lines */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '33.33%',
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.32)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '66.66%',
              top: 0,
              bottom: 0,
              width: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.32)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '33.33%',
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.32)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '66.66%',
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.32)'
            }}
          />
        </div>

        {/* 8 Resize Handles (4 corners + 4 edges) */}
        {(
          [
            { h: 'nw', left: -6, top: -6, cursor: 'nwse-resize' },
            { h: 'n', left: 'calc(50% - 6px)', top: -6, cursor: 'ns-resize' },
            { h: 'ne', right: -6, top: -6, cursor: 'nesw-resize' },
            { h: 'e', right: -6, top: 'calc(50% - 6px)', cursor: 'ew-resize' },
            { h: 'se', right: -6, bottom: -6, cursor: 'nwse-resize' },
            { h: 's', left: 'calc(50% - 6px)', bottom: -6, cursor: 'ns-resize' },
            { h: 'sw', left: -6, bottom: -6, cursor: 'nesw-resize' },
            { h: 'w', left: -6, top: 'calc(50% - 6px)', cursor: 'ew-resize' }
          ] as const
        ).map((item) => (
          <div
            key={item.h}
            onPointerDown={(e) => startHandleDrag(e, item.h)}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            style={{
              position: 'absolute',
              width: 12,
              height: 12,
              backgroundColor: '#38bdf8',
              border: '2px solid #18181b',
              borderRadius: 3,
              cursor: item.cursor,
              ...('left' in item ? { left: item.left } : {}),
              ...('right' in item ? { right: item.right } : {}),
              ...('top' in item ? { top: item.top } : {}),
              ...('bottom' in item ? { bottom: item.bottom } : {})
            }}
          />
        ))}
      </div>

      {/* Bottom Floating Action Bar */}
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 28,
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          backgroundColor: 'rgba(24, 24, 27, 0.95)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(63, 63, 70, 0.85)',
          borderRadius: 12,
          boxShadow: '0 14px 32px rgba(0, 0, 0, 0.6)',
          color: '#f4f4f5',
          fontSize: 12.5
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingRight: 8,
            borderRight: '1px solid rgba(63, 63, 70, 0.6)',
            color: '#a1a1aa'
          }}
        >
          <Crop size={14} color="#38bdf8" />
          <span style={{ fontWeight: 600, color: '#e4e4e7' }}>剪裁图片</span>
          <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
          </span>
        </div>

        <button
          type="button"
          onClick={() => onConfirm(crop)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 12px',
            borderRadius: 7,
            border: 'none',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          <Check size={14} />
          确认裁切 (Enter)
        </button>

        <button
          type="button"
          onClick={handleReset}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 7,
            border: '1px solid #3f3f46',
            backgroundColor: '#27272a',
            color: '#e4e4e7',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          <RotateCcw size={13} />
          重置原图
        </button>

        <button
          type="button"
          onClick={onCancel}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 7,
            border: '1px solid #3f3f46',
            backgroundColor: 'transparent',
            color: '#a1a1aa',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          <X size={14} />
          取消 (Esc)
        </button>
      </div>
    </div>
  );
};

export default CropOverlay;
