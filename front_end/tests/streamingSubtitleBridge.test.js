import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlaybackSubtitleController,
  normalizeConversationEnvelopeEvent,
} from '../src/hooks/chat/useStreamingSubtitleBridge.js';

afterEach(() => {
  vi.useRealTimers();
});

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

describe('createPlaybackSubtitleController', () => {
  it('only updates subtitles from playback events and clears after playback ends', () => {
    vi.useFakeTimers();
    const setSegmentText = vi.fn();
    const clearSubtitle = vi.fn();
    const finishStream = vi.fn();
    const onComposerError = vi.fn();
    const controller = createPlaybackSubtitleController({
      setSegmentText,
      clearSubtitle,
      finishStream,
      normalizeError: (error) => error?.message || 'subtitle_error',
      onComposerError,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    });

    controller.handleConversationEvent({
      channel: 'chat',
      type: 'text-delta',
      payload: {
        content: '不应该直出',
      },
    });
    expect(setSegmentText).not.toHaveBeenCalled();

    controller.handlePlaybackEvent({
      type: 'segment-playback-started',
      turnId: 'turn-1',
      segmentId: 'turn-1:0',
      index: 0,
      text: '第一段字幕',
    });
    expect(setSegmentText).toHaveBeenCalledWith('第一段字幕');

    controller.handlePlaybackEvent({
      type: 'segment-playback-finished',
      turnId: 'turn-1',
      segmentId: 'turn-1:0',
      index: 0,
      text: '第一段字幕',
    });
    expect(clearSubtitle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(48);
    expect(clearSubtitle).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('does not clear subtitles between contiguous playback segments', () => {
    vi.useFakeTimers();
    const setSegmentText = vi.fn();
    const clearSubtitle = vi.fn();
    const controller = createPlaybackSubtitleController({
      setSegmentText,
      clearSubtitle,
      finishStream: vi.fn(),
      normalizeError: (error) => error?.message || 'subtitle_error',
      onComposerError: vi.fn(),
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    });

    controller.handlePlaybackEvent({
      type: 'segment-playback-started',
      turnId: 'turn-1',
      segmentId: 'turn-1:0',
      index: 0,
      text: '第一段字幕',
    });
    controller.handlePlaybackEvent({
      type: 'segment-playback-finished',
      turnId: 'turn-1',
      segmentId: 'turn-1:0',
      index: 0,
      text: '第一段字幕',
    });

    vi.advanceTimersByTime(24);

    controller.handlePlaybackEvent({
      type: 'segment-playback-started',
      turnId: 'turn-1',
      segmentId: 'turn-1:1',
      index: 1,
      text: '第二段字幕',
    });

    vi.advanceTimersByTime(80);

    expect(clearSubtitle).not.toHaveBeenCalled();
    expect(setSegmentText).toHaveBeenNthCalledWith(1, '第一段字幕');
    expect(setSegmentText).toHaveBeenNthCalledWith(2, '第二段字幕');

    controller.dispose();
  });
});
