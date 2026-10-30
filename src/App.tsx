import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useCanvasStore } from './store/useCanvasStore';
import { ReferenceCanvas, screenToWorld } from './components/ReferenceCanvas';
import { FloatingHud } from './components/FloatingHud';
import { ContextMenu } from './components/ContextMenu';
import { ColorCurvePanel } from './components/ColorCurvePanel';
import { CropOverlay } from './components/CropOverlay';
import { CanvasNode, ImageCanvasNode, Point } from './types';
import { renderProcessedImage } from './utils/imageProcessor';
import { exportProjectToLref, importProjectFromLref } from './utils/projectArchive';
import {
  blobToDataUrl,
  copyImageToClipboard,
  getAlwaysOnTop,
  openProjectFile,
  readImageFromClipboard,
  saveProjectFile,
  setAlwaysOnTop as bridgeSetAlwaysOnTop
} from './utils/platformBridge';

function loadImageDimensions(src: string): Promise<{ width: number; height: number; img: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve({
        width: Math.max(1, img.naturalWidth || img.width || 240),
        height: Math.max(1, img.naturalHeight || img.height || 240),
        img
      });
    };
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name);
}

export const App: React.FC = () => {
  const store = useCanvasStore();
  const {
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
    noteFontSize,
    changeGlobalNoteFontSize,
    viewport,
    setViewport,
    canUndo,
    canRedo,
    undo,
    redo,
    addImages,
    addTextNote,
    updateNodesTransient,
    recordSnapshotForBeforeDrag,
    deleteSelected,
    bringToFront,
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
    loadProjectState
  } = store;

  const [spacePressed, setSpacePressed] = useState(false);
  const [xZoomPressed, setXZoomPressed] = useState(false);
  const [showColorCurvePanel, setShowColorCurvePanel] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | undefined>(undefined);

  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    targetNode: CanvasNode | null;
  } | null>(null);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const lastWorldPosRef = useRef<Point>({ x: 400, y: 300 });
  const internalClipboardImageRef = useRef<{
    name: string;
    src: string;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
    }, 1800);
  }, []);

  // Sync initial AlwaysOnTop state from Electron
  useEffect(() => {
    getAlwaysOnTop()
      .then((val) => setAlwaysOnTop(val))
      .catch(() => {});
  }, [setAlwaysOnTop]);

  // Currently selected image nodes
  const selectedImageNodes = useMemo(() => {
    const idSet = new Set(selectedIds);
    return nodes.filter((n): n is ImageCanvasNode => idSet.has(n.id) && n.type === 'image');
  }, [nodes, selectedIds]);

  const primarySelectedImage = selectedImageNodes[0] ?? null;

  const croppingNode = useMemo(() => {
    if (!croppingNodeId) return null;
    return nodes.find((n): n is ImageCanvasNode => n.id === croppingNodeId && n.type === 'image') ?? null;
  }, [croppingNodeId, nodes]);

  const getViewportCenterWorld = useCallback((): Point => {
    return screenToWorld(
      window.innerWidth / 2,
      window.innerHeight / 2,
      viewport,
      window.innerWidth
    );
  }, [viewport]);

  // Import local image files at a target world coordinate
  const importImageFilesAt = useCallback(
    async (files: File[], dropWorldPos: Point) => {
      if (canvasLocked) {
        showToast('画布已锁定，请按 L 解锁后再导入');
        return;
      }
      const loadedItems: Array<{
        name: string;
        src: string;
        naturalWidth: number;
        naturalHeight: number;
      }> = [];

      for (const file of files) {
        if (!isSupportedImageFile(file)) continue;
        try {
          const dataUrl = await blobToDataUrl(file);
          const dims = await loadImageDimensions(dataUrl);
          loadedItems.push({
            name: file.name.replace(/\.[^.]+$/, '') || '参考图',
            src: dataUrl,
            naturalWidth: dims.width,
            naturalHeight: dims.height
          });
        } catch {
          // Skip invalid image
        }
      }

      if (loadedItems.length > 0) {
        addImages(loadedItems, dropWorldPos);
        showToast(`已导入 ${loadedItems.length} 张参考图`);
      }
    },
    [canvasLocked, addImages, showToast]
  );

  // Trigger file picker for importing local images
  const handleImportImagesFromPicker = useCallback(() => {
    if (canvasLocked) {
      showToast('画布已锁定，请按 L 解锁后再导入');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg';
    input.style.display = 'none';

    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
      if (files.length > 0) {
        await importImageFilesAt(files, getViewportCenterWorld());
      }
    };

    document.body.appendChild(input);
    input.click();
  }, [canvasLocked, importImageFilesAt, getViewportCenterWorld, showToast]);

  // Copy selected image (with crop, rotation, flipX, and color adjustments) to clipboard
  const handleCopySelectedImage = useCallback(async () => {
    if (!primarySelectedImage) {
      showToast('请先选中要复制的图片');
      return;
    }
    try {
      const { img } = await loadImageDimensions(primarySelectedImage.src);
      const processedCanvas = renderProcessedImage(img, primarySelectedImage);
      const pngDataUrl = processedCanvas.toDataURL('image/png');

      internalClipboardImageRef.current = {
        name: `${primarySelectedImage.name}_copy`,
        src: pngDataUrl,
        naturalWidth: processedCanvas.width,
        naturalHeight: processedCanvas.height
      };

      await copyImageToClipboard(pngDataUrl);
      showToast('已复制图片到剪贴板');
    } catch {
      showToast('复制图片失败');
    }
  }, [primarySelectedImage, showToast]);

  // Paste image from system clipboard or internal fallback
  const handlePasteFromClipboard = useCallback(
    async (targetWorld?: Point) => {
      if (canvasLocked) {
        showToast('画布已锁定，请按 L 解锁后再粘贴');
        return;
      }
      const center = targetWorld ?? lastWorldPosRef.current ?? getViewportCenterWorld();
      try {
        const clipboardDataUrl = await readImageFromClipboard();
        if (clipboardDataUrl) {
          const dims = await loadImageDimensions(clipboardDataUrl);
          addImages(
            [
              {
                name: `剪贴板图片_${new Date().toLocaleTimeString()}`,
                src: clipboardDataUrl,
                naturalWidth: dims.width,
                naturalHeight: dims.height
              }
            ],
            center
          );
          showToast('已从剪贴板粘贴参考图');
          return;
        }
      } catch {
        // Fallback to internal clipboard
      }

      if (internalClipboardImageRef.current) {
        addImages([internalClipboardImageRef.current], center);
        showToast('已粘贴参考图副本');
      } else {
        showToast('剪贴板中没有可用的图片');
      }
    },
    [canvasLocked, getViewportCenterWorld, addImages, showToast]
  );

  // Create a text note and immediately enter editing mode
  const handleCreateTextNote = useCallback(
    (worldPos?: Point) => {
      if (canvasLocked) {
        showToast('画布已锁定，请按 L 解锁后再新建便签');
        return;
      }
      const pt = worldPos ?? lastWorldPosRef.current ?? getViewportCenterWorld();
      addTextNote(pt, '双击编辑便签 / Note');
    },
    [canvasLocked, getViewportCenterWorld, addTextNote, showToast]
  );

  // Toggle Canvas Lock
  const handleToggleCanvasLock = useCallback(() => {
    setCanvasLocked((prev) => {
      const next = !prev;
      showToast(next ? '画布已锁定 (L)' : '画布已解锁 (L)');
      return next;
    });
    setCroppingNodeId(null);
    setEditingTextId(null);
  }, [setCanvasLocked, setCroppingNodeId, setEditingTextId, showToast]);

  // Toggle Always on Top
  const handleToggleAlwaysOnTop = useCallback(async () => {
    const next = !alwaysOnTop;
    const applied = await bridgeSetAlwaysOnTop(next);
    setAlwaysOnTop(applied);
    showToast(applied ? '已开启窗口置顶 (P)' : '已关闭窗口置顶 (P)');
  }, [alwaysOnTop, setAlwaysOnTop, showToast]);

  // Save .lref project
  const handleSaveProject = useCallback(async () => {
    try {
      const bytes = await exportProjectToLref(nodes, viewport, canvasLocked, noteFontSize);
      const res = await saveProjectFile(bytes, currentProjectPath);
      if (res.saved) {
        if (res.filePath) {
          setCurrentProjectPath(res.filePath);
        }
        showToast('工程已保存 (.lref)');
      }
    } catch {
      showToast('保存工程失败');
    }
  }, [nodes, viewport, canvasLocked, noteFontSize, currentProjectPath, showToast]);

  // Open .lref project
  const handleOpenProject = useCallback(async () => {
    try {
      const res = await openProjectFile();
      if (res.canceled || !res.data) return;
      const loaded = await importProjectFromLref(res.data);
      loadProjectState(loaded);
      if (res.filePath) {
        setCurrentProjectPath(res.filePath);
      }
      showToast('已加载工程文件');
    } catch {
      showToast('打开 .lref 工程文件失败');
    }
  }, [loadProjectState, showToast]);

  // Reset zoom to 100% centered on viewport
  const handleResetZoom = useCallback(() => {
    setViewport((prev) => {
      const centerWorld = screenToWorld(
        window.innerWidth / 2,
        window.innerHeight / 2,
        prev,
        window.innerWidth
      );
      const nextScale = 1;
      const nextX = prev.flipHorizontal
        ? window.innerWidth / 2 - centerWorld.x * nextScale
        : window.innerWidth / 2 - centerWorld.x * nextScale;
      const nextY = window.innerHeight / 2 - centerWorld.y * nextScale;
      return {
        ...prev,
        x: nextX,
        y: nextY,
        scale: nextScale
      };
    });
  }, [setViewport]);

  // Handle drag & drop files onto window
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;

    // Check if dropping a .lref project file
    const lrefFile = files.find((f) => f.name.toLowerCase().endsWith('.lref'));
    if (lrefFile) {
      try {
        const buf = await lrefFile.arrayBuffer();
        const loaded = await importProjectFromLref(new Uint8Array(buf));
        loadProjectState(loaded);
        setCurrentProjectPath((lrefFile as File & { path?: string }).path || lrefFile.name);
        showToast(`已打开工程: ${lrefFile.name}`);
      } catch {
        showToast('解析 .lref 工程文件失败');
      }
      return;
    }

    const dropWorld = screenToWorld(e.clientX, e.clientY, viewport, window.innerWidth);
    await importImageFilesAt(files, dropWorld);
  };

  // Global Paste event listener (supports pasting directly from OS screenshot tools / browsers)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (items) {
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }
        if (imageFiles.length > 0) {
          e.preventDefault();
          await importImageFilesAt(
            imageFiles,
            lastWorldPosRef.current ?? getViewportCenterWorld()
          );
          return;
        }
      }

      e.preventDefault();
      await handlePasteFromClipboard();
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importImageFilesAt, getViewportCenterWorld, handlePasteFromClipboard]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (isInputFocused) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      const keyLower = e.key.toLowerCase();

      // Modifier shortcuts (Cmd / Ctrl)
      if (isMod) {
        if (keyLower === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
          return;
        }
        if (keyLower === 'y') {
          e.preventDefault();
          redo();
          return;
        }
        if (keyLower === 'c') {
          e.preventDefault();
          handleCopySelectedImage();
          return;
        }
        if (keyLower === 's') {
          e.preventDefault();
          handleSaveProject();
          return;
        }
        if (keyLower === 'o') {
          e.preventDefault();
          handleOpenProject();
          return;
        }
        // Note: Cmd/Ctrl + V is handled by the window 'paste' event or fallback here
        return;
      }

      // Hold Space for panning
      if (e.code === 'Space') {
        e.preventDefault();
        if (!spacePressed) {
          setSpacePressed(true);
        }
        return;
      }

      // Hold X for smooth horizontal drag zoom
      if (keyLower === 'x' && !e.shiftKey && !e.altKey) {
        if (!xZoomPressed) {
          setXZoomPressed(true);
        }
        return;
      }

      // Single-key workflow shortcuts
      switch (keyLower) {
        case 'v': {
          e.preventDefault();
          fitAllToViewport(window.innerWidth, window.innerHeight);
          showToast('视角已全局居中 (V)');
          break;
        }
        case 'a': {
          e.preventDefault();
          packGrid();
          showToast('已完成网格排列 (A)');
          break;
        }
        case 't': {
          e.preventDefault();
          handleCreateTextNote();
          break;
        }
        case 'b': {
          e.preventDefault();
          if (selectedImageNodes.length > 0) {
            toggleSelectedGrayscale();
            showToast('已切换黑白观察模式 (B)');
          }
          break;
        }
        case 'h': {
          e.preventDefault();
          if (!e.shiftKey && selectedImageNodes.length > 0) {
            flipSelectedHorizontal();
            showToast('已水平翻转选中图片 (H)');
          }
          break;
        }
        case 'r': {
          e.preventDefault();
          if (selectedImageNodes.length > 0) {
            rotateSelected(e.shiftKey ? 'ccw' : 'cw');
          }
          break;
        }
        case 'c': {
          e.preventDefault();
          if (!canvasLocked && primarySelectedImage) {
            setCroppingNodeId(
              croppingNodeId === primarySelectedImage.id ? null : primarySelectedImage.id
            );
          }
          break;
        }
        case 'l': {
          e.preventDefault();
          handleToggleCanvasLock();
          break;
        }
        case 'p': {
          e.preventDefault();
          handleToggleAlwaysOnTop();
          break;
        }
        case 'delete':
        case 'backspace': {
          if (selectedIds.length > 0 && !croppingNodeId) {
            e.preventDefault();
            deleteSelected();
          }
          break;
        }
        case '?':
        case '/': {
          e.preventDefault();
          setShowShortcutsModal((prev) => !prev);
          break;
        }
        default:
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
      if (e.key.toLowerCase() === 'x') {
        setXZoomPressed(false);
      }
    };

    const handleWindowBlur = () => {
      setSpacePressed(false);
      setXZoomPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    spacePressed,
    xZoomPressed,
    canvasLocked,
    selectedIds,
    selectedImageNodes,
    primarySelectedImage,
    croppingNodeId,
    undo,
    redo,
    fitAllToViewport,
    packGrid,
    handleCreateTextNote,
    toggleSelectedGrayscale,
    flipSelectedHorizontal,
    rotateSelected,
    setCroppingNodeId,
    handleToggleCanvasLock,
    handleToggleAlwaysOnTop,
    deleteSelected,
    handleCopySelectedImage,
    handleSaveProject,
    handleOpenProject,
    showToast
  ]);

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Top Drag Region & Shortcuts Help Modal */}
      <FloatingHud
        scale={viewport.scale}
        canvasLocked={canvasLocked}
        alwaysOnTop={alwaysOnTop}
        canUndo={canUndo}
        canRedo={canRedo}
        showShortcutsModal={showShortcutsModal}
        onToggleShortcutsModal={setShowShortcutsModal}
        onResetZoom={handleResetZoom}
        onFitView={() => fitAllToViewport(window.innerWidth, window.innerHeight)}
        onToggleCanvasLock={handleToggleCanvasLock}
        onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
        onImportImages={handleImportImagesFromPicker}
        onCreateTextNote={() => handleCreateTextNote(getViewportCenterWorld())}
        onPackGrid={packGrid}
        onUndo={undo}
        onRedo={redo}
        onOpenProject={handleOpenProject}
        onSaveProject={handleSaveProject}
      />

      {/* Infinite Konva Reference Canvas */}
      <ReferenceCanvas
        nodes={nodes}
        selectedIds={selectedIds}
        croppingNodeId={croppingNodeId}
        editingTextId={editingTextId}
        canvasLocked={canvasLocked}
        viewport={viewport}
        spacePressed={spacePressed}
        xZoomPressed={xZoomPressed}
        onSelectIds={setSelectedIds}
        onChangeViewport={setViewport}
        onUpdateNodesTransient={updateNodesTransient}
        onRecordSnapshotBeforeDrag={recordSnapshotForBeforeDrag}
        onCreateTextNote={(worldPos) => handleCreateTextNote(worldPos)}
        onStartEditText={setEditingTextId}
        onUpdateTextNode={updateTextNode}
        onBringToFront={bringToFront}
        onPointerMoveWorld={(pt) => {
          lastWorldPosRef.current = pt;
        }}
        onOpenContextMenu={(screenX, screenY, targetNode) => {
          setContextMenuState({
            x: screenX,
            y: screenY,
            targetNode
          });
        }}
      />

      {/* Interactive Crop Overlay */}
      {croppingNode && (
        <CropOverlay
          node={croppingNode}
          viewport={viewport}
          onConfirm={(newCrop) => {
            applyImageCrop(croppingNode.id, newCrop);
            showToast('已完成图片裁切');
          }}
          onReset={() => {
            resetImageCrop(croppingNode.id);
            showToast('已重置为完整原图');
          }}
          onCancel={() => setCroppingNodeId(null)}
        />
      )}

      {/* Color, Levels, Tone Curve & Terminator Panel */}
      {showColorCurvePanel && primarySelectedImage && (
        <ColorCurvePanel
          node={primarySelectedImage}
          onChange={(patch) =>
            updateImageAdjustments(
              selectedImageNodes.map((n) => n.id),
              patch,
              true
            )
          }
          onReset={() =>
            resetImageAdjustments(selectedImageNodes.map((n) => n.id))
          }
          onClose={() => setShowColorCurvePanel(false)}
        />
      )}

      {/* Right-Click Context Menu */}
      {contextMenuState && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          targetNode={contextMenuState.targetNode}
          canvasLocked={canvasLocked}
          alwaysOnTop={alwaysOnTop}
          canUndo={canUndo}
          canRedo={canRedo}
          noteFontSize={noteFontSize}
          onClose={() => setContextMenuState(null)}
          onToggleGrayscale={toggleSelectedGrayscale}
          onOpenColorCurve={() => setShowColorCurvePanel(true)}
          onStartCrop={() => {
            if (contextMenuState.targetNode?.type === 'image') {
              setCroppingNodeId(contextMenuState.targetNode.id);
            }
          }}
          onResetCrop={() => {
            if (contextMenuState.targetNode?.type === 'image') {
              resetImageCrop(contextMenuState.targetNode.id);
              showToast('已重置图片裁切');
            }
          }}
          onRotateCW={() => rotateSelected('cw')}
          onRotateCCW={() => rotateSelected('ccw')}
          onFlipImageHorizontal={flipSelectedHorizontal}
          onCopyImage={handleCopySelectedImage}
          onDeleteImage={deleteSelected}
          onEditTextNote={() => {
            if (contextMenuState.targetNode?.type === 'text') {
              setEditingTextId(contextMenuState.targetNode.id);
            }
          }}
          onIncreaseNoteFontSize={() => {
            const next = Math.min(64, noteFontSize + 2);
            changeGlobalNoteFontSize(2);
            showToast(`便签文字已放大 (${next}px)`);
          }}
          onDecreaseNoteFontSize={() => {
            const next = Math.max(10, noteFontSize - 2);
            changeGlobalNoteFontSize(-2);
            showToast(`便签文字已缩小 (${next}px)`);
          }}
          onDeleteTextNote={deleteSelected}
          onUndo={undo}
          onRedo={redo}
          onPasteImage={() =>
            handlePasteFromClipboard(
              screenToWorld(
                contextMenuState.x,
                contextMenuState.y,
                viewport,
                window.innerWidth
              )
            )
          }
          onImportLocalImages={handleImportImagesFromPicker}
          onCreateTextNote={() =>
            handleCreateTextNote(
              screenToWorld(
                contextMenuState.x,
                contextMenuState.y,
                viewport,
                window.innerWidth
              )
            )
          }
          onPackGrid={packGrid}
          onFitView={() => fitAllToViewport(window.innerWidth, window.innerHeight)}
          onToggleCanvasLock={handleToggleCanvasLock}
          onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
          onSaveProject={handleSaveProject}
          onOpenProject={handleOpenProject}
          onOpenShortcutsModal={() => setShowShortcutsModal(true)}
        />
      )}

      {/* Lightweight Toast Notification */}
      {toastMsg && (
        <div
          className="app-no-drag"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '7px 16px',
            backgroundColor: 'rgba(24, 24, 27, 0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(56, 189, 248, 0.45)',
            borderRadius: 999,
            color: '#f4f4f5',
            fontSize: 12.5,
            fontWeight: 500,
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'none',
            zIndex: 2500
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
};

export default App;
