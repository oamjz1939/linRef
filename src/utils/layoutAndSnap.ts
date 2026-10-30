import { CanvasNode, Point, SnapLine, ViewportState } from '../types';

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute magnetic edge/center snapping when dragging a node or selection bounding box.
 */
export function computeSnapPosition(
  movingBox: { x: number; y: number; width: number; height: number },
  otherBoxes: Box[],
  snapDistanceWorld: number
): { x: number; y: number; snapLines: SnapLine[] } {
  if (otherBoxes.length === 0 || snapDistanceWorld <= 0) {
    return { x: movingBox.x, y: movingBox.y, snapLines: [] };
  }

  let bestDx = Infinity;
  let bestDy = Infinity;
  let snappedX = movingBox.x;
  let snappedY = movingBox.y;
  let verticalLine: SnapLine | null = null;
  let horizontalLine: SnapLine | null = null;

  const movingXPoints = [
    { offset: 0, value: movingBox.x },
    { offset: movingBox.width / 2, value: movingBox.x + movingBox.width / 2 },
    { offset: movingBox.width, value: movingBox.x + movingBox.width }
  ];

  const movingYPoints = [
    { offset: 0, value: movingBox.y },
    { offset: movingBox.height / 2, value: movingBox.y + movingBox.height / 2 },
    { offset: movingBox.height, value: movingBox.y + movingBox.height }
  ];

  for (const target of otherBoxes) {
    const targetXPoints = [
      target.x,
      target.x + target.width / 2,
      target.x + target.width
    ];
    const targetYPoints = [
      target.y,
      target.y + target.height / 2,
      target.y + target.height
    ];

    for (const mx of movingXPoints) {
      for (const tx of targetXPoints) {
        const diff = Math.abs(mx.value - tx);
        if (diff <= snapDistanceWorld && diff < bestDx) {
          bestDx = diff;
          snappedX = tx - mx.offset;
          const minY = Math.min(movingBox.y, target.y);
          const maxY = Math.max(
            movingBox.y + movingBox.height,
            target.y + target.height
          );
          verticalLine = {
            orientation: 'vertical',
            position: tx,
            start: minY,
            end: maxY
          };
        }
      }
    }

    for (const my of movingYPoints) {
      for (const ty of targetYPoints) {
        const diff = Math.abs(my.value - ty);
        if (diff <= snapDistanceWorld && diff < bestDy) {
          bestDy = diff;
          snappedY = ty - my.offset;
          const minX = Math.min(snappedX, target.x);
          const maxX = Math.max(snappedX + movingBox.width, target.x + target.width);
          horizontalLine = {
            orientation: 'horizontal',
            position: ty,
            start: minX,
            end: maxX
          };
        }
      }
    }
  }

  const snapLines: SnapLine[] = [];
  if (verticalLine) snapLines.push(verticalLine);
  if (horizontalLine) snapLines.push(horizontalLine);

  return {
    x: snappedX,
    y: snappedY,
    snapLines
  };
}

/**
 * Pack/arrange nodes into a clean grid layout while preserving each node's aspect ratio.
 * Returns updated positions and dimensions for the target nodes.
 */
export function computeGridLayout(
  nodes: CanvasNode[],
  options?: {
    gap?: number;
    targetCenter?: Point;
  }
): Map<string, { x: number; y: number; width: number; height: number }> {
  const result = new Map<string, { x: number; y: number; width: number; height: number }>();
  if (nodes.length === 0) return result;

  const gap = options?.gap ?? 24;

  // Compute current bounding box center if targetCenter is not provided
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const center: Point = options?.targetCenter ?? {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };

  // Compute median height for uniform row heights on images, preserving aspect ratio
  const heights = nodes.map((n) => n.height).sort((a, b) => a - b);
  const targetRowHeight = Math.max(120, Math.min(480, heights[Math.floor(heights.length / 2)] || 260));

  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows: Array<Array<{ id: string; width: number; height: number }>> = [];

  for (let i = 0; i < nodes.length; i += cols) {
    const slice = nodes.slice(i, i + cols).map((node) => {
      if (node.type === 'image') {
        const aspect = node.width / Math.max(1, node.height);
        return {
          id: node.id,
          width: Math.round(targetRowHeight * aspect),
          height: Math.round(targetRowHeight)
        };
      }
      return {
        id: node.id,
        width: node.width,
        height: node.height
      };
    });
    rows.push(slice);
  }

  const rowWidths = rows.map(
    (r) => r.reduce((acc, item) => acc + item.width, 0) + Math.max(0, r.length - 1) * gap
  );
  const rowHeights = rows.map((r) => Math.max(...r.map((item) => item.height)));

  const totalWidth = Math.max(...rowWidths, 0);
  const totalHeight =
    rowHeights.reduce((acc, h) => acc + h, 0) + Math.max(0, rows.length - 1) * gap;

  let currentY = center.y - totalHeight / 2;

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    const rHeight = rowHeights[rIdx];
    let currentX = center.x - totalWidth / 2;

    for (const item of row) {
      const yOffset = (rHeight - item.height) / 2;
      result.set(item.id, {
        x: Math.round(currentX),
        y: Math.round(currentY + yOffset),
        width: item.width,
        height: item.height
      });
      currentX += item.width + gap;
    }

    currentY += rHeight + gap;
  }

  return result;
}

/**
 * Compute viewport state that fits all given nodes comfortably inside the viewport window.
 */
export function computeFitViewport(
  nodes: CanvasNode[],
  viewportWidth: number,
  viewportHeight: number,
  padding = 64,
  currentFlipHorizontal = false
): ViewportState {
  if (nodes.length === 0) {
    return {
      x: 0,
      y: 0,
      scale: 1,
      flipHorizontal: currentFlipHorizontal
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const availW = Math.max(100, viewportWidth - padding * 2);
  const availH = Math.max(100, viewportHeight - padding * 2);

  const scale = Math.max(0.05, Math.min(4, Math.min(availW / contentW, availH / contentH)));

  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;

  const x = viewportWidth / 2 - contentCenterX * scale;
  const y = viewportHeight / 2 - contentCenterY * scale;

  return {
    x,
    y,
    scale,
    flipHorizontal: currentFlipHorizontal
  };
}
