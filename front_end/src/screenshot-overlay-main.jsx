import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { desktopBridge } from './services/desktopBridge.js';
import './screenshot-overlay.css';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSelection(selection) {
  if (!selection) {
    return null;
  }

  const x = Math.min(selection.startX, selection.endX);
  const y = Math.min(selection.startY, selection.endY);
  const width = Math.abs(selection.endX - selection.startX);
  const height = Math.abs(selection.endY - selection.startY);
  if (width < 2 || height < 2) {
    return null;
  }

  return { x, y, width, height };
}

function ScreenshotOverlayApp() {
  const [session, setSession] = useState(null);
  const [selection, setSelection] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      const result = await desktopBridge.captureOverlay.getSession();
      if (cancelled) {
        return;
      }

      if (!result?.ok) {
        setError(result?.reason || 'capture_session_unavailable');
        return;
      }

      setSession(result);
    };

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedSelection = useMemo(() => normalizeSelection(selection), [selection]);

  const cancelSelection = useCallback(async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await desktopBridge.captureOverlay.cancel({
        reason: 'capture_canceled',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting]);

  const confirmSelection = useCallback(async () => {
    if (!normalizedSelection || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await desktopBridge.captureOverlay.confirm({
        selection: {
          startX: normalizedSelection.x,
          startY: normalizedSelection.y,
          endX: normalizedSelection.x + normalizedSelection.width,
          endY: normalizedSelection.y + normalizedSelection.height,
        },
      });

      if (!result?.ok) {
        setError(result?.reason || 'capture_selection_invalid');
        setIsSubmitting(false);
      }
    } catch (nextError) {
      setError(nextError?.message || 'capture_selection_invalid');
      setIsSubmitting(false);
    }
  }, [isSubmitting, normalizedSelection]);

  useEffect(() => {
    if (typeof window.focus === 'function') {
      window.focus();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void cancelSelection();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        void confirmSelection();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelSelection, confirmSelection]);

  useEffect(() => {
    if (!isDragging) {
      return () => {};
    }

    const onPointerMove = (event) => {
      setSelection((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          endX: clamp(event.clientX, 0, window.innerWidth),
          endY: clamp(event.clientY, 0, window.innerHeight),
        };
      });
    };

    const onPointerUp = () => {
      setIsDragging(false);
      if (typeof window.focus === 'function') {
        window.focus();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isDragging]);

  useEffect(() => {
    const disableContextMenu = (event) => {
      event.preventDefault();
    };

    window.addEventListener('contextmenu', disableContextMenu);
    return () => {
      window.removeEventListener('contextmenu', disableContextMenu);
    };
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 || isSubmitting) {
      return;
    }

    if (event.target?.closest?.('.screenshot-overlay-actions')) {
      return;
    }

    const startX = clamp(event.clientX, 0, window.innerWidth);
    const startY = clamp(event.clientY, 0, window.innerHeight);
    setSelection({
      startX,
      startY,
      endX: startX,
      endY: startY,
    });
    setIsDragging(true);
  }, [isSubmitting]);

  const selectionStyle = normalizedSelection
    ? {
        left: normalizedSelection.x,
        top: normalizedSelection.y,
        width: normalizedSelection.width,
        height: normalizedSelection.height,
      }
    : null;

  return (
    <div
      className="screenshot-overlay-root"
      onPointerDown={handlePointerDown}
      onDoubleClick={() => {
        void confirmSelection();
      }}
      role="presentation"
    >
      {session?.imageUrl && (
        <img
          className="screenshot-overlay-image"
          src={session.imageUrl}
          alt="Frozen desktop"
          draggable={false}
        />
      )}
      <div className="screenshot-overlay-shade" />
      {selectionStyle && (
        <div className="screenshot-overlay-selection" style={selectionStyle}>
          <div className="screenshot-overlay-dimension">
            {normalizedSelection.width} x {normalizedSelection.height}
          </div>
        </div>
      )}
      <div className="screenshot-overlay-hint">
        <span>拖拽选择区域</span>
        <span>Enter 确认</span>
        <span>Esc 取消</span>
      </div>
      <div className="screenshot-overlay-actions">
        <button
          type="button"
          className="screenshot-overlay-button screenshot-overlay-button-secondary"
          disabled={isSubmitting}
          onClick={() => {
            void cancelSelection();
          }}
        >
          取消
        </button>
        <button
          type="button"
          className="screenshot-overlay-button screenshot-overlay-button-primary"
          disabled={!normalizedSelection || isSubmitting}
          onClick={() => {
            void confirmSelection();
          }}
        >
          确认选区
        </button>
      </div>
      {error && <div className="screenshot-overlay-error">{error}</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ScreenshotOverlayApp />
  </React.StrictMode>,
);
