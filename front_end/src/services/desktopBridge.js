const SETTINGS_STORAGE_KEY = 'openclaw.settings';

function getDesktopApi() {
  if (typeof window === 'undefined') {
    return null;
  }

  const api = window.desktop;
  if (!api || !api.isElectron) {
    return null;
  }

  return api;
}

function normalizeSettings(settings = {}) {
  return {
    baseUrl: typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '',
    token: typeof settings.token === 'string' ? settings.token.trim() : '',
    agentId: typeof settings.agentId === 'string' ? settings.agentId.trim() : 'main',
  };
}

function loadWebSettings() {
  if (typeof window === 'undefined') {
    return {
      baseUrl: '',
      token: '',
      agentId: 'main',
    };
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        baseUrl: '',
        token: '',
        agentId: 'main',
      };
    }

    return {
      baseUrl: '',
      token: '',
      agentId: 'main',
      ...normalizeSettings(JSON.parse(raw)),
    };
  } catch {
    return {
      baseUrl: '',
      token: '',
      agentId: 'main',
    };
  }
}

function saveWebSettings(partialSettings = {}) {
  const merged = {
    ...loadWebSettings(),
    ...normalizeSettings(partialSettings),
  };

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
  }

  return merged;
}

async function testWebConnection(inputSettings = {}) {
  const settings = {
    ...loadWebSettings(),
    ...normalizeSettings(inputSettings),
  };

  if (!settings.baseUrl || !settings.token || !settings.agentId) {
    return {
      ok: false,
      error: {
        code: 'openclaw_missing_config',
        message: '请先填写 OpenClaw Base URL / Token / Agent ID。',
      },
    };
  }

  try {
    const startAt = Date.now();
    const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: `openclaw:${settings.agentId}`,
        stream: false,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        ok: false,
        error: {
          code: 'openclaw_upstream_error',
          message: detail || `连接失败 (${response.status})`,
        },
      };
    }

    await response.text();

    return {
      ok: true,
      latencyMs: Date.now() - startAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'openclaw_unreachable',
        message: error?.message || '无法访问 OpenClaw。',
      },
    };
  }
}

export const desktopBridge = {
  isDesktop() {
    return Boolean(getDesktopApi());
  },
  chat: {
    start(request) {
      const api = getDesktopApi();
      if (!api?.chatStream?.start) {
        throw new Error('desktop_chat_unavailable');
      }
      return api.chatStream.start(request);
    },
    abort(request) {
      const api = getDesktopApi();
      if (!api?.chatStream?.abort) {
        return Promise.resolve({ ok: false, reason: 'desktop_chat_unavailable' });
      }
      return api.chatStream.abort(request);
    },
    onEvent(handler) {
      const api = getDesktopApi();
      if (!api?.chatStream?.onEvent) {
        return () => {};
      }
      return api.chatStream.onEvent(handler);
    },
  },
  settings: {
    async get() {
      const api = getDesktopApi();
      if (api?.settings?.get) {
        return normalizeSettings(await api.settings.get());
      }
      return loadWebSettings();
    },
    async save(partialSettings = {}) {
      const api = getDesktopApi();
      if (api?.settings?.save) {
        const saved = await api.settings.save(partialSettings);
        return normalizeSettings(saved);
      }
      return saveWebSettings(partialSettings);
    },
    async testConnection(overrideSettings = {}) {
      const api = getDesktopApi();
      if (api?.settings?.testConnection) {
        return api.settings.testConnection(overrideSettings);
      }
      return testWebConnection(overrideSettings);
    },
  },
};
