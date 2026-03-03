import { useCallback, useMemo, useRef, useState } from 'react';

export function useVoiceCapture() {
  const streamRef = useRef(null);
  const [permission, setPermission] = useState('prompt');
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');

  const requestPermission = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermission('denied');
      setCaptureError('media_devices_unavailable');
      return { ok: false, reason: 'media_devices_unavailable' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      setPermission('granted');
      setCaptureError('');
      return { ok: true };
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setPermission(denied ? 'denied' : 'error');
      setCaptureError(error?.message || 'microphone_permission_failed');
      return { ok: false, reason: error?.name || 'microphone_permission_failed' };
    }
  }, []);

  const startCapture = useCallback(async () => {
    if (!streamRef.current) {
      const permissionResult = await requestPermission();
      if (!permissionResult.ok) {
        return permissionResult;
      }
    }

    // AudioWorklet/VAD pipeline will be attached in the next implementation phase.
    setIsCapturing(true);
    return { ok: true };
  }, [requestPermission]);

  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsCapturing(false);
  }, []);

  return useMemo(
    () => ({
      permission,
      isCapturing,
      captureError,
      requestPermission,
      startCapture,
      stopCapture,
    }),
    [permission, isCapturing, captureError, requestPermission, startCapture, stopCapture],
  );
}
