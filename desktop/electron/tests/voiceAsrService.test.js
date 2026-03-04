const assert = require('node:assert/strict');
const test = require('node:test');

const { createAsrService } = require('../services/voice/asrService');

test('createAsrService prefers worker provider when available', async () => {
  let workerFactoryCalls = 0;
  let providerFactoryCalls = 0;

  const service = createAsrService({
    env: {
      VOICE_ASR_PROVIDER: 'python',
    },
    createAsrWorkerClientImpl: () => {
      workerFactoryCalls += 1;
      return {
        async transcribe() {
          return { text: 'from-worker' };
        },
        async dispose() {},
      };
    },
    createAsrProviderImpl: () => {
      providerFactoryCalls += 1;
      return {
        async transcribe() {
          return { text: 'from-provider' };
        },
      };
    },
  });

  const result = await service.transcribe({});
  assert.equal(result.text, 'from-worker');
  assert.equal(workerFactoryCalls, 1);
  assert.equal(providerFactoryCalls, 0);
});

test('createAsrService falls back to provider when worker is unavailable', async () => {
  let providerFactoryCalls = 0;

  const service = createAsrService({
    env: {
      VOICE_ASR_PROVIDER: 'python',
    },
    createAsrWorkerClientImpl: () => null,
    createAsrProviderImpl: () => {
      providerFactoryCalls += 1;
      return {
        async transcribe() {
          return { text: 'from-provider' };
        },
      };
    },
  });

  const result = await service.transcribe({});
  assert.equal(result.text, 'from-provider');
  assert.equal(providerFactoryCalls, 1);
});

test('createAsrService dispose delegates to resolved provider', async () => {
  let disposed = false;

  const service = createAsrService({
    env: {
      VOICE_ASR_PROVIDER: 'python',
    },
    createAsrWorkerClientImpl: () => ({
      async transcribe() {
        return { text: 'ok' };
      },
      async dispose() {
        disposed = true;
      },
    }),
    createAsrProviderImpl: () => null,
  });

  await service.transcribe({});
  await service.dispose();
  assert.equal(disposed, true);
});

test('createAsrService falls back to plain provider when worker transcribe fails', async () => {
  let providerFactoryCalls = 0;
  const workerError = new Error('worker down');
  workerError.code = 'voice_asr_worker_unavailable';

  const service = createAsrService({
    env: {
      VOICE_ASR_PROVIDER: 'python',
    },
    createAsrWorkerClientImpl: () => ({
      async transcribe() {
        throw workerError;
      },
      async dispose() {},
    }),
    createAsrProviderImpl: () => {
      providerFactoryCalls += 1;
      return {
        async transcribe() {
          return { text: 'fallback-provider' };
        },
      };
    },
  });

  const result = await service.transcribe({});
  assert.equal(result.text, 'fallback-provider');
  assert.equal(providerFactoryCalls, 1);
});

test('createAsrService warmup delegates to worker provider', async () => {
  let warmupCalls = 0;

  const service = createAsrService({
    env: {
      VOICE_ASR_PROVIDER: 'python',
    },
    createAsrWorkerClientImpl: () => ({
      async transcribe() {
        return { text: 'ok' };
      },
      async warmup() {
        warmupCalls += 1;
      },
    }),
    createAsrProviderImpl: () => null,
  });

  await service.warmup();
  await service.warmup();
  assert.equal(warmupCalls, 2);
});

test('createAsrService warmup falls back to plain provider when worker warmup fails', async () => {
  let providerFactoryCalls = 0;
  const workerError = new Error('worker warmup failed');
  workerError.code = 'voice_asr_worker_warmup_timeout';

  const service = createAsrService({
    env: {
      VOICE_ASR_PROVIDER: 'python',
    },
    createAsrWorkerClientImpl: () => ({
      async transcribe() {
        return { text: 'worker' };
      },
      async warmup() {
        throw workerError;
      },
      async dispose() {},
    }),
    createAsrProviderImpl: () => {
      providerFactoryCalls += 1;
      return {
        async transcribe() {
          return { text: 'provider' };
        },
      };
    },
  });

  await service.warmup();
  const result = await service.transcribe({});
  assert.equal(result.text, 'provider');
  assert.equal(providerFactoryCalls, 1);
});
