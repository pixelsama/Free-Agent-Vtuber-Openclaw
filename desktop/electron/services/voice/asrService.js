const { createAsrProvider } = require('./providerFactory');

function createAsrService({ provider = null } = {}) {
  const asrProvider = provider || createAsrProvider({ provider: 'mock' });

  return {
    async transcribe({ audioChunks = [], signal, onPartial }) {
      return asrProvider.transcribe({
        audioChunks,
        signal,
        onPartial,
      });
    },
  };
}

module.exports = {
  createAsrService,
};
