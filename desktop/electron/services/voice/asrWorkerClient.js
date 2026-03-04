const { fork } = require('node:child_process');
const path = require('node:path');

function createAbortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function normalizeProviderName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function isTruthy(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return parsed;
}

function createWorkerError(message, code = 'voice_asr_worker_error') {
  const error = new Error(message);
  error.code = code;
  error.stage = 'transcribing';
  error.retriable = true;
  return error;
}

function toRequestId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clonePcmChunk(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }

  if (
    value
    && typeof value === 'object'
    && value.type === 'Buffer'
    && Array.isArray(value.data)
  ) {
    return Buffer.from(value.data);
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value));
  }

  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  return Buffer.alloc(0);
}

function normalizeAudioChunksForWorker(audioChunks = []) {
  if (!Array.isArray(audioChunks) || !audioChunks.length) {
    return [];
  }

  return audioChunks
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      sampleRate: Number.isFinite(item.sampleRate) ? Math.floor(item.sampleRate) : 16000,
      sampleFormat: typeof item.sampleFormat === 'string' ? item.sampleFormat : 'pcm_s16le',
      pcmChunk: clonePcmChunk(item.pcmChunk),
    }));
}

function createAsrWorkerClient({ provider = null, env = process.env } = {}) {
  const configuredProvider = normalizeProviderName(provider) || normalizeProviderName(env?.VOICE_ASR_PROVIDER);
  const disableWorker = isTruthy(env?.VOICE_ASR_DISABLE_WORKER, false);
  const workerMaxOldSpaceMb = toPositiveInteger(env?.VOICE_ASR_WORKER_MAX_OLD_SPACE_MB);
  const warmupTimeoutMs = Math.max(
    1_000,
    toPositiveInteger(env?.VOICE_ASR_WORKER_WARMUP_TIMEOUT_MS)
      || toPositiveInteger(env?.VOICE_ASR_PYTHON_TIMEOUT_MS)
      || 120_000,
  );

  if (disableWorker || configuredProvider !== 'python') {
    return null;
  }

  let worker = null;
  let disposed = false;
  let requestSeq = 0;
  let warmupSeq = 0;
  const pendingRequests = new Map();
  const pendingWarmups = new Map();
  let readyPromise = null;
  let hasWarmedUp = false;
  let warmupInFlight = null;

  const workerFilePath = path.join(__dirname, 'asrWorkerProcess.js');

  const cleanupPendingRequests = (error) => {
    for (const [, pending] of pendingRequests.entries()) {
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      pending.reject(error);
    }
    pendingRequests.clear();
  };

  const cleanupPendingWarmups = (error) => {
    for (const [, pending] of pendingWarmups.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    pendingWarmups.clear();
    warmupInFlight = null;
  };

  const ensureWorker = () => {
    if (disposed) {
      throw createWorkerError('ASR worker client has been disposed.', 'voice_asr_worker_disposed');
    }

    if (worker && !worker.killed) {
      return worker;
    }

    const forkOptions = {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    };
    if (workerMaxOldSpaceMb > 0) {
      forkOptions.execArgv = [`--max-old-space-size=${workerMaxOldSpaceMb}`];
    }
    worker = fork(workerFilePath, [], forkOptions);

    worker.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim()) {
        console.warn(`[voice-asr-worker] ${text.trim()}`);
      }
    });

    worker.on('message', (message = {}) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'ready') {
        return;
      }

      const requestId = toRequestId(message.requestId);
      if (!requestId) {
        return;
      }

      if (message.type === 'warmup-done') {
        const pending = pendingWarmups.get(requestId);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeoutId);
        pendingWarmups.delete(requestId);
        hasWarmedUp = true;
        pending.resolve();
        return;
      }

      if (message.type === 'warmup-error') {
        const pending = pendingWarmups.get(requestId);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeoutId);
        pendingWarmups.delete(requestId);
        const errorPayload = message.error && typeof message.error === 'object' ? message.error : {};
        const error = new Error(errorPayload.message || 'ASR worker warmup failed.');
        error.name = errorPayload.name || 'Error';
        if (errorPayload.code) {
          error.code = errorPayload.code;
        }
        if (errorPayload.stage) {
          error.stage = errorPayload.stage;
        }
        error.retriable = Boolean(errorPayload.retriable);
        pending.reject(error);
        return;
      }

      const pending = pendingRequests.get(requestId);
      if (!pending) {
        return;
      }

      if (message.type === 'transcribe-done') {
        pendingRequests.delete(requestId);
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener('abort', pending.onAbort);
        }

        const text = typeof message.text === 'string' ? message.text : '';
        Promise.resolve()
          .then(async () => {
            if (text && typeof pending.onPartial === 'function') {
              await pending.onPartial(text);
            }
            pending.resolve({ text });
          })
          .catch((error) => {
            pending.reject(error);
          });
        return;
      }

      if (message.type === 'transcribe-error') {
        pendingRequests.delete(requestId);
        if (pending.signal && pending.onAbort) {
          pending.signal.removeEventListener('abort', pending.onAbort);
        }

        const errorPayload = message.error && typeof message.error === 'object' ? message.error : {};
        const error = new Error(errorPayload.message || 'ASR worker transcribe failed.');
        error.name = errorPayload.name || 'Error';
        if (errorPayload.code) {
          error.code = errorPayload.code;
        }
        if (errorPayload.stage) {
          error.stage = errorPayload.stage;
        }
        error.retriable = Boolean(errorPayload.retriable);
        pending.reject(error);
      }
    });

    worker.on('exit', (code, signal) => {
      const reason = `ASR worker exited (code=${code}, signal=${signal || 'none'}).`;
      const error = createWorkerError(reason, 'voice_asr_worker_exited');
      cleanupPendingRequests(error);
      cleanupPendingWarmups(error);
      worker = null;
      readyPromise = null;
      hasWarmedUp = false;
    });

    worker.on('error', (error) => {
      const wrapped = createWorkerError(
        `ASR worker process failed: ${error?.message || 'unknown error'}`,
        'voice_asr_worker_spawn_failed',
      );
      cleanupPendingRequests(wrapped);
      cleanupPendingWarmups(wrapped);
    });

    readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(createWorkerError('ASR worker init timeout.', 'voice_asr_worker_init_timeout'));
      }, 5000);

      const onMessage = (message = {}) => {
        if (message?.type !== 'ready') {
          return;
        }
        clearTimeout(timer);
        worker?.off('message', onMessage);
        resolve();
      };

      worker?.on('message', onMessage);
      worker?.send({
        type: 'init',
        provider: configuredProvider,
        env,
      });
    });

    return worker;
  };

  const ensureReady = async () => {
    ensureWorker();
    if (readyPromise) {
      await readyPromise;
    }
  };

  const sendTranscribeRequest = async ({ audioChunks = [], signal, onPartial } = {}) => {
    await ensureReady();

    if (!worker || worker.killed) {
      throw createWorkerError('ASR worker is unavailable.', 'voice_asr_worker_unavailable');
    }

    requestSeq += 1;
    const requestId = `asr-${Date.now().toString(36)}-${requestSeq.toString(36)}`;

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        worker?.send({
          type: 'abort',
          requestId,
        });
        pendingRequests.delete(requestId);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
        reject(createAbortError());
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pendingRequests.set(requestId, {
        resolve,
        reject,
        onPartial,
        signal,
        onAbort,
      });

      worker.send({
        type: 'transcribe',
        requestId,
        audioChunks: normalizeAudioChunksForWorker(audioChunks),
      });
    });
  };

  const transcribe = async ({ audioChunks = [], signal, onPartial } = {}) =>
    sendTranscribeRequest({
      audioChunks,
      signal,
      onPartial,
    });

  const sendWarmupRequest = async () => {
    await ensureReady();

    if (!worker || worker.killed) {
      throw createWorkerError('ASR worker is unavailable.', 'voice_asr_worker_unavailable');
    }

    warmupSeq += 1;
    const requestId = `warmup-${Date.now().toString(36)}-${warmupSeq.toString(36)}`;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingWarmups.delete(requestId);
        reject(createWorkerError('ASR worker warmup timeout.', 'voice_asr_worker_warmup_timeout'));
      }, warmupTimeoutMs);
      timeoutId.unref?.();

      pendingWarmups.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });

      worker.send({
        type: 'warmup',
        requestId,
      });
    });
  };

  const warmup = async () => {
    if (hasWarmedUp) {
      return;
    }

    if (warmupInFlight) {
      return warmupInFlight;
    }

    warmupInFlight = sendWarmupRequest()
      .then(() => {
        hasWarmedUp = true;
      })
      .finally(() => {
        warmupInFlight = null;
      });

    return warmupInFlight;
  };

  const dispose = async () => {
    disposed = true;
    const existingWorker = worker;
    if (!existingWorker) {
      return;
    }

    cleanupPendingRequests(createAbortError());
    cleanupPendingWarmups(createAbortError());
    readyPromise = null;
    worker = null;
    hasWarmedUp = false;

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!existingWorker.killed) {
          existingWorker.kill('SIGTERM');
        }
        resolve();
      }, 1000);

      existingWorker.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      existingWorker.disconnect();
    });
  };

  return {
    transcribe,
    warmup,
    dispose,
  };
}

module.exports = {
  createAsrWorkerClient,
};
