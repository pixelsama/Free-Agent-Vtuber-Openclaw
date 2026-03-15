import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, IconButton } from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import ChatIcon from '@mui/icons-material/Chat';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import CloseIcon from '@mui/icons-material/Close';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import Live2DViewer from '../components/live2d/Live2DViewer.jsx';
import SubtitleBar from '../components/subtitle/SubtitleBar.jsx';
import { usePetDraggable } from '../hooks/pet/usePetDraggable.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { STORAGE_KEYS } from '../components/controls/constants.js';
import { desktopBridge } from '../services/desktopBridge.js';

const PET_DEFAULT_MODEL_SCALE = 0.31;
const PET_POINTER_SYNC_INTERVAL_MS = 50;

function normalizeModelScale(scale) {
  const rounded = Math.round(scale * 100) / 100;
  return Math.max(0.1, Math.min(3, rounded));
}

function readStoredModelScale() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.petModelScale);
    return typeof stored === 'string' && stored.trim()
      ? normalizeModelScale(Number(stored))
      : null;
  } catch (error) {
    console.warn('Failed to read stored model scale for pet mode:', error);
    return null;
  }
}

function persistModelScale(scale) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEYS.petModelScale, String(normalizeModelScale(scale)));
  } catch (error) {
    console.warn('Failed to persist pet mode model scale:', error);
  }
}

function hasExternalPathPayload(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }

  if (Number(dataTransfer.files?.length || 0) > 0) {
    return true;
  }

  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes('Files')
    || types.includes('text/uri-list')
    || types.includes('public.file-url')
    || types.includes('text/plain')
  );
}

function parseFileUrlToPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'file:') {
      return '';
    }
    let pathname = decodeURIComponent(parsed.pathname || '');
    if (!pathname) {
      return '';
    }
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname.trim();
  } catch {
    return '';
  }
}

function parsePathLikeText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized;
  }
  return '';
}

function collectDroppedPaths(dataTransfer) {
  if (!dataTransfer) {
    return [];
  }

  const paths = new Set();
  const appendPath = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    const normalized = value.trim();
    if (normalized) {
      paths.add(normalized);
    }
  };

  const files = Array.from(dataTransfer.files || []);
  for (const file of files) {
    appendPath(file?.path);
  }

  const items = Array.from(dataTransfer.items || []);
  for (const item of items) {
    const file = item?.getAsFile?.();
    appendPath(file?.path);
  }

  const uriListText = dataTransfer.getData?.('text/uri-list') || '';
  if (uriListText) {
    const uriLines = uriListText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    for (const uri of uriLines) {
      appendPath(parseFileUrlToPath(uri) || parsePathLikeText(uri));
    }
  }

  const plainText = dataTransfer.getData?.('text/plain') || '';
  appendPath(parseFileUrlToPath(plainText) || parsePathLikeText(plainText));

  return Array.from(paths);
}

export default function PetShell({
  desktopMode,
  platform,
  live2dViewerRef,
  currentModelPath,
  motions,
  expressions,
  onModelLoaded,
  onModelError,
  subtitleText,
  onSwitchToWindowMode,
  bindPetHover,
  setPetHover,
  textComposerProps,
  showChatPanel = false,
  onOpenChatPanel,
  onCloseChatPanel,
  onQuickCapture,
  captureDraft = null,
  onClearCaptureDraft,
  nanobotWorkspace = '',
  onDropNanobotWorkspacePath,
  onOpenNanobotWorkspace,
  showVoicePermissionWarning = false,
  voicePermissionWarningText = '',
}) {
  const { t } = useI18n();
  const modelHoverRef = useRef(false);
  const hitboxRef = useRef(null);
  const controlsRef = useRef(null);
  const workspaceDragDepthRef = useRef(0);
  const [isActivationRectHovering, setIsActivationRectHovering] = useState(false);
  const [isModelHovering, setIsModelHovering] = useState(false);
  const [isControlsHovering, setIsControlsHovering] = useState(false);
  const [isWorkspaceHovering, setIsWorkspaceHovering] = useState(false);
  const [isWorkspaceDropActive, setIsWorkspaceDropActive] = useState(false);
  const [isModelLocked, setIsModelLocked] = useState(false);
  const {
    voiceEnabled = false,
    voiceToggleDisabled = true,
    onToggleVoice,
    canCaptureScreen = false,
    isStreaming = false,
  } = textComposerProps || {};

  const setModelHover = useCallback(
    (nextHovering) => {
      const normalized = Boolean(nextHovering);
      if (modelHoverRef.current === normalized) {
        return;
      }

      modelHoverRef.current = normalized;
      setIsModelHovering(normalized);
      setPetHover?.('live2d-hitbox', normalized);
    },
    [setPetHover],
  );

  const detectModelPixelHover = useCallback(
    (event) => {
      if (!desktopMode || !event) {
        return false;
      }

      return Boolean(live2dViewerRef.current?.isPointOnModel?.(event.clientX, event.clientY, 12));
    },
    [desktopMode, live2dViewerRef],
  );

  const detectActivationRectHover = useCallback((event) => {
    if (!event) {
      return false;
    }

    const hitboxRect = hitboxRef.current?.getBoundingClientRect?.();
    if (!hitboxRect) {
      return false;
    }

    const controlsRect = controlsRef.current?.getBoundingClientRect?.();
    if (!controlsRect) {
      const { clientX, clientY } = event;
      return (
        clientX >= hitboxRect.left &&
        clientX <= hitboxRect.right &&
        clientY >= hitboxRect.top &&
        clientY <= hitboxRect.bottom
      );
    }

    const centerX = hitboxRect.left + hitboxRect.width / 2;
    const centerY = hitboxRect.top + hitboxRect.height / 2;
    const minX = Math.min(hitboxRect.left, controlsRect.left);
    const maxX = Math.max(hitboxRect.right, controlsRect.right);
    const minY = Math.min(hitboxRect.top, controlsRect.top);
    const maxY = Math.max(hitboxRect.bottom, controlsRect.bottom);
    const halfWidth = Math.max(centerX - minX, maxX - centerX);
    const halfHeight = Math.max(centerY - minY, maxY - centerY);

    const rect = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight,
    };

    const { clientX, clientY } = event;
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }, []);

  const { isDragging, dragStyle, dragBindings } = usePetDraggable({
    enabled: desktopMode && !isModelLocked,
    canStartDrag: (event) => detectModelPixelHover(event),
    onDragStateChange: (dragging) => {
      setPetHover?.('pet-dragging', dragging);
      setModelHover(dragging);
    },
  });

  const handleModelScaleByWheel = useCallback(
    (event) => {
      if (!desktopMode || isModelLocked) {
        return;
      }

      const manager = live2dViewerRef.current?.getManager?.();
      if (!manager || !manager.isModelLoaded || typeof manager.setModelScale !== 'function') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentScale =
        typeof manager.getModelScale === 'function'
          ? manager.getModelScale()
          : typeof manager.currentScale === 'number'
            ? manager.currentScale
            : 1.0;
      const scaleStep = 0.03;
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextScale = normalizeModelScale(currentScale + direction * scaleStep);
      manager.setModelScale(nextScale);
      persistModelScale(nextScale);
    },
    [desktopMode, isModelLocked, live2dViewerRef],
  );

  const handlePetModelLoaded = useCallback(
    (model) => {
      const manager = live2dViewerRef.current?.getManager?.();
      if (manager?.isModelLoaded && typeof manager.setModelScale === 'function') {
        manager.setModelScale(readStoredModelScale() ?? PET_DEFAULT_MODEL_SCALE);
      }

      onModelLoaded?.(model);
    },
    [live2dViewerRef, onModelLoaded],
  );

  useEffect(() => {
    const hitboxElement = hitboxRef.current;
    if (!hitboxElement) {
      return undefined;
    }

    const handleWheel = (event) => {
      handleModelScaleByWheel(event);
    };

    hitboxElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      hitboxElement.removeEventListener('wheel', handleWheel);
    };
  }, [handleModelScaleByWheel]);

  useEffect(
    () => () => {
      setPetHover?.('live2d-hitbox', false);
      setPetHover?.('pet-dragging', false);
      setPetHover?.('pet-bottom-controls', false);
      setPetHover?.('pet-workspace-indicator', false);
      setPetHover?.('pet-drop-proximity', false);
    },
    [setPetHover],
  );

  useEffect(() => {
    if (!desktopMode || typeof setPetHover !== 'function') {
      return undefined;
    }

    let disposed = false;
    let timerId = null;

    const pollCursorProximity = async () => {
      try {
        const context = await desktopBridge.window.getCursorContext();
        if (disposed) {
          return;
        }
        if (!context?.ok || context?.mode !== 'pet') {
          setPetHover('pet-drop-proximity', false);
          return;
        }

        const hitboxRect = hitboxRef.current?.getBoundingClientRect?.();
        const desktopBounds = context.desktopBounds;
        const cursor = context.cursor;
        if (!hitboxRect || !desktopBounds || !cursor) {
          setPetHover('pet-drop-proximity', false);
          return;
        }

        const clientX = cursor.x - desktopBounds.x;
        const clientY = cursor.y - desktopBounds.y;
        const isInHitbox =
          clientX >= hitboxRect.left
          && clientX <= hitboxRect.right
          && clientY >= hitboxRect.top
          && clientY <= hitboxRect.bottom;
        setPetHover('pet-drop-proximity', isInHitbox);
      } catch {
        setPetHover('pet-drop-proximity', false);
      } finally {
        if (!disposed) {
          timerId = window.setTimeout(() => {
            void pollCursorProximity();
          }, PET_POINTER_SYNC_INTERVAL_MS);
        }
      }
    };

    void pollCursorProximity();

    return () => {
      disposed = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
      setPetHover('pet-drop-proximity', false);
    };
  }, [desktopMode, setPetHover]);

  const handleWorkspaceDragEnter = useCallback((event) => {
    if (!desktopMode || !hasExternalPathPayload(event?.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    workspaceDragDepthRef.current += 1;
    setIsWorkspaceDropActive(true);
    setPetHover?.('pet-workspace-indicator', true);
  }, [desktopMode, setPetHover]);

  const handleWorkspaceDragOver = useCallback((event) => {
    if (!desktopMode || !hasExternalPathPayload(event?.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (!isWorkspaceDropActive) {
      setIsWorkspaceDropActive(true);
    }
    setPetHover?.('pet-workspace-indicator', true);
  }, [desktopMode, isWorkspaceDropActive, setPetHover]);

  const handleWorkspaceDragLeave = useCallback((event) => {
    if (!desktopMode || !isWorkspaceDropActive) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    workspaceDragDepthRef.current = Math.max(0, workspaceDragDepthRef.current - 1);
    if (workspaceDragDepthRef.current === 0) {
      setIsWorkspaceDropActive(false);
      setPetHover?.('pet-workspace-indicator', false);
    }
  }, [desktopMode, isWorkspaceDropActive, setPetHover]);

  const handleWorkspaceDrop = useCallback(async (event) => {
    if (!desktopMode) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    workspaceDragDepthRef.current = 0;
    setIsWorkspaceDropActive(false);
    setPetHover?.('pet-workspace-indicator', false);

    const droppedPaths = collectDroppedPaths(event?.dataTransfer);
    if (!droppedPaths.length) {
      return;
    }

    const [firstPath] = droppedPaths;
    if (!firstPath || typeof onDropNanobotWorkspacePath !== 'function') {
      return;
    }

    await onDropNanobotWorkspacePath(firstPath);
  }, [desktopMode, onDropNanobotWorkspacePath, setPetHover]);

  const controlsVisible =
    isActivationRectHovering
    || isModelHovering
    || isDragging
    || isControlsHovering
    || isWorkspaceHovering
    || isWorkspaceDropActive
    || showChatPanel
    || voiceEnabled;
  const controlsHoverBindings = bindPetHover?.('pet-bottom-controls') ?? {};
  const captureHoverBindings = bindPetHover?.('pet-capture-preview') ?? {};
  const workspaceHoverBindings = bindPetHover?.('pet-workspace-indicator') ?? {};
  const normalizedWorkspacePath = typeof nanobotWorkspace === 'string' ? nanobotWorkspace.trim() : '';
  const hasWorkspacePath = Boolean(normalizedWorkspacePath);

  const stageClassName = ['live2d-stage', 'pet-mode', desktopMode ? `platform-${platform}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <Box className={stageClassName}>
      <Box
        ref={hitboxRef}
        className={`live2d-hitbox pet-draggable-hitbox ${isDragging ? 'pet-dragging' : ''}`.trim()}
        style={dragStyle}
        onMouseEnter={(event) => {
          if (isDragging) {
            setModelHover(true);
            setIsActivationRectHovering(true);
            return;
          }

          setModelHover(detectModelPixelHover(event));
          setIsActivationRectHovering(detectActivationRectHover(event));
        }}
        onMouseMove={(event) => {
          if (isDragging) {
            setModelHover(true);
            setIsActivationRectHovering(true);
            return;
          }

          setModelHover(detectModelPixelHover(event));
          setIsActivationRectHovering(detectActivationRectHover(event));
        }}
        onMouseLeave={() => {
          setIsActivationRectHovering(false);
          if (!isDragging) {
            setModelHover(false);
          }
        }}
        onDragEnter={handleWorkspaceDragEnter}
        onDragOver={handleWorkspaceDragOver}
        onDragLeave={handleWorkspaceDragLeave}
        onDrop={(event) => {
          void handleWorkspaceDrop(event);
        }}
        {...dragBindings}
      >
        <Box className="pet-render-shell">
          <Live2DViewer
            ref={live2dViewerRef}
            modelPath={currentModelPath}
            motions={motions}
            expressions={expressions}
            width={400}
            height={600}
            onModelLoaded={handlePetModelLoaded}
            onModelError={onModelError}
            className="live2d-viewer"
          />
        </Box>
        <SubtitleBar text={subtitleText} className="subtitle-pet-head" />
        <Box
          ref={controlsRef}
          className={`pet-hitbox-controls ${controlsVisible ? 'is-visible' : ''}`.trim()}
          onMouseEnter={(event) => {
            setIsControlsHovering(true);
            controlsHoverBindings.onMouseEnter?.(event);
          }}
          onMouseLeave={(event) => {
            setIsControlsHovering(false);
            controlsHoverBindings.onMouseLeave?.(event);
          }}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
          }}
        >
          <IconButton
            className="mode-toggle pet-mode-toggle"
            color="primary"
            onClick={() => {
              void onSwitchToWindowMode?.();
            }}
            title={t('pet.switchToWindowMode')}
          >
            <SwapHorizIcon />
          </IconButton>
          <IconButton
            className="mode-toggle pet-mode-toggle"
            color={isModelLocked ? 'secondary' : 'primary'}
            onClick={() => {
              setIsModelLocked((prev) => !prev);
            }}
            title={isModelLocked ? t('pet.lockedTitle') : t('pet.unlockedTitle')}
          >
            {isModelLocked ? <LockIcon /> : <LockOpenIcon />}
          </IconButton>
          <IconButton
            className="mode-toggle pet-mode-toggle"
            color={voiceEnabled ? 'secondary' : 'primary'}
            onClick={() => {
              void onToggleVoice?.();
            }}
            title={voiceEnabled ? t('composer.voiceDisableTitle') : t('composer.voiceEnableTitle')}
            aria-label={voiceEnabled ? t('composer.voiceDisableTitle') : t('composer.voiceEnableTitle')}
            disabled={voiceToggleDisabled}
          >
            {voiceEnabled ? <MicIcon /> : <MicOffIcon />}
          </IconButton>
          {canCaptureScreen && (
            <IconButton
              className="mode-toggle pet-mode-toggle"
              color="primary"
              onClick={() => {
                onQuickCapture?.();
              }}
              title={t('composer.captureTitle')}
              aria-label={t('composer.captureTitle')}
              disabled={isStreaming}
            >
              <ContentCutIcon />
            </IconButton>
          )}
          <IconButton
            className="mode-toggle pet-mode-toggle"
            color={showChatPanel ? 'secondary' : 'primary'}
            onClick={() => {
              if (showChatPanel) {
                onCloseChatPanel?.();
              } else {
                onOpenChatPanel?.();
              }
            }}
            title={t('chat.openChat')}
            aria-label={t('chat.openChat')}
          >
            <ChatIcon />
          </IconButton>
        </Box>
        {captureDraft?.captureId && (
          <Box
            className="pet-capture-preview"
            onMouseEnter={(event) => {
              captureHoverBindings.onMouseEnter?.(event);
            }}
            onMouseLeave={(event) => {
              captureHoverBindings.onMouseLeave?.(event);
            }}
            onPointerDownCapture={(event) => {
              event.stopPropagation();
            }}
          >
            {captureDraft.previewUrl ? (
              <img
                src={captureDraft.previewUrl}
                alt={t('composer.capturePreviewAlt')}
                className="pet-capture-preview-image"
              />
            ) : (
              <Box className="pet-capture-preview-placeholder">📷</Box>
            )}
            <Box className="pet-capture-preview-meta">
              <Box className="pet-capture-preview-title">{t('composer.captureAttached')}</Box>
              {captureDraft.name ? (
                <Box className="pet-capture-preview-name">{captureDraft.name}</Box>
              ) : null}
            </Box>
            <IconButton
              size="small"
              className="pet-capture-preview-remove"
              onClick={() => {
                onClearCaptureDraft?.();
              }}
              title={t('composer.captureRemove')}
              aria-label={t('composer.captureRemove')}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
        {controlsVisible ? (
          <Box
            className={[
              'pet-workspace-indicator',
              isWorkspaceDropActive ? 'is-drop-active' : '',
              showVoicePermissionWarning && voicePermissionWarningText ? 'has-voice-warning' : '',
              hasWorkspacePath ? '' : 'is-disabled',
            ].filter(Boolean).join(' ')}
            onMouseEnter={(event) => {
              setIsWorkspaceHovering(true);
              workspaceHoverBindings.onMouseEnter?.(event);
            }}
            onMouseLeave={(event) => {
              setIsWorkspaceHovering(false);
              workspaceHoverBindings.onMouseLeave?.(event);
            }}
            onPointerDownCapture={(event) => {
              event.stopPropagation();
            }}
            onClick={() => {
              if (hasWorkspacePath) {
                void onOpenNanobotWorkspace?.();
              }
            }}
            title={hasWorkspacePath ? normalizedWorkspacePath : t('pet.nanobotWorkspaceUnset')}
            role="button"
            aria-label={t('pet.nanobotWorkspaceOpen')}
            aria-disabled={!hasWorkspacePath}
            tabIndex={hasWorkspacePath ? 0 : -1}
            onKeyDown={(event) => {
              if (!hasWorkspacePath) {
                return;
              }
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void onOpenNanobotWorkspace?.();
              }
            }}
          >
            <FolderOpenIcon fontSize="small" />
            <Box className="pet-workspace-indicator-meta">
              <Box className="pet-workspace-indicator-label">{t('app.nanobotWorkspace')}</Box>
              <Box className={`pet-workspace-indicator-path ${hasWorkspacePath ? '' : 'is-empty'}`.trim()}>
                {hasWorkspacePath ? normalizedWorkspacePath : t('pet.nanobotWorkspaceUnset')}
              </Box>
            </Box>
          </Box>
        ) : null}
        {showVoicePermissionWarning && voicePermissionWarningText ? (
          <Box className="pet-voice-warning">{voicePermissionWarningText}</Box>
        ) : null}
      </Box>
    </Box>
  );
}
