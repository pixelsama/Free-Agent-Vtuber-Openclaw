const { contextBridge, ipcRenderer } = require('electron');

const chatStream = {
  start(request) {
    return ipcRenderer.invoke('chat:stream:start', request);
  },
  abort(request) {
    return ipcRenderer.invoke('chat:stream:abort', request);
  },
  onEvent(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => {
      handler(payload);
    };

    ipcRenderer.on('chat:stream:event', listener);

    return () => {
      ipcRenderer.removeListener('chat:stream:event', listener);
    };
  },
};

const settings = {
  get() {
    return ipcRenderer.invoke('settings:get');
  },
  save(partialSettings) {
    return ipcRenderer.invoke('settings:save', partialSettings);
  },
  testConnection(overrideSettings) {
    return ipcRenderer.invoke('settings:test', overrideSettings);
  },
};

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  chatStream,
  settings,
});
