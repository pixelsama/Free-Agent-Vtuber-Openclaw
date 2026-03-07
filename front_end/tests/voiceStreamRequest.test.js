import { describe, expect, it } from 'vitest';
import { buildVoiceStreamRequest } from '../src/hooks/voice/voiceStreamRequest.js';

describe('buildVoiceStreamRequest', () => {
  it('defaults voice submissions to the text composer session and voice-asr source', () => {
    const result = buildVoiceStreamRequest({
      content: '  hello world  ',
      defaultSessionId: 'text-composer',
    });

    expect(result).toEqual({
      content: 'hello world',
      sessionId: 'text-composer',
      extras: {
        options: {
          source: 'voice-asr',
        },
      },
    });
  });

  it('preserves explicit PTT metadata instead of overriding it in App', () => {
    const result = buildVoiceStreamRequest({
      content: '  你好  ',
      defaultSessionId: 'text-composer',
      request: {
        sessionId: 'voice-session',
        source: 'voice-ptt',
        policy: 'latest-wins',
        backend: 'openclaw',
        options: {
          source: 'voice-asr',
          traceId: 'trace-123',
        },
      },
    });

    expect(result).toEqual({
      content: '你好',
      sessionId: 'voice-session',
      extras: {
        policy: 'latest-wins',
        backend: 'openclaw',
        options: {
          source: 'voice-ptt',
          traceId: 'trace-123',
        },
      },
    });
  });
});
