const SERVICE_NAME = 'free-agent-vtuber-openclaw';
const OPENCLAW_ACCOUNT_NAME = 'openclaw-token';
const NANOBOT_ACCOUNT_NAME = 'nanobot-api-key';

class KeytarSecretStore {
  constructor() {
    this.keytar = null;
    this.keytarLoadAttempted = false;
  }

  isAvailable() {
    return Boolean(this.loadKeytar());
  }

  loadKeytar() {
    if (this.keytarLoadAttempted) {
      return this.keytar;
    }

    this.keytarLoadAttempted = true;
    try {
      // keytar is optional at runtime. If unavailable, we gracefully fall back.
      // eslint-disable-next-line global-require
      this.keytar = require('keytar');
    } catch (error) {
      console.warn('keytar is unavailable, falling back to insecure token storage:', error?.message || error);
      this.keytar = null;
    }

    return this.keytar;
  }

  async getSecret(accountName) {
    const account = typeof accountName === 'string' ? accountName.trim() : '';
    if (!account) {
      return null;
    }

    const keytar = this.loadKeytar();
    if (!keytar) {
      return null;
    }

    const token = await keytar.getPassword(SERVICE_NAME, account);
    return token || null;
  }

  async setSecret(accountName, value) {
    const account = typeof accountName === 'string' ? accountName.trim() : '';
    if (!account) {
      return false;
    }

    const keytar = this.loadKeytar();
    if (!keytar) {
      return false;
    }

    await keytar.setPassword(SERVICE_NAME, account, value);
    return true;
  }

  async deleteSecret(accountName) {
    const account = typeof accountName === 'string' ? accountName.trim() : '';
    if (!account) {
      return false;
    }

    const keytar = this.loadKeytar();
    if (!keytar) {
      return false;
    }

    await keytar.deletePassword(SERVICE_NAME, account);
    return true;
  }

  async getToken() {
    return this.getSecret(OPENCLAW_ACCOUNT_NAME);
  }

  async setToken(token) {
    return this.setSecret(OPENCLAW_ACCOUNT_NAME, token);
  }

  async deleteToken() {
    return this.deleteSecret(OPENCLAW_ACCOUNT_NAME);
  }
}

module.exports = {
  OPENCLAW_ACCOUNT_NAME,
  NANOBOT_ACCOUNT_NAME,
  KeytarSecretStore,
};
