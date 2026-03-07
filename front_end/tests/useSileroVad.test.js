import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMicVadOptions } from '../src/hooks/voice/useSileroVad.js';

describe('buildMicVadOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enables submitUserSpeechOnPause so push-to-talk stop flushes current speech', () => {
    const options = buildMicVadOptions();

    expect(options.submitUserSpeechOnPause).toBe(true);
    expect(options.startOnLoad).toBe(false);
  });

  it('updates speaking state and forwards speech callbacks', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setSpeakingState = vi.fn();
    const onSpeechStart = vi.fn(async () => {});
    const onSpeechEnd = vi.fn(async () => {});
    const onVADMisfire = vi.fn(async () => {});
    const audio = new Float32Array([0.1, -0.2, 0.3]);

    const options = buildMicVadOptions({
      model: 'v5',
      baseAssetPath: '/vad/',
      onnxWasmBasePath: '/ort/',
      setSpeakingState,
      onSpeechStart,
      onSpeechEnd,
      onVADMisfire,
    });

    expect(options.model).toBe('v5');
    expect(options.baseAssetPath).toBe('/vad/');
    expect(options.onnxWASMBasePath).toBe('/ort/');

    await options.onSpeechStart();
    await options.onSpeechEnd(audio);
    await options.onVADMisfire();

    expect(setSpeakingState).toHaveBeenNthCalledWith(1, true);
    expect(setSpeakingState).toHaveBeenNthCalledWith(2, false);
    expect(setSpeakingState).toHaveBeenNthCalledWith(3, false);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(onSpeechEnd).toHaveBeenCalledWith(audio);
    expect(onVADMisfire).toHaveBeenCalledTimes(1);
  });
});
