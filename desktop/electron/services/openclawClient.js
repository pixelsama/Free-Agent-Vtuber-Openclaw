const { createSseParser } = require('./sseParser');
const { mapOpenClawSseEvent } = require('./eventMapper');

class OpenClawClientError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'OpenClawClientError';
    this.code = code;
    this.status = status;
  }
}

function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeSettings(settings = {}) {
  return {
    baseUrl: typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '',
    token: typeof settings.token === 'string' ? settings.token.trim() : '',
    agentId: typeof settings.agentId === 'string' ? settings.agentId.trim() : '',
  };
}

function ensureSettingsReady(settings) {
  if (!settings.baseUrl || !settings.token || !settings.agentId) {
    throw new OpenClawClientError(
      'openclaw_missing_config',
      'OpenClaw 配置不完整，请先填写 Base URL、Token 与 Agent ID。',
    );
  }

  let parsed;
  try {
    parsed = new URL(settings.baseUrl);
  } catch {
    throw new OpenClawClientError('openclaw_invalid_base_url', 'OpenClaw Base URL 格式无效。');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new OpenClawClientError('openclaw_invalid_base_url', 'OpenClaw Base URL 必须是 HTTP 或 HTTPS。');
  }

  return stripTrailingSlash(parsed.toString());
}

async function safeReadError(response) {
  try {
    const text = await response.text();
    return text || response.statusText || 'upstream error';
  } catch {
    return response.statusText || 'upstream error';
  }
}

function mapHttpError(status, message) {
  if (status === 401 || status === 403) {
    return new OpenClawClientError('openclaw_unauthorized', message, status);
  }

  if (status === 429) {
    return new OpenClawClientError('openclaw_rate_limited', message, status);
  }

  return new OpenClawClientError('openclaw_upstream_error', message, status);
}

function toClientError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return {
      code: error.code,
      message: error.message || 'OpenClaw 请求失败。',
      status: error.status,
    };
  }

  if (error instanceof OpenClawClientError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  if (error?.name === 'AbortError') {
    return {
      code: 'aborted',
      message: 'stream aborted',
    };
  }

  if (error instanceof TypeError) {
    return {
      code: 'openclaw_unreachable',
      message: '无法连接 OpenClaw，请检查网络与地址。',
    };
  }

  return {
    code: 'openclaw_upstream_error',
    message: error?.message || 'OpenClaw 请求失败。',
  };
}

function buildPayload({ sessionId, content, options = {}, agentId }) {
  const payload = {
    model: `openclaw:${agentId}`,
    stream: true,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    user: sessionId,
  };

  if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) {
    payload.temperature = options.temperature;
  }

  return payload;
}

async function startOpenClawStream({ settings, sessionId, content, options = {}, signal, onEvent }) {
  const normalized = normalizeSettings(settings);
  const baseUrl = ensureSettingsReady(normalized);
  const targetUrl = `${baseUrl}/v1/chat/completions`;

  let response;
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalized.token}`,
        accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildPayload({
          sessionId,
          content,
          options,
          agentId: normalized.agentId,
        }),
      ),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    throw toClientError(error);
  }

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw mapHttpError(response.status, detail);
  }

  if (!response.body) {
    throw new OpenClawClientError('openclaw_upstream_error', 'OpenClaw 未返回可读流。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let doneSeen = false;

  const parser = createSseParser((sseEvent) => {
    const mapped = mapOpenClawSseEvent(sseEvent);
    if (!mapped) {
      return;
    }

    if (mapped.type === 'done') {
      doneSeen = true;
    }

    onEvent(mapped);
  });

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    parser.push(decoder.decode(value, { stream: true }));
  }

  parser.push(decoder.decode());
  parser.flush();

  if (!doneSeen) {
    onEvent({
      type: 'done',
      payload: { source: 'openclaw' },
    });
  }
}

async function testOpenClawConnection({ settings }) {
  const normalized = normalizeSettings(settings);
  const baseUrl = ensureSettingsReady(normalized);
  const targetUrl = `${baseUrl}/v1/chat/completions`;

  let response;
  const startAt = Date.now();
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalized.token}`,
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `openclaw:${normalized.agentId}`,
        stream: false,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
        user: 'desktop-connection-test',
      }),
    });
  } catch (error) {
    throw toClientError(error);
  }

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw mapHttpError(response.status, detail);
  }

  await response.text();

  return {
    ok: true,
    latencyMs: Date.now() - startAt,
  };
}

module.exports = {
  OpenClawClientError,
  startOpenClawStream,
  testOpenClawConnection,
  toClientError,
  normalizeSettings,
};
