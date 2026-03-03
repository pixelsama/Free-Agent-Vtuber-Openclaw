const { createTtsProvider } = require('./providerFactory');

function createTtsService({ provider = null } = {}) {
  const ttsProvider = provider || createTtsProvider({ provider: 'mock' });

  return {
    async synthesize({ text = '', signal, onChunk }) {
      return ttsProvider.synthesize({
        text,
        signal,
        onChunk,
      });
    },
  };
}

module.exports = {
  createTtsService,
};
