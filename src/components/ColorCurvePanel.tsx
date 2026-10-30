import React, { useState, useRef, useMemo } from 'react';
import {
  ColorAdjustments,
  CurvePoint,
  DEFAULT_COLOR_ADJUSTMENTS,
  ImageCanvasNode
} from '../types';
import { X, RotateCcw, Sliders, Eye, Sparkles } from 'lucide-react';

export interface ColorCurvePanelProps {
  /** Currently targeted image node (alternative to passing adjustments directly) */
  node?: ImageCanvasNode;
  /** Direct color adjustments object (used if node is not provided) */
  adjustments?: ColorAdjustments;
  /** Optional display name of the image */
  imageName?: string;
  /** Callback when any adjustment changes */
  onChange: (patch: Partial<ColorAdjustments>) => void;
  /** Callback when resetting all adjustments */
  onReset?: () => void;
  /** Callback to close the panel */
  onClose: () => void;
}

const CURVE_PRESETS: Record<string, { label: string; points: CurvePoint[] }> = {
  reset: {
    label: '重置曲线',
    points: [
      { x: 0, y: 0 },
      { x: 255, y: 255 }
    ]
  },
  sContrast: {
    label: 'S型高对比',
    points: [
      { x: 0, y: 0 },
      { x: 64, y: 42 },
      { x: 192, y: 215 },
      { x: 255, y: 255 }
    ]
  },
  liftShadows: {
    label: '提亮暗部',
    points: [
      { x: 0, y: 28 },
      { x: 75, y: 105 },
      { x: 180, y: 192 },
      { x: 255, y: 255 }
    ]
  },
  dimHighlights: {
    label: '压暗高光',
    points: [
      { x: 0, y: 0 },
      { x: 85, y: 82 },
      { x: 185, y: 162 },
      { x: 255, y: 218 }
    ]
  }
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Evaluate monotone cubic / smooth piecewise curve for SVG path rendering
 */
function buildCurveSvgPath(points: CurvePoint[]): string {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) {
    return 'M 0 255 L 255 0';
  }
  if (sorted.length === 1) {
    const ySvg = 255 - clamp(sorted[0].y, 0, 255);
    return `M 0 ${ySvg} L 255 ${ySvg}`;
  }

  // Sample 64 segments using monotone cubic Hermite interpolation
  const n = sorted.length;
  const xs = sorted.map((p) => p.x);
  const ys = sorted.map((p) => p.y);

  const dys: number[] = [];
  const dxs: number[] = [];
  const ms: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const dx = Math.max(1e-5, xs[i + 1] - xs[i]);
    const dy = ys[i + 1] - ys[i];
    dxs.push(dx);
    dys.push(dy);
    ms.push(dy / dx);
  }

  const c1s: number[] = [ms[0]];
  for (let i = 0; i < dxs.length - 1; i++) {
    const m = ms[i];
    const mNext = ms[i + 1];
    if (m * mNext <= 0) {
      c1s.push(0);
    } else {
      const dx = dxs[i];
      const dxNext = dxs[i + 1];
      const common = dx + dxNext;
      c1s.push((3 * common) / ((common + dxNext) / m + (common + dx) / mNext));
    }
  }
  c1s.push(ms[ms.length - 1]);

  const c2s: number[] = [];
  const c3s: number[] = [];
  for (let i = 0; i < c1s.length - 1; i++) {
    const c1 = c1s[i];
    const m = ms[i];
    const invDx = 1 / dxs[i];
    const common = c1 + c1s[i + 1] - m - m;
    c2s.push((m - c1 - common) * invDx);
    c3s.push(common * invDx * invDx);
  }

  const evalAt = (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) {
      i++;
    }
    const diff = x - xs[i];
    const diffSq = diff * diff;
    return clamp(
      ys[i] + c1s[i] * diff + c2s[i] * diffSq + c3s[i] * diff * diffSq,
      0,
      255
    );
  };

  const parts: string[] = [];
  for (let x = 0; x <= 255; x += 3) {
    const y = evalAt(x);
    const svgY = (255 - y).toFixed(1);
    parts.push(`${x === 0 ? 'M' : 'L'} ${x} ${svgY}`);
  }
  const endY = (255 - evalAt(255)).toFixed(1);
  parts.push(`L 255 ${endY}`);
  return parts.join(' ');
}

export const ColorCurvePanel: React.FC<ColorCurvePanelProps> = ({
  node,
  adjustments: propAdjustments,
  imageName,
  onChange,
  onReset,
  onClose
}) => {
  const adjustments = node?.adjustments ?? propAdjustments ?? DEFAULT_COLOR_ADJUSTMENTS;
  const titleName = node?.name ?? imageName ?? '当前选中参考图';

  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>({
    x: Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 336),
    y: 64
  });
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);

  const sortedPoints = useMemo(() => {
    const pts =
      adjustments.curvePoints && adjustments.curvePoints.length >= 2
        ? [...adjustments.curvePoints]
        : [
            { x: 0, y: 0 },
            { x: 255, y: 255 }
          ];
    return pts.sort((a, b) => a.x - b.x);
  }, [adjustments.curvePoints]);

  const curveSvgPath = useMemo(() => buildCurveSvgPath(sortedPoints), [sortedPoints]);

  // Panel header dragging
  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOffsetRef.current = {
      dx: e.clientX - panelPos.x,
      dy: e.clientY - panelPos.y
    };
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffsetRef.current) return;
    const nextX = clamp(e.clientX - dragOffsetRef.current.dx, 8, window.innerWidth - 310);
    const nextY = clamp(e.clientY - dragOffsetRef.current.dy, 8, window.innerHeight - 100);
    setPanelPos({ x: nextX, y: nextY });
  };

  const handleHeaderPointerUp = () => {
    dragOffsetRef.current = null;
  };

  // Convert client mouse position to [0, 255] curve coordinates
  const clientToCurveCoords = (clientX: number, clientY: number): CurvePoint => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const normX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const normY = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    return {
      x: Math.round(normX * 255),
      y: Math.round(normY * 255)
    };
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const pt = clientToCurveCoords(e.clientX, e.clientY);

    // Check if clicking near an existing point (within 12 units)
    const hitIndex = sortedPoints.findIndex(
      (p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= 12
    );

    if (hitIndex !== -1) {
      setDraggingPointIndex(hitIndex);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Otherwise add a new point and start dragging it
    const nextPoints = [...sortedPoints, pt].sort((a, b) => a.x - b.x);
    const newIndex = nextPoints.findIndex((p) => p.x === pt.x && p.y === pt.y);
    onChange({ curvePoints: nextPoints });
    setDraggingPointIndex(newIndex !== -1 ? newIndex : null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingPointIndex === null) return;
    const pt = clientToCurveCoords(e.clientX, e.clientY);
    const nextPoints = [...sortedPoints];
    const isFirst = draggingPointIndex === 0;
    const isLast = draggingPointIndex === nextPoints.length - 1;

    if (isFirst) {
      nextPoints[0] = { x: 0, y: pt.y };
    } else if (isLast) {
      nextPoints[nextPoints.length - 1] = { x: 255, y: pt.y };
    } else {
      const minX = nextPoints[draggingPointIndex - 1].x + 2;
      const maxX = nextPoints[draggingPointIndex + 1].x - 2;
      nextPoints[draggingPointIndex] = {
        x: clamp(pt.x, minX, maxX),
        y: pt.y
      };
    }

    onChange({ curvePoints: nextPoints });
  };

  const handleSvgPointerUp = () => {
    setDraggingPointIndex(null);
  };

  const removePointAtIndex = (index: number) => {
    // Keep first (x=0) and last (x=255) endpoints
    if (index <= 0 || index >= sortedPoints.length - 1) return;
    const nextPoints = sortedPoints.filter((_, idx) => idx !== index);
    onChange({ curvePoints: nextPoints });
    setDraggingPointIndex(null);
  };

  const handleResetAll = () => {
    if (onReset) {
      onReset();
    } else {
      onChange({
        ...DEFAULT_COLOR_ADJUSTMENTS,
        curvePoints: [
          { x: 0, y: 0 },
          { x: 255, y: 255 }
        ]
      });
    }
  };

  return (
    <div
      className="app-no-drag"
      style={{
        position: 'fixed',
        left: panelPos.x,
        top: panelPos.y,
        width: 308,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        backgroundColor: 'rgba(24, 24, 27, 0.94)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(63, 63, 70, 0.85)',
        borderRadius: 12,
        boxShadow: '0 18px 40px rgba(0, 0, 0, 0.55)',
        color: '#f4f4f5',
        zIndex: 1000,
        fontSize: 12
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Draggable Header */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(63, 63, 70, 0.6)',
          cursor: 'grab',
          backgroundColor: 'rgba(39, 39, 42, 0.55)',
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <Sliders size={14} color="#38bdf8" />
          <span
            style={{
              fontWeight: 600,
              fontSize: 12.5,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 200
            }}
            title={titleName}
          >
            色彩与曲线 · {titleName}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="关闭面板"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a1a1aa',
            cursor: 'pointer',
            padding: 3,
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4
          }}
        >
          <X size={15} />
        </button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 1. 一键黑白开关 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            backgroundColor: adjustments.grayscale
              ? 'rgba(56, 189, 248, 0.14)'
              : 'rgba(39, 39, 42, 0.6)',
            border: adjustments.grayscale
              ? '1px solid rgba(56, 189, 248, 0.5)'
              : '1px solid rgba(63, 63, 70, 0.5)',
            borderRadius: 8
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Eye size={14} color={adjustments.grayscale ? '#38bdf8' : '#a1a1aa'} />
            <div>
              <div style={{ fontWeight: 600 }}>一键黑白观察 (B)</div>
              <div style={{ fontSize: 11, color: '#a1a1aa' }}>单图灰阶素描关系检查</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange({ grayscale: !adjustments.grayscale })}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              fontWeight: 600,
              fontSize: 11.5,
              cursor: 'pointer',
              backgroundColor: adjustments.grayscale ? '#0284c7' : '#3f3f46',
              color: '#ffffff'
            }}
          >
            {adjustments.grayscale ? '已开启' : '关闭'}
          </button>
        </div>

        {/* 2. 交互式曲线编辑器 (256x256) */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6
            }}
          >
            <span style={{ fontWeight: 600, color: '#e4e4e7' }}>色调曲线 (RGB)</span>
            <span style={{ fontSize: 10.5, color: '#71717a' }}>点击添加 / 双击或右键删点</span>
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '1 / 1',
              backgroundColor: '#121215',
              border: '1px solid #3f3f46',
              borderRadius: 8,
              overflow: 'hidden'
            }}
          >
            <svg
              ref={svgRef}
              viewBox="0 0 255 255"
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                cursor: 'crosshair',
                touchAction: 'none'
              }}
              onPointerDown={handleSvgPointerDown}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={handleSvgPointerUp}
            >
              {/* Grid lines (quarters) */}
              {[64, 128, 192].map((pos) => (
                <React.Fragment key={pos}>
                  <line
                    x1={pos}
                    y1={0}
                    x2={pos}
                    y2={255}
                    stroke="rgba(63, 63, 70, 0.45)"
                    strokeWidth="1"
                  />
                  <line
                    x1={0}
                    y1={pos}
                    x2={255}
                    y2={pos}
                    stroke="rgba(63, 63, 70, 0.45)"
                    strokeWidth="1"
                  />
                </React.Fragment>
              ))}

              {/* Diagonal reference baseline */}
              <line
                x1={0}
                y1={255}
                x2={255}
                y2={0}
                stroke="rgba(113, 113, 122, 0.45)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />

              {/* Interpolated Curve Path */}
              <path
                d={curveSvgPath}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.2"
                strokeLinecap="round"
              />

              {/* Control Points */}
              {sortedPoints.map((pt, idx) => {
                const cx = pt.x;
                const cy = 255 - pt.y;
                const isEndpoint = idx === 0 || idx === sortedPoints.length - 1;
                return (
                  <circle
                    key={`${idx}-${pt.x}`}
                    cx={cx}
                    cy={cy}
                    r={draggingPointIndex === idx ? 6 : 4.5}
                    fill={isEndpoint ? '#f4f4f5' : '#38bdf8'}
                    stroke="#18181b"
                    strokeWidth="1.5"
                    style={{ cursor: 'pointer' }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      removePointAtIndex(idx);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removePointAtIndex(idx);
                    }}
                  />
                );
              })}
            </svg>
          </div>

          {/* Curve Presets */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 5,
              marginTop: 7
            }}
          >
            {Object.entries(CURVE_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onChange({
                    curvePoints: preset.points.map((p) => ({ ...p }))
                  })
                }
                style={{
                  padding: '4px 4px',
                  fontSize: 11,
                  backgroundColor: '#27272a',
                  color: '#d4d4d8',
                  border: '1px solid #3f3f46',
                  borderRadius: 5,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* 3. 色阶与明暗滑块 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            paddingTop: 6,
            borderTop: '1px solid rgba(63, 63, 70, 0.5)'
          }}
        >
          <div style={{ fontWeight: 600, color: '#e4e4e7' }}>色阶与明暗调节</div>

          {/* 亮度 */}
          <SliderRow
            label="亮度"
            value={adjustments.brightness}
            min={-100}
            max={100}
            step={1}
            defaultValue={0}
            onChange={(val) => onChange({ brightness: val })}
          />

          {/* 对比度 */}
          <SliderRow
            label="对比度"
            value={adjustments.contrast}
            min={-100}
            max={100}
            step={1}
            defaultValue={0}
            onChange={(val) => onChange({ contrast: val })}
          />

          {/* 黑场 */}
          <SliderRow
            label="色阶黑场"
            value={adjustments.levelsBlack}
            min={0}
            max={254}
            step={1}
            defaultValue={0}
            onChange={(val) =>
              onChange({
                levelsBlack: Math.min(val, adjustments.levelsWhite - 1)
              })
            }
          />

          {/* 灰场 Gamma */}
          <SliderRow
            label="灰场 Gamma"
            value={adjustments.levelsGamma}
            min={0.2}
            max={3.0}
            step={0.05}
            defaultValue={1.0}
            formatValue={(v) => v.toFixed(2)}
            onChange={(val) => onChange({ levelsGamma: val })}
          />

          {/* 白场 */}
          <SliderRow
            label="色阶白场"
            value={adjustments.levelsWhite}
            min={1}
            max={255}
            step={1}
            defaultValue={255}
            onChange={(val) =>
              onChange({
                levelsWhite: Math.max(val, adjustments.levelsBlack + 1)
              })
            }
          />
        </div>

        {/* 4. 明暗交界线提取辅助 */}
        <div
          style={{
            padding: '9px 10px',
            backgroundColor: adjustments.terminatorMode
              ? 'rgba(245, 158, 11, 0.12)'
              : 'rgba(39, 39, 42, 0.55)',
            border: adjustments.terminatorMode
              ? '1px solid rgba(245, 158, 11, 0.45)'
              : '1px solid rgba(63, 63, 70, 0.5)',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles
                size={14}
                color={adjustments.terminatorMode ? '#fbbf24' : '#a1a1aa'}
              />
              <div>
                <div style={{ fontWeight: 600 }}>明暗交界线提取辅助</div>
                <div style={{ fontSize: 10.5, color: '#a1a1aa' }}>
                  强化光影受光与背光分界区域
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({ terminatorMode: !adjustments.terminatorMode })
              }
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                fontWeight: 600,
                fontSize: 11.5,
                cursor: 'pointer',
                backgroundColor: adjustments.terminatorMode ? '#d97706' : '#3f3f46',
                color: '#ffffff'
              }}
            >
              {adjustments.terminatorMode ? '已开启' : '关闭'}
            </button>
          </div>

          {adjustments.terminatorMode && (
            <SliderRow
              label="交界线阈值"
              value={adjustments.terminatorThreshold}
              min={0}
              max={100}
              step={1}
              defaultValue={50}
              onChange={(val) => onChange({ terminatorThreshold: val })}
            />
          )}
        </div>

        {/* 5. 全部重置按钮 */}
        <button
          type="button"
          onClick={handleResetAll}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            padding: '7px 12px',
            backgroundColor: '#27272a',
            border: '1px solid #3f3f46',
            borderRadius: 7,
            color: '#e4e4e7',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          <RotateCcw size={13} />
          全部重置为原图色彩
        </button>
      </div>
    </div>
  );
};

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  formatValue?: (val: number) => string;
  onChange: (val: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  formatValue,
  onChange
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: '#d4d4d8'
        }}
      >
        <span
          style={{ cursor: 'pointer' }}
          title="双击重置此项"
          onDoubleClick={() => onChange(defaultValue)}
        >
          {label}
        </span>
        <span
          style={{
            fontVariantNumeric: 'tabular-nums',
            color: value !== defaultValue ? '#38bdf8' : '#a1a1aa'
          }}
        >
          {formatValue ? formatValue(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange( Number(e.target.value) )}
        onDoubleClick={() => onChange(defaultValue)}
        style={{
          width: '100%',
          accentColor: '#38bdf8',
          cursor: 'pointer',
          height: 4
        }}
      />
    </div>
  );
};

export default ColorCurvePanel;
