const { ChatBackendAdapter } = require('./base');
const openclawClient = require('../../openclawClient');

function resolveOpenClawSettings(settings = {}) {
  const openclaw = settings && typeof settings.openclaw === 'object' ? settings.openclaw : {};

  const baseUrl = typeof openclaw.baseUrl === 'string' ? openclaw.baseUrl : settings.baseUrl;
  const agentId = typeof openclaw.agentId === 'string' ? openclaw.agentId : settings.agentId;
  const token = typeof openclaw.token === 'string' ? openclaw.token : settings.token;

  return {
    baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
    agentId: typeof agentId === 'string' ? agentId : '',
    token: typeof token === 'string' ? token : '',
  };
}

class OpenClawBackendAdapter extends ChatBackendAdapter {
  constructor(client = openclawClient) {
    super('openclaw');
    this.client = client;
  }

  async testConnection({ settings, signal }) {
    return this.client.testOpenClawConnection({
      settings: resolveOpenClawSettings(settings),
      signal,
    });
  }

  async startStream({ settings, sessionId, content, options = {}, signal, onEvent }) {
    return this.client.startOpenClawStream({
      settings: resolveOpenClawSettings(settings),
      sessionId,
      content,
      options,
      signal,
      onEvent,
    });
  }

  mapError(error) {
    return this.client.toClientError(error);
  }
}

module.exports = {
  OpenClawBackendAdapter,
};
