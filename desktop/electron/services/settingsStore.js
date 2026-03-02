const fs = require('node:fs/promises');
const path = require('node:path');

const SETTINGS_FILE = 'openclaw-settings.json';
const DEFAULT_SETTINGS = {
  baseUrl: 'http://127.0.0.1:18789',
  token: '',
  agentId: 'main',
};

function normalizeInput(settings = {}) {
  const next = {};

  if (Object.prototype.hasOwnProperty.call(settings, 'baseUrl')) {
    next.baseUrl = typeof settings.baseUrl === 'string' ? settings.baseUrl.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'token')) {
    next.token = typeof settings.token === 'string' ? settings.token.trim() : '';
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'agentId')) {
    next.agentId = typeof settings.agentId === 'string' ? settings.agentId.trim() : '';
  }

  return next;
}

class SettingsStore {
  constructor(app) {
    this.app = app;
    this.filePath = path.join(this.app.getPath('userData'), SETTINGS_FILE);
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.settings = {
        ...DEFAULT_SETTINGS,
        ...normalizeInput(parsed),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to load settings file:', error);
      }
      await this.persist();
    }
  }

  get() {
    return {
      ...this.settings,
    };
  }

  async save(partialSettings = {}) {
    this.settings = {
      ...this.settings,
      ...normalizeInput(partialSettings),
    };

    await this.persist();
    return this.get();
  }

  merge(overrideSettings = {}) {
    return {
      ...this.settings,
      ...normalizeInput(overrideSettings),
    };
  }

  async persist() {
    await fs.writeFile(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
  }
}

module.exports = {
  SettingsStore,
};
