import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Stage,
  Layer,
  Group,
  Image as KonvaImage,
  Rect,
  Text as KonvaText,
  Line,
  Transformer
} from 'react-konva';
import Konva from 'konva';
import {
  CanvasNode,
  DEFAULT_CROP,
  ImageCanvasNode,
  Point,
  SnapLine,
  TextCanvasNode,
  ViewportState
} from '../types';
import {
  renderOrientedUncroppedImage,
  renderProcessedImage
} from '../utils/imageProcessor';
import { computeSnapPosition } from '../utils/layoutAndSnap';

export interface ReferenceCanvasProps {
  nodes: CanvasNode[];
  selectedIds: string[];
  croppingNodeId: string | null;
  editingTextId: string | null;
  canvasLocked: boolean;
  viewport: ViewportState;
  spacePressed: boolean;
  xZoomPressed: boolean;
  onSelectIds: (ids: string[]) => void;
  onChangeViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
  onUpdateNodesTransient: (
    updates: Map<string, Partial<Pick<CanvasNode, 'x' | 'y' | 'width' | 'height' | 'zIndex'>>>
  ) => void;
  onRecordSnapshotBeforeDrag: (snapshot: CanvasNode[]) => void;
  onCreateTextNote: (worldPos: Point) => void;
  onStartEditText: (nodeId: string | null) => void;
  onUpdateTextNode: (
    nodeId: string,
    patch: Partial<Pick<TextCanvasNode, 'text' | 'fontSize' | 'color' | 'backgroundColor' | 'width' | 'height'>>
  ) => void;
  onOpenContextMenu: (screenX: number, screenY: number, targetImage: ImageCanvasNode | null) => void;
  onBringToFront?: (ids: string[]) => void;
  onPointerMoveWorld?: (worldPos: Point) => void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: ViewportState,
  windowWidth: number
): Point {
  const worldX = viewport.flipHorizontal
    ? (windowWidth - viewport.x - screenX) / viewport.scale
    : (screenX - viewport.x) / viewport.scale;
  const worldY = (screenY - viewport.y) / viewport.scale;
  return { x: worldX, y: worldY };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  viewport: ViewportState,
  windowWidth: number
): Point {
  const screenX = viewport.flipHorizontal
    ? windowWidth - viewport.x - worldX * viewport.scale
    : viewport.x + worldX * viewport.scale;
  const screenY = viewport.y + worldY * viewport.scale;
  return { x: screenX, y: screenY };
}

interface ImageNodeItemProps {
  node: ImageCanvasNode;
  isSelected: boolean;
  isCropping: boolean;
  canvasLocked: boolean;
  interactive: boolean;
  viewportScale: number;
  registerShapeRef: (id: string, ref: Konva.Node | null) => void;
  onNodeClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent | Event>, node: ImageCanvasNode) => void;
  onNodeContextMenu: (e: Konva.KonvaEventObject<PointerEvent>, node: ImageCanvasNode) => void;
  onNodeDragStart: (e: Konva.KonvaEventObject<DragEvent>, node: ImageCanvasNode) => void;
  onNodeDragMove: (e: Konva.KonvaEventObject<DragEvent>, node: ImageCanvasNode) => void;
  onNodeDragEnd: (e: Konva.KonvaEventObject<DragEvent>, node: ImageCanvasNode) => void;
  onNodeTransformEnd: (e: Konva.KonvaEventObject<Event>, node: ImageCanvasNode) => void;
}

const ImageNodeItem: React.FC<ImageNodeItemProps> = React.memo(
  ({
    node,
    isSelected,
    isCropping,
    canvasLocked,
    interactive,
    viewportScale,
    registerShapeRef,
    onNodeClick,
    onNodeContextMenu,
    onNodeDragStart,
    onNodeDragMove,
    onNodeDragEnd,
    onNodeTransformEnd
  }) => {
    const [htmlImg, setHtmlImg] = useState<HTMLImageElement | null>(null);

    useEffect(() => {
      let cancelled = false;
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!cancelled) {
          setHtmlImg(img);
        }
      };
      img.src = node.src;
      return () => {
        cancelled = true;
      };
    }, [node.src]);

    const renderedCanvas = useMemo(() => {
      if (!htmlImg) return null;
      if (isCropping) {
        return renderOrientedUncroppedImage(htmlImg, node);
      }
      return renderProcessedImage(htmlImg, node);
    }, [htmlImg, isCropping, node.rotation, node.flipX, node.crop, node.adjustments]);

    const prevCrop = node.crop || DEFAULT_CROP;
    const fullWorldWidth = node.width / Math.max(0.05, prevCrop.width);
    const fullWorldHeight = node.height / Math.max(0.05, prevCrop.height);
    const fullWorldX = node.x - prevCrop.x * fullWorldWidth;
    const fullWorldY = node.y - prevCrop.y * fullWorldHeight;

    const drawX = isCropping ? fullWorldX : node.x;
    const drawY = isCropping ? fullWorldY : node.y;
    const drawWidth = isCropping ? fullWorldWidth : node.width;
    const drawHeight = isCropping ? fullWorldHeight : node.height;

    const strokeWidth = 2 / Math.max(0.1, viewportScale);

    return (
      <Group
        id={node.id}
        ref={(ref) => registerShapeRef(node.id, ref)}
        x={drawX}
        y={drawY}
        width={drawWidth}
        height={drawHeight}
        draggable={!canvasLocked && interactive && !isCropping}
        onClick={(e) => onNodeClick(e, node)}
        onTap={(e) => onNodeClick(e, node)}
        onContextMenu={(e) => onNodeContextMenu(e, node)}
        onDragStart={(e) => onNodeDragStart(e, node)}
        onDragMove={(e) => onNodeDragMove(e, node)}
        onDragEnd={(e) => onNodeDragEnd(e, node)}
        onTransformEnd={(e) => onNodeTransformEnd(e, node)}
      >
        {renderedCanvas && (
          <KonvaImage
            image={renderedCanvas}
            x={0}
            y={0}
            width={drawWidth}
            height={drawHeight}
          />
        )}
        {isSelected && !isCropping && (
          <Rect
            x={0}
            y={0}
            width={drawWidth}
            height={drawHeight}
            stroke="#38bdf8"
            strokeWidth={strokeWidth}
            listening={false}
          />
        )}
      </Group>
    );
  }
);

export const ReferenceCanvas: React.FC<ReferenceCanvasProps> = ({
  nodes,
  selectedIds,
  croppingNodeId,
  editingTextId,
  canvasLocked,
  viewport,
  spacePressed,
  xZoomPressed,
  onSelectIds,
  onChangeViewport,
  onUpdateNodesTransient,
  onRecordSnapshotBeforeDrag,
  onCreateTextNote,
  onStartEditText,
  onUpdateTextNode,
  onOpenContextMenu,
  onBringToFront,
  onPointerMoveWorld
}) => {
  const [windowSize, setWindowSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800
  });

  const [isPanning, setIsPanning] = useState(false);
  const [isXZoomDragging, setIsXZoomDragging] = useState(false);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [selectionBox, setSelectionBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const shapeRefs = useRef<Map<string, Konva.Node>>(new Map());

  const panStateRef = useRef<{ lastClientX: number; lastClientY: number } | null>(null);
  const xZoomStateRef = useRef<{
    anchorScreenX: number;
    anchorScreenY: number;
    anchorWorldX: number;
    anchorWorldY: number;
    lastClientY: number;
  } | null>(null);

  const lastPointerScreenRef = useRef<{ x: number; y: number }>({
    x: windowSize.width / 2,
    y: windowSize.height / 2
  });

  const nodeDragStateRef = useRef<{
    draggedId: string;
    initialNodes: CanvasNode[];
    startPositions: Map<string, { x: number; y: number; width: number; height: number }>;
  } | null>(null);

  const registerShapeRef = useCallback((id: string, ref: Konva.Node | null) => {
    if (ref) {
      shapeRefs.current.set(id, ref);
    } else {
      shapeRefs.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize / reset X-key zoom anchor when xZoomPressed changes
  useEffect(() => {
    if (xZoomPressed) {
      const sx = lastPointerScreenRef.current.x;
      const sy = lastPointerScreenRef.current.y;
      const worldPt = screenToWorld(sx, sy, viewport, windowSize.width);
      xZoomStateRef.current = {
        anchorScreenX: sx,
        anchorScreenY: sy,
        anchorWorldX: worldPt.x,
        anchorWorldY: worldPt.y,
        lastClientY: sy
      };
    } else {
      xZoomStateRef.current = null;
      setIsXZoomDragging(false);
    }
  }, [xZoomPressed]);

  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => a.zIndex - b.zIndex);
  }, [nodes]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const hasSelectedImage = useMemo(() => {
    return nodes.some((n) => selectedSet.has(n.id) && n.type === 'image');
  }, [nodes, selectedSet]);

  // Attach Konva Transformer to selected nodes
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;

    if (canvasLocked || croppingNodeId || editingTextId || selectedIds.length === 0) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }

    const activeRefs: Konva.Node[] = [];
    for (const id of selectedIds) {
      const ref = shapeRefs.current.get(id);
      if (ref) {
        activeRefs.push(ref);
      }
    }
    tr.nodes(activeRefs);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, nodes, canvasLocked, croppingNodeId, editingTextId]);

  const zoomAtScreenPoint = useCallback(
    (screenX: number, screenY: number, scaleFactor: number) => {
      onChangeViewport((prev) => {
        const nextScale = clamp(prev.scale * scaleFactor, MIN_SCALE, MAX_SCALE);
        if (Math.abs(nextScale - prev.scale) < 1e-6) return prev;

        const worldPt = screenToWorld(screenX, screenY, prev, windowSize.width);
        const nextX = prev.flipHorizontal
          ? windowSize.width - screenX - worldPt.x * nextScale
          : screenX - worldPt.x * nextScale;
        const nextY = screenY - worldPt.y * nextScale;

        return {
          ...prev,
          x: nextX,
          y: nextY,
          scale: nextScale
        };
      });
    },
    [onChangeViewport, windowSize.width]
  );

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const clientX = e.evt.clientX;
    const clientY = e.evt.clientY;
    lastPointerScreenRef.current = { x: clientX, y: clientY };

    const deltaY = e.evt.deltaY;
    const factor = Math.exp(-deltaY * 0.0014);
    zoomAtScreenPoint(clientX, clientY, factor);
  };

  // Global mousemove / mouseup listeners for panning, X-zoom, and selection box
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      lastPointerScreenRef.current = { x: e.clientX, y: e.clientY };
      if (onPointerMoveWorld) {
        onPointerMoveWorld(screenToWorld(e.clientX, e.clientY, viewport, windowSize.width));
      }

      if (panStateRef.current) {
        const deltaX = e.clientX - panStateRef.current.lastClientX;
        const deltaY = e.clientY - panStateRef.current.lastClientY;
        panStateRef.current = { lastClientX: e.clientX, lastClientY: e.clientY };

        onChangeViewport((prev) => ({
          ...prev,
          x: prev.x + (prev.flipHorizontal ? -deltaX : deltaX),
          y: prev.y + deltaY
        }));
        return;
      }

      if (xZoomPressed && xZoomStateRef.current) {
        const dy = e.clientY - xZoomStateRef.current.lastClientY;
        xZoomStateRef.current.lastClientY = e.clientY;
        if (Math.abs(dy) > 0) {
          // Moving mouse up (dy < 0) zooms in, moving down (dy > 0) zooms out
          const factor = Math.exp(-dy * 0.0065);
          zoomAtScreenPoint(
            xZoomStateRef.current.anchorScreenX,
            xZoomStateRef.current.anchorScreenY,
            factor
          );
        }
        return;
      }
    };

    const handleWindowMouseUp = () => {
      if (panStateRef.current) {
        panStateRef.current = null;
        setIsPanning(false);
      }
      if (isXZoomDragging) {
        setIsXZoomDragging(false);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [
    viewport,
    windowSize.width,
    xZoomPressed,
    isXZoomDragging,
    onChangeViewport,
    zoomAtScreenPoint,
    onPointerMoveWorld
  ]);

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const evt = e.evt;
    lastPointerScreenRef.current = { x: evt.clientX, y: evt.clientY };

    // Middle mouse button or Space + Left mouse button => Pan canvas
    if (evt.button === 1 || (spacePressed && evt.button === 0)) {
      evt.preventDefault();
      panStateRef.current = { lastClientX: evt.clientX, lastClientY: evt.clientY };
      setIsPanning(true);
      return;
    }

    // X key + Left mouse button => Smooth zoom anchored at mouse down position
    if (xZoomPressed && evt.button === 0) {
      evt.preventDefault();
      const worldPt = screenToWorld(evt.clientX, evt.clientY, viewport, windowSize.width);
      xZoomStateRef.current = {
        anchorScreenX: evt.clientX,
        anchorScreenY: evt.clientY,
        anchorWorldX: worldPt.x,
        anchorWorldY: worldPt.y,
        lastClientY: evt.clientY
      };
      setIsXZoomDragging(true);
      return;
    }

    // Clicked on empty stage background with left button
    if (e.target === e.target.getStage() && evt.button === 0) {
      if (editingTextId) {
        onStartEditText(null);
      }
      if (!evt.shiftKey) {
        onSelectIds([]);
      }
      if (!canvasLocked && !croppingNodeId) {
        const worldPt = screenToWorld(evt.clientX, evt.clientY, viewport, windowSize.width);
        setSelectionBox({
          startX: worldPt.x,
          startY: worldPt.y,
          currentX: worldPt.x,
          currentY: worldPt.y
        });
      }
    }
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!selectionBox) return;
    const evt = e.evt;
    const worldPt = screenToWorld(evt.clientX, evt.clientY, viewport, windowSize.width);
    setSelectionBox((prev) =>
      prev
        ? {
            ...prev,
            currentX: worldPt.x,
            currentY: worldPt.y
          }
        : null
    );
  };

  const handleStageMouseUp = () => {
    if (!selectionBox) return;
    const minX = Math.min(selectionBox.startX, selectionBox.currentX);
    const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
    const minY = Math.min(selectionBox.startY, selectionBox.currentY);
    const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

    if (maxX - minX > 3 || maxY - minY > 3) {
      const hitIds = nodes
        .filter((n) => {
          const nx2 = n.x + n.width;
          const ny2 = n.y + n.height;
          return n.x < maxX && nx2 > minX && n.y < maxY && ny2 > minY;
        })
        .map((n) => n.id);
      onSelectIds(hitIds);
    }
    setSelectionBox(null);
  };

  const handleStageDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (canvasLocked || croppingNodeId || spacePressed || xZoomPressed) return;
    if (e.target === e.target.getStage()) {
      const worldPt = screenToWorld(e.evt.clientX, e.evt.clientY, viewport, windowSize.width);
      onCreateTextNote(worldPt);
    }
  };

  const handleStageContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    if (e.target === e.target.getStage()) {
      onOpenContextMenu(e.evt.clientX, e.evt.clientY, null);
    }
  };

  const handleNodeClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent | Event>, node: CanvasNode) => {
      if (spacePressed || xZoomPressed) return;
      e.cancelBubble = true;
      const isShift = Boolean((e.evt as MouseEvent).shiftKey);
      if (isShift) {
        if (selectedSet.has(node.id)) {
          onSelectIds(selectedIds.filter((id) => id !== node.id));
        } else {
          onSelectIds([...selectedIds, node.id]);
        }
      } else {
        if (!selectedSet.has(node.id)) {
          onSelectIds([node.id]);
        }
        if (onBringToFront) {
          onBringToFront([node.id]);
        }
      }
    },
    [spacePressed, xZoomPressed, selectedSet, selectedIds, onSelectIds, onBringToFront]
  );

  const handleImageContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>, node: ImageCanvasNode) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      if (!selectedSet.has(node.id)) {
        onSelectIds([node.id]);
      }
      onOpenContextMenu(e.evt.clientX, e.evt.clientY, node);
    },
    [selectedSet, onSelectIds, onOpenContextMenu]
  );

  const handleNodeDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, node: CanvasNode) => {
      if (canvasLocked || spacePressed || xZoomPressed) {
        e.target.stopDrag();
        return;
      }

      let activeSelection = selectedIds;
      if (!selectedSet.has(node.id)) {
        activeSelection = [node.id];
        onSelectIds(activeSelection);
      }

      if (onBringToFront) {
        onBringToFront(activeSelection);
      }

      const startPositions = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      for (const n of nodes) {
        if (activeSelection.includes(n.id)) {
          startPositions.set(n.id, {
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height
          });
        }
      }

      nodeDragStateRef.current = {
        draggedId: node.id,
        initialNodes: nodes,
        startPositions
      };

      onRecordSnapshotBeforeDrag(nodes);
    },
    [
      canvasLocked,
      spacePressed,
      xZoomPressed,
      selectedIds,
      selectedSet,
      nodes,
      onSelectIds,
      onBringToFront,
      onRecordSnapshotBeforeDrag
    ]
  );

  const handleNodeDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, node: CanvasNode) => {
      const dragState = nodeDragStateRef.current;
      if (!dragState) return;

      const startDragged = dragState.startPositions.get(node.id);
      if (!startDragged) return;

      const rawX = e.target.x();
      const rawY = e.target.y();

      const movingIds = new Set(dragState.startPositions.keys());
      const otherBoxes = nodes
        .filter((n) => !movingIds.has(n.id))
        .map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height
        }));

      const snapThresholdWorld = 8 / Math.max(0.05, viewport.scale);
      const snapped = computeSnapPosition(
        {
          x: rawX,
          y: rawY,
          width: startDragged.width,
          height: startDragged.height
        },
        otherBoxes,
        snapThresholdWorld
      );

      // Force Konva node position to snapped coordinate
      e.target.x(snapped.x);
      e.target.y(snapped.y);
      setSnapLines(snapped.snapLines);

      const dx = snapped.x - startDragged.x;
      const dy = snapped.y - startDragged.y;

      const updates = new Map<
        string,
        Partial<Pick<CanvasNode, 'x' | 'y' | 'width' | 'height' | 'zIndex'>>
      >();

      for (const [id, initBox] of dragState.startPositions.entries()) {
        const nextX = Math.round(initBox.x + dx);
        const nextY = Math.round(initBox.y + dy);
        updates.set(id, { x: nextX, y: nextY });

        if (id !== node.id) {
          const otherRef = shapeRefs.current.get(id);
          if (otherRef) {
            otherRef.x(nextX);
            otherRef.y(nextY);
          }
        }
      }

      onUpdateNodesTransient(updates);
    },
    [nodes, viewport.scale, onUpdateNodesTransient]
  );

  const handleNodeDragEnd = useCallback(() => {
    nodeDragStateRef.current = null;
    setSnapLines([]);
  }, []);

  const handleNodeTransformStart = useCallback(() => {
    if (canvasLocked) return;
    onRecordSnapshotBeforeDrag(nodes);
  }, [canvasLocked, nodes, onRecordSnapshotBeforeDrag]);

  const handleNodeTransformEnd = useCallback(
    (e: Konva.KonvaEventObject<Event>, node: CanvasNode) => {
      const target = e.target;
      const scaleX = target.scaleX();
      const scaleY = target.scaleY();

      target.scaleX(1);
      target.scaleY(1);

      const nextWidth = Math.max(24, Math.round(node.width * Math.abs(scaleX)));
      const nextHeight =
        node.type === 'image'
          ? Math.max(24, Math.round(node.height * Math.abs(scaleX)))
          : Math.max(24, Math.round(node.height * Math.abs(scaleY)));

      const updates = new Map<
        string,
        Partial<Pick<CanvasNode, 'x' | 'y' | 'width' | 'height' | 'zIndex'>>
      >();
      updates.set(node.id, {
        x: Math.round(target.x()),
        y: Math.round(target.y()),
        width: nextWidth,
        height: nextHeight
      });
      onUpdateNodesTransient(updates);
    },
    [onUpdateNodesTransient]
  );

  // Determine active editing text node
  const editingTextNode = useMemo(() => {
    if (!editingTextId) return null;
    const found = nodes.find((n): n is TextCanvasNode => n.id === editingTextId && n.type === 'text');
    return found ?? null;
  }, [editingTextId, nodes]);

  // Compute cursor style
  let cursorStyle = 'default';
  if (isPanning) {
    cursorStyle = 'grabbing';
  } else if (spacePressed) {
    cursorStyle = 'grab';
  } else if (xZoomPressed) {
    cursorStyle = 'ns-resize';
  }

  const stageX = viewport.flipHorizontal ? windowSize.width - viewport.x : viewport.x;
  const stageY = viewport.y;
  const stageScaleX = viewport.flipHorizontal ? -viewport.scale : viewport.scale;
  const stageScaleY = viewport.scale;

  const nodeInteractive = !spacePressed && !xZoomPressed;

  // Screen position for editing text note overlay
  const editingTextScreenRect = useMemo(() => {
    if (!editingTextNode) return null;
    const width = editingTextNode.width * viewport.scale;
    const height = editingTextNode.height * viewport.scale;
    const left = viewport.flipHorizontal
      ? windowSize.width - (editingTextNode.x * viewport.scale + viewport.x) - width
      : editingTextNode.x * viewport.scale + viewport.x;
    const top = editingTextNode.y * viewport.scale + viewport.y;
    return { left, top, width, height };
  }, [editingTextNode, viewport, windowSize.width]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        cursor: cursorStyle,
        backgroundColor: '#18181b',
        backgroundImage:
          'radial-gradient(rgba(113, 113, 122, 0.22) 1px, transparent 1px)',
        backgroundSize: '24px 24px'
      }}
    >
      <Stage
        ref={stageRef}
        width={windowSize.width}
        height={windowSize.height}
        x={stageX}
        y={stageY}
        scaleX={stageScaleX}
        scaleY={stageScaleY}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onDblClick={handleStageDblClick}
        onContextMenu={handleStageContextMenu}
      >
        <Layer>
          {sortedNodes.map((node) => {
            const isSelected = selectedSet.has(node.id);
            if (node.type === 'image') {
              return (
                <ImageNodeItem
                  key={node.id}
                  node={node}
                  isSelected={isSelected}
                  isCropping={croppingNodeId === node.id}
                  canvasLocked={canvasLocked}
                  interactive={nodeInteractive}
                  viewportScale={viewport.scale}
                  registerShapeRef={registerShapeRef}
                  onNodeClick={handleNodeClick}
                  onNodeContextMenu={handleImageContextMenu}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDragMove={handleNodeDragMove}
                  onNodeDragEnd={handleNodeDragEnd}
                  onNodeTransformEnd={handleNodeTransformEnd}
                />
              );
            }

            // TextCanvasNode
            const isEditing = editingTextId === node.id;
            const strokeWidth = 2 / Math.max(0.1, viewport.scale);
            return (
              <Group
                key={node.id}
                id={node.id}
                ref={(ref) => registerShapeRef(node.id, ref)}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                draggable={!canvasLocked && nodeInteractive && !isEditing}
                onClick={(e) => handleNodeClick(e, node)}
                onTap={(e) => handleNodeClick(e, node)}
                onDblClick={(e) => {
                  e.cancelBubble = true;
                  if (!canvasLocked) {
                    onStartEditText(node.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.evt.preventDefault();
                  e.cancelBubble = true;
                  if (!selectedSet.has(node.id)) {
                    onSelectIds([node.id]);
                  }
                  onOpenContextMenu(e.evt.clientX, e.evt.clientY, null);
                }}
                onDragStart={(e) => handleNodeDragStart(e, node)}
                onDragMove={(e) => handleNodeDragMove(e, node)}
                onDragEnd={handleNodeDragEnd}
                onTransformEnd={(e) => handleNodeTransformEnd(e, node)}
              >
                <Rect
                  x={0}
                  y={0}
                  width={node.width}
                  height={node.height}
                  fill={node.backgroundColor || 'rgba(30, 41, 59, 0.88)'}
                  cornerRadius={8}
                  stroke={isSelected ? '#38bdf8' : 'rgba(148, 163, 184, 0.35)'}
                  strokeWidth={isSelected ? strokeWidth : 1 / Math.max(0.1, viewport.scale)}
                />
                {!isEditing && (
                  <KonvaText
                    x={12}
                    y={10}
                    width={Math.max(20, node.width - 24)}
                    height={Math.max(20, node.height - 20)}
                    text={node.text}
                    fontSize={node.fontSize || 16}
                    fill={node.color || '#f3f4f6'}
                    lineHeight={1.4}
                    // Counter-flip text inside stage when global horizontal mirror is enabled so text remains readable
                    scaleX={viewport.flipHorizontal ? -1 : 1}
                    offsetX={viewport.flipHorizontal ? Math.max(20, node.width - 24) : 0}
                  />
                )}
              </Group>
            );
          })}

          {/* Snap alignment lines */}
          {snapLines.map((line, idx) => {
            const points =
              line.orientation === 'vertical'
                ? [line.position, line.start, line.position, line.end]
                : [line.start, line.position, line.end, line.position];
            return (
              <Line
                key={`snap-${idx}`}
                points={points}
                stroke="#38bdf8"
                strokeWidth={1.5 / Math.max(0.1, viewport.scale)}
                dash={[6 / Math.max(0.1, viewport.scale), 4 / Math.max(0.1, viewport.scale)]}
                listening={false}
              />
            );
          })}

          {/* Rubberband Selection Box */}
          {selectionBox && (
            <Rect
              x={Math.min(selectionBox.startX, selectionBox.currentX)}
              y={Math.min(selectionBox.startY, selectionBox.currentY)}
              width={Math.abs(selectionBox.currentX - selectionBox.startX)}
              height={Math.abs(selectionBox.currentY - selectionBox.startY)}
              fill="rgba(56, 189, 248, 0.12)"
              stroke="#38bdf8"
              strokeWidth={1 / Math.max(0.1, viewport.scale)}
              listening={false}
            />
          )}

          {/* Konva Transformer for proportional scaling */}
          <Transformer
            ref={transformerRef}
            keepRatio={hasSelectedImage}
            rotateEnabled={false}
            flipEnabled={false}
            enabledAnchors={
              hasSelectedImage
                ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                : [
                    'top-left',
                    'top-right',
                    'bottom-left',
                    'bottom-right',
                    'middle-left',
                    'middle-right',
                    'top-center',
                    'bottom-center'
                  ]
            }
            borderStroke="#38bdf8"
            anchorStroke="#18181b"
            anchorFill="#38bdf8"
            anchorSize={8}
            anchorCornerRadius={2}
            onTransformStart={handleNodeTransformStart}
            boundBoxFunc={(oldBox, newBox) => {
              if (Math.abs(newBox.width) < 24 || Math.abs(newBox.height) < 24) {
                return oldBox;
              }
              return newBox;
            }}
          />
        </Layer>
      </Stage>

      {/* Empty Canvas Guide Overlay */}
      {nodes.length === 0 && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            textAlign: 'center',
            color: '#71717a',
            backgroundColor: 'rgba(24, 24, 27, 0.72)',
            border: '1px dashed rgba(82, 82, 91, 0.7)',
            borderRadius: 14,
            padding: '28px 36px',
            maxWidth: 420
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: '#d4d4d8', marginBottom: 8 }}>
            linRef 绘画参考画布
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.8, color: '#a1a1aa' }}>
            <div>• 直接拖拽本地图片或 <code style={{ color: '#38bdf8' }}>.lref</code> 工程文件进入窗口</div>
            <div>• 按 <code style={{ color: '#38bdf8' }}>Cmd/Ctrl + V</code> 直接粘贴剪贴板参考图</div>
            <div>• 按 <code style={{ color: '#38bdf8' }}>T</code> 或双击空白处新建文字便签</div>
            <div>• 按 <code style={{ color: '#38bdf8' }}>?</code> 查看全部单键工作流快捷键</div>
          </div>
        </div>
      )}

      {/* Text Note Editing Floating Textarea */}
      {editingTextNode && editingTextScreenRect && (
        <textarea
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={editingTextNode.text}
          onChange={(e) =>
            onUpdateTextNode(editingTextNode.id, { text: e.target.value })
          }
          onBlur={() => onStartEditText(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              onStartEditText(null);
            }
          }}
          style={{
            position: 'fixed',
            left: editingTextScreenRect.left,
            top: editingTextScreenRect.top,
            width: Math.max(120, editingTextScreenRect.width),
            height: Math.max(60, editingTextScreenRect.height),
            padding: `${10 * viewport.scale}px ${12 * viewport.scale}px`,
            fontSize: `${(editingTextNode.fontSize || 16) * viewport.scale}px`,
            lineHeight: 1.4,
            color: editingTextNode.color || '#f3f4f6',
            backgroundColor: editingTextNode.backgroundColor || 'rgba(30, 41, 59, 0.96)',
            border: '2px solid #38bdf8',
            borderRadius: `${8 * viewport.scale}px`,
            outline: 'none',
            resize: 'none',
            zIndex: 1400,
            fontFamily: 'inherit'
          }}
        />
      )}
    </div>
  );
};

export default ReferenceCanvas;
