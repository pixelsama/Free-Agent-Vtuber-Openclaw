class ChatBackendAdapter {
  constructor(name) {
    this.name = name;
  }

  validateSettings(_settings) {
    return;
  }

  async testConnection() {
    throw new Error('testConnection is not implemented');
  }

  async startStream() {
    throw new Error('startStream is not implemented');
  }

  mapError(error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      return {
        code: error.code,
        message: error.message || '聊天后端请求失败。',
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
      code: 'chat_backend_error',
      message: error?.message || '聊天后端请求失败。',
    };
  }

  async dispose() {
    return;
  }
}

module.exports = {
  ChatBackendAdapter,
};
