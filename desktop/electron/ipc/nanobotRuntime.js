function toNanobotRuntimeError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'nanobot_runtime_unknown_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Nanobot runtime request failed.',
    };
  }

  return {
    code: 'nanobot_runtime_unknown_error',
    message: 'Nanobot runtime request failed.',
  };
}

function registerNanobotRuntimeIpc({
  ipcMain,
  nanobotRuntimeManager,
  emitProgress,
}) {
  ipcMain.handle('nanobot-runtime:status', async () => {
    return nanobotRuntimeManager.getStatus();
  });

  ipcMain.handle('nanobot-runtime:install', async (_event, payload = {}) => {
    try {
      const status = await nanobotRuntimeManager.installRuntime({
        force: Boolean(payload.force),
        onProgress: (progressPayload) => {
          if (typeof emitProgress === 'function') {
            emitProgress(progressPayload);
          }
        },
      });
      return {
        ok: true,
        ...status,
      };
    } catch (error) {
      return {
        ok: false,
        error: toNanobotRuntimeError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('nanobot-runtime:status');
    ipcMain.removeHandler('nanobot-runtime:install');
  };
}

module.exports = {
  registerNanobotRuntimeIpc,
};
