import React, { useEffect, useRef, useState } from 'react';
import { CanvasNode, ImageCanvasNode } from '../types';
import {
  Eye,
  Sliders,
  Crop,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  Copy,
  Trash2,
  ClipboardPaste,
  ImagePlus,
  Type,
  LayoutGrid,
  Maximize2,
  Lock,
  Unlock,
  Pin,
  Save,
  FolderOpen,
  Check,
  Undo2,
  Redo2,
  HelpCircle,
  Edit3,
  ZoomIn,
  ZoomOut
} from 'lucide-react';

export interface ContextMenuProps {
  /** Screen X coordinate where menu was opened */
  x: number;
  /** Screen Y coordinate where menu was opened */
  y: number;
  /** Target node if right-clicked on an image or text note; null if right-clicked on empty canvas */
  targetNode?: CanvasNode | null;
  /** Legacy alias for targetImage */
  targetImage?: ImageCanvasNode | null;
  /** Canvas lock state */
  canvasLocked?: boolean;
  /** Window always-on-top state */
  alwaysOnTop?: boolean;
  /** Undo availability */
  canUndo?: boolean;
  /** Redo availability */
  canRedo?: boolean;
  /** Global note font size (px) */
  noteFontSize?: number;
  /** Close context menu */
  onClose: () => void;

  // Image actions
  onToggleGrayscale?: () => void;
  onOpenColorCurve?: () => void;
  onStartCrop?: () => void;
  onResetCrop?: () => void;
  onRotateCW?: () => void;
  onRotateCCW?: () => void;
  onFlipImageHorizontal?: () => void;
  onCopyImage?: () => void;
  onDeleteImage?: () => void;

  // Text note actions
  onEditTextNote?: () => void;
  onIncreaseNoteFontSize?: () => void;
  onDecreaseNoteFontSize?: () => void;
  onDeleteTextNote?: () => void;

  // Canvas blank actions
  onUndo?: () => void;
  onRedo?: () => void;
  onPasteImage?: () => void;
  onImportLocalImages?: () => void;
  onCreateTextNote?: () => void;
  onPackGrid?: () => void;
  onFitView?: () => void;
  onToggleCanvasLock?: () => void;
  onToggleAlwaysOnTop?: () => void;
  onSaveProject?: () => void;
  onOpenProject?: () => void;
  onOpenShortcutsModal?: () => void;
}

function isImageCropped(node: ImageCanvasNode): boolean {
  const c = node.crop;
  if (!c) return false;
  return (
    Math.abs(c.x) > 0.001 ||
    Math.abs(c.y) > 0.001 ||
    Math.abs(c.width - 1) > 0.001 ||
    Math.abs(c.height - 1) > 0.001
  );
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  targetNode,
  targetImage,
  canvasLocked = false,
  alwaysOnTop = false,
  canUndo = false,
  canRedo = false,
  noteFontSize = 16,
  onClose,
  onToggleGrayscale,
  onOpenColorCurve,
  onStartCrop,
  onResetCrop,
  onRotateCW,
  onRotateCCW,
  onFlipImageHorizontal,
  onCopyImage,
  onDeleteImage,
  onEditTextNote,
  onIncreaseNoteFontSize,
  onDecreaseNoteFontSize,
  onDeleteTextNote,
  onUndo,
  onRedo,
  onPasteImage,
  onImportLocalImages,
  onCreateTextNote,
  onPackGrid,
  onFitView,
  onToggleCanvasLock,
  onToggleAlwaysOnTop,
  onSaveProject,
  onOpenProject,
  onOpenShortcutsModal
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeNode: CanvasNode | null = targetNode ?? targetImage ?? null;
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    setPos({
      left: Math.min(Math.max(8, x), maxLeft),
      top: Math.min(Math.max(8, y), maxTop)
    });
  }, [x, y, activeNode]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const runAndClose = (action?: () => void) => {
    if (action) action();
    onClose();
  };

  const imageNode = activeNode?.type === 'image' ? activeNode : null;
  const textNode = activeNode?.type === 'text' ? activeNode : null;
  const cropped = imageNode ? isImageCropped(imageNode) : false;

  return (
    <div
      ref={menuRef}
      className="app-no-drag"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        minWidth: 232,
        padding: '5px',
        backgroundColor: 'rgba(24, 24, 27, 0.96)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(63, 63, 70, 0.85)',
        borderRadius: 10,
        boxShadow: '0 14px 34px rgba(0, 0, 0, 0.6)',
        color: '#f4f4f5',
        zIndex: 2000,
        fontSize: 12.5
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {imageNode ? (
        <>
          <MenuItem
            icon={<Eye size={14} />}
            label="开启 / 关闭黑白模式"
            shortcut="B"
            checked={imageNode.adjustments.grayscale}
            onClick={() => runAndClose(onToggleGrayscale)}
          />
          <MenuItem
            icon={<Sliders size={14} />}
            label="色彩与曲线调节..."
            onClick={() => runAndClose(onOpenColorCurve)}
          />
          <MenuDivider />
          <MenuItem
            icon={<Crop size={14} />}
            label="剪裁图片"
            shortcut="C"
            onClick={() => runAndClose(onStartCrop)}
          />
          <MenuItem
            icon={<RotateCcw size={14} />}
            label="重置剪裁"
            disabled={!cropped}
            onClick={() => {
              if (cropped) runAndClose(onResetCrop);
            }}
          />
          <MenuDivider />
          <MenuItem
            icon={<RotateCw size={14} />}
            label="顺时针旋转 90°"
            shortcut="R"
            onClick={() => runAndClose(onRotateCW)}
          />
          <MenuItem
            icon={<RotateCcw size={14} />}
            label="逆时针旋转 90°"
            shortcut="Shift+R"
            onClick={() => runAndClose(onRotateCCW)}
          />
          <MenuItem
            icon={<FlipHorizontal size={14} />}
            label="水平镜像翻转"
            shortcut="H"
            checked={imageNode.flipX}
            onClick={() => runAndClose(onFlipImageHorizontal)}
          />
          <MenuDivider />
          <MenuItem
            icon={<Copy size={14} />}
            label="复制图片到剪贴板"
            shortcut="Cmd/Ctrl+C"
            onClick={() => runAndClose(onCopyImage)}
          />
          <MenuItem
            icon={<Trash2 size={14} />}
            label="删除图片"
            shortcut="Del"
            danger
            onClick={() => runAndClose(onDeleteImage)}
          />
        </>
      ) : textNode ? (
        <>
          <MenuItem
            icon={<Edit3 size={14} />}
            label="编辑便签"
            shortcut="双击"
            disabled={canvasLocked}
            onClick={() => {
              if (!canvasLocked) runAndClose(onEditTextNote);
            }}
          />
          <MenuDivider />
          <MenuItem
            icon={<ZoomIn size={14} />}
            label={`放大文字 (当前 ${noteFontSize}px)`}
            shortcut="+2px"
            disabled={canvasLocked || noteFontSize >= 64}
            onClick={() => {
              if (!canvasLocked && noteFontSize < 64) {
                runAndClose(onIncreaseNoteFontSize);
              }
            }}
          />
          <MenuItem
            icon={<ZoomOut size={14} />}
            label={`缩小文字 (当前 ${noteFontSize}px)`}
            shortcut="-2px"
            disabled={canvasLocked || noteFontSize <= 10}
            onClick={() => {
              if (!canvasLocked && noteFontSize > 10) {
                runAndClose(onDecreaseNoteFontSize);
              }
            }}
          />
          <MenuDivider />
          <MenuItem
            icon={<Trash2 size={14} />}
            label="删除便签"
            shortcut="Del"
            danger
            disabled={canvasLocked}
            onClick={() => {
              if (!canvasLocked) runAndClose(onDeleteTextNote ?? onDeleteImage);
            }}
          />
        </>
      ) : (
        <>
          <MenuItem
            icon={<Undo2 size={14} />}
            label="撤销"
            shortcut="Cmd/Ctrl+Z"
            disabled={!canUndo}
            onClick={() => {
              if (canUndo) runAndClose(onUndo);
            }}
          />
          <MenuItem
            icon={<Redo2 size={14} />}
            label="重做"
            shortcut="Cmd/Ctrl+Shift+Z"
            disabled={!canRedo}
            onClick={() => {
              if (canRedo) runAndClose(onRedo);
            }}
          />
          <MenuDivider />
          <MenuItem
            icon={<ClipboardPaste size={14} />}
            label="粘贴图片"
            shortcut="Cmd/Ctrl+V"
            onClick={() => runAndClose(onPasteImage)}
          />
          <MenuItem
            icon={<ImagePlus size={14} />}
            label="导入本地图片..."
            onClick={() => runAndClose(onImportLocalImages)}
          />
          <MenuItem
            icon={<Type size={14} />}
            label="新建文字便签"
            shortcut="T"
            onClick={() => runAndClose(onCreateTextNote)}
          />
          <MenuDivider />
          <MenuItem
            icon={<LayoutGrid size={14} />}
            label="快速网格排列"
            shortcut="A"
            onClick={() => runAndClose(onPackGrid)}
          />
          <MenuItem
            icon={<Maximize2 size={14} />}
            label="视角全局居中"
            shortcut="V"
            onClick={() => runAndClose(onFitView)}
          />
          <MenuDivider />
          <MenuItem
            icon={canvasLocked ? <Lock size={14} /> : <Unlock size={14} />}
            label={canvasLocked ? '解锁画布' : '锁定画布'}
            shortcut="L"
            checked={canvasLocked}
            onClick={() => runAndClose(onToggleCanvasLock)}
          />
          <MenuItem
            icon={<Pin size={14} />}
            label="窗口置顶"
            shortcut="P"
            checked={alwaysOnTop}
            onClick={() => runAndClose(onToggleAlwaysOnTop)}
          />
          <MenuDivider />
          <MenuItem
            icon={<Save size={14} />}
            label="保存工程"
            shortcut="Cmd/Ctrl+S"
            onClick={() => runAndClose(onSaveProject)}
          />
          <MenuItem
            icon={<FolderOpen size={14} />}
            label="打开工程"
            shortcut="Cmd/Ctrl+O"
            onClick={() => runAndClose(onOpenProject)}
          />
          <MenuDivider />
          <MenuItem
            icon={<HelpCircle size={14} />}
            label="快捷键说明"
            shortcut="?"
            onClick={() => runAndClose(onOpenShortcutsModal)}
          />
        </>
      )}
    </div>
  );
};

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  label,
  shortcut,
  checked,
  disabled,
  danger,
  onClick
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '6px 9px',
        border: 'none',
        borderRadius: 6,
        backgroundColor:
          hovered && !disabled
            ? danger
              ? 'rgba(239, 68, 68, 0.18)'
              : 'rgba(63, 63, 70, 0.65)'
            : 'transparent',
        color: disabled
          ? '#52525b'
          : danger
          ? '#f87171'
          : checked
          ? '#38bdf8'
          : '#e4e4e7',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12.5,
        textAlign: 'left',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', opacity: disabled ? 0.4 : 0.9 }}>
          {icon}
        </span>
        <span>{label}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {checked && <Check size={13} color="#38bdf8" />}
        {shortcut && (
          <span
            style={{
              fontSize: 11,
              color: disabled ? '#3f3f46' : '#71717a',
              fontFamily: 'monospace'
            }}
          >
            {shortcut}
          </span>
        )}
      </div>
    </button>
  );
};

const MenuDivider: React.FC = () => (
  <div
    style={{
      height: 1,
      backgroundColor: 'rgba(63, 63, 70, 0.55)',
      margin: '4px 6px'
    }}
  />
);

export default ContextMenu;
