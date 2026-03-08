import { useCallback, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function stopMediaStream(stream) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function readDisplayFrame(stream) {
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) {
    throw new Error('capture_no_video_track');
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      video
        .play()
        .then(resolve)
        .catch(reject);
    };
    video.onerror = () => reject(new Error('capture_video_init_failed'));
  });

  const width = Math.max(1, Math.floor(videoTrack.getSettings().width || video.videoWidth || 1));
  const height = Math.max(1, Math.floor(videoTrack.getSettings().height || video.videoHeight || 1));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('capture_canvas_unavailable');
  }
  context.drawImage(video, 0, 0, width, height);
  video.srcObject = null;

  return {
    width,
    height,
    dataUrl: canvas.toDataURL('image/png'),
  };
}

function cropDataUrl(imageUrl, cropRect) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = Math.max(1, Math.floor(cropRect.width));
      const height = Math.max(1, Math.floor(cropRect.height));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('capture_canvas_unavailable'));
        return;
      }
      context.drawImage(
        image,
        cropRect.x,
        cropRect.y,
        cropRect.width,
        cropRect.height,
        0,
        0,
        width,
        height,
      );
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => {
      reject(new Error('capture_crop_failed'));
    };
    image.src = imageUrl;
  });
}

export function useScreenCaptureController({ desktopMode }) {
  const [overlayState, setOverlayState] = useState(null);

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
    if (!desktopMode || !desktopBridge.isDesktop() || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('capture_not_supported');
    }

    let stream = null;
    let hiddenWindow = false;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 30,
        },
        audio: false,
      });

      const beginResult = await desktopBridge.capture.beginWindowCapture();
      if (!beginResult?.ok) {
        throw new Error(beginResult?.reason || 'capture_hide_failed');
      }
      hiddenWindow = true;
      await wait(180);

      const frame = await readDisplayFrame(stream);
      stopMediaStream(stream);
      stream = null;

      await desktopBridge.capture.finishWindowCapture();
      hiddenWindow = false;

      return await new Promise((resolve, reject) => {
        setOverlayState({
          imageUrl: frame.dataUrl,
          naturalWidth: frame.width,
          naturalHeight: frame.height,
          onCancel: () => {
            setOverlayState(null);
            resolve(null);
          },
          onConfirm: async (cropRect) => {
            try {
              const croppedDataUrl = await cropDataUrl(frame.dataUrl, cropRect);
              const saveResult = await desktopBridge.capture.save({
                dataUrl: croppedDataUrl,
                name: `screenshot-${Date.now()}.png`,
              });
              setOverlayState(null);
              if (!saveResult?.ok || !saveResult.captureId) {
                reject(new Error(saveResult?.reason || 'capture_save_failed'));
                return;
              }
              resolve({
                captureId: saveResult.captureId,
                previewUrl: croppedDataUrl,
                mimeType: saveResult.mimeType || 'image/png',
                size: Number.isFinite(saveResult.size) ? saveResult.size : 0,
                name: saveResult.name || `screenshot-${Date.now()}.png`,
              });
            } catch (error) {
              setOverlayState(null);
              reject(error);
            }
          },
        });
      });
    } catch (error) {
      stopMediaStream(stream);
      if (hiddenWindow) {
        try {
          await desktopBridge.capture.finishWindowCapture();
        } catch (finishError) {
          console.warn('Failed to restore window after capture error:', finishError);
        }
      }
      throw error;
    }
  }, [desktopMode]);

  return {
    overlayState,
    releaseCapture,
    startScreenCapture,
  };
}
