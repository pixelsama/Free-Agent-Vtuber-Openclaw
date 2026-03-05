const assert = require('node:assert/strict');
const test = require('node:test');

const { registerNanobotRuntimeIpc } = require('../ipc/nanobotRuntime');

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
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
}

test('nanobot runtime ipc returns status', async () => {
  const ipcMain = createIpcMainMock();
  const manager = {
    getStatus: () => ({
      ok: true,
      installed: true,
      repoPath: '/tmp/nanobot',
      source: 'local',
    }),
    installRuntime: async () => {
      throw new Error('should not call');
    },
  };

  registerNanobotRuntimeIpc({
    ipcMain,
    nanobotRuntimeManager: manager,
  });

  const result = await ipcMain.invoke('nanobot-runtime:status');
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.repoPath, '/tmp/nanobot');
});

test('nanobot runtime ipc install returns mapped error', async () => {
  const ipcMain = createIpcMainMock();
  const manager = {
    getStatus: () => ({ ok: true, installed: false }),
    installRuntime: async () => {
      const error = new Error('download failed');
      error.code = 'nanobot_runtime_download_failed';
      throw error;
    },
  };

  registerNanobotRuntimeIpc({
    ipcMain,
    nanobotRuntimeManager: manager,
  });

  const result = await ipcMain.invoke('nanobot-runtime:install', {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'nanobot_runtime_download_failed');
});
