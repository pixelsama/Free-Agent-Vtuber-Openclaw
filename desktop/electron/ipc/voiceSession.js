const { createAsrService } = require('../services/voice/asrService');
const { createTtsService } = require('../services/voice/ttsService');

const SESSION_STATUS_IDLE = 'idle';
const SESSION_STATUS_LISTENING = 'listening';
const SESSION_STATUS_TRANSCRIBING = 'transcribing';
const SESSION_STATUS_SPEAKING = 'speaking';
const SESSION_STATUS_ERROR = 'error';

function toVoiceError(error, fallbackCode = 'voice_unknown_error', fallbackStage = 'unknown') {
  if (error?.name === 'AbortError') {
    return {
      code: 'aborted',
      message: 'Operation aborted.',
      stage: fallbackStage,
      retriable: true,
    };
  }

  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return {
      code: error.code,
      message: error.message || 'Voice request failed.',
      stage: error.stage || fallbackStage,
      retriable: Boolean(error.retriable),
    };
  }

  return {
    code: fallbackCode,
    message: error?.message || 'Voice request failed.',
    stage: fallbackStage,
    retriable: false,
  };
}

function normalizeSessionId(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeSeq(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function registerVoiceSessionIpc({
  ipcMain,
  emitEvent,
  emitFlowControl,
  createAsrServiceImpl = createAsrService,
  createTtsServiceImpl = createTtsService,
  onAsrFinal,
  autoTtsOnAsrFinal = false,
}) {
  const sessionMap = new Map();
  const asrService = createAsrServiceImpl();
  const ttsService = createTtsServiceImpl();

  const sendEvent = (event) => {
    emitEvent(event);
  };

  const sendState = (sessionId, status) => {
    sendEvent({
      type: 'state',
      sessionId,
      status,
    });
  };

  const sendError = (sessionId, errorPayload) => {
    sendEvent({
      type: 'error',
      sessionId,
      ...errorPayload,
    });
  };

  const sendDone = (sessionId, stage, extra = {}) => {
    sendEvent({
      type: 'done',
      sessionId,
      stage,
      ...extra,
    });
  };

  const buildSessionState = (sessionId, mode) => ({
    sessionId,
    mode: mode || 'vad',
    status: SESSION_STATUS_LISTENING,
    lastSeq: 0,
    lastAckSeq: 0,
    bufferedMs: 0,
    audioChunks: [],
    asrController: null,
    ttsController: null,
  });

  ipcMain.handle('voice:session:start', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    if (!sessionId) {
      return {
        ok: false,
        reason: 'invalid_session_id',
      };
    }

    const existing = sessionMap.get(sessionId);
    if (existing) {
      return {
        ok: true,
        sessionId,
        status: existing.status,
      };
    }

    const sessionState = buildSessionState(sessionId, request.mode);
    sessionMap.set(sessionId, sessionState);
    sendState(sessionId, sessionState.status);

    return {
      ok: true,
      sessionId,
      status: sessionState.status,
    };
  });

  ipcMain.handle('voice:audio:chunk', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    const seq = normalizeSeq(request.seq);
    if (seq <= sessionState.lastSeq) {
      return {
        ok: false,
        reason: 'stale_seq',
      };
    }

    sessionState.lastSeq = seq;

    const chunkValue = request.pcmChunk;
    const chunkBuffer = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue || []);
    if (!chunkBuffer.length) {
      return {
        ok: false,
        reason: 'empty_chunk',
      };
    }

    sessionState.audioChunks.push({
      seq,
      chunkId: normalizeSeq(request.chunkId),
      sampleRate: normalizeSeq(request.sampleRate) || 16000,
      channels: normalizeSeq(request.channels) || 1,
      sampleFormat: typeof request.sampleFormat === 'string' ? request.sampleFormat : 'pcm_s16le',
      isSpeech: Boolean(request.isSpeech),
      pcmChunk: chunkBuffer,
    });

    return {
      ok: true,
      accepted: true,
      seq,
    };
  });

  ipcMain.handle('voice:input:commit', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: false,
        reason: 'session_not_found',
      };
    }

    if (sessionState.status === SESSION_STATUS_TRANSCRIBING) {
      return {
        ok: false,
        reason: 'transcribing_in_progress',
      };
    }

    const committedChunks = sessionState.audioChunks;
    if (!committedChunks.length) {
      return {
        ok: false,
        reason: 'empty_audio',
      };
    }
    sessionState.audioChunks = [];

    sessionState.status = SESSION_STATUS_TRANSCRIBING;
    sendState(sessionId, sessionState.status);
    sessionState.asrController = new AbortController();

    try {
      let partialSeq = 0;
      const result = await asrService.transcribe({
        audioChunks: committedChunks,
        signal: sessionState.asrController.signal,
        onPartial: (text) => {
          partialSeq += 1;
          sendEvent({
            type: 'asr-partial',
            sessionId,
            seq: partialSeq,
            text,
          });
        },
      });

      const finalText = typeof result?.text === 'string' ? result.text.trim() : '';
      if (finalText) {
        sendEvent({
          type: 'asr-final',
          sessionId,
          seq: partialSeq + 1,
          text: finalText,
        });
      }

      if (typeof onAsrFinal === 'function' && finalText) {
        await onAsrFinal({
          sessionId,
          text: finalText,
        });
      }

      if (autoTtsOnAsrFinal && finalText) {
        await synthesizeTts({
          sessionId,
          text: finalText,
          ttsService,
          sendEvent,
          sendDone,
          sendError,
          sessionState,
        });
      }

      sendDone(sessionId, 'transcribing');
      if (sessionState.status !== SESSION_STATUS_SPEAKING) {
        sessionState.status = SESSION_STATUS_LISTENING;
        sendState(sessionId, sessionState.status);
      }

      return {
        ok: true,
        text: finalText,
      };
    } catch (error) {
      sessionState.audioChunks = committedChunks.concat(sessionState.audioChunks);
      const payload = toVoiceError(error, 'voice_asr_failed', 'transcribing');
      sendError(sessionId, payload);
      sessionState.status = SESSION_STATUS_ERROR;
      sendState(sessionId, sessionState.status);
      return {
        ok: false,
        reason: 'asr_failed',
        error: payload,
      };
    }
  });

  ipcMain.handle('voice:session:stop', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: true,
        reason: 'not_found',
      };
    }

    sessionState.asrController?.abort();
    sessionState.ttsController?.abort();
    sessionState.audioChunks = [];
    sessionState.status = SESSION_STATUS_IDLE;
    sendState(sessionId, sessionState.status);
    sendDone(sessionId, 'session', { aborted: true });
    sessionMap.delete(sessionId);

    return { ok: true };
  });

  ipcMain.handle('voice:tts:stop', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: true,
        reason: 'not_found',
      };
    }

    sessionState.ttsController?.abort();
    sessionState.status = SESSION_STATUS_LISTENING;
    sendState(sessionId, sessionState.status);
    sendDone(sessionId, 'speaking', { aborted: true });

    return { ok: true };
  });

  ipcMain.handle('voice:playback:ack', async (_event, request = {}) => {
    const sessionId = normalizeSessionId(request.sessionId);
    const sessionState = sessionMap.get(sessionId);
    if (!sessionState) {
      return {
        ok: true,
        reason: 'not_found',
      };
    }

    const ackSeq = normalizeSeq(request.ackSeq);
    const bufferedMs = normalizeSeq(request.bufferedMs);
    sessionState.lastAckSeq = Math.max(sessionState.lastAckSeq, ackSeq);
    sessionState.bufferedMs = bufferedMs;

    if (typeof emitFlowControl === 'function') {
      if (bufferedMs > 2000) {
        emitFlowControl({
          type: 'tts-flow-control',
          sessionId,
          action: 'pause',
          bufferedMs,
        });
      } else if (bufferedMs < 800) {
        emitFlowControl({
          type: 'tts-flow-control',
          sessionId,
          action: 'resume',
          bufferedMs,
        });
      }
    }

    return {
      ok: true,
      sessionId,
      ackSeq: sessionState.lastAckSeq,
      bufferedMs: sessionState.bufferedMs,
    };
  });

  return () => {
    for (const [, sessionState] of sessionMap.entries()) {
      sessionState.asrController?.abort();
      sessionState.ttsController?.abort();
    }
    sessionMap.clear();

    ipcMain.removeHandler('voice:session:start');
    ipcMain.removeHandler('voice:audio:chunk');
    ipcMain.removeHandler('voice:input:commit');
    ipcMain.removeHandler('voice:session:stop');
    ipcMain.removeHandler('voice:tts:stop');
    ipcMain.removeHandler('voice:playback:ack');
  };
}

async function synthesizeTts({
  sessionId,
  text,
  ttsService,
  sendEvent,
  sendDone,
  sendError,
  sessionState,
}) {
  sessionState.status = SESSION_STATUS_SPEAKING;
  sendEvent({
    type: 'state',
    sessionId,
    status: sessionState.status,
  });

  sessionState.ttsController = new AbortController();
  let seq = 0;
  try {
    await ttsService.synthesize({
      text,
      signal: sessionState.ttsController.signal,
      onChunk: ({ audioChunk, codec, sampleRate }) => {
        seq += 1;
        sendEvent({
          type: 'tts-chunk',
          sessionId,
          seq,
          chunkId: seq,
          audioChunk,
          codec,
          sampleRate,
        });
      },
    });

    sendDone(sessionId, 'speaking');
    sessionState.status = SESSION_STATUS_LISTENING;
    sendEvent({
      type: 'state',
      sessionId,
      status: sessionState.status,
    });
  } catch (error) {
    const payload = toVoiceError(error, 'voice_tts_failed', 'speaking');
    sendError(sessionId, payload);
    sessionState.status = SESSION_STATUS_ERROR;
    sendEvent({
      type: 'state',
      sessionId,
      status: sessionState.status,
    });
  }
}

module.exports = {
  registerVoiceSessionIpc,
  synthesizeTts,
  toVoiceError,
};
