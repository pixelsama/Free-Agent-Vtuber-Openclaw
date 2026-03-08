const { dialog } = require('electron');
const { createChatBackendManager } = require('../services/chat/backendManager');

function registerSettingsIpc({
  ipcMain,
  settingsStore,
  getWindow,
  dialogModule = dialog,
  backendManager = createChatBackendManager(),
}) {
  ipcMain.handle('settings:get', async () => settingsStore.getPublic());

  ipcMain.handle('settings:save', async (_event, partialSettings = {}) => {
    return settingsStore.save(partialSettings);
  });

  ipcMain.handle('settings:test', async (_event, overrideSettings = {}) => {
    let backend = 'openclaw';

    try {
      const settings = settingsStore.merge(overrideSettings);
      backend = backendManager.resolveBackendName({
        settings,
        requestBackend: overrideSettings?.backend || overrideSettings?.chatBackend,
      });

      return await backendManager.testConnection({
        backend,
        settings,
      });
    } catch (error) {
      return {
        ok: false,
        error: backendManager.mapError(error, { backend }),
      };
    }
  });

  ipcMain.handle('settings:nanobot:pick-workspace', async () => {
    const browserWindow = getWindow?.();
    const currentSettings = settingsStore.getPublic?.() || {};
    const defaultPath =
      typeof currentSettings?.nanobot?.workspace === 'string'
        ? currentSettings.nanobot.workspace.trim()
        : '';

    const result = await dialogModule.showOpenDialog(browserWindow || undefined, {
      title: '选择 Nanobot Workspace',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
        path: '',
      };
    }

    return {
      ok: true,
      canceled: false,
      path: result.filePaths[0] || '',
    };
  });

  return () => {
    ipcMain.removeHandler('settings:get');
    ipcMain.removeHandler('settings:save');
    ipcMain.removeHandler('settings:test');
    ipcMain.removeHandler('settings:nanobot:pick-workspace');
  };
}

module.exports = {
  registerSettingsIpc,
};
