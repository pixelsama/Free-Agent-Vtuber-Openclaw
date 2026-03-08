const assert = require('node:assert/strict');
const test = require('node:test');

const { registerSettingsIpc } = require('../ipc/settings');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, payload);
    },
  };
}

test('settings:test delegates to backend manager', async () => {
  const ipcMain = createIpcMainMock();

  const settingsStore = {
    getPublic: () => ({ baseUrl: 'http://127.0.0.1:18789', agentId: 'main', hasToken: true }),
    merge: (override = {}) => ({
      baseUrl: override.baseUrl || 'http://127.0.0.1:18789',
      agentId: override.agentId || 'main',
      token: override.token || 'token-x',
      chatBackend: override.chatBackend || 'openclaw',
    }),
    save: async (payload) => payload,
  };

  const backendManager = {
    resolveBackendName: ({ requestBackend, settings }) => requestBackend || settings.chatBackend || 'openclaw',
    testConnection: async ({ backend }) => ({ ok: true, backend }),
    mapError: (error) => ({ code: 'mapped_error', message: error.message }),
  };

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    backendManager,
  });

  const result = await ipcMain.invoke('settings:test', {
    chatBackend: 'openclaw',
  });

  assert.equal(result.ok, true);
  assert.equal(result.backend, 'openclaw');
});

test('settings:test returns mapped error when backend test fails', async () => {
  const ipcMain = createIpcMainMock();

  const settingsStore = {
    getPublic: () => ({ hasToken: true }),
    merge: () => ({ chatBackend: 'openclaw' }),
    save: async (payload) => payload,
  };

  const backendManager = {
    resolveBackendName: () => 'openclaw',
    testConnection: async () => {
      throw new Error('boom');
    },
    mapError: () => ({ code: 'openclaw_upstream_error', message: 'boom' }),
  };

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    backendManager,
  });

  const result = await ipcMain.invoke('settings:test', {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'openclaw_upstream_error');
});

test('settings:nanobot:pick-workspace returns selected directory path', async () => {
  const ipcMain = createIpcMainMock();

  registerSettingsIpc({
    ipcMain,
    settingsStore: {
      getPublic: () => ({
        nanobot: {
          workspace: '/tmp/nanobot-workspace',
        },
      }),
    },
    getWindow: () => ({ id: 1 }),
    dialogModule: {
      showOpenDialog: async (_window, options) => {
        assert.equal(options.defaultPath, '/tmp/nanobot-workspace');
        assert.deepEqual(options.properties, ['openDirectory', 'createDirectory']);
        return {
          canceled: false,
          filePaths: ['/tmp/selected-workspace'],
        };
      },
    },
  });

  const result = await ipcMain.invoke('settings:nanobot:pick-workspace');
  assert.equal(result.ok, true);
  assert.equal(result.path, '/tmp/selected-workspace');
});
