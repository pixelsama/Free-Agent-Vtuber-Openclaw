import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';
import CropIcon from '@mui/icons-material/Crop';
import CloseIcon from '@mui/icons-material/Close';
import { useI18n } from '../../i18n/I18nContext.jsx';
import './ScreenCaptureOverlay.css';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSelection(selection, bounds) {
  if (!selection || !bounds.width || !bounds.height) {
    return null;
  }

  const x1 = clamp(Math.min(selection.x1, selection.x2), 0, bounds.width);
  const y1 = clamp(Math.min(selection.y1, selection.y2), 0, bounds.height);
  const x2 = clamp(Math.max(selection.x1, selection.x2), 0, bounds.width);
  const y2 = clamp(Math.max(selection.y1, selection.y2), 0, bounds.height);

  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

export default function ScreenCaptureOverlay({
  imageUrl,
  naturalWidth,
  naturalHeight,
  onCancel,
  onConfirm,
}) {
  const { t } = useI18n();
  const imageRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [imageBounds, setImageBounds] = useState({ width: 0, height: 0 });

  const updateImageBounds = useCallback(() => {
    const rect = imageRef.current?.getBoundingClientRect?.();
    if (!rect) {
      return;
    }

    setImageBounds({
      width: rect.width,
      height: rect.height,
    });
    setSelection((current) => current || { x1: 0, y1: 0, x2: rect.width, y2: rect.height });
  }, []);

  useEffect(() => {
    updateImageBounds();
    window.addEventListener('resize', updateImageBounds);
    return () => {
      window.removeEventListener('resize', updateImageBounds);
    };
  }, [updateImageBounds]);

  useEffect(() => {
    if (!dragState) {
      return undefined;
    }

    const onPointerMove = (event) => {
      const rect = imageRef.current?.getBoundingClientRect?.();
      if (!rect) {
        return;
      }

      const nextX = clamp(event.clientX - rect.left, 0, rect.width);
      const nextY = clamp(event.clientY - rect.top, 0, rect.height);
      setSelection({
        x1: dragState.originX,
        y1: dragState.originY,
        x2: nextX,
        y2: nextY,
      });
    };

    const onPointerUp = () => {
      setDragState(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [dragState]);

  const normalizedSelection = useMemo(
    () => normalizeSelection(selection, imageBounds),
    [imageBounds, selection],
  );

  const selectionStyle = normalizedSelection
    ? {
        left: normalizedSelection.x,
        top: normalizedSelection.y,
        width: normalizedSelection.width,
        height: normalizedSelection.height,
      }
    : null;

  const handlePointerDown = useCallback((event) => {
    const rect = imageRef.current?.getBoundingClientRect?.();
    if (!rect) {
      return;
    }

    const startX = clamp(event.clientX - rect.left, 0, rect.width);
    const startY = clamp(event.clientY - rect.top, 0, rect.height);
    setSelection({
      x1: startX,
      y1: startY,
      x2: startX,
      y2: startY,
    });
    setDragState({
      originX: startX,
      originY: startY,
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!normalizedSelection || !imageBounds.width || !imageBounds.height) {
      return;
    }

    const scaleX = naturalWidth / imageBounds.width;
    const scaleY = naturalHeight / imageBounds.height;

    await onConfirm?.({
      x: Math.floor(normalizedSelection.x * scaleX),
      y: Math.floor(normalizedSelection.y * scaleY),
      width: Math.max(1, Math.floor(normalizedSelection.width * scaleX)),
      height: Math.max(1, Math.floor(normalizedSelection.height * scaleY)),
    });
  }, [imageBounds.height, imageBounds.width, naturalHeight, naturalWidth, normalizedSelection, onConfirm]);

  return (
    <Box className="screen-capture-overlay">
      <Box className="screen-capture-dialog">
        <Box className="screen-capture-header">
          <Box className="screen-capture-title">{t('composer.captureHint')}</Box>
        </Box>

        <Box
          className="screen-capture-image-frame"
          onPointerDown={handlePointerDown}
          role="presentation"
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt={t('composer.capturePreviewAlt')}
            className="screen-capture-image"
            onLoad={updateImageBounds}
          />
          {selectionStyle && <Box className="screen-capture-selection" sx={selectionStyle} />}
        </Box>

        <Box className="screen-capture-actions">
          <Button size="small" startIcon={<CloseIcon fontSize="small" />} onClick={onCancel}>
            {t('composer.captureCancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<CropIcon fontSize="small" />}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {t('composer.captureConfirm')}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
