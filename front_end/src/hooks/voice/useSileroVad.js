import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MicVAD } from '@ricky0123/vad-web';

const DEFAULT_VAD_MODEL = 'v5';
const DEFAULT_VAD_ASSET_BASE =
  import.meta.env.VITE_VAD_ASSET_BASE_PATH || 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/';
const DEFAULT_ORT_ASSET_BASE =
  import.meta.env.VITE_ORT_WASM_BASE_PATH || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';

function logVad(message, details = {}) {
  console.info('[voice-vad]', message, details);
}

export function buildMicVadOptions({
  model = DEFAULT_VAD_MODEL,
  baseAssetPath = DEFAULT_VAD_ASSET_BASE,
  onnxWasmBasePath = DEFAULT_ORT_ASSET_BASE,
  setSpeakingState = () => {},
  onSpeechStart,
  onSpeechEnd,
  onVADMisfire,
} = {}) {
  return {
    model,
    startOnLoad: false,
    baseAssetPath,
    onnxWASMBasePath: onnxWasmBasePath,
    // PTT release must flush the current speech buffer instead of discarding it.
    submitUserSpeechOnPause: true,
    onSpeechStart: async () => {
      setSpeakingState(true);
      logVad('Silero VAD reported speech start.', {
        model,
      });
      if (typeof onSpeechStart === 'function') {
        await onSpeechStart();
      }
    },
    onSpeechEnd: async (audio) => {
      setSpeakingState(false);
      logVad('Silero VAD reported speech end.', {
        model,
        audioSamples: audio instanceof Float32Array ? audio.length : 0,
      });
      if (typeof onSpeechEnd === 'function') {
        await onSpeechEnd(audio);
      }
    },
    onVADMisfire: async () => {
      setSpeakingState(false);
      console.warn('[voice-vad] Silero VAD reported a misfire.', {
        model,
      });
      if (typeof onVADMisfire === 'function') {
        await onVADMisfire();
      }
    },
  };
}

export function useSileroVad() {
  const vadRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [vadError, setVadError] = useState('');

  const start = useCallback(
    async ({ onSpeechStart, onSpeechEnd, onVADMisfire, model = DEFAULT_VAD_MODEL } = {}) => {
      if (isLoading) {
        console.warn('[voice-vad] Ignored VAD start while already loading.', {
          model,
        });
        return { ok: false, reason: 'vad_loading' };
      }

      if (vadRef.current && isListening) {
        logVad('VAD start skipped because listener is already active.', {
          model,
        });
        return { ok: true, reason: 'already_listening' };
      }

      setIsLoading(true);
      setVadError('');
      logVad('Starting Silero VAD.', {
        model,
        baseAssetPath: DEFAULT_VAD_ASSET_BASE,
        onnxWasmBasePath: DEFAULT_ORT_ASSET_BASE,
        submitUserSpeechOnPause: true,
      });

      try {
        const vad = await MicVAD.new(
          buildMicVadOptions({
            model,
            baseAssetPath: DEFAULT_VAD_ASSET_BASE,
            onnxWasmBasePath: DEFAULT_ORT_ASSET_BASE,
            setSpeakingState: setIsSpeaking,
            onSpeechStart,
            onSpeechEnd,
            onVADMisfire,
          }),
        );

        await vad.start();
        vadRef.current = vad;
        setIsListening(true);
        logVad('Silero VAD started listening.', {
          model,
        });
        return { ok: true };
      } catch (error) {
        setVadError(error?.message || 'silero_vad_start_failed');
        console.error('[voice-vad] Failed to start Silero VAD.', {
          model,
          reason: error?.name || 'silero_vad_start_failed',
          message: error?.message || '',
        });
        return { ok: false, reason: error?.name || 'silero_vad_start_failed' };
      } finally {
        setIsLoading(false);
      }
    },
    [isListening, isLoading],
  );

  const stop = useCallback(async () => {
    const vad = vadRef.current;
    if (!vad) {
      logVad('VAD stop skipped because nothing is active.');
      return { ok: true, reason: 'not_started' };
    }

    try {
      logVad('Stopping Silero VAD.');
      await vad.destroy();
      logVad('Silero VAD stopped.');
      return { ok: true };
    } catch (error) {
      setVadError(error?.message || 'silero_vad_stop_failed');
      console.error('[voice-vad] Failed to stop Silero VAD.', {
        reason: error?.name || 'silero_vad_stop_failed',
        message: error?.message || '',
      });
      return { ok: false, reason: error?.name || 'silero_vad_stop_failed' };
    } finally {
      vadRef.current = null;
      setIsListening(false);
      setIsSpeaking(false);
    }
  }, []);

  useEffect(
    () => () => {
      const vad = vadRef.current;
      vadRef.current = null;
      if (vad) {
        void vad.destroy().catch(() => {});
      }
    },
    [],
  );

  return useMemo(
    () => ({
      isLoading,
      isListening,
      isSpeaking,
      vadError,
      start,
      stop,
    }),
    [isLoading, isListening, isSpeaking, vadError, start, stop],
  );
}
