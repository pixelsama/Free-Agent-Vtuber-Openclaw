function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

export function buildVoiceStreamRequest({
  content,
  defaultSessionId = 'text-composer',
  request = {},
} = {}) {
  const safeContent = normalizeString(content);
  const safeRequest = request && typeof request === 'object' ? request : {};
  const requestedOptions =
    safeRequest.options && typeof safeRequest.options === 'object' ? safeRequest.options : {};
  const source = normalizeString(
    safeRequest.source,
    normalizeString(requestedOptions.source, 'voice-asr'),
  );
  const sessionId = normalizeString(safeRequest.sessionId, defaultSessionId);
  const extras = { ...safeRequest };
  delete extras.sessionId;
  delete extras.source;
  delete extras.options;

  return {
    content: safeContent,
    sessionId,
    extras: {
      ...extras,
      options: {
        ...requestedOptions,
        source,
      },
    },
  };
}
