function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function createMockAsrProvider() {
  return {
    async transcribe({ audioChunks = [], signal, onPartial }) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const hasAudio = Array.isArray(audioChunks) && audioChunks.length > 0;
      const text = hasAudio ? 'mock voice input' : '';

      if (typeof onPartial === 'function' && text) {
        onPartial('mock...');
      }

      return { text };
    },
  };
}

function createMockTtsProvider() {
  return {
    async synthesize({ text = '', signal, onChunk }) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      if (typeof onChunk !== 'function' || !text.trim()) {
        return;
      }

      // Placeholder chunk for wiring and flow-control testing.
      const audioChunk = Buffer.from(text, 'utf-8');
      onChunk({
        audioChunk,
        codec: 'mock/utf8',
        sampleRate: 16000,
      });
    },
  };
}

function createAsrProvider({ provider = 'mock' } = {}) {
  if (provider === 'mock') {
    return createMockAsrProvider();
  }

  throw new Error(`Unsupported ASR provider: ${provider}`);
}

function createTtsProvider({ provider = 'mock' } = {}) {
  if (provider === 'mock') {
    return createMockTtsProvider();
  }

  throw new Error(`Unsupported TTS provider: ${provider}`);
}

module.exports = {
  createAsrProvider,
  createTtsProvider,
  createAbortError,
};
