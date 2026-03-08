function toClientError(error) {
  const message = error?.message || 'capture_failed';
  return {
    ok: false,
    reason: message,
  };
}

function registerScreenshotCaptureIpc({
  ipcMain,
  getWindow,
  screenshotCaptureService,
  screenshotSelectionService,
} = {}) {
  if (!ipcMain || !screenshotCaptureService || typeof getWindow !== 'function') {
    return () => {};
  }

  ipcMain.handle('capture:window:begin', async () => {
    try {
      return await screenshotCaptureService.beginWindowCapture(getWindow());
    } catch (error) {
      return toClientError(error);
    }
  });

  ipcMain.handle('capture:window:finish', async () => {
    try {
      return await screenshotCaptureService.finishWindowCapture(getWindow());
    } catch (error) {
      return toClientError(error);
    }
  });

  ipcMain.handle('capture:save', async (_event, request = {}) => {
    try {
      return await screenshotCaptureService.saveCapture(request);
    } catch (error) {
      return toClientError(error);
    }
  });

  ipcMain.handle('capture:release', async (_event, request = {}) => {
    try {
      return await screenshotCaptureService.releaseCapture(request?.captureId);
    } catch (error) {
      return toClientError(error);
    }
  });

  ipcMain.handle('capture:select-region', async () => {
    try {
      if (!screenshotSelectionService) {
        return { ok: false, canceled: false, reason: 'desktop_capture_unavailable' };
      }
      return await screenshotSelectionService.startSelection(getWindow());
    } catch (error) {
      return toClientError(error);
    }
  });

  ipcMain.handle('capture-overlay:get-session', async (event) => {
    try {
      if (!screenshotSelectionService) {
        return { ok: false, reason: 'capture_session_unavailable' };
      }
      return screenshotSelectionService.getOverlaySession(event.sender);
    } catch (error) {
      return toClientError(error);
    }
  });

  ipcMain.handle('capture-overlay:confirm', async (event, request = {}) => {
    try {
      if (!screenshotSelectionService) {
        return { ok: false, reason: 'capture_session_unavailable' };
      }
      return await screenshotSelectionService.confirmSelection({
        sender: event.sender,
        selection: request?.selection,
      });
    } catch (error) {
      return toClientError(error);
    }
  });

  ipcMain.handle('capture-overlay:cancel', async (event, request = {}) => {
    try {
      if (!screenshotSelectionService) {
        return { ok: false, reason: 'capture_session_unavailable' };
      }
      return await screenshotSelectionService.cancelSelection({
        sender: event.sender,
        reason: request?.reason || 'capture_canceled',
      });
    } catch (error) {
      return toClientError(error);
    }
  });

  return () => {
    ipcMain.removeHandler('capture:window:begin');
    ipcMain.removeHandler('capture:window:finish');
    ipcMain.removeHandler('capture:save');
    ipcMain.removeHandler('capture:release');
    ipcMain.removeHandler('capture:select-region');
    ipcMain.removeHandler('capture-overlay:get-session');
    ipcMain.removeHandler('capture-overlay:confirm');
    ipcMain.removeHandler('capture-overlay:cancel');
  };
}

module.exports = {
  registerScreenshotCaptureIpc,
};
