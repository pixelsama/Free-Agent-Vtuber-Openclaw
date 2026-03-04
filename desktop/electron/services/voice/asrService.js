const { createAsrProvider } = require('./providerFactory');
const { createAsrWorkerClient } = require('./asrWorkerClient');

function normalizeProviderName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function createAsrService({
  provider = null,
  env = process.env,
  createAsrProviderImpl = createAsrProvider,
  createAsrWorkerClientImpl = createAsrWorkerClient,
} = {}) {
  let resolvedProvider = provider;
  let resolvedWithWorker = false;
  let resolvedProviderName = '';

  const resolveProviderName = () =>
    normalizeProviderName(provider) || normalizeProviderName(env?.VOICE_ASR_PROVIDER);

  const shouldFallbackFromWorkerError = (error) => {
    if (!error || error.name === 'AbortError') {
      return false;
    }

    const code = typeof error.code === 'string' ? error.code : '';
    return code.startsWith('voice_asr_worker_') || code.startsWith('voice_asr_python_worker_');
  };

  const getAsrProvider = () => {
    if (resolvedProvider) {
      return resolvedProvider;
    }

    const providerName = resolveProviderName();
    resolvedProviderName = providerName;
    const workerProvider = createAsrWorkerClientImpl({
      provider: providerName || null,
      env,
    });
    if (workerProvider) {
      resolvedProvider = workerProvider;
      resolvedWithWorker = true;
      return resolvedProvider;
    }

    resolvedProvider = createAsrProviderImpl({
      provider: providerName || null,
      env,
    });
    resolvedWithWorker = false;

    return resolvedProvider;
  };

  return {
    async warmup() {
      const asrProvider = getAsrProvider();
      if (typeof asrProvider.warmup !== 'function') {
        return;
      }

      try {
        await asrProvider.warmup();
      } catch (error) {
        if (!resolvedWithWorker || !shouldFallbackFromWorkerError(error)) {
          throw error;
        }

        if (typeof asrProvider.dispose === 'function') {
          await asrProvider.dispose().catch(() => {});
        }

        resolvedProvider = createAsrProviderImpl({
          provider: resolvedProviderName || null,
          env,
        });
        resolvedWithWorker = false;

        if (typeof resolvedProvider.warmup === 'function') {
          await resolvedProvider.warmup();
        }
      }
    },
    async transcribe({ audioChunks = [], signal, onPartial }) {
      const asrProvider = getAsrProvider();
      try {
        return await asrProvider.transcribe({
          audioChunks,
          signal,
          onPartial,
        });
      } catch (error) {
        if (!resolvedWithWorker || !shouldFallbackFromWorkerError(error)) {
          throw error;
        }

        if (typeof asrProvider.dispose === 'function') {
          await asrProvider.dispose().catch(() => {});
        }

        resolvedProvider = createAsrProviderImpl({
          provider: resolvedProviderName || null,
          env,
        });
        resolvedWithWorker = false;

        return resolvedProvider.transcribe({
          audioChunks,
          signal,
          onPartial,
        });
      }
    },
    async dispose() {
      const asrProvider = resolvedProvider;
      if (!asrProvider || typeof asrProvider.dispose !== 'function') {
        return;
      }

      await asrProvider.dispose();
      resolvedProvider = null;
    },
  };
}

module.exports = {
  createAsrService,
};
