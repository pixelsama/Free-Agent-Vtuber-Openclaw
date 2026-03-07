import { describe, expect, it } from 'vitest';
import { normalizeConversationEnvelopeEvent } from '../src/hooks/chat/useStreamingSubtitleBridge.js';

describe('normalizeConversationEnvelopeEvent', () => {
  it('normalizes desktop chat envelope payloads for subtitle consumption', () => {
    const result = normalizeConversationEnvelopeEvent({
      channel: 'chat',
      type: 'segment-ready',
      payload: {
        segmentId: 'turn-1:0',
        text: '测试回复第一段。',
      },
    });

    expect(result).toEqual({
      channel: 'chat',
      type: 'segment-ready',
      payload: {
        segmentId: 'turn-1:0',
        text: '测试回复第一段。',
      },
    });
  });

  it('passes through desktop voice envelope payloads', () => {
    const event = {
      channel: 'voice',
      type: 'segment-tts-started',
      segmentId: 'turn-1:0',
      text: '测试回复第一段。',
    };

    expect(normalizeConversationEnvelopeEvent(event)).toEqual({
      channel: 'voice',
      type: 'segment-tts-started',
      payload: event,
    });
  });

  it('rejects unrelated envelopes', () => {
    expect(normalizeConversationEnvelopeEvent({ channel: 'debug', type: 'noop' })).toBeNull();
    expect(normalizeConversationEnvelopeEvent({})).toBeNull();
  });
});
