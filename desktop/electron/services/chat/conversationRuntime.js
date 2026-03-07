const DEFAULT_POLICY = 'latest-wins';

function normalizeSessionId(value) {
  if (typeof value !== 'string') {
    return 'default';
  }

  const normalized = value.trim();
  return normalized || 'default';
}

function normalizeContent(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizePolicy(value) {
  if (typeof value !== 'string') {
    return DEFAULT_POLICY;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'queue') {
    return 'queue';
  }
  if (normalized === 'latest-wins') {
    return 'latest-wins';
  }

  return DEFAULT_POLICY;
}

function createConversationRuntime({
  startChatStream,
  abortChatStream,
  emitConversationEvent,
  emitDebugLog,
} = {}) {
  const activeStreamBySession = new Map();
  const streamSessionMap = new Map();
  const pendingQueueBySession = new Map();

  const debug = (payload = {}) => {
    if (typeof emitDebugLog !== 'function') {
      return;
    }
    emitDebugLog({
      source: 'conversation-runtime',
      ...payload,
    });
  };

  const emitEvent = (payload = {}) => {
    if (typeof emitConversationEvent !== 'function') {
      return;
    }
    emitConversationEvent({
      timestamp: new Date().toISOString(),
      ...payload,
    });
  };

  const clearActiveByStreamId = (streamId) => {
    const sessionId = streamSessionMap.get(streamId);
    if (!sessionId) {
      return '';
    }

    streamSessionMap.delete(streamId);
    if (activeStreamBySession.get(sessionId) === streamId) {
      activeStreamBySession.delete(sessionId);
    }
    return sessionId;
  };

  const doAbortStream = async (streamId, reason) => {
    if (!streamId || typeof abortChatStream !== 'function') {
      return;
    }

    try {
      await abortChatStream({ streamId });
      debug({
        stage: 'stream-abort',
        message: 'Conversation runtime aborted chat stream.',
        details: {
          streamId,
          reason: reason || '',
        },
      });
    } catch (error) {
      debug({
        stage: 'stream-abort-failed',
        message: 'Conversation runtime failed to abort chat stream.',
        details: {
          streamId,
          reason: reason || '',
          error: error?.message || String(error),
        },
      });
    }
  };

  const startTurn = async (request, policy) => {
    const sessionId = normalizeSessionId(request?.sessionId);
    const content = normalizeContent(request?.content);
    if (!content) {
      return {
        ok: false,
        reason: 'content_required',
      };
    }

    if (typeof startChatStream !== 'function') {
      return {
        ok: false,
        reason: 'chat_stream_unavailable',
      };
    }

    const startResult = await startChatStream({
      ...request,
      sessionId,
      content,
    });

    if (!startResult?.ok || !startResult.streamId) {
      return {
        ok: false,
        reason: startResult?.reason || 'stream_start_failed',
      };
    }

    const streamId = startResult.streamId;
    streamSessionMap.set(streamId, sessionId);
    activeStreamBySession.set(sessionId, streamId);

    debug({
      stage: 'stream-start',
      message: 'Conversation runtime started chat stream.',
      details: {
        sessionId,
        streamId,
        policy,
        source: request?.options?.source || '',
      },
    });

    return {
      ok: true,
      streamId,
      sessionId,
      policy,
    };
  };

  const drainQueue = (sessionId) => {
    const safeSessionId = normalizeSessionId(sessionId);
    if (activeStreamBySession.has(safeSessionId)) {
      return;
    }

    const queue = pendingQueueBySession.get(safeSessionId);
    if (!queue || queue.length === 0) {
      pendingQueueBySession.delete(safeSessionId);
      return;
    }

    const next = queue.shift();
    if (!queue.length) {
      pendingQueueBySession.delete(safeSessionId);
    }

    void startTurn(next.request, 'queue')
      .then((result) => {
        next.resolve(result);
      })
      .catch((error) => {
        next.resolve({
          ok: false,
          reason: error?.message || 'stream_start_failed',
        });
      });
  };

  const enqueueRequest = (sessionId, request) =>
    new Promise((resolve) => {
      const safeSessionId = normalizeSessionId(sessionId);
      const queue = pendingQueueBySession.get(safeSessionId) || [];
      queue.push({
        request: {
          ...request,
          sessionId: safeSessionId,
        },
        resolve,
      });
      pendingQueueBySession.set(safeSessionId, queue);
      debug({
        stage: 'queue-enqueue',
        message: 'Conversation runtime queued chat request.',
        details: {
          sessionId: safeSessionId,
          queuedCount: queue.length,
        },
      });
    });

  const clearPendingQueue = (sessionId, reason) => {
    const safeSessionId = normalizeSessionId(sessionId);
    const queue = pendingQueueBySession.get(safeSessionId);
    if (!queue || queue.length === 0) {
      pendingQueueBySession.delete(safeSessionId);
      return;
    }

    pendingQueueBySession.delete(safeSessionId);
    for (const item of queue) {
      item.resolve({
        ok: false,
        reason: reason || 'aborted',
      });
    }
  };

  const submitUserText = async (request = {}) => {
    const sessionId = normalizeSessionId(request?.sessionId);
    const content = normalizeContent(request?.content);
    const policy = normalizePolicy(request?.policy || request?.options?.concurrencyPolicy);
    const normalizedRequest = {
      ...request,
      sessionId,
      content,
    };

    if (!content) {
      return {
        ok: false,
        reason: 'content_required',
      };
    }

    const activeStreamId = activeStreamBySession.get(sessionId) || '';
    if (policy === 'queue' && activeStreamId) {
      return enqueueRequest(sessionId, normalizedRequest);
    }

    if (policy === 'latest-wins' && activeStreamId) {
      clearPendingQueue(sessionId, 'superseded_by_latest');
      await doAbortStream(activeStreamId, 'latest_wins');
    }

    return startTurn(normalizedRequest, policy);
  };

  const abortActive = async (request = {}) => {
    const requestedSessionId = normalizeSessionId(request?.sessionId);
    const requestedStreamId =
      typeof request?.streamId === 'string' ? request.streamId.trim() : '';

    if (requestedStreamId) {
      await doAbortStream(requestedStreamId, request?.reason || 'manual');
      const clearedSessionId = clearActiveByStreamId(requestedStreamId);
      if (clearedSessionId) {
        clearPendingQueue(clearedSessionId, request?.reason || 'manual');
      }
      return {
        ok: true,
        aborted: [requestedStreamId],
      };
    }

    const activeStreamId = activeStreamBySession.get(requestedSessionId);
    if (!activeStreamId) {
      return {
        ok: true,
        aborted: [],
      };
    }

    await doAbortStream(activeStreamId, request?.reason || 'manual');
    clearActiveByStreamId(activeStreamId);
    clearPendingQueue(requestedSessionId, request?.reason || 'manual');
    return {
      ok: true,
      aborted: [activeStreamId],
    };
  };

  const onChatStreamEvent = (payload = {}) => {
    emitEvent({
      channel: 'chat',
      streamId: typeof payload?.streamId === 'string' ? payload.streamId : '',
      type: typeof payload?.type === 'string' ? payload.type : '',
      payload: payload?.payload && typeof payload.payload === 'object' ? payload.payload : {},
    });

    const streamId = typeof payload?.streamId === 'string' ? payload.streamId : '';
    const type = typeof payload?.type === 'string' ? payload.type : '';
    if (!streamId || (type !== 'done' && type !== 'error')) {
      return;
    }

    const sessionId = clearActiveByStreamId(streamId);
    if (!sessionId) {
      return;
    }

    drainQueue(sessionId);
  };

  const onVoiceEvent = (payload = {}) => {
    const type = typeof payload?.type === 'string' ? payload.type : '';
    if (!type) {
      return;
    }

    emitEvent({
      channel: 'voice',
      ...payload,
    });
  };

  const dispose = async () => {
    const streamIds = Array.from(streamSessionMap.keys());
    await Promise.all(streamIds.map((streamId) => doAbortStream(streamId, 'dispose')));
    for (const sessionId of pendingQueueBySession.keys()) {
      clearPendingQueue(sessionId, 'dispose');
    }
    activeStreamBySession.clear();
    streamSessionMap.clear();
    pendingQueueBySession.clear();
  };

  return {
    submitUserText,
    abortActive,
    onChatStreamEvent,
    onVoiceEvent,
    dispose,
  };
}

module.exports = {
  createConversationRuntime,
};
