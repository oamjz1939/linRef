import { useState, useCallback, useRef } from 'react';
import {
  CanvasNode,
  ColorAdjustments,
  DEFAULT_COLOR_ADJUSTMENTS,
  DEFAULT_CROP,
  ImageCanvasNode,
  NormalizedCrop,
  Point,
  TextCanvasNode,
  ViewportState
} from '../types';
import {
  getOrientedDimensions,
  transformCropFlipX,
  transformCropRotateCCW,
  transformCropRotateCW
} from '../utils/imageProcessor';
import { computeFitViewport, computeGridLayout } from '../utils/layoutAndSnap';

const MAX_HISTORY = 50;

function cloneNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map((n) => {
    if (n.type === 'image') {
      return {
        ...n,
        crop: { ...n.crop },
        adjustments: {
          ...n.adjustments,
          curvePoints: n.adjustments.curvePoints.map((p) => ({ ...p }))
        }
      };
    }
    return { ...n };
  });
}

export function useCanvasStore() {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [croppingNodeId, setCroppingNodeId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [canvasLocked, setCanvasLocked] = useState<boolean>(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(false);
  const [viewport, setViewport] = useState<ViewportState>({
    x: 0,
    y: 0,
    scale: 1,
    flipHorizontal: false
  });

  const pastRef = useRef<CanvasNode[][]>([]);
  const futureRef = useRef<CanvasNode[][]>([]);
  const lastAdjustmentCommitTimeRef = useRef<number>(0);
  const [, setHistoryTick] = useState(0);

  const pushHistory = useCallback((snapshot: CanvasNode[]) => {
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), cloneNodes(snapshot)];
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  const commitWithHistory = useCallback(
    (updater: (prev: CanvasNode[]) => CanvasNode[]) => {
      setNodes((prev) => {
        const next = updater(prev);
        if (next !== prev) {
          pushHistory(prev);
        }
        return next;
      });
    },
    [pushHistory]
  );

  const undo = useCallback(() => {
    if (canvasLocked || pastRef.current.length === 0) return;
    setNodes((current) => {
      const previous = pastRef.current[pastRef.current.length - 1];
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [cloneNodes(current), ...futureRef.current];
      setHistoryTick((t) => t + 1);
      return cloneNodes(previous);
    });
    setCroppingNodeId(null);
  }, [canvasLocked]);

  const redo = useCallback(() => {
    if (canvasLocked || futureRef.current.length === 0) return;
    setNodes((current) => {
      const next = futureRef.current[0];
      futureRef.current = futureRef.current.slice(1);
      pastRef.current = [...pastRef.current, cloneNodes(current)];
      setHistoryTick((t) => t + 1);
      return cloneNodes(next);
    });
    setCroppingNodeId(null);
  }, [canvasLocked]);

  const addImages = useCallback(
    (
      items: Array<{
        name: string;
        src: string;
        naturalWidth: number;
        naturalHeight: number;
      }>,
      dropCenterWorld: Point
    ) => {
      if (canvasLocked || items.length === 0) return;

      const createdIds: string[] = [];
      commitWithHistory((prev) => {
        const maxZ = prev.reduce((max, n) => Math.max(max, n.zIndex), 0);
        const cols = Math.ceil(Math.sqrt(items.length));
        const gap = 24;

        const newNodes: ImageCanvasNode[] = items.map((item, idx) => {
          const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${idx}`;
          createdIds.push(id);

          const maxInitialDim = 420;
          const scale = Math.min(
            1,
            maxInitialDim / Math.max(1, item.naturalWidth, item.naturalHeight)
          );
          const width = Math.max(40, Math.round(item.naturalWidth * scale));
          const height = Math.max(40, Math.round(item.naturalHeight * scale));

          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const x = Math.round(dropCenterWorld.x + (col - (cols - 1) / 2) * (width + gap) - width / 2);
          const y = Math.round(dropCenterWorld.y + row * (height + gap) - height / 2);

          return {
            id,
            type: 'image',
            name: item.name,
            src: item.src,
            naturalWidth: item.naturalWidth,
            naturalHeight: item.naturalHeight,
            x,
            y,
            width,
            height,
            zIndex: maxZ + idx + 1,
            rotation: 0,
            flipX: false,
            crop: { ...DEFAULT_CROP },
            adjustments: {
              ...DEFAULT_COLOR_ADJUSTMENTS,
              curvePoints: DEFAULT_COLOR_ADJUSTMENTS.curvePoints.map((p) => ({ ...p }))
            }
          };
        });

        return [...prev, ...newNodes];
      });

      setSelectedIds(createdIds);
    },
    [canvasLocked, commitWithHistory]
  );

  const addTextNote = useCallback(
    (centerWorld: Point, initialText = '双击编辑便签 / Note') => {
      if (canvasLocked) return;
      const id = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      commitWithHistory((prev) => {
        const maxZ = prev.reduce((max, n) => Math.max(max, n.zIndex), 0);
        const textNode: TextCanvasNode = {
          id,
          type: 'text',
          text: initialText,
          x: Math.round(centerWorld.x - 110),
          y: Math.round(centerWorld.y - 45),
          width: 220,
          height: 90,
          fontSize: 16,
          color: '#f3f4f6',
          backgroundColor: 'rgba(30, 41, 59, 0.88)',
          zIndex: maxZ + 1
        };
        return [...prev, textNode];
      });

      setSelectedIds([id]);
      setEditingTextId(id);
      return id;
    },
    [canvasLocked, commitWithHistory]
  );

  const updateNodesTransient = useCallback(
    (
      updates: Map<
        string,
        Partial<Pick<CanvasNode, 'x' | 'y' | 'width' | 'height' | 'zIndex'>>
      >
    ) => {
      if (canvasLocked) return;
      setNodes((prev) =>
        prev.map((node) => {
          const patch = updates.get(node.id);
          if (!patch) return node;
          return { ...node, ...patch };
        })
      );
    },
    [canvasLocked]
  );

  const recordSnapshotForBeforeDrag = useCallback(
    (snapshotBeforeDrag: CanvasNode[]) => {
      if (canvasLocked) return;
      pushHistory(snapshotBeforeDrag);
    },
    [canvasLocked, pushHistory]
  );

  const deleteSelected = useCallback(() => {
    if (canvasLocked || selectedIds.length === 0) return;
    const toRemove = new Set(selectedIds);
    commitWithHistory((prev) => prev.filter((n) => !toRemove.has(n.id)));
    setSelectedIds([]);
    setCroppingNodeId(null);
    setEditingTextId(null);
  }, [canvasLocked, commitWithHistory, selectedIds]);

  const bringToFront = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setNodes((prev) => {
        let maxZ = prev.reduce((m, n) => Math.max(m, n.zIndex), 0);
        return prev.map((n) => (idSet.has(n.id) ? { ...n, zIndex: ++maxZ } : n));
      });
    },
    []
  );

  const sendToBack = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setNodes((prev) => {
        let minZ = prev.reduce((m, n) => Math.min(m, n.zIndex), 0);
        return prev.map((n) => (idSet.has(n.id) ? { ...n, zIndex: --minZ } : n));
      });
    },
    []
  );

  const rotateSelected = useCallback(
    (direction: 'cw' | 'ccw') => {
      if (canvasLocked || selectedIds.length === 0) return;
      const idSet = new Set(selectedIds);

      commitWithHistory((prev) =>
        prev.map((node) => {
          if (!idSet.has(node.id) || node.type !== 'image') return node;

          const rotationDelta =
            direction === 'cw'
              ? node.flipX
                ? 270
                : 90
              : node.flipX
              ? 90
              : 270;
          const nextRotation = ((node.rotation + rotationDelta) % 360) as 0 | 90 | 180 | 270;

          const nextCrop =
            direction === 'cw'
              ? transformCropRotateCW(node.crop)
              : transformCropRotateCCW(node.crop);

          const centerX = node.x + node.width / 2;
          const centerY = node.y + node.height / 2;
          const nextWidth = node.height;
          const nextHeight = node.width;

          return {
            ...node,
            rotation: nextRotation,
            crop: nextCrop,
            x: Math.round(centerX - nextWidth / 2),
            y: Math.round(centerY - nextHeight / 2),
            width: nextWidth,
            height: nextHeight
          };
        })
      );
    },
    [canvasLocked, commitWithHistory, selectedIds]
  );

  const flipSelectedHorizontal = useCallback(() => {
    if (canvasLocked || selectedIds.length === 0) return;
    const idSet = new Set(selectedIds);

    commitWithHistory((prev) =>
      prev.map((node) => {
        if (!idSet.has(node.id) || node.type !== 'image') return node;
        return {
          ...node,
          flipX: !node.flipX,
          crop: transformCropFlipX(node.crop)
        };
      })
    );
  }, [canvasLocked, commitWithHistory, selectedIds]);

  const toggleSelectedGrayscale = useCallback(() => {
    if (canvasLocked || selectedIds.length === 0) return;
    const idSet = new Set(selectedIds);

    commitWithHistory((prev) => {
      const selectedImages = prev.filter(
        (n): n is ImageCanvasNode => idSet.has(n.id) && n.type === 'image'
      );
      if (selectedImages.length === 0) return prev;
      const shouldEnable = !selectedImages.every((img) => img.adjustments.grayscale);

      return prev.map((node) => {
        if (!idSet.has(node.id) || node.type !== 'image') return node;
        return {
          ...node,
          adjustments: {
            ...node.adjustments,
            grayscale: shouldEnable
          }
        };
      });
    });
  }, [canvasLocked, commitWithHistory, selectedIds]);

  const updateImageAdjustments = useCallback(
    (
      nodeIds: string[],
      patch: Partial<ColorAdjustments>,
      recordHistory = true
    ) => {
      if (canvasLocked || nodeIds.length === 0) return;
      const idSet = new Set(nodeIds);

      const updater = (prev: CanvasNode[]) =>
        prev.map((node) => {
          if (!idSet.has(node.id) || node.type !== 'image') return node;
          return {
            ...node,
            adjustments: {
              ...node.adjustments,
              ...patch,
              curvePoints: patch.curvePoints
                ? patch.curvePoints.map((p) => ({ ...p }))
                : node.adjustments.curvePoints
            }
          };
        });

      if (recordHistory) {
        const now = Date.now();
        const shouldPushSnapshot = now - lastAdjustmentCommitTimeRef.current > 450;
        lastAdjustmentCommitTimeRef.current = now;
        if (shouldPushSnapshot) {
          commitWithHistory(updater);
        } else {
          setNodes(updater);
        }
      } else {
        setNodes(updater);
      }
    },
    [canvasLocked, commitWithHistory]
  );

  const resetImageAdjustments = useCallback(
    (nodeIds: string[]) => {
      if (canvasLocked || nodeIds.length === 0) return;
      updateImageAdjustments(
        nodeIds,
        {
          ...DEFAULT_COLOR_ADJUSTMENTS,
          curvePoints: DEFAULT_COLOR_ADJUSTMENTS.curvePoints.map((p) => ({ ...p }))
        },
        true
      );
    },
    [canvasLocked, updateImageAdjustments]
  );

  const applyImageCrop = useCallback(
    (nodeId: string, newCrop: NormalizedCrop) => {
      if (canvasLocked) return;
      commitWithHistory((prev) =>
        prev.map((node) => {
          if (node.id !== nodeId || node.type !== 'image') return node;

          // Calculate the full uncropped world box from current node box + old crop
          const fullWorldWidth = node.width / Math.max(0.01, node.crop.width);
          const fullWorldHeight = node.height / Math.max(0.01, node.crop.height);
          const fullWorldX = node.x - node.crop.x * fullWorldWidth;
          const fullWorldY = node.y - node.crop.y * fullWorldHeight;

          const nextX = fullWorldX + newCrop.x * fullWorldWidth;
          const nextY = fullWorldY + newCrop.y * fullWorldHeight;
          const nextW = Math.max(20, fullWorldWidth * newCrop.width);
          const nextH = Math.max(20, fullWorldHeight * newCrop.height);

          return {
            ...node,
            x: Math.round(nextX),
            y: Math.round(nextY),
            width: Math.round(nextW),
            height: Math.round(nextH),
            crop: { ...newCrop }
          };
        })
      );
      setCroppingNodeId(null);
    },
    [canvasLocked, commitWithHistory]
  );

  const resetImageCrop = useCallback(
    (nodeId: string) => {
      if (canvasLocked) return;
      commitWithHistory((prev) =>
        prev.map((node) => {
          if (node.id !== nodeId || node.type !== 'image') return node;
          const oriented = getOrientedDimensions(
            node.naturalWidth,
            node.naturalHeight,
            node.rotation
          );
          const fullWorldWidth = node.width / Math.max(0.01, node.crop.width);
          const aspect = oriented.width / Math.max(1, oriented.height);
          const fullWorldHeight = fullWorldWidth / aspect;

          const centerX = node.x + node.width / 2;
          const centerY = node.y + node.height / 2;

          return {
            ...node,
            x: Math.round(centerX - fullWorldWidth / 2),
            y: Math.round(centerY - fullWorldHeight / 2),
            width: Math.round(fullWorldWidth),
            height: Math.round(fullWorldHeight),
            crop: { ...DEFAULT_CROP }
          };
        })
      );
      setCroppingNodeId(null);
    },
    [canvasLocked, commitWithHistory]
  );

  const updateTextNode = useCallback(
    (
      nodeId: string,
      patch: Partial<Pick<TextCanvasNode, 'text' | 'fontSize' | 'color' | 'backgroundColor' | 'width' | 'height'>>
    ) => {
      if (canvasLocked) return;
      const now = Date.now();
      const shouldPushSnapshot = now - lastAdjustmentCommitTimeRef.current > 600;
      lastAdjustmentCommitTimeRef.current = now;
      const updater = (prev: CanvasNode[]) =>
        prev.map((node) => {
          if (node.id !== nodeId || node.type !== 'text') return node;
          return { ...node, ...patch };
        });
      if (shouldPushSnapshot) {
        commitWithHistory(updater);
      } else {
        setNodes(updater);
      }
    },
    [canvasLocked, commitWithHistory]
  );

  const packGrid = useCallback(() => {
    if (canvasLocked || nodes.length === 0) return;
    const targetSet =
      selectedIds.length > 1
        ? new Set(selectedIds)
        : new Set(nodes.map((n) => n.id));

    commitWithHistory((prev) => {
      const targetNodes = prev.filter((n) => targetSet.has(n.id));
      const layoutMap = computeGridLayout(targetNodes);
      return prev.map((node) => {
        const box = layoutMap.get(node.id);
        if (!box) return node;
        return {
          ...node,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height
        };
      });
    });
  }, [canvasLocked, commitWithHistory, nodes, selectedIds]);

  const fitAllToViewport = useCallback(
    (viewportWidth: number, viewportHeight: number) => {
      const targetNodes =
        selectedIds.length > 0
          ? nodes.filter((n) => selectedIds.includes(n.id))
          : nodes;
      const nextVp = computeFitViewport(
        targetNodes.length > 0 ? targetNodes : nodes,
        viewportWidth,
        viewportHeight,
        64,
        viewport.flipHorizontal
      );
      setViewport(nextVp);
    },
    [nodes, selectedIds, viewport.flipHorizontal]
  );

  const toggleGlobalFlipHorizontal = useCallback(() => {
    setViewport((prev) => ({
      ...prev,
      flipHorizontal: !prev.flipHorizontal
    }));
  }, []);

  const loadProjectState = useCallback(
    (loaded: {
      nodes: CanvasNode[];
      viewport: ViewportState;
      canvasLocked: boolean;
    }) => {
      pastRef.current = [];
      futureRef.current = [];
      setNodes(loaded.nodes);
      setViewport(loaded.viewport);
      setCanvasLocked(loaded.canvasLocked);
      setSelectedIds([]);
      setCroppingNodeId(null);
      setEditingTextId(null);
      setHistoryTick((t) => t + 1);
    },
    []
  );

  const clearCanvas = useCallback(() => {
    if (canvasLocked || nodes.length === 0) return;
    commitWithHistory(() => []);
    setSelectedIds([]);
    setCroppingNodeId(null);
    setEditingTextId(null);
  }, [canvasLocked, commitWithHistory, nodes.length]);

  return {
    nodes,
    selectedIds,
    setSelectedIds,
    croppingNodeId,
    setCroppingNodeId,
    editingTextId,
    setEditingTextId,
    canvasLocked,
    setCanvasLocked,
    alwaysOnTop,
    setAlwaysOnTop,
    viewport,
    setViewport,
    canUndo: pastRef.current.length > 0 && !canvasLocked,
    canRedo: futureRef.current.length > 0 && !canvasLocked,
    undo,
    redo,
    addImages,
    addTextNote,
    updateNodesTransient,
    recordSnapshotForBeforeDrag,
    deleteSelected,
    bringToFront,
    sendToBack,
    rotateSelected,
    flipSelectedHorizontal,
    toggleSelectedGrayscale,
    updateImageAdjustments,
    resetImageAdjustments,
    applyImageCrop,
    resetImageCrop,
    updateTextNode,
    packGrid,
    fitAllToViewport,
    toggleGlobalFlipHorizontal,
    loadProjectState,
    clearCanvas,
    cloneNodes
  };
}

export type CanvasStore = ReturnType<typeof useCanvasStore>;
