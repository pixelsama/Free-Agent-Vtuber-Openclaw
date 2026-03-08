const assert = require('node:assert/strict');
const test = require('node:test');

const { registerScreenshotCaptureIpc } = require('../ipc/screenshotCapture');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    async invoke(channel, payload = {}, event = {}) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({
        sender: event.sender || null,
      }, payload);
    },
  };
}

test('capture:select-region delegates to selection service', async () => {
  const ipcMain = createIpcMainMock();
  const screenshotSelectionService = {
    startSelection: async () => ({
      ok: true,
      captureId: 'capture_1',
      previewUrl: 'data:image/png;base64,abc',
    }),
  };

  registerScreenshotCaptureIpc({
    ipcMain,
    getWindow: () => ({ id: 1 }),
    screenshotCaptureService: {
      releaseCapture: async () => ({ ok: true }),
      beginWindowCapture: async () => ({ ok: true }),
      finishWindowCapture: async () => ({ ok: true }),
      saveCapture: async () => ({ ok: true, captureId: 'capture_1' }),
    },
    screenshotSelectionService,
  });

  const result = await ipcMain.invoke('capture:select-region');
  assert.equal(result.ok, true);
  assert.equal(result.captureId, 'capture_1');
});

test('capture-overlay confirm forwards selection to selection service', async () => {
  const ipcMain = createIpcMainMock();
  const sender = { id: 'overlay-webcontents' };
  let receivedSelection = null;
  let receivedSender = null;

  registerScreenshotCaptureIpc({
    ipcMain,
    getWindow: () => ({ id: 1 }),
    screenshotCaptureService: {
      releaseCapture: async () => ({ ok: true }),
      beginWindowCapture: async () => ({ ok: true }),
      finishWindowCapture: async () => ({ ok: true }),
      saveCapture: async () => ({ ok: true, captureId: 'capture_1' }),
    },
    screenshotSelectionService: {
      getOverlaySession: () => ({ ok: true }),
      confirmSelection: async ({ sender: nextSender, selection }) => {
        receivedSender = nextSender;
        receivedSelection = selection;
        return { ok: true };
      },
      cancelSelection: async () => ({ ok: true }),
      startSelection: async () => ({ ok: false }),
    },
  });

  const result = await ipcMain.invoke(
    'capture-overlay:confirm',
    {
      selection: {
        startX: 10,
        startY: 20,
        endX: 100,
        endY: 120,
      },
    },
    { sender },
  );

  assert.equal(result.ok, true);
  assert.equal(receivedSender, sender);
  assert.deepEqual(receivedSelection, {
    startX: 10,
    startY: 20,
    endX: 100,
    endY: 120,
  });
});
