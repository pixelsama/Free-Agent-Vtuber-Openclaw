import { useCallback } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

function normalizeCaptureError(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  const name = typeof error?.name === 'string' ? error.name.trim() : '';

  if (
    message === 'Not supported'
    || name === 'NotSupportedError'
    || message === 'getDisplayMedia is not implemented'
  ) {
    return new Error('capture_not_supported');
  }

  return error;
}

export function useScreenCaptureController({ desktopMode }) {
  const releaseCapture = useCallback(async (captureId) => {
    if (!captureId || !desktopBridge.isDesktop()) {
      return;
    }

    try {
      await desktopBridge.capture.release({ captureId });
    } catch (error) {
      console.warn('Failed to release capture:', error);
    }
  }, []);

  const startScreenCapture = useCallback(async () => {
    if (!desktopMode || !desktopBridge.isDesktop()) {
      throw new Error('capture_not_supported');
    }

    try {
      const result = await desktopBridge.capture.selectRegion();
      if (!result?.ok) {
        if (result?.canceled) {
          return null;
        }
        throw new Error(result?.reason || 'capture_not_supported');
      }

      return {
        captureId: result.captureId,
        previewUrl: result.previewUrl || '',
        mimeType: result.mimeType || 'image/png',
        size: Number.isFinite(result.size) ? result.size : 0,
        name: result.name || `screenshot-${Date.now()}.png`,
      };
    } catch (error) {
      throw normalizeCaptureError(error);
    }
  }, [desktopMode]);

  return {
    releaseCapture,
    startScreenCapture,
  };
}
