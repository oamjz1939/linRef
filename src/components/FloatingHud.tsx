import React, { useState } from 'react';
import { X, Minus, Square } from 'lucide-react';
import {
  isElectron,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow
} from '../utils/platformBridge';

export interface FloatingHudProps {
  /** Current viewport scale (e.g. 1.0 = 100%) */
  scale?: number;
  /** Whether global viewport horizontal flip is active */
  globalFlipHorizontal?: boolean;
  /** Alias for globalFlipHorizontal */
  flipHorizontal?: boolean;
  /** Whether the canvas is locked against dragging/editing */
  canvasLocked?: boolean;
  /** Whether the Electron window is pinned Always-on-Top */
  alwaysOnTop?: boolean;
  /** Undo availability */
  canUndo?: boolean;
  /** Redo availability */
  canRedo?: boolean;
  /** Controlled help modal visibility (optional) */
  showShortcutsModal?: boolean;
  /** Callback when help modal visibility changes */
  onToggleShortcutsModal?: (show: boolean) => void;

  // Optional legacy callbacks
  onResetZoom?: () => void;
  onFitView?: () => void;
  onToggleGlobalFlip?: () => void;
  onToggleCanvasLock?: () => void;
  onToggleAlwaysOnTop?: () => void;
  onImportImages?: () => void;
  onCreateTextNote?: () => void;
  onPackGrid?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenProject?: () => void;
  onSaveProject?: () => void;
}

interface ShortcutEntry {
  keys: string;
  description: string;
}

const SHORTCUT_LIST: ShortcutEntry[] = [
  { keys: 'Space + 左键拖动 / 中键拖动', description: '平移画布视角' },
  { keys: '滚轮 / X + 左右拖动', description: '以光标为中心缩放画布（右移放大，左移缩小）' },
  { keys: 'V', description: '视角全局居中并适配所有内容' },
  { keys: 'A', description: '选中或全部参考图自动紧凑网格排列' },
  { keys: 'T', description: '在当前位置新建文字便签（双击便签编辑）' },
  { keys: 'B', description: '开启 / 关闭选中图片的一键黑白观察模式' },
  { keys: 'H', description: '选中图片单图水平镜像翻转' },
  { keys: 'R / Shift + R', description: '顺时针 / 逆时针旋转图片 90°' },
  { keys: 'C', description: '进入选中图片的交互式剪裁模式' },
  { keys: 'L', description: '锁定 / 解锁画布内容（防误触拖动）' },
  { keys: 'P', description: '切换窗口置顶 (Always on Top)' },
  { keys: 'Cmd/Ctrl + V', description: '直接从剪贴板粘贴参考图到画布' },
  { keys: 'Cmd/Ctrl + C', description: '复制当前选中图片到系统剪贴板' },
  { keys: 'Cmd/Ctrl + Z / Shift + Z', description: '撤销 / 重做上一步画布操作' },
  { keys: 'Cmd/Ctrl + S / O', description: '保存 / 打开 .lref 工程文件' },
  { keys: 'Delete / Backspace', description: '删除当前选中的图片或文字便签' },
  { keys: '?', description: '打开 / 关闭快捷键说明弹窗' }
];

export const FloatingHud: React.FC<FloatingHudProps> = ({
  showShortcutsModal: controlledShowHelp,
  onToggleShortcutsModal
}) => {
  const [internalShowHelp, setInternalShowHelp] = useState(false);
  const isHelpOpen = controlledShowHelp ?? internalShowHelp;
  const setHelpOpen = (val: boolean) => {
    setInternalShowHelp(val);
    if (onToggleShortcutsModal) {
      onToggleShortcutsModal(val);
    }
  };

  const isWindowsOrLinuxElectron =
    isElectron() &&
    typeof navigator !== 'undefined' &&
    !/Mac/i.test(navigator.platform);

  return (
    <>
      {/* Top Drag Region Bar for Frameless Window */}
      <div
        className="app-drag-region"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 32,
          zIndex: 800,
          pointerEvents: 'none'
        }}
      />

      {/* Windows / Linux Custom Window Controls */}
      {isWindowsOrLinuxElectron && (
        <div
          className="app-no-drag"
          style={{
            position: 'fixed',
            top: 12,
            right: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 3,
            backgroundColor: 'rgba(24, 24, 27, 0.88)',
            border: '1px solid rgba(63, 63, 70, 0.8)',
            borderRadius: 8,
            zIndex: 900
          }}
        >
          <WindowControlButton
            icon={<Minus size={13} />}
            title="最小化"
            onClick={() => minimizeWindow()}
          />
          <WindowControlButton
            icon={<Square size={12} />}
            title="最大化 / 还原"
            onClick={() => toggleMaximizeWindow()}
          />
          <WindowControlButton
            icon={<X size={13} />}
            title="关闭窗口"
            onClick={() => closeWindow()}
          />
        </div>
      )}

      {/* Shortcuts Help Modal */}
      {isHelpOpen && (
        <div
          className="app-no-drag"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(9, 9, 11, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2200
          }}
          onClick={() => setHelpOpen(false)}
        >
          <div
            style={{
              width: 520,
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: 'calc(100vh - 64px)',
              overflowY: 'auto',
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 14,
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.65)',
              padding: '18px 20px',
              color: '#f4f4f5'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: 12,
                marginBottom: 12,
                borderBottom: '1px solid #27272a'
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  linRef 绘画参考图工具 · 快捷键一览
                </div>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>
                  高频单键工作流，专为数位板与单手键盘操作设计
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: 7
              }}
            >
              {SHORTCUT_LIST.map((item) => (
                <div
                  key={item.keys}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    backgroundColor: 'rgba(39, 39, 42, 0.5)',
                    borderRadius: 7,
                    fontSize: 12.5
                  }}
                >
                  <span style={{ color: '#d4d4d8' }}>{item.description}</span>
                  <kbd
                    style={{
                      padding: '2px 7px',
                      backgroundColor: '#27272a',
                      border: '1px solid #3f3f46',
                      borderRadius: 5,
                      color: '#38bdf8',
                      fontFamily: 'monospace',
                      fontSize: 11.5,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface WindowControlButtonProps {
  icon: React.ReactNode;
  title?: string;
  onClick: () => void;
}

const WindowControlButton: React.FC<WindowControlButtonProps> = ({
  icon,
  title,
  onClick
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '5px 7px',
        border: 'none',
        borderRadius: 7,
        backgroundColor: hovered ? 'rgba(63, 63, 70, 0.7)' : 'transparent',
        color: '#e4e4e7',
        cursor: 'pointer',
        fontSize: 11.5
      }}
    >
      {icon}
    </button>
  );
};

export default FloatingHud;
