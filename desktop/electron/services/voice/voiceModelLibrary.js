const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const ROOT_DIR_NAME = 'voice-models';
const BUNDLES_DIR_NAME = 'bundles';
const STATE_FILE_NAME = 'state.json';
const MAX_REDIRECTS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function createVoiceModelError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeOptionalText(value, fallback = '') {
  const text = sanitizeText(value);
  return text || fallback;
}

function normalizeBundleRecord(bundle = {}) {
  const id = sanitizeText(bundle.id);
  const name = sanitizeText(bundle.name);
  if (!id || !name) {
    return null;
  }

  const normalizeAsr = () => {
    if (!bundle.asr || typeof bundle.asr !== 'object') {
      return null;
    }

    const modelPath = sanitizeText(bundle.asr.modelPath);
    const tokensPath = sanitizeText(bundle.asr.tokensPath);
    if (!modelPath || !tokensPath) {
      return null;
    }

    return {
      modelPath,
      tokensPath,
      modelKind: sanitizeOptionalText(bundle.asr.modelKind, 'zipformerctc'),
      executionProvider: sanitizeOptionalText(bundle.asr.executionProvider, 'cpu'),
    };
  };

  const normalizeTts = () => {
    if (!bundle.tts || typeof bundle.tts !== 'object') {
      return null;
    }

    const modelPath = sanitizeText(bundle.tts.modelPath);
    const voicesPath = sanitizeText(bundle.tts.voicesPath);
    const tokensPath = sanitizeText(bundle.tts.tokensPath);
    if (!modelPath || !voicesPath || !tokensPath) {
      return null;
    }

    return {
      modelPath,
      voicesPath,
      tokensPath,
      modelKind: sanitizeOptionalText(bundle.tts.modelKind, 'kokoro'),
      executionProvider: sanitizeOptionalText(bundle.tts.executionProvider, 'cpu'),
    };
  };

  const asr = normalizeAsr();
  const tts = normalizeTts();
  if (!asr && !tts) {
    return null;
  }

  return {
    id,
    name,
    createdAt: sanitizeOptionalText(bundle.createdAt, new Date().toISOString()),
    asr,
    tts,
  };
}

function normalizeState(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const bundles = Array.isArray(source.bundles)
    ? source.bundles.map((item) => normalizeBundleRecord(item)).filter(Boolean)
    : [];
  const idSet = new Set(bundles.map((item) => item.id));
  const selectedBundleId = idSet.has(source.selectedBundleId) ? source.selectedBundleId : '';

  return {
    bundles,
    selectedBundleId,
  };
}

function createBundleId(bundleName) {
  const normalized = sanitizeText(bundleName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const prefix = normalized || 'voice-model';
  return `${prefix}-${suffix}`;
}

function resolveHttpModule(protocol) {
  if (protocol === 'http:') {
    return http;
  }
  if (protocol === 'https:') {
    return https;
  }

  throw createVoiceModelError('voice_model_download_protocol_unsupported', `Unsupported protocol: ${protocol}`);
}

function requestWithRedirect(urlString, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(createVoiceModelError('voice_model_download_invalid_url', `Invalid URL: ${urlString}`));
      return;
    }

    let client = null;
    try {
      client = resolveHttpModule(parsedUrl.protocol);
    } catch (error) {
      reject(error);
      return;
    }
    const request = client.get(
      parsedUrl,
      {
        headers: {
          'user-agent': 'free-agent-vtuber-openclaw/voice-model-downloader',
        },
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const redirectLocation = response.headers.location;
        if (
          redirectLocation
          && statusCode >= 300
          && statusCode < 400
        ) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(
              createVoiceModelError(
                'voice_model_download_redirect_overflow',
                `Too many redirects while downloading: ${urlString}`,
              ),
            );
            return;
          }

          const nextUrl = new URL(redirectLocation, parsedUrl).toString();
          requestWithRedirect(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(
            createVoiceModelError(
              'voice_model_download_http_error',
              `Download failed (${statusCode}) for ${urlString}`,
            ),
          );
          return;
        }

        resolve({
          response,
          finalUrl: parsedUrl.toString(),
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(
        createVoiceModelError(
          'voice_model_download_timeout',
          `Download timeout for ${urlString}`,
        ),
      );
    });
    request.on('error', (error) => {
      reject(error);
    });
  });
}

async function downloadFileFromUrl({ url, destinationPath, onProgress }) {
  const { response } = await requestWithRedirect(url, MAX_REDIRECTS);
  const totalBytes = Number.parseInt(response.headers['content-length'], 10);
  const hasTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0;
  const expectedTotal = hasTotalBytes ? totalBytes : 0;

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const writeStream = fs.createWriteStream(tempPath);

  let downloadedBytes = 0;
  response.on('data', (chunk) => {
    downloadedBytes += chunk.length;
    if (typeof onProgress === 'function') {
      onProgress({
        downloadedBytes,
        totalBytes: expectedTotal,
      });
    }
  });

  try {
    await pipeline(response, writeStream);
    await fsp.rename(tempPath, destinationPath);
  } catch (error) {
    try {
      await fsp.rm(tempPath, { force: true });
    } catch {
      // noop
    }
    throw error;
  }

  return {
    downloadedBytes,
    totalBytes: expectedTotal,
  };
}

class VoiceModelLibrary {
  constructor(app, { downloadFileImpl = downloadFileFromUrl } = {}) {
    this.app = app;
    this.downloadFileImpl = downloadFileImpl;

    this.rootDir = path.join(this.app.getPath('userData'), ROOT_DIR_NAME);
    this.bundlesDir = path.join(this.rootDir, BUNDLES_DIR_NAME);
    this.stateFilePath = path.join(this.rootDir, STATE_FILE_NAME);
    this.state = normalizeState({});
  }

  async init() {
    await fsp.mkdir(this.bundlesDir, { recursive: true });

    try {
      const raw = await fsp.readFile(this.stateFilePath, 'utf-8');
      this.state = normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load voice model state:', error);
      }
      await this.persistState();
    }
  }

  listBundles() {
    return {
      rootDir: this.rootDir,
      selectedBundleId: this.state.selectedBundleId,
      bundles: this.state.bundles.map((bundle) => ({
        ...bundle,
      })),
    };
  }

  getSelectedBundle() {
    if (!this.state.selectedBundleId) {
      return null;
    }

    return this.state.bundles.find((item) => item.id === this.state.selectedBundleId) || null;
  }

  selectBundle(bundleId) {
    const nextBundleId = sanitizeText(bundleId);
    if (!nextBundleId) {
      this.state.selectedBundleId = '';
      return this.persistState();
    }

    const found = this.state.bundles.some((item) => item.id === nextBundleId);
    if (!found) {
      throw createVoiceModelError('voice_model_bundle_not_found', `Model bundle not found: ${nextBundleId}`);
    }

    this.state.selectedBundleId = nextBundleId;
    return this.persistState();
  }

  getRuntimeEnv(baseEnv = process.env) {
    const env = {
      ...(baseEnv || {}),
    };

    const selectedBundle = this.getSelectedBundle();
    if (!selectedBundle) {
      return env;
    }

    if (selectedBundle.asr) {
      env.VOICE_ASR_PROVIDER = 'sherpa-onnx';
      env.VOICE_ASR_SHERPA_MODEL = selectedBundle.asr.modelPath;
      env.VOICE_ASR_SHERPA_TOKENS = selectedBundle.asr.tokensPath;
      env.VOICE_ASR_SHERPA_MODEL_KIND = selectedBundle.asr.modelKind;
      env.VOICE_ASR_SHERPA_EXECUTION_PROVIDER = selectedBundle.asr.executionProvider;
    }

    if (selectedBundle.tts) {
      env.VOICE_TTS_PROVIDER = 'sherpa-onnx';
      env.VOICE_TTS_SHERPA_MODEL_KIND = selectedBundle.tts.modelKind;
      env.VOICE_TTS_SHERPA_MODEL = selectedBundle.tts.modelPath;
      env.VOICE_TTS_SHERPA_VOICES = selectedBundle.tts.voicesPath;
      env.VOICE_TTS_SHERPA_TOKENS = selectedBundle.tts.tokensPath;
      env.VOICE_TTS_SHERPA_EXECUTION_PROVIDER = selectedBundle.tts.executionProvider;
    }

    if (selectedBundle.asr && selectedBundle.tts && !sanitizeText(env.VOICE_TTS_AUTO_ON_ASR_FINAL)) {
      env.VOICE_TTS_AUTO_ON_ASR_FINAL = '1';
    }

    return env;
  }

  async downloadBundle(
    {
      bundleName,
      asr = {},
      tts = {},
    } = {},
    { onProgress } = {},
  ) {
    const asrModelUrl = sanitizeText(asr.modelUrl);
    const asrTokensUrl = sanitizeText(asr.tokensUrl);
    const ttsModelUrl = sanitizeText(tts.modelUrl);
    const ttsVoicesUrl = sanitizeText(tts.voicesUrl);
    const ttsTokensUrl = sanitizeText(tts.tokensUrl);

    const hasAsr = Boolean(asrModelUrl || asrTokensUrl);
    const hasTts = Boolean(ttsModelUrl || ttsVoicesUrl || ttsTokensUrl);
    if (!hasAsr && !hasTts) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'Please provide ASR or TTS download URLs.',
      );
    }

    if (hasAsr && (!asrModelUrl || !asrTokensUrl)) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'ASR requires both model URL and tokens URL.',
      );
    }

    if (hasTts && (!ttsModelUrl || !ttsVoicesUrl || !ttsTokensUrl)) {
      throw createVoiceModelError(
        'voice_model_download_invalid_input',
        'TTS requires model/voices/tokens URLs.',
      );
    }

    const id = createBundleId(bundleName);
    const name = sanitizeOptionalText(bundleName, id);
    const bundleDir = path.join(this.bundlesDir, id);
    await fsp.mkdir(bundleDir, { recursive: true });

    const downloadTasks = [];
    if (hasAsr) {
      downloadTasks.push({
        key: 'asr.model',
        fileName: 'asr-model.onnx',
        destinationPath: path.join(bundleDir, 'asr-model.onnx'),
        url: asrModelUrl,
      });
      downloadTasks.push({
        key: 'asr.tokens',
        fileName: 'asr-tokens.txt',
        destinationPath: path.join(bundleDir, 'asr-tokens.txt'),
        url: asrTokensUrl,
      });
    }
    if (hasTts) {
      downloadTasks.push({
        key: 'tts.model',
        fileName: 'tts-model.onnx',
        destinationPath: path.join(bundleDir, 'tts-model.onnx'),
        url: ttsModelUrl,
      });
      downloadTasks.push({
        key: 'tts.voices',
        fileName: 'tts-voices.bin',
        destinationPath: path.join(bundleDir, 'tts-voices.bin'),
        url: ttsVoicesUrl,
      });
      downloadTasks.push({
        key: 'tts.tokens',
        fileName: 'tts-tokens.txt',
        destinationPath: path.join(bundleDir, 'tts-tokens.txt'),
        url: ttsTokensUrl,
      });
    }

    const taskProgressMap = new Map();
    const emitProgress = ({ phase, currentTask, downloadedBytes, totalBytes, completedTasks }) => {
      if (typeof onProgress !== 'function') {
        return;
      }

      if (currentTask) {
        taskProgressMap.set(currentTask.key, {
          downloadedBytes,
          totalBytes,
        });
      }

      const totals = Array.from(taskProgressMap.values()).reduce(
        (acc, item) => {
          const hasTotal = Number.isFinite(item.totalBytes) && item.totalBytes > 0;
          if (hasTotal) {
            acc.knownTotalBytes += item.totalBytes;
            acc.knownDownloadedBytes += Math.min(item.downloadedBytes, item.totalBytes);
          }
          return acc;
        },
        {
          knownTotalBytes: 0,
          knownDownloadedBytes: 0,
        },
      );

      const overallProgress =
        phase === 'completed'
          ? 1
          : totals.knownTotalBytes > 0
            ? totals.knownDownloadedBytes / totals.knownTotalBytes
            : null;

      onProgress({
        type: 'download-progress',
        phase,
        bundleId: id,
        bundleName: name,
        completedTasks,
        totalTasks: downloadTasks.length,
        currentFile: currentTask?.fileName || '',
        fileDownloadedBytes: downloadedBytes || 0,
        fileTotalBytes: totalBytes || 0,
        overallProgress,
      });
    };

    emitProgress({
      phase: 'started',
      completedTasks: 0,
      currentTask: null,
      downloadedBytes: 0,
      totalBytes: 0,
    });

    let completedTasks = 0;
    try {
      for (const task of downloadTasks) {
        await this.downloadFileImpl({
          url: task.url,
          destinationPath: task.destinationPath,
          onProgress: ({ downloadedBytes, totalBytes }) => {
            emitProgress({
              phase: 'running',
              currentTask: task,
              downloadedBytes,
              totalBytes,
              completedTasks,
            });
          },
        });

        completedTasks += 1;
        emitProgress({
          phase: 'running',
          currentTask: null,
          downloadedBytes: 0,
          totalBytes: 0,
          completedTasks,
        });
      }
    } catch (error) {
      emitProgress({
        phase: 'failed',
        completedTasks,
        currentTask: null,
        downloadedBytes: 0,
        totalBytes: 0,
      });
      try {
        await fsp.rm(bundleDir, { recursive: true, force: true });
      } catch {
        // noop
      }
      throw error;
    }

    const bundleRecord = normalizeBundleRecord({
      id,
      name,
      createdAt: new Date().toISOString(),
      asr: hasAsr
        ? {
            modelPath: path.join(bundleDir, 'asr-model.onnx'),
            tokensPath: path.join(bundleDir, 'asr-tokens.txt'),
            modelKind: sanitizeOptionalText(asr.modelKind, 'zipformerctc'),
            executionProvider: sanitizeOptionalText(asr.executionProvider, 'cpu'),
          }
        : null,
      tts: hasTts
        ? {
            modelPath: path.join(bundleDir, 'tts-model.onnx'),
            voicesPath: path.join(bundleDir, 'tts-voices.bin'),
            tokensPath: path.join(bundleDir, 'tts-tokens.txt'),
            modelKind: sanitizeOptionalText(tts.modelKind, 'kokoro'),
            executionProvider: sanitizeOptionalText(tts.executionProvider, 'cpu'),
          }
        : null,
    });

    if (!bundleRecord) {
      throw createVoiceModelError('voice_model_bundle_invalid', 'Failed to build model bundle record.');
    }

    this.state.bundles = this.state.bundles.filter((item) => item.id !== bundleRecord.id);
    this.state.bundles.unshift(bundleRecord);
    this.state.selectedBundleId = bundleRecord.id;
    await this.persistState();

    emitProgress({
      phase: 'completed',
      completedTasks: downloadTasks.length,
      currentTask: null,
      downloadedBytes: 0,
      totalBytes: 0,
    });

    return {
      bundle: bundleRecord,
      selectedBundleId: this.state.selectedBundleId,
      bundles: this.state.bundles.map((item) => ({ ...item })),
    };
  }

  async persistState() {
    await fsp.mkdir(this.rootDir, { recursive: true });
    await fsp.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}

module.exports = {
  VoiceModelLibrary,
  downloadFileFromUrl,
  createVoiceModelError,
};
