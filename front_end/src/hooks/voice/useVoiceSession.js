import { useCallback, useEffect, useMemo, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

const STATUS_IDLE = 'idle';

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `voice-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeVoiceError(error) {
  if (typeof error === 'string' && error) {
    return error;
  }

  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }

  return 'Voice request failed.';
}

export function useVoiceSession({ desktopMode = desktopBridge.isDesktop() } = {}) {
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState(STATUS_IDLE);
  const [lastPartialText, setLastPartialText] = useState('');
  const [lastFinalText, setLastFinalText] = useState('');
  const [lastError, setLastError] = useState('');
  const [flowControl, setFlowControl] = useState({ action: 'resume', bufferedMs: 0 });

  const active = Boolean(sessionId && status !== STATUS_IDLE);

  useEffect(() => {
    if (!desktopMode) {
      return () => {};
    }

    const disposeEvent = desktopBridge.voice.onEvent((event = {}) => {
      if (sessionId && event.sessionId && event.sessionId !== sessionId) {
        return;
      }

      if (event.type === 'state' && event.status) {
        setStatus(event.status);
      }

      if (event.type === 'asr-partial' && typeof event.text === 'string') {
        setLastPartialText(event.text);
      }

      if (event.type === 'asr-final' && typeof event.text === 'string') {
        setLastFinalText(event.text);
      }

      if (event.type === 'error') {
        setLastError(normalizeVoiceError(event));
      }

      if (event.type === 'done' && event.stage === 'session') {
        setStatus(STATUS_IDLE);
        setSessionId('');
      }
    });

    const disposeFlow = desktopBridge.voice.onFlowControl((event = {}) => {
      if (sessionId && event.sessionId && event.sessionId !== sessionId) {
        return;
      }

      setFlowControl({
        action: event.action === 'pause' ? 'pause' : 'resume',
        bufferedMs: typeof event.bufferedMs === 'number' ? event.bufferedMs : 0,
      });
    });

    return () => {
      disposeEvent();
      disposeFlow();
    };
  }, [desktopMode, sessionId]);

  const startSession = useCallback(
    async ({ mode = 'vad' } = {}) => {
      if (!desktopMode) {
        setLastError('Voice mode requires desktop runtime.');
        return { ok: false, reason: 'desktop_only' };
      }

      const nextSessionId = createSessionId();
      setLastError('');
      setLastPartialText('');
      setLastFinalText('');

      const result = await desktopBridge.voice.start({
        sessionId: nextSessionId,
        mode,
      });

      if (!result?.ok) {
        setLastError(result?.reason || 'voice_session_start_failed');
        return result;
      }

      setSessionId(nextSessionId);
      setStatus(result.status || 'listening');
      return result;
    },
    [desktopMode],
  );

  const sendAudioChunk = useCallback(
    async ({
      seq,
      chunkId,
      pcmChunk,
      sampleRate = 16000,
      channels = 1,
      sampleFormat = 'pcm_s16le',
      isSpeech = false,
    } = {}) => {
      if (!sessionId) {
        return { ok: false, reason: 'session_not_started' };
      }

      return desktopBridge.voice.sendAudioChunk({
        sessionId,
        seq,
        chunkId,
        pcmChunk,
        sampleRate,
        channels,
        sampleFormat,
        isSpeech,
      });
    },
    [sessionId],
  );

  const commitInput = useCallback(
    async ({ finalSeq } = {}) => {
      if (!sessionId) {
        return { ok: false, reason: 'session_not_started' };
      }

      return desktopBridge.voice.commit({
        sessionId,
        finalSeq,
      });
    },
    [sessionId],
  );

  const stopSession = useCallback(
    async ({ reason = 'manual' } = {}) => {
      if (!sessionId) {
        return { ok: true, reason: 'not_started' };
      }

      const result = await desktopBridge.voice.stop({
        sessionId,
        reason,
      });
      setSessionId('');
      setStatus(STATUS_IDLE);
      return result;
    },
    [sessionId],
  );

  const stopTts = useCallback(
    async ({ reason = 'manual' } = {}) => {
      if (!sessionId) {
        return { ok: true, reason: 'not_started' };
      }

      return desktopBridge.voice.stopTts({
        sessionId,
        reason,
      });
    },
    [sessionId],
  );

  const sendPlaybackAck = useCallback(
    async ({ ackSeq, bufferedMs } = {}) => {
      if (!sessionId) {
        return { ok: false, reason: 'session_not_started' };
      }

      return desktopBridge.voice.sendPlaybackAck({
        sessionId,
        ackSeq,
        bufferedMs,
      });
    },
    [sessionId],
  );

  return useMemo(
    () => ({
      sessionId,
      status,
      active,
      lastPartialText,
      lastFinalText,
      lastError,
      flowControl,
      startSession,
      sendAudioChunk,
      commitInput,
      stopSession,
      stopTts,
      sendPlaybackAck,
    }),
    [
      sessionId,
      status,
      active,
      lastPartialText,
      lastFinalText,
      lastError,
      flowControl,
      startSession,
      sendAudioChunk,
      commitInput,
      stopSession,
      stopTts,
      sendPlaybackAck,
    ],
  );
}
