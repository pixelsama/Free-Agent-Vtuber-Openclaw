function mapOpenClawSseEvent(sseEvent) {
  const rawData = typeof sseEvent?.data === 'string' ? sseEvent.data.trim() : '';

  if (!rawData) {
    return null;
  }

  if (rawData === '[DONE]') {
    return {
      type: 'done',
      payload: { source: 'openclaw' },
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }

  const delta = parsed?.choices?.[0]?.delta?.content;
  if (typeof delta === 'string' && delta.length > 0) {
    return {
      type: 'text-delta',
      payload: { content: delta },
    };
  }

  if (parsed?.error?.message) {
    return {
      type: 'error',
      payload: {
        code: 'openclaw_upstream_error',
        message: parsed.error.message,
      },
    };
  }

  return null;
}

module.exports = {
  mapOpenClawSseEvent,
};
