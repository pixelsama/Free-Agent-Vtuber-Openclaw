const path = require('node:path');

const { ChatBackendAdapter } = require('./base');
const { createNanobotBridgeClient } = require('../nanobot/nanobotBridgeClient');

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim();
}

function normalizeNanobotConfig(settings = {}) {
  const source = settings && typeof settings.nanobot === 'object' ? settings.nanobot : {};
  const fallbackWorkspace = normalizeString(process.env.NANOBOT_WORKSPACE, path.resolve(process.cwd(), 'nanobot-workspace'));

  return {
    enabled: Boolean(source.enabled),
    workspace: normalizeString(source.workspace, fallbackWorkspace) || fallbackWorkspace,
    provider: normalizeString(source.provider, 'openrouter'),
    model: normalizeString(source.model, 'anthropic/claude-opus-4-5'),
    apiBase: normalizeString(source.apiBase, ''),
    apiKey: normalizeString(source.apiKey, ''),
    maxTokens: Number.isFinite(source.maxTokens) ? Math.max(1, Math.floor(source.maxTokens)) : 4096,
    temperature: Number.isFinite(source.temperature) ? Number(source.temperature) : 0.2,
    reasoningEffort: normalizeString(source.reasoningEffort, ''),
  };
}

function createNanobotError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (typeof status === 'number') {
    error.status = status;
  }
  return error;
}

class NanobotBackendAdapter extends ChatBackendAdapter {
  constructor({ bridgeClient, resolveRuntime } = {}) {
    super('nanobot');
    this.bridgeClient = bridgeClient || createNanobotBridgeClient({ resolveLaunchConfig: resolveRuntime });
  }

  validateSettings(settings) {
    const config = normalizeNanobotConfig(settings);

    if (!config.enabled) {
      throw createNanobotError('nanobot_missing_config', 'Nanobot 未启用，请先在设置中开启。');
    }

    if (!config.provider || !config.model || !config.apiKey) {
      throw createNanobotError(
        'nanobot_missing_config',
        'Nanobot 配置不完整，请先填写 Provider / Model / API Key。',
      );
    }
  }

  async testConnection({ settings }) {
    const config = normalizeNanobotConfig(settings);
    return this.bridgeClient.testConnection({ config });
  }

  async startStream({ settings, sessionId, content, signal, onEvent }) {
    const config = normalizeNanobotConfig(settings);
    return this.bridgeClient.start({
      sessionId,
      content,
      signal,
      config,
      onEvent: (event) => {
        if (!event || typeof event !== 'object') {
          return;
        }

        const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
        onEvent({
          ...event,
          payload: {
            ...payload,
            source: payload.source || 'nanobot',
          },
        });
      },
    });
  }

  mapError(error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      return {
        code: error.code,
        message: error.message || 'Nanobot 请求失败。',
        status: error.status,
      };
    }

    if (error?.name === 'AbortError') {
      return {
        code: 'aborted',
        message: 'stream aborted',
      };
    }

    return {
      code: 'nanobot_unreachable',
      message: error?.message || 'Nanobot 服务不可用。',
    };
  }

  async dispose() {
    if (this.bridgeClient && typeof this.bridgeClient.dispose === 'function') {
      await this.bridgeClient.dispose();
    }
  }
}

module.exports = {
  NanobotBackendAdapter,
  normalizeNanobotConfig,
};
