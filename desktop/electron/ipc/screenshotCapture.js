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

  return () => {
    ipcMain.removeHandler('capture:window:begin');
    ipcMain.removeHandler('capture:window:finish');
    ipcMain.removeHandler('capture:save');
    ipcMain.removeHandler('capture:release');
  };
}

module.exports = {
  registerScreenshotCaptureIpc,
};
