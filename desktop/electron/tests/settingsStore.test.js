const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { SettingsStore } = require('../services/settingsStore');
const { OPENCLAW_ACCOUNT_NAME, NANOBOT_ACCOUNT_NAME } = require('../services/secretStore');

class FakeSecretStore {
  constructor({
    available = true,
    secrets = {},
    throwOnGet = false,
    throwOnSet = false,
    throwOnDelete = false,
  } = {}) {
    this.available = available;
    this.secrets = {
      ...secrets,
    };
    this.throwOnGet = throwOnGet;
    this.throwOnSet = throwOnSet;
    this.throwOnDelete = throwOnDelete;
  }

  isAvailable() {
    return this.available;
  }

  async getSecret(accountName) {
    if (this.throwOnGet) {
      throw new Error('secure_get_failed');
    }
    return this.secrets[accountName] || null;
  }

  async setSecret(accountName, value) {
    if (this.throwOnSet) {
      throw new Error('secure_set_failed');
    }
    if (!this.available) {
      return false;
    }
    this.secrets[accountName] = value;
    return true;
  }

  async deleteSecret(accountName) {
    if (this.throwOnDelete) {
      throw new Error('secure_delete_failed');
    }
    if (!this.available) {
      return false;
    }
    delete this.secrets[accountName];
    return true;
  }
}

async function setupTempStore({ fileContent, secretStore } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-store-test-'));
  const app = {
    getPath() {
      return tmpDir;
    },
  };

  if (fileContent) {
    await fs.writeFile(path.join(tmpDir, 'openclaw-settings.json'), JSON.stringify(fileContent), 'utf-8');
  }

  const store = new SettingsStore(app, secretStore);
  await store.init();

  return {
    store,
    tmpDir,
  };
}

test('migrates legacy openclaw token and settings shape', async () => {
  const secretStore = new FakeSecretStore({ available: true });
  const { store, tmpDir } = await setupTempStore({
    fileContent: {
      baseUrl: 'http://127.0.0.1:18789',
      agentId: 'main',
      token: 'legacy-openclaw-token',
    },
    secretStore,
  });

  const mainSettings = store.getForMain();
  assert.equal(mainSettings.chatBackend, 'openclaw');
  assert.equal(mainSettings.openclaw.baseUrl, 'http://127.0.0.1:18789');
  assert.equal(mainSettings.openclaw.agentId, 'main');
  assert.equal(mainSettings.openclaw.token, 'legacy-openclaw-token');
  assert.equal(mainSettings.token, 'legacy-openclaw-token');
  assert.equal(secretStore.secrets[OPENCLAW_ACCOUNT_NAME], 'legacy-openclaw-token');

  const fileRaw = await fs.readFile(path.join(tmpDir, 'openclaw-settings.json'), 'utf-8');
  const persisted = JSON.parse(fileRaw);
  assert.equal(persisted.chatBackend, 'openclaw');
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'token'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.openclaw, 'token'), false);
});

test('migrates legacy nanobot api key into secure storage', async () => {
  const secretStore = new FakeSecretStore({ available: true });
  const { store, tmpDir } = await setupTempStore({
    fileContent: {
      chatBackend: 'nanobot',
      openclaw: {
        baseUrl: 'http://127.0.0.1:18789',
        agentId: 'main',
      },
      nanobot: {
        enabled: true,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
        apiKey: 'legacy-nanobot-api-key',
      },
    },
    secretStore,
  });

  const mainSettings = store.getForMain();
  assert.equal(mainSettings.chatBackend, 'nanobot');
  assert.equal(mainSettings.nanobot.enabled, true);
  assert.equal(mainSettings.nanobot.apiKey, 'legacy-nanobot-api-key');
  assert.equal(secretStore.secrets[NANOBOT_ACCOUNT_NAME], 'legacy-nanobot-api-key');

  const fileRaw = await fs.readFile(path.join(tmpDir, 'openclaw-settings.json'), 'utf-8');
  const persisted = JSON.parse(fileRaw);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.nanobot, 'apiKey'), false);
});

test('falls back to plain text secrets when secure storage is unavailable', async () => {
  const secretStore = new FakeSecretStore({ available: false });
  const { store, tmpDir } = await setupTempStore({ secretStore });

  await store.save({
    chatBackend: 'nanobot',
    openclaw: {
      baseUrl: 'http://localhost:3001',
      agentId: 'agent-x',
      token: 'plain-openclaw-token',
    },
    nanobot: {
      enabled: true,
      workspace: '/tmp/nanobot-workspace',
      allowHighRiskTools: true,
      provider: 'openrouter',
      model: 'anthropic/claude-opus-4-5',
      apiKey: 'plain-nanobot-api-key',
    },
  });

  const publicSettings = store.getPublic();
  assert.equal(publicSettings.chatBackend, 'nanobot');
  assert.equal(publicSettings.hasSecureStorage, false);
  assert.equal(publicSettings.hasToken, true);
  assert.equal(publicSettings.nanobot.hasApiKey, true);
  assert.equal(publicSettings.nanobot.allowHighRiskTools, true);

  const fileRaw = await fs.readFile(path.join(tmpDir, 'openclaw-settings.json'), 'utf-8');
  const persisted = JSON.parse(fileRaw);
  assert.equal(persisted.openclaw.token, 'plain-openclaw-token');
  assert.equal(persisted.nanobot.apiKey, 'plain-nanobot-api-key');
  assert.equal(persisted.nanobot.allowHighRiskTools, true);
});

test('preserves tokens when save payload omits tokens', async () => {
  const secretStore = new FakeSecretStore({
    available: true,
    secrets: {
      [OPENCLAW_ACCOUNT_NAME]: 'saved-openclaw-token',
      [NANOBOT_ACCOUNT_NAME]: 'saved-nanobot-api-key',
    },
  });
  const { store } = await setupTempStore({
    fileContent: {
      chatBackend: 'nanobot',
      openclaw: {
        baseUrl: 'http://127.0.0.1:18789',
        agentId: 'main',
      },
      nanobot: {
        enabled: true,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
      },
    },
    secretStore,
  });

  await store.save({
    openclaw: {
      baseUrl: 'http://localhost:9001',
      agentId: 'agent-y',
    },
    nanobot: {
      model: 'openai/gpt-4.1',
      temperature: 0.4,
    },
  });

  const mainSettings = store.getForMain();
  assert.equal(mainSettings.openclaw.token, 'saved-openclaw-token');
  assert.equal(mainSettings.nanobot.apiKey, 'saved-nanobot-api-key');
  assert.equal(mainSettings.openclaw.baseUrl, 'http://localhost:9001');
  assert.equal(mainSettings.nanobot.model, 'openai/gpt-4.1');
});

test('clears openclaw and nanobot secrets explicitly', async () => {
  const secretStore = new FakeSecretStore({
    available: true,
    secrets: {
      [OPENCLAW_ACCOUNT_NAME]: 'saved-openclaw-token',
      [NANOBOT_ACCOUNT_NAME]: 'saved-nanobot-api-key',
    },
  });
  const { store } = await setupTempStore({ secretStore });

  await store.save({
    clearToken: true,
    clearNanobotApiKey: true,
  });

  const publicSettings = store.getPublic();
  assert.equal(publicSettings.hasToken, false);
  assert.equal(publicSettings.nanobot.hasApiKey, false);
  assert.equal(store.getForMain().openclaw.token, '');
  assert.equal(store.getForMain().nanobot.apiKey, '');
  assert.equal(secretStore.secrets[OPENCLAW_ACCOUNT_NAME], undefined);
  assert.equal(secretStore.secrets[NANOBOT_ACCOUNT_NAME], undefined);
});

test('merge applies backend-specific override payload', async () => {
  const secretStore = new FakeSecretStore({
    available: true,
    secrets: {
      [OPENCLAW_ACCOUNT_NAME]: 'saved-openclaw-token',
      [NANOBOT_ACCOUNT_NAME]: 'saved-nanobot-api-key',
    },
  });
  const { store } = await setupTempStore({
    fileContent: {
      chatBackend: 'openclaw',
      openclaw: {
        baseUrl: 'http://127.0.0.1:18789',
        agentId: 'main',
      },
      nanobot: {
        enabled: false,
        provider: 'openrouter',
        model: 'anthropic/claude-opus-4-5',
      },
    },
    secretStore,
  });

  const merged = store.merge({
    chatBackend: 'nanobot',
    openclaw: {
      token: 'override-openclaw-token',
    },
    nanobot: {
      enabled: true,
      provider: 'openrouter',
      model: 'openai/gpt-4.1',
      apiKey: 'override-nanobot-api-key',
    },
  });

  assert.equal(merged.chatBackend, 'nanobot');
  assert.equal(merged.openclaw.token, 'override-openclaw-token');
  assert.equal(merged.nanobot.enabled, true);
  assert.equal(merged.nanobot.model, 'openai/gpt-4.1');
  assert.equal(merged.nanobot.apiKey, 'override-nanobot-api-key');

  const mergedWithoutApiKeyOverride = store.merge({
    chatBackend: 'nanobot',
    nanobot: {
      enabled: true,
      provider: 'openrouter',
      model: 'openai/gpt-4.1',
    },
  });
  assert.equal(mergedWithoutApiKeyOverride.nanobot.apiKey, 'saved-nanobot-api-key');
});

test('falls back when secure storage throws at runtime', async () => {
  const secretStore = new FakeSecretStore({
    available: true,
    throwOnGet: true,
    throwOnSet: true,
  });
  const { store, tmpDir } = await setupTempStore({ secretStore });

  await store.save({
    openclaw: { token: 'fallback-openclaw-token' },
    nanobot: { apiKey: 'fallback-nanobot-api-key' },
  });

  const publicSettings = store.getPublic();
  assert.equal(publicSettings.hasSecureStorage, false);
  assert.equal(store.getForMain().openclaw.token, 'fallback-openclaw-token');
  assert.equal(store.getForMain().nanobot.apiKey, 'fallback-nanobot-api-key');

  const fileRaw = await fs.readFile(path.join(tmpDir, 'openclaw-settings.json'), 'utf-8');
  const persisted = JSON.parse(fileRaw);
  assert.equal(persisted.openclaw.token, 'fallback-openclaw-token');
  assert.equal(persisted.nanobot.apiKey, 'fallback-nanobot-api-key');
});
